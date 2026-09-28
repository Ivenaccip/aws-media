"""UI·6 — la tubería de la UI nueva: web/ → etapa web del Dockerfile → web/dist
→ server/web.py (docs/PLAN-UI.md §3).

Lo que se fija aquí es lo que ningún test de vitest puede ver:

  · la etapa web usa el MISMO Node que la imagen (una sola versión en el build)
    y corre tipos, lint y tests antes de compilar: un fallo tumba el build;
  · las versiones de web/package.json son exactas y no entra nada prohibido
    (next, gsap, axios, motion);
  · pricing.json no llega al navegador, ni por import ni dentro de dist/;
  · server/web.py monta dist solo si existe, con immutable en los assets,
    no-cache en el HTML y 404 (no HTML) para un asset que no existe;
  · las listas que web/ duplica a propósito (verbos de cobro, iconos) no se
    separan de su original.

Sin red y sin Node: lee texto y levanta apps de FastAPI en memoria. Los tests
sobre el dist real se saltan si no se ha compilado (en la imagen siempre está).
"""
import json
import re
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

RAIZ = Path(__file__).resolve().parent.parent
WEB = RAIZ / "web"
DIST = WEB / "dist"
DOCKERFILE = RAIZ / "Dockerfile"


def _codigo_docker() -> str:
    return "\n".join(l for l in DOCKERFILE.read_text(encoding="utf-8").splitlines()
                     if not l.lstrip().startswith("#"))


def _paquete() -> dict:
    return json.loads((WEB / "package.json").read_text(encoding="utf-8"))


# ---------------------------------------------------------------------------
# Dockerfile

def test_la_etapa_web_usa_el_mismo_node_que_la_imagen():
    codigo = _codigo_docker()
    etapa = re.findall(r"^FROM node:(\S+) AS web$", codigo, re.M)
    copia = set(re.findall(r"COPY --from=node:(\S+)", codigo))
    assert etapa, "no hay etapa `FROM node:… AS web`"
    assert {etapa[0]} == copia, f"dos Node en el build: etapa web {etapa[0]} vs imagen {copia}"


def test_nvmrc_dice_el_mismo_node_que_el_dockerfile():
    tag = re.search(r"^FROM node:(\d+\.\d+\.\d+)-", _codigo_docker(), re.M).group(1)
    assert (WEB / ".nvmrc").read_text(encoding="utf-8").strip() == tag


def test_la_etapa_web_verifica_antes_de_compilar_y_su_dist_entra_a_la_imagen():
    codigo = _codigo_docker()
    etapa = codigo[codigo.index("AS web"):codigo.index("FROM python:")]
    assert "npm ci" in etapa and "RUN npm run verificar" in etapa
    assert etapa.index("npm --version") < etapa.index("npm ci")
    # UI·19: el test de monedero.js vive en vitest; sin el archivo no corre
    assert etapa.index("COPY static/monedero.js /repo/static/monedero.js") < etapa.index("RUN npm run verificar")
    verificar = _paquete()["scripts"]["verificar"]
    for paso in ("tipos", "lint", "test", "build"):
        assert f"npm run {paso}" in verificar, f"`verificar` ya no corre {paso}"
    assert verificar.rstrip().endswith("npm run build"), "compilar va al final, tras los gates"
    assert "COPY --from=web /repo/web/dist web/dist" in codigo
    # y después del COPY . . (si no, el COPY . . lo pisaría con lo que haya local)
    assert codigo.index("COPY . .") < codigo.index("COPY --from=web")


def test_pricing_json_no_entra_a_la_etapa_web():
    codigo = _codigo_docker()
    etapa = codigo[codigo.index("AS web"):codigo.index("FROM python:")]
    assert "pricing.json" not in etapa


def test_dist_y_node_modules_no_se_comitean_ni_viajan_en_el_contexto():
    assert "web/dist/" in (RAIZ / ".gitignore").read_text(encoding="utf-8")
    ignora = (RAIZ / ".dockerignore").read_text(encoding="utf-8")
    assert "web/dist/" in ignora and "**/node_modules/" in ignora


# ---------------------------------------------------------------------------
# web/package.json

PROHIBIDAS = {
    "next": "necesita Node en runtime",
    "gsap": "no es MIT",
    "axios": "se salta el fetch de auth.js",
    "motion": "solo en la portada, y la portada no es web/",
    "framer-motion": "igual que motion",
}


def test_versiones_exactas_y_npmrc_estricto():
    p = _paquete()
    for seccion in ("dependencies", "devDependencies"):
        for nombre, version in p.get(seccion, {}).items():
            assert re.fullmatch(r"\d+\.\d+\.\d+", version), f"{nombre}@{version} no es exacta"
    npmrc = (WEB / ".npmrc").read_text(encoding="utf-8")
    assert "engine-strict=true" in npmrc and "save-exact=true" in npmrc
    assert (WEB / "package-lock.json").is_file(), "sin lockfile, npm ci no reproduce nada"


def test_ninguna_dependencia_prohibida():
    p = _paquete()
    todas = {**p.get("dependencies", {}), **p.get("devDependencies", {})}
    malas = {n: PROHIBIDAS[n] for n in todas if n in PROHIBIDAS}
    assert not malas, malas


