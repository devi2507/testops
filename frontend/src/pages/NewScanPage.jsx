import React, { useState, useRef } from 'react';
import {
  Code, Database, Layers, Globe, Upload, Link2,
  Shield, Lock, Eye, Zap, Network, AlertTriangle,
  CheckSquare, Activity, Search, FileCode, ChevronRight,
  ChevronLeft, Play, Check, X, Plus, Save, FolderArchive, Loader2, Trash2
} from 'lucide-react';
import BackButton from '../components/BackButton';
import { useNavigate } from 'react-router-dom';
import ProgressConsole from '../components/ProgressConsole';
import ResultsDashboard from '../components/ResultsDashboard';
import { useToast } from '../context/ToastContext';
import { useActiveScan } from '../context/ActiveScanContext';
import api from '../services/api';
import '../styles/newScan.css';

// ── Input type definitions ───────────────────────────────────────────────
const INPUT_TYPES = [
  { id: 'codebase', icon: Code,     label: 'Codebase',       desc: 'Upload a ZIP of your source code for static analysis and vulnerability scanning', color: '#6366f1', bg: 'rgba(99,102,241,0.1)' },
  { id: 'database', icon: Database, label: 'Database Schema', desc: 'Upload a SQL, Prisma, Mongo JSON, or ZIP archive of schema/migration files',      color: '#10b981', bg: 'rgba(16,185,129,0.1)' },
  { id: 'both',     icon: Layers,   label: 'Full Stack',      desc: 'Upload both codebase and database schema for a comprehensive audit',               color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
  { id: 'url',      icon: Globe,    label: 'Live URL Scan',   desc: 'Enter a URL for black-box HTTP security probing — no code required',               color: '#38bdf8', bg: 'rgba(56,189,248,0.1)' },
];

// ── Test suite definitions ───────────────────────────────────────────────
const ALL_SUITES = {
  unit:        { icon: CheckSquare,   label: 'Unit Testing',          desc: 'Input validation, edge cases, function behaviour',    time: '~30s', risk: 'Low',      modes: ['codebase','both'], riskColor: 'var(--success)' },
  integration: { icon: Network,       label: 'Integration Testing',   desc: 'DB queries, API calls, external service contracts',   time: '~45s', risk: 'Medium',   modes: ['codebase','both'], riskColor: 'var(--warning)' },
  security:    { icon: Shield,        label: 'Security Analysis',     desc: 'SQLi, secrets exposure, auth flaws, CSRF vectors',    time: '~60s', risk: 'High',     modes: ['codebase','both'], riskColor: 'var(--error)' },
  schema:      { icon: FileCode,      label: 'Schema Validation',     desc: 'NULL constraints, data types, default values',        time: '~20s', risk: 'Low',      modes: ['database','both'], riskColor: 'var(--success)' },
  query:       { icon: Zap,           label: 'Query Optimization',    desc: 'Missing indexes, slow full-table scans',              time: '~30s', risk: 'Medium',   modes: ['database','both'], riskColor: 'var(--warning)' },
  integrity:   { icon: Link2,         label: 'Referential Integrity',  desc: 'Foreign keys, CHECK constraints, UNIQUE rules',      time: '~25s', risk: 'Medium',   modes: ['database','both'], riskColor: 'var(--warning)' },
  e2e:         { icon: Layers,        label: 'End-to-End Mapping',    desc: 'Code and schema mismatch detection',                  time: '~45s', risk: 'High',     modes: ['both'],            riskColor: 'var(--error)' },
  fullstack:   { icon: Shield,        label: 'Full Stack Security',   desc: 'Compound risks across app and database layers',       time: '~60s', risk: 'High',     modes: ['both'],            riskColor: 'var(--error)' },
  dataflow:    { icon: Network,       label: 'Data Flow Security',    desc: 'Sensitive data movement, logging, and storage checks',time: '~60s', risk: 'Critical', modes: ['both'],            riskColor: 'var(--critical)' },
  headers:     { icon: Shield,        label: 'Security Headers',      desc: 'CSP, HSTS, X-Frame-Options, Referrer-Policy',        time: '~10s', risk: 'High',     modes: ['url'],             riskColor: 'var(--error)' },
  ssl:         { icon: Lock,          label: 'SSL / TLS',             desc: 'Certificate validity, expiry date, cipher strength',  time: '~15s', risk: 'High',     modes: ['url'],             riskColor: 'var(--error)' },
  auth:        { icon: AlertTriangle, label: 'Access Control',        desc: 'Admin panels, protected routes exposure',             time: '~20s', risk: 'Critical', modes: ['url'],             riskColor: 'var(--critical)' },
  cookies:     { icon: Activity,      label: 'Cookie Security',       desc: 'HttpOnly, Secure, SameSite flag auditing',            time: '~10s', risk: 'Medium',   modes: ['url'],             riskColor: 'var(--warning)' },
  cors:        { icon: Globe,         label: 'CORS Config',           desc: 'Cross-origin policy with attacker-origin test',       time: '~10s', risk: 'High',     modes: ['url'],             riskColor: 'var(--error)' },
  disclosure:  { icon: Eye,           label: 'Info Disclosure',       desc: '/.env, /.git, /swagger, /phpinfo probing',           time: '~20s', risk: 'Critical', modes: ['url'],             riskColor: 'var(--critical)' },
  ratelimit:   { icon: Search,        label: 'Rate Limiting',         desc: 'Brute-force protection on login endpoints',           time: '~15s', risk: 'Medium',   modes: ['url'],             riskColor: 'var(--warning)' },
};

const STEPS = ['Input Type', 'Upload', 'Test Suites', 'Launch'];
const SCHEMA_EXTENSIONS = ['.zip', '.sql', '.json', '.prisma'];
const CODE_EXTENSIONS   = ['.zip', '.py', '.js', '.jsx', '.ts', '.tsx', '.java', '.go', '.php', '.rb'];
const STORAGE_KEY       = 'testpilot_scan_templates';

// ── Default built-in templates (never stored, never deletable) ───────────
const DEFAULT_TEMPLATES = [
  { id: 'tpl-full-security',     name: 'Full Security Audit',     inputType: 'both',     selected: ['security','schema','integrity','fullstack','dataflow'], description: 'Code, schema, and data-flow checks for release readiness.' },
  { id: 'tpl-api-regression',    name: 'API Regression Scan',     inputType: 'url',      selected: ['headers','ssl','auth','cookies','cors','disclosure','ratelimit'], description: 'Black-box web controls for public APIs and dashboards.' },
  { id: 'tpl-frontend-stability',name: 'Frontend Stability Scan', inputType: 'codebase', selected: ['unit','integration'], description: 'Validation and integration checks for UI-heavy codebases.' },
];

const loadUserTemplates = () => {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
};

const saveUserTemplates = (list) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
};

