(function () {
  "use strict";

  const root = document.documentElement;
  const THEME_KEY = "koga-start-appearance";
  const WEATHER_KEY = "kogaStartWeatherLocation";
  const WEATHER_CENTER_KEY = "weatherCenterLastLocation";
  const WEATHER_CACHE_KEY = "kogaStartWeatherCache";
  const HEADLINE_CACHE_KEY = "kogaStartRelayCache";
  const PULSE_CACHE_KEY = "kogaStartPulseCache";
  const HISTORY_CACHE_KEY = "kogaStartOnThisDayCache";
  const TODAY_HISTORY_DATA_URL = "/tools/koga/start/today-data.json";
  const WORKER = "https://weather-worker.mikekoga.workers.dev";
  // Wikimedia is gradually deprecating this feed; keep its URL centralized for replacement.
  const ON_THIS_DAY_ENDPOINT = "https://en.wikipedia.org/api/rest_v1/feed/onthisday/events";
  const validThemes = new Set(["light", "dark", "system"]);
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const themeButtons = document.querySelectorAll("[data-theme]");

  function storageGet(key) {
    try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (_error) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_error) { /* Private browsing may disallow storage. */ }
  }

  function savedTheme() {
    try {
      const value = localStorage.getItem(THEME_KEY);
      return validThemes.has(value) ? value : "system";
    } catch (_error) { return "system"; }
  }

  function applyTheme(theme, persist) {
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    themeButtons.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.theme === theme)));
    const isDark = theme === "dark" || (theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    if (themeColor) themeColor.content = isDark ? "#151419" : "#f4f3f8";
    if (persist) {
      try { localStorage.setItem(THEME_KEY, theme); } catch (_error) { /* Theme still applies for this visit. */ }
    }
  }

  applyTheme(savedTheme(), false);
  themeButtons.forEach((button) => button.addEventListener("click", () => applyTheme(button.dataset.theme, true)));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (savedTheme() === "system") applyTheme("system", false);
  });

  const searchForm = document.querySelector("[data-web-search]");
  const searchInput = document.querySelector("#web-search");
  const searchProviderSelect = document.querySelector("[data-search-provider]");
  const searchProvider = window.KogaSearchProvider;
  if (searchForm && searchInput && searchProviderSelect && searchProvider) {
    searchProviderSelect.value = searchProvider.savedProvider(localStorage);
    searchProviderSelect.addEventListener("change", () => {
      searchProviderSelect.value = searchProvider.saveProvider(localStorage, searchProviderSelect.value);
    });
    searchForm.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!searchForm.reportValidity()) return;
      window.location.assign(searchProvider.searchUrl(searchProviderSelect.value, searchInput.value));
    });
  }

  const now = new Date();
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now);
  document.querySelector("[data-today]").textContent = dateText;
  document.querySelector("[data-history-date]").textContent = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(now);
  const historyLink = document.querySelector("[data-history-link]");
  historyLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(now)).replace("%20", "_")}`;

  function fetchJson(url, timeout = 8000, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { credentials: "same-origin", ...options, signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Request returned ${response.status}`);
        return response.json();
      })
      .finally(() => clearTimeout(timer));
  }

  function formatLocalTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  }

  function formatWeatherTimestamp(unixSeconds, offsetSeconds) {
    if (!Number.isFinite(unixSeconds)) return "";
    return new Intl.DateTimeFormat(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC"
    }).format(new Date((unixSeconds + (offsetSeconds || 0)) * 1000));
  }

  const pulseIds = new Set(["sp-500", "nasdaq-composite", "dow-jones-industrial-average", "vix", "brent-crude-oil", "gold", "bitcoin"]);
  const validDirections = new Set(["up", "down", "neutral"]);
  function renderPulse(data, stale) {
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach((item) => {
      if (!pulseIds.has(item.id) || typeof item.formatted_value !== "string") return;
      const cell = document.querySelector(`[data-pulse-id="${item.id}"]`);
      const value = cell?.querySelector("strong");
      if (!cell || !value) return;
      value.textContent = item.formatted_value;
      cell.querySelector(".ticker-change")?.remove();
      const direction = validDirections.has(item.direction) ? item.direction : "neutral";
      const percent = item.change_percent;
      const basisLabels = {
        previous_observation: "since previous observation",
        previous_close: "since previous close",
        rolling_24_hour_open: "over 24 hours"
      };
      const basisLabel = basisLabels[item.comparison_basis] || "";
      const directionMatchesPercent = (direction === "up" && percent > 0) || (direction === "down" && percent < 0);
      const hasChange = typeof percent === "number" && Number.isFinite(percent) && directionMatchesPercent && Boolean(basisLabel);
      const compactBasis = item.comparison_basis === "rolling_24_hour_open" ? " 24h" : "";
      const change = document.createElement("span");
      change.className = "ticker-change";
      change.dataset.direction = hasChange ? direction : "neutral";
      change.textContent = hasChange
        ? `${direction === "up" ? "↑" : "↓"} ${Math.abs(percent).toFixed(2)}%${compactBasis}`
        : "No change data";
      change.setAttribute("aria-label", hasChange
        ? `${direction === "up" ? "Up" : "Down"} ${Math.abs(percent).toFixed(2)} percent${basisLabel ? ` ${basisLabel}` : ""}`
        : "Change unavailable");
      cell.append(change);
    });
    const checked = formatLocalTimestamp(data.checked_at);
    document.querySelector("[data-pulse-checked]").textContent = checked
      ? `${stale ? "Saved values" : "Checked"} ${checked}`
      : "Latest available values";
  }

  const cachedPulse = storageGet(PULSE_CACHE_KEY);
  if (cachedPulse?.data) renderPulse(cachedPulse.data, true);
  fetchJson("/pages/relay/pulse-data.json").then((data) => {
    renderPulse(data, false);
    storageSet(PULSE_CACHE_KEY, { savedAt: Date.now(), data });
  }).catch(() => {
    if (!cachedPulse?.data) document.querySelector("[data-pulse-checked]").textContent = "Values unavailable";
  });

  const historyList = document.querySelector("[data-history-list]");
  const historyFallback = document.querySelector("[data-history-fallback]");
  const historyAttribution = document.querySelector("[data-history-attribution]");
  const historyDateKey = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}`;
  const staticHistoryDateKey = historyDateKey.replace("/", "-");

  function wikipediaPageUrl(page) {
    const candidate = page?.content_urls?.desktop?.page || page?.content_urls?.mobile?.page;
    if (typeof candidate !== "string") return "";
    try {
      const url = new URL(candidate);
      const isWikipedia = url.hostname === "wikipedia.org" || url.hostname.endsWith(".wikipedia.org");
      return url.protocol === "https:" && isWikipedia ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function safeHistoryUrl(candidate) {
    if (typeof candidate !== "string") return "";
    try {
      const url = new URL(candidate);
      const isWikipedia = url.hostname === "wikipedia.org" || url.hostname.endsWith(".wikipedia.org");
      return url.protocol === "https:" && isWikipedia ? url.href : "";
    } catch (_error) {
      return "";
    }
  }

  function selectHistoryEvents(data) {
    const seen = new Set();
    const valid = [];
    for (const event of Array.isArray(data?.events) ? data.events : []) {
      const pageUrl = (Array.isArray(event.pages) ? event.pages : []).map(wikipediaPageUrl).find(Boolean);
      if (!Number.isInteger(event.year) || typeof event.text !== "string" || !event.text.trim() || !pageUrl || seen.has(pageUrl)) continue;
      seen.add(pageUrl);
      valid.push({ year: event.year, text: event.text.trim(), url: pageUrl });
    }
    if (valid.length <= 3) return valid;
    const selected = [];
    const start = ((now.getMonth() + 1) * 31 + now.getDate()) % valid.length;
    const step = Math.max(1, Math.floor(valid.length / 3));
    for (let offset = 0; selected.length < 3 && offset < valid.length; offset += step) {
      const event = valid[(start + offset) % valid.length];
      if (!selected.includes(event)) selected.push(event);
    }
    return selected;
  }

  function safeCachedHistoryEvents(items) {
    return (Array.isArray(items) ? items : []).flatMap((event) => {
      const url = safeHistoryUrl(event?.url);
      return Number.isInteger(event?.year) && typeof event?.text === "string" && event.text.trim() && url
        ? [{ year: event.year, text: event.text.trim(), url }]
        : [];
    }).slice(0, 3);
  }

  function renderHistory(events) {
    if (events.length < 3) return false;
    const fragment = document.createDocumentFragment();
    events.slice(0, 3).forEach((event) => {
      const row = document.createElement("li");
      const year = document.createElement("strong");
      const link = document.createElement("a");
      year.textContent = String(event.year);
      link.href = event.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = event.text;
      row.append(year, link);
      fragment.append(row);
    });
    historyList.replaceChildren(fragment);
    historyList.hidden = false;
    historyFallback.hidden = true;
    historyAttribution.hidden = false;
    return true;
  }

  function loadLiveHistoryFallback() {
    const cachedHistory = storageGet(HISTORY_CACHE_KEY);
    const cachedHistoryEvents = cachedHistory?.date === historyDateKey
      ? safeCachedHistoryEvents(cachedHistory.events)
      : [];
    return fetchJson(`${ON_THIS_DAY_ENDPOINT}/${historyDateKey}`, 7000).then((data) => {
      const events = selectHistoryEvents(data);
      if (!renderHistory(events)) throw new Error("No usable historical events");
      storageSet(HISTORY_CACHE_KEY, { date: historyDateKey, savedAt: Date.now(), events });
    }).catch(() => {
      renderHistory(cachedHistoryEvents);
    });
  }

  fetchJson(`${TODAY_HISTORY_DATA_URL}?date=${staticHistoryDateKey}`, 4000, { cache: "no-store" }).then((data) => {
    const events = window.KogaHistoryData?.validateTodayData(data, staticHistoryDateKey);
    if (!events || !renderHistory(events)) throw new Error("Daily history data is unavailable");
  }).catch(loadLiveHistoryFallback);

  const headlineList = document.querySelector("[data-headline-list]");
  const headlineControls = document.querySelector("[data-headline-controls]");
  const headlinePage = document.querySelector("[data-headline-page]");
  const headlineNote = document.querySelector("[data-headline-note]");
  let headlines = [];
  let headlineIndex = 0;
  let rotationTimer;
  let headlinesAreStale = false;
  let headlineStaleText = "";

  function safeHeadlineItems(data) {
    return Array.isArray(data?.items) ? data.items.filter((item) =>
      typeof item.title === "string" && typeof item.publisher === "string" && /^https?:\/\//.test(item.url)
    ) : [];
  }

  function renderHeadlines() {
    if (!headlines.length) return;
    const groups = Math.ceil(headlines.length / 4);
    headlineIndex = (headlineIndex + groups) % groups;
    const fragment = document.createDocumentFragment();
    headlines.slice(headlineIndex * 4, headlineIndex * 4 + 4).forEach((item) => {
      const row = document.createElement("li");
      const link = document.createElement("a");
      const publisher = document.createElement("small");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = item.title;
      publisher.textContent = item.publisher;
      row.append(link, publisher);
      fragment.append(row);
    });
    headlineList.classList.add("is-changing");
    requestAnimationFrame(() => {
      headlineList.replaceChildren(fragment);
      requestAnimationFrame(() => headlineList.classList.remove("is-changing"));
    });
    headlineControls.hidden = groups < 2;
    headlinePage.textContent = `${headlineIndex + 1} / ${groups}`;
    headlineNote.hidden = !headlinesAreStale;
    headlineNote.textContent = headlineStaleText;
  }

  function scheduleRotation() {
    clearInterval(rotationTimer);
    if (document.hidden || headlines.length <= 4) return;
    rotationTimer = setInterval(() => { headlineIndex += 1; renderHeadlines(); }, 28000);
  }

  document.querySelector("[data-headline-prev]").addEventListener("click", () => { headlineIndex -= 1; renderHeadlines(); scheduleRotation(); });
  document.querySelector("[data-headline-next]").addEventListener("click", () => { headlineIndex += 1; renderHeadlines(); scheduleRotation(); });
  document.addEventListener("visibilitychange", scheduleRotation);

  const cachedHeadlines = storageGet(HEADLINE_CACHE_KEY);
  if (cachedHeadlines?.data) {
    headlines = safeHeadlineItems(cachedHeadlines.data);
    headlinesAreStale = true;
    const savedAt = formatLocalTimestamp(cachedHeadlines.savedAt);
    headlineStaleText = savedAt
      ? `Showing headlines saved ${savedAt} while the latest feed loads.`
      : "Showing saved headlines while the latest feed loads.";
    renderHeadlines();
  }
  fetchJson("/pages/relay/article-data.json").then((data) => {
    const items = safeHeadlineItems(data);
    if (!items.length) return;
    headlines = items;
    headlineIndex = 0;
    headlinesAreStale = false;
    headlineStaleText = "";
    renderHeadlines();
    scheduleRotation();
    storageSet(HEADLINE_CACHE_KEY, { savedAt: Date.now(), data });
  }).catch(() => {
    if (headlinesAreStale) {
      headlineStaleText = headlineStaleText.replace("while the latest feed loads.", "because the latest feed is unavailable.");
      headlineNote.textContent = headlineStaleText;
    }
    // Cached or static fallback stays visible.
  });

  const weatherSummary = document.querySelector("[data-weather-summary]");
  const weatherForm = document.querySelector("[data-weather-form]");
  const weatherInput = document.querySelector("#weather-location");
  const weatherStatus = document.querySelector("[data-weather-status]");
  const clearWeather = document.querySelector("[data-clear-weather]");
  const useLocation = document.querySelector("[data-use-location]");
  const fullForecastLink = document.querySelector("[data-full-forecast]");
  let weatherRequestId = 0;
  let activeWeatherLocation = null;

  function normalizedWeatherLocation(value) {
    return window.KogaWeatherLocation?.normalizeWeatherLocation(value) || null;
  }

  function locationFromWeatherData(data, base = {}) {
    const current = data?.current || {};
    return normalizedWeatherLocation({
      ...base,
      lat: base.lat ?? current.coord?.lat,
      lon: base.lon ?? current.coord?.lon,
      label: base.label || data?.label || current.name || "",
      city: base.city || current.name || "",
      country: base.country || current.sys?.country || "",
      timezone: base.timezone ?? current.timezone,
      savedAt: base.savedAt
    });
  }

  function syncWeatherCenterLocation() {
    const cached = storageGet(WEATHER_CACHE_KEY);
    const normalized = activeWeatherLocation ||
      normalizedWeatherLocation(storageGet(WEATHER_KEY)) ||
      locationFromWeatherData(cached?.data, cached?.data?.location || {}) ||
      normalizedWeatherLocation(storageGet(WEATHER_CENTER_KEY));
    if (normalized) storageSet(WEATHER_CENTER_KEY, normalized);
  }

  fullForecastLink?.addEventListener("click", syncWeatherCenterLocation);

  function weatherEmoji(code) {
    if (code >= 200 && code < 300) return "⛈️";
    if (code >= 300 && code < 600) return "🌧️";
    if (code >= 600 && code < 700) return "❄️";
    if (code >= 700 && code < 800) return "🌫️";
    if (code === 800) return "☀️";
    if (code === 801) return "🌤️";
    if (code >= 802) return "☁️";
    return "🌡️";
  }

  function dailyRange(forecast) {
    const list = Array.isArray(forecast?.list) ? forecast.list.slice(0, 8) : [];
    const highs = list.map((item) => item.main?.temp_max).filter(Number.isFinite);
    const lows = list.map((item) => item.main?.temp_min).filter(Number.isFinite);
    return highs.length && lows.length ? `High ${Math.round(Math.max(...highs))}° · Low ${Math.round(Math.min(...lows))}°` : "";
  }

  function renderWeather(data, stale) {
    const current = data.current || {};
    const condition = current.weather?.[0] || {};
    const label = current.name || data.label || "Saved location";
    const temp = Number.isFinite(current.main?.temp) ? `${Math.round(current.main.temp)}°` : "—";
    const details = [condition.description, dailyRange(data.forecast)].filter(Boolean).join(" · ");
    weatherSummary.replaceChildren();
    const icon = document.createElement("span");
    icon.className = "weather-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = weatherEmoji(condition.id);
    const copy = document.createElement("div");
    const heading = document.createElement("strong");
    const description = document.createElement("p");
    heading.textContent = `${temp} in ${label}`;
    description.textContent = details || "Current conditions";
    copy.append(heading, description);
    weatherSummary.append(icon, copy);
    clearWeather.hidden = false;
    const updated = formatWeatherTimestamp(current.dt, current.timezone);
    weatherStatus.textContent = updated ? `${stale ? "Saved weather" : "Updated"} ${updated} local time` : "";
    const renderedLocation = locationFromWeatherData(data, data.location || {});
    if (renderedLocation) activeWeatherLocation = renderedLocation;
  }

  async function loadWeather(lat, lon, label, saveLocation, requestId, locationDetails = {}) {
    if (requestId !== weatherRequestId) return;
    weatherStatus.textContent = "Loading weather…";
    const [currentResult, forecastResult] = await Promise.allSettled([
      fetchJson(`${WORKER}/weather?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`),
      fetchJson(`${WORKER}/forecast?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`)
    ]);
    if (requestId !== weatherRequestId) return;
    if (currentResult.status !== "fulfilled") throw currentResult.reason;
    const current = currentResult.value;
    const forecast = forecastResult.status === "fulfilled" ? forecastResult.value : {};
    if (Number(current.cod) && Number(current.cod) !== 200) throw new Error(current.message || "Weather unavailable.");
    if (!current || typeof current !== "object" || !current.main || !Number.isFinite(current.dt)) {
      throw new Error("Weather data was incomplete.");
    }
    const location = locationFromWeatherData({ current, label }, { ...locationDetails, lat, lon, label });
    const data = { current, forecast, label, location };
    renderWeather(data, false);
    storageSet(WEATHER_CACHE_KEY, { savedAt: Date.now(), data });
    // Coordinates and a human-readable label are stored only for weather reuse, never analytics.
    if (saveLocation && location) storageSet(WEATHER_KEY, location);
  }

  async function findCoordinates(query) {
    if (/^\d{5}(-\d{4})?$/.test(query)) {
      const zip = await fetchJson(`${WORKER}/zip?zip=${encodeURIComponent(query)}`);
      if (!zip.coord) throw new Error("That ZIP code was not found.");
      return {
        lat: zip.coord.lat,
        lon: zip.coord.lon,
        zip: query,
        postalCode: query,
        city: zip.name,
        country: zip.country
      };
    }
    const geo = await fetchJson(`${WORKER}/geocode?text=${encodeURIComponent(query)}`);
    const first = (geo.results || [])[0];
    if (first) return {
      lat: first.lat,
      lon: first.lon,
      city: first.city || first.county || first.name,
      state: first.state_code || first.state,
      region: first.state || first.region,
      country: first.country_code || first.country,
      postalCode: first.postcode || first.postalCode
    };
    const fallback = await fetchJson(`${WORKER}/owmgeo?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(fallback) || !fallback[0]) throw new Error("That location was not found.");
    return {
      lat: fallback[0].lat,
      lon: fallback[0].lon,
      city: fallback[0].name,
      state: fallback[0].state,
      country: fallback[0].country
    };
  }

  weatherForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = weatherInput.value.trim();
    if (!query) { weatherStatus.textContent = "Enter a city or ZIP code."; return; }
    const requestId = ++weatherRequestId;
    weatherStatus.textContent = "Finding location…";
    try {
      const coords = await findCoordinates(query);
      await loadWeather(coords.lat, coords.lon, query, true, requestId, coords);
    } catch (error) {
      if (requestId === weatherRequestId) {
        weatherStatus.textContent = error.name === "AbortError" ? "Weather request timed out." : (error.message || "Weather is unavailable.");
      }
    }
  });

  useLocation.addEventListener("click", () => {
    if (!navigator.geolocation) { weatherStatus.textContent = "Location is unavailable in this browser."; return; }
    const requestId = ++weatherRequestId;
    weatherStatus.textContent = "Waiting for location permission…";
    navigator.geolocation.getCurrentPosition(
      (position) => loadWeather(position.coords.latitude, position.coords.longitude, "Current location", true, requestId)
        .catch(() => {
          if (requestId === weatherRequestId) weatherStatus.textContent = "Weather is unavailable right now.";
        }),
      () => {
        if (requestId === weatherRequestId) weatherStatus.textContent = "Location wasn’t shared. Enter a city or ZIP instead.";
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  });

  clearWeather.addEventListener("click", () => {
    weatherRequestId += 1;
    try {
      localStorage.removeItem(WEATHER_KEY);
      localStorage.removeItem(WEATHER_CENTER_KEY);
      localStorage.removeItem(WEATHER_CACHE_KEY);
    } catch (_error) { /* The visible state can still be cleared. */ }
    weatherSummary.innerHTML = '<span class="weather-icon" aria-hidden="true">🌤️</span><div><strong>Set your location</strong><p>Get a quick look at today’s weather.</p></div>';
    weatherInput.value = "";
    activeWeatherLocation = null;
    weatherStatus.textContent = "Saved start-page location cleared.";
    clearWeather.hidden = true;
  });

  const cachedWeather = storageGet(WEATHER_CACHE_KEY);
  if (cachedWeather?.data) renderWeather(cachedWeather.data, true);
  // Prefer Koga Start coordinates, then reuse Weather Center coordinates without copying them.
  const savedLocation = storageGet(WEATHER_KEY) || storageGet(WEATHER_CENTER_KEY);
  const normalizedSavedLocation = normalizedWeatherLocation(savedLocation);
  if (normalizedSavedLocation) {
    if (!activeWeatherLocation) activeWeatherLocation = normalizedSavedLocation;
    if (normalizedSavedLocation.label) weatherInput.value = normalizedSavedLocation.label;
    const requestId = ++weatherRequestId;
    loadWeather(
      normalizedSavedLocation.lat,
      normalizedSavedLocation.lon,
      normalizedSavedLocation.label || "Saved location",
      false,
      requestId,
      normalizedSavedLocation
    )
      .catch(() => {
        if (requestId === weatherRequestId && !cachedWeather?.data) {
          weatherStatus.textContent = "Weather is unavailable. Your saved location is still here.";
        }
      });
  }
}());
