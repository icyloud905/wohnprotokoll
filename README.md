# 🏠 Wohnprotokoll

Digitales **Wohnungsübergabeprotokoll** für Einzug & Auszug – komplett im Browser, ohne Server, ohne Tracking.

## Was die App kann

| Bereich | Funktion |
|---|---|
| 🏠 **Stammdaten** | Adresse, Etage, Datum, Vermieter:in & Mieter:in, Einzug/Auszug |
| 🛋️ **Räume & Mängel** | Räume (mit Vorlagen) anlegen, Zustand bewerten (Gut / Gebrauchsspuren / Mängel), Mängel beschreiben |
| 📷 **Fotos** | Mängel fotografieren – Bilder werden automatisch komprimiert |
| 🔢 **Zählerstände** | Strom, Gas, Wasser inkl. Zählernummer |
| 🔑 **Schlüssel** | Art & Anzahl übergebener Schlüssel |
| ✍️ **Unterschrift** | Beide Parteien unterschreiben digital (Maus/Finger) |
| 📄 **PDF-Export** | Sauberes Protokoll drucken / als PDF speichern |
| 💾 **Offline** | Alles liegt im `localStorage` des Browsers |
| 🔁 **Backup** | Export/Import als JSON |
| 🌙 **Dark Mode** | Hell-/Dunkel-Umschaltung |

## Starten

Einfach **`index.html`** im Browser öffnen. Keine Installation, kein Build nötig.

## Dateien

```
index.html    Grundgerüst & Layout
styles.css    Design (Hell/Dunkel-Theme, responsiv, Druck-Layout)
storage.js    Speicher-Layer (localStorage, Backup/Import)
app.js        SPA-Logik (Router, Editor, Unterschrift-Pad, PDF)
```

## Hinweis

Alle Daten bleiben lokal auf deinem Gerät. Lösche den Browser-Speicher → Daten weg.
Für ein Backup nutze in der Übersicht **⬇️ Backup**.
