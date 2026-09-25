"""UI·16 — crear.html manda al cuadro de avisos (trabajos.js) lo que no es de
ningún campo: el aviso de red del sondeo, los créditos devueltos al cancelar,
la muestra de voz que no cargó, la película que no se pudo abrir y la vuelta a
revisión que falló por red. La validación y los errores junto al botón que
cobra se quedan donde estaban.
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CREAR = (RAIZ / "static" / "crear.html").read_text(encoding="utf-8")


def _cuerpo(inicio, largo=900):
    i = CREAR.index(inicio)
    return CREAR[i:i + largo]


def test_el_banner_local_de_conexion_ya_no_existe():
    assert 'id="conexion"' not in CREAR
    assert "#conexion" not in CREAR
    assert "$('#conexion')" not in CREAR


def test_el_sondeo_usa_el_aviso_de_red_compartido():
    f = _cuerpo("async function refrescar() {", 1400)
    # solo se quita si lo pusimos (no repinta el cuadro en cada sondeo)
    assert "if (fallosPoll >= 2) window.avisos?.quitar('red');\n    fallosPoll = 0;" in f
    assert ("window.avisos?.mostrar('Sin conexión — reintentando… Tu trabajo sigue en la nube.', "
            "{tipo:'info', clave:'red'});") in f
    # el orbe sigue bajando a reposo sin contacto
    assert "mandoProg.estado('idle');" in f


def test_creditos_devueltos_al_cancelar_van_como_confirmacion():
    f = _cuerpo("$('#cancelar').onclick")
    assert "window.avisos?.mostrar(`Te devolvimos ${d.devueltos} créditos.`, {tipo:'ok'});" in f
    assert "$('#rerr').textContent = `Te devolvimos" not in CREAR
    # el fallo de cancelar sigue junto a su tarjeta
    assert "$('#imgerr').textContent = e.message;" in f


def test_muestra_de_voz_fallida_va_al_cuadro_de_avisos():
    f = _cuerpo("au.onerror")
    assert ("window.avisos?.mostrar('No se pudo cargar la muestra de voz — intenta de nuevo.', "
            "{tipo:'mal', clave:'crear-voz'})") in f
    assert "$('#rerr').textContent = 'No se pudo cargar la muestra" not in CREAR
    # al cargar bien la siguiente muestra, el aviso de fallo se va
    assert "au.oncanplay = () => { listo(); window.avisos?.quitar('crear-voz');" in CREAR


def test_modificar_avisa_si_falla_la_red_y_deja_modif_err_para_el_servidor():
    f = _cuerpo("$('#modificar').onclick", 1200)
    assert re.search(r"try \{ r = await fetch\(`/api/proyectos/\$\{proyecto\.id\}/reabrir`", f)
    assert "window.avisos?.mostrar('No se pudo volver a revisión — revisa tu conexión.', {tipo:'mal', clave:'crear-modif'});" in f
    # un nuevo intento limpia el aviso anterior
    assert f.index("window.avisos?.quitar('crear-modif');") < f.index("try { r = await fetch(")
    assert "if (!r.ok) { $('#modif-err').textContent = await errTxt(r); return; }" in f
    # el botón no se queda deshabilitado tras el fallo de red
    catch = f[f.index("catch {"):f.index("return;")]
    assert "$('#modificar').disabled = false;" in catch


def test_reanudar_por_url_ya_no_calla():
    f = _cuerpo("const pid = new URLSearchParams(location.search).get('p');", 900)
    assert "'No pudimos abrir esa película. Revisa tu conexión e inténtalo de nuevo.'" in f
    assert "{tipo:'mal', clave:'crear-carga', accion:{texto:'Reintentar', al: () => location.reload()}}" in f
    assert ".catch(noAbrio)" in f
    assert "else noAbrio();" in f
    assert "window.avisos?.quitar('crear-carga');" in f


def test_siempre_con_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", CREAR)
    assert CREAR.count("window.avisos?.mostrar(") == 5


def test_la_validacion_y_los_errores_de_campo_siguen_en_su_sitio():
    assert "$('#rerr').textContent = 'Elige una opción de personaje.'" in CREAR
    assert "} catch (e) { $('#rerr').textContent = e.message; }" in CREAR
    for id_ in ("rerr", "modif-err", "eerr", "ferr", "autosave", "pmodmsg", "estilo_ej"):
        assert f'id="{id_}"' in CREAR, id_
    # el botón que cobra no se tocó
    for id_ in ("enviar", "cobronota", "costo-fila"):
        assert f'id="{id_}"' in CREAR, id_


def test_el_confirm_del_balanceador_sigue():
    assert "if (confirm(`${d.balanceador || 'El tema no parece de tu rubro.'}\\n\\n¿Crear de todos modos?`))" in CREAR
