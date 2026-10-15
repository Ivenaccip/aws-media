"""E2 — la capa de datos de la copia editable (`pipeline/db.py`).

Dos niveles, para no confiar en un doble que siempre dice que sí:

1. El SQL de las funciones nuevas corre DE VERDAD contra un SQLite en disco
   (como `test_nombres_editor.py`), traduciendo lo único que SQLite no entiende
   de Postgres: los casts, `jsonb_set` y el operador `#>>`. Así se prueba el
   comportamiento del candado, no un mock: el índice parcial único rechaza la
   segunda copia corriendo de una persona, el claim del reintento gana una sola
   vez y el borrado jamás toca una copia ya cobrada.
2. Un espía en `db.ejecutar` fija el SQL que se manda (las cláusulas que son la
   regla de negocio), para que no se pierdan al reescribir una consulta.

Nada de red ni de Aurora.
"""
import json
import re
import sqlite3

import pytest

from pipeline import db

NOMBRE = "ed-9f1c0a7b"


def _ruta(grupo: str) -> str:
    return "$." + grupo.replace(",", ".")


def _a_sqlite(sql: str) -> str:
    """Lo único del SQL de db.py que SQLite no entiende. Los booleanos de un jsonb
    salen como texto en Postgres (`#>> … = 'true'`); en SQLite son 1 y 0."""
    sql = re.sub(r"::(jsonb|text|timestamptz)\b", "", sql).replace("now()", "CURRENT_TIMESTAMP")
    sql = re.sub(r"doc #>> '\{([\w,]+)\}' = '(true|false)'",
                 lambda m: f"json_extract(doc, '{_ruta(m.group(1))}') = {1 if m.group(2) == 'true' else 0}", sql)
    sql = re.sub(r"doc #>> '\{([\w,]+)\}'", lambda m: f"json_extract(doc, '{_ruta(m.group(1))}')", sql)
    sql = re.sub(r"\(doc #> '\{([\w,]+)\}'\)", lambda m: f"json_extract(doc, '{_ruta(m.group(1))}')", sql)
    return re.sub(r"jsonb_set\((\w+), '\{(\w+)\}', (:\w+)\)", r"json_set(\1, '$.\2', json(\3))", sql)


@pytest.fixture
def base(monkeypatch, tmp_path):
    ruta = tmp_path / "aurora.sqlite"
    sentencias: list[str] = []

    def ejecutar(sql, params=None):
        sentencias.append(sql)
        con = sqlite3.connect(ruta, timeout=30, isolation_level=None)
        con.row_factory = sqlite3.Row
        try:
            return [dict(f) for f in con.execute(_a_sqlite(sql), params or {}).fetchall()]
        except sqlite3.IntegrityError as err:
            # el Data API de Aurora lo cuenta así
            raise RuntimeError(f"An error occurred (BadRequestException): ERROR: duplicate key value "
                               f"violates unique constraint ({err})") from None
        finally:
            con.close()

    for sentencia in db.ESQUEMA:
        m = re.search(r"CREATE TABLE IF NOT EXISTS (\w+) \(", sentencia)
        if (m and m.group(1) in ("usuarios", "proyectos_editor", "nombres_editor")) \
                or "proyectos_editor_copia_en_curso" in sentencia:
            ejecutar(sentencia)
    sentencias.clear()
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    ejecutar.sentencias = sentencias
    return ejecutar


def copia(estado="corriendo", cobrado=True, **extra):
    return json.dumps({"titulo": "T", "subidas": [],
                       "editar": {"copia": True, "estado": estado, "cobrado": cobrado, "creditos": 2, **extra}})


def estado_de(base, user, nombre):
    f = base("SELECT doc FROM proyectos_editor WHERE user_id = :u AND nombre = :n", {"u": user, "n": nombre})
    return json.loads(f[0]["doc"]) if f else None


# ---------------------------------------------------------------------------
# el esquema

