#!/usr/bin/env python
"""Lee el esquema PÚBLICO de los endpoints de fal y enseña, sin gastar nada, lo que cada
uno acepta: qué llaves, de qué tipo, con qué valores permitidos y cuál es el valor por
defecto. Es la fuente exacta para escribir el adaptador de una familia nueva de imágenes
(R4 · Ola 2): los valores de `image_size`, si trae `num_images`, el máximo de
`image_urls`, las calidades de GPT Image.

Uso (desde la raíz del repo):
  python tools/leer_esquema_fal.py                      # los endpoints de la Ola 2
  python tools/leer_esquema_fal.py fal-ai/flux-2-pro    # uno o varios, por su nombre exacto
  python tools/leer_esquema_fal.py --salida CARPETA     # dónde guardar (work/esquemas_fal)

SOLO LECTURA. Una petición GET a fal.ai por endpoint, sin clave: no lee el .env, no
usa fal_client, no manda ningún encabezado de autorización y no ejecuta ningún modelo,
así que no cuesta nada. Guarda el JSON completo de cada uno y un RESUMEN.txt (lo que
conviene pegar en el reporte). Si una página no responde, lo dice y sigue con la
siguiente; sale con 1 si alguna no se pudo leer o no se entendió su esquema (el JSON queda
guardado igual), con 2 si el pedido no es válido.

Lo que el esquema NO dice: el precio (ese se lee en la página del modelo y se confirma en
el panel de fal) ni lo que fal hace de verdad con un valor fuera de rango.
"""
from __future__ import annotations

import argparse
import http.client
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

URL = "https://fal.ai/api/openapi/queue/openapi.json?endpoint_id={endpoint}"
SALIDA_PREDETERMINADA = Path("work") / "esquemas_fal"
TIMEOUT_S = 30

# Los endpoints de la Ola 2 (docs/modelos-ia/POR-VERIFICAR.md). Las variantes de editar de
# GPT Image 2.5 las dio el dueño el 9-oct-2026 y su pestaña de API sigue sin leer.
OLA2 = (
    "fal-ai/flux-2/klein/9b",
    "fal-ai/z-image/turbo",
    "fal-ai/flux-2-pro",
    "bytedance/seedream/v5/flash/text-to-image",
    "fal-ai/bytedance/seedream/v4.5/text-to-image",
    "openai/gpt-image-2",
    "openai/gpt-image-2/edit",
    "openai/gpt-image-2.5/flare/text-to-image",
    "openai/gpt-image-2.5/sunburst/text-to-image",
    "openai/gpt-image-2.5/flare/edit",
    "openai/gpt-image-2.5/sunburst/edit",
    "blackforestlabs/flux-3/text-to-image",
)

# Un nombre de endpoint de fal: segmentos con letras, números, punto, guion y guion bajo.
_ENDPOINT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*(/[A-Za-z0-9][A-Za-z0-9._-]*)+$")
# Las llaves que definen tamaño, calidad y cantidad: de esas se enseña también la descripción.
# El encabezado de un resumen que no se pudo armar: main lo cuenta aparte de las descargas caídas.
SIN_RESUMEN = "  (no se pudo leer la entrada:"
_LLAVES_CLAVE = ("image_size", "aspect_ratio", "resolution", "quality", "num_images",
                 "image_urls", "output_format", "mask_url", "seed")


def _uso(msg: str) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(2)


def nombre_de_archivo(endpoint: str) -> str:
    return endpoint.replace("/", "__") + ".json"


def validar_endpoint(endpoint: str) -> str:
    if not _ENDPOINT.match(endpoint) or ".." in endpoint:
        _uso(f"«{endpoint}» no parece un endpoint de fal (p. ej. fal-ai/flux-2/klein/9b).")
    return endpoint


