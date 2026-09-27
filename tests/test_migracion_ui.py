"""UI·7 — registro anti-pérdida de la migración (docs/PLAN-UI.md §5).

Cada pantalla que se migra declara aquí sus INVARIANTES: lo que la pantalla
vieja garantiza y la nueva no puede perder (sobre todo dinero y seguridad).
Cada ID tiene que existir como nombre de un test en
web/src/pantallas/<pantalla>/ — `it('<id>', …)` — y se comprueba siempre,
no solo al retirar: si la nueva ya existe, sus invariantes ya están cubiertos.

Además, por etapa (server/migracion.py):
  · `nueva` y `todos`: el HTML viejo sigue en static/;
  · `retirada`: el HTML viejo ya no existe.
Y cada pantalla registrada tiene su docs/migracion/<pantalla>.md, con cada
aserción vieja y su destino.
"""
import re
from pathlib import Path

import pytest

from server import migracion

RAIZ = Path(__file__).resolve().parent.parent
PANTALLAS_WEB = RAIZ / "web" / "src" / "pantallas"

INVARIANTES = {
    "admin": [
        "admin.vistas.tres_pestanas_con_aria",
        "admin.acceso.sin_permiso_muestra_solo_administradores",
        "admin.carga.sin_red_pide_revisar_la_conexion",
        "admin.carga.error_del_server_muestra_su_detalle",
        "admin.textos.del_server_se_pintan_como_texto",
        "admin.dinero.totales_en_dolares",
        "admin.detalle.uid_codificado_en_la_ruta",
        "admin.detalle.traza_con_id_codificado",
        "admin.detalle.sin_red_avisa_y_reintenta",
        "admin.detalle.error_del_server_en_su_tarjeta",
        "admin.sync.doble_clic_un_solo_post",
        "admin.sync.error_deja_volver_a_intentar",
        "admin.flujo.signo_pinta_verde_o_rojo",
        "admin.marco.enlaces_estudio_y_version_anterior",
    ],
    "clip": [
        "clip.cobro.precio_del_servidor_en_el_boton",
        "clip.cobro.doble_clic_un_solo_post",
        "clip.cobro.manda_texto_formato_y_fotos",
        "clip.cobro.sin_texto_no_cobra",
        "clip.cobro.fotos_subiendo_no_cobra",
        "clip.cobro.error_junto_al_boton_y_se_puede_reintentar",
        "clip.cobro.sin_saldo_402_ofrece_recargar",
        "clip.cobro.saldo_conocido_que_no_alcanza_no_cobra",
        "clip.cobro.refresca_el_saldo_y_limpia_tras_cobrar",
        "clip.cobro.espera_a_que_termine_antes_de_otro",
        "clip.fotos.pesada_no_se_sube",
        "clip.fotos.heic_sin_tipo_firma_y_sube_con_image_heic",
        "clip.fotos.fallo_de_subida_la_quita_y_avisa",
        "clip.fotos.tope_oculta_agregar_y_quitar_la_devuelve",
        "clip.formato.horizontal_por_defecto",
        "clip.entrada.brief_rellena_el_texto_y_se_limpia_la_url",
        "clip.entrada.recupera_lo_apartado_si_la_sesion_vencio",
        "clip.lista.textos_del_usuario_como_texto",
        "clip.lista.listo_con_video_detalle_y_recorte",
        "clip.lista.error_dice_que_los_creditos_volvieron",
        "clip.lista.vacia_invita_al_primero",
        "clip.lista.sondea_mientras_genera_y_para_al_terminar",
        "clip.lista.fallo_de_carga_avisa_reintenta_y_sigue_solo",
        "clip.espera.titulo_de_la_pestana_dice_generando",
        "clip.marco.enlaces_estudio_y_version_anterior",
    ],
}

_ID = re.compile(r"^[a-z0-9_]+(\.[a-z0-9_]+){2,}$")


def _tests_de(pantalla: str) -> set[str]:
    """Los nombres de los it()/test() de web/src/pantallas/<pantalla>/."""
    nombres = set()
    for f in (PANTALLAS_WEB / pantalla).rglob("*.test.ts*"):
        texto = f.read_text(encoding="utf-8")
        nombres |= set(re.findall(r"""\b(?:it|test)\(\s*['"]([^'"]+)['"]""", texto))
    return nombres


def test_cada_pantalla_del_interruptor_esta_en_el_registro():
    assert set(migracion.PANTALLAS) == set(INVARIANTES)


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_los_ids_estan_bien_escritos_y_no_se_repiten(pantalla):
    ids = INVARIANTES[pantalla]
    assert len(ids) == len(set(ids))
    for i in ids:
        assert _ID.match(i), i
        assert i.startswith(pantalla + "."), i


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_cada_invariante_existe_como_test_en_web(pantalla):
    if not (PANTALLAS_WEB / pantalla).is_dir():
        # todavía no hay pantalla nueva: solo se puede estar en `nueva`
        assert migracion.PANTALLAS[pantalla].etapa == "nueva"
        return
    faltan = set(INVARIANTES[pantalla]) - _tests_de(pantalla)
    assert not faltan, f"{pantalla}: invariantes sin test en web/: {sorted(faltan)}"


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_ningun_test_con_id_queda_fuera_del_registro(pantalla):
    # un test nuevo con forma de ID y sin registrar se perdería al retirar
    sueltos = {n for n in _tests_de(pantalla) if n.startswith(pantalla + ".")} - set(INVARIANTES[pantalla])
    assert not sueltos, f"regístralos en INVARIANTES: {sorted(sueltos)}"


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_el_html_viejo_existe_hasta_retirarlo(pantalla):
    p = migracion.PANTALLAS[pantalla]
    vieja = RAIZ / "static" / p.archivo
    if p.etapa == "retirada":
        assert not vieja.exists(), f"{pantalla} está retirada: borra {vieja.relative_to(RAIZ)}"
    else:
        assert vieja.is_file(), f"{pantalla} en `{p.etapa}` necesita {vieja.relative_to(RAIZ)}"


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_cada_pantalla_tiene_su_mapa_de_aserciones(pantalla):
    doc = RAIZ / "docs" / "migracion" / f"{pantalla}.md"
    assert doc.is_file(), f"falta {doc.relative_to(RAIZ)}"
    texto = doc.read_text(encoding="utf-8")
    for i in INVARIANTES[pantalla]:
        assert f"`{i}`" in texto, f"{doc.name} no dice dónde quedó {i}"


@pytest.mark.parametrize("pantalla", sorted(INVARIANTES))
def test_la_pantalla_nueva_tiene_su_pagina(pantalla):
    html = RAIZ / "web" / "estudio" / pantalla / "index.html"
    if migracion.PANTALLAS[pantalla].etapa != "nueva" or (PANTALLAS_WEB / pantalla).is_dir():
        assert html.is_file(), f"falta {html.relative_to(RAIZ)}"
        texto = html.read_text(encoding="utf-8")
        # privada: auth.js clásico antes del módulo (docs/PLAN-UI.md §3)
        assert texto.index('<script src="/auth.js">') < texto.index('type="module"')
