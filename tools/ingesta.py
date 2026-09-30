"""RAG·19 — mete la documentación de n8n al índice vectorial (lo corre el dueño).

    python tools/ingesta.py ensayo                  # cuenta trozos y tokens; NO llama a nadie
    python tools/ingesta.py subir --confirmar       # embebe y guarda (CUESTA: pide el «sí»)
    python tools/ingesta.py subir --confirmar --solo n8n-nodes-base.slack,n8n-nodes-base.notion

Sin `--confirmar`, `subir` es igual al ensayo: nada sale de la máquina.

QUÉ ENTRA

Solo lo de los nodos PERMITIDOS (media/library/n8n/permitidos.json, RAG·18):
la página de cada nodo (su `doc` en el catálogo, con sus subpáginas de
operaciones) y la página de su credencial (su `doc_credencial` y las ligas a
/credentials/ que trae la página del nodo). Crecer hacia el 80% es agregar
nodos a permitidos.json y correr `subir --solo <los nuevos>`: lo que ya está
no se vuelve a pagar.

DE DÓNDE: un clon de github.com/n8n-io/n8n-docs en work/n8n-docs (se clona
solo la primera vez; `--actualizar` baja lo nuevo). El commit del clon queda en
los metadatos de cada trozo.

CÓMO SE TROCEA

Por página y por sección (## y ###), sin traducir: el corpus se indexa en
inglés (RAG·20). Cada trozo lleva al principio el nombre del nodo y la ruta de
secciones, porque así se embebe con su contexto. Secciones chicas se juntan
con la siguiente; las grandes se parten por párrafos. El tope es de
caracteres y conservador (MAX_CARACTERES ≈ 2 000 tokens a 3 caracteres por
token): el modelo tiene 2 048 de contexto y `auto_truncate` está apagado, así
que un trozo de más truena en vez de cortarse en silencio.

LA CLAVE de cada trozo es `<ruta del .md>#<sección>#<n>`: la misma página da
las mismas claves, y volver a subirla REEMPLAZA sus trozos en vez de
duplicarlos. (Si n8n borra una sección, su trozo viejo se queda: no hay
comando para borrar, a propósito; se limpia con un índice nuevo.)

METADATOS: filtrables `nodos` (lista de tipos), `tipo` (nodo · credencial),
`fuente`, `docs_commit`, `version_n8n`, `idioma`; no filtrables `texto`,
`titulo`, `url` (pipeline/vectores.py).

LA CLAVE DE GEMINI sale de SSM `<ssm_publico>/GEMINI_API_KEY` con tus
credenciales de AWS (capa 1: nunca la de plataforma del .env). No se imprime.

Precio: sin precio confirmado (gemini-embedding-001 no está en tools/pricing.json).
El ensayo da los tokens; el número en dólares sale de ahí cuando esté el precio.
"""
from __future__ import annotations

import argparse
import math
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from infra import entornos  # noqa: E402
from pipeline import n8n_catalogo, vectores  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REPO_DOCS = "https://github.com/n8n-io/n8n-docs"
DOCS_LOCAL = RAIZ / "work" / "n8n-docs"
URL_DOCS = "https://docs.n8n.io/"
MAX_CARACTERES = 6000       # ≈ 2 000 tokens contando 3 caracteres por token
MIN_CARACTERES = 400        # una sección más chica se junta con la siguiente
CARACTERES_POR_TOKEN = 4    # para ESTIMAR el conteo (inglés técnico)


@dataclass
class Trozo:
    clave: str
    texto: str
    metadatos: dict = field(default_factory=dict)


# ---------------------------------------------------------------------------
# de URL de docs.n8n.io a archivos del clon

def _archivos_de_url(docs: Path, url: str | None) -> list[Path]:
    """La página y, si es carpeta, todas sus subpáginas (operaciones, etc.)."""
    if not url or not url.startswith(URL_DOCS):
        return []
    rel = url[len(URL_DOCS):].strip("/")
    base = docs / "docs" / rel
    # ojo: with_suffix(".md") partiría «n8n-nodes-base.if» en el punto
    for p in (base.parent / (base.name + ".md"), base / "index.md"):
        if p.is_file():
            return [p]
    if base.is_dir():
        return sorted(base.glob("*.md"))
    return []


