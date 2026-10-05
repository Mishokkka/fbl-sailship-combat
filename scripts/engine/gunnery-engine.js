import {
  angleBetween,
  bearingBetween,
  cellKey,
  directionToCell,
  distanceCells,
  lineCells,
  normalizeAngle,
  normalizeHeading,
  rotateHeading,
  withinBoard
} from "../board/board-geometry.js";
import { AMMO_LABELS, FIRE_MODE_LABELS, HEX_SCALE_METERS, SECTION_LABELS, WEAPON_DAMAGE_MULTIPLIER, WEAPON_TYPE_LABELS } from "../utils/constants.js";
import { roll3d6 } from "../utils/random.js";
import { DamageEngine } from "./damage-engine.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { MovementEngine } from "./movement-engine.js";
import { getCombatant, getCombatants } from "../utils/combatants.js";

const ARC_ORDER = ["port", "starboard", "bow", "stern", "mortar", "swivel"];

const WEAPON_PROFILES = {
  longGun: {
    label: "длинные пушки",
    allowedAmmo: ["roundShot", "chainShot", "grapeShot", "heatedShot"],
    minRange: 1,
    rangeBonus: 0,
    damageMod: 0,
    reloadMod: 0,
    optimalRange: "150-500 м",
    notes: "Длинные гладкоствольные пушки решают бой на 150-300 м, но тяжелые 18-32-фунтовые батареи остаются полезны и на 500-800 м как огонь по корпусу и рангоуту.",
    arcNotes: "Бортовые длинные пушки используют широкую бортовую дугу: портовые лафеты дают ограниченный, но достаточный разворот вдоль борта."
  },
  carronade: {
    label: "карронады",
    allowedAmmo: ["roundShot", "grapeShot", "heatedShot"],
    minRange: 1,
    rangeBonus: 0,
    damageMod: 3,
    reloadMod: -1,
    optimalRange: "50-200 м",
    notes: "Карронады бьют тяжелым ядром при малом весе орудия. Они страшны до 200 м, терпимы до 300-400 м и почти бесполезны вне ближнего боя.",
    arcNotes: "Дуга обычно такая же бортовая, как у пушки в порту, но практический смысл карронады почти весь на короткой дистанции."
  },
  chaser: {
    label: "чэйзеры",
    allowedAmmo: ["roundShot", "chainShot"],
    minRange: 1,
    rangeBonus: 0,
    damageMod: -1,
    reloadMod: -1,
    optimalRange: "150-500 м",
    notes: "Чэйзеры стреляют вперед или назад при погоне. Это малое число длинных пушек: дальность хорошая, но дуга узкая и залп слабее борта.",
    arcNotes: "Носовые и кормовые чэйзеры имеют узкую дугу по курсу или против курса."
  },
  mortar: {
    label: "мортиры",
    allowedAmmo: ["shellBomb"],
    minRange: 6,
    rangeBonus: 0,
    damageMod: 4,
    reloadMod: 1,
    lobbed: true,
    optimalRange: "600-1000 м",
    notes: "Мортиры бьют навесом бомбами. Исторически это осадное оружие против гаваней и стоянок; в воздушном бою оно полезно против скученных или медленных целей, но плохо работает в упор.",
    arcNotes: "Мортиры используют круговой выбор цели, но имеют большую минимальную дистанцию."
  },
  swivel: {
    label: "поворотные пушки",
    allowedAmmo: ["grapeShot", "roundShot"],
    minRange: 1,
    rangeBonus: 0,
    damageMod: 0,
    reloadMod: -1,
    optimalRange: "до 100 м",
    notes: "Поворотные пушки — мелкое палубное оружие для картечи, абордажа и добивания на совсем близкой дистанции.",
    arcNotes: "Поворотные пушки имеют круговой выбор цели, но почти не работают дальше палубной дистанции."
  }
};

export class GunneryEngine {
  static getArcOrder() {
    return ARC_ORDER;
  }

  static getBattery(ship, arc) {
    return ship?.weapons?.find(w => w.arc === arc) ?? null;
  }

  static isCrystalCoreAim(options = {}) {
    return options?.aimedSection === "crystalCore";
  }

  static canSideTargetCrystalCore(battle, sideId) {
    if (!MovementEngine.usesCore(battle)) return false;
    if (!sideId) return false;
    return battle?.setup?.coreTargeting?.[sideId] !== false;
  }

  static canAttackerTargetCrystalCore(battle, attacker) {
    return this.canSideTargetCrystalCore(battle, attacker?.side);
  }

  static validateCoreTargetingPolicy(battle, attacker, options = {}) {
    if (!this.isCrystalCoreAim(options)) return { ok: true };
    if (!MovementEngine.usesCore(battle)) {
      return { ok: false, text: `${attacker?.name ?? "Корабль"}: в этом режиме боя нельзя целиться по ядру кристалла.` };
    }
    if (!this.canAttackerTargetCrystalCore(battle, attacker)) {
      const side = battle?.setup?.sides?.[attacker?.side]?.name ?? attacker?.side ?? "сторона";
      return { ok: false, text: `${attacker?.name ?? "Корабль"}: стороне ${side} запрещен прицельный огонь по ядру кристалла.` };
    }
    return { ok: true };
  }

