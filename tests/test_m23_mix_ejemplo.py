"""M23 · D — el ejemplo del día 1 de MIX, desde que se pide hasta que aparece.

Es la única parte de MIX que el usuario mira ANTES de pagar, y hasta el
20-sep-2026 no funcionó nunca en la nube: se generaba dentro del POST, entre el
LLM y Grok pasan de treinta segundos a dos minutos, y API Gateway corta toda
petición a los 29 s. En el server local no hay ese tope y ahí sí salía — por eso
llegó a producción. Ahora se encola.

Lo que este archivo defiende:

  * **que nadie vuelva a generarlo dentro del request.** Es el bug, y volvería
    a entrar sin hacer ruido: en local seguiría funcionando;
  * **que el ejemplo no publique dos veces.** Entre que se encola y termina, el
    usuario puede encender y el reloj publicar el día 1 de verdad. Escribir el
    ejemplo encima devolvería esa fila a 'ejemplo' y el reloj la vería libre;
  * **que una fila a medias no deje el día 1 sin publicar.** Es la otra cara de
    lo anterior y es más silenciosa: nadie ve que falta un día, y sus créditos
    tampoco se devuelven;
  * **que no se cobre sin haber visto.** La fila del día 1 existe desde que se
    PIDE el ejemplo, así que «hay corridas» dejó de ser prueba de nada;
  * **que dos clics no paguen dos imágenes.** El ejemplo es gratis para el
    usuario; la imagen la pagamos nosotros;
  * **que un fallo deje la pantalla mirando algo.** Si nada escribe el error,
    el orbe gira para siempre.

La base va mockeada (lo impide el fixture autouse de conftest), así que del SQL
se comprueba la FORMA: que siga siendo condicionado.
"""
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pipeline.config                                   # noqa: E402
from pipeline import creditos, db, jobs, media_sync, mix  # noqa: E402
from server import mix_api                                # noqa: E402
from worker import lambda_worker, mix_dia, mix_ejemplo    # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
USER = "u-mix"
API = (RAIZ / "server" / "mix_api.py").read_text(encoding="utf-8")
PANTALLA = (RAIZ / "static" / "mix.html").read_text(encoding="utf-8")

CAMPANA = {
    "user_id": USER, "id": "mix-1", "motivo": "Vender el menú nuevo",
    "tono": "vender", "imagen_key": "mix-abc-base.jpg", "canal_id": "123",
    "canal_red": "instagram", "canal_nombre": "mi negocio", "hora": "09:00",
    "zona": "America/Guayaquil", "empieza": "2026-09-20",
    "termina": "2026-10-03", "estado": "borrador",
    "creditos_cobrados": 0, "creditos_devueltos": 0,
}
DIA1 = "2026-09-20"
MEDIA1 = "mix-mix-1-2026-09-20.jpg"


def campana(**cambios) -> dict:
    return {**CAMPANA, **cambios}


@pytest.fixture
def cliente(monkeypatch):
    from server.app import app
    monkeypatch.setattr(db, "usuario_actual", lambda: USER)
    monkeypatch.setattr(mix_api.db, "usuario_actual", lambda: USER)
    monkeypatch.setattr(mix_api.db, "backend", lambda: "postgres")
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(mix_api.creditos, "activo", lambda: True)
    return TestClient(app)


# ---------------------------------------------------------------------------
# el endpoint: pide y se va

def test_el_ejemplo_no_se_genera_dentro_del_request():
    """EL test de este archivo, y se lee del código porque es la única forma de
    que falle en CI: un ejemplo generado en línea SIGUE funcionando en local, y
    solo se cae en la nube, contra usuarios de verdad.

    API Gateway corta a los 29 s y ese tope no es de la Lambda: no hay timeout
    que subir. El endpoint encola y contesta; quien genera es el worker."""
    endpoint = API[API.index('@router.post("/ejemplo")'):API.index("class EncenderIn")]
    assert "encolar_mix_ejemplo" in endpoint
    for lento in ("tema_y_texto", "imagen_fal"):
        assert lento not in API, f"{lento} volvió al endpoint: 29 s y muere"
    # y sin `async def` no hay dónde esperar a un modelo aunque alguien lo meta
    assert "def ejemplo():" in endpoint and "async def ejemplo" not in endpoint


