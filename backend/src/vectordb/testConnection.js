/**
 * testConnection.js
 *
 * Verifies the full chain:
 *   Node.js -> VectorDB REST API -> C++ VectorDB (HNSW + Cosine) -> result -> Node.js
 *
 * Run with:
 *   cd backend
 *   node src/vectordb/testConnection.js
 *
 * Requires the C++ VectorDB server to already be running (see README) and
 * VECTORDB_URL to be set in backend/.env.
 */

require('dotenv').config();
const { healthCheck, insertVector, searchVectors } = require('./vectorDbClient');

async function main() {
  console.log(`Target VectorDB: ${process.env.VECTORDB_URL || '(VECTORDB_URL not set)'}`);

  // 1. Health check (GET /stats)
  console.log('\n[1/3] Health check (GET /stats)...');
  const stats = await healthCheck();
  console.log('  OK:', stats);

  // 2. Insert a 16D test vector (C++ demo VectorDB is hardcoded to DIMS=16)
  console.log('\n[2/3] Inserting a test vector (POST /insert)...');
  const testEmbedding = [
    0.86, 0.81, 0.74, 0.70, 0.14, 0.10, 0.09, 0.11,
    0.06, 0.07, 0.08, 0.06, 0.08, 0.09, 0.07, 0.08
  ]; // deliberately close to the existing "cs" category demo vectors
  const inserted = await insertVector({
    metadata: 'PayShield connectivity test vector',
    category: 'test',
    embedding: testEmbedding
  });
  console.log('  OK, inserted id:', inserted.id);

  // 3. Search for nearest neighbors of that same vector
  console.log('\n[3/3] Searching (GET /search)...');
  const results = await searchVectors({ vector: testEmbedding, k: 3 });
  console.log(`  OK, algo=${results.algo} metric=${results.metric} latencyUs=${results.latencyUs}`);
  results.results.forEach((r, i) => {
    console.log(`  #${i + 1} id=${r.id} category=${r.category} distance=${r.distance.toFixed(4)} :: ${r.metadata}`);
  });

  console.log('\nConnection verified: Node -> REST -> C++ VectorDB -> Node.');
}

main().catch((err) => {
  console.error('\nConnection test FAILED:', err.message);
  console.error('Check that the C++ VectorDB is running and VECTORDB_URL is correct in backend/.env');
  process.exit(1);
});
