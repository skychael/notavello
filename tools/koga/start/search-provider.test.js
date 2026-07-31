"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const searchProvider = require("./search-provider.js");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
const pageScript = fs.readFileSync(path.join(__dirname, "script.js"), "utf8");

function memoryStorage(initial) {
  const values = new Map(initial ? [[searchProvider.STORAGE_KEY, initial]] : []);
  return {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
    value() { return values.get(searchProvider.STORAGE_KEY); }
  };
}

test("provider selection recognizes only supported providers", () => {
  for (const provider of ["google", "duckduckgo", "bing", "yahoo"]) {
    assert.equal(searchProvider.validProvider(provider), true);
  }
  assert.equal(searchProvider.validProvider("example"), false);
});

test("page renders an accessible selector and wires provider changes", () => {
  assert.match(html, /<label for="search-provider">Search with<\/label>/);
  assert.deepEqual(
    [...html.matchAll(/<option value="([^"]+)">/g)].map((match) => match[1]),
    ["google", "duckduckgo", "bing", "yahoo"]
  );
  assert.match(pageScript, /searchProviderSelect\.addEventListener\("change"/);
  assert.match(pageScript, /searchProvider\.saveProvider\(localStorage, searchProviderSelect\.value\)/);
});

test("saved provider defaults to Google and falls back from invalid data", () => {
  assert.equal(searchProvider.savedProvider(memoryStorage()), "google");
  assert.equal(searchProvider.savedProvider(memoryStorage("example")), "google");
  assert.equal(searchProvider.savedProvider({
    getItem() { throw new Error("Storage unavailable"); }
  }), "google");
});

test("provider preference persists in local storage", () => {
  const storage = memoryStorage();
  assert.equal(searchProvider.saveProvider(storage, "bing"), "bing");
  assert.equal(storage.value(), "bing");
  assert.equal(searchProvider.savedProvider(storage), "bing");
});

test("provider persistence tolerates unavailable storage", () => {
  assert.equal(searchProvider.saveProvider({
    setItem() { throw new Error("Storage unavailable"); }
  }, "yahoo"), "yahoo");
});

test("search URLs use each provider query field and encode the query", () => {
  const query = "Koga browser & privacy?";
  assert.equal(searchProvider.searchUrl("google", query), "https://www.google.com/search?q=Koga+browser+%26+privacy%3F");
  assert.equal(searchProvider.searchUrl("duckduckgo", query), "https://duckduckgo.com/?q=Koga+browser+%26+privacy%3F");
  assert.equal(searchProvider.searchUrl("bing", query), "https://www.bing.com/search?q=Koga+browser+%26+privacy%3F");
  assert.equal(searchProvider.searchUrl("yahoo", query), "https://search.yahoo.com/search?p=Koga+browser+%26+privacy%3F");
});

test("URL construction falls back to Google for an unsupported provider", () => {
  assert.equal(searchProvider.searchUrl("example", "fallback"), "https://www.google.com/search?q=fallback");
});

test("form submission navigates through encoded provider URL construction", () => {
  assert.match(pageScript, /searchForm\.addEventListener\("submit"/);
  assert.match(pageScript, /window\.location\.assign\(searchProvider\.searchUrl\(searchProviderSelect\.value, searchInput\.value\)\)/);
});
