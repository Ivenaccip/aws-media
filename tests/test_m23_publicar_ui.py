"""C2 · Publicar en la nube — la interfaz del modal de Publicar del editor.

Lo que este archivo defiende:
  * que nada de lo que llega del servidor, de Blotato o del LLM entre a un
    innerHTML sin escapar (nombres de cuentas, títulos, destinos, archivos,
    mensajes): la cookie del token es legible desde JavaScript;
  * que el botón de enviar no se pueda pulsar dos veces, y que se apague
    DESPUÉS del confirm();
  * que el cuerpo del POST lleve solo los campos de la red, con la marca de IA
    y la privacidad como decidió el dueño (16-sep);
  * que el sondeo del avance no se duplique, no muera por la red y pare al
    cerrar el modal.

Sin red y sin gastar: el HTML se lee como texto y la lógica corre en node con
un DOM mínimo (se salta si no hay node).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
HTML = (RAIZ / "tools" / "editor" / "index.html").read_text(encoding="utf-8")

INICIO_B3 = "// ── b3 · Publicar (C2)"


def _tramo(desde: str, hasta: str, texto: str = HTML) -> str:
    i = texto.index(desde)
    return texto[i:texto.index(hasta, i)]


B3 = _tramo(INICIO_B3, "async function g1abrir(")          # todo el JS del modal
PURO = _tramo(INICIO_B3, "async function b3abrir()")        # lo que corre en node
MODAL = _tramo('<div id="b3modal">', '<div id="b1modal">')  # el marcado fijo
AYUDANTES = _tramo("function esc(s)", "const fj =")         # esc y fjDetalle


def _plano(s: str) -> str:
    return " ".join(s.split())


def _funcion(nombre: str) -> str:
    """El cuerpo de una función del tramo b3, hasta la siguiente de primer nivel."""
    i = B3.index(nombre)
    m = re.search(r"\n(?:async )?function |\nconst ", B3[i + 1:])
    return B3[i:i + 1 + m.start()] if m else B3[i:]


# ---------------------------------------------------------------------------
# XSS: todo dato externo que llega a un innerHTML pasa por esc()

def test_existe_esc_y_escapa_los_cinco_caracteres():
    assert "function esc(s)" in HTML
    for par in ('"&": "&amp;"', '"<": "&lt;"', '">": "&gt;"', "'\"': \"&quot;\"", "\"'\": \"&#39;\""):
        assert par in AYUDANTES, f"esc no escapa {par}"


@pytest.mark.parametrize("uso,que", [
    ("esc(c.fullname || c.username)", "nombre de la cuenta de Blotato"),
    ("esc(B3REDES[c.platform].nombre || c.platform)", "nombre de la red"),
    ("esc(d.nombre)", "nombre del archivo"),
    ("esc(d.mb)", "tamaño del archivo"),
    ("esc(encodeURIComponent(peli.clave))", "clave del descargable en el href"),
    ("esc(t)", "títulos del LLM"),
    ('value="${esc(x.id)}"', "id del destino"),
    ("esc(x.nombre || x.id)", "nombre del destino"),
    ("esc(val)", "valor de privacidad"),
    ("esc(etq)", "etiqueta de privacidad"),
    ("esc(st.error)", "error del estado"),
    ("esc(cu.error)", "error de las cuentas"),
    ("esc(e.message)", "mensaje de error del servidor"),
    ("esc(p.cuenta_nombre)", "cuenta de la publicación"),
    ("esc(txt)", "título o texto de la publicación"),
    ("esc(msg)", "mensaje de la publicación"),
    ('href="${esc(p.url)}"', "enlace «Ver»"),
])
def test_cada_dato_externo_pasa_por_esc(uso, que):
    assert uso in B3, f"{que} se pinta sin escapar"


# Interpolaciones que NO son datos externos: índices y constantes internas.
INTERNAS = {"i", "clase", 'o[1] ? " checked" : ""'}


def _plantillas_html() -> list[str]:
    """Cada `x.innerHTML = …;` del tramo b3, y cada línea que arma una etiqueta
    fuera de esa asignación (las filas de b3fila, las <option> de destinos)."""
    fuera = [m.group(0) for m in re.finditer(r"\.innerHTML\s*=.*?;\n", B3, re.S)]
    fuera += [linea for linea in B3.splitlines() if re.search(r"<[a-z]", linea)]
    return fuera


def test_ningun_innerhtml_interpola_datos_sin_escapar():
    plantillas = _plantillas_html()
    # las hojas: ${…} sin llaves dentro (las externas llevan un .map anidado)
    hojas = [_plano(e) for p in plantillas for e in re.findall(r"\$\{([^{}]*)\}", p)]
    assert len(hojas) >= 30, "el recorte dejó de encontrar las plantillas: la prueba no vería nada"
    for e in hojas:
        assert e.startswith("esc(") or e in INTERNAS, \
            f"interpolación sin escapar en un innerHTML: ${{{e}}}"


def test_el_enlace_ver_solo_acepta_http():
    assert r"/^https?:\/\//i.test(p.url)" in B3
    assert 'rel="noopener noreferrer"' in _funcion("function b3fila(")


def test_fj_explica_el_422_de_pydantic():
    fj = HTML[HTML.index("const fj = (url, body)"):]
    fj = fj[:fj.index("\n", fj.index(".then("))]
    assert "fjDetalle(await r.json()" in fj
    assert ".detail ||" not in fj, "vuelve el «[object Object]»"


# ---------------------------------------------------------------------------
# lo que ya no está, y lo que no se cobra

def test_programar_ya_no_llega_pronto():
    assert "llega muy pronto" not in HTML
    assert "st.agendar === false" not in HTML
    assert "st.agendar" not in HTML


@pytest.mark.parametrize("tramo", ["modal", "js"])
def test_sugerir_titulos_es_gratis(tramo):
    texto = MODAL if tramo == "modal" else B3
    assert "$0.0" not in texto
    assert "dólares" not in texto
    assert "~$" not in texto
    assert "créditos" not in texto


def test_el_boton_de_titulos_no_trae_tooltip_de_costo():
    boton = re.search(r'<button[^>]*id="b3sugerir"[^>]*>', B3).group(0)
    assert "title=" not in boton


def test_el_orbe_de_titulos_no_dice_claude():
    """Los títulos no los escribe Claude: el orbe no puede decir que sí."""
    llamada = B3[B3.index('orbeOn("orbe-b3"'):]
    llamada = llamada[:llamada.index(");")]
    assert "Claude" not in llamada
    assert "Escribiendo títulos" in llamada
    assert "api/publicar/titulos" in B3


def test_enviar_no_lleva_orbe():
    """Subir el mp4 es espera mecánica: el orbe promete que hay alguien pensando."""
    handler = B3[B3.index('$("b3agendar").onclick'):]
    handler = handler[:handler.index("\n  };")]
    assert "orbeOn(" not in handler


# ---------------------------------------------------------------------------
# el botón de enviar

def _handler_agendar() -> str:
    h = B3[B3.index('$("b3agendar").onclick'):]
    return h[:h.index("\n  };")]


def test_enviar_se_apaga_despues_del_confirm_y_antes_del_await():
    h = _handler_agendar()
    confirmar = h.index("confirm(")
    apagar = h.index('$("b3agendar").disabled = true')
    espera = h.index("await")
    assert confirmar < apagar < espera, \
        "el botón debe apagarse después del confirm y antes de la petición"
    assert h.index("b3validar(") < confirmar, "se valida antes de preguntar"


def test_enviar_vuelve_a_la_vida_aunque_falle():
    h = _handler_agendar()
    fin = h[h.index("finally {"):]
    assert '$("b3agendar").disabled = false' in fin


def test_enviar_hace_el_post_del_contrato_y_sigue_el_avance():
    h = _handler_agendar()
    assert 'fj("api/publicar/agendar", cuerpo)' in h
    assert "const cuerpo = b3cuerpo(red, v);" in h
    assert "b3sondear();" in h
    assert "Enviado: sigue el avance abajo" in h
    assert "r.publicacion" in h


# ---------------------------------------------------------------------------
# lo que pide al servidor

def test_abrir_pide_estado_y_cuentas_por_separado():
    abrir = _funcion("async function b3abrir()")
    assert abrir.index('fj("api/publicar/estado")') < abrir.index('fj("api/publicar/cuentas")')
    # la descarga y las publicaciones se pintan ANTES de esperar a Blotato
    assert abrir.index("b3pintarPubs(") < abrir.index('fj("api/publicar/cuentas")')
    assert abrir.index('$("b3descargas").innerHTML') < abrir.index('fj("api/publicar/cuentas")')
    assert "cargando tus redes…" in abrir
    assert "st.cuentas" not in B3 and "st.reconectar" not in B3


def test_blotato_sin_redes_lo_dice_y_no_muestra_formulario():
    abrir = _plano(_funcion("async function b3abrir()"))
    assert ("Tu Blotato no tiene redes conectadas todavía. "
            "Conéctalas en Blotato y vuelve a abrir Publicar.") in abrir
    i = abrir.index("if (!todas.length)")
    assert abrir.index("return;", i) < abrir.index("b3formulario(gen);")


def test_solo_se_ofrecen_redes_con_reglas():
    assert "B3CUENTAS = todas.filter(c => B3REDES[c.platform]);" in B3


def test_destinos_se_piden_al_cambiar_de_cuenta():
    dest = _funcion("async function b3destinos(")
    assert "api/publicar/destinos?cuenta_id=${encodeURIComponent(c.id)}" in dest
    assert "&plataforma=${encodeURIComponent(c.platform)}" in dest
    assert '<option value="">Mi perfil personal</option>' in dest
    # una respuesta vieja no pisa la cuenta que se eligió después
    assert "pedido !== B3DESTGEN" in dest
    assert "b3destinos(gen);" in _funcion("function b3cambioCuenta(")
    assert '$("b3cuenta").onchange = () => b3cambioCuenta(gen);' in B3


def test_el_formulario_sigue_las_reglas_de_la_red():
    red = _funcion("function b3cambioCuenta(")
    assert '$("b3titulo").maxLength = red.titulo;' in red
    assert '$("b3texto").maxLength = red.texto;' in red
    assert '<option value="" selected>Elige quién puede verlo</option>' in red
    assert '<input type="checkbox" id="b3ia" checked> Hecho con IA' in red
    assert "B3OPCIONES[k]" in red
    assert '$("b3vertical").hidden = !red.vertical;' in red
    assert "Esta red solo acepta video vertical (9:16)." in B3
    assert '${n} / ${max}' in _funcion("function b3contar(")


def test_programar_sigue_siendo_el_default_con_la_zona_a_la_vista():
    form = _funcion("function b3formulario(")
    assert 'value="programar" checked' in form
    assert 'type="datetime-local" id="b3cuando"' in form
    assert "La hora es de tu zona: ${esc(tz)}." in form
    assert "new Date(v.fecha).toISOString()" in _funcion("function b3cuerpo(")


# ---------------------------------------------------------------------------
# el sondeo

def test_el_sondeo_consulta_publicaciones_cada_4_segundos():
    sondeo = _funcion("function b3sondear(")
    assert 'fj("api/publicar/publicaciones")' in sondeo
    assert "const B3SONDEO_MS = 4000;" in B3
    assert "if (B3SONDEO ||" in sondeo, "podría haber dos intervalos a la vez"
    assert "catch { return; }" in sondeo, "la red caída cortaría el sondeo"


def test_cerrar_el_modal_para_el_sondeo():
    assert 'onclick="b3cerrar()"' in MODAL
    assert "classList.remove('abierto')" not in MODAL, "el ✕ cierra sin parar el sondeo"
    cerrar = _funcion("function b3cerrar(")
    assert "b3parar();" in cerrar and "B3GEN++" in cerrar
    abrir = _funcion("async function b3abrir()")
    assert abrir.index("b3parar();") < abrir.index("await")


# ---------------------------------------------------------------------------
# el marcado: pantallas chicas y foco

def test_el_modal_cabe_en_pantallas_chicas():
    regla = HTML[HTML.index("#b3card {"):]
    regla = regla[:regla.index("}")]
    assert "max-height: 92vh" in regla and "overflow-y: auto" in regla
    assert "@media (max-width: 420px)" in HTML


def test_cerrar_es_un_boton_con_foco():
    assert '<button type="button" class="b3cerrar" onclick="b3cerrar()" aria-label="Cerrar">' in MODAL
    assert ":focus-visible { outline: 2px solid var(--accent)" in HTML


def test_la_lista_de_publicaciones_tiene_su_titulo():
    assert "Tus publicaciones de este video" in MODAL
    assert 'id="b3lista"' in MODAL
    assert 'role="status"' in MODAL


# ---------------------------------------------------------------------------
# en node, contra un DOM mínimo

REDES = {
    "youtube": {"nombre": "YouTube", "texto": 5000, "titulo": 100, "titulo_obligatorio": True,
                "privacidad": [["public", "Público"], ["unlisted", "No listado"], ["private", "Privado"]],
                "destino": None, "destino_obligatorio": False, "ia": True, "vertical": False,
                "mb": None, "seg": None, "opciones": ["notificar", "para_ninos"]},
    "tiktok": {"nombre": "TikTok", "texto": 2200, "titulo": None, "titulo_obligatorio": False,
               "privacidad": [["PUBLIC_TO_EVERYONE", "Todos"], ["SELF_ONLY", "Solo yo"]],
               "destino": None, "destino_obligatorio": False, "ia": True, "vertical": True,
               "mb": 287, "seg": 600,
               "opciones": ["comentarios", "duo", "stitch", "marca_propia", "marca_pagada"]},
    "facebook": {"nombre": "Facebook", "texto": 63206, "titulo": None, "titulo_obligatorio": False,
                 "privacidad": None, "destino": "pagina", "destino_obligatorio": True,
                 "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": []},
    "linkedin": {"nombre": "LinkedIn", "texto": 3000, "titulo": None, "titulo_obligatorio": False,
                 "privacidad": None, "destino": "pagina", "destino_obligatorio": False,
                 "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": []},
    "pinterest": {"nombre": "Pinterest", "texto": 500, "titulo": 100, "titulo_obligatorio": False,
                  "privacidad": None, "destino": "tablero", "destino_obligatorio": True,
                  "ia": False, "vertical": False, "mb": None, "seg": None, "opciones": []},
}

PRELUDIO = r"""
const els = {};
const el = id => els[id] || (els[id] = {id, hidden: false, disabled: false, innerHTML: '',
  textContent: '', className: '', classList: {abierto: true, remove(c) { this[c] = false; },
  add(c) { this[c] = true; }}});
