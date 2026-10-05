import { ALTITUDE_MAX, ALTITUDE_MIN } from "../utils/constants.js";

export class ShipEditorController {
  constructor(root) {
    this.root = root;
  }

  applyEdits(ship) {
    const oldName = ship.name;
    ship.name = String(this.get("name") ?? ship.name).trim() || ship.name;
    ship.maxSpeed = this.clamp(this.get("maxSpeed"), 0, 12, Number(ship.maxSpeed ?? 4));
    ship.speed = Math.min(Number(ship.speed ?? 0), ship.maxSpeed);
    ship.sailing ??= {};
    const sailingProfile = String(this.get("sailingProfile") ?? ship.sailing.profile ?? "square");
    ship.sailing.profile = ["foreAft", "mixed", "square", "heavySquare", "lateen", "bomb"].includes(sailingProfile) ? sailingProfile : "square";

    ship.crew ??= {};
    ship.crew.required = Math.round(this.clamp(this.get("crewRequired"), 0, 2000, Number(ship.crew.required ?? 0)));
    ship.crew.current = Math.round(this.clamp(this.get("crewCurrent"), 0, 2000, Number(ship.crew.current ?? ship.crew.required ?? 0)));
    ship.crew.morale = Math.round(this.clamp(this.get("morale"), 0, 10, Number(ship.crew.morale ?? 10)));

    ship.stats ??= {};
    ship.stats.crewQuality = Math.round(this.clamp(this.get("crewQuality"), -5, 5, Number(ship.stats.crewQuality ?? 0)));
    ship.stats.ht = Math.round(this.clamp(this.get("ht"), 3, 18, Number(ship.stats.ht ?? 12)));
    ship.stats.handling = Math.round(this.clamp(this.get("handling"), -5, 5, Number(ship.stats.handling ?? -1)));
    ship.stats.stability = Math.round(this.clamp(this.get("stability"), 0, 10, Number(ship.stats.stability ?? 5)));

    ship.altitude = Math.round(this.clamp(this.get("altitude"), ALTITUDE_MIN, ALTITUDE_MAX, Number(ship.altitude ?? 3)));

    ship.crystal ??= {};
    ship.crystal.heat = Math.round(this.clamp(this.get("crystalHeat"), 0, Number(ship.crystal.maxHeat ?? 10) + 5, Number(ship.crystal.heat ?? 0)));
    ship.crystal.maxHeat = Math.round(this.clamp(this.get("crystalMaxHeat"), 4, 20, Number(ship.crystal.maxHeat ?? 10)));
    ship.crystal.heat = Math.min(ship.crystal.heat, ship.crystal.maxHeat + 5);
    ship.crystal.maxIntegrity = Math.round(this.clamp(this.get("crystalMaxIntegrity"), 1, 99, Number(ship.crystal.maxIntegrity ?? 16)));
    ship.crystal.integrity = Math.round(this.clamp(this.get("crystalIntegrity"), 0, ship.crystal.maxIntegrity, Number(ship.crystal.integrity ?? ship.crystal.maxIntegrity)));
    ship.crystal.armor = Math.round(this.clamp(this.get("crystalArmor"), 0, 30, Number(ship.crystal.armor ?? 6)));

    ship.equipment ??= {};
    ship.equipment.heatedShotFurnace = this.getChecked("heatedShotFurnace", Boolean(ship.equipment.heatedShotFurnace));

    this.applyWeaponEdits(ship);
    this.applySectionEdits(ship);

    return { oldName, newName: ship.name, renamed: oldName !== ship.name };
  }

  applyWeaponEdits(ship) {
    for (const weapon of ship.weapons ?? []) {
      const byId = field => this.root.querySelector(`[data-weapon-edit="${field}"][data-weapon-id="${weapon.id}"]`)?.value;
      weapon.damage = Math.round(this.clamp(byId("damage"), 0, 99, Number(weapon.damage ?? 1)));
      weapon.range = Math.round(this.clamp(byId("range"), 1, 99, Number(weapon.range ?? 1)));
      weapon.reloadMax = Math.round(this.clamp(byId("reloadMax"), 0, 10, Number(weapon.reloadMax ?? 1)));
      weapon.reload = Math.min(Number(weapon.reload ?? 0), weapon.reloadMax);
    }
  }

