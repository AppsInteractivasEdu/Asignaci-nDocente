/*
 * Generación de reportes Excel (ExcelJS) – compartido por la aplicación web y el script de generación.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./engine.js'));
  else root.Reportes = factory(root.Engine);
})(typeof self !== 'undefined' ? self : this, function (Engine) {
  'use strict';
  const EST = Engine.EST;

  const AZUL = 'FF1F3864', AZUL_CLARO = 'FFDCE6F2', BLANCO = 'FFFFFFFF', GRIS = 'FFF2F2F2';
  const FILL_ESTADO = {};
  FILL_ESTADO[EST.PROP] = 'FFDDEBF7';
  FILL_ESTADO[EST.APROB] = 'FFE2EFDA';
  FILL_ESTADO[EST.PEND] = 'FFFCE4D6';
  FILL_ESTADO[EST.SINP] = 'FFEDEDED';
  FILL_ESTADO[EST.VALID] = 'FFFFF2CC';
  FILL_ESTADO[EST.VALDOC] = 'FFFFF2CC';
  FILL_ESTADO[EST.DIR] = 'FFF8CBAD';
  const FILL_REQ = { A: 'FFE2EFDA', C: 'FFE2EFDA', F: 'FFFFF2CC', I: 'FFFFF2CC', N: 'FFFCE4D6' };

  const COLS_ASIG = [
    { h: 'Programa académico', k: 'programa', w: 26 },
    { h: 'Componente académico', k: 'componente', w: 20 },
    { h: 'Código de asignatura', k: 'codigo', w: 14 },
    { h: 'Nombre de la asignatura', k: 'asignatura', w: 32 },
    { h: 'Docente asignado', k: 'docente', w: 26 },
    { h: 'Perfil del docente', k: 'perfilDocente', w: 60 },
    { h: 'Perfil requerido por la asignatura', k: 'perfilRequerido', w: 70 },
    { h: 'Correspondencia con el perfil', k: 'correspondencia', w: 45 },
    { h: 'Estado de asignación', k: 'estado', w: 20 },
    { h: 'Observaciones y justificación', k: 'observaciones', w: 80 },
    { h: 'Plan de estudios', k: 'plan', w: 16 },
    { h: 'Semestre', k: 'semestre', w: 9 },
    { h: 'Créditos', k: 'creditos', w: 9 },
    { h: 'Horas estimadas', k: 'horas', w: 10 },
    { h: 'Puntaje de pertinencia (0-100)', k: 'puntaje', w: 12 },
    { h: 'Alternativas (orden de pertinencia)', k: 'alternativas', w: 40 },
    { h: 'Perfil asociado (documento)', k: 'perfilAsociado', w: 34 },
    { h: 'Asignación manual', k: 'manual', w: 10 },
    { h: 'Docente 2026-II (antecedente)', k: 'docente2026', w: 28 },
    { h: 'Tipo de asignación', k: 'tipoAsignacion', w: 16 },
    { h: 'Carga total proyectada 2027-I (h)', k: 'cargaTotal', w: 14 },
    { h: 'Docentes para revisión del Director', k: 'revisionDirector', w: 44 },
  ];

  function fmtFecha(d) {
    d = d ? new Date(d) : new Date();
    const p = n => String(n).padStart(2, '0');
    return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function hoja(wb, nombre, titulo, subtitulo, cols, filas, opts) {
    opts = opts || {};
    const ws = wb.addWorksheet(nombre.slice(0, 31), { views: [{ state: 'frozen', ySplit: 4, xSplit: opts.xSplit || 0 }], properties: { defaultRowHeight: 15 } });
    ws.columns = cols.map(c => ({ key: c.k, width: c.w }));
    ws.mergeCells(1, 1, 1, Math.min(cols.length, 8));
    ws.getCell(1, 1).value = titulo;
    ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: AZUL } };
    ws.mergeCells(2, 1, 2, Math.min(cols.length, 8));
    ws.getCell(2, 1).value = subtitulo;
    ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: 'FF595959' } };
    const hr = ws.getRow(4);
    cols.forEach((c, i) => {
      const cell = hr.getCell(i + 1);
      cell.value = c.h;
      cell.font = { bold: true, color: { argb: BLANCO } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FF8EA9DB' } } };
    });
    hr.height = 34;
    filas.forEach((f, idx) => {
      const row = ws.getRow(5 + idx);
      cols.forEach((c, i) => {
        const v = typeof c.k === 'function' ? c.k(f) : f[c.k];
        const cell = row.getCell(i + 1);
        cell.value = v == null ? '' : v;
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.border = { bottom: { style: 'hair', color: { argb: 'FFBFBFBF' } } };
      });
      if (opts.estadoCol) {
        const cell = row.getCell(opts.estadoCol);
        const fill = FILL_ESTADO[cell.value];
        if (fill) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }; cell.font = { bold: true }; }
      }
      if (opts.onRow) opts.onRow(row, f);
    });
    if (filas.length) ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4 + filas.length, column: cols.length } };
    else ws.getCell(5, 1).value = 'Sin registros.';
    ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    return ws;
  }

  function subtitulo(ctx, extra) {
    return 'Generado: ' + fmtFecha(ctx.fecha) + ' · Departamento de Pedagogía y Didáctica · Propuesta sujeta a revisión y aprobación académica' + (extra ? ' · ' + extra : '');
  }

  function hojaAsignacion(wb, ctx, nombre, titulo, filas) {
    return hoja(wb, nombre, titulo, subtitulo(ctx, filas.length + ' asignaturas'), COLS_ASIG, filas, { estadoCol: 9, xSplit: 4 });
  }

  function filasMatriz(ctx, filtro) {
    const out = [];
    const profPorId = new Map(ctx.ds.profesores.map(p => [p.id, p]));
    const perfilPorId = new Map(ctx.ds.perfiles.map(p => [p.id, p]));
    ctx.ds.cursos.filter(filtro || (() => true)).forEach(c => {
      const r = ctx.an.resultados.get(c.id);
      const base = { programa: c.programa, plan: c.plan, componente: c.componente, asignatura: c.asignatura, estado: r.estado };
      if (!c.perfilId) { out.push(Object.assign({}, base, { rol: '—', docente: 'Perfil no disponible' })); return; }
      const perfil = perfilPorId.get(c.perfilId);
      const lista = [];
      if (r.docenteId) lista.push({ rol: r.manual ? 'Asignado (manual)' : 'Propuesto', id: r.docenteId });
      r.alternativas.forEach((a, i) => lista.push({ rol: 'Alternativa ' + (i + 1), id: a.id }));
      if (!lista.length) { out.push(Object.assign({}, base, { rol: '—', docente: 'Por designar', pre: r.observaciones[0] || '' })); return; }
      lista.forEach(x => {
        const p = profPorId.get(x.id);
        if (!p) return;
        const ev = Engine.evaluar(perfil, p, ctx.an.config);
        const L = q => q ? (Engine.R[q.s] + ' — ' + q.det) : '';
        out.push(Object.assign({}, base, {
          rol: x.rol, docente: p.nombre, puntaje: ev.score, nivel: Engine.nivelCorrespondencia(ev),
          pre: L(ev.pre), pos: L(ev.pos), exp: L(ev.exp), esp: L(ev.expEsp), inv: L(ev.inv), comp: L(ev.comp), bdc: L(ev.bdc),
          otros: (ev.otros || []).map(o => o.nombre + ': ' + Engine.R[o.s]).join('; '),
          carga: ctx.an.carga.get(x.id) || 0, _ev: ev,
        }));
      });
    });
    return out;
  }

  const COLS_MATRIZ = [
    { h: 'Programa académico', k: 'programa', w: 26 }, { h: 'Plan', k: 'plan', w: 14 }, { h: 'Componente', k: 'componente', w: 18 },
    { h: 'Asignatura', k: 'asignatura', w: 30 }, { h: 'Rol', k: 'rol', w: 14 }, { h: 'Docente', k: 'docente', w: 26 },
    { h: 'Puntaje', k: 'puntaje', w: 9 }, { h: 'Nivel de correspondencia', k: 'nivel', w: 18 },
    { h: 'Formación de pregrado', k: 'pre', w: 45 }, { h: 'Formación posgradual', k: 'pos', w: 45 }, { h: 'Experiencia docente', k: 'exp', w: 38 },
    { h: 'Experiencia específica', k: 'esp', w: 38 }, { h: 'Experiencia investigativa', k: 'inv', w: 38 }, { h: 'Competencias', k: 'comp', w: 30 },
    { h: 'Hoja de vida (BDC)', k: 'bdc', w: 26 }, { h: 'Otros requisitos', k: 'otros', w: 26 }, { h: 'Carga asignada (h)', k: 'carga', w: 10 },
    { h: 'Estado de la asignatura', k: 'estado', w: 20 },
  ];
  function pintarMatriz(row, f) {
    if (!f._ev) return;
    const m = { 9: f._ev.pre, 10: f._ev.pos, 11: f._ev.exp, 12: f._ev.expEsp, 13: f._ev.inv, 14: f._ev.comp, 15: f._ev.bdc };
    Object.keys(m).forEach(k => { const q = m[k]; if (q && FILL_REQ[q.s]) row.getCell(+k).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FILL_REQ[q.s] } }; });
    if (/^Propuesto|^Asignado/.test(f.rol)) row.getCell(5).font = { bold: true };
  }
  function hojaMatriz(wb, ctx, filtro) {
    const filas = filasMatriz(ctx, filtro);
    const ws = hoja(wb, 'Matriz de correspondencia', 'Matriz de correspondencia perfil requerido – perfil del docente',
      subtitulo(ctx, 'Verde: acreditado · Amarillo: afinidad por validar / información insuficiente · Naranja: no acreditado'), COLS_MATRIZ, filas, { estadoCol: 18, onRow: pintarMatriz, xSplit: 6 });
    return ws;
  }

  const COLS_INV = [
    { h: 'Programa académico', k: 'programa', w: 30 }, { h: 'Plan de estudios', k: 'plan', w: 16 }, { h: 'Componente académico', k: 'componente', w: 24 },
    { h: 'Componente en el plan oficial', k: 'componenteOficial', w: 30 }, { h: 'Código', k: c => c.codigo || 'Sin código en el plan', w: 14 },
    { h: 'Asignatura', k: 'asignatura', w: 40 }, { h: 'Semestre', k: 'semestre', w: 9 }, { h: 'Créditos', k: 'creditos', w: 9 },
    { h: 'Prerrequisitos', k: 'prerrequisitos', w: 30 }, { h: 'Perfil docente', k: c => c.perfilId ? (c.perfilMatch === 'exacta' ? 'Disponible' : 'Disponible por equivalencia') : 'No disponible', w: 18 },
    { h: 'Revisión de clasificación / observaciones', k: c => [c.revisionClasificacion, c.perfilNota].filter(Boolean).join(' '), w: 60 },
  ];
  function hojaInventario(wb, ctx, cursos) {
    return hoja(wb, 'Inventario asignaturas', 'Inventario de asignaturas – componentes Pedagógico, Didáctica de las Disciplinas y PPI',
      subtitulo(ctx, cursos.length + ' asignaturas'), COLS_INV, cursos, { xSplit: 1 });
  }

  function hojaResumen(wb, ctx) {
    const st = ctx.stats;
    const ws = wb.addWorksheet('Resumen', { properties: { defaultRowHeight: 16 } });
    ws.columns = [{ width: 46 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 16 }, { width: 16 }, { width: 12 }];
    ws.getCell('A1').value = 'Resumen general de asignación docente – Licenciaturas';
    ws.getCell('A1').font = { bold: true, size: 14, color: { argb: AZUL } };
    ws.getCell('A2').value = subtitulo(ctx);
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF595959' } };
    const kpis = [
      ['Número total de programas analizados', st.programas],
      ['Total de asignaturas identificadas (3 componentes)', st.total],
      ['Asignaturas – Componente Pedagógico', st.porComp[Engine.COMP.PED]],
      ['Asignaturas – Didáctica de las Disciplinas', st.porComp[Engine.COMP.DID]],
      ['Asignaturas – Práctica Pedagógica Investigativa', st.porComp[Engine.COMP.PPI]],
      ['Asignaturas con docente propuesto (propuesta, aprobada o en validación)', st.conDocente],
      ['Asignaturas en estado "Asignación propuesta"', st.porEstado[EST.PROP]],
      ['Asignaturas en estado "Asignación aprobada"', st.porEstado[EST.APROB]],
      ['Asignaturas pendientes de validación', st.porEstado[EST.VALID]],
      ['Asignaturas pendientes de validación documental', st.porEstado[EST.VALDOC]],
      ['Asignaturas pendientes de autorización del Director', st.porEstado[EST.DIR]],
      ['Asignaturas pendientes por designar', st.pendientes],
      ['Asignaturas sin perfil docente disponible', st.sinPerfil],
      ['Porcentaje de asignaturas con asignación aprobada', st.pctAprobadas / 100],
      ['Docentes con carga asignada', st.docentes],
      ['Tope de carga por docente (horas)', ctx.an.config.maxHoras],
      ['Horas estimadas por crédito', ctx.an.config.horasPorCredito],
    ];
    ws.getCell('A4').value = 'Indicador'; ws.getCell('B4').value = 'Valor';
    ['A4', 'B4'].forEach(a => { ws.getCell(a).font = { bold: true, color: { argb: BLANCO } }; ws.getCell(a).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; });
    kpis.forEach((k, i) => {
      ws.getCell(5 + i, 1).value = k[0];
      const c = ws.getCell(5 + i, 2);
      c.value = k[1];
      if (/Porcentaje/.test(k[0])) c.numFmt = '0.0%';
      c.font = { bold: true };
      if (i % 2) { ws.getCell(5 + i, 1).fill = ws.getCell(5 + i, 2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GRIS } }; }
    });
    let r0 = 5 + kpis.length + 2;
    ws.getCell(r0, 1).value = 'Distribución por programa';
    ws.getCell(r0, 1).font = { bold: true, size: 12, color: { argb: AZUL } };
    const enc = ['Programa', 'Total', 'Pedagógico', 'Didáctica', 'PPI', EST.PROP, EST.APROB, EST.VALID, EST.PEND, EST.SINP, EST.VALDOC, EST.DIR, '% aprobada'];
    enc.forEach((h, i) => { const c = ws.getCell(r0 + 1, i + 1); c.value = h; c.font = { bold: true, color: { argb: BLANCO } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } }; c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' }; });
    ws.getRow(r0 + 1).height = 32;
    st.porPrograma.forEach((p, i) => {
      const vals = [p.programa, p.total, p[Engine.COMP.PED], p[Engine.COMP.DID], p[Engine.COMP.PPI], p[EST.PROP], p[EST.APROB], p[EST.VALID], p[EST.PEND], p[EST.SINP], p[EST.VALDOC], p[EST.DIR], p.total ? p[EST.APROB] / p.total : 0];
      vals.forEach((v, j) => { const c = ws.getCell(r0 + 2 + i, j + 1); c.value = v; if (j === 12) c.numFmt = '0.0%'; });
    });
    const rt = r0 + 2 + st.porPrograma.length;
    ws.getCell(rt, 1).value = 'Total';
    for (let j = 2; j <= 12; j++) {
      const col = String.fromCharCode(64 + j);
      ws.getCell(rt, j).value = { formula: 'SUM(' + col + (r0 + 2) + ':' + col + (rt - 1) + ')' };
    }
    ws.getCell(rt, 13).value = { formula: 'IF(B' + rt + '=0,0,G' + rt + '/B' + rt + ')' }; ws.getCell(rt, 13).numFmt = '0.0%';
    for (let j = 1; j <= 13; j++) { ws.getCell(rt, j).font = { bold: true }; ws.getCell(rt, j).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } }; }
    ws.getCell(rt + 2, 1).value = 'Nota: todas las asignaciones tienen carácter de propuesta y están sujetas a revisión y aprobación académica. La valoración distingue requisitos acreditados, no acreditados e información insuficiente.';
    ws.getCell(rt + 2, 1).font = { italic: true, size: 9 };
    return ws;
  }

  function hojaCarga(wb, ctx) {
    const profPorId = new Map(ctx.ds.profesores.map(p => [p.id, p]));
    const cursoPorId = new Map(ctx.ds.cursos.map(c => [c.id, c]));
    const filas = [...ctx.an.asignados.entries()].map(([id, cs]) => {
      const p = profPorId.get(id);
      return {
        docente: p ? p.nombre : id, horas: ctx.an.carga.get(id) || 0, n: cs.length,
        asignaturas: cs.map(cid => { const c = cursoPorId.get(cid); return c.asignatura + ' – ' + c.programa.replace('Licenciatura en ', 'Lic. ') + ' (' + ctx.an.resultados.get(cid).horas + ' h)'; }).join('\n'),
        estado: p ? p.estadoBDC : '', resumen: p ? Engine.resumenProfesor(p) : '',
      };
    }).sort((a, b) => b.horas - a.horas || a.docente.localeCompare(b.docente, 'es'));
    return hoja(wb, 'Carga docente', 'Carga asignada por docente (tope ' + ctx.an.config.maxHoras + ' h)', subtitulo(ctx, filas.length + ' docentes'),
      [{ h: 'Docente', k: 'docente', w: 30 }, { h: 'Horas asignadas', k: 'horas', w: 10 }, { h: 'N.º asignaturas', k: 'n', w: 10 },
        { h: 'Asignaturas', k: 'asignaturas', w: 70 }, { h: 'Estado BDC', k: 'estado', w: 20 }, { h: 'Perfil del docente', k: 'resumen', w: 80 }], filas,
      { onRow: (row, f) => { if (f.horas > ctx.an.config.maxHoras) row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }; } });
  }

  function hojaPendientes(wb, ctx, filas) {
    const pend = filas.filter(f => f.docente === 'Por designar' || f.estado === EST.PEND || f.estado === EST.SINP);
    return hoja(wb, 'Pendientes por designar', 'Asignaturas sin docente asignado (pendientes por designar y sin perfil)', subtitulo(ctx, pend.length + ' asignaturas'),
      [COLS_ASIG[0], COLS_ASIG[1], COLS_ASIG[2], COLS_ASIG[3], COLS_ASIG[10], { h: 'Créditos', k: 'creditos', w: 9 }, { h: 'Horas estimadas', k: 'horas', w: 10 },
        { h: 'Estado de asignación', k: 'estado', w: 20 }, { h: 'Razón / observaciones', k: 'observaciones', w: 90 }, { h: 'Candidatos para revisión', k: 'alternativas', w: 40 }],
      pend, { estadoCol: 8, xSplit: 4 });
  }

  /* ---------------- Fase 7: comparativo 2026-II vs 2027-I, no asignados y autorizaciones PPI ---------------- */
  const TIPO_TXT = { 'continuidad': 'Continuidad', 'progresión': 'Progresión', 'nueva': 'Nueva', 'pendiente': 'Pendiente' };
  const CORR_TXT = { A: 'Cumple', F: 'No cumple (afinidad, otra disciplina)', C: 'No cumple (vía alterna, otra disciplina)', N: 'No cumple', I: 'No verificable' };

  function filasComparativo(ctx, programa) {
    const aut = (ctx.fase7 && ctx.fase7.autorizaciones) || [];
    return ctx.filas.filter(f => !programa || f.programa === programa).map(f => {
      const x = f.f7 || {};
      const prev = x.prev26 || [];
      const origen = x.origen;
      const esPPI = f.componente === Engine.COMP.PPI;
      const a = esPPI && f.docenteId ? aut.find(e => e.docenteId === f.docenteId && Engine.progN(e.programa) === Engine.progN(f.programa) && e.nivelNum === Engine.nivelPPI(f.asignatura)) : null;
      return {
        programa: f.programa, componente: f.componente,
        asig26: origen ? origen.asignatura : (prev.length ? f.asignatura : ''),
        doc26: origen ? origen.nombre : prev.join('; '),
        asig27: f.asignatura, doc27: f.docente,
        perfil: f.perfilRequerido, corr: f.correspondencia,
        tipo: TIPO_TXT[x.tipo] || '', carga: x.cargaTotal != null ? x.cargaTotal : '', estado: f.estado, obs: f.observaciones,
        pregrado: esPPI ? (x.pregrado || '') : '', corrDisc: esPPI && x.preS ? CORR_TXT[x.preS] : '',
        nOrig: x.nivelOrigen ? Engine.ROMANO(x.nivelOrigen) : '', nDest: esPPI && Engine.nivelPPI(f.asignatura) ? Engine.ROMANO(Engine.nivelPPI(f.asignatura)) : '',
        excep: a ? 'Sí' : (esPPI ? 'No' : ''), just: a ? a.justificacion : '', decision: a ? a.director + ' — ' + a.decision : '', fechaDec: a ? a.fecha : '',
      };
    });
  }
  function hojaComparativo(wb, ctx, programa) {
    const filas = filasComparativo(ctx, programa);
    return hoja(wb, 'COMPARATIVO 2026-II vs 2027-I', 'Comparativo 2026-II vs 2027-I' + (programa ? ' – ' + programa : ''), subtitulo(ctx, filas.length + ' asignaturas'),
      [{ h: 'Programa', k: 'programa', w: 26 }, { h: 'Componente', k: 'componente', w: 18 }, { h: 'Asignatura 2026-II', k: 'asig26', w: 30 }, { h: 'Profesor 2026-II', k: 'doc26', w: 28 },
        { h: 'Asignatura propuesta 2027-I', k: 'asig27', w: 32 }, { h: 'Profesor propuesto 2027-I', k: 'doc27', w: 28 }, { h: 'Perfil requerido', k: 'perfil', w: 60 }, { h: 'Cumplimiento', k: 'corr', w: 45 },
        { h: 'Tipo de asignación', k: 'tipo', w: 14 }, { h: 'Carga total proyectada (h)', k: 'carga', w: 12 }, { h: 'Estado', k: 'estado', w: 22 }, { h: 'Observaciones', k: 'obs', w: 80 },
        { h: 'PPI: pregrado del profesor', k: 'pregrado', w: 34 }, { h: 'PPI: correspondencia disciplinar', k: 'corrDisc', w: 26 }, { h: 'PPI: nivel de origen', k: 'nOrig', w: 10 }, { h: 'PPI: nivel de destino', k: 'nDest', w: 10 },
        { h: 'PPI: autorización excepcional', k: 'excep', w: 12 }, { h: 'PPI: justificación', k: 'just', w: 40 }, { h: 'PPI: decisión del Director', k: 'decision', w: 32 }, { h: 'PPI: fecha de la decisión', k: 'fechaDec', w: 14 }],
      filas, { estadoCol: 11, xSplit: 3, onRow: (row, f) => { if (f.carga !== '' && f.carga > ctx.an.config.maxHoras) row.getCell(10).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFCE4D6' } }; } });
  }
  function hojaNoAsignados(wb, ctx, programa) {
    const na = ((ctx.fase7 && ctx.fase7.noAsignados) || []).filter(x => !programa || x.programa === programa);
    return hoja(wb, 'NO ASIGNADOS 2026-II', 'Profesores de 2026-II sin propuesta de continuidad o progresión en 2027-I' + (programa ? ' – ' + programa : ''), subtitulo(ctx, na.length + ' casos'),
      [{ h: 'Programa', k: 'programa', w: 30 }, { h: 'Componente', k: 'componente', w: 18 }, { h: 'Profesor 2026-II', k: 'docente', w: 30 }, { h: 'Asignatura 2026-II', k: 'asig26', w: 34 },
        { h: 'Asignatura evaluada 2027-I', k: 'asig27', w: 34 }, { h: 'Causa', k: 'causa', w: 28 }, { h: 'Detalle verificable', k: 'detalle', w: 90 }], na);
  }
  function hojaAutorizaciones(wb, ctx, programa) {
    const au = ((ctx.fase7 && ctx.fase7.autorizaciones) || []).filter(x => !programa || x.programa === programa);
    return hoja(wb, 'AUTORIZACIONES PPI', 'Autorizaciones excepcionales de PPI (decisión del Director del Departamento)' + (programa ? ' – ' + programa : ''), subtitulo(ctx, au.length + ' registros'),
      [{ h: 'Fecha de la decisión', k: 'fecha', w: 14 }, { h: 'Profesor', k: 'docente', w: 30 }, { h: 'Título de pregrado', k: 'titulo', w: 36 }, { h: 'Programa de destino', k: 'programa', w: 34 }, { h: 'Nivel de PPI', k: 'nivel', w: 10 },
        { h: 'Justificación académica', k: 'justificacion', w: 60 }, { h: 'Director', k: 'director', w: 28 }, { h: 'Decisión', k: 'decision', w: 12 }, { h: 'Registrado por', k: 'registradoPor', w: 18 }], au);
  }
  function hojasFase7(wb, ctx, programa) {
    if (!ctx.fase7 || !ctx.fase7.activo) return;
    hojaComparativo(wb, ctx, programa);
    hojaNoAsignados(wb, ctx, programa);
    if (((ctx.fase7.autorizaciones) || []).filter(x => !programa || x.programa === programa).length) hojaAutorizaciones(wb, ctx, programa);
  }

  function hojaValidacion(wb, ctx, filas) {
    const v = filas.filter(f => f.estado === EST.VALID);
    return hoja(wb, 'Pendientes de validación', 'Asignaturas con docente pendiente de validación', subtitulo(ctx, v.length + ' asignaturas'), COLS_ASIG, v, { estadoCol: 9, xSplit: 4 });
  }

  function hojaCalidad(wb, ctx) {
    return hoja(wb, 'Control de calidad', 'Validación y control de calidad (fase 6)', subtitulo(ctx),
      [{ h: 'Verificación', k: 'nombre', w: 70 }, { h: 'Resultado', k: 'estado', w: 14 }, { h: 'Detalle', k: 'detalle', w: 100 }], ctx.qa,
      { onRow: (row, f) => { row.getCell(2).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: f.estado === 'Cumple' ? 'FFE2EFDA' : 'FFFFF2CC' } }; } });
  }

  function hojaRegistro(wb, ctx) {
    const log = (ctx.log || []).slice().reverse();
    return hoja(wb, 'Registro de cambios', 'Trazabilidad de modificaciones', subtitulo(ctx, log.length + ' eventos'),
      [{ h: 'Fecha', k: e => fmtFecha(e.fecha), w: 17 }, { h: 'Usuario', k: 'usuario', w: 18 }, { h: 'Acción', k: 'accion', w: 22 }, { h: 'Programa', k: 'programa', w: 26 },
        { h: 'Asignatura', k: 'asignatura', w: 30 }, { h: 'Valor anterior', k: 'antes', w: 28 }, { h: 'Valor nuevo', k: 'despues', w: 28 }, { h: 'Motivo / detalle', k: 'motivo', w: 60 }], log);
  }

  function nuevoLibro(ExcelJS, titulo) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'App Asignación Docente – Departamento de Pedagogía y Didáctica';
    wb.title = titulo;
    wb.created = new Date();
    return wb;
  }

  const ordenar = (a, b) => a.programa.localeCompare(b.programa, 'es') || Engine.COMP_ORDEN.indexOf(a.componente) - Engine.COMP_ORDEN.indexOf(b.componente) || (a.plan || '').localeCompare(b.plan || '', 'es') * -1;

  function libroPrograma(ExcelJS, ctx, programa) {
    const wb = nuevoLibro(ExcelJS, 'Asignación docente – ' + programa);
    const filas = ctx.filas.filter(f => f.programa === programa);
    hojaAsignacion(wb, ctx, 'Asignación', 'Propuesta de asignación docente – ' + programa, filas);
    hojaMatriz(wb, ctx, c => c.programa === programa);
    hojaInventario(wb, ctx, ctx.ds.cursos.filter(c => c.programa === programa));
    hojaPendientes(wb, ctx, filas);
    hojasFase7(wb, ctx, programa);
    return wb;
  }

  function libroConsolidado(ExcelJS, ctx) {
    const wb = nuevoLibro(ExcelJS, 'Asignación docente – Consolidado');
    hojaAsignacion(wb, ctx, 'Consolidado', 'Propuesta de asignación docente – Consolidado de programas', ctx.filas);
    hojaResumen(wb, ctx);
    hojaPendientes(wb, ctx, ctx.filas);
    hojaValidacion(wb, ctx, ctx.filas);
    const programas = [...new Set(ctx.filas.map(f => f.programa))].sort((a, b) => a.localeCompare(b, 'es'));
    const usados = new Set();
    programas.forEach(p => {
      let n = Engine.abreviarPrograma(p);
      while (usados.has(n)) n = n.slice(0, 28) + '_' + usados.size;
      usados.add(n);
      hojaAsignacion(wb, ctx, n, 'Propuesta de asignación docente – ' + p, ctx.filas.filter(f => f.programa === p));
    });
    hojaCarga(wb, ctx);
    hojasFase7(wb, ctx, null);
    hojaMatriz(wb, ctx);
    hojaInventario(wb, ctx, ctx.ds.cursos);
    hojaCalidad(wb, ctx);
    hojaRegistro(wb, ctx);
    return wb;
  }

  function libroPendientes(ExcelJS, ctx) {
    const wb = nuevoLibro(ExcelJS, 'Asignaturas sin docente asignado');
    hojaPendientes(wb, ctx, ctx.filas);
    hojaValidacion(wb, ctx, ctx.filas);
    return wb;
  }

  function libroInventario(ExcelJS, ctx) {
    const wb = nuevoLibro(ExcelJS, 'Inventario de asignaturas');
    hojaInventario(wb, ctx, ctx.ds.cursos);
    const programas = [...new Set(ctx.ds.cursos.map(c => c.programa))].sort((a, b) => a.localeCompare(b, 'es'));
    const filas = [];
    programas.forEach(p => ['Plan de transición', 'Plan anterior'].forEach(pl => {
      const cs = ctx.ds.cursos.filter(c => c.programa === p && c.plan === pl);
      if (!cs.length) return;
      const o = { programa: p, plan: pl, total: cs.length };
      Engine.COMP_ORDEN.forEach(k => o[k] = cs.filter(c => c.componente === k).length);
      o.sinPerfil = cs.filter(c => !c.perfilId).length;
      o.revision = cs.filter(c => c.revisionClasificacion).length;
      filas.push(o);
    }));
    hoja(wb, 'Resumen por programa', 'Asignaturas por programa, plan y componente', subtitulo(ctx),
      [{ h: 'Programa', k: 'programa', w: 40 }, { h: 'Plan', k: 'plan', w: 18 }, { h: 'Total', k: 'total', w: 9 }, { h: 'Pedagógico', k: Engine.COMP.PED, w: 12 },
        { h: 'Didáctica de las Disciplinas', k: Engine.COMP.DID, w: 14 }, { h: 'PPI', k: Engine.COMP.PPI, w: 9 }, { h: 'Sin perfil', k: 'sinPerfil', w: 10 }, { h: 'Clasificación por revisar', k: 'revision', w: 14 }], filas);
    const perf = ctx.ds.perfiles.map(p => ({
      programa: p.programa, componente: p.componenteDoc || '', titulo: p.titulo, archivo: p.archivo,
      usos: ctx.ds.cursos.filter(c => c.perfilId === p.id).length, alertas: p.alertas.join(' '),
    }));
    hoja(wb, 'Perfiles extraídos', 'Perfiles docentes extraídos de los documentos Word', subtitulo(ctx, perf.length + ' perfiles'),
      [{ h: 'Programa', k: 'programa', w: 36 }, { h: 'Componente (documento)', k: 'componente', w: 24 }, { h: 'Asignatura (título en el documento)', k: 'titulo', w: 50 },
        { h: 'Archivo', k: 'archivo', w: 40 }, { h: 'Asignaturas vinculadas', k: 'usos', w: 12 }, { h: 'Alertas', k: 'alertas', w: 60 }], perf,
      { onRow: (row, f) => { if (!f.usos) row.getCell(5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } }; } });
    return wb;
  }

  function libroComparativo(ExcelJS, ctx, programa) {
    const wb = nuevoLibro(ExcelJS, 'Comparativo 2026-II vs 2027-I' + (programa ? ' – ' + programa : ''));
    hojaComparativo(wb, ctx, programa);
    hojaNoAsignados(wb, ctx, programa);
    if (((ctx.fase7 && ctx.fase7.autorizaciones) || []).filter(x => !programa || x.programa === programa).length) hojaAutorizaciones(wb, ctx, programa);
    return wb;
  }
  function libroAutorizaciones(ExcelJS, ctx) {
    const wb = nuevoLibro(ExcelJS, 'Autorizaciones PPI');
    hojaAutorizaciones(wb, ctx, null);
    return wb;
  }

  function libroMatriz(ExcelJS, ctx) {
    const wb = nuevoLibro(ExcelJS, 'Matriz de correspondencia');
    hojaMatriz(wb, ctx);
    return wb;
  }

  function contexto(ds, an, extra) {
    extra = extra || {};
    return {
      ds, an, filas: Engine.filasReporte(ds, an).sort(ordenar), stats: Engine.estadisticas(ds, an),
      qa: Engine.controlCalidad(ds, an, extra.meta || {}), log: extra.log || [], fecha: extra.fecha || Date.now(), fase7: extra.fase7 || null,
    };
  }

  function nombreArchivo(s) {
    return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[()]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^Licenciatura_en_/i, 'Lic_').replace(/_+$/, '');
  }

  return { contexto, libroPrograma, libroConsolidado, libroPendientes, libroInventario, libroMatriz, libroComparativo, libroAutorizaciones, nombreArchivo, fmtFecha, COLS_ASIG };
});