def test_el_esquema_trae_el_indice_parcial_unico_y_es_idempotente():
    sentencia = next(s for s in db.ESQUEMA if "proyectos_editor_copia_en_curso" in s)
    plano = " ".join(sentencia.split())
    assert plano.startswith("CREATE UNIQUE INDEX IF NOT EXISTS proyectos_editor_copia_en_curso ON proyectos_editor (user_id)")
    assert "doc #>> '{editar,estado}' = 'corriendo'" in plano
    assert "doc #>> '{editar,copia}' = 'true'" in plano
    assert plano.count(" WHERE ") == 1 and " AND " in plano
    assert sum("proyectos_editor_copia_en_curso" in s for s in db.ESQUEMA) == 1
    # IF NOT EXISTS: correr la migración dos veces no falla (y no cuesta nada si ya está)
    assert "IF NOT EXISTS" in sentencia


def test_el_indice_se_crea_dos_veces_sin_error_en_la_base_de_prueba(base):
    sentencia = next(s for s in db.ESQUEMA if "proyectos_editor_copia_en_curso" in s)
    base(sentencia)
    base(sentencia)


def test_el_indice_es_la_ultima_sentencia_del_esquema_que_toca_proyectos_editor():
    """No depende de ninguna columna nueva: solo del jsonb que ya existe."""
    i = next(k for k, s in enumerate(db.ESQUEMA) if "proyectos_editor_copia_en_curso" in s)
    assert i == len(db.ESQUEMA) - 1 or all("proyectos_editor" not in s for s in db.ESQUEMA[i + 1:])
    assert not any("ALTER TABLE proyectos_editor" in s for s in db.ESQUEMA)


# ---------------------------------------------------------------------------
# crear_copia_editor: el candado

def test_crear_copia_inserta_y_dice_que_si(base):
    assert db.crear_copia_editor("u1", NOMBRE, copia()) is True
    assert estado_de(base, "u1", NOMBRE)["editar"]["estado"] == "corriendo"
    assert base("SELECT id FROM usuarios WHERE id = 'u1'")


def test_crear_copia_usa_insert_con_on_conflict_do_nothing_returning(base):
    db.crear_copia_editor("u1", NOMBRE, copia())
    sql = " ".join(base.sentencias[-1].split())
    assert sql.startswith("INSERT INTO proyectos_editor") and "ON CONFLICT DO NOTHING" in sql
    assert sql.endswith("RETURNING nombre") and "DO UPDATE" not in sql


def test_crear_copia_no_pisa_la_que_ya_existe(base):
    """No es `guardar_proyecto_editor` (upsert): una copia ya cobrada no se sobrescribe."""
    db.crear_copia_editor("u1", NOMBRE, copia(estado="listo", creditos=8))
    assert db.crear_copia_editor("u1", NOMBRE, copia(estado="corriendo", creditos=2)) is False
    d = estado_de(base, "u1", NOMBRE)["editar"]
    assert d["estado"] == "listo" and d["creditos"] == 8


def test_el_indice_rechaza_la_segunda_copia_corriendo_de_la_misma_persona(base):
    assert db.crear_copia_editor("u1", "ed-uno", copia()) is True
    assert db.crear_copia_editor("u1", "ed-dos", copia()) is False
    assert estado_de(base, "u1", "ed-dos") is None


def test_el_indice_no_estorba_a_otra_persona_ni_a_lo_ya_terminado(base):
    assert db.crear_copia_editor("u1", "ed-uno", copia()) is True
    assert db.crear_copia_editor("u2", "ed-uno", copia()) is True           # otra persona
    assert db.crear_copia_editor("u1", "ed-listo", copia(estado="listo")) is True
    assert db.crear_copia_editor("u1", "ed-error", copia(estado="error")) is True


def test_el_indice_no_cuenta_las_corridas_viejas_de_e1(base):
    """Una corrida de /api/editar/<p>/sugerir no lleva `editar.copia`: no ocupa el candado."""
    db.guardar_proyecto_editor("u1", "viejo", json.dumps({"editar": {"estado": "corriendo", "creditos": 4}}))
    assert db.crear_copia_editor("u1", NOMBRE, copia()) is True


def test_cuando_la_corrida_termina_el_candado_se_suelta(base):
    db.crear_copia_editor("u1", "ed-uno", copia())
    db.fijar_campo_editor("u1", "ed-uno", "editar", json.dumps({"copia": True, "estado": "listo"}))
    assert db.crear_copia_editor("u1", "ed-dos", copia()) is True


# ---------------------------------------------------------------------------
# ediciones_corriendo

