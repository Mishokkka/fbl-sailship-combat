import { ShipLibraryService } from "../services/ship-library-service.js";
import { ShipTemplateService } from "../services/ship-template-service.js";
import { CreatureLibraryService } from "../services/creature-library-service.js";
import { CreatureTemplateService } from "../services/creature-template-service.js";
import { BattleScenarioService } from "../services/battle-scenario-service.js";
import { ALTITUDE_MAX, COMBATANT_TYPE_LABELS } from "../utils/constants.js";

export class ShipyardContextBuilder {
  static unitHp(unit) {
    if (unit?.unitType === "creature") {
      const value = Number(unit.vitality?.current ?? 0);
      const max = Number(unit.vitality?.max ?? 0);
      return { value, max, pct: max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0 };
    }
    let value = 0;
    let max = 0;
    for (const section of Object.values(unit?.sections ?? {})) {
      value += Number(section.hp?.value ?? 0);
      max += Number(section.hp?.max ?? 0);
    }
    return { value, max, pct: max ? Math.max(0, Math.min(100, Math.round((value / max) * 100))) : 0 };
  }

  static formatShipLibraryEntry(entry, index) {
    const ship = entry.ship ?? {};
    return {
      ...entry,
      index: index + 1,
      shipName: ship.name ?? entry.name,
      shipType: ship.template ?? "custom",
      crew: ship.crew?.required ?? 0,
      maxSpeed: ship.maxSpeed ?? 0,
      hp: this.unitHp(ship).max,
      core: ship.crystal?.maxIntegrity ?? 0,
      broadsideDamage: Math.max(0, ...(ship.weapons ?? [])
        .filter(w => ["port", "starboard"].includes(w.arc))
        .map(w => Number(w.damage ?? 0)))
    };
  }

  static formatCreatureLibraryEntry(entry, index) {
    const creature = entry.creature ?? {};
    return {
      ...entry,
      index: index + 1,
      creatureName: creature.name ?? entry.name,
      creatureType: creature.creatureType ?? "custom",
      size: creature.size ?? "large",
      maxSpeed: creature.maxSpeed ?? 0,
      vitality: creature.vitality?.max ?? 0,
      armor: creature.stats?.armor ?? 0,
      sections: Object.keys(creature.sections ?? {}).length,
      attacks: (creature.attacks ?? []).length,
      tokenImg: creature.token?.img ?? ""
    };
  }

  static build(input) {
    return this.buildContext(input);
  }

