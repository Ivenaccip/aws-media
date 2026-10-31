"""Rutas por nivel · el `web/dist` compilado (docs/migracion/inicio.md · «Rutas por nivel»).

Cada nivel del recorrido (la principal, las áreas, los grupos) es una página aparte y la Caja (Imagen, Video, Edición) es una sola
página con tres direcciones. Esta mitad mira el dist: lo que de verdad le llega al navegador. La mitad del servidor (barra final,
mayúsculas, 404 con página…, con un dist falso) está en tests/test_web_rutas.py.

  · las páginas de NAVEGACIÓN (entrada `nivel-*`) no traen la Caja y pesan lo suyo: React y el recorrido, nada más;
  · las tres de HERRAMIENTA (entrada `herramienta-*`) SÍ traen la Caja, y pesan lo que pesa la Caja;
  · todo `<script type="module">` de todo nivel bloquea el primer pintado (UI·18; test_web_tuberia.py revisa lo mismo, aquí se
    exige además que existan los niveles que el código fuente declara);
  · la app real (server/app.py) sirve cada nivel y corrige la barra final;
  · E7: la carpeta plana de cada hoja que se mudó a la de su lugar (/estudio/coi/ → /estudio/central/distrito/coi/) lleva ahí con un 302,
    y su URL vieja (/coi.html) también, según su etapa.

Las páginas que se esperan salen de web/estudio/ (el código fuente), no de una lista aquí: una página nueva entra sola. Un dist de
ANTES de las rutas por nivel falla con el aviso de recompilar (`cd web && npm run build`) en vez de saltarse: en la imagen siempre
está al día.

Lo que E4 le hizo al peso de las pantallas que YA existían (medido con `git archive HEAD` contra el árbol de trabajo): ninguna pierde
comportamiento, pero el build reparte distinto los módulos que ahora comparten con las páginas nuevas.
  · las 16 de siempre (agenda, métricas, clip, COI, Mix…) piden UN archivo de JS más (`Boton-*.js`, módulo que dejó de ser de una sola
    pantalla) y +0,2 a 0,3 kB gzip: es el costo del chunk compartido, no una fuga; no se vigila pantalla por pantalla;
  · /estudio/inicio/ (la página única de antes) pasó de 23 a 28 archivos y de 139,3 a 143,4 kB gzip al compartir chunks con ellas. Esa
    página se retiró en E5.3: ya no existe en el dist y /estudio/inicio/ es un 302 a la principal
    (`test_la_pagina_unica_de_antes_ya_no_esta_en_el_dist`, `test_un_marcador_de_la_pagina_unica_llega_a_la_herramienta_con_la_app_real`).
"""
from __future__ import annotations

import gzip
import random
import re
import string
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from server import migracion, web

RAIZ = Path(__file__).resolve().parent.parent
DIST = web.DIST
ESTUDIO = DIST / "estudio"
FUENTE = RAIZ / "web" / "estudio"

en_dist = pytest.mark.skipif(
    not (ESTUDIO / "assets").is_dir(), reason="web/dist no está compilado (npm run build); en la imagen siempre está",
)

# Las entradas que declara el HTML fuente (web/src/marca/paginas.ts las pone): una por tipo de página.
ENTRADA_NIVEL = "/src/pantallas/inicio/niveles/nivel.tsx"
ENTRADA_HERRAMIENTA = "/src/pantallas/inicio/herramienta.tsx"

# Textos que SOLO trae la Caja (Caja.tsx, CajaEdicion, Galería): si aparecen en una página de navegación, esa página cargó la Caja.
MARCAS_DE_LA_CAJA = ("¿Qué vamos a crear hoy?", "Qué quieres crear", "Elegir de Mis creaciones")