def test_el_lockfile_tampoco_trae_prohibidas():
    lock = json.loads((WEB / "package-lock.json").read_text(encoding="utf-8"))
    presentes = {Path(k).name for k in lock.get("packages", {}) if k}
    assert not (presentes & set(PROHIBIDAS)), presentes & set(PROHIBIDAS)


# ---------------------------------------------------------------------------
# pricing.json fuera del cliente

def _fuentes_web():
    return [p for p in WEB.rglob("*") if p.is_file()
            and not {"node_modules", "dist", "playwright-report", "test-results"} & set(p.relative_to(WEB).parts)
            and p.suffix in {".ts", ".tsx", ".js", ".html", ".css"}]


def test_ningun_fuente_de_web_importa_pricing_json():
    for f in _fuentes_web():
        texto = f.read_text(encoding="utf-8")
        for linea in texto.splitlines():
            if "pricing.json" in linea and re.search(r"\b(import|from|require)\b", linea):
                pytest.fail(f"{f.relative_to(RAIZ)} importa pricing.json → {linea.strip()}")


def test_eslint_tambien_lo_prohibe():
    cfg = (WEB / "eslint.config.js").read_text(encoding="utf-8")
    assert "**/pricing.json" in cfg and "dangerouslySetInnerHTML" in cfg and "axios" in cfg


def _claves(d, acc=None) -> set[str]:
    acc = set() if acc is None else acc
    if isinstance(d, dict):
        for k, v in d.items():
            acc.add(k)
            _claves(v, acc)
    elif isinstance(d, list):
        for v in d:
            _claves(v, acc)
    return acc


def _textos_dist() -> str:
    if not DIST.is_dir():
        pytest.skip("web/dist no está compilado (npm run build); en la imagen siempre está")
    return "\n".join(p.read_text(encoding="utf-8", errors="replace")
                     for p in DIST.rglob("*") if p.suffix in {".js", ".html", ".css"})


def test_el_dist_no_trae_nada_de_pricing_json():
    """Cualquier clave propia de pricing.json delata que se coló. Solo las
    compuestas (con «_», p. ej. `veo31_lite_usd_por_segundo`): las palabras
    sueltas como «fallback» salen en el código de React sin decir nada."""
    texto = _textos_dist()
    pricing = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))
    tarifas = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    solo_pricing = {k for k in _claves(pricing) - _claves(tarifas) if "_" in k and len(k) >= 8}
    # UI·8.4: `usd_por_mes` es también el NOMBRE de un campo de /api/blotato
    # (`plan`): el server manda a propósito el precio del plan de Blotato para
    # avisar ANTES de pedir la clave, y la pantalla lo lee por su nombre. El
    # valor llega en la respuesta, no en el dist.
    solo_pricing -= {"usd_por_mes"}
    assert solo_pricing, "la prueba se quedó sin claves que buscar"
    coladas = sorted(k for k in solo_pricing if k in texto)
    assert not coladas, f"claves de pricing.json en web/dist: {coladas[:10]}"


def test_el_dist_no_trae_las_notas_ni_la_economia_de_tarifas():
    texto = _textos_dist()
    for prohibido in ("costo_interno_usd_por_credito", "piso_venta_usd_por_credito",
                      "nota_por_duracion", "verified_on", "pricing.json"):
        assert prohibido not in texto, prohibido


def test_cada_pantalla_se_pinta_con_su_modulo():
    """UI·18: el módulo de cada pantalla bloquea el primer pintado. Sin
    `blocking="render"` la View Transition entre pantallas se cancelaba en
    1 de cada 3 navegaciones (la página nueva se fotografiaba vacía). Vite
    tira el atributo del index.html fuente: lo pone el plugin
    pintarConElModulo de vite.config.ts, y aquí se mira en el HTML final."""
    if not DIST.is_dir():
        pytest.skip("web/dist no está compilado (npm run build); en la imagen siempre está")
    paginas = sorted((DIST / "estudio").glob("*/index.html"))
    assert paginas, "dist sin pantallas"
    for html in paginas:
        modulos = re.findall(r"<script type=\"module\"[^>]*>", html.read_text(encoding="utf-8"))
        assert modulos, f"{html.parent.name}: sin módulo"
        for m in modulos:
            assert 'blocking="render"' in m, f"{html.parent.name}: {m}"


# ---------------------------------------------------------------------------
# server/web.py

@pytest.fixture
def dist_falso(tmp_path):
    estudio = tmp_path / "estudio"
    (estudio / "_vitrina").mkdir(parents=True)
    (estudio / "_vitrina" / "index.html").write_text("<!doctype html><title>v</title>", encoding="utf-8")
    (estudio / "clip").mkdir()
    (estudio / "clip" / "index.html").write_text("<!doctype html><title>c</title>", encoding="utf-8")
    (estudio / "sin-index").mkdir()
    (estudio / "assets").mkdir()
    (estudio / "assets" / "clip-Ab12Cd34.js").write_text("console.log(1)", encoding="utf-8")
    return tmp_path


