"""RAG·17 — el almacén vectorial del RAG, en S3 Vectors.

Por qué S3 Vectors y no pgvector en la Aurora (decisión del 28-sep, tarjeta
RAG·17): deja la Aurora FUERA del camino del tráfico público. Su tope de ACU
es hoy el único freno duro de gasto del producto, y meter consultas anónimas
ahí dentro es justo lo que ese tope no aguanta. Además es IAM puro (ninguna
clave nueva en SSM) y el cliente `s3vectors` ya viene en el boto3 fijado.

LO QUE NO SE PUEDE CAMBIAR DESPUÉS DE CREAR EL ÍNDICE

La dimensión, la métrica y las llaves de metadatos no filtrables se fijan al
crear el índice y S3 Vectors no deja modificarlas. Cambiar el modelo de
embeddings (o su dimensión) es crear OTRO índice (`n8n-docs-v2`) y reindexar,
nunca pisar el que hay. Por eso viven aquí como constantes y
`tools/vectores.py crear` se niega a seguir si el índice ya existe con otros
valores.

QUIÉN HACE QUÉ

- El worker público (Lambda) solo CONSULTA: `consultar()`. Su rol tiene
  s3vectors:QueryVectors y GetVectors sobre este índice y nada más
  (infra/stacks/jobs.py).
- La ingesta (RAG·19) corre en la máquina del dueño con sus credenciales:
  `guardar()`. Ningún código que atiende a internet puede escribir el índice.

El bucket y el índice salen de VECTORES_BUCKET y VECTORES_INDICE (el CDK las
pone en el worker; en local van en el .env), que a su vez salen de
infra/entornos.py.
"""
from __future__ import annotations

import math
import os
from dataclasses import dataclass, field
from typing import Any, Iterable

# --- fijado al crear el índice (ver arriba) ---------------------------------
# gemini-embedding-001 por la API de Google (decisión del dueño, 29-sep; el
# análisis está en RAG·19). Nativo es de 3072: se pide output_dimensionality
# =1024 y cada vector recortado se RENORMALIZA (L2), que Google no hace por su
# cuenta bajo 3072. task_type de documento en la ingesta y de consulta en la
# pregunta. Contexto de 2 048 tokens: los trozos (RAG·19) no pasan de ahí.
# Cambiar de modelo es re-embeber todo en un índice nuevo (n8n-docs-v2).
#
# RESPALDO TEMPORAL (30-sep): la cuenta de Google está en verificación y no
# acepta la tarjeta. Mientras tanto dev embebe con Amazon Titan Text
# Embeddings V2 por Bedrock: IAM puro, sin clave en SSM (y sin KMS). NO es la
# decisión final: al volver a Gemini, dev regresa a EMBEDDINGS="gemini" y al
# índice n8n-docs-v1 en infra/entornos.py. Cada modelo tiene SU índice: dos
# espacios de vectores distintos jamás se mezclan en uno.
MODELOS = {
    "gemini": "gemini-embedding-001",
    "titan": "amazon.titan-embed-text-v2:0",   # respaldo temporal
}
PROVEEDOR_POR_DEFECTO = "gemini"
DIMENSION = 1024
METRICA = "cosine"
TIPO_DATO = "float32"
# Metadatos que se devuelven pero NO se pueden usar en filtros. El texto del
# trozo va aquí porque los filtrables tienen un tope de tamaño por vector y un
# trozo de documentación lo rebasa. Los filtrables (tipo, nodo, idioma, ...)
# no se declaran: todo lo que no esté en esta lista lo es.
NO_FILTRABLES = ("texto", "titulo", "url")

# --- límites del servicio que el código respeta -----------------------------
LOTE_MAXIMO = 500      # vectores por PutVectors
K_MAXIMO = 30          # topK por consulta: holgado para RAG y el mínimo seguro


class VectoresSinConfigurar(RuntimeError):
    """El entorno no tiene VECTORES_BUCKET / VECTORES_INDICE (prod hasta RAG·30)."""


class VectorInvalido(ValueError):
    """Un vector con otra dimensión, vacío o con NaN: S3 Vectors lo rechazaría
    a medio lote, así que se para antes de mandar nada."""


@dataclass(frozen=True)
class Trozo:
    """Un trozo de documentación listo para guardar."""
    clave: str
    vector: list[float]
    metadatos: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Resultado:
    clave: str
    distancia: float | None
    metadatos: dict[str, Any]


