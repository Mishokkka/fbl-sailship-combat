export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function finiteNumber(value, {
  fallback = 0,
  min = Number.NEGATIVE_INFINITY,
  max = Number.POSITIVE_INFINITY,
  integer = false
} = {}) {
  const parsed = Number(value);
  const fallbackNumber = Number(fallback);
  const safeFallback = Number.isFinite(fallbackNumber) ? fallbackNumber : 0;
  const safe = Number.isFinite(parsed) ? parsed : safeFallback;
  const bounded = Math.max(min, Math.min(max, safe));
  return integer ? Math.round(bounded) : bounded;
}

export function boundedInteger(value, options = {}) {
  return finiteNumber(value, { ...options, integer: true });
}

export function boundedString(value, {
  fallback = "",
  maxLength = 256,
  trim = true
} = {}) {
  let text = value == null ? String(fallback ?? "") : String(value);
  if (trim) text = text.trim();
  return text.slice(0, Math.max(0, Number(maxLength) || 0));
}

export function enumValue(value, allowed, fallback) {
  const values = allowed instanceof Set ? allowed : new Set(allowed ?? []);
  return values.has(value) ? value : fallback;
}

export function boundedArray(value, { maxLength = 200 } = {}) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, Math.max(0, Number(maxLength) || 0));
}

export function plainRecord(value) {
  return isPlainObject(value) ? value : {};
}

export function uniqueBoundedStrings(values, {
  maxItems = 200,
  maxLength = 128
} = {}) {
  const result = [];
  const seen = new Set();
  for (const value of boundedArray(values, { maxLength: maxItems })) {
    const text = boundedString(value, { maxLength });
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

export function hasOnlyKeys(value, allowedKeys) {
  if (!isPlainObject(value)) return false;
  const allowed = allowedKeys instanceof Set ? allowedKeys : new Set(allowedKeys ?? []);
  return Object.keys(value).every(key => allowed.has(key));
}

export function utf8ByteLength(value) {
  const text = String(value ?? "");
  if (typeof TextEncoder === "function") return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

export function jsonSize(value) {
  if (typeof value === "string") return utf8ByteLength(value);
  let serialized;
  try {
    serialized = JSON.stringify(value);
  } catch (error) {
    return Number.POSITIVE_INFINITY;
  }
  return utf8ByteLength(serialized);
}
