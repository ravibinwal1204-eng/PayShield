/**
 * policyAgent.js
 *
 * BOUNDED RESPONSIBILITY (defense-only):
 *   CAN:    query the existing Synapse RAG (via the C++ VectorDB's /doc/*
 *           endpoints), retrieve policy evidence, and interpret that
 *           evidence with Gemini to produce a risk signal + explanation.
 *   CANNOT: modify policies, delete vectors, or execute payments. This
 *           module never calls /doc/delete, never writes to the
 *           VectorDB, and has no access to money-movement APIs.
 *
 * Flow:
 *   Transaction -> policy query text -> embed (in C++) -> C++ VectorDB
 *   search -> retrieved policy chunks -> Gemini reasoning -> validated
 *   structured output -> citations built ONLY from real retrieved chunk
 *   metadata (never invented).
 *
 * GRACEFUL FAILURE (all three required scenarios are handled here):
 *   1. Gemini unavailable / errors        -> safe fallback, no fabrication
 *   2. C++ VectorDB unavailable            -> safe fallback, no fabrication
 *   3. RAG returns no reliable evidence    -> safe fallback, no citations
 *   4. Gemini returns malformed JSON       -> rejected by the validator,
 *                                             safe fallback, no fabrication
 *
 * Every failure path returns a fully-formed, schema-valid result so the
 * orchestrator never has to special-case a crash — it only has to look at
 * `degraded`/`failureReason` to decide whether to force a review state and
 * what to audit-log.
 */

const { searchPolicyChunks } = require('../vectordb/vectorDbDocClient');
const { generateJSON } = require('../services/geminiClient');
const { validateAgentOutput, safeParseJSON } = require('../services/llmOutputValidator');

const MAX_DISTANCE_FOR_EVIDENCE = 0.7; // cosine distance cutoff shared with the C++ default

function buildPolicyQuery({ transaction, merchant }) {
  const parts = [
    `A transaction of ${transaction?.amount ?? 'unknown'} ${transaction?.currency || ''} `,
    merchant?.category ? `to a "${merchant.category}" category merchant ` : 'to an unidentified merchant ',
    transaction?.location ? `from location "${transaction.location}" ` : 'with no known location ',
    transaction?.deviceId && transaction.deviceId !== 'unknown'
      ? 'using a known device identifier. '
      : 'with no device identifier. ',
    'What risk policy rules, thresholds, or review requirements apply to this transaction?'
  ];
  return parts.join('');
}

function buildGeminiPrompt(query, chunks) {
  const excerpts = chunks
    .map(
      (c, i) =>
        `[${i + 1}] (document: ${c.document || c.title}, section: ${c.section || 'n/a'}, page: ${c.page || 'n/a'})\n${c.text}`
    )
    .join('\n\n');

  return `You are a payment risk policy analyst. You are given numbered excerpts from
your organization's internal risk policy documents, and a transaction description.

Your job is ONLY to interpret the policy excerpts and produce a risk signal. You
must NOT decide whether to approve, review, or block the transaction — that
decision is made by a separate deterministic system. You only provide analysis.

Ground every reason strictly in the numbered excerpts below. If the excerpts
don't clearly address the transaction, say so in "reasons" and keep riskScore
and confidence low — do not guess or invent policy rules that are not in the
excerpts.

Policy excerpts:
${excerpts || '(no excerpts were retrieved)'}

Transaction: ${query}

Respond with ONLY a JSON object in exactly this shape, no other text:
{
  "riskScore": <number 0-100>,
  "confidence": <number 0-100>,
  "reasons": [<short strings, each grounded in a specific excerpt>],
  "signals": [<short UPPER_SNAKE_CASE signal tags>],
  "citedExcerpts": [<integers, the excerpt numbers above that you actually used, [] if none>]
}`;
}

/**
 * Builds citations ONLY from chunks Gemini actually referenced, using the
 * real metadata returned by the VectorDB. This is the mechanism that makes
 * "never invent citations" structurally true rather than just a prompt
 * instruction: we never let Gemini write the citation text itself.
 */
function buildCitations(chunks, citedExcerpts) {
  if (!Array.isArray(citedExcerpts)) return [];
  const citations = [];
  for (const idx of citedExcerpts) {
    const chunk = chunks[idx - 1]; // excerpts are 1-indexed in the prompt
    if (chunk) {
      citations.push({
        document: chunk.document || chunk.title,
        section: chunk.section || '',
        page: chunk.page || 0,
        chunkId: chunk.chunkId ?? chunk.id,
        distance: chunk.distance
      });
    }
  }
  return citations;
}

