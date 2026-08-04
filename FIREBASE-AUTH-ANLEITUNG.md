# Firebase Auth für Logistik + Lieferscheine – Einrichtung

Stand 28.07.2026. Die Seiten `logistik.html` und `lieferscheine.html` verlangen neu einen
echten Login (E-Mail/Passwort, Firebase Authentication) statt des Zahlen-Codes 7188.
Technik: `assets/js/nalp-auth.js` (REST, kein SDK). Alle übrigen Seiten behalten das Zahlen-Gate.

ACHTUNG Frist: Die Testmodus-Regeln der Datenbank laufen am **30./31.07.2026** ab –
bis dahin müssen die neuen Regeln (Schritt 5) veröffentlicht sein, sonst steht das Portal.

## Schritte in der Firebase Console (console.firebase.google.com, Projekt highscore-test-2e784)

1. **Authentication → Jetzt starten → Anmeldemethode → „E-Mail/Passwort" aktivieren**
   (nur die erste Option, „E-Mail-Link" nicht nötig).

2. **Nutzer anlegen** (Authentication → Nutzer → „Nutzer hinzufügen"), Vorschlag:
   - victor.malt@strabag.com
   - info@schuoler-logistik.ch (Sandro)
   - samuel.decurtins@strabag.com
   - mike.berndt@strabag.com
   Je ein Startpasswort vergeben und den Leuten mitteilen (Passwort-Reset geht
   später über die Console, „⋮ → Passwort zurücksetzen").

3. **Selbstregistrierung sperren:** Authentication → Einstellungen → Nutzeraktionen →
   Häkchen bei „Erstellen (Registrierung)" ENTFERNEN. (Sonst könnte sich jeder mit dem
   öffentlichen API-Key selbst ein Konto machen.)

4. **Web-API-Schlüssel kopieren:** Zahnrad → Projekteinstellungen → Allgemein →
   „Web-API-Schlüssel" → in `assets/js/nalp-auth.js` bei `var API_KEY = '…'` eintragen.
   (Der Key darf öffentlich sein – der Schutz kommt aus Regeln + Konten.)

5. **Erst NACH Deployment der Seiten** die Datenbank-Regeln ersetzen
   (Realtime Database → Regeln → Veröffentlichen):

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "logistik":       { ".read": "auth != null", ".write": "auth != null" },
    "lieferscheine":  { ".read": "auth != null", ".write": "auth != null" },
    "erfassung":      { ".read": true, ".write": true },
    "standorte":      { ".read": true, ".write": true },
    "scores":         { ".read": true, ".write": true },
    "scores_creeper": { ".read": true, ".write": true }
  }
}
```

## Reihenfolge (wichtig, damit nichts ausfällt)

1. Console-Schritte 1–4 (Konten existieren, Key im Code).
2. Seiten pushen (GitHub Pages), auf einem Gerät Login testen.
3. Regeln aus Schritt 5 veröffentlichen → ab jetzt sind `logistik/*` und
   `lieferscheine/*` nur noch mit Login erreichbar; Highscore/Erfassung laufen offen weiter.
4. Sandro kurz informieren: Neu mit E-Mail + Passwort anmelden (einmalig pro Gerät,
   danach bleibt er angemeldet).

## Offene Punkte / bewusste Kompromisse

- `erfassung`, `standorte`, `scores` bleiben vorerst offen (kein Ablaufdatum mehr).
  Bei Bedarf später gleich absichern (nalp-auth.js in stellen.html/erfassungen.html einbinden).
- Fotos liegen als Base64 in der RTDB – bei Speicherproblemen später auf Firebase Storage umbauen.
- Regelmässig Backup: Realtime Database → Daten → ⋮ → „JSON exportieren".