  static recordDishonorableCoreShot(battle, result) {
    if (!battle || result?.aimedSection !== "crystalCore") return;
    battle.dishonorableCoreShots ??= [];
    const attacker = result.attacker ?? null;
    const target = result.target ?? null;
    if (attacker) {
      attacker.flags ??= {};
      attacker.flags.dishonorableCoreShooter = true;
    }
    if (target) {
      target.flags ??= {};
      target.flags.dishonorableCoreTargeted = true;
    }
    const index = battle.dishonorableCoreShots.length + 1;
    battle.dishonorableCoreShots.push({
      id: `core-shot-${index}`,
      round: Number(battle.round ?? 1),
      phase: String(battle.phase ?? "gunnery"),
      attackerId: attacker?.id ?? null,
      attackerName: attacker?.name ?? "",
      attackerSide: attacker?.side ?? "",
      targetId: target?.id ?? null,
      targetName: target?.name ?? "",
      targetSide: target?.side ?? "",
      arc: result.battery?.arc ?? null,
      hit: Boolean(result.hit)
    });
  }

  static getWeaponType(battery) {
    const type = String(battery?.type ?? "");
    if (WEAPON_PROFILES[type]) return type;
    const arc = String(battery?.arc ?? battery?.id ?? "");
    const label = String(battery?.label ?? "").toLowerCase();
    if (arc === "mortar" || label.includes("морт")) return "mortar";
    if (arc === "swivel" || label.includes("поворот")) return "swivel";
    if (["bow", "stern"].includes(arc) || label.includes("чэйзер")) return "chaser";
    if (label.includes("карронад")) return "carronade";
    return "longGun";
  }

  static getWeaponProfile(battery) {
    return WEAPON_PROFILES[this.getWeaponType(battery)] ?? WEAPON_PROFILES.longGun;
  }

  static getAllowedAmmo(battery) {
    return this.getWeaponProfile(battery).allowedAmmo ?? ["roundShot"];
  }

  static canUseHeatedShot(battle, ship) {
    return Boolean(ship?.equipment?.heatedShotFurnace || battle?.setup?.heatedShot?.[ship?.side]);
  }

  static getAvailableAmmo(battle, ship, battery) {
    return this.getAllowedAmmo(battery).filter(ammo => ammo !== "heatedShot" || this.canUseHeatedShot(battle, ship));
  }

  static getAllowedFireModes(battery) {
    const type = this.getWeaponType(battery);
    if (type === "swivel") return ["full", "ranging"];
    if (type === "mortar") return ["full", "ranging", "delayed"];
    return ["full", "partial", "ranging", "delayed"];
  }

  static normalizeFireModeForWeapon(battery) {
    const allowed = this.getAllowedFireModes(battery);
    if (!allowed.includes(battery.fireMode)) battery.fireMode = allowed[0] ?? "full";
    return battery.fireMode;
  }

  static normalizeAmmoForWeapon(battery) {
    const allowed = this.getAllowedAmmo(battery);
    if (!allowed.includes(battery.ammo)) battery.ammo = allowed[0] ?? "roundShot";
    return battery.ammo;
  }

  static getArcHeading(ship, arc) {
    const heading = Number(ship?.heading ?? 0);
    if (arc === "bow") return normalizeHeading(heading);
    if (arc === "stern") return normalizeHeading(heading + 180);
    if (arc === "port") return normalizeAngle(heading - 90);
    if (arc === "starboard") return normalizeAngle(heading + 90);
    return normalizeHeading(heading);
  }

  static getTargets(battle, attacker, arc, options = {}) {
    if (!CombatantRules.supports(attacker, "gunnery")) return [];
    const battery = this.getBattery(attacker, arc);
    if (!battery || Number(battery.reload ?? 0) > 0 || !this.isBatteryFunctional(attacker, battery)) return [];
    if (this.isCrystalCoreAim(options) && !this.canAttackerTargetCrystalCore(battle, attacker)) return [];
    this.normalizeAmmoForWeapon(battery);
    this.normalizeFireModeForWeapon(battery);

    const arcHeading = this.getArcHeading(attacker, arc);
    const maxRange = this.getEffectiveRange(battery);
    const minRange = this.getMinimumRange(battery);
    const altitudeLimit = this.getAltitudeLimit(battery);
    const aimedSection = options.aimedSection ?? null;
    const targets = [];

    for (const target of getCombatants(battle)) {
      if (target.id === attacker.id
        || target.side === attacker.side
        || !CombatantRules.supports(target, "targetable")
        || !CombatantRules.isActive(target)) continue;

      const hexDirection = directionToCell(attacker, target);
      if (!this.isDirectionInArc(attacker, arc, hexDirection)) continue;
      const range = distanceCells(attacker, target);
      if (range > maxRange || range < minRange) continue;
      const altitudeDelta = Math.abs(Number(attacker.altitude ?? 0) - Number(target.altitude ?? 0));
      if (altitudeDelta > altitudeLimit) continue;
      if (this.shotBlockedByTerrain(battle, attacker, target, battery)) continue;

      const bearing = bearingBetween(attacker, target);
      const arcDelta = angleBetween(arcHeading, bearing);
      const autoSection = DamageEngine.chooseHitSection(attacker, target);
      const preview = this.getShotPreview(battle, attacker, target, battery, range, { aimedSection, autoSection, altitudeDelta });
      targets.push({ target, bearing, hexDirection, arcDelta, range, preview, autoSection, aimedSection, altitudeDelta });
    }

    return targets.sort((a, b) => a.range - b.range);
  }

