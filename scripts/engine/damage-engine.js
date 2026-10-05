import { angleBetween, bearingBetween, distanceCells } from "../board/board-geometry.js";
import { ALTITUDE_MAX, ALTITUDE_MIN, AMMO_LABELS, CRYSTAL_BLAST_RADIUS_HEXES, STRIKE_HP_RATIO } from "../utils/constants.js";
import { chance, d6, randomChoice } from "../utils/random.js";
import { CombatantRules } from "../rules/combatant-rules.js";
import { getCombatants } from "../utils/combatants.js";
import { CreatureDamageEngine } from "./creature-damage-engine.js";

export class DamageEngine {
  static chooseHitSection(attacker, target) {
    if (target?.unitType === "creature") return CreatureDamageEngine.chooseDirectionalSection(attacker, target);
    const incoming = bearingBetween(target, attacker);
    const delta = angleBetween(target.heading, incoming);
    if (delta <= 45) return "bow";
    if (delta >= 135) return "stern";
    return "midship";
  }

  static applyAttackResult(result, battle = null) {
    if (!result?.hit || !CombatantRules.supports(result?.target, "damage")) return null;
    result.battle ??= battle;
    if (result.target?.unitType === "creature") return CreatureDamageEngine.applyGunneryAttackResult(result);
    const ammo = result.ammo ?? result.battery?.ammo ?? "roundShot";

    if (ammo === "grapeShot") return this.applyGrapeShot(result);
    if (ammo === "chainShot") return this.applyChainShot(result);
    if (ammo === "shellBomb") return this.applyShellBomb(result);
    return this.applyRoundShot(result);
  }

  static applyCreatureAttackResult(result) {
    const target = result?.target;
    if (!result?.hit || !target || target.unitType === "creature") return null;
    const sectionId = result.targetSection ?? this.chooseHitSection(result.attacker, target);
    const section = target.sections?.[sectionId] ?? Object.values(target.sections ?? {})[0];
    if (!section) return null;
    const tags = new Set(result.tags ?? result.attack?.tags ?? []);
    const attackType = String(result.attack?.type ?? "natural");
    let armor = Number(section.dr ?? 0);
    if (tags.has("piercing") || attackType === "ram") armor = Math.ceil(armor / 2);
    if (attackType === "sonic" || attackType === "magic") armor = 0;
    const braceReduction = this.getBraceReduction(target);
    const penetrating = Math.max(0, Number(result.damage ?? 0) - armor - braceReduction);
    section.hp.value = Math.max(0, Number(section.hp?.value ?? 0) - penetrating);
    const notes = [];
    if (penetrating >= 6 && (tags.has("bleed") || tags.has("piercing") || attackType === "ram")) {
      notes.push(this.addBreachOrFlooding(target, section, 1, "разорван корпус"));
    }
    if (tags.has("fire") || attackType === "breath" && tags.has("burning")) {
      section.fire = Number(section.fire ?? 0) + (penetrating >= 8 ? 2 : 1);
      notes.push(` Пожар +${penetrating >= 8 ? 2 : 1}.`);
    }
    if (tags.has("morale") || tags.has("poison") || attackType === "sonic") {
      target.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
      const moraleLoss = tags.has("poison") ? 1 : penetrating >= 8 ? 2 : 1;
      target.crew.morale = Math.max(0, Number(target.crew.morale ?? 10) - moraleLoss);
      target.flags ??= {};
      target.flags.suppressed = true;
      notes.push(` Мораль ${target.crew.morale}/10, команда подавлена${tags.has("poison") ? " ядом" : ""}.`);
    }
    if (tags.has("grapple") && penetrating > 0) {
      target.speed = Math.max(0, Number(target.speed ?? 0) - 1);
      notes.push(" Существо цепляется за корпус: ход -1.");
    }
    if (penetrating >= 5) {
      const losses = Math.max(1, Math.ceil(penetrating / 6));
      this.applyCrewLoss(target, losses, penetrating >= 10);
      notes.push(` Потери экипажа ${losses}.`);
    }
    this.checkStruck(target);
    return {
      ok: true, sectionId, section, armor, penetrating,
      text: `${target.name}: ${this.sectionLabel(sectionId)} получает ${penetrating} урона от «${result.attack?.label ?? "атаки существа"}» после защиты ${armor}${braceReduction ? ` и готовности ${braceReduction}` : ""}.${notes.join("")}${this.getStruckText(target)}`
    };
  }

  static getBraceReduction(ship) {
    return ship?.selectedOrder === "brace" ? 2 : 0;
  }

  static getStruckText(ship) {
    const entries = [];
    this.checkStruck(ship, entries);
    return entries.length ? ` ${entries.join(" ")}` : "";
  }

  static getRakingInfo(result, sectionId = null) {
    if (!result?.attacker || !result?.target) {
      return { active: false, kind: null, crewMultiplier: 1, systemBonus: 0, sectionId };
    }
    const incoming = bearingBetween(result.target, result.attacker);
    const delta = angleBetween(result.target.heading, incoming);
    const bowRake = delta <= 30;
    const sternRake = delta >= 150;
    const resolvedSection = sectionId ?? this.resolveHitSection(result);
    if (!bowRake && !sternRake) {
      return { active: false, kind: null, crewMultiplier: 1, systemBonus: 0, sectionId: resolvedSection };
    }
    return {
      active: true,
      kind: sternRake ? "stern" : "bow",
      crewMultiplier: sternRake ? 1.6 : 1.35,
      systemBonus: sternRake ? 2 : 1,
      sectionId: resolvedSection
    };
  }

  static applySplinterCasualties(ship, penetrating, result, options = {}) {
    if (!ship?.crew || Number(penetrating ?? 0) < 5) return "";
    const raking = options.raking ?? this.getRakingInfo(result);
    let losses = Math.max(1, Math.floor((Number(penetrating ?? 0) + 1) / 5));
    if (raking.active) {
      losses = Math.max(1, Math.ceil(losses * raking.crewMultiplier) + (raking.kind === "stern" ? 1 : 0));
    }
    this.applyCrewLoss(ship, losses, losses >= 3 || raking.active);
    if (losses >= 3) {
      ship.flags ??= {};
      ship.flags.suppressed = true;
    }
    const rakeText = raking.active
      ? (raking.kind === "stern" ? " Продольный огонь с кормы проходит вдоль палуб." : " Продольный огонь с носа проходит вдоль палуб.")
      : "";
    return `${rakeText} Щепа и осколки выбивают экипаж: потери ${losses}, команда ${ship.crew.current}/${ship.crew.required}.`;
  }