_LIGA_CREDENCIAL = re.compile(r"\]\(([^)#\s]*credentials/[^)#\s]*\.md)")


def _credenciales_de_pagina(pagina: Path) -> list[Path]:
    """Las páginas de credenciales a las que liga la página del nodo."""
    fuera = []
    for rel in _LIGA_CREDENCIAL.findall(pagina.read_text(encoding="utf-8")):
        p = (pagina.parent / rel).resolve()
        if p.is_file():
            fuera.append(p)
    return fuera


def paginas(docs: Path, tipos: list[str]) -> tuple[dict[Path, dict], list[str]]:
    """{archivo: {"nodos": [...], "tipo": nodo|credencial}} y los nodos sin docs.
    Una página de credencial compartida (Google) lleva todos sus nodos."""
    cat = n8n_catalogo.catalogo()["nodos"]
    mapa: dict[Path, dict] = {}
    sin_docs = []
    for t in tipos:
        propias = _archivos_de_url(docs, cat[t]["doc"])
        if not propias:
            sin_docs.append(t)
        creds = _archivos_de_url(docs, cat[t].get("doc_credencial"))
        for p in propias:
            creds += _credenciales_de_pagina(p)
        for p, clase in [(p, "nodo") for p in propias] + [(p, "credencial") for p in creds]:
            p = p.resolve()
            d = mapa.setdefault(p, {"nodos": [], "tipo": clase})
            if t not in d["nodos"]:
                d["nodos"].append(t)
    return mapa, sin_docs


# ---------------------------------------------------------------------------
# limpiar el markdown de GitBook

_FRONT = re.compile(r"\A---\n.*?\n---\n", re.S)
_ANCLA = re.compile(r"\s*<a href=\"#[^\"]*\" id=\"[^\"]*\"></a>")
_ETIQUETA = re.compile(r"\{%\s*(?:end)?(?:hint|tabs?|content)[^%]*%\}")
_QUITAR = re.compile(r"\{%\s*(?:include|embed)[^%]*%\}")
# los flujos de ejemplo incrustados vienen como JSON codificado en la URL:
# miles de tokens de %7B%22… que no se leen. Fuera (RAG·21 puede traerlos aparte).
_DEMO = re.compile(r"\{%\s*@n8n-blocks/n8n-workflow-demo.*?%\}", re.S)
_RESTO = re.compile(r"\{%.*?%\}", re.S)
_IMAGEN = re.compile(r"!\[[^\]]*\]\([^)]*\)|<figure>.*?</figure>", re.S)
_TITULO = re.compile(r"^title:\s*(.+)$", re.M)


def limpiar(md: str) -> tuple[str, str | None]:
    """(texto limpio, título del frontmatter)."""
    m = _FRONT.match(md)
    titulo = None
    if m:
        t = _TITULO.search(m.group(0))
        titulo = t.group(1).strip().strip("'\"") if t else None
        md = md[m.end():]
    md = _ANCLA.sub("", md)
    md = _QUITAR.sub("", md)
    md = _ETIQUETA.sub("", md)
    md = _DEMO.sub("", md)
    md = _RESTO.sub("", md)
    md = _IMAGEN.sub("", md)
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip(), titulo


# ---------------------------------------------------------------------------
# trocear

def _secciones(md: str) -> list[tuple[list[str], str]]:
    """[(ruta de encabezados, cuerpo)] cortando en #, ## y ###. Respeta los
    bloques de código: un `# comentario` dentro de ``` no es un encabezado."""
    ruta: list[str] = []
    fuera: list[tuple[list[str], str]] = []
    cuerpo: list[str] = []
    en_codigo = False
    for linea in md.splitlines():
        if linea.lstrip().startswith("```"):
            en_codigo = not en_codigo
        m = None if en_codigo else re.match(r"^(#{1,3})\s+(.*)$", linea)
        if m:
            if "".join(cuerpo).strip():
                fuera.append((list(ruta), "\n".join(cuerpo).strip()))
            cuerpo = []
            nivel = len(m.group(1))
            ruta = ruta[:nivel - 1] + [m.group(2).strip()]
            continue
        cuerpo.append(linea)
    if "".join(cuerpo).strip():
        fuera.append((list(ruta), "\n".join(cuerpo).strip()))
    return fuera


