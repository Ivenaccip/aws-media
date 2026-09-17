"""M23 C2 — publicar en la nube: reglas por red, el registro de cada
publicación (sin posts dobles), el worker, y los endpoints de Publicar en local
y en el servicio. Sin red: S3, SQS, Blotato y el LLM van simulados."""
import asyncio
import io
import json
import time
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest
from botocore.exceptions import ClientError
from fastapi.testclient import TestClient

from pipeline import blotato, db, jobs, media_sync, publicaciones
from server import editor, publicar_api
from worker import lambda_worker, publicar_task

USER = "u-1"
CLAVE = "blt_clave-de-prueba="


# ---------------------------------------------------------------------------
# dobles

class NoSuchKey(ClientError):
    def __init__(self):
        super().__init__({"Error": {"Code": "NoSuchKey"}}, "GetObject")


class S3Falso:
    """Lo justo de S3: objetos con ETag y escrituras condicionales."""
    exceptions = SimpleNamespace(NoSuchKey=NoSuchKey, ClientError=ClientError)

    def __init__(self):
        self.objetos: dict[str, tuple[bytes, str]] = {}
        self.fechas: dict[str, float] = {}
        self.n = 0
        self.puts = []

    def _etag(self):
        self.n += 1
        return f'"e{self.n}"'

    def get_object(self, Bucket, Key):
        if Key not in self.objetos:
            raise NoSuchKey()
        cuerpo, etag = self.objetos[Key]
        return {"Body": io.BytesIO(cuerpo), "ETag": etag}

    def put_object(self, Bucket, Key, Body, ContentType=None, IfMatch=None, IfNoneMatch=None):
        actual = self.objetos.get(Key)
        if (IfNoneMatch == "*" and actual is not None) or (
                IfMatch is not None and (actual is None or actual[1] != IfMatch)):
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        etag = self._etag()
        self.objetos[Key] = (Body, etag)
        self.fechas[Key] = time.time() + self.n / 1000
        self.puts.append(Key)
        return {"ETag": etag}

    def listar(self, prefijo):
        return [(k, self.fechas[k]) for k in self.objetos if k.startswith(prefijo)]


@pytest.fixture
def s3(monkeypatch):
    falso = S3Falso()
    monkeypatch.setattr(media_sync, "_s3", lambda: falso)
    monkeypatch.setattr(media_sync, "_bucket", lambda: "bucket")
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha", falso.listar)
    return falso


@pytest.fixture
def nube(monkeypatch, s3):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("DEFAULT_USER_ID", USER)
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/cola")
    docs = {"gen-abc": {"flags": {"generado": True}}}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n) if u == USER else None)
    videos = {"videos/gen-abc/pelicula.mp4": (40_000_000, 1000.0),
              "videos/gen-abc/pelicula-subtitulado.mp4": (600_000_000, 2000.0)}
    monkeypatch.setattr(media_sync, "listar_prefijo_con_bytes", lambda pre: [
        (k, tam) for k, (tam, _) in videos.items() if k.startswith(pre)])
    monkeypatch.setattr(media_sync, "listar_prefijo_con_fecha", lambda pre: [
        (k, t) for k, (_, t) in videos.items() if k.startswith(pre)] + s3.listar(pre))
    monkeypatch.setattr(blotato, "clave_de", lambda u: CLAVE if u == USER else None)
    monkeypatch.setattr(blotato, "cuentas", _cuentas_reales)
    enviados = []

    class SQS:
        def send_message(self, QueueUrl, MessageBody):
            enviados.append(json.loads(MessageBody))

    monkeypatch.setattr(jobs, "_sqs", lambda: SQS())
    from server.app import app
    cliente = TestClient(app)
    cliente.enviados = enviados
    cliente.s3 = s3
    cliente.videos = videos
    return cliente


def _cuentas_reales(clave, timeout=None):
    return [{"id": "98432", "platform": p, "fullname": f"Cuenta de {p}", "username": "yo"}
            for p in blotato.REDES]


def _json_s3(s3, prefijo):
    return [json.loads(c) for k, (c, _) in s3.objetos.items() if k.startswith(prefijo)]


def _cuando(segundos: float) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(time.time() + segundos, timezone.utc).isoformat()


TIKTOK = {"confirmar": True, "cuenta_id": "98432", "cuenta_nombre": "Mi TikTok",
          "plataforma": "tiktok", "archivo": "pelicula", "texto": "Hola",
          "privacidad": "PUBLIC_TO_EVERYONE"}


# ---------------------------------------------------------------------------
# reglas por red

def test_cada_red_declara_lo_que_la_pantalla_necesita():
    campos = {"nombre", "texto", "titulo", "titulo_obligatorio", "privacidad", "destino",
              "destino_obligatorio", "ia", "vertical", "mb", "seg", "opciones",
              "sin_signos", "texto_bytes", "hashtags"}
    assert set(blotato.REDES) == {"tiktok", "youtube", "instagram", "facebook", "linkedin",
                                  "pinterest", "threads", "twitter", "bluesky"}
    for red in blotato.REDES.values():
        assert set(red) == campos
        json.dumps(red)                      # viaja tal cual en /estado
    assert blotato.REDES["twitter"]["texto"] == 280


def test_tiktok_lleva_los_siete_campos_y_la_marca_de_ia():
    t = blotato.target_de("tiktok", {"privacidad": "SELF_ONLY", "comentarios": False,
                                     "marca_propia": True, "ia": True})
    assert t == {"targetType": "tiktok", "privacyLevel": "SELF_ONLY",
                 "disabledComments": True, "disabledDuet": False, "disabledStitch": False,
                 "isBrandedContent": False, "isYourBrand": True, "isAiGenerated": True}
    assert blotato.target_de("tiktok", {"privacidad": "SELF_ONLY", "ia": False})[
        "isAiGenerated"] is False


@pytest.mark.parametrize("plataforma,datos,parte", [
    ("tiktok", {}, "quién puede ver"),                          # sin valor por defecto
    ("tiktok", {"privacidad": "PUBLICO"}, "quién puede ver"),
    ("tiktok", {"privacidad": "SELF_ONLY", "marca_pagada": True}, "Solo yo"),
    ("youtube", {"privacidad": "public"}, "pide un título"),
    ("youtube", {"titulo": "Hola", "privacidad": None}, "quién puede ver"),
    ("youtube", {"titulo": "x" * 101, "privacidad": "public"}, "100 caracteres"),
    ("youtube", {"titulo": "<b>hola</b>", "privacidad": "public"}, "< ni >"),
    ("facebook", {}, "la página"),
    ("facebook", {"destino": "abc"}, "No reconocemos"),
    ("pinterest", {}, "el tablero"),
    ("pinterest", {"destino": "../x"}, "No reconocemos"),
    ("myspace", {}, "no se puede usar"),
])
def test_target_explica_lo_que_falta(plataforma, datos, parte):
    with pytest.raises(ValueError) as e:
        blotato.target_de(plataforma, datos)
    assert parte in str(e.value)


def test_target_de_las_demas_redes():
    assert blotato.target_de("youtube", {"titulo": "  Mi   video ", "privacidad": "unlisted"}) == {
        "targetType": "youtube", "title": "Mi video", "privacyStatus": "unlisted",
        "shouldNotifySubscribers": True, "isMadeForKids": False,
        "containsSyntheticMedia": True}
    assert blotato.target_de("facebook", {"destino": "123"}) == {
        "targetType": "facebook", "pageId": "123", "mediaType": "reel"}
    assert blotato.target_de("instagram", {}) == {"targetType": "instagram", "mediaType": "reel"}
    assert blotato.target_de("linkedin", {}) == {"targetType": "linkedin"}   # perfil personal
    assert blotato.target_de("linkedin", {"destino": "org-9"})["pageId"] == "org-9"
    assert blotato.target_de("pinterest", {"destino": "b1", "titulo": "T"}) == {
        "targetType": "pinterest", "boardId": "b1", "title": "T"}
    for red in ("threads", "twitter", "bluesky"):
        assert blotato.target_de(red, {"titulo": "ignorado"}) == {"targetType": red}


def test_explicar_fallo_usa_el_mensaje_de_blotato_sin_la_clave():
    resp = httpx.Response(422, json={"message": f"target.title: vacío {CLAVE}"},
                          request=httpx.Request("POST", "https://x"))
    err = httpx.HTTPStatusError("x", request=resp.request, response=resp)
    msg, reconectar = blotato.explicar_fallo(err, CLAVE)
    assert "target.title" in msg and CLAVE not in msg and reconectar is False
    resp = httpx.Response(429, text="no json", request=resp.request)
    msg, _ = blotato.explicar_fallo(httpx.HTTPStatusError("x", request=resp.request,
                                                          response=resp))
    assert "esperar" in msg


