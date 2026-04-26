/**
 * WebShield AI — Frontend Application
 * Supports two scan modes:
 *  1. URL             → POST /api/scan
 *  2. Localhost Port  → POST /api/scan-localhost
 */

const API_BASE = '';

// ── State ────────────────────────────────────────────────────────────────────
let currentMode   = 'url';
let activeFilter  = 'all';
let allIssues     = [];
let selectedFiles = null;

// ── Mode switching ───────────────────────────────────────────────────────────
function switchMode(mode, btn) {
  currentMode = mode;
  document.querySelectorAll('.mode-tab').forEach(t => t.classList.remove('active'));
  btn.classList.add('active');
  document.querySelectorAll('.mode-panel').forEach(p => p.classList.add('hidden'));
  document.getElementById(`mode-${mode}`).classList.remove('hidden');
}

function setUrl(url) {
  document.getElementById('urlInput').value = url;
  document.getElementById('urlInput').focus();
}

function setPort(port) {
  document.getElementById('portInput').value = port;
  document.getElementById('portInput').focus();
}

// ── Path auto-detect (debounced) ─────────────────────────────────────────────
let detectTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  const pathInput = document.getElementById('pathInput');
  if (pathInput) {
    pathInput.addEventListener('input', () => {
      clearTimeout(detectTimer);
      const val = pathInput.value.trim();
      if (!val) { document.getElementById('detectedTypeBadge').innerHTML = ''; return; }
      detectTimer = setTimeout(() => detectType(val), 700);
    });
    pathInput.addEventListener('keydown', e => { if (e.key === 'Enter') startScan('path'); });
  }

  document.getElementById('urlInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan('url');
  });

  document.getElementById('portInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan('localhost');
  });

  document.getElementById('routeInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') startScan('localhost');
  });

  // Drop zone wiring
  const dz = document.getElementById('dropZone');
  if (dz) {
    dz.addEventListener('click', () => document.getElementById('folderInput').click());
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('drag-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
    dz.addEventListener('drop', e => {
      e.preventDefault();
      dz.classList.remove('drag-over');
      handleDroppedItems(e.dataTransfer.items);
    });
  }
});

async function detectType(folderPath) {
  try {
    const res  = await fetch(`${API_BASE}/api/detect-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath })
    });
    const data = await res.json();
    const badge = document.getElementById('detectedTypeBadge');
    const labels = {
      static:    '📄 Static HTML/CSS/JS',
      cra:       '⚛️  React (Create React App)',
      vite:      '⚡ Vite / React',
      vue:       '🟢 Vue.js',
      angular:   '🔴 Angular',
      nextjs:    '▲ Next.js',
      'node-app':'🟩 Node.js App'
    };
    if (data.type) {
      badge.innerHTML = `<span class="type-badge">Detected: ${labels[data.type] || data.type}</span>`;
    }
  } catch {}
}

// ── File / Folder selection ──────────────────────────────────────────────────
function handleFolderSelect(input) {
  selectedFiles = Array.from(input.files);
  showFileInfo(selectedFiles);
}

async function handleDroppedItems(items) {
  const files = [];
  const traverse = async (entry, prefix = '') => {
    if (entry.isFile) {
      await new Promise(resolve => {
        entry.file(f => {
          Object.defineProperty(f, 'webkitRelativePath', { value: prefix + f.name, writable: true });
          files.push(f);
          resolve();
        });
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      await new Promise(resolve => {
        reader.readEntries(async entries => {
          for (const e of entries) await traverse(e, prefix + entry.name + '/');
          resolve();
        });
      });
    }
  };
  for (const item of items) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) await traverse(entry);
  }
  selectedFiles = files;
  showFileInfo(files);
}

function showFileInfo(files) {
  const infoEl  = document.getElementById('uploadFileInfo');
  const countEl = document.getElementById('uploadFileCount');
  if (!files || !files.length) { infoEl.classList.add('hidden'); return; }
  countEl.textContent = `✅  ${files.length} file${files.length !== 1 ? 's' : ''} ready to scan`;
  infoEl.classList.remove('hidden');
}

// ── Main scan trigger ────────────────────────────────────────────────────────
async function startScan(mode) {
  document.querySelectorAll('.scan-btn').forEach(b => b.disabled = true);
  hideAll();
  document.getElementById('progressSection').classList.remove('hidden');
  animateProgress();

  try {
    let report;
    if (mode === 'url') {
      const url = document.getElementById('urlInput').value.trim();
      if (!url) { shakeInput('urlInput'); return; }
      report = await scanUrl(url);
    } else if (mode === 'localhost') {
      const port = document.getElementById('portInput').value.trim();
      const routePath = document.getElementById('routeInput')?.value.trim() || '/';
      if (!port) { shakeInput('portInput'); return; }
      report = await scanLocalhost(port, routePath);
    } else if (mode === 'path') {
      const fp = document.getElementById('pathInput')?.value.trim();
      if (!fp) { shakeInput('pathInput'); return; }
      report = await scanLocalPath(fp);
    } else if (mode === 'upload') {
      if (!selectedFiles || !selectedFiles.length) { showError('Please select a folder first.'); return; }
      report = await scanUpload(selectedFiles);
    }
    if (report) renderReport(report);
  } catch (err) {
    showError(err.message || 'Unknown error');
  } finally {
    document.querySelectorAll('.scan-btn').forEach(b => b.disabled = false);
    stopProgressAnimation();
  }
}

// ── API calls ────────────────────────────────────────────────────────────────
async function scanUrl(url) {
  const res  = await fetch(`${API_BASE}/api/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || `Error ${res.status}`);
  return data;
}

async function scanLocalhost(port, routePath = '/') {
  const res  = await fetch(`${API_BASE}/api/scan-localhost`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ port: Number(port), path: routePath })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || `Error ${res.status}`);
  return data;
}