const $ = id => el(id);
let orbesApagados = 0;
function orbeOff() { orbesApagados++; }
// temporizadores de mentira: el test decide cuándo corre cada vuelta
const timers = [];
function setInterval(fn, ms) { timers.push({fn, ms, vivo: true}); return timers.length; }
function clearInterval(id) { if (timers[id - 1]) timers[id - 1].vivo = false; }
const vivos = () => timers.filter(t => t.vivo);
let respuestas = [], llamadas = [];
async function fj(url, body) {
  llamadas.push(url);
  const r = respuestas.shift();
  if (typeof r === 'function') return r();
  if (r instanceof Error) throw r;
  return r;
}
"""


def _node(escenario: str, tmp_path: Path, redes: dict | None = None):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    codigo = (PRELUDIO + AYUDANTES + PURO +
              f"\nB3REDES = {json.dumps(redes if redes is not None else REDES)};\n" +
              "(async () => {\nconst out = {};\n" + escenario +
              "\nconsole.log(JSON.stringify(out));\n})().catch(e => { console.error(e); process.exit(1); });\n")
    f = tmp_path / "b3.js"
    f.write_text(codigo, encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    return json.loads(r.stdout)


def test_esc_escapa_los_cinco_en_node(tmp_path):
    o = _node(r"""
