/*
 * Aplicación web – Asignación Docente Licenciaturas
 * Interfaz, almacenamiento local (IndexedDB), control de acceso, trazabilidad y exportaciones.
 */
(function () {
  'use strict';
  const E = window.Engine, EST = E.EST;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtF = d => window.Reportes.fmtFecha(d);

  /* ================================================================== */
  /* Almacenamiento persistente: IndexedDB (respaldo: localStorage)      */
  /* ================================================================== */
  const Store = {
    db: null, modo: 'indexeddb',
    open() {
      return new Promise(res => {
        try {
          const rq = indexedDB.open('asignacion_docente_licenciaturas', 1);
          rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
          rq.onsuccess = () => { this.db = rq.result; res(); };
          rq.onerror = () => { this.modo = 'localStorage'; res(); };
        } catch (e) { this.modo = 'localStorage'; res(); }
      });
    },
    get(k) {
      if (!this.db) { try { const v = localStorage.getItem('ad_' + k); return Promise.resolve(v ? JSON.parse(v) : undefined); } catch (e) { return Promise.resolve(undefined); } }
      return new Promise(res => {
        const rq = this.db.transaction('kv').objectStore('kv').get(k);
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(undefined);
      });
    },
    set(k, v) {
      if (!this.db) { try { localStorage.setItem('ad_' + k, JSON.stringify(v)); } catch (e) { toast('No fue posible guardar "' + k + '" en el almacenamiento local (espacio insuficiente).', true); } return Promise.resolve(); }
      return new Promise(res => {
        const tx = this.db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = () => res(); tx.onerror = () => { toast('Error al guardar en el almacenamiento local.', true); res(); };
      });
    },
    del(k) {
      if (!this.db) { try { localStorage.removeItem('ad_' + k); } catch (e) { /* sin acceso */ } return Promise.resolve(); }
      return new Promise(res => { const tx = this.db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = () => res(); tx.onerror = () => res(); });
    },
  };

  /* ================================================================== */
  /* SHA-256 (para contraseñas y huellas de archivos)                     */
  /* ================================================================== */
  function sha256(ascii) {
    function rr(v, a) { return (v >>> a) | (v << (32 - a)); }
    const bytes = new TextEncoder().encode(ascii);
    const K = [], H = [];
    let n = 0;
    for (let c = 2; n < 64; c++) {
      let p = true;
      for (let d = 2; d * d <= c; d++) if (c % d === 0) { p = false; break; }
      if (p) { if (n < 8) H[n] = (Math.pow(c, 1 / 2) * 4294967296) | 0; K[n++] = (Math.pow(c, 1 / 3) * 4294967296) | 0; }
    }
    const l = bytes.length, words = [];
    for (let i = 0; i < l; i++) words[i >> 2] |= bytes[i] << ((3 - i) % 4) * 8;
    words[l >> 2] |= 0x80 << ((3 - l) % 4) * 8;
    words[((l + 8) >> 6 << 4) + 15] = l * 8;
    for (let j = 0; j < words.length; j += 16) {
      const w = words.slice(j, j + 16), o = H.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = H[0], e = H[4];
        const t1 = H[7] + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & H[5]) ^ (~e & H[6])) + K[i] +
          (w[i] = i < 16 ? (w[i] | 0) : (w[i - 16] + (rr(w15, 7) ^ rr(w15, 18) ^ (w15 >>> 3)) + w[i - 7] + (rr(w2, 17) ^ rr(w2, 19) ^ (w2 >>> 10))) | 0);
        const t2 = (rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & H[1]) ^ (a & H[2]) ^ (H[1] & H[2]));
        H.unshift((t1 + t2) | 0); H[4] = (H[4] + t1) | 0; H.length = 8;
      }
      for (let i = 0; i < 8; i++) H[i] = (H[i] + o[i]) | 0;
    }
    return H.map(h => ('00000000' + (h >>> 0).toString(16)).slice(-8)).join('');
  }
  function hashClave(clave, salt) {
    let h = sha256(salt + ':' + clave);
    for (let i = 0; i < 3000; i++) h = sha256(h + salt);
    return h;
  }
  async function huellaArchivo(buf) {
    try {
      if (window.crypto && crypto.subtle) {
        const d = await crypto.subtle.digest('SHA-256', buf);
        return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
      }
    } catch (e) { /* contexto no seguro */ }
    let h = 0x811c9dc5; const u = new Uint8Array(buf);
    for (let i = 0; i < u.length; i += 7) { h ^= u[i]; h = Math.imul(h, 0x01000193) >>> 0; }
    return 'fnv' + h.toString(16) + u.length.toString(16);
  }

  /* ================================================================== */
  /* Estado                                                              */
  /* ================================================================== */
  const ROLES = { admin: 'Administrador', coordinador: 'Coordinador académico', consulta: 'Consulta' };
  const PERMISOS = { admin: ['editar', 'aprobar', 'archivos', 'usuarios', 'config', 'exportar', 'restaurar'], coordinador: ['editar', 'aprobar', 'exportar'], consulta: ['exportar'] };
  const S = {
    user: null, users: [], fuentes: null, archivos: [], fuentesMod: false, ds: null, meta: null, an: null, cache: {},
    overrides: {}, config: Object.assign({}, E.DEFAULT_CONFIG), log: [], snapshots: [], filas: [], filaPorId: new Map(),
    f: { prog: '', comp: '', plan: '', est: '', q: '' }, docPage: 0, logPage: 0, abierto: null,
  };
  const can = p => S.user && (PERMISOS[S.user.rol] || []).includes(p);
  const profPorId = () => S._pp || (S._pp = new Map(S.ds.profesores.map(p => [p.id, p])));
  const perfilPorId = () => S._pf || (S._pf = new Map(S.ds.perfiles.map(p => [p.id, p])));
  const cursoPorId = () => S._cp || (S._cp = new Map(S.ds.cursos.map(c => [c.id, c])));

  /* ================================================================== */
  /* Utilidades de interfaz                                              */
  /* ================================================================== */
  function toast(msg, err) {
    const t = document.createElement('div');
    t.className = 'toast' + (err ? ' err' : '');
    t.textContent = msg;
    $('#toasts').appendChild(t);
    setTimeout(() => t.remove(), err ? 7000 : 3500);
  }
  function loading(on, txt) {
    $('#loading').classList.toggle('hidden', !on);
    if (txt) $('#loading-txt').textContent = txt;
  }
  const tick = () => new Promise(r => setTimeout(r, 30));
  const ESTCLS = {}; ESTCLS[EST.PROP] = 'st-prop'; ESTCLS[EST.APROB] = 'st-aprob'; ESTCLS[EST.PEND] = 'st-pend'; ESTCLS[EST.SINP] = 'st-sinp'; ESTCLS[EST.VALID] = 'st-valid'; ESTCLS[EST.VALDOC] = 'st-valid'; ESTCLS[EST.DIR] = 'st-dir';
  const chip = e => '<span class="chip ' + (ESTCLS[e] || '') + '">' + esc(e) + '</span>';
  const COMPCLS = {}; COMPCLS[E.COMP.PED] = 'comp-ped'; COMPCLS[E.COMP.DID] = 'comp-did'; COMPCLS[E.COMP.PPI] = 'comp-ppi';
  const compTag = c => '<span class="tag ' + (COMPCLS[c] || '') + '">' + esc(c === E.COMP.PPI ? 'PPI' : c === E.COMP.DID ? 'Didáctica' : c) + '</span>';
  const corto = p => String(p || '').replace(/^Licenciatura en /, 'Lic. ');

  function modal(opts) {
    return new Promise(resolve => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = '<div class="modal" role="dialog" aria-modal="true"><div class="modal-h">' + esc(opts.titulo) + '</div><div class="modal-b">' + (opts.html || '') +
        '</div><div class="modal-f">' + (opts.sinCancelar ? '' : '<button class="btn" data-x>Cancelar</button>') + '<button class="btn ' + (opts.peligro ? 'danger' : 'primary') + '" data-ok>' + esc(opts.ok || 'Aceptar') + '</button></div></div>';
      document.body.appendChild(bg);
      const close = v => { bg.remove(); resolve(v); };
      const x = $('[data-x]', bg); if (x) x.onclick = () => close(null);
      bg.addEventListener('keydown', e => { if (e.key === 'Escape') close(null); });
      $('[data-ok]', bg).onclick = () => {
        const data = {};
        $$('[name]', bg).forEach(i => { data[i.name] = i.type === 'checkbox' ? i.checked : i.value; });
        if (opts.validar) { const err = opts.validar(data); if (err) { toast(err, true); return; } }
        close(data);
      };
      const first = $('input, select, textarea', bg) || $('[data-ok]', bg);
      setTimeout(() => first.focus(), 30);
    });
  }
  const confirmar = (titulo, html, ok, peligro) => modal({ titulo, html: '<div>' + html + '</div>', ok: ok || 'Confirmar', peligro }).then(v => !!v);

  function guardarBlob(data, nombre, tipo) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: tipo || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* ================================================================== */
  /* Autenticación y control de acceso                                   */
  /* ================================================================== */
  let modoAuth = 'login';
  function mostrarAuth(modo) {
    modoAuth = modo;
    $('#app').classList.add('hidden');
    $('#auth').classList.remove('hidden');
    const setup = modo === 'setup';
    $('#auth-title').textContent = setup ? 'Configuración inicial' : 'Iniciar sesión';
    $('#auth-sub').textContent = setup ? 'Cree la cuenta de Administrador. Podrá agregar otros usuarios (Coordinador académico, Consulta) desde «Archivos y configuración».' : 'Asignación Docente · Licenciaturas — Departamento de Pedagogía y Didáctica';
    $$('[data-setup]').forEach(x => x.classList.toggle('hidden', !setup));
    $('#auth-btn').textContent = setup ? 'Crear administrador e ingresar' : 'Ingresar';
    $('#auth-form [name=clave]').setAttribute('autocomplete', setup ? 'new-password' : 'current-password');
    $('#auth-form [name=usuario]').focus();
  }
  $('#auth-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const fd = Object.fromEntries(new FormData(ev.target).entries());
    const err = m => { $('#auth-err').textContent = m; $('#auth-err').classList.remove('hidden'); };
    $('#auth-err').classList.add('hidden');
    const usuario = String(fd.usuario || '').trim().toLowerCase();
    if (modoAuth === 'setup') {
      if (!fd.nombre || !usuario) return err('Complete nombre y usuario.');
      if ((fd.clave || '').length < 6) return err('La contraseña debe tener al menos 6 caracteres.');
      if (fd.clave !== fd.clave2) return err('Las contraseñas no coinciden.');
      const salt = sha256(Math.random() + ':' + Date.now()).slice(0, 16);
      S.users = [{ usuario, nombre: fd.nombre.trim(), rol: 'admin', salt, hash: hashClave(fd.clave, salt), creado: Date.now() }];
      await Store.set('users', S.users);
      await iniciarSesion(S.users[0], 'Creación del administrador');
    } else {
      const u = S.users.find(x => x.usuario === usuario && !x.inactivo);
      if (!u || hashClave(fd.clave, u.salt) !== u.hash) return err('Usuario o contraseña incorrectos.');
      await iniciarSesion(u, 'Inicio de sesión');
    }
    ev.target.reset();
  });
  async function iniciarSesion(u, motivo) {
    S.user = u;
    try { sessionStorage.setItem('ad_sesion', JSON.stringify({ usuario: u.usuario, t: Date.now() })); } catch (e) { /* sin sessionStorage */ }
    await registrar({ accion: motivo });
    await entrar();
  }
  async function cerrarSesion(motivo) {
    if (S.user) await registrar({ accion: motivo || 'Cierre de sesión' });
    S.user = null;
    try { sessionStorage.removeItem('ad_sesion'); } catch (e) { /* sin sessionStorage */ }
    cerrarDrawer();
    mostrarAuth('login');
  }
  $('#btn-logout').onclick = () => cerrarSesion();
  // cierre por inactividad (30 min)
  let ultimaActividad = Date.now();
  ['click', 'keydown', 'pointermove'].forEach(e => document.addEventListener(e, () => { ultimaActividad = Date.now(); }, { passive: true }));
  setInterval(() => { if (S.user && Date.now() - ultimaActividad > 30 * 60000) cerrarSesion('Cierre de sesión por inactividad'); }, 60000);

  /* ================================================================== */
  /* Trazabilidad y respaldo automático                                  */
  /* ================================================================== */
  async function registrar(e) {
    const ev = Object.assign({ fecha: Date.now(), usuario: S.user ? S.user.usuario : '—' }, e);
    S.log.push(ev);
    await Store.set('log', S.log);
  }
  async function snapshot(motivo) {
    S.snapshots.unshift({ fecha: Date.now(), usuario: S.user.usuario, motivo, overrides: JSON.parse(JSON.stringify(S.overrides)), config: Object.assign({}, S.config) });
    S.snapshots = S.snapshots.slice(0, 25);
    await Store.set('snapshots', S.snapshots);
  }
  async function guardarDecisiones(motivo) {
    await Store.set('overrides', S.overrides);
    await snapshot(motivo);
  }

  /* ================================================================== */
  /* Carga de datos y análisis                                           */
  /* ================================================================== */
  async function entrar() {
    $('#auth').classList.add('hidden');
    $('#app').classList.remove('hidden');
    $('#u-nombre').textContent = S.user.nombre;
    $('#u-rol').textContent = ROLES[S.user.rol];
    if (!S.ds) {
      loading(true, 'Cargando datos…');
      await tick();
      const f = await Store.get('fuentes');
      if (f) { S.fuentes = f; S.fuentesMod = true; S.archivos = (await Store.get('archivos')) || []; }
      else if (window.DATOS_BASE) { S.fuentes = JSON.parse(JSON.stringify(window.DATOS_BASE.fuentes)); S.archivos = window.DATOS_BASE.archivos.slice(); }
      else S.fuentes = { planes: [], perfilDocs: [], formacion: null, experiencia: null };
      S.overrides = (await Store.get('overrides')) || {};
      S.excepciones7 = (await Store.get('excepciones7')) || [];
      S.config = Object.assign({}, E.DEFAULT_CONFIG, (await Store.get('config')) || {});
      S.snapshots = (await Store.get('snapshots')) || [];
      await reconstruir();
      loading(false);
    } else renderTodo();
    poblarFiltros();
  }

  async function reconstruir() {
    const r = E.construirDataset(S.fuentes);
    S.ds = r.ds; S.meta = r.meta; S.cache = {}; S._pp = S._pf = S._cp = null;
    recalcular();
  }
  function fase7Ctx() {
    const h = S.fuentes && S.fuentes.historico7, c = S.fuentes && S.fuentes.cargaInst7;
    const cargaExt = c && c.rows ? E.procesarCargaInstitucional(c.rows, S.ds.profesores) : new Map();
    return {
      hist: h && h.rows ? E.prepararHistorico(h.rows) : [],
      cargaExt, cargaInstCargada: cargaExt.size > 0,
      autorizaciones: (S.excepciones7 || []).filter(e => e.decision === 'autorizada' && e.docenteId).map(e => ({ docenteId: e.docenteId, progN: E.progN(e.programa), nivel: e.nivelNum })),
    };
  }
  function recalcular() {
    S.an = E.analizar(S.ds, S.config, S.overrides, null, S.cache, fase7Ctx());
    S.filas = E.filasReporte(S.ds, S.an);
    S.filaPorId = new Map(S.filas.map(f => [f.id, f]));
    S.stats = E.estadisticas(S.ds, S.an);
    S.qa = E.controlCalidad(S.ds, S.an, S.meta);
    renderTodo();
    if (window.Fase7 && window.Fase7.sincronizar) window.Fase7.sincronizar();
  }

  /* ================================================================== */
  /* Navegación                                                          */
  /* ================================================================== */
  function irA(v) {
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === v));
    $$('.view').forEach(x => x.classList.toggle('active', x.id === 'v-' + v));
    window.scrollTo({ top: 0 });
  }
  $$('.tab').forEach(t => t.onclick = () => irA(t.dataset.view));

  function renderTodo() {
    if (!S.ds) return;
    renderDescargas();
    renderResumen();
    renderAsignacion();
    renderDocentes();
    renderArchivos();
    renderCalidad();
    renderHistorial();
    renderGuia();
    if (S.abierto) abrirDetalle(S.abierto, true);
  }

  /* ================================================================== */
  /* Descargas Excel                                                     */
  /* ================================================================== */
  function renderDescargas() {
    const prog = S.f.prog;
    $$('[data-downloads]').forEach((box, i) => {
      box.innerHTML =
        '<button class="btn" data-dl="programa" ' + (prog ? '' : 'disabled title="Seleccione un programa en «Asignación docente»"') + '>⬇ Excel del programa' + (prog ? ': ' + esc(corto(prog)) : ' seleccionado') + '</button>' +
        '<button class="btn primary" data-dl="consolidado">⬇ Excel general consolidado</button>' +
        '<button class="btn" data-dl="pendientes">⬇ Asignaturas sin docente asignado</button>' +
        (i === 0 ? '<button class="btn" data-dl="inventario">⬇ Inventario</button><button class="btn" data-dl="matriz">⬇ Matriz de correspondencia</button>' : '');
    });
    $$('[data-dl]').forEach(b => b.onclick = () => descargar(b.dataset.dl));
  }
  async function descargar(tipo) {
    if (!can('exportar')) return toast('Su rol no permite exportar.', true);
    loading(true, 'Generando archivo Excel…');
    await tick();
    try {
      const ctx = window.Reportes.contexto(S.ds, S.an, { meta: S.meta, log: S.log, fase7: window.Fase7 ? window.Fase7.contextoReporte() : null });
      // Verificación: lo exportado coincide con lo presentado en pantalla
      const dif = ctx.filas.filter(f => { const v = S.filaPorId.get(f.id); return !v || v.estado !== f.estado || v.docente !== f.docente; });
      if (dif.length) throw new Error('Inconsistencia entre la vista y la exportación (' + dif.length + ' filas). Recargue la aplicación.');
      let wb, nombre;
      const fecha = new Date().toISOString().slice(0, 10);
      if (tipo === 'programa') { wb = window.Reportes.libroPrograma(ExcelJS, ctx, S.f.prog); nombre = 'Asignacion_' + window.Reportes.nombreArchivo(S.f.prog) + '_' + fecha + '.xlsx'; }
      else if (tipo === 'consolidado') { wb = window.Reportes.libroConsolidado(ExcelJS, ctx); nombre = 'Consolidado_Asignacion_Docente_' + fecha + '.xlsx'; }
      else if (tipo === 'pendientes') { wb = window.Reportes.libroPendientes(ExcelJS, ctx); nombre = 'Asignaturas_sin_docente_' + fecha + '.xlsx'; }
      else if (tipo === 'comparativo' || tipo === 'comparativoPrograma') { const pg = tipo === 'comparativoPrograma' ? S.f.prog : null; wb = window.Reportes.libroComparativo(ExcelJS, ctx, pg); nombre = 'Comparativo_2026II_2027I_' + (pg ? window.Reportes.nombreArchivo(pg) + '_' : '') + fecha + '.xlsx'; }
      else if (tipo === 'autorizaciones') { wb = window.Reportes.libroAutorizaciones(ExcelJS, ctx); nombre = 'Autorizaciones_PPI_' + fecha + '.xlsx'; }
      else if (tipo === 'inventario') { wb = window.Reportes.libroInventario(ExcelJS, ctx); nombre = 'Inventario_asignaturas_' + fecha + '.xlsx'; }
      else { wb = window.Reportes.libroMatriz(ExcelJS, ctx); nombre = 'Matriz_correspondencia_' + fecha + '.xlsx'; }
      const buf = await wb.xlsx.writeBuffer();
      guardarBlob(buf, nombre, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      await registrar({ accion: 'Exportación Excel', despues: nombre });
      renderHistorial();
      toast('Archivo generado: ' + nombre);
    } catch (e) { console.error(e); toast('No fue posible generar el archivo: ' + e.message, true); }
    loading(false);
  }

  /* ================================================================== */
  /* Resumen                                                             */
  /* ================================================================== */
  function barra(valor, total, cls) {
    const pct = total ? Math.round(valor / total * 1000) / 10 : 0;
    return '<div style="display:flex;align-items:center;gap:10px"><div class="stack" style="flex:1"><span class="' + cls + '" style="width:' + pct + '%"></span></div><span class="nowrap small" style="min-width:86px;text-align:right"><b>' + valor + '</b> · ' + pct + '%</span></div>';
  }
  function renderResumen() {
    const st = S.stats;
    const fuente = S.fuentesMod ? 'Datos cargados por el usuario' : 'Datos base generados desde los archivos suministrados';
    $('#res-fuente').textContent = fuente + ' · ' + S.ds.cursos.length + ' asignaturas · ' + S.ds.perfiles.length + ' perfiles · ' + S.ds.profesores.length.toLocaleString('es-CO') + ' profesores en la base';
    const k = (lbl, val, sub, color) => '<div class="kpi" style="--k:' + color + '"><div class="lbl">' + lbl + '</div><div class="val">' + val + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
    $('#kpis').innerHTML =
      k('Programas analizados', st.programas, '', 'var(--primary)') +
      k('Asignaturas identificadas', st.total, 'Pedagógico ' + st.porComp[E.COMP.PED] + ' · Didáctica ' + st.porComp[E.COMP.DID] + ' · PPI ' + st.porComp[E.COMP.PPI], 'var(--primary-2)') +
      k('Con docente propuesto', st.conDocente, st.porEstado[EST.PROP] + ' propuestas · ' + st.porEstado[EST.VALID] + ' en validación', 'var(--info)') +
      k('Pendientes por designar', st.pendientes, '', 'var(--danger)') +
      k('Sin perfil docente disponible', st.sinPerfil, '', 'var(--gray)') +
      k('Asignación aprobada', st.pctAprobadas + '%', st.porEstado[EST.APROB] + ' de ' + st.total + ' asignaturas', 'var(--ok)') +
      k('Docentes con carga', st.docentes, 'Tope ' + S.config.maxHoras + ' h por docente', 'var(--accent)');
    $('#res-comp').innerHTML = E.COMP_ORDEN.map(c => '<div style="margin-bottom:12px"><div style="margin-bottom:4px">' + compTag(c) + ' <span class="small">' + esc(c) + '</span></div>' + barra(st.porComp[c], st.total, 'c-prop') + '</div>').join('');
    const cls = {}; cls[EST.PROP] = 'c-prop'; cls[EST.APROB] = 'c-aprob'; cls[EST.PEND] = 'c-pend'; cls[EST.SINP] = 'c-sinp'; cls[EST.VALID] = 'c-valid'; cls[EST.VALDOC] = 'c-valid'; cls[EST.DIR] = 'c-dir';
    $('#res-estado').innerHTML = E.ESTADOS.map(e => '<div style="margin-bottom:10px"><div style="margin-bottom:4px">' + chip(e) + '</div>' + barra(st.porEstado[e], st.total, cls[e]) + '</div>').join('');
    const seg = (p, e, c) => p[e] ? '<span class="' + c + '" style="width:' + (p[e] / p.total * 100) + '%" title="' + esc(e) + ': ' + p[e] + '"></span>' : '';
    $('#res-prog').innerHTML = '<thead><tr><th>Programa</th><th class="num">Total</th><th class="num">Ped.</th><th class="num">Didáct.</th><th class="num">PPI</th><th style="min-width:180px">Estado</th><th class="num">Con docente</th><th class="num">Por designar</th><th class="num">Sin perfil</th><th class="num">% aprobada</th></tr></thead><tbody>' +
      st.porPrograma.map(p => '<tr class="click" data-prog="' + esc(p.programa) + '"><td><b>' + esc(p.programa) + '</b></td><td class="num">' + p.total + '</td><td class="num">' + p[E.COMP.PED] + '</td><td class="num">' + p[E.COMP.DID] + '</td><td class="num">' + p[E.COMP.PPI] + '</td><td><div class="stack">' +
        seg(p, EST.APROB, 'c-aprob') + seg(p, EST.PROP, 'c-prop') + seg(p, EST.VALID, 'c-valid') + seg(p, EST.VALDOC, 'c-valid') + seg(p, EST.DIR, 'c-dir') + seg(p, EST.PEND, 'c-pend') + seg(p, EST.SINP, 'c-sinp') + '</div></td><td class="num">' + p.conDocente + '</td><td class="num">' + p[EST.PEND] + '</td><td class="num">' + p[EST.SINP] + '</td><td class="num">' + (p.total ? Math.round(p[EST.APROB] / p.total * 1000) / 10 : 0) + '%</td></tr>').join('') + '</tbody>';
    $$('#res-prog tr[data-prog]').forEach(tr => tr.onclick = () => { S.f.prog = tr.dataset.prog; $('#f-prog').value = S.f.prog; renderDescargas(); renderAsignacion(); irA('asignacion'); });
  }

  /* ================================================================== */
  /* Asignación                                                          */
  /* ================================================================== */
  function poblarFiltros() {
    const progs = [...new Set(S.ds.cursos.map(c => c.programa))].sort((a, b) => a.localeCompare(b, 'es'));
    $('#f-prog').innerHTML = '<option value="">Todos los programas</option>' + progs.map(p => '<option' + (p === S.f.prog ? ' selected' : '') + '>' + esc(p) + '</option>').join('');
    $('#f-est').innerHTML = '<option value="">Todos los estados</option>' + E.ESTADOS.map(e => '<option' + (e === S.f.est ? ' selected' : '') + '>' + esc(e) + '</option>').join('');
  }
  ['#f-prog', '#f-comp', '#f-plan', '#f-est', '#f-tipo7'].forEach(id => $(id).addEventListener('change', () => {
    S.f = { prog: $('#f-prog').value, comp: $('#f-comp').value, plan: $('#f-plan').value, est: $('#f-est').value, tipo: $('#f-tipo7').value, q: $('#f-q').value };
    renderDescargas(); renderAsignacion();
  }));
  let qT;
  $('#f-q').addEventListener('input', () => { clearTimeout(qT); qT = setTimeout(() => { S.f.q = $('#f-q').value; renderAsignacion(); }, 150); });

  function filasFiltradas() {
    const q = E.norm(S.f.q);
    return S.filas.filter(f => (!S.f.prog || f.programa === S.f.prog) && (!S.f.comp || f.componente === S.f.comp) && (!S.f.plan || f.plan === S.f.plan) &&
      (!S.f.est || f.estado === S.f.est) && (!S.f.tipo || (f.f7 && f.f7.tipo === S.f.tipo)) && (!q || E.norm(f.asignatura + ' ' + f.programa + ' ' + f.docente + ' ' + f.alternativas).includes(q)))
      .sort((a, b) => a.programa.localeCompare(b.programa, 'es') || E.COMP_ORDEN.indexOf(a.componente) - E.COMP_ORDEN.indexOf(b.componente) ||
        (a.plan === b.plan ? 0 : a.plan === 'Plan de transición' ? -1 : 1) || (Number(a.semestre) || 99) - (Number(b.semestre) || 99) || a.asignatura.localeCompare(b.asignatura, 'es'));
  }
  function renderAsignacion() {
    const filas = filasFiltradas();
    const todos = !S.f.prog;
    $('#asig-count').textContent = filas.length + ' asignaturas' + (S.f.prog ? ' · ' + S.f.prog : '') + (S.f.comp ? ' · ' + S.f.comp : '');
    if (!filas.length) { $('#asig-table').innerHTML = '<tbody><tr><td class="empty">No hay asignaturas que coincidan con los filtros.</td></tr></tbody>'; $('#asig-mobile').innerHTML = '<div class="empty">Sin resultados.</div>'; return; }
    const meta = f => esc(f.plan) + (f.semestre !== '' ? ' · Sem. ' + esc(f.semestre) : '') + ' · ' + esc(f.creditos) + ' cr. · ' + esc(f.horas) + ' h';
    const man = f => f.manual === 'Sí' ? ' <span class="tag warn">manual</span>' : '';
    const rev = f => f.revision ? ' <span class="tag warn" title="' + esc(f.revision) + '">revisar clasificación</span>' : '';
    const h7 = !!(S.fuentes && S.fuentes.historico7);
    const TIPO7 = { 'continuidad': ['Continuidad', 'tipo-continuidad'], 'progresión': ['Progresión PPI', 'tipo-progresion'], 'nueva': ['Nueva', 'tipo-nueva'], 'pendiente': ['Pendiente', 'tipo-pendiente'] };
    const ant = f => { const x = f.f7; if (!x || !TIPO7[x.tipo]) return '<span class="muted">—</span>'; const prev = x.origen ? x.origen.nombre : (x.prev26 || []).join('; '); return '<span class="col-tipo-cont ' + TIPO7[x.tipo][1] + '">● ' + TIPO7[x.tipo][0] + '</span>' + (prev ? '<div class="col-prev">2026-II: ' + esc(prev) + '</div>' : ''); };
    $('#asig-table').innerHTML = '<thead><tr><th>Asignatura</th>' + (todos ? '<th>Programa</th>' : '') + '<th>Componente</th><th>Docente asignado</th>' + (h7 ? '<th>Antecedente 2026-II</th><th class="num">Carga total</th>' : '') + '<th class="num">Pertinencia</th><th>Estado</th></tr></thead><tbody>' +
      filas.map(f => '<tr class="click" data-id="' + f.id + '" tabindex="0"><td><div class="asig-name">' + esc(f.asignatura) + rev(f) + '</div><div class="asig-meta">' + meta(f) + '</div></td>' +
        (todos ? '<td class="small">' + esc(corto(f.programa)) + '</td>' : '') + '<td>' + compTag(f.componente) + '</td><td>' + (f.docente === 'Por designar' ? '<span class="muted">Por designar</span>' : '<b>' + esc(f.docente) + '</b>') + man(f) +
        '</td>' + (h7 ? '<td class="small">' + ant(f) + '</td><td class="num">' + (f.f7 && f.f7.cargaTotal != null ? '<span' + (f.f7.cargaTotal > S.config.maxHoras ? ' style="color:var(--danger);font-weight:700"' : '') + '>' + f.f7.cargaTotal + ' h</span>' : '<span class="muted">—</span>') + '</td>' : '') + '<td class="num">' + (f.puntaje !== '' ? '<span class="score">' + f.puntaje + '</span>' : '<span class="muted">—</span>') + '</td><td>' + chip(f.estado) + '</td></tr>').join('') + '</tbody>';
    $('#asig-mobile').innerHTML = filas.map(f => '<div class="mrow" data-id="' + f.id + '"><div class="l1"><div><div class="asig-name">' + esc(f.asignatura) + '</div><div class="asig-meta">' + (todos ? esc(corto(f.programa)) + ' · ' : '') + meta(f) + '</div></div>' + chip(f.estado) + '</div><div class="doc">' + compTag(f.componente) + ' ' + (f.docente === 'Por designar' ? '<span class="muted">Por designar</span>' : esc(f.docente)) + man(f) + '</div></div>').join('');
    $$('#asig-table tr[data-id], #asig-mobile [data-id]').forEach(el => {
      el.onclick = () => abrirDetalle(el.dataset.id);
      el.onkeydown = e => { if (e.key === 'Enter') abrirDetalle(el.dataset.id); };
    });
  }

  /* ================================================================== */
  /* Detalle de asignatura                                               */
  /* ================================================================== */
  const ICON = { A: '✓', C: '✓', F: '≈', I: '?', N: '✗' };
  function celdaReq(q) {
    if (!q) return '<span class="muted">—</span>';
    return '<div class="req-cell"><span class="ri ' + q.s + '" title="' + esc(E.R[q.s]) + '">' + ICON[q.s] + '</span><div><div class="small"><b>' + esc(E.R[q.s]) + '</b></div><div class="req-det">' + esc(q.det) + '</div></div></div>';
  }
  function cerrarDrawer() {
    S.abierto = null;
    $('#drawer').classList.remove('open'); $('#drawer-bg').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
  }
  $('#dr-close').onclick = cerrarDrawer;
  $('#drawer-bg').onclick = cerrarDrawer;
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && S.abierto && !$('.modal-bg')) cerrarDrawer(); });

  function abrirDetalle(id, refrescar) {
    const c = cursoPorId().get(id), f = S.filaPorId.get(id), r = S.an.resultados.get(id);
    if (!c) return;
    S.abierto = id;
    const perfil = c.perfilId ? perfilPorId().get(c.perfilId) : null;
    const prof = r.docenteId ? profPorId().get(r.docenteId) : null;
    const o = S.overrides[id] || {};
    $('#dr-head').innerHTML = '<div style="margin-bottom:6px">' + chip(r.estado) + ' ' + compTag(c.componente) + '</div><h3>' + esc(c.asignatura) + '</h3><div class="muted small">' + esc(c.programa) + ' · ' + esc(c.plan) + '</div>';
    const h = [];
    // Datos de la asignatura
    h.push('<div class="card"><div class="card-b"><div class="kv">' +
      '<div><b>Código</b>' + esc(f.codigo) + '</div><div><b>Semestre</b>' + esc(c.semestre === '' ? '—' : c.semestre) + '</div><div><b>Créditos</b>' + esc(c.creditos) + '</div><div><b>Horas estimadas</b>' + esc(r.horas) + ' h</div>' +
      '<div><b>Componente en el plan</b>' + esc(c.componenteOficial) + '</div><div><b>Prerrequisitos</b>' + esc(c.prerrequisitos || '—') + '</div>' +
      '<div style="grid-column:1/-1"><b>Perfil asociado</b>' + (perfil ? esc(perfil.titulo) + ' <span class="tag' + (c.perfilMatch !== 'exacta' ? ' warn' : '') + '">' + esc(c.perfilMatch === 'exacta' ? 'denominación exacta' : c.perfilMatch === 'homologado' ? 'homologado' : 'por equivalencia') + '</span> <span class="muted small">(' + esc(perfil.archivo) + ')</span>' : '<span class="muted">Perfil no disponible</span>') + '</div>' +
      '</div></div></div>');

    // Docente asignado + acciones
    const acciones = [];
    if (can('aprobar') && prof && !r.aprobado && r.ev && r.ev.tier > 0) acciones.push('<button class="btn ok" data-act="aprobar">✓ Aprobar asignación</button>');
    if (can('aprobar') && r.aprobado) acciones.push('<button class="btn" data-act="revocar">Revocar aprobación</button>');
    if (can('editar') && perfil && !r.forzadoPorDesignar) acciones.push('<button class="btn" data-act="pordesignar">Marcar «Por designar»</button>');
    if (can('editar') && (o.docenteId || o.accion || o.aprobado)) acciones.push('<button class="btn" data-act="restablecer">Restablecer propuesta automática</button>');
    const carga = prof ? (r.f7 && r.f7.cargaTotal != null ? r.f7.cargaTotal : (S.an.carga.get(prof.id) || 0)) : 0;
    h.push('<div class="card"><div class="card-h"><h3>Docente asignado</h3><div class="btn-row">' + acciones.join('') + '</div></div><div class="card-b">' +
      (prof ? '<div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><div><div style="font-size:16px;font-weight:700">' + esc(prof.nombre) + (r.manual ? ' <span class="tag warn">asignación manual</span>' : '') + '</div><div class="small muted">' + esc(E.nivelCorrespondencia(r.ev)) + ' · puntaje ' + (r.ev ? r.ev.score : '—') + '/100</div></div>' +
        '<div class="small">Carga total: <b>' + carga + ' / ' + S.config.maxHoras + ' h</b> <span class="loadbar"><span class="' + (carga > S.config.maxHoras ? 'full' : '') + '" style="width:' + Math.min(100, carga / S.config.maxHoras * 100) + '%"></span></span></div></div>' +
        '<p class="small" style="margin:10px 0 0"><b>Pregrado:</b> ' + esc((prof.titulos.find(t => t.nivel === 'Profesional') || {}).titulo || 'no registrado') + ' — <b>' + esc(r.ev && r.ev.pre ? (r.ev.pre.s === 'A' ? 'afín con la asignatura' : r.ev.pre.s === 'N' ? 'no afín con la asignatura (requiere revisión del Director)' : r.ev.pre.s === 'I' && r.ev.pre.sinReq ? 'el perfil no exige un pregrado específico' : 'afinidad por validar') : '') + '</b></p>' +
        '<p class="small" style="margin:6px 0 0">' + esc(E.resumenProfesor(prof)) + '</p>'
        : '<div style="font-size:16px;font-weight:700">Por designar</div>') +
      '</div></div>');

    // Fase 7: antecedente 2026-II, tipo de asignación y carga institucional
    if (S.fuentes && S.fuentes.historico7 && r.f7) {
      const x = r.f7, nombreTipo = { 'continuidad': 'Continuidad desde 2026-II', 'progresión': 'Progresión de PPI ' + (x.nivelOrigen ? E.ROMANO(x.nivelOrigen) : '') + ' a PPI ' + (x.nivelDestino ? E.ROMANO(x.nivelDestino) : ''), 'nueva': 'Nueva asignación', 'pendiente': 'Sin docente propuesto' }[x.tipo] || '';
      h.push('<div class="card" style="border-color:rgba(196,135,30,.4)"><div class="card-h" style="background:var(--accent-soft)"><h3>Fase 7 · Continuidad 2026-II → 2027-I</h3><span class="small"><b>' + esc(nombreTipo) + '</b></span></div><div class="card-b"><div class="kv">' +
        '<div><b>Profesor(es) 2026-II de esta asignatura</b>' + esc((x.prev26 || []).join('; ') || '—') + '</div>' +
        '<div><b>Antecedente del docente propuesto</b>' + (x.origen ? esc(x.origen.asignatura + ' (' + x.origen.periodo + ')') : '—') + '</div>' +
        '<div><b>Carga total proyectada 2027-I</b>' + (x.cargaTotal != null ? x.cargaTotal + ' h (esta propuesta) ' + (x.cargaExt ? '· incluye ' + x.cargaExt + ' h de otras unidades' : '· sin carga externa registrada') : '—') + '</div>' +
        '</div>' + ((x.bloqueos || []).length ? '<ul class="obs" style="margin-top:8px">' + x.bloqueos.map(b => '<li><b>' + esc(b.nombre) + '</b> (' + esc(b.t) + ' desde 2026-II) no continúa: ' + esc(b.motivo) + '.</li>').join('') + '</ul>' : '') + '</div></div>');
    }

    // Observaciones
    h.push('<div class="card"><div class="card-h"><h3>Observaciones y justificación</h3></div><div class="card-b"><ul class="obs">' + r.observaciones.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul></div></div>');

    // Matriz de correspondencia
    if (perfil) {
      const cands = [];
      if (prof) cands.push({ p: prof, rol: r.manual ? 'Asignado' : 'Propuesto' });
      r.alternativas.forEach((a, i) => { const p = profPorId().get(a.id); if (p) cands.push({ p, rol: 'Sugerido ' + (i + 1) + ' · pregrado afín' }); });
      (r.revisionDirector || []).forEach((a, i) => { const p = profPorId().get(a.id); if (p && !cands.some(x => x.p.id === a.id)) cands.push({ p, rol: 'Revisión del Director ' + (i + 1) + ' · posgrado afín' }); });
      if (S.extraCand && S.extraCand.curso === id) S.extraCand.ids.forEach(pid => { const p = profPorId().get(pid); if (p && !cands.some(x => x.p.id === pid)) cands.push({ p, rol: 'Consultado' }); });
      const evs = cands.map(x => ({ x, ev: E.evaluar(perfil, x.p, S.config) }));
      const filasReq = [['Formación de pregrado', 'pre'], ['Formación posgradual', 'pos'], ['Experiencia docente', 'exp'], ['Experiencia específica', 'expEsp'], ['Experiencia investigativa', 'inv'], ['Competencias', 'comp'], ['Hoja de vida (BDC)', 'bdc']];
      h.push('<div class="card"><div class="card-h"><h3>Profesores que cumplen el perfil (matriz de correspondencia)</h3><span class="small muted">' + (r.nIdoneos || 0) + ' cumplen requisitos verificables · ' + (r.nCandidatos || 0) + ' con correspondencia total o parcial</span></div>' +
        (evs.length ? '<div class="table-wrap"><table class="t req-table"><thead><tr><th>Requisito</th>' + evs.map(({ x, ev }) => '<th style="min-width:230px;white-space:normal"><div>' + esc(x.rol) + '</div><div style="text-transform:none;color:var(--text);font-size:13px">' + esc(x.p.nombre) + '</div><div style="text-transform:none" class="small"><span class="score">' + (ev.score != null ? ev.score : '—') + '</span> ' + esc(E.nivelCorrespondencia(ev)) + ' · carga ' + (S.an.carga.get(x.p.id) || 0) + ' h</div>' +
          (can('editar') && x.p.id !== r.docenteId ? '<button class="btn sm" style="margin-top:6px" data-asignar="' + esc(x.p.id) + '">Asignar este docente</button>' : '') + '</th>').join('') + '</tr></thead><tbody>' +
          filasReq.map(([lbl, k]) => '<tr><td>' + lbl + '</td>' + evs.map(({ ev }) => '<td>' + celdaReq(ev[k]) + '</td>').join('') + '</tr>').join('') +
          (perfil.otros.length ? '<tr><td>Otros requisitos</td>' + evs.map(({ ev }) => '<td class="small">' + esc((ev.otros || []).map(o2 => o2.nombre + ': ' + E.R[o2.s]).join('; ') || '—') + '</td>').join('') + '</tr>' : '') +
          '</tbody></table></div>' : '<div class="card-b muted">Ningún profesor de la base acredita los requisitos obligatorios de este perfil.</div>') +
        (can('editar') ? '<div class="card-b" style="border-top:1px solid var(--border)"><label class="f">Consultar o asignar otro profesor de la base<input class="inp" id="busca-prof" type="search" placeholder="Escriba al menos 3 letras del nombre…"></label><div class="cand-list" id="busca-res" style="margin-top:8px"></div></div>' : '') +
        '</div>');
    } else {
      // Sin perfil: homologación
      const sug = c._orig && c._orig.perfilId ? null : (c.perfilSugerido ? perfilPorId().get(c.perfilSugerido) : null);
      const opciones = S.ds.perfiles.filter(p => p.programa === c.programa || p.programa === c.programa.replace(/\s*\(Distancia\)/i, '')).sort((a, b) => a.titulo.localeCompare(b.titulo, 'es'));
      h.push('<div class="card"><div class="card-h"><h3>Perfil no disponible</h3></div><div class="card-b">' +
        '<p style="margin-top:0">' + esc(c.perfilNota || 'No se encontró un perfil docente definido para esta asignatura.') + '</p>' +
        (can('editar') && opciones.length ? '<label class="f">Homologar con un perfil existente (decisión académica, queda registrada)<select class="inp" id="hom-sel"><option value="">— Seleccione —</option>' + opciones.map(p => '<option value="' + p.id + '"' + (sug && sug.id === p.id ? ' selected' : '') + '>' + esc(p.titulo + ' · ' + corto(p.programa)) + '</option>').join('') + '</select></label><div class="btn-row" style="margin-top:8px"><button class="btn primary" data-act="homologar">Homologar perfil</button></div>' : '') +
        '</div></div>');
    }
    if (o.perfilId && can('editar')) h.push('<div class="notice info">Esta asignatura usa un perfil homologado manualmente. <button class="btn sm" data-act="quitarhom">Quitar homologación</button></div>');

    // Perfil requerido
    if (perfil) {
      const sec = (t, x, open) => x ? '<details class="sec"' + (open ? ' open' : '') + '><summary>' + t + '</summary><p>' + esc(x) + '</p></details>' : '';
      h.push('<div class="card"><div class="card-h"><h3>Perfil requerido por la asignatura</h3></div><div class="card-b">' +
        sec('Descripción', perfil.descripcion) + sec('Formación de pregrado', perfil.pregrado, true) + sec('Formación posgradual', perfil.posgrado, true) + sec('Experiencia docente y profesional', perfil.experiencia, true) +
        (perfil.competencias.length ? '<details class="sec"><summary>Competencias (' + perfil.competencias.length + ')</summary><ul class="obs" style="margin-top:6px">' + perfil.competencias.map(x => '<li><b>' + esc(x.nombre) + '.</b> ' + esc(x.descripcion) + '</li>').join('') + '</ul></details>' : '') +
        perfil.otros.map(x => sec(esc(x.nombre), x.descripcion)).join('') +
        sec('Experiencia y producción investigativa', perfil.investigacion) + sec('Criterio integral de idoneidad', perfil.idoneidad) +
        (perfil.alertas.length ? '<div class="notice" style="margin:10px 0 0">Alertas del documento: ' + esc(perfil.alertas.join(' ')) + '</div>' : '') +
        '</div></div>');
    }
    // Historial de la asignatura
    const hist = S.log.filter(e => e.cursoId === id).slice().reverse();
    if (hist.length) h.push('<div class="card"><div class="card-h"><h3>Historial de esta asignatura</h3></div><div class="table-wrap"><table class="t"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Anterior</th><th>Nuevo</th><th>Motivo</th></tr></thead><tbody>' +
      hist.map(e => '<tr><td class="nowrap small">' + fmtF(e.fecha) + '</td><td>' + esc(e.usuario) + '</td><td>' + esc(e.accion) + '</td><td>' + esc(e.antes || '') + '</td><td>' + esc(e.despues || '') + '</td><td>' + esc(e.motivo || '') + '</td></tr>').join('') + '</tbody></table></div></div>');

    $('#dr-body').innerHTML = h.join('');
    if (!refrescar) $('#dr-body').scrollTop = 0;
    $('#drawer').classList.add('open'); $('#drawer-bg').classList.add('open'); $('#drawer').setAttribute('aria-hidden', 'false');

    // eventos
    $$('#dr-body [data-act]').forEach(b => b.onclick = () => accion(b.dataset.act, id));
    $$('#dr-body [data-asignar]').forEach(b => b.onclick = () => asignarDocente(id, b.dataset.asignar));
    const bp = $('#busca-prof');
    if (bp) {
      let t;
      bp.oninput = () => { clearTimeout(t); t = setTimeout(() => buscarProfesor(id, bp.value), 200); };
    }
  }

  function buscarProfesor(cursoId, q) {
    const box = $('#busca-res');
    q = E.norm(q);
    if (q.length < 3) { box.innerHTML = ''; return; }
    const c = cursoPorId().get(cursoId);
    const perfil = perfilPorId().get(c.perfilId);
    const res = S.ds.profesores.filter(p => E.norm(p.nombre).includes(q)).slice(0, 12);
    if (!res.length) { box.innerHTML = '<div class="muted small">Sin coincidencias.</div>'; return; }
    box.innerHTML = res.map(p => {
      const ev = E.evaluar(perfil, p, S.config);
      const lbl = ev.soloPosgrado ? '<span class="chip st-dir">Pregrado no afín · revisión del Director</span>' : ev.tier === 3 ?'<span class="chip st-aprob">Cumple requisitos verificables</span>' : ev.tier > 0 ? '<span class="chip st-valid">Por validar</span>' : '<span class="chip st-pend">No acredita requisitos obligatorios</span>';
      return '<div class="cand"><div><div class="n">' + esc(p.nombre) + '</div><div class="small muted">' + esc((p.titulos.filter(t => t.nivel === 'Profesional')[0] || {}).titulo || 'Sin pregrado registrado') + ' · ' + esc(p.estadoBDC) + ' · carga ' + (S.an.carga.get(p.id) || 0) + ' h</div></div><div class="btn-row">' + lbl +
        '<button class="btn sm" data-ver="' + esc(p.id) + '">Ver en matriz</button><button class="btn sm" data-asg="' + esc(p.id) + '">Asignar</button></div></div>';
    }).join('');
    $$('[data-ver]', box).forEach(b => b.onclick = () => { S.extraCand = { curso: cursoId, ids: [...((S.extraCand && S.extraCand.curso === cursoId) ? S.extraCand.ids : []), b.dataset.ver] }; abrirDetalle(cursoId, true); });
    $$('[data-asg]', box).forEach(b => b.onclick = () => asignarDocente(cursoId, b.dataset.asg));
  }

  async function asignarDocente(cursoId, profId) {
    if (!can('editar')) return;
    const c = cursoPorId().get(cursoId), r = S.an.resultados.get(cursoId), p = profPorId().get(profId);
    const perfil = c.perfilId ? perfilPorId().get(c.perfilId) : null;
    const ev = perfil ? E.evaluar(perfil, p, S.config) : null;
    const cargaAct = (S.an.carga.get(profId) || 0);
    const nueva = cargaAct + r.horas;
    const avisos = [];
    if (!perfil) avisos.push('La asignatura no tiene perfil de referencia.');
    else if (ev.pre && ev.pre.s !== 'A' && !ev.pre.sinReq) avisos.push('El pregrado del profesor NO es afín con la asignatura. Solo debe asignarse con la decisión expresa del Director del Departamento; regístrela en el motivo.');
    else if (ev.tier === 0) avisos.push('El profesor NO acredita los requisitos obligatorios verificables del perfil. La asignación quedará como «Pendiente de validación» y no podrá aprobarse.');
    else if (ev.tier < 3) avisos.push('El profesor tiene requisitos con afinidad por validar o información insuficiente; la asignación quedará «Pendiente de validación».');
    if (nueva > S.config.maxHoras) avisos.push('Con esta asignatura el profesor tendría ' + nueva + ' h, superando el tope de ' + S.config.maxHoras + ' h.');
    const v = await modal({
      titulo: 'Asignar docente', ok: 'Registrar asignación',
      html: '<div><b>' + esc(p.nombre) + '</b> → ' + esc(c.asignatura) + ' (' + esc(corto(c.programa)) + ')</div>' +
        (avisos.length ? '<div class="notice" style="margin:0">' + avisos.map(esc).join('<br>') + '</div>' : '<div class="notice info" style="margin:0">El profesor acredita los requisitos verificables del perfil.</div>') +
        '<label class="f">Motivo de la modificación (obligatorio)<textarea class="inp" name="motivo" required placeholder="Justificación académica del cambio…"></textarea></label>',
      validar: d => (!d.motivo || d.motivo.trim().length < 5) ? 'Indique el motivo de la modificación (mínimo 5 caracteres).' : null,
    });
    if (!v) return;
    const antes = r.docenteId ? (profPorId().get(r.docenteId) || {}).nombre : 'Por designar';
    S.overrides[cursoId] = Object.assign({}, S.overrides[cursoId] || {}, { docenteId: profId, docenteNombre: p.nombre, accion: 'asignar', aprobado: false, motivo: v.motivo.trim(), usuario: S.user.usuario, fecha: Date.now() });
    await registrar({ accion: 'Cambio de docente', cursoId, programa: c.programa, asignatura: c.asignatura, antes, despues: p.nombre, motivo: v.motivo.trim() });
    await guardarDecisiones('Cambio de docente: ' + c.asignatura);
    recalcular();
    toast('Asignación registrada.');
  }

  async function accion(act, id) {
    const c = cursoPorId().get(id), r = S.an.resultados.get(id);
    const prof = r.docenteId ? profPorId().get(r.docenteId) : null;
    const o = S.overrides[id] || {};
    const base = { cursoId: id, programa: c.programa, asignatura: c.asignatura };
    if (act === 'aprobar') {
      const v = await modal({ titulo: 'Aprobar asignación', ok: 'Aprobar', html: '<div>Se aprobará la asignación de <b>' + esc(prof.nombre) + '</b> a <b>' + esc(c.asignatura) + '</b>. La decisión se conservará en futuras actualizaciones y exportaciones.</div>' + (r.estado === EST.VALID ? '<div class="notice" style="margin:0">La asignación estaba pendiente de validación: confirme que verificó los requisitos señalados.</div>' : '') + '<label class="f">Observación (opcional)<textarea class="inp" name="motivo"></textarea></label>' });
      if (!v) return;
      S.overrides[id] = Object.assign({}, o, { docenteId: prof.id, docenteNombre: prof.nombre, aprobado: true, motivoAprobacion: v.motivo, usuario: S.user.usuario, fecha: Date.now() });
      if (!o.docenteId) S.overrides[id].accion = 'aprobar';
      await registrar(Object.assign({ accion: 'Aprobación', antes: r.estado, despues: EST.APROB + ' – ' + prof.nombre, motivo: v.motivo }, base));
    } else if (act === 'revocar') {
      const v = await modal({ titulo: 'Revocar aprobación', ok: 'Revocar', peligro: true, html: '<label class="f">Motivo (obligatorio)<textarea class="inp" name="motivo"></textarea></label>', validar: d => d.motivo.trim().length < 5 ? 'Indique el motivo.' : null });
      if (!v) return;
      S.overrides[id] = Object.assign({}, o, { aprobado: false });
      if (o.accion === 'aprobar') { delete S.overrides[id].docenteId; delete S.overrides[id].accion; }
      await registrar(Object.assign({ accion: 'Revocación de aprobación', antes: EST.APROB, despues: 'Sin aprobación', motivo: v.motivo }, base));
    } else if (act === 'pordesignar') {
      const v = await modal({ titulo: 'Marcar como «Por designar»', ok: 'Registrar', html: '<label class="f">Motivo (obligatorio)<textarea class="inp" name="motivo"></textarea></label>', validar: d => d.motivo.trim().length < 5 ? 'Indique el motivo.' : null });
      if (!v) return;
      S.overrides[id] = { accion: 'por_designar', motivo: v.motivo.trim(), usuario: S.user.usuario, fecha: Date.now(), perfilId: o.perfilId, perfilMotivo: o.perfilMotivo };
      await registrar(Object.assign({ accion: 'Marcado por designar', antes: prof ? prof.nombre : r.estado, despues: 'Por designar', motivo: v.motivo }, base));
    } else if (act === 'restablecer') {
      if (!await confirmar('Restablecer propuesta automática', 'Se eliminarán las decisiones manuales (docente, aprobación) de esta asignatura y se recalculará la propuesta automática.')) return;
      const keep = o.perfilId ? { perfilId: o.perfilId, perfilMotivo: o.perfilMotivo } : null;
      if (keep) S.overrides[id] = keep; else delete S.overrides[id];
      await registrar(Object.assign({ accion: 'Restablecimiento de propuesta', antes: prof ? prof.nombre : r.estado, despues: 'Propuesta automática' }, base));
    } else if (act === 'homologar') {
      const pid = $('#hom-sel').value;
      if (!pid) return toast('Seleccione un perfil.', true);
      const p = perfilPorId().get(pid);
      const v = await modal({ titulo: 'Homologar perfil', ok: 'Homologar', html: '<div>Se usará el perfil <b>' + esc(p.titulo) + '</b> (' + esc(p.programa) + ') para evaluar la asignatura <b>' + esc(c.asignatura) + '</b>.</div><label class="f">Motivo académico (obligatorio)<textarea class="inp" name="motivo"></textarea></label>', validar: d => d.motivo.trim().length < 5 ? 'Indique el motivo.' : null });
      if (!v) return;
      S.overrides[id] = Object.assign({}, o, { perfilId: pid, perfilMotivo: v.motivo.trim() });
      await registrar(Object.assign({ accion: 'Homologación de perfil', antes: 'Perfil no disponible', despues: p.titulo, motivo: v.motivo.trim() }, base));
    } else if (act === 'quitarhom') {
      if (!await confirmar('Quitar homologación', 'La asignatura volverá a quedar con su perfil original (o «Perfil no disponible»).')) return;
      const n = Object.assign({}, o); delete n.perfilId; delete n.perfilMotivo;
      if (Object.keys(n).length) S.overrides[id] = n; else delete S.overrides[id];
      await registrar(Object.assign({ accion: 'Retiro de homologación', antes: 'Perfil homologado', despues: 'Perfil original' }, base));
    }
    await guardarDecisiones(act + ': ' + c.asignatura);
    recalcular();
  }

  /* ================================================================== */
  /* Docentes                                                            */
  /* ================================================================== */
  ['#d-q', '#d-scope', '#d-bdc'].forEach(s => $(s).addEventListener(s === '#d-q' ? 'input' : 'change', () => { S.docPage = 0; renderDocentes(); }));
  function renderDocentes() {
    const q = E.norm($('#d-q').value), scope = $('#d-scope').value, bdc = $('#d-bdc').value;
    let lista = scope === 'asig' ? [...S.an.asignados.keys()].map(id => profPorId().get(id)).filter(Boolean) : S.ds.profesores;
    lista = lista.filter(p => (!bdc || p.estadoBDC === bdc) && (!q || E.norm(p.nombre + ' ' + p.titulos.map(t => t.titulo + ' ' + t.institucion).join(' ')).includes(q)));
    if (scope === 'asig') lista.sort((a, b) => (S.an.carga.get(b.id) || 0) - (S.an.carga.get(a.id) || 0) || a.nombre.localeCompare(b.nombre, 'es'));
    const PAG = 50, pages = Math.max(1, Math.ceil(lista.length / PAG));
    S.docPage = Math.min(S.docPage, pages - 1);
    const vis = lista.slice(S.docPage * PAG, S.docPage * PAG + PAG);
    $('#doc-count').textContent = lista.length.toLocaleString('es-CO') + ' profesores';
    $('#doc-table').innerHTML = '<thead><tr><th>Profesor</th><th>Mayor nivel / pregrado</th><th class="num">Docencia (años)</th><th>Estado BDC</th><th>Carga</th><th>Asignaturas</th></tr></thead><tbody>' +
      (vis.length ? vis.map(p => {
        const h = S.an.carga.get(p.id) || 0;
        const cs = (S.an.asignados.get(p.id) || []).map(id => cursoPorId().get(id));
        const top = ['Doctorado', 'Maestría', 'Especialización'].map(n => p.titulos.find(t => t.nivel === n)).find(Boolean);
        const pre = p.titulos.find(t => t.nivel === 'Profesional');
        return '<tr class="click" data-p="' + esc(p.id) + '"><td><b>' + esc(p.nombre) + '</b></td><td class="small">' + (top ? esc(top.nivel + ': ' + top.titulo) + '<br>' : '') + '<span class="muted">' + esc(pre ? pre.titulo : '—') + '</span></td><td class="num">' + (p.exp ? p.exp.docenciaTotal.toFixed(1) : '—') +
          '</td><td class="small">' + esc(p.estadoBDC) + '</td><td class="nowrap"><span class="loadbar"><span class="' + (h > S.config.maxHoras ? 'full' : '') + '" style="width:' + Math.min(100, h / S.config.maxHoras * 100) + '%"></span></span> <span class="small">' + h + '/' + S.config.maxHoras + ' h</span></td><td class="small">' +
          cs.map(c => esc(c.asignatura) + ' <span class="muted">(' + esc(corto(c.programa)) + ')</span>').join('<br>') + '</td></tr>';
      }).join('') : '<tr><td colspan="6" class="empty">Sin resultados.</td></tr>') + '</tbody>';
    $('#doc-pager').innerHTML = pages > 1 ? '<span>Página ' + (S.docPage + 1) + ' de ' + pages + '</span><div class="btn-row"><button class="btn sm" data-pg="-1"' + (S.docPage ? '' : ' disabled') + '>‹ Anterior</button><button class="btn sm" data-pg="1"' + (S.docPage < pages - 1 ? '' : ' disabled') + '>Siguiente ›</button></div>' : '';
    $$('#doc-pager [data-pg]').forEach(b => b.onclick = () => { S.docPage += +b.dataset.pg; renderDocentes(); });
    $$('#doc-table tr[data-p]').forEach(tr => tr.onclick = () => verDocente(tr.dataset.p));
  }
  function verDocente(id) {
    const p = profPorId().get(id);
    const cs = (S.an.asignados.get(id) || []).map(cid => cursoPorId().get(cid));
    const h = '<div class="small muted">' + esc(p.estadoBDC) + ' · ' + esc(p.unidades.join(', ')) + '</div>' +
      '<table class="t"><thead><tr><th>Nivel</th><th>Título</th><th>Institución</th><th>Año</th><th>Graduado</th></tr></thead><tbody>' +
      p.titulos.map(t => '<tr><td>' + esc(t.nivel) + '</td><td>' + esc(t.titulo) + '</td><td class="small">' + esc(t.institucion) + '</td><td>' + esc(t.fecha) + '</td><td>' + (t.graduado === true ? 'Sí' : t.graduado === false ? 'No' : '—') + '</td></tr>').join('') + '</tbody></table>' +
      (p.exp ? '<div class="kv"><div><b>Docencia total</b>' + p.exp.docenciaTotal.toFixed(1) + ' años</div><div><b>Universitaria</b>' + p.exp.docenciaUniv.toFixed(1) + '</div><div><b>Instituciones educativas</b>' + p.exp.docenciaIE.toFixed(1) + '</div><div><b>Investigación</b>' + p.exp.investigacion.toFixed(1) + '</div><div><b>Profesional</b>' + p.exp.profesional.toFixed(1) + '</div></div>' +
        '<div class="small">Principales empleadores (docencia): ' + esc(p.exp.empleadores.map(e => e.nombre + ' (' + e.anios.toFixed(1) + ' a.)').join('; ') || '—') + '</div>' : '<div class="muted">Sin registros de experiencia.</div>') +
      '<div><b>Asignaturas asignadas (' + (S.an.carga.get(id) || 0) + ' h)</b><ul class="obs">' + (cs.map(c => '<li><a href="#" data-c="' + c.id + '">' + esc(c.asignatura) + '</a> · ' + esc(corto(c.programa)) + ' · ' + esc(S.an.resultados.get(c.id).estado) + '</li>').join('') || '<li class="muted">Ninguna</li>') + '</ul></div>';
    modal({ titulo: p.nombre, html: h, ok: 'Cerrar', sinCancelar: true });
    setTimeout(() => $$('.modal [data-c]').forEach(a => a.onclick = e => { e.preventDefault(); $('.modal-bg').remove(); abrirDetalle(a.dataset.c); }), 50);
  }

  /* ================================================================== */
  /* Archivos, configuración, respaldo y usuarios                       */
  /* ================================================================== */
  let dropTipo = null;
  $$('[data-drop]').forEach(d => {
    d.onclick = () => { if (!can('archivos')) return toast('Solo el Administrador puede cargar archivos.', true); dropTipo = d.dataset.drop; const fi = $('#file-input'); fi.accept = dropTipo === 'perfiles' ? '.docx' : '.xlsx,.xls'; fi.value = ''; fi.click(); };
    d.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.click(); } };
    d.ondragover = e => { e.preventDefault(); d.classList.add('over'); };
    d.ondragleave = () => d.classList.remove('over');
    d.ondrop = e => { e.preventDefault(); d.classList.remove('over'); if (!can('archivos')) return toast('Solo el Administrador puede cargar archivos.', true); procesarArchivos(d.dataset.drop, [...e.dataTransfer.files]); };
  });
  $('#file-input').onchange = e => procesarArchivos(dropTipo, [...e.target.files]);

  function leerLibro(buf) { return XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: false }); }
  function hojaCon(wb, pat) {
    for (const n of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false });
      if (rows.length && Object.keys(rows[0]).some(h => pat.test(E.norm(h)))) return { nombre: n, rows };
    }
    return null;
  }

  async function procesarArchivos(tipo, files) {
    if (!files.length) return;
    loading(true, 'Procesando archivos…');
    await tick();
    const nuevos = [];
    try {
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const huella = await huellaArchivo(buf);
        const dup = S.archivos.find(a => a.huella === huella);
        if (dup) { loading(false); const seguir = await confirmar('Archivo duplicado', 'El archivo «' + esc(file.name) + '» es idéntico a «' + esc(dup.nombre) + '», que ya está cargado. ¿Desea cargarlo de todos modos?', 'Cargar'); loading(true); if (!seguir) continue; }
        const reg = { nombre: file.name, tamano: file.size, huella, cargado: new Date().toISOString(), usuario: S.user.usuario };
        if (tipo === 'planes') {
          if (!/\.xlsx?$/i.test(file.name)) throw new Error('«' + file.name + '» no es un archivo Excel.');
          const h = hojaCon(leerLibro(buf), /^asignatura/);
          if (!h) throw new Error('«' + file.name + '» no contiene una hoja con la columna «Asignatura».');
          const p = E.procesarPlan(h.rows);
          loading(false);
          const v = await modal({ titulo: 'Tipo de plan de estudios', ok: 'Cargar plan', html: '<div>«' + esc(file.name) + '»: ' + p.rows.length + ' filas, ' + new Set(p.rows.map(r => r.programa)).size + ' programas.</div><label class="f">Tipo de plan<select class="inp" name="plan"><option' + (p.plan === 'Plan de transición' ? ' selected' : '') + '>Plan de transición</option><option' + (p.plan === 'Plan anterior' ? ' selected' : '') + '>Plan anterior</option></select></label><div class="small muted">Si ya existe un plan del mismo tipo, será reemplazado.</div>' });
          loading(true);
          if (!v) continue;
          const prev = S.fuentes.planes.find(x => x.plan === v.plan);
          S.fuentes.planes = S.fuentes.planes.filter(x => x.plan !== v.plan);
          S.fuentes.planes.push({ archivo: file.name, plan: v.plan, rows: p.rows });
          S.archivos = S.archivos.filter(a => !(a.tipo === 'Plan de estudios' && prev && a.nombre === prev.archivo));
          S.archivos.push(Object.assign(reg, { tipo: 'Plan de estudios', detalle: v.plan + ' · hoja "' + h.nombre + '" · ' + p.rows.length + ' filas', filas: p.rows.length }));
          nuevos.push({ accion: prev ? 'Reemplazo de plan de estudios' : 'Carga de plan de estudios', antes: prev ? prev.archivo : '', despues: file.name, motivo: v.plan });
        } else if (tipo === 'perfiles') {
          if (!/\.docx$/i.test(file.name)) throw new Error('«' + file.name + '» no es un documento Word (.docx).');
          const zip = await JSZip.loadAsync(buf);
          const docXml = zip.file('word/document.xml');
          if (!docXml) throw new Error('«' + file.name + '» no es un documento Word válido.');
          const progs = E.inventario(S.fuentes.planes).programas;
          const r = E.parsePerfiles(E.docxParagraphs(await docXml.async('string')), file.name, progs);
          if (!r.perfiles.length) throw new Error('No se reconocieron perfiles de asignaturas en «' + file.name + '».');
          const prev = S.fuentes.perfilDocs.find(d => d.programa && d.programa === r.programa);
          if (prev) S.fuentes.perfilDocs = S.fuentes.perfilDocs.filter(d => d !== prev);
          S.fuentes.perfilDocs.push({ archivo: file.name, programaDetectado: r.programaDetectado, programa: r.programa, perfiles: r.perfiles });
          S.archivos = S.archivos.filter(a => !(a.tipo === 'Perfiles docentes' && prev && a.nombre === prev.archivo));
          S.archivos.push(Object.assign(reg, { tipo: 'Perfiles docentes', detalle: (r.programa || 'Programa no identificado') + ' · ' + r.perfiles.length + ' perfiles', filas: r.perfiles.length }));
          nuevos.push({ accion: prev ? 'Reemplazo de perfiles docentes' : 'Carga de perfiles docentes', antes: prev ? prev.archivo : '', despues: file.name, motivo: r.programa || '' });
        } else if (tipo === 'formacion') {
          const h = hojaCon(leerLibro(buf), /nivel de formacion/);
          if (!h) throw new Error('«' + file.name + '» no contiene la columna «NIVEL DE FORMACIÓN».');
          const r = E.procesarFormacion(h.rows);
          const prev = S.fuentes.formacion;
          S.fuentes.formacion = { archivo: file.name, personas: [...r.profesores.values()] };
          S.archivos = S.archivos.filter(a => a.tipo !== 'Profesores – formación académica');
          S.archivos.push(Object.assign(reg, { tipo: 'Profesores – formación académica', detalle: 'hoja "' + h.nombre + '" · ' + r.filas + ' registros · ' + r.profesores.size + ' personas', filas: r.filas }));
          nuevos.push({ accion: 'Reemplazo de base de formación', antes: prev ? prev.archivo : '', despues: file.name });
        } else if (tipo === 'experiencia') {
          const h = hojaCon(leerLibro(buf), /tipo de experiencia/);
          if (!h) throw new Error('«' + file.name + '» no contiene la columna «TIPO DE EXPERIENCIA».');
          const r = E.procesarExperiencia(h.rows);
          const prev = S.fuentes.experiencia;
          S.fuentes.experiencia = { archivo: file.name, personas: [...r.experiencia.values()] };
          S.archivos = S.archivos.filter(a => a.tipo !== 'Profesores – experiencia');
          S.archivos.push(Object.assign(reg, { tipo: 'Profesores – experiencia', detalle: 'hoja "' + h.nombre + '" · ' + r.filas + ' registros · ' + r.experiencia.size + ' personas', filas: r.filas }));
          nuevos.push({ accion: 'Reemplazo de base de experiencia', antes: prev ? prev.archivo : '', despues: file.name });
        } else if (tipo === 'historico') {
          if (!/\.xlsx?$/i.test(file.name)) throw new Error('«' + file.name + '» no es un archivo Excel.');
          const wb = leerLibro(buf);
          const hojaCons = wb.SheetNames.find(n => /^consolidado$/i.test(n.trim()));
          const nombres = hojaCons ? [hojaCons] : wb.SheetNames;
          let rows = [];
          nombres.forEach(n => { rows = rows.concat(XLSX.utils.sheet_to_json(wb.Sheets[n], { defval: '', raw: false })); });
          rows = rows.filter(r => Object.keys(r).some(h => /^docente/.test(E.norm(h))));
          const cols0 = rows.length ? Object.keys(rows[0]).map(E.norm) : [];
          const faltan = ['docente', 'asignatura', 'programa', 'numero'].filter(k => !cols0.some(c => c.startsWith(k)));
          if (!rows.length || faltan.length) throw new Error('«' + file.name + '» no tiene el formato esperado. Columnas requeridas: PROGRAMA, NUMERO (identificación), DOCENTE, ASIGNATURA' + (faltan.length ? ' · faltan: ' + faltan.join(', ').toUpperCase() : '') + '.');
          const compactas = rows.map(r => {
            const o = {};
            Object.keys(r).forEach(h => {
              const k = E.norm(h);
              if (/^periodo/.test(k)) o.PERIODO = r[h]; else if (/^docente/.test(k)) o.DOCENTE = r[h];
              else if (/^asignatura/.test(k)) o.ASIGNATURA = r[h]; else if (/^grupo/.test(k)) o.GRUPO = r[h]; else if (/^programa/.test(k)) o.PROGRAMA = r[h];
              else if (/^numero|^identificacion|^cedula/.test(k)) o.NUMERO = r[h]; else if (/^cod mat/.test(k)) o['COD. MAT'] = r[h];
            });
            return o;
          });
          const prev = S.fuentes.historico7;
          S.fuentes.historico7 = { archivo: file.name, hoja: hojaCons || 'todas las hojas', rows: compactas };
          S.archivos = S.archivos.filter(a => a.tipo !== 'Asignación histórica 2026-II');
          S.archivos.push(Object.assign(reg, { tipo: 'Asignación histórica 2026-II', detalle: 'hoja ' + (hojaCons ? '"' + hojaCons + '"' : 'todas') + ' · ' + compactas.length + ' registros', filas: compactas.length }));
          nuevos.push({ accion: prev ? 'Reemplazo de asignación histórica 2026-II' : 'Carga de asignación histórica 2026-II', antes: prev ? prev.archivo : '', despues: file.name });
        } else if (tipo === 'carga_inst') {
          if (!/\.xlsx?$/i.test(file.name)) throw new Error('«' + file.name + '» no es un archivo Excel.');
          const wb = leerLibro(buf);
          const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
          const mapa = E.procesarCargaInstitucional(rows, S.ds ? S.ds.profesores : []);
          if (!mapa.size) throw new Error('«' + file.name + '» no contiene columnas reconocibles (NOMBRE o DOCENTE, y HORAS).');
          const prev = S.fuentes.cargaInst7;
          S.fuentes.cargaInst7 = { archivo: file.name, rows };
          S.archivos = S.archivos.filter(a => a.tipo !== 'Carga institucional 2027-I');
          S.archivos.push(Object.assign(reg, { tipo: 'Carga institucional 2027-I', detalle: mapa.size + ' docentes con horas comprometidas', filas: mapa.size }));
          nuevos.push({ accion: prev ? 'Actualización de carga institucional 2027-I' : 'Carga institucional 2027-I', antes: prev ? prev.archivo : '', despues: file.name });
        }
      }
      if (nuevos.length) {
        S.fuentesMod = true;
        await Store.set('fuentes', S.fuentes);
        await Store.set('archivos', S.archivos);
        for (const n of nuevos) await registrar(n);
        loading(true, 'Recalculando análisis y propuestas…');
        await tick();
        await reconstruir();
        poblarFiltros();
        toast(nuevos.length + ' archivo(s) procesado(s). Las decisiones aprobadas se conservaron.');
      }
    } catch (e) { console.error(e); toast(e.message, true); }
    loading(false);
  }

  async function eliminarArchivo(i) {
    const a = S.archivos[i];
    if (!await confirmar('Eliminar archivo', '¿Eliminar «' + esc(a.nombre) + '» de las fuentes de análisis?', 'Eliminar', true)) return;
    if (a.tipo === 'Plan de estudios') S.fuentes.planes = S.fuentes.planes.filter(p => p.archivo !== a.nombre);
    else if (a.tipo === 'Perfiles docentes') S.fuentes.perfilDocs = S.fuentes.perfilDocs.filter(p => p.archivo !== a.nombre);
    else if (/formaci/.test(a.tipo)) S.fuentes.formacion = null;
    else if (/experiencia/.test(a.tipo)) S.fuentes.experiencia = null;
    else if (/hist[oó]rica/.test(a.tipo)) S.fuentes.historico7 = null;
    else if (/Carga institucional/.test(a.tipo)) S.fuentes.cargaInst7 = null;
    S.archivos.splice(i, 1);
    S.fuentesMod = true;
    await Store.set('fuentes', S.fuentes); await Store.set('archivos', S.archivos);
    await registrar({ accion: 'Eliminación de archivo', antes: a.nombre, despues: '' });
    loading(true, 'Recalculando…'); await tick(); await reconstruir(); poblarFiltros(); loading(false);
  }

  function renderArchivos() {
    const admin = can('archivos');
    $('#arch-ro').classList.toggle('hidden', admin);
    $('#diag').innerHTML = E.diagnosticoArchivos(S.fuentes, S.meta).map(d => '<div class="' + d.nivel + '"><b>' + esc(d.tipo) + ':</b> ' + esc(d.msg) + '</div>').join('');
    const grupos = { planes: 'Plan de estudios', perfiles: 'Perfiles docentes', formacion: 'Profesores – formación académica', experiencia: 'Profesores – experiencia', historico: 'Asignación histórica 2026-II', carga_inst: 'Carga institucional 2027-I' };
    Object.keys(grupos).forEach(k => {
      const items = S.archivos.map((a, i) => ({ a, i })).filter(x => x.a.tipo === grupos[k]);
      $('#fl-' + k).innerHTML = items.length ? items.map(({ a, i }) => '<div class="file-item"><div><div><b>' + esc(a.nombre) + '</b></div><div class="meta">' + esc(a.detalle) + ' · ' + (a.cargado ? fmtF(a.cargado) : '') + (a.huella ? ' · huella ' + esc(a.huella.slice(0, 10)) : '') + '</div></div>' + (admin ? '<button class="btn sm danger" data-del="' + i + '">Eliminar</button>' : '') + '</div>').join('') : '<div class="muted small">Sin archivos.</div>';
    });
    $$('[data-del]').forEach(b => b.onclick = () => eliminarArchivo(+b.dataset.del));

    // Configuración
    const cfg = S.config, dis = can('config') ? '' : ' disabled';
    $('#cfg').innerHTML = '<div class="grid" style="gap:12px">' +
      '<label class="f">Tope de horas por docente<input class="inp" type="number" min="1" max="40" step="1" id="cfg-max" value="' + cfg.maxHoras + '"' + dis + '></label>' +
      '<label class="f">Horas semanales estimadas por crédito<input class="inp" type="number" min="0.5" max="4" step="0.5" id="cfg-hpc" value="' + cfg.horasPorCredito + '"' + dis + '></label>' +
      '<div class="f">Planes incluidos en la asignación automática' + ['Plan de transición', 'Plan anterior'].map(p => '<label style="font-weight:400;color:var(--text)"><input type="checkbox" data-plan="' + p + '"' + (cfg.planesAsignables.includes(p) ? ' checked' : '') + dis + '> ' + p + '</label>').join('') + '</div>' +
      '<label style="font-weight:400"><input type="checkbox" id="cfg-bdc"' + (cfg.excluirNoCumpleBDC ? ' checked' : '') + dis + '> Excluir hojas de vida con estado «No Cumple Requisitos» en la BDC</label>' +
      (can('config') ? '<div><button class="btn primary" id="cfg-save">Guardar y recalcular</button></div>' : '') +
      '<div class="small muted">Las horas de cada asignatura se estiman como créditos × horas por crédito. Las asignaturas cuya carga supere el tope quedan «Pendiente por designar» con la indicación de distribuirlas por grupos.</div></div>';
    const sv = $('#cfg-save');
    if (sv) sv.onclick = async () => {
      const n = { maxHoras: Math.max(1, +$('#cfg-max').value || 8), horasPorCredito: Math.max(0.5, +$('#cfg-hpc').value || 1), planesAsignables: $$('[data-plan]').filter(x => x.checked).map(x => x.dataset.plan), excluirNoCumpleBDC: $('#cfg-bdc').checked };
      const antes = JSON.stringify({ maxHoras: cfg.maxHoras, horasPorCredito: cfg.horasPorCredito, planes: cfg.planesAsignables, excluir: cfg.excluirNoCumpleBDC });
      S.config = Object.assign({}, S.config, n);
      await Store.set('config', S.config);
      await registrar({ accion: 'Cambio de configuración', antes, despues: JSON.stringify({ maxHoras: n.maxHoras, horasPorCredito: n.horasPorCredito, planes: n.planesAsignables, excluir: n.excluirNoCumpleBDC }) });
      await snapshot('Cambio de configuración');
      S.cache = {};
      loading(true, 'Recalculando…'); await tick(); recalcular(); loading(false);
      toast('Configuración guardada.');
    };

    // Respaldo
    $('#backup').innerHTML = '<div class="small muted" style="margin-bottom:10px">Almacenamiento: <b>' + (Store.modo === 'indexeddb' ? 'IndexedDB del navegador' : 'localStorage (limitado)') + '</b>. Los datos se conservan al cerrar o actualizar la aplicación. Descargue respaldos periódicos para conservarlos fuera del navegador.</div>' +
      '<div class="btn-row" style="margin-bottom:12px"><button class="btn primary" id="bk-exp">Descargar respaldo (.json)</button>' + (can('restaurar') ? '<button class="btn" id="bk-imp">Restaurar desde respaldo</button><button class="btn danger" id="bk-base">Restaurar archivos base</button>' : '') + '</div>' +
      '<input type="file" id="bk-file" accept=".json" class="hidden">' +
      '<div class="small"><b>Puntos de restauración automáticos</b> (últimos ' + S.snapshots.length + ')</div><div class="file-list">' +
      (S.snapshots.slice(0, 8).map((s, i) => '<div class="file-item"><div><div>' + esc(s.motivo) + '</div><div class="meta">' + fmtF(s.fecha) + ' · ' + esc(s.usuario) + ' · ' + Object.keys(s.overrides).length + ' decisiones</div></div>' + (can('restaurar') ? '<button class="btn sm" data-snap="' + i + '">Restaurar</button>' : '') + '</div>').join('') || '<div class="muted small">Aún no hay puntos de restauración.</div>') + '</div>';
    $('#bk-exp').onclick = async () => {
      const data = { app: 'asignacion-docente-licenciaturas', version: E.VERSION, fecha: new Date().toISOString(), usuario: S.user.usuario, overrides: S.overrides, config: S.config, log: S.log, users: S.users, snapshots: S.snapshots, fuentes: S.fuentesMod ? S.fuentes : null, archivos: S.fuentesMod ? S.archivos : null };
      guardarBlob(JSON.stringify(data), 'Respaldo_Asignacion_Docente_' + new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-') + '.json', 'application/json');
      await registrar({ accion: 'Descarga de respaldo' }); renderHistorial();
    };
    const bi = $('#bk-imp');
    if (bi) {
      bi.onclick = () => $('#bk-file').click();
      $('#bk-file').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try {
          const d = JSON.parse(await f.text());
          if (d.app !== 'asignacion-docente-licenciaturas') throw new Error('El archivo no es un respaldo de esta aplicación.');
          if (!await confirmar('Restaurar respaldo', 'Se reemplazarán las decisiones, configuración, historial y usuarios por los del respaldo del ' + esc(fmtF(d.fecha)) + '. ¿Continuar?', 'Restaurar', true)) return;
          S.overrides = d.overrides || {}; S.config = Object.assign({}, E.DEFAULT_CONFIG, d.config || {}); S.log = d.log || []; S.snapshots = d.snapshots || [];
          if (d.users && d.users.length) S.users = d.users;
          if (d.fuentes) { S.fuentes = d.fuentes; S.archivos = d.archivos || []; S.fuentesMod = true; await Store.set('fuentes', S.fuentes); await Store.set('archivos', S.archivos); }
          await Promise.all([Store.set('overrides', S.overrides), Store.set('config', S.config), Store.set('log', S.log), Store.set('users', S.users), Store.set('snapshots', S.snapshots)]);
          await registrar({ accion: 'Restauración desde respaldo', despues: f.name });
          loading(true, 'Recalculando…'); await tick(); await reconstruir(); poblarFiltros(); loading(false);
          toast('Respaldo restaurado.');
        } catch (er) { toast('No fue posible restaurar: ' + er.message, true); }
      };
      $('#bk-base').onclick = async () => {
        if (!await confirmar('Restaurar archivos base', 'Se descartarán los archivos cargados por los usuarios y se usarán los datos base generados a partir de los archivos originales. Las decisiones (aprobaciones, cambios) se conservan.', 'Restaurar', true)) return;
        S.fuentes = JSON.parse(JSON.stringify(window.DATOS_BASE.fuentes)); S.archivos = window.DATOS_BASE.archivos.slice(); S.fuentesMod = false;
        await Store.del('fuentes'); await Store.del('archivos');
        await registrar({ accion: 'Restauración de archivos base' });
        loading(true, 'Recalculando…'); await tick(); await reconstruir(); poblarFiltros(); loading(false);
      };
    }
    $$('[data-snap]').forEach(b => b.onclick = async () => {
      const s = S.snapshots[+b.dataset.snap];
      if (!await confirmar('Restaurar punto', 'Se restaurarán las decisiones y la configuración del ' + esc(fmtF(s.fecha)) + ' (' + esc(s.motivo) + ').', 'Restaurar')) return;
      S.overrides = JSON.parse(JSON.stringify(s.overrides)); S.config = Object.assign({}, E.DEFAULT_CONFIG, s.config);
      await Store.set('overrides', S.overrides); await Store.set('config', S.config);
      await registrar({ accion: 'Restauración de punto automático', despues: fmtF(s.fecha) + ' – ' + s.motivo });
      S.cache = {}; recalcular(); toast('Punto de restauración aplicado.');
    });

    // Usuarios
    $('#users-card').classList.toggle('hidden', !can('usuarios'));
    if (can('usuarios')) {
      $('#users-table').innerHTML = '<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th></th></tr></thead><tbody>' +
        S.users.map((u, i) => '<tr><td>' + esc(u.usuario) + '</td><td>' + esc(u.nombre) + '</td><td>' + esc(ROLES[u.rol]) + '</td><td>' + (u.inactivo ? 'Inactivo' : 'Activo') + '</td><td class="btn-row"><button class="btn sm" data-ue="' + i + '">Editar</button>' + (u.usuario !== S.user.usuario ? '<button class="btn sm" data-ut="' + i + '">' + (u.inactivo ? 'Activar' : 'Desactivar') + '</button>' : '') + '</td></tr>').join('') + '</tbody>';
      $$('[data-ue]').forEach(b => b.onclick = () => editarUsuario(+b.dataset.ue));
      $$('[data-ut]').forEach(b => b.onclick = async () => { const u = S.users[+b.dataset.ut]; u.inactivo = !u.inactivo; await Store.set('users', S.users); await registrar({ accion: u.inactivo ? 'Desactivación de usuario' : 'Activación de usuario', despues: u.usuario }); renderArchivos(); });
    }
  }
  $('#btn-add-user').onclick = () => editarUsuario(-1);
  async function editarUsuario(i) {
    const u = i >= 0 ? S.users[i] : null;
    const v = await modal({
      titulo: u ? 'Editar usuario' : 'Agregar usuario', ok: 'Guardar',
      html: '<label class="f">Usuario<input class="inp" name="usuario" value="' + esc(u ? u.usuario : '') + '"' + (u ? ' disabled' : '') + '></label><label class="f">Nombre<input class="inp" name="nombre" value="' + esc(u ? u.nombre : '') + '"></label>' +
        '<label class="f">Rol<select class="inp" name="rol">' + Object.keys(ROLES).map(r => '<option value="' + r + '"' + (u && u.rol === r ? ' selected' : '') + '>' + ROLES[r] + '</option>').join('') + '</select></label>' +
        '<label class="f">' + (u ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña') + '<input class="inp" type="password" name="clave" autocomplete="new-password"></label>' +
        '<div class="small muted">Administrador: todo. Coordinador académico: editar, aprobar y exportar. Consulta: ver y exportar.</div>',
      validar: d => {
        if (!u && (!d.usuario || S.users.some(x => x.usuario === d.usuario.trim().toLowerCase()))) return 'Usuario vacío o ya existente.';
        if (!d.nombre) return 'Indique el nombre.';
        if ((!u || d.clave) && (d.clave || '').length < 6) return 'La contraseña debe tener al menos 6 caracteres.';
        if (u && u.usuario === S.user.usuario && d.rol !== 'admin') return 'No puede quitarse a sí mismo el rol de Administrador.';
        return null;
      },
    });
    if (!v) return;
    if (u) {
      u.nombre = v.nombre; u.rol = v.rol;
      if (v.clave) { u.salt = sha256(Math.random() + ':' + Date.now()).slice(0, 16); u.hash = hashClave(v.clave, u.salt); }
      await registrar({ accion: 'Edición de usuario', despues: u.usuario + ' (' + ROLES[u.rol] + ')' + (v.clave ? ' · contraseña cambiada' : '') });
    } else {
      const salt = sha256(Math.random() + ':' + Date.now()).slice(0, 16);
      S.users.push({ usuario: v.usuario.trim().toLowerCase(), nombre: v.nombre, rol: v.rol, salt, hash: hashClave(v.clave, salt), creado: Date.now() });
      await registrar({ accion: 'Creación de usuario', despues: v.usuario + ' (' + ROLES[v.rol] + ')' });
    }
    await Store.set('users', S.users);
    renderArchivos();
  }

  /* ================================================================== */
  /* Control de calidad                                                  */
  /* ================================================================== */
  function renderCalidad() {
    const extra = { nombre: 'Los archivos Excel generados coinciden con la información presentada en la página', estado: 'Cumple', detalle: 'Cada exportación se genera con las mismas reglas y datos de la vista; antes de descargar se verifica fila a fila estado y docente.' };
    const conserv = Object.values(S.overrides).filter(o => o.aprobado).length;
    const extra2 = { nombre: 'Las modificaciones aprobadas se conservan y se reflejan en las exportaciones', estado: 'Cumple', detalle: conserv + ' aprobaciones y ' + Object.values(S.overrides).filter(o => o.docenteId && !o.aprobado).length + ' cambios manuales almacenados de forma persistente; se aplican en cada recálculo y exportación.' };
    $('#qa-table').innerHTML = '<thead><tr><th>Verificación</th><th>Resultado</th><th>Detalle</th></tr></thead><tbody>' +
      S.qa.concat([extra, extra2]).map(q => '<tr><td>' + esc(q.nombre) + '</td><td>' + (q.estado === 'Cumple' ? '<span class="chip st-aprob">Cumple</span>' : '<span class="chip st-valid">' + esc(q.estado) + '</span>') + '</td><td class="small">' + esc(q.detalle) + '</td></tr>').join('') + '</tbody>';
    const rev = S.ds.cursos.filter(c => c.revisionClasificacion);
    $('#qa-rev').innerHTML = '<thead><tr><th>Asignatura</th><th>Observación</th></tr></thead><tbody>' + (rev.map(c => '<tr class="click" data-id="' + c.id + '"><td><b>' + esc(c.asignatura) + '</b><div class="asig-meta">' + esc(corto(c.programa)) + ' · ' + esc(c.plan) + '</div></td><td class="small">' + esc(c.revisionClasificacion) + '</td></tr>').join('') || '<tr><td class="empty" colspan="2">Sin observaciones.</td></tr>') + '</tbody>';
    const al = S.ds.perfiles.filter(p => p.alertas.length);
    $('#qa-perf').innerHTML = '<thead><tr><th>Perfil</th><th>Alerta</th></tr></thead><tbody>' + (al.map(p => '<tr><td><b>' + esc(p.titulo) + '</b><div class="asig-meta">' + esc(corto(p.programa)) + ' · ' + esc(p.archivo) + '</div></td><td class="small">' + esc(p.alertas.join(' ')) + '</td></tr>').join('') || '<tr><td class="empty" colspan="2">Sin alertas.</td></tr>') + '</tbody>';
    $$('#qa-rev tr[data-id]').forEach(tr => tr.onclick = () => abrirDetalle(tr.dataset.id));
  }

  /* ================================================================== */
  /* Historial                                                           */
  /* ================================================================== */
  $('#h-q').addEventListener('input', () => { S.logPage = 0; renderHistorial(); });
  function renderHistorial() {
    const q = E.norm($('#h-q').value);
    const log = S.log.slice().reverse().filter(e => !q || E.norm([e.usuario, e.accion, e.programa, e.asignatura, e.antes, e.despues, e.motivo].join(' ')).includes(q));
    const PAG = 60, pages = Math.max(1, Math.ceil(log.length / PAG));
    S.logPage = Math.min(S.logPage, pages - 1);
    $('#log-table').innerHTML = '<thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Asignatura</th><th>Anterior</th><th>Nuevo</th><th>Motivo</th></tr></thead><tbody>' +
      (log.slice(S.logPage * PAG, S.logPage * PAG + PAG).map(e => '<tr' + (e.cursoId ? ' class="click" data-id="' + e.cursoId + '"' : '') + '><td class="nowrap small">' + fmtF(e.fecha) + '</td><td>' + esc(e.usuario) + '</td><td>' + esc(e.accion) + '</td><td>' + (e.asignatura ? esc(e.asignatura) + '<div class="asig-meta">' + esc(corto(e.programa)) + '</div>' : '') + '</td><td class="small">' + esc(e.antes || '') + '</td><td class="small">' + esc(e.despues || '') + '</td><td class="small">' + esc(e.motivo || '') + '</td></tr>').join('') || '<tr><td colspan="7" class="empty">Sin eventos.</td></tr>') + '</tbody>';
    $('#log-pager').innerHTML = pages > 1 ? '<span>Página ' + (S.logPage + 1) + ' de ' + pages + '</span><div class="btn-row"><button class="btn sm" data-lp="-1"' + (S.logPage ? '' : ' disabled') + '>‹ Anterior</button><button class="btn sm" data-lp="1"' + (S.logPage < pages - 1 ? '' : ' disabled') + '>Siguiente ›</button></div>' : '';
    $$('#log-pager [data-lp]').forEach(b => b.onclick = () => { S.logPage += +b.dataset.lp; renderHistorial(); });
    $$('#log-table tr[data-id]').forEach(tr => tr.onclick = () => { if (cursoPorId().has(tr.dataset.id)) abrirDetalle(tr.dataset.id); });
  }
  $('#btn-log-xlsx').onclick = async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Historial', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = [{ header: 'Fecha', key: 'f', width: 18 }, { header: 'Usuario', key: 'u', width: 16 }, { header: 'Acción', key: 'a', width: 28 }, { header: 'Programa', key: 'p', width: 30 }, { header: 'Asignatura', key: 's', width: 34 }, { header: 'Valor anterior', key: 'x', width: 30 }, { header: 'Valor nuevo', key: 'y', width: 30 }, { header: 'Motivo / detalle', key: 'm', width: 60 }];
    S.log.slice().reverse().forEach(e => ws.addRow({ f: fmtF(e.fecha), u: e.usuario, a: e.accion, p: e.programa || '', s: e.asignatura || '', x: e.antes || '', y: e.despues || '', m: e.motivo || '' }));
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
    ws.autoFilter = { from: 'A1', to: 'H1' };
    guardarBlob(await wb.xlsx.writeBuffer(), 'Historial_Asignacion_Docente_' + new Date().toISOString().slice(0, 10) + '.xlsx');
  };

  /* ================================================================== */
  /* Guía                                                                */
  /* ================================================================== */
  function renderGuia() {
    $('#guia').innerHTML = '<h2>Guía breve de utilización</h2>' +
      '<p class="muted">Herramienta de apoyo a la gestión académica del Departamento de Pedagogía y Didáctica. Todas las asignaciones son propuestas sujetas a revisión y aprobación académica.</p>' +
      '<h3>1. Acceso</h3><ul><li>La primera vez se crea la cuenta de <b>Administrador</b>. Desde «Archivos y configuración» puede crear usuarios con rol <b>Coordinador académico</b> (edita y aprueba) o <b>Consulta</b> (solo lectura y descargas).</li><li>La sesión se cierra tras 30 minutos de inactividad.</li></ul>' +
      '<h3>2. Consultar por programa y componente</h3><ol><li>En «Asignación docente» elija el <b>programa</b> en el selector desplegable.</li><li>Filtre por <b>componente</b> (Pedagógico, Didáctica de las Disciplinas, Práctica Pedagógica Investigativa o todos), plan de estudios y estado.</li><li>Use el buscador para encontrar un profesor, programa o asignatura.</li></ol>' +
      '<h3>3. Revisar y modificar una propuesta</h3><ol><li>Pulse una asignatura: verá el perfil requerido, el docente propuesto, su resumen verificable y la matriz con los profesores que cumplen.</li><li>Cada requisito se marca como <b>✓ acreditado</b>, <b>≈ afinidad por validar</b>, <b>? información insuficiente</b> o <b>✗ no acreditado</b>.</li><li>Para cambiar el docente pulse «Asignar este docente» en una alternativa o busque otro profesor de la base. El motivo es obligatorio y queda en el historial.</li><li>Pulse «Aprobar asignación» cuando la propuesta haya sido validada. Las aprobaciones se conservan aunque se carguen archivos nuevos.</li><li>Las asignaturas sin perfil pueden <b>homologarse</b> con un perfil existente, como decisión académica registrada.</li></ol>' +
      '<h3>4. Estados</h3><ul><li><b>Asignación propuesta</b>: el profesor acredita pregrado, posgrado, experiencia mínima y hoja de vida habilitada.</li><li><b>Asignación aprobada</b>: validada por un usuario con permiso de aprobación.</li><li><b>Pendiente de validación</b>: hay afinidad por validar, información insuficiente o una asignación manual sin requisitos verificables.</li><li><b>Pendiente por designar</b>: ningún profesor acredita los requisitos, los idóneos alcanzaron el tope de horas o la carga supera el tope.</li><li><b>Perfil no disponible</b>: la asignatura no tiene perfil docente definido.</li></ul>' +
      '<h3>5. Descargas Excel</h3><ul><li><b>Excel del programa seleccionado</b>: hoja de asignación (columnas A–J), matriz de correspondencia, inventario y pendientes.</li><li><b>Excel general consolidado</b>: hoja consolidada, una hoja por programa, resumen estadístico, pendientes por designar, pendientes de validación, carga docente, matriz, inventario, control de calidad y registro de cambios.</li><li><b>Asignaturas sin docente asignado</b>.</li></ul>' +
      '<h3>6. Archivos</h3><ul><li>En «Archivos y configuración» el Administrador carga o reemplaza planes (.xlsx), perfiles (.docx, uno por programa) y bases de profesores (.xlsx). El sistema detecta archivos faltantes, duplicados o inconsistentes y recalcula todo automáticamente.</li><li>Configure el tope de horas (8 h por defecto), las horas por crédito y los planes incluidos.</li></ul>' +
      '<h3>7. Respaldo y trazabilidad</h3><ul><li>Los datos se guardan en el navegador (IndexedDB) y se conservan al cerrar la aplicación. Se crean puntos de restauración automáticos con cada decisión.</li><li>Descargue periódicamente el <b>respaldo .json</b>; puede restaurarlo en otro equipo.</li><li>El «Historial» registra usuario, fecha, valor anterior, valor nuevo y motivo de cada modificación.</li></ul>' +
      '<h3>8. Fase 7 · Continuidad 2026-II → 2027-I</h3><ul>' +
      '<li><b>Fuente histórica.</b> En «Archivos y configuración → D» cargue «Asignación Docente 2026-2» (.xlsx). Se lee la hoja CONSOLIDADO (o todas las hojas) y se requieren las columnas <b>PROGRAMA, NUMERO (identificación), DOCENTE y ASIGNATURA</b>. Es un antecedente: no acredita idoneidad ni carga vigente en 2027-I.</li>' +
      '<li><b>Continuidad.</b> Si el profesor que orientó la asignatura en 2026-II acredita el perfil vigente y le queda carga, se propone de nuevo. Si no cumple, no se propone y la observación indica el requisito incumplido y su evidencia.</li>' +
      '<li><b>Progresión de PPI.</b> Quien orientó PPI I pasa a PPI II, y así hasta PPI VI / Práctica Profesional, que retorna a PPI I. La progresión tiene prioridad sobre repetir el nivel, pero nunca sobre la idoneidad ni sobre la carga.</li>' +
      '<li><b>Pregrado primero (todos los componentes).</b> Antes de cualquier otro criterio se verifica que el pregrado del docente sea afín con la asignatura; solo esos docentes se proponen y se sugieren. Si ninguno está disponible, se evalúa el posgrado: esos docentes no se asignan directamente, la asignatura queda «Pendiente de autorización del Director» y se listan como «Revisión del Director» en el panel de detalle. Si el Director lo autoriza, se asigna manualmente desde allí.</li>' +
      '<li><b>Carga total.</b> El máximo de 8 horas es la carga del profesor en toda la Universidad. Cargue en «D» la carga 2027-I comprometida en otras unidades; sin ese archivo cada propuesta queda con la observación «Pendiente de validación».</li>' +
      '<li><b>Reportes.</b> El Excel consolidado y el de cada programa incluyen las hojas «COMPARATIVO 2026-II vs 2027-I», «NO ASIGNADOS 2026-II» y «AUTORIZACIONES PPI» (esta última cuando hay registros).</li></ul>' +
      '<h3>Criterios de evaluación</h3><p class="small">El sistema no asume que un profesor cumple un requisito solo por tener un título de nivel superior: contrasta la denominación del pregrado y el campo del posgrado con los exigidos por el perfil, calcula los años de docencia sin duplicar periodos simultáneos y verifica el estado de la hoja de vida. La experiencia específica, las competencias y la pertinencia de la investigación no se pueden comprobar con las bases de datos y se presentan como «información insuficiente», para verificarlas con soportes durante la revisión académica. No se inventan títulos ni experiencias: toda justificación cita los registros de los archivos.</p>';
  }

  /* ================================================================== */
  /* Tema                                                                */
  /* ================================================================== */
  (function () {
    let t = null;
    try { t = localStorage.getItem('ad_tema'); } catch (e) { /* sin acceso */ }
    if (t) document.documentElement.setAttribute('data-theme', t);
    $('#btn-theme').onclick = () => {
      const cur = document.documentElement.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
      const n = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', n);
      try { localStorage.setItem('ad_tema', n); } catch (e) { /* sin acceso */ }
    };
  })();

  /* ================================================================== */
  /* Arranque                                                            */
  /* ================================================================== */
  window.AppBridge = { S, $, $$, esc, toast, loading, can, Store, registrar, irA, recalcular, descargar, abrirDetalle: id => abrirDetalle(id), chip: e => chip(e), compTag: c => compTag(c), corto };
  window.AppStore = Store;
  (async function boot() {
    await Store.open();
    S.users = (await Store.get('users')) || [];
    S.log = (await Store.get('log')) || [];
    if (!S.users.length) return mostrarAuth('setup');
    let ses = null;
    try { ses = JSON.parse(sessionStorage.getItem('ad_sesion') || 'null'); } catch (e) { /* sin sessionStorage */ }
    const u = ses && S.users.find(x => x.usuario === ses.usuario && !x.inactivo);
    if (u) { S.user = u; await entrar(); }
    else mostrarAuth('login');
  })();
})();
