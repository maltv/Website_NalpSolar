/*
 * nalp-anweisungen.js — Arbeitsanweisungen je Konstruktion + Rueckmeldung der Leute.
 *
 * EIN Datenstand fuer alle Seiten (Entscheid Victor 19.08.2026): wer auf einer
 * Seite rueckmeldet, meldet fuer alle. Eingebunden in
 *   stahlbau.html      (PZ2025-Restliste, Spalte «Stand»)
 *   verschrauben.html  (Reiter «Anweis.»)
 *   vormontage.html    (Reiter «Anweisungen»)
 *   admin.html         (Bauleitung liest die Rueckmeldungen)
 *
 * Quellen der ANWEISUNGEN (nur lesen):
 *   RTDB erfassung/verschrauben_anweisungen/<Id> = {text, von, ts, bis, erledigt}
 *        — von der Bauleitung im Admin-Reiter «Anweisungen» gepflegt
 *   uploads/pz2025.json  = die 17 PZ2025-Restkonstruktionen mit Vorkommnis-Text
 *        — am 19.08.2026 aus stahlbau.html ausgelagert, damit nicht jede Seite
 *          eine eigene Kopie fuehrt
 *
 * RUECKMELDUNG (schreiben):
 *   RTDB erfassung/anweisung_rueck/<Id>/<pushKey>
 *        = {status:'ok'|'stop'|'frage', text, von, ts, seite}
 *   Historie, nichts wird ueberschrieben. Der Stand eines Tisches ist die
 *   juengste Rueckmeldung.
 *
 * ALTBESTAND: erfassung/pz2025_status/<Id> = true war das alte Haekchen in
 *   stahlbau.html — ohne Name und ohne Datum. Wird gelesen und als
 *   «abgehakt, ohne Name» angezeigt, aber nie in eine Rueckmeldung umgedeutet.
 *
 * Ohne Empfang: die Rueckmeldung liegt in localStorage nalp_anw_pending_v1 und
 * geht beim naechsten Laden mit Netz automatisch raus.
 */
