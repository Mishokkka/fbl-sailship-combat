import { AMMO_LABELS, AMMO_TOOLTIPS, ARC_LABELS, FIRE_MODE_LABELS, FIRE_MODE_TOOLTIPS, HEX_SCALE_METERS, WEAPON_TYPE_LABELS } from "../utils/constants.js";
import { WindEngine } from "../engine/wind-engine.js";
import { MovementEngine } from "../engine/movement-engine.js";
import { GunneryEngine } from "../engine/gunnery-engine.js";
import { BoardingEngine } from "../engine/boarding-engine.js";
import { CreatureAttackEngine } from "../engine/creature-attack-engine.js";
import { CreatureAbilityEngine } from "../engine/creature-ability-engine.js";
import { CreatureGrappleEngine } from "../engine/creature-grapple-engine.js";

const HISTORICAL_GUNNERY_UI = {
  longGun: {
    roleLabel: "линейный бой",
    roleText: "Основная батарея линии: уверенный обмен огнем на рабочей дистанции и решающий залп при сближении.",
    arcLabel: "широкая бортовая",
    arcText: "Бортовые порты дают широкую, но не круговую дугу вдоль борта.",
    decisiveMax: 6,
    extremeMax: 16
  },
  carronade: {
    roleLabel: "удар на сближении",
    roleText: "Оружие короткой дистанции: особенно опасно, когда корабли почти сошлись борт к борту.",
    arcLabel: "широкая бортовая",
    arcText: "Сектор похож на бортовую батарею, но практический смысл почти целиком в упоре.",
    decisiveMax: 3,
    extremeMax: 6
  },
  chaser: {
    roleLabel: "погоня и отрыв",
    roleText: "Носовые и кормовые орудия для погони, добивания, срыва снастей и удержания дистанции.",
    arcLabel: "узкая нос/корма",
    arcText: "Чэйзеры стреляют узко по курсу или строго назад, а не как полноценный борт.",
    decisiveMax: 6,
    extremeMax: 16
  },
  mortar: {
    roleLabel: "навесной огонь",
    roleText: "Специализированное дальнее бомбометание по площади и палубам, не для боя в упор.",
    arcLabel: "круговая навесная",
    arcText: "Мортира может выбирать цель по кругу, но только вне большой мертвой ближней зоны.",
    decisiveMax: 12,
    extremeMax: 20
  },
  swivel: {
    roleLabel: "антипалубное",
    roleText: "Легкое палубное оружие против команды, шлюпок и абордажников на совсем близкой дистанции.",
    arcLabel: "круговая ближняя",
    arcText: "Поворотные пушки охватывают почти весь горизонт, но полезны лишь в непосредственной близости.",
    decisiveMax: 1,
    extremeMax: 3
  }
};

export class CombatPanelContextBuilder {
  constructor(app, renderCache = null) {
    this.app = app;
    this.renderCache = renderCache;
  }

  getTargets(battle, selectedShip, arc) {
    const options = { aimedSection: this.app.aimSection };
    return this.renderCache
      ? this.renderCache.getTargets(battle, selectedShip, arc, options)
      : GunneryEngine.getTargets(battle, selectedShip, arc, options);
  }

  getSelectedInfo(battle, selectedShip) {
    const pointOfSail = WindEngine.getPointOfSail(selectedShip, battle.wind);
    const effectiveMaxSpeedDetails = MovementEngine.getEffectiveMaxSpeedDetails(battle, selectedShip);
    const effectiveMaxSpeed = effectiveMaxSpeedDetails.value;
    const effectiveMaxSpeedTitle = effectiveMaxSpeedDetails.title;
    const speedModifier = Math.round(WindEngine.getSpeedModifier(selectedShip, battle.wind) * 100);
    const maneuverAdvice = MovementEngine.getManeuverAdvice(battle, selectedShip);
    const coreAdvice = MovementEngine.getCoreAdvice(selectedShip, battle);
    return {
      pointOfSail,
      effectiveMaxSpeed,
      effectiveMaxSpeedTitle,
      speedModifier,
      sailingProfile: effectiveMaxSpeedDetails.profileKey,
      sailingProfileLabel: effectiveMaxSpeedDetails.profileLabel,
      maneuverAdvice,
      coreAdvice
    };
  }

  getBoardingInfo(battle, selectedShip, selectedTarget) {
    const grappledWith = BoardingEngine.getGrappledWith(selectedShip);
    const grappledTarget = grappledWith ? battle.ships.find(s => s.id === grappledWith) : null;
    const canGrapple = selectedTarget ? BoardingEngine.canGrapple(selectedShip, selectedTarget) : false;
    const canBoard = Boolean(grappledTarget && grappledTarget.side !== selectedShip.side);
    return {
      grappledWith,
      grappledTarget,
      canGrapple,
      canBoard,
      boardingPower: BoardingEngine.getBoardingPower(selectedShip)
    };
  }

