// nalp-passstueck-abz.js — ABZ-Konstanten (Tal) je Tischtyp für den Passstück-Rechner
// GENERIERT am 2026-07-15 aus der ILF-Konstantentabelle (Blatt 'Beschreibung' der
// Freigabedatei 20260619_1041_Freigabe_Passtuecke_batch_6_ILF_260619.xlsx, identisch Batch 1).
// PS_Tal [mm] = (SOLL UK Modul − IST OK Pfahl)·1000 − ABZ_PBL_T(Typ)   (Nalpi-Formel, D. Rathgeb 20.04.2026)
// Empirische Verifikation 15.07.2026: 178 Tal-Bestellpositionen mit IST-Höhen aus ILF-Freigaben
// nachgerechnet — Abweichung 0.0 mm (MAD 0.0) bei allen geprüften Typen.
// NICHT von Hand editieren — bei neuer ILF-Tabelle neu generieren.
window.NALP_PS_ABZ_DEFAULTS = {
 "A": {
  "wert": 853.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben)"
 },
 "B": {
  "wert": 843.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 2 Bestellpositionen Tal (MAD 0.0)"
 },
 "C": {
  "wert": 979.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben)"
 },
 "D": {
  "wert": 1157.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben)"
 },
 "E": {
  "wert": 1289.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 20 Bestellpositionen Tal (MAD 0.0)"
 },
 "A_2025": {
  "wert": 882.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben)"
 },
 "B_2025": {
  "wert": 877.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 78 Bestellpositionen Tal (MAD 0.0)"
 },
 "D_2025": {
  "wert": 1182.4,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben)"
 },
 "E_2025": {
  "wert": 1310.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 44 Bestellpositionen Tal (MAD 0.0)"
 },
 "E_KF2025": {
  "wert": 1289.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 32 Bestellpositionen Tal (MAD 0.0)"
 },
 "B_KF2025": {
  "wert": 856.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); empirisch best\u00e4tigt an 2 Bestellpositionen Tal (MAD 0.0)"
 },
 "D_KF2025": {
  "wert": 1157.0,
  "quelle": "ILF-Konstantentabelle (Blatt 'Beschreibung', Freigabedatei Batch 6, 19.06.2026); ohne empirische Stichprobe (keine IST-H\u00f6hen in den vorliegenden Freigaben); ACHTUNG: Werte identisch mit Typ D 2026er Serie \u2013 vor Nutzung bei ILF kl\u00e4ren"
 }
};
window.NALP_PS_ABZ_QUELLE = "ILF-Konstantentabelle (Freigabe Batch 6, 19.06.2026); Typen B/E/B_2025/E_2025/B_KF2025/E_KF2025 empirisch an 178 Bestellpositionen best\u00e4tigt (MAD 0.0). 2027er-Tische: Serie 2026 angenommen \u2013 vor erster Bestellung mit ILF best\u00e4tigen.";
// Vollständige Typ-Konstanten (auch Berg) für spätere Berg-Implementierung (Formel aus Nalpi nötig):
window.NALP_PS_KONSTANTEN = {
 "A": {
  "MT_H": 123.0,
  "EPSILON": 30.0,
  "L_A50": 1351.0,
  "L_L": 144.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 3389.0,
  "ABZ_PBL_B2": 247.0,
  "ABZ_PBL_T": 853.0
 },
 "B": {
  "MT_H": 128.0,
  "EPSILON": 30.0,
  "L_A50": 1352.0,
  "L_L": 157.0,
  "ABS_PS_B_MIN": 110.0,
  "ABZ_PBL_B": 2836.0,
  "ABZ_PBL_B2": 271.0,
  "ABZ_PBL_T": 843.0
 },
 "C": {
  "MT_H": 107.0,
  "EPSILON": 30.0,
  "L_A50": 1286.0,
  "L_L": 203.0,
  "ABS_PS_B_MIN": 160.0,
  "ABZ_PBL_B": 2525.0,
  "ABZ_PBL_B2": 255.0,
  "ABZ_PBL_T": 979.0
 },
 "D": {
  "MT_H": 130.0,
  "EPSILON": 30.0,
  "L_A50": 1306.0,
  "L_L": 194.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 2432.0,
  "ABZ_PBL_B2": 255.0,
  "ABZ_PBL_T": 1157.0
 },
 "E": {
  "MT_H": 140.0,
  "EPSILON": 30.0,
  "L_A50": 1304.0,
  "L_L": 200.0,
  "ABS_PS_B_MIN": 240.0,
  "ABZ_PBL_B": 2363.0,
  "ABZ_PBL_B2": 380.0,
  "ABZ_PBL_T": 1289.0
 },
 "A_2025": {
  "MT_H": 146.0,
  "EPSILON": 30.0,
  "L_A50": 1354.0,
  "L_L": 147.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 3896.0,
  "ABZ_PBL_B2": 290.0,
  "ABZ_PBL_T": 882.0
 },
 "B_2025": {
  "MT_H": 151.0,
  "EPSILON": 30.0,
  "L_A50": 1345.0,
  "L_L": 157.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 3353.0,
  "ABZ_PBL_B2": 280.0,
  "ABZ_PBL_T": 877.0
 },
 "D_2025": {
  "MT_H": 172.0,
  "EPSILON": 30.0,
  "L_A50": 1310.0,
  "L_L": 204.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 2913.0,
  "ABZ_PBL_B2": 240.0,
  "ABZ_PBL_T": 1182.4
 },
 "E_2025": {
  "MT_H": 180.0,
  "EPSILON": 30.0,
  "L_A50": 1309.0,
  "L_L": 210.0,
  "ABS_PS_B_MIN": 115.0,
  "ABZ_PBL_B": 3015.0,
  "ABZ_PBL_B2": 380.0,
  "ABZ_PBL_T": 1310.0
 },
 "E_KF2025": {
  "MT_H": 140.0,
  "EPSILON": 30.0,
  "L_A50": 1304.0,
  "L_L": 200.0,
  "ABS_PS_B_MIN": 240.0,
  "ABZ_PBL_B": 2368.0,
  "ABZ_PBL_B2": 385.0,
  "ABZ_PBL_T": 1289.0
 },
 "B_KF2025": {
  "MT_H": 128.0,
  "EPSILON": 30.0,
  "L_A50": 1352.0,
  "L_L": 157.0,
  "ABS_PS_B_MIN": 110.0,
  "ABZ_PBL_B": 2845.0,
  "ABZ_PBL_B2": 280.0,
  "ABZ_PBL_T": 856.0
 },
 "D_KF2025": {
  "MT_H": 130.0,
  "EPSILON": 30.0,
  "L_A50": 1306.0,
  "L_L": 194.0,
  "ABS_PS_B_MIN": 120.0,
  "ABZ_PBL_B": 2432.0,
  "ABZ_PBL_B2": 255.0,
  "ABZ_PBL_T": 1157.0
 }
};
