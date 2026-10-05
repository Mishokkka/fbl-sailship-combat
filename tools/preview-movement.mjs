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
fixture.phase = "movement";
fixture.setupConfirmed = true;
fixture.revision = 4;
fixture.board.terrain = {};
fixture.wind = { direction: 240, strength: "light" };
Object.assign(fixture.ships[0], { x: 12, y: 10, heading: 0, speed: 3, verticalVelocity: -1 });
fixture.turn.activeShipId = fixture.ships[0].id;
fixture.turn.phaseOrder.movement = fixture.ships.map(ship => ship.id);
const shell = "html,body{margin:0;height:100%;background:#080e14}body{padding:12px}button,input,select{font:inherit}h1,h2,h3,p{margin-top:0}.application{height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #34495c;border-radius:12px}.window-header{height:42px;min-height:42px;padding:8px 16px;display:flex;align-items:center}.window-title{font-size:13px;margin:0}.window-content{flex:1;min-height:0}.hidden{display:none!important}";
await mkdir("artifacts/interface", { recursive: true });

async function install(page) {
  await page.route("http://movement.test/**", async route => {
    const path = new URL(route.request().url()).pathname.slice(1);
    if (!/^(scripts\/[a-zA-Z0-9_./-]+\.js|tests\/test-env\.js)$/.test(path) || path.includes("..")) return route.abort();
    let source = await readFile(path, "utf8");
    if (path === "tests/test-env.js") source = source.replace('import { webcrypto } from "node:crypto";', "const webcrypto = globalThis.crypto;");
    await route.fulfill({ contentType: "application/javascript", headers: { "Access-Control-Allow-Origin": "*" }, body: source });
  });
  await page.setContent('<!doctype html><html lang="ru"><meta charset="utf-8"><style>' + shell + css + '</style><body><section class="application sailships-combat sailships-battle-app"><header class="window-header"><h1 class="window-title">Планирование манёвра</h1></header><div class="window-content ssc-shell ssc-main-grid"></div></section></body></html>');
  await page.addScriptTag({ content: await readFile("node_modules/handlebars/dist/handlebars.js", "utf8") });
  await page.evaluate(async ({ fixture, partials, language }) => {
    await import("http://movement.test/tests/test-env.js");
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
    const { registerHandlebarsHelpers } = await import("http://movement.test/scripts/utils/helpers.js");
    registerHandlebarsHelpers();
    const { MovementEngine } = await import("http://movement.test/scripts/engine/movement-engine.js");
    const { cellToPixel } = await import("http://movement.test/scripts/board/board-geometry.js");
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
    const { NavalBattleApp } = await import("http://movement.test/scripts/apps/naval-battle-app.js");
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
    harness.reset = async ({ collision = false } = {}) => {
      stored = structuredClone(fixture);
      app.movementPlan.pending = null;
      app.movementPlan.notice = "";
      app.selectedShipId = stored.ships[0].id;
      if (collision) {
        const path = MovementEngine.getPathCells(stored.ships[0], 0, 3, stored);
        Object.assign(stored.ships[1], { x: path[2].x, y: path[2].y, heading: 180, altitude: stored.ships[0].altitude });
      }
      app.renderBattleSnapshot = null;
      app.contextBuilder.invalidate();
      app.layout.pane = "board";
      app.boardCamera = { x: 0, y: 0, zoom: 1.8 };
      await app.render({ parts: Object.keys(NavalBattleApp.PARTS) });
      // Pan via the production camera to keep the fixture above the draft card.
      const svg = app.element.querySelector(".ssc-board-svg");
      const area = app.element.querySelector(".ssc-center-panel").getBoundingClientRect();
      const point = svg.createSVGPoint();
      point.x = area.left + area.width / 2;
      point.y = area.top + 180;
      const desired = point.matrixTransform(svg.getScreenCTM().inverse());
      const ship = cellToPixel(stored.board, stored.ships[0].x, stored.ships[0].y);
      app.boardCamera.x += ship.cx - desired.x;
      app.boardCamera.y += ship.cy - desired.y;
      app.board.applyBoardViewBox(svg);
    };
    harness.route = ({ collision = false, last = false } = {}) => {
      const cells = MovementEngine.getReachableCells(stored, stored.ships[0])
        .filter(cell => Boolean(cell.collision) === collision && (collision || cell.heading === 0));
      const cell = last ? cells.at(-1) : cells[0];
      if (!cell) throw new Error("Fixture has no candidate");
      const svg = app.element.querySelector(".ssc-board-svg");
      const center = cellToPixel(stored.board, cell.x, cell.y);
      const point = svg.createSVGPoint();
      point.x = center.cx; point.y = center.cy;
      const screen = point.matrixTransform(svg.getScreenCTM());
      return { x: cell.x, y: cell.y, screenX: screen.x, screenY: screen.y };
    };
    harness.externalChange = () => { stored.revision++; app.onExternalBattleUpdate({ renderParts: ["fleet"] }); };
    window.movementTest = harness;
    window.previewApp = app;
    await harness.reset();
  }, { fixture, partials, language });
}
async function choose(page, options = {}) {
  const route = await page.evaluate(options => window.movementTest.route(options), options);
  await page.mouse.click(route.screenX, route.screenY);
  await page.waitForFunction(({ x, y }) => {
    const pending = window.previewApp.movementPlan.pending;
    return pending?.x === x && pending?.y === y;
  }, route);
  await page.locator('[data-action="confirmMovementPlan"]').waitFor({ state: "visible" });
}
async function checkCard(page, label) {
  const geometry = await page.locator(".ssc-movement-plan").evaluate(card => {
    const actions = card.querySelector(".ssc-plan-actions");
    const button = actions.querySelector('[data-action="confirmMovementPlan"]');
    const rect = button.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      overflow: card.scrollWidth > card.clientWidth + 2,
      clipped: rect.bottom > card.getBoundingClientRect().bottom + 1,
      hit: button === hit || button.contains(hit)
    };
  });
  assert.deepEqual(geometry, { overflow: false, clipped: false, hit: true }, label);
  assert.equal(await page.locator(".ssc-route-ghost").count(), 1);
  assert.equal(await page.locator(".ssc-route-line").count(), 1);
}
const browser = await chromium.launch();
let layouts = 0;
try {
  for (const [width, height] of [[1500, 900], [1100, 900], [800, 900], [800, 650]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await install(page);
    const before = await page.evaluate(() => window.movementTest.read());
    await choose(page);
    await checkCard(page, "Route at " + width + "x" + height);
    assert.deepEqual(await page.evaluate(() => window.movementTest.read()), before);
    await page.screenshot({ path: "artifacts/interface/movement-plan-" + width + "-" + height + ".png" });
    await choose(page, { last: true });
    await page.keyboard.press("Escape");
    await page.locator(".ssc-movement-plan").waitFor({ state: "detached" });
    assert.deepEqual(await page.evaluate(() => window.movementTest.read()), before);
    await choose(page);
    await page.locator('[data-action="confirmMovementPlan"]').click();
    await page.evaluate(() => window.movementTest.lastAction);
    assert.equal(await page.evaluate(() => window.movementTest.commits), 1);
    assert.equal(await page.locator(".ssc-movement-plan").count(), 0);
    assert.match(await page.locator(".ssc-movement-notice").textContent(), /манёвр выполнен/);

    await page.evaluate(() => window.movementTest.reset({ collision: true }));
    await choose(page, { collision: true });
    await checkCard(page, "Collision at " + width + "x" + height);
    assert.match(await page.locator('[data-action="confirmMovementPlan"]').textContent(), /Подтвердить столкновение/);
    await page.screenshot({ path: "artifacts/interface/movement-collision-" + width + "-" + height + ".png" });
    const collisionBefore = await page.evaluate(() => window.movementTest.read());
    await page.locator('[data-action="cancelMovementPlan"]').click();
    await page.evaluate(() => window.movementTest.lastAction);
    assert.deepEqual(await page.evaluate(() => window.movementTest.read()), collisionBefore);
    await choose(page, { collision: true });
    await page.evaluate(() => window.movementTest.externalChange());
    await page.locator(".ssc-movement-plan").waitFor({ state: "detached" });
    assert.match(await page.locator(".ssc-movement-notice").textContent(), /изменилась/);
    assert.equal(await page.evaluate(() => window.movementTest.commits), 1);
    assert.deepEqual(errors, [], "Browser errors at " + width + "x" + height);
    layouts += 1;
    await page.close();
  }
} finally { await browser.close(); }
console.log("Movement workflow passed: " + layouts + " sizes; real map clicks, replacement, Escape, confirmation, collision and stale drafts.");
