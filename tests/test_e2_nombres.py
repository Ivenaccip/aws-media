"""E2 · Ajustes 2 — nombres de proyecto y títulos que la persona reconoce.

- INT-03  la hoja ofrecía proyectos con nombre acentuado (o de más de 64 caracteres) y luego `cotizar` e
          `iniciar` los rechazaban con «No entendimos uno de los videos»: la regla de `ref` era
          `[A-Za-z0-9_-]{1,64}` y la del producto (`storage.ruta_proyecto`, `media_api._validar_nombre`,
          `/estudio/subir/`) es `str.isalnum()`, que acepta letras Unicode y no pone tope. Ahora hay UNA
          sola regla y todo lo que `elegibles` entrega lo acepta `_refs_de`;
- INT-05  el título de una copia hecha con subidas salía del nombre de archivo SANEADO por
          `/api/media/presign` («Mi_Entrevista_1»), no del que la persona subió («Mi Entrevista (1)»).
"""
import pytest

from pipeline.storage import ruta_proyecto
from server import edicion_api
from test_e2_mundo import cliente, mundo, tarifa  # noqa: F401

NOMBRES_VALIDOS = ["presentación-final", "reunión_2026", "año-nuevo", "a" * 70, "a" * 255, "video-1", "ÑandÚ",
                   "东京", "v_1-2"]
NOMBRES_MALOS = ["", "../x", "a/b", "a\\b", "a b", "a.b", "a" * 256, "x;y", "x\x00y", "x\ny", "..", "-/-"]


def cotizar(cliente, *refs):
    return cliente.post("/api/edicion/cotizar", json={"videos": list(refs)})


# ---------------------------------------------------------------------------
# INT-03 · una sola regla de nombre de proyecto

@pytest.mark.parametrize("nombre", NOMBRES_VALIDOS)
def test_la_regla_de_ref_acepta_lo_que_el_producto_deja_crear(nombre):
    ruta_proyecto(nombre)                                           # el producto lo acepta...
    assert edicion_api._refs_de({"videos": [f"proyecto:{nombre}"]}) == [f"proyecto:{nombre}"]      # ...y la ref también


@pytest.mark.parametrize("nombre", NOMBRES_MALOS)
def test_y_sigue_rechazando_lo_que_no_es_un_nombre(nombre):
    with pytest.raises(Exception) as e:
        edicion_api._refs_de({"videos": [f"proyecto:{nombre}"]})
    assert getattr(e.value, "status_code", None) == 422
    assert e.value.detail == "No entendimos uno de los videos. Recarga la lista e inténtalo de nuevo."


def test_las_demas_refs_siguen_igual():
    for ref in ("proyecto", "proyecto:", "Proyecto:x", "clip:", "clip:abc", "videos/x/subidas/a.mp4", "x", 5, None):
        with pytest.raises(Exception) as e:
            edicion_api._refs_de({"videos": [ref]})
        assert e.value.status_code == 422, ref
    ok = "clip:clip-20261008-101500-ab12cd"
    assert edicion_api._refs_de({"videos": [ok]}) == [ok]


@pytest.mark.parametrize("nombre", ["presentación-final", "a" * 70])
def test_un_proyecto_acentuado_o_largo_se_lista_se_cotiza_y_se_inicia(cliente, mundo, nombre):
    mundo.subida(nombre, dur=120.0, canonico=True)
    ref = next(v["ref"] for v in cliente.get("/api/edicion/elegibles").json()["videos"]
               if v["ref"] == f"proyecto:{nombre}")
    cot = cotizar(cliente, ref)
    assert cot.status_code == 200 and cot.json()["bloqueo"] is None and cot.json()["creditos"] == tarifa("edicion")
    ini = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(ref))
    assert ini.status_code == 200, ini.text
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"][0]["origen_key"] == f"videos/{nombre}/subidas/{nombre}.mp4"


def test_todo_lo_que_la_hoja_ofrece_lo_acepta_cotizar(cliente, mundo):
    """El guardián del desacuerdo: cada `ref` de `elegibles` (sin motivo) debe pasar `_refs_de`."""
    for n in NOMBRES_VALIDOS:
        mundo.subida(n, dur=100.0)
    mundo.pelicula("1a2b3c4d", "El tren de papel")
    videos = cliente.get("/api/edicion/elegibles").json()["videos"]
    assert len(videos) >= len(NOMBRES_VALIDOS)
    for v in videos:
        assert edicion_api._refs_de({"videos": [v["ref"]]}) == [v["ref"]], v["ref"]


