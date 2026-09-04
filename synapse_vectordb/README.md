# Synapse VectorDB setup

The server uses the single-header `cpp-httplib` library. The header is intentionally not committed as generated build output.

## Windows with MinGW

From this directory in PowerShell:

```powershell
Invoke-WebRequest `
  -Uri "https://raw.githubusercontent.com/yhirose/cpp-httplib/master/httplib.h" `
  -OutFile "httplib.h"
g++ -O2 -std=c++17 vectordb_server.cpp -lws2_32 -o vectordb_server.exe
.\vectordb_server.exe
```

The service listens on `http://localhost:8080`. Keep `VECTORDB_URL=http://localhost:8080` in `backend/.env`.

The header is ignored by the repository so it can be refreshed without creating a large vendored diff.

## RAG embedding model

Policy ingestion and policy search use Ollama through the C++ server:

- Embedding model: `nomic-embed-text`
- Ollama endpoint: `http://127.0.0.1:11434/api/embeddings`
- Document vector dimensions: determined at runtime from the model's returned
  embedding. With the standard `nomic-embed-text` model this is typically 768;
  confirm the exact value from `GET /status` as `docDims` after the first policy
  document is ingested.
- Similarity: cosine distance with HNSW retrieval. No alternate distance metric
  or index is exposed by this service.
- Chunking: 250 words per chunk with 30 words overlap.

The demo `/insert` and `/search` endpoints are different from policy RAG and are
fixed at `DIMS = 16`. Policy document embeddings are not forced into 16 dimensions.

Gemini is not used to create vectors. The sequence is:

```text
PDF text -> C++ chunker -> Ollama nomic-embed-text -> document vector -> HNSW
question -> Ollama nomic-embed-text -> query vector -> HNSW search -> Gemini explanation (optional)
```

Without Ollama, policy insertion and policy search cannot create embeddings. Without
Gemini, VectorDB can still retrieve policy chunks, but the Node policy agent returns
a degraded result and preserves the retrieved citations.

## Native deployment without Docker

Vercel cannot run this C++ process or Ollama as a persistent service. Host both on a
Linux VPS or another native process host, because the C++ source currently connects
to Ollama at `127.0.0.1:11434`. A single Ubuntu VPS is the simplest arrangement:

```bash
sudo apt update
sudo apt install -y g++ curl
curl -fsSL https://ollama.com/install.sh | sh
ollama pull nomic-embed-text
sudo systemctl enable --now ollama
```

Copy `vectordb_server.cpp` and `httplib.h` to the VPS, compile, and run:

```bash
g++ -O2 -std=c++17 vectordb_server.cpp -pthread -o vectordb_server
./vectordb_server
```

Put the VPS HTTPS URL in the Vercel backend environment as `VECTORDB_URL`. Do not
expose port 8080 directly without an HTTPS reverse proxy and access control. After
the service is reachable, run `npm run ingest-policies` from a machine whose
`VECTORDB_URL` points to that public URL. Check `GET /status` and confirm `docDims`
is non-zero before using policy search.

Policy vectors are persisted in `policy_vectors.bin` beside the server executable.
The file stores policy text, source metadata, embeddings, and IDs; the HNSW index is
rebuilt automatically when the process starts. Keep this file on persistent disk
and back it up with the service. If the file is lost or corrupted, re-run
`npm run ingest-policies`.
