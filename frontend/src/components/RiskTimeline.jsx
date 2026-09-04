import React from 'react';

// The canonical lifecycle order used only to LAY OUT the steps left-to-right.
// Whether a step is "reached" and what state each step transitioned into
// comes entirely from the audit events passed in — this array never decides
// the outcome of a transaction, it's just a fixed display order.
const STEP_ORDER = [
  { key: 'RECEIVED', label: 'Received', match: (e) => e.event === 'TRANSACTION_RECEIVED' },
  { key: 'VALIDATED', label: 'Validated', match: (e) => e.event === 'TRANSACTION_VALIDATED' },
  { key: 'ANALYZING', label: 'Analyzing', match: (e) => e.event === 'RISK_ANALYSIS_STARTED' },
  { key: 'RISK_ASSESSED', label: 'Risk Assessed', match: (e) => e.event === 'RISK_ASSESSED' },
  {
    key: 'DECISION',
    label: 'Decision',
    match: (e) =>
      ['REVIEW_REQUIRED', 'BLOCK_RECOMMENDED'].includes(e.event) ||
      (e.event === 'RISK_ASSESSED' && e.newState === 'APPROVED')
  },
  {
    key: 'HUMAN',
    label: 'Human Decision',
    match: (e) => ['HUMAN_APPROVED', 'HUMAN_BLOCKED'].includes(e.event)
  }
];

export default function RiskTimeline({ auditEvents = [] }) {
  if (!auditEvents.length) return null;

  const failed = auditEvents.some((e) => e.event === 'RISK_ANALYSIS_FAILED');

  const steps = STEP_ORDER.map((step) => {
    const matchedEvent = auditEvents.find(step.match);
    return {
      ...step,
      reached: Boolean(matchedEvent),
      newState: matchedEvent?.newState || null,
      timestamp: matchedEvent?.timestamp || null
    };
  });

  return (
    <div className="risk-timeline">
      {steps.map((step, idx) => (
        <React.Fragment key={step.key}>
          <div className={`timeline-step ${step.reached ? 'reached' : 'pending'}`}>
            <div className="timeline-dot" />
            <div className="timeline-label">{step.label}</div>
            {step.newState && <div className="timeline-state">{step.newState}</div>}
          </div>
          {idx < steps.length - 1 && <div className={`timeline-connector ${step.reached ? 'reached' : ''}`} />}
        </React.Fragment>
      ))}
      {failed && <div className="timeline-failed">Analysis failed — review the transaction details below</div>}
    </div>
  );
}
