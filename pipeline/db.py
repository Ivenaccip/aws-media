"""C2 — estado en Postgres (Aurora Serverless v2 vía Data API, sin driver ni VPC).

Selección de backend por env `STATE_BACKEND`: "json" (default — dev local sigue
igual que siempre) | "postgres" (el servicio en AWS). Los modelos Pydantic viajan
enteros como JSONB en la columna `doc`; las columnas materializadas (estado,
brief, creado) existen solo para listar/ordenar sin deserializar todo.

La Lambda vive FUERA de la VPC a propósito (HANDOFF §3): habla con Aurora por el
endpoint HTTPS de rds-data, así que no hay NAT Gateway ni driver de Postgres.
boto3 se importa perezoso: en local con backend json este módulo no lo necesita.

`user_id` va en TODA fila desde el primer esquema (regla del plan). Hasta que se
exija el login de Cognito (deuda C1) todo corre como DEFAULT_USER_ID.
"""
from __future__ import annotations

import json
import os
import time
from contextvars import ContextVar
from functools import lru_cache

# ---------------------------------------------------------------------------
# selección de backend / identidad

def backend() -> str:
    return os.getenv("STATE_BACKEND", "json")


# M2 — identidad por-request: el middleware de auth fija aquí el sub del token
# de Cognito; los workers siguen fijando DEFAULT_USER_ID (un proceso = un
# usuario). Sin login exigido todo cae al piloto, como siempre.
_usuario_request: ContextVar[str | None] = ContextVar("usuario_request", default=None)


def usuario_actual() -> str:
    return _usuario_request.get() or os.getenv("DEFAULT_USER_ID", "piloto")


def fijar_usuario(user_id: str | None):
    """Fija la identidad del request actual; devuelve el token para reset."""
    return _usuario_request.set(user_id)


# ---------------------------------------------------------------------------
# cliente Data API

@lru_cache(maxsize=1)
def _cliente():
    import boto3  # perezoso: solo existe en la imagen/entorno AWS
    return boto3.client("rds-data")


def _cfg() -> dict:
    return {
        "resourceArn": os.environ["DB_CLUSTER_ARN"],
        "secretArn": os.environ["DB_SECRET_ARN"],
        "database": os.getenv("DB_NAME", "media"),
    }


def _param(nombre: str, valor) -> dict:
    if valor is None:
        return {"name": nombre, "value": {"isNull": True}}
    if isinstance(valor, bool):
        return {"name": nombre, "value": {"booleanValue": valor}}
    if isinstance(valor, int):
        return {"name": nombre, "value": {"longValue": valor}}
    if isinstance(valor, float):
        return {"name": nombre, "value": {"doubleValue": valor}}
    if isinstance(valor, (dict, list)):
        valor = json.dumps(valor, ensure_ascii=False)
    return {"name": nombre, "value": {"stringValue": str(valor)}}


# Tras la auto-pausa (mín 0 ACU) la primera llamada despierta el clúster:
# rds-data responde DatabaseResumingException o DatabaseUnavailableException
# (esta última con el mensaje VACÍO — filtrar por el nombre de la clase)
# durante ~15 s. Reintentamos dentro del presupuesto del timeout de la
# Lambda (29 s).
_ESPERA_RESUME_S = 24
_DESPERTANDO = ("resum", "unavailable")


def ejecutar(sql: str, params: dict | None = None) -> list[dict]:
    """Corre UNA sentencia (el Data API no acepta varias por llamada) y devuelve
    las filas como lista de dicts. Valores jsonb: selecciónalos como ::text."""
    kwargs = dict(_cfg(), sql=sql, formatRecordsAs="JSON")
    if params:
        kwargs["parameters"] = [_param(k, v) for k, v in params.items()]
    limite = time.monotonic() + _ESPERA_RESUME_S
    while True:
        try:
            r = _cliente().execute_statement(**kwargs)
            break
        except Exception as e:  # noqa: BLE001 — filtramos por mensaje abajo
            texto = f"{type(e).__name__} {e}".lower()
            if not any(m in texto for m in _DESPERTANDO) or time.monotonic() > limite:
                raise
            time.sleep(2)
    return json.loads(r.get("formattedRecords") or "[]")


# ---------------------------------------------------------------------------
# esquema (idempotente — cada CREATE lleva IF NOT EXISTS)

