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
from functools import lru_cache

# ---------------------------------------------------------------------------
# selección de backend / identidad

def backend() -> str:
    return os.getenv("STATE_BACKEND", "json")


def usuario_actual() -> str:
    return os.getenv("DEFAULT_USER_ID", "piloto")


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
# rds-data responde DatabaseResumingException ~15 s. Reintentamos dentro del
# presupuesto del timeout de la Lambda (29 s).
_ESPERA_RESUME_S = 24


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
            if "resum" not in str(e).lower() or time.monotonic() > limite:
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
    filas = ejecutar(
        """INSERT INTO monedero (user_id, saldo) VALUES (:u, :n)
           ON CONFLICT (user_id) DO UPDATE
             SET saldo = monedero.saldo + :n, actualizado = now()
           RETURNING saldo""",
        {"u": user_id, "n": creditos})
    ejecutar(
        """INSERT INTO monedero_movimientos (user_id, creditos, tipo, referencia)
           VALUES (:u, :n, :t, :r)""",
        {"u": user_id, "n": creditos, "t": tipo, "r": referencia})
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
