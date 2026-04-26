const axios = require('axios');

/**
 * Security Checker — custom logic to detect common web security issues:
 *  1. HTTP instead of HTTPS
 *  2. Exposed API keys / secrets in HTML source
 *  3. Missing security headers (CSP, X-Frame-Options, etc.)
 *  4. Basic XSS risk indicators
 *  5. Mixed content (HTTPS page loading HTTP assets)
 */
async function runSecurityChecks(url, htmlSource) {
  const issues = [];
  const parsedUrl = new URL(url);

  // ── 1. HTTP Check ────────────────────────────────────────────────────────
  if (parsedUrl.protocol === 'http:') {
    issues.push({
      severity: 'critical',
      title: 'Site Uses HTTP (Not HTTPS)',
      detail: 'The website is served over HTTP. All traffic is unencrypted and vulnerable to interception.',
      source: url
    });
  }

  // ── 2. Security Headers Check ────────────────────────────────────────────
  const headerIssues = await checkSecurityHeaders(url);
  issues.push(...headerIssues);

  // ── 3. Exposed Secrets in HTML ───────────────────────────────────────────
  if (htmlSource) {
    const secretIssues = checkExposedSecrets(htmlSource);
    issues.push(...secretIssues);

    // ── 4. XSS Risk Indicators ──────────────────────────────────────────────
    const xssIssues = checkXssIndicators(htmlSource, url);
    issues.push(...xssIssues);

    // ── 5. Mixed Content ─────────────────────────────────────────────────────
    if (parsedUrl.protocol === 'https:') {
      const mixedIssues = checkMixedContent(htmlSource);
      issues.push(...mixedIssues);
    }
  }

  return { issues };
}

/**
 * Fetch response headers and check for missing security headers
 */
async function checkSecurityHeaders(url) {
  const issues = [];
  let headers = {};

  try {
    const res = await axios.get(url, {
      timeout: 10000,
      maxRedirects: 3,
      validateStatus: () => true,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WebShieldBot/1.0)' }
    });
    headers = res.headers || {};
  } catch {
    issues.push({
      severity: 'medium',
      title: 'Could Not Fetch HTTP Headers',
      detail: 'WebShield was unable to retrieve the server response headers for analysis.',
      source: url
    });
    return issues;
  }

  const securityHeaders = [
    {
      header: 'content-security-policy',
      title: 'Missing Content-Security-Policy (CSP) Header',
      detail: 'CSP helps prevent XSS attacks by restricting which content sources are allowed. Add a Content-Security-Policy response header.',
      severity: 'critical'
    },
    {
      header: 'x-frame-options',
      title: 'Missing X-Frame-Options Header',
      detail: 'Without X-Frame-Options, your site may be vulnerable to clickjacking attacks. Add "X-Frame-Options: DENY" or "SAMEORIGIN".',
      severity: 'medium'
    },
    {
      header: 'x-content-type-options',
      title: 'Missing X-Content-Type-Options Header',
      detail: 'This header prevents browsers from MIME-sniffing a response away from the declared content-type. Add "X-Content-Type-Options: nosniff".',
      severity: 'medium'
    },
    {
      header: 'strict-transport-security',
      title: 'Missing Strict-Transport-Security (HSTS) Header',
      detail: 'HSTS forces browsers to use HTTPS. Add "Strict-Transport-Security: max-age=31536000; includeSubDomains".',
      severity: 'medium'
    },
    {
      header: 'permissions-policy',
      title: 'Missing Permissions-Policy Header',
      detail: 'This header controls which browser features can be used. Consider adding a Permissions-Policy header to restrict access to sensitive APIs.',
      severity: 'low'
    },
    {
      header: 'referrer-policy',
      title: 'Missing Referrer-Policy Header',
      detail: 'Without a Referrer-Policy, sensitive URL information may be leaked when users navigate to external sites.',
      severity: 'low'
    }
  ];

  for (const check of securityHeaders) {
    if (!headers[check.header]) {
      issues.push({
        severity: check.severity,
        title: check.title,
        detail: check.detail,
        source: 'HTTP Headers'
      });
    }
  }

  // Check for server version disclosure
  if (headers['server'] && /[0-9]/.test(headers['server'])) {
    issues.push({
      severity: 'low',
      title: 'Server Version Exposed in Headers',
      detail: `The "Server" header reveals: "${headers['server']}". Remove or obscure version info to make reconnaissance harder.`,
      source: 'HTTP Headers'
    });
  }

  return issues;
}

/**
 * Scan HTML source for patterns that look like exposed secrets/API keys
 */
