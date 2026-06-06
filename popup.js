document.addEventListener('DOMContentLoaded', () => {
  // Existing popup initialization lives here.
});


// DevContext GitHub token safety guard
(function installDevContextGitHubTokenGuard() {
  const WARNING_ID = "devcontext-github-token-warning";
  const TOKEN_KEYS = ["githubToken", "github_token", "GITHUB_TOKEN", "token"];
  const WARNING_TEXT = "GitHub token is not configured. Add it in settings before using GitHub features.";

  function readStoredToken() {
    return new Promise((resolve) => {
      if (!globalThis.chrome?.storage?.local) {
        resolve("");
        return;
      }
      chrome.storage.local.get(TOKEN_KEYS, (values) => {
        const token = TOKEN_KEYS.map((key) => values?.[key]).find((value) => typeof value === "string" && value.trim().length > 0);
        resolve(token || "");
      });
    });
  }

  function showGitHubTokenWarning() {
    let warning = document.getElementById(WARNING_ID);
    if (!warning) {
      warning = document.createElement("div");
      warning.id = WARNING_ID;
      warning.className = "devcontext-token-warning";
      warning.setAttribute("role", "alert");
      document.body.prepend(warning);
    }
    warning.textContent = WARNING_TEXT;
  }

  async function hasGitHubToken() {
    const token = await readStoredToken();
    return Boolean(token);
  }

  document.addEventListener(
    "click",
    async (event) => {
      const target = event.target instanceof Element ? event.target.closest("button, a, [data-github-action]") : null;
      if (!target) return;
      const actionText = [target.textContent || "", target.getAttribute("id") || "", target.getAttribute("class") || "", target.getAttribute("data-github-action") || ""].join(" ");
      if (!/github|repository|repo|pull request|issue/i.test(actionText)) return;
      if (await hasGitHubToken()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      showGitHubTokenWarning();
    },
    true,
  );

  window.devcontextGitHubTokenGuard = { hasGitHubToken, showGitHubTokenWarning };
})();
