const axios = require('axios');
const { OLLAMA_URL, CHAT_MODEL, REQ_TIMEOUT_MS } = require('./config');

async function generateWithLLM(prompt) {
  const { data } = await axios.post(`${OLLAMA_URL}/api/generate`, {
    model: CHAT_MODEL, prompt, stream: false
  }, { timeout: REQ_TIMEOUT_MS });
  return (data?.response || '').trim();
}

async function rerankWithLLM(query, items, { topN = 12 } = {}) {
  if (!items?.length) return [];
  const sample = items.slice(0, topN).map((x, i) => ({
    idx: i,
    id: x.id,
    text: `${x.brandName ?? ''} ${x.modelName ?? ''} [${x.typeName ?? ''}] SN:${x.serialNumber ?? ''} ST:${x.status ?? ''}`.trim()
  }));

  const prompt = `Eres un reranker. Dada la consulta y una lista, asigna un score (0..1) según relevancia.
Devuelve SOLO JSON con: [{"idx":<n>,"score":<float>}, ...] en el mismo orden de idx.

Consulta: ${query}

Lista:
${sample.map(s => `${s.idx}. ${s.text}`).join('\n')}
JSON:`;

  try {
    const text = await generateWithLLM(prompt);
    const parsed = JSON.parse(text);
    const scores = new Map(parsed.map(r => [r.idx, Number(r.score) || 0]));
    const ranked = sample
      .map(s => ({ ...items[s.idx], llmScore: scores.get(s.idx) ?? 0 }))
      .sort((a,b) => (b.llmScore - a.llmScore) || 0);
    return ranked.concat(items.slice(topN));
  } catch (_e) {
    return items;
  }
}

module.exports = { rerankWithLLM, generateWithLLM };