  static applyRakingSystemPass(ship, section, penetrating, raking) {
    if (!raking?.active || Number(penetrating ?? 0) < 6) return "";
    const hit = this.pickHitSystem(section);
    const amount = Math.max(1, Math.ceil(Number(penetrating ?? 0) / 4) + Number(raking.systemBonus ?? 0));
    const systemText = this.damageSystem(hit.system, amount, hit);
    if (!systemText) return " Продольный огонь проходит сквозь батарейную палубу.";
    return ` Продольный огонь проходит сквозь батарейную палубу.${systemText}`;
  }

  static applyRoundShot(result) {
    const sectionId = this.resolveHitSection(result);
    const section = result.target.sections[sectionId];
    if (!section) return null;

    const dr = Number(section.dr ?? 0);
    const braceReduction = this.getBraceReduction(result.target);
    const penetrating = Math.max(0, Number(result.damage ?? 0) - dr - braceReduction);
    section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - penetrating);

    let systemText = "";
    let criticalText = "";
    let coreText = "";
    if (penetrating > 0) {
      const hit = result.aimedSection === "crystalCore"
        ? this.pickCrystalCoreSystem(result.target) ?? this.pickHitSystem(section)
        : this.pickHitSystem(section);
      systemText = this.damageSystem(hit.system, Math.max(1, Math.ceil(penetrating / 3)), hit);
      criticalText = this.resolveCritical(result.target, sectionId, section, hit.system, penetrating, result);
      if (result.aimedSection === "crystalCore") coreText = this.applyCrystalCoreHit(result.target, penetrating, result);
    }
    const raking = this.getRakingInfo(result, sectionId);
    const rakingText = this.applyRakingSystemPass(result.target, section, penetrating, raking);
    const splinterText = this.applySplinterCasualties(result.target, penetrating, result, { raking });
    criticalText = `${rakingText}${splinterText}${criticalText}`;

    const heated = result.ammo === "heatedShot";
    if (penetrating >= 10 && chance(heated ? 0.7 : 0.25)) section.fire += heated ? 2 : 1;
    let selfRiskText = "";
    if (heated && result.attacker && chance(0.18)) {
      const own = result.attacker.sections?.midship ?? Object.values(result.attacker.sections ?? {})[0];
      if (own) own.fire = Number(own.fire ?? 0) + 1;
      selfRiskText = ` ${result.attacker.name}: каленые ядра опасны в обращении, пожар +1 в собственной секции.`;
    }
    let breachText = "";
    if (penetrating >= 8 && chance(0.25)) breachText = this.addBreachOrFlooding(result.target, section, 1, "опасная пробоина от попадания");
    const moraleText = this.applyHeavyBroadsideShock(result.target, result, penetrating);

