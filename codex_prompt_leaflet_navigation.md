# Codex Prompt: Navigation in bestehende Leaflet-Karte integrieren

## Ausgangslage

Es gibt bereits eine funktionierende `index.html` mit Leaflet für die NalpSolar-Karte.

Die bestehende Version enthält bereits:

- Leaflet-Karte
- Layer für Bereiche
- Layer für Modultische
- Layer für Kranstandorte
- gruppiertes Layerfenster rechts oben
- einklappbares Layerfenster
- ID-Suchfunktion für Modultische
- Tisch-Beschriftungen mit schwarzem Text und weissem Halo direkt um die Buchstaben
- GPS-Button
- Button `Alle`
- Button `Tisch-Labels`
- Statusfeld mit Erstellzeit

Diese bestehende Datei soll weiterentwickelt werden. Nicht neu aufbauen. Bestehende Daten, Layer, Farben, Popups, Labels und Funktionen erhalten.

## Ziel

Eine Navigationsfunktion einbauen, damit man auf dem Handy oder PC nach Klick auf einen Modultisch oder Kranstandort direkt dorthin navigieren kann.

## Gewünschtes Verhalten

Wenn der Benutzer auf einen Modultisch klickt:

1. Popup öffnen
2. bestehende Informationen anzeigen
3. zusätzlich einen Button anzeigen:

```html
<button class="nav-btn">Navigation starten</button>
```

Wenn der Benutzer auf einen Kranstandort klickt:

1. Popup öffnen
2. bestehende Informationen anzeigen
3. zusätzlich denselben Navigationsbutton anzeigen

Beim Klick auf `Navigation starten` soll die Navigation zur Position des angeklickten Objekts geöffnet werden.

## Navigationsziel

Für Modultische:

- Zielkoordinate soll der Mittelpunkt des Polygons sein
- Nicht irgendein Polygon-Eckpunkt
- Wenn möglich Leaflet-Methode verwenden:

```js
const center = layer.getBounds().getCenter();
```

Für Kranstandorte:

- Wenn Kranstandorte Punktobjekte sind: Punktkoordinate verwenden
- Wenn Kranstandorte Kreis-/Polygonobjekte sind: Mittelpunkt/Bounds-Center verwenden
- Falls bereits ein Marker oder Kreiszentrum vorhanden ist, dieses Zentrum verwenden

## Navigation öffnen

Beim Klick auf den Button soll ein externer Kartenlink geöffnet werden.

Priorität:

1. Auf Handy soll Google Maps App oder Apple Maps funktionieren
2. Auf PC soll Google Maps im Browser funktionieren

Ein robuster Ansatz:

```js
function openNavigation(lat, lng) {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  if (isIOS) {
    window.open(`https://maps.apple.com/?daddr=${lat},${lng}`, "_blank");
  } else {
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking`, "_blank");
  }
}
```

Wichtig:

- `lat` und `lng` müssen WGS84 sein
- Leaflet verwendet bereits WGS84
- Keine LV95-Koordinaten an Google Maps übergeben
- Standardmässig `travelmode=walking`, weil Baustelle/Gelände
- Nicht automatisch ohne Benutzerklick öffnen, Browser blockieren sonst Popups

## Technische Umsetzung

Eine Hilfsfunktion ergänzen:

```js
function navButtonHtml(lat, lng) {
  return `<br><br><button class="nav-btn" onclick="openNavigation(${lat}, ${lng})">Navigation starten</button>`;
}
```

Button-Styling ergänzen:

```css
.nav-btn {
  border: 0;
  border-radius: 9px;
  padding: 8px 10px;
  font-weight: 700;
  background: #ffffff;
  box-shadow: 0 1px 6px rgba(0,0,0,.25);
  cursor: pointer;
  touch-action: manipulation;
}

.nav-btn:active {
  transform: translateY(1px);
}
```

Bei Modultisch-Layern:

- Dort wo aktuell `bindPopup(...)` gemacht wird, Popup-Inhalt erweitern
- Zentrum berechnen
- Navigationsbutton anfügen

Beispiel:

```js
onEachFeature: function(feature, layer) {
  const p = feature.properties || {};
  const center = layer.getBounds().getCenter();

  const popupHtml = `
    <b>Modultisch ${p.id ?? p.ID ?? p.Title ?? ""}</b><br>
    Typ: ${p.tisch_typ ?? p.Typ ?? ""}<br>
    ${navButtonHtml(center.lat, center.lng)}
  `;

  layer.bindPopup(popupHtml);
}
```

Nicht exakt dieses Popup erzwingen, falls bereits ein besseres Popup existiert. Bestehenden Popup-Inhalt behalten und nur den Button ergänzen.

Bei Kranstandort-Layern:

- Dasselbe Prinzip
- Zielkoordinate aus Markerposition oder Layer-Mittelpunkt

Beispiel für Marker:

```js
const latlng = layer.getLatLng();
popupHtml += navButtonHtml(latlng.lat, latlng.lng);
```

Beispiel für Polygon/Kreis:

```js
const center = layer.getBounds ? layer.getBounds().getCenter() : layer.getLatLng();
popupHtml += navButtonHtml(center.lat, center.lng);
```

## Zusätzliche Funktion: Navigation aus Suchresultat

Wenn die ID-Suche einen Modultisch findet und darauf zoomt:

- Popup soll geöffnet werden
- Navigationsbutton soll dort ebenfalls vorhanden sein
- Kein separater Button in der Suche nötig

## Mobile-Anforderungen

- Button im Popup muss auf Handy gut klickbar sein
- Popup darf nicht zu breit werden
- Kein automatischer Standortzugriff erforderlich
- Bestehende GPS-Funktion nicht verändern

CSS ergänzen:

```css
.leaflet-popup-content .nav-btn {
  width: 100%;
  max-width: 220px;
}
```

## Akzeptanzkriterien

Nach der Umsetzung muss Folgendes funktionieren:

1. Klick auf Modultisch öffnet Popup
2. Popup enthält `Navigation starten`
3. Klick auf Button öffnet Google Maps oder Apple Maps mit Zielkoordinate
4. Ziel liegt beim Mittelpunkt des gewählten Modultischs
5. Klick auf Kranstandort öffnet Popup
6. Popup enthält `Navigation starten`
7. Klick auf Button öffnet Navigation zum Kranstandort
8. ID-Suche funktioniert weiterhin
9. Layerauswahl funktioniert weiterhin
10. Tisch-Labels mit weissem Buchstaben-Halo bleiben unverändert
11. Karte funktioniert auf Desktop und Handy
12. Keine externen Build-Tools nötig, weiterhin reine `index.html`

## Wichtig

- Keine komplette Neuimplementierung
- Kein Framework einbauen
- Leaflet-Version beibehalten
- Bestehende eingebettete GeoJSON-Daten nicht löschen
- Bestehende Layernamen und Buttons erhalten
- Nur gezielt Navigation ergänzen und falls nötig Popup-Code bereinigen
- Am Ende vollständige aktualisierte `index.html` ausgeben
