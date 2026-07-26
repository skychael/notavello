"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  buildPulseData,
  fetchCoinbase,
  fetchFred,
  fetchYahooFinance,
  finiteNumber,
  movementFields
} = require("./update-pulse");

function jsonResponse(data) {
  return {
    ok: true,
    json: async () => data
  };
}

test("movementFields reports an increase", () => {
  const result = movementFields(110, 100, "2026-07-26", "2026-07-25", "previous_observation");
  assert.equal(result.direction, "up");
  assert.equal(result.change, 10);
  assert.equal(result.change_percent, 10);
});

test("movementFields reports a decrease", () => {
  const result = movementFields(75, 100, null, null, "previous_close");
  assert.equal(result.direction, "down");
  assert.equal(result.change, -25);
  assert.equal(result.change_percent, -25);
});

test("movementFields reports equality as neutral", () => {
  const result = movementFields(100, 100, null, null, "previous_observation");
  assert.equal(result.direction, "neutral");
  assert.equal(result.change, 0);
  assert.equal(result.change_percent, 0);
});

test("movementFields safely handles unavailable comparison data and zero", () => {
  const missing = movementFields(100, null, null, null, null);
  assert.equal(missing.direction, "neutral");
  assert.equal(missing.change, null);
  assert.equal(missing.change_percent, null);

  const zero = movementFields(100, 0, null, null, "previous_observation");
  assert.equal(zero.direction, "up");
  assert.equal(zero.change, 100);
  assert.equal(zero.change_percent, null);
});

test("finiteNumber rejects null, blank, malformed, and nonfinite values", () => {
  assert.equal(finiteNumber(null), null);
  assert.equal(finiteNumber(""), null);
  assert.equal(finiteNumber("not-a-number"), null);
  assert.equal(finiteNumber(Infinity), null);
  assert.equal(finiteNumber("42.5"), 42.5);
});

test("FRED adapter selects the latest two valid observations", async () => {
  let requestedUrl = "";
  const result = await fetchFred(
    { series_id: "SP500" },
    async (url) => {
      requestedUrl = url;
      return jsonResponse({
        observations: [
          { date: "2026-07-25", value: "110" },
          { date: "2026-07-24", value: "." },
          { date: "2026-07-23", value: "100" }
        ]
      });
    },
    "test-key"
  );
  assert.match(requestedUrl, /sort_order=desc/);
  assert.equal(result.rawValue, 110);
  assert.equal(result.previousRawValue, 100);
  assert.equal(result.previousObservationTime, "2026-07-23T00:00:00.000Z");
});

test("Yahoo adapter compares the current quote with previous close", async () => {
  const result = await fetchYahooFinance(
    { symbol: "GC=F" },
    async () => jsonResponse({
      chart: { result: [{ meta: {
        regularMarketPrice: 210,
        chartPreviousClose: 200,
        regularMarketTime: 1785081600
      } }] }
    })
  );
  assert.equal(result.rawValue, 210);
  assert.equal(result.previousRawValue, 200);
  assert.equal(result.comparisonBasis, "previous_close");
});

test("Yahoo adapter leaves malformed or zero prior close unavailable", async () => {
  for (const chartPreviousClose of [null, "", "bad", 0]) {
    const result = await fetchYahooFinance(
      { symbol: "GC=F" },
      async () => jsonResponse({
        chart: { result: [{ meta: {
          regularMarketPrice: 210,
          chartPreviousClose,
          regularMarketTime: 1785081600
        } }] }
      })
    );
    assert.equal(result.previousRawValue, null);
  }
});

test("Coinbase adapter compares last price with rolling 24-hour open", async () => {
  const responses = [
    jsonResponse({ data: { amount: "95000" } }),
    jsonResponse({ last: "94990", open: "100000" })
  ];
  const result = await fetchCoinbase(
    { product_id: "BTC-USD" },
    async () => responses.shift(),
    new Date("2026-07-26T12:00:00Z")
  );
  assert.equal(result.rawValue, 95000);
  assert.equal(result.previousRawValue, 100000);
  assert.equal(result.comparisonBasis, "rolling_24_hour_open");
});

test("Coinbase preserves spot price when optional stats fail", async () => {
  let request = 0;
  const result = await fetchCoinbase(
    { product_id: "BTC-USD" },
    async () => {
      request += 1;
      if (request === 1) return jsonResponse({ data: { amount: "95000" } });
      throw new Error("stats unavailable");
    },
    new Date("2026-07-26T12:00:00Z")
  );
  assert.equal(result.rawValue, 95000);
  assert.equal(result.previousRawValue, null);
});

test("public pulse build keeps a current value when comparison data fails", async () => {
  let request = 0;
  const data = await buildPulseData({
    config: {
      groups: [{
        links: [{
          id: "bitcoin",
          provider: "coinbase",
          product_id: "BTC-USD",
          source: "Coinbase",
          frequency: "Current spot quote",
          units: "U.S. dollars per bitcoin",
          format: "currency-whole"
        }]
      }]
    },
    previousData: { items: [] },
    fetchImpl: async () => {
      request += 1;
      if (request === 1) return jsonResponse({ data: { amount: "95000" } });
      throw new Error("stats unavailable");
    },
    now: new Date("2026-07-26T12:00:00Z")
  });
  assert.equal(data.schema_version, "1.1");
  assert.equal(data.status, "ok");
  assert.equal(data.items[0].raw_value, 95000);
  assert.equal(data.items[0].formatted_value, "$95,000");
  assert.equal(data.items[0].direction, "neutral");
  assert.equal(data.items[0].change, null);
  assert.equal(data.items[0].change_percent, null);
  assert.doesNotMatch(JSON.stringify(data), /NaN|Infinity/);
});
