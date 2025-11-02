// =======================
// content.js (final safe)
// =======================

console.log("🚀 content.js loaded into LeetCode page");

init();

function init() {
  // Inject pageHook.js into page (CSP-safe)
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("pageHook.js");
  (document.head || document.documentElement).appendChild(s);
  s.onload = () => s.remove();

  // Listen for messages from pageHook
  window.addEventListener("message", onPageMessage);
}

// -------- Safe message sender with retry --------
function safeSend(msg, attempt = 0) {
  // First check if runtime is available
  if (!chrome.runtime) {
    console.warn("⚠️ Chrome runtime not available");
    if (attempt < 3) {
      setTimeout(() => safeSend(msg, attempt + 1), 1000);
    }
    return;
  }

  try {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        console.warn(
          `⚠️ sendMessage failed (attempt ${attempt + 1}):`,
          chrome.runtime.lastError.message
        );
        if (attempt < 3) {
          setTimeout(() => safeSend(msg, attempt + 1), 500);
        }
      } else {
        console.log("📨 background ack:", resp);
      }
    });
  } catch (err) {
    console.error("❌ sendMessage threw:", err);
    if (attempt < 3) {
      setTimeout(() => safeSend(msg, attempt + 1), 500);
    }
  }
}

// -------- Handle messages from pageHook --------
function onPageMessage(e) {
  if (e.source !== window) return;
  const d = e.data;
  if (!d || d.source !== "lc-hook") return;
  // add inside onPageMessage
  if (d.type === "log") {
    console.log("🧩 pageHook:", d.msg || "(no message)");
  }
  if (d.type === "accepted") {
    const { title, lang, code } = d;
    
    // Get full problem context
    const problemContext = extractProblemContext();
    
    console.log("📦 Accepted → final code being sent:", {
      ...problemContext,
      codeLen: (code || "").length,
      preview: (code || "").slice(0, 200)
    });

    // Send complete context for GitHub storage
    safeSend({
      type: "submission",
      title,
      lang,
      code,
      problemContext, // Full problem details including tags
      timestamp: Date.now(),
    });
  }
}


// content.js (add below your current code)

function injectHook() {
  try {
    // Guard against repeated injections
    if (document.querySelector('script[data-hook="gitcode"]')) {
      return;
    }
    
    const s = document.createElement("script");
    s.dataset.hook = "gitcode"; // Mark our script
    s.src = chrome.runtime.getURL("pageHook.js");
    s.onerror = () => console.warn("[GitCode] Hook script failed to load");
    (document.head || document.documentElement).appendChild(s);
    s.onload = () => s.remove();
  } catch (e) {
    console.warn("[GitCode] Hook injection failed:", e);
  }
}

