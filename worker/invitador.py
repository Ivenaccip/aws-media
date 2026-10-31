"""Fase 2 — el invitador: la Lambda que manda invitaciones y recordatorios.

La despierta TODAS las mañanas una regla de EventBridge a las 16:00 UTC (10:00
hora centro), SOLO en prod (`infra/stacks/api.py`). En dev se dispara a mano. Qué
hace depende del interruptor (`invitaciones_interruptor`, vale la última fila; sin
filas está apagado):

  apagado  sale callado: ni lee el pool ni publica nada.
  ensayo   calcula la selección del día, la deja en la tabla como 'ensayo' (no
           bloquea nada) y publica el resumen con «ENSAYO» en el asunto. NO llama
           a Cognito.
  activo   por cada elegido: anota la fila 'enviando' (si choca con el índice
           único, ese paso ya salió y se salta), llama al MISMO código del
           dueño —`tools.usuarios.alta` para el alta nueva con su cortesía,
           `tools.usuarios.reenviar_provisional` para el RESEND sin créditos— y
           marca 'enviado' o 'fallo:<código>'. La página /acceso sigue viva mientras
           tanto: al anotar se vuelve a mirar el cupo (sin él, la corrida termina
           ahí) y si esa persona acaba de recibir otro correo (se salta).

Solo 'activo' toca Cognito. El interruptor se lee UNA vez por corrida: si el
dueño lo mueve a media corrida, vale para la de mañana.

La frecuencia también vive en el interruptor (`cada_dias`), para cambiarla sin
deploy: el reloj sigue diario y, en ensayo o activo, si hoy no toca
(`inv.toca_correr`) la Lambda sale callada, con una línea en el log: sin leer el
pool, sin mandar y sin publicar a SNS. Lo que tiene que correr a diario corre antes
de todo eso: la limpieza de los hashes de IP de la página /acceso, cuya retención de
«unas 31 horas» depende de esta corrida (`_limpiar_solicitudes`).

Quién y en qué orden lo decide `pipeline/invitaciones.py`; aquí solo se lee, se
manda y se cuenta. Las reglas que viven AQUÍ son las de no hacer daño:

  * Un código de tope de Cognito (CODIGOS_DE_TOPE de tools/usuarios.py) aborta
    el día: seguir crearía usuarios que no reciben su clave. Tres fallos
    seguidos también (las altas a medias cuentan: una base que falla en serie
    no puede dejar cuarenta cuentas sin cortesía).
  * Una invitación que Cognito rechaza por la dirección (DIRECCION_INVALIDA)
    pasa el miembro a 'revisar': si no, volvería al frente de la cola cada
    mañana, ocupando cupo y sumando a los tres seguidos.
  * Si la base falla a media corrida, se corta ahí y el resumen sale IGUAL con
    lo que alcanzó a pasar; después la excepción sigue su camino (log, métrica
    Errors y el destino de fallo de la Lambda, api.py).
  * Fuera de prod (INVITADOR_ES_PROD distinto de «1»), el modo activo solo
    manda a la lista blanca INVITADOR_PERMITIDOS; lo demás se anota como ensayo.
    Dev comparte el tope de correo de la cuenta con prod: una prueba no puede
    escribirle a un miembro real ni comerse su cupo.
  * Un alta nueva que falla DESPUÉS de Cognito (la base no respondió) ya mandó
    el correo: se marca 'enviado' y se reporta como «alta a medias», diciendo
    si la cortesía entró o no (se busca su movimiento en el monedero). NO se
    re-abona sola — repetir el alta crearía la cortesía dos veces si la base sí
    alcanzó a escribir.
  * Ni la Lambda ni EventBridge reintentan (retry 0 en los dos, api.py): un
    reintento a media corrida mandaría el doble. El índice único lo frenaría,
    pero el índice es la red, no el plan.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

from pipeline import invitaciones as inv

log = logging.getLogger("invitador")

PAUSA_S = 0.5
FALLOS_SEGUIDOS = 3
# No son fallos del envío: alguien entró (o ya tenía cuenta) entre la lectura
# del pool y la llamada. Se anotan y se sigue, sin contar para los tres seguidos.
SALTAR_SIN_CONTAR = ("UnsupportedUserStateException", "UsernameExistsException")
# Cognito rechaza la dirección misma («nombre.@x.com» pasa el filtro de dedazos
# y Cognito no la acepta). Mañana la rechazaría igual: el miembro pasa a
# 'revisar'. Sí cuenta para los tres seguidos: si es el pool y no la dirección,
# se corta en tres y no en cuarenta.
DIRECCION_INVALIDA = ("InvalidParameterException",)


def es_prod() -> bool:
    return os.getenv("INVITADOR_ES_PROD") == "1"


# ---------------------------------------------------------------------------
# la foto del día: lo mismo para el bot y para `tools/invitaciones.py hoy`

@dataclass
class Foto:
    ahora: datetime
    modo: str
    tope: int
    nota: str | None
    miembros: list
    usuarios: list
    envios: list
    gastado: int
    cupo: int             # lo que le queda al BOT: ya sin la reserva de la página
    todos: list           # todos los que tocan hoy, en orden
    elegidos: list        # los que caben en el cupo
    aviso_hermano: str | None = None
    cada_dias: int = inv.CADA_DIAS_DEFECTO
    toca: bool = True     # con esta frecuencia, ¿la siguiente salida del reloj corre?


def leer_pool(pool: str) -> list[dict]:
    """Todas las cuentas del pool (solo lectura: ListUsers)."""
    from tools import usuarios
    pag = usuarios._cognito(pool).get_paginator("list_users")
    return [inv.usuario_de_cognito(u)
            for pagina in pag.paginate(UserPoolId=pool) for u in pagina["Users"]]


def tomar_foto(pool: str, pool_hermano: str | None = None, ahora: datetime | None = None,
               interruptor: dict | None = None, envios: list | None = None) -> Foto:
    """Lee interruptor y envíos (si no se los pasan ya leídos), export vigente y
    pools, y calcula la selección. La selección no depende de la frecuencia: `hoy`
    enseña lo que se mandaría también un día que no toca."""
    from pipeline import db
    ahora = inv.fecha(ahora or datetime.now(timezone.utc))
    fila = (db.invitaciones_interruptor() if interruptor is None else interruptor) or {}
    modo = fila.get("modo") or "apagado"
    tope = inv.tope_de(fila)
    miembros = [inv.miembro_de_fila(f) for f in db.invitaciones_miembros_vigentes()]
    envios = db.invitaciones_envios() if envios is None else envios
    cada_dias = inv.cada_dias_de(fila)
    usuarios = leer_pool(pool)
    contados, aviso = list(usuarios), None
    if pool_hermano:
        # el pool hermano comparte el tope de correo de la cuenta. Si no se puede
        # leer (dev se tiró y se recreó con otro id) se sigue con el propio y se
        # dice en el resumen: es una cuenta de más prudencia, no un requisito.
        try:
            contados += leer_pool(pool_hermano)
        except Exception as e:                      # noqa: BLE001 — se reporta
            aviso = (f"no se pudo leer el pool hermano {pool_hermano} "
                     f"({type(e).__name__}): el cupo se contó solo con este")
            log.warning("invitador: %s", aviso)
    gastado = inv.gastado_hoy(envios, contados, ahora)
    # el bot deja RESERVA_PAGINA libres para la página /acceso (server/acceso.py)
    libre = inv.cupo_bot(tope, gastado)
    todos = inv.candidatos(miembros, usuarios, envios, ahora)
    return Foto(ahora=ahora, modo=modo, tope=tope, nota=fila.get("nota"),
                miembros=miembros, usuarios=usuarios, envios=envios,
                gastado=gastado, cupo=libre, todos=todos, elegidos=todos[:libre],
                aviso_hermano=aviso, cada_dias=cada_dias,
                toca=inv.toca_correr(cada_dias, envios, inv.siguiente_salida(ahora)))


# ---------------------------------------------------------------------------
# la corrida

@dataclass
class Corrida:
    modo: str
    enviados: list = field(default_factory=list)       # [Elegido]
    ensayo: list = field(default_factory=list)         # [Elegido]
    fuera_de_lista: list = field(default_factory=list) # [Elegido] (no prod)
    ya_mandados: list = field(default_factory=list)    # [Elegido] chocaron con el índice
    saltados: list = field(default_factory=list)       # [(Elegido, código)]
    fallos: list = field(default_factory=list)         # [(Elegido, código)]
    a_revisar: list = field(default_factory=list)      # [(Elegido, código)] dirección rechazada
    a_medias: list = field(default_factory=list)       # [(Elegido, código, cortesía)]
    cupo_agotado: list = field(default_factory=list)   # [Elegido] la página gastó en plena corrida
    abortado: str | None = None
    # Las filas de esta corrida que no terminaron en 'fallo:*' bien marcado: lo mismo
    # que `inv.toca_correr` va a contar como corrida (una en 'enviando' también).
    filas_vivas: int = 0


def _existe(pool: str, correo: str) -> bool:
    from tools import usuarios
    try:
        usuarios._cognito(pool).admin_get_user(UserPoolId=pool, Username=correo)
        return True
    except Exception:                               # noqa: BLE001 — no existe o no se sabe
        return False


def _cortesia(pool: str, e: inv.Elegido) -> str:
    """Tras un alta a medias, ¿entró la cortesía? `alta()` la abona ANTES de los
    slots del anual, y el Data API puede perder la respuesta de un abono que sí
    se confirmó: decirle al dueño «abónala» sin mirar la abonaría dos veces."""
    from pipeline import db
    from tools import usuarios
    plan = e.plan or "anual"
    try:
        sub = usuarios._sub(usuarios._cognito(pool).admin_get_user(UserPoolId=pool,
                                                                   Username=e.correo))
        entro = db.invitaciones_cortesia_abonada(sub, plan)
    except Exception as err:                        # noqa: BLE001 — se dice tal cual
        return (f"no se pudo comprobar la cortesía ({usuarios._codigo(err)}): PUEDE que SÍ "
                f"haya entrado; revisa monedero_movimientos (referencia alta-{plan}) antes "
                "de abonar")
    slots = (f"; falta fijar los slots del anual (tools/usuarios.py slots {e.correo} "
             "ilimitado)") if plan == "anual" else ""
    if entro:
        return f"la cortesía SÍ entró, no la abones otra vez{slots}"
    return (f"la cortesía NO entró: abónala a mano ({usuarios.cortesia(plan)} créditos del "
            f"plan {plan}, tools/creditos.py){slots}")


def _anotar_ensayo(e: inv.Elegido, detalle: str) -> None:
    from pipeline import db
    db.invitaciones_anotar(e.correo, e.paso, "bot", "ensayo", detalle)


def _base_caida(err: Exception, donde: str) -> str:
    from tools import usuarios
    return f"la base falló ({usuarios._codigo(err)}) {donde}"


def mandar(foto: Foto, pool: str, *, prod: bool, permitidos: str = "",
           pausa: float = PAUSA_S, r: Corrida | None = None) -> Corrida:
    """Recorre los elegidos de la foto según el modo. No publica nada.

    `r` se puede pasar ya creada: si algo inesperado truena a media corrida,
    quien llama conserva lo que alcanzó a pasar para el resumen."""
    from pipeline import db
    from tools import usuarios

    r = r if r is not None else Corrida(modo=foto.modo)
    if foto.modo == "ensayo":
        for e in foto.elegidos:
            _anotar_ensayo(e, e.motivo)
            r.ensayo.append(e)
        return r
    if foto.modo != "activo":
        # solo 'activo' toca Cognito: cualquier otro valor no manda nada
        return r

    corte = inv.corte_del_dia(foto.ahora).isoformat()
    # la misma reserva de la foto: lo que la página gaste en plena corrida no se
    # lo come el bot, ni con eso se pasa del total del día
    limite = foto.tope - inv.RESERVA_PAGINA
    racha: list[str] = []                           # los fallos seguidos, por tipo
    for i, e in enumerate(foto.elegidos):
        donde = f"en la {i + 1} de {len(foto.elegidos)}"
        try:
            if not prod and not inv.permitido(e.correo, permitidos):
                _anotar_ensayo(e, "fuera de la lista blanca · " + e.motivo)
                r.fuera_de_lista.append(e)
                continue
            id_, sin_reclamo = db.invitaciones_reclamar(
                e.correo, e.paso, e.motivo, corte=corte, tope=limite,
                desde=foto.ahora.isoformat())
        except Exception as err:                    # noqa: BLE001 — se corta y se reporta
            r.abortado = _base_caida(err, f"antes de mandar a {e.correo} ({donde}); "
                                          "a esa persona no se le mandó nada")
            break
        if sin_reclamo == "sin_cupo":
            r.cupo_agotado = list(foto.elegidos[i:])
            break
        if sin_reclamo == "contacto_reciente":
            r.saltados.append((e, "acaba de recibir otro correo"))
            continue
        if id_ is None:
            r.ya_mandados.append(e)
            continue
        r.filas_vivas += 1
        codigo, a_revisar = None, False
        try:
            if e.paso == 0:
                usuarios.alta(pool, e.correo, e.plan or "anual")
            else:
                # solo el RESEND: nada después de él puede convertir en «fallo» un
                # correo que ya salió (y que mañana se volvería a mandar)
                usuarios.reenviar_provisional(pool, e.correo)
        except Exception as err:                    # noqa: BLE001 — se clasifica abajo
            codigo = usuarios._codigo(err)
            # ¿Cognito sí creó la cuenta (y mandó el correo) y lo que falló fue la
            # base? Antes de llamar no existía: la selección pide «sin cuenta».
            creada = (e.paso == 0 and codigo != "UsernameExistsException"
                      and codigo not in usuarios.CODIGOS_DE_TOPE
                      and _existe(pool, e.correo))
            if creada:
                cortesia = _cortesia(pool, e)
                resultado, detalle = "enviado", f"alta a medias: {codigo} · {cortesia}"
                r.a_medias.append((e, codigo, cortesia))
                racha.append("a medias")
            elif codigo in SALTAR_SIN_CONTAR:
                resultado, detalle = f"fallo:{codigo}", str(err)[:300]
                r.saltados.append((e, codigo))
            else:
                resultado, detalle = f"fallo:{codigo}", str(err)[:300]
                log.error("invitador: %s (%s) falló: %s", e.correo,
                          inv.NOMBRE_PASO[e.paso], codigo)
                if e.paso == 0 and codigo in DIRECCION_INVALIDA:
                    r.a_revisar.append((e, codigo))
                    a_revisar = True
                    racha.append("dirección")
                else:
                    r.fallos.append((e, codigo))
                    racha.append("fallo")
        else:
            resultado, detalle = "enviado", None
            r.enviados.append(e)
            racha = []
        marcado = False
        try:
            db.invitaciones_marcar(id_, resultado, detalle)
            marcado = True
            if resultado != "enviado":
                r.filas_vivas -= 1
            if a_revisar:
                db.invitaciones_fijar_estado(e.correo, "revisar")
        except Exception as err:                    # noqa: BLE001 — se corta y se reporta
            if marcado:
                r.abortado = _base_caida(err, f"al pasar {e.correo} a 'revisar' ({donde}); "
                                              "mañana se vuelve a proponer")
            else:
                salio = " (el correo SÍ salió)" if resultado == "enviado" else ""
                r.abortado = _base_caida(err, f"al anotar a {e.correo} ({donde}); su fila "
                                              f"quedó en 'enviando'{salio}")
            break
        if codigo in usuarios.CODIGOS_DE_TOPE:
            r.abortado = f"Cognito ya no manda más correo hoy ({codigo}) {donde}"
            break
        if len(racha) >= FALLOS_SEGUIDOS:
            if all(t == "dirección" for t in racha):
                causa = ("Cognito rechazó esas direcciones (quedaron en 'revisar'); si "
                         "son buenas, el problema es el pool")
            elif all(t == "a medias" for t in racha):
                causa = "Cognito creó las cuentas pero la base falla después: revisa la base"
            else:
                causa = "revisa permisos y pool"
            r.abortado = f"{FALLOS_SEGUIDOS} fallos seguidos {donde}: {causa}"
            break
        if i < len(foto.elegidos) - 1:
            time.sleep(pausa)
    return r


# ---------------------------------------------------------------------------
# el resumen (texto plano a SNS)

def _lineas(titulo: str, elegidos: list) -> list[str]:
    if not elegidos:
        return []
    out = [f"{titulo} ({len(elegidos)}):"]
    for paso in sorted({e.paso for e in elegidos}):
        grupo = [e for e in elegidos if e.paso == paso]
        out.append(f"  {inv.NOMBRE_PASO[paso]} ({len(grupo)}):")
        out += [f"    - {e.nombre or '(sin nombre)'} <{e.correo}>" for e in grupo]
    return out


def paginas_de_hoy(envios: list, ahora: datetime) -> int:
    corte = inv.corte_del_dia(ahora)
    return sum(1 for e in envios if e.get("origen") == "pagina"
               and e.get("resultado") in inv.VIVOS
               and (inv.fecha(e.get("creado")) or corte) >= corte)


def resumen(foto: Foto, r: Corrida, *, entorno: str) -> tuple[str, str]:
    """→ (asunto, cuerpo). El asunto va sin acentos: SNS solo acepta ASCII ahí."""
    usados = len(r.enviados) + len(r.a_medias)
    marca = "ENSAYO " if foto.modo == "ensayo" else ""
    asunto = (f"[{entorno}] Invitador {marca}{foto.ahora:%Y-%m-%d}: "
              f"{usados if foto.modo == 'activo' else len(r.ensayo)} correos, "
              f"cupo {foto.gastado + usados}/{foto.tope}")
    if r.abortado:
        asunto += " - ABORTADO"
    l = [f"Invitador · {entorno} · {foto.ahora:%Y-%m-%d %H:%M} UTC · modo {foto.modo.upper()}"]
    if foto.nota:
        l.append(f"Nota del interruptor: {foto.nota}")
    l.append(f"Cupo: tope {foto.tope}, ya gastado hoy antes de correr {foto.gastado}, "
             f"usado ahora {usados}, libre para el bot {max(0, foto.cupo - usados)} "
             f"(deja {inv.RESERVA_PAGINA} para la página /acceso).")
    if foto.cada_dias > 1:
        # los días sin corrida no llega nada: que el silencio no parezca una caída.
        # La foto es de antes de mandar; si esta corrida dejó filas vivas, cuenta desde
        # hoy. No basta con `usados`: una fila en 'enviando' también frena el plazo.
        salidas = foto.envios + ([{"origen": "bot", "resultado": "enviado", "creado": foto.ahora}]
                                 if r.filas_vivas else [])
        proxima = inv.proxima_corrida(foto.cada_dias, salidas, foto.ahora)
        l.append(f"Frecuencia: {inv.nombre_frecuencia(foto.cada_dias)}. Próxima corrida "
                 f"estimada: {proxima:%Y-%m-%d}; hasta entonces no llega resumen.")
    pagina = paginas_de_hoy(foto.envios, foto.ahora)
    if pagina:
        l.append(f"Página /acceso: {pagina} correos pedidos hoy por la propia gente (ya "
                 "cuentan en lo gastado; no avanzan la serie).")
    if r.cupo_agotado:
        l.append(f"Se acabó el cupo a media corrida (la página o un envío a mano gastaron "
                 f"mientras el bot corría): {len(r.cupo_agotado)} se quedan para otro día.")
    if foto.aviso_hermano:
        l.append(f"OJO: {foto.aviso_hermano}.")
    if r.abortado:
        l.append(f"ABORTADO: {r.abortado}.")
    if (r.abortado or r.cupo_agotado) and foto.cada_dias > 1 and r.filas_vivas:
        l.append("Esta corrida cuenta aunque no terminó: quienes faltaban esperan el plazo. "
                 f'Para reintentar antes: tools/invitaciones.py modo {foto.modo} --cada 1 --nota '
                 f'"reintento" y, tras esa corrida, de vuelta a --cada {foto.cada_dias}.')
    l.append("")
    if foto.modo == "ensayo":
        l.append("ENSAYO: no se llamó a Cognito. Esto es lo que se habría mandado:")
        l += _lineas("Se habría mandado", r.ensayo)
    l += _lineas("Enviados", r.enviados)
    l += _lineas("Fuera de la lista blanca (no prod, anotados como ensayo)", r.fuera_de_lista)
    if r.a_medias:
        l.append(f"Altas a medias ({len(r.a_medias)}): Cognito creó la cuenta y mandó el "
                 "correo, pero la base falló después. Lo que se sabe de cada cortesía:")
        l += [f"    - {e.correo} ({c}): {cortesia}" for e, c, cortesia in r.a_medias]
    if r.fallos:
        l.append(f"Fallos ({len(r.fallos)}):")
        l += [f"    - {e.correo} ({inv.NOMBRE_PASO[e.paso]}): {c}" for e, c in r.fallos]
    if r.a_revisar:
        l.append(f"Cognito rechazó la dirección; pasaron a 'revisar' y el bot ya no las "
                 f"propone (corrígela en Skool, o aprobar/excluir) ({len(r.a_revisar)}):")
        l += [f"    - {e.correo}: {c}" for e, c in r.a_revisar]
    if r.saltados:
        l.append(f"Saltados sin contar ({len(r.saltados)}):")
        l += [f"    - {e.correo} ({inv.NOMBRE_PASO[e.paso]}): {c}" for e, c in r.saltados]
    if r.ya_mandados:
        l.append(f"Ya tenían ese paso anotado, no se repitió ({len(r.ya_mandados)}):")
        l += [f"    - {e.correo} ({inv.NOMBRE_PASO[e.paso]})" for e in r.ya_mandados]
    pendientes = foto.todos[len(foto.elegidos):]
    if pendientes:
        por_paso = {}
        for e in pendientes:
            por_paso[inv.NOMBRE_PASO[e.paso]] = por_paso.get(inv.NOMBRE_PASO[e.paso], 0) + 1
        l.append("Esperan cupo para otro día: "
                 + ", ".join(f"{n} {p}" for p, n in por_paso.items()) + "."
                 + inv.frase_de_atraso(pendientes))
    if not foto.miembros:
        l.append("OJO: no hay export de Skool cargado (tools/invitaciones.py cargar): "
                 "sin export no se invita ni se recuerda a nadie.")
    sin_plan = [m for m in foto.miembros if m.estado == "ok" and not m.plan
                and m.correo not in {u["correo"] for u in foto.usuarios}]
    if sin_plan:
        l.append(f"Sin plan reconocible, no se invitan ({len(sin_plan)}): "
                 + ", ".join(f"{m.correo} (precio {m.precio!r})" for m in sin_plan))
    revisar = [m for m in foto.miembros if m.estado == "revisar"]
    if revisar:
        l.append(f"Esperan tu revisión (tools/invitaciones.py aprobar/excluir) ({len(revisar)}): "
                 + ", ".join(m.correo for m in revisar))
    bajas = inv.bajas(foto.miembros, foto.usuarios)
    if bajas:
        l.append(f"Bajas detectadas: nunca entraron y ya no están en el export ({len(bajas)}). "
                 "No se les escribe:")
        l += [f"    - {c}" for c in bajas]
    atorados = inv.atorados(foto.envios, foto.ahora)
    if atorados:
        con_cuenta = {u["correo"] for u in foto.usuarios}
        l.append(f"Atorados en 'enviando' (la corrida murió a media llamada; no se "
                 f"reintentan) ({len(atorados)}):")
        for a in atorados:
            paso = int(a["paso"])
            linea = f"    - {a['correo']} ({inv.NOMBRE_PASO.get(paso, paso)})"
            if paso == 0 and a["correo"] in con_cuenta:
                # Cognito sí la creó: lo que pudo quedar a medias es la base
                linea += (" — TIENE cuenta: verifica su fila en usuarios y la cortesía "
                          "(monedero_movimientos, referencia alta-<plan>) antes de abonar")
            l.append(linea)
    if inv.lleva_semanal(foto.cada_dias, foto.ahora):
        frios = inv.frios(foto.usuarios, foto.envios, foto.ahora)
        titulo = "Lunes: fríos" if foto.ahora.weekday() == 0 else "Fríos"
        l.append("")
        l.append(f"{titulo} — recibieron R3 hace {inv.DIAS_FRIO}+ días y siguen sin "
                 f"entrar ({len(frios)}). Ya no se les escribe:")
        # la fecha es la del último correo: pudo ser uno que pidió en /acceso
        l += [f"    - {c} (último correo el {f:%Y-%m-%d})" if f else f"    - {c}" for c, f in frios]
    return asunto[:99], "\n".join(l)


def publicar(asunto: str, cuerpo: str) -> None:
    topico = os.getenv("INVITADOR_TOPICO")
    if not topico:
        log.warning("invitador: sin INVITADOR_TOPICO, el resumen solo queda en el log")
        return
    import boto3
    boto3.client("sns").publish(TopicArn=topico, Subject=asunto, Message=cuerpo)


def _publicar_sin_romper(asunto: str, cuerpo: str) -> None:
    log.info("invitador: %s\n%s", asunto, cuerpo)
    try:
        publicar(asunto, cuerpo)
    except Exception as e:                          # noqa: BLE001 — lo enviado ya salió
        log.error("invitador: no se pudo publicar el resumen: %s: %s", type(e).__name__, e)


def _limpiar_solicitudes(ahora: datetime | None) -> None:
    """Los hashes de IP de días pasados se van aunque la página no reciba más
    solicitudes. Va antes de mirar el modo y la frecuencia: con el bot apagado o en
    un día sin corrida la página sigue viva, y la retención depende de esto."""
    from pipeline import db
    try:
        corte = inv.corte_del_dia(inv.fecha(ahora or datetime.now(timezone.utc)))
        db.invitaciones_limpiar_solicitudes(corte.isoformat())
    except Exception as e:                          # noqa: BLE001 — no frena la corrida
        log.warning("invitador: no se pudieron limpiar las solicitudes: %s", type(e).__name__)


def correr(ahora: datetime | None = None) -> dict:
    from pipeline import db
    ahora = inv.fecha(ahora or datetime.now(timezone.utc))
    _limpiar_solicitudes(ahora)
    fila = db.invitaciones_interruptor() or {}
    if (fila.get("modo") or "apagado") == "apagado":
        log.info("invitador: apagado")
        return {"modo": "apagado"}
    pool = os.environ["COGNITO_POOL_ID"]
    prod = es_prod()
    entorno = "prod" if prod else "dev"
    cada_dias = inv.cada_dias_de(fila)
    try:
        envios = db.invitaciones_envios()
        if not inv.toca_correr(cada_dias, envios, ahora):
            proxima = inv.proxima_corrida(cada_dias, envios, ahora)
            log.info("invitador: modo %s, hoy no toca (%s); próxima corrida estimada %s",
                     fila.get("modo"), inv.nombre_frecuencia(cada_dias), f"{proxima:%Y-%m-%d}")
            return {"modo": fila.get("modo"), "toca": False, "cada_dias": cada_dias,
                    "proxima": f"{proxima:%Y-%m-%d}"}
        # la MISMA fila del interruptor: releerla abriría una ventana en la que
        # un «apagado» del dueño llegaría a medias
        foto = tomar_foto(pool, os.getenv("INVITADOR_POOL_HERMANO") or None, ahora,
                          interruptor=fila, envios=envios)
    except Exception as e:                          # noqa: BLE001 — se dice y se relanza
        _publicar_sin_romper(f"[{entorno}] Invitador - ABORTADO antes de empezar",
                             f"Invitador · {entorno} · modo {fila.get('modo')}: no se pudo "
                             f"leer la base o el pool ({type(e).__name__}: {e}). No se "
                             "mandó nada.")
        raise
    # La corrida se crea aquí: si `mandar` truena por algo que no esperaba, el
    # resumen sale igual con lo que alcanzó a pasar (los correos que ya salieron
    # NO se pueden quedar sin contar) y luego la excepción sigue su camino.
    r = Corrida(modo=foto.modo)
    error = None
    try:
        mandar(foto, pool, prod=prod, permitidos=os.getenv("INVITADOR_PERMITIDOS", ""), r=r)
    except Exception as e:                          # noqa: BLE001 — se reporta y se relanza
        error = e
        r.abortado = r.abortado or f"error inesperado: {type(e).__name__}: {e}"[:300]
        log.exception("invitador: la corrida tronó a la mitad")
    asunto, cuerpo = resumen(foto, r, entorno=entorno)
    _publicar_sin_romper(asunto, cuerpo)
    if error is not None:
        raise error
    return {"modo": foto.modo, "enviados": len(r.enviados), "ensayo": len(r.ensayo),
            "fuera_de_lista": len(r.fuera_de_lista), "fallos": len(r.fallos),
            "a_medias": len(r.a_medias), "cupo_agotado": len(r.cupo_agotado),
            "abortado": r.abortado,
            "gastado_antes": foto.gastado, "tope": foto.tope}


def handler(event, context):  # noqa: ANN001 — firma de Lambda
    # force=True: el runtime de Lambda ya instala un handler en el root logger
    # y sin esto basicConfig es no-op (mismo idiom que worker/lambda_worker.py)
    logging.basicConfig(level=logging.INFO, force=True)
    return correr()
