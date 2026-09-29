"""RAG·13 — lo que decide el dueño en /automatiza, el aviso de privacidad y
los términos, en UN solo archivo.

Las páginas públicas (static/automatiza.html, privacidad.html, terminos.html)
llevan marcadores `{{clave}}` y el server los llena con DATOS al servirlas,
con escape HTML. Así el dueño llena el responsable, los plazos o el proveedor
tocando solo este archivo, y la casilla de recontacto dice en todas partes lo
mismo que se guarda con el correo (RECONTACTO_TEXTO y AVISO_VERSION van a
automatiza_contactos: esa es la prueba del consentimiento).

Un marcador sin clave NO se sirve crudo: revienta aquí, y
tests/test_rag_paginas.py lo caza antes del deploy.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from pipeline import publico as freno

# Cambia cada vez que cambie lo que dice el aviso: se guarda con cada correo.
AVISO_VERSION = "2026-09-29-borrador"
RECONTACTO_TEXTO = ("Quiero recibir por correo nuevas automatizaciones y "
                    "tutoriales de Irremplazables.")

DATOS = {
    "responsable": "[POR ESCRIBIR: nombre o razón social del responsable]",
    "domicilio": "[POR ESCRIBIR: domicilio para oír y recibir notificaciones]",
    "correo_privacidad": "[POR ESCRIBIR: correo para derechos ARCO]",
    "plazo_peticion": "[POR DECIDIR (RAG·0): cuánto guardamos la petición y el flujo]",
    "plazo_correo": "[POR DECIDIR (RAG·0): cuánto guardamos el correo]",
    "proveedor_correo": "[POR DECIDIR (RAG·14): proveedor de envío de correo]",
    "fecha_aviso": "29 de septiembre de 2026",
    "aviso_version": AVISO_VERSION,
    "recontacto_texto": RECONTACTO_TEXTO,
    # los topes de largo salen del freno (RAG·7): la página y el servidor no
    # pueden decir números distintos
    "largo_maximo": str(freno.LARGO_MAXIMO),
    "largo_minimo": str(freno.LARGO_MINIMO),
}

ESTATICOS = Path(__file__).resolve().parent.parent / "static"
_MARCADOR = re.compile(r"\{\{([A-Za-z0-9_]+)\}\}")


class MarcadorDesconocido(ValueError):
    """La página pide un {{hueco}} que DATOS no tiene (o uno mal escrito)."""


def llenar(texto: str, datos: dict | None = None) -> str:
    """Sustituye cada {{clave}} por su valor escapado. Lo que quede con forma
    de marcador —clave que no existe, `{{ con espacios }}`— es un error."""
    datos = DATOS if datos is None else datos
    faltan = sorted({m for m in _MARCADOR.findall(texto) if m not in datos})
    if faltan:
        raise MarcadorDesconocido(f"marcadores sin clave en DATOS: {faltan}")
    lleno = _MARCADOR.sub(lambda m: html.escape(str(datos[m.group(1)]), quote=True), texto)
    if "{{" in lleno:
        resto = lleno[lleno.index("{{"):][:40]
        raise MarcadorDesconocido(f"marcador mal escrito: {resto!r}")
    return lleno


# (ruta, mtime_ns) → html ya lleno. Con la mtime en la llave, en local un
# cambio a la página se ve al recargar; en Lambda el archivo no cambia y se
# lee una sola vez por contenedor.
_CACHE: dict[tuple[str, int], str] = {}


def renderizar(nombre: str, directorio: Path | None = None) -> str:
    """La página `nombre` de `directorio` (por defecto static/) ya llena."""
    ruta = Path(directorio or ESTATICOS) / nombre
    llave = (str(ruta), ruta.stat().st_mtime_ns)
    if llave not in _CACHE:
        lleno = llenar(ruta.read_text(encoding="utf-8"))
        for vieja in [k for k in _CACHE if k[0] == llave[0]]:
            del _CACHE[vieja]
        _CACHE[llave] = lleno
    return _CACHE[llave]
