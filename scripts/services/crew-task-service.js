import { DamageEngine } from "../engine/damage-engine.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { SECTION_LABELS } from "../utils/constants.js";

/** Read-only, deterministic tasks. IDs identify a concrete section and system index at a battle revision. */
export class CrewTaskService {
  static actionKey(mode) {
    const category = ({ breaches: "flooding", wreckage: "system" })[mode] ?? mode;
    return "crewRepair:" + category;
  }

  static tasks(battle, ship) {
    if (!ship || ship.unitType === "creature") return [];
    const amount = DamageEngine.getRepairAmounts(ship);
    const tasks = [];
    const onWater = DamageEngine.isOnWater(ship);
    const add = (mode, sectionId, data, systemIndex = null) => tasks.push({
      id: [mode, sectionId ?? "ship", systemIndex ?? ""].join(":"),
      mode, sectionId, systemIndex, cost: 1, repairable: true,
      actionKey: this.actionKey(mode), priority: 20, risk: "", ...data
    });
    for (const [sectionId, section] of Object.entries(ship.sections ?? {})) {
      const location = section.label ?? SECTION_LABELS[sectionId] ?? sectionId;
      const hull = Number(section.hp?.value ?? 0), maxHull = Number(section.hp?.max ?? 0);
      if (hull < maxHull) add("hull", sectionId, {
        title: "Корпус секции", location, before: hull, after: hull, max: maxHull,
        repairable: false, priority: 0,
        blockedReason: "Прочность корпуса " + hull + "/" + maxHull + ". Аварийные партии устраняют последствия повреждений, но не восстанавливают HP корпуса."
      });
      const fire = Number(section.fire ?? 0);
      if (fire > 0) {
        const after = Math.max(0, fire - amount.level);
        const casualties = Math.max(1, Math.floor(fire / 3));
        add("fire", sectionId, {
          title: "Пожар", location, before: fire, after, metric: "Уровень огня", button: "Тушить",
          priority: fire >= 3 ? 90 : 60,
          effect: after ? "Пожар уменьшится, но продолжит повреждать секцию." : "Пожар в этой секции будет потушен.",
          consequence: "При сохранении условий огонь нанесёт " + (fire + (ship.flags?.uncontrolledFire ? 1 : 0)) + " урона секции в конце раунда; возможны рост и распространение.",
          risk: fire >= 3 ? (fire >= 5 ? "Неизбежные потери: " : "Риск потерь " + Math.round(Math.min(1, 0.2 * fire) * 100) + "%: ") + casualties + " чел. и снижение морали." : "Тушение на этом уровне не вызывает потерь команды."
        });
      }
      for (const mode of ["flooding", "breaches"]) {
        const value = Number(section[mode] ?? 0);
        if (value <= 0) continue;
        const flooding = mode === "flooding";
        add(mode, sectionId, {
          title: flooding ? "Затопление" : "Пробоины", location, before: value, after: Math.max(0, value - amount.level),
          metric: flooding ? "Уровень воды" : "Открытые пробоины",
          button: flooding ? "Откачать воду" : "Заделать пробоины", priority: onWater ? 75 : 30,
          effect: flooding ? "Помпы уберут воду. Открытые пробоины при этом останутся." : "Плотники закроют пробоины. Накопившуюся воду нужно откачать отдельно.",
          consequence: onWater ? flooding ? "Вода мешает ходу; при усилении течи пострадают корпус и команда." : "Пока корабль на H0, через пробоины будет поступать вода."
            : "В воздухе вода не прибывает. Опасность увеличится при снижении до H0."
        });
      }
      const wreckage = Number(section.mastWreckage ?? 0);
      if (wreckage > 0) add("wreckage", sectionId, {
        title: "Обломки рангоута", location, before: wreckage, after: Math.max(0, wreckage - 1), metric: "Завалы",
        button: "Расчистить", priority: ship.flags?.immobilized ? 80 : 45,
        effect: "Команда расчистит один завал.", consequence: "Два и более завала обездвиживают корабль; для снятия этого ограничения нужно убрать все."
      });
      for (const [systemIndex, system] of (section.systems ?? []).entries()) {
        if (!["damaged", "destroyed", "disabled"].includes(system.status)) continue;
        const repairable = system.status === "damaged";
        const before = Number(system.hp?.value ?? 0);
        const max = Number(system.hp?.max ?? 6);
        const after = repairable ? Math.min(max, before + amount.system) : before;
        add("system", sectionId, {
          title: system.name ?? "Система", location, before, after, metric: "Прочность системы", max,
          button: "Восстановить", priority: 40, repairable,
          blockedReason: repairable ? "" : "Уничтоженную или отключённую систему нельзя восстановить аварийной партией.",
          effect: repairable ? after > Math.ceil(max / 2) ? "Система снова станет исправной." : "Прочность вырастет, но система останется повреждённой."
            : "Требуется решение ведущего или ремонт вне боя.",
          consequence: "Повреждение продолжает ограничивать работу этой системы."
        }, systemIndex);
      }
    }
    const core = ship.crystal;
    if (MovementEngine.usesCore(battle) && core && !ship.flags?.coreExploded) {
      const heat = Number(core.heat ?? 0), integrity = Number(core.integrity ?? 0);
      const afterHeat = Math.max(0, heat - amount.cooling);
      const afterIntegrity = afterHeat <= Math.floor(Number(core.maxHeat ?? 10) / 2)
        ? Math.min(Number(core.maxIntegrity ?? 1), integrity + amount.integrity) : integrity;
      const stopsFall = ship.flags?.falling && afterIntegrity > 0 && afterHeat < Number(core.maxHeat ?? 10);
      if (heat > 0 || integrity < Number(core.maxIntegrity ?? 1) || stopsFall) add("crystal", null, {
        title: "Ядро кристалла", location: "Подъёмная система", before: heat, after: afterHeat, metric: "Нагрев",
        secondary: "Целостность " + integrity + " → " + afterIntegrity,
        button: "Стабилизировать", priority: ship.flags?.falling || heat >= Number(core.maxHeat ?? 10) ? 100 : 35,
        effect: stopsFall ? "Работа ядра восстановится. Вертикальная инерция сохранится: проверьте высоту."
          : "Охлаждение; восстановление целостности возможно при нагреве не выше половины предела.",
        consequence: ship.flags?.falling ? "Корабль падает. До расчёта конца раунда важно восстановить подъём."
          : heat >= Number(core.maxHeat ?? 10) ? "В конце раунда перегрев может повредить ядро." : "Запас до перегрева: " + Math.max(0, Number(core.maxHeat ?? 10) - heat) + "."
      });
    }
    const morale = Number(ship.crew?.morale ?? 10);
    if (morale > 0 && morale < 10) add("rally", null, {
      title: "Мораль команды", location: "Экипаж", before: morale, after: Math.min(10, morale + amount.morale), metric: "Мораль",
      button: "Собрать команду", priority: morale <= 3 ? 85 : 25,
      effect: "Офицеры восстановят мораль команды.", consequence: "Низкая мораль ухудшает инициативу и устойчивость; при нуле корабль сдаётся."
    });
    return tasks.sort((a, b) => b.priority - a.priority);
  }

  /** Reject vanished/nonrepairable targets instead of falling back to another problem. */
  static resolve(battle, ship, taskId) {
    const task = this.tasks(battle, ship).find(task => task.id === taskId);
    if (!task?.repairable) return { ok: false, text: task?.blockedReason ?? "Эта авария уже устранена или цель работ изменилась." };
    const text = DamageEngine.repair(ship, task.mode, { sectionId: task.sectionId, systemIndex: task.systemIndex });
    DamageEngine.checkStruck(ship);
    return { ok: true, task, text: task.location + " · " + task.title + ". " + text };
  }
}
