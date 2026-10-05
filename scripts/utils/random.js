export function randomFloat(random = Math.random) {
  return random();
}

export function randomInt(max, random = Math.random) {
  return Math.floor(randomFloat(random) * Math.max(1, Number(max ?? 1)));
}

export function chance(probability, random = Math.random) {
  const value = Number(probability ?? 0);
  if (value <= 0) return false;
  if (value >= 1) return true;
  return randomFloat(random) < value;
}

export function d6(random = Math.random) {
  return randomInt(6, random) + 1;
}

export function roll3d6(random = Math.random) {
  return d6(random) + d6(random) + d6(random);
}

export function randomChoice(items, random = Math.random) {
  if (!items?.length) return null;
  return items[randomInt(items.length, random)];
}

export function uid(prefix = "id") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