def test_ediciones_corriendo_trae_copias_y_corridas_viejas_pero_solo_las_corriendo(base):
    db.crear_copia_editor("u1", "ed-uno", copia(inicio="2026-10-15T10:00:00+00:00"))
    db.crear_copia_editor("u1", "ed-listo", copia(estado="listo"))
    db.crear_copia_editor("u1", "ed-error", copia(estado="error"))
    db.guardar_proyecto_editor("u1", "viejo", json.dumps({"editar": {"estado": "corriendo", "creditos": 4}}))
    db.guardar_proyecto_editor("u1", "sin_editar", json.dumps({"subidas": []}))
    db.crear_copia_editor("u2", "ed-de-otra", copia())
    filas = {f["nombre"]: f["editar"] for f in db.ediciones_corriendo("u1")}
    assert set(filas) == {"ed-uno", "viejo"}
    assert filas["ed-uno"]["inicio"] == "2026-10-15T10:00:00+00:00" and filas["ed-uno"]["copia"] is True
    assert filas["viejo"]["creditos"] == 4


def test_ediciones_corriendo_no_filtra_la_caducidad_en_sql(base):
    """Un cast de fecha roto dentro del SQL tumbaría el botón «Iniciar» de todos: se filtra en Python."""
    db.crear_copia_editor("u1", "ed-uno", copia(inicio="no es una fecha"))
    assert [f["nombre"] for f in db.ediciones_corriendo("u1")] == ["ed-uno"]
    sql = base.sentencias[-1]
    assert "inicio" not in sql and "interval" not in sql.lower() and "timestamptz" not in sql


# ---------------------------------------------------------------------------
# reclamar_reintento_editor: el claim

def test_el_claim_del_reintento_gana_una_sola_vez(base):
    db.crear_copia_editor("u1", NOMBRE, copia(estado="error", error="x"))
    nuevo = json.dumps({"copia": True, "estado": "corriendo", "cobrado": False, "creditos": 2, "reintentos": 1})
    assert db.reclamar_reintento_editor("u1", NOMBRE, nuevo) is True
    assert db.reclamar_reintento_editor("u1", NOMBRE, nuevo) is False          # el doble clic
    assert estado_de(base, "u1", NOMBRE)["editar"]["reintentos"] == 1


def test_el_claim_solo_aplica_a_una_copia_en_error(base):
    nuevo = json.dumps({"copia": True, "estado": "corriendo"})
    db.crear_copia_editor("u1", "ed-listo", copia(estado="listo"))
    db.crear_copia_editor("u1", "ed-corriendo", copia(estado="corriendo"))
    db.guardar_proyecto_editor("u1", "viejo", json.dumps({"editar": {"estado": "error", "creditos": 4}}))
    for n in ("ed-listo", "ed-corriendo", "viejo", "no_existe"):
        assert db.reclamar_reintento_editor("u1", n, nuevo) is False, n
    assert estado_de(base, "u1", "viejo")["editar"]["estado"] == "error"       # una corrida vieja no es una copia


def test_el_claim_de_otra_persona_no_toca_la_copia(base):
    db.crear_copia_editor("u1", NOMBRE, copia(estado="error"))
    assert db.reclamar_reintento_editor("u2", NOMBRE, json.dumps({"copia": True, "estado": "corriendo"})) is False
    assert estado_de(base, "u1", NOMBRE)["editar"]["estado"] == "error"


def test_si_el_indice_rechaza_el_claim_es_false_no_una_excepcion(base):
    db.crear_copia_editor("u1", "ed-error", copia(estado="error"))
    db.crear_copia_editor("u1", "ed-otra", copia(estado="corriendo"))
    nuevo = json.dumps({"copia": True, "estado": "corriendo"})
    assert db.reclamar_reintento_editor("u1", "ed-error", nuevo) is False
    assert estado_de(base, "u1", "ed-error")["editar"]["estado"] == "error"


def test_otro_error_del_data_api_si_se_propaga(monkeypatch):
    def truena(sql, params=None):
        raise RuntimeError("An error occurred (BadRequestException): connection refused")
    monkeypatch.setattr(db, "ejecutar", truena)
    with pytest.raises(RuntimeError, match="connection refused"):
        db.reclamar_reintento_editor("u1", NOMBRE, "{}")


