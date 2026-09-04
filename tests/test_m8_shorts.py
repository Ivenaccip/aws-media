"""M8 — shorts en la web: tarifas de tarifas.json §shorts, el API (preview de
costo, cobro antes de lanzar, devolución si no se pudo encolar), el job de
análisis (canónico existente = no re-transcribe; candidatos LLM saneados) y la
tarea de render en Fargate (stream copy, export, salidas a S3, devolución en
fallo). Sin red: S3/SQS/SFN/LLM van mockeados."""
import json

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs, media_sync
from server import shorts_api


# ---------------------------------------------------------------------------
# tarifa (créditos SOLO de tarifas.json)

def test_tarifas_salen_de_tarifas_json():
    from pathlib import Path
    t = json.loads((Path(__file__).resolve().parent.parent / "tools" / "tarifas.json")
                   .read_text(encoding="utf-8"))["shorts"]
    assert creditos.SHORTS_TRANSCRIPCION_CR_5MIN == t["transcripcion_por_5min"]
    assert creditos.SHORTS_ANALISIS_CR == t["analisis"]
    assert creditos.SHORTS_RENDER_CR == t["render_por_short"]


def test_costo_analizar_con_y_sin_transcript():
    # con canónico: solo el análisis LLM
    assert creditos.costo_shorts_analizar(1200, con_transcript=True) == \
        creditos.SHORTS_ANALISIS_CR
    # sin canónico: + transcripción por cada 5 min EMPEZADOS (20 min = 4 bloques)
    assert creditos.costo_shorts_analizar(1200, con_transcript=False) == \
        creditos.SHORTS_ANALISIS_CR + 4 * creditos.SHORTS_TRANSCRIPCION_CR_5MIN
    # 21 min = 5 bloques (hacia arriba, regla de la spec)
    assert creditos.costo_shorts_analizar(1260, con_transcript=False) == \
        creditos.SHORTS_ANALISIS_CR + 5 * creditos.SHORTS_TRANSCRIPCION_CR_5MIN


def test_costo_render_por_short():
    assert creditos.costo_shorts_render(3) == 3 * creditos.SHORTS_RENDER_CR


# ---------------------------------------------------------------------------
# API

DOC = {"flags": {"generado": True},
       "subidas": [{"key": "videos/v1/subidas/charla.mp4", "bytes": 9}]}


@pytest.fixture
def nube(monkeypatch, tmp_path):
    monkeypatch.delenv("COGNITO_POOL_ID", raising=False)
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.delenv("ASSEMBLYAI_API_KEY", raising=False)
    docs = {"v1": json.loads(json.dumps(DOC))}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: docs.get(n))
    fijados = []
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, campo, v: fijados.append((campo, json.loads(v))))
    monkeypatch.setattr(shorts_api, "_duracion_s", lambda key: 1200.0)   # 20 min
    monkeypatch.setattr(media_sync, "listar_prefijo", lambda pre: [])
    from server.app import app
    cliente = TestClient(app)
    cliente.docs, cliente.fijados = docs, fijados
    return cliente


def test_estado_404_si_no_es_del_usuario(nube):
    assert nube.get("/api/shorts/ajeno").status_code == 404


def test_costo_preview_sin_transcript_pide_key(nube):
    j = nube.get("/api/shorts/v1/costo").json()
    assert j["fuente"] == "videos/v1/subidas/charla.mp4"   # la subida gana al gen
    assert j["duracion_s"] == 1200.0 and j["con_transcript"] is False
    assert j["creditos_analizar"] == creditos.costo_shorts_analizar(1200, False)
    assert j["backend_listo"] is False and "ASSEMBLYAI" in j["aviso"]


