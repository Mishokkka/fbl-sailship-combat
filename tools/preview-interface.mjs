// Renders production templates and context in Chromium with a minimal Foundry shell.
// This is a layout smoke test, not a running Foundry multiplayer integration test.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import Handlebars from "handlebars";
import { chromium } from "playwright";
import { installTestEnvironment } from "../tests/test-env.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { registerHandlebarsHelpers } from "../scripts/utils/helpers.js";

installTestEnvironment();
globalThis.Handlebars = Handlebars;
foundry.utils.mergeObject = (base, value) => ({ ...base, ...value });
foundry.applications = { api: {
  ApplicationV2: class { constructor() { this.options = this.constructor.DEFAULT_OPTIONS; } },
  HandlebarsApplicationMixin: Base => Base
} };
const language = JSON.parse(await readFile("lang/ru.json", "utf8"));
game.i18n = { localize: key => key.split(".").reduce((value, part) => value?.[part], language) ?? key };
Handlebars.registerHelper("localize", key => game.i18n.localize(key));
registerHandlebarsHelpers();
async function templates(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) await templates(path);
    else if (path.endsWith(".hbs")) {
      const source = await readFile(path, "utf8");
      Handlebars.precompile(source);
      Handlebars.registerPartial("modules/sailships-combat/" + path, source);
    }
  }
}
await templates("templates");
const { NavalBattleApp } = await import("../scripts/apps/naval-battle-app.js");
const manifest = JSON.parse(await readFile("module.json", "utf8"));
const css = (await Promise.all(manifest.styles.map(path => readFile(path, "utf8")))).join("\n");
const layoutControllerSource = await readFile("scripts/controllers/battle-layout-controller.js", "utf8");
const shellCSS = "html,body{margin:0;height:100%;background:#080e14}body{padding:12px}button,input,select{font:inherit}h1,h2,h3,p{margin-top:0}.application{height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #34495c;border-radius:12px}.window-header{height:42px;min-height:42px;padding:8px 16px;display:flex;align-items:center}.window-title{font-size:13px;margin:0}.window-content{flex:1;min-height:0}.hidden{display:none!important}";
await mkdir("artifacts/interface", { recursive: true });
const browser = await chromium.launch();
let scenarios = 0;
try {
  for (const phase of ["orders", "movement", "gunnery", "crew", "damage", "end"]) {
    const battle = BattleNormalizer.normalize(createDefaultBattle());
    battle.setupConfirmed = true;
    battle.phase = phase;
    battle.round = 3;
    battle.board.terrain = {};
    battle.ships[0].x = 12; battle.ships[0].y = 10; battle.ships[0].heading = 0;
    battle.ships[1].x = 12; battle.ships[1].y = 6; battle.ships[1].heading = 0;
    game.sailshipsCombat = { storage: { getBattleForUser: () => battle, getSavedBattleMetadata: () => [] } };
    const app = new NavalBattleApp();
    app.selectedShipId = battle.ships[0].id;
    app.selectedTargetId = battle.ships[1].id;
    app.contextBuilder.invalidate();
    const context = app.contextBuilder.build({}, battle);
    const parts = await Promise.all(Object.values(NavalBattleApp.PARTS).map(async part =>
      Handlebars.compile(await readFile(part.template.replace("modules/sailships-combat/", ""), "utf8"))(context)));
    const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Sailships Combat · ' + phase +
      '</title><style>' + shellCSS + "\n" + css + '</style><body><section class="application sailships-combat sailships-battle-app"><header class="window-header"><h1 class="window-title">Sailships Combat · Небесная погоня</h1></header><div class="window-content ssc-shell ssc-main-grid">' +
      parts.join("\n") + '</div></section><script type="module">' + layoutControllerSource +
      '\nconst layout = new BattleLayoutController({element: document.querySelector(".application")}); layout.bind(); window.previewLayout = layout; document.addEventListener("click", event => { const button = event.target.closest("[data-pane]"); if (button) layout.showPane(button.dataset.pane); });</script></body></html>';
    await writeFile("artifacts/interface/" + phase + ".html", html);
    for (const width of [1500, 1100, 800]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFunction(() => Boolean(window.previewLayout));
      if (width === 800) await page.locator('[data-pane="controls"]').click();
      const layout = await page.locator(".ssc-main-grid").getAttribute("data-layout");
      assert.equal(layout, width === 800 ? "narrow" : width === 1100 ? "compact" : "wide");
      const overflow = await page.locator(".ssc-main-grid, .ssc-right-panel, .ssc-left-panel").evaluateAll(elements =>
        elements.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2)
          .map(el => ({ className: el.className, scroll: el.scrollWidth, client: el.clientWidth })));
      assert.deepEqual(overflow, [], phase + " at " + width + "px has horizontal overflow");
      await page.locator(".ssc-guidance h2").waitFor({ state: "visible" });
      if (width === 800 && ["orders", "movement", "gunnery", "crew"].includes(phase)) {
        assert.equal(await page.locator(".ssc-narrow-pass").isVisible(), true);
      }
      if (phase === "gunnery") {
        assert.ok(context.shotPreviews.length, "Fixture must render a real shot preview");
        assert.equal(await page.locator(".ssc-shot-fire-button").count(), context.shotPreviews.length);
        const ammo = page.locator('.ssc-shot-preview-card [data-action="setAmmo"]').first();
        assert.ok(await ammo.getAttribute("data-weapon-id"), "Ammo choice must carry the correct battery ID");
        assert.equal(await ammo.isEnabled(), true);
        const detail = page.locator('details[data-ui-section^="shot-"]').first();
        await detail.locator("summary").focus();
        await page.keyboard.press("Enter");
        assert.equal(await detail.getAttribute("open"), "");
        await page.waitForFunction(() => window.previewLayout.disclosures.size > 0);
        // Simulate ApplicationV2 replacing a part, then binding after render.
        await page.evaluate(() => {
          const panel = document.querySelector(".ssc-right-panel");
          panel.outerHTML = panel.outerHTML.replaceAll(' open=""', "");
          window.previewLayout.bind();
        });
        assert.equal(await page.locator('details[data-ui-section^="shot-"]').first().getAttribute("open"), "");
        await page.locator('details[data-ui-section^="shot-"] summary').first().click();
      }
      assert.deepEqual(errors, [], "Browser runtime errors");
      const summarySize = await page.locator(".ssc-bottom-info").evaluate(el => ({
        visible: Boolean(el.getClientRects().length), content: el.scrollHeight, available: el.clientHeight
      }));
      assert.ok(!summarySize.visible || summarySize.content <= summarySize.available + 2,
        phase + " at " + width + "px clips the ship summary: " + JSON.stringify(summarySize));
      await page.locator(".ssc-right-panel").evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: "artifacts/interface/" + phase + "-" + width + ".png", fullPage: true });
      if (process.env.SSC_INLINE_PREVIEW === "1" && ((phase === "gunnery" && width === 1500) || (phase === "orders" && width === 1100))) {
        console.log("SSC_PREVIEW_" + phase + ":" + (await page.screenshot({ type: "jpeg", quality: 65 })).toString("base64"));
      }
      scenarios += 1;
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log("Interface smoke checks passed: " + scenarios + " layouts; all templates compiled.");
