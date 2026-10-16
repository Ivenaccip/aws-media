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
from datetime import datetime, timezone

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


def _barrer_producir(user_id: str, proyecto_id: str, arranque_s: float | None = None) -> dict:
    """Devuelve lo cobrado por una película cuya tarea nunca llegó a correr.
    (`arranque_s` lo reciben todos los barredores; este no lo necesita: la película tiene UN
    estado y el claim `produciendo → error` ya distingue una corrida de otra.)"""
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


# Cuánto puede adelantarse el `inicio` que escribió el API al `startDate` que sella Step Functions
# antes de que el evento sea de OTRA corrida. Cubre el desfase de los relojes y los segundos que
# separan "escribir inicio" de "start_execution" (el API escribe `inicio` primero y lanza después).
HOLGURA_RELOJ_S = 5.0


def _arranque_s(detalle: dict) -> float | None:
    """Cuándo EMPEZÓ la ejecución del evento, en segundos desde la época. EventBridge manda
    `startDate` en milisegundos. None si falta o no se entiende: sin él no hay con qué comparar y
    el barredor actúa como siempre."""
    v = detalle.get("startDate")
    if isinstance(v, bool):
        return None
    try:
        n = float(v)
    except (TypeError, ValueError):
        return None
    if not 0 < n < float("inf"):
        return None
    return n / 1000.0 if n > 1e11 else n