ESQUEMA: list[str] = [
    # identidad: id = sub de Cognito cuando el login se exija; hoy, el piloto
    """CREATE TABLE IF NOT EXISTS usuarios (
        id     text PRIMARY KEY,
        email  text,
        creado timestamptz NOT NULL DEFAULT now()
    )""",
    # proyectos del generador (rama crear): doc = Proyecto pydantic completo
    """CREATE TABLE IF NOT EXISTS proyectos_gen (
        user_id     text NOT NULL REFERENCES usuarios(id),
        id          text NOT NULL,
        creado      timestamptz NOT NULL,
        estado      text NOT NULL,
        brief       text NOT NULL,
        doc         jsonb NOT NULL,
        actualizado timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
    )""",
    # proyectos del editor (rama e1, videos/video-N) — se cablea en C3 con S3
    """CREATE TABLE IF NOT EXISTS proyectos_editor (
        user_id text NOT NULL REFERENCES usuarios(id),
        nombre  text NOT NULL,
        creado  timestamptz NOT NULL DEFAULT now(),
        doc     jsonb NOT NULL DEFAULT '{}'::jsonb,
        PRIMARY KEY (user_id, nombre)
    )""",
    # versiones de clips generados — regla dura: NUNCA se borran (el undo cuesta $)
    """CREATE TABLE IF NOT EXISTS clip_versiones (
        user_id     text NOT NULL,
        proyecto_id text NOT NULL,
        escena_id   text NOT NULL,
        version     int  NOT NULL,
        media_key   text,
        meta        jsonb NOT NULL DEFAULT '{}'::jsonb,
        creado      timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, proyecto_id, escena_id, version)
    )""",
    # libro de costes — base de la facturación por usuario (C5/C6)
    """CREATE TABLE IF NOT EXISTS costes (
        id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id     text NOT NULL,
        proyecto_id text,
        concepto    text NOT NULL,
        proveedor   text,
        costo_usd   numeric(10, 4) NOT NULL,
        traza       text,
        creado      timestamptz NOT NULL DEFAULT now()
    )""",
    # C5 — monedero: saldo materializado + libro mayor de movimientos.
    # El gate duro es el UPDATE condicionado de cobrar_creditos (atómico).
    """CREATE TABLE IF NOT EXISTS monedero (
        user_id     text PRIMARY KEY REFERENCES usuarios(id),
        saldo       int  NOT NULL DEFAULT 0 CHECK (saldo >= 0),
        actualizado timestamptz NOT NULL DEFAULT now()
    )""",
    """CREATE TABLE IF NOT EXISTS monedero_movimientos (
        id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        user_id    text NOT NULL,
        creditos   int  NOT NULL,
        tipo       text NOT NULL,
        referencia text,
        creado     timestamptz NOT NULL DEFAULT now()
    )""",
    # M4 — idempotencia de compras: Stripe reintenta webhooks, así que una
    # misma referencia de compra solo puede entrar UNA vez al libro mayor.
    """CREATE UNIQUE INDEX IF NOT EXISTS monedero_mov_compra_ref
       ON monedero_movimientos (referencia) WHERE tipo = 'compra'""",
    # M7 — cuts.json versionado por proyecto del editor. Las versiones jamás se
    # borran (misma regla que clip_versiones); el PRIMARY KEY es el candado de
    # concurrencia: dos saves sobre la misma base chocan y el segundo recibe 409.
    """CREATE TABLE IF NOT EXISTS cortes_versiones (
        user_id  text NOT NULL,
        proyecto text NOT NULL,
        version  int  NOT NULL,
        doc      jsonb NOT NULL,
        creado   timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, proyecto, version)
    )""",
    # M12 — tope de proyectos ACTIVOS por usuario (los archivados no cuentan).
    # NULL = ilimitado (plan anual). Es columna, no constante: la palanca de
    # slots por plan queda abierta sin migrar de nuevo.
    "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS slots int DEFAULT 6",
]


def migrar() -> None:
    for sentencia in ESQUEMA:
        ejecutar(sentencia)
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": usuario_actual()})


# ---------------------------------------------------------------------------
# repositorio de proyectos del generador

def guardar_proyecto(user_id: str, id_: str, creado: str, estado: str,
                     brief: str, doc: str) -> None:
    """Upsert del documento completo. `doc` llega ya serializado (model_dump_json)."""
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    ejecutar(
        """INSERT INTO proyectos_gen (user_id, id, creado, estado, brief, doc)
           VALUES (:u, :i, :creado::timestamptz, :estado, :brief, :doc::jsonb)
           ON CONFLICT (user_id, id) DO UPDATE
             SET estado = EXCLUDED.estado, brief = EXCLUDED.brief,
                 doc = EXCLUDED.doc, actualizado = now()""",
        {"u": user_id, "i": id_, "creado": creado, "estado": estado,
         "brief": brief, "doc": doc},
    )


def guardar_proyecto_editor(user_id: str, nombre: str, doc: str) -> None:
    """Upsert del proyecto del editor (C3: registra las subidas a S3)."""
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    ejecutar(
        """INSERT INTO proyectos_editor (user_id, nombre, doc)
           VALUES (:u, :n, :doc::jsonb)
           ON CONFLICT (user_id, nombre) DO UPDATE SET doc = EXCLUDED.doc""",
        {"u": user_id, "n": nombre, "doc": doc},
    )


