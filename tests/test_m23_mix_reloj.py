"""M23 · D — el reloj de MIX y la corrida diaria: lo que publica sin nadie mirando.

`test_m23_mix.py` cubre la campaña (tabla, costo, pantalla). Aquí se fija lo que
pasa DESPUÉS de encenderla, que es donde el daño no lo ve nadie hasta que
alguien reclama. Lo que no puede pasar:

  * **que una campaña no publique nunca y nadie se entere.** El caso más
    silencioso es el día 1: su fila ya existe desde antes de encender —es el
    ejemplo gratis— así que un filtro ingenuo de «días ya tomados» lo saltaría
    en TODAS las campañas sin lanzar un solo error;
  * **que publique a la hora del servidor.** La hora es la del usuario: las
    nueve en Quito y en Madrid no son el mismo instante, y hay zonas a media
    hora de UTC donde un cron en punto nunca cae «a las nueve en punto»;
  * **que se devuelva dos veces por el mismo día.** Desde que el reloj devuelve
    cada día fallido en el acto, apagar después volvería a contarlo: el libro
    mayor no lo frena (su índice único solo cubre las compras);
  * **que una campaña vencida bloquee al usuario para siempre.** 'activa' está
    dentro del índice parcial `mix_campana_viva`; si nadie la cierra, el dueño
    del negocio no puede volver a usar MIX;
  * **que se gaste una imagen de Grok para fallar después.** Sin clave, sin
    cuenta o en una red que no podemos publicar, el día se cierra ANTES de
    generar nada: treinta días de una campaña rota son treinta imágenes
    pagadas por nosotros;
  * **que un fallo relance el trabajo.** SQS reintentaría, y un reintento no es
    otra oportunidad: es una segunda publicación en la cuenta de un cliente.
"""
import sys
from datetime import date, datetime
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pipeline.config                              # noqa: E402
from pipeline import blotato, creditos, db, media_fal, media_sync, mix  # noqa: E402
from worker import lambda_worker, mix_dia, mix_reloj  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
USER = "u-mix"
OTRO = "u-otro"

CAMPANA = {
    "user_id": USER, "id": "mix-1", "motivo": "Panadería del barrio",
    "tono": "vender", "imagen_key": "mix-abc-base.jpg", "canal_id": "c1",
    "canal_red": "instagram", "canal_nombre": "@pan", "hora": "09:00",
    "zona": "America/Guayaquil", "empieza": "2026-09-20",
    "termina": "2026-09-29", "estado": "activa", "nota": None,
    "creditos_cobrados": 50, "creditos_devueltos": 0,
}


def campana(**cambios) -> dict:
    return {**CAMPANA, **cambios}


def en(zona: str, cuando: str) -> datetime:
    return datetime.fromisoformat(cuando).replace(tzinfo=ZoneInfo(zona))


def _prohibido(que: str):
    """Un doble que falla si alguien lo llama: así se prueba lo que NO se hizo,
    que en este archivo casi siempre es lo caro (una imagen, una publicación)."""
    def no(*a, **k):
        raise AssertionError(f"no se debía {que}")
    return no


# ---------------------------------------------------------------------------
# a qué hora toca

def test_la_hora_es_la_del_usuario_y_no_la_del_servidor():
    """Mismo instante, dos campañas: la de Quito publica y la de California no.

    Si el reloj mirara la hora del servidor, todas las campañas del mundo
    saldrían a la vez y ninguna a la hora que su dueño eligió."""
    quito = campana(zona="America/Guayaquil")           # UTC-5
    los_angeles = campana(zona="America/Los_Angeles")   # UTC-7
    instante = datetime(2026, 9, 21, 14, 0, tzinfo=ZoneInfo("UTC"))

    assert mix.dia_que_toca(
        quito, instante.astimezone(ZoneInfo(quito["zona"]))) == date(2026, 9, 21)
    # el MISMO instante, y allá son las siete de la mañana: todavía no
    assert mix.dia_que_toca(
        los_angeles, instante.astimezone(ZoneInfo(los_angeles["zona"]))) is None
    # dos horas después sí, y ese es el despacho que le toca a él
    assert mix.dia_que_toca(
        los_angeles, en("America/Los_Angeles", "2026-09-21T09:00")) == date(2026, 9, 21)


def test_las_zonas_a_media_hora_publican_igual():
    """Kolkata está a +5:30 de UTC. El cron dispara en punto, así que allí son
    y media SIEMPRE: con un «== la hora» esa campaña no publicaría jamás, y el
    error sería un silencio, no una excepción."""
    c = campana(zona="Asia/Kolkata")
    assert mix.dia_que_toca(c, en("Asia/Kolkata", "2026-09-21T08:30")) is None
    assert mix.dia_que_toca(c, en("Asia/Kolkata", "2026-09-21T09:30")) \
        == date(2026, 9, 21)