  static getArcDirections(ship, arc) {
    const heading = normalizeHeading(ship?.heading ?? 0);
    if (arc === "bow") return [heading];
    if (arc === "stern") return [rotateHeading(heading, 3)];
    if (arc === "port") return [rotateHeading(heading, -1), rotateHeading(heading, -2)];
    if (arc === "starboard") return [rotateHeading(heading, 1), rotateHeading(heading, 2)];
    if (arc === "mortar" || arc === "swivel") return [0, 60, 120, 180, 240, 300];
    return [heading];
  }

  static isDirectionInArc(ship, arc, direction) {
    const normalized = normalizeHeading(direction);
    return this.getArcDirections(ship, arc).includes(normalized);
  }

  static isBearingInArc(ship, arc, bearing) {
    return this.isDirectionInArc(ship, arc, normalizeHeading(bearing));
  }

  static getArcCells(battle, ship, arc, range = 0) {
    const battery = this.getBattery(ship, arc) ?? { arc, range };
    const maxRange = Math.max(0, Number(range ?? this.getEffectiveRange(battery) ?? 0));
    const minRange = this.getMinimumRange(battery);
    const cells = [];
    const board = battle?.board ?? {};
    for (let y = 0; y < Number(board.height ?? 0); y++) {
      for (let x = 0; x < Number(board.width ?? 0); x++) {
        if (Number(x) === Number(ship?.x ?? 0) && Number(y) === Number(ship?.y ?? 0)) continue;
        const cell = { x, y };
        const distance = distanceCells(ship, cell);
        if (distance < minRange || distance > maxRange) continue;
        const direction = directionToCell(ship, cell);
        if (!this.isDirectionInArc(ship, arc, direction)) continue;
        if (this.shotBlockedByTerrain(battle, ship, cell, battery)) continue;
        if (!withinBoard(board, x, y)) continue;
        cells.push({ x, y, key: cellKey(x, y), range: distance, direction });
      }
    }
    return cells;
  }

  static getPracticalRangeLimit(battery) {
    const type = this.getWeaponType(battery);
    const weaponCaps = { longGun: 16, carronade: 6, chaser: 14, mortar: 20, swivel: 3 };
    const ammo = battery?.ammo ?? "roundShot";
    const ammoCaps = { grapeShot: 3, chainShot: 8, heatedShot: 12, shellBomb: 20, roundShot: 99 };
    return Math.min(weaponCaps[type] ?? 16, ammoCaps[ammo] ?? 99);
  }

  static getEffectiveRange(battery) {
    const profile = this.getWeaponProfile(battery);
    const configured = Math.max(1, Number(battery?.range ?? 1) + Number(profile.rangeBonus ?? 0));
    return Math.max(1, Math.min(configured, this.getPracticalRangeLimit(battery)));
  }

  static getMinimumRange(battery) {
    return Math.max(1, Number(this.getWeaponProfile(battery).minRange ?? 1));
  }

  static getRangeMeters(range) {
    return Math.max(0, Number(range ?? 0)) * HEX_SCALE_METERS;
  }

  static getRangeBandText(battery) {
    const min = this.getMinimumRange(battery);
    const max = this.getEffectiveRange(battery);
    const profile = this.getWeaponProfile(battery);
    return `${min}-${max} гекс. (${this.getRangeMeters(min)}-${this.getRangeMeters(max)} м); рабочая зона: ${profile.optimalRange ?? "по ситуации"}`;
  }

  static getWeaponNotes(battery) {
    return this.getWeaponProfile(battery).notes ?? "";
  }

  static getAltitudeLimit(battery) {
    return this.getWeaponType(battery) === "mortar" ? 6 : 3;
  }

  static getEffectiveBaseDamage(battery) {
    return Math.max(1, Number(battery?.damage ?? 1) + Number(this.getWeaponProfile(battery).damageMod ?? 0));
  }

