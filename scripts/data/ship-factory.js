import { CURRENT_SCHEMA_VERSION, SHIP_DURABILITY_REVISION, SHIP_DURABILITY_SCALE } from "../utils/constants.js";
import { uid } from "../utils/random.js";
import { normalizeHeading } from "../board/board-geometry.js";
import { SHIP_TEMPLATES } from "./ship-templates.js";

const HISTORICAL_ARMAMENTS = {
  cutter: {
    summary: "6-10 легких 4-6-фн пушек, 2 погонных, вертлюги",
    port: { label: "Левый борт: 4-6-фн длинные пушки", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 18, guns: 4, caliber: "4-6-фн" },
    starboard: { label: "Правый борт: 4-6-фн длинные пушки", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 18, guns: 4, caliber: "4-6-фн" },
    bow: { label: "Носовые 4-фн погонные", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "4-фн" },
    stern: { label: "Кормовые 4-фн погонные", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "4-фн" },
    swivel: { damage: 2, crewRequired: 8, guns: 4, caliber: "0.5-1-фн" }
  },
  sloop: {
    summary: "10-14 пушек 6-9-фн, часть заменена карронадами",
    port: { label: "Левый борт: 6-9-фн батарея", type: "longGun", damage: 6, range: 8, reloadMax: 2, crewRequired: 28, guns: 6, caliber: "6-9-фн" },
    starboard: { label: "Правый борт: 6-9-фн батарея", type: "longGun", damage: 6, range: 8, reloadMax: 2, crewRequired: 28, guns: 6, caliber: "6-9-фн" },
    bow: { label: "Носовые 6-фн погонные", type: "chaser", damage: 3, range: 8, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" },
    stern: { label: "Кормовые 6-фн погонные", type: "chaser", damage: 3, range: 8, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" },
    swivel: { damage: 2, crewRequired: 10, guns: 6, caliber: "1-фн" }
  },
  gunboat: {
    summary: "1-2 тяжелые 18-24-фн носовые пушки, легкие борта",
    port: { label: "Левый борт: легкие 4-фн пушки", type: "longGun", damage: 3, range: 5, reloadMax: 1, crewRequired: 14, guns: 2, caliber: "4-фн" },
    starboard: { label: "Правый борт: легкие 4-фн пушки", type: "longGun", damage: 3, range: 5, reloadMax: 1, crewRequired: 14, guns: 2, caliber: "4-фн" },
    bow: { label: "Носовая 24-фн длинная пушка", type: "chaser", damage: 9, range: 12, reloadMax: 3, crewRequired: 18, guns: 1, caliber: "24-фн" },
    stern: { label: "Кормовая 6-фн ретирадная", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" }
  },
  schooner: {
    summary: "6-10 легких 6-фн пушек, сильные погонные для рейда",
    port: { label: "Левый борт: 6-фн длинные пушки", type: "longGun", damage: 4, range: 7, reloadMax: 1, crewRequired: 20, guns: 4, caliber: "6-фн" },
    starboard: { label: "Правый борт: 6-фн длинные пушки", type: "longGun", damage: 4, range: 7, reloadMax: 1, crewRequired: 20, guns: 4, caliber: "6-фн" },
    bow: { label: "Носовые 6-фн погонные", type: "chaser", damage: 4, range: 8, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "6-фн" },
    stern: { label: "Кормовые 4-фн погонные", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "4-фн" },
    swivel: { damage: 2, crewRequired: 8, guns: 4, caliber: "0.5-1-фн" }
  },
  brig: {
    summary: "14-18 пушек: 12-фн длинные или 18-фн карронады",
    port: { label: "Левый борт: 12-фн батарея брига", type: "longGun", damage: 8, range: 10, reloadMax: 2, crewRequired: 36, guns: 8, caliber: "12-фн" },
    starboard: { label: "Правый борт: 12-фн батарея брига", type: "longGun", damage: 8, range: 10, reloadMax: 2, crewRequired: 36, guns: 8, caliber: "12-фн" },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 6-фн погонные", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 2, caliber: "6-фн" },
    swivel: { damage: 3, crewRequired: 12, guns: 6, caliber: "1-фн" }
  },
  brigantine: {
    summary: "10-14 пушек 6-9-фн, торгово-рейдерский компромисс",
    port: { label: "Левый борт: 6-9-фн батарея", type: "longGun", damage: 6, range: 8, reloadMax: 2, crewRequired: 28, guns: 6, caliber: "6-9-фн" },
    starboard: { label: "Правый борт: 6-9-фн батарея", type: "longGun", damage: 6, range: 8, reloadMax: 2, crewRequired: 28, guns: 6, caliber: "6-9-фн" },
    bow: { label: "Носовые 6-фн погонные", type: "chaser", damage: 3, range: 8, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" },
    stern: { label: "Кормовые 4-фн погонные", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "4-фн" },
    swivel: { damage: 2, crewRequired: 8, guns: 4, caliber: "1-фн" }
  },
  corvette: {
    summary: "18-24 пушки 9-12-фн, иногда 18-фн карронады",
    port: { label: "Левый борт: 9-12-фн корветная батарея", type: "longGun", damage: 10, range: 10, reloadMax: 2, crewRequired: 42, guns: 10, caliber: "9-12-фн" },
    starboard: { label: "Правый борт: 9-12-фн корветная батарея", type: "longGun", damage: 10, range: 10, reloadMax: 2, crewRequired: 42, guns: 10, caliber: "9-12-фн" },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 6-фн погонные", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 2, caliber: "6-фн" },
    swivel: { damage: 3, crewRequired: 12, guns: 8, caliber: "1-фн" }
  },
  lightFrigate: {
    summary: "22-28 пушек 9-12-фн, шестой ранг",
    port: { label: "Левый борт: 12-фн легкая фрегатская батарея", type: "longGun", damage: 12, range: 10, reloadMax: 2, crewRequired: 48, guns: 12, caliber: "12-фн" },
    starboard: { label: "Правый борт: 12-фн легкая фрегатская батарея", type: "longGun", damage: 12, range: 10, reloadMax: 2, crewRequired: 48, guns: 12, caliber: "12-фн" },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 5, range: 9, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" }
  },
  frigate: {
    summary: "32-38 пушек, главная батарея 12-18-фн",
    port: { label: "Левый борт: 18-фн фрегатская батарея", type: "longGun", damage: 16, range: 12, reloadMax: 2, crewRequired: 62, guns: 18, caliber: "18-фн" },
    starboard: { label: "Правый борт: 18-фн фрегатская батарея", type: "longGun", damage: 16, range: 12, reloadMax: 2, crewRequired: 62, guns: 18, caliber: "18-фн" },
    bow: { label: "Носовые 9-12-фн погонные", type: "chaser", damage: 5, range: 10, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "9-12-фн" },
    stern: { label: "Кормовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" }
  },
  heavyFrigate: {
    summary: "44-54 пушки: 24-фн длинные и 32-фн карронады",
    port: { label: "Левый борт: 24-фн длинные + 32-фн карронады", type: "longGun", damage: 18, range: 14, reloadMax: 3, crewRequired: 82, guns: 27, caliber: "24/32-фн", closeDamageBonus: 5, closeDamageRange: 5 },
    starboard: { label: "Правый борт: 24-фн длинные + 32-фн карронады", type: "longGun", damage: 18, range: 14, reloadMax: 3, crewRequired: 82, guns: 27, caliber: "24/32-фн", closeDamageBonus: 5, closeDamageRange: 5 },
    bow: { label: "Носовая 18-фн погонная", type: "chaser", damage: 6, range: 11, reloadMax: 2, crewRequired: 12, guns: 1, caliber: "18-фн" },
    stern: { label: "Кормовые 12-фн погонные", type: "chaser", damage: 5, range: 10, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "12-фн" }
  },
  razee: {
    summary: "50-60 пушек: срезанный линейный с 24-фн нижней батареей",
    port: { label: "Левый борт: 24-фн рази-батарея", type: "longGun", damage: 26, range: 14, reloadMax: 3, crewRequired: 92, guns: 26, caliber: "24-фн" },
    starboard: { label: "Правый борт: 24-фн рази-батарея", type: "longGun", damage: 26, range: 14, reloadMax: 3, crewRequired: 92, guns: 26, caliber: "24-фн" },
    bow: { label: "Носовые 12-фн погонные", type: "chaser", damage: 6, range: 10, reloadMax: 1, crewRequired: 14, guns: 2, caliber: "12-фн" },
    stern: { label: "Кормовые 12-фн погонные", type: "chaser", damage: 5, range: 10, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "12-фн" }
  },
  shipOfLine: {
    summary: "74 пушки: 32-фн нижняя, 18-24-фн верхняя, легкие палубы",
    port: { label: "Левый борт: 74-пушечная линия", type: "longGun", damage: 34, range: 16, reloadMax: 3, crewRequired: 118, guns: 37, caliber: "32/18-фн" },
    starboard: { label: "Правый борт: 74-пушечная линия", type: "longGun", damage: 34, range: 16, reloadMax: 3, crewRequired: 118, guns: 37, caliber: "32/18-фн" },
    bow: { label: "Носовые 12-фн погонные", type: "chaser", damage: 6, range: 10, reloadMax: 1, crewRequired: 16, guns: 2, caliber: "12-фн" },
    stern: { label: "Кормовые 12-фн погонные", type: "chaser", damage: 6, range: 10, reloadMax: 1, crewRequired: 16, guns: 2, caliber: "12-фн" }
  },
  firstRate: {
    summary: "100-120 пушек: 32-фн, 24-фн, 12-фн и тяжелые карронады",
    port: { label: "Левый борт: трехдечная линия 32/24/12-фн", type: "longGun", damage: 46, range: 16, reloadMax: 3, crewRequired: 150, guns: 52, caliber: "32/24/12-фн" },
    starboard: { label: "Правый борт: трехдечная линия 32/24/12-фн", type: "longGun", damage: 46, range: 16, reloadMax: 3, crewRequired: 150, guns: 52, caliber: "32/24/12-фн" },
    bow: { label: "Носовые 12-фн погонные", type: "chaser", damage: 7, range: 10, reloadMax: 1, crewRequired: 18, guns: 2, caliber: "12-фн" },
    stern: { label: "Кормовые 12-фн ретирадные", type: "chaser", damage: 7, range: 10, reloadMax: 1, crewRequired: 18, guns: 2, caliber: "12-фн" }
  },
  bombKetch: {
    summary: "1-2 тяжелые мортиры, 6-8 пушек самообороны",
    port: { label: "Левый борт: 6-фн самооборона", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 14, guns: 3, caliber: "6-фн" },
    starboard: { label: "Правый борт: 6-фн самооборона", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 14, guns: 3, caliber: "6-фн" },
    bow: { label: "Носовая 6-фн погонная", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" },
    stern: { label: "Кормовая 6-фн ретирадная", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "6-фн" },
    mortar: { label: "Тяжелые палубные мортиры", type: "mortar", damage: 18, range: 20, reloadMax: 4, crewRequired: 24, guns: 2, caliber: "10-13-дм" }
  },
  fireship: {
    summary: "минимальные легкие пушки; главное оружие - поджог и таран",
    port: { label: "Левый борт: легкие 3-фн пушки", type: "longGun", damage: 1, range: 4, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "3-фн" },
    starboard: { label: "Правый борт: легкие 3-фн пушки", type: "longGun", damage: 1, range: 4, reloadMax: 1, crewRequired: 8, guns: 1, caliber: "3-фн" },
    bow: { label: "Носовое легкое орудие", type: "chaser", damage: 1, range: 4, reloadMax: 1, crewRequired: 4, guns: 1, caliber: "3-фн" },
    stern: { label: "Кормовое легкое орудие", type: "chaser", damage: 1, range: 4, reloadMax: 1, crewRequired: 4, guns: 1, caliber: "3-фн" }
  },
  merchant: {
    summary: "8-16 легких 6-9-фн пушек для отпугивания рейдеров",
    port: { label: "Левый борт: купеческие 6-9-фн пушки", type: "longGun", damage: 5, range: 7, reloadMax: 2, crewRequired: 24, guns: 6, caliber: "6-9-фн" },
    starboard: { label: "Правый борт: купеческие 6-9-фн пушки", type: "longGun", damage: 5, range: 7, reloadMax: 2, crewRequired: 24, guns: 6, caliber: "6-9-фн" },
    bow: { label: "Носовая 4-фн погонная", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 6, guns: 1, caliber: "4-фн" },
    stern: { label: "Кормовая 4-фн ретирадная", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 6, guns: 1, caliber: "4-фн" }
  },
  merchantBrig: {
    summary: "4-8 легких 4-6-фн пушек",
    port: { label: "Левый борт: 4-6-фн купеческие пушки", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 14, guns: 3, caliber: "4-6-фн" },
    starboard: { label: "Правый борт: 4-6-фн купеческие пушки", type: "longGun", damage: 3, range: 6, reloadMax: 1, crewRequired: 14, guns: 3, caliber: "4-6-фн" },
    bow: { label: "Носовая 4-фн погонная", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 6, guns: 1, caliber: "4-фн" },
    stern: { label: "Кормовая 4-фн ретирадная", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 6, guns: 1, caliber: "4-фн" },
    swivel: { damage: 2, crewRequired: 8, guns: 4, caliber: "0.5-1-фн" }
  },
  eastIndiaman: {
    summary: "26-36 пушек 9-12-фн; торговец, похожий на слабый военный корабль",
    port: { label: "Левый борт: 9-12-фн ост-индская батарея", type: "longGun", damage: 12, range: 9, reloadMax: 2, crewRequired: 48, guns: 16, caliber: "9-12-фн" },
    starboard: { label: "Правый борт: 9-12-фн ост-индская батарея", type: "longGun", damage: 12, range: 9, reloadMax: 2, crewRequired: 48, guns: 16, caliber: "9-12-фн" },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 6-фн ретирадные", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 2, caliber: "6-фн" }
  },
  xebec: {
    summary: "16-24 легкие 6-9-фн пушки, сильный носовой огонь рейдера",
    port: { label: "Левый борт: 6-9-фн шебечная батарея", type: "longGun", damage: 8, range: 8, reloadMax: 2, crewRequired: 34, guns: 9, caliber: "6-9-фн" },
    starboard: { label: "Правый борт: 6-9-фн шебечная батарея", type: "longGun", damage: 8, range: 8, reloadMax: 2, crewRequired: 34, guns: 9, caliber: "6-9-фн" },
    bow: { label: "Носовые 9-фн рейдерские погонные", type: "chaser", damage: 7, range: 9, reloadMax: 1, crewRequired: 16, guns: 4, caliber: "9-фн" },
    stern: { label: "Кормовые 6-фн погонные", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 2, caliber: "6-фн" },
    swivel: { damage: 3, crewRequired: 12, guns: 8, caliber: "1-фн" }
  },
  carronadeBrig: {
    summary: "14-18 пушек: 18-фн карронады, 9-фн погонные",
    port: { label: "Левый борт: 18-фн карронады брига", type: "carronade", damage: 10, range: 6, reloadMax: 1, crewRequired: 30, guns: 8, caliber: "18-фн карр." },
    starboard: { label: "Правый борт: 18-фн карронады брига", type: "carronade", damage: 10, range: 6, reloadMax: 1, crewRequired: 30, guns: 8, caliber: "18-фн карр." },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 4, range: 9, reloadMax: 1, crewRequired: 10, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 6-фн погонные", type: "chaser", damage: 3, range: 7, reloadMax: 1, crewRequired: 8, guns: 2, caliber: "6-фн" },
    swivel: { damage: 3, crewRequired: 12, guns: 6, caliber: "1-фн" }
  },
  pirateSchooner: {
    summary: "8-12 пушек: малые карронады, сильные носовые чэйзеры, вертлюги",
    port: { label: "Левый борт: 12-18-фн рейдерские карронады", type: "carronade", damage: 7, range: 5, reloadMax: 1, crewRequired: 22, guns: 4, caliber: "12-18-фн карр." },
    starboard: { label: "Правый борт: 12-18-фн рейдерские карронады", type: "carronade", damage: 7, range: 5, reloadMax: 1, crewRequired: 22, guns: 4, caliber: "12-18-фн карр." },
    bow: { label: "Носовые 6-фн охотничьи погонные", type: "chaser", damage: 5, range: 8, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "6-фн" },
    stern: { label: "Кормовая 4-фн ретирадная", type: "chaser", damage: 2, range: 6, reloadMax: 1, crewRequired: 6, guns: 1, caliber: "4-фн" },
    swivel: { damage: 3, crewRequired: 10, guns: 6, caliber: "1-фн" }
  },
  sirostienHeavyFrigate: {
    summary: "44-54 пушки: усиленные 24-фн длинные, 32-фн карронады, тяжелые чэйзеры",
    port: { label: "Левый борт: сиростьенские 24-фн + 32-фн карронады", type: "longGun", damage: 20, range: 15, reloadMax: 3, crewRequired: 90, guns: 27, caliber: "24/32-фн", closeDamageBonus: 4, closeDamageRange: 5 },
    starboard: { label: "Правый борт: сиростьенские 24-фн + 32-фн карронады", type: "longGun", damage: 20, range: 15, reloadMax: 3, crewRequired: 90, guns: 27, caliber: "24/32-фн", closeDamageBonus: 4, closeDamageRange: 5 },
    bow: { label: "Носовые 18-фн погонные", type: "chaser", damage: 7, range: 12, reloadMax: 2, crewRequired: 16, guns: 2, caliber: "18-фн" },
    stern: { label: "Кормовые 12-фн погонные", type: "chaser", damage: 5, range: 10, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "12-фн" }
  },
  oldFourthRate: {
    summary: "50-60 пушек: 18-фн нижняя, 9-12-фн верхняя, старые лафеты",
    port: { label: "Левый борт: старый 50-пушечный залп", type: "longGun", damage: 22, range: 12, reloadMax: 3, crewRequired: 85, guns: 25, caliber: "18/9-фн" },
    starboard: { label: "Правый борт: старый 50-пушечный залп", type: "longGun", damage: 22, range: 12, reloadMax: 3, crewRequired: 85, guns: 25, caliber: "18/9-фн" },
    bow: { label: "Носовые 9-фн погонные", type: "chaser", damage: 5, range: 9, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "9-фн" },
    stern: { label: "Кормовые 9-фн ретирадные", type: "chaser", damage: 5, range: 9, reloadMax: 1, crewRequired: 12, guns: 2, caliber: "9-фн" }
  }
};

export function getTemplateArmamentSummary(templateKey) {
  return HISTORICAL_ARMAMENTS[templateKey]?.summary ?? "исторически близкая батарея эпохи паруса";
}

function section(id, hp, dr, systems) {
  const pacedHp = Math.max(1, Math.round(Number(hp ?? 1) * SHIP_DURABILITY_SCALE));
  return {
    id,
    hp: { value: pacedHp, max: pacedHp },
    dr,
    fire: 0,
    flooding: 0,
    breaches: 0,
    mastWreckage: 0,
    systems: systems.map((name, index) => ({
      slot: index + 1,
      name,
      status: "intact",
      hp: { value: 6, max: 6 }
    }))
  };
}

function battery(id, label, arc, damage, range = 10, reloadMax = 2, type = null, ammo = "roundShot", options = {}) {
  const resolvedType = type ?? (arc === "bow" || arc === "stern" ? "chaser" : "longGun");
  return {
    id,
    label,
    arc,
    type: resolvedType,
    damage,
    range,
    reload: 0,
    reloadMax,
    crewRequired: options.crewRequired ?? (arc === "port" || arc === "starboard" ? 24 : arc === "mortar" ? 16 : 8),
    ammo,
    fireMode: "full",
    delayed: false,
    rangingTargetId: null,
    guns: options.guns ?? null,
    caliber: options.caliber ?? null,
    historicalNote: options.historicalNote ?? null,
    closeDamageBonus: options.closeDamageBonus ?? 0,
    closeDamageRange: options.closeDamageRange ?? 0,
    armamentRevision: 1,
    rangeRevision: 3
  };
}

function batteryFromSpec(id, fallbackLabel, arc, spec, fallbackDamage, fallbackRange, fallbackReloadMax, fallbackType, fallbackAmmo) {
  return battery(
    id,
    spec?.label ?? fallbackLabel,
    arc,
    spec?.damage ?? fallbackDamage,
    spec?.range ?? fallbackRange,
    spec?.reloadMax ?? fallbackReloadMax,
    spec?.type ?? fallbackType,
    spec?.ammo ?? fallbackAmmo,
    {
      guns: spec?.guns,
      caliber: spec?.caliber,
      historicalNote: spec?.historicalNote,
      crewRequired: spec?.crewRequired,
      closeDamageBonus: spec?.closeDamageBonus,
      closeDamageRange: spec?.closeDamageRange
    }
  );
}

function buildWeapons(t, template) {
  const armament = HISTORICAL_ARMAMENTS[template];
  if (armament) {
    const weapons = [
      batteryFromSpec("port", "Левый борт", "port", armament.port, t.broadsideDamage, 8, 2, "longGun", "roundShot"),
      batteryFromSpec("starboard", "Правый борт", "starboard", armament.starboard, t.broadsideDamage, 8, 2, "longGun", "roundShot"),
      batteryFromSpec("bow", "Носовые чэйзеры", "bow", armament.bow, t.chaserDamage, 10, 1, "chaser", "roundShot"),
      batteryFromSpec("stern", "Кормовые чэйзеры", "stern", armament.stern, t.chaserDamage, 10, 1, "chaser", "roundShot")
    ];
    if (armament.mortar) {
      weapons.push(batteryFromSpec("mortar", "Палубные мортиры", "mortar", armament.mortar, Math.max(10, Math.ceil(Number(t.broadsideDamage ?? 10) * 0.9)), 20, 4, "mortar", "shellBomb"));
    }
    if (armament.swivel) {
      weapons.push(batteryFromSpec("swivel", "Поворотные пушки", "swivel", armament.swivel, Math.max(2, Math.ceil(Number(t.chaserDamage ?? 4) / 2)), 2, 1, "swivel", "grapeShot"));
    }
    return weapons;
  }

  const heavy = Number(t.sm ?? 6) >= 8;
  const small = Number(t.sm ?? 6) <= 5;
  const broadsideType = t.sailProfile === "bomb" || small ? "carronade" : "longGun";
  const broadsideRange = broadsideType === "carronade" ? 4 : 8;
  const weapons = [
    battery("port", "Левый борт", "port", t.broadsideDamage, broadsideRange, broadsideType === "carronade" ? 1 : 2, broadsideType),
    battery("starboard", "Правый борт", "starboard", t.broadsideDamage, broadsideRange, broadsideType === "carronade" ? 1 : 2, broadsideType),
    battery("bow", "Носовые чэйзеры", "bow", t.chaserDamage, 10, 1, "chaser"),
    battery("stern", "Кормовые чэйзеры", "stern", t.chaserDamage, 10, 1, "chaser")
  ];
  if (t.sailProfile === "bomb" || template === "bombKetch") {
    weapons.push(battery("mortar", "Палубные мортиры", "mortar", Math.max(10, Math.ceil(Number(t.broadsideDamage ?? 10) * 0.9)), 16, 3, "mortar", "shellBomb"));
  }
  if (!heavy) weapons.push(battery("swivel", "Поворотные пушки", "swivel", Math.max(2, Math.ceil(Number(t.chaserDamage ?? 4) / 2)), 2, 1, "swivel", "grapeShot"));
  return weapons;
}

export function createShip({ id, name, side, x, y, heading, template = "frigate" }) {
  const t = SHIP_TEMPLATES[template] ?? SHIP_TEMPLATES.frigate;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    unitType: "ship",
    durabilityRevision: SHIP_DURABILITY_REVISION,
    id: id ?? uid("ship"),
    name: name ?? `${t.label} ${id ?? ""}`.trim(),
    template,
    side,
    x,
    y,
    heading: normalizeHeading(heading ?? 120),
    speed: Math.min(2, t.maxSpeed),
    maxSpeed: t.maxSpeed,
    sailing: {
      profile: t.sailProfile ?? "square"
    },
    altitude: t.defaultAltitude ?? 3,
    crystal: {
      enabled: true,
      heat: 0,
      maxHeat: 10,
      integrity: t.crystalIntegrity ?? 16,
      maxIntegrity: t.crystalIntegrity ?? 16,
      armor: t.crystalArmor ?? 9,
      armorRevision: 2,
      location: "stern",
      honorProtected: true
    },
    selectedOrder: null,
    stats: {
      sm: t.sm,
      ht: t.ht,
      handling: t.handling,
      stability: t.stability,
      crewQuality: 0
    },
    crew: {
      current: t.crew,
      required: t.crew,
      casualties: 0,
      rescued: 0,
      morale: 10
    },
    sections: {
      bow: section("bow", t.bowHp, t.bowDr, [
        "Бушприт",
        "Носовые чэйзеры",
        "Фок-мачта",
        "Передний трюм",
        "Носовые помпы",
        "Форштевень"
      ]),
      midship: section("midship", t.midHp, t.midDr, [
        "Главная батарея",
        "Грот-мачта",
        "Пороховой погреб",
        "Главный трюм",
        "Помповая команда",
        "Камбуз"
      ]),
      stern: section("stern", t.sternHp, t.sternDr, [
        "Руль",
        "Штурвал",
        "Бизань-мачта",
        "Кормовые чэйзеры",
        "Каюты офицеров",
        "Бронекапсула ядра кристалла"
      ])
    },
    weapons: buildWeapons(t, template),
    flags: {
      inIrons: false,
      inIronsAttempts: 0,
      grappledWith: null,
      struck: false,
      falling: false,
      coreExploded: false,
      immobilized: false,
      uncontrolledFire: false,
      abandoned: false,
      withdrawn: false,
      withdrawnRound: null,
      rescueResolved: false,
      mastWreckage: 0
    }
  };
}