def cargar_proyecto_editor(user_id: str, nombre: str) -> dict | None:
    filas = ejecutar(
        "SELECT doc::text AS doc FROM proyectos_editor "
        "WHERE user_id = :u AND nombre = :n", {"u": user_id, "n": nombre})
    return json.loads(filas[0]["doc"]) if filas else None


def listar_proyectos_editor(user_id: str) -> list[dict]:
    filas = ejecutar(
        "SELECT nombre, doc::text AS doc FROM proyectos_editor "
        "WHERE user_id = :u ORDER BY creado DESC", {"u": user_id})
    return [{"nombre": f["nombre"], "doc": json.loads(f["doc"])} for f in filas]


# Campos del doc que los jobs actualizan con jsonb_set (lista cerrada: la ruta
# va interpolada en el SQL, así que jamás sale de aquí)
_CAMPOS_EDITOR = {"render": "{render}", "shorts": "{shorts}"}


def fijar_campo_editor(user_id: str, nombre: str, campo: str, valor: str) -> None:
    """M7/M8: estado de un job dentro del doc del proyecto del editor
    (jsonb_set: no pisa las subidas/flags que registró el puente)."""
    ejecutar(
        f"""UPDATE proyectos_editor
            SET doc = jsonb_set(doc, '{_CAMPOS_EDITOR[campo]}', :v::jsonb)
            WHERE user_id = :u AND nombre = :n""",
        {"u": user_id, "n": nombre, "v": valor},
    )


def fijar_render_editor(user_id: str, nombre: str, render: str) -> None:
    fijar_campo_editor(user_id, nombre, "render", render)


# ---------------------------------------------------------------------------
# M7 — cuts.json versionado (editor de cortes en la nube)

def cortes_ultima(user_id: str, proyecto: str) -> dict | None:
    """Última versión del corte: {"version": n, "doc": {...}} o None si nunca
    se ha guardado (el primer /api/data siembra la v1 desde S3)."""
    filas = ejecutar(
        """SELECT version, doc::text AS doc FROM cortes_versiones
           WHERE user_id = :u AND proyecto = :p
           ORDER BY version DESC LIMIT 1""", {"u": user_id, "p": proyecto})
    if not filas:
        return None
    return {"version": int(filas[0]["version"]), "doc": json.loads(filas[0]["doc"])}


def guardar_cortes(user_id: str, proyecto: str, base: int, doc: str) -> int | None:
    """Guarda la versión base+1 SOLO si `base` sigue siendo la última (control
    de concurrencia: otra pestaña/dispositivo guardó → None y el caller da 409).
    El WHERE valida contra la última versión y el PRIMARY KEY corta la carrera
    de dos saves simultáneos sobre la misma base."""
    filas = ejecutar(
        """INSERT INTO cortes_versiones (user_id, proyecto, version, doc)
           SELECT :u, :p, :v, :doc::jsonb
           WHERE (SELECT COALESCE(MAX(version), 0) FROM cortes_versiones
                  WHERE user_id = :u AND proyecto = :p) = :base
           ON CONFLICT (user_id, proyecto, version) DO NOTHING
           RETURNING version""",
        {"u": user_id, "p": proyecto, "v": int(base) + 1, "base": int(base), "doc": doc})
    return int(filas[0]["version"]) if filas else None


# ---------------------------------------------------------------------------
# monedero de créditos (C5 — lo consume pipeline/creditos.py)

def saldo_creditos(user_id: str) -> int:
    filas = ejecutar("SELECT saldo FROM monedero WHERE user_id = :u", {"u": user_id})
    return int(filas[0]["saldo"]) if filas else 0


def abonar_creditos(user_id: str, creditos: int, tipo: str,
                    referencia: str | None = None) -> int:
    """Suma créditos (cortesía, compra, devolución o ajuste admin — puede ser
    negativo en ajustes). Devuelve el saldo resultante."""
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    # GREATEST: el CHECK (saldo >= 0) se evalúa sobre la fila PROPUESTA antes
    # de resolver ON CONFLICT — un abono negativo (ajuste admin) tronaría aunque
    # la fila exista. Sin monedero previo, un ajuste negativo deja saldo 0.
    filas = ejecutar(
        """INSERT INTO monedero (user_id, saldo) VALUES (:u, GREATEST(:n, 0))
           ON CONFLICT (user_id) DO UPDATE
             SET saldo = monedero.saldo + :n, actualizado = now()
           RETURNING saldo""",
        {"u": user_id, "n": creditos})
    ejecutar(
        """INSERT INTO monedero_movimientos (user_id, creditos, tipo, referencia)
           VALUES (:u, :n, :t, :r)""",
        {"u": user_id, "n": creditos, "t": tipo, "r": referencia})
    return int(filas[0]["saldo"])