def _partir(texto: str, tope: int) -> list[str]:
    """Parte por párrafos; un párrafo solo más grande que el tope, por líneas
    y al final a la fuerza."""
    if len(texto) <= tope:
        return [texto]
    partes, actual = [], ""
    for bloque in re.split(r"\n\s*\n", texto):
        piezas = [bloque] if len(bloque) <= tope else [
            bloque[i:i + tope] for i in range(0, len(bloque), tope)]
        for p in piezas:
            if actual and len(actual) + 2 + len(p) > tope:
                partes.append(actual)
                actual = p
            else:
                actual = f"{actual}\n\n{p}" if actual else p
    if actual:
        partes.append(actual)
    return partes


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "inicio"


def trozar(md: str, *, rel: str, nombre: str, info: dict, comunes: dict) -> list[Trozo]:
    texto, titulo = limpiar(md)
    titulo = titulo or nombre
    url = URL_DOCS + re.sub(r"(/README|/index)?\.md$", "", rel) + "/"
    grupos: list[tuple[list[str], str]] = []
    for ruta, cuerpo in _secciones(texto):
        if grupos and len(grupos[-1][1]) < MIN_CARACTERES:
            r0, c0 = grupos[-1]      # la sección anterior era chica: se juntan
            grupos[-1] = (r0, f"{c0}\n\n{' > '.join(ruta)}\n{cuerpo}".strip())
        else:
            grupos.append((ruta, cuerpo))
    trozos = []
    vistos: dict[str, int] = {}
    for ruta, cuerpo in grupos:
        encabezado = f"n8n docs — {titulo}" + (f" — {' > '.join(ruta)}" if ruta else "")
        seccion = _slug(ruta[-1]) if ruta else "inicio"
        for parte in _partir(cuerpo, MAX_CARACTERES - len(encabezado) - 2):
            n = vistos.get(seccion, 0)
            vistos[seccion] = n + 1
            trozos.append(Trozo(
                clave=f"{rel}#{seccion}#{n}",
                texto=f"{encabezado}\n\n{parte}",
                metadatos={**comunes, "nodos": list(info["nodos"]), "tipo": info["tipo"],
                           "titulo": titulo, "url": url}))
    return trozos


def trozos_de(docs: Path, tipos: list[str]) -> tuple[list[Trozo], list[str]]:
    cat = n8n_catalogo.catalogo()
    mapa, sin_docs = paginas(docs, tipos)
    comunes = {"fuente": "n8n-docs", "docs_commit": commit(docs),
               "version_n8n": cat["procedencia"]["n8n"], "idioma": "en"}
    raiz = (docs / "docs").resolve()
    fuera: list[Trozo] = []
    for p, info in sorted(mapa.items()):
        nombre = cat["nodos"][info["nodos"][0]]["nombre"]
        fuera += trozar(p.read_text(encoding="utf-8"), rel=str(p.relative_to(raiz)),
                        nombre=nombre, info=info, comunes=comunes)
    return fuera, sin_docs


# ---------------------------------------------------------------------------

def commit(docs: Path) -> str:
    try:
        return subprocess.run(["git", "-C", str(docs), "rev-parse", "--short=12", "HEAD"],
                              capture_output=True, text=True, check=True).stdout.strip()
    except Exception:  # noqa: BLE001 — una copia sin .git igual se puede ingerir
        return "desconocido"


def asegurar_docs(docs: Path, actualizar: bool) -> None:
    if not docs.exists():
        print(f"Clonando {REPO_DOCS} en {docs} (una sola vez)…")
        subprocess.run(["git", "clone", "--depth", "1", REPO_DOCS, str(docs)], check=True)
    elif actualizar:
        subprocess.run(["git", "-C", str(docs), "pull", "--ff-only"], check=True)


def tokens(texto: str) -> int:
    return math.ceil(len(texto) / CARACTERES_POR_TOKEN)


