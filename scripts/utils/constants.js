export const MODULE_ID = "sailships-combat";
export const SETTING_BATTLE = "activeBattle";
export const SETTING_SAVED_BATTLES = "savedBattles";
export const SETTING_SHIP_LIBRARY = "shipLibrary";
export const SETTING_CREATURE_LIBRARY = "creatureLibrary";
export const SETTING_BATTLE_SCENARIOS = "battleScenarios";
export const SETTING_SOUND_PROFILE = "soundProfile";
export const SOCKET_NAME = `module.${MODULE_ID}`;
export const SOCKET_PROTOCOL_VERSION = 3;
export const SOCKET_MAX_PAYLOAD_BYTES = 4096;
export const SOCKET_UPDATE_SCOPES = Object.freeze(["battle", "library", "creatureLibrary", "scenarios", "snapshots"]);
export const CURRENT_SCHEMA_VERSION = 13;
export const COMBATANT_TYPES = Object.freeze(["ship", "creature"]);
export const COMBATANT_TYPE_LABELS = Object.freeze({ ship: "Корабль", creature: "Летающее существо" });
export const HEX_SCALE_METERS = 50;
export const ROUND_DURATION_SECONDS = 60;
export const ALTITUDE_MIN = 0;
export const ALTITUDE_MAX = 8;
export const ALTITUDE_BAND_METERS = 50;
export const CRYSTAL_BLAST_RADIUS_HEXES = 2;
export const SHIP_DURABILITY_SCALE = 0.5;
export const SHIP_DURABILITY_REVISION = 2;
export const WEAPON_DAMAGE_MULTIPLIER = 2.5;
export const STRIKE_HP_RATIO = 0.25;
export const BOARD_LIMITS = Object.freeze({
  minWidth: 8,
  maxWidth: 80,
  defaultWidth: 24,
  minHeight: 8,
  maxHeight: 80,
  defaultHeight: 16,
  minCellSize: 32,
  maxCellSize: 80,
  defaultCellSize: 48
});

export const SHIPYARD_PARTIAL_TEMPLATES = [
  "modules/sailships-combat/templates/shipyard/parts/shipyard-header.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-battle-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-templates-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-bestiary-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-library-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-creature-library-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-editor-tab.hbs",
  "modules/sailships-combat/templates/shipyard/parts/shipyard-creature-editor.hbs"
];

export const NAVAL_RIGHT_PARTIAL_TEMPLATES = [
  "modules/sailships-combat/templates/naval/parts/right/naval-turn-box.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-player-control-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-orders-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-movement-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-creature-movement-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-gunnery-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-creature-attacks-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-creature-abilities-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-crew-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-creature-recovery-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-creature-damage-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-damage-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-setup-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-storage-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-targets-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-sections-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/right/naval-weapons-panel.hbs"
];

export const BATTLE_SETUP_PARTIAL_TEMPLATES = [
  "modules/sailships-combat/templates/setup/parts/battle-setup-header.hbs",
  "modules/sailships-combat/templates/setup/parts/battle-setup-presets.hbs",
  "modules/sailships-combat/templates/setup/parts/battle-setup-sides.hbs",
  "modules/sailships-combat/templates/setup/parts/battle-setup-scenarios.hbs",
  "modules/sailships-combat/templates/setup/parts/battle-setup-preview.hbs",
  "modules/sailships-combat/templates/setup/parts/battle-setup-danger.hbs"
];

export const NAVAL_PARTIAL_TEMPLATES = [
  "modules/sailships-combat/templates/naval/parts/naval-navigation.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-left-panel.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-board-part.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-board.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-selected-summary.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-creature-summary.hbs",
  "modules/sailships-combat/templates/naval/parts/naval-right-panel.hbs",
  ...NAVAL_RIGHT_PARTIAL_TEMPLATES
];

export const APP_PARTIAL_TEMPLATES = [
  ...SHIPYARD_PARTIAL_TEMPLATES,
  ...NAVAL_PARTIAL_TEMPLATES,
  ...BATTLE_SETUP_PARTIAL_TEMPLATES
];

export const PHASES = [
  "orders",
  "movement",
  "gunnery",
  "damage",
  "crew",
  "end"
];

