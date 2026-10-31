"""Fase 2 — el invitador: a quién se le escribe hoy, y con qué paso.

Lógica PURA. No habla con Cognito ni con la base: recibe listas ya leídas y
devuelve listas. Quien lee y quien manda son `worker/invitador.py` (la Lambda
de cada mañana) y `tools/invitaciones.py` (el dueño, desde su máquina), y los
dos llaman a lo MISMO: `hoy` de la herramienta enseña exactamente la selección
que haría el bot, porque es la misma función.

LAS REGLAS DEL DUEÑO (22-oct-2026)

  * Tope de 40 correos al día EN TOTAL. Cognito manda con COGNITO_DEFAULT y su
    límite es de 50 al día por CUENTA (prod y dev lo comparten, se reinicia a
    las 09:00 UTC). Los 10 de margen son para lo que el dueño mande a mano.
  * De esos 40, el bot deja 5 libres para la página /acceso (server/acceso.py),
    que sí puede llegar hasta el tope: RESERVA_PAGINA.
  * Las INVITACIONES de miembros nuevos van SIEMPRE primero; el resto del cupo
    es para recordatorios.
  * La serie: R1 al día 3, R2 al día 7 y R3 al día 14 desde la invitación. Después
    se deja de escribir: quien no entró con cuatro correos está «frío» y se le
    enseña al dueño en el resumen semanal, no se le escribe un quinto.
  * La frecuencia (31-oct-2026): el dueño decide cada cuántos días corre el bot
    (`cada_dias` del interruptor, de 1 a 14) y la cambia sin deploy. El reloj sigue
    diario; lo que se salta es la corrida (`toca_correr`). La serie sigue contando
    desde la invitación: cada paso sale en la primera corrida que lo cumpla y en la
    que quepa. Con corridas fijas cada 3 días, 3/7/14 se vuelve 3/9/18 solo si todo
    cabe en el cupo; con más cola, las invitaciones van primero y los recordatorios
    se atrasan mucho más, o no salen (la tabla está en docs/OPERACION.md).
  * Los reenvíos que el dueño ya mandó a mano (tools/reenvio1-5.txt) cuentan como
    R1 (los anota `tools/invitaciones.py historial`).
  * En Skool, precio 0 o vacío = plan anual (la categoría «FAI»).
  * Solo se le escribe a quien sigue en el export MÁS RECIENTE de Skool. Quien ya
    no aparece se dio de baja: no se le recuerda nada.

Un recordatorio no es otra plantilla: con COGNITO_DEFAULT el trigger «Custom
message» no puede cambiar el texto (Cognito rechaza el AdminCreateUser entero),
así que todos los pasos salen con la plantilla de invitación del pool. Un
recordatorio es un `admin_create_user(MessageAction="RESEND")`: clave
provisional NUEVA, válida 7 días, que reemplaza a la anterior.
"""
from __future__ import annotations

import csv
import io
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

TOPE_DEFECTO = 40
# El límite de Cognito con COGNITO_DEFAULT. Un tope por encima no es un tope: es
# crear usuarios que no reciben su clave (ver CODIGOS_DE_TOPE en tools/usuarios.py).
TOPE_MAXIMO = 50
# Lo que el bot le deja libre a la página /acceso: quien lleva días sin poder
# entrar no puede encontrarse «hoy ya no hay correos» porque el bot se los comió
# todos a las 10:00. El tope sigue siendo el total del día; la página llega hasta él.
RESERVA_PAGINA = 5
# Entre dos correos a la misma persona: un RESEND invalida la clave anterior, y
# quien pidió otra mientras la primera venía en camino se queda con una que ya no sirve.
HORAS_ENTRE_CORREOS_PAGINA = 24
# El cupo de Cognito se reinicia a las 09:00 UTC (03:00 hora centro).
HORA_CORTE_UTC = 9
# El reloj de EventBridge (infra/stacks/api.py). Aquí solo sirve para estimar la
# próxima corrida: quien la despierta es la regla.
HORA_CORRIDA_UTC = 16
# Cada cuántos días corre el bot. El tope de 14 es el mismo CHECK de la columna.
CADA_DIAS_DEFECTO = 1
CADA_DIAS_MAXIMO = 14

