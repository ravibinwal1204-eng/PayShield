// In local dev, VITE_API_URL is left empty and requests go to the relative
// "/api" path, which vite.config.js proxies to the backend. For a
// production build, set VITE_API_URL to the deployed backend's full origin
// (e.g. https://payshield-api.example.com) — never hardcode localhost here.
const API_ROOT = import.meta.env.VITE_API_URL || '';
const BASE_URL = `${API_ROOT}/api`;

async function request(path, options = {}) {
  const token = localStorage.getItem('payshield_token');
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...options
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }

  return data;
}

export const register = (payload) => request('/auth/register', { method: 'POST', body: JSON.stringify(payload) });
export const login = (payload) => request('/auth/login', { method: 'POST', body: JSON.stringify(payload) });

export const getHealth = () => request('/health');

export const createTransaction = (payload) =>
  request('/transactions', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const getTransactions = () => request('/transactions');

export const getTransactionById = (id) => request(`/transactions/${id}`);

export const getUserHistory = (userId) => request(`/profiles/users/${encodeURIComponent(userId)}/history`);

export const getRiskByTransactionId = (transactionId) =>
  request(`/risk/${transactionId}`);

export const assessTransaction = (transactionId, simulateFailure = null) =>
  request('/risk/assess', {
    method: 'POST',
    body: JSON.stringify({ transactionId, simulateFailure })
  });

export const getAuditTrail = (transactionId) => request(`/audit/${transactionId}`);

export const submitReview = (payload) =>
  request('/review', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const getReviews = (transactionId) => request(`/review/${transactionId}`);

export const getEvaluation = () => request('/evaluation');

export const getRiskSummary = () => request('/risk/summary/stats');
