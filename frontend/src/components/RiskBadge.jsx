import React from 'react';

const COLORS = {
  APPROVE: '#1e8e3e',
  REVIEW: '#e8a33d',
  BLOCK: '#d93025'
};

export default function RiskBadge({ decision }) {
  const color = COLORS[decision] || '#666';
  return (
    <span
      className="risk-badge"
      style={{ backgroundColor: color }}
    >
      {decision || 'UNKNOWN'}
    </span>
  );
}
