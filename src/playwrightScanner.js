const { chromium } = require('playwright');

/**
 * Playwright Scanner — Launches a real browser to:
 *  - Capture console errors
 *  - Detect failed network requests
 *  - Find broken links (by clicking + checking status)
 *  - Take a screenshot
 *  - Measure load time
 *  - Grab raw HTML for security analysis
 */
async function runPlaywrightScan(url) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (compatible; WebShieldBot/1.0)',
    viewport: { width: 1280, height: 800 }
  });

  const page = await context.newPage();

  const consoleErrors = [];
  const failedRequests = [];
  const networkRequests = new Map(); // url → { status, contentType }

  // ── Capture console messages ─────────────────────────────────────────────
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push({
        text: msg.text(),
        url: page.url()
      });
    }
  });

  page.on('pageerror', err => {
    consoleErrors.push({
      text: err.message,
      url: page.url()
    });
  });

  // ── Capture network responses ────────────────────────────────────────────
  page.on('response', async response => {
    const reqUrl = response.url();
    const status = response.status();
    let contentType = '';
    try {
      contentType = response.headers()['content-type'] || '';
    } catch {}

    networkRequests.set(reqUrl, { status, contentType });

    // Flag 4xx / 5xx responses (but not redirects 3xx)
    if (status >= 400) {
      failedRequests.push({ url: reqUrl, status });
    }
  });

  page.on('requestfailed', request => {
    failedRequests.push({
      url: request.url(),
      status: null,
      failure: request.failure()?.errorText || 'Unknown failure'
    });
  });

  // ── Navigate to page ────────────────────────────────────────────────────
  const loadStart = Date.now();
  let navigationOk = false;

  try {
    await page.goto(url, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    navigationOk = true;
  } catch (err) {
    // Try with just domcontentloaded if networkidle times out
    try {
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 20000
      });
      navigationOk = true;
    } catch (innerErr) {
      await browser.close();
      throw new Error(`Could not load page: ${innerErr.message}`);
    }
  }

  const loadTime = Date.now() - loadStart;

  // ── Grab page metadata ──────────────────────────────────────────────────
  const pageTitle = await page.title().catch(() => 'N/A');

  // ── Grab raw HTML source ─────────────────────────────────────────────────
  const htmlSource = await page.content().catch(() => '');

  // ── Screenshot (base64) ─────────────────────────────────────────────────
  let screenshot = null;
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 70, fullPage: false });
    screenshot = `data:image/jpeg;base64,${buf.toString('base64')}`;
  } catch {}

  // ── Find and check links ─────────────────────────────────────────────────
  const brokenLinks = await findBrokenLinks(page, url);

  await browser.close();

  return {
    pageTitle,
    loadTime,
    htmlSource,
    screenshot,
    consoleErrors,
    failedRequests,
    brokenLinks,
    networkSummary: {
      totalRequests: networkRequests.size,
      failed: failedRequests.length
    }
  };
}

/**
 * Extract all <a href> links from the page and check each one
 * Returns only links that returned a 4xx/5xx or failed entirely
 */
async function findBrokenLinks(page, baseUrl) {
  const broken = [];

  let links = [];
  try {
    links = await page.$$eval('a[href]', anchors =>
      anchors
        .map(a => a.href)
        .filter(h => h && !h.startsWith('javascript:') && !h.startsWith('mailto:') && !h.startsWith('tel:'))
    );
  } catch {
    return broken;
  }

  // Deduplicate and limit to avoid very slow scans (max 30 links)
  const uniqueLinks = [...new Set(links)].slice(0, 30);

  // Use a lightweight HEAD-request approach via fetch inside the browser context
  // to avoid launching extra browser instances
  const axios = require('axios');
  const baseDomain = new URL(baseUrl).hostname;

  const checks = uniqueLinks.map(async href => {
    try {
      const res = await axios.head(href, {
        timeout: 8000,
        maxRedirects: 3,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebShieldBot/1.0)' },
        validateStatus: () => true // don't throw on 4xx/5xx
      });
      if (res.status >= 400) {
        broken.push({ href, status: res.status });
      }
    } catch (err) {
      // Connection error → report as broken
      broken.push({ href, status: null, error: err.message });
    }
  });

  // Run all checks in parallel
  await Promise.all(checks);
  return broken;
}

module.exports = { runPlaywrightScan };
