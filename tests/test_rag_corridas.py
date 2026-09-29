"""RAG·3 — tabla de corridas públicas de /automatiza.

Fija lo que no se puede arreglar después del 25-oct: sin user_id ni FK a
usuarios, id público aleatorio, texto crudo intacto, el correo aparte y solo
agregando filas, y que todo el repositorio funciona dentro del candado de
RAG·1. El SQL se probó además contra un Postgres 16 real imitando al Data API."""
import re

import pytest

from pipeline import db
from pipeline.db import ESQUEMA


def _tabla(nombre: str) -> str:
    for s in ESQUEMA:
        if f"CREATE TABLE IF NOT EXISTS {nombre} " in s:
            return " ".join(s.split())
    raise AssertionError(f"falta {nombre} en ESQUEMA")


@pytest.fixture
def sql(monkeypatch):
    """ejecutar falso que junta (sql, params) y contesta lo que se le pida."""
    llamadas, respuestas = [], []

    def falso(q, params=None):
        llamadas.append((" ".join(q.split()), params or {}))
        return respuestas.pop(0) if respuestas else []
    monkeypatch.setattr(db, "ejecutar", falso)
    return llamadas, respuestas


# ---------------------------------------------------------------------------
# esquema

def test_corridas_sin_usuario():
    t = _tabla("automatiza_corridas")
    assert "user_id" not in t and "usuarios" not in t
    assert "id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY" in t
    assert "publico_id text NOT NULL UNIQUE" in t


@pytest.mark.parametrize("columna", [
    # lo mínimo de la tarjeta y del lienzo aprobado el 28-sep
    "texto text NOT NULL", "creado", "cache_acerto", "validador_ok",
    "validador_motivo", "descargo_json", "descargo_guia", "reportado",
    "en_fila_desde", "correo_enviado", "nodos text[]", "resultado jsonb",
    "ip_hash", "referrer", "utm_source", "utm_medium", "utm_campaign",
    "costo_usd", "modelo", "traza",
])
def test_corridas_guarda_lo_irreversible(columna):
    assert columna in _tabla("automatiza_corridas")


def test_correo_aparte_con_prueba_de_consentimiento():
    t = _tabla("automatiza_contactos")
    assert "REFERENCES automatiza_corridas(id)" in t
    assert "usuarios" not in t
    for c in ("correo text NOT NULL", "recontacto boolean NOT NULL DEFAULT false",
              "recontacto_texto", "aviso_version", "origen"):
        assert c in t, c
    assert "correo" not in re.sub(r"correo_enviado", "", _tabla("automatiza_corridas"))


def test_contactos_solo_se_agregan():
    # nadie edita ni borra un consentimiento desde el código
    fuente = open(db.__file__, encoding="utf-8").read()
    assert not re.search(r"(UPDATE|DELETE FROM)\s+automatiza_contactos", fuente)


def test_indices_de_fila_y_de_dia():
    todo = " ".join(" ".join(ESQUEMA).split())
    assert "ON automatiza_corridas (en_fila_desde) WHERE estado = 'en_fila'" in todo
    assert "ON automatiza_corridas (creado)" in todo


# ---------------------------------------------------------------------------
# repositorio — y todo él dentro del candado de identidad

def test_crear_guarda_el_texto_intacto_y_recorta_el_origen(sql):
    llamadas, respuestas = sql
    respuestas.append([{"id": 7, "publico_id": "x"}])
    texto = "  Cuando llegue una factura\n guárdala en Drive  "
    with db.camino_publico():
        r = db.automatiza_crear(texto, ip_hash="h",
                                origen={"referrer": "r" * 900, "utm_source": "ig",
                                        "otro": "no-entra"})
    assert r == {"id": 7, "publico_id": "x"}
    q, p = llamadas[0]
    assert q.startswith("INSERT INTO automatiza_corridas")
    assert p["t"] == texto
    assert len(p["referrer"]) == 500 and p["utm_source"] == "ig"
    assert p["utm_medium"] is None and "otro" not in p
    assert len(p["p"]) >= 16                       # aleatorio, no el id


def test_publico_id_no_se_repite(sql):
    llamadas, respuestas = sql
    respuestas.extend([{"id": i, "publico_id": "x"}] for i in range(50))
    for _ in range(50):
        db.automatiza_crear("x")
    assert len({p["p"] for _, p in llamadas}) == 50


