import { cellKey, headingToVector, rotateHeading, withinBoard } from "../board/board-geometry.js";
import { ALTITUDE_MAX, ALTITUDE_MIN, ORDER_LABELS, POINT_OF_SAIL_LABELS, TERRAIN_LABELS } from "../utils/constants.js";
import { WindEngine } from "./wind-engine.js";
import { DamageEngine } from "./damage-engine.js";
import { OccupancyEngine } from "./occupancy-engine.js";
import { CollisionEngine } from "./collision-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { BoardingEngine } from "./boarding-engine.js";
import { getCombatant, getCombatants } from "../utils/combatants.js";
import { CreatureMovementEngine } from "./creature-movement-engine.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";
import { CreatureGrappleEngine } from "./creature-grapple-engine.js";

const TERRAIN_PROFILE = {
  reef: { ceiling: 0, blocks: false, hazard: true },
  shoal: { ceiling: 0, blocks: false, hazard: true },
  wreck: { ceiling: 0, blocks: false, hazard: true },
  rockLow: { ceiling: 2, blocks: false, hazard: true },
  rockHigh: { ceiling: 5, blocks: true, hazard: false },
  smoke: { ceiling: ALTITUDE_MAX, blocks: false, hazard: false },
  cloud: { floor: 1, ceiling: ALTITUDE_MAX, blocks: false, hazard: false },
  stormCloud: { floor: 1, ceiling: ALTITUDE_MAX, blocks: false, hazard: false, dangerous: true },
  updraft: { floor: 1, ceiling: ALTITUDE_MAX, blocks: false, hazard: false },
  downdraft: { floor: 1, ceiling: ALTITUDE_MAX, blocks: false, hazard: false },
  turbulence: { floor: 1, ceiling: ALTITUDE_MAX, blocks: false, hazard: false },
  skyIsland: { floor: 2, ceiling: 6, blocks: true, hazard: false }
};

export const CORE_MODES = {
  normal: { label: "Штатный", heatMod: 0, verticalStep: 1, impulseBonus: 1, cooling: 0, risk: 0 },
  boosted: { label: "Форсированный", heatMod: 1, verticalStep: 2, impulseBonus: 2, cooling: 0, risk: 0.08 },
  emergency: { label: "Аварийный", heatMod: 2, verticalStep: 2, impulseBonus: 2, cooling: 0, risk: 0.18 },
  shutdown: { label: "Заглушенный", heatMod: 0, verticalStep: 0, impulseBonus: 0, cooling: 2, risk: 0 }
};

export class MovementEngine {
  static getBattleMode(battle) {
    const mode = String(battle?.setup?.mode ?? "mixed");
    return ["sea", "air", "mixed"].includes(mode) ? mode : "mixed";
  }

  static usesAltitude(battle) {
    return this.getBattleMode(battle) !== "sea";
  }

  static usesCore(battle) {
    return this.usesAltitude(battle);
  }

  static normalizeTerrainStack(terrain) {
    const list = [...new Set(this.terrainList(terrain))];
    if (list.includes("rockHigh")) return ["rockHigh"];
    return list;
  }

  static mergeTerrainStack(current, type) {
    const next = String(type ?? "");
    if (!next) return this.normalizeTerrainStack(current);
    if (next === "rockHigh") return ["rockHigh"];

    const list = this.normalizeTerrainStack(current);
    if (list.includes("rockHigh")) return list;
    if (!list.includes(next)) list.push(next);
    return this.normalizeTerrainStack(list);
  }

  static terrainList(terrain) {
    if (!terrain) return [];
    if (Array.isArray(terrain)) return terrain.filter(Boolean);
    return [terrain].filter(Boolean);
  }

  static hasTerrain(terrain, type) {
    return this.terrainList(terrain).includes(type);
  }

  static terrainCeiling(type) {
    return Number(TERRAIN_PROFILE[type]?.ceiling ?? 0);
  }

  static terrainAffectsAltitude(type, altitude = 0) {
    const profile = TERRAIN_PROFILE[type];
    if (!profile) return false;
    const value = Number(altitude ?? 0);
    return value >= Number(profile.floor ?? 0) && value <= Number(profile.ceiling ?? 0);
  }

  static getTerrainCeiling(terrain, { blockingOnly = false } = {}) {
    const list = this.terrainList(terrain);
    let ceiling = null;
    for (const type of list) {
      const profile = TERRAIN_PROFILE[type];
      if (!profile) continue;
      if (blockingOnly && !profile.blocks && !profile.hazard) continue;
      ceiling = Math.max(Number(ceiling ?? profile.ceiling), Number(profile.ceiling ?? 0));
    }
    return ceiling ?? 0;
  }

  static getTerrainHeightLabel(terrain) {
    const list = this.terrainList(terrain);
    if (!list.length) return "";
    const relevant = list.filter(t => t !== "smoke");
    if (!relevant.length) return `дым до H${ALTITUDE_MAX}`;
    const floors = relevant.map(t => Number(TERRAIN_PROFILE[t]?.floor ?? 0));
    const floor = Math.min(...floors);
    const ceiling = this.getTerrainCeiling(relevant);
    const prefix = relevant.some(t => TERRAIN_PROFILE[t]?.blocks || TERRAIN_PROFILE[t]?.hazard || TERRAIN_PROFILE[t]?.dangerous) ? "опасно" : "воздух";
    return floor > 0 ? `${prefix} H${floor}-H${ceiling}` : `${prefix} до H${ceiling}`;
  }

  static getTerrainAltitudeRangeLabel(type) {
    const profile = TERRAIN_PROFILE[type];
    if (!profile) return "H0";
    const floor = Number(profile.floor ?? 0);
    const ceiling = Number(profile.ceiling ?? floor);
    return floor === ceiling ? `H${floor}` : `H${floor}-H${ceiling}`;
  }

  static getReachableCells(battle, ship) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getReachableCells(battle, ship, this);
    if (!ship || !CombatantRules.supports(ship, "movement")) return [];
    if (CombatantRules.getMovementBlockReason(ship, battle)) return [];
    if ((ship.flags?.grappledWith && !ship.flags?.towingId) || ship.flags?.struck || (this.usesCore(battle) && ship.flags?.falling) || ship.flags?.immobilized) return [];
    if (Object.values(ship?.sections ?? {}).reduce((sum, sec) => sum + Number(sec.mastWreckage ?? 0), 0) >= 2) return [];

    // Предел тяги ограничивает разгон, но не стирает уже накопленную инерцию
    // после смены курса, ветра или повреждения парусов.
    const speed = Math.max(0, Number(ship.speed ?? 0));
    if (speed <= 0) return [];
    const inertia = this.getInertiaProfile(battle, ship, { speed });

    const candidates = [];
    const turnLimit = this.getTurnLimit(ship);
    const turnDelay = inertia.turnDelay;
    const steeringOptions = [{ delta: 0, turnDelay: 0 }];
    if (turnLimit >= 1) steeringOptions.push({ delta: -1, turnDelay }, { delta: 1, turnDelay });

