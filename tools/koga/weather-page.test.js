'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const weather = require('./weather-page.js');
const pageScript = fs.readFileSync(path.join(__dirname, 'weather-page.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(__dirname, '..', '..', 'weather.html'), 'utf8');

function period(overrides = {}) {
  return {
    dt: 1722000000,
    main: { temp: 80, humidity: 30 },
    weather: [{ id: 800, main: 'Clear', description: 'clear sky' }],
    wind: { speed: 5, gust: 8 },
    pop: 0,
    sys: { pod: 'd' },
    ...overrides
  };
}

function current(overrides = {}) {
  return {
    dt: 1722000000,
    timezone: -25200,
    main: { temp: 82, feels_like: 80, humidity: 25 },
    weather: [{ id: 800, description: 'clear sky' }],
    ...overrides
  };
}

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  };
}

test('safeParse accepts valid JSON', () => {
  assert.deepEqual(weather.safeParse('{"ok":true}'), { ok: true });
});

test('safeParse rejects malformed JSON without throwing', () => {
  assert.equal(weather.safeParse('{bad'), null);
});

test('safeStorageRead tolerates unavailable storage', () => {
  assert.equal(weather.safeStorageRead(null, 'key'), null);
});

test('safeStorageRead tolerates storage exceptions', () => {
  assert.equal(weather.safeStorageRead({ getItem() { throw new Error('blocked'); } }, 'key'), null);
});

test('safeStorageWrite serializes data', () => {
  const storage = memoryStorage();
  assert.equal(weather.safeStorageWrite(storage, 'key', { a: 1 }), true);
  assert.equal(storage.value('key'), '{"a":1}');
});

test('safeStorageWrite tolerates quota errors', () => {
  assert.equal(weather.safeStorageWrite({ setItem() { throw new Error('quota'); } }, 'key', {}), false);
});

test('validCoordinates accepts supported coordinate locations', () => {
  assert.equal(weather.validCoordinates({ lat: 39.5, lon: -119.8 }), true);
});

test('validCoordinates rejects out-of-range coordinates', () => {
  assert.equal(weather.validCoordinates({ lat: 120, lon: 0 }), false);
  assert.equal(weather.validCoordinates({ lat: 20, lon: -200 }), false);
});

test('sameLocation permits insignificant coordinate rounding', () => {
  assert.equal(weather.sameLocation({ lat: 39.5296, lon: -119.8138 }, { lat: 39.53, lon: -119.814 }), true);
});

test('sameLocation rejects a different cached city', () => {
  assert.equal(weather.sameLocation({ lat: 39.5, lon: -119.8 }, { lat: 34.05, lon: -118.24 }), false);
});

test('validCurrent accepts the worker current schema', () => {
  assert.equal(weather.validCurrent(current()), true);
});

test('validCurrent rejects missing temperature', () => {
  assert.equal(weather.validCurrent(current({ main: {} })), false);
});

test('validForecast accepts usable worker periods', () => {
  assert.equal(weather.validForecast({ list: [period()] }), true);
});

test('validForecast filters malformed forecast periods', () => {
  assert.equal(weather.validForecast({ list: [{ dt: 1, main: {}, weather: [] }] }), false);
});

test('validCache requires matching weather content and location', () => {
  assert.equal(weather.validCache({
    savedAt: Date.now(),
    location: { lat: 39.5, lon: -119.8 },
    current: current()
  }), true);
});

test('invalid cache cannot stand in for weather', () => {
  assert.equal(weather.validCache({ savedAt: Date.now(), location: { lat: 39.5, lon: -119.8 } }), false);
});

test('groupDaily calculates high, low, precipitation, and gust', () => {
  const grouped = weather.groupDaily([
    period({ dt: 1722000000, main: { temp: 70 }, pop: .1 }),
    period({ dt: 1722010800, main: { temp: 91 }, pop: .6, wind: { gust: 32 } })
  ], 0);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].high, 91);
  assert.equal(grouped[0].low, 70);
  assert.equal(grouped[0].pop, .6);
  assert.equal(grouped[0].gust, 32);
});

test('groupDaily never invents seven days from fewer periods', () => {
  assert.equal(weather.groupDaily([period()], 0).length, 1);
});

test('groupDaily caps output at seven genuine local days', () => {
  const periods = Array.from({ length: 9 }, (_, index) => period({ dt: 1722000000 + index * 86400 }));
  assert.equal(weather.groupDaily(periods, 0).length, 7);
});