ULTIMO_PASO = 3
# Paso n (1..3): mínimo de días desde la invitación y desde el último correo.
# Las separaciones salen de la serie 3/7/14: 3-0, 7-3 y 14-7. Son días de
# Cognito enteros (ver `_dias`), no múltiplos de 24 horas.
DIAS_DESDE_INVITACION = {1: 3, 2: 7, 3: 14}
DIAS_DESDE_ULTIMO = {1: 3, 2: 4, 3: 7}
# Quien terminó R3 hace una semana y sigue sin entrar.
DIAS_FRIO = 7

# Lo que cuenta como «ya se mandó» (o pudo haberse mandado: un 'enviando' que se
# quedó así es una Lambda que murió a media llamada, y ante la duda se cuenta).
# 'ensayo' y 'fallo:*' no cuentan para nada.
VIVOS = ("enviando", "enviado")
MODOS = ("apagado", "ensayo", "activo")
ESTADOS = ("ok", "revisar", "excluido")

# Orden dentro de cada grupo: anual pagado → mensual → anual a $0 (FAI).
CATEGORIAS = ("anual", "mensual", "fai")
_RANGO = {c: i for i, c in enumerate(CATEGORIAS)}
NOMBRE_PASO = {0: "invitación", 1: "R1", 2: "R2", 3: "R3"}


# ---------------------------------------------------------------------------
# el plan, desde lo que dice Skool

def _monto(precio) -> float | None:
    """«$25» → 25.0, «0» y «» → 0.0, basura → None."""
    texto = str(precio if precio is not None else "").strip().replace("$", "").replace(",", "")
    if not texto:
        return 0.0
    try:
        return float(texto)
    except ValueError:
        return None


def categoria_de(precio, intervalo) -> str | None:
    """→ 'anual' (pagado), 'mensual', 'fai' (anual a $0) o None (no se sabe).

    Manda el intervalo; sin intervalo, precio 0 o vacío es anual a $0 (regla
    del dueño del 22-oct: «los que son 0, son los anuales»). Un precio sin
    intervalo, o que no se lee como número, NO se adivina: queda fuera y se
    reporta, porque invitar con el plan equivocado regala o niega créditos."""
    monto = _monto(precio)
    if monto is None:
        return None
    intervalo = str(intervalo or "").strip().lower()
    if intervalo == "month":
        return "mensual"
    if intervalo == "year":
        return "anual" if monto > 0 else "fai"
    if not intervalo and monto == 0:
        return "fai"
    return None


def plan_de(precio, intervalo) -> str | None:
    """El plan de tools/tarifas.json (cortesia_mensual): 'anual' o 'mensual'."""
    cat = categoria_de(precio, intervalo)
    return None if cat is None else ("mensual" if cat == "mensual" else "anual")


# ---------------------------------------------------------------------------
# el export de Skool (CSV; no hay API)

@dataclass
class Miembro:
    correo: str
    nombre: str = ""
    plan: str | None = None
    categoria: str | None = None
    precio: str = ""
    ingreso: datetime | None = None
    estado: str = "ok"
    fila: int = 0


@dataclass
class Export:
    miembros: list[Miembro] = field(default_factory=list)
    sin_correo: list[tuple[int, str]] = field(default_factory=list)   # (fila, nombre)
    duplicados: list[tuple[int, str]] = field(default_factory=list)   # (fila, correo)
    # el mismo correo repetido con OTRA categoría (se dio de baja y volvió con
    # otro plan): (fila, correo, «precio intervalo» de la primera, de esta)
    conflictos: list[tuple[int, str, str, str]] = field(default_factory=list)
    filas: int = 0


def normalizar_correo(correo) -> str:
    return str(correo or "").strip().strip("<>").lower()


def fecha(valor) -> datetime | None:
    """Un instante en UTC desde lo que venga: datetime (con o sin zona), el
    `::text` de Postgres («2026-10-22 19:22:35.123+00»), ISO, o «» → None. Una
    fecha sin zona se toma como UTC."""
    if valor is None or valor == "":
        return None
    if isinstance(valor, datetime):
        d = valor
    else:
        texto = str(valor).strip().replace("T", " ")
        texto = re.sub(r"([+-]\d\d)$", r"\1:00", texto)        # «+00» de Postgres
        # Postgres recorta los ceros de los microsegundos («35.1234») y
        # fromisoformat de Python 3.10 solo acepta 3 o 6 cifras
        texto = re.sub(r"(\d\d:\d\d:\d\d)\.(\d{1,6})",
                       lambda m: f"{m.group(1)}.{m.group(2).ljust(6, '0')}", texto)
        try:
            d = datetime.fromisoformat(texto)
        except ValueError:
            return None
    return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d.astimezone(timezone.utc)


