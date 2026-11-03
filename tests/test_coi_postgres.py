"""Ajustes 3 — el SQL nuevo (COI y Biblioteca) contra un Postgres 16 REAL.

Los dobles en memoria no cazan un error de sintaxis ni una carrera: esto sí. Corre
`pipeline/db.py` de verdad sobre un Postgres local (socket unix) con un shim que imita
lo esencial del Data API de Aurora: UNA sentencia por llamada, autocommit, parámetros
`:nombre`, filas como dicts. Cada hilo tiene su propia conexión, así que las carreras son
reales.

Se omite solo si no hay Postgres. Para correrlo hace falta un Postgres 16 con un socket unix
(sin clave para el usuario `postgres`) y la variable `COI_PG_SOCK` apuntando al directorio del socket:

    COI_PG_SOCK=/tmp/pgint-servidor/sock pytest tests/test_coi_postgres.py

(El script que levanta uno vive en el scratchpad del rol servidor, `servidor-int/pg_arriba.sh`;
cualquier `initdb` + `pg_ctl -o "-c listen_addresses='' -c unix_socket_directories=…"` sirve.)
La prueba crea y borra su propia base (`coi_prueba`); no toca ninguna otra."""
import os
import re
import threading
import time
import uuid

import pytest

psycopg = pytest.importorskip("psycopg")
from psycopg.rows import dict_row  # noqa: E402

from pipeline import coi, db, llm, moderacion  # noqa: E402
from test_coi_mundo import casa_de_prueba  # noqa: E402,F401 — «De la casa» de prueba para el API

SOCK = os.environ.get("COI_PG_SOCK", "")
pytestmark = pytest.mark.skipif(not (SOCK and os.path.exists(SOCK)),
                                reason="sin Postgres: define COI_PG_SOCK con el directorio del socket")
BASE = "coi_prueba"
_PARAM = re.compile(r"(?<![:\w]):([A-Za-z_][A-Za-z0-9_]*)")


class Shim:
    def __init__(self):
        self._tl = threading.local()
        self.sentencias: list[str] = []
        self.llamadas: list[tuple[str, dict]] = []      # (sentencia, parámetros) de cada ejecución

    @property
    def conn(self):
        c = getattr(self._tl, "c", None)
        if c is None or c.closed:
            c = self._tl.c = psycopg.connect(host=SOCK, user="postgres", dbname=BASE,
                                             autocommit=True, row_factory=dict_row)
        return c

    @staticmethod
    def _valor(nombre, valor):
        """Lo mismo que el Data API recibe de `db._param`: listas y dicts viajan como TEXTO JSON
        (y la sentencia los castea con ::jsonb); psycopg los adaptaría a arreglos de Postgres."""
        p = db._param(nombre, valor)["value"]
        return None if p.get("isNull") else next(iter(p.values()))

    def ejecutar(self, sql, params=None):
        self.sentencias.append(sql)
        self.llamadas.append((sql, dict(params or {})))
        params = {k: self._valor(k, v) for k, v in (params or {}).items()}
        cur = self.conn.execute(_PARAM.sub(lambda m: f"%({m.group(1)})s", sql), params)
        if cur.description is None:
            return []
        filas = []
        for f in cur.fetchall():
            filas.append({k: (str(v) if hasattr(v, "isoformat") else
                              bytes(v).decode() if isinstance(v, (bytes, bytearray)) else v)
                          for k, v in f.items()})
        return filas


