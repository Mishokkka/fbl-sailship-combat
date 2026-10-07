import { PHASE_LABELS } from "../utils/constants.js";

/** Build guidance only from the battle projection and permitted action state. */
export class BattleGuidanceBuilder {
  static build({ battle, selectedShip, activeShip, actionState = {}, canViewDetails = false,
    isGM = false, canSubmitOrder = false, pendingOrder = false, hasShotPreview = false, hasSelectedTarget = false }) {
    const phase = battle.phase;
    const guide = (title, description, extra = {}) => ({
      eyebrow: battle.setupConfirmed ? `Раунд ${battle.round} · ${PHASE_LABELS[phase] ?? phase}` : "Подготовка боя",
      title, description, tone: "neutral", ...extra
    });
    if (battle.outcome?.resolved) return guide("Бой завершён", "Результат показан на поле. Ведущий может продолжить сражение.");
    if (!battle.setupConfirmed) return guide("Подготовьте поле и участников",
      isGM ? "Откройте подготовку, расставьте корабли и подтвердите начало боя." : "Ведущий готовит поле и участников.",
      isGM ? { action: "openBattleSetup", actionLabel: "Подготовка боя" } : {});
    if (isGM && !activeShip && ["orders", "movement", "gunnery", "crew"].includes(phase)) {
      return guide(phase === "crew" ? "Раунд готов к завершению" : "Все участники завершили фазу",
        phase === "crew" ? "Одна команда обновит перезарядку, движение по инерции и длительные эффекты. Изменения появятся в итогах раунда." : "Можно перейти к следующему этапу раунда.",
        { action: "nextPhase", actionLabel: phase === "crew" ? "Завершить раунд" : "Продолжить", tone: "ready" });
    }
    if (isGM && ["damage", "end"].includes(phase)) {
      return guide(phase === "damage" ? "Проверьте последствия залпов" : "Завершите раунд",
        phase === "damage" ? "Урон от залпов уже применён. Ручные поправки доступны ниже."
          : "При продолжении обновятся перезарядка, высота, пожары и другие длительные эффекты.",
        { action: "nextPhase", actionLabel: phase === "end" ? "Начать новый раунд" : "К действиям экипажа", tone: "ready" });
    }
    if (!selectedShip) return guide("Выберите корабль", "Нажмите на участника в списке флота или на поле.");
    if (!canViewDetails) return guide("Наблюдение за контактом", "Подробные сведения доступны только для назначенных вам кораблей.");
    if (!isGM) {
      if (canSubmitOrder) return guide(pendingOrder ? "Приказ отправлен" : "Выберите приказ",
        pendingOrder ? "Ведущий подтвердит приказ. До подтверждения его можно изменить." : "Выберите намерение корабля на этот раунд и отправьте его ведущему.");
      return guide("Наблюдайте за ходом боя", "Манёвры, залпы и действия экипажа выполняет ведущий. Здесь доступны сведения о вашем корабле.");
    }
    if (activeShip && selectedShip.id !== activeShip.id) return guide(`Сейчас действует: ${activeShip.name}`,
      "Вы просматриваете другого участника. Переключитесь, чтобы выполнить действие.",
      { action: "selectActiveShip", actionLabel: "К действующему кораблю" });
    const creature = selectedShip.unitType === "creature";
    if (creature && phase === "movement") return guide("Выберите манёвр существа", "Выберите подсвеченную клетку, проверьте маршрут и подтвердите движение на поле. Подготовительные действия ниже применяются сразу.");
    if (creature && phase === "crew") return guide("Восстановите силы существа", "Проверьте доступные действия восстановления и состояние существа.");
    if (phase === "orders") return guide("Выберите намерение корабля", "Приказ определяет возможности манёвра, стрельбы и работы экипажа в этом раунде.");
    if (phase === "movement") {
      if (actionState.movementState?.mustMove) return guide("Корабль должен продолжить движение",
        `Инерция требует пройти минимум ${actionState.movementState.requiredAdvance} гекс. Выберите подсвеченную клетку, проверьте маршрут и подтвердите движение. Подтверждение завершит активацию.`,
        { tone: "warning" });
      if (actionState.canMove) return guide("Выберите позицию на поле", "Выберите подсвеченную клетку для предпросмотра, затем подтвердите движение на поле. Подготовительные манёвры ниже применяются сразу и расходуют ОД.");
      return guide("Проверьте доступные манёвры", "Если корабль стоит, сначала наберите ход. Ограничения и требования поворота показаны ниже.");
    }
    if (phase === "gunnery") {
      if (creature) return guide("Выберите цель и атаку", "Доступность каждой атаки, её дальность и перезарядка показаны ниже.");
      if (!hasSelectedTarget) return guide("Выберите цель залпа", "Нажмите на противника на поле или в списке. Батареи покажут доступность и прогноз атаки.");
      const ready = hasShotPreview;
      return ready ? guide("Проверьте залп", "Выберите боеприпас и проверьте прогноз. Кнопка «Залп» применит результат и передаст ход.", { tone: "ready" })
        : guide("Сейчас нет доступного выстрела", "Выберите цель. У каждой батареи показана причина ограничения. Если стрелять невозможно, завершите активацию.");
    }
    if (phase === "crew") return guide("Выберите задачу экипажа", "Устраните наиболее опасную аварию или подготовьте абордаж. Причины ограничений указаны у действий.");
    return guide("Следите за обстановкой", "Состояние корабля и доступные действия показаны ниже.");
  }
}
