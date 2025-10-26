// server.js (hybrid, modular)
// Drop-in replacement for your current server.js with hybrid search + fuzzy + reranker.

require("dotenv").config();
const express = require("express");
const app = express();
app.use(express.json());

const {
  PORT,
  OLLAMA_URL,
  QDRANT_URL,
  CHAT_MODEL,
  EMBEDDING_MODEL,
  EMBEDDING_DIM,
  REQ_TIMEOUT_MS,
  DEFAULT_PAGE_SIZE,
  DEFAULT_UPSERT_CHUNK,
  DEFAULT_EMBED_CONCURRENCY,
} = require("./src/config");

const { pool } = require("./src/mysql");
const { embedTextsRobust } = require("./src/embeddings");
const {
  ensureCollection,
  ensurePayloadIndexes,
  upsertPoints,
  searchSimilar,
} = require("./src/qdrant");
const { parseQueryToFilters } = require("./src/nlu");
const { keywordSearchMySQL } = require("./src/keyword");
const { rrfFuse } = require("./src/fusion");
const { suggestSerials } = require("./src/fuzzy");
const { rerankWithLLM, generateWithLLM } = require("./src/rerank");

// ---------- Diagnostics ----------
app.get("/health", (_req, res) => res.json({ ok: true }));

app.get("/config", (_req, res) => {
  res.json({
    OLLAMA_URL,
    QDRANT_URL,
    CHAT_MODEL,
    EMBEDDING_MODEL,
    EMBEDDING_DIM,
    REQ_TIMEOUT_MS,
    DEFAULT_PAGE_SIZE,
    DEFAULT_UPSERT_CHUNK,
    DEFAULT_EMBED_CONCURRENCY,
  });
});

