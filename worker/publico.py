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

RAG·11 — mientras arma, anota el paso que ve el visitante (entender → buscar
→ armar → revisar). Es cosmético: si anotarlo falla se loguea y se sigue; un
paso no puede tumbar una corrida.
"""
from __future__ import annotations

import json
import logging
import time

from worker.env_ssm import cargar_env_ssm

# SOLO las claves de lo público (capa 1): SSM_ENV_PREFIX apunta aquí al
# prefijo /publico/ del entorno, nunca al de plataforma. La base va por IAM y
# DB_SECRET_ARN; la sal del hash de IP la usa el API, no este worker.
cargar_env_ssm()

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

# RAG·11 — con el armado de mentira todo termina en un milisegundo y la espera
# saltaría de «entender» a «listo»: esta pausa por paso (~8 s en total) deja
# ver la espera avanzar en dev. Solo aplica con publico.ARMADO_DE_MENTIRA; los
# tests la ponen en 0.
PAUSA_DE_MENTIRA_SEG = 2.0


def armar(corrida: dict) -> dict:
    """Arma el flujo de la corrida. Devuelve {"flujo": ..., "nodos": [...]}
    y, con el armado real, "estado" (listo · sin_cobertura) y lo demás que
    se guarda en `resultado`."""
    from pipeline import publico as freno
    if freno.ARMADO_DE_MENTIRA:
        return {"flujo": FLUJO_DE_MENTIRA,
                "nodos": [n["type"] for n in FLUJO_DE_MENTIRA["nodes"]],
                "de_mentira": True}
    from pipeline import armado, embeddings
    a = armado.armar(corrida["texto"], corrida["consulta"], corrida["vector"],
                     embeber=embeddings.embeber, uso=corrida["uso"])
    return {"estado": a.estado, **a.como_resultado(corrida["uso"])}


def _entender(corrida_id: int, uso=None):
    """RAG·20 — (texto, consulta con que se va a buscar, vector de la
    petición). Con RAG_CAMINO=reescrita reescribe Claude (claude_rag)."""
    from pipeline import claude_rag, db, embeddings, puente
    texto = db.automatiza_texto(corrida_id)
    if not texto:
        raise ValueError("la corrida no tiene texto")
    reescribir = (claude_rag.reescritor(uso) if puente.camino_configurado() == "reescrita"
                  else None)
    consulta, vector = puente.entender(corrida_id, texto, embeber=embeddings.embeber,
                                       reescribir=reescribir)
    return texto, consulta, vector


def _cuentas(corrida_id: int, uso, *, modelo: str | None = None,
             validador_ok: bool | None = None, motivo: str | None = None) -> None:
    """RAG·24 — anota modelo, validador y costo. Cosmético para la corrida:
    si falla se loguea y se sigue."""
    from pipeline import costos_rag, db
    campos = {}
    if modelo:
        campos["modelo"] = modelo
    if validador_ok is not None:
        campos["validador_ok"] = validador_ok
        if not validador_ok and motivo:
            campos["validador_motivo"] = motivo[:500]
    costo = costos_rag.costo_usd(uso)
    if costo is not None:
        campos["costo_usd"] = costo
    try:
        db.automatiza_anotar(corrida_id, **campos)
    except Exception:  # noqa: BLE001
        log.exception("corrida %s: no se pudieron anotar las cuentas", corrida_id)


def _paso(corrida_id: int, paso: str) -> None:
    """Anota el paso y, con el armado de mentira, se queda en él un rato."""
    from pipeline import db
    from pipeline import publico as freno
    try:
        db.automatiza_paso(corrida_id, paso)
    except Exception:  # noqa: BLE001 — cosmético: la corrida sigue igual
        log.exception("corrida %s: no se pudo anotar el paso %s", corrida_id, paso)
    if freno.ARMADO_DE_MENTIRA and PAUSA_DE_MENTIRA_SEG > 0:
        time.sleep(PAUSA_DE_MENTIRA_SEG)


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
        # RAG·20: «entender» prepara la consulta y embebe la petición, pero
        # SOLO con el armado real (RAG·21 apaga ARMADO_DE_MENTIRA): con el de
        # mentira no se llama a ningún modelo. «buscar» llega con RAG·21 y
        # «revisar», el validador, con RAG·22.
        _paso(corrida_id, "entender")
        from pipeline import claude_rag, trazas_rag
        corrida = {"id": corrida_id, "uso": claude_rag.Uso()}
        with trazas_rag.corrida(corrida_id) as traza:
            return _armar_y_cerrar(corrida, traza)


def _armar_y_cerrar(corrida: dict, traza) -> str:
    """Entender → buscar → armar → revisar → cerrar, dentro de la traza."""
    from pipeline import db
    from pipeline import publico as freno
    corrida_id = corrida["id"]
    try:
        if not freno.ARMADO_DE_MENTIRA:
            corrida["texto"], corrida["consulta"], corrida["vector"] = \
                _entender(corrida_id, corrida["uso"])
        for paso in ("buscar", "armar"):
            _paso(corrida_id, paso)
        salida = armar(corrida)
    except Exception as e:  # noqa: BLE001 — cualquier fallo del armado cierra igual
        log.exception("corrida %s: no salió", corrida_id)
        _cuentas(corrida_id, corrida["uso"], validador_ok=False if
                 type(e).__name__ == "NoSalio" else None, motivo=str(e))
        traza.update(output={"estado": "no_salio", "error": f"{type(e).__name__}: {e}"[:500]},
                     metadata=_para_traza(corrida))
        db.automatiza_cerrar(corrida_id, "no_salio", motivo=f"{type(e).__name__}: {e}"[:500])
        return "no_salio"
    _paso(corrida_id, "revisar")
    estado = salida.pop("estado", "listo")
    if not salida.get("de_mentira"):
        _cuentas(corrida_id, corrida["uso"], modelo=salida.get("modelo"),
                 validador_ok=True if estado == "listo" else None)
    motivo = ("faltan: " + "; ".join(salida.get("faltan") or []))[:500] \
        if estado == "sin_cobertura" else None
    traza.update(output={"estado": estado, "nodos": salida.get("nodos"),
                         "faltan": salida.get("faltan"), "intentos": salida.get("intentos"),
                         "advertencias": salida.get("advertencias")},
                 metadata={**_para_traza(corrida), "fuentes": salida.get("fuentes"),
                           "modelo": salida.get("modelo")})
    db.automatiza_cerrar(corrida_id, estado, resultado=salida,
                         nodos=salida.get("nodos") or [], motivo=motivo)
    return estado


def _para_traza(corrida: dict) -> dict:
    """RAG·23 — lo que va a Langfuse: camino, consulta y tokens. Ni el texto
    completo ni el vector (se enmascara de todos modos en trazas_rag)."""
    c = corrida.get("consulta")
    from pipeline import puente
    return {"camino": getattr(c, "camino", None), "consulta": getattr(c, "texto", None),
            "respaldo": getattr(c, "respaldo", None),
            "catalogo": puente.version_catalogo(), "uso": corrida["uso"].total()}


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