# Lo que pesa el JS (comprimido con gzip) que una página pide al cargar, sin contar los `import()` (esos se piden al usarlos).
# Navegación: React (~72 kB) + el recorrido. Medido al construir las rutas por nivel: ~80 000 B en 6 archivos (con la Caja, la página
# única de antes, 143 400 B). Herramienta: la Caja; medido 144 000 B.
TOPE_GZIP_DE_NIVEL = 90_000
TOPE_GZIP_DE_HERRAMIENTA = 150_000
# Lo que protege a una página de navegación son los BYTES y la AUSENCIA de la Caja. La cuenta de archivos no la decide el código de las
# páginas de nivel sino el partidor de chunks del build: una pantalla ajena que importe un módulo de los de nivel (o una reubicación en
# E5/E7/E8) le suma un archivo a las 13 páginas sin que pese un byte más ni se cuele la Caja. Por eso el tope NO es lo medido: deja
# holgura y solo atrapa un partidor desbocado (decenas de archivos pequeños, uno por viaje).
ARCHIVOS_DE_NIVEL_MEDIDOS = 6   # Icono, Aviso, Migas, NoEncontrada, navegar y nivel; si cambia, es información, no un fallo
TOPE_ARCHIVOS_DE_NIVEL = 10


def _carpetas_fuente(entrada: str) -> set[str]:
    """Las carpetas de web/estudio/ (fuente) cuyo index.html monta esa entrada; «» es la principal (web/estudio/index.html)."""
    carpetas = set()
    for html in FUENTE.rglob("index.html"):
        if entrada in html.read_text(encoding="utf-8"):
            rel = html.parent.relative_to(FUENTE).as_posix()
            carpetas.add("" if rel == "." else rel)
    return carpetas


def _html_de(carpeta: str):
    return ESTUDIO / carpeta / "index.html" if carpeta else ESTUDIO / "index.html"


def _url_de(carpeta: str) -> str:
    return f"/estudio/{carpeta}/" if carpeta else "/estudio/"


def _entradas(html: str) -> list[str]:
    """Los módulos que la página pide: con varias páginas sobre una misma entrada, el build lista cada archivo compartido como
    `<script type="module">` (y de ahí sale el nombre de la entrada: `nivel-<hash>.js`, `herramienta-<hash>.js`)."""
    return re.findall(r'<script type="module"[^>]*src="/estudio/assets/([^"]+)"', html)


def _cierre(entradas: list[str]) -> dict[str, str]:
    """Las entradas y todo lo que importan de forma ESTÁTICA (un `import()` se pide al usarlo y no cuenta)."""
    visto: dict[str, str] = {}
    pendientes = list(entradas)
    while pendientes:
        nombre = pendientes.pop()
        if nombre in visto:
            continue
        texto = (ESTUDIO / "assets" / nombre).read_text(encoding="utf-8")
        visto[nombre] = texto
        pendientes += [m[2:] for m in re.findall(r'(?:from|import)\s*["\'](\./[^"\']+\.js)["\']', texto)]
    return visto


def _paginas_de(prefijo: str) -> dict[str, dict[str, str]]:
    """{carpeta: cierre estático de sus módulos} de las páginas del dist cuya entrada empieza por `prefijo` (a cualquier profundidad)."""
    out = {}
    for html in sorted(ESTUDIO.rglob("index.html")):
        rel = html.parent.relative_to(ESTUDIO).as_posix()
        if rel.split("/")[0] == "assets":
            continue
        entradas = _entradas(html.read_text(encoding="utf-8"))
        if any(e.startswith(prefijo) for e in entradas):
            out["" if rel == "." else rel] = _cierre(entradas)
    return out


def _gzip(cierre: dict[str, str]) -> int:
    return sum(len(gzip.compress(t.encode("utf-8"))) for t in cierre.values())


