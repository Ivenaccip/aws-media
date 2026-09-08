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

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pipeline.config  # noqa: E402,F401 — load_dotenv() una sola vez, aquí