async function scanLocalPath(folderPath) {
  const res  = await fetch(`${API_BASE}/api/scan-local-path`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderPath })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || `Error ${res.status}`);
  return data;
}

async function scanUpload(files) {
  const formData = new FormData();
  for (const file of files) {
    const relPath = file.webkitRelativePath || file.name;
    formData.append('files', file, relPath);
  }
  const res  = await fetch(`${API_BASE}/api/scan-upload`, {
    method: 'POST',
    body: formData
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.details || data.error || `Error ${res.status}`);
  return data;
}

// ── Progress animation ───────────────────────────────────────────────────────
let progressInterval = null;
let stepIdx = 0;

const STEPS = [
  { step: 1, label: 'Launching browser...',         pct: 15 },
  { step: 1, label: 'Navigating to page...',        pct: 28 },
  { step: 2, label: 'Collecting console errors...', pct: 42 },
  { step: 2, label: 'Checking broken links...',     pct: 56 },
  { step: 3, label: 'Running security checks...',   pct: 66 },
  { step: 3, label: 'Fetching security headers...', pct: 74 },
  { step: 4, label: 'Running Lighthouse audit...',  pct: 85 },
  { step: 4, label: 'Building report...',           pct: 93 },
];

function animateProgress() {
  stepIdx = 0;
  setProgressStep(STEPS[0]);
  progressInterval = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, STEPS.length - 1);
    setProgressStep(STEPS[stepIdx]);
  }, 3500);
}

function setProgressStep({ step, label, pct }) {
  document.getElementById('progressLabel').textContent = label;
  document.getElementById('progressBar').style.width = pct + '%';
  document.querySelectorAll('.step').forEach(el => {
    const s = parseInt(el.dataset.step);
    el.classList.remove('step-active', 'step-done');
    if (s < step) el.classList.add('step-done');
    else if (s === step) el.classList.add('step-active');
  });
}

function stopProgressAnimation() {
  clearInterval(progressInterval);
  document.getElementById('progressBar').style.width = '100%';
}