# ---------------------------------------------------------------------------
# subida en streaming

def test_la_subida_va_por_trozos_con_content_length_y_sin_chunked(monkeypatch):
    llamadas = {}

    def post(url, headers, json, timeout):
        llamadas["post"] = (url, json)
        return httpx.Response(201, json={"presignedUrl": "https://sube/aqui?firma=1",
                                         "publicUrl": "https://database.blotato.com/v.mp4"},
                              request=httpx.Request("POST", url))

    def put(url, content, headers, timeout):
        # así arma httpx la petición real: con Content-Length explícito no
        # agrega Transfer-Encoding (una URL prefirmada lo rechaza)
        req = httpx.Request("PUT", url, content=content, headers=headers)
        llamadas["put"] = req
        llamadas["cuerpo"] = b"".join(req.stream)
        return httpx.Response(200, request=req)

    monkeypatch.setattr(blotato.httpx, "post", post)
    monkeypatch.setattr(blotato.httpx, "put", put)
    partes = (bytes([i]) * 3 for i in range(4))           # un generador: nunca en memoria
    url = blotato.subir_stream(CLAVE, "gen-abc-pelicula.mp4", partes, 12)
    assert url == "https://database.blotato.com/v.mp4"
    assert llamadas["post"][1] == {"filename": "gen-abc-pelicula.mp4"}
    req = llamadas["put"]
    assert req.headers["content-length"] == "12"
    assert "transfer-encoding" not in req.headers
    assert req.headers["content-type"] == "video/mp4"
    assert llamadas["cuerpo"] == b"\x00\x00\x00\x01\x01\x01\x02\x02\x02\x03\x03\x03"


def test_la_subida_rechaza_una_respuesta_sin_urls(monkeypatch):
    monkeypatch.setattr(blotato.httpx, "post", lambda *a, **k: httpx.Response(
        201, json={"presignedUrl": "http://inseguro"}, request=httpx.Request("POST", "https://x")))
    with pytest.raises(blotato.RespuestaInvalida):
        blotato.subir_stream(CLAVE, "v.mp4", iter([b"x"]), 1)


def test_estado_post_valida_el_id_y_la_respuesta(monkeypatch):
    with pytest.raises(ValueError):
        blotato.estado_post(CLAVE, "../../users")
    monkeypatch.setattr(blotato.httpx, "get", lambda url, headers, timeout: httpx.Response(
        200, json={"status": "raro"}, request=httpx.Request("GET", url)))
    with pytest.raises(blotato.RespuestaInvalida):
        blotato.estado_post(CLAVE, "p-1")


# ---------------------------------------------------------------------------
# el registro: nada se publica dos veces

@pytest.fixture
def en_s3(monkeypatch, s3):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    return s3


def test_reclamar_es_de_un_solo_intento(en_s3):
    reg = publicaciones.crear(USER, "gen-abc", {"plataforma": "twitter"})
    assert en_s3.objetos  # quedó en usuarios/<user>/..., no en videos/
    assert all(k.startswith(f"usuarios/{USER}/publicaciones/gen-abc/") for k in en_s3.objetos)
    primero = publicaciones.reclamar(USER, "gen-abc", reg["id"])
    assert primero and primero[0]["estado"] == "subiendo"
    assert publicaciones.reclamar(USER, "gen-abc", reg["id"]) is None


def test_dos_reclamos_a_la_vez_solo_gana_uno(en_s3, monkeypatch):
    reg = publicaciones.crear(USER, "gen-abc", {"plataforma": "twitter"})
    leido = publicaciones.leer(USER, "gen-abc", reg["id"])
    # el otro intento lee lo mismo antes de que el primero escriba
    monkeypatch.setattr(publicaciones, "leer", lambda *a: (dict(leido[0]), leido[1]))
    assert publicaciones.reclamar(USER, "gen-abc", reg["id"]) is not None
    assert publicaciones.reclamar(USER, "gen-abc", reg["id"]) is None


def test_una_pendiente_vencida_ya_no_se_publica(en_s3, monkeypatch):
    reg = publicaciones.crear(USER, "gen-abc", {"plataforma": "twitter"})
    monkeypatch.setattr(publicaciones, "ahora",
                        lambda: reg["creado"] + publicaciones.VENCE_PENDIENTE_S + 1)
    assert publicaciones.reclamar(USER, "gen-abc", reg["id"]) is None
    guardado, _ = publicaciones.leer(USER, "gen-abc", reg["id"])
    assert guardado["estado"] == "error"


def test_crear_no_pisa_una_existente(en_s3, monkeypatch):
    monkeypatch.setattr(publicaciones, "nuevo_id", lambda: "a" * 12)
    publicaciones.crear(USER, "gen-abc", {"plataforma": "tiktok"})
    with pytest.raises(publicaciones.Conflicto):
        publicaciones.crear(USER, "gen-abc", {"plataforma": "youtube"})
    assert publicaciones.leer(USER, "gen-abc", "a" * 12)[0]["plataforma"] == "tiktok"


def test_el_candado_deja_pasar_solo_una_publicacion_igual(en_s3):
    uno = publicaciones.crear(USER, "gen-abc", {}, candado="pelicula|1|tiktok")
    with pytest.raises(publicaciones.EnCurso):
        publicaciones.crear(USER, "gen-abc", {}, candado="pelicula|1|tiktok")
    # la rechazada no aparece en la lista
    assert [r["id"] for r, _ in publicaciones.listar(USER, "gen-abc")] == [uno["id"]]
    otra = publicaciones.crear(USER, "gen-abc", {}, candado="pelicula|1|youtube")
    # cuando la primera termina, el candado se puede volver a tomar
    reg, etag = publicaciones.leer(USER, "gen-abc", uno["id"])
    publicaciones.guardar(USER, "gen-abc", dict(reg, estado="publicado"), etag)
    tercera = publicaciones.crear(USER, "gen-abc", {}, candado="pelicula|1|tiktok")
    assert len({uno["id"], otra["id"], tercera["id"]}) == 3


def test_en_una_carrera_el_candado_lo_gana_uno_solo(en_s3, monkeypatch):
    """Los dos registros ya existen cuando se pelean el candado."""
    ids = iter(["a" * 12, "b" * 12])
    monkeypatch.setattr(publicaciones, "nuevo_id", lambda: next(ids))
    original = publicaciones._tomar_candado
    orden = []

    def tomar(user, proyecto, candado, pub_id):
        orden.append(pub_id)
        if pub_id == "a" * 12:
            # mientras «a» llega al candado, «b» se crea y lo toma primero
            publicaciones.crear(USER, "gen-abc", {}, candado=candado)
        return original(user, proyecto, candado, pub_id)

    monkeypatch.setattr(publicaciones, "_tomar_candado", tomar)
    with pytest.raises(publicaciones.EnCurso):
        publicaciones.crear(USER, "gen-abc", {}, candado="k")
    assert orden == ["a" * 12, "b" * 12]
    estados = {r["id"]: r["estado"] for r in _json_s3(en_s3, "usuarios/u-1/publicaciones/")}
    assert estados == {"a" * 12: "duplicado", "b" * 12: "pendiente"}
    assert [r["id"] for r, _ in publicaciones.listar(USER, "gen-abc")] == ["b" * 12]


def test_el_candado_reconoce_su_propia_escritura(en_s3, monkeypatch):
    original = en_s3.put_object
    veces = []

    def put(**k):
        r = original(**k)
        if "publicaciones-candados" in k["Key"] and not veces:
            veces.append(1)           # se guardó y el reintento de botocore da 412
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        return r

    monkeypatch.setattr(en_s3, "put_object", put)
    reg = publicaciones.crear(USER, "gen-abc", {}, candado="k")
    assert publicaciones.leer(USER, "gen-abc", reg["id"])[0]["estado"] == "pendiente"


def test_si_el_candado_falla_la_publicacion_no_queda_colgada(en_s3, monkeypatch):
    original = en_s3.put_object
    fallar = [True]

    def put(**k):
        if "publicaciones-candados" in k["Key"] and fallar[0]:
            raise ClientError({"Error": {"Code": "SlowDown"}}, "PutObject")
        return original(**k)

    monkeypatch.setattr(en_s3, "put_object", put)
    with pytest.raises(ClientError):
        publicaciones.crear(USER, "gen-abc", {}, candado="k")
    assert publicaciones.listar(USER, "gen-abc") == []
    assert publicaciones.en_camino(USER) == 0
    fallar[0] = False
    publicaciones.crear(USER, "gen-abc", {}, candado="k")        # el siguiente intento pasa


