(function () {
  "use strict";

  const storageKey = "koga-start-appearance";
  const root = document.documentElement;
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const buttons = document.querySelectorAll("[data-theme]");
  const validThemes = new Set(["light", "dark", "system"]);

  function savedTheme() {
    try {
      const value = localStorage.getItem(storageKey);
      return validThemes.has(value) ? value : "system";
    } catch (_error) {
      return "system";
    }
  }

  function updateThemeColor(theme) {
    if (!themeColor) return;

    const systemIsDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = theme === "dark" || (theme === "system" && systemIsDark);
    themeColor.setAttribute("content", isDark ? "#151515" : "#f5f5f2");
  }

  function applyTheme(theme, persist) {
    if (theme === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", theme);
    }

    buttons.forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.theme === theme));
    });

    updateThemeColor(theme);

    if (persist) {
      try {
        localStorage.setItem(storageKey, theme);
      } catch (_error) {
        // The selected appearance still applies for this page view.
      }
    }
  }

  const initialTheme = savedTheme();
  applyTheme(initialTheme, false);

  buttons.forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.dataset.theme, true));
  });

  const systemPreference = window.matchMedia("(prefers-color-scheme: dark)");
  systemPreference.addEventListener("change", () => {
    if (savedTheme() === "system") updateThemeColor("system");
  });
}());
