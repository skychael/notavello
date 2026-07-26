(function (root, factory) {
  "use strict";

  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.KogaWeatherLocation = api;
}(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const optionalTextFields = ["city", "state", "region", "zip", "postalCode", "country"];

  function cleanText(value, maxLength = 160) {
    return typeof value === "string" && value.trim()
      ? value.trim().slice(0, maxLength)
      : "";
  }

  function normalizeWeatherLocation(value, now = Date.now()) {
    if (!value || typeof value !== "object") return null;
    const lat = Number(value.lat);
    const lon = Number(value.lon);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) return null;
    const location = {
      lat,
      lon,
      label: cleanText(value.label || value.displayName || value.city || value.zip || value.postalCode),
      savedAt: Number.isFinite(value.savedAt) ? value.savedAt : now
    };
    optionalTextFields.forEach((field) => {
      const cleaned = cleanText(value[field], 100);
      if (cleaned) location[field] = cleaned;
    });
    if (typeof value.timezone === "string") {
      const timezone = cleanText(value.timezone, 100);
      if (timezone) location.timezone = timezone;
    } else if (Number.isFinite(value.timezone)) {
      location.timezone = value.timezone;
    }
    return location;
  }

  return { normalizeWeatherLocation };
}));
