# 🛡️ WebShield AI — Intelligent Website Security & Quality Scanner

WebShield AI is a portfolio-grade automated security and performance analysis tool that scans any website (or localhost app) using real browser automation and generates a detailed, structured report.

It simulates real-world testing by combining browser-level inspection, security analysis, and performance auditing into one unified system.

---

## 🌐 Live Demo

👉 http://localhost:3000  
*(Run locally to experience full functionality)*

---

## 🚀 Features

- 🔍 Full website scanning using Playwright (real browser)
- ⚡ Performance auditing using Google Lighthouse
- 🧠 Smart issue detection with severity-based scoring
- 🌐 Localhost scanning (no deployment required)
- 📊 Composite score system (0–100)
- 💻 Clean dashboard UI with real-time results

---

## 🧪 What It Detects

| Category | Description |
|---|---|
| 🔗 Broken Links | Detects dead or failing links |
| ❌ Console Errors | Captures runtime JavaScript errors |
| 📡 Failed Requests | Identifies broken API calls & assets |
| 🔐 Security Headers | Checks CSP, HSTS, X-Frame-Options |
| 🔑 Exposed Secrets | Detects API keys, tokens, credentials |
| ⚠️ XSS Indicators | Flags unsafe DOM operations |
| 🌐 Mixed Content | HTTP resources on HTTPS pages |
| 🔒 HTTPS Issues | Detects insecure websites |
| 🚀 Performance | Lighthouse-based scoring |
| 📈 Core Web Vitals | LCP, CLS, TBT, Speed Index |

---

## 🧠 Why This Project Stands Out

Unlike basic scanners, WebShield AI:

- Uses **real browser automation**, not just static analysis  
- Simulates **actual user behavior and network activity**  
- Combines **security + performance + functionality testing**  
- Works directly with **localhost applications**  

This makes it closer to real-world tools used in cybersecurity and QA testing.

---

## 🏗️ Architecture Overview

Frontend (Dashboard UI)  
        ↓  
Express API Server  
        ↓  
Scanner Engine  
   ├── Playwright (browser testing)  
   ├── Security Checker (headers, secrets, XSS)  
   ├── Lighthouse (performance audit)  
   └── Score Calculator  

---

## 📁 Project Structure

webshield-ai/  
├── server.js  
├── package.json  
├── src/  
│   ├── scanner.js  
│   ├── playwrightScanner.js  
│   ├── securityChecker.js  
│   ├── lighthouseScanner.js  
│   └── scoreCalculator.js  
└── public/  
    ├── index.html  
    ├── css/style.css  
    └── js/app.js  

---

## ⚙️ Setup & Installation

### 1. Install dependencies
```bash
npm install
npm start
4. Open in browser
http://localhost:3000