// ---------- Debug embedding ----------
app.post("/debug/ollama-embed", async (req, res) => {
  try {
    const { text = "hola mundo", model = EMBEDDING_MODEL } = req.body || {};
    const [r] = await embedTextsRobust([text], {
      model,
      concurrency: 1,
      timeoutMs: REQ_TIMEOUT_MS,
    });
    if (!r.ok) return res.status(500).json({ error: r.error });
    res.json({ ok: true, dim: r.vec.length, sample: r.vec.slice(0, 8) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Ingest inventories into Qdrant ----------
app.post("/ingest", async (req, res) => {
  try {
    const {
      scope = "inventories",
      collection = "inventories_v1",
      dim = EMBEDDING_DIM,
      pageSize = DEFAULT_PAGE_SIZE,
      embedConcurrency = DEFAULT_EMBED_CONCURRENCY,
      upsertChunk = DEFAULT_UPSERT_CHUNK,
      maxPages = null,
      offsetPages = 0, // ← nuevo: para ingerir por tramos
    } = req.body || {};

    if (scope !== "inventories") {
      return res
        .status(400)
        .json({ error: 'scope no soportado (usa "inventories")', scope });
    }

    await ensureCollection(dim, collection);
    try {
      await ensurePayloadIndexes(collection);
    } catch (e) {
      console.warn(
        "[Ingest] ensurePayloadIndexes falló, continuo sin índices:",
        e?.response?.status,
        e?.response?.data || e?.message
      );
    }

    let offset = offsetPages * pageSize; // ← nuevo
    let totalIndexed = 0,
      totalSkipped = 0,
      page = 0;
    const skippedSamples = [];

    while (true) {
      const [rows] = await pool.query(
        `SELECT
           i.id,
           i.serialNumber,
           i.activeNumber,
           i.status,
           i.comments,
           i.receptionDate,
           i.internalFolio,
           i.createdAt,
           i.altaDate,
           i.bajaDate,
           m.name       AS modelName,
           b.name       AS brandName,
           t.name       AS typeName,
           inv.code     AS invoiceCode,
           po.code      AS purchaseOrderCode,
           cfs.customFieldsText
         FROM Inventory i
         JOIN Model m           ON i.modelId = m.id
         JOIN InventoryBrand b  ON m.brandId = b.id
         JOIN InventoryType t   ON m.typeId = t.id
         LEFT JOIN Invoice inv  ON inv.id = i.invoiceId
         LEFT JOIN PurchaseOrder po ON po.id = i.purchaseOrderId
         LEFT JOIN (
           SELECT ic.inventoryId,
                  GROUP_CONCAT(CONCAT(cf.name, ': ', ic.value) SEPARATOR ' | ') AS customFieldsText
           FROM InventoryCustomField ic
           JOIN CustomField cf ON cf.id = ic.customFieldId
           GROUP BY ic.inventoryId
         ) cfs ON cfs.inventoryId = i.id
         WHERE i.enabled = 1
         ORDER BY i.id
         LIMIT ? OFFSET ?`,
        [pageSize, offset]
      );

      if (!rows.length) break;

      // Texto rico para embeddings (incluye campos nuevos)
      const texts = rows.map((r) =>
        [
          r.brandName || "n/a",
          r.modelName || "n/a",
          r.typeName || "n/a",
          `SN:${r.serialNumber || "n/a"}`,
          `ACT:${r.activeNumber || "n/a"}`,
          `STATUS:${r.status || "n/a"}`,
          r.comments ? `COM:${r.comments}` : null,
          r.internalFolio ? `FOLIO:${r.internalFolio}` : null,
          r.receptionDate ? `RECEP:${r.receptionDate}` : null,
          r.altaDate
            ? `ALTA:${new Date(r.altaDate).toISOString().slice(0, 10)}`
            : null,
          r.bajaDate
            ? `BAJA:${new Date(r.bajaDate).toISOString().slice(0, 10)}`
            : null,
          r.invoiceCode ? `FAC:${r.invoiceCode}` : null,
          r.purchaseOrderCode ? `OC:${r.purchaseOrderCode}` : null,
          r.customFieldsText ? `CUST:${r.customFieldsText}` : null,
        ]
          .filter(Boolean)
          .join(" | ")
      );

      const results = await embedTextsRobust(texts, {
        model: EMBEDDING_MODEL,
        concurrency: embedConcurrency,
        timeoutMs: REQ_TIMEOUT_MS,
      });

      const okPoints = [];
      results.forEach((r, i) => {
        if (r.ok) {
          okPoints.push({
            id: rows[i].id,
            vector: r.vec,
            payload: rows[i], // ← payload ya incluye los campos nuevos
          });
        } else {
          totalSkipped++;
          if (skippedSamples.length < 5) {
            skippedSamples.push({
              id: rows[i].id,
              error: r.error,
              text: texts[i].slice(0, 200),
            });
          }
        }
      });

      for (let i = 0; i < okPoints.length; i += upsertChunk) {
        await upsertPoints(okPoints.slice(i, i + upsertChunk), collection);
      }

      totalIndexed += okPoints.length;
      offset += pageSize;
      page += 1;

      if (maxPages !== null && page >= maxPages) break;
      await new Promise((r) => setTimeout(r, 150));
    }

    res.json({
      ok: true,
      collection,
      dim,
      indexed: totalIndexed,
      skipped: totalSkipped,
      skippedSamples,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Hybrid search (single entrypoint for UI) ----------
app.post("/search/hybrid", async (req, res) => {
  try {
    const { q = "", topK = 8, collection = "inventories_v1" } = req.body || {};
    const { text, textOriginal, filters, maybeSerial } = parseQueryToFilters(q);

    // 1) Serial fuzzy path
    if (maybeSerial) {
      const [exactRows] = await pool.query(
        `SELECT i.id, i.serialNumber, i.activeNumber, i.status, i.createdAt,
                m.name AS modelName, b.name AS brandName, t.name AS typeName
         FROM Inventory i
         JOIN Model m ON i.modelId = m.id
         JOIN InventoryBrand b ON m.brandId = b.id
         JOIN InventoryType t ON m.typeId = t.id
         WHERE i.enabled=1 AND (i.serialNumber = ? OR i.activeNumber = ?)
         LIMIT 1`,
        [maybeSerial, maybeSerial]
      );
      if (exactRows.length) {
        return res.json({
          mode: "serial-exact",
          q,
          results: exactRows,
          suggestions: [],
        });
      }
      const suggestions = await suggestSerials(maybeSerial, { limit: topK });
      return res.json({ mode: "serial-fuzzy", q, results: [], suggestions });
    }

    // 2) Semantic + 3) Keyword

    const [semRows, kwRows] = await Promise.all([
      require("./src/semantic").semanticSearchQdrant({
        q: textOriginal || q,
        topK,
        collection,
        filters,
      }),
      keywordSearchMySQL({ q: textOriginal || q, limit: topK * 2, filters }),
    ]);

    // 4) Fusion
    const fused = rrfFuse([semRows, kwRows]).slice(0, topK * 2);

    // 5) LLM rerank
    const reranked = await rerankWithLLM(q, fused, {
      topN: Math.min(fused.length, 12),
    });
    res.json({
      mode: "hybrid",
      q,
      parsed: { text, filters },
      results: reranked.slice(0, topK),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Specs (LLM enrichment) ----------
app.post("/models/specs", async (req, res) => {
  try {
    const { id } = req.body || {};
    if (!id) return res.status(400).json({ error: "id requerido" });

    const [[row]] = await pool.query(
      `SELECT i.id, m.name AS modelName, b.name AS brandName, t.name AS typeName
       FROM Inventory i
       JOIN Model m ON i.modelId = m.id
       JOIN InventoryBrand b ON m.brandId = b.id
       JOIN InventoryType t ON m.typeId = t.id
       WHERE i.id = ?`,
      [id]
    );
    if (!row) return res.status(404).json({ error: "No encontrado" });

    const prompt = `Actúa como experto en hardware. Con base en conocimiento general (sin internet):
Modelo: ${row.brandName} ${row.modelName} (${row.typeName})
Da una ficha breve y probable (CPU/ram/opciones, puertos, almacenamiento, año aproximado y usos típicos).
Aclara que puede variar por configuración y lote. Responde en español en formato de viñetas.`;

    const text = await generateWithLLM(prompt);
    res.json({
      id: row.id,
      brand: row.brandName,
      model: row.modelName,
      specs: text,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () =>
  console.log(`AI API (hybrid) listening on port ${PORT}`)
);
