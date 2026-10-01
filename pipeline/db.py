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

import hashlib
import json
import logging
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


# RAG·1 — candado de identidad del camino público (/automatiza). Un visitante
# anónimo NO es «nadie»: sin este candado caería en el default de abajo, es
# decir, en el piloto (su S3, su saldo, su reserva de nombres del editor, que
# no se suelta nunca). Por eso el camino público no llama usuario_actual() con
# cuidado: la llamada revienta. Lo marcan el middleware (prefijos públicos de
# server/auth.py) y el worker público con camino_publico().
# Ojo, RAG·31: el 25-oct la ventana pasa a «con cuenta y cobrando» y este
# candado es justo lo que se revierte. Está escrito para quitarse en un solo
# lugar, no esparcido por los endpoints.
_camino_publico: ContextVar[bool] = ContextVar("camino_publico", default=False)


class IdentidadEnCaminoPublico(RuntimeError):
    """usuario_actual() se llamó desde el camino público: es un bug, no un 401."""


def en_camino_publico() -> bool:
    return _camino_publico.get()


class camino_publico:
    """Marca el contexto actual como público mientras dure el bloque:
    `with db.camino_publico(): ...` (middleware y worker público)."""

    def __enter__(self):
        self._marca = _camino_publico.set(True)
        return self

    def __exit__(self, *exc):
        _camino_publico.reset(self._marca)
        return False


def usuario_actual() -> str:
    if _camino_publico.get():
        raise IdentidadEnCaminoPublico(
            "usuario_actual() en el camino público: un anónimo caería en "
            "el piloto. Usa el id de la corrida, no un usuario.")
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


# Tras una auto-pausa la primera llamada despierta el clúster. Producción ya no
# se pausa (suelo de 0.5 ACU desde el 21-sep, infra/stacks/db.py), pero un
# clúster con mínimo 0 —el de dev irá así— sí, y entonces
# rds-data responde DatabaseResumingException o DatabaseUnavailableException
# (esta última con el mensaje VACÍO — filtrar por el nombre de la clase)
# durante ~15 s. Reintentamos dentro del presupuesto del timeout de la
# Lambda (29 s).
_ESPERA_RESUME_S = 24
_DESPERTANDO = ("resum", "unavailable")


class DespertandoError(RuntimeError):
    """La base sigue despertando tras agotar la espera del request. El API la
    convierte en 503 con Retry-After (el frontend reintenta solo); jamás debe
    salir como 500 a la pantalla del usuario."""


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
            if not any(m in texto for m in _DESPERTANDO):
                raise
            if time.monotonic() > limite:
                # el despertar puede tardar más que el presupuesto del request
                # (API Gateway corta a los 29 s): señal tipada para el 503
                raise DespertandoError("la base de datos sigue despertando") from e
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
    # Los proyectos del editor viven en S3 bajo videos/<nombre>/, SIN el
    # usuario: el nombre tiene que ser único entre todas las cuentas. El
    # PRIMARY KEY es el candado (dos reservas simultáneas: gana una sola).
    # Aparte de proyectos_editor para que pedir la subida reserve el nombre
    # sin crear un proyecto vacío en la lista del usuario.
    """CREATE TABLE IF NOT EXISTS nombres_editor (
        nombre  text PRIMARY KEY,
        user_id text NOT NULL,
        creado  timestamptz NOT NULL DEFAULT now()
    )""",
    # M23 · D (MIX) — publicidad automática: una imagen al día en una sola
    # cuenta, sin que el dueño del negocio la revise. La imagen que sube es la
    # BASE de todas (decisión del dueño, 18-sep): cada día Grok parte de ella,
    # así que siempre sale su producto y no una foto genérica inventada.
    #
    # UNA campaña viva por usuario, y eso lo impone el índice parcial de abajo
    # y no el código: un endpoint se puede saltar, un índice no. Es parcial
    # para que las campañas terminadas se conserven — las versiones de este
    # repo no se borran nunca, y aquí además son el recibo de lo que se cobró.
    """CREATE TABLE IF NOT EXISTS mix_campanas (
        user_id            text NOT NULL REFERENCES usuarios(id),
        id                 text NOT NULL,
        motivo             text NOT NULL,
        tono               text NOT NULL DEFAULT 'vender',
        imagen_key         text NOT NULL,
        canal_id           text NOT NULL,
        canal_red          text NOT NULL,
        canal_nombre       text,
        hora               text NOT NULL,
        zona               text NOT NULL,
        empieza            date NOT NULL,
        termina            date NOT NULL,
        estado             text NOT NULL DEFAULT 'borrador',
        nota               text,
        creditos_cobrados  int  NOT NULL DEFAULT 0,
        creditos_devueltos int  NOT NULL DEFAULT 0,
        creado             timestamptz NOT NULL DEFAULT now(),
        actualizado        timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, id)
    )""",
    """CREATE UNIQUE INDEX IF NOT EXISTS mix_campana_viva
       ON mix_campanas (user_id)
       WHERE estado IN ('borrador', 'activa', 'pausada')""",
    # por si la tabla ya existe en alguna base: el CREATE de arriba no la toca
    "ALTER TABLE mix_campanas ADD COLUMN IF NOT EXISTS nota text",
    # Una fila por DÍA de campaña, y el PRIMARY KEY es el candado que la hace
    # posible: el reloj mira cada hora, así que sin él una campaña publicaría
    # veinticuatro veces al día. El día se RECLAMA con un INSERT ... ON
    # CONFLICT DO NOTHING RETURNING: gana exactamente uno, igual que
    # nombres_editor reserva un nombre. Aquí también es dinero — cada fila son
    # 5 créditos ya cobrados por adelantado.
    """CREATE TABLE IF NOT EXISTS mix_corridas (
        user_id     text NOT NULL,
        campana_id  text NOT NULL,
        dia         date NOT NULL,
        estado      text NOT NULL DEFAULT 'corriendo',
        tema        text,
        texto       text,
        media_key   text,
        post_id     text,
        error       text,
        creado      timestamptz NOT NULL DEFAULT now(),
        actualizado timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (user_id, campana_id, dia)
    )""",
    # RAG·3 — /automatiza, la ventana pública del 10 al 25-oct. Lo IRREVERSIBLE
    # del proyecto: su razón de ser es saber qué automatizaciones pide la gente,
    # y un campo que no se guardó esos quince días ya no existe. Por eso se
    # guarda de más.
    #
    # SIN user_id y sin FK a usuarios: el visitante es anónimo (RAG·1). La
    # llave es un índice autoincremental; hacia afuera (la liga /c/<id> y el
    # sondeo) viaja `publico_id`, aleatorio, para que nadie recorra las
    # corridas de los demás sumando 1. Estilo `costes`: el texto crudo tal
    # cual, jsonb con la salida completa y columnas sueltas solo para listar
    # y agrupar.
    """CREATE TABLE IF NOT EXISTS automatiza_corridas (
        id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        publico_id      text NOT NULL UNIQUE,
        texto           text NOT NULL,
        idioma          text,
        estado          text NOT NULL DEFAULT 'recibida',
        motivo          text,
        en_fila_desde   timestamptz,
        empezo          timestamptz,
        termino         timestamptz,
        cache_acerto    boolean,
        validador_ok    boolean,
        validador_motivo text,
        reintentos      int NOT NULL DEFAULT 0,
        nodos           text[],
        resultado       jsonb,
        resultado_key   text,
        guia_key        text,
        modelo          text,
        costo_usd       numeric(10, 4),
        traza           text,
        correo_enviado  timestamptz,
        envio_id        text,
        envio_error     text,
        descargo_json   timestamptz,
        descargo_guia   timestamptz,
        descargas       int NOT NULL DEFAULT 0,
        reportado       timestamptz,
        reporte         text,
        ip_hash         text,
        referrer        text,
        utm_source      text,
        utm_medium      text,
        utm_campaign    text,
        utm_content     text,
        creado          timestamptz NOT NULL DEFAULT now(),
        actualizado     timestamptz NOT NULL DEFAULT now()
    )""",
    # la fila (RAG·12, «vas en el lugar N») y el tope diario (RAG·5) cuentan por aquí
    """CREATE INDEX IF NOT EXISTS automatiza_corridas_fila
       ON automatiza_corridas (en_fila_desde) WHERE estado = 'en_fila'""",
    """CREATE INDEX IF NOT EXISTS automatiza_corridas_creado
       ON automatiza_corridas (creado)""",
    # El correo va APARTE de la corrida: es dato personal con su propio plazo
    # de borrado (RAG·0) y su propia lista de opt-in (RAG·35), y así se borra
    # sin tocar lo que se pidió. Solo se AGREGAN filas, nunca se editan: cada
    # vez que alguien deja o cambia su correo queda qué casilla vio, con qué
    # texto y con qué versión del aviso de privacidad. Esa es la prueba del
    # consentimiento. Vale la última fila de cada corrida.
    """CREATE TABLE IF NOT EXISTS automatiza_contactos (
        id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        corrida_id        bigint NOT NULL REFERENCES automatiza_corridas(id),
        correo            text NOT NULL,
        origen            text NOT NULL,
        recontacto        boolean NOT NULL DEFAULT false,
        recontacto_texto  text,
        aviso_version     text,
        creado            timestamptz NOT NULL DEFAULT now()
    )""",
    """CREATE INDEX IF NOT EXISTS automatiza_contactos_corrida
       ON automatiza_contactos (corrida_id, id)""",
    # RAG·5 — el interruptor y el tope diario de /automatiza. Es una FILA y no
    # una variable de entorno a propósito: apagar en una emergencia (o cerrar
    # el 25-oct) no puede exigir un deploy del API, que redespliega todo.
    # Solo se agregan filas, igual que los contactos: vale la última, y las
    # anteriores dicen quién apagó, cuándo y por qué. Sin ninguna fila la
    # sección está APAGADA: se enciende a propósito, nunca por omisión.
    """CREATE TABLE IF NOT EXISTS automatiza_interruptor (
        id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        encendido     boolean NOT NULL,
        tope_corridas int,
        tope_usd      numeric(10, 2),
        nota          text,
        creado        timestamptz NOT NULL DEFAULT now()
    )""",
    # RAG·6 — tope por IP (hasheada). Columna aparte y no en el CREATE: la
    # tabla ya existe en dev. NULL = el provisional de pipeline/publico.py.
    "ALTER TABLE automatiza_interruptor ADD COLUMN IF NOT EXISTS tope_por_ip int",
    """CREATE INDEX IF NOT EXISTS automatiza_corridas_ip
       ON automatiza_corridas (ip_hash, creado)""",
    # RAG·11 — en qué paso del armado va (entender → buscar → armar →
    # revisar), para que la espera avance a la vista. Columna aparte y no en
    # el CREATE: la tabla ya existe en dev. Sin CHECK a propósito: es
    # cosmético, la lista blanca vive en automatiza_paso() y un paso nuevo no
    # debe exigir otra migración.
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS paso text",
    # RAG·12 — cuántas veces se dejó o cambió el correo de la corrida. Es el
    # tope de POST …/correo y vive en la corrida y no en un count(*) de
    # automatiza_contactos: contar y luego insertar son dos sentencias, y con
    # peticiones simultáneas todas leen la misma cuenta y todas pasan. Sumar
    # aquí toma el candado de la fila (ver automatiza_guardar_correo).
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS correos int NOT NULL DEFAULT 0",
    # RAG·13 — qué versión del aviso de privacidad aceptó en el pop-up antes
    # de mandar la descripción (la de cada correo vive en automatiza_contactos).
    # Columna aparte y no en el CREATE: la tabla ya existe en dev. Si el API
    # nuevo llega antes que db_migrate, automatiza_crear guarda sin ella.
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS aviso_version text",
    # RAG·20 — con qué se buscó, y lo que necesita el caché de RAG·32 para
    # reciclar corridas pasadas sin volver a pagar embeddings. Columnas aparte
    # y no en el CREATE: la tabla ya existe en dev.
    #   peticion_vector   el embedding de la PETICIÓN ORIGINAL (task_type de
    #                     consulta), sea cual sea el camino: así las corridas
    #                     se comparan entre sí. Es derivado del texto: se borra
    #                     con él, al mismo plazo (RAG·0).
    #   peticion_modelo   «gemini-embedding-001/1024»: un vector de otro modelo
    #                     o dimensión no se puede comparar con estos.
    #   catalogo_version  «n8n 2.41.4 · prototipo»: si cambia, lo que está en
    #                     caché ya no vale.
    #   busqueda_camino   directo · reescrita (RAG·20); para medir cuál gana.
    #   busqueda          el detalle: consulta usada, nodos sugeridos y, si
    #                     la reescritura falló, por qué se cayó a directo.
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS peticion_vector real[]",
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS peticion_modelo text",
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS catalogo_version text",
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS busqueda_camino text",
    "ALTER TABLE automatiza_corridas ADD COLUMN IF NOT EXISTS busqueda jsonb",
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