  getWeaponControls(battle, selectedShip) {
    return (selectedShip?.weapons ?? []).map(sourceWeapon => {
      const weapon = foundry.utils.deepClone(sourceWeapon);
      GunneryEngine.normalizeAmmoForWeapon(weapon);
      GunneryEngine.normalizeFireModeForWeapon(weapon);
      const type = GunneryEngine.getWeaponType(weapon);
      const profile = GunneryEngine.getWeaponProfile(weapon);
      const minRange = GunneryEngine.getMinimumRange(weapon);
      const maxRange = GunneryEngine.getEffectiveRange(weapon);
      const ammoOptions = GunneryEngine.getAvailableAmmo(battle, selectedShip, weapon).map(ammo => ({
        id: ammo,
        label: AMMO_LABELS[ammo] ?? ammo,
        title: AMMO_TOOLTIPS[ammo] ?? "",
        active: weapon.ammo === ammo
      }));
      const fireModeOptions = GunneryEngine.getAllowedFireModes(weapon).map(mode => ({
        id: mode,
        label: FIRE_MODE_LABELS[mode] ?? mode,
        title: FIRE_MODE_TOOLTIPS[mode] ?? "",
        active: (weapon.fireMode ?? "full") === mode
      }));
      const uiMeta = this.getWeaponUiMeta(type, minRange, maxRange);
      return {
        ...weapon,
        weaponType: type,
        weaponTypeLabel: WEAPON_TYPE_LABELS[type] ?? type,
        ammoLabel: AMMO_LABELS[weapon.ammo] ?? weapon.ammo,
        fireModeLabel: FIRE_MODE_LABELS[weapon.fireMode ?? "full"] ?? weapon.fireMode ?? "full",
        ammoOptions,
        ammoUnavailable: !ammoOptions.some(option => option.active),
        fireModeOptions,
        minRange,
        maxRange,
        minRangeMeters: minRange * HEX_SCALE_METERS,
        maxRangeMeters: maxRange * HEX_SCALE_METERS,
        rangeBandText: GunneryEngine.getRangeBandText(weapon),
        notes: profile.notes ?? "",
        optimalRange: profile.optimalRange ?? "",
        roleLabel: uiMeta.roleLabel,
        roleText: uiMeta.roleText,
        arcLabel: uiMeta.arcLabel,
        arcText: uiMeta.arcText,
        decisiveMax: uiMeta.decisiveMax,
        decisiveMaxMeters: uiMeta.decisiveMax * HEX_SCALE_METERS,
        extremeMax: uiMeta.extremeMax,
        extremeMaxMeters: uiMeta.extremeMeters
      };
    });
  }

  getWeaponUiMeta(type, minRange, maxRange) {
    const meta = HISTORICAL_GUNNERY_UI[type] ?? HISTORICAL_GUNNERY_UI.longGun;
    const extremeMax = Math.max(Number(meta.extremeMax ?? maxRange), Number(maxRange ?? 0));
    return {
      roleLabel: meta.roleLabel,
      roleText: meta.roleText,
      arcLabel: meta.arcLabel,
      arcText: meta.arcText,
      decisiveMax: Number(meta.decisiveMax ?? maxRange),
      extremeMax,
      extremeMeters: extremeMax * HEX_SCALE_METERS
    };
  }

  getRangeBandLabel(range, uiMeta) {
    if (!range || !uiMeta) return "";
    if (range <= uiMeta.decisiveMax) return "решительная дистанция";
    return "рабочая дистанция";
  }

  getAimButtons(battle = null) {
    const app = this.app;
    const selectedShip = battle?.ships?.find(s => s.id === app.selectedShipId) ?? null;
    const coreAllowed = selectedShip ? GunneryEngine.canAttackerTargetCrystalCore(battle, selectedShip) : false;
    const buttons = [
      { action: "aimAuto", label: game.i18n.localize("SAILSHIPS.AimAuto"), active: !app.aimSection },
      { action: "aimBow", label: game.i18n.localize("SAILSHIPS.AimBow"), active: app.aimSection === "bow" },
      { action: "aimMidship", label: game.i18n.localize("SAILSHIPS.AimMidship"), active: app.aimSection === "midship" },
      { action: "aimStern", label: game.i18n.localize("SAILSHIPS.AimStern"), active: app.aimSection === "stern" }
    ];
    if (MovementEngine.usesCore(battle)) {
      buttons.push({
        action: "aimCrystalCore",
        label: game.i18n.localize("SAILSHIPS.AimCrystalCore"),
        active: app.aimSection === "crystalCore",
        disabled: !coreAllowed,
        danger: true,
        title: game.i18n.localize(coreAllowed ? "SAILSHIPS.CoreAimWarning" : "SAILSHIPS.CoreAimForbidden")
      });
    }
    return buttons;
  }

