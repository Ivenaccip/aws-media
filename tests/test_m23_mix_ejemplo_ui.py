"""M23 · D — la pantalla del ejemplo del día 1 de MIX (static/mix.html).

Separado de test_m23_mix_ejemplo.py (UI·1, Fase 0 de docs/PLAN-UI.md): allí
queda el endpoint, la base y el worker; aquí solo lo que lee static/mix.html,
para que retirar el HTML viejo no tumbe los tests del servidor. El porqué de
cada regla está en el docstring de aquel archivo.
"""
import functools
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent


@functools.lru_cache(maxsize=None)
def _pantalla() -> str:
    return (RAIZ / "static" / "mix.html").read_text(encoding="utf-8")


# ---------------------------------------------------------------------------
# la pantalla

def test_la_pantalla_ya_no_espera_el_ejemplo_en_la_respuesta_del_post():
    """El POST ya solo devuelve el día. Si la pantalla siguiera leyendo
    `j.imagen`, enseñaría un hueco en vez del ejemplo — y en silencio."""
    pedido = _pantalla()[_pantalla().index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    assert '(await mxPost("/api/mix/ejemplo")).dia' in pedido
    assert "j.imagen" not in pedido and "j.texto" not in pedido
    assert "mxSeguirEjemplo(dia, firma)" in pedido


def test_la_pantalla_consulta_hasta_que_el_dia_uno_esta_listo():
    assert "async function mxEsperarEjemplo" in _pantalla()
    espera = _pantalla()[_pantalla().index("async function mxEsperarEjemplo"):
                      _pantalla().index("async function mxSeguirEjemplo")]
    assert 'mxFj("/api/mix"' in espera
    assert 'fila.estado === "ejemplo"' in espera
    # y un intento muerto corta la espera en vez de girar hasta el tope
    assert "if (fila.error)" in espera
    # igual que encender la campaña: desde ahí manda el reloj, no esta pantalla
    assert 'j.campana.estado !== "borrador"' in espera
    # y una petición colgada no puede congelar la espera entera
    assert "AbortSignal.timeout" in espera


def test_la_pantalla_retoma_un_ejemplo_a_medias_al_volver():
    """Es lo que compra haberlo pasado a la cola: el trabajo sigue en la nube
    sin esta pestaña. Sin esto, cerrarla seguiría costando el ejemplo."""
    assert 'x.estado === "preparando"' in _pantalla()
    assert "mxSeguirEjemplo(String(aMedias.dia).slice(0, 10)" in _pantalla()


def test_un_intento_muerto_se_lee_al_volver_a_la_pantalla():
    """Si murió mientras no había nadie mirando, este es el ÚNICO sitio donde
    puede leerse. Sin esto el usuario vuelve y encuentra la pantalla como si
    nunca hubiera pedido nada: sin ejemplo, sin error y sin saber qué pasó."""
    assert "if (aMedias.error) { mxAviso(aMedias.error); return; }" in _pantalla()


def test_el_409_de_pedir_otro_ejemplo_no_deja_un_callejon():
    """El servidor respeta un ejemplo en camino diez minutos y la pantalla deja
    de mirarlo a los cuatro: en ese hueco el botón contestaría 409 una y otra
    vez. Recargar reengancha la espera del que ya existe — y vale igual para el
    otro 409, el de la campaña ya encendida."""
    pedido = _pantalla()[_pantalla().index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    assert "if (fallo.status === 409) {" in pedido
    assert "await mxCargar();" in pedido


def test_el_sondeo_se_va_frenando():
    """GET /api/mix trae campaña, corridas, saldo y el estado de Blotato, y
    Aurora está en una sola ACU con 182 personas por llegar. Preguntar cada
    cinco segundos durante cuatro minutos, por pestaña, es carga que no hace
    falta pasado el primer minuto."""
    import re
    pasos = [int(n) for n in
             re.search(r"MXEJ_PASOS = \[([^\]]+)\]", _pantalla()).group(1).split(",")]
    assert pasos == sorted(pasos), "los pasos tienen que crecer, no encogerse"
    assert pasos[0] <= 5000 and pasos[-1] >= 15000


def test_pedir_otro_ejemplo_retira_el_anterior_de_la_pantalla():
    """Con la cola, pedir otro ejemplo devuelve su fila a 'preparando' y desde
    ahí /encender contesta 409. Dejar el anterior en pantalla enseñaría el
    costo y el botón de encender durante los dos minutos en que pulsarlo no
    puede funcionar — un callejón, y encima con el precio delante."""
    pedido = _pantalla()[_pantalla().index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    retirado = "\n".join(["  mxEjemplo = null;", "  mxFirmaEjemplo = null;",
                          "  mxCambio();"])
    assert retirado in pedido


def test_los_errores_de_la_espera_llevan_status():
    """`mxTexto` solo enseña el mensaje de un error que traiga `status`; sin él
    lo cambia por el aviso de «sin conexión», que aquí sería mentira — el
    servidor contestó, y lo que dijo es justo lo que hay que leer."""
    espera = _pantalla()[_pantalla().index("async function mxEsperarEjemplo"):
                      _pantalla().index("async function mxSeguirEjemplo")]
    for lanzado in espera.split("throw ")[1:]:
        assert lanzado.startswith("Object.assign") or lanzado.startswith("e;"), \
            "un error sin status se leería como «sin conexión»"


def test_un_tropiezo_del_servidor_no_cancela_la_espera():
    """Aurora se duerme sola y el primer despertar tarda quince segundos: un
    5xx a mitad de la espera es pasajero y el trabajo sigue corriendo en la
    nube. Rendirse ahí sería tirar un ejemplo que estaba a punto de salir. Un
    4xx sí corta: la sesión caducó y no mejora por insistir."""
    espera = _pantalla()[_pantalla().index("async function mxEsperarEjemplo"):
                      _pantalla().index("async function mxSeguirEjemplo")]
    assert "if (st >= 400 && st < 500) throw e;" in espera
    assert "continue;" in espera


def test_el_orbe_avisa_antes_de_que_la_pantalla_se_rinda():
    """Si el aviso y el abandono cayeran a la vez, el usuario no llegaría a
    leer que puede cerrar la pantalla y volver."""
    import re
    aviso = int(re.search(r"MXEJ_AVISO = (\d+)", _pantalla()).group(1))
    tope = int(re.search(r"MXEJ_TOPE = (\d+)", _pantalla()).group(1))
    assert aviso < tope


def test_la_espera_ya_no_promete_veinte_segundos():
    """Prometer ~20 s para algo que tarda hasta dos minutos es enseñarle al
    usuario que la pantalla se colgó."""
    assert "~20 s" not in _pantalla()
    assert "Preparando tu ejemplo · hasta 2 min" in _pantalla()
    # y ya no hace falta pedirle que no cierre: el trabajo no vive aquí
    assert "no cierres esta pantalla todavía" not in _pantalla()