export const WIND_STRENGTH_SEQUENCE = ["calm", "light", "moderate", "strong", "storm"];
export const WIND_STRENGTH_RATINGS = {
  calm: 1,
  light: 2,
  moderate: 3,
  strong: 4,
  storm: 5
};
export const SEA_STATE_SEQUENCE = ["calm", "choppy", "rough", "storm"];
export const VISIBILITY_SEQUENCE = ["clear", "haze", "fog", "night"];
export const BATTLE_MODE_SEQUENCE = ["sea", "air", "mixed"];
export const BATTLE_MODE_LABELS = {
  sea: "морской",
  air: "воздушный",
  mixed: "смешанный"
};
export const BATTLE_MODE_TOOLTIPS = {
  sea: "Морской бой: высота, падение и кристаллическое ядро не используются; поле состоит из воды и морского террейна.",
  air: "Воздушный бой: корабли начинают выше воды, работает высота и кристаллическое ядро; морские рифы, мели и обломки скрываются из поля.",
  mixed: "Смешанный бой: вокруг островов есть вода, высота и кристаллическое ядро работают вместе с морским террейном."
};

export const PHASE_LABELS = {
  orders: "Приказы",
  movement: "Маневр",
  gunnery: "Стрельба",
  damage: "Повреждения",
  crew: "Экипаж",
  end: "Конец раунда"
};

export const HEADING_LABELS = {
  0: "С",
  60: "СВ",
  120: "ЮВ",
  180: "Ю",
  240: "ЮЗ",
  300: "СЗ",
  90: "В",
  270: "З"
};

export const SECTION_LABELS = {
  bow: "Нос",
  midship: "Центр",
  stern: "Корма",
  crystalCore: "Ядро кристалла"
};

export const ARC_LABELS = {
  port: "левый борт",
  starboard: "правый борт",
  bow: "нос",
  stern: "корма",
  mortar: "мортиры",
  swivel: "поворотные"
};

export const AMMO_LABELS = {
  roundShot: "ядра",
  chainShot: "книппели",
  grapeShot: "картечь",
  heatedShot: "каленые ядра",
  shellBomb: "бомбы"
};

export const AMMO_TOOLTIPS = {
  roundShot: "Обычные ядра. Базовый выбор для пробития корпуса, секций и систем корабля. Лучше всего работают на короткой и средней дистанции.",
  chainShot: "Книппели. Два ядра или половины ядра на цепи/штанге. Хуже пробивают корпус, зато рвут мачты, реи, снасти и паруса. Нужны, чтобы остановить или замедлить цель.",
  grapeShot: "Картечь. Ближняя противопалубная стрельба по экипажу и морали. Быстро теряет смысл с дистанцией; против корпуса почти бесполезна.",
  heatedShot: "Каленые ядра. Раскаленные ядра с повышенным шансом пожара у цели. Опасны для стрелка: возможен пожар на собственной батарее.",
  shellBomb: "Бомбы. Мортирные взрывные снаряды навесной траектории. Не для упора: дают пожар, потери экипажа и риск погреба, но требуют дистанции."
};

export const WEAPON_TYPE_LABELS = {
  longGun: "длинные пушки",
  carronade: "карронады",
  chaser: "чэйзеры",
  mortar: "мортиры",
  swivel: "поворотные пушки"
};

export const FIRE_MODE_LABELS = {
  full: "полный залп",
  partial: "частичный залп",
  ranging: "пристрелка",
  delayed: "задержать залп"
};

export const FIRE_MODE_TOOLTIPS = {
  full: "Полный залп. Максимальный урон батареи и обычная перезарядка. Выбор по умолчанию, когда цель уже в хорошей дистанции и дуге.",
  partial: "Частичный залп. Стреляет часть батареи: +1 к попаданию, меньше урон, короче перезарядка. Нужен для экономного боя, пристрелки без потери темпа или добивания.",
  ranging: "Пристрелка. +2 к попаданию, половинный урон. Если цель та же, следующий настоящий залп получает +1. Нужна на дальней дистанции или перед решающим залпом.",
  delayed: "Задержать залп. Батарея не стреляет сейчас, а удерживает огонь. Следующий настоящий залп получает +2. Нужна, чтобы подпустить цель ближе или поймать лучший угол."
};

export const SEA_ONLY_TERRAIN_TYPES = Object.freeze(["reef", "shoal", "wreck"]);
export const AIR_ONLY_TERRAIN_TYPES = Object.freeze(["cloud", "stormCloud", "updraft", "downdraft", "turbulence", "skyIsland"]);
export const TERRAIN_TYPES = Object.freeze([...SEA_ONLY_TERRAIN_TYPES, "smoke", "rockHigh", "rockLow", ...AIR_ONLY_TERRAIN_TYPES]);

