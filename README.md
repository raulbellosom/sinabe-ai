# AI API Hybrid (Qdrant + MySQL + LLM Rerank)

Backend de búsqueda inteligente para Sinabe:
- Frontend envía **solo `q`**
- El servidor deduce filtros implícitos, hace **búsqueda híbrida** (Qdrant + MySQL),
  aplica **RRF** + **re-ranking** con LLM, y soporta **fuzzy** de serial.

## Endpoints

- `POST /ingest`
  - Ingesta inventories con joins correctos a Qdrant, crea índices de payload.
  - Body opcional: `{ collection, dim, pageSize, embedConcurrency, upsertChunk, maxPages }`

- `POST /search/hybrid`
  - Body `{ q, topK, collection }`
  - Respuesta:
    - `mode: "hybrid"` con `results` (ordenados)
    - o `mode: "serial-exact"` / `mode: "serial-fuzzy"` con `suggestions`

- `POST /models/specs`
  - Body `{ id }`
  - Devuelve `specs` generadas por LLM para brand+model del registro.

## Variables de entorno
Ver `.env.example`. Copia a `.env` y ajusta.

## MySQL (opcional)
Puedes añadir índices/FULLTEXT a tus tablas para acelerar LIKE/MATCH.
Ejemplo mínimo:
```sql
ALTER TABLE Inventory ADD INDEX idx_status (status);
```

## Arranque
```bash
npm i
npm run start
```

O en Docker un contenedor que monte esta carpeta y exponga 4010,
conectado a tus servicios de `ollama` y `qdrant`.