"""RAG·4 — worker de la tubería pública de /automatiza.

Consume SU cola (infra/stacks/jobs.py `_tuberia_publica`), no la de pago, y
corre todo dentro del candado de identidad (RAG·1): aquí no hay usuario, hay
una corrida. Por eso no importa nada de worker.lambda_worker, que carga
claves POR-USUARIO.

LA REGLA: un fallo del visitante no se relanza. Si armar el flujo truena, la
corrida se cierra como «no_salio» con su motivo y el mensaje se da por bueno:
reintentar en SQS no arregla un flujo imposible y solo gasta. Lo único que sí
se relanza es no poder escribir en la base —entonces ni siquiera quedó dicho
que falló—, y el reintento la retoma (db.automatiza_tomar).

Hoy `armar` devuelve siempre el mismo flujo de mentira: el recorrido completo
tiene que existir antes que el RAG (RAG·8). RAG·21 cambia solo esa función.
"""
from __future__ import annotations

import json
import logging

from worker.env_ssm import cargar_env_ssm

cargar_env_ssm()   # claves de PLATAFORMA; este worker no tiene otras

logging.basicConfig(level=logging.INFO, force=True)
log = logging.getLogger("worker.publico")

# Un flujo de n8n mínimo que se importa tal cual: dispara a mano y deja una
# nota. No promete nada que no haga.
FLUJO_DE_MENTIRA = {
    "name": "Flujo de prueba de /automatiza",
    "nodes": [
        {"id": "1", "name": "Al hacer clic en probar", "type": "n8n-nodes-base.manualTrigger",
         "typeVersion": 1, "position": [0, 0], "parameters": {}},
        {"id": "2", "name": "Nota", "type": "n8n-nodes-base.set",
         "typeVersion": 3.4, "position": [220, 0],
         "parameters": {"assignments": {"assignments": [
             {"id": "a", "name": "mensaje", "type": "string",
              "value": "Flujo de prueba: la tubería funciona."}]}}},
    ],
    "connections": {"Al hacer clic en probar": {"main": [[{"node": "Nota", "type": "main", "index": 0}]]}},
    "settings": {},
}


def armar(corrida: dict) -> dict:
    """Arma el flujo de la corrida. Devuelve {"flujo": ..., "nodos": [...]}."""
    return {"flujo": FLUJO_DE_MENTIRA,
            "nodos": [n["type"] for n in FLUJO_DE_MENTIRA["nodes"]],
            "de_mentira": True}


def procesar(corrida_id: int) -> str:
    """Toma, arma y cierra UNA corrida. Devuelve el estado en que la dejó."""
    from pipeline import db
    with db.camino_publico():
        if not db.automatiza_tomar(corrida_id):
            log.info("corrida %s: ya la tiene otro worker o ya terminó", corrida_id)
            return "ajena"
        # RAG·5: si el dueño apagó mientras esta corrida esperaba en la fila,
        # no se gasta en ella. Se cierra con su motivo y queda contada.
        from pipeline import publico as freno
        if not freno.encendido():
            db.automatiza_cerrar(corrida_id, "no_salio", motivo="apagado")
            return "apagado"
        try:
            salida = armar({"id": corrida_id})
        except Exception as e:  # noqa: BLE001 — cualquier fallo del armado cierra igual
            log.exception("corrida %s: no salió", corrida_id)
            db.automatiza_cerrar(corrida_id, "no_salio", motivo=f"{type(e).__name__}: {e}"[:500])
            return "no_salio"
        db.automatiza_cerrar(corrida_id, "listo", resultado=salida,
                             nodos=salida.get("nodos") or [])
        return "listo"


def handler(event, context):  # noqa: ANN001 — firma de Lambda
    for rec in event.get("Records", []):
        try:
            j = json.loads(rec["body"])
            corrida_id = int(j["corrida_id"]) if j.get("tipo") == "automatiza" else None
        except (ValueError, KeyError, TypeError):
            corrida_id = None
        if corrida_id is None:
            # un mensaje que no es nuestro no mejora reintentándolo
            log.error("mensaje ignorado: %.200s", rec.get("body"))
            continue
        log.info("corrida %s: %s", corrida_id, procesar(corrida_id))
    return {"ok": True}
