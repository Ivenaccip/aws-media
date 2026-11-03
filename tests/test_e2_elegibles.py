"""E2 — `GET /api/edicion/elegibles`: lo que la hoja «Agregar videos» puede mostrar.

Películas, cuentos, clips y ediciones de la persona, con duración y formato
medidos por el servidor. Solo lectura: lo único que escribe es la caché de la
medición. Una fuente que falla no rompe la lista.
"""
import pytest

from server import edicion_api, shorts_api
from test_e2_mundo import cliente, mundo  # noqa: F401  (las fixtures se importan por nombre)

CLIP = "clip-20261008-101500-ab12cd"
CLIP_2 = "clip-20261009-090000-ffeedd"


def lista(cliente):
    r = cliente.get("/api/edicion/elegibles")
    assert r.status_code == 200, r.text
    return r.json()


def por_ref(j, ref):
    return next(v for v in j["videos"] if v["ref"] == ref)


# ---------------------------------------------------------------------------
# la forma

def test_la_forma_exacta_de_una_pelicula_un_clip_y_una_copia(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "El tren de papel", dur=30.04, creado="2026-10-02T15:04:05+00:00")
    mundo.clip(CLIP, "Perro en la playa", segundos=8, dur=7.96)
    mundo.copia("ed-9f1c0a7b", "El tren de papel", estado="listo")
    j = lista(cliente)
    assert j["limites"] == {"max_s": 5400, "min_solo_s": 60, "max_videos": 12, "max_bytes": 16106127360}
    assert por_ref(j, "proyecto:gen-1a2b3c4d") == {
        "ref": "proyecto:gen-1a2b3c4d", "tipo": "pelicula", "titulo": "El tren de papel",
        "duracion_s": 30.04, "formato": "horizontal", "fecha": "2026-10-02T15:04:05+00:00",
        "miniatura": "/api/proyectos/1a2b3c4d/archivo/portada.jpg", "video": None,
        "con_transcript": True, "audio": True, "bytes": 11_534_336,
        "es_copia": False, "copia_de": [], "motivo": None}
    assert por_ref(j, f"clip:{CLIP}") == {
        "ref": f"clip:{CLIP}", "tipo": "clip", "titulo": "Perro en la playa",
        "duracion_s": 8.0, "formato": "horizontal", "fecha": "2026-10-08T10:15:00+00:00",
        "miniatura": None, "video": f"/api/clip/{CLIP}/video",
        "con_transcript": False, "audio": True, "bytes": 3_145_728,
        "es_copia": False, "copia_de": [], "motivo": None}
    assert por_ref(j, "proyecto:ed-9f1c0a7b") == {
        "ref": "proyecto:ed-9f1c0a7b", "tipo": "edicion", "titulo": "El tren de papel",
        "duracion_s": None, "formato": None, "fecha": "2026-10-13T20:11:00+00:00",
        "miniatura": None, "video": None, "con_transcript": True, "audio": None, "bytes": None,
        "es_copia": True,
        "copia_de": [{"ref": "proyecto:gen-1a2b3c4d", "titulo": "El tren de papel"}],
        "motivo": "es_copia"}


def test_los_limites_son_las_constantes_del_servidor(cliente, mundo):
    assert lista(cliente)["limites"] == {
        "max_s": edicion_api.MAX_S == shorts_api.MAX_DURACION_S and shorts_api.MAX_DURACION_S,
        "min_solo_s": shorts_api.MIN_DURACION_S, "max_videos": edicion_api.MAX_VIDEOS,
        "max_bytes": edicion_api.MAX_BYTES_TOTAL}


def test_sin_nada_la_lista_va_vacia(cliente, mundo):
    assert lista(cliente)["videos"] == []