// ── Report Rendering ─────────────────────────────────────────────────────────
function renderReport(data) {
  hideAll();
  document.getElementById('resultsSection').classList.remove('hidden');
  allIssues = data.issues || [];
  renderScore(data);
  renderStats(data);
  renderScreenshot(data.pageInfo?.screenshot);
  renderIssues(allIssues);
  renderPerformance(data.performance);
  document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderScore(data) {
  const score    = data.score ?? 0;
  const summary  = data.summary || { label: 'Unknown', emoji: '🔷' };
  const pageInfo = data.pageInfo || {};
  const local    = data.localProject;

  const ringColor = score >= 80 ? '#68d391' : score >= 60 ? '#f6ad55' : '#fc8181';
  const fill = document.getElementById('scoreRingFill');
  fill.style.stroke = ringColor;
  setTimeout(() => {
    fill.style.strokeDashoffset = 327 - (score / 100) * 327;
  }, 100);

  const numEl = document.getElementById('scoreNumber');
  numEl.style.color = ringColor;
  let cur = 0;
  const counter = setInterval(() => {
    cur = Math.min(cur + Math.ceil(score / 30), score);
    numEl.textContent = cur;
    if (cur >= score) clearInterval(counter);
  }, 40);

  const verdictEl = document.getElementById('scoreVerdict');
  verdictEl.textContent = `${summary.emoji}  ${summary.label}`;
  verdictEl.style.color = ringColor;

  const localBadge = local
    ? `<div class="local-badge">⚡ Local — ${escapeHtml(local.projectType)}</div>`
    : '';

  document.getElementById('scanMetaInfo').innerHTML = `
    ${localBadge}
    <div>🌐 ${escapeHtml(data.url)}</div>
    ${local?.folderPath ? `<div>📂 ${escapeHtml(local.folderPath)}</div>` : ''}
    ${local?.port ? `<div>🔌 Port: ${escapeHtml(String(local.port))}</div>` : ''}
    ${local?.servedAt ? `<div>🎯 Target: ${escapeHtml(local.servedAt)}</div>` : ''}
    ${local?.filesUploaded ? `<div>📦 ${local.filesUploaded} files uploaded</div>` : ''}
    <div>📄 ${escapeHtml(pageInfo.title || 'N/A')}</div>
    <div>⏱️ Load: ${pageInfo.loadTime ? (pageInfo.loadTime / 1000).toFixed(2) + 's' : 'N/A'}</div>
    <div>🕐 Scanned in ${data.scanDuration} at ${formatDate(data.scannedAt)}</div>
  `;

  document.getElementById('newScanBtn').onclick = resetToInput;
}

function renderStats(data) {
  const issues   = data.issues || [];
  const critical = issues.filter(i => i.severity === 'critical').length;
  const medium   = issues.filter(i => i.severity === 'medium').length;
  const low      = issues.filter(i => i.severity === 'low').length;
  const broken   = (data.rawStats || {}).totalBrokenLinks ?? 0;
  document.getElementById('statsRow').innerHTML = `
    <div class="stat-card"><div class="stat-number critical">${critical}</div><div class="stat-label">Critical Issues</div></div>
    <div class="stat-card"><div class="stat-number medium">${medium}</div><div class="stat-label">Medium Issues</div></div>
    <div class="stat-card"><div class="stat-number low">${low}</div><div class="stat-label">Low Issues</div></div>
    <div class="stat-card"><div class="stat-number info">${broken}</div><div class="stat-label">Broken Links</div></div>
  `;
}

function renderScreenshot(screenshot) {
  const wrap = document.getElementById('screenshotWrap');
  const img  = document.getElementById('screenshotImg');
  if (screenshot) { img.src = screenshot; wrap.classList.remove('hidden'); }
  else wrap.classList.add('hidden');
}

function renderIssues(issues) {
  const counts = {
    all:      issues.length,
    critical: issues.filter(i => i.severity === 'critical').length,
    medium:   issues.filter(i => i.severity === 'medium').length,
    low:      issues.filter(i => i.severity === 'low').length
  };
  document.getElementById('issuesFilters').innerHTML = `
    <button class="filter-btn active"          onclick="filterIssues('all',this)">All (${counts.all})</button>
    <button class="filter-btn critical-filter" onclick="filterIssues('critical',this)">🔴 Critical (${counts.critical})</button>
    <button class="filter-btn medium-filter"   onclick="filterIssues('medium',this)">🟠 Medium (${counts.medium})</button>
    <button class="filter-btn low-filter"      onclick="filterIssues('low',this)">🟢 Low (${counts.low})</button>
  `;
  displayIssues(issues, document.getElementById('issuesGrid'));
}

function filterIssues(severity, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = severity === 'all' ? allIssues : allIssues.filter(i => i.severity === severity);
  displayIssues(filtered, document.getElementById('issuesGrid'));
}

function displayIssues(issues, gridEl) {
  if (!issues || !issues.length) {
    gridEl.innerHTML = `<div class="no-issues"><div class="no-issues-icon">✅</div><div class="no-issues-text">No issues in this category!</div></div>`;
    return;
  }
  gridEl.innerHTML = issues.map((issue, idx) => `
    <div class="issue-card ${issue.severity}" style="animation-delay:${idx * 0.04}s">
      <span class="issue-badge ${issue.severity}">${issue.severity.toUpperCase()}</span>
      <div class="issue-body">
        <div class="issue-category">${escapeHtml(issue.category)}</div>
        <div class="issue-title">${escapeHtml(issue.title)}</div>
        <div class="issue-detail">${escapeHtml(issue.detail)}</div>
      </div>
    </div>
  `).join('');
}

function renderPerformance(perf) {
  const perfGridEl    = document.getElementById('perfGrid');
  const perfMetricsEl = document.getElementById('perfMetrics');
  if (!perf || perf.error) {
    perfGridEl.innerHTML = `<div class="perf-unavailable" style="grid-column:1/-1">⚡ Lighthouse unavailable.<br><small>${escapeHtml(perf?.error || 'Chrome not detected.')}</small></div>`;
    perfMetricsEl.innerHTML = '';
    return;
  }
  const cats = [
    { label: 'Performance',    val: perf.performance },
    { label: 'Accessibility',  val: perf.accessibility },
    { label: 'Best Practices', val: perf.bestPractices },
    { label: 'SEO',            val: perf.seo }
  ];
  perfGridEl.innerHTML = cats.map(c => {
    const cls = c.val === null ? 'na' : c.val >= 90 ? 'good' : c.val >= 50 ? 'medium' : 'poor';
    return `<div class="perf-card"><div class="perf-score ${cls}">${c.val ?? 'N/A'}</div><div class="perf-cat">${c.label}</div></div>`;
  }).join('');
  const keyMetrics = ['first-contentful-paint','largest-contentful-paint','total-blocking-time','cumulative-layout-shift','speed-index','interactive','server-response-time','total-byte-weight'];
  perfMetricsEl.innerHTML = keyMetrics.filter(k => perf.metrics?.[k]).map(k => {
    const m = perf.metrics[k];
    return `<div class="metric-card"><span class="metric-name">${escapeHtml(m.title)}</span><span class="metric-value">${escapeHtml(m.displayValue)}</span></div>`;
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function hideAll() {
  ['progressSection','resultsSection','errorSection'].forEach(id =>
    document.getElementById(id).classList.add('hidden')
  );
}

function showError(msg) {
  hideAll();
  stopProgressAnimation();
  document.getElementById('errorSection').classList.remove('hidden');
  document.getElementById('errorMsg').textContent = msg;
  document.querySelectorAll('.scan-btn').forEach(b => b.disabled = false);
}

function resetToInput() {
  hideAll();
  document.getElementById('progressBar').style.width = '0%';
}

function shakeInput(id) {
  stopProgressAnimation();
  hideAll();
  document.querySelectorAll('.scan-btn').forEach(b => b.disabled = false);
  const el = document.getElementById(id);
  el.style.animation = 'shake 0.3s ease';
  setTimeout(() => el.style.animation = '', 400);
  el.focus();
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const style = document.createElement('style');
style.textContent = `@keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}40%{transform:translateX(6px)}60%{transform:translateX(-4px)}80%{transform:translateX(4px)}}`;
document.head.appendChild(style);
