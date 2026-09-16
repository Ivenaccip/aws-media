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
