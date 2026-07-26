"use strict";

const fs = require("fs/promises");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(__dirname, "config", "market-links.json");
const DATA_PATH = path.join(ROOT, "pages", "relay", "pulse-data.json");
const FETCH_TIMEOUT_MS = 15000;

function formatValue(value, format) {
  const options = {
    minimumFractionDigits: format === "currency-whole" ? 0 : 2,
    maximumFractionDigits: format === "currency-whole" ? 0 : 2
  };
  const number = new Intl.NumberFormat("en-US", options).format(value);

  if (format === "currency" || format === "currency-whole") return `$${number}`;
  if (format === "percent") return `${number}%`;
  return number;
}

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function movementFields(currentValue, previousValue, observationTime, previousObservationTime, comparisonBasis) {
  const canCompare = Number.isFinite(currentValue) && Number.isFinite(previousValue);
  const change = canCompare ? currentValue - previousValue : null;
  const changePercent = canCompare && previousValue !== 0
    ? (change / previousValue) * 100
    : null;
  const direction = !canCompare || change === 0
    ? "neutral"
    : change > 0 ? "up" : "down";
  return {
    previous_numeric_value: canCompare ? previousValue : null,
    change,
    change_percent: changePercent,
    direction,
    observation_time: observationTime || null,
    previous_observation_time: previousObservationTime || null,
    comparison_basis: canCompare ? comparisonBasis || null : null
  };
}