class NombreAjeno(Exception):
    """El nombre de proyecto del editor ya es de otra cuenta. El texto va
    tal cual a la pantalla (el API lo convierte en 409)."""

    def __init__(self, nombre: str):
        self.nombre = nombre
        super().__init__(
            f"El nombre «{nombre}» ya lo usa otra cuenta. Elige otro nombre para "
            "tu proyecto (por ejemplo, agrégale tu nombre o un número).")


def nombre_editor_ajeno(user_id: str, nombre: str) -> bool:
    """¿Otra cuenta tiene ya este nombre? Solo mira, no reserva.

    Mira también proyectos_editor: los proyectos de antes de la reserva no
    tienen fila en nombres_editor y siguen siendo de quien los creó."""
    return bool(ejecutar(
        """SELECT 1 AS ajeno FROM nombres_editor WHERE nombre = :n AND user_id <> :u
           UNION ALL
           SELECT 1 FROM proyectos_editor WHERE nombre = :n AND user_id <> :u
           LIMIT 1""", {"u": user_id, "n": nombre}))


def reservar_nombre_editor(user_id: str, nombre: str) -> bool:
    """Reserva el nombre para el usuario. True si ya es suyo o estaba libre.

    Atómico: el PRIMARY KEY de nombres_editor decide quién gana, y el
    perdedor cae en DO NOTHING. El NOT EXISTS impide reservar un nombre que
    otra cuenta ya usaba antes de que existiera la tabla. La comprobación va
    en otra sentencia (otra transacción del Data API) para ver la fila que
    haya escrito una reserva simultánea.
    Una reserva no se suelta: el nombre queda del usuario aunque abandone la
    subida, y el mismo nombre le vuelve a servir."""
    ejecutar(
        """INSERT INTO nombres_editor (nombre, user_id)
           SELECT :n, :u
           WHERE NOT EXISTS (SELECT 1 FROM proyectos_editor
                             WHERE nombre = :n AND user_id <> :u)
           ON CONFLICT (nombre) DO NOTHING""", {"u": user_id, "n": nombre})
    return not nombre_editor_ajeno(user_id, nombre)


def sufijo_estable(user_id: str, base: str, intento: int) -> str:
    """4 hex que dependen solo de (usuario, base, intento). El mismo usuario
    cae siempre en el mismo nombre, y otro usuario en otro."""
    return hashlib.sha256(f"{user_id}:{base}:{intento}".encode()).hexdigest()[:4]


def reservar_nombre_derivado(user_id: str, base: str, *, con_base: bool = True,
                             reservar: bool = True, intentos: int = 8) -> str | None:
    """Nombre libre para un proyecto que nombra el sistema (yt-<id>, gen-<id>).

    Prueba `base` (si `con_base`) y luego base-<sufijo_estable>, y se queda
    con el primero que sea del usuario o esté libre. Como los sufijos son
    estables, repetir la llamada da el mismo nombre: un reintento no abre un
    proyecto nuevo. Con `reservar=False` solo calcula (la cotización no debe
    apartar nombres). None si todos los candidatos son de otras cuentas."""
    candidatos = [base] if con_base else []
    candidatos += [f"{base}-{sufijo_estable(user_id, base, i)}" for i in range(intentos)]
    for nombre in candidatos:
        libre = (reservar_nombre_editor(user_id, nombre) if reservar
                 else not nombre_editor_ajeno(user_id, nombre))
        if libre:
            return nombre
    return None


def guardar_proyecto_editor(user_id: str, nombre: str, doc: str) -> None:
    """Upsert del proyecto del editor (C3: registra las subidas a S3).

    Reserva el nombre antes de escribir: si es de otra cuenta lanza
    NombreAjeno y no toca nada. Así ningún camino que cree proyectos
    (subida, YouTube, puente del generador) puede compartir el prefijo
    videos/<nombre>/ con otro usuario."""
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    if not reservar_nombre_editor(user_id, nombre):
        raise NombreAjeno(nombre)
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
        "SELECT nombre, creado, doc::text AS doc FROM proyectos_editor "
        "WHERE user_id = :u ORDER BY creado DESC", {"u": user_id})
    # UI·26: la fecha viaja para ordenar «Mis videos» junto con películas y clips
    return [{"nombre": f["nombre"], "creado": _iso(f.get("creado")),
             "doc": json.loads(f["doc"])} for f in filas]


