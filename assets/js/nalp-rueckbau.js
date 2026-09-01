/* ═══════════════════════════════════════════════════════════════════
   Rückbau Baupiste – Zielhöhenmodell + Mikropfähle im Boden
   ═══════════════════════════════════════════════════════════════════
   Zeigt im 3D-Viewer, auf welche Höhe die Baupiste zurückgebaut wird:

     · Zielfläche  OK Oberboden = Pfahlkopf − 0.15 m, eingefärbt nach
                   Abtrag (rot) / Auftrag (blau) gegen den Bestand
     · Mikropfähle Rohr, Bohrloch und Kopfplatte, in echter Lage und
                   Neigung – talseitig lotrecht, bergseitig 30° mit dem
                   Fuss bergwärts (Normal Typ B, Typenplan 0289 A1)
     · Baupiste    Achse im Perimeter

   DIE 15 cm SIND DIE VORSCHRIFT, nicht ein Erfahrungswert: «Der maximale
   Überstand der Kopfplatte ab OKT darf 15 cm nicht überschreiten»
   (NalpSolar_51_PL_0289_A1_MT-Pfahl-PL_260122, ILF 22.01.2026). Tiefer
   abtragen kostet Einbindelänge – bei 15 cm Überstand stecken statt
   1.90 m nur noch 1.85 m im Boden.

   Daten aus uploads/rueckbau/<name>.json, erzeugt von
   Tools\Baupiste_Rueckbau_Bauen.py.

   Eigener Baustein, damit das Modell auch in einer anderen Seite
   eingehängt werden kann:
       NalpRueckbau.laden(THREE, scene, {OE,ON,OZ}, 'baupiste_3_4').then(…)
   ═══════════════════════════════════════════════════════════════════ */