  applySectionEdits(ship) {
    for (const [sectionId, section] of Object.entries(ship.sections ?? {})) {
      const sectionValue = field => this.root.querySelector(`[data-section-edit="${field}"][data-section-id="${sectionId}"]`)?.value;
      section.hp ??= { value: 1, max: 1 };
      section.hp.max = Math.round(this.clamp(sectionValue("hpMax"), 1, 999, Number(section.hp.max ?? 1)));
      section.hp.value = Math.round(this.clamp(sectionValue("hpValue"), 0, section.hp.max, Number(section.hp.value ?? section.hp.max)));
      section.dr = Math.round(this.clamp(sectionValue("dr"), 0, 99, Number(section.dr ?? 0)));
      section.fire = Math.round(this.clamp(sectionValue("fire"), 0, 12, Number(section.fire ?? 0)));
      section.flooding = Math.round(this.clamp(sectionValue("flooding"), 0, 12, Number(section.flooding ?? 0)));
      section.breaches = Math.round(this.clamp(sectionValue("breaches"), 0, 12, Number(section.breaches ?? 0)));

      for (const [index, system] of (section.systems ?? []).entries()) {
        const systemValue = field => this.root.querySelector(`[data-system-edit="${field}"][data-section-id="${sectionId}"][data-system-index="${index}"]`)?.value;
        system.name = String(systemValue("name") ?? system.name ?? `Система ${index + 1}`).trim() || `Система ${index + 1}`;
        system.slot = Math.round(this.clamp(systemValue("slot"), 1, 6, Number(system.slot ?? index + 1)));
        const status = String(systemValue("status") ?? system.status ?? "intact");
        system.status = ["intact", "damaged", "destroyed", "disabled"].includes(status) ? status : "intact";
        system.hp ??= { value: 6, max: 6 };
        system.hp.max = Math.round(this.clamp(systemValue("hpMax"), 1, 99, Number(system.hp.max ?? 6)));
        system.hp.value = Math.round(this.clamp(systemValue("hpValue"), 0, system.hp.max, Number(system.hp.value ?? system.hp.max)));
      }
    }
  }

  resetCombatState(ship) {
    for (const section of Object.values(ship.sections ?? {})) {
      section.hp ??= { value: 1, max: 1 };
      section.hp.value = section.hp.max;
      section.fire = 0;
      section.flooding = 0;
      section.breaches = 0;
      section.mastWreckage = 0;
      for (const system of section.systems ?? []) {
        system.hp ??= { value: 6, max: 6 };
        system.hp.value = system.hp.max;
        system.status = "intact";
        system.mastFallResolved = false;
      }
    }
    for (const weapon of ship.weapons ?? []) {
      weapon.reload = 0;
      weapon.fireMode = "full";
      weapon.delayed = false;
      weapon.rangingTargetId = null;
    }
    ship.crew ??= {};
    ship.crew.current = ship.crew.required;
    ship.crew.casualties = 0;
    ship.crew.rescued = 0;
    ship.crew.morale = 10;
    ship.flags = {
      inIrons: false,
      inIronsAttempts: 0,
      grappledWith: null,
      struck: false,
      falling: false,
      coreExploded: false,
      emergencyDescent: false,
      immobilized: false,
      uncontrolledFire: false,
      abandoned: false,
      withdrawn: false,
      withdrawnRound: null,
      rescueResolved: false,
      mastWreckage: 0
    };
    ship.altitude = Math.max(ALTITUDE_MIN, Math.min(ALTITUDE_MAX, Number(ship.altitude ?? 3) || 3));
    ship.verticalVelocity = 0;
    ship.crystal ??= {};
    ship.crystal.heat = 0;
    ship.crystal.integrity = Number(ship.crystal.maxIntegrity ?? ship.crystal.integrity ?? 16);
    ship.crystal.mode = "normal";
    ship.selectedOrder = null;
    ship.turn = { round: 1, actions: {} };
  }

  get(name) {
    return this.root.querySelector(`[data-ship-edit="${name}"]`)?.value;
  }

  getChecked(name, fallback = false) {
    return this.root.querySelector(`[data-ship-edit="${name}"]`)?.checked ?? fallback;
  }

  clamp(value, min, max, fallback) {
    return Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
  }
}
