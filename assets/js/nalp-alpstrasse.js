/* ═══════════════════════════════════════════════════════════════════
   Alpstrasse (Betonfahrbahn) + Schacht D1 im 3D-Viewer
   ═══════════════════════════════════════════════════════════════════
   Zeigt das Strassenmodell von François Borner (LandXML aus Civil 3D,
   Mail 24.08.2026 «Modell Alpstrasse») im Gelände der NalpSolar-Karte:

     · Planum       TIN «Profilkörper DGM» = UK Betonplatte (braun)
     · Betonplatte  16 cm dicker Körper aus den 396 Querprofilen (grau)
     · Achse        Achse_Betonfahrbahn mit Gradiente, Stationsmarken
     · Schacht D1   zwei Absteckpunkte (OK Betonplatte) + Schachtkörper

   HÖHENBEZUG - der Punkt, an dem man sich verrechnet:
     Das Modell (TIN) ist UK Betonplatte, die Betonplatte liegt 16 cm
     höher. Die zwei D1-Punkte sind dagegen OK Betonplatte, also genau
     die Höhe, auf der der Schacht versetzt wird. Beides ist in
     Tools\Alpstrasse_Modell_Bauen.py nachgerechnet: die gelieferten
     D1-Höhen liegen mit ±0.5 mm auf der OK Betonplatte des Modells,
     der TIN exakt 0.160 m darunter.

   Daten aus uploads/alpstrasse/ (alpstrasse.meta.json + planum/platte
   .v.bin/.f.bin), erzeugt von Tools\Alpstrasse_Modell_Bauen.py.

   Eigener Baustein, damit das Strassenmodell auch in einer anderen
   Seite eingehängt werden kann:
       NalpAlpstrasse.laden(THREE, scene, {OE, ON, OZ}).then(...)
   ═══════════════════════════════════════════════════════════════════ */
