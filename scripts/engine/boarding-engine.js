import { distanceCells, directionToCell } from "../board/board-geometry.js";
import { roll3d6, chance } from "../utils/random.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { getCombatant } from "../utils/combatants.js";

export class BoardingEngine {
  static getGrappledWith(ship) {
    return ship?.flags?.grappledWith ?? null;
  }

  static isGrappled(ship) {
    return Boolean(this.getGrappledWith(ship));
  }

  static canGrapple(attacker, target) {
    if (!CombatantRules.supports(attacker, "boarding") || !CombatantRules.supports(target, "boarding")) return false;
    if (!attacker || !target || attacker.id === target.id || attacker.side === target.side) return false;
    if (this.isGrappled(attacker) || this.isGrappled(target)) return false;
    if (Number(attacker.altitude ?? 0) !== Number(target.altitude ?? 0)) return false;
    return distanceCells(attacker, target) <= 1;
  }

  static grapple(battle, attackerId, targetId) {
    const attacker = getCombatant(battle, attackerId);
    const target = getCombatant(battle, targetId);
    if (!attacker || !target) return { ok: false, text: "Не выбран корабль или цель для сцепки." };
    if (!this.canGrapple(attacker, target)) return { ok: false, text: "Сцепка невозможна: цель должна быть в соседней клетке, на той же высоте, не союзником и не уже сцепленной." };

    attacker.flags ??= {};
    target.flags ??= {};
    attacker.flags.grappledWith = target.id;
    target.flags.grappledWith = attacker.id;
    this.updateTowRelationship(attacker, target);
    return { ok: true, text: `${attacker.name}: сцепляется с ${target.name}.${this.getTowLeader(attacker, target) ? ` Более крупный корабль может продолжить движение, буксируя меньший.` : " Оба корабля теряют ход."}` };
  }

  static release(battle, shipId) {
    const ship = getCombatant(battle, shipId);
    if (!ship) return { ok: false, text: "Корабль не выбран." };
    const otherId = this.getGrappledWith(ship);
    if (!otherId) return { ok: false, text: `${ship.name}: корабль не сцеплен.` };
    const other = getCombatant(battle, otherId);
    delete ship.flags.grappledWith;
    delete ship.flags.towingId;
    delete ship.flags.towedById;
    if (other?.flags) { delete other.flags.grappledWith; delete other.flags.towingId; delete other.flags.towedById; }
    return { ok: true, text: `${ship.name}: сцепка разорвана${other ? ` с ${other.name}` : ""}.` };
  }


  static getSize(unit) {
    return Math.max(1, Number(unit?.stats?.sm ?? unit?.sizeClass ?? 1));
  }

  static getTowLeader(a, b) {
    if (!a || !b) return null;
    const delta = this.getSize(a) - this.getSize(b);
    if (Math.abs(delta) < 2) return null;
    return delta > 0 ? a : b;
  }

  static updateTowRelationship(a, b) {
    const leader = this.getTowLeader(a, b);
    if (!leader) {
      a.speed = 0; b.speed = 0;
      return null;
    }
    const follower = leader.id === a.id ? b : a;
    leader.flags.towingId = follower.id;
    follower.flags.towedById = leader.id;
    follower.speed = leader.speed;
    return { leader, follower };
  }

  static getTowPenalties(ship, battle) {
    const targetId = ship?.flags?.towingId;
    const target = targetId ? getCombatant(battle, targetId) : null;
    if (!target) return { speed: 0, handling: 0 };
    const ratio = Math.max(0.25, this.getSize(target) / this.getSize(ship));
    return { speed: Math.max(1, Math.ceil(ratio * 2)), handling: Math.max(1, Math.ceil(ratio * 2)) };
  }

