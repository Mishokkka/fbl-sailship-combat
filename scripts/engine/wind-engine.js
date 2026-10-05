import { angleBetween, normalizeHeading, rotateHeading } from "../board/board-geometry.js";

const STRENGTH_MODIFIERS = {
  calm: 0,
  light: 0.75,
  moderate: 1,
  strong: 1.15,
  storm: 0.7
};

export const SAILING_PROFILES = {
  foreAft: {
    label: "Косое вооружение",
    description: "Шхуны, каттеры и близкие к ним малые суда. Хорошо идут остро к ветру, хуже на чистом фордевинде.",
    tackBonus: 2,
    acceleration: 2,
    braking: 2,
    mastDamageFactor: 0.35,
    minSailFactor: 0.18,
    speed: { inIrons: 0, closeHauled: 0.7, beamReach: 0.95, broadReach: 1, running: 0.7 }
  },
  mixed: {
    label: "Смешанное вооружение",
    description: "Бриги, бригантины и корветы. Баланс между лавировкой и ходом на попутных курсах.",
    tackBonus: 0,
    acceleration: 2,
    braking: 2,
    mastDamageFactor: 0.28,
    minSailFactor: 0.20,
    speed: { inIrons: 0, closeHauled: 0.55, beamReach: 0.95, broadReach: 1, running: 0.8 }
  },
  square: {
    label: "Прямое вооружение",
    description: "Фрегаты и линейные корабли. Сильны на галфвинде, бакштаге и фордевинде, хуже лавируют.",
    tackBonus: -1,
    acceleration: 1,
    braking: 1,
    mastDamageFactor: 0.22,
    minSailFactor: 0.22,
    speed: { inIrons: 0, closeHauled: 0.35, beamReach: 0.85, broadReach: 1, running: 0.9 }
  },
  heavySquare: {
    label: "Тяжелое прямое",
    description: "Крупные линейные и ост-индцы. Тяжело поворачивают и плохо держат острый курс к ветру.",
    tackBonus: -2,
    acceleration: 1,
    braking: 1,
    mastDamageFactor: 0.18,
    minSailFactor: 0.25,
    speed: { inIrons: 0, closeHauled: 0.25, beamReach: 0.75, broadReach: 0.95, running: 0.85 }
  },
  lateen: {
    label: "Латинское/рейдерское",
    description: "Шебеки и похожие рейдеры. Сильно лавируют и хорошо меняют галсы, но хуже используют чистый попутный ветер.",
    tackBonus: 2,
    acceleration: 2,
    braking: 2,
    mastDamageFactor: 0.32,
    minSailFactor: 0.18,
    speed: { inIrons: 0, closeHauled: 0.75, beamReach: 0.9, broadReach: 0.95, running: 0.65 }
  },
  bomb: {
    label: "Кеч/тяжелая платформа",
    description: "Короткий тяжелый корпус, рассчитанный на оружие, а не на маневр.",
    tackBonus: -2,
    acceleration: 1,
    braking: 1,
    mastDamageFactor: 0.30,
    minSailFactor: 0.20,
    speed: { inIrons: 0, closeHauled: 0.2, beamReach: 0.65, broadReach: 0.8, running: 0.7 }
  }
};

export class WindEngine {
  static rotate(wind, steps) {
    return {
      ...wind,
      direction: normalizeHeading(Number(wind.direction ?? 0) + steps * 60)
    };
  }

  static getWindSourceDirection(wind) {
    return rotateHeading(wind?.direction ?? 0, 3);
  }

  static getPointOfSail(ship, wind) {
    const strength = wind?.strength ?? "moderate";
    const windSource = this.getWindSourceDirection(wind);
    const relative = angleBetween(ship?.heading, windSource);
    if (strength !== "calm" && relative <= 30) return "inIrons";
    if (relative <= 75) return "closeHauled";
    if (relative <= 105) return "beamReach";
    if (relative <= 165) return "broadReach";
    return "running";
  }

  static getSailingProfile(ship) {
    const profile = String(ship?.sailing?.profile ?? ship?.sailProfile ?? "square");
    return SAILING_PROFILES[profile] ? profile : "square";
  }

  static getSailingProfileData(ship) {
    return SAILING_PROFILES[this.getSailingProfile(ship)] ?? SAILING_PROFILES.square;
  }

  static getBasePointModifier(ship, wind) {
    const point = this.getPointOfSail(ship, wind);
    const profile = this.getSailingProfileData(ship);
    return Number(profile.speed?.[point] ?? 1);
  }

  static getSpeedModifier(ship, wind) {
    const base = this.getBasePointModifier(ship, wind);
    const strength = STRENGTH_MODIFIERS[wind?.strength] ?? 1;
    const sailDamage = this.getSailDamageModifier(ship);
    return Math.max(0, base * strength * sailDamage);
  }

  static getWindStrengthModifier(wind) {
    return STRENGTH_MODIFIERS[wind?.strength] ?? 1;
  }

  static getEffectiveMaxSpeed(ship, wind) {
    return Math.max(0, Math.floor(Number(ship?.maxSpeed ?? 0) * this.getSpeedModifier(ship, wind)));
  }

  static isInIrons(ship, wind) {
    return this.getPointOfSail(ship, wind) === "inIrons";
  }

  static syncInIronsFlag(ship, wind) {
    ship.flags ??= {};
    const inIrons = this.isInIrons(ship, wind);
    ship.flags.inIrons = inIrons;
    if (inIrons) ship.speed = 0;
    return inIrons;
  }

  static getSailDamageDetails(ship) {
    const profile = this.getSailingProfileData(ship);
    const factor = Number(profile.mastDamageFactor ?? 0.25);
    const minimum = Number(profile.minSailFactor ?? 0.2);
    let weightedDamage = 0;
    let total = 0;
    const entries = [];

    for (const section of Object.values(ship?.sections ?? {})) {
      for (const system of section.systems ?? []) {
        const name = String(system.name ?? "").toLowerCase();
        if (!name.includes("мачт") && !name.includes("бушприт") && !name.includes("такелаж") && !name.includes("парус")) continue;
        total += 1;
        const status = String(system.status ?? "intact");
        const weight = status === "destroyed" || status === "disabled" ? 1 : status === "damaged" ? 0.5 : 0;
        if (weight > 0) {
          weightedDamage += weight;
          entries.push(`${system.name ?? "рангоут"}: ${status}`);
        }
      }
    }

    const penalty = total ? weightedDamage * factor : 0;
    const modifier = Math.max(minimum, 1 - penalty);
    return {
      modifier,
      total,
      weightedDamage,
      factor,
      minimum,
      entries,
      text: entries.length
        ? `${entries.join(", ")}; профильный штраф ${Math.round((1 - modifier) * 100)}%`
        : "рангоут и паруса исправны"
    };
  }

  static getSailDamageModifier(ship) {
    return this.getSailDamageDetails(ship).modifier;
  }
}