def descargar(endpoint: str) -> dict:
    """El OpenAPI del endpoint. Sin clave ni encabezados de autorización."""
    url = URL.format(endpoint=urllib.parse.quote(endpoint, safe="/"))
    req = urllib.request.Request(url, headers={"Accept": "application/json",
                                               "User-Agent": "aws-media-leer-esquema-fal"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:        # noqa: S310 (https fijo)
        return json.loads(r.read().decode("utf-8"))


# ---------------------------------------------------------------------------
# del OpenAPI a un resumen

def _ref(doc: dict, nodo):
    """Sigue un `$ref` local («#/components/schemas/X») hasta el nodo real."""
    for _ in range(10):
        if isinstance(nodo, dict) and "$ref" in nodo:
            ruta = str(nodo["$ref"])
            if not ruta.startswith("#/"):
                return nodo
            cur = doc
            for parte in ruta[2:].split("/"):
                cur = cur.get(parte, {}) if isinstance(cur, dict) else {}
            nodo = cur
        else:
            break
    return nodo


def esquema_de_entrada(doc: dict, endpoint: str) -> tuple[str, dict]:
    """(nombre, esquema) de lo que el POST del endpoint recibe, o ValueError."""
    if not isinstance(doc, dict):
        raise ValueError("el esquema no es un objeto JSON")
    rutas = doc.get("paths") or {}
    if not isinstance(rutas, dict):
        raise ValueError("el esquema no trae «paths» como objeto")
    candidatas = []
    for ruta, ops in rutas.items():
        post = (ops or {}).get("post") if isinstance(ops, dict) else None
        cuerpo = (((post or {}).get("requestBody") or {}).get("content") or {}).get("application/json")
        if cuerpo and "schema" in cuerpo:
            candidatas.append((ruta, cuerpo["schema"]))
    if not candidatas:
        raise ValueError("el esquema no trae un POST con cuerpo JSON")
    candidatas.sort(key=lambda c: c[0].strip("/") != endpoint)       # la ruta exacta primero
    _, esq = candidatas[0]
    nombre = str(esq.get("$ref", "")).rsplit("/", 1)[-1] if isinstance(esq, dict) else ""
    esq = _ref(doc, esq)
    if not isinstance(esq, dict) or "properties" not in esq:
        raise ValueError("el cuerpo del POST no declara propiedades")
    return nombre or "(sin nombre)", esq


def _valores(doc: dict, p) -> list[str]:
    """Una descripción corta de lo que admite una propiedad (tipo, enum, objeto, rangos)."""
    p = _ref(doc, p)
    if not isinstance(p, dict):
        return [repr(p)[:80]]
    for alt in ("anyOf", "oneOf", "allOf"):
        if isinstance(p.get(alt), list):
            return [v for sub in p[alt] for v in _valores(doc, sub)]
    if isinstance(p.get("enum"), list):
        return ["enum[" + ", ".join(str(v) for v in p["enum"]) + "]"]
    t = p.get("type")
    if t == "object":
        props = ", ".join(sorted((p.get("properties") or {})))
        rangos = []
        for k, sub in sorted((p.get("properties") or {}).items()):
            sub = _ref(doc, sub)
            if isinstance(sub, dict) and ("minimum" in sub or "maximum" in sub):
                rangos.append(f"{k} {sub.get('minimum', '…')}–{sub.get('maximum', '…')}")
        return [f"objeto{{{props}}}" + (f" ({'; '.join(rangos)})" if rangos else "")]
    if t == "array":
        item = _valores(doc, p.get("items", {}))
        extra = "".join(f" {k}={p[k]}" for k in ("minItems", "maxItems") if k in p)
        return [f"lista de {'/'.join(item) or '?'}{extra}"]
    partes = [str(t or "?")]
    for k in ("minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength"):
        if k in p:
            partes.append(f"{k}={p[k]}")
    return [" ".join(partes)]


def resumir(doc: dict, endpoint: str) -> str:
    """El resumen de un endpoint: una línea por llave (más su descripción si es clave).
    Un esquema de otra forma NO tira el programa: dice qué no pudo leer (el JSON completo
    ya quedó guardado) y el texto empieza con SIN_RESUMEN para que quien llama lo cuente."""
    try:
        return _resumir(doc, endpoint)
    except Exception as err:  # noqa: BLE001 — un esquema raro (recursivo, de otra forma) no frena a los demás
        return f"{SIN_RESUMEN} {type(err).__name__}: {str(err)[:200]}; el JSON completo quedó guardado)"


def _resumir(doc: dict, endpoint: str) -> str:
    try:
        nombre, esq = esquema_de_entrada(doc, endpoint)
    except ValueError as err:
        return f"{SIN_RESUMEN} {err}; el JSON completo quedó guardado)"
    requeridas = set(esq.get("required") or []) if isinstance(esq.get("required"), list) else set()
    lineas = [f"  entrada: {nombre}"]
    for llave, prop in (esq.get("properties") or {}).items():
        real = _ref(doc, prop)
        valores = " | ".join(dict.fromkeys(_valores(doc, prop)))
        por_defecto = ""
        for fuente in (prop, real):
            if isinstance(fuente, dict) and "default" in fuente:
                por_defecto = f" · por defecto {json.dumps(fuente['default'], ensure_ascii=False)}"
                break
        req = " (OBLIGATORIA)" if llave in requeridas else ""
        lineas.append(f"  - {llave}{req}: {valores}{por_defecto}")
        desc = (real.get("description") if isinstance(real, dict) else "") or \
               (prop.get("description") if isinstance(prop, dict) else "") or ""
        if llave in _LLAVES_CLAVE and desc:
            lineas.append(f"      {' '.join(str(desc).split())[:240]}")
    return "\n".join(lineas)


# ---------------------------------------------------------------------------

def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Lee el esquema público de endpoints de fal (solo lectura, sin gasto, sin clave).")
    p.add_argument("endpoints", nargs="*", help="endpoints por su nombre exacto; sin ninguno, los de la Ola 2")
    p.add_argument("--salida", default=str(SALIDA_PREDETERMINADA),
                   help=f"carpeta donde guardar el JSON y el RESUMEN.txt (por defecto {SALIDA_PREDETERMINADA})")
    a = p.parse_args(argv)
    endpoints = [validar_endpoint(e.strip("/")) for e in (a.endpoints or OLA2)]
    salida = Path(a.salida).expanduser()
    try:
        salida.mkdir(parents=True, exist_ok=True)
    except OSError as err:
        _uso(f"No puedo crear la carpeta {salida}: {err}")

    resumen, fallos, sin_resumen = [], 0, 0
    for ep in endpoints:
        encabezado = f"== {ep}"
        try:
            doc = descargar(ep)
        # URLError y TimeoutError (son OSError), HTTPException (lectura cortada) y ValueError
        # (JSON inválido o un cuerpo que no es UTF-8): una página mala no frena a las demás
        except (urllib.error.URLError, http.client.HTTPException, ValueError, OSError) as err:
            fallos += 1
            cuerpo = f"  NO SE PUDO LEER: {type(err).__name__}: {str(err)[:200]}"
        else:
            (salida / nombre_de_archivo(ep)).write_text(
                json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
            cuerpo = resumir(doc, ep)
            if cuerpo.startswith(SIN_RESUMEN):
                sin_resumen += 1
        resumen.append(f"{encabezado}\n{cuerpo}")
        print(f"{encabezado}\n{cuerpo}\n")
    (salida / "RESUMEN.txt").write_text("\n\n".join(resumen) + "\n", encoding="utf-8")
    entendidos = len(endpoints) - fallos - sin_resumen
    print(f"Guardado en {salida}: {entendidos} de {len(endpoints)} con esquema legible"
          + (f"; {sin_resumen} descargados pero sin entender (revisa su JSON guardado)" if sin_resumen else "")
          + (f"; {fallos} no se pudieron leer" if fallos else "")
          + ". No se llamó a ningún modelo ni se gastó nada.")
    return 1 if fallos or sin_resumen else 0


if __name__ == "__main__":
    raise SystemExit(main())
