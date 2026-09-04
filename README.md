# PayShield

**Agentic AI Payment Risk Manager — defense-only, deterministic-decision, human-in-the-loop.**

## Defense-only statement

PayShield is a **defense-only** system. It analyzes payment risk, detects suspicious
behavior, retrieves risk policies, generates risk signals, and recommends
APPROVE / REVIEW_REQUIRED / BLOCK_RECOMMENDED — always with a human able to review and
override. It never attacks systems, exploits vulnerabilities, bypasses payment
controls, steals credentials, performs unauthorized transactions, executes offensive
security operations, or automatically moves money or performs any irreversible
financial action. No code path in this repository — including the Razorpay webhook and
the human-review endpoints — calls a payment execution, capture, or transfer API.
**NO LIVE MONEY IS USED anywhere in this project.**

---

## Problem Statement

Payment platforms process transactions in real time and have to decide, in
milliseconds to seconds, whether a given transaction is safe to approve. Getting this
wrong in either direction is expensive: approving fraud costs the platform (and its
merchants and users) real money, while blocking legitimate customers — a false
positive — costs revenue, trust, and support overhead. A workable risk engine has to
combine several kinds of signal (transaction-level fraud patterns, the specific user's
historical behavior, the device/location context, and the organization's own written
risk policy) and turn them into one auditable, explainable decision, without letting
any single component (especially a probabilistic LLM) unilaterally decide to move
money.

## Solution

PayShield scores every transaction with four independent, bounded agents — fraud,
behavior, device, and policy — and combines their scores with a **fixed, deterministic
formula** into one of three recommendations. Three of the four agents are plain
rule-based JavaScript (deterministic, reproducible, fast). The fourth, the policy
agent, retrieves relevant excerpts from the organization's actual policy documents
using the existing Synapse RAG pipeline (C++ VectorDB + Gemini) and asks Gemini to
*interpret* that evidence — Gemini explains and scores, it never decides. Every
transaction's lifecycle is tracked through an explicit state machine, every step is
audit-logged to MongoDB, and any transaction that lands in REVIEW_REQUIRED or
BLOCK_RECOMMENDED waits for a human decision before anything is considered final.

## Architecture

```
React (dashboard, evaluation view)
        v  fetch (VITE_API_URL or Vite dev proxy)
Node.js + Express
        v
   MongoDB (Transaction, User, Merchant, RiskAssessment, Review, AuditLog,
            ProcessedWebhookEvent)
        v
   Risk Engine (backend/src/services/riskOrchestrator.js)
        v
   4 bounded agents (backend/src/agents/)
        |
        +-- fraudAgent      (deterministic, rule-based)
        +-- behaviorAgent   (deterministic, rule-based)
        +-- deviceAgent     (deterministic, rule-based)
        +-- policyAgent     --> Synapse RAG (POST /doc/search)
                                       v
                              C++ VectorDB (HNSW + Cosine)
                                       v
                              retrieved policy chunks + metadata
                                       v
                                   Gemini (reasoning only)
                                       v
                              validated structured signal + citations
        v
   Deterministic Decision Engine (backend/src/risk/decisionEngine.js)
   riskScore = 0.35*fraud + 0.30*behavior + 0.15*device + 0.20*policy
        v
   State Machine (backend/src/risk/stateMachine.js)
        v
   APPROVED | REVIEW_REQUIRED | BLOCK_RECOMMENDED
        v
   Human-In-The-Loop (backend/src/controllers/reviewController.js)
        v
   AuditLog (every step, queryable via GET /api/audit/:transactionId)
```

### Transaction amount policy

The amount policy is enforced by the deterministic decision engine on every
transaction intake path, while the agent scores remain available for reasons,
signals, and audit history:

- Up to and including ₹1,00,000: the composite risk score decides.
- Above ₹1,00,000 through ₹5,00,000: at least `REVIEW_REQUIRED`; high risk can still produce `BLOCK_RECOMMENDED`.
- Above ₹5,00,000: `BLOCK_RECOMMENDED`.