window.NalpAlpstrasse = (function () {
  'use strict';

  var BASIS = 'uploads/alpstrasse/';
  var gruppe = null, meta = null;

  // Schilder getrennt halten: auf dem Handy sind zehn Stationsmarken plus
  // vier D1-Schilder auf einmal unlesbar. Stufen: 'alle' | 'd1' | 'keine'.
  var markenSta = [], markenD1 = [];
  var SCHMAL = (typeof window !== 'undefined' && window.innerWidth < 760);
  var stufe = SCHMAL ? 'd1' : 'alle';

  // Auf dem Handy müssen die Schilder kurz sein, sonst laufen sie aus dem
  // Bild und decken sich gegenseitig zu. Die Langfassung steht in der
  // Infokarte – auf dem Schild nur das, was man am Modell braucht.
  function kurz(lang, knapp) { return SCHMAL ? knapp : lang; }

  /* ── Hilfen ────────────────────────────────────────────────────── */
  function bin(url, Typ) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error(url + ' ' + r.status);
      return r.arrayBuffer();
    }).then(function (b) { return new Typ(b); });
  }

  // Rohkoordinaten der .bin sind [E-OE, N-ON, H-OZ] - gleiche Ablage wie
  // die IFC-Ebenen. Der Viewer ist Y-up, also X=Ost, Y=Höhe, Z=-(Nord).
  function zuSzene(roh) {
    var v = new Float32Array(roh.length);
    for (var i = 0; i < roh.length; i += 3) {
      v[i] = roh[i];
      v[i + 1] = roh[i + 2];
      v[i + 2] = -roh[i + 1];
    }
    return v;
  }

  function netz(THREE, verts, idx, mat) {
    var g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    return new THREE.Mesh(g, mat);
  }

  // LV95 -> Szene für die Angaben aus der meta.json
  function pkt(THREE, o, E, N, H) {
    return new THREE.Vector3(E - o.OE, H - o.OZ, -(N - o.ON));
  }

  function schild(THREE, txt, klasse) {
    var d = document.createElement('div');
    d.className = 'lbl' + (klasse ? ' ' + klasse : '');
    d.textContent = txt;
    return new THREE.CSS2DObject(d);
  }

  /* ── Schacht D1 ────────────────────────────────────────────────────
     Aus den zwei Absteckpunkten. Sie werden als diagonal gegenüber-
     liegende Aussenecken gelesen (längs 3.30 m / quer 1.31 m zur
     Strassenachse) - das passt zum bestellten Innenmass 3.00 x 1.00 m
     bei rund 15 cm Wandstärke. Die Punkte selbst sind vermessungsgenau,
     der Körper drumherum ist die Auslegung: siehe meta.schacht_d1.annahme.
     OK Deckel = OK Betonplatte, Sohle -1.50 m (Bestellung Mauderli).     */
  function schacht(THREE, o, d1, laengsneigung) {
    var g = new THREE.Group();
    if (!d1 || !d1.punkte || d1.punkte.length < 2) return g;

    var a = d1.punkte[0], b = d1.punkte[1];
    var pa = pkt(THREE, o, a.E, a.N, a.H);
    var pb = pkt(THREE, o, b.E, b.N, b.H);
    var tiefe = Math.abs(d1.sohle || 1.50);

    // ── Lage in der Ebene ─────────────────────────────────────────
    // Die beiden Punkte sind die Diagonale des Schachts; ihr Vektor ist
    // in der Szene  (laengs + i·quer) · e^(i·alpha)   (x = real, z = imaginär),
    // weil «quer positiv = rechts der Achse» in der Szene genau +i·Achse ist.
    var dx = pb.x - pa.x, dz = pb.z - pa.z;
    var alpha = Math.atan2(dz, dx) - Math.atan2(d1.quer, d1.laengs);

    // ── Neigung: der Schacht liegt IN der Fahrbahnebene ───────────
    // Die beiden gelieferten Höhen sind verschieden (0.73 m auf 3.5 m).
    // Ein waagrechter Deckel kann darum nicht stimmen - der Schacht wird
    // in der Ebene der Betonplatte versetzt, also längs mit der Gradiente
    // (20.11 %) und quer mit dem Quergefälle (5 %) gekippt.
    var gl = (laengsneigung || 0) / 100;            // längs, bergwärts positiv
    var gq = (d1.quergefaelle || 0) / 100;          // quer, nach rechts positiv
    var T = new THREE.Vector3(Math.cos(alpha), gl, Math.sin(alpha)).normalize();
    var R = new THREE.Vector3(-Math.sin(alpha), gq, Math.cos(alpha)).normalize();
    var Yv = new THREE.Vector3().crossVectors(R, T).normalize();   // Flächennormale
    R.crossVectors(T, Yv).normalize();              // exakt rechtwinklig machen

    // Abmessungen aus den Punkten selbst - so liegen die zwei Absteck-
    // punkte exakt auf zwei gegenüberliegenden Deckelecken.
    var diag = new THREE.Vector3().subVectors(pb, pa);
    var laenge = Math.abs(diag.dot(T));
    var breite = Math.abs(diag.dot(R));

    var mitte = new THREE.Vector3().addVectors(pa, pb).multiplyScalar(0.5);

    var korpus = new THREE.Group();
    korpus.position.copy(mitte);
    korpus.setRotationFromMatrix(new THREE.Matrix4().makeBasis(T, Yv, R));

    // Wände als vier Platten, damit man in den Schacht hineinsieht
    var beton = new THREE.MeshPhongMaterial({
      color: 0xc9ccd1, emissive: 0x1a1c20, shininess: 15,
      side: THREE.DoubleSide, transparent: true, opacity: 0.85
    });
    var wand = 0.15;
    var teile = [
      [laenge, tiefe, wand, 0, -tiefe / 2, (breite - wand) / 2],
      [laenge, tiefe, wand, 0, -tiefe / 2, -(breite - wand) / 2],
      [wand, tiefe, breite - 2 * wand, (laenge - wand) / 2, -tiefe / 2, 0],
      [wand, tiefe, breite - 2 * wand, -(laenge - wand) / 2, -tiefe / 2, 0],
      [laenge, 0.12, breite, 0, -tiefe + 0.06, 0]        // Sohle
    ];
    teile.forEach(function (t) {
      var m = new THREE.Mesh(new THREE.BoxGeometry(t[0], t[1], t[2]), beton);
      m.position.set(t[3], t[4], t[5]);
      korpus.add(m);
    });

    // Deckel: OK Deckel = OK Betonplatte
    var deckel = new THREE.Mesh(
      new THREE.BoxGeometry(laenge, 0.06, breite),
      new THREE.MeshPhongMaterial({ color: 0x2b2f36, emissive: 0x0a0c10, shininess: 40 }));
    deckel.position.set(0, -0.03, 0);
    korpus.add(deckel);

    // Kante hervorheben
    var kante = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(laenge, tiefe, breite)),
      new THREE.LineBasicMaterial({ color: 0xff4d4d }));
    kante.position.set(0, -tiefe / 2, 0);
    korpus.add(kante);
    g.add(korpus);

    var rechts = R;

    // Die zwei Absteckpunkte - das ist das Belegte, darum auffällig
    var kugel = new THREE.MeshBasicMaterial({ color: 0xff2d2d });
    [[pa, a, 1.6], [pb, b, 3.0]].forEach(function (e) {
      var s = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), kugel);
      s.position.copy(e[0]);
      g.add(s);
      // Lotstab, damit der Punkt auch von oben zu finden ist
      var h = e[2];
      var st = new THREE.Mesh(
        new THREE.CylinderGeometry(0.025, 0.025, h, 8),
        new THREE.MeshBasicMaterial({ color: 0xff2d2d }));
      st.position.set(e[0].x, e[0].y + h / 2, e[0].z);
      g.add(st);
      var l = schild(THREE, kurz(
        'Pkt ' + e[1].nr + ' · ' + e[1].H.toFixed(3) + ' m ü.M.',
        e[1].nr + ' · ' + e[1].H.toFixed(3)), 'lbl-d1');
      l.position.set(e[0].x, e[0].y + h + 0.3, e[0].z);
      g.add(l);
      markenD1.push(l);
    });

    // Gefällepfeil: wohin das Wasser auf der Platte läuft. Borner
    // 24.08.2026: bei D1 fällt es bergwärts gesehen nach links, die
    // Entwässerungsöffnungen müssen deshalb links neu gebohrt werden.
    if (d1.quergefaelle) {
      // quergefaelle > 0 heisst: rechts der Achse ist es höher, das Wasser
      // läuft also nach links. Der Pfeil zeigt, wohin es läuft.
      var abwaerts = rechts.clone().multiplyScalar(d1.quergefaelle > 0 ? -1 : 1);
      g.add(new THREE.ArrowHelper(abwaerts, mitte.clone().setY(mitte.y + 0.4),
        3.0, 0x2ea6ff, 0.7, 0.45));
      // Kurz halten – der ganze Satz («Entwässerungsöffnungen dort neu
      // bohren») steht in der Infokarte. Lange Schilder decken am Modell
      // nur die Nachbarschilder zu.
      var lg = schild(THREE, 'Gefälle ' +
        Math.abs(d1.quergefaelle).toFixed(0) + ' % → ' + d1.faellt_nach,
        'lbl-d1');
      // Das Gefälleschild fällt in derselben Richtung wie Punkt 7 – darum
      // weit raus UND unter die Fahrbahnebene, sonst kleben die beiden
      // aufeinander. Punktschilder sitzen auf 1.6 m und 3.0 m, der
      // Schachtname auf 4.4 m, dieses hier auf −1.0 m.
      lg.position.copy(mitte.clone()
        .add(abwaerts.clone().multiplyScalar(7.0)).setY(mitte.y - 1.0));
      g.add(lg);
      markenD1.push(lg);
    }

    var lb = schild(THREE, kurz('Schacht D1 · Sohle −1.50 m', 'Schacht D1'),
      'lbl-d1');
    lb.position.set(mitte.x, mitte.y + 4.4, mitte.z);
    g.add(lb);
    markenD1.push(lb);
    return g;
  }

  /* ── Achse + Stationsmarken ───────────────────────────────────── */
  function achse(THREE, o, m) {
    var g = new THREE.Group();
    var p = (m.achse && m.achse.punkte) || [];
    if (p.length < 2) return g;

    var pts = p.map(function (q) {
      // 4 cm über OK Betonplatte, damit die Linie nicht in der Platte steckt
      return pkt(THREE, o, q[0], q[1], q[2] + 0.04);
    });
    g.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0xffd400, linewidth: 2 })));

    // Stationsmarken alle 20 m. Die Stützpunkte liegen im 2-m-Raster ab
    // Station −23.943 – es trifft also KEINER eine runde Station. Darum
    // wird zwischen den beiden Nachbarpunkten interpoliert.
    var s0 = m.achse.sta0, schritt = m.achse.schritt || 2;
    var sEnd = s0 + (p.length - 1) * schritt;
    for (var sta = Math.ceil(s0 / 20) * 20; sta <= sEnd; sta += 20) {
      var f = (sta - s0) / schritt;
      var i0 = Math.min(p.length - 2, Math.max(0, Math.floor(f)));
      var t = f - i0;
      var v = pts[i0].clone().lerp(pts[i0 + 1], t);
      var hoehe = p[i0][2] + (p[i0 + 1][2] - p[i0][2]) * t;

      var stab = new THREE.Mesh(
        new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd400 }));
      stab.position.set(v.x, v.y + 0.7, v.z);
      g.add(stab);
      var l = schild(THREE, kurz(
        'km ' + (sta / 1000).toFixed(3) + ' · ' + hoehe.toFixed(2) + ' m ü.M.',
        (sta / 1000).toFixed(3) + ' · ' + hoehe.toFixed(0)), 'lbl-sta');
      l.position.set(v.x, v.y + 1.7, v.z);
      g.add(l);
      markenSta.push(l);
    }
    return g;
  }

  /* ── Laden ─────────────────────────────────────────────────────── */
  function laden(THREE, scene, o) {
    markenSta = []; markenD1 = [];
    return fetch(BASIS + 'alpstrasse.meta.json', { cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('alpstrasse.meta.json ' + r.status);
        return r.json();
      })
      .then(function (m) {
        meta = m;
        return Promise.all([
          bin(BASIS + 'planum.v.bin', Float32Array),
          bin(BASIS + 'planum.f.bin', Uint32Array),
          bin(BASIS + 'platte.v.bin', Float32Array),
          bin(BASIS + 'platte.f.bin', Uint32Array)
        ]);
      })
      .then(function (b) {
        gruppe = new THREE.Group();
        gruppe.name = 'alpstrasse';

        // Planum / UK Betonplatte - erdig, halbdurchsichtig, damit die
        // Platte darüber lesbar bleibt
        var planum = netz(THREE, zuSzene(b[0]), b[1],
          new THREE.MeshPhongMaterial({
            color: 0x8a6a4a, emissive: 0x1a1108, flatShading: true,
            shininess: 4, side: THREE.DoubleSide,
            transparent: true, opacity: 0.55
          }));
        planum.name = 'planum';
        gruppe.add(planum);

        // Betonplatte 16 cm - das, was gebaut wird
        var platte = netz(THREE, zuSzene(b[2]), b[3],
          new THREE.MeshPhongMaterial({
            color: 0xd6d9de, emissive: 0x15171a, flatShading: false,
            shininess: 22, specular: 0x2a2d33, side: THREE.DoubleSide
          }));
        platte.name = 'platte';
        gruppe.add(platte);

        gruppe.add(achse(THREE, o, meta));
        gruppe.add(schacht(THREE, o, meta.schacht_d1,
          meta.gradiente && meta.gradiente.laengsneigung_prozent));

        scene.add(gruppe);
        schilderAuffrischen();
        return { gruppe: gruppe, meta: meta };
      });
  }

  /* ── Steuerung ─────────────────────────────────────────────────────
     CSS2DRenderer schaut nur auf object.visible des Schildes selbst und
     NICHT auf die Eltern - ein unsichtbares gruppe hilft also nichts.
     Darum werden die Schilder hier immer von Hand mitgeschaltet.       */
  function schilderAuffrischen() {
    var an = !!gruppe && gruppe.visible;
    markenSta.forEach(function (l) { l.visible = an && stufe === 'alle'; });
    markenD1.forEach(function (l) { l.visible = an && stufe !== 'keine'; });
  }

  function sichtbar(an) {
    if (gruppe) gruppe.visible = an;
    schilderAuffrischen();
    return !!gruppe && gruppe.visible;
  }

  /* Nächste Beschriftungsstufe: alle -> nur D1 -> keine -> alle */
  function schilderWeiter() {
    stufe = stufe === 'alle' ? 'd1' : (stufe === 'd1' ? 'keine' : 'alle');
    schilderAuffrischen();
    return stufe;
  }

  function schilderStufe() { return stufe; }

  function teilSichtbar(name, an) {
    if (!gruppe) return;
    var m = gruppe.getObjectByName(name);
    if (m) m.visible = an;
  }

  /* Kurzfassung für die Infokarte */
  function infoHtml() {
    if (!meta) return '';
    var g = meta.gradiente || {}, p = meta.platte || {}, d = meta.schacht_d1 || {};
    var z = [];
    z.push('<b>Achse</b> ' + (meta.achse ? meta.achse.laenge.toFixed(1) : '?') +
      ' m · Längsneigung ' + (g.laengsneigung_prozent || '?') + ' %');
    z.push('<b>Betonplatte</b> ' + (p.breite_max || '?') + ' m breit, ' +
      ((p.dicke_m || 0) * 100).toFixed(0) + ' cm dick · ' +
      (p.flaeche_m2 || '?') + ' m² · ' + (p.volumen_m3 || '?') + ' m³');
    z.push('<b>Quergefälle</b> ' + (p.quergefaelle_min || '?') + ' bis ' +
      (p.quergefaelle_max || '?') + ' %');
    z.push('<b>Höhen</b> ' + (g.von || '?') + ' → ' + (g.bis || '?') + ' m ü.M.');
    z.push('<b>Höhenbezug</b> Modell = UK Betonplatte, OK liegt ' +
      ((p.dicke_m || 0) * 100).toFixed(0) + ' cm höher');
    if (d.punkte) {
      z.push('<b>Schacht D1</b> bei km ' + ((d.sta || 0) / 1000).toFixed(3) +
        ', die zwei Punkthöhen sind OK Betonplatte');
      z.push('<b>Achtung</b> Quergefälle dort ' +
        Math.abs(d.quergefaelle || 0).toFixed(1) + ' % nach ' + d.faellt_nach +
        ' → Entwässerungsöffnungen dort neu bohren');
    }
    z.push('<i>Quelle: LandXML F. Borner, Modellstand ' +
      (meta.stand || '?').slice(0, 10) + '</i>');
    return z.join('<br>');
  }

  /* Eine Zeile für die eingeklappte Karte auf dem Handy */
  function kurzHtml() {
    if (!meta) return 'Alpstrasse';
    var g = meta.gradiente || {}, p = meta.platte || {};
    return (meta.achse ? meta.achse.laenge.toFixed(0) : '?') + ' m · ' +
      (g.laengsneigung_prozent || '?') + ' % · Platte ' +
      ((p.dicke_m || 0) * 100).toFixed(0) + ' cm · Schacht D1';
  }

  return {
    laden: laden,
    sichtbar: sichtbar,
    schilderWeiter: schilderWeiter,
    schilderStufe: schilderStufe,
    teilSichtbar: teilSichtbar,
    infoHtml: infoHtml,
    kurzHtml: kurzHtml,
    meta: function () { return meta; },
    gruppe: function () { return gruppe; }
  };
})();