def test_un_doble_clic_no_escribe_un_registro_nuevo(en_s3):
    publicaciones.crear(USER, "gen-abc", {}, candado="k")
    antes = len(en_s3.puts)
    for _ in range(5):
        with pytest.raises(publicaciones.EnCurso):
            publicaciones.crear(USER, "gen-abc", {}, candado="k")
    assert len(en_s3.puts) == antes


def test_crear_sobrevive_al_reintento_de_botocore(en_s3, monkeypatch):
    original = en_s3.put_object
    veces = []

    def put(**k):
        original(**k)
        if not veces:
            veces.append(1)          # se escribió, pero la respuesta se perdió
            raise ClientError({"Error": {"Code": "PreconditionFailed"}}, "PutObject")
        return {"ETag": "x"}

    monkeypatch.setattr(en_s3, "put_object", put)
    reg = publicaciones.crear(USER, "gen-abc", {"plataforma": "twitter"})
    assert publicaciones.leer(USER, "gen-abc", reg["id"])[0]["estado"] == "pendiente"


def test_en_camino_cuenta_las_de_todos_los_proyectos(en_s3):
    for proyecto in ("gen-abc", "gen-def"):
        publicaciones.crear(USER, proyecto, {})
    hecha = publicaciones.crear(USER, "gen-abc", {})
    reg, etag = publicaciones.leer(USER, "gen-abc", hecha["id"])
    publicaciones.guardar(USER, "gen-abc", dict(reg, estado="publicado"), etag)
    publicaciones.crear("otro", "gen-abc", {})
    assert publicaciones.en_camino(USER) == 2


def test_el_reemplazo_local_aguanta_un_archivo_abierto(monkeypatch, tmp_path):
    from pipeline import storage
    monkeypatch.setenv("STATE_BACKEND", "json")
    monkeypatch.setattr(storage, "videos_root", lambda: tmp_path)
    monkeypatch.setattr(publicaciones, "videos_root", lambda: tmp_path)
    (tmp_path / "v1").mkdir()
    original = Path.replace
    fallos = [PermissionError(5, "en uso")] * 2

    def replace(self, destino):
        if fallos:
            raise fallos.pop()
        return original(self, destino)

    monkeypatch.setattr(Path, "replace", replace)
    reg = publicaciones.crear(USER, "v1", {})
    assert publicaciones.leer(USER, "v1", reg["id"])[0]["estado"] == "pendiente"


def test_ids_y_usuarios_raros_no_llegan_a_la_ruta(en_s3):
    for user, proyecto, pub in [("../otro", "gen-abc", "a" * 12),
                                (USER, "../x", "a" * 12),
                                (USER, "gen-abc", "../../x")]:
        with pytest.raises(ValueError):
            publicaciones.leer(user, proyecto, pub)


def test_el_registro_local_tambien_es_condicional(monkeypatch, tmp_path):
    from pipeline import storage
    monkeypatch.setenv("STATE_BACKEND", "json")
    monkeypatch.setattr(storage, "videos_root", lambda: tmp_path)
    (tmp_path / "v1").mkdir()
    reg = publicaciones.crear(USER, "v1", {"plataforma": "twitter"})
    assert (tmp_path / "v1" / "work" / "publicaciones" / f"{reg['id']}.json").is_file()
    assert publicaciones.reclamar(USER, "v1", reg["id"]) is not None
    assert publicaciones.reclamar(USER, "v1", reg["id"]) is None
    _, etag = publicaciones.leer(USER, "v1", reg["id"])
    publicaciones.guardar(USER, "v1", dict(reg, estado="creando"), etag)
    with pytest.raises(publicaciones.Conflicto):
        publicaciones.guardar(USER, "v1", dict(reg, estado="otro"), etag)
    assert [r["id"] for r, _ in publicaciones.listar(USER, "v1")] == [reg["id"]]


@pytest.mark.parametrize("estado,edad,esperado,en_curso", [
    ("pendiente", 60, "pendiente", True),
    ("pendiente", publicaciones.VENCE_PENDIENTE_S + 120, "error", False),
    ("subiendo", 60, "subiendo", True),
    ("subiendo", publicaciones.VENCE_TRABAJO_S + 1, "error", False),     # no se creó nada
    ("creando", publicaciones.VENCE_TRABAJO_S + 1, "incierto", False),   # quizá sí
    ("enviado", 60, "enviado", True),
    # con id de post se sigue preguntando (más espaciado), no se da por perdida
    ("enviado", publicaciones.SIN_RESPUESTA_S + 1, "enviado", False),
    ("publicado", 60, "publicado", False),
])
def test_la_vista_resuelve_los_estados_viejos(estado, edad, esperado, en_curso):
    t = 1_000_000.0
    reg = {"id": "a" * 12, "estado": estado, "creado": t - edad, "actualizado": t - edad,
           "archivo_key": "videos/x/pelicula.mp4", "opciones": {}, "url": "https://v",
           "post_id": "p1"}
    v = publicaciones.vista(reg, t)
    assert (v["estado"], v["en_curso"]) == (esperado, en_curso)
    assert "archivo_key" not in v and "opciones" not in v
    assert v["url"] == ("https://v" if esperado == "publicado" else None)


def test_una_programada_se_vuelve_a_consultar_cuando_pasa_su_hora():
    t = time.time()
    reg = {"id": "a" * 12, "estado": "programado", "creado": t - 999, "post_id": "p1",
           "cuando": _cuando(-120)}
    assert publicaciones.vista(reg, t)["en_curso"] is True
    assert publicaciones.por_consultar(reg, t)
    reg["cuando"] = _cuando(3600)
    assert publicaciones.vista(reg, t)["en_curso"] is False
    assert not publicaciones.por_consultar(reg, t)


def test_una_programada_que_blotato_esta_subiendo_sigue_programada():
    t = time.time()
    reg = {"id": "a" * 12, "estado": "programado", "creado": t - 2 * 86400,
           "post_id": "p1", "cuando": _cuando(-120)}
    publicaciones.aplicar_estado(reg, {"status": "in-progress"})
    v = publicaciones.vista(reg, t)
    assert (v["estado"], v["en_curso"]) == ("programado", True)
    reg["consultado"] = t
    assert publicaciones.por_consultar(reg, t + 60)


def test_nunca_se_deja_de_preguntar_por_un_post_con_id():
    t = time.time()
    viejo = t - 3 * 86400
    reg = {"id": "a" * 12, "estado": "programado", "creado": viejo - 3600, "post_id": "p1",
           "cuando": _cuando(-2 * 86400), "consultado": t - 60}
    assert not publicaciones.por_consultar(reg, t)            # espaciado: cada 10 min
    reg["consultado"] = t - publicaciones.CONSULTA_LENTA_S - 1
    assert publicaciones.por_consultar(reg, t)
    assert publicaciones.vista(reg, t)["revisar"] is True
    enviado = {"id": "b" * 12, "estado": "enviado", "creado": viejo, "post_id": "p2"}
    v = publicaciones.vista(enviado, t)
    assert (v["estado"], v["en_curso"], v["revisar"]) == ("enviado", False, True)
    assert "todavía no confirma" in v["mensaje"]
    sin_id = {"id": "c" * 12, "estado": "enviado", "creado": t}
    assert publicaciones.vista(sin_id, t)["estado"] == "incierto"


def test_aplicar_estado():
    reg = {"estado": "enviado"}
    assert publicaciones.aplicar_estado(reg, {"status": "published",
                                              "publicUrl": "https://tiktok.com/v/1"})
    assert reg["estado"] == "publicado" and reg["url"] == "https://tiktok.com/v/1"
    reg = {"estado": "enviado"}
    publicaciones.aplicar_estado(reg, {"status": "published", "publicUrl": "javascript:x"})
    assert reg["url"] is None
    reg = {"estado": "enviado"}
    publicaciones.aplicar_estado(reg, {"status": "failed", "errorMessage": "cuota\n diaria"})
    assert reg["estado"] == "fallido" and "cuota diaria." in reg["error"]
    assert reg["error"].endswith("Puedes intentarlo de nuevo.")
    reg = {"estado": "enviado"}
    assert not publicaciones.aplicar_estado(reg, {"status": "in-progress"})