async function fetchJson(url, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      headers: { "User-Agent": "Notavello Relay Pulse/1.0" },
      signal: controller.signal
    });
    if (!response.ok) {
      let detail = "";
      try {
        const body = await response.json();
        detail = body.error_message || body.message || body.error || "";
      } catch {
        detail = "";
      }
      const error = new Error(detail || "Request failed");
      error.httpStatus = response.status;
      throw error;
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeSourceError(error, fredApiKey) {
  let message = error?.message || "Unknown source error";
  if (fredApiKey) message = message.split(fredApiKey).join("[REDACTED]");
  message = message
    .replace(/api_key=([^&\s]+)/gi, "api_key=[REDACTED]")
    .replace(/https?:\/\/\S+/gi, "[request URL redacted]");
  return error?.httpStatus ? `HTTP ${error.httpStatus}: ${message}` : message;
}

function logFredKeyPresence(fredApiKey = process.env.FRED_API_KEY) {
  console.log(fredApiKey
    ? "FRED_API_KEY is present"
    : "FRED_API_KEY is missing");
}

async function fetchFred(item, fetchImpl, fredApiKey) {
  if (!fredApiKey) throw new Error("FRED_API_KEY is not set");
  const query = new URLSearchParams({
    series_id: item.series_id,
    api_key: fredApiKey,
    file_type: "json",
    sort_order: "desc",
    limit: "10"
  });
  const data = await fetchJson(
    `https://api.stlouisfed.org/fred/series/observations?${query}`,
    fetchImpl
  );
  const observations = (data.observations || [])
    .map((entry) => ({ ...entry, numericValue: finiteNumber(entry.value) }))
    .filter((entry) => entry.value !== "." && Number.isFinite(entry.numericValue));
  const [observation, previousObservation] = observations;
  if (!observation) throw new Error("No numeric FRED observation returned");

  return {
    rawValue: observation.numericValue,
    previousRawValue: previousObservation?.numericValue ?? null,
    observationDate: observation.date,
    observationTime: `${observation.date}T00:00:00.000Z`,
    previousObservationTime: previousObservation ? `${previousObservation.date}T00:00:00.000Z` : null,
    comparisonBasis: "previous_observation"
  };
}

async function fetchYahooFinance(item, fetchImpl) {
  const symbol = encodeURIComponent(item.symbol);
  const data = await fetchJson(
    `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=5d`,
    fetchImpl
  );
  const meta = data.chart?.result?.[0]?.meta;
  if (!Number.isFinite(meta?.regularMarketPrice)) {
    throw new Error("No numeric Yahoo Finance quote returned");
  }

  const marketTime = finiteNumber(meta.regularMarketTime);
  const previousClose = finiteNumber(meta.chartPreviousClose);
  return {
    rawValue: meta.regularMarketPrice,
    previousRawValue: previousClose > 0 ? previousClose : null,
    observationDate: Number.isFinite(marketTime)
      ? new Date(marketTime * 1000).toISOString().slice(0, 10)
      : null,
    observationTime: Number.isFinite(marketTime)
      ? new Date(marketTime * 1000).toISOString()
      : null,
    previousObservationTime: null,
    comparisonBasis: "previous_close"
  };
}

async function fetchCoinbase(item, fetchImpl, now) {
  const spotData = await fetchJson(
    `https://api.coinbase.com/v2/prices/${item.product_id}/spot`,
    fetchImpl
  );
  const rawValue = finiteNumber(spotData.data?.amount);
  if (!Number.isFinite(rawValue)) throw new Error("No numeric Coinbase spot price returned");

  let previousRawValue = null;
  try {
    const statsData = await fetchJson(
      `https://api.exchange.coinbase.com/products/${item.product_id}/stats`,
      fetchImpl
    );
    const open = finiteNumber(statsData.open);
    if (open > 0) previousRawValue = open;
  } catch {
    // The current spot value remains usable when optional 24-hour stats fail.
  }

  return {
    rawValue,
    previousRawValue,
    observationDate: now.toISOString().slice(0, 10),
    observationTime: now.toISOString(),
    previousObservationTime: null,
    comparisonBasis: "rolling_24_hour_open"
  };
}

async function fetchPulseItem(item, fetchImpl, fredApiKey, now) {
  if (item.provider === "fred") return fetchFred(item, fetchImpl, fredApiKey);
  if (item.provider === "yahoo-finance") return fetchYahooFinance(item, fetchImpl);
  if (item.provider === "coinbase") return fetchCoinbase(item, fetchImpl, now);
  throw new Error(`Unsupported provider: ${item.provider}`);
}

function unavailableRecord(item) {
  return {
    id: item.id,
    raw_value: null,
    previous_numeric_value: null,
    change: null,
    change_percent: null,
    direction: "neutral",
    observation_time: null,
    previous_observation_time: null,
    comparison_basis: null,
    formatted_value: "—",
    observation_date: null,
    fetched_at: null,
    source: item.source,
    status: "unavailable",
    frequency: item.frequency,
    units: item.units
  };
}

async function buildPulseData({
  config,
  previousData,
  fetchImpl = fetch,
  fredApiKey = process.env.FRED_API_KEY,
  now = new Date()
}) {
  const previousItems = new Map(
    (Array.isArray(previousData?.items) ? previousData.items : []).map((item) => [item.id, item])
  );
  const configuredItems = config.groups.flatMap((group) => group.links);

  const items = await Promise.all(configuredItems.map(async (item) => {
    try {
      const result = await fetchPulseItem(item, fetchImpl, fredApiKey, now);
      if (!Number.isFinite(result.rawValue)) throw new Error("Source returned a non-numeric value");
      return {
        id: item.id,
        raw_value: result.rawValue,
        formatted_value: formatValue(result.rawValue, item.format),
        ...movementFields(
          result.rawValue,
          result.previousRawValue,
          result.observationTime,
          result.previousObservationTime,
          result.comparisonBasis
        ),
        observation_date: result.observationDate,
        fetched_at: now.toISOString(),
        source: item.source,
        status: "ok",
        frequency: item.frequency,
        units: item.units
      };
    } catch (error) {
      console.error(
        `Pulse source failed: item=${item.id} provider=${item.provider} error=${sanitizeSourceError(error, fredApiKey)}`
      );
      const previous = previousItems.get(item.id);
      if (previous?.raw_value !== null && Number.isFinite(previous?.raw_value)) {
        return {
          ...previous,
          ...movementFields(
            previous.raw_value,
            finiteNumber(previous.previous_numeric_value),
            previous.observation_time,
            previous.previous_observation_time,
            previous.comparison_basis
          ),
          source: item.source,
          status: "stale",
          frequency: item.frequency,
          units: item.units
        };
      }
      return unavailableRecord(item);
    }
  }));

  const okCount = items.filter((item) => item.status === "ok").length;
  const staleCount = items.filter((item) => item.status === "stale").length;
  const latestSuccessAt = items
    .map((item) => item.fetched_at)
    .filter(Boolean)
    .sort()
    .at(-1) || previousData?.latest_success_at || null;
  return {
    schema_version: "1.1",
    description: "Last-known-good normalized values for the Relay Pulse sidebar.",
    checked_at: now.toISOString(),
    latest_success_at: latestSuccessAt,
    status: okCount === items.length
      ? "ok"
      : okCount > 0
        ? "partial"
        : staleCount > 0
          ? "stale"
          : "unavailable",
    items
  };
}

async function writeJsonAtomic(filePath, data) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function run() {
  logFredKeyPresence();
  const config = await readJson(CONFIG_PATH);
  const previousData = await readJson(DATA_PATH, { items: [] });
  const data = await buildPulseData({ config, previousData });

  await writeJsonAtomic(DATA_PATH, data);

  const counts = data.items.reduce((result, item) => {
    result[item.status] = (result[item.status] || 0) + 1;
    return result;
  }, {});
  console.log(`Pulse updated: ${JSON.stringify(counts)}`);
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`Pulse update failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  buildPulseData,
  fetchCoinbase,
  fetchFred,
  fetchYahooFinance,
  finiteNumber,
  formatValue,
  movementFields,
  logFredKeyPresence,
  sanitizeSourceError,
  writeJsonAtomic
};