out.todo = esc(`<img src="x" onerror='alert(1)'>&`);
out.nulo = esc(null); out.indef = esc(undefined); out.num = esc(42.5);
""", tmp_path)
    assert o["todo"] == "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    assert o["nulo"] == "" and o["indef"] == "" and o["num"] == "42.5"


def test_fj_detalle_en_node(tmp_path):
    o = _node(r"""
out.texto = fjDetalle({detail: "Falta confirmar"}, 428);
out.lista = fjDetalle({detail: [{loc: ["body", "plataforma"], msg: "Field required"},
                                {loc: ["body", "texto"], msg: "String too long"}]}, 422);
out.sinLoc = fjDetalle({detail: [{msg: "algo"}]}, 422);
out.vacio = fjDetalle({}, 500);
out.nada = fjDetalle(null, 502);
out.objeto = fjDetalle({detail: {msg: "raro"}}, 400);
""", tmp_path)
    assert o["texto"] == "Falta confirmar"
    assert o["lista"] == "plataforma: Field required · texto: String too long"
    assert o["sinLoc"] == "algo"
    assert o["vacio"] == "el servidor respondió 500"
    assert o["nada"] == "el servidor respondió 502"
    assert o["objeto"] == "raro"
    assert all("[object Object]" not in v for v in o.values())


# valores de un formulario completo; cada caso cambia lo suyo
BASE = {"cuenta_id": "123", "plataforma": "youtube", "cuenta_nombre": "Mi canal",
        "archivo": "pelicula", "mb": 42.1, "texto": "  Mi descripción  ", "titulo": "Mi título",
        "privacidad": "public", "destino": "", "destino_nombre": "", "estado_destinos": "ok",
        "ia": True, "opciones": {}, "modo": "programar", "fecha": "2031-01-15T10:30"}


def _validar(tmp_path, casos):
    esc_ = json.dumps([[red, {**BASE, **cambios}] for red, cambios in casos])
    o = _node(f"""