def test_refrescar_pregunta_pocas_y_no_se_cae(en_s3, monkeypatch):
    t = time.time()
    filas = []
    for i in range(5):
        reg = publicaciones.crear(USER, "gen-abc", {})
        reg.update(estado="enviado", post_id=f"p{i}")
        etag = publicaciones.guardar(USER, "gen-abc", reg)
        filas.append((reg, etag))
    preguntas = []

    def estado_post(clave, post_id, timeout=None):
        preguntas.append(post_id)
        if post_id == "p0":
            raise httpx.ConnectError("sin red")
        return {"status": "published", "publicUrl": "https://x/v"}

    monkeypatch.setattr(blotato, "estado_post", estado_post)
    publicaciones.refrescar(USER, "gen-abc", CLAVE, filas)
    assert preguntas == ["p0", "p1", "p2"]                 # máximo 3 por petición
    estados = {r["post_id"]: r["estado"] for r in _json_s3(en_s3, "usuarios/")}
    assert estados["p1"] == "publicado" and estados["p0"] == "enviado"
    # recién consultadas: no se vuelve a preguntar enseguida
    preguntas.clear()
    publicaciones.refrescar(USER, "gen-abc", CLAVE, filas)
    assert preguntas == ["p3", "p4"]         # la que falló también quedó consultada
    assert t  # noqa: B018


def test_refrescar_marca_incierta_una_que_blotato_no_encuentra(en_s3, monkeypatch):
    reg = publicaciones.crear(USER, "gen-abc", {})
    reg.update(estado="enviado", post_id="p9")
    etag = publicaciones.guardar(USER, "gen-abc", reg)

    def no_existe(clave, post_id, timeout=None):
        resp = httpx.Response(404, request=httpx.Request("GET", "https://x"))
        raise httpx.HTTPStatusError("x", request=resp.request, response=resp)

    monkeypatch.setattr(blotato, "estado_post", no_existe)
    publicaciones.refrescar(USER, "gen-abc", CLAVE, [(reg, etag)])
    assert publicaciones.leer(USER, "gen-abc", reg["id"])[0]["estado"] == "incierto"


# ---------------------------------------------------------------------------
# el worker

@pytest.fixture
def worker(monkeypatch, en_s3):
    """Blotato simulado + un video en memoria."""
    monkeypatch.setattr(publicar_task, "ESPERA_RESULTADO_S", 0.2)
    monkeypatch.setattr(publicar_task, "ESPERA_ENTRE_S", 0)
    monkeypatch.setattr(publicar_task.time, "sleep", lambda s: None)
    monkeypatch.setattr(blotato, "clave_de", lambda u: CLAVE)
    monkeypatch.setattr(blotato, "cuentas", _cuentas_reales)
    llamadas = {"subir": [], "publicar": [], "estado": []}

    def subir(clave, nombre, partes, tam):
        llamadas["subir"].append((nombre, b"".join(partes), tam))
        return "https://database.blotato.com/v.mp4"

    def publicar(clave, cuenta, plataforma, texto, media, scheduled_time=None, target=None):
        llamadas["publicar"].append({"cuenta": cuenta, "plataforma": plataforma, "texto": texto,
                                     "media": media, "cuando": scheduled_time, "target": target})
        return {"postSubmissionId": "post-1"}

    def estado_post(clave, post_id, timeout=None):
        llamadas["estado"].append(post_id)
        return {"status": "published", "publicUrl": "https://x.com/v/1"}

    monkeypatch.setattr(blotato, "subir_stream", subir)
    monkeypatch.setattr(blotato, "publicar", publicar)
    monkeypatch.setattr(blotato, "estado_post", estado_post)
    monkeypatch.setattr(publicar_task, "sondear", lambda fuente: None)
    return llamadas


def _video(reg=None):
    from contextlib import contextmanager

    @contextmanager
    def abrir():
        yield iter([b"abc", b"def"])

    return publicar_task.Video("pelicula.mp4", 6, abrir, None)


def _pendiente(plataforma="tiktok", **extra):
    opciones = {"privacidad": "PUBLIC_TO_EVERYONE", "ia": True, **extra.pop("opciones", {})}
    return publicaciones.crear(USER, "gen-abc", {
        "plataforma": plataforma, "cuenta_id": "98432", "texto": "Hola",
        "archivo": "pelicula", "archivo_key": "videos/gen-abc/pelicula.mp4",
        "opciones": opciones, "cuando": None, **extra})


def _estado(pub_id):
    return publicaciones.leer(USER, "gen-abc", pub_id)[0]


def test_publicar_ahora_sube_crea_y_espera_el_resultado(worker):
    reg = _pendiente()
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [("gen-abc-pelicula.mp4", b"abcdef", 6)]
    [post] = worker["publicar"]
    assert post["media"] == ["https://database.blotato.com/v.mp4"]
    assert post["target"]["privacyLevel"] == "PUBLIC_TO_EVERYONE"
    assert post["target"]["isAiGenerated"] is True and post["cuando"] is None
    final = _estado(reg["id"])
    assert (final["estado"], final["post_id"], final["url"]) == (
        "publicado", "post-1", "https://x.com/v/1")


def test_programar_no_espera_y_queda_programada(worker):
    reg = _pendiente(cuando="2026-12-01T15:00:00+00:00")
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["publicar"][0]["cuando"] == "2026-12-01T15:00:00+00:00"
    assert worker["estado"] == []
    assert _estado(reg["id"])["estado"] == "programado"


def test_un_segundo_intento_no_hace_nada(worker):
    reg = _pendiente()
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert len(worker["subir"]) == 1 and len(worker["publicar"]) == 1


def test_si_otro_toca_el_registro_antes_de_crear_no_se_publica(worker, monkeypatch):
    reg = _pendiente()
    original = blotato.subir_stream

    def subir_y_pisar(*a):
        url = original(*a)
        guardado, _ = publicaciones.leer(USER, "gen-abc", reg["id"])
        publicaciones.guardar(USER, "gen-abc", dict(guardado, nota="otro"))
        return url

    monkeypatch.setattr(blotato, "subir_stream", subir_y_pisar)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["publicar"] == []


def _http(codigo, cuerpo=None):
    req = httpx.Request("POST", "https://backend.blotato.com/v2/posts")
    resp = httpx.Response(codigo, json=cuerpo or {}, request=req)
    return httpx.HTTPStatusError("x", request=req, response=resp)


@pytest.mark.parametrize("fallo,estado", [
    (_http(422, {"message": "target.privacyLevel is required"}), "error"),
    (_http(429), "error"),
    (_http(500), "incierto"),
    (httpx.ReadTimeout("lento"), "incierto"),
    (RuntimeError("otra cosa"), "incierto"),
])
def test_si_blotato_falla_al_crear_se_sabe_si_se_puede_reintentar(worker, monkeypatch,
                                                                  fallo, estado):
    reg = _pendiente()

    def publicar(*a, **k):
        raise fallo

    monkeypatch.setattr(blotato, "publicar", publicar)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)   # no lanza
    final = _estado(reg["id"])
    assert final["estado"] == estado
    if isinstance(fallo, httpx.HTTPStatusError) and fallo.response.status_code == 422:
        assert "privacyLevel" in final["error"]
    assert publicaciones.vista(final)["en_curso"] is False


def test_sin_post_id_queda_incierta(worker, monkeypatch):
    reg = _pendiente()
    monkeypatch.setattr(blotato, "publicar", lambda *a, **k: {"otra": "cosa"})
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert _estado(reg["id"])["estado"] == "incierto"


def test_si_la_subida_falla_no_se_crea_nada(worker, monkeypatch):
    reg = _pendiente()

    def subir(*a):
        raise httpx.ConnectError("sin red")

    monkeypatch.setattr(blotato, "subir_stream", subir)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["publicar"] == []
    final = _estado(reg["id"])
    assert final["estado"] == "error" and "Blotato no respondió" in final["error"]


def test_sin_clave_no_se_sube_nada(worker, monkeypatch):
    reg = _pendiente()
    monkeypatch.setattr(blotato, "clave_de", lambda u: None)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [] and "Conecta" in _estado(reg["id"])["error"]


def test_un_video_horizontal_no_va_a_instagram(worker, monkeypatch):
    reg = _pendiente("instagram", opciones={})
    monkeypatch.setattr(publicar_task, "sondear",
                        lambda f: {"ancho": 1920, "alto": 1080, "segundos": 30})
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == []
    assert "vertical" in _estado(reg["id"])["error"]