  getCreatureSelectedInfo(battle, creature) {
    const speed = MovementEngine.getEffectiveMaxSpeedDetails(battle, creature);
    return {
      pointOfSail: null,
      effectiveMaxSpeed: speed.value,
      effectiveMaxSpeedTitle: speed.title,
      speedModifier: 100,
      sailingProfile: creature?.movement?.profile ?? "flier",
      sailingProfileLabel: speed.profileLabel ?? creature?.movement?.profile ?? "полет",
      maneuverAdvice: MovementEngine.getManeuverAdvice(battle, creature),
      coreAdvice: null
    };
  }

  getCreatureAttacks(battle, creature, selectedTarget = null) {
    const actionState = this.app._getActionState(battle, creature);
    return (creature?.attacks ?? []).map(attack => {
      const targets = CreatureAttackEngine.getTargets(battle, creature, attack.id);
      const selected = selectedTarget ? targets.find(entry => entry.target.id === selectedTarget.id) : targets[0];
      const preview = CreatureAttackEngine.preview(battle, creature, attack.id, selected?.target?.id ?? null);
      return {
        ...attack,
        targetName: selected?.target?.name ?? "нет цели",
        targetId: selected?.target?.id ?? null,
        rangeToTarget: selected?.range ?? null,
        skill: selected?.skill ?? null,
        hitChance: selected?.chance ?? 0,
        hitChanceLabel: selected ? `${selected.chance}%` : "—",
        typeLabel: preview?.typeLabel ?? attack.type,
        arcLabel: preview?.arcLabel ?? attack.arc,
        ready: Number(attack.cooldown ?? 0) <= 0,
        canUse: Boolean(actionState.canCreatureAttack && selected),
        cooldownLabel: Number(attack.cooldown ?? 0) > 0 ? `${attack.cooldown} р.` : "готова",
        tagsText: (attack.tags ?? []).join(", ")
      };
    });
  }

  getCreatureAbilities(battle, creature) {
    const actionState = this.app._getActionState(battle, creature);
    return (creature?.abilities ?? []).map(ability => ({
      ...ability,
      effectLabel: CreatureAbilityEngine.effectLabel(ability.effect),
      phaseLabel: ability.phase === "any" ? "любая" : ability.phase,
      cooldownLabel: Number(ability.cooldown ?? 0) > 0 ? `${ability.cooldown} р.` : "готова",
      usesLabel: Number(ability.usesMax ?? 0) > 0 ? `${ability.uses}/${ability.usesMax}` : "без лимита",
      canUse: Boolean(actionState.canCreatureAbility && CreatureAbilityEngine.canUse(battle, creature, ability, this.app.selectedTargetId)),
      tagsText: (ability.tags ?? []).join(", ")
    }));
  }

  getCreatureGrappleInfo(battle, creature) {
    const host = CreatureGrappleEngine.getHost(battle, creature);
    return {
      attached: Boolean(host),
      host,
      hostName: host?.name ?? "",
      hostId: host?.id ?? null
    };
  }

  getCreatureTargets(battle, creature) {
    return CreatureAttackEngine.getAllTargets(battle, creature).map(entry => ({
      ship: entry.target,
      arcs: [entry.attack.arc],
      arcLabels: [entry.attack.label],
      arcLabelText: entry.attack.label,
      minRange: entry.range,
      bestSkill: entry.skill,
      sectionLabel: entry.target.unitType === "creature" ? "анатомия" : "корпус",
      altitudeDelta: Math.abs(Number(creature.altitude ?? 0) - Number(entry.target.altitude ?? 0)),
      modText: `шанс ${entry.chance}%`
    }));
  }

  getAvailableTargets(battle, selectedShip) {
    const byId = new Map();
    for (const arc of GunneryEngine.getArcOrder()) {
      for (const target of this.getTargets(battle, selectedShip, arc)) {
        const current = byId.get(target.target.id) ?? { ship: target.target, arcs: [], arcLabels: [], minRange: target.range, bestSkill: target.preview?.skill ?? null, bestPreview: target.preview };
        current.arcs.push(arc);
        current.arcLabels.push(ARC_LABELS[arc] ?? arc);
        current.minRange = Math.min(current.minRange, target.range);
        if (target.preview?.skill != null && Number(target.preview.skill) > Number(current.bestSkill ?? -99)) {
          current.bestSkill = Number(target.preview.skill);
          current.bestPreview = target.preview;
        }
        current.arcLabelText = current.arcLabels.join(", ");
        current.sectionLabel = current.bestPreview?.targetSectionLabel ?? "";
        current.altitudeDelta = current.bestPreview?.altitudeDelta ?? 0;
        current.modText = current.bestPreview?.modText ?? "";
        byId.set(target.target.id, current);
      }
    }
    return [...byId.values()];
  }

