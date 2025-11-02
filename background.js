// ===== LeetCode → GitHub Auto Push (MV3) =====

const QUEUE_KEY = "retryQueue";

// ---------- Notifications ----------
function notify(message, title = "LeetCode Auto Push") {
  try {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icon.png",
      title,
      message: String(message).slice(0, 200),
    });
  } catch (e) {
    console.warn("[LC-AutoPush] notify failed:", e);
  }
}

// ---------- Settings ----------
async function getSettings() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["username", "repo", "token", "branch"], (d) => {
      resolve({
        username: (d.username || "").trim(),
        repo: (d.repo || "").trim(),
        token: (d.token || "").trim(),
        branch: (d.branch || "main").trim(),
      });
    });
  });
}

// ---------- Helpers ----------
function langToExt(lang) {
  const L = (lang || "").toLowerCase();
  if (L.includes("java")) return "java";
  if (L.includes("python")) return "py";
  if (L.includes("cpp") || L.includes("c++")) return "cpp";
  if (L.includes("c#") || L.includes("csharp")) return "cs";
  if (L.includes("javascript") || L === "js") return "js";
  if (L.includes("typescript") || L === "ts") return "ts";
  if (L.includes("go")) return "go";
  if (L.includes("rust")) return "rs";
  if (L.includes("kotlin")) return "kt";
  if (L.includes("swift")) return "swift";
  if (L.includes("ruby")) return "rb";
  if (L.includes("dart")) return "dart";
  if (L.includes("scala")) return "scala";
  if (L.includes("c ") || L === "c") return "c";
  if (L.includes("php")) return "php";
  return "txt";
}

function slugify(title) {
  return (title || "Solution")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// Safe for large UTF-8 strings (no spread)
function toBase64(str) {
  const utf8 = new TextEncoder().encode(str || "");
  let binary = "";
  const CHUNK = 0x8000; // 32k
  for (let i = 0; i < utf8.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      utf8.subarray(i, i + CHUNK)
    );
  }
  return btoa(binary);
}

function ghHeaders(token, extra = {}) {
  if (!token) throw new Error("GitHub token missing");
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
    ...extra,
  };
}

async function getFileSha(url, token, branch) {
  const u = branch ? `${url}?ref=${encodeURIComponent(branch)}` : url;
  const res = await fetch(u, { headers: ghHeaders(token) });

  if (res.status === 200) {
    const j = await res.json();
    return j.sha;
  }
  if (res.status === 404) return null;

  const text = await res.text();
  console.error("[GitHub][GET] Non-OK:", res.status, text);
  if (res.status === 401) throw new Error("Unauthorized (401): Bad token or missing scope.");
  if (res.status === 403) throw new Error("Forbidden (403): Token lacks repo/public_repo scope or rate-limited.");
  throw new Error(`GitHub GET ${res.status}: ${text || "(empty)"}`);
}

