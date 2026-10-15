"""E2 — la bandeja «Tus trabajos» ve una copia editable: UNA ficha `edicion`.

`static/trabajos.js` es tonto: pinta lo que llega y no arma frases. Por eso
TODAS las frases de la bandeja (el paso, el resumen, el error en tres partes)
las arma `server/trabajos_api.py`, y este archivo las fija una por una.
"""
import time
from datetime import datetime, timezone

import pytest

from pipeline import db
from server import trabajos_api as tj
from test_e2_mundo import cliente, mundo  # noqa: F401  (las fixtures se importan por nombre)

AHORA = time.time()
DESDE = AHORA - 24 * 3600


def iso(t):
    return datetime.fromtimestamp(t, timezone.utc).isoformat(timespec="seconds")


def copia(**editar):
    base = {"copia": True, "estado": "corriendo", "paso": "entender", "cobrado": True, "creditos": 2,
            "inicio": iso(AHORA - 130), "instruccion": "Quita muletillas y silencios. Es para YouTube.",
            "n_videos": 3, "fuentes": [{}, {}, {}]}
    base.update(editar)
    return {"titulo": "El tren de papel + 2 más", "editar": base}


def fichas(doc, nombre="ed-9f1c0a7b"):
    return tj.fichas_editor(nombre, doc, DESDE, AHORA)


def una(doc, nombre="ed-9f1c0a7b"):
    fs = fichas(doc, nombre)
    assert len(fs) == 1, fs
    return fs[0]


# ---------------------------------------------------------------------------
# corriendo

def test_una_copia_corriendo_es_una_sola_ficha_edicion_y_no_la_vieja(cliente, mundo):
    fs = fichas(copia())
    assert [f["tipo"] for f in fs] == ["edicion"]            # no sale «La IA revisa tu metraje» además


def test_la_forma_de_la_ficha_corriendo(monkeypatch):
    f = una(copia())
    assert f == {
        "id": f"edicion:ed-9f1c0a7b:{int(AHORA - 130)}", "tipo": "edicion", "estado": "corriendo",
        "titulo": "La IA edita El tren de papel + 2 más", "detalle": "Ordenando tus 3 videos…",
        "progreso": None, "url": "", "cuando": iso(AHORA - 130), "devueltos": None,
        "edicion": {"nombre": "ed-9f1c0a7b", "paso": "entender", "pasos": ["Entender", "Editar", "Vista previa"],
                    "pedido": "Quita muletillas y silencios. Es para YouTube.", "inicio": iso(AHORA - 130),
                    "resumen": None, "enlace": None, "error": None}}


@pytest.mark.parametrize("paso,n,detalle", [
    ("entender", 1, "Entendiendo tu video…"), ("entender", 3, "Ordenando tus 3 videos…"),
    ("entender", 2, "Ordenando tus 2 videos…"),
    ("editar", 1, "La IA está editando tu video…"), ("editar", 3, "La IA está uniendo tus videos…"),
    ("vista", 1, "Preparando la vista previa…"), ("vista", 3, "Preparando la vista previa…")])
def test_la_frase_de_cada_paso_en_singular_y_plural(paso, n, detalle):
    f = una(copia(paso=paso, n_videos=n))
    assert f["detalle"] == detalle and f["edicion"]["paso"] == paso


def test_la_bandeja_no_promete_lo_que_el_motor_no_hace():
    """D-07: ni «nivelando el sonido» ni «con fundidos» (no existen en el motor)."""
    for paso in ("entender", "editar", "vista"):
        for n in (1, 3):
            d = una(copia(paso=paso, n_videos=n))["detalle"].lower()
            assert not any(p in d for p in ("nivel", "fundido", "música", "musica", "título de cierre"))


def test_un_paso_raro_cae_a_entender():
    assert una(copia(paso="inventado"))["edicion"]["paso"] == "entender"
    assert una(copia(paso=None))["edicion"]["paso"] == "entender"


def test_corriendo_no_lleva_url_para_que_la_bandeja_no_la_oculte_en_el_inicio():
    assert una(copia())["url"] == ""


