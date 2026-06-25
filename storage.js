/* =========================================================
   Wohnprotokoll – Storage Layer
   Persistiert Protokolle im localStorage (offline, ohne Server).
   ========================================================= */
(function (global) {
  "use strict";

  const KEY = "wohnprotokoll.v1";
  const THEME_KEY = "wohnprotokoll.theme";

  function read() {
    try {
      const raw = localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error("Storage lesen fehlgeschlagen:", e);
      return [];
    }
  }

  function write(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      return true;
    } catch (e) {
      console.error("Storage schreiben fehlgeschlagen:", e);
      return false;
    }
  }

  function uid() {
    return "wp_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  const Store = {
    /** Alle Protokolle, neueste zuerst. */
    all() {
      return read().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },

    get(id) {
      return read().find((p) => p.id === id) || null;
    },

    /** Leeres Protokoll-Gerüst erzeugen. */
    blank() {
      const now = Date.now();
      return {
        id: uid(),
        createdAt: now,
        updatedAt: now,
        status: "entwurf", // entwurf | abgeschlossen
        type: "einzug", // einzug | auszug
        meta: {
          street: "", zip: "", city: "", floor: "",
          date: new Date().toISOString().slice(0, 10),
          landlord: "", tenant: "", notes: "",
        },
        rooms: [],
        meters: [],
        keys: [],
        signatures: { landlord: null, tenant: null },
      };
    },

    save(protocol) {
      const list = read();
      protocol.updatedAt = Date.now();
      const idx = list.findIndex((p) => p.id === protocol.id);
      if (idx >= 0) list[idx] = protocol;
      else list.push(protocol);
      write(list);
      return protocol;
    },

    remove(id) {
      write(read().filter((p) => p.id !== id));
    },

    duplicate(id) {
      const src = this.get(id);
      if (!src) return null;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = uid();
      copy.createdAt = copy.updatedAt = Date.now();
      copy.status = "entwurf";
      copy.meta.notes = (copy.meta.notes || "");
      write(read().concat(copy));
      return copy;
    },

    exportJSON() {
      return JSON.stringify(read(), null, 2);
    },

    importJSON(json) {
      const incoming = JSON.parse(json);
      if (!Array.isArray(incoming)) throw new Error("Ungültiges Format");
      const list = read();
      const byId = new Map(list.map((p) => [p.id, p]));
      incoming.forEach((p) => byId.set(p.id, p));
      write([...byId.values()]);
      return incoming.length;
    },

    // ---- Theme ----
    getTheme() { return localStorage.getItem(THEME_KEY) || "light"; },
    setTheme(t) { localStorage.setItem(THEME_KEY, t); },

    uid,
  };

  global.Store = Store;
})(window);