def test_una_hora_perdida_se_recupera_en_la_siguiente():
    """Si a las 9 la Lambda estaba throttlada o la base despertando, a las 10
    el día sale igual. Por eso la condición es «ya pasó su hora» y no «es su
    hora»: perder un día es perder una publicación ya cobrada."""
    assert mix.dia_que_toca(campana(), en("America/Guayaquil", "2026-09-21T23:00")) \
        == date(2026, 9, 21)


def test_fuera_del_rango_no_toca_nada():
    c = campana()
    assert mix.dia_que_toca(c, en("America/Guayaquil", "2026-09-19T10:00")) is None
    assert mix.dia_que_toca(c, en("America/Guayaquil", "2026-09-30T10:00")) is None


def test_una_hora_ilegible_no_mata_la_campana():
    """La columna es `text` y el endpoint no la valida: un cliente distinto
    puede escribir cualquier cosa. Reventar al parsear dejaría esa campaña
    muerta y cobrada, cada hora, sin que nadie lo viera."""
    assert mix.hora_en_minutos("25:00") == 9 * 60
    assert mix.hora_en_minutos("") == 9 * 60
    assert mix.dia_que_toca(campana(hora="mañana"),
                            en("America/Guayaquil", "2026-09-21T10:00")) \
        == date(2026, 9, 21)


# ---------------------------------------------------------------------------
# el despacho

@pytest.fixture
def reloj(monkeypatch):
    """El reloj sin base ni cola: se apunta lo que habría encolado."""
    encolados = []
    monkeypatch.setattr(db, "mix_corridas_colgadas", lambda m=60: [])
    monkeypatch.setattr(db, "mix_dias_tomados", lambda desde: [])
    monkeypatch.setattr(db, "mix_encendidas", lambda: [campana()])
    from pipeline import jobs
    monkeypatch.setattr(jobs, "encolar_mix_dia",
                        lambda u, c, d: encolados.append((u, c, d)))
    return encolados


def _ahora(monkeypatch, cuando: str):
    monkeypatch.setattr(mix, "ahora_en",
                        lambda zona: en("America/Guayaquil", cuando))


def test_el_reloj_encola_el_dia_que_toca(reloj, monkeypatch):
    _ahora(monkeypatch, "2026-09-21T09:00")
    assert mix_reloj.despachar()["despachadas"] == 1
    assert reloj == [(USER, "mix-1", "2026-09-21")]


def test_el_reloj_no_publica_el_mismo_dia_dos_veces(reloj, monkeypatch):
    """El candado de la base es lo que lo impide de verdad; esto evita el
    trabajo inútil. Con 182 campañas, despachar cada hora sin mirar serían más
    de cuatro mil arranques diarios que solo pierden el candado."""
    _ahora(monkeypatch, "2026-09-21T15:00")
    monkeypatch.setattr(db, "mix_dias_tomados", lambda desde: [
        {"user_id": USER, "campana_id": "mix-1", "dia": "2026-09-21",
         "estado": "publicada"}])
    assert mix_reloj.despachar()["despachadas"] == 0
    assert reloj == []


def test_el_dia_uno_se_despacha_aunque_ya_tenga_fila_de_ejemplo(reloj, monkeypatch):
    """EL test de este archivo.

    La fila del día 1 existe desde antes de encender: es el ejemplo gratis que
    el usuario vio. Si el filtro de «días ya tomados» la contara, el primer día
    de TODAS las campañas no saldría nunca — sin excepción, sin log, sin nada
    que mirar. La corrida sabe reclamarla y reusarla."""
    _ahora(monkeypatch, "2026-09-20T09:00")
    monkeypatch.setattr(db, "mix_dias_tomados", lambda desde: [
        {"user_id": USER, "campana_id": "mix-1", "dia": "2026-09-20",
         "estado": "ejemplo"}])
    assert mix_reloj.despachar()["despachadas"] == 1
    assert reloj == [(USER, "mix-1", "2026-09-20")]


def test_una_campana_pausada_no_publica(reloj, monkeypatch):
    _ahora(monkeypatch, "2026-09-21T09:00")
    monkeypatch.setattr(db, "mix_encendidas", lambda: [campana(estado="pausada")])
    assert mix_reloj.despachar()["despachadas"] == 0
    assert reloj == []