def _iso(valor) -> str | None:
    """El Data API entrega un timestamptz como «2026-09-28 17:29:13.123» (en
    UTC y sin zona): sin la T ni la Z, Safari no lo entiende y Chrome lo lee
    como hora local."""
    if hasattr(valor, "isoformat"):
        return valor.isoformat()
    if not isinstance(valor, str) or not valor:
        return None
    iso = valor.replace(" ", "T", 1)
    return iso if iso.endswith("Z") or "+" in iso[10:] else iso + "Z"


def corridas_editor(user_id: str) -> list[dict]:
    """El cuadro de «tus trabajos» sondea mientras algo corre: solo trae las tres
    corridas que enseña, no el doc entero (cortes, chat, subtítulos…)."""
    filas = ejecutar(
        "SELECT nombre, jsonb_build_object('editar', doc->'editar', 'importar', doc->'importar', "
        "'shorts', doc->'shorts')::text AS doc FROM proyectos_editor "
        "WHERE user_id = :u ORDER BY creado DESC", {"u": user_id})
    return [{"nombre": f["nombre"], "doc": json.loads(f["doc"])} for f in filas]


# Campos del doc que los jobs actualizan con jsonb_set (lista cerrada: la ruta
# va interpolada en el SQL, así que jamás sale de aquí)
_CAMPOS_EDITOR = {"render": "{render}", "shorts": "{shorts}",
                  "editar": "{editar}", "flags": "{flags}",
                  "subtitulos": "{subtitulos}", "overlay_job": "{overlay_job}",
                  "chat": "{chat}", "importar": "{importar}"}


def fijar_campo_editor(user_id: str, nombre: str, campo: str, valor: str) -> None:
    """M7/M8: estado de un job dentro del doc del proyecto del editor
    (jsonb_set: no pisa las subidas/flags que registró el puente)."""
    ejecutar(
        f"""UPDATE proyectos_editor
            SET doc = jsonb_set(doc, '{_CAMPOS_EDITOR[campo]}', :v::jsonb)
            WHERE user_id = :u AND nombre = :n""",
        {"u": user_id, "n": nombre, "v": valor},
    )


# M23 · D (prerrequisito) — dónde vive el estado de cada trabajo de Fargate
# dentro del doc del editor, para el claim del barredor. Whitelist por la misma
# razón que _CAMPOS_EDITOR: va interpolada en el SQL y jamás sale de aquí.
# `render` y `subtitulos` no están porque no cobran créditos: no hay nada que
# reclamar. El de shorts va dos niveles adentro (doc.shorts.render), que es lo
# que impide reescribir el campo entero — al lado viven los candidatos.
_TRABAJOS_FARGATE = {
    "shorts":     ("{shorts,render}", "{shorts,render,estado}", "{shorts,render,error}"),
    "editar":     ("{editar}", "{editar,estado}", "{editar,error}"),
    "overlay_job": ("{overlay_job}", "{overlay_job,estado}", "{overlay_job,error}"),
}


def reclamar_fallo_editor(user_id: str, nombre: str, campo: str,
                          mensaje: str) -> dict | None:
    """El claim del barredor para los trabajos del editor (`worker/barredor.py`).

    Mismo trato que `reclamar_fallo_produccion`, sobre otra tabla: gana solo si
    el trabajo SIGUE 'corriendo', que es el caso en el que la tarea murió sin
    que su código llegara a correr. Devuelve el trabajo (con sus `creditos`, que
    quedaron escritos al cobrar) o None si ya lo cerró alguien.

    Estado y motivo se escriben en la MISMA sentencia: un trabajo en 'error' sin
    decir por qué manda al usuario a adivinar."""
    base, estado, error = _TRABAJOS_FARGATE[campo]
    filas = ejecutar(
        f"""UPDATE proyectos_editor
            SET doc = jsonb_set(jsonb_set(doc, '{estado}', '"error"'::jsonb),
                                '{error}', :m::jsonb)
            WHERE user_id = :u AND nombre = :n
              AND doc #>> '{estado}' = 'corriendo'
            RETURNING (doc #> '{base}')::text AS trabajo""",
        {"u": user_id, "n": nombre, "m": json.dumps(mensaje)})
    return json.loads(filas[0]["trabajo"]) if filas else None


def fijar_render_editor(user_id: str, nombre: str, render: str) -> None:
    fijar_campo_editor(user_id, nombre, "render", render)


def fijar_subtitulos_editor(user_id: str, nombre: str, estado: str) -> None:
    """M16.1: estado del quemado de subtítulos en nube (doc.subtitulos)."""
    fijar_campo_editor(user_id, nombre, "subtitulos", estado)


def fijar_overlay_job_editor(user_id: str, nombre: str, estado: str) -> None:
    """M16.3: job de regeneración/activación de un overlay (doc.overlay_job)."""
    fijar_campo_editor(user_id, nombre, "overlay_job", estado)


def fijar_chat_editor(user_id: str, nombre: str, chat: str) -> None:
    """M16.4: historial del chat editorial en nube (doc.chat.mensajes)."""
    fijar_campo_editor(user_id, nombre, "chat", chat)


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


def reclamar_produccion(user_id: str, id_: str,
                        desde: tuple[str, ...] = ("revision", "error")) -> bool:
    """M5 (deuda C5-4) — cierra la ventana de doble cobro en producir: UPDATE
    condicionado sobre la COLUMNA estado (atómico en Postgres). Solo un clic
    gana el claim; el perdedor recibe False y el endpoint responde 409 sin
    cobrar. El doc jsonb se sincroniza después con p.guardar().

    `desde` son los estados desde los que se puede reclamar. M22 · G añade
    'imagenes' para el botón de animar: es otro lanzamiento, y dos clics
    seguidos tienen que poder lanzar una sola vez igual que en producir."""
    marcas = ", ".join(f":e{i}" for i in range(len(desde)))
    filas = ejecutar(
        f"""UPDATE proyectos_gen SET estado = 'produciendo', actualizado = now()
            WHERE user_id = :u AND id = :i AND estado IN ({marcas})
            RETURNING id""",
        {"u": user_id, "i": id_, **{f"e{i}": e for i, e in enumerate(desde)}})
    return bool(filas)


def liberar_produccion(user_id: str, id_: str, estado: str) -> None:
    """Revierte el claim (402 al cobrar, o el lanzamiento tronó antes de
    guardar): la columna vuelve al estado previo para permitir otro intento."""
    ejecutar(
        """UPDATE proyectos_gen SET estado = :e, actualizado = now()
           WHERE user_id = :u AND id = :i AND estado = 'produciendo'""",
        {"u": user_id, "i": id_, "e": estado})


def reclamar_fallo_produccion(user_id: str, id_: str) -> bool:
    """M23 · D (prerrequisito) — el claim del BARREDOR (`worker/barredor.py`).

    Gana solo si el proyecto SIGUE en 'produciendo', que es justo el caso en el
    que la tarea de Fargate murió sin que su código llegara a correr. Si el
    contenedor sí arrancó, él ya movió el proyecto a 'error' (devolviendo),
    'listo' o 'imagenes', y aquí no se devuelve nada. Ese UPDATE condicionado
    es toda la idempotencia del barredor: sin él, un fallo que el contenedor SÍ
    alcanzó a manejar devolvería los créditos dos veces."""
    filas = ejecutar(
        """UPDATE proyectos_gen SET estado = 'error', actualizado = now()
           WHERE user_id = :u AND id = :i AND estado = 'produciendo'
           RETURNING id""",
        {"u": user_id, "i": id_})
    return bool(filas)


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


def proyectos_recientes(user_id: str, horas: float) -> list[tuple[dict, float]]:
    """El cuadro de «tus trabajos»: las películas que siguen en marcha y las que
    cambiaron de estado en las últimas `horas`, con la hora del cambio (epoch)."""
    filas = ejecutar(
        "SELECT doc::text AS doc, extract(epoch FROM actualizado)::float8 AS t FROM proyectos_gen "
        "WHERE user_id = :u AND (estado IN ('preparando', 'produciendo') "
        # make_interval solo existe con int4 y _param manda los int como bigint
        "OR actualizado > now() - make_interval(mins => :m::int)) ORDER BY actualizado DESC",
        {"u": user_id, "m": int(horas * 60)})
    return [(json.loads(f["doc"]), float(f["t"])) for f in filas]


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


