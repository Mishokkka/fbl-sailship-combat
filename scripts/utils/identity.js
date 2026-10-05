import { boundedString } from "./schema.js";

export function uniqueId(base, used, { prefix = "id", maxLength = 128 } = {}) {
  let stem = boundedString(base, { fallback: prefix, maxLength }) || prefix;
  if (!used.has(stem)) {
    used.add(stem);
    return stem;
  }
  for (let index = 2; index < 100000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${stem.slice(0, Math.max(1, maxLength - suffix.length))}${suffix}`;
    if (used.has(candidate)) continue;
    used.add(candidate);
    return candidate;
  }
  const fallback = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`.slice(0, maxLength);
  used.add(fallback);
  return fallback;
}

export function repairUniqueIds(items, {
  getId = item => item?.id,
  setId = (item, id) => { item.id = id; },
  prefix = "id",
  maxLength = 128
} = {}) {
  const used = new Set();
  const repairs = [];
  for (let index = 0; index < (items?.length ?? 0); index += 1) {
    const item = items[index];
    const requested = boundedString(getId(item), { fallback: `${prefix}-${index + 1}`, maxLength }) || `${prefix}-${index + 1}`;
    const id = uniqueId(requested, used, { prefix, maxLength });
    if (id !== requested) repairs.push({ index, from: requested, to: id });
    setId(item, id);
  }
  return repairs;
}

export function assertUniqueIds(items, {
  getId = item => item?.id,
  label = "Элементы",
  allowMissing = true,
  maxLength = 128
} = {}) {
  const seen = new Map();
  for (let index = 0; index < (items?.length ?? 0); index += 1) {
    const raw = getId(items[index]);
    const id = boundedString(raw, { maxLength });
    if (!id) {
      if (!allowMissing) throw new Error(`${label}: у элемента #${index + 1} отсутствует id.`);
      continue;
    }
    if (seen.has(id)) {
      throw new Error(`${label}: повторяющийся id «${id}» у элементов #${seen.get(id) + 1} и #${index + 1}.`);
    }
    seen.set(id, index);
  }
  return true;
}
