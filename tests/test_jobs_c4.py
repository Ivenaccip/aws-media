"""C4 — despacho de trabajos y sincronización con S3 (sin AWS real)."""
import json

import pytest

from pipeline import jobs, media_sync


def test_jobs_backend_default_local(monkeypatch):
    monkeypatch.delenv("JOBS_BACKEND", raising=False)
    assert jobs.backend() == "local"


def test_mensaje_preparar():
    assert jobs.mensaje_preparar("piloto", "abc123") == {
        "tipo": "preparar", "user_id": "piloto", "proyecto_id": "abc123"}


def test_encolar_preparar_manda_a_la_cola(monkeypatch):
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/cola")
    capturado = {}

    class SQS:
        def send_message(self, QueueUrl, MessageBody):
            capturado.update(url=QueueUrl, body=json.loads(MessageBody))
    monkeypatch.setattr(jobs, "_sqs", lambda: SQS())
    jobs.encolar_preparar("piloto", "abc123")
    assert capturado["url"] == "https://sqs/cola"
    assert capturado["body"]["tipo"] == "preparar"


def test_lanzar_produccion_nombra_con_timestamp(monkeypatch):
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    capturado = {}

    class SFN:
        def start_execution(self, stateMachineArn, name, input):
            capturado.update(arn=stateMachineArn, name=name, input=json.loads(input))
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: SFN())
    assert jobs.lanzar_produccion("piloto", "abc123") == "arn:exec"
    assert capturado["name"].startswith("abc123-")
    assert capturado["input"]["proyecto_id"] == "abc123"
    # SFN no interpola JsonPath en arrays: el comando viaja armado en el input
    assert capturado["input"]["command"] == [
        "python", "-m", "worker.producir_task", "piloto", "abc123", "todo"]
    # M22 · G: la fase es un argumento más del comando — partir la producción
    # en dos NO toca la state machine ni el task definition, así que no pide
    # deploy de CDK
    assert jobs.lanzar_produccion("piloto", "abc123", "animar") == "arn:exec"
    assert capturado["input"]["command"][-1] == "animar"


def test_media_sync_noop_sin_bucket(tmp_path, monkeypatch):
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    (tmp_path / "a.txt").write_text("x")
    assert media_sync.subir_dir(tmp_path, "work/u/p/") == 0
    assert media_sync.bajar_prefijo("work/u/p/", tmp_path) == 0


def test_subir_dir_claves_relativas(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-test")
    (tmp_path / "sub").mkdir()
    (tmp_path / "pelicula.mp4").write_bytes(b"v")
    (tmp_path / "sub" / "clip.json").write_text("{}")
    subidos = []

    class S3:
        def upload_file(self, archivo, bucket, key, ExtraArgs):
            subidos.append((key, ExtraArgs["ContentType"]))
    monkeypatch.setattr(media_sync, "_s3", lambda: S3())
    assert media_sync.subir_dir(tmp_path, "work/piloto/abc/") == 2
    assert ("work/piloto/abc/pelicula.mp4", "video/mp4") in subidos
    assert ("work/piloto/abc/sub/clip.json", "application/json") in subidos


def test_prefijo_work():
    assert media_sync.prefijo_work("piloto", "abc") == "work/piloto/abc/"


def test_ssm_env_lista_blanca():
    from tools.ssm_env import CLAVES
    assert "FAL_KEY" in CLAVES and "OPENAI_API_KEY" in CLAVES
    assert not any("GOOGLE" in c or "FILE" in c for c in CLAVES)  # rutas locales jamás
