const LAYOUT_PANES = Object.freeze(["board", "fleet", "controls"]);

export class BattleLayoutController {
  constructor(app) {
    this.app = app;
    this.pane = "board";
    this.observer = null;
    this.disclosures = new Map();
    this.boundDisclosures = new WeakSet();
  }

  bind() {
    this.observer?.disconnect();
    const main = this.app.element?.querySelector?.(".ssc-main-grid");
    if (!main) return;
    for (const detail of main.querySelectorAll("details[data-ui-section]")) {
      const key = detail.dataset.uiSection;
      if (this.disclosures.has(key)) detail.open = this.disclosures.get(key);
      if (this.boundDisclosures.has(detail)) continue;
      this.boundDisclosures.add(detail);
      detail.addEventListener("toggle", () => {
        // Ignore events from a part that Foundry has already replaced.
        if (main.contains(detail)) this.disclosures.set(key, detail.open);
      });
    }
    const applyLayout = width => {
      const value = Number(width ?? main.clientWidth ?? 0);
      main.dataset.layout = value < 920 ? "narrow" : value < 1380 ? "compact" : "wide";
      this.applyPane(main);
    };
    applyLayout(main.clientWidth);
    if (typeof ResizeObserver !== "undefined") {
      this.observer = new ResizeObserver(entries => applyLayout(entries[0]?.contentRect?.width));
      this.observer.observe(main);
    }
  }

  showPane(pane) {
    const next = String(pane ?? "board");
    if (!LAYOUT_PANES.includes(next)) return;
    this.pane = next;
    this.applyPane();
  }

  applyPane(main = this.app.element?.querySelector?.(".ssc-main-grid")) {
    if (!main) return;
    const pane = LAYOUT_PANES.includes(this.pane) ? this.pane : "board";
    main.dataset.narrowPane = pane;
    for (const button of main.querySelectorAll(".ssc-narrow-nav [data-pane]")) {
      button.setAttribute("aria-pressed", String(button.dataset.pane === pane));
    }
  }

  destroy() {
    this.observer?.disconnect();
    this.observer = null;
  }
}
