// Real SVG artwork and animation controller in Chromium; Foundry persistence is stubbed.
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
  const page=await browser.newPage({viewport:{width:1500,height:900}});
  const errors=[]; page.on("pageerror",e=>errors.push(e.message));
  await install(page);
  await page.evaluate(async () => {
    const { VisualSettingsService } = await import("http://gunnery.test/scripts/services/visual-settings-service.js");
    VisualSettingsService.registerSettings();
  });
  const reset = async () => page.evaluate(async () => { previewApp.animation.destroy(); await gunneryTest.reset(); });
  const fire = async () => {
    await page.locator('.ssc-target-picker [data-target-id="ship-red"]').click();
    await page.waitForFunction(()=>previewApp.selectedTargetId==="ship-red");
    await page.evaluate(()=>previewApp._renderDrainPromise);
    await page.locator('[data-action="fireBow"]').click();
    await page.evaluate(()=>gunneryTest.lastAction);
  };
  await fire();
  assert.equal(await page.locator(".ssc-attack-effect[data-outcome=hit]").count(),1);
  assert.ok(await page.locator(".ssc-attack-effect *").count()<=10);
  const saved=await page.evaluate(()=>gunneryTest.read());
  assert.equal(saved.lastReport.visual.arc,"bow");
  await page.waitForTimeout(150);
  await page.screenshot({path:"artifacts/interface/cannon-flight.png"});
  await page.waitForTimeout(850);
  assert.equal(await page.locator(".ssc-attack-effect").count(),0);
  await page.evaluate(()=>previewApp.render({parts:["board"]}));
  assert.equal(await page.locator(".ssc-attack-effect").count(),0,"Rerender must not replay a shot");
  assert.deepEqual(await page.evaluate(()=>gunneryTest.read()),saved,"Animation must never mutate battle state");
  await reset(); await page.evaluate(()=>gunneryTest.change("miss")); await fire();
  assert.equal(await page.locator(".ssc-shot-impact").count(),0);
  assert.equal(await page.locator(".ssc-shot-miss").count(),1);
  await page.waitForTimeout(900);
  await reset(); await page.evaluate(()=>{gunneryTest.mode="deny";}); await fire();
  assert.equal(await page.locator(".ssc-attack-effect").count(),0,"Denied commit must not animate");
  await page.evaluate(()=>{gunneryTest.mode="allow";});
  for(const mode of ["economy","off"]) {
    await page.evaluate(mode=>game.settings.set("sailships-combat","visualQuality",mode),mode);
    await reset(); await page.evaluate(()=>gunneryTest.change("hit")); await fire();
    assert.equal(await page.locator(".ssc-shot-tracer").count(),0);
    assert.equal(await page.locator(".ssc-attack-effect").count(),mode==="economy"?1:0);
    assert.equal(await page.locator(".ssc-wind-particles line").count(),0);
    await page.waitForTimeout(400);
  }
  await page.evaluate(()=>game.settings.set("sailships-combat","visualQuality","standard"));
  await page.emulateMedia({reducedMotion:"reduce"});
  await reset(); await fire(); assert.equal(await page.locator(".ssc-attack-effect").count(),0);
  await page.emulateMedia({reducedMotion:"no-preference"});
  await reset();
  const lifecycle=await page.evaluate(async()=>{
    const { captureAttackVisual }=await import("http://gunnery.test/scripts/visuals/attack-visuals.js");
    const { cellToPixel }=await import("http://gunnery.test/scripts/board/board-geometry.js");
    const battle=gunneryTest.read(),[a,b]=battle.ships,animation=previewApp.animation;
    const report={id:"synthetic",outcome:"hit",sourceId:a.id,targetId:b.id,visual:captureAttackVisual(a,b)};
    animation.effects.consume({...battle,lastReport:report},true);
    const one=document.querySelectorAll(".ssc-attack-effect").length;
    for(let i=0;i<30;i++) animation.effects.consume({...battle,lastReport:{...report,id:"burst-"+i}},true);
    const bounded=document.querySelectorAll(".ssc-attack-effect").length;
    animation.animateMovement(battle,{id:"cancel-move",shipId:a.id,start:{x:a.x-1,y:a.y,heading:60},end:a});
    Object.defineProperty(document,"hidden",{configurable:true,value:true});
    document.dispatchEvent(new Event("visibilitychange"));
    const matrix=animation.getToken(a.id).transform.baseVal.consolidate().matrix, center=cellToPixel(battle.board,a.x,a.y);
    const finished=Math.abs(matrix.e-center.cx)<.01 && Math.abs(matrix.f-center.cy)<.01;
    const empty=!animation.effects.group && animation.effects.frame===null && animation.animationFrame===null;
    animation.effects.consume({...battle,lastReport:{...report,id:"hidden"}},false);
    delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
    animation.effects.consume({...battle,lastReport:{...report,id:"hidden"}},true);
    const noReplay=document.querySelectorAll(".ssc-attack-effect").length===0;
    animation.effects.consume({...battle,lastReport:{...report,id:"stale",visual:{...report.visual,timestamp:Date.now()-20000}}},true);
    const noStale=document.querySelectorAll(".ssc-attack-effect").length===0;
    animation.destroy();
    return {one,bounded,finished,empty,noReplay,noStale,clean:animation.cleanupListeners===null};
  });
  assert.deepEqual(lifecycle,{one:1,bounded:1,finished:true,empty:true,noReplay:true,noStale:true,clean:true});

  const metrics=[];
  for (const count of [4,12,30]) {
    await page.evaluate(count=>gunneryTest.units(count),count);
    for (const activity of ["idle","attacks"]) {
      metrics.push(await page.evaluate(async ({count,activity})=>{
        const {captureAttackVisual}=await import("http://gunnery.test/scripts/visuals/attack-visuals.js");
        const battle=gunneryTest.read(),[a,b]=battle.ships,fx=previewApp.animation.effects;
        fx.initialized=true;
        const start=performance.now(),frames=[]; let previous=start,shot=-1,peak=0;
        await new Promise(resolve=>{
          const tick=now=>{
            frames.push(now-previous); previous=now;
            const next=Math.floor((now-start)/200);
            if (activity==="attacks" && next!==shot) {
              shot=next;
              fx.consume({...battle,lastReport:{id:"perf-"+count+"-"+next,outcome:"hit",sourceId:a.id,targetId:b.id,
                visual:captureAttackVisual(a,b,{arc:"starboard"})}},true);
            }
            peak=Math.max(peak,document.querySelectorAll(".ssc-attack-effect *").length);
            if(now-start<1600)requestAnimationFrame(tick);else resolve();
          }; requestAnimationFrame(tick);
        });
        fx.cancel(); frames.sort((a,b)=>a-b);
        return {count,activity,frameP95Ms:frames[Math.floor(frames.length*.95)],peakNodes:peak};
      },{count,activity}));
    }
  }
  console.log("EFFECTS_BENCHMARK "+JSON.stringify(metrics));
  const {writeFile}=await import("node:fs/promises");
  await writeFile("artifacts/interface/effects-performance.json",JSON.stringify(metrics,null,2));
  await page.setViewportSize({width:800,height:650}); await reset();
  await page.evaluate(()=>previewApp.layout.showPane("controls"));
  assert.equal(await page.evaluate(()=>previewApp.animation.visible),false);
  await page.evaluate(()=>previewApp.layout.showPane("board"));
  assert.equal(await page.evaluate(()=>previewApp.animation.visible),true);
  assert.deepEqual(errors,[]);
  console.log("Effects: committed hit/miss, denial, rerender, quality, reduced motion, hidden/pane cleanup, bounded burst passed.");
  await page.close();
} finally { await browser.close(); }
