/* =========================================================
   Wohnprotokoll – App (SPA, Vanilla JS)
   Hash-Router + Ansichten + Editor + Unterschrift + PDF
   ========================================================= */
(function () {
  "use strict";

  const app = document.getElementById("app");

  /* ----------------------------- Helpers ----------------------------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function h(tag, attrs = {}, children = []) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") e.className = v;
      else if (k === "html") e.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v);
    }
    (Array.isArray(children) ? children : [children]).forEach((c) => {
      if (c == null || c === false) return;
      e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

  function toast(msg, kind = "ok") {
    const t = h("div", { class: `toast toast--${kind}` }, msg);
    $("#toasts").appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transform = "translateX(20px)"; t.style.transition = ".3s"; }, 2200);
    setTimeout(() => t.remove(), 2600);
  }

  function fmtDate(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
  }
  function fmtDateISO(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  }

  const ROOM_PRESETS = ["Wohnzimmer", "Schlafzimmer", "Küche", "Bad", "Flur", "Kinderzimmer", "Arbeitszimmer", "Gäste-WC", "Balkon", "Keller", "Abstellraum"];
  const METER_PRESETS = ["Strom", "Gas", "Wasser (kalt)", "Wasser (warm)", "Heizung", "Fernwärme"];
  const COND_LABEL = { gut: "Gut", mittel: "Gebrauchsspuren", maengel: "Mängel" };

  /* ----------------------------- Theme ----------------------------- */
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    $("#themeToggle").textContent = t === "dark" ? "☀" : "☾";
  }
  applyTheme(Store.getTheme());
  $("#themeToggle").addEventListener("click", () => {
    const next = Store.getTheme() === "dark" ? "light" : "dark";
    Store.setTheme(next); applyTheme(next);
  });
  $("#year").textContent = new Date().getFullYear();

  /* ----------------------------- Completion ----------------------------- */
  function completion(p) {
    const checks = [
      !!(p.meta.street && p.meta.city),                 // Adresse
      p.rooms.length > 0,                               // mind. 1 Raum
      p.rooms.every((r) => r.condition),                // Zustand gesetzt
      p.meters.length > 0,                              // Zähler
      !!(p.meta.landlord && p.meta.tenant),             // Parteien
      !!(p.signatures.landlord && p.signatures.tenant), // Unterschriften
    ];
    const done = checks.filter(Boolean).length;
    return Math.round((done / checks.length) * 100);
  }

  /* ============================ ROUTER ============================ */
  const routes = [];
  function route(pattern, handler) {
    const keys = [];
    const rx = new RegExp("^" + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "$");
    routes.push({ rx, keys, handler });
  }

  function navigate() {
    const hash = location.hash.replace(/^#/, "") || "/";
    for (const r of routes) {
      const m = hash.match(r.rx);
      if (m) {
        const params = {};
        r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        window.scrollTo(0, 0);
        app.innerHTML = "";
        r.handler(params);
        markNav(hash);
        return;
      }
    }
    app.innerHTML = "";
    viewDashboard();
  }

  function markNav(hash) {
    $$(".topnav a").forEach((a) => {
      const href = a.getAttribute("href").replace(/^#/, "");
      a.classList.toggle("active", href === hash || (href === "/" && hash === "/"));
    });
  }

  window.addEventListener("hashchange", navigate);
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-link]");
    if (link) { /* default hash nav is fine */ }
  });

  /* ============================ DASHBOARD ============================ */
  function viewDashboard() {
    const list = Store.all();

    const hero = h("section", { class: "masthead" }, [
      h("div", { class: "stamp" }, "Übergabeprotokoll"),
      h("div", { class: "masthead__in" }, [
        h("span", { class: "kicker" }, "Wohnungsübergabe · Einzug & Auszug"),
        h("h1", {}, "Den Zustand der Wohnung sauber festhalten – in Minuten."),
        h("p", {}, "Räume, Mängel mit Fotos, Zählerstände und Schlüssel erfassen, direkt im Browser unterschreiben und als PDF sichern. Alles bleibt lokal auf deinem Gerät."),
        h("div", { class: "btn-row row" }, [
          h("a", { class: "btn btn--primary", href: "#/neu" }, ["Neues Protokoll anlegen"]),
          h("a", { class: "btn btn--ghost", href: "#/info" }, ["Anleitung ansehen"]),
        ]),
      ]),
    ]);

    const abgeschlossen = list.filter((p) => p.status === "abgeschlossen").length;
    const maengelGesamt = list.reduce((n, p) => n + p.rooms.reduce((m, r) => m + (r.defects?.length || 0), 0), 0);

    const stats = h("section", { class: "grid grid--stats", style: "margin-bottom:28px" }, [
      stat(list.length, "Protokolle"),
      stat(abgeschlossen, "Abgeschlossen"),
      stat(list.reduce((n, p) => n + p.rooms.length, 0), "Räume erfasst"),
      stat(maengelGesamt, "Mängel dokumentiert"),
    ]);

    const head = h("div", { class: "section-head" }, [
      h("h2", {}, "Deine Protokolle"),
      h("div", { class: "row" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: doImport }, ["Import"]),
        list.length ? h("button", { class: "btn btn--ghost btn--sm", onclick: doExportAll }, ["Backup"]) : null,
        h("a", { class: "btn btn--primary btn--sm", href: "#/neu" }, ["Neu +"]),
      ]),
    ]);

    let body;
    if (!list.length) {
      body = h("div", { class: "card empty" }, [
        h("span", { class: "empty__emoji" }, "🗂"),
        h("h3", {}, "Noch kein Protokoll vorhanden"),
        h("p", { class: "muted" }, "Lege jetzt dein erstes Wohnungsübergabeprotokoll an."),
        h("a", { class: "btn btn--primary", href: "#/neu" }, ["Erstes Protokoll erstellen"]),
      ]);
    } else {
      body = h("div", { class: "grid grid--cards" }, list.map(protocolCard));
    }

    app.append(hero, stats, head, body);
  }

  function stat(num, label) {
    return h("div", { class: "stat" }, [
      h("div", { class: "stat__num" }, String(num)),
      h("div", { class: "stat__label" }, label),
    ]);
  }

  function protocolCard(p) {
    const pct = completion(p);
    const addr = [p.meta.street, [p.meta.zip, p.meta.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Ohne Adresse";
    const card = h("div", { class: "card pcard", onclick: () => (location.hash = `#/p/${p.id}`) }, [
      h("div", { class: "pcard__top" }, [
        h("span", { class: `pcard__type type--${p.type}` }, p.type === "einzug" ? "Einzug" : "Auszug"),
        h("div", { class: "pcard__addr" }, addr),
        h("div", { class: "pcard__sub" }, `${p.rooms.length} Räume · Übergabe ${fmtDateISO(p.meta.date)}`),
        h("div", { class: "spacer", style: "height:10px" }),
        h("div", { class: "progress" }, [h("div", { class: "progress__bar", style: `width:${pct}%` })]),
        h("div", { class: "pcard__sub", style: "margin-top:6px" }, `${pct}% vollständig`),
      ]),
      h("div", { class: "pcard__foot" }, [
        h("span", {}, [h("span", { class: `tag ${p.status === "abgeschlossen" ? "tag--ok" : ""}` }, p.status === "abgeschlossen" ? "Abgeschlossen" : "Entwurf")]),
        h("span", {}, `bearb. ${fmtDate(p.updatedAt)}`),
      ]),
    ]);
    return card;
  }

  /* ============================ NEU ============================ */
  function viewNew() {
    const p = Store.blank();
    Store.save(p);
    location.replace(`#/p/${p.id}`);
  }

  /* ============================ EDITOR ============================ */
  let current = null;          // aktuelles Protokoll
  let activeSection = "stammdaten";
  let saveTimer = null;

  const SECTIONS = [
    { id: "stammdaten", label: "Stammdaten" },
    { id: "raeume", label: "Räume & Mängel" },
    { id: "zaehler", label: "Zählerstände" },
    { id: "schluessel", label: "Schlüssel" },
    { id: "unterschrift", label: "Unterschrift" },
    { id: "zusammenfassung", label: "Zusammenfassung" },
  ];

  function touch() {
    if (saveTimer) clearTimeout(saveTimer);
    setSaveState("Speichert …");
    saveTimer = setTimeout(() => {
      Store.save(current);
      setSaveState("Gespeichert ✓");
    }, 350);
  }
  function setSaveState(txt) {
    const el = $("#saveState");
    if (el) el.textContent = txt;
  }

  function viewEditor({ id }) {
    current = Store.get(id);
    if (!current) { toast("Protokoll nicht gefunden", "bad"); location.hash = "#/"; return; }
    activeSection = "stammdaten";
    renderEditor();
  }

  function renderEditor() {
    app.innerHTML = "";

    const back = h("a", { class: "btn btn--ghost btn--sm", href: "#/" }, ["← Übersicht"]);
    const titleAddr = current.meta.street || "Neues Protokoll";
    const headRow = h("div", { class: "section-head" }, [
      h("div", {}, [
        back,
        h("h1", { style: "margin:10px 0 2px" }, titleAddr),
        h("div", { class: "muted", style: "font-size:.9rem" }, `${current.type === "einzug" ? "Einzugs" : "Auszugs"}protokoll · ${completion(current)}% vollständig`),
      ]),
      h("div", { class: "row no-print" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => { const c = Store.duplicate(current.id); if (c) { toast("Dupliziert"); location.hash = `#/p/${c.id}`; } } }, ["Duplizieren"]),
        h("button", { class: "btn btn--danger btn--sm", onclick: deleteCurrent }, ["Löschen"]),
      ]),
    ]);

    // Stepper
    const stepper = h("div", { class: "stepper" }, SECTIONS.map((s, i) => {
      const done = sectionDone(s.id);
      return h("div", {
        class: `step ${activeSection === s.id ? "active" : ""} ${done ? "done" : ""}`,
        onclick: () => { activeSection = s.id; renderEditor(); },
      }, [
        h("span", { class: "step__dot" }, done ? "✓" : String(i + 1).padStart(2, "0")),
        h("span", {}, s.label),
      ]);
    }));

    const panel = h("div", { id: "panel" });
    renderSection(panel);

    app.append(headRow, stepper, panel, editbar());
  }

  function sectionDone(id) {
    const p = current;
    switch (id) {
      case "stammdaten": return !!(p.meta.street && p.meta.city && p.meta.date);
      case "raeume": return p.rooms.length > 0 && p.rooms.every((r) => r.condition);
      case "zaehler": return p.meters.length > 0 && p.meters.every((m) => m.value !== "");
      case "schluessel": return p.keys.length > 0;
      case "unterschrift": return !!(p.signatures.landlord && p.signatures.tenant);
      default: return false;
    }
  }

  function editbar() {
    const sectionsOrder = SECTIONS.map((s) => s.id);
    const i = sectionsOrder.indexOf(activeSection);
    const prev = sectionsOrder[i - 1];
    const next = sectionsOrder[i + 1];
    return h("div", { class: "editbar no-print" }, [
      h("span", { id: "saveState", class: "save-state" }, "Gespeichert ✓"),
      h("span", { class: "grow" }),
      prev ? h("button", { class: "btn btn--ghost btn--sm", onclick: () => { activeSection = prev; renderEditor(); } }, ["← Zurück"]) : null,
      next ? h("button", { class: "btn btn--primary btn--sm", onclick: () => { activeSection = next; renderEditor(); } }, ["Weiter →"]) : null,
    ]);
  }

  /* ---------- Section dispatcher ---------- */
  function renderSection(panel) {
    panel.innerHTML = "";
    ({
      stammdaten: secStammdaten,
      raeume: secRaeume,
      zaehler: secZaehler,
      schluessel: secSchluessel,
      unterschrift: secUnterschrift,
      zusammenfassung: secZusammenfassung,
    }[activeSection])(panel);
  }

  function bindInput(obj, key, type = "text") {
    return (e) => {
      obj[key] = type === "checkbox" ? e.target.checked : e.target.value;
      touch();
    };
  }

  /* ---------- 1. Stammdaten ---------- */
  function secStammdaten(panel) {
    const m = current.meta;
    const card = h("div", { class: "card" }, [
      h("div", { class: "section-head" }, [h("div", {}, [h("span", { class: "kicker" }, "Schritt 01"), h("h2", { style: "margin-top:4px" }, "Stammdaten der Wohnung")])]),

      h("div", { class: "field", style: "margin-bottom:18px" }, [
        h("label", {}, "Art der Übergabe"),
        h("div", { class: "segmented" }, [
          segBtn("Einzug", current.type === "einzug", () => { current.type = "einzug"; touch(); renderEditor(); }),
          segBtn("Auszug", current.type === "auszug", () => { current.type = "auszug"; touch(); renderEditor(); }),
        ]),
      ]),

      h("div", { class: "form-grid" }, [
        field("Straße & Hausnummer", input(m.street, bindInput(m, "street"), "z. B. Musterstraße 12"), true),
        field("PLZ", input(m.zip, bindInput(m, "zip"), "12345")),
        field("Ort", input(m.city, bindInput(m, "city"), "Musterstadt")),
        field("Etage / Lage", input(m.floor, bindInput(m, "floor"), "z. B. 2. OG links")),
        field("Datum der Übergabe", input(m.date, bindInput(m, "date"), "", "date")),
        field("Vermieter:in", input(m.landlord, bindInput(m, "landlord"), "Name")),
        field("Mieter:in", input(m.tenant, bindInput(m, "tenant"), "Name")),
        field("Anmerkungen", textarea(m.notes, bindInput(m, "notes"), "Allgemeine Notizen zur Übergabe …"), true),
      ]),
    ]);
    panel.appendChild(card);
  }

  /* ---------- 2. Räume & Mängel ---------- */
  function secRaeume(panel) {
    const head = h("div", { class: "section-head" }, [
      h("div", {}, [h("span", { class: "kicker" }, "Schritt 02"), h("h2", { style: "margin-top:4px" }, "Räume & Mängel")]),
      h("div", { class: "row" }, [
        presetSelect(ROOM_PRESETS, "Raum aus Vorlage …", (name) => addRoom(name)),
        h("button", { class: "btn btn--primary btn--sm", onclick: () => addRoom("Neuer Raum") }, ["Raum +"]),
      ]),
    ]);
    panel.appendChild(head);

    if (!current.rooms.length) {
      panel.appendChild(h("div", { class: "card empty" }, [
        h("p", { class: "muted" }, "Noch keine Räume erfasst. Füge oben den ersten Raum hinzu – einzeln oder über eine Vorlage."),
      ]));
      return;
    }

    current.rooms.forEach((room) => panel.appendChild(roomCard(room)));
  }

  function addRoom(name) {
    current.rooms.push({ id: Store.uid(), name, condition: "", note: "", defects: [] });
    touch(); renderSection($("#panel"));
  }

  function roomCard(room) {
    const card = h("div", { class: "room" });

    const head = h("div", { class: "room__head" }, [
      h("input", { class: "room__name", value: room.name, oninput: bindInput(room, "name") }),
      h("div", { class: "room__meta" }, [
        room.defects.length ? h("span", { class: "tag tag--bad" }, `${room.defects.length} ${room.defects.length > 1 ? "Mängel" : "Mangel"}`) : null,
        h("button", { class: "icon-x", title: "Raum löschen", onclick: () => { current.rooms = current.rooms.filter((r) => r.id !== room.id); touch(); renderSection($("#panel")); } }, ["✕"]),
      ]),
    ]);

    const conds = h("div", { class: "cond-pills" }, ["gut", "mittel", "maengel"].map((c) =>
      h("button", {
        class: `cond-pill ${room.condition === c ? "active" : ""}`, "data-cond": c,
        onclick: () => { room.condition = c; touch(); renderSection($("#panel")); },
      }, COND_LABEL[c])
    ));

    const note = field("Notiz zum Raum", input(room.note, bindInput(room, "note"), "z. B. Wände frisch gestrichen, Parkett ohne Kratzer"), true);

    const defectsWrap = h("div", {});
    room.defects.forEach((d) => defectsWrap.appendChild(defectRow(room, d)));

    const addDefect = h("button", { class: "btn btn--ghost btn--sm", onclick: () => { room.defects.push({ id: Store.uid(), text: "", photos: [] }); touch(); renderSection($("#panel")); } }, ["Mangel erfassen +"]);

    const body = h("div", { class: "room__body" }, [
      conds, note,
      h("div", { class: "spacer", style: "height:6px" }),
      h("h3", { style: "font-size:.92rem;margin-bottom:10px" }, "Mängel & Fotos"),
      defectsWrap, addDefect,
    ]);

    card.append(head, body);
    return card;
  }

  function defectRow(room, d) {
    const thumbs = h("div", { class: "defect__thumbs" });
    (d.photos || []).forEach((src, idx) => {
      thumbs.appendChild(h("div", { class: "thumb" }, [
        h("img", { src, alt: "Mangelfoto" }),
        h("button", { title: "Foto entfernen", onclick: () => { d.photos.splice(idx, 1); touch(); renderSection($("#panel")); } }, ["✕"]),
      ]));
    });

    const fileInput = h("input", { type: "file", accept: "image/*", multiple: true, onchange: (e) => handlePhotos(e, d) });
    const photoLabel = h("label", { class: "photo-btn" }, ["Foto hinzufügen", fileInput]);

    return h("div", { class: "defect" }, [
      h("span", { class: "defect__marker" }, "!"),
      h("div", { style: "flex:1" }, [
        input(d.text, bindInput(d, "text"), "Mangel beschreiben, z. B. Kratzer im Parkett vor dem Fenster"),
        h("div", { class: "row", style: "margin-top:8px" }, [photoLabel]),
        thumbs,
      ]),
      h("button", { class: "icon-x", title: "Mangel löschen", onclick: () => { room.defects = room.defects.filter((x) => x.id !== d.id); touch(); renderSection($("#panel")); } }, ["✕"]),
    ]);
  }

  function handlePhotos(e, target) {
    const files = [...e.target.files];
    if (!files.length) return;
    target.photos = target.photos || [];
    let pending = files.length;
    files.forEach((file) => {
      compressImage(file, 1100, 0.7).then((dataUrl) => {
        target.photos.push(dataUrl);
        if (--pending === 0) { touch(); renderSection($("#panel")); toast(`${files.length} Foto(s) hinzugefügt`); }
      }).catch(() => { if (--pending === 0) renderSection($("#panel")); });
    });
    e.target.value = "";
  }

  // Bild auf max. Kantenlänge skalieren & als JPEG komprimieren (spart localStorage-Platz)
  function compressImage(file, maxSize, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let { width, height } = img;
          if (width > height && width > maxSize) { height = height * maxSize / width; width = maxSize; }
          else if (height > maxSize) { width = width * maxSize / height; height = maxSize; }
          const canvas = h("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = reject;
        img.src = reader.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /* ---------- 3. Zählerstände ---------- */
  function secZaehler(panel) {
    const head = h("div", { class: "section-head" }, [
      h("div", {}, [h("span", { class: "kicker" }, "Schritt 03"), h("h2", { style: "margin-top:4px" }, "Zählerstände")]),
      h("div", { class: "row" }, [
        presetSelect(METER_PRESETS, "Zähler aus Vorlage …", (name) => addMeter(name)),
        h("button", { class: "btn btn--primary btn--sm", onclick: () => addMeter("") }, ["Zähler +"]),
      ]),
    ]);
    const card = h("div", { class: "card" }, [head]);

    if (!current.meters.length) {
      card.appendChild(h("p", { class: "muted" }, "Erfasse Strom-, Gas- und Wasserzähler zum Übergabezeitpunkt."));
    } else {
      const header = h("div", { class: "meter-row", style: "font-size:.76rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);font-weight:700" }, [
        h("span", {}, "Zähler / Art"), h("span", {}, "Stand"), h("span", {}, "Zählernummer"), h("span", {}, ""),
      ]);
      card.appendChild(header);
      current.meters.forEach((mt) => card.appendChild(meterRow(mt)));
    }
    panel.appendChild(card);
  }

  function addMeter(name) {
    current.meters.push({ id: Store.uid(), name, value: "", number: "" });
    touch(); renderSection($("#panel"));
  }

  function meterRow(mt) {
    return h("div", { class: "meter-row" }, [
      input(mt.name, bindInput(mt, "name"), "z. B. Strom"),
      input(mt.value, bindInput(mt, "value"), "z. B. 24561,3"),
      input(mt.number, bindInput(mt, "number"), "Zählernr. (optional)"),
      h("button", { class: "icon-x", onclick: () => { current.meters = current.meters.filter((x) => x.id !== mt.id); touch(); renderSection($("#panel")); } }, ["✕"]),
    ]);
  }

  /* ---------- 4. Schlüssel ---------- */
  function secSchluessel(panel) {
    const head = h("div", { class: "section-head" }, [
      h("div", {}, [h("span", { class: "kicker" }, "Schritt 04"), h("h2", { style: "margin-top:4px" }, "Schlüsselübergabe")]),
      h("button", { class: "btn btn--primary btn--sm", onclick: () => { current.keys.push({ id: Store.uid(), name: "", count: 1 }); touch(); renderSection($("#panel")); } }, ["Schlüssel +"]),
    ]);
    const card = h("div", { class: "card" }, [head]);

    if (!current.keys.length) {
      card.appendChild(h("p", { class: "muted" }, "Halte Anzahl und Art der übergebenen Schlüssel fest (Haustür, Wohnung, Briefkasten, Keller …)."));
    } else {
      const presets = ["Haustür", "Wohnungstür", "Briefkasten", "Keller", "Garage", "Dachboden"];
      const header = h("div", { class: "key-row", style: "font-size:.76rem;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);font-weight:700" }, [
        h("span", {}, "Art"), h("span", {}, "Anzahl"), h("span", {}, ""),
      ]);
      card.appendChild(header);
      current.keys.forEach((k) => {
        const dl = h("datalist", { id: "keylist_" + k.id }, presets.map((p) => h("option", { value: p })));
        const nameIn = input(k.name, bindInput(k, "name"), "z. B. Haustür");
        nameIn.setAttribute("list", "keylist_" + k.id);
        card.appendChild(h("div", { class: "key-row" }, [
          h("div", {}, [nameIn, dl]),
          input(k.count, bindInput(k, "count"), "1", "number"),
          h("button", { class: "icon-x", onclick: () => { current.keys = current.keys.filter((x) => x.id !== k.id); touch(); renderSection($("#panel")); } }, ["✕"]),
        ]));
      });
      const total = current.keys.reduce((n, k) => n + (parseInt(k.count) || 0), 0);
      card.appendChild(h("p", { class: "muted", style: "margin-top:12px" }, `Gesamt: ${total} Schlüssel`));
    }
    panel.appendChild(card);
  }

  /* ---------- 5. Unterschrift ---------- */
  function secUnterschrift(panel) {
    const card = h("div", { class: "card" }, [
      h("div", { class: "section-head" }, [h("div", {}, [h("span", { class: "kicker" }, "Schritt 05"), h("h2", { style: "margin-top:4px" }, "Unterschriften")])]),
      h("p", { class: "muted" }, "Beide Parteien unterschreiben direkt im Feld (Maus oder Finger). Die Unterschrift wird im Protokoll gespeichert."),
      h("div", { class: "sig-grid" }, [
        sigBox("landlord", "Vermieter:in", current.meta.landlord),
        sigBox("tenant", "Mieter:in", current.meta.tenant),
      ]),
    ]);
    panel.appendChild(card);
    // Pads nach dem Einhängen initialisieren
    setupSignaturePad("landlord");
    setupSignaturePad("tenant");
  }

  function sigBox(key, role, name) {
    const wrap = h("div", { class: "sig-box" }, [
      h("label", {}, `${role}${name ? " · " + name : ""}`),
      h("canvas", { class: "sig-pad", id: "pad_" + key }),
      h("div", { class: "sig-actions" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => clearPad(key) }, ["Löschen"]),
        current.signatures[key] ? h("span", { class: "tag tag--ok" }, "Unterschrieben") : h("span", { class: "muted", style: "font-size:.82rem;align-self:center" }, "Noch nicht unterschrieben"),
      ]),
    ]);
    return wrap;
  }

  function setupSignaturePad(key) {
    const canvas = $("#pad_" + key);
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue("--text").trim() || "#000";

    // vorhandene Unterschrift anzeigen
    if (current.signatures[key]) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = current.signatures[key];
    }

    let drawing = false, last = null, dirty = false;
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - r.left, y: t.clientY - r.top };
    };
    const start = (e) => { drawing = true; last = pos(e); e.preventDefault(); };
    const move = (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p; dirty = true; e.preventDefault();
    };
    const end = () => {
      if (drawing && dirty) {
        current.signatures[key] = canvas.toDataURL("image/png");
        touch();
      }
      drawing = false;
    };
    canvas.addEventListener("mousedown", start);
    canvas.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    canvas.addEventListener("touchstart", start, { passive: false });
    canvas.addEventListener("touchmove", move, { passive: false });
    canvas.addEventListener("touchend", end);
  }

  function clearPad(key) {
    const canvas = $("#pad_" + key);
    if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    current.signatures[key] = null;
    touch(); renderSection($("#panel"));
  }

  /* ---------- 6. Zusammenfassung ---------- */
  function secZusammenfassung(panel) {
    const p = current;
    const pct = completion(p);

    const actions = h("div", { class: "section-head no-print" }, [
      h("div", {}, [h("span", { class: "kicker" }, "Schritt 06"), h("h2", { style: "margin-top:4px" }, "Zusammenfassung & Export")]),
      h("div", { class: "row" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => { p.status = p.status === "abgeschlossen" ? "entwurf" : "abgeschlossen"; Store.save(p); toast(p.status === "abgeschlossen" ? "Als abgeschlossen markiert" : "Wieder als Entwurf"); renderSection($("#panel")); } }, [p.status === "abgeschlossen" ? "Als Entwurf markieren" : "Protokoll abschließen"]),
        h("button", { class: "btn btn--primary btn--sm", onclick: () => window.print() }, ["Als PDF / Drucken"]),
      ]),
    ]);

    const prog = h("div", { class: "card no-print", style: "margin-bottom:18px" }, [
      h("div", { class: "row row--between" }, [h("strong", {}, "Vollständigkeit"), h("span", { class: "tag" }, pct + "%")]),
      h("div", { class: "spacer", style: "height:8px" }),
      h("div", { class: "progress" }, [h("div", { class: "progress__bar", style: `width:${pct}%` })]),
      pct < 100 ? h("p", { class: "muted", style: "margin:10px 0 0;font-size:.85rem" }, "Tipp: Adresse, Räume mit Zustand, Zähler, Parteien und beide Unterschriften ergeben ein vollständiges Protokoll.") : h("p", { style: "margin:10px 0 0;color:var(--ok);font-weight:700" }, "✓ Protokoll vollständig"),
    ]);

    panel.append(actions, prog, summaryDocument(p));
  }

  function summaryDocument(p) {
    const addr = [p.meta.street, [p.meta.zip, p.meta.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—";
    const doc = h("div", { class: "card summary" }, [
      h("div", { class: "row row--between" }, [
        h("div", {}, [
          h("h1", { style: "margin:0" }, "Wohnungsübergabeprotokoll"),
          h("div", { class: "muted" }, p.type === "einzug" ? "Einzug / Übernahme" : "Auszug / Rückgabe"),
        ]),
        h("div", { style: "text-align:right" }, [h("div", { class: "kicker" }, "Wohnprotokoll"), h("div", { class: "muted", style: "font-size:.8rem" }, "Nr. " + p.id.slice(-6).toUpperCase())]),
      ]),
      h("hr", { class: "divider" }),

      h("table", { class: "sum-table" }, [
        rowTH("Adresse", addr),
        rowTH("Etage / Lage", p.meta.floor || "—"),
        rowTH("Datum der Übergabe", fmtDateISO(p.meta.date)),
        rowTH("Vermieter:in", p.meta.landlord || "—"),
        rowTH("Mieter:in", p.meta.tenant || "—"),
        p.meta.notes ? rowTH("Anmerkungen", p.meta.notes) : null,
      ]),

      h("h2", {}, "Räume"),
      p.rooms.length ? h("div", {}, p.rooms.map(sumRoom)) : h("p", { class: "muted" }, "Keine Räume erfasst."),

      h("h2", {}, "Zählerstände"),
      p.meters.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", {}, "Zähler"), h("th", {}, "Stand"), h("th", {}, "Zählernummer")]),
        ...p.meters.map((m) => h("tr", {}, [h("td", {}, m.name || "—"), h("td", {}, m.value || "—"), h("td", {}, m.number || "—")])),
      ]) : h("p", { class: "muted" }, "Keine Zähler erfasst."),

      h("h2", {}, "Schlüssel"),
      p.keys.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", {}, "Art"), h("th", {}, "Anzahl")]),
        ...p.keys.map((k) => h("tr", {}, [h("td", {}, k.name || "—"), h("td", {}, String(k.count || 0))])),
      ]) : h("p", { class: "muted" }, "Keine Schlüssel erfasst."),

      h("h2", {}, "Unterschriften"),
      h("div", { class: "sum-sigs" }, [
        sumSig("Vermieter:in", p.meta.landlord, p.signatures.landlord),
        sumSig("Mieter:in", p.meta.tenant, p.signatures.tenant),
      ]),

      h("p", { class: "muted", style: "margin-top:24px;font-size:.78rem" }, `Erstellt mit Wohnprotokoll · ${fmtDate(p.createdAt)} · Dieses Protokoll dokumentiert den Zustand der Wohnung zum Übergabezeitpunkt.`),
    ]);
    return doc;
  }

  function sumRoom(r) {
    const condClass = r.condition === "maengel" ? "bad" : r.condition === "mittel" ? "warn" : "ok";
    const photos = r.defects.flatMap((d) => d.photos || []);
    return h("div", { class: "sum-room" }, [
      h("div", { class: "row row--between" }, [
        h("strong", {}, r.name || "Raum"),
        h("span", { class: "tag", style: `color:var(--${condClass});border-color:var(--${condClass})` }, r.condition ? COND_LABEL[r.condition] : "ohne Bewertung"),
      ]),
      r.note ? h("div", { class: "muted", style: "margin-top:4px" }, r.note) : null,
      r.defects.length ? h("ul", { style: "margin:8px 0 0;padding-left:18px" }, r.defects.map((d) => h("li", {}, d.text || "Mangel ohne Beschreibung"))) : null,
      photos.length ? h("div", { class: "sum-photos" }, photos.map((src) => h("img", { src }))) : null,
    ]);
  }

  function sumSig(role, name, src) {
    return h("div", { class: "sum-sig" }, [
      src ? h("img", { src }) : h("div", { style: "height:90px;border-bottom:1px solid var(--text)" }),
      h("div", { style: "font-size:.82rem;margin-top:4px" }, [h("strong", {}, role), name ? " · " + name : ""]),
    ]);
  }

  function rowTH(label, val) { return h("tr", {}, [h("th", { style: "width:200px" }, label), h("td", {}, val)]); }

  /* ----------------------------- Reusable UI ----------------------------- */
  function field(label, control, full = false) {
    return h("div", { class: "field" + (full ? " field--full" : "") }, [h("label", {}, label), control]);
  }
  function input(value, oninput, placeholder = "", type = "text") {
    return h("input", { type, value: value ?? "", placeholder, oninput });
  }
  function textarea(value, oninput, placeholder = "") {
    return h("textarea", { placeholder, oninput }, value ?? "");
  }
  function segBtn(label, active, onclick) {
    return h("button", { class: active ? "active" : "", onclick }, label);
  }
  function presetSelect(options, label, onpick) {
    const sel = h("select", {
      style: "max-width:200px",
      onchange: (e) => { if (e.target.value) { onpick(e.target.value); e.target.value = ""; } },
    }, [h("option", { value: "" }, label), ...options.map((o) => h("option", { value: o }, o))]);
    return sel;
  }

  /* ----------------------------- Import / Export ----------------------------- */
  function doExportAll() {
    const blob = new Blob([Store.exportJSON()], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `wohnprotokoll-backup-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    toast("Backup heruntergeladen");
  }
  function doImport() {
    const inp = h("input", { type: "file", accept: "application/json", onchange: (e) => {
      const file = e.target.files[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { const n = Store.importJSON(reader.result); toast(`${n} Protokoll(e) importiert`); navigate(); }
        catch (err) { toast("Import fehlgeschlagen: " + err.message, "bad"); }
      };
      reader.readAsText(file);
    }});
    inp.click();
  }

  /* ----------------------------- Editor: delete current ----------------------------- */
  function deleteCurrent() {
    if (!current) return;
    if (confirm("Dieses Protokoll wirklich löschen? Das kann nicht rückgängig gemacht werden.")) {
      Store.remove(current.id);
      toast("Protokoll gelöscht");
      location.hash = "#/";
    }
  }

  /* ============================ INFO ============================ */
  function viewInfo() {
    const features = [
      ["🪟", "Räume & Mängel", "Zustand pro Raum bewerten, Mängel beschreiben und mit Fotos belegen."],
      ["📸", "Fotos direkt erfassen", "Bilder werden automatisch komprimiert und im Protokoll gespeichert."],
      ["⚡", "Zählerstände", "Strom, Gas und Wasser inkl. Zählernummer dokumentieren."],
      ["🗝️", "Schlüsselübergabe", "Art und Anzahl aller übergebenen Schlüssel festhalten."],
      ["🖋️", "Digitale Unterschrift", "Beide Parteien unterschreiben direkt im Browser – per Maus oder Finger."],
      ["🧾", "PDF-Export", "Sauberes Protokoll als PDF drucken oder speichern."],
      ["🗄️", "Komplett offline", "Alle Daten bleiben lokal in deinem Browser – kein Server, kein Tracking."],
      ["🧰", "Backup & Import", "Protokolle als JSON exportieren und auf anderen Geräten importieren."],
    ];
    app.append(
      h("section", { class: "masthead" }, [
        h("div", { class: "masthead__in" }, [
          h("span", { class: "kicker" }, "Anleitung"),
          h("h1", { style: "margin:10px 0 12px" }, "So funktioniert Wohnprotokoll"),
          h("p", {}, "In fünf Schritten zum unterschriebenen Übergabeprotokoll – ganz ohne Papier."),
          h("a", { class: "btn btn--primary", href: "#/neu", style: "margin-top:18px" }, ["Jetzt Protokoll erstellen"]),
        ]),
      ]),
      h("div", { class: "card", style: "margin-bottom:24px" }, [
        h("h2", {}, "In 5 Schritten"),
        h("ol", { class: "steps-list" }, [
          li("Stammdaten erfassen", "Adresse, Datum, Vermieter:in und Mieter:in eintragen."),
          li("Räume dokumentieren", "Räume hinzufügen, Zustand bewerten und Mängel mit Fotos festhalten."),
          li("Zähler & Schlüssel", "Zählerstände ablesen und übergebene Schlüssel notieren."),
          li("Unterschreiben", "Beide Parteien unterschreiben digital direkt im Browser."),
          li("PDF exportieren", "Protokoll als PDF speichern oder ausdrucken – fertig."),
        ]),
      ]),
      h("div", { class: "card" }, [
        h("h2", {}, "Funktionen"),
        h("div", { class: "feature-grid" }, features.map(([icon, t, d]) =>
          h("div", { class: "feature" }, [
            h("div", { class: "feature__icon" }, icon),
            h("h3", { style: "margin:8px 0 4px" }, t),
            h("p", { class: "muted", style: "margin:0;font-size:.88rem" }, d),
          ])
        )),
      ])
    );
  }
  function li(t, d) { return h("li", {}, [h("div", {}, [h("strong", {}, t), h("div", { class: "muted", style: "font-size:.9rem" }, d)])]); }

  /* ============================ ROUTES ============================ */
  route("/", viewDashboard);
  route("/neu", viewNew);
  route("/info", viewInfo);
  route("/p/:id", viewEditor);

  // Globale Editor-Aktionen (Löschen) per Tastatur/Übersicht
  window.WP = { deleteCurrent, duplicate: (id) => { const c = Store.duplicate(id); if (c) { toast("Dupliziert"); navigate(); } } };

  /* ============================ START ============================ */
  navigate();
})();