def test_el_pedido_va_en_una_linea_y_se_recorta_a_140():
    f = una(copia(instruccion="Quita\nlos silencios\r\ny   las muletillas.\n\n" + "y " * 200))
    p = f["edicion"]["pedido"]
    assert "\n" not in p and "\r" not in p and "  " not in p
    assert len(p) == 140 and p.endswith("…")
    assert una(copia(instruccion="corto"))["edicion"]["pedido"] == "corto"


def test_el_titulo_cae_al_nombre_si_el_doc_no_lo_trae():
    doc = copia()
    del doc["titulo"]
    assert una(doc)["titulo"] == "La IA edita ed-9f1c0a7b"


def test_el_numero_de_videos_cae_a_las_fuentes_y_luego_a_uno():
    assert una(copia(n_videos=None, fuentes=[{}, {}]))["detalle"] == "Ordenando tus 2 videos…"
    assert una(copia(n_videos=None, fuentes=None))["detalle"] == "Entendiendo tu video…"


def test_con_el_cobro_sin_anotar_la_ficha_no_se_emite():
    """`cobrado == false` son los milisegundos entre reservar y cobrar: todavía no hay nada que anunciar."""
    assert fichas(copia(cobrado=False)) == []
    assert fichas(copia(cobrado=False, estado="error")) == []


def test_una_corrida_colgada_de_mas_de_3_horas_no_se_anuncia_como_viva():
    assert fichas(copia(inicio=iso(AHORA - 4 * 3600))) == []
    assert len(fichas(copia(inicio=iso(AHORA - 2 * 3600)))) == 1


def test_sin_inicio_legible_no_se_anuncia():
    assert fichas(copia(inicio=None)) == [] and fichas(copia(inicio="ayer")) == []


# ---------------------------------------------------------------------------
# listo

def listo(**kw):
    editar = dict(estado="listo", paso="vista", fin=iso(AHORA - 30), n_videos=3,
                  resultado={"n": 3, "dur_entrada_s": 762.0, "dur_salida_s": 749.3}, cortes=4, fluff=1, flags=2)
    editar.update(kw)
    return copia(**editar)


def test_una_union_dice_cuantos_videos_y_de_cuanto_a_cuanto():
    f = una(listo())
    assert f["estado"] == "listo" and f["titulo"] == "Tu video editado está listo"
    assert f["detalle"] == "Unimos 3 videos · 12:42 → 12:29"
    assert f["url"] == "/editor/ed-9f1c0a7b/"
    assert f["edicion"]["resumen"] == "Unimos 3 videos · 12:42 → 12:29"
    assert f["edicion"]["enlace"] == {"texto": "Abrir el editor", "url": "/editor/ed-9f1c0a7b/"}
    assert f["edicion"]["error"] is None and f["devueltos"] is None


def test_un_video_con_cortes_dice_cuanto_se_quito():
    f = una(listo(n_videos=1, resultado={"n": 1, "dur_entrada_s": 724.0, "dur_salida_s": 621.0}))
    assert f["detalle"] == "Quitamos 1:43 · 12:04 → 10:21" and f["titulo"] == "Tu video editado está listo"


def test_las_horas_se_leen_como_h_mm_ss():
    f = una(listo(n_videos=1, resultado={"n": 1, "dur_entrada_s": 4680.0, "dur_salida_s": 4000.0}))
    assert f["detalle"] == "Quitamos 11:20 · 1:18:00 → 1:06:40"


def test_un_video_sin_nada_que_cortar_lo_dice_y_cuenta_los_creditos_devueltos():
    f = una(listo(n_videos=1, cortes=0, fluff=0, flags=0, devueltos=2,
                  resultado={"n": 1, "dur_entrada_s": 90.0, "dur_salida_s": 90.0}))
    assert f["titulo"] == "Tu copia está lista, sin cortes"
    assert f["detalle"] == "La IA no encontró nada que cortar. Te devolvimos ✦ 2."
    assert f["edicion"]["enlace"]["url"] == "/editor/ed-9f1c0a7b/"


