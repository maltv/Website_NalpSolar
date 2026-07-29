# Transport-Ladegestell für Knieträger & Quertraversen (Riegel)

**Plansatz:** [`Ladegestell_Knietraeger_Quertraversen.pdf`](Ladegestell_Knietraeger_Quertraversen.pdf) · 4 Blätter A3 · Stand 29.07.2026 · **VORABZUG zur Bewilligungseingabe**

## Worum geht es

Eigener Anhänger-Aufbau (Unterkonstruktion / Ladegestell), damit Knieträger **oder**
Quertraversen ohne externen Transporteur auf die Baustelle gefahren werden können.
Ein Grundgestell (3 Joche UNP140 + steckbare Rungen + Zurrpunkte) deckt beide Fälle ab:

- **Variante Q – Quertraversen (Riegel):** flach gebündelt zwischen den Rungen,
  Länge bis 7620 mm ⇒ Überhang vorne/hinten je ≈ 1.56 m (markieren, VRV Art. 73).
- **Variante K – Knieträger:** Die vormontierte Einheit Stütze talseitig + Auflagerträger
  hat flachliegend ein Hüllmass von ca. **4.9 × 3.3 m** – flach verladen überschreitet das
  die zulässige Fahrzeugbreite (2.55 m). Darum **hochkant am steckbaren A-Bock**
  (wie Binder-Transport), max. 3 Stück je Seite.

## Begriffe (Baustelle ↔ Plan)

| Baustellenbegriff | Offiziell im Plan (Mauchle / Montagekonzept) |
|---|---|
| Quertraverse / Querträger | **Riegel** (Achsmass Mikropfähle 7394 mm, alle Typen) |
| Knieträger | vormontierte Einheit **Stütze talseitig + Auflagerträger** (2 Stk. je Tisch) |

## Transportrelevante Bauteilmasse (Typ 2026, aus `stahlbau/Primaerkonstruktion_Typ*_2026.pdf`)

| Typ | Riegel-Profil | Breite über alles | Stütze talseitig | Auflagerträger | ≈ kg Riegel | ≈ kg Knieträger* |
|---|---|---|---|---|---|---|
| A | RRK180×100×5 | 7514 | RRK160×6 · 3655 | HEA120 | 160 | 215 |
| B | RRK180×100×6 | 7534 | RRK180×6 · 3645 | HEA140 | 190 | 250 |
| C | RRK200×150×6 | 7554 | RRK220×6 · 3610 | HEA160 | 245 | 305 |
| D | RRK250×150×6 | 7574 | RRK250×8 · 3639 | HEA180 | 280 | 405 |
| E | RRK250×250×6 | 7614 | RRW300×8.8 · 3655 | HEA220 | 355 | 540 |

\* Gewichtsschätzung ±15 % (Profil-Metergewichte × Längen + Platten). Auflagerträger-Länge
≈ 3.9 m und Knieträger-Hüllmasse sind **aus den Plänen abgeleitete Annahmen** – vor der
Fertigung an einem vormontierten Stück nachmessen (Prüfliste auf Blatt 4).

## Wichtig vor der Eingabe / Ausführung

Der Plansatz ist ein KI-erstellter **Entwurf**. Für die Bewilligung bzw. vor dem Bau braucht es:
statischen Nachweis des Gestells durch eine Fachperson (EN 1090 / SIA 263), Nachweis der
Ladungssicherung (EN 12195-1) und die Eignung/Zulassung des Basisanhängers
(Fahrzeugausweis, Nutzlast ≥ 3 t, Brücke ≥ 4300 × 2050 mm, Stützlast).

Erzeugt mit `plansatz_ladegestell.py` (Python + matplotlib) – Skript anpassen und neu
laufen lassen, wenn Nachmessungen andere Werte ergeben.
