"""tools/probe_fal.py: el ensayo no gasta, la prueba pide --si y la clave no se imprime."""
from __future__ import annotations

import importlib.util
import sys
import types
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
_spec = importlib.util.spec_from_file_location("probe_fal", RAIZ / "tools" / "probe_fal.py")
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)

ARGS = '{"prompt": "un gato", "image_size": "square_hd", "num_images": 1}'


def _fal_falso(monkeypatch, imagenes):
    llamadas = []

    def subscribe(endpoint, arguments):
        llamadas.append((endpoint, arguments))
        return {"images": imagenes}

    monkeypatch.setitem(sys.modules, "fal_client", types.SimpleNamespace(subscribe=subscribe))
    return llamadas


def test_sin_si_es_un_ensayo_y_no_llama_a_fal(monkeypatch, capsys):
    llamadas = _fal_falso(monkeypatch, [])
    code = probe.main(["fal-ai/flux-2/klein/9b", "--usd-por-mp", "0.006", "--args", ARGS])
    salida = capsys.readouterr().out
    assert code == 0 and llamadas == []
    assert "ENSAYO" in salida and "NO se llamó a nada" in salida
    assert "$0.0063" in salida  # 0.006 × 1.048576 MP, proporcional


def test_con_si_llama_n_veces_y_promedia(monkeypatch, capsys):
    monkeypatch.setenv("FAL_KEY", "clave-de-prueba")
    llamadas = _fal_falso(monkeypatch, [{"width": 1024, "height": 1024, "url": "https://x/y.png"}])
    code = probe.main(["fal-ai/flux-2/klein/9b", "--usd-por-mp", "0.006", "--n", "2", "--si", "--args", ARGS])
    salida = capsys.readouterr().out
    assert code == 0 and len(llamadas) == 2
    assert llamadas[0] == ("fal-ai/flux-2/klein/9b", {"prompt": "un gato", "image_size": "square_hd", "num_images": 1})
    assert "PROMEDIO" in salida and "proporcional" in salida and "redondeado" in salida
    assert "clave-de-prueba" not in salida


def test_dos_corridas_a_la_misma_carpeta_no_se_pisan(monkeypatch, tmp_path):
    monkeypatch.setenv("FAL_KEY", "clave-de-prueba")
    _fal_falso(monkeypatch, [{"width": 1024, "height": 1024, "url": "https://x/y.png"}])
    contenidos = iter([b"primera", b"segunda", b"tercera"])
    monkeypatch.setitem(sys.modules, "httpx", types.SimpleNamespace(
        get=lambda url, **kw: types.SimpleNamespace(content=next(contenidos))))
    for _ in range(3):
        assert probe.main(["fal-ai/x", "--salida", str(tmp_path), "--n", "1", "--si", "--args", ARGS]) == 0
    guardados = {p.name: p.read_bytes() for p in tmp_path.iterdir()}
    assert guardados == {"fal-ai_x-1-0.png": b"primera",
                         "fal-ai_x-1-0_2.png": b"segunda",
                         "fal-ai_x-1-0_3.png": b"tercera"}


def test_sin_clave_no_llama_y_no_la_imprime(monkeypatch, capsys):
    monkeypatch.delenv("FAL_KEY", raising=False)
    monkeypatch.setattr(probe, "_cargar_env", lambda: None)
    llamadas = _fal_falso(monkeypatch, [])
    code = probe.main(["fal-ai/flux-2/klein/9b", "--si", "--args", ARGS])
    assert code == 2 and llamadas == []
    assert "FAL_KEY" in capsys.readouterr().err


def test_n_fuera_de_rango_se_rechaza(capsys):
    assert probe.main(["fal-ai/x", "--n", "50", "--si"]) == 2
    assert "prueba pequeña" in capsys.readouterr().err
