"""M6 — dashboard de costes (admin): margen por usuario y costo por corrida.

El insumo de los focus groups: cuánto costó exactamente cada usuario y cada
sesión de prueba. Acceso solo para el grupo `admin` de Cognito (el middleware
de M2 ya validó el token; aquí se exige el grupo — en dev local sin Cognito el
dueño es admin). Miembros por CLI: `tools/usuarios.py admin <correo>`.

La verdad viene de tres tablas de Postgres (todas indexadas por user_id):
  monedero / monedero_movimientos  →  créditos (saldo, cortesía, compras, cargos)
  costes                           →  dólares de inferencia (sync de Langfuse)
  proyectos_gen                    →  películas
Más S3 (bytes por prefijo work/{user}/) y el margen = créditos cobrados ×
piso de venta (tarifas.json) − costo directo. Desde M6.1 el costo incluye la
línea estimada de infra por corrida (Fargate/Lambda), y de esas mismas filas
se deriva el TIEMPO de cómputo (costo ÷ tarifa de pricing.json — sin columna
nueva y retroactivo). Aurora es base COMPARTIDA: su costo real del mes se mide
en CloudWatch (horas-ACU × pricing.json) y se prorratea por la actividad
registrada de cada usuario en el mes — es informativo, no entra al margen.
CloudFront/ECR siguen solo en Cost Explorer.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException

from pipeline import costes_infra, creditos, db
from server import auth

log = logging.getLogger("admin")
router = APIRouter()

# Nombres para ids sin fila en `usuarios`: "?" son las trazas previas a C6
# (cuando Langfuse aún no llevaba user_id) — nuestras corridas de desarrollo
# con Claude. Decisión del usuario 2026-09-04: mostrarlas como "Claude IA".
ALIAS = {"?": "Claude IA (desarrollo)"}


def _exigir_admin() -> None:
    if not auth.es_admin():
        raise HTTPException(403, "Solo para administradores")
    if db.backend() != "postgres":
        # dev local con estado en json: no hay tablas que consultar
        raise HTTPException(503, "El dashboard lee Postgres — solo aplica en el servicio en AWS")


def _bytes_s3_por_usuario() -> dict[str, int]:
    """Bytes bajo work/{user}/ — con pocos usuarios el listado completo es
    barato; si algún día pesa, se cachea o se mueve a S3 Inventory."""
    bucket = os.getenv("MEDIA_BUCKET", "")
    if not bucket:
        return {}
    try:
        import boto3
        s3 = boto3.client("s3")
        por_usuario: dict[str, int] = {}
        pag = s3.get_paginator("list_objects_v2")
        for pagina in pag.paginate(Bucket=bucket, Prefix="work/"):
            for obj in pagina.get("Contents", []):
                partes = obj["Key"].split("/")
                if len(partes) > 2:
                    por_usuario[partes[1]] = por_usuario.get(partes[1], 0) + obj["Size"]
        return por_usuario
    except Exception as err:  # noqa: BLE001 — el dashboard vive sin esta columna
        log.warning("no se pudo listar S3: %s", err)
        return {}


def _aurora_mes() -> dict | None:
    """Costo REAL de Aurora en lo que va del mes: horas-ACU medidas por
    CloudWatch (ServerlessDatabaseCapacity, promedio por hora) × la tarifa de
    pricing.json. Es la base compartida — no hay atribución directa por
    usuario, así que el resumen la prorratea por la actividad registrada."""
    arn = os.getenv("DB_CLUSTER_ARN", "")
    if not arn:
        return None
    try:
        from datetime import datetime, timezone

        import boto3
        ahora = datetime.now(timezone.utc)
        inicio = ahora.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        datos = boto3.client("cloudwatch").get_metric_statistics(
            Namespace="AWS/RDS", MetricName="ServerlessDatabaseCapacity",
            Dimensions=[{"Name": "DBClusterIdentifier", "Value": arn.rsplit(":", 1)[-1]}],
            StartTime=inicio, EndTime=ahora, Period=3600, Statistics=["Average"])
        acu_horas = sum(p["Average"] for p in datos["Datapoints"])
        return {"acu_horas": round(acu_horas, 2),
                "usd": round(acu_horas * costes_infra.AURORA_USD_ACU_HORA, 4)}
    except Exception as err:  # noqa: BLE001 — el dashboard vive sin esta fila
        log.warning("no se pudo medir Aurora en CloudWatch: %s", err)
        return None


@router.get("/api/admin/resumen")
def resumen():
    _exigir_admin()
    movs = db.ejecutar(
        """SELECT user_id,
                  COALESCE(SUM(CASE WHEN tipo = 'cargo' THEN -creditos ELSE 0 END), 0) AS cargos,
                  COALESCE(SUM(CASE WHEN tipo = 'devolucion' THEN creditos ELSE 0 END), 0) AS devoluciones,
                  COALESCE(SUM(CASE WHEN tipo = 'compra' THEN creditos ELSE 0 END), 0) AS comprados,
                  COALESCE(SUM(CASE WHEN tipo = 'cortesia' THEN creditos ELSE 0 END), 0) AS cortesia
           FROM monedero_movimientos GROUP BY user_id""")
    saldos = {f["user_id"]: f["saldo"] for f in db.ejecutar("SELECT user_id, saldo FROM monedero")}
    pelis = {f["user_id"]: f["n"] for f in db.ejecutar(
        "SELECT user_id, count(*) AS n FROM proyectos_gen GROUP BY user_id")}
    # por concepto: el total va al costo directo y de los conceptos de infra
    # se deriva el tiempo de cómputo en Fargate (costo ÷ tarifa)
    costos: dict[str, float] = {}
    # desglose para la vista de Costos: infra AWS (conceptos "infra-*") vs IA,
    # y la IA por vendor (openai / fal / claude — el sync desglosa por el
    # modelo de cada generation; lo sincronizado antes queda sin vendor)
    costos_aws: dict[str, float] = {}
    costos_prov: dict[str, dict[str, float]] = {}
    fargate_s: dict[str, float] = {}
    for f in db.ejecutar(
            "SELECT user_id, concepto, proveedor, SUM(costo_usd) AS usd "
            "FROM costes GROUP BY user_id, concepto, proveedor"):
        u, usd = f["user_id"], float(f["usd"])
        costos[u] = costos.get(u, 0.0) + usd
        concepto = f.get("concepto") or ""
        if concepto.startswith("infra-"):
            costos_aws[u] = costos_aws.get(u, 0.0) + usd
        else:
            prov = f.get("proveedor") or "langfuse"
            if prov not in ("openai", "fal", "claude"):
                prov = "otros"   # filas de antes del desglose (proveedor 'langfuse')
            d = costos_prov.setdefault(u, {})
            d[prov] = d.get(prov, 0.0) + usd
        if concepto in costes_infra.CONCEPTOS_FARGATE:
            fargate_s[u] = fargate_s.get(u, 0.0) + \
                (costes_infra.segundos_estimados(f["concepto"], usd) or 0.0)
    emails = {f["id"]: f["email"] for f in db.ejecutar("SELECT id, email FROM usuarios")}
    s3 = _bytes_s3_por_usuario()

    # Aurora del MES: costo real medido, prorrateado por la parte de cada
    # usuario en los costes registrados del mes (quien no corrió nada, 0)
    aurora = _aurora_mes()
    aurora_por_usuario: dict[str, float] = {}
    if aurora and aurora["usd"] > 0:
        mes = db.ejecutar(
            "SELECT user_id, SUM(costo_usd) AS usd FROM costes "
            "WHERE creado >= date_trunc('month', now()) GROUP BY user_id")
        total_mes = sum(float(f["usd"]) for f in mes)
        if total_mes > 0:
            aurora_por_usuario = {f["user_id"]: round(aurora["usd"] * float(f["usd"]) / total_mes, 4)
                                  for f in mes}

    todos = sorted(set().union((f["user_id"] for f in movs), saldos, pelis, costos))
    por_mov = {f["user_id"]: f for f in movs}
    usuarios = []
    for u in todos:
        m = por_mov.get(u, {})
        # neto realmente quemado por el usuario: cargos menos devoluciones
        gastados = int(m.get("cargos") or 0) - int(m.get("devoluciones") or 0)
        costo = round(costos.get(u, 0.0), 4)
        aws = round(costos_aws.get(u, 0.0), 4)
        usuarios.append({
            "user_id": u, "email": emails.get(u) or ALIAS.get(u),
            "saldo": int(saldos.get(u, 0)),
            "cortesia": int(m.get("cortesia") or 0),
            "comprados": int(m.get("comprados") or 0),
            "gastados": gastados,
            "peliculas": int(pelis.get(u, 0)),
            "s3_bytes": s3.get(u),
            "fargate_s": round(fargate_s.get(u, 0.0)),
            "costo_usd": costo,
            "costo_aws_usd": aws,
            "aurora_usd": aurora_por_usuario.get(u, 0.0),
            "costo_ia_usd": round(costo - aws, 4),
            "costo_ia_prov": {p: round(v, 4)
                              for p, v in (costos_prov.get(u) or {}).items()},
            "ingresos_usd": round(gastados * creditos.PISO_VENTA_USD, 4),
            # créditos cobrados a valor de venta menos lo que nos costó la IA
            "margen_usd": round(gastados * creditos.PISO_VENTA_USD - costo, 4),
        })
    usuarios.sort(key=lambda x: -x["costo_usd"])
    return {
        "usuarios": usuarios,
        "aurora": aurora,   # {acu_horas, usd} del mes, o null si no se pudo medir
        "piso_venta_usd": creditos.PISO_VENTA_USD,
        "totales": {
            "costo_usd": round(sum(u["costo_usd"] for u in usuarios), 4),
            "costo_aws_usd": round(sum(u["costo_aws_usd"] for u in usuarios), 4),
            "costo_ia_usd": round(sum(u["costo_ia_usd"] for u in usuarios), 4),
            "costo_ia_prov": {p: round(sum(u["costo_ia_prov"].get(p, 0.0)
                                           for u in usuarios), 4)
                              for p in ("openai", "fal", "claude", "otros")},
            "ingresos_usd": round(sum(u["ingresos_usd"] for u in usuarios), 4),
            "margen_usd": round(sum(u["margen_usd"] for u in usuarios), 4),
            "gastados": sum(u["gastados"] for u in usuarios),
            "peliculas": sum(u["peliculas"] for u in usuarios),
            "fargate_s": sum(u["fargate_s"] for u in usuarios),
        },
        "langfuse_base": os.getenv("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com").rstrip("/"),
    }


@router.get("/api/admin/usuarios/{uid}")
def detalle_usuario(uid: str):
    """Drill-down por corrida: cada proyecto con sus créditos netos cobrados,
    su costo real en dólares y las trazas (enlazables a Langfuse)."""
    _exigir_admin()
    proyectos = db.ejecutar(
        """SELECT id, creado, estado, brief, doc->>'duracion_s' AS duracion_s
           FROM proyectos_gen WHERE user_id = :u ORDER BY creado DESC""", {"u": uid})
    # la referencia de los cargos es "preparar:{id}" / "producir:{id}" / "imagen:{id}"
    cobrados = {f["pid"]: int(f["neto"]) for f in db.ejecutar(
        """SELECT split_part(referencia, ':', 2) AS pid, SUM(-creditos) AS neto
           FROM monedero_movimientos
           WHERE user_id = :u AND tipo IN ('cargo', 'devolucion')
             AND referencia LIKE '%:%'
           GROUP BY 1""", {"u": uid})}
    trazas = db.ejecutar(
        """SELECT proyecto_id, concepto, costo_usd, traza, creado
           FROM costes WHERE user_id = :u ORDER BY creado DESC LIMIT 300""", {"u": uid})
    por_proyecto: dict[str, list] = {}
    for t in trazas:
        costo_t = float(t["costo_usd"])
        por_proyecto.setdefault(t["proyecto_id"] or "?", []).append(
            {"concepto": t["concepto"], "costo_usd": costo_t,
             # líneas de infra: el tiempo de cómputo que implicó esta tarea
             "segundos": costes_infra.segundos_estimados(t["concepto"], costo_t),
             "traza": t["traza"], "creado": t["creado"]})
    return {
        "user_id": uid,
        "proyectos": [{
            **p, "creditos": cobrados.get(p["id"], 0),
            "costo_usd": round(sum(x["costo_usd"] for x in por_proyecto.get(p["id"], [])), 4),
            "trazas": por_proyecto.get(p["id"], []),
        } for p in proyectos],
        "sin_proyecto": por_proyecto.get("?", []),
        "langfuse_base": os.getenv("LANGFUSE_BASE_URL", "https://us.cloud.langfuse.com").rstrip("/"),
    }


@router.post("/api/admin/costes/sync")
def sync_costes(dias: int = 7):
    """El botón "sincronizar ahora" del dashboard (el diario corre solo por
    EventBridge en el worker). Idempotente por trace id."""
    _exigir_admin()
    try:
        from tools.costes import sincronizar
        nuevas = sincronizar(dias=min(int(dias), 90))
    except KeyError as err:
        raise HTTPException(503, f"Langfuse no configurado (falta {err})")
    except Exception as err:  # noqa: BLE001
        raise HTTPException(502, f"El sync falló: {str(err)[:200]}")
    return {"ok": True, "nuevas": nuevas}
