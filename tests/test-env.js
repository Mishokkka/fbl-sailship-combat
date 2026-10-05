import { webcrypto } from "node:crypto";

let idCounter = 0;

export function deepClone(value) {
  return value == null ? value : structuredClone(value);
}

export function resetIds() {
  idCounter = 0;
}

export function nextId(prefix = "test") {
  idCounter += 1;
  return `${prefix}-${String(idCounter).padStart(4, "0")}`;
}

class MockJournalEntry {
  constructor(data, collection) {
    this.id = data._id ?? nextId("journal");
    this.name = data.name ?? this.id;
    this.ownership = deepClone(data.ownership ?? { default: 0 });
    this.flags = deepClone(data.flags ?? {});
    this.collection = collection;
  }

  getFlag(moduleId, key) {
    return this.flags?.[moduleId]?.[key];
  }

  async update(changes) {
    for (const [path, value] of Object.entries(changes ?? {})) {
      if (path === "ownership") this.ownership = deepClone(value);
      else if (path === "name") this.name = value;
      else if (path.startsWith("flags.")) {
        const [, moduleId, key] = path.split(".");
        this.flags[moduleId] ??= {};
        this.flags[moduleId][key] = deepClone(value);
      } else {
        this[path] = deepClone(value);
      }
    }
    return this;
  }
}

class MockJournalCollection {
  constructor() {
    this.contents = [];
  }

  get(id) {
    return this.contents.find(entry => entry.id === id) ?? null;
  }

  values() {
    return this.contents.values();
  }

  add(entry) {
    this.contents.push(entry);
    return entry;
  }
}

function createUsers(users) {
  const contents = users.map(user => ({ active: true, isGM: false, ...user }));
  return {
    contents,
    get(id) {
      return contents.find(user => user.id === id) ?? null;
    },
    [Symbol.iterator]() {
      return contents[Symbol.iterator]();
    }
  };
}

export function installTestEnvironment({
  users = [
    { id: "gm-a", name: "GM A", isGM: true, active: true },
    { id: "player-a", name: "Player A", isGM: false, active: true }
  ],
  currentUserId = "gm-a"
} = {}) {
  resetIds();
  if (!globalThis.crypto) Object.defineProperty(globalThis, "crypto", { value: webcrypto, configurable: true });
  globalThis.clone = deepClone;
  globalThis.foundry = {
    utils: {
      deepClone,
      randomID: () => nextId("id")
    }
  };
  globalThis.CONST = {
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 }
  };
  globalThis.ui = {
    notifications: {
      info() {},
      warn() {},
      error() {}
    }
  };

  const userCollection = createUsers(users);
  const settingsData = new Map();
  const journal = new MockJournalCollection();
  const socketListeners = new Map();

  globalThis.game = {
    user: userCollection.get(currentUserId),
    users: userCollection,
    journal,
    settings: {
      register(moduleId, key, config) {
        const compound = `${moduleId}.${key}`;
        if (!settingsData.has(compound)) settingsData.set(compound, deepClone(config.default));
      },
      get(moduleId, key) {
        return deepClone(settingsData.get(`${moduleId}.${key}`));
      },
      async set(moduleId, key, value) {
        settingsData.set(`${moduleId}.${key}`, deepClone(value));
        return deepClone(value);
      }
    },
    socket: {
      on(name, handler) {
        socketListeners.set(name, handler);
      },
      emit(name, payload) {
        const handler = socketListeners.get(name);
        if (handler) queueMicrotask(() => handler(deepClone(payload)));
      }
    },
    sailshipsCombat: null
  };

  globalThis.JournalEntry = class JournalEntry {
    static async create(data) {
      return journal.add(new MockJournalEntry(data, journal));
    }
  };

  return { journal, users: userCollection, settingsData, socketListeners };
}

installTestEnvironment();
