import { APP_PARTIAL_TEMPLATES, MODULE_ID } from "./utils/constants.js";
import { registerHandlebarsHelpers } from "./utils/helpers.js";
import { StorageService } from "./services/storage-service.js";
import { SocketService } from "./services/socket-service.js";
import { ShipLibraryService } from "./services/ship-library-service.js";
import { ShipTemplateService } from "./services/ship-template-service.js";
import { CreatureLibraryService } from "./services/creature-library-service.js";
import { CreatureTemplateService } from "./services/creature-template-service.js";
import { BattleScenarioService } from "./services/battle-scenario-service.js";
import { NavalBattleApp } from "./apps/naval-battle-app.js";
import { ShipyardApp } from "./apps/shipyard-app.js";
import { BattleSetupApp } from "./apps/battle-setup-app.js";
import { SoundService } from "./services/sound-service.js";
import { SoundSettingsApp } from "./apps/sound-settings-app.js";
import { BoardSettingsApp } from "./apps/board-settings-app.js";
import { CombatantRules } from "./rules/combatant-rules.js";
import * as Combatants from "./utils/combatants.js";
import { CreatureMovementEngine } from "./engine/creature-movement-engine.js";
import { CreatureAttackEngine } from "./engine/creature-attack-engine.js";
import { CreatureDamageEngine } from "./engine/creature-damage-engine.js";
import { CreatureAbilityEngine } from "./engine/creature-ability-engine.js";
import { CreatureGrappleEngine } from "./engine/creature-grapple-engine.js";
import { CreatureAIEngine } from "./engine/creature-ai-engine.js";
import { DocumentStateStore } from "./services/document-state-store.js";
import { DiagnosticsService } from "./services/diagnostics-service.js";

Hooks.on?.("getSceneControlButtons", controls => {
  const notesControl = controls?.notes;
  if (!notesControl?.tools) return;
  notesControl.tools[`${MODULE_ID}.openBattle`] = {
    name: `${MODULE_ID}.openBattle`,
    title: "Открыть Sailships Combat",
    icon: "fa-solid fa-ship",
    button: true,
    order: 950,
    onChange: () => game.sailshipsCombat?.open?.()
  };
});


Hooks.on?.("renderJournalDirectory", (_app, html) => {
  DocumentStateStore.hideStorageEntriesInDirectory(html);
});

Hooks.once("init", async () => {
  StorageService.registerSettings();
  SoundService.registerSettings();
  registerHandlebarsHelpers();
  await loadTemplates(APP_PARTIAL_TEMPLATES);
});

Hooks.once("ready", async () => {
  SocketService.register();
  try {
    await StorageService.initialize();
  } catch (error) {
    console.error("Sailships Combat | Storage initialization failed", error);
    ui.notifications.error("Sailships Combat: не удалось инициализировать защищённое хранилище. Проверьте консоль ГМа.");
  }

  game.sailshipsCombat = {
    MODULE_ID,
    storage: StorageService,
    socket: SocketService,
    transportTrust: SocketService.getTransportTrustModel(),
    library: ShipLibraryService,
    creatureLibrary: CreatureLibraryService,
    templates: ShipTemplateService,
    creatureTemplates: CreatureTemplateService,
    scenarios: BattleScenarioService,
    sounds: SoundService,
    diagnostics: DiagnosticsService,
    runDiagnostics(options = {}) {
      return DiagnosticsService.run(options);
    },
    combatantRules: CombatantRules,
    combatants: Combatants,
    creatureEngines: Object.freeze({
      movement: CreatureMovementEngine,
      attack: CreatureAttackEngine,
      damage: CreatureDamageEngine,
      abilities: CreatureAbilityEngine,
      grapple: CreatureGrappleEngine,
      ai: CreatureAIEngine
    }),
    app: null,
    shipyardApp: null,
    setupApp: null,
    soundSettingsApp: null,
    boardSettingsApp: null,
    open() {
      if (!this.app) this.app = new NavalBattleApp();
      this.app.render({ force: true });
      return this.app;
    },
    openShipyard(selectedShipId = null) {
      if (!game.user.isGM) {
        ui.notifications.warn("Верфь доступна только ГМу: она работает с авторитетным состоянием боя и библиотекой кораблей.");
        return null;
      }
      if (!this.shipyardApp) this.shipyardApp = new ShipyardApp({ selectedShipId });
      if (selectedShipId) this.shipyardApp.selectedShipId = selectedShipId;
      this.shipyardApp.render({ force: true });
      return this.shipyardApp;
    },
    openBattleSetup() {
      if (!game.user.isGM) {
        ui.notifications.warn("Подготовка боя доступна только ГМу.");
        return null;
      }
      if (!this.setupApp) this.setupApp = new BattleSetupApp();
      this.setupApp.render({ force: true });
      return this.setupApp;
    },
    openSoundSettings() {
      if (!this.soundSettingsApp) this.soundSettingsApp = new SoundSettingsApp();
      this.soundSettingsApp.render({ force: true });
      return this.soundSettingsApp;
    },
    openBoardSettings() {
      if (!game.user.isGM) return ui.notifications.warn("Настройки поля доступны только ГМу.");
      if (!this.boardSettingsApp) this.boardSettingsApp = new BoardSettingsApp();
      this.boardSettingsApp.render({ force: true });
      return this.boardSettingsApp;
    },
    reset() {
      return StorageService.resetBattle();
    }
  };

});