def abonar_compra(user_id: str, creditos: int, referencia: str) -> int | None:
    """Abono de COMPRA idempotente (M4 — el webhook de Stripe reintenta).

    El libro mayor manda: primero se intenta el movimiento contra el índice
    único de compras; si la referencia ya existe no se toca el saldo y se
    devuelve None. Solo cuando el movimiento entró se materializa el saldo —
    así ni dos reintentos concurrentes pueden abonar doble."""
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    filas = ejecutar(
        """INSERT INTO monedero_movimientos (user_id, creditos, tipo, referencia)
           VALUES (:u, :n, 'compra', :r)
           ON CONFLICT (referencia) WHERE tipo = 'compra' DO NOTHING
           RETURNING id""",
        {"u": user_id, "n": creditos, "r": referencia})
    if not filas:
        return None          # referencia ya abonada: reintento de Stripe
    filas = ejecutar(
        """INSERT INTO monedero (user_id, saldo) VALUES (:u, GREATEST(:n, 0))
           ON CONFLICT (user_id) DO UPDATE
             SET saldo = monedero.saldo + :n, actualizado = now()
           RETURNING saldo""",
        {"u": user_id, "n": creditos})
    return int(filas[0]["saldo"])


def cobrar_creditos(user_id: str, creditos: int,
                    referencia: str | None = None) -> int | None:
    """EL gate duro: UPDATE condicionado — si el saldo no alcanza (o no hay
    monedero) no toca nada y devuelve None. Atómico aunque haya concurrencia."""
    filas = ejecutar(
        """UPDATE monedero SET saldo = saldo - :n, actualizado = now()
           WHERE user_id = :u AND saldo >= :n RETURNING saldo""",
        {"u": user_id, "n": creditos})
    if not filas:
        return None
    ejecutar(
        """INSERT INTO monedero_movimientos (user_id, creditos, tipo, referencia)
           VALUES (:u, :n, 'cargo', :r)""",
        {"u": user_id, "n": -creditos, "r": referencia})
    return int(filas[0]["saldo"])


def movimientos_creditos(user_id: str, limite: int = 20) -> list[dict]:
    return ejecutar(
        "SELECT creditos, tipo, referencia, creado FROM monedero_movimientos "
        "WHERE user_id = :u ORDER BY id DESC LIMIT :l",
        {"u": user_id, "l": limite})


def reclamar_produccion(user_id: str, id_: str) -> bool:
    """M5 (deuda C5-4) — cierra la ventana de doble cobro en producir: UPDATE
    condicionado sobre la COLUMNA estado (atómico en Postgres). Solo un clic
    gana el claim; el perdedor recibe False y el endpoint responde 409 sin
    cobrar. El doc jsonb se sincroniza después con p.guardar()."""
    filas = ejecutar(
        """UPDATE proyectos_gen SET estado = 'produciendo', actualizado = now()
           WHERE user_id = :u AND id = :i AND estado IN ('revision', 'error')
           RETURNING id""",
        {"u": user_id, "i": id_})
    return bool(filas)


def liberar_produccion(user_id: str, id_: str, estado: str) -> None:
    """Revierte el claim (402 al cobrar, o el lanzamiento tronó antes de
    guardar): la columna vuelve al estado previo para permitir otro intento."""
    ejecutar(
        """UPDATE proyectos_gen SET estado = :e, actualizado = now()
           WHERE user_id = :u AND id = :i AND estado = 'produciendo'""",
        {"u": user_id, "i": id_, "e": estado})


def cargar_proyecto(user_id: str, id_: str) -> dict | None:
    filas = ejecutar(
        "SELECT doc::text AS doc FROM proyectos_gen WHERE user_id = :u AND id = :i",
        {"u": user_id, "i": id_})
    return json.loads(filas[0]["doc"]) if filas else None


def listar_proyectos(user_id: str) -> list[dict]:
    filas = ejecutar(
        "SELECT doc::text AS doc FROM proyectos_gen WHERE user_id = :u "
        "ORDER BY creado DESC", {"u": user_id})
    return [json.loads(f["doc"]) for f in filas]


# ---------------------------------------------------------------------------
# M12 — slots de proyectos activos

def slots_usuario(user_id: str) -> int | None:
    """Tope de proyectos activos del usuario; None = ilimitado (plan anual).
    Usuario sin fila aún = el default de la columna (6)."""
    filas = ejecutar("SELECT slots FROM usuarios WHERE id = :u", {"u": user_id})
    return filas[0]["slots"] if filas else 6


def fijar_slots(user_id: str, slots: int | None) -> None:
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    ejecutar("UPDATE usuarios SET slots = :s WHERE id = :u",
             {"u": user_id, "s": slots})