def test_una_campana_rota_no_tumba_a_las_demas(reloj, monkeypatch):
    """Una campaña con datos imposibles no puede dejar sin publicar a las otras
    181: el reloj es de todos."""
    _ahora(monkeypatch, "2026-09-21T09:00")
    monkeypatch.setattr(db, "mix_encendidas", lambda: [
        campana(user_id=OTRO, id="mix-rota", empieza=None),
        campana()])
    hechas = mix_reloj.despachar()
    assert hechas["falladas"] == 1 and hechas["despachadas"] == 1
    assert reloj == [(USER, "mix-1", "2026-09-21")]


def test_el_reloj_no_publica_el_mismo_solo_encola(reloj, monkeypatch):
    """Publicar aquí dentro se comería los 15 minutos de la Lambda en cuanto
    hubiera veinte campañas, y las últimas del día no saldrían."""
    _ahora(monkeypatch, "2026-09-21T09:00")
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar una imagen"))
    monkeypatch.setattr(blotato, "publicar", _prohibido("publicar"))
    mix_reloj.despachar()


# ---------------------------------------------------------------------------
# cerrar la campaña cuando se acaba

def test_una_campana_vencida_se_cierra_sola(reloj, monkeypatch):
    """'activa' está dentro del índice parcial `mix_campana_viva`. Si nadie la
    cierra, pasado el último día el usuario recibe «Ya tienes una campaña
    encendida» para siempre: MIX se le muere en la mano."""
    _ahora(monkeypatch, "2026-09-30T09:00")
    cerradas = []
    monkeypatch.setattr(db, "mix_apagar", lambda u, i, estado="cancelada":
                        cerradas.append((u, i, estado)) or
                        {"id": i, "creditos_cobrados": 50, "creditos_devueltos": 0})
    monkeypatch.setattr(db, "mix_dias_liquidados", lambda u, c: 10)
    assert mix_reloj.despachar()["terminadas"] == 1
    assert cerradas == [(USER, "mix-1", "terminada")]
    assert reloj == []


def test_al_terminar_se_devuelve_lo_que_no_salio(monkeypatch):
    """Diez días cobrados, ocho publicados: los dos que no salieron se
    devuelven al cerrar. Si no, quien deja la campaña correr hasta el final se
    queda pagando publicaciones que no existen."""
    devueltos = []
    monkeypatch.setattr(db, "mix_apagar", lambda u, i, estado="cancelada":
                        {"id": i, "creditos_cobrados": 50, "creditos_devueltos": 0})
    monkeypatch.setattr(db, "mix_dias_liquidados", lambda u, c: 8)
    monkeypatch.setattr(db, "mix_anotar_devolucion", lambda u, i, n: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append((n, ref, user)))
    assert mix_reloj.terminar(campana()) is True
    assert devueltos == [(10, "mix:mix-1:terminada", USER)]


def test_si_otro_la_cerro_antes_aqui_no_se_devuelve_nada(monkeypatch):
    """El derecho a devolver se gana con el UPDATE condicionado, igual que en
    el botón de apagar: la base no sabe frenar una devolución repetida."""
    monkeypatch.setattr(db, "mix_apagar", lambda u, i, estado="cancelada": None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", _prohibido("devolver"))
    assert mix_reloj.terminar(campana()) is False


# ---------------------------------------------------------------------------
# las corridas que se quedaron colgadas

def test_una_corrida_muerta_se_cierra_y_se_devuelve(monkeypatch):
    """La Lambda muere a los 15 minutos; una corrida de una hora está muerta.
    Nadie la va a reintentar —el candado del día ya está puesto— y ese día está
    cobrado por adelantado."""
    cerrados, devueltos = [], []
    monkeypatch.setattr(db, "mix_corridas_colgadas", lambda m=60: [
        {"user_id": USER, "campana_id": "mix-1", "dia": "2026-09-21"}])
    monkeypatch.setattr(db, "mix_cerrar_dia",
                        lambda u, c, d, e, **k: cerrados.append((u, c, d, e, k)) or True)
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())
    monkeypatch.setattr(db, "mix_anotar_devolucion", lambda u, i, n: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append((n, ref, user)))

    assert mix_reloj.rescatar_colgadas() == 1
    assert cerrados[0][3] == "error"
    assert "no llegó a publicarse" in cerrados[0][4]["error"]
    assert devueltos == [(5, "mix:mix-1:dia:2026-09-21", USER)]


def test_si_el_cierre_lo_gana_otro_no_se_devuelve(monkeypatch):
    monkeypatch.setattr(db, "mix_corridas_colgadas", lambda m=60: [
        {"user_id": USER, "campana_id": "mix-1", "dia": "2026-09-21"}])
    monkeypatch.setattr(db, "mix_cerrar_dia", lambda u, c, d, e, **k: False)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", _prohibido("devolver"))
    assert mix_reloj.rescatar_colgadas() == 0


