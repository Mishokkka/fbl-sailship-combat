import { CURRENT_SCHEMA_VERSION } from "../utils/constants.js";
import { uid } from "../utils/random.js";
import { createShip } from "./ship-factory.js";

export function createDefaultBattle() {
  const now = new Date().toISOString();
  const courier = createShip({ id: "ship-blue", name: "Курьер Люмен", side: "blue", x: 6, y: 9, heading: 120, template: "brigantine" });
  const raider = createShip({ id: "ship-red", name: "Шхуна Коса", side: "red", x: 22, y: 8, heading: 300, template: "pirateSchooner" });
  courier.altitude = 4;
  raider.altitude = 4;
  courier.speed = 2;
  raider.speed = 2;
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: uid("battle"),
    name: "Небесная погоня у Серебряной гряды",
    created: now,
    updated: now,
    round: 1,
    phase: "orders",
    setupConfirmed: false,
    board: {
      width: 30,
      height: 18,
      cellSize: 48,
      terrainRevision: 1,
      terrain: {
        "9,5": ["rockLow"],
        "10,5": ["rockLow"],
        "11,6": ["rockHigh"],
        "12,6": ["rockLow"],
        "12,8": ["smoke"],
        "13,7": ["rockLow"],
        "14,7": ["rockHigh"],
        "15,8": ["rockLow"],
        "15,6": ["rockLow"],
        "16,6": ["rockHigh"],
        "17,7": ["rockLow"],
        "18,6": ["rockLow"],
        "18,8": ["rockLow"],
        "19,8": ["rockHigh"],
        "20,9": ["rockLow"],
        "13,10": ["smoke"],
        "14,10": ["smoke"],
        "15,10": ["smoke"],
        "16,9": ["smoke"],
        "17,10": ["smoke"],
        "18,10": ["smoke"],
        "20,12": ["rockLow"],
        "21,12": ["rockHigh"],
        "22,13": ["rockLow"],
        "24,5": ["rockLow"],
        "25,5": ["rockHigh"],
        "26,6": ["rockLow"]
      }
    },
    wind: {
      direction: 300,
      strength: "moderate"
    },
    sea: {
      state: "calm",
      visibility: "clear"
    },
    setup: {
      scenarioName: "Небесная погоня у Серебряной гряды",
      mode: "air",
      terrainGenerator: "skyArchipelago",
      terrainSeed: null
    },
    turn: {
      activeShipId: "ship-blue",
      actions: {},
      phaseOrder: {
        orders: ["ship-blue", "ship-red"]
      },
      initiative: {
        orders: {
          "ship-blue": 0,
          "ship-red": 0
        }
      },
      completed: {
        orders: [],
        movement: [],
        gunnery: [],
        damage: [],
        crew: [],
        end: []
      }
    },
    playerAssignments: {},
    pendingOrders: {},
    playerVisibility: { contacts: {}, observations: {} },
    ships: [
      courier,
      raider
    ],
    log: [
      {
        id: uid("log"),
        round: 1,
        phase: "orders",
        text: "Демо-сюжет: курьер Люмен идет над Серебряной грядой, а пиратская шхуна Коса пытается перехватить его до облачной полосы.",
        ts: now
      }
    ]
  };
}
