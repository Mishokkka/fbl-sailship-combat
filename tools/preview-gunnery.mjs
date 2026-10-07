// Production board events, application actions and partial renders in Chromium.
// Foundry persistence/chrome are stubbed; animations and multiplayer transport are not exercised.
import { readFile, readdir, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import "../tests/test-env.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";

const partials = {};
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) await collect(path);
    else if (path.endsWith(".hbs")) partials["modules/sailships-combat/" + path] = await readFile(path, "utf8");
  }
}
await collect("templates");
const manifest = JSON.parse(await readFile("module.json", "utf8"));
const css = (await Promise.all(manifest.styles.map(path => readFile(path, "utf8")))).join("\n");
const language = JSON.parse(await readFile("lang/ru.json", "utf8"));
const fixture = BattleNormalizer.normalize(createDefaultBattle());
fixture.phase = "gunnery";
fixture.setupConfirmed = true;
fixture.revision = 4;
fixture.board.terrain = {};
fixture.wind = { direction: 240, strength: "light" };
Object.assign(fixture.ships[0], { x: 12, y: 10, heading: 0, speed: 2, altitude: 4 });
Object.assign(fixture.ships[1], { x: 12, y: 6, heading: 180, speed: 2, altitude: 4 });
fixture.turn.activeShipId = fixture.ships[0].id;
fixture.turn.phaseOrder.gunnery = fixture.ships.map(ship => ship.id);
const shell = "html,body{margin:0;height:100%;background:#080e14}body{padding:12px}button,input,select{font:inherit}h1,h2,h3,p{margin-top:0}.application{height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #34495c;border-radius:12px}.window-header{height:42px;min-height:42px;padding:8px 16px;display:flex;align-items:center}.window-title{font-size:13px;margin:0}.window-content{flex:1;min-height:0}.hidden{display:none!important}";
await mkdir("artifacts/interface", { recursive: true });

