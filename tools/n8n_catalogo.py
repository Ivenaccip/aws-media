"""RAG·18 — genera el catálogo de nodos de n8n (lo corre el dueño o esta sesión).

    python tools/n8n_catalogo.py estado        # ¿el catálogo comiteado sigue al día?
    python tools/n8n_catalogo.py generar       # reescribe media/library/n8n/catalog.json
    python tools/n8n_catalogo.py generar --version 2.41.3

Sin costo: solo descarga dos paquetes públicos de npm. Ni LLM ni AWS.

DE DÓNDE SALE

Los dos paquetes de nodos que trae n8n: `n8n-nodes-base` (core y apps) y
`@n8n/n8n-nodes-langchain` (todo lo de IA: AI Agent, los Chat Model, memorias,
almacenes vectoriales). Cada paquete publica `dist/types/nodes.json`, la
descripción de sus nodos en JSON puro: se lee como dato, sin ejecutar el
JavaScript de n8n.

OJO CON LAS VERSIONES: la etiqueta `latest` de `n8n-nodes-base` en npm está
atrasada (el 30-sep-2026 decía 2.15.1 mientras n8n iba en 2.41). La versión
buena es la que fija el paquete `n8n` en su etiqueta `stable`, así que se
resuelve desde ahí. Cada tarball se verifica contra su `integrity` (sha512)
antes de leerlo.

QUÉ ESCRIBE

`media/library/n8n/catalog.json`: TODOS los nodos que existen, con sus
`typeVersion` válidas, parámetros obligatorios, credenciales, tipos de entrada y
salida, si sirven como herramienta de un agente y sus ligas a la documentación.
Con cabecera de procedencia (versión de n8n y fecha), como el de SFX.

El catálogo dice qué EXISTE. Lo que el generador de /automatiza puede USAR es
otra lista, escrita a mano: `media/library/n8n/permitidos.json`. Por eso un
nodo real que aún no está permitido da «aún no lo soportamos», y uno inventado
da «no existe» (pipeline/n8n_catalogo.py).

CADUCA: n8n publica versiones cada semana. `estado` compara la cabecera con la
versión estable de hoy; si difiere, se regenera y el diff del PR dice qué cambió.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import io
import json
import sys
import tarfile
import urllib.parse
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from pipeline import n8n_catalogo  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

REGISTRO = "https://registry.npmjs.org"
# paquete npm → prefijo del `type` que lleva el nodo en el .json de un flujo
PAQUETES = {
    "n8n-nodes-base": "n8n-nodes-base",
    "@n8n/n8n-nodes-langchain": "@n8n/n8n-nodes-langchain",
}
DENTRO = "package/dist/types/"


class Integridad(RuntimeError):
    """El tarball descargado no coincide con el sha512 que publica npm."""


# ---------------------------------------------------------------------------
# red (npm)

def _json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def _bytes(url: str) -> bytes:
    with urllib.request.urlopen(url, timeout=300) as r:
        return r.read()


def resolver(version: str | None = None, pedir=_json) -> dict:
    """Versión de n8n (la `stable` si no se da) y la de cada paquete de nodos."""
    meta = pedir(f"{REGISTRO}/n8n")
    v = version or meta["dist-tags"]["stable"]
    if v not in meta["versions"]:
        raise SystemExit(f"n8n {v} no existe en npm")
    deps = meta["versions"][v].get("dependencies", {})
    faltan = [p for p in PAQUETES if p not in deps]
    if faltan:
        raise SystemExit(f"n8n {v} no depende de {faltan}: revisa PAQUETES")
    return {"n8n": v, "paquetes": {p: deps[p] for p in PAQUETES}}


def verificar(datos: bytes, integridad: str) -> None:
    algoritmo, _, esperado = integridad.partition("-")
    if algoritmo != "sha512":
        raise Integridad(f"integridad {algoritmo!r} no soportada")
    real = base64.b64encode(hashlib.sha512(datos).digest()).decode()
    if real != esperado:
        raise Integridad("el tarball no coincide con su sha512 de npm")


def descargar(paquete: str, version: str, pedir=_json, bajar=_bytes) -> dict:
    """{"nodes": [...], "credentials": [...]} del tarball verificado."""
    dist = pedir(f"{REGISTRO}/{urllib.parse.quote(paquete, safe='@')}/{version}")["dist"]
    datos = bajar(dist["tarball"])
    verificar(datos, dist["integrity"])
    return leer_tarball(datos)


def leer_tarball(datos: bytes) -> dict:
    with tarfile.open(fileobj=io.BytesIO(datos), mode="r:gz") as tar:
        return {k: json.load(tar.extractfile(DENTRO + k + ".json"))
                for k in ("nodes", "credentials")}


# ---------------------------------------------------------------------------
# construir el catálogo (puro: sin red, lo que prueban los tests)

def _tipos(puertos) -> list[str] | str:
    """`inputs`/`outputs`: lista de tipos, o «dinámico» si n8n los calcula
    con una expresión según los parámetros (p. ej. Simple Vector Store)."""
    if isinstance(puertos, str):
        return "dinámico"
    return [p if isinstance(p, str) else p.get("type", "main") for p in puertos]


def _versiones(entradas: list[dict]) -> list:
    vs = set()
    for e in entradas:
        v = e.get("version", 1)
        vs.update(v if isinstance(v, list) else [v])
    return sorted(vs)


def _por_defecto(entradas: list[dict], versiones: list) -> tuple:
    v = next((e["defaultVersion"] for e in entradas if e.get("defaultVersion") is not None),
             versiones[-1])
    for e in entradas:
        ev = e.get("version", 1)
        if v in (ev if isinstance(ev, list) else [ev]):
            return v, e
    return v, entradas[0]


def _obligatorios(propiedades: list[dict]) -> tuple[list[str], list[str]]:
    """(siempre, según otros parámetros). Solo de la versión por defecto."""
    siempre, depende = [], []
    for p in propiedades:
        if not p.get("required") or p.get("type") == "notice":
            continue
        (depende if p.get("displayOptions") else siempre).append(p["name"])
    siempre = sorted(set(siempre))
    return siempre, sorted(set(depende) - set(siempre))


def _credenciales(entrada: dict) -> list[dict]:
    fuera = []
    for c in entrada.get("credentials") or []:
        d = {"nombre": c["name"], "requerida": bool(c.get("required"))}
        si = (c.get("displayOptions") or {}).get("show")
        if si:
            d["si"] = si
        fuera.append(d)
    return fuera


def _docs(entrada: dict, clave: str) -> str | None:
    urls = ((entrada.get("codex") or {}).get("resources") or {}).get(clave) or []
    return urls[0].get("url") if urls else None


def nodo(entradas: list[dict]) -> dict:
    versiones = _versiones(entradas)
    defecto, e = _por_defecto(entradas, versiones)
    siempre, depende = _obligatorios(e.get("properties") or [])
    d = {
        "nombre": e["displayName"],
        "versiones": versiones,
        "version_por_defecto": defecto,
        "disparador": "trigger" in (e.get("group") or []),
        "entradas": _tipos(e.get("inputs", [])),
        "salidas": _tipos(e.get("outputs", [])),
        "obligatorios": siempre,
        "obligatorios_segun_otros": depende,
        "credenciales": _credenciales(e),
        "como_herramienta": bool(e.get("usableAsTool")),
        "oculto": all(x.get("hidden") for x in entradas),
        "doc": _docs(e, "primaryDocumentation"),
        "doc_credencial": _docs(e, "credentialDocumentation"),
    }
    return d


def construir(paquetes: dict[str, dict], procedencia: dict) -> dict:
    """`paquetes`: {nombre npm: {"nodes": [...], "credentials": [...]}}."""
    agrupados: dict[str, list] = {}
    credenciales: dict[str, str] = {}
    for paquete, contenido in paquetes.items():
        for n in contenido["nodes"]:
            agrupados.setdefault(f"{PAQUETES[paquete]}.{n['name']}", []).append(n)
        for c in contenido["credentials"]:
            credenciales[c["name"]] = c.get("displayName", c["name"])
    return {
        "nota": ("Catálogo de nodos de n8n para validar los flujos de /automatiza "
                 "(RAG·18). Generado por tools/n8n_catalogo.py desde dist/types/ de los "
                 "paquetes npm; NO se edita a mano. Dice qué EXISTE. Lo que se puede "
                 "USAR está en permitidos.json. `obligatorios` y `credenciales` son los "
                 "de la versión por defecto. Un nodo con `como_herramienta` existe también "
                 "como `<tipo>Tool` para conectarlo a un AI Agent. `oculto`: n8n ya no lo "
                 "ofrece en su panel (obsoleto, interno o solo de su nube)."),
        "procedencia": procedencia,
        "nodos": {k: nodo(v) for k, v in sorted(agrupados.items())},
        "credenciales": dict(sorted(credenciales.items())),
    }


def escribir(catalogo: dict, ruta: Path = n8n_catalogo.RUTA_CATALOGO) -> None:
    """Un nodo por línea: el diff de una regeneración se lee nodo por nodo."""
    ruta.parent.mkdir(parents=True, exist_ok=True)
    lineas = ["{"]
    for clave in ("nota", "procedencia"):
        lineas.append(f"  {json.dumps(clave)}: {json.dumps(catalogo[clave], ensure_ascii=False)},")
    for grupo in ("nodos", "credenciales"):
        lineas.append(f"  {json.dumps(grupo)}: {{")
        items = list(catalogo[grupo].items())
        for i, (k, v) in enumerate(items):
            coma = "," if i < len(items) - 1 else ""
            lineas.append(f"    {json.dumps(k)}: {json.dumps(v, ensure_ascii=False)}{coma}")
        lineas.append("  }," if grupo == "nodos" else "  }")
    lineas.append("}")
    ruta.write_text("\n".join(lineas) + "\n", encoding="utf-8")


# ---------------------------------------------------------------------------

def generar(version: str | None, pedir=_json, bajar=_bytes, hoy: str | None = None) -> dict:
    res = resolver(version, pedir)
    contenido = {p: descargar(p, v, pedir, bajar) for p, v in res["paquetes"].items()}
    procedencia = {**res, "generado": hoy or dt.date.today().isoformat(),
                   "fuente": "dist/types/nodes.json y credentials.json de cada paquete npm",
                   "herramienta": "tools/n8n_catalogo.py"}
    return construir(contenido, procedencia)


def estado(pedir=_json) -> int:
    cat = n8n_catalogo.catalogo()
    p = cat["procedencia"]
    print(f"Catálogo: n8n {p['n8n']} (generado el {p['generado']}), "
          f"{len(cat['nodos'])} nodos, {len(cat['credenciales'])} credenciales")
    malos = n8n_catalogo.revisar_permitidos()
    print(f"Permitidos: {len(n8n_catalogo.permitidos())} nodos"
          + ("" if not malos else f", {len(malos)} con problema:"))
    for m in malos:
        print(f"  - {m}")
    hoy = resolver(None, pedir)["n8n"]
    if hoy != p["n8n"]:
        print(f"CADUCADO: la versión estable de n8n hoy es {hoy}. "
              "Corre `python tools/n8n_catalogo.py generar` y revisa el diff.")
        return 1
    print(f"Al día con n8n {hoy} (stable).")
    return 1 if malos else 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="accion", required=True)
    sub.add_parser("estado")
    g = sub.add_parser("generar")
    g.add_argument("--version", help="versión de n8n (por defecto, la stable de npm)")
    args = ap.parse_args(argv)
    if args.accion == "estado":
        return estado()
    cat = generar(args.version)
    escribir(cat)
    n8n_catalogo.catalogo.cache_clear()
    print(f"Escrito {n8n_catalogo.RUTA_CATALOGO.relative_to(RAIZ)}: n8n {cat['procedencia']['n8n']}, "
          f"{len(cat['nodos'])} nodos.")
    malos = n8n_catalogo.revisar_permitidos()
    for m in malos:
        print(f"  OJO permitidos.json — {m}")
    return 1 if malos else 0


if __name__ == "__main__":
    raise SystemExit(main())
