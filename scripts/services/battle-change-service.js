import { CombatantRules } from "../rules/combatant-rules.js";

const ALL_PARTS = Object.freeze(["fleet", "board", "summary", "controls"]);
const VALID_PARTS = new Set(ALL_PARTS);

const PARTS_BY_REASON = Object.freeze({
  "clear-battle-log": ["fleet"],
  "save-battle-snapshot-log": ["fleet", "controls"],
  "set-ammo": ["board", "summary", "controls"],
  "set-fire-mode": ["board", "summary", "controls"],
  "set-order": ["fleet", "summary", "controls"],
  "assign-ship-player": ["fleet", "summary", "controls"],
  "unassign-ship-player": ["fleet", "summary", "controls"],
  "approve-pending-order": ["fleet", "summary", "controls"],
  "reject-pending-order": ["fleet", "summary", "controls"],
  "socket-submit-order": ["fleet", "summary", "controls"]
});

function stableString(value) {
  return JSON.stringify(value ?? null);
}

function publicFlags(unit) {
  return {
    struck: Boolean(unit?.flags?.struck),
    withdrawn: Boolean(unit?.flags?.withdrawn),
    falling: Boolean(unit?.flags?.falling),
    coreExploded: Boolean(unit?.flags?.coreExploded),
    abandoned: Boolean(unit?.flags?.abandoned),
    camouflaged: Number(unit?.flags?.camouflaged ?? 0)
  };
}

function visibilitySignature(battle) {
  return stableString({
    round: Number(battle?.round ?? 1),
    phase: String(battle?.phase ?? "orders"),
    mode: String(battle?.setup?.mode ?? "sea"),
    sea: {
      state: String(battle?.sea?.state ?? "calm"),
      visibility: String(battle?.sea?.visibility ?? "clear")
    },
    assignments: battle?.playerAssignments ?? {},
    units: (battle?.ships ?? []).map(unit => ({
      id: String(unit?.id ?? ""),
      unitType: String(unit?.unitType ?? "ship"),
      side: String(unit?.side ?? ""),
      x: Number(unit?.x ?? 0),
      y: Number(unit?.y ?? 0),
      heading: Number(unit?.heading ?? 0),
      altitude: Number(unit?.altitude ?? 0),
      sizeModifier: Number(unit?.stats?.sm ?? 7),
      operational: CombatantRules.isOperational(unit),
      flags: publicFlags(unit)
    }))
  });
}

function normalizedParts(parts) {
  const clean = [...new Set((parts ?? []).filter(part => VALID_PARTS.has(part)))];
  return clean.length ? clean : [...ALL_PARTS];
}

export class BattleChangeService {
  static ALL_PARTS = ALL_PARTS;

  static analyze(previousBattle, nextBattle, { reason = "", fullReplace = false, renderParts = null } = {}) {
    const normalizedReason = String(reason ?? "").trim();
    const parts = normalizedParts(renderParts ?? (fullReplace ? ALL_PARTS : PARTS_BY_REASON[normalizedReason]));
    const visibilityDirty = fullReplace
      || !previousBattle
      || visibilitySignature(previousBattle) !== visibilitySignature(nextBattle);

    return {
      reason: normalizedReason,
      fullReplace: Boolean(fullReplace),
      visibilityDirty,
      renderParts: parts
    };
  }

  static normalizeRenderParts(parts) {
    return normalizedParts(parts);
  }
}