async function install(page) {
  await page.route("http://gunnery.test/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^(scripts\/[a-zA-Z0-9_./-]+\.js|tests\/test-env\.js)$/.test(path) || path.includes("..")) return route.abort();
    let source = await readFile(path, "utf8");
    if (path === "tests/test-env.js") source = source.replace('import { webcrypto } from "node:crypto";', "const webcrypto = globalThis.crypto;");
    await route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: source });
  });
  await page.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><style>' + shell + css + '</style><body><section class="application sailships-combat sailships-battle-app"><header class="window-header"><h1 class="window-title">Стрельба и последствия</h1></header><div class="window-content ssc-shell ssc-main-grid"></div></section></body></html>');
  await page.addScriptTag({ content: await readFile("node_modules/handlebars/dist/handlebars.js", "utf8") });
  await page.evaluate(async ({ fixture, partials, language }) => {
    await import("http://gunnery.test/tests/test-env.js");
    foundry.utils.mergeObject = (a, b) => ({ ...a, ...b });
    foundry.applications = { api: {
      ApplicationV2: class {
        constructor() { this.options = this.constructor.DEFAULT_OPTIONS; }
        async _prepareContext() { return {}; }
        async _preparePartContext(part, context) { return { ...context }; }
        _onRender() {}
        async render(options = {}) {
          const context = await this._prepareContext(options);
          for (const key of options.parts ?? Object.keys(this.constructor.PARTS)) {
            const partContext = await this._preparePartContext(key, context, options);
            const source = partials[this.constructor.PARTS[key].template];
            const template = document.createElement("template");
            template.innerHTML = Handlebars.compile(source)(partContext).trim();
            const node = template.content.firstElementChild;
            node.dataset.testPart = key;
            const old = this.element.querySelector('[data-test-part="' + key + '"]');
            if (old) old.replaceWith(node);
            else this.element.querySelector(".window-content").append(node);
          }
          this._onRender(context, options);
          return this;
        }
      },
      HandlebarsApplicationMixin: Base => Base
    } };
    game.i18n = { localize: key => key.split(".").reduce((v, k) => v?.[k], language) ?? key };
    Handlebars.registerHelper("localize", key => game.i18n.localize(key));
    for (const [path, source] of Object.entries(partials)) Handlebars.registerPartial(path, source);
    const { registerHandlebarsHelpers } = await import("http://gunnery.test/scripts/utils/helpers.js");
    registerHandlebarsHelpers();
    const { MovementEngine } = await import("http://gunnery.test/scripts/engine/movement-engine.js");
    const { GunneryEngine } = await import("http://gunnery.test/scripts/engine/gunnery-engine.js");
    Math.random = () => 0.15;
    let stored = structuredClone(fixture);
    const harness = { commits: 0, notifications: [], mode: "allow", read: () => structuredClone(stored) };
    ui.notifications.warn = ui.notifications.error = message => harness.notifications.push(message);
    game.sailshipsCombat = { storage: {
      getBattleForUser: () => structuredClone(stored), getSavedBattleMetadata: () => [],
      async updateBattle(mutator) {
        const next = structuredClone(stored);
        if (await mutator(next) === false || harness.mode === "deny") return structuredClone(stored);
        next.revision++;
        stored = next;
        harness.commits++;
        return structuredClone(stored);
      }
    } };
    const { NavalBattleApp } = await import("http://gunnery.test/scripts/apps/naval-battle-app.js");
    const app = new NavalBattleApp();
    app.element = document.querySelector(".application");
    app.animation.onRender = () => {};
    app.selectedShipId = stored.ships[0].id;
    app.element.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      const handler = app.constructor.DEFAULT_OPTIONS.actions[target?.dataset.action];
      if (!handler || target.matches(":disabled")) return;
      harness.lastAction = Promise.resolve(handler.call(app, event, target));
      harness.lastAction.catch(() => {});
    });
    harness.reset = async () => {
      stored = structuredClone(fixture);
      app.selectedShipId = stored.ships[0].id;
      app.selectedTargetId = null;
      app.aimSection = null;
      app.selectedBatteryArc = null;
      app.dismissedReportId = null;
      for (const ship of stored.ships) MovementEngine.syncSailingState(stored, ship);
      app.renderBattleSnapshot = null;
      app.contextBuilder.invalidate();
      app.layout.pane = "controls";
      await app.render({ parts: Object.keys(NavalBattleApp.PARTS) });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    };
    harness.change = async mode => {
      if (mode === "miss") Math.random = () => 0.999;
      if (mode === "hit") Math.random = () => 0.15;
      if (mode === "reload") GunneryEngine.getBattery(stored.ships[0], "bow").reload = 2;
      if (mode === "round") {
        stored.phase = "crew";
        stored.turn.activeShipId = null;
        stored.turn.completed.crew = stored.ships.map(unit => unit.id);
        stored.ships[0].sections.bow.fire = 1;
        stored.ships[0].verticalVelocity = -1;
      }
      if (mode === "stale") {
        stored.revision++;
        return; // Keep the rendered revision: emulate an update queued ahead of a click.
      }
      app.renderBattleSnapshot = null;
      app.contextBuilder.invalidate();
      await app.renderBattleState();
    };
    window.gunneryTest = harness;
    window.previewApp = app;
    await harness.reset();
  }, { fixture, partials, language });
}

