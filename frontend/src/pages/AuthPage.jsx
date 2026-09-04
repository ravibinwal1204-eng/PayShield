import React, { useState } from 'react';
import { login, register } from '../services/api';

export default function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function update(event) {
    setForm((prev) => ({ ...prev, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = mode === 'login' ? await login({ email: form.email, password: form.password }) : await register(form);
      onAuthenticated(result.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-panel">
        <p className="eyebrow">PAYSHIELD / SECURE ACCESS</p>
        <h1>{mode === 'login' ? 'Welcome back.' : 'Create your operator account.'}</h1>
        <p className="subtitle">Risk operations with a clear identity trail.</p>
        <form onSubmit={submit} className="auth-form">
          {mode === 'register' && <label>Full name<input name="name" value={form.name} onChange={update} required /></label>}
          <label>Email<input name="email" type="email" value={form.email} onChange={update} required /></label>
          <label>Password<input name="password" type="password" value={form.password} onChange={update} minLength={8} required /></label>
          {error && <div className="error-box">{error}</div>}
          <button className="primary-btn" disabled={busy}>{busy ? 'Working...' : mode === 'login' ? 'Sign in' : 'Register'}</button>
        </form>
        <button className="ghost-btn auth-switch" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}>
          {mode === 'login' ? 'Create an account' : 'Use an existing account'}
        </button>
      </section>
    </main>
  );
}