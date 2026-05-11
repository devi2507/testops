import React, { useState, useEffect } from 'react';
import {
  Shield, ArrowRight, Globe, Code, Database, Layers,
  Terminal, Brain, FileText, Users, Zap, CheckCircle,
  ChevronRight, Activity, Lock, BarChart3, Github, Mail
} from 'lucide-react';
import '../styles/landing.css';

const FEATURES = [
  { icon: Globe,    title: 'URL Testing',         desc: 'Scan live URLs for security headers, SSL, CORS, and more' },
  { icon: Code,     title: 'Codebase Analysis',    desc: 'Upload source code for deep vulnerability detection' },
  { icon: Database, title: 'Database Validation',   desc: 'Validate schemas, migrations, and data access patterns' },
  { icon: Layers,   title: 'Full Stack Testing',    desc: 'Combined code + database analysis for comprehensive coverage' },
  { icon: Terminal, title: 'Real-Time Logs',        desc: 'Watch test execution live with colored terminal output' },
  { icon: Brain,    title: 'AI Vulnerability Analysis', desc: 'LLM-powered root cause analysis and fix recommendations' },
  { icon: FileText, title: 'PDF Reports',           desc: 'Export professional audit reports with one click' },
  { icon: Users,    title: 'Team Collaboration',    desc: 'Share reports and coordinate fixes across your team' },
];

const WORKFLOW = [
  { step: '01', title: 'Upload',              desc: 'Code, schema, or URL',    icon: Zap },
  { step: '02', title: 'Test Recommendation', desc: 'AI selects optimal suites', icon: Brain },
  { step: '03', title: 'Execution',           desc: 'Real-time test runner',    icon: Terminal },
  { step: '04', title: 'AI Analysis',         desc: 'Deep vulnerability scan',  icon: Lock },
  { step: '05', title: 'Report Generation',   desc: 'Actionable PDF report',    icon: BarChart3 },
];

const STATS = [
  { value: '50+',  label: 'Test Suites' },
  { value: '< 2m', label: 'Avg Scan Time' },
  { value: '99%',  label: 'Detection Rate' },
  { value: '24/7', label: 'Monitoring' },
];