def miembro_de_fila(f: dict) -> Miembro:
    """Una fila de `invitaciones_miembros` → Miembro."""
    return Miembro(correo=normalizar_correo(f.get("correo")), nombre=f.get("nombre") or "",
                   plan=f.get("plan") or None, categoria=f.get("categoria") or None,
                   precio=f.get("precio") or "", ingreso=fecha(f.get("ingreso")),
                   estado=f.get("estado") or "ok")


def _texto_export(ruta_o_texto) -> str:
    if isinstance(ruta_o_texto, Path) or (
            isinstance(ruta_o_texto, str) and "\n" not in ruta_o_texto
            and Path(ruta_o_texto).is_file()):
        # utf-8-sig: el export que se abrió y guardó en Excel trae BOM, y sin
        # quitarlo la primera columna se llama «\ufeffFirstName»
        return Path(ruta_o_texto).read_bytes().decode("utf-8-sig")
    return str(ruta_o_texto).lstrip("\ufeff")


def leer_export(ruta_o_texto) -> Export:
    """El CSV de Skool → miembros normalizados, y aparte lo que no sirve.

    Columnas: FirstName, LastName, Email, Invited By, JoinedDate,
    Question1..Answer3, Price, Recurring Interval, Tier, LTV. Puede traer filas
    sin Email y el mismo correo dos veces: el primero gana y los demás van a
    `duplicados`. Si la repetida trae OTRA categoría, además va a `conflictos`:
    el orden de las filas no puede decidir si la cortesía es de 100 o de 200, y
    `cargar` la deja en 'revisar'. El plan puede salir None (precio raro): el
    miembro se conserva para que el reporte lo enseñe, pero no se le invita."""
    lector = csv.DictReader(io.StringIO(_texto_export(ruta_o_texto)))
    out = Export()
    vistos: dict[str, tuple[Miembro, str]] = {}     # correo → (miembro, «precio intervalo»)
    for n, fila in enumerate(lector, 2):        # la 1 es el encabezado
        # una fila con columnas de más deja la cola en una LISTA bajo la llave None
        fila = {str(k or "").strip(): (v if isinstance(v, str) else ",".join(v or [])).strip()
                for k, v in fila.items()}
        out.filas += 1
        nombre = " ".join(p for p in (fila.get("FirstName", ""), fila.get("LastName", "")) if p)
        correo = normalizar_correo(fila.get("Email"))
        if not correo:
            out.sin_correo.append((n, nombre))
            continue
        precio, intervalo = fila.get("Price", ""), fila.get("Recurring Interval", "")
        cobro = f"{precio or '(vacío)'} {intervalo or '(sin intervalo)'}"
        if correo in vistos:
            out.duplicados.append((n, correo))
            primero, cobro_primero = vistos[correo]
            if categoria_de(precio, intervalo) != primero.categoria:
                out.conflictos.append((n, correo, cobro_primero, cobro))
            continue
        m = Miembro(correo=correo, nombre=nombre, plan=plan_de(precio, intervalo),
                    categoria=categoria_de(precio, intervalo), precio=precio,
                    ingreso=fecha(fila.get("JoinedDate")), fila=n)
        vistos[correo] = (m, cobro)
        out.miembros.append(m)
    return out


# ---------------------------------------------------------------------------
# el cupo del día

def corte_del_dia(ahora: datetime) -> datetime:
    """El último reinicio del cupo de Cognito (las 09:00 UTC) antes de `ahora`."""
    ahora = fecha(ahora)
    corte = ahora.replace(hour=HORA_CORTE_UTC, minute=0, second=0, microsecond=0)
    return corte if ahora >= corte else corte - timedelta(days=1)


def cupo(tope: int, gastado: int) -> int:
    return max(0, int(tope) - int(gastado))


def cupo_bot(tope: int, gastado: int) -> int:
    """Lo que le queda al bot hoy: el tope menos lo gastado y menos la reserva."""
    return cupo(tope, int(gastado) + RESERVA_PAGINA)