async function putFile(url, token, message, b64content, sha, branch) {
  const body = { message, content: b64content };
  if (sha) body.sha = sha;
  if (branch) body.branch = branch;

  const res = await fetch(url, {
    method: "PUT",
    headers: ghHeaders(token),
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error("[GitHub][PUT] Non-OK:", res.status, text);
    if (res.status === 401) throw new Error("Unauthorized (401): Bad token or missing scope.");
    if (res.status === 403) throw new Error("Forbidden (403): Token lacks repo/public_repo scope or rate-limited.");
    if (res.status === 409) throw new Error("Conflict (409): SHA mismatch or branch protection.");
    throw new Error(`GitHub PUT ${res.status}: ${text || "(empty)"}`);
  }
  return JSON.parse(text);
}

// ---------- Upload ----------
async function uploadToGitHub(title, code, lang, { retry = false } = {}) {
  const { username, repo, token, branch } = await getSettings();

  if (!username || !repo || !token) {
    throw new Error("GitHub credentials not set (username/repo/token). Open the popup and Save.");
  }

  const ext = langToExt(lang);
  const safeTitle = slugify(title);
  const filename = `${safeTitle}.${ext}`;
  const path = `solutions/${ext}/${filename}`;
  const owner = encodeURIComponent(username);
  const repoName = encodeURIComponent(repo);
  const url = `https://api.github.com/repos/${owner}/${repoName}/contents/${encodeURI(path)}`;
  const b64 = toBase64(code || "");

  console.log("[Upload] Start", { title, ext, path, branch });

  let sha = null;
  try {
    sha = await getFileSha(url, token, branch);
    console.log("[Upload] Existing SHA:", sha);
  } catch (e) {
    console.error("[Upload] getFileSha failed:", e);
    throw e;
  }

  const commitMsg = `${sha ? "Update" : "Add"} solution: ${title}`;
  const resp = await putFile(url, token, commitMsg, b64, sha, branch);

  notify(`✅ ${title} pushed to ${repo}`);
  console.log("[Upload] Success →", `${username}/${repo}/${path}`, resp);
  return resp;
}

// ---------- Message Bridge ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "submission") {
    uploadToGitHub(msg.title, msg.code, msg.lang)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("[UploadError]", err);
        notify(`❌ Upload failed: ${String(err).slice(0, 150)}`);
        sendResponse({ ok: false, error: String(err) });
      });
    return true; // keep SW alive for async
  }

  if (msg.type === "testCreds") {
    (async () => {
      try {
        const { username, repo, token } = await getSettings();
        const owner = encodeURIComponent(username);
        const repoName = encodeURIComponent(repo);
        const testUrl = `https://api.github.com/repos/${owner}/${repoName}`;
        const res = await fetch(testUrl, { headers: ghHeaders(token) });
        const text = await res.text();

        console.log("[TestCreds] status:", res.status, "body:", text);

        if (res.status === 200) {
          notify("✅ GitHub credentials look good.");
          sendResponse({ ok: true });
        } else if (res.status === 404) {
          notify("❌ Repo not found.");
          sendResponse({ ok: false, status: 404, message: text });
        } else if (res.status === 401) {
          notify("❌ Unauthorized token.");
          sendResponse({ ok: false, status: 401, message: text });
        } else if (res.status === 403) {
          notify("❌ Forbidden: scope missing or rate-limited.");
          sendResponse({ ok: false, status: 403, message: text });
        } else {
          notify(`⚠️ GitHub responded ${res.status}`);
          sendResponse({ ok: false, status: res.status, message: text || "(empty)" });
        }
      } catch (e) {
        console.error("[TestCreds] failed:", e);
        notify(`❌ Test failed: ${String(e)}`);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // async
  }
});

// ===============================
// GitCode RAG (robust repo sync)
// ===============================
const GC_DB_NAME = "gc_rag_db";
const GC_STORE_DOCS = "docs";
const GC_STORE_META = "meta";

// OpenAI Configuration
const OPENAI_CONFIG = {
  model: "gpt-4-1106-preview",
  temperature: 0.3,
  max_tokens: 2000
};

async function callOpenAI(messages) {
  const cfg = await new Promise(r => 
    chrome.storage.local.get(['openai_key'], r)
  );
  
  if (!cfg.openai_key) {
    throw new Error('OpenAI API key not set');
  }

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${cfg.openai_key}`
    },
    body: JSON.stringify({
      ...OPENAI_CONFIG,
      messages
    })
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || 'OpenAI API error');
  return json.choices[0].message.content;
}

// ---------- IndexedDB helpers ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(GC_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(GC_STORE_DOCS)) {
        db.createObjectStore(GC_STORE_DOCS, { keyPath: "id" }); // id = path
      }
      if (!db.objectStoreNames.contains(GC_STORE_META)) {
        db.createObjectStore(GC_STORE_META, { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbPut(store, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(store, key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbGetAll(store) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// ---------- GitHub helpers ----------

async function getDefaultBranch(owner, repo, token) {
  const url = `https://api.github.com/repos/${owner}/${repo}`;
  const r = await fetch(url, { headers: ghHeaders(token) });
  if (!r.ok) throw new Error(`Repo meta failed: ${r.status}`);
  const j = await r.json();
  return j.default_branch || "main";
}
// --- REPLACE: getTreeEntries, fetchBlobContent, gcSyncRepo ---
// This version uses the GitHub Contents API (recursive) and works with private repos
// having "Repository contents: Read" permission on your token.

function encodePath(path) {
  if (!path) return "";
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function getTreeEntries(owner, repo, branch, token) {
  const headers = typeof ghHeaders === "function"
    ? ghHeaders(token)
    : { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };

  // BFS over directories via Contents API (works with private repos)
  async function listDir(path) {
    const base = `https://api.github.com/repos/${owner}/${repo}/contents`;
    const url = `${base}/${path ? encodePath(path) : ""}?ref=${encodeURIComponent(branch)}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Contents list failed (${path || "/"}) : ${res.status}`);
    }
    const json = await res.json();
    // If a single file is returned (object), normalize to array
    return Array.isArray(json) ? json : [json];
  }

  const queue = [""]; // start at repo root
  const blobs = [];

  while (queue.length) {
    const dir = queue.shift();
    let items;
    try {
      items = await listDir(dir);
    } catch (e) {
      // if a path is a file (not dir), just skip
      continue;
    }

    for (const it of items) {
      // it.type: "file" | "dir" | "symlink" | "submodule"
      if (it.type === "dir") {
        queue.push(it.path);
      } else if (it.type === "file") {
        // normalize "blob-like" record to keep compatibility with old callers
        blobs.push({ path: it.path, sha: it.sha, type: "blob", size: it.size || 0 });
      }
    }
  }

  return blobs;
}

