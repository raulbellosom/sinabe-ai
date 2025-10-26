const { embedTextsRobust } = require("./embeddings");
const { searchSimilar } = require("./qdrant");
const { pool } = require("./mysql");
const { EMBEDDING_MODEL, REQ_TIMEOUT_MS } = require("./config");
const { buildQdrantFilter } = require("./nlu");

async function semanticSearchQdrant({
  q,
  topK = 8,
  collection = "inventories_v1",
  filters = {},
}) {
  const [qr] = await embedTextsRobust([q], {
    model: EMBEDDING_MODEL,
    concurrency: 1,
    timeoutMs: REQ_TIMEOUT_MS,
  });
  if (!qr.ok) return [];
  const filter = buildQdrantFilter(filters);
  const result = await searchSimilar(qr.vec, {
    topK,
    name: collection,
    filter,
  });

  const ids = result
    .map((r) => r?.payload?.id)
    .filter((v) => v !== undefined && v !== null);
  if (!ids.length) return [];

  const [dbrows] = await pool.query(
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
   WHERE i.id IN (?)`,
    [ids]
  );

  const byId = new Map(dbrows.map((r) => [String(r.id), r]));
  return result
    .map((r) => {
      const base = byId.get(String(r?.payload?.id));
      return base ? { score: r.score, ...base } : null;
    })
    .filter(Boolean);
}

module.exports = { semanticSearchQdrant };