These are recommendations in this defense-only MVP; they do not capture,
refund, transfer, or otherwise move money.

Transactions enter either synthetically (`POST /api/transactions`, **DEMO_MODE**) or
via a signed Razorpay **TEST MODE** webhook (`POST /api/webhooks/razorpay`,
**RAZORPAY_TEST_MODE**) - both paths converge on the same
`POST /api/risk/assess` -> `riskOrchestrator.js` pipeline. See "Razorpay Test Mode"
below.

Manual transactions accept sender and receiver names, automatically derive stable
profile IDs, and create a minimal user and merchant profile on first use. Existing
profiles are preserved on later transactions. A transaction always stores its
matching `userId` and `merchantId`.
`GET /api/profiles/users/:userId/history` returns the complete persisted history
for one user; the dashboard displays those transactions together in one user card.

The dashboard requires registration or login. Registration stores only a bcrypt
password hash and returns a short-lived JWT. The authenticated transaction form
uses the logged-in user's `userId`; when a new merchant ID is submitted, a minimal
merchant profile is created and can later be enriched through the profile API.
The History navigation view reads the persisted transaction collection and groups
all records by user. Configure a long random `JWT_SECRET` in every deployment.
For local non-production development, a built-in development-only secret is used
when `JWT_SECRET` is absent; production still fails closed until `JWT_SECRET` is set.

## Why Custom VectorDB

PayShield uses an existing, self-written C++ vector database (`synapse_vectordb/`)
rather than Pinecone, ChromaDB, or another managed vector store. It implements:

- **HNSW** (Hierarchical Navigable Small World) - the graph-based approximate nearest
  neighbor index actually used for retrieval in this project.
- **Cosine similarity** as the distance metric for both the demo vector endpoints and
  the policy-document RAG endpoints.
- A REST layer (`cpp-httplib`) exposing `/insert`, `/search`, `/delete/:id`, `/items`,
  `/hnsw-info`, and the document/RAG endpoints `/doc/insert`, `/doc/search`,
  `/doc/ask`, `/doc/list`.

Only HNSW and cosine distance are exposed. No alternate index or distance metric is
used by the service. Node.js contains zero ANN or graph code; `backend/src/vectordb/`
is a thin REST client. Policy vectors are persisted in `policy_vectors.bin` by the
separate C++ service.

## AI Safety

- **Bounded agents** - `fraudAgent.js`, `behaviorAgent.js`, `deviceAgent.js`, and
  `policyAgent.js` each carry an explicit CAN/CANNOT header comment. None of them can
  execute a payment, modify a transaction, delete data, or approve/block anything -
  every agent returns `{ riskScore, confidence, reasons, signals, citations }` and
  nothing else. `policyAgent.js` additionally cannot modify policies or delete vectors
  - it only calls `/doc/search`, never `/doc/insert` or `/doc/delete`.
- **Structured output validation** - every field Gemini returns is type/range-checked
  by `backend/src/services/llmOutputValidator.js` before it's allowed anywhere near
  the decision engine. Out-of-range or missing fields are a hard rejection (logged as
  `LLM_FAILURE` with the validation errors attached), never silently clamped or
  coerced into range.
- **Deterministic decision engine** - `backend/src/risk/decisionEngine.js` is the
  *only* place in the codebase that produces APPROVED / REVIEW_REQUIRED /
  BLOCK_RECOMMENDED, and it's a plain weighted-sum function with fixed thresholds. No
  LLM call happens inside it. Gemini's JSON schema has no decision field at all -
  structurally, not just by prompt instruction, Gemini cannot decide.
- **State machine** - `backend/src/risk/stateMachine.js` is a small, dependency-free
  transition table (no LangGraph, no agent framework). Invalid transitions throw and
  are audit-logged as `INVALID_STATE_TRANSITION` rather than silently succeeding.
- **Human review** - any transaction that lands in `REVIEW_REQUIRED` or
  `BLOCK_RECOMMENDED` requires an authenticated reviewer decision before it is
  considered final. Nothing in the review endpoint calls a payment API.
