"""M23 · D — el ejemplo del día 1 de MIX, preparado en la cola.

Es lo único de MIX que el usuario mira ANTES de pagar: la publicación del
primer día, entera, para decidir si enciende la campaña. No cobra nada, y si
enciende, esta misma imagen ES la del día 1 (`db.mix_guardar_ejemplo` la deja
en estado 'ejemplo' y el reloj la reclama en vez de generar otra).

**Por qué vive en el worker y no en el endpoint.** Hasta el 20-sep-2026 el
ejemplo se generaba dentro del POST, en línea. Entre el LLM y Grok pasan de
treinta segundos a dos minutos, y API Gateway corta toda petición a los 29 s:
en la nube ese endpoint se moría SIEMPRE con un 500, y subir el timeout de la
Lambda no cambia nada porque el tope no es suyo. En el server local no hay tal
tope y ahí sí funcionaba — por eso llegó a producción.

**Lo que este archivo tiene que defender**, y es lo mismo que defendía el
endpoint, solo que ahora el hueco dura más:

  * **no publicar dos veces.** Entre que se encola y termina, el usuario puede
    encender la campaña y el reloj publicar el día 1 de verdad. Guardar el
    ejemplo encima devolvería esa fila a 'ejemplo' y el reloj la vería libre
    otra vez. Se comprueba aquí ANTES de escribir, y la base lo vuelve a
    comprobar en el WHERE del upsert;
  * **no dejar un ejemplo huérfano.** Si mueve el día de arranque mientras se
    genera, lo que salga ya no es el día 1 de nada: se tira;
  * **no dejar la pantalla colgada.** Cualquier fallo se escribe en la fila del
    día (`db.mix_fallar_ejemplo`), que es lo que la pantalla está mirando.

Nunca relanza, por lo mismo que `worker/mix_dia.py`: un reintento de SQS es
otra imagen de Grok pagada por nosotros para enseñar lo mismo.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import date

from worker.env_ssm import cargar_env_usuario
from worker.mix_dia import bajar_imagen, dir_imagenes, limpiar, tema_e_imagen

log = logging.getLogger("worker")

SIN_IMAGEN = ("Perdimos la foto de la campaña. Vuelve a subirla y pide otro "
              "ejemplo.")
SIN_MODELO = "No pudimos preparar el ejemplo. Inténtalo otra vez."


def _dia_de_arranque(campana: dict | None) -> str:
    """El primer día de la campaña, en ISO. `''` si no hay campaña."""
    return str((campana or {}).get("empieza") or "")[:10]


def _sigue_valiendo(user_id: str, campana_id: str, dia: str) -> dict | None:
    """La campaña, si preparar este día todavía tiene sentido; si no, None.

    Dos motivos para que no lo tenga, y los dos son normales: que la haya
    encendido (desde ahí manda el reloj, no nosotros) o que haya movido el
    arranque (lo que saliera sería el día 1 de un rango que descartó)."""
    from pipeline import db

    campana = db.mix_campana_de(user_id, campana_id)
    if campana is None or campana["estado"] != "borrador":
        log.info("mix %s/%s: el ejemplo del %s ya no hace falta (campaña %s)",
                 user_id, campana_id, dia,
                 (campana or {}).get("estado") or "borrada")
        return None
    if _dia_de_arranque(campana) != dia:
        log.info("mix %s/%s: el ejemplo del %s se tira, ahora empieza el %s",
                 user_id, campana_id, dia, _dia_de_arranque(campana))
        return None
    return campana


def _anotar(user_id: str, campana_id: str, dia: str, mensaje: str) -> dict:
    """Deja el fallo escrito en la fila del día, y se traga lo suyo.

    Si esta escritura levantara, la excepción subiría hasta la Lambda, SQS
    reentregaría el mensaje y ese reintento pagaría una segunda imagen de Grok
    para enseñar exactamente lo mismo. Un trabajo que promete no levantar no
    puede tener un camino de error que levante."""
    from pipeline import db

    try:
        db.mix_fallar_ejemplo(user_id, campana_id, dia, mensaje)
    except Exception as err:  # noqa: BLE001 — la base, y no se puede hacer más
        log.error("mix %s/%s: no se pudo anotar el fallo del %s (%s)", user_id,
                  campana_id, dia, type(err).__name__)
    return {"accion": "error", "dia": dia, "error": mensaje}


def preparar(user_id: str, campana_id: str, dia: str) -> dict:
    """Punto de entrada del trabajo `mix_ejemplo`. Nunca levanta."""
    from pipeline import costes_infra

    t0 = time.monotonic()
    try:
        # el env del trabajo anterior sigue puesto en una Lambda caliente: sin
        # esto la imagen se generaría con la clave de Grok de otro usuario.
        # Va DENTRO del try porque SSM también falla: fuera, un throttling
        # subía hasta la Lambda, SQS reentregaba y el trabajo acababa en la DLQ
        # sin haber escrito nada — la pantalla girando sin error que leer.
        os.environ["DEFAULT_USER_ID"] = user_id
        cargar_env_usuario(user_id)
        return _preparar(user_id, campana_id, dia)
    except Exception as err:  # noqa: BLE001 — relanzar pagaría otra imagen
        log.error("mix %s/%s: el ejemplo del %s falló (%s)", user_id,
                  campana_id, dia, type(err).__name__)
        return _anotar(user_id, campana_id, dia, SIN_MODELO)
    finally:
        # mismo concepto que la corrida de un día: los dos son MIX gastando
        # worker, y separarlos partiría en dos la única línea que el dashboard
        # sabe leer
        costes_infra.registrar(user_id, campana_id, "infra-mix",
                               costes_infra.costo_lambda(time.monotonic() - t0))


def _preparar(user_id: str, campana_id: str, dia: str) -> dict:
    from pipeline import db, media_sync, mix

    campana = _sigue_valiendo(user_id, campana_id, dia)
    if campana is None:
        return {"accion": "nada", "motivo": "la campaña cambió"}

    try:
        base = bajar_imagen(user_id, campana["imagen_key"])
    except FileNotFoundError:
        return _anotar(user_id, campana_id, dia, SIN_IMAGEN)

    media_key = mix.nombre_del_dia(campana_id, dia)
    ruta = dir_imagenes() / media_key
    ruta.parent.mkdir(parents=True, exist_ok=True)
    try:
        # sin temas ya usados: es el primer día y no hay nada que repetir
        plan = asyncio.run(tema_e_imagen(campana, date.fromisoformat(dia),
                                         ruta, base, []))
        media_sync.subir_archivo(ruta, mix.clave_imagen(user_id, media_key))
    except Exception as err:  # noqa: BLE001 — el modelo, la red o el CDN
        log.error("mix %s/%s: no se pudo generar el ejemplo del %s (%s)",
                  user_id, campana_id, dia, type(err).__name__)
        return _anotar(user_id, campana_id, dia, SIN_MODELO)
    finally:
        # la copia buena ya está en S3 y /tmp lo comparten todos los usuarios
        # que atiende el mismo contenedor caliente
        limpiar(ruta)

    # El último vistazo, y es el que importa. Desde el `_sigue_valiendo` de
    # arriba pasaron el LLM y Grok —hasta dos minutos— y en ese rato el usuario
    # pudo encender la campaña y el reloj publicar el día 1 de verdad.
    if _sigue_valiendo(user_id, campana_id, dia) is None:
        return {"accion": "nada", "motivo": "la campaña cambió mientras tanto"}
    db.mix_guardar_ejemplo(user_id, campana_id, dia, tema=plan["tema"],
                           texto=plan["texto"], media_key=media_key)
    log.info("mix %s/%s: ejemplo del %s listo", user_id, campana_id, dia)
    return {"accion": "ejemplo", "dia": dia}
