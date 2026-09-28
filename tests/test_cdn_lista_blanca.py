"""La fuga del CDN: el bucket dejó de servirse entero, y no vuelve.

Hasta el 2026-09-28 la distribución de CloudFront tenía permiso de OAC sobre
`<bucket>/*` y servía el bucket completo a quien adivinara una clave. Las de
`videos/` se adivinan —su primer segmento es el nombre del proyecto— así que
esto contestaba 200 con un megabyte de video y sin login:

    GET /videos/1/work/editor/proxy.mp4

Estos tests fijan las dos mitades del arreglo, que TIENEN que decir lo mismo:

  1. La política del bucket sintetizada, que es la que de verdad manda.
  2. `pipeline/media_rutas.py`, que es de donde el servidor decide si una clave
     se entrega por CDN o firmada.

Si una se mueve sin la otra, el síntoma no es un error de deploy: es media rota
en la cara del usuario, o un prefijo que vuelve a servirse sin login. Ninguna de
las dos avisa sola.
"""
from __future__ import annotations

import ast
import os
import sys
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
INFRA = RAIZ / "infra"
if str(INFRA) not in sys.path:
    sys.path.insert(0, str(INFRA))

from pipeline import media_rutas, media_sync  # noqa: E402

# Las claves reales que la tarjeta midió devolviendo 200 sin autenticación.
FUGADAS = (
    "videos/1/work/editor/proxy.mp4",
    "videos/1/work/analysis/cuts.json",
    "videos/1/work/editor/list.txt",
    "videos/video-2/pelicula.mp4",
    "videos/ejemplo/output/shorts/short-1.mp4",
)


# ---------------------------------------------------------------------------
# 1. la lista, sin CDK ni AWS

def test_videos_no_lo_sirve_el_cdn():
    """La razón de ser de todo esto."""
    for key in FUGADAS:
        assert not media_rutas.servible_por_cdn(key), key


def test_lo_que_si_sirve_el_cdn_es_exactamente_esto():
    """Fija la lista. Añadir un prefijo aquí es abrir media al mundo sin login:
    que cueste un test es el punto."""
    assert media_rutas.SERVIBLES_CDN == (
        "imagenes/", "usuarios/", "voces/", "work/")


def test_los_prefijos_servibles_lo_son():
    for p in media_rutas.SERVIBLES_CDN:
        assert media_rutas.servible_por_cdn(f"{p}loquesea/archivo.mp4")


def test_un_prefijo_nuevo_nace_cerrado():
    """La regla es «denegar salvo lo listado». El primer diseño cortaba por
    extensión y fallaba ABIERTO: un .mp4 nuevo nacía público solo."""
    assert not media_rutas.servible_por_cdn("exportaciones/x.mp4")
    assert not media_rutas.servible_por_cdn("respaldos/2026/dump.json")


def test_la_barra_inicial_no_abre_la_puerta():
    """`/videos/...` y `videos/...` son la misma clave para quien pide."""
    assert not media_rutas.servible_por_cdn("/videos/1/work/editor/proxy.mp4")


def test_clave_desde_url_destripa_una_url_vieja_del_cdn():
    base = "https://d8bfm82hs0s6a.cloudfront.net"
    assert media_rutas.clave_desde_url(
        f"{base}/videos/1/output/preview-a.mp4", base) == "videos/1/output/preview-a.mp4"
    assert media_rutas.clave_desde_url(f"{base}/x.mp4", base + "/") == "x.mp4"


def test_clave_desde_url_no_toca_lo_que_no_es_del_cdn():
    base = "https://d8bfm82hs0s6a.cloudfront.net"
    assert media_rutas.clave_desde_url("https://otro.example/x.mp4", base) is None
    assert media_rutas.clave_desde_url("", base) is None
    assert media_rutas.clave_desde_url("https://x/y", "") is None


# ---------------------------------------------------------------------------
# 2. url_media: quién sale por el CDN y quién sale firmado

class _S3Falso:
    def generate_presigned_url(self, op, Params, ExpiresIn):  # noqa: N803
        assert op == "get_object"
        return f"https://s3.example/{Params['Key']}?X-Amz-Expires={ExpiresIn}"


@pytest.fixture
def nube(monkeypatch):
    monkeypatch.setenv("CDN_BASE", "https://cdn.example")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    monkeypatch.setattr(media_sync, "_s3", lambda: _S3Falso())