- **Defense-only design** - see the statement at the top of this file. It is not just
  a policy statement; it's structurally true of the code, since there is no
  payment-execution client anywhere in this repository.

## Evaluation

`backend/src/evaluation/generateDataset.js` produces a **reproducible synthetic
dataset** (fixed PRNG seed `20260822`, no real financial data) of 220 fictional
transactions across 8 categories (legit, high-value, new-device, location anomaly,
unusual-time, velocity, multi-anomaly, ambiguous), split **80% dev / 20% held-out
test**. The dev split exists so thresholds *could* be tuned against it; **the held-out
test split is never used for tuning** - `evaluationEngine.js` only ever scores the
test split. `GET /api/evaluation` runs the **real** `fraudAgent`/`behaviorAgent`/
`deviceAgent`/`decisionEngine` (not mocked - see "Known limitations" for why
`policyRisk` uses a deterministic proxy in evaluation specifically) against the test
split and computes:

- **Precision** = TP / (TP + FP)
- **Recall** = TP / (TP + FN)
- **F1** = 2*Precision*Recall / (Precision + Recall)
- **False Positive Rate** = FP / (FP + TN)
- **False Positive Cost** = FP x `FALSE_POSITIVE_COST` - a **demo business cost
  assumption**, not a real Razorpay or industry figure, clearly labeled as such in
  both the API response and the Evaluation UI tab.

None of these numbers are hardcoded; they're recomputed from `dataset.json` on every
`GET /api/evaluation` call. See "Known limitations" for the actual numbers from a real
run and what they reveal about the specified formula.

## Failure Handling

Three required graceful-failure scenarios, all implemented in `policyAgent.js`, all
audit-logged, all returning a schema-valid non-fabricated result instead of crashing:

| Scenario | Audit event | Result |
|---|---|---|
| Gemini unavailable | `LLM_FAILURE` | `riskScore:0, confidence:0, citations:[], degraded:true` |
| C++ VectorDB unavailable | `VECTORDB_FAILURE` | same safe fallback, no fabricated policy evidence |
| RAG returns no reliable evidence | `RAG_NO_EVIDENCE` | `citations:[]`, no fabricated reasoning |
| Gemini returns malformed/out-of-range JSON | `LLM_FAILURE` (with validator errors) | rejected by `llmOutputValidator.js`, safe fallback |
| Invalid state transition attempted | `INVALID_STATE_TRANSITION` | rejected, transaction moves to `FAILED` |

In `riskOrchestrator.js`, a **safety floor** applies: if the deterministic formula
would compute `APPROVED` but the policy agent degraded (any of the four scenarios
above), the transaction is forced to `REVIEW_REQUIRED` instead - a degraded agent
never silently produces a clean approval.

A **controlled failure demo** (no real outage required) is built into both the API and
the UI: `POST /api/risk/assess` (and its alias `POST /api/risk/analyze/:transactionId`)
accepts an optional `simulateFailure` field - `"VECTORDB_FAILURE"`, `"LLM_FAILURE"`, or
`"RAG_NO_EVIDENCE"` - which makes `policyAgent.js` take the *exact same* safe-fallback
code path a real failure would, so the audit trail and UI are the real mechanism, not a
mocked-up screen. The dashboard's transaction detail view has three buttons for this
under "Failure demo". When triggered, the UI shows: *"Risk analysis could not obtain
reliable evidence. The transaction is not silently approved. Manual review is
required."*

## Razorpay Test Mode

Razorpay integration is implemented, **TEST MODE ONLY**, and is fully optional - the
core PayShield demo works with zero Razorpay configuration (`DEMO_MODE=true` is the
default). **No live payments, no real money movement, nothing offensive.**

- **Test Mode**: enabled by setting `RAZORPAY_TEST_MODE=true` plus
  `RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET`/`RAZORPAY_WEBHOOK_SECRET` in `backend/.env`
  (Test Mode credentials from your Razorpay dashboard - never live keys). None of these
  are ever sent to or used from the React frontend.