const AHORA = new Date("2030-06-01T12:00").getTime();
out.r = {esc_}.map(([red, v]) => b3validar(B3REDES[red], v, AHORA));
""", tmp_path)
    return o["r"]


def test_validar_en_node(tmp_path):
    casos = [
        ("youtube", {}),                                                    # 0 completo
        ("tiktok", {"plataforma": "tiktok", "privacidad": ""}),             # 1 sin privacidad
        ("youtube", {"titulo": "   "}),                                     # 2 sin título
        ("facebook", {"plataforma": "facebook", "destino": ""}),            # 3 sin página
        ("facebook", {"plataforma": "facebook", "estado_destinos": "vacio"}),  # 4 sin páginas en Blotato
        ("linkedin", {"plataforma": "linkedin", "destino": ""}),            # 5 perfil personal
        ("pinterest", {"plataforma": "pinterest", "destino": ""}),          # 6 sin tablero
        ("youtube", {"fecha": "2020-01-01T10:00"}),                         # 7 hora pasada
        ("youtube", {"fecha": ""}),                                         # 8 programar sin fecha
        ("youtube", {"fecha": "", "modo": "ahora"}),                        # 9 ahora sin fecha
        ("tiktok", {"plataforma": "tiktok", "texto": "x" * 2201}),          # 10 texto largo
        ("tiktok", {"plataforma": "tiktok", "mb": 300}),                    # 11 muy pesado
        ("youtube", {"texto": "   "}),                                      # 12 sin texto
        ("youtube", {"archivo": ""}),                                       # 13 sin película
        ("facebook", {"plataforma": "facebook", "destino": "", "estado_destinos": "cargando"}),  # 14
        ("pinterest", {"plataforma": "pinterest", "destino": "b1", "titulo": ""}),  # 15 título opcional
        ("youtube", {"titulo": "t" * 101}),                                 # 16 título largo
        ("facebook", {"plataforma": "facebook", "destino": "999"}),         # 17 con página
        ("tiktok", {"plataforma": "tiktok", "mb": 287}),                    # 18 justo en el tope
    ]
    r = _validar(tmp_path, casos)
    assert r[0] is None
    assert "quién puede ver" in r[1]
    assert "título" in r[2] and "YouTube" in r[2]
    assert r[3] == "Elige la página donde publicar."
    assert "no tiene páginas conectadas en Blotato" in r[4] and "Facebook" in r[4]
    assert r[5] is None, "LinkedIn sin página publica en el perfil personal"
    assert r[6] == "Elige el tablero donde publicar."
    assert "ya pasó" in r[7]
    assert "fecha y hora" in r[8]
    assert r[9] is None
    assert "2201 de 2200" in r[10]
    assert "300 MB" in r[11] and "287 MB" in r[11]
    assert r[12] == "Escribe la descripción."
    assert "no hay un video" in r[13]
    assert "Espera a que carguen tus páginas" in r[14]
    assert r[15] is None
    assert "100 caracteres" in r[16]
    assert r[17] is None
    assert r[18] is None


def _cuerpos(tmp_path, casos):
    esc_ = json.dumps([[red, {**BASE, **cambios}] for red, cambios in casos])
    return _node(f"""
