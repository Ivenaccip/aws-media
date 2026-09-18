"""M23 C5 — investiga tu competencia: el módulo que normaliza las tres redes,
la API que cobra por cuenta y encola, y el worker que arma el informe.

Lo que este archivo defiende:
  * que un número que la red NO informó viaje como hueco y jamás como 0 (un
    cero inventado le diría al usuario que no le gustó a nadie);
  * que el `indice` se calcule DENTRO de cada cuenta — es lo único que permite
    comparar una cuenta chica con una grande — y que con muy pocas
    publicaciones no se calcule en vez de inventarse;
  * que se cobre por cuenta ANTES de encolar y que lo que no llegó se devuelva,
    incluso cuando el informe sale bien con las demás cuentas;
  * que una cuenta caída no tumbe el informe entero;
  * que el token de Apify no acabe en el doc ni en los logs.

Sin red: Apify/SQS/S3/Postgres/LLM mockeados.

OJO: nada de importar pipeline/server a nivel de módulo — pipeline.config
carga el .env real en la COLECCIÓN y contaminaría el entorno de otros tests."""
import json
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

RAIZ = Path(__file__).resolve().parent.parent

# items tal como los devolvieron los actores el 2026-09-17 (recortados)
IG_ITEM = {"shortCode": "DdG4RIxIPyf", "url": "https://www.instagram.com/p/DdG4RIxIPyf/",
           "caption": "Welcome to Africa", "timestamp": "2026-09-10T13:00:14.000Z",
           "likesCount": 70864, "commentsCount": 512, "videoPlayCount": 2962604,
           "videoViewCount": 771952, "videoDuration": 72.614281, "type": "Video"}
TT_ITEM = {"id": "7683891628230315295", "title": "Welcome to Africa",
           "postPage": "https://www.tiktok.com/@natgeo/video/7683891628230315295",
           "uploadedAtFormatted": "2026-09-10T13:04:07.000Z", "views": 115008,
           "likes": 16629, "comments": 276, "shares": 477,
           "video": {"duration": 72.619}}
YT_ITEM = {"id": "qWl6yjyWPT8", "url": "https://www.youtube.com/watch?v=qWl6yjyWPT8",
           "title": "Why Ancient Egyptians Abandoned the Pyramids",
           "date": "2026-09-17T13:00:19Z", "viewCount": 45078, "likes": 572,
           "commentsCount": 37, "duration": "00:44:25", "durationSeconds": 2665}


# ---------------------------------------------------------------------------
# tarifa