- **Webhook**: `POST /api/webhooks/razorpay` receives `payment.captured` events, builds
  a `Transaction` from `payload.payment.entity`, and runs it through the exact same
  `riskOrchestrator.js` pipeline as everything else.
- **Signature verification**: `backend/src/payments/razorpaySignature.js` recomputes
  the HMAC-SHA256 of the **raw** request body (captured via `express.json()`'s
  `verify` callback in `server.js`, since Razorpay's signature is computed over exact
  bytes, not a re-serialized object) using `RAZORPAY_WEBHOOK_SECRET`, and compares it
  to the `X-Razorpay-Signature` header in constant time
  (`crypto.timingSafeEqual`). An invalid signature is rejected with 400 **before**
  any transaction is touched, and logs a `WEBHOOK_SIGNATURE_INVALID` audit event -
  never the secret, the signature, or the payload itself.
- **Idempotency**: `backend/src/models/ProcessedWebhookEvent.js` has a unique index on
  `eventId` (from the `X-Razorpay-Event-Id` header, with a deterministic fallback
  derived from the payment id + event type if that header is absent). A duplicate
  delivery hits a Mongo duplicate-key error and is safely ignored - **no Redis, no
  other cache, MongoDB is the idempotency store**, per the constraint.
- **Synthetic fallback**: `DEMO_MODE` and `RAZORPAY_TEST_MODE` are independent flags
  (`backend/src/payments/modeConfig.js`) - synthetic transactions via
  `POST /api/transactions` keep working even when Razorpay Test Mode is fully
  configured, and the whole system works with zero Razorpay setup at all. The active
  mode is shown in the dashboard header and returned by `GET /api/health`.

**NO LIVE MONEY IS USED.** This integration never calls Razorpay's payment capture,
refund, or transfer APIs - it only *receives* test-mode webhook notifications and
*recommends* a risk decision.

## Setup

### Local service prerequisites

The backend requires a MongoDB connection. Use a local MongoDB installation or a
MongoDB Atlas cluster and set `MONGODB_URI` in `backend/.env`.

For a quick local preview without installing MongoDB, the backend automatically
starts a temporary in-memory MongoDB when `NODE_ENV` is not `production`. Data is
cleared when the backend stops. Set `USE_IN_MEMORY_DB=false` to require a real
local MongoDB connection.

For the optional C++ VectorDB dependency and Windows/MinGW commands, see
`../synapse_vectordb/README.md`. Policy analysis degrades safely when VectorDB is
not configured, so it is not required to bring up the dashboard.

```bash
# 1. Configure and start the backend
cd backend
cp .env.example .env                  # fill in MONGODB_URI, GEMINI_API_KEY, etc.
npm install

# (optional) seed sample users/merchants, ingest the 4 demo policy PDFs,
# and generate the reproducible evaluation dataset
npm run seed
npm run ingest-policies
npm run generate-dataset

npm run dev                           # -> http://localhost:5000

# 2. Start the frontend in a second terminal
cd ../frontend
cp .env.example .env
npm install
npm run dev                           # -> http://localhost:5173
```

When `MONGODB_URI` is empty in local development, the backend starts a temporary
MongoDB automatically through `mongodb-memory-server`. This is for preview and
testing only; data disappears when the process stops. A production deployment must
use MongoDB Atlas or another reachable MongoDB service.

### Gemini API key location

Put the key only in the backend environment:

```text
riskguard/backend/.env
GEMINI_API_KEY=your_gemini_key
```

For Vercel, add `GEMINI_API_KEY` under the backend project's Environment Variables.
Never add it to `frontend/.env`, `VITE_API_URL`, or any `VITE_*` variable. RAG
retrieval is performed by VectorDB; Gemini only interprets the retrieved policy
chunks. If Gemini is missing, the API returns a degraded result with the real
retrieved citations and requires human review.

Gemini is optional for the core dashboard and deterministic risk decision. It is
required only when the policy agent must interpret retrieved policy chunks.
VectorDB retrieves evidence first; Gemini interprets that evidence second. If
either service is unavailable, the system uses the safe degraded path and does not
invent policy evidence.

