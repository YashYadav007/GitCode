// =======================
// pageHook.js (final robust)
// =======================
(() => {
  // prevent double install
  if (window.__lcHookInstalled) return;
  window.__lcHookInstalled = true;

  // -------- state --------
  let lastSubmittedCode = null;
  let lastLang = null;
  let lastTitle = null;
  let lastSubmissionId = null;
  let scanTimer = null;
  const fired = new Set();

  // -------- utils --------
  const post = (type, payload = {}) =>
    window.postMessage({ source: "lc-hook", type, ...payload }, "*");

  const log = (...a) => { try { console.log("[LC-Hook]", ...a); } catch (_) {} };

  function extractProblemContext() {
    try {
      // Get problem title
      const titleElement = document.querySelector('[data-cy="question-title"]');
      const title = titleElement?.textContent?.trim() || '';

      // Get problem description
      const descElement = document.querySelector('[data-cy="question-content"]');
      const description = descElement?.textContent?.trim() || '';

      // Get difficulty
      const difficultyElement = document.querySelector('[diff]');
      const difficulty = difficultyElement?.textContent?.trim().toLowerCase() || 'unknown';

      // Get tags/topics
      const tagElements = document.querySelectorAll('[data-topic-tags] .topic-tag');
      const tags = Array.from(tagElements).map(el => el.textContent.trim());

      // Get code editor content and language
      const code = getEditorCode() || '';
      const language = getLang() || '';

      return {
        data: {
          problem: {
            name: title,
            description,
            difficulty,
            slug: window.location.pathname.split('/').filter(Boolean).pop()
          },
          context: {
            title,
            description,
            difficulty,
            code,
            lang: language
          },
          preferences: {
            language,
            tags
          }
        }
      };
    } catch (err) {
      console.error('Error extracting problem context:', err);
      return null;
    }
  }

  // Listen for context requests
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (event.data.type !== 'GET_LEETCODE_CONTEXT') return;
    
    const context = extractProblemContext();
    window.postMessage({ 
      type: 'LEETCODE_CONTEXT',
      context
    }, '*');
  });

  function getTitle() {
    try {
      const el = document.querySelector('[data-cy="question-title"]');
      if (el?.innerText) {
        const parts = el.innerText.split(". ");
        return parts.length > 1 ? parts.slice(1).join(". ") : el.innerText;
      }
      return (document.title || "").replace(/\s*-\s*LeetCode\s*$/i, "");
    } catch (_) { return (document.title || ""); }
  }

  function getLang() {
    try {
      const btn = document.querySelector('[data-cy="lang-select"]');
      return btn?.innerText?.trim().toLowerCase() || "java";
    } catch (_) { return "java"; }
  }

  function getEditorCode() {
    try {
      const model = window.monaco?.editor?.getModels?.()[0];
      if (model) return model.getValue();
    } catch (_) {}
    return null;
  }

  function shouldFireOnce(key) {
    if (fired.has(key)) return false;
    fired.add(key);
    return true;
  }

  // -------- DOM fallback scanning --------
  const ACCEPT_PAT = /\baccepted\b/i;
  const NEG_PAT = /(wrong answer|runtime error|time limit|compile error|memory limit|output limit)/i;

  function scanDOMForAccepted() {
    try {
      const candidates = [
        '[data-cy="submission-result"]',
        '[data-e2e-locator="submission-result"]',
        '[data-e2e-locator="submission-status"]',
        'div[aria-live="polite"]',
        'div[role="alert"]',
        '.text-success', '.text-green', '.text-ac',
        '.ant-message', '.ant-notification',
        '.success__', '.result__'
      ];

      let hit = false, neg = false, txtHit = '';
      for (const sel of candidates) {
        document.querySelectorAll(sel).forEach(n => {
          const txt = (n.innerText || n.textContent || '').trim();
          if (!txt) return;
          if (ACCEPT_PAT.test(txt)) { hit = true; txtHit = txt; }
          if (NEG_PAT.test(txt)) { neg = true; }
        });
      }

      if (hit) {
        const title = lastTitle || getTitle();
        const lang  = lastLang || getLang();
        const code  = lastSubmittedCode || getEditorCode() || "";
        const key   = `${title}__${lang}__${code.length}`;
        if (shouldFireOnce(key)) {
          log("DOM accepted → post", { len: code.length, text: txtHit.slice(0, 80) });
          post("accepted", { title, lang, code });
        }
        return;
      }

      if (neg) return; // stop scanning on a negative terminal verdict
    } catch (_) {}
  }

  // observe DOM changes (for DOM fallback)
  const moDOM = new MutationObserver(() => { scanDOMForAccepted(); });
  moDOM.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // scan window after a submit click for up to 20s
  function armScanWindow() {
    if (scanTimer) clearTimeout(scanTimer);
    const started = Date.now();
    (function tick() {
      scanDOMForAccepted();
      if (Date.now() - started < 20000) {
        scanTimer = setTimeout(tick, 800);
      }
    })();
  }

  // -------- polling path (/submissions/detail/<id>/check/) --------
  async function pollSubmission(id, maxMs = 30000, intervalMs = 800) {
    log("poll start", id);
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      try {
        const res = await fetch(`/submissions/detail/${id}/check/`, { credentials: "same-origin" });
        if (!res.ok) throw new Error("check " + res.status);
        const j = await res.json();
        const status = String(j?.status_msg || j?.status || "").toLowerCase();
        log("poll status", id, status);

        if (status.includes("accepted")) {
          const title = lastTitle || getTitle();
          const lang  = lastLang || getLang();
          const code  = lastSubmittedCode || getEditorCode() || "";
          const key   = `${title}__${lang}__${code.length}`;
          if (shouldFireOnce(key)) {
            log("poll accepted → post", { title, lang, len: code.length });
            post("accepted", { title, lang, code });
          }
          return;
        }
        if (status.includes("error") || status.includes("wrong") || status.includes("time")) return;
      } catch (e) {
        log("poll err", String(e));
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    log("poll timeout", id);
  }

  // -------- handle GraphQL/REST payloads --------
  function onPossibleVerdictData(data) {
    // status in GraphQL response
    const status =
      data?.submitCode?.statusMsg ||
      data?.submit?.statusMsg ||
      data?.judgeSubmission?.status ||
      data?.submitJudge?.status ||
      data?.submitCodeV2?.statusMsg || "";

    if (status) log("graphql status", status);

    if (String(status).toLowerCase().includes("accepted")) {
      const title = lastTitle || getTitle();
      const lang  = lastLang || getLang();
      const code  = lastSubmittedCode || getEditorCode() || "";
      const key   = `${title}__${lang}__${code.length}`;
      if (shouldFireOnce(key)) {
        log("graphql accepted → post", { title, lang, len: code.length });
        post("accepted", { title, lang, code });
      }
    }

    // submissionId path → poll /check/
    const id =
      data?.submitCode?.submissionId ||
      data?.submitCodeV2?.submissionId ||
      data?.judgeSubmission?.submissionId ||
      data?.submit?.submissionId || null;

    if (id && id !== lastSubmissionId) {
      lastSubmissionId = id;
      log("submission id", id);
      pollSubmission(id);
    }
  }

  // -------- capture code on Submit/Run clicks (snapshot safety) --------
  function attachClickSnaps() {
    const tryAttach = (selector, label) => {
      document.querySelectorAll(selector).forEach(btn => {
        if (btn.__lcSnapInstalled) return;
        btn.__lcSnapInstalled = true;
        btn.addEventListener("click", () => {
          lastSubmittedCode = getEditorCode() || lastSubmittedCode;
          lastLang = getLang() || lastLang;
          lastTitle = getTitle() || lastTitle;
          log("snap click", label || selector, {
            lang: lastLang, title: lastTitle, len: (lastSubmittedCode || "").length
          });
          armScanWindow();
        }, { capture: true });
      });
    };

    // known buttons
    tryAttach('[data-cy="submit-code-btn"]', 'data-cy submit');
    tryAttach('[data-cy="run-code-btn"]', 'data-cy run');
    tryAttach('button:has(svg[data-icon="check"])', 'svg check');
    tryAttach('button:has(svg[data-icon="play"])',  'svg play');

    // generic "Submit" text buttons
    document.querySelectorAll('button').forEach(btn => {
      if (btn.__lcSnapInstalled) return;
      const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
      if (/^submit$|^submit\s+code$/.test(txt)) {
        btn.__lcSnapInstalled = true;
        btn.addEventListener("click", () => {
          lastSubmittedCode = getEditorCode() || lastSubmittedCode;
          lastLang = getLang() || lastLang;
          lastTitle = getTitle() || lastTitle;
          log("snap click", 'text Submit', {
            lang: lastLang, title: lastTitle, len: (lastSubmittedCode || "").length
          });
          armScanWindow();
        }, { capture: true });
      }
    });
  }
  attachClickSnaps();
  const moBtns = new MutationObserver(attachClickSnaps);
  moBtns.observe(document.documentElement, { childList: true, subtree: true });

  // -------- single fetch wrapper --------
  const originalFetch = window.fetch.bind(window);
  window.fetch = async function (...args) {
    let url = "";
    try { url = (args[0] && args[0].url) || String(args[0] || ""); } catch (_) {}

    // capture code from GraphQL request body
    try {
      const body = args[1]?.body;
      if (url.includes("/graphql/") && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.variables?.code) {
            lastSubmittedCode = parsed.variables.code;
            lastLang = getLang();
            lastTitle = getTitle();
            log("capture code from fetch body", { len: lastSubmittedCode.length, lang: lastLang });
          }
        } catch (_) {}
      }
    } catch (_) {}

    const res = await originalFetch(...args);

    // inspect GraphQL response
    try {
      if (url.includes("/graphql/")) {
        const cloned = res.clone();
        cloned.json().then(j => {
          const data = j?.data || {};
          log("graphql res seen");
          onPossibleVerdictData(data);
        }).catch(() => {});
      }
    } catch (_) {}

    return res;
  };

  // -------- single XHR wrapper --------
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    this.addEventListener("load", function () {
      try {
        if (this.responseURL?.includes("/graphql/")) {
          const data = JSON.parse(this.response || "{}")?.data || {};
          log("graphql xhr res seen");
          onPossibleVerdictData(data);
        }
      } catch (_) {}
    });
    return origOpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (this._url?.includes("/graphql/") && body) {
        try {
          const parsed = JSON.parse(body);
          if (parsed?.variables?.code) {
            lastSubmittedCode = parsed.variables.code;
            lastLang = getLang();
            lastTitle = getTitle();
            log("capture code from xhr body", { len: lastSubmittedCode.length, lang: lastLang });
          }
        } catch (_) {}
      }
    } catch (_) {}
    return origSend.apply(this, arguments);
  };

  // -------- keep wrappers alive (avoid clobbering by other scripts) --------
  (function keepWrappersAlive() {
    const OUR_FETCH = window.fetch;
    const OUR_OPEN  = XMLHttpRequest.prototype.open;
    setInterval(() => {
      if (window.fetch !== OUR_FETCH) {
        try { window.fetch = OUR_FETCH; log("restored fetch wrapper"); } catch (_) {}
      }
      if (XMLHttpRequest.prototype.open !== OUR_OPEN) {
        try { XMLHttpRequest.prototype.open = OUR_OPEN; log("restored XHR wrapper"); } catch (_) {}
      }
    }, 1000);
  })();

  // ready signal
  post("log", { msg: "page hook ready" });
  log("hook installed");
})();
