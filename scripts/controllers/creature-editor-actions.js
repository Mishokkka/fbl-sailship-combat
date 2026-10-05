import { CreatureEditorController } from "./creature-editor-controller.js";

function actionTarget(event, target = null) {
  return target ?? event?.target?.closest?.("[data-action]") ?? event?.currentTarget ?? null;
}

export class CreatureEditorActions {
  constructor(app) {
    this.app = app;
  }

  static async applyEdits(event) {
    event.preventDefault();
    await this.creatureEditorActions.applyEdits();
  }

  static async addSection(event) {
    event.preventDefault();
    await this.creatureEditorActions.addSection();
  }

  static async removeSection(event, target) {
    event.preventDefault();
    await this.creatureEditorActions.removeSection(actionTarget(event, target)?.dataset?.sectionId);
  }

  static async addAttack(event) {
    event.preventDefault();
    await this.creatureEditorActions.addAttack();
  }

  static async removeAttack(event, target) {
    event.preventDefault();
    await this.creatureEditorActions.removeAttack(actionTarget(event, target)?.dataset?.attackId);
  }

  static async addAbility(event) {
    event.preventDefault();
    await this.creatureEditorActions.addAbility();
  }

  static async removeAbility(event, target) {
    event.preventDefault();
    await this.creatureEditorActions.removeAbility(actionTarget(event, target)?.dataset?.abilityId);
  }

  static async chooseToken(event) {
    event.preventDefault();
    await this.creatureEditorActions.chooseToken();
  }

  async applyEdits() {
    if (!this.app._assertSetup("Редактор существа")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) return false;
      const creature = this.app.getSelectedShip(battle);
      if (!creature || creature.unitType !== "creature") return false;
      const result = new CreatureEditorController(this.app.element).applyEdits(creature);
      this.app._addLog(battle, `Бестиарий: ${result.oldName}: параметры существа обновлены${result.renamed ? `, новое имя ${result.newName}` : ""}.`);
    }, { reason: "bestiary-apply-edits" });
  }

  resetCombatState(creature) {
    new CreatureEditorController(this.app.element).resetCombatState(creature);
  }

  /** Persist only the requested structural change; form fields remain local drafts. */
  async mutate(reason, mutator) {
    if (!this.app._assertSetup("Редактор существа")) return;
    await this.app._updateBattleAndRender(battle => {
      if (battle.setupConfirmed) return false;
      const creature = this.app.getSelectedShip(battle);
      if (!creature || creature.unitType !== "creature") return false;
      mutator(creature);
    }, { reason });
  }

  async addSection() {
    await this.mutate("bestiary-add-section", creature => {
      creature.sections ??= {};
      let index = Object.keys(creature.sections).length + 1;
      let id = `section-${index}`;
      while (creature.sections[id]) id = `section-${++index}`;
      creature.sections[id] = { label: `Секция ${index}`, enabled: true, hp: { value: 10, max: 10 }, armor: 0, tags: ["body"], status: "intact" };
    });
  }

  async removeSection(sectionId) {
    await this.mutate("bestiary-remove-section", creature => {
      if (!sectionId || Object.keys(creature.sections ?? {}).length <= 1) return;
      delete creature.sections[sectionId];
    });
  }

  async addAttack() {
    await this.mutate("bestiary-add-attack", creature => {
      creature.attacks ??= [];
      const index = creature.attacks.length + 1;
      creature.attacks.push({ id: `attack-${Date.now()}-${index}`, label: `Атака ${index}`, type: "natural", arc: "bow", range: 1, radius: 0, damage: 5, cooldown: 0, cooldownMax: 0, tags: [] });
    });
  }

  async removeAttack(attackId) {
    await this.mutate("bestiary-remove-attack", creature => {
      creature.attacks = (creature.attacks ?? []).filter(attack => attack.id !== attackId);
    });
  }

  async addAbility() {
    await this.mutate("bestiary-add-ability", creature => {
      creature.abilities ??= [];
      const index = creature.abilities.length + 1;
      creature.abilities.push({ id: `ability-${Date.now()}-${index}`, label: `Способность ${index}`, type: "passive", effect: "none", phase: "any", target: "self", range: 0, radius: 1, power: 1, cooldown: 0, cooldownMax: 0, uses: 0, usesMax: 0, description: "", tags: [] });
    });
  }

  async removeAbility(abilityId) {
    await this.mutate("bestiary-remove-ability", creature => {
      creature.abilities = (creature.abilities ?? []).filter(ability => ability.id !== abilityId);
    });
  }

  async chooseToken() {
    const input = this.app.element.querySelector('[data-creature-edit="tokenImg"]');
    const Picker = foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
    if (!Picker) return ui.notifications.warn("FilePicker Foundry недоступен. Укажите путь к изображению вручную.");
    const picker = new Picker({
      type: "image",
      current: input?.value ?? "",
      callback: path => {
        if (input) { input.value = path; input.dispatchEvent(new Event("input", { bubbles: true })); }
      }
    });
    try {
      await picker.render?.({ force: true });
    } catch (_error) {
      await picker.render?.(true);
    }
  }
}