    const altitude = Number(ship.altitude ?? 0);
    for (const steering of steeringOptions) {
      let current = { x: Number(ship.x ?? 0), y: Number(ship.y ?? 0) };
      const path = [];
      for (let step = 1; step <= speed; step++) {
        const hasTurned = steering.delta !== 0 && step > steering.turnDelay;
        const heading = hasTurned ? rotateHeading(ship.heading, steering.delta) : ship.heading;
        const vector = headingToVector(heading, current.x, current.y);
        const x = current.x + vector.dx;
        const y = current.y + vector.dy;
        if (!withinBoard(battle.board, x, y)) break;
        const key = cellKey(x, y);
        const terrain = this.getTerrain(battle, x, y);
        if (this.isBlockingTerrain(terrain, altitude)) break;
        path.push({ x, y, key, step, terrain, heading });
        const conflict = OccupancyEngine.findConflict(battle, ship, path[path.length - 1], {
          x: current.x,
          y: current.y,
          step: step - 1
        });
        if (conflict) {
          const collision = CollisionEngine.previewShipCollision(ship, conflict.targetShip, {
            ...conflict,
            attackerHeading: heading,
            attackerSpeed: speed
          });
          if (collision) {
            candidates.push({
              x,
              y,
              stopX: current.x,
              stopY: current.y,
              heading,
              key,
              steps: step,
              terrain,
              requiredAdvance: inertia.requiredAdvance,
              resultingSpeed: step,
              brakingCost: Math.max(0, speed - step),
              steeringDelta: steering.delta,
              turnDelay: steering.turnDelay,
              turnStep: hasTurned ? steering.turnDelay + 1 : null,
              collision,
              path: path.map(cell => ({ ...cell }))
            });
          }
          break;
        }
        if (step >= inertia.requiredAdvance) {
          candidates.push({
            x,
            y,
            heading,
            key,
            steps: step,
            terrain,
            requiredAdvance: inertia.requiredAdvance,
            resultingSpeed: step,
            brakingCost: Math.max(0, speed - step),
            steeringDelta: steering.delta,
            turnDelay: steering.turnDelay,
            turnStep: hasTurned ? steering.turnDelay + 1 : null,
            path: path.map(cell => ({ ...cell }))
          });
        }
        current = { x, y };
      }
    }