Nothing in this project hardcodes `localhost`/`127.0.0.1` outside of `.env.example`
defaults meant for local development. Every service-to-service URL is an environment
variable:

| Component | Variable | Local default | Production |
|---|---|---|---|
| Frontend -> Backend | `VITE_API_URL` | empty (uses Vite proxy) | `https://your-backend.example.com` |
| Backend -> MongoDB | `MONGODB_URI` | `mongodb://127.0.0.1:27017/payshield` | your Atlas/hosted connection string |
| Backend -> C++ VectorDB | `VECTORDB_URL` | `http://localhost:8080` | wherever the VectorDB binary/container is deployed |
| Backend CORS | `FRONTEND_URL` | `http://localhost:5173` | your deployed frontend's real origin |

The backend's CORS middleware (`server.js`) is configured with `origin: FRONTEND_URL`
- it does **not** use a wildcard `Access-Control-Allow-Origin: *`.

---

## Environment variables

**`backend/.env`** (see `backend/.env.example` for the full annotated version):

```
PORT=
MONGODB_URI=
NODE_ENV=production
FRONTEND_URL=
VECTORDB_URL=
GEMINI_API_KEY=
GEMINI_MODEL=
JWT_SECRET=                 # required in production; long random value
FALSE_POSITIVE_COST=
DEMO_MODE=
RAZORPAY_TEST_MODE=
RAZORPAY_KEY_ID=            # optional, TEST MODE only
RAZORPAY_KEY_SECRET=        # optional, TEST MODE only
RAZORPAY_WEBHOOK_SECRET=    # optional, TEST MODE only
USE_IN_MEMORY_DB=false      # local development only; never use for deployment
```

**`frontend/.env`** (see `frontend/.env.example`):

```
VITE_API_URL=
VITE_APP_MODE=
```

### Environment variable reference

Backend variables belong in `backend/.env` locally or in the backend Vercel project.
Frontend variables belong in `frontend/.env` locally or in the frontend Vercel project.

| Variable | Where | Required in Vercel | Purpose |
|---|---|---:|---|
| `MONGODB_URI` | Backend | Yes | MongoDB Atlas connection string |
| `FRONTEND_URL` | Backend | Yes | Exact deployed frontend origin for CORS |
| `NODE_ENV` | Backend | Recommended | Set to `production` on deployment |
| `JWT_SECRET` | Backend | Yes | Signs 8-hour authentication tokens |
| `GEMINI_API_KEY` | Backend | Optional | Gemini policy interpretation |
| `GEMINI_MODEL` | Backend | Optional | Defaults to `gemini-2.0-flash` |
| `VECTORDB_URL` | Backend | Optional | Public URL of separately hosted C++ VectorDB |
| `DEMO_MODE` | Backend | Optional | Defaults to enabled unless set to `false` |
| `FALSE_POSITIVE_COST` | Backend | Optional | Evaluation demo cost assumption |
| `RAZORPAY_TEST_MODE` | Backend | Optional | Enable Razorpay test webhooks only |
| `RAZORPAY_KEY_ID` | Backend | Optional | Razorpay test credential |
| `RAZORPAY_KEY_SECRET` | Backend | Optional | Razorpay test credential |
| `RAZORPAY_WEBHOOK_SECRET` | Backend | Optional | Razorpay test webhook verification |
| `USE_IN_MEMORY_DB` | Backend | No | Local-only fallback; do not enable in production |
| `VITE_API_URL` | Frontend | Yes | Backend Vercel URL, without a trailing `/api` |
| `VITE_APP_MODE` | Frontend | Optional | Display-only frontend mode value |

Never expose backend variables through `VITE_*`; Vite embeds those values into the
browser bundle.

## Understanding the Evaluation page

The Evaluation page is now a live **Risk Intelligence** view rather than a confusion
matrix. It explains the actual operating model used by each transaction:

- **Risk thresholds:** `0–30` is `APPROVE`, `31–70` is `REVIEW_REQUIRED`, and
  `71–100` is `BLOCK_RECOMMENDED`. Amounts above ₹1,00,000 receive a review floor
  and amounts above ₹5,00,000 receive a block floor.
