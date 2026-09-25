"""UI·16 — la copiadora de estilos manda sus avisos sueltos al cuadro de
trabajos.js (window.avisos).

Se mueve lo que no es de ningún campo ni tarjeta: el «sin conexión» del poll,
el «copiado» del prompt y el fallo al traer la lista. Se queda en su sitio lo
que sí es de un campo o del botón que cobra (#estado junto a «Analizar»).
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
ESTILOS = (RAIZ / "static" / "estilos.html").read_text(encoding="utf-8")


def _script():
    return ESTILOS[ESTILOS.index("<script>\n"):ESTILOS.rindex("</script>")]


def _cargar():
    s = _script()
    i = s.index("async function cargar()")
    return s[i:s.index("\n}\n", i)]


def test_el_banner_local_de_sin_red_ya_no_existe():
    assert 'id="red"' not in ESTILOS
    assert "#red" not in ESTILOS
    assert '$("red")' not in ESTILOS
    assert "sinred" not in ESTILOS


def test_sin_red_va_al_cuadro_con_la_clave_red():
    c = _cargar()
    assert ('window.avisos?.mostrar("Sin conexión — reintentando… Tu análisis sigue en la nube.",\n'
            '                             { tipo: "info", clave: "red" });') in c
    # el poll sigue vivo tras el fallo (M19) y al volver se quita el aviso
    assert "programarPoll();" in c and 'orbeEst.estado("idle")' in c
    ok = c[c.index("window.avisos?.quitar(\"red\");"):]
    assert 'orbeEst.estado("pensando")' in ok


def test_el_fallo_de_carga_va_al_cuadro_con_reintentar():
    c = _cargar()
    assert re.search(r'window\.avisos\?\.mostrar\("No pudimos traer tus perfiles de estilo\.[^"]*",\s*'
                     r'\{ tipo: "mal", clave: "estilos-carga", accion: \{ texto: "Reintentar", al: cargar \} \}\);', c)
    assert 'window.avisos?.quitar("estilos-carga");' in c
    # la lista no se queda con el error pintado adentro
    assert '<span class="err">${esc(e.message)}</span>' not in c
    assert '$("lista").innerHTML = `<span class="err">' not in ESTILOS


def test_copiar_por_delegacion_y_aviso_ok():
    s = _script()
    assert "onclick=\"navigator.clipboard" not in ESTILOS
    assert '<button class="btn btn-sec copiar" data-copiar>copiar</button>' in ESTILOS
    assert '$("lista").addEventListener("click", ev => {' in s
    assert 'ev.target.closest("[data-copiar]")' in s
    assert 'window.avisos?.mostrar("Copiado", { tipo: "ok", clave: "copiado" })' in s
    assert ('window.avisos?.mostrar("No se pudo copiar. Selecciona el texto y cópialo a mano.",\n'
            '                                 { tipo: "mal", clave: "copiado" })') in s
    # el botón ya no cambia a «copiado» para siempre
    assert "' copiado'" not in ESTILOS and "icono('listo')" not in ESTILOS


def test_todas_las_llamadas_usan_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", ESTILOS)
    assert not re.search(r"(?<![\w.?])avisos\.(mostrar|quitar)", ESTILOS)


def test_la_validacion_y_el_402_siguen_junto_al_boton():
    s = _script()
    assert 'if (!url) { $("estado").textContent = "Pega la liga primero."; return; }' in s
    assert "$(\"estado\").innerHTML = `<span class=\"err\">${esc(e.message)}</span> `;" in s
    assert '$("estado").appendChild(botonRecargar());' in s
