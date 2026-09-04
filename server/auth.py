"""M2 — login: exige el id_token del pool de Cognito en /api/* y /editor/*.

La exigencia vive EN LA APP (no en un authorizer de API Gateway) a propósito:
los <img>/<audio>/<video> de la web piden /api/.../archivo/... sin poder
adjuntar el header Authorization, y el authorizer del gateway solo lee headers.
Aquí el token se acepta por header `Authorization: Bearer` (lo adjunta
static/auth.js) o por cookie `token` (la pone callback.html — con ella los tags
de media funcionan solos). La firma se verifica RS256 contra el JWKS del pool.

Encendido por env: COGNITO_POOL_ID + COGNITO_CLIENT_ID (las cablea el stack
aws-media-api). Sin ellas —dev local— el middleware no hace nada y todo corre
como DEFAULT_USER_ID, igual que siempre.
"""
from __future__ import annotations

import os
from functools import lru_cache

from fastapi.responses import JSONResponse, RedirectResponse

from pipeline import db

# rutas con datos → token obligatorio; el cascarón estático queda público
# (no revela nada: la primera llamada a /api devuelve 401 y auth.js manda
# al Hosted UI). /api/auth/config es público: el frontend lo necesita ANTES
# de tener token para saber a dónde ir a loguearse.
PREFIJOS_PROTEGIDOS = ("/api/", "/editor/")
RUTAS_PUBLICAS = {"/api/auth/config"}


def activo() -> bool:
    return bool(os.getenv("COGNITO_POOL_ID"))


def _region() -> str:
    return os.environ["COGNITO_POOL_ID"].split("_")[0]


def _emisor() -> str:
    return f"https://cognito-idp.{_region()}.amazonaws.com/{os.environ['COGNITO_POOL_ID']}"


@lru_cache(maxsize=1)
def _jwks():
    import jwt
    return jwt.PyJWKClient(f"{_emisor()}/.well-known/jwks.json", cache_keys=True)


def verificar(token: str) -> dict:
    """Valida firma, expiración, audiencia y emisor; devuelve los claims.
    Solo aceptamos id_token (trae email y su aud es el client de la web)."""
    import jwt
    clave = _jwks().get_signing_key_from_jwt(token).key
    claims = jwt.decode(token, clave, algorithms=["RS256"],
                        audience=os.environ["COGNITO_CLIENT_ID"],
                        issuer=_emisor())
    if claims.get("token_use") != "id":
        raise jwt.InvalidTokenError("se esperaba un id_token")
    return claims


def _token_del_request(request) -> str | None:
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    return request.cookies.get("token")


async def middleware(request, call_next):
    """Fija la identidad del request (sub del token) antes de entrar a la app."""
    marca = None
    if activo():
        ruta = request.url.path
        if ruta.startswith(PREFIJOS_PROTEGIDOS) and ruta not in RUTAS_PUBLICAS:
            token = _token_del_request(request)
            if not token:
                return _rechazo(request, "Inicia sesión para continuar")
            try:
                claims = verificar(token)
            except Exception:  # noqa: BLE001 — firma/exp/aud inválidos: da igual cuál
                return _rechazo(request, "Tu sesión venció — vuelve a iniciar sesión")
            marca = db.fijar_usuario(claims["sub"])
    try:
        return await call_next(request)
    finally:
        if marca is not None:
            db._usuario_request.reset(marca)


def _rechazo(request, detalle: str):
    # navegación directa (p. ej. /editor/x en la barra) → a la portada, donde
    # auth.js arranca el login; llamadas fetch → 401 y auth.js lo maneja
    if "text/html" in request.headers.get("accept", ""):
        return RedirectResponse("/")
    return JSONResponse({"detail": detalle}, status_code=401)
