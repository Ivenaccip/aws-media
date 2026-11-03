"""Ajustes 3 — el «mundo» en memoria que usan las pruebas de COI y de la Biblioteca.

No es una prueba de producto: es el doble compartido de `test_coi_*.py` y
`test_biblioteca_*.py`. Finge, sin gastar nada, todo lo que tocan los dos APIs:

  - Postgres: las funciones `db.coi_*` y `db.biblioteca_*`, con la MISMA semántica
    que su SQL (candado atómico con tope de usos y de intentos que no cuentan, suma que
    suelta el candado, el día de México, borrar un «mío» lo saca de los fijados, los
    fijados con compare-and-set, aislamiento por persona). El SQL
    de verdad se prueba contra un Postgres 16 real en `test_coi_postgres.py`;
    aquí se prueba la lógica del API;
  - el modelo (`llm.chat_texto`) y la moderación (`moderacion.revisar`), con retraso
    y fallo configurables y la lista de lo que recibieron;
  - el reloj de la base (`mundo.ahora`), para cambiar de día sin esperar.

Cada operación que cruza una frontera se anota en `mundo.eventos`, en orden: así una
prueba exige «estado → tomar → moderar → modelo → sumar» como una lista.
"""
import asyncio
import json
import threading
import time
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from pipeline import db, llm, moderacion

# lo que el «modelo» responde por omisión: un COI de verdad, con sus tres encabezados
COI_ES = """#CONTEXTO
Eres un estratega de contenido con diez años de experiencia en redes sociales.

#OBJETIVO
Diseñar un plan de contenido de cuatro semanas para un canal de cocina.

#INSTRUCCIONES

1. Definición del objetivo primario
   * Rol: estratega de contenido.
2. Datos iniciales
   * Canal de cocina, público joven.
3. Estrategia de acción
   * Semana por semana.
4. Criterios de validación
   * Cada semana tiene un tema y un formato.
5. Reglas de desambiguación
   * Si hay dos opciones, elige la de menor esfuerzo.
6. Formato de salida
   * Tabla con semana, tema y formato.
7. Restricciones
   * Sin inventar cifras."""

TEXTO = "Quiero un plan de contenido para mi canal de cocina"
SECRETO = "ZORRO-VIOLETA-731"     # una palabra que ningún log ni respuesta debe repetir

# «De la casa» de las pruebas del API: UNA lista propia, fija, en vez del archivo del dueño
# (server/biblioteca_casa.json), que él reemplaza cuando quiere. Así agregar, quitar o reordenar sus
# prompts no pone en rojo estas pruebas; que ese archivo sea válido lo vigila test_biblioteca_casa.py.
CASA_DE_PRUEBA = {"prompts": [
    {"id": "casa-prueba-uno", "titulo": "Retrato de prueba", "para_que": "Para probar el API.",
     "prompt": "Retrato de [persona] con luz suave de estudio y fondo liso.", "categoria": "imagen",
     "etiquetas": ["retrato"], "lleva_a": "imagen"},
    {"id": "casa-prueba-dos", "titulo": "Plano lento de prueba", "para_que": "Para probar el API.",
     "prompt": "Plano lento de [lugar] al amanecer, cámara estable, 8 segundos.", "categoria": "video",
     "etiquetas": ["plano", "lento"], "lleva_a": "video"},
    {"id": "casa-prueba-tres", "titulo": "Guion corto de prueba", "para_que": "Para probar el API.",
     "prompt": "Escribe un guion de 30 segundos sobre [tema] con un gancho en la primera frase.",
     "categoria": "guion", "etiquetas": [], "lleva_a": None},
    {"id": "casa-prueba-cuatro", "titulo": "Investigación de prueba", "para_que": "Para probar el API.",
     "prompt": "Investiga los tres competidores principales de [producto] y compáralos en una tabla.",
     "categoria": "investigacion", "etiquetas": ["mercado"], "lleva_a": None},
    {"id": "casa-prueba-cinco", "titulo": "Producto de prueba", "para_que": "Para probar el API.",
     "prompt": "Producto [objeto] flotando sobre un fondo de color liso, sombra suave.",
     "categoria": "imagen", "etiquetas": ["producto"], "lleva_a": "imagen"},
]}


def ahora_utc() -> datetime:
    return datetime.now(timezone.utc)


