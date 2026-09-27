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
        "clip.cobro.recarga_cerrada_dice_a_quien_escribir",
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
    "estilos": [
        "estilos.cobro.precio_del_servidor_en_el_boton",
        "estilos.cobro.doble_clic_un_solo_post",
        "estilos.cobro.el_sondeo_no_reabre_el_boton_con_el_cobro_en_vuelo",
        "estilos.cobro.sin_liga_no_cobra",
        "estilos.cobro.error_junto_al_boton",
        "estilos.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir",
        "estilos.cobro.limpia_y_refresca_el_saldo_tras_cobrar",
        "estilos.lista.perfil_listo_con_sus_campos",
        "estilos.lista.solo_colores_de_verdad_entran_al_style",
        "estilos.lista.textos_del_server_como_texto",
        "estilos.lista.error_dice_que_los_creditos_volvieron",
        "estilos.lista.copiar_el_prompt_y_su_fallo",
        "estilos.lista.sondea_mientras_analiza_y_para_al_terminar",
        "estilos.lista.sin_red_con_un_analisis_vivo_sigue_reintentando",
        "estilos.lista.fallo_de_carga_avisa_y_reintenta",
        "estilos.espera.titulo_de_la_pestana_dice_analizando",
        "estilos.marco.enlaces_estudio_y_version_anterior",
    ],
    "competencia": [
        "competencia.cobro.precio_por_cuenta_del_servidor",
        "competencia.cobro.sin_cuentas_no_se_puede_revisar",
        "competencia.cobro.doble_clic_un_solo_post",
        "competencia.cobro.el_error_va_junto_a_revisar",
        "competencia.cobro.sin_saldo_402_con_la_recarga_abierta_ofrece_recargar",
        "competencia.cuentas.agregar_es_gratis_y_limpia_el_campo",
        "competencia.cuentas.sin_liga_o_con_error_lo_dice_junto_al_campo",
        "competencia.cuentas.quitar_y_su_fallo_con_reintentar",
        "competencia.informe.resumen_ver_y_cerrar",
        "competencia.informe.lectura_fallidas_y_devueltos",
        "competencia.informe.numeros_honestos",
        "competencia.informe.textos_y_ligas_de_terceros_seguros",
        "competencia.informe.fallo_al_abrir_avisa_y_reintenta",
        "competencia.informe.error_dice_que_los_creditos_volvieron",
        "competencia.lista.sondea_mientras_revisa_y_para_al_terminar",
        "competencia.lista.sin_red_con_una_revision_viva_sigue_reintentando",
        "competencia.lista.fallo_de_carga_avisa_y_reintenta",
        "competencia.espera.titulo_de_la_pestana_dice_revisando",
        "competencia.marco.enlaces_estudio_y_version_anterior",
    ],    "inicio": [
        "inicio.caja.arranca_en_el_clip_lo_mas_barato",
        "inicio.caja.precios_de_tarifas_json",
        "inicio.caja.cada_opcion_lleva_a_su_destino_con_su_modo",
        "inicio.caja.sin_texto_no_navega",
        "inicio.caja.cada_opcion_cambia_el_ejemplo",
        "inicio.caja.desplegable_con_teclado",
        "inicio.caja.cambiar_de_familia_elige_la_primera",
        "inicio.caminos.solo_con_las_cuatro_listas_bien_y_vacias",
        "inicio.caminos.desde_una_idea_no_cobra_solo_elige",
        "inicio.caminos.enlaces_a_shorts_y_metraje",
        "inicio.carga.sin_proyectos_avisa_y_reintentar",
        "inicio.proyectos.cada_tarjeta_lleva_a_crear",
        "inicio.proyectos.nueva_pelicula_solo_si_hay_slot",
        "inicio.proyectos.miniatura_rota_cae_al_personaje_y_al_hueco",
        "inicio.proyectos.archivar_pide_confirmar",
        "inicio.proyectos.no_se_ofrece_archivar_mientras_corre",
        "inicio.proyectos.error_al_archivar_dice_el_motivo",
        "inicio.proyectos.restaurar_desde_archivados",
        "inicio.imagenes.cinco_y_ver_todas",
        "inicio.imagenes.cada_una_abre_para_editar_y_la_rota_no_deja_icono",
        "inicio.imagenes.si_falla_la_lista_no_se_rompe",
        "inicio.ediciones.estado_y_enlace_a_e1",
        "inicio.listas.orden_proyectos_imagenes_ediciones",
        "inicio.listas.textos_del_server_como_texto",
        "inicio.menu.entradas_y_grupos_en_orden",
        "inicio.menu.sin_clave_se_apagan_las_cuatro_de_blotato_y_ofrecen_conectar",
        "inicio.menu.si_no_se_sabe_no_se_apaga_nada",
        "inicio.menu.pregunta_ligero",
        "inicio.blotato.mas_abre_el_dialogo_con_las_redes",
        "inicio.blotato.aviso_del_cobro_con_el_precio_del_server_antes_del_campo",
        "inicio.blotato.clave_password_sin_autocompletar",
        "inicio.blotato.la_clave_se_borra_al_conectar_cancelar_y_cerrar",
        "inicio.blotato.sin_clave_no_manda_nada",
        "inicio.blotato.error_del_server_se_dice_en_el_dialogo",
        "inicio.blotato.clave_del_env_no_se_ofrece_desconectar",
        "inicio.blotato.desconectar_pide_confirmar",
        "inicio.blotato.viene_del_editor_con_blotato_conectar",
        "inicio.blotato.enlace_a_la_api_con_noopener",
        "inicio.blotato.conectar_enciende_el_menu",
        "inicio.marco.version_anterior",
    ],
    "shorts": [
        "shorts.cobro.analizar_con_el_precio_del_servidor",
        "shorts.cobro.analizar_doble_clic_un_solo_post",
        "shorts.cobro.el_sondeo_no_reabre_analizar_con_el_cobro_en_vuelo",
        "shorts.cobro.sin_backend_listo_analizar_apagado_con_el_aviso",
        "shorts.cobro.sin_precio_no_hay_boton_de_analizar",
        "shorts.analisis.orbe_solo_en_el_analisis",
        "shorts.analisis.error_dice_que_los_creditos_volvieron_sin_orbe",
        "shorts.cobro.renderizar_n_por_el_precio_del_servidor",
        "shorts.cobro.renderizar_sin_precio_del_servidor_no_cobra",
        "shorts.cobro.renderizar_manda_lo_elegido_y_ajustado",
        "shorts.cobro.renderizar_doble_clic_un_solo_post",
        "shorts.cobro.tiempos_fuera_de_rango_no_cobran",
        "shorts.cobro.mas_de_diez_no_cobra",
        "shorts.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir",
        "shorts.cobro.saldo_conocido_que_no_alcanza_no_cobra",
        "shorts.cobro.refresca_el_saldo_tras_cobrar_y_al_terminar",
        "shorts.candidatos.lo_elegido_sobrevive_al_sondeo",
        "shorts.cobro.importar_cotiza_antes_de_cobrar",
        "shorts.cobro.cambiar_la_liga_anula_la_cotizacion",
        "shorts.cobro.importar_doble_clic_un_solo_post",
        "shorts.cobro.importado_abre_el_proyecto",
        "shorts.cobro.importar_409_abre_el_que_ya_existe",
        "shorts.importacion.descargando_sin_orbe_y_sin_la_liga",
        "shorts.importacion.fallida_dice_que_los_creditos_volvieron",
        "shorts.cobro.un_solo_principal_por_vista",
        "shorts.eleccion.lista_los_proyectos_con_metraje",
        "shorts.eleccion.sin_red_no_dice_que_no_tienes_videos",
        "shorts.carga.fallo_avisa_con_reintentar",
        "shorts.render.corriendo_sondea_y_al_terminar_muestra_las_salidas",
        "shorts.render.error_dice_que_los_creditos_volvieron",
        "shorts.salidas.descargar_por_el_servicio_y_ver_solo_http",
        "shorts.salidas.textos_del_server_como_texto",
        "shorts.espera.sin_red_con_algo_vivo_sigue_reintentando",
        "shorts.espera.titulo_de_la_pestana",
        "shorts.subida.sube_y_abre_el_proyecto",
        "shorts.marco.enlaces_estudio_y_version_anterior",
    ],
    "subir": [
        "subir.cobro.precio_del_servidor_en_el_boton",
        "subir.cobro.pide_confirmar_y_cancelar_no_cobra",
        "subir.cobro.doble_clic_un_solo_post",
        "subir.cobro.sin_precio_no_hay_boton",
        "subir.cobro.error_se_queda_y_el_boton_vuelve",
        "subir.cobro.sin_saldo_con_la_recarga_cerrada_dice_a_quien_escribir",
        "subir.cobro.saldo_conocido_que_no_alcanza_no_cobra",
        "subir.cobro.refresca_el_saldo_y_pasa_a_revisando",
        "subir.subida.sin_servicio_no_se_ofrece",
        "subir.subida.sin_nombre_o_archivo_no_pide_firma",
        "subir.subida.nombre_invalido_no_pide_firma",
        "subir.subida.firma_con_proyecto_archivo_tipo_y_bytes",
        "subir.subida.progreso_real_con_porcentaje_y_mb",
        "subir.subida.cancelar_aborta_y_lo_dice",
        "subir.subida.nombre_ocupado_409_deja_una_variante",
        "subir.subida.fallo_del_put_avisa_y_deja_reintentar",
        "subir.subida.confirma_y_pasa_al_panel_con_p_en_la_url",
        "subir.subida.avisa_antes_de_cerrar_a_medias",
        "subir.subida.doble_clic_una_sola_firma",
        "subir.panel.sin_proyecto_no_hay_panel",
        "subir.panel.proyecto_codificado_en_la_ruta",
        "subir.panel.video_de_muestra_desde_el_cdn",
        "subir.panel.sin_metraje_pide_subirlo_primero",
        "subir.panel.cortes_ia_lleva_a_shorts_con_el_proyecto",
        "subir.panel.listo_editar_y_resumen",
        "subir.panel.sin_relleno_dice_que_devolvimos",
        "subir.panel.corrida_fallida_dice_que_los_creditos_volvieron",
        "subir.panel.metraje_con_duracion_y_transcript",
        "subir.panel.local_503_manda_a_clean_cut",
        "subir.panel.un_solo_principal",
        "subir.panel.textos_del_server_como_texto",
        "subir.espera.sondea_mientras_corre_y_para_al_terminar",
        "subir.espera.sin_red_con_la_corrida_viva_sigue_reintentando",
        "subir.espera.titulo_de_la_pestana_dice_revisando",
        "subir.espera.el_orbe_ocupa_el_sitio_de_la_animacion",
        "subir.marco.enlaces_estudio_y_version_anterior",
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
