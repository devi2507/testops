import React, { useState } from 'react';
import { Shield, Mail, Lock, User, Eye, EyeOff, ArrowRight, ArrowLeft, AlertCircle, CheckCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import '../styles/auth.css';

function validate(form, isRegister) {
  const errors = {};
  if (!form.email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) errors.email = 'Enter a valid email address';
  if (form.password.length < 6) errors.password = 'Password must be at least 6 characters';
  if (isRegister) {
    if (!form.name.trim()) errors.name = 'Name is required';
    if (form.password !== form.confirm) errors.confirm = 'Passwords do not match';
  }
  return errors;
}

// ── Forgot Password view ─────────────────────────────────────────────────
function ForgotPassword({ onBack }) {
  const { login } = useAuth();
  const [step, setStep]         = useState('email');   // 'email' | 'reset' | 'done'
  const [email, setEmail]       = useState('');
  const [newPw, setNewPw]       = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleEmailSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    // Simulate a brief "sending" delay for UX
    await new Promise(r => setTimeout(r, 800));
    setLoading(false);

    // Check if this email has a stored account
    const stored = localStorage.getItem('testops_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        if (user.email?.toLowerCase() === email.toLowerCase()) {
          setStep('reset');
          return;
        }
      } catch {}
    }
    // Even if no account found, show reset step — avoids email enumeration
    setStep('reset');
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    if (newPw.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw) { setError('Passwords do not match.'); return; }

    setLoading(true);
    await new Promise(r => setTimeout(r, 600));

    // Update stored user password (stored as plain text since auth is local-only)
    const stored = localStorage.getItem('testops_user');
    if (stored) {
      try {
        const user = JSON.parse(stored);
        if (user.email?.toLowerCase() === email.toLowerCase()) {
          const updated = { ...user, password: newPw };
          localStorage.setItem('testops_user', JSON.stringify(updated));
          login(updated);
        }
      } catch {}
    }

    setLoading(false);
    setStep('done');
  };

  return (
    <div className="auth-card animate-fade-up">
      <button className="auth-back-btn" onClick={onBack}>
        <ArrowLeft size={15} /> Back to sign in
      </button>

      <div className="auth-logo">
        <div className="auth-logo__icon">
          <Shield size={24} color="#fff" />
        </div>
        <div>
          <div className="auth-logo__name">TestPilot AI</div>
          <div className="auth-logo__tagline">Security Testing Platform</div>
        </div>
      </div>

      {/* Step: enter email */}
      {step === 'email' && (
        <>
          <div className="auth-heading">
            <h1 className="auth-heading__title">Reset your password</h1>
            <p className="auth-heading__sub">Enter your account email to continue.</p>
          </div>
          <form className="auth-form" onSubmit={handleEmailSubmit} noValidate>
            <div className={`auth-field ${error ? 'auth-field--error' : ''}`}>
              <label className="auth-label">Email address</label>
              <div className="auth-input-wrap">
                <Mail size={16} className="auth-input-icon" />
                <input
                  type="email"
                  className="auth-input"
                  placeholder="you@company.com"
                  value={email}
                  onChange={e => { setEmail(e.target.value); setError(''); }}
                  autoFocus
                  autoComplete="email"
                />
              </div>
              {error && <p className="auth-error"><AlertCircle size={13} />{error}</p>}
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <span className="auth-spinner" /> : <><ArrowRight size={16} /> Continue</>}
              {!loading && <span className="auth-submit__shimmer" />}
            </button>
          </form>
        </>
      )}

      {/* Step: set new password */}
      {step === 'reset' && (
        <>
          <div className="auth-heading">
            <h1 className="auth-heading__title">Set new password</h1>
            <p className="auth-heading__sub">Choose a new password for <strong>{email}</strong>.</p>
          </div>
          <form className="auth-form" onSubmit={handleReset} noValidate>
            <div className={`auth-field ${error && error.includes('6') ? 'auth-field--error' : ''}`}>
              <label className="auth-label">New password</label>
              <div className="auth-input-wrap">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPw ? 'text' : 'password'}
                  className="auth-input auth-input--pw"
                  placeholder="••••••••"
                  value={newPw}
                  onChange={e => { setNewPw(e.target.value); setError(''); }}
                  autoFocus
                  autoComplete="new-password"
                />
                <button type="button" className="auth-pw-toggle" onClick={() => setShowPw(v => !v)} tabIndex={-1}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>
            <div className={`auth-field ${error && error.includes('match') ? 'auth-field--error' : ''}`}>
              <label className="auth-label">Confirm new password</label>
              <div className="auth-input-wrap">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPw ? 'text' : 'password'}
                  className="auth-input"
                  placeholder="••••••••"
                  value={confirmPw}
                  onChange={e => { setConfirmPw(e.target.value); setError(''); }}
                  autoComplete="new-password"
                />
              </div>
              {error && <p className="auth-error"><AlertCircle size={13} />{error}</p>}
            </div>
            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? <span className="auth-spinner" /> : <><Lock size={15} /> Update Password</>}
              {!loading && <span className="auth-submit__shimmer" />}
            </button>
          </form>
        </>
      )}

      {/* Step: done */}
      {step === 'done' && (
        <div className="auth-reset-done">
          <div className="auth-reset-done__icon">
            <CheckCircle size={36} color="var(--success)" />
          </div>
          <h2>Password updated</h2>
          <p>Your password has been reset successfully. You can now sign in with your new password.</p>
          <button className="auth-submit" style={{ marginTop: '8px' }} onClick={onBack}>
            <ArrowLeft size={15} /> Back to sign in
            <span className="auth-submit__shimmer" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main AuthPage ────────────────────────────────────────────────────────
export default function AuthPage({ onBack }) {
  const { login } = useAuth();
  const [tab, setTab]         = useState('login');
  const [view, setView]       = useState('auth');   // 'auth' | 'forgot'
  const [loading, setLoading] = useState(false);
  const [showPw, setShowPw]   = useState(false);
  const [errors, setErrors]   = useState({});
  const [form, setForm]       = useState({ name: '', email: '', password: '', confirm: '' });

  const isRegister = tab === 'register';

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate(form, isRegister);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    setLoading(true);
    await new Promise(r => setTimeout(r, 900));

    if (isRegister) {
      // New account — build fresh
      const userData = {
        name:          form.name || form.email.split('@')[0],
        email:         form.email,
        password:      form.password,
        joinedAt:      new Date().toISOString(),
        avatarInitial: (form.name || form.email)[0].toUpperCase(),
      };
      login(userData);
    } else {
      // Signing in — restore any previously saved profile data (name, org, etc.)
      let existing = null;
      try {
        const stored = localStorage.getItem('testops_user');
        if (stored) {
          const parsed = JSON.parse(stored);
          if (parsed?.email?.toLowerCase() === form.email.toLowerCase()) {
            existing = parsed;
          }
        }
      } catch {}

      const userData = {
        // Start with existing saved profile so name/org changes survive logout
        ...(existing || {}),
        // Always refresh email and password from the login form
        email:         form.email,
        password:      form.password,
        // Only set these if no existing profile
        name:          existing?.name || form.email.split('@')[0],
        joinedAt:      existing?.joinedAt || new Date().toISOString(),
        avatarInitial: existing?.name
          ? existing.name[0].toUpperCase()
          : form.email[0].toUpperCase(),
      };
      login(userData);
    }

    setLoading(false);
  };

  const switchTab = (t) => {
    setTab(t); setErrors({});
    setForm({ name: '', email: '', password: '', confirm: '' });
  };

  if (view === 'forgot') {
    return (
      <div className="auth-page">
        <div className="auth-blob auth-blob--1" />
        <div className="auth-blob auth-blob--2" />
        <div className="auth-blob auth-blob--3" />
        <ForgotPassword onBack={() => setView('auth')} />
      </div>
    );
  }

  return (
    <div className="auth-page">
      <div className="auth-blob auth-blob--1" />
      <div className="auth-blob auth-blob--2" />
      <div className="auth-blob auth-blob--3" />

      <div className="auth-card animate-fade-up">
        {onBack && (
          <button className="auth-back-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Back to home
          </button>
        )}

        <div className="auth-logo">
          <div className="auth-logo__icon"><Shield size={24} color="#fff" /></div>
          <div>
            <div className="auth-logo__name">TestPilot AI</div>
            <div className="auth-logo__tagline">Security Testing Platform</div>
          </div>
        </div>

        <div className="auth-tabs">
          <button className={`auth-tab ${tab === 'login' ? 'auth-tab--active' : ''}`} onClick={() => switchTab('login')}>Sign In</button>
          <button className={`auth-tab ${tab === 'register' ? 'auth-tab--active' : ''}`} onClick={() => switchTab('register')}>Create Account</button>
        </div>

        <div className="auth-heading">
          <h1 className="auth-heading__title">{isRegister ? 'Create your account' : 'Welcome back'}</h1>
          <p className="auth-heading__sub">
            {isRegister ? 'Start auditing your platform with AI-powered testing' : 'Sign in to access your security dashboard'}
          </p>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          {isRegister && (
            <div className={`auth-field ${errors.name ? 'auth-field--error' : ''}`}>
              <label className="auth-label">Full Name</label>
              <div className="auth-input-wrap">
                <User size={16} className="auth-input-icon" />
                <input type="text" className="auth-input" placeholder="Jane Smith" value={form.name} onChange={set('name')} autoComplete="name" />
              </div>
              {errors.name && <p className="auth-error"><AlertCircle size={13} />{errors.name}</p>}
            </div>
          )}

          <div className={`auth-field ${errors.email ? 'auth-field--error' : ''}`}>
            <label className="auth-label">Email address</label>
            <div className="auth-input-wrap">
              <Mail size={16} className="auth-input-icon" />
              <input type="email" className="auth-input" placeholder="you@company.com" value={form.email} onChange={set('email')} autoComplete="email" />
            </div>
            {errors.email && <p className="auth-error"><AlertCircle size={13} />{errors.email}</p>}
          </div>

          <div className={`auth-field ${errors.password ? 'auth-field--error' : ''}`}>
            <label className="auth-label">Password</label>
            <div className="auth-input-wrap">
              <Lock size={16} className="auth-input-icon" />
              <input
                type={showPw ? 'text' : 'password'}
                className="auth-input auth-input--pw"
                placeholder="••••••••"
                value={form.password}
                onChange={set('password')}
                autoComplete={isRegister ? 'new-password' : 'current-password'}
              />
              <button type="button" className="auth-pw-toggle" onClick={() => setShowPw(v => !v)} tabIndex={-1}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
            {errors.password && <p className="auth-error"><AlertCircle size={13} />{errors.password}</p>}
          </div>

          {isRegister && (
            <div className={`auth-field ${errors.confirm ? 'auth-field--error' : ''}`}>
              <label className="auth-label">Confirm Password</label>
              <div className="auth-input-wrap">
                <Lock size={16} className="auth-input-icon" />
                <input
                  type={showPw ? 'text' : 'password'}
                  className="auth-input"
                  placeholder="••••••••"
                  value={form.confirm}
                  onChange={set('confirm')}
                  autoComplete="new-password"
                />
              </div>
              {errors.confirm && <p className="auth-error"><AlertCircle size={13} />{errors.confirm}</p>}
            </div>
          )}

          {!isRegister && (
            <div className="auth-options">
              <label className="auth-remember">
                <input type="checkbox" defaultChecked />
                <span>Remember me</span>
              </label>
              <button type="button" className="auth-forgot" onClick={() => setView('forgot')}>
                Forgot password?
              </button>
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? <span className="auth-spinner" /> : <>{isRegister ? 'Create Account' : 'Sign In'}<ArrowRight size={16} /></>}
            {!loading && <span className="auth-submit__shimmer" />}
          </button>
        </form>

        <p className="auth-footer">
          By continuing, you agree to our <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
