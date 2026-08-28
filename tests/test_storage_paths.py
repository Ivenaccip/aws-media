"""F4.3: MEDIA_ROOT redirige videos/ (editor) y work/ (generador) sin recargar
módulos — los helpers leen el env en cada llamada."""
import pytest

from pipeline import storage


def test_default_es_raiz_del_repo(monkeypatch):
    monkeypatch.delenv("MEDIA_ROOT", raising=False)
    monkeypatch.delenv("WORK_DIR", raising=False)
    assert storage.media_root() == storage._REPO
    assert storage.videos_root() == storage._REPO / "videos"
    assert storage.work_root() == storage._REPO / "work"


def test_media_root_redirige(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.delenv("WORK_DIR", raising=False)
    raiz = tmp_path.resolve()
    assert storage.videos_root() == raiz / "videos"
    assert storage.ruta_proyecto("gen-x") == raiz / "videos" / "gen-x"
    assert storage.work_root() == raiz / "work"


def test_work_dir_explicito_manda(tmp_path, monkeypatch):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("WORK_DIR", str(tmp_path / "otro"))
    assert storage.work_root() == tmp_path / "otro"


def test_nombre_de_proyecto_invalido():
    for malo in ("", "../gen-x", "a/b", "a\\b", "a b", "gen.x"):
        with pytest.raises(ValueError):
            storage.ruta_proyecto(malo)


def test_nombres_reales_pasan():
    for bueno in ("gen-tesla", "video-1", "mi_proyecto2"):
        assert storage.ruta_proyecto(bueno).name == bueno