def test_cerrar_el_dia_es_condicionado_a_corriendo(monkeypatch):
    """Cerrar el día es lo que da derecho a devolver sus créditos. Si el UPDATE
    dejara de exigir 'corriendo', dos cierres devolverían dos veces y el libro
    mayor no se quejaría: su índice único solo cubre las compras."""
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: vistas.append(sql) or [{"dia": "x"}])
    assert db.mix_cerrar_dia(USER, "mix-1", "2026-09-21", "publicada") is True
    sql = " ".join(vistas[0].split()).upper()
    assert "ESTADO = 'CORRIENDO'" in sql and "RETURNING" in sql


# ---------------------------------------------------------------------------
# el dinero: nunca dos veces por el mismo día

def test_un_dia_fallido_no_se_devuelve_dos_veces():
    """La cuenta completa, que es donde estaba el agujero.

    Campaña de 10 días (50 créditos). Tres publicados, el día 4 falla y el
    reloj le devuelve 5 en el acto. Si el usuario apaga en ese momento, los
    días que quedan son 6 — no 7: el día 4 ya se le devolvió. Sin restar lo ya
    devuelto se le regalarían 5 créditos que nadie compró."""
    c = campana(creditos_cobrados=50, creditos_devueltos=5)
    assert mix.devolucion_pendiente(c, 3, 5) == 30      # 6 días × 5, no 7


def test_con_todos_los_dias_fallidos_no_se_devuelve_mas_de_lo_cobrado():
    """El caso extremo: si todos los días fallan, el reloj ya devolvió los 50.
    Apagar después no puede devolver otros 50."""
    c = campana(creditos_cobrados=50, creditos_devueltos=50)
    assert mix.devolucion_pendiente(c, 0, 5) == 0


def test_la_devolucion_de_un_dia_va_al_usuario_de_la_campana(monkeypatch):
    """En una Lambda caliente el env del trabajo anterior sigue puesto: sin el
    user_id explícito, la devolución de este usuario caería en el monedero de
    otro."""
    devueltos = []
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())
    monkeypatch.setattr(db, "mix_anotar_devolucion", lambda u, i, n: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append((n, ref, user)))
    assert mix_dia.devolver_dia(USER, "mix-1", "2026-09-21") == 5
    assert devueltos[0][2] == USER