def proveedor() -> str:
    """«gemini» o «titan», de EMBEDDINGS (el CDK la pone en el worker desde
    infra/entornos.py; la ingesta y el eval, desde el mismo entorno)."""
    p = os.getenv("EMBEDDINGS") or PROVEEDOR_POR_DEFECTO
    if p not in MODELOS:
        raise ValueError(f"EMBEDDINGS={p!r}: tiene que ser uno de {sorted(MODELOS)}")
    return p


def modelo() -> str:
    return MODELOS[proveedor()]


def configurado() -> bool:
    return bool(os.getenv("VECTORES_BUCKET") and os.getenv("VECTORES_INDICE"))


def destino() -> tuple[str, str]:
    bucket, indice = os.getenv("VECTORES_BUCKET"), os.getenv("VECTORES_INDICE")
    if not (bucket and indice):
        raise VectoresSinConfigurar(
            "faltan VECTORES_BUCKET y VECTORES_INDICE (salen de infra/entornos.py)")
    return bucket, indice


def cliente():
    import boto3
    return boto3.client("s3vectors",
                        region_name=os.getenv("AWS_REGION", "us-east-1"))


def normalizar(vector: Iterable[float]) -> list[float]:
    """L2 = 1. Obligatorio con gemini-embedding-001 recortado a 1024: sin esto
    los vectores salen con normas distintas entre sí. (Titan ya los devuelve
    normalizados; pasar otra vez no cambia nada.)"""
    v = [float(x) for x in vector]
    norma = math.sqrt(sum(x * x for x in v))
    if not math.isfinite(norma) or norma == 0:
        raise VectorInvalido("un vector de norma 0 (o NaN) no tiene dirección")
    return [x / norma for x in v]


def validar(vector: Iterable[float]) -> list[float]:
    """Revisa y devuelve el vector YA normalizado: todo lo que entra o se
    consulta en el índice pasa por aquí."""
    v = [float(x) for x in vector]
    if len(v) != DIMENSION:
        raise VectorInvalido(f"el vector trae {len(v)} dimensiones; el índice es de {DIMENSION}")
    if not all(math.isfinite(x) for x in v):
        raise VectorInvalido("el vector trae NaN o infinito")
    return normalizar(v)


def consultar(vector: Iterable[float], k: int = 8, filtro: dict | None = None,
              *, s3v=None) -> list[Resultado]:
    """Los `k` trozos más cercanos, del más parecido al menos. `filtro` va tal
    cual a S3 Vectors (p. ej. {"tipo": "nodo"} o {"$and": [...]})."""
    if not 1 <= k <= K_MAXIMO:
        raise ValueError(f"k tiene que ir de 1 a {K_MAXIMO}")
    bucket, indice = destino()
    pedido: dict[str, Any] = {
        "vectorBucketName": bucket, "indexName": indice, "topK": k,
        "queryVector": {"float32": validar(vector)},
        "returnMetadata": True, "returnDistance": True,
    }
    if filtro:
        pedido["filter"] = filtro
    r = (s3v or cliente()).query_vectors(**pedido)
    return [Resultado(clave=v["key"], distancia=v.get("distance"),
                      metadatos=v.get("metadata") or {})
            for v in r.get("vectors", [])]


def guardar(trozos: Iterable[Trozo], *, s3v=None) -> int:
    """Guarda (o reemplaza, por clave) los trozos en lotes de LOTE_MAXIMO.
    Valida TODO antes de mandar el primer lote: una ingesta que se cae a la
    mitad deja el índice con media documentación y nadie lo nota."""
    lista = list(trozos)
    claves = [t.clave for t in lista]
    if len(set(claves)) != len(claves):
        raise ValueError("claves repetidas en la misma ingesta")
    cuerpo = [{"key": t.clave, "data": {"float32": validar(t.vector)},
               "metadata": dict(t.metadatos)} for t in lista]
    if not cuerpo:
        return 0
    bucket, indice = destino()
    s3v = s3v or cliente()
    for i in range(0, len(cuerpo), LOTE_MAXIMO):
        s3v.put_vectors(vectorBucketName=bucket, indexName=indice,
                        vectors=cuerpo[i:i + LOTE_MAXIMO])
    return len(cuerpo)