def test_un_video_largo_no_va_a_x(worker, monkeypatch):
    reg = _pendiente("twitter", opciones={})
    monkeypatch.setattr(publicar_task, "sondear",
                        lambda f: {"ancho": 1080, "alto": 1920, "segundos": 200})
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [] and "2:20 min" in _estado(reg["id"])["error"]


def test_el_worker_nunca_relanza_despues_de_reclamar(worker, monkeypatch):
    reg = _pendiente()

    def roto(*a, **k):
        raise KeyError("cualquier cosa")

    monkeypatch.setattr(publicar_task, "revisar_video", roto)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)   # no lanza
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video, relanzar_reclamo=True)
    assert worker["publicar"] == []


def test_si_no_se_puede_reclamar_reintenta_y_solo_la_cola_relanza(worker, monkeypatch):
    intentos = []

    def reclamar(*a):
        intentos.append(1)
        raise RuntimeError("S3 caído")

    monkeypatch.setattr(publicaciones, "reclamar", reclamar)
    publicar_task.ejecutar(USER, "gen-abc", "a" * 12, _video)     # local: no lanza
    assert len(intentos) == 3
    with pytest.raises(RuntimeError):                             # SQS: reintento seguro
        publicar_task.ejecutar(USER, "gen-abc", "a" * 12, _video, relanzar_reclamo=True)


def test_un_fallo_pasajero_al_reclamar_no_pierde_la_publicacion(worker, monkeypatch):
    reg = _pendiente()
    original = publicaciones.reclamar
    fallos = [RuntimeError("503"), RuntimeError("503")]

    def reclamar(*a):
        if fallos:
            raise fallos.pop()
        return original(*a)

    monkeypatch.setattr(publicaciones, "reclamar", reclamar)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert len(worker["publicar"]) == 1


def test_una_cuenta_desconectada_no_sube_nada(worker, monkeypatch):
    reg = _pendiente()
    monkeypatch.setattr(blotato, "cuentas", lambda c, timeout=None: [
        {"id": "otra", "platform": "tiktok"}, {"id": "98432", "platform": "youtube"}])
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [] and "ya no está conectada" in _estado(reg["id"])["error"]


def test_una_programada_cuya_hora_paso_en_la_fila_no_se_publica(worker):
    reg = _pendiente(cuando=_cuando(10))
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [] and "hora programada" in _estado(reg["id"])["error"]


def test_un_texto_invalido_no_sube_nada(worker):
    reg = _pendiente("instagram", opciones={}, texto="#a #b #c #d #e #f")
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["subir"] == [] and "hashtags" in _estado(reg["id"])["error"]


def _video_lento(trozos, avanza_s, reloj, al_final=None):
    """Un video cuyo consumo adelanta el reloj de publicaciones."""
    from contextlib import contextmanager

    @contextmanager
    def abrir():
        def partes():
            for _ in range(trozos):
                reloj["t"] += avanza_s
                yield b"x"
        yield partes()

    return lambda reg: publicar_task.Video("pelicula.mp4", trozos, abrir, None)


def test_una_subida_larga_sin_latido_no_se_publica(worker, monkeypatch):
    """En local no hay tope de 15 min: si la pantalla ya pudo decir «no se
    publicó nada», el worker no publica (post doble al reintentar)."""
    reloj = {"t": time.time()}
    monkeypatch.setattr(publicaciones, "ahora", lambda: reloj["t"])
    monkeypatch.setattr(publicar_task, "LATIDO_S", 10 ** 9)          # sin latido
    reg = _pendiente()
    video_de = _video_lento(1, publicaciones.VENCE_TRABAJO_S + 60, reloj)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], video_de)
    assert worker["publicar"] == []
    final = _estado(reg["id"])
    assert final["estado"] == "error" and "tardó demasiado" in final["error"]


def test_el_latido_mantiene_viva_una_subida_larga(worker, monkeypatch):
    reloj = {"t": time.time()}
    monkeypatch.setattr(publicaciones, "ahora", lambda: reloj["t"])
    monkeypatch.setattr(publicar_task, "LATIDO_S", 0)                # latido en cada trozo
    reg = _pendiente()
    vistas = []

    def subir(clave, nombre, partes, tam):
        for i, _ in enumerate(partes):
            if i == 24:                       # a los 25 min de subida
                vistas.append(publicaciones.vista(_estado(reg["id"]), reloj["t"]))
        return "https://database.blotato.com/v.mp4"

    monkeypatch.setattr(blotato, "subir_stream", subir)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video_lento(30, 60, reloj))
    assert vistas[0]["estado"] == "subiendo" and vistas[0]["en_curso"] is True
    assert len(worker["publicar"]) == 1


def test_un_latido_que_no_se_guarda_no_renueva_el_plazo(worker, monkeypatch):
    """Si el latido falla (disco, S3), la pantalla ve la hora vieja: el worker
    tiene que medir el plazo desde la misma."""
    reloj = {"t": time.time()}
    monkeypatch.setattr(publicaciones, "ahora", lambda: reloj["t"])
    monkeypatch.setattr(publicar_task, "LATIDO_S", 0)
    reg = _pendiente()
    original = publicaciones._escribir
    reclamado = []

    def escribir(user, proyecto, r, etag=None, nuevo=False):
        if r.get("estado") == "subiendo" and etag:
            if reclamado:                       # el reclamo pasa; los latidos, no
                raise PermissionError(5, "en uso")
            reclamado.append(1)
        return original(user, proyecto, r, etag, nuevo)

    monkeypatch.setattr(publicaciones, "_escribir", escribir)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video_lento(25, 60, reloj))
    assert worker["publicar"] == []
    assert "tardó demasiado" in _estado(reg["id"])["error"]


def test_si_otro_toca_el_registro_durante_la_subida_se_corta(worker, monkeypatch):
    monkeypatch.setattr(publicar_task, "LATIDO_S", 0)
    reg = _pendiente()

    consumidos = []

    def subir(clave, nombre, partes, tam):
        guardado, _ = publicaciones.leer(USER, "gen-abc", reg["id"])
        publicaciones.guardar(USER, "gen-abc", dict(guardado, estado="error", error="otro"))
        for trozo in partes:
            consumidos.append(trozo)
        return "https://database.blotato.com/v.mp4"

    monkeypatch.setattr(blotato, "subir_stream", subir)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert consumidos == []                   # el latido cortó la subida
    assert worker["publicar"] == [] and _estado(reg["id"])["error"] == "otro"


def test_si_no_se_puede_marcar_creando_queda_en_error(worker, monkeypatch):
    reg = _pendiente()
    original = publicaciones.guardar

    def guardar(user, proyecto, r, etag=None):
        if r.get("estado") == "creando":
            raise RuntimeError("S3 caído")
        return original(user, proyecto, r, etag)

    monkeypatch.setattr(publicaciones, "guardar", guardar)
    publicar_task.ejecutar(USER, "gen-abc", reg["id"], _video)
    assert worker["publicar"] == [] and _estado(reg["id"])["estado"] == "error"


@pytest.mark.parametrize("codigo,tam,parte,no", [
    (413, 600_000_000, "400 MB", "clave"),
    (403, 600_000_000, "400 MB", "conéctala"),
    (403, 6, "no aceptó el archivo", "conéctala"),
    (0, 600_000_000, "400 MB", "conéctala"),            # conexión cortada
    (0, 6, "se cortó", "400 MB"),
    (503, 600_000_000, "(503)", "400 MB"),              # un 5xx pasajero no es el plan
])
def test_un_rechazo_de_la_subida_no_culpa_a_la_clave(worker, monkeypatch, codigo, tam, parte, no):
    reg = _pendiente()

    def subir(*a):
        raise blotato.SubidaRechazada(codigo)

    monkeypatch.setattr(blotato, "subir_stream", subir)

    def video_de(r):
        v = _video()
        v.tam = tam
        return v

    publicar_task.ejecutar(USER, "gen-abc", reg["id"], video_de)
    error = _estado(reg["id"])["error"]
    assert parte in error and no not in error


