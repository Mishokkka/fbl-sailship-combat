import { DamageEngine } from "./damage-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { getCombatants, getCombatantsForSide, getOperationalCombatants } from "../utils/combatants.js";

const VICTORY_MODES = new Set(["decision", "escape"]);
const EXIT_EDGES = new Set(["left", "right", "top", "bottom"]);

function clamp(value, min, max, fallback = min) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function sideIdsForBattle(battle) {
  const configured = Array.isArray(battle?.setup?.sideOrder) ? battle.setup.sideOrder : [];
  const fromShips = getCombatants(battle).map(unit => unit?.side).filter(Boolean);
  return [...new Set([...configured, ...fromShips].map(String).filter(Boolean))];
}

function sideName(battle, sideId) {
  return String(battle?.setup?.sides?.[sideId]?.name ?? sideId ?? "сторона");
}

function scoreRecord(scores) {
  return Object.fromEntries(Object.entries(scores ?? {}).map(([sideId, score]) => [sideId, Math.round(Number(score ?? 0) * 10) / 10]));
}

export class VictoryEngine {
  static defaultConfig(sideIds = ["blue", "red"]) {
    return {
      enabled: true,
      mode: "decision",
      roundLimit: 30,
      decisionMargin: 0.15,
      objectiveSideId: sideIds[0] ?? "blue",
      exitEdge: "right",
      requiredShips: 1,
      deferUntilRound: 0,
      initialStrength: {},
      initialShipCount: {}
    };
  }

  static normalizeConfig(config, sideIds = ["blue", "red"]) {
    const source = config && typeof config === "object" && !Array.isArray(config) ? config : {};
    const fallback = this.defaultConfig(sideIds);
    const objectiveSideId = sideIds.includes(String(source.objectiveSideId))
      ? String(source.objectiveSideId)
      : fallback.objectiveSideId;
    const initialStrength = {};
    const initialShipCount = {};
    for (const sideId of sideIds) {
      initialStrength[sideId] = clamp(source.initialStrength?.[sideId], 0, 1_000_000, 0);
      initialShipCount[sideId] = Math.round(clamp(source.initialShipCount?.[sideId], 0, 200, 0));
    }
    return {
      enabled: source.enabled !== false,
      mode: VICTORY_MODES.has(String(source.mode)) ? String(source.mode) : fallback.mode,
      roundLimit: Math.round(clamp(source.roundLimit, 1, 200, fallback.roundLimit)),
      decisionMargin: clamp(source.decisionMargin, 0, 1, fallback.decisionMargin),
      objectiveSideId,
      exitEdge: EXIT_EDGES.has(String(source.exitEdge)) ? String(source.exitEdge) : fallback.exitEdge,
      requiredShips: Math.round(clamp(source.requiredShips, 1, 200, fallback.requiredShips)),
      deferUntilRound: Math.round(clamp(source.deferUntilRound, 0, 1_000_000, 0)),
      initialStrength,
      initialShipCount
    };
  }

  static normalizeBattleState(battle) {
    const sideIds = sideIdsForBattle(battle);
    battle.setup ??= {};
    battle.setup.victory = this.normalizeConfig(battle.setup.victory, sideIds);
    if (!battle.outcome || typeof battle.outcome !== "object" || battle.outcome.resolved !== true) {
      delete battle.outcome;
    } else {
      const winnerSideId = sideIds.includes(String(battle.outcome.winnerSideId)) ? String(battle.outcome.winnerSideId) : null;
      battle.outcome = {
        resolved: true,
        reason: ["elimination", "decision", "draw", "escape", "escapeDenied"].includes(battle.outcome.reason)
          ? battle.outcome.reason
          : "decision",
        winnerSideId,
        round: Math.round(clamp(battle.outcome.round, 1, 1_000_000, battle.round ?? 1)),
        title: String(battle.outcome.title ?? "Бой завершён").slice(0, 256),
        summary: String(battle.outcome.summary ?? "").slice(0, 1000),
        scores: scoreRecord(battle.outcome.scores),
        timestamp: clamp(battle.outcome.timestamp, 0, Number.MAX_SAFE_INTEGER, 0)
      };
    }
    const hasBaseline = Object.values(battle.setup.victory.initialShipCount ?? {}).some(value => Number(value) > 0);
    if (battle.setupConfirmed && !battle.outcome?.resolved && !hasBaseline && getOperationalCombatants(battle).length) this.captureInitialStrength(battle);
  }

