"""M23 C3 — lo que la Agenda necesita del registro: el estado 'cancelado' y el
índice media_url → (proyecto, publicación) que escribe el worker.

Las piezas comunes (S3 falso, Blotato simulado, el video en memoria) se reusan
tal cual de test_m23_publicar_nube: son las mismas de C2 y tener dos copias
dejaría dos verdades. pytest ya pone tests/ en sys.path, así que el import es
directo. Sin red: los cuatro fixtures autouse de conftest lo garantizan.
"""
import hashlib
import json
import time

import pytest

from pipeline import blotato, publicaciones
from worker import publicar_task

from test_m23_publicar_nube import (  # noqa: F401 — fixtures de C2, reusadas
    USER, _cuando, _estado, _http, _pendiente, _video, en_s3, s3, worker)

MEDIA = "https://database.blotato.com/v.mp4"          # la que devuelve el doble
CANDADO = "pelicula|98432|tiktok"


def _sha(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _key(user: str, url: str) -> str:
    return f"usuarios/{user}/agenda/{_sha(url)}.json"


# ---------------------------------------------------------------------------
# el enlace, en las dos ramas

def test_el_enlace_va_y_vuelve_en_la_nube(en_s3):
    publicaciones.enlazar(USER, "gen-abc", "a" * 12, MEDIA)
    assert list(en_s3.objetos) == [_key(USER, MEDIA)]        # el usuario va en la ruta
    assert json.loads(en_s3.objetos[_key(USER, MEDIA)][0]) == {
        "proyecto": "gen-abc", "id": "a" * 12}
    assert publicaciones.enlace(USER, MEDIA) == ("gen-abc", "a" * 12)
    assert publicaciones.enlace(USER, MEDIA + "?otra") is None     # otro video, otro sha
    assert publicaciones.enlace("otro", MEDIA) is None             # otro usuario, otra ruta


def test_el_enlace_va_y_vuelve_en_local(monkeypatch, tmp_path):
    from pipeline import storage
    monkeypatch.setenv("STATE_BACKEND", "json")
    monkeypatch.setattr(storage, "videos_root", lambda: tmp_path)
    monkeypatch.setattr(publicaciones, "videos_root", lambda: tmp_path)
    (tmp_path / "v1").mkdir()
    publicaciones.enlazar(USER, "v1", "b" * 12, MEDIA)
    archivo = tmp_path / "_agenda" / f"{_sha(MEDIA)}.json"
    assert archivo.is_file()                     # fuera de los proyectos: no tiene dueño
    assert json.loads(archivo.read_text(encoding="utf-8")) == {"proyecto": "v1",
                                                               "id": "b" * 12}
    assert publicaciones.enlace(USER, MEDIA) == ("v1", "b" * 12)
    assert publicaciones.enlace(USER, "https://otra/v.mp4") is None


def test_el_enlace_lo_escribe_la_ultima_publicacion(en_s3):
    """Escritura ciega: la que se acaba de crear es la que el usuario mira."""
    publicaciones.enlazar(USER, "gen-abc", "a" * 12, MEDIA)
    publicaciones.enlazar(USER, "gen-def", "b" * 12, MEDIA)
    assert publicaciones.enlace(USER, MEDIA) == ("gen-def", "b" * 12)


@pytest.mark.parametrize("datos", [
    {"proyecto": "gen-abc", "id": "../../x"},
    {"proyecto": "gen-abc", "id": "A" * 12},            # el id es hex en minúsculas
    {"proyecto": "gen-abc", "id": ""},
    {"proyecto": "gen-abc"},
    {"proyecto": "", "id": "a" * 12},
    {"proyecto": 7, "id": "a" * 12},
    {"id": "a" * 12},
    {},
])
def test_un_enlace_roto_no_devuelve_par(en_s3, datos):
    en_s3.put_object(Bucket="bucket", Key=_key(USER, MEDIA),
                     Body=json.dumps(datos).encode("utf-8"))
    assert publicaciones.enlace(USER, MEDIA) is None


@pytest.mark.parametrize("user,proyecto,pub_id,media", [
    ("../otro", "gen-abc", "a" * 12, MEDIA),
    ("", "gen-abc", "a" * 12, MEDIA),
    (USER, "../x", "a" * 12, MEDIA),
    (USER, "gen-abc", "../../x", MEDIA),
    (USER, "gen-abc", "a" * 12, ""),
    (USER, "gen-abc", "a" * 12, None),
])
def test_nada_raro_llega_a_la_ruta_del_enlace(en_s3, user, proyecto, pub_id, media):
    with pytest.raises(ValueError):
        publicaciones.enlazar(user, proyecto, pub_id, media)
    assert en_s3.objetos == {}


def test_leer_un_enlace_tambien_valida_al_usuario(en_s3):
    for user in ("../otro", "", "u/1"):
        with pytest.raises(ValueError):
            publicaciones.enlace(user, MEDIA)


# ---------------------------------------------------------------------------
# el estado 'cancelado'

def test_una_cancelada_no_va_en_camino_ni_se_le_pregunta_a_blotato():
    """Cancelar apaga las dos cosas que costarían dinero o confusión: la fila
    «en camino» de la pantalla y las consultas contra el límite de 60/min."""
    t = time.time()
    reg = {"id": "a" * 12, "estado": "programado", "post_id": "post-1",
           "creado": t - 7200, "actualizado": t - 60, "cuando": _cuando(-3600),
           "error": "lo que dijera antes"}
    assert publicaciones.vista(reg, t)["en_curso"] is True          # antes de cancelar
    assert publicaciones.por_consultar(reg, t) is True

    reg["estado"] = "cancelado"
    v = publicaciones.vista(reg, t)
    assert (v["estado"], v["en_curso"], v["revisar"]) == ("cancelado", False, False)
    assert v["mensaje"] == publicaciones.MENSAJES["cancelado"]
    assert publicaciones.por_consultar(reg, t) is False
    assert "cancelado" not in publicaciones.OCULTOS          # la fila se sigue viendo
    assert "cancelado" not in publicaciones.TRABAJANDO
    assert "cancelado" not in publicaciones.EN_CURSO


def test_cancelar_libera_el_candado_y_deja_volver_a_programar(en_s3):
    uno = publicaciones.crear(USER, "gen-abc", {}, candado=CANDADO)
    assert publicaciones.ocupado(USER, "gen-abc", CANDADO) is True
    with pytest.raises(publicaciones.EnCurso):
        publicaciones.crear(USER, "gen-abc", {}, candado=CANDADO)

    reg, etag = publicaciones.leer(USER, "gen-abc", uno["id"])
    publicaciones.guardar(USER, "gen-abc", dict(reg, estado="cancelado"), etag)
    assert publicaciones.ocupado(USER, "gen-abc", CANDADO) is False
    otra = publicaciones.crear(USER, "gen-abc", {}, candado=CANDADO)
    assert otra["id"] != uno["id"]
    assert publicaciones.en_camino(USER) == 1              # la cancelada ya no ocupa worker
    ids = [r["id"] for r, _ in publicaciones.listar(USER, "gen-abc")]
    assert sorted(ids) == sorted([uno["id"], otra["id"]])


# ---------------------------------------------------------------------------
# el worker deja el enlace escrito

def test_el_worker_guarda_la_media_url_y_el_enlace(worker):
    reg = _pendiente(cuando=_cuando(3600))
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    final = _estado(reg["id"])
    assert (final["estado"], final["post_id"]) == ("programado", "post-1")
    assert final["media_url"] == MEDIA
    assert publicaciones.enlace(USER, final["media_url"]) == ("gen-abc", reg["id"])


def test_si_no_se_creo_el_post_no_hay_enlace(worker, monkeypatch):
    reg = _pendiente(cuando=_cuando(3600))

    def falla(*a, **k):
        raise _http(500)

    monkeypatch.setattr(blotato, "publicar", falla)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    final = _estado(reg["id"])
    assert final["estado"] == "incierto" and "media_url" not in final
    assert publicaciones.enlace(USER, MEDIA) is None


def test_si_el_enlace_falla_la_publicacion_queda_igual_y_nadie_relanza(worker, monkeypatch,
                                                                      caplog):
    """Un S3 caído al escribir el índice no puede relanzar: la cola reintentaría
    el trabajo y el post saldría dos veces."""
    reg = _pendiente(cuando=_cuando(3600))

    def roto(*a, **k):
        raise RuntimeError("S3 caído")

    monkeypatch.setattr(publicaciones, "enlazar", roto)
    caplog.set_level("WARNING")
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video, relanzar_reclamo=True)

    final = _estado(reg["id"])
    assert (final["estado"], final["post_id"]) == ("programado", "post-1")
    assert final["media_url"] == MEDIA
    assert publicaciones.enlace(USER, MEDIA) is None
    # lo tragó el paso que falló, no el atrapa-todo de ejecutar()
    assert "fallo inesperado" not in caplog.text
    assert "enlazar gen-abc" in caplog.text
    assert MEDIA not in caplog.text and "S3 caído" not in caplog.text
