"""M23 · D (prerrequisito) — cierra las ejecuciones que murieron sin devolver.

La state machine `aws-media-producir` tiene UN estado y ningún `Catch`
(`infra/stacks/jobs.py`), y el `creditos.devolver` de cada tarea vive DENTRO
del contenedor. Mientras el contenedor arranque, esa devolución ocurre y aquí
no hay nada que hacer. El agujero es lo que pasa ANTES de que arranque:

  - la imagen de ECR no se pudo bajar (`ResourceInitializationError`),
  - no había capacidad de Fargate para una tarea de 4 vCPU,
  - la máquina de estados venció a las 2 h y mató la tarea,
  - alguien abortó la ejecución a mano.

En todos esos casos la ejecución queda FAILED/TIMED_OUT/ABORTED, el código
Python nunca corrió, y el usuario se queda sin película Y sin créditos. Con
182 personas eso es dinero de gente real, así que EventBridge avisa del final
de cada ejecución y este módulo la cierra.

**La idempotencia no es una tabla nueva ni una marca**: es el UPDATE
condicionado de `db.reclamar_fallo_produccion`, que solo gana si el proyecto
sigue en 'produciendo'. Si el contenedor llegó a correr, él ya lo movió a
'error' (devolviendo), a 'listo' o a 'imagenes', y el claim pierde. El orden
también ayuda: EventBridge avisa cuando la ejecución TERMINA, o sea después de
que el contenedor guardó su estado.

Devolver de más es tan malo como no devolver: son créditos regalados que nadie
compró. Por eso, cuando este módulo no puede saber cuánto se cobró, no inventa
un número — lo registra y no toca el monedero.
"""
from __future__ import annotations

import json
import logging
import os

log = logging.getLogger("worker")

# Los seis módulos que la state machine puede correr. El `command` del input
# los nombra: ["python", "-m", "worker.producir_task", user, proyecto, fase].
MODULOS_SIN_COBRO = ("render_task", "subtitulos_task")


def modulo_de(command: list | None) -> str:
    """'worker.producir_task' → 'producir_task'. Vacío si el comando no tiene
    la forma esperada (nunca revienta: esto corre reaccionando a un evento)."""
    partes = [str(x) for x in (command or [])]
    if "-m" not in partes:
        return ""
    i = partes.index("-m") + 1
    if i >= len(partes):
        return ""
    return partes[i].rsplit(".", 1)[-1]


def _barrer_producir(user_id: str, proyecto_id: str) -> dict:
    """Devuelve lo cobrado por una película cuya tarea nunca llegó a correr."""
    from pipeline import creditos, db
    from pipeline.project import cargar_proyecto

    if not db.reclamar_fallo_produccion(user_id, proyecto_id):
        # el contenedor sí corrió y ya cerró el proyecto: su propia devolución
        # (worker/producir_task.py) es la buena
        return {"accion": "nada", "motivo": "el proyecto ya no estaba produciendo"}

    # El claim ya está puesto, así que la devolución está protegida contra
    # duplicados pase lo que pase debajo. Primero el dinero, después el doc.
    os.environ["DEFAULT_USER_ID"] = user_id     # p.guardar() lee el usuario actual
    p = cargar_proyecto(proyecto_id)
    if p is None:
        log.error("barredor: %s reclamado pero el doc no existe", proyecto_id)
        return {"accion": "nada", "motivo": "el proyecto no existe"}

    devueltos = 0
    if creditos.activo():
        devueltos = creditos.producir_cobrado(p)
        creditos.devolver(devueltos, f"producir:{proyecto_id}", user_id)

    p.estado = "error"
    p.error = ("La producción se detuvo antes de empezar y no se te cobró. "
               "Vuelve a intentarlo.")
    p.guardar()
    log.info("barredor: %s cerrado, %d créditos devueltos", proyecto_id, devueltos)
    return {"accion": "devuelto", "creditos": devueltos, "proyecto": proyecto_id}


MENSAJE = ("La corrida se detuvo antes de empezar y no se te cobró. "
           "Vuelve a intentarlo.")