  static shipStrength(ship) {
    return CombatantRules.getVictoryStrength(ship, {
      clamp,
      totalHp: unit => DamageEngine.totalHp(unit),
      totalFire: unit => DamageEngine.getTotalFire(unit),
      totalFlooding: unit => DamageEngine.getTotalFlooding(unit)
    });
  }

  static captureInitialStrength(battle) {
    const sideIds = sideIdsForBattle(battle);
    battle.setup ??= {};
    battle.setup.victory = this.normalizeConfig(battle.setup.victory, sideIds);
    battle.setup.victory.initialStrength = {};
    battle.setup.victory.initialShipCount = {};
    for (const sideId of sideIds) {
      const ships = getCombatantsForSide(battle, sideId, { activeOnly: true });
      battle.setup.victory.initialStrength[sideId] = ships.reduce((sum, ship) => sum + this.shipStrength(ship), 0);
      battle.setup.victory.initialShipCount[sideId] = ships.length;
    }
    if (battle.setup.victory.mode === "escape") {
      const available = Number(battle.setup.victory.initialShipCount[battle.setup.victory.objectiveSideId] ?? 0);
      if (available > 0) battle.setup.victory.requiredShips = Math.min(battle.setup.victory.requiredShips, available);
    }
    battle.setup.victory.deferUntilRound = 0;
    delete battle.outcome;
    return battle.setup.victory;
  }

  static isAtExitEdge(ship, board, edge) {
    const x = Number(ship?.x ?? -1);
    const y = Number(ship?.y ?? -1);
    if (edge === "left") return x <= 0;
    if (edge === "right") return x >= Number(board?.width ?? 0) - 1;
    if (edge === "top") return y <= 0;
    return y >= Number(board?.height ?? 0) - 1;
  }

  static processWithdrawals(battle) {
    const sideIds = sideIdsForBattle(battle);
    const config = this.normalizeConfig(battle?.setup?.victory, sideIds);
    if (!config.enabled || config.mode !== "escape") return [];
    const entries = [];
    for (const ship of getCombatants(battle)) {
      if (!CombatantRules.supports(ship, "victory")) continue;
      if (ship.side !== config.objectiveSideId || ship.flags?.struck || ship.flags?.withdrawn) continue;
      if (!this.isAtExitEdge(ship, battle.board, config.exitEdge)) continue;
      ship.flags ??= {};
      ship.flags.withdrawn = true;
      ship.flags.withdrawnRound = Number(battle.round ?? 1);
      ship.flags.struck = true;
      entries.push(`${ship.name}: выходит из зоны боя и считается успешно отведённым.`);
    }
    return entries;
  }

  static sideScores(battle, config = battle?.setup?.victory) {
    const sideIds = sideIdsForBattle(battle);
    const normalized = this.normalizeConfig(config, sideIds);
    const scores = {};
    for (const sideId of sideIds) {
      const current = getCombatantsForSide(battle, sideId)
        .filter(ship => CombatantRules.supports(ship, "victory"))
        .reduce((sum, ship) => sum + this.shipStrength(ship), 0);
      const initial = Number(normalized.initialStrength?.[sideId] ?? 0);
      scores[sideId] = initial > 0 ? current / initial * 100 : current;
    }
    return scoreRecord(scores);
  }

