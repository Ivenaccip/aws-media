"""M4 — la recarga de créditos está CERRADA (decisión del dueño, 2026-09-26).

Mientras los Payment Links de Stripe no estén firmes, ningún punto de la
interfaz puede mandar a comprar: una liga que falla justo cuando te quedas sin
créditos es peor que no ofrecer nada. Lo que se protege aquí es que el apagado
siga siendo COMPLETO y siga saliendo de UN solo interruptor. El fallo que
persigue: que alguien encienda un botón suelto y deje los otros seis apagados,
o que reabra la recarga sin enterarse de que toca siete sitios a la vez.

Para reabrir: `const RECARGA = true` en static/monedero.js — y estos tests
cambian con ella, que es justamente el aviso de que la decisión se revirtió.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESTATICOS = RAIZ / "static"
MONEDERO = ESTATICOS / "monedero.js"
# las cuatro pantallas que pintan su propio botón «Recargar»
CON_BOTON = ("competencia.html", "estilos.html", "mix.html", "shorts.html")
# las dos que solo escriben el aviso de «te faltan créditos»
CON_AVISO = ("crear.html", "imagenes.html")


def test_el_interruptor_existe_y_esta_cerrado():
    assert "const RECARGA = false;" in MONEDERO.read_text(encoding="utf-8")


def test_el_mas_de_la_pildora_no_se_construye():
    """El ＋ se arma DENTRO de la rama de RECARGA, no se oculta después:
    marcarlo `hidden` no serviría, porque su display:flex inline le gana al
    atributo y nacería visible igual."""
    js = MONEDERO.read_text(encoding="utf-8")
    mas = js[js.index("const MAS = RECARGA"):js.index("const PAD_SALDO")]
    assert 'id="mon-cta"' in mas, "el ＋ ya no se construye bajo la bandera"
    assert js.count('id="mon-cta"') == 1, "el ＋ se pinta desde otro sitio"


def test_el_panel_de_compra_no_abre():
    js = MONEDERO.read_text(encoding="utf-8")
    cuerpo = js[js.index("function togglePanel()"):js.index("function cerrarFuera")]
    assert "if (!RECARGA) return;" in cuerpo, "togglePanel sigue abriendo el panel"


def test_ninguna_pantalla_pinta_su_boton_sin_consultar():
    for pagina in CON_BOTON:
        texto = (ESTATICOS / pagina).read_text(encoding="utf-8")
        assert "window.monedero.recarga" in texto, pagina


def test_el_aviso_ya_no_manda_al_mas():
    """Con el ＋ apagado, «Pulsa ＋ arriba a la derecha» mandaría a un botón que
    no existe: el texto sale de monedero.js para que cambie con la bandera."""
    for pagina in CON_AVISO:
        texto = (ESTATICOS / pagina).read_text(encoding="utf-8")
        assert "window.monedero.cta" in texto, pagina
        assert "Pulsa ＋" not in texto, f"{pagina} conserva el texto viejo"


def test_el_servidor_no_da_la_instruccion():
    """El 402 informa el HECHO; la salida la pone la interfaz, que es la única
    que sabe si la recarga está abierta. Si el servidor volviera a decirlo, la
    frase saldría DOS veces en imágenes y en crear."""
    texto = (RAIZ / "pipeline" / "creditos.py").read_text(encoding="utf-8")
    assert "Recarga créditos" not in texto


# ---------------------------------------------------------------------------
# la UI nueva (web/) obedece al MISMO interruptor

def _fuentes_web():
    src = RAIZ / "web" / "src"
    if not src.is_dir():
        return []
    return [p for p in src.rglob("*.ts*") if ".test." not in p.name]


def test_web_solo_ofrece_recargar_desde_recarga_tsx():
    """UI·8.2: un solo componente decide botón o texto leyendo
    window.monedero.recarga; ninguna pantalla llama a recargar() por su cuenta
    (así nació el «Recargar» muerto que se corrigió en clip)."""
    recarga = RAIZ / "web" / "src" / "marca" / "Recarga.tsx"
    if not recarga.exists():
        return
    texto = recarga.read_text(encoding="utf-8")
    assert "m.recarga" in texto and "m.cta" in texto
    for p in _fuentes_web():
        if p == recarga:
            continue
        codigo = p.read_text(encoding="utf-8")
        assert not re.search(r"monedero\??\.recargar\(", codigo), \
            f"{p.relative_to(RAIZ)} abre la recarga sin mirar el interruptor"