# ---------------------------------------------------------------------------
# M23 · D — MIX: la campaña de publicidad automática y sus corridas por día

CAMPOS_CAMPANA = ("motivo", "tono", "imagen_key", "canal_id", "canal_red",
                  "canal_nombre", "hora", "zona", "empieza", "termina")
# De esas diez, dos son `date` en la tabla. El Data API manda TODOS los
# parámetros como texto (`_param`) y Postgres no convierte text→date solo
# dentro de un INSERT: sin el cast la petición muere con «column "empieza" is
# of type date but expression is of type text» y la pantalla recibe un 500
# (visto en producción el 19-sep-2026, al guardar el primer borrador). El
# resto de las consultas de MIX escriben `:d::date` a mano; aquí los
# marcadores salen de un bucle, así que el cast tiene que ir en el molde.
FECHAS_CAMPANA = ("empieza", "termina")
_VIVA = "('borrador', 'activa', 'pausada')"

# Los dos estados en los que la fila del día 1 todavía NO es una publicación:
# nadie ha pagado por ella y el reloj no la ha tocado.
#
#   'preparando' — el trabajo está en la cola o corriendo. Si además tiene
#                  `error`, ese intento murió y se puede pedir otro.
#   'ejemplo'    — el resultado, que el usuario ya vio y aprobó.
#
# Solo estas dos se pueden pisar. Cualquier otro estado ya es un día de verdad
# —publicado, corriendo o cerrado— y una fila así no se toca nunca más: pisarla
# la devolvería a la cola del reloj y publicaría dos veces en la cuenta de un
# cliente, que es lo único que MIX no puede deshacer.
ESTADOS_EJEMPLO = ("ejemplo", "preparando")
EJEMPLO_VIVO = "('" + "', '".join(ESTADOS_EJEMPLO) + "')"


def _marcador(campo: str) -> str:
    """El `:campo` que va en el SQL, con el cast puesto si la columna es fecha."""
    return f":{campo}::date" if campo in FECHAS_CAMPANA else f":{campo}"


def mix_campana(user_id: str) -> dict | None:
    """La campaña viva del usuario (borrador, activa o pausada). Como mucho hay
    una: lo garantiza el índice parcial mix_campana_viva."""
    filas = ejecutar(
        f"SELECT * FROM mix_campanas WHERE user_id = :u AND estado IN {_VIVA}",
        {"u": user_id})
    return filas[0] if filas else None


def mix_guardar_borrador(user_id: str, id_: str, **campos) -> str:
    """Crea o actualiza EL borrador del usuario y devuelve su id.

    Se reutiliza el id del borrador que ya hubiera en vez de crear otro: la
    corrida del día 1 —el ejemplo que se le enseña antes de cobrar— cuelga de
    ese id, y cambiarlo dejaría el ejemplo huérfano.

    Si la campaña viva ya está encendida no se toca nada y se devuelve su id:
    quien decide qué contestar es el endpoint, que tiene con qué explicarlo.
    """
    ejecutar("INSERT INTO usuarios (id) VALUES (:u) ON CONFLICT (id) DO NOTHING",
             {"u": user_id})
    viva = mix_campana(user_id)
    if viva and viva["estado"] != "borrador":
        return str(viva["id"])
    datos = {k: campos.get(k) for k in CAMPOS_CAMPANA}
    if viva:
        sets = ", ".join(f"{k} = {_marcador(k)}" for k in CAMPOS_CAMPANA)
        ejecutar(f"UPDATE mix_campanas SET {sets}, actualizado = now() "
                 "WHERE user_id = :u AND id = :i AND estado = 'borrador'",
                 {**datos, "u": user_id, "i": viva["id"]})
        # Si mueve las fechas, el ejemplo que vio para el arranque anterior
        # queda huérfano DENTRO del rango nuevo, y ahí deja de ser inofensivo:
        # el reloj lo reclamaría como si fuera el día 1 y publicaría el mensaje
        # de un rango que el usuario descartó. Se borran porque un ejemplo es
        # borrador —nadie lo pagó, no es recibo de nada— y porque dejarlo en
        # otro estado tampoco vale: una fila cualquiera en ese día lo bloquea
        # para siempre.
        ejecutar("DELETE FROM mix_corridas WHERE user_id = :u "
                 f"AND campana_id = :i AND estado IN {EJEMPLO_VIVO} "
                 "AND dia <> :d::date",
                 {"u": user_id, "i": viva["id"], "d": datos["empieza"]})
        return str(viva["id"])
    columnas = ", ".join(CAMPOS_CAMPANA)
    valores = ", ".join(_marcador(k) for k in CAMPOS_CAMPANA)
    ejecutar(f"INSERT INTO mix_campanas (user_id, id, {columnas}) "
             f"VALUES (:u, :i, {valores})",
             {**datos, "u": user_id, "i": id_})
    return id_


def mix_encender(user_id: str, id_: str, creditos: int) -> bool:
    """borrador → activa, con lo que se cobró por adelantado anotado encima.

    UPDATE condicionado, como todos los claims de este repo: dos clics en el
    botón de encender y solo uno gana, así que solo uno cobra."""
    filas = ejecutar(
        """UPDATE mix_campanas
              SET estado = 'activa', creditos_cobrados = :c, actualizado = now()
            WHERE user_id = :u AND id = :i AND estado = 'borrador'
        RETURNING id""",
        {"u": user_id, "i": id_, "c": creditos})
    return bool(filas)


def mix_apagar(user_id: str, id_: str, estado: str = "cancelada") -> dict | None:
    """Gana el derecho a apagar Y a devolver, en una sola operación.

    Devuelve la campaña con lo cobrado y los días que ya salieron, que es
    justo lo que hace falta para calcular la devolución. Si alguien ya la
    apagó, devuelve None y quien llama no devuelve nada: esa es toda la
    protección contra devolver dos veces, porque el libro mayor solo tiene
    índice único para las compras."""
    filas = ejecutar(
        """UPDATE mix_campanas SET estado = :e, actualizado = now()
            WHERE user_id = :u AND id = :i AND estado IN ('activa', 'pausada')
        RETURNING id, creditos_cobrados, creditos_devueltos, empieza, termina""",
        {"u": user_id, "i": id_, "e": estado})
    return filas[0] if filas else None


def mix_reclamar_dia(user_id: str, campana_id: str, dia: str) -> bool:
    """EL candado de MIX. El reloj mira cada hora; sin esto, una campaña
    publicaría veinticuatro veces al día y cobraría veinticuatro veces.

    Gana exactamente quien consigue insertar la fila del día. Los demás
    reciben False y se van sin hacer nada ni cobrar."""
    filas = ejecutar(
        """INSERT INTO mix_corridas (user_id, campana_id, dia)
           VALUES (:u, :c, :d::date)
           ON CONFLICT (user_id, campana_id, dia) DO NOTHING
           RETURNING dia""",
        {"u": user_id, "c": campana_id, "d": dia})
    return bool(filas)


def mix_cerrar_dia(user_id: str, campana_id: str, dia: str, estado: str,
                   **campos) -> bool:
    """Cierra la corrida del día con lo que salió (o con el error), y dice si
    fue ESTA llamada la que la cerró.

    Condicionado a 'corriendo' —el estado que deja el candado— por la misma
    razón que todo lo demás aquí: cerrar el día es lo que da derecho a devolver
    sus créditos, y el libro mayor no sabe frenar una devolución repetida (su
    índice único solo cubre las compras). Quien no gane el cierre, no devuelve.
    """
    permitidos = ("tema", "texto", "media_key", "post_id", "error")
    extra = {k: campos.get(k) for k in permitidos if k in campos}
    sets = "".join(f", {k} = :{k}" for k in extra)
    filas = ejecutar(
        f"UPDATE mix_corridas SET estado = :e{sets}, actualizado = now() "
        "WHERE user_id = :u AND campana_id = :c AND dia = :d::date "
        "AND estado = 'corriendo' RETURNING dia",
        {**extra, "u": user_id, "c": campana_id, "d": dia, "e": estado})
    return bool(filas)