class Mundo:
    def __init__(self, monkeypatch, *, modelo_real=False):
        self.mp = monkeypatch
        self.modelo_real = modelo_real     # True: NO se doblan chat_texto ni la moderación (los guardianes del SDK)
        self.user = "u1"
        self.eventos: list[tuple] = []
        self.tope_visto: list[int] = []
        self.tope_fallos_visto: list = []
        self.ahora = ahora_utc()                       # el reloj de la base
        self.coi: dict[str, dict] = {}                 # usuario -> {dia, usos, fallos, hasta, candado}
        self.mios: dict[str, list[dict]] = {}          # usuario -> [mío…] (el más nuevo al final)
        self.fijados: dict[str, list[str]] = {}
        self.cerrojo = threading.RLock()               # cada sentencia de Postgres es atómica
        self.fallas: dict[str, Exception] = {}         # nombre de operación -> error que lanza
        self.llamadas_modelo: list[dict] = []
        self.llamadas_moderacion: list[dict] = []
        self.modelo_respuesta = COI_ES
        self.modelo_uso = {"modelo": "modelo-de-prueba", "entrada": 1500, "salida": 700,
                           "cache_leida": 1000, "fin": "stop"}
        self.modelo_demora = 0.0
        self.modelo_error: Exception | None = None
        self.moderacion_veredicto = moderacion.Veredicto(permitido=True)
        self.moderacion_demora = 0.0
        self.moderacion_error: Exception | None = None
        self.antes_de_sumar = None                     # callable, una vez: pasa algo justo antes de sumar
        self.tras_tomar_fallido = None                 # callable, una vez: pasa algo justo después de un tomar que perdió
        self.antes_de_tomar = None                     # callable, una vez: pasa algo justo antes de tomar el candado
        self.tras_leer_fijados = None                  # callable, una vez: otro aparato escribe justo después de que leí los fijados
        self._parchar()

    # -- el reloj de México (UTC-6 fijo desde 2022) ------------------------------
    def dia(self):
        return (self.ahora - timedelta(hours=6)).date()

    def medianoche_siguiente(self) -> datetime:
        local = self.ahora - timedelta(hours=6)
        sig = datetime(local.year, local.month, local.day, tzinfo=timezone.utc) + timedelta(days=1)
        return sig + timedelta(hours=6)

    def _renueva(self) -> dict:
        sig = self.medianoche_siguiente()
        return {"renueva_en_s": int(-(-(sig - self.ahora).total_seconds() // 1)),
                "se_renueva": (sig - timedelta(hours=6)).strftime("%Y-%m-%dT00:00:00-06:00")}

    # -- parches ----------------------------------------------------------------
    def _parchar(self) -> None:
        mp = self.mp
        mp.setenv("STATE_BACKEND", "postgres")
        mp.setenv("OPENAI_API_KEY", "sk-de-mentira")
        mp.delenv("COGNITO_POOL_ID", raising=False)
        mp.delenv("COI_MODELO", raising=False)
        mp.delenv("COI_RAZONAMIENTO", raising=False)
        mp.setattr(db, "backend", lambda: "postgres")
        mp.setattr(db, "usuario_actual", lambda: self.user)
        for nombre in ("coi_estado", "coi_tomar", "coi_sumar", "coi_soltar", "biblioteca_mios",
                       "biblioteca_contar_mios", "biblioteca_crear_mio", "biblioteca_borrar_mio",
                       "biblioteca_ids_mios", "biblioteca_fijados", "biblioteca_fijar"):
            mp.setattr(db, nombre, self._envolver(nombre, getattr(self, "_" + nombre)))
        if not self.modelo_real:
            mp.setattr(moderacion, "revisar", self._revisar)
            mp.setattr(llm, "chat_texto", self._chat_texto)

    def _envolver(self, nombre, fn):
        def hacer(*a, **kw):
            falla = self.fallas.get(nombre)
            if falla is not None:
                self.eventos.append((nombre, "falla"))
                raise falla
            with self.cerrojo:
                return fn(*a, **kw)
        return hacer

    # -- coi_* -----------------------------------------------------------------
    def _fila(self, u) -> dict | None:
        return self.coi.get(u)

    def _coi_estado(self, u):
        self.eventos.append(("estado",))
        f = self._fila(u)
        hoy = bool(f and f["dia"] == self.dia())
        en_curso = bool(f and f["hasta"] is not None and f["hasta"] > self.ahora)
        return {"usos": f["usos"] if hoy else 0, "fallos": f["fallos"] if hoy else 0,
                "en_curso": en_curso, **self._renueva()}

    def _coi_tomar(self, u, candado, tope, caduca_s, tope_fallos=None):
        if self.antes_de_tomar is not None:
            gancho, self.antes_de_tomar = self.antes_de_tomar, None
            gancho()
        self.tope_visto.append(tope)
        self.tope_fallos_visto.append(tope_fallos)
        f = self._fila(u)
        libre = f is None or f["hasta"] is None or f["hasta"] <= self.ahora
        con_cupo = (f is None or f["dia"] != self.dia()
                    or (f["usos"] < tope and (tope_fallos is None or f["fallos"] < tope_fallos)))
        if f is None:
            self.coi[u] = {"dia": self.dia(), "usos": 0, "fallos": 0, "hasta": None, "candado": None}
            f = self.coi[u]
        if not (libre and con_cupo):
            self.eventos.append(("tomar", False))
            if self.tras_tomar_fallido is not None:
                gancho, self.tras_tomar_fallido = self.tras_tomar_fallido, None
                gancho()
            return False
        f["hasta"], f["candado"] = self.ahora + timedelta(seconds=caduca_s), candado
        self.eventos.append(("tomar", True))
        return True

    def _coi_sumar(self, u, candado, tope):
        if self.antes_de_sumar is not None:
            gancho, self.antes_de_sumar = self.antes_de_sumar, None
            gancho()
        f = self._fila(u)
        if not f or f["candado"] != candado or (f["dia"] == self.dia() and f["usos"] >= tope):
            self.eventos.append(("sumar", None))
            return None
        f["fallos"] = f["fallos"] if f["dia"] == self.dia() else 0
        f["usos"] = f["usos"] + 1 if f["dia"] == self.dia() else 1
        f["dia"], f["hasta"], f["candado"] = self.dia(), None, None
        self.eventos.append(("sumar", f["usos"]))
        return {"usos": f["usos"], **self._renueva()}

    def _coi_soltar(self, u, candado, fallo=False):
        f = self._fila(u)
        if f and f["candado"] == candado:
            if fallo:       # el intento costó una llamada y no contó: queda anotado en el día de México
                hoy = f["dia"] == self.dia()
                f["fallos"] = (f["fallos"] if hoy else 0) + 1
                f["usos"] = f["usos"] if hoy else 0
                f["dia"] = self.dia()
            f["hasta"], f["candado"] = None, None
            self.eventos.append(("soltar", True))
            return True
        self.eventos.append(("soltar", False))
        return False

    def usos(self, u=None) -> int:
        f = self.coi.get(u or self.user)
        return f["usos"] if f and f["dia"] == self.dia() else 0

    def candado_puesto(self, u=None) -> bool:
        f = self.coi.get(u or self.user)
        return bool(f and f["hasta"] is not None and f["hasta"] > self.ahora)

    def poner_usos(self, n, u=None, *, dia=None, fallos=0):
        self.coi[u or self.user] = {"dia": dia or self.dia(), "usos": n, "fallos": fallos,
                                    "hasta": None, "candado": None}

    def fallos(self, u=None) -> int:
        f = self.coi.get(u or self.user)
        return f["fallos"] if f and f["dia"] == self.dia() else 0

    # -- biblioteca_* -----------------------------------------------------------
    def _biblioteca_mios(self, u):
        return [json.loads(json.dumps(m)) for m in reversed(self.mios.get(u, []))]

    def _biblioteca_contar_mios(self, u):
        return len(self.mios.get(u, []))

    def _biblioteca_crear_mio(self, u, *, id_, clave, titulo, para_que, prompt, categoria,
                              etiquetas, origen, tope):
        propios = self.mios.setdefault(u, [])
        fila = {"id": id_, "clave": clave, "titulo": titulo, "para_que": para_que, "prompt": prompt,
                "categoria": categoria, "etiquetas": list(etiquetas), "origen": origen,
                "creado": self.ahora.strftime("%Y-%m-%dT%H:%M:%SZ")}
        if len(propios) < tope and not any(m["id"] == id_ or (clave and m["clave"] == clave)
                                           for m in propios):
            propios.append(fila)
            self.eventos.append(("crear_mio", id_))
            return {k: v for k, v in fila.items() if k != "clave"}, True
        if clave:
            previo = next((m for m in propios if m["clave"] == clave), None)
            if previo:
                self.eventos.append(("crear_mio", "repetido"))
                return {k: v for k, v in previo.items() if k != "clave"}, False
        self.eventos.append(("crear_mio", None))
        return None

    def _biblioteca_borrar_mio(self, u, id_):
        propios = self.mios.get(u, [])
        antes = len(propios)
        self.mios[u] = [m for m in propios if m["id"] != id_]
        borrado = len(self.mios[u]) < antes
        if borrado:
            self.fijados[u] = [i for i in self.fijados.get(u, []) if i != id_]
        self.eventos.append(("borrar_mio", id_, borrado))
        return borrado

    def _biblioteca_ids_mios(self, u, ids):
        return {m["id"] for m in self.mios.get(u, []) if m["id"] in ids}

    def _biblioteca_fijados(self, u):
        leidos = list(self.fijados.get(u, []))
        if self.tras_leer_fijados is not None:
            gancho, self.tras_leer_fijados = self.tras_leer_fijados, None
            gancho()
        return leidos

    def _biblioteca_fijar(self, u, ids, antes=None):
        """Con `antes`, compare-and-set: solo escribe si lo guardado sigue siendo `antes`."""
        if antes is not None and self.fijados.get(u, []) != list(antes):
            self.eventos.append(("fijar", "cambiaron"))
            return False
        self.eventos.append(("fijar", list(ids)))
        self.fijados[u] = list(ids)
        return True

    # -- el modelo y la moderación ----------------------------------------------
    async def _revisar(self, texto, *, prompt="moderar_system", falla_cerrado=False,
                       publico=False, sin_trazas=False):
        self.eventos.append(("moderar",))
        self.llamadas_moderacion.append({"texto": texto, "falla_cerrado": falla_cerrado,
                                         "sin_trazas": sin_trazas})
        await asyncio.sleep(self.moderacion_demora)
        if self.moderacion_error:
            raise self.moderacion_error
        return self.moderacion_veredicto

    async def _chat_texto(self, system, user, *, razonamiento="minimal", max_tokens=4000,
                          timeout=24, modelo=None):
        self.eventos.append(("modelo",))
        self.llamadas_modelo.append({"system": system, "user": user, "razonamiento": razonamiento,
                                     "max_tokens": max_tokens, "timeout": timeout, "modelo": modelo})
        await asyncio.sleep(self.modelo_demora)
        if self.modelo_error:
            raise self.modelo_error
        return self.modelo_respuesta, dict(self.modelo_uso)

    def nombres(self) -> list[str]:
        return [e[0] for e in self.eventos]


@pytest.fixture
def mundo(monkeypatch):
    return Mundo(monkeypatch)


@pytest.fixture
def casa_de_prueba(monkeypatch, tmp_path):
    """El API sirve `CASA_DE_PRUEBA` como «De la casa» durante la prueba."""
    from server import biblioteca_api
    ruta = tmp_path / "biblioteca_casa.json"
    ruta.write_text(json.dumps(CASA_DE_PRUEBA, ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(biblioteca_api, "CASA_RUTA", ruta)
    biblioteca_api._casa.cache_clear()
    yield CASA_DE_PRUEBA
    biblioteca_api._casa.cache_clear()


@pytest.fixture
def cliente(mundo):
    from server.app import app
    return TestClient(app)


def esperar(cond, plazo=5.0):
    """Sondea hasta que `cond()` sea verdad (para pruebas con hilos)."""
    limite = time.monotonic() + plazo
    while time.monotonic() < limite:
        if cond():
            return True
        time.sleep(0.01)
    return False


def test_el_mundo_cuenta_como_la_base():
    """Prueba del doble: el mismo contrato que el SQL (candado con tope, suma que suelta)."""
    mp = pytest.MonkeyPatch()
    try:
        m = Mundo(mp)
        assert m._coi_tomar("a", "c1", 3, 60) is True
        assert m._coi_tomar("a", "c2", 3, 60) is False          # una en curso
        assert m._coi_sumar("a", "c2", 3) is None                # candado ajeno: no suma
        assert m._coi_sumar("a", "c1", 3)["usos"] == 1
        assert m._coi_tomar("a", "c3", 3, 60) is True
        m.ahora += timedelta(seconds=61)                          # caduca solo
        assert m._coi_tomar("a", "c4", 3, 60) is True
        assert m._coi_sumar("a", "c3", 3) is None                 # el viejo ya no es dueño
    finally:
        mp.undo()