def test_tarifa_espejo_de_tarifas_json():
    from pipeline import creditos
    tarifas = json.loads((RAIZ / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    assert creditos.costo_competencia(1) == tarifas["competencia"]["por_cuenta"]


def test_la_tarifa_se_multiplica_por_cuenta():
    from pipeline import creditos
    una = creditos.costo_competencia(1)
    assert creditos.costo_competencia(3) == una * 3
    assert creditos.costo_competencia(0) == 0


def test_los_precios_de_los_tres_actores_estan_en_pricing():
    """La tarifa en créditos solo se sostiene si el costo en dólares está
    escrito y verificado: sin esto nadie puede revisar el margen."""
    apify = json.loads((RAIZ / "tools" / "pricing.json").read_text(encoding="utf-8"))["apify"]
    assert apify["instagram_scraper"]["usd_por_resultado"] > 0
    assert apify["tiktok_profile_scraper"]["usd_por_video"] > 0
    assert apify["youtube_channel_videos"]["usd_por_video"] > 0


# ---------------------------------------------------------------------------
# detectar la cuenta

def test_detecta_las_tres_redes():
    from pipeline import competencia
    assert competencia.detectar("https://www.instagram.com/natgeo/") == ("instagram", "natgeo")
    assert competencia.detectar("instagram.com/natgeo") == ("instagram", "natgeo")
    assert competencia.detectar("https://www.tiktok.com/@natgeo") == ("tiktok", "natgeo")
    assert competencia.detectar("https://www.youtube.com/@NatGeo/videos") == ("youtube", "NatGeo")
    assert competencia.detectar("https://www.youtube.com/channel/UCpVm7") == ("youtube", "UCpVm7")


def test_la_liga_de_una_publicacion_no_es_una_cuenta():
    """Pegar el post en vez del perfil es el error más fácil de cometer, y
    «vigilar /p/DdG4» habría traído basura después de cobrar."""
    from pipeline import competencia
    with pytest.raises(competencia.CuentaInvalida):
        competencia.detectar("https://www.instagram.com/p/DdG4RIxIPyf/")
    with pytest.raises(competencia.CuentaInvalida):
        competencia.detectar("https://www.instagram.com/reel/DdG4RIxIPyf/")


def test_lo_que_no_es_un_perfil_se_rechaza():
    from pipeline import competencia
    for malo in ("", "no soy una liga", "https://facebook.com/natgeo",
                 "https://twitter.com/natgeo"):
        with pytest.raises(competencia.CuentaInvalida):
            competencia.detectar(malo)


# ---------------------------------------------------------------------------
# normalizar: las tres formas a una

def test_normaliza_instagram():
    from pipeline import competencia
    p = competencia.normalizar(IG_ITEM, "instagram", "natgeo")
    assert p["id"] == "DdG4RIxIPyf"
    assert p["enlace"] == "https://www.instagram.com/p/DdG4RIxIPyf/"
    assert p["vistas"] == 2962604      # las reproducciones, que es lo que enseña IG
    assert p["me_gusta"] == 70864 and p["comentarios"] == 512
    assert p["duracion_s"] == 72.6
    assert p["cuando"].startswith("2026-09-10T13:00:14")
    assert p["compartidos"] is None    # Instagram no lo informa


def test_normaliza_tiktok():
    from pipeline import competencia
    p = competencia.normalizar(TT_ITEM, "tiktok", "natgeo")
    assert p["vistas"] == 115008 and p["me_gusta"] == 16629
    assert p["comentarios"] == 276 and p["compartidos"] == 477
    assert p["enlace"].endswith("/video/7683891628230315295")
    assert p["duracion_s"] == 72.6


def test_normaliza_youtube_incluida_la_duracion_en_reloj():
    from pipeline import competencia
    p = competencia.normalizar(YT_ITEM, "youtube", "NatGeo")
    assert p["vistas"] == 45078 and p["me_gusta"] == 572 and p["comentarios"] == 37
    assert p["duracion_s"] == 2665
    assert competencia.normalizar({**YT_ITEM, "durationSeconds": None},
                                  "youtube", "x")["duracion_s"] == 2665.0  # «00:44:25»
    assert p["cuando"].startswith("2026-09-17T13:00:19")


def test_un_numero_que_no_vino_es_un_hueco_y_no_un_cero():
    """La regla que más importa: «no lo informa» y «cero» son cosas distintas.
    Una foto de Instagram no tiene vistas; decir 0 sería mentir."""
    from pipeline import competencia
    foto = competencia.normalizar(
        {"shortCode": "abc", "url": "https://instagram.com/p/abc/", "type": "Image",
         "likesCount": 10}, "instagram", "natgeo")
    assert foto["vistas"] is None
    assert foto["comentarios"] is None
    assert foto["me_gusta"] == 10
    vacia = competencia.normalizar({}, "tiktok", "x")
    assert vacia["vistas"] is None and vacia["me_gusta"] is None


def test_un_cero_de_verdad_sigue_siendo_cero():
    from pipeline import competencia
    p = competencia.normalizar({**TT_ITEM, "comments": 0}, "tiktok", "natgeo")
    assert p["comentarios"] == 0


# ---------------------------------------------------------------------------
# el índice: la única comparación honesta

def _pubs(cuenta, vistas):
    return [{"id": f"{cuenta}-{i}", "cuenta": cuenta, "vistas": v, "cuando": "2026-09-01"}
            for i, v in enumerate(vistas)]


def test_el_indice_se_calcula_dentro_de_cada_cuenta():
    """Una cuenta grande y una chica en la misma corrida: sin índice, las 5
    publicaciones de la grande taparían el éxito real de la chica."""
    from pipeline import competencia
    grande = _pubs("grande", [1000, 1000, 1000, 1000])
    chica = _pubs("chica", [10, 10, 10, 90])
    todas = competencia.con_indice(grande + chica)
    porid = {p["id"]: p for p in todas}
    assert porid["grande-0"]["indice"] == 1.0
    assert porid["chica-3"]["indice"] == 9.0      # nueve veces lo normal DE SU cuenta
    mejor = competencia.ordenar(todas)[0]
    assert mejor["id"] == "chica-3", "la cuenta grande tapó el éxito de la chica"


def test_con_muy_pocas_publicaciones_no_hay_indice():
    """Con dos publicaciones la mediana no dice nada: mejor sin dato que con
    un dato que invita a concluir."""
    from pipeline import competencia
    todas = competencia.con_indice(_pubs("x", [10, 900]))
    assert all(p["indice"] is None for p in todas)


def test_las_publicaciones_sin_vistas_no_ensucian_la_mediana():
    from pipeline import competencia
    pubs = _pubs("x", [100, 100, 100])
    pubs.append({"id": "foto", "cuenta": "x", "vistas": None, "cuando": "2026-09-01"})
    todas = competencia.con_indice(pubs)
    porid = {p["id"]: p for p in todas}
    assert porid["x-0"]["indice"] == 1.0
    assert porid["foto"]["indice"] is None
    assert competencia.ordenar(todas)[-1]["id"] == "foto"


def test_lo_que_ve_el_llm_no_lleva_enlaces():
    """El LLM no necesita las ligas para razonar y cada una son tokens que se
    pagan; además lo que no entra no puede acabar citado en la respuesta."""
    from pipeline import competencia
    p = competencia.normalizar(IG_ITEM, "instagram", "natgeo")
    solo = competencia.para_llm([p])[0]
    assert "enlace" not in solo
    assert solo["indice"] is None and solo["vistas"] == 2962604
    assert solo["red"] == "Instagram"


# ---------------------------------------------------------------------------
# endpoints

@pytest.fixture
def cliente(monkeypatch):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("MEDIA_BUCKET", "bucket-de-prueba")
    from server.app import app
    return TestClient(app)


@pytest.fixture
def s3(monkeypatch):
    """media_sync en memoria: {key: texto}."""
    from pipeline import media_sync
    docs = {}
    monkeypatch.setattr(media_sync, "leer_texto", docs.get)
    monkeypatch.setattr(media_sync, "escribir_texto",
                        lambda key, texto, tipo="application/json": docs.__setitem__(key, texto))
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pref: sorted(k for k in docs if k.startswith(pref)))
    return docs


def test_agregar_cuenta_no_cuesta_creditos(cliente, s3, monkeypatch):
    """Guardar a quién vigilas no trae publicaciones: cobrar aquí sería cobrar
    por escribir en una lista."""
    from pipeline import creditos
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda *a, **k: pytest.fail("cobró por guardar"))
    r = cliente.post("/api/competencia/cuentas",
                     json={"url": "https://www.instagram.com/natgeo/"})
    assert r.status_code == 200
    assert r.json()["cuentas"][0]["cuenta"] == "natgeo"
    assert r.json()["cuentas"][0]["red"] == "instagram"


