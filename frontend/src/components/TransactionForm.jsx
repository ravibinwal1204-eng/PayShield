import React, { useState } from 'react';
import { createTransaction } from '../services/api';

const initialState = { senderName: '', receiverName: '', amount: '', currency: 'INR', location: '', deviceId: '' };

export default function TransactionForm({ user, onCreated }) {
  const [form, setForm] = useState({ ...initialState, senderName: user?.name || '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  function handleChange(event) {
    const { name, value } = event.target;
    setForm((previous) => ({ ...previous, [name]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    if (!form.senderName || !form.receiverName || !form.amount) {
      setError('Sender name, receiver name and amount are required.');
      return;
    }
    setLoading(true);
    try {
      const result = await createTransaction({ ...form, amount: Number(form.amount) });
      onCreated(result.data);
      setForm({ ...initialState, senderName: user?.name || '' });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="card transaction-form" onSubmit={handleSubmit}>
      <div className="section-heading"><div><p className="eyebrow">TRANSACTION INTAKE</p><h2>Screen a transaction</h2></div></div>
      <p className="section-intro">New senders and receivers are saved automatically for future history.</p>
      {error && <div className="error-box">{error}</div>}
      <div className="form-grid">
        <label>Sender Name<input name="senderName" value={form.senderName} onChange={handleChange} placeholder="e.g. Aarav Shah" required /></label>
        <label>Receiver Name<input name="receiverName" value={form.receiverName} onChange={handleChange} placeholder="e.g. TrustedMart" required /></label>
        <label>Amount<input name="amount" type="number" min="0" value={form.amount} onChange={handleChange} placeholder="5000" required /></label>
        <label>Currency<input name="currency" value={form.currency} onChange={handleChange} placeholder="INR" required /></label>
        <label>Location<input name="location" value={form.location} onChange={handleChange} placeholder="Surat, IN" /></label>
        <label>Device ID<input name="deviceId" value={form.deviceId} onChange={handleChange} placeholder="e.g. device_001" /></label>
      </div>
      <button className="primary-btn" type="submit" disabled={loading}>{loading ? 'Submitting...' : 'Create transaction'}</button>
    </form>
  );
}
