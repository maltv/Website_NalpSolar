# Birkhuhn-Jagd als eigene App auf Firebase Hosting

Alles ist vorbereitet (`firebase.json`, `.firebaserc` zeigt auf dein Projekt
`highscore-test-2e784`). Es fehlen nur noch **3 Befehle auf deinem Rechner**
(einmalig Node.js installiert vorausgesetzt):

```bash
cd Website_NalpSolar          # Repository-Ordner
npx firebase-tools login      # Google-Login im Browser
npx firebase-tools deploy --only hosting
```

Danach läuft die Spiel-App unter:

- **https://highscore-test-2e784.web.app**  ← direkt die Birkhuhn-Jagd
  (die Startseite leitet auf `game.html` → Spiel-Vollbildmodus)

## Ohne Firebase geht es auch sofort

Die Spiel-App ist bereits jetzt über GitHub Pages erreichbar:

- **https://maltv.github.io/Website_NalpSolar/game.html**

Auf dem Handy öffnen → «Zum Startbildschirm hinzufügen» → du bekommst eine
eigene App **«Birkhuhn-Jagd»** (eigenes Icon, Vollbild, ohne Karten-/Mess-UI).

## Was der Spiel-Modus (`?game=1`) macht

- eigenes App-Manifest (Name «Birkhuhn-Jagd», Vogel-Icon, Vollbild)
- Toolbar, Menüs, Mess-Panel, Legende und Kompass ausgeblendet
- startet direkt im Spiel-Startbildschirm; nach «Schliessen» wieder Startbildschirm
- Highscore (lokal + globale Firebase-Rangliste) funktioniert unverändert