def mix_corridas(user_id: str, campana_id: str) -> list[dict]:
    return ejecutar(
        "SELECT dia, estado, tema, texto, media_key, post_id, error "
        "FROM mix_corridas WHERE user_id = :u AND campana_id = :c "
        "ORDER BY dia", {"u": user_id, "c": campana_id})


# Días que ya no deben devolución: los que salieron y los que PUEDE que
# salieran. Un 5xx o un timeout de Blotato después de mandar el post no
# significa que no se publicara —el precedente del worker de video lo llama
# 'incierto' y tampoco devuelve—, así que devolverlos sería regalar la
# publicación y el dinero. Es la otra cara de la regla del barredor: devolver
# de más es tan malo como no devolver.
LIQUIDADOS = ("publicada", "incierta")


def mix_dias_liquidados(user_id: str, campana_id: str) -> int:
    """Días que ya están saldados. Es la base de la devolución: la campaña se
    paga por adelantado, así que lo que no salió se regresa — y lo que sí
    salió, o pudo salir, no."""
    filas = ejecutar(
        "SELECT count(*) AS n FROM mix_corridas WHERE user_id = :u "
        "AND campana_id = :c AND estado IN ('publicada', 'incierta')",
        {"u": user_id, "c": campana_id})
    return int(filas[0]["n"]) if filas else 0


def mix_reclamar_ejemplo(user_id: str, campana_id: str, dia: str) -> dict | None:
    """El día 1 ya tiene imagen: la del ejemplo que se le enseñó antes de cobrar.

    Cuando el reloj llega a ese día, `mix_reclamar_dia` pierde (la fila ya
    existe) y en vez de generar otra imagen —y cobrar otra vez— se reclama la
    que hay. UPDATE condicionado: gana uno solo.

    Reclama TAMBIÉN una fila en 'preparando', y eso no es laxitud: es lo que
    impide que el día 1 se quede sin publicar. Entre que la pantalla aparta la
    fila para pedir otro ejemplo y el worker la termina, el usuario puede
    encender la campaña; si el reloj solo mirara 'ejemplo', esa fila lo
    bloquearía para siempre —el día no saldría y nadie devolvería sus
    créditos—. Reclamada, pasa lo que tiene que pasar: si trae media_key se
    reusa esa imagen (es la que el usuario aprobó al encender), y si no trae
    nada `worker/mix_dia.py` genera la del día como cualquier otro. El ejemplo
    que siguiera corriendo ya no puede pisarla: el upsert de
    `mix_guardar_ejemplo` solo toca filas que aún son un ejemplo."""
    filas = ejecutar(
        f"""UPDATE mix_corridas SET estado = 'corriendo', actualizado = now()
            WHERE user_id = :u AND campana_id = :c AND dia = :d::date
              AND estado IN {EJEMPLO_VIVO}
        RETURNING tema, texto, media_key""",
        {"u": user_id, "c": campana_id, "d": dia})
    return filas[0] if filas else None


# Cuánto puede tardar un ejemplo antes de darlo por muerto. El trabajo corre en
# el worker (900 s de tope) y la parte lenta son el LLM y Grok: dos minutos de
# los malos. Diez es holgura, no una promesa — pasado ese rato se deja pedir
# otro, porque una pantalla que dice «preparando» para siempre es peor que un
# segundo intento que quizá cueste una imagen de más.
MINUTOS_EJEMPLO = 10


def mix_pedir_ejemplo(user_id: str, campana_id: str, dia: str) -> bool:
    """Aparta la fila del día 1 para preparar un ejemplo, y dice si se pudo.

    Es el candado del ejemplo, hermano del de `mix_reclamar_dia`: el trabajo se
    encola DESPUÉS de ganar esta fila, así que dos clics seguidos —o dos
    pestañas— no pueden poner dos trabajos a generar la misma imagen. El
    ejemplo es gratis para el usuario, pero la imagen la pagamos nosotros.

    Se puede pisar una fila que sea un ejemplo (pedir otro es legítimo: cambió
    el motivo o el tono) o un intento que ya murió —con `error` puesto— o que
    lleva demasiado rato sin dar señales. Lo que no se puede pisar es un día de
    verdad, y de eso se encarga el WHERE.

    El tema, el texto y la imagen del intento anterior se CONSERVAN a
    propósito: mientras el nuevo se cocina, la pantalla sigue enseñando el que
    el usuario ya había visto en vez de quedarse en blanco."""
    filas = ejecutar(
        """INSERT INTO mix_corridas (user_id, campana_id, dia, estado)
           VALUES (:u, :c, :d::date, 'preparando')
           ON CONFLICT (user_id, campana_id, dia) DO UPDATE
             SET estado = 'preparando', error = NULL, actualizado = now()
           WHERE mix_corridas.estado = 'ejemplo'
              OR (mix_corridas.estado = 'preparando'
                  AND (mix_corridas.error IS NOT NULL
                       OR mix_corridas.actualizado < now() - :viejo::interval))
        RETURNING dia""",
        {"u": user_id, "c": campana_id, "d": dia,
         "viejo": f"{MINUTOS_EJEMPLO} minutes"})
    return bool(filas)


def mix_fallar_ejemplo(user_id: str, campana_id: str, dia: str,
                       error: str) -> None:
    """Deja escrito por qué no salió el ejemplo, sin sacar la fila de
    'preparando'.

    El estado no cambia porque no hay ningún otro que sirva: 'error' es el de
    un día de campaña que no se publicó —cuenta para la devolución y lo lee la
    lista de días—, y un ejemplo no es un día que falló, es un intento que
    murió. Con el `error` puesto, la pantalla sabe que puede ofrecer otro y
    `mix_pedir_ejemplo` sabe que puede pisarlo."""
    ejecutar(
        "UPDATE mix_corridas SET error = :err, actualizado = now() "
        "WHERE user_id = :u AND campana_id = :c AND dia = :d::date "
        "AND estado = 'preparando'",
        {"u": user_id, "c": campana_id, "d": dia, "err": (error or "")[:400]})


def mix_guardar_ejemplo(user_id: str, campana_id: str, dia: str, *, tema: str,
                        texto: str, media_key: str) -> None:
    """Guarda (o reemplaza) el ejemplo del primer día. Se reemplaza porque el
    usuario puede cambiar el motivo o el tono y volver a pedirlo: lo que se
    enseña y lo que se publicaría tienen que ser lo mismo."""
    # El WHERE del DO UPDATE es lo que impide RESUCITAR un día.
    #
    # Sin él, este era el único write de MIX sin condición, y pisaba la fila
    # del día fuera cual fuera su estado. El camino: el usuario pide otro
    # ejemplo (Grok tarda hasta dos minutos), enciende la campaña mientras se
    # genera, el reloj publica el día 1 de verdad… y al terminar, el ejemplo
    # devolvía esa fila a 'ejemplo' borrando el post_id. El reloj la volvía a
    # ver libre y PUBLICABA OTRA VEZ en la cuenta del cliente. Una fila que ya
    # no es un ejemplo no se toca nunca más.
    #
    # Desde que el ejemplo se prepara en la cola, la fila que este UPDATE pisa
    # casi siempre es la 'preparando' que apartó `mix_pedir_ejemplo` — pero el
    # INSERT sigue haciendo falta: si el usuario movió las fechas mientras se
    # generaba, aquella fila se borró y esta es la primera del día nuevo.
    ejecutar(
        f"""INSERT INTO mix_corridas (user_id, campana_id, dia, estado, tema,
                                      texto, media_key)
           VALUES (:u, :c, :d::date, 'ejemplo', :tema, :texto, :media)
           ON CONFLICT (user_id, campana_id, dia) DO UPDATE
             SET estado = 'ejemplo', tema = :tema, texto = :texto,
                 media_key = :media, error = NULL, actualizado = now()
           WHERE mix_corridas.estado IN {EJEMPLO_VIVO}""",
        {"u": user_id, "c": campana_id, "d": dia, "tema": tema,
         "texto": texto, "media": media_key})


def mix_anotar_devolucion(user_id: str, id_: str, creditos: int) -> None:
    """Deja escrito en la campaña lo que se devolvió. No es el libro mayor —ese
    es monedero_movimientos— pero es lo que la pantalla puede enseñar sin
    cruzar dos tablas, y el recibo que queda cuando alguien pregunta por qué le
    cobraron 70 y le volvieron 50."""
    ejecutar("UPDATE mix_campanas SET creditos_devueltos = creditos_devueltos + :n, "
             "actualizado = now() WHERE user_id = :u AND id = :i",
             {"u": user_id, "i": id_, "n": int(creditos)})


