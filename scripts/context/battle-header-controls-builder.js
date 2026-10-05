export function getBattleWindowTitle(app) {
  const appTitle = game.i18n.localize("SAILSHIPS.AppTitle");
  const battleName = String(app.battle?.name ?? "").trim();
  return battleName ? `${appTitle} - ${battleName}` : appTitle;
}

export function buildBattleHeaderControls(app, baseControls = []) {
  return [
    ...baseControls,
    gmControl("rotateWindLeft", "fa-solid fa-rotate-left", "SAILSHIPS.RotateWindLeft"),
    gmControl("rotateWindRight", "fa-solid fa-rotate-right", "SAILSHIPS.RotateWindRight"),
    gmControl("cycleWindStrength", "fa-solid fa-wind", "SAILSHIPS.CycleWindStrength"),
    gmControl("cycleSea", "fa-solid fa-water", "SAILSHIPS.CycleSea"),
    gmControl("cycleVisibility", "fa-solid fa-eye", "SAILSHIPS.CycleVisibility"),
    publicControl("openSoundSettings", "fa-solid fa-volume-high", "Звуки боя"),
    gmControl("openBoardSettings", "fa-solid fa-image", "Настройки поля"),
    continueBattleControl(app),
    gmControl("openShipyard", "fa-solid fa-warehouse", "SAILSHIPS.OpenShipyard"),
    setupControl(app),
    gmControl("resetDemo", "fa-solid fa-arrow-rotate-left", "SAILSHIPS.ResetDemo", "ssc-header-danger")
  ];
}

export function decorateBattleHeaderControl(element, control) {
  if (control.class) element.classList.add(...String(control.class).split(/\s+/).filter(Boolean));
  const label = localizeLabel(control.label);
  const button = element.querySelector("button");
  button?.setAttribute("title", label);
  button?.setAttribute("aria-label", label);
  button?.setAttribute("data-tooltip", label);
  return element;
}

/**
 * ApplicationV2's dropdown-based header controls are fragile when several partial
 * renders complete out of order. Build a small persistent toolbar directly in the
 * window header instead. The toolbar uses the application's delegated data-action
 * handler, so no per-render listeners are retained.
 */
export function dockBattleHeaderControls(app) {
  const header = app.window?.header ?? app.element?.querySelector?.(".window-header");
  if (!header) return;

  const old = header.querySelector(".ssc-header-controls-inline");
  old?.remove();

  const toolbar = document.createElement("div");
  toolbar.className = "ssc-header-controls-inline";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Управление боем");

  for (const control of buildBattleHeaderControls(app)) {
    if (typeof control.visible === "function" && !control.visible()) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.action = control.action;
    button.className = `ssc-header-control ${control.class ?? ""}`.trim();
    const label = localizeLabel(control.label);
    button.title = label;
    button.setAttribute("aria-label", label);
    button.setAttribute("data-tooltip", label);
    const icon = document.createElement("i");
    icon.className = control.icon;
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    button.addEventListener("click", async event => {
      event.preventDefault();
      event.stopPropagation();
      if (button.dataset.busy === "true") return;
      const handler = app.options?.actions?.[control.action];
      if (typeof handler !== "function") return;
      button.dataset.busy = "true";
      button.disabled = true;
      try {
        await handler.call(app, event, button);
      } catch (error) {
        console.error(`sailships-combat | Header action failed: ${control.action}`, error);
        ui.notifications?.error?.("Не удалось выполнить действие в шапке окна.");
      } finally {
        if (button.isConnected) {
          delete button.dataset.busy;
          button.disabled = false;
        }
      }
    });
    toolbar.append(button);
  }

  const close = header.querySelector('button[data-action="close"]');
  const frameworkControls = app.window?.controls ?? header.querySelector('button[data-action="controls"]');
  header.insertBefore(toolbar, frameworkControls ?? close ?? null);

  if (frameworkControls) {
    frameworkControls.classList.add("hidden");
    frameworkControls.setAttribute("aria-hidden", "true");
  }
  const dropdown = app.window?.controlsDropdown ?? header.querySelector(".window-controls-dropdown");
  if (dropdown) {
    dropdown.classList.add("hidden");
    dropdown.setAttribute("aria-hidden", "true");
  }
}

function localizeLabel(label) {
  if (!label) return "";
  const value = game.i18n.localize(label);
  return value === label && !String(label).startsWith("SAILSHIPS.") ? String(label) : value;
}

function gmControl(action, icon, label, cssClass = "") {
  return {
    action,
    icon,
    label,
    class: cssClass,
    visible: () => game.user.isGM
  };
}

function publicControl(action, icon, label, cssClass = "") {
  return { action, icon, label, class: cssClass, visible: () => true };
}

function setupControl(app) {
  if (app.battle?.setupConfirmed) {
    return gmControl("returnToSetup", "fa-solid fa-compass-drafting", "SAILSHIPS.ReturnToSetup", "ssc-header-primary");
  }
  return gmControl("confirmSetup", "fa-solid fa-circle-check", "SAILSHIPS.ConfirmSetup", "ssc-header-primary");
}

function continueBattleControl(app) {
  return {
    action: "continueBattle",
    icon: "fa-solid fa-flag-checkered",
    label: "Продолжить бой на 5 раундов",
    class: "ssc-header-primary",
    visible: () => Boolean(game.user.isGM && app.battle?.outcome?.resolved)
  };
}