def tope_de(fila: dict | None) -> int:
    """El tope del interruptor, entre 0 y TOPE_MAXIMO. None (sin fila) es el
    default; 0 es «hoy no sale nada» y vale 0."""
    tope = (fila or {}).get("tope")
    tope = TOPE_DEFECTO if tope is None else int(tope)
    return max(0, min(tope, TOPE_MAXIMO))


def gastado_hoy(envios: list[dict], usuarios_contados: list[dict], ahora: datetime) -> int:
    """Cuántos correos salieron hoy, contado de las dos formas y gana la mayor.

      * la tabla: filas 'enviado'/'enviando' de hoy, de cualquier origen (lo
        que mandó el bot, lo que el dueño mandó con usuarios.py y el historial);
      * los pools (el propio y el hermano, que comparte el tope de la cuenta):
        cuentas en FORCE_CHANGE_PASSWORD tocadas hoy. Ahí sale lo que se mandó
        sin dejar fila — una prueba en dev, un reenvío desde otra máquina.

    Ninguna de las dos es exacta (quien entró hoy ya no está en
    FORCE_CHANGE_PASSWORD; un correo de «olvidé mi contraseña» no deja rastro),
    así que no se suman: se toma la mayor. Pasarse del tope crea usuarios sin
    clave; quedarse corto deja un recordatorio para mañana."""
    corte = corte_del_dia(ahora)
    tabla = sum(1 for e in envios
                if e.get("resultado") in VIVOS and (fecha(e.get("creado")) or corte) >= corte)
    pools = sum(1 for u in usuarios_contados
                if u.get("estado") == "FORCE_CHANGE_PASSWORD"
                and (fecha(u.get("modificado")) or corte - timedelta(seconds=1)) >= corte)
    return max(tabla, pools)


# ---------------------------------------------------------------------------
# los usuarios del pool

def usuario_de_cognito(u: dict) -> dict:
    """Una entrada de `list_users` o de `admin_get_user` (que llama distinto a
    sus atributos) → lo único que se usa de ella."""
    attrs = {a["Name"]: a["Value"]
             for a in u.get("Attributes") or u.get("UserAttributes") or []}
    return {
        "correo": normalizar_correo(attrs.get("email") or u.get("Username")),
        "estado": u.get("UserStatus"),
        "habilitado": bool(u.get("Enabled", True)),
        "creado": fecha(u.get("UserCreateDate")),
        "modificado": fecha(u.get("UserLastModifiedDate")),
    }


def pasos_por_correo(envios: list[dict]) -> dict[str, tuple[int, datetime | None]]:
    """correo → (paso más alto mandado, fecha del último correo mandado)."""
    out: dict[str, tuple[int, datetime | None]] = {}
    for e in envios:
        if e.get("resultado") not in VIVOS:
            continue
        correo = normalizar_correo(e.get("correo"))
        paso, cuando = int(e.get("paso") or 0), fecha(e.get("creado"))
        previo_paso, previo_cuando = out.get(correo, (-1, None))
        ultimo = max((c for c in (previo_cuando, cuando) if c is not None), default=None)
        out[correo] = (max(previo_paso, paso), ultimo)
    return out


def _clave_orden(m: Miembro | None) -> tuple:
    """Anual pagado → mensual → FAI; dentro, quien entró a Skool más reciente
    primero (sin fecha, al final de su grupo)."""
    if m is None:
        return (len(CATEGORIAS), 1, 0.0)
    ingreso = m.ingreso.timestamp() if m.ingreso else None
    return (_RANGO.get(m.categoria, len(CATEGORIAS)),
            1 if ingreso is None else 0, -(ingreso or 0.0))


# ---------------------------------------------------------------------------
# la selección

@dataclass(frozen=True)
class Elegido:
    correo: str
    paso: int                 # 0 = invitación, 1..3 = recordatorio
    plan: str | None
    nombre: str
    motivo: str
    atraso: int = 0           # días de Cognito que lleva vencido (solo recordatorios)