def mix_campana_de(user_id: str, id_: str) -> dict | None:
    """La campaña por id, viva o no. El reloj la necesita así: entre que
    despacha el día y lo corre, el usuario pudo apagarla."""
    filas = ejecutar(
        "SELECT * FROM mix_campanas WHERE user_id = :u AND id = :i",
        {"u": user_id, "i": id_})
    return filas[0] if filas else None


def mix_encendidas() -> list[dict]:
    """TODAS las campañas encendidas, de todos los usuarios.

    Es la única consulta de MIX sin user_id, y tiene que serlo: el reloj no
    atiende un request, así que no hay «usuario actual» — `usuario_actual()`
    caería al piloto y publicaría una sola campaña, la equivocada, sin que
    nadie viera un error. Van las pausadas también: no publican, pero cuando
    se les pasa la fecha hay que cerrarlas igual para que el usuario pueda
    crear otra."""
    return ejecutar(
        "SELECT user_id, id, hora, zona, empieza, termina, estado, "
        "creditos_cobrados, creditos_devueltos FROM mix_campanas "
        "WHERE estado IN ('activa', 'pausada') ORDER BY user_id, id")


def mix_dias_tomados(desde: str) -> list[dict]:
    """Los días ya reclamados desde una fecha, de todos los usuarios.

    Con esto el reloj sabe de una sola consulta qué campañas ya publicaron hoy.
    No es lo que impide publicar dos veces —eso es el PRIMARY KEY— sino lo que
    evita despachar cada hora un trabajo que solo va a perder el candado: con
    182 campañas serían más de cuatro mil arranques al día para nada."""
    return ejecutar(
        "SELECT user_id, campana_id, dia, estado FROM mix_corridas "
        "WHERE dia >= :d::date", {"d": desde})


def mix_corridas_colgadas(minutos: int = 60) -> list[dict]:
    """Corridas reclamadas que nunca se cerraron.

    La Lambda que corre un día muere a los quince minutos como mucho, así que
    una corrida que lleva una hora 'corriendo' no va lenta: está muerta. Nadie
    la va a reintentar —el candado del día ya está puesto— y ese día se cobró
    por adelantado, así que sin esto el usuario paga una publicación que no
    existe y no hay nadie mirando."""
    # `:m::int` no es adorno. El Data API tipa los parámetros y manda todo int
    # de Python como bigint (`_param`), y make_interval solo existe con int4:
    # la resolución de funciones de Postgres únicamente usa casts implícitos, y
    # bigint→int4 es de asignación. Sin el cast, esta consulta responde
    # «function make_interval(mins => bigint) does not exist» — y como es lo
    # PRIMERO que hace el reloj, se caería entero cada hora, con las campañas
    # ya cobradas y sin publicar una sola vez.
    return ejecutar(
        "SELECT user_id, campana_id, dia FROM mix_corridas "
        "WHERE estado = 'corriendo' "
        "AND actualizado < now() - make_interval(mins => :m::int)",
        {"m": int(minutos)})


def mix_pausar(user_id: str, id_: str, nota: str) -> bool:
    """activa → pausada, con el motivo escrito para que la pantalla lo diga.

    Pausar no es cosmético: si la cuenta de Blotato se desconectó, cada día
    siguiente gastaría una imagen de verdad (dinero nuestro) para fallar al
    final. Mejor parar y decirlo."""
    filas = ejecutar(
        """UPDATE mix_campanas SET estado = 'pausada', nota = :n,
                  actualizado = now()
            WHERE user_id = :u AND id = :i AND estado = 'activa'
        RETURNING id""",
        {"u": user_id, "i": id_, "n": nota[:500]})
    return bool(filas)


def mix_reanudar(user_id: str, id_: str) -> bool:
    """pausada → activa. Sin esto, una campaña que MIX pausó sola no tiene
    salida: el usuario arregla lo que la paró y sigue sin publicar."""
    filas = ejecutar(
        """UPDATE mix_campanas SET estado = 'activa', nota = NULL,
                  actualizado = now()
            WHERE user_id = :u AND id = :i AND estado = 'pausada'
        RETURNING id""",
        {"u": user_id, "i": id_})
    return bool(filas)


def mix_ultima(user_id: str) -> dict | None:
    """La última campaña que YA no está viva (terminada o cancelada).

    Cuando el reloj cierra una campaña vencida, `mix_campana` deja de verla y
    la pantalla vuelve al formulario en blanco: el dueño abre MIX y no queda ni
    rastro de lo que pagó. Con esto se le puede decir cómo acabó."""
    filas = ejecutar(
        f"SELECT id, empieza, termina, estado, creditos_cobrados, "
        f"creditos_devueltos FROM mix_campanas WHERE user_id = :u "
        f"AND estado NOT IN {_VIVA} ORDER BY actualizado DESC LIMIT 1",
        {"u": user_id})
    return filas[0] if filas else None


# ---------------------------------------------------------------------------
# RAG·3 — corridas públicas de /automatiza. Aquí no hay user_id en ninguna
# parte: estas funciones son las ÚNICAS que el camino público toca en la base,
# y ninguna llama usuario_actual() (el candado de RAG·1 reventaría).

# recibida → en_fila → armando → listo | sin_cobertura | no_salio;
# rechazada sale directo de recibida (moderación, largo, tope)
ESTADOS_AUTOMATIZA = ("recibida", "en_fila", "armando", "listo",
                      "sin_cobertura", "no_salio", "rechazada")
TERMINALES_AUTOMATIZA = ("listo", "sin_cobertura", "no_salio", "rechazada")
ORIGEN_AUTOMATIZA = ("referrer", "utm_source", "utm_medium", "utm_campaign",
                     "utm_content")
# lo que el worker puede anotar; es lista blanca porque el nombre de la
# columna va pegado al SQL
ANOTABLES_AUTOMATIZA = ("idioma", "motivo", "cache_acerto", "validador_ok",
                        "validador_motivo", "reintentos", "resultado_key",
                        "guia_key", "modelo", "costo_usd", "traza",
                        "correo_enviado", "envio_id", "envio_error")
# el Data API manda los textos como varchar y Postgres no los asigna solo a
# una fecha o a numeric: esas columnas llevan su cast en el SQL
_CAST_AUTOMATIZA = {"correo_enviado": "::timestamptz", "costo_usd": "::numeric"}
_TOPE_ORIGEN = 500          # un referrer o un utm no necesitan más
# RAG·11 — los pasos que ve el visitante mientras se arma, en orden. También
# es lista blanca: el valor va a una columna que la página pinta tal cual.
PASOS_AUTOMATIZA = ("entender", "buscar", "armar", "revisar")


def automatiza_crear(texto: str, *, ip_hash: str | None = None,
                     origen: dict | None = None,
                     aviso_version: str | None = None) -> dict:
    """Guarda lo que pidió el visitante TAL CUAL y devuelve {id, publico_id}.

    El texto no se recorta ni se limpia aquí: los topes de largo son de
    RAG·7 y van antes; lo que llegue hasta aquí se guarda entero.

    `aviso_version`: el aviso de privacidad que aceptó antes de mandarlo
    (RAG·13). Si el API nuevo llega antes que db_migrate y la columna todavía
    no existe, se guarda sin ella (y se avisa en el log) en vez de tumbar
    «Armar mi flujo»: la versión vigente queda también en el código del deploy."""
    import secrets
    origen = origen or {}
    datos = {k: (str(origen[k])[:_TOPE_ORIGEN] if origen.get(k) else None)
             for k in ORIGEN_AUTOMATIZA}
    datos.update(p=secrets.token_urlsafe(12), t=texto, ip=ip_hash)
    columnas = ", ".join(ORIGEN_AUTOMATIZA)
    valores = ", ".join(f":{k}" for k in ORIGEN_AUTOMATIZA)
    if aviso_version is not None:
        try:
            filas = ejecutar(
                f"INSERT INTO automatiza_corridas (publico_id, texto, ip_hash, {columnas}, "
                f"aviso_version) VALUES (:p, :t, :ip, {valores}, :v) RETURNING id, publico_id",
                {**datos, "v": aviso_version})
            return filas[0]
        except Exception as e:  # noqa: BLE001 — solo se perdona la columna que falta
            if not _falta_columna(e, "aviso_version"):
                raise
            logging.getLogger(__name__).warning(
                "automatiza_corridas.aviso_version no existe: corre tools/db_migrate.py")
    filas = ejecutar(
        f"INSERT INTO automatiza_corridas (publico_id, texto, ip_hash, {columnas}) "
        f"VALUES (:p, :t, :ip, {valores}) RETURNING id, publico_id", datos)
    return filas[0]


