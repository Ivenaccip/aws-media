"""Ajustes 3 — Biblioteca de prompts: «De la casa», «Míos» y el top 3 fijado.

    GET    /api/biblioteca              todo en una carga (la web filtra en el navegador)
    PUT    /api/biblioteca/fijados      REEMPLAZA el top 3 fijado (el orden importa)
    POST   /api/biblioteca/mios         guarda un COI en «Míos» (idempotente por `clave`)
    DELETE /api/biblioteca/mios/{id}    borra uno de «Míos»

«De la casa» son los prompts curados por el dueño y salen de `server/biblioteca_casa.json`
(estático, solo lectura, SU almacén: nada que ver con `prompts/` ni con
`tools/prompts_sync.py`, que son los prompts internos del sistema). «Míos» son los que
una persona guarda desde COI: privados, en la base. Aquí NO se edita, ni se sugiere, ni
se vota, ni se crea a mano: no está en la v1.

Reglas que no se negocian (contrato «Ajustes 3», §2 y §5):

  - **Aislamiento**: toda consulta de «Míos» y de fijados lleva el usuario de la
    petición. Jamás se ve, se fija ni se borra algo de otra persona; un id ajeno
    responde igual que uno que no existe.
  - **Fijados**: máximo 3, sin repetidos, solo ids de la casa o míos, en el orden dado.
    Un pin huérfano (lo quitó el dueño de la casa, o se borró el «mío») se omite al
    leer y se limpia al siguiente PUT; borrar un «mío» lo saca de los fijados en la
    misma sentencia.
  - **Nada que la persona no haya pedido guardar**: `POST /mios` es el único camino
    que escribe un prompt, y lo llama el botón «Guardar». Guardar NO llama al modelo
    ni gasta uno de los usos de COI.

Todos los errores llevan `detail` como objeto: {"codigo", "texto", …extras}.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

from pipeline import db

router = APIRouter(prefix="/api/biblioteca", tags=["biblioteca"])
log = logging.getLogger("biblioteca_api")

CASA_RUTA = Path(__file__).with_name("biblioteca_casa.json")
CATEGORIAS = [{"clave": "imagen", "nombre": "Imagen"},
              {"clave": "video", "nombre": "Video"},
              {"clave": "guion", "nombre": "Guion y texto"},
              {"clave": "investigacion", "nombre": "Investigación"}]
CLAVES_CATEGORIA = tuple(c["clave"] for c in CATEGORIAS)
LLEVA_A = {"imagen": "imagen", "video": "video"}    # guion e investigación solo se copian

MAX_FIJADOS = 3
MAX_MIOS = 100
MAX_TITULO = 80
MAX_PARA_QUE = 160
MAX_PROMPT = 12000
MAX_ETIQUETAS = 3
MAX_ETIQUETA = 24
LIMITES = {"fijados": MAX_FIJADOS, "mios": MAX_MIOS, "titulo": MAX_TITULO, "prompt": MAX_PROMPT}

_ID_CASA = re.compile(r"^casa-[a-z0-9]+(-[a-z0-9]+)*$")
_ID_MIO = re.compile(r"^mio-[0-9a-f]{12}$")
_CLAVE = re.compile(r"^[0-9a-fA-F]{32}$")
_SIN_CACHE = {"Cache-Control": "no-store"}
_MAX_CUERPO = 256 * 1024          # un prompt de 12000 caracteres cabe de sobra

# ---------------------------------------------------------------------------
# errores: {codigo: (estado HTTP, texto para la persona)}

ERRORES: dict[str, tuple[int, str]] = {
    "cuerpo": (422, "No entendimos lo que mandaste. Recarga la página e inténtalo de nuevo."),
    "demasiados": (422, f"Ya tienes {MAX_FIJADOS} fijados. Quita uno para fijar otro."),
    "repetido": (422, "Ese prompt ya está entre tus fijados."),
    "desconocido": (422, "No encontramos uno de los prompts que quieres fijar. "
                         "Recarga la Biblioteca e inténtalo de nuevo."),
    "titulo_vacio": (422, "Ponle un título a tu prompt."),
    "prompt_vacio": (422, "No hay nada que guardar: el prompt está vacío."),
    "muy_largo": (422, "Algo de lo que quieres guardar es demasiado largo."),
    "categoria": (422, "Elige una categoría: Imagen, Video, Guion y texto o Investigación."),
    "etiquetas": (422, f"Usa hasta {MAX_ETIQUETAS} etiquetas de {MAX_ETIQUETA} caracteres como máximo."),
    "origen": (422, "Solo se guardan los COI que armas aquí."),
    "clave": (422, "Algo falló al guardar. Recarga la página e inténtalo de nuevo."),
    "lleno": (409, f"Ya tienes {MAX_MIOS} prompts guardados. Borra alguno para guardar otro."),
    "no_es_tuyo": (404, "No encontramos ese prompt entre los tuyos."),
    "no_disponible": (503, "La Biblioteca no está disponible por ahora. Inténtalo en unos minutos."),
    "no_nube": (503, "Tus prompts guardados viven en el servicio, no en tu computadora."),
}


def falla(codigo: str, texto: str | None = None, **extras: Any) -> HTTPException:
    status, base = ERRORES[codigo]
    return HTTPException(status, {"codigo": codigo, "texto": texto or base, **extras})


# ---------------------------------------------------------------------------
# «De la casa»: el archivo del dueño

def validar_casa(doc: Any) -> tuple[list[dict], list[str]]:
    """(los prompts válidos, los problemas encontrados). Lo usan el API (que se
    queda con los válidos y avisa en el log: un descuido al editar el archivo no
    debe tumbar la pantalla) y tests/test_biblioteca_casa.py (que exige cero
    problemas)."""
    problemas: list[str] = []
    crudos = doc.get("prompts") if isinstance(doc, dict) else None
    if not isinstance(crudos, list):
        return [], ["el archivo debe ser un objeto con la lista «prompts»"]
    validos: list[dict] = []
    vistos: set[str] = set()
    for n, p in enumerate(crudos, 1):
        def mal(motivo: str, n=n, p=p) -> None:
            problemas.append(f"#{n} ({p.get('id') if isinstance(p, dict) else '?'}): {motivo}")
        if not isinstance(p, dict):
            mal("no es un objeto")
            continue
        pid, titulo, para_que = p.get("id"), p.get("titulo"), p.get("para_que", "")
        prompt, categoria = p.get("prompt"), p.get("categoria")
        etiquetas, lleva_a = p.get("etiquetas", []), p.get("lleva_a")
        if not (isinstance(pid, str) and _ID_CASA.match(pid)):
            mal("el id debe ser «casa-» y minúsculas, cifras y guiones")
        elif pid in vistos:
            mal("id repetido")
        elif not (isinstance(titulo, str) and 1 <= len(titulo.strip()) <= MAX_TITULO):
            mal(f"el título debe tener de 1 a {MAX_TITULO} caracteres")
        elif not (isinstance(para_que, str) and len(para_que) <= MAX_PARA_QUE):
            mal(f"«para_que» debe ser texto de hasta {MAX_PARA_QUE} caracteres")
        elif not (isinstance(prompt, str) and 1 <= len(prompt.strip()) <= MAX_PROMPT):
            mal(f"el prompt debe tener de 1 a {MAX_PROMPT} caracteres")
        elif categoria not in CLAVES_CATEGORIA:
            mal(f"categoría desconocida: {categoria!r}")
        elif not (isinstance(etiquetas, list) and len(etiquetas) <= MAX_ETIQUETAS
                  and all(isinstance(e, str) and 1 <= len(e) <= MAX_ETIQUETA for e in etiquetas)):
            mal(f"hasta {MAX_ETIQUETAS} etiquetas de hasta {MAX_ETIQUETA} caracteres")
        elif lleva_a != LLEVA_A.get(categoria):
            mal(f"lleva_a debe ser {LLEVA_A.get(categoria)!r} para la categoría {categoria}")
        else:
            vistos.add(pid)
            validos.append({"id": pid, "titulo": titulo.strip(), "para_que": para_que,
                            "prompt": prompt, "categoria": categoria,
                            "etiquetas": list(etiquetas), "lleva_a": lleva_a})
            continue
    return validos, problemas


@lru_cache(maxsize=1)
def _casa() -> tuple[dict, ...]:
    """La lista de la casa, leída UNA vez por proceso (el archivo viaja en la imagen)."""
    try:
        doc = json.loads(CASA_RUTA.read_text(encoding="utf-8"))
    except (OSError, ValueError) as err:
        log.error("biblioteca: no se pudo leer %s (%s)", CASA_RUTA.name, type(err).__name__)
        return ()
    validos, problemas = validar_casa(doc)
    for problema in problemas:
        log.error("biblioteca: %s: %s", CASA_RUTA.name, problema)
    return tuple(validos)


def casa() -> list[dict]:
    return [dict(p, etiquetas=list(p["etiquetas"])) for p in _casa()]


# ---------------------------------------------------------------------------
# utilidades

def _nube() -> None:
    if db.backend() != "postgres":
        raise falla("no_nube")


def _usuario() -> str:
    _nube()
    return db.usuario_actual()


def _error_base(err: Exception) -> HTTPException:
    log.error("biblioteca: la base no respondió (%s)", type(err).__name__)
    return falla("no_disponible")


async def _cuerpo(request: Request) -> dict:
    largo = request.headers.get("content-length")
    if largo and largo.isdigit() and int(largo) > _MAX_CUERPO:
        raise falla("muy_largo")
    try:
        cuerpo = await request.json()
    except Exception:  # noqa: BLE001 — JSON roto o vacío
        raise falla("cuerpo") from None
    if not isinstance(cuerpo, dict):
        raise falla("cuerpo")
    return cuerpo


def _mio_publico(fila: dict) -> dict:
    return {"id": fila["id"], "titulo": fila["titulo"], "para_que": fila["para_que"],
            "prompt": fila["prompt"], "categoria": fila["categoria"],
            "etiquetas": list(fila["etiquetas"]), "origen": fila["origen"],
            "creado": fila["creado"], "lleva_a": None}


def _vigentes(ids: list[str], validos: set[str]) -> list[str]:
    """Los fijados que SIGUEN existiendo, en su orden y sin repetir."""
    salida: list[str] = []
    for i in ids:
        if i in validos and i not in salida:
            salida.append(i)
    return salida[:MAX_FIJADOS]


# ---------------------------------------------------------------------------
# GET /api/biblioteca

@router.get("")
def listar():
    user = db.usuario_actual()
    de_la_casa = casa()
    mios: list[dict] = []
    fijados: list[str] = []
    if db.backend() == "postgres":
        try:
            mios = [_mio_publico(f) for f in db.biblioteca_mios(user)]
            guardados = db.biblioteca_fijados(user)
        except Exception as err:  # noqa: BLE001
            raise _error_base(err) from None
        fijados = _vigentes(guardados, {p["id"] for p in de_la_casa} | {m["id"] for m in mios})
    return JSONResponse({"categorias": CATEGORIAS, "casa": de_la_casa, "mios": mios,
                         "fijados": fijados, "limites": LIMITES}, headers=_SIN_CACHE)


# ---------------------------------------------------------------------------
# PUT /api/biblioteca/fijados

@router.put("/fijados")
async def fijar(request: Request):
    user = _usuario()
    cuerpo = await _cuerpo(request)
    ids = cuerpo.get("ids")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids):
        raise falla("cuerpo")
    if len(ids) > MAX_FIJADOS:
        raise falla("demasiados")
    if len(set(ids)) != len(ids):
        raise falla("repetido")
    de_la_casa = {p["id"] for p in _casa()}
    propios = [i for i in ids if i not in de_la_casa]
    if any(not _ID_MIO.match(i) for i in propios):
        raise falla("desconocido")
    try:
        existen = await asyncio.to_thread(db.biblioteca_ids_mios, user, propios)
    except Exception as err:  # noqa: BLE001
        raise _error_base(err) from None
    if any(i not in existen for i in propios):
        raise falla("desconocido")        # jamás el «mío» de otra persona
    try:
        await asyncio.to_thread(db.biblioteca_fijar, user, ids)
    except Exception as err:  # noqa: BLE001
        raise _error_base(err) from None
    return JSONResponse({"fijados": ids}, headers=_SIN_CACHE)


# ---------------------------------------------------------------------------
# POST /api/biblioteca/mios

def _texto_de(cuerpo: dict, campo: str, *, vacio: str, tope: int) -> str:
    valor = cuerpo.get(campo)
    if valor is None:
        valor = ""
    if not isinstance(valor, str):
        raise falla("cuerpo")
    valor = valor.strip()
    if not valor and vacio:
        raise falla(vacio)
    if len(valor) > tope:
        raise falla("muy_largo", texto=f"El campo «{campo}» pasa de {tope} caracteres.",
                    campo=campo, max=tope)
    return valor


def _etiquetas_de(cuerpo: dict) -> list[str]:
    crudas = cuerpo.get("etiquetas")
    if crudas is None:
        return []
    if not isinstance(crudas, list) or not all(isinstance(e, str) for e in crudas):
        raise falla("etiquetas")
    limpias: list[str] = []
    for e in crudas:
        e = " ".join(e.split())
        if e and e.lower() not in (x.lower() for x in limpias):
            limpias.append(e)
    if len(limpias) > MAX_ETIQUETAS or any(len(e) > MAX_ETIQUETA for e in limpias):
        raise falla("etiquetas")
    return limpias


@router.post("/mios")
async def guardar(request: Request):
    user = _usuario()
    cuerpo = await _cuerpo(request)
    titulo = _texto_de(cuerpo, "titulo", vacio="titulo_vacio", tope=MAX_TITULO)
    prompt = _texto_de(cuerpo, "prompt", vacio="prompt_vacio", tope=MAX_PROMPT)
    para_que = _texto_de(cuerpo, "para_que", vacio="", tope=MAX_PARA_QUE)
    categoria = cuerpo.get("categoria")
    categoria = "guion" if categoria is None else categoria
    if categoria not in CLAVES_CATEGORIA:
        raise falla("categoria")
    etiquetas = _etiquetas_de(cuerpo)
    origen = cuerpo.get("origen")
    if (origen if origen is not None else "coi") != "coi":
        raise falla("origen")
    clave = cuerpo.get("clave")
    if clave is not None and not (isinstance(clave, str) and _CLAVE.match(clave)):
        raise falla("clave")
    clave = clave.lower() if clave else None

    for _ in range(2):      # el segundo intento solo existe por si el id al azar chocó
        try:
            hecho = await asyncio.to_thread(
                db.biblioteca_crear_mio, user, id_="mio-" + uuid.uuid4().hex[:12], clave=clave,
                titulo=titulo, para_que=para_que, prompt=prompt, categoria=categoria,
                etiquetas=etiquetas, origen="coi", tope=MAX_MIOS)
            if hecho is None and await asyncio.to_thread(db.biblioteca_contar_mios, user) >= MAX_MIOS:
                raise falla("lleno")
        except HTTPException:
            raise
        except Exception as err:  # noqa: BLE001
            raise _error_base(err) from None
        if hecho is not None:
            fila, creado = hecho
            return JSONResponse({"prompt": _mio_publico(fila)}, status_code=201 if creado else 200,
                                headers=_SIN_CACHE)
    log.error("biblioteca: no se pudo guardar un «mío» (id repetido dos veces)")
    raise falla("no_disponible")


# ---------------------------------------------------------------------------
# DELETE /api/biblioteca/mios/{id}

@router.delete("/mios/{mio_id}")
def borrar(mio_id: str):
    user = _usuario()
    if not _ID_MIO.match(mio_id):
        raise falla("no_es_tuyo")           # un id mal formado ni llega a la base
    try:
        borrado = db.biblioteca_borrar_mio(user, mio_id)
    except Exception as err:  # noqa: BLE001
        raise _error_base(err) from None
    if not borrado:
        raise falla("no_es_tuyo")
    return JSONResponse({"ok": True}, headers=_SIN_CACHE)