// Fetch file content by **sha OR path** (handles both).
// - If 'id' looks like a SHA → use /git/blobs/{sha}
// - Else treat it as a PATH → use /contents/{path}?ref={branch}
async function fetchBlobContent(owner, repo, id, token, branchOpt) {
  const headers = typeof ghHeaders === "function"
    ? ghHeaders(token)
    : { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };

  const isSha = /^[0-9a-f]{20,}$/i.test(id);
  if (isSha) {
    // Blob API (base64)
    const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${id}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Blob fetch failed: ${res.status}`);
    const j = await res.json();
    if (!j.content || j.encoding !== "base64") return "";
    return atob(j.content.replace(/\n/g, ""));
  } else {
    // Contents API by path (base64)
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${encodePath(id)}${branchOpt ? `?ref=${encodeURIComponent(branchOpt)}` : ""}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`Contents fetch failed: ${res.status}`);
    const j = await res.json();
    if (!j.content || j.encoding !== "base64") return "";
    return atob(j.content.replace(/\n/g, ""));
  }
}

// ---------- Repo sync ----------
async function gcSyncRepo() {
  const cfg = await new Promise((r) =>
    chrome.storage.local.get(["username", "repo", "branch", "token", "gc_path_prefix"], r)
  );

  const owner = cfg.username?.trim();
  const repo  = cfg.repo?.trim();
  let branch  = (cfg.branch || "").trim();
  const token = cfg.token?.trim();
  const pathPrefix = (cfg.gc_path_prefix || "").trim(); // e.g. "solutions/" or "" for root

  if (!owner || !repo || !token) {
    return { ok: false, error: "Missing GitHub credentials (username/repo/token)", count: 0 };
  }

  // Auto-detect default branch if blank
  if (!branch) {
    try {
      const headers = typeof ghHeaders === "function"
        ? ghHeaders(token)
        : { Authorization: `token ${token}`, Accept: "application/vnd.github+json" };
      const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
      if (!metaRes.ok) throw new Error(`Repo meta failed: ${metaRes.status}`);
      const meta = await metaRes.json();
      branch = meta.default_branch || "main";
    } catch (e) {
      return { ok: false, error: `Failed to detect default branch: ${e.message}`, count: 0 };
    }
  }

  // Crawl entire repo via Contents API
  let allBlobs = [];
  try {
    allBlobs = await getTreeEntries(owner, repo, branch, token);
  } catch (e) {
    return { ok: false, error: `Tree/Contents error: ${e.message}`, count: 0 };
  }

  // Filter by prefix + extension
  const matchFn = (p, prefix) => {
    const low = p.toLowerCase();
    if (prefix && !low.startsWith(prefix.toLowerCase())) return false;
    // add any other extensions you use
    return /\.(cpp|cc|cxx|c|java|py|js|ts|rs|go|kt|swift|cs|rb|php)$/i.test(p);
  };

  let matched = allBlobs.filter((f) => matchFn(f.path, pathPrefix));
  // If prefix set but nothing matched, retry without prefix (diagnostic-friendly)
  if (!matched.length && pathPrefix) {
    console.warn("[GitCode] 0 matched under prefix:", pathPrefix, "→ retrying without prefix");
    matched = allBlobs.filter((f) => matchFn(f.path, ""));
  }

  // Diagnostics (service worker console)
  console.warn("[GitCode][Sync] branch:", branch);
  console.warn("[GitCode][Sync] total files seen:", allBlobs.length);
  console.warn("[GitCode][Sync] sample paths:", allBlobs.slice(0, 10).map((b) => b.path));
  console.warn("[GitCode][Sync] matched code files:", matched.length);

  if (!matched.length) {
    return {
      ok: true,
      count: 0,
      info: `Saw ${allBlobs.length} files. 0 matched code files${pathPrefix ? ` under '${pathPrefix}'` : ""}.`
    };
  }

  // Fetch & store only changed files
  let count = 0;
  for (const f of matched) {
    try {
      const existing = await idbGet(GC_STORE_DOCS, f.path);
      if (existing?.sha === f.sha) continue; // unchanged

      // NOTE: now we fetch by PATH (works with Contents API + private repos)
      const code = await fetchBlobContent(owner, repo, f.path, token, branch);
      const doc = normalizeDoc(f.path, code, f.sha);
      await idbPut(GC_STORE_DOCS, doc);
      count++;
    } catch (e) {
      console.warn("[GitCode] Skipped due to fetch error:", f.path, e?.message || e);
    }
  }

  // Rebuild index & style
  const allDocs = await idbGetAll(GC_STORE_DOCS);
  const { index } = buildBM25(allDocs);
  await idbPut(GC_STORE_META, { key: "bm25", index });
  const style = buildStyleProfile(allDocs);
  await idbPut(GC_STORE_META, { key: "style", ...style });

  return { ok: true, count, info: `Indexed ${allDocs.length} docs.` };
}

// Flexible code-path filter (optionally limit by prefix)
function isCodePathFlexible(p, prefix) {
  const low = p.toLowerCase();
  if (prefix && !low.startsWith(prefix.toLowerCase())) return false;
  return /\.(cpp|cc|cxx|c|java|py|js|ts|rs|go|kt|swift)$/i.test(p);
}

// ---------- Doc normalization ----------
function normalizeDoc(path, code, sha) {
  const lang = detectLang(path);
  const title = path
    .split("/")
    .pop()
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
  const comments = extractComments(code, lang).slice(0, 800); // cap
  const signature = extractSignature(code, lang);
  const tags = []; // parse front-matter later if you add it
  return {
    id: path,
    sha,
    path,
    lang,
    title,
    tags,
    signature,
    comments,
    code,
    ts: Date.now(),
  };
}
function detectLang(path) {
  const ext = (path.split(".").pop() || "").toLowerCase();
  const map = {
    cpp: "cpp",
    cc: "cpp",
    cxx: "cpp",
    c: "c",
    java: "java",
    py: "python",
    js: "javascript",
    ts: "typescript",
    rs: "rust",
    go: "go",
    kt: "kotlin",
    swift: "swift",
  };
  return map[ext] || ext;
}
function extractComments(code, lang) {
  try {
    if (["cpp", "c", "java", "javascript", "typescript", "go", "rust", "kotlin", "swift"].includes(lang)) {
      const block = code.match(/\/\*[\s\S]*?\*\//g) || [];
      const line = code.match(/(^|\s)\/\/[^\n]*/g) || [];
      return [...block, ...line].join("\n");
    }
    if (lang === "python") {
      const triple = code.match(/("""|''')[\s\S]*?\1/g) || [];
      const hash = code.match(/(^|\s)\#[^\n]*/g) || [];
      return [...triple, ...hash].join("\n");
    }
  } catch (_) {}
  return "";
}
function extractSignature(code, lang) {
  try {
    if (lang === "java") {
      const m = code.match(/class\s+\w+[\s\S]*?{[\s\S]*?public\s+[^\(]+\([^\)]*\)/);
      return m ? m[0].slice(0, 280) : "";
    }
    if (lang === "cpp" || lang === "c") {
      const m = code.match(/[a-zA-Z_][\w:\<\>\s\*&]+\s+[a-zA-Z_]\w*\s*\([^\)]*\)\s*{/);
      return m ? m[0].slice(0, 280) : "";
    }
    if (lang === "python") {
      const m = code.match(/def\s+\w+\s*\([^\)]*\)\s*:/);
      return m ? m[0] : "";
    }
  } catch (_) {}
  return "";
}

// ---------- BM25 (build/query) ----------
function tokenize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9_]+/g, " ").split(/\s+/).filter(Boolean);
}
function buildBM25(docs) {
  const fields = (d) =>
    [
      ...(d.title ? [d.title] : []),
      ...(d.tags?.length ? [d.tags.join(" ")] : []),
      ...(d.signature ? [d.signature] : []),
      ...(d.comments ? [d.comments] : []),
    ].join(" ");
  const corpus = docs.map((d) => tokenize(fields(d)));
  const N = corpus.length;
  const df = new Map();
  const tf = corpus.map((tokens) => {
    const map = new Map();
    tokens.forEach((t) => map.set(t, (map.get(t) || 0) + 1));
    for (const k of new Set(tokens)) df.set(k, (df.get(k) || 0) + 1);
    return map;
  });
  const avgdl = corpus.reduce((a, t) => a + t.length, 0) / (N || 1);
  const k1 = 1.5,
    b = 0.75;
  const vocab = Array.from(df.keys());
  const idf = new Map(
    vocab.map((t) => [t, Math.log((N - (df.get(t) || 0) + 0.5) / ((df.get(t) || 0) + 0.5) + 1)])
  );

  return {
    index: {
      idf: Array.from(idf.entries()),
      avgdl,
      k1,
      b,
      df: Array.from(df.entries()),
      tfCounts: tf.map((m) => Array.from(m.entries())),
      docs: docs.map((d) => ({ id: d.id, title: d.title, lang: d.lang, tags: d.tags })),
    },
  };
}
async function bm25Query(qText, langPref) {
  const meta = await idbGet(GC_STORE_META, "bm25");
  if (!meta || !meta.index) return [];
  const idx = meta.index;

  // reconstruct tf maps quickly
  const tfMaps = idx.tfCounts.map((arr) => {
    const m = new Map();
    arr.forEach(([k, v]) => m.set(k, v));
    return m;
  });
  const df = new Map(idx.df);
  const N = tfMaps.length;
  const avgdl = idx.avgdl || 1;
  const k1 = idx.k1 || 1.5,
    b = idx.b || 0.75;

  const q = tokenize(qText);
  const scores = tfMaps.map((m, i) => {
    let s = 0,
      dl = 0;
    for (const [, v] of m) dl += v;
    if (!dl) dl = 1;
    for (const term of q) {
      const f = m.get(term) || 0;
      if (!f) continue;
      const id = Math.log((N - (df.get(term) || 0) + 0.5) / ((df.get(term) || 0) + 0.5) + 1);
      s += (id * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * dl) / avgdl));
    }
    const doc = idx.docs[i];
    if (langPref && doc.lang && doc.lang.toLowerCase().includes(langPref.toLowerCase())) s *= 1.1;
    return { i, s };
  });

  scores.sort((a, b) => b.s - a.s);
  const top = scores.slice(0, 6).filter((x) => x.s > 0.0001);
  const fullDocs = await idbGetAll(GC_STORE_DOCS);
  return top
    .map(({ i, s }) => ({ score: s, doc: fullDocs.find((d) => d.id === idx.docs[i].id) }))
    .filter(Boolean);
}

// ---------- Style profile (MVP) ----------
function buildStyleProfile(docs) {
  if (!docs?.length) return { key: "style", style: { indent: 2, brace: "kr", naming: "camel", comment: "line" } };
  const sample = docs.slice(0, 40);
  let indent2 = 0,
    indent4 = 0;
  let kr = 0,
    allman = 0;
  let camel = 0,
    snake = 0;
  let lineC = 0,
    blockC = 0;
  for (const d of sample) {
    const lines = d.code.split(/\r?\n/);
    lines.forEach((L) => {
      const m = L.match(/^(\s+)/);
      if (m) {
        const n = m[1].length;
        if (n % 4 === 0) indent4++;
        if (n % 2 === 0) indent2++;
      }
      if (/\)\s*{/.test(L)) kr++;
      if (/^\s*{\s*$/.test(L)) allman++;
      if (/[a-z0-9][A-Z]/.test(L)) camel++;
      if (/[a-z0-9]_[a-z0-9]/.test(L)) snake++;
      if (/\s\/\//.test(L)) lineC++;
      if (/\/\*/.test(L)) blockC++;
    });
  }
  const indent = indent4 > indent2 ? 4 : 2;
  const brace = kr >= allman ? "kr" : "allman";
  const naming = camel >= snake ? "camel" : "snake";
  const comment = lineC >= blockC ? "line" : "block";
  return { key: "style", style: { indent, brace, naming, comment } };
}

function analyzeDocStructure(doc) {
  if (!doc?.code) return {};
  const code = doc.code;
  const lines = code.split(/\r?\n/);
  let functionCount = 0;
  let usesStepComments = false;
  let usesInlineComments = false;
  let usesBlockComments = false;
  let classSolution = /class\s+Solution/.test(code);

  const fnPatterns = [
    /^\s*(?:static\s+)?(?:inline\s+)?(?:public\s+|private\s+|protected\s+)?[a-zA-Z_][\w:<>\[\]]*\s+[a-zA-Z_][\w]*\s*\([^;]*\)\s*\{/,
    /^\s*(?:const\s+)?(?:auto\s+)?[a-zA-Z_][\w]*\s*\([^;{]*\)\s*=>/,
    /^\s*function\s+[a-zA-Z_]\w*\s*\(/,
    /^\s*def\s+[a-zA-Z_]\w*\s*\(/,
  ];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/\/\/|#(?!include)/.test(line)) usesInlineComments = true;
    if (/\/\*/.test(line)) usesBlockComments = true;
    if (/step\s*\d+/i.test(line) || /phase\s*\d+/i.test(line) || /^#?\s*step\s*:?/i.test(line)) usesStepComments = true;
    const isFunction = fnPatterns.some((re) => re.test(line));
    if (isFunction) functionCount++;
  }

  return {
    functionCount,
    usesStepComments,
    usesInlineComments,
    usesBlockComments,
    classSolution,
  };
}

function buildStyleHints(examples, fallbackStyle) {
  let style = {
    indent: 2,
    brace: "kr",
    naming: "camel",
    comment: "line",
    ...(fallbackStyle || {}),
  };
  const cues = [];

  if (examples?.length) {
    try {
      const derived = buildStyleProfile([examples[0]]);
      if (derived?.style) {
        style = { ...style, ...derived.style };
      }
    } catch (e) {
      console.warn("[GitCode][Style] Unable to derive style from example:", e);
    }

    const structure = analyzeDocStructure(examples[0]);
    if (structure.classSolution) {
      cues.push("Wrap the solver inside your usual `class Solution` shell.");
    }
    if (structure.functionCount > 1) {
      cues.push("Separate reusable logic into helper functions just like the reference submission.");
    }
    if (structure.usesStepComments) {
      cues.push("Annotate major phases with step-style comments (e.g., `// Step 1:`).");
    } else if (structure.usesInlineComments && !structure.usesBlockComments) {
      cues.push("Use short inline comments to explain tricky branches.");
    } else if (structure.usesBlockComments && !structure.usesInlineComments) {
      cues.push("Prefer block comments for multi-line explanations.");
    }
  }

  return { style, cues };
}

