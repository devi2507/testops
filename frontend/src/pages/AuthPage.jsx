import React, { useState } from 'react';
import { Shield, Mail, Lock, User, Eye, EyeOff, ArrowRight, ArrowLeft, AlertCircle } from 'lucide-react';
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

export default function AuthPage({ onBack }) {
  const { login } = useAuth();
  const [tab, setTab]         = useState('login'); // 'login' | 'register'
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

    // Simulate API call — replace with real backend auth later
    await new Promise(r => setTimeout(r, 900));

    const userData = {
      name:      form.name || form.email.split('@')[0],
      email:     form.email,
      joinedAt:  new Date().toISOString(),
      avatarInitial: (form.name || form.email)[0].toUpperCase(),
    };
    login(userData);
    setLoading(false);
  };

  const switchTab = (t) => {
    setTab(t);
    setErrors({});
    setForm({ name: '', email: '', password: '', confirm: '' });
  };

  return (
    <div className="auth-page">
      {/* ── Ambient background blobs ── */}
      <div className="auth-blob auth-blob--1" />
      <div className="auth-blob auth-blob--2" />
      <div className="auth-blob auth-blob--3" />

      {/* ── Auth Card ── */}
      <div className="auth-card animate-fade-up">

        {/* Back to landing */}
        {onBack && (
          <button className="auth-back-btn" onClick={onBack}>
            <ArrowLeft size={15} /> Back to home
          </button>
        )}

        {/* Logo */}
        <div className="auth-logo">
          <div className="auth-logo__icon">
            <Shield size={24} color="#fff" />
          </div>
          <div>
            <div className="auth-logo__name">TestPilot AI</div>
            <div className="auth-logo__tagline">Security Testing Platform</div>
          </div>
        </div>

        {/* Tab switcher */}
        <div className="auth-tabs">
          <button
            className={`auth-tab ${tab === 'login' ? 'auth-tab--active' : ''}`}
            onClick={() => switchTab('login')}
          >
            Sign In
          </button>
          <button
            className={`auth-tab ${tab === 'register' ? 'auth-tab--active' : ''}`}
            onClick={() => switchTab('register')}
          >
            Create Account
          </button>
        </div>

        {/* Heading */}
        <div className="auth-heading">
          <h1 className="auth-heading__title">
            {isRegister ? 'Create your account' : 'Welcome back'}
          </h1>
          <p className="auth-heading__sub">
            {isRegister
              ? 'Start auditing your platform with AI-powered testing'
              : 'Sign in to access your security dashboard'}
          </p>
        </div>

        {/* Form */}
        <form className="auth-form" onSubmit={handleSubmit} noValidate>

          {isRegister && (
            <div className={`auth-field ${errors.name ? 'auth-field--error' : ''}`}>
              <label className="auth-label">Full Name</label>
              <div className="auth-input-wrap">
                <User size={16} className="auth-input-icon" />
                <input
                  type="text"
                  className="auth-input"
                  placeholder="Jane Smith"
                  value={form.name}
                  onChange={set('name')}
                  autoComplete="name"
                />
              </div>
              {errors.name && <p className="auth-error"><AlertCircle size={13} />{errors.name}</p>}
            </div>
          )}

          <div className={`auth-field ${errors.email ? 'auth-field--error' : ''}`}>
            <label className="auth-label">Email address</label>
            <div className="auth-input-wrap">
              <Mail size={16} className="auth-input-icon" />
              <input
                type="email"
                className="auth-input"
                placeholder="you@company.com"
                value={form.email}
                onChange={set('email')}
                autoComplete="email"
              />
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
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowPw(v => !v)}
                tabIndex={-1}
              >
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
              <button type="button" className="auth-forgot">Forgot password?</button>
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={loading}>
            {loading ? (
              <span className="auth-spinner" />
            ) : (
              <>
                {isRegister ? 'Create Account' : 'Sign In'}
                <ArrowRight size={16} />
              </>
            )}
            {!loading && <span className="auth-submit__shimmer" />}
          </button>
        </form>

        {/* Footer */}
        <p className="auth-footer">
          By continuing, you agree to our{' '}
          <a href="#terms">Terms of Service</a> and <a href="#privacy">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