def test_no_se_devuelve_mas_de_lo_que_queda_cobrado(monkeypatch):
    """Tope duro: lo cobrado menos lo ya devuelto. Devolver de más es regalar
    créditos que nadie ingresó."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i:
                        campana(creditos_cobrados=50, creditos_devueltos=48))
    monkeypatch.setattr(db, "mix_anotar_devolucion", lambda u, i, n: None)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    devueltos = []
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: devueltos.append(n))
    assert mix_dia.devolver_dia(USER, "mix-1", "2026-09-21") == 2
    assert devueltos == [2]


# ---------------------------------------------------------------------------
# la corrida de un día

@pytest.fixture
def corrida(monkeypatch, tmp_path):
    """Una corrida con todo mockeado y la campaña encendida."""
    # `correr` fija DEFAULT_USER_ID en el entorno del proceso, como todos los
    # workers (en una Lambda caliente es lo que impide que la devolución de un
    # usuario caiga en el monedero del anterior). En la suite eso se queda
    # puesto y contamina a los tests de después, así que monkeypatch lo
    # restaura al terminar: visto aquí mismo, dos tests de login y de Stripe
    # empezaron a fallar según el ORDEN de la corrida.
    monkeypatch.setenv("DEFAULT_USER_ID", "piloto")
    monkeypatch.setattr(pipeline.config, "settings",
                        SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(mix_dia, "cargar_env_usuario", lambda u: 0)
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())
    monkeypatch.setattr(db, "mix_reclamar_dia", lambda u, c, d: True)
    monkeypatch.setattr(db, "mix_reclamar_ejemplo", lambda u, c, d: None)
    monkeypatch.setattr(db, "mix_corridas", lambda u, c: [])
    monkeypatch.setattr(db, "mix_anotar_devolucion", lambda u, i, n: None)
    monkeypatch.setattr(db, "mix_pausar", lambda u, i, n: True)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    estado = {"cerrados": [], "publicados": [], "pausas": []}
    monkeypatch.setattr(db, "mix_cerrar_dia", lambda u, c, d, e, **k:
                        estado["cerrados"].append((e, k)) or True)
    monkeypatch.setattr(db, "mix_pausar", lambda u, i, nota:
                        estado["pausas"].append(nota) or True)
    monkeypatch.setattr(blotato, "clave_de", lambda u: "k-1")
    monkeypatch.setattr(blotato, "cuentas",
                        lambda clave, timeout=None: [{"id": "c1", "platform": "instagram"}])
    monkeypatch.setattr(blotato, "subir_stream",
                        lambda clave, nombre, partes, tam: "https://cdn/x.jpg")
    monkeypatch.setattr(blotato, "publicar", lambda *a, **k:
                        estado["publicados"].append((a, k)) or {"postSubmissionId": "p-1"})
    monkeypatch.setattr(media_sync, "subir_archivo", lambda local, key: None)
    monkeypatch.setattr(media_sync, "bajar_archivo", _crear_archivo)
    return estado


def _crear_archivo(key: str, destino: Path) -> bool:
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(b"jpeg")
    return True


async def _imagen(prompt, destino, referencia=None, meta=None, aspecto=None):
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(b"jpeg")
    return "https://fal/x.jpg"


def test_un_dia_normal_se_publica_y_se_cierra(corrida, monkeypatch):
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "publicada"
    assert corrida["cerrados"][-1][0] == "publicada"
    assert corrida["cerrados"][-1][1]["post_id"] == "p-1"


async def _plan(campana, dia_n, total, ya_usados=None):
    return {"tema": "Fresh bread on a wooden table", "texto": "Pan calientito hoy."}


def test_la_publicacion_de_una_foto_no_va_marcada_como_reel(corrida, monkeypatch):
    """`blotato.target_de` marca mediaType='reel' en Instagram porque nació
    para el producto de video, y Blotato solo acepta ahí 'reel' o 'story'. Una
    foto del feed no es ninguna de las dos: va sin mediaType."""
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)

    mix_dia.correr(USER, "mix-1", "2026-09-21")
    target = corrida["publicados"][0][1]["target"]
    assert target == {"targetType": "instagram"}
    assert "mediaType" not in target


def test_el_dia_uno_reusa_el_ejemplo_y_no_paga_otra_imagen(corrida, monkeypatch):
    """El ejemplo fue gratis y el usuario lo aprobó. Generar otra sería pagar
    dos veces la misma imagen y publicar algo distinto de lo que vio."""
    monkeypatch.setattr(db, "mix_reclamar_dia", lambda u, c, d: False)
    monkeypatch.setattr(db, "mix_reclamar_ejemplo", lambda u, c, d: {
        "tema": "t", "texto": "El de siempre.", "media_key": "mix-1-dia1.jpg"})
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar otra imagen"))
    monkeypatch.setattr(mix, "tema_y_texto", _prohibido("llamar al LLM"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-20")
    assert r["accion"] == "publicada"


def test_si_el_dia_ya_lo_tomo_otra_corrida_no_pasa_nada(corrida, monkeypatch):
    monkeypatch.setattr(db, "mix_reclamar_dia", lambda u, c, d: False)
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar una imagen"))
    monkeypatch.setattr(blotato, "publicar", _prohibido("publicar"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "nada"


def test_sin_clave_de_blotato_no_se_gasta_una_imagen(corrida, monkeypatch):
    """Lo barato antes que lo caro: una imagen de Grok cuesta dinero nuestro, y
    sin dónde publicar está tirada. Treinta días así son treinta imágenes."""
    monkeypatch.setattr(blotato, "clave_de", lambda u: None)
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar una imagen"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "error"
    assert corrida["pausas"], "una campaña sin clave se pausa, no sigue fallando"


def test_una_cuenta_desconectada_pausa_la_campana(corrida, monkeypatch):
    monkeypatch.setattr(blotato, "cuentas", lambda clave, timeout=None: [
        {"id": "otra", "platform": "instagram"}])
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar una imagen"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "error"
    assert "ya no está conectada" in corrida["pausas"][0]


def test_una_red_que_no_podemos_publicar_se_para_en_seco(corrida, monkeypatch):
    """Facebook exige la página, Pinterest el tablero, TikTok la privacidad:
    datos que MIX no pregunta. La campaña se cobra entera, así que dejarla
    correr sería cobrar treinta días que Blotato iba a rechazar uno por uno."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana(canal_red="facebook"))
    monkeypatch.setattr(media_fal, "imagen_fal", _prohibido("generar una imagen"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "error"
    assert corrida["pausas"]


def test_si_la_campana_se_apago_mientras_se_preparaba_no_se_publica(corrida, monkeypatch):
    """Entre el candado y el post pasan hasta dos minutos. Apagar devuelve los
    días no publicados, así que publicar después sería regalar la publicación
    Y el dinero."""
    estados = iter([campana(), campana(estado="cancelada")])
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: next(estados))
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)
    monkeypatch.setattr(blotato, "publicar", _prohibido("publicar"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "nada"
    assert corrida["cerrados"][-1][0] == "cancelada"


def test_un_fallo_inesperado_no_relanza_nunca(corrida, monkeypatch):
    """Relanzar haría que SQS reintentara, y un reintento no es otra
    oportunidad: es una segunda publicación en la cuenta de un cliente."""
    def truena(*a, **k):
        raise RuntimeError("boom")
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)
    monkeypatch.setattr(blotato, "publicar", truena)

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")     # no levanta
    assert r["accion"] == "error"


def test_un_5xx_de_blotato_no_devuelve_creditos(corrida, monkeypatch):
    """Un 500 o un timeout pudo haber creado el post igual. Devolver ahí sería
    regalar el día Y la publicación."""
    import httpx
    def truena(*a, **k):
        raise httpx.HTTPStatusError(
            "500", request=httpx.Request("POST", "https://x"),
            response=httpx.Response(500, request=httpx.Request("POST", "https://x")))
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)
    monkeypatch.setattr(blotato, "publicar", truena)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", _prohibido("devolver"))

    r = mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert r["accion"] == "error"
    assert "pudo haber salido" in corrida["cerrados"][-1][1]["error"]
    # y se cierra como 'incierta', no como 'error': si no, el cierre de la
    # campaña lo contaría como día sin salir y lo devolvería igual — justo lo
    # contrario de lo que le acabamos de decir al usuario
    assert corrida["cerrados"][-1][0] == "incierta"