@en_dist
def test_el_dist_trae_cada_pagina_de_nivel_que_declara_el_codigo_con_su_entrada():
    """Sin esto, las pruebas de abajo pasarían sin mirar nada con un dist que no trae las páginas (uno de antes de las rutas por nivel)."""
    nivel, herramienta = _carpetas_fuente(ENTRADA_NIVEL), _carpetas_fuente(ENTRADA_HERRAMIENTA)
    # el código fuente: la principal, un área y un grupo; y las tres herramientas de la Caja
    assert {"", "marketing", "marketing/distrito"} <= nivel, nivel
    assert herramienta == {f"marketing/distrito/{h}" for h in ("imagen", "video", "edicion")}, herramienta
    construidas_nivel, construidas_herramienta = _paginas_de("nivel-"), _paginas_de("herramienta-")
    faltan = {c for c in nivel if not _html_de(c).is_file()} | {c for c in herramienta if not _html_de(c).is_file()}
    assert not faltan, f"el dist no trae {sorted(faltan)}: ¿es de antes de las rutas por nivel? Compila con «cd web && npm run build»"
    assert set(construidas_nivel) == nivel, (sorted(construidas_nivel), sorted(nivel))
    assert set(construidas_herramienta) == herramienta, (sorted(construidas_herramienta), sorted(herramienta))
    # una página es de navegación o de herramienta, nunca las dos
    assert not set(construidas_nivel) & set(construidas_herramienta)


def _revisar_pagina_de_navegacion(carpeta: str, cierre: dict[str, str]) -> None:
    """Lo que se le exige a una página de navegación (cierre = {archivo: texto} de sus módulos estáticos): sin la Caja, bajo el tope de
    bytes y bajo el tope (holgado) de archivos."""
    todo = "".join(cierre.values())
    for marca in MARCAS_DE_LA_CAJA:
        assert marca not in todo, f"{_url_de(carpeta)}: trae la Caja ({marca!r})"
    gz = _gzip(cierre)
    assert gz <= TOPE_GZIP_DE_NIVEL, f"{_url_de(carpeta)}: {gz} B de JS comprimido (tope {TOPE_GZIP_DE_NIVEL})"
    assert len(cierre) <= TOPE_ARCHIVOS_DE_NIVEL, (
        f"{_url_de(carpeta)}: {len(cierre)} archivos de JS (tope {TOPE_ARCHIVOS_DE_NIVEL}, medidos {ARCHIVOS_DE_NIVEL_MEDIDOS}): {sorted(cierre)}"
    )


@en_dist
def test_una_pagina_de_navegacion_no_trae_la_caja_y_pesa_lo_suyo():
    paginas = _paginas_de("nivel-")
    assert len(paginas) >= 13, sorted(paginas)
    for carpeta, cierre in paginas.items():
        _revisar_pagina_de_navegacion(carpeta, cierre)


def _cierre_falso(archivos: int, gz_total: int = 20_000, extra: str = "") -> dict[str, str]:
    """Un cierre inventado de `archivos` módulos que comprimen a ~`gz_total` B (texto casi incompresible, repetible)."""
    azar = random.Random(7)
    por_archivo = int(gz_total / max(archivos, 1) / 0.75)
    return {
        f"m{i}.js": "".join(azar.choices(string.ascii_letters + string.digits, k=por_archivo)) + (extra if i == 0 else "")
        for i in range(archivos)
    }


def test_el_tope_de_archivos_deja_holgura_y_los_bytes_y_la_caja_siguen_mordiendo():
    """Regresión de «el tope era exacto (6 = lo medido)»: un chunk compartido nuevo, que el partidor de chunks del build puede crear por
    una pantalla ajena, rompía las 13 páginas con el peso intacto. No necesita el dist: revisa cierres inventados."""
    assert TOPE_ARCHIVOS_DE_NIVEL >= ARCHIVOS_DE_NIVEL_MEDIDOS + 2
    # lo medido, y dos archivos de más: pasan
    for n in (ARCHIVOS_DE_NIVEL_MEDIDOS, ARCHIVOS_DE_NIVEL_MEDIDOS + 1, ARCHIVOS_DE_NIVEL_MEDIDOS + 2):
        _revisar_pagina_de_navegacion("marketing", _cierre_falso(n))
    # un partidor desbocado sí se atrapa, aunque pese poco
    with pytest.raises(AssertionError, match="archivos de JS"):
        _revisar_pagina_de_navegacion("marketing", _cierre_falso(TOPE_ARCHIVOS_DE_NIVEL + 1))
    # y lo que de verdad protege sigue mordiendo con pocos archivos: el peso…
    pesado = _cierre_falso(ARCHIVOS_DE_NIVEL_MEDIDOS, gz_total=TOPE_GZIP_DE_NIVEL + 15_000)
    assert _gzip(pesado) > TOPE_GZIP_DE_NIVEL, "el cierre inventado debía pesar de más (ajusta _cierre_falso)"
    with pytest.raises(AssertionError, match="JS comprimido"):
        _revisar_pagina_de_navegacion("marketing", pesado)
    # …y la Caja
    for marca in MARCAS_DE_LA_CAJA:
        with pytest.raises(AssertionError, match="trae la Caja"):
            _revisar_pagina_de_navegacion("marketing", _cierre_falso(ARCHIVOS_DE_NIVEL_MEDIDOS, extra=f"x('{marca}')"))