def _app(dist):
    from server import web
    app = FastAPI()
    montadas = web.montar(app, dist)
    return app, montadas


def test_sin_dist_no_se_monta_nada(tmp_path):
    app, montadas = _app(tmp_path / "no-existe")
    assert montadas == []
    assert TestClient(app).get("/estudio/_vitrina/").status_code == 404


def test_monta_cada_pantalla_y_los_assets(dist_falso):
    _, montadas = _app(dist_falso)
    assert montadas == ["/estudio/assets", "/estudio/_vitrina", "/estudio/clip"]


def test_el_html_revalida_y_los_assets_son_inmutables(dist_falso):
    c = TestClient(_app(dist_falso)[0])
    html = c.get("/estudio/clip/")
    assert html.status_code == 200 and "text/html" in html.headers["content-type"]
    assert html.headers["cache-control"] == "no-cache"
    assert "x-robots-tag" not in html.headers
    js = c.get("/estudio/assets/clip-Ab12Cd34.js")
    assert js.status_code == 200
    assert js.headers["cache-control"] == "public, max-age=31536000, immutable"


def test_la_vitrina_no_se_indexa(dist_falso):
    r = TestClient(_app(dist_falso)[0]).get("/estudio/_vitrina/")
    assert r.headers["x-robots-tag"] == "noindex, nofollow"


def test_un_asset_que_no_existe_da_404_y_no_html(dist_falso):
    r = TestClient(_app(dist_falso)[0]).get("/estudio/assets/no-existe.js")
    assert r.status_code == 404
    assert "text/html" not in r.headers.get("content-type", "")


def test_en_la_app_real_web_va_antes_que_la_raiz():
    """Si montar() quedara detrás de app.mount("/"), «/» se tragaría la UI nueva."""
    fuente = (RAIZ / "server" / "app.py").read_text(encoding="utf-8")
    assert fuente.index("web.montar(app)") < fuente.index('app.mount("/"')


def test_la_app_real_sirve_la_vitrina_si_esta_compilada(monkeypatch):
    if not (DIST / "estudio" / "_vitrina" / "index.html").is_file():
        pytest.skip("web/dist no está compilado")
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    c = TestClient(app)
    r = c.get("/estudio/_vitrina/")
    assert r.status_code == 200 and r.headers["x-robots-tag"] == "noindex, nofollow"
    assets = re.findall(r'(/estudio/assets/[^"]+\.(?:js|css))', r.text)
    assert assets, "el HTML de la vitrina no enlaza sus assets"
    for a in assets:
        ra = c.get(a)
        assert ra.status_code == 200 and "immutable" in ra.headers["cache-control"], a
    # las rutas de siempre siguen donde estaban: /estudio/ sirve el inicio, o
    # con `inicio` en `todos` lleva por 302 al nuevo
    r = c.get("/estudio/")
    assert r.status_code == 200 and r.url.path in ("/estudio/", "/estudio/inicio/")


# ---------------------------------------------------------------------------
# listas que web/ duplica a propósito

def test_los_verbos_de_cobro_son_los_de_m21():
    from tests.test_m21_botones import VERBOS
    ts = (WEB / "src" / "marca" / "verbos.ts").read_text(encoding="utf-8")
    bloque = ts[ts.index("VERBOS = ["):ts.index("] as const")]
    assert set(re.findall(r"'([^']+)'", bloque)) == VERBOS


def test_los_iconos_son_los_de_iconos_js():
    def trazos(texto: str, inicio: str) -> dict:
        i = texto.index(inicio)
        return dict(re.findall(r"^\s*(\w+): '([^']*)',", texto[i:texto.index("}", i)], re.M))
    viejos = trazos((RAIZ / "static" / "iconos.js").read_text(encoding="utf-8"), "const TRAZOS = {")
    nuevos = trazos((WEB / "src" / "ui" / "iconos.ts").read_text(encoding="utf-8"), "export const TRAZOS = {")
    assert viejos and nuevos == viejos


# ---------------------------------------------------------------------------
# /actualizar compila web/ y sabe decir por qué no

@pytest.mark.parametrize("version,esperado", [
    ("v20.20.2", None), ("v22.22.2", None), ("v20.19.0", None),
    ("v20.18.1", "pide 20.19"), ("v18.20.4", "pide 20.19"),
])
def test_actualizar_pide_node_20_19_para_la_web(monkeypatch, version, esperado):
    import subprocess
    import tools.update as up
    monkeypatch.setattr(up.shutil, "which", lambda n: "/bin/node" if n == "node" else None)
    monkeypatch.setattr(up.subprocess, "run",
                        lambda *a, **k: subprocess.CompletedProcess(a, 0, stdout=version + "\n"))
    problema = up.problema_de_node_para_web()
    if esperado is None:
        assert problema is None
    else:
        assert esperado in problema


def test_actualizar_sin_node_no_revienta(monkeypatch):
    import tools.update as up
    monkeypatch.setattr(up.shutil, "which", lambda n: None)
    assert "no esta en el PATH" in up.problema_de_node_para_web()
    assert up.construir_web(None) is False
