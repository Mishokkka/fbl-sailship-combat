// Production wind SVG, camera, reduced-motion lifecycle and movement readouts in Chromium.
// Foundry chrome and persistence are stubbed; timings below isolate the ambient SVG layer.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
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
      for (const ship of stored.ships) MovementEngine.syncSailingState(stored, ship);
      app.renderBattleSnapshot = null;
      app.contextBuilder.invalidate();
      app.layout.pane = "board";
      app.boardCamera = { x: 0, y: 0, zoom: 1 };
      await app.render({ parts: Object.keys(NavalBattleApp.PARTS) });
      // Let responsive CSS and SVG viewport metrics settle before measuring the camera.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
    harness.setWind = async (strength, direction = 240) => {
      stored.wind = { strength, direction }; stored.revision++;
      app.renderBattleSnapshot = null; app.contextBuilder.invalidate();
      await app.render({ parts: ["board", "summary", "controls"] });
    };
    harness.externalChange = () => { stored.revision++; app.onExternalBattleUpdate({ renderParts: ["fleet"] }); };
    window.movementTest = harness;
    window.previewApp = app;
    await harness.reset();
  }, { fixture, partials, language });
}
async function choose(page, options = {}) {
  const route = await page.evaluate(options => window.movementTest.route(options), options);
  const hit = await page.evaluate(route => {
    const node = document.elementFromPoint(route.screenX, route.screenY);
    return { tag: node?.tagName, className: node?.getAttribute("class"),
      onBoard: Boolean(node?.closest(".ssc-board-svg")), camera: window.previewApp.boardCamera };
  }, route);
  assert.equal(hit.onBoard, true, "Destination must be clickable: " + JSON.stringify({ route, hit, viewport: page.viewportSize() }));
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
try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 }, reducedMotion: "reduce" });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await install(page);
  assert.equal(await page.locator(".ssc-wind-particles line").count(), 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => document.querySelectorAll(".ssc-wind-particles line").length === 10);
  await page.evaluate(() => movementTest.setWind("strong"));
  assert.match(await page.locator(".ssc-wind-widget").textContent(), /СВ → ЮЗ/);
  assert.equal(await page.locator(".ssc-wind-particles line").count(), 14);
  const before = await page.evaluate(() => movementTest.read());
  await choose(page);
  await checkCard(page, "With end-of-round drift");
  assert.equal(await page.locator(".ssc-drift-cue").count(), 1);
  assert.match(await page.locator(".ssc-plan-drift").textContent(), /Снос 1 гекс/);
  assert.deepEqual(await page.evaluate(() => movementTest.read()), before);
  await page.screenshot({ path: "artifacts/interface/wind-inertia-plan.png" });
  console.log("WIND_PREVIEW_BASE64 " + (await page.screenshot({ type: "jpeg", quality: 80 })).toString("base64"));
  await page.keyboard.press("Escape");
  await page.evaluate(() => movementTest.setWind("calm"));
  assert.equal(await page.locator(".ssc-wind-particles line").count(), 0);
  assert.match(await page.locator(".ssc-wind-widget").textContent(), /Штиль/);
  await page.evaluate(() => movementTest.setWind("storm"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelectorAll(".ssc-wind-particles line").length === 0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.waitForFunction(() => document.querySelectorAll(".ssc-wind-particles line").length === 16);

  // Use production camera updates without rendering to verify immediate pan/zoom tracking.
  const cameraResult = await page.evaluate(() => {
    const svg = document.querySelector(".ssc-board-svg"), node = svg.querySelector(".ssc-wind-camera");
    const before = node.getAttribute("transform");
    previewApp.boardCamera.zoom = 2; previewApp.boardCamera.x = 230; previewApp.boardCamera.y = 410;
    previewApp.board.applyBoardViewBox(svg);
    return { changed: before !== node.getAttribute("transform"), sameNode: node === svg.querySelector(".ssc-wind-camera") };
  });
  assert.deepEqual(cameraResult, { changed: true, sameNode: true });
  assert.deepEqual(errors, []);

  // Compare visible strokes with the old production builder, copied from the audited main.
  // The legacy function is embedded from that revision rather than approximated in the test.
  const coverage = await page.evaluate(async () => {
    const { describeWindField, syncWindCamera } = await import("http://movement.test/scripts/visuals/wind-field.js");
    const { normalizeAngle } = await import("http://movement.test/scripts/board/board-geometry.js");
    const VisualSettingsService = { wind: () => true };
    const legacy = function (battle, pixelWidth, pixelHeight, lod = "near") {
    const rating = ({ calm: 0, light: 1, moderate: 2, strong: 3, storm: 4 }[battle.wind?.strength] ?? 2);
    const baseCount = [0, 8, 12, 16, 20][rating] ?? 12;
    const lodFactor = lod === "far" ? 0.45 : lod === "medium" ? 0.72 : 1;
    const count = rating === 0 || !VisualSettingsService.wind() ? 0 : Math.max(4, Math.round(baseCount * lodFactor));
    const span = Math.max(pixelWidth, pixelHeight);
    const travel = Math.ceil(span * 2.6);
    const durationBase = Math.max(0.9, 3.0 - rating * 0.5);
    const particles = Array.from({ length: count }, (_, i) => {
      const lane = ((i * 137 + 53) % Math.max(1, pixelHeight * 3)) - pixelHeight;
      const x = -span - ((i * 83) % Math.max(1, span));
      const length = 12 + (i % 5) * 5 + rating * 2;
      return {
        i,
        x1: x,
        x2: x + length,
        y: lane,
        width: 0.7 + (i % 3) * 0.35,
        duration: Number((durationBase + (i % 5) * 0.18).toFixed(2)),
        delay: Number((-(i * 0.31) % Math.max(0.1, durationBase)).toFixed(2))
      };
    });
    return {
      windParticles: particles,
      windParticleAngle: normalizeAngle(Number(battle.wind?.direction ?? 0) - 90),
      windParticleCenterX: Math.round(pixelWidth / 2),
      windParticleCenterY: Math.round(pixelHeight / 2),
      windParticleTravel: travel,
      windParticleOpacity: rating === 0 ? 0 : Math.min(0.66, 0.16 + rating * 0.11)
    };
  };
    previewApp.animation.destroy();
    document.body.innerHTML = '<section class="sailships-combat"><svg id="probe" width="1000" height="750"></svg></section>';
    const svg = document.querySelector("svg");
    function mount(kind, board, camera, direction, strength = "light") {
      const wind = { direction, strength };
      const field = kind === "new" ? describeWindField(wind, camera)
        : legacy({ wind }, board.width, board.height, camera.zoom < .75 ? "far" : camera.zoom < 1.15 ? "medium" : "near");
      svg.setAttribute("viewBox", [camera.x, camera.y, camera.viewWidth, camera.viewHeight].join(" "));
      const rotation = kind === "new" ? 'rotate(' + field.windParticleAngle + ')' : 'rotate(' + field.windParticleAngle + ' ' + field.windParticleCenterX + ' ' + field.windParticleCenterY + ')';
      svg.innerHTML = '<g class="ssc-wind-camera" transform="' + (kind === "new" ? field.windCameraTransform : '') + '"><g class="ssc-wind-particles" opacity="' + field.windParticleOpacity + '" transform="' + rotation + '">' + field.windParticles.map(p =>
        '<line x1="' + p.x1 + '" y1="' + p.y + '" x2="' + p.x2 + '" y2="' + p.y + '" stroke-width="' + p.width + '"><animateTransform attributeName="transform" type="translate" from="0 0" to="' + field.windParticleTravel + ' 0" dur="' + p.duration + 's" begin="' + p.delay + 's" repeatCount="indefinite"/></line>'
      ).join("") + '</g></g>';
      return field;
    }
    function visibleCount() {
      const view = svg.viewBox.baseVal;
      let count = 0;
      for (const line of svg.querySelectorAll("line")) {
        const matrix = svg.getScreenCTM().inverse().multiply(line.getScreenCTM());
        const a = new DOMPoint(line.x1.baseVal.value, line.y1.baseVal.value).matrixTransform(matrix);
        const b = new DOMPoint(line.x2.baseVal.value, line.y2.baseVal.value).matrixTransform(matrix);
        if (Math.max(a.x, b.x) >= view.x && Math.min(a.x, b.x) <= view.x + view.width
          && Math.max(a.y, b.y) >= view.y && Math.min(a.y, b.y) <= view.y + view.height) count++;
      }
      return count;
    }
    const rows = [];
    for (const board of [{ width: 500, height: 350 }, { width: 1500, height: 2000 }, { width: 5000, height: 4000 }]) {
      for (const direction of [0, 60, 120, 180, 240, 300]) for (const zoom of [.45, 1, 4]) {
        const camera = { x: board.width * .3, y: board.height * .2, viewWidth: board.width / zoom, viewHeight: board.height / zoom, zoom };
        const row = { board: board.width + "x" + board.height, direction, zoom };
        for (const kind of ["old", "new"]) {
          const field = mount(kind, board, camera, direction);
          svg.pauseAnimations();
          const counts = [];
          for (let t = 0; t < 16; t++) { svg.setCurrentTime(t * 1.173); counts.push(visibleCount()); }
          row[kind] = Number((counts.reduce((a,b) => a+b, 0) / counts.length).toFixed(2));
          if (kind === "new" && row[kind] < 1) throw new Error("Invisible wind: " + JSON.stringify(row));
          if (kind === "new") {
            const line = svg.querySelector("line");
            svg.setCurrentTime(3);
            const a = new DOMPoint(0,0).matrixTransform(line.getScreenCTM());
            svg.setCurrentTime(3.01);
            const b = new DOMPoint(0,0).matrixTransform(line.getScreenCTM());
            const rad = field.windParticleAngle * Math.PI / 180;
            if ((b.x-a.x)*Math.cos(rad)+(b.y-a.y)*Math.sin(rad) <= 0) throw new Error("Wind is reversed");
            const nodes = svg.querySelectorAll("*").length;
            const next = { ...camera, x: camera.x + 10000, y: camera.y - 9000 };
            svg.setAttribute("viewBox", [next.x,next.y,next.viewWidth,next.viewHeight].join(" "));
            syncWindCamera(svg, next);
            if (visibleCount() !== counts[0]) {
              // Pan preserves coverage at the same time, independent of world coordinates.
              const after = visibleCount(); syncWindCamera(svg, camera);
              svg.setAttribute("viewBox", [camera.x,camera.y,camera.viewWidth,camera.viewHeight].join(" "));
              if (after !== visibleCount()) throw new Error("Pan changes wind density");
            }
            if (nodes !== svg.querySelectorAll("*").length) throw new Error("Pan rebuilt the wind");
          }
        }
        rows.push(row);
      }
    }
    window.windProbe = { mount, svg };
    return rows;
  });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const samples = [];
  for (const kind of ["old", "new", "new", "old"]) {
    await page.evaluate(kind => {
      windProbe.mount(kind, { width: 5000, height: 4000 }, { x: 0, y: 0, viewWidth: 5000, viewHeight: 4000, zoom: 1 }, 240, "storm");
      windProbe.svg.unpauseAnimations();
    }, kind);
    const before = (await cdp.send("Performance.getMetrics")).metrics.find(m => m.name === "TaskDuration").value;
    const frames = await page.evaluate(() => new Promise(resolve => {
      const values = []; let last = performance.now(), start = last;
      function tick(now) { values.push(now-last); last = now; if (now-start < 1200) requestAnimationFrame(tick); else resolve(values); }
      requestAnimationFrame(tick);
    }));
    const after = (await cdp.send("Performance.getMetrics")).metrics.find(m => m.name === "TaskDuration").value;
    const sorted = frames.slice(1).sort((a,b) => a-b);
    samples.push({ kind, nodes: await page.locator("#probe *").count(), taskMs: Number(((after-before)*1000).toFixed(2)), frameP95: Number(sorted[Math.floor(sorted.length*.95)].toFixed(2)) });
  }
  const report = { coverage, samples, caveat: "Chromium CI, isolated ambient SVG; timings are observations, not an FPS guarantee for Foundry." };
  await writeFile("artifacts/interface/wind-audit.json", JSON.stringify(report, null, 2));
  console.log("WIND_AUDIT " + JSON.stringify(report));
  console.log("Wind coverage: 54 camera/direction cases; lifecycle, camera identity and real route confirmation checked.");
} finally { await browser.close(); }
