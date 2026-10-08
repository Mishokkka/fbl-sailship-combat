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
fixture.phase = "crew";
fixture.setupConfirmed = true;
fixture.revision = 4;
fixture.board.terrain = {};
fixture.wind = { direction: 240, strength: "light" };
Object.assign(fixture.ships[0], { x: 12, y: 10, heading: 0, speed: 2, altitude: 4 });
Object.assign(fixture.ships[1], { x: 12, y: 6, heading: 180, speed: 2, altitude: 4 });
fixture.turn.activeShipId = fixture.ships[0].id;
fixture.turn.phaseOrder.crew = fixture.ships.map(ship => ship.id);
fixture.ships[0].selectedOrder = "damageControl";
fixture.ships[0].sections.bow.fire = 1;
fixture.ships[0].sections.stern.fire = 4;
fixture.ships[0].sections.midship.breaches = 2;
fixture.ships[0].sections.stern.systems[1].status = "damaged";
fixture.ships[0].sections.stern.systems[1].hp = { value: 1, max: 10 };
fixture.ships[0].crystal.heat = 10;
fixture.ships[0].crew.morale = 5;
const shell = "html,body{margin:0;height:100%;background:#080e14}body{padding:12px}button,input,select{font:inherit}h1,h2,h3,p{margin-top:0}.application{height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #34495c;border-radius:12px}.window-header{height:42px;min-height:42px;padding:8px 16px;display:flex;align-items:center}.window-title{font-size:13px;margin:0}.window-content{flex:1;min-height:0}.hidden{display:none!important}";
await mkdir("artifacts/interface", { recursive: true });

async function install(page) {
  await page.route("http://crew.test/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^(scripts\/[a-zA-Z0-9_./-]+\.js|tests\/test-env\.js)$/.test(path) || path.includes("..")) return route.abort();
    let source = await readFile(path, "utf8");
    if (path === "tests/test-env.js") source = source.replace('import { webcrypto } from "node:crypto";', "const webcrypto = globalThis.crypto;");
    await route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: source });
  });
  await page.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><style>' + shell + css + '</style><body><section class="application sailships-combat sailships-battle-app"><header class="window-header"><h1 class="window-title">Экипаж и аварии</h1></header><div class="window-content ssc-shell ssc-main-grid"></div></section></body></html>');
  await page.addScriptTag({ content: await readFile("node_modules/handlebars/dist/handlebars.js", "utf8") });
  await page.evaluate(async ({ fixture, partials, language }) => {
    await import("http://crew.test/tests/test-env.js");
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
    const { registerHandlebarsHelpers } = await import("http://crew.test/scripts/utils/helpers.js");
    registerHandlebarsHelpers();
    const { MovementEngine } = await import("http://crew.test/scripts/engine/movement-engine.js");
    const { GunneryEngine } = await import("http://crew.test/scripts/engine/gunnery-engine.js");
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
    const { NavalBattleApp } = await import("http://crew.test/scripts/apps/naval-battle-app.js");
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
      if (mode === "stale") { stored.revision++; return; }
      if (mode === "clear") {
        for (const section of Object.values(stored.ships[0].sections)) {
          section.fire = section.flooding = section.breaches = section.mastWreckage = 0;
          for (const system of section.systems) { system.status = "intact"; system.hp.value = system.hp.max; }
        }
        stored.ships[0].crystal.heat = 0;
        stored.ships[0].crew.morale = 10;
      }
      app.renderBattleSnapshot = null;
      app.contextBuilder.invalidate();
      await app.renderBattleState();
    };
    window.crewTest = harness;
    window.previewApp = app;
    await harness.reset();
  }, { fixture, partials, language });
}