def _dias(desde: datetime | None, hasta: datetime) -> float:
    """Días de Cognito (de corte a corte de las 09:00 UTC) entre dos instantes;
    sin fecha de origen, infinitos (nunca frena).

    Días ENTEROS y no horas: el bot invita a las 16:00:0x y el reloj del día 3
    puede dispararse a las 16:00:00 — con horas exactas faltarían segundos para
    los 3 días y cada paso se correría un día (3/7/14 acabaría en 4/8/15). Igual
    con la última modificación de Cognito, que siempre queda unos segundos
    después de la fila. «Al día 3» es el tercer día de Cognito, a cualquier hora."""
    if desde is None:
        return float("inf")
    return float((corte_del_dia(hasta) - corte_del_dia(desde)).days)


def _entero(dias: float) -> str:
    return "?" if dias == float("inf") else str(int(dias))


def candidatos(miembros: list[Miembro], usuarios: list[dict], envios: list[dict],
               ahora: datetime) -> list[Elegido]:
    """TODOS los que tocan hoy, en orden. `elegir_del_dia` corta por el cupo.

    `miembros`: el export vigente (con su `estado`). `usuarios`: el pool de ESTE
    entorno (`usuario_de_cognito`). `envios`: las filas de invitaciones_envios."""
    ahora = fecha(ahora)
    por_correo = {m.correo: m for m in miembros}
    cuentas = {u["correo"]: u for u in usuarios}
    pasos = pasos_por_correo(envios)

    # a) invitaciones: miembros sin cuenta. Un 'enviando' de paso 0 sin cuenta es
    #    una Lambda que murió entre la fila y Cognito: el índice único lo
    #    bloquea igual, así que ni se propone (sale en el resumen como atorado).
    invitar = [m for m in miembros
               if m.estado == "ok" and m.plan and m.correo not in cuentas
               and m.correo not in pasos]
    invitar.sort(key=_clave_orden)
    out = [Elegido(m.correo, 0, m.plan, m.nombre,
                   f"invitación · {m.categoria}"
                   + (f" · entró a Skool el {m.ingreso:%Y-%m-%d}" if m.ingreso else ""))
           for m in invitar]

    # b) recordatorios: cuentas que nunca entraron y siguen en el export
    recordar: list[tuple[int, tuple, Elegido]] = []
    for u in usuarios:
        m = por_correo.get(u["correo"])
        if (u.get("estado") != "FORCE_CHANGE_PASSWORD" or not u.get("habilitado")
                or m is None or m.estado != "ok"):
            continue
        paso_previo, ultimo_envio = pasos.get(u["correo"], (0, None))
        siguiente = paso_previo + 1
        if siguiente > ULTIMO_PASO:
            continue
        ultimo = max((c for c in (ultimo_envio, u.get("modificado")) if c is not None),
                     default=None)
        desde_inv, desde_ult = _dias(u.get("creado"), ahora), _dias(ultimo, ahora)
        if (desde_inv < DIAS_DESDE_INVITACION[siguiente]
                or desde_ult < DIAS_DESDE_ULTIMO[siguiente]):
            continue
        motivo = (f"{NOMBRE_PASO[siguiente]} · {_entero(desde_inv)} días desde la "
                  f"invitación, {_entero(desde_ult)} desde el último correo")
        # le tocó el día en que se cumplió la última de las dos condiciones
        atraso = min(desde_inv - DIAS_DESDE_INVITACION[siguiente],
                     desde_ult - DIAS_DESDE_ULTIMO[siguiente])
        recordar.append((siguiente, _clave_orden(m),
                         Elegido(u["correo"], siguiente, m.plan, m.nombre, motivo,
                                 0 if atraso == float("inf") else int(atraso))))
    recordar.sort(key=lambda t: (t[0], t[1]))
    return out + [e for _, _, e in recordar]


def elegir_del_dia(miembros: list[Miembro], usuarios: list[dict], envios: list[dict],
                   ahora: datetime, cupo_libre: int) -> list[Elegido]:
    """Invitaciones primero, luego R1 > R2 > R3; se corta en el cupo."""
    return candidatos(miembros, usuarios, envios, ahora)[:max(0, int(cupo_libre))]


def frase_de_atraso(pendientes: list[Elegido]) -> str:
    """Con cola, los recordatorios esperan detrás de las invitaciones y un conteo no
    dice cuánto llevan esperando. "" si ninguno se pasó de su fecha."""
    atraso = max((e.atraso for e in pendientes), default=0)
    if not atraso:
        return ""
    return (f" El recordatorio más atrasado lleva {atraso} "
            f"{'día' if atraso == 1 else 'días'} de retraso.")