def test_pedir_un_ejemplo_contesta_en_el_acto_y_deja_el_trabajo_encolado(
        cliente, monkeypatch):
    encolados = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: campana())
    monkeypatch.setattr(mix_api.db, "mix_pedir_ejemplo", lambda *a: True)
    monkeypatch.setattr(mix_api.jobs, "encolar_mix_ejemplo",
                        lambda *a: encolados.append(a))

    r = cliente.post("/api/mix/ejemplo")
    assert r.status_code == 200
    assert r.json() == {"dia": DIA1, "estado": "preparando"}
    assert encolados == [(USER, "mix-1", DIA1)]


def test_el_candado_va_antes_de_encolar_y_no_despues(cliente, monkeypatch):
    """Dos clics seguidos —o dos pestañas— serían dos imágenes de Grok pagadas
    por nosotros para enseñar exactamente lo mismo. Quien pierde la fila no
    encola: el trabajo se despacha DESPUÉS de ganarla, nunca antes."""
    encolados = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: campana())
    monkeypatch.setattr(mix_api.db, "mix_pedir_ejemplo", lambda *a: False)
    monkeypatch.setattr(mix_api.jobs, "encolar_mix_ejemplo",
                        lambda *a: encolados.append(a))

    r = cliente.post("/api/mix/ejemplo")
    assert r.status_code == 409
    assert not encolados


def test_con_la_campana_encendida_no_se_prepara_otro_ejemplo(cliente, monkeypatch):
    """Desde que enciende manda el reloj. Un ejemplo nuevo solo podría pisar un
    día que ya es una publicación de verdad."""
    encolados = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: campana(estado="activa"))
    monkeypatch.setattr(mix_api.db, "mix_pedir_ejemplo",
                        lambda *a: pytest.fail("ni siquiera se pide la fila"))
    monkeypatch.setattr(mix_api.jobs, "encolar_mix_ejemplo",
                        lambda *a: encolados.append(a))

    assert cliente.post("/api/mix/ejemplo").status_code == 409
    assert not encolados


def test_si_no_se_pudo_encolar_el_ejemplo_no_se_queda_preparandose_para_siempre(
        cliente, monkeypatch):
    """La fila ya está apartada: si el mensaje no sale, nadie va a escribir en
    ella nunca y la pantalla se queda girando por un trabajo que no existe."""
    fallidos = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: campana())
    monkeypatch.setattr(mix_api.db, "mix_pedir_ejemplo", lambda *a: True)
    monkeypatch.setattr(mix_api.db, "mix_fallar_ejemplo",
                        lambda u, c, d, err: fallidos.append((d, err)))

    def truena(*a):
        raise RuntimeError("SQS no contesta")
    monkeypatch.setattr(mix_api.jobs, "encolar_mix_ejemplo", truena)

    r = cliente.post("/api/mix/ejemplo")
    assert r.status_code == 502
    assert len(fallidos) == 1 and fallidos[0][0] == DIA1


def test_encender_con_el_ejemplo_a_medias_no_cobra(cliente, monkeypatch):
    """«Hay corridas» dejó de ser prueba de nada el día que el ejemplo pasó a
    la cola: la fila del día 1 existe desde que se PIDE. Cobrar con ella a
    medias es cobrar por algo que el usuario todavía no ha visto."""
    cobros = []
    monkeypatch.setattr(mix_api.db, "mix_campana", lambda u: campana())
    monkeypatch.setattr(mix_api.db, "mix_corridas",
                        lambda u, c: [{"dia": DIA1, "estado": "preparando"}])
    monkeypatch.setattr(mix_api.creditos, "cobrar",
                        lambda *a, **k: cobros.append(a))

    r = cliente.post("/api/mix/encender", json={"id": "mix-1"})
    assert r.status_code == 409
    assert not cobros


# ---------------------------------------------------------------------------
# la base: qué fila se puede pisar y cuál no