// ---------- Synthesis ----------
function synthSkeleton(mode, ctx, style, refs) {
  const indent = " ".repeat(style?.indent || 2);
  const braceOpen = style?.brace === "allman" ? "\n{\n" : " {\n";
  const braceClose = "}\n";
  const lang = (ctx.lang || "").toLowerCase();

  const header = (t) => (style?.comment === "line" ? `// ${t}\n` : `/* ${t} */\n`);
  const todo = (t) => (style?.comment === "line" ? `${indent}// TODO: ${t}\n` : `${indent}/* TODO: ${t} */\n`);

  if (lang.includes("java")) {
    return `${header("In-My-Style skeleton (Java)")}
class Solution {${braceOpen}${indent}${header("1) Parse inputs / read function signature as needed")}
${indent}${todo("Define core idea (DP/Graph/Two-Pointers etc.)")}
${indent}${header("2) Setup data structures")}
${indent}${todo("Init arrays/graphs/DSU/etc.")}
${indent}${header("3) Core logic")}
${indent}${todo("Main loop / transitions / invariants")}
${indent}${header("4) Edge-cases")}
${indent}${todo("Empty input / duplicates / bounds")}
${indent}${header("5) Return / output")}
${indent}${todo("Return final answer")}
${braceClose}`;
  }
  if (lang.includes("cpp") || lang.includes("c++") || lang.includes("c")) {
    return `${header("In-My-Style skeleton (C++)")}
#include <bits/stdc++.h>
using namespace std;

${header("1) Helpers / DS as you prefer")}
${todo("Optional: DSU/KMP/SegTree helpers")}

${header("2) Solve function")}
${style?.brace === "allman" ? "int solve()\n{\n" : "int solve() {\n"}${indent}${todo(
      "Parse input signature or adapt to LeetCode function"
    )}${indent}${todo("Init DS / variables")}
${indent}${todo("Main logic")}
${indent}${todo("Edge cases & invariants")}
${indent}return 0;
${braceClose}
int main()${braceOpen}${indent}ios::sync_with_stdio(false); cin.tie(nullptr);
${indent}return solve();
${braceClose}`;
  }
  if (lang.includes("python")) {
    return `${header("In-My-Style skeleton (Python)")}
def solve():
${indent}${todo("Read/parse input")}
${indent}${todo("Choose approach: DP/Graph/Two-Pointers/etc.")}
${indent}${todo("Write core logic")}
${indent}${todo("Handle edge cases")}
${indent}return

if __name__ == "__main__":
${indent}solve()
`;
  }
  // Default generic
  return `${header("In-My-Style skeleton (generic)")}
${todo("Set up inputs")}
${todo("Choose approach: DP/Graph/Two-Pointers/etc.")}
${todo("Main logic")}
${todo("Edge cases")}
${todo("Return/print output")}
`;
}

