function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function dialogClass() {
  return globalThis.foundry?.applications?.api?.DialogV2 ?? null;
}

export class DialogService {
  static async confirm({ title = "Подтверждение", content, yesLabel = "Продолжить", noLabel = "Отмена", danger = false } = {}) {
    const DialogV2 = dialogClass();
    if (!DialogV2) {
      ui.notifications.error("Foundry DialogV2 недоступен.");
      return false;
    }
    return Boolean(await DialogV2.confirm({
      window: { title },
      content: `<div class="ssc-dialog-form"><p>${escapeHtml(content)}</p></div>`,
      yes: { label: yesLabel, icon: danger ? "fa-solid fa-triangle-exclamation" : "fa-solid fa-check" },
      no: { label: noLabel, icon: "fa-solid fa-xmark" },
      rejectClose: false,
      modal: true
    }));
  }

  static async text({ title, label, value = "", okLabel = "Применить", required = false } = {}) {
    return this.promptField({ title, label, value, okLabel, required, multiline: false });
  }

  static async multiline({ title, label, value = "", okLabel = "Применить", required = false, readonly = false } = {}) {
    return this.promptField({ title, label, value, okLabel, required, multiline: true, readonly });
  }

  static async promptField({ title = "Ввод", label = "Значение", value = "", okLabel = "Применить", required = false, multiline = false, readonly = false } = {}) {
    const DialogV2 = dialogClass();
    if (!DialogV2) {
      ui.notifications.error("Foundry DialogV2 недоступен.");
      return null;
    }
    const field = multiline
      ? `<textarea name="value" rows="14" ${required ? "required" : ""} ${readonly ? "readonly" : ""} autofocus>${escapeHtml(value)}</textarea>`
      : `<input name="value" type="text" value="${escapeHtml(value)}" ${required ? "required" : ""} autofocus>`;
    const result = await DialogV2.prompt({
      window: { title },
      content: `<div class="ssc-dialog-form"><label>${escapeHtml(label)}${field}</label></div>`,
      ok: {
        label: okLabel,
        icon: "fa-solid fa-check",
        callback: (_event, button) => String(button.form?.elements?.value?.value ?? "")
      },
      rejectClose: false,
      modal: true
    });
    return result == null ? null : String(result);
  }

  static async select({ title = "Выбор", label = "Вариант", choices = [], value = null, okLabel = "Выбрать" } = {}) {
    const DialogV2 = dialogClass();
    if (!DialogV2) {
      ui.notifications.error("Foundry DialogV2 недоступен.");
      return null;
    }
    const options = choices.map(choice => {
      const id = String(choice.value ?? "");
      const selected = id === String(value ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(id)}"${selected}>${escapeHtml(choice.label ?? id)}</option>`;
    }).join("");
    const result = await DialogV2.prompt({
      window: { title },
      content: `<div class="ssc-dialog-form"><label>${escapeHtml(label)}<select name="value" autofocus>${options}</select></label></div>`,
      ok: {
        label: okLabel,
        icon: "fa-solid fa-check",
        callback: (_event, button) => String(button.form?.elements?.value?.value ?? "")
      },
      rejectClose: false,
      modal: true
    });
    return result == null ? null : String(result);
  }

  static async copyOrShow({ title, label, text, copiedMessage = "Скопировано в буфер обмена." } = {}) {
    try {
      await navigator.clipboard.writeText(String(text ?? ""));
      ui.notifications.info(copiedMessage);
      return true;
    } catch (error) {
      await this.multiline({ title, label, value: text, okLabel: "Закрыть", readonly: true });
      return false;
    }
  }
}
