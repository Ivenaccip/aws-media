"""M19 fase 4 — el orbe en el editor visual, y el dinero a salvo.

Dos reglas que este archivo defiende:

1. El orbe va SOLO donde trabaja la IA. El render de Remotion, el mux de
   ffmpeg y la muestra de subtítulos son esperas mecánicas: prometer que hay
   alguien pensando al otro lado de un ffmpeg es mentir.
2. Un botón que cobra se apaga ANTES del await. Dos de ellos (#g1generar y
   #tbBroll) seguían vivos durante la petición, y cada uno cobra créditos: el
   segundo clic cobraba otra vez.
"""
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
EDITOR = RAIZ / "tools" / "editor" / "index.html"
HTML = EDITOR.read_text(encoding="utf-8")


def _preambulo(marca: str) -> str:
    """Lo que corre entre que se pulsa el botón y la primera espera."""
    i = HTML.index(marca)
    return HTML[i:HTML.index("await", i)]


# ---------------------------------------------------------------------------
# el orbe llega al editor

def test_el_editor_carga_el_orbe_con_ruta_relativa():
    """La UI corre bajo /editor/<proyecto>/ en la nube y bajo «/» en el server
    local. Una ruta absoluta /orbe.js funcionaría solo en uno de los dos."""
    assert '<script src="orbe.js"></script>' in HTML
    assert '"/orbe.js"' not in HTML and "'/orbe.js'" not in HTML


def test_los_dos_servidores_sirven_el_orbe():
    nube = (RAIZ / "server" / "editor.py").read_text(encoding="utf-8")
    local = (RAIZ / "tools" / "editor" / "server.py").read_text(encoding="utf-8")
    assert '@router.get("/{name}/orbe.js")' in nube, "la nube no sirve orbe.js"
    assert 'self.path == "/orbe.js"' in local, "el server local no sirve orbe.js"
    # y los dos sacan el MISMO archivo, no una copia
    assert '"static" / "orbe.js"' in nube and '"static" / "orbe.js"' in local


def test_un_orbe_que_no_carga_no_rompe_el_editor():
    """orbe.js es un adorno; los botones que gastan dinero no dependen de él."""
    assert "if (!c || !window.orbe) return null;" in HTML


# ---------------------------------------------------------------------------
# dónde SÍ y dónde NO

IA = [
    ("chatBusy", "el chat con Claude"),
    ("orbe-g1", "Nano Banana y Veo"),
    ("orbe-broll", "las propuestas de b-roll"),
    ("orbe-b3", "los títulos para publicar"),
]


@pytest.mark.parametrize("hueco,que", IA, ids=[h for h, _ in IA])
def test_el_orbe_acompana_cada_espera_de_ia(hueco, que):
    assert f'orbeOn("{hueco}"' in HTML, f"{que} se quedó sin orbe"
    assert f'orbeOff("{hueco}")' in HTML, f"{que} monta el orbe y no lo desmonta"


def test_el_chat_ya_no_anuncia_con_un_reloj_de_arena():
    assert "⏳ Claude está escribiendo" not in HTML
    assert '<div id="chatBusy"></div>' in HTML


MECANICAS = [
    ("renderBtn", "el render de Remotion"),
    ("async function b1flujo()", "la muestra de subtítulos (ffmpeg)"),
    ("async function g1activar(", "activar una versión (mux)"),
]


@pytest.mark.parametrize("marca,que", MECANICAS,
                         ids=["render", "subtitulos", "activar-version"])
def test_las_esperas_mecanicas_no_llevan_orbe(marca, que):
    """El orbe promete que hay alguien pensando. En un ffmpeg eso es mentira."""
    i = HTML.index(marca)
    tramo = HTML[i:i + 1400]
    assert "orbeOn(" not in tramo, f"{que} no debería llevar orbe"


# ---------------------------------------------------------------------------
# el dinero

COBRAN = [
    ('$("g1generar").onclick', '$("g1generar").disabled = true', "créditos: overlay-imagen"),
    ('$("g1animar").onclick', '$("g1animar").disabled = true', "créditos: overlay-video"),
    ("async function b2flujo()", "b.disabled = true", "créditos: broll-sugerir"),
    ('$("b3sugerir").onclick', '$("b3sugerir").disabled = true', "LLM nuestro"),
    ("async function b1flujo()", "b.disabled = true", "ffmpeg"),
]


@pytest.mark.parametrize("marca,guarda,que", COBRAN,
                         ids=[m.split('"')[1] if '"' in m else m.split()[-1][:-2]
                              for m, _, _ in COBRAN])
def test_el_boton_se_apaga_antes_de_la_peticion(marca, guarda, que):
    """Si el botón sigue vivo mientras corre el await, el segundo clic gasta
    otra vez. En dos de estos lo que se gasta son créditos del usuario."""
    pre = _preambulo(marca)
    assert guarda in pre, f"{marca} ({que}) no se apaga antes del await"


def test_el_confirm_de_gasto_sigue_yendo_primero():
    """Apagar el botón no puede comerse el gate: primero se pregunta, luego se
    apaga. Si no, un «Cancelar» dejaría el botón muerto."""
    for marca in ('$("g1generar").onclick', '$("g1animar").onclick',
                  "async function b2flujo()"):
        pre = _preambulo(marca)
        assert pre.index("confirm(") < pre.index("disabled = true"), \
            f"{marca}: se apaga el botón antes de preguntar"


def test_veo_no_revive_el_boton_al_salir_bien():
    """Tras el éxito viene un location.reload() con 1,2 s de espera. Rehabilitar
    ahí son 1,2 s en los que se puede volver a cobrar un video de Veo."""
    i = HTML.index('$("g1animar").onclick')
    cuerpo = HTML[i:HTML.index('async function g1activar', i)]
    assert 'finally { orbeOff("orbe-g1"); }' in cuerpo, \
        "el finally de Veo rehabilita el botón (o dejó de apagar el orbe)"


@pytest.mark.parametrize("marca", ['$("g1generar").onclick', "async function b2flujo()",
                                   '$("b3sugerir").onclick', "async function b1flujo()"])
def test_el_boton_vuelve_a_la_vida_aunque_falle(marca):
    """Lo contrario del caso de Veo: si falla, el botón NO puede quedar muerto."""
    i = HTML.index(marca)
    tramo = HTML[i:i + 2200]
    assert "finally {" in tramo and "disabled = false" in tramo, \
        f"{marca} puede quedarse muerto tras un error"


# ---------------------------------------------------------------------------
# el alert() global

def test_el_403_ya_no_abre_un_modal_del_navegador():
    """alert() bloquea el hilo hasta que alguien acepta, y las pantallas que
    hacen poll reciben el 403 cada pocos segundos: salía un modal sobre otro."""
    js = (RAIZ / "static" / "auth.js").read_text(encoding="utf-8")
    # sin los comentarios: el de abajo explica por qué se quitó y dice la palabra
    codigo = "\n".join(l for l in js.splitlines() if not l.strip().startswith("//"))
    assert "alert(" not in codigo, "auth.js volvió a usar alert()"
    assert "avisoAcceso()" in js
    # y no se apila: un 403 nuevo reinicia el reloj del mismo aviso
    cuerpo = js[js.index("function avisoAcceso()"):]
    assert "if (!aviso)" in cuerpo and "clearTimeout(avisoT)" in cuerpo
