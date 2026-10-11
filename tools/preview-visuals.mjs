// Real SVG artwork and animation controller in Chromium; Foundry persistence is stubbed.
import { readFile, readdir, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
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
let css = (await Promise.all(manifest.styles.map(path => readFile(path, "utf8")))).join("\n");
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
      if (mode === "overflow") {
        Math.random = () => 0.15;
        app.aimSection = "midship";
        for (const [id, section] of Object.entries(stored.ships[1].sections)) {
          section.hp = { value: id === "midship" ? 0 : 20, max: 20 };
          section.dr = id === "midship" ? 0 : 100;
          section.systems = [];
        }
      }
      if (mode === "round") {
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
    harness.units = async count => {
      stored.ships = Array.from({ length: count }, (_, i) => {
        const unit = structuredClone(fixture.ships[i % 2]);
        Object.assign(unit, { id: "visual-" + i, name: "Корабль " + (i + 1), x: 6 + (i % 6) * 2, y: 5 + Math.floor(i / 6) * 2, heading: (i % 6) * 60 });
        unit.stats.sm = 5 + i % 5;
        return unit;
      });
      app.selectedShipId = stored.ships[0].id;
      stored.turn.activeShipId = stored.ships[0].id;
      app.renderBattleSnapshot = null; app.contextBuilder.invalidate();
      await app.render({ parts: Object.keys(NavalBattleApp.PARTS) });
      app.layout.showPane("board");
    };
    window.gunneryTest = harness;
    window.previewApp = app;
    await harness.reset();
  }, { fixture, partials, language });
}

