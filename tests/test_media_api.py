"""C3 — subidas prefirmadas: validación, registro en Postgres y guard local.
Sin AWS real: S3 y el repo db van monkeypatcheados."""
import json

import pytest
from fastapi import HTTPException

from server import media_api


def test_config_inactivo_en_local(monkeypatch):
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    assert media_api.config() == {"activo": False, "cdn": ""}


def test_presign_sin_bucket_da_409(monkeypatch):
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    with pytest.raises(HTTPException) as e:
        media_api.presign(media_api.PresignIn(proyecto="video-1", archivo="a.mp4"))
    assert e.value.status_code == 409


@pytest.mark.parametrize("archivo,esperado", [
    ("Mi Video Final!.MP4", "Mi_Video_Final.mp4"),
    ("..\\..\\etc\\passwd.mov", "passwd.mov"),
    ("subcarpeta/clip.m4v", "clip.m4v"),
])
def test_sanear_archivo(archivo, esperado):
    assert media_api._sanear_archivo(archivo) == esperado


def test_sanear_rechaza_extension():
    with pytest.raises(HTTPException):
        media_api._sanear_archivo("script.exe")


def test_presign_key_y_content_type(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    capturado = {}

    class S3:
        def generate_presigned_url(self, op, Params, ExpiresIn):
            capturado.update(op=op, params=Params, expira=ExpiresIn)
            return "https://s3/presigned"
    monkeypatch.setattr(media_api, "_s3", lambda: S3())
    monkeypatch.setattr(media_api.db, "reservar_nombre_editor", lambda u, n: True)
    r = media_api.presign(media_api.PresignIn(
        proyecto="video-1", archivo="Clip Uno.mp4", content_type="video/mp4", bytes=123))
    assert r["key"] == "videos/video-1/subidas/Clip_Uno.mp4"
    assert capturado["params"]["ContentType"] == "video/mp4"
    assert capturado["op"] == "put_object"


def test_presign_valida_nombre_proyecto(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    with pytest.raises(HTTPException) as e:
        media_api.presign(media_api.PresignIn(proyecto="../fuera", archivo="a.mp4"))
    assert e.value.status_code == 422


def test_confirmar_registra_en_db(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    monkeypatch.setenv("CDN_BASE", "https://cdn.test")

    class S3:
        def head_object(self, Bucket, Key):
            return {"ContentLength": 999}
    guardado = {}
    monkeypatch.setattr(media_api, "_s3", lambda: S3())
    monkeypatch.setattr(media_api.db, "reservar_nombre_editor", lambda u, n: True)
    monkeypatch.setattr(media_api.db, "cargar_proyecto_editor", lambda u, n: None)
    monkeypatch.setattr(media_api.db, "guardar_proyecto_editor",
                        lambda u, n, doc: guardado.update(u=u, n=n, doc=json.loads(doc)))
    r = media_api.confirmar(media_api.ConfirmarIn(
        proyecto="video-1", key="videos/video-1/subidas/clip.mp4"))
    assert r == {"key": "videos/video-1/subidas/clip.mp4", "archivo": "clip.mp4",
                 "bytes": 999, "cdn": "https://cdn.test/videos/video-1/subidas/clip.mp4"}
    assert guardado["n"] == "video-1" and guardado["doc"]["subidas"][0]["bytes"] == 999


def test_confirmar_rechaza_key_de_otro_proyecto(monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    with pytest.raises(HTTPException) as e:
        media_api.confirmar(media_api.ConfirmarIn(
            proyecto="video-1", key="videos/OTRO/subidas/clip.mp4"))
    assert e.value.status_code == 422