def test_url_media_firma_lo_de_videos(nube):
    """Lo que antes era una URL pública ahora sale con firma y caducidad."""
    url = media_sync.url_media("videos/1/work/editor/proxy.mp4")
    assert url.startswith("https://s3.example/")
    assert "X-Amz-Expires" in url
    assert "cdn.example" not in url


def test_url_media_deja_en_el_cdn_lo_servible(nube):
    assert media_sync.url_media("imagenes/sub-123/abc.jpg") == \
        "https://cdn.example/imagenes/sub-123/abc.jpg"


def test_url_media_sin_nada_es_none(monkeypatch):
    """Instalación local: no hay CDN ni bucket, y quien llama sirve del disco."""
    monkeypatch.delenv("CDN_BASE", raising=False)
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    assert media_sync.url_media("videos/1/pelicula.mp4") is None


def test_url_media_firma_aunque_no_haya_cdn(monkeypatch):
    monkeypatch.delenv("CDN_BASE", raising=False)
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    monkeypatch.setattr(media_sync, "_s3", lambda: _S3Falso())
    assert media_sync.url_media("imagenes/sub/abc.jpg").startswith("https://s3.example/")


# ---------------------------------------------------------------------------
# 3. refrescar_urls: las filas que ya están en Postgres

def test_refrescar_urls_rearma_desde_la_clave(nube):
    doc = {"render": {"estado": "listo", "key": "videos/1/output/preview-a.mp4",
                      "url": "https://cdn.example/videos/1/output/preview-a.mp4"}}
    fuera = media_sync.refrescar_urls(doc)
    assert fuera["render"]["url"].startswith("https://s3.example/")


def test_refrescar_urls_rescata_la_clave_de_una_fila_vieja(nube):
    """subtitulos_task guardaba SOLO la url. Sin destriparla no hay nada que
    firmar, y el reproductor se queda en 403 para siempre."""
    doc = {"estado": "listo",
           "url": "https://cdn.example/videos/1/output/preview-a-subtitulado.mp4"}
    fuera = media_sync.refrescar_urls(doc)
    assert fuera["key"] == "videos/1/output/preview-a-subtitulado.mp4"
    assert fuera["url"].startswith("https://s3.example/")


def test_refrescar_urls_no_inventa_urls(nube):
    """Si no había URL, no aparece una: un `key` suelto no significa que la UI
    quisiera una liga ahí."""
    fuera = media_sync.refrescar_urls({"key": "videos/1/x.mp4"})
    assert "url" not in fuera and "cdn" not in fuera


def test_refrescar_urls_entra_en_listas(nube):
    doc = {"render": {"salidas": [
        {"key": "videos/1/output/shorts/a.mp4", "url": "https://cdn.example/x"},
        {"key": "videos/1/output/shorts/b.mp4", "url": "https://cdn.example/y"}]}}
    fuera = media_sync.refrescar_urls(doc)
    assert all(s["url"].startswith("https://s3.example/")
               for s in fuera["render"]["salidas"])


def test_refrescar_urls_no_muta_lo_que_le_dan(nube):
    """Los ejecutores hacen cargar → modificar → guardar. Si esto mutara el
    documento, una URL firmada acabaría persistida con su caducidad dentro."""
    doc = {"key": "videos/1/x.mp4", "url": "https://cdn.example/videos/1/x.mp4"}
    media_sync.refrescar_urls(doc)
    assert doc["url"] == "https://cdn.example/videos/1/x.mp4"


# ---------------------------------------------------------------------------
# 4. nadie vuelve a armar una URL de CDN a mano

FUENTES = [p for d in ("server", "worker", "pipeline")
           for p in (RAIZ / d).rglob("*.py")]


def test_solo_media_sync_arma_urls_del_cdn():
    """Ocho sitios armaban `f"{CDN_BASE}/{key}"` por su cuenta, y por eso la
    fuga tenía ocho bocas. Ahora la decisión vive en un solo sitio: cualquiera
    que vuelva a concatenar se lleva este test por delante."""
    culpables = []
    for f in FUENTES:
        if f.name == "media_sync.py":
            continue          # es el único que tiene permiso
        for n, linea in enumerate(f.read_text(encoding="utf-8").splitlines(), 1):
            if 'f"{cdn}/' in linea or 'f"{base}/' in linea:
                culpables.append(f"{f.relative_to(RAIZ)}:{n}")
    assert not culpables, (
        "arman una URL de CDN a mano en vez de usar media_sync.url_media(): "
        + ", ".join(culpables))