- **Final score:** `35% fraud + 30% behavior + 15% device + 20% policy`.
- **Control flow:** intake -> four bounded signals -> deterministic decision engine
  -> human review for review/block recommendations.
- **User transaction patterns:** live transactions are grouped by `userId`. Each
  user card shows all of that user's transactions, amount movement relative to that
  user's largest transaction, and the current transaction status. A sharp bar jump
  makes behavior such as `₹2,000` followed by `₹1 crore` visible immediately.
- **Transaction detail timeline:** the compact lifecycle timeline shows the useful
  states for an operator: received, validated, analyzing, risk assessed, decision,
  and human decision. Internal audit events remain available through the audit API,
  but the verbose raw event list is intentionally not shown in the main UI.

This live view uses MongoDB transaction data. The older held-out synthetic evaluation
engine remains available through `GET /api/evaluation` for programmatic precision,
recall, F1, and false-positive analysis, but those aggregate metrics are no longer
shown as the main Evaluation page.

`.gitignore` (both `backend/` and `frontend/`, and the repo root) excludes `.env`,
`.env.*` (with `.env.example` explicitly un-ignored), `node_modules/`, `dist/`,
`build/`, `logs/`, and `*.log`. No API keys, MongoDB credentials, Razorpay secrets, or
Gemini keys are committed anywhere in this repository - every secret-shaped value in
the codebase is a `process.env.X` reference.

---

## Final API documentation

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Backend + MongoDB + VectorDB health, current mode |
| POST | `/api/transactions` | Create a transaction from sender/receiver names, auto-create profiles, and run the rule-based risk check |
| GET | `/api/transactions` | List all transactions |
| GET | `/api/transactions/:id` | Get one transaction |
| POST | `/api/risk/assess` | Run the full guardrail pipeline (agents -> RAG -> Gemini -> decision engine -> state machine -> audit) for an existing transaction |
| POST | `/api/risk/analyze/:transactionId` | Alias of the above, transactionId in the path |
| GET | `/api/risk/summary/stats` | Dashboard aggregate counts (total/approved/review/blocked/high-risk) |
| GET | `/api/risk/:transactionId` | Get the persisted RiskAssessment for a transaction |
| POST | `/api/review` | Authenticated human review decision (APPROVE/BLOCK) |
| GET | `/api/audit/:transactionId` | Full audit/timeline for a transaction |
| GET | `/api/evaluation` | Precision/recall/F1/FPR/cost computed from the held-out test set |
| POST | `/api/webhooks/razorpay` | Razorpay TEST MODE webhook (optional) |
| POST | `/api/auth/register` | Register a user with a bcrypt password hash and receive a JWT |
| POST | `/api/auth/login` | Authenticate with email/password and receive a JWT |
| POST | `/api/profiles/users` | Create or update a user profile |
| POST | `/api/profiles/merchants` | Create or update a merchant profile |
| GET | `/api/profiles/users/:userId/history` | Return one user's persisted transaction history |

#### `GET /api/health`
```json
{
  "success": true,
  "service": "payshield",
  "status": "healthy",
  "mode": "DEMO_MODE",
  "dependencies": { "mongodb": "healthy", "vectordb": "healthy" }
}
```

#### `POST /api/transactions`
Request (authentication required):
```json
{ "senderName": "Aarav Shah", "receiverName": "TrustedMart", "amount": 1500, "currency": "INR", "location": "Surat, IN", "deviceId": "device_abc123" }
```
Response: `{ "success": true, "data": { "transaction": {...}, "riskAssessment": {...} } }`

The server derives stable `userId` and `merchantId` values from the sender and
receiver names. Reusing a sender name places later transactions in the same user
history; a new sender creates a separate user profile. Use the `Authorization:
Bearer <token>` header for protected endpoints.

#### `GET /api/transactions`
Response: `{ "success": true, "count": 12, "data": [ {...}, ... ] }`

#### `GET /api/transactions/:id`
Response: `{ "success": true, "data": { "transactionId": "...", "amount": 1500, ... } }`