out.r = {esc_}.map(([red, v]) => b3cuerpo(B3REDES[red], v));
out.iso = new Date("{BASE['fecha']}").toISOString();
""", tmp_path)


BASICOS = {"confirmar", "cuenta_id", "plataforma", "cuenta_nombre", "archivo", "texto", "cuando"}


def test_cuerpo_en_node(tmp_path):
    todas = {"notificar": False, "para_ninos": True, "comentarios": False, "duo": True,
             "stitch": False, "marca_propia": True, "marca_pagada": False}
    o = _cuerpos(tmp_path, [
        ("youtube", {"opciones": todas}),                                           # 0
        ("tiktok", {"plataforma": "tiktok", "modo": "ahora", "ia": False,
                    "privacidad": "SELF_ONLY", "opciones": todas}),                 # 1
        ("facebook", {"plataforma": "facebook", "destino": "999", "opciones": todas}),  # 2
        ("linkedin", {"plataforma": "linkedin", "destino": ""}),                    # 3
        ("pinterest", {"plataforma": "pinterest", "destino": "b1", "titulo": "  "}),  # 4
        ("youtube", {"ia": False, "opciones": {"notificar": True}}),                # 5
    ])
    yt, tt, fb, li, pi, yt2 = o["r"]

    assert set(yt) == BASICOS | {"titulo", "privacidad", "ia", "notificar", "para_ninos"}
    assert yt["confirmar"] is True
    assert yt["texto"] == "Mi descripción"
    assert yt["titulo"] == "Mi título" and yt["privacidad"] == "public"
    assert yt["ia"] is True
    assert yt["notificar"] is False and yt["para_ninos"] is True
    assert yt["cuando"] == o["iso"] and yt["cuando"].endswith("Z")
    assert yt["cuenta_nombre"] == "Mi canal" and yt["archivo"] == "pelicula"

    assert set(tt) == BASICOS | {"privacidad", "ia", "comentarios", "duo", "stitch",
                                 "marca_propia", "marca_pagada"}
    assert tt["cuando"] is None, "«Publicar ahora» manda cuando=null"
    assert tt["ia"] is False, "el usuario desmarcó «Hecho con IA»"
    assert tt["privacidad"] == "SELF_ONLY"
    assert (tt["comentarios"], tt["duo"], tt["stitch"]) == (False, True, False)

    assert set(fb) == BASICOS | {"destino"}
    assert fb["destino"] == "999"

    assert set(li) == BASICOS | {"destino"}
    assert li["destino"] is None, "«Mi perfil personal» viaja como destino null"

    assert set(pi) == BASICOS | {"titulo", "destino"}
    assert pi["titulo"] is None and pi["destino"] == "b1"

    # solo las opciones que se pintaron (y que son de la red) viajan
    assert set(yt2) == BASICOS | {"titulo", "privacidad", "ia", "notificar"}
    assert yt2["ia"] is False


def test_las_casillas_nacen_como_decidio_el_dueno(tmp_path):
    o = _node("out.op = B3OPCIONES;", tmp_path)["op"]
    assert o == {
        "comentarios": ["Permitir comentarios", True],
        "duo": ["Permitir dúos", True],
        "stitch": ["Permitir stitch", True],
        "marca_propia": ["Promociono mi propia marca", False],
        "marca_pagada": ["Contenido pagado por una marca", False],
        "notificar": ["Avisar a mis suscriptores", True],
        "para_ninos": ["Hecho para niños", False],
    }
    # y cada opción que el contrato nombra tiene su casilla
    for red in REDES.values():
        assert set(red["opciones"]) <= set(o)


def test_resumen_del_confirm_en_node(tmp_path):
    o = _node(r"""