@en_dist
def test_las_paginas_de_herramienta_si_traen_la_caja_y_pesan_lo_que_pesa_la_caja():
    """El control de la prueba de arriba: sin él, «no trae la Caja» pasaría también si esos textos ya no existieran."""
    paginas = _paginas_de("herramienta-")
    assert sorted(paginas) == ["marketing/distrito/edicion", "marketing/distrito/imagen", "marketing/distrito/video"]
    for carpeta, cierre in paginas.items():
        todo = "".join(cierre.values())
        for marca in MARCAS_DE_LA_CAJA:
            assert marca in todo, f"{_url_de(carpeta)}: no trae {marca!r} (la prueba de las páginas de navegación ya no distingue nada)"
        gz = _gzip(cierre)
        assert gz <= TOPE_GZIP_DE_HERRAMIENTA, f"{_url_de(carpeta)}: {gz} B de JS comprimido (tope {TOPE_GZIP_DE_HERRAMIENTA})"


@en_dist
def test_la_pagina_unica_de_antes_ya_no_esta_en_el_dist():
    """E5.3 retiró la página única (web/estudio/inicio/): ni las fuentes ni el dist la traen, ni su entrada (`principal.tsx`) sobrevive
    como módulo de ninguna página. Antes esta prueba le ponía a /estudio/inicio/ el mismo tope de peso que a la Caja y se SALTABA
    cuando la página se retiraba; ahora exige lo contrario, y un dist de antes falla con el aviso de recompilar en vez de saltarse."""
    assert not (FUENTE / "inicio").exists(), "web/estudio/inicio/ no vuelve: /estudio/inicio/ es un 302 a la principal"
    assert not (ESTUDIO / "inicio" / "index.html").exists(), (
        "el dist trae /estudio/inicio/: es de antes de retirar la página única. Compila con «cd web && npm run build»"
    )
    # y su chunk de entrada tampoco (el build nombra la entrada de cada página por su carpeta: `inicio-<hash>.js`, vite.config.ts::nombreDe)
    assert not [a.name for a in (ESTUDIO / "assets").glob("*.js") if a.name.startswith("inicio-")], "chunk de entrada de la página única"


@en_dist
def test_todo_modulo_de_todo_nivel_bloquea_el_primer_pintado():
    """test_web_tuberia.py mira todas las pantallas del dist; este exige además que estén las de nivel (a cualquier profundidad)."""
    paginas = _carpetas_fuente(ENTRADA_NIVEL) | _carpetas_fuente(ENTRADA_HERRAMIENTA)
    assert len(paginas) >= 16, sorted(paginas)
    for carpeta in sorted(paginas):
        html = _html_de(carpeta)
        assert html.is_file(), f"el dist no trae {_url_de(carpeta)} (compila con «cd web && npm run build»)"
        modulos = re.findall(r'<script type="module"[^>]*>', html.read_text(encoding="utf-8"))
        assert modulos, f"{_url_de(carpeta)}: sin módulo"
        for m in modulos:
            assert 'blocking="render"' in m, f"{_url_de(carpeta)}: {m}"