def _sql_de(funcion, monkeypatch, devuelve=()):
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, params=None: vistas.append(" ".join(sql.split()))
                        or list(devuelve))
    funcion()
    return vistas


def test_pedir_el_ejemplo_no_puede_pisar_un_dia_de_verdad(monkeypatch):
    """La fila del día 1 es la misma antes y después de pagar. Un upsert sin
    condición la devolvería a 'preparando' con el post ya publicado, y el reloj
    la vería libre otra vez: dos publicaciones en la cuenta de un cliente."""
    sql = _sql_de(lambda: db.mix_pedir_ejemplo(USER, "mix-1", DIA1), monkeypatch)[0]
    assert "ON CONFLICT" in sql.upper()
    assert "WHERE mix_corridas.estado = 'ejemplo'" in sql
    for real in ("'corriendo'", "'publicada'", "'incierta'"):
        assert real not in sql


def test_pedir_otro_ejemplo_mientras_uno_corre_no_pone_dos_trabajos(monkeypatch):
    """Solo se pisa un 'preparando' que ya murió —tiene `error`— o que lleva
    demasiado rato callado. Uno vivo se respeta: sería otra imagen pagada por
    nosotros para enseñar lo mismo. El tope existe porque una pantalla que dice
    «preparando» para siempre es peor que un segundo intento."""
    sql = _sql_de(lambda: db.mix_pedir_ejemplo(USER, "mix-1", DIA1), monkeypatch)[0]
    assert "mix_corridas.error IS NOT NULL" in sql
    assert "mix_corridas.actualizado < now() - :viejo::interval" in sql
    assert db.MINUTOS_EJEMPLO >= 3      # menos que eso pisa trabajos vivos


def test_el_ejemplo_fallido_se_queda_donde_esta_y_solo_deja_el_error(monkeypatch):
    """No pasa a 'error': ese estado es el de un día de campaña que no salió
    —cuenta para la devolución y sale en la lista de días— y un ejemplo no es
    un día que falló, es un intento que murió."""
    sql = _sql_de(lambda: db.mix_fallar_ejemplo(USER, "mix-1", DIA1, "no salió"),
                  monkeypatch)[0]
    assert sql.startswith("UPDATE mix_corridas SET error = :err")
    assert "estado = 'preparando'" in sql       # la condición, no una asignación
    assert "SET estado" not in sql


def test_un_ejemplo_a_medias_no_deja_el_dia_uno_sin_publicar(monkeypatch):
    """El daño más silencioso de todos: si el reloj solo reclamara 'ejemplo',
    una fila 'preparando' —de alguien que pidió otro ejemplo justo antes de
    encender— bloquearía el día 1 para siempre. Ese día no saldría, nadie
    devolvería sus créditos y en la pantalla no habría ningún error."""
    sql = _sql_de(lambda: db.mix_reclamar_ejemplo(USER, "mix-1", DIA1),
                  monkeypatch, devuelve=[{"media_key": "m.jpg"}])[0]
    assert "estado IN ('ejemplo', 'preparando')" in sql


# ---------------------------------------------------------------------------
# el worker

def _crear_archivo(key: str, destino: Path) -> bool:
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_bytes(b"jpeg")
    return True


async def _plan(campana_, dia, ruta, base, ya_usados):
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_bytes(b"jpeg")
    return {"tema": "pan recién hecho", "texto": "Pan del día"}


@pytest.fixture
def worker(monkeypatch, tmp_path):
    """Todo lo lento y lo caro, cortado: ni modelo, ni S3, ni base."""
    # `preparar()` asigna os.environ["DEFAULT_USER_ID"] directo (tiene que
    # hacerlo: en una Lambda caliente sigue puesto el del trabajo anterior).
    # Registrarlo aquí es lo que hace que monkeypatch lo restaure al terminar;
    # sin esto, «u-mix» se queda de usuario por defecto para el resto de la
    # suite y los tests de login empiezan a fallar por orden de ejecución.
    monkeypatch.setenv("DEFAULT_USER_ID", "piloto")
    monkeypatch.setattr(pipeline.config, "settings",
                        SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(mix_ejemplo, "cargar_env_usuario", lambda u: None)
    monkeypatch.setattr(media_sync, "bajar_archivo", _crear_archivo)
    hecho = {"guardados": [], "fallos": [], "subidas": []}
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda local, key: hecho["subidas"].append(key))
    monkeypatch.setattr(db, "mix_guardar_ejemplo", lambda u, c, d, **k:
                        hecho["guardados"].append((d, k)))
    monkeypatch.setattr(db, "mix_fallar_ejemplo", lambda u, c, d, err:
                        hecho["fallos"].append((d, err)))
    monkeypatch.setattr(mix_ejemplo, "tema_e_imagen", _plan)
    return hecho