def test_no_se_vigila_dos_veces_a_la_misma_cuenta(cliente, s3):
    cliente.post("/api/competencia/cuentas", json={"url": "https://www.tiktok.com/@natgeo"})
    r = cliente.post("/api/competencia/cuentas", json={"url": "https://tiktok.com/@NatGeo"})
    assert r.status_code == 409


def test_la_misma_cuenta_en_dos_redes_si_se_puede(cliente, s3):
    """@natgeo existe en las tres redes y son tres cuentas distintas."""
    cliente.post("/api/competencia/cuentas", json={"url": "https://instagram.com/natgeo"})
    r = cliente.post("/api/competencia/cuentas", json={"url": "https://tiktok.com/@natgeo"})
    assert r.status_code == 200 and len(r.json()["cuentas"]) == 2


def test_hay_un_tope_de_cuentas(cliente, s3):
    from pipeline import competencia
    for i in range(competencia.MAX_CUENTAS):
        assert cliente.post("/api/competencia/cuentas",
                            json={"url": f"https://instagram.com/cuenta{i}"}).status_code == 200
    r = cliente.post("/api/competencia/cuentas", json={"url": "https://instagram.com/unamas"})
    assert r.status_code == 409


def test_quitar_una_cuenta_que_no_esta(cliente, s3):
    assert cliente.delete("/api/competencia/cuentas/ig-nadie").status_code == 404


