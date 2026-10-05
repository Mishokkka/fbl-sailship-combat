// Production contexts/templates with a minimal Foundry shell and real workspace controller.
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import Handlebars from "handlebars";
import { chromium } from "playwright";
import { installTestEnvironment } from "../tests/test-env.js";
import { createDefaultBattle } from "../scripts/data/default-battle.js";
import { createCreature } from "../scripts/data/creature-factory.js";
import { BattleNormalizer } from "../scripts/normalizers/battle-normalizer.js";
import { registerHandlebarsHelpers } from "../scripts/utils/helpers.js";

installTestEnvironment();
globalThis.Handlebars = Handlebars;
foundry.utils.mergeObject = (a, b) => ({ ...a, ...b });
foundry.applications = { api: {
  ApplicationV2: class {
    constructor() { this.options = this.constructor.DEFAULT_OPTIONS; }
    async _prepareContext() { return {}; }
  }, HandlebarsApplicationMixin: Base => Base
} };
const language = JSON.parse(await readFile("lang/ru.json", "utf8"));
game.i18n = { localize: key => key.split(".").reduce((v, k) => v?.[k], language) ?? key };
Handlebars.registerHelper("localize", key => game.i18n.localize(key));
registerHandlebarsHelpers();
async function register(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = directory + "/" + entry.name;
    if (entry.isDirectory()) await register(path);
    else if (path.endsWith(".hbs")) {
      const source = await readFile(path, "utf8");
      Handlebars.precompile(source);
      Handlebars.registerPartial("modules/sailships-combat/" + path, source);
    }
  }
}
await register("templates");
const { ShipyardApp } = await import("../scripts/apps/shipyard-app.js");
const { BattleSetupApp } = await import("../scripts/apps/battle-setup-app.js");
const { BoardSettingsApp } = await import("../scripts/apps/board-settings-app.js");
const { SoundSettingsApp } = await import("../scripts/apps/sound-settings-app.js");
const manifest = JSON.parse(await readFile("module.json", "utf8"));
const styles = (await Promise.all(manifest.styles.map(path => readFile(path, "utf8")))).join("\n");
const controller = await readFile("scripts/controllers/workbench-controller.js", "utf8");
const shell = "html,body{margin:0;height:100%;background:#080e14}body{padding:12px}button,input,select{font:inherit}h1,h2,h3,p{margin-top:0}.application{height:calc(100vh - 24px);display:flex;flex-direction:column;overflow:hidden;border:1px solid #34495c;border-radius:12px}.window-header{height:36px;min-height:36px;padding:6px 16px;display:flex;align-items:center}.window-title{font-size:12px;margin:0}.window-content{flex:1;min-height:0}.hidden{display:none!important}";
const battle = BattleNormalizer.normalize(createDefaultBattle());
battle.setupConfirmed = false;
const creature = createCreature({ id: "preview-creature", name: "Страж Серебряной гряды", template: "skyRay", side: "red" });
battle.ships.push(creature);
game.sailshipsCombat = { storage: { getBattle: () => structuredClone(battle) } };
await mkdir("artifacts/interface/workspaces", { recursive: true });
const browser = await chromium.launch();
let checks = 0;
try {
  for (const kind of ["shipyard", "creature", "setup", "sound", "background"]) {
    const app = kind === "shipyard" ? new ShipyardApp({ selectedShipId: battle.ships[0].id })
      : kind === "creature" ? new ShipyardApp({ selectedShipId: creature.id, activeTab: "editor" })
      : kind === "setup" ? new BattleSetupApp() : kind === "sound" ? new SoundSettingsApp() : new BoardSettingsApp();
    const context = await app._prepareContext({});
    const template = app.constructor.PARTS.main.template.replace("modules/sailships-combat/", "");
    const body = Handlebars.compile(await readFile(template, "utf8"))(context);
    const activeTab = app.activeTab ?? "battle";
    const html = '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Sailships · ' + kind + '</title><style>' + shell + "\n" + styles + '</style><body><section class="application ' + app.constructor.DEFAULT_OPTIONS.classes.join(" ") + '"><header class="window-header"><h1 class="window-title">Sailships Combat</h1></header><div class="window-content">' + body + '</div></section><script type="module">' + controller + '\nconst app = { element: document.querySelector(".application"), activeTab: ' + JSON.stringify(activeTab) + ' }; const workbench = new WorkbenchController(app, (group, id) => { if (group === "yard") app.activeTab = id; }); workbench.bind(); window.workbench = workbench; window.previewApp = app;</script></body></html>';
    await writeFile("artifacts/interface/workspaces/" + kind + ".html", html);
    const widths = ["sound", "background"].includes(kind) ? [720, 560] : [1280, 900, 640];
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setContent(html, { waitUntil: "load" });
      await page.waitForFunction(() => Boolean(window.workbench));
      async function fit(label) {
        const overflow = await page.locator(".window-content, .ssc-shipyard-tab-panel, .ssc-setup-pages, .ssc-editor-fieldset, .ssc-settings-body").evaluateAll(elements =>
          elements.filter(el => el.getClientRects().length && el.scrollWidth > el.clientWidth + 2)
            .map(el => ({ element: el.className, actual: el.scrollWidth, available: el.clientWidth })));
        assert.deepEqual(overflow, [], kind + " " + label + " " + width);
        for (const footer of await page.locator(".ssc-save-bar:visible").all()) {
          const box = await footer.boundingBox();
          assert.ok(box.y >= 0 && box.y + box.height <= 890, "Apply controls must stay inside the window");
        }
        assert.deepEqual(errors, []);
        checks++;
      }
      if (kind === "shipyard" || kind === "creature") {
        const editorType = kind === "shipyard" ? "ship-editor" : "creature-editor";
        for (const tab of ["battle", "templates", "bestiary", "library", "creatureLibrary", "editor"]) {
          await page.locator('.ssc-workbench-nav [data-view="' + tab + '"]').click();
          await fit(tab);
          if (tab === "templates") {
            const search = page.locator('[data-filter="templates"] [data-filter-input]');
            const items = page.locator('[data-filter="templates"] [data-filter-item]:visible');
            assert.ok(await items.count() > 0);
            await search.fill("qzx-not-a-ship");
            assert.equal(await items.count(), 0);
            assert.equal(await page.locator('[data-filter="templates"] [data-filter-empty]').isVisible(), true);
            await page.locator('[data-filter="templates"] [data-filter-clear]').click();
            assert.ok(await items.count() > 0);
            if (width === 1280 && kind === "shipyard") await page.screenshot({ path: "artifacts/interface/workspaces/catalog.png" });
          }
        }
        const sections = kind === "shipyard" ? ["profile", "core", "weapons", "hull"] : ["profile", "flight", "anatomy", "attacks", "abilities", "behavior", "token"];
        for (const section of sections) {
          await page.locator('[data-workspace="' + editorType + '"] .ssc-section-nav [data-view="' + section + '"]').click();
          await fit(section);
        }
        await page.locator('[data-workspace="' + editorType + '"] [data-view="profile"]').click();
        const field = kind === "shipyard" ? '[data-ship-edit="name"]' : '[data-creature-edit="name"]';
        const input = page.locator(field);
        const before = await input.inputValue();
        await input.fill("Несохранённое имя");
        await page.locator('.ssc-workbench-nav [data-view="templates"]').click();
        await page.locator('.ssc-workbench-nav [data-view="editor"]').click();
        assert.equal(await input.inputValue(), "Несохранённое имя");
        await page.evaluate(() => {
          const root = document.querySelector(".window-content");
          root.innerHTML = root.innerHTML;
          window.workbench.bind();
        });
        assert.equal(await page.locator(field).inputValue(), "Несохранённое имя");
        await page.locator('[data-workspace="' + editorType + '"] [data-discard-draft]').click();
        assert.equal(await page.locator(field).inputValue(), before);
        // Locking a form clears stale drafts and leaves section navigation usable.
        if (width === 900) {
          await page.locator(field).fill("Правка до блокировки");
          await page.evaluate(() => {
            document.querySelector(".ssc-editor-fieldset").disabled = true;
            window.workbench.bind();
          });
          assert.equal(await page.locator(field).isDisabled(), true);
          const dirty = await page.evaluate(() => [...window.workbench.drafts.values()].some(d => d.size));
          assert.equal(dirty, false);
        }
      } else if (kind === "setup") {
        for (const tab of ["field", "teams", "victory", "overview", "scenarios"]) {
          await page.locator('.ssc-workbench-nav [data-view="' + tab + '"]').click();
          await fit(tab);
          if (tab === "overview" && width === 1280) await page.screenshot({ path: "artifacts/interface/workspaces/setup-overview.png" });
        }
        await page.locator('[data-view="victory"]').click();
        await page.locator('[data-setup-field="victory.mode"]').selectOption("escape");
        assert.equal(await page.locator('[data-victory-mode="escape"]').first().isVisible(), true);
        assert.equal(await page.locator('[data-victory-mode="decision"]').isVisible(), false);
        await page.locator("[data-discard-draft]").click();
        await page.locator('[data-view="field"]').click();
      } else {
        const range = page.locator('input[type="range"]').first();
        await range.fill("0.25");
        assert.equal(await range.locator("..").locator("output").textContent(), "25%");
        await page.locator("[data-discard-draft]").click();
        await fit(kind);
      }
      await page.screenshot({ path: "artifacts/interface/workspaces/" + kind + "-" + width + ".png" });
      if (process.env.SSC_REVIEW === "1" && width === 1280) console.log("SSC_REVIEW_" + kind + ":" + (await page.screenshot({ type: "jpeg", quality: 65 })).toString("base64"));
      await page.close();
    }
  }
} finally { await browser.close(); }
console.log("Workspace checks passed: " + checks + " views; search, drafts, keyboard-compatible controls, locked forms and live ranges.");
