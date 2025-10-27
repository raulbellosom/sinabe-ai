// src/fuzzy.js
const { pool } = require("./mysql");

let SERIAL_INDEX = null;
let LAST_RELOAD = 0;

function norm(s) {
  return String(s || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

async function buildSerialIndex() {
  const [rows] = await pool.query(
    `SELECT id, serialNumber, activeNumber
     FROM Inventory
     WHERE enabled = 1 AND (serialNumber IS NOT NULL OR activeNumber IS NOT NULL)`
  );
  const serials = [];
  const bySerial = new Map();

  for (const r of rows) {
    if (r.serialNumber) {
      const n = norm(r.serialNumber);
      if (n) {
        serials.push(n);
        if (!bySerial.has(n)) bySerial.set(n, []);
        bySerial.get(n).push({ id: r.id, serialNumber: r.serialNumber });
      }
    }
    if (r.activeNumber) {
      const n = norm(r.activeNumber);
      if (n) {
        serials.push(n);
        if (!bySerial.has(n)) bySerial.set(n, []);
        bySerial.get(n).push({ id: r.id, serialNumber: r.activeNumber });
      }
    }
  }
  const set = new Set(serials);
  SERIAL_INDEX = { set, list: Array.from(set), bySerial };
  LAST_RELOAD = Date.now();
  return SERIAL_INDEX;
}

async function ensureSerialIndex({ reloadMs = 10 * 60 * 1000 } = {}) {
  if (!SERIAL_INDEX) return buildSerialIndex();
  if (Date.now() - LAST_RELOAD > reloadMs) {
    try {
      await buildSerialIndex();
    } catch (_) {
      /* best effort */
    }
  }
  return SERIAL_INDEX;
}

// Levenshtein acotado (early exit si supera maxDist)
function levenshteinBounded(a, b, maxDist = 2) {
  const la = a.length,
    lb = b.length;
  if (Math.abs(la - lb) > maxDist) return maxDist + 1;
  // DP de banda
  const prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = [i];
    // ventana alrededor de la diagonal
    const from = Math.max(1, i - maxDist);
    const to = Math.min(lb, i + maxDist);
    // rellena huecos para índice
    for (let j = 1; j < from; j++) cur[j] = maxDist + 1;
    for (let j = from; j <= to; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const ins = cur[j - 1] + 1;
      const del = prev[j] + 1;
      const sub = prev[j - 1] + cost;
      cur[j] = Math.min(ins, del, sub);
    }
    for (let j = to + 1; j <= lb; j++) cur[j] = maxDist + 1;
    // early exit si toda la fila está por encima
    const minRow = cur
      .slice(from, to + 1)
      .reduce((m, v) => Math.min(m, v), maxDist + 1);
    if (minRow > maxDist) return maxDist + 1;
    for (let j = 0; j <= lb; j++) prev[j] = cur[j];
  }
  return prev[lb];
}

function tryHeuristics(qNorm, set) {
  const out = [];

  // 1) quitar primer carácter
  if (qNorm.length > 1) {
    const dropFirst = qNorm.slice(1);
    if (set.has(dropFirst))
      out.push({ candidate: dropFirst, reason: "drop-first", dist: 1 });
  }

  // 2) quitar último carácter
  if (qNorm.length > 1) {
    const dropLast = qNorm.slice(0, -1);
    if (set.has(dropLast))
      out.push({ candidate: dropLast, reason: "drop-last", dist: 1 });
  }

  // 3) si empieza por una letra suelta + resto exacto
  if (/^[A-Z][A-Z0-9]+$/.test(qNorm)) {
    const rest = qNorm.slice(1);
    if (set.has(rest))
      out.push({ candidate: rest, reason: "leading-letter-extra", dist: 1 });
  }

  return out;
}

async function fuzzySerialSuggest(query, { maxDist = 2, topK = 8 } = {}) {
  const idx = await ensureSerialIndex();
  const qNorm = norm(query);
  const { set, list, bySerial } = idx;

  const seen = new Map();

  // Heurísticas rápidas primero
  for (const h of tryHeuristics(qNorm, set)) {
    const arr = bySerial.get(h.candidate) || [];
    for (const hit of arr) {
      const key = h.candidate + "|" + hit.id;
      if (!seen.has(key))
        seen.set(key, {
          candidate: h.candidate,
          id: hit.id,
          dist: h.dist,
          reason: h.reason,
        });
    }
  }

  // Filtra por longitud ±2 y calcula Levenshtein acotado
  const L = qNorm.length;
  for (const cand of list) {
    if (Math.abs(cand.length - L) > maxDist) continue;
    const d = levenshteinBounded(qNorm, cand, maxDist);
    if (d <= maxDist) {
      const arr = bySerial.get(cand) || [];
      for (const hit of arr) {
        const key = cand + "|" + hit.id;
        const prev = seen.get(key);
        if (!prev || d < prev.dist) {
          seen.set(key, {
            candidate: cand,
            id: hit.id,
            dist: d,
            reason: prev?.reason || "levenshtein",
          });
        }
      }
    }
  }

  const all = Array.from(seen.values())
    .sort((a, b) => a.dist - b.dist)
    .slice(0, topK);
  return all;
}

module.exports = {
  ensureSerialIndex,
  fuzzySerialSuggest,
  norm,
  levenshteinBounded,
};