test('summary prioritizes meaningful precipitation', () => {
  const result = weather.summaryForForecast([period({ pop: .7 })], 0);
  assert.match(result, /Rain becomes more likely/);
});

test('summary describes strong forecast gusts', () => {
  const result = weather.summaryForForecast([period({ wind: { gust: 34 } })], 0);
  assert.equal(result, 'Breezy at times, with forecast gusts near 34 mph.');
});

test('summary describes very hot forecast temperatures', () => {
  const result = weather.summaryForForecast([period({ main: { temp: 99 } })], 0);
  assert.equal(result, 'Very hot today, with forecast temperatures near 99°.');
});

test('summary describes a large forecast temperature swing', () => {
  const result = weather.summaryForForecast([
    period({ main: { temp: 50 } }),
    period({ dt: 1722010800, main: { temp: 75 } })
  ], 0);
  assert.match(result, /span about 25°/);
});

test('summary stays hidden when no useful claim is supported', () => {
  assert.equal(weather.summaryForForecast([period()], 0), '');
  assert.equal(weather.summaryForForecast([], 0), '');
});

test('weather headlines include only relevant safe links', () => {
  const items = weather.filterWeatherHeadlines({ items: [
    { title: 'Severe weather moves toward the coast', url: 'https://example.com/storm' },
    { title: 'Local team wins', url: 'https://example.com/sports' },
    { title: 'Flash flood update', url: 'javascript:alert(1)' }
  ] });
  assert.deepEqual(items.map((item) => item.title), ['Severe weather moves toward the coast']);
});

test('qualifying weather stories receive intentional topic cards', () => {
  assert.equal(weather.storyTopic('Tornado warning issued for three counties').label, 'Severe weather');
  assert.equal(weather.storyTopic('Tornado warning issued for three counties').symbol, '⚡');
  assert.equal(weather.storyTopic('Hurricane reaches the coast').label, 'Hurricane');
  assert.equal(weather.storyTopic('Air quality alert remains active').label, 'Air quality');
  assert.match(pageScript, /element\('a', 'story-card'\)/);
});

test('weather stories are hidden when none qualify', () => {
  assert.deepEqual(weather.filterWeatherHeadlines({ items: [
    { title: 'Local team wins', url: 'https://example.com/sports' }
  ] }), []);
  assert.match(pageScript, /headlinesSection\.hidden = !items\.length/);
});

test('weather headlines are capped at three', () => {
  const payload = { items: Array.from({ length: 5 }, (_, index) => ({
    title: `Severe weather forecast ${index}`,
    url: `https://example.com/${index}`
  })) };
  assert.equal(weather.filterWeatherHeadlines(payload).length, 3);
});

test('vague hot, cold, storm, and crisis headlines are excluded', () => {
  const payload = { items: [
    { title: 'A hot new restaurant opens', url: 'https://example.com/1' },
    { title: 'Team takes the league by storm', url: 'https://example.com/2' },
    { title: 'Political crisis deepens', url: 'https://example.com/3' }
  ] };
  assert.equal(weather.filterWeatherHeadlines(payload).length, 0);
});

test('headline ages are shown only when reliable and recent', () => {
  const now = Date.parse('2026-07-26T12:00:00Z');
  assert.equal(weather.formatAge('2026-07-26T10:00:00Z', now), '2h ago');
  assert.equal(weather.formatAge('2026-07-01T10:00:00Z', now), '');
  assert.equal(weather.formatAge('not-a-date', now), '');
});

test('publisher and reliable age metadata are combined without invented values', () => {
  assert.match(pageScript, /const meta = \[publisher, age\]\.filter\(Boolean\)\.join\(' · '\)/);
  assert.equal(weather.formatAge(undefined), '');
});

test('missing image fields use the topic fallback', () => {
  assert.equal(weather.storyImageUrl({ title: 'Flash flood warning' }), '');
  assert.match(pageScript, /story-fallback/);
});

test('safe story image URLs are accepted', () => {
  assert.equal(weather.storyImageUrl({ thumbnail_url: 'https://images.example.com/storm.jpg' }),
    'https://images.example.com/storm.jpg');
});

test('unsafe and malformed story image URLs are rejected', () => {
  assert.equal(weather.storyImageUrl({ image: 'javascript:alert(1)' }), '');
  assert.equal(weather.storyImageUrl({ image: 'data:image/png;base64,AA==' }), '');
  assert.equal(weather.storyImageUrl({ image: 'blob:https://example.com/id' }), '');
  assert.equal(weather.storyImageUrl({ image: 'not a url' }), '');
});

