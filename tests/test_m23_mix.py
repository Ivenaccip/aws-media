"""M23 · D — MIX: la campaña de publicidad automática (tabla, costo y pantalla).

Lo que no puede pasar, y por eso se fija aquí:

  * **que el reloj publique y cobre veinticuatro veces al día.** MIX se dispara
    con un cron horario, así que el único freno es el PRIMARY KEY de
    `mix_corridas`: el día se RECLAMA con ON CONFLICT DO NOTHING y gana uno
    solo. Si alguien cambia ese INSERT por un SELECT-y-luego-INSERT, la carrera
    vuelve y cada día se cobra de más;
  * **que se devuelva dos veces.** El libro mayor solo tiene índice único para
    las compras (`monedero_mov_compra_ref`), así que una devolución repetida
    entra callada. El derecho a devolver se gana con el UPDATE condicionado de
    `mix_apagar`, igual que en el barredor;
  * **que se cobre por lo que no salió.** La campaña se paga ENTERA por
    adelantado (decisión del dueño, 18-sep), así que apagar a mitad tiene que
    devolver exactamente los días que no se publicaron — ni uno más, porque
    devolver de más es regalar dinero que nadie ingresó;
  * **que el número de la pantalla y el que se cobra se separen.** Los dos
    salen de `mix.resumen_costo` / `creditos.costo_mix`, que leen la MISMA
    tarifa de tools/tarifas.json;
  * **que el ejemplo gratis se cobre, o que se cobre dos veces la imagen del
    primer día.** El ejemplo se guarda como la corrida del día 1 y el reloj la
    reclama en vez de generar otra;
  * **que la imagen del usuario deje de ser la base.** Sin referencia, la
    llamada va al modelo de CREAR y sale una foto inventada que no es su
    producto — y no revienta nada, así que nadie se entera.

La base va mockeada (ningún test habla con Aurora: lo impide un fixture autouse
de conftest), así que lo que aquí se comprueba del SQL es su FORMA — que la
sentencia siga siendo condicionada. Un test no puede probar la atomicidad de
Postgres, pero sí que nadie la cambie por una lectura seguida de una escritura.
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import creditos, db, mix          # noqa: E402
from server import mix_api                       # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
USER = "u-mix"
HOY = date(2026, 9, 18)


# ---------------------------------------------------------------------------
# el calendario y el rango

def test_un_rango_cuenta_los_dos_extremos():
    """Del 18 al 20 son TRES días, no dos. Es lo que ve quien marca un
    calendario, y es lo que se cobra: equivocarse aquí cobra de menos o de más
    en todas las campañas."""
    assert mix.dias_de(date(2026, 9, 18), date(2026, 9, 20)) == 3
    assert mix.dias_de(date(2026, 9, 18), date(2026, 9, 18)) == 1


def test_no_se_puede_empezar_en_el_pasado():
    with pytest.raises(ValueError) as e:
        mix.validar_rango(date(2026, 9, 1), date(2026, 9, 20), hoy=HOY)
    assert "ya pasó" in str(e.value)


def test_el_fin_no_puede_ir_antes_del_inicio():
    with pytest.raises(ValueError):
        mix.validar_rango(date(2026, 9, 20), date(2026, 9, 18), hoy=HOY)


def test_hay_tope_de_dias_y_el_mensaje_dice_cuantos_eligio():
    """Sin tope, un rango de dos años pediría miles de créditos de golpe y el
    error se leería como «no te alcanza» en vez de «eso no se puede»."""
    with pytest.raises(ValueError) as e:
        mix.validar_rango(HOY, HOY + timedelta(days=400), hoy=HOY)
    assert str(mix.MAX_DIAS) in str(e.value) and "401" in str(e.value)


# ---------------------------------------------------------------------------
# el dinero

def test_la_tarifa_sale_del_json_y_no_del_codigo():
    tarifas = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    assert creditos.MIX_POR_PUBLICACION_CR == tarifas["mix"]["por_publicacion"]


def test_una_campana_cuesta_dias_por_tarifa():
    t = creditos.MIX_POR_PUBLICACION_CR
    assert creditos.costo_mix(14) == 14 * t
    assert creditos.costo_mix(0) == 0
    assert creditos.costo_mix(-3) == 0      # un rango absurdo no regala créditos


def test_la_pantalla_y_el_cobro_leen_el_mismo_numero():
    """Si el resumen que se enseña y el cobro se calcularan por separado, el
    día que alguien cambie la tarifa se cobraría distinto de lo prometido."""
    vista = mix.resumen_costo(14, creditos.MIX_POR_PUBLICACION_CR, saldo=200)
    assert vista["creditos"] == creditos.costo_mix(14)


def test_el_resumen_dice_cuanto_falta_no_solo_que_no_alcanza():
    vista = mix.resumen_costo(14, 5, saldo=50)
    assert vista["alcanza"] is False and vista["faltan"] == 20


# ---------------------------------------------------------------------------
# el candado contra el reloj

def test_el_dia_se_reclama_con_on_conflict_y_no_con_una_lectura(monkeypatch):
    """EL test de este archivo. El reloj mira cada hora: sin este INSERT
    condicionado, una campaña publicaría veinticuatro veces al día y cobraría
    veinticuatro veces."""
    vistas = []

    def falso(sql, params=None):
        vistas.append(sql)
        return [{"dia": "2026-09-20"}]
    monkeypatch.setattr(db, "ejecutar", falso)

    assert db.mix_reclamar_dia(USER, "mix-1", "2026-09-20") is True
    sql = " ".join(vistas[0].split()).upper()
    assert "INSERT INTO MIX_CORRIDAS" in sql
    assert "ON CONFLICT" in sql and "DO NOTHING" in sql
    assert "RETURNING" in sql


def test_el_segundo_en_llegar_al_mismo_dia_pierde(monkeypatch):
    monkeypatch.setattr(db, "ejecutar", lambda *a, **k: [])
    assert db.mix_reclamar_dia(USER, "mix-1", "2026-09-20") is False


def test_el_ejemplo_del_dia_uno_se_reclama_en_vez_de_generar_otra_imagen(monkeypatch):
    """El día 1 ya tiene imagen: la del ejemplo gratis. Si el reloj no la
    reclamara, generaría otra — y esa sí se cobraría."""
    vistas = []

    def falso(sql, params=None):
        vistas.append(sql)
        return [{"tema": "t", "texto": "x", "media_key": "m.jpg"}]
    monkeypatch.setattr(db, "ejecutar", falso)

    assert db.mix_reclamar_ejemplo(USER, "mix-1", "2026-09-20")["media_key"] == "m.jpg"
    sql = " ".join(vistas[0].split())
    assert "UPDATE mix_corridas" in sql
    # reclama el ejemplo terminado Y el que se quedó a medias: si solo mirara
    # 'ejemplo', una fila 'preparando' dejaría el día 1 sin publicar para
    # siempre (ver el test de la carrera en test_m23_mix_ejemplo.py)
    assert "estado IN ('ejemplo', 'preparando')" in sql


def test_solo_hay_una_campana_viva_y_lo_impone_la_base():
    """Un endpoint se puede saltar; un índice único no. Por eso la regla de
    «una sola automatización» vive en el esquema."""
    esquema = " ".join(" ".join(db.ESQUEMA).split()).lower()
    assert "create unique index if not exists mix_campana_viva" in esquema
    assert "where estado in ('borrador', 'activa', 'pausada')" in esquema


def test_apagar_es_un_update_condicionado_para_no_devolver_dos_veces(monkeypatch):
    """El libro mayor solo tiene índice único para compras: una devolución
    repetida entraría callada. El derecho a devolver se gana con el UPDATE."""
    vistas = []

    def falso(sql, params=None):
        vistas.append(sql)
        return [{"id": "mix-1", "creditos_cobrados": 70, "creditos_devueltos": 0,
                 "empieza": "2026-09-18", "termina": "2026-10-01"}]
    monkeypatch.setattr(db, "ejecutar", falso)

    assert db.mix_apagar(USER, "mix-1")["creditos_cobrados"] == 70
    sql = " ".join(vistas[0].split()).upper()
    assert "UPDATE MIX_CAMPANAS" in sql
    assert "ESTADO IN ('ACTIVA', 'PAUSADA')" in sql and "RETURNING" in sql


def test_encender_solo_procede_desde_borrador(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: (vistas.append(sql), [{"id": "x"}])[1])
    assert db.mix_encender(USER, "mix-1", 70) is True
    assert "estado = 'borrador'" in " ".join(vistas[0].split())


# ---------------------------------------------------------------------------
# lo que se le pide al modelo

def test_el_prompt_conserva_el_producto_del_usuario():
    """La imagen que sube es la BASE de todas: si el prompt deja de pedir que
    se conserve, la campaña empieza a enseñar un producto parecido al suyo."""
    p = mix.prompt_imagen("A morning coffee scene")
    assert "Keep the product" in p and "reference" in p
    assert "No text" in p      # los generadores escriben mal; el texto va aparte


def test_un_llm_caido_no_apaga_el_dia(monkeypatch):
    """«Solo quiere publicidad que salga»: un día con un texto sencillo es
    mejor que una campaña que se apaga sola."""
    async def truena(*a, **k):
        raise RuntimeError("el LLM no contesta")
    monkeypatch.setattr(mix.llm, "chat_json", truena)

    import asyncio
    salida = asyncio.run(mix.tema_y_texto(
        {"motivo": "Vender café de especialidad", "tono": "vender"}, 1, 7))
    assert salida["tema"] and salida["texto"]


def test_al_llm_se_le_dicen_los_temas_ya_usados(monkeypatch):
    """Sin esto, una campaña de un mes publica la misma idea treinta veces."""
    visto = {}

    async def espia(name, system, user):
        visto["user"] = user
        return {"tema": "algo nuevo", "texto": "hola"}
    monkeypatch.setattr(mix.llm, "chat_json", espia)

    import asyncio
    asyncio.run(mix.tema_y_texto({"motivo": "m", "tono": "vender"}, 5, 7,
                                 ya_usados=["café de la mañana", "el local"]))
    assert "no los repitas" in visto["user"]
    assert "café de la mañana" in visto["user"]


def test_un_tono_inventado_cae_en_vender():
    assert mix.tono_valido("filosófico") == mix.TONO_POR_DEFECTO
    assert mix.tono_valido(None) == "vender"
    assert set(mix.TONOS) == {"vender", "informar", "recordar"}


# ---------------------------------------------------------------------------
# la API

CAMPANA = {
    "id": "mix-1", "motivo": "Vender el menú nuevo", "tono": "vender",
    "imagen_key": "mix-abc-base.jpg", "canal_id": "123", "canal_red": "instagram",
    "canal_nombre": "mi negocio", "hora": "09:00", "zona": "America/Guayaquil",
    "empieza": "2026-09-20", "termina": "2026-10-03", "estado": "borrador",
    "creditos_cobrados": 0, "creditos_devueltos": 0,
}


@pytest.fixture
def cliente(monkeypatch):
    from server.app import app
    monkeypatch.setattr(db, "usuario_actual", lambda: USER)
    monkeypatch.setattr(mix_api.db, "usuario_actual", lambda: USER)
    # MIX vive en dos tablas: los endpoints piden Postgres y en los tests el
    # default es json (ver test_sin_postgres_lo_dice_en_claro más abajo)
    monkeypatch.setattr(mix_api.db, "backend", lambda: "postgres")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(mix_api.creditos, "activo", lambda: True)
    return TestClient(app)


def test_encender_sin_haber_visto_el_ejemplo_no_cobra(cliente, monkeypatch):
    """Nadie paga sin ver: es la contrapartida de que el ejemplo sea gratis."""
    cobros = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(CAMPANA))
    monkeypatch.setattr(mix_api.db, "mix_corridas", lambda u, c: [])
    monkeypatch.setattr(mix_api.creditos, "cobrar",
                        lambda *a, **k: cobros.append(a))

    r = cliente.post("/api/mix/encender", json={"id": "mix-1"})
    assert r.status_code == 409
    assert not cobros


def test_sin_saldo_devuelve_402_y_no_enciende(cliente, monkeypatch):
    encendidas = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(CAMPANA))
    # con el ejemplo TERMINADO: desde que se prepara en la cola, la fila del
    # día 1 existe desde que se pide y una a medias ya no da derecho a cobrar
    monkeypatch.setattr(mix_api.db, "mix_corridas",
                        lambda u, c: [{"dia": "2026-09-20", "estado": "ejemplo"}])
    monkeypatch.setattr(mix_api.db, "mix_encender",
                        lambda *a: encendidas.append(a) or True)

    def sin_saldo(*a, **k):
        raise creditos.SinSaldo(70, 10)
    monkeypatch.setattr(mix_api.creditos, "cobrar", sin_saldo)

    r = cliente.post("/api/mix/encender", json={"id": "mix-1"})
    assert r.status_code == 402
    assert "créditos" in r.json()["detail"].lower()
    assert not encendidas


def test_apagar_devuelve_solo_los_dias_que_no_salieron(cliente, monkeypatch):
    """Se paga por adelantado: apagar el día 4 de 14 devuelve 10 días. Ni uno
    más — devolver de más regala dinero que nadie ingresó."""
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 4)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 50)

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.status_code == 200
    assert r.json()["devueltos"] == creditos.costo_mix(10)
    assert devueltos == [creditos.costo_mix(10)]


def test_apagar_dos_veces_no_devuelve_dos_veces(cliente, monkeypatch):
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 4)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: None)   # ya la apagaron
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.status_code == 409
    assert not devueltos


def test_apagar_pide_confirmar(cliente, monkeypatch):
    monkeypatch.setattr(mix_api.db, "mix_campana",
                        lambda u: dict(CAMPANA, estado="activa"))
    assert cliente.post("/api/mix/apagar", json={}).status_code == 400


def test_nunca_se_devuelve_mas_de_lo_que_se_cobro(cliente, monkeypatch):
    """Cinturón: si por lo que sea la campaña se alargó después de cobrarse, la
    devolución se topa en lo que de verdad entró."""
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=10)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 0)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 10)

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.json()["devueltos"] == 10 and devueltos == [10]


def test_el_borrador_explica_en_espanol_por_que_no_vale_el_rango(cliente, monkeypatch):
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: None)
    r = cliente.post("/api/mix/borrador", data={
        "motivo": "Vender", "tono": "vender", "canal_id": "123",
        "empieza": "2026-09-20", "termina": "2026-09-19"})
    assert r.status_code == 400
    assert "antes" in r.json()["detail"]


def test_sin_clave_de_blotato_las_cuentas_dan_409_con_como_arreglarlo(cliente, monkeypatch):
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: None)
    r = cliente.get("/api/mix/cuentas")
    assert r.status_code == 409 and "Blotato" in r.json()["detail"]


# ---------------------------------------------------------------------------
# la zona horaria del usuario, no la del servidor

def test_hoy_es_el_dia_del_usuario_y_no_el_del_contenedor():
    """La Lambda corre en UTC. Sin esto, alguien en América a las siete de la
    tarde elige «hoy» en el calendario y el servidor le contesta que esa fecha
    ya pasó, porque para él ya es mañana.

    Las dos zonas de la prueba están a 25 horas una de otra, así que su fecha
    local NUNCA coincide: el test no depende de cuándo se corra."""
    assert mix.hoy_en("Pacific/Kiritimati") != mix.hoy_en("Pacific/Midway")


def test_una_zona_inventada_no_revienta_la_pantalla():
    """La zona la manda el navegador. Una cadena rara tiene que caer a UTC, no
    salir como un 500 delante de alguien que solo quería elegir fechas."""
    assert isinstance(mix.hoy_en("Marte/Olympus"), date)
    assert isinstance(mix.hoy_en(None), date)


def test_validar_rango_respeta_el_hoy_que_le_dan():
    """Es lo que conecta la zona del usuario con la validación: si dejara de
    usar el parámetro, el arreglo de arriba no serviría de nada."""
    ayer_alla = date(2026, 9, 18)
    assert mix.validar_rango(ayer_alla, ayer_alla, hoy=ayer_alla) == 1
    with pytest.raises(ValueError):
        mix.validar_rango(ayer_alla, ayer_alla, hoy=date(2026, 9, 19))


def test_el_borrador_usa_la_zona_que_manda_el_navegador(cliente, monkeypatch):
    vistas = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: None)
    monkeypatch.setattr(mix_api.mix, "hoy_en",
                        lambda z: vistas.append(z) or date(2026, 9, 18))
    monkeypatch.setattr(mix_api.db, "mix_guardar_borrador", lambda *a, **k: "mix-1")
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 500)

    cliente.post("/api/mix/borrador", data={
        "motivo": "Vender", "tono": "vender", "canal_id": "123",
        "zona": "America/Mexico_City", "empieza": "2026-09-18",
        "termina": "2026-09-20", "imagen": ""})
    assert vistas == ["America/Mexico_City"]


# ---------------------------------------------------------------------------
# una sola cuenta de la devolución

def test_la_pantalla_lee_la_devolucion_del_servidor_y_no_la_calcula(cliente, monkeypatch):
    """El botón de apagar tiene que decir cuánto se devuelve ANTES de pulsarlo,
    así que la pantalla necesita ese número por adelantado. Si lo calculara
    ella, el día que cambie la tarifa uno de los dos mentiría."""
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70)
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_corridas", lambda u, c: [])
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 4)
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 30)
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: "blt_x==")

    estado = cliente.get("/api/mix").json()
    assert estado["devolucion"] == creditos.costo_mix(10)


def test_lo_que_se_enseña_y_lo_que_se_devuelve_es_el_mismo_numero(cliente, monkeypatch):
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_corridas", lambda u, c: [])
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 4)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 30)
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: "blt_x==")
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))

    prometido = cliente.get("/api/mix").json()["devolucion"]
    real = cliente.post("/api/mix/apagar", json={"confirmar": True}).json()["devueltos"]
    assert prometido == real == devueltos[0]


def test_sin_campana_encendida_no_se_promete_devolucion(cliente, monkeypatch):
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(CAMPANA))
    monkeypatch.setattr(mix_api.db, "mix_corridas", lambda u, c: [])
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 100)
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: None)
    assert cliente.get("/api/mix").json()["devolucion"] == 0


def test_sin_postgres_lo_dice_en_claro_y_no_revienta(monkeypatch):
    """En dev local el estado va en JSON. Sin este aviso, el primer clic sale
    como un error de boto3 en la pantalla, que no le dice nada a nadie."""
    from server.app import app
    monkeypatch.setattr(mix_api.db, "backend", lambda: "json")
    r = TestClient(app).get("/api/mix")
    assert r.status_code == 503 and "Postgres" in r.json()["detail"]


# ---------------------------------------------------------------------------
# lo que el reloj cambió en la pantalla y en el API (M23 · D, segunda parte)

def test_apagar_no_devuelve_los_dias_que_el_reloj_ya_devolvio(cliente, monkeypatch):
    """El agujero que abrió la corrida diaria.

    Campaña de 14 días (70 créditos). Cuatro publicados y uno que falló, ya
    devuelto por el reloj en el acto. Los días que faltan son 10, pero uno de
    ellos ya se pagó de vuelta: devolver 50 y no 50+5. La base no puede
    frenarlo —su índice único solo cubre las compras— así que la resta tiene
    que estar en la cuenta."""
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70,
                  creditos_devueltos=5)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 4)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 50)

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.status_code == 200
    # 10 días sin salir × 5 = 50, menos los 5 que ya se devolvieron = 45
    assert r.json()["devueltos"] == 45
    assert devueltos == [45]
    # y nunca más de lo que queda cobrado
    assert sum(devueltos) + 5 <= 70


def test_nunca_se_devuelve_mas_de_lo_cobrado(cliente, monkeypatch):
    """Si todos los días fallaron y el reloj ya devolvió los 70, apagar no
    puede devolver otros 70: serían créditos que nadie compró."""
    activa = dict(CAMPANA, estado="activa", creditos_cobrados=70,
                  creditos_devueltos=70)
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 0)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(activa))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 70)

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.json()["devueltos"] == 0
    assert devueltos == []


def test_solo_se_ofrecen_las_redes_donde_mix_puede_publicar(cliente, monkeypatch):
    """Facebook exige la página, Pinterest el tablero, TikTok la privacidad y
    YouTube el título: datos que MIX no pregunta. Dejarlas en el desplegable
    sería cobrar una campaña entera que Blotato va a rechazar todos los días.
    Las que se quedan fuera se nombran, para poder decir por qué."""
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: "k")
    monkeypatch.setattr(mix_api.blotato, "cuentas", lambda clave: [
        {"id": "1", "platform": "instagram"}, {"id": "2", "platform": "facebook"},
        {"id": "3", "platform": "pinterest"}, {"id": "4", "platform": "bluesky"}])

    j = cliente.get("/api/mix/cuentas").json()
    assert [c["platform"] for c in j["cuentas"]] == ["instagram", "bluesky"]
    assert j["fuera"] == ["Facebook", "Pinterest"]


def test_no_se_puede_guardar_una_campana_en_una_red_que_no_podemos_publicar(
        cliente, monkeypatch):
    """El desplegable ya no las ofrece, pero un cliente distinto sí puede
    mandarlas: la puerta se cierra donde se guarda, no donde se pinta."""
    guardados = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: None)
    monkeypatch.setattr(mix_api.db, "mix_guardar_borrador",
                        lambda *a, **k: guardados.append(k) or "mix-1")

    r = cliente.post("/api/mix/borrador", data={
        "motivo": "Pan", "tono": "vender", "canal_id": "c1",
        "canal_red": "facebook", "hora": "09:00", "zona": "America/Guayaquil",
        "empieza": "2026-12-01", "termina": "2026-12-03"},
        files={"imagen": ("f.jpg", b"x" * 10, "image/jpeg")})
    assert r.status_code == 400
    assert "Instagram" in r.json()["detail"]
    assert not guardados


def test_reanudar_exige_que_blotato_este_de_vuelta(cliente, monkeypatch):
    """MIX pausa la campaña cuando la cuenta se desconecta. Dejar reanudar sin
    clave sería devolverlo mañana al mismo sitio, con un día menos."""
    monkeypatch.setattr(mix_api.db, "mix_campana",
                        lambda u: dict(CAMPANA, estado="pausada"))
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: None)
    monkeypatch.setattr(mix_api.db, "mix_reanudar",
                        lambda u, i: pytest.fail("no se debía reanudar"))

    r = cliente.post("/api/mix/reanudar", json={"id": "mix-1"})
    assert r.status_code == 409


def test_reanudar_vuelve_a_encender_la_campana(cliente, monkeypatch):
    monkeypatch.setattr(mix_api.db, "mix_campana",
                        lambda u: dict(CAMPANA, estado="pausada"))
    monkeypatch.setattr(mix_api.blotato, "clave_de", lambda u: "k")
    monkeypatch.setattr(mix_api.db, "mix_reanudar", lambda u, i: True)

    r = cliente.post("/api/mix/reanudar", json={"id": "mix-1"})
    assert r.status_code == 200 and r.json()["ok"] is True


def test_apagar_usa_los_numeros_del_claim_y_no_los_que_leyo_al_entrar(
        cliente, monkeypatch):
    """La carrera que devolvía un día dos veces.

    Entre que el endpoint lee la campaña y gana el claim caben tres viajes al
    Data API, y ahí cabe justo lo que más duele: que el reloj cierre un día
    que acaba de fallar y devuelva sus créditos. Si la cuenta se hiciera con la
    lectura vieja, `creditos_devueltos` seguiría en 0 y ese día se devolvería
    otra vez. Campaña de 14 días (70 créditos), 3 publicados: se deben 11 días
    = 55, menos los 5 que el reloj acaba de devolver = 50."""
    vieja = dict(CAMPANA, estado="activa", creditos_cobrados=70,
                 creditos_devueltos=0, empieza="2026-09-18", termina="2026-10-01")
    fresca = dict(vieja, creditos_devueltos=5)     # lo que devuelve el claim
    devueltos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: dict(vieja))
    monkeypatch.setattr(mix_api.db, "mix_dias_liquidados", lambda u, c: 3)
    monkeypatch.setattr(mix_api.db, "mix_apagar", lambda u, i: dict(fresca))
    monkeypatch.setattr(mix_api.db, "mix_anotar_devolucion", lambda *a: None)
    monkeypatch.setattr(mix_api.creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    monkeypatch.setattr(mix_api.creditos, "saldo", lambda u=None: 50)

    r = cliente.post("/api/mix/apagar", json={"confirmar": True})
    assert r.json()["devueltos"] == 50
    assert devueltos == [50]