def test_sin_cortes_y_sin_devolucion_no_habla_de_creditos():
    f = una(listo(n_videos=1, cortes=0, fluff=0, flags=0,
                  resultado={"n": 1, "dur_entrada_s": 90.0, "dur_salida_s": 90.0}))
    assert f["detalle"] == "La IA no encontró nada que cortar."


def test_una_union_nunca_dice_sin_cortes_aunque_no_haya_sugerencias():
    """R17: una unión ES el entregable."""
    f = una(listo(cortes=0, fluff=0, flags=0, resultado={"n": 3, "dur_entrada_s": 60.0, "dur_salida_s": 60.0}))
    assert f["titulo"] == "Tu video editado está listo" and f["detalle"] == "Unimos 3 videos · 1:00 → 1:00"


def test_las_cifras_salen_del_resultado_y_si_no_estan_no_se_inventan():
    f = una(listo(resultado=None))
    assert f["detalle"] == "" and f["edicion"]["resumen"] is None and f["titulo"] == "Tu video editado está listo"
    f = una(listo(resultado={"n": 3, "dur_entrada_s": "mucho", "dur_salida_s": None}))
    assert f["detalle"] == "" and f["edicion"]["resumen"] is None


def test_lo_terminado_se_ve_24_horas():
    assert len(fichas(listo(fin=iso(AHORA - 23 * 3600)))) == 1
    assert fichas(listo(fin=iso(AHORA - 25 * 3600))) == []


def test_sin_fin_se_usa_el_inicio():
    assert len(fichas(listo(fin=None))) == 1
    assert fichas(listo(fin=None, inicio=iso(AHORA - 30 * 3600))) == []


# ---------------------------------------------------------------------------
# error: qué pasó, qué pasó con los créditos, qué sigue

def con_error(monkeypatch, **kw):
    monkeypatch.setattr(tj.creditos, "activo", lambda: True)
    base = dict(estado="error", paso="editar", fin=iso(AHORA - 20), n_videos=3, creditos=2, devueltos=2,
                error="RuntimeError: ffmpeg")
    base.update(kw)
    return una(copia(**base))


def test_el_error_de_una_union_en_tres_partes(monkeypatch):
    f = con_error(monkeypatch)
    assert f["estado"] == "error" and f["titulo"] == "No se pudo editar la unión de tus videos"
    assert f["devueltos"] == 2 and f["url"] == "" and f["detalle"] == ""
    assert f["edicion"]["error"] == {
        "que_paso": "Falló el paso «Editar» al unir tus 3 videos, de nuestro lado.",
        "creditos": "Te devolvimos ✦ 2.",
        "que_sigue": "Tus videos originales no se tocaron. Reintentar vuelve a cobrar ✦ 2.",
        "reintentar": {"texto": "Reintentar", "ruta": "/api/edicion/ed-9f1c0a7b/reintentar", "creditos": 2}}


def test_el_error_de_un_solo_video(monkeypatch):
    f = con_error(monkeypatch, n_videos=1)
    assert f["titulo"] == "No se pudo editar tu video"
    assert f["edicion"]["error"]["que_paso"] == "Falló el paso «Editar», de nuestro lado."
    assert f["edicion"]["error"]["que_sigue"] == "Tu original no se tocó. Reintentar vuelve a cobrar ✦ 2."


@pytest.mark.parametrize("paso,nombre", [("entender", "Entender"), ("editar", "Editar"), ("vista", "Vista previa")])
def test_el_paso_del_fallo_sale_de_donde_iba(monkeypatch, paso, nombre):
    assert con_error(monkeypatch, paso=paso)["edicion"]["error"]["que_paso"].startswith(f"Falló el paso «{nombre}»")


def test_sin_devolucion_no_hay_linea_de_creditos(monkeypatch):
    f = con_error(monkeypatch, devueltos=None)
    assert "creditos" not in f["edicion"]["error"] and f["devueltos"] is None
    assert f["edicion"]["error"]["reintentar"]["creditos"] == 2          # el reintento sí cobra
    f = con_error(monkeypatch, devueltos=0)
    assert "creditos" not in f["edicion"]["error"]