  static tryAutomaticGrapple(battle, attacker, target, collision = {}) {
    if (!this.canGrapple(attacker, target)) return { ok: false, grappled: false };
    const relative = Math.max(1, Number(collision.relativeSpeed ?? 1));
    const sizeDelta = Math.abs(this.getSize(attacker) - this.getSize(target));
    const probability = Math.max(0.10, Math.min(0.70, 0.18 + relative * 0.08 - sizeDelta * 0.03));
    if (!chance(probability)) return { ok: true, grappled: false, probability };
    const result = this.grapple(battle, attacker.id, target.id);
    return { ...result, grappled: Boolean(result.ok), probability };
  }

  static board(battle, attackerId, targetId = null) {
    const attacker = getCombatant(battle, attackerId);
    if (!attacker) return { ok: false, text: "Абордажная партия не выбрана." };
    const resolvedTargetId = targetId ?? this.getGrappledWith(attacker);
    const target = getCombatant(battle, resolvedTargetId);
    if (!target) return { ok: false, text: "Нет цели для абордажа." };
    if (this.getGrappledWith(attacker) !== target.id || this.getGrappledWith(target) !== attacker.id) {
      return { ok: false, text: "Перед абордажем корабли должны быть сцеплены." };
    }

    const attackPower = this.getBoardingPower(attacker);
    const defensePower = this.getBoardingPower(target);
    const attackRoll = roll3d6();
    const defenseRoll = roll3d6();
    const attackScore = attackPower + attackRoll;
    const defenseScore = defensePower + defenseRoll;
    const margin = Math.abs(attackScore - defenseScore);
    const winner = attackScore >= defenseScore ? attacker : target;
    const loser = winner.id === attacker.id ? target : attacker;

    const loserLosses = Math.max(3, Math.ceil(margin / 2) + Math.ceil(Number(winner.crew?.current ?? 0) / 60));
    const winnerLosses = Math.max(1, Math.ceil(loserLosses / 2));
    this.applyCrewLosses(loser, loserLosses, true);
    this.applyCrewLosses(winner, winnerLosses, false);

    let result = `${attacker.name}: абордаж против ${target.name}. `;
    result += `${attacker.name} ${attackScore} (${attackPower}+${attackRoll}) против ${target.name} ${defenseScore} (${defensePower}+${defenseRoll}). `;
    result += `${winner.name} берет верх. Потери: ${loser.name} ${loserLosses}, ${winner.name} ${winnerLosses}.`;

    if (Number(loser.crew?.morale ?? 10) <= 0 || Number(loser.crew?.current ?? 0) < Math.ceil(Number(loser.crew?.required ?? 1) * 0.15)) {
      loser.flags ??= {};
      loser.flags.struck = true;
      result += ` ${loser.name}: команда сдается или теряет способность сопротивляться.`;
    }

    return { ok: true, text: result };
  }

  static getBoardingPower(ship) {
    const crew = ship?.crew ?? {};
    const current = Number(crew.current ?? 0);
    const required = Number(crew.required ?? 1);
    const ratio = required > 0 ? current / required : 1;
    const crewBand = Math.floor(current / 25);
    const morale = Number(crew.morale ?? 10) - 5;
    const quality = Number(ship?.stats?.crewQuality ?? 0);
    const damagePenalty = ratio < 0.25 ? -4 : ratio < 0.5 ? -2 : ratio < 0.75 ? -1 : 0;
    const orderBonus = ship?.selectedOrder === "boarding" ? 2 : ship?.selectedOrder === "brace" ? 1 : 0;
    return crewBand + morale + quality + damagePenalty + orderBonus;
  }

  static applyCrewLosses(ship, losses, moraleHit = false) {
    ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    losses = Math.max(0, Number(losses ?? 0));
    ship.crew.current = Math.max(0, Number(ship.crew.current ?? 0) - losses);
    ship.crew.casualties = Number(ship.crew.casualties ?? 0) + losses;
    if (moraleHit) ship.crew.morale = Math.max(0, Number(ship.crew.morale ?? 10) - 1);
  }
}