def test_un_dia_sin_confirmar_cuenta_como_saldado(monkeypatch):
    """El contador que alimenta la devolución cuenta los publicados Y los
    inciertos. Es la otra cara de la regla del barredor: devolver de más es tan
    malo como no devolver."""
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: vistas.append(sql) or [{"n": 3}])
    assert db.mix_dias_liquidados(USER, "mix-1") == 3
    assert "'incierta'" in vistas[0]


def test_la_imagen_se_baja_del_dueno_de_la_campana_y_no_del_piloto(corrida, monkeypatch):
    """Fuera de un request, `usuario_actual()` cae al piloto: armar la clave de
    S3 con él bajaría la foto de otro usuario sin que nada fallara."""
    claves = []
    monkeypatch.setattr(media_sync, "bajar_archivo",
                        lambda key, destino: claves.append(key) or _crear_archivo(key, destino))
    monkeypatch.setattr(media_fal, "imagen_fal", _imagen)
    monkeypatch.setattr(mix, "tema_y_texto", _plan)

    mix_dia.correr(USER, "mix-1", "2026-09-21")
    assert claves[0] == f"imagenes/{USER}/mix-abc-base.jpg"


def test_el_texto_se_recorta_a_lo_que_la_red_acepta():
    """Antes que perder el día por el texto, se recorta. Un día publicado con
    un texto sencillo es mejor que una campaña que se apaga sola."""
    largo = "hola " * 100
    assert len(mix_dia._texto_que_pasa("twitter", largo)) <= 280
    assert mix_dia._texto_que_pasa("instagram", "Pan #a #b #c #d #e #f #g") \
        == "Pan"


# ---------------------------------------------------------------------------
# la infra y el handler

def test_el_worker_atiende_el_reloj_y_el_dia(monkeypatch):
    """Si estas dos ramas no existieran, la regla correría cada hora, la
    Lambda devolvería {"ok": True} y no publicaría nada: éxito silencioso."""
    llamadas = []
    monkeypatch.setattr("worker.mix_reloj.despachar",
                        lambda: llamadas.append("reloj") or {"ok": True})
    monkeypatch.setattr("worker.mix_dia.correr",
                        lambda u, c, d: llamadas.append((u, c, d)))

    lambda_worker.handler({"tipo": "mix_reloj"}, None)
    lambda_worker.handler({"Records": [{"body": '{"tipo": "mix_dia", '
                                                '"user_id": "u", "campana": "m", '
                                                '"dia": "2026-09-21"}'}]}, None)
    assert llamadas == ["reloj", ("u", "m", "2026-09-21")]


def _plantilla_jobs() -> dict:
    pytest.importorskip("aws_cdk", reason="aws_cdk vive en infra/requirements.txt")
    import aws_cdk as cdk
    if str(RAIZ / "infra") not in sys.path:
        sys.path.insert(0, str(RAIZ / "infra"))
    from stacks.db import DbStack
    from stacks.jobs import JobsStack
    from stacks.media import MediaStack
    env = cdk.Environment(account="191241816158", region="us-east-1")
    app = cdk.App()
    base = DbStack(app, "aws-media-db", env=env)
    media = MediaStack(app, "aws-media-media", env=env)
    JobsStack(app, "aws-media-jobs", env=env, cluster_db=base.cluster,
              media_bucket=media.bucket,
              cdn_domain=media.cdn.distribution_domain_name, image_ref="latest")
    return app.synth().get_stack_by_name("aws-media-jobs").template