# ---------------------------------------------------------------------------
# la frecuencia: qué días le toca correr al bot

def cada_dias_de(fila: dict | None) -> int:
    """La frecuencia del interruptor, entre 1 y CADA_DIAS_MAXIMO. None (sin fila,
    o una fila de antes de la columna) es a diario."""
    cada = (fila or {}).get("cada_dias")
    cada = CADA_DIAS_DEFECTO if cada is None else int(cada)
    return max(1, min(cada, CADA_DIAS_MAXIMO))


def nombre_frecuencia(cada_dias: int) -> str:
    return "a diario" if int(cada_dias) <= 1 else f"cada {int(cada_dias)} días"


def ultima_corrida(envios: list[dict]) -> datetime | None:
    """La última vez que el BOT mandó algo de verdad. Lo de la página, el historial
    y lo manual no es una corrida; un 'ensayo' de ayer no debe retrasar el primer
    envío real, y una corrida que solo dejó 'fallo:*' se reintenta al día siguiente."""
    cuando = (fecha(e.get("creado")) for e in envios
              if e.get("origen") == "bot" and e.get("resultado") in VIVOS)
    return max((c for c in cuando if c is not None), default=None)


def toca_correr(cada_dias: int, envios: list[dict], ahora: datetime) -> bool:
    """¿Hoy toca corrida? Días de Cognito enteros, como la serie (ver `_dias`): el
    reloj del día 3 puede dispararse unos segundos antes de las 72 horas exactas."""
    if int(cada_dias) <= 1:
        return True
    return _dias(ultima_corrida(envios), fecha(ahora)) >= int(cada_dias)


def siguiente_salida(ahora: datetime) -> datetime:
    """La siguiente vez que suena el reloj, corra o no el bot."""
    ahora = fecha(ahora)
    salida = ahora.replace(hour=HORA_CORRIDA_UTC, minute=0, second=0, microsecond=0)
    return salida if salida > ahora else salida + timedelta(days=1)


def proxima_corrida(cada_dias: int, envios: list[dict], ahora: datetime) -> datetime:
    """Cuándo es la próxima, a la hora del reloj. Es una estimación: si esa corrida
    no manda nada, la siguiente es al otro día; si el dueño cambia la frecuencia, otra."""
    siguiente = siguiente_salida(ahora)
    ultima = ultima_corrida(envios)
    if int(cada_dias) <= 1 or ultima is None:
        return siguiente
    debida = (corte_del_dia(ultima) + timedelta(days=int(cada_dias))).replace(hour=HORA_CORRIDA_UTC)
    return max(siguiente, debida)


def lleva_semanal(cada_dias: int, ahora: datetime) -> bool:
    """¿Este resumen lleva a los fríos? A diario, los lunes. Con otra frecuencia, un
    lunes puede no tener corrida y la sección no saldría nunca, así que va en todas:
    es lo más simple y hasta 7 días cumple con «al menos una vez por semana». De 8 a
    14 sale en cada corrida, que ya es menos seguido (`modo` lo avisa)."""
    return int(cada_dias) > 1 or fecha(ahora).weekday() == 0


# ---------------------------------------------------------------------------
# la página /acceso (server/acceso.py): la pide la persona, no la calendariza nadie

def motivo_para_no_mandar(cuenta: dict | None, envios: list[dict],
                          estado_miembro: str | None, ahora: datetime) -> str | None:
    """None si a esta persona se le puede mandar una clave nueva; si no, por qué
    (solo para el log: a ella se le contesta lo mismo en todos los casos).

    `cuenta`: `usuario_de_cognito`, o None si no existe. `envios`: sus filas vivas.
    `estado_miembro`: su estado en invitaciones_miembros. Quien no aparece en el
    export NO se bloquea: varias cuentas legítimas no salen ahí con su correo."""
    ahora = fecha(ahora)
    if cuenta is None:
        return "sin_cuenta"
    if not cuenta.get("habilitado"):
        return "deshabilitada"
    if cuenta.get("estado") != "FORCE_CHANGE_PASSWORD":
        return "ya_activa"
    if estado_miembro == "excluido":
        return "excluida"
    desde = ahora - timedelta(hours=HORAS_ENTRE_CORREOS_PAGINA)
    if any((fecha(e.get("creado")) or ahora) >= desde
           for e in envios if e.get("resultado") in VIVOS):
        return "envio_reciente"
    modificado = cuenta.get("modificado")
    if modificado is not None and modificado >= desde:
        return "tocada_reciente"
    return None