#### `POST /api/risk/analyze/:transactionId`
Request body (optional): `{ "simulateFailure": "VECTORDB_FAILURE" }` - see "Failure Handling".
Response:
```json
{
  "success": true,
  "data": {
    "transactionId": "TXN-...",
    "state": "REVIEW_REQUIRED",
    "compositeScore": 42,
    "decision": "REVIEW_REQUIRED",
    "degraded": false,
    "agents": { "fraud": {...}, "behavior": {...}, "device": {...}, "policy": {...} }
  }
}
```

#### `GET /api/risk/:transactionId`
Response: the persisted `RiskAssessment` document (`riskScore`, `riskLevel`, `decision`,
`fraudRisk`/`behaviorRisk`/`deviceRisk`/`policyRisk`, `reasons`, `signals`, `citations`,
`state`, `degraded`, `confidence`, `analysisStatus`).

#### `POST /api/review`
Request (authentication required): `{ "decision": "APPROVE", "reason": "Verified with customer" }`
Response: `{ "success": true, "data": { "review": {...}, "state": "APPROVED" } }`

#### `GET /api/audit/:transactionId`
Response: `{ "success": true, "count": 7, "data": [ { "event": "TRANSACTION_RECEIVED", "newState": "RECEIVED", ... }, ... ] }`

#### `GET /api/evaluation`
```json
{
  "success": true,
  "data": {
    "datasetSize": 220, "testSetSize": 44,
    "precision": 1, "recall": 0.1923, "f1": 0.3226, "falsePositiveRate": 0,
    "truePositives": 5, "trueNegatives": 18, "falsePositives": 0, "falseNegatives": 21,
    "falsePositiveCost": 0, "falsePositiveCostAssumption": 100,
    "falsePositiveCostLabel": "Demo business cost assumption - not a real Razorpay or industry figure",
    "confusionMatrix": { "actualLegit": {"predictedLegit":18,"predictedRisk":0}, "actualRisk": {"predictedLegit":21,"predictedRisk":5} }
  }
}
```
This is a **real captured run**, not a hand-typed example - see "Known limitations" for
what it reveals.

#### `POST /api/webhooks/razorpay` (optional)
Headers: `X-Razorpay-Signature`, `X-Razorpay-Event-Id`. Body: standard Razorpay
`payment.captured` webhook payload. Response: `{ "success": true, "data": { ...same shape as risk/assess... } }`,
or `{ "success": true, "duplicate": true }` for a replayed event, or `400` for an
invalid signature.

---

## Test commands

```bash
cd backend

# Offline, zero setup: state machine, LLM output validation, evaluation metrics
node src/test/testGuardrailFlow.js

# Requires MongoDB (+ ideally VectorDB/Gemini for full fidelity)
npm run demo-scenarios          # Scenario A/B/C from "Final demo flow" below

# Requires a running backend with RAZORPAY_TEST_MODE configured
npm run test-webhook            # signed payload -> accept, replay -> ignored, bad sig -> rejected

# Evaluation
npm run generate-dataset
curl http://localhost:5000/api/evaluation
```

## Final demo flow

**Scenario A - Normal transaction.** Low amount, trusted merchant, established
account, known device. Run: `npm run demo-scenarios` (Scenario A) or submit via the
dashboard. The **real** decision engine determines the outcome - this is not
hardcoded to show APPROVED, though with a clean profile it should land there.

**Scenario B - Suspicious transaction.** High amount, brand-new account with a prior
chargeback flag, high-risk merchant category, unrecognized device. Expect elevated
composite score and REVIEW_REQUIRED or BLOCK_RECOMMENDED depending on what the four
agents actually compute - again, not hardcoded.

**Scenario C - Ambiguous transaction.** Borderline amount, otherwise clean profile.
Expect a score near the REVIEW_REQUIRED boundary.

**Failure demo.** Open any transaction's detail view in the dashboard and click one of
the three "Failure demo" buttons (VectorDB Down / Gemini Down / No Policy Evidence).
The UI will show the degraded notice, the composite score will reflect a zeroed policy
component, and `GET /api/audit/:transactionId` will show the corresponding
`VECTORDB_FAILURE` / `LLM_FAILURE` / `RAG_NO_EVIDENCE` event - the transaction is
never silently approved.

