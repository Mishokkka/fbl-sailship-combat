export const BOARD_PRESETS = {
  skirmish: {
    id: "skirmish",
    label: "Стычка",
    description: "24×16. Быстрый бой на 2-4 корабля.",
    width: 24,
    height: 16,
    cellSize: 48
  },
  squadron: {
    id: "squadron",
    label: "Эскадра",
    description: "36×24. Нормальное поле для 4-8 кораблей.",
    width: 36,
    height: 24,
    cellSize: 44
  },
  openSky: {
    id: "openSky",
    label: "Открытое небо",
    description: "48×32. Простор для дальнего сближения и маневра.",
    width: 48,
    height: 32,
    cellSize: 40
  },
  chart: {
    id: "chart",
    label: "Большая карта",
    description: "48×48. Для сценариев с островами, рифами и обходами.",
    width: 48,
    height: 48,
    cellSize: 40
  }
};

export const ENVIRONMENT_PRESETS = {
  clearSea: {
    id: "clearSea",
    label: "Ясное море",
    description: "Умеренный юго-западный ветер, спокойное море, ясная видимость.",
    wind: { direction: 240, strength: "moderate" },
    sea: { state: "calm", visibility: "clear" }
  },
  airClear: {
    id: "airClear",
    label: "Чистый воздух",
    description: "Слабый северо-западный ветер и ясная видимость для воздушного боя.",
    wind: { direction: 300, strength: "light" },
    sea: { state: "calm", visibility: "clear" }
  },
  harbor: {
    id: "harbor",
    label: "Гавань",
    description: "Слабый ветер, дымка, спокойная вода и плотный террейн.",
    wind: { direction: 180, strength: "light" },
    sea: { state: "calm", visibility: "haze" }
  },
  storm: {
    id: "storm",
    label: "Шторм",
    description: "Сильный ветер, бурное море и плохая видимость.",
    wind: { direction: 300, strength: "strong" },
    sea: { state: "rough", visibility: "fog" }
  }
};

const DEFAULT_SIDES = {
  blue: {
    id: "blue",
    name: "Синяя сторона",
    color: "#5d91c7",
    zoneSpec: { x1: 0.04, y1: 0.18, x2: 0.22, y2: 0.82, heading: 120 }
  },
  red: {
    id: "red",
    name: "Красная сторона",
    color: "#c75d5d",
    zoneSpec: { x1: 0.78, y1: 0.18, x2: 0.96, y2: 0.82, heading: 300 }
  }
};

export const SCENARIO_PRESETS = {
  openDuel: {
    id: "openDuel",
    label: "Открытое сближение",
    description: "Чистое поле с легкими случайными помехами. Две стороны стоят друг напротив друга.",
    boardPreset: "skirmish",
    environmentPreset: "clearSea",
    mode: "sea",
    terrainGenerator: "openDuel",
    victory: { mode: "decision", roundLimit: 30, decisionMargin: 0.15 },
    sides: DEFAULT_SIDES
  },
  airDuel: {
    id: "airDuel",
    label: "Воздушная дуэль",
    description: "Воздушное поле с дымовыми/облачными полосами. Корабли стартуют на высоте 3.",
    boardPreset: "squadron",
    environmentPreset: "airClear",
    mode: "air",
    terrainGenerator: "airDuel",
    victory: { mode: "decision", roundLimit: 30, decisionMargin: 0.15 },
    sides: {
      blue: { ...DEFAULT_SIDES.blue, zoneSpec: { x1: 0.04, y1: 0.24, x2: 0.22, y2: 0.76, heading: 120 } },
      red: { ...DEFAULT_SIDES.red, zoneSpec: { x1: 0.78, y1: 0.24, x2: 0.96, y2: 0.76, heading: 300 } }
    }
  },

  skyArchipelago: {
    id: "skyArchipelago",
    label: "Воздушный архипелаг",
    description: "Воздушное поле с каменными островками, глыбами и облачными полосами. Генерируется под любой размер поля.",
    boardPreset: "openSky",
    environmentPreset: "airClear",
    mode: "air",
    terrainGenerator: "skyArchipelago",
    victory: { mode: "decision", roundLimit: 30, decisionMargin: 0.15 },
    sides: {
      blue: { ...DEFAULT_SIDES.blue, zoneSpec: { x1: 0.04, y1: 0.24, x2: 0.22, y2: 0.76, heading: 120 } },
      red: { ...DEFAULT_SIDES.red, zoneSpec: { x1: 0.78, y1: 0.24, x2: 0.96, y2: 0.76, heading: 300 } }
    }
  },
  harborBreakout: {
    id: "harborBreakout",
    label: "Выход из гавани",
    description: "Генерирует гавань с естественным проходом, скалами, дымом и обломками.",
    boardPreset: "squadron",
    environmentPreset: "harbor",
    mode: "mixed",
    terrainGenerator: "harborBreakout",
    victory: { mode: "escape", roundLimit: 30, objectiveSideId: "blue", exitEdge: "right", requiredShips: 1 },
    sides: {
      blue: { ...DEFAULT_SIDES.blue, name: "Прорывающиеся", zoneSpec: { x1: 0.04, y1: 0.38, x2: 0.20, y2: 0.66, heading: 120 } },
      red: { ...DEFAULT_SIDES.red, name: "Блокада", zoneSpec: { x1: 0.72, y1: 0.22, x2: 0.96, y2: 0.78, heading: 300 } }
    }
  },
  reefChase: {
    id: "reefChase",
    label: "Рифовая погоня",
    description: "Генерирует извилистые рифовые пояса и мели. На высоте можно срезать путь.",
    boardPreset: "chart",
    environmentPreset: "clearSea",
    mode: "mixed",
    terrainGenerator: "reefChase",
    victory: { mode: "escape", roundLimit: 30, objectiveSideId: "red", exitEdge: "left", requiredShips: 1 },
    sides: {
      blue: { ...DEFAULT_SIDES.blue, name: "Погоня", zoneSpec: { x1: 0.04, y1: 0.38, x2: 0.18, y2: 0.66, heading: 120 } },
      red: { ...DEFAULT_SIDES.red, name: "Беглецы", zoneSpec: { x1: 0.78, y1: 0.30, x2: 0.96, y2: 0.62, heading: 300 } }
    }
  },
  stormContact: {
    id: "stormContact",
    label: "Контакт в шторме",
    description: "Генерирует рваные зоны дыма, обломки и случайные водные опасности.",
    boardPreset: "squadron",
    environmentPreset: "storm",
    mode: "sea",
    terrainGenerator: "stormContact",
    victory: { mode: "decision", roundLimit: 30, decisionMargin: 0.15 },
    sides: DEFAULT_SIDES
  }
};
