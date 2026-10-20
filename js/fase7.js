/*
 * Fase 7 – Continuidad 2026-II → 2027-I, progresión cíclica de PPI, carga institucional total
 * y módulo de autorizaciones excepcionales de PPI.
 *
 * Las reglas de asignación viven en engine.js (analizar). Este módulo presenta los resultados
 * (comparativo, no asignados, indicadores, alertas) y gestiona las autorizaciones del Director.
 */
(function () {
  'use strict';
  const E = window.Engine;
  let B = null; // puente con app.js
  const F7 = { activo: false, noAsignados: [] };

  const TIPOS = { 'continuidad': ['Continuidad', 'tipo-continuidad'], 'progresión': ['Progresión PPI', 'tipo-progresion'], 'nueva': ['Nueva', 'tipo-nueva'], 'pendiente': ['Pendiente', 'tipo-pendiente'] };
  const q = s => B.$(s);

  /* ---------------- No asignados 2026-II ---------------- */
  function causaDe(m) {
    if (/^incumplimiento/.test(m)) return 'Incumplimiento de perfil';
    if (/Pendiente de validación/.test(m)) return 'Información insuficiente';
    if (/superaría/.test(m)) return 'Exceso de carga';
    if (/pregrado/.test(m)) return 'Pregrado de otra disciplina (decisión del Director)';
    return 'Otras causas verificables';
  }
  function calcularNoAsignados() {
    const S = B.S, h = S.fuentes && S.fuentes.historico7;
    if (!h || !h.rows || !h.rows.length) return [];
    const hist = E.prepararHistorico(h.rows), res = S.an.resultados, out = [], vistos = new Set();
    const profIds = new Set(S.ds.profesores.map(p => p.id));
    hist.forEach(r => {
      const cs = S.ds.cursos.filter(c => E.progN(c.programa) === r.progN);
      if (!cs.length) return;
      const esPPI = r.nivel != null, sig = r.nivel === 6 ? 1 : (r.nivel || 0) + 1;
      const destinos = esPPI ? cs.filter(c => c.componente === E.COMP.PPI && [sig, r.nivel].includes(E.nivelPPI(c.asignatura)))
        : cs.filter(c => E.norm(c.asignatura) === r.asigN || (() => { const a = E.tokens(c.asignatura); return a.length && r.tok.length && a.filter(t => r.tok.includes(t)).length / Math.max(a.length, r.tok.length) >= 0.8; })());
      if (!esPPI && !destinos.length) return; // no pertenece a los tres componentes
      const clave = r.id + '|' + r.progN + '|' + r.asigN;
      if (vistos.has(clave)) return; vistos.add(clave);
      if (destinos.some(c => res.get(c.id).docenteId === r.id)) return; // tiene continuidad o progresión
      const prog = (destinos[0] || cs[0]).programa;
      let causa, detalle;
      const bloq = destinos.map(c => (res.get(c.id).f7 || { bloqueos: [] }).bloqueos.find(b => E.norm(b.nombre) === E.norm(r.nombre))).find(Boolean);
      if (!destinos.length) { causa = 'Ausencia de oferta 2027-I'; detalle = 'No figura en el inventario 2027-I el nivel o asignatura que correspondería (' + r.asignatura + ').'; }
      else if (!destinos.some(c => res.get(c.id).enAlcance)) { causa = 'Ausencia de oferta 2027-I'; detalle = 'La asignatura de destino pertenece a un plan que no está incluido en la asignación automática; no se califica como incumplimiento del profesor.'; }
      else if (!profIds.has(r.id)) { causa = 'Información insuficiente'; detalle = 'El profesor no figura en la base de formación y experiencia cargada (identificación ' + r.id + '); no es posible verificar el perfil.'; }
      else if (bloq) { causa = causaDe(bloq.motivo); detalle = bloq.motivo; }
      else {
        const otros = destinos.map(c => res.get(c.id)).filter(x => x.docenteId).map(x => B.S.ds.profesores.find(p => p.id === x.docenteId).nombre);
        causa = 'Otras causas verificables';
        detalle = otros.length ? 'La asignatura de destino se propone a otro profesor: ' + [...new Set(otros)].join('; ') + '.' : 'La asignatura de destino no tiene docente propuesto (estado: ' + destinos.map(c => res.get(c.id).estado).join(' / ') + ').';
      }
      out.push({ programa: prog, componente: esPPI ? E.COMP.PPI : (destinos[0] ? destinos[0].componente : ''), docente: r.nombre, id: r.id, asig26: r.asignatura, asig27: [...new Set(destinos.map(c => c.asignatura))].join(' / '), causa, detalle });
    });
    return out.sort((a, b) => a.programa.localeCompare(b.programa, 'es') || a.docente.localeCompare(b.docente, 'es'));
  }

  /* ---------------- Contexto para reportes ---------------- */
  function contextoReporte() {
    return { activo: F7.activo, noAsignados: F7.noAsignados, autorizaciones: (B && B.S.excepciones7) || [] };
  }

  /* ---------------- Indicadores y alertas ---------------- */
  function docentesSobrecarga() {
    const S = B.S, out = [];
    S.an.asignados.forEach((ids, did) => {
      const f = S.an.resultados.get(ids[0]).f7;
      const tot = f && f.cargaTotal != null ? f.cargaTotal : (S.an.carga.get(did) || 0);
      if (tot > S.config.maxHoras) out.push({ id: did, tot });
    });
    return out;
  }
  function renderIndicadores() {
    if (!B || !B.S.an) return;
    const S = B.S, row = q('#ind-fase7'), note = q('#res-fase7-note');
    row.style.display = F7.activo ? 'flex' : 'none';
    note.style.display = F7.activo ? 'inline' : 'none';
    if (!F7.activo) return;
    const filas = S.filas.filter(f => f.f7);
    const n = t => filas.filter(f => f.f7.tipo === t).length;
    const pill = (c, v, l) => '<div class="ind-pill"><span class="dot" style="background:' + c + '"></span><b>' + v + '</b> ' + B.esc(l) + '</div>';
    const dirN = filas.filter(f => f.estado === E.EST.DIR).length;
    row.innerHTML = pill('var(--ok)', n('continuidad'), 'continuidades 2026-II') + pill('var(--primary-mid)', n('progresión'), 'progresiones PPI') + pill('var(--accent)', n('nueva'), 'asignaciones nuevas') +
      pill('var(--danger)', n('pendiente'), 'sin docente propuesto') + pill('var(--gray-mid)', F7.noAsignados.length, 'no asignados 2026-II') + pill('var(--warn)', dirN, 'por revisar por el Director') +
      pill('var(--danger-mid)', docentesSobrecarga().length, 'alertas de carga (> ' + S.config.maxHoras + ' h)');
  }
  function renderAlertas() {
    if (!B || !B.S.an) return;
    const S = B.S, esc = B.esc, cont = q('#qa-fase7'), al = [];
    if (!F7.activo) { cont.innerHTML = '<p class="muted small">Cargue el archivo «Asignación Docente 2026-2» para activar los controles de la Fase 7.</p>'; return; }
    if (!(S.fuentes.cargaInst7)) al.push(['warn', '<b>Carga institucional 2027-I no cargada.</b> El tope de ' + S.config.maxHoras + ' horas corresponde a la carga total del profesor en toda la Universidad; mientras no se cargue la carga comprometida en otras unidades, cada propuesta queda con la observación «Pendiente de validación».']);
    docentesSobrecarga().forEach(d => al.push(['err', '<b>' + esc(S.ds.profesores.find(p => p.id === d.id).nombre) + '</b> supera el máximo de ' + S.config.maxHoras + ' h de carga total (' + d.tot + ' h proyectadas).']));
    const dir = S.filas.filter(f => f.estado === E.EST.DIR).length, doc = S.filas.filter(f => f.estado === E.EST.VALDOC).length;
    if (dir) al.push(['warn', '<b>' + dir + '</b> asignaturas sin docente con pregrado afín: hay candidatos con posgrado afín que debe revisar manualmente el Director.']);
    if (doc) al.push(['warn', '<b>' + doc + '</b> asignaturas con pregrado no verificable (pendiente de validación documental).']);
    al.push(['ok', 'Fuente histórica: ' + esc(S.fuentes.historico7.archivo) + ' · ' + S.fuentes.historico7.rows.length + ' registros de 2026-II.']);
    cont.innerHTML = al.map(a => '<div class="diag-item ' + a[0] + '">' + a[1] + '</div>').join('');
  }

  /* ---------------- Sincronización ---------------- */
  function sincronizar() {
    if (!B || !B.S.ds || !B.S.an) return;
    const S = B.S;
    F7.activo = !!(S.fuentes && S.fuentes.historico7 && S.fuentes.historico7.rows && S.fuentes.historico7.rows.length);
    F7.noAsignados = F7.activo ? calcularNoAsignados() : [];
    renderIndicadores(); renderAlertas();
  }

  function conectar(bridge) { B = bridge; }

  window.Fase7 = { conectar, sincronizar, contextoReporte, isActivo: () => F7.activo };
  if (window.AppBridge) { conectar(window.AppBridge); if (window.AppBridge.S.an) sincronizar(); }
})();
