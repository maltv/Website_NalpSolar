/* Tresor-Seiten des Portals (bestand.html, chronologie.html – WERKZEUGE §93, 09.11.2026).
   Die eigentliche Seite liegt AES-256-GCM-verschlüsselt in uploads/bestand/*.enc.json, weil das Website-Repo öffentlich ist
   (Rechnungsbeträge, Lieferanten, Register). Format wie verschiebungen.html: PBKDF2-SHA256 → AES-GCM, gebaut von
   Tools\Inventur_Portal_Bauen.py. Nach dem Entschlüsseln ersetzt die Seite das ganze Dokument (document.write).
   Darum hier NICHTS auf oberster Ebene ausser window.nalpTresor: let/const der Seite blieben sonst doppelt deklariert. */
(function () {
  'use strict';
  function b64(t) {
    var b = atob(t), a = new Uint8Array(b.length);
    for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    return a;
  }
  function entschluesseln(p, pw) {
    return crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey'])
      .then(function (basis) {
        return crypto.subtle.deriveKey({ name: 'PBKDF2', salt: b64(p.salt), iterations: p.iter, hash: 'SHA-256' },
          basis, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
      })
      .then(function (key) { return crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(p.iv) }, key, b64(p.ct)); })
      .then(function (klar) { return JSON.parse(new TextDecoder().decode(klar)); });
  }

  // url = verschlüsselte Seite; schluessel = localStorage-Name des gemerkten Passworts (bestand + chronologie teilen eines)
  window.nalpTresor = function (url, schluessel) {
    var KEY = schluessel || 'nalp_tresor_bestand_v1';
    var $ = function (id) { return document.getElementById(id); };
    var paket = null;
    function holen() {
      if (paket) return Promise.resolve(paket);
      return fetch(url, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) { paket = j; return j; });
    }
    function oeffnen(pw, merken, still) {
      $('fehler').textContent = 'einen Moment …';
      holen()
        .then(function (p) { return entschluesseln(p, pw); })
        .then(function (j) {
          if (merken) { try { localStorage.setItem(KEY, pw); } catch (e) { /* privates Fenster: ohne Merken weiter */ } }
          document.open(); document.write(j.html); document.close();
        })
        .catch(function (e) {
          if (!e || e.name !== 'OperationError') console.error(e);   // OperationError = falsches Passwort, kein Fehler
          if (still && paket) {   // gemerktes Passwort gilt nicht mehr (neu gesetzt): vergessen, Maske zeigen
            try { localStorage.removeItem(KEY); } catch (x) { /* egal */ }
            $('fehler').textContent = 'Das gemerkte Passwort gilt nicht mehr – bitte neu eingeben.';
            return;
          }
          $('fehler').textContent = paket ? 'Passwort stimmt nicht.' : 'Die Daten sind gerade nicht erreichbar – bitte später nochmals.';
          $('pw').select();
        });
    }
    $('tresor').addEventListener('submit', function (e) { e.preventDefault(); oeffnen($('pw').value.trim(), $('merken').checked, false); });
    if (!window.crypto || !crypto.subtle) { $('fehler').textContent = 'Dieser Browser kann hier nicht entschlüsseln (nur über https).'; return; }
    var gemerkt = null;
    try { gemerkt = localStorage.getItem(KEY); } catch (e) { /* egal */ }
    if (gemerkt) oeffnen(gemerkt, false, true);
  };
})();
