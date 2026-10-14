"""RAG·26 — eval de /automatiza: qué modelo y qué camino arman mejores flujos.

    python tools/eval_rag.py ensayo                          # qué correría; no llama a nadie
    python tools/eval_rag.py correr --confirmar              # Opus 5.5 y Sonnet 5.5, camino directo
    python tools/eval_rag.py correr --confirmar --caminos directo,reescrita --solo ventas-1,ia-2

CUESTA (Claude + embeddings por cada petición × modelo × camino): sin
`--confirmar` no sale nada de la máquina. Precio: sin precio confirmado; el
reporte trae los tokens de cada corrida.

Necesita: el índice con la documentación (tools/ingesta.py subir), y las
claves de /publico/ (CLAUDE_API_KEY y la del modelo de embeddings) que lee de SSM con tus
credenciales de AWS; nunca las imprime.

LAS ENTRADAS: media/library/n8n/prueba_borrador.json (borrador para que el
dueño lo corrija). Más adelante, las peticiones reales de la tabla de
corridas (texto guardado tal cual, RAG·3/20) se pueden exportar al mismo
formato y volver a correr contra cada modelo.

QUÉ MIDE por corrida, y el resumen por modelo × camino:
    acierto_estado   salió lo esperado (listo / sin_cobertura)
    valido_1er       pasó el validador sin reintento
    cobertura_nodos  de los nodos que el flujo DEBE traer, cuántos trajo
    sin_secretos     el flujo no copió correos ni claves de la petición
    tokens, segundos

Escribe work/eval/<fecha>-<hora>.json con todo, para comparar corridas.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))

from infra import entornos  # noqa: E402
from pipeline import claude_rag, puente  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CONJUNTO = RAIZ / "media" / "library" / "n8n" / "prueba_borrador.json"
SALIDA = RAIZ / "work" / "eval"
_CORREO = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")


def conjunto(solo: list[str] | None = None) -> list[dict]:
    filas = json.loads(CONJUNTO.read_text(encoding="utf-8"))["peticiones"]
    if solo:
        faltan = set(solo) - {f["id"] for f in filas}
        if faltan:
            raise SystemExit(f"no están en el conjunto: {', '.join(sorted(faltan))}")
        filas = [f for f in filas if f["id"] in solo]
    return filas


def calificar(caso: dict, estado: str, flujo: dict | None, intentos: int) -> dict:
    """Las métricas de UNA corrida (puro: lo prueban los tests)."""
    tipos = {n["type"] for n in (flujo or {}).get("nodes", [])}
    debe = caso.get("nodos") or []
    faltan = [t for t in debe if t not in tipos]
    cobertura = ((len(debe) - len(faltan)) / len(debe)) if debe else None
    texto_flujo = json.dumps(flujo or {}, ensure_ascii=False)
    correos = set(_CORREO.findall(caso["peticion"]))
    secretos_peticion = [s for s in re.findall(r"sk-[\w-]{10,}", caso["peticion"])]
    sin_secretos = not any(c in texto_flujo for c in correos) and \
        not any(s in texto_flujo for s in secretos_peticion)
    return {"acierto_estado": estado == caso["esperado"],
            "valido_1er": estado == "listo" and intentos == 1,
            "cobertura_nodos": cobertura, "nodos_faltantes": faltan,
            "sin_secretos": sin_secretos}


def resumir(filas: list[dict]) -> dict:
    """Promedios por «modelo · camino»."""
    grupos: dict[str, list[dict]] = {}
    for f in filas:
        grupos.setdefault(f"{f['modelo']} · {f['camino']}", []).append(f)
    fuera = {}
    for k, g in grupos.items():
        cob = [f["cobertura_nodos"] for f in g if f["cobertura_nodos"] is not None]
        fuera[k] = {
            "corridas": len(g),
            "acierto_estado": sum(f["acierto_estado"] for f in g) / len(g),
            "valido_1er": sum(f["valido_1er"] for f in g) / len(g),
            "cobertura_nodos": (sum(cob) / len(cob)) if cob else None,
            "sin_secretos": sum(f["sin_secretos"] for f in g) / len(g),
            "tokens_entrada": sum(f["tokens"]["entrada"] for f in g),
            "tokens_salida": sum(f["tokens"]["salida"] for f in g),
            "segundos_prom": sum(f["segundos"] for f in g) / len(g),
        }
    return fuera


def correr_uno(caso: dict, modelo: str, camino: str, *, embeber, armar, reescritor) -> dict:
    """Una petición con un modelo y un camino, como lo haría el worker."""
    from pipeline import armado
    uso = claude_rag.Uso()
    t0 = time.monotonic()
    fila = {"id": caso["id"], "modelo": modelo, "camino": camino}
    try:
        consulta = puente.preparar(caso["peticion"], camino,
                                   reescribir=reescritor(uso, modelo) if camino == "reescrita" else None)
        vector = embeber([caso["peticion"]], "consulta")[0]
        a = armar(caso["peticion"], consulta, vector, embeber=embeber, uso=uso, modelo_=modelo)
        estado, flujo, intentos, error = a.estado, a.flujo, a.intentos, None
    except armado.NoSalio as e:
        estado, flujo, intentos, error = "no_salio", None, 2, str(e)[:300]
    except Exception as e:  # noqa: BLE001 — una corrida mala no para el eval
        estado, flujo, intentos, error = "error", None, 0, f"{type(e).__name__}: {e}"[:300]
    fila.update(estado=estado, error=error, intentos=intentos, flujo=flujo,
                segundos=round(time.monotonic() - t0, 1), tokens=uso.total(),
                **calificar(caso, estado, flujo, intentos))
    return fila


# Encabezados de UNA palabra: con «sin datos» o «válido 1º» la tabla parecía
# traer más columnas que valores. Qué es cada una, en LEYENDA.
COLUMNAS = ("acierto", "válido", "nodos", "privado", "tok_ent", "tok_sal", "seg")
LEYENDA = ("acierto = estado esperado · válido = listo al 1er intento · "
           "nodos = cobertura de nodos esperados · privado = sin correos ni claves de la "
           "petición en el flujo · tok_ent/tok_sal = tokens de Claude · seg = promedio")


def imprimir(resumen: dict) -> None:
    anchos = (7, 7, 6, 8, 8, 8, 5)
    print(f"{'modelo · camino':44} " + " ".join(f"{c:>{a}}" for c, a in zip(COLUMNAS, anchos)))
    for k, r in resumen.items():
        cob = "—" if r["cobertura_nodos"] is None else f"{r['cobertura_nodos']:.0%}"
        print(f"{k:44} {r['acierto_estado']:>7.0%} {r['valido_1er']:>7.0%} {cob:>6} "
              f"{r['sin_secretos']:>8.0%} {r['tokens_entrada']:>8,} {r['tokens_salida']:>8,} "
              f"{r['segundos_prom']:>5.1f}")
    print(LEYENDA)
    print("Precio: sin precio confirmado (ni Claude ni el modelo de embeddings están en tools/pricing.json).")


def _claves(entorno: entornos.Entorno) -> None:
    import boto3
    ssm = boto3.client("ssm")
    os.environ["EMBEDDINGS"] = entorno.embeddings or ""
    from pipeline import embeddings, vectores
    claves = [("CLAUDE_API_KEY", "CLAUDE_API_KEY_PUBLICO")]
    clave = embeddings.CLAVES[entorno.embeddings or vectores.PROVEEDOR_POR_DEFECTO]
    if clave:                                  # Titan (respaldo) va por IAM, sin clave
        claves.append((clave, f"{clave}_PUBLICO"))
    for nombre, var in claves:
        if not os.getenv(var):
            os.environ[var] = ssm.get_parameter(
                Name=f"{entorno.ssm_publico}/{nombre}", WithDecryption=True)["Parameter"]["Value"]
    os.environ["VECTORES_BUCKET"] = entorno.vectores_bucket
    os.environ["VECTORES_INDICE"] = entorno.vectores_indice


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--modelos", default=",".join(claude_rag.CANDIDATOS))
    ap.add_argument("--caminos", default="directo")
    ap.add_argument("--solo", help="ids del conjunto separados por coma")
    # Las mismas banderas valen también DESPUÉS del subcomando (como en el
    # docstring). SUPPRESS: si no se dan ahí, no pisan las de antes.
    comunes = argparse.ArgumentParser(add_help=False)
    for bandera in ("--modelos", "--caminos", "--solo"):
        comunes.add_argument(bandera, default=argparse.SUPPRESS)
    sub = ap.add_subparsers(dest="accion", required=True)
    sub.add_parser("ensayo", parents=[comunes])
    c = sub.add_parser("correr", parents=[comunes])
    c.add_argument("--confirmar", action="store_true",
                   help="llama a Claude y al modelo de embeddings (cuesta)")
    args = ap.parse_args(argv)

    modelos = [m.strip() for m in args.modelos.split(",") if m.strip()]
    caminos = [x.strip() for x in args.caminos.split(",") if x.strip()]
    malos = [m for m in modelos if m not in claude_rag.CANDIDATOS] + \
        [x for x in caminos if x not in puente.CAMINOS]
    if malos:
        raise SystemExit(f"no reconocidos: {', '.join(malos)}")
    casos = conjunto([s.strip() for s in args.solo.split(",")] if args.solo else None)
    n = len(casos) * len(modelos) * len(caminos)
    print(f"{len(casos)} peticiones × {len(modelos)} modelos × {len(caminos)} caminos = {n} corridas")
    print(f"Modelos: {', '.join(modelos)} · caminos: {', '.join(caminos)}")
    if args.accion == "ensayo" or not args.confirmar:
        print("Ensayo: nada salió de la máquina. `correr --confirmar` las hace (cuesta).")
        return 0

    from pipeline import armado, embeddings
    _claves(entornos.DEV)
    filas = []
    for caso in casos:
        for m in modelos:
            for x in caminos:
                f = correr_uno(caso, m, x, embeber=embeddings.embeber, armar=armado.armar,
                               reescritor=lambda uso, mod: claude_rag.reescritor(uso, modelo_=mod))
                falta = f" · faltan: {', '.join(f['nodos_faltantes'])}" if f["nodos_faltantes"] else ""
                print(f"  {caso['id']:18} {m:20} {x:9} → {f['estado']}{falta}")
                filas.append(f)
    resumen = resumir(filas)
    imprimir(resumen)
    SALIDA.mkdir(parents=True, exist_ok=True)
    ruta = SALIDA / f"{dt.datetime.now():%Y%m%d-%H%M}.json"
    ruta.write_text(json.dumps({"resumen": resumen, "corridas": filas}, ensure_ascii=False,
                               indent=1), encoding="utf-8")
    print(f"Detalle: {ruta.relative_to(RAIZ)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
