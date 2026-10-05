const LAYOUT_PANES = Object.freeze(["board", "fleet", "controls"]);

export class BattleLayoutController {
  constructor(app) {
    this.app = app;
    this.pane = "board";
    this.observer = null;
  }

  bind() {
    this.observer?.disconnect();
    const main = this.app.element?.querySelector?.(".ssc-main-grid");
    if (!main) return;
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