  static evaluate(battle) {
    const sideIds = sideIdsForBattle(battle);
    const config = this.normalizeConfig(battle?.setup?.victory, sideIds);
    if (!config.enabled || sideIds.length < 2) return { resolved: false };

    const participatingSides = sideIds.filter(sideId => {
      const initialCount = Number(config.initialShipCount?.[sideId] ?? 0);
      return initialCount > 0 || getCombatants(battle).some(ship => ship.side === sideId);
    });
    if (participatingSides.length < 2) return { resolved: false };
    const activeSides = participatingSides.filter(sideId => getCombatantsForSide(battle, sideId, { activeOnly: true }).length > 0);
    const scores = this.sideScores(battle, config);
    const round = Number(battle.round ?? 1);
    if (round < config.deferUntilRound) return { resolved: false };

    if (config.mode === "escape") {
      const withdrawn = getCombatantsForSide(battle, config.objectiveSideId).filter(ship => ship.flags?.withdrawn).length;
      if (withdrawn >= config.requiredShips) {
        const name = sideName(battle, config.objectiveSideId);
        return this.outcome("escape", config.objectiveSideId, round, scores, `${name}: прорыв выполнен`, `${withdrawn} боевых единиц успешно вышло из зоны боя при требовании ${config.requiredShips}.`);
      }
      const objectiveActive = activeSides.includes(config.objectiveSideId);
      if (!objectiveActive || round >= config.roundLimit) {
        const activeDefenders = activeSides.filter(sideId => sideId !== config.objectiveSideId);
        const participatingDefenders = participatingSides.filter(sideId => sideId !== config.objectiveSideId);
        const winner = activeDefenders.length === 1 ? activeDefenders[0] : null;
        const remainingNames = activeDefenders.map(sideId => sideName(battle, sideId));
        const title = winner ? `${sideName(battle, winner)}: прорыв сорван` : "Прорыв сорван";
        const contest = remainingNames.length > 1
          ? ` На поле остаются независимые команды: ${remainingNames.join(", ")}; автоматический победитель между ними не назначается.`
          : (!remainingNames.length && participatingDefenders.length > 1 ? " Все противостоящие команды также потеряли боеспособность." : "");
        return this.outcome("escapeDenied", winner, round, scores, title, `Отведено ${withdrawn} из ${config.requiredShips} требуемых боевых единиц.${contest}`);
      }
      return { resolved: false };
    }

    if (activeSides.length <= 1) {
      const winner = activeSides[0] ?? null;
      const title = winner ? `${sideName(battle, winner)} побеждает` : "Взаимная потеря боеспособности";
      return this.outcome(winner ? "elimination" : "draw", winner, round, scores, title, winner ? "У противников не осталось боеспособных единиц." : "Боеспособных единиц не осталось ни у одной стороны.");
    }
    if (round < config.roundLimit) return { resolved: false };

    const ranked = activeSides.map(sideId => ({ sideId, score: Number(scores[sideId] ?? 0) })).sort((a, b) => b.score - a.score);
    const lead = Number(ranked[0]?.score ?? 0) - Number(ranked[1]?.score ?? 0);
    if (ranked[0] && lead >= config.decisionMargin * 100) {
      const winner = ranked[0].sideId;
      return this.outcome("decision", winner, round, scores, `${sideName(battle, winner)} побеждает по решению`, `Лимит ${config.roundLimit} раундов достигнут; перевес боеспособности ${lead.toFixed(1)} п.п.`);
    }
    return this.outcome("draw", null, round, scores, "Боевая ничья", `Лимит ${config.roundLimit} раундов достигнут без перевеса в ${(config.decisionMargin * 100).toFixed(0)} п.п.`);
  }

  static outcome(reason, winnerSideId, round, scores, title, summary) {
    return { resolved: true, reason, winnerSideId, round, scores: scoreRecord(scores), title, summary, timestamp: 0 };
  }
}
