"""M15 — «Editor de imágenes» (inpainting con Flux Fill). Sin red: fal se
finge con monkeypatch y las imágenes viven en tmp_path."""
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def cliente():
    from server.app import app
    return TestClient(app)


@pytest.fixture
def srv():
    from server import app as srv
    return srv


def _fd(prompt="quita el letrero"):
    return {"prompt": prompt}


def _files():
    return {"imagen": ("imagen.jpg", b"jpg-original", "image/jpeg"),
            "marcada": ("marcada.jpg", b"jpg-marcada", "image/jpeg")}


def test_editar_imagen_genera_y_sirve(cliente, srv, monkeypatch, tmp_path):
    from pipeline import media_fal

    async def fake_fill(prompt, imagen, marcada, destino, **kw):
        assert "quita el letrero" in prompt
        assert imagen.read_bytes() == b"jpg-original"
        assert marcada.read_bytes() == b"jpg-marcada"
        destino.write_bytes(b"jpg-editado")
        return "https://fal/x.jpg"

    monkeypatch.setattr(media_fal, "imagen_pincel", fake_fill)
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    r = cliente.post("/api/imagenes/editar", data=_fd(), files=_files())
    assert r.status_code == 200
    url = r.json()["url"]
    assert url.startswith("/api/imagenes/")
    r2 = cliente.get(url)
    assert r2.status_code == 200 and r2.content == b"jpg-editado"


def test_editar_imagen_valida_entradas(cliente, srv, monkeypatch, tmp_path):
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    # sin prompt
    r = cliente.post("/api/imagenes/editar", data=_fd("  "), files=_files())
    assert r.status_code == 422
    # imagen vacía
    r = cliente.post("/api/imagenes/editar", data=_fd(),
                     files={"imagen": ("i.jpg", b"", "image/jpeg"),
                            "marcada": ("m.jpg", b"jpg", "image/jpeg")})
    assert r.status_code == 422
    # imagen demasiado grande
    r = cliente.post("/api/imagenes/editar", data=_fd(),
                     files={"imagen": ("i.jpg", b"x" * (15 * 1024 * 1024 + 1), "image/jpeg"),
                            "marcada": ("m.jpg", b"jpg", "image/jpeg")})
    assert r.status_code == 422


def test_editar_imagen_cobra_y_devuelve_en_fallo(cliente, srv, monkeypatch, tmp_path):
    from pipeline import creditos, media_fal

    async def fill_roto(prompt, imagen, marcada, destino, **kw):
        raise RuntimeError("fal caído")

    movimientos = []
    monkeypatch.setattr(media_fal, "imagen_pincel", fill_roto)
    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "costo_imagen", lambda: 2)
    monkeypatch.setattr(creditos, "cobrar", lambda c, ref: movimientos.append(("cobro", c, ref)))
    monkeypatch.setattr(creditos, "devolver", lambda c, ref: movimientos.append(("devolucion", c, ref)))
    r = cliente.post("/api/imagenes/editar", data=_fd(), files=_files())
    assert r.status_code == 502
    assert movimientos == [("cobro", 2, "imagen:editor"), ("devolucion", 2, "imagen:editor")]


def test_editar_imagen_sin_saldo(cliente, srv, monkeypatch, tmp_path):
    from pipeline import creditos

    def sin_saldo(c, ref):
        raise creditos.SinSaldo(2, 0)

    monkeypatch.setattr(srv, "_dir_imagenes", lambda: tmp_path / "_imagenes")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    r = cliente.post("/api/imagenes/editar", data=_fd(), files=_files())
    assert r.status_code == 402


def test_el_menu_lleva_a_la_herramienta_unica_de_imagenes():
    """M23: crear y editar imágenes son una sola página y una sola entrada del
    menú; las dos páginas viejas ya no existen (sus URLs redirigen)."""
    from pathlib import Path
    html = Path("static/index.html").read_text(encoding="utf-8")
    menu = html[html.index('<nav aria-label="Secciones">'):html.index("</nav>")]
    assert menu.count('href="/imagenes.html"') == 1
    assert "Crear imágenes" in menu
    assert "Editor de imágenes" not in html
    assert "/crear-imagenes.html" not in html and "/editor-imagenes.html" not in html
    assert not Path("static/crear-imagenes.html").exists()
    assert not Path("static/editor-imagenes.html").exists()
