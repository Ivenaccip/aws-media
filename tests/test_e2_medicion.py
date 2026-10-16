"""E2 · Ajustes 2 — lo que se cobra tiene que ser lo que se mide y lo que se hace.

- D-01 / INT-01  un video SIN pista de audio se cobraba como «transcripción» que el worker nunca hace
                 (`c["audio"]` falso → no llama a la ASR) y solo se devolvía la parte del LLM: con 2+
                 videos, nada (R17);
- D-12           `costo_editar` sumaba floats sin redondear: una suma que cae EXACTO en un múltiplo de
                 300 s podía quedar 1e-13 por encima y cobrar un bloque (✦ 2) de más;
- D-13           la caché de medición se fiaba del doc, no de S3: un PUT presignado a la misma key, sin
                 pasar por `/confirmar`, dejaba cotizar e iniciar midiendo el video VIEJO. Ahora `iniciar`
                 (que es el que cobra) compara el peso real del objeto con el de la caché y, si cambió,
                 vuelve a medir y cobra lo que de verdad hay.
"""
import json

import pytest

from pipeline import creditos
from test_e2_mundo import cliente, mundo, tarifa  # noqa: F401


def cotizar(cliente, *refs):
    return cliente.post("/api/edicion/cotizar", json={"videos": list(refs)})


def iniciar(cliente, mundo, *refs, **kw):
    return cliente.post("/api/edicion/iniciar", json=mundo.cuerpo(*refs, **kw))


# ---------------------------------------------------------------------------
# D-01 · un video mudo no se cobra como transcripción

def test_un_video_sin_pista_de_audio_cuesta_solo_la_edicion(cliente, mundo):
    """Una grabación de pantalla de 10 min, sin canónico y sin sonido: nada que transcribir."""
    mundo.subida("pantalla", dur=600.0, audio=False)
    r = cotizar(cliente, "proyecto:pantalla").json()
    assert r["bloqueo"] is None and r["creditos"] == tarifa("edicion")
    assert r["desglose"] == {"edicion": tarifa("edicion"), "transcripcion": 0}
    v = r["videos"][0]
    assert v["audio"] is False and v["se_transcribe"] is False and v["con_transcript"] is False


def test_iniciar_cobra_lo_mismo_que_cotizo_y_el_worker_recibe_transcribir_falso(cliente, mundo):
    mundo.subida("pantalla", dur=600.0, audio=False)
    cot = cotizar(cliente, "proyecto:pantalla").json()["creditos"]
    r = iniciar(cliente, mundo, "proyecto:pantalla")
    assert r.status_code == 200 and r.json()["creditos"] == cot == tarifa("edicion")
    assert mundo.neto("editar-sugerir:ed-9f1c0a7b") == tarifa("edicion")
    f = mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"][0]
    assert f["transcribir"] is False and f["audio"] is False
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["desglose"] == {"edicion": tarifa("edicion"), "transcripcion": 0}