async function action(page, selector) {
  await page.locator(selector).click();
  await page.evaluate(() => window.crewTest.lastAction);
}
async function checkLayout(page) {
  const overflow = await page.locator(".ssc-main-grid, .ssc-right-panel, .ssc-crew-task, .ssc-battle-report").evaluateAll(elements =>
    elements.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2).map(el => el.className));
  assert.deepEqual(overflow, []);
}
const browser = await chromium.launch();
try {
  for (const [width, height] of [[1500, 900], [1100, 900], [800, 900], [800, 650]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await install(page);
    const fireSelector = '[data-action="crewTask"][data-task-id="fire:stern:"]';
    assert.ok(await page.locator(".ssc-crew-task").count() >= 5);
    assert.match(await page.locator('.ssc-crew-task[data-task-id="fire:stern:"]').textContent(), /80%/);
    await checkLayout(page);
    await page.locator(".ssc-right-panel").evaluate(panel => { panel.scrollTop = 250; });
    await page.screenshot({ path: "artifacts/interface/crew-tasks-" + width + "-" + height + ".png" });
    if (width === 1500) console.log("CREW_IMAGE:" + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64"));
    if (width === 1500) {
      const before = await page.evaluate(() => window.crewTest.read());
      await page.evaluate(() => { window.crewTest.mode = "deny"; });
      await action(page, fireSelector);
      assert.deepEqual(await page.evaluate(() => window.crewTest.read()), before);
      assert.equal(await page.locator(".ssc-battle-report").count(), 0);
      await page.evaluate(() => { window.crewTest.mode = "allow"; });
    }
    await action(page, fireSelector);
    const afterFire = await page.evaluate(() => window.crewTest.read());
    assert.equal(afterFire.ships[0].sections.stern.fire, 2);
    assert.equal(afterFire.ships[0].sections.bow.fire, 1);
    assert.equal(afterFire.lastReport.kind, "crew");
    assert.equal(await page.locator(fireSelector).isDisabled(), true);
    assert.equal(await page.evaluate(() => window.previewApp.selectedShipId), afterFire.ships[0].id);
    await action(page, '[data-action="crewTask"][data-task-id="system:stern:1"]');
    const afterRepair = await page.evaluate(() => window.crewTest.read());
    assert.equal(afterRepair.ships[0].sections.stern.systems[1].hp.value, 5);
    assert.equal(afterRepair.ships[0].sections.stern.systems[1].status, "damaged");
    assert.equal(await page.evaluate(() => window.previewApp.selectedShipId), afterRepair.turn.activeShipId);
    assert.match(await page.locator(".ssc-battle-report").textContent(), /Работа экипажа выполнена/);
    await page.locator(".ssc-battle-report details summary").click();
    assert.match(await page.locator(".ssc-battle-report").textContent(), /1 → 5/);
    await checkLayout(page);
    await page.locator(".ssc-right-panel").evaluate(panel => { panel.scrollTop = 0; });
    await page.screenshot({ path: "artifacts/interface/crew-result-" + width + "-" + height + ".png" });
    if (width === 800 && height === 650) console.log("CREW_IMAGE:" + (await page.screenshot({ type: "jpeg", quality: 45 })).toString("base64"));
    await page.evaluate(() => window.crewTest.reset());
    await page.evaluate(() => window.crewTest.change("clear"));
    assert.match(await page.locator(".ssc-guidance h2").textContent(), /Корабль в порядке/);
    assert.equal(await page.locator(".ssc-crew-task").count(), 0);
    await action(page, '.ssc-guidance [data-action="passTurn"]');
    assert.notEqual(await page.evaluate(() => window.previewApp.selectedShipId), "ship-blue");
    if (width === 1500) {
      await page.evaluate(() => window.crewTest.reset());
      const before = await page.evaluate(() => window.crewTest.read());
      await page.evaluate(() => window.crewTest.change("stale"));
      await action(page, fireSelector);
      const after = await page.evaluate(() => window.crewTest.read());
      assert.equal(after.lastReport, undefined);
      assert.deepEqual(after.ships, before.ships);
    }
    assert.deepEqual(errors, []);
    console.log("Crew workflow passed at " + width + "x" + height);
    await page.close();
  }
} finally { await browser.close(); }