@en_dist
def test_la_app_real_sirve_los_niveles_y_redirige_sin_barra(monkeypatch):
    """TODAS las páginas de nivel, la principal incluida (`/estudio/`: la sirve web.py desde E5.2), con la app de verdad."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    c = TestClient(app, follow_redirects=False)
    carpetas = sorted(_carpetas_fuente(ENTRADA_NIVEL) | _carpetas_fuente(ENTRADA_HERRAMIENTA))
    assert "" in carpetas and len(carpetas) >= 16, carpetas
    for carpeta in carpetas:
        con_barra = _url_de(carpeta)
        r = c.get(con_barra)
        assert r.status_code == 200 and "text/html" in r.headers["content-type"], con_barra
        assert r.headers["cache-control"] == "no-cache", con_barra
        # y es SU página, no la de otra carpeta
        assert r.text.replace("\r\n", "\n") == _html_de(carpeta).read_text(encoding="utf-8").replace("\r\n", "\n"), con_barra
        sin_barra = con_barra.rstrip("/")
        r = c.get(sin_barra + "?x=1")
        assert r.status_code == 302 and r.headers["location"] == con_barra + "?x=1", sin_barra
        # el 302 de un nivel anidado lo da web.py y el de `/estudio`, la ruta de server/app.py: los dos `no-store`
        assert r.headers["cache-control"] == "no-store", sin_barra


@en_dist
@pytest.mark.parametrize("pedido, saltos", [
    ("/estudio/inicio/?prompt=x", ["/estudio/?prompt=x", "/estudio/marketing/distrito/imagen/?prompt=x"]),
    ("/estudio/inicio/?prompt=un%20faro%20azul", ["/estudio/?prompt=un%20faro%20azul", "/estudio/marketing/distrito/imagen/?prompt=un%20faro%20azul"]),
    ("/estudio/inicio/?brief=hola", ["/estudio/?brief=hola", "/estudio/marketing/distrito/video/?brief=hola"]),
    ("/estudio/inicio/?blotato=conectar", ["/estudio/?blotato=conectar", "/estudio/marketing/blotato/?blotato=conectar"]),
    ("/estudio/inicio/", ["/estudio/"]),
    ("/estudio/inicio", ["/estudio/"]),
    ("/estudio/inicio/?desde=mkt.blotato.agenda&ver=grupos", ["/estudio/?desde=mkt.blotato.agenda&ver=grupos"]),
])
def test_un_marcador_de_la_pagina_unica_llega_a_la_herramienta_con_la_app_real(monkeypatch, pedido, saltos):
    """Con la app de verdad y el dist de verdad: GET /estudio/inicio/?prompt=x → 302 → 302 → …/imagen/?prompt=x (la Caja en Imagen, con el
    texto en la dirección). `saltos` son los `Location` de cada 302, en orden; todos `no-store`; el último destino es una página compilada.
    Sin parámetro de antes, un solo salto a la principal (que se sirve, 200)."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    from server.app import app
    c = TestClient(app, follow_redirects=False)
    visto, url = [], pedido
    for _ in range(len(saltos)):
        r = c.get(url)
        assert r.status_code == 302 and r.headers["cache-control"] == "no-store", (url, r.status_code)
        url = r.headers["location"]
        assert url.startswith("/") and not url.startswith("//"), url          # relativo y del propio sitio
        visto.append(url)
    assert visto == saltos, pedido
    r = c.get(url)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"], url
    carpeta = url.split("?")[0].removeprefix("/estudio/").rstrip("/")
    assert r.text.replace("\r\n", "\n") == _html_de(carpeta).read_text(encoding="utf-8").replace("\r\n", "\n"), url


# Las hojas que E7 mudó de su carpeta plana a la de su lugar: cada alias de migracion.alias_del_estudio() menos el de la página única de
# antes (/estudio/inicio/ → la principal, que tiene la prueba de arriba). La lista crece sola con cada hoja que se muda.
HOJAS_MUDADAS = sorted((plana, nueva) for plana, nueva in migracion.alias_del_estudio().items() if nueva != migracion.PRINCIPAL)
# De esas, las que todavía tienen su versión clásica (en `nueva` o en `todos`, no `retirada`): su URL vieja (/agenda.html) la decide el
# interruptor de server/migracion.py y no el alias.
HOJAS_CON_CLASICA = [(plana, nueva) for plana, nueva in HOJAS_MUDADAS
                     if migracion.PANTALLAS[plana.removeprefix("/estudio/").rstrip("/")].etapa != "retirada"]