  getShotPreviews(battle, selectedShip, selectedTarget) {
    if (!selectedShip || battle.phase !== "gunnery") return [];
    const actionState = this.app._getActionState(battle, selectedShip);
    const previews = [];
    for (const arc of GunneryEngine.getArcOrder()) {
      const battery = GunneryEngine.getBattery(selectedShip, arc);
      if (!battery) continue;
      const targets = this.getTargets(battle, selectedShip, arc);
      const targetInfo = selectedTarget ? targets.find(t => t.target.id === selectedTarget.id) : targets[0];
      if (!targetInfo) continue;
      const functional = GunneryEngine.isBatteryFunctional(selectedShip, battery);
      const reloading = Number(battery.reload ?? 0) > 0;
      if (reloading || !functional) continue;

      const preview = targetInfo.preview ?? GunneryEngine.getShotPreview(battle, selectedShip, targetInfo.target, battery, targetInfo.range, { aimedSection: this.app.aimSection });
      const fireAction = this.getFireAction(arc);
      const uiMeta = this.getWeaponUiMeta(GunneryEngine.getWeaponType(battery), preview.minRange, preview.maxRange);
      previews.push({
        arc,
        fireAction,
        arcLabel: ARC_LABELS[arc] ?? arc,
        battery,
        batteryLabel: battery.label ?? (ARC_LABELS[arc] ?? arc),
        targetName: targetInfo.target.name,
        range: targetInfo.range,
        minRange: preview.minRange,
        maxRange: preview.maxRange,
        weaponTypeLabel: preview.weaponTypeLabel ?? (WEAPON_TYPE_LABELS[battery.type] ?? battery.type),
        fireModeLabel: preview.fireModeLabel,
        modeText: preview.modeText,
        hasTarget: true,
        available: true,
        canFireNow: Boolean(actionState?.[this.getCanFireKey(arc)]),
        functional,
        reload: 0,
        preview,
        hitChance: Number(preview.hitChance ?? GunneryEngine.getHitProbability(preview.skill)),
        hitChanceLabel: `${Number(preview.hitChance ?? GunneryEngine.getHitProbability(preview.skill))}%`,
        tooltip: this.getShotTooltip(battery, targetInfo, preview),
        rangeTooltip: `Дистанция до цели: ${targetInfo.range} гекс. (${targetInfo.range * HEX_SCALE_METERS} м); боевая рабочая зона ${preview.minRange}-${preview.maxRange} гекс. (${preview.minRangeMeters}-${preview.maxRangeMeters} м), исторический практический предел для этого типа — до ${uiMeta.extremeMax} гекс. (${uiMeta.extremeMeters} м).`,
        chanceTooltip: preview.fireMode === "delayed" ? "Задержка залпа не требует броска сейчас: батарея готовит +2 к следующему настоящему залпу." : `Шанс рассчитан по текущему правилу 3d6: бросок должен быть не выше ${preview.skill}.`,
        effectTooltip: "Ожидаемый эффект учитывает тип орудий, боеприпас, режим залпа и надежный запас навыка.",
        rangeBandLabel: this.getRangeBandLabel(targetInfo.range, uiMeta),
        roleLabel: uiMeta.roleLabel,
        arcHintLabel: uiMeta.arcLabel
      });
    }
    return previews;
  }

  getShotPreviewEmptyText(selectedTarget) {
    if (selectedTarget) return `По цели «${selectedTarget.name}» сейчас нет готовых батарей в дугах огня.`;
    return "Нет готовых батарей с целью в дуге огня.";
  }

  getFireAction(arc) {
    return {
      port: "firePort",
      starboard: "fireStarboard",
      bow: "fireBow",
      stern: "fireStern",
      mortar: "fireMortar",
      swivel: "fireSwivel"
    }[arc] ?? "firePort";
  }

  getCanFireKey(arc) {
    return {
      port: "canFirePort",
      starboard: "canFireStarboard",
      bow: "canFireBow",
      stern: "canFireStern",
      mortar: "canFireMortar",
      swivel: "canFireSwivel"
    }[arc] ?? "canFirePort";
  }

  getShotTooltip(battery, targetInfo, preview) {
    return [
      `${battery.label}: цель ${targetInfo.target.name}.`,
      `${preview.weaponTypeLabel}: ${preview.weaponNotes || preview.modeText}.`,
      `Дистанция ${targetInfo.range} гекс. (${targetInfo.range * HEX_SCALE_METERS} м) / ${preview.minRange}-${preview.maxRange} гекс.`,
      `Навык ${preview.skill}, шанс ${preview.hitChance}%.`,
      `Секция: ${preview.targetSectionLabel}.`,
      `Модификаторы: ${preview.modText}.`
    ].join(" ");
  }
}
