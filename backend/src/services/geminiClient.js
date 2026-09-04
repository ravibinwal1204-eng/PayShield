/**
 * geminiClient.js
 *
 * Thin REST wrapper around Google's Generative Language API (Gemini).
 *
 * BOUNDARY (enforced by convention across the codebase, not just here):
 * Gemini is used ONLY to produce contextual risk signals, reasoning, and
 * confidence — it NEVER decides APPROVE / REVIEW_REQUIRED / BLOCK_RECOMMENDED.
 * The deterministic decision engine (backend/src/risk/decisionEngine.js)
 * is the only place a final decision is computed, from numeric scores.
 *
 * The API key is read from GEMINI_API_KEY (server-side only — never sent to
 * or used from the React frontend). The model is configurable via
 * GEMINI_MODEL so it can be changed without a code change.
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/**
 * generateJSON(prompt)
 *
 * Sends a prompt instructing Gemini to reply with ONLY a JSON object, and
 * returns the raw text response for the caller to parse/validate. This
 * function does not itself decide anything and does not fabricate a
 * fallback — callers (agents) are responsible for handling failures
 * safely (see policyAgent.js).
 *
 * Throws on: missing API key, network failure, non-200 response, or an
 * empty/missing text part in the Gemini response. Callers must catch this.
 */
async function generateJSON(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not configured');
  }

  const url = `${API_BASE}/${encodeURIComponent(GEMINI_MODEL)}:generateContent?key=${GEMINI_API_KEY}`;

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json'
    }
  };

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (err) {
    throw new Error(`Gemini request failed: ${err.message}`);
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini returned status ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json().catch(() => null);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error('Gemini response contained no text content');
  }

  return text;
}

module.exports = { generateJSON, GEMINI_MODEL };
