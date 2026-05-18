import React, { useState, useEffect, useRef } from 'react';
import { Database, Code, Layers, Play, UploadCloud, CheckCircle2,
         Shield, Cpu, GitBranch, Lock, Zap, Globe, Wifi, Key as KeyIcon, Save, Bookmark, Trash2 } from 'lucide-react';
import BackButton from './BackButton';
import api from '../services/api';
import './ConfigurationWizard.css';

const TEST_OPTIONS = {
  codebase: [
    { id: 'unit',        label: 'Unit Testing',           desc: 'Input validation, edge cases, error handling', icon: Cpu },
    { id: 'integration', label: 'Integration Testing',    desc: 'Layer coupling, DB calls, transactions',        icon: GitBranch },
    { id: 'security',    label: 'Code Quality & Security',desc: 'SQLi, secrets, hashing, auth, CSRF',           icon: Shield },
  ],
  database: [
    { id: 'schema',    label: 'Schema Validation',    desc: 'Data types, NOT NULL, defaults, timestamps', icon: Database },
    { id: 'query',     label: 'Query Optimization',   desc: 'Missing indexes, inefficient column types',   icon: Zap },
    { id: 'integrity', label: 'Referential Integrity', desc: 'FK constraints, CHECK rules, UNIQUE keys',    icon: Lock },
  ],
  both: [
    { id: 'e2e',       label: 'End-to-End System Tests', desc: 'Code–schema mismatches, constraint gaps', icon: Layers },
    { id: 'fullstack', label: 'Full Stack Integration',   desc: 'Compound cross-layer vulnerabilities',    icon: GitBranch },
    { id: 'dataflow',  label: 'Data Flow Security',       desc: 'PII tracing from HTTP to DB write',       icon: Shield },
  ],
  url: [
    { id: 'headers',    label: 'Security Headers',      desc: 'CSP, HSTS, X-Frame-Options, Referrer-Policy', icon: Shield },
    { id: 'ssl',        label: 'SSL / TLS',              desc: 'Certificate validity, expiry, TLS version',   icon: Lock },
    { id: 'auth',       label: 'Access Control',         desc: 'Unprotected admin/api paths, broken auth',    icon: KeyIcon },
    { id: 'cookies',    label: 'Cookie Security',        desc: 'HttpOnly, Secure, SameSite flags',            icon: Shield },
    { id: 'cors',       label: 'CORS Config',            desc: 'Wildcard origins, credential misconfig',      icon: Wifi },
    { id: 'disclosure', label: 'Info Disclosure',        desc: 'Exposed .env/.git/swagger, server headers',   icon: Zap },
    { id: 'ratelimit',  label: 'Rate Limiting',          desc: 'Login endpoint throttling & brute-force',     icon: Cpu },
  ],
};

const INPUT_TYPES = [
  { id: 'codebase', label: 'Codebase',         desc: 'Python, JS, TS, Java, Go (.zip)', icon: Code },
  { id: 'database', label: 'Database Schema',  desc: 'SQL, Prisma, Mongo JSON, or ZIP',   icon: Database },
  { id: 'both',     label: 'Full Stack',       desc: 'Code + DB — two ZIP files',        icon: Layers },
  { id: 'url',      label: 'Live URL Scan',    desc: 'No upload — just paste a URL',     icon: Globe },
];

