"""RAG·21 — recuperación y generación: del texto del visitante al flujo de n8n.

    buscar     los K trozos de documentación más cercanos en S3 Vectors. Con
               el camino directo se reusa el vector de la petición que ya se
               pagó en «entender»; con el reescrito se embebe la consulta.
    generar    Claude (pipeline/claude_rag.py, Opus 5.5 por ahora) arma el
               flujo con la lista de nodos permitidos y la documentación.
    revisar    el validador de RAG·22. Si no pasa, UN reintento devolviéndole
               los errores al modelo; si el segundo tampoco pasa, no se
               entrega (NoSalio) y la corrida queda contada como fallo.

Si el modelo dice que la petición necesita algo que no soportamos, la corrida
se cierra como «sin_cobertura» con lo que falta: es la señal más valiosa para
decidir qué nodos agregar al crecer hacia el 80%.

Se enciende con RAG·21 apagando `publico.ARMADO_DE_MENTIRA` (decisión del
dueño: gasta en cada corrida). Hasta entonces este módulo solo corre en tests
y en tools/eval_rag.py.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from pipeline import claude_rag, n8n_catalogo, validador, vectores

K = 8                        # trozos de documentación por petición
MAX_CONTEXTO = 40_000        # caracteres de documentación que viajan al modelo
PROMPT = "automatiza_armar_system"
MAX_TOKENS = 16_000
EFFORT = "medium"            # el de fábrica de Opus 5.5, dicho explícito; lo ajusta el eval


class NoSalio(RuntimeError):
    """El flujo no pasó el validador ni con el reintento."""


@dataclass
class Armado:
    estado: str                                   # listo · sin_cobertura
    flujo: dict | None
    resumen: str
    nodos: list[str]
    faltan: list[str] = field(default_factory=list)
    fuentes: list[str] = field(default_factory=list)
    intentos: int = 1
    advertencias: list[str] = field(default_factory=list)
    modelo: str = ""

    def como_resultado(self, uso: claude_rag.Uso) -> dict:
        """Lo que se guarda en `resultado` de la corrida."""
        return {"flujo": self.flujo, "resumen": self.resumen, "nodos": self.nodos,
                "faltan": self.faltan, "fuentes": self.fuentes, "intentos": self.intentos,
                "advertencias": self.advertencias, "modelo": self.modelo,
                "uso": {"llamadas": uso.llamadas, "total": uso.total()}}


def lista_de_nodos() -> str:
    cat = n8n_catalogo.catalogo()["nodos"]
    filas = []
    for t, p in n8n_catalogo.permitidos().items():
        n = cat[t]
        creds = ", ".join(c["nombre"] for c in n["credenciales"]) or "—"
        extra = " (también como herramienta: " + t + "Tool)" if n["como_herramienta"] else ""
        filas.append(f"{t} · {n['version_por_defecto']} · {creds} · {p['nombre']}{extra}")
    return "\n".join(filas)


def prompt_sistema() -> str:
    from pipeline.config import load_prompt
    llm = n8n_catalogo.llm()
    return load_prompt(PROMPT).format(nodos=lista_de_nodos(), llm_nodo=llm["nodo"],
                                      llm_modelo=llm["modelo"])


def buscar(consulta, vector_peticion, *, embeber, s3v=None) -> list[vectores.Resultado]:
    if consulta.camino == "directo" and vector_peticion is not None:
        qv = vector_peticion
    else:
        qv = embeber([consulta.texto], "consulta")[0]
    return vectores.consultar(qv, k=K, s3v=s3v)


def contexto(resultados: list[vectores.Resultado]) -> str:
    partes, usado = [], 0
    for r in resultados:
        m = r.metadatos
        bloque = f"### {m.get('titulo', r.clave)}\n{m.get('url', '')}\n\n{m.get('texto', '')}"
        if usado + len(bloque) > MAX_CONTEXTO:
            break
        partes.append(bloque)
        usado += len(bloque)
    return "\n\n---\n\n".join(partes)


def _mensaje(peticion: str, docs: str) -> str:
    return (f"Lo que pidió la persona:\n<peticion>\n{peticion}\n</peticion>\n\n"
            f"Documentación de n8n recuperada:\n<documentacion>\n{docs or '(nada)'}\n</documentacion>")


def _forma(r: dict) -> None:
    if not isinstance(r.get("cubre"), bool):
        raise claude_rag.RespuestaInvalida("falta «cubre»")
    if r["cubre"] and not isinstance(r.get("flujo"), dict):
        raise claude_rag.RespuestaInvalida("cubre=true sin flujo")


def generar(peticion: str, resultados: list[vectores.Resultado], *, uso: claude_rag.Uso,
            cli=None, modelo_: str | None = None) -> Armado:
    import json
    system = prompt_sistema()
    mensajes = [{"role": "user", "content": _mensaje(peticion, contexto(resultados))}]
    fuentes = [r.clave for r in resultados]
    m = modelo_ or claude_rag.modelo()
    ultimo = None
    for intento in (1, 2):
        r = claude_rag.pedir_json(system, mensajes, etapa=f"armar{intento}", effort=EFFORT,
                                  max_tokens=MAX_TOKENS, uso=uso, modelo_=m, cli=cli)
        _forma(r)
        if not r["cubre"]:
            faltan = [str(x)[:200] for x in (r.get("faltan") or [])][:10]
            return Armado("sin_cobertura", None, "", [], faltan=faltan, fuentes=fuentes,
                          intentos=intento, modelo=m)
        v = validador.validar(r["flujo"])
        if v.ok:
            nodos = [n["type"] for n in r["flujo"]["nodes"]]
            return Armado("listo", r["flujo"], str(r.get("resumen") or "")[:500], nodos,
                          fuentes=fuentes, intentos=intento, advertencias=v.advertencias,
                          modelo=m)
        ultimo = v
        # el reintento: su respuesta tal cual y los errores del validador
        mensajes += [{"role": "assistant", "content": json.dumps(r, ensure_ascii=False)},
                     {"role": "user", "content": (
                         "El flujo no pasó la revisión. Corrige SOLO esto y devuelve el "
                         "objeto JSON completo otra vez:\n" + validador.para_el_modelo(v))}]
    raise NoSalio("validador: " + "; ".join(ultimo.errores)[:400])


def armar(peticion: str, consulta, vector_peticion, *, embeber, uso: claude_rag.Uso,
          cli=None, s3v=None, modelo_: str | None = None) -> Armado:
    resultados = buscar(consulta, vector_peticion, embeber=embeber, s3v=s3v)
    return generar(peticion, resultados, uso=uso, cli=cli, modelo_=modelo_)
