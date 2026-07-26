(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root && root.document) {
    root.addEventListener("DOMContentLoaded", function () {
      api.init(root);
    });
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const THEME_KEY = "koga-start-appearance";
  const WEATHER_LOCATION_KEY = "kogaStartWeatherLocation";
  const WEATHER_CENTER_LOCATION_KEY = "weatherCenterLastLocation";
  const WEATHER_CACHE_KEY = "kogaStartWeatherCache";
  const RELAY_CACHE_KEY = "kogaStartRelayCache";
  const PULSE_CACHE_KEY = "kogaStartPulseCache";
  const HISTORY_CACHE_KEY = "kogaStartOnThisDayCache";
  const WEATHER_WORKER = "https://notavello-weather.notavello.workers.dev";
  const MAX_CACHE_AGE = 24 * 60 * 60 * 1000;
  const HISTORY_CATEGORIES = new Set([
    "World history",
    "Science and technology",
    "Culture and notable people",
    "Disasters and exploration",
    "Politics and society",
    "Sports"
  ]);

  const MARKET_NAMES = {
    "sp-500": "S&P 500",
    "nasdaq-composite": "Nasdaq",
    "dow-jones-industrial-average": "Dow",
    vix: "VIX",
    "brent-crude-oil": "Brent",
    gold: "Gold",
    bitcoin: "Bitcoin"
  };

  function safeParse(value) {
    if (typeof value !== "string" || !value) return null;
    try {
      return JSON.parse(value);
    } catch (_error) {
      return null;
    }
  }

  function storageGet(storage, key) {
    try {
      return safeParse(storage.getItem(key));
    } catch (_error) {
      return null;
    }
  }

  function storageSet(storage, key, value) {
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_error) {
      return false;
    }
  }

  function savedTheme(storage) {
    let value = null;
    try {
      value = storage.getItem(THEME_KEY);
    } catch (_error) {
      return "system";
    }
    return ["light", "dark", "system"].includes(value) ? value : "system";
  }

  function themeColor(theme, systemDark) {
    return theme === "dark" || (theme === "system" && systemDark)
      ? "#121318"
      : "#f3f4f7";
  }

  function safeHttpUrl(value, requiredHost) {
    try {
      const url = new URL(value);
      if (!["http:", "https:"].includes(url.protocol)) return null;
      if (requiredHost && url.hostname !== requiredHost) return null;
      return url.href;
    } catch (_error) {
      return null;
    }
  }

  function validNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function validCoordinates(value) {
    return Boolean(
      value &&
      validNumber(value.lat) &&
      validNumber(value.lon) &&
      value.lat >= -90 &&
      value.lat <= 90 &&
      value.lon >= -180 &&
      value.lon <= 180
    );
  }

  function safeHeadlineItems(data) {
    if (!data || !Array.isArray(data.items)) return [];
    return data.items
      .map(function (item) {
        const url = safeHttpUrl(item && item.url);
        const title = item && typeof item.title === "string" ? item.title.trim() : "";
        if (!url || !title) return null;
        return {
          title: title.slice(0, 240),
          url,
          publisher:
            typeof item.publisher === "string" ? item.publisher.trim().slice(0, 80) : "",
          publishedAt:
            typeof item.published_at === "string" &&
            Number.isFinite(Date.parse(item.published_at))
              ? item.published_at
              : null
        };
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  function formatAge(timestamp, now) {
    if (!timestamp || !Number.isFinite(Date.parse(timestamp))) return "";
    const minutes = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 60000));
    if (minutes < 60) return minutes < 2 ? "just now" : minutes + "m ago";
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    return Math.floor(hours / 24) + "d ago";
  }

  function pulseMovement(item) {
    if (!item || !validNumber(item.change_percent)) return null;
    const change = item.change_percent;
    const expected = change > 0 ? "up" : change < 0 ? "down" : "neutral";
    if (item.direction && item.direction !== expected) return null;
    return {
      change,
      direction: expected,
      text: (change > 0 ? "+" : "") + change.toFixed(2) + "%"
    };
  }

  function safePulseItems(data) {
    if (!data || !Array.isArray(data.items)) return [];
    return data.items
      .map(function (item) {
        const name = item && MARKET_NAMES[item.id];
        if (!name) return null;
        const value =
          typeof item.formatted_value === "string" ? item.formatted_value.trim() : "";
        if (!value) return null;
        return {
          name,
          value: value.slice(0, 40),
          movement: pulseMovement(item),
          basis:
            typeof item.comparison_basis === "string"
              ? item.comparison_basis.trim().slice(0, 80)
              : ""
        };
      })
      .filter(Boolean);
  }

  function dateKey(date) {
    return (
      String(date.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(date.getDate()).padStart(2, "0")
    );
  }

  function wikipediaDateUrl(date) {
    const month = date.toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
    return "https://en.wikipedia.org/wiki/" + month + "_" + date.getUTCDate();
  }

  function safeHistoryItems(items) {
    if (!Array.isArray(items)) return [];
    return items
      .map(function (item) {
        const url = safeHttpUrl(item && item.url, "en.wikipedia.org");
        const headline =
          item && typeof item.headline === "string" ? item.headline.trim() : "";
        if (!url || !headline || !Number.isInteger(item.year)) return null;
        return {
          year: item.year,
          headline: headline.slice(0, 180),
          url,
          category:
            typeof item.category === "string" ? item.category.trim().slice(0, 80) : ""
        };
      })
      .filter(Boolean)
      .slice(0, 3);
  }

  function validateGeneratedHistory(data, date, validator) {
    const result =
      typeof validator === "function"
        ? validator(data, dateKey(date))
        : validateGeneratedHistoryLocally(data, dateKey(date));
    if (!Array.isArray(result)) return [];
    return safeHistoryItems(
      result.map(function (item, index) {
        return {
          year: item.year,
          headline: item.text,
          url: item.url,
          category:
            data && data.items && data.items[index] ? data.items[index].category : ""
        };
      })
    );
  }

  function validateGeneratedHistoryLocally(data, expectedDateKey) {
    if (
      !data ||
      data.schema_version !== "1.0" ||
      data.date_key !== expectedDateKey ||
      !["ai", "deterministic_fallback"].includes(data.selection_method) ||
      typeof data.generated_at !== "string" ||
      !Number.isFinite(Date.parse(data.generated_at)) ||
      new Date(data.generated_at).toISOString() !== data.generated_at ||
      !Array.isArray(data.items) ||
      data.items.length !== 3
    ) return null;
    const ids = new Set();
    const urls = new Set();
    const items = [];
    for (const item of data.items) {
      const url = safeHttpUrl(item && item.url, "en.wikipedia.org");
      if (
        !item ||
        typeof item.candidate_id !== "string" ||
        !item.candidate_id ||
        ids.has(item.candidate_id) ||
        urls.has(url) ||
        !["event", "birth"].includes(item.type) ||
        !Number.isInteger(item.year) ||
        typeof item.text !== "string" ||
        !item.text.trim() ||
        item.text.length > 2000 ||
        typeof item.article_title !== "string" ||
        !item.article_title.trim() ||
        item.article_title.length > 200 ||
        !HISTORY_CATEGORIES.has(item.category) ||
        !url
      ) return null;
      ids.add(item.candidate_id);
      urls.add(url);
      items.push({ year: item.year, text: item.text.trim(), url });
    }
    return items;
  }

  function weatherEmoji(code, isDay) {
    if (code >= 200 && code < 300) return "⛈️";
    if (code >= 300 && code < 600) return "🌧️";
    if (code >= 600 && code < 700) return "🌨️";
    if (code >= 700 && code < 800) return "🌫️";
    if (code === 800) return isDay === 0 ? "🌙" : "☀️";
    if (code === 801) return "🌤️";
    if (code >= 802) return "☁️";
    return "🌡️";
  }

  function weatherCondition(code) {
    if (code === 0) return "Clear";
    if ([1, 2].includes(code)) return "Partly cloudy";
    if (code === 3) return "Overcast";
    if ([45, 48].includes(code)) return "Foggy";
    if ([51, 53, 55, 56, 57].includes(code)) return "Drizzle";
    if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "Rain";
    if ([71, 73, 75, 77, 85, 86].includes(code)) return "Snow";
    if ([95, 96, 99].includes(code)) return "Thunderstorms";
    return "Current conditions";
  }

  function locationFromWeather(data, fallback) {
    const source = (data && data.location) || fallback || {};
    const location = {
      lat: Number(source.lat != null ? source.lat : source.latitude),
      lon: Number(source.lon != null ? source.lon : source.longitude),
      label:
        source.label ||
        source.display_name ||
        [source.city, source.state || source.region].filter(Boolean).join(", ")
    };
    ["city", "state", "region", "zip", "postalCode", "country", "timezone"].forEach(
      function (field) {
        if (source[field] != null && source[field] !== "") location[field] = source[field];
      }
    );
    return validCoordinates(location) ? location : null;
  }

  function init(win) {
    const doc = win.document;
    const storage = win.localStorage;
    const media = win.matchMedia("(prefers-color-scheme: dark)");
    const themeMeta = doc.querySelector('meta[name="theme-color"]');
    const appearance = doc.querySelector("[data-appearance]");
    const themeButtons = Array.from(doc.querySelectorAll("[data-theme]"));
    let activeWeatherLocation = null;
    let weatherRequest = 0;

    function applyTheme(theme) {
      doc.documentElement.dataset.theme = theme;
      if (themeMeta) themeMeta.content = themeColor(theme, media.matches);
      themeButtons.forEach(function (button) {
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.theme === theme)
        );
      });
    }

    const initialTheme = savedTheme(storage);
    applyTheme(initialTheme);
    themeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        const theme = button.dataset.theme;
        if (!["system", "light", "dark"].includes(theme)) return;
        try {
          storage.setItem(THEME_KEY, theme);
        } catch (_error) {
          // Appearance still applies for this visit.
        }
        applyTheme(theme);
        if (appearance) appearance.open = false;
      });
    });
    media.addEventListener("change", function () {
      if (savedTheme(storage) === "system") applyTheme("system");
    });

    const today = doc.querySelector("[data-today]");
    if (today) {
      today.textContent = new Intl.DateTimeFormat("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric"
      }).format(new Date());
    }

    async function boundedJson(url, timeout) {
      const controller = new AbortController();
      const timer = win.setTimeout(function () {
        controller.abort();
      }, timeout || 8000);
      try {
        const response = await win.fetch(url, {
          signal: controller.signal,
          credentials: "same-origin"
        });
        if (!response.ok) throw new Error("Request failed");
        return await response.json();
      } finally {
        win.clearTimeout(timer);
      }
    }

    function replaceChildren(node) {
      while (node && node.firstChild) node.removeChild(node.firstChild);
    }

    function renderHeadlines(items, stale) {
      const list = doc.querySelector("[data-headline-list]");
      const note = doc.querySelector("[data-headline-note]");
      if (!list || !items.length) return;
      replaceChildren(list);
      items.forEach(function (item) {
        const li = doc.createElement("li");
        const link = doc.createElement("a");
        const title = doc.createElement("span");
        const meta = doc.createElement("span");
        const arrow = doc.createElement("span");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        title.className = "headline-title";
        title.textContent = item.title;
        meta.className = "headline-meta";
        meta.textContent = [item.publisher, formatAge(item.publishedAt, Date.now())]
          .filter(Boolean)
          .join(" · ");
        arrow.className = "row-arrow";
        arrow.setAttribute("aria-hidden", "true");
        arrow.textContent = "›";
        link.append(title, meta, arrow);
        li.appendChild(link);
        list.appendChild(li);
      });
      if (note) {
        note.hidden = false;
        note.textContent = stale ? "Saved headlines · updates when online" : "Latest from Relay";
      }
    }

    async function loadHeadlines() {
      const cached = storageGet(storage, RELAY_CACHE_KEY);
      if (cached && cached.data) renderHeadlines(safeHeadlineItems(cached.data), true);
      try {
        const data = await boundedJson("/pages/relay/article-data.json", 8000);
        const items = safeHeadlineItems(data);
        if (!items.length) return;
        renderHeadlines(items, false);
        storageSet(storage, RELAY_CACHE_KEY, { savedAt: Date.now(), data });
      } catch (_error) {
        // The cached or static fallback remains visible.
      }
    }

    function renderMarkets(items, stale) {
      const rail = doc.querySelector("[data-market-rail]");
      const note = doc.querySelector("[data-pulse-checked]");
      if (!rail || !items.length) return;
      replaceChildren(rail);
      items.forEach(function (item) {
        const cell = doc.createElement("div");
        const name = doc.createElement("span");
        const value = doc.createElement("strong");
        const change = doc.createElement("span");
        cell.className = "market-cell";
        name.className = "market-name";
        value.className = "market-value";
        change.className = "market-change";
        name.textContent = item.name;
        value.textContent = item.value;
        if (item.movement) {
          change.classList.add("is-" + item.movement.direction);
          change.textContent = item.movement.text;
        } else {
          change.classList.add("is-unavailable");
          change.textContent = "Change unavailable";
        }
        cell.setAttribute(
          "aria-label",
          item.name + ", " + item.value + ", " + change.textContent +
            (item.basis ? ", " + item.basis : "")
        );
        cell.append(name, value, change);
        rail.appendChild(cell);
      });
      if (note) note.textContent = stale ? "Saved market snapshot" : "Latest market snapshot";
    }

    async function loadMarkets() {
      const cached = storageGet(storage, PULSE_CACHE_KEY);
      if (cached && cached.data) renderMarkets(safePulseItems(cached.data), true);
      try {
        const data = await boundedJson("/pages/relay/pulse-data.json", 8000);
        const items = safePulseItems(data);
        if (!items.length) return;
        renderMarkets(items, false);
        storageSet(storage, PULSE_CACHE_KEY, { savedAt: Date.now(), data });
      } catch (_error) {
        // The cached or static fallback remains visible.
      }
    }

    function renderHistory(items, attribution) {
      const list = doc.querySelector("[data-history-list]");
      const fallback = doc.querySelector("[data-history-fallback]");
      const credit = doc.querySelector("[data-history-attribution]");
      const date = doc.querySelector("[data-history-date]");
      if (!list || !items.length) return;
      replaceChildren(list);
      items.slice(0, 3).forEach(function (item) {
        const li = doc.createElement("li");
        const link = doc.createElement("a");
        const year = doc.createElement("strong");
        const headline = doc.createElement("span");
        const copy = doc.createElement("span");
        const category = doc.createElement("small");
        link.href = item.url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        year.textContent = String(item.year);
        headline.textContent = item.headline;
        category.textContent = item.category;
        copy.className = "history-copy";
        copy.appendChild(headline);
        if (item.category) copy.appendChild(category);
        link.append(year, copy);
        li.appendChild(link);
        list.appendChild(li);
      });
      list.hidden = false;
      if (fallback) fallback.hidden = true;
      if (credit) {
        credit.hidden = false;
        credit.textContent = attribution;
      }
      if (date) {
        date.textContent = new Intl.DateTimeFormat("en-US", {
          month: "short",
          day: "numeric"
        }).format(new Date());
      }
    }

    function wikimediaItems(data) {
      const events =
        data && Array.isArray(data.selected)
          ? data.selected
          : data && Array.isArray(data.events)
            ? data.events
            : [];
      return safeHistoryItems(
        events.slice(0, 3).map(function (event) {
          const page = event.pages && event.pages[0];
          return {
            year: Number(event.year),
            headline: event.text,
            url:
              page && page.content_urls && page.content_urls.desktop
                ? page.content_urls.desktop.page
                : wikipediaDateUrl(new Date())
          };
        })
      );
    }

    async function loadHistory() {
      const now = new Date();
      try {
        const generated = await boundedJson("/tools/koga/start/today-data.json", 6000);
        const validator =
          win.KogaHistoryData && win.KogaHistoryData.validateTodayData;
        const items = validateGeneratedHistory(generated, now, validator);
        if (items.length === 3) {
          renderHistory(items, "Curated daily · Wikipedia");
          return;
        }
      } catch (_error) {
        // Continue through the documented fallback order.
      }

      try {
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const live = await boundedJson(
          "https://api.wikimedia.org/feed/v1/wikipedia/en/onthisday/selected/" +
            month +
            "/" +
            day,
          8000
        );
        const items = wikimediaItems(live);
        if (items.length === 3) {
          renderHistory(items, "On this day · Wikipedia");
          storageSet(storage, HISTORY_CACHE_KEY, {
            savedAt: Date.now(),
            date: dateKey(now),
            items
          });
          return;
        }
      } catch (_error) {
        // Same-day cache is checked next.
      }

      const cached = storageGet(storage, HISTORY_CACHE_KEY);
      if (cached && cached.date === dateKey(now)) {
        const items = safeHistoryItems(cached.items);
        if (items.length === 3) {
          renderHistory(items, "Saved today · Wikipedia");
          return;
        }
      }

      const more = doc.querySelector("[data-history-link]");
      if (more) more.href = wikipediaDateUrl(now);
    }

    function normalizeLocation(value) {
      const helper = win.KogaWeatherLocation;
      if (helper && typeof helper.normalizeWeatherLocation === "function") {
        return helper.normalizeWeatherLocation(value);
      }
      if (!validCoordinates(value)) return null;
      const normalized = {
        lat: Number(value.lat),
        lon: Number(value.lon),
        label:
          typeof value.label === "string"
            ? value.label.trim().slice(0, 160)
            : "",
        savedAt: validNumber(value.savedAt) ? value.savedAt : Date.now()
      };
      ["city", "state", "region", "zip", "postalCode", "country"].forEach(
        function (field) {
          if (typeof value[field] === "string" && value[field].trim()) {
            normalized[field] = value[field].trim().slice(0, 100);
          }
        }
      );
      if (
        (typeof value.timezone === "string" && value.timezone.trim()) ||
        validNumber(value.timezone)
      ) {
        normalized.timezone =
          typeof value.timezone === "string"
            ? value.timezone.trim().slice(0, 100)
            : value.timezone;
      }
      return normalized;
    }

    function setWeatherStatus(message, isError) {
      const status = doc.querySelector("[data-weather-status]");
      if (!status) return;
      status.textContent = message;
      status.classList.toggle("is-error", Boolean(isError));
    }

    function renderWeather(payload, cached) {
      if (!payload || !payload.current) return false;
      const current = payload.current;
      if (!current.main || !validNumber(current.main.temp)) return false;
      const forecastItems =
        payload.forecast && Array.isArray(payload.forecast.list)
          ? payload.forecast.list.slice(0, 8)
          : [];
      const highs = forecastItems
        .map(function (item) { return item.main && item.main.temp_max; })
        .filter(validNumber);
      const lows = forecastItems
        .map(function (item) { return item.main && item.main.temp_min; })
        .filter(validNumber);
      const rainValues = forecastItems
        .map(function (item) { return validNumber(item.pop) ? item.pop * 100 : null; })
        .filter(validNumber);
      const high = highs.length ? Math.max.apply(null, highs) : null;
      const low = lows.length ? Math.min.apply(null, lows) : null;
      const rain = rainValues.length ? Math.max.apply(null, rainValues) : null;
      const location = normalizeLocation(
        locationFromWeather(payload.current, payload.location)
      );
      if (location) activeWeatherLocation = location;

      const icon = doc.querySelector("[data-weather-icon]");
      const place = doc.querySelector("[data-weather-place]");
      const temperature = doc.querySelector("[data-weather-temperature]");
      const condition = doc.querySelector("[data-weather-condition]");
      const range = doc.querySelector("[data-weather-range]");
      const conditionCode =
        current.weather && current.weather[0] ? current.weather[0].id : null;
      if (icon) icon.textContent = weatherEmoji(conditionCode, 1);
      if (place) place.textContent = (location && location.label) || payload.label || "Your weather";
      if (temperature) temperature.textContent = Math.round(current.main.temp) + "°";
      if (condition) {
        condition.textContent =
          current.weather && current.weather[0] && current.weather[0].description
            ? current.weather[0].description
            : weatherCondition(conditionCode);
      }
      if (range) {
        range.textContent = [
          validNumber(high) ? "H " + Math.round(high) + "°" : "",
          validNumber(low) ? "L " + Math.round(low) + "°" : "",
          validNumber(rain) ? "Rain " + Math.round(rain) + "%" : ""
        ].filter(Boolean).join(" · ");
      }
      setWeatherStatus(cached ? "Saved weather · refreshes when online" : "Current conditions", false);
      return true;
    }

    async function fetchWeather(location) {
      const normalized = normalizeLocation(location);
      if (!normalized) return;
      const request = ++weatherRequest;
      setWeatherStatus("Updating weather…", false);
      const query =
        "?lat=" +
        encodeURIComponent(normalized.lat) +
        "&lon=" +
        encodeURIComponent(normalized.lon);
      const results = await Promise.allSettled([
        boundedJson(WEATHER_WORKER + "/weather" + query, 8000),
        boundedJson(WEATHER_WORKER + "/forecast" + query, 8000)
      ]);
      if (request !== weatherRequest) return;
      if (results[0].status !== "fulfilled") {
        setWeatherStatus("Weather is temporarily unavailable", true);
        return;
      }
      const payload = {
        current: results[0].value,
        forecast: results[1].status === "fulfilled" ? results[1].value : null,
        location: normalized,
        label: normalized.label
      };
      if (renderWeather(payload, false)) {
        activeWeatherLocation = normalized;
        storageSet(storage, WEATHER_LOCATION_KEY, normalized);
        storageSet(storage, WEATHER_CACHE_KEY, { savedAt: Date.now(), data: payload });
      }
    }

    async function findLocation(query) {
      if (/^\d{5}(-\d{4})?$/.test(query)) {
        const zipData = await boundedJson(
          WEATHER_WORKER + "/zip?zip=" + encodeURIComponent(query),
          8000
        );
        return normalizeLocation(
          locationFromWeather(
            {
              location: {
                lat: zipData && zipData.coord && zipData.coord.lat,
                lon: zipData && zipData.coord && zipData.coord.lon,
                label: zipData && zipData.name,
                city: zipData && zipData.name,
                country: zipData && zipData.country,
                zip: query,
                postalCode: query
              }
            },
            null
          )
        );
      }
      const data = await boundedJson(
        WEATHER_WORKER + "/geocode?text=" + encodeURIComponent(query),
        8000
      );
      const candidate =
        data && Array.isArray(data.results) ? data.results[0] : data && data.location;
      if (!candidate) return null;
      return normalizeLocation(
        locationFromWeather(
          {
            location: {
              lat: candidate.lat,
              lon: candidate.lon,
              label: [candidate.city || candidate.county || candidate.name, candidate.state_code || candidate.state]
                .filter(Boolean)
                .join(", "),
              city: candidate.city || candidate.county || candidate.name,
              state: candidate.state_code || candidate.state,
              region: candidate.state || candidate.region,
              country: candidate.country_code || candidate.country,
              postalCode: candidate.postcode || candidate.postalCode
            }
          },
          null
        )
      );
    }

    async function loadWeather() {
      const cached = storageGet(storage, WEATHER_CACHE_KEY);
      if (
        cached &&
        cached.data &&
        validNumber(cached.savedAt) &&
        Date.now() - cached.savedAt <= MAX_CACHE_AGE
      ) {
        renderWeather(cached.data, true);
      }
      const saved =
        normalizeLocation(storageGet(storage, WEATHER_LOCATION_KEY)) ||
        normalizeLocation(storageGet(storage, WEATHER_CENTER_LOCATION_KEY)) ||
        activeWeatherLocation;
      if (saved) {
        activeWeatherLocation = saved;
        await fetchWeather(saved);
      }
    }

    const weatherForm = doc.querySelector("[data-weather-form]");
    if (weatherForm) {
      weatherForm.addEventListener("submit", async function (event) {
        event.preventDefault();
        const input = weatherForm.querySelector("[data-weather-query]");
        const query = input ? input.value.trim().slice(0, 120) : "";
        if (!query) return;
        setWeatherStatus("Finding location…", false);
        try {
          const location = await findLocation(query);
          if (!location) throw new Error("Location unavailable");
          await fetchWeather(location);
        } catch (_error) {
          setWeatherStatus("Could not find that location", true);
        }
      });
    }

    const useLocation = doc.querySelector("[data-use-location]");
    if (useLocation) {
      useLocation.addEventListener("click", function () {
        if (!win.navigator.geolocation) {
          setWeatherStatus("Location access is unavailable", true);
          return;
        }
        setWeatherStatus("Getting your location…", false);
        win.navigator.geolocation.getCurrentPosition(
          function (position) {
            fetchWeather({
              lat: position.coords.latitude,
              lon: position.coords.longitude,
              label: "Current location"
            });
          },
          function () {
            setWeatherStatus("Location access was not granted", true);
          },
          { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
        );
      });
    }

    const fullForecast = doc.querySelector("[data-full-forecast]");
    if (fullForecast) {
      fullForecast.addEventListener("click", function () {
        const location =
          normalizeLocation(activeWeatherLocation) ||
          normalizeLocation(storageGet(storage, WEATHER_LOCATION_KEY));
        if (location) storageSet(storage, WEATHER_CENTER_LOCATION_KEY, location);
      });
    }

    Promise.resolve().then(loadWeather);
    Promise.resolve().then(loadHeadlines);
    Promise.resolve().then(loadMarkets);
    Promise.resolve().then(loadHistory);

    return {
      getActiveWeatherLocation: function () {
        return activeWeatherLocation;
      }
    };
  }

  return {
    init,
    safeParse,
    savedTheme,
    themeColor,
    safeHttpUrl,
    safeHeadlineItems,
    formatAge,
    pulseMovement,
    safePulseItems,
    dateKey,
    wikipediaDateUrl,
    safeHistoryItems,
    validateGeneratedHistory,
    validateGeneratedHistoryLocally,
    validCoordinates,
    locationFromWeather,
    weatherEmoji,
    weatherCondition
  };
});
