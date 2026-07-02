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

  // Eingehendes/älteres Protokoll auf ein vollständiges, sicheres Gerüst bringen –
  // verhindert Abstürze beim Import (fehlende Felder, falsche Typen, alte Versionen).
  function normalizeProtocol(p) {
    if (!p || typeof p !== "object") return null;
    const now = Date.now();
    const meta = (p.meta && typeof p.meta === "object") ? p.meta : {};
    const arr = (v) => (Array.isArray(v) ? v : []);
    return {
      id: typeof p.id === "string" && p.id ? p.id : uid(),
      createdAt: p.createdAt || now,
      updatedAt: p.updatedAt || now,
      status: p.status === "abgeschlossen" ? "abgeschlossen" : "entwurf",
      type: p.type === "auszug" ? "auszug" : "einzug",
      favorite: !!p.favorite,
      meta: {
        street: meta.street || "", zip: meta.zip || "", city: meta.city || "", floor: meta.floor || "",
        date: meta.date || new Date().toISOString().slice(0, 10),
        landlord: meta.landlord || "", tenant: meta.tenant || "", notes: meta.notes || "",
      },
      rooms: arr(p.rooms).map((r) => ({
        ...r,
        items: arr(r && r.items),
        defects: arr(r && r.defects).map((d) => ({ ...d, photos: arr(d && d.photos) })),
      })),
      meters: arr(p.meters).map((m) => ({ ...m, photos: arr(m && m.photos) })),
      keys: arr(p.keys),
      deposit: (p.deposit && typeof p.deposit === "object")
        ? { amount: p.deposit.amount || "", currency: p.deposit.currency || "CHF", account: p.deposit.account || "", status: p.deposit.status || "", notes: p.deposit.notes || "" }
        : { amount: "", currency: "CHF", account: "", status: "", notes: "" },
      signatures: (p.signatures && typeof p.signatures === "object")
        ? { landlord: p.signatures.landlord || null, tenant: p.signatures.tenant || null }
        : { landlord: null, tenant: null },
    };
  }

  const Store = {
    /** Alle Protokolle: Favoriten zuerst, dann neueste zuerst. */
    all() {
      return read().sort((a, b) =>
        (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0) ||
        (b.updatedAt || 0) - (a.updatedAt || 0)
      );
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
        favorite: false,
        meta: {
          street: "", zip: "", city: "", floor: "",
          date: new Date().toISOString().slice(0, 10),
          landlord: "", tenant: "", notes: "",
        },
        rooms: [],
        meters: [],
        keys: [],
        deposit: { amount: "", currency: "CHF", account: "", status: "", notes: "" },
        signatures: { landlord: null, tenant: null },
      };
    },

    save(protocol) {
      const list = read();
      protocol.updatedAt = Date.now();
      const idx = list.findIndex((p) => p.id === protocol.id);
      if (idx >= 0) list[idx] = protocol;
      else list.push(protocol);
      // write() liefert bei vollem/blockiertem localStorage false – nach außen geben,
      // damit das UI keinen „Gespeichert"-Status vortäuscht, obwohl nichts gesichert wurde.
      return write(list) ? protocol : false;
    },

    remove(id) {
      write(read().filter((p) => p.id !== id));
    },

    /** Ein gelöschtes Protokoll unverändert wieder einsetzen (für „Rückgängig"). */
    restore(protocol) {
      const list = read();
      if (!list.some((p) => p.id === protocol.id)) list.push(protocol);
      return write(list);
    },

    /** Grobe localStorage-Auslastung (Richtwert 5 MB). */
    usage() {
      const raw = localStorage.getItem(KEY) || "";
      const bytes = raw.length * 2; // localStorage zählt in UTF-16-Einheiten
      const quota = 5 * 1024 * 1024;
      return { bytes, quota, percent: Math.min(100, Math.round((bytes / quota) * 100)) };
    },

    /** Mehrere Protokolle auf einmal löschen. */
    removeMany(ids) {
      const set = new Set(ids);
      return write(read().filter((p) => !set.has(p.id)));
    },

    /** Favoriten-Markierung setzen, ohne updatedAt zu verändern. */
    setFavorite(id, fav) {
      const list = read();
      const p = list.find((x) => x.id === id);
      if (!p) return false;
      p.favorite = !!fav;
      return write(list);
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
      let incoming;
      try { incoming = JSON.parse(json); }
      catch (e) { throw new Error("Datei ist kein gültiges JSON"); }
      // Sowohl ein Array von Protokollen als auch ein einzelnes Protokoll-Objekt akzeptieren.
      if (!Array.isArray(incoming)) incoming = [incoming];
      const normalized = incoming.map(normalizeProtocol).filter(Boolean);
      if (!normalized.length) throw new Error("Keine gültigen Protokolle in der Datei gefunden");
      const list = read();
      const byId = new Map(list.map((p) => [p.id, p]));
      normalized.forEach((p) => byId.set(p.id, p));
      if (!write([...byId.values()])) throw new Error("Speicher voll – Import nicht gesichert");
      return normalized.length;
    },

    // ---- Theme ----
    // "auto" folgt der Systemeinstellung (hell/dunkel); Nutzer können fix hell/dunkel wählen.
    getTheme() {
      const t = localStorage.getItem(THEME_KEY);
      return t === "light" || t === "dark" || t === "auto" ? t : "auto";
    },
    setTheme(t) { localStorage.setItem(THEME_KEY, t); },

    uid,
  };

  global.Store = Store;
})(window);
