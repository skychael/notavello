(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KogaHistoryData = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const CATEGORIES = new Set([
    "World history",
    "Science and technology",
    "Culture and notable people",
    "Disasters and exploration",
    "Politics and society",
    "Sports"
  ]);

  function safeWikipediaUrl(candidate) {
    if (typeof candidate !== "string") return "";
    try {
      const url = new URL(candidate);
      const isWikipedia = url.hostname === "wikipedia.org" || url.hostname.endsWith(".wikipedia.org");
      return url.protocol === "https:" && isWikipedia ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function validateTodayData(data, dateKey) {
    const generatedAt = new Date(data?.generated_at);
    if (
      data?.schema_version !== "1.0" ||
      data.date_key !== dateKey ||
      !["ai", "deterministic_fallback"].includes(data.selection_method) ||
      typeof data.generated_at !== "string" ||
      Number.isNaN(generatedAt.getTime()) ||
      generatedAt.toISOString() !== data.generated_at ||
      !Array.isArray(data.items) ||
      data.items.length !== 3
    ) {
      return null;
    }
    const seenIds = new Set();
    const seenUrls = new Set();
    const items = [];
    for (const item of data.items) {
      const url = safeWikipediaUrl(item?.url);
      if (
        typeof item?.candidate_id !== "string" || !item.candidate_id ||
        seenIds.has(item.candidate_id) || seenUrls.has(url) ||
        !["event", "birth"].includes(item?.type) ||
        !Number.isInteger(item?.year) ||
        typeof item?.text !== "string" || !item.text.trim() || item.text.length > 2000 ||
        typeof item?.article_title !== "string" || !item.article_title.trim() || item.article_title.length > 200 ||
        !CATEGORIES.has(item?.category) || !url
      ) return null;
      seenIds.add(item.candidate_id);
      seenUrls.add(url);
      items.push({ year: item.year, text: item.text.trim(), url });
    }
    return items;
  }

  return { CATEGORIES, safeWikipediaUrl, validateTodayData };
}));