def paso_de_pagina(envios: list[dict], correo: str) -> int:
    """El paso con que se anota lo que pide la persona: el más alto que ya tiene
    (0 si no tiene). Pedir una clave NO avanza la serie (el bot le manda el mismo
    recordatorio que le tocaba), pero sí cuenta como último contacto y en el cupo."""
    return pasos_por_correo(envios).get(normalizar_correo(correo), (0, None))[0]


# ---------------------------------------------------------------------------
# lo que va en el resumen

def bajas(miembros: list[Miembro], usuarios: list[dict]) -> list[str]:
    """Cuentas que nunca entraron y ya no están en el export vigente: se dieron
    de baja en Skool. No se les escribe; el dueño decide si suspenderlas. Sin
    export cargado no hay bajas que detectar (si no, TODOS lo serían)."""
    if not miembros:
        return []
    vigentes = {m.correo for m in miembros}
    return sorted(u["correo"] for u in usuarios
                  if u.get("estado") == "FORCE_CHANGE_PASSWORD" and u.get("habilitado")
                  and u["correo"] not in vigentes)


def frios(usuarios: list[dict], envios: list[dict], ahora: datetime) -> list[tuple[str, datetime | None]]:
    """Quien recibió R3 hace DIAS_FRIO días o más y sigue sin entrar. Ya no se le
    escribe: va en el resumen semanal (`lleva_semanal`) para que el dueño decida."""
    ahora = fecha(ahora)
    pasos = pasos_por_correo(envios)
    out = []
    for u in usuarios:
        paso, ultimo = pasos.get(u["correo"], (0, None))
        if (u.get("estado") == "FORCE_CHANGE_PASSWORD" and u.get("habilitado")
                and paso >= ULTIMO_PASO and _dias(ultimo, ahora) >= DIAS_FRIO):
            out.append((u["correo"], ultimo))
    return sorted(out, key=lambda t: t[1] or ahora)


def atorados(envios: list[dict], ahora: datetime, minutos: int = 30) -> list[dict]:
    """Filas del bot que se quedaron en 'enviando': la Lambda murió entre anotar
    y confirmar. NO se reintentan (el correo pudo haber salido); se reportan.
    Las de la página no: nunca crean cuenta, así que no hay cortesía que revisar,
    y a las 24 horas esa persona puede volver a pedir."""
    ahora = fecha(ahora)
    return [e for e in envios
            if e.get("origen") == "bot" and e.get("resultado") == "enviando"
            and (fecha(e.get("creado")) or ahora) <= ahora - timedelta(minutes=minutos)]


def permitido(correo: str, lista: str | list[str] | tuple[str, ...]) -> bool:
    """La lista blanca de fuera de prod: direcciones exactas o prefijos («tu+»),
    separados por coma. Vacía = nadie."""
    if isinstance(lista, str):
        lista = lista.split(",")
    correo = normalizar_correo(correo)
    for item in (normalizar_correo(x) for x in lista):
        if item and (correo == item or ("@" not in item and correo.startswith(item))):
            return True
    return False


# ---------------------------------------------------------------------------
# nombres parecidos (el sospechoso de `tools/invitaciones.py cargar`)

def nombre_normal(nombre: str) -> str:
    """Minúsculas, sin acentos, sin signos y con un solo espacio."""
    sin_acentos = "".join(c for c in unicodedata.normalize("NFKD", nombre or "")
                          if not unicodedata.combining(c))
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", sin_acentos.lower()).split())


def nombres_parecidos(a: str, b: str) -> bool:
    """¿Es la misma persona escrita de otra forma? Mismo nombre normalizado, o
    todas las palabras de uno dentro del otro (con al menos dos palabras: «Juan»
    solo no dice nada). Es una alarma para que el dueño mire, no un veredicto."""
    na, nb = nombre_normal(a), nombre_normal(b)
    if not na or not nb:
        return False
    if na == nb:
        return True
    ta, tb = set(na.split()), set(nb.split())
    corto, largo = (ta, tb) if len(ta) <= len(tb) else (tb, ta)
    return len(corto) >= 2 and corto <= largo
