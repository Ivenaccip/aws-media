"""RAG·2/RAG·5 — las rutas públicas de /automatiza, las ÚNICAS bajo
/api/publico/ (lo fija tests/test_rag_camino_publico.py).

Todo aquí corre sin token y dentro del candado de identidad: ninguna función
de este archivo puede llamar db.usuario_actual() (reventaría con 500). Lo que
se toca es la corrida, nunca un usuario.
"""
from __future__ import annotations

from fastapi import APIRouter

from pipeline import publico as freno

router = APIRouter(prefix="/api/publico")


@router.get("/estado")
def estado():
    """¿Se puede pedir un flujo ahora? La página lo consulta al abrir para
    enseñar «Ahorita no está disponible» antes de que alguien escriba.

    No dice POR QUÉ (apagado o tope): al visitante le da igual, y a un bot le
    serviría saber cuánto le queda al día."""
    return {"disponible": freno.permiso() is None}
