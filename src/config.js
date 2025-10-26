const PORT = +(process.env.PORT || 4010);
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const QDRANT_URL = process.env.QDRANT_URL || 'http://127.0.0.1:6333';
const CHAT_MODEL = process.env.CHAT_MODEL || 'llama3.2:3b';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_DIM = +(process.env.EMBEDDING_DIM || 768);
const REQ_TIMEOUT_MS = +(process.env.REQUEST_TIMEOUT_MS || 300000);
const DEFAULT_PAGE_SIZE = +(process.env.INGEST_LIMIT || 100);
const DEFAULT_UPSERT_CHUNK = +(process.env.UPSERT_CHUNK || 50);
const DEFAULT_EMBED_CONCURRENCY = +(process.env.EMBED_CONCURRENCY || 3);

module.exports = {
  PORT, OLLAMA_URL, QDRANT_URL, CHAT_MODEL, EMBEDDING_MODEL, EMBEDDING_DIM,
  REQ_TIMEOUT_MS, DEFAULT_PAGE_SIZE, DEFAULT_UPSERT_CHUNK, DEFAULT_EMBED_CONCURRENCY
};