function safeFallback(reasons, failureReason, citations = []) {
  return {
    riskScore: 0,
    confidence: 0,
    reasons,
    signals: [],
    citations,
    degraded: true,
    failureReason
  };
}

/**
 * analyzePolicyRisk({ transaction, merchant, logEvent })
 *
 * `logEvent` is an optional async function(eventName, metadata) the caller
 * (the orchestrator) can pass in so this agent can surface audit-worthy
 * moments (POLICY_RETRIEVED, VECTORDB_FAILURE, RAG_NO_EVIDENCE,
 * LLM_FAILURE) without this module taking on a MongoDB dependency itself.
 */
async function analyzePolicyRisk({
  transaction,
  merchant = null,
  logEvent = async () => {},
  simulateFailure = null // null | 'VECTORDB_FAILURE' | 'LLM_FAILURE' | 'RAG_NO_EVIDENCE'
}) {
  const query = buildPolicyQuery({ transaction, merchant });

  // --- Controlled failure demo (section 10) ---
  // Explicitly operator-triggered only (via POST /api/risk/assess body
  // { simulateFailure: "..." }) — never automatic, never hidden, and never
  // simulates an attack. It exercises the exact same safeFallback path a
  // real failure would take, so the audit trail and UI are the real thing,
  // not a mocked-up screen.
  if (simulateFailure === 'VECTORDB_FAILURE') {
    await logEvent('VECTORDB_FAILURE', { query, simulated: true });
    return safeFallback(
      ['Policy evidence unavailable: the VectorDB could not be reached (simulated for demo)'],
      'VECTORDB_FAILURE'
    );
  }
  if (simulateFailure === 'LLM_FAILURE') {
    await logEvent('LLM_FAILURE', { query, simulated: true });
    return safeFallback(['Gemini reasoning was unavailable (simulated for demo)'], 'LLM_FAILURE');
  }
  if (simulateFailure === 'RAG_NO_EVIDENCE') {
    await logEvent('RAG_NO_EVIDENCE', { query, simulated: true });
    return safeFallback(
      ['No relevant policy evidence was found for this transaction (simulated for demo)'],
      'RAG_NO_EVIDENCE'
    );
  }

  // --- Retrieval step: C++ VectorDB via the existing Synapse RAG path ---
  let chunks;
  try {
    chunks = await searchPolicyChunks(query, 4);
  } catch (err) {
    await logEvent('VECTORDB_FAILURE', { error: err.message, query });
    return safeFallback(
      ['Policy evidence unavailable: the VectorDB could not be reached'],
      'VECTORDB_FAILURE'
    );
  }

  const relevantChunks = chunks.filter(
    (c) => typeof c.distance !== 'number' || c.distance <= MAX_DISTANCE_FOR_EVIDENCE
  );

  if (relevantChunks.length === 0) {
    await logEvent('RAG_NO_EVIDENCE', { query, retrievedCount: chunks.length });
    return safeFallback(
      ['No relevant policy evidence was found for this transaction'],
      'RAG_NO_EVIDENCE'
    );
  }

  await logEvent('POLICY_RETRIEVED', {
    query,
    chunks: relevantChunks.map((c) => ({ document: c.document, section: c.section, page: c.page, chunkId: c.chunkId }))
  });

  // --- Reasoning step: Gemini interprets the retrieved evidence ---
  const prompt = buildGeminiPrompt(query, relevantChunks);
  let rawText;
  try {
    rawText = await generateJSON(prompt);
  } catch (err) {
    await logEvent('LLM_FAILURE', { error: err.message });
    return safeFallback(
      ['Policy evidence was retrieved, but Gemini reasoning is unavailable'],
      'LLM_FAILURE',
      buildCitations(relevantChunks, relevantChunks.map((_, index) => index + 1))
    );
  }

  const parsed = safeParseJSON(rawText);
  const validation = validateAgentOutput({
    riskScore: parsed?.riskScore,
    confidence: parsed?.confidence,
    reasons: parsed?.reasons,
    signals: parsed?.signals,
    citations: [] // built below from real metadata, not from the model
  });

  if (!validation.valid) {
    await logEvent('LLM_FAILURE', { error: 'Invalid structured output', details: validation.errors, rawText });
    return safeFallback(
      ['Gemini returned an invalid response structure and was rejected'],
      'LLM_INVALID_OUTPUT'
    );
  }

  const citations = buildCitations(relevantChunks, parsed.citedExcerpts);

  return {
    riskScore: validation.data.riskScore,
    confidence: validation.data.confidence,
    reasons: validation.data.reasons,
    signals: validation.data.signals,
    citations,
    degraded: false,
    failureReason: null
  };
}

module.exports = { analyzePolicyRisk, buildPolicyQuery };
