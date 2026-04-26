/**
 * Lighthouse Scanner
 * 
 * Runs Google Lighthouse programmatically using chrome-launcher.
 * Requires Chrome or Chromium to be installed on the system.
 * 
 * NOTE: Lighthouse uses its own Chrome instance via chrome-launcher.
 * If Chrome is not installed, this module gracefully returns an error
 * message without crashing the entire scan.
 */
async function runLighthouseScan(url) {
  let lighthouse, chromeLauncher;

  try {
    lighthouse = require('lighthouse');
    chromeLauncher = require('chrome-launcher');
  } catch (err) {
    return buildUnavailableResponse('Lighthouse or chrome-launcher module not found.');
  }

  let chrome;
  try {
    chrome = await chromeLauncher.launch({
      chromeFlags: ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage']
    });
  } catch (err) {
    return buildUnavailableResponse('Chrome/Chromium not found. Install it or run "npx playwright install chromium" and ensure Chrome is available system-wide.');
  }

  const options = {
    logLevel: 'error',
    output: 'json',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    port: chrome.port,
    throttlingMethod: 'simulate'
  };

  try {
    let runnerResult;

    // Handle both ESM and CJS exports of lighthouse
    if (typeof lighthouse === 'function') {
      runnerResult = await lighthouse(url, options);
    } else if (lighthouse.default && typeof lighthouse.default === 'function') {
      runnerResult = await lighthouse.default(url, options);
    } else {
      throw new Error('Unexpected Lighthouse module format');
    }

    const { lhr } = runnerResult;

    const getScore = (category) => {
      const cat = lhr.categories[category];
      return cat ? Math.round(cat.score * 100) : null;
    };

    // Extract key performance metrics
    const metrics = {};
    const auditKeys = [
      'first-contentful-paint',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'speed-index',
      'interactive',
      'server-response-time',
      'total-byte-weight',
      'render-blocking-resources',
      'uses-optimized-images',
      'unused-javascript',
      'unused-css-rules'
    ];

    for (const key of auditKeys) {
      const audit = lhr.audits[key];
      if (audit) {
        metrics[key] = {
          title: audit.title,
          displayValue: audit.displayValue || 'N/A',
          score: audit.score !== null ? Math.round(audit.score * 100) : null,
          description: audit.description
        };
      }
    }

    return {
      performance: getScore('performance'),
      accessibility: getScore('accessibility'),
      bestPractices: getScore('best-practices'),
      seo: getScore('seo'),
      metrics,
      error: null
    };
  } catch (err) {
    return buildUnavailableResponse(`Lighthouse run failed: ${err.message}`);
  } finally {
    if (chrome) {
      await chrome.kill().catch(() => {});
    }
  }
}

function buildUnavailableResponse(reason) {
  return {
    performance: null,
    accessibility: null,
    bestPractices: null,
    seo: null,
    metrics: {},
    error: reason
  };
}

module.exports = { runLighthouseScan };
