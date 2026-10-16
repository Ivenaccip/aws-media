"""E2 · Ajustes 2 — `/api/media/presign` y `/confirmar` ante una COPIA editable (D-02) y el nombre original (INT-05).

Una copia `ed-xxxx` es un proyecto propio de la persona, así que `_reservar` la dejaba pasar. Tres daños:

1. `confirmar` hacía cargar → agregar → upsert del doc ENTERO: si el worker cerraba la copia (`listo`) entre
   la lectura y el upsert, el upsert viejo volvía a ponerla `corriendo`; pasadas 2 h la caducidad «soltaba» una
   copia que SÍ se entregó y devolvía lo cobrado (la edición salía gratis);
2. dejaba `subidas` no vacías en una copia, contra la REGLA CRÍTICA del contrato (§4.3: `shorts_api._fuente`
   toma `subidas[-1]` y se confundiría con un original);
3. tampoco hay por qué reescribir el doc entero para agregar una subida (se pisaba `editar` de las corridas viejas).
"""
import json

import pytest
from fastapi import HTTPException

from server import media_api

TEXTO = "Esa es una edición: no se le pueden agregar videos."


class Mundo:
    """Postgres y S3 en memoria para las dos rutas."""

    def __init__(self, monkeypatch):
        monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
        self.docs: dict[str, dict] = {}
        self.llamadas: list[tuple] = []
        self.tras_cargar = None
        db = media_api.db
        monkeypatch.setattr(db, "backend", lambda: "postgres")
        monkeypatch.setattr(db, "usuario_actual", lambda: "u1")
        monkeypatch.setattr(db, "reservar_nombre_editor", lambda u, n: True)
        monkeypatch.setattr(db, "cargar_proyecto_editor", self._cargar)
        monkeypatch.setattr(db, "guardar_proyecto_editor", self._guardar)
        monkeypatch.setattr(db, "fijar_campo_editor", self._fijar)
        self.firmas = []

        class S3:
            def generate_presigned_url(s, op, Params, ExpiresIn):
                self.firmas.append(Params["Key"])
                return "https://s3/firmada"

            def head_object(s, Bucket, Key):
                return {"ContentLength": 999}
        monkeypatch.setattr(media_api, "_s3", lambda: S3())
        monkeypatch.setattr(media_api.media_sync, "url_media", lambda k: f"https://s3/{k}?firma")

    def _cargar(self, u, n):
        self.llamadas.append(("cargar", n))
        d = self.docs.get(n)
        copia = json.loads(json.dumps(d)) if d is not None else None
        if self.tras_cargar is not None:
            gancho, self.tras_cargar = self.tras_cargar, None
            gancho()
        return copia

    def _guardar(self, u, n, doc):
        self.llamadas.append(("guardar", n))
        self.docs[n] = json.loads(doc)

    def _fijar(self, u, n, campo, valor):
        self.llamadas.append(("fijar", n, campo))
        self.docs[n][campo] = json.loads(valor)


@pytest.fixture
def mundo(monkeypatch):
    return Mundo(monkeypatch)


COPIA = {"titulo": "T", "subidas": [], "copia": {"version": 1, "de": []},
         "editar": {"copia": True, "estado": "listo", "fin": "2026-10-15T18:30:00+00:00"}}


def presign(proyecto="ed-9f1c0a7b", archivo="otro.mp4"):
    return media_api.presign(media_api.PresignIn(proyecto=proyecto, archivo=archivo))


def confirmar(proyecto="ed-9f1c0a7b", archivo="otro.mp4", **kw):
    return media_api.confirmar(media_api.ConfirmarIn(
        proyecto=proyecto, key=f"videos/{proyecto}/subidas/{archivo}", **kw))


# ---------------------------------------------------------------------------
# D-02 · una copia no recibe videos

@pytest.mark.parametrize("doc", [
    COPIA,
    {"subidas": [], "editar": {"copia": True, "estado": "corriendo"}},          # solo la marca del candado
    {"subidas": [], "copia": {"version": 1}},                                    # solo el bloque `copia`
])
def test_presign_de_una_copia_es_409_y_no_firma_nada(mundo, doc):
    mundo.docs["ed-9f1c0a7b"] = json.loads(json.dumps(doc))
    with pytest.raises(HTTPException) as e:
        presign()
    assert e.value.status_code == 409 and e.value.detail == TEXTO
    assert mundo.firmas == []


@pytest.mark.parametrize("doc", [COPIA, {"subidas": [], "editar": {"copia": True, "estado": "corriendo"}}])
def test_confirmar_de_una_copia_es_409_y_no_escribe_nada(mundo, doc):
    mundo.docs["ed-9f1c0a7b"] = json.loads(json.dumps(doc))
    antes = json.loads(json.dumps(mundo.docs["ed-9f1c0a7b"]))
    with pytest.raises(HTTPException) as e:
        confirmar()
    assert e.value.status_code == 409 and e.value.detail == TEXTO
    assert mundo.docs["ed-9f1c0a7b"] == antes
    assert not [c for c in mundo.llamadas if c[0] in ("guardar", "fijar")]


def test_un_proyecto_normal_sigue_pasando(mundo):
    mundo.docs["video-1"] = {"subidas": []}
    assert presign("video-1")["key"] == "videos/video-1/subidas/otro.mp4"
    assert confirmar("video-1")["bytes"] == 999
    mundo.docs["gen-1a2b3c4d"] = {"origen": {"generador": "1a2b3c4d"}, "flags": {"generado": True}, "subidas": []}
    assert presign("gen-1a2b3c4d")["key"].startswith("videos/gen-1a2b3c4d/")        # una película NO es una copia
    assert presign("proyecto-nuevo")["key"] == "videos/proyecto-nuevo/subidas/otro.mp4"          # y uno que no existe aún


