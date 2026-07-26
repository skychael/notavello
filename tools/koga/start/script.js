(function () {
  "use strict";

  const root = document.documentElement;
  const THEME_KEY = "koga-start-appearance";
  const WEATHER_KEY = "kogaStartWeatherLocation";
  const WEATHER_CENTER_KEY = "weatherCenterLastLocation";
  const WEATHER_CACHE_KEY = "kogaStartWeatherCache";
  const HEADLINE_CACHE_KEY = "kogaStartRelayCache";
  const PULSE_CACHE_KEY = "kogaStartPulseCache";
  const WORKER = "https://weather-worker.mikekoga.workers.dev";
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

  const now = new Date();
  const dateText = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(now);
  document.querySelector("[data-today]").textContent = dateText;
  document.querySelector("[data-history-date]").textContent = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(now);
  const historyLink = document.querySelector("[data-history-link]");
  historyLink.href = `https://en.wikipedia.org/wiki/${encodeURIComponent(new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(now)).replace("%20", "_")}`;

  function fetchJson(url, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { credentials: "same-origin", signal: controller.signal })
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
  function renderPulse(data, stale) {
    const items = Array.isArray(data?.items) ? data.items : [];
    items.forEach((item) => {
      if (!pulseIds.has(item.id) || typeof item.formatted_value !== "string") return;
      const value = document.querySelector(`[data-pulse-id="${item.id}"] strong`);
      if (value) value.textContent = item.formatted_value;
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
  let weatherRequestId = 0;

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
  }

  async function loadWeather(lat, lon, label, saveLocation, requestId) {
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
    const data = { current, forecast, label };
    renderWeather(data, false);
    storageSet(WEATHER_CACHE_KEY, { savedAt: Date.now(), data });
    // Coordinates and a human-readable label are stored only for weather reuse, never analytics.
    if (saveLocation) storageSet(WEATHER_KEY, { lat: Number(lat), lon: Number(lon), label, savedAt: Date.now() });
  }

  async function findCoordinates(query) {
    if (/^\d{5}(-\d{4})?$/.test(query)) {
      const zip = await fetchJson(`${WORKER}/zip?zip=${encodeURIComponent(query)}`);
      if (!zip.coord) throw new Error("That ZIP code was not found.");
      return zip.coord;
    }
    const geo = await fetchJson(`${WORKER}/geocode?text=${encodeURIComponent(query)}`);
    const first = (geo.results || [])[0];
    if (first) return { lat: first.lat, lon: first.lon };
    const fallback = await fetchJson(`${WORKER}/owmgeo?q=${encodeURIComponent(query)}`);
    if (!Array.isArray(fallback) || !fallback[0]) throw new Error("That location was not found.");
    return { lat: fallback[0].lat, lon: fallback[0].lon };
  }

  weatherForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = weatherInput.value.trim();
    if (!query) { weatherStatus.textContent = "Enter a city or ZIP code."; return; }
    const requestId = ++weatherRequestId;
    weatherStatus.textContent = "Finding location…";
    try {
      const coords = await findCoordinates(query);
      await loadWeather(coords.lat, coords.lon, query, true, requestId);
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
      localStorage.removeItem(WEATHER_CACHE_KEY);
    } catch (_error) { /* The visible state can still be cleared. */ }
    weatherSummary.innerHTML = '<span class="weather-icon" aria-hidden="true">🌤️</span><div><strong>Set your location</strong><p>Get a quick look at today’s weather.</p></div>';
    weatherInput.value = "";
    weatherStatus.textContent = "Saved start-page location cleared.";
    clearWeather.hidden = true;
  });

  const cachedWeather = storageGet(WEATHER_CACHE_KEY);
  if (cachedWeather?.data) renderWeather(cachedWeather.data, true);
  // Prefer Koga Start coordinates, then reuse Weather Center coordinates without copying them.
  const savedLocation = storageGet(WEATHER_KEY) || storageGet(WEATHER_CENTER_KEY);
  if (savedLocation && Number.isFinite(savedLocation.lat) && Number.isFinite(savedLocation.lon)) {
    if (savedLocation.label) weatherInput.value = savedLocation.label;
    const requestId = ++weatherRequestId;
    loadWeather(savedLocation.lat, savedLocation.lon, savedLocation.label || "Saved location", false, requestId)
      .catch(() => {
        if (requestId === weatherRequestId && !cachedWeather?.data) {
          weatherStatus.textContent = "Weather is unavailable. Your saved location is still here.";
        }
      });
  }
}());
