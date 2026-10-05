import { ALTITUDE_MAX, ALTITUDE_MIN, BOARD_LIMITS, CURRENT_SCHEMA_VERSION, SHIP_DURABILITY_REVISION, SHIP_DURABILITY_SCALE } from "../utils/constants.js";
import { normalizeHeading } from "../board/board-geometry.js";
import { SchemaMigrations } from "../migrations/schema-migrations.js";
import { boundedArray, boundedInteger, boundedString, enumValue, finiteNumber, isPlainObject, plainRecord, uniqueBoundedStrings } from "../utils/schema.js";
import { repairUniqueIds } from "../utils/identity.js";

function newId(prefix = "id") {
  return foundry.utils.randomID?.() ?? crypto.randomUUID?.() ?? `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;
}

export class ShipNormalizer {
  static normalize(ship, { battleRound = 1 } = {}) {
    ship = isPlainObject(ship) ? ship : {};
    SchemaMigrations.migrateShip(ship);
    ship.schemaVersion = CURRENT_SCHEMA_VERSION;
    ship.unitType = "ship";
    ship.id = boundedString(ship.id, { fallback: newId("ship"), maxLength: 128 });
    ship.name = boundedString(ship.name, { fallback: "Корабль", maxLength: 256 }) || "Корабль";
    ship.side = boundedString(ship.side, { fallback: "blue", maxLength: 64 }) || "blue";
    ship.x = boundedInteger(ship.x, { fallback: 0, min: 0, max: BOARD_LIMITS.maxWidth - 1 });
    ship.y = boundedInteger(ship.y, { fallback: 0, min: 0, max: BOARD_LIMITS.maxHeight - 1 });
    ship.heading = normalizeHeading(ship.heading ?? 0);
    ship.speed = boundedInteger(ship.speed, { fallback: 0, min: 0, max: 20 });
    ship.maxSpeed = boundedInteger(ship.maxSpeed, { fallback: 4, min: 0, max: 12 });
    ship.altitude = boundedInteger(ship.altitude, { fallback: 3, min: ALTITUDE_MIN, max: ALTITUDE_MAX });
    ship.verticalVelocity = boundedInteger(ship.verticalVelocity, { fallback: 0, min: -3, max: 2 });

    this.normalizeCrystal(ship);
    this.normalizeStats(ship);
    this.normalizeSailing(ship);
    this.normalizeEquipment(ship);
    this.normalizeCrew(ship);
    this.normalizeFlagsAndTurn(ship, battleRound);
    this.normalizeSections(ship);
    this.normalizeDurability(ship);
    this.ensureCrystalCapsuleSystem(ship);
    this.normalizeWeapons(ship);
    return ship;
  }

  static normalizeCrystal(ship) {
    ship.crystal = plainRecord(ship.crystal);
    ship.crystal.enabled = ship.crystal.enabled !== false;
    ship.crystal.maxHeat = boundedInteger(ship.crystal.maxHeat, { fallback: 10, min: 4, max: 100 });
    ship.crystal.heat = boundedInteger(ship.crystal.heat, { fallback: 0, min: 0, max: ship.crystal.maxHeat + 5 });
    ship.crystal.maxIntegrity = boundedInteger(ship.crystal.maxIntegrity, { fallback: 16, min: 1, max: 1000 });
    ship.crystal.integrity = boundedInteger(ship.crystal.integrity, { fallback: ship.crystal.maxIntegrity, min: 0, max: ship.crystal.maxIntegrity });
    ship.crystal.armor = boundedInteger(ship.crystal.armor, { fallback: 9, min: 0, max: 100 });
    ship.crystal.armorRevision = boundedInteger(ship.crystal.armorRevision, { fallback: 1, min: 1, max: CURRENT_SCHEMA_VERSION });
    if (ship.crystal.armorRevision < 2) {
      ship.crystal.armor += 3;
      ship.crystal.armorRevision = 2;
    }
    ship.crystal.location = boundedString(ship.crystal.location, { fallback: "stern", maxLength: 64 }) || "stern";
    ship.crystal.honorProtected = ship.crystal.honorProtected !== false;
    ship.crystal.mode = enumValue(String(ship.crystal.mode ?? "normal"), ["normal", "boosted", "emergency", "shutdown"], "normal");
  }

  static normalizeStats(ship) {
    ship.stats = plainRecord(ship.stats);
    ship.stats.sm = boundedInteger(ship.stats.sm, { fallback: 7, min: 0, max: 30 });
    ship.stats.ht = boundedInteger(ship.stats.ht, { fallback: 12, min: 1, max: 30 });
    ship.stats.handling = boundedInteger(ship.stats.handling, { fallback: -1, min: -10, max: 10 });
    ship.stats.stability = boundedInteger(ship.stats.stability, { fallback: 5, min: 0, max: 20 });
    ship.stats.crewQuality = boundedInteger(ship.stats.crewQuality, { fallback: 0, min: -5, max: 5 });
  }

  static normalizeSailing(ship) {
    const allowed = new Set(["foreAft", "mixed", "square", "heavySquare", "lateen", "bomb"]);
    ship.sailing = plainRecord(ship.sailing);
    const profile = String(ship.sailing.profile ?? ship.sailProfile ?? "square");
    ship.sailing.profile = allowed.has(profile) ? profile : "square";
    delete ship.sailProfile;
  }

  static normalizeEquipment(ship) {
    ship.equipment = plainRecord(ship.equipment);
    ship.equipment.heatedShotFurnace = Boolean(ship.equipment.heatedShotFurnace);
  }

  static normalizeCrew(ship) {
    ship.crew = plainRecord(ship.crew);
    const requiredFallback = finiteNumber(ship.crew.current, { fallback: 0, min: 0, max: 10000 });
    ship.crew.required = boundedInteger(ship.crew.required, { fallback: requiredFallback, min: 0, max: 10000 });
    ship.crew.current = boundedInteger(ship.crew.current, { fallback: ship.crew.required, min: 0, max: 10000 });
    ship.crew.casualties = boundedInteger(ship.crew.casualties, { fallback: 0, min: 0, max: 100000 });
    ship.crew.rescued = boundedInteger(ship.crew.rescued, { fallback: 0, min: 0, max: 100000 });
    ship.crew.morale = boundedInteger(ship.crew.morale, { fallback: 10, min: 0, max: 10 });
  }

  static normalizeFlagsAndTurn(ship, battleRound) {
    ship.flags = plainRecord(ship.flags);
    if (ship.flags.grappledWith == null && typeof ship.flags.grappled === "string") ship.flags.grappledWith = ship.flags.grappled;
    delete ship.flags.grappled;
    ship.flags.grappledWith ??= null;
    ship.flags.attachedCreatureIds = uniqueBoundedStrings(ship.flags.attachedCreatureIds, { maxItems: 50, maxLength: 128 });
    if (!ship.flags.attachedCreatureIds.length) delete ship.flags.attachedCreatureIds;
    ship.flags.struck = Boolean(ship.flags.struck);
    ship.flags.falling = Boolean(ship.flags.falling);
    ship.flags.coreExploded = Boolean(ship.flags.coreExploded);
    ship.flags.immobilized = Boolean(ship.flags.immobilized);
    ship.flags.uncontrolledFire = Boolean(ship.flags.uncontrolledFire);
    ship.flags.abandoned = Boolean(ship.flags.abandoned);
    ship.flags.withdrawn = Boolean(ship.flags.withdrawn);
    ship.flags.withdrawnRound = ship.flags.withdrawn
      ? boundedInteger(ship.flags.withdrawnRound, { fallback: battleRound ?? 1, min: 1, max: 1_000_000 })
      : null;
    ship.flags.rescueResolved = Boolean(ship.flags.rescueResolved);
    ship.flags.mastWreckage = boundedInteger(ship.flags.mastWreckage, { fallback: 0, min: 0, max: 100 });
    ship.flags.inIrons = Boolean(ship.flags.inIrons);
    ship.flags.emergencyDescent = Boolean(ship.flags.emergencyDescent);
    ship.flags.inIronsAttempts = boundedInteger(ship.flags.inIronsAttempts, { fallback: 0, min: 0, max: 100 });
    ship.selectedOrder = ship.selectedOrder == null ? null : boundedString(ship.selectedOrder, { maxLength: 64 });
    ship.turn = plainRecord(ship.turn);
    ship.turn.round = boundedInteger(ship.turn.round, { fallback: battleRound ?? 1, min: 1, max: 1_000_000 });
    ship.turn.actions = plainRecord(ship.turn.actions);
  }

  static normalizeSections(ship) {
    ship.sections = plainRecord(ship.sections);
    ship.sections = Object.fromEntries(Object.entries(ship.sections).filter(([, section]) => isPlainObject(section)).slice(0, 32));
    ship.sections.stern ??= { id: "stern", hp: { value: 1, max: 1 }, dr: 0, fire: 0, flooding: 0, breaches: 0, systems: [] };
    for (const [sectionId, section] of Object.entries(ship.sections)) {
      section.id = boundedString(section.id, { fallback: sectionId, maxLength: 64 }) || sectionId;
      section.hp = plainRecord(section.hp);
      section.hp.max = boundedInteger(section.hp.max, { fallback: section.hp.value ?? 1, min: 1, max: 10000 });
      section.hp.value = boundedInteger(section.hp.value, { fallback: section.hp.max, min: 0, max: section.hp.max });
      section.dr = boundedInteger(section.dr, { fallback: 0, min: 0, max: 100 });
      section.fire = boundedInteger(section.fire, { fallback: 0, min: 0, max: 100 });
      section.flooding = boundedInteger(section.flooding, { fallback: 0, min: 0, max: 100 });
      section.breaches = boundedInteger(section.breaches, { fallback: 0, min: 0, max: 100 });
      section.mastWreckage = boundedInteger(section.mastWreckage, { fallback: 0, min: 0, max: 100 });
      section.systems = boundedArray(section.systems, { maxLength: 100 }).filter(isPlainObject);
      for (const system of section.systems) {
        system.slot = boundedInteger(system.slot, { fallback: 1, min: 1, max: 100 });
        system.name = boundedString(system.name, { fallback: "Система", maxLength: 256 }) || "Система";
        system.status = enumValue(system.status, ["intact", "damaged", "destroyed", "disabled"], "intact");
        system.mastFallResolved = Boolean(system.mastFallResolved);
        system.hp = plainRecord(system.hp);
        system.hp.max = boundedInteger(system.hp.max, { fallback: 6, min: 1, max: 10000 });
        system.hp.value = boundedInteger(system.hp.value, { fallback: system.hp.max, min: 0, max: system.hp.max });
      }
    }
  }

  static normalizeDurability(ship) {
    const revision = boundedInteger(ship.durabilityRevision, { fallback: 1, min: 1, max: SHIP_DURABILITY_REVISION });
    if (revision < SHIP_DURABILITY_REVISION) {
      for (const section of Object.values(ship.sections ?? {})) {
        const oldMax = Math.max(1, Number(section.hp?.max ?? 1));
        const oldValue = Math.max(0, Math.min(oldMax, Number(section.hp?.value ?? oldMax)));
        const ratio = oldValue / oldMax;
        const nextMax = Math.max(1, Math.round(oldMax * SHIP_DURABILITY_SCALE));
        section.hp.max = nextMax;
        section.hp.value = oldValue <= 0 ? 0 : Math.max(1, Math.min(nextMax, Math.round(nextMax * ratio)));
      }
    }
    ship.durabilityRevision = SHIP_DURABILITY_REVISION;
  }

  static ensureCrystalCapsuleSystem(ship) {
    ship.sections = plainRecord(ship.sections);
    ship.sections.stern ??= { id: "stern", hp: { value: 1, max: 1 }, dr: 0, fire: 0, flooding: 0, breaches: 0, systems: [] };
    ship.sections.stern.systems ??= [];
    const sternSystems = ship.sections.stern.systems;
    const hasCrystalSystem = sternSystems.some(system => String(system.name ?? "").toLowerCase().includes("ядр") && String(system.name ?? "").toLowerCase().includes("крист"));
    if (hasCrystalSystem) return;
    const slotSix = sternSystems.find(system => Number(system.slot) === 6);
    if (slotSix) slotSix.name = "Бронекапсула ядра кристалла";
    else sternSystems.push({ slot: 6, name: "Бронекапсула ядра кристалла", status: "intact", hp: { value: 8, max: 8 } });
  }

  static normalizeWeapons(ship) {
    ship.weapons = boundedArray(ship.weapons, { maxLength: 100 }).filter(isPlainObject);
    const allowedTypes = new Set(["longGun", "carronade", "chaser", "mortar", "swivel"]);
    const allowedModes = new Set(["full", "partial", "ranging", "delayed"]);
    const allowedAmmo = new Set(["roundShot", "chainShot", "grapeShot", "heatedShot", "shellBomb"]);
    for (const weapon of ship.weapons) {
      weapon.id = boundedString(weapon.id, { fallback: weapon.arc ?? "weapon", maxLength: 128 }) || "weapon";
      weapon.arc = boundedString(weapon.arc, { fallback: weapon.id ?? "port", maxLength: 64 }) || "port";
      weapon.label = boundedString(weapon.label, { fallback: weapon.id, maxLength: 256 }) || weapon.id;
      weapon.type = allowedTypes.has(String(weapon.type ?? ""))
        ? String(weapon.type)
        : this.inferWeaponType(weapon);
      weapon.ammo = allowedAmmo.has(String(weapon.ammo ?? "")) ? String(weapon.ammo) : this.defaultAmmoForWeaponType(weapon.type);
      weapon.fireMode = allowedModes.has(String(weapon.fireMode ?? "")) ? String(weapon.fireMode) : "full";
      const defaultReload = weapon.type === "mortar" ? 3 : weapon.type === "carronade" || weapon.type === "swivel" ? 1 : 2;
      weapon.reloadMax = boundedInteger(weapon.reloadMax, { fallback: defaultReload, min: 0, max: 100 });
      weapon.reload = boundedInteger(weapon.reload, { fallback: 0, min: 0, max: weapon.reloadMax });
      weapon.damage = boundedInteger(weapon.damage, { fallback: 1, min: 1, max: 1000 });
      weapon.range = boundedInteger(weapon.range, { fallback: this.defaultRangeForWeaponType(weapon.type), min: 1, max: 100 });
      weapon.crewRequired = boundedInteger(weapon.crewRequired, { fallback: weapon.arc === "port" || weapon.arc === "starboard" ? 24 : weapon.type === "mortar" ? 16 : 8, min: 0, max: 10000 });
      weapon.delayed = Boolean(weapon.delayed);
      weapon.rangingTargetId = weapon.rangingTargetId == null ? null : boundedString(weapon.rangingTargetId, { maxLength: 128 });
      delete weapon.ammoStock;
      weapon.guns = weapon.guns == null ? null : boundedInteger(weapon.guns, { fallback: 0, min: 0, max: 500 });
      weapon.caliber = weapon.caliber == null ? null : boundedString(weapon.caliber, { maxLength: 64 });
      weapon.historicalNote = weapon.historicalNote == null ? null : boundedString(weapon.historicalNote, { maxLength: 2000, trim: false });
      weapon.closeDamageBonus = boundedInteger(weapon.closeDamageBonus, { fallback: 0, min: 0, max: 1000 });
      weapon.closeDamageRange = boundedInteger(weapon.closeDamageRange, { fallback: 0, min: 0, max: 100 });
      weapon.rangeRevision = boundedInteger(weapon.rangeRevision, { fallback: 1, min: 1, max: CURRENT_SCHEMA_VERSION });
      if (weapon.rangeRevision < 3) {
        weapon.range = this.defaultRangeForWeaponType(weapon.type);
        weapon.rangeRevision = 3;
      }
      if (!this.isAmmoAllowedForWeapon(weapon.type, weapon.ammo)) weapon.ammo = this.defaultAmmoForWeaponType(weapon.type);
    }
    repairUniqueIds(ship.weapons, { prefix: "weapon", maxLength: 128 });
  }

  static inferWeaponType(weapon) {
    const arc = String(weapon?.arc ?? weapon?.id ?? "");
    const label = String(weapon?.label ?? "").toLowerCase();
    if (arc === "mortar" || label.includes("морт")) return "mortar";
    if (arc === "swivel" || label.includes("поворот")) return "swivel";
    if (arc === "bow" || arc === "stern" || label.includes("чэйзер")) return "chaser";
    if (label.includes("карронад")) return "carronade";
    return "longGun";
  }

  static ammoAllowedByType(type) {
    return {
      longGun: ["roundShot", "chainShot", "grapeShot", "heatedShot"],
      carronade: ["roundShot", "grapeShot", "heatedShot"],
      chaser: ["roundShot", "chainShot"],
      mortar: ["shellBomb"],
      swivel: ["grapeShot", "roundShot"]
    }[type] ?? ["roundShot"];
  }

  static isAmmoAllowedForWeapon(type, ammo) {
    return this.ammoAllowedByType(type).includes(ammo);
  }

  static defaultRangeForWeaponType(type) {
    return {
      longGun: 8,
      carronade: 4,
      chaser: 10,
      mortar: 16,
      swivel: 2
    }[type] ?? 8;
  }

  static defaultAmmoForWeaponType(type) {
    return this.ammoAllowedByType(type)[0] ?? "roundShot";
  }

  static cleanForLibrary(ship) {
    const clean = this.normalize(foundry.utils.deepClone(ship ?? {}), { battleRound: 1 });
    clean.schemaVersion = CURRENT_SCHEMA_VERSION;
    clean.unitType = "ship";
    clean.id = clean.id || newId("ship");
    clean.x = 0;
    clean.y = 0;
    clean.heading = normalizeHeading(clean.heading ?? 120);
    clean.speed = Math.min(2, Number(clean.maxSpeed ?? clean.speed ?? 2));
    clean.selectedOrder = null;
    clean.flags = { inIrons: false, inIronsAttempts: 0, grappledWith: null, attachedCreatureIds: [], struck: false, falling: false, coreExploded: false, emergencyDescent: false, immobilized: false, uncontrolledFire: false, abandoned: false, withdrawn: false, withdrawnRound: null, rescueResolved: false, mastWreckage: 0 };
    clean.verticalVelocity = 0;
    this.normalizeSailing(clean);
    clean.turn = { round: 1, actions: {} };

    for (const section of Object.values(clean.sections ?? {})) {
      section.hp.value = Number(section.hp?.max ?? section.hp?.value ?? 1);
      section.fire = 0;
      section.flooding = 0;
      section.breaches = 0;
      section.mastWreckage = 0;
      for (const system of section.systems ?? []) {
        system.status = "intact";
        system.mastFallResolved = false;
        system.hp ??= { value: 6, max: 6 };
        system.hp.value = Number(system.hp.max ?? system.hp.value ?? 6);
      }
    }

    for (const weapon of clean.weapons ?? []) {
      weapon.reload = 0;
      weapon.fireMode = "full";
      weapon.delayed = false;
      weapon.rangingTargetId = null;
    }
    clean.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    clean.crew.current = Number(clean.crew.required ?? clean.crew.current ?? 0);
    clean.crew.casualties = 0;
    clean.crew.rescued = 0;
    clean.crew.morale = 10;
    clean.crystal ??= { enabled: true, heat: 0, maxHeat: 10, integrity: 16, maxIntegrity: 16, armor: 6, location: "stern", honorProtected: true };
    clean.crystal.heat = 0;
    clean.crystal.integrity = Number(clean.crystal.maxIntegrity ?? clean.crystal.integrity ?? 16);
    clean.crystal.enabled = clean.crystal.enabled !== false;
    clean.crystal.mode = "normal";
    clean.crystal.armorRevision = 2;
    clean.crystal.location ??= "stern";
    clean.crystal.honorProtected = clean.crystal.honorProtected !== false;
    return clean;
  }
}
