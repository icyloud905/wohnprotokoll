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

  // Toast mit Aktionsknopf (z. B. „Rückgängig") – bleibt länger sichtbar.
  function toastAction(msg, actionLabel, onAction, kind = "ok") {
    const action = h("button", { class: "toast__action" }, actionLabel);
    const t = h("div", { class: `toast toast--${kind}` }, [h("span", {}, msg), action]);
    let closed = false;
    const close = () => { if (closed) return; closed = true; t.style.opacity = "0"; t.style.transform = "translateX(20px)"; t.style.transition = ".3s"; setTimeout(() => t.remove(), 300); };
    action.addEventListener("click", () => { close(); onAction(); });
    $("#toasts").appendChild(t);
    setTimeout(close, 6000);
    return t;
  }

  // Eigener Bestätigungsdialog (ersetzt natives confirm – passt zum Dokument-Look).
  function confirmDialog({ title = "Bestätigen", message = "", confirmLabel = "Bestätigen", cancelLabel = "Abbrechen", danger = false, onConfirm }) {
    const backdrop = h("div", { class: "modal-backdrop" });
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    const confirmBtn = h("button", { class: "btn btn--sm " + (danger ? "btn--danger" : "btn--primary"), onclick: () => { close(); onConfirm && onConfirm(); } }, [confirmLabel]);
    const dialog = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      h("h3", { class: "modal__title" }, title),
      message ? h("p", { class: "modal__msg" }, message) : null,
      h("div", { class: "modal__actions" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: close }, [cancelLabel]),
        confirmBtn,
      ]),
    ]);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
    setTimeout(() => confirmBtn.focus(), 0);
  }

  // Lesbare Adresse eines Protokolls.
  function addrLabel(p) {
    return [p.meta.street, [p.meta.zip, p.meta.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "Ohne Adresse";
  }

  // Einzelnes Protokoll als JSON teilen (Web-Share) oder herunterladen.
  function exportOne(p) {
    const data = JSON.stringify([p], null, 2);
    const safe = ((p.meta.street || "protokoll").replace(/[^\w-]+/g, "_").slice(0, 40)) || "protokoll";
    const filename = `wohnprotokoll-${safe}-${new Date().toISOString().slice(0, 10)}.json`;

    // Garantierter Download-Fallback (funktioniert immer)
    const download = () => {
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = h("a", { href: url, download: filename, rel: "noopener" });
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
      toast("Protokoll exportiert");
    };

    // Web-Share nur versuchen, wenn Datei-Sharing wirklich unterstützt wird.
    try {
      if (navigator.share && typeof navigator.canShare === "function") {
        const file = new File([data], filename, { type: "application/json" });
        if (navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: "Wohnprotokoll", text: "Wohnungsübergabeprotokoll" })
            .catch((err) => {
              // Vom Nutzer abgebrochen → nichts tun; jeder andere Fehler → herunterladen.
              if (!err || err.name !== "AbortError") download();
            });
          return;
        }
      }
    } catch (e) { /* Sharing nicht verfügbar – unten Download */ }

    download();
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
  const COND_SHORT = { gut: "G", mittel: "S", maengel: "M" };
  // Mangel-Einordnung – relevant für die Kostenfrage (Art. 267/267a OR)
  const DEFECT_STATUS = { "": "Status …", bestehend: "Bestehend (bei Einzug)", neu: "Neu entstanden" };
  const DEFECT_CAUSE = ["Normale Abnutzung", "Mieter:in", "Vermieter:in", "Vormieter:in", "Unklar"];
  const DEFECT_STATUS_LABEL = { bestehend: "bestehend", neu: "neu" };

  // Standard-Elemente einer Raum-Checkliste
  const ITEMS_BASE = ["Wände", "Boden / Bodenbelag", "Decke", "Fenster", "Türen", "Steckdosen / Elektro", "Heizkörper", "Beleuchtung"];
  // Zusätzliche Elemente je Raumtyp (per Stichwort im Namen erkannt)
  const ITEMS_BY_TYPE = [
    { match: /küche|kueche|kochnische/i, extra: ["Einbauküche", "Spüle / Armatur", "Herd / Backofen", "Dunstabzug", "Fliesen / Spritzschutz"] },
    { match: /bad|wc|dusche|sanitär|sanitaer/i, extra: ["WC", "Waschbecken / Armatur", "Dusche / Badewanne", "Fliesen", "Silikonfugen", "Lüftung"] },
    { match: /balkon|terrasse|loggia/i, extra: ["Geländer", "Entwässerung", "Außenboden"] },
    { match: /keller|abstell|estrich|dachboden/i, extra: ["Feuchtigkeit", "Regale / Verschlag"] },
  ];
  // Vorschlagsliste fürs „Element +"-Feld
  const ITEM_SUGGESTIONS = [...new Set([...ITEMS_BASE, ...ITEMS_BY_TYPE.flatMap((t) => t.extra)])];

  function defaultItemsFor(name) {
    const extra = ITEMS_BY_TYPE.filter((t) => t.match.test(name || "")).flatMap((t) => t.extra);
    return [...ITEMS_BASE, ...extra].map((label) => ({ id: Store.uid(), label, cond: "", note: "" }));
  }

  // Gesamtstatus eines Raums aus den bewerteten Elementen ableiten (mit Fallback auf Alt-Feld)
  function roomStatus(room) {
    const rated = (room.items || []).filter((i) => i.cond);
    if (rated.some((i) => i.cond === "maengel")) return "maengel";
    if (rated.some((i) => i.cond === "mittel")) return "mittel";
    if (rated.length && rated.every((i) => i.cond === "gut")) return "gut";
    return room.condition || "";
  }
  function roomRatedCount(room) {
    const items = room.items || [];
    return { rated: items.filter((i) => i.cond).length, total: items.length };
  }

  /* ----------------------------- Theme ----------------------------- */
  // Drei Modi: hell → dunkel → auto (folgt dem System). Auto reagiert live auf Systemwechsel.
  const THEME_ORDER = ["light", "dark", "auto"];
  const THEME_ICON = { light: "☾", dark: "☀", auto: "◐" };
  const THEME_TITLE = { light: "Hell (klicken für Dunkel)", dark: "Dunkel (klicken für Automatisch)", auto: "Automatisch – folgt dem System (klicken für Hell)" };
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  function resolveTheme(t) { return t === "auto" ? (darkMedia.matches ? "dark" : "light") : t; }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", resolveTheme(t));
    const btn = $("#themeToggle");
    btn.textContent = THEME_ICON[t] || "☾";
    btn.title = THEME_TITLE[t] || "";
    btn.setAttribute("aria-label", THEME_TITLE[t] || "Theme umschalten");
  }
  applyTheme(Store.getTheme());
  darkMedia.addEventListener("change", () => { if (Store.getTheme() === "auto") applyTheme("auto"); });
  $("#themeToggle").addEventListener("click", () => {
    const next = THEME_ORDER[(THEME_ORDER.indexOf(Store.getTheme()) + 1) % THEME_ORDER.length];
    Store.setTheme(next); applyTheme(next);
  });

  /* ----------------------------- Mobile-Menü ----------------------------- */
  const navToggle = $("#navToggle");
  const topnav = $("#topnav");
  function setMenu(open) {
    topnav.classList.toggle("open", open);
    navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    navToggle.setAttribute("aria-label", open ? "Menü schließen" : "Menü öffnen");
  }
  navToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    setMenu(navToggle.getAttribute("aria-expanded") !== "true");
  });
  // Menü schliessen bei Navigation, Klick ausserhalb oder Escape
  topnav.addEventListener("click", (e) => { if (e.target.closest("a")) setMenu(false); });
  document.addEventListener("click", (e) => {
    if (topnav.classList.contains("open") && !e.target.closest(".topbar")) setMenu(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setMenu(false); });

  /* ----------------------------- Tastatur-Shortcuts ----------------------------- */
  // „n" = neues Protokoll · „/" = Suche · „?" = Hilfe (nur wenn man nicht gerade tippt)
  document.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    const typing = /^(input|textarea|select)$/i.test(t.tagName || "") || t.isContentEditable;
    if (typing) return;
    if (e.key === "/") { const s = $(".search__input"); if (s) { e.preventDefault(); s.focus(); } }
    else if (e.key === "n" || e.key === "N") { location.hash = "#/neu"; }
    else if (e.key === "?") { e.preventDefault(); showShortcuts(); }
  });

  // Übersicht der Tastenkürzel als Dialog (Taste „?")
  function showShortcuts() {
    if ($(".modal-backdrop")) return; // nicht doppelt öffnen
    const backdrop = h("div", { class: "modal-backdrop" });
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    const rows = [
      ["N", "Neues Protokoll anlegen"],
      ["/", "Suche fokussieren (Übersicht)"],
      ["?", "Diese Hilfe anzeigen"],
      ["Esc", "Menü / Dialog schließen"],
    ];
    const dialog = h("div", { class: "modal", role: "dialog", "aria-modal": "true" }, [
      h("h3", { class: "modal__title" }, "Tastenkürzel"),
      h("table", { class: "kbd-table" }, rows.map(([k, d]) => h("tr", {}, [
        h("td", {}, [h("kbd", {}, k)]),
        h("td", {}, d),
      ]))),
      h("div", { class: "modal__actions" }, [
        h("button", { class: "btn btn--primary btn--sm", onclick: close }, ["Schließen"]),
      ]),
    ]);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
  }

  $("#year").textContent = new Date().getFullYear();

  /* ----------------------------- Completion ----------------------------- */
  function completion(p) {
    const checks = [
      !!(p.meta.street && p.meta.city),                 // Adresse
      p.rooms.length > 0,                               // mind. 1 Raum
      p.rooms.every((r) => roomStatus(r)),              // jeder Raum bewertet
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
        animateView();
        return;
      }
    }
    app.innerHTML = "";
    viewDashboard();
    animateView();
  }

  function markNav(hash) {
    $$(".topnav a").forEach((a) => {
      const href = a.getAttribute("href").replace(/^#/, "");
      a.classList.toggle("active", href === hash || (href === "/" && hash === "/"));
    });
  }

  // Sanfter Einblend-Übergang bei jedem Seitenwechsel (respektiert reduzierte Bewegung via CSS)
  function animateView() {
    app.classList.remove("view-anim");
    void app.offsetWidth; // Reflow erzwingen, damit die Animation neu startet
    app.classList.add("view-anim");
  }

  window.addEventListener("hashchange", navigate);
  document.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-link]");
    if (link) { /* default hash nav is fine */ }
  });

  /* ----------------------------- Konfetti ----------------------------- */
  // Kleiner Festmoment, wenn ein Protokoll 100 % erreicht oder abgeschlossen wird.
  function celebrate() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#b3502d", "#4d7240", "#a9791f", "#23211c", "#cf7048"];
    for (let i = 0; i < 40; i++) {
      const piece = h("span", {
        class: "confetti",
        style: `left:${Math.random() * 100}vw;background:${colors[i % colors.length]};` +
          `animation-duration:${1.6 + Math.random() * 1.4}s;animation-delay:${Math.random() * 0.4}s;` +
          `transform:rotate(${Math.random() * 360}deg)`,
        "aria-hidden": "true",
      });
      document.body.appendChild(piece);
      setTimeout(() => piece.remove(), 3600);
    }
  }

  /* ============================ DASHBOARD ============================ */
  function viewDashboard() {
    let list = Store.all();

    const hero = h("section", { class: "masthead" }, [
      h("div", { class: "stamp" }, "Übergabeprotokoll"),
      h("div", { class: "masthead__in" }, [
        h("span", { class: "kicker" }, "Wohnungsübergabe · Einzug & Auszug"),
        h("h1", {}, "Den Zustand der Wohnung sauber festhalten – in Minuten."),
        h("p", {}, "Räume, Mängel mit Fotos, Zählerstände und Schlüssel erfassen, direkt im Browser unterschreiben und als PDF sichern. Alles bleibt lokal auf deinem Gerät."),
        h("ul", { class: "ticks" }, [
          h("li", {}, "Kostenlos, ohne Anmeldung, ohne Cookies"),
          h("li", {}, "Funktioniert offline – Daten bleiben auf deinem Gerät"),
          h("li", {}, "Einzug ↔ Auszug vergleichen: neue Mängel & Verbrauch auf einen Blick"),
        ]),
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

    // ---- Mehrfachauswahl (Sammel-Löschen / -Favorit) ----
    let selectMode = false;
    let currentQuery = "";
    let filter = "alle";
    const selection = new Set();

    const selectBtn = list.length
      ? h("button", { class: "btn btn--ghost btn--sm", onclick: () => toggleSelectMode(!selectMode) }, ["Auswählen"])
      : null;

    const head = h("div", { class: "section-head" }, [
      h("h2", {}, "Deine Protokolle"),
      h("div", { class: "row" }, [
        selectBtn,
        h("button", { class: "btn btn--ghost btn--sm", onclick: doImport }, ["Import"]),
        list.length ? h("button", { class: "btn btn--ghost btn--sm", onclick: doExportAll }, ["Backup"]) : null,
        h("a", { class: "btn btn--primary btn--sm", href: "#/neu" }, ["Neu +"]),
      ]),
    ]);

    if (!list.length) {
      const body = h("div", { class: "card empty" }, [
        h("span", { class: "empty__emoji" }, "🗂"),
        h("h3", {}, "Noch kein Protokoll vorhanden"),
        h("p", { class: "muted" }, "Lege jetzt dein erstes Wohnungsübergabeprotokoll an."),
        h("a", { class: "btn btn--primary", href: "#/neu" }, ["Erstes Protokoll erstellen"]),
      ]);
      app.append(hero, stats, head, body);
      return;
    }

    // Grid + Live-Suche (Adresse, Namen, Räume, Typ, Status). Ab 4 Protokollen eingeblendet.
    const grid = h("div", { class: "grid grid--cards" });
    const noMatch = h("div", { class: "card empty", style: "display:none" }, [
      h("p", { class: "muted" }, "Kein Protokoll passt zu Suche oder Filter."),
    ]);

    // ---- Aktionsleiste für die Mehrfachauswahl ----
    const selCount = h("span", { class: "selbar__count" }, "0 ausgewählt");
    const selFav = h("button", { class: "btn btn--ghost btn--sm", onclick: bulkFavorite }, ["★ Favorit"]);
    const selDel = h("button", { class: "btn btn--danger btn--sm", onclick: bulkDelete }, ["Löschen"]);
    const selbar = h("div", { class: "selbar no-print", style: "display:none" }, [
      selCount,
      h("button", { class: "btn btn--ghost btn--sm", onclick: selectAll }, ["Alle"]),
      h("span", { class: "grow" }),
      selFav, selDel,
      h("button", { class: "btn btn--ghost btn--sm", onclick: () => toggleSelectMode(false) }, ["Abbrechen"]),
    ]);

    function passesFilter(p) {
      switch (filter) {
        case "favoriten": return !!p.favorite;
        case "einzug": return p.type === "einzug";
        case "auszug": return p.type === "auszug";
        case "entwurf": return p.status !== "abgeschlossen";
        case "abgeschlossen": return p.status === "abgeschlossen";
        default: return true;
      }
    }
    function visibleList() {
      const needle = currentQuery.trim().toLowerCase();
      return list.filter((p) => passesFilter(p) && (!needle || matchProtocol(p, needle)));
    }

    function updateSelbar() {
      const n = selection.size;
      selCount.textContent = `${n} ausgewählt`;
      selDel.disabled = selFav.disabled = n === 0;
    }

    function toggleSelectMode(on) {
      selectMode = on;
      selection.clear();
      selbar.style.display = on ? "" : "none";
      if (selectBtn) selectBtn.textContent = on ? "Fertig" : "Auswählen";
      updateSelbar();
      renderCards(currentQuery);
    }

    function toggleOne(id) {
      selection.has(id) ? selection.delete(id) : selection.add(id);
      updateSelbar();
      renderCards(currentQuery);
    }

    function selectAll() {
      const visible = visibleList();
      const allSel = visible.length && visible.every((p) => selection.has(p.id));
      visible.forEach((p) => (allSel ? selection.delete(p.id) : selection.add(p.id)));
      updateSelbar();
      renderCards(currentQuery);
    }

    function rerender() { app.innerHTML = ""; viewDashboard(); }

    function bulkDelete() {
      const ids = [...selection];
      if (!ids.length) return;
      const word = ids.length === 1 ? "Protokoll" : "Protokolle";
      confirmDialog({
        title: `${ids.length} ${word} löschen?`,
        message: "Die ausgewählten Protokolle werden entfernt – direkt wiederherstellbar.",
        confirmLabel: "Löschen", danger: true,
        onConfirm: () => {
          const snapshots = ids.map((id) => Store.get(id)).filter(Boolean);
          Store.removeMany(ids);
          toastAction(`${ids.length} ${word} gelöscht`, "Rückgängig", () => { snapshots.forEach((s) => Store.restore(s)); rerender(); }, "bad");
          rerender(); // aktualisiert auch die Statistik
        },
      });
    }

    function deleteFromCard(id) {
      const snap = Store.get(id);
      if (!snap) return;
      confirmDialog({
        title: "Protokoll löschen?",
        message: `„${addrLabel(snap)}" wird entfernt – direkt wiederherstellbar.`,
        confirmLabel: "Löschen", danger: true,
        onConfirm: () => {
          Store.remove(id);
          toastAction("Protokoll gelöscht", "Rückgängig", () => { Store.restore(snap); rerender(); }, "bad");
          rerender();
        },
      });
    }

    function bulkFavorite() {
      const ids = [...selection];
      if (!ids.length) return;
      ids.forEach((id) => Store.setFavorite(id, true));
      toast(`${ids.length} als Favorit markiert`);
      list = Store.all();
      toggleSelectMode(false); // verlässt Auswahl & rendert neu (Favoriten nach oben)
    }

    function onFav(p) {
      Store.setFavorite(p.id, !p.favorite);
      list = Store.all();
      renderCards(currentQuery);
    }

    function renderCards(query) {
      currentQuery = query;
      const filtered = visibleList();
      grid.innerHTML = "";
      grid.classList.toggle("grid--select", selectMode);
      filtered.forEach((p) => grid.appendChild(protocolCard(p, {
        selectMode,
        selected: selection.has(p.id),
        onToggle: () => toggleOne(p.id),
        onFav: () => onFav(p),
        onDuplicate: () => { const c = Store.duplicate(p.id); if (c) { toast("Dupliziert"); list = Store.all(); renderCards(currentQuery); } },
        onExport: () => exportOne(p),
        onDelete: () => deleteFromCard(p.id),
      })));
      noMatch.style.display = filtered.length ? "none" : "";
      const cnt = $("#searchCount");
      if (cnt) cnt.textContent = (currentQuery.trim() || filter !== "alle") ? `${filtered.length} von ${list.length}` : "";
    }

    // ---- Filter-Chips ----
    const FILTERS = [["alle", "Alle"], ["favoriten", "★ Favoriten"], ["einzug", "Einzug"], ["auszug", "Auszug"], ["entwurf", "Entwürfe"], ["abgeschlossen", "Abgeschlossen"]];
    const chips = h("div", { class: "chips no-print" }, FILTERS.map(([val, label]) =>
      h("button", {
        class: "chip" + (filter === val ? " active" : ""), "data-f": val,
        onclick: () => { filter = val; $$(".chip", chips).forEach((c) => c.classList.toggle("active", c.getAttribute("data-f") === val)); renderCards(currentQuery); },
      }, label)
    ));

    // ---- Speicheranzeige ----
    const u = Store.usage();
    const storage = h("div", { class: "storagebar no-print" + (u.percent >= 80 ? " is-warn" : ""), title: `${(u.bytes / 1048576).toFixed(2)} MB von ~5 MB belegt` }, [
      h("div", { class: "storagebar__track" }, [h("div", { class: "storagebar__fill", style: `width:${Math.max(2, u.percent)}%` })]),
      h("span", { class: "storagebar__label" }, `Speicher ${u.percent}%${u.percent >= 80 ? " · fast voll – bitte ein Backup erstellen" : ""}`),
    ]);

    const filterRow = list.length > 1 ? chips : null;

    let search = null;
    if (list.length > 3) {
      const searchInput = h("input", {
        type: "search", class: "search__input", placeholder: "Suchen: Adresse, Name, Raum, Einzug/Auszug …",
        "aria-label": "Protokolle durchsuchen",
        oninput: (e) => renderCards(e.target.value),
      });
      search = h("div", { class: "search no-print" }, [
        h("span", { class: "search__icon", "aria-hidden": "true" }, "🔍"),
        searchInput,
        h("span", { id: "searchCount", class: "search__count" }, ""),
      ]);
    }

    // null-Werte herausfiltern (append() würde sie sonst als Text „null" einfügen)
    app.append(...[hero, stats, storage, head, filterRow, search, grid, noMatch, selbar].filter(Boolean));

    renderCards("");
  }

  // Treffer, wenn jedes Suchwort irgendwo im Protokoll vorkommt (UND-Verknüpfung).
  function matchProtocol(p, needle) {
    const hay = [
      p.meta.street, p.meta.zip, p.meta.city, p.meta.floor,
      p.meta.landlord, p.meta.tenant, p.meta.notes,
      p.type === "einzug" ? "einzug" : "auszug",
      p.status === "abgeschlossen" ? "abgeschlossen" : "entwurf",
      ...p.rooms.map((r) => r.name),
    ].filter(Boolean).join(" ").toLowerCase();
    return needle.split(/\s+/).every((w) => hay.includes(w));
  }

  function stat(num, label) {
    return h("div", { class: "stat" }, [
      h("div", { class: "stat__num" }, String(num)),
      h("div", { class: "stat__label" }, label),
    ]);
  }

  function protocolCard(p, opts = {}) {
    const { selectMode = false, selected = false, onToggle, onFav, onDuplicate, onExport, onDelete } = opts;
    const pct = completion(p);
    const addr = addrLabel(p);

    const fav = h("button", {
      class: "pcard__fav" + (p.favorite ? " is-fav" : ""),
      title: p.favorite ? "Favorit entfernen" : "Als Favorit markieren",
      "aria-label": p.favorite ? "Favorit entfernen" : "Als Favorit markieren",
      "aria-pressed": p.favorite ? "true" : "false",
      onclick: (e) => { e.stopPropagation(); onFav && onFav(); },
    }, p.favorite ? "★" : "☆");

    // Aktions-Menü (⋯): Öffnen, Duplizieren, Export, Löschen
    const menu = buildCardMenu(p, { onDuplicate, onExport, onFav, onDelete });

    const card = h("div", {
      class: "card pcard" + (selectMode ? " pcard--select" : "") + (selected ? " is-selected" : ""),
      onclick: () => { selectMode ? (onToggle && onToggle()) : (location.hash = `#/p/${p.id}`); },
    }, [
      selectMode ? h("span", { class: "pcard__check", "aria-hidden": "true" }, selected ? "✓" : "") : null,
      h("div", { class: "pcard__top" }, [
        h("div", { class: "pcard__head-row" }, [
          h("span", { class: `pcard__type type--${p.type}` }, p.type === "einzug" ? "Einzug" : "Auszug"),
          selectMode ? null : fav,
        ]),
        h("div", { class: "pcard__addr" }, addr),
        h("div", { class: "pcard__sub" }, `${p.rooms.length} Räume · Übergabe ${fmtDateISO(p.meta.date)}`),
        h("div", { class: "spacer", style: "height:10px" }),
        h("div", { class: "progress" }, [h("div", { class: "progress__bar", style: `width:${pct}%` })]),
        h("div", { class: "pcard__sub", style: "margin-top:6px" }, `${pct}% vollständig`),
      ]),
      h("div", { class: "pcard__foot" }, [
        h("span", {}, [h("span", { class: `tag ${p.status === "abgeschlossen" ? "tag--ok" : ""}` }, p.status === "abgeschlossen" ? "Abgeschlossen" : "Entwurf")]),
        h("div", { class: "row", style: "gap:10px;align-items:center" }, [
          h("span", {}, `bearb. ${fmtDate(p.updatedAt)}`),
          selectMode ? null : menu,
        ]),
      ]),
    ]);
    return card;
  }

  // Popover-Menü für eine Protokollkarte. Schließt bei Klick außerhalb.
  function buildCardMenu(p, { onDuplicate, onExport, onFav, onDelete }) {
    const wrap = h("div", { class: "cardmenu" });
    const items = [
      ["Öffnen", () => (location.hash = `#/p/${p.id}`)],
      ["Duplizieren", () => onDuplicate && onDuplicate()],
      ["Teilen / Export", () => onExport && onExport()],
      Store.all().length > 1 ? ["Vergleichen …", () => openComparePicker(p)] : null,
      [p.favorite ? "Favorit entfernen" : "Als Favorit", () => onFav && onFav()],
      ["Löschen", () => onDelete && onDelete(), true],
    ].filter(Boolean);
    const listEl = h("div", { class: "cardmenu__list" }, items.map(([label, fn, danger]) =>
      h("button", { class: "cardmenu__item" + (danger ? " is-danger" : ""), onclick: (e) => { e.stopPropagation(); setOpen(false); fn(); } }, label)
    ));
    const btn = h("button", { class: "cardmenu__btn", title: "Weitere Aktionen", "aria-label": "Weitere Aktionen", "aria-haspopup": "true", onclick: (e) => { e.stopPropagation(); setOpen(!wrap.classList.contains("open")); } }, "⋯");
    function onDocClick() { setOpen(false); }
    function setOpen(v) {
      wrap.classList.toggle("open", v);
      btn.setAttribute("aria-expanded", v ? "true" : "false");
      if (v) setTimeout(() => document.addEventListener("click", onDocClick, { once: true }), 0);
      else document.removeEventListener("click", onDocClick);
    }
    wrap.append(btn, listEl);
    return wrap;
  }

  /* ============================ NEU (Start-Assistent) ============================ */
  const APT_TEMPLATES = [
    { id: "blank", label: "Leer starten", desc: "Ohne Räume – alles selbst hinzufügen", rooms: [] },
    { id: "1.5", label: "1,5 Zimmer", desc: "Zimmer · Küche · Bad · Flur", rooms: ["Zimmer", "Küche", "Bad", "Flur"] },
    { id: "2.5", label: "2,5 Zimmer", desc: "Wohnen · Schlafen · Küche · Bad · Flur", rooms: ["Wohnzimmer", "Schlafzimmer", "Küche", "Bad", "Flur"] },
    { id: "3.5", label: "3,5 Zimmer", desc: "2,5 Zimmer + Kinderzimmer", rooms: ["Wohnzimmer", "Schlafzimmer", "Kinderzimmer", "Küche", "Bad", "Flur"] },
    { id: "4.5", label: "4,5 Zimmer", desc: "3,5 Zimmer + Arbeitszimmer", rooms: ["Wohnzimmer", "Schlafzimmer", "Kinderzimmer", "Arbeitszimmer", "Küche", "Bad", "Flur"] },
    { id: "haus", label: "Haus", desc: "Alle Räume inkl. Gäste-WC & Keller", rooms: ["Wohnzimmer", "Esszimmer", "Küche", "Schlafzimmer", "Kinderzimmer", "Arbeitszimmer", "Bad", "Gäste-WC", "Flur", "Keller"] },
  ];
  const STANDARD_METERS = ["Strom", "Wasser (kalt)", "Wasser (warm)", "Heizung"];
  const STANDARD_KEYS = [["Wohnungstür", 2], ["Haustür", 1], ["Briefkasten", 1]];

  function viewNew() {
    let type = "einzug";
    let tplId = "2.5";
    let balkon = false, keller = false, withMeters = true, withKeys = true;

    const head = h("section", { class: "masthead" }, [
      h("div", { class: "masthead__in" }, [
        h("span", { class: "kicker" }, "Start-Assistent"),
        h("h1", {}, "Neues Protokoll anlegen"),
        h("p", {}, "Wähle eine Wohnungsvorlage – Räume samt Checklisten, Zähler und Schlüssel werden direkt vorbereitet. Alles lässt sich später jederzeit anpassen."),
      ]),
    ]);

    const segIn = h("button", { class: "active", onclick: () => setType("einzug") }, "Einzug");
    const segOut = h("button", { onclick: () => setType("auszug") }, "Auszug");
    function setType(t) {
      type = t;
      segIn.classList.toggle("active", t === "einzug");
      segOut.classList.toggle("active", t === "auszug");
    }

    const tiles = h("div", { class: "tpl-grid" });
    function renderTiles() {
      tiles.innerHTML = "";
      APT_TEMPLATES.forEach((t) => {
        tiles.appendChild(h("button", {
          class: "tpl" + (tplId === t.id ? " active" : ""),
          "aria-pressed": tplId === t.id ? "true" : "false",
          onclick: () => { tplId = t.id; renderTiles(); },
        }, [
          h("strong", {}, t.label),
          h("span", { class: "tpl__desc" }, t.desc),
        ]));
      });
    }
    renderTiles();

    const check = (label, initial, onchange) => h("label", { class: "check" }, [
      h("input", { type: "checkbox", checked: initial ? "checked" : null, onchange: (e) => onchange(e.target.checked) }),
      h("span", {}, label),
    ]);

    function createFromTemplate() {
      const tpl = APT_TEMPLATES.find((t) => t.id === tplId);
      const p = Store.blank();
      p.type = type;
      const rooms = [...tpl.rooms];
      if (balkon) rooms.push("Balkon");
      if (keller && !rooms.includes("Keller")) rooms.push("Keller");
      p.rooms = rooms.map((name) => ({ id: Store.uid(), name, items: defaultItemsFor(name), condition: "", note: "", defects: [] }));
      if (withMeters) p.meters = STANDARD_METERS.map((name) => ({ id: Store.uid(), name, value: "", number: "", photos: [] }));
      if (withKeys) p.keys = STANDARD_KEYS.map(([name, count]) => ({ id: Store.uid(), name, count }));
      if (!Store.save(p)) { toast("Speicher voll – Protokoll konnte nicht angelegt werden", "bad"); return; }
      toast(p.rooms.length ? `Protokoll mit ${p.rooms.length} Räumen vorbereitet` : "Leeres Protokoll angelegt");
      location.hash = `#/p/${p.id}`;
    }

    const tplCard = h("div", { class: "card" }, [
      h("div", { class: "field", style: "margin-bottom:18px" }, [
        h("label", {}, "Art der Übergabe"),
        h("div", { class: "segmented" }, [segIn, segOut]),
      ]),
      h("div", { class: "field", style: "margin-bottom:6px" }, [h("label", {}, "Wohnungsvorlage")]),
      tiles,
      h("div", { class: "row", style: "margin:16px 0 20px;gap:16px" }, [
        check("Balkon / Terrasse", false, (v) => (balkon = v)),
        check("Keller / Abstellraum", false, (v) => (keller = v)),
        check("Standard-Zähler (Strom, Wasser, Heizung)", true, (v) => (withMeters = v)),
        check("Standard-Schlüssel (Wohnung, Haus, Briefkasten)", true, (v) => (withKeys = v)),
      ]),
      h("button", { class: "btn btn--primary", onclick: createFromTemplate }, ["Protokoll erstellen →"]),
    ]);

    const list = Store.all();
    let followCard = null;
    if (list.length) {
      followCard = h("div", { class: "card", style: "margin-top:18px" }, [
        h("h2", {}, "Oder auf bestehendem Protokoll aufbauen"),
        h("p", { class: "muted", style: "font-size:.9rem" }, `Übernimmt Adresse, Parteien, Räume, Zähler und Schlüssel. Erfasste Mängel werden als „bestehend" übernommen – ideal, um aus dem Einzugs- das Auszugsprotokoll zu machen. Zustände, Zählerstände und Unterschriften bleiben bewusst leer.`),
        h("div", { class: "follow-list" }, list.slice(0, 8).map((p) => h("button", { class: "follow", onclick: () => createFollowUp(p) }, [
          h("span", { class: `pcard__type type--${p.type}` }, p.type === "einzug" ? "Einzug" : "Auszug"),
          h("strong", { class: "follow__addr" }, addrLabel(p)),
          h("span", { class: "muted follow__sub" }, `${p.rooms.length} Räume · Übergabe ${fmtDateISO(p.meta.date)}`),
          h("span", { class: "follow__cta" }, p.type === "einzug" ? "Auszugsprotokoll erstellen →" : "Einzugsprotokoll erstellen →"),
        ]))),
      ]);
    }

    app.append(...[head, tplCard, followCard].filter(Boolean));
  }

  // Folgeprotokoll: Wohnung, Räume, Zähler & Schlüssel eines bestehenden Protokolls übernehmen.
  // Mängel wandern mit Status „bestehend" mit (Fotos nicht – schont den lokalen Speicher).
  function createFollowUp(src) {
    const p = Store.blank();
    p.type = src.type === "einzug" ? "auszug" : "einzug";
    p.meta.street = src.meta.street; p.meta.zip = src.meta.zip; p.meta.city = src.meta.city;
    p.meta.floor = src.meta.floor; p.meta.landlord = src.meta.landlord; p.meta.tenant = src.meta.tenant;
    p.rooms = (src.rooms || []).map((r) => ({
      id: Store.uid(), name: r.name, condition: "", note: "",
      items: (r.items || []).map((i) => ({ id: Store.uid(), label: i.label, cond: "", note: "" })),
      defects: (r.defects || []).filter((d) => d.text).map((d) => ({ id: Store.uid(), text: d.text, status: "bestehend", cause: d.cause || "", photos: [] })),
    }));
    p.meters = (src.meters || []).map((m) => ({ id: Store.uid(), name: m.name, value: "", number: m.number, photos: [] }));
    p.keys = (src.keys || []).map((k) => ({ id: Store.uid(), name: k.name, count: k.count }));
    p.deposit = { ...p.deposit, ...(src.deposit || {}) };
    if (!Store.save(p)) { toast("Speicher voll – Protokoll konnte nicht angelegt werden", "bad"); return; }
    toast(`${p.type === "auszug" ? "Auszugs" : "Einzugs"}protokoll aus „${addrLabel(src)}" erstellt`);
    location.hash = `#/p/${p.id}`;
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
    { id: "kaution", label: "Kaution" },
    { id: "unterschrift", label: "Unterschrift" },
    { id: "zusammenfassung", label: "Zusammenfassung" },
  ];

  // Schritt-Nummer aus der Reihenfolge ableiten – so bleibt die Nummerierung
  // automatisch korrekt, auch wenn Sektionen ergänzt/umgestellt werden.
  function stepKicker(id) {
    const i = SECTIONS.findIndex((s) => s.id === id);
    return "Schritt " + String(i + 1).padStart(2, "0");
  }

  let saveWarned = false; // Speicher-voll-Warnung nur einmal pro Editor-Sitzung zeigen
  let lastPct = 0;        // um den Moment zu erkennen, in dem 100 % erreicht werden
  function touch() {
    if (saveTimer) clearTimeout(saveTimer);
    setSaveState("Speichert …");
    saveTimer = setTimeout(() => {
      if (Store.save(current)) {
        setSaveState("Gespeichert ✓");
        saveWarned = false;
        const pct = completion(current);
        if (pct === 100 && lastPct < 100) { celebrate(); toast("Protokoll 100 % vollständig 🎉"); }
        lastPct = pct;
      } else {
        setSaveState("Nicht gespeichert ⚠");
        if (!saveWarned) {
          saveWarned = true;
          toast("Speicher voll – Änderungen wurden NICHT gesichert. Bitte Fotos reduzieren und vorhandene Daten als Backup/PDF sichern.", "bad");
        }
      }
    }, 350);
  }
  function setSaveState(txt) {
    const el = $("#saveState");
    if (el) el.textContent = txt;
  }

  function viewEditor({ id }) {
    current = Store.get(id);
    if (!current) { toast("Protokoll nicht gefunden", "bad"); location.hash = "#/"; return; }
    // Migration: ältere Räume ohne Element-Checkliste mit Standardelementen befüllen
    let migrated = false;
    current.rooms.forEach((r) => {
      if (!Array.isArray(r.items)) { r.items = defaultItemsFor(r.name); migrated = true; }
    });
    if (migrated) Store.save(current);
    activeSection = "stammdaten";
    saveWarned = false;
    lastPct = completion(current);
    renderEditor();
  }

  function renderEditor() {
    app.innerHTML = "";

    const back = h("a", { class: "btn btn--ghost btn--sm", href: "#/" }, ["← Übersicht"]);
    const titleAddr = current.meta.street || "Neues Protokoll";
    const headRow = h("div", { class: "section-head no-print" }, [
      h("div", {}, [
        back,
        h("h1", { style: "margin:10px 0 2px" }, titleAddr),
        h("div", { class: "muted", style: "font-size:.9rem" }, `${current.type === "einzug" ? "Einzugs" : "Auszugs"}protokoll · ${completion(current)}% vollständig`),
      ]),
      h("div", { class: "row no-print" }, [
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => exportOne(current), title: "Als JSON exportieren oder teilen" }, ["Teilen / Export"]),
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => { const c = Store.duplicate(current.id); if (c) { toast("Dupliziert"); location.hash = `#/p/${c.id}`; } } }, ["Duplizieren"]),
        h("button", { class: "btn btn--danger btn--sm", onclick: deleteCurrent }, ["Löschen"]),
      ]),
    ]);

    // Stepper
    const stepper = h("div", { class: "stepper no-print" }, SECTIONS.map((s, i) => {
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
    app.append(headRow, stepper, panel, editbar());

    // erst rendern, wenn panel im DOM hängt – sonst misst die Unterschrift-Canvas 0×0
    renderSection(panel);
  }

  function sectionDone(id) {
    const p = current;
    switch (id) {
      case "stammdaten": return !!(p.meta.street && p.meta.city && p.meta.date);
      case "raeume": return p.rooms.length > 0 && p.rooms.every((r) => roomStatus(r));
      case "zaehler": return p.meters.length > 0 && p.meters.every((m) => m.value !== "");
      case "schluessel": return p.keys.length > 0;
      case "kaution": { const d = p.deposit || {}; return !!(d.amount || d.status); }
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
      kaution: secKaution,
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
      h("div", { class: "section-head" }, [h("div", {}, [h("span", { class: "kicker" }, stepKicker("stammdaten")), h("h2", { style: "margin-top:4px" }, "Stammdaten der Wohnung")])]),

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
      h("div", {}, [h("span", { class: "kicker" }, stepKicker("raeume")), h("h2", { style: "margin-top:4px" }, "Räume & Mängel")]),
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

    // Raumübergreifende Mängelübersicht (aktualisiert sich beim Bearbeiten automatisch)
    panel.appendChild(h("div", { class: "card no-print", style: "margin-bottom:18px" }, [
      h("div", { class: "row row--between", style: "margin-bottom:10px" }, [
        h("h3", { style: "margin:0;font-size:.95rem" }, "Mängelübersicht"),
        h("span", { class: "muted", style: "font-size:.8rem" }, "automatisch aus allen Räumen"),
      ]),
      ...defectOverviewNodes(current),
    ]));

    current.rooms.forEach((room) => panel.appendChild(roomCard(room)));
  }

  function addRoom(name) {
    current.rooms.push({ id: Store.uid(), name, items: defaultItemsFor(name), condition: "", note: "", defects: [] });
    touch(); renderSection($("#panel"));
  }

  function roomCard(room) {
    const card = h("div", { class: "room" });
    const status = roomStatus(room);
    const { rated, total } = roomRatedCount(room);

    // Reihenfolge der Räume anpassen (spiegelt sich auch in PDF & Zusammenfassung)
    const idx = current.rooms.indexOf(room);
    const move = (dir) => {
      const j = idx + dir;
      if (j < 0 || j >= current.rooms.length) return;
      current.rooms.splice(idx, 1);
      current.rooms.splice(j, 0, room);
      touch(); renderSection($("#panel"));
    };

    const head = h("div", { class: "room__head" }, [
      h("input", { class: "room__name", value: room.name, oninput: bindInput(room, "name") }),
      h("div", { class: "room__meta" }, [
        status ? h("span", { class: `tag tag--${status === "maengel" ? "bad" : status === "gut" ? "ok" : ""}` }, COND_LABEL[status]) : h("span", { class: "tag muted" }, "unbewertet"),
        room.defects.length ? h("span", { class: "tag tag--bad" }, `${room.defects.length} ${room.defects.length > 1 ? "Mängel" : "Mangel"}`) : null,
        h("button", { class: "icon-x icon-move", title: "Raum nach oben", "aria-label": "Raum nach oben verschieben", disabled: idx === 0 ? "" : null, onclick: () => move(-1) }, ["↑"]),
        h("button", { class: "icon-x icon-move", title: "Raum nach unten", "aria-label": "Raum nach unten verschieben", disabled: idx === current.rooms.length - 1 ? "" : null, onclick: () => move(1) }, ["↓"]),
        h("button", { class: "icon-x", title: "Raum löschen", onclick: () => confirmDialog({ title: "Raum löschen?", message: `„${room.name || "Raum"}" samt erfasster Mängel wird entfernt.`, confirmLabel: "Löschen", danger: true, onConfirm: () => { current.rooms = current.rooms.filter((r) => r.id !== room.id); touch(); renderSection($("#panel")); } }) }, ["✕"]),
      ]),
    ]);

    // Element-Checkliste
    const checklistHead = h("div", { class: "row row--between", style: "margin-bottom:10px" }, [
      h("h3", { style: "font-size:.92rem;margin:0" }, `Checkliste · ${rated}/${total} bewertet`),
      h("button", { class: "btn btn--ghost btn--sm", title: "Alle unbewerteten Elemente auf „Gut\" setzen", onclick: () => { room.items.forEach((it) => { if (!it.cond) it.cond = "gut"; }); touch(); renderSection($("#panel")); } }, ["Rest = Gut"]),
    ]);

    const itemsWrap = h("div", { class: "items" });
    const colHead = h("div", { class: "item-row item-row--head" }, [
      h("span", { class: "col-head" }, "Element"),
      h("span", { class: "col-head", style: "text-align:center" }, "Zustand"),
      h("span", { class: "col-head" }, "Notiz (optional)"),
      h("span", {}, ""),
    ]);
    itemsWrap.appendChild(colHead);
    room.items.forEach((it) => itemsWrap.appendChild(itemRow(room, it)));

    const addItem = h("button", { class: "btn btn--ghost btn--sm", style: "margin-top:6px", onclick: () => { room.items.push({ id: Store.uid(), label: "", cond: "", note: "" }); touch(); renderSection($("#panel")); } }, ["Element +"]);

    const note = field("Allgemeine Notiz zum Raum", input(room.note, bindInput(room, "note"), "z. B. frisch gestrichen, besenrein übergeben"), true);

    const defectsWrap = h("div", {});
    room.defects.forEach((d) => defectsWrap.appendChild(defectRow(room, d)));
    const addDefect = h("button", { class: "btn btn--ghost btn--sm", onclick: () => { room.defects.push({ id: Store.uid(), text: "", status: "", cause: "", photos: [] }); touch(); renderSection($("#panel")); } }, ["Mangel mit Foto erfassen +"]);

    const body = h("div", { class: "room__body" }, [
      checklistHead, itemsWrap, addItem,
      h("hr", { class: "divider" }),
      note,
      h("div", { class: "spacer", style: "height:6px" }),
      h("h3", { style: "font-size:.92rem;margin-bottom:10px" }, "Gesonderte Mängel & Fotos"),
      defectsWrap, addDefect,
    ]);

    card.append(head, body);
    return card;
  }

  function itemRow(room, it) {
    const dlId = "items_" + it.id;
    const labelIn = input(it.label, bindInput(it, "label"), "Element benennen");
    labelIn.setAttribute("list", dlId);
    const conds = h("div", { class: "cond-mini" }, ["gut", "mittel", "maengel"].map((c) =>
      h("button", {
        class: `cond-mini__btn ${it.cond === c ? "active" : ""}`, "data-cond": c,
        title: COND_LABEL[c],
        onclick: () => { it.cond = it.cond === c ? "" : c; touch(); renderSection($("#panel")); },
      }, COND_SHORT[c])
    ));
    return h("div", { class: "item-row" }, [
      h("div", {}, [labelIn, h("datalist", { id: dlId }, ITEM_SUGGESTIONS.map((s) => h("option", { value: s })))]),
      conds,
      input(it.note, bindInput(it, "note"), ""),
      h("button", { class: "icon-x", title: "Element entfernen", onclick: () => { room.items = room.items.filter((x) => x.id !== it.id); touch(); renderSection($("#panel")); } }, ["✕"]),
    ]);
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

    // Einordnung: bestehend/neu + Verursacher (für die Kostenfrage)
    const statusSel = h("select", { class: "defect__select", onchange: bindInput(d, "status") },
      Object.entries(DEFECT_STATUS).map(([v, label]) => h("option", { value: v }, label)));
    statusSel.value = d.status || "";
    const causeDl = "cause_" + d.id;
    const causeIn = input(d.cause, bindInput(d, "cause"), "Verursacher (z. B. normale Abnutzung)");
    causeIn.setAttribute("list", causeDl);

    return h("div", { class: "defect" }, [
      h("span", { class: "defect__marker" }, "!"),
      h("div", { style: "flex:1" }, [
        input(d.text, bindInput(d, "text"), "Mangel beschreiben, z. B. Kratzer im Parkett vor dem Fenster"),
        h("div", { class: "defect__meta" }, [
          statusSel,
          h("div", {}, [causeIn, h("datalist", { id: causeDl }, DEFECT_CAUSE.map((c) => h("option", { value: c })))]),
        ]),
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
      h("div", {}, [h("span", { class: "kicker" }, stepKicker("zaehler")), h("h2", { style: "margin-top:4px" }, "Zählerstände")]),
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
    current.meters.push({ id: Store.uid(), name, value: "", number: "", photos: [] });
    touch(); renderSection($("#panel"));
  }

  function meterRow(mt) {
    mt.photos = mt.photos || [];
    const thumbs = h("div", { class: "defect__thumbs", style: "margin-top:6px" });
    mt.photos.forEach((src, idx) => {
      thumbs.appendChild(h("div", { class: "thumb" }, [
        h("img", { src, alt: "Zählerfoto" }),
        h("button", { title: "Foto entfernen", onclick: () => { mt.photos.splice(idx, 1); touch(); renderSection($("#panel")); } }, ["✕"]),
      ]));
    });
    const fileInput = h("input", { type: "file", accept: "image/*", capture: "environment", multiple: true, onchange: (e) => handlePhotos(e, mt) });
    const photoLabel = h("label", { class: "photo-btn" }, ["Zähler fotografieren", fileInput]);

    const row = h("div", { class: "meter-row", style: "margin-bottom:6px" }, [
      input(mt.name, bindInput(mt, "name"), "z. B. Strom"),
      input(mt.value, bindInput(mt, "value"), "z. B. 24561,3"),
      input(mt.number, bindInput(mt, "number"), "Zählernr. (optional)"),
      h("button", { class: "icon-x", onclick: () => { current.meters = current.meters.filter((x) => x.id !== mt.id); touch(); renderSection($("#panel")); } }, ["✕"]),
    ]);
    return h("div", { style: "margin-bottom:14px" }, [row, h("div", { class: "row" }, [photoLabel]), thumbs]);
  }

  /* ---------- 4. Schlüssel ---------- */
  function secSchluessel(panel) {
    const head = h("div", { class: "section-head" }, [
      h("div", {}, [h("span", { class: "kicker" }, stepKicker("schluessel")), h("h2", { style: "margin-top:4px" }, "Schlüsselübergabe")]),
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

  /* ---------- Kaution / Depot ---------- */
  const DEPOSIT_STATUS = { "": "Status wählen …", offen: "Noch offen", hinterlegt: "Hinterlegt / bezahlt", zurueck: "Zurückgezahlt" };
  const DEPOSIT_STATUS_LABEL = { offen: "offen", hinterlegt: "hinterlegt", zurueck: "zurückgezahlt" };

  function secKaution(panel) {
    const d = current.deposit || (current.deposit = { amount: "", currency: "CHF", account: "", status: "", notes: "" });

    const statusSel = h("select", { onchange: bindInput(d, "status") },
      Object.entries(DEPOSIT_STATUS).map(([v, l]) => h("option", { value: v }, l)));
    statusSel.value = d.status || "";

    const currencySel = h("select", { onchange: bindInput(d, "currency") },
      ["CHF", "EUR"].map((c) => h("option", { value: c }, c)));
    currencySel.value = d.currency || "CHF";

    const card = h("div", { class: "card" }, [
      h("div", { class: "section-head" }, [h("div", {}, [h("span", { class: "kicker" }, stepKicker("kaution")), h("h2", { style: "margin-top:4px" }, "Kaution / Mietzinsdepot")])]),
      h("p", { class: "muted" }, "Optional: Höhe und Status der Mietkaution festhalten. Mängel, die der Mieter:in zuzurechnen sind, können die Rückzahlung betreffen."),
      h("div", { class: "form-grid" }, [
        field("Betrag", input(d.amount, bindInput(d, "amount"), "z. B. 2400", "number")),
        field("Währung", currencySel),
        field("Status", statusSel),
        field("Konto / IBAN (optional)", input(d.account, bindInput(d, "account"), "z. B. Sperrkonto bei …")),
        field("Anmerkungen zur Kaution", textarea(d.notes, bindInput(d, "notes"), "z. B. Abzug für neu entstandene Mängel vereinbart …"), true),
      ]),
    ]);
    panel.appendChild(card);
  }

  /* ---------- 5. Unterschrift ---------- */
  function secUnterschrift(panel) {
    const card = h("div", { class: "card" }, [
      h("div", { class: "section-head" }, [h("div", {}, [h("span", { class: "kicker" }, stepKicker("unterschrift")), h("h2", { style: "margin-top:4px" }, "Unterschriften")])]),
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
        sigStateEl(key),
      ]),
    ]);
    return wrap;
  }

  // Status-Anzeige „Unterschrieben / Noch nicht unterschrieben" – lässt sich live aktualisieren
  function sigStateEl(key) {
    const signed = !!current.signatures[key];
    return h("span", {
      id: "sigstate_" + key,
      class: signed ? "tag tag--ok" : "muted",
      style: signed ? "" : "font-size:.82rem;align-self:center",
    }, signed ? "Unterschrieben" : "Noch nicht unterschrieben");
  }
  function updateSigState(key) {
    const el = $("#sigstate_" + key);
    if (el) el.replaceWith(sigStateEl(key));
  }

  // Unterschrift immer dunkel speichern (bleibt im PDF/hellen Modus sichtbar),
  // Anzeige je nach Theme einfärben – im Dunkelmodus weiß.
  const SIG_INK = "#1a1a1a";
  function recolorSig(src, w, h, color) {
    const off = document.createElement("canvas");
    off.width = w; off.height = h;
    const o = off.getContext("2d");
    o.drawImage(src, 0, 0, w, h);
    o.globalCompositeOperation = "source-in"; // nur die Striche umfärben, Transparenz erhalten
    o.fillStyle = color;
    o.fillRect(0, 0, w, h);
    return off;
  }

  function setupSignaturePad(key) {
    const canvas = $("#pad_" + key);
    if (!canvas) return;
    const dark = document.documentElement.getAttribute("data-theme") === "dark";
    const inkLive = dark ? "#ffffff" : SIG_INK;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = inkLive;

    // vorhandene (dunkel gespeicherte) Unterschrift in Theme-Farbe anzeigen
    if (current.signatures[key]) {
      const img = new Image();
      img.onload = () => ctx.drawImage(recolorSig(img, canvas.width, canvas.height, inkLive), 0, 0, rect.width, rect.height);
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
        // immer dunkel speichern, damit die Unterschrift im PDF/hellen Modus sichtbar bleibt
        current.signatures[key] = recolorSig(canvas, canvas.width, canvas.height, SIG_INK).toDataURL("image/png");
        updateSigState(key);
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
      h("div", {}, [h("span", { class: "kicker" }, stepKicker("zusammenfassung")), h("h2", { style: "margin-top:4px" }, "Zusammenfassung & Export")]),
      h("div", { class: "row" }, [
        Store.all().length > 1 ? h("button", { class: "btn btn--ghost btn--sm", onclick: () => openComparePicker(p), title: "Mit einem zweiten Protokoll vergleichen (z. B. Einzug ↔ Auszug)" }, ["Vergleichen …"]) : null,
        h("button", { class: "btn btn--ghost btn--sm", onclick: () => {
          p.status = p.status === "abgeschlossen" ? "entwurf" : "abgeschlossen";
          if (!Store.save(p)) { toast("Speicher voll – Status konnte nicht gesichert werden. Bitte ein Backup/PDF erstellen.", "bad"); }
          else if (p.status === "abgeschlossen") { toast("Als abgeschlossen markiert · Tipp: jetzt als PDF speichern oder Backup erstellen."); celebrate(); }
          else { toast("Wieder als Entwurf"); }
          renderSection($("#panel"));
        } }, [p.status === "abgeschlossen" ? "Als Entwurf markieren" : "Protokoll abschließen"]),
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

  /* ---------- Mängelübersicht (raumübergreifend) ---------- */
  // Sammelt alle Mängel über alle Räume: gesonderte Mängel + als „Mängel" bewertete Checklisten-Elemente.
  function collectDefects(p) {
    const out = [];
    p.rooms.forEach((r) => {
      const roomName = r.name || "Raum";
      (r.defects || []).forEach((d) => out.push({
        room: roomName,
        text: d.text || "Mangel ohne Beschreibung",
        status: d.status || "",
        cause: d.cause || "",
        photos: (d.photos || []).length,
      }));
      (r.items || []).filter((i) => i.cond === "maengel").forEach((i) => out.push({
        room: roomName,
        text: (i.label || "Element") + (i.note ? " – " + i.note : ""),
        status: "",
        cause: "",
        photos: 0,
      }));
    });
    return out;
  }

  function defectStatusCell(status) {
    if (status === "neu") return h("span", { class: "tag tag--bad" }, "neu");
    if (status === "bestehend") return h("span", { class: "tag" }, "bestehend");
    return h("span", { class: "muted" }, "—");
  }

  // Knoten (Zähl-Badges + Tabelle) – genutzt im Editor (Schritt 02) und in der Zusammenfassung.
  function defectOverviewNodes(p) {
    const defs = collectDefects(p);
    if (!defs.length) {
      return [h("p", { class: "muted", style: "margin:0" }, "Keine Mängel erfasst – die Wohnung ist mängelfrei dokumentiert.")];
    }
    const neu = defs.filter((d) => d.status === "neu").length;
    const best = defs.filter((d) => d.status === "bestehend").length;
    const withPhotos = defs.reduce((n, d) => n + d.photos, 0);
    const badges = h("div", { class: "row", style: "gap:8px;margin-bottom:12px;flex-wrap:wrap" }, [
      h("span", { class: "tag tag--bad" }, `${defs.length} ${defs.length === 1 ? "Mangel" : "Mängel"}`),
      neu ? h("span", { class: "tag tag--bad" }, `${neu} neu entstanden`) : null,
      best ? h("span", { class: "tag" }, `${best} bestehend`) : null,
      withPhotos ? h("span", { class: "tag" }, `${withPhotos} Foto${withPhotos === 1 ? "" : "s"}`) : null,
    ]);
    const table = h("table", { class: "sum-table" }, [
      h("tr", {}, [
        h("th", { style: "width:20%" }, "Raum"),
        h("th", {}, "Mangel"),
        h("th", { style: "width:14%" }, "Status"),
        h("th", { style: "width:20%" }, "Verursacher"),
        h("th", { style: "width:56px" }, "Fotos"),
      ]),
      ...defs.map((d) => h("tr", {}, [
        h("td", {}, d.room),
        h("td", {}, d.text),
        h("td", {}, defectStatusCell(d.status)),
        h("td", {}, d.cause || "—"),
        h("td", {}, d.photos ? String(d.photos) : "—"),
      ])),
    ]);
    return [badges, table];
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

      h("h2", {}, "Mängelübersicht"),
      ...defectOverviewNodes(p),

      h("h2", {}, "Räume"),
      p.rooms.length ? h("div", {}, p.rooms.map(sumRoom)) : h("p", { class: "muted" }, "Keine Räume erfasst."),

      h("h2", {}, "Zählerstände"),
      p.meters.length ? h("div", {}, [
        h("table", { class: "sum-table" }, [
          h("tr", {}, [h("th", {}, "Zähler"), h("th", {}, "Stand"), h("th", {}, "Zählernummer")]),
          ...p.meters.map((m) => h("tr", {}, [h("td", {}, m.name || "—"), h("td", {}, m.value || "—"), h("td", {}, m.number || "—")])),
        ]),
        ...meterPhotos(p),
      ]) : h("p", { class: "muted" }, "Keine Zähler erfasst."),

      h("h2", {}, "Schlüssel"),
      p.keys.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", {}, "Art"), h("th", {}, "Anzahl")]),
        ...p.keys.map((k) => h("tr", {}, [h("td", {}, k.name || "—"), h("td", {}, String(k.count || 0))])),
      ]) : h("p", { class: "muted" }, "Keine Schlüssel erfasst."),

      h("h2", {}, "Kaution / Mietzinsdepot"),
      depositSummary(p),

      h("h2", {}, "Unterschriften"),
      h("div", { class: "sum-sigs" }, [
        sumSig("Vermieter:in", p.meta.landlord, p.signatures.landlord),
        sumSig("Mieter:in", p.meta.tenant, p.signatures.tenant),
      ]),

      h("div", { class: "disclaimer" }, [
        h("strong", {}, "Hinweis: "),
        "Wohnprotokoll ist ein Hilfsmittel zur Dokumentation des Wohnungszustands und stellt keine Rechtsberatung dar. Für Vollständigkeit, Richtigkeit und Rechtsgültigkeit dieses Protokolls wird keine Gewähr übernommen. Maßgeblich sind die getroffenen Vereinbarungen der Parteien sowie die geltenden gesetzlichen Bestimmungen. Im Zweifel ziehe rechtlichen Rat hinzu.",
      ]),

      h("p", { class: "muted", style: "margin-top:16px;font-size:.78rem" }, `Erstellt mit Wohnprotokoll · ${fmtDate(p.createdAt)} · Dieses Protokoll dokumentiert den Zustand der Wohnung zum Übergabezeitpunkt.`),
    ]);
    return doc;
  }

  function sumRoom(r) {
    const status = roomStatus(r);
    const condClass = status === "maengel" ? "bad" : status === "mittel" ? "warn" : "ok";
    const photos = r.defects.flatMap((d) => d.photos || []);
    const rated = (r.items || []).filter((i) => i.label || i.cond);
    return h("div", { class: "sum-room" }, [
      h("div", { class: "row row--between" }, [
        h("strong", {}, r.name || "Raum"),
        h("span", { class: "tag", style: `color:var(--${condClass});border-color:var(--${condClass})` }, status ? COND_LABEL[status] : "ohne Bewertung"),
      ]),
      rated.length ? h("table", { class: "sum-table", style: "margin:10px 0 0" }, [
        h("tr", {}, [h("th", { style: "width:45%" }, "Element"), h("th", { style: "width:20%" }, "Zustand"), h("th", {}, "Notiz")]),
        ...rated.map((i) => h("tr", {}, [
          h("td", {}, i.label || "—"),
          h("td", { style: i.cond ? `color:var(--${i.cond === "maengel" ? "bad" : i.cond === "mittel" ? "warn" : "ok"});font-weight:700` : "" }, i.cond ? COND_LABEL[i.cond] : "—"),
          h("td", {}, i.note || ""),
        ])),
      ]) : null,
      r.note ? h("div", { class: "muted", style: "margin-top:6px" }, "Notiz: " + r.note) : null,
      r.defects.length ? h("ul", { style: "margin:8px 0 0;padding-left:18px" }, r.defects.map((d) => {
        const tags = [DEFECT_STATUS_LABEL[d.status], d.cause].filter(Boolean).join(" · ");
        return h("li", {}, [
          d.text || "Mangel ohne Beschreibung",
          tags ? h("span", { class: "muted", style: "font-size:.85rem" }, ` (${tags})`) : null,
        ]);
      })) : null,
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

  function meterPhotos(p) {
    const photos = p.meters.flatMap((m) => m.photos || []);
    return photos.length ? [h("div", { class: "sum-photos" }, photos.map((src) => h("img", { src })))] : [];
  }

  function depositSummary(p) {
    const d = p.deposit || {};
    if (!d.amount && !d.status && !d.account && !d.notes) return h("p", { class: "muted" }, "Keine Kaution erfasst.");
    return h("table", { class: "sum-table" }, [
      d.amount ? rowTH("Betrag", `${d.amount} ${d.currency || "CHF"}`) : null,
      d.status ? rowTH("Status", DEPOSIT_STATUS_LABEL[d.status] || d.status) : null,
      d.account ? rowTH("Konto / IBAN", d.account) : null,
      d.notes ? rowTH("Anmerkungen", d.notes) : null,
    ]);
  }

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
    const snap = current;
    confirmDialog({
      title: "Protokoll löschen?",
      message: `„${addrLabel(snap)}" wird entfernt – du kannst das Löschen direkt rückgängig machen.`,
      confirmLabel: "Löschen", danger: true,
      onConfirm: () => {
        Store.remove(snap.id);
        location.hash = "#/";
        toastAction("Protokoll gelöscht", "Rückgängig", () => { Store.restore(snap); location.hash = `#/p/${snap.id}`; }, "bad");
      },
    });
  }

  /* ============================ VERGLEICH ============================ */
  // Normalisierte Adresse für die Kandidatensuche (gleiche Wohnung erkennen)
  function normAddr(p) {
    return [p.meta.street, p.meta.zip, p.meta.city].map((s) => String(s || "").trim().toLowerCase()).join("|");
  }

  // Zählerstand als Zahl interpretieren (Schweizer/deutsche Schreibweisen: 24'561,3 / 24 561.3)
  function meterNum(v) {
    if (v == null || v === "") return null;
    const n = parseFloat(String(v).trim().replace(/['\s]/g, "").replace(",", "."));
    return isNaN(n) ? null : n;
  }
  const fmtNum = (n) => n.toLocaleString("de-CH", { maximumFractionDigits: 2 });

  // Auswahl-Dialog: mit welchem zweiten Protokoll vergleichen?
  function openComparePicker(p) {
    const others = Store.all().filter((x) => x.id !== p.id);
    if (!others.length) { toast("Kein zweites Protokoll zum Vergleichen vorhanden", "bad"); return; }
    const hasAddr = normAddr(p) !== "||";
    const sameAddr = new Set(others.filter((x) => hasAddr && normAddr(x) === normAddr(p)).map((x) => x.id));
    others.sort((x, y) => (sameAddr.has(y.id) ? 1 : 0) - (sameAddr.has(x.id) ? 1 : 0));

    const backdrop = h("div", { class: "modal-backdrop" });
    const close = () => { backdrop.remove(); document.removeEventListener("keydown", onKey); };
    function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); } }
    const dialog = h("div", { class: "modal modal--wide", role: "dialog", "aria-modal": "true" }, [
      h("h3", { class: "modal__title" }, "Vergleichen mit …"),
      h("p", { class: "modal__msg" }, `„${addrLabel(p)}" einem zweiten Protokoll gegenüberstellen – typisch: Einzug und Auszug derselben Wohnung.`),
      h("div", { class: "follow-list" }, others.slice(0, 12).map((o) => h("button", { class: "follow", onclick: () => { close(); location.hash = `#/vergleich/${p.id}/${o.id}`; } }, [
        h("span", { class: `pcard__type type--${o.type}` }, o.type === "einzug" ? "Einzug" : "Auszug"),
        h("strong", { class: "follow__addr" }, addrLabel(o)),
        h("span", { class: "muted follow__sub" }, `${fmtDateISO(o.meta.date)}${sameAddr.has(o.id) ? " · gleiche Adresse" : ""}`),
      ]))),
      h("div", { class: "modal__actions" }, [h("button", { class: "btn btn--ghost btn--sm", onclick: close }, ["Abbrechen"])]),
    ]);
    backdrop.appendChild(dialog);
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) close(); });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(backdrop);
  }

  const SEVERITY = { "": 0, gut: 1, mittel: 2, maengel: 3 };

  function viewCompare({ a, b }) {
    let A = Store.get(a), B = Store.get(b);
    if (!A || !B) { toast("Protokoll für den Vergleich nicht gefunden", "bad"); location.hash = "#/"; return; }
    // „Vorher" ist das Einzugsprotokoll bzw. bei gleichem Typ das ältere Übergabedatum
    const rank = (p) => (p.type === "einzug" ? 0 : 1);
    if (rank(A) > rank(B) || (rank(A) === rank(B) && (A.meta.date || "") > (B.meta.date || ""))) { const t = A; A = B; B = t; }

    const typeLabel = (p) => (p.type === "einzug" ? "Einzug" : "Auszug");
    const head = h("section", { class: "masthead" }, [
      h("div", { class: "stamp" }, "Vergleich"),
      h("div", { class: "masthead__in" }, [
        h("span", { class: "kicker" }, `${typeLabel(A)} ↔ ${typeLabel(B)}`),
        h("h1", {}, addrLabel(B)),
        h("p", {}, `Gegenüberstellung der Übergaben vom ${fmtDateISO(A.meta.date)} („Vorher") und ${fmtDateISO(B.meta.date)} („Nachher").`),
        h("div", { class: "btn-row row no-print" }, [
          h("a", { class: "btn btn--ghost btn--sm", href: `#/p/${A.id}` }, [`← ${typeLabel(A)} öffnen`]),
          h("a", { class: "btn btn--ghost btn--sm", href: `#/p/${B.id}` }, [`${typeLabel(B)} öffnen →`]),
          h("button", { class: "btn btn--primary btn--sm", onclick: () => window.print() }, ["Als PDF / Drucken"]),
        ]),
      ]),
    ]);

    // ---- Mängel-Bilanz ----
    const defsA = collectDefects(A), defsB = collectDefects(B);
    const neuB = defsB.filter((d) => d.status === "neu");
    const defCard = h("div", { class: "card", style: "margin-bottom:18px" }, [
      h("h2", {}, "Mängel-Bilanz"),
      h("div", { class: "row", style: "gap:8px;margin-bottom:12px;flex-wrap:wrap" }, [
        h("span", { class: "tag" }, `Vorher: ${defsA.length}`),
        h("span", { class: "tag" }, `Nachher: ${defsB.length}`),
        neuB.length ? h("span", { class: "tag tag--bad" }, `${neuB.length} neu entstanden`) : h("span", { class: "tag tag--ok" }, "keine neuen Mängel markiert"),
      ]),
      defsB.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", { style: "width:22%" }, "Raum"), h("th", {}, "Mangel (Nachher)"), h("th", { style: "width:14%" }, "Status"), h("th", { style: "width:20%" }, "Verursacher")]),
        ...defsB.map((d) => h("tr", { class: d.status === "neu" ? "is-worse" : "" }, [
          h("td", {}, d.room), h("td", {}, d.text), h("td", {}, defectStatusCell(d.status)), h("td", {}, d.cause || "—"),
        ])),
      ]) : h("p", { class: "muted", style: "margin:0" }, `Im „Nachher"-Protokoll sind keine Mängel erfasst.`),
      neuB.length ? h("p", { class: "muted", style: "margin:12px 0 0;font-size:.82rem" }, "Neu entstandene Mängel sind für die Kostenfrage relevant (wer trägt Instandstellung / Abzug von der Kaution).") : null,
    ]);

    // ---- Zähler & Verbrauch ----
    const mA = new Map((A.meters || []).filter((m) => m.name).map((m) => [String(m.name).trim().toLowerCase(), m]));
    const meterRows = [];
    (B.meters || []).forEach((m) => {
      const key = String(m.name || "").trim().toLowerCase();
      const prev = mA.get(key); if (prev) mA.delete(key);
      const nA = prev ? meterNum(prev.value) : null;
      const nB = meterNum(m.value);
      const diff = nA !== null && nB !== null ? nB - nA : null;
      meterRows.push(h("tr", {}, [
        h("td", {}, m.name || "—"),
        h("td", {}, prev && prev.value !== "" ? String(prev.value) : "—"),
        h("td", {}, m.value !== "" ? String(m.value) : "—"),
        h("td", { class: "num" }, diff === null ? "—" : h("strong", { class: diff < 0 ? "delta--warn" : "" }, (diff > 0 ? "+" : "") + fmtNum(diff))),
      ]));
    });
    mA.forEach((prev) => meterRows.push(h("tr", {}, [
      h("td", {}, prev.name), h("td", {}, prev.value !== "" ? String(prev.value) : "—"), h("td", {}, "—"), h("td", { class: "num" }, "—"),
    ])));
    const meterCard = h("div", { class: "card", style: "margin-bottom:18px" }, [
      h("h2", {}, "Zählerstände & Verbrauch"),
      meterRows.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", {}, "Zähler"), h("th", {}, "Vorher"), h("th", {}, "Nachher"), h("th", { style: "width:18%" }, "Differenz")]),
        ...meterRows,
      ]) : h("p", { class: "muted", style: "margin:0" }, "Keine Zähler erfasst."),
      meterRows.length ? h("p", { class: "muted", style: "margin:12px 0 0;font-size:.82rem" }, "Differenz = Verbrauch zwischen den beiden Übergaben. Ein negativer Wert deutet auf einen Zählerwechsel oder Tippfehler hin.") : null,
    ]);

    // ---- Räume: Zustandsänderung ----
    const rA = new Map((A.rooms || []).map((r) => [String(r.name || "").trim().toLowerCase(), r]));
    const roomRows = [];
    (B.rooms || []).forEach((r) => {
      const key = String(r.name || "").trim().toLowerCase();
      const prev = rA.get(key); if (prev) rA.delete(key);
      const sA = prev ? roomStatus(prev) : null;
      const sB = roomStatus(r);
      let delta = null;
      if (sA !== null && sA !== "" && sB !== "") delta = SEVERITY[sB] - SEVERITY[sA];
      roomRows.push(h("tr", { class: delta > 0 ? "is-worse" : "" }, [
        h("td", {}, r.name || "Raum"),
        h("td", {}, prev ? (sA ? COND_LABEL[sA] : "unbewertet") : "—"),
        h("td", {}, sB ? COND_LABEL[sB] : "unbewertet"),
        h("td", {}, delta === null ? h("span", { class: "muted" }, "—")
          : delta > 0 ? h("span", { class: "tag tag--bad" }, "verschlechtert")
          : delta < 0 ? h("span", { class: "tag tag--ok" }, "verbessert")
          : h("span", { class: "tag" }, "unverändert")),
      ]));
    });
    rA.forEach((prev) => roomRows.push(h("tr", {}, [
      h("td", {}, prev.name || "Raum"), h("td", {}, roomStatus(prev) ? COND_LABEL[roomStatus(prev)] : "unbewertet"), h("td", {}, "—"), h("td", {}, h("span", { class: "muted" }, "nur vorher")),
    ])));
    const roomCardEl = h("div", { class: "card", style: "margin-bottom:18px" }, [
      h("h2", {}, "Räume im Vergleich"),
      roomRows.length ? h("table", { class: "sum-table" }, [
        h("tr", {}, [h("th", {}, "Raum"), h("th", {}, "Vorher"), h("th", {}, "Nachher"), h("th", { style: "width:18%" }, "Veränderung")]),
        ...roomRows,
      ]) : h("p", { class: "muted", style: "margin:0" }, "Keine Räume erfasst."),
    ]);

    // ---- Schlüssel-Bilanz ----
    const count = (p) => (p.keys || []).reduce((n, k) => n + (parseInt(k.count) || 0), 0);
    const kA = count(A), kB = count(B);
    const keyCard = h("div", { class: "card" }, [
      h("h2", {}, "Schlüssel"),
      h("p", { style: "margin:0" }, [
        `Vorher übergeben: ${kA} · Nachher zurückgegeben: ${kB} — `,
        kA === kB ? h("span", { class: "tag tag--ok" }, "vollständig")
          : h("span", { class: "tag tag--bad" }, `${Math.abs(kA - kB)} ${kA > kB ? "fehlen" : "mehr als vorher"}`),
      ]),
    ]);

    app.append(head, defCard, meterCard, roomCardEl, keyCard);
  }

  /* ============================ INFO ============================ */
  const FAQ = [
    ["Ist Wohnprotokoll wirklich kostenlos?", "Ja, komplett. Keine Anmeldung, kein Abo, keine versteckten Kosten. Die App läuft vollständig in deinem Browser – es gibt keinen Server, der bezahlt werden müsste."],
    ["Wo werden meine Daten gespeichert?", "Ausschließlich lokal auf deinem Gerät (im Browser-Speicher). Nichts wird hochgeladen. Deshalb: Erstelle regelmäßig ein Backup (JSON) oder ein PDF – wenn du den Browser-Speicher löschst, sind die Daten weg."],
    ["Ist das Protokoll rechtsgültig?", "Das Protokoll dokumentiert den Zustand der Wohnung und wird von beiden Parteien unterschrieben – das ist als Beweismittel wertvoll. Wohnprotokoll ist aber keine Rechtsberatung; im Zweifel wende dich an den Mieter- oder Hauseigentümerverband."],
    ["Funktioniert die App offline?", `Ja. Einmal geöffnet, funktioniert alles auch ohne Internet. Auf dem Handy kannst du sie über „Zum Home-Bildschirm hinzufügen" wie eine App installieren.`],
    ["Wie komme ich vom Einzugs- zum Auszugsprotokoll?", `Beim Anlegen eines neuen Protokolls „auf bestehendem Protokoll aufbauen" wählen: Adresse, Räume, Zähler und Schlüssel werden übernommen, erfasste Mängel gelten als „bestehend". Danach kannst du beide Protokolle vergleichen – neue Mängel und Verbrauch auf einen Blick.`],
    ["Wie übertrage ich Protokolle auf ein anderes Gerät?", `In der Übersicht „Backup" wählen (exportiert alle Protokolle als JSON-Datei), die Datei aufs andere Gerät bringen und dort über „Import" einlesen. Einzelne Protokolle lassen sich auch direkt teilen.`],
    ["Wie viele Fotos kann ich speichern?", "Fotos werden automatisch verkleinert und komprimiert. Der Browser-Speicher fasst etwa 5 MB – das reicht für ein normales Protokoll mit Fotos. Die Speicheranzeige in der Übersicht warnt dich, bevor es eng wird."],
  ];

  function viewInfo() {
    const features = [
      ["🧭", "Start-Assistent", "Wohnungsvorlagen (1,5 bis 4,5 Zimmer oder Haus) legen Räume, Zähler und Schlüssel automatisch an."],
      ["🔁", "Einzug ↔ Auszug", "Auszugsprotokoll aus dem Einzug erstellen und beide vergleichen: neue Mängel, Verbrauch, Schlüssel-Bilanz."],
      ["🪟", "Räume & Mängel", "Zustand pro Raum bewerten, Mängel beschreiben und mit Fotos belegen."],
      ["📋", "Mängelübersicht", "Alle Mängel raumübergreifend auf einen Blick – mit Status (neu/bestehend) und Verursacher."],
      ["📸", "Fotos direkt erfassen", "Bilder werden automatisch komprimiert und im Protokoll gespeichert – auch für Zählerstände."],
      ["⚡", "Zählerstände", "Strom, Gas und Wasser inkl. Zählernummer und Foto dokumentieren."],
      ["🗝️", "Schlüsselübergabe", "Art und Anzahl aller übergebenen Schlüssel festhalten."],
      ["💰", "Kaution / Depot", "Höhe und Status der Mietkaution festhalten – relevant bei neuen Mängeln."],
      ["🖋️", "Digitale Unterschrift", "Beide Parteien unterschreiben direkt im Browser – per Maus oder Finger."],
      ["🧾", "PDF-Export & Teilen", "Sauberes Protokoll als PDF drucken oder einzeln als Datei teilen."],
      ["📲", "Offline & installierbar", "Als App aufs Handy installieren und ohne Internet nutzen. Daten bleiben lokal."],
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
          li("Zähler, Schlüssel & Kaution", "Zählerstände ablesen, Schlüssel notieren und optional die Kaution festhalten."),
          li("Unterschreiben", "Beide Parteien unterschreiben digital direkt im Browser."),
          li("PDF exportieren", "Protokoll als PDF speichern, ausdrucken oder teilen – fertig."),
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
      ]),
      h("div", { class: "card", style: "margin-top:24px" }, [
        h("h2", {}, "Häufige Fragen"),
        h("div", { class: "faq" }, FAQ.map(([q, a]) =>
          h("details", { class: "faq__item" }, [
            h("summary", {}, q),
            h("p", { class: "muted", style: "margin:10px 0 4px;font-size:.92rem" }, a),
          ])
        )),
      ]),
      h("div", { class: "card", style: "margin-top:24px" }, [
        h("h2", {}, "Tastenkürzel"),
        h("table", { class: "kbd-table" }, [
          h("tr", {}, [h("td", {}, [h("kbd", {}, "N")]), h("td", {}, "Neues Protokoll anlegen")]),
          h("tr", {}, [h("td", {}, [h("kbd", {}, "/")]), h("td", {}, "Suche fokussieren (Übersicht)")]),
          h("tr", {}, [h("td", {}, [h("kbd", {}, "?")]), h("td", {}, "Hilfe mit allen Kürzeln anzeigen")]),
          h("tr", {}, [h("td", {}, [h("kbd", {}, "Esc")]), h("td", {}, "Menü oder Dialog schließen")]),
        ]),
      ]),
      h("div", { class: "card", style: "margin-top:24px" }, [
        h("h2", {}, "Rechtlicher Hinweis"),
        h("p", { class: "muted", style: "margin:0;font-size:.9rem" }, "Wohnprotokoll ist ein Werkzeug zur Dokumentation des Wohnungszustands und ersetzt keine Rechtsberatung. Für die Vollständigkeit, Richtigkeit und Rechtsgültigkeit der erstellten Protokolle wird keine Gewähr übernommen. Maßgeblich bleiben die Vereinbarungen zwischen Mieter:in und Vermieter:in sowie die geltenden gesetzlichen Bestimmungen. Bei rechtlichen Fragen wende dich an eine fachkundige Stelle (z. B. Mieter- oder Vermieterverband)."),
      ])
    );
  }
  function li(t, d) { return h("li", {}, [h("div", {}, [h("strong", {}, t), h("div", { class: "muted", style: "font-size:.9rem" }, d)])]); }

  /* ============================ ROUTES ============================ */
  route("/", viewDashboard);
  route("/neu", viewNew);
  route("/info", viewInfo);
  route("/p/:id", viewEditor);
  route("/vergleich/:a/:b", viewCompare);

  // Globale Editor-Aktionen (Löschen) per Tastatur/Übersicht
  window.WP = { deleteCurrent, duplicate: (id) => { const c = Store.duplicate(id); if (c) { toast("Dupliziert"); navigate(); } } };

  /* ============================ PWA (Offline / Installierbar) ============================ */
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => { /* z. B. file:// – kein SW möglich */ });
    });
  }

  /* ============================ START ============================ */
  navigate();
})();
