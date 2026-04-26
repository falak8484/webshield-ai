const { runPlaywrightScan } = require('./playwrightScanner');
const { runSecurityChecks } = require('./securityChecker');
const { runLighthouseScan } = require('./lighthouseScanner');
const { calculateScore } = require('./scoreCalculator');

/**
 * Main scan orchestrator — runs all checks and builds the final report
 */
async function runScan(url) {
  const startTime = Date.now();
  console.log('[Scanner] Orchestrating full scan...');

  // ── 1. Playwright Browser Scan ──────────────────────────────────────────
  console.log('[Scanner] Phase 1: Browser automation (Playwright)...');
  let playwrightData = {};
  try {
    playwrightData = await runPlaywrightScan(url);
  } catch (err) {
    console.error('[Scanner] Playwright scan error:', err.message);
    playwrightData = {
      consoleErrors: [],
      brokenLinks: [],
      failedRequests: [],
      pageTitle: 'N/A',
      screenshot: null,
      loadTime: 0,
      error: err.message
    };
  }

  // ── 2. Security Checks ──────────────────────────────────────────────────
  console.log('[Scanner] Phase 2: Security analysis...');
  let securityData = {};
  try {
    securityData = await runSecurityChecks(url, playwrightData.htmlSource || '');
  } catch (err) {
    console.error('[Scanner] Security check error:', err.message);
    securityData = { issues: [], score: 100 };
  }

  // ── 3. Lighthouse Performance Scan ─────────────────────────────────────
  console.log('[Scanner] Phase 3: Performance audit (Lighthouse)...');
  let lighthouseData = {};
  try {
    lighthouseData = await runLighthouseScan(url);
  } catch (err) {
    console.error('[Scanner] Lighthouse error:', err.message);
    lighthouseData = {
      performance: null,
      accessibility: null,
      bestPractices: null,
      seo: null,
      metrics: {},
      error: 'Lighthouse unavailable — Chrome may not be installed locally.'
    };
  }

  // ── 4. Build Final Report ───────────────────────────────────────────────
  const scanDuration = ((Date.now() - startTime) / 1000).toFixed(1);

  const allIssues = buildIssueList(playwrightData, securityData);
  const score = calculateScore(allIssues, lighthouseData);

  const report = {
    url,
    scannedAt: new Date().toISOString(),
    scanDuration: `${scanDuration}s`,
    score,
    summary: buildSummary(score),
    pageInfo: {
      title: playwrightData.pageTitle || 'N/A',
      loadTime: playwrightData.loadTime || 0,
      screenshot: playwrightData.screenshot || null
    },
    issues: allIssues,
    performance: lighthouseData,
    rawStats: {
      totalConsoleErrors: (playwrightData.consoleErrors || []).length,
      totalBrokenLinks: (playwrightData.brokenLinks || []).length,
      totalFailedRequests: (playwrightData.failedRequests || []).length,
      totalSecurityIssues: (securityData.issues || []).length
    }
  };

  console.log(`[Scanner] Scan complete in ${scanDuration}s — Score: ${score}/100`);
  return report;
}

/**
 * Aggregate all issues from all scanners into a unified list
 */
function buildIssueList(playwright, security) {
  const issues = [];

  // Console errors → Critical
  (playwright.consoleErrors || []).forEach(err => {
    issues.push({
      severity: 'critical',
      category: 'JavaScript Error',
      title: 'Console Error Detected',
      detail: err.text,
      source: err.url || 'unknown'
    });
  });

  // Broken links → Critical
  (playwright.brokenLinks || []).forEach(link => {
    issues.push({
      severity: 'critical',
      category: 'Broken Link',
      title: `Broken Link (${link.status || 'No Response'})`,
      detail: link.href,
      source: link.href
    });
  });

  // Failed requests → Medium
  (playwright.failedRequests || []).forEach(req => {
    issues.push({
      severity: 'medium',
      category: 'Failed Request',
      title: `Request Failed — ${req.status || 'Network Error'}`,
      detail: req.url,
      source: req.url
    });
  });

  // Security issues
  (security.issues || []).forEach(sec => {
    issues.push({
      severity: sec.severity,
      category: 'Security',
      title: sec.title,
      detail: sec.detail,
      source: sec.source || 'page-wide'
    });
  });

  return issues;
}

/**
 * Build a human-readable summary based on score
 */
function buildSummary(score) {
  if (score >= 90) return { label: 'Excellent', color: 'green', emoji: '✅' };
  if (score >= 70) return { label: 'Good', color: 'blue', emoji: '🟦' };
  if (score >= 50) return { label: 'Needs Attention', color: 'orange', emoji: '⚠️' };
  return { label: 'Critical Issues Found', color: 'red', emoji: '🚨' };
}

module.exports = { runScan };
