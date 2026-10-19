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

  /* ---------------- Comparativo ---------------- */
  // Primera observación relevante de Fase 7 (continuidad, progresión, bloqueo, carga o director); si no hay, la primera línea
  function obsClave(f) {
    const l = f.observaciones.split('\n');
    const k = l.find(x => /^(Se propone|No se propone|No se asigna|Pendiente de validación|Excepción autorizada)/.test(x)) || l[0] || '';
    return k.length > 170 ? k.slice(0, 167) + '…' : k;
  }
  function tipoChip(t) { const x = TIPOS[t]; return x ? '<span class="col-tipo-cont ' + x[1] + '">● ' + x[0] + '</span>' : '<span class="muted">—</span>'; }
  function renderComparativo() {
    if (!B || !B.S.an) return;
    const S = B.S, esc = B.esc;
    q('#comp-sin-historico').style.display = F7.activo ? 'none' : '';
    q('#comp-contenido').style.display = F7.activo ? '' : 'none';
    if (!F7.activo) return;
    const filas = S.filas.filter(f => f.f7);
    const cuenta = t => filas.filter(f => f.f7.tipo === t).length;
    q('#ind-cont').textContent = cuenta('continuidad');
    q('#ind-prog').textContent = cuenta('progresión');
    q('#ind-noasig').textContent = F7.noAsignados.length;
    const fp = q('#comp-prog').value, fc = q('#comp-comp').value, ft = q('#comp-tipo').value;
    const vis = filas.filter(f => (!fp || f.programa === fp) && (!fc || f.componente === fc) && (!ft || f.f7.tipo === ft));
    const max = S.config.maxHoras;
    q('#comp-tbody').innerHTML = vis.length ? vis.map(f => {
      const x = f.f7, prev = x.origen ? x.origen.nombre : (x.prev26 || []).join('; ');
      const asig26 = x.origen ? x.origen.asignatura : (x.prev26 && x.prev26.length ? f.asignatura : '—');
      const cls = x.tipo === 'continuidad' ? 'comp-row-cont' : x.tipo === 'progresión' ? 'comp-row-prog' : x.tipo === 'nueva' ? 'comp-row-new' : '';
      const carga = x.cargaTotal == null ? '—' : (x.cargaTotal > max ? '<b style="color:var(--danger)">' + x.cargaTotal + ' h ⚠</b>' : x.cargaTotal + ' h');
      return '<tr class="click ' + cls + '" data-id="' + f.id + '"><td class="small">' + esc(B.corto(f.programa)) + '</td><td>' + B.compTag(f.componente) + '</td><td class="small">' + esc(asig26) + '</td><td class="small">' + esc(prev || '—') + '</td>' +
        '<td><b>' + esc(f.asignatura) + '</b></td><td class="small">' + (f.docente === 'Por designar' ? '<span class="muted">Por designar</span>' : esc(f.docente)) + '</td><td>' + tipoChip(x.tipo) + '</td><td class="small" title="' + esc(f.correspondencia) + '">' + esc(f.correspondencia.split('. ')[0]) + '</td><td class="num nowrap">' + carga + '</td><td>' + B.chip(f.estado) + '</td><td class="small muted" style="min-width:260px" title="' + esc(f.observaciones) + '">' + esc(obsClave(f)) + '</td></tr>';
    }).join('') : '<tr><td colspan="11" class="empty">Sin resultados con los filtros aplicados.</td></tr>';
    B.$$('#comp-tbody tr[data-id]').forEach(tr => tr.onclick = () => B.abrirDetalle(tr.dataset.id));

    // No asignados
    q('#na-count').textContent = F7.noAsignados.length + ' casos';
    q('#na-tbody').innerHTML = F7.noAsignados.length ? F7.noAsignados.map(n => '<tr><td class="small">' + esc(B.corto(n.programa)) + '</td><td class="small"><b>' + esc(n.docente) + '</b></td><td class="small">' + esc(n.asig26) + '</td><td class="small">' + esc(n.asig27 || '—') + '</td><td class="small"><b>' + esc(n.causa) + '</b></td><td class="small muted">' + esc(n.detalle) + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">Todos los profesores de 2026-II tienen continuidad o progresión.</td></tr>';
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
    const aut = (S.excepciones7 || []).filter(e => e.decision === 'autorizada').length;
    row.innerHTML = pill('var(--ok)', n('continuidad'), 'continuidades 2026-II') + pill('var(--primary-mid)', n('progresión'), 'progresiones PPI') + pill('var(--accent)', n('nueva'), 'asignaciones nuevas') +
      pill('var(--danger)', n('pendiente'), 'sin docente propuesto') + pill('var(--gray-mid)', F7.noAsignados.length, 'no asignados 2026-II') + pill('var(--warn)', aut, 'excepciones PPI autorizadas') +
      pill('var(--danger-mid)', docentesSobrecarga().length, 'alertas de carga (> ' + S.config.maxHoras + ' h)');
  }
  function renderAlertas() {
    if (!B || !B.S.an) return;
    const S = B.S, esc = B.esc, cont = q('#qa-fase7'), al = [];
    if (!F7.activo) { cont.innerHTML = '<p class="muted small">Cargue el archivo «Asignación Docente 2026-2» para activar los controles de la Fase 7.</p>'; return; }
    if (!(S.fuentes.cargaInst7)) al.push(['warn', '<b>Carga institucional 2027-I no cargada.</b> El tope de ' + S.config.maxHoras + ' horas corresponde a la carga total del profesor en toda la Universidad; mientras no se cargue la carga comprometida en otras unidades, cada propuesta queda con la observación «Pendiente de validación».']);
    docentesSobrecarga().forEach(d => al.push(['err', '<b>' + esc(S.ds.profesores.find(p => p.id === d.id).nombre) + '</b> supera el máximo de ' + S.config.maxHoras + ' h de carga total (' + d.tot + ' h proyectadas).']));
    const dir = S.filas.filter(f => f.estado === E.EST.DIR).length, doc = S.filas.filter(f => f.estado === E.EST.VALDOC).length;
    if (dir) al.push(['warn', '<b>' + dir + '</b> asignaturas de PPI esperan la decisión del Director (pregrado de otra disciplina). Regístrela en «Excepciones PPI».']);
    if (doc) al.push(['warn', '<b>' + doc + '</b> asignaturas de PPI con pregrado no verificable (pendiente de validación documental).']);
    al.push(['ok', 'Fuente histórica: ' + esc(S.fuentes.historico7.archivo) + ' · ' + S.fuentes.historico7.rows.length + ' registros de 2026-II.']);
    cont.innerHTML = al.map(a => '<div class="diag-item ' + a[0] + '">' + a[1] + '</div>').join('');
  }

  /* ---------------- Excepciones PPI ---------------- */
  function renderExcepciones() {
    if (!B) return;
    const S = B.S, esc = B.esc, ex = S.excepciones7 || [], admin = B.can('config');
    q('#exc-form-card').style.display = admin ? '' : 'none';
    q('#exc-ro-notice').classList.toggle('hidden', admin);
    q('#exc-count').textContent = ex.length + ' registro(s)';
    q('#exc-tbody').innerHTML = ex.length ? ex.slice().reverse().map(e => '<tr><td class="nowrap small">' + esc(e.fecha) + '</td><td><b>' + esc(e.docente) + '</b></td><td class="small">' + esc(e.titulo) + '</td><td class="small">' + esc(B.corto(e.programa)) + '</td><td><span class="tag comp-ppi">' + esc(e.nivel) + '</span></td><td class="small">' + esc(e.justificacion) + '</td><td class="small">' + esc(e.director) + '</td><td>' + (e.decision === 'autorizada' ? '<span class="chip st-aprob">Autorizada</span>' : '<span class="chip st-pend">Negada</span>') + '</td><td class="small muted">' + esc(e.registradoPor) + '</td></tr>').join('') : '<tr><td colspan="9" class="empty">No hay autorizaciones registradas.</td></tr>';
    const dl = q('#exc-docentes');
    if (dl && !dl.children.length && S.ds) dl.innerHTML = S.ds.profesores.filter(p => p.titulos.some(t => t.nivel === 'Profesional')).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map(p => '<option value="' + esc(p.nombre) + '"></option>').join('');
    const sp = q('#exc-programa');
    if (sp && S.ds) { const progs = [...new Set(S.ds.cursos.map(c => c.programa))].sort((a, b) => a.localeCompare(b, 'es')); const v = sp.value; sp.innerHTML = '<option value="">Seleccione…</option>' + progs.map(p => '<option>' + esc(p) + '</option>').join(''); sp.value = v; }
    const cp = q('#comp-prog');
    if (cp && S.ds) { const v = cp.value; cp.innerHTML = '<option value="">Todos</option>' + [...new Set(S.ds.cursos.map(c => c.programa))].sort((a, b) => a.localeCompare(b, 'es')).map(p => '<option>' + esc(p) + '</option>').join(''); cp.value = v; }
  }
  function profPorNombre(nombre) {
    const l = B.S.ds.profesores.filter(p => p.nombre === nombre.trim());
    return l.length === 1 ? l[0] : null;
  }
  function autocompletarPregrado() {
    const p = profPorNombre(q('#exc-docente').value);
    const t = p ? p.titulos.filter(x => x.nivel === 'Profesional').map(x => x.titulo).join('; ') : '';
    q('#exc-titulo').value = t;
  }
  async function registrarExcepcion() {
    if (!B.can('config')) return B.toast('Solo el Administrador puede registrar autorizaciones excepcionales.', true);
    const v = id => (q('#' + id).value || '').trim();
    const p = profPorNombre(v('exc-docente'));
    if (!p) return B.toast('Seleccione el docente de la lista de profesores de la base (escriba el nombre y elija una opción).', true);
    const campos = { programa: v('exc-programa'), nivel: v('exc-nivel'), justificacion: v('exc-justificacion'), director: v('exc-director'), fecha: v('exc-fecha'), decision: v('exc-decision') };
    if (Object.values(campos).some(x => !x)) return B.toast('Complete todos los campos: programa, nivel de PPI, justificación, Director, fecha y decisión.', true);
    if (campos.justificacion.length < 20) return B.toast('La justificación académica debe ser específica (mínimo 20 caracteres).', true);
    const exc = Object.assign({ docenteId: p.id, docente: p.nombre, titulo: v('exc-titulo') || 'No registra título profesional', nivelNum: ['I', 'II', 'III', 'IV', 'V', 'VI'].indexOf(campos.nivel.replace('PPI ', '')) + 1, registradoPor: B.S.user.usuario, registradoEn: new Date().toISOString() }, campos);
    if (!(await confirmarDecision(exc))) return;
    (B.S.excepciones7 = B.S.excepciones7 || []).push(exc);
    await B.Store.set('excepciones7', B.S.excepciones7);
    await B.registrar({ accion: 'Autorización excepcional PPI (' + exc.decision + ')', programa: exc.programa, asignatura: exc.nivel, despues: exc.docente, motivo: exc.justificacion + ' — Director: ' + exc.director + ' · fecha de la decisión ' + exc.fecha });
    ['exc-docente', 'exc-titulo', 'exc-programa', 'exc-nivel', 'exc-justificacion', 'exc-director', 'exc-fecha', 'exc-decision'].forEach(id => { q('#' + id).value = ''; });
    B.loading(true, 'Aplicando la decisión y recalculando…');
    await new Promise(r => setTimeout(r, 30));
    B.recalcular();
    B.loading(false);
    B.toast('Autorización registrada y propuestas recalculadas.');
  }
  function confirmarDecision(e) {
    return new Promise(res => {
      const bg = document.createElement('div'); bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal"><div class="modal-h">Confirmar decisión del Director</div><div class="modal-b"><div>Se registrará de forma permanente en el historial:</div><div class="small"><b>' + B.esc(e.docente) + '</b> · ' + B.esc(e.nivel) + ' · ' + B.esc(B.corto(e.programa)) + '<br>Decisión: <b>' + (e.decision === 'autorizada' ? 'AUTORIZADA' : 'NEGADA') + '</b> por ' + B.esc(e.director) + ' (' + B.esc(e.fecha) + ')</div><div class="small muted">Solo se registra lo que el Director del Departamento haya decidido de manera expresa; el sistema no presume autorizaciones.</div></div><div class="modal-f"><button class="btn" data-x>Cancelar</button><button class="btn primary" data-ok>Confirmar y registrar</button></div></div>';
      document.body.appendChild(bg);
      bg.querySelector('[data-x]').onclick = () => { bg.remove(); res(false); };
      bg.querySelector('[data-ok]').onclick = () => { bg.remove(); res(true); };
    });
  }

  /* ---------------- Sincronización ---------------- */
  function sincronizar() {
    if (!B || !B.S.ds || !B.S.an) return;
    const S = B.S;
    F7.activo = !!(S.fuentes && S.fuentes.historico7 && S.fuentes.historico7.rows && S.fuentes.historico7.rows.length);
    F7.noAsignados = F7.activo ? calcularNoAsignados() : [];
    renderExcepciones(); renderComparativo(); renderIndicadores(); renderAlertas();
  }

  function conectar(bridge) {
    B = bridge;
    ['#comp-prog', '#comp-comp', '#comp-tipo'].forEach(id => q(id).addEventListener('change', renderComparativo));
    q('#btn-dl-comp').onclick = () => B.descargar('comparativo');
    q('#btn-dl-exc').onclick = () => B.descargar('autorizaciones');
    q('#btn-exc-registrar').onclick = registrarExcepcion;
    q('#btn-exc-limpiar').onclick = () => ['exc-docente', 'exc-titulo', 'exc-programa', 'exc-nivel', 'exc-justificacion', 'exc-director', 'exc-fecha', 'exc-decision'].forEach(id => { q('#' + id).value = ''; });
    q('#exc-docente').addEventListener('change', autocompletarPregrado);
    q('#exc-docente').addEventListener('input', autocompletarPregrado);
  }

  window.Fase7 = { conectar, sincronizar, contextoReporte, isActivo: () => F7.activo };
  if (window.AppBridge) { conectar(window.AppBridge); if (window.AppBridge.S.an) sincronizar(); }
})();
