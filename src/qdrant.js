const axios = require('axios');
const { QDRANT_URL, REQ_TIMEOUT_MS, EMBEDDING_DIM } = require('./config');

async function ensureCollection(dim = EMBEDDING_DIM, name = 'inventories_v1') {
  try {
    await axios.put(`${QDRANT_URL}/collections/${name}`, {
      vectors: { size: dim, distance: 'Cosine' }
    }, { timeout: REQ_TIMEOUT_MS });
  } catch (e) {
    if (e?.response?.status !== 409) throw e;
  }
}

async function ensurePayloadIndexes(name = 'inventories_v1') {
  const fields = [
    { field_name: 'brandName',     field_schema: 'keyword' },
    { field_name: 'typeName',      field_schema: 'keyword' },
    { field_name: 'status',        field_schema: 'keyword' },
    { field_name: 'serialNumber',  field_schema: 'keyword' },
    { field_name: 'activeNumber',  field_schema: 'keyword' },
  ];
  for (const f of fields) {
    try { await axios.post(`${QDRANT_URL}/collections/${name}/indexes/create`, f, { timeout: REQ_TIMEOUT_MS }); }
    catch (e) { if (e?.response?.status !== 409) throw e; }
  }
}

function coercePointId(id) {
  if (typeof id === 'number' && Number.isInteger(id) && id >= 0) return id;
  if (typeof id === 'string') {
    if (/^\d+$/.test(id)) { const n = Number(id); if (Number.isInteger(n) && n >= 0) return n; }
    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/.test(id)) return id;
  }
  throw new Error(`Invalid point id for Qdrant. Must be unsigned integer or UUID. Got: ${JSON.stringify(id)}`);
}

async function upsertPoints(points, name = 'inventories_v1') {
  if (!Array.isArray(points) || !points.length) return;

  const cleanPoints = points.map((p) => {
    const qId = coercePointId(p.id);
    if (!Array.isArray(p.vector)) throw new Error(`Vector no es array para id=${JSON.stringify(p.id)}`);
    const len = p.vector.length;
    if (len !== EMBEDDING_DIM) throw new Error(`Dim mismatch para id=${JSON.stringify(p.id)}: expected ${EMBEDDING_DIM}, got ${len}`);

    const vec = p.vector.map((x) => {
      const v = typeof x === 'number' ? x : Number.parseFloat(String(x));
      return Number.isFinite(v) ? v : 0.0;
    });

    const payload = {};
    for (const [k, v] of Object.entries(p.payload || {})) {
      payload[k] = (v instanceof Date) ? v.toISOString() : v;
    }
    return { id: qId, vector: vec, payload };
  });

  await axios.put(`${QDRANT_URL}/collections/${name}/points?wait=true`, { points: cleanPoints }, { timeout: REQ_TIMEOUT_MS });
}

async function searchSimilar(vector, { topK = 10, name = 'inventories_v1', filter } = {}) {
  try {
    const { data } = await axios.post(
      `${QDRANT_URL}/collections/${name}/points/search`,
      { vector, limit: topK, with_payload: true, with_vector: false, filter },
      { timeout: REQ_TIMEOUT_MS }
    );
    return data?.result ?? [];
  } catch (e) {
    if (e?.response?.status === 404 || e?.response?.status === 400) return [];
    throw e;
  }
}

module.exports = { ensureCollection, ensurePayloadIndexes, upsertPoints, searchSimilar };