(function () {
  'use strict';

  var RTDB  = 'https://highscore-test-2e784-default-rtdb.europe-west1.firebasedatabase.app/erfassung';
  var P_ANW = RTDB + '/verschrauben_anweisungen';
  var P_RUE = RTDB + '/anweisung_rueck';
  var P_ALT = RTDB + '/pz2025_status';
  var PZ_JSON = 'uploads/pz2025.json';

  var LS_VON  = 'nalp_erfasser_v1';           /* gleicher Name wie Verschrauben/Vormontage */
  var LS_PEND = 'nalp_anw_pending_v1';
  var LS_LANG = 'nalp_lang_v1';               /* gleicher Schluessel wie vormontage.html */

  var A = { anw: {}, pz: {}, rueck: {}, alt: {}, pzStand: '', geladen: false };
  var SEITE = (location.pathname.split('/').pop() || '').replace('.html', '') || 'seite';

  /* ── Sprache (nur die Bedienung; die Anweisungstexte bleiben im Original) ── */
  var TXT = {
    de: { titel:'Arbeitsanweisungen', melden:'Rückmelden', ok:'erledigt', stop:'geht nicht',
          frage:'Frage', stand:'Stand', keine:'Zurzeit ist für keine Konstruktion etwas erfasst.',
          bauleitung:'Bauleitung', pzliste:'PZ2025-Restliste', verlauf:'Rückmeldungen',
          wer:'Wer meldet?', was:'Was ist zu sagen?', speichern:'Speichern', abbrechen:'Abbrechen',
          offen:'offen', alle:'alle', ohneName:'abgehakt · ohne Name (altes Häkchen)',
          nurOffen:'nur offene', fehlname:'Bitte den Namen eintragen.',
          fehltext:'Bitte kurz schreiben, was los ist.', gesendet:'Rückmeldung gespeichert',
          wartet:'Ohne Empfang gespeichert – geht automatisch raus.', bis:'bis' },
    en: { titel:'Work instructions', melden:'Report back', ok:'done', stop:'not possible',
          frage:'question', stand:'status', keine:'Nothing recorded for any structure right now.',
          bauleitung:'Site management', pzliste:'PZ2025 list', verlauf:'Reports',
          wer:'Who is reporting?', was:'What do you want to say?', speichern:'Save', abbrechen:'Cancel',
          offen:'open', alle:'all', ohneName:'ticked · no name (old checkbox)',
          nurOffen:'open only', fehlname:'Please enter your name.',
          fehltext:'Please write briefly what is going on.', gesendet:'Report saved',
          wartet:'Saved offline – will be sent automatically.', bis:'until' },
    pl: { titel:'Instrukcje robocze', melden:'Zgłoś', ok:'zrobione', stop:'nie da się',
          frage:'pytanie', stand:'stan', keine:'Obecnie nic nie zapisano.',
          bauleitung:'Kierownictwo budowy', pzliste:'Lista PZ2025', verlauf:'Zgłoszenia',
          wer:'Kto zgłasza?', was:'Co chcesz powiedzieć?', speichern:'Zapisz', abbrechen:'Anuluj',
          offen:'otwarte', alle:'wszystkie', ohneName:'odhaczone · bez nazwiska (stary haczyk)',
          nurOffen:'tylko otwarte', fehlname:'Proszę wpisać imię.',
          fehltext:'Proszę krótko opisać sytuację.', gesendet:'Zgłoszenie zapisane',
          wartet:'Zapisano bez zasięgu – wyśle się automatycznie.', bis:'do' }
  };
  var lang = 'de';
  try { var g = localStorage.getItem(LS_LANG); if (g && TXT[g]) lang = g; } catch (e) {}
  function T(k) { return (TXT[lang] || TXT.de)[k] || TXT.de[k] || k; }

  /* ── Kleinkram ── */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
  function dmz(ts) {
    if (!ts) return '';
    var d = new Date(Number(ts));
    if (isNaN(d.getTime())) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return p(d.getDate()) + '.' + p(d.getMonth() + 1) + '.' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function dm(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    return m ? (m[3] + '.' + m[2] + '.' + m[1]) : '';
  }
  function netzAn() { return navigator.onLine !== false; }
  function getVon() { try { return localStorage.getItem(LS_VON) || ''; } catch (e) { return ''; } }
  function setVon(v) { try { localStorage.setItem(LS_VON, v || ''); } catch (e) {} }
  function pendLesen() { try { return JSON.parse(localStorage.getItem(LS_PEND) || '[]'); } catch (e) { return []; } }
  function pendSchreiben(a) { try { localStorage.setItem(LS_PEND, JSON.stringify(a.slice(-200))); } catch (e) {} }
  function jget(u) {
    return fetch(u, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ── CSS, damit die Seiten nichts anpassen muessen ── */
  function css() {
    if (document.getElementById('nanwCss')) return;
    var s = document.createElement('style');
    s.id = 'nanwCss';
    s.textContent = ''
      + '.nanw-k{background:#fff;border:1px solid #e3e5e8;border-left:4px solid #1565c0;border-radius:6px;'
      +   'padding:10px 12px;margin:0 0 8px;font:13px/1.5 Arial,sans-serif;color:#1a1a1a;}'
      + '.nanw-k.ok{border-left-color:#1e9e5a;} .nanw-k.stop{border-left-color:#D72622;}'
      + '.nanw-k.frage{border-left-color:#e0a800;}'
      + '.nanw-kopf{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;margin-bottom:3px;}'
      + '.nanw-nr{font-size:17px;font-weight:900;} .nanw-meta{font-size:11.5px;color:#63676d;}'
      + '.nanw-chip{margin-left:auto;font-size:11px;font-weight:700;border-radius:11px;padding:2px 9px;'
      +   'white-space:nowrap;background:#eceef1;color:#63676d;}'
      + '.nanw-chip.ok{background:#e9f6ee;color:#14713f;} .nanw-chip.stop{background:#fdeceb;color:#a51d21;}'
      + '.nanw-chip.frage{background:#fdf6e3;color:#8a6400;}'
      + '.nanw-t{margin:5px 0 0;} .nanw-q{font-size:11px;color:#63676d;margin-top:3px;}'
      + '.nanw-v{margin-top:7px;border-top:1px solid #eceef1;padding-top:6px;font-size:12px;color:#63676d;}'
      + '.nanw-v b{color:#1a1a1a;}'
      + '.nanw-btn{display:block;width:100%;margin-top:8px;border:1px solid #e3e5e8;background:#fff;'
      +   'border-radius:6px;padding:10px;font:700 13.5px Arial,sans-serif;color:#1a1a1a;cursor:pointer;}'
      + '.nanw-btn:active{background:#f2f3f5;}'
      + '.nanw-f{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap;}'
      + '.nanw-f button{border:1px solid #e3e5e8;background:#fff;border-radius:14px;padding:5px 12px;'
      +   'font:700 11.5px Arial,sans-serif;color:#63676d;cursor:pointer;}'
      + '.nanw-f button.an{background:#D72622;border-color:#D72622;color:#fff;}'
      /* Blatt */
      + '#nanwHint{position:fixed;inset:0;background:rgba(12,16,22,.4);z-index:3000;display:none;}'
      + '#nanwHint.auf{display:block;}'
      + '#nanwBlatt{position:fixed;left:0;right:0;bottom:0;z-index:3100;background:#fff;'
      +   'border-top:4px solid #D72622;border-radius:12px 12px 0 0;max-height:88vh;overflow:auto;'
      +   'padding:13px 15px calc(18px + env(safe-area-inset-bottom));font:14px Arial,sans-serif;color:#1a1a1a;'
      +   'box-shadow:0 -8px 30px rgba(15,20,28,.3);transform:translateY(105%);transition:transform .18s ease;}'
      + '#nanwBlatt.auf{transform:none;}'
      + '#nanwBlatt h3{margin:0 0 2px;font-size:20px;} #nanwBlatt .sub{font-size:12px;color:#63676d;margin-bottom:9px;}'
      + '#nanwBlatt label{display:block;font-size:11.5px;font-weight:700;color:#63676d;margin:11px 0 4px;'
      +   'text-transform:uppercase;letter-spacing:.03em;}'
      + '#nanwBlatt input,#nanwBlatt textarea{width:100%;box-sizing:border-box;border:1px solid #e3e5e8;'
      +   'border-radius:5px;padding:9px;font:15px Arial,sans-serif;background:#fff;}'
      + '#nanwBlatt textarea{min-height:76px;resize:vertical;}'
      + '.nanw-s{display:flex;gap:6px;} .nanw-s button{flex:1;border:1px solid #e3e5e8;background:#fff;'
      +   'border-radius:6px;padding:11px 4px;font:700 12.5px Arial,sans-serif;color:#63676d;cursor:pointer;}'
      + '.nanw-s button.an{color:#fff;border-color:transparent;}'
      + '.nanw-s button.an[data-s=ok]{background:#1e9e5a;} .nanw-s button.an[data-s=stop]{background:#D72622;}'
      + '.nanw-s button.an[data-s=frage]{background:#e0a800;}'
      + '#nanwBlatt .send{display:block;width:100%;margin-top:13px;border:none;border-radius:6px;padding:14px;'
      +   'font:900 16px Arial,sans-serif;color:#fff;background:#1e9e5a;cursor:pointer;}'
      + '#nanwBlatt .send:disabled{background:#d7dade;color:#8b9096;}'
      + '#nanwBlatt .ab{display:block;width:100%;margin-top:7px;border:1px solid #e3e5e8;background:#fff;'
      +   'border-radius:6px;padding:10px;font:700 13px Arial,sans-serif;color:#63676d;cursor:pointer;}'
      + '#nanwToast{position:fixed;left:50%;bottom:22px;transform:translate(-50%,80px);z-index:3200;'
      +   'background:#1a1a1a;color:#fff;font:700 13.5px Arial,sans-serif;padding:11px 16px;border-radius:6px;'
      +   'opacity:0;transition:transform .2s,opacity .2s;pointer-events:none;max-width:88vw;text-align:center;}'
      + '#nanwToast.on{transform:translate(-50%,0);opacity:1;} #nanwToast.err{background:#D72622;}';
    document.head.appendChild(s);
  }

  function toast(t, err) {
    var e = document.getElementById('nanwToast');
    if (!e) { e = document.createElement('div'); e.id = 'nanwToast'; document.body.appendChild(e); }
    e.textContent = t; e.className = 'on' + (err ? ' err' : '');
    clearTimeout(e._t); e._t = setTimeout(function () { e.className = ''; }, 2600);
  }

  /* ── Laden ── */
  function laden() {
    css();
    return Promise.all([
      jget(P_ANW + '.json?_=' + Date.now()),
      jget(PZ_JSON),
      jget(P_RUE + '.json?_=' + Date.now()),
      jget(P_ALT + '.json?_=' + Date.now())
    ]).then(function (r) {
      A.anw = r[0] || {};
      A.pz = {};
      if (r[1] && r[1].tische) {
        A.pzStand = r[1].stand || '';
        r[1].tische.forEach(function (t) { A.pz[String(t.id)] = t; });
      }
      A.rueck = {};
      var roh = r[2] || {};
      Object.keys(roh).forEach(function (id) {
        var eintraege = [];
        var o = roh[id] || {};
        Object.keys(o).forEach(function (k) {
          var e = o[k] || {};
          eintraege.push({ k: k, status: e.status || 'ok', text: e.text || '',
                           von: e.von || '', ts: Number(e.ts) || 0, seite: e.seite || '' });
        });
        eintraege.sort(function (a, b) { return b.ts - a.ts; });
        if (eintraege.length) A.rueck[String(id)] = eintraege;
      });
      A.alt = r[3] || {};
      A.geladen = true;
      pendSenden();
      return A;
    });
  }

  /* ── Warteschlange ── */
  function pendSenden() {
    if (!netzAn()) return;
    var p = pendLesen();
    if (!p.length) return;
    var rest = [];
    var kette = Promise.resolve();
    p.forEach(function (item) {
      kette = kette.then(function () {
        return senden(item.id, item.rec).then(function (ok) { if (!ok) rest.push(item); })
          .catch(function () { rest.push(item); });
      });
    });
    return kette.then(function () { pendSchreiben(rest); });
  }
  function senden(id, rec) {
    return fetch(P_RUE + '/' + encodeURIComponent(id) + '.json',
      { method: 'POST', body: JSON.stringify(rec) })
      .then(function (r) { return r.ok; });
  }

  /* ── Auswertung ── */
  function tischIds() {
    var m = {};
    Object.keys(A.anw).forEach(function (id) { if (!A.anw[id].erledigt) m[id] = 1; });
    Object.keys(A.pz).forEach(function (id) { m[id] = 1; });
    Object.keys(A.rueck).forEach(function (id) { m[id] = 1; });
    return Object.keys(m).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); });
  }
  function stand(id) {
    var r = A.rueck[String(id)];
    if (r && r.length) return r[0];
    if (A.alt[String(id)]) return { status: 'ok', alt: true, von: '', ts: 0, text: '' };
    return null;
  }
  function statusWort(s) { return s === 'ok' ? T('ok') : s === 'stop' ? T('stop') : T('frage'); }
  function statusZeichen(s) { return s === 'ok' ? '✔' : s === 'stop' ? '✋' : '❓'; }

  function chip(id) {
    var s = stand(id);
    if (!s) return '<span class="nanw-chip">' + esc(T('offen')) + '</span>';
    var wer = s.alt ? T('ohneName') : (esc(s.von || '?') + (s.ts ? (' · ' + dmz(s.ts).slice(0, 10)) : ''));
    return '<span class="nanw-chip ' + s.status + '" title="' + esc(wer) + '">'
         + statusZeichen(s.status) + ' ' + esc(statusWort(s.status)) + '</span>';
  }

  /* ── Karten ── */
  var nurOffen = true;
  function karte(id) {
    var a = A.anw[id], p = A.pz[id], s = stand(id), r = A.rueck[id] || [];
    var kl = s ? s.status : '';
    var h = '<div class="nanw-k ' + kl + '">'
          + '<div class="nanw-kopf"><span class="nanw-nr">' + esc(id) + '</span>'
          + '<span class="nanw-meta">' + esc([(p && p.typ) || '', (p && p.ber) || ''].filter(Boolean).join(' · ')) + '</span>'
          + chip(id) + '</div>';
    if (a && a.text) {
      h += '<div class="nanw-t">' + esc(a.text) + '</div>'
         + '<div class="nanw-q">' + esc(T('bauleitung')) + ': ' + esc(a.von || '–')
         + (a.ts ? (' · ' + dmz(a.ts).slice(0, 10)) : '')
         + (a.bis ? (' · ' + esc(T('bis')) + ' ' + dm(a.bis)) : '') + '</div>';
    }
    if (p && p.akt) {
      /* Der PZ-Text ist bewusst HTML (fette Zahlen, Farben) und stammt aus der
         geprueften Restliste – darum nicht escapen. */
      h += '<div class="nanw-t">' + p.akt + '</div>'
         + '<div class="nanw-q">' + esc(T('pzliste')) + (A.pzStand ? (' · ' + dm(A.pzStand)) : '') + '</div>';
    }
    if (r.length) {
      h += '<div class="nanw-v"><b>' + esc(T('verlauf')) + '</b>';
      r.slice(0, 6).forEach(function (e) {
        h += '<div>' + statusZeichen(e.status) + ' <b>' + esc(statusWort(e.status)) + '</b> · '
           + esc(e.von || '?') + ' · ' + esc(dmz(e.ts))
           + (e.text ? (' – ' + esc(e.text)) : '') + '</div>';
      });
      if (r.length > 6) h += '<div>… ' + (r.length - 6) + '</div>';
      h += '</div>';
    } else if (s && s.alt) {
      h += '<div class="nanw-v">' + esc(T('ohneName')) + '</div>';
    }
    h += '<button class="nanw-btn" onclick="NalpAnw.melden(\'' + esc(id) + '\')">✎ '
       + esc(T('melden')) + '</button></div>';
    return h;
  }

  function liste(ziel) {
    var el = typeof ziel === 'string' ? document.getElementById(ziel) : ziel;
    if (!el) return;
    el._nanw = 1;
    var ids = tischIds().filter(function (id) {
      if (!nurOffen) return true;
      var s = stand(id);
      return !s || s.status !== 'ok';
    });
    var h = '<div class="nanw-f">'
          + '<button class="' + (nurOffen ? 'an' : '') + '" onclick="NalpAnw.filter(1)">' + esc(T('nurOffen')) + '</button>'
          + '<button class="' + (nurOffen ? '' : 'an') + '" onclick="NalpAnw.filter(0)">' + esc(T('alle')) + '</button>'
          + '</div>';
    h += ids.length ? ids.map(karte).join('')
                    : '<div class="nanw-k ok">' + esc(T('keine')) + '</div>';
    el.innerHTML = h;
  }
  function neuMalen() {
    Array.prototype.forEach.call(document.querySelectorAll('*'), function (el) { if (el._nanw) liste(el); });
    if (typeof window.nalpAnwGeaendert === 'function') window.nalpAnwGeaendert();
  }

  /* ── Rueckmelde-Blatt ── */
  var offenId = null, gewaehlt = 'ok';
  function melden(id) {
    offenId = String(id); gewaehlt = 'ok';
    css();
    var hint = document.getElementById('nanwHint');
    if (!hint) {
      hint = document.createElement('div'); hint.id = 'nanwHint';
      hint.onclick = zu; document.body.appendChild(hint);
      var b = document.createElement('div'); b.id = 'nanwBlatt'; document.body.appendChild(b);
    }
    var a = A.anw[offenId], p = A.pz[offenId];
    var kurz = (a && a.text) || (p && p.akt ? String(p.akt).replace(/<[^>]*>/g, '') : '') || '';
    document.getElementById('nanwBlatt').innerHTML =
        '<h3>' + esc(T('melden')) + ' · ' + esc(offenId) + '</h3>'
      + '<div class="sub">' + esc(kurz.slice(0, 170)) + (kurz.length > 170 ? '…' : '') + '</div>'
      + '<label>' + esc(T('stand')) + '</label>'
      + '<div class="nanw-s">'
      +   '<button data-s="ok" class="an" onclick="NalpAnw._s(\'ok\')">✔ ' + esc(T('ok')) + '</button>'
      +   '<button data-s="stop" onclick="NalpAnw._s(\'stop\')">✋ ' + esc(T('stop')) + '</button>'
      +   '<button data-s="frage" onclick="NalpAnw._s(\'frage\')">❓ ' + esc(T('frage')) + '</button>'
      + '</div>'
      + '<label>' + esc(T('was')) + '</label><textarea id="nanwText"></textarea>'
      + '<label>' + esc(T('wer')) + '</label><input id="nanwVon" type="text" value="' + esc(getVon()) + '">'
      + '<button class="send" onclick="NalpAnw._send()">✔ ' + esc(T('speichern')) + '</button>'
      + '<button class="ab" onclick="NalpAnw.zu()">' + esc(T('abbrechen')) + '</button>';
    hint.classList.add('auf');
    setTimeout(function () { document.getElementById('nanwBlatt').classList.add('auf'); }, 10);
  }
  function _s(s) {
    gewaehlt = s;
    Array.prototype.forEach.call(document.querySelectorAll('#nanwBlatt .nanw-s button'), function (b) {
      b.classList.toggle('an', b.getAttribute('data-s') === s); });
  }
  function zu() {
    var b = document.getElementById('nanwBlatt'), h = document.getElementById('nanwHint');
    if (b) b.classList.remove('auf');
    if (h) h.classList.remove('auf');
    offenId = null;
  }
  function _send() {
    var von = String((document.getElementById('nanwVon') || {}).value || '').trim();
    var text = String((document.getElementById('nanwText') || {}).value || '').trim();
    if (!von) { toast(T('fehlname'), true); return; }
    if (gewaehlt !== 'ok' && !text) { toast(T('fehltext'), true); return; }
    setVon(von);
    var id = offenId;
    var rec = { status: gewaehlt, text: text, von: von, ts: Date.now(), seite: SEITE };
    /* sofort sichtbar, auch ohne Netz */
    (A.rueck[id] = A.rueck[id] || []).unshift({ k: 'lokal', status: rec.status, text: rec.text,
                                                von: rec.von, ts: rec.ts, seite: rec.seite });
    zu(); neuMalen();
    if (!netzAn()) {
      var p = pendLesen(); p.push({ id: id, rec: rec }); pendSchreiben(p);
      toast(T('wartet'));
      return;
    }
    senden(id, rec).then(function (ok) {
      if (ok) toast(T('gesendet'));
      else { var q = pendLesen(); q.push({ id: id, rec: rec }); pendSchreiben(q); toast(T('wartet'), true); }
    }).catch(function () {
      var q = pendLesen(); q.push({ id: id, rec: rec }); pendSchreiben(q); toast(T('wartet'), true);
    });
  }

  window.NalpAnw = {
    laden: laden,
    liste: liste,
    karte: karte,
    chip: chip,
    stand: stand,
    ids: tischIds,
    melden: melden,
    zu: zu,
    daten: A,
    sprache: function (l) { if (TXT[l]) { lang = l; neuMalen(); } },
    filter: function (n) { nurOffen = !!n; neuMalen(); },
    offen: function () {
      return tischIds().filter(function (id) { var s = stand(id); return !s || s.status !== 'ok'; }).length;
    },
    _s: _s,
    _send: _send
  };
})();