QUERY = "?x=1&y=a%20b"


def test_la_lista_de_hojas_mudadas_no_esta_vacia_y_no_trae_la_principal():
    """Sin esto, un alias que deja de deducirse (una `nueva` que vuelve a la plana) vaciaría la prueba de abajo y pasaría sin mirar nada."""
    assert ("/estudio/coi/", "/estudio/central/distrito/coi/") in HOJAS_MUDADAS
    assert ("/estudio/biblioteca/", "/estudio/central/distrito/biblioteca/") in HOJAS_MUDADAS
    assert ("/estudio/constructor/", "/estudio/automatizaciones/distrito/constructor/") in HOJAS_MUDADAS
    assert ("/estudio/asistente/", "/estudio/automatizaciones/distrito/asistente/") in HOJAS_MUDADAS
    assert ("/estudio/agenda/", "/estudio/marketing/blotato/agenda/") in HOJAS_MUDADAS
    # la Agenda es la primera mudada que todavía tiene su clásica: sin ella, la prueba de su URL vieja por etapa no mira nada
    assert ("/estudio/agenda/", "/estudio/marketing/blotato/agenda/") in HOJAS_CON_CLASICA
    # la Competencia (E7.6), su hermana de Marketing › Blotato, también sigue en `nueva`
    assert ("/estudio/competencia/", "/estudio/marketing/blotato/competencia/") in HOJAS_MUDADAS
    assert ("/estudio/competencia/", "/estudio/marketing/blotato/competencia/") in HOJAS_CON_CLASICA
    # y las Métricas (E7.7), la tercera de Marketing › Blotato
    assert ("/estudio/metricas/", "/estudio/marketing/blotato/metricas/") in HOJAS_MUDADAS
    assert ("/estudio/metricas/", "/estudio/marketing/blotato/metricas/") in HOJAS_CON_CLASICA
    # MIX (E7.8), de Marketing › Avanzado: la única cuya anidada no se llama como su clave (`automaticas` en el menú, `mix` en el registro)
    assert ("/estudio/mix/", "/estudio/marketing/avanzado/automaticas/") in HOJAS_MUDADAS
    assert ("/estudio/mix/", "/estudio/marketing/avanzado/automaticas/") in HOJAS_CON_CLASICA
    assert all(nueva != migracion.PRINCIPAL and nueva.count("/") > 3 for _, nueva in HOJAS_MUDADAS), HOJAS_MUDADAS


