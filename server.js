const express   = require('express');
const cors      = require('cors');
const path      = require('path');
const fs        = require('fs');
const multer    = require('multer');
const { runScan } = require('./src/scanner');
const { startLocalProject, stopAllLocalServers, detectProjectType } = require('./src/localProjectServer');

const app  = express();
const PORT = process.env.PORT;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── Multer: accept uploaded files into a temp folder ──────────────────────
const UPLOAD_DIR = path.join(__dirname, 'temp_uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Use a per-request subfolder to avoid collisions
    const reqDir = path.join(UPLOAD_DIR, `scan_${Date.now()}`);
    req.uploadDir = reqDir; // store for later use
    fs.mkdirSync(reqDir, { recursive: true });
    cb(null, reqDir);
  },
  filename: (req, file, cb) => {
    // Preserve original relative path (sent as field name from frontend)
    const relativePath = file.originalname; // e.g. "src/index.js"
    const fullPath = path.join(req.uploadDir || UPLOAD_DIR, relativePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    cb(null, relativePath);
  }
});

const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }); // 50 MB per file

// ── Health check ──────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'WebShield AI is running', version: '1.0.0' });
});

// ── Detect project type from a local path (helper for UI) ─────────────────
app.post('/api/detect-project', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
  try {
    const type = detectProjectType(path.resolve(folderPath));
    res.json({ type });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ── Scan a URL directly ───────────────────────────────────────────────────
app.post('/api/scan', async (req, res) => {
  const { url } = req.body;

  if (!url) return res.status(400).json({ error: 'URL is required' });

  let targetUrl = url.trim();
  if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
    targetUrl = 'https://' + targetUrl;
  }

  try { new URL(targetUrl); }
  catch { return res.status(400).json({ error: 'Invalid URL format' }); }

  console.log(`\n[WebShield] Scanning URL: ${targetUrl}`);
  try {
    const report = await runScan(targetUrl);
    res.json(report);
  } catch (err) {
    console.error('[WebShield] Scan failed:', err.message);
    res.status(500).json({ error: 'Scan failed', details: err.message });
  }
});


// ── Scan an already-running localhost app by PORT ─────────────────────────
app.post('/api/scan-localhost', async (req, res) => {
  const { port, path: routePath } = req.body;

  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ error: 'Valid localhost port is required, for example 5173, 3000, or 8080' });
  }

  let cleanPath = (routePath || '/').trim();
  if (!cleanPath.startsWith('/')) cleanPath = '/' + cleanPath;

  const targetUrl = `http://127.0.0.1:${portNum}${cleanPath}`;

  console.log(`\n[WebShield] Scanning already-running localhost app: ${targetUrl}`);
  try {
    const report = await runScan(targetUrl);
    report.localProject = {
      projectType: 'running-localhost-app',
      servedAt: targetUrl,
      port: portNum,
      routePath: cleanPath
    };
    res.json(report);
  } catch (err) {
    console.error('[WebShield] Localhost port scan failed:', err.message);
    res.status(500).json({
      error: 'Localhost scan failed',
      details: `Could not scan ${targetUrl}. Make sure your app is already running with npm run dev / npm start and the port is correct. Original error: ${err.message}`
    });
  }
});

// ── Scan a local folder by PATH (user types the path in the UI) ───────────
app.post('/api/scan-local-path', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath is required' });

  const absPath = path.resolve(folderPath.trim());
  console.log(`\n[WebShield] Scanning local folder (path): ${absPath}`);

  let localInstance = null;
  try {
    localInstance = await startLocalProject(absPath);
    console.log(`[WebShield] Project served at: ${localInstance.url} (type: ${localInstance.projectType})`);

    const report = await runScan(localInstance.url);
    report.localProject = {
      folderPath: absPath,
      projectType: localInstance.projectType,
      servedAt: localInstance.url
    };
    res.json(report);
  } catch (err) {
    console.error('[WebShield] Local scan failed:', err.message);
    res.status(500).json({ error: 'Local scan failed', details: err.message });
  } finally {
    if (localInstance) localInstance.stop();
  }
});

// ── Scan uploaded files (drag-and-drop folder via browser) ────────────────
app.post('/api/scan-upload', upload.array('files', 5000), async (req, res) => {
  // multer puts files into req.uploadDir (set in storage.destination)
  // We need to figure out the actual upload dir from the first file
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded' });
  }

  // Find the upload dir: destination of the first file
  const uploadDir = path.dirname(req.files[0].path);
  // Actually req.uploadDir might not be set because multer calls destination
  // per file. Use the common parent.
  const scanDir = findCommonRoot(req.files.map(f => f.path));

  console.log(`\n[WebShield] Scanning uploaded folder: ${scanDir} (${req.files.length} files)`);

  let localInstance = null;
  try {
    localInstance = await startLocalProject(scanDir);
    console.log(`[WebShield] Uploaded project served at: ${localInstance.url}`);

    const report = await runScan(localInstance.url);
    report.localProject = {
      folderPath: scanDir,
      projectType: localInstance.projectType,
      servedAt: localInstance.url,
      filesUploaded: req.files.length
    };
    res.json(report);
  } catch (err) {
    console.error('[WebShield] Upload scan failed:', err.message);
    res.status(500).json({ error: 'Upload scan failed', details: err.message });
  } finally {
    if (localInstance) localInstance.stop();
    // Clean up uploaded files after scan
    setTimeout(() => {
      try { fs.rmSync(scanDir, { recursive: true, force: true }); } catch {}
    }, 5000);
  }
});

/**
 * Given an array of absolute file paths, find the deepest common directory
 */
function findCommonRoot(filePaths) {
  if (!filePaths.length) return UPLOAD_DIR;
  const parts = filePaths[0].split(path.sep);
  let common = parts.slice(0, -1);
  for (const fp of filePaths) {
    const p = fp.split(path.sep);
    let i = 0;
    while (i < common.length && i < p.length && common[i] === p[i]) i++;
    common = common.slice(0, i);
  }
  return common.join(path.sep) || UPLOAD_DIR;
}

// ── Cleanup on exit ───────────────────────────────────────────────────────
process.on('SIGINT',  () => { stopAllLocalServers(); process.exit(0); });
process.on('SIGTERM', () => { stopAllLocalServers(); process.exit(0); });

app.listen(PORT, () => {
  console.log(`\n🛡️  WebShield AI is running at http://localhost:${PORT}`);
  console.log(`   Open your browser and navigate to http://localhost:${PORT}\n`);
});