  static getShotPreview(battle, attacker, target, battery, range, options = {}) {
    const normalizedAmmo = this.normalizeAmmoForWeapon(battery);
    const availableAmmo = this.getAvailableAmmo(battle, attacker, battery);
    const ammo = availableAmmo.includes(normalizedAmmo) ? normalizedAmmo : (availableAmmo[0] ?? normalizedAmmo);
    const weaponType = this.getWeaponType(battery);
    const fireMode = battery.fireMode ?? "full";
    const rangeMod = this.getRangeModifier(battery, range);
    const ammoMod = this.getAmmoModifier(battery, ammo, range);
    const crewMod = this.getCrewModifier(attacker, battery);
    const environmentMod = this.getEnvironmentModifier(battle, attacker, target, battery);
    const orderMod = this.getOrderModifier(attacker);
    const statusMod = this.getTargetStatusModifier(target);
    const aimMod = options.aimedSection === "crystalCore" ? -4 : (options.aimedSection ? -2 : 0);
    const altitudeDelta = Number(options.altitudeDelta ?? Math.abs(Number(attacker?.altitude ?? 0) - Number(target?.altitude ?? 0)));
    const altitudeMod = this.getAltitudeModifier(altitudeDelta, battery);
    const broadsideMod = this.getBroadsideStabilityModifier(attacker, battery);
    const fireModeMod = this.getFireModeModifier(battery, target);
    const maneuverMod = this.getManeuverShotModifier(attacker);
    const targetMovementMod = this.getTargetMovementModifier(target, battery);
    const grapplePointBlankMod = this.getGrapplePointBlankModifier(attacker, target, battery);
    const skill = 10 + rangeMod + ammoMod + crewMod + environmentMod + orderMod + statusMod + aimMod + altitudeMod + broadsideMod + fireModeMod + maneuverMod + targetMovementMod + grapplePointBlankMod;
    const targetSection = options.aimedSection === "crystalCore" ? "stern" : (options.aimedSection ?? options.autoSection ?? DamageEngine.chooseHitSection(attacker, target));
    const expectedDamage = this.getExpectedDamage(battery, ammo, skill, { fireMode, range });
    const modifierBreakdown = this.getModifierBreakdown({ rangeMod, ammoMod, crewMod, environmentMod, orderMod, statusMod, aimMod, altitudeMod, broadsideMod, fireModeMod, maneuverMod, targetMovementMod, grapplePointBlankMod });
    return {
      skill,
      hitChance: fireMode === "delayed" ? 100 : this.getHitProbability(skill),
      rangeMod,
      ammoMod,
      crewMod,
      environmentMod,
      orderMod,
      statusMod,
      aimMod,
      broadsideMod,
      altitudeDelta,
      altitudeMod,
      fireModeMod,
      maneuverMod,
      targetMovementMod,
      grapplePointBlankMod,
      ammo,
      weaponType,
      weaponTypeLabel: WEAPON_TYPE_LABELS[weaponType] ?? weaponType,
      fireMode,
      fireModeLabel: FIRE_MODE_LABELS[fireMode] ?? fireMode,
      minRange: this.getMinimumRange(battery),
      maxRange: this.getEffectiveRange(battery),
      minRangeMeters: this.getRangeMeters(this.getMinimumRange(battery)),
      maxRangeMeters: this.getRangeMeters(this.getEffectiveRange(battery)),
      rangeBandText: this.getRangeBandText(battery),
      weaponNotes: this.getWeaponNotes(battery),
      targetSection,
      targetSectionLabel: options.aimedSection === "crystalCore" ? SECTION_LABELS.crystalCore : (SECTION_LABELS[targetSection] ?? targetSection),
      expectedDamage,
      modifierBreakdown,
      modText: this.formatModifierTextFromBreakdown(modifierBreakdown),
      modeText: this.getFireModeText(battery, target)
    };
  }

  static getRangeModifier(battery, range) {
    const type = this.getWeaponType(battery);
    range = Number(range ?? 0);
    if (type === "carronade") return range <= 1 ? 2 : range <= 2 ? 1 : range <= 3 ? -1 : range <= 4 ? -3 : range <= 6 ? -5 : -7;
    if (type === "chaser") return range <= 3 ? 1 : range <= 6 ? 0 : range <= 9 ? -2 : range <= 12 ? -4 : range <= 14 ? -6 : -8;
    if (type === "mortar") return range <= 10 ? -1 : range <= 14 ? -2 : range <= 20 ? -5 : -7;
    if (type === "swivel") return range <= 1 ? 1 : range <= 2 ? -2 : -5;
    return range <= 2 ? 1 : range <= 4 ? 0 : range <= 8 ? -2 : range <= 12 ? -4 : range <= 16 ? -6 : -8;
  }

  static getAmmoModifier(battery, ammo, range) {
    range = Number(range ?? 0);
    if (ammo === "grapeShot") return range <= 1 ? 1 : range <= 2 ? -1 : range <= 3 ? -4 : -7;
    if (ammo === "chainShot") return range <= 3 ? 0 : range <= 5 ? -2 : range <= 8 ? -5 : -7;
    if (ammo === "heatedShot") return range <= 4 ? 0 : range <= 8 ? -2 : range <= 12 ? -5 : -7;
    if (ammo === "shellBomb") return range <= 10 ? -1 : range <= 14 ? -3 : range <= 20 ? -5 : -7;
    return 0;
  }