async function handleRagQuery(ctx, mode) {
  if (!ctx?.data) {
    throw new Error("Invalid RAG query payload");
  }

  const rawContext = ctx.data.context || {};
  const problem = ctx.data.problem || {};
  const preferences = ctx.data.preferences || {};

  const context = {
    ...rawContext,
  };

  if (!context.title) {
    context.title =
      problem.name ||
      problem.slug?.replace(/[-_]+/g, " ") ||
      rawContext.problemSlug ||
      "Unknown Problem";
  }

  if (!context.problemSlug) {
    context.problemSlug =
      problem.slug ||
      (context.title
        ? context.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
        : undefined);
  }

  if (!context.description || context.description === "...") {
    context.description = problem.description || "";
  }

  if (!context.difficulty || context.difficulty === "unknown") {
    context.difficulty = problem.difficulty || "unknown";
  }

  if (!Array.isArray(context.constraints) || !context.constraints.length) {
    const problemConstraints = Array.isArray(problem.constraints) ? problem.constraints : [];
    context.constraints = problemConstraints.length ? problemConstraints : [];
  }
  context.constraints = Array.isArray(context.constraints)
    ? context.constraints.map((c) => String(c).trim()).filter(Boolean)
    : [];

  const prefTags = Array.isArray(preferences.tags)
    ? preferences.tags.filter(Boolean)
    : [];
  if (!Array.isArray(context.tags) || !context.tags.length) {
    context.tags = prefTags;
  }
  if (!Array.isArray(context.tags)) {
    context.tags = [context.tags].filter(Boolean);
  }
  context.tags = Array.from(new Set(context.tags.map((t) => String(t).trim()).filter(Boolean)));

  context.lang =
    (context.lang || preferences.language || "").trim().toLowerCase();

  context.title = (context.title || "").trim();
  context.description = (context.description || "").trim();

  if (!context.description) {
    context.description =
      "Problem description unavailable. Try reloading the problem page, then click the button again.";
  }

  if (!context.title) {
    throw new Error("Problem title missing from extracted context.");
  }

  if (!context.lang) {
    throw new Error(
      "Programming language not detected. Select a language in the editor and retry."
    );
  }

  // Get style preferences
  const styleMeta = await idbGet(GC_STORE_META, "style");
  let style = styleMeta?.style || { 
    indent: 2, 
    brace: "kr", 
    naming: "camel", 
    comment: "line" 
  };

  // Build comprehensive search query
  const searchTerms = [
    context.title,
    context.problemSlug,
    ...(context.constraints || []),
    ...(context.tags || []),
    context.difficulty
  ].filter(Boolean);

  // Improved BM25 search with language preference
  const hits = await bm25Query(searchTerms.join(" "), context.lang);
  console.warn("[GitCode][RAG] query", {
    terms: searchTerms,
    lang: context.lang,
    hitCount: hits.length,
    sample: hits.slice(0, 3).map((h) => ({
      path: h.doc?.path,
      lang: h.doc?.lang,
      score: Number(h.score?.toFixed?.(3) ?? h.score),
    })),
  });
  
  // Get example solutions for reference
  const examples = await Promise.all(
    hits.slice(0, 3).map(async h => ({
      title: h.doc.title,
      lang: h.doc.lang,
      path: h.doc.path,
      code: h.doc.code
    }))
  );

  const { style: repoStyle, cues: repoCues } = buildStyleHints(examples, style);
  style = repoStyle;

  // Build enhanced prompt for GPT-4
  const prompt = [
    {
      role: "system", 
      content: `You are an expert coding assistant specializing in algorithm problems.
Your task is to generate clear, efficient solutions following specific style guidelines.

Style preferences to follow:
- Indentation: ${style.indent} spaces
- Bracing style: ${style.brace === 'kr' ? 'K&R (brace on same line)' : 'Allman (brace on new line)'}
- Naming: ${style.naming === 'camel' ? 'camelCase' : 'snake_case'}
- Comments: ${style.comment === 'line' ? 'line comments (//)' : 'block comments (/* */)'}

${repoCues.length ? `Repo-specific cues:\n${repoCues.map(c => `- ${c}`).join('\n')}\n` : ""}

Key requirements:
1. Clean, readable code following the style guide
2. Optimal time/space complexity
3. Clear comments explaining the approach
4. Proper edge case handling
5. Well-structured functions with meaningful names`
    },
    {
      role: "user",
      content: `Generate a ${mode} solution for this LeetCode problem:

Title: ${context.title}
Description: ${context.description}
Difficulty: ${context.difficulty || 'Unknown'}
Language: ${context.lang}
Constraints: ${context.constraints?.join('\n') || 'None specified'}
Tags: ${context.tags?.join(', ') || 'None'}

${mode === 'skeleton' ? 'Create a solution skeleton with TODOs and structure' :
  mode === 'hints' ? 'Provide a partially implemented solution with key hints' :
  'Implement a complete solution with full implementation'}

${examples.length ? `\nReference solutions in similar style (from your repository):
${examples.map(ex => `\n=== ${ex.title} (${ex.lang}) — ${ex.path || 'path n/a'} ===\n${ex.code}`).join('\n')}` : ''}

${examples.length ? `Study the references above and mirror their naming patterns, helper structure, and comment voice in your response.` : ''}

Requirements:
1. Follow the style guide exactly
2. Include clear approach explanation
3. Mark key invariants and edge cases
4. Use optimal data structures
5. Provide time/space complexity
6. Keep the structure (helpers, comment cadence, ordering) aligned with the reference solutions.
7. If you intentionally diverge from the reference approach, note the reason in a short comment.
`
    }
  ];

  // Get LLM response with error handling
  let code;
  try {
    code = await callOpenAI(prompt);
    
    // Validate response
    if (!code || code.length < 50) {
      throw new Error('Generated solution too short or empty');
    }
    
    // Log success
    console.log("✅ Solution generated:", {
      problem: context.title,
      mode,
      language: context.lang,
      length: code.length
    });
    
  } catch (error) {
    console.error("❌ OpenAI API error:", error);
    throw new Error(`Failed to generate solution: ${error.message}`);
  }

  return {
    ok: true,
    code,
    refs: examples.map(ex => ({
      title: ex.title,
      lang: ex.lang
    }))
  };
}