function checkExposedSecrets(html) {
  const issues = [];

  const patterns = [
    {
      name: 'AWS Access Key',
      regex: /AKIA[0-9A-Z]{16}/g,
      severity: 'critical'
    },
    {
      name: 'Google API Key',
      regex: /AIza[0-9A-Za-z\-_]{35}/g,
      severity: 'critical'
    },
    {
      name: 'Stripe Secret Key',
      regex: /sk_live_[0-9a-zA-Z]{24}/g,
      severity: 'critical'
    },
    {
      name: 'Stripe Publishable Key',
      regex: /pk_live_[0-9a-zA-Z]{24}/g,
      severity: 'medium'
    },
    {
      name: 'GitHub Personal Access Token',
      regex: /ghp_[0-9a-zA-Z]{36}/g,
      severity: 'critical'
    },
    {
      name: 'Slack Bot Token',
      regex: /xoxb-[0-9]{11}-[0-9]{11}-[0-9a-zA-Z]{24}/g,
      severity: 'critical'
    },
    {
      name: 'JWT Token',
      regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
      severity: 'medium'
    },
    {
      name: 'Generic API Key Pattern',
      regex: /api[_\-]?key\s*[:=]\s*['"]([a-zA-Z0-9_\-]{20,})['"]/gi,
      severity: 'medium'
    },
    {
      name: 'Password in HTML',
      regex: /password\s*[:=]\s*['"]([^'"]{6,})['"]/gi,
      severity: 'critical'
    },
    {
      name: 'Firebase API Key',
      regex: /apiKey:\s*['"][A-Za-z0-9_-]{30,}['"]/g,
      severity: 'medium'
    }
  ];

  for (const pattern of patterns) {
    const matches = html.match(pattern.regex);
    if (matches && matches.length > 0) {
      issues.push({
        severity: pattern.severity,
        title: `Exposed ${pattern.name} Detected in Page Source`,
        detail: `Found ${matches.length} instance(s) of a pattern matching a ${pattern.name}. Secrets should never be embedded in client-side HTML/JS.`,
        source: 'HTML Source'
      });
    }
  }

  return issues;
}

/**
 * Check for basic XSS risk indicators in the HTML
 */
function checkXssIndicators(html, url) {
  const issues = [];

  // Inline event handlers — risky if content is user-controlled
  const inlineHandlerCount = (html.match(/on(click|mouseover|load|error|submit|keydown|keyup)\s*=/gi) || []).length;
  if (inlineHandlerCount > 5) {
    issues.push({
      severity: 'low',
      title: 'Many Inline Event Handlers Detected',
      detail: `Found ${inlineHandlerCount} inline event handlers (onclick, onload, etc.). If any use unsanitized user input, XSS is likely. Consider using addEventListener() instead.`,
      source: 'HTML Source'
    });
  }

  // document.write usage — classic XSS vector
  if (/document\.write\s*\(/.test(html)) {
    issues.push({
      severity: 'medium',
      title: 'Usage of document.write() Detected',
      detail: 'document.write() can be a vector for DOM-based XSS if used with unsanitized input. Consider using safer DOM manipulation methods.',
      source: 'HTML Source'
    });
  }

  // innerHTML with variable assignments
  if (/\.innerHTML\s*=\s*[^'"`;][^;]*;/.test(html)) {
    issues.push({
      severity: 'medium',
      title: 'Dynamic innerHTML Assignment Detected',
      detail: 'Assigning dynamic content to innerHTML can lead to XSS if the content is not properly sanitized. Consider using textContent or a safe templating library.',
      source: 'HTML Source'
    });
  }

  // eval() usage
  if (/\beval\s*\(/.test(html)) {
    issues.push({
      severity: 'medium',
      title: 'eval() Usage Detected',
      detail: 'eval() executes arbitrary JavaScript. If any argument is derived from user input or external sources, this is a critical XSS and code injection risk.',
      source: 'HTML Source'
    });
  }

  return issues;
}

/**
 * Check for mixed content (HTTPS page loading HTTP resources)
 */
function checkMixedContent(html) {
  const issues = [];

  const httpAssets = html.match(/(?:src|href|action)\s*=\s*['"]http:\/\/[^'"]+['"]/gi);
  if (httpAssets && httpAssets.length > 0) {
    issues.push({
      severity: 'medium',
      title: `Mixed Content Detected (${httpAssets.length} HTTP Resources on HTTPS Page)`,
      detail: 'This HTTPS page loads resources over HTTP, which may be blocked by browsers and creates security vulnerabilities. Update all resource URLs to use HTTPS.',
      source: 'HTML Source'
    });
  }

  return issues;
}

module.exports = { runSecurityChecks };