def test_analizar_cobra_por_cuenta_guarda_y_encola(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    cliente.post("/api/competencia/cuentas", json={"url": "https://instagram.com/uno"})
    cliente.post("/api/competencia/cuentas", json={"url": "https://tiktok.com/@dos"})
    encolado, movimientos = [], []
    monkeypatch.setattr(jobs, "encolar_competencia",
                        lambda u, i, cuentas: encolado.append((i, cuentas)))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n, ref)))
    r = cliente.post("/api/competencia/analizar", json={})
    assert r.status_code == 200
    assert r.json()["creditos"] == creditos.costo_competencia(2)
    assert len(encolado) == 1 and len(encolado[0][1]) == 2
    assert movimientos[0][1] == creditos.costo_competencia(2)
    doc = json.loads(next(v for k, v in s3.items() if "/informes/" in k))
    assert doc["estado"] == "analizando" and len(doc["cuentas"]) == 2


def test_analizar_sin_cuentas_no_cobra(cliente, s3, monkeypatch):
    from pipeline import creditos
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda *a, **k: pytest.fail("cobró sin cuentas"))
    assert cliente.post("/api/competencia/analizar", json={}).status_code == 422


def test_no_se_lanzan_dos_revisiones_a_la_vez(cliente, s3, monkeypatch):
    """La segunda cobraría otra vez por traer lo mismo."""
    from pipeline import creditos, jobs
    cliente.post("/api/competencia/cuentas", json={"url": "https://instagram.com/uno"})
    monkeypatch.setattr(jobs, "encolar_competencia", lambda *a: None)
    monkeypatch.setattr(creditos, "activo", lambda: False)
    assert cliente.post("/api/competencia/analizar", json={}).status_code == 200
    r = cliente.post("/api/competencia/analizar", json={})
    assert r.status_code == 409


def test_si_no_se_pudo_encolar_se_devuelven_los_creditos(cliente, s3, monkeypatch):
    from pipeline import creditos, jobs
    cliente.post("/api/competencia/cuentas", json={"url": "https://instagram.com/uno"})
    movimientos = []
    monkeypatch.setattr(jobs, "encolar_competencia",
                        lambda *a: (_ for _ in ()).throw(RuntimeError("SQS caído")))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar",
                        lambda n, ref, user=None: movimientos.append(("cobro", n)))
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append(("devolucion", n)))
    r = cliente.post("/api/competencia/analizar", json={})
    assert r.status_code == 502
    assert [m[0] for m in movimientos] == ["cobro", "devolucion"]
    assert movimientos[0][1] == movimientos[1][1]


def test_el_listado_no_arrastra_las_publicaciones(cliente, s3, monkeypatch):
    """Cincuenta publicaciones por informe × cuarenta informes no caben en una
    respuesta de listado: el detalle se pide al abrirlo."""
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    s3["usuarios/u1/competencia/informes/inf-20260917-120000.json"] = json.dumps(
        {"estado": "listo", "inicio": "2026-09-17T12:00:00+00:00", "creditos": 6,
         "cuentas": [{"id": "ig-uno", "red": "instagram", "cuenta": "uno"}],
         "publicaciones": [{"id": "p1", "vistas": 10}], "lectura": {"ganchos": "x"}})
    j = cliente.get("/api/competencia").json()
    assert j["informes"][0]["n_publicaciones"] == 1
    assert "publicaciones" not in j["informes"][0]
    assert "lectura" not in j["informes"][0]
    detalle = cliente.get("/api/competencia/informes/inf-20260917-120000").json()
    assert detalle["publicaciones"][0]["id"] == "p1"


def test_un_informe_inventado_no_lee_otras_llaves(cliente, s3, monkeypatch):
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    s3["usuarios/u1/competencia/cuentas.json"] = json.dumps({"cuentas": []})
    assert cliente.get("/api/competencia/informes/inf-20260917-120000").status_code == 404
    for malo in ("../cuentas", "..%2Fcuentas", "cuentas"):
        assert cliente.get(f"/api/competencia/informes/{malo}").status_code in (404, 422)


# ---------------------------------------------------------------------------
# worker

@pytest.fixture
def worker(monkeypatch, s3):
    """El worker con Apify, LLM, créditos e infra mockeados."""
    from pipeline import creditos, db
    from worker import competencia_analizar as w
    # el worker escribe DEFAULT_USER_ID en el entorno de verdad (así identifica
    # al usuario en la Lambda). Declararlo con monkeypatch es lo que devuelve el
    # entorno a su sitio al terminar: si no, el usuario «u1» se queda puesto y
    # los tests que corren después ven a otro usuario.
    monkeypatch.setenv("DEFAULT_USER_ID", "u1")
    movimientos = []
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, user=None: movimientos.append(("devolucion", n, ref)))
    monkeypatch.setattr(db, "backend", lambda: "off")
    monkeypatch.setattr(w, "_lectura_llm", _falso_llm)
    return w, movimientos


