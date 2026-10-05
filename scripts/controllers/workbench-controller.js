/** Local workspace state. Never writes battle data. */
export class WorkbenchController {
  constructor(app, onView = null) {
    this.app = app;
    this.onView = onView;
    this.views = new Map();
    this.drafts = new Map();
    this.searches = new Map();
    this.details = new Map();
    this.baselines = new WeakMap();
  }
  bind() {
    this.abort?.abort();
    this.root = this.app.element;
    if (!this.root) return;
    this.abort = new AbortController();
    const signal = this.abort.signal;
    for (const scope of this.root.querySelectorAll("[data-draft-scope]")) {
      const draft = this.drafts.get(scope.dataset.draftScope) ?? new Map();
      const present = new Set();
      for (const input of this.fields(scope)) {
        const key = this.key(input);
        present.add(key);
        this.baselines.set(input, this.value(input));
        if (input.matches(":disabled") || draft.get(key) === this.value(input)) draft.delete(key);
        else if (draft.has(key)) this.setValue(input, draft.get(key));
      }
      for (const key of draft.keys()) if (!present.has(key)) draft.delete(key);
      this.drafts.set(scope.dataset.draftScope, draft);
      this.status(scope);
    }
    for (const host of this.root.querySelectorAll("[data-workspace]")) {
      this.show(host, host.dataset.workspace === "yard" ? this.app.activeTab : this.views.get(this.viewKey(host)) ?? host.dataset.initialView);
    }
    for (const host of this.root.querySelectorAll("[data-filter]")) {
      const input = host.querySelector("[data-filter-input]");
      if (input) input.value = this.searches.get(host.dataset.filter) ?? "";
      this.filter(host);
    }
    for (const detail of this.root.querySelectorAll("details[data-disclosure]")) {
      const key = (detail.closest("[data-draft-scope]")?.dataset.draftScope ?? "") + ":" + detail.dataset.disclosure;
      if (this.details.has(key)) detail.open = this.details.get(key);
      detail.addEventListener("toggle", () => {
        if (this.root.contains(detail)) this.details.set(key, detail.open);
      }, { signal });
    }
    this.root.addEventListener("click", event => {
      const button = event.target.closest("[data-view]");
      if (button) { event.preventDefault(); this.show(button.closest("[data-workspace]"), button.dataset.view); }
      const discard = event.target.closest("[data-discard-draft]");
      if (discard) { event.preventDefault(); this.discard(discard.closest("[data-draft-scope]")); }
      const clear = event.target.closest("[data-filter-clear]");
      if (clear) {
        const host = clear.closest("[data-filter]");
        const input = host.querySelector("[data-filter-input]");
        input.value = ""; this.filter(host); input.focus();
      }
    }, { signal });
    const changed = event => {
      const input = event.target;
      const scope = input.closest("[data-draft-scope]");
      if (scope && this.baselines.has(input)) {
        const draft = this.drafts.get(scope.dataset.draftScope) ?? new Map();
        if (this.value(input) === this.baselines.get(input)) draft.delete(this.key(input));
        else draft.set(this.key(input), this.value(input));
        this.drafts.set(scope.dataset.draftScope, draft);
        this.status(scope);
      }
      if (input.matches("[data-filter-input]")) this.filter(input.closest("[data-filter]"));
      this.live();
    };
    this.root.addEventListener("input", changed, { signal });
    this.root.addEventListener("change", changed, { signal });
    this.live();
  }
  fields(scope) { return [...scope.querySelectorAll("input,select,textarea")].filter(input => !input.matches("[data-preset-select]") && (input.name || Object.keys(input.dataset).length)); }
  key(input) { return input.name || JSON.stringify(Object.entries(input.dataset).sort(([a], [b]) => a.localeCompare(b))); }
  value(input) { return input.type === "checkbox" ? input.checked : input.value; }
  setValue(input, value) { if (input.type === "checkbox") input.checked = value; else input.value = value; }
  viewKey(host) { return host.dataset.workspace + ":" + (host.closest("[data-draft-scope]")?.dataset.draftScope ?? ""); }
  own(host, selector) { return [...host.querySelectorAll(selector)].filter(node => node.closest("[data-workspace]") === host); }
  show(host, id) {
    if (!host) return;
    const panels = this.own(host, "[data-view-panel]");
    if (!panels.some(panel => panel.dataset.viewPanel === id)) id = panels[0]?.dataset.viewPanel;
    if (!id) return;
    this.views.set(this.viewKey(host), id);
    for (const panel of panels) panel.hidden = panel.dataset.viewPanel !== id;
    for (const button of this.own(host, "[data-view]")) {
      button.classList.toggle("active", button.dataset.view === id);
      button.setAttribute("aria-pressed", String(button.dataset.view === id));
    }
    this.onView?.(host.dataset.workspace, id);
  }
  filter(host) {
    const query = host.querySelector("[data-filter-input]")?.value ?? "";
    this.searches.set(host.dataset.filter, query);
    const terms = query.toLocaleLowerCase("ru").trim().split(/\s+/).filter(Boolean);
    const items = [...host.querySelectorAll("[data-filter-item]")];
    let visible = 0;
    for (const item of items) {
      const text = (item.dataset.filterItem || item.textContent).toLocaleLowerCase("ru");
      item.hidden = !terms.every(term => text.includes(term));
      if (!item.hidden) visible++;
    }
    for (const group of host.querySelectorAll("[data-filter-group]")) group.hidden = ![...group.querySelectorAll("[data-filter-item]")].some(item => !item.hidden);
    const count = host.querySelector("[data-filter-count]");
    if (count) count.textContent = visible + " из " + items.length;
    const empty = host.querySelector("[data-filter-empty]");
    if (empty) empty.hidden = visible > 0 || !terms.length;
  }
  status(scope) {
    const dirty = Boolean(this.drafts.get(scope.dataset.draftScope)?.size);
    for (const status of scope.querySelectorAll("[data-draft-status]")) {
      status.textContent = dirty ? "Есть несохранённые изменения" : "Нет несохранённых изменений";
      status.classList.toggle("pending", dirty);
    }
    for (const button of scope.querySelectorAll("[data-discard-draft]")) button.disabled = !dirty;
  }
  accept(selector = null) {
    for (const scope of this.root?.querySelectorAll("[data-draft-scope]") ?? []) {
      const draft = this.drafts.get(scope.dataset.draftScope);
      for (const input of this.fields(scope)) {
        if (selector && !input.matches(selector)) continue;
        draft?.delete(this.key(input));
        this.baselines.set(input, this.value(input));
      }
      if (!selector) this.drafts.delete(scope.dataset.draftScope);
      this.status(scope);
    }
  }
  /** Capture the submitted scope and values before an asynchronous write. */
  capture(scope) {
    return { id: scope.dataset.draftScope, values: new Map(this.fields(scope).map(input => [this.key(input), this.value(input)])) };
  }
  /** Acknowledge persisted values while preserving edits made during the write. */
  acceptSaved(submission, saved) {
    const draft = this.drafts.get(submission.id) ?? new Map();
    for (const [key, value] of submission.values) {
      if (draft.get(key) === value || draft.get(key) === saved.get(key)) draft.delete(key);
    }
    for (const scope of this.root?.querySelectorAll("[data-draft-scope]") ?? []) {
      if (scope.dataset.draftScope !== submission.id) continue;
      for (const input of this.fields(scope)) {
        const key = this.key(input);
        if (!saved.has(key)) continue;
        const value = this.value(input);
        this.baselines.set(input, saved.get(key));
        if (value === submission.values.get(key) || value === saved.get(key)) {
          this.setValue(input, saved.get(key));
          draft.delete(key);
        } else {
          draft.set(key, value);
        }
      }
      this.drafts.set(submission.id, draft);
      this.status(scope);
    }
    this.drafts.set(submission.id, draft);
    this.live();
  }
  discard(scope) {
    if (!scope) return;
    for (const input of this.fields(scope)) if (this.baselines.has(input)) this.setValue(input, this.baselines.get(input));
    this.drafts.delete(scope.dataset.draftScope);
    this.status(scope);
    this.live();
  }
  live() {
    for (const input of this.root.querySelectorAll('input[type="range"]')) {
      const output = input.closest("label")?.querySelector("output");
      if (output) output.textContent = Math.round(Number(input.value) * 100) + "%";
    }
    const victory = this.root.querySelector('[data-setup-field="victory.mode"]')?.value;
    for (const field of this.root.querySelectorAll("[data-victory-mode]")) field.hidden = field.dataset.victoryMode !== victory;
    const preview = this.root.querySelector("[data-background-preview]");
    if (preview) {
      const path = this.root.querySelector('[name="background.src"]')?.value.trim() ?? "";
      const enabled = this.root.querySelector('[name="background.enabled"]')?.checked;
      preview.style.backgroundImage = path && enabled ? "url(" + JSON.stringify(path) + ")" : "none";
      preview.style.backgroundSize = Math.max(64, Math.min(2048, Number(this.root.querySelector('[name="background.tileSize"]')?.value) || 512)) + "px";
      preview.style.opacity = enabled ? this.root.querySelector('[name="background.opacity"]')?.value ?? "0.35" : "0";
      const message = this.root.querySelector("[data-background-empty]");
      if (message) { message.hidden = Boolean(path && enabled); message.textContent = path ? "Показ фона выключен" : "Выберите изображение для фона"; }
    }
  }
  destroy() { this.abort?.abort(); }
}
