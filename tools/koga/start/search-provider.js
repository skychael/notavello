(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KogaSearchProvider = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const STORAGE_KEY = "kogaStartSearchProvider";
  const DEFAULT_PROVIDER = "google";
  const providers = Object.freeze({
    google: { url: "https://www.google.com/search", queryParameter: "q" },
    duckduckgo: { url: "https://duckduckgo.com/", queryParameter: "q" },
    bing: { url: "https://www.bing.com/search", queryParameter: "q" },
    yahoo: { url: "https://search.yahoo.com/search", queryParameter: "p" }
  });

  function validProvider(value) {
    return Object.prototype.hasOwnProperty.call(providers, value);
  }

  function savedProvider(storage) {
    try {
      const value = storage?.getItem(STORAGE_KEY);
      return validProvider(value) ? value : DEFAULT_PROVIDER;
    } catch (_error) {
      return DEFAULT_PROVIDER;
    }
  }

  function saveProvider(storage, provider) {
    const value = validProvider(provider) ? provider : DEFAULT_PROVIDER;
    try {
      storage?.setItem(STORAGE_KEY, value);
    } catch (_error) {
      // The selected provider still applies for the current visit.
    }
    return value;
  }

  function searchUrl(provider, query) {
    const selected = providers[validProvider(provider) ? provider : DEFAULT_PROVIDER];
    const url = new URL(selected.url);
    url.searchParams.set(selected.queryParameter, String(query));
    return url.href;
  }

  return {
    DEFAULT_PROVIDER,
    STORAGE_KEY,
    savedProvider,
    saveProvider,
    searchUrl,
    validProvider
  };
}));