@pytest.fixture(scope="module")
def plantilla() -> dict:
    return _plantilla_jobs()


def test_hay_una_regla_horaria_que_despierta_al_reloj(plantilla):
    """Con la forma nativa de un evento programado el handler no reconocería
    nada y la Lambda devolvería ok sin trabajar. Por eso el Input literal."""
    reglas = [r["Properties"] for r in plantilla["Resources"].values()
              if r["Type"] == "AWS::Events::Rule"]
    horaria = [r for r in reglas
               if r.get("ScheduleExpression") == "cron(0 * * * ? *)"]
    assert len(horaria) == 1
    assert horaria[0]["Targets"][0]["Input"] == '{"tipo":"mix_reloj"}'


def test_el_worker_puede_encolarse_a_si_mismo(plantilla):
    """El reloj corre EN el worker y encola el día de cada campaña. Sin la
    variable revienta con KeyError y sin el permiso con AccessDenied — las dos
    cosas en una corrida que nadie mira."""
    fn = [r for r in plantilla["Resources"].values()
          if r["Type"] == "AWS::Lambda::Function"
          and "worker.lambda_worker.handler" in str(r["Properties"].get("ImageConfig", ""))]
    assert fn, "no se encontró la Lambda del worker"
    assert "JOBS_QUEUE_URL" in fn[0]["Properties"]["Environment"]["Variables"]
    politicas = [r["Properties"] for r in plantilla["Resources"].values()
                 if r["Type"] == "AWS::IAM::Policy"]
    acciones = str(politicas)
    assert "sqs:SendMessage" in acciones


# ---------------------------------------------------------------------------
# lo que encontró la revisión adversarial (18-sep). Cada test de aquí abajo
# corresponde a un fallo que ya estaba escrito y que nadie habría visto hasta
# que un cliente reclamara.

def test_el_intervalo_del_rescate_va_casteado_a_int(monkeypatch):
    """EL fallo que habría dejado MIX muerto en silencio.

    El Data API tipa los parámetros y manda todo int de Python como bigint
    (`db._param`), pero `make_interval` solo existe con int4 — y la resolución
    de funciones de Postgres únicamente usa casts implícitos, así que responde
    «function make_interval(mins => bigint) does not exist». Como esta
    consulta es lo PRIMERO que hace el reloj, la Lambda se caía entera cada
    hora: campañas cobradas por adelantado, cero publicaciones, ningún error
    que nadie estuviera mirando."""
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: vistas.append(sql) or [])
    db.mix_corridas_colgadas(60)
    assert "make_interval(mins => :m::int)" in " ".join(vistas[0].split())


def test_si_el_rescate_falla_las_campanas_se_despachan_igual(reloj, monkeypatch):
    """Rescatar es limpieza. Que falle no puede costarle el día a las 182
    campañas de esa hora."""
    _ahora(monkeypatch, "2026-09-21T09:00")

    def truena(m=60):
        raise RuntimeError("la base está despertando")
    monkeypatch.setattr(db, "mix_corridas_colgadas", truena)

    assert mix_reloj.despachar()["despachadas"] == 1
    assert reloj == [(USER, "mix-1", "2026-09-21")]


def test_se_devuelve_al_precio_que_pago_y_no_al_de_hoy():
    """Una campaña de MIX puede durar dos meses, y en ese rato se puede
    desplegar un precio nuevo. Devolver a la tarifa de hoy regalaría créditos
    si subió y se quedaría con los del usuario si bajó. El recibo manda, igual
    que en `creditos.producir_cobrado`."""
    # 10 días cobrados a 5 = 50. Hoy la tarifa es 7.
    c = campana(creditos_cobrados=50, creditos_devueltos=0)
    assert mix.tarifa_cobrada(c, 7) == 5
    assert mix.devolucion_pendiente(c, 4, 7) == 30       # 6 días × 5, no × 7
    # y si bajara a 3, tampoco se le paga de menos
    assert mix.devolucion_pendiente(c, 4, 3) == 30
    # sin cobrar todavía, manda la tarifa de hoy
    assert mix.tarifa_cobrada(campana(creditos_cobrados=0), 7) == 7


