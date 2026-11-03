"""E2 — `media_sync.tamano` y `media_sync.copiar` (CONTRATO E2 §5.6).

La copia de «Elegir de Mis creaciones» es de servidor a servidor: el worker no baja
el original para subirlo otra vez. Lo que defiende este archivo:

  * `copiar` usa la copia GESTIONADA del cliente (`s3.copy`, multiparte por encima del
    umbral): un `copy_object` de una sola pieza no admite objetos de más de 5 GB y una
    película subida de 5 GB es un caso permitido (R18);
  * levanta si el origen no existe, y fija el ETag del original (`CopySourceIfMatch`):
    si lo reemplazan a media copia, falla en vez de entregar una mezcla;
  * jamás escribe en el origen: solo lo lee;
  * `tamano` da `None` sin bucket o sin objeto (es lo que deja saltar una copia que ya
    está), sin esconder un fallo de red.

S3 es un doble en memoria (el repo no usa `moto`); sin red, sin dinero."""
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError

from pipeline import media_sync


def _error(codigo: str, operacion: str) -> ClientError:
    return ClientError({"Error": {"Code": codigo, "Message": codigo}}, operacion)


class S3Falso:
    """El pedacito de boto3 que `tamano`/`copiar` usan. Todo lo demás levanta."""

    def __init__(self, objetos: dict[str, tuple[bytes, str]]):
        self.exceptions = SimpleNamespace(ClientError=ClientError)
        self.objetos = dict(objetos)             # key -> (cuerpo, etag)
        self.llamadas: list[tuple] = []
        self.al_leer_cabecera = None             # gancho: cambia el objeto justo después del HEAD

    def head_object(self, Bucket, Key):
        self.llamadas.append(("head_object", Key))
        if Key not in self.objetos:
            raise _error("404", "HeadObject")
        cuerpo, etag = self.objetos[Key]
        respuesta = {"ContentLength": len(cuerpo), "ETag": etag}
        if self.al_leer_cabecera:
            self.al_leer_cabecera(self)
        return respuesta

    def copy(self, CopySource, Bucket, Key, ExtraArgs=None, **_):
        self.llamadas.append(("copy", CopySource["Key"], Key, dict(ExtraArgs or {})))
        origen = CopySource["Key"]
        if origen not in self.objetos:
            raise _error("404", "HeadObject")
        cuerpo, etag = self.objetos[origen]
        si = (ExtraArgs or {}).get("CopySourceIfMatch")
        if si and si != etag:
            raise _error("PreconditionFailed", "CopyObject")
        self.objetos[Key] = (cuerpo, f'"copia-de-{etag}"')

    def copy_object(self, **_):
        raise AssertionError("copy_object de una sola pieza no admite más de 5 GB: hay que usar s3.copy")

    def __getattr__(self, nombre):
        # cualquier escritura que no sea la copia (put_object, upload_file, delete…) es un bug
        raise AssertionError(f"el cliente S3 no debería llamarse con {nombre}")


@pytest.fixture
def s3(monkeypatch):
    falso = S3Falso({"videos/gen-a/pelicula.mp4": (b"x" * 1234, '"e1"')})
    monkeypatch.setattr(media_sync, "_s3", lambda: falso)
    monkeypatch.setattr(media_sync, "_bucket", lambda: "bkt")
    return falso


# ---------------------------------------------------------------------------
# copiar

def test_copiar_usa_la_copia_gestionada_y_deja_el_origen_como_estaba(s3):
    antes = dict(s3.objetos)
    media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4")

    copias = [c for c in s3.llamadas if c[0] == "copy"]
    assert len(copias) == 1 and copias[0][1:3] == ("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4")
    assert s3.objetos["videos/ed-1/clips/c01.mp4"][0] == b"x" * 1234
    # el original: mismos bytes y mismo ETag (nada lo reescribió)
    assert s3.objetos["videos/gen-a/pelicula.mp4"] == antes["videos/gen-a/pelicula.mp4"]
    # y lo único que se hizo con él fue leerlo: HEAD y copiarlo
    assert {c[0] for c in s3.llamadas} == {"head_object", "copy"}


def test_copiar_fija_el_etag_del_original(s3):
    media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4")
    assert [c[3] for c in s3.llamadas if c[0] == "copy"] == [{"CopySourceIfMatch": '"e1"'}]


def test_copiar_con_el_etag_medido_fija_ese_y_no_el_de_ahora(s3):
    """Ajustes 2 · D-13: el ETag que vio quien midió y cobró (`fuentes[].etag`) manda sobre el que
    tenga el objeto cuando el worker arranca."""
    media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4", etag='"e1"')
    assert [c[3] for c in s3.llamadas if c[0] == "copy"] == [{"CopySourceIfMatch": '"e1"'}]


def test_si_el_original_ya_no_es_el_que_se_midio_la_copia_falla_aunque_el_head_vea_el_nuevo(s3):
    """Alguien reemplazó el objeto DESPUÉS de cotizar y ANTES de que el worker arrancara: el HEAD de
    `copiar` ya ve el ETag nuevo, que sin `etag` se fijaría y la copia saldría 'bien' con otro archivo."""
    s3.objetos["videos/gen-a/pelicula.mp4"] = (b"otro" * 100, '"e2"')
    with pytest.raises(ClientError) as e:
        media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4", etag='"e1"')
    assert e.value.response["Error"]["Code"] == "PreconditionFailed"
    assert "videos/ed-1/clips/c01.mp4" not in s3.objetos
    # y sin el ETag medido, el comportamiento de siempre: se fija el de ahora y la copia sale
    media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4")
    assert s3.objetos["videos/ed-1/clips/c01.mp4"][0] == b"otro" * 100