const fb = {confirmar: true, cuenta_id: "1", plataforma: "facebook", cuenta_nombre: "Yo",
            archivo: "pelicula", texto: "a".repeat(300), cuando: null, destino: "999"};
out.fb = b3resumen(B3REDES.facebook, fb, "Mi página");
const yt = {...fb, plataforma: "youtube", titulo: "Hola", cuando: "2031-01-15T16:30:00.000Z"};
out.yt = b3resumen(B3REDES.youtube, yt, "");
""", tmp_path)
    assert o["fb"].startswith("¿Publicar este video?")
    assert "Red: Facebook" in o["fb"] and "Cuenta: Yo" in o["fb"]
    assert "Página: Mi página" in o["fb"]
    assert "AHORA" in o["fb"]
    assert "a" * 139 + "…" in o["fb"] and "a" * 141 not in o["fb"], "el texto va recortado"
    assert o["yt"].startswith("¿Programar este video?")
    assert "Título: «Hola»" in o["yt"] and "(tu hora)" in o["yt"]
    assert "Página:" not in o["yt"]


def test_filas_de_publicaciones_en_node(tmp_path):
    malo = "<img src=x onerror=alert(1)>"
    vistas = [
        {"id": "a", "plataforma": "youtube", "cuenta_nombre": malo, "titulo": malo, "texto": "t",
         "cuando": None, "estado": "publicado", "en_curso": False,
         "url": "https://youtube.com/watch?v=1", "mensaje": malo},
        {"id": "b", "plataforma": "tiktok", "cuenta_nombre": "yo", "titulo": None, "texto": "hola",
         "cuando": "2031-01-15T16:30:00+00:00", "estado": "programado", "en_curso": False,
         "url": "javascript:alert(1)", "mensaje": None},
        {"id": "c", "plataforma": "facebook", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "subiendo", "en_curso": True, "url": None,
         "mensaje": "Subiendo el video…"},
        {"id": "d", "plataforma": "linkedin", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "incierto", "en_curso": False, "url": None, "mensaje": None},
        {"id": "e", "plataforma": malo, "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "fallido", "en_curso": False, "url": None,
         "mensaje": "Blotato dijo que no"},
        {"id": "f", "plataforma": "youtube", "cuenta_nombre": "yo", "titulo": None, "texto": "x",
         "cuando": None, "estado": "error", "en_curso": False, "url": None, "mensaje": None},
    ]
    o = _node(f"""