def test_sin_monedero_no_se_habla_de_creditos_en_ningun_lado(monkeypatch):
    monkeypatch.setattr(tj.creditos, "activo", lambda: False)
    f = una(copia(estado="error", paso="editar", fin=iso(AHORA - 20), creditos=2))
    e = f["edicion"]["error"]
    assert e["que_sigue"] == "Tus videos originales no se tocaron." and "creditos" not in e
    assert e["reintentar"] == {"texto": "Reintentar", "ruta": "/api/edicion/ed-9f1c0a7b/reintentar"}


def test_un_error_viejo_no_se_anuncia(monkeypatch):
    assert fichas(copia(estado="error", fin=iso(AHORA - 30 * 3600), inicio=iso(AHORA - 31 * 3600))) == []


def test_un_estado_desconocido_no_genera_ficha():
    assert fichas(copia(estado="raro")) == []


# ---------------------------------------------------------------------------
# lo que NO cambia

def test_las_fichas_viejas_de_e1_siguen_igual():
    doc = {"editar": {"estado": "corriendo", "inicio": iso(AHORA - 60)}}
    f = tj.fichas_editor("podcast", doc, DESDE, AHORA)[0]
    assert f["tipo"] == "editar" and f["titulo"] == "La IA revisa tu metraje"
    assert f["url"] == "/e1.html?p=podcast" and "edicion" not in f
    for copia_flag in (False, None, "true", 1):                      # solo `True` es una copia
        doc = {"editar": {"estado": "corriendo", "inicio": iso(AHORA - 60), "copia": copia_flag}}
        assert tj.fichas_editor("p", doc, DESDE, AHORA)[0]["tipo"] == "editar"


def test_una_copia_y_las_demas_corridas_del_mismo_proyecto_conviven():
    doc = copia()
    doc["importar"] = {"estado": "descargando", "inicio": iso(AHORA - 10)}
    assert sorted(f["tipo"] for f in fichas(doc)) == ["edicion", "importar"]


def test_el_id_cambia_con_cada_corrida():
    a, b = una(copia(inicio=iso(AHORA - 100))), una(copia(inicio=iso(AHORA - 50)))
    assert a["id"] != b["id"]


# ---------------------------------------------------------------------------
# reloj() en Python debe leerse igual que el de la web

@pytest.mark.parametrize("seg,texto", [(0, "0:00"), (59, "0:59"), (60, "1:00"), (724, "12:04"), (3599.4, "59:59"),
                                       (3600, "1:00:00"), (4680, "1:18:00"), (0.5, "0:01"), (-5, "0:00"),
                                       (762.04, "12:42")])
def test_reloj(seg, texto):
    assert tj.reloj(seg) == texto


@pytest.mark.parametrize("raro", [None, "x", float("nan"), float("inf")])
def test_reloj_con_basura_es_vacio(raro):
    assert tj.reloj(raro) == ""


# ---------------------------------------------------------------------------
# de punta a punta: GET /api/trabajos con una copia en la base

def test_el_endpoint_lista_la_copia_con_su_titulo(cliente, mundo, monkeypatch):
    monkeypatch.setattr(tj, "_peliculas", lambda u, d: [])
    monkeypatch.setattr(tj, "_s3", lambda u, d, a: [])
    mundo.copia("ed-9f1c0a7b", "El tren de papel + 2 más", estado="corriendo", n_videos=3,
                inicio=iso(time.time() - 90))
    monkeypatch.setattr(db, "corridas_editor", lambda u: [{"nombre": n, "doc": {
        "editar": d.get("editar"), "titulo": d.get("titulo")}} for n, d in mundo.docs(u).items()])
    j = cliente.get("/api/trabajos").json()
    assert [t["tipo"] for t in j["trabajos"]] == ["edicion"]
    assert j["trabajos"][0]["titulo"] == "La IA edita El tren de papel + 2 más"


def test_la_consulta_trae_el_titulo_del_doc():
    """`corridas_editor` solo trae las corridas, no el doc entero: el título tiene que ir con ellas."""
    import inspect
    src = inspect.getsource(db.corridas_editor)
    assert "'titulo', doc->'titulo'" in src and "doc->'editar'" in src
