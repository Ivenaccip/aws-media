"""M23 · D — el reloj de MIX: mira cada hora y despacha el día que toca.

Lo despierta una regla de EventBridge cada hora en punto (`infra/stacks/
jobs.py`). No publica: mira, decide y encola. Publicar es cosa de
`worker/mix_dia.py`, uno por día y por campaña, porque cada día tarda entre
medio minuto y dos y hacerlos todos seguidos aquí dentro se comería los quince
minutos de la Lambda en cuanto haya veinte campañas.

Por qué cada hora y no una vez al día: **las campañas tienen la hora del
usuario, no la nuestra**. Alguien en Quito pide las nueve de la mañana y
alguien en Madrid también, y no son el mismo instante. Un cron por hora cubre
las veinticuatro sin saber nada de zonas, y `mix.dia_que_toca` decide por cada
campaña si en SU reloj ya pasó su hora.

Que mirar cada hora no signifique publicar cada hora lo garantiza el PRIMARY
KEY de `mix_corridas`, no este archivo. Aquí solo se evita el trabajo inútil:
sin el filtro de los días ya tomados serían más de cuatro mil arranques diarios
que solo pierden el candado.

Además de despachar, el reloj cierra lo que nadie más cerraría:

  * **campañas vencidas.** 'activa' está dentro del índice parcial
    `mix_campana_viva`, así que una campaña cuyo último día ya pasó bloquearía
    para siempre la creación de otra. Al cerrarla se liquida lo que quedara a
    deber.
  * **corridas colgadas.** La Lambda que corre un día muere a los quince
    minutos; una corrida que lleva una hora 'corriendo' está muerta, y su día
    está cobrado por adelantado.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta

log = logging.getLogger("worker")

# Una corrida viva no puede durar más que la Lambda que la ejecuta (15 min).
# Una hora es el doble de holgura y coincide con el propio ritmo del reloj.
VENCE_CORRIDA_MIN = 60
COLGADA = ("Ese día se quedó a medias y no llegó a publicarse. Te devolvimos "
           "sus créditos; la campaña sigue con los días que faltan.")


def _dias_tomados() -> set:
    """Los días que ya tienen fila, para no despachar trabajos que solo van a
    perder el candado.

    Se dejan FUERA los de `db.ESTADOS_EJEMPLO`: esa fila es la del día 1, la
    del ejemplo que el usuario vio antes de pagar, y existe desde antes de
    encender. Contarla como tomada sería la forma silenciosa de que el primer
    día de todas las campañas no saliera nunca.

    La lista sale de `db` y no se escribe aquí porque ya se desincronizó una
    vez: cuando el ejemplo pasó a prepararse en la cola apareció el estado
    'preparando' y este filtro se quedó mirando solo 'ejemplo'. Bastaba con que
    alguien pidiera otro ejemplo y encendiera la campaña en el mismo minuto
    para que su día 1 se quedara ahí: cobrado, sin publicar, sin un solo error
    que leer, y con los créditos retenidos hasta que la campaña venciera.
    `db.mix_reclamar_ejemplo` ya sabe reclamar esa fila —con imagen la reusa y
    sin ella genera la del día— pero solo si el reloj llega a despacharla."""
    from pipeline import db

    # dos días de margen: entre Kiritimati y Midway hay 25 horas, así que
    # «hoy» de un usuario puede ser ayer o mañana en UTC
    desde = (date.today() - timedelta(days=2)).isoformat()
    return {(f["user_id"], f["campana_id"], str(f["dia"]))
            for f in db.mix_dias_tomados(desde)
            if f.get("estado") not in db.ESTADOS_EJEMPLO}


def rescatar_colgadas(minutos: int = VENCE_CORRIDA_MIN) -> int:
    """Cierra y devuelve los días que se reclamaron y nunca se cerraron.

    No se reintentan a propósito. La corrida muerta pudo haber llegado a crear
    el post justo antes de morir, y un reintento publicaría dos veces en la
    cuenta de un cliente. Entre devolverle el día y arriesgarse a publicárselo
    dos veces, se devuelve: es lo que ya decidió el repo para todo lo que
    cobra."""
    from pipeline import db
    from worker.mix_dia import devolver_dia

    n = 0
    for fila in db.mix_corridas_colgadas(minutos):
        user_id, campana_id = fila["user_id"], fila["campana_id"]
        dia = str(fila["dia"])
        if not db.mix_cerrar_dia(user_id, campana_id, dia, "error",
                                 error=COLGADA):
            continue    # alguien la cerró entre la consulta y ahora
        devolver_dia(user_id, campana_id, dia)
        log.warning("reloj: el día %s de %s/%s estaba colgado y se cerró",
                    dia, user_id, campana_id)
        n += 1
    return n


def terminar(campana: dict) -> bool:
    """Cierra una campaña cuyo último día ya pasó y liquida lo que se deba.

    El derecho a devolver se gana con el UPDATE condicionado de `mix_apagar`,
    igual que en el botón de apagar: si alguien la cerró antes, aquí no se
    devuelve nada. Normalmente no queda nada pendiente —cada día que falla se
    devuelve el mismo día—, pero la cuenta se hace igual: es la última
    oportunidad de que nadie se quede pagando una publicación que no salió."""
    from pipeline import creditos, db, mix

    user_id, id_ = campana["user_id"], campana["id"]
    cerrada = db.mix_apagar(user_id, id_, estado="terminada")
    if not cerrada:
        return False
    liquidados = db.mix_dias_liquidados(user_id, id_)
    pendiente = mix.devolucion_pendiente({**campana, **cerrada}, liquidados,
                                         creditos.MIX_POR_PUBLICACION_CR)
    if pendiente and creditos.activo():
        creditos.devolver(pendiente, f"mix:{id_}:terminada", user_id)
        db.mix_anotar_devolucion(user_id, id_, pendiente)
    log.info("reloj: campaña %s/%s terminada (%d días saldados, %d créditos "
             "devueltos)", user_id, id_, liquidados, pendiente)
    return True


def despachar() -> dict:
    """Lo que corre cada hora. Devuelve el resumen que queda en el log."""
    from pipeline import jobs, mix
    from pipeline import db

    hechas = {"revisadas": 0, "despachadas": 0, "terminadas": 0,
              "rescatadas": 0, "falladas": 0}
    # El rescate es limpieza y va primero, así que si revienta se lleva por
    # delante el despacho de TODAS las campañas de esa hora — cobradas y sin
    # publicar, y sin nadie mirando. Que falle no puede costar el día: se
    # registra y se sigue, el mismo criterio que con una campaña rota.
    try:
        hechas["rescatadas"] = rescatar_colgadas()
    except Exception as err:  # noqa: BLE001
        log.error("reloj: no se pudieron rescatar las corridas colgadas: %s: %s",
                  type(err).__name__, err)
    tomados = _dias_tomados()
    for campana in db.mix_encendidas():
        hechas["revisadas"] += 1
        user_id, id_ = campana["user_id"], campana["id"]
        try:
            ahora = mix.ahora_en(campana.get("zona"))
            if mix.termino(campana, ahora):
                hechas["terminadas"] += terminar(campana)
                continue
            if campana["estado"] != "activa":
                continue        # pausada: no publica, pero sí se cierra arriba
            dia = mix.dia_que_toca(campana, ahora)
            if dia is None or (user_id, id_, dia.isoformat()) in tomados:
                continue
            jobs.encolar_mix_dia(user_id, id_, dia.isoformat())
            hechas["despachadas"] += 1
            log.info("reloj: despachado el día %s de %s/%s", dia, user_id, id_)
        except Exception as err:  # noqa: BLE001 — una campaña no tumba al resto
            # que se vea: una campaña que el reloj no pudo revisar es una
            # campaña cobrada que no publica, y nadie más la va a mirar
            hechas["falladas"] += 1
            log.error("reloj: la campaña %s/%s no se pudo revisar: %s: %s",
                      user_id, id_, type(err).__name__, err)
    log.info("reloj: %s", hechas)
    return hechas