def test_los_ejecutores_no_persisten_urls_absolutas():
    """La clave se persiste; la URL se arma al leer. Una URL firmada guardada
    en Postgres es una liga que funciona hasta que deja de funcionar."""
    for nombre in ("render_task.py", "subtitulos_task.py", "shorts_task.py",
                   "producir_task.py"):
        txt = (RAIZ / "worker" / nombre).read_text(encoding="utf-8")
        assert 'CDN_BASE' not in txt, f"{nombre} sigue leyendo CDN_BASE"


# ---------------------------------------------------------------------------
# 5. la política del bucket, sintetizada de verdad

EXIGIR_CDK = os.getenv("EXIGIR_CDK") == "1"


@pytest.fixture(scope="module")
def plantilla_media():
    try:
        import aws_cdk as cdk
        from stacks.media import MediaStack
    except ImportError:
        if EXIGIR_CDK:
            raise
        pytest.skip("sin aws_cdk (no viaja en la imagen); el CI lo instala aparte")
    app = cdk.App()
    st = MediaStack(app, "m", env=cdk.Environment(
        account="191241816158", region="us-east-1"))
    return app.synth().get_stack_by_name("m").template


def _deny_de_cloudfront(plantilla) -> dict:
    for r in plantilla["Resources"].values():
        if r["Type"] != "AWS::S3::BucketPolicy":
            continue
        for s in r["Properties"]["PolicyDocument"]["Statement"]:
            if (s["Effect"] == "Deny"
                    and s.get("Principal", {}).get("Service") == "cloudfront.amazonaws.com"):
                return s
    raise AssertionError("no hay Deny para CloudFront: el bucket se sirve entero")


def _sufijos(recursos) -> list[str]:
    """El literal de cada ARN: `<bucket-arn>` + '/imagenes/*' → 'imagenes/'."""
    fuera = []
    for r in recursos:
        cola = r["Fn::Join"][1][-1]          # '/imagenes/*'
        fuera.append(cola.lstrip("/").rstrip("*"))
    return fuera


def test_el_template_deniega_todo_salvo_la_lista(plantilla_media):
    """El Deny y `media_rutas` son la misma lista, o hay media rota."""
    s = _deny_de_cloudfront(plantilla_media)
    assert s["Action"] == "s3:GetObject"
    assert "NotResource" in s, (
        "con Resource en vez de NotResource la regla deniega SOLO lo listado, "
        "que es exactamente al revés de lo que hace falta")
    assert tuple(_sufijos(s["NotResource"])) == media_rutas.SERVIBLES_CDN


def test_el_bucket_no_cambia_de_id_logico(plantilla_media):
    """Renombrar el construct crea un bucket NUEVO y deja el de los usuarios
    atrás con todo dentro. El id lógico de hoy es el que ya existe en la cuenta."""
    assert "MediaA721A567" in plantilla_media["Resources"]


def test_el_cors_ya_no_es_de_todo_el_mundo(plantilla_media):
    """Estaba en `*` con un comentario que decía «se restringe cuando haya
    auth». El auth existe desde M2."""
    bucket = plantilla_media["Resources"]["MediaA721A567"]["Properties"]
    origenes = bucket["CorsConfiguration"]["CorsRules"][0]["AllowedOrigins"]
    assert "*" not in origenes
    assert "https://irremplazables.xyz" in origenes
    assert "http://localhost:8011" in origenes, (
        "sin localhost el 8011 no puede subir, y es donde se prueba")
    assert any(o.startswith("https://*.execute-api.") for o in origenes), (
        "sin el execute-api se quedan fuera los usuarios que entran por ahí")


def test_el_modulo_de_rutas_no_arrastra_dependencias():
    """`infra/stacks/media.py` lo importa durante el synth, donde no hay boto3
    ni fastapi. Que siga siendo Python puro."""
    arbol = ast.parse((RAIZ / "pipeline" / "media_rutas.py").read_text(encoding="utf-8"))
    importados = {n.module.split(".")[0] if isinstance(n, ast.ImportFrom) else
                  n.names[0].name.split(".")[0]
                  for n in ast.walk(arbol) if isinstance(n, (ast.Import, ast.ImportFrom))}
    assert importados <= {"__future__"}, f"importa de más: {importados}"