const vistas = {json.dumps(vistas)};
out.filas = vistas.map(p => b3fila(p, B3REDES));
out.etiquetas = vistas.map(p => b3etiqueta(p));
out.fecha = b3fecha("2031-01-15T16:30:00+00:00");
b3pintarPubs(vistas);
out.oculta = els.b3pubs.hidden;
out.html = els.b3lista.innerHTML;
b3pintarPubs([]);
out.ocultaVacia = els.b3pubs.hidden;
""", tmp_path)
    pub, prog, curso, incierto, fallido, error = o["filas"]
    for fila in o["filas"]:
        assert "<img" not in fila, fila
    assert "&lt;img src=x onerror=alert(1)&gt;" in pub
    assert '<a href="https://youtube.com/watch?v=1" target="_blank" rel="noopener noreferrer">Ver</a>' in pub
    assert "javascript:" not in prog and ">Ver<" not in prog
    assert o["etiquetas"] == [
        ["Publicada", "ok"], [f"Programada para {o['fecha']}", "ok"], ["Enviando…", "curso"],
        ["Sin confirmar", "aviso"], ["Blotato la rechazó", "err"], ["No se envió", "err"],
    ]
    assert o["fecha"] and "2031" in o["fecha"]
    assert "<b>YouTube</b>" in pub and "<b>TikTok</b>" in prog
    assert "Subiendo el video…" in curso
    assert "No sabemos si llegó: revisa tu calendario de Blotato antes de intentar de nuevo." in incierto
    assert "Blotato dijo que no Puedes intentarlo de nuevo." in fallido
    assert "Puedes intentarlo de nuevo." in error
    assert o["oculta"] is False and o["ocultaVacia"] is True
    assert o["html"] == "".join(o["filas"])


def test_destinos_en_node(tmp_path):
    dest = _funcion("async function b3destinos(")
    o = _node(dest + r"""
const cuentas = {
  li: {id: "L1", platform: "linkedin", fullname: "Yo"},
  fb: {id: "a&b", platform: "facebook", fullname: "Yo"},
  pi: {id: "P1", platform: "pinterest", fullname: "Yo"},
  yt: {id: "Y1", platform: "youtube", fullname: "Yo"},
};
$("b3cuenta").value = "0";
const foto = () => ({html: els.b3destino.innerHTML, off: els.b3destino.disabled,
  nota: els.b3destNota.hidden ? null : els.b3destNota.textContent,
  oculto: els.b3destWrap.hidden, etiqueta: els.b3destLbl.textContent, estado: B3DEST.estado});
const correr = async (c, r) => { B3CUENTAS = [c]; respuestas.push(r); await b3destinos(B3GEN); return foto(); };
const paginas = {destinos: [{id: "p1", nombre: "<b>Mi página</b>"}, {id: "p2", nombre: "Otra"}], error: null};

out.liDos = await correr(cuentas.li, paginas);
out.liError = await correr(cuentas.li, new Error("Blotato no respondió."));
out.fbVacio = await correr(cuentas.fb, {destinos: [], error: null});
out.fbUna = await correr(cuentas.fb, {destinos: [{id: "p1", nombre: "Única"}], error: null});
out.fbDos = await correr(cuentas.fb, paginas);
out.piDos = await correr(cuentas.pi, paginas);
out.urls = llamadas.slice();
const n = llamadas.length;
out.yt = await correr(cuentas.yt, undefined);
out.ytPidio = llamadas.length - n;
respuestas.length = 0;

// una respuesta vieja no pisa la cuenta que se eligió después
let soltar;
B3CUENTAS = [cuentas.fb];
respuestas.push(() => new Promise(r => soltar = r));
const vieja = b3destinos(B3GEN);
B3CUENTAS = [cuentas.li];
respuestas.push({destinos: [], error: null});
await b3destinos(B3GEN);
soltar(paginas);
await vieja;
out.carrera = foto();
""", tmp_path)
    li = o["liDos"]
    assert li["html"].startswith('<option value="">Mi perfil personal</option>')
    assert '<option value="p1">&lt;b&gt;Mi página&lt;/b&gt;</option>' in li["html"]
    assert (li["off"], li["nota"], li["oculto"], li["estado"]) == (False, None, False, "ok")
    assert li["etiqueta"] == "Página"

    assert o["liError"]["html"] == '<option value="">Mi perfil personal</option>'
    assert o["liError"]["off"] is False
    assert o["liError"]["nota"] == ("Blotato no respondió. Por ahora puedes publicar "
                                    "en tu perfil personal.")
    assert o["liError"]["estado"] == "error"

    fb = o["fbVacio"]
    assert fb["html"] == '<option value="">sin páginas</option>' and fb["off"] is True
    assert fb["nota"] == ("Tu cuenta de Facebook no tiene páginas conectadas en Blotato. "
                          "Conecta tu página en Blotato y vuelve a abrir Publicar.")
    assert fb["estado"] == "vacio"

    assert o["fbUna"]["html"] == '<option value="p1">Única</option>', "una sola página va elegida"
    assert o["fbDos"]["html"].startswith('<option value="">Elige la página</option>')
    assert o["piDos"]["etiqueta"] == "Tablero"
    assert o["piDos"]["html"].startswith('<option value="">Elige el tablero</option>')

    assert o["urls"][2] == "api/publicar/destinos?cuenta_id=a%26b&plataforma=facebook"
    assert o["urls"][0] == "api/publicar/destinos?cuenta_id=L1&plataforma=linkedin"

    assert o["yt"]["oculto"] is True and o["yt"]["html"] == "" and o["ytPidio"] == 0

    assert o["carrera"]["html"] == '<option value="">Mi perfil personal</option>', \
        "la respuesta de Facebook llegó tarde y pisó la de LinkedIn"


EN_CURSO = {"id": "a", "plataforma": "youtube", "cuenta_nombre": "yo", "titulo": None,
            "texto": "x", "cuando": None, "estado": "pendiente", "en_curso": True,
            "url": None, "mensaje": None}
LISTA = {**EN_CURSO, "estado": "publicado", "en_curso": False}


def test_sondeo_en_node(tmp_path):
    o = _node(f"""
