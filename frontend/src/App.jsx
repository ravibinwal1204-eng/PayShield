import React, { useState } from 'react';
import Dashboard from './pages/Dashboard';
import EvaluationPage from './pages/EvaluationPage';
import Operations from './pages/Operations';
import AuthPage from './pages/AuthPage';

export default function App() {
  const [tab, setTab] = useState('dashboard');
  const [session, setSession] = useState(() => JSON.parse(localStorage.getItem('payshield_user') || 'null'));

  if (!session) return <AuthPage onAuthenticated={(data) => { localStorage.setItem('payshield_token', data.token); localStorage.setItem('payshield_user', JSON.stringify(data.user)); setSession(data.user); }} />;

  function logout() {
    localStorage.removeItem('payshield_token');
    localStorage.removeItem('payshield_user');
    setSession(null);
  }

  return (
    <>
      <nav className="site-nav">
        <button className="brand-mark" onClick={() => setTab('dashboard')} aria-label="Go to dashboard">
          <span className="brand-glyph">P</span>
          <span>PayShield</span>
        </button>
        <div className="nav-links">
          <button className={tab === 'dashboard' ? 'nav-link active' : 'nav-link'} onClick={() => setTab('dashboard')}>
            Transactions
          </button>
          <button className={tab === 'operations' ? 'nav-link active' : 'nav-link'} onClick={() => setTab('operations')}>
            History
          </button>
          <button className={tab === 'evaluation' ? 'nav-link active' : 'nav-link'} onClick={() => setTab('evaluation')}>
            Evaluation
          </button>
          <button className={tab === 'about' ? 'nav-link active' : 'nav-link'} onClick={() => setTab('about')}>
            About
          </button>
        </div>
        <div className="nav-account"><span className="nav-status"><span className="status-dot" /> {session.name}</span><button className="nav-logout" onClick={logout}>Sign out</button></div>
      </nav>
      {tab === 'dashboard' && <Dashboard user={session} />}
      {tab === 'operations' && <Operations />}
      {tab === 'evaluation' && <EvaluationPage />}
      {tab === 'about' && <AboutPage />}
    </>
  );
}

function AboutPage() {
  return (
    <main className="page-shell about-page">
      <section className="about-hero reveal">
        <p className="eyebrow">RISK OPERATIONS / 01</p>
        <h1>Clarity before every transaction.</h1>
        <p className="hero-copy">PayShield brings deterministic risk scoring, policy evidence, and human review into one calm operating surface.</p>
      </section>
      <section className="about-grid">
        <article className="about-panel reveal delay-1"><span className="panel-index">01</span><h2>Bounded intelligence</h2><p>Four focused agents create signals. A deterministic engine makes the recommendation. Gemini never approves or blocks money.</p></article>
        <article className="about-panel reveal delay-2"><span className="panel-index">02</span><h2>Evidence you can audit</h2><p>Every transition, signal, and review is recorded so an operator can understand not only what happened, but why.</p></article>
        <article className="about-panel reveal delay-3"><span className="panel-index">03</span><h2>Human in the loop</h2><p>Review-required and block-recommended outcomes remain recommendations until a reviewer takes the final action.</p></article>
      </section>
    </main>
  );
}