def automatiza_corrida(publico_id: str) -> dict | None:
    """La corrida por su id público (lo único que el visitante conoce).

    Trae también lo que la espera necesita en UNA sola vuelta a la base (la
    página la sondea): el paso (RAG·11), cuántos segundos lleva desde que se
    creó —medidos con el reloj de la base, no con el de la Lambda— y el
    correo vigente (RAG·12), que el API enmascara antes de enseñarlo.

    El paso se lee con to_jsonb(c) y no como c.paso: si el API nuevo llega
    antes que db_migrate, la columna todavía no existe y esto devuelve NULL
    (la página lo pinta como «entender») en vez de un 500 en cada sondeo."""
    filas = ejecutar(
        "SELECT c.id, c.publico_id, c.estado, c.motivo, to_jsonb(c)->>'paso' AS paso, "
        "c.en_fila_desde, "
        "c.empezo, c.termino, array_to_json(c.nodos)::text AS nodos, "
        "c.resultado::text AS resultado, c.resultado_key, c.guia_key, c.creado, "
        "GREATEST(0, floor(extract(epoch FROM now() - c.creado)))::bigint AS lleva_seg, "
        "(SELECT k.correo FROM automatiza_contactos k WHERE k.corrida_id = c.id "
        " ORDER BY k.id DESC LIMIT 1) AS correo "
        "FROM automatiza_corridas c WHERE c.publico_id = :p",
        {"p": publico_id})
    if not filas:
        return None
    fila = filas[0]
    # jsonb y text[] se piden como texto: el Data API no los devuelve solos
    for k in ("resultado", "nodos"):
        fila[k] = json.loads(fila[k]) if fila.get(k) else None
    return fila


def automatiza_a_fila(id_: int) -> bool:
    """recibida → en_fila. La hora de entrada es la que ordena el «lugar N»."""
    filas = ejecutar(
        """UPDATE automatiza_corridas
              SET estado = 'en_fila', en_fila_desde = now(), actualizado = now()
            WHERE id = :i AND estado = 'recibida'
        RETURNING id""", {"i": id_})
    return bool(filas)


# El worker público corta a los 5 min y su cola no reentrega antes de 6
# (infra/stacks/jobs.py): una corrida en «armando» con más de esto es de un
# worker que murió a medias, no de uno que sigue trabajando.
RETOMAR_AUTOMATIZA_MIN = 6


def automatiza_tomar(id_: int) -> bool:
    """en_fila → armando. UPDATE condicionado: si SQS entrega el mensaje dos
    veces, solo un worker gana la corrida.

    También retoma una que se quedó en «armando» más de RETOMAR_AUTOMATIZA_MIN:
    sin eso, un worker que muere a la mitad (timeout, la base despertando)
    deja la corrida colgada para siempre y el reintento de SQS no la puede
    tomar.

    El paso NO se toca aquí: lo reinicia el primer _paso("entender") del
    worker, que corre justo después, así que quien retoma no hereda el
    «revisar» del que murió. Y esta sentencia no depende de la columna: si el
    worker nuevo llega antes que db_migrate, tomar no revienta y las corridas
    no se quedan en la fila para siempre (anotar el paso sí falla, pero es
    cosmético y el worker sigue)."""
    filas = ejecutar(
        f"""UPDATE automatiza_corridas
              SET estado = 'armando', empezo = now(), actualizado = now(),
                  reintentos = reintentos + CASE WHEN estado = 'armando' THEN 1 ELSE 0 END
            WHERE id = :i AND (estado = 'en_fila'
               OR (estado = 'armando'
                   AND empezo < now() - interval '{RETOMAR_AUTOMATIZA_MIN} minutes'))
        RETURNING id""", {"i": id_})
    return bool(filas)


def automatiza_paso(id_: int, paso: str) -> bool:
    """Anota en qué paso del armado va (RAG·11). Solo si sigue en «armando»:
    un worker lento no puede pintarle «armar» a una corrida que ya cerró."""
    if paso not in PASOS_AUTOMATIZA:
        raise ValueError(f"paso desconocido: {paso}")
    filas = ejecutar(
        """UPDATE automatiza_corridas SET paso = :p, actualizado = now()
            WHERE id = :i AND estado = 'armando'
        RETURNING id""", {"i": id_, "p": paso})
    return bool(filas)


def automatiza_cerrar(id_: int, estado: str, *, resultado: dict | None = None,
                      nodos: list[str] | None = None, motivo: str | None = None) -> bool:
    """Deja la corrida en un estado final. Una corrida cerrada no se reabre:
    lo que se guardó es lo que vio el visitante."""
    if estado not in TERMINALES_AUTOMATIZA:
        raise ValueError(f"estado final inválido: {estado}")
    filas = ejecutar(
        """UPDATE automatiza_corridas
              SET estado = :e, termino = now(), actualizado = now(),
                  motivo = COALESCE(:m, motivo),
                  resultado = COALESCE(:r::jsonb, resultado),
                  nodos = CASE WHEN :n::jsonb IS NULL THEN nodos
                          ELSE ARRAY(SELECT jsonb_array_elements_text(:n::jsonb)) END
            WHERE id = :i AND estado NOT IN ('listo', 'sin_cobertura', 'no_salio', 'rechazada')
        RETURNING id""",
        {"i": id_, "e": estado, "m": motivo, "r": resultado,
         "n": nodos})
    return bool(filas)


def automatiza_anotar(id_: int, **campos) -> None:
    """Anota métricas sueltas de la corrida (caché, validador, coste, envío…)."""
    malos = set(campos) - set(ANOTABLES_AUTOMATIZA)
    if malos:
        raise ValueError(f"campos no anotables: {sorted(malos)}")
    if not campos:
        return
    sets = ", ".join(f"{k} = :{k}{_CAST_AUTOMATIZA.get(k, '')}" for k in campos)
    ejecutar(f"UPDATE automatiza_corridas SET {sets}, actualizado = now() "
             "WHERE id = :i", {**campos, "i": id_})


def automatiza_texto(id_: int) -> str | None:
    """Lo que pidió el visitante, por id interno (lo usa el worker)."""
    filas = ejecutar("SELECT texto FROM automatiza_corridas WHERE id = :i", {"i": id_})
    return filas[0]["texto"] if filas else None


def automatiza_busqueda(id_: int, *, vector: list[float] | None, modelo: str | None,
                        catalogo: str, camino: str, detalle: dict) -> None:
    """Anota con qué se buscó (RAG·20). El vector viaja como JSON y se vuelve
    real[] en el SQL: el Data API no manda arreglos de números."""
    ejecutar(
        """UPDATE automatiza_corridas
              SET peticion_vector = CASE WHEN :v::jsonb IS NULL THEN NULL ELSE
                      ARRAY(SELECT x::real FROM jsonb_array_elements_text(:v::jsonb) x) END,
                  peticion_modelo = :m, catalogo_version = :c,
                  busqueda_camino = :k, busqueda = :d::jsonb, actualizado = now()
            WHERE id = :i""",
        {"i": id_, "v": vector, "m": modelo, "c": catalogo, "k": camino, "d": detalle})


def automatiza_lugar(id_: int) -> int | None:
    """Su lugar en la fila (1 = la siguiente), o None si ya no está en fila."""
    filas = ejecutar(
        """SELECT count(*) AS lugar FROM automatiza_corridas f,
                  automatiza_corridas yo
            WHERE yo.id = :i AND yo.estado = 'en_fila'
              AND f.estado = 'en_fila' AND f.en_fila_desde <= yo.en_fila_desde""",
        {"i": id_})
    lugar = int(filas[0]["lugar"]) if filas else 0
    return lugar or None


def automatiza_descargo(publico_id: str, que: str) -> None:
    """Cuenta una descarga; la hora que se guarda es la de la PRIMERA."""
    columna = {"json": "descargo_json", "guia": "descargo_guia"}.get(que)
    if not columna:
        raise ValueError(f"descarga desconocida: {que}")
    ejecutar(f"UPDATE automatiza_corridas SET {columna} = COALESCE({columna}, now()), "
             "descargas = descargas + 1, actualizado = now() WHERE publico_id = :p",
             {"p": publico_id})