def test_subir_stream_distingue_el_rechazo_del_put(monkeypatch):
    monkeypatch.setattr(blotato.httpx, "post", lambda *a, **k: httpx.Response(
        201, json={"presignedUrl": "https://sube/aqui", "publicUrl": "https://pub/v.mp4"},
        request=httpx.Request("POST", "https://x")))
    monkeypatch.setattr(blotato.httpx, "put", lambda url, **k: httpx.Response(
        413, json={"message": "File exceeds the maximum upload size"},
        request=httpx.Request("PUT", url)))
    with pytest.raises(blotato.SubidaRechazada) as e:
        blotato.subir_stream(CLAVE, "v.mp4", iter([b"x"]), 1)
    assert e.value.codigo == 413
    msg, reconectar = blotato.explicar_fallo(e.value)
    assert "maximum upload size" in msg and reconectar is False


@pytest.mark.parametrize("respuesta,codigo", [
    (lambda url: httpx.Response(307, headers={"location": "https://otra"},
                                request=httpx.Request("PUT", url)), 307),
    ("corte", 0),
])
def test_subir_stream_no_toma_por_buena_una_subida_que_no_termino(monkeypatch, respuesta, codigo):
    monkeypatch.setattr(blotato.httpx, "post", lambda *a, **k: httpx.Response(
        201, json={"presignedUrl": "https://sube/aqui", "publicUrl": "https://pub/v.mp4"},
        request=httpx.Request("POST", "https://x")))

    def put(url, **k):
        if respuesta == "corte":
            raise httpx.ReadError("cerrada")
        return respuesta(url)

    monkeypatch.setattr(blotato.httpx, "put", put)
    with pytest.raises(blotato.SubidaRechazada) as e:
        blotato.subir_stream(CLAVE, "v.mp4", iter([b"x"]), 1)
    assert e.value.codigo == codigo


def test_la_url_firmada_no_llega_al_log_del_worker(tmp_path):
    """El worker deja el log raíz en INFO y httpx registra ahí la URL completa."""
    import os
    import subprocess
    import sys
    guion = tmp_path / "log.py"
    guion.write_text(
        "import logging, httpx\n"
        "logging.basicConfig(level=logging.INFO, force=True)\n"
        "import worker.lambda_worker\n"
        "from pipeline import blotato\n"
        "t = httpx.MockTransport(lambda r: httpx.Response(200))\n"
        "httpx.Client(transport=t).put('https://sube/aqui?token=SECRETO', content=b'x')\n",
        encoding="utf-8")
    raiz = Path(__file__).resolve().parent.parent
    env = {**os.environ, "PYTHONPATH": str(raiz), "SSM_ENV_PREFIX": "",
           "PYTHONIOENCODING": "utf-8"}
    r = subprocess.run([sys.executable, str(guion)], cwd=raiz, env=env,
                       capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr
    assert "SECRETO" not in r.stderr + r.stdout


def test_el_worker_solo_publica_videos_del_proyecto(worker, monkeypatch):
    from pipeline import costes_infra
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    reg = _pendiente(archivo_key="videos/otro/pelicula.mp4")
    publicar_task.publicar(USER, "gen-abc", reg["id"])
    assert worker["subir"] == []
    assert "No encontramos el video" in _estado(reg["id"])["error"]


def test_sondear_lee_la_rotacion(monkeypatch):
    salida = {"streams": [{"width": 1920, "height": 1080,
                           "side_data_list": [{"rotation": -90}]}],
              "format": {"duration": "12.5"}}
    monkeypatch.setattr(publicar_task.subprocess, "run", lambda *a, **k: SimpleNamespace(
        stdout=json.dumps(salida).encode()))
    assert publicar_task.sondear("x.mp4") == {"ancho": 1080, "alto": 1920, "segundos": 12.5}
    assert publicar_task.sondear(None) is None

    def roto(*a, **k):
        raise FileNotFoundError("sin ffprobe")

    monkeypatch.setattr(publicar_task.subprocess, "run", roto)
    assert publicar_task.sondear("x.mp4") is None


def test_el_handler_despacha_publicar(monkeypatch):
    vistos = []
    monkeypatch.setattr(publicar_task, "publicar", lambda u, p, i: vistos.append((u, p, i)))
    lambda_worker.handler({"Records": [{"body": json.dumps(
        {"tipo": "publicar", "user_id": USER, "proyecto": "gen-abc", "id": "a" * 12})}]}, None)
    assert vistos == [(USER, "gen-abc", "a" * 12)]


def test_el_mensaje_de_la_cola_solo_lleva_ids(monkeypatch):
    enviados = []
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://sqs/cola")
    monkeypatch.setattr(jobs, "_sqs", lambda: SimpleNamespace(
        send_message=lambda QueueUrl, MessageBody: enviados.append(json.loads(MessageBody))))
    jobs.encolar_publicar(USER, "gen-abc", "a" * 12)
    assert enviados == [{"tipo": "publicar", "user_id": USER, "proyecto": "gen-abc",
                         "id": "a" * 12}]


# ---------------------------------------------------------------------------
# endpoints en el servicio

def test_agendar_en_nube_encola_y_responde_202(nube):
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 202, r.text
    pub = r.json()["publicacion"]
    assert pub["estado"] == "pendiente" and pub["en_curso"] is True
    assert pub["cuenta_nombre"] == "Cuenta de tiktok"      # el de Blotato, no el del navegador
    assert nube.enviados == [{"tipo": "publicar", "user_id": USER, "proyecto": "gen-abc",
                              "id": pub["id"]}]
    [guardado] = _json_s3(nube.s3, f"usuarios/{USER}/publicaciones/gen-abc/")
    assert guardado["archivo_key"] == "videos/gen-abc/pelicula.mp4"
    assert guardado["opciones"]["privacidad"] == "PUBLIC_TO_EVERYONE"
    assert CLAVE not in json.dumps(guardado)


def test_agendar_no_encola_dos_veces_la_misma(nube):
    assert nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK).status_code == 202
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 409 and "ya se está enviando" in r.json()["detail"]
    otra = dict(TIKTOK, archivo="subtitulado")
    assert nube.post("/editor/gen-abc/api/publicar/agendar", json=otra).status_code == 202


@pytest.mark.parametrize("cambios,codigo,parte", [
    ({"confirmar": False}, 428, "confirmar"),
    ({"privacidad": None}, 422, "quién puede ver"),
    ({"plataforma": "myspace"}, 422, "no se puede usar"),
    ({"cuenta_id": "../x"}, 422, "cuenta"),
    ({"archivo": "srt"}, 422, "Elige un video"),
    ({"archivo": "nada"}, 422, "Elige un video"),
    ({"texto": "  "}, 422, "Escribe el texto"),
    ({"plataforma": "twitter", "texto": "x" * 281}, 422, "280 caracteres"),
    ({"plataforma": "twitter", "archivo": "subtitulado"}, 422, "512 MB"),
    ({"plataforma": "facebook"}, 422, "la página"),
    ({"plataforma": "youtube", "titulo": "T", "privacidad": "public",
      "texto": "Suscríbete <3"}, 422, "< ni >"),
    ({"plataforma": "youtube", "titulo": "T", "privacidad": "public",
      "texto": "á" * 2600}, 422, "bytes"),
    ({"plataforma": "instagram", "texto": "#a #b #c #d #e #f"}, 422, "hashtags"),
    ({"cuenta_id": "11111"}, 422, "no está conectada"),
    ({"cuando": "mañana"}, 422, "fecha"),
    ({"cuando": "2026-09-20T15:00:00"}, 422, "fecha"),        # sin zona
    ({"cuando": _cuando(-3600)}, 422, "ya pasó"),
    ({"cuando": _cuando(400 * 86400)}, 422, "9 meses"),
])
def test_agendar_valida_antes_de_encolar(nube, cambios, codigo, parte):
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json={**TIKTOK, **cambios})
    assert r.status_code == codigo, r.text
    assert parte in r.json()["detail"]
    assert nube.enviados == [] and nube.s3.objetos == {}


def test_agendar_usa_el_nombre_de_la_cuenta_que_da_blotato(nube):
    r = nube.post("/editor/gen-abc/api/publicar/agendar",
                  json=dict(TIKTOK, cuenta_nombre="<script>otra</script>"))
    assert r.json()["publicacion"]["cuenta_nombre"] == "Cuenta de tiktok"


def test_agendar_si_blotato_no_responde(nube, monkeypatch):
    def caido(clave, timeout=None):
        raise httpx.ConnectError("x")

    monkeypatch.setattr(blotato, "cuentas", caido)
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 502 and "no respondió" in r.json()["detail"]
    assert nube.enviados == []


