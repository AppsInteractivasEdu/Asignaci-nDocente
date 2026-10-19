/*
 * Genera el conjunto de datos base de la aplicación y los reportes Excel iniciales.
 * Uso:  node scripts/generar.js [carpeta_fuentes]
 * Requiere Node 18+ y los paquetes: xlsx, jszip, exceljs  (npm i xlsx jszip exceljs)
 */
const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const Engine = require('../js/engine.js');
const Reportes = require('../js/reportes.js');
const { cargar } = require('./cargar_fuentes.js');

const APP = path.join(__dirname, '..');
const FUENTES = process.argv[2] || path.join(APP, '..');

(async () => {
  const hoy = Date.now();
  const { fuentes, ds, meta } = await cargar(FUENTES, { hoy });
  const an = Engine.analizar(ds, Engine.DEFAULT_CONFIG, {});
  const ctx = Reportes.contexto(ds, an, { meta, fecha: hoy });

  // 1. Datos base para la aplicación
  fs.mkdirSync(path.join(APP, 'data'), { recursive: true });
  const base = { version: Engine.VERSION, generado: meta.generado, archivos: meta.archivos, fuentes };
  fs.writeFileSync(path.join(APP, 'data', 'datos_base.js'),
    '/* Datos base generados automáticamente a partir de los archivos fuente (' + new Date(hoy).toISOString() + '). No editar a mano. */\n' +
    'window.DATOS_BASE = ' + JSON.stringify(base) + ';\n');

  // 2. Reportes
  const R = path.join(APP, 'Reportes');
  const RP = path.join(R, 'Por_programa');
  fs.mkdirSync(RP, { recursive: true });
  await Reportes.libroConsolidado(ExcelJS, ctx).xlsx.writeFile(path.join(R, 'Consolidado_Asignacion_Docente_Licenciaturas.xlsx'));
  await Reportes.libroPendientes(ExcelJS, ctx).xlsx.writeFile(path.join(R, 'Asignaturas_sin_docente_asignado.xlsx'));
  await Reportes.libroInventario(ExcelJS, ctx).xlsx.writeFile(path.join(R, 'Inventario_asignaturas_por_componente.xlsx'));
  await Reportes.libroMatriz(ExcelJS, ctx).xlsx.writeFile(path.join(R, 'Matriz_correspondencia_perfiles.xlsx'));
  for (const p of meta.programasPlan) {
    await Reportes.libroPrograma(ExcelJS, ctx, p).xlsx.writeFile(path.join(RP, 'Asignacion_' + Reportes.nombreArchivo(p) + '.xlsx'));
  }

  // 3. Resumen en consola
  const st = ctx.stats;
  console.log('Programas:', st.programas, '| Asignaturas:', st.total, JSON.stringify(st.porComp));
  console.log('Estados:', JSON.stringify(st.porEstado));
  console.log('Docentes con carga:', st.docentes);
  ctx.qa.forEach(q => console.log('[' + q.estado + ']', q.nombre, '—', q.detalle.slice(0, 160)));
  fs.writeFileSync(path.join(APP, 'data', 'resumen_generacion.json'), JSON.stringify({ fecha: new Date(hoy).toISOString(), stats: { ...st }, qa: ctx.qa, archivos: meta.archivos }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