def test_el_sql_del_claim_esta_condicionado_a_error_y_a_copia(base):
    db.reclamar_reintento_editor("u1", NOMBRE, "{}")
    sql = " ".join(base.sentencias[-1].split())
    assert "doc #>> '{editar,estado}' = 'error'" in sql and "doc #>> '{editar,copia}' = 'true'" in sql
    assert sql.endswith("RETURNING nombre")


# ---------------------------------------------------------------------------
# borrar_copia_sin_cobrar: nunca una copia pagada

def test_borra_la_copia_que_no_se_cobro(base):
    db.crear_copia_editor("u1", NOMBRE, copia(cobrado=False))
    db.borrar_copia_sin_cobrar("u1", NOMBRE)
    assert estado_de(base, "u1", NOMBRE) is None


def test_jamas_borra_una_copia_ya_cobrada(base):
    db.crear_copia_editor("u1", NOMBRE, copia(cobrado=True))
    db.borrar_copia_sin_cobrar("u1", NOMBRE)
    assert estado_de(base, "u1", NOMBRE) is not None


def test_jamas_borra_un_proyecto_que_no_es_copia_ni_el_de_otra_persona(base):
    db.guardar_proyecto_editor("u1", "viejo", json.dumps({"editar": {"estado": "error", "cobrado": False}}))
    db.guardar_proyecto_editor("u1", "subida", json.dumps({"subidas": [{"key": "k"}]}))
    db.crear_copia_editor("u2", NOMBRE, copia(cobrado=False))
    for u, n in (("u1", "viejo"), ("u1", "subida"), ("u1", NOMBRE)):
        db.borrar_copia_sin_cobrar(u, n)
    assert estado_de(base, "u1", "viejo") and estado_de(base, "u1", "subida")
    assert estado_de(base, "u2", NOMBRE)


def test_el_filtro_de_cobrado_va_en_el_sql_no_en_quien_llama(base):
    db.borrar_copia_sin_cobrar("u1", NOMBRE)
    sql = " ".join(base.sentencias[-1].split())
    assert sql.startswith("DELETE FROM proyectos_editor")
    assert "doc #>> '{editar,cobrado}' = 'false'" in sql and "doc #>> '{editar,copia}' = 'true'" in sql


def test_el_nombre_sigue_reservado_tras_borrar(base):
    """Volver a pedir da la misma copia: el nombre es de la persona aunque la fila ya no esté."""
    db.reservar_nombre_editor("u1", NOMBRE)
    db.crear_copia_editor("u1", NOMBRE, copia(cobrado=False))
    db.borrar_copia_sin_cobrar("u1", NOMBRE)
    assert db.reservar_nombre_derivado("u1", "ed-9f1c0a7b", reservar=False) == NOMBRE


# ---------------------------------------------------------------------------
# fijar_meta_editor y la lista cerrada de campos

def test_la_meta_se_agrega_sin_pisar_el_resto_del_doc(base):
    db.guardar_proyecto_editor("u1", "charla", json.dumps({"subidas": [{"key": "k"}], "flags": {"cuts": True}}))
    db.fijar_meta_editor("u1", "charla", json.dumps({"key": "k", "bytes": 5, "duracion_s": 30.0}))
    d = estado_de(base, "u1", "charla")
    assert d["meta"] == {"key": "k", "bytes": 5, "duracion_s": 30.0}
    assert d["subidas"] == [{"key": "k"}] and d["flags"] == {"cuts": True}


def test_meta_esta_en_la_lista_cerrada_y_un_campo_ajeno_no_pasa(base):
    assert db._CAMPOS_EDITOR["meta"] == "{meta}"
    with pytest.raises(KeyError):
        db.fijar_campo_editor("u1", "charla", "campo_inventado", "{}")
    assert not any("campo_inventado" in s for s in base.sentencias)


def test_fijar_meta_usa_jsonb_set_de_una_sola_llave(base):
    db.fijar_meta_editor("u1", "charla", "{}")
    sql = " ".join(base.sentencias[-1].split())
    assert "jsonb_set(doc, '{meta}', :v::jsonb)" in sql and "WHERE user_id = :u AND nombre = :n" in sql