    const severity = this.getDamageSeverityLabel(penetrating);
    const aimedText = result.aimedSection ? " Прицельный залп." : "";
    return {
      sectionId,
      section,
      penetrating,
      text: `${result.target.name}: ${this.sectionLabel(sectionId)} получает ${penetrating} после DR ${dr}${braceReduction ? ` и готовности к удару ${braceReduction}` : ""} (${severity}).${aimedText}${systemText}${criticalText}${breachText}${moraleText}${coreText}${selfRiskText}${this.getStruckText(result.target)}`
    };
  }

  static applyChainShot(result) {
    const sectionId = this.resolveHitSection(result);
    const section = result.target.sections[sectionId];
    if (!section) return null;

    const dr = Number(section.dr ?? 0);
    const braceReduction = this.getBraceReduction(result.target);
    const penetrating = Math.max(0, Number(result.damage ?? 0) - Math.ceil(dr / 2) - braceReduction);
    const hullDamage = Math.max(0, Math.floor(penetrating / 2));
    section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - hullDamage);

    const riggingHit = this.pickRiggingSystem(result.target, section) ?? this.pickHitSystem(section);
    const rigging = riggingHit.system ?? riggingHit;
    const systemText = this.damageSystem(rigging, Math.max(2, Math.ceil(Number(result.damage ?? 0) / 4)), riggingHit.slotRoll ? riggingHit : null);
    const criticalText = this.resolveCritical(result.target, sectionId, section, rigging, penetrating, result, { riggingBias: true });
    const aimedText = result.aimedSection ? " Прицельный залп." : "";

    return {
      sectionId,
      section,
      penetrating: hullDamage,
      text: `${result.target.name}: ${AMMO_LABELS.chainShot} рвут рангоут и такелаж. Корпус получает ${hullDamage}${braceReduction ? `, готовность к удару снижает эффект на ${braceReduction}` : ""}.${aimedText}${systemText}${criticalText}${this.getStruckText(result.target)}`
    };
  }

  static applyShellBomb(result) {
    const sectionId = this.resolveHitSection(result);
    const section = result.target.sections[sectionId];
    if (!section) return null;
    const dr = Math.ceil(Number(section.dr ?? 0) / 2);
    const braceReduction = this.getBraceReduction(result.target);
    const penetrating = Math.max(0, Number(result.damage ?? 0) - dr - braceReduction);
    section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - penetrating);
    section.fire = Number(section.fire ?? 0) + (penetrating >= 8 ? 2 : 1);
    const losses = Math.max(1, Math.ceil(penetrating / 5));
    this.applyCrewLoss(result.target, losses, penetrating >= 8);
    let magazineText = "";
    const powder = this.findSystem(result.target, "порох");
    if (powder && penetrating >= 10 && chance(0.18)) {
      const extra = Math.max(8, Math.ceil(Number(result.damage ?? penetrating) * 0.7));
      section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - extra);
      section.fire = Number(section.fire ?? 0) + 2;
      magazineText = ` КРИТ: взрывная волна достает пороховой погреб, секция получает еще ${extra}, пожар +2.`;
    }
    const breachText = penetrating >= 8 ? this.addBreachOrFlooding(result.target, section, 1, "разрыв бомбы открыл пробоину") : "";
    const moraleText = this.applyHeavyBroadsideShock(result.target, result, penetrating, { bomb: true });
    return {
      sectionId,
      section,
      penetrating,
      text: `${result.target.name}: бомба рвется в секции ${this.sectionLabel(sectionId)}. Корпус получает ${penetrating} после DR ${dr}${braceReduction ? ` и готовности к удару ${braceReduction}` : ""}; пожар +${penetrating >= 8 ? 2 : 1}; потери экипажа ${losses}.${breachText}${magazineText}${moraleText}${this.getStruckText(result.target)}`
    };
  }

  static applyGrapeShot(result) {
    const target = result.target;
    const crew = target.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    const rangePenalty = Number(result.range ?? 0) <= 3 ? 0 : 2;
    const raking = this.getRakingInfo(result);
    let losses = Math.max(1, Math.ceil(Number(result.damage ?? 0) / 4) - rangePenalty);
    if (raking.active) losses += Math.max(1, Math.ceil(losses * 0.5));
    crew.current = Math.max(0, Number(crew.current ?? 0) - losses);
    crew.casualties = Number(crew.casualties ?? 0) + losses;
    if (losses >= 4) crew.morale = Math.max(0, Number(crew.morale ?? 10) - 1);
    if (losses >= 3) target.flags ??= {};
    if (losses >= 3) target.flags.suppressed = true;

    let moraleText = raking.active ? " Продольная картечь выметает палубу." : "";
    const moraleRisk = Number(crew.current ?? 0) < Number(crew.required ?? 1) * 0.5 || Number(crew.morale ?? 10) <= 4;
    if (moraleRisk && chance(0.3)) {
      crew.morale = Math.max(0, Number(crew.morale ?? 10) - 1);
      moraleText += ` Мораль падает до ${crew.morale}/10.`;
    }

    return {
      sectionId: null,
      section: null,
      penetrating: 0,
      text: `${target.name}: ${AMMO_LABELS.grapeShot} выбивает ${losses} членов экипажа. Экипаж ${crew.current}/${crew.required}.${losses >= 3 ? " Команда подавлена до конца раунда." : ""}${moraleText}${this.getStruckText(target)}`
    };
  }

  static applyHeavyBroadsideShock(target, result, penetrating, options = {}) {
    const arc = result?.battery?.arc;
    const heavy = options.bomb || (["port", "starboard"].includes(arc) && Number(result?.damage ?? 0) >= 14) || Number(penetrating ?? 0) >= 10;
    if (!heavy || !target?.crew) return "";
    target.crew.morale = Math.max(0, Number(target.crew.morale ?? 10) - 1);
    target.flags ??= {};
    target.flags.suppressed = true;
    return ` Тяжелый удар давит команду: мораль ${target.crew.morale}/10, подавление.`;
  }

  static findSystem(ship, needle) {
    needle = String(needle ?? "").toLowerCase();
    for (const section of Object.values(ship?.sections ?? {})) {
      for (const system of section.systems ?? []) {
        if (String(system.name ?? "").toLowerCase().includes(needle)) return system;
      }
    }
    return null;
  }

  static isRiggingName(name) {
    const text = String(name ?? "").toLowerCase();
    return text.includes("мачт") || text.includes("бушприт") || text.includes("такелаж") || text.includes("рангоут");
  }

  static countMastWreckage(ship) {
    return Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section.mastWreckage ?? 0), 0);
  }

  static countDestroyedRigging(ship) {
    let count = 0;
    for (const section of Object.values(ship?.sections ?? {})) {
      for (const system of section.systems ?? []) {
        if (system.status === "destroyed" && this.isRiggingName(system.name)) count += 1;
      }
    }
    return count;
  }

  static applyMastFall(ship, sectionId, section, system) {
    if (!ship || !section) return "";
    if (system?.mastFallResolved) return "";
    if (system) system.mastFallResolved = true;
    ship.flags ??= {};
    section.mastWreckage = Number(section.mastWreckage ?? 0) + 1;
    ship.flags.mastWreckage = this.countMastWreckage(ship);
    const beforeSpeed = Number(ship.speed ?? 0);
    ship.speed = Math.max(0, beforeSpeed - 2);
    const losses = Math.max(1, Math.ceil(Number(ship.crew?.required ?? 30) / 80));
    this.applyCrewLoss(ship, losses, true);
    let text = ` КРИТ: ${system?.name ?? "рангоут"} падает в секции ${this.sectionLabel(sectionId)}; ход ${beforeSpeed} → ${ship.speed}, обломки рангоута +1, потери экипажа ${losses}.`;
    if (ship.flags.mastWreckage >= 2 || this.countDestroyedRigging(ship) >= 2) {
      ship.flags.immobilized = true;
      ship.speed = 0;
      text += " Корабль обездвижен, пока команда не расчистит завалы и не восстановит управление парусами.";
    }
    return text;
  }

  static applyRiggingCritical(ship, sectionId, section, system, penetrating = 0) {
    if (system?.status === "destroyed") return this.applyMastFall(ship, sectionId, section, system);
    const beforeSpeed = Number(ship?.speed ?? 0);
    ship.speed = Math.max(0, beforeSpeed - 1);
    if (Number(penetrating ?? 0) >= 10 && section) section.mastWreckage = Number(section.mastWreckage ?? 0) + 1;
    return ` КРИТ: снасти и рангоут сбиты; ход ${beforeSpeed} → ${ship.speed}${section?.mastWreckage ? ", обломки мешают работе команды" : ""}.`;
  }

  static resolveCritical(ship, sectionId, section, system, penetrating, result, options = {}) {
    const fragments = [];
    const name = String(system?.name ?? "").toLowerCase();
    const bigHit = penetrating >= 12 || Number(result?.skill ?? 0) - Number(result?.roll ?? 0) >= 5;

    if (!system) return "";

    if (name.includes("ядр") && name.includes("крист") && result?.aimedSection !== "crystalCore") {
      const coreDamage = Math.max(1, Math.ceil(Number(penetrating ?? 0) / 2));
      const coreText = this.applyCrystalCoreHit(ship, coreDamage, result, { incidental: true });
      if (coreText) fragments.push(coreText);
    }

    if (system.status === "destroyed") {
      if (name.includes("порох")) {
        const blast = Math.max(10, Math.ceil(Number(result.damage ?? penetrating) * 0.8));
        section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - blast);
        section.fire = Number(section.fire ?? 0) + 2;
        this.applyCrewLoss(ship, Math.ceil(blast / 2), true);
        fragments.push(` КРИТ: пороховой погреб вспыхивает, секция получает еще ${blast}, пожар +2.`);
      } else if (this.isRiggingName(name)) {
        fragments.push(this.applyMastFall(ship, sectionId, section, system));
      } else if (name.includes("руль") || name.includes("штурвал")) {
        ship.speed = Math.max(0, Math.min(Number(ship.speed ?? 0), 1));
        fragments.push(" КРИТ: управление сорвано, корабль едва держит курс.");
      } else if (name.includes("батар") || name.includes("чэйзер")) {
        fragments.push(" КРИТ: орудийная прислуга выбита, связанная батарея больше не действует.");
      }
    }

    if (bigHit) {
      const effect = options.riggingBias ? "rigging" : randomChoice(["fire", "flooding", "crew", "shock"]);
      if (effect === "fire") {
        section.fire = Number(section.fire ?? 0) + 1;
        fragments.push(" КРИТ: вспыхивает пожар.");
      } else if (effect === "flooding") {
        fragments.push(this.addBreachOrFlooding(ship, section, 1, "критическая пробоина"));
      } else if (effect === "crew") {
        const losses = Math.max(2, Math.ceil(penetrating / 3));
        this.applyCrewLoss(ship, losses, true);
        fragments.push(` КРИТ: осколки и обломки выбивают экипаж, потери ${losses}.`);
      } else if (effect === "rigging") {
        fragments.push(this.applyRiggingCritical(ship, sectionId, section, system, penetrating));
      } else {
        ship.crew.morale = Math.max(0, Number(ship.crew?.morale ?? 10) - 1);
        fragments.push(` КРИТ: команда потрясена, мораль ${ship.crew.morale}/10.`);
      }
    }

    return fragments.join("");
  }

  static isOnWater(ship) {
    return Number(ship?.altitude ?? 0) <= 0;
  }

  static addBreachOrFlooding(ship, section, amount = 1, reason = "пробоина") {
    if (!ship || !section) return "";
    const value = Math.max(0, Number(amount ?? 0));
    if (value <= 0) return "";
    if (this.isOnWater(ship)) {
      section.flooding = Number(section.flooding ?? 0) + value;
      return ` ${reason}: вода +${value}.`;
    }
    section.breaches = Number(section.breaches ?? 0) + value;
    return ` ${reason}: пробоина +${value}; воды нет, пока корабль выше H0.`;
  }

  static getTotalBreaches(ship) {
    return Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section.breaches ?? 0), 0);
  }

  static activateBreachesAtWaterline(ship, entries = null) {
    if (!this.isOnWater(ship)) return "";
    const fragments = [];
    for (const [sectionId, section] of Object.entries(ship?.sections ?? {})) {
      const breaches = Number(section.breaches ?? 0);
      if (breaches <= 0) continue;
      section.flooding = Number(section.flooding ?? 0) + breaches;
      fragments.push(`${this.sectionLabel(sectionId)}: вода +${breaches}`);
    }
    if (!fragments.length) return "";
    const text = `${ship.name}: водная линия открывает пробоины (${fragments.join(", ")}).`;
    entries?.push(text);
    return text;
  }

  static applyCrewLoss(ship, losses, moraleHit = false) {
    ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    losses = Math.max(0, Number(losses ?? 0));
    ship.crew.current = Math.max(0, Number(ship.crew.current ?? 0) - losses);
    ship.crew.casualties = Number(ship.crew.casualties ?? 0) + losses;
    if (moraleHit) ship.crew.morale = Math.max(0, Number(ship.crew.morale ?? 10) - 1);
  }

  static resolveHitSection(result) {
    const aimed = result?.aimedSection;
    if (aimed && result?.target?.sections?.[aimed]) return aimed;
    return result?.targetSection ?? this.chooseHitSection(result.attacker, result.target);
  }

  static pickSystem(section) {
    return this.pickHitSystem(section).system;
  }

  static pickHitSystem(section) {
    const systems = section?.systems ?? [];
    const live = systems.filter(s => !["destroyed", "disabled"].includes(s.status));
    if (!live.length) return { system: null, slotRoll: null };
    const slotRoll = d6();
    const direct = live.find(s => Number(s.slot) === slotRoll);
    return { system: direct ?? randomChoice(live), slotRoll };
  }

  static pickRiggingSystem(ship, preferredSection = null) {
    const collect = section => (section?.systems ?? [])
      .filter(system => {
        const name = String(system.name ?? "").toLowerCase();
        return (name.includes("мачт") || name.includes("бушприт") || name.includes("такелаж")) && system.status !== "destroyed";
      })
      .map(system => ({ system, slotRoll: Number(system.slot ?? 0) || null }));

    const preferred = collect(preferredSection);
    if (preferred.length) return randomChoice(preferred);

    const systems = [];
    for (const section of Object.values(ship.sections ?? {})) systems.push(...collect(section));
    return randomChoice(systems);
  }

  static damageSystem(system, amount, hit = null) {
    if (!system) return "";
    system.hp.value = Math.max(0, Number(system.hp?.value ?? 0) - amount);
    if (system.hp.value <= 0) system.status = "destroyed";
    else if (system.hp.value <= Math.ceil(Number(system.hp?.max ?? 6) / 2)) system.status = "damaged";
    const slotText = hit?.slotRoll ? ` [${hit.slotRoll}]` : "";
    return ` Система${slotText}: ${system.name} (${this.statusLabel(system.status)}).`;
  }

  static getDamageSeverityLabel(penetrating) {
    if (penetrating <= 0) return "рикошет/не пробито";
    if (penetrating <= 4) return "легкое повреждение";
    if (penetrating <= 9) return "опасное попадание";
    if (penetrating <= 14) return "тяжелое попадание";
    return "разрушительный удар";
  }

  static adjacentSections(sectionId) {
    return {
      bow: ["midship"],
      midship: ["bow", "stern"],
      stern: ["midship"]
    }[sectionId] ?? [];
  }

  static getTotalFire(ship) {
    return Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section.fire ?? 0), 0);
  }

  static getTotalFlooding(ship) {
    return Object.values(ship?.sections ?? {}).reduce((sum, section) => sum + Number(section.flooding ?? 0), 0);
  }

  static spreadFire(ship, sectionId, fire = 0) {
    const amount = Number(fire ?? 0);
    if (amount < 3 || !ship?.sections) return "";
    const guaranteed = amount >= 5 || ship.flags?.uncontrolledFire;
    if (!guaranteed && !chance(0.25 * amount)) return "";
    const targets = this.adjacentSections(sectionId).map(id => [id, ship.sections[id]]).filter(([, section]) => section);
    if (!targets.length) return "";
    const spread = [];
    for (const [targetId, target] of targets) {
      target.fire = Number(target.fire ?? 0) + 1;
      spread.push(this.sectionLabel(targetId));
      if (!guaranteed) break;
    }
    return spread.length ? ` Пламя перекидывается: ${spread.join(", ")} +1.` : "";
  }

  static getFloodingLevel(flooding) {
    const value = Number(flooding ?? 0);
    if (value >= 8) return { id: "critical", label: "Критическое затопление", speedLoss: 2, hullDamage: 2, crewLoss: 1 };
    if (value >= 6) return { id: "heavy", label: "Тяжелое затопление", speedLoss: 2, hullDamage: 1, crewLoss: 0 };
    if (value >= 3) return { id: "danger", label: "Опасное затопление", speedLoss: 1, hullDamage: 0, crewLoss: 0 };
    return { id: "minor", label: "Легкое затопление", speedLoss: 0, hullDamage: 0, crewLoss: 0 };
  }

  static updateCrisisFlags(ship, entries = null) {
    ship.flags ??= {};
    const fire = this.getTotalFire(ship);
    const flooding = this.getTotalFlooding(ship);
    const mastWreckage = this.countMastWreckage(ship);

    if (fire >= 6 && !ship.flags.uncontrolledFire) {
      ship.flags.uncontrolledFire = true;
      entries?.push(`${ship.name}: пожар выходит из-под контроля.`);
    }
    if (ship.flags.uncontrolledFire && fire <= 2) {
      delete ship.flags.uncontrolledFire;
      entries?.push(`${ship.name}: пожар снова под контролем.`);
    }

    const shouldImmobilize = (this.isOnWater(ship) && flooding >= 6) || mastWreckage >= 2 || this.countDestroyedRigging(ship) >= 2;
    if (shouldImmobilize && !ship.flags.immobilized) {
      ship.flags.immobilized = true;
      ship.speed = 0;
      entries?.push(`${ship.name}: корабль обездвижен.`);
    }
    if (ship.flags.immobilized && flooding <= 2 && mastWreckage === 0 && this.countDestroyedRigging(ship) < 2) {
      delete ship.flags.immobilized;
      entries?.push(`${ship.name}: команда восстановила возможность хода.`);
    }
  }

  static advanceOngoingDamage(battle) {
    const entries = [];
    for (const ship of getCombatants(battle)) {
      if (!CombatantRules.supports(ship, "damage")) continue;
      if (ship.unitType === "creature") continue;
      for (const [sectionId, section] of Object.entries(ship.sections ?? {})) {
        const fire = Number(section.fire ?? 0);
        if (fire > 0) {
          const uncontrolled = Boolean(ship.flags?.uncontrolledFire);
          const fireDamage = fire + (uncontrolled ? 1 : 0);
          section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - fireDamage);
          if (fire >= 4 || chance((uncontrolled ? 0.28 : 0.18) * fire)) section.fire = fire + 1;
          const spreadText = this.spreadFire(ship, sectionId, section.fire);
          if (section.fire >= 4 || this.getTotalFire(ship) >= 6) ship.flags = { ...(ship.flags ?? {}), uncontrolledFire: true };
          entries.push(`${ship.name}: пожар в секции ${this.sectionLabel(sectionId)} наносит ${fireDamage}.${section.fire > fire ? " Огонь разрастается." : ""}${spreadText}`);
        }
        const breaches = Number(section.breaches ?? 0);
        if (breaches > 0 && this.isOnWater(ship)) {
          const beforeFlooding = Number(section.flooding ?? 0);
          section.flooding = beforeFlooding + Math.max(1, Math.ceil(breaches / 2));
          entries.push(`${ship.name}: вода идет через пробоины в секции ${this.sectionLabel(sectionId)}: затопление ${beforeFlooding} → ${section.flooding}.`);
        }
        const flooding = Number(section.flooding ?? 0);
        if (flooding > 0) {
          if (!this.isOnWater(ship)) {
            entries.push(`${ship.name}: вода в секции ${this.sectionLabel(sectionId)} не прибывает, пока корабль выше H0.`);
          } else {
            const level = this.getFloodingLevel(flooding);
            if (level.speedLoss) ship.speed = Math.max(0, Number(ship.speed ?? 0) - level.speedLoss);
            if (level.hullDamage) section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - level.hullDamage);
            if (level.crewLoss) this.applyCrewLoss(ship, level.crewLoss, true);
            if (chance(0.12 * flooding)) section.flooding = flooding + 1;
            entries.push(`${ship.name}: ${level.label} в секции ${this.sectionLabel(sectionId)} мешает ходу${level.hullDamage ? ` и наносит ${level.hullDamage} корпусу` : ""}.${section.flooding > flooding ? " Течь усиливается." : ""}`);
          }
        }
      }
      this.updateCrisisFlags(ship, entries);
      this.advanceCrystalCore(ship, entries);
      this.checkStruck(ship, entries);
    }
    return entries;
  }

  static checkStruck(ship, entries = null) {
    if (ship?.unitType === "creature") {
      const result = CreatureDamageEngine.updateConsequences(ship);
      if (result.text) entries?.push(`${ship.name}:${result.text}`);
      return;
    }
    const hp = this.totalHp(ship);
    const crew = ship.crew ?? {};
    const hasSurrendered = ship.flags?.struck;
    const moraleBreak = Number(crew.morale ?? 10) <= 0;
    const crippled = hp.max > 0 && hp.value <= hp.max * STRIKE_HP_RATIO;
    const crewBroken = Number(crew.required ?? 0) > 0 && Number(crew.current ?? 0) <= Number(crew.required) * 0.15;
    const uncontrolledFire = Boolean(ship.flags?.uncontrolledFire) && this.getTotalFire(ship) >= 10;
    const floodingLoss = this.isOnWater(ship) && this.getTotalFlooding(ship) >= 12;
    if (!hasSurrendered && (moraleBreak || crippled || crewBroken || uncontrolledFire || floodingLoss)) {
      ship.flags ??= {};
      ship.flags.struck = true;
      const cause = uncontrolledFire
        ? "пожар вышел из-под контроля"
        : floodingLoss
          ? "затопление стало критическим"
          : "корабль выбрасывает флаг сдачи или теряет боеспособность";
      entries?.push(`${ship.name}: ${cause}.`);
      if (!ship.flags.coreExploded) {
        const rescueText = this.resolveCrewRescue(ship);
        if (rescueText) entries?.push(rescueText);
      }
    }
  }

  static getStrikeHpRatio() {
    return STRIKE_HP_RATIO;
  }

  static totalHp(ship) {
    let value = 0;
    let max = 0;
    for (const section of Object.values(ship.sections ?? {})) {
      value += Number(section.hp?.value ?? 0);
      max += Number(section.hp?.max ?? 0);
    }
    return { value, max };
  }

  static repair(ship, mode = "auto") {
    if (!ship) return "Корабль не выбран.";
    const boosted = ship.selectedOrder === "damageControl";
    const repairAmount = boosted ? 2 : 1;
    const systemRepair = boosted ? 4 : 2;

    if (mode === "crystal") return this.repairCrystalCore(ship, boosted);

    if (mode === "rally") {
      ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
      const before = Number(ship.crew.morale ?? 10);
      const crewRatio = Number(ship.crew.required ?? 0) > 0 ? Number(ship.crew.current ?? 0) / Number(ship.crew.required ?? 1) : 1;
      const gain = before <= 0 ? 0 : (boosted || crewRatio >= 0.75 ? 2 : 1);
      ship.crew.morale = Math.min(10, before + gain);
      if (ship.crew.morale === before) return `${ship.name}: команда не приходит в порядок. Мораль ${ship.crew.morale}/10.`;
      return `${ship.name}: офицеры собирают команду. Мораль ${before}/10 → ${ship.crew.morale}/10${boosted ? " по приказу аварийных партий" : ""}.`;
    }

    if (mode === "fire" || mode === "auto") {
      for (const section of Object.values(ship.sections ?? {})) {
        if (section.fire > 0) {
          const before = Number(section.fire ?? 0);
          section.fire = Math.max(0, before - repairAmount);
          let riskText = "";
          if (before >= 3) {
            const losses = before >= 5 || chance(0.2 * before) ? Math.max(1, Math.floor(before / 3)) : 0;
            if (losses) {
              this.applyCrewLoss(ship, losses, true);
              riskText = ` Горящие завалы опасны: потери экипажа ${losses}.`;
            }
          }
          this.updateCrisisFlags(ship);
          return `${ship.name}: команда сбивает пожар на ${before - section.fire} уровень${before - section.fire > 1 ? "я" : ""}${boosted ? " по приказу аварийных партий" : ""}.${riskText}`;
        }
      }
      if (mode === "fire") return `${ship.name}: пожаров для тушения нет.`;
    }

    if (mode === "flooding" || mode === "auto") {
      for (const section of Object.values(ship.sections ?? {})) {
        if (section.flooding > 0) {
          const before = Number(section.flooding ?? 0);
          section.flooding = Math.max(0, before - repairAmount);
          return `${ship.name}: помпы снижают затопление на ${before - section.flooding} уровень${before - section.flooding > 1 ? "я" : ""}${boosted ? " по приказу аварийных партий" : ""}.`;
        }
      }
      for (const section of Object.values(ship.sections ?? {})) {
        if (Number(section.breaches ?? 0) > 0) {
          const before = Number(section.breaches ?? 0);
          section.breaches = Math.max(0, before - repairAmount);
          return `${ship.name}: плотники заделывают пробоины на ${before - section.breaches} уровень${before - section.breaches > 1 ? "я" : ""}${boosted ? " по приказу аварийных партий" : ""}.`;
        }
      }
      if (mode === "flooding") return `${ship.name}: опасного затопления и открытых пробоин нет.`;
    }

    if (mode === "system" || mode === "auto") {
      for (const section of Object.values(ship.sections ?? {})) {
        if (Number(section.mastWreckage ?? 0) > 0) {
          const before = Number(section.mastWreckage ?? 0);
          section.mastWreckage = Math.max(0, before - 1);
          ship.flags ??= {};
          ship.flags.mastWreckage = this.countMastWreckage(ship);
          this.updateCrisisFlags(ship);
          return `${ship.name}: команда расчищает обломки рангоута (${before} → ${section.mastWreckage}).`;
        }
      }
      for (const section of Object.values(ship.sections ?? {})) {
        const system = section.systems?.find(s => s.status === "damaged");
        if (system) {
          system.hp.value = Math.min(Number(system.hp.max ?? 6), Number(system.hp.value ?? 0) + systemRepair);
          if (system.hp.value > Math.ceil(Number(system.hp.max ?? 6) / 2)) system.status = "intact";
          return `${ship.name}: аварийная партия ремонтирует ${system.name}${boosted ? " с усилением по приказу" : ""}.`;
        }
      }
      if (mode === "system") return `${ship.name}: поврежденных, но ремонтопригодных систем нет.`;
    }

    return `${ship.name}: аварийные работы не нашли срочных задач.`;
  }

  static abandonShip(ship) {
    if (!ship) return { ok: false, text: "Корабль не выбран." };
    if (ship.flags?.abandoned) return { ok: false, text: `${ship.name}: корабль уже оставлен.` };
    ship.flags ??= {};
    ship.flags.abandoned = true;
    ship.flags.struck = true;
    ship.speed = 0;
    const rescueText = this.resolveCrewRescue(ship, { abandon: true });
    return {
      ok: true,
      text: `${ship.name}: приказ оставить корабль. Судно выходит из боя.${rescueText ? ` ${rescueText}` : ""}`
    };
  }

  static resolveCrewRescue(ship, options = {}) {
    if (!ship || ship.flags?.rescueResolved) return "";
    const crew = ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 0, rescued: 0 };
    const current = Math.max(0, Number(crew.current ?? 0));
    if (current <= 0) {
      ship.flags.rescueResolved = true;
      return `${ship.name}: спасать уже некого.`;
    }
    const catastrophic = Boolean(ship.flags?.coreExploded)
      || Boolean(ship.flags?.falling)
      || (ship.flags?.uncontrolledFire && this.getTotalFire(ship) >= 8)
      || (this.isOnWater(ship) && this.getTotalFlooding(ship) >= 10);
    const ratio = options.abandon
      ? (catastrophic ? 0.45 : 0.75)
      : (catastrophic ? 0.25 : 0.55);
    const rescued = Math.max(0, Math.floor(current * ratio));
    const lost = Math.max(0, current - rescued);
    crew.rescued = Number(crew.rescued ?? 0) + rescued;
    crew.casualties = Number(crew.casualties ?? 0) + lost;
    crew.current = 0;
    crew.morale = 0;
    ship.flags.rescueResolved = true;
    return `${ship.name}: спасено ${rescued}, потери при эвакуации ${lost}.`;
  }


  static ensureCrystalCore(ship) {
    ship.crystal ??= {};
    ship.crystal.enabled = ship.crystal.enabled !== false;
    ship.crystal.maxHeat = Math.max(4, Number(ship.crystal.maxHeat ?? 10));
    ship.crystal.heat = Math.max(0, Math.min(ship.crystal.maxHeat + 5, Number(ship.crystal.heat ?? 0)));
    ship.crystal.maxIntegrity = Math.max(1, Number(ship.crystal.maxIntegrity ?? 16));
    ship.crystal.integrity = Math.max(0, Math.min(ship.crystal.maxIntegrity, Number(ship.crystal.integrity ?? ship.crystal.maxIntegrity)));
    ship.crystal.armor = Math.max(0, Number(ship.crystal.armor ?? 9));
    if (Number(ship.crystal.armorRevision ?? 1) < 2) {
      ship.crystal.armor += 3;
      ship.crystal.armorRevision = 2;
    }
    ship.altitude = Math.max(ALTITUDE_MIN, Math.min(ALTITUDE_MAX, Number(ship.altitude ?? 3)));
    return ship.crystal;
  }

  static pickCrystalCoreSystem(ship) {
    const section = ship?.sections?.stern ?? null;
    const system = section?.systems?.find(s => {
      const name = String(s.name ?? "").toLowerCase();
      return name.includes("ядр") && name.includes("крист") && s.status !== "destroyed";
    });
    if (!system) return null;
    return { system, slotRoll: Number(system.slot ?? 6) || 6 };
  }

  static applyCrystalHeat(ship, amount = 1, reason = "нагрузка") {
    const core = this.ensureCrystalCore(ship);
    if (core.enabled === false || Number(core.integrity ?? 0) <= 0) return `${ship.name}: ядро кристалла не отвечает.`;
    const before = Number(core.heat ?? 0);
    core.heat = Math.max(0, Math.min(Number(core.maxHeat ?? 10) + 5, before + Number(amount ?? 0)));
    let text = `${ship.name}: ядро получает нагрузку (${reason}), нагрев ${before}/${core.maxHeat} → ${core.heat}/${core.maxHeat}.`;
    if (core.heat >= core.maxHeat) text += " Перегрев опасен: на конце раунда ядро может повредиться.";
    return text;
  }

  static applyCrystalCoreHit(ship, penetrating, result = null, options = {}) {
    const core = this.ensureCrystalCore(ship);
    if (core.enabled === false) return " Ядро уже отключено.";
    const incoming = Math.max(0, Number(penetrating ?? 0));
    const armor = options.alreadyPenetrated ? 0 : Number(core.armor ?? 0);
    const coreDamage = Math.max(0, incoming - armor);
    if (coreDamage <= 0) {
      core.heat = Math.min(Number(core.maxHeat ?? 10) + 5, Number(core.heat ?? 0) + 1);
      return ` Бронекапсула ядра выдерживает удар${armor ? ` (броня ядра ${armor})` : ""}, но кристалл нагревается до ${core.heat}/${core.maxHeat}.`;
    }

    const before = Number(core.integrity ?? core.maxIntegrity ?? 1);
    core.integrity = Math.max(0, before - coreDamage);
    core.heat = Math.min(Number(core.maxHeat ?? 10) + 5, Number(core.heat ?? 0) + Math.max(1, Math.ceil(coreDamage / 2)));
    let text = ` ЯДРО: ${options.incidental ? "осколочный удар" : "прямое попадание"}, целостность ${before}/${core.maxIntegrity} → ${core.integrity}/${core.maxIntegrity}, нагрев ${core.heat}/${core.maxHeat}.`;
    if (result?.aimedSection === "crystalCore") {
      ship.flags ??= {};
      ship.flags.dishonorableCoreTargeted = true;
      text += " Это считается бесчестным выстрелом.";
    }
    if (core.integrity <= 0) text += this.triggerCrystalFailure(ship, "ядро разрушено физическим ударом", { battle: result?.battle ?? null, forceExplosion: true, blastRadius: CRYSTAL_BLAST_RADIUS_HEXES });
    else if (core.heat >= Number(core.maxHeat ?? 10) + 3 && chance(0.25)) text += this.triggerCrystalFailure(ship, "критический перегрев после удара", { battle: result?.battle ?? null });
    return text;
  }

  static triggerCrystalFailure(ship, reason = "отказ ядра", options = {}) {
    const core = this.ensureCrystalCore(ship);
    ship.flags ??= {};
    if (ship.flags.coreExploded || (ship.flags.falling && !options.forceExplosion)) return "";
    const explodes = Boolean(options.forceExplosion) || chance(0.35) || Number(core.heat ?? 0) >= Number(core.maxHeat ?? 10) + 4;
    if (explodes) {
      ship.flags.coreExploded = true;
      ship.flags.struck = true;
      const stern = ship.sections?.stern;
      const mid = ship.sections?.midship;
      if (stern) {
        stern.hp.value = Math.max(0, Number(stern.hp.value ?? 0) - 24);
        stern.fire = Number(stern.fire ?? 0) + 3;
      }
      if (mid) {
        mid.hp.value = Math.max(0, Number(mid.hp.value ?? 0) - 12);
        mid.fire = Number(mid.fire ?? 0) + 1;
      }
      this.applyCrewLoss(ship, Math.max(10, Math.ceil(Number(ship.crew?.required ?? 50) * 0.12)), true);
      const blastText = this.applyCrystalBlast(options.battle ?? null, ship, Number(options.blastRadius ?? 2));
      return ` КАТАСТРОФА: ${reason}; ядро кристалла взрывается, корму разрывает, корабль выбывает из боя.${blastText}`;
    }
    ship.flags.falling = true;
    ship.verticalVelocity = Math.min(-1, Number(ship.verticalVelocity ?? 0) - 1);
    ship.speed = 0;
    ship.crew ??= { current: 0, required: 0, casualties: 0, morale: 10 };
    ship.crew.morale = Math.max(0, Number(ship.crew.morale ?? 10) - 2);
    return ` ОТКАЗ ЯДРА: ${reason}; корабль теряет левитацию и начинает падать.`;
  }

  static applyCrystalBlast(battle, origin, radius = CRYSTAL_BLAST_RADIUS_HEXES) {
    if (!getCombatants(battle).length || !origin) return "";
    const affected = [];
    for (const target of getCombatants(battle)) {
      if (!target || target.id === origin.id || !CombatantRules.supports(target, "damage") || !CombatantRules.isActive(target)) continue;
      const horizontalRange = distanceCells(origin, target);
      const verticalRange = Math.abs(Number(origin.altitude ?? 0) - Number(target.altitude ?? 0));
      const range = Math.max(horizontalRange, verticalRange);
      if (range > radius) continue;
      const intensity = range <= 1 ? 28 : 16;
      if (target.unitType === "creature") {
        const blast = CreatureDamageEngine.applyDamage(target, intensity, { ignoreArmor: false, tags: ["fire", "stun"], stun: range <= 1 ? 2 : 1 });
        target.speed = Math.max(0, Number(target.speed ?? 0) - 1);
        affected.push(`${target.name} R${range}: ${blast.penetrating ?? 0} урона плоти, огонь и оглушение`);
        continue;
      }
      const section = target.sections?.midship ?? target.sections?.stern ?? target.sections?.bow ?? Object.values(target.sections ?? {})[0];
      if (section) {
        section.hp.value = Math.max(0, Number(section.hp?.value ?? 0) - intensity);
        section.fire = Number(section.fire ?? 0) + (range <= 1 ? 3 : 2);
      }
      this.applyCrewLoss(target, range <= 1 ? 10 : 5, true);
      target.speed = Math.max(0, Number(target.speed ?? 0) - 1);
      this.checkStruck(target);
      affected.push(`${target.name} R${range}: ${intensity} урона центру, пожар +${range <= 1 ? 3 : 2}`);
    }
    return affected.length ? ` Взрывная волна в радиусе ${radius} гексов: ${affected.join("; ")}.` : "";
  }

  static advanceCrystalCore(ship, entries = []) {
    const core = this.ensureCrystalCore(ship);
    if (core.enabled === false) return;

    if (ship.flags?.falling) {
      if (Number(core.heat ?? 0) > 0) {
        const before = Number(core.heat ?? 0);
        core.heat = Math.max(0, before - 1);
        entries.push(`${ship.name}: отказавшее ядро остывает в падении ${before}/${core.maxHeat} → ${core.heat}/${core.maxHeat}.`);
      }
      return;
    }

    if (Number(core.heat ?? 0) >= Number(core.maxHeat ?? 10)) {
      const before = Number(core.integrity ?? core.maxIntegrity ?? 1);
      core.integrity = Math.max(0, before - 1);
      const stern = ship.sections?.stern;
      if (stern) stern.fire = Number(stern.fire ?? 0) + 1;
      entries.push(`${ship.name}: перегрев ядра повреждает бронекапсулу. Целостность ${before}/${core.maxIntegrity} → ${core.integrity}/${core.maxIntegrity}${stern ? ", пожар в корме +1" : ""}.`);
      if (core.integrity <= 0 || Number(core.heat ?? 0) >= Number(core.maxHeat ?? 10) + 3) {
        const failure = this.triggerCrystalFailure(ship, "перегрев ядра вышел из-под контроля");
        if (failure) entries.push(`${ship.name}:${failure}`);
      }
    }

    if (Number(core.heat ?? 0) > 0) {
      const before = Number(core.heat ?? 0);
      const mode = String(core.mode ?? "normal");
      const cooling = mode === "shutdown" ? 4 : before > Number(core.maxHeat ?? 10) ? 1 : 2;
      core.heat = Math.max(0, before - cooling);
      if (before >= Number(core.maxHeat ?? 10) || mode === "shutdown") entries.push(`${ship.name}: ядро ${mode === "shutdown" ? "быстро " : "частично "}остывает ${before}/${core.maxHeat} → ${core.heat}/${core.maxHeat}.`);
    }
  }

  static repairCrystalCore(ship, boosted = false) {
    const core = this.ensureCrystalCore(ship);
    if (ship.flags?.coreExploded) return `${ship.name}: ядро кристалла уничтожено взрывом; ремонт невозможен.`;
    const beforeHeat = Number(core.heat ?? 0);
    const beforeIntegrity = Number(core.integrity ?? core.maxIntegrity ?? 1);
    const cooling = boosted ? 4 : 3;
    core.heat = Math.max(0, beforeHeat - cooling);
    let repaired = 0;
    if (core.heat <= Math.floor(Number(core.maxHeat ?? 10) / 2) && beforeIntegrity < Number(core.maxIntegrity ?? 1)) {
      repaired = boosted ? 2 : 1;
      core.integrity = Math.min(Number(core.maxIntegrity ?? 1), beforeIntegrity + repaired);
    }
    if (ship.flags?.falling && core.integrity > 0 && core.heat < core.maxHeat) {
      delete ship.flags.falling;
      ship.crew.morale = Math.max(1, Number(ship.crew?.morale ?? 1));
      return `${ship.name}: аварийная партия стабилизирует ядро и срывает падение. Нагрев ${beforeHeat}/${core.maxHeat} → ${core.heat}/${core.maxHeat}, целостность ${beforeIntegrity}/${core.maxIntegrity} → ${core.integrity}/${core.maxIntegrity}.`;
    }
    return `${ship.name}: команда охлаждает ядро кристалла. Нагрев ${beforeHeat}/${core.maxHeat} → ${core.heat}/${core.maxHeat}${repaired ? `, целостность +${repaired}` : ""}${boosted ? " по приказу аварийных партий" : ""}.`;
  }

  static addManualDamage(ship, amount = 5, sectionId = "midship") {
    const section = ship?.sections?.[sectionId] ?? ship?.sections?.midship ?? Object.values(ship?.sections ?? {})[0];
    if (!ship || !section) return "Корабль или секция не найдены.";
    amount = Math.max(1, Number(amount ?? 5));
    section.hp.value = Math.max(0, Number(section.hp.value ?? 0) - amount);
    const system = this.pickSystem(section);
    const systemText = amount >= 5 ? this.damageSystem(system, Math.ceil(amount / 3)) : "";
    this.checkStruck(ship);
    return `${ship.name}: ручное повреждение ${this.sectionLabel(section.id ?? sectionId)} на ${amount}.${systemText}`;
  }

  static addManualFire(ship, sectionId = "midship") {
    const section = ship?.sections?.[sectionId] ?? ship?.sections?.midship ?? Object.values(ship?.sections ?? {})[0];
    if (!ship || !section) return "Корабль или секция не найдены.";
    section.fire = Number(section.fire ?? 0) + 1;
    return `${ship.name}: в секции ${this.sectionLabel(section.id ?? sectionId)} добавлен пожар +1.`;
  }

  static addManualFlooding(ship, sectionId = "midship") {
    const section = ship?.sections?.[sectionId] ?? ship?.sections?.midship ?? Object.values(ship?.sections ?? {})[0];
    if (!ship || !section) return "Корабль или секция не найдены.";
    const text = this.addBreachOrFlooding(ship, section, 1, "ручная пробоина");
    return `${ship.name}: в секции ${this.sectionLabel(section.id ?? sectionId)} добавлено повреждение.${text}`;
  }

  static sectionLabel(id) {
    return { bow: "нос", midship: "центр", stern: "корма" }[id] ?? id;
  }

  static statusLabel(status) {
    return { intact: "цела", damaged: "повреждена", destroyed: "уничтожена", disabled: "выведена" }[status] ?? status;
  }
}