export const TERRAIN_LABELS = {
  reef: "риф",
  shoal: "мель",
  smoke: "дым",
  wreck: "обломки",
  rockHigh: "высокие скалы",
  rockLow: "низкие скалы",
  cloud: "облако",
  stormCloud: "грозовое облако",
  updraft: "восходящий поток",
  downdraft: "нисходящий поток",
  turbulence: "турбулентность",
  skyIsland: "летающий остров"
};

export const TERRAIN_DESCRIPTIONS = {
  reef: "Подводные камни: опасны для кораблей у поверхности.",
  shoal: "Мелководье: ограничивает безопасный проход крупных кораблей.",
  smoke: "Дымовая завеса: ухудшает наблюдение и ведение огня.",
  wreck: "Обломки кораблей: затрудняют проход у поверхности.",
  rockHigh: "Высокие скалы: непроходимая преграда на нижних высотах.",
  rockLow: "Низкие скалы: опасны для низко летящих кораблей.",
  cloud: "Облачность: скрывает корабли и ухудшает видимость.",
  stormCloud: "Грозовое облако: опасная зона с плохой видимостью.",
  updraft: "Восходящий поток: воздействует на вертикальный манёвр.",
  downdraft: "Нисходящий поток: тянет корабль к нижним высотам.",
  turbulence: "Турбулентность: осложняет устойчивый полёт и прицеливание.",
  skyIsland: "Летающий остров: твёрдая непроходимая преграда в воздухе."
};

export const TERRAIN_ICONS = {
  reef: "◆",
  shoal: "≈",
  smoke: "☁",
  wreck: "✕",
  rockHigh: "▲",
  rockLow: "▴",
  cloud: "☁",
  stormCloud: "⚡",
  updraft: "↑",
  downdraft: "↓",
  turbulence: "≋",
  skyIsland: "⬟"
};

export const ORDER_LABELS = {
  battleSail: "Боевой ход",
  pressSail: "Гнать ход",
  steadyGunnery: "Готовить залп",
  damageControl: "Аварийные партии",
  boarding: "К абордажу",
  brace: "Принять удар"
};

export const ORDER_IDS = Object.freeze(Object.keys(ORDER_LABELS));


export const ORDER_TOOLTIPS = {
  battleSail: "Боевой ход — базовый сбалансированный приказ. Численно: без штрафов и бонусов; маневр 2 ОД, стрельба и экипаж по базовым правилам.",
  pressSail: "Гнать ход — максимум парусов и скорости. Численно: макс. ход +1, в фазе маневра +1 ОД и +2 к инициативе; к стрельбе -1.",
  steadyGunnery: "Готовить залп — корабль работает на батареи. Численно: макс. ход -1, к стрельбе +1 и +2 к инициативе в фазе стрельбы.",
  damageControl: "Аварийные партии — борьба за живучесть. Численно: макс. ход -1, в фазе маневра -1 ОД, в фазе экипажа +1 ОД и +2 к инициативе; обычный ремонт 2 вместо 1, ремонт системы 4 вместо 2, к стрельбе -1.",
  boarding: "К абордажу — подготовка к сцепке и рукопашной. Численно: макс. ход -1, в фазе маневра -1 ОД, в фазе экипажа +1 ОД и +1 к инициативе; сила абордажа +2, к стрельбе -1.",
  brace: "Принять удар — команда готовится пережить попадание. Численно: макс. ход -1, в фазе маневра -1 ОД; входящий урон после DR -2, сила абордажа +1, к стрельбе -1."
};

export const STATUS_LABELS = {
  intact: "цела",
  damaged: "повреждена",
  destroyed: "уничтожена",
  disabled: "выведена",
  falling: "падает",
  exploded: "взорвалась"
};

export const WIND_STRENGTH_LABELS = {
  calm: "штиль",
  light: "слабый",
  moderate: "умеренный",
  strong: "сильный",
  storm: "штормовой"
};

export const SEA_STATE_LABELS = {
  calm: "спокойное",
  choppy: "волнение",
  rough: "бурное",
  storm: "шторм"
};

export const VISIBILITY_LABELS = {
  clear: "ясно",
  haze: "дымка",
  fog: "туман",
  night: "ночь"
};


export const SAILING_PROFILE_LABELS = {
  foreAft: "косое",
  mixed: "смешанное",
  square: "прямое",
  heavySquare: "тяжелое прямое",
  lateen: "латинское",
  bomb: "кеч/платформа"
};

export const POINT_OF_SAIL_LABELS = {
  inIrons: "против ветра",
  closeHauled: "бейдевинд",
  beamReach: "галфвинд",
  broadReach: "бакштаг",
  running: "фордевинд"
};
