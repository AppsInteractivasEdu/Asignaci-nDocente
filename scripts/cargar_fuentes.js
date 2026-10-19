/*
 * Lee los archivos fuente de la carpeta del proyecto (planes, perfiles Word y bases de profesores)
 * y construye las "fuentes" normalizadas que usa la aplicación.
 * Uso (Node 18+ con los paquetes xlsx y jszip instalados):
 *   node scripts/cargar_fuentes.js <carpeta_fuentes>
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const XLSX = require('xlsx');
const JSZip = require('jszip');
const Engine = require('../js/engine.js');

function leerHoja(buf, sheetPref) {
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false, raw: false });
  const name = (sheetPref && wb.SheetNames.find(n => sheetPref.test(n))) || wb.SheetNames[0];
  return { rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: '', raw: false }), hoja: name };
}

async function cargar(dir, opts) {
  opts = opts || {};
  const files = fs.readdirSync(dir).filter(f => !f.startsWith('~$') && !f.startsWith('.'));
  const archivos = [];
  const fuentes = { planes: [], perfilDocs: [], formacion: null, experiencia: null };
  const reg = (tipo, f, buf, detalle, filas) => archivos.push({
    tipo, nombre: f, detalle, filas, tamano: buf.length, cargado: fs.statSync(path.join(dir, f)).mtime.toISOString(),
    huella: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
  });

  for (const f of files.filter(f => /plan/i.test(f) && /\.xlsx$/i.test(f))) {
    const buf = fs.readFileSync(path.join(dir, f));
    const { rows, hoja } = leerHoja(buf);
    const p = Engine.procesarPlan(rows);
    fuentes.planes.push({ archivo: f, plan: p.plan, rows: p.rows });
    reg('Plan de estudios', f, buf, p.plan + ' · hoja "' + hoja + '" · ' + p.rows.length + ' filas', p.rows.length);
  }
  const progs = Engine.inventario(fuentes.planes).programas;
  for (const f of files.filter(f => /perfil/i.test(f) && /\.docx$/i.test(f))) {
    const buf = fs.readFileSync(path.join(dir, f));
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml').async('string');
    const r = Engine.parsePerfiles(Engine.docxParagraphs(xml), f, progs);
    fuentes.perfilDocs.push({ archivo: f, programaDetectado: r.programaDetectado, programa: r.programa, perfiles: r.perfiles });
    reg('Perfiles docentes', f, buf, (r.programa || 'Programa no identificado') + ' · ' + r.perfiles.length + ' perfiles', r.perfiles.length);
  }
  const fForm = files.find(f => /formaci/i.test(f) && /\.xlsx$/i.test(f));
  if (fForm) {
    const buf = fs.readFileSync(path.join(dir, fForm));
    const { rows, hoja } = leerHoja(buf, /^report$/i);
    const form = Engine.procesarFormacion(rows);
    fuentes.formacion = { archivo: fForm, personas: [...form.profesores.values()] };
    reg('Profesores – formación académica', fForm, buf, 'hoja "' + hoja + '" · ' + form.filas + ' registros · ' + form.profesores.size + ' personas', form.filas);
  }
  const fExp = files.find(f => /experiencia/i.test(f) && /\.xlsx$/i.test(f));
  if (fExp) {
    const buf = fs.readFileSync(path.join(dir, fExp));
    const { rows, hoja } = leerHoja(buf, /^report$/i);
    const exp = Engine.procesarExperiencia(rows, opts.hoy);
    fuentes.experiencia = { archivo: fExp, personas: [...exp.experiencia.values()] };
    reg('Profesores – experiencia', fExp, buf, 'hoja "' + hoja + '" · ' + exp.filas + ' registros · ' + exp.experiencia.size + ' personas', exp.filas);
  }
  const { ds, meta } = Engine.construirDataset(fuentes);
  meta.archivos = archivos;
  meta.generado = new Date(opts.hoy || Date.now()).toISOString();
  return { fuentes, ds, meta };
}

module.exports = { cargar };

if (require.main === module) {
  cargar(process.argv[2] || path.join(__dirname, '..', '..')).then(({ ds, meta }) => {
    console.log('Cursos:', ds.cursos.length, 'Perfiles:', ds.perfiles.length, 'Profesores:', ds.profesores.length);
    console.log(meta.archivos.map(a => a.tipo + ' | ' + a.nombre + ' | ' + a.detalle).join('\n'));
  });
}
