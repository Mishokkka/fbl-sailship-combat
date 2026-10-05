import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

/** Run production application actions in Chromium with only Foundry and persistence stubbed. */
export async function installWorkspaceActions(page, fixture) {
  await page.route("http://workspaces.test/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^(scripts\/[a-zA-Z0-9_./-]+\.js|tests\/test-env\.js)$/.test(path) || path.includes("..")) return route.abort();
    let source = await readFile(path, "utf8");
    if (path === "tests/test-env.js") source = source.replace('import { webcrypto } from "node:crypto";', "const webcrypto = globalThis.crypto;");
    await route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: source });
  });
  await page.addScriptTag({ content: await readFile("node_modules/handlebars/dist/handlebars.js", "utf8") });
  await page.evaluate(async ({ kind, battle, creatureId, partials, language }) => {
    window.workbench.destroy();
    await import("http://workspaces.test/tests/test-env.js");
    foundry.utils.mergeObject = (a, b) => ({ ...a, ...b });
    foundry.applications = { api: {
      ApplicationV2: class {
        constructor() { this.options = this.constructor.DEFAULT_OPTIONS; this.renderPromise = Promise.resolve(); }
        async _prepareContext() { return {}; }
        _onRender() {}
        render() {
          this.renderPromise = (async () => {
            const context = await this._prepareContext({});
            const source = Handlebars.partials[this.constructor.PARTS.main.template];
            this.element.querySelector(".window-content").innerHTML = Handlebars.compile(source)(context);
            this._onRender(context, {});
            return this;
          })();
          return this.renderPromise;
        }
      },
      HandlebarsApplicationMixin: Base => Base
    } };
    game.i18n = { localize: key => key.split(".").reduce((v, k) => v?.[k], language) ?? key };
    Handlebars.registerHelper("localize", key => game.i18n.localize(key));
    for (const [path, source] of Object.entries(partials)) Handlebars.registerPartial(path, source);
    const { registerHandlebarsHelpers } = await import("http://workspaces.test/scripts/utils/helpers.js");
    registerHandlebarsHelpers();
    const { BattleNormalizer } = await import("http://workspaces.test/scripts/normalizers/battle-normalizer.js");
    let stored = structuredClone(battle);
    const harness = {
      writeMode: "allow", pendingWrite: false, notifications: [],
      readBattle: () => structuredClone(stored)
    };
    ui.notifications.info = message => harness.notifications.push(message);
    game.sailshipsCombat = { storage: {
      getBattle: () => structuredClone(stored),
      async updateBattle(mutator) {
        const mode = harness.writeMode;
        if (mode === "deny") return structuredClone(stored);
        if (mode === "fail") throw new Error("Simulated write failure");
        const next = structuredClone(stored);
        if (await mutator(next) === false || mode === "deny-after-mutation") return structuredClone(stored);
        if (mode === "hold") {
          harness.pendingWrite = true;
          await new Promise(resolve => { harness.releaseWrite = resolve; });
          harness.pendingWrite = false;
        }
        next.revision = Number(stored.revision ?? 0) + 1;
        stored = BattleNormalizer.normalize(next);
        return structuredClone(stored);
      }
    } };
    const { ShipLibraryService } = await import("http://workspaces.test/scripts/services/ship-library-service.js");
    const { CreatureLibraryService } = await import("http://workspaces.test/scripts/services/creature-library-service.js");
    const { BattleScenarioService } = await import("http://workspaces.test/scripts/services/battle-scenario-service.js");
    ShipLibraryService.getLibrary = () => [];
    CreatureLibraryService.getLibrary = () => [];
    BattleScenarioService.getSavedScenarios = () => [];
    const modulePath = kind === "setup" ? "battle-setup-app" : kind === "background" ? "board-settings-app" : "shipyard-app";
    const App = Object.values(await import("http://workspaces.test/scripts/apps/" + modulePath + ".js"))[0];
    const app = new App({ selectedShipId: creatureId, activeTab: "editor" });
    app.element = document.querySelector(".application");
    app._onRender({}, {});
    app.element.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      const handler = app.constructor.DEFAULT_OPTIONS.actions[target?.dataset.action];
      if (!handler || target.matches(":disabled")) return;
      harness.lastAction = Promise.resolve(handler.call(app, event, target)).then(() => app.renderPromise);
      // Keep rejected writes observable by tests without unhandled browser rejections.
      harness.lastAction.catch(() => {});
    });
    window.workspaceTest = harness;
    window.previewApp = app;
    window.workbench = app.workbench;
  }, fixture);
}

/** Wait for both the dispatched action and the context/template rerender. */
export async function applyWorkspaceAction(page, selector) {
  await page.locator(selector).click();
  await page.evaluate(() => window.workspaceTest.lastAction);
}