def test_en_una_union_solo_cuentan_los_minutos_de_lo_que_si_tiene_voz(cliente, mundo):
    """Mudo de 10 min + video con voz de 100 s: la transcripción es de 100 s (un bloque), no de 700 s."""
    mundo.subida("pantalla", dur=600.0, audio=False)
    mundo.subida("charla", dur=100.0)
    r = cotizar(cliente, "proyecto:pantalla", "proyecto:charla").json()
    assert r["creditos"] == tarifa("edicion") + tarifa("transcripcion") == creditos.costo_editar([100.0])
    assert [v["se_transcribe"] for v in r["videos"]] == [False, True]
    ini = iniciar(cliente, mundo, "proyecto:pantalla", "proyecto:charla")
    assert ini.status_code == 200 and ini.json()["creditos"] == r["creditos"]
    assert [f["transcribir"] for f in mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"]] == [False, True]


def test_un_video_con_audio_sigue_cobrando_su_transcripcion(cliente, mundo):
    mundo.subida("charla", dur=724.0)
    assert cotizar(cliente, "proyecto:charla").json()["creditos"] == tarifa("edicion") + tarifa("transcripcion") * 3


def test_si_no_se_sabe_si_trae_audio_se_cuenta_como_que_si(cliente, mundo):
    """Igual que la caché (`bool(meta.get("audio", True))`): lo desconocido no regala la transcripción."""
    key = mundo.subida("charla", dur=300.0)
    mundo.medidas[key]["audio"] = None
    r = cotizar(cliente, "proyecto:charla").json()
    assert r["creditos"] == tarifa("edicion") + tarifa("transcripcion") and r["videos"][0]["se_transcribe"] is True


def test_el_mudo_en_cache_tampoco_se_cobra(cliente, mundo):
    key = mundo.subida("pantalla", dur=600.0, audio=False, bytes_=5_000_000,
                       meta={"key": "videos/pantalla/subidas/pantalla.mp4", "bytes": 5_000_000,
                             "duracion_s": 600.0, "ancho": 1920, "alto": 1080, "audio": False})
    r = cotizar(cliente, "proyecto:pantalla").json()
    assert mundo.mediciones_hechas == [] and r["creditos"] == tarifa("edicion")


def test_un_mudo_no_exige_la_clave_de_transcripcion(cliente, mundo, monkeypatch):
    """Sin ASSEMBLYAI_API_KEY no hay nada que transcribir en un mudo: no hay por qué bloquearlo."""
    monkeypatch.delenv("ASSEMBLYAI_API_KEY", raising=False)
    mundo.subida("pantalla", dur=600.0, audio=False)
    assert cotizar(cliente, "proyecto:pantalla").json()["bloqueo"] is None
    mundo.subida("charla", dur=600.0)
    assert cotizar(cliente, "proyecto:charla").json()["bloqueo"]["codigo"] == "sin_transcripcion"


# ---------------------------------------------------------------------------
# D-12 · la suma de duraciones no cobra un bloque de más

def test_costo_editar_no_cobra_un_bloque_de_mas_cuando_la_suma_cae_en_un_multiplo_de_300():
    duraciones = [71.615, 83.791, 130.482, 14.112]
    assert sum(duraciones) > 300.0                       # el float binario queda 6e-14 por encima...
    assert creditos.costo_editar(duraciones) == tarifa("edicion") + tarifa("transcripcion")     # ...y no cuenta
    assert creditos.costo_editar([150.0, 150.0]) == creditos.costo_editar([300.0])
    assert creditos.costo_editar([299.999, 0.002]) == tarifa("edicion") + tarifa("transcripcion") * 2   # 301.001 s sí pasa


def test_cotizar_cuatro_videos_que_suman_justo_5_minutos_cobra_un_bloque(cliente, mundo):
    for i, d in enumerate([71.615, 83.791, 130.482, 14.112]):
        mundo.subida(f"v{i}", dur=d)
    r = cotizar(cliente, *[f"proyecto:v{i}" for i in range(4)]).json()
    assert r["duracion_total_s"] == 300.0
    assert r["creditos"] == tarifa("edicion") + tarifa("transcripcion")
    ini = iniciar(cliente, mundo, *[f"proyecto:v{i}" for i in range(4)])
    assert ini.status_code == 200 and ini.json()["creditos"] == r["creditos"]


def test_el_costo_de_un_solo_video_no_cambia():
    for dur, bloques in ((0.5, 1), (299.0, 1), (300.0, 1), (300.001, 2), (724.0, 3)):
        assert creditos.costo_editar([dur]) == tarifa("edicion") + tarifa("transcripcion") * bloques
        assert creditos.costo_editar_sugerencias(dur, False) == creditos.costo_editar([dur])


# ---------------------------------------------------------------------------
# D-13 · `iniciar` no se fía de la caché si el objeto de S3 cambió

def con_cache(mundo, nombre="charla", dur=120.0, bytes_=5_000_000, **kw):
    key = f"videos/{nombre}/subidas/{nombre}.mp4"
    mundo.subida(nombre, dur=dur, bytes_=bytes_, canonico=kw.pop("canonico", True),
                 meta={"key": key, "bytes": bytes_, "duracion_s": dur, "ancho": 1920, "alto": 1080,
                       "audio": True}, **kw)
    return key


def test_con_la_caches_valida_y_el_objeto_igual_no_se_vuelve_a_medir(cliente, mundo):
    con_cache(mundo)
    assert iniciar(cliente, mundo, "proyecto:charla").status_code == 200
    assert mundo.mediciones_hechas == []


def test_un_objeto_reemplazado_sin_confirmar_se_mide_de_nuevo_y_se_cobra_lo_que_hay(cliente, mundo):
    """Se subió y cotizó un video de 2 min (✦ N, queda en caché); se sube por presign OTRO de 10 min a la
    misma key sin llamar a /confirmar. Antes: `iniciar` cobraba los 2 min. Ahora cobra los 10."""
    key = con_cache(mundo, dur=120.0, canonico=False)
    assert cotizar(cliente, "proyecto:charla").json()["creditos"] == tarifa("edicion") + tarifa("transcripcion")
    mundo.tamanos[key] = 77_000_000                              # el objeto cambió en S3
    mundo.medidas[key] = {"duracion_s": 600.0, "ancho": 1920, "alto": 1080, "audio": True}
    r = iniciar(cliente, mundo, "proyecto:charla")
    assert r.status_code == 200, r.text
    assert mundo.mediciones_hechas == [key]
    esperado = tarifa("edicion") + tarifa("transcripcion") * 2        # 600 s = 2 bloques
    assert r.json()["creditos"] == esperado == creditos.costo_editar([600.0])
    f = mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"][0]
    assert (f["duracion_s"], f["bytes"]) == (600.0, 77_000_000)
    meta = mundo.docs()["charla"]["meta"]                            # y la caché se renueva con lo nuevo
    assert (meta["duracion_s"], meta["bytes"]) == (600.0, 77_000_000)


def test_un_objeto_reemplazado_por_uno_de_mas_de_90_minutos_se_rechaza_antes_de_cobrar(cliente, mundo):
    key = con_cache(mundo, dur=120.0)
    mundo.tamanos[key] = 2_000_000_000
    mundo.medidas[key] = {"duracion_s": 5700.0, "ancho": 1920, "alto": 1080, "audio": True}
    r = iniciar(cliente, mundo, "proyecto:charla")
    assert r.status_code == 413 and "dura 95 min" in r.json()["detail"]
    assert mundo.libro == [] and "ed-9f1c0a7b" not in mundo.docs() and "lanzar" not in [e[0] for e in mundo.eventos]


def test_el_peso_real_manda_para_el_tope_de_15_gb(cliente, mundo):
    key = con_cache(mundo, dur=120.0)
    mundo.tamanos[key] = 16 * 1024**3
    r = iniciar(cliente, mundo, "proyecto:charla")
    assert r.status_code == 413 and "pesan" in r.json()["detail"] and mundo.libro == []


def test_si_el_objeto_ya_no_esta_en_s3_no_se_cobra(cliente, mundo):
    key = con_cache(mundo)
    mundo.tamanos[key] = None                                    # HEAD: no existe (o no se pudo ver)
    mundo.medidas[key] = None                                    # ffprobe tampoco lo lee
    r = iniciar(cliente, mundo, "proyecto:charla")
    assert r.status_code == 502 and mundo.libro == []


def test_cotizar_no_hace_head_a_s3(cliente, mundo, monkeypatch):
    """La cotización sigue siendo barata y sin efectos: el HEAD es solo del que cobra."""
    from pipeline import media_sync
    con_cache(mundo)
    monkeypatch.setattr(media_sync, "tamano", lambda k: pytest.fail("cotizar no debe tocar S3"))
    assert cotizar(cliente, "proyecto:charla").json()["bloqueo"] is None


def test_un_clip_se_mide_siempre_y_su_peso_real_tambien_cuenta(cliente, mundo):
    clip = mundo.clip()
    mundo.tamanos[f"usuarios/u1/clips/{clip}.mp4"] = 4_000_000
    mundo.subida("charla", dur=120.0, canonico=True)
    r = iniciar(cliente, mundo, "proyecto:charla", f"clip:{clip}")
    assert r.status_code == 200
    assert mundo.docs()["ed-9f1c0a7b"]["editar"]["fuentes"][1]["bytes"] == 4_000_000