export default function LandingPage({ onGetStarted, onSignIn }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  return (
    <div className="landing">

      {/* ── Navbar ── */}
      <nav className={`lp-nav ${scrolled ? 'lp-nav--scrolled' : ''}`}>
        <div className="lp-nav__inner">
          <div className="lp-nav__brand">
            <div className="lp-nav__logo"><Shield size={18} color="#fff" /></div>
            <span className="lp-nav__name">TestPilot AI</span>
          </div>
          <div className="lp-nav__links">
            <a href="#features" className="lp-nav__link">Features</a>
            <button className="lp-nav__cta" onClick={onGetStarted}>
              Get Started <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="lp-hero">
        <div className="lp-hero__grid-bg" />
        <div className="lp-hero__glow lp-hero__glow--1" />
        <div className="lp-hero__glow lp-hero__glow--2" />

        <div className="lp-hero__content">
          <div className="lp-hero__badge">
            <Activity size={12} />
            AI-Powered Security Testing Platform
          </div>
          <h1 className="lp-hero__title">
            Test smarter with<br/>
            <span className="lp-hero__accent">AI Mission Control</span>
          </h1>
          <p className="lp-hero__sub">
            Automated testing, intelligent bug analysis, AI-powered reporting,
            and real-time execution monitoring for modern engineering teams.
          </p>
          <div className="lp-hero__buttons">
            <button className="lp-btn lp-btn--primary" onClick={onGetStarted}>
              Launch Platform <ArrowRight size={15} />
            </button>
            <button className="lp-btn lp-btn--ghost" onClick={onSignIn}>
              Sign In <ChevronRight size={15} />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="lp-hero__stats">
          {STATS.map(s => (
            <div key={s.label} className="lp-stat">
              <div className="lp-stat__value">{s.value}</div>
              <div className="lp-stat__label">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="lp-section" id="features">
        <div className="lp-section__inner">
          <div className="lp-section__header">
            <span className="lp-section__tag">Features</span>
            <h2 className="lp-section__title">Everything you need<br/>for security testing</h2>
            <p className="lp-section__sub">
              From URL scanning to full-stack analysis — TestPilot covers your entire testing workflow.
            </p>
          </div>

          <div className="lp-features-grid">
            {FEATURES.map(f => {
              const Icon = f.icon;
              return (
                <div key={f.title} className="lp-feature-card">
                  <div className="lp-feature-card__icon">
                    <Icon size={20} />
                  </div>
                  <h3 className="lp-feature-card__title">{f.title}</h3>
                  <p className="lp-feature-card__desc">{f.desc}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Workflow ── */}
      <section className="lp-section lp-section--alt" id="workflow">
        <div className="lp-section__inner">
          <div className="lp-section__header">
            <span className="lp-section__tag">How It Works</span>
            <h2 className="lp-section__title">From upload to report<br/>in under 2 minutes</h2>
          </div>

          <div className="lp-workflow">
            {WORKFLOW.map((w, i) => {
              const Icon = w.icon;
              return (
                <React.Fragment key={w.step}>
                  <div className="lp-workflow-step">
                    <div className="lp-workflow-step__num">{w.step}</div>
                    <div className="lp-workflow-step__icon"><Icon size={20} /></div>
                    <h3 className="lp-workflow-step__title">{w.title}</h3>
                    <p className="lp-workflow-step__desc">{w.desc}</p>
                  </div>
                  {i < WORKFLOW.length - 1 && (
                    <div className="lp-workflow-connector">
                      <ChevronRight size={16} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>
      </section>

      {/* ── Platform Preview ── */}
      <section className="lp-section" id="preview">
        <div className="lp-section__inner">
          <div className="lp-section__header">
            <span className="lp-section__tag">Platform</span>
            <h2 className="lp-section__title">Built for engineering teams</h2>
            <p className="lp-section__sub">
              A professional dashboard with real-time execution, AI analysis, and exportable reports.
            </p>
          </div>

          <div className="lp-preview-stack">
            <div className="lp-preview-card lp-preview-card--main">
              <div className="lp-preview-card__bar">
                <div className="lp-preview-card__dots">
                  <span /><span /><span />
                </div>
                <span className="lp-preview-card__label">Dashboard</span>
              </div>
              <div className="lp-preview-card__body">
                <div className="lp-mock-row">
                  <div className="lp-mock-stat"><div className="lp-mock-stat__val">A+</div><div className="lp-mock-stat__label">Security Grade</div></div>
                  <div className="lp-mock-stat"><div className="lp-mock-stat__val">94</div><div className="lp-mock-stat__label">Score</div></div>
                  <div className="lp-mock-stat"><div className="lp-mock-stat__val">3</div><div className="lp-mock-stat__label">Issues</div></div>
                  <div className="lp-mock-stat"><div className="lp-mock-stat__val">12</div><div className="lp-mock-stat__label">Tests Run</div></div>
                </div>
                <div className="lp-mock-table">
                  {['SSL Certificate Valid', 'CORS Headers Secure', 'Rate Limiting Active'].map(t => (
                    <div key={t} className="lp-mock-table__row">
                      <CheckCircle size={13} className="lp-mock-check" />
                      <span>{t}</span>
                      <span className="lp-mock-badge">Passed</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="lp-preview-card lp-preview-card--console">
              <div className="lp-preview-card__bar">
                <div className="lp-preview-card__dots"><span /><span /><span /></div>
                <span className="lp-preview-card__label">Live Execution</span>
              </div>
              <div className="lp-preview-card__body lp-preview-card__body--terminal">
                <div className="lp-term-line"><span className="lp-term-ts">12:04:01</span><span className="lp-term-ok">✓</span> SSL certificate valid (expires 2027-03-14)</div>
                <div className="lp-term-line"><span className="lp-term-ts">12:04:02</span><span className="lp-term-ok">✓</span> HSTS header present</div>
                <div className="lp-term-line"><span className="lp-term-ts">12:04:03</span><span className="lp-term-warn">⚠</span> X-Frame-Options missing</div>
                <div className="lp-term-line"><span className="lp-term-ts">12:04:04</span><span className="lp-term-info">›</span> Running AI analysis...</div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="lp-footer">
        <div className="lp-footer__inner">
          <div className="lp-footer__brand">
            <div className="lp-nav__logo"><Shield size={16} color="#fff" /></div>
            <span className="lp-nav__name" style={{ fontSize: '0.85rem' }}>TestPilot AI</span>
          </div>
          <div className="lp-footer__links">
            <a href="#features">Features</a>
            <a href="#workflow">How It Works</a>
            <a href="#preview">Platform</a>
            <a href="https://github.com" target="_blank" rel="noreferrer"><Github size={14} /> GitHub</a>
            <a href="mailto:contact@testpilot.ai"><Mail size={14} /> Contact</a>
          </div>
          <div className="lp-footer__copy">
            © {new Date().getFullYear()} TestPilot AI. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
}