@en_dist
@pytest.mark.parametrize("plana, anidada", HOJAS_MUDADAS, ids=[plana.strip("/") for plana, _ in HOJAS_MUDADAS])
def test_la_carpeta_plana_de_una_hoja_mudada_lleva_a_su_lugar_con_la_app_real(monkeypatch, plana, anidada):
    """Con la app de verdad y el dist de verdad: GET y HEAD de la dirección plana de antes (con y sin barra, en mayúsculas, con y sin query)
    dan UN 302 RELATIVO a la anidada, con el query intacto y `no-store`; la anidada da 200 con SU index.html. Y la URL vieja (`/coi.html`)
    lleva ahí de un salto si la pantalla está `retirada` o en `todos`; en `nueva` sirve la clásica (la decide el interruptor)."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.delenv(migracion.ETAPA_MINIMA_VAR, raising=False)
    from server.app import app
    c = TestClient(app, follow_redirects=False)
    nombre = plana.removeprefix("/estudio/").rstrip("/")
    carpeta = anidada.removeprefix("/estudio/").rstrip("/")
    # si la carpeta plana siguiera, el alias sería inerte (una pantalla que existe manda) y esto no probaría el 302
    assert not (FUENTE / nombre).exists() and not (ESTUDIO / nombre).exists(), f"{plana} sigue siendo una carpeta: compila de nuevo"
    for metodo in ("get", "head"):
        for pedido in (plana, plana.rstrip("/"), f"/estudio/{nombre.capitalize()}/"):
            for query in ("", QUERY):
                r = getattr(c, metodo)(pedido + query)
                assert r.status_code == 302, (metodo, pedido + query, r.status_code)
                assert r.headers["location"] == anidada + query, (metodo, pedido + query)      # relativo, del propio sitio
                assert r.headers["cache-control"] == "no-store", (metodo, pedido + query)
    r = c.get(anidada)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"], anidada
    assert r.text.replace("\r\n", "\n") == _html_de(carpeta).read_text(encoding="utf-8").replace("\r\n", "\n"), anidada
    # lo de adentro de la plana tampoco se sirve: /estudio/coi/index.html era un archivo de su carpeta y ya no hay carpeta
    assert c.get(plana + "index.html").status_code == 404
    p = migracion.PANTALLAS[nombre]
    r = c.get(p.vieja + QUERY)
    if migracion.etapa(p) == "nueva":
        assert r.status_code == 200 and "text/html" in r.headers["content-type"], p.vieja
    else:
        assert r.status_code == 302 and r.headers["location"] == anidada + QUERY and r.headers["cache-control"] == "no-store", p.vieja


@en_dist
@pytest.mark.parametrize("plana, anidada", HOJAS_CON_CLASICA, ids=[plana.strip("/") for plana, _ in HOJAS_CON_CLASICA])
def test_la_url_vieja_de_una_hoja_mudada_con_clasica_lleva_a_su_lugar_en_todos_de_un_salto(monkeypatch, plana, anidada):
    """Con la app de verdad y el dist de verdad, una hoja mudada que todavía tiene la clásica (la Agenda, en `nueva`). En `nueva`, su URL
    vieja sirve la clásica (lo prueba la de arriba). Con la etapa mínima `todos` (UI_ETAPA_MINIMA, la de dev), GET y HEAD de /agenda.html
    (con y sin query) dan UN 302 RELATIVO a la ANIDADA, con el query intacto y `no-store`: no pasa por la carpeta plana (un salto, no dos)
    y el destino ya es la página. Con la cookie `ui=clasica` sigue sirviendo la clásica, y /ui/nueva?pantalla=… también lleva a la anidada."""
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv(migracion.ETAPA_MINIMA_VAR, "todos")
    from server.app import app
    c = TestClient(app, follow_redirects=False)
    nombre = plana.removeprefix("/estudio/").rstrip("/")
    carpeta = anidada.removeprefix("/estudio/").rstrip("/")
    p = migracion.PANTALLAS[nombre]
    assert migracion.etapa(p) == "todos", (nombre, migracion.etapa(p))
    for metodo in ("get", "head"):
        for query in ("", QUERY):
            r = getattr(c, metodo)(p.vieja + query)
            assert r.status_code == 302, (metodo, p.vieja + query, r.status_code)
            assert r.headers["location"] == anidada + query, (metodo, p.vieja + query)      # relativo, del propio sitio
            assert r.headers["cache-control"] == "no-store", (metodo, p.vieja + query)
    r = c.get(anidada + QUERY)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"], anidada
    assert r.text.replace("\r\n", "\n") == _html_de(carpeta).read_text(encoding="utf-8").replace("\r\n", "\n"), anidada
    # quien eligió la clásica la sigue viendo en su URL vieja (7 días, migracion.DURACION_COOKIE)
    c.cookies.set(migracion.COOKIE, migracion.CLASICA)
    r = c.get(p.vieja)
    assert r.status_code == 200 and "text/html" in r.headers["content-type"], p.vieja
    # y el camino de vuelta lleva a la anidada (borra la cookie)
    r = c.get(f"/ui/nueva?pantalla={nombre}")
    assert r.status_code == 302 and r.headers["location"] == anidada and r.headers["cache-control"] == "no-store"