def test_la_lista_ordena_por_fecha_y_lo_que_no_tiene_fecha_va_al_final(cliente, mundo):
    mundo.subida("vieja", dur=300.0, creado="2026-09-01T10:00:00+00:00")
    mundo.subida("nueva", dur=300.0, creado="2026-10-14T10:00:00+00:00")
    mundo.subida("sin_fecha", dur=300.0)
    mundo.creados[("u1", "sin_fecha")] = None
    mundo.clip(CLIP)                                         # 8-oct
    j = lista(cliente)
    assert [v["ref"] for v in j["videos"]] == [
        "proyecto:nueva", f"clip:{CLIP}", "proyecto:vieja", "proyecto:sin_fecha"]


# ---------------------------------------------------------------------------
# películas y cuentos

def test_un_cuento_es_una_pelicula_de_modo_investigacion(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Una película", modo="auto")
    mundo.pelicula("2b3c4d5e", "Un cuento", modo="investigacion")
    mundo.pelicula("3c4d5e6f", "Otra idea", modo="idea")
    j = lista(cliente)
    assert {v["titulo"]: v["tipo"] for v in j["videos"]} == {
        "Una película": "pelicula", "Un cuento": "cuento", "Otra idea": "pelicula"}


def test_el_proyecto_gen_no_sale_dos_veces(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "El tren de papel")
    j = lista(cliente)
    assert [v["ref"] for v in j["videos"]] == ["proyecto:gen-1a2b3c4d"]


def test_la_pelicula_se_une_a_su_proyecto_por_origen_generador_si_el_puente_no_guardo_el_nombre(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Sin progreso.editor", editor_en_progreso=False)
    assert [v["ref"] for v in lista(cliente)["videos"]] == ["proyecto:gen-1a2b3c4d"]


def test_una_pelicula_sin_proyecto_del_editor_no_se_lista(cliente, mundo):
    """El puente falló (D-09): la película existe en Mis creaciones pero no es editable."""
    mundo.pelicula("1a2b3c4d", "Sin puente", con_editor=False)
    assert lista(cliente)["videos"] == []


@pytest.mark.parametrize("estado,archivado", [("produciendo", False), ("revision", False),
                                              ("error", False), ("listo", True)])
def test_solo_las_peliculas_listas_y_no_archivadas(cliente, mundo, estado, archivado):
    mundo.pelicula("1a2b3c4d", "No va", estado=estado, archivado=archivado)
    assert lista(cliente)["videos"] == []


def test_el_titulo_de_una_pelicula_se_recorta_en_una_palabra(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Un faro que guía a los barcos perdidos en la tormenta eterna de un invierno "
                               "que nunca termina para nadie")
    t = lista(cliente)["videos"][0]["titulo"]
    assert t.endswith("…") and len(t) <= 81 and " " not in t[-2:]
    assert not t[:-1].endswith(" ") and t[:-1] in "Un faro que guía a los barcos perdidos en la tormenta " \
        "eterna de un invierno que nunca termina para nadie"


def test_la_pelicula_sin_transcript_no_dice_que_lo_tiene(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Sin canónico", transcript=False)
    assert lista(cliente)["videos"][0]["con_transcript"] is False


def test_una_pelicula_vertical_se_ve_vertical(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Para reels", ancho=720, alto=1280)
    assert lista(cliente)["videos"][0]["formato"] == "vertical"


# ---------------------------------------------------------------------------
# clips

def test_un_clip_generando_o_sin_video_no_sale(cliente, mundo):
    mundo.clip(CLIP, estado="generando", con_key=False)
    mundo.clip(CLIP_2, estado="listo", con_key=False)
    mundo.clip("clip-20261010-120000-000001", estado="error")
    assert lista(cliente)["videos"] == []


def test_un_clip_dice_la_duracion_nominal_y_el_formato_de_su_doc(cliente, mundo):
    mundo.clip(CLIP, segundos=4, dur=3.88, formato="vertical", ancho=720, alto=1280, audio=False)
    v = lista(cliente)["videos"][0]
    assert (v["duracion_s"], v["formato"], v["audio"]) == (4.0, "vertical", False)
    assert mundo.mediciones_hechas == []             # la lista no mide clips: la autoridad es cotizar


def test_los_clips_de_otra_persona_no_salen(cliente, mundo):
    mundo.clip(CLIP, user="u2")
    assert lista(cliente)["videos"] == []


# ---------------------------------------------------------------------------
# ediciones (subidas de la computadora y traídos de YouTube) y copias

def test_una_subida_sale_como_edicion_con_el_nombre_de_su_archivo(cliente, mundo):
    mundo.subida("entrevista-final", archivo="entrevista-final.mp4", dur=724.0, ancho=1920, alto=1080)
    v = lista(cliente)["videos"][0]
    assert v["tipo"] == "edicion" and v["titulo"] == "entrevista-final"
    assert (v["duracion_s"], v["formato"], v["audio"], v["bytes"]) == (724.0, "horizontal", True, 864_000_000)
    assert v["motivo"] is None and v["miniatura"] is None


def test_un_video_traido_de_youtube_usa_el_titulo_del_video(cliente, mundo):
    mundo.subida("yt-abc", dur=300.0, titulo_yt="Cómo hacer pan en casa")
    assert lista(cliente)["videos"][0]["titulo"] == "Cómo hacer pan en casa"


def test_un_proyecto_sin_video_no_sale(cliente, mundo):
    mundo.docs()["vacio"] = {"subidas": []}
    assert lista(cliente)["videos"] == []


def test_las_copias_salen_apagadas_con_su_titulo_y_sus_originales(cliente, mundo):
    mundo.copia("ed-1", "Una copia", de=[
        {"orden": 1, "ref": "proyecto:a", "tipo": "edicion", "titulo": "Primero", "clip_id": "c01"},
        {"orden": 2, "ref": f"clip:{CLIP}", "tipo": "clip", "titulo": "Segundo", "clip_id": "c02"}])
    v = lista(cliente)["videos"][0]
    assert (v["es_copia"], v["motivo"], v["titulo"], v["tipo"]) == (True, "es_copia", "Una copia", "edicion")
    assert v["copia_de"] == [{"ref": "proyecto:a", "titulo": "Primero"},
                             {"ref": f"clip:{CLIP}", "titulo": "Segundo"}]
    assert v["duracion_s"] is None and mundo.mediciones_hechas == []     # una copia no se mide


def test_el_proyecto_que_se_esta_editando_ahora_sale_en_curso(cliente, mundo):
    mundo.subida("a", dur=300.0)
    mundo.docs()["a"]["editar"] = {"estado": "corriendo", "inicio": "2999-01-01T00:00:00+00:00"}
    assert lista(cliente)["videos"][0]["motivo"] == "en_curso"
    mundo.docs()["a"]["editar"] = {"estado": "corriendo", "inicio": "2026-01-01T00:00:00+00:00"}   # colgada
    assert lista(cliente)["videos"][0]["motivo"] is None
    mundo.docs()["a"]["editar"] = {"estado": "listo", "inicio": "2999-01-01T00:00:00+00:00"}
    assert lista(cliente)["videos"][0]["motivo"] is None


def test_una_pelicula_cuyo_proyecto_perdio_el_video_sale_sin_metraje(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "Sin archivo")
    mundo.docs()["gen-1a2b3c4d"]["subidas"] = []
    mundo.docs()["gen-1a2b3c4d"]["flags"]["generado"] = False
    v = lista(cliente)["videos"][0]
    assert v["motivo"] == "sin_metraje" and v["duracion_s"] is None


def test_los_proyectos_de_otra_persona_no_salen(cliente, mundo):
    mundo.subida("ajeno", dur=300.0, user="u2")
    assert lista(cliente)["videos"] == []


# ---------------------------------------------------------------------------
# medir: caché, plazo y fallos

def test_si_no_se_pudo_medir_sale_midiendo_con_todo_en_null(cliente, mundo):
    mundo.subida("a", dur=300.0)
    mundo.medidas["videos/a/subidas/a.mp4"] = None
    v = lista(cliente)["videos"][0]
    assert v["motivo"] == "midiendo"
    assert (v["duracion_s"], v["formato"], v["audio"], v["bytes"]) == (None, None, None, None)


def test_la_cache_evita_volver_a_medir_y_un_cambio_de_peso_la_invalida(cliente, mundo):
    mundo.subida("a", dur=300.0)
    lista(cliente)
    assert mundo.mediciones_hechas == ["videos/a/subidas/a.mp4"]
    assert mundo.docs()["a"]["meta"]["bytes"] == 864_000_000
    mundo.mediciones_hechas.clear()
    assert lista(cliente)["videos"][0]["duracion_s"] == 300.0 and mundo.mediciones_hechas == []
    # la subida se reemplazó por un archivo de otro peso: la medición vieja ya no vale
    mundo.docs()["a"]["subidas"][0]["bytes"] = 1234
    mundo.medidas["videos/a/subidas/a.mp4"] = {"duracion_s": 45.0, "ancho": 720, "alto": 1280, "audio": False}
    v = lista(cliente)["videos"][0]
    assert (v["duracion_s"], v["formato"], v["audio"]) == (45.0, "vertical", False)
    assert mundo.mediciones_hechas == ["videos/a/subidas/a.mp4"]


def test_la_lista_no_busca_transcripts_en_s3(cliente, mundo, monkeypatch):
    """`con_transcript` es la marca barata (`flags.canonico`); el precio exacto lo da cotizar."""
    from pipeline import media_sync
    mundo.subida("a", dur=300.0, canonico=True)
    mundo.subida("b", dur=300.0)
    llamadas = []
    monkeypatch.setattr(media_sync, "listar_prefijo", lambda p: llamadas.append(p) or [])
    monkeypatch.setattr(media_sync, "leer_texto", lambda k: llamadas.append(k))
    j = lista(cliente)
    assert [k for k in llamadas if k.startswith("videos/")] == []       # los clips sí listan lo suyo
    assert {v["ref"]: v["con_transcript"] for v in j["videos"]} == {
        "proyecto:a": True, "proyecto:b": False}


def test_el_plazo_de_medicion_no_deja_colgada_la_lista(cliente, mundo, monkeypatch):
    import time
    mundo.subida("rapida", dur=300.0, creado="2026-10-11T00:00:00+00:00")
    mundo.subida("lenta", dur=300.0, creado="2026-10-10T00:00:00+00:00")
    original = mundo._medir

    def lenta(key, *, timeout=8):
        if "lenta" in key:
            time.sleep(3)
        return original(key)
    monkeypatch.setattr(edicion_api, "_medir", lenta)
    monkeypatch.setattr(edicion_api, "MEDIR_PLAZO_S", 0.3)
    t0 = time.monotonic()
    j = lista(cliente)
    assert time.monotonic() - t0 < 2.5
    assert por_ref(j, "proyecto:rapida")["duracion_s"] == 300.0
    assert por_ref(j, "proyecto:lenta")["motivo"] == "midiendo"


def test_una_fuente_que_falla_no_rompe_la_lista(cliente, mundo, monkeypatch):
    mundo.subida("a", dur=300.0)
    mundo.clip(CLIP)

    def truena():
        raise RuntimeError("Aurora se cayó")
    monkeypatch.setattr(edicion_api, "listar_proyectos", truena)
    j = lista(cliente)
    assert {v["ref"] for v in j["videos"]} == {"proyecto:a", f"clip:{CLIP}"}


def test_un_clip_con_doc_corrupto_se_omite(cliente, mundo):
    mundo.clip(CLIP)
    mundo.s3["usuarios/u1/clips/clip-20261011-000000-badbad.json"] = "{esto no es json"
    assert [v["ref"] for v in lista(cliente)["videos"]] == [f"clip:{CLIP}"]


def test_la_lista_no_cobra_ni_reserva_ni_lanza(cliente, mundo):
    mundo.subida("a", dur=300.0)
    mundo.pelicula("1a2b3c4d", "Peli")
    mundo.clip(CLIP)
    lista(cliente)
    assert {e[0] for e in mundo.eventos} <= {"medir", "fijar"}
    assert all(e[2] == "meta" for e in mundo.eventos if e[0] == "fijar")
    assert mundo.libro == []


def test_en_local_es_503(cliente, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    r = cliente.get("/api/edicion/elegibles")
    assert r.status_code == 503 and r.json()["detail"].startswith("El flujo web de edición corre en el servicio")


# ---------------------------------------------------------------------------
# GET /api/edicion/proyectos: los campos nuevos que necesita la tarjeta de «Mis creaciones»

@pytest.fixture
def proyectos(cliente, mundo, tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))          # ningún videos/ del disco se cuela

    def pedir():
        return {p["nombre"]: p for p in cliente.get("/api/edicion/proyectos").json()}
    return pedir


def test_las_filas_de_siempre_conservan_sus_campos_y_suman_los_nuevos(mundo, proyectos):
    mundo.subida("charla", dur=300.0, canonico=True)
    f = proyectos()["charla"]
    for campo in ("nombre", "generado", "canonico", "cuts", "editor_listo", "editar", "subidas", "creado", "shorts"):
        assert campo in f
    assert f["canonico"] is True and f["subidas"][0]["key"] == "videos/charla/subidas/charla.mp4"
    assert (f["titulo"], f["copia_de"], f["n_videos"], f["duracion_s"], f["formato"]) == (None, [], None, None, None)


def test_una_copia_trae_su_titulo_y_los_originales(mundo, proyectos):
    mundo.copia("ed-9f1c0a7b", "El tren de papel + 2 más", estado="corriendo", de=[
        {"orden": 1, "ref": "proyecto:gen-1", "tipo": "pelicula", "titulo": "El tren de papel", "clip_id": "c01"},
        {"orden": 2, "ref": f"clip:{CLIP}", "tipo": "clip", "titulo": "Perro", "clip_id": "c02"},
        {"orden": 3, "ref": "proyecto:e", "tipo": "edicion", "titulo": "entrevista", "clip_id": "c03"}])
    f = proyectos()["ed-9f1c0a7b"]
    assert f["titulo"] == "El tren de papel + 2 más" and f["n_videos"] == 3
    assert f["copia_de"] == [{"ref": "proyecto:gen-1", "titulo": "El tren de papel"},
                             {"ref": f"clip:{CLIP}", "titulo": "Perro"}, {"ref": "proyecto:e", "titulo": "entrevista"}]
    assert f["editar"]["estado"] == "corriendo"                 # la tarjeta dice «Editando…» con esto


def test_la_duracion_y_el_formato_salen_de_la_medicion_guardada(mundo, proyectos):
    mundo.subida("a", dur=300.0, ancho=720, alto=1280)
    # la medición se guarda al cotizar o al listar; aquí se escribe a mano como la deja `_guardar_meta`
    mundo.docs()["a"]["meta"] = {"key": "k", "bytes": 1, "duracion_s": 300.0, "ancho": 720, "alto": 1280, "audio": True}
    f = proyectos()["a"]
    assert (f["duracion_s"], f["formato"]) == (300.0, "vertical")
    mundo.docs()["a"]["meta"]["formato"] = "horizontal"          # si la medición ya trae el formato, manda
    assert proyectos()["a"]["formato"] == "horizontal"


def test_una_meta_rota_no_rompe_la_lista(mundo, proyectos):
    mundo.subida("a", dur=300.0)
    mundo.docs()["a"]["meta"] = "basura"
    f = proyectos()["a"]
    assert f["duracion_s"] is None and f["formato"] is None
    mundo.docs()["a"]["meta"] = {"ancho": "x", "alto": None}
    assert proyectos()["a"]["formato"] is None