---

## Known limitations

- **This development sandbox has no network access and no MongoDB/g++/Ollama
  installed**, so the fully offline parts (state machine, decision engine, agents,
  output validator, dataset generation, evaluation metrics) were actually run and
  verified here - the numbers in this README are real output. Scenarios that need live
  MongoDB, the C++ VectorDB, or a Gemini API key (webhook flow, demo scenarios A/B/C,
  full policy RAG) are written and reasoned through carefully but need to be run in a
  real environment to confirm end-to-end - please do that before relying on this in
  anything resembling production.
- **The evaluation result is honestly weak (recall = 0.19 in the captured run)** - with
  the exact weights/thresholds specified (0.35/0.30/0.15/0.20, review at composite
  score 31+), a single isolated anomaly signal (only a new device, or only an unusual
  amount) usually elevates just one of the four weighted components and doesn't cross
  30 by itself. Only `multi_anomaly` records (several agents firing at once) reliably
  cross the threshold. This is a real, reproducible property of the formula as
  specified, not a bug in the evaluation code - if higher recall on single-signal cases
  matters, the thresholds/weights would need revisiting, ideally tuned only against the
  80% dev split, never the held-out test split.
- **Evaluation's `policyRisk` component uses a deterministic proxy**
  (`policyRiskProxy.js`), not the live Gemini+RAG `policyAgent` - necessary because the
  real agent is network-dependent and non-deterministic, which would make held-out
  results change between runs. Evaluation numbers faithfully reflect the fraud/
  behavior/device agents and the decision engine, but not the live policy-RAG path.
- **`behaviorAgent`/`deviceAgent` reuse a 24-hour transaction window** as a stand-in for
  a full historical profile - a real deployment would want a longer/richer baseline.
- **PDF section detection is a simple heuristic** (first short line on a page) - works
  for the 4 generated demo policies, not robust to arbitrary PDF layouts.
- **The webhook responds synchronously** (ack after the full risk pipeline completes)
  rather than acking immediately and processing asynchronously - fine for a demo's
  request volume, not for production throughput.
- **Authentication is intentionally lightweight** - bcrypt password hashing and JWT
  route protection are implemented, but production should still add role-based
  reviewer authorization, token revocation, and rate limiting.
  is a fixed identity, not a real user system.
- **`Razorpay` npm SDK was not added** - signature verification is implemented with
  Node's built-in `crypto` module directly (the same HMAC-SHA256-over-raw-body
  mechanism the official SDK uses internally), keeping the dependency list unchanged.

## Recommended 2-minute interview explanation

*"PayShield scores every payment with four independent agents - fraud, behavior,
device, and policy. Three are plain deterministic JavaScript rules; the fourth
retrieves actual policy document excerpts from my own C++ vector database, using HNSW
and cosine similarity, and asks Gemini to interpret that evidence. Gemini never decides
anything - its output is validated against a strict schema, and the only thing that
computes APPROVE, REVIEW, or BLOCK is a fixed weighted formula with fixed thresholds,
in plain arithmetic, no LLM involved. Every transaction moves through an explicit state
machine, every step is logged to an audit trail in MongoDB, and anything that isn't a
clean approve waits for a human. If the vector database or Gemini goes down, or the RAG
step finds no relevant policy evidence, the system doesn't fabricate an answer or
silently approve - it logs the failure and forces the transaction to review. I built a
reproducible synthetic evaluation set with an 80/20 dev/held-out split and actually
compute precision, recall, F1, and a false-positive cost from the held-out set - and
I'm upfront that with the exact formula specified, recall on single-signal anomalies is
weak, which is a real, honest finding about threshold calibration, not something I
hid. Razorpay integration is test-mode only, webhook-signed, idempotent via MongoDB -
no Redis - and the whole system runs identically with zero Razorpay configuration in a
synthetic demo mode."*
