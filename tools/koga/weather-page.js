(function weatherPageFactory(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.KogaWeatherPage = api;
    if (root.document) root.addEventListener('DOMContentLoaded', () => api.init(root));
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function createWeatherPage() {
  'use strict';

  const WORKER = 'https://weather-worker.mikekoga.workers.dev';
  const LOCATION_KEY = 'weatherCenterLastLocation';
  const CACHE_KEY = 'weatherCenterForecastCache';
  const WEATHER_STORIES_URL = '/pages/relay/weather-data.json';
  const HEADLINES_URL = '/pages/relay/article-data.json';
  const WEATHER_TOPICS = [
    { label: 'Hurricane', symbol: '🌀', pattern: /\b(hurricane|tropical storm|typhoon|cyclone)\b/i },
    { label: 'Flooding', symbol: '🌊', pattern: /\b(flash flood|flooding|atmospheric river)\b/i },
    { label: 'Wildfire', symbol: '🔥', pattern: /\b(wildfire|wildfire smoke|fire weather)\b/i },
    { label: 'Air quality', symbol: '◌', pattern: /\b(air quality alert|smoke plume)\b/i },
    { label: 'Heat', symbol: '☀', pattern: /\b(extreme heat|heat wave)\b/i },
    { label: 'Snow', symbol: '❄', pattern: /\b(blizzard|snowstorm)\b/i },
    { label: 'Severe weather', symbol: '⚡', pattern: /\b(tornado|severe thunderstorm|severe storm|hail|lightning|damaging winds?|major weather warning)\b/i },
    { label: 'Weather', symbol: '☂', pattern: /\b(weather forecast|severe weather)\b/i },
    { label: 'Weather', symbol: '☂', pattern: /\bdrought\b/i }
  ];
  const MAX_SUGGESTIONS = 6;
  const MAX_HOURS = 24;

  function finite(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function safeParse(value) {
    try { return JSON.parse(value); } catch { return null; }
  }

  function safeStorageRead(storage, key) {
    if (!storage) return null;
    try { return safeParse(storage.getItem(key)); } catch { return null; }
  }

  function safeStorageWrite(storage, key, value) {
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function validCoordinates(location) {
    const lat = finite(location && location.lat);
    const lon = finite(location && location.lon);
    return lat !== null && lon !== null && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  }

  function sameLocation(a, b) {
    return validCoordinates(a) && validCoordinates(b)
      && Math.abs(Number(a.lat) - Number(b.lat)) < 0.01
      && Math.abs(Number(a.lon) - Number(b.lon)) < 0.01;
  }

  function validCurrent(data) {
    return Boolean(data && finite(data.dt) !== null && data.main
      && finite(data.main.temp) !== null && Array.isArray(data.weather) && data.weather[0]);
  }

  function forecastPeriods(data) {
    if (!data || !Array.isArray(data.list)) return [];
    return data.list.filter((period) => period && finite(period.dt) !== null
      && period.main && finite(period.main.temp) !== null
      && Array.isArray(period.weather) && period.weather[0]);
  }

  function validForecast(data) {
    return forecastPeriods(data).length > 0;
  }

  function validCache(value) {
    return Boolean(value && validCoordinates(value.location)
      && finite(value.savedAt) !== null
      && (validCurrent(value.current) || validForecast(value.forecast)));
  }

  function cleanText(value, maxLength = 120) {
    return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
  }

  function safeHttpUrl(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function storyTopic(title) {
    const text = cleanText(title, 300);
    return WEATHER_TOPICS.find((topic) => topic.pattern.test(text)) || null;
  }

  function storyTopicForItem(item) {
    const fromTitle = storyTopic(item && item.title);
    if (fromTitle) return fromTitle;
    const label = cleanText(item && item.topic, 50);
    const configured = WEATHER_TOPICS.find((topic) => topic.label.toLowerCase() === label.toLowerCase());
    return configured || { label: label || 'Weather', symbol: '☂' };
  }

  function storyImageUrl(item) {
    if (!item || typeof item !== 'object') return '';
    return safeHttpUrl(item.image_url || item.image || item.thumbnail_url || item.thumbnail);
  }

  function locationLabel(location, current) {
    const direct = cleanText(location && (location.displayName || location.label));
    if (direct) return direct;
    const parts = [
      cleanText(location && location.city, 60),
      cleanText(location && (location.region || location.state), 40)
    ].filter(Boolean);
    if (parts.length) return parts.join(', ');
    return cleanText(current && current.name, 80) || 'Local weather';
  }

  function shiftedDate(unixSeconds, offsetSeconds) {
    return new Date((Number(unixSeconds) + Number(offsetSeconds || 0)) * 1000);
  }

  function localParts(unixSeconds, offsetSeconds) {
    const date = shiftedDate(unixSeconds, offsetSeconds);
    return {
      key: date.toISOString().slice(0, 10),
      hour: date.getUTCHours(),
      minute: date.getUTCMinutes(),
      weekday: date.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' })
    };
  }

  function formatHour(unixSeconds, offsetSeconds) {
    return shiftedDate(unixSeconds, offsetSeconds).toLocaleTimeString('en-US', {
      hour: 'numeric',
      timeZone: 'UTC'
    });
  }

  function formatClock(unixSeconds, offsetSeconds) {
    return shiftedDate(unixSeconds, offsetSeconds).toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone: 'UTC'
    });
  }

  function compass(degrees) {
    const value = finite(degrees);
    if (value === null) return '';
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return names[Math.round((((value % 360) + 360) % 360) / 45) % 8];
  }

  function weatherSymbol(code, pod) {
    const id = finite(code) || 800;
    if (id >= 200 && id < 300) return '⛈️';
    if (id >= 300 && id < 600) return '🌧️';
    if (id >= 600 && id < 700) return '🌨️';
    if (id >= 700 && id < 800) return '🌫️';
    if (id === 800) return pod === 'n' ? '🌙' : '☀️';
    if (id === 801 || id === 802) return pod === 'n' ? '☁️' : '🌤️';
    return '☁️';
  }

  function groupDaily(periods, offsetSeconds) {
    const groups = new Map();
    forecastPeriods({ list: periods }).forEach((period) => {
      const key = localParts(period.dt, offsetSeconds).key;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(period);
    });
    return Array.from(groups, ([key, items]) => {
      const temps = items.map((item) => finite(item.main.temp)).filter((value) => value !== null);
      const pops = items.map((item) => finite(item.pop)).filter((value) => value !== null);
      const representative = items.reduce((best, item) => {
        const hour = localParts(item.dt, offsetSeconds).hour;
        const bestHour = localParts(best.dt, offsetSeconds).hour;
        return Math.abs(hour - 12) < Math.abs(bestHour - 12) ? item : best;
      }, items[0]);
      const gusts = items.map((item) => finite(item.wind && item.wind.gust)).filter((value) => value !== null);
      const humidity = items.map((item) => finite(item.main.humidity)).filter((value) => value !== null);
      return {
        key,
        weekday: localParts(items[0].dt, offsetSeconds).weekday,
        high: Math.max(...temps),
        low: Math.min(...temps),
        pop: pops.length ? Math.max(...pops) : null,
        gust: gusts.length ? Math.max(...gusts) : null,
        humidity: humidity.length ? Math.max(...humidity) : null,
        representative,
        count: items.length
      };
    }).slice(0, 7);
  }

  function summaryForForecast(periods, offsetSeconds) {
    const list = forecastPeriods({ list: periods }).slice(0, 8);
    if (!list.length) return '';
    const temperatures = list.map((item) => finite(item.main.temp)).filter((value) => value !== null);
    const maxPop = Math.max(...list.map((item) => finite(item.pop) || 0));
    const maxGust = Math.max(...list.map((item) => finite(item.wind && item.wind.gust) || 0));
    const hottest = Math.max(...temperatures);
    const coolest = Math.min(...temperatures);
    if (maxPop >= 0.6) {
      const first = list.find((item) => (finite(item.pop) || 0) >= 0.6);
      return `Rain becomes more likely around ${formatHour(first.dt, offsetSeconds)}.`;
    }
    if (maxGust >= 30) return `Breezy at times, with forecast gusts near ${Math.round(maxGust)} mph.`;
    if (hottest >= 95) return `Very hot today, with forecast temperatures near ${Math.round(hottest)}°.`;
    if (hottest - coolest >= 20) return `Forecast temperatures span about ${Math.round(hottest - coolest)}° across the available periods.`;
    return '';
  }

  function filterWeatherHeadlines(payload) {
    if (!payload || !Array.isArray(payload.items)) return [];
    return payload.items.filter((item) => item && storyTopic(item.title) && safeHttpUrl(item.url)).slice(0, 3);
  }

  function validDedicatedWeatherFeed(payload) {
    const allowedStatuses = new Set(['ok', 'ok_empty', 'partial']);
    return Boolean(payload
      && payload.schema_version === '1.0'
      && allowedStatuses.has(payload.status)
      && Number.isFinite(Date.parse(payload.generated_at))
      && Array.isArray(payload.items)
      && payload.items.length <= 3
      && payload.items.every((item) => item
        && cleanText(item.title, 300)
        && cleanText(item.publisher, 100)
        && cleanText(item.topic, 50)
        && safeHttpUrl(item.url)
        && Number.isFinite(Date.parse(item.published_at))));
  }

  function chooseStoryItems(dedicatedPayload, generalPayload) {
    if (validDedicatedWeatherFeed(dedicatedPayload)) return dedicatedPayload.items;
    return filterWeatherHeadlines(generalPayload);
  }

  function formatAge(value, now = Date.now()) {
    const timestamp = Date.parse(value);
    if (!Number.isFinite(timestamp) || timestamp > now + 60000) return '';
    const hours = Math.floor((now - timestamp) / 3600000);
    if (hours < 1) return 'recent';
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return days <= 7 ? `${days}d ago` : '';
  }

  function cacheForLocation(storage, location) {
    const cache = safeStorageRead(storage, CACHE_KEY);
    return validCache(cache) && sameLocation(cache.location, location) ? cache : null;
  }

  function createController(win) {
    const doc = win.document;
    const storage = win.localStorage;
    const locationApi = win.KogaWeatherLocation || {};
    const els = {};
    let activeLocation = null;
    let activeRequest = 0;
    let suggestions = [];
    let selectedSuggestion = -1;
    let suggestionTimer = null;

    const ids = [
      'locationName', 'updateLine', 'changeButton', 'refreshButton', 'locationPanel',
      'locationForm', 'locationInput', 'suggestions', 'useLocationButton', 'statusMessage',
      'currentSection', 'currentSymbol', 'currentTemperature', 'currentCondition',
      'currentSummary', 'whatToKnow', 'primaryDetails', 'moreDetails', 'secondaryDetails',
      'hourlySection', 'hourlyForecast', 'dailySection', 'dailyRange', 'dailyForecast',
      'headlinesSection', 'headlineList'
    ];
    ids.forEach((id) => { els[id] = doc.getElementById(id); });

    function clear(node) {
      while (node.firstChild) node.removeChild(node.firstChild);
    }

    function element(tag, className, text) {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    function showStatus(message, isError = false) {
      els.statusMessage.textContent = message;
      els.statusMessage.classList.toggle('error', isError);
      els.statusMessage.hidden = !message;
    }

    function setBusy(busy) {
      els.refreshButton.disabled = busy || !activeLocation;
      els.locationInput.setAttribute('aria-busy', String(busy));
    }

    function setLocationPanel(open, focus = false) {
      els.locationPanel.hidden = !open;
      els.changeButton.setAttribute('aria-expanded', String(open));
      els.changeButton.textContent = open ? 'Close' : 'Change';
      if (open && focus) els.locationInput.focus();
    }

    function normalizeLocation(value) {
      if (typeof locationApi.normalizeWeatherLocation !== 'function') return null;
      return locationApi.normalizeWeatherLocation(value);
    }

    function saveLocation(location) {
      const normalized = normalizeLocation(location);
      if (!normalized) return null;
      safeStorageWrite(storage, LOCATION_KEY, normalized);
      return normalized;
    }

    function addDetail(list, label, value) {
      if (!value && value !== 0) return;
      const item = element('div', 'detail-item');
      item.append(element('dt', '', label), element('dd', '', String(value)));
      list.append(item);
    }

    function renderCurrent(current, forecast, cached, location) {
      const offset = finite(current.timezone) || 0;
      const weather = current.weather[0];
      const days = validForecast(forecast) ? groupDaily(forecast.list, offset) : [];
      const today = days[0];
      els.locationName.textContent = locationLabel(location, current);
      els.currentTemperature.textContent = String(Math.round(current.main.temp));
      els.currentCondition.textContent = cleanText(weather.description) || cleanText(weather.main) || 'Current conditions';
      els.currentSymbol.textContent = weatherSymbol(weather.id, current.sys && current.sys.pod);
      els.updateLine.textContent = `${cached ? 'Saved forecast · ' : ''}Updated ${formatClock(current.dt, offset)}`;
      clear(els.currentSummary);
      if (finite(current.main.feels_like) !== null) {
        els.currentSummary.append(element('p', '', `Feels like ${Math.round(current.main.feels_like)}°`));
      }
      if (today) {
        els.currentSummary.append(element('p', '', `Today ${Math.round(today.high)}° / ${Math.round(today.low)}°`));
        if (today.pop !== null) els.currentSummary.append(element('p', '', `Precipitation ${Math.round(today.pop * 100)}%`));
      }
      if (cached) els.currentSummary.append(element('span', 'cache-badge', 'Saved forecast'));

      clear(els.primaryDetails);
      const windSpeed = finite(current.wind && current.wind.speed);
      const windDirection = compass(current.wind && current.wind.deg);
      addDetail(els.primaryDetails, 'Wind', windSpeed === null ? '' : `${windDirection ? `${windDirection} ` : ''}${Math.round(windSpeed)} mph`);
      addDetail(els.primaryDetails, 'Humidity', finite(current.main.humidity) === null ? '' : `${Math.round(current.main.humidity)}%`);
      addDetail(els.primaryDetails, 'Gusts', finite(current.wind && current.wind.gust) === null ? '' : `${Math.round(current.wind.gust)} mph`);
      addDetail(els.primaryDetails, 'Cloud cover', finite(current.clouds && current.clouds.all) === null ? '' : `${Math.round(current.clouds.all)}%`);

      clear(els.secondaryDetails);
      addDetail(els.secondaryDetails, 'Pressure', finite(current.main.pressure) === null ? '' : `${Math.round(current.main.pressure)} hPa`);
      addDetail(els.secondaryDetails, 'Visibility', finite(current.visibility) === null ? '' : `${(current.visibility / 1609.344).toFixed(1)} mi`);
      addDetail(els.secondaryDetails, 'Sunrise', finite(current.sys && current.sys.sunrise) === null ? '' : formatClock(current.sys.sunrise, offset));
      addDetail(els.secondaryDetails, 'Sunset', finite(current.sys && current.sys.sunset) === null ? '' : formatClock(current.sys.sunset, offset));
      els.moreDetails.hidden = !els.secondaryDetails.children.length;

      const summary = validForecast(forecast) ? summaryForForecast(forecast.list, offset) : '';
      els.whatToKnow.textContent = summary;
      els.whatToKnow.hidden = !summary;
      els.currentSection.hidden = false;
      els.refreshButton.disabled = false;
    }

    function renderHourly(forecast, offset) {
      clear(els.hourlyForecast);
      const periods = forecastPeriods(forecast).slice(0, MAX_HOURS);
      periods.forEach((period, index) => {
        const card = element('article', 'hour-card');
        const label = `${index === 0 ? 'Nearest period' : formatHour(period.dt, offset)}, ${Math.round(period.main.temp)} degrees`;
        card.setAttribute('aria-label', label);
        card.append(
          element('div', 'hour-time', index === 0 ? 'Next' : formatHour(period.dt, offset)),
          element('div', 'hour-icon', weatherSymbol(period.weather[0].id, period.sys && period.sys.pod)),
          element('div', 'hour-temp', `${Math.round(period.main.temp)}°`)
        );
        if (finite(period.pop) !== null) card.append(element('div', 'hour-pop', `💧 ${Math.round(period.pop * 100)}%`));
        els.hourlyForecast.append(card);
      });
      els.hourlySection.hidden = !periods.length;
    }

    function renderDaily(forecast, offset) {
      clear(els.dailyForecast);
      const days = groupDaily(forecast.list, offset);
      els.dailyRange.textContent = days.length ? `${days.length} available days` : '';
      days.forEach((day, index) => {
        const wrapper = element('div', 'daily-item');
        const button = element('button', 'daily-toggle');
        const detail = element('div', 'daily-detail');
        const detailId = `daily-detail-${index}`;
        button.type = 'button';
        button.setAttribute('aria-expanded', 'false');
        button.setAttribute('aria-controls', detailId);
        detail.id = detailId;
        detail.hidden = true;
        button.append(
          element('span', 'daily-day', index === 0 ? 'Today' : day.weekday),
          element('span', 'daily-icon', weatherSymbol(day.representative.weather[0].id, day.representative.sys && day.representative.sys.pod)),
          element('span', 'daily-condition', cleanText(day.representative.weather[0].description) || 'Forecast'),
          element('span', 'daily-pop', day.pop === null ? '' : `💧 ${Math.round(day.pop * 100)}%`),
          element('span', 'daily-temps', `${Math.round(day.high)}° `),
          element('span', 'daily-chevron', '⌄')
        );
        button.children[4].append(element('span', 'daily-low', `/ ${Math.round(day.low)}°`));
        detail.append(element('p', '', cleanText(day.representative.weather[0].description) || 'Forecast conditions'));
        if (day.pop !== null) detail.append(element('p', '', `Precipitation chance up to ${Math.round(day.pop * 100)}%`));
        if (day.gust !== null) detail.append(element('p', '', `Forecast gusts up to ${Math.round(day.gust)} mph`));
        if (day.humidity !== null) detail.append(element('p', '', `Humidity up to ${Math.round(day.humidity)}%`));
        const windSpeed = finite(day.representative.wind && day.representative.wind.speed);
        if (windSpeed !== null) detail.append(element('p', '', `Wind near ${Math.round(windSpeed)} mph`));
        button.addEventListener('click', () => {
          const opening = button.getAttribute('aria-expanded') !== 'true';
          els.dailyForecast.querySelectorAll('.daily-toggle').forEach((other) => {
            other.setAttribute('aria-expanded', 'false');
            const controlled = doc.getElementById(other.getAttribute('aria-controls'));
            if (controlled) controlled.hidden = true;
          });
          button.setAttribute('aria-expanded', String(opening));
          detail.hidden = !opening;
        });
        wrapper.append(button, detail);
        els.dailyForecast.append(wrapper);
      });
      els.dailySection.hidden = !days.length;
    }

    function renderForecast(forecast, offset) {
      renderHourly(forecast, offset);
      renderDaily(forecast, offset);
    }

    async function fetchJson(url) {
      const response = await win.fetch(url);
      if (!response.ok) throw new Error('Request failed');
      return response.json();
    }

    async function loadWeather(location, options = {}) {
      const normalized = normalizeLocation(location);
      if (!normalized) {
        showStatus('Choose a valid ZIP code, city, or detected location.', true);
        return false;
      }
      const switchingLocation = activeLocation && !sameLocation(activeLocation, normalized);
      activeLocation = normalized;
      if (switchingLocation) {
        els.currentSection.hidden = true;
        els.hourlySection.hidden = true;
        els.dailySection.hidden = true;
      }
      const requestId = ++activeRequest;
      setBusy(true);
      showStatus(options.refresh ? 'Refreshing weather…' : 'Loading weather…');
      const cached = cacheForLocation(storage, normalized);
      const query = `lat=${encodeURIComponent(normalized.lat)}&lon=${encodeURIComponent(normalized.lon)}`;
      const [currentResult, forecastResult] = await Promise.allSettled([
        fetchJson(`${WORKER}/weather?${query}`),
        fetchJson(`${WORKER}/forecast?${query}`)
      ]);
      if (requestId !== activeRequest) return false;

      const freshCurrent = currentResult.status === 'fulfilled' && validCurrent(currentResult.value) ? currentResult.value : null;
      const freshForecast = forecastResult.status === 'fulfilled' && validForecast(forecastResult.value) ? forecastResult.value : null;
      const current = freshCurrent || (cached && cached.current);
      const forecast = freshForecast || (cached && cached.forecast);
      const usingCurrentCache = !freshCurrent && Boolean(cached && cached.current);
      const usingForecastCache = !freshForecast && Boolean(cached && cached.forecast);
      const usingSavedData = usingCurrentCache || usingForecastCache;

      if (!current) {
        showStatus('Weather is temporarily unavailable. Your saved location is still available for another try.', true);
        setBusy(false);
        return false;
      }

      activeLocation = saveLocation(normalized) || normalized;
      renderCurrent(current, forecast, usingSavedData, activeLocation);
      if (forecast) renderForecast(forecast, finite(current.timezone) || 0);
      else {
        els.hourlySection.hidden = true;
        els.dailySection.hidden = true;
      }

      const cacheValue = {
        savedAt: (freshCurrent || freshForecast) ? Date.now() : cached.savedAt,
        location: activeLocation,
        current: freshCurrent || (cached && cached.current) || null,
        forecast: freshForecast || (cached && cached.forecast) || null
      };
      safeStorageWrite(storage, CACHE_KEY, cacheValue);
      if (usingCurrentCache) showStatus('Live conditions could not be reached. Showing your saved forecast.', false);
      else if (usingForecastCache) showStatus('Current conditions are live. Showing the most recent saved forecast.', false);
      else if (!freshForecast) showStatus('Current conditions are live. The forecast is temporarily unavailable.', false);
      else showStatus('');
      setLocationPanel(false);
      setBusy(false);
      return true;
    }

    function suggestionLabel(item) {
      if (!item) return '';
      const direct = cleanText(item.label || item.displayName || item.formatted, 140);
      if (direct) return direct;
      return [item.city || item.name || item.county, item.state_code || item.state, item.country]
        .map((value) => cleanText(value, 80)).filter(Boolean).join(', ').slice(0, 140);
    }

    function suggestionLocation(item) {
      const coordinates = item && item.coord ? item.coord : item;
      return normalizeLocation({
        lat: coordinates && (coordinates.lat ?? coordinates.latitude),
        lon: coordinates && (coordinates.lon ?? coordinates.longitude),
        displayName: suggestionLabel(item),
        city: item.city || item.name,
        state: item.state,
        region: item.region || item.state,
        postalCode: item.postalCode || item.zip,
        country: item.country,
        timezone: item.timezone
      });
    }

    function closeSuggestions() {
      suggestions = [];
      selectedSuggestion = -1;
      clear(els.suggestions);
      els.suggestions.hidden = true;
      els.locationInput.setAttribute('aria-expanded', 'false');
    }

    function renderSuggestions(items) {
      closeSuggestions();
      suggestions = items.filter((item) => suggestionLabel(item) && suggestionLocation(item)).slice(0, MAX_SUGGESTIONS);
      suggestions.forEach((item, index) => {
        const row = element('li');
        row.setAttribute('role', 'option');
        const button = element('button', '', suggestionLabel(item));
        button.type = 'button';
        button.setAttribute('aria-selected', 'false');
        button.addEventListener('click', () => {
          els.locationInput.value = suggestionLabel(item);
          closeSuggestions();
          loadWeather(suggestionLocation(item));
        });
        row.append(button);
        els.suggestions.append(row);
      });
      els.suggestions.hidden = !suggestions.length;
      els.locationInput.setAttribute('aria-expanded', String(Boolean(suggestions.length)));
    }

    function selectSuggestion(index) {
      const buttons = els.suggestions.querySelectorAll('button');
      if (!buttons.length) return;
      selectedSuggestion = (index + buttons.length) % buttons.length;
      buttons.forEach((button, itemIndex) => button.setAttribute('aria-selected', String(itemIndex === selectedSuggestion)));
      buttons[selectedSuggestion].scrollIntoView({ block: 'nearest' });
    }

    async function fetchSuggestions(query) {
      try {
        const payload = await fetchJson(`${WORKER}/autocomplete?text=${encodeURIComponent(query)}`);
        const items = Array.isArray(payload) ? payload : (payload.results || payload.locations || []);
        renderSuggestions(items);
      } catch {
        closeSuggestions();
      }
    }

    async function geocode(query) {
      const zip = /^\d{5}(?:-\d{4})?$/.test(query);
      const endpoints = zip
        ? [`${WORKER}/zip?zip=${encodeURIComponent(query)}`]
        : [`${WORKER}/geocode?text=${encodeURIComponent(query)}`, `${WORKER}/owmgeo?q=${encodeURIComponent(query)}`];
      for (const endpoint of endpoints) {
        try {
          const payload = await fetchJson(endpoint);
          const candidates = Array.isArray(payload) ? payload : (payload.results || payload.locations || [payload]);
          for (const candidate of candidates) {
            const normalized = suggestionLocation(candidate);
            if (normalized) return normalized;
          }
        } catch {
          // Try the next established worker endpoint.
        }
      }
      return null;
    }

    async function submitSearch(event) {
      event.preventDefault();
      const query = els.locationInput.value.trim().slice(0, 160);
      if (!query) {
        showStatus('Enter a ZIP code or city.', true);
        return;
      }
      if (selectedSuggestion >= 0 && suggestions[selectedSuggestion]) {
        const selected = suggestionLocation(suggestions[selectedSuggestion]);
        closeSuggestions();
        await loadWeather(selected);
        return;
      }
      closeSuggestions();
      setBusy(true);
      showStatus('Finding that location…');
      const found = await geocode(query);
      if (!found) {
        showStatus('That location could not be found. Check the ZIP code or city and try again.', true);
        setBusy(false);
        return;
      }
      await loadWeather(found);
    }

    function useGeolocation() {
      if (!win.navigator.geolocation) {
        showStatus('Location access is not available in this browser.', true);
        return;
      }
      showStatus('Waiting for location permission…');
      win.navigator.geolocation.getCurrentPosition(
        (position) => loadWeather({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          displayName: 'Current location'
        }),
        () => showStatus('Location access was not available. Search by ZIP code or city instead.', true),
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
      );
    }

    async function loadHeadlines() {
      let items;
      try {
        const dedicatedPayload = await fetchJson(WEATHER_STORIES_URL);
        if (!validDedicatedWeatherFeed(dedicatedPayload)) throw new Error('Invalid dedicated weather feed');
        items = dedicatedPayload.items;
      } catch {
        try {
          items = filterWeatherHeadlines(await fetchJson(HEADLINES_URL));
        } catch {
          items = [];
        }
      }
      try {
        clear(els.headlineList);
        items.forEach((item) => {
          const topic = storyTopicForItem(item);
          const link = element('a', 'story-card');
          link.href = safeHttpUrl(item.url);
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          const visual = element('span', 'story-visual');
          visual.append(element('span', 'story-fallback', topic.symbol));
          const imageUrl = storyImageUrl(item);
          if (imageUrl) {
            const image = element('img');
            image.src = imageUrl;
            image.alt = '';
            image.loading = 'lazy';
            image.addEventListener('error', () => image.remove());
            visual.append(image);
          }
          const copy = element('span', 'story-copy');
          copy.append(
            element('span', 'story-badge', topic.label),
            element('span', 'story-title', cleanText(item.title, 240))
          );
          const publisher = cleanText(item.publisher || item.source || item.source_id, 80);
          const age = formatAge(item.published_at);
          const meta = [publisher, age].filter(Boolean).join(' · ');
          if (meta) copy.append(element('span', 'story-meta', meta));
          link.append(visual, copy, element('span', 'external-arrow', '↗'));
          els.headlineList.append(link);
        });
        els.headlinesSection.hidden = !items.length;
      } catch {
        els.headlinesSection.hidden = true;
      }
    }

    function bind() {
      els.changeButton.addEventListener('click', () => setLocationPanel(els.locationPanel.hidden, true));
      els.refreshButton.addEventListener('click', () => activeLocation && loadWeather(activeLocation, { refresh: true }));
      els.locationForm.addEventListener('submit', submitSearch);
      els.useLocationButton.addEventListener('click', useGeolocation);
      els.locationInput.addEventListener('input', () => {
        win.clearTimeout(suggestionTimer);
        const query = els.locationInput.value.trim().slice(0, 100);
        if (query.length < 2 || /^\d{1,4}$/.test(query)) {
          closeSuggestions();
          return;
        }
        suggestionTimer = win.setTimeout(() => fetchSuggestions(query), 220);
      });
      els.locationInput.addEventListener('keydown', (event) => {
        if (event.key === 'ArrowDown') { event.preventDefault(); selectSuggestion(selectedSuggestion + 1); }
        else if (event.key === 'ArrowUp') { event.preventDefault(); selectSuggestion(selectedSuggestion - 1); }
        else if (event.key === 'Escape') closeSuggestions();
      });
      doc.addEventListener('click', (event) => {
        if (!els.locationPanel.contains(event.target)) closeSuggestions();
      });
    }

    async function start() {
      bind();
      loadHeadlines();
      const raw = safeStorageRead(storage, LOCATION_KEY);
      const saved = normalizeLocation(raw);
      if (saved) {
        activeLocation = saved;
        setLocationPanel(false);
        await loadWeather(saved);
      } else {
        setLocationPanel(true);
        els.locationInput.focus();
      }
    }

    return { start, loadWeather, getActiveLocation: () => activeLocation };
  }

  function init(win) {
    if (!win || !win.document || !win.document.getElementById('locationForm')) return null;
    const controller = createController(win);
    controller.start();
    return controller;
  }

  return {
    WORKER,
    LOCATION_KEY,
    CACHE_KEY,
    WEATHER_STORIES_URL,
    safeParse,
    safeStorageRead,
    safeStorageWrite,
    validCoordinates,
    sameLocation,
    validCurrent,
    validForecast,
    validCache,
    forecastPeriods,
    groupDaily,
    summaryForForecast,
    filterWeatherHeadlines,
    validDedicatedWeatherFeed,
    chooseStoryItems,
    safeHttpUrl,
    storyTopic,
    storyTopicForItem,
    storyImageUrl,
    formatAge,
    weatherSymbol,
    compass,
    locationLabel,
    createController,
    init
  };
});