@pytest.fixture(scope="module")
def base_creada():
    with psycopg.connect(host=SOCK, user="postgres", dbname="postgres", autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{BASE}" WITH (FORCE)')
        c.execute(f"CREATE DATABASE \"{BASE}\" ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C' TEMPLATE template0")
    yield
    with psycopg.connect(host=SOCK, user="postgres", dbname="postgres", autocommit=True) as c:
        c.execute(f'DROP DATABASE IF EXISTS "{BASE}" WITH (FORCE)')


@pytest.fixture
def pg(base_creada, monkeypatch):
    shim = Shim()
    monkeypatch.setattr(db, "ejecutar", shim.ejecutar)
    for sentencia in db.ESQUEMA:
        db.ejecutar(sentencia)
    shim.sentencias.clear()
    return shim


def nuevo() -> str:
    return "u-" + uuid.uuid4().hex[:10]


def sql(texto, **params):
    return db.ejecutar(texto, params)


def en_hilos(n, fn):
    """Corre fn(i) en n hilos a la vez (arrancan juntos) y devuelve sus resultados en orden."""
    salida, errores, tope = [None] * n, [], threading.Barrier(n)

    def uno(i):
        try:
            tope.wait(10)
            salida[i] = fn(i)
        except Exception as err:  # noqa: BLE001
            errores.append(err)

    hilos = [threading.Thread(target=uno, args=(i,)) for i in range(n)]
    [h.start() for h in hilos]
    [h.join(60) for h in hilos]
    assert not errores, errores
    return salida


# ---------------------------------------------------------------------------
# el esquema

def test_el_esquema_nuevo_corre_dos_veces_sin_error_y_crea_las_tablas(pg):
    for s in db.ESQUEMA:
        db.ejecutar(s)
    tablas = {f["table_name"] for f in sql("SELECT table_name FROM information_schema.tables WHERE table_schema='public'")}
    assert {"coi_estado", "biblioteca_mios", "biblioteca_fijados"} <= tablas
    cols = {f["column_name"] for f in sql("SELECT column_name FROM information_schema.columns WHERE table_name='coi_estado'")}
    assert cols == {"usuario", "dia", "usos", "fallos", "en_curso_hasta", "candado"}
    idx = {f["indexname"] for f in sql("SELECT indexname FROM pg_indexes WHERE tablename='biblioteca_mios'")}
    assert "biblioteca_mios_clave" in idx


def test_una_tabla_vieja_sin_la_columna_fallos_la_recibe_al_correr_el_esquema(pg):
    """Un entorno donde `coi_estado` ya existía (migrado antes de esta columna): correr el esquema
    le agrega `fallos` sin tocar las filas que tenía."""
    sql("DROP TABLE coi_estado")
    sql("CREATE TABLE coi_estado (usuario text PRIMARY KEY, dia date, usos int NOT NULL DEFAULT 0, "
        "en_curso_hasta timestamptz, candado text)")
    sql("INSERT INTO coi_estado (usuario, dia, usos) VALUES ('vieja', (now() AT TIME ZONE 'America/Mexico_City')::date, 2)")
    for s in db.ESQUEMA:
        db.ejecutar(s)
    e = db.coi_estado("vieja")
    assert (e["usos"], e["fallos"]) == (2, 0)


def test_db_migrate_corre_el_esquema_y_verifica_que_no_falte_ninguna_tabla(pg, monkeypatch, capsys):
    """`tools/db_migrate.py` (el paso manual que no puede olvidarse en ningún entorno) termina con
    error si tras correr falta una tabla del esquema."""
    import sys
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
    from tools import db_migrate
    monkeypatch.setattr(sys, "argv", ["db_migrate.py", "--cluster-arn", "x", "--secret-arn", "y"])
    db_migrate.main()
    salida = capsys.readouterr().out
    assert "coi_estado" in salida and "biblioteca_mios" in salida and "biblioteca_fijados" in salida
    assert re.search(r"Las \d+ tablas del esquema existen", salida)
    # ahora una tabla que NO se puede crear: debe terminar con error y nombrarla
    sql("DROP TABLE coi_estado")
    real = pg.ejecutar
    monkeypatch.setattr(db, "ejecutar", lambda q, p=None: [] if "CREATE TABLE IF NOT EXISTS coi_estado" in q else real(q, p))
    with pytest.raises(SystemExit) as salio:
        db_migrate.main()
    assert "coi_estado" in str(salio.value)


# ---------------------------------------------------------------------------
# COI: el reloj de México

def _reloj(instante: str):
    """Corre el mismo bloque de reloj que usa db.py, con `now()` fijado en un instante."""
    fijo = f"TIMESTAMPTZ '{instante}'"
    consulta = ("WITH " + db._RELOJ_COI.replace("now()", fijo)
                + " SELECT hoy::text AS hoy, " + db._RENUEVA_COI.replace("now()", fijo) + " FROM r")
    fila = db.ejecutar(consulta)[0]
    return {"hoy": fila["hoy"], **db._renueva(fila)}


# Lo que la base daba ANTES de armar el formato en Python: `to_char` con «HH24:MI:SS». Se conserva
# aquí, solo para comparar, porque el analizador del Data API de Aurora no se pudo probar contra esos
# literales y las sentencias de COI ya no los llevan (ver test_ninguna_sentencia_...).
_SE_RENUEVA_ANTES = """to_char(r.sig_local, 'YYYY-MM-DD"T"HH24:MI:SS')
        || CASE WHEN r.desfase < 0 THEN '-' ELSE '+' END
        || to_char(abs(r.desfase) / 3600, 'FM00') || ':'
        || to_char(mod(abs(r.desfase), 3600) / 60, 'FM00')"""


@pytest.mark.parametrize("instante", [
    "2026-10-17 03:00:00+00", "2026-10-17 05:59:59+00", "2026-10-17 06:00:00+00", "2026-12-31 20:00:00+00",
    "2028-03-01 05:00:00+00", "2021-07-01 12:00:00+00", "2021-04-04 12:00:00+00", "2022-10-30 12:00:00+00",
])
def test_se_renueva_sale_igual_que_cuando_lo_formateaba_la_base(pg, instante):
    fijo = f"TIMESTAMPTZ '{instante}'"
    reloj = "WITH " + db._RELOJ_COI.replace("now()", fijo)
    antes = db.ejecutar(reloj + f" SELECT {_SE_RENUEVA_ANTES} AS se FROM r")[0]["se"]
    assert _reloj(instante)["se_renueva"] == antes
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT00:00:00[-+]\d\d:\d\d", antes)


def test_creado_sale_igual_que_cuando_lo_formateaba_la_base(pg):
    u = nuevo()
    mio(u, 1)
    mio(u, 2, prompt="otro")
    filas = sql("SELECT to_char(creado AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') AS creado "
                "FROM biblioteca_mios WHERE usuario = :u ORDER BY creado DESC, id", u=u)
    assert [m["creado"] for m in db.biblioteca_mios(u)] == [f["creado"] for f in filas]


def test_ninguna_sentencia_de_coi_ni_de_la_biblioteca_lleva_dos_puntos_seguidos_de_letra_fuera_de_un_parametro(pg):
    """El analizador del Data API real no se pudo probar contra un literal como 'HH24:MI:SS' (`:MI` se
    parece a un parámetro nombrado). Se corre CADA función de COI y de la Biblioteca y se mira cada
    sentencia que mandó: todo `:nombre` debe ser un parámetro que de verdad se pasó (los `::tipo` de
    las conversiones no cuentan)."""
    u = nuevo()
    db.coi_estado(u)
    db.coi_tomar(u, "a", 3, 60, 20)
    db.coi_soltar(u, "a", fallo=True)
    db.coi_tomar(u, "b", 3, 60, 20)
    db.coi_soltar(u, "b")
    db.coi_tomar(u, "c", 3, 60, 20)
    db.coi_sumar(u, "c", 3)
    ids = [mio(u, n, clave=uuid.uuid4().hex)[1] for n in range(db.PAGINA_MIOS + 1)]
    mio(u, 99, clave="e" * 32)
    mio(u, 99, clave="e" * 32)                      # la clave repetida pasa por el SELECT del registro previo
    db.biblioteca_mios(u)                           # dos páginas: la segunda lleva el cursor
    db.biblioteca_contar_mios(u)
    db.biblioteca_ids_mios(u, ids)
    db.biblioteca_fijados(u)
    db.biblioteca_fijar(u, ids[:2])
    db.biblioteca_fijar(u, ids[:3], ids[:2])
    db.biblioteca_borrar_mio(u, ids[0])
    visto = 0
    for sentencia, params in pg.llamadas:
        if not any(t in sentencia for t in ("coi_estado", "biblioteca_")):
            continue
        visto += 1
        sin_casts = re.sub(r"::\w+", "", sentencia)
        sospechosos = [n for n in re.findall(r"(?<![:\w]):([A-Za-z_]\w*)", sin_casts) if n not in params]
        assert not sospechosos, f"{sospechosos} no son parámetros en: {sentencia[:200]}"
        assert not re.search(r"\w:[A-Za-z]", sin_casts) and "HH24" not in sentencia, sentencia[:200]
    assert visto >= 15


@pytest.mark.parametrize("instante,hoy,segundos,se_renueva", [
    ("2026-10-17 03:00:00+00", "2026-10-16", 3 * 3600, "2026-10-17T00:00:00-06:00"),   # UTC ya es 17, México aún 16
    ("2026-10-17 05:59:59+00", "2026-10-16", 1, "2026-10-17T00:00:00-06:00"),
    ("2026-10-17 06:00:00+00", "2026-10-17", 86400, "2026-10-18T00:00:00-06:00"),      # pasó la medianoche de México
    ("2026-10-16 00:30:00+00", "2026-10-15", 5 * 3600 + 1800, "2026-10-16T00:00:00-06:00"),
    ("2026-12-31 20:00:00+00", "2026-12-31", 10 * 3600, "2027-01-01T00:00:00-06:00"),   # fin de año
    ("2028-03-01 05:00:00+00", "2028-02-29", 3600, "2028-03-01T00:00:00-06:00"),       # bisiesto
    ("2021-07-01 12:00:00+00", "2021-07-01", 17 * 3600, "2021-07-02T00:00:00-05:00"),  # con horario de verano: el desfase se calcula, no se escribe
])
def test_el_dia_y_la_renovacion_son_de_mexico(pg, instante, hoy, segundos, se_renueva):
    r = _reloj(instante)
    assert r["hoy"] == hoy
    assert r["renueva_en_s"] == segundos
    assert r["se_renueva"] == se_renueva


@pytest.mark.parametrize("instante,dia", [
    ("2026-10-17 03:00:00+00", "2026-10-16"),        # en UTC ya es 17; en México todavía 16
    ("2026-10-17 05:59:59+00", "2026-10-16"),
    ("2026-10-17 06:00:00+00", "2026-10-17"),
    ("2026-01-01 05:00:00+00", "2025-12-31"),
])
def test_la_expresion_del_dia_que_usan_el_candado_y_la_suma_es_la_de_mexico(pg, instante, dia):
    """`db._HOY_COI` es la expresión que interpolan coi_tomar y coi_sumar para fechar la fila."""
    expr = db._HOY_COI.replace("now()", f"TIMESTAMPTZ '{instante}'")
    assert sql(f"SELECT {expr}::text AS d")[0]["d"] == dia


def test_estado_vacio_y_su_forma(pg):
    e = db.coi_estado(nuevo())
    assert set(e) == {"usos", "fallos", "en_curso", "renueva_en_s", "se_renueva"}
    assert (e["usos"], e["fallos"], e["en_curso"]) == (0, 0, False)
    assert 0 < e["renueva_en_s"] <= 86400
    manana = sql("SELECT to_char((now() AT TIME ZONE 'America/Mexico_City')::date + 1, 'YYYY-MM-DD') AS d")[0]["d"]
    assert e["se_renueva"] == f"{manana}T00:00:00-06:00"


# ---------------------------------------------------------------------------
# COI: el candado

def test_tomar_soltar_y_la_en_curso(pg):
    u = nuevo()
    assert db.coi_tomar(u, "a", 3, 60) is True
    assert db.coi_estado(u)["en_curso"] is True
    assert db.coi_tomar(u, "b", 3, 60) is False                    # una sola en curso
    assert db.coi_soltar(u, "b") is False and db.coi_estado(u)["en_curso"] is True     # otro no lo suelta
    assert db.coi_soltar(u, "a") is True
    assert db.coi_estado(u)["en_curso"] is False and db.coi_estado(u)["usos"] == 0     # soltar NO suma
    assert db.coi_tomar(u, "c", 3, 60) is True


def test_sumar_cuenta_y_suelta_en_una_sentencia(pg):
    u = nuevo()
    assert db.coi_tomar(u, "a", 3, 60)
    pg.sentencias.clear()
    r = db.coi_sumar(u, "a", 3)
    assert len(pg.sentencias) == 1                                  # UNA sentencia
    assert r["usos"] == 1 and r["renueva_en_s"] > 0 and r["se_renueva"].endswith("-06:00")
    e = db.coi_estado(u)
    assert (e["usos"], e["en_curso"]) == (1, False)
    assert db.coi_sumar(u, "a", 3) is None                         # sin candado ya no suma


def test_sumar_con_candado_ajeno_no_suma_ni_toca(pg):
    u = nuevo()
    db.coi_tomar(u, "a", 3, 60)
    assert db.coi_sumar(u, "otro", 3) is None
    e = db.coi_estado(u)
    assert (e["usos"], e["en_curso"]) == (0, True)


def test_el_tope_esta_en_el_candado_y_en_la_suma(pg):
    u = nuevo()
    for n in (1, 2, 3):
        assert db.coi_tomar(u, f"c{n}", 3, 60)
        assert db.coi_sumar(u, f"c{n}", 3)["usos"] == n
    assert db.coi_tomar(u, "c4", 3, 60) is False                   # ya no hay cupo hoy
    assert db.coi_estado(u)["usos"] == 3
    # y aunque alguien se saltara el candado, la suma no pasa del tope
    sql("UPDATE coi_estado SET candado = 'robado' WHERE usuario = :u", u=u)
    assert db.coi_sumar(u, "robado", 3) is None
    assert db.coi_estado(u)["usos"] == 3


def test_el_candado_caducado_deja_pasar_y_el_viejo_ya_no_cuenta(pg):
    u = nuevo()
    assert db.coi_tomar(u, "viejo", 3, 60)
    assert db.coi_tomar(u, "nuevo", 3, 60) is False
    sql("UPDATE coi_estado SET en_curso_hasta = now() - interval '1 second' WHERE usuario = :u", u=u)
    assert db.coi_estado(u)["en_curso"] is False
    assert db.coi_tomar(u, "nuevo", 3, 60) is True
    assert db.coi_sumar(u, "viejo", 3) is None                     # el viejo no cuenta ni suelta lo del nuevo
    assert db.coi_soltar(u, "viejo") is False and db.coi_estado(u)["en_curso"] is True
    assert db.coi_sumar(u, "nuevo", 3)["usos"] == 1


def test_la_caducidad_es_la_pedida(pg):
    u = nuevo()
    db.coi_tomar(u, "a", 3, 60)
    seg = sql("SELECT extract(epoch FROM en_curso_hasta - now())::int AS s FROM coi_estado WHERE usuario = :u", u=u)[0]["s"]
    assert 55 <= seg <= 60


def test_cambio_de_dia_una_fila_de_ayer_reinicia_en_1(pg):
    u = nuevo()
    for n in (1, 2, 3):
        db.coi_tomar(u, f"c{n}", 3, 60)
        db.coi_sumar(u, f"c{n}", 3)
    assert db.coi_estado(u)["usos"] == 3 and db.coi_tomar(u, "x", 3, 60) is False
    sql("UPDATE coi_estado SET dia = dia - 1 WHERE usuario = :u", u=u)      # «ayer»
    assert db.coi_estado(u)["usos"] == 0                                     # hoy lleva 0
    assert db.coi_tomar(u, "hoy", 3, 60) is True
    r = db.coi_sumar(u, "hoy", 3)
    assert r["usos"] == 1                                                    # arranca en 1, no en 4
    hoy = sql("SELECT ((now() AT TIME ZONE 'America/Mexico_City')::date)::text AS d")[0]["d"]
    assert sql("SELECT dia::text AS d FROM coi_estado WHERE usuario = :u", u=u)[0]["d"] == hoy


def test_el_dia_de_la_fila_es_el_de_mexico_no_el_de_utc(pg):
    u = nuevo()
    db.coi_tomar(u, "a", 3, 60)
    fila = sql("SELECT dia::text AS d, ((now() AT TIME ZONE 'America/Mexico_City')::date)::text AS mx, "
               "((now() AT TIME ZONE 'UTC')::date)::text AS utc FROM coi_estado WHERE usuario = :u", u=u)[0]
    assert fila["d"] == fila["mx"]


def test_16_hilos_toman_el_candado_y_gana_exactamente_uno_25_veces(pg):
    for ronda in range(25):
        u = nuevo()
        ganadores = en_hilos(16, lambda i: db.coi_tomar(u, f"h{i}", 3, 60))
        assert sum(ganadores) == 1, f"ronda {ronda}: ganaron {sum(ganadores)}"


def test_hilos_que_repiten_el_ciclo_completo_nunca_pasan_de_3_contadas(pg):
    """8 «pestañas» que intentan una y otra vez estado → candado → (modelo) → suma, sin pausa."""
    u = nuevo()
    contadas, lock = [], threading.Lock()
    fin = time.monotonic() + 3

    def pestana(i):
        n = 0
        while time.monotonic() < fin:
            if db.coi_estado(u)["usos"] >= 3:
                break
            c = f"p{i}-{n}"
            n += 1
            if db.coi_tomar(u, c, 3, 60):
                time.sleep(0.01)                                   # el modelo
                r = db.coi_sumar(u, c, 3)
                if r:
                    with lock:
                        contadas.append(r["usos"])
        return None

    en_hilos(8, pestana)
    assert sorted(contadas) == [1, 2, 3]
    assert db.coi_estado(u)["usos"] == 3 and db.coi_estado(u)["en_curso"] is False


def test_el_aislamiento_entre_personas_en_el_candado_y_los_usos(pg):
    a, b = nuevo(), nuevo()
    for n in (1, 2, 3):
        db.coi_tomar(a, f"c{n}", 3, 60)
        db.coi_sumar(a, f"c{n}", 3)
    assert db.coi_tomar(a, "x", 3, 60) is False
    assert db.coi_tomar(b, "y", 3, 60) is True and db.coi_estado(b)["usos"] == 0
    assert db.coi_sumar(a, "y", 3) is None                          # el candado de b no vale para a


def test_la_tabla_no_guarda_texto(pg):
    """coi_estado solo tiene usuario, día, contador, vencimiento y candado: no hay dónde guardar texto."""
    cols = {f["column_name"]: f["data_type"] for f in
            sql("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='coi_estado'")}
    assert set(cols) == {"usuario", "dia", "usos", "fallos", "en_curso_hasta", "candado"}
    assert cols["fallos"] == "integer"           # un contador, nunca texto
    assert cols["candado"] == "text"           # aquí solo cabe el uuid hex que genera el API


# ---------------------------------------------------------------------------
# COI: los intentos que NO cuentan tienen su propio tope diario

def test_soltar_con_fallo_anota_el_intento_sin_sumar_un_uso_y_en_una_sentencia(pg):
    u = nuevo()
    for n in (1, 2, 3):
        assert db.coi_tomar(u, f"c{n}", 3, 60, 20)
        pg.sentencias.clear()
        assert db.coi_soltar(u, f"c{n}", fallo=True) is True
        assert len(pg.sentencias) == 1                              # UNA sentencia
        e = db.coi_estado(u)
        assert (e["usos"], e["fallos"], e["en_curso"]) == (0, n, False)
    assert db.coi_tomar(u, "sin-fallo", 3, 60, 20) and db.coi_soltar(u, "sin-fallo") is True
    assert db.coi_estado(u)["fallos"] == 3                          # soltar a secas no anota nada
    assert db.coi_tomar(u, "mio", 3, 60, 20)
    assert db.coi_soltar(u, "ajeno", fallo=True) is False           # un candado ajeno no anota ni suelta
    e = db.coi_estado(u)
    assert (e["fallos"], e["en_curso"]) == (3, True)


def test_el_tope_de_fallos_esta_en_el_candado(pg):
    u = nuevo()
    for n in range(5):
        assert db.coi_tomar(u, f"c{n}", 3, 60, 5)
        db.coi_soltar(u, f"c{n}", fallo=True)
    assert db.coi_estado(u)["fallos"] == 5
    assert db.coi_tomar(u, "otro", 3, 60, 5) is False               # llegó al tope de intentos
    assert db.coi_tomar(u, "sin-tope", 3, 60) is True               # sin `tope_fallos` no hay tope (compatibilidad)
    assert db.coi_estado(u)["usos"] == 0                            # y nunca tocó los usos


def test_los_fallos_se_renuevan_con_el_dia_de_mexico(pg):
    u = nuevo()
    for n in range(20):
        db.coi_tomar(u, f"c{n}", 3, 60, 20)
        db.coi_soltar(u, f"c{n}", fallo=True)
    assert db.coi_tomar(u, "x", 3, 60, 20) is False
    sql("UPDATE coi_estado SET dia = dia - 1 WHERE usuario = :u", u=u)          # «ayer»
    assert db.coi_estado(u)["fallos"] == 0                                       # hoy lleva 0
    assert db.coi_tomar(u, "hoy", 3, 60, 20) is True
    assert db.coi_soltar(u, "hoy", fallo=True) is True
    assert (db.coi_estado(u)["fallos"], db.coi_estado(u)["usos"]) == (1, 0)      # arranca en 1, no en 21
    hoy = sql("SELECT ((now() AT TIME ZONE 'America/Mexico_City')::date)::text AS d")[0]["d"]
    assert sql("SELECT dia::text AS d FROM coi_estado WHERE usuario = :u", u=u)[0]["d"] == hoy


def test_el_cambio_de_dia_deja_en_cero_los_fallos_y_en_1_los_usos_al_sumar_y_al_soltar(pg):
    u = nuevo()
    for n in range(3):
        db.coi_tomar(u, f"f{n}", 3, 60, 20)
        db.coi_soltar(u, f"f{n}", fallo=True)
    db.coi_tomar(u, "uno", 3, 60, 20)
    db.coi_sumar(u, "uno", 3)
    fila = sql("SELECT usos, fallos FROM coi_estado WHERE usuario = :u", u=u)[0]
    assert (fila["usos"], fila["fallos"]) == (1, 3)                 # el mismo día se conservan los fallos
    sql("UPDATE coi_estado SET dia = dia - 1 WHERE usuario = :u", u=u)
    db.coi_tomar(u, "dos", 3, 60, 20)
    assert db.coi_sumar(u, "dos", 3)["usos"] == 1                   # arranca en 1
    fila = sql("SELECT usos, fallos FROM coi_estado WHERE usuario = :u", u=u)[0]
    assert (fila["usos"], fila["fallos"]) == (1, 0)                 # y los fallos de ayer no se arrastran


def test_hilos_que_fallan_una_y_otra_vez_nunca_pasan_del_tope_de_intentos(pg):
    """8 «pestañas» que repiten estado → candado → fallo, sin pausa: el tope está EN el candado, así que
    por mucho que compitan nunca se anotan más de 20 ni se suma un solo uso."""
    u = nuevo()
    anotados, lock = [], threading.Lock()
    fin = time.monotonic() + 3

    def pestana(i):
        n = 0
        while time.monotonic() < fin:
            if db.coi_estado(u)["fallos"] >= 20:
                break
            c = f"p{i}-{n}"
            n += 1
            if db.coi_tomar(u, c, 3, 60, 20):
                time.sleep(0.005)                                   # la llamada que falla
                if db.coi_soltar(u, c, fallo=True):
                    with lock:
                        anotados.append(c)
        return None

    en_hilos(8, pestana)
    e = db.coi_estado(u)
    assert len(anotados) == 20 and (e["fallos"], e["usos"], e["en_curso"]) == (20, 0, False)


# ---------------------------------------------------------------------------
# Biblioteca: los «Míos» y los fijados

def mio(u, n=0, **kw):
    campos = dict(id_=f"mio-{uuid.uuid4().hex[:12]}", clave=None, titulo=f"T{n}", para_que="", prompt=f"P{n}",
                  categoria="guion", etiquetas=["a", "b"], origen="coi", tope=100)
    campos.update(kw)
    return db.biblioteca_crear_mio(u, **campos), campos["id_"]


def test_crear_listar_y_el_mas_nuevo_primero(pg):
    u = nuevo()
    (r1, creado1), id1 = mio(u, 1)
    assert creado1 is True and r1["id"] == id1 and r1["etiquetas"] == ["a", "b"]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", r1["creado"])
    ids = [id1]
    for n in range(2, 9):                  # ocho guardados DENTRO del mismo segundo: el orden no puede ser azar
        time.sleep(0.005)
        ids.append(mio(u, n)[1])
    assert [m["id"] for m in db.biblioteca_mios(u)] == list(reversed(ids))
    assert set(db.biblioteca_mios(u)[0]) == {"id", "titulo", "para_que", "prompt", "categoria", "etiquetas", "origen", "creado"}


@pytest.mark.parametrize("cuantos", [0, 1, 7, 8, 9, 16, 25])
def test_listar_los_mios_en_paginas_completos_y_en_orden(pg, cuantos):
    """El Data API real corta una respuesta a 1 MiB: los «míos» se leen por páginas y salen todos, en orden."""
    u = nuevo()
    ids = [mio(u, n)[1] for n in range(cuantos)]
    pg.sentencias.clear()
    assert [m["id"] for m in db.biblioteca_mios(u)] == list(reversed(ids))
    lecturas = [x for x in pg.sentencias if "FROM biblioteca_mios" in x]
    # por CLAVE (creado, id), nunca por posición: ver test_los_mios_no_se_repiten_...
    assert all("LIMIT :n" in x and "OFFSET" not in x for x in lecturas)
    assert len(lecturas) == cuantos // db.PAGINA_MIOS + 1      # una más cuando la última página sale llena


@pytest.mark.parametrize("otra_pestana", ["borra el mas nuevo", "guarda uno nuevo", "borra uno ya leido"])
def test_los_mios_no_se_repiten_ni_se_saltan_si_otra_pestana_escribe_entre_paginas(pg, otra_pestana):
    """Cada página es UNA sentencia aparte (sin snapshot). Con OFFSET, un borrado o un guardado de otra pestaña entre
    dos páginas corre las filas: una sale dos veces o una viva se salta (y si estaba fijada, su pin se omite de `fijados`)."""
    u = nuevo()
    ids = [mio(u, n)[1] for n in range(db.PAGINA_MIOS + 4)]       # ids[-1] es el más nuevo
    original, hecho = db.ejecutar, []

    def con_la_otra_pestana(sentencia, params=None):
        filas = original(sentencia, params)
        if "FROM biblioteca_mios" in sentencia and "ORDER BY" in sentencia and not hecho:
            hecho.append(1)                                          # justo después de leer la primera página
            if otra_pestana == "guarda uno nuevo":
                mio(u, 99)
            else:
                db.biblioteca_borrar_mio(u, ids[-1] if otra_pestana == "borra el mas nuevo" else ids[-2])
        return filas
    db.ejecutar = con_la_otra_pestana
    try:
        leidos = [m["id"] for m in db.biblioteca_mios(u)]
    finally:
        db.ejecutar = original
    assert hecho, "la carrera no se disparó: la prueba no probó nada"
    assert len(leidos) == len(set(leidos)), "una fila salió dos veces"
    borrado = {"borra el mas nuevo": ids[-1], "borra uno ya leido": ids[-2]}.get(otra_pestana)
    assert set(ids) - {borrado} <= set(leidos), "una fila viva se saltó"


def test_los_mios_con_la_misma_fecha_o_con_microsegundos_distintos_salen_en_orden_y_sin_perder_ninguno(pg):
    """El cursor es el texto completo de `creado` (microsegundos incluidos): doce filas con la MISMA fecha
    (empata el id) cruzando el borde de una página, y otras con fechas que solo difieren en microsegundos."""
    u = nuevo()
    iguales = sorted(mio(u, n)[1] for n in range(db.PAGINA_MIOS + 4))
    sql("UPDATE biblioteca_mios SET creado = timestamptz '2026-10-16 18:20:00.123456+00' WHERE usuario = :u", u=u)
    cercanos = [mio(u, 100 + n)[1] for n in range(5)]
    for n, i in enumerate(cercanos):                                  # 2026-10-16 18:20:01.00000N: el mismo segundo
        sql("UPDATE biblioteca_mios SET creado = timestamptz '2026-10-16 18:20:01+00' + (:us * interval '1 microsecond') "
            "WHERE usuario = :u AND id = :i", us=n + 1, u=u, i=i)
    leidos = [m["id"] for m in db.biblioteca_mios(u)]
    assert leidos == list(reversed(cercanos)) + iguales             # más nuevo primero; los empates, por id
    assert len(leidos) == len(set(leidos)) == len(iguales) + len(cercanos)


def test_el_aislamiento_de_los_mios_tambien_con_el_cursor(pg):
    a, b = nuevo(), nuevo()
    ids_a = [mio(a, n)[1] for n in range(db.PAGINA_MIOS + 2)]
    [mio(b, n) for n in range(db.PAGINA_MIOS + 2)]
    assert [m["id"] for m in db.biblioteca_mios(a)] == list(reversed(ids_a))


def test_cien_mios_del_tamano_maximo_se_leen_sin_pasar_de_un_mib_por_respuesta(pg):
    from server import biblioteca_api
    tam = biblioteca_api.MAX_PROMPT
    u = nuevo()
    for n in range(100):
        mio(u, n, prompt="ñ" * tam, tope=100)
    maximo, original = [0], pg.ejecutar

    def medido(sql, params=None):
        filas = original(sql, params)
        import json
        maximo[0] = max(maximo[0], len(json.dumps(filas)))        # json.dumps escapa como lo haría el Data API
        return filas
    db.ejecutar = medido
    try:
        todos = db.biblioteca_mios(u)
    finally:
        db.ejecutar = original
    assert len(todos) == 100 and all(len(m["prompt"]) == tam for m in todos)
    assert maximo[0] < 1024 * 1024, f"una respuesta de {maximo[0]} bytes pasaría el límite del Data API"


def test_texto_con_acentos_comillas_y_saltos_se_guarda_tal_cual(pg):
    u = nuevo()
    texto = "#CONTEXTO\nEres «ñoño», dices 'hola' y \"adiós\"; 100% {llaves} :dos_puntos \\ barra\n\n#OBJETIVO\n✓"
    (r, _), _ = mio(u, prompt=texto, titulo="Tí'tulo \"raro\"", etiquetas=["ñ", "é"])
    assert r["prompt"] == texto and r["titulo"] == "Tí'tulo \"raro\"" and r["etiquetas"] == ["ñ", "é"]


def test_la_clave_hace_idempotente_el_guardado(pg):
    u, clave = nuevo(), uuid.uuid4().hex
    (a, creado_a), _ = mio(u, clave=clave)
    (b, creado_b), _ = mio(u, clave=clave)
    assert (creado_a, creado_b) == (True, False) and a["id"] == b["id"]
    assert len(db.biblioteca_mios(u)) == 1


def test_16_hilos_con_la_misma_clave_crean_uno_solo_y_todos_ven_el_mismo(pg):
    for _ in range(10):
        u, clave = nuevo(), uuid.uuid4().hex
        resultados = en_hilos(16, lambda i: mio(u, i, clave=clave)[0])
        assert sum(1 for _r, creado in resultados if creado) == 1
        assert len({r["id"] for r, _c in resultados}) == 1
        assert len(db.biblioteca_mios(u)) == 1


def test_la_misma_clave_de_otra_persona_es_otro_registro(pg):
    a, b, clave = nuevo(), nuevo(), uuid.uuid4().hex
    (ra, _), _ = mio(a, clave=clave)
    (rb, creado), _ = mio(b, clave=clave)
    assert creado is True and ra["id"] != rb["id"]


def test_reintentar_con_una_clave_que_otra_persona_tambien_tiene_devuelve_lo_propio(pg):
    """Guardián de aislamiento: el SELECT del registro previo filtra por persona Y clave. Sin `usuario = :u`,
    quien reintenta su guardado recibiría el prompt privado de otra persona que usó la misma clave."""
    a, b, clave = nuevo(), nuevo(), uuid.uuid4().hex
    (rb, _), _ = mio(b, clave=clave, titulo="PRIVADO DE B", prompt="secreto de B")
    (ra, creado_a), _ = mio(a, clave=clave, titulo="DE A", prompt="secreto de A")
    assert creado_a is True and ra["id"] != rb["id"]
    for _ in range(3):
        (otra_a, creado), _ = mio(a, clave=clave, titulo="DE A", prompt="secreto de A")
        assert creado is False and otra_a["id"] == ra["id"] and otra_a["titulo"] == "DE A"
        (otra_b, creado), _ = mio(b, clave=clave, titulo="PRIVADO DE B", prompt="secreto de B")
        assert creado is False and otra_b["id"] == rb["id"] and otra_b["prompt"] == "secreto de B"
    assert len(db.biblioteca_mios(a)) == len(db.biblioteca_mios(b)) == 1


def test_el_tope_de_mios_y_borrar_siempre_se_puede(pg):
    u = nuevo()
    (r, _), _ = mio(u, 0, clave="f" * 32, tope=3)
    for n in (1, 2):
        assert mio(u, n, tope=3)[0][1] is True
    assert mio(u, 9, tope=3)[0] is None                              # lleno
    assert db.biblioteca_contar_mios(u) == 3
    # repetir una clave existente con la lista llena sigue siendo idempotente
    assert mio(u, 0, clave="f" * 32, tope=3)[0] == (r, False)
    borrar = db.biblioteca_mios(u)[0]["id"]
    assert db.biblioteca_borrar_mio(u, borrar) is True
    assert mio(u, 9, tope=3)[0] is not None


def test_borrar_un_mio_lo_saca_de_los_fijados_sin_alterar_el_orden(pg):
    u = nuevo()
    (_, _), a = mio(u, 1)
    (_, _), b = mio(u, 2)
    db.biblioteca_fijar(u, ["casa-uno", a, b])
    assert db.biblioteca_borrar_mio(u, a) is True
    assert db.biblioteca_fijados(u) == ["casa-uno", b]
    assert db.biblioteca_borrar_mio(u, a) is False                   # ya no existe


def test_borrar_el_ultimo_fijado_deja_la_lista_vacia_y_no_null(pg):
    u = nuevo()
    (_, _), a = mio(u, 1)
    db.biblioteca_fijar(u, [a])
    db.biblioteca_borrar_mio(u, a)
    assert db.biblioteca_fijados(u) == []
    assert sql("SELECT ids::text AS i FROM biblioteca_fijados WHERE usuario = :u", u=u)[0]["i"] == "[]"


def test_borrar_sin_fila_de_fijados_funciona(pg):
    u = nuevo()
    (_, _), a = mio(u, 1)
    assert sql("SELECT 1 FROM biblioteca_fijados WHERE usuario = :u", u=u) == []
    assert db.biblioteca_borrar_mio(u, a) is True


def test_fijar_reemplaza_y_el_orden_se_conserva(pg):
    u = nuevo()
    assert db.biblioteca_fijados(u) == []
    db.biblioteca_fijar(u, ["casa-b", "casa-a", "casa-c"])
    assert db.biblioteca_fijados(u) == ["casa-b", "casa-a", "casa-c"]
    db.biblioteca_fijar(u, ["casa-c"])
    assert db.biblioteca_fijados(u) == ["casa-c"]
    db.biblioteca_fijar(u, [])
    assert db.biblioteca_fijados(u) == []


def test_fijar_con_antes_solo_escribe_si_nadie_lo_cambio(pg):
    u = nuevo()
    assert db.biblioteca_fijar(u, ["casa-a"], []) is True              # sin fila: lo esperado es la lista vacía
    assert db.biblioteca_fijados(u) == ["casa-a"]
    assert db.biblioteca_fijar(u, ["casa-b"], []) is False             # la pantalla creía [] y ya no lo es
    assert db.biblioteca_fijados(u) == ["casa-a"]                      # y no se escribió nada
    assert db.biblioteca_fijar(u, ["casa-b", "casa-a"], ["casa-a"]) is True
    assert db.biblioteca_fijar(u, ["casa-c"], ["casa-a"]) is False     # el orden y el contenido deben coincidir
    assert db.biblioteca_fijar(u, ["casa-c"], ["casa-a", "casa-b"]) is False
    assert db.biblioteca_fijados(u) == ["casa-b", "casa-a"]
    assert db.biblioteca_fijar(u, [], ["casa-b", "casa-a"]) is True    # vaciar también es una escritura con antes
    assert db.biblioteca_fijar(u, ["casa-x"], ["casa-b"]) is False
    assert db.biblioteca_fijados(u) == []
    assert db.biblioteca_fijar(u, ["casa-z"]) is True                   # sin `antes` escribe siempre, como antes


def test_fijar_con_antes_y_fila_inexistente_solo_gana_el_que_espera_vacio(pg):
    u = nuevo()
    assert db.biblioteca_fijar(u, ["casa-a"], ["casa-z"]) is False     # esperaba algo que nunca existió
    assert db.biblioteca_fijados(u) == [] and sql("SELECT 1 FROM biblioteca_fijados WHERE usuario = :u", u=u) == []


def test_fijar_con_antes_es_una_sola_sentencia(pg):
    u = nuevo()
    db.biblioteca_fijar(u, ["casa-a"])
    pg.sentencias.clear()
    db.biblioteca_fijar(u, ["casa-b"], ["casa-a"])
    assert len(pg.sentencias) == 1


@pytest.mark.parametrize("hay_fila", [False, True])
def test_12_hilos_que_fijan_con_la_misma_lista_vieja_gana_exactamente_uno_y_sus_ids_quedan(pg, hay_fila):
    for _ in range(10):
        u = nuevo()
        antes = []
        if hay_fila:
            db.biblioteca_fijar(u, ["casa-vieja"])
            antes = ["casa-vieja"]
        resultados = en_hilos(12, lambda i: db.biblioteca_fijar(u, [f"casa-h{i}"], antes))
        assert sum(resultados) == 1, resultados
        ganador = resultados.index(True)
        assert db.biblioteca_fijados(u) == [f"casa-h{ganador}"]


def test_ids_mios_son_solo_los_de_esa_persona(pg):
    a, b = nuevo(), nuevo()
    (_, _), ida = mio(a, 1)
    (_, _), idb = mio(b, 1)
    assert db.biblioteca_ids_mios(a, [ida, idb, "casa-x"]) == {ida}
    assert db.biblioteca_ids_mios(b, [ida, idb]) == {idb}
    assert db.biblioteca_ids_mios(a, []) == set()


def test_borrar_el_de_otra_persona_no_borra_nada(pg):
    a, b = nuevo(), nuevo()
    (_, _), ida = mio(a, 1)
    db.biblioteca_fijar(a, [ida])
    assert db.biblioteca_borrar_mio(b, ida) is False
    assert [m["id"] for m in db.biblioteca_mios(a)] == [ida] and db.biblioteca_fijados(a) == [ida]
    assert db.biblioteca_mios(b) == []


# ---------------------------------------------------------------------------
# el API completo contra la base real (modelo y moderación doblados)

class Modelo:
    def __init__(self):
        self.demora, self.error, self.llamadas = 0.0, None, 0
        self.fin = "stop"
        self.veredicto = moderacion.Veredicto(permitido=True)

    async def moderar(self, texto, **kw):
        return self.veredicto

    async def chat(self, system, user, **kw):
        import asyncio
        self.llamadas += 1
        await asyncio.sleep(self.demora)
        if self.error:
            raise self.error
        return ("#CONTEXTO\na\n#OBJETIVO\nb\n#INSTRUCCIONES\nc",
                {"modelo": "m", "entrada": 10, "salida": 5, "cache_leida": 0, "fin": self.fin})


@pytest.fixture
def api(pg, monkeypatch, casa_de_prueba):
    from fastapi.testclient import TestClient
    from server.app import app
    persona = {"u": nuevo()}
    modelo = Modelo()
    monkeypatch.setenv("OPENAI_API_KEY", "sk-de-mentira")
    monkeypatch.setattr(db, "backend", lambda: "postgres")
    monkeypatch.setattr(db, "usuario_actual", lambda: persona["u"])
    monkeypatch.setattr(moderacion, "revisar", modelo.moderar)
    monkeypatch.setattr(llm, "chat_texto", modelo.chat)
    api = type("Api", (), {})()
    api.persona, api.modelo, api.app, api.TestClient = persona, modelo, app, TestClient
    api.c = TestClient(app)
    return api


def coi_post(c):
    return c.post("/api/coi", json={"texto": "Quiero un plan para mi canal"})


def test_ocho_peticiones_simultaneas_a_lo_mucho_una_en_curso_y_nunca_mas_de_3(api):
    api.modelo.demora = 0.8
    u = api.persona["u"]
    estados = en_hilos(8, lambda i: api.TestClient(api.app).post("/api/coi", json={"texto": "hola"}).status_code)
    assert sorted(estados) == [200] + [409] * 7
    assert api.modelo.llamadas == 1 and db.coi_estado(u)["usos"] == 1
    # rondas de 8 a la vez hasta pasar de sobra el tope
    api.modelo.demora = 0.2
    todos = list(estados)
    for _ in range(6):
        todos += en_hilos(8, lambda i: api.TestClient(api.app).post("/api/coi", json={"texto": "hola"}).status_code)
    assert todos.count(200) == 3 and set(todos) <= {200, 409, 429}
    assert db.coi_estado(u)["usos"] == 3 and api.modelo.llamadas == 3
    assert sql("SELECT usos FROM coi_estado WHERE usuario = :u", u=u)[0]["usos"] == 3


def test_un_fallo_del_modelo_no_suma_y_suelta_el_candado(api):
    api.modelo.error = RuntimeError("boom")
    assert coi_post(api.c).status_code == 502
    e = db.coi_estado(api.persona["u"])
    assert (e["usos"], e["en_curso"]) == (0, False)
    api.modelo.error = None
    assert coi_post(api.c).json()["usos"] == 1


def test_una_moderacion_que_rechaza_no_suma(api):
    api.modelo.veredicto = moderacion.Veredicto(permitido=False, motivo="no pasa")
    r = coi_post(api.c)
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "moderacion"
    e = db.coi_estado(api.persona["u"])
    assert (e["usos"], e["en_curso"]) == (0, False) and api.modelo.llamadas == 0


def test_un_plazo_vencido_no_suma(api, monkeypatch):
    monkeypatch.setattr(coi, "PLAZO_MODELO_S", 0.3)
    monkeypatch.setattr(coi, "MIN_MODELO_S", 0.05)
    api.modelo.demora = 5
    r = coi_post(api.c)
    assert r.status_code == 504 and r.json()["detail"]["codigo"] == "tardo"
    e = db.coi_estado(api.persona["u"])
    assert (e["usos"], e["en_curso"]) == (0, False)


def test_los_intentos_que_no_cuentan_llegan_a_20_y_el_21_es_429_sin_llamar_a_nadie(api):
    """30 POST seguidos con la respuesta cortada por longitud: solo 20 llegan al modelo, el resto es 429
    `demasiados_intentos` (con los usos reales, no «agotado»), y ningún uso se gastó."""
    api.modelo.fin = "length"
    u = api.persona["u"]
    codigos = [coi_post(api.c) for _ in range(30)]
    assert [r.status_code for r in codigos] == [502] * 20 + [429] * 10
    assert api.modelo.llamadas == 20
    d = codigos[-1].json()["detail"]
    assert d["codigo"] == "demasiados_intentos" and "no se gastó ninguno" in d["texto"]
    assert (d["tope"], d["usos"], d["quedan"]) == (3, 0, 3) and d["renueva_en_s"] > 0 and d["se_renueva"].endswith("-06:00")
    e = db.coi_estado(u)
    assert (e["usos"], e["fallos"], e["en_curso"]) == (0, 20, False)
    # los dos 429 no se confunden
    api.modelo.fin = "stop"
    sql("UPDATE coi_estado SET dia = dia - 1 WHERE usuario = :u", u=u)              # «mañana»
    r = coi_post(api.c)
    assert r.status_code == 200 and r.json()["usos"] == 1
    assert db.coi_estado(u)["fallos"] == 0


def test_los_fallos_no_le_quitan_a_la_persona_sus_3_usos_buenos(api):
    api.modelo.fin = "length"
    for _ in range(19):
        assert coi_post(api.c).status_code == 502
    api.modelo.fin = "stop"
    assert [coi_post(api.c).status_code for _ in range(4)] == [200, 200, 200, 429]
    assert db.coi_estado(api.persona["u"])["usos"] == 3


def test_ocho_peticiones_a_la_vez_en_el_ultimo_intento_a_lo_mucho_llegan_20_al_modelo(api):
    """El tope de intentos está EN el candado: con 19 anotados y 8 peticiones simultáneas que fallan, solo una
    llega al modelo; las demás encuentran la otra en curso (409) o el tope (429)."""
    api.modelo.error = RuntimeError("boom")
    api.modelo.demora = 0.3
    u = api.persona["u"]
    sql("INSERT INTO coi_estado (usuario, dia, usos, fallos) VALUES (:u, (now() AT TIME ZONE 'America/Mexico_City')::date, 0, 19)", u=u)
    estados = en_hilos(8, lambda i: api.TestClient(api.app).post("/api/coi", json={"texto": "hola"}).status_code)
    assert estados.count(502) == 1 and set(estados) <= {409, 429, 502}
    assert api.modelo.llamadas == 1 and db.coi_estado(u)["fallos"] == 20
    assert coi_post(api.c).json()["detail"]["codigo"] == "demasiados_intentos"
    assert api.modelo.llamadas == 1


def test_el_cambio_de_dia_reinicia_en_1_por_el_api(api):
    u = api.persona["u"]
    for _ in range(3):
        assert coi_post(api.c).status_code == 200
    assert coi_post(api.c).status_code == 429
    sql("UPDATE coi_estado SET dia = dia - 1 WHERE usuario = :u", u=u)
    est = api.c.get("/api/coi/estado").json()
    assert (est["usos"], est["quedan"]) == (0, 3)
    r = coi_post(api.c)
    assert r.status_code == 200 and (r.json()["usos"], r.json()["quedan"]) == (1, 2)


def test_el_candado_caducado_deja_pasar_por_el_api(api):
    u = api.persona["u"]
    assert db.coi_tomar(u, "de-otra-lambda-que-murio", 3, 60)
    assert coi_post(api.c).status_code == 409
    sql("UPDATE coi_estado SET en_curso_hasta = now() - interval '1 second' WHERE usuario = :u", u=u)
    assert coi_post(api.c).status_code == 200


def test_429_trae_cuando_se_renueva_y_el_estado_coincide(api):
    for _ in range(3):
        coi_post(api.c)
    d = coi_post(api.c).json()["detail"]
    est = api.c.get("/api/coi/estado").json()
    assert d["codigo"] == "agotado" and d["quedan"] == 0
    assert abs(d["renueva_en_s"] - est["renueva_en_s"]) <= 2 and d["se_renueva"] == est["se_renueva"]
    assert est["usos"] == 3 and est["quedan"] == 0


def test_aislamiento_entre_dos_personas_por_el_api(api):
    a = api.persona["u"]
    for _ in range(3):
        coi_post(api.c)
    assert coi_post(api.c).status_code == 429
    api.persona["u"] = nuevo()
    assert api.c.get("/api/coi/estado").json()["usos"] == 0
    assert coi_post(api.c).status_code == 200
    assert db.coi_estado(a)["usos"] == 3


def test_la_biblioteca_completa_por_el_api(api):
    c = api.c
    casa = [p["id"] for p in c.get("/api/biblioteca").json()["casa"]]
    # guardar con clave (doble clic), fijar 3 en orden, el 4.º no, borrar un mío lo quita
    g = {"titulo": "Mi plan", "prompt": "#CONTEXTO\nx", "categoria": "guion", "etiquetas": ["a"], "origen": "coi",
         "clave": uuid.uuid4().hex}
    r1, r2 = c.post("/api/biblioteca/mios", json=g), c.post("/api/biblioteca/mios", json=g)
    assert (r1.status_code, r2.status_code) == (201, 200) and r1.json() == r2.json()
    mio_id = r1.json()["prompt"]["id"]
    assert c.put("/api/biblioteca/fijados", json={"ids": [casa[2], mio_id, casa[0]]}).json()["fijados"] == [casa[2], mio_id, casa[0]]
    assert c.put("/api/biblioteca/fijados", json={"ids": casa[:4]}).json()["detail"]["codigo"] == "demasiados"
    assert c.get("/api/biblioteca").json()["fijados"] == [casa[2], mio_id, casa[0]]
    assert c.delete(f"/api/biblioteca/mios/{mio_id}").status_code == 200
    d = c.get("/api/biblioteca").json()
    assert d["mios"] == [] and d["fijados"] == [casa[2], casa[0]]
    assert c.delete(f"/api/biblioteca/mios/{mio_id}").status_code == 404


def test_dos_put_con_la_misma_lista_esperada_uno_gana_y_el_otro_recibe_la_vigente(api):
    """Compare-and-set por el API completo: dos pantallas con la misma lista vieja fijan a la vez."""
    c = api.c
    casa = [p["id"] for p in c.get("/api/biblioteca").json()["casa"]]
    assert c.put("/api/biblioteca/fijados", json={"ids": [casa[0]], "esperada": []}).status_code == 200
    for ronda in range(6):
        ahora = c.get("/api/biblioteca").json()["fijados"]
        resultados = en_hilos(2, lambda i: api.TestClient(api.app).put(
            "/api/biblioteca/fijados", json={"ids": [casa[1 + i], casa[0]], "esperada": ahora}))
        assert sorted(r.status_code for r in resultados) == [200, 409], [r.status_code for r in resultados]
        perdedor = next(r for r in resultados if r.status_code == 409).json()["detail"]
        ganador = next(r for r in resultados if r.status_code == 200).json()["fijados"]
        assert perdedor["codigo"] == "cambiaron" and perdedor["fijados"] == ganador
        assert c.get("/api/biblioteca").json()["fijados"] == ganador
        assert c.put("/api/biblioteca/fijados", json={"ids": [casa[0]], "esperada": ganador}).status_code == 200


def test_la_biblioteca_no_deja_ver_fijar_ni_borrar_lo_de_otra_persona(api):
    c = api.c
    mio_id = c.post("/api/biblioteca/mios", json={"titulo": "Privado", "prompt": "p"}).json()["prompt"]["id"]
    api.persona["u"] = nuevo()
    d = c.get("/api/biblioteca").json()
    assert d["mios"] == [] and d["fijados"] == []
    r = c.put("/api/biblioteca/fijados", json={"ids": [mio_id]})
    assert r.status_code == 422 and r.json()["detail"]["codigo"] == "desconocido"
    assert c.delete(f"/api/biblioteca/mios/{mio_id}").status_code == 404


def test_guardar_no_gasta_un_uso_de_coi(api):
    api.c.post("/api/biblioteca/mios", json={"titulo": "T", "prompt": "p"})
    assert db.coi_estado(api.persona["u"])["usos"] == 0 and api.modelo.llamadas == 0