def test_el_ejemplo_sale_y_se_guarda_como_la_corrida_del_dia_uno(worker, monkeypatch):
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())

    r = mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert r["accion"] == "ejemplo"
    assert worker["guardados"] == [(DIA1, {"tema": "pan recién hecho",
                                           "texto": "Pan del día",
                                           "media_key": MEDIA1})]


def test_la_imagen_se_sube_bajo_el_dueno_de_la_campana_y_no_del_piloto(
        worker, monkeypatch):
    """Aquí no hay request: `usuario_actual()` cae al usuario por defecto. Con
    ese atajo, el ejemplo de un cliente acabaría en la carpeta de otro —y nada
    fallaría de forma visible."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())
    monkeypatch.setattr(db, "usuario_actual",
                        lambda: pytest.fail("el worker no tiene usuario actual"))

    mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert worker["subidas"] == [mix.clave_imagen(USER, MEDIA1)]


def test_si_enciende_mientras_se_prepara_el_ejemplo_no_se_guarda(worker, monkeypatch):
    """El único camino que publicaba DOS VECES en la cuenta de un cliente, y
    con la cola el hueco dura más: son minutos, no la vida de un request.

    Si enciende mientras se genera, el reloj publica el día 1 de verdad;
    guardar el ejemplo encima devolvería esa fila a 'ejemplo' y el reloj la
    vería libre otra vez. Se mira ANTES de escribir, y el WHERE del upsert lo
    vuelve a mirar en la base."""
    estados = iter([campana(), campana(estado="activa")])
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: next(estados))

    r = mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert r["accion"] == "nada"
    assert not worker["guardados"]


def test_si_mueve_el_arranque_mientras_se_prepara_el_ejemplo_se_tira(
        worker, monkeypatch):
    """Lo que salga ya no es el día 1 de nada: es el día 1 de un rango que el
    usuario descartó. Guardarlo dejaría una fila huérfana dentro del rango
    nuevo, y esa fila bloquea su día para siempre."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i:
                        campana(empieza="2026-09-25", termina="2026-10-08"))

    r = mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert r["accion"] == "nada"
    assert not worker["guardados"]


def test_un_ejemplo_que_no_sale_deja_el_error_escrito_y_no_levanta(
        worker, monkeypatch):
    """Nunca relanza —un reintento de SQS es otra imagen pagada por nosotros
    para enseñar lo mismo— así que lo único que le queda a la pantalla es lo
    que este trabajo escriba en la fila del día."""
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())

    async def truena(*a, **k):
        raise RuntimeError("Grok no contesta")
    monkeypatch.setattr(mix_ejemplo, "tema_e_imagen", truena)

    r = mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert r["accion"] == "error"
    assert worker["fallos"] == [(DIA1, mix_ejemplo.SIN_MODELO)]
    assert not worker["guardados"]


def test_sin_la_foto_de_la_campana_se_dice_eso_y_no_se_gasta_una_imagen(
        worker, monkeypatch):
    monkeypatch.setattr(db, "mix_campana_de", lambda u, i: campana())
    monkeypatch.setattr(media_sync, "bajar_archivo", lambda key, destino: False)
    monkeypatch.setattr(mix_ejemplo, "tema_e_imagen",
                        lambda *a: pytest.fail("no hay base que darle al modelo"))

    r = mix_ejemplo.preparar(USER, "mix-1", DIA1)
    assert worker["fallos"] == [(DIA1, mix_ejemplo.SIN_IMAGEN)]
    assert r["accion"] == "error"


