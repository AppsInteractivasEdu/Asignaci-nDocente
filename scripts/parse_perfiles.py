"""Extrae los perfiles docentes por asignatura de los documentos Word de cada programa."""
import docx, glob, json, os, re, sys, unicodedata

LABELS = {
    'formación de pregrado': 'pregrado',
    'formación posgradual': 'posgrado',
    'experiencia docente y profesional': 'experiencia',
    'experiencia docente': 'experiencia',
    'experiencia en práctica pedagógica': 'experiencia',
    'experiencia y producción investigativa': 'investigacion',
    'experiencia y producción académica': 'investigacion',
    'experiencia y competencias investigativas': 'investigacion',
    'producción académica': 'investigacion',
    'criterio integral de idoneidad': 'idoneidad',
}

PROGRAMA_POR_ARCHIVO = {
    'Etnoeducacion': 'Licenciatura en Etnoeducación',
    'Literatura y Lengua Castellana': 'Licenciatura en Literatura y Lengua Castellana',
    'Matematicas': 'Licenciatura en Matemáticas',
    'Quimica': 'Licenciatura en Química',
    'Ciencias Naturales': 'Licenciatura en Ciencias Naturales y Educación Ambiental',
    'Lenguas Extranjeras': 'Licenciatura en Lenguas Extranjeras con Énfasis en Inglés',
    'Artes': 'Licenciatura en Artes',
    'Campesina': 'Licenciatura en Educación Campesina y Rural',
    'Infantil': 'Licenciatura en Educación Infantil',
    'Tecnologia': 'Licenciatura en Tecnología',
}


def programa_de(nombre):
    for k, v in PROGRAMA_POR_ARCHIVO.items():
        if k.lower() in nombre.lower():
            return v
    return None


def componente_de(t):
    l = t.lower()
    if 'práctica' in l or 'practica' in l:
        return 'Práctica Pedagógica Investigativa'
    if 'didáctic' in l:
        return 'Didáctica de las Disciplinas'
    if 'pedagógico' in l:
        return 'Pedagógico'
    return None


def parse(path):
    d = docx.Document(path)
    paras = [p.text.strip() for p in d.paragraphs if p.text.strip()]
    cursos, actual, seccion, comp = [], None, None, None
    pend_comp = None
    for i, t in enumerate(paras):
        low = t.lower().rstrip(':')
        nxt = paras[i + 1] if i + 1 < len(paras) else ''
        nxt2 = paras[i + 2] if i + 2 < len(paras) else ''
        if low.startswith('componente') and len(t) < 80 and not low.startswith('competencia'):
            comp = componente_de(t)
            continue
        es_titulo = (len(t) < 140 and low not in LABELS and not low.startswith('competencia')
                     and not t.startswith('Título') and not t.startswith('La idoneidad')
                     and (nxt.startswith('El docente') or nxt.lower() == 'formación de pregrado'
                          or (nxt2.lower() == 'formación de pregrado' and len(nxt) > 150)))
        if es_titulo:
            nombre = re.sub(r'\s*\((plan de transi[cç]+i[oó]n)\)\s*$', '', t, flags=re.I).strip()
            transicion = bool(re.search(r'transi', t, re.I))
            actual = {'titulo_original': t, 'asignatura': nombre, 'plan_transicion': transicion,
                      'componente_doc': comp, 'descripcion': '', 'pregrado': '', 'posgrado': '',
                      'experiencia': '', 'investigacion': '', 'idoneidad': '', 'competencias': [], 'otros': []}
            cursos.append(actual)
            seccion = 'descripcion'
            continue
        if actual is None:
            continue
        if low in LABELS:
            seccion = LABELS[low]
            continue
        if low.startswith('competencia') and len(t) < 120 and not t.endswith('.'):
            actual['competencias'].append({'nombre': t, 'descripcion': ''})
            seccion = 'competencia'
            continue
        if len(t) < 80 and not t.endswith('.') and seccion not in ('descripcion',):
            # sub-rótulo particular (p.ej. "Dominio del idioma inglés")
            actual['otros'].append({'nombre': t, 'descripcion': ''})
            seccion = 'otro'
            continue
        if seccion == 'competencia':
            c = actual['competencias'][-1]
            c['descripcion'] = (c['descripcion'] + ' ' + t).strip()
        elif seccion == 'otro':
            o = actual['otros'][-1]
            o['descripcion'] = (o['descripcion'] + ' ' + t).strip()
        else:
            actual[seccion] = (actual[seccion] + ' ' + t).strip()
    return cursos


def main(carpeta, salida):
    out = []
    for f in sorted(glob.glob(os.path.join(carpeta, 'Perfil docente*.docx'))):
        prog = programa_de(os.path.basename(f))
        for c in parse(f):
            c['programa'] = prog
            c['archivo'] = os.path.basename(f)
            out.append(c)
    json.dump(out, open(salida, 'w'), ensure_ascii=False, indent=1)
    print(len(out), 'perfiles extraídos')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