// Fire once on load (you already do), and on SPA navigations:
(function patchHistory(){
  let lastInjectionTime = 0;
  const THROTTLE_MS = 1000; // Prevent too frequent injections

  const fire = () => {
    const now = Date.now();
    if (now - lastInjectionTime < THROTTLE_MS) {
      return;
    }
    lastInjectionTime = now;

    // Stagger injection to let DOM settle
    setTimeout(() => {
      try {
        injectHook();
      } catch (e) {
        console.warn("[GitCode] Hook injection failed in fire:", e);
      }
    }, 150);
  };

  // Watch for history changes
  try {
    const _push = history.pushState;
    history.pushState = function(...a){
      const r = _push.apply(this,a);
      window.dispatchEvent(new Event('locationchange'));
      return r;
    };

    const _replace = history.replaceState;
    history.replaceState = function(...a){
      const r = _replace.apply(this,a);
      window.dispatchEvent(new Event('locationchange'));
      return r;
    };

    window.addEventListener('popstate', () => 
      window.dispatchEvent(new Event('locationchange'))
    );
    window.addEventListener('locationchange', fire);
  } catch (e) {
    console.warn("[GitCode] History patch failed:", e);
  }
})();
// ------------------------------
// GitCode: Floating Suggester UI
// ------------------------------
(() => {
  const BTN_ID = "gc-suggest-btn";
  const MODAL_ID = "gc-suggest-modal";
  const POS_KEY = "gc_suggest_btn_pos";

  // LeetCode is SPA → watch route/content changes and (re)inject if needed
  let lastUrl = location.href;
  const urlObserver = new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      ensureButton();
    }
  });
  urlObserver.observe(document, { subtree: true, childList: true });

  // Also try once after DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", ensureButton);
  } else {
    ensureButton();
  }
  // And retry a few times for slow paint
  setTimeout(ensureButton, 750);
  setTimeout(ensureButton, 1500);

  // Install page-bridge so we can touch Monaco from page context
  injectPageBridge();

  function ensureButton() {
    // Don’t duplicate
    if (document.getElementById(BTN_ID)) return;

    // Prefer attaching to root content, fallback to body
    const root =
      document.querySelector("#__next") ||
      document.querySelector('[data-cy="layout"]') ||
      document.body;

    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.title = "Suggest code in MY style";
    btn.textContent = "💡 In-My-Style";
    styleButton(btn);
    makeDraggable(btn);

    // Restore saved position
    chrome.storage?.local?.get([POS_KEY], (d) => {
      if (d && d[POS_KEY]) {
        const { right, bottom } = d[POS_KEY];
        btn.style.right = right;
        btn.style.bottom = bottom;
      }
    });

    btn.addEventListener("click", onSuggestClick);
    root.appendChild(btn);
  }

  function styleButton(btn) {
    Object.assign(btn.style, {
      position: "fixed",
      right: "18px",
      bottom: "18px",
      zIndex: "999999",
      padding: "10px 14px",
      borderRadius: "999px",
      border: "1px solid rgba(255,255,255,0.2)",
      boxShadow:
        "0 10px 30px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.05)",
      background:
        "linear-gradient(180deg, rgba(32,32,36,0.95), rgba(22,22,26,0.95))",
      color: "#fff",
      fontSize: "13px",
      fontWeight: "600",
      letterSpacing: "0.2px",
      cursor: "pointer",
      userSelect: "none",
      backdropFilter: "blur(6px)",
    });
    btn.addEventListener("mouseenter", () => (btn.style.transform = "scale(1.02)"));
    btn.addEventListener("mouseleave", () => (btn.style.transform = "scale(1.0)"));
  }

  function makeDraggable(el) {
    let startX, startY, startRight, startBottom, dragging = false;

    const onDown = (e) => {
      dragging = true;
      const evt = e.touches ? e.touches[0] : e;
      startX = evt.clientX;
      startY = evt.clientY;
      startRight = parseFloat(getComputedStyle(el).right);
      startBottom = parseFloat(getComputedStyle(el).bottom);
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onUp);
    };
    const onMove = (e) => {
      if (!dragging) return;
      const evt = e.touches ? e.touches[0] : e;
      const dx = evt.clientX - startX;
      const dy = evt.clientY - startY;
      el.style.right = Math.max(8, startRight - dx) + "px";
      el.style.bottom = Math.max(8, startBottom + dy) + "px";
      e.preventDefault?.();
    };
    const onUp = () => {
      dragging = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);

      // Persist position
      chrome.storage?.local?.set({
        [POS_KEY]: { right: el.style.right, bottom: el.style.bottom },
      });
    };

    el.addEventListener("mousedown", onDown);
    el.addEventListener("touchstart", onDown, { passive: true });
  }

  async function onSuggestClick() {
    // 1) Extract lightweight context
    const ctx = extractProblemContext();

    // 2) Open the modal (keeps your same UI)
    openStubModal(ctx);
  }