def test_costo_preview_con_transcript_no_pide_key(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    j = nube.get("/api/shorts/v1/costo").json()
    assert j["con_transcript"] is True and j["backend_listo"] is True
    assert j["creditos_analizar"] == creditos.SHORTS_ANALISIS_CR


def test_analizar_cobra_encola_y_fija_estado(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    cobros = []
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobros.append((n, ref)) or 1)
    encolados = []
    monkeypatch.setattr(jobs, "encolar_shorts_analizar", lambda u, n: encolados.append(n))
    r = nube.post("/api/shorts/v1/analizar")
    assert r.status_code == 200 and r.json()["creditos"] == creditos.SHORTS_ANALISIS_CR
    assert cobros == [(creditos.SHORTS_ANALISIS_CR, "shorts-analizar:v1")]
    assert encolados == ["v1"]
    campo, st = nube.fijados[-1]
    assert campo == "shorts" and st["estado"] == "analizando" and st["duracion_s"] == 1200.0


def test_analizar_402_no_encola(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    def sin_saldo(n, ref, u=None):
        raise creditos.SinSaldo(n, 0)
    monkeypatch.setattr(creditos, "cobrar", sin_saldo)
    monkeypatch.setattr(jobs, "encolar_shorts_analizar",
                        lambda u, n: pytest.fail("no debía encolar"))
    assert nube.post("/api/shorts/v1/analizar").status_code == 402


def test_analizar_503_sin_key_y_sin_transcript(nube):
    assert nube.post("/api/shorts/v1/analizar").status_code == 503


def test_analizar_devuelve_si_no_pudo_encolar(nube, monkeypatch):
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: 1)
    devueltos = []
    monkeypatch.setattr(creditos, "devolver", lambda n, ref, u=None: devueltos.append(n) or 1)
    def truena(u, n):
        raise RuntimeError("sin SQS")
    monkeypatch.setattr(jobs, "encolar_shorts_analizar", truena)
    assert nube.post("/api/shorts/v1/analizar").status_code == 502
    assert devueltos == [creditos.SHORTS_ANALISIS_CR]
    assert nube.fijados[-1][1]["estado"] == "error"


def test_analizar_409_si_ya_corre(nube):
    from datetime import datetime, timezone
    nube.docs["v1"]["shorts"] = {
        "estado": "analizando",
        "inicio": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    assert nube.post("/api/shorts/v1/analizar").status_code == 409


CANDS = {"estado": "candidatos",
         "candidatos": [{"start": 10.0, "end": 40.0, "score": 8.0}]}


def test_render_cobra_por_short_y_lanza(nube, monkeypatch):
    nube.docs["v1"]["shorts"] = json.loads(json.dumps(CANDS))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    cobros, lanzados = [], []
    monkeypatch.setattr(creditos, "cobrar", lambda n, ref, u=None: cobros.append((n, ref)) or 1)
    monkeypatch.setattr(jobs, "lanzar_shorts_render", lambda u, n: lanzados.append(n) or "arn")
    r = nube.post("/api/shorts/v1/render", json={
        "shorts": [{"start": 10, "end": 40, "hook_line1": "el gancho"},
                   {"start": 60, "end": 90}],
        "estilo": "bounce", "plataforma": "tiktok", "tipo": "auto"})
    assert r.status_code == 200
    assert cobros == [(2 * creditos.SHORTS_RENDER_CR, "shorts-render:v1")]
    assert lanzados == ["v1"]
    st = nube.fijados[-1][1]
    assert st["render"]["estado"] == "corriendo" and st["render"]["estilo"] == "bounce"
    assert st["render"]["segmentos"][0] == {"id": 1, "start": 10.0, "end": 40.0,
                                            "hook_line1": "el gancho", "hook_line2": ""}


def test_render_exige_analisis_previo(nube):
    r = nube.post("/api/shorts/v1/render",
                  json={"shorts": [{"start": 0, "end": 30}]})
    assert r.status_code == 409


def test_render_valida_duracion_y_estilo(nube):
    nube.docs["v1"]["shorts"] = json.loads(json.dumps(CANDS))
    assert nube.post("/api/shorts/v1/render", json={
        "shorts": [{"start": 0, "end": 2}]}).status_code == 400        # 2 s
    assert nube.post("/api/shorts/v1/render", json={
        "shorts": [{"start": 0, "end": 30}], "estilo": "neon"}).status_code == 400


# ---------------------------------------------------------------------------
# worker: despacho y análisis

def test_worker_despacha_shorts_analizar(monkeypatch):
    from worker import lambda_worker, shorts_analizar
    llamado = {}
    monkeypatch.setattr(shorts_analizar, "analizar",
                        lambda u, n: llamado.update(u=u, n=n))
    lambda_worker.handler({"Records": [{"body": json.dumps(
        {"tipo": "shorts_analizar", "user_id": "u1", "proyecto": "v1"})}]}, None)
    assert llamado == {"u": "u1", "n": "v1"}


CANONICO = {"schema_version": "1.0", "language": "es",
            "source": {"id": "charla", "duration": 120.0},
            "asr": {"backend": "assemblyai"},
            "words": [{"text": "hola", "start": 1.0, "end": 1.4},
                      {"text": "mundo", "start": 1.5, "end": 2.0}],
            "segments": [{"text": "hola mundo", "first_word": 0, "last_word": 1}]}


@pytest.fixture
def analisis(monkeypatch):
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    from worker import shorts_analizar
    from pipeline import costes_infra
    reg = {"fijados": [], "devueltos": []}
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "shorts": {"estado": "analizando", "fuente": "videos/v1/pelicula.mp4",
                   "creditos": 6}})
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: reg["fijados"].append(json.loads(v)))
    monkeypatch.setattr(costes_infra, "registrar", lambda *a: None)
    monkeypatch.setattr(media_sync, "listar_prefijo",
                        lambda pre: [f"{pre}charla.canonical.json"])
    monkeypatch.setattr(media_sync, "leer_texto",
                        lambda k: json.dumps(CANONICO))
    return shorts_analizar, reg