def test_un_nombre_que_no_pasa_la_regla_no_se_ofrece(cliente, mundo):
    """Si por un dato viejo hay un proyecto cuyo nombre no es válido, no se lista apagado ni encendido."""
    mundo.subida("bueno", dur=100.0)
    mundo.subida("con espacio", dur=100.0)
    refs = [v["ref"] for v in cliente.get("/api/edicion/elegibles").json()["videos"]]
    assert "proyecto:bueno" in refs and "proyecto:con espacio" not in refs


@pytest.mark.xfail(strict=False, raises=RuntimeError,
                   reason="PENDIENTE S2: worker/editar_copia._verificar_duenos solo acepta [A-Za-z0-9_-]+ en el "
                          "nombre del proyecto de origen; con un nombre acentuado la corrida falla DESPUÉS de cobrar "
                          "(y se devuelve). Debe aceptar lo mismo que la API.")
def test_el_worker_acepta_los_mismos_nombres_que_la_api(monkeypatch):
    from pipeline import db
    from worker import editar_copia
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {"subidas": []})
    for nombre in ("presentación-final", "a" * 70):
        editar_copia._verificar_duenos("u1", "ed-9f1c0a7b", [
            {"origen_key": f"videos/{nombre}/subidas/a.mp4", "canonico_key": None, "wav_key": None}])


# ---------------------------------------------------------------------------
# INT-05 · el título es el nombre que la persona subió

def sub(mundo, nombre, archivo, original=None, **kw):
    key = mundo.subida(nombre, archivo=archivo, **kw)
    if original:
        mundo.docs()[nombre]["subidas"][0]["nombre_original"] = original
    return key


def test_el_titulo_usa_el_nombre_original_que_guardo_confirmar(cliente, mundo):
    sub(mundo, "mi-entrevista-1", "Mi_Entrevista_1.mp4", original="Mi Entrevista (1).mp4", dur=120.0, canonico=True)
    sub(mundo, "charla-corta", "charla_corta.mov", original="charla corta.mov", dur=90.0, canonico=True)
    r = cotizar(cliente, "proyecto:mi-entrevista-1", "proyecto:charla-corta").json()
    assert r["titulo"] == "Mi Entrevista (1) + 1 más"
    assert [v["titulo"] for v in r["videos"]] == ["Mi Entrevista (1)", "charla corta"]
    lista = {v["ref"]: v["titulo"] for v in cliente.get("/api/edicion/elegibles").json()["videos"]}
    assert lista["proyecto:mi-entrevista-1"] == "Mi Entrevista (1)"
    ini = cliente.post("/api/edicion/iniciar", json=mundo.cuerpo("proyecto:mi-entrevista-1", "proyecto:charla-corta"))
    doc = mundo.docs()["ed-9f1c0a7b"]
    assert ini.json()["titulo"] == doc["titulo"] == "Mi Entrevista (1) + 1 más"
    assert [d["titulo"] for d in doc["copia"]["de"]] == ["Mi Entrevista (1)", "charla corta"]


def test_sin_nombre_original_los_guiones_bajos_del_saneado_vuelven_a_ser_espacios(cliente, mundo):
    """Lo ya subido antes de guardar el nombre original: `Mi_Entrevista_1` → «Mi Entrevista 1»."""
    sub(mundo, "mi-entrevista-1", "Mi_Entrevista_1.mp4", dur=120.0, canonico=True)
    assert cotizar(cliente, "proyecto:mi-entrevista-1").json()["titulo"] == "Mi Entrevista 1"


def test_un_archivo_sin_guiones_bajos_no_cambia(cliente, mundo):
    sub(mundo, "charla", "entrevista-final.mp4", dur=120.0, canonico=True)
    assert cotizar(cliente, "proyecto:charla").json()["titulo"] == "entrevista-final"


def test_el_titulo_de_youtube_manda_sobre_todo(cliente, mundo):
    sub(mundo, "yt-abc", "video_raro.mp4", original="otro nombre.mp4", dur=120.0, canonico=True, titulo_yt="Cómo hacer pan")
    assert cotizar(cliente, "proyecto:yt-abc").json()["titulo"] == "Cómo hacer pan"


def test_el_nombre_original_de_otra_subida_no_se_confunde(cliente, mundo):
    """Hay dos subidas en el proyecto: el título sale de la que se edita (la más reciente), no de la otra."""
    key = sub(mundo, "p", "nuevo_2.mp4", original="Nuevo 2.mp4", dur=120.0, canonico=True)
    mundo.docs()["p"]["subidas"].insert(0, {"key": "videos/p/subidas/viejo.mp4", "archivo": "viejo.mp4",
                                            "bytes": 1, "nombre_original": "Viejo.mp4"})
    assert cotizar(cliente, "proyecto:p").json()["titulo"] == "Nuevo 2"
