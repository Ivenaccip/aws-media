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

/privacidad y /terminos cubren TODO Irremplazables: el Estudio (secciones 1 a
13, el texto que main publicó el 3-oct-2026) y /automatiza (sección 14). Este
archivo no existe en main —importa pipeline.publico, que allá no está—: allá
las dos páginas son HTML estático con estos mismos datos ya escritos. Si
cambias uno aquí, la página de main no se entera hasta el siguiente dev→main.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

from pipeline import publico as freno

# Cambia cada vez que cambie lo que dice el aviso o los términos (o un dato de
# DATOS): se guarda con cada petición y con cada correo de /automatiza, y es lo
# ÚNICO que dice qué texto aceptó esa persona. Al subirla, /automatiza vuelve
# a enseñar el aviso a quien ya había aceptado la anterior, y el servidor deja
# de guardar lo que llegue con la vieja (server/publico_api.py). Va con la
# fecha que muestran las páginas (`fecha_aviso`, abajo) y con su huella en
# tests/test_rag_paginas.py (HUELLAS_AVISO).
#
# 2026-10-04: la bajada de main (PR #174). El texto del Estudio es el de main,
# versión 2026-10-03; esta versión le suma la sección 14 de /automatiza.
AVISO_VERSION = "2026-10-04"
RECONTACTO_TEXTO = ("Quiero recibir por correo nuevas automatizaciones y "
                    "tutoriales de Irremplazables.")

DATOS = {
    # Lo decidió el dueño (3-oct-2026): el responsable es una empresa de
    # Estados Unidos, con un solo correo para contacto, privacidad y derechos.
    # El domicilio lleva «#»: llenar() lo escapa bien, pero en un HTML de
    # static/ escrito a mano va como «&#35;» (tests/test_m20_paleta lo leería
    # como un color).
    "responsable": "Fundamentos AI LLC",
    "domicilio": "2803 Philadelphia Pike, STE B #1531, Claymont, DE 19703 US",
    "correo_privacidad": "hola@irremplazables.xyz",
    # SIN DECIDIR (RAG·0): cuánto se guardan la petición y el correo de
    # /automatiza. No hay ningún código que los borre, así que el texto dice
    # eso y nada más: no promete un plazo que nadie fijó. Los dos se leen
    # después de «durante» (privacidad §14 y el aviso corto de automatiza.html).
    # Cuando el dueño decida: algo como «12 meses desde tu petición», subir
    # AVISO_VERSION y hacer la tarea que borre al vencer.
    "plazo_peticion": "un plazo que todavía no está fijado",
    "plazo_correo": "un plazo que todavía no está fijado",
    # SIN DECIDIR (RAG·14): el proveedor de envío. Hoy /automatiza guarda el
    # correo pero ningún código lo manda a un servicio de envío; es la celda
    # completa de «El envío de correo» en privacidad §14. Al conectar uno:
    # su nombre y qué recibe, y subir AVISO_VERSION.
    "proveedor_correo": ("Todavía no hay un proveedor conectado: /automatiza guarda tu "
                         "correo, pero aún no lo entrega a ningún servicio de envío. "
                         "Cuando lo haya, lo nombraremos aquí y publicaremos una versión "
                         "nueva de este aviso."),
    "fecha_aviso": "4 de octubre de 2026",
    "aviso_version": AVISO_VERSION,
    "recontacto_texto": RECONTACTO_TEXTO,
    # los topes de largo salen del freno (RAG·7): la página y el servidor no
    # pueden decir números distintos
    "largo_maximo": str(freno.LARGO_MAXIMO),
    "largo_minimo": str(freno.LARGO_MINIMO),
}

# Las claves de DATOS que el dueño todavía NO decide. Su texto no lleva
# corchetes —dice en prosa «todavía no»—, así que el candado de pendientes que
# llegó de main (tests/test_entrar_portada.py) no las ve: por eso se declaran
# aquí, a la vista. Mientras esta tupla no esté vacía, /automatiza no se puede
# encender en producción (PROD.publico en infra/entornos.py): lo vigila
# tests/test_entornos.py. Y tests/test_rag_paginas.py no deja vaciarla sin
# haber escrito el dato, ni escribir el dato sin sacarlo de aquí.
#
# `proveedor_correo` pesa doble: static/automatiza.html ya le dice al visitante
# «te lo mandamos a tu correo» y ningún código manda nada todavía (RAG·14).
#
# OJO: esto frena el ENCENDIDO en producción, no la publicación del texto. Las
# dos páginas legales se sirven en producción con o sin /automatiza, así que el
# dev→main que lleve este archivo publica estas tres frases tal cual. Decidir
# antes de ese merge, o aceptar que salgan así, es cosa del dueño.
SIN_DECIDIR = ("plazo_peticion", "plazo_correo", "proveedor_correo")

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