def test_analisis_con_canonico_no_transcribe_y_sanea(analisis, monkeypatch):
    shorts_analizar, reg = analisis
    import pipeline.llm as llm
    async def falso(name, system, user):
        assert "hola mundo" in user            # el transcript viajó al LLM
        return {"candidatos": [
            {"start": 1.0, "end": 31.0, "score": 8.5, "hook_line1": "H1",
             "razon": "gancho fuerte", "texto": "hola mundo"},
            {"start": 0, "end": 4, "score": 9.9},          # <10 s: fuera
            {"start": 5, "end": 200, "score": 9.9},        # >90 s: fuera
            {"start": "x", "end": 30},                     # basura: fuera
        ]}
    monkeypatch.setattr(llm, "chat_json", falso)
    shorts_analizar.analizar("u1", "v1")
    st = reg["fijados"][-1]
    assert st["estado"] == "candidatos"
    assert [c["score"] for c in st["candidatos"]] == [8.5]


def test_analisis_fallido_devuelve_creditos(analisis, monkeypatch):
    shorts_analizar, reg = analisis
    import pipeline.llm as llm
    async def truena(name, system, user):
        raise RuntimeError("LLM caído")
    monkeypatch.setattr(llm, "chat_json", truena)
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: reg["devueltos"].append((n, ref)) or 1)
    shorts_analizar.analizar("u1", "v1")
    assert reg["fijados"][-1]["estado"] == "error"
    assert reg["devueltos"] == [(6, "shorts-analizar:v1")]


# ---------------------------------------------------------------------------
# shorts_task (Fargate): pipeline con stream copy y estado final

RENDER = {"estado": "corriendo", "creditos": 4, "estilo": "bold",
          "plataforma": "all", "tipo": "talking-head",
          "segmentos": [{"id": 1, "start": 10.0, "end": 40.0,
                         "hook_line1": "H", "hook_line2": ""}]}