def test_el_ejemplo_y_el_dia_se_generan_con_el_mismo_codigo():
    """No es ahorro de líneas: el ejemplo del día 1 ES la publicación del día
    1. Si cada uno generara a su manera, el usuario aprobaría una cosa y
    saldría otra — y nadie lo vería hasta tenerlo publicado."""
    assert mix_ejemplo.tema_e_imagen is mix_dia.tema_e_imagen


def test_el_worker_sabe_despachar_el_ejemplo(monkeypatch):
    """Sin esta rama el mensaje cae en el `else` con un ValueError, SQS lo
    reintenta y acaba en la DLQ: la pantalla se queda girando sin un solo
    error que leer."""
    vistos = []
    monkeypatch.setattr("worker.mix_ejemplo.preparar",
                        lambda u, c, d: vistos.append((u, c, d)))
    cuerpo = ('{"tipo": "mix_ejemplo", "user_id": "u-mix", '
              '"campana": "mix-1", "dia": "2026-09-20"}')
    lambda_worker.handler({"Records": [{"body": cuerpo}]}, None)
    assert vistos == [(USER, "mix-1", DIA1)]


def test_el_mensaje_lleva_solo_ids():
    """La campaña vive en Postgres y lo que se genera se decide al correr. Un
    mensaje con el motivo dentro enseñaría lo que había cuando se pidió, no lo
    que el usuario acabó escribiendo."""
    import inspect
    fuente = inspect.getsource(jobs.encolar_mix_ejemplo)
    assert '"tipo": "mix_ejemplo"' in fuente
    for dentro in ("motivo", "tono", "imagen_key"):
        assert dentro not in fuente


# ---------------------------------------------------------------------------
# la pantalla