def _barrer_editor(campo: str, referencia: str):
    """Los tres trabajos del editor que cobran. Comparten forma: el API cobró y
    dejó el monto escrito en el doc, el worker lo cierra a 'listo' o 'error'.

    Barrerlos no es cosmético. Sin esto el trabajo se queda 'corriendo' para
    siempre y lo único que lo destraba es la caducidad de 2 h de su pantalla —
    que deja lanzar otro, **y el otro vuelve a cobrar**. O sea: el usuario
    acababa pagando dos veces por la tarea que nunca corrió."""
    def barrer(user_id: str, nombre: str) -> dict:
        from pipeline import creditos, db

        trabajo = db.reclamar_fallo_editor(user_id, nombre, campo, MENSAJE)
        if trabajo is None:
            return {"accion": "nada", "motivo": "el trabajo ya no estaba corriendo"}
        # el monto lo escribió quien cobró; recalcular la tarifa aquí devolvería
        # el precio de hoy y no el que se pagó
        n = int(trabajo.get("creditos") or 0)
        if n and creditos.activo():
            creditos.devolver(n, referencia.format(nombre=nombre), user_id)
        log.info("barredor: %s/%s cerrado, %d créditos devueltos", campo, nombre, n)
        return {"accion": "devuelto", "creditos": n, "proyecto": nombre}
    return barrer


BARREDORES = {
    "producir_task": _barrer_producir,
    "shorts_task": _barrer_editor("shorts", "shorts-render:{nombre}"),
    "editar_task": _barrer_editor("editar", "editar-sugerir:{nombre}"),
    # activar una versión de la pista 2 no cobra (creditos: 0) y generar sí;
    # el doc lo distingue solo. La referencia es la que ya usan las otras
    # devoluciones de overlay, no la del cobro (`overlay-video:<n>:<oid>`):
    # dos fallos iguales deben verse iguales en el libro mayor.
    "overlay_task": _barrer_editor("overlay_job", "overlay:{nombre}"),
}


def barrer(detalle: dict) -> dict:
    """`detail` del evento «Step Functions Execution Status Change».

    Solo se llama con finales malos (el filtro está en la regla de EventBridge,
    `infra/stacks/jobs.py`), pero se vuelve a comprobar aquí: una regla mal
    editada no debe poder devolver créditos de ejecuciones que salieron bien.
    """
    estado = str(detalle.get("status") or "")
    if estado not in ("FAILED", "TIMED_OUT", "ABORTED"):
        return {"accion": "nada", "motivo": f"estado {estado or 'desconocido'}"}

    # EventBridge recorta el input si pasa de 256 KB; el nuestro son tres
    # campos, pero sin él no hay a quién devolverle nada.
    if detalle.get("inputDetails", {}).get("included") is False:
        log.error("barredor: evento sin input (recortado), no se puede barrer")
        return {"accion": "nada", "motivo": "input recortado"}
    try:
        entrada = json.loads(detalle.get("input") or "{}")
    except ValueError:
        log.error("barredor: input ilegible")
        return {"accion": "nada", "motivo": "input ilegible"}

    user_id = str(entrada.get("user_id") or "")
    proyecto_id = str(entrada.get("proyecto_id") or "")
    modulo = modulo_de(entrada.get("command"))
    if not user_id or not proyecto_id or not modulo:
        log.error("barredor: input incompleto (%s)", sorted(entrada))
        return {"accion": "nada", "motivo": "input incompleto"}

    if modulo in MODULOS_SIN_COBRO:
        return {"accion": "nada", "motivo": f"{modulo} no cobra créditos"}

    fn = BARREDORES.get(modulo)
    if fn is None:
        # Que se vea en los logs: un trabajo que cobra y todavía no se barre es
        # deuda conocida, no un caso que se pueda ignorar en silencio.
        log.error("barredor: %s murió en %s y ese módulo aún no se barre",
                  proyecto_id, modulo)
        return {"accion": "nada", "motivo": f"{modulo} sin barredor"}
    return fn(user_id, proyecto_id)