@pytest.fixture
def tarea(monkeypatch, tmp_path):
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.setenv("STATE_BACKEND", "postgres")
    monkeypatch.setenv("CDN_BASE", "https://cdn.example.com")
    from worker import shorts_task
    from pipeline import costes_infra
    reg = {"cmds": [], "subidos": [], "fijados": [], "devueltos": [], "infra": None}
    destino = tmp_path / "videos" / "v1"
    (destino / "work" / "transcripts").mkdir(parents=True)
    (destino / "work" / "transcripts" / "charla.canonical.json").write_text(
        json.dumps(CANONICO), encoding="utf-8")
    (destino / "pelicula.mp4").write_bytes(b"mp4")

    def correr(cmd, **kw):
        reg["cmds"].append([str(c) for c in cmd])
        tmp = destino / "work" / "shorts"
        if "snap_boundaries.py" in cmd[1]:
            (tmp / "snapped_segments.json").write_text(json.dumps(
                {"segments": RENDER["segmentos"]}), encoding="utf-8")
        if "export.sh" in str(cmd):
            salida = destino / "output" / "shorts"
            salida.mkdir(parents=True, exist_ok=True)
            (salida / "short_01_tiktok.mp4").write_bytes(b"x" * 10)
        return ""
    monkeypatch.setattr(shorts_task, "_correr", correr)
    monkeypatch.setattr(media_sync, "bajar_prefijo", lambda pre, d: 3)
    monkeypatch.setattr(media_sync, "subir_archivo",
                        lambda f, k: reg["subidos"].append(k))
    monkeypatch.setattr(db, "cargar_proyecto_editor", lambda u, n: {
        "shorts": {"estado": "candidatos", "fuente": "videos/v1/pelicula.mp4",
                   "render": json.loads(json.dumps(RENDER))}})
    monkeypatch.setattr(db, "fijar_campo_editor",
                        lambda u, n, c, v: reg["fijados"].append(json.loads(v)))
    monkeypatch.setattr(costes_infra, "registrar",
                        lambda u, p, c, usd: reg.update(infra=c))
    monkeypatch.setattr(creditos, "activo", lambda: True)
    monkeypatch.setattr(creditos, "devolver",
                        lambda n, ref, u=None: reg["devueltos"].append(n) or 1)
    return shorts_task, reg


def test_shorts_task_pipeline_completo(tarea):
    shorts_task, reg = tarea
    assert shorts_task.main("u1", "v1") == 0
    planos = [" ".join(c) for c in reg["cmds"]]
    # extract con stream copy (regla dura) y las etapas en orden
    extract = next(c for c in planos if "ffmpeg" in c and "clip_01" in c)
    assert "-c copy" in extract
    orden = [next(i for i, c in enumerate(planos) if pieza in c)
             for pieza in ("snap_boundaries", "clip_01", "compute_reframe",
                           "render.mjs", "export.sh", "validate.sh")]
    assert orden == sorted(orden)
    assert reg["subidos"] == ["videos/v1/output/shorts/short_01_tiktok.mp4"]
    st = reg["fijados"][-1]
    assert st["render"]["estado"] == "listo"
    assert st["render"]["salidas"][0]["url"] == \
        "https://cdn.example.com/videos/v1/output/shorts/short_01_tiktok.mp4"
    assert reg["infra"] == "infra-shorts" and reg["devueltos"] == []


def test_shorts_task_fallo_devuelve_y_sale_1(tarea, monkeypatch):
    shorts_task, reg = tarea
    def truena(*a, **k):
        raise RuntimeError("ffmpeg: boom")
    monkeypatch.setattr(shorts_task, "_pipeline", truena)
    assert shorts_task.main("u1", "v1") == 1
    st = reg["fijados"][-1]
    assert st["render"]["estado"] == "error" and "boom" in st["render"]["log"]
    assert reg["devueltos"] == [4] and reg["infra"] == "infra-shorts"


# ---------------------------------------------------------------------------
# jobs y dashboard

def test_lanzar_shorts_render_arma_el_comando(monkeypatch):
    monkeypatch.setenv("PRODUCIR_SM_ARN", "arn:sm")
    visto = {}
    class Sfn:
        def start_execution(self, **kw):
            visto.update(kw)
            return {"executionArn": "arn:exec"}
    monkeypatch.setattr(jobs, "_sfn", lambda: Sfn())
    assert jobs.lanzar_shorts_render("u1", "v1") == "arn:exec"
    assert json.loads(visto["input"])["command"] == \
        ["python", "-m", "worker.shorts_task", "u1", "v1"]


def test_conceptos_infra_incluyen_shorts():
    from pipeline import costes_infra
    assert "infra-shorts" in costes_infra.CONCEPTOS_FARGATE
    assert "infra-shorts-analizar" in costes_infra.CONCEPTOS_LAMBDA
    assert costes_infra.segundos_estimados("infra-shorts",
                                           costes_infra.costo_fargate(300)) == pytest.approx(300, abs=2)
