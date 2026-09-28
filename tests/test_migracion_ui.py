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
    "agenda": [
        "agenda.carga.una_sola_llamada_al_abrir_y_ningun_sondeo",
        "agenda.lista.resumen_con_el_total_del_servidor",
        "agenda.lista.ver_mas_agrega_al_final_con_el_cursor",
        "agenda.lista.ultima_pagina_vacia_apaga_ver_mas",
        "agenda.lista.fallo_blando_conserva_tarjetas_total_y_cursor",
        "agenda.lista.fallo_sin_nada_pintado_dice_que_no_pudo_no_que_no_hay",
        "agenda.lista.vacia_dice_como_programar",
        "agenda.lista.recarga_pedida_durante_otra_se_encola",
        "agenda.lista.botones_apagados_mientras_recarga",
        "agenda.lista.textos_de_blotato_como_texto",
        "agenda.tarjeta.destino_en_la_tarjeta_el_dialogo_y_la_confirmacion",
        "agenda.tarjeta.puntos_suspensivos_los_decide_cortado",
        "agenda.tarjeta.adjuntos_se_llaman_archivos_y_cero_no_se_pinta",
        "agenda.errores.solo_el_409_ofrece_conectar_blotato",
        "agenda.errores.clave_rechazada_al_listar_ofrece_conectar",
        "agenda.errores.sin_red_en_espanol_y_reintentar_recarga",
        "agenda.hora.solo_manda_id_y_cuando_en_utc",
        "agenda.hora.fecha_vacia_o_pasada_no_llama_y_no_apaga_guardar",
        "agenda.hora.menos_de_un_minuto_no_llama",
        "agenda.hora.el_minimo_del_campo_lleva_el_margen",
        "agenda.hora.el_404_cierra_repinta_y_avisa_con_el_texto_del_servidor",
        "agenda.hora.otro_fallo_se_queda_en_el_dialogo",
        "agenda.hora.cerrar_mientras_guarda_el_fallo_va_a_la_pantalla",
        "agenda.hora.una_respuesta_tardia_no_cierra_el_dialogo_de_otra",
        "agenda.hora.el_doble_clic_no_cierra_el_dialogo_recien_abierto",
        "agenda.hora.el_exito_se_anuncia_y_el_foco_no_cae_al_body",
        "agenda.cancelar.la_confirmacion_arranca_en_no_y_decir_no_no_llama",
        "agenda.cancelar.manda_confirmar_true_anuncia_y_devuelve_el_foco",
        "agenda.cancelar.el_404_recarga_y_despues_avisa",
        "agenda.cancelar.el_409_ofrece_conectar",
        "agenda.cobro.no_cobra_ni_pinta_ambar_fuera_del_dialogo",
        "agenda.marco.enlaces_estudio_y_version_anterior",
    ],
    "metricas": [
        "metricas.carga.una_llamada_al_abrir_y_ningun_sondeo",
        "metricas.numeros.un_contador_que_no_llego_es_un_hueco_y_no_un_cero",
        "metricas.numeros.una_bajada_se_ensena_como_bajada",
        "metricas.numeros.los_milisegundos_no_se_ensenan_como_numero",
        "metricas.detalle.ver_el_resto_despliega_sin_llamar",
        "metricas.ver_numeros.solo_para_lo_que_no_sabemos_y_no_promete_actualizar",
        "metricas.ver_numeros.escribe_en_las_dos_listas_y_el_boton_no_vuelve",
        "metricas.ver_numeros.no_se_pulsa_dos_veces_aunque_se_repinte",
        "metricas.ver_numeros.un_fallo_de_verdad_se_puede_reintentar",
        "metricas.vistas.cambiar_de_vista_no_llama_y_numera_el_top",
        "metricas.tramo.ver_mas_manda_el_tramo_pegado_al_cursor",
        "metricas.tramo.ver_mas_se_apaga_en_el_ultimo_tramo_y_dice_el_tope",
        "metricas.tramo.la_misma_publicacion_en_dos_tramos_no_se_duplica",
        "metricas.fallos.un_fallo_blando_no_borra_lo_pintado_ni_el_cursor",
        "metricas.fallos.un_fallo_duro_tampoco_y_nunca_en_ingles",
        "metricas.fallos.sin_nada_pintado_dice_que_no_pudo",
        "metricas.fallos.solo_el_409_o_reconectar_ofrecen_conectar",
        "metricas.fallos.si_falla_una_llamada_la_otra_vista_conserva_lo_suyo",
        "metricas.tramo.las_mas_vistas_llevan_su_propio_tramo",
        "metricas.nota.el_recorte_no_es_un_error_y_lo_escribe_el_servidor",
        "metricas.tarjeta.fallida_dice_no_salio_con_el_error_de_la_red_como_texto",
        "metricas.tarjeta.el_enlace_solo_https_y_sin_regalar_la_pestana",
        "metricas.tarjeta.adjuntos_y_motivo_del_servidor",
        "metricas.carga.una_carga_a_la_vez",
        "metricas.cobro.no_cobra_ni_pinta_ambar",
        "metricas.marco.enlaces_estudio_y_version_anterior",
    ],
    "imagenes": [
        "imagenes.cobro.precio_de_tarifas_json_y_verbo_segun_el_modo",
        "imagenes.cobro.crear_manda_texto_estilo_y_formato",
        "imagenes.cobro.doble_clic_un_solo_envio",
        "imagenes.cobro.el_guardarrail_corta_antes_de_cobrar",
        "imagenes.cobro.con_el_guardarrail_caido_se_sigue",
        "imagenes.cobro.el_pedido_se_arma_antes_de_moderar",
        "imagenes.cobro.lo_que_se_dice_antes_no_se_cobra",
        "imagenes.cobro.el_pincel_sin_zona_no_cobra",
        "imagenes.cobro.el_pincel_manda_la_imagen_y_la_zona_sin_estilo",
        "imagenes.cobro.transformar_solo_manda_el_estilo_que_se_eligio",
        "imagenes.cobro.sin_saldo_dice_a_quien_escribir",
        "imagenes.cobro.saldo_conocido_que_no_alcanza_no_cobra",
        "imagenes.cobro.refresca_el_saldo_tras_cobrar",
        "imagenes.cobro.en_vuelo_nada_cambia_la_imagen_ni_el_modo",
        "imagenes.cobro.mientras_abre_una_imagen_no_se_envia",
        "imagenes.cobro.una_respuesta_sin_imagen_valida_no_se_pinta",
        "imagenes.cobro.un_solo_principal_por_vista",
        "imagenes.espera.revisando_y_luego_trabajando_y_nunca_junto_al_error",
        "imagenes.resultado.lo_creado_pasa_a_editarse",
        "imagenes.resultado.quitar_no_tira_el_resultado_pagado",
        "imagenes.resultado.seguir_editando_no_pinta_una_version_vieja",
        "imagenes.formato.con_imagen_lo_pone_ella_y_al_quitarla_vuelve_el_elegido",
        "imagenes.vista.pedir_editar_en_el_texto_abre_el_editor",
        "imagenes.paleta.atajos_sin_llm_y_el_comando_no_viaja",
        "imagenes.paleta.nuevo_nunca_sale_marcado_y_las_flechas_se_anuncian",
        "imagenes.enlace.solo_abre_una_imagen_con_nombre_valido",
        "imagenes.enlace.si_no_abre_avisa_fuera_del_formulario",
        "imagenes.enlace.el_texto_del_inicio_llega_recortado",
        "imagenes.enlace.editar_abre_el_editor",
        "imagenes.estilos.si_no_llegan_se_avisa_y_se_sigue",
        "imagenes.archivo.pegar_texto_gana_a_la_imagen",
        "imagenes.archivo.tipo_y_tamano_antes_de_abrir",
        "imagenes.teclado.ctrl_enter_envia",
        "imagenes.titulo.el_lector_oye_el_titulo_fijo",
        "imagenes.textos.del_servidor_como_texto",
        "imagenes.marco.enlaces_estudio_y_version_anterior",
    ],
    "mix": [
        "mix.carga.una_llamada_al_abrir_y_restaura_el_borrador",
        "mix.blotato.sin_clave_el_formulario_no_se_usa_y_lleva_a_conectar",
        "mix.cuentas.sin_clave_ofrece_conectar_y_otro_fallo_reintentar",
        "mix.cuentas.la_que_ya_no_esta_conectada_se_dice",
        "mix.foto.tipo_y_tamano_antes_de_subir",
        "mix.falta.dice_lo_primero_que_falta_y_no_llama",
        "mix.calendario.dos_clics_marcan_el_rango_y_el_tope_no_se_pulsa",
        "mix.ejemplo.se_pide_se_espera_y_luego_se_ve_el_costo",
        "mix.ejemplo.cambiar_lo_que_se_ve_lo_invalida_y_la_hora_no",
        "mix.ejemplo.si_el_intento_muere_lo_dice_sin_orbe",
        "mix.ejemplo.un_4xx_corta_la_espera_y_un_5xx_no",
        "mix.ejemplo.el_409_recarga_en_vez_de_dejar_un_callejon",
        "mix.ejemplo.al_volver_se_retoma_uno_a_medias_o_se_lee_el_que_murio",
        "mix.ejemplo.pedir_otro_retira_el_anterior_y_su_boton",
        "mix.ejemplo.si_la_campana_cambio_se_descarta_sin_error",
        "mix.cobro.encender_doble_clic_un_cobro_con_su_id",
        "mix.cobro.si_no_alcanza_no_se_enciende_y_dice_a_quien_escribir",
        "mix.cobro.un_402_dice_a_quien_escribir_y_un_409_recarga",
        "mix.cobro.el_saldo_apagado_no_promete_cobro",
        "mix.cobro.un_solo_principal_por_vista",
        "mix.viva.estado_proxima_y_cada_dia",
        "mix.viva.apagar_confirma_con_la_cifra_del_servidor",
        "mix.viva.sin_cifra_del_servidor_no_se_inventa_una",
        "mix.viva.pausada_dice_por_que_y_se_reanuda",
        "mix.viva.con_un_dia_en_marcha_mira_cada_minuto_solo_a_la_vista",
        "mix.viva.al_volver_a_la_pestana_recarga_la_encendida_y_no_el_borrador",
        "mix.ultima.dice_como_acabo_la_anterior",
        "mix.carga.fallo_avisa_con_reintentar",
        "mix.textos.del_servidor_como_texto",
        "mix.marco.enlaces_estudio_y_version_anterior",
    ],
    "crear": [
        "crear.formulario.estilos_radiogroup_muestra_y_personalizado",
        "crear.formulario.sin_estilos_dice_con_cual_sale",
        "crear.formulario.brief_y_modo_llegan_por_la_url",
        "crear.formulario.modo_segundo_clic_suelta",
        "crear.formulario.imagenes_hasta_cuatro_y_se_quitan",
        "crear.formulario.duracion_de_la_tabla_con_teclado_y_limites",
        "crear.cobro.generar_dice_lo_de_ahora_y_el_total_junto_a_la_duracion",
        "crear.cobro.generar_sin_saldo_para_el_guion_no_cobra",
        "crear.cobro.alcanza_para_el_guion_y_no_para_producir_se_dice",
        "crear.cobro.generar_doble_clic_una_pelicula",
        "crear.cobro.el_pedido_se_arma_antes_de_moderar_y_la_rejilla_queda_inerte",
        "crear.cobro.moderacion_rechaza_sin_llamar_y_explica",
        "crear.cobro.brief_vacio_no_llama",
        "crear.cobro.slots_409_avisa_y_balanceador_pregunta_y_fuerza",
        "crear.cobro.un_402_dice_a_quien_escribir",
        "crear.crear.manda_todos_los_campos_y_pone_p_en_la_url",
        "crear.progreso.pasos_y_barra_no_retroceden",
        "crear.progreso.falta_con_estimacion_y_sin_ella_nada",
        "crear.progreso.sin_estimacion_no_promete_minutos",
        "crear.progreso.sondea_hasta_terminal_y_duerme_oculta",
        "crear.progreso.sin_red_avisa_y_el_orbe_reposa",
        "crear.reanudar.p_en_la_url_abre_la_pelicula_y_si_falla_reintentar",
        "crear.revision.personaje_elegir_y_crear_opciones_gratis",
        "crear.revision.crear_opciones_si_falla_lo_dice",
        "crear.revision.cambiar_personaje_cobra_imagen_y_valida_antes",
        "crear.revision.voces_con_nivel_motivo_y_muestra",
        "crear.revision.sin_voces_queda_una",
        "crear.revision.escenas_editar_quitar_anadir_y_meta",
        "crear.revision.narracion_texto_corrido",
        "crear.revision.autoguardado_no_guarda_vacio_y_reintenta",
        "crear.revision.cerrar_con_cambios_sin_guardar_pregunta",
        "crear.revision.fuentes_solo_http_son_enlaces",
        "crear.cobro.producir_con_precio_del_servidor_y_guarda_antes",
        "crear.cobro.producir_sin_personaje_no_cobra",
        "crear.cobro.producir_si_no_alcanza_no_cobra_y_un_402_lo_dice",
        "crear.cobro.producir_manual_aprueba_imagenes",
        "crear.cobro.producir_sin_precio_no_cobra",
        "crear.cobro.producir_sin_monedero_dice_dolares_del_servidor",
        "crear.imagenes.cambiar_una_cobra_y_refresca_la_imagen",
        "crear.imagenes.un_402_al_cambiar_dice_a_quien_escribir",
        "crear.imagenes.animar_no_cobra",
        "crear.imagenes.mejor_no_confirma_y_dice_lo_devuelto",
        "crear.resultado.video_descargar_editor_y_drive_http",
        "crear.resultado.sin_editor_lo_explica_y_sin_http_no_hay_drive",
        "crear.resultado.rehacer_vuelve_a_revision_gratis",
        "crear.error.al_producir_reintentar_con_precio_y_devolucion",
        "crear.error.al_producir_sin_cobrado_usa_la_tabla",
        "crear.error.narracion_con_personaje_es_de_producir",
        "crear.error.al_preparar_empezar_de_nuevo_con_la_idea",
        "crear.error.sin_monedero_no_habla_de_creditos",
        "crear.textos.del_servidor_como_texto",
        "crear.marco.enlaces_estudio_y_version_anterior",
        "crear.cobro.un_solo_principal_por_vista",
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
