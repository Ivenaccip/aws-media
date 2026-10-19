"""Guía de clases · S1 — el admin «Clases» SIN GASTO: crear, listar, editar, subir el video, confirmarlo,
medirlo, cancelar, ver una vista previa, archivar y restaurar (server/clases_admin_api.py,
pipeline/clases.py, db.clases_*).

Todo con dobles, ninguna llamada de pago ni de red:
  - S3 es `S3Falso`: solo sabe firmar y hacer HEAD; cualquier otra operación (y, con mensaje propio,
    cualquier `delete_*`) REVIENTA. El rol de la Lambda no tiene s3:DeleteObject a propósito.
  - ffprobe es un doble de `_medir` (y, aparte, el `_medir` real con `subprocess.run` falso).
  - La base corre en DOS variantes con las MISMAS pruebas (fixture `bd`): `memoria` (un doble de las
    `db.clases_*`, siempre) y `postgres` (el SQL real de `pipeline/db.py` contra un Postgres 16 por el
    mismo shim que `test_coi_postgres.py`; se omite sin `COI_PG_SOCK`):

        COI_PG_SOCK=/tmp/pgint-servidor/sock pytest tests/test_clases_admin.py

Las pruebas que importan están escritas para FALLAR si se rompe el código: quitar la dependencia del
router, meter el nombre del archivo en la clave, llamar `delete_object` al archivar, agregar `clases/`
a la lista del CDN o quitar el `estado = 'borrador'` de la sentencia de subida hace caer al menos una.
"""
from __future__ import annotations

import ast
import json
import logging
import os
import re
import subprocess
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from pipeline import clases, db, media_rutas, media_sync
from server import auth, clases_admin_api, edicion_api

RAIZ = Path(__file__).resolve().parent.parent
BUCKET = "bucket-de-prueba"
GIB = 1024**3
FIRMA = "FIRMA-SECRETA-9f3a"          # va dentro de TODA URL firmada del doble: no debe salir de ahí
ARN = "arn:aws:rds:us-east-1:191241816158:cluster:aws-media-db"


# ===========================================================================
# los dobles

class S3Falso:
    """Lo único que las clases le piden a S3: firmar y mirar (HEAD). Todo lo demás revienta."""

    def __init__(self):
        self.objetos: dict[str, dict] = {}
        self.llamadas: list[tuple[str, dict]] = []
        self.error_head: Exception | None = None
        self.error_firma: Exception | None = None
        self.exceptions = SimpleNamespace(ClientError=ClientError)

    @property
    def firmadas(self) -> list[tuple[str, dict]]:
        return [(op, p) for op, p in self.llamadas if op in ("put_object", "get_object")]

    def poner(self, key: str, bytes_: int, tipo: str = "video/mp4") -> None:
        """Lo que dejó el PUT del navegador."""
        self.objetos[key] = {"bytes": bytes_, "tipo": tipo}

    def generate_presigned_url(self, ClientMethod, Params=None, ExpiresIn=3600):  # noqa: N803
        self.llamadas.append((ClientMethod, {**(Params or {}), "ExpiresIn": ExpiresIn}))
        if self.error_firma:
            raise self.error_firma
        return (f"https://{BUCKET}.s3.amazonaws.com/{Params['Key']}"
                f"?X-Amz-Signature={FIRMA}&X-Amz-Expires={ExpiresIn}")

    def head_object(self, Bucket, Key):  # noqa: N803
        self.llamadas.append(("head_object", {"Bucket": Bucket, "Key": Key}))
        if self.error_head:
            raise self.error_head
        o = self.objetos.get(Key)
        if o is None:
            raise ClientError({"Error": {"Code": "404", "Message": "Not Found"}}, "HeadObject")
        return {"ContentLength": o["bytes"], "ContentType": o["tipo"], "ETag": '"abc"'}

    def __getattr__(self, nombre):
        if nombre.startswith("__"):
            raise AttributeError(nombre)
        if "delete" in nombre.lower():
            raise AssertionError(f"NADA se borra en S3 (el rol no tiene s3:DeleteObject): "
                                 f"algo llamó a {nombre}")
        raise AssertionError(f"las clases de S1 solo firman y hacen HEAD en S3; llamaron a {nombre}")


class Medidor:
    """Doble de `clases_admin_api._medir` (ffprobe)."""

    def __init__(self):
        self.resultado: dict | None = {"duracion_s": 3720.4, "ancho": 1920, "alto": 1080, "audio": True}
        self.llamadas: list[str] = []

    def __call__(self, key):
        self.llamadas.append(key)
        return self.resultado


class ClasesEnMemoria:
    """El mismo contrato que `db.clases_*`, en memoria: números únicos entre vivas, `clave` única y
    cada cambio de estado comparar-y-cambiar (con un candado: la API corre en hilos)."""

    NOMBRES = ("clases_listar", "clases_obtener", "clases_crear", "clases_editar", "clases_a_subiendo",
               "clases_cancelar", "clases_confirmar", "clases_medida", "clases_medida_fallo",
               "clases_archivar", "clases_restaurar")

    def __init__(self):
        self.filas: dict[str, dict] = {}
        self.claves: dict[str, str] = {}
        self.lock = threading.RLock()
        self.reloj = 0

    def instalar(self, monkeypatch):
        for n in self.NOMBRES:
            monkeypatch.setattr(db, n, getattr(self, n))

    def _ahora(self):
        self.reloj += 1
        return f"2026-10-19T20:{self.reloj // 60 % 60:02d}:{self.reloj % 60:02d}Z"

    def _tomado(self, numero, salvo=None):
        return any(f["numero"] == numero and f["archivada_en"] is None and f["id"] != salvo
                   for f in self.filas.values())

    def clases_listar(self, archivadas=False):
        with self.lock:
            filas = [dict(f) for f in self.filas.values() if (f["archivada_en"] is not None) == archivadas]
        filas.sort(key=lambda f: (f["numero"], f["id"]))
        if archivadas:
            filas.sort(key=lambda f: f["archivada_en"], reverse=True)
        return filas

    def clases_obtener(self, id_):
        with self.lock:
            return dict(self.filas[id_]) if id_ in self.filas else None

    def clases_crear(self, *, id_, clave, numero, titulo, resumen, grabada_en, origen, liga, creado_por):
        with self.lock:
            if id_ not in self.filas and clave not in self.claves and not self._tomado(numero):
                ahora = self._ahora()
                self.filas[id_] = {
                    "id": id_, "numero": numero, "titulo": titulo, "resumen": resumen,
                    "grabada_en": grabada_en, "origen": origen, "video_key": None,
                    "nombre_original": None, "liga": liga, "bytes": None, "duracion_s": None,
                    "estado": "borrador", "error": None, "publicada": False, "indice_version": 0,
                    "indice_modelo": None, "trozos_n": None, "indexada_en": None, "creado": ahora,
                    "actualizado": ahora, "archivada_en": None}
                self.claves[clave] = id_
                return dict(self.filas[id_]), True
            if clave in self.claves:
                return dict(self.filas[self.claves[clave]]), False
            if self._tomado(numero):
                raise db.ClaseNumeroRepetido()
            raise db.ClaseIdRepetido()

    def _viva(self, id_, **condiciones):
        f = self.filas.get(id_)
        if f is None or f["archivada_en"] is not None:
            return None
        return f if all(f.get(k) == v for k, v in condiciones.items()) else None

    def clases_editar(self, id_, cambios):
        with self.lock:
            f = self._viva(id_)
            if f is None or ("numero" in cambios and self._tomado(cambios["numero"], salvo=id_)):
                return None
            f.update(cambios)
            f["actualizado"] = self._ahora()
            return dict(f)

    def clases_a_subiendo(self, id_, video_key, nombre_original, bytes_declarados):
        with self.lock:
            f = self._viva(id_, origen="archivo", estado="borrador")
            if f is None:
                return None
            f.update(estado="subiendo", video_key=video_key, nombre_original=nombre_original,
                     bytes=bytes_declarados, duracion_s=None, error=None, actualizado=self._ahora())
            return dict(f)

    def clases_cancelar(self, id_):
        with self.lock:
            f = self._viva(id_, estado="subiendo")
            if f is None:
                return None
            f.update(estado="borrador", video_key=None, nombre_original=None, bytes=None,
                     duracion_s=None, error=None, actualizado=self._ahora())
            return dict(f)

    def clases_confirmar(self, id_, video_key, bytes_declarados, bytes_reales, nombre_original):
        with self.lock:
            f = self._viva(id_, origen="archivo", estado="subiendo", video_key=video_key,
                           bytes=bytes_declarados)
            if f is None:
                return None
            f.update(estado="subido", bytes=bytes_reales, error=None, actualizado=self._ahora(),
                     nombre_original=nombre_original or f["nombre_original"])
            return dict(f)

    def clases_medida(self, id_, video_key, duracion_s):
        with self.lock:
            f = self._viva(id_, estado="subido", video_key=video_key)
            if f is None:
                return None
            f.update(duracion_s=float(duracion_s), error=None, actualizado=self._ahora())
            return dict(f)

    def clases_medida_fallo(self, id_, video_key, texto):
        with self.lock:
            f = self._viva(id_, estado="subido", video_key=video_key)
            if f is None:
                return False
            f.update(error=texto, actualizado=self._ahora())
            return True

    def clases_archivar(self, id_):
        with self.lock:
            f = self.filas.get(id_)
            if f is None:
                return False
            f["archivada_en"] = f["archivada_en"] or self._ahora()
            f["actualizado"] = self._ahora()
            return True

    def clases_restaurar(self, id_):
        with self.lock:
            f = self.filas.get(id_)
            if f is None or f["archivada_en"] is None or self._tomado(f["numero"], salvo=id_):
                return None
            f.update(archivada_en=None, actualizado=self._ahora())
            return dict(f)


# --- Postgres real (el mismo shim que test_coi_postgres.py, con su propia base) ----------------------

psycopg = pytest.importorskip("psycopg")
from psycopg.rows import dict_row  # noqa: E402

SOCK = os.environ.get("COI_PG_SOCK", "")
HAY_PG = bool(SOCK and os.path.exists(SOCK))
BASE_PG = "clases_prueba"
_PARAM = re.compile(r"(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)")


class Shim:
    """`db.ejecutar` sobre Postgres: UNA sentencia por llamada, autocommit, parámetros `:nombre`, una
    conexión por hilo (las carreras son reales)."""

    def __init__(self):
        self._tl = threading.local()
        self.llamadas: list[tuple[str, dict]] = []

    @property
    def conn(self):
        c = getattr(self._tl, "c", None)
        if c is None or c.closed:
            c = self._tl.c = psycopg.connect(host=SOCK, user="postgres", dbname=BASE_PG,
                                             autocommit=True, row_factory=dict_row)
        return c

    @staticmethod
    def _valor(nombre, valor):
        p = db._param(nombre, valor)["value"]          # lo mismo que recibe el Data API
        return None if p.get("isNull") else next(iter(p.values()))

    def ejecutar(self, sql, params=None):
        self.llamadas.append((sql, dict(params or {})))
        params = {k: self._valor(k, v) for k, v in (params or {}).items()}
        cur = self.conn.execute(_PARAM.sub(lambda m: f"%({m.group(1)})s", sql), params)
        if cur.description is None:
            return []
        return [{k: (str(v) if hasattr(v, "isoformat") else v) for k, v in f.items()}
                for f in cur.fetchall()]