  static buildContext({ baseContext, battle, selectedShip, activeSideId = null, activeTab, tabIds }) {
    if (selectedShip && !selectedShip.id) selectedShip = null;
    if (!tabIds.has(activeTab)) activeTab = "battle";

    const shipLibrary = ShipLibraryService.getLibrary();
    const creatureLibrary = CreatureLibraryService.getLibrary();
    const setupLocked = Boolean(battle.setupConfirmed);
    const selectedIsCreature = selectedShip?.unitType === "creature";
    BattleScenarioService.normalizeSetupZones(battle);

    const sideIds = BattleScenarioService.getSideIds(battle);
    const resolvedActiveSideId = sideIds.includes(activeSideId)
      ? activeSideId
      : (sideIds.includes(selectedShip?.side) ? selectedShip.side : sideIds[0] ?? null);
    const formattedUnits = (battle.ships ?? []).map(unit => {
      const isCreature = unit.unitType === "creature";
      return {
        ...unit,
        isCreature,
        isShip: !isCreature,
        typeLabel: COMBATANT_TYPE_LABELS[unit.unitType ?? "ship"] ?? unit.unitType,
        selected: unit.id === selectedShip?.id,
        sideName: BattleScenarioService.getSideName(battle, unit.side),
        sideColor: BattleScenarioService.getSideColor(battle, unit.side),
        hp: this.unitHp(unit),
        struck: Boolean(unit.flags?.struck),
        operational: !unit.flags?.struck && !unit.flags?.withdrawn,
        coreHeat: Number(unit.crystal?.heat ?? 0),
        coreMaxHeat: Number(unit.crystal?.maxHeat ?? 10),
        coreIntegrity: Number(unit.crystal?.integrity ?? 0),
        coreMaxIntegrity: Number(unit.crystal?.maxIntegrity ?? 0),
        altitude: Number(unit.altitude ?? 0),
        vitality: Number(unit.vitality?.current ?? 0),
        vitalityMax: Number(unit.vitality?.max ?? 0),
        morale: Number(isCreature ? unit.vitality?.morale ?? 0 : unit.crew?.morale ?? 0),
        sectionCount: Object.keys(unit.sections ?? {}).length,
        attackCount: (unit.attacks ?? []).length,
        tokenImg: unit.token?.img ?? ""
      };
    });
    const teamGroups = sideIds.map(sideId => {
      const side = battle.setup.sides[sideId];
      const units = formattedUnits.filter(unit => unit.side === sideId);
      const shipCount = units.filter(unit => !unit.isCreature).length;
      const creatureCount = units.filter(unit => unit.isCreature).length;
      const operationalCount = units.filter(unit => unit.operational).length;
      return {
        ...side,
        selected: sideId === resolvedActiveSideId,
        units,
        unitCount: units.length,
        shipCount,
        creatureCount,
        operationalCount,
        struckCount: units.length - operationalCount,
        empty: units.length === 0,
        summary: [
          shipCount ? `кораблей: ${shipCount}` : null,
          creatureCount ? `существ: ${creatureCount}` : null,
          units.length ? `в строю: ${operationalCount}/${units.length}` : "нет участников"
        ].filter(Boolean).join(" · ")
      };
    });
    const sideOptions = sideIds.map(id => ({
      id,
      name: BattleScenarioService.getSideName(battle, id),
      color: BattleScenarioService.getSideColor(battle, id),
      selected: id === selectedShip?.side,
      active: id === resolvedActiveSideId
    }));

    return foundry.utils.mergeObject(baseContext, {
      isGM: game.user.isGM,
      battle,
      setupLocked,
      selectedShip,
      selectedUnit: selectedShip,
      selectedIsCreature,
      selectedIsShip: Boolean(selectedShip && !selectedIsCreature),
      selectedTypeLabel: selectedShip ? COMBATANT_TYPE_LABELS[selectedShip.unitType ?? "ship"] ?? selectedShip.unitType : "",
      altitudeMax: ALTITUDE_MAX,
      activeTab,
      isBattleTab: activeTab === "battle",
      isTemplatesTab: activeTab === "templates",
      isBestiaryTab: activeTab === "bestiary",
      isLibraryTab: activeTab === "library",
      isCreatureLibraryTab: activeTab === "creatureLibrary",
      isEditorTab: activeTab === "editor",
      sides: sideOptions,
      sideOptions,
      teamGroups,
      sideCount: sideIds.length,
      activeSideId: resolvedActiveSideId,
      activeSideName: BattleScenarioService.getSideName(battle, resolvedActiveSideId),
      selectedSideName: selectedShip ? BattleScenarioService.getSideName(battle, selectedShip.side) : "",
      currentShips: formattedUnits,
      templateGroups: ShipTemplateService.getTemplateGroups(),
      creatureTemplateGroups: CreatureTemplateService.getTemplateGroups(),
      shipLibrary: shipLibrary.map((entry, index) => this.formatShipLibraryEntry(entry, index)),
      shipLibraryCount: shipLibrary.length,
      creatureLibrary: creatureLibrary.map((entry, index) => this.formatCreatureLibraryEntry(entry, index)),
      creatureLibraryCount: creatureLibrary.length,
      canEditBattleShips: Boolean(game.user.isGM && !setupLocked),
      canEditCombatants: Boolean(game.user.isGM && !setupLocked),
      canManageLibrary: Boolean(game.user.isGM),
      defaultLibraryName: selectedShip && !selectedIsCreature ? `${selectedShip.name}` : "Новый шаблон корабля",
      defaultCreatureLibraryName: selectedShip && selectedIsCreature ? `${selectedShip.name}` : "Новый шаблон существа"
    }, { inplace: false });
  }
}