def test_el_proyecto_de_otra_cuenta_sigue_dando_409_de_nombre(mundo, monkeypatch):
    monkeypatch.setattr(media_api.db, "reservar_nombre_editor", lambda u, n: False)
    mundo.docs["ed-9f1c0a7b"] = json.loads(json.dumps(COPIA))
    with pytest.raises(HTTPException) as e:
        presign()
    assert e.value.status_code == 409 and e.value.detail != TEXTO


# ---------------------------------------------------------------------------
# D-02 (defensa en profundidad) · agregar una subida no reescribe el doc entero

def test_confirmar_en_un_proyecto_que_ya_existe_solo_escribe_las_subidas(mundo):
    mundo.docs["video-1"] = {"subidas": [{"key": "videos/video-1/subidas/viejo.mp4", "archivo": "viejo.mp4", "bytes": 5}],
                             "flags": {"cuts": True}, "editar": {"estado": "corriendo", "creditos": 4}}
    confirmar("video-1", "nuevo.mp4")
    assert [c for c in mundo.llamadas if c[0] in ("guardar", "fijar")] == [("fijar", "video-1", "subidas")]
    d = mundo.docs["video-1"]
    assert [s["archivo"] for s in d["subidas"]] == ["viejo.mp4", "nuevo.mp4"]
    assert d["flags"] == {"cuts": True} and d["editar"] == {"estado": "corriendo", "creditos": 4}


def test_confirmar_repetido_no_duplica_la_subida(mundo):
    mundo.docs["video-1"] = {"subidas": []}
    confirmar("video-1")
    confirmar("video-1")
    assert [s["archivo"] for s in mundo.docs["video-1"]["subidas"]] == ["otro.mp4"]


def test_el_primer_registro_de_un_proyecto_si_crea_el_doc(mundo):
    confirmar("video-nuevo")
    assert mundo.llamadas[-1] == ("guardar", "video-nuevo")
    assert mundo.docs["video-nuevo"]["subidas"][0]["bytes"] == 999


def test_un_cierre_que_cae_entre_la_lectura_y_la_escritura_no_se_pierde(mundo):
    """El worker (o el barredor) cierra la corrida DESPUÉS de que `confirmar` leyó el doc y ANTES de que
    escriba: con el upsert del doc entero se volvía a `corriendo`; ahora solo cambia `subidas`."""
    mundo.docs["video-1"] = {"subidas": [], "editar": {"estado": "corriendo", "creditos": 4}}

    def el_worker_cierra():
        mundo.docs["video-1"]["editar"] = {"estado": "listo", "creditos": 4, "fin": "2026-10-15T18:30:00+00:00"}
    mundo.tras_cargar = None
    original = mundo._cargar
    llamadas = {"n": 0}

    def cargar_y_cierra(u, n):
        d = original(u, n)
        llamadas["n"] += 1
        if llamadas["n"] == 2:                    # la lectura de `confirmar` (la 1.ª es la de `_reservar`)
            el_worker_cierra()
        return d
    media_api.db.cargar_proyecto_editor = cargar_y_cierra
    try:
        confirmar("video-1")
    finally:
        media_api.db.cargar_proyecto_editor = original
    assert mundo.docs["video-1"]["editar"]["estado"] == "listo"
    assert mundo.docs["video-1"]["subidas"][0]["archivo"] == "otro.mp4"


# ---------------------------------------------------------------------------
# INT-05 · el nombre que la persona vio

def test_confirmar_guarda_el_nombre_original_si_viene(mundo):
    mundo.docs["mi-entrevista-1"] = {"subidas": []}
    r = confirmar("mi-entrevista-1", "Mi_Entrevista_1.mp4", nombre="Mi Entrevista (1).mp4")
    s = mundo.docs["mi-entrevista-1"]["subidas"][0]
    assert s["archivo"] == "Mi_Entrevista_1.mp4" and s["nombre_original"] == "Mi Entrevista (1).mp4"
    assert "nombre_original" not in r or r["nombre_original"] == "Mi Entrevista (1).mp4"


def test_sin_nombre_la_subida_queda_como_siempre(mundo):
    mundo.docs["v"] = {"subidas": []}
    confirmar("v")
    assert "nombre_original" not in mundo.docs["v"]["subidas"][0]


@pytest.mark.parametrize("crudo,limpio", [
    ("  Mi   video \t final.mp4 ", "Mi video final.mp4"),
    ("a\x00b\x1f\u200bc.mp4", "abc.mp4"),
    ("C:\\fotos\\viaje.mov", "viaje.mov"),
    ("carpeta/otra/clip.m4v", "clip.m4v"),
    ("x" * 300 + ".mp4", "x" * 120),
])
def test_el_nombre_original_se_limpia_antes_de_guardarse(mundo, crudo, limpio):
    mundo.docs["v"] = {"subidas": []}
    confirmar("v", nombre=crudo)
    assert mundo.docs["v"]["subidas"][0]["nombre_original"] == limpio


@pytest.mark.parametrize("raro", ["", "   ", "\x00\x01", None])
def test_un_nombre_vacio_o_ilegible_no_se_guarda(mundo, raro):
    mundo.docs["v"] = {"subidas": []}
    confirmar("v", nombre=raro)
    assert "nombre_original" not in mundo.docs["v"]["subidas"][0]