window.NalpRueckbau = (function () {
  'use strict';

  var BASIS = 'uploads/rueckbau/';
  var gruppe = null, daten = null, teile = {}, schilder = [];
  var SCHMAL = (typeof window !== 'undefined' && window.innerWidth < 760);
  var schilderAn = !SCHMAL;

  /* Kopfplatte je Profil – Typenplan 0289 A1, Pfahlkopfdetails:
     A/B 300×300×20 · C/D 320×320×25 · E 340×340×30 [mm]. */
  var PLATTE = {
    'ROR 89x7':   { b: 0.300, t: 0.020 },
    'ROR 114x10': { b: 0.320, t: 0.025 },
    'ROR 114x16': { b: 0.340, t: 0.030 }
  };

  /* ── Farben ─────────────────────────────────────────────────────
     Abtrag rot, Auftrag blau, ±5 cm grün («passt»). Die 5 cm sind die
     Höhentoleranz beim Versetzen der Pfähle aus demselben Typenplan. */
  function farbe(dz, imNetz) {
    var r, g, b, k;
    if (dz === null || dz === undefined) { r = 0.42; g = 0.45; b = 0.50; }
    else if (dz > 5) {                       // Abtrag
      k = Math.min((dz - 5) / 45, 1);
      r = 1.0; g = 0.81 - 0.68 * k; b = 0.50 - 0.44 * k;
    } else if (dz < -5) {                    // Auftrag
      k = Math.min((-dz - 5) / 45, 1);
      r = 0.65 - 0.54 * k; g = 0.85 - 0.55 * k; b = 1.0;
    } else { r = 0.13; g = 0.77; b = 0.37; } // passt
    if (!imNetz) { r *= 0.52; g *= 0.52; b *= 0.55; }   // ausserhalb des Pfahlnetzes
    return [r, g, b];
  }

  /* ── Zielfläche als ein Netz ────────────────────────────────────
     Ein Mesh statt 25'000 – der Viewer hängt sonst am Zeichenaufruf
     (siehe project_viewer3d_tempo). */
  function flaeche(THREE, o) {
    var R = daten.raster, nx = R.nx, ny = R.ny, d = R.d, z0 = R.z0;
    var idx = new Int32Array(nx * ny).fill(-1);
    var pos = [], col = [], n = 0, j, i, v, kz;
    for (j = 0; j < ny; j++) {
      kz = R.kern[j];
      for (i = 0; i < nx; i++) {
        v = R.ziel[j][i];
        if (v === null) continue;
        idx[j * nx + i] = n++;
        pos.push(R.e0 + i * d - o.OE, z0 + v / 100 - o.OZ, -(R.n0 + j * d - o.ON));
        var c = farbe(R.delta[j][i], kz.charAt(i) === '1');
        col.push(c[0], c[1], c[2]);
      }
    }
    var tri = [];
    for (j = 0; j < ny - 1; j++) {
      for (i = 0; i < nx - 1; i++) {
        var a = idx[j * nx + i], b = idx[j * nx + i + 1],
            c2 = idx[(j + 1) * nx + i + 1], e = idx[(j + 1) * nx + i];
        // Bildschirm-Z zeigt nach Süden, darum Reihenfolge a-c-b / a-e-c
        if (a >= 0 && b >= 0 && c2 >= 0) tri.push(a, c2, b);
        if (a >= 0 && c2 >= 0 && e >= 0) tri.push(a, e, c2);
      }
    }
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    g.setIndex(tri);
    g.computeVertexNormals();
    var m = new THREE.MeshLambertMaterial({
      vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.94
    });
    var mesh = new THREE.Mesh(g, m);
    mesh.renderOrder = 2;
    mesh.userData.rueckbau = 'flaeche';
    return mesh;
  }

  /* ── Röhren zusammenlegen ───────────────────────────────────────
     Ein Zylinder je Pfahl wären 216 Zeichenaufrufe. Alles wandert
     darum in EIN Netz je Bauteilart. */
  function rohrAn(P, I, a, b, r, seg) {
    var ax = b[0] - a[0], ay = b[1] - a[1], az = b[2] - a[2];
    var L = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
    ax /= L; ay /= L; az /= L;
    // zwei Vektoren quer zur Achse
    var hx = 0, hy = 0, hz = 1;
    if (Math.abs(az) > 0.9) { hx = 1; hz = 0; }
    var ux = ay * hz - az * hy, uy = az * hx - ax * hz, uz = ax * hy - ay * hx;
    var un = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= un; uy /= un; uz /= un;
    var vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    var basis = P.length / 3, k;
    for (k = 0; k < seg; k++) {
      var t = 2 * Math.PI * k / seg, cs = Math.cos(t) * r, sn = Math.sin(t) * r;
      var ox = ux * cs + vx * sn, oy = uy * cs + vy * sn, oz = uz * cs + vz * sn;
      P.push(a[0] + ox, a[1] + oy, a[2] + oz);
      P.push(b[0] + ox, b[1] + oy, b[2] + oz);
    }
    for (k = 0; k < seg; k++) {
      var p0 = basis + 2 * k, p1 = p0 + 1,
          p2 = basis + 2 * ((k + 1) % seg), p3 = p2 + 1;
      I.push(p0, p2, p1, p1, p2, p3);
    }
  }

  function plattenAn(P, I, mitte, achse, b, t) {
    // Platte liegt rechtwinklig zur Pfahlachse, Oberkante = Pfahlkopf
    var ax = achse[0], ay = achse[1], az = achse[2];
    var hx = 0, hy = 0, hz = 1;
    if (Math.abs(az) > 0.9) { hx = 1; hz = 0; }
    var ux = ay * hz - az * hy, uy = az * hx - ax * hz, uz = ax * hy - ay * hx;
    var un = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    ux /= un; uy /= un; uz /= un;
    var vx = ay * uz - az * uy, vy = az * ux - ax * uz, vz = ax * uy - ay * ux;
    var h = b / 2, basis = P.length / 3, s, k;
    for (s = 0; s < 2; s++) {
      var f = -s * t;                       // Ober-/Unterseite entlang der Achse
      for (k = 0; k < 4; k++) {
        var sx = (k === 0 || k === 3) ? -h : h, sy = (k < 2) ? -h : h;
        P.push(mitte[0] + ux * sx + vx * sy + ax * f,
               mitte[1] + uy * sx + vy * sy + ay * f,
               mitte[2] + uz * sx + vz * sy + az * f);
      }
    }
    var q = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2],
             [2, 6, 7, 3], [3, 7, 4, 0]];
    for (k = 0; k < q.length; k++) {
      var a2 = basis + q[k][0], b2 = basis + q[k][1],
          c2 = basis + q[k][2], d2 = basis + q[k][3];
      I.push(a2, b2, c2, a2, c2, d2);
    }
  }

  function netz(THREE, P, I, mat) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3));
    g.setIndex(I);
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  function pfaehle(THREE, o) {
    var gr = new THREE.Group();
    var Pr = [], Ir = [], Pb = [], Ib = [], Pp = [], Ip = [];
    daten.pfaehle.forEach(function (p) {
      var kopf = [p.E - o.OE, p.H - o.OZ, -(p.N - o.ON)];
      var fuss = [p.fE - o.OE, p.fH - o.OZ, -(p.fN - o.ON)];
      rohrAn(Pr, Ir, kopf, fuss, p.d / 2, 10);
      rohrAn(Pb, Ib, kopf, fuss, p.bohr / 2, 12);
      var ax = fuss[0] - kopf[0], ay = fuss[1] - kopf[1], az = fuss[2] - kopf[2];
      var L = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      var pl = PLATTE[p.ror] || PLATTE['ROR 89x7'];
      plattenAn(Pp, Ip, kopf, [ax / L, ay / L, az / L], pl.b, pl.t);
    });
    var rohr = netz(THREE, Pr, Ir, new THREE.MeshLambertMaterial({ color: 0x9fb0c4 }));
    rohr.userData.rueckbau = 'rohr';
    // Bohrloch = Injektionskörper. FrontSide, nicht DoubleSide: transparente
    // Flächen werden in three r147 sonst doppelt gezeichnet.
    var loch = netz(THREE, Pb, Ib, new THREE.MeshLambertMaterial({
      color: 0xc08a4a, transparent: true, opacity: 0.28,
      side: THREE.FrontSide, depthWrite: false
    }));
    loch.renderOrder = 3;
    loch.userData.rueckbau = 'bohrloch';
    var pla = netz(THREE, Pp, Ip, new THREE.MeshLambertMaterial({ color: 0xd72622 }));
    pla.userData.rueckbau = 'platte';
    gr.add(loch); gr.add(rohr); gr.add(pla);
    teile.rohr = rohr; teile.bohrloch = loch; teile.platte = pla;
    return gr;
  }

  function pistenlinie(THREE, o) {
    if (!daten.piste || daten.piste.length < 2) return null;
    var R = daten.raster, pts = [];
    daten.piste.forEach(function (q) {
      // Linie auf die Zielfläche legen, sonst verschwindet sie im Boden
      var i = Math.round((q[0] - R.e0) / R.d), j = Math.round((q[1] - R.n0) / R.d);
      var h = null;
      if (j >= 0 && j < R.ny && i >= 0 && i < R.nx) h = R.ziel[j][i];
      if (h === null) return;
      pts.push(new THREE.Vector3(q[0] - o.OE, R.z0 + h / 100 - o.OZ + 0.12,
                                 -(q[1] - o.ON)));
    });
    if (pts.length < 2) return null;
    var g = new THREE.BufferGeometry().setFromPoints(pts);
    var l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd400 }));
    l.userData.rueckbau = 'piste';
    return l;
  }

  function schild(THREE, txt, klasse) {
    var el = document.createElement('div');
    el.className = 'lbl' + (klasse ? ' ' + klasse : '');
    el.textContent = txt;
    return new THREE.CSS2DObject(el);
  }

  function tischschilder(THREE, o) {
    var gr = new THREE.Group(), nach = {};
    daten.pfaehle.forEach(function (p) {
      (nach[p.tisch] = nach[p.tisch] || []).push(p);
    });
    Object.keys(nach).forEach(function (t) {
      var v = nach[t], E = 0, N = 0, H = -1e9;
      v.forEach(function (p) { E += p.E; N += p.N; H = Math.max(H, p.H); });
      var s = schild(THREE, t, 'lbl-rb');
      s.position.set(E / v.length - o.OE, H - o.OZ + 0.9, -(N / v.length - o.ON));
      s.visible = schilderAn;
      schilder.push(s);
      gr.add(s);
    });
    return gr;
  }

  /* ── öffentlich ────────────────────────────────────────────────── */
  function laden(THREE, scene, o, datei) {
    return fetch(BASIS + (datei || 'baupiste_3_4') + '.json')
      .then(function (r) {
        if (!r.ok) throw new Error('rueckbau ' + r.status);
        return r.json();
      })
      .then(function (j) {
        daten = j;
        gruppe = new THREE.Group();
        gruppe.name = 'rueckbau';
        var f = flaeche(THREE, o);
        teile.flaeche = f;
        gruppe.add(f);
        gruppe.add(pfaehle(THREE, o));
        var pl = pistenlinie(THREE, o);
        if (pl) { teile.piste = pl; gruppe.add(pl); }
        gruppe.add(tischschilder(THREE, o));
        scene.add(gruppe);
        return daten;
      });
  }

  function sichtbar(an) { if (gruppe) gruppe.visible = !!an; }

  function teilSichtbar(name, an) {
    var m = teile[name];
    if (!m) return;
    m.visible = !!an;
    if (name === 'rohr' && teile.platte) teile.platte.visible = !!an;
  }

  function schilderUm() {
    schilderAn = !schilderAn;
    schilder.forEach(function (s) { s.visible = schilderAn; });
    return schilderAn;
  }

  function meta() { return daten; }

  function mitte() {
    if (!daten || !daten.pfaehle.length) return null;
    var E = 0, N = 0, H = 0;
    daten.pfaehle.forEach(function (p) { E += p.E; N += p.N; H += p.H; });
    var n = daten.pfaehle.length;
    return { E: E / n, N: N / n, H: H / n };
  }

  function kurzHtml() {
    if (!daten) return '';
    var k = daten.kennzahlen;
    return k.tische + ' Tische · Abtrag ' + k.abtrag + ' m³ / Auftrag '
         + k.auftrag + ' m³';
  }

  function infoHtml() {
    if (!daten) return '';
    var k = daten.kennzahlen, q = daten.quelle, h = [];
    h.push('<b>OK Oberboden = Pfahlkopf − ' + daten.ueberstand.toFixed(2) + ' m</b>');
    h.push('<div style="margin:3px 0 6px;color:rgba(255,255,255,.6);font-size:10.5px">'
         + 'Typenplan 0289 A1: max. 15 cm Überstand der Kopfplatte ab OKT.</div>');
    h.push('<table style="width:100%;border-collapse:collapse">'
      + z('Tische / Pfähle', k.tische + ' / ' + k.pfaehle)
      + z('Fläche im Pfahlnetz', k.flaeche_pfahlnetz + ' m²')
      + z('Modellfläche gesamt', k.flaeche_modell + ' m²')
      + z('Abtrag', '<b style="color:#ff8f6b">' + k.abtrag + ' m³</b>')
      + z('Auftrag', '<b style="color:#7db6ff">' + k.auftrag + ' m³</b>')
      + z('Differenz min/med/max', k.dmin + ' / ' + k.dmed + ' / ' + k.dmax + ' m')
      + '</table>');
    if (k.vorgabe) {
      h.push('<div style="margin-top:7px;padding:5px 7px;border-radius:6px;'
        + 'background:rgba(255,190,60,.13);border:1px solid rgba(255,190,60,.4);'
        + 'font-size:10.5px;line-height:1.4">⚠ <b>' + k.vorgabe + ' von '
        + k.pfaehle + ' Pfahlköpfen sind nicht eingemessen.</b> Nalpi trägt dort '
        + 'den vereinbarten Vorgabewert SOLL + 0.10 m ein, solange der Pfahl nicht '
        + 'steht. Die Zielfläche liegt damit '
        + (daten.ueberstand - 0.10).toFixed(2) + ' m unter dem SOLL-Gelände. Nach '
        + 'dem Bohren und Einmessen neu rechnen.</div>');
    }
    h.push('<div class="lp-body" style="margin-top:7px"><i>'
      + 'Pfähle: ' + q.pfaehle + '<br>Bauphasen: ' + q.bauphasen
      + '<br>Bestand: ' + q.bestand + '<br>Normalien: ' + q.normalien
      + '<br>Ein DSM ist ein Oberflächenmodell – Material und Maschinen stehen '
      + 'darin. ' + (k.objektflaeche ? k.objektflaeche + ' m² wurden als Objekt '
      + 'erkannt und aus der Massenbilanz genommen. ' : '')
      + 'Die Massen sind eine Grössenordnung, kein Ausmass.</i></div>');
    return h.join('');
  }

  function z(a, b) {
    return '<tr><td style="padding:1px 0;color:rgba(255,255,255,.62)">' + a
         + '</td><td style="padding:1px 0;text-align:right">' + b + '</td></tr>';
  }

  return {
    laden: laden, sichtbar: sichtbar, teilSichtbar: teilSichtbar,
    schilderUm: schilderUm, schilderAn: function () { return schilderAn; },
    meta: meta, mitte: mitte, infoHtml: infoHtml, kurzHtml: kurzHtml
  };
})();