def test_agendar_tiene_tope_por_usuario(nube):
    for red in ("tiktok", "twitter", "threads"):
        cuerpo = dict(TIKTOK, plataforma=red, archivo="pelicula")
        assert nube.post("/editor/gen-abc/api/publicar/agendar", json=cuerpo).status_code == 202
    r = nube.post("/editor/gen-abc/api/publicar/agendar",
                  json=dict(TIKTOK, plataforma="bluesky"))
    assert r.status_code == 429 and "subiéndose" in r.json()["detail"]
    assert len(nube.enviados) == 3


def test_agendar_no_espera_a_blotato_mas_de_la_cuenta(nube, monkeypatch):
    monkeypatch.setattr(publicar_api, "TOPE_AGENDAR_S", 2.5)

    def lento(clave, timeout=None):
        time.sleep(6)
        return _cuentas_reales(clave)

    monkeypatch.setattr(blotato, "cuentas", lento)
    t0 = time.monotonic()
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 503 and time.monotonic() - t0 < 2      # ni siquiera lo intenta
    monkeypatch.setattr(publicar_api, "TOPE_AGENDAR_S", 5)
    t0 = time.monotonic()
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 502 and "no respondió" in r.json()["detail"]
    assert time.monotonic() - t0 < 5
    assert nube.enviados == [] and nube.s3.objetos == {}


def test_agendar_programado_guarda_la_hora_en_utc(nube):
    r = nube.post("/editor/gen-abc/api/publicar/agendar",
                  json=dict(TIKTOK, cuando="2027-01-10T09:30:00.000-06:00"))
    assert r.status_code == 202
    assert r.json()["publicacion"]["cuando"] == "2027-01-10T15:30:00+00:00"


def test_youtube_sin_texto_usa_el_titulo(nube):
    cuerpo = dict(TIKTOK, plataforma="youtube", texto="", titulo="Mi título",
                  privacidad="public")
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=cuerpo)
    assert r.status_code == 202, r.text
    [guardado] = _json_s3(nube.s3, f"usuarios/{USER}/publicaciones/")
    assert guardado["texto"] == "Mi título" and guardado["titulo"] == "Mi título"


def test_agendar_sin_blotato_o_proyecto_ajeno(nube, monkeypatch):
    r = nube.post("/editor/gen-otro/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 404
    monkeypatch.setattr(blotato, "clave_de", lambda u: None)
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 409 and "Conecta" in r.json()["detail"]
    from pipeline import claves_usuario

    def caido(u):
        raise claves_usuario.ErrorAlmacen("x")

    monkeypatch.setattr(blotato, "clave_de", caido)
    assert nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK).status_code == 503


def test_si_no_se_puede_encolar_queda_en_error(nube, monkeypatch):
    def roto():
        raise RuntimeError("sqs caído")

    monkeypatch.setattr(jobs, "_sqs", roto)
    r = nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 502
    [guardado] = _json_s3(nube.s3, f"usuarios/{USER}/publicaciones/")
    assert guardado["estado"] == "error"
    # y no bloquea un nuevo intento
    monkeypatch.setattr(jobs, "_sqs", lambda: SimpleNamespace(
        send_message=lambda QueueUrl, MessageBody: None))
    assert nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK).status_code == 202


def test_el_estado_no_llama_a_blotato(nube, monkeypatch):
    def prohibido(*a, **k):
        raise AssertionError("el estado no debe llamar a Blotato")

    assert nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK).status_code == 202
    monkeypatch.setattr(blotato, "cuentas", prohibido)
    r = nube.get("/editor/gen-abc/api/publicar/estado").json()
    assert r["agendar"] is True and r["blotato"] is True and r["max_mb_starter"] == 400
    assert r["final"] == "subtitulado"                    # proyecto generado
    assert [p["plataforma"] for p in r["publicaciones"]] == ["tiktok"]
    assert r["redes"]["youtube"]["titulo_obligatorio"] is True
    assert "cuentas" not in r


TIGHT = {"render": {"estado": "listo", "estilo": "tight"}}


@pytest.mark.parametrize("doc,claves,final", [
    # (archivo, fecha): la subtitulada solo gana si se quemó después del render
    (TIGHT, [("output/preview-natural.mp4", 1), ("output/preview-tight.mp4", 2),
             ("output/preview-tight-subtitulado.mp4", 3)], "preview-tight-subtitulado"),
    (TIGHT, [("output/preview-tight-subtitulado.mp4", 1), ("output/preview-tight.mp4", 2)],
     "preview-tight"),                                  # se corrigió el corte y se re-renderizó
    ({"render": {"estado": "listo", "estilo": "natural"}},
     [("output/preview-natural.mp4", 1), ("output/preview-tight-subtitulado.mp4", 2)],
     "preview-natural"),
    ({"flags": {"generado": True}}, [("output/preview-tight.mp4", 3), ("pelicula.mp4", 1)],
     "pelicula"),
    ({"flags": {"generado": True}}, [("pelicula-subtitulado.mp4", 1), ("pelicula.mp4", 2)],
     "pelicula"),                                       # la película se rearmó
    ({}, [("output/preview-a.mp4", 1), ("output/preview-b-subtitulado.mp4", 2)],
     "preview-b-subtitulado"),
    ({}, [("output/preview-natural-subtitulado.mp4", 1), ("output/preview-natural.mp4", 2),
          ("output/preview-tight.mp4", 3)], "preview-tight"),   # el render más nuevo
    ({}, [("work/subs/subs.srt", 1)], None),
])
def test_el_estado_dice_cual_es_la_pelicula(nube, monkeypatch, doc, claves, final):
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: doc)
    nube.videos.clear()
    nube.videos.update({f"videos/v9/{c}": (10, float(t)) for c, t in claves})
    assert nube.get("/editor/v9/api/publicar/estado").json()["final"] == final


def test_en_local_la_pelicula_final_es_el_render_mas_nuevo(local):
    import os
    cliente, p = local
    (p / "output").mkdir()
    for nombre, t in [("preview-natural-subtitulado.mp4", 1), ("preview-natural.mp4", 2),
                      ("preview-tight.mp4", 3)]:
        f = p / "output" / nombre
        f.write_bytes(b"x")
        os.utime(f, (1_000_000 + t, 1_000_000 + t))
    os.utime(p / "pelicula.mp4", (1_000_000, 1_000_000))
    assert cliente.get("/editor/v1/api/publicar/estado").json()["final"] == "preview-tight"


def test_cuentas_limpias_y_errores(nube, monkeypatch):
    monkeypatch.setattr(blotato, "cuentas", lambda clave, timeout=None: [
        {"id": "1", "platform": "tiktok", "fullname": "<b>Yo</b>", "username": "yo",
         "token": "secreto"}])
    r = nube.get("/editor/gen-abc/api/publicar/cuentas").json()
    assert r == {"conectado": True, "error": None, "reconectar": False,
                 "cuentas": [{"id": "1", "platform": "tiktok", "fullname": "<b>Yo</b>",
                              "username": "yo"}]}

    def rechazada(clave, timeout=None):
        raise _http(401)

    monkeypatch.setattr(blotato, "cuentas", rechazada)
    r = nube.get("/editor/gen-abc/api/publicar/cuentas").json()
    assert r["cuentas"] == [] and r["reconectar"] is True
    monkeypatch.setattr(blotato, "clave_de", lambda u: None)
    assert nube.get("/editor/gen-abc/api/publicar/cuentas").json()["conectado"] is False


def test_destinos(nube, monkeypatch):
    monkeypatch.setattr(blotato, "subcuentas", lambda c, cuenta: [{"id": "9", "nombre": "Pág"}])
    monkeypatch.setattr(blotato, "tableros", lambda c, cuenta: [{"id": "b", "nombre": "Tab"}])
    base = "/editor/gen-abc/api/publicar/destinos"
    assert nube.get(f"{base}?cuenta_id=1&plataforma=facebook").json()["destinos"][0]["id"] == "9"
    assert nube.get(f"{base}?cuenta_id=1&plataforma=pinterest").json()["destinos"][0]["id"] == "b"
    assert nube.get(f"{base}?cuenta_id=1&plataforma=youtube").status_code == 422
    assert nube.get(f"{base}?cuenta_id=../x&plataforma=facebook").status_code == 422

    def falla(c, cuenta):
        raise httpx.ConnectError("x")

    monkeypatch.setattr(blotato, "subcuentas", falla)
    r = nube.get(f"{base}?cuenta_id=1&plataforma=linkedin").json()
    assert r["destinos"] == [] and "no respondió" in r["error"]


