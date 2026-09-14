"""El API dejó de ser mudo.

El bug que motivó esto: `logging.basicConfig()` es no-op cuando el root logger
ya tiene handlers, y el runtime de Lambda instala el suyo antes de importar la
app. El `level=INFO` nunca se aplicaba, el root se quedaba en WARNING y todos
los `log.info()` de los routers se tiraban en silencio — siete días de
CloudWatch con 5.478 invocaciones y cero líneas de la aplicación, mientras en
local todo se veía bien.

Sin estas líneas no hay forma de saber qué ruta se come los 29 s del timeout.
"""
import logging

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


# ---------------------------------------------------------------------------
# el nivel del root — el bug original

def test_el_nivel_se_aplica_aunque_ya_hubiera_un_handler():
    """Reproduce Lambda: con un handler previo, basicConfig() no hace nada.

    Con solo `basicConfig()` el root se queda como estaba y el fallo vuelve, así
    que este test es el que impide que alguien «simplifique» la función.
    """
    from server.app import _configurar_logging

    root = logging.getLogger()
    handlers, nivel = root.handlers[:], root.level
    try:
        root.handlers[:] = [logging.NullHandler()]   # lo que hace el runtime
        root.setLevel(logging.WARNING)               # su nivel por defecto
        _configurar_logging()
        assert root.level == logging.INFO
    finally:
        root.handlers[:] = handlers
        root.setLevel(nivel)


def test_importar_la_app_deja_el_root_en_info():
    import server.app  # noqa: F401 — importarlo es lo que configura el logging
    assert logging.getLogger().level == logging.INFO


# ---------------------------------------------------------------------------
# una línea por petición

def test_cada_peticion_deja_su_linea(cliente, caplog):
    with caplog.at_level(logging.INFO, logger="peticiones"):
        cliente.get("/ruta-que-no-existe")

    lineas = [r.getMessage() for r in caplog.records if r.name == "peticiones"]
    assert len(lineas) == 1, lineas
    assert "GET" in lineas[0]
    assert "/ruta-que-no-existe" in lineas[0]
    assert "404" in lineas[0]
    assert " ms" in lineas[0]


def test_la_query_string_no_llega_al_log(cliente, caplog):
    """Por la query viajan tokens: se registra `url.path`, nunca la URL entera."""
    with caplog.at_level(logging.INFO, logger="peticiones"):
        cliente.get("/ruta-que-no-existe?token=SECRETO-QUE-NO-DEBE-SALIR")

    lineas = [r.getMessage() for r in caplog.records if r.name == "peticiones"]
    assert lineas, "no se registró la petición"
    assert "SECRETO-QUE-NO-DEBE-SALIR" not in " ".join(lineas)


def test_las_lentas_suben_a_warning(cliente, caplog, monkeypatch):
    """Un umbral en WARNING sobrevive a que el root vuelva a su nivel por defecto."""
    import server.app
    monkeypatch.setattr(server.app, "LENTA_MS", 0)   # toda petición cuenta como lenta

    with caplog.at_level(logging.INFO, logger="peticiones"):
        cliente.get("/ruta-que-no-existe")

    niveles = [r.levelno for r in caplog.records if r.name == "peticiones"]
    assert niveles == [logging.WARNING], niveles


def test_el_umbral_avisa_antes_del_corte():
    """29 s corta la Lambda y 30 s API Gateway: el aviso tiene que llegar antes."""
    from server.app import LENTA_MS
    assert 0 < LENTA_MS < 29_000


# ---------------------------------------------------------------------------
# el orden de la pila

def test_el_registro_envuelve_al_de_auth():
    """Starlette apila al revés del orden de registro: el último queda fuera.

    Importa que el de peticiones sea el externo — así el tiempo que mide es el
    que espera el usuario, con la validación del token dentro.
    """
    from server.app import app

    nombres = [getattr(getattr(m, "kwargs", {}).get("dispatch"), "__name__", None)
               for m in app.user_middleware]
    assert nombres[:2] == ["_registrar_peticion", "middleware"], nombres