test('broken images remove only the image and retain the story', () => {
  assert.match(pageScript, /image\.addEventListener\('error', \(\) => image\.remove\(\)\)/);
});

test('story links use safe external-link attributes', () => {
  assert.match(pageScript, /link\.target = '_blank'/);
  assert.match(pageScript, /link\.rel = 'noopener noreferrer'/);
});

test('weather symbols cover key condition groups', () => {
  assert.equal(weather.weatherSymbol(211), '⛈️');
  assert.equal(weather.weatherSymbol(601), '🌨️');
  assert.equal(weather.weatherSymbol(800, 'n'), '🌙');
});

test('compass converts degrees without exposing coordinates', () => {
  assert.equal(weather.compass(0), 'N');
  assert.equal(weather.compass(225), 'SW');
});

test('locationLabel prefers a saved display name', () => {
  assert.equal(weather.locationLabel({ displayName: 'Reno, NV' }, { name: 'Reno' }), 'Reno, NV');
});

test('locationLabel falls back to safe city and region fields', () => {
  assert.equal(weather.locationLabel({ city: 'Portland', region: 'OR' }), 'Portland, OR');
});

test('worker ZIP coordinates satisfy the location contract', () => {
  const payload = { coord: { lat: 39.53, lon: -119.81 }, name: 'Reno' };
  assert.equal(weather.validCoordinates(payload.coord), true);
});

test('public API does not expose coordinate formatting or logging helpers', () => {
  assert.equal('formatCoordinates' in weather, false);
  assert.equal('logLocation' in weather, false);
});

test('weather rendering does not use unsafe innerHTML', () => {
  assert.doesNotMatch(pageScript, /\.innerHTML\s*=/);
});

test('location requests keep coordinates out of the visible page URL', () => {
  assert.doesNotMatch(pageScript, /history\.(?:pushState|replaceState)|location\.search/);
  assert.doesNotMatch(pageHtml, /[?&](?:lat|lon|zip)=/);
});

test('request generation prevents an older response from rendering', () => {
  assert.match(pageScript, /const requestId = \+\+activeRequest/);
  assert.match(pageScript, /if \(requestId !== activeRequest\) return false/);
});

test('current weather and forecast settle independently', () => {
  assert.match(pageScript, /Promise\.allSettled/);
  assert.match(pageScript, /freshCurrent \|\| \(cached && cached\.current\)/);
  assert.match(pageScript, /freshForecast \|\| \(cached && cached\.forecast\)/);
});

test('saved location is never cleared on a failed request', () => {
  assert.doesNotMatch(pageScript, /removeItem\(LOCATION_KEY\)/);
  assert.match(pageScript, /Your saved location is still available/);
});

test('manual search remains bound after failures', () => {
  assert.match(pageScript, /locationForm\.addEventListener\('submit', submitSearch\)/);
  assert.doesNotMatch(pageScript, /locationForm\.removeEventListener/);
});

test('geolocation remains available with bounded privacy-conscious options', () => {
  assert.match(pageScript, /getCurrentPosition/);
  assert.match(pageScript, /enableHighAccuracy: false/);
});

test('daily disclosures are native buttons with exclusive expansion', () => {
  assert.match(pageScript, /button\.setAttribute\('aria-expanded', 'false'\)/);
  assert.match(pageScript, /querySelectorAll\('\.daily-toggle'\)/);
});

test('official external links do not include location data', () => {
  const urls = [...pageHtml.matchAll(/href="(https:\/\/[^"]+)"/g)].map((match) => match[1]);
  assert.ok(urls.length >= 5);
  urls.forEach((url) => assert.doesNotMatch(url, /[?&](?:lat|lon|zip)=/));
});

test('all five official weather tools render as cards', () => {
  const cards = [...pageHtml.matchAll(/class="resource-card"/g)];
  assert.equal(cards.length, 5);
  [
    'Current weather alerts',
    'National radar',
    'Storm outlooks',
    'Hurricane center',
    'Fire and smoke map'
  ].forEach((title) => assert.match(pageHtml, new RegExp(title)));
});

test('official tool cards use safe external-link attributes', () => {
  const cards = [...pageHtml.matchAll(/<a class="resource-card"[^>]+>/g)].map((match) => match[0]);
  assert.equal(cards.length, 5);
  cards.forEach((card) => {
    assert.match(card, /target="_blank"/);
    assert.match(card, /rel="noopener noreferrer"/);
  });
});