def test_la_pantalla_ya_no_espera_el_ejemplo_en_la_respuesta_del_post():
    """El POST ya solo devuelve el día. Si la pantalla siguiera leyendo
    `j.imagen`, enseñaría un hueco en vez del ejemplo — y en silencio."""
    pedido = PANTALLA[PANTALLA.index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    assert '(await mxPost("/api/mix/ejemplo")).dia' in pedido
    assert "j.imagen" not in pedido and "j.texto" not in pedido
    assert "mxSeguirEjemplo(dia, firma)" in pedido


def test_la_pantalla_consulta_hasta_que_el_dia_uno_esta_listo():
    assert "async function mxEsperarEjemplo" in PANTALLA
    espera = PANTALLA[PANTALLA.index("async function mxEsperarEjemplo"):
                      PANTALLA.index("async function mxSeguirEjemplo")]
    assert 'mxFj("/api/mix"' in espera
    assert 'fila.estado === "ejemplo"' in espera
    # y un intento muerto corta la espera en vez de girar hasta el tope
    assert "if (fila.error)" in espera
    # igual que encender la campaña: desde ahí manda el reloj, no esta pantalla
    assert 'j.campana.estado !== "borrador"' in espera
    # y una petición colgada no puede congelar la espera entera
    assert "AbortSignal.timeout" in espera


def test_la_pantalla_retoma_un_ejemplo_a_medias_al_volver():
    """Es lo que compra haberlo pasado a la cola: el trabajo sigue en la nube
    sin esta pestaña. Sin esto, cerrarla seguiría costando el ejemplo."""
    assert 'x.estado === "preparando"' in PANTALLA
    assert "mxSeguirEjemplo(String(aMedias.dia).slice(0, 10)" in PANTALLA


def test_un_intento_muerto_se_lee_al_volver_a_la_pantalla():
    """Si murió mientras no había nadie mirando, este es el ÚNICO sitio donde
    puede leerse. Sin esto el usuario vuelve y encuentra la pantalla como si
    nunca hubiera pedido nada: sin ejemplo, sin error y sin saber qué pasó."""
    assert "if (aMedias.error) { mxAviso(aMedias.error); return; }" in PANTALLA


def test_el_409_de_pedir_otro_ejemplo_no_deja_un_callejon():
    """El servidor respeta un ejemplo en camino diez minutos y la pantalla deja
    de mirarlo a los cuatro: en ese hueco el botón contestaría 409 una y otra
    vez. Recargar reengancha la espera del que ya existe — y vale igual para el
    otro 409, el de la campaña ya encendida."""
    pedido = PANTALLA[PANTALLA.index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    assert "if (fallo.status === 409) {" in pedido
    assert "await mxCargar();" in pedido


def test_el_sondeo_se_va_frenando():
    """GET /api/mix trae campaña, corridas, saldo y el estado de Blotato, y
    Aurora está en una sola ACU con 182 personas por llegar. Preguntar cada
    cinco segundos durante cuatro minutos, por pestaña, es carga que no hace
    falta pasado el primer minuto."""
    import re
    pasos = [int(n) for n in
             re.search(r"MXEJ_PASOS = \[([^\]]+)\]", PANTALLA).group(1).split(",")]
    assert pasos == sorted(pasos), "los pasos tienen que crecer, no encogerse"
    assert pasos[0] <= 5000 and pasos[-1] >= 15000


def test_pedir_otro_ejemplo_retira_el_anterior_de_la_pantalla():
    """Con la cola, pedir otro ejemplo devuelve su fila a 'preparando' y desde
    ahí /encender contesta 409. Dejar el anterior en pantalla enseñaría el
    costo y el botón de encender durante los dos minutos en que pulsarlo no
    puede funcionar — un callejón, y encima con el precio delante."""
    pedido = PANTALLA[PANTALLA.index("async function mxVerEjemplo"):]
    pedido = pedido[:pedido.index("async function mxEncender")]
    retirado = "\n".join(["  mxEjemplo = null;", "  mxFirmaEjemplo = null;",
                          "  mxCambio();"])
    assert retirado in pedido


def test_los_errores_de_la_espera_llevan_status():
    """`mxTexto` solo enseña el mensaje de un error que traiga `status`; sin él
    lo cambia por el aviso de «sin conexión», que aquí sería mentira — el
    servidor contestó, y lo que dijo es justo lo que hay que leer."""
    espera = PANTALLA[PANTALLA.index("async function mxEsperarEjemplo"):
                      PANTALLA.index("async function mxSeguirEjemplo")]
    for lanzado in espera.split("throw ")[1:]:
        assert lanzado.startswith("Object.assign") or lanzado.startswith("e;"), \
            "un error sin status se leería como «sin conexión»"


def test_un_tropiezo_del_servidor_no_cancela_la_espera():
    """Aurora se duerme sola y el primer despertar tarda quince segundos: un
    5xx a mitad de la espera es pasajero y el trabajo sigue corriendo en la
    nube. Rendirse ahí sería tirar un ejemplo que estaba a punto de salir. Un
    4xx sí corta: la sesión caducó y no mejora por insistir."""
    espera = PANTALLA[PANTALLA.index("async function mxEsperarEjemplo"):
                      PANTALLA.index("async function mxSeguirEjemplo")]
    assert "if (st >= 400 && st < 500) throw e;" in espera
    assert "continue;" in espera


def test_el_orbe_avisa_antes_de_que_la_pantalla_se_rinda():
    """Si el aviso y el abandono cayeran a la vez, el usuario no llegaría a
    leer que puede cerrar la pantalla y volver."""
    import re
    aviso = int(re.search(r"MXEJ_AVISO = (\d+)", PANTALLA).group(1))
    tope = int(re.search(r"MXEJ_TOPE = (\d+)", PANTALLA).group(1))
    assert aviso < tope


def test_la_espera_ya_no_promete_veinte_segundos():
    """Prometer ~20 s para algo que tarda hasta dos minutos es enseñarle al
    usuario que la pantalla se colgó."""
    assert "~20 s" not in PANTALLA
    assert "Preparando tu ejemplo · hasta 2 min" in PANTALLA
    # y ya no hace falta pedirle que no cierre: el trabajo no vive aquí
    assert "no cierres esta pantalla todavía" not in PANTALLA
