#!/usr/bin/env node
/*
 * ifc-to-leitungen.js — IFC (IFC4X3 TriangulatedFaceSet) → 3D-Viewer Binärformat
 *
 * Erzeugt die vom 3D-Viewer (viewer3d.html) geladenen Dateien:
 *   <out>.v.bin   Float32  Positionen im Frame [East-OE, North-ON, Elev-OZ]
 *   <out>.f.bin   Uint32   Dreiecks-Indizes
 *   <out>.c.bin   Float32  Vertex-Farben [r,g,b]  (nur bei vertexColors)
 *   <out>.meta.json        { vertexColors, vCount, fCount, legend, labels }
 *
 * Koordinaten-Transform (gegen bestehende werkleitungen.ifc validiert):
 *   web-ifc Welt (Y-up) (X_w, Y_w, Z_w) = (East, Elev, -North) absolut
 *   gespeichert: [X_w - OE, -Z_w - ON, Y_w - OZ]
 *   Der Viewer mappt dann zu Y-up: [x, z, -y].
 *
 * Kategorisierung über den IfcBuiltElement-Namen (z.B. KSR_FV60_VK, KSR_120_VK,
 * HRB_VK, Schacht_3D) → 60 / 120 / hrb / schacht.
 *
 * Setup:  npm i web-ifc
 * Aufruf: node tools/ifc-to-leitungen.js <out-basis> <datei1.ifc> [datei2.ifc ...]
 * Default (ohne Args): die drei PZ2/PZ3-Files → uploads/ifc/leitungen26
 */
const { IfcAPI } = require('web-ifc');
const fs = require('fs');
const path = require('path');

// LV95-Ursprung des 3D-Viewers (siehe viewer3d.html: OE/ON/OZ)
const OE = 2701555, ON = 1165641, OZ = 1950;

// Kategorie → Farbe (RGB 0..1) + Legenden-Label. Muss zur Legende in viewer3d.html passen.
const CATS = {
  '60':      { col:[0.16,0.80,0.45], label:'Leitung 60' },     // grün
  '120':     { col:[1.00,0.30,0.30], label:'Leitung 120' },    // rot
  'hrb':     { col:[0.12,0.58,0.95], label:'HRB (Hauptrohr)' },// blau
  'schacht': { col:[0.80,0.80,0.80], label:'Schacht' },        // grau
  'other':   { col:[0.90,0.75,0.20], label:'Sonstige' }        // amber Fallback
};

function classify(name){
  if(!name) return 'other';
  const n = name.toUpperCase();
  if(n.includes('120')) return '120';
  if(n.includes('FV60') || n.includes('_60') || n.includes('KSR_60')) return '60';
  if(n.includes('HRB')) return 'hrb';
  if(n.includes('SCHACHT')) return 'schacht';
  return 'other';
}

const REPO = path.resolve(__dirname, '..');
const DEFAULT_FILES = [
  'uploads/ifc/NalpSolar_51_M_0468_A2_TB-2026-PZ2-WL.ifc',
  'uploads/ifc/NalpSolar_51_M_0465_A1_TB-2026-PZ2-HRB.ifc',
  'uploads/ifc/NalpSolar_51_M_0472_A1_TB-2027-PZ3-HRB.ifc'
];

(async () => {
  const argv = process.argv.slice(2);
  const outBase = argv[0] ? path.resolve(argv[0]) : path.join(REPO, 'uploads/ifc/leitungen26');
  const files = (argv.length > 1 ? argv.slice(1) : DEFAULT_FILES).map(f => path.resolve(REPO, f));

  const api = new IfcAPI();
  await api.Init();

  const vmap = new Map();   // dedup-key -> index (Vertex-Welding)
  const positions = [];     // x,y,z im Frame [E-OE, N-ON, elev-OZ]
  const colors = [];        // r,g,b pro Vertex
  const indices = [];
  const catCount = {};
  for(const c of Object.keys(CATS)) catCount[c] = { elems:0, tris:0 };

  function addVert(x, y, z, col){
    const key = Math.round(x*1e4)+'_'+Math.round(y*1e4)+'_'+Math.round(z*1e4)+'_'+col[0]+'_'+col[1]+'_'+col[2];
    let idx = vmap.get(key);
    if(idx === undefined){
      idx = positions.length/3;
      positions.push(x,y,z);
      colors.push(col[0],col[1],col[2]);
      vmap.set(key, idx);
    }
    return idx;
  }

  for(const file of files){
    const mid = api.OpenModel(new Uint8Array(fs.readFileSync(file)));
    api.StreamAllMeshes(mid, (mesh) => {
      const line = api.GetLine(mid, mesh.expressID);
      const cat = classify(line && line.Name ? line.Name.value : '');
      const col = CATS[cat].col;
      catCount[cat].elems++;
      const gs = mesh.geometries;
      for(let i=0; i<gs.size(); i++){
        const pg = gs.get(i);
        const g  = api.GetGeometry(mid, pg.geometryExpressID);
        const va = api.GetVertexArray(g.GetVertexData(), g.GetVertexDataSize()); // [x,y,z,nx,ny,nz]
        const ia = api.GetIndexArray (g.GetIndexData(),  g.GetIndexDataSize());
        const m  = pg.flatTransformation; // 4x4 column-major (Welt-Transform inkl. Placement)
        const nv = va.length/6;
        const local = new Array(nv);
        for(let v=0; v<nv; v++){
          const x=va[v*6], y=va[v*6+1], z=va[v*6+2];
          const wx = m[0]*x + m[4]*y + m[8]*z  + m[12];
          const wy = m[1]*x + m[5]*y + m[9]*z  + m[13];
          const wz = m[2]*x + m[6]*y + m[10]*z + m[14];
          local[v] = addVert(wx-OE, -wz-ON, wy-OZ, col);
        }
        for(let k=0; k<ia.length; k+=3){
          indices.push(local[ia[k]], local[ia[k+1]], local[ia[k+2]]);
          catCount[cat].tris++;
        }
      }
    });
    api.CloseModel(mid);
  }

  const vCount = positions.length/3, fCount = indices.length/3;
  fs.writeFileSync(outBase+'.v.bin', Buffer.from(new Float32Array(positions).buffer));
  fs.writeFileSync(outBase+'.c.bin', Buffer.from(new Float32Array(colors).buffer));
  fs.writeFileSync(outBase+'.f.bin', Buffer.from(new Uint32Array(indices).buffer));
  const legend = Object.keys(CATS).filter(c => catCount[c].elems > 0).map(c => ({
    key:c, label:CATS[c].label, color:CATS[c].col, elems:catCount[c].elems, tris:catCount[c].tris
  }));
  fs.writeFileSync(outBase+'.meta.json', JSON.stringify({ vertexColors:true, vCount, fCount, legend, labels:[] }));

  console.log('OK ->', outBase + '.{v,f,c}.bin + .meta.json');
  console.log('  vCount', vCount, 'fCount', fCount);
  console.log('  legend', JSON.stringify(legend));
})().catch(e => { console.error(e); process.exit(1); });