// ---------- Message endpoints ----------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    try {
      // Validate message
      if (!msg?.type) {
        throw new Error('Missing message type');
      }

      // Handle repository sync request
      if (msg.type === "gc_sync_repo") {
        const res = await gcSyncRepo().catch((e) => ({ ok: false, error: String(e) }));
        sendResponse(res);
        return;
      } 
      
      // Handle RAG query request
      if (msg.type === "gc_rag_query") {
        // Log received query
        console.log("📥 Received RAG query:", {
          type: msg.type,
          mode: msg.mode,
          problemName: msg.data?.problem?.name || msg.data?.context?.title,
          language: msg.data?.preferences?.language || msg.data?.context?.lang
        });

        // Validate message structure
        if (!msg.data) {
          throw new Error('Missing query data');
        }

        // Extract and normalize problem details
        const problem = {
          name: msg.data?.problem?.name || msg.data?.context?.title || "",
          description: msg.data?.problem?.description || msg.data?.context?.description || "",
          difficulty: msg.data?.problem?.difficulty || msg.data?.context?.difficulty || "unknown",
          slug: msg.data?.problem?.slug || msg.data?.context?.problemSlug || msg.data?.context?.title?.toLowerCase().replace(/[^a-z0-9]+/g, '-') || ""
        };

        // Validate extracted data (allow fallback for description)
        if (!problem.name && !msg.data?.context?.title) {
          throw new Error('Missing required problem title. Reload the page and try again.');
        }

        // Ensure we have an index
        const meta = await idbGet(GC_STORE_META, "bm25");
        if (!meta) {
          const synced = await gcSyncRepo().catch(() => null);
          if (!synced?.ok) {
            throw new Error("Solution index is empty. Click 'Sync now' in popup to index your solutions.");
          }
        }

        console.log("[GitCode][RAG] normalized problem payload", {
          name: problem.name,
          descriptionPreview: problem.description?.slice(0, 80) || "(empty)",
          difficulty: problem.difficulty,
          slug: problem.slug,
          langPref: msg.data?.preferences?.language,
          contextTitle: msg.data?.context?.title,
          contextDescriptionPreview: msg.data?.context?.description?.slice(0, 80) || "(empty)"
        });

        // Process the query
        const res = await handleRagQuery(msg, msg.mode || "skeleton");
        
        // Log success
        console.log("✅ RAG query processed:", {
          problem: problem.name,
          mode: msg.mode,
          success: true
        });
        
        // Send successful response with metadata
        sendResponse({
          ok: true,
          ...res,
          query: {
            problem: problem.name,
            language: msg.data?.preferences?.language || msg.data?.context?.lang,
            mode: msg.mode
          }
        });
      }
    } catch (error) {
      // Log the error
      console.error("❌ Error processing message:", {
        type: msg?.type,
        error: error.message || error
      });

      // Send error response
      sendResponse({
        ok: false,
        error: error.message || 'Unknown error occurred',
        query: msg?.type === "gc_rag_query" ? {
          problem: msg.data?.problem?.name || msg.data?.context?.title,
          language: msg.data?.preferences?.language || msg.data?.context?.lang,
          mode: msg.mode
        } : undefined
      });
    }
  })();
  return true; // Keep the message channel open for async response
});