  static getGrapplePointBlankModifier(attacker, target, battery) {
    if (!attacker?.flags?.grappledWith || attacker.flags.grappledWith !== target?.id) return 0;
    const arc = String(battery?.arc ?? "");
    const targetDirection = directionToCell(attacker, target);
    return this.isDirectionInArc(attacker, arc, targetDirection) ? 10 : 0;
  }

  static getFireModeModifier(battery, target) {
    const mode = battery?.fireMode ?? "full";
    const delayed = battery?.delayed ? 2 : 0;
    const ranging = battery?.rangingTargetId && target?.id === battery.rangingTargetId ? 1 : 0;
    const modeMod = mode === "partial" ? 1 : mode === "ranging" ? 2 : 0;
    return delayed + ranging + modeMod;
  }

  static getManeuverShotModifier(ship) {
    return ship?.flags?.sharpManeuver ? -1 : 0;
  }

  static getTargetMovementModifier(target, battery) {
    if (this.getWeaponType(battery) !== "mortar") return 0;
    const speed = Math.max(0, Number(target?.speed ?? 0));
    if (speed <= 0) return 0;
    const speedPenalty = speed >= 4 ? -4 : speed >= 2 ? -3 : -2;
    return speedPenalty + (target?.flags?.sharpManeuver ? -1 : 0);
  }

  static getFireModeText(battery, target) {
    const fragments = [];
    const mode = battery?.fireMode ?? "full";
    if (mode === "partial") fragments.push("частичный залп: +1 к попаданию, меньше урон и короче перезарядка");
    if (mode === "ranging") fragments.push("пристрелка: +2 к попаданию, половинный урон, следующий залп по той же цели получает +1");
    if (mode === "delayed") fragments.push("задержка залпа: батарея не стреляет сейчас, а готовит +2 к следующему настоящему залпу");
    if (battery?.delayed) fragments.push("залп уже задержан: +2 к броску");
    if (battery?.rangingTargetId && target?.id === battery.rangingTargetId) fragments.push("цель пристреляна: +1");
    return fragments.join("; ") || "полный залп без особого режима";
  }

  static getHitProbability(skill) {
    const threshold = Math.floor(Number(skill ?? 0));
    if (threshold < 3) return 0;
    if (threshold >= 18) return 100;
    const cumulative = { 3: 1, 4: 4, 5: 10, 6: 20, 7: 35, 8: 56, 9: 81, 10: 108, 11: 135, 12: 160, 13: 181, 14: 196, 15: 206, 16: 212, 17: 215 };
    return Math.round(((cumulative[threshold] ?? 0) / 216) * 100);
  }

  static getAltitudeModifier(delta = 0, battery = null) {
    delta = Math.max(0, Number(delta ?? 0));
    if (this.getWeaponType(battery) === "mortar") return delta <= 1 ? 0 : delta <= 3 ? -1 : -3;
    if (delta <= 0) return 0;
    if (delta === 1) return -1;
    if (delta === 2) return -3;
    return -5;
  }

  static getExpectedDamage(battery, ammo, skill, { fireMode = battery?.fireMode ?? "full", range = null } = {}) {
    if (fireMode === "delayed") return 0;
    const base = Math.max(1, Math.round(this.getEffectiveBaseDamage(battery) * WEAPON_DAMAGE_MULTIPLIER));
    const reliableMargin = Math.max(0, Math.floor((Number(skill ?? 10) - 10) / 2));
    let value = base + reliableMargin;
    const closeBonus = Number(battery?.closeDamageBonus ?? 0);
    const closeRange = Number(battery?.closeDamageRange ?? 0);
    if (closeBonus > 0 && closeRange > 0 && Number(range ?? 999) <= closeRange) value += Math.round(closeBonus * WEAPON_DAMAGE_MULTIPLIER);
    if (ammo === "chainShot") value = Math.max(1, Math.floor(value / 2));
    if (ammo === "grapeShot") value = Math.max(1, Math.ceil(value / 4));
    if (ammo === "shellBomb") value = Math.max(1, Math.ceil(value * 0.9));
    if (fireMode === "partial") value = Math.max(1, Math.ceil(value * 0.6));
    if (fireMode === "ranging") value = Math.max(1, Math.ceil(value * 0.5));
    return value;
  }