/** Structural commands must never save other pending creature fields. */
export async function checkCreatureDraftActions(page) {
  const name = page.locator('[data-creature-edit="name"]');
  const original = await name.inputValue();
  await name.fill("Имя только в черновике");
  await page.locator('.ssc-section-nav [data-view="attacks"]').click();
  const attackLabel = page.locator('[data-creature-attack-edit="label"]').first();
  const originalAttack = await attackLabel.inputValue();
  await attackLabel.fill("Атака только в черновике");
  for (const [view, type, idAttribute, collection] of [
    ["anatomy", "Section", "section-id", "sections"],
    ["attacks", "Attack", "attack-id", "attacks"],
    ["abilities", "Ability", "ability-id", "abilities"]
  ]) {
    await page.locator('.ssc-section-nav [data-view="' + view + '"]').click();
    const ids = () => page.evaluate(collection => {
      const unit = window.previewApp.getSelectedShip(window.workspaceTest.readBattle());
      return collection === "sections" ? Object.keys(unit.sections) : unit[collection].map(item => item.id);
    }, collection);
    const before = await ids();
    await applyWorkspaceAction(page, '[data-action="addCreature' + type + '"]');
    const after = await ids();
    assert.equal(after.length, before.length + 1);
    const added = after.find(id => !before.includes(id));
    assert.ok(added);
    assert.equal(await page.evaluate(() => window.previewApp.getSelectedShip(window.workspaceTest.readBattle()).name), original);
    assert.equal(await page.evaluate(() => window.previewApp.getSelectedShip(window.workspaceTest.readBattle()).attacks[0].label), originalAttack);
    assert.equal(await name.inputValue(), "Имя только в черновике");
    assert.equal(await attackLabel.inputValue(), "Атака только в черновике");
    await applyWorkspaceAction(page, '[data-action="removeCreature' + type + '"][data-' + idAttribute + '="' + added + '"]');
    assert.deepEqual(await ids(), before);
    assert.equal(await name.inputValue(), "Имя только в черновике");
    assert.equal(await page.locator("[data-discard-draft]").isEnabled(), true);
  }
  await page.locator(".ssc-section-nav [data-view=profile]").click();
  await page.locator("[data-discard-draft]").click();
  assert.equal(await name.inputValue(), original);
  assert.equal(await attackLabel.inputValue(), originalAttack);
  await name.fill("Имя после применения");
  await applyWorkspaceAction(page, '[data-action="applyCreatureEdits"]');
  assert.equal(await page.evaluate(() => window.previewApp.getSelectedShip(window.workspaceTest.readBattle()).name), "Имя после применения");
  assert.equal(await page.locator("[data-discard-draft]").isDisabled(), true);
  await name.fill(original);
  await applyWorkspaceAction(page, '[data-action="applyCreatureEdits"]');
}

/** Cover normalized saves, denied/failed writes, and typing while a write is pending. */
export async function checkBackgroundSaveActions(page) {
  const tile = page.locator('[name="background.tileSize"]');
  const save = '[data-action="applyBoardEdits"]';
  const storedSize = () => page.evaluate(() => window.workspaceTest.readBattle().board.background.tileSize);
  await tile.fill("");
  await applyWorkspaceAction(page, save);
  assert.equal(await storedSize(), 512);
  assert.equal(await tile.inputValue(), "512");
  assert.equal(await page.locator("[data-discard-draft]").isDisabled(), true);

  for (const mode of ["deny", "deny-after-mutation", "fail"]) {
    await page.evaluate(mode => { window.workspaceTest.writeMode = mode; }, mode);
    const notifications = await page.evaluate(() => window.workspaceTest.notifications.length);
    await tile.fill("256");
    await page.locator(save).click();
    const error = await page.evaluate(async () => {
      try { await window.workspaceTest.lastAction; return null; }
      catch (error) { return error.message; }
    });
    assert.equal(error, mode === "fail" ? "Simulated write failure" : null);
    assert.equal(await tile.inputValue(), "256");
    assert.equal(await storedSize(), 512);
    assert.equal(await page.locator("[data-discard-draft]").isEnabled(), true);
    assert.equal(await page.evaluate(() => window.workspaceTest.notifications.length), notifications);
    await page.locator("[data-discard-draft]").click();
    assert.equal(await tile.inputValue(), "512");
  }

  await page.evaluate(() => { window.workspaceTest.writeMode = "hold"; });
  await tile.fill("256");
  await page.locator(save).click();
  await page.waitForFunction(() => window.workspaceTest.pendingWrite);
  await tile.fill("1024");
  await page.evaluate(() => window.workspaceTest.releaseWrite());
  await page.evaluate(() => window.workspaceTest.lastAction);
  assert.equal(await storedSize(), 256);
  assert.equal(await tile.inputValue(), "1024");
  assert.equal(await page.locator("[data-discard-draft]").isEnabled(), true);
  await page.locator("[data-discard-draft]").click();
  assert.equal(await tile.inputValue(), "256", "Discard must return to the acknowledged value");

  // A disabled preview must not create an image resource reference.
  await page.locator('[name="background.enabled"]').uncheck();
  await page.locator('[name="background.src"]').fill("https://example.invalid/background.png");
  assert.equal(await page.locator("[data-background-preview]").evaluate(el => el.style.backgroundImage), "none");
  await page.locator("[data-discard-draft]").click();
  await page.evaluate(() => { window.workspaceTest.writeMode = "allow"; });
  await tile.fill("512");
  await applyWorkspaceAction(page, save);
}
