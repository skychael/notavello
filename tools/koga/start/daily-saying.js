(function () {
  "use strict";
  const figure = document.querySelector("[data-daily-saying]");
  if (!figure) return;
  const text = figure.querySelector("[data-saying-text]");
  const credit = figure.querySelector("[data-saying-credit]");
  const CACHE_KEY = "koga-daily-sayings-v1";
  const fallback = [{ text: "Well done is better than well said.", author: "Benjamin Franklin", work: "Poor Richard’s Almanac", source: "https://www.gutenberg.org/files/36151/36151-h/36151-h.htm" }];
  function validQuotes(value) {
    return Array.isArray(value) ? value.filter((q) => {
      if (!q || typeof q.text !== "string" || !q.text.trim() || typeof q.author !== "string" || !q.author.trim() || typeof q.work !== "string") return false;
      try { return new URL(q.source).protocol === "https:"; } catch (_) { return false; }
    }) : [];
  }
  let quotes = fallback;
  try {
    const saved = validQuotes(JSON.parse(localStorage.getItem(CACHE_KEY)));
    if (saved.length) quotes = saved;
  } catch (_) { /* The bundled fallback also works without storage. */ }
  let timer;
  function render() {
    clearTimeout(timer);
    const now = new Date();
    // Use local calendar components, without letting DST shorten or lengthen a day.
    const day = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
    const quote = quotes[((day % quotes.length) + quotes.length) % quotes.length];
    text.textContent = "“" + quote.text + "”";
    credit.textContent = quote.author;
    credit.href = quote.source;
    credit.title = quote.work;
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    timer = setTimeout(render, Math.max(1000, midnight.getTime() - now.getTime() + 100));
  }
  render();
  document.addEventListener("visibilitychange", () => { if (!document.hidden) render(); });
  window.addEventListener("pageshow", render);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  fetch("/tools/koga/start/quotes.json", { credentials: "same-origin", signal: controller.signal })
    .then((response) => { if (!response.ok) throw new Error("Sayings unavailable"); return response.json(); })
    .then((data) => {
      const loaded = validQuotes(data);
      if (!loaded.length) return;
      quotes = loaded;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify(loaded)); } catch (_) { /* Storage is optional. */ }
      render();
    })
    .catch(() => { /* Keep the saved collection or fallback visible. */ })
    .finally(() => clearTimeout(timeout));
})();