const normalizeSuiteId = (id) => id === 'access' ? 'auth' : id;

const hasHttpScheme = (value = '') => /^https?:\/\//i.test(value.trim());

const normalizeTargetUrl = (value = '') => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return hasHttpScheme(trimmed) ? trimmed : `https://${trimmed}`;
};

const isValidHttpUrl = (value = '') => {
  try {
    const parsed = new URL(normalizeTargetUrl(value));
    return ['http:', 'https:'].includes(parsed.protocol) && !!parsed.hostname;
  } catch {
    return false;
  }
};

const fileKind = (name = '') => {
  const lower = name.toLowerCase();
  if (lower.endsWith('.zip'))    return 'ZIP archive';
  if (lower.endsWith('.sql'))    return 'SQL schema';
  if (lower.endsWith('.prisma')) return 'Prisma schema';
  if (lower.endsWith('.json'))   return 'Mongo/JSON export';
  return 'Source file';
};

const suitesForType = (type) => Object.entries(ALL_SUITES)
  .filter(([, s]) => type && s.modes.includes(type))
  .map(([id, s]) => ({ id, ...s }));

const templateDescription = (type, suites) =>
  `${suites.length} suite${suites.length === 1 ? '' : 's'} for ${type} scans.`;

export default function NewScanPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const { startActiveScan } = useActiveScan();
  const [step, setStep]               = useState(0);
  const [inputType, setInputType]     = useState(null);
  const [file, setFile]               = useState(null);
  const [schemaFile, setSchemaFile]   = useState(null);
  const [extraFiles, setExtraFiles]   = useState([]);
  const [schemaExtraFiles, setSchemaExtraFiles] = useState([]);
  const [url, setUrl]                 = useState('');
  const [urlValid, setUrlValid]       = useState(false);
  const [selected, setSelected]       = useState([]);
  const [drag, setDrag]               = useState(false);
  const [schemaDrag, setSchemaDrag]   = useState(false);
  const [phase, setPhase]             = useState('wizard');
  const [launching, setLaunching]     = useState(false);
  const [testId, setTestId]           = useState(null);
  const [results, setResults]         = useState(null);
  const [error, setError]             = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [userTemplates, setUserTemplates] = useState(loadUserTemplates);
  const [uploadPct, setUploadPct]     = useState(0);

  // Template modal state
  const [tplModalOpen, setTplModalOpen] = useState(false);
  const [tplInputType, setTplInputType]   = useState('codebase');
  const [tplSelected, setTplSelected]     = useState([]);
  const [tplName, setTplName]           = useState('');
  const [tplDesc, setTplDesc]           = useState('');

  const fileRef   = useRef();
  const schemaRef = useRef();

  // ── Available suites for current input type ──
  const availableSuites = suitesForType(inputType);
  const templateSuites  = suitesForType(tplInputType);

  // ── Validation per step ──
  const canNext = () => {
    if (launching) return false;
    if (step === 0) return !!inputType;
    if (step === 1) {
      if (inputType === 'url')  return urlValid;
      if (inputType === 'both') return !!file && !!schemaFile;
      return !!file;
    }
    if (step === 2) return selected.length > 0;
    return true;
  };

  const setFieldError   = (f, m) => setFieldErrors(p => ({ ...p, [f]: m }));
  const clearFieldError = (f)    => setFieldErrors(p => { const n = { ...p }; delete n[f]; return n; });

  const goNext = () => {
    if (step === 1 && selected.length === 0) setSelected(availableSuites.map(s => s.id));
    setStep(s => s + 1);
  };

  // ── File handlers ──
  const validateFile = (f, isSchema = false) => {
    const lower = f.name.toLowerCase();
    const allowed = isSchema || inputType === 'database' ? SCHEMA_EXTENSIONS : CODE_EXTENSIONS;
    return allowed.some(ext => lower.endsWith(ext));
  };

  const handleFiles = (files, isSchema = false) => {
    const list  = Array.from(files || []);
    const field = isSchema ? 'schemaFile' : 'file';
    if (!list.length) return;
    const dup = list.find((f, i) => list.findIndex(o => o.name.toLowerCase() === f.name.toLowerCase()) !== i);
    if (dup) { const m = `${dup.name} was selected more than once.`; setError(m); setFieldError(field, m); toast?.warning(m); return; }
    if (isSchema && file && file.name.toLowerCase() === list[0].name.toLowerCase()) {
      const m = 'Schema upload must be different from the codebase upload.'; setError(m); setFieldError(field, m); toast?.warning(m); return;
    }
    if (!isSchema && schemaFile && schemaFile.name.toLowerCase() === list[0].name.toLowerCase()) {
      const m = 'Codebase upload must be different from the schema upload.'; setError(m); setFieldError(field, m); toast?.warning(m); return;
    }
    const invalid = list.find(f => !validateFile(f, isSchema));
    if (invalid) {
      const allowed = isSchema || inputType === 'database' ? SCHEMA_EXTENSIONS.join(', ') : CODE_EXTENSIONS.join(', ');
      const m = `${invalid.name} is not supported. Allowed: ${allowed}.`; setError(m); setFieldError(field, m); toast?.error('Upload failed'); return;
    }
    if (isSchema) { setSchemaFile(list[0]); setSchemaExtraFiles(list.slice(1)); }
    else          { setFile(list[0]);       setExtraFiles(list.slice(1)); }
    setError(null); clearFieldError(field); toast?.success('Upload validated');
    setUploadPct(100); setTimeout(() => setUploadPct(0), 900);
  };

  const handleDrop = (e, isSchema = false) => {
    e.preventDefault(); isSchema ? setSchemaDrag(false) : setDrag(false);
    handleFiles(e.dataTransfer.files, isSchema);
  };

  const handleUrl = (v) => {
    setUrl(v);
    const valid = isValidHttpUrl(v);
    setUrlValid(valid);
    if (v.trim() && !valid) setFieldError('url', 'Enter a valid HTTP or HTTPS URL.');
    else clearFieldError('url');
  };

  const toggleSuite = (id) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const selectAll   = () => setSelected(availableSuites.map(s => s.id));
  const clearAll    = () => setSelected([]);

  // ── Apply template ──
  const applyTemplate = (tpl) => {
    setInputType(tpl.inputType);
    setSelected(tpl.selected.map(normalizeSuiteId));
    setError(null); setFieldErrors({});
    setStep(1);
    toast?.info(`Template "${tpl.name}" applied`);
  };

  // ── Create template (modal) ──
  const openTplModal = () => {
    const draftInputType = inputType || 'codebase';
    const draftSelected = inputType && selected.length > 0
      ? selected
      : suitesForType(draftInputType).map(s => s.id);
    const suggestedName = `${INPUT_TYPES.find(t => t.id === draftInputType)?.label || 'Scan'} Template`;
    setTplInputType(draftInputType);
    setTplSelected(draftSelected);
    setTplName(suggestedName);
    setTplDesc(templateDescription(draftInputType, draftSelected));
    setTplModalOpen(true);
  };

  const updateTplInputType = (type) => {
    const nextSelected = suitesForType(type).map(s => s.id);
    setTplInputType(type);
    setTplSelected(nextSelected);
    setTplName(`${INPUT_TYPES.find(t => t.id === type)?.label || 'Scan'} Template`);
    setTplDesc(templateDescription(type, nextSelected));
  };

  const toggleTplSuite = (id) => {
    setTplSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  const confirmCreateTemplate = () => {
    const name = tplName.trim();
    if (!name) return;
    if (!tplInputType || tplSelected.length === 0) {
      const m = 'Select at least one test suite for the template.';
      setError(m);
      toast?.warning(m);
      return;
    }
    const tpl = {
      id:          `tpl-${Date.now()}`,
      name,
      inputType:   tplInputType,
      selected:    tplSelected.map(normalizeSuiteId),
      description: tplDesc.trim() || templateDescription(tplInputType, tplSelected),
      createdAt:   new Date().toISOString(),
    };
    const updated = [...userTemplates, tpl];
    setUserTemplates(updated);
    saveUserTemplates(updated);
    setTplModalOpen(false);
    toast?.success(`Template "${name}" saved`);
  };

  // ── Delete user template ──
  const deleteTemplate = (id, e) => {
    e.stopPropagation();
    const updated = userTemplates.filter(t => t.id !== id);
    setUserTemplates(updated);
    saveUserTemplates(updated);
    toast?.info('Template deleted');
  };

  // ── Launch scan ──
  const handleLaunch = async () => {
    setError(null);
    if (!inputType)                          { const m = 'Choose an input type before launching.';          setError(m); setFieldError('launch', m); toast?.error(m); return; }
    if (inputType === 'url' && !urlValid)    { const m = 'Enter a valid URL before launching.';             setError(m); setFieldError('url', m);    toast?.error(m); return; }
    if (inputType !== 'url' && !file)        { const m = 'Upload a file before launching.';                 setError(m); setFieldError('file', m);   toast?.error(m); return; }
    if (inputType === 'both' && !schemaFile) { const m = 'Upload a database schema file before launching.'; setError(m); setFieldError('schemaFile', m); toast?.error(m); return; }
    if (selected.length === 0)               { const m = 'Select at least one test suite before launching.';setError(m); setFieldError('launch', m); toast?.error(m); return; }

    setLaunching(true); clearFieldError('launch'); toast?.info('Initializing scan...');
    try {
      const fd = new FormData();
      if (inputType === 'url') {
        const finalUrl = normalizeTargetUrl(url);
        fd.append('targetUrl', finalUrl);
        fd.append('selectedTests', selected.map(normalizeSuiteId).join(','));
        const data = await api.startUrlScan(fd);
        setTestId(data.testId);
        startActiveScan(data.testId, finalUrl, 'url');
        navigate(`/scan/live/${data.testId}`);
      } else {
        fd.append('inputType', inputType);
        fd.append('selectedTests', selected.map(normalizeSuiteId).join(','));
        fd.append('file', file);
        if (schemaFile) fd.append('schemaFile', schemaFile);
        const data = await api.startScan(fd);
        setTestId(data.testId);
        startActiveScan(data.testId, file.name, inputType);
        navigate(`/scan/live/${data.testId}`);
      }
      toast?.success('Scan started');
    } catch (err) {
      const m = err.message.includes('fetch') ? 'Cannot reach backend — ensure it is running on port 8000.' : err.message;
      setError(m); toast?.error(m);
    } finally { setLaunching(false); }
  };

  const handleComplete = async (id) => {
    try { const data = await api.getResults(id); setResults(data); setPhase('results'); toast?.success('Report generated'); }
    catch { setError('Failed to retrieve results.'); toast?.error('Failed to retrieve results.'); }
  };

  const reset = () => {
    setStep(0); setInputType(null); setFile(null); setSchemaFile(null);
    setExtraFiles([]); setSchemaExtraFiles([]);
    setUrl(''); setUrlValid(false); setSelected([]);
    setPhase('wizard'); setLaunching(false); setTestId(null); setResults(null); setError(null); setFieldErrors({});
  };

  // ── Progress / Results views ──
  if (phase === 'progress') return (
    <div className="newscan-outer">
      <ProgressConsole testId={testId} onComplete={() => handleComplete(testId)} onError={(m) => { setError(m); toast?.error(m); setPhase('wizard'); }} />
    </div>
  );
  if (phase === 'results') return (
    <div className="newscan-outer">
      <ResultsDashboard results={results} testId={testId} onReset={reset} />
    </div>
  );

  // ── Wizard ──
  return (
    <div className="newscan-outer">
      <BackButton label="Back" fallback="/dashboard" />

      {/* Error banner */}
      {error && (
        <div className="newscan-error">
          <X size={15} /> {error}
          <button onClick={() => setError(null)}><X size={13} /></button>
        </div>
      )}

      {/* ── Step indicator ── */}
      <div className="newscan-steps">
        {STEPS.map((label, i) => (
          <React.Fragment key={i}>
            <div className={`step-node ${i === step ? 'step-node--active' : i < step ? 'step-node--done' : ''}`}>
              <div className="step-node__circle">
                {i < step ? <Check size={14} /> : <span>{i + 1}</span>}
              </div>
              <span className="step-node__label">{label}</span>
            </div>
            {i < STEPS.length - 1 && <div className={`step-connector ${i < step ? 'step-connector--done' : ''}`} />}
          </React.Fragment>
        ))}
      </div>

      {/* ── Step content ── */}
      <div className="newscan-content glass-card animate-fade-up">

        {/* STEP 0 — Input Type + Templates */}
        {step === 0 && (
          <div className="newscan-step">
            <div className="newscan-step__head">
              <h2>Select Input Type</h2>
              <p>Choose what you want to audit. Your selection determines which tests are available.</p>
            </div>
            <div className="input-type-grid">
              {INPUT_TYPES.map(({ id, icon: Icon, label, desc, color, bg }) => (
                <button
                  key={id}
                  className={`input-type-card ${inputType === id ? 'input-type-card--active' : ''}`}
                  onClick={() => { setInputType(id); setSelected([]); setFile(null); setSchemaFile(null); setExtraFiles([]); setSchemaExtraFiles([]); setUrl(''); setUrlValid(false); setError(null); setFieldErrors({}); }}
                  style={{ '--card-color': color, '--card-bg': bg }}
                >
                  <div className="input-type-card__icon" style={{ background: bg, color }}>
                    <Icon size={24} />
                  </div>
                  <div className="input-type-card__text">
                    <span className="input-type-card__label">{label}</span>
                    <span className="input-type-card__desc">{desc}</span>
                  </div>
                  {inputType === id && <div className="input-type-card__check"><Check size={12} /></div>}
                </button>
              ))}
            </div>

            {/* Next Button for Step 0 */}
            <div className={`step-0-action ${inputType ? 'step-0-action--active' : ''}`}>
              <button 
                className="step-0-next-btn"
                disabled={!canNext()} 
                onClick={goNext}
              >
                Next <ChevronRight size={16} />
              </button>
            </div>

            {/* Templates panel */}
            <div className="template-panel">
              <div className="template-panel__head">
                <div>
                  <h3>Scan Templates</h3>
                  <p>Start from a saved testing pattern and adjust before launch.</p>
                </div>
                <button className="template-create-btn" onClick={openTplModal}>
                  <Plus size={13} /> Create Template
                </button>
              </div>

              {/* Default templates */}
              <div className="template-section-label">Built-in</div>
              <div className="template-grid">
                {DEFAULT_TEMPLATES.map(tpl => (
                  <button key={tpl.id} className="template-card template-card--default" onClick={() => applyTemplate(tpl)}>
                    <div className="template-card__top">
                      <Save size={13} />
                      <span>{INPUT_TYPES.find(t => t.id === tpl.inputType)?.label}</span>
                    </div>
                    <strong>{tpl.name}</strong>
                    <p>{tpl.description}</p>
                  </button>
                ))}
              </div>

              {/* User templates */}
              {userTemplates.length > 0 && (
                <>
                  <div className="template-section-label" style={{ marginTop: '14px' }}>My Templates</div>
                  <div className="template-grid">
                    {userTemplates.map(tpl => (
                      <div key={tpl.id} className="template-card template-card--user">
                        <button className="template-card__body" onClick={() => applyTemplate(tpl)}>
                          <div className="template-card__top">
                            <Save size={13} />
                            <span>{INPUT_TYPES.find(t => t.id === tpl.inputType)?.label}</span>
                          </div>
                          <strong>{tpl.name}</strong>
                          <p>{tpl.description}</p>
                        </button>
                        <button
                          className="template-card__delete"
                          onClick={(e) => deleteTemplate(tpl.id, e)}
                          title="Delete template"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {userTemplates.length === 0 && (
                <p className="template-empty-hint">Create your first custom template here, or save one from the Test Suites step.</p>
              )}
            </div>
          </div>
        )}

        {/* STEP 1 — Upload */}
        {step === 1 && (
          <div className="newscan-step">
            <div className="newscan-step__head">
              <h2>{inputType === 'url' ? 'Enter Target URL' : 'Upload Your Files'}</h2>
              <p>
                {inputType === 'url'
                  ? 'We will probe the target using HTTP requests only — your code is never shared.'
                  : inputType === 'database'
                    ? 'Upload .zip, .sql, .json, or .prisma files.'
                    : 'Upload a ZIP file. All processing happens on your local backend.'}
              </p>
            </div>

            {inputType === 'url' && (
              <div className="url-section">
                <div className={`url-input-box ${urlValid ? 'url-input-box--valid' : ''}`}>
                  <Globe size={18} className="url-input-box__icon" />
                  <input className="url-input-box__field" type="text" placeholder="https://your-platform.com" value={url} onChange={e => handleUrl(e.target.value)} autoFocus />
                  {urlValid && <Check size={16} className="url-input-box__check" />}
                </div>
                {fieldErrors.url && <div className="inline-field-error">{fieldErrors.url}</div>}
                <div className="url-privacy-note">🔒 Privacy-first — no source code is uploaded or shared. Only HTTP requests are made to the target URL.</div>
              </div>
            )}

            {inputType !== 'url' && (
              <div className={`upload-zones ${inputType === 'both' ? 'upload-zones--dual' : ''}`}>
                <DropZone
                  label={inputType === 'database' ? 'Database Schema' : 'Codebase Archive'}
                  hint={inputType === 'database' ? 'Drop .zip, .sql, .json, or .prisma' : 'Drop .zip archive'}
                  file={file} dragging={drag}
                  onDragOver={e => { e.preventDefault(); setDrag(true); }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={e => handleDrop(e)}
                  onClick={() => fileRef.current.click()}
                  inputRef={fileRef}
                  onChange={e => handleFiles(e.target.files)}
                  accept={inputType === 'database' ? SCHEMA_EXTENSIONS.join(',') : CODE_EXTENSIONS.join(',')}
                  icon={inputType === 'database' ? Database : Code}
                  multiple extraFiles={extraFiles} error={fieldErrors.file}
                />
                {inputType === 'both' && (
                  <DropZone
                    label="Database Schema" hint="Drop .zip, .sql, .json, or .prisma"
                    file={schemaFile} dragging={schemaDrag}
                    onDragOver={e => { e.preventDefault(); setSchemaDrag(true); }}
                    onDragLeave={() => setSchemaDrag(false)}
                    onDrop={e => handleDrop(e, true)}
                    onClick={() => schemaRef.current.click()}
                    inputRef={schemaRef}
                    onChange={e => handleFiles(e.target.files, true)}
                    accept={SCHEMA_EXTENSIONS.join(',')}
                    icon={Database} multiple extraFiles={schemaExtraFiles} error={fieldErrors.schemaFile}
                  />
                )}
              </div>
            )}
            {inputType !== 'url' && (!file || (inputType === 'both' && !schemaFile)) && (
              <div className="upload-empty-note">
                <FolderArchive size={15} />
                <span>
                  {inputType === 'database' ? 'No schema upload selected yet.' : inputType === 'both' ? 'Add both a codebase upload and a schema upload to continue.' : 'No codebase upload selected yet.'}
                </span>
              </div>
            )}
            {uploadPct > 0 && (
              <div className="upload-progress">
                <div className="upload-progress__bar" style={{ width: `${uploadPct}%` }} />
                <span>Files validated</span>
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — Test Suites */}
        {step === 2 && (
          <div className="newscan-step">
            <div className="newscan-step__head">
              <h2>Select Test Suites</h2>
              <p>Choose which security and quality checks to run. All recommended suites are pre-selected.</p>
            </div>
            <div className="suite-controls">
              <span className="suite-controls__count">{selected.length} of {availableSuites.length} selected</span>
              <button className="suite-controls__btn" onClick={selectAll}>Select all</button>
              <button className="suite-controls__btn" onClick={clearAll}>Clear all</button>
              <button
                className="suite-controls__btn suite-controls__btn--save"
                onClick={openTplModal}
                disabled={!inputType || selected.length === 0}
                title="Save current selection as a reusable template"
              >
                <Plus size={12} /> Save as template
              </button>
            </div>
            <div className="suite-grid-new">
              {availableSuites.map(({ id, icon: Icon, label, desc, time, risk, riskColor }) => {
                const active = selected.includes(id);
                return (
                  <button key={id} className={`suite-card-new ${active ? 'suite-card-new--active' : ''}`} onClick={() => toggleSuite(id)}>
                    <div className="suite-card-new__top">
                      <div className={`suite-card-new__icon ${active ? 'suite-card-new__icon--active' : ''}`}><Icon size={16} /></div>
                      <div className={`suite-card-new__check ${active ? 'suite-card-new__check--active' : ''}`}>{active && <Check size={10} />}</div>
                    </div>
                    <div className="suite-card-new__label">{label}</div>
                    <div className="suite-card-new__desc">{desc}</div>
                    <div className="suite-card-new__footer">
                      <span className="suite-card-new__time">{time}</span>
                      <span className="suite-card-new__risk" style={{ color: riskColor }}>{risk}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* STEP 3 — Launch */}
        {step === 3 && (
          <div className="newscan-step newscan-step--launch">
            <div className="newscan-step__head">
              <h2>Ready to Launch</h2>
              <p>Review your configuration and initialize the testing protocol.</p>
            </div>
            <div className="launch-summary">
              <SummaryRow label="Input Type" value={INPUT_TYPES.find(t => t.id === inputType)?.label} icon={INPUT_TYPES.find(t => t.id === inputType)?.icon} />
              <SummaryRow label="Target" value={inputType === 'url' ? (url.startsWith('http') ? url : `https://${url}`) : file?.name} mono />
              {inputType === 'both' && schemaFile && <SummaryRow label="Schema" value={schemaFile.name} mono />}
              <SummaryRow label="Test Suites" value={`${selected.length} suite${selected.length !== 1 ? 's' : ''} selected`} />
              <div className="launch-summary__suites">
                {selected.map(id => <span key={id} className="badge badge--accent">{ALL_SUITES[id]?.label}</span>)}
              </div>
            </div>
            <button className="launch-btn-big" onClick={handleLaunch} disabled={launching}>
              {launching ? <Loader2 size={20} className="spin" /> : <Play size={20} />}
              {launching ? 'Initializing Scan...' : 'Initialize Testing Protocol'}
              <span className="launch-btn-big__shimmer" />
            </button>
            {fieldErrors.launch && <div className="inline-field-error">{fieldErrors.launch}</div>}
            <p className="launch-note">The AI engine will analyse your target using the selected test suites and generate a detailed security report.</p>
          </div>
        )}
      </div>

      {/* ── Navigation ── */}
      <div className="newscan-nav">
        {step > 0
          ? <button className="newscan-nav__back" onClick={() => setStep(s => s - 1)} disabled={launching}><ChevronLeft size={16} /> Back</button>
          : <div />
        }
        {step > 0 && step < 3 && (
          <button className="newscan-nav__next" disabled={!canNext()} onClick={goNext}>
            {step === 2 ? 'Review & Launch' : 'Next'} <ChevronRight size={16} />
          </button>
        )}
      </div>

      {/* ── Create Template Modal ── */}
      {tplModalOpen && (
        <div className="modal-backdrop" onClick={() => setTplModalOpen(false)}>
          <div className="tpl-modal glass-card" onClick={e => e.stopPropagation()}>
            <div className="tpl-modal__head">
              <div>
                <h3>Save as Template</h3>
                <p>{tplSelected.length} suite{tplSelected.length !== 1 ? 's' : ''} · {INPUT_TYPES.find(t => t.id === tplInputType)?.label}</p>
              </div>
              <button className="tpl-modal__close" onClick={() => setTplModalOpen(false)}><X size={15} /></button>
            </div>
            <div className="tpl-modal__body">
              <label className="tpl-modal__label">Template name <span className="tpl-modal__req">*</span></label>
              <input
                className="tpl-modal__input"
                placeholder="e.g. Pre-release Security Check"
                value={tplName}
                onChange={e => setTplName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && confirmCreateTemplate()}
                autoFocus
                maxLength={60}
              />
              <label className="tpl-modal__label" style={{ marginTop: '12px' }}>Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span></label>
              <input
                className="tpl-modal__input"
                placeholder="Short description of what this template covers"
                value={tplDesc}
                onChange={e => setTplDesc(e.target.value)}
                maxLength={120}
              />
              <label className="tpl-modal__label" style={{ marginTop: '12px' }}>Input type</label>
              <div className="tpl-modal__types">
                {INPUT_TYPES.map(({ id, label }) => (
                  <button
                    key={id}
                    type="button"
                    className={`tpl-modal__type ${tplInputType === id ? 'tpl-modal__type--active' : ''}`}
                    onClick={() => updateTplInputType(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <label className="tpl-modal__label" style={{ marginTop: '12px' }}>Test suites <span className="tpl-modal__req">*</span></label>
              <div className="tpl-modal__suites">
                {templateSuites.map(({ id, label }) => {
                  const active = tplSelected.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      className={`tpl-modal__suite ${active ? 'tpl-modal__suite--active' : ''}`}
                      onClick={() => toggleTplSuite(id)}
                    >
                      {active && <Check size={11} />} {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="tpl-modal__footer">
              <button className="tpl-modal__cancel" onClick={() => setTplModalOpen(false)}>Cancel</button>
              <button className="tpl-modal__save" onClick={confirmCreateTemplate} disabled={!tplName.trim() || tplSelected.length === 0}>
                <Save size={14} /> Save Template
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────
function DropZone({ label, hint, file, dragging, onDragOver, onDragLeave, onDrop, onClick, inputRef, onChange, accept, icon: Icon, multiple, extraFiles = [], error }) {
  return (
    <div
      className={`drop-zone-new ${dragging ? 'drop-zone-new--drag' : ''} ${file ? 'drop-zone-new--filled' : ''} ${error ? 'drop-zone-new--error' : ''}`}
      onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop} onClick={onClick}
    >
      <input ref={inputRef} type="file" accept={accept} multiple={multiple} style={{ display:'none' }} onChange={onChange} />
      <div className={`drop-zone-new__icon ${file ? 'drop-zone-new__icon--filled' : ''}`}>
        {file ? <Check size={28} /> : <Icon size={28} />}
      </div>
      <div className="drop-zone-new__label">{file ? file.name : label}</div>
      <div className="drop-zone-new__hint">{file ? `${fileKind(file.name)} · ${(file.size / 1024).toFixed(1)} KB` : hint}</div>
      {extraFiles.length > 0 && (
        <div className="drop-zone-new__extras"><FolderArchive size={12} />{extraFiles.length} additional file{extraFiles.length === 1 ? '' : 's'} selected</div>
      )}
      {!file && <div className="drop-zone-new__cta"><Upload size={13} /> Click or drag &amp; drop</div>}
      {error && <div className="inline-field-error">{error}</div>}
    </div>
  );
}

function SummaryRow({ label, value, icon: Icon, mono }) {
  return (
    <div className="summary-row">
      <span className="summary-row__label">{label}</span>
      <span className={`summary-row__value ${mono ? 'summary-row__value--mono' : ''}`}>
        {Icon && <Icon size={14} />}{value || '—'}
      </span>
    </div>
  );
}