@pytest.fixture(scope="module")
def base_pg():
    with psycopg.connect(host=SOCK, user="postgres", dbname="postgres", autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{BASE_PG}" WITH (FORCE)')
        c.execute(f"CREATE DATABASE \"{BASE_PG}\" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0")
    yield
    with psycopg.connect(host=SOCK, user="postgres", dbname="postgres", autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{BASE_PG}" WITH (FORCE)')


@pytest.fixture
def pg(request, monkeypatch):
    if not HAY_PG:
        pytest.skip("sin Postgres: define COI_PG_SOCK con el directorio del socket")
    request.getfixturevalue("base_pg")
    shim = Shim()
    monkeypatch.setattr(db, "ejecutar", shim.ejecutar)
    for sentencia in db.ESQUEMA:
        db.ejecutar(sentencia)
    db.ejecutar("TRUNCATE clases, clases_config")
    return shim


@pytest.fixture(params=["memoria", "postgres"])
def bd(request, monkeypatch):
    """La base de las pruebas de la API: el doble en memoria o el SQL real. Las MISMAS pruebas."""
    if request.param == "memoria":
        f = ClasesEnMemoria()
        f.instalar(monkeypatch)
        return f
    return request.getfixturevalue("pg")


# --- el mundo de la API ----------------------------------------------------------------------------

@pytest.fixture
def mundo(bd, monkeypatch):
    """Dev local abierto (todos son admin), estado en «Postgres», un bucket y el doble de S3."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", BUCKET)
    monkeypatch.setenv("CDN_BASE", "https://cdn.example")
    s3 = S3Falso()
    monkeypatch.setattr(media_sync, "_s3", lambda: s3)
    medidor = Medidor()
    monkeypatch.setattr(clases_admin_api, "_medir", medidor)
    from server.app import app
    return SimpleNamespace(cliente=TestClient(app), s3=s3, medidor=medidor, bd=bd)


_contador = iter(range(1, 10_000))


def alta(m, **extra):
    """Crea una clase por HTTP y devuelve (respuesta, cuerpo enviado)."""
    cuerpo = {"clave": str(uuid.uuid4()), "numero": next(_contador), "titulo": "Clase de prueba",
              "origen": "archivo", **extra}
    return m.cliente.post("/api/admin/clases", json=cuerpo), cuerpo


def nueva(m, **extra) -> str:
    r, _ = alta(m, **extra)
    assert r.status_code == 201, r.text
    return r.json()["clase"]["id"]


def pedir_subida(m, id_, archivo="clase.mp4", tipo="video/mp4", bytes_=1000):
    return m.cliente.post(f"/api/admin/clases/{id_}/subida",
                          json={"archivo": archivo, "content_type": tipo, "bytes": bytes_})


def clave_pedida(m) -> str:
    """La clave de S3 de la última URL de subida que se firmó."""
    return [p["Key"] for op, p in m.s3.llamadas if op == "put_object"][-1]


def subiendo(m, **kw) -> str:
    id_ = nueva(m)
    r = pedir_subida(m, id_, **kw)
    assert r.status_code == 200, r.text
    return id_


def subido(m, bytes_=1000, tipo="video/mp4", **kw) -> str:
    """Crea → pide la subida → «el navegador sube» → confirma."""
    id_ = subiendo(m, bytes_=bytes_, tipo=tipo, **kw)
    m.s3.poner(clave_pedida(m), bytes_, tipo)
    r = m.cliente.post(f"/api/admin/clases/{id_}/confirmar", json={})
    assert r.status_code == 200, r.text
    return id_


def codigo(r) -> str:
    return r.json()["detail"]["codigo"]


def clase(m, id_) -> dict:
    """La clase tal como la lista el admin (viva o archivada)."""
    for archivadas in (0, 1):
        for c in m.cliente.get(f"/api/admin/clases?archivadas={archivadas}").json()["clases"]:
            if c["id"] == id_:
                return c
    raise AssertionError(f"{id_} no sale en ninguna lista")


# ===========================================================================
# 1. pipeline/clases.py: lo que entra y lo que no

def test_la_clave_de_s3_sale_del_id_y_de_la_lista_cerrada():
    assert clases.clave_video("cl-3f9a21bc", ".mp4") == "clases/cl-3f9a21bc/video.mp4"
    assert clases.clave_video("cl-3f9a21bc", ".mov") == "clases/cl-3f9a21bc/video.mov"
    for malo in ("../x", "cl-3f9a21b", "cl-3F9A21BC", "cl-3f9a21bc/../x", "x", "", "cl-3f9a21bc\n"):
        with pytest.raises(ValueError):
            clases.clave_video(malo, ".mp4")
    for ext in (".exe", ".MP4", "mp4", "/../x", ".mp4/x", ""):
        with pytest.raises(ValueError):
            clases.clave_video("cl-3f9a21bc", ext)


def test_el_id_nuevo_tiene_el_formato_y_no_se_repite():
    ids = {clases.id_nuevo() for _ in range(200)}
    assert len(ids) == 200 and all(clases.es_id(i) for i in ids)
    assert not clases.es_id(None) and not clases.es_id("cl-123")


def test_los_limites_son_los_de_la_seccion_5_1_y_vienen_del_servidor():
    lim = clases.limites()
    assert lim["max_bytes"] == 5_368_709_120
    assert lim["extensiones"] == [".mp4", ".mov", ".m4v"]
    assert lim["content_types"] == ["video/mp4", "video/quicktime", "video/x-m4v"]
    assert (lim["presign_s"], lim["duracion_min_s"], lim["duracion_max_s"]) == (900, 60, 7200)
    assert (lim["titulo_max"], lim["resumen_max"]) == (120, 140)
    assert "precios" not in lim


@pytest.mark.parametrize("valor,esperado", [
    ("  Respuestas   automáticas \n con tus datos ", "Respuestas automáticas con tus datos"),
    ("Con\x00nul\u200bo y \ud800suelto", "Connulo y suelto"),
    ("x" * 120, "x" * 120),
])
def test_titulo_se_limpia(valor, esperado):
    assert clases.validar_titulo(valor) == esperado


@pytest.mark.parametrize("valor", ["", "   ", "\x00\u200b", "x" * 121, None, 5, ["a"]])
def test_titulo_invalido(valor):
    with pytest.raises(clases.ValorInvalido) as e:
        clases.validar_titulo(valor)
    assert e.value.codigo == "titulo_invalido"


def test_resumen():
    assert clases.validar_resumen(None) is None
    assert clases.validar_resumen("   ") is None
    assert clases.validar_resumen("x" * 140) == "x" * 140
    with pytest.raises(clases.ValorInvalido) as e:
        clases.validar_resumen("x" * 141)
    assert e.value.codigo == "resumen_largo"


@pytest.mark.parametrize("valor", [0, -1, 1000, True, "5", 5.0, None])
def test_numero_invalido(valor):
    with pytest.raises(clases.ValorInvalido) as e:
        clases.validar_numero(valor)
    assert e.value.codigo == "numero_invalido"


def test_numero_en_el_rango():
    assert clases.validar_numero(1) == 1 and clases.validar_numero(999) == 999


def test_fecha():
    from datetime import date
    hoy = date(2026, 10, 19)
    assert clases.validar_fecha("2026-03-12", hoy) == "2026-03-12"
    assert clases.validar_fecha("2026-10-20", hoy) == "2026-10-20"      # mañana: el día de quien graba
    assert clases.validar_fecha(None, hoy) is None and clases.validar_fecha("", hoy) is None
    for malo in ("2026-13-01", "2026-02-30", "20260312", "2026-3-12", "12/03/2026", "1999-12-31",
                 "2026-10-21", "2026-W11-4", 20260312, "2026-03-12T00:00"):
        with pytest.raises(clases.ValorInvalido) as e:
            clases.validar_fecha(malo, hoy)
        assert e.value.codigo == "fecha_invalida", malo


def test_clave_de_idempotencia():
    assert clases.validar_clave(str(uuid.uuid4()))
    for malo in ("", "corta", "x" * 65, "con espacio y más cosas", "../../x/../../y", None, 12345678):
        with pytest.raises(clases.ValorInvalido) as e:
            clases.validar_clave(malo)
        assert e.value.codigo == "clave_invalida"


LIGAS_BUENAS = [
    "https://www.youtube.com/watch?v=abc123&t=760s",
    "https://vimeo.com/123456789",
    "https://youtu.be/abc",
    "https://skool.com/mi-comunidad/classroom/abc?md=123",
    "https://drive.google.com:443/file/d/1AbC/view",
    "HTTPS://Ejemplo.COM/Ruta",
    "https://xn--ejemplo-con-acentos-9bc.com/clase",
    "  https://loom.com/share/abc  ",
]


@pytest.mark.parametrize("liga", LIGAS_BUENAS)
def test_ligas_buenas(liga):
    assert clases.validar_liga(liga) == liga.strip()


LIGAS_HOSTILES = [
    "javascript:alert(1)", "JavaScript:alert(document.cookie)", "file:///etc/passwd",
    "data:text/html,<script>alert(1)</script>", "ftp://example.com/x", "gopher://example.com",
    "http://example.com/x", "//example.com/x", "example.com/x", "www.example.com", "",
    "   ", "https://", "https:///ruta", "https:example.com",
    "https://169.254.169.254/latest/meta-data/", "https://169.254.170.2/v2/credentials",
    "https://127.0.0.1/", "https://10.0.0.1/", "https://192.168.1.1/", "https://0.0.0.0/",
    "https://2130706433/", "https://0x7f.0.0.1/", "https://0177.0.0.1/", "https://017700000001/",
    "https://localhost", "https://localhost/", "https://LOCALHOST:443/", "https://localhost./",
    "https://foo.localhost/", "https://[::1]/", "https://[::ffff:127.0.0.1]/",
    "https://[fe80::1]/", "https://[2001:db8::1]:443/",
    "https://usuario:clave@ejemplo.com/", "https://usuario@ejemplo.com/", "https://ejemplo.com@evil.com/",
    "https://evil.com\\@ejemplo.com/", "https://ejemplo.com:8443/", "https://ejemplo.com:80/",
    "https://ejemplo.com:abc/", "https://intranet/", "https://metadata.google.internal/",
    "https://servidor.local/", "https://router.lan/", "https://ejemplo.com./",
    "https://-ejemplo.com/", "https://ejem plo.com/", "https://ejemplo.com/a b", "https://ejemplo.com/a\nb", "https://ejemplo.com/\tx",
    "https://ejemplo.com/\x00", "https://ejemplo.com/\u202e", "https://ejemplo.com/ñ", "https://éjemplo.com/",
    "https://ejemplo.com/" + "a" * 500,
    "https://ejemplo.com/" + "a" * 2000,
    "https://" + "a" * 64 + ".com/", None, 5, ["https://ejemplo.com"],
]


@pytest.mark.parametrize("liga", LIGAS_HOSTILES)
def test_ligas_hostiles(liga):
    with pytest.raises(clases.ValorInvalido) as e:
        clases.validar_liga(liga)
    assert e.value.codigo == "liga_invalida"


def test_una_liga_de_exactamente_500_caracteres_pasa_y_501_no():
    base = "https://ejemplo.com/"
    assert clases.validar_liga(base + "a" * (500 - len(base))) is not None
    with pytest.raises(clases.ValorInvalido):
        clases.validar_liga(base + "a" * (501 - len(base)))


def test_la_lista_de_hosts_del_dueno_manda_cuando_existe(monkeypatch):
    monkeypatch.setattr(clases, "HOSTS_PERMITIDOS", ("youtube.com", "vimeo.com"))
    assert clases.validar_liga("https://youtube.com/watch?v=1")
    assert clases.validar_liga("https://www.youtube.com/watch?v=1")
    assert clases.validar_liga("https://player.vimeo.com/video/1")
    for malo in ("https://evil.com/youtube.com", "https://notyoutube.com/", "https://youtube.com.evil.com/"):
        with pytest.raises(clases.ValorInvalido):
            clases.validar_liga(malo)


@pytest.mark.parametrize("nombre,ext", [
    ("clase5.mp4", ".mp4"), ("Clase 5 final.MOV", ".mov"), ("a.b.c.m4v", ".m4v"),
    ("clase..final.mp4", ".mp4"),
])
def test_archivo_bueno(nombre, ext):
    assert clases.validar_archivo(nombre)[0] == ext


@pytest.mark.parametrize("nombre,cod", [
    ("virus.exe", "extension_no_soportada"), ("clase.mp4.exe", "extension_no_soportada"),
    ("clase", "extension_no_soportada"), (".mp4", "extension_no_soportada"),
    ("clase.mkv", "extension_no_soportada"), ("clase.mp4 ", "extension_no_soportada"),
    ("../../etc/passwd.mp4", "nombre_invalido"), ("a/b.mp4", "nombre_invalido"),
    ("..\\x.mp4", "nombre_invalido"), ("/clase.mp4", "nombre_invalido"), ("c:\\v\\clase.mp4", "nombre_invalido"),
    ("clase\x00.mp4", "nombre_invalido"), ("cla\nse.mp4", "nombre_invalido"),
    ("", "nombre_invalido"), (None, "nombre_invalido"), ("a" * 256 + ".mp4", "nombre_invalido"),
])
def test_archivo_malo(nombre, cod):
    with pytest.raises(clases.ValorInvalido) as e:
        clases.validar_archivo(nombre)
    assert e.value.codigo == cod


def test_content_type_lista_cerrada():
    assert clases.validar_content_type("Video/MP4") == "video/mp4"
    assert clases.validar_content_type(" video/quicktime\n") == "video/quicktime"
    for malo in ("text/html", "video/mp4; codecs=avc1", "video/*", "application/octet-stream", "", None,
                 "video/webm", "video/mp4\x00", "video/mp4 x"):
        with pytest.raises(clases.ValorInvalido) as e:
            clases.validar_content_type(malo)
        assert e.value.codigo == "tipo_no_soportado"


def test_tamano_declarado():
    assert clases.validar_tamano_declarado(1) == 1
    assert clases.validar_tamano_declarado(5 * GIB) == 5 * GIB
    for malo in (0, -1, 5 * GIB + 1, True, 1.5, "100", None):
        with pytest.raises(clases.ValorInvalido) as e:
            clases.validar_tamano_declarado(malo)
        assert e.value.codigo == "tamano_invalido"


def test_clases_no_importa_nada_pesado_ni_de_pago():
    """El módulo de validación es Python puro: sin boto3, FastAPI ni proveedores."""
    arbol = ast.parse((RAIZ / "pipeline" / "clases.py").read_text(encoding="utf-8"))
    importados = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else n.names[0].name.split(".")[0]
                  for n in ast.walk(arbol) if isinstance(n, (ast.Import, ast.ImportFrom))}
    assert importados <= {"__future__", "ipaddress", "re", "secrets", "datetime", "urllib"}, importados


# ===========================================================================
# 2. el esquema y db_migrate

TABLAS_NUEVAS = ("clases", "clases_config")


def _entradas(nombre):
    return [s for s in db.ESQUEMA if re.match(rf"\s*CREATE TABLE IF NOT EXISTS {nombre}\b", s)]


def test_las_tablas_nuevas_son_entradas_de_esquema_que_db_migrate_detecta():
    for t in TABLAS_NUEVAS:
        assert len(_entradas(t)) == 1, t
    for s in db.ESQUEMA:
        # el Data API no acepta dos sentencias por llamada
        assert ";" not in s.strip().rstrip(";"), s[:80]
    indices = " ".join(" ".join(s.split()) for s in db.ESQUEMA if "INDEX" in s)
    assert "CREATE UNIQUE INDEX IF NOT EXISTS clases_clave ON clases (clave) WHERE clave IS NOT NULL" in indices
    assert ("CREATE UNIQUE INDEX IF NOT EXISTS clases_vivas ON clases (numero) "
            "WHERE archivada_en IS NULL") in indices


def test_la_tabla_clases_tiene_las_columnas_de_la_seccion_4_1():
    sql = " ".join(_entradas("clases")[0].split())
    for col in ("id text PRIMARY KEY", "clave text", "numero int NOT NULL", "titulo text NOT NULL",
                "resumen text", "grabada_en date", "origen text NOT NULL", "video_key text",
                "nombre_original text", "liga text", "bytes bigint", "duracion_s double precision",
                "estado text NOT NULL DEFAULT 'borrador'", "error text",
                "publicada boolean NOT NULL DEFAULT false", "transcript_key text",
                "indice_version int NOT NULL DEFAULT 0", "indice_modelo text", "trozos_n int",
                "indexada_en timestamptz", "creado_por text NOT NULL",
                "creado timestamptz NOT NULL DEFAULT now()",
                "actualizado timestamptz NOT NULL DEFAULT now()", "archivada_en timestamptz"):
        assert col in sql, col
    cfg = " ".join(_entradas("clases_config")[0].split())
    assert "clave text PRIMARY KEY" in cfg and "valor text NOT NULL" in cfg and "actualizado timestamptz" in cfg


def test_db_migrate_ve_las_tablas_nuevas_y_se_niega_a_terminar_si_falta_una(monkeypatch, capsys):
    """`tools/db_migrate.py` (el paso manual que no puede olvidarse en ningún entorno) las detecta
    por su `CREATE TABLE IF NOT EXISTS <nombre>`: si tras correr falta una, sale con error."""
    from tools import db_migrate
    import sys
    creadas: list[str] = []
    omitir: set[str] = set()

    def ejecutar(sql, params=None):
        m = re.match(r"\s*CREATE TABLE IF NOT EXISTS (\w+)", sql)
        if m and m.group(1) not in omitir:
            creadas.append(m.group(1))
        if "information_schema.tables" in sql:
            return [{"table_name": t} for t in creadas]
        return []
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    monkeypatch.setattr(sys, "argv", ["db_migrate.py", "--cluster-arn", "x", "--secret-arn", "y"])
    for var in ("DB_CLUSTER_ARN", "DB_SECRET_ARN", "DB_NAME"):
        monkeypatch.setenv(var, "")
    db_migrate.main()
    salida = capsys.readouterr().out
    assert all(t in creadas for t in TABLAS_NUEVAS)
    assert re.search(r"Las \d+ tablas del esquema existen", salida)
    creadas.clear()
    omitir.add("clases")
    with pytest.raises(SystemExit) as salio:
        db_migrate.main()
    assert "clases" in str(salio.value)


def test_cada_sentencia_de_clases_es_una_sola_y_usa_solo_parametros_que_recibe(monkeypatch):
    """Higiene del SQL sin Postgres: una sentencia por llamada, ningún `:algo` que no sea parámetro
    pasado (el Data API de Aurora no se pudo probar contra literales con «:»), ningún parámetro
    sobrante."""
    vistas: list[tuple[str, dict]] = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, params=None: vistas.append((sql, dict(params or {}))) or [])
    db.clases_listar(False)
    db.clases_listar(True)
    db.clases_obtener("cl-00000000")
    with pytest.raises(db.ClaseIdRepetido):
        db.clases_crear(id_="cl-00000000", clave="k" * 8, numero=1, titulo="t", resumen=None,
                        grabada_en="2026-03-12", origen="archivo", liga=None, creado_por="u")
    db.clases_editar("cl-00000000", {"numero": 1, "titulo": "t", "resumen": None, "grabada_en": None,
                                     "liga": None})
    db.clases_a_subiendo("cl-00000000", "clases/cl-00000000/video.mp4", "n.mp4", 10)
    db.clases_cancelar("cl-00000000")
    db.clases_confirmar("cl-00000000", "clases/cl-00000000/video.mp4", 10, 10, None)
    db.clases_medida("cl-00000000", "clases/cl-00000000/video.mp4", 12.5)
    db.clases_medida_fallo("cl-00000000", "clases/cl-00000000/video.mp4", "x")
    db.clases_archivar("cl-00000000")
    db.clases_restaurar("cl-00000000")
    assert len(vistas) >= 12
    for sql, params in vistas:
        assert ";" not in sql.strip().rstrip(";"), sql
        usados = set(_PARAM.findall(sql))
        assert usados == set(params), (usados ^ set(params), sql)


# ===========================================================================
# 3. la autorización: por el ROUTER, y recorriendo TODAS las rutas

PREFIJO = "/api/admin/clases"
ESPERADAS = {
    ("GET", PREFIJO), ("POST", PREFIJO), ("PATCH", PREFIJO + "/{clase_id}"),
    ("POST", PREFIJO + "/{clase_id}/subida"), ("POST", PREFIJO + "/{clase_id}/confirmar"),
    ("POST", PREFIJO + "/{clase_id}/medir"), ("POST", PREFIJO + "/{clase_id}/cancelar"),
    ("GET", PREFIJO + "/{clase_id}/video"), ("DELETE", PREFIJO + "/{clase_id}"),
    ("POST", PREFIJO + "/{clase_id}/restaurar"),
}


def rutas_de_clases() -> set[tuple[str, str]]:
    """(método, ruta) de TODO lo que cuelga de /api/admin/clases en la app real. FastAPI ya no deja las
    rutas incluidas sueltas en `app.routes` (las anida), así que se enumeran por el esquema OpenAPI, que
    las aplana: cualquier ruta nueva con ese prefijo, de cualquier módulo, sale aquí."""
    from server.app import app
    paths = app.openapi()["paths"]
    return {(m.upper(), p) for p, ops in paths.items() if p.startswith(PREFIJO)
            for m in ops if m in ("get", "post", "put", "patch", "delete")}


def _url(ruta: str) -> str:
    return ruta.replace("{clase_id}", "cl-0123abcd")


@pytest.fixture
def con_cognito(monkeypatch):
    monkeypatch.setenv("COGNITO_POOL_ID", "us-east-1_TESTPOOL")
    monkeypatch.setenv("COGNITO_CLIENT_ID", "clienteweb123")
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", BUCKET)

    def verificar(token):
        if token == "VENCIDO":
            raise ValueError("token vencido")
        return {"sub": "sub-" + token, "cognito:groups": ["admin"] if token == "ADMIN" else []}
    monkeypatch.setattr(auth, "verificar", verificar)
    from server.app import app
    return TestClient(app)


def test_la_enumeracion_encuentra_todas_las_rutas_de_s1():
    """Si esto devolviera pocas, las pruebas de abajo pasarían sin probar nada."""
    assert ESPERADAS <= rutas_de_clases()


def test_un_no_admin_recibe_403_en_TODAS_las_rutas_de_clases(con_cognito):
    rutas = rutas_de_clases()
    assert ESPERADAS <= rutas
    for metodo, ruta in sorted(rutas):
        r = con_cognito.request(metodo, _url(ruta), json={} if metodo != "GET" else None,
                                headers={"Authorization": "Bearer ALUMNA"})
        assert r.status_code == 403, (metodo, ruta, r.status_code, r.text)
        assert r.json()["detail"] == {"codigo": "no_admin", "texto": "Solo para administradores"}, (metodo, ruta)


def test_sin_token_o_con_token_vencido_recibe_401_en_TODAS_las_rutas_de_clases(con_cognito):
    for metodo, ruta in sorted(rutas_de_clases()):
        for cabeceras in ({}, {"Authorization": "Bearer VENCIDO"}):
            r = con_cognito.request(metodo, _url(ruta), json={} if metodo != "GET" else None,
                                    headers=cabeceras)
            assert r.status_code == 401, (metodo, ruta, cabeceras, r.status_code)


def test_un_admin_pasa_la_puerta_en_todas_las_rutas(con_cognito):
    """El 403 de arriba no es un «todo da 403»: con el grupo admin la puerta se abre (lo que siga —404,
    422, 503 por la base que no hay en esta prueba— ya es de cada ruta)."""
    for metodo, ruta in sorted(rutas_de_clases()):
        r = con_cognito.request(metodo, _url(ruta), json={} if metodo != "GET" else None,
                                headers={"Authorization": "Bearer ADMIN"})
        assert r.status_code not in (401, 403), (metodo, ruta, r.status_code)


def test_la_autorizacion_va_antes_que_la_validacion_del_cuerpo(con_cognito):
    """Un no-admin que manda un cuerpo que no pasaría la validación recibe 403, no el 422 que le
    diría qué campos tiene la ruta. (Un JSON que ni siquiera se puede leer lo rechaza FastAPI antes de
    resolver las dependencias: ahí no corre ningún handler y no se filtra nada.)"""
    for cuerpo in ({"key": "clases/x/video.mp4"}, {"numero": "no"}, {"archivo": 5}, []):
        for ruta in (PREFIJO, PREFIJO + "/cl-0123abcd", PREFIJO + "/cl-0123abcd/subida"):
            for metodo in ("POST", "PATCH"):
                r = con_cognito.request(metodo, ruta, json=cuerpo, headers={"Authorization": "Bearer ALUMNA"})
                assert r.status_code in (403, 405), (metodo, ruta, cuerpo, r.status_code)
    r = con_cognito.post(PREFIJO, json={"clave": "x"}, headers={"Authorization": "Bearer ALUMNA"})
    assert r.status_code == 403


def test_la_dependencia_esta_en_el_router_y_ningun_handler_la_llama_a_mano():
    r = clases_admin_api.router
    assert [d.dependency for d in r.dependencies] == [clases_admin_api._exigir_admin]
    # y de verdad llega a cada ruta ya armada
    for ruta in r.routes:
        assert any(d.call is clases_admin_api._exigir_admin for d in ruta.dependant.dependencies), ruta.path
    arbol = ast.parse((RAIZ / "server" / "clases_admin_api.py").read_text(encoding="utf-8"))
    llamadas = [n for n in ast.walk(arbol) if isinstance(n, ast.Call)
                and isinstance(n.func, ast.Name) and n.func.id == "_exigir_admin"]
    assert not llamadas, "un handler llama _exigir_admin a mano: la puerta es del router"


def test_ningun_otro_modulo_declara_rutas_bajo_api_admin_clases():
    for f in (RAIZ / "server").glob("*.py"):
        if f.name == "clases_admin_api.py":
            continue
        codigo_sin_comentarios = "\n".join(l.split("#", 1)[0] for l in f.read_text(encoding="utf-8").splitlines())
        assert "/api/admin/clases" not in codigo_sin_comentarios, (
            f"{f.name} declara rutas bajo /api/admin/clases: solo las del router con la puerta")


def test_el_router_va_antes_del_montaje_de_los_estaticos():
    from server.app import app
    tipos = [type(r).__name__ for r in app.routes]
    raiz = max(i for i, r in enumerate(app.routes) if type(r).__name__ == "Mount" and r.path == "")
    incluidos = [i for i, r in enumerate(app.routes)
                 if getattr(r, "original_router", None) is clases_admin_api.router]
    assert incluidos and max(incluidos) < raiz, tipos


def test_en_dev_local_sin_postgres_responde_503_explicado(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.delenv("STATE_BACKEND", raising=False)
    from server.app import app
    r = TestClient(app).get(PREFIJO)
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "no_nube"


# ===========================================================================
# 4. la API: crear, listar, editar

PRIVADOS = ("video_key", "creado_por", "clave", "transcript_key")


def test_crear_y_listar_sin_precios_y_con_los_limites(mundo):
    r, cuerpo = alta(mundo, titulo="Respuestas automáticas", resumen="Conectas la IA con tus datos",
                     grabada_en="2026-03-12")
    assert r.status_code == 201
    c = r.json()["clase"]
    assert re.fullmatch(r"cl-[0-9a-f]{8}", c["id"])
    assert (c["numero"], c["titulo"], c["resumen"], c["grabada_en"], c["origen"]) == (
        cuerpo["numero"], "Respuestas automáticas", "Conectas la IA con tus datos", "2026-03-12", "archivo")
    assert (c["estado"], c["publicada"], c["liga"], c["bytes"], c["duracion_s"], c["error"],
            c["indice"], c["archivada_en"], c["paso"]) == ("borrador", False, None, None, None, None,
                                                            None, None, None)
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", c["creado"])
    assert not set(PRIVADOS) & set(c)
    lista = mundo.cliente.get(PREFIJO).json()
    assert [x["id"] for x in lista["clases"]] == [c["id"]]
    assert lista["limites"] == clases.limites()
    assert set(lista) == {"clases", "limites"}, "los precios llegan con S4, no ahora"


def test_la_lista_va_por_numero_y_separa_vivas_de_archivadas(mundo):
    b = nueva(mundo, numero=20, titulo="B")
    a = nueva(mundo, numero=3, titulo="A")
    c = nueva(mundo, numero=11, titulo="C")
    assert [x["id"] for x in mundo.cliente.get(PREFIJO).json()["clases"]] == [a, c, b]
    assert mundo.cliente.delete(f"{PREFIJO}/{c}").status_code == 200
    assert [x["id"] for x in mundo.cliente.get(PREFIJO).json()["clases"]] == [a, b]
    assert [x["id"] for x in mundo.cliente.get(PREFIJO + "?archivadas=1").json()["clases"]] == [c]
    assert mundo.cliente.get(PREFIJO + "?archivadas=0").json()["clases"][0]["id"] == a


def test_crear_dos_veces_con_la_misma_clave_es_una_sola_clase(mundo):
    """El doble clic: la misma `clave` devuelve la misma clase, aunque el segundo clic traiga otro número."""
    r1, cuerpo = alta(mundo, numero=7)
    r2 = mundo.cliente.post(PREFIJO, json={**cuerpo, "numero": 8, "titulo": "Otro"})
    assert r1.status_code == r2.status_code == 201
    assert r1.json()["clase"]["id"] == r2.json()["clase"]["id"]
    assert r2.json()["clase"]["numero"] == 7 and r2.json()["clase"]["titulo"] == "Clase de prueba"
    assert len(mundo.cliente.get(PREFIJO).json()["clases"]) == 1


def test_crear_en_paralelo_con_la_misma_clave_deja_una_sola_fila(mundo):
    cuerpo = {"clave": str(uuid.uuid4()), "numero": 5, "titulo": "Doble clic", "origen": "archivo"}
    with ThreadPoolExecutor(8) as pool:
        rs = list(pool.map(lambda _: mundo.cliente.post(PREFIJO, json=cuerpo), range(8)))
    assert {r.status_code for r in rs} == {201}
    assert len({r.json()["clase"]["id"] for r in rs}) == 1
    assert len(mundo.cliente.get(PREFIJO).json()["clases"]) == 1


def test_numero_repetido_es_409_solo_entre_vivas(mundo):
    primera = nueva(mundo, numero=5)
    r, _ = alta(mundo, numero=5)
    assert r.status_code == 409 and codigo(r) == "numero_repetido"
    assert len(mundo.cliente.get(PREFIJO).json()["clases"]) == 1
    # archivada, su número queda libre
    assert mundo.cliente.delete(f"{PREFIJO}/{primera}").status_code == 200
    segunda = nueva(mundo, numero=5)
    # y restaurar la primera choca con la segunda, que ahora lo tiene
    r = mundo.cliente.post(f"{PREFIJO}/{primera}/restaurar")
    assert r.status_code == 409 and codigo(r) == "numero_repetido"
    assert mundo.cliente.get(PREFIJO + "?archivadas=1").json()["clases"][0]["id"] == primera
    # al liberar el número se puede restaurar
    assert mundo.cliente.delete(f"{PREFIJO}/{segunda}").status_code == 200
    r = mundo.cliente.post(f"{PREFIJO}/{primera}/restaurar")
    assert r.status_code == 200 and r.json()["clase"]["archivada_en"] is None


def test_numero_repetido_en_paralelo_gana_una_sola(mundo):
    def uno(_):
        return mundo.cliente.post(PREFIJO, json={"clave": str(uuid.uuid4()), "numero": 9,
                                                 "titulo": "Carrera", "origen": "archivo"})
    with ThreadPoolExecutor(8) as pool:
        rs = list(pool.map(uno, range(8)))
    assert sorted(r.status_code for r in rs) == [201] + [409] * 7
    assert len(mundo.cliente.get(PREFIJO).json()["clases"]) == 1


@pytest.mark.parametrize("campo,valor,cod", [
    ("titulo", "", "titulo_invalido"), ("titulo", "   ", "titulo_invalido"),
    ("titulo", "x" * 121, "titulo_invalido"),
    ("numero", 0, "numero_invalido"), ("numero", 1000, "numero_invalido"), ("numero", -3, "numero_invalido"),
    ("resumen", "x" * 141, "resumen_largo"),
    ("grabada_en", "12/03/2026", "fecha_invalida"), ("grabada_en", "2999-01-01", "fecha_invalida"),
    ("clave", "corta", "clave_invalida"), ("clave", "../../etc/passwd", "clave_invalida"),
])
def test_crear_rechaza_lo_invalido(mundo, campo, valor, cod):
    r, _ = alta(mundo, **{campo: valor})
    assert r.status_code == 422 and codigo(r) == cod
    assert mundo.cliente.get(PREFIJO).json()["clases"] == []


def test_crear_rechaza_campos_de_mas_y_tipos_raros(mundo):
    """`extra="forbid"`: una `key` de S3, un precio o una duración que mande el navegador es un 422."""
    base = {"clave": str(uuid.uuid4()), "numero": 1, "titulo": "t", "origen": "archivo"}
    for extra in ({"key": "clases/x/video.mp4"}, {"video_key": "x"}, {"duracion_s": 99}, {"usd": 0.01},
                  {"estado": "lista"}, {"publicada": True}, {"id": "cl-00000000"}, {"creado_por": "otro"}):
        r = mundo.cliente.post(PREFIJO, json={**base, **extra})
        assert r.status_code == 422, extra
    for malo in ({"numero": "5"}, {"numero": 5.5}, {"numero": True}, {"titulo": 7}, {"origen": "otro"},
                 {"origen": None}):
        assert mundo.cliente.post(PREFIJO, json={**base, **malo}).status_code == 422, malo
    assert mundo.cliente.get(PREFIJO).json()["clases"] == []


def test_una_clase_de_liga_lleva_su_liga_y_una_de_archivo_no(mundo):
    r, _ = alta(mundo, origen="liga", liga="https://www.youtube.com/watch?v=abc")
    assert r.status_code == 201
    c = r.json()["clase"]
    assert c["origen"] == "liga" and c["liga"] == "https://www.youtube.com/watch?v=abc"
    assert c["estado"] == "borrador"        # no hay nada que subir, pero tampoco nada que procesar todavía
    r, _ = alta(mundo, origen="liga")
    assert r.status_code == 422 and codigo(r) == "liga_invalida"
    r, _ = alta(mundo, origen="archivo", liga="https://youtube.com/watch?v=abc")
    assert r.status_code == 422 and codigo(r) == "liga_invalida"


@pytest.mark.parametrize("liga", [l for l in LIGAS_HOSTILES if isinstance(l, str)])
def test_crear_con_ligas_hostiles_es_422_y_no_deja_nada(mundo, liga):
    r, _ = alta(mundo, origen="liga", liga=liga)
    assert r.status_code == 422 and codigo(r) == "liga_invalida", liga
    assert mundo.cliente.get(PREFIJO).json()["clases"] == []


def test_editar_cambia_solo_lo_enviado_y_null_borra(mundo):
    id_ = nueva(mundo, numero=4, titulo="Original", resumen="Para qué sirve", grabada_en="2026-03-12")
    r = mundo.cliente.patch(f"{PREFIJO}/{id_}", json={"titulo": "  Nuevo   título "})
    c = r.json()["clase"]
    assert r.status_code == 200 and c["titulo"] == "Nuevo título"
    assert (c["numero"], c["resumen"], c["grabada_en"]) == (4, "Para qué sirve", "2026-03-12")
    c = mundo.cliente.patch(f"{PREFIJO}/{id_}", json={"resumen": None, "grabada_en": None, "numero": 8}).json()["clase"]
    assert (c["resumen"], c["grabada_en"], c["numero"], c["titulo"]) == (None, None, 8, "Nuevo título")
    assert mundo.cliente.patch(f"{PREFIJO}/{id_}", json={}).json()["clase"]["numero"] == 8


def test_editar_el_numero_a_uno_de_otra_viva_es_409_y_al_propio_no(mundo):
    a = nueva(mundo, numero=1)
    b = nueva(mundo, numero=2)
    r = mundo.cliente.patch(f"{PREFIJO}/{b}", json={"numero": 1})
    assert r.status_code == 409 and codigo(r) == "numero_repetido"
    assert clase(mundo, b)["numero"] == 2
    assert mundo.cliente.patch(f"{PREFIJO}/{a}", json={"numero": 1}).status_code == 200


@pytest.mark.parametrize("cuerpo,cod", [
    ({"titulo": ""}, "titulo_invalido"), ({"titulo": None}, "titulo_invalido"),
    ({"numero": 0}, "numero_invalido"), ({"numero": None}, "numero_invalido"),
    ({"resumen": "x" * 141}, "resumen_largo"), ({"grabada_en": "ayer"}, "fecha_invalida"),
    ({"liga": "https://youtube.com/x"}, "liga_invalida"),       # es una clase de archivo
])
def test_editar_rechaza_lo_invalido(mundo, cuerpo, cod):
    id_ = nueva(mundo)
    r = mundo.cliente.patch(f"{PREFIJO}/{id_}", json=cuerpo)
    assert r.status_code == 422 and codigo(r) == cod
    assert clase(mundo, id_)["titulo"] == "Clase de prueba"


def test_editar_la_liga_de_una_clase_de_liga(mundo):
    id_ = nueva(mundo, origen="liga", liga="https://vimeo.com/1")
    c = mundo.cliente.patch(f"{PREFIJO}/{id_}", json={"liga": "https://vimeo.com/2"}).json()["clase"]
    assert c["liga"] == "https://vimeo.com/2"
    for liga in ("javascript:alert(1)", None, "http://vimeo.com/2", "https://169.254.169.254/"):
        r = mundo.cliente.patch(f"{PREFIJO}/{id_}", json={"liga": liga})
        assert r.status_code == 422 and codigo(r) == "liga_invalida", liga
    assert clase(mundo, id_)["liga"] == "https://vimeo.com/2"


def test_editar_no_acepta_campos_de_mas(mundo):
    id_ = nueva(mundo)
    for extra in ({"estado": "lista"}, {"key": "x"}, {"bytes": 5}, {"origen": "liga"}, {"publicada": True}):
        assert mundo.cliente.patch(f"{PREFIJO}/{id_}", json=extra).status_code == 422, extra


def test_ids_inexistentes_o_con_otro_formato_son_404_en_todas_las_rutas(mundo):
    for id_ in ("cl-ffffffff", "cl-123", "x", "CL-FFFFFFFF", "cl-ffffffffx", "cl-ffffffff.", "%20"):
        for metodo, ruta, cuerpo in (
                ("PATCH", "", {"titulo": "x"}), ("POST", "/subida", {"archivo": "a.mp4", "content_type":
                                                                    "video/mp4", "bytes": 5}),
                ("POST", "/confirmar", {}), ("POST", "/medir", None), ("POST", "/cancelar", None),
                ("GET", "/video", None), ("DELETE", "", None), ("POST", "/restaurar", None)):
            r = mundo.cliente.request(metodo, f"{PREFIJO}/{id_}{ruta}", json=cuerpo)
            assert r.status_code == 404 and codigo(r) == "no_existe", (id_, metodo, ruta, r.status_code)
    assert mundo.s3.llamadas == []


# ===========================================================================
# 5. subir el video: la clave la decide el servidor

def test_la_subida_firma_una_clave_que_decide_el_servidor_sin_el_nombre_del_archivo(mundo, monkeypatch):
    """La clave es clases/<id>/video.<ext>: ni el nombre del archivo ni el usuario entran."""
    monkeypatch.setenv("DEFAULT_USER_ID", "ivenaccip-sub-7c1e")
    id_ = nueva(mundo, titulo="TÍTULO-QUE-NO-ENTRA")
    r = pedir_subida(mundo, id_, archivo="Mi Clase Secreta (final) v3.MOV", tipo="video/quicktime",
                     bytes_=123_456)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"
    cuerpo = r.json()
    assert set(cuerpo) == {"url", "content_type", "expira_s"}, "la clave de S3 no sale del servidor"
    assert (cuerpo["content_type"], cuerpo["expira_s"]) == ("video/quicktime", 900)
    (op, p), = mundo.s3.firmadas
    assert op == "put_object"
    assert p == {"Bucket": BUCKET, "Key": f"clases/{id_}/video.mov", "ContentType": "video/quicktime",
                 "ExpiresIn": 900}
    for secreto in ("Secreta", "Clase", "final", "ivenaccip", "7c1e", "TÍTULO", "piloto"):
        assert secreto not in p["Key"] and secreto not in cuerpo["url"].split("?")[0], secreto
    assert cuerpo["url"].startswith(f"https://{BUCKET}.s3.amazonaws.com/clases/{id_}/video.mov?")
    c = clase(mundo, id_)
    assert (c["estado"], c["bytes"], c["nombre_original"]) == ("subiendo", 123_456, "Mi Clase Secreta (final) v3.MOV")
    assert "video_key" not in c


@pytest.mark.parametrize("archivo,tipo,bytes_,cod", [
    ("virus.exe", "video/mp4", 100, "extension_no_soportada"),
    ("clase.mp4.exe", "video/mp4", 100, "extension_no_soportada"),
    ("clase.mkv", "video/mp4", 100, "extension_no_soportada"),
    ("clase", "video/mp4", 100, "extension_no_soportada"),
    ("clase.mp4", "text/html", 100, "tipo_no_soportado"),
    ("clase.mp4", "application/x-msdownload", 100, "tipo_no_soportado"),
    ("clase.mp4", "video/mp4; codecs=avc1", 100, "tipo_no_soportado"),
    ("clase.mp4", "", 100, "tipo_no_soportado"),
    ("clase.mp4", "video/mp4", 0, "tamano_invalido"),
    ("clase.mp4", "video/mp4", -5, "tamano_invalido"),
    ("clase.mp4", "video/mp4", 5 * GIB + 1, "tamano_invalido"),
    ("clase.mp4", "video/mp4", 2**63, "tamano_invalido"),
    ("../../etc/passwd.mp4", "video/mp4", 100, "nombre_invalido"),
    ("../clase.mp4", "video/mp4", 100, "nombre_invalido"),
    ("carpeta/clase.mp4", "video/mp4", 100, "nombre_invalido"),
    ("..\\..\\clase.mp4", "video/mp4", 100, "nombre_invalido"),
    ("/clase.mp4", "video/mp4", 100, "nombre_invalido"),
    ("", "video/mp4", 100, "nombre_invalido"),
])
def test_la_subida_rechaza_lo_que_no_es_un_video_de_la_lista(mundo, archivo, tipo, bytes_, cod):
    id_ = nueva(mundo)
    r = pedir_subida(mundo, id_, archivo=archivo, tipo=tipo, bytes_=bytes_)
    assert r.status_code == 422 and codigo(r) == cod
    assert mundo.s3.llamadas == [], "no se firmó nada"
    assert clase(mundo, id_)["estado"] == "borrador", "y la clase no cambió de estado"


def test_la_subida_rechaza_cuerpos_raros(mundo):
    id_ = nueva(mundo)
    ok = {"archivo": "a.mp4", "content_type": "video/mp4", "bytes": 100}
    for malo in ({**ok, "key": "clases/otra/video.mp4"}, {**ok, "bytes": "100"}, {**ok, "bytes": 100.5},
                 {**ok, "bytes": True}, {**ok, "bytes": None}, {"archivo": "a.mp4"}, {**ok, "archivo": 7},
                 {**ok, "usd": 0}):
        r = mundo.cliente.post(f"{PREFIJO}/{id_}/subida", json=malo)
        assert r.status_code == 422, malo
    assert mundo.s3.llamadas == [] and clase(mundo, id_)["estado"] == "borrador"


def test_la_subida_acepta_justo_5_gib(mundo):
    id_ = nueva(mundo)
    assert pedir_subida(mundo, id_, bytes_=5 * GIB).status_code == 200
    assert clase(mundo, id_)["bytes"] == 5 * GIB


def test_la_subida_de_cada_extension_firma_su_clave(mundo):
    for archivo, tipo, ext in (("a.mp4", "video/mp4", ".mp4"), ("a.MOV", "video/quicktime", ".mov"),
                               ("a.m4v", "video/x-m4v", ".m4v")):
        id_ = nueva(mundo)
        assert pedir_subida(mundo, id_, archivo=archivo, tipo=tipo).status_code == 200
        assert clave_pedida(mundo) == f"clases/{id_}/video{ext}"


def test_pedir_la_subida_de_una_clase_de_liga_archivada_o_ya_subiendo_no_firma_nada(mundo):
    liga = nueva(mundo, origen="liga", liga="https://vimeo.com/1")
    r = pedir_subida(mundo, liga)
    assert r.status_code == 409 and codigo(r) == "origen_liga"
    arch = nueva(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{arch}")
    r = pedir_subida(mundo, arch)
    assert r.status_code == 404 and codigo(r) == "no_existe"
    assert mundo.s3.llamadas == []
    en_curso = subiendo(mundo)
    r = pedir_subida(mundo, en_curso)
    assert r.status_code == 409 and codigo(r) == "estado_no_permite"
    assert r.json()["detail"]["estado"] == "subiendo"
    assert len(mundo.s3.firmadas) == 1, "la segunda subida no recibió URL"


def test_no_hay_segunda_subida_para_una_clase_ya_subida(mundo):
    """v1 no reemplaza videos: se archiva y se crea otra clase."""
    id_ = subido(mundo)
    r = pedir_subida(mundo, id_)
    assert r.status_code == 409 and codigo(r) == "estado_no_permite"


def test_dos_subidas_a_la_vez_gana_una_sola(mundo):
    """Carrera: dos pestañas piden la URL de la misma clase al mismo tiempo."""
    id_ = nueva(mundo)
    tope = threading.Barrier(6)

    def pedir(_):
        tope.wait(10)
        return pedir_subida(mundo, id_)
    with ThreadPoolExecutor(6) as pool:
        rs = list(pool.map(pedir, range(6)))
    assert sorted(r.status_code for r in rs) == [200] + [409] * 5
    assert {codigo(r) for r in rs if r.status_code == 409} == {"estado_no_permite"}
    assert len(mundo.s3.firmadas) == 1, "solo una URL de subida salió"


def test_si_no_se_pudo_firmar_la_clase_no_se_queda_en_subiendo(mundo):
    id_ = nueva(mundo)
    mundo.s3.error_firma = RuntimeError(f"no pude firmar https://x/y?X-Amz-Signature={FIRMA} {ARN}")
    r = pedir_subida(mundo, id_)
    assert r.status_code == 502 and codigo(r) == "s3_fallo"
    assert FIRMA not in r.text and "arn:" not in r.text
    assert clase(mundo, id_)["estado"] == "borrador"
    mundo.s3.error_firma = None
    assert pedir_subida(mundo, id_).status_code == 200


def test_sin_bucket_la_subida_es_503(mundo, monkeypatch):
    monkeypatch.delenv("MEDIA_BUCKET")
    id_ = nueva(mundo)
    r = pedir_subida(mundo, id_)
    assert r.status_code == 503 and codigo(r) == "sin_s3"
    assert clase(mundo, id_)["estado"] == "borrador"


# ===========================================================================
# 6. confirmar: el HEAD manda

def test_confirmar_mira_s3_y_pasa_a_subido(mundo):
    id_ = subiendo(mundo, bytes_=1_503_238_553, archivo="clase5.mp4")
    mundo.s3.poner(clave_pedida(mundo), 1_503_238_553)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={"nombre": "Clase 5 (final).mp4"})
    assert r.status_code == 200
    c = r.json()["clase"]
    assert (c["estado"], c["bytes"], c["nombre_original"], c["error"]) == (
        "subido", 1_503_238_553, "Clase 5 (final).mp4", None)
    assert not set(PRIVADOS) & set(c)
    assert mundo.s3.llamadas[-1] == ("head_object", {"Bucket": BUCKET, "Key": f"clases/{id_}/video.mp4"})


def test_confirmar_sin_cuerpo_conserva_el_nombre_que_se_dijo_al_pedir_la_subida(mundo):
    id_ = subiendo(mundo, archivo="Mi video.mp4")
    mundo.s3.poner(clave_pedida(mundo), 1000)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar")
    assert r.status_code == 200 and r.json()["clase"]["nombre_original"] == "Mi video.mp4"


def test_el_nombre_que_llega_al_confirmar_se_limpia(mundo):
    id_ = subiendo(mundo)
    mundo.s3.poner(clave_pedida(mundo), 1000)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={"nombre": "C:\\carpeta\\Clase\u202e 5\x00.mp4"})
    assert r.json()["clase"]["nombre_original"] == "Clase 5.mp4"


def test_confirmar_dos_veces_es_idempotente(mundo):
    id_ = subido(mundo)
    n = len(mundo.s3.llamadas)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 200 and r.json()["clase"]["estado"] == "subido"
    assert len(mundo.s3.llamadas) == n, "ni vuelve a mirar S3"


def test_confirmar_en_paralelo_termina_subido_para_todos(mundo):
    id_ = subiendo(mundo, bytes_=777)
    mundo.s3.poner(clave_pedida(mundo), 777)
    tope = threading.Barrier(5)

    def confirmar(_):
        tope.wait(10)
        return mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    with ThreadPoolExecutor(5) as pool:
        rs = list(pool.map(confirmar, range(5)))
    assert {r.status_code for r in rs} == {200}
    assert clase(mundo, id_)["estado"] == "subido"


def test_confirmar_con_el_head_fallido_es_404_y_la_clase_sigue_en_subiendo(mundo):
    id_ = subiendo(mundo)             # nadie subió nada
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 404 and codigo(r) == "archivo_no_esta"
    assert clase(mundo, id_)["estado"] == "subiendo"
    # y se puede cancelar y volver a intentar
    assert mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar").status_code == 200


def test_confirmar_cuando_s3_contesta_403_tambien_es_que_no_esta(mundo):
    id_ = subiendo(mundo)
    mundo.s3.error_head = ClientError({"Error": {"Code": "403", "Message": "Forbidden"}}, "HeadObject")
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 404 and codigo(r) == "archivo_no_esta"


def test_confirmar_si_s3_no_contesta_no_dice_que_el_archivo_no_esta(mundo):
    """«No pude mirar» no es «no existe»: 502, sin el mensaje de la excepción."""
    id_ = subiendo(mundo)
    mundo.s3.error_head = ConnectionError(f"Could not connect to https://{BUCKET}.s3.amazonaws.com/?X-Amz-Signature={FIRMA} role {ARN}")
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 502 and codigo(r) == "s3_fallo"
    assert FIRMA not in r.text and "arn:" not in r.text and BUCKET not in r.text
    mundo.s3.error_head = ClientError({"Error": {"Code": "InternalError", "Message": f"{ARN} {FIRMA}"}},
                                      "HeadObject")
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 502 and codigo(r) == "s3_fallo" and FIRMA not in r.text and "arn:" not in r.text
    assert clase(mundo, id_)["estado"] == "subiendo"


def test_confirmar_con_un_tamano_distinto_al_declarado_es_422(mundo):
    id_ = subiendo(mundo, bytes_=1000)
    mundo.s3.poner(clave_pedida(mundo), 999)          # llegó otro archivo (o cortado)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 422 and codigo(r) == "tamano_invalido"
    c = clase(mundo, id_)
    assert (c["estado"], c["bytes"]) == ("subiendo", 1000)


def test_confirmar_un_objeto_de_mas_de_5_gib_es_422(mundo):
    id_ = subiendo(mundo, bytes_=1000)
    mundo.s3.poner(clave_pedida(mundo), 5 * GIB + 1)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 422 and codigo(r) == "tamano_invalido"
    assert clase(mundo, id_)["estado"] == "subiendo"


def test_confirmar_un_objeto_vacio_es_422(mundo):
    id_ = subiendo(mundo, bytes_=1000)
    mundo.s3.poner(clave_pedida(mundo), 0)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 422 and codigo(r) == "video_vacio"
    assert clase(mundo, id_)["estado"] == "subiendo"


@pytest.mark.parametrize("tipo", ["text/html", "application/octet-stream", "video/webm", "", "image/png"])
def test_confirmar_un_objeto_de_otro_tipo_es_422(mundo, tipo):
    id_ = subiendo(mundo, bytes_=1000, tipo="video/mp4")
    mundo.s3.poner(clave_pedida(mundo), 1000, tipo)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})
    assert r.status_code == 422 and codigo(r) == "tipo_no_soportado"
    assert clase(mundo, id_)["estado"] == "subiendo"


def test_confirmar_acepta_el_tipo_con_parametros_o_mayusculas(mundo):
    id_ = subiendo(mundo, bytes_=1000)
    mundo.s3.poner(clave_pedida(mundo), 1000, "Video/MP4; charset=binary")
    assert mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={}).status_code == 200


def test_confirmar_fuera_de_estado_origen_o_archivada(mundo):
    borrador = nueva(mundo)
    r = mundo.cliente.post(f"{PREFIJO}/{borrador}/confirmar", json={})
    assert r.status_code == 409 and codigo(r) == "estado_no_permite"
    liga = nueva(mundo, origen="liga", liga="https://vimeo.com/1")
    r = mundo.cliente.post(f"{PREFIJO}/{liga}/confirmar", json={})
    assert r.status_code == 409 and codigo(r) == "origen_liga"
    arch = subiendo(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{arch}")
    r = mundo.cliente.post(f"{PREFIJO}/{arch}/confirmar", json={})
    assert r.status_code == 404 and codigo(r) == "no_existe"
    assert not [l for l in mundo.s3.llamadas if l[0] == "head_object"], "ninguna miró S3"


def test_confirmar_rechaza_cuerpos_con_campos_de_mas(mundo):
    id_ = subiendo(mundo)
    for extra in ({"key": "clases/otra/video.mp4"}, {"bytes": 5}, {"duracion_s": 10}):
        assert mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json=extra).status_code == 422


def test_cancelar_despues_de_pedir_otra_subida_invalida_la_confirmacion(mundo):
    """Si la clase se canceló y se volvió a pedir en el medio, el HEAD de antes no la confirma."""
    id_ = subiendo(mundo, bytes_=1000)
    key = clave_pedida(mundo)
    c = db.clases_obtener(id_)
    assert db.clases_cancelar(id_)["estado"] == "borrador"
    assert db.clases_a_subiendo(id_, key, "otra.mp4", 2000)["bytes"] == 2000
    assert db.clases_confirmar(id_, key, c["bytes"], 1000, None) is None, "los bytes declarados ya no son 1000"
    assert db.clases_obtener(id_)["estado"] == "subiendo"


# ===========================================================================
# 7. medir

def test_medir_guarda_la_duracion_que_midio_ffprobe(mundo):
    id_ = subido(mundo)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
    assert r.status_code == 200
    c = r.json()["clase"]
    assert (c["estado"], c["duracion_s"], c["error"]) == ("subido", 3720.4, None)
    assert mundo.medidor.llamadas == [f"clases/{id_}/video.mp4"]
    assert clase(mundo, id_)["duracion_s"] == 3720.4


def test_medir_no_acepta_una_duracion_del_navegador(mundo):
    id_ = subido(mundo)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/medir", json={"duracion_s": 1})
    assert r.status_code == 200, "el cuerpo se ignora: la ruta no lo lee"
    assert clase(mundo, id_)["duracion_s"] == 3720.4


@pytest.mark.parametrize("resultado", [None, {}, {"duracion_s": 0}])
def test_si_ffprobe_falla_es_502_y_la_clase_queda_subida_con_un_aviso_fijo(mundo, resultado):
    id_ = subido(mundo)
    mundo.medidor.resultado = resultado
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
    assert r.status_code == 502 and codigo(r) == "medir_fallo"
    c = clase(mundo, id_)
    assert (c["estado"], c["duracion_s"], c["error"]) == ("subido", None, "No pudimos leer la duración del video.")
    # al volver a intentar y salir bien, el aviso se va
    mundo.medidor.resultado = {"duracion_s": 61.5}
    c = mundo.cliente.post(f"{PREFIJO}/{id_}/medir").json()["clase"]
    assert (c["duracion_s"], c["error"]) == (61.5, None)


def test_medir_fuera_de_estado_origen_o_archivada(mundo):
    for id_ in (nueva(mundo), subiendo(mundo)):
        r = mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
        assert r.status_code == 409 and codigo(r) == "estado_no_permite"
    liga = nueva(mundo, origen="liga", liga="https://vimeo.com/1")
    r = mundo.cliente.post(f"{PREFIJO}/{liga}/medir")
    assert r.status_code == 409 and codigo(r) == "origen_liga"
    arch = subido(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{arch}")
    assert mundo.cliente.post(f"{PREFIJO}/{arch}/medir").status_code == 404
    assert mundo.medidor.llamadas == [], "ffprobe no corrió"


def test_el_medir_real_usa_la_url_firmada_8_s_y_un_reintento_sin_filtrar_la_firma(mundo, monkeypatch, caplog):
    """Sin el doble de `_medir`: el de la edición, con `subprocess.run` falso."""
    monkeypatch.setattr(clases_admin_api, "_medir", lambda key: edicion_api._medir(key))
    monkeypatch.setattr(media_rutas, "SERVIBLES_CDN", media_rutas.SERVIBLES_CDN + ("clases/",))   # el peor caso
    id_ = subido(mundo)
    llamadas = []

    def run(cmd, **kw):
        llamadas.append((cmd, kw))
        if len(llamadas) == 1:
            return subprocess.CompletedProcess(cmd, 1, "", f"Server returned 403 para {cmd[-1]}")
        datos = {"streams": [{"codec_type": "video", "width": 1280, "height": 720}, {"codec_type": "audio"}],
                 "format": {"duration": "3720.4"}}
        return subprocess.CompletedProcess(cmd, 0, json.dumps(datos), "")
    monkeypatch.setattr(edicion_api.subprocess, "run", run)
    with caplog.at_level(logging.INFO):
        r = mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
    assert r.status_code == 200 and r.json()["clase"]["duracion_s"] == 3720.4
    assert len(llamadas) == 2, "un reintento"
    cmd, kw = llamadas[0]
    assert cmd[0] == "ffprobe" and kw["timeout"] == 8
    assert cmd[-1].startswith(f"https://{BUCKET}.s3.amazonaws.com/clases/{id_}/video.mp4?"), \
        "la URL es la firmada de S3, jamás la del CDN"
    assert "cdn.example" not in cmd[-1]
    assert FIRMA not in caplog.text, "ffprobe falló con la firma en su mensaje y el log la dejó salir"


# ===========================================================================
# 8. cancelar

def test_cancelar_vuelve_a_borrador_y_no_toca_s3(mundo):
    id_ = subiendo(mundo, bytes_=1000)
    n = len(mundo.s3.llamadas)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar")
    assert r.status_code == 200
    c = r.json()["clase"]
    assert (c["estado"], c["bytes"], c["nombre_original"], c["error"]) == ("borrador", None, None, None)
    assert len(mundo.s3.llamadas) == n, "cancelar no habla con S3 (y no puede borrar)"
    # se puede volver a pedir, ahora con otra extensión
    assert pedir_subida(mundo, id_, archivo="otra.mov", tipo="video/quicktime").status_code == 200
    assert clave_pedida(mundo) == f"clases/{id_}/video.mov"


def test_cancelar_fuera_de_subiendo_es_409(mundo):
    for id_ in (nueva(mundo), subido(mundo)):
        r = mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar")
        assert r.status_code == 409 and codigo(r) == "estado_no_permite"
    id_ = subiendo(mundo)
    assert mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar").status_code == 200
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar")
    assert r.status_code == 409 and codigo(r) == "estado_no_permite"
    assert r.json()["detail"]["estado"] == "borrador"
    arch = subiendo(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{arch}")
    assert mundo.cliente.post(f"{PREFIJO}/{arch}/cancelar").status_code == 404


def test_confirmar_y_cancelar_a_la_vez_dejan_la_clase_en_un_estado_coherente(mundo):
    id_ = subiendo(mundo, bytes_=500)
    mundo.s3.poner(clave_pedida(mundo), 500)
    tope = threading.Barrier(2)

    def confirmar():
        tope.wait(10)
        return mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={})

    def cancelar():
        tope.wait(10)
        return mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar")
    with ThreadPoolExecutor(2) as pool:
        f1, f2 = pool.submit(confirmar), pool.submit(cancelar)
        rc, rx = f1.result(), f2.result()
    c = clase(mundo, id_)
    if c["estado"] == "subido":          # ganó confirmar
        assert rc.status_code == 200 and rx.status_code == 409
    else:                                # ganó cancelar
        assert c["estado"] == "borrador" and rx.status_code == 200
        assert rc.status_code == 409 and c["bytes"] is None


# ===========================================================================
# 9. la vista previa del video

def test_la_vista_previa_es_una_url_firmada_de_2_horas_nunca_la_del_cdn(mundo):
    id_ = subido(mundo)
    r = mundo.cliente.get(f"{PREFIJO}/{id_}/video")
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    cuerpo = r.json()
    assert set(cuerpo) == {"url", "expira_s"} and cuerpo["expira_s"] == 7200
    assert cuerpo["url"].startswith(f"https://{BUCKET}.s3.amazonaws.com/clases/{id_}/video.mp4?")
    assert "cdn.example" not in cuerpo["url"]
    op, p = mundo.s3.firmadas[-1]
    assert (op, p["Key"], p["ExpiresIn"]) == ("get_object", f"clases/{id_}/video.mp4", 7200)


def test_la_vista_previa_sigue_firmada_aunque_alguien_agregue_clases_a_la_lista_del_cdn(mundo, monkeypatch):
    """El cinturón y los tirantes: `url_media` obedece a la lista de `media_rutas` (agregarle `clases/`
    por error la mandaría por el CDN, que da 403 o, peor, sirve el video sin login). La vista previa usa
    `url_firmada`, que es SIEMPRE S3: no depende de que la lista esté bien."""
    monkeypatch.setattr(media_rutas, "SERVIBLES_CDN", media_rutas.SERVIBLES_CDN + ("clases/",))
    id_ = subido(mundo)
    assert media_sync.url_media(f"clases/{id_}/video.mp4").startswith("https://cdn.example/"), \
        "el sabotaje de la prueba funciona: por `url_media` sí saldría por el CDN"
    url = mundo.cliente.get(f"{PREFIJO}/{id_}/video").json()["url"]
    assert url.startswith(f"https://{BUCKET}.s3.amazonaws.com/clases/{id_}/video.mp4?")
    assert "cdn.example" not in url


def test_la_vista_previa_sirve_tambien_una_clase_archivada(mundo):
    id_ = subido(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{id_}")
    assert mundo.cliente.get(f"{PREFIJO}/{id_}/video").status_code == 200


def test_sin_video_no_hay_vista_previa(mundo):
    for id_ in (nueva(mundo), subiendo(mundo), nueva(mundo, origen="liga", liga="https://vimeo.com/1")):
        r = mundo.cliente.get(f"{PREFIJO}/{id_}/video")
        assert r.status_code == 404 and codigo(r) == "no_existe"
    assert not [l for l in mundo.s3.llamadas if l[0] == "get_object"]


# ===========================================================================
# 10. archivar y restaurar: NADA se borra en S3

def test_archivar_solo_pone_archivada_en_y_el_doble_de_s3_revienta_si_alguien_borra(mundo):
    id_ = subido(mundo)
    n = len(mundo.s3.llamadas)
    r = mundo.cliente.delete(f"{PREFIJO}/{id_}")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert len(mundo.s3.llamadas) == n, "archivar no habla con S3"
    c = clase(mundo, id_)
    assert c["estado"] == "subido", "archivar no cambia el estado"
    assert c["archivada_en"] is not None and (c["bytes"], c["nombre_original"]) == (1000, "clase.mp4")
    assert id_ not in [x["id"] for x in mundo.cliente.get(PREFIJO).json()["clases"]]
    # el doble de S3 es el guardián: delete_object (y todos los delete_*) revientan
    for operacion in ("delete_object", "delete_objects", "delete_object_tagging", "delete_bucket"):
        with pytest.raises(AssertionError, match="NADA se borra en S3"):
            getattr(mundo.s3, operacion)(Bucket=BUCKET, Key=f"clases/{id_}/video.mp4")


def test_archivar_dos_veces_conserva_la_fecha_y_responde_ok(mundo):
    id_ = nueva(mundo)
    assert mundo.cliente.delete(f"{PREFIJO}/{id_}").status_code == 200
    antes = clase(mundo, id_)["archivada_en"]
    assert mundo.cliente.delete(f"{PREFIJO}/{id_}").json() == {"ok": True}
    assert clase(mundo, id_)["archivada_en"] == antes


def test_archivar_una_clase_que_no_existe_es_404(mundo):
    r = mundo.cliente.delete(f"{PREFIJO}/cl-ffffffff")
    assert r.status_code == 404 and codigo(r) == "no_existe"


def test_una_clase_archivada_solo_se_puede_ver_restaurar_o_archivar_otra_vez(mundo):
    id_ = subiendo(mundo)
    mundo.cliente.delete(f"{PREFIJO}/{id_}")
    assert mundo.cliente.patch(f"{PREFIJO}/{id_}", json={"titulo": "x"}).status_code == 404
    assert pedir_subida(mundo, id_).status_code == 404
    assert mundo.cliente.post(f"{PREFIJO}/{id_}/cancelar").status_code == 404
    assert clase(mundo, id_)["estado"] == "subiendo"


def test_restaurar_deja_la_clase_como_estaba(mundo):
    id_ = subido(mundo)
    mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
    mundo.cliente.delete(f"{PREFIJO}/{id_}")
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/restaurar")
    assert r.status_code == 200
    c = r.json()["clase"]
    assert (c["archivada_en"], c["estado"], c["duracion_s"], c["bytes"]) == (None, "subido", 3720.4, 1000)
    assert id_ in [x["id"] for x in mundo.cliente.get(PREFIJO).json()["clases"]]


def test_restaurar_una_viva_es_idempotente_y_una_inexistente_es_404(mundo):
    id_ = nueva(mundo)
    r = mundo.cliente.post(f"{PREFIJO}/{id_}/restaurar")
    assert r.status_code == 200 and r.json()["clase"]["id"] == id_
    r = mundo.cliente.post(f"{PREFIJO}/cl-ffffffff/restaurar")
    assert r.status_code == 404 and codigo(r) == "no_existe"


def test_ninguna_ruta_de_clases_borra_en_s3_en_un_flujo_completo(mundo):
    """Todo el recorrido con el doble estricto: si cualquier ruta llamara algo que no sea firmar o HEAD
    (put, copy, delete…), reventaría."""
    id_ = subido(mundo)
    mundo.cliente.post(f"{PREFIJO}/{id_}/medir")
    mundo.cliente.get(f"{PREFIJO}/{id_}/video")
    mundo.cliente.delete(f"{PREFIJO}/{id_}")
    mundo.cliente.post(f"{PREFIJO}/{id_}/restaurar")
    otra = subiendo(mundo)
    mundo.cliente.post(f"{PREFIJO}/{otra}/cancelar")
    assert {op for op, _ in mundo.s3.llamadas} <= {"put_object", "get_object", "head_object"}


def test_ningun_codigo_del_servidor_borra_en_s3():
    """Guardián estático: el rol de la Lambda no puede borrar (infra/stacks/api.py), así que ni
    `server/`, ni `pipeline/`, ni `worker/` deben pedirlo. Un `delete_object` ahí sería un error en
    producción que ninguna prueba con dobles ve. Se mira el ÁRBOL del código (llamadas, atributos y
    nombres de operación como texto), no la prosa de los docstrings."""
    borrados = re.compile(r"delete_(objects?|object_version|bucket\w*|object_tagging)$", re.I)
    culpables = []
    for carpeta in ("server", "pipeline", "worker"):
        for f in (RAIZ / carpeta).rglob("*.py"):
            for n in ast.walk(ast.parse(f.read_text(encoding="utf-8"))):
                nombre = (n.attr if isinstance(n, ast.Attribute) else n.id if isinstance(n, ast.Name)
                          else n.value if isinstance(n, ast.Constant) and isinstance(n.value, str)
                          and len(n.value) < 40 else "")
                if borrados.match(nombre):
                    culpables.append(f"{f.relative_to(RAIZ)}:{n.lineno}")
    assert not culpables, "algo pide borrar en S3: " + ", ".join(culpables)


def test_el_guardian_estatico_de_borrados_ve_un_delete_object(tmp_path):
    """Si el detector dejara de ver la llamada, la prueba de arriba pasaría siempre."""
    malo = ast.parse("s3.delete_object(Bucket=b, Key=k)\nx = client.generate_presigned_url('delete_object')")
    assert sum(1 for n in ast.walk(malo)
               if isinstance(n, (ast.Attribute, ast.Constant)) and re.match(
                   r"delete_(objects?|object_version|bucket\w*|object_tagging)$",
                   getattr(n, "attr", None) or getattr(n, "value", "") or "")) == 2


def test_las_clases_de_s1_no_llaman_a_ningun_proveedor_de_pago():
    """S1 no gasta: ni AssemblyAI, ni Gemini, ni OpenAI, ni red de ningún tipo."""
    prohibidos = {"openai", "requests", "httpx", "urllib3", "assemblyai", "google", "anthropic", "langfuse"}
    for ruta in ("pipeline/clases.py", "server/clases_admin_api.py"):
        arbol = ast.parse((RAIZ / ruta).read_text(encoding="utf-8"))
        for n in ast.walk(arbol):
            nombres = ([n.module or ""] if isinstance(n, ast.ImportFrom)
                       else [a.name for a in n.names] if isinstance(n, ast.Import) else [])
            for nombre in nombres:
                raiz = nombre.split(".")[0]
                assert raiz not in prohibidos, (ruta, nombre)
                assert not nombre.startswith(("pipeline.llm", "pipeline.embeddings", "pipeline.vectores",
                                              "pipeline.moderacion", "pipeline.apify", "tools.normalizers",
                                              "pipeline.fal", "pipeline.creditos")), (ruta, nombre)
        texto = (RAIZ / ruta).read_text(encoding="utf-8").lower()
        for palabra in ("assemblyai", "gemini", "embeddings", "transcrib"):
            codigo_sin_docstring = re.sub(r'""".*?"""', "", texto, flags=re.S)
            codigo_sin_comentarios = "\n".join(l.split("#", 1)[0] for l in codigo_sin_docstring.splitlines())
            assert palabra not in codigo_sin_comentarios, (ruta, palabra)


# ===========================================================================
# 11. los errores y los logs nunca llevan URLs firmadas, ARNs ni texto de nadie

def _revisar_limpio(texto: str):
    assert FIRMA not in texto and "X-Amz" not in texto, texto[:300]
    assert "arn:aws" not in texto and "191241816158" not in texto, texto[:300]


def test_ningun_error_ni_log_lleva_firmas_arns_ni_el_texto_de_nadie(mundo, caplog):
    secretos = ("TÍTULO-ÚNICO-QUE-NO-SALE-EN-LOGS", "liga-secreta-qwerty", "nombre-secreto-del-archivo")
    caplog.set_level(logging.DEBUG)
    id_ = nueva(mundo, titulo=secretos[0], resumen="resumen secreto xyz")
    liga = nueva(mundo, origen="liga", liga=f"https://{secretos[1]}.example.com/clase")
    textos = []

    def ok(r):
        textos.append(r.text)
        return r
    ok(pedir_subida(mundo, id_, archivo=f"{secretos[2]}.mp4"))
    mundo.s3.poner(clave_pedida(mundo), 1000)
    # cada fallo posible de S3, con un mensaje que trae la firma, un ARN y el nombre del bucket
    for error in (RuntimeError(f"https://x/y?X-Amz-Signature={FIRMA} {ARN}"),
                  ClientError({"Error": {"Code": "AccessDenied", "Message": f"{ARN} {FIRMA}"}}, "HeadObject"),
                  ConnectionError(f"https://{BUCKET}.s3.amazonaws.com/clases/{id_}/video.mp4?X-Amz-Signature={FIRMA}")):
        mundo.s3.error_head = error
        ok(mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={}))
    mundo.s3.error_head = None
    ok(mundo.cliente.post(f"{PREFIJO}/{id_}/confirmar", json={}))
    mundo.medidor.resultado = None
    ok(mundo.cliente.post(f"{PREFIJO}/{id_}/medir"))
    mundo.medidor.resultado = {"duracion_s": 10.0}
    ok(mundo.cliente.post(f"{PREFIJO}/{id_}/medir"))
    ok(mundo.cliente.get(f"{PREFIJO}/{id_}/video"))
    ok(mundo.cliente.patch(f"{PREFIJO}/{liga}", json={"liga": "javascript:alert(1)"}))
    ok(mundo.cliente.delete(f"{PREFIJO}/{id_}"))
    ok(mundo.cliente.post(f"{PREFIJO}/{id_}/restaurar"))
    for t in textos:
        if "X-Amz-Signature" in t:           # las URLs firmadas SOLO salen en la subida y la vista previa
            assert t.count("X-Amz-Signature") == 1 and '"url"' in t
            continue
        _revisar_limpio(t)
    # los logs: nada de URLs firmadas, ARNs ni texto de la persona (título, liga, resumen, nombre del archivo)
    log_total = caplog.text
    _revisar_limpio(log_total)
    for s in secretos + ("resumen secreto",):
        assert s not in log_total, s
    assert id_ in log_total, "el log sí lleva el id de la clase y la transición"


def test_si_la_base_falla_es_503_limpio_sin_el_mensaje_de_la_excepcion(mundo, monkeypatch, caplog):
    def explota(*_a, **_k):
        raise RuntimeError(f'relation "clases" does not exist en {ARN} usando secret arn:aws:secretsmanager:x')
    monkeypatch.setattr(db, "clases_listar", explota)
    monkeypatch.setattr(db, "clases_crear", explota)
    r = mundo.cliente.get(PREFIJO)
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "no_disponible"
    _revisar_limpio(r.text + caplog.text)
    assert "relation" not in r.text
    r, _ = alta(mundo)
    assert r.status_code == 503


def test_sin_migracion_las_tablas_no_existen_y_la_api_dice_503(monkeypatch):
    """El caso real de olvidar `tools/db_migrate.py`: la tabla no existe y el error de Aurora trae ARNs."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")

    def ejecutar(sql, params=None):
        raise RuntimeError(f'BadRequestException: relation "clases" does not exist ({ARN})')
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    from server.app import app
    r = TestClient(app).get(PREFIJO)
    assert r.status_code == 503 and r.json()["detail"]["codigo"] == "no_disponible"
    _revisar_limpio(r.text)


def test_aurora_despertando_sale_como_503_con_reintento(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")

    def ejecutar(sql, params=None):
        raise db.DespertandoError("la base de datos sigue despertando")
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    from server.app import app
    r = TestClient(app).get(PREFIJO)
    assert r.status_code == 503 and r.headers["retry-after"] == "10"


def test_todo_error_propio_tiene_codigo_y_texto_para_mostrar(mundo):
    for r in (pedir_subida(mundo, "cl-ffffffff"), mundo.cliente.delete(f"{PREFIJO}/cl-ffffffff"),
              alta(mundo, numero=0)[0]):
        d = r.json()["detail"]
        assert set(d) >= {"codigo", "texto"} and d["codigo"] in clases_admin_api.ERRORES
        assert d["texto"].strip() and "Traceback" not in d["texto"]
    assert all(isinstance(t, str) and t for _, t in clases_admin_api.ERRORES.values())


# ===========================================================================
# 12. contra Postgres real (se omiten sin COI_PG_SOCK)

def test_pg_el_esquema_corre_dos_veces_y_crea_tablas_e_indices_unicos(pg):
    for s in db.ESQUEMA:
        db.ejecutar(s)
    tablas = {f["table_name"] for f in db.ejecutar(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
    assert set(TABLAS_NUEVAS) <= tablas
    idx = {f["indexname"]: f["indexdef"] for f in db.ejecutar(
        "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'clases'")}
    assert "UNIQUE" in idx["clases_clave"] and "WHERE (clave IS NOT NULL)" in idx["clases_clave"]
    assert "UNIQUE" in idx["clases_vivas"] and "WHERE (archivada_en IS NULL)" in idx["clases_vivas"]


def test_pg_db_migrate_real_crea_las_tablas_nuevas(pg, monkeypatch, capsys):
    import sys
    from tools import db_migrate
    db.ejecutar("DROP TABLE clases_config")
    monkeypatch.setattr(sys, "argv", ["db_migrate.py", "--cluster-arn", "x", "--secret-arn", "y"])
    db_migrate.main()
    salida = capsys.readouterr().out
    assert "clases_config" in salida and re.search(r"Las \d+ tablas del esquema existen", salida)


def test_pg_el_check_de_la_tabla_cierra_el_origen_y_el_numero(pg):
    base = ("INSERT INTO clases (id, numero, titulo, origen, creado_por) "
            "VALUES ('cl-00000001', {n}, 't', '{o}', 'u')")
    for n, o in ((0, "archivo"), (1000, "archivo"), (5, "youtube")):
        with pytest.raises(psycopg.errors.CheckViolation):
            db.ejecutar(base.format(n=n, o=o))


def test_pg_una_sola_gana_por_cada_comparar_y_cambiar_de_estado(pg):
    """El molde de coi_tomar: 16 hilos piden la subida a la vez y gana UNO."""
    db.clases_crear(id_="cl-0000000a", clave="clave-de-prueba-1", numero=1, titulo="t", resumen=None,
                    grabada_en=None, origen="archivo", liga=None, creado_por="u")
    tope = threading.Barrier(16)

    def pedir(i):
        tope.wait(10)
        return db.clases_a_subiendo("cl-0000000a", f"clases/cl-0000000a/video.mp4", f"n{i}.mp4", 100 + i)
    with ThreadPoolExecutor(16) as pool:
        resultados = list(pool.map(pedir, range(16)))
    assert len([r for r in resultados if r is not None]) == 1
    ganadora = next(r for r in resultados if r is not None)
    final = db.clases_obtener("cl-0000000a")
    assert final["bytes"] == ganadora["bytes"] and final["estado"] == "subiendo"


def test_pg_cada_transicion_exige_su_estado_de_origen(pg):
    crear = lambda i, n: db.clases_crear(id_=f"cl-0000000{i}", clave=f"clave-de-prueba-{i}", numero=n,
                                         titulo="t", resumen=None, grabada_en=None, origen="archivo",
                                         liga=None, creado_por="u")[0]["id"]
    a = crear(1, 1)
    k = f"clases/{a}/video.mp4"
    # nada sale de `borrador` salvo la subida
    assert db.clases_cancelar(a) is None
    assert db.clases_confirmar(a, k, 10, 10, None) is None
    assert db.clases_medida(a, k, 5.0) is None and db.clases_medida_fallo(a, k, "x") is False
    assert db.clases_a_subiendo(a, k, "n.mp4", 10)["estado"] == "subiendo"
    # nada sale de `subiendo` salvo confirmar y cancelar
    assert db.clases_a_subiendo(a, k, "n.mp4", 10) is None
    assert db.clases_medida(a, k, 5.0) is None
    assert db.clases_confirmar(a, "clases/otra/video.mp4", 10, 10, None) is None
    assert db.clases_confirmar(a, k, 11, 10, None) is None, "bytes declarados distintos"
    assert db.clases_confirmar(a, k, 10, 10, None)["estado"] == "subido"
    # nada sale de `subido` salvo medir y archivar
    assert db.clases_cancelar(a) is None and db.clases_a_subiendo(a, k, "n.mp4", 10) is None
    assert db.clases_confirmar(a, k, 10, 10, None) is None
    assert db.clases_medida(a, "otra-clave", 5.0) is None
    assert db.clases_medida(a, k, 5.0)["duracion_s"] == 5.0
    # y archivada no se toca nada, salvo restaurar
    assert db.clases_archivar(a) is True
    assert db.clases_medida(a, k, 9.0) is None and db.clases_editar(a, {"titulo": "x"}) is None
    assert db.clases_obtener(a)["estado"] == "subido"
    assert db.clases_restaurar(a)["archivada_en"] is None


def test_pg_la_clave_repetida_en_paralelo_deja_una_fila_y_los_ocho_ven_la_misma(pg):
    tope = threading.Barrier(8)

    def crear(i):
        tope.wait(10)
        return db.clases_crear(id_=clases.id_nuevo(), clave="la-misma-clave-1", numero=3, titulo=f"t{i}",
                               resumen=None, grabada_en=None, origen="archivo", liga=None, creado_por="u")
    with ThreadPoolExecutor(8) as pool:
        rs = list(pool.map(crear, range(8)))
    assert sum(1 for _, creada in rs if creada) == 1
    assert len({c["id"] for c, _ in rs}) == 1
    assert db.ejecutar("SELECT count(*) AS n FROM clases")[0]["n"] == 1


def _competidor_con_numero_sin_confirmar(numero: int, soltar_tras: float = 0.6):
    """Una transacción que inserta la clase con ese número y la confirma `soltar_tras` s después: mientras
    tanto, el índice único espera. Reproduce la carrera que ningún chequeo previo puede ver."""
    listo = threading.Event()

    def hilo():
        with psycopg.connect(host=SOCK, user="postgres", dbname=BASE_PG) as c:
            c.execute("INSERT INTO clases (id, numero, titulo, origen, creado_por) "
                      "VALUES (%s, %s, 'competidor', 'archivo', 'u')", (clases.id_nuevo(), numero))
            listo.set()
            threading.Event().wait(soltar_tras)
            c.commit()
    t = threading.Thread(target=hilo)
    t.start()
    assert listo.wait(10)
    return t


def test_pg_crear_con_un_numero_que_otra_transaccion_esta_tomando_es_numero_repetido(pg):
    t = _competidor_con_numero_sin_confirmar(50)
    with pytest.raises(db.ClaseNumeroRepetido):
        db.clases_crear(id_=clases.id_nuevo(), clave="clave-de-prueba-9", numero=50, titulo="t", resumen=None,
                        grabada_en=None, origen="archivo", liga=None, creado_por="u")
    t.join(10)
    assert db.ejecutar("SELECT count(*) AS n FROM clases")[0]["n"] == 1


def test_pg_editar_el_numero_contra_una_carrera_levanta_numero_repetido_no_un_500(pg):
    otra, _ = db.clases_crear(id_=clases.id_nuevo(), clave="clave-de-prueba-8", numero=7, titulo="t",
                              resumen=None, grabada_en=None, origen="archivo", liga=None, creado_por="u")
    t = _competidor_con_numero_sin_confirmar(50)
    with pytest.raises(db.ClaseNumeroRepetido):
        db.clases_editar(otra["id"], {"numero": 50})
    t.join(10)
    assert db.clases_obtener(otra["id"])["numero"] == 7


def test_pg_restaurar_contra_una_carrera_levanta_numero_repetido(pg):
    a, _ = db.clases_crear(id_=clases.id_nuevo(), clave="clave-de-prueba-7", numero=60, titulo="t",
                           resumen=None, grabada_en=None, origen="archivo", liga=None, creado_por="u")
    db.clases_archivar(a["id"])
    t = _competidor_con_numero_sin_confirmar(60)
    with pytest.raises(db.ClaseNumeroRepetido):
        db.clases_restaurar(a["id"])
    t.join(10)
    assert db.clases_obtener(a["id"])["archivada_en"] is not None


def test_pg_es_duplicado_reconoce_la_violacion_de_psycopg_y_el_texto_del_data_api(pg):
    with pytest.raises(psycopg.errors.UniqueViolation) as e:
        db.ejecutar("INSERT INTO clases (id, numero, titulo, origen, creado_por) VALUES ('cl-aaaaaaa1', 1, 't', 'archivo', 'u')")
        db.ejecutar("INSERT INTO clases (id, numero, titulo, origen, creado_por) VALUES ('cl-aaaaaaa2', 1, 't', 'archivo', 'u')")
    assert db._es_duplicado(e.value)
    assert db._es_duplicado(Exception('BadRequestException: ERROR: duplicate key value violates unique '
                                      'constraint "clases_vivas"'))
    assert not db._es_duplicado(Exception("canceling statement due to statement timeout"))


def test_pg_los_textos_y_las_fechas_viajan_sin_perder_nada(pg):
    c, _ = db.clases_crear(id_="cl-bbbbbbb1", clave="clave-de-prueba-6", numero=12,
                           titulo="Cómo hablarle a la IA · ñandú 日本語 🙂", resumen="Para qué sirve",
                           grabada_en="2026-03-12", origen="liga", liga="https://vimeo.com/1", creado_por="sub-u")
    assert c["titulo"] == "Cómo hablarle a la IA · ñandú 日本語 🙂" and c["grabada_en"] == "2026-03-12"
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", c["creado"]) and c["archivada_en"] is None
    assert db.ejecutar("SELECT creado_por, publicada, indice_version FROM clases")[0] == {
        "creado_por": "sub-u", "publicada": False, "indice_version": 0}


def test_pg_la_lista_va_por_numero_y_las_archivadas_por_fecha(pg):
    ids = {}
    for n in (30, 10, 20):
        c, _ = db.clases_crear(id_=clases.id_nuevo(), clave=f"clave-numero-{n}", numero=n, titulo=f"t{n}",
                               resumen=None, grabada_en=None, origen="archivo", liga=None, creado_por="u")
        ids[n] = c["id"]
    assert [c["numero"] for c in db.clases_listar(False)] == [10, 20, 30]
    db.clases_archivar(ids[30])
    db.clases_archivar(ids[10])
    assert [c["numero"] for c in db.clases_listar(True)] == [10, 30], "la archivada más reciente primero"
    assert [c["numero"] for c in db.clases_listar(False)] == [20]