def test_corrida_desempaca_jsonb_y_arreglo(sql):
    _, respuestas = sql
    respuestas.append([{"id": 1, "resultado": '{"nodes": []}', "nodos": '["Gmail"]'}])
    with db.camino_publico():
        r = db.automatiza_corrida("p")
    assert r["resultado"] == {"nodes": []} and r["nodos"] == ["Gmail"]


def test_corrida_inexistente(sql):
    assert db.automatiza_corrida("nada") is None


@pytest.mark.parametrize("fn,estado_origen", [
    (db.automatiza_a_fila, "recibida"),
    (db.automatiza_tomar, "en_fila"),
])
def test_transiciones_condicionadas(sql, fn, estado_origen):
    llamadas, respuestas = sql
    respuestas.append([])                          # otro worker ya la tomó
    assert fn(3) is False
    assert f"AND estado = '{estado_origen}'" in llamadas[0][0]


def test_cerrar_solo_a_estados_finales(sql):
    with pytest.raises(ValueError):
        db.automatiza_cerrar(1, "armando")


def test_cerrar_no_reabre(sql):
    llamadas, _ = sql
    assert db.automatiza_cerrar(1, "listo", nodos=["Gmail"]) is False
    q, p = llamadas[0]
    assert "estado NOT IN ('listo', 'sin_cobertura', 'no_salio', 'rechazada')" in q
    assert p["n"] == ["Gmail"]


def test_terminales_coinciden_con_el_sql():
    fuente = open(db.__file__, encoding="utf-8").read()
    lista = ", ".join(f"'{e}'" for e in db.TERMINALES_AUTOMATIZA)
    assert f"estado NOT IN ({lista})" in fuente


def test_anotar_es_lista_blanca(sql):
    with pytest.raises(ValueError):
        db.automatiza_anotar(1, **{"estado = 'listo', texto": "x"})
    with pytest.raises(ValueError):
        db.automatiza_anotar(1, texto="reescrito")   # lo pedido no se toca


def test_anotar_castea_fechas_y_dinero(sql):
    llamadas, _ = sql
    db.automatiza_anotar(1, costo_usd=0.01, correo_enviado="2026-10-10T00:00:00Z",
                         cache_acerto=True)
    q, _ = llamadas[0]
    assert "costo_usd = :costo_usd::numeric" in q
    assert "correo_enviado = :correo_enviado::timestamptz" in q
    assert "cache_acerto = :cache_acerto," in q


def test_descarga_guarda_la_primera_hora(sql):
    llamadas, _ = sql
    db.automatiza_descargo("p", "guia")
    assert "descargo_guia = COALESCE(descargo_guia, now())" in llamadas[0][0]
    with pytest.raises(ValueError):
        db.automatiza_descargo("p", "texto")


def test_correo_se_agrega_y_el_texto_de_la_casilla_solo_si_la_marco(sql):
    llamadas, _ = sql
    with db.camino_publico():
        db.automatiza_guardar_correo(1, " a@b.com ", origen="fila",
                                     recontacto_texto="Quiero recibir…")
        db.automatiza_guardar_correo(1, "a@b.com", origen="listo", recontacto=True,
                                     recontacto_texto="Quiero recibir…",
                                     aviso_version="v1")
    (q1, p1), (_, p2) = llamadas
    assert q1.startswith("INSERT INTO automatiza_contactos")
    assert p1["c"] == "a@b.com" and p1["r"] is False and p1["t"] is None
    assert p2["r"] is True and p2["t"] == "Quiero recibir…" and p2["v"] == "v1"


def test_lugar_en_fila(sql):
    _, respuestas = sql
    respuestas.extend([[{"lugar": 3}], [{"lugar": 0}]])
    with db.camino_publico():
        assert db.automatiza_lugar(1) == 3
        assert db.automatiza_lugar(1) is None      # ya no está en fila


def test_ninguna_funcion_automatiza_pide_usuario():
    fuente = open(db.__file__, encoding="utf-8").read()
    bloque = fuente[fuente.index("# RAG·3 — corridas públicas"):]
    codigo = "\n".join(l.split("#")[0] for l in bloque.splitlines())
    assert "usuario_actual" not in codigo and "user_id" not in codigo