def test_publicaciones_pregunta_a_blotato_por_las_que_van_en_camino(nube, monkeypatch):
    nube.post("/editor/gen-abc/api/publicar/agendar", json=TIKTOK)
    [guardado] = _json_s3(nube.s3, f"usuarios/{USER}/publicaciones/")
    reg, etag = publicaciones.leer(USER, "gen-abc", guardado["id"])
    reg.update(estado="enviado", post_id="post-9")
    publicaciones.guardar(USER, "gen-abc", reg, etag)
    monkeypatch.setattr(blotato, "estado_post", lambda c, p, timeout=None: {
        "status": "failed", "errorMessage": "La cuenta llegó a su límite diario"})
    [pub] = nube.get("/editor/gen-abc/api/publicar/publicaciones").json()["publicaciones"]
    assert pub["estado"] == "fallido" and "límite diario" in pub["mensaje"]
    assert pub["en_curso"] is False


# ---------------------------------------------------------------------------
# títulos (gratis)

@pytest.fixture
def llm(monkeypatch):
    import langfuse
    from contextlib import nullcontext
    monkeypatch.setattr(langfuse, "propagate_attributes", lambda **k: nullcontext())
    monkeypatch.setattr(langfuse, "get_client", lambda: SimpleNamespace(flush=lambda: None))
    from pipeline import creditos

    def cobro(*a, **k):
        raise AssertionError("los títulos son gratis")

    monkeypatch.setattr(creditos, "cobrar", cobro)
    pedidos = []

    async def chat_json(nombre, system, user):
        pedidos.append(user)
        return {"titulos": ["<script>uno</script>", "  dos   con espacios ", "x" * 150, 7, "cuatro"]}

    monkeypatch.setattr(publicar_api, "chat_json", chat_json)
    monkeypatch.setattr(publicar_api, "load_prompt", lambda nombre: "sistema")
    return pedidos


def test_titulos_en_nube_leen_el_transcript_de_s3(nube, llm, monkeypatch):
    objetos = {"videos/gen-abc/work/edited-transcript.json":
               {"words": [{"text": "hola"}, {"text": "mundo"}]}}
    monkeypatch.setattr(editor, "_leer_json_s3", lambda key: objetos.get(key))
    r = nube.post("/editor/gen-abc/api/publicar/titulos", json={"plataformas": ["youtube", "otra"]})
    assert r.status_code == 200, r.text
    assert r.json()["titulos"] == ["scriptuno/script", "dos con espacios", "x" * 100]
    assert "Plataformas: YouTube" in llm[0] and "hola mundo" in llm[0]


def test_titulos_acotan_las_plataformas_y_el_largo(nube, llm, monkeypatch):
    monkeypatch.setattr(editor, "_leer_json_s3", lambda key: {"words": [{"text": "hola"}]})
    r = nube.post("/editor/gen-abc/api/publicar/titulos", json={"plataformas": ["tiktok"] * 10})
    assert r.status_code == 422 and llm == []
    r = nube.post("/editor/gen-abc/api/publicar/titulos",
                  json={"plataformas": ["tiktok", "tiktok", "twitter"]})
    assert "Plataformas: TikTok (tiktok), X (twitter)\n" in llm[0]
    # al texto del post (sin campo título) caben 150
    assert r.json()["titulos"][2] == "x" * 150


def test_limpiar_titulo_no_parte_palabras_ni_hashtags():
    t = ("Aprende a editar videos con inteligencia artificial en minutos y sin "
         "experiencia previa, paso a paso #EdicionDeVideo #IA")
    limpio = publicar_api.limpiar_titulo(t)
    assert len(limpio) <= 100 and not limpio.endswith(("#", "#Edici"))
    assert limpio.endswith("paso a paso")
    assert publicar_api.limpiar_titulo("uno dos #tres", 9) == "uno dos"
    assert publicar_api.limpiar_titulo("uno dos tres cuatro", 10) == "uno dos"
    assert publicar_api.limpiar_titulo("Aprende C#") == "Aprende C#"   # sin recorte, intacto
    assert publicar_api.limpiar_titulo("x" * 150) == "x" * 100


def test_titulos_caen_al_transcript_canonico(nube, llm, monkeypatch):
    objetos = {"videos/gen-abc/work/transcripts/c1.canonical.json": {"words": [{"text": "crudo"}]},
               "videos/gen-abc/work/transcripts/backups/c0.canonical.json": {"words": [{"text": "viejo"}]}}
    monkeypatch.setattr(editor, "_leer_json_s3", lambda key: objetos.get(key))
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: sorted(k for k in objetos if k.startswith(pre)))
    assert nube.post("/editor/gen-abc/api/publicar/titulos", json={}).status_code == 200
    assert "crudo" in llm[0] and "viejo" not in llm[0]


def test_titulos_sin_transcript_o_con_fallas(nube, llm, monkeypatch):
    monkeypatch.setattr(editor, "_leer_json_s3", lambda key: None)
    monkeypatch.setattr(media_sync, "listar_prefijo", lambda pre: [])
    r = nube.post("/editor/gen-abc/api/publicar/titulos", json={})
    assert r.status_code == 409 and "transcript" in r.json()["detail"]
    assert llm == []

    monkeypatch.setattr(editor, "_leer_json_s3", lambda key: {"words": [{"text": "hola"}]})

    async def lento(*a):
        await asyncio.sleep(5)

    monkeypatch.setattr(publicar_api, "chat_json", lento)
    monkeypatch.setattr(publicar_api, "TITULOS_TIMEOUT_S", 0.05)
    assert nube.post("/editor/gen-abc/api/publicar/titulos", json={}).status_code == 504

    async def json_roto(*a):
        raise ValueError("no es JSON")

    monkeypatch.setattr(publicar_api, "chat_json", json_roto)
    r = nube.post("/editor/gen-abc/api/publicar/titulos", json={})
    assert r.status_code == 502 and isinstance(r.json()["detail"], str)

    async def vacio(*a):
        return {"titulos": ["<>", 3]}

    monkeypatch.setattr(publicar_api, "chat_json", vacio)
    assert nube.post("/editor/gen-abc/api/publicar/titulos", json={}).status_code == 502


# ---------------------------------------------------------------------------
# en local: el mismo flujo, en segundo plano

@pytest.fixture
def local(monkeypatch, tmp_path):
    from pipeline import storage
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "json")
    monkeypatch.setenv("DEFAULT_USER_ID", USER)
    monkeypatch.setattr(storage, "videos_root", lambda: tmp_path)
    monkeypatch.setattr(publicaciones, "videos_root", lambda: tmp_path)
    p = tmp_path / "v1"
    (p / "work").mkdir(parents=True)
    (p / "pelicula.mp4").write_bytes(b"0123456789")
    monkeypatch.setattr(blotato, "clave_de", lambda u: CLAVE)
    from server.app import app
    return TestClient(app), p


def test_en_local_agendar_corre_en_segundo_plano(local, worker, monkeypatch):
    cliente, p = local
    monkeypatch.setenv("STATE_BACKEND", "json")      # el fixture worker lo pone en nube
    r = cliente.post("/editor/v1/api/publicar/agendar", json=TIKTOK)
    assert r.status_code == 202, r.text
    assert worker["subir"] == [("v1-pelicula.mp4", b"0123456789", 10)]
    [pub] = cliente.get("/editor/v1/api/publicar/estado").json()["publicaciones"]
    assert pub["estado"] == "publicado" and pub["url"] == "https://x.com/v/1"
    assert list((p / "work" / "publicaciones").glob("*.json"))


def test_en_local_no_hay_tope_de_publicaciones(local, monkeypatch):
    cliente, _ = local
    monkeypatch.setattr(blotato, "cuentas", _cuentas_reales)
    monkeypatch.setattr(publicar_api, "_publicar_local", lambda *a: None)   # quedan en la fila
    codigos = [cliente.post("/editor/v1/api/publicar/agendar",
                            json=dict(TIKTOK, plataforma=red)).status_code
               for red in ("tiktok", "twitter", "threads", "bluesky")]
    assert codigos == [202, 202, 202, 202]


def test_en_local_el_estado_no_pide_cuentas(local, monkeypatch):
    cliente, _ = local

    def prohibido(*a, **k):
        raise AssertionError("el estado no debe llamar a Blotato")

    monkeypatch.setattr(blotato, "cuentas", prohibido)
    r = cliente.get("/editor/v1/api/publicar/estado").json()
    assert r["blotato"] is True and r["publicaciones"] == []
    assert [d["clave"] for d in r["descargables"]] == ["pelicula"]