const browser = await chromium.launch();
try {
  const measurements = [];
  const newCss = css, boardPath = "modules/sailships-combat/templates/naval/parts/naval-board.hbs";
  const newBoard = partials[boardPath];
  const baseline = "a5d805b74bb38dcc2f9277f7ed74be984bb9dfb9";
  const gitRead = path => execFileSync("git", ["show", baseline + ":" + path], { encoding: "utf8" });
  const oldManifest = JSON.parse(gitRead("module.json"));
  const oldCss = oldManifest.styles.map(gitRead).join("\n");
  for (const version of ["baseline", "new"]) {
    css = version === "new" ? newCss : oldCss;
    partials[boardPath] = version === "new" ? newBoard : gitRead("templates/naval/parts/naval-board.hbs");
    const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await install(page);
    for (const count of [4, 12, 30]) {
      await page.evaluate(count => gunneryTest.units(count), count);
      const result = await page.evaluate(async () => {
        const durations = [];
        for (let i = 0; i < 12; i++) {
          const start = performance.now();
          await previewApp.render({ parts: ["board"] });
          document.querySelector(".ssc-board-svg").getBoundingClientRect();
          durations.push(performance.now() - start);
        }
        const intervals = [];
        await new Promise(resolve => {
          let last = performance.now();
          const tick = now => { intervals.push(now - last); last = now;
            if (intervals.length < 90) requestAnimationFrame(tick); else resolve(); };
          requestAnimationFrame(tick);
        });
        const sorted = durations.slice(2).sort((a,b) => a-b);
        const frames = intervals.slice(2).sort((a,b) => a-b);
        return { renderMedianMs: sorted[Math.floor(sorted.length / 2)], frameP95Ms: frames[Math.floor(frames.length * .95)],
          nodes: document.querySelector(".ssc-board-svg").querySelectorAll("*").length };
      });
      measurements.push({ version, count, ...result });
    }
    if (version === "new") {
      const directions = await page.evaluate(async () => {
        const { BattleAnimationController } = await import("http://gunnery.test/scripts/controllers/battle-animation-controller.js");
        const { cellToPixel, headingToVector } = await import("http://gunnery.test/scripts/board/board-geometry.js");
        const battle = gunneryTest.read(), unit = battle.ships[0], controller = new BattleAnimationController(previewApp);
        const checks = [];
        for (const heading of [0,60,120,180,240,300]) {
          const v = headingToVector(heading, 6, 6), end = { x: 6+v.dx, y: 6+v.dy, heading };
          controller.animateMovement(battle, { id: "heading-"+heading, shipId: unit.id, start: {x:6,y:6,heading}, end });
          await new Promise(resolve => setTimeout(resolve, 300));
          const node = controller.getToken(unit.id), matrix = node.transform.baseVal.consolidate().matrix;
          const ui = node.querySelector(".ssc-token-ui").transform.baseVal.consolidate().matrix;
          const center = cellToPixel(battle.board, end.x, end.y), angle = (heading-90)*Math.PI/180;
          checks.push(Math.abs(matrix.e-center.cx)<.01 && Math.abs(matrix.f-center.cy)<.01 &&
            Math.abs(matrix.a-Math.cos(angle))<.01 && Math.abs(matrix.b-Math.sin(angle))<.01 &&
            Math.abs(matrix.multiply(ui).b)<.01);
        }
        controller.destroy(); return checks;
      });
      assert.ok(directions.every(Boolean), "Moving nose and upright labels follow all six headings");
      await page.screenshot({ path: "artifacts/interface/fleet-board.png" });
    }
    assert.deepEqual(errors, []); await page.close();
  }
  console.log("ARTWORK_BENCHMARK " + JSON.stringify(measurements));
  const { writeFile } = await import("node:fs/promises");
  await writeFile("artifacts/interface/artwork-performance.json", JSON.stringify({ baseline, measurements,
    note: "Same Chromium runner and application code; compares old/new board templates and CSS. Headless synthetic timing, not a hardware FPS guarantee." }, null, 2));
  const page = await browser.newPage({ viewport: { width: 1120, height: 1500 } });
  const art = partials["modules/sailships-combat/templates/naval/parts/naval-unit-art.hbs"];
  const families = ["cutter","schooner","brig","frigate","line","bomb","bird","ray","jelly","swarm","beast"];
  const names = ["Каттер","Шхуна","Бриг","Фрегат","Линейный","Бомбардир","Птица","Скат","Медуза","Рой","Зверь"];
  let gallery = '<svg class="ssc-board-svg" data-lod="near" viewBox="0 0 1100 1450"><defs>' + art + '</defs>';
  for (let i=0;i<families.length;i++) {
    gallery += '<text x="15" y="'+(100+i*120)+'" fill="#e1d4b1" font-size="16">'+names[i]+'</text>';
    for (let j=0;j<6;j++) {
      const x=220+j*155,y=95+i*120,heading=j*60;
      gallery += '<g transform="translate('+x+' '+y+')"><circle r="43" fill="none" stroke="#334655"/><g class="ssc-unit-art" style="--ssc-side-color:#6ebfce;--ssc-creature-tint:#92b8ad" transform="rotate('+(heading-90)+') scale(1.3)"><use href="#ssc-art-'+families[i]+'"/><path class="ssc-unit-heading" d="M30 -3 L35 0 L30 3" fill="none"/></g><text y="59" fill="#9eb2c1" font-size="12" text-anchor="middle">'+heading+'°</text></g>';
    }
  }
  await page.setContent('<style>body{margin:0;background:#13232e}.ssc-board-svg{width:1100px;height:1450px}</style><style>'+newCss+'</style><body class="sailships-combat">'+gallery+'</svg></body>');
  assert.equal(await page.locator("use").count(), 66);
  assert.equal(await page.locator("#ssc-art-cutter .ssc-unit-hull").evaluate(n => getComputedStyle(n).fill), "rgb(72, 55, 44)");
  assert.ok(await page.locator("use").evaluateAll(nodes => nodes.every(n => n.getBBox().width > 20 && n.getBBox().height > 10)));
  await page.screenshot({ path: "artifacts/interface/fleet-directions.png" });
  console.log("VISUAL_IMAGE:"+(await page.screenshot({type:"jpeg",quality:65})).toString("base64"));
  await page.close();
} finally { await browser.close(); }
