// =======================
// popup.js (final)
// =======================

document.addEventListener("DOMContentLoaded", () => {
  const usernameEl = document.getElementById("username");
  const repoEl = document.getElementById("repo");
  const tokenEl = document.getElementById("token");
  const branchEl = document.getElementById("branch");
  const openaiKeyEl = document.getElementById("openai_key");
  const statusEl = document.getElementById("status");
  const saveBtn = document.getElementById("save");
  const testBtn = document.getElementById("testCredsBtn");

  const setStatus = (msg, color = "inherit") => {
    statusEl.textContent = msg;
    statusEl.style.color = color;
  };

  const setDisabled = (flag) => {
    saveBtn.disabled = flag;
    if (testBtn) testBtn.disabled = flag;
    usernameEl.disabled = flag;
    repoEl.disabled = flag;
    tokenEl.disabled = flag;
    if (branchEl) branchEl.disabled = flag;
  };

  // 1) Load saved values
  chrome.storage.local.get(["username", "repo", "token", "branch"], (d) => {
    // populate if present
    if (d.username) usernameEl.value = d.username;
    if (d.repo) repoEl.value = d.repo;
    if (d.token) tokenEl.value = d.token;
    branchEl.value = (d.branch || "main");
  });

  // 2) Save values
  saveBtn.addEventListener("click", () => {
    const username = (usernameEl.value || "").trim();
    const repo = (repoEl.value || "").trim();
    const token = (tokenEl.value || "").trim();
    const branch = (branchEl.value || "main").trim() || "main";

    if (!username || !repo || !token) {
      setStatus("⚠️ Please fill username, repo, and token.", "red");
      return;
    }

    setDisabled(true);
    setStatus("💾 Saving...", "black");
    chrome.storage.local.set({ username, repo, token, branch }, () => {
      if (chrome.runtime.lastError) {
        setStatus("❌ Save failed: " + chrome.runtime.lastError.message, "red");
      } else {
        setStatus("✅ Saved!", "green");
        setTimeout(() => setStatus(""), 1500);
      }
      setDisabled(false);
    });
  });

  // 3) Test credentials
  testBtn.addEventListener("click", () => {
    setDisabled(true);
    setStatus("⏳ Testing…", "black");

    try {
      chrome.runtime.sendMessage({ type: "testCreds" }, (resp) => {
        if (chrome.runtime.lastError) {
          setStatus("⚠️ " + chrome.runtime.lastError.message, "red");
          setDisabled(false);
          return;
        }
        if (resp?.ok) {
          setStatus("✅ Credentials OK.", "green");
        } else {
          const code = resp?.status ? ` (${resp.status})` : "";
          const msg = (resp?.message || resp?.error || "Unknown error").slice(0, 200);
          setStatus("❌ Test failed" + code + ": " + msg, "red");
        }
        setDisabled(false);
      });
    } catch (e) {
      setStatus("❌ Test threw: " + String(e), "red");
      setDisabled(false);
    }
  });
});


  // === GitCode RAG: manual sync trigger ===
  (() => {
    const syncBtn = document.getElementById("gc-sync");
    const syncStatus = document.getElementById("gc-sync-status");
    if (!syncBtn) return;

    syncBtn.addEventListener("click", async () => {
      syncStatus.textContent = "Syncing…";
      try {
        const res = await chrome.runtime.sendMessage({ type: "gc_sync_repo" });
        syncStatus.textContent = res?.ok ? `Synced ${res.count||0} files` : (res?.error || "Failed");
      } catch (e) {
        syncStatus.textContent = "Failed to trigger sync";
      }
      setTimeout(()=> syncStatus.textContent="", 4000);
    });
  })();

  // === OpenAI key handler ===
  (() => {
    const saveOpenAIBtn = document.getElementById("save-openai");
    if (!saveOpenAIBtn) return;

    // Load saved key
    chrome.storage.local.get(['openai_key'], (d) => {
      if (d.openai_key) {
        document.getElementById('openai_key').value = d.openai_key;
      }
    });

    saveOpenAIBtn.addEventListener('click', () => {
      const key = document.getElementById('openai_key').value.trim();
      if (!key) {
        setStatus('⚠️ Please enter OpenAI API key', 'red');
        return;
      }
      
      chrome.storage.local.set({ openai_key: key }, () => {
        setStatus('✅ OpenAI key saved!', 'green');
        setTimeout(() => setStatus(''), 1500);
      });
    });
  })();