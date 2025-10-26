const axios = require('axios');
const { OLLAMA_URL, EMBEDDING_DIM, REQ_TIMEOUT_MS } = require('./config');

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function withRetry(fn, { retries = 3, baseDelay = 400 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try { return await fn(); }
    catch (err) { lastErr = err; if (i === retries) break; await sleep(baseDelay * Math.pow(2, i)); }
  }
  throw lastErr;
}

function isNumericArray(a) { return Array.isArray(a) && a.length > 0 && typeof a[0] === 'number'; }

async function embedTextsRobust(texts, { model, concurrency = 1, timeoutMs = REQ_TIMEOUT_MS } = {}) {
  const inputs = (Array.isArray(texts) ? texts : [texts]).map(t => String(t || 'n/a'));
  const out = new Array(inputs.length);

  let idx = 0, active = 0;
  return await new Promise((resolve) => {
    const next = () => {
      while (active < concurrency && idx < inputs.length) {
        const myIndex = idx++;
        const txt = inputs[myIndex];
        active++;

        withRetry(async () => {
          const { data } = await axios.post(
            `${OLLAMA_URL}/api/embeddings`,
            { model, prompt: txt },
            { timeout: timeoutMs }
          );
          const vec = data?.embedding ?? data?.embeddings ?? data?.data?.[0]?.embedding ?? null;
          if (!isNumericArray(vec)) throw new Error(`Embeddings inválidos para text="${txt.slice(0,120)}"`);
          if (vec.length !== EMBEDDING_DIM) throw new Error(`Dim mismatch: expected ${EMBEDDING_DIM}, got ${vec.length}`);
          return vec.map(Number);
        }, { retries: 3, baseDelay: 300 })
          .then((vec) => { out[myIndex] = { ok: true, vec }; })
          .catch((err)  => { out[myIndex] = { ok: false, error: String(err?.message || err) }; })
          .finally(() => {
            active--;
            if (out.filter(Boolean).length === inputs.length) resolve(out); else next();
          });
      }
    };
    next();
  });
}

module.exports = { embedTextsRobust };