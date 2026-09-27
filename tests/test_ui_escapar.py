"""UI·2 — lo que llega del servidor entra a la pantalla como TEXTO, nunca como HTML.

La cookie `token` se lee desde JavaScript (así funciona auth.js), así que un
`${}` sin escapar dentro de un innerHTML regala la sesión. La auditoría del
2026-09-25 encontró títulos de YouTube, emails, fuentes de la web, flags de
cuts.json y el motivo del moderador pintados en crudo. Este test es el guardián
de que no vuelvan:

  · toda función `esc` del producto escapa los cinco (& < > " ');
  · ningún campo de texto libre entra crudo a una plantilla HTML — si uno nuevo
    es seguro de verdad (un catálogo constante), se añade a PERMITIDOS con el
    motivo, a propósito;
  · ningún manejador inline (onclick="…") interpola nada que no sea un número:
    ahí escapar HTML no basta, el parser decodifica &#39; antes de que corra
    el JS;
  · los enlaces que manda el servidor solo se pintan si son http(s).

Sin red: el HTML se lee como texto y las `esc` corren en node (se salta si no
hay node).
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent

ARCHIVOS = sorted(
    list((RAIZ / "static").glob("*.html")) + list((RAIZ / "static").glob("*.js"))
    + [RAIZ / "tools" / "editor" / "index.html"]
)


def _rel(p: Path) -> str:
    return p.relative_to(RAIZ).as_posix()


def _texto(ruta: str) -> str:
    return (RAIZ / ruta).read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# las funciones de escape

def _cuerpo_funcion(texto: str, inicio: int) -> str:
    """Desde `function esc(` hasta su llave de cierre."""
    abre = texto.index("{", inicio)
    nivel = 0
    for i in range(abre, len(texto)):
        if texto[i] == "{":
            nivel += 1
        elif texto[i] == "}":
            nivel -= 1
            if nivel == 0:
                return texto[inicio:i + 1]
    raise AssertionError("llave sin cerrar")


_NOMBRE_ESC = r"(esc|[a-z]{2}Esc)"          # esc, y los con prefijo: clEsc, cpEsc


def _escapes() -> list[tuple[str, str, str]]:
    """(archivo, nombre, código) de cada función de escape del producto. El
    código lleva delante la tabla `const XXESCAPES = {…}` si el archivo la usa."""
    halladas = []
    for p in ARCHIVOS:
        t = p.read_text(encoding="utf-8")
        tablas = "\n".join(re.findall(r"^const [A-Z]*ESCAPES\s*=\s*\{.*\};$", t, re.M))
        for m in re.finditer(rf"^function {_NOMBRE_ESC}\s*\(", t, re.M):
            halladas.append((_rel(p), m.group(1), tablas + "\n" + _cuerpo_funcion(t, m.start())))
        # también la forma flecha: `const esc = t => …;` (una línea)
        for m in re.finditer(rf"^const {_NOMBRE_ESC}\s*=\s*(?:\w+|\([^)]*\))\s*=>.*$", t, re.M):
            halladas.append((_rel(p), m.group(1), tablas + "\n" + m.group(0)))
    return halladas


ESCAPES = _escapes()


def test_se_encontraron_las_esc():
    # si esto baja, el extractor dejó de ver alguna y el test de abajo miente
    archivos = {a for a, _, _ in ESCAPES}
    for esperado in ("static/admin.html", "static/crear.html", "static/estilos.html",
                     "static/index.html", "static/shorts.html", "static/agenda.html",
                     "static/metricas.html", "static/mix.html", "static/competencia.html",
                     "static/clip.html", "tools/editor/index.html"):
        assert esperado in archivos, f"{esperado} ya no define su esc"


def test_cada_esc_escapa_los_cinco_en_node(tmp_path):
    nodo = shutil.which("node")
    if not nodo:
        pytest.skip("node no está en el PATH")
    # cada esc en su propio ámbito: todas se llaman igual
    bloques = []
    for i, (archivo, nombre, codigo) in enumerate(ESCAPES):
        bloques.append(
            # una esc que revienta (p. ej. con un número) cuenta como mala, sin
            # tapar el resultado de las demás
            f"out[{json.dumps(f'{archivo}:{nombre}')}] = (() => {{ try {{\n{codigo}\n"
            f"return [{nombre}(`<img src=\"x\" onerror='alert(1)'>&`), {nombre}(3)];\n"
            f"}} catch (e) {{ return [String(e)]; }} }})();"
        )
    f = tmp_path / "esc.js"
    f.write_text("const out = {};\n" + "\n".join(bloques) +
                 "\nconsole.log(JSON.stringify(out));\n", encoding="utf-8")
    r = subprocess.run([nodo, str(f)], capture_output=True, text=True, encoding="utf-8")
    assert r.returncode == 0, r.stderr
    salida = json.loads(r.stdout)
    esperado = "&lt;img src=&quot;x&quot; onerror=&#39;alert(1)&#39;&gt;&amp;"
    malas = {k: v for k, v in salida.items() if v != [esperado, "3"]}
    assert not malas, f"esc que no escapan los cinco: {malas}"


# ---------------------------------------------------------------------------
# ningún texto libre entra crudo a una plantilla HTML

# Nombres de campo que en este producto son texto libre: los escribe el usuario,
# un LLM o un tercero (YouTube, Apify, Blotato, la web).
LIBRES = ("titulo", "title", "email", "nombre", "name", "mensaje", "message",
          "motivo", "detail", "error", "descripcion", "texto", "text", "prompt",
          "url", "link", "enlace", "issue", "user_id", "caption", "handle",
          "canal", "autor", "msg", "etiqueta", "label", "archivo", "narracion")

# Los que son seguros de verdad, con el porqué. Añadir uno es una decisión.
PERMITIDOS = {
    ("static/imagenes.html", "e.nombre"): "catálogo constante de pipeline/styles.py",
    ("static/monedero.js", "p.link"): "STRIPE_LINK_* del entorno + el sub de Cognito "
                                      "(server/pagos_api.py): no lo escribe nadie más",
}

_PLANTILLA = re.compile(r"`((?:[^`\\]|\\.)*)`", re.S)
# `${obj.campo}`, y también `${obj.campo || "…"}`, `${obj.campo ?? …}` y
# `${obj.campo.slice(…)}`: el texto sale igual de crudo. Un `${obj.campo ? … : …}`
# solo lo usa de condición y no cuenta.
_CRUDO = re.compile(r"\$\{\s*\(?\s*([A-Za-z_$][\w$]*(?:\??\.[\w$]+)*)\s*"
                    r"(?:\}|\|\||\?\?|\.(?:slice|trim|substring)\()")


def _crudos() -> list[tuple[str, int, str]]:
    hallados = []
    for p in ARCHIVOS:
        t = p.read_text(encoding="utf-8")
        for m in _PLANTILLA.finditer(t):
            cuerpo = m.group(1)
            if not re.search(r"<[a-zA-Z/]", cuerpo):
                continue                      # no es una plantilla HTML
            for x in _CRUDO.finditer(cuerpo):
                expr = x.group(1)
                # `${a.nombre || a.red ? … : …}`: es la condición de un ternario
                resto = cuerpo[x.end():].split("}", 1)[0]
                if x.group(0).endswith(("||", "??")) and re.search(r"\?(?![?.])", resto):
                    continue
                partes = [s.lower() for s in re.split(r"\??\.", expr)]
                if any(s == l or s.endswith(l) for s in partes for l in LIBRES):
                    linea = t.count("\n", 0, m.start(1) + x.start()) + 1
                    hallados.append((_rel(p), linea, expr))
    return hallados


def test_ningun_texto_libre_entra_crudo():
    crudos = [(a, l, e) for a, l, e in _crudos() if (a, e) not in PERMITIDOS]
    assert not crudos, (
        "texto libre sin esc() en una plantilla HTML (si es seguro de verdad, "
        "va a PERMITIDOS con el motivo):\n" +
        "\n".join(f"  {a}:{l}  ${{{e}}}" for a, l, e in crudos))


def test_los_permitidos_siguen_existiendo():
    # un permiso que ya no se usa es un permiso que alguien va a reutilizar sin mirar
    vivos = {(a, e) for a, _, e in _crudos()}
    for clave in PERMITIDOS:
        assert clave in vivos, f"{clave} ya no aparece: quítalo de PERMITIDOS"


def test_ningun_manejador_inline_interpola_texto():
    malos = []
    for p in ARCHIVOS:
        t = p.read_text(encoding="utf-8")
        for m in re.finditer(r"\son[a-z]+=\\?[\"']([^\"']*)", t):
            for x in re.finditer(r"\$\{([^}]*)\}", m.group(1)):
                if not x.group(1).strip().startswith("Number("):
                    malos.append(f"{_rel(p)}:{t.count(chr(10), 0, m.start()) + 1}  {m.group(0)}")
    assert not malos, "interpolación en un onclick/onchange:\n" + "\n".join(malos)


# ---------------------------------------------------------------------------
# los arreglos puntuales de la auditoría

def test_guardrail_pinta_el_motivo_como_texto():
    g = _texto("static/guardrail.js")
    assert "${mensaje}" not in g and "${motivo}" not in g
    assert ".textContent = mensaje" in g and ".textContent = motivo" in g


def test_crear_solo_enlaza_http():
    c = _texto("static/crear.html")
    assert "const esHttp = u =>" in c
    # las fuentes de la investigación vienen de la web; el enlace de Drive, de su API
    assert "p.fuentes.map(u => esHttp(u)" in c
    assert "esHttp(p.resultado?.link)" in c
    assert 'href="${u}"' not in c and 'href="${p.resultado.link}"' not in c


def test_editor_flags_y_versiones_sin_html_crudo():
    e = _texto("tools/editor/index.html")
    # los flags de cuts.json los escribe Claude y api/save los guarda sin validar
    assert "<b>▲${f.id}</b>" not in e
    assert 'head.querySelector("b").textContent = "▲" + f.id' in e
    assert "g1activar(${Number(v.n)})" in e
    # el preview de la nube: solo un enlace http(s)
    assert 'if (s.ok && typeof s.url === "string" && /^https?:\\/\\//i.test(s.url))' in e