def resumen(trozos: list[Trozo], sin_docs: list[str]) -> dict:
    por_nodo: dict[str, int] = {}
    for t in trozos:
        for n in t.metadatos["nodos"]:
            por_nodo[n] = por_nodo.get(n, 0) + 1
    return {"trozos": len(trozos), "paginas": len({t.clave.split("#")[0] for t in trozos}),
            "caracteres": sum(len(t.texto) for t in trozos),
            "tokens": sum(tokens(t.texto) for t in trozos),
            "trozo_mas_grande": max((len(t.texto) for t in trozos), default=0),
            "por_nodo": por_nodo, "sin_docs": sin_docs}


def imprimir(r: dict, docs_commit: str) -> None:
    print(f"Documentación: n8n-docs @ {docs_commit}")
    print(f"Páginas: {r['paginas']} · trozos: {r['trozos']} · caracteres: {r['caracteres']:,}")
    print(f"Tokens a embeber: ≈ {r['tokens']:,} (estimación: caracteres ÷ {CARACTERES_POR_TOKEN})")
    print(f"Trozo más grande: {r['trozo_mas_grande']:,} caracteres (tope {MAX_CARACTERES:,})")
    if r["sin_docs"]:
        print(f"Sin página de documentación: {', '.join(r['sin_docs'])}")
    print("Precio: sin precio confirmado (gemini-embedding-001 no está en tools/pricing.json).")


def _clave_gemini(entorno: entornos.Entorno) -> None:
    """Pone GEMINI_API_KEY_PUBLICO desde SSM /publico/. Nunca la imprime."""
    if os.getenv("GEMINI_API_KEY_PUBLICO"):
        return
    import boto3
    nombre = f"{entorno.ssm_publico}/GEMINI_API_KEY"
    valor = boto3.client("ssm").get_parameter(Name=nombre, WithDecryption=True)["Parameter"]["Value"]
    os.environ["GEMINI_API_KEY_PUBLICO"] = valor
    print(f"Clave de Gemini: {nombre} (SSM)")


def subir(trozos: list[Trozo], entorno: entornos.Entorno, *, embeber=None, s3v=None) -> int:
    from pipeline import embeddings
    os.environ["VECTORES_BUCKET"] = entorno.vectores_bucket
    os.environ["VECTORES_INDICE"] = entorno.vectores_indice
    if embeber is None:
        _clave_gemini(entorno)
        embeber = embeddings.embeber
    vectores_ = embeber([t.texto for t in trozos], "documento")
    lista = [vectores.Trozo(t.clave, v, {**t.metadatos, "texto": t.texto})
             for t, v in zip(trozos, vectores_)]
    return vectores.guardar(lista, s3v=s3v)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--entorno", choices=("dev", "prod"), default="dev")
    ap.add_argument("--docs", type=Path, default=DOCS_LOCAL)
    ap.add_argument("--actualizar", action="store_true", help="git pull del clon de la doc")
    ap.add_argument("--solo", help="tipos de nodo separados por coma (deben estar permitidos)")
    sub = ap.add_subparsers(dest="accion", required=True)
    sub.add_parser("ensayo")
    s = sub.add_parser("subir")
    s.add_argument("--confirmar", action="store_true", help="embebe y guarda; sin esto, ensayo")
    args = ap.parse_args(argv)

    entorno = entornos.PROD if args.entorno == "prod" else entornos.DEV
    if not (entorno.vectores_bucket and entorno.vectores_indice and entorno.ssm_publico):
        raise SystemExit(f"{entorno.nombre} no tiene almacén vectorial (prod lo recibe en RAG·30).")
    permitidos = list(n8n_catalogo.permitidos())
    tipos = permitidos
    if args.solo:
        tipos = [t.strip() for t in args.solo.split(",") if t.strip()]
        fuera = [t for t in tipos if t not in permitidos]
        if fuera:
            raise SystemExit(f"no están en permitidos.json: {', '.join(fuera)}")

    asegurar_docs(args.docs, args.actualizar)
    trozos, sin_docs = trozos_de(args.docs, tipos)
    r = resumen(trozos, sin_docs)
    imprimir(r, commit(args.docs))
    if args.accion == "ensayo" or not args.confirmar:
        if args.accion == "subir":
            print("Ensayo: agrega --confirmar para embeber y guardar (cuesta).")
        return 0
    print(f"Subiendo {len(trozos)} trozos a {entorno.vectores_bucket}/{entorno.vectores_indice}…")
    n = subir(trozos, entorno)
    print(f"Hecho: {n} trozos en el índice.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
