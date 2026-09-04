/**
 * deviceAgent.js
 *
 * BOUNDED RESPONSIBILITY (defense-only):
 *   CAN:    analyze device-related risk (new device, device history,
 *           device/location combination).
 *   CANNOT: execute financial actions of any kind. Read-only over the
 *           history it's given; returns data only.
 *
 * Deterministic, rule-based, synchronous — no LLM involved.
 *
 * Input:
 *   {
 *     transaction: { deviceId, location },
 *     deviceHistory: [{ deviceId, location }, ...]  // prior transactions, same user
 *   }
 *
 * Output: { riskScore, confidence, reasons: string[], signals: string[], citations: [] }
 */

function analyzeDeviceRisk({ transaction, deviceHistory = [] }) {
  let score = 0;
  const reasons = [];
  const signals = [];

  const deviceId = transaction?.deviceId;
  const location = transaction?.location;

  if (!deviceId || deviceId === 'unknown') {
    score += 40;
    reasons.push('Transaction has no device identifier — missing device telemetry');
    signals.push('MISSING_DEVICE_ID');
  } else {
    const knownDeviceIds = new Set(deviceHistory.map((t) => t.deviceId).filter(Boolean));
    const isNewDevice = knownDeviceIds.size > 0 && !knownDeviceIds.has(deviceId);

    if (knownDeviceIds.size === 0) {
      score += 15;
      reasons.push('No device history available for this user');
      signals.push('NO_DEVICE_HISTORY');
    } else if (isNewDevice) {
      score += 20;
      reasons.push('Device has not been used by this user before');
      signals.push('NEW_DEVICE');

      const knownLocations = new Set(deviceHistory.map((t) => t.location).filter(Boolean));
      const isNewLocation = location && knownLocations.size > 0 && !knownLocations.has(location);
      if (isNewLocation) {
        score += 15;
        reasons.push('New device is also paired with a location not seen before');
        signals.push('NEW_DEVICE_NEW_LOCATION');
      }
    }
  }

  const riskScore = Math.max(0, Math.min(100, Math.round(score)));
  const confidence = Math.min(100, 55 + (deviceHistory.length > 0 ? 30 : 0));

  if (reasons.length === 0) {
    reasons.push('Device is recognized and consistent with prior activity');
  }

  return { riskScore, confidence, reasons, signals, citations: [] };
}

module.exports = { analyzeDeviceRisk };
