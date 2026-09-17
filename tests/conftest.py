"""El .env real se carga UNA vez, antes de correr cualquier test.

pipeline/config.py hace load_dotenv() al importarse. Si ese primer import
ocurre DENTRO de un test que ya hizo monkeypatch.delenv(...), el .env re-mete
la variable borrada y el test falla según el ORDEN de la suite (visto
2026-09-08: test_m4 delenv STRIPE_LINK_550 → import server.app → load_dotenv
la restauró del .env). Importarlo aquí fija el entorno antes de todo, y los
delenv/setenv de cada test vuelven a mandar.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pipeline.config  # noqa: E402,F401 — load_dotenv() una sola vez, aquí
from pipeline import project  # noqa: E402


@pytest.fixture(autouse=True)
def _proyectos_en_tmp(monkeypatch, tmp_path):
    """Ningún test escribe en la carpeta de trabajo real.

    `settings` se congela al importar, así que un setenv("WORK_DIR") dentro de un
    test llega tarde. Visto 2026-09-16: test_m11_narracion creaba proyectos
    «un pato» en la carpeta del dueño en cada corrida, y salían en su lista de
    películas. Los tests que necesitan su propia carpeta la vuelven a fijar
    igual que siempre (el último monkeypatch manda)."""
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path / "_work"))


@pytest.fixture(autouse=True)
def _blotato_sin_cuenta_real(monkeypatch, tmp_path):
    """Ningún test habla con Blotato con la cuenta del dueño ni guarda claves
    en su carpeta de trabajo (M23 C). El .env real trae BLOTATO_API_KEY, y en
    local es la clave de reserva: sin esto, un test del estado de Publicar
    llamaría a Blotato de verdad."""
    from pipeline import claves_usuario
    monkeypatch.delenv("BLOTATO_API_KEY", raising=False)
    # con el prefijo exportado en la shell, los tests «locales» irían a SSM real
    monkeypatch.delenv("SSM_USUARIOS_PREFIX", raising=False)
    monkeypatch.setattr(claves_usuario, "_raiz_local", lambda: tmp_path / "_claves")


@pytest.fixture(autouse=True)
def _sin_red_real(monkeypatch):
    """Ningún test sale a internet. Visto 2026-09-16: uno de Blotato llamaba
    de verdad a backend.blotato.com y pasaba igual con o sin red. El cliente de
    pruebas de FastAPI no pasa por aquí (tiene su propio transporte)."""
    import httpx

    def bloqueado(self, request):
        raise RuntimeError(f"un test intentó salir a la red: {request.method} {request.url.host}")

    async def bloqueado_async(self, request):
        bloqueado(self, request)

    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", bloqueado)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", bloqueado_async)


@pytest.fixture(autouse=True)
def _sin_aurora_real(monkeypatch):
    """Ningún test habla con la base de producción. load_dotenv() sube por los
    directorios hasta el .env del dueño, que trae los ARN de Aurora, y boto3
    encuentra sus credenciales: un db.ejecutar sin mockear escribiría de
    verdad. Desde la reserva de nombres del editor (2026-09-16) hay más
    caminos que tocan la base; los tests que la necesitan mockean
    db.ejecutar o db._cliente, y su monkeypatch manda sobre este."""
    from pipeline import db

    def bloqueado():
        raise RuntimeError("un test intentó hablar con Aurora de verdad")
    monkeypatch.setattr(db, "_cliente", bloqueado)