def test_una_campana_ya_liquidada_no_devuelve_otra_vez(monkeypatch):
    """El día colgado de una campaña que el usuario ya apagó.

    Apagar devolvió TODOS los días sin salir, ese incluido, y no tocó
    `mix_corridas`: la fila sigue en 'corriendo'. Una hora después el rescate
    la encuentra, gana el cierre —sigue siendo 'corriendo'— y devolvería sus
    créditos por segunda vez. El tope global no lo frena: basta que un día
    haya salido para que quepan cinco de más."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i:
                        campana(estado="cancelada", creditos_cobrados=50,
                                creditos_devueltos=35))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver", _prohibido("devolver"))
    assert mix_dia.devolver_dia(USER, "mix-1", "2026-09-21") == 0


def test_el_ejemplo_no_puede_resucitar_un_dia_ya_publicado(monkeypatch):
    """El único camino que publicaba DOS VECES en la cuenta de un cliente.

    Pedir otro ejemplo tarda hasta dos minutos. Si en ese rato el usuario
    enciende y el reloj publica el día 1, al terminar el ejemplo devolvía esa
    fila a 'ejemplo' —borrando el post_id— y el reloj la veía libre otra vez.
    Una fila que ya no es un ejemplo no se toca nunca más."""
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: vistas.append(sql) or [])
    db.mix_guardar_ejemplo(USER, "mix-1", "2026-09-20", tema="t", texto="x",
                           media_key="k.jpg")
    sql = " ".join(vistas[0].split())
    assert "ON CONFLICT" in sql.upper()
    assert "WHERE mix_corridas.estado = 'ejemplo'" in sql


def test_cambiar_las_fechas_borra_el_ejemplo_que_quedo_huerfano(monkeypatch):
    """Si adelanta el inicio, el ejemplo del arranque viejo queda DENTRO del
    rango nuevo, y ahí deja de ser inofensivo: el reloj lo reclamaría y
    publicaría el mensaje de un rango que el usuario descartó."""
    vistas = []

    def falso(sql, params=None):
        vistas.append((" ".join(sql.split()), params))
        return [{"id": "mix-1", "estado": "borrador"}] if "SELECT" in sql else []
    monkeypatch.setattr(db, "ejecutar", falso)

    db.mix_guardar_borrador(USER, "nuevo", motivo="Pan", tono="vender",
                            imagen_key="f.jpg", canal_id="c1",
                            canal_red="instagram", canal_nombre="@p",
                            hora="09:00", zona="America/Guayaquil",
                            empieza="2026-09-20", termina="2026-09-29")
    borrados = [(s, p) for s, p in vistas if s.startswith("DELETE")]
    assert len(borrados) == 1
    assert "estado = 'ejemplo'" in borrados[0][0]
    assert "dia <> :d::date" in borrados[0][0]
    assert borrados[0][1]["d"] == "2026-09-20"


def test_el_borrador_manda_las_fechas_como_fecha_y_no_como_texto(monkeypatch):
    """El 500 del 19-sep-2026, la primera vez que alguien guardó un borrador
    contra la base de verdad.

    El Data API manda TODOS los parámetros como texto, y Postgres no convierte
    text→date solo dentro de un INSERT: la petición moría con «column
    "empieza" is of type date but expression is of type text». Aquí el SQL se
    arma en bucle sobre `CAMPOS_CAMPANA`, así que el cast no puede escribirse a
    mano como en el resto del archivo — va en el molde, y este test es lo que
    lo sujeta. Las columnas de texto NO lo llevan: un `::date` de más rompe
    igual de fuerte, solo que en la otra dirección."""
    def sql_de(columna_viva):
        vistas = []

        def falso(sql, params=None):
            vistas.append(" ".join(sql.split()))
            return [{"id": "mix-1", "estado": "borrador"}] if columna_viva and \
                   sql.lstrip().startswith("SELECT") else []
        monkeypatch.setattr(db, "ejecutar", falso)
        db.mix_guardar_borrador(USER, "nuevo", motivo="Pan", tono="vender",
                                imagen_key="f.jpg", canal_id="c1",
                                canal_red="instagram", canal_nombre="@p",
                                hora="09:00", zona="America/Guayaquil",
                                empieza="2026-09-20", termina="2026-09-29")
        return vistas

    # sin borrador previo: se inserta la campaña entera
    inserts = [s for s in sql_de(False) if s.startswith("INSERT INTO mix_campanas")]
    assert len(inserts) == 1
    assert ":empieza::date" in inserts[0] and ":termina::date" in inserts[0]

    # con borrador previo: se actualiza, y el UPDATE tiene el mismo problema
    updates = [s for s in sql_de(True) if s.startswith("UPDATE mix_campanas")]
    assert len(updates) == 1
    assert "empieza = :empieza::date" in updates[0]
    assert "termina = :termina::date" in updates[0]

    # y las de texto siguen siendo texto
    for sql in inserts + updates:
        for campo in ("motivo", "tono", "imagen_key", "canal_id", "canal_red",
                      "canal_nombre", "hora", "zona"):
            assert f":{campo}::date" not in sql