async function action(page, selector) {
  await page.locator(selector).click();
  await page.evaluate(() => window.gunneryTest.lastAction);
}
async function checkLayout(page, label) {
  const overflow = await page.locator(".ssc-main-grid, .ssc-right-panel, .ssc-battle-report, .ssc-report-toast").evaluateAll(elements =>
    elements.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => el.className));
  assert.deepEqual(overflow, [], label + " has horizontal overflow");
}
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1500, 900], [1100, 900], [800, 900], [800, 650]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await install(page);
    assert.equal(await page.locator(".ssc-phase-pill").count(), 4);
    assert.equal(await page.locator('[data-action="fireBow"]').isDisabled(), true);
    await page.locator('.ssc-target-picker [data-target-id="ship-red"]').click();
    await page.waitForFunction(() => window.previewApp.selectedTargetId === "ship-red");
    await page.evaluate(() => window.previewApp._renderDrainPromise);
    assert.equal(await page.locator('[data-action="fireBow"]').isEnabled(), true);
    await action(page, '[data-action="selectBatteryArc"][data-arc="bow"]');
    assert.equal(await page.locator(".ssc-fire-arc.arc-bow.is-focused").count(), 1);
    await action(page, '.arc-bow [data-action="setAmmo"][data-ammo="chainShot"]');
    assert.match(await page.locator(".ssc-shot-preview-card.arc-bow .ssc-shot-intent").textContent(), /паруса/);
    await checkLayout(page, "Shot " + width + "x" + height);
    await page.locator(".ssc-right-panel").evaluate(panel => { panel.scrollTop = 0; });
    await page.screenshot({ path: "artifacts/interface/gunnery-choice-" + width + "-" + height + ".png" });
    if (width === 1500) console.log("GUNNERY_IMAGE:" + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64"));

    if (width === 1500) {
      const before = await page.evaluate(() => window.gunneryTest.read());
      await page.evaluate(() => { window.gunneryTest.mode = "deny"; });
      await action(page, '[data-action="fireBow"]');
      assert.deepEqual(await page.evaluate(() => window.gunneryTest.read()), before);
      assert.equal(await page.locator(".ssc-battle-report").count(), 0);
      await page.evaluate(() => { window.gunneryTest.mode = "allow"; });
    }
    await action(page, '[data-action="fireBow"]');
    const result = await page.evaluate(() => ({ battle: window.gunneryTest.read(), selected: window.previewApp.selectedShipId }));
    assert.equal(result.battle.lastReport.outcome, "hit");
    assert.equal(result.selected, result.battle.turn.activeShipId);
    assert.equal(await page.locator(".ssc-battle-report").count(), 1);
    assert.match(await page.locator(".ssc-report-outcome").textContent(), /Попадание/);
    await page.evaluate(() => window.previewApp.layout.showPane("board"));
    await page.locator(".ssc-report-toast").waitFor({ state: "visible" });
    const accessible = await page.locator('[data-action="showBattleReport"]').evaluate(button => {
      const r = button.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
      return hit === button || button.contains(hit);
    });
    assert.ok(accessible, "Report must remain reachable on the board");
    await checkLayout(page, "Result " + width + "x" + height);
    await page.screenshot({ path: "artifacts/interface/gunnery-result-" + width + "-" + height + ".png" });
    if (width === 800 && height === 650) console.log("GUNNERY_IMAGE:" + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64"));
    await action(page, '[data-action="showBattleReport"]');
    assert.equal(await page.locator(".ssc-battle-report details").getAttribute("open"), "");
    assert.ok(await page.locator(".ssc-report-changes > div").count() > 0);
    await page.evaluate(() => window.previewApp.layout.showPane("board"));
    await action(page, '[data-action="dismissBattleReport"]');
    assert.equal(await page.locator(".ssc-report-toast").count(), 0);

    await page.evaluate(() => window.gunneryTest.change("round"));
    const oldRound = await page.evaluate(() => window.gunneryTest.read().round);
    await action(page, '.ssc-board-control-dock [data-action="nextPhase"]');
    const settled = await page.evaluate(() => window.gunneryTest.read());
    assert.equal(settled.round, oldRound + 1);
    assert.equal(settled.phase, "orders");
    assert.equal(settled.lastReport.kind, "round");
    assert.equal(settled.lastReport.round, oldRound);
    await checkLayout(page, "Round " + width + "x" + height);
    await page.screenshot({ path: "artifacts/interface/round-result-" + width + "-" + height + ".png" });
    if (width === 1500) console.log("GUNNERY_IMAGE:" + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64"));

    if (width === 1500) {
      await page.evaluate(() => window.gunneryTest.reset());
      await page.locator('.ssc-target-picker [data-target-id="ship-red"]').click();
      await page.evaluate(() => window.previewApp._renderDrainPromise);
      await action(page, '.arc-bow [data-action="setFireMode"][data-fire-mode="delayed"]');
      await action(page, '[data-action="fireBow"]');
      assert.equal(await page.evaluate(() => window.gunneryTest.read().lastReport.outcome), "prepared");
      await page.evaluate(() => window.gunneryTest.reset());
      await page.locator('.ssc-target-picker [data-target-id="ship-red"]').click();
      await page.evaluate(() => window.previewApp._renderDrainPromise);
      await page.evaluate(() => window.gunneryTest.change("stale"));
      await action(page, '[data-action="fireBow"]');
      assert.equal(await page.evaluate(() => window.gunneryTest.read().lastReport), undefined);
    }
    assert.deepEqual(errors, [], "Browser errors");
    console.log("Gunnery/round workflow passed at " + width + "x" + height);
    await page.close();
  }
} finally { await browser.close(); }
