/**
 * llmOutputValidator.js
 *
 * Every risk signal produced by Gemini MUST pass through this validator
 * before it is allowed into the risk aggregation pipeline. This is the
 * guardrail described in the "Structured LLM Output" requirement: invalid
 * output is rejected outright, never coerced or partially trusted.
 *
 * Expected shape:
 *   {
 *     riskScore: number 0-100,
 *     confidence: number 0-100,
 *     reasons: string[],
 *     signals: string[],
 *     citations: array (see validateCitations below)
 *   }
 */

function isNumberInRange(v, min, max) {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

/**
 * validateAgentOutput(raw)
 * Returns { valid: true, data } or { valid: false, errors: string[] }.
 * Never mutates riskScore/confidence into range — out-of-range values are a
 * validation failure, not something to clamp and silently accept.
 */
function validateAgentOutput(raw) {
  const errors = [];

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { valid: false, errors: ['Output is not a JSON object'] };
  }

  if (!isNumberInRange(raw.riskScore, 0, 100)) {
    errors.push('riskScore must be a number between 0 and 100');
  }
  if (!isNumberInRange(raw.confidence, 0, 100)) {
    errors.push('confidence must be a number between 0 and 100');
  }
  if (!isStringArray(raw.reasons)) {
    errors.push('reasons must be an array of strings');
  }
  if (!isStringArray(raw.signals)) {
    errors.push('signals must be an array of strings');
  }
  if (!Array.isArray(raw.citations)) {
    errors.push('citations must be an array');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      riskScore: raw.riskScore,
      confidence: raw.confidence,
      reasons: raw.reasons,
      signals: raw.signals,
      citations: raw.citations
    }
  };
}

/**
 * safeParseJSON(text)
 * Gemini is asked for JSON-only output, but strips fences defensively.
 * Returns parsed object or null (never throws) — malformed JSON is a
 * validation failure, not a crash.
 */
function safeParseJSON(text) {
  if (typeof text !== 'string') return null;
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

module.exports = { validateAgentOutput, safeParseJSON };
