/**
 * vectorDbClient.js
 *
 * Thin REST adapter for the EXISTING Synapse C++ VectorDB (HNSW + Cosine).
 *
 * This file does NOT implement any vector search logic. It only calls the
 * real HTTP endpoints already implemented in the C++ server
 * (vectordb_server.cpp). All ANN search, graph maintenance, and distance
 * calculation happens in C++ — Node just sends/receives JSON over HTTP.
 *
 * Endpoints used here were taken directly from the C++ source, not invented:
 *
 *   GET    /stats            -> { count, dims, algorithms, metrics }
 *                                (used as the connectivity/health check —
 *                                 the C++ server has no dedicated /health
 *                                 route, and /stats is the cheapest endpoint
 *                                 that doesn't depend on Ollama being up)
 *   GET    /search?v=&k=     -> { results: [...], latencyUs, algo, metric }
 *   POST   /insert           -> body: { metadata, category, embedding }
 *                                returns: { id }
 *   DELETE /delete/:id       -> { ok: true|false }
 *   GET    /items            -> [ { id, metadata, category, embedding }, ... ]
 *
 * IMPORTANT CONSTRAINT (from the C++ source, not a Node-side choice):
 *   The demo VectorDB is hardcoded to DIMS = 16. Every `embedding` array
 *   sent to /insert or /search MUST be exactly 16 floats, or the C++
 *   server responds with { "error": "need 16D vector" }. This adapter does
 *   not change or work around that — it is a property of the existing
 *   C++ component. See the integration summary for what changes would be
 *   needed on the C++ side to support arbitrary-length risk vectors.
 *
 * Doc/RAG endpoints (/doc/insert, /doc/search, /doc/ask, /status) exist in
 * the C++ server too, but are intentionally NOT wrapped here — RAG
 * integration is a later phase per the current scope.
 */

const VECTORDB_URL = process.env.VECTORDB_URL;

if (!VECTORDB_URL) {
  console.warn('[vectorDbClient] VECTORDB_URL is not set in .env — VectorDB calls will fail.');
}

async function request(path, options = {}) {
  const url = `${VECTORDB_URL}${path}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { 'Content-Type': 'application/json' },
      ...options
    });
  } catch (err) {
    throw new Error(`VectorDB unreachable at ${url}: ${err.message}`);
  }

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`VectorDB returned non-JSON response (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(data.error || `VectorDB request failed with status ${res.status}`);
  }

  return data;
}

/**
 * healthCheck()
 * Calls GET /stats — the closest real endpoint to a health check in the
 * C++ server. Returns { count, dims, algorithms, metrics } on success.
 */
async function healthCheck() {
  return request('/stats');
}

/**
 * insertVector({ metadata, category, embedding })
 * Calls POST /insert. `embedding` MUST be exactly 16 floats (C++ DIMS=16).
 * Returns { id }.
 */
async function insertVector({ metadata, category, embedding }) {
  if (!metadata || !Array.isArray(embedding)) {
    throw new Error('insertVector requires { metadata, embedding }');
  }
  return request('/insert', {
    method: 'POST',
    body: JSON.stringify({ metadata, category: category || '', embedding })
  });
}

/**
 * searchVectors({ vector, k })
 * Calls GET /search?v=<comma-separated floats>&k=<k>.
 * `vector` MUST be exactly 16 floats (C++ DIMS=16).
 * Returns { results, latencyUs, algo, metric }.
 */
async function searchVectors({ vector, k = 5 }) {
  if (!Array.isArray(vector)) {
    throw new Error('searchVectors requires { vector: number[] }');
  }
  const v = vector.join(',');
  return request(`/search?v=${encodeURIComponent(v)}&k=${encodeURIComponent(k)}`);
}

/**
 * deleteVector(id)
 * Calls DELETE /delete/:id. Returns { ok: boolean }.
 */
async function deleteVector(id) {
  if (id === undefined || id === null) {
    throw new Error('deleteVector requires an id');
  }
  return request(`/delete/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/**
 * listVectors()
 * Calls GET /items. Returns the full array of stored demo vectors.
 */
async function listVectors() {
  return request('/items');
}

module.exports = {
  healthCheck,
  insertVector,
  searchVectors,
  deleteVector,
  listVectors
};
