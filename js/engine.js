/*
 * Motor de análisis y asignación docente – Licenciaturas
 * Departamento de Pedagogía y Didáctica
 *
 * Funciona en el navegador (window.Engine) y en Node (require).
 * Fases: (1) clasificación de asignaturas, (2) extracción y contraste de perfiles,
 * (3) propuesta de asignación con tope de carga, (6) control de calidad.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = '1.0.0';

  const COMP = {
    PED: 'Pedagógico',
    DID: 'Didáctica de las Disciplinas',
    PPI: 'Práctica Pedagógica Investigativa',
  };
  const COMP_ORDEN = [COMP.PED, COMP.DID, COMP.PPI];

  const EST = {
    PROP: 'Asignación propuesta',
    APROB: 'Asignación aprobada',
    PEND: 'Pendiente por designar',
    SINP: 'Perfil no disponible',
    VALID: 'Pendiente de validación',
    VALDOC: 'Pendiente de validación documental',
    DIR: 'Pendiente de autorización del Director',
  };
  const ESTADOS = [EST.PROP, EST.APROB, EST.PEND, EST.SINP, EST.VALID, EST.VALDOC, EST.DIR];

  // Valoración de cada requisito
  const R = { A: 'Acreditado', F: 'Acreditado por afinidad (validar)', C: 'Acreditado por vía alterna', N: 'No acreditado', I: 'Información insuficiente' };

  const DEFAULT_CONFIG = {
    maxHoras: 8,               // tope de horas por docente
    horasPorCredito: 1,        // horas semanales estimadas por crédito
    planesAsignables: ['Plan de transición', 'Plan anterior'],
    excluirNoCumpleBDC: true,  // excluir hojas de vida con estado "No Cumple Requisitos"
    maxAlternativas: 5,
  };

  /* ------------------------------------------------------------------ */
  /* Utilidades de texto                                                 */
  /* ------------------------------------------------------------------ */
  function deacc(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function norm(s) {
    return deacc(s).toLowerCase().replace(/[^a-z0-9ñ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function clean(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  }
  const STOP = new Set('de del la las el los y e en o u a al con para por su sus un una the of and in to as'.split(' '));
  const TITLE_NOISE = new Set(('titulo titulos licenciado licenciada licenciados licenciadas licenciatura licenciaturas profesional profesionales ' +
    'magister magistra maestria maestrias master maestro maestra doctor doctora doctorado doctorados especialista especialistas especializacion ' +
    'especializaciones phd enfasis mencion grado programa denominacion denominaciones').split(' '));

  function stem(w) {
    if (w.length > 4 && w.endsWith('es') && !/[aeiou]es$/.test(w)) w = w.slice(0, -2);
    else if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
    if (w.length > 3 && /[aeo]$/.test(w)) w = w.slice(0, -1);
    return w.slice(0, 7);
  }
  function tokens(s, keepNoise) {
    return norm(s).split(' ').filter(w => w && !STOP.has(w) && (keepNoise || !TITLE_NOISE.has(w)) && !/^\d+$/.test(w)).map(stem);
  }
  function tokMatch(a, b) {
    if (a === b) return true;
    const m = Math.min(a.length, b.length);
    return m >= 4 && (a.startsWith(b) || b.startsWith(a));
  }
  // ¿todos los tokens requeridos están en el título?
  function subset(req, have) {
    if (!req.length) return false;
    return req.every(r => have.some(h => tokMatch(r, h)));
  }
  function overlap(req, have) {
    return req.filter(r => have.some(h => tokMatch(r, h))).length;
  }
  // tokens genéricos que no indican campo disciplinar específico
  const GENERIC = new Set(tokens('educación pedagogía ciencia ciencias básica área áreas estudios formación docente docencia general enseñanza aprendizaje investigación desarrollo humano gestión', true));
  function specific(toks) { return toks.filter(t => !GENERIC.has(t)); }

  // Expansiones de campos amplios (solo para vías alternas "profesionales de ...")
  const EXPAND = {
    'ciencias naturales': ['Biología', 'Química', 'Física', 'Ciencias Naturales', 'Microbiología', 'Ecología'],
    'ciencias sociales': ['Sociología', 'Antropología', 'Historia', 'Geografía', 'Ciencia Política', 'Trabajo Social', 'Ciencias Sociales'],
  };

  function hash(s) { // FNV-1a 32 bits
    let h = 0x811c9dc5;
    s = String(s);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return ('0000000' + h.toString(16)).slice(-8);
  }

  const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

  /* ---- Fase 7: utilidades de PPI, programa e historial 2026-II ---- */
  // Nivel (1–6) de una Práctica Pedagógica Investigativa; «Práctica Profesional» sin número equivale a VI.
  function nivelPPI(nombre) {
    const n = norm(nombre);
    if (/^practica profesional(\s|$)/.test(n)) {
      const m = n.match(/^practica profesional (i|ii|iii|iv|v|vi)(\s|$)/);
      return m ? ROMAN.indexOf(m[1]) + 1 : 6;
    }
    const m = n.match(/^practica pedagogica( investigativa)? (i|ii|iii|iv|v|vi)(\s|$)/);
    return m ? ROMAN.indexOf(m[2]) + 1 : null;
  }
  const ROMANO = n => (ROMAN[n - 1] || '').toUpperCase();
  function progN(p) {
    return norm(p).replace(/^licenciatura en /, '').replace(/ distancia$/, '').trim();
  }
  function cedula(x) { return String(x == null ? '' : x).replace(/\D/g, ''); }

  /* ------------------------------------------------------------------ */
  /* Programas                                                           */
  /* ------------------------------------------------------------------ */
  function canonPrograma(nombre, conocidos) {
    const n = norm(nombre);
    if (conocidos) {
      for (const c of conocidos) if (norm(c) === n) return c;
    }
    // Capitalización estándar
    return clean(nombre).replace(/^licenciatura en (\w)/i, (m, a) => 'Licenciatura en ' + a.toUpperCase());
  }
  function abreviarPrograma(p) {
    let s = clean(p)
      .replace(/^Licenciatura en /i, 'Lic. ')
      .replace(/Educación Campesina y Rural/i, 'Educ. Campesina y Rural')
      .replace(/Educación Infantil/i, 'Educ. Infantil')
      .replace(/Ciencias Naturales y Educación Ambiental/i, 'Ciencias Naturales y EA')
      .replace(/Lenguas Extranjeras con Énfasis en Inglés/i, 'Lenguas Extranjeras-Inglés')
      .replace(/Literatura y Lengua Castellana/i, 'Literatura y LC')
      .replace(/\(Distancia\)/i, '(Dist.)');
    return s.replace(/[\\\/\?\*\[\]:]/g, '-').slice(0, 31);
  }

  /* ------------------------------------------------------------------ */
  /* FASE 1. Planes de estudio y clasificación                           */
  /* ------------------------------------------------------------------ */
  function findCol(headers, pats) {
    for (const p of pats) {
      const h = headers.find(x => p.test(norm(x)));
      if (h) return h;
    }
    return null;
  }

  function detectarTipoPlan(rows) {
    const comps = new Set(rows.map(r => norm(r.componente)));
    if ([...comps].some(c => c.includes('didactica y practica'))) return 'Plan de transición';
    return 'Plan anterior';
  }

  function esNombrePPI(n) {
    return /^practica (pedagogica|profesional)/.test(n);
  }

  /** Clasifica una asignatura. Devuelve {componente, revision} o null si no pertenece a los 3 componentes. */
  function clasificar(nombre, compOficial) {
    const n = norm(nombre), c = norm(compOficial);
    const ppi = esNombrePPI(n);
    if (c.includes('didactica y practica')) {
      return { componente: ppi ? COMP.PPI : COMP.DID, revision: '' };
    }
    if (c === 'practica pedagogica investigativa' || (c.includes('practica pedagogica') && !c.includes('didact'))) {
      if (ppi) return { componente: COMP.PPI, revision: '' };
      return { componente: COMP.PPI, revision: 'Clasificación dudosa: la asignatura figura en el componente "' + clean(compOficial) + '" del plan, pero su denominación no corresponde a una práctica pedagógica. Revisar.' };
    }
    if (c.includes('didactica')) {
      if (ppi) return { componente: COMP.PPI, revision: 'En el plan oficial figura en el componente "' + clean(compOficial) + '"; se clasifica como Práctica Pedagógica Investigativa por su denominación. Revisar.' };
      if (/^electiva/.test(n)) return { componente: COMP.DID, revision: 'Denominación genérica (electiva) dentro del componente de Didáctica; confirmar la asignatura que se ofertará.' };
      return { componente: COMP.DID, revision: '' };
    }
    if (c === 'pedagogico' || c === 'componente pedagogico') {
      if (ppi) return { componente: COMP.PPI, revision: 'En el plan oficial figura en el componente "' + clean(compOficial) + '"; se clasifica como PPI por su denominación. Revisar.' };
      return { componente: COMP.PED, revision: '' };
    }
    return null;
  }

  /**
   * Normaliza las filas de un plan de estudios.
   * rows: arreglo de objetos (encabezado → valor) leídos de Excel.
   */
  function procesarPlan(rawRows, opts) {
    opts = opts || {};
    const headers = Object.keys(rawRows[0] || {});
    const cProg = findCol(headers, [/programa/]);
    const cAsig = findCol(headers, [/^asignatura/, /curso/, /nombre.*asignatura/]);
    const cCred = findCol(headers, [/credito/]);
    const cPre = findCol(headers, [/prerrequisito/]);
    const cComp = findCol(headers, [/componente/]);
    const cSem = findCol(headers, [/semestre/, /nivel/]);
    const cCod = findCol(headers, [/codigo/, /^cod/]);
    const faltan = [];
    if (!cProg) faltan.push('Nombre del programa');
    if (!cAsig) faltan.push('Asignatura');
    if (!cComp) faltan.push('Componente');
    if (faltan.length) throw new Error('El archivo de plan no tiene las columnas requeridas: ' + faltan.join(', '));
    const rows = rawRows
      .map(r => ({
        programa: clean(r[cProg]), asignatura: clean(r[cAsig]), creditos: Number(r[cCred]) || 0,
        prerrequisitos: clean(r[cPre]).replace(/^n\/?a$/i, ''), componente: clean(r[cComp]),
        semestre: cSem ? (r[cSem] === '' || r[cSem] == null ? '' : r[cSem]) : '', codigo: cCod ? clean(r[cCod]) : '',
      }))
      .filter(r => r.programa && r.asignatura);
    const plan = opts.plan || detectarTipoPlan(rows);
    return { plan, rows, columnas: { codigo: !!cCod, semestre: !!cSem } };
  }

  /** Construye el inventario de asignaturas de los tres componentes. */
  function inventario(planes) {
    // planes: [{plan, rows, archivo}]
    const conocidos = [];
    // Los nombres del plan de transición se toman como canónicos
    planes.slice().sort((a, b) => (a.plan === 'Plan de transición' ? -1 : 1) - (b.plan === 'Plan de transición' ? -1 : 1))
      .forEach(p => p.rows.forEach(r => { const c = canonPrograma(r.programa, conocidos); if (!conocidos.includes(c)) conocidos.push(c); }));
    const cursos = [], excluidas = [], duplicados = [];
    const vistos = new Map();
    planes.forEach(p => {
      p.rows.forEach((r, i) => {
        const programa = canonPrograma(r.programa, conocidos);
        const cl = clasificar(r.asignatura, r.componente);
        if (!cl) { excluidas.push({ plan: p.plan, programa, asignatura: r.asignatura, componente: r.componente }); return; }
        const id = hash(p.plan + '|' + norm(programa) + '|' + norm(r.asignatura));
        if (vistos.has(id)) { duplicados.push({ plan: p.plan, programa, asignatura: r.asignatura, fila: i + 2 }); return; }
        vistos.set(id, true);
        cursos.push({
          id, plan: p.plan, programa, componente: cl.componente, componenteOficial: r.componente,
          revisionClasificacion: cl.revision, codigo: r.codigo || '', asignatura: r.asignatura,
          creditos: r.creditos, semestre: r.semestre, prerrequisitos: r.prerrequisitos, archivoPlan: p.archivo || '',
        });
      });
    });
    const ordenPlan = { 'Plan de transición': 0, 'Plan anterior': 1 };
    cursos.sort((a, b) => a.programa.localeCompare(b.programa, 'es') || (ordenPlan[a.plan] - ordenPlan[b.plan]) ||
      COMP_ORDEN.indexOf(a.componente) - COMP_ORDEN.indexOf(b.componente) || (Number(a.semestre) || 99) - (Number(b.semestre) || 99) ||
      a.asignatura.localeCompare(b.asignatura, 'es'));
    return { cursos, excluidas, duplicados, programas: conocidos.sort((a, b) => a.localeCompare(b, 'es')) };
  }

  /* ------------------------------------------------------------------ */
  /* FASE 2a. Perfiles docentes (Word)                                   */
  /* ------------------------------------------------------------------ */
  function xmlDecode(s) {
    return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d)).replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCharCode(parseInt(h, 16))).replace(/&amp;/g, '&');
  }
  /** Extrae párrafos {text, bold} del XML de word/document.xml */
  function docxParagraphs(xml) {
    const body = xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, m => m); // las tablas también contienen <w:p>
    const out = [];
    const pRe = /<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g;
    let m;
    while ((m = pRe.exec(body))) {
      const p = m[0];
      let text = '', boldChars = 0, chars = 0;
      const rRe = /<w:r[ >][\s\S]*?<\/w:r>/g;
      let r;
      while ((r = rRe.exec(p))) {
        const run = r[0];
        const rpr = (run.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
        const bold = /<w:b\/>|<w:b w:val="(1|true|on)"\/>|<w:b\s*\/>/.test(rpr);
        let t = '';
        const tRe = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
        let x;
        while ((x = tRe.exec(run))) t += x[1] != null ? xmlDecode(x[1]) : (x[0].includes('tab') ? ' ' : '\n');
        text += t;
        const vis = t.replace(/\s/g, '').length;
        chars += vis;
        if (bold) boldChars += vis;
      }
      text = text.trim();
      if (text) out.push({ text, bold: chars > 0 && boldChars / chars > 0.6 });
    }
    return out;
  }

  const LABELS = {
    'formacion de pregrado': 'pregrado',
    'formacion posgradual': 'posgrado',
    'experiencia docente y profesional': 'experiencia',
    'experiencia docente': 'experiencia',
    'experiencia y produccion investigativa': 'investigacion',
    'experiencia y produccion academica': 'investigacion',
    'experiencia y competencias investigativas': 'investigacion',
    'produccion academica': 'investigacion',
    'criterio integral de idoneidad': 'idoneidad',
  };

  function compDeEncabezado(t) {
    const l = norm(t);
    if (l.includes('practica')) return COMP.PPI;
    if (l.includes('didactic')) return COMP.DID;
    if (l.includes('pedagogic')) return COMP.PED;
    return null;
  }

  /** Parsea los párrafos de un documento de perfiles. */
  function parsePerfiles(paras, archivo, programasConocidos) {
    const texts = paras.map(p => p.text);
    // Programa: encabezado "LICENCIATURA EN ..."
    let programa = null;
    for (const t of texts.slice(0, 5)) {
      const m = t.match(/LICENCIATURA\s+EN\s+[^\n]+/i);
      if (m) { programa = m[0]; break; }
    }
    if (!programa && archivo) programa = archivo.replace(/\.docx$/i, '').replace(/^perfil(es)? docente(s)?\s*/i, '');
    const programaTxt = programa;
    programa = programa ? matchPrograma(programa, programasConocidos) : null;

    const cursos = [];
    let actual = null, seccion = null, comp = null;
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i].replace(/\s+/g, ' ').trim();
      const low = norm(t);
      const nxt = (texts[i + 1] || '').trim(), nxt2 = (texts[i + 2] || '').trim();
      const nlow = norm(nxt), n2low = norm(nxt2);
      if (/^componente/.test(low) && t.length < 80 && !/^competencia/.test(low)) { comp = compDeEncabezado(t); continue; }
      const esTitulo = t.length < 140 && !LABELS[low] && !/^competencia/.test(low) && !/^(titulo|la idoneidad|experiencia|licenciad|el docente|se valorar|podran)/.test(low) &&
        !/[.:]$/.test(t) &&
        (/^el docente/.test(nlow) || nlow === 'formacion de pregrado' || (n2low === 'formacion de pregrado' && nxt.length > 150));
      if (esTitulo) {
        const transicion = /transi/i.test(t);
        const nombre = t.replace(/\s*\(\s*plan de transi[cç]+i[oó]n\s*\)\s*$/i, '').trim();
        actual = {
          id: '', programa, archivo: archivo || '', titulo: t, asignatura: nombre, planTransicion: transicion, componenteDoc: comp,
          descripcion: '', pregrado: '', posgrado: '', experiencia: '', investigacion: '', idoneidad: '', competencias: [], otros: [], alertas: [],
        };
        actual.id = hash((programa || '') + '|' + norm(t));
        cursos.push(actual);
        seccion = 'descripcion';
        continue;
      }
      if (!actual) continue;
      if (LABELS[low]) {
        const s = LABELS[low];
        if (actual[s] && s !== 'investigacion') actual.alertas.push('Sección "' + t + '" repetida en el documento.');
        seccion = s;
        continue;
      }
      if (/^competencia/.test(low) && t.length < 120 && !/\.$/.test(t)) {
        actual.competencias.push({ nombre: t, descripcion: '' }); seccion = 'competencia'; continue;
      }
      if (t.length < 80 && !/[.:]$/.test(t) && seccion !== 'descripcion') {
        actual.otros.push({ nombre: t, descripcion: '' }); seccion = 'otro'; continue;
      }
      if (seccion === 'descripcion' && /^t[ií]tulo de/i.test(t) && !actual.pregrado) seccion = 'pregrado';
      if (seccion === 'competencia') { const c = actual.competencias[actual.competencias.length - 1]; c.descripcion = clean(c.descripcion + ' ' + t); }
      else if (seccion === 'otro') { const o = actual.otros[actual.otros.length - 1]; o.descripcion = clean(o.descripcion + ' ' + t); }
      else actual[seccion] = clean(actual[seccion] + ' ' + t);
    }
    cursos.forEach(c => {
      if (!c.pregrado) c.alertas.push('El perfil no define la formación de pregrado.');
      if (!c.posgrado) c.alertas.push('El perfil no define la formación posgradual.');
      if (!c.experiencia) c.alertas.push('El perfil no define la sección de experiencia docente y profesional.');
      if (/^t[ií]tulo de licenciad/i.test(c.posgrado)) c.alertas.push('La sección de formación posgradual contiene texto de pregrado (posible error de edición del documento).');
    });
    return { programa, programaDetectado: programaTxt, perfiles: cursos };
  }

  function matchPrograma(nombre, conocidos) {
    const t = tokens(nombre);
    if (!conocidos || !conocidos.length) return canonPrograma(nombre);
    let best = null, bs = 0;
    for (const c of conocidos) {
      if (/distancia/i.test(c) && !/distancia/i.test(nombre)) continue;
      const ct = tokens(c);
      const s = overlap(ct, t) / Math.max(ct.length, t.length);
      if (s > bs) { bs = s; best = c; }
    }
    return bs >= 0.5 ? best : canonPrograma(nombre);
  }

  /* ---------- clave de equivalencia de denominaciones ---------- */
  function claveCurso(nombre) {
    let n = norm(nombre).replace(/plan de transicion/g, '').trim();
    n = n.replace(/\bpractica pedagogica e investigativa\b/g, 'practica pedagogica investigativa');
    const mp = n.match(/^practica pedagogica (?:investigativa )?(i|ii|iii|iv|v|vi)\b/);
    if (mp) return 'ppi ' + mp[1];
    if (/^practica profesional/.test(n)) return 'ppi vi';
    n = norm(String(nombre).replace(/\([^)]*\)/g, ' ')).replace(/plan de transicion/g, '').trim();
    return n.split(' ').filter(w => w && !STOP.has(w)).map(w => w.replace(/s$/, '')).join(' ')
      .replace(/\bdidactica\b/g, 'didactica');
  }
  function claveCompleta(nombre) {
    return norm(String(nombre).replace(/\([^)]*\)/g, ' ')).replace(/plan de transicion/g, '').replace(/\bpractica pedagogica e investigativa\b/g, 'practica pedagogica investigativa')
      .split(' ').filter(w => w && !STOP.has(w)).map(w => w.replace(/s$/, '')).join(' ');
  }

  /** Asocia a cada curso su perfil (exacto o por equivalencia). */
  function vincularPerfiles(cursos, perfiles) {
    const porProg = new Map();
    perfiles.forEach(p => { if (!porProg.has(p.programa)) porProg.set(p.programa, []); porProg.get(p.programa).push(p); });
    const usados = new Set();
    cursos.forEach(c => {
      c.perfilId = null; c.perfilMatch = null; c.perfilNota = ''; c.perfilSugerido = null;
      const lista = porProg.get(c.programa) || [];
      const kc = claveCurso(c.asignatura), kf = claveCompleta(c.asignatura);
      const cand = lista.filter(p => claveCurso(p.asignatura) === kc);
      if (cand.length) {
        const pref = c.plan === 'Plan de transición' ? cand.find(p => p.planTransicion) : cand.find(p => !p.planTransicion);
        const p = pref || cand[0];
        c.perfilId = p.id;
        usados.add(p.id);
        if (claveCompleta(p.asignatura) === kf) c.perfilMatch = 'exacta';
        else { c.perfilMatch = 'equivalente'; c.perfilNota = 'Perfil asociado por equivalencia de denominación con "' + p.titulo + '". Validar correspondencia.'; }
        return;
      }
      // Sugerencias (sin asignar)
      const ct = tokens(c.asignatura);
      let best = null, bs = 0;
      const fuentes = lista.length ? lista : perfiles.filter(p => norm(p.programa).replace(/distancia/, '') && c.programa.replace(/\s*\(Distancia\)/i, '') === p.programa);
      fuentes.forEach(p => {
        const pt = tokens(p.asignatura);
        const s = overlap(ct, pt) / Math.max(ct.length, pt.length);
        if (s > bs) { bs = s; best = p; }
      });
      if (!lista.length) {
        const pres = perfiles.find(p => p.programa === c.programa.replace(/\s*\(Distancia\)/i, '') && claveCurso(p.asignatura) === kc);
        if (pres) { c.perfilSugerido = pres.id; c.perfilNota = 'No se suministró documento de perfiles para este programa. Existe un perfil para la misma asignatura en "' + pres.programa + '"; requiere validación para su homologación.'; return; }
        c.perfilNota = 'No se suministró documento de perfiles docentes para este programa.';
        return;
      }
      if (best && bs >= 0.5) { c.perfilSugerido = best.id; c.perfilNota = 'No existe perfil con la denominación oficial de la asignatura. Perfil posiblemente equivalente: "' + best.titulo + '" (requiere validación académica).'; }
    });
    const huerfanos = perfiles.filter(p => !usados.has(p.id));
    return { huerfanos };
  }

  /* ------------------------------------------------------------------ */
  /* FASE 2b. Requisitos del perfil (estructura evaluable)               */
  /* ------------------------------------------------------------------ */
  function splitItems(s) {
    return s.split(/\s*,\s*|\s+o\s+|\s*;\s*/).map(x => clean(x).replace(/\.$/, '')).filter(Boolean);
  }
  function oraciones(t) {
    return clean(t).split(/(?<=[.])\s+(?=[A-ZÁÉÍÓÚÑ¿])/);
  }
  const NUM = { un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, diez: 10 };

  function parsePregrado(txt) {
    const res = { items: [], anyLic: false, afines: false, alt: null, texto: txt };
    if (!txt) return res;
    const ors = oraciones(txt);
    const prim = ors.filter(s => !/^(podr[aá]n|para titulaciones|se valorar|cuando|tambi[eé]n)/i.test(s));
    const alt = ors.filter(s => /^(podr[aá]n considerarse|para titulaciones)/i.test(s)).join(' ');
    const p = prim.join(' ');
    res.anyLic = /cualquier(a)?\s+(de las\s+)?([aá]reas?|licenciatura)/i.test(p);
    res.afines = /afines|equivalentes|relacionad/i.test(p);
    let body = p.replace(/^t[ií]tulo\s+(profesional\s+)?de\s+/i, '');
    body = body.split(/\s+o\s+(?:[aá]reas|denominaciones|campos|licenciaturas|cualquier)|,?\s+con\s+(?:formaci[oó]n|trayectoria|[eé]nfasis en formaci)|,?\s+preferiblemente|,?\s+directamente|\.\s/i)[0];
    let tipo = /^licenciad/i.test(body) ? 'lic' : 'prof';
    splitItems(body).forEach(it => {
      let t = it;
      if (/^licenciad[oa]s?\s+en\s+/i.test(t)) { tipo = 'lic'; t = t.replace(/^licenciad[oa]s?\s+en\s+/i, ''); }
      else if (/^t[ií]tulo de\s+/i.test(t)) { t = t.replace(/^t[ií]tulo de\s+/i, ''); }
      if (/^licenciad/i.test(t)) { tipo = 'lic'; t = t.replace(/^licenciad[oa]s?\s*/i, ''); }
      const tk = tokens(t);
      if (tk.length) res.items.push({ tipo, label: t, tk });
    });
    if (alt) {
      const a = { anyProf: false, otrosLic: false, items: [], cond: null, texto: alt };
      a.otrosLic = /otros\s+licenciados|otros\s+t[ií]tulos\s+(profesionales\s+o\s+)?de\s+licenciatura|otras\s+licenciaturas|t[ií]tulos\s+de\s+licenciatura|titulaciones diferentes/i.test(alt);
      const m = alt.match(/profesionales\s+(?:en|de)\s+(.+?)\s+(?:cuando|con|que)\s/i);
      if (m && !/^(otr[oa]s|campos|las diferentes|[aá]reas afines|campos afines)/i.test(m[1].trim())) {
        splitItems(m[1]).forEach(it => {
          if (/afines|otros|relacionad/i.test(it) && tokens(it).length <= 2 && /afines|otros/i.test(it)) { a.anyProf = a.anyProf || false; return; }
          const key = norm(it).replace(/^(las|los)\s+/, '');
          const exp = EXPAND[key] || [it];
          exp.forEach(e => { const tk = tokens(e); if (tk.length) a.items.push({ label: e, tk }); });
        });
        if (/u otros campos|o campos afines|otros campos|campos relacionados/i.test(m[1])) a.afinesProf = true;
      } else if (/profesionales|otros t[ií]tulos|otros licenciados|titulaciones/i.test(alt)) a.anyProf = true;
      // condición
      const mp = alt.match(/posgrad\w*\s+(?:espec[ií]fica\s+)?(?:o\s+trayectoria[^,]*?\s+)?en\s+(.+?)(?:\s+y\s+(?:experiencia|trayectoria)|,\s*(?:experiencia|competencia)|\.|$)/i);
      if (mp) a.cond = { tipo: 'posgrado', campos: splitItems(mp[1]).map(x => ({ label: x, tk: tokens(x) })).filter(x => x.tk.length), texto: mp[0] };
      else if (/formaci[oó]n\s+(pedag[oó]gica|did[aá]ctica)|formaci[oó]n pedag/i.test(alt)) a.cond = { tipo: 'pedagogica', alternaExperiencia: /o\s+experiencia\s+docente/i.test(alt) };
      else if (/trayectoria/i.test(alt)) a.cond = { tipo: 'trayectoria' };
      res.alt = a;
    }
    return res;
  }

  function parsePosgrado(txt) {
    const res = { niveles: [], items: [], afines: false, valorables: [], texto: txt };
    if (!txt) return res;
    const ors = oraciones(txt);
    let main = ors.find(s => /(maestr[ií]a|doctorado|especializaci[oó]n|mag[ií]ster)/i.test(s) && /\ben\b/i.test(s) && !/^se valorar/i.test(s)) || '';
    ors.filter(s => /^se valorar/i.test(s)).forEach(s => res.valorables.push(s));
    if (/maestr[ií]a|mag[ií]ster/i.test(main)) res.niveles.push('Maestría');
    if (/doctor/i.test(main)) res.niveles.push('Doctorado');
    if (/especializaci[oó]n/i.test(main)) res.niveles.push('Especialización');
    res.afines = /afines|relacionad/i.test(main);
    const m = main.match(/(?:maestr[ií]a|doctorado|especializaci[oó]n|mag[ií]ster)(?:\s*(?:,|o|y)\s*(?:maestr[ií]a|doctorado|especializaci[oó]n))*\s+en\s+(.+)/i);
    if (m) {
      let body = m[1].split(/,?\s+o\s+(?:campos|[aá]reas)\s+afines|,?\s+siempre que|,?\s+con\s+(?:trayectoria|[eé]nfasis|formaci)|,?\s+preferiblemente|\.\s*$/i)[0];
      splitItems(body).forEach(it => {
        const tk = tokens(it);
        if (!tk.length) return;
        const partes = it.split(/\s+y\s+/).map(x => tokens(x)).filter(x => x.length);
        res.items.push({ label: it, tk, partes: partes.length > 1 ? partes : [] });
      });
    }
    return res;
  }

  function parseExperiencia(txt) {
    const res = { anios: null, especificos: [], valorables: [], texto: txt };
    if (!txt) return res;
    const m = deacc(txt).match(/minimo\s+(?:de\s+)?(\w+)\s*(?:\((\d+)\))?\s+anos/i);
    if (m) res.anios = m[2] ? Number(m[2]) : (NUM[m[1].toLowerCase()] || Number(m[1]) || null);
    oraciones(txt).forEach(s => {
      if (/^se valorar|preferiblemente/i.test(s)) res.valorables.push(s);
      else if (/se requiere|espec[ií]fica|demostrable|deber[aá]/i.test(s)) res.especificos.push(s);
    });
    return res;
  }

  function requisitos(perfil) {
    if (perfil._req) return perfil._req;
    const req = {
      pregrado: parsePregrado(perfil.pregrado),
      posgrado: parsePosgrado(perfil.posgrado),
      experiencia: parseExperiencia(perfil.experiencia),
      investigacion: perfil.investigacion || '',
      competencias: perfil.competencias || [],
      otros: perfil.otros || [],
    };
    const tk = [];
    req.pregrado.items.forEach(i => specific(i.tk).forEach(t => tk.includes(t) || tk.push(t)));
    req.disciplina = tk;
    Object.defineProperty(perfil, '_req', { value: req, enumerable: false, writable: true });
    return req;
  }

  /* ------------------------------------------------------------------ */
  /* FASE 2c. Profesores (bases Excel)                                   */
  /* ------------------------------------------------------------------ */
  function parseFecha(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v.getTime();
    if (typeof v === 'number') return Math.round((v - 25569) * 86400000); // serial Excel
    const s = String(v).trim();
    let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (m) return Date.UTC(+m[3], +m[1] - 1, +m[2]);
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
    const d = Date.parse(s);
    return isNaN(d) ? null : d;
  }
  function anio(ms) { return ms ? new Date(ms).getUTCFullYear() : ''; }

  const NIVELES = {
    profesional: 'Profesional', especializacion: 'Especialización', maestria: 'Maestría', doctorado: 'Doctorado',
    tecnico: 'Técnico', tecnologo: 'Tecnólogo',
  };
  function nivelCanon(s) {
    const n = norm(s);
    if (n.startsWith('profesional')) return 'Profesional';
    if (n.startsWith('especializ')) return 'Especialización';
    if (n.startsWith('maestr')) return 'Maestría';
    if (n.startsWith('doctor')) return 'Doctorado';
    if (n.startsWith('tecnologo')) return 'Tecnólogo';
    if (n.startsWith('tecnico')) return 'Técnico';
    if (n.includes('curso')) return 'Curso';
    if (n.includes('certificacion')) return 'Certificación';
    return clean(s) || 'Otro';
  }

  function procesarFormacion(rawRows) {
    const headers = Object.keys(rawRows[0] || {});
    const c = {
      id: findCol(headers, [/^identificacion$/]), nombre: findCol(headers, [/^nombre$/]), estado: findCol(headers, [/estado/]),
      unidad: findCol(headers, [/unidad/]), nivel: findCol(headers, [/nivel/]), amplio: findCol(headers, [/campo amplio/]),
      esp: findCol(headers, [/campo especifico/]), inst: findCol(headers, [/institucion/]), prog: findCol(headers, [/^programa$/, /titulo/]),
      grad: findCol(headers, [/graduado/]), fecha: findCol(headers, [/fecha/]), lugar: findCol(headers, [/lugar/]), conv: findCol(headers, [/convalidado/]),
    };
    const faltan = ['id', 'nombre', 'nivel', 'prog'].filter(k => !c[k]);
    if (faltan.length) throw new Error('El archivo de formación académica no tiene las columnas requeridas (IDENTIFICACIÓN, NOMBRE, NIVEL DE FORMACIÓN, PROGRAMA).');
    const map = new Map();
    let filas = 0;
    rawRows.forEach(r => {
      const id = clean(r[c.id]);
      if (!id) return;
      filas++;
      if (!map.has(id)) map.set(id, { id, nombre: clean(r[c.nombre]), estadoBDC: clean(r[c.estado]), unidades: [], titulos: [] });
      const p = map.get(id);
      const u = clean(r[c.unidad]);
      if (u && !p.unidades.includes(u)) p.unidades.push(u);
      const t = {
        nivel: nivelCanon(r[c.nivel]), titulo: clean(r[c.prog]), institucion: clean(r[c.inst]), graduado: /^s/i.test(clean(r[c.grad])),
        fecha: anio(parseFecha(r[c.fecha])), campo: clean(r[c.esp]), area: clean(r[c.amplio]), lugar: clean(r[c.lugar]), convalidado: /^s/i.test(clean(r[c.conv])),
      };
      const k = norm(t.nivel + t.titulo + t.institucion);
      if (!p.titulos.some(x => norm(x.nivel + x.titulo + x.institucion) === k)) p.titulos.push(t);
    });
    return { profesores: map, filas };
  }

  const RX_NO_IE = /colegio\s+(colombiano|nacional|departamental|profesional|oficial)?\s*de\s+(psic|abog|contad|ingen|odont|m[eé]dic|enfer|arquit|bacteri|fisiot|nutric|optom|qu[ií]mic|administ|econom)|colegio colombiano|colegio mayor/i;
  const RX_IE = /(instituci[oó]n educativa|colegio|escuela|normal superior|liceo|gimnasio|centro educativo|\bI\.?\s?E\.?\s?D?\.?\b|concentraci[oó]n|secretar[ií]a de educaci[oó]n|jard[ií]n infantil|preescolar|hogar infantil|cdi\b)/i;

  function unionAnios(intervals) {
    const iv = intervals.filter(x => x[0] && x[1] && x[1] > x[0]).sort((a, b) => a[0] - b[0]);
    let total = 0, cs = null, ce = null;
    iv.forEach(([s, e]) => {
      if (cs == null) { cs = s; ce = e; return; }
      if (s <= ce) ce = Math.max(ce, e);
      else { total += ce - cs; cs = s; ce = e; }
    });
    if (cs != null) total += ce - cs;
    return Math.round(total / (365.25 * 86400000) * 100) / 100;
  }

  function procesarExperiencia(rawRows, hoyMs) {
    hoyMs = hoyMs || Date.now();
    const headers = Object.keys(rawRows[0] || {});
    const c = {
      id: findCol(headers, [/^identificacion$/]), nombre: findCol(headers, [/^nombre$/]), tipo: findCol(headers, [/tipo de experiencia/]),
      emp: findCol(headers, [/empresa/]), ini: findCol(headers, [/fecha inicio/]), fin: findCol(headers, [/fecha fin/]), dur: findCol(headers, [/duracion/]),
      areas: findCol(headers, [/areas de desempeno/]), form: findCol(headers, [/formacion academica/]), estado: findCol(headers, [/estado/]), unidad: findCol(headers, [/unidad/]),
    };
    if (!c.id || !c.tipo) throw new Error('El archivo de experiencia no tiene las columnas requeridas (IDENTIFICACIÓN, TIPO DE EXPERIENCIA).');
    const map = new Map();
    let filas = 0;
    rawRows.forEach(r => {
      const id = clean(r[c.id]);
      if (!id) return;
      filas++;
      if (!map.has(id)) map.set(id, { id, nombre: clean(r[c.nombre]), estadoBDC: clean(r[c.estado]), areas: clean(r[c.areas]), formacionTexto: clean(r[c.form]), unidades: [], raw: [] });
      const p = map.get(id);
      const u = clean(r[c.unidad]);
      if (u && !p.unidades.includes(u)) p.unidades.push(u);
      let ini = parseFecha(r[c.ini]), fin = parseFecha(r[c.fin]);
      const dur = Number(String(r[c.dur] || '').replace(',', '.')) || 0;
      if (ini && !fin && dur) fin = ini + dur * 365.25 * 86400000;
      if (fin && fin > hoyMs) fin = hoyMs;
      p.raw.push({ tipo: clean(r[c.tipo]), empresa: clean(r[c.emp]), ini, fin, dur });
    });
    map.forEach(p => {
      const tipoDoc = x => /docencia universitaria|docente en instituciones de educaci[oó]n superior/i.test(x.tipo);
      const tipoInv = x => /investigaci/i.test(x.tipo);
      const tipoIE = x => /profesional/i.test(x.tipo) && RX_IE.test(x.empresa) && !RX_NO_IE.test(x.empresa) || /colegios o institutos/i.test(x.tipo);
      const docU = p.raw.filter(tipoDoc), ie = p.raw.filter(tipoIE), inv = p.raw.filter(tipoInv);
      const prof = p.raw.filter(x => /profesional|sector productivo/i.test(x.tipo) && !tipoIE(x));
      const iv = arr => arr.map(x => [x.ini, x.fin]);
      const porEmp = {};
      docU.concat(ie).forEach(x => { const k = x.empresa.replace(/\s+/g, ' ').trim(); const kk = norm(k); if (!porEmp[kk]) porEmp[kk] = { nombre: k, iv: [] }; porEmp[kk].iv.push([x.ini, x.fin]); });
      const empleadores = Object.values(porEmp).map(e => ({ nombre: e.nombre, anios: unionAnios(e.iv) })).sort((a, b) => b.anios - a.anios).slice(0, 3);
      const invEmp = {};
      inv.forEach(x => { const kk = norm(x.empresa); if (!invEmp[kk]) invEmp[kk] = { nombre: x.empresa, iv: [] }; invEmp[kk].iv.push([x.ini, x.fin]); });
      p.exp = {
        registros: p.raw.length,
        docenciaUniv: unionAnios(iv(docU)),
        docenciaIE: unionAnios(iv(ie)),
        docenciaTotal: unionAnios(iv(docU.concat(ie))),
        investigacion: unionAnios(iv(inv)),
        profesional: unionAnios(iv(prof)),
        empleadores,
        invEntidades: Object.values(invEmp).map(e => ({ nombre: e.nombre, anios: unionAnios(e.iv) })).sort((a, b) => b.anios - a.anios).slice(0, 2),
      };
      delete p.raw;
    });
    return { experiencia: map, filas };
  }

  /** Títulos desde el texto "Profesional: X - Inst // Maestría: Y - Inst" (respaldo cuando no hay registro de formación). */
  function titulosDesdeTexto(s) {
    return String(s || '').split('//').map(x => x.trim()).filter(Boolean).map(x => {
      const m = x.match(/^([^:]+):\s*(.+?)(?:\s+-\s+(.+))?$/);
      if (!m) return null;
      return { nivel: nivelCanon(m[1]), titulo: clean(m[2]), institucion: clean(m[3] || ''), graduado: null, fecha: '', campo: '', area: '', lugar: '', convalidado: false, fuente: 'experiencia' };
    }).filter(Boolean);
  }

  /** Une formación y experiencia en un registro por profesor. */
  function consolidarProfesores(formacion, experiencia) {
    const out = [];
    const ids = new Set([...(formacion ? formacion.keys() : []), ...(experiencia ? experiencia.keys() : [])]);
    ids.forEach(id => {
      const f = formacion && formacion.get(id), e = experiencia && experiencia.get(id);
      const p = {
        id, nombre: (f && f.nombre) || (e && e.nombre) || '', estadoBDC: (f && f.estadoBDC) || (e && e.estadoBDC) || '',
        unidades: [...new Set([...(f ? f.unidades : []), ...(e ? e.unidades : [])])],
        titulos: f ? f.titulos : (e ? titulosDesdeTexto(e.formacionTexto) : []),
        fuenteFormacion: f ? 'Formación académica' : (e ? 'Texto de la base de experiencia (sin verificación de grado)' : ''),
        areas: e ? e.areas : '',
        exp: e ? e.exp : null,
      };
      out.push(p);
    });
    out.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    return out;
  }

  function prepararProfesor(p) {
    if (p._tk) return;
    Object.defineProperty(p, '_tk', { value: true, enumerable: false, writable: true });
    p.titulos.forEach(t => {
      Object.defineProperty(t, '_tk', { value: tokens(t.titulo), enumerable: false, writable: true });
      Object.defineProperty(t, '_lic', { value: /licenciad|licenciatura/i.test(deacc(t.titulo)), enumerable: false, writable: true });
      Object.defineProperty(t, '_ped', { value: /pedag|didact|educa|docen|ensenanza|ensen/i.test(deacc(t.titulo)), enumerable: false, writable: true });
    });
  }

  /* ------------------------------------------------------------------ */
  /* FASE 2d. Contraste perfil ↔ profesor                                */
  /* ------------------------------------------------------------------ */
  function fmtTit(t) {
    return t.titulo + (t.institucion ? ' (' + t.institucion + (t.fecha ? ', ' + t.fecha : '') + ')' : '') + (t.graduado === false ? ' [no graduado]' : '');
  }

  function evalPregrado(req, prof) {
    const pre = req.pregrado;
    const tits = prof.titulos.filter(t => t.nivel === 'Profesional');
    if (!pre.items.length && !pre.alt) return { s: 'I', det: 'El perfil no define la formación de pregrado.', sinReq: true };
    let best = null;
    const consider = (s, t, det) => {
      const rank = { A: 4, C: 3, F: 2, I: 1, N: 0 };
      if (!best || rank[s] > rank[best.s]) best = { s, det, titulo: t };
    };
    tits.forEach(t => {
      const pend = t.graduado === false || t.graduado == null;
      for (const it of pre.items) {
        if (it.tipo === 'lic' && !t._lic) continue;
        if (subset(it.tk, t._tk)) {
          if (pend) consider('I', t, 'Título de ' + fmtTit(t) + ' corresponde a "' + it.label + '", pero no registra grado verificado.');
          else consider('A', t, fmtTit(t) + ' — corresponde a la denominación exigida "' + (it.tipo === 'lic' ? 'Licenciado en ' : '') + it.label + '".');
          return;
        }
      }
      if (t._lic && !pend) {
        const sp = specific(t._tk);
        if (pre.anyLic) consider('F', t, fmtTit(t) + ' — el perfil admite cualquier área de formación docente con trayectoria pertinente.');
        else if (pre.afines && sp.length && req.disciplina.length && overlap(req.disciplina, sp) > 0) consider('F', t, fmtTit(t) + ' — denominación afín al campo exigido; requiere validación académica.');
      }
    });
    if (best && best.s === 'A') return best;
    // vía alterna
    const alt = pre.alt;
    if (alt) {
      tits.forEach(t => {
        if (t.graduado === false) return;
        let ok = false, lab = '';
        if (alt.items.length) {
          const it = alt.items.find(i => subset(i.tk, t._tk));
          if (it) { ok = true; lab = 'profesional en ' + it.label; }
        }
        if (!ok && (alt.anyProf || (alt.otrosLic && t._lic))) { ok = true; lab = 'otros títulos profesionales admitidos'; }
        if (!ok) return;
        const cond = alt.cond;
        let condOk = false, condDet = '';
        if (!cond) { condOk = true; }
        else if (cond.tipo === 'posgrado') {
          const pg = prof.titulos.find(x => ['Especialización', 'Maestría', 'Doctorado'].includes(x.nivel) && x.graduado !== false && cond.campos.some(cf => subset(cf.tk, x._tk)));
          if (pg) { condOk = true; condDet = ' y acredita posgrado ' + fmtTit(pg); }
        } else if (cond.tipo === 'pedagogica') {
          const pg = prof.titulos.find(x => x !== t && x._ped && x.graduado !== false);
          if (pg) { condOk = true; condDet = ' y acredita formación pedagógica: ' + fmtTit(pg); }
          else if (cond.alternaExperiencia && prof.exp && prof.exp.docenciaTotal > 0) { condOk = true; condDet = ' y registra experiencia docente'; }
        } else if (cond.tipo === 'trayectoria') {
          condOk = false;
        }
        if (condOk) consider('C', t, fmtTit(t) + ' — vía alterna (' + lab + ')' + condDet + '.');
        else if (cond && cond.tipo === 'trayectoria') consider('I', t, fmtTit(t) + ' — vía alterna (' + lab + ') condicionada a trayectoria demostrable que no puede verificarse con la base de datos.');
      });
    }
    if (best) return best;
    if (!tits.length) return { s: 'N', det: 'No registra título profesional.' };
    return { s: 'N', det: 'Títulos registrados (' + tits.map(t => t.titulo).join('; ') + ') no corresponden a las denominaciones exigidas.' };
  }

  function evalPosgrado(req, prof) {
    const pos = req.posgrado;
    if (!pos.items.length) return { s: 'I', det: 'El perfil no define con precisión la formación posgradual.', nivel: '' };
    const niveles = pos.niveles.length ? pos.niveles : ['Maestría', 'Doctorado'];
    const tits = prof.titulos.filter(t => niveles.includes(t.nivel));
    let best = null;
    const rank = { A: 3, F: 2, I: 1, N: 0 };
    const nivRank = { Doctorado: 3, 'Maestría': 2, 'Especialización': 1 };
    const consider = (s, t, det) => {
      if (!best || rank[s] > rank[best.s] || (rank[s] === rank[best.s] && (nivRank[t.nivel] || 0) > (nivRank[best.titulo.nivel] || 0)))
        best = { s, det, titulo: t, nivel: t.nivel };
    };
    tits.forEach(t => {
      const pend = t.graduado === false || t.graduado == null;
      const exacto = pos.items.find(i => subset(i.tk, t._tk));
      if (exacto) {
        if (pend) consider('I', t, fmtTit(t) + ' — corresponde a "' + exacto.label + '", pero no registra grado verificado (en curso o sin soporte).');
        else { consider('A', t, fmtTit(t) + ' — corresponde al campo exigido "' + exacto.label + '".'); if (best.titulo === t) best.campo = exacto; }
        return;
      }
      const parcial = pos.items.find(i => i.partes.some(pt => subset(pt, t._tk)));
      if (parcial && !pend) { consider('F', t, fmtTit(t) + ' — corresponde parcialmente a "' + parcial.label + '"; requiere validación.'); return; }
      if (pos.afines && !pend) {
        const sp = specific(t._tk);
        const reqTk = [];
        pos.items.forEach(i => specific(i.tk).forEach(x => reqTk.includes(x) || reqTk.push(x)));
        if (sp.length && overlap(reqTk, sp) > 0) consider('F', t, fmtTit(t) + ' — campo afín a los exigidos; requiere validación académica.');
      }
    });
    if (best) return best;
    const otros = prof.titulos.filter(t => ['Especialización', 'Maestría', 'Doctorado'].includes(t.nivel));
    if (!otros.length) return { s: 'N', det: 'No registra formación posgradual.', nivel: '' };
    const solo = otros.filter(t => !niveles.includes(t.nivel));
    if (solo.length === otros.length) return { s: 'N', det: 'Solo registra ' + solo.map(t => t.nivel + ' en ' + t.titulo).join('; ') + '; el perfil exige ' + niveles.join(' o ') + '.', nivel: '' };
    return { s: 'N', det: 'Posgrados registrados (' + otros.map(t => t.titulo).join('; ') + ') no corresponden a los campos exigidos.', nivel: '' };
  }

  function evalExperiencia(req, prof) {
    const ex = req.experiencia;
    const min = ex.anios || 0;
    if (!prof.exp || !prof.exp.registros) return { s: 'I', det: 'No registra experiencia en la base de datos.', anios: 0 };
    const tot = prof.exp.docenciaTotal;
    const det = 'Docencia: ' + tot.toFixed(1) + ' años (universitaria ' + prof.exp.docenciaUniv.toFixed(1) + ', instituciones educativas ' + prof.exp.docenciaIE.toFixed(1) + ')' + (min ? '; mínimo exigido ' + min + ' años.' : '.');
    if (min ? tot >= min : tot > 0) return { s: 'A', det, anios: tot };
    if (tot === 0) return { s: 'N', det: 'No registra experiencia docente. ' + (min ? 'Mínimo exigido ' + min + ' años.' : ''), anios: 0 };
    return { s: 'N', det, anios: tot };
  }

  function evalBDC(prof) {
    const e = norm(prof.estadoBDC);
    if (e.startsWith('cumple por aval')) return { s: 'A', det: 'Hoja de vida: ' + prof.estadoBDC + '.' };
    if (e.startsWith('cumple')) return { s: 'A', det: 'Hoja de vida: ' + prof.estadoBDC + '.' };
    if (e.includes('verificacion')) return { s: 'I', det: 'Hoja de vida en verificación de requisitos.' };
    if (e.includes('no cumple')) return { s: 'N', det: 'Hoja de vida con estado "No Cumple Requisitos" en la BDC.' };
    return { s: 'I', det: 'Estado de la hoja de vida no registrado.' };
  }

  // Lic. en Ciencias Naturales y Educación Ambiental (PPI y didácticas distintas de Física): no se admiten pregrados en Física/Matemáticas o afines.
  const FIS_MAT = /fisic|matematic|astronom/;
  function aplicaExclusionCN(perfil) {
    if (!/ciencias naturales/.test(norm(perfil.programa || ''))) return false;
    if (perfil.componenteDoc === COMP.PED) return false;
    const nombre = norm(perfil.asignatura || perfil.titulo || '');
    return perfil.componenteDoc === COMP.PPI || esNombrePPI(nombre) || !/fisic/.test(nombre);
  }

  /** Evalúa a un profesor frente a un perfil. */
  function evaluar(perfil, prof, cfg, rapido) {
    cfg = cfg || DEFAULT_CONFIG;
    prepararProfesor(prof);
    const req = requisitos(perfil);
    let profPre = prof, excluido = false;
    if (aplicaExclusionCN(perfil)) {
      const tit = prof.titulos.filter(t => !(t.nivel === 'Profesional' && FIS_MAT.test(norm(t.titulo))));
      if (tit.length !== prof.titulos.length) {
        profPre = Object.assign({}, prof, { titulos: tit });
        excluido = !tit.some(t => t.nivel === 'Profesional');
      }
    }
    let pre = evalPregrado(req, profPre);
    if (excluido) pre = { s: 'N', det: 'Su pregrado (' + prof.titulos.filter(t => t.nivel === 'Profesional').map(t => t.titulo).join('; ') + ') corresponde a Física, Matemáticas o afines, no admitido para esta licenciatura.' };
    const pos = evalPosgrado(req, prof);
    if (rapido && (pos.s === 'N' || (pre.s === 'N' && pos.s !== 'A' && pos.s !== 'F'))) return { tier: 0, pre, pos };
    const exp = evalExperiencia(req, prof);
    const bdc = evalBDC(prof);
    const inv = prof.exp && prof.exp.investigacion > 0
      ? { s: 'A', det: 'Registra ' + prof.exp.investigacion.toFixed(1) + ' años de experiencia en investigación, innovación o extensión' + (prof.exp.invEntidades.length ? ' (' + prof.exp.invEntidades.map(x => x.nombre).join('; ') + ')' : '') + '. Pertinencia temática por verificar.' }
      : { s: 'I', det: 'La base de datos no registra experiencia investigativa; verificar producción con soportes.' };
    const expEsp = { s: 'I', det: req.experiencia.especificos.length ? 'La BDC no detalla asignaturas ni poblaciones atendidas; verificar: ' + req.experiencia.especificos.join(' ') : 'Verificar pertinencia de la experiencia con soportes.' };
    const comp = { s: 'I', det: 'Competencias (' + req.competencias.length + ') verificables solo mediante revisión académica, entrevista o soportes.' };
    const otros = req.otros.map(o => ({ nombre: o.nombre, s: 'I', det: o.descripcion }));

    let tier;
    const hard = [pre.s, pos.s, exp.s, bdc.s];
    let soloPosgrado = false;
    if (pos.s === 'N') tier = 0;
    else if (bdc.s === 'N' && cfg.excluirNoCumpleBDC) tier = 0;
    else if (exp.s === 'N') tier = 0;
    else if (pre.s === 'N') { // sin pregrado afín: solo se considera si el posgrado es afín (revisión manual del Director)
      if (pos.s === 'A' || pos.s === 'F') { tier = 1; soloPosgrado = true; } else tier = 0;
    }
    else if (hard.every(s => s === 'A' || s === 'C')) tier = 3;           // cumple requisitos verificables
    else if (hard.every(s => s !== 'N') && !hard.includes('I')) tier = 2; // cumple con afinidad (validar)
    else if (hard.every(s => s !== 'N')) tier = 1;                         // información insuficiente
    else tier = 0;
    if (excluido) { tier = 0; soloPosgrado = false; }

    // Puntaje de pertinencia (0-100)
    let score = 0;
    score += { A: 25, C: 18, F: 12, I: 6 }[pre.s] || 0;
    score += pos.s === 'A' ? (pos.nivel === 'Doctorado' ? 30 : 25) : pos.s === 'F' ? 12 : pos.s === 'I' ? 6 : 0;
    if (pos.titulo && req.disciplina.length && overlap(req.disciplina, specific(pos.titulo._tk)) > 0) score += 5;
    if (pos.s === 'A' && pos.campo && specific(pos.campo.tk).length) score += 4; // campo posgradual específico (no genérico)
    const anios = exp.anios || 0;
    score += Math.min(anios, 15) / 15 * 20;
    if (prof.exp && prof.exp.docenciaIE > 0) score += 3;
    score += inv.s === 'A' ? 5 + Math.min(prof.exp.investigacion, 5) : 0;
    score += bdc.s === 'A' ? 2 : 0;
    score = Math.round(Math.min(score, 100));
    return { tier, score, pre, pos, exp, expEsp, inv, comp, bdc, otros, soloPosgrado };
  }

  function nivelCorrespondencia(ev) {
    if (!ev) return '';
    if (ev.soloPosgrado) return 'Pregrado no afín · posgrado afín (revisión del Director)';
    if (ev.tier === 3) return ev.score >= 70 ? 'Alta' : ev.score >= 50 ? 'Media-alta' : 'Media';
    if (ev.tier === 2) return 'Media (con afinidad por validar)';
    if (ev.tier === 1) return 'Por verificar (información insuficiente)';
    return 'No cumple';
  }

  /* ------------------------------------------------------------------ */
  /* Resumen verificable del profesor                                    */
  /* ------------------------------------------------------------------ */
  function resumenProfesor(p) {
    if (!p) return '';
    const orden = ['Doctorado', 'Maestría', 'Especialización', 'Profesional'];
    const partes = [];
    orden.forEach(n => {
      const ts = p.titulos.filter(t => t.nivel === n);
      if (ts.length) partes.push((n === 'Profesional' ? 'Pregrado' : n) + ': ' + ts.map(fmtTit).join('; '));
    });
    if (p.exp) {
      let s = 'Experiencia docente: ' + p.exp.docenciaTotal.toFixed(1) + ' años';
      if (p.exp.empleadores.length) s += ' (' + p.exp.empleadores.map(e => e.nombre + ' ' + e.anios.toFixed(1) + ' a.').join('; ') + ')';
      partes.push(s);
      if (p.exp.investigacion > 0) partes.push('Investigación/extensión: ' + p.exp.investigacion.toFixed(1) + ' años');
      if (p.exp.profesional > 0) partes.push('Experiencia profesional: ' + p.exp.profesional.toFixed(1) + ' años');
    } else partes.push('Experiencia: sin registros');
    partes.push('Estado BDC: ' + (p.estadoBDC || 'sin dato'));
    if (p.fuenteFormacion && p.fuenteFormacion !== 'Formación académica') partes.push('Fuente de formación: ' + p.fuenteFormacion);
    return partes.join('. ') + '.';
  }

  function resumenPerfil(perfil) {
    if (!perfil) return '';
    const r = requisitos(perfil);
    const s = [];
    if (perfil.pregrado) s.push('Pregrado: ' + perfil.pregrado);
    if (perfil.posgrado) s.push('Posgrado: ' + perfil.posgrado);
    if (perfil.experiencia) s.push('Experiencia: ' + perfil.experiencia);
    if (perfil.investigacion) s.push('Investigación: ' + perfil.investigacion);
    if (perfil.competencias.length) s.push('Competencias: ' + perfil.competencias.map(c => c.nombre.replace(/^Competencia(s)?\s+(para\s+(el|la|los|las)\s+)?/i, '')).join('; ') + '.');
    if (r.otros.length) s.push('Otros: ' + r.otros.map(o => o.nombre).join('; ') + '.');
    return s.join('\n');
  }

  function textoCorrespondencia(ev) {
    if (!ev) return '';
    const L = x => R[x.s] || '';
    return [
      nivelCorrespondencia(ev) + ' (' + ev.score + '/100).',
      'Pregrado: ' + L(ev.pre) + '.',
      'Posgrado: ' + L(ev.pos) + (ev.pos.nivel ? ' (' + ev.pos.nivel + ')' : '') + '.',
      'Experiencia docente: ' + L(ev.exp) + ' (' + (ev.exp.anios || 0).toFixed(1) + ' años).',
      'Experiencia específica: ' + L(ev.expEsp) + '.',
      'Investigación: ' + L(ev.inv) + '.',
      'Competencias: ' + L(ev.comp) + '.',
      'Hoja de vida BDC: ' + L(ev.bdc) + '.',
    ].join(' ');
  }

  /* ------------------------------------------------------------------ */
  /* FASE 3. Propuesta de asignación                                     */
  /* ------------------------------------------------------------------ */
  /**
   * @param ds {cursos, perfiles, profesores}
   * @param cfg configuración
   * @param overrides { [cursoId]: {accion:'asignar'|'por_designar'|'aprobar', docenteId, ...} }
   */
  /** Horas ya comprometidas en otras unidades de la Universidad para 2027-I → Map<cédula, horas> */
  function procesarCargaInstitucional(rows, profesores) {
    const mapa = new Map();
    if (!rows || !rows.length) return mapa;
    const headers = Object.keys(rows[0]);
    const cId = findCol(headers, [/^identificacion/, /^cedula/, /^numero/, /^documento/]);
    const cNom = findCol(headers, [/^nombre/, /^docente/, /^profesor/]);
    const cHor = findCol(headers, [/horas/, /carga/]);
    if (!cHor || (!cId && !cNom)) return mapa;
    const clave = s => tokens(s).sort().join(' ');
    const porNombre = new Map((profesores || []).map(p => [clave(p.nombre), p.id]));
    rows.forEach(r => {
      let id = cId ? cedula(r[cId]) : '';
      if (!id && cNom) id = cedula(porNombre.get(clave(r[cNom])) || '');
      const h = parseFloat(String(r[cHor]).replace(',', '.'));
      if (id && h > 0) mapa.set(id, (mapa.get(id) || 0) + h);
    });
    return mapa;
  }

  function prepararHistorico(rows) {
    const out = [];
    (rows || []).forEach(r => {
      const id = cedula(r.NUMERO), asignatura = clean(r.ASIGNATURA), programa = clean(r.PROGRAMA);
      if (!id || !asignatura) return;
      const esP = /^practica (pedagogica|profesional)/.test(norm(asignatura));
      out.push({ id, nombre: clean(r.DOCENTE), programa, progN: progN(programa), asignatura, asigN: norm(asignatura), tok: tokens(asignatura), nivel: esP ? nivelPPI(asignatura) : null, grupo: clean(r.GRUPO), periodo: clean(r.PERIODO), cod: clean(r['COD. MAT']) });
    });
    return out;
  }

  /**
   * fase7 (opcional): { hist: filas de prepararHistorico, cargaExt: Map<cédula, horas en otras unidades>,
   *                     autorizaciones: [{docenteId, progN, nivel}], cargaInstCargada: boolean }
   */
  function analizar(ds, cfg, overrides, onProgress, cache, fase7) {
    cfg = Object.assign({}, DEFAULT_CONFIG, cfg || {});
    overrides = overrides || {};
    const perfilPorId = new Map(ds.perfiles.map(p => [p.id, p]));
    const profPorId = new Map(ds.profesores.map(p => [p.id, p]));
    ds.profesores.forEach(prepararProfesor);
    const pool = ds.profesores.filter(p => p.titulos.some(t => t.nivel === 'Profesional') && p.titulos.some(t => ['Especialización', 'Maestría', 'Doctorado'].includes(t.nivel)));

    // Homologación manual de perfiles (decisión académica registrada)
    ds.cursos.forEach(c => {
      if (!c._orig) Object.defineProperty(c, '_orig', { value: { perfilId: c.perfilId, perfilMatch: c.perfilMatch, perfilNota: c.perfilNota }, enumerable: false });
      Object.assign(c, c._orig);
      const o = overrides[c.id];
      if (o && o.perfilId && perfilPorId.has(o.perfilId)) {
        c.perfilId = o.perfilId; c.perfilMatch = 'homologado';
        c.perfilNota = 'Perfil homologado por decisión académica: "' + perfilPorId.get(o.perfilId).titulo + '" (' + perfilPorId.get(o.perfilId).programa + ')' + (o.perfilMotivo ? '. Motivo: ' + o.perfilMotivo : '') + '.';
      }
    });

    // Evaluación por perfil (con caché reutilizable entre ejecuciones)
    const cfgKey = JSON.stringify([cfg.excluirNoCumpleBDC, ds.profesores.length, ds.perfiles.length]);
    if (cache && cache.key !== cfgKey) { cache.key = cfgKey; cache.map = new Map(); }
    if (cache && !cache.map) { cache.key = cfgKey; cache.map = new Map(); }
    const evalPorPerfil = cache ? cache.map : new Map();
    const perfilesUsados = [...new Set(ds.cursos.map(c => c.perfilId).filter(Boolean))].filter(pid => !evalPorPerfil.has(pid));
    perfilesUsados.forEach((pid, i) => {
      const perfil = perfilPorId.get(pid);
      const lista = [];
      const conteo = { pregrado: 0, posgrado: 0, experiencia: 0, total: pool.length };
      pool.forEach(p => {
        const ev = evaluar(perfil, p, cfg, true);
        if (ev.pre.s !== 'N') conteo.pregrado++;
        if (ev.pos && ev.pos.s !== 'N') conteo.posgrado++;
        if (ev.exp && ev.exp.s === 'A') conteo.experiencia++;
        if (ev.tier > 0) lista.push({ id: p.id, ev });
      });
      lista.sort((a, b) => b.ev.tier - a.ev.tier || b.ev.score - a.ev.score || profPorId.get(a.id).nombre.localeCompare(profPorId.get(b.id).nombre, 'es'));
      evalPorPerfil.set(pid, { lista, conteo });
      if (onProgress) onProgress((i + 1) / perfilesUsados.length);
    });

    const carga = new Map(); // docenteId -> horas
    const asignados = new Map(); // docenteId -> [cursoId]
    const horasDe = c => c.horas != null && c.horas !== '' ? Number(c.horas) : Math.round((c.creditos || 0) * cfg.horasPorCredito * 10) / 10;
    const add = (d, c) => { carga.set(d, (carga.get(d) || 0) + horasDe(c)); if (!asignados.has(d)) asignados.set(d, []); asignados.get(d).push(c.id); };

    const res = new Map();
    ds.cursos.forEach(c => {
      const r = {
        id: c.id, horas: horasDe(c), docenteId: null, estado: null, observaciones: [], alternativas: [], ev: null, manual: false, aprobado: false, enAlcance: cfg.planesAsignables.includes(c.plan),
      };
      res.set(c.id, r);
    });

    // 1) decisiones manuales (se respetan y consumen carga primero)
    ds.cursos.forEach(c => {
      const o = overrides[c.id];
      const r = res.get(c.id);
      if (!o) return;
      if (o.accion === 'por_designar') { r.manual = true; r.docenteId = null; r.forzadoPorDesignar = true; r.motivoManual = o.motivo || ''; }
      if (o.docenteId && !profPorId.has(o.docenteId)) {
        r.avisoManual = 'El docente asignado manualmente (' + (o.docenteNombre || o.docenteId) + ') ya no figura en la base de profesores cargada; se recalculó la propuesta.';
      } else if (o.docenteId) {
        r.manual = true; r.docenteId = o.docenteId; r.motivoManual = o.motivo || '';
        add(o.docenteId, c);
        if (o.aprobado) r.aprobado = true;
      }
    });

    // 2) automáticas: primero las asignaturas con menos candidatos idóneos
    const auto = ds.cursos.filter(c => { const r = res.get(c.id); return !r.manual && c.perfilId && r.enAlcance; });
    // Criterio previo: afinidad del pregrado con la asignatura. El posgrado solo habilita revisión manual del Director.
    const preAfin = x => x.ev.pre.s === 'A' || !!x.ev.pre.sinReq;
    const posAfin = x => !!x.ev.pos && (x.ev.pos.s === 'A' || x.ev.pos.s === 'F');
    const tituloPre = id => { const p = profPorId.get(id); const t = p && p.titulos.find(y => y.nivel === 'Profesional'); return t ? t.titulo : ''; };
    const nIdoneos = c => (evalPorPerfil.get(c.perfilId) || { lista: [] }).lista.filter(x => x.ev.tier === 3 && preAfin(x)).length;
    auto.sort((a, b) => nIdoneos(a) - nIdoneos(b) || horasDe(b) - horasDe(a));

    // ---- Fase 7: historial 2026-II, carga institucional total y requisito de pregrado en PPI ----
    const f7 = fase7 || {};
    const hist = f7.hist || [];
    const ext = f7.cargaExt || new Map();
    const histPorProg = new Map();
    hist.forEach(h => { if (!histPorProg.has(h.progN)) histPorProg.set(h.progN, []); histPorProg.get(h.progN).push(h); });
    const horasMax = cfg.maxHoras === 8 ? 'ocho (8)' : String(cfg.maxHoras);
    const extDe = id => ext.get(cedula(id)) || 0;
    const cargaTot = id => (carga.get(id) || 0) + extDe(id);
    const esPPIc = c => c.componente === COMP.PPI;
    const mismaAsig = (c, h) => {
      if (esPPIc(c)) return h.nivel != null && h.nivel === nivelPPI(c.asignatura);
      const a = tokens(c.asignatura);
      return norm(c.asignatura) === h.asigN || (a.length > 0 && h.tok.length > 0 && overlap(a, h.tok) / Math.max(a.length, h.tok.length) >= 0.8);
    };
    const preferidos = c => {
      const rows = histPorProg.get(progN(c.programa)) || [];
      const out = [];
      if (esPPIc(c)) {
        const l = nivelPPI(c.asignatura);
        if (l) {
          const prev = l === 1 ? 6 : l - 1;
          rows.filter(h => h.nivel === prev).forEach(h => out.push({ id: h.id, t: 'progresión', h }));
          rows.filter(h => h.nivel === l).forEach(h => out.push({ id: h.id, t: 'continuidad', h }));
        }
      } else rows.filter(h => mismaAsig(c, h)).forEach(h => out.push({ id: h.id, t: 'continuidad', h }));
      const vistos = new Set();
      return out.filter(o => { if (vistos.has(o.id)) return false; vistos.add(o.id); return true; });
    };
    const incumple = (perfil, prof) => {
      try {
        const ev = evaluar(perfil, prof, cfg);
        const mal = [['Pregrado', ev.pre], ['Posgrado', ev.pos], ['Experiencia docente', ev.exp], ['Hoja de vida', ev.bdc]].filter(x => x[1] && x[1].s === 'N').map(x => x[0] + ': ' + x[1].det);
        return mal.length ? mal.join(' | ') : 'requisitos obligatorios del perfil no acreditados';
      } catch (e) { return 'requisitos obligatorios del perfil no acreditados'; }
    };

    // Pasada 1: continuidad y progresión (reservan carga primero). Pasada 2: resto de asignaturas.
    [1, 2].forEach(pasada => auto.forEach(c => {
      const r = res.get(c.id);
      const info = evalPorPerfil.get(c.perfilId);
      const h = horasDe(c);
      if (pasada === 1) r.f7 = { bloqueos: [], dir: [], doc: [] };
      else if (r.docenteId) return;
      const f = r.f7;
      if (h > cfg.maxHoras) { r.excedeTope = true; return; }
      const ppi = esPPIc(c);
      const cabe = x => cargaTot(x.id) + h <= cfg.maxHoras;
      let elegible = null;
      if (pasada === 1) for (const o of preferidos(c)) {
        const prof = profPorId.get(o.id);
        const nom = prof ? prof.nombre : o.h.nombre;
        const x = prof ? info.lista.find(y => y.id === o.id) : null;
        if (!prof) { f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'Pendiente de validación: el profesor no figura en la base de formación y experiencia cargada' }); continue; }
        if (!x) { f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'incumplimiento de ' + incumple(perfilPorId.get(c.perfilId), prof) }); continue; }
        if (!preAfin(x)) {
          const pg = tituloPre(o.id) || 'sin pregrado registrado';
          if (posAfin(x)) { f.dir.push(x); f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'su pregrado (' + pg + ') no es afín con la asignatura; se evaluó su posgrado, que es afín, y queda para revisión manual del Director' }); }
          else f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'su pregrado (' + pg + ') no es afín con la asignatura' });
          continue;
        }
        if (x.ev.tier < 3) { f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'Pendiente de validación: requisitos del perfil con afinidad por validar o información insuficiente' }); continue; }
        if (!cabe(x)) { f.bloqueos.push({ nombre: nom, t: o.t, motivo: 'superaría el límite máximo de ' + horasMax + ' horas de carga académica total en la Universidad del Magdalena (' + (cargaTot(x.id) + h) + ' h proyectadas)' }); continue; }
        elegible = x; break;
      }
      if (pasada === 2 && !elegible) {
        const cand = info.lista.filter(x => x.ev.tier >= 1 && cabe(x));
        elegible = cand.find(preAfin) || null;
        if (!elegible) {
          const ya = new Set(f.dir.map(x => x.id));
          cand.filter(x => !preAfin(x) && x.ev.pre.s !== 'I' && posAfin(x) && !ya.has(x.id)).forEach(x => f.dir.push(x));
          f.doc = cand.filter(x => x.ev.pre.s === 'I' && !x.ev.pre.sinReq);
        }
      }
      if (elegible) { r.docenteId = elegible.id; add(elegible.id, c); }
    }));

    // 3) estados, alternativas y justificaciones
    ds.cursos.forEach(c => {
      const r = res.get(c.id);
      const perfil = c.perfilId ? perfilPorId.get(c.perfilId) : null;
      const info = c.perfilId ? evalPorPerfil.get(c.perfilId) : null;
      if (r.avisoManual) r.observaciones.push(r.avisoManual);
      if (c.revisionClasificacion) r.observaciones.push(c.revisionClasificacion);
      if (c.perfilNota) r.observaciones.push(c.perfilNota);
      if (perfil && perfil.alertas.length) r.observaciones.push('Alerta del perfil: ' + perfil.alertas.join(' '));
      if (info) {
        const otros = info.lista.filter(x => x.id !== r.docenteId);
        const mapAlt = x => ({ id: x.id, nombre: profPorId.get(x.id).nombre, score: x.ev.score, tier: x.ev.tier, carga: carga.get(x.id) || 0, pregrado: tituloPre(x.id) });
        r.alternativas = otros.filter(preAfin).slice(0, cfg.maxAlternativas).map(mapAlt);
        r.revisionDirector = otros.filter(x => !preAfin(x) && x.ev.pre.s !== 'I' && posAfin(x)).slice(0, cfg.maxAlternativas).map(mapAlt);
        r.conteo = info.conteo;
        r.nIdoneos = info.lista.filter(x => x.ev.tier === 3 && preAfin(x)).length;
        r.nCandidatos = info.lista.filter(preAfin).length;
      }
      const prof = r.docenteId ? profPorId.get(r.docenteId) : null;
      if (prof && perfil) r.ev = evaluar(perfil, prof, cfg);

      // Fase 7: tipo de asignación (continuidad / progresión / nueva), antecedentes y carga total proyectada
      const f = r.f7 || (r.f7 = { bloqueos: [], dir: [], doc: [] });
      const rowsP = histPorProg.get(progN(c.programa)) || [];
      f.prev26 = [...new Set(rowsP.filter(x => mismaAsig(c, x)).map(x => x.nombre))];
      f.tipo = prof ? 'nueva' : 'pendiente'; f.origen = null;
      if (prof && hist.length) {
        const mine = rowsP.filter(x => x.id === prof.id);
        if (esPPIc(c)) {
          const l = nivelPPI(c.asignatura), prev = l === 1 ? 6 : l - 1;
          const hp = l && mine.find(x => x.nivel === prev), hc = l && mine.find(x => x.nivel === l);
          if (hp) { f.tipo = 'progresión'; f.origen = hp; f.nivelOrigen = prev; f.nivelDestino = l; }
          else if (hc) { f.tipo = 'continuidad'; f.origen = hc; }
        } else { const hc = mine.find(x => mismaAsig(c, x)); if (hc) { f.tipo = 'continuidad'; f.origen = hc; } }
      }
      f.cargaTotal = prof ? cargaTot(prof.id) : null;
      f.cargaExt = prof ? extDe(prof.id) : 0;
      const tPre = prof ? prof.titulos.find(t => t.nivel === 'Profesional') : null;
      f.pregrado = tPre ? tPre.titulo : '';
      f.preS = r.ev && r.ev.pre ? r.ev.pre.s : '';
      const obsBloqueos = () => f.bloqueos.map(b => 'No se propone la asignación de ' + b.nombre + ' (' + b.t + ' desde 2026-II): ' + b.motivo.replace(/\.+$/, '') + '.');

      if (!perfil) {
        r.estado = EST.SINP; r.docenteId = r.manual && prof ? r.docenteId : null;
        r.observaciones.unshift('Perfil no disponible.');
        if (r.manual && prof) { r.estado = r.aprobado ? EST.APROB : EST.VALID; r.observaciones.push('Asignación manual sin perfil de referencia: ' + (r.motivoManual || 'sin justificación registrada') + '.'); }
        return;
      }
      if (r.forzadoPorDesignar) {
        r.estado = EST.PEND; r.observaciones.unshift('Marcada manualmente como "Por designar". Motivo: ' + (r.motivoManual || 'no indicado') + '.');
        return;
      }
      if (!r.enAlcance && !r.manual) {
        r.estado = EST.PEND;
        r.observaciones.unshift('El ' + c.plan.toLowerCase() + ' no está incluido en la asignación automática (configuración). ' + (r.nIdoneos ? r.nIdoneos + ' profesores cumplen los requisitos verificables.' : ''));
        return;
      }
      if (!prof && f.dir.length) {
        r.estado = EST.DIR;
        r.observaciones.unshift('Ningún docente con pregrado afín a la asignatura está disponible. No se asigna automáticamente: candidatos con posgrado afín que deben ser revisados manualmente por el Director del Departamento: ' + f.dir.slice(0, 5).map(x => profPorId.get(x.id).nombre + ' (pregrado: ' + (tituloPre(x.id) || 'no registrado') + ')').join('; ') + '. Si el Director lo autoriza, asígnelo desde la matriz de correspondencia.', ...obsBloqueos());
        return;
      }
      if (!prof && f.doc.length) {
        r.estado = EST.VALDOC;
        r.observaciones.unshift('Pendiente de validación documental: no es posible comprobar el título de pregrado de ' + f.doc.slice(0, 5).map(x => profPorId.get(x.id).nombre).join('; ') + '.', ...obsBloqueos());
        return;
      }
      if (!prof) {
        r.estado = EST.PEND;
        if (f.bloqueos.length) r.observaciones.unshift(...obsBloqueos());
        if (r.excedeTope) r.observaciones.unshift('La carga estimada de la asignatura (' + r.horas + ' h) supera el tope de ' + cfg.maxHoras + ' h por docente; requiere distribución por grupos o definición de horas de acompañamiento. Profesores idóneos identificados: ' + (r.nIdoneos || 0) + '.');
        else if (r.nCandidatos > 0) r.observaciones.unshift('No se propone la asignación porque el profesor superaría el límite máximo de ' + horasMax + ' horas de carga académica total en la Universidad del Magdalena: los ' + r.nCandidatos + ' profesores con correspondencia verificable ya alcanzaron el tope de ' + cfg.maxHoras + ' h.');
        else {
          const k = info.conteo;
          r.observaciones.unshift('Ningún profesor de la base acredita simultáneamente los requisitos obligatorios del perfil (pregrado: ' + k.pregrado + ' cumplen; posgrado y pregrado: ' + k.posgrado + '; con experiencia docente suficiente: ' + k.experiencia + ').');
        }
        return;
      }
      // con docente
      const ev = r.ev;
      const just = [];
      just.push((r.manual ? 'Asignación manual' + (r.motivoManual ? ' (motivo: ' + r.motivoManual + ')' : '') : 'Propuesta automática') + ': ' + prof.nombre + '.');
      just.push('Pregrado — ' + ev.pre.det);
      if (ev.pos) just.push('Posgrado — ' + ev.pos.det);
      if (ev.exp) just.push('Experiencia — ' + ev.exp.det);
      if (ev.inv) just.push('Investigación — ' + ev.inv.det);
      if (ev.bdc) just.push(ev.bdc.det);
      just.push('Pendiente de verificar con soportes: experiencia específica y competencias del perfil.');
      if (r.alternativas.length) just.push('Alternativas en orden de pertinencia: ' + r.alternativas.map((a, i) => (i + 1) + ') ' + a.nombre + ' (' + a.score + (a.tier < 3 ? ', validar' : '') + (a.carga + r.horas > cfg.maxHoras ? ', sin disponibilidad: ' + a.carga + ' h asignadas' : '') + ')').join('; ') + '. El orden considera la disponibilidad de carga: un profesor con mayor puntaje pudo quedar asignado a otra asignatura con menos candidatos idóneos' + '.');
      r.observaciones.unshift(...just);
      const obsF7 = [];
      if (f.tipo === 'continuidad' && ev.tier === 3) obsF7.push('Se propone continuidad desde 2026-II por cumplimiento verificado del perfil requerido.');
      if (f.tipo === 'progresión' && ev.tier === 3) obsF7.push('Se propone progresión de PPI ' + ROMANO(f.nivelOrigen) + ' a PPI ' + ROMANO(f.nivelDestino) + ', con verificación satisfactoria del perfil de destino.');
      if (r.manual && ev.pre.s !== 'A') obsF7.push('Asignación manual con pregrado no afín (' + (tituloPre(prof.id) || 'no registrado') + '): debe constar la decisión del Director del Departamento en el motivo registrado.');
      obsF7.push(...obsBloqueos());
      if (hist.length && !f7.cargaInstCargada) obsF7.push('Pendiente de validación: falta la carga académica 2027-I comprometida en otras unidades de la Universidad (carga total considerada: ' + f.cargaTotal + ' h, solo la de este análisis).');
      r.observaciones.unshift(...obsF7);
      if (ev.tier === 0) {
        r.estado = EST.VALID;
        r.observaciones.unshift('ATENCIÓN: el docente asignado manualmente no acredita los requisitos obligatorios verificables del perfil.');
      } else if (ev.tier < 3) {
        r.estado = r.aprobado ? EST.APROB : EST.VALID;
        r.observaciones.unshift(ev.tier === 2 ? 'Requiere validar la afinidad de la formación con el perfil.' : 'Falta información para comprobar la idoneidad (requisitos con información insuficiente).');
      } else r.estado = r.aprobado ? EST.APROB : EST.PROP;
      if (r.aprobado && ev.tier > 0) r.estado = EST.APROB;
    });

    return { resultados: res, carga, asignados, evalPorPerfil, config: cfg };
  }

  /* ------------------------------------------------------------------ */
  /* Filas de reporte (columnas A–J y complementarias)                    */
  /* ------------------------------------------------------------------ */
  function filasReporte(ds, analisis) {
    const perfilPorId = new Map(ds.perfiles.map(p => [p.id, p]));
    const profPorId = new Map(ds.profesores.map(p => [p.id, p]));
    return ds.cursos.map(c => {
      const r = analisis.resultados.get(c.id);
      const prof = r.docenteId ? profPorId.get(r.docenteId) : null;
      const perfil = c.perfilId ? perfilPorId.get(c.perfilId) : null;
      return {
        id: c.id,
        programa: c.programa,
        componente: c.componente,
        codigo: c.codigo || 'Sin código en el plan',
        asignatura: c.asignatura,
        docente: prof ? prof.nombre : 'Por designar',
        perfilDocente: prof ? resumenProfesor(prof) : '',
        perfilRequerido: perfil ? resumenPerfil(perfil) : 'Perfil no disponible',
        correspondencia: r.ev ? textoCorrespondencia(r.ev) : (perfil ? 'Sin docente con correspondencia verificable.' : 'No evaluable: perfil no disponible.'),
        estado: r.estado,
        observaciones: r.observaciones.join('\n'),
        plan: c.plan,
        semestre: c.semestre,
        creditos: c.creditos,
        horas: r.horas,
        componenteOficial: c.componenteOficial,
        perfilAsociado: perfil ? perfil.titulo + (c.perfilMatch === 'equivalente' ? ' (equivalencia)' : '') : '',
        puntaje: r.ev ? r.ev.score : '',
        alternativas: r.alternativas.map((a, i) => (i + 1) + '. ' + a.nombre + ' (' + a.score + (a.tier < 3 ? ', validar' : '') + ')').join('\n'),
        revision: c.revisionClasificacion || '',
        manual: r.manual ? 'Sí' : 'No',
        docenteId: r.docenteId || '',
        docente2026: r.f7 && r.f7.prev26 && r.f7.prev26.length ? r.f7.prev26.join('; ') : '',
        tipoAsignacion: r.f7 && r.f7.tipo ? ({ continuidad: 'Continuidad', 'progresión': 'Progresión PPI', nueva: 'Nueva asignación', pendiente: 'Pendiente' }[r.f7.tipo] || '') : '',
        cargaTotal: r.f7 && r.f7.cargaTotal != null ? r.f7.cargaTotal : '',
        revisionDirector: (r.revisionDirector || []).map((a, i) => (i + 1) + '. ' + a.nombre + (a.pregrado ? ' (pregrado: ' + a.pregrado + ')' : '')).join('\n'),
        f7: r.f7 || null,
      };
    });
  }

  function estadisticas(ds, analisis) {
    const filas = ds.cursos.map(c => ({ c, r: analisis.resultados.get(c.id) }));
    const total = filas.length;
    const porComp = {}; COMP_ORDEN.forEach(k => porComp[k] = 0);
    const porEstado = {}; ESTADOS.forEach(k => porEstado[k] = 0);
    filas.forEach(({ c, r }) => { porComp[c.componente]++; porEstado[r.estado]++; });
    const conDocente = filas.filter(x => x.r.docenteId).length;
    const programas = [...new Set(ds.cursos.map(c => c.programa))];
    const porPrograma = programas.map(p => {
      const f = filas.filter(x => x.c.programa === p);
      const o = { programa: p, total: f.length };
      COMP_ORDEN.forEach(k => o[k] = f.filter(x => x.c.componente === k).length);
      ESTADOS.forEach(k => o[k] = f.filter(x => x.r.estado === k).length);
      o.conDocente = f.filter(x => x.r.docenteId).length;
      return o;
    });
    const docentes = [...analisis.carga.keys()].length;
    return {
      programas: programas.length, total, porComp, porEstado, conDocente,
      pendientes: porEstado[EST.PEND], sinPerfil: porEstado[EST.SINP],
      pctAprobadas: total ? Math.round(porEstado[EST.APROB] / total * 1000) / 10 : 0,
      porPrograma, docentes,
    };
  }

  /* ------------------------------------------------------------------ */
  /* FASE 6. Validación y control de calidad                             */
  /* ------------------------------------------------------------------ */
  function controlCalidad(ds, analisis, extra) {
    extra = extra || {};
    const checks = [];
    const ok = (nombre, pasa, detalle, nivel) => checks.push({ nombre, estado: pasa ? 'Cumple' : (nivel || 'Revisar'), detalle });
    const perfilPorId = new Map(ds.perfiles.map(p => [p.id, p]));
    const profPorId = new Map(ds.profesores.map(p => [p.id, p]));
    const filas = ds.cursos.map(c => ({ c, r: analisis.resultados.get(c.id) }));

    // 1. asignaturas corresponden a planes
    const sinArchivo = ds.cursos.filter(c => !c.plan);
    ok('Todas las asignaturas provienen de los planes de estudio suministrados', !sinArchivo.length, ds.cursos.length + ' asignaturas extraídas de ' + (extra.planes || []).length + ' archivo(s) de plan.');
    // 2. programa correcto
    const progs = new Set((extra.programasPlan || []).map(norm));
    const malProg = ds.cursos.filter(c => progs.size && !progs.has(norm(c.programa)));
    ok('Cada asignatura está asociada al programa académico de su plan', !malProg.length, malProg.length ? malProg.length + ' asignaturas con programa no reconocido.' : 'Sin inconsistencias.');
    // 3. perfiles corresponden
    const malPerfil = ds.cursos.filter(c => c.perfilId && perfilPorId.get(c.perfilId).programa !== c.programa);
    const equiv = ds.cursos.filter(c => c.perfilMatch === 'equivalente');
    ok('Los perfiles utilizados corresponden al programa y a la asignatura', !malPerfil.length, (malPerfil.length ? malPerfil.length + ' perfiles de otro programa. ' : '') + equiv.length + ' asociaciones por equivalencia de denominación señaladas para validación.');
    // 4. propuestos cumplen
    const noCumple = filas.filter(x => x.r.docenteId && x.r.ev && x.r.ev.tier === 0);
    const propNoTier3 = filas.filter(x => x.r.estado === EST.PROP && (!x.r.ev || x.r.ev.tier !== 3));
    ok('Los profesores con estado "Asignación propuesta" acreditan los requisitos obligatorios verificables', !propNoTier3.length, propNoTier3.length ? propNoTier3.length + ' casos inconsistentes.' : 'Todas las propuestas cumplen pregrado, posgrado, experiencia mínima y estado de hoja de vida.');
    ok('Asignaciones manuales que no cumplen requisitos están marcadas para validación', noCumple.every(x => x.r.estado === EST.VALID), noCumple.length + ' asignaciones manuales sin requisitos verificables.');
    // 5. sin información inventada
    const inventadas = filas.filter(x => x.r.docenteId && !profPorId.has(x.r.docenteId));
    ok('No existen asignaciones sustentadas en docentes inexistentes en la base', !inventadas.length, inventadas.length ? inventadas.length + ' docentes no encontrados.' : 'Todas las justificaciones citan títulos y experiencia registrados en los archivos.');
    // 6. pendientes
    const malPend = filas.filter(x => (!x.c.perfilId && x.r.estado !== EST.SINP && !x.r.manual) || (!x.r.docenteId && ![EST.PEND, EST.SINP].includes(x.r.estado)));
    ok('Asignaturas sin perfil o sin docente idóneo figuran como pendientes', !malPend.length, malPend.length ? malPend.length + ' casos.' : 'Sin perfil: ' + filas.filter(x => x.r.estado === EST.SINP).length + '; pendientes por designar: ' + filas.filter(x => x.r.estado === EST.PEND).length + '.');
    // 7. carga
    const exceso = [...analisis.carga.entries()].filter(([d, h]) => h > analisis.config.maxHoras);
    ok('Ningún docente supera el tope de ' + analisis.config.maxHoras + ' h', !exceso.length, exceso.length ? exceso.length + ' docentes exceden el tope (asignaciones manuales).' : analisis.carga.size + ' docentes con carga asignada.');
    // 8. duplicados
    ok('No hay asignaturas duplicadas en los planes', !(extra.duplicados || []).length, (extra.duplicados || []).length + ' filas duplicadas omitidas.');
    // 9. revisión de clasificación
    const rev = ds.cursos.filter(c => c.revisionClasificacion);
    ok('Clasificación de componentes sin dudas', !rev.length, rev.length + ' asignaturas señaladas para revisión de clasificación.', 'Revisar');
    // 10. perfiles sin asignatura
    const huerf = extra.huerfanos || [];
    ok('Todos los perfiles suministrados corresponden a asignaturas de los planes', !huerf.length, huerf.length ? huerf.length + ' perfiles sin asignatura asociada: ' + huerf.slice(0, 8).map(p => p.programa.replace('Licenciatura en ', '') + ' – ' + p.titulo).join('; ') + (huerf.length > 8 ? '…' : '') : 'Sin perfiles huérfanos.', 'Revisar');
    // Fase 7: pregrado primero, continuidad sustentada y carga institucional
    const preMal = filas.filter(x => x.r.docenteId && !x.r.manual && x.r.ev && x.r.ev.pre.s !== 'A' && !x.r.ev.pre.sinReq);
    ok('Toda propuesta automática tiene pregrado afín con la asignatura (criterio previo)', !preMal.length, preMal.length ? preMal.length + ' propuestas automáticas sin pregrado afín.' : 'Sin excepciones: los docentes con pregrado no afín solo quedan para revisión del Director.');
    const contMal = filas.filter(x => x.r.f7 && ['continuidad', 'progresión'].includes(x.r.f7.tipo) && (!x.r.ev || x.r.ev.tier !== 3));
    ok('Las continuidades y progresiones están sustentadas en cumplimiento verificado del perfil', !contMal.length, contMal.length ? contMal.length + ' casos sin cumplimiento verificado (asignaciones manuales).' : 'Todas verifican pregrado, posgrado, experiencia y hoja de vida.');
    const cargaMal = filas.filter(x => x.r.f7 && x.r.f7.cargaTotal != null && x.r.f7.cargaTotal > analisis.config.maxHoras);
    ok('Ninguna propuesta supera el tope de ' + analisis.config.maxHoras + ' h de carga total institucional', !cargaMal.length, cargaMal.length ? cargaMal.length + ' asignaciones superan el tope considerando la carga de otras unidades.' : 'Carga total (propuesta + otras unidades cargadas) dentro del tope.');
    const alertas = ds.perfiles.filter(p => p.alertas.length);
    ok('Documentos de perfiles completos', !alertas.length, alertas.length + ' perfiles con secciones faltantes o inconsistentes: ' + alertas.map(p => p.programa.replace('Licenciatura en ', '') + ' – ' + p.titulo).join('; '), 'Revisar');
    return checks;
  }

  /* ------------------------------------------------------------------ */
  /* Construcción del conjunto de datos a partir de las fuentes          */
  /* ------------------------------------------------------------------ */
  /**
   * fuentes = { planes:[{archivo, plan, rows}], perfilDocs:[{archivo, programaDetectado, perfiles}],
   *             formacion:{archivo, personas:[...]}, experiencia:{archivo, personas:[...]} }
   */
  function construirDataset(fuentes) {
    const planes = fuentes.planes || [];
    const inv = inventario(planes);
    const perfiles = [];
    (fuentes.perfilDocs || []).forEach(d => {
      const prog = d.programaDetectado ? matchPrograma(d.programaDetectado, inv.programas) : null;
      d.programa = prog;
      d.perfiles.forEach(p => {
        p.programa = prog;
        p.id = hash((prog || '') + '|' + norm(p.titulo));
        perfiles.push(p);
      });
    });
    const vin = vincularPerfiles(inv.cursos, perfiles);
    const fm = new Map(((fuentes.formacion && fuentes.formacion.personas) || []).map(x => [x.id, x]));
    const em = new Map(((fuentes.experiencia && fuentes.experiencia.personas) || []).map(x => [x.id, x]));
    const profesores = consolidarProfesores(fm, em);
    return {
      ds: { cursos: inv.cursos, perfiles, profesores },
      meta: {
        excluidas: inv.excluidas, duplicados: inv.duplicados, programasPlan: inv.programas,
        huerfanos: vin.huerfanos.map(p => ({ id: p.id, programa: p.programa, titulo: p.titulo })),
        planes: planes.map(p => ({ archivo: p.archivo, plan: p.plan, filas: p.rows.length })),
        soloFormacion: [...fm.keys()].filter(k => !em.has(k)).length, soloExperiencia: [...em.keys()].filter(k => !fm.has(k)).length,
      },
    };
  }

  /** Identifica archivos faltantes, duplicados o inconsistentes. */
  function diagnosticoArchivos(fuentes, meta) {
    const out = [];
    const add = (tipo, nivel, msg) => out.push({ tipo, nivel, msg });
    const planes = fuentes.planes || [], docs = fuentes.perfilDocs || [];
    if (!planes.length) add('Faltante', 'error', 'No se ha cargado ningún plan de estudios.');
    if (!docs.length) add('Faltante', 'error', 'No se ha cargado ningún documento de perfiles docentes.');
    if (!fuentes.formacion) add('Faltante', 'error', 'No se ha cargado la base de formación académica de profesores.');
    if (!fuentes.experiencia) add('Faltante', 'error', 'No se ha cargado la base de experiencia de profesores.');
    const tipos = {};
    planes.forEach(p => { tipos[p.plan] = (tipos[p.plan] || 0) + 1; });
    Object.keys(tipos).forEach(t => { if (tipos[t] > 1) add('Duplicado', 'warn', 'Hay ' + tipos[t] + ' archivos cargados como "' + t + '".'); });
    const porProg = {};
    docs.forEach(d => { const k = d.programa || '(sin programa)'; (porProg[k] = porProg[k] || []).push(d.archivo); });
    Object.keys(porProg).forEach(k => { if (porProg[k].length > 1) add('Duplicado', 'warn', 'Más de un documento de perfiles para ' + k + ': ' + porProg[k].join(', ') + '.'); });
    docs.forEach(d => {
      if (!d.programa) add('Inconsistente', 'warn', 'No se pudo identificar el programa del documento "' + d.archivo + '".');
      else if (meta && meta.programasPlan && !meta.programasPlan.includes(d.programa)) add('Inconsistente', 'warn', 'El documento "' + d.archivo + '" corresponde a un programa que no figura en los planes cargados (' + d.programa + ').');
      if (!d.perfiles.length) add('Inconsistente', 'error', 'El documento "' + d.archivo + '" no contiene perfiles reconocibles.');
    });
    if (meta && meta.programasPlan) meta.programasPlan.forEach(p => { if (!porProg[p]) add('Faltante', 'warn', 'No hay documento de perfiles para ' + p + '.'); });
    if (meta && meta.huerfanos && meta.huerfanos.length) add('Inconsistente', 'info', meta.huerfanos.length + ' perfiles no se vinculan a ninguna asignatura de los planes.');
    if (meta && meta.duplicados && meta.duplicados.length) add('Duplicado', 'warn', meta.duplicados.length + ' asignaturas repetidas en los planes (se conservó la primera aparición).');
    if (meta && meta.soloFormacion) add('Inconsistente', 'info', meta.soloFormacion + ' personas tienen formación registrada pero no experiencia.');
    if (meta && meta.soloExperiencia) add('Inconsistente', 'info', meta.soloExperiencia + ' personas tienen experiencia registrada pero no formación (se usa el texto de formación de la base de experiencia, sin verificación de grado).');
    if (!out.length) add('Correcto', 'ok', 'Todos los archivos requeridos están cargados y son consistentes.');
    return out;
  }

  return {
    VERSION, COMP, construirDataset, diagnosticoArchivos, matchPrograma, COMP_ORDEN, EST, ESTADOS, R, DEFAULT_CONFIG,
    norm, tokens, hash, abreviarPrograma, canonPrograma, nivelPPI, ROMANO, progN, cedula,
    procesarPlan, inventario, clasificar, docxParagraphs, parsePerfiles, vincularPerfiles, requisitos,
    procesarFormacion, procesarExperiencia, consolidarProfesores, evaluar, analizar, prepararHistorico, procesarCargaInstitucional,
    resumenProfesor, resumenPerfil, textoCorrespondencia, nivelCorrespondencia, filasReporte, estadisticas, controlCalidad,
  };
});
