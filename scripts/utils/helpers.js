import {
  AMMO_LABELS,
  ARC_LABELS,
  HEADING_LABELS,
  PHASE_LABELS,
  POINT_OF_SAIL_LABELS,
  SAILING_PROFILE_LABELS,
  ORDER_LABELS,
  ORDER_TOOLTIPS,
  SEA_STATE_LABELS,
  SECTION_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
  WIND_STRENGTH_LABELS,
  WIND_STRENGTH_RATINGS,
  TERRAIN_LABELS,
  WEAPON_TYPE_LABELS,
  FIRE_MODE_LABELS
} from "./constants.js";

export function registerHandlebarsHelpers() {
  Handlebars.registerHelper("sscPhase", phase => PHASE_LABELS[phase] ?? phase);
  Handlebars.registerHelper("sscHeading", heading => HEADING_LABELS[Number(heading)] ?? `${heading}°`);
  Handlebars.registerHelper("sscSection", section => SECTION_LABELS[section] ?? section);
  Handlebars.registerHelper("sscArc", arc => ARC_LABELS[arc] ?? arc);
  Handlebars.registerHelper("sscAmmo", ammo => AMMO_LABELS[ammo] ?? ammo);
  Handlebars.registerHelper("sscWeaponType", type => WEAPON_TYPE_LABELS[type] ?? type ?? "—");
  Handlebars.registerHelper("sscFireMode", mode => FIRE_MODE_LABELS[mode] ?? mode ?? "—");
  Handlebars.registerHelper("sscOrder", order => ORDER_LABELS[order] ?? "нет");
  Handlebars.registerHelper("sscOrderTooltip", order => ORDER_TOOLTIPS[order] ?? "");
  Handlebars.registerHelper("sscStatus", status => STATUS_LABELS[status] ?? status);
  Handlebars.registerHelper("sscWindStrength", strength => `Б${WIND_STRENGTH_RATINGS[strength] ?? "?"}`);
  Handlebars.registerHelper("sscWindStrengthTitle", strength => `${WIND_STRENGTH_LABELS[strength] ?? strength}: ${WIND_STRENGTH_RATINGS[strength] ?? "?"}/5`);
  Handlebars.registerHelper("sscSeaState", state => SEA_STATE_LABELS[state] ?? state);
  Handlebars.registerHelper("sscVisibility", visibility => VISIBILITY_LABELS[visibility] ?? visibility);
  Handlebars.registerHelper("sscPointOfSail", point => POINT_OF_SAIL_LABELS[point] ?? point);
  Handlebars.registerHelper("sscSailingProfile", profile => SAILING_PROFILE_LABELS[profile] ?? profile ?? "—");
  Handlebars.registerHelper("sscTerrain", terrain => TERRAIN_LABELS[terrain] ?? terrain ?? "—");
  Handlebars.registerHelper("sscPercent", (value, max) => {
    value = Number(value ?? 0);
    max = Number(max ?? 1);
    if (!max) return 0;
    return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  });
  Handlebars.registerHelper("sscEq", (a, b) => a === b);
  Handlebars.registerHelper("sscJson", value => JSON.stringify(value));
  Handlebars.registerHelper("sscSign", value => Number(value) >= 0 ? `+${value}` : `${value}`);
}