export default function ConfigurationWizard({ onStart }) {
  const [inputType, setInputType]         = useState('codebase');
  const [selectedTests, setSelectedTests] = useState([]);
  const [file, setFile]                   = useState(null);
  const [schemaFile, setSchemaFile]       = useState(null);
  const [targetUrl, setTargetUrl]         = useState('');
  const [dragging, setDragging]           = useState(null);
  const codeDropRef   = useRef(null);
  const schemaDropRef = useRef(null);

  const [fileError, setFileError]           = useState('');
  const [schemaError, setSchemaError]       = useState('');
  const [templates, setTemplates]           = useState([]);

  useEffect(() => {
    api.getTemplates().then(setTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    setSelectedTests(TEST_OPTIONS[inputType].map(t => t.id));
    setFile(null);
    setSchemaFile(null);
    setFileError('');
    setSchemaError('');
    setTargetUrl('');
  }, [inputType]);

  const validateFile = (f, type) => {
    if (!f) return null;
    const name = f.name.toLowerCase();
    const codeExts = ['.zip', '.js', '.ts', '.py', '.java', '.go', '.rb', '.php', '.cs', '.cpp', '.c', '.h'];
    const dbExts = ['.zip', '.sql', '.json', '.prisma', '.ddl'];
    
    if (type === 'code') {
      const isDb = ['.sql', '.ddl', '.prisma'].some(e => name.endsWith(e));
      if (isDb) return 'Please upload a codebase file, not a database schema.';
      if (!codeExts.some(e => name.endsWith(e))) return 'Invalid format. Allowed: .zip, .js, .ts, .py, .java, .go, etc.';
    } else if (type === 'schema') {
      const isCode = ['.js', '.ts', '.py', '.java', '.go', '.rb', '.php', '.cs', '.cpp', '.c', '.h'].some(e => name.endsWith(e));
      if (isCode) return 'Please upload a database schema, not a codebase file.';
      if (!dbExts.some(e => name.endsWith(e))) return 'Invalid format. Allowed: .zip, .sql, .ddl, .json, .prisma';
    }
    return null;
  };

  const handleFileChange = (f, target) => {
    if (!f) return;
    const err = validateFile(f, target);
    if (target === 'schema') {
      setSchemaError(err || '');
      if (!err) setSchemaFile(f);
      else setSchemaFile(null);
    } else {
      setFileError(err || '');
      if (!err) setFile(f);
      else setFile(null);
    }
  };

  const toggleTest = (id) =>
    setSelectedTests(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    );

  const isReady = () => {
    if (selectedTests.length === 0) return false;
    if (inputType === 'url')  return targetUrl.trim().length > 4;
    if (inputType === 'both') return !!file && !!schemaFile && !fileError && !schemaError;
    if (inputType === 'database') return !!file && !fileError;
    return !!file && !fileError;
  };

  const handleDrop = (e, target) => {
    e.preventDefault();
    setDragging(null);
    const dropped = e.dataTransfer.files[0];
    if (!dropped) return;
    handleFileChange(dropped, target);
  };

  const handleStart = () => {
    if (!isReady()) return;
    if (inputType === 'url') {
      onStart({ inputType: 'url', selectedTests, targetUrl });
    } else {
      onStart({ inputType, selectedTests, file, schemaFile });
    }
  };

  const handleSaveTemplate = async () => {
    const name = prompt('Enter a name for this template:');
    if (!name) return;
    const template = {
      id: `tpl-${Date.now()}`,
      name,
      inputType,
      selectedTests,
      targetUrl: inputType === 'url' ? targetUrl : null
    };
    try {
      await api.createTemplate(template);
      setTemplates([template, ...templates]);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteTemplate = async (id, e) => {
    e.stopPropagation();
    try {
      await api.deleteTemplate(id);
      setTemplates(templates.filter(t => t.id !== id));
    } catch (e) {
      console.error(e);
    }
  };

  const applyTemplate = (t) => {
    setInputType(t.inputType);
    setSelectedTests(t.selectedTests || []);
    if (t.inputType === 'url' && t.targetUrl) setTargetUrl(t.targetUrl);
  };

  return (
    <div className="wizard">
      <BackButton label="Back" fallback="/scan" />
      {/* ── Hero ── */}
      <div className="wizard-hero">
        <div className="wizard-hero-badge">
          <Shield size={13} />
          AI Security Auditor
        </div>
        <h1 className="wizard-hero-title">Configure Your Audit</h1>
        <p className="wizard-hero-sub">
          Upload your code or schema — or paste a live URL — and let the AI surface vulnerabilities and quality issues.
        </p>
      </div>

      {/* ── Templates ── */}
      {templates.length > 0 && (
        <section className="wizard-section">
          <div className="step-label"><span className="step-num"><Bookmark size={14} /></span> Saved Templates</div>
          <div className="template-grid">
            {templates.map(t => (
              <div key={t.id} className="template-card" onClick={() => applyTemplate(t)}>
                <div className="template-card__info">
                  <span className="template-name">{t.name}</span>
                  <span className="template-meta">{INPUT_TYPES.find(i => i.id === t.inputType)?.label || t.inputType} • {t.selectedTests?.length || 0} tests</span>
                </div>
                <button className="template-del-btn" onClick={(e) => handleDeleteTemplate(t.id, e)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Step 1: Input Type ── */}
      <section className="wizard-section">
        <div className="step-label"><span className="step-num">01</span> Select Input Mode</div>
        <div className="arch-grid arch-grid--4">
          {INPUT_TYPES.map(({ id, label, desc, icon: Icon }) => (
            <button
              key={id}
              className={`arch-card ${inputType === id ? 'arch-card--active' : ''}`}
              onClick={() => setInputType(id)}
            >
              <div className={`arch-icon-wrap ${inputType === id ? 'arch-icon-wrap--active' : ''}`}>
                <Icon size={22} />
              </div>
              <span className="arch-label">{label}</span>
              <span className="arch-desc">{desc}</span>
              {inputType === id && <div className="arch-active-dot" />}
            </button>
          ))}
        </div>
      </section>

      {/* ── Step 2: Input (URL or File) ── */}
      <section className="wizard-section">
        <div className="step-label">
          <span className="step-num">02</span>
          {inputType === 'url' ? 'Enter Target URL' : 'Upload File(s)'}
        </div>

        {inputType === 'url' ? (
          /* ── URL input ── */
          <div className="url-input-wrap">
            <div className="url-input-icon"><Globe size={18} color="var(--accent-light)" /></div>
            <input
              type="url"
              className="url-input"
              placeholder="https://your-platform.com"
              value={targetUrl}
              onChange={e => setTargetUrl(e.target.value)}
            />
            {targetUrl.length > 4 && (
              <div className="url-input-ok"><CheckCircle2 size={16} color="var(--success)" /></div>
            )}
          </div>
        ) : (
          /* ── File upload ── */
          <div className={`upload-row ${inputType === 'both' ? 'upload-row--dual' : ''}`}>
            {(inputType === 'codebase' || inputType === 'both') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label
                  className={`drop-zone ${file ? 'drop-zone--filled' : ''} ${dragging === 'code' ? 'drop-zone--drag' : ''} ${fileError ? 'drop-zone--error' : ''}`}
                  ref={codeDropRef}
                  onDragOver={e => { e.preventDefault(); setDragging('code'); }}
                  onDragLeave={() => setDragging(null)}
                  onDrop={e => handleDrop(e, 'code')}
                >
                  <input type="file" accept=".zip,.py,.js,.ts,.java,.go,.rb,.php,.cs,.cpp,.c,.h" onChange={e => handleFileChange(e.target.files?.[0], 'code')} className="drop-zone__input" />
                  <div className={`drop-zone__icon ${file ? 'drop-zone__icon--filled' : ''} ${fileError ? 'drop-zone__icon--error' : ''}`}>
                    {file ? <CheckCircle2 size={28} /> : <UploadCloud size={28} />}
                  </div>
                  <div className="drop-zone__label">{file ? file.name : 'Codebase File'}</div>
                  <div className="drop-zone__hint">{file ? 'Click to replace' : 'Drop or click · .zip / .js / .py / etc'}</div>
                </label>
                {file && (
                  <button className="remove-file-btn" onClick={() => { setFile(null); setFileError(''); }}>× Remove File</button>
                )}
                {fileError && <div className="inline-file-error">{fileError}</div>}
              </div>
            )}

            {(inputType === 'database' || inputType === 'both') && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <label
                  className={`drop-zone ${(inputType === 'both' ? schemaFile : file) ? 'drop-zone--filled' : ''} ${dragging === 'schema' ? 'drop-zone--drag' : ''} ${(inputType === 'both' ? schemaError : fileError) ? 'drop-zone--error' : ''}`}
                  ref={schemaDropRef}
                  onDragOver={e => { e.preventDefault(); setDragging('schema'); }}
                  onDragLeave={() => setDragging(null)}
                  onDrop={e => handleDrop(e, inputType === 'both' ? 'schema' : 'schema')}
                >
                  <input
                    type="file"
                    accept=".zip,.sql,.json,.prisma,.ddl"
                    onChange={e => handleFileChange(e.target.files?.[0], inputType === 'both' ? 'schema' : 'schema')}
                    className="drop-zone__input"
                  />
                  <div className={`drop-zone__icon ${(inputType === 'both' ? schemaFile : file) ? 'drop-zone__icon--filled' : ''} ${(inputType === 'both' ? schemaError : fileError) ? 'drop-zone__icon--error' : ''}`}>
                    {(inputType === 'both' ? schemaFile : file) ? <CheckCircle2 size={28} /> : <Database size={28} />}
                  </div>
                  <div className="drop-zone__label">
                    {(inputType === 'both' ? schemaFile : file) ? (inputType === 'both' ? schemaFile.name : file.name) : 'Schema / DB File'}
                  </div>
                  <div className="drop-zone__hint">
                    {(inputType === 'both' ? schemaFile : file) ? 'Click to replace' : 'Drop or click · .zip / .sql / .json / .prisma'}
                  </div>
                </label>
                {(inputType === 'both' ? schemaFile : file) && (
                  <button className="remove-file-btn" onClick={() => { inputType === 'both' ? (setSchemaFile(null), setSchemaError('')) : (setFile(null), setFileError('')); }}>× Remove File</button>
                )}
                {(inputType === 'both' ? schemaError : fileError) && <div className="inline-file-error">{inputType === 'both' ? schemaError : fileError}</div>}
              </div>
            )}
          </div>
        )}

        {/* URL privacy note */}
        {inputType === 'url' && (
          <p className="url-privacy-note">
            🔒 No code or database is shared — the scanner only makes HTTP requests to your live URL.
          </p>
        )}
      </section>

      {/* ── Step 3: Test Suites ── */}
      <section className="wizard-section">
        <div className="step-label"><span className="step-num">03</span> Select Test Suites</div>
        <div className={`suite-grid ${inputType === 'url' ? 'suite-grid--url' : ''}`}>
          {TEST_OPTIONS[inputType].map(({ id, label, desc, icon: Icon }) => {
            const active = selectedTests.includes(id);
            return (
              <button
                key={id}
                className={`suite-card ${active ? 'suite-card--active' : ''}`}
                onClick={() => toggleTest(id)}
              >
                <div className="suite-card__top">
                  <div className={`suite-card__icon ${active ? 'suite-card__icon--active' : ''}`}>
                    <Icon size={18} />
                  </div>
                  <div className={`suite-card__check ${active ? 'suite-card__check--active' : ''}`}>
                    {active && <CheckCircle2 size={14} />}
                  </div>
                </div>
                <div className="suite-card__label">{label}</div>
                <div className="suite-card__desc">{desc}</div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Launch ── */}
      <div className="wizard-footer-actions">
        <button
          className="save-template-btn"
          onClick={handleSaveTemplate}
          title="Save current config as template"
        >
          <Save size={16} /> Save as Template
        </button>
        <button
          className={`launch-btn ${isReady() ? 'launch-btn--ready' : 'launch-btn--disabled'}`}
          onClick={handleStart}
          disabled={!isReady()}
        >
          <Play size={18} />
          {inputType === 'url' ? 'Launch URL Scan' : 'Initialize Testing Protocol'}
          {isReady() && <span className="launch-btn__glow" />}
        </button>
      </div>
    </div>
  );
}