function extractProblemContext() {
  try {
    // Extract problem title with fallbacks
    let title = '';
    const titleElement = document.querySelector('[data-cy="question-title"]');
    if (titleElement) {
      title = titleElement.textContent
        .trim()
        .replace(/\s+/g, ' ');  // Normalize whitespace
    }

    // If no title found, try alternative selectors
    if (!title) {
      const alternativeTitleSelectors = [
        '.css-v3d350',  // New LeetCode UI
        '.question-title',  // Classic UI
        'h4[class*="title"]',  // Generic title class
        'div[class*="title"] span'  // Nested title
      ];

      for (const selector of alternativeTitleSelectors) {
        const el = document.querySelector(selector);
        if (el) {
          title = el.textContent.trim().replace(/\s+/g, ' ');
          if (title) break;
        }
      }
    }

    // Add problem number/slug from URL for better context
    const problemSlug = location.pathname.match(/problems\/([^/]+)/)?.[1] || '';
    if (problemSlug && !title.includes(problemSlug)) {
      title = `${problemSlug}. ${title}`.trim();
    }

    // Get problem description with enhanced extraction
    let description = '';
    const descriptionSelectors = [
      '[data-cy="question-content"]',  // Primary selector
      '.content__u3I1',  // LeetCode specific
      '.question-content',  // Generic
      '#question-detail',  // Alternative
      '.description__24sA'  // Alternative
    ];

    for (const selector of descriptionSelectors) {
      const el = document.querySelector(selector);
      if (el) {
        // Clean and normalize the description text
        description = el.textContent
          .trim()
          .replace(/\s+/g, ' ')  // Normalize whitespace
          .replace(/\[object Object\]/g, '')  // Remove JS artifacts
          .slice(0, 1000);  // Keep reasonable length but more than before
        if (description) break;
      }
    }

    // Extract difficulty with validation
    let difficulty = '';
    const difficultyElement = document.querySelector('[diff],[data-difficulty]') ||
                             document.querySelector('[class*="Difficulty"]');
    
    if (difficultyElement) {
      const diffText = difficultyElement.textContent.trim().toLowerCase();
      if (['easy', 'medium', 'hard'].includes(diffText)) {
        difficulty = diffText;
      }
    }

    // Get language selection with improved detection
    let lang = '';
    try {
      // Primary: Check Monaco editor language
      if (window.monaco?.editor) {
        const model = monaco.editor.getModels()[0];
        if (model?.getLanguageId) {
          lang = model.getLanguageId().toLowerCase();
        }
      }

      // Fallback: Check language selector
      if (!lang) {
        const langElement = document.querySelector('[data-cy="lang-select"]') ||
                           document.querySelector('.select-value');
        if (langElement) {
          lang = langElement.textContent.trim().toLowerCase();
        }
      }

      // Normalize language name
      lang = lang
        .replace('python3', 'python')
        .replace('javascript', 'js')
        .replace('typescript', 'ts')
        .replace('c++', 'cpp');

    } catch (e) {
      console.warn('Language detection failed:', e);
    }

    // Get constraints and examples if available
    const constraints = [];
    document.querySelectorAll('li').forEach(li => {
      const text = li.textContent.trim();
      if (text.includes('≤') || text.includes('<=') || /^\d+\s*[<≤]\s*\w+\s*[<≤]\s*\d+$/.test(text)) {
        constraints.push(text);
      }
    });

    // Collect topic tags
    const tags = new Set();
    document.querySelectorAll('[data-topic-tags] .topic-tag, [class*="tag"]').forEach(el => {
      const tag = el.textContent.trim().toLowerCase();
      if (tag && !tag.includes('function') && !tag.includes('class')) {
        tags.add(tag);
      }
    });

    // Add difficulty as a tag if available
    if (difficulty) {
      tags.add(difficulty);
    }

    // Get current editor code for context
    let code = '';
    try {
      if (window.monaco?.editor) {
        code = monaco.editor.getModels()[0]?.getValue() || '';
      }
    } catch (e) {
      console.warn('Code extraction failed:', e);
    }

    // Build comprehensive context object
    const context = {
      url: location.href,
      problemSlug,
      title,
      description,
      difficulty,
      lang,
      constraints,
      code,
      tags: Array.from(tags),
      ts: Date.now()
    };

    // Log for debugging
    console.log("📝 Extracted problem context:", {
      ...context,
      description: context.description?.slice(0, 100) + "..."
    });

    return context;

  } catch (e) {
    console.error('Problem context extraction failed:', e);
    // Return minimal context to prevent complete failure
    return {
      url: location.href,
      title: document.title,
      ts: Date.now()
    };
  }
}  function openStubModal(ctx) {
    // Don’t duplicate
    if (document.getElementById(MODAL_ID)) {
      document.getElementById(MODAL_ID).remove();
    }
    const wrap = document.createElement("div");
    wrap.id = MODAL_ID;
    Object.assign(wrap.style, {
      position: "fixed",
      inset: "0",
      background: "rgba(0,0,0,0.45)",
      zIndex: "999998",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "20px",
    });

    const card = document.createElement("div");
    Object.assign(card.style, {
      width: "min(680px, 92vw)",
      maxHeight: "80vh",
      overflow: "auto",
      background: "#111216",
      color: "#EDEDED",
      border: "1px solid rgba(255,255,255,0.08)",
      borderRadius: "14px",
      padding: "18px 18px 12px",
      boxShadow: "0 20px 60px rgba(0,0,0,0.45)",
    });

    card.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
        <div style="display:flex;align-items:center;gap:10px;">
          <img src="${chrome.runtime.getURL('icon.png')}" width="20" height="20" alt="icon" />
          <strong>In-My-Style</strong>
        </div>
        <button id="gc-close" style="background:transparent;border:0;color:#aaa;cursor:pointer;font-size:18px;">✕</button>
      </div>
      <div style="margin-top:10px;font-size:13px;opacity:0.9;">
        <div><b>Problem:</b> ${escapeHtml(ctx.title || "—")}</div>
        <div><b>Language:</b> ${escapeHtml(ctx.lang || "—")}</div>
        <div><b>Tags:</b> ${ctx.tags?.length ? ctx.tags.map(escapeHtml).join(", ") : "—"}</div>
      </div>
      <hr style="border-color: rgba(255,255,255,0.08); margin:12px 0;" />
      <div style="font-size:13px;line-height:1.5;opacity:0.92;">
        Pick a mode to fetch suggestion from your GitHub-backed local index.
      </div>
      <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">
        <button id="gc-mode-skel"   style="${btnStyle()}">Skeleton</button>
        <button id="gc-mode-hints"  style="${btnStyle()}">Skeleton + Hints</button>
        <button id="gc-mode-draft"  style="${btnStyle()}">Full Draft (opt-in)</button>
      </div>
      <div id="gc-msg" style="margin-top:10px;font-size:12px;opacity:0.8;"></div>
    `;

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    wrap.querySelector("#gc-close")?.addEventListener("click", () => wrap.remove());
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) wrap.remove();
    });

    const msg = wrap.querySelector("#gc-msg");

    async function requestAndShow(modeKey) {
      msg.textContent = "Preparing context...";
      try {
        // Get comprehensive problem context
        const fullContext = extractProblemContext();
        
        if (!fullContext.title && !fullContext.description) {
          msg.textContent = "Could not extract problem details. Are you on a problem page?";
          console.warn("Failed to extract problem context:", fullContext);
          return;
        }

        // Get current editor content for context
        let currentCode = "";
        try {
          const eds = window?.monaco?.editor?.getEditors();
          if (eds?.[0]) {
            currentCode = eds[0].getValue() || "";
          }
        } catch (e) {
          console.warn("Could not get editor content:", e);
        }

        msg.textContent = "Querying GitHub RAG index...";
        
        // Validate required fields before sending
        if (!fullContext.title || !fullContext.url) {
          msg.textContent = "Missing problem details. Please ensure you're on a LeetCode problem page.";
          return;
        }

        // Clean and validate the context
        const cleanContext = {
          ...fullContext,
          // Extract problem slug for better matching
          problemSlug: fullContext.url.match(/problems\/([^/]+)/)?.[1] || '',
          title: fullContext.title.trim(),
          difficulty: fullContext.difficulty || 'unknown',
          lang: fullContext.lang || 'unknown',
          // Ensure tags is always an array
          tags: Array.from(fullContext.tags || []).filter(Boolean)
        };

        console.log("🔍 Sending RAG query with context:", {
          ...cleanContext,
          codePreview: currentCode.slice(0, 100) + "..."
        });

        // Prepare a focused context for the LLM
        const queryContext = {
          type: "gc_rag_query",
          mode: modeKey,
          data: {
            // Keep original context for compatibility
            context: cleanContext,
            // Add structured format
            problem: {
              name: cleanContext.title,
              slug: cleanContext.problemSlug || cleanContext.title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
              description: cleanContext.description,
              url: cleanContext.url,
              difficulty: cleanContext.difficulty || 'unknown',
              constraints: cleanContext.constraints || []
            },
            preferences: {
              language: cleanContext.lang,
              tags: cleanContext.tags || [],
              mode: modeKey
            },
            currentCode: currentCode || '',
            requirements: {
              language: cleanContext.lang,
              style: 'clean and efficient',
              includeComments: true,
              includeDifficulty: true
            }
          }
        };
        
        // Add debug info
        console.log("📤 Sending query for:", {
          problem: `${cleanContext.title} (${cleanContext.difficulty})`,
          language: cleanContext.lang,
          mode: modeKey,
          description: cleanContext.description?.slice(0, 100) + "...",
          tags: cleanContext.tags
        });

        console.log("🔍 Sending structured query:", queryContext);
        
        const res = await chrome.runtime.sendMessage(queryContext);

        console.log("📥 RAG response:", res);

        if (!res) {
          msg.textContent = "No response received. Please check if the extension is active.";
          console.error("No response from background script");
          return;
        }

        if (res.error) {
          console.warn("RAG error:", res.error);
          msg.textContent = `Error: ${res.error}`;
          return;
        }

        // Validate response structure
        if (!res.code && !res.solution) {
          console.warn("Invalid response structure:", res);
          msg.textContent = "Received invalid response format from the server.";
          return;
        }

        const code = res.code || res.solution;
        if (!code || typeof code !== 'string') {
          msg.textContent = "No solution generated. This could be due to:\n" +
                          "- Problem not recognized\n" +
                          "- Language not supported\n" +
                          "- No similar solutions found";
          return;
        }

        msg.textContent = "";
        renderPreview(card, code, res.refs || []);
        
        // Log successful generation
        console.log("✅ Solution generated successfully for:", {
          problem: cleanContext.title,
          language: cleanContext.lang,
          mode: modeKey
        });
      } catch (e) {
        console.error("RAG query failed:", e);
        msg.textContent = "Failed to generate suggestion. Check console for details.";
      }
    }

    wrap.querySelector("#gc-mode-skel")?.addEventListener("click", async () => {
      console.log("🔍 Requesting skeleton with context:", ctx);
      await requestAndShow("skeleton");
    });
    wrap.querySelector("#gc-mode-hints")?.addEventListener("click", async () => {
      console.log("🔍 Requesting hints with context:", ctx);
      await requestAndShow("hints");
    });
    wrap.querySelector("#gc-mode-draft")?.addEventListener("click", async () => {
      console.log("🔍 Requesting draft with context:", ctx);
      await requestAndShow("draft");
    });
  }

  function renderPreview(card, code, refs) {
    // Remove old preview if exists
    const old = card.querySelector("#gc-preview-wrap");
    if (old) old.remove();

    const wrap = document.createElement("div");
    wrap.id = "gc-preview-wrap";
    wrap.style.marginTop = "10px";

    const refHtml = (refs && refs.length)
      ? `<div style="font-size:12px;opacity:.8;margin-bottom:8px;">
           <b>Closest matches:</b>
           ${refs.map(r => `<span style="border:1px solid rgba(255,255,255,.12); padding:2px 6px; border-radius:6px; margin-right:6px; display:inline-block;">${escapeHtml(r.title)} · ${escapeHtml(r.lang)}</span>`).join("")}
         </div>` : "";

    wrap.innerHTML = `
      ${refHtml}
      <textarea id="gc-code-preview" style="width:100%; height:220px; background:#0d0e12; color:#e6e6e6; border:1px solid rgba(255,255,255,0.12); border-radius:8px; padding:10px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size:12px; line-height:1.4;">${code.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")}</textarea>
      <div style="margin-top:10px; display:flex; gap:8px; flex-wrap:wrap;">
        <button id="gc-insert" style="${btnStyle()}">Insert into editor</button>
        <button id="gc-copy" style="${btnStyle()}">Copy</button>
      </div>
    `;
    card.appendChild(wrap);

    // Wire buttons
    wrap.querySelector("#gc-insert")?.addEventListener("click", async () => {
      const text = wrap.querySelector("#gc-code-preview").value;
      const ok = await insertIntoEditorSmart(text);
      if (ok) {
        toast("Inserted into Monaco.");
      } else {
        toast("Could not insert. Copied to clipboard.");
        try { await navigator.clipboard.writeText(text); } catch(_) {}
      }
    });
    wrap.querySelector("#gc-copy")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(wrap.querySelector("#gc-code-preview").value); } catch(_) {}
      toast("Copied to clipboard.");
    });
  }

  function btnStyle() {
    return [
      "padding:8px 10px",
      "border-radius:8px",
      "border:1px solid rgba(255,255,255,0.12)",
      "background:#17181d",
      "color:#fff",
      "cursor:pointer",
      "font-size:12px",
    ].join("; ");
  }

  function escapeHtml(s) {
    return (s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // -------- Monaco insertion helpers --------
  async function insertIntoEditorSmart(code) {
    // Try direct Monaco access from content world
    if (await tryMonacoDirect(code)) return true;
    // Fallback: use page bridge via postMessage
    const ok = await tryMonacoBridge(code);
    if (ok) return true;
    return false;
  }

  async function tryMonacoDirect(code) {
    try {
      const m = window.monaco;
      if (m?.editor?.getEditors) {
        const eds = m.editor.getEditors();
        if (eds && eds[0]?.setValue) {
          const prev = eds[0].getValue();
          eds[0].setValue(prev + "\n\n" + code);
          eds[0].setScrollTop(eds[0].getScrollHeight?.() ?? 0);
          return true;
        }
      }
      if (m?.editor?.getModels) {
        const models = m.editor.getModels();
        if (models && models[0]?.setValue) {
          models[0].setValue(models[0].getValue() + "\n\n" + code);
          return true;
        }
      }
    } catch(_) {}
    return false;
  }

  function tryMonacoBridge(code) {
    return new Promise((resolve) => {
      let done = false;
      function onMsg(ev) {
        const d = ev.data || {};
        if (d && d.type === 'GC_INSERT_RESULT') {
          window.removeEventListener('message', onMsg, true);
          if (!done) { done = true; resolve(!!d.ok); }
        }
      }
      window.addEventListener('message', onMsg, true);
      window.postMessage({ type:'GC_INSERT', code: String(code || "") }, '*');
      setTimeout(() => {
        if (!done) {
          window.removeEventListener('message', onMsg, true);
          done = true; resolve(false);
        }
      }, 1200);
    });
  }

  function injectPageBridge() {
  if (window.__gcBridgeInstalled) return;
  window.__gcBridgeInstalled = true;
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("pageHook.js");
  s.async = false;
  (document.head || document.documentElement).appendChild(s);
}


  function toast(msg) {
    const n = document.createElement("div");
    Object.assign(n.style, {
      position: "fixed", bottom: "88px", right: "18px", zIndex: 999999,
      background: "#111216", color: "#fff", border: "1px solid rgba(255,255,255,.12)",
      borderRadius: "10px", padding: "10px 12px", fontSize: "12px", boxShadow: "0 10px 30px rgba(0,0,0,.35)"
    });
    n.textContent = msg;
    document.body.appendChild(n);
    setTimeout(()=> n.remove(), 3000);
  }
})();