  static getModifierBreakdown(mods) {
    return [
      { key: "range", label: "Дистанция", shortLabel: "дист.", value: mods.rangeMod, title: "Модификатор зависит от типа орудий и дистанции." },
      { key: "ammo", label: "Боеприпас", shortLabel: "боепр.", value: mods.ammoMod, title: "Картечь резко проседает за 100-150 м; книппели хуже на дальней дистанции; дальние бомбы сложнее класть точно." },
      { key: "crew", label: "Экипаж", shortLabel: "экип.", value: mods.crewMod, title: "Учитывает качество экипажа, нехватку людей, подавление и требование батареи." },
      { key: "environment", label: "Среда", shortLabel: "среда", value: mods.environmentMod, title: "Видимость, состояние моря, дым, облака, турбулентность и стрельба через низкие скалы." },
      { key: "order", label: "Приказ", shortLabel: "приказ", value: mods.orderMod, title: "«Готовить залп» дает +1; неподходящие приказы дают -1." },
      { key: "target", label: "Цель", shortLabel: "цель", value: mods.statusMod, title: "Сцепленная, подавленная или потерявшая ход цель легче для попадания." },
      { key: "aim", label: "Прицел", shortLabel: "прицел", value: mods.aimMod, title: "Прицел по секции дает -2; прицел по ядру кристалла дает -4." },
      { key: "altitude", label: "Высота", shortLabel: "высота", value: mods.altitudeMod, title: "Разница высот усложняет залп; мортиры переносят высоту легче." },
      { key: "broadside", label: "Борт", shortLabel: "борт", value: mods.broadsideMod, title: "Бортовой залп устойчивее на малом ходу и хуже на слишком большом." },
      { key: "mode", label: "Режим", shortLabel: "режим", value: mods.fireModeMod, title: "Частичный залп, пристрелка и задержанный залп меняют шанс попадания." },
      { key: "maneuver", label: "Маневр", shortLabel: "маневр", value: mods.maneuverMod, title: "После резкого маневра стрельба получает -1 до конца раунда." },
      { key: "movingTarget", label: "Движущаяся цель", shortLabel: "движ. цель", value: mods.targetMovementMod, title: "Мортирной бомбе трудно попасть в движущийся корабль; быстрый или резко маневрирующий корабль получает больший защитный эффект." },
      { key: "grapplePointBlank", label: "Сцепка в упор", shortLabel: "в упор", value: mods.grapplePointBlankMod, title: "Сцепленные корабли, стоящие в фактической дуге батареи, получают +10: промах почти невозможен." }
    ].map(row => ({ ...row, value: Number(row.value ?? 0), valueText: `${Number(row.value ?? 0) >= 0 ? "+" : ""}${Number(row.value ?? 0)}`, active: Number(row.value ?? 0) !== 0 }));
  }

  static formatModifierText(mods) {
    return this.formatModifierTextFromBreakdown(this.getModifierBreakdown(mods));
  }

  static formatModifierTextFromBreakdown(modifierBreakdown) {
    return modifierBreakdown.filter(row => row.active).map(row => `${row.shortLabel} ${row.valueText}`).join(", ") || "без модификаторов";
  }

  static getOrderModifier(ship) {
    const order = ship?.selectedOrder;
    if (order === "steadyGunnery") return 1;
    if (["pressSail", "damageControl", "boarding", "brace"].includes(order)) return -1;
    return 0;
  }

  static getEnvironmentModifier(battle, attacker = null, target = null, battery = null) {
    const visibility = battle?.sea?.visibility ?? "clear";
    const sea = battle?.sea?.state ?? "calm";
    const visibilityMod = { clear: 0, haze: -1, fog: -2, night: -2 }[visibility] ?? 0;
    const seaMod = { calm: 0, choppy: 0, rough: -1, storm: -2 }[sea] ?? 0;
    const smokeMod = this.getSmokeModifier(battle, attacker, target, battery);
    const rockMod = this.getRockModifier(battle, attacker, target, battery);
    return visibilityMod + seaMod + smokeMod + rockMod;
  }

  static getSmokeModifier(battle, attacker, target, battery = null) {
    return this.getObscuringTerrainModifier(battle, attacker, target, battery);
  }

  static getObscuringTerrainModifier(battle, attacker, target, battery = null) {
    if (this.getWeaponType(battery) === "mortar") return 0;
    const terrain = battle?.board?.terrain ?? {};
    if (!attacker || !target || !terrain) return 0;
    let mod = 0;
    const types = [
      { id: "smoke", attacker: -1, target: -2, line: -1 },
      { id: "cloud", attacker: -1, target: -2, line: -1 },
      { id: "stormCloud", attacker: -2, target: -3, line: -2 },
      { id: "turbulence", attacker: -1, target: -1, line: -1 }
    ];
    for (const type of types) {
      if (this.shipInTerrain(terrain, attacker, type.id)) mod += type.attacker;
      if (this.shipInTerrain(terrain, target, type.id)) mod += type.target;
      if (this.lineCrossesTerrain(battle, attacker, target, type.id)) mod += type.line;
    }
    return Math.max(-6, mod);
  }

  static shipInTerrain(terrain, ship, type) {
    return MovementEngine.hasTerrain(terrain[cellKey(ship?.x, ship?.y)], type) && MovementEngine.terrainAffectsAltitude(type, Number(ship?.altitude ?? 0));
  }