def _epoch(iso: object) -> float | None:
    """Un `inicio` ISO del doc (`2026-10-15T18:02:11+00:00`) como segundos; None si no se lee."""
    if not isinstance(iso, str) or not iso.strip():
        return None
    try:
        d = datetime.fromisoformat(iso.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def _evento_de_otra_corrida(user_id: str, nombre: str, arranque_s: float | None) -> bool:
    """¿El evento es de una ejecución ANTERIOR a la corrida que el doc tiene ahora?

    Una copia con error se reintenta sobre el MISMO doc, y `corriendo` es `corriendo` para cualquier
    ejecución: el evento FAILED de la corrida vieja, que llega segundos tarde, reclamaba la corrida
    NUEVA y le devolvía lo recién cobrado (o lo que aún no se cobraba). La corrida vigente es la que
    `editar.inicio` dice (el API lo escribe antes de lanzar, en el cobro y en cada reintento): si
    empezó DESPUÉS que la ejecución del evento, el evento ya no habla de ella. Sin `startDate` en el
    evento, o sin `inicio` legible en el doc, no hay con qué comparar y se sigue como antes."""
    if arranque_s is None:
        return False
    from pipeline import db
    doc = db.cargar_proyecto_editor(user_id, nombre)
    editar = doc.get("editar") if isinstance(doc, dict) else None
    inicio = _epoch(editar.get("inicio")) if isinstance(editar, dict) else None
    return inicio is not None and inicio > arranque_s + HOLGURA_RELOJ_S


def _movimientos(user_id: str, nombre: str) -> list[dict]:
    """Los movimientos del libro mayor de ESTA copia (el más reciente primero)."""
    from pipeline import db
    ref = f"editar-sugerir:{nombre}"
    return [m for m in db.movimientos_creditos(user_id, 200) if m.get("referencia") == ref]


def _neto_cobrado(user_id: str, nombre: str) -> int:
    """Créditos cobrados y sin devolver de esta copia según el libro mayor (los cargos son negativos
    y las devoluciones positivas). Es lo que usa `server/edicion_api._soltar` cuando no sabe si se
    cobró."""
    return max(0, -sum(int(m.get("creditos") or 0) for m in _movimientos(user_id, nombre)))


def _barrer_editor(campo: str, referencia: str):
    """Los tres trabajos del editor que cobran. Comparten forma: el API cobró y
    dejó el monto escrito en el doc, el worker lo cierra a 'listo' o 'error'.

    Barrerlos no es cosmético. Sin esto el trabajo se queda 'corriendo' para
    siempre y lo único que lo destraba es la caducidad de 2 h de su pantalla —
    que deja lanzar otro, **y el otro vuelve a cobrar**. O sea: el usuario
    acababa pagando dos veces por la tarea que nunca corrió."""
    def barrer(user_id: str, nombre: str, arranque_s: float | None = None) -> dict:
        from pipeline import creditos, db

        if campo == "editar" and _evento_de_otra_corrida(user_id, nombre, arranque_s):
            log.warning("barredor: %s: el evento es de una ejecución anterior a la corrida vigente; "
                        "no se toca", nombre)
            return {"accion": "nada", "motivo": "el evento es de una corrida anterior"}
        trabajo = db.reclamar_fallo_editor(user_id, nombre, campo, MENSAJE)
        if trabajo is None:
            if campo == "editar":
                # el worker pudo dejar una deuda sin cobrar (su monedero falló y el doc ya no se
                # podía reabrir, o la copia quedó entregada): la cobra el evento de su ejecución
                saldada = _cobrar_deuda_editar(user_id, nombre)
                if saldada is not None:
                    return saldada
            return {"accion": "nada", "motivo": "el trabajo ya no estaba corriendo"}
        # el monto lo escribió quien cobró; recalcular la tarifa aquí devolvería
        # el precio de hoy y no el que se pagó
        n = int(trabajo.get("creditos") or 0)
        if n and creditos.activo():
            if campo == "editar" and trabajo.get("cobrado") is False:
                # el API aún no confirmó el cobro de esta corrida (un reintento a medio arrancar):
                # no se sabe si se cobró, así que manda el libro mayor y no el monto del doc
                n = min(n, _neto_cobrado(user_id, nombre))
            if n:
                try:
                    creditos.devolver(n, referencia.format(nombre=nombre), user_id)
                except Exception:
                    if campo == "editar":
                        _reabrir_editar(user_id, nombre, trabajo, n)
                    raise
                if campo == "editar":
                    _anotar_devueltos(user_id, nombre, trabajo, n)
        log.info("barredor: %s/%s cerrado, %d créditos devueltos", campo, nombre, n)
        return {"accion": "devuelto", "creditos": n, "proyecto": nombre}
    return barrer


def _cobrar_deuda_editar(user_id: str, nombre: str) -> dict | None:
    """Cobra lo que el worker de una COPIA dejó anotado en `editar.devolucion_pendiente`.

    El worker reclama la corrida (`error`) y devuelve; si el monedero falla intenta reabrirla
    (`corriendo`) para que el barredor la reclame, pero el índice único de una copia en curso puede
    impedirlo si la persona ya lanzó otra, y una copia entregada con CERO sugerencias (`listo`) ni
    siquiera tiene ejecución caída. En los dos casos la deuda queda anotada en un doc que el
    reclamo no alcanza. La ejecución del worker termina FAILED (sale con 1 justo por eso) y su
    evento llega aquí: si el doc es una copia, no está `corriendo`, debe algo y no consta que se
    devolviera, se abona.

    El libro mayor decide si de verdad falta: si el último movimiento de esta copia ya es una
    devolución, el abono salió y lo que falló fue la anotación (el evento se reintenta): solo se
    anota. Devolver de más es tan malo como no devolver. Si el libro no dice nada de esta copia no
    se inventa nada: se avisa en el log y no se toca el monedero. Devuelve el resultado del
    barrido, o None si no había deuda."""
    from pipeline import creditos, db
    if not creditos.activo():
        return None
    doc = db.cargar_proyecto_editor(user_id, nombre)
    editar = doc.get("editar") if isinstance(doc, dict) else None
    if (not isinstance(editar, dict) or editar.get("copia") is not True
            or editar.get("estado") == "corriendo" or editar.get("devueltos")):
        return None
    debe = editar.get("devolucion_pendiente")
    if isinstance(debe, bool) or not isinstance(debe, int) or debe <= 0:
        return None
    debe = min(debe, int(editar.get("creditos") or 0))      # jamás más de lo que se cobró
    if debe <= 0:
        return None
    movimientos = _movimientos(user_id, nombre)
    if not movimientos:
        log.error("barredor: %s debe %d créditos pero el libro mayor no tiene movimientos de esta "
                  "copia en los últimos 200: NO se toca el monedero, revisar a mano", nombre, debe)
        return None
    if movimientos[0].get("tipo") == "cargo":
        creditos.devolver(debe, f"editar-sugerir:{nombre}", user_id)    # si falla, sube y se reintenta
        pagado = debe
    else:
        log.warning("barredor: %s ya tenía su devolución en el libro mayor; solo se anota", nombre)
        pagado = 0
    _anotar_devueltos(user_id, nombre, editar, debe)
    log.info("barredor: %s deuda cobrada, %d créditos devueltos", nombre, pagado)
    if pagado:
        return {"accion": "devuelto", "creditos": pagado, "proyecto": nombre}
    return {"accion": "nada", "motivo": "la deuda ya estaba abonada; se anotó"}


def _anotar_devueltos(user_id: str, nombre: str, trabajo: dict, n: int) -> None:
    """E2: la bandeja «Tus trabajos» dice «Te devolvimos ✦ N» leyendo
    `doc.editar.devueltos`, y el barredor es quien cierra la edición cuando la tarea
    ni arrancó. `reclamar_fallo_editor` devuelve el objeto `editar` ya en `error`: se
    le agrega lo devuelto y se guarda. Va DESPUÉS del abono y sin levantar nada: si
    la anotación falla, el dinero ya volvió y reintentar el evento no devolvería
    de nuevo (el reclamo ya perdió), así que solo se avisa en el log."""
    from pipeline import db
    try:
        trabajo["devueltos"] = n
        trabajo.pop("devolucion_pendiente", None)      # el que dejó un abono fallido, ya saldado
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(trabajo, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        log.exception("barredor: %s devuelto (%d créditos) pero no se pudo anotar", nombre, n)


def _reabrir_editar(user_id: str, nombre: str, trabajo: dict, n: int) -> None:
    """E2: el monedero falló DESPUÉS de ganar el reclamo. Sin esto el doc queda en
    `error` y el reintento del evento pierde el reclamo: los créditos no vuelven nunca.
    Se deja otra vez `corriendo` y se relanza el error: el reintento reclama de nuevo
    y devuelve.

    Si reabrir no se puede (el índice único de una copia en curso: la persona ya lanzó otra), el
    doc se queda en `error` pero CON la deuda anotada (`devolucion_pendiente`): el reintento del
    evento no puede reclamarlo, y `_cobrar_deuda_editar` la cobra desde ahí. Si ni eso se puede
    escribir, queda dicho en el log."""
    from pipeline import db
    try:
        trabajo.update(estado="corriendo", devolucion_pendiente=n)
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(trabajo, ensure_ascii=False))
        return
    except Exception:  # noqa: BLE001
        log.exception("barredor: %s no se pudo reabrir (¿otra copia corriendo?); queda la deuda "
                      "anotada en el doc", nombre)
    try:
        trabajo.update(estado="error", devolucion_pendiente=n)
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(trabajo, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        log.exception("barredor: %s NO se devolvieron %d créditos y el doc no se pudo marcar", nombre, n)


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
    return fn(user_id, proyecto_id, _arranque_s(detalle))
