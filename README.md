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
index.html    Grundgerüst & Layout (inkl. SEO-/Social-Meta)
styles.css    Design (Hell/Dunkel-Theme, responsiv, Druck-Layout)
storage.js    Speicher-Layer (localStorage, Backup/Import)
app.js        SPA-Logik (Router, Editor, Unterschrift-Pad, PDF)
404.html      Fallback → leitet unbekannte URLs zurück zur App
robots.txt    Suchmaschinen-Freigabe + Sitemap-Verweis
sitemap.xml   Sitemap für Suchmaschinen
CNAME         Eigene Domain für GitHub Pages (wohnprotokoll.ch)
```

## Live schalten (GitHub Pages + eigene Domain)

Reine statische Seite – kein Build nötig.

1. **Repo → Settings → Pages**: Source = Branch `main`, Ordner `/ (root)`.
2. **Custom domain**: `wohnprotokoll.ch` eintragen (entspricht der `CNAME`-Datei) und **Enforce HTTPS** aktivieren.
3. **DNS beim Domain-Anbieter** für die Apex-Domain `wohnprotokoll.ch`:
   - 4 × `A` auf die GitHub-Pages-IPs: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   - *(optional)* `www` als `CNAME` auf `<dein-github-user>.github.io.`
4. DNS-Propagation abwarten, dann läuft die App unter `https://wohnprotokoll.ch/`.

## Hinweis

Alle Daten bleiben lokal auf deinem Gerät. Lösche den Browser-Speicher → Daten weg.
Für ein Backup nutze in der Übersicht **⬇️ Backup**.