def test_copiar_con_etag_sigue_levantando_si_el_origen_no_existe(s3):
    with pytest.raises(ClientError):
        media_sync.copiar("videos/gen-a/no-existe.mp4", "videos/ed-1/clips/c01.mp4", etag='"e1"')
    assert "videos/ed-1/clips/c01.mp4" not in s3.objetos


def test_si_reemplazan_el_original_a_media_copia_falla(s3):
    """El HEAD lee el ETag "e1"; antes de copiar alguien sube otro archivo con la misma key."""
    s3.al_leer_cabecera = lambda este: este.objetos.update(
        {"videos/gen-a/pelicula.mp4": (b"otro" * 100, '"e2"')})
    with pytest.raises(ClientError) as e:
        media_sync.copiar("videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4")
    assert e.value.response["Error"]["Code"] == "PreconditionFailed"
    assert "videos/ed-1/clips/c01.mp4" not in s3.objetos


def test_copiar_levanta_si_el_origen_no_existe(s3):
    with pytest.raises(ClientError):
        media_sync.copiar("videos/gen-a/no-existe.mp4", "videos/ed-1/clips/c01.mp4")
    assert "videos/ed-1/clips/c01.mp4" not in s3.objetos


def test_copiar_sin_bucket_levanta_en_vez_de_fingir(monkeypatch):
    monkeypatch.setattr(media_sync, "_bucket", lambda: None)
    monkeypatch.setattr(media_sync, "_s3", lambda: pytest.fail("sin bucket no se toca S3"))
    with pytest.raises(RuntimeError):
        media_sync.copiar("a", "b")


# ---------------------------------------------------------------------------
# tamano

def test_tamano_es_el_content_length(s3):
    assert media_sync.tamano("videos/gen-a/pelicula.mp4") == 1234


def test_tamano_de_lo_que_no_existe_es_none(s3):
    assert media_sync.tamano("videos/ed-1/clips/c01.mp4") is None


def test_tamano_sin_bucket_es_none(monkeypatch):
    monkeypatch.setattr(media_sync, "_bucket", lambda: None)
    monkeypatch.setattr(media_sync, "_s3", lambda: pytest.fail("sin bucket no se toca S3"))
    assert media_sync.tamano("cualquiera") is None


def test_tamano_trata_un_403_como_no_esta_y_deja_que_copiar_diga_el_error(s3, monkeypatch):
    """Sin permiso de listar, S3 contesta 403 en vez de 404 para lo que no existe: si
    `tamano` levantara, ninguna primera copia pasaría."""
    def prohibido(Bucket, Key):
        raise _error("403", "HeadObject")
    monkeypatch.setattr(s3, "head_object", prohibido)
    assert media_sync.tamano("videos/ed-1/clips/c01.mp4") is None


def test_tamano_no_esconde_un_fallo_de_red(s3, monkeypatch):
    def se_cae(Bucket, Key):
        raise ConnectionError("sin red")
    monkeypatch.setattr(s3, "head_object", se_cae)
    with pytest.raises(ConnectionError):
        media_sync.tamano("videos/gen-a/pelicula.mp4")


# ---------------------------------------------------------------------------
# el SDK de verdad (botocore.stub): los nombres de los parámetros los valida el modelo del servicio

def test_con_boto3_real_copiar_pide_la_copia_gestionada_con_el_etag_fijado(monkeypatch):
    """El doble de arriba no puede equivocarse de nombre de parámetro; el cliente real sí lo
    valida. `s3.copy` hace su propio HEAD (con `IfMatch`) y luego `copy_object` con
    `CopySourceIfMatch`: si el SDK no admitiera el ETag en `ExtraArgs`, esto levantaría."""
    import os

    import boto3
    from botocore.stub import Stubber
    for var in ("AWS_PROFILE", "AWS_ENDPOINT_URL"):
        monkeypatch.delenv(var, raising=False)
    monkeypatch.setenv("AWS_CONFIG_FILE", os.devnull)
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", os.devnull)
    cliente = boto3.client("s3", region_name="us-east-1",
                           aws_access_key_id="x", aws_secret_access_key="x")
    monkeypatch.setattr(media_sync, "_s3", lambda: cliente)
    monkeypatch.setattr(media_sync, "_bucket", lambda: "bkt")
    origen, destino = "videos/gen-a/pelicula.mp4", "videos/ed-1/clips/c01.mp4"
    with Stubber(cliente) as s3:
        s3.add_response("head_object", {"ContentLength": 1234, "ETag": '"e1"'},
                        {"Bucket": "bkt", "Key": origen})                       # el de media_sync.copiar
        s3.add_response("head_object", {"ContentLength": 1234, "ETag": '"e1"'},
                        {"Bucket": "bkt", "Key": origen, "IfMatch": '"e1"'})    # el de s3.copy
        s3.add_response("copy_object", {},
                        {"Bucket": "bkt", "Key": destino,
                         "CopySource": {"Bucket": "bkt", "Key": origen},
                         "CopySourceIfMatch": '"e1"'})
        media_sync.copiar(origen, destino)
        s3.assert_no_pending_responses()
