/**
 * localProjectServer.js
 *
 * Receives a folder path from the user, detects the project type,
 * serves it on a free local port, and returns the URL to scan.
 *
 * Supported project types (auto-detected):
 *  - Static HTML/CSS/JS  → served directly with express.static
 *  - React (CRA / Vite)  → runs `npm run build` then serves /dist or /build
 *  - Vue (Vite)          → runs `npm run build` then serves /dist
 *  - Angular             → runs `ng build` then serves /dist/<name>
 *  - Next.js             → runs `npm run build && npm run export` or `next start`
 *  - Any unknown with index.html → treated as static
 */

const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const { execSync, spawn } = require('child_process');
const net       = require('net');

// Track active local servers so we can shut them down after scan
const activeServers = new Map(); // port → { server, type, folderPath }

/**
 * Detect what kind of project the folder contains
 */
function detectProjectType(folderPath) {
  const pkgPath = path.join(folderPath, 'package.json');
  let pkg = null;

  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {}
  }

  const hasDep = (name) => {
    if (!pkg) return false;
    return !!(
      (pkg.dependencies && pkg.dependencies[name]) ||
      (pkg.devDependencies && pkg.devDependencies[name])
    );
  };

  const hasScript = (name) => pkg && pkg.scripts && pkg.scripts[name];
  const hasFile   = (f)    => fs.existsSync(path.join(folderPath, f));

  // Next.js
  if (hasDep('next')) return 'nextjs';

  // Angular
  if (hasFile('angular.json') || hasDep('@angular/core')) return 'angular';

  // React (Vite)
  if (hasDep('@vitejs/plugin-react') || hasDep('vite')) return 'vite';

  // React (CRA)
  if (hasDep('react-scripts')) return 'cra';

  // Vue
  if (hasDep('vue')) return 'vue';

  // Has package.json with a build script → generic node project
  if (pkg && hasScript('build') && hasScript('start')) return 'node-app';

  // Has index.html → treat as static
  if (hasFile('index.html') || hasFile('public/index.html')) return 'static';

  return 'static'; // fallback
}

/**
 * Find the output folder after a build
 */
function findBuildOutput(folderPath, type) {
  const candidates = {
    cra:     ['build'],
    vite:    ['dist'],
    vue:     ['dist'],
    angular: ['dist'],
    nextjs:  ['out', '.next'],
    static:  ['.', 'public', 'src'],
  };

  const list = candidates[type] || ['.'];
  for (const dir of list) {
    const full = path.join(folderPath, dir);
    if (fs.existsSync(full)) {
      // For angular, find the subfolder inside dist/
      if (type === 'angular' && dir === 'dist') {
        const sub = fs.readdirSync(full).find(d =>
          fs.statSync(path.join(full, d)).isDirectory()
        );
        if (sub) return path.join(full, sub);
      }
      return full;
    }
  }
  return folderPath; // fallback: serve the root
}

/**
 * Run a build command inside the project folder
 */
function runBuild(folderPath, type) {
  const commands = {
    cra:     'npm run build',
    vite:    'npm run build',
    vue:     'npm run build',
    angular: 'npx ng build --configuration production',
    nextjs:  'npm run build && npm run export',
  };

  const cmd = commands[type];
  if (!cmd) return; // no build needed (static / node-app)

  console.log(`[LocalServer] Running build: ${cmd}`);
  try {
    execSync(cmd, {
      cwd: folderPath,
      stdio: 'pipe',
      timeout: 120000 // 2 min max
    });
    console.log('[LocalServer] Build succeeded');
  } catch (err) {
    const msg = err.stderr?.toString() || err.message;
    throw new Error(`Build failed for ${type} project:\n${msg.slice(0, 400)}`);
  }
}

/**
 * Find a free TCP port
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Serve a static folder on a free port using Express
 * Returns { url, port, stop() }
 */
async function serveStaticFolder(folderPath) {
  const port = await getFreePort();
  const app  = express();

  app.use(express.static(folderPath, { index: 'index.html' }));

  // SPA fallback — serve index.html for unknown routes
  app.get('*', (req, res) => {
    const indexPath = path.join(folderPath, 'index.html');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(404).send('index.html not found in this folder');
    }
  });

  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.on('error', reject);
  });

  const url = `http://localhost:${port}`;
  console.log(`[LocalServer] Serving "${path.basename(folderPath)}" at ${url}`);

  activeServers.set(port, { server, folderPath });

  return {
    url,
    port,
    stop: () => {
      server.close();
      activeServers.delete(port);
      console.log(`[LocalServer] Stopped server on port ${port}`);
    }
  };
}

/**
 * Main function: given a folder path, detect type, build if needed, serve, return URL + stopper
 */
async function startLocalProject(folderPath) {
  // Normalize and validate path
  const absPath = path.resolve(folderPath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`Folder not found: ${absPath}`);
  }

  if (!fs.statSync(absPath).isDirectory()) {
    throw new Error(`Path is not a folder: ${absPath}`);
  }

  const type = detectProjectType(absPath);
  console.log(`[LocalServer] Detected project type: ${type}`);

  // For built frameworks, run npm install + build first
  const needsBuild = ['cra', 'vite', 'vue', 'angular', 'nextjs'].includes(type);

  if (needsBuild) {
    const nodeModules = path.join(absPath, 'node_modules');
    if (!fs.existsSync(nodeModules)) {
      console.log('[LocalServer] Installing dependencies (npm install)...');
      try {
        execSync('npm install', { cwd: absPath, stdio: 'pipe', timeout: 180000 });
      } catch (err) {
        throw new Error(`npm install failed: ${err.message.slice(0, 300)}`);
      }
    }
    runBuild(absPath, type);
  }

  const buildOutput = findBuildOutput(absPath, type);
  console.log(`[LocalServer] Serving from: ${buildOutput}`);

  const instance = await serveStaticFolder(buildOutput);
  return { ...instance, projectType: type };
}

/**
 * Stop ALL active local servers (cleanup)
 */
function stopAllLocalServers() {
  for (const [port, { server }] of activeServers) {
    try { server.close(); } catch {}
    activeServers.delete(port);
  }
}

module.exports = { startLocalProject, stopAllLocalServers, detectProjectType };