async def _falso_llm(publicaciones):
    return {"patrones": [{"que": "los de más de 60 s rinden", "ids": ["DdG4RIxIPyf"]}],
            "ganchos": "empiezan con una pregunta", "formato": "vertical, 60-90 s",
            "probar": ["probar un gancho de pregunta"], "advertencia": ""}


def _doc_inicial(s3, informe_id="inf-20260917-120000", creditos_=6, por_cuenta=3):
    key = f"usuarios/u1/competencia/informes/{informe_id}.json"
    s3[key] = json.dumps({"estado": "analizando", "inicio": "2026-09-17T12:00:00+00:00",
                          "creditos": creditos_, "credito_por_cuenta": por_cuenta})
    return key


def test_el_worker_arma_el_informe(worker, s3, monkeypatch):
    w, movimientos = worker
    key = _doc_inicial(s3)
    monkeypatch.setattr(w, "_traer", lambda red, cuenta: [
        dict(_normal(IG_ITEM if red == "instagram" else TT_ITEM, red, cuenta), vistas=v)
        for v in (100, 100, 100, 500)])
    w.analizar("u1", "inf-20260917-120000",
               [{"red": "instagram", "cuenta": "uno"}, {"red": "tiktok", "cuenta": "dos"}])
    doc = json.loads(s3[key])
    assert doc["estado"] == "listo"
    assert len(doc["publicaciones"]) == 8
    assert doc["publicaciones"][0]["indice"] == 5.0      # ordenado por índice
    assert doc["lectura"]["ganchos"] == "empiezan con una pregunta"
    assert doc["fallidas"] == [] and doc["devueltos"] == 0
    assert movimientos == []


def _normal(item, red, cuenta):
    from pipeline import competencia
    return competencia.normalizar(item, red, cuenta)


def test_una_cuenta_caida_no_tumba_el_informe_y_devuelve_su_parte(worker, s3, monkeypatch):
    """La regla del worker: Instagram puede estar caído mientras TikTok
    responde. Se cobró por cuenta, así que se devuelve por cuenta."""
    w, movimientos = worker
    key = _doc_inicial(s3)

    def traer(red, cuenta):
        if red == "instagram":
            raise RuntimeError("Instagram no respondió")
        return [_normal(TT_ITEM, red, cuenta)]

    monkeypatch.setattr(w, "_traer", traer)
    w.analizar("u1", "inf-20260917-120000",
               [{"red": "instagram", "cuenta": "uno"}, {"red": "tiktok", "cuenta": "dos"}])
    doc = json.loads(s3[key])
    assert doc["estado"] == "listo"
    assert len(doc["publicaciones"]) == 1
    assert len(doc["fallidas"]) == 1 and doc["fallidas"][0]["cuenta"] == "uno"
    assert doc["devueltos"] == 3 and doc["cobrados"] == 3
    assert movimientos == [("devolucion", 3, "competencia:inf-20260917-120000")]


def test_una_cuenta_privada_no_se_cobra(worker, s3, monkeypatch):
    """Sin publicaciones no hay nada que entregar: se devuelve igual que si
    hubiera fallado, y el informe dice por qué."""
    w, movimientos = worker
    key = _doc_inicial(s3)
    monkeypatch.setattr(w, "_traer", lambda red, cuenta:
                        [] if cuenta == "privada" else [_normal(TT_ITEM, red, cuenta)])
    w.analizar("u1", "inf-20260917-120000",
               [{"red": "instagram", "cuenta": "privada"}, {"red": "tiktok", "cuenta": "dos"}])
    doc = json.loads(s3[key])
    assert doc["estado"] == "listo" and doc["devueltos"] == 3
    assert "privada" in doc["fallidas"][0]["motivo"] or "vacía" in doc["fallidas"][0]["motivo"]


def test_si_no_llega_ninguna_cuenta_es_error_y_se_devuelve_todo(worker, s3, monkeypatch):
    w, movimientos = worker
    key = _doc_inicial(s3)
    monkeypatch.setattr(w, "_traer",
                        lambda red, cuenta: (_ for _ in ()).throw(RuntimeError("caído")))
    w.analizar("u1", "inf-20260917-120000",
               [{"red": "instagram", "cuenta": "uno"}, {"red": "tiktok", "cuenta": "dos"}])
    doc = json.loads(s3[key])
    assert doc["estado"] == "error"
    assert movimientos == [("devolucion", 6, "competencia:inf-20260917-120000")]