  static getRockModifier(battle, attacker, target, battery = null) {
    if (!attacker || !target || this.getWeaponType(battery) === "mortar") return 0;
    return this.lineCrossesTerrain(battle, attacker, target, "rockLow") ? -2 : 0;
  }

  static shotBlockedByTerrain(battle, attacker, target, battery) {
    if (this.getWeaponType(battery) === "mortar") return false;
    return this.lineCrossesTerrain(battle, attacker, target, "rockHigh") || this.lineCrossesTerrain(battle, attacker, target, "skyIsland");
  }

  static lineCrossesTerrain(battle, attacker, target, terrainType) {
    const terrain = battle?.board?.terrain ?? {};
    const altitude = Math.min(Number(attacker?.altitude ?? 0), Number(target?.altitude ?? 0));
    const line = lineCells(attacker, target);
    for (const cell of line.slice(1, -1)) {
      const cellTerrain = terrain[cellKey(cell.x, cell.y)];
      if (MovementEngine.hasTerrain(cellTerrain, terrainType) && MovementEngine.terrainAffectsAltitude(terrainType, altitude)) return true;
    }
    return false;
  }

  static getTargetStatusModifier(target) {
    let mod = 0;
    if (target?.flags?.grappledWith) mod += 1;
    if (target?.flags?.inIrons) mod += 1;
    if (target?.flags?.suppressed) mod += 1;
    if (Number(target?.flags?.camouflaged ?? 0) > 0) mod -= 2;
    return mod;
  }

  static getBroadsideStabilityModifier(attacker, battery) {
    if (!["port", "starboard"].includes(battery?.arc)) return 0;
    const speed = Number(attacker?.speed ?? 0);
    if (speed <= 1) return 1;
    if (speed >= 5) return -1;
    return 0;
  }

  static getCrewModifier(ship, battery) {
    const crew = ship?.crew ?? {};
    const current = Number(crew.current ?? 0);
    const required = Number(crew.required ?? 1);
    const quality = Number(ship?.stats?.crewQuality ?? 0);
    const ratio = required > 0 ? current / required : 1;
    const crewPenalty = ratio < 0.25 ? -4 : ratio < 0.5 ? -2 : ratio < 0.75 ? -1 : 0;
    const batteryCrew = Number(battery?.crewRequired ?? 0);
    const extraPenalty = current > 0 && batteryCrew > 0 && current < batteryCrew ? -3 : 0;
    const suppressionPenalty = ship?.flags?.suppressed ? -1 : 0;
    return quality + crewPenalty + extraPenalty + suppressionPenalty;
  }

  static isBatteryFunctional(ship, battery) {
    const names = this.getLinkedSystemNames(battery.arc);
    if (!names.length) return true;
    for (const section of Object.values(ship?.sections ?? {})) {
      for (const system of section.systems ?? []) {
        const name = String(system.name ?? "").toLowerCase();
        if (names.some(n => name.includes(n))) return !["destroyed", "disabled"].includes(system.status);
      }
    }
    return true;
  }

  static getLinkedSystemNames(arc) {
    if (arc === "bow") return ["носовые чэйзеры"];
    if (arc === "stern") return ["кормовые чэйзеры"];
    if (arc === "port" || arc === "starboard") return ["главная батарея"];
    if (arc === "mortar") return ["мортир"];
    return [];
  }

  static getHistoricalReloadBase(battery) {
    const profile = this.getWeaponProfile(battery);
    const type = profile.id ?? this.getWeaponType(battery);
    const configured = Number.isFinite(Number(battery?.reloadMax)) ? Number(battery.reloadMax) : 2;
    const caliber = String(battery?.caliber ?? "");
    const guns = Number(battery?.guns ?? 0);
    const damage = Number(battery?.damage ?? 0);

    if (type === "swivel") return Math.max(1, configured);
    if (type === "carronade") return Math.max(3, configured + 2);
    if (type === "mortar") return Math.max(6, configured + 2);
    if (type === "chaser") {
      const heavyChaser = damage >= 6 || /18|24|32/.test(caliber);
      return Math.max(heavyChaser ? 3 : 2, configured + 1);
    }

    const heavyBattery = damage >= 18 || guns >= 24 || /18|24|32/.test(caliber);
    const shipOfLineBattery = damage >= 34 || guns >= 34 || /32/.test(caliber);
    return Math.max(configured + 1, shipOfLineBattery ? 5 : heavyBattery ? 4 : 3);
  }

  static getReloadAfterShot(battery) {
    const profile = this.getWeaponProfile(battery);
    const mode = battery.fireMode ?? "full";
    const modeMod = mode === "partial" ? -1 : mode === "ranging" ? 0 : 0;
    return Math.max(1, this.getHistoricalReloadBase(battery) + Number(profile.reloadMod ?? 0) + modeMod);
  }

