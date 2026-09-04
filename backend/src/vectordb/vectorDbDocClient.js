/**
 * vectorDbDocClient.js
 *
 * Thin REST adapter over the /doc/* endpoints of the SAME existing Synapse
 * C++ VectorDB used elsewhere in PayShield (see vectorDbClient.js for the
 * demo 16D vector endpoints). Chunking, embedding (via Ollama), and HNSW
 * retrieval for policy documents all happen inside the C++ server — this
 * file does not reimplement any of that, it only calls the real endpoints:
 *
 *   POST /doc/insert  { title, text, document, section, page }
 *        -> { ids, chunks, dims }
 *   POST /doc/search  { question, k }
 *        -> { contexts: [{ id, chunkId, title, document, section, page,
 *                           text, distance }] }
 *
 * No hybrid search or CRAG exists in the underlying C++ server (confirmed
 * by inspection), so this adapter does not claim to offer it — retrieval
 * here is single-pass HNSW + cosine similarity, same as the rest of the
 * VectorDB.
 */

const VECTORDB_URL = process.env.VECTORDB_URL;

async function request(path, options = {}) {
  if (!VECTORDB_URL) {
    throw new Error('VECTORDB_URL is not configured');
  }
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

  if (!res.ok || data.error) {
    throw new Error(data.error || `VectorDB request failed with status ${res.status}`);
  }

  return data;
}

/**
 * insertPolicyChunk({ title, text, document, section, page })
 * Calls POST /doc/insert. The C++ server itself splits `text` into
 * sub-chunks if it's long; every sub-chunk inherits the same
 * document/section/page metadata passed here.
 */
async function insertPolicyChunk({ title, text, document, section = '', page = 0 }) {
  if (!title || !text) {
    throw new Error('insertPolicyChunk requires { title, text }');
  }
  return request('/doc/insert', {
    method: 'POST',
    body: JSON.stringify({ title, text, document: document || title, section, page })
  });
}

/**
 * searchPolicyChunks(question, k)
 * Calls POST /doc/search. Returns the raw `contexts` array — each entry
 * has real, stored metadata (document/section/page/chunkId/text/distance).
 * Nothing here is invented; if the VectorDB has no relevant chunks it
 * returns an empty array, which callers must treat as "no evidence found",
 * not silently ignore.
 */
async function searchPolicyChunks(question, k = 4) {
  if (!question) {
    throw new Error('searchPolicyChunks requires a question string');
  }
  const result = await request('/doc/search', {
    method: 'POST',
    body: JSON.stringify({ question, k })
  });
  return result.contexts || [];
}

module.exports = { insertPolicyChunk, searchPolicyChunks };