def test_si_el_llm_falla_los_numeros_siguen_valiendo(worker, s3, monkeypatch):
    """La lectura es el extra; las publicaciones con sus números son lo que el
    usuario pagó. Un fallo del LLM no puede tirar el informe ni devolver."""
    w, movimientos = worker
    key = _doc_inicial(s3, creditos_=3)

    async def revienta(publicaciones):
        raise RuntimeError("openai caído")

    monkeypatch.setattr(w, "_lectura_llm", revienta)
    monkeypatch.setattr(w, "_traer", lambda red, cuenta: [_normal(TT_ITEM, red, cuenta)])
    w.analizar("u1", "inf-20260917-120000", [{"red": "tiktok", "cuenta": "dos"}])
    doc = json.loads(s3[key])
    assert doc["estado"] == "listo" and doc["lectura"] == {}
    assert len(doc["publicaciones"]) == 1
    assert movimientos == []


def test_el_worker_le_pone_tope_de_gasto_a_cada_corrida(monkeypatch):
    """Sin maxTotalChargeUsd, lo que se paga depende de cuántos resultados
    decida devolver un actor de un tercero."""
    from pipeline import apify
    from worker import competencia_analizar as w
    visto = {}
    monkeypatch.setattr(apify, "correr",
                        lambda actor, entrada, timeout_s=900, tope_usd=None:
                        visto.update(actor=actor, tope=tope_usd, entrada=entrada) or [IG_ITEM])
    w._traer("instagram", "natgeo")
    assert visto["tope"] == w.TOPE_USD_CUENTA and visto["tope"] > 0
    assert visto["entrada"]["resultsLimit"] == 10


def test_el_error_que_se_guarda_no_trae_el_token(worker, s3, monkeypatch):
    """El mensaje de un HTTPError de requests trae la URL completa; si el token
    viajara ahí acabaría en el doc que la pantalla pinta (incidente 2026-09-13)."""
    w, _ = worker
    key = _doc_inicial(s3)
    monkeypatch.setenv("APIFY_TOKEN", "apify_api_secretisimo123")
    monkeypatch.setattr(w, "_traer", lambda red, cuenta: (_ for _ in ()).throw(
        RuntimeError("401 Client Error for url: https://api.apify.com/v2/acts/x/runs"
                     "?token=apify_api_secretisimo123")))
    w.analizar("u1", "inf-20260917-120000", [{"red": "tiktok", "cuenta": "dos"}])
    guardado = s3[key]
    assert "secretisimo" not in guardado and "apify_api_" not in guardado
    assert "[tachado]" in guardado


def test_el_despacho_del_worker_conoce_el_tipo(monkeypatch):
    from worker import lambda_worker
    llamado = []
    monkeypatch.setattr("worker.competencia_analizar.analizar",
                        lambda u, i, c: llamado.append((u, i, c)))
    lambda_worker.handler({"Records": [{"body": json.dumps(
        {"tipo": "competencia", "user_id": "u1", "informe_id": "inf-1",
         "cuentas": [{"red": "tiktok", "cuenta": "dos"}]})}]}, None)
    assert llamado == [("u1", "inf-1", [{"red": "tiktok", "cuenta": "dos"}])]


def test_encolar_manda_lo_minimo(monkeypatch):
    from pipeline import jobs

    class SQS:
        def __init__(self):
            self.enviados = []

        def send_message(self, QueueUrl, MessageBody):  # noqa: N803 — firma de boto3
            self.enviados.append(json.loads(MessageBody))

    falso = SQS()
    monkeypatch.setattr(jobs, "_sqs", lambda: falso)
    monkeypatch.setenv("JOBS_QUEUE_URL", "https://cola")
    jobs.encolar_competencia("u1", "inf-1", [{"id": "ig-uno", "red": "instagram",
                                              "cuenta": "uno"}])
    assert falso.enviados == [{"tipo": "competencia", "user_id": "u1",
                               "informe_id": "inf-1",
                               "cuentas": [{"id": "ig-uno", "red": "instagram",
                                            "cuenta": "uno"}]}]