    const unique = new Map();
    for (const candidate of candidates) {
      const current = unique.get(candidate.key);
      if (!current || (current.collision && !candidate.collision)) unique.set(candidate.key, candidate);
    }
    return [...unique.values()];
  }

  static getPathCells(ship, heading, steps, battle = null) {
    const path = [];
    let current = { x: Number(ship.x ?? 0), y: Number(ship.y ?? 0) };
    for (let step = 1; step <= Number(steps ?? 0); step++) {
      const vector = headingToVector(heading, current.x, current.y);
      const x = current.x + vector.dx;
      const y = current.y + vector.dy;
      if (battle?.board && !withinBoard(battle.board, x, y)) break;
      const key = cellKey(x, y);
      path.push({ x, y, key, step, terrain: battle ? this.getTerrain(battle, x, y) : null });
      current = { x, y };
    }
    return path;
  }

  static findReachableCell(battle, ship, x, y) {
    return this.getReachableCells(battle, ship).find(c => Number(c.x) === Number(x) && Number(c.y) === Number(y)) ?? null;
  }

  static getEffectiveMaxSpeed(battle, ship) {
    return this.getEffectiveMaxSpeedDetails(battle, ship).value;
  }

  static getInertiaProfile(battle, ship, { speed = null } = {}) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getInertiaProfile(battle, ship, { speed });
    if (!CombatantRules.supports(ship, "movement")) {
      return {
        speed: 0, effectiveMax: 0, acceleration: 0, braking: 0, requiredAdvance: 0,
        safeTurnSpeed: 0, turnDelay: 0, turnStep: null, turnText: "движение недоступно",
        massClass: "unsupported", profileKey: null, profileLabel: CombatantRules.for(ship)?.label ?? "боевая единица",
        modifiers: [CombatantRules.getMovementBlockReason(ship, battle) ?? "правила движения не подключены"],
        modifiersText: CombatantRules.getMovementBlockReason(ship, battle) ?? "правила движения не подключены"
      };
    }
    const sailing = WindEngine.getSailingProfileData(ship);
    const sm = Number(ship?.stats?.sm ?? 7);
    const massPenalty = sm >= 10 ? 1 : 0;
    let acceleration = Number(sailing.acceleration ?? 1) - massPenalty;
    let braking = Number(sailing.braking ?? 1) - massPenalty;
    const modifiers = [];

    const order = String(ship?.selectedOrder ?? "");
    if (order === "pressSail") {
      acceleration += 1;
      braking -= 1;
      modifiers.push("гнать ход: ускорение +1, торможение -1");
    } else if (["steadyGunnery", "damageControl", "boarding", "brace"].includes(order)) {
      acceleration -= 1;
      modifiers.push(`${ORDER_LABELS[order] ?? order}: ускорение -1`);
    }

    const crew = ship?.crew ?? {};
    const crewRequired = Math.max(1, Number(crew.required ?? 1));
    if (Number(crew.current ?? crewRequired) / crewRequired < 0.5) {
      acceleration -= 1;
      braking -= 1;
      modifiers.push("экипаж меньше 50%: ускорение и торможение -1");
    }
    const mastWreckage = Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section?.mastWreckage ?? 0), 0);
    if (mastWreckage > 0) {
      acceleration -= 1;
      braking -= 1;
      modifiers.push("обломки рангоута: ускорение и торможение -1");
    }
    const flooding = Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section?.flooding ?? 0), 0);
    if (Number(ship?.altitude ?? 0) <= 0 && flooding >= 4) {
      acceleration -= 1;
      braking -= 1;
      modifiers.push("тяжёлое затопление: ускорение и торможение -1");
    }
    if (battle?.wind?.strength === "storm") {
      braking -= 1;
      modifiers.push("шторм: торможение -1");
    }
    acceleration = Math.max(1, acceleration);
    braking = Math.max(1, braking);
    const effectiveMax = this.getEffectiveMaxSpeed(battle, ship);
    const currentSpeed = Math.max(0, Number(speed ?? ship?.speed ?? 0));
    const requiredAdvance = Math.max(0, currentSpeed - braking);
    const safeTurnSpeed = this.getSafeTurnSpeed(ship);
    const turnDelay = this.getTurnDelay(ship, currentSpeed, { braking });
    const massClass = sm >= 10 ? "heavy" : sm <= 6 ? "light" : "medium";
    return {
      speed: currentSpeed,
      effectiveMax,
      acceleration,
      braking,
      requiredAdvance,
      safeTurnSpeed,
      turnDelay,
      turnStep: turnDelay < currentSpeed ? turnDelay + 1 : null,
      turnText: turnDelay > 0 ? `поворот после ${turnDelay} гекс. прямо` : "поворот доступен сразу",
      massClass,
      profileKey: WindEngine.getSailingProfile(ship),
      profileLabel: sailing.label ?? WindEngine.getSailingProfile(ship),
      modifiers,
      modifiersText: modifiers.join("; ")
    };
  }

  static getHorizontalResolutionState(battle, unit, { actions = null, checkRoutes = false, speed = null } = {}) {
    if (!unit || !CombatantRules.supports(unit, "movement")) {
      return { needsResolution: false, mustMove: false, canComplete: true, hasLegalMove: false, requiredAdvance: 0, speed: 0, rawSpeed: 0 };
    }
    const phaseActions = actions ?? {};
    if (phaseActions.move) {
      return { needsResolution: false, mustMove: false, canComplete: true, hasLegalMove: false, requiredAdvance: 0, speed: 0, rawSpeed: Number(unit.speed ?? 0), resolved: true };
    }
    const rawSpeed = Math.max(0, Number(speed ?? unit.speed ?? 0));
    const blockedReason = CombatantRules.getMovementBlockReason(unit, battle);
    const inertia = this.getInertiaProfile(battle, unit, { speed: rawSpeed });
    const currentSpeed = Math.max(0, Number(inertia.speed ?? 0));
    const requiredAdvance = blockedReason ? 0 : Math.max(0, Number(inertia.requiredAdvance ?? 0));
    const needsResolution = rawSpeed > 0;
    const mustMove = needsResolution && !blockedReason && requiredAdvance > 0;
    let hasLegalMove = false;
    if (mustMove && checkRoutes) hasLegalMove = this.getReachableCells(battle, unit).length > 0;
    return {
      needsResolution,
      mustMove,
      canComplete: !mustMove || (checkRoutes && !hasLegalMove),
      hasLegalMove,
      forcedStop: Boolean(mustMove && checkRoutes && !hasLegalMove),
      requiredAdvance,
      speed: currentSpeed,
      rawSpeed,
      blockedReason,
      inertia
    };
  }

  static applyBlockedInertia(battle, unit, state = null) {
    const resolution = state ?? this.getHorizontalResolutionState(battle, unit, { checkRoutes: true });
    const speed = Math.max(1, Number(resolution.rawSpeed ?? unit?.speed ?? 0));
    const vector = headingToVector(unit?.heading ?? 0, unit?.x ?? 0, unit?.y ?? 0);
    const x = Number(unit?.x ?? 0) + vector.dx;
    const y = Number(unit?.y ?? 0) + vector.dy;
    const outside = !withinBoard(battle?.board, x, y);
    const terrain = outside ? null : this.getTerrain(battle, x, y);
    const terrainLabel = this.terrainList(terrain).map(type => TERRAIN_LABELS[type] ?? type).join(" + ");
    const reason = outside ? "границу тактического поля" : terrainLabel ? `непроходимый террейн «${terrainLabel}»` : "непреодолимое препятствие";
    unit.speed = 0;
    if (unit.unitType === "creature") {
      const damage = CreatureDamageEngine.applyDamage(unit, Math.max(2, speed * 2), { tags: ["stun"] });
      return { ok: true, forced: true, text: `${unit.name}: инерция несёт существо в ${reason}; аварийная остановка, ход ${speed} → 0. ${damage.text}` };
    }
    const section = unit.sections?.bow ?? unit.sections?.midship ?? Object.values(unit.sections ?? {})[0];
    const damage = Math.max(2, speed * 2);
    if (section) {
      section.hp ??= { value: 0, max: 0 };
      section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - damage);
      if (Number(unit.altitude ?? 0) <= 0 && speed >= 3) DamageEngine.addBreachOrFlooding(unit, section, 1, "аварийная остановка");
    }
    const notes = [];
    DamageEngine.checkStruck(unit, notes);
    return { ok: true, forced: true, text: `${unit.name}: инерция несёт корабль в ${reason}; аварийная остановка, ход ${speed} → 0, корпус получает ${damage} урона.${notes.length ? ` ${notes.join(" ")}` : ""}` };
  }

  static resolveHorizontalCompletion(battle, unit, { actions = null } = {}) {
    const phaseActions = actions ?? {};
    const state = this.getHorizontalResolutionState(battle, unit, { actions: phaseActions, checkRoutes: true });
    if (!state.needsResolution || phaseActions.move) return { ok: true, changed: false, state, text: "" };
    if (state.mustMove && state.hasLegalMove) {
      return { ok: false, changed: false, state, text: `${unit.name}: инерция требует пройти не менее ${state.requiredAdvance} гекс. Выберите подсвеченную клетку.` };
    }
    let result;
    if (state.forcedStop) result = this.applyBlockedInertia(battle, unit, state);
    else {
      const before = Number(unit.speed ?? 0);
      unit.speed = 0;
      result = { ok: true, changed: before > 0, forced: false, text: before > 0 ? `${unit.name}: гасит остаточный ход ${before} → 0 и остаётся на месте.` : "" };
    }
    phaseActions.move = true;
    return { ...result, state };
  }

  static applyMoveInertia(ship, candidate) {
    const before = Math.max(0, Number(ship?.speed ?? 0));
    const traveled = Math.max(0, Number(candidate?.steps ?? 0));
    ship.speed = Math.min(before, traveled);
    return { before, after: ship.speed, traveled, brakingCost: Math.max(0, before - ship.speed) };
  }

  static getEffectiveMaxSpeedDetails(battle, ship) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getEffectiveMaxSpeedDetails(battle, ship);
    if (!CombatantRules.supports(ship, "movement")) {
      return { value: 0, modifiers: [], title: CombatantRules.getMovementBlockReason(ship, battle) ?? "Правила движения не подключены." };
    }
    const usesCore = this.usesCore(battle);
    if (usesCore && ship?.flags?.falling) return { value: 0, title: "Корабль падает: движение заблокировано." };
    if (usesCore && ship?.flags?.coreExploded) return { value: 0, title: "Ядро взорвалось: движение заблокировано." };
    if (ship?.flags?.immobilized) return { value: 0, title: "Корабль обездвижен: рангоут, вода или корпус блокируют ход." };

    const baseMax = Number(ship?.maxSpeed ?? 0);
    const pointOfSail = WindEngine.getPointOfSail(ship, battle?.wind ?? {});
    const profileKey = WindEngine.getSailingProfile(ship);
    const profile = WindEngine.getSailingProfileData(ship);
    const basePointPercent = Math.round(WindEngine.getBasePointModifier(ship, battle?.wind ?? {}) * 100);
    const sailDamage = WindEngine.getSailDamageDetails(ship);
    const windPercent = Math.round(WindEngine.getSpeedModifier(ship, battle?.wind ?? {}) * 100);
    const afterWind = WindEngine.getEffectiveMaxSpeed(ship, battle?.wind ?? {});
    let max = afterWind;
    const modifiers = [];

    if (pointOfSail === "inIrons") {
      max = 0;
      modifiers.push("нос в ветер: ход 0");
    } else if (ship?.flags?.inIrons) {
      modifiers.push("выход из положения против ветра требует успешного поворота");
    }

    const crew = ship?.crew ?? {};
    const required = Number(crew.required ?? 1);
    const current = Number(crew.current ?? required);
    const ratio = required > 0 ? current / required : 1;
    if (ratio < 0.25) { max -= 2; modifiers.push("экипаж меньше 25%: -2"); }
    else if (ratio < 0.5) { max -= 1; modifiers.push("экипаж меньше 50%: -1"); }

    const flooding = Object.values(ship?.sections ?? {}).reduce((sum, sec) => sum + Number(sec.flooding ?? 0), 0);
    const breaches = Object.values(ship?.sections ?? {}).reduce((sum, sec) => sum + Number(sec.breaches ?? 0), 0);
    const mastWreckage = Object.values(ship?.sections ?? {}).reduce((sum, sec) => sum + Number(sec.mastWreckage ?? 0), 0);
    if (mastWreckage >= 2) { max = 0; modifiers.push(`обломки рангоута ${mastWreckage}: ход 0`); }
    else if (mastWreckage > 0) { max -= mastWreckage; modifiers.push(`обломки рангоута ${mastWreckage}: -${mastWreckage}`); }
    if (Number(ship?.altitude ?? 0) <= 0) {
      if (flooding >= 4) { max -= 2; modifiers.push("вода 4+: -2"); }
      else if (flooding >= 2) { max -= 1; modifiers.push("вода 2+: -1"); }
      if (breaches > 0) modifiers.push(`пробоины ${breaches}: вода будет прибывать`);
    } else if (breaches > 0) {
      modifiers.push(`сухие пробоины ${breaches}: без затопления выше H0`);
    }

    const crystal = ship?.crystal ?? {};
    if (usesCore) {
      if (crystal.enabled === false || Number(crystal.integrity ?? 1) <= 0) { max -= 3; modifiers.push("ядро не работает: -3"); }
      else if (Number(crystal.heat ?? 0) >= Number(crystal.maxHeat ?? 10)) { max -= 1; modifiers.push("перегрев ядра: -1"); }
    }

    const order = ship?.selectedOrder;
    if (order === "pressSail") { max += 1; modifiers.push(`${ORDER_LABELS[order] ?? order}: +1`); }
    else if (["steadyGunnery", "damageControl", "boarding", "brace"].includes(order)) { max -= 1; modifiers.push(`${ORDER_LABELS[order] ?? order}: -1`); }

    const towPenalty = BoardingEngine.getTowPenalties(ship, battle);
    if (towPenalty.speed > 0) { max -= towPenalty.speed; modifiers.push(`буксировка: ход -${towPenalty.speed}, маневренность -${towPenalty.handling}`); }

    const currentTerrain = battle ? this.getTerrain(battle, ship?.x ?? 0, ship?.y ?? 0) : null;
    const terrainList = this.terrainList(currentTerrain);
    const terrainText = terrainList.length
      ? ` Текущая клетка: ${terrainList.map(t => TERRAIN_LABELS[t] ?? t).join(" + ")}${this.isBlockingTerrain(terrainList, Number(ship?.altitude ?? 0)) ? " блокирует ход на этой высоте." : " не блокирует ход; опасный террейн только наносит урон при входе."}`
      : "";

    const value = Math.max(0, max);
    const profileLabel = profile.label ?? profileKey;
    const title = `Базовый максимум ${baseMax}; паруса: ${profileLabel}; ветер: ${POINT_OF_SAIL_LABELS[pointOfSail] ?? pointOfSail}, профиль ${basePointPercent}% × сила/повреждения рангоута (${sailDamage.text}) = ${windPercent}% → ${afterWind}${modifiers.length ? `; ${modifiers.join("; ")}` : ""}; итог ${value}.${terrainText}`;
    return { value, baseMax, pointOfSail, profileKey, profileLabel, basePointPercent, windPercent, afterWind, modifiers, sailDamage, title };
  }

  static syncSailingState(battle, ship) {
    if (ship?.unitType === "creature") return false;
    return WindEngine.syncInIronsFlag(ship, battle?.wind ?? {});
  }

  static getTurnLimit(ship) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getTurnLimit(ship);
    if (!CombatantRules.supports(ship, "movement")) return 0;
    if (ship?.flags?.immobilized) return 0;
    const mastWreckage = Object.values(ship?.sections ?? {}).reduce((sum, sec) => sum + Number(sec.mastWreckage ?? 0), 0);
    if (mastWreckage >= 2) return 0;
    const rudder = this.findSystem(ship, "руль");
    const wheel = this.findSystem(ship, "штурвал");
    if (["destroyed", "disabled"].includes(rudder?.status) || ["destroyed", "disabled"].includes(wheel?.status)) return 0;
    if (rudder?.status === "damaged" || wheel?.status === "damaged") return Number(ship?.speed ?? 0) <= 2 ? 1 : 0;
    return 1;
  }

  static getSafeTurnSpeed(ship) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getEffectiveMaxSpeedDetails(null, ship).value;
    const handling = Number(ship?.stats?.handling ?? 0);
    const sm = Number(ship?.stats?.sm ?? 7);
    let safe = 2 + handling;
    if (sm >= 8) safe -= 1;
    if (sm >= 9) safe -= 1;
    return Math.max(0, Math.min(5, safe));
  }

  static getTurnDelay(ship, speed = ship?.speed ?? 0, { braking = 2 } = {}) {
    const movementSpeed = Math.max(0, Math.floor(Number(speed ?? 0)));
    if (movementSpeed <= 1 || this.getTurnLimit(ship) <= 0) return 0;
    const excess = Math.max(0, movementSpeed - this.getSafeTurnSpeed(ship));
    const controlPenalty = Math.max(0, 2 - Math.max(1, Number(braking ?? 1)));
    return Math.min(movementSpeed - 1, excess + controlPenalty);
  }

  static getCrewManeuverModifier(ship) {
    const crew = ship?.crew ?? {};
    const required = Number(crew.required ?? 1);
    const current = Number(crew.current ?? required);
    const ratio = required > 0 ? current / required : 1;
    let mod = Number(ship?.stats?.crewQuality ?? 0);
    if (ratio < 0.25) mod -= 4;
    else if (ratio < 0.5) mod -= 2;
    else if (ratio < 0.75) mod -= 1;

    const morale = Number(crew.morale ?? 10);
    if (morale <= 2) mod -= 2;
    else if (morale <= 5) mod -= 1;
    return mod;
  }

  static getManeuverSkill(ship, extra = 0) {
    const handling = Number(ship?.stats?.handling ?? 0);
    const value = 10 + handling + this.getCrewManeuverModifier(ship) + Number(extra ?? 0);
    return Math.max(3, Math.min(16, value));
  }

  static roll3d6(random = Math.random) {
    const die = () => 1 + Math.floor(random() * 6);
    return die() + die() + die();
  }

  static getTurnAssessment(battle, ship, delta) {
    const nextHeading = rotateHeading(ship?.heading ?? 0, delta);
    const currentPoint = WindEngine.getPointOfSail(ship, battle?.wind ?? {});
    const nextPoint = WindEngine.getPointOfSail({ ...ship, heading: nextHeading }, battle?.wind ?? {});
    const profile = WindEngine.getSailingProfileData(ship);
    const speed = Number(ship?.speed ?? 0);
    const safeSpeed = this.getSafeTurnSpeed(ship);
    const inIronsNow = Boolean(ship?.flags?.inIrons) || currentPoint === "inIrons";
    const enteringIrons = nextPoint === "inIrons";
    const leavingIrons = inIronsNow && nextPoint !== "inIrons";
    const tacking = this.isTackingAcrossWind(ship, battle?.wind ?? {}, nextHeading);
    const hardTurn = speed > safeSpeed;
    const blockedByInertia = hardTurn;
    const needsCheck = !blockedByInertia && (leavingIrons || tacking);
    const tackPenalty = tacking ? 1 : 0;
    const turbulencePenalty = this.shipInTerrain(battle, ship, "turbulence") ? 2 : 0;
    const ironsAssist = leavingIrons ? Math.min(6, Number(ship?.flags?.inIronsAttempts ?? 0) * 2) : 0;
    const extra = Number(profile.tackBonus ?? 0) + ironsAssist - (hardTurn ? Math.max(1, speed - safeSpeed) : 0) - (leavingIrons ? 1 : 0) - tackPenalty - turbulencePenalty;
    const skill = this.getManeuverSkill(ship, extra);
    const reason = leavingIrons
      ? "выход из положения против ветра"
      : tacking
        ? "лавировка через линию ветра"
        : hardTurn
          ? `сложный поворот на ходу ${speed} при безопасном ходе ${safeSpeed}`
          : "обычный поворот";
    return { nextHeading, currentPoint, nextPoint, enteringIrons, leavingIrons, tacking, hardTurn, blockedByInertia, needsCheck, skill, safeSpeed, speed, reason, profileLabel: profile.label ?? WindEngine.getSailingProfile(ship), ironsAssist, turbulencePenalty };
  }

  static getTurnPreview(battle, ship, delta) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getTurnPreview(ship, delta);
    const assessment = this.getTurnAssessment(battle, ship, delta);
    const direction = delta < 0 ? "влево" : "вправо";
    let severity = "normal";
    let requirement = "без проверки";
    let summary = `${direction}: курс ${assessment.nextHeading}°`;

    if (assessment.blockedByInertia) {
      severity = "danger";
      requirement = `сначала снизить ход до ${assessment.safeSpeed}`;
    } else if (assessment.enteringIrons) {
      severity = "danger";
      requirement = "встанет против ветра";
    } else if (assessment.needsCheck) {
      severity = "check";
      requirement = `проверка 3d6 ≤ ${assessment.skill}`;
    }

    const notes = [];
    if (assessment.leavingIrons) notes.push("выход из ветра");
    if (assessment.ironsAssist) notes.push(`накопленный снос носа: +${assessment.ironsAssist}`);
    if (assessment.turbulencePenalty) notes.push(`турбулентность: -${assessment.turbulencePenalty}`);
    if (assessment.tacking) notes.push("лавировка через линию ветра");
    if (assessment.hardTurn) notes.push(`сложный поворот: ход ${assessment.speed} > безопасного ${assessment.safeSpeed}`);
    if (assessment.enteringIrons) notes.push("после поворота ход станет 0");

    if (assessment.needsCheck) {
      summary += `, ${requirement}`;
    } else {
      summary += `, ${requirement}`;
    }

    return {
      ...assessment,
      direction,
      severity,
      requirement,
      summary,
      notesText: notes.join("; "),
      tooltip: `${summary}. ${assessment.reason}. Паруса: ${assessment.profileLabel}.`
    };
  }

  static getManeuverAdvice(battle, ship) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.getManeuverAdvice(battle, ship);
    const details = this.getEffectiveMaxSpeedDetails(battle, ship);
    const turnLimit = this.getTurnLimit(ship);
    const left = turnLimit > 0 ? this.getTurnPreview(battle, ship, -1) : null;
    const right = turnLimit > 0 ? this.getTurnPreview(battle, ship, 1) : null;
    const inIrons = Boolean(ship?.flags?.inIrons) || details.pointOfSail === "inIrons";
    const canGainSail = !inIrons && Number(details.value ?? 0) > Number(ship?.speed ?? 0);
    const last = battle?.turn?.lastManeuverCheck?.shipId === ship?.id ? battle.turn.lastManeuverCheck : null;
    const inertia = this.getInertiaProfile(battle, ship);

    return {
      inIrons,
      canGainSail,
      turnLimit,
      currentPoint: details.pointOfSail,
      effectiveMaxSpeed: details.value,
      safeTurnSpeed: this.getSafeTurnSpeed(ship),
      speed: Number(ship?.speed ?? 0),
      inertia,
      left,
      right,
      last,
      notice: inIrons
        ? "Корабль стоит носом к источнику ветра. Набор хода заблокирован. Провалы выхода дают накопительный +2: корабль постепенно сносит носом с линии ветра, поэтому вечной ловушки нет."
        : "Корабль не против ветра. Набор хода и обычные повороты работают по текущему лимиту хода."
    };
  }

  static resolveTurn(battle, ship, delta, { random = Math.random } = {}) {
    if (ship?.unitType === "creature") return CreatureMovementEngine.resolveTurn(ship, delta);
    const assessment = this.getTurnAssessment(battle, ship, delta);
    if (this.getTurnLimit(ship) <= 0) return { ok: false, assessment, text: "Руль или штурвал не позволяют повернуть." };
    if (assessment.blockedByInertia) {
      return {
        ok: false,
        blockedByInertia: true,
        assessment,
        text: `Инерция не позволяет мгновенно изменить курс на ходу ${assessment.speed}. Снизьте ход до ${assessment.safeSpeed} или выберите отложенный поворот на поле.`
      };
    }

    ship.flags ??= {};
    if (assessment.needsCheck) {
      const roll = this.roll3d6(random);
      assessment.roll = roll;
      if (roll > assessment.skill) {
        const beforeSpeed = Number(ship.speed ?? 0);
        const loss = assessment.leavingIrons || assessment.tacking ? 2 : 1;
        ship.speed = Math.max(0, beforeSpeed - loss);
        assessment.speedLoss = beforeSpeed - ship.speed;
        if (assessment.leavingIrons || assessment.tacking) {
          ship.flags.inIrons = true;
          ship.flags.inIronsAttempts = Number(ship.flags.inIronsAttempts ?? 0) + 1;
          ship.speed = 0;
          assessment.speedLoss = beforeSpeed;
        }
        return {
          ok: true,
          changed: false,
          failed: true,
          assessment,
          text: `проверка маневра провалена (${assessment.reason}): 3d6=${roll} > ${assessment.skill}. Курс не изменился, потеря хода ${assessment.speedLoss}, текущий ход ${ship.speed}.`
        };
      }
    }

    ship.heading = assessment.nextHeading;
    if (assessment.hardTurn || assessment.tacking || assessment.leavingIrons) {
      ship.flags ??= {};
      ship.flags.sharpManeuver = true;
    }
    if (assessment.enteringIrons) {
      ship.flags.inIrons = true;
      ship.speed = 0;
      return {
        ok: true,
        changed: true,
        assessment,
        text: `поворот выполнен, но корабль встал носом против ветра: курс ${ship.heading}°, ход 0.`
      };
    }

    ship.flags.inIrons = false;
    ship.flags.inIronsAttempts = 0;
    const effectiveMax = this.getEffectiveMaxSpeed(battle, ship);
    if (assessment.leavingIrons && Number(ship.speed ?? 0) <= 0 && effectiveMax > 0) ship.speed = 1;
    const checkText = assessment.needsCheck ? ` Проверка маневра пройдена: 3d6=${assessment.roll} ≤ ${assessment.skill}.` : " Без проверки.";
    return {
      ok: true,
      changed: true,
      assessment,
      text: `поворот выполнен, курс ${ship.heading}°, ход ${ship.speed}.${checkText}`
    };
  }

  static signedAngleToWindSource(heading, wind) {
    const source = WindEngine.getWindSourceDirection(wind ?? {});
    return ((((Number(heading ?? 0) - source) % 360) + 540) % 360) - 180;
  }

  static isTackingAcrossWind(ship, wind, nextHeading) {
    const current = this.signedAngleToWindSource(ship?.heading ?? 0, wind);
    const next = this.signedAngleToWindSource(nextHeading, wind);
    if (Math.abs(current) <= 30 || Math.abs(next) <= 30) return false;
    if (Math.sign(current) === Math.sign(next)) return false;
    return Math.abs(current) <= 90 && Math.abs(next) <= 90;
  }

  static getCoreMode(ship) {
    const mode = String(ship?.crystal?.mode ?? "normal");
    return CORE_MODES[mode] ? mode : "normal";
  }

  static getCoreModeData(ship) {
    return CORE_MODES[this.getCoreMode(ship)] ?? CORE_MODES.normal;
  }

  static setCoreMode(ship, mode, battle = null) {
    if (!ship) return { ok: false, reason: "Корабль не выбран." };
    if (!this.usesCore(battle)) return { ok: false, reason: "В морском режиме кристаллическое ядро не используется." };
    const key = CORE_MODES[mode] ? mode : "normal";
    ship.crystal ??= {};
    const before = this.getCoreMode(ship);
    ship.crystal.mode = key;
    if (key === "shutdown") ship.verticalVelocity = Math.min(0, Number(ship.verticalVelocity ?? 0));
    return { ok: before !== key, before, after: key, label: CORE_MODES[key].label };
  }

  static getCoreAdvice(ship, battle = null) {
    if (!this.usesCore(battle)) return null;
    const modeKey = this.getCoreMode(ship);
    const mode = CORE_MODES[modeKey] ?? CORE_MODES.normal;
    const core = ship?.crystal ?? {};
    const heat = Number(core.heat ?? 0);
    const maxHeat = Number(core.maxHeat ?? 10);
    const integrity = Number(core.integrity ?? core.maxIntegrity ?? 0);
    const verticalVelocity = Number(ship?.verticalVelocity ?? 0);
    const disabled = core.enabled === false || integrity <= 0 || Boolean(ship?.flags?.coreExploded);
    const canUseCore = !disabled && modeKey !== "shutdown";
    const canShift = canUseCore && modeKey === "boosted" && Number(ship?.altitude ?? 0) > 0;
    const modeText = `${mode.label}: вертикальный шаг ${mode.verticalStep}, импульс +${mode.impulseBonus}, нагрев +${mode.heatMod}${mode.risk ? `, риск ${Math.round(mode.risk * 100)}%` : ""}.`;
    return {
      modeKey,
      modeLabel: mode.label,
      modeText,
      heat,
      maxHeat,
      integrity,
      verticalVelocity,
      canUseCore,
      canShift,
      disabled,
      verticalText: verticalVelocity > 0 ? `подъем +${verticalVelocity}` : verticalVelocity < 0 ? `снижение ${verticalVelocity}` : "нет",
      notice: disabled
        ? "Ядро не отвечает. Доступны только последствия инерции и падения."
        : modeKey === "shutdown"
          ? "Ядро заглушено: активные маневры недоступны, охлаждение ускорено, вертикальная скорость не набирается."
          : modeKey === "boosted"
            ? `${modeText} Доступны ядерные смещения: 1 гекс в любую сторону без смены курса, только в воздухе.`
            : modeText
    };
  }

  static applyCoreManeuver(battle, ship, mode) {
    if (!ship) return { ok: false, reason: "Корабль не выбран." };
    if (!CombatantRules.supports(ship, "crystal")) return { ok: false, reason: `${ship.name}: этот тип боевой единицы не использует корабельное ядро.` };
    if (!this.usesCore(battle)) return { ok: false, reason: "В морском режиме кристаллическое ядро и высота не используются." };
    ship.crystal ??= { heat: 0, maxHeat: 10, integrity: 16, maxIntegrity: 16, enabled: true, mode: "normal" };
    ship.verticalVelocity = Number(ship.verticalVelocity ?? 0);
    const coreMode = this.getCoreMode(ship);
    const modeData = CORE_MODES[coreMode] ?? CORE_MODES.normal;
    if (ship.crystal.enabled === false || Number(ship.crystal.integrity ?? 0) <= 0) return { ok: false, reason: `${ship.name}: ядро кристалла не отвечает.` };
    if (coreMode === "shutdown" && mode !== "emergencyDescend") return { ok: false, reason: `${ship.name}: ядро заглушено; сперва смените режим.` };

    if (String(mode).startsWith("shift")) {
      if (coreMode !== "boosted") return { ok: false, reason: "Ядерное смещение доступно только в форсированном режиме ядра." };
      if (Number(ship.altitude ?? 0) <= 0) return { ok: false, reason: "Ядерное смещение работает только в воздухе, выше H0." };
      const heading = Number(String(mode).replace("shift", ""));
      if (!Number.isFinite(heading)) return { ok: false, reason: "Направление смещения не распознано." };
      const vector = headingToVector(heading, ship.x, ship.y);
      const x = Number(ship.x ?? 0) + vector.dx;
      const y = Number(ship.y ?? 0) + vector.dy;
      if (!withinBoard(battle.board, x, y)) return { ok: false, reason: "Смещение выводит корабль за пределы поля." };
      const occupied = getCombatants(battle).some(unit => unit.id !== ship.id
        && CombatantRules.occupiesCell(unit)
        && Number(unit.x) === x
        && Number(unit.y) === y
        && OccupancyEngine.altitudeOf(unit) === OccupancyEngine.altitudeOf(ship));
      if (occupied) return { ok: false, reason: "Клетка смещения занята другим кораблем." };
      const terrain = this.getTerrain(battle, x, y);
      if (this.isBlockingTerrain(terrain, Number(ship.altitude ?? 0))) return { ok: false, reason: "Клетка смещения заблокирована террейном на текущей высоте." };
      const before = { x: ship.x, y: ship.y, heading: ship.heading };
      ship.x = x;
      ship.y = y;
      return { ok: true, heat: 6 + Number(modeData.heatMod ?? 0), reason: "ядерное смещение", text: `смещение ${before.x + 1}:${before.y + 1} → ${x + 1}:${y + 1}; курс сохранен ${before.heading}°.` };
    }

    if (mode === "climb") {
      if (Number(ship.altitude ?? 0) >= ALTITUDE_MAX && Number(ship.verticalVelocity ?? 0) >= 0) return { ok: false, reason: "Корабль уже у верхнего предела высоты." };
      const updraft = this.shipInTerrain(battle, ship, "updraft");
      const before = ship.verticalVelocity;
      ship.verticalVelocity = Math.min(2, before + Number(modeData.verticalStep ?? 1) + (updraft ? 1 : 0));
      const heat = Math.max(0, 2 + Number(modeData.heatMod ?? 0) - (updraft ? 1 : 0));
      return { ok: true, heat, reason: "подъем", text: `вертикальная инерция ${before} → ${ship.verticalVelocity}; высота изменится в конце раунда.${updraft ? " Восходящий поток снижает нагрев ядра." : ""}` };
    }

    if (mode === "descend") {
      if (Number(ship.altitude ?? 0) <= 0 && Number(ship.verticalVelocity ?? 0) <= 0) return { ok: false, reason: "Корабль уже на минимальной высоте." };
      const before = ship.verticalVelocity;
      ship.verticalVelocity = Math.max(-1, before - 1);
      return { ok: true, heat: 1 + Math.max(0, Number(modeData.heatMod ?? 0) - 1), reason: "безопасное снижение", text: `безопасное снижение: вертикальная инерция ${before} → ${ship.verticalVelocity}.` };
    }

    if (mode === "emergencyDescend") {
      const before = ship.verticalVelocity;
      ship.verticalVelocity = -2;
      ship.flags ??= {};
      ship.flags.emergencyDescent = true;
      return { ok: true, heat: 3 + Number(modeData.heatMod ?? 0), reason: "аварийное снижение", text: `аварийное снижение: вертикальная инерция ${before} → ${ship.verticalVelocity}. Посадка будет жесткой.` };
    }

    const before = Number(ship.speed ?? 0);
    const bonus = Number(modeData.impulseBonus ?? 1);
    const impulseLimit = this.getEffectiveMaxSpeed(battle, ship) + bonus;
    if (before >= impulseLimit) return { ok: false, heat: 0, reason: "Гравитационный толчок не может увеличить уже превышенный предел хода.", text: `ход остаётся ${before}.` };
    ship.speed = Math.min(impulseLimit, before + bonus);
    return { ok: ship.speed > before, heat: 3 + Number(modeData.heatMod ?? 0), reason: "гравитационный толчок", text: `ход ${before} → ${ship.speed}.` };
  }

  static getDriftSteps(battle, ship) {
    if (!ship || ship.flags?.struck || ship.flags?.grappledWith) return 0;
    const strength = battle?.wind?.strength ?? "moderate";
    let steps = strength === "storm" ? 2 : strength === "strong" ? 1 : 0;
    const sailDetails = WindEngine.getSailDamageDetails(ship);
    const rudder = this.findSystem(ship, "руль");
    const wheel = this.findSystem(ship, "штурвал");
    const steeringDamaged = [rudder?.status, wheel?.status].some(s => ["damaged", "destroyed", "disabled"].includes(s));
    if ((sailDetails.weightedDamage >= 1 || steeringDamaged) && strength !== "calm") steps = Math.max(steps, 1);
    if (((this.usesCore(battle) && ship.flags?.falling) || Number(ship.speed ?? 0) <= 0) && ["moderate", "strong", "storm"].includes(strength)) steps = Math.max(steps, 1);
    return Math.min(2, steps);
  }

  static applyDrift(battle, ship) {
    const steps = this.getDriftSteps(battle, ship);
    if (steps <= 0) return [];
    const entries = [];
    const heading = battle?.wind?.direction ?? 0;
    let moved = 0;
    for (let i = 0; i < steps; i++) {
      const vector = headingToVector(heading, ship.x, ship.y);
      const x = Number(ship.x ?? 0) + vector.dx;
      const y = Number(ship.y ?? 0) + vector.dy;
      const terrain = this.getTerrain(battle, x, y);
      const target = OccupancyEngine.findShipAt(battle, x, y, ship.altitude, { excludeShipId: ship.id });
      if (target) {
        const preview = CollisionEngine.previewShipCollision(ship, target, {
          kind: "drift",
          attackerHeading: heading,
          attackerSpeed: Math.max(1, Number(ship.speed ?? 0), steps)
        });
        const collision = CollisionEngine.applyShipCollision(battle, preview);
        if (collision.applied) entries.push(`${ship.name}: дрейф заканчивается столкновением. ${collision.text}`);
        return entries;
      }
      if (!withinBoard(battle.board, x, y) || this.isBlockingTerrain(terrain, Number(ship.altitude ?? 0))) {
        const section = ship.sections?.midship ?? ship.sections?.bow ?? Object.values(ship.sections ?? {})[0];
        if (section) section.hp.value = Math.max(0, Number(section.hp?.value ?? 0) - (4 + steps));
        ship.speed = 0;
        entries.push(`${ship.name}: дрейф срывается столкновением; корпус получает ${4 + steps} урона.`);
        return entries;
      }
      ship.x = x;
      ship.y = y;
      moved += 1;
      const collisions = this.getHazardCollisions(terrain, Math.max(1, Number(ship.speed ?? 0)), Number(ship.altitude ?? 0));
      for (const collision of collisions) {
        const section = ship.sections?.[collision.section] ?? Object.values(ship.sections ?? {})[0];
        if (section) {
          section.hp.value = Math.max(0, Number(section.hp?.value ?? 0) - Number(collision.damage ?? 0));
          DamageEngine.addBreachOrFlooding(ship, section, Number(collision.flooding ?? 0), "удар о террейн");
        }
        if (collision.speedLoss) ship.speed = Math.max(0, Number(ship.speed ?? 0) - Number(collision.speedLoss ?? 0));
        entries.push(`${ship.name}: дрейф через опасный террейн. ${collision.text}`);
      }
    }
    if (moved > 0) entries.unshift(`${ship.name}: дрейфует по ветру на ${moved} клетк${moved === 1 ? "у" : "и"}.`);
    return entries;
  }

  static applyVerticalInertia(battle, ship) {
    if (!this.usesAltitude(battle)) {
      ship.altitude = 0;
      ship.verticalVelocity = 0;
      if (ship.flags) {
        delete ship.flags.falling;
        delete ship.flags.emergencyDescent;
      }
      return [];
    }
    const entries = [];
    ship.verticalVelocity = Math.max(-2, Math.min(2, Number(ship.verticalVelocity ?? 0)));
    const before = Number(ship.altitude ?? 0);
    const downdraft = this.shipInTerrain(battle, ship, "downdraft");
    if (!ship.verticalVelocity && !ship.flags?.falling && !downdraft) return [];
    let velocity = ship.flags?.falling ? Math.min(-1, ship.verticalVelocity - 1) : ship.verticalVelocity;
    if (downdraft && !ship.flags?.falling) {
      velocity -= 1;
      entries.push(`${ship.name}: нисходящий поток тянет вниз.`);
    }
    velocity = Math.max(-3, Math.min(2, velocity));
    if (!velocity && before > 0) {
      ship.verticalVelocity = 0;
      return entries;
    }
    const after = Math.max(ALTITUDE_MIN, Math.min(ALTITUDE_MAX, before + velocity));
    ship.altitude = after;
    ship.verticalVelocity = ship.flags?.falling ? Math.max(-3, velocity) : Math.trunc(velocity / 2);

    if (after !== before) entries.push(`${ship.name}: вертикальная инерция ${velocity > 0 ? "+" : ""}${velocity}; высота H${before} → H${after}.`);
    if (after > 0) return entries;
    if (before <= 0 && velocity >= 0) return entries;

    const terrain = this.getTerrain(battle, ship.x, ship.y);
    const landing = this.resolveLanding(ship, terrain, Math.abs(velocity), before);
    entries.push(landing.text);
    return entries;
  }

  static resolveLanding(ship, terrain, descentSpeed = 1, fallHeight = 0) {
    const terrainList = this.terrainList(terrain);
    const hardTerrain = terrainList.some(t => ["reef", "shoal", "wreck", "rockLow", "rockHigh"].includes(t));
    const emergency = Boolean(ship.flags?.emergencyDescent);
    const falling = Boolean(ship.flags?.falling);
    const hard = hardTerrain || emergency || falling || Number(descentSpeed ?? 0) >= 2;
    const damage = hard ? 6 + Number(descentSpeed ?? 1) * 4 + Math.max(0, Number(fallHeight ?? 0) - 1) : 2;
    const section = ship.sections?.midship ?? ship.sections?.bow ?? Object.values(ship.sections ?? {})[0];
    let landingDamageText = "";
    if (section) {
      section.hp.value = Math.max(0, Number(section.hp?.value ?? 0) - damage);
      if (hard) landingDamageText = DamageEngine.addBreachOrFlooding(ship, section, 1, "жесткая посадка");
    }
    ship.speed = Math.max(0, Number(ship.speed ?? 0) - (hard ? 2 : 1));
    ship.verticalVelocity = 0;
    ship.flags ??= {};
    delete ship.flags.emergencyDescent;
    if (ship.flags.falling) delete ship.flags.falling;
    const surface = hardTerrain ? "остров/скалы/мель" : "воду";
    const breachText = DamageEngine.activateBreachesAtWaterline(ship);
    ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    if (hard && damage >= 14) ship.crew.morale = Math.max(0, Number(ship.crew?.morale ?? 10) - 2);
    return { hard, damage, text: `${ship.name}: посадка на ${surface}. ${hard ? "Жесткий удар" : "Мягкое приводнение"}: корпус получает ${damage} урона.${landingDamageText}${breachText ? ` ${breachText}` : ""}` };
  }

  static applyAirTerrainEffects(battle, ship, { random = Math.random } = {}) {
    if (!this.usesAltitude(battle) || !this.shipInTerrain(battle, ship, "stormCloud")) return [];
    const entries = [];
    if (random() >= 0.5) return entries;
    const section = ship.sections?.midship ?? ship.sections?.bow ?? Object.values(ship.sections ?? {})[0];
    if (section) section.fire = Number(section.fire ?? 0) + 1;
    if (ship.crystal && ship.crystal.enabled !== false) {
      const maxHeat = Number(ship.crystal.maxHeat ?? 10);
      ship.crystal.heat = Math.min(maxHeat + 2, Number(ship.crystal.heat ?? 0) + 1);
    }
    entries.push(`${ship.name}: грозовое облако бьет разрядом: пожар +1${ship.crystal ? ", нагрев ядра +1" : ""}.`);
    return entries;
  }

  static advanceEndOfRoundMovement(battle, options = {}) {
    const entries = [];
    for (const ship of getCombatants(battle)) {
      if (!CombatantRules.supports(ship, "movement")) continue;
      if (ship.flags?.struck || ship.flags?.withdrawn || (this.usesCore(battle) && ship.flags?.coreExploded)) continue;
      if (ship.unitType === "creature") {
        entries.push(...CreatureMovementEngine.advanceEndOfRound(battle, ship, this, options));
        continue;
      }
      entries.push(...this.applyVerticalInertia(battle, ship));
      entries.push(...this.applyDrift(battle, ship));
      entries.push(...this.applyAirTerrainEffects(battle, ship, options));
    }
    CreatureGrappleEngine.syncAttached(battle);
    return entries;
  }

  static findSystem(ship, needle) {
    needle = String(needle ?? "").toLowerCase();
    for (const section of Object.values(ship?.sections ?? {})) {
      for (const system of section.systems ?? []) {
        if (String(system.name ?? "").toLowerCase().includes(needle)) return system;
      }
    }
    return null;
  }

  static getTerrain(battle, x, y) {
    const key = cellKey(x, y);
    return battle?.board?.terrain?.[key] ?? null;
  }

  static shipInTerrain(battle, ship, type) {
    const terrain = this.getTerrain(battle, ship?.x, ship?.y);
    return this.hasTerrain(terrain, type) && this.terrainAffectsAltitude(type, Number(ship?.altitude ?? 0));
  }

  static isBlockingTerrain(terrain, altitude = 0) {
    const list = this.terrainList(terrain);
    return list.some(type => Boolean(TERRAIN_PROFILE[type]?.blocks) && this.terrainAffectsAltitude(type, altitude));
  }

  static isHazardTerrain(terrain, altitude = 0) {
    const list = this.terrainList(terrain);
    return list.some(type => Boolean(TERRAIN_PROFILE[type]?.hazard) && this.terrainAffectsAltitude(type, altitude));
  }

  static getHazardCollisions(terrain, speed = 0, altitude = 0) {
    const list = this.terrainList(terrain);
    const results = [];
    const hard = Number(speed ?? 0) >= 3;

    if (list.includes("wreck") && this.terrainAffectsAltitude("wreck", altitude)) {
      results.push({
        section: "bow",
        damage: hard ? 3 : 2,
        flooding: 0,
        speedLoss: 0,
        text: hard
          ? "Обломки бьют по корпусу: нос получает 3 урона."
          : "Обломки цепляют корпус: нос получает 2 урона."
      });
    }

    if (list.includes("shoal") && this.terrainAffectsAltitude("shoal", altitude)) {
      results.push({ section: "midship", damage: 2, flooding: 0, speedLoss: 0, text: "Мель бьет по днищу: центр получает 2 урона." });
    }

    if (list.includes("reef") && this.terrainAffectsAltitude("reef", altitude)) {
      results.push({
        section: "bow",
        damage: hard ? 6 : 4,
        flooding: hard ? 1 : 0,
        speedLoss: hard ? 1 : 0,
        text: hard
          ? "Риф рвет нос и открывает течь: нос получает 6 урона, течь +1."
          : "Риф бьет по носу: нос получает 4 урона."
      });
    }

    if (list.includes("rockLow") && this.terrainAffectsAltitude("rockLow", altitude)) {
      results.push({
        section: "bow",
        damage: hard ? 7 : 5,
        flooding: hard ? 1 : 0,
        speedLoss: 1,
        text: hard
          ? "Низкие скалы рвут нос и дают течь: нос получает 7 урона, течь +1."
          : "Низкие скалы бьют по носу: нос получает 5 урона."
      });
    }

    return results;
  }

  static getHazardCollision(terrain, speed = 0, altitude = 0) {
    const collisions = this.getHazardCollisions(terrain, speed, altitude);
    if (!collisions.length) return null;
    if (collisions.length === 1) return collisions[0];
    return collisions.reduce((total, hit) => ({
      section: total.section ?? hit.section,
      damage: Number(total.damage ?? 0) + Number(hit.damage ?? 0),
      flooding: Number(total.flooding ?? 0) + Number(hit.flooding ?? 0),
      speedLoss: Math.max(Number(total.speedLoss ?? 0), Number(hit.speedLoss ?? 0)),
      text: [total.text, hit.text].filter(Boolean).join(" ")
    }), { section: "bow", damage: 0, flooding: 0, speedLoss: 0, text: "" });
  }

  static getMoveResult(battle, shipId, x, y) {
    const ship = getCombatant(battle, shipId);
    if (!ship) return { ok: false, ship: null, candidate: null, path: [] };
    const candidate = this.findReachableCell(battle, ship, x, y);
    if (!candidate) return { ok: false, ship, candidate: null, path: [] };
    const result = { ok: true, ship, candidate, path: candidate.path ?? this.getPathCells(ship, candidate.heading, candidate.steps, battle) };
    if (ship.unitType === "creature") result.creature = ship;
    return result;
  }

  static applyPathTerrainDamage(ship, path, speed) {
    const notes = [];
    for (const step of path ?? []) {
      const collisions = this.getHazardCollisions(step.terrain, speed, Number(ship.altitude ?? 0));
      if (!collisions.length) continue;
      const cellLabel = `${Number(step.x ?? 0) + 1}:${Number(step.y ?? 0) + 1}`;
      for (const collision of collisions) {
        const section = ship.sections?.[collision.section] ?? Object.values(ship.sections ?? {})[0];
        if (section) {
          section.hp ??= { value: 0, max: 0 };
          section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - Number(collision.damage ?? 0));
          DamageEngine.addBreachOrFlooding(ship, section, Number(collision.flooding ?? 0), "удар о террейн");
        }
        if (collision.speedLoss) ship.speed = Math.max(0, Number(ship.speed ?? 0) - Number(collision.speedLoss ?? 0));
        notes.push(`[${cellLabel}] ${collision.text}`);
      }
    }
    DamageEngine.checkStruck(ship, notes);
    return { notes, text: notes.length ? ` ${notes.join(" ")}` : "" };
  }

  static applyMoveResult(battle, result) {
    if (result?.ship?.unitType === "creature" || result?.creature?.unitType === "creature") {
      const creature = result.creature ?? result.ship;
      return CreatureMovementEngine.applyMoveResult(battle, { ...result, creature }, this);
    }
    if (!result?.ok || !result.ship || !result.candidate || !CombatantRules.supports(result.ship, "movement")) return { ok: false };
    const ship = result.ship;
    const candidate = result.candidate;
    const start = {
      x: Number(ship.x ?? 0),
      y: Number(ship.y ?? 0),
      heading: Number(ship.heading ?? 0),
      speed: Number(ship.speed ?? 0)
    };
    const inertia = this.applyMoveInertia(ship, candidate);
    const traversedPath = candidate.collision ? (result.path ?? []).slice(0, -1) : (result.path ?? []);
    const terrain = this.applyPathTerrainDamage(ship, traversedPath, start.speed);
    ship.x = Number(candidate.stopX ?? candidate.x);
    ship.y = Number(candidate.stopY ?? candidate.y);
    ship.heading = Number(candidate.heading ?? ship.heading ?? 0);
    const collision = CollisionEngine.applyShipCollision(battle, candidate.collision);
    const towed = ship.flags?.towingId ? getCombatant(battle, ship.flags.towingId) : null;
    if (towed) { towed.x = start.x; towed.y = start.y; towed.altitude = ship.altitude; towed.heading = ship.heading; towed.speed = ship.speed; }
    OccupancyEngine.reserveMovement(battle, ship, result.path ?? [], {
      startX: start.x,
      startY: start.y,
      startHeading: start.heading,
      stopX: ship.x,
      stopY: ship.y
    });
    this.recordMovementEvent(battle, ship, { start, path: traversedPath, collision });
    CreatureGrappleEngine.syncAttached(battle, ship);
    return { ok: true, ship, candidate, start, inertia, terrain, collision };
  }

  static recordMovementEvent(battle, ship, { start, path = [], collision = null } = {}) {
    const timestamp = Date.now();
    const id = `movement-${Number(battle?.round ?? 1)}-${ship.id}-${timestamp}`;
    battle.lastMovement = {
      id,
      shipId: ship.id,
      round: Number(battle?.round ?? 1),
      phase: String(battle?.phase ?? "movement"),
      timestamp,
      start: { x: Number(start?.x ?? ship.x ?? 0), y: Number(start?.y ?? ship.y ?? 0), heading: Number(start?.heading ?? ship.heading ?? 0) },
      path: path.map(cell => ({ x: Number(cell.x ?? 0), y: Number(cell.y ?? 0), heading: Number(cell.heading ?? ship.heading ?? 0) })),
      end: { x: Number(ship.x ?? 0), y: Number(ship.y ?? 0), heading: Number(ship.heading ?? 0) },
      collision: Boolean(collision?.applied)
    };
    battle.lastAudioEvent = {
      id: `audio-${id}`,
      type: collision?.applied ? "collision" : "movement",
      shipId: ship.id,
      timestamp
    };
    return battle.lastMovement;
  }

  static moveShip(battle, shipId, x, y) {
    const result = this.getMoveResult(battle, shipId, x, y);
    if (!result.ok) return false;
    return Boolean(this.applyMoveResult(battle, result).ok);
  }

  static increaseSpeed(battle, shipId) {
    const ship = getCombatant(battle, shipId);
    if (!ship) return { ok: false, reason: "Корабль не найден." };
    if (!CombatantRules.supports(ship, "movement")) return { ok: false, reason: CombatantRules.getMovementBlockReason(ship, battle) ?? "Движение недоступно." };
    if (ship.unitType === "creature") return CreatureMovementEngine.increaseSpeed(battle, ship);
    if ((ship.flags?.grappledWith && !ship.flags?.towingId) || ship.flags?.struck || (this.usesCore(battle) && ship.flags?.falling) || ship.flags?.immobilized) return { ok: false, reason: "Корабль не может набирать ход в текущем состоянии." };
    if (WindEngine.getPointOfSail(ship, battle?.wind ?? {}) === "inIrons" || ship.flags?.inIrons) {
      ship.flags ??= {};
      ship.flags.inIrons = true;
      ship.speed = 0;
      return { ok: false, reason: "Корабль стоит носом против ветра: сперва выйдите из ветра поворотом." };
    }
    const inertia = this.getInertiaProfile(battle, ship);
    const effectiveMax = inertia.effectiveMax;
    const before = Number(ship.speed ?? 0);
    if (before >= effectiveMax) return { ok: false, before, after: before, effectiveMax, acceleration: inertia.acceleration, reason: "Предел хода уже достигнут." };
    ship.speed = Math.min(effectiveMax, before + inertia.acceleration);
    return { ok: ship.speed > before, before, after: ship.speed, effectiveMax, acceleration: inertia.acceleration, reason: ship.speed > before ? "" : "Предел хода уже достигнут." };
  }

  static reduceSpeed(battle, shipId) {
    const ship = getCombatant(battle, shipId);
    if (!ship) return { ok: false, reason: "Корабль не найден." };
    if (!CombatantRules.supports(ship, "movement")) return { ok: false, reason: CombatantRules.getMovementBlockReason(ship, battle) ?? "Движение недоступно." };
    if (ship.unitType === "creature") return CreatureMovementEngine.reduceSpeed(battle, ship);
    const inertia = this.getInertiaProfile(battle, ship);
    const before = Number(ship.speed ?? 0);
    ship.speed = Math.max(0, before - inertia.braking);
    return { ok: ship.speed < before, before, after: ship.speed, braking: inertia.braking };
  }
}