def automatiza_reportar(publico_id: str, reporte: str) -> None:
    """El botón «no me sirvió» (RAG·25). Se queda el primero."""
    ejecutar("UPDATE automatiza_corridas SET reportado = COALESCE(reportado, now()), "
             "reporte = COALESCE(reporte, :r), actualizado = now() "
             "WHERE publico_id = :p", {"p": publico_id, "r": reporte[:2000]})


def automatiza_guardar_correo(id_: int, correo: str, *, origen: str,
                              recontacto: bool = False,
                              recontacto_texto: str | None = None,
                              aviso_version: str | None = None,
                              tope: int | None = None) -> bool:
    """Agrega (nunca edita) el correo de la corrida con la prueba del
    consentimiento: si marcó la casilla aparte, qué decía y qué aviso regía.

    Con `tope`, solo si la corrida lleva menos de `tope` correos; devuelve si
    lo guardó. La cuenta y el INSERT van en UNA sentencia: el UPDATE toma el
    candado de la fila de la corrida, así que las peticiones simultáneas pasan
    de una en una y Postgres vuelve a mirar `correos < :tope` con el valor
    que dejó la anterior. (Un INSERT…SELECT con count(*) NO bastaría: con READ
    COMMITTED el count(*) no ve lo que las otras insertaron.)"""
    valores = {"i": id_, "c": correo.strip(), "o": origen, "r": bool(recontacto),
               "t": recontacto_texto if recontacto else None, "v": aviso_version}
    columnas = "corrida_id, correo, origen, recontacto, recontacto_texto, aviso_version"
    if tope is not None:
        try:
            filas = ejecutar(
                f"""WITH turno AS (
                        UPDATE automatiza_corridas SET correos = correos + 1
                         WHERE id = :i AND correos < :tope RETURNING id)
                    INSERT INTO automatiza_contactos ({columnas})
                    SELECT id, :c, :o, :r, :t, :v FROM turno RETURNING id""",
                {**valores, "tope": tope})
            return bool(filas)
        except Exception as e:  # noqa: BLE001 — solo se perdona la columna que falta
            if not _falta_columna(e, "correos"):
                raise
            # el API nuevo llegó antes que db_migrate: el tope de antes (contar
            # y luego guardar), blando pero sin tumbar «Mandármelo y descargar»
            logging.getLogger(__name__).warning(
                "automatiza_corridas.correos no existe: corre tools/db_migrate.py")
            if automatiza_correos_de(id_) >= tope:
                return False
    ejecutar(f"INSERT INTO automatiza_contactos ({columnas}) "
             "VALUES (:i, :c, :o, :r, :t, :v)", valores)
    return True


def _falta_columna(e: Exception, columna: str) -> bool:
    """¿El error es que `columna` todavía no existe? (el Data API lo manda como
    BadRequestException con el mensaje de Postgres; psycopg, como UndefinedColumn)."""
    texto = f"{type(e).__name__} {e}".lower()
    return f'"{columna}"' in texto and ("does not exist" in texto or "undefinedcolumn" in texto)


def automatiza_correo(id_: int) -> dict | None:
    """El correo vigente de la corrida: la última fila que dejó."""
    filas = ejecutar(
        "SELECT correo, origen, recontacto, creado FROM automatiza_contactos "
        "WHERE corrida_id = :i ORDER BY id DESC LIMIT 1", {"i": id_})
    return filas[0] if filas else None


def automatiza_correos_de(id_: int) -> int:
    """Cuántas veces se dejó o cambió el correo de la corrida: el tope contra
    abuso de POST /api/publico/corridas/{id}/correo (RAG·12)."""
    filas = ejecutar("SELECT count(*) AS n FROM automatiza_contactos "
                     "WHERE corrida_id = :i", {"i": id_})
    return int(filas[0]["n"]) if filas else 0



# ---------------------------------------------------------------------------
# RAG·5 — interruptor y consumo del día de /automatiza

# El día de la ventana es el de México, no el de UTC: con UTC el cupo se
# reiniciaría a las 6 de la tarde, en plena hora de uso.
ZONA_AUTOMATIZA = "America/Mexico_City"


def automatiza_interruptor() -> dict | None:
    """La fila vigente del interruptor (la última), o None si nunca se puso."""
    filas = ejecutar(
        "SELECT encendido, tope_corridas, tope_usd::text AS tope_usd, tope_por_ip, "
        "nota, creado "
        "FROM automatiza_interruptor ORDER BY id DESC LIMIT 1")
    if not filas:
        return None
    fila = filas[0]
    fila["tope_usd"] = float(fila["tope_usd"]) if fila.get("tope_usd") else None
    return fila


def automatiza_ajustar(*, encendido: bool | None = None,
                       tope_corridas: int | None = None,
                       tope_usd: float | None = None,
                       sin_tope_usd: bool = False,
                       tope_por_ip: int | None = None,
                       nota: str | None = None) -> dict:
    """Agrega una fila nueva: lo que no se pasa se hereda de la vigente.
    Sin fila previa, lo no dicho queda apagado y sin tope."""
    vigente = automatiza_interruptor() or {"encendido": False, "tope_corridas": None,
                                            "tope_usd": None, "tope_por_ip": None}
    nueva = {
        "e": vigente["encendido"] if encendido is None else bool(encendido),
        "c": vigente["tope_corridas"] if tope_corridas is None else int(tope_corridas),
        "u": None if sin_tope_usd else (vigente["tope_usd"] if tope_usd is None else float(tope_usd)),
        "i": vigente.get("tope_por_ip") if tope_por_ip is None else int(tope_por_ip),
        "n": nota,
    }
    ejecutar("INSERT INTO automatiza_interruptor "
             "(encendido, tope_corridas, tope_usd, tope_por_ip, nota) "
             "VALUES (:e, :c, :u::numeric, :i, :n)", nueva)
    return automatiza_interruptor()


def automatiza_consumo_hoy() -> dict:
    """Corridas aceptadas hoy (hora de México) y su gasto REAL anotado.

    Las rechazadas no cuentan: no se armaron. (Su moderación sí costó; esa
    la frena el tope por IP, que sí las cuenta.)
    El gasto es solo el que ya se anotó (costo_usd, RAG·24): aquí no se
    inventa ningún precio."""
    filas = ejecutar(
        f"""SELECT count(*) AS corridas, COALESCE(sum(costo_usd), 0)::text AS usd
              FROM automatiza_corridas
             WHERE estado <> 'rechazada'
               AND creado >= date_trunc('day', now() AT TIME ZONE '{ZONA_AUTOMATIZA}')
                             AT TIME ZONE '{ZONA_AUTOMATIZA}'""")
    fila = filas[0] if filas else {"corridas": 0, "usd": "0"}
    return {"corridas": int(fila["corridas"]), "usd": float(fila["usd"] or 0)}


def automatiza_corridas_recientes(dias: int = 1) -> list[dict]:
    """RAG·24 — las corridas armadas de los últimos `dias` (sin las
    rechazadas) con lo que hace falta para medir costo y tiempo: el uso
    guardado (`resultado.uso`), intentos, modelo y cuánto tardó el worker.
    Para tools/automatiza.py; nunca devuelve el texto ni el flujo."""
    return ejecutar(
        f"""SELECT id, estado, modelo, resultado->>'intentos' AS intentos,
                   (resultado->'uso')::text AS uso,
                   EXTRACT(EPOCH FROM (termino - empezo))::text AS seg,
                   to_char(creado AT TIME ZONE '{ZONA_AUTOMATIZA}', 'MM-DD HH24:MI') AS creado
              FROM automatiza_corridas
             WHERE estado <> 'rechazada'
               AND creado >= now() - make_interval(days => :d)
             ORDER BY id""", {"d": int(dias)})


def automatiza_corridas_de_ip_hoy(ip_hash: str) -> int:
    """Corridas de hoy (hora de México) desde la misma IP hasheada, CON las
    rechazadas: desde RAG·7 una rechazada ya costó una llamada de moderación,
    y sin contarlas un bot podría repetir textos rechazados sin tope. (El
    tope global sí las excluye: ese mide lo que se armó.)"""
    filas = ejecutar(
        f"""SELECT count(*) AS n FROM automatiza_corridas
             WHERE ip_hash = :h
               AND creado >= date_trunc('day', now() AT TIME ZONE '{ZONA_AUTOMATIZA}')
                             AT TIME ZONE '{ZONA_AUTOMATIZA}'""", {"h": ip_hash})
    return int(filas[0]["n"]) if filas else 0
