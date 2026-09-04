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
piso de venta (tarifas.json) − costo IA. La infra AWS no se atribuye por
usuario a propósito (<2% del variable): para eso está Cost Explorer.
"""
from __future__ import annotations

import logging
import os

from fastapi import APIRouter, HTTPException

from pipeline import creditos, db
from server import auth

log = logging.getLogger("admin")
router = APIRouter()


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
    costos = {f["user_id"]: float(f["usd"]) for f in db.ejecutar(
        "SELECT user_id, SUM(costo_usd) AS usd FROM costes GROUP BY user_id")}
    emails = {f["id"]: f["email"] for f in db.ejecutar("SELECT id, email FROM usuarios")}
    s3 = _bytes_s3_por_usuario()

    todos = sorted(set().union((f["user_id"] for f in movs), saldos, pelis, costos))
    por_mov = {f["user_id"]: f for f in movs}
    usuarios = []
    for u in todos:
        m = por_mov.get(u, {})
        # neto realmente quemado por el usuario: cargos menos devoluciones
        gastados = int(m.get("cargos") or 0) - int(m.get("devoluciones") or 0)
        costo = round(costos.get(u, 0.0), 4)
        usuarios.append({
            "user_id": u, "email": emails.get(u),
            "saldo": int(saldos.get(u, 0)),
            "cortesia": int(m.get("cortesia") or 0),
            "comprados": int(m.get("comprados") or 0),
            "gastados": gastados,
            "peliculas": int(pelis.get(u, 0)),
            "s3_bytes": s3.get(u),
            "costo_usd": costo,
            # créditos cobrados a valor de venta menos lo que nos costó la IA
            "margen_usd": round(gastados * creditos.PISO_VENTA_USD - costo, 4),
        })
    usuarios.sort(key=lambda x: -x["costo_usd"])
    return {
        "usuarios": usuarios,
        "piso_venta_usd": creditos.PISO_VENTA_USD,
        "totales": {
            "costo_usd": round(sum(u["costo_usd"] for u in usuarios), 4),
            "margen_usd": round(sum(u["margen_usd"] for u in usuarios), 4),
            "gastados": sum(u["gastados"] for u in usuarios),
            "peliculas": sum(u["peliculas"] for u in usuarios),
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
        por_proyecto.setdefault(t["proyecto_id"] or "?", []).append(
            {"concepto": t["concepto"], "costo_usd": float(t["costo_usd"]),
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