const curso = {json.dumps(EN_CURSO)}, lista = {json.dumps(LISTA)};
const vuelta = () => Promise.all(vivos().map(t => t.fn()));

// sin nada en curso no arranca
b3pintarPubs([lista]); b3sondear();
out.sinCurso = timers.length;

// con algo en curso arranca UNO, aunque se pida dos veces
b3pintarPubs([curso]); b3sondear(); b3sondear();
out.uno = vivos().length;
out.ms = timers[0].ms;

// la red caída no corta el sondeo ni borra la lista
respuestas.push(new Error("sin red"));
await vuelta();
out.trasError = {{vivos: vivos().length, pubs: B3PUBS.length}};

// una respuesta rara tampoco
respuestas.push({{}});
await vuelta();
out.trasRara = {{vivos: vivos().length, pubs: B3PUBS.length}};

// sigue en curso: pinta y sigue
respuestas.push({{publicaciones: [{{...curso, estado: "subiendo"}}]}});
await vuelta();
out.sigue = {{vivos: vivos().length, estado: B3PUBS[0].estado}};

// dos vueltas encimadas: una sola petición
let soltar;
respuestas.push(() => new Promise(r => soltar = r));
const antes = llamadas.length;
const p1 = timers[0].fn();
const p2 = timers[0].fn();
out.encimadas = llamadas.length - antes;
soltar({{publicaciones: [curso]}});
await Promise.all([p1, p2]);

// ya ninguna en curso: para
respuestas.push({{publicaciones: [lista]}});
await vuelta();
out.paro = {{vivos: vivos().length, sondeo: B3SONDEO, estado: B3PUBS[0].estado}};
out.urls = [...new Set(llamadas)];

// cerrar con una vuelta en camino: lo que llega tarde no se pinta
b3pintarPubs([curso]); b3sondear();
respuestas.push(() => new Promise(r => soltar = r));
const tarde = vivos()[0].fn();
b3cerrar();
out.cerrado = {{vivos: vivos().length, sondeo: B3SONDEO, modal: els.b3modal.classList.abierto,
               orbe: orbesApagados}};
soltar({{publicaciones: [lista]}});
await tarde;
out.tarde = B3PUBS[0].estado;

// un intervalo de un modal viejo que aún corriera se apaga solo
B3SONDEO = null;
b3sondear();
const viejo = vivos()[0];
B3GEN++;
const n = llamadas.length;
await viejo.fn();
out.viejo = {{vivo: viejo.vivo, sondeo: B3SONDEO, llamo: llamadas.length - n}};

// al reabrir, un solo intervalo
b3sondear();
out.reabierto = vivos().length;
""", tmp_path)
    assert o["sinCurso"] == 0
    assert o["uno"] == 1 and o["ms"] == 4000
    assert o["trasError"] == {"vivos": 1, "pubs": 1}
    assert o["trasRara"] == {"vivos": 1, "pubs": 1}
    assert o["sigue"] == {"vivos": 1, "estado": "subiendo"}
    assert o["encimadas"] == 1
    assert o["paro"] == {"vivos": 0, "sondeo": None, "estado": "publicado"}
    assert o["urls"] == ["api/publicar/publicaciones"]
    assert o["cerrado"] == {"vivos": 0, "sondeo": None, "modal": False, "orbe": 1}
    assert o["tarde"] == "pendiente", "una respuesta tardía pintó un modal cerrado"
    assert o["viejo"] == {"vivo": False, "sondeo": None, "llamo": 0}
    assert o["reabierto"] == 1