  static async fire(battle, attackerId, arc, targetId = null, options = {}) {
    const attacker = getCombatant(battle, attackerId);
    if (!attacker) return { ok: false, text: "Стрелок не найден." };
    if (!CombatantRules.supports(attacker, "gunnery")) return { ok: false, text: `${attacker.name}: этот тип боевой единицы пока не использует корабельную стрельбу.` };
    const battery = this.getBattery(attacker, arc);
    if (!battery) return { ok: false, text: "Батарея не найдена." };
    if (Number(battery.reload ?? 0) > 0) return { ok: false, text: `${battery.label} еще перезаряжается.` };
    if (!this.isBatteryFunctional(attacker, battery)) return { ok: false, text: `${attacker.name}: ${battery.label} выведена из строя.` };
    const corePolicy = this.validateCoreTargetingPolicy(battle, attacker, options);
    if (!corePolicy.ok) return corePolicy;
    this.normalizeAmmoForWeapon(battery);
    if (!this.getAvailableAmmo(battle, attacker, battery).includes(battery.ammo)) {
      return { ok: false, text: `${attacker.name}: каленые ядра не подготовлены. Нужна корабельная нагревательная печь или разрешение сценария для стороны.` };
    }
    this.normalizeFireModeForWeapon(battery);

    const targets = this.getTargets(battle, attacker, arc, options);
    const targetInfo = targetId ? targets.find(t => t.target.id === targetId) : targets[0];
    if (!targetInfo) return { ok: false, text: "Нет цели в дуге огня или дистанции." };

    const target = targetInfo.target;
    const ammo = battery.ammo ?? "roundShot";
    const fireMode = battery.fireMode ?? "full";
    const preview = targetInfo.preview ?? this.getShotPreview(battle, attacker, target, battery, targetInfo.range, options);
    const aimText = options.aimedSection
      ? ` Прицел: ${options.aimedSection === "crystalCore" ? "ядро кристалла" : (SECTION_LABELS[options.aimedSection] ?? options.aimedSection)}.`
      : ` Секция: ${preview.targetSectionLabel}.`;
    const honorText = options.aimedSection === "crystalCore" ? " БЕСЧЕСТНЫЙ ВЫСТРЕЛ ПО ЯДРУ." : "";
    const typeText = WEAPON_TYPE_LABELS[this.getWeaponType(battery)] ?? this.getWeaponType(battery);
    const modeText = FIRE_MODE_LABELS[fireMode] ?? fireMode;

    if (fireMode === "delayed") {
      battery.delayed = true;
      battery.fireMode = "full";
      return {
        ok: true,
        hit: false,
        delayed: true,
        attacker,
        target,
        battery,
        preview,
        text: `${attacker.name}: ${battery.label} (${typeText}) задерживает залп по ${target.name}. Следующий настоящий залп этой батареи получит +2.`
      };
    }

    const skill = preview.skill;
    const roll = roll3d6();
    const hit = roll <= skill;
    battery.reload = this.getReloadAfterShot(battery);
    const hadDelayed = Boolean(battery.delayed);
    battery.delayed = false;
    const hadRanging = battery.rangingTargetId === target.id;
    if (fireMode === "ranging") battery.rangingTargetId = target.id;
    else if (hadRanging) battery.rangingTargetId = null;

    if (!hit) {
      const result = {
        ok: true,
        hit: false,
        attacker,
        target,
        battery,
        roll,
        skill,
        range: targetInfo.range,
        bearing: targetInfo.bearing,
        ammo,
        fireMode,
        weaponType: this.getWeaponType(battery),
        aimedSection: options.aimedSection ?? null,
        targetSection: preview.targetSection,
        preview,
        text: `${attacker.name}: ${battery.label} (${typeText}, ${AMMO_LABELS[ammo] ?? ammo}, ${modeText}) дает залп по ${target.name}.${aimText}${honorText} Бросок ${roll} против ${skill} (${preview.modText}).${hadDelayed ? " Задержка использована." : ""} Мимо.`
      };
      this.recordDishonorableCoreShot(battle, result);
      return result;
    }

    const margin = Math.max(0, skill - roll);
    const damage = this.getExpectedDamage(battery, ammo, 10 + Math.floor(margin / 2) * 2, { fireMode, range: targetInfo.range });
    const result = {
      ok: true,
      hit: true,
      attacker,
      target,
      battery,
      roll,
      skill,
      damage,
      range: targetInfo.range,
      bearing: targetInfo.bearing,
      ammo,
      fireMode,
      weaponType: this.getWeaponType(battery),
      aimedSection: options.aimedSection ?? null,
      targetSection: preview.targetSection,
      preview,
      text: `${attacker.name}: ${battery.label} (${typeText}, ${AMMO_LABELS[ammo] ?? ammo}, ${modeText}) попадает по ${target.name}.${aimText}${honorText} Бросок ${roll} против ${skill} (${preview.modText}).${hadDelayed ? " Задержка использована." : ""} Урон ${damage}.`
    };
    this.recordDishonorableCoreShot(battle, result);
    return result;
  }
}
