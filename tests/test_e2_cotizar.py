"""E2 — `POST /api/edicion/cotizar`: el precio de varios videos ANTES de cobrar.

Lo que se defiende (reglas R2 a R5, R10 a R14 del contrato):

- el precio sale SOLO del servidor, de `tools/tarifas.json` (las cifras se leen
  ahí, no se escriben aquí) y con la duración que ÉL midió;
- cada regla de negocio corta con su texto exacto y con `creditos: null`;
- la referencia de un video es `proyecto:<nombre>` o `clip:<id>`: jamás una
  `key` de S3, jamás un video de otra persona;
- cotizar no mueve nada: ni reserva, ni cobra, ni lanza.
"""
import json
import shutil
import subprocess
import time

import pytest

from pipeline import creditos
from server import edicion_api
from test_e2_mundo import cliente, mundo, tarifa  # noqa: F401  (las fixtures se importan por nombre)

CLIP = "clip-20261008-101500-ab12cd"


def cotizar(cliente, *refs, **extra):
    return cliente.post("/api/edicion/cotizar", json={"videos": list(refs), **extra})


def bloqueo(r):
    assert r.status_code == 200, r.text
    return r.json()["bloqueo"]


# ---------------------------------------------------------------------------
# el precio

def test_una_subida_cruda_de_12_minutos_cuesta_la_edicion_mas_la_transcripcion(cliente, mundo):
    mundo.subida("entrevista", dur=724.0)
    r = cotizar(cliente, "proyecto:entrevista")
    # 724 s = 3 bloques de 5 min; las cifras salen de tarifas.json
    esperado = tarifa("edicion") + tarifa("transcripcion") * 3
    assert r.status_code == 200 and r.json()["creditos"] == esperado
    assert r.json()["desglose"] == {"edicion": tarifa("edicion"), "transcripcion": tarifa("transcripcion") * 3}
    assert r.json()["videos"][0]["se_transcribe"] is True


def test_el_mismo_video_con_transcript_cuesta_solo_la_edicion(cliente, mundo):
    mundo.subida("entrevista", dur=724.0, canonico=True)
    r = cotizar(cliente, "proyecto:entrevista").json()
    assert r["creditos"] == tarifa("edicion") and r["desglose"]["transcripcion"] == 0
    assert r["videos"][0]["con_transcript"] is True and r["videos"][0]["se_transcribe"] is False


def test_tres_creaciones_con_transcript_y_un_clip_cuestan_solo_la_edicion(cliente, mundo):
    for i, id8 in enumerate(("1a2b3c4d", "2b3c4d5e", "3c4d5e6f")):
        mundo.pelicula(id8, f"Película {i}")
    mundo.clip(CLIP)
    r = cotizar(cliente, "proyecto:gen-1a2b3c4d", "proyecto:gen-2b3c4d5e", "proyecto:gen-3c4d5e6f",
                f"clip:{CLIP}").json()
    assert r["bloqueo"] is None and r["creditos"] == tarifa("edicion")
    assert r["n_videos"] == 4


def test_la_transcripcion_se_cuenta_por_la_suma_de_minutos_no_por_archivo(cliente, mundo):
    """100 s + 100 s sin transcript son UN bloque de 5 min (no dos): 4, no 6."""
    mundo.subida("uno", dur=100.0)
    mundo.subida("dos", dur=100.0)
    r = cotizar(cliente, "proyecto:uno", "proyecto:dos").json()
    por_suma = tarifa("edicion") + tarifa("transcripcion")
    por_archivo = tarifa("edicion") + 2 * tarifa("transcripcion")
    assert r["creditos"] == por_suma != por_archivo
    assert r["creditos"] == creditos.costo_editar([100.0, 100.0])


def test_un_clip_de_ia_nunca_se_transcribe(cliente, mundo):
    """Se une tal cual (D-01): ni suma minutos ni se marca para transcribir."""
    mundo.clip(CLIP, dur=8.0)
    mundo.subida("charla", dur=700.0, canonico=True)
    r = cotizar(cliente, f"clip:{CLIP}", "proyecto:charla").json()
    clip = next(v for v in r["videos"] if v["tipo"] == "clip")
    assert clip["se_transcribe"] is False and clip["con_transcript"] is False
    assert r["creditos"] == tarifa("edicion")


def test_el_titulo_de_la_union_es_el_primero_mas_los_demas(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "El tren de papel")
    mundo.clip(CLIP)
    mundo.subida("charla", dur=700.0, canonico=True)
    r = cotizar(cliente, "proyecto:gen-1a2b3c4d", f"clip:{CLIP}", "proyecto:charla").json()
    assert r["titulo"] == "El tren de papel + 2 más"
    assert [v["titulo"] for v in r["videos"]] == ["El tren de papel", "Perro en la playa", "charla"]
    assert [v["tipo"] for v in r["videos"]] == ["pelicula", "clip", "edicion"]
    assert r["duracion_total_s"] == round(30.04 + 8.0 + 700.0, 3)


def test_el_titulo_nunca_pasa_de_80_y_conserva_cuantos_se_unieron():
    largo = "Un faro que guía a los barcos perdidos en la tormenta eterna de un invierno que nunca termina"
    assert edicion_api._titulo_de_copia([]) == ""
    assert edicion_api._titulo_de_copia(["Uno"]) == "Uno"
    assert edicion_api._titulo_de_copia(["Uno", "Dos"]) == "Uno + 1 más"
    assert edicion_api._titulo_de_copia(["Uno"] + ["x"] * 11) == "Uno + 11 más"
    t = edicion_api._titulo_de_copia([largo, "b", "c"])
    assert len(t) <= 80 and t.endswith(" + 2 más") and "…" in t
    t = edicion_api._titulo_de_copia([largo])
    assert len(t) <= 80 and t.endswith("…")
    assert edicion_api._titulo_de_copia([largo] + ["x"] * 11).endswith(" + 11 más")


def test_la_forma_de_la_respuesta(cliente, mundo):
    mundo.pelicula("1a2b3c4d", "El tren de papel", dur=30.04)
    r = cotizar(cliente, "proyecto:gen-1a2b3c4d").json()
    assert set(r) == {"titulo", "n_videos", "duracion_total_s", "bytes_total", "formato", "creditos",
                      "desglose", "ocupado", "bloqueo", "videos"}
    assert r["videos"][0] == {
        "ref": "proyecto:gen-1a2b3c4d", "tipo": "pelicula", "titulo": "El tren de papel",
        "duracion_s": 30.04, "formato": "horizontal", "ancho": 1280, "alto": 720, "audio": True,
        "bytes": 11_534_336, "con_transcript": True, "se_transcribe": False}
    assert r["formato"] == "horizontal" and r["ocupado"] is False


def test_las_claves_de_mas_se_ignoran_y_no_cambian_el_precio(cliente, mundo):
    """Jamás se lee un precio, unos créditos ni una key del cuerpo (R2, R12)."""
    mundo.subida("entrevista", dur=724.0)
    limpio = cotizar(cliente, "proyecto:entrevista").json()
    sucio = cotizar(cliente, "proyecto:entrevista", creditos=0, precio=0, key="videos/otro/subidas/x.mp4",
                    duracion_s=1, bytes=1, formato="vertical").json()
    assert sucio == limpio and sucio["creditos"] > 0


def test_cotizar_no_mueve_nada(cliente, mundo):
    mundo.subida("entrevista", dur=724.0)
    saldo = dict(mundo.saldos)
    cotizar(cliente, "proyecto:entrevista")
    # lo único que escribe es la caché de la medición (doc.meta); ni reservar, ni cobrar, ni lanzar
    assert {e[0] for e in mundo.eventos} <= {"cargar", "medir", "corriendo", "fijar"}
    assert [e for e in mundo.eventos if e[0] == "fijar"] == [("fijar", "entrevista", "meta")]
    assert mundo.saldos == saldo and mundo.libro == []
    assert set(mundo.docs()) == {"entrevista"}


# ---------------------------------------------------------------------------
# las reglas: cada una corta con su texto exacto y sin precio

@pytest.mark.parametrize("dur,pasa", [(59.96, False), (59.999, False), (60.0, True), (60.04, True)])
def test_un_video_solo_de_menos_de_un_minuto_no_se_edita_y_no_se_redondea(cliente, mundo, dur, pasa):
    """R3: la regla se aplica al valor SIN redondear (el /costo viejo redondea a 1 decimal y 59.96 pasaría)."""
    mundo.subida("corto", dur=dur)
    r = cotizar(cliente, "proyecto:corto").json()
    if pasa:
        assert r["bloqueo"] is None and r["creditos"] is not None
    else:
        assert r["bloqueo"] == {"codigo": "corto_solo", "texto": (
            "Un video de menos de 1 min no se puede editar solo. "
            "Agrega otro para unirlos, o sube uno de 1 a 90 min.")}
        assert r["creditos"] is None and r["desglose"] is None


def test_dos_videos_cortos_si_se_unen(cliente, mundo):
    mundo.subida("a", dur=20.0)
    mundo.subida("b", dur=15.0)
    r = cotizar(cliente, "proyecto:a", "proyecto:b").json()
    assert r["bloqueo"] is None and r["creditos"] is not None


def test_un_video_de_mas_de_90_minutos_es_larga(cliente, mundo):
    mundo.subida("largo", dur=5401.0)
    b = bloqueo(cotizar(cliente, "proyecto:largo"))
    assert b["codigo"] == "larga"
    # 5401 s redondea a 90 y «dura 90 min y el máximo es 90 min» no se entiende: dice 91
    assert b["texto"] == "«largo» dura 91 min y el máximo es 90 min."
    mundo.subida("largo2", dur=7800.0)
    assert bloqueo(cotizar(cliente, "proyecto:largo2"))["texto"] == "«largo2» dura 130 min y el máximo es 90 min."


def test_exactamente_90_minutos_pasa(cliente, mundo):
    mundo.subida("justo", dur=5400.0, canonico=True)
    assert bloqueo(cotizar(cliente, "proyecto:justo")) is None


def test_la_suma_no_puede_pasar_de_90_minutos(cliente, mundo):
    for n in "abc":
        mundo.subida(n, dur=2000.0)
    b = bloqueo(cotizar(cliente, "proyecto:a", "proyecto:b", "proyecto:c"))
    assert b == {"codigo": "total_largo", "texto": "Entre todos suman 100 min · el máximo es 90 min."}


def test_horizontales_y_verticales_no_se_mezclan(cliente, mundo):
    mundo.subida("h", dur=30.0, ancho=1920, alto=1080)
    mundo.subida("v", dur=30.0, ancho=720, alto=1280)
    b = bloqueo(cotizar(cliente, "proyecto:h", "proyecto:v"))
    assert b == {"codigo": "formatos_distintos", "texto": (
        "Los videos horizontales y los verticales no se mezclan. Quita los verticales o edítalos aparte.")}
    # la orientación del primero manda: al revés, lo que sobra son los horizontales
    b = bloqueo(cotizar(cliente, "proyecto:v", "proyecto:h"))
    assert "Quita los horizontales" in b["texto"]


def test_un_cuadrado_cuenta_como_horizontal(cliente, mundo):
    mundo.subida("cuadrado", dur=30.0, ancho=1080, alto=1080)
    mundo.subida("h", dur=30.0)
    assert bloqueo(cotizar(cliente, "proyecto:cuadrado", "proyecto:h")) is None


def test_el_peso_total_tiene_tope(cliente, mundo):
    mundo.subida("a", dur=30.0, bytes_=9 * 1024**3)
    mundo.subida("b", dur=30.0, bytes_=8 * 1024**3)
    b = bloqueo(cotizar(cliente, "proyecto:a", "proyecto:b"))
    assert b == {"codigo": "muy_pesado", "texto": "Entre todos pesan 17 GB · el máximo es 15 GB."}


def test_el_peso_que_apenas_pasa_no_dice_que_pesa_lo_mismo_que_el_maximo(cliente, mundo):
    mundo.subida("a", dur=30.0, bytes_=15 * 1024**3 + 1)
    b = bloqueo(cotizar(cliente, "proyecto:a"))
    assert b["texto"] == "Entre todos pesan 15.1 GB · el máximo es 15 GB."


def test_como_mucho_12_videos(cliente, mundo):
    refs = []
    for i in range(13):
        mundo.subida(f"v{i}", dur=20.0)
        refs.append(f"proyecto:v{i}")
    b = bloqueo(cotizar(cliente, *refs))
    assert b == {"codigo": "demasiados", "texto": "Puedes unir hasta 12 videos a la vez."}
    assert bloqueo(cotizar(cliente, *refs[:12])) is None
    assert mundo.mediciones_hechas.count("videos/v12/subidas/v12.mp4") == 0   # con 13 no se midió nada


def test_el_mismo_video_no_entra_dos_veces(cliente, mundo):
    mundo.subida("a", dur=30.0)
    b = bloqueo(cotizar(cliente, "proyecto:a", "proyecto:a"))
    assert b == {"codigo": "repetido", "texto": "«a» está repetido: agrégalo una sola vez."}


def test_una_copia_no_se_vuelve_a_unir(cliente, mundo):
    mundo.copia("ed-9f1c0a7b", "El tren de papel + 2 más")
    b = bloqueo(cotizar(cliente, "proyecto:ed-9f1c0a7b"))
    assert b == {"codigo": "es_copia", "texto": (
        "«El tren de papel + 2 más» ya es una edición: ábrela en su editor para seguir con ella.")}


def test_sin_videos_es_un_bloqueo_no_un_error(cliente, mundo):
    r = cotizar(cliente)
    assert r.status_code == 200 and r.json()["bloqueo"] == {
        "codigo": "sin_videos", "texto": "Agrega al menos un video para editar."}
    assert r.json()["creditos"] is None and r.json()["videos"] == []


def test_un_proyecto_sin_video_no_se_puede_editar(cliente, mundo):
    mundo.docs()["vacio"] = {"subidas": []}
    b = bloqueo(cotizar(cliente, "proyecto:vacio"))
    assert b == {"codigo": "sin_metraje", "texto": "«vacio» no tiene un video para editar."}


def test_un_clip_que_aun_se_genera_no_tiene_video(cliente, mundo):
    mundo.clip(CLIP, estado="generando", con_key=False)
    assert bloqueo(cotizar(cliente, f"clip:{CLIP}"))["codigo"] == "sin_metraje"


def test_si_no_se_puede_medir_se_dice_cual_y_no_hay_precio(cliente, mundo):
    mundo.subida("roto", dur=30.0)
    mundo.medidas["videos/roto/subidas/roto.mp4"] = None
    r = cotizar(cliente, "proyecto:roto").json()
    assert r["bloqueo"] == {"codigo": "no_se_pudo_medir",
                            "texto": "No pudimos leer «roto». Quítalo e inténtalo de nuevo."}
    assert r["creditos"] is None


def test_sin_clave_de_transcripcion_no_se_ofrece_transcribir(cliente, mundo, monkeypatch):
    monkeypatch.delenv("ASSEMBLYAI_API_KEY")
    mundo.subida("cruda", dur=300.0)
    assert bloqueo(cotizar(cliente, "proyecto:cruda"))["codigo"] == "sin_transcripcion"
    mundo.subida("lista", dur=300.0, canonico=True)     # con transcript no hace falta la clave
    assert bloqueo(cotizar(cliente, "proyecto:lista")) is None


def test_el_orden_de_prioridad_de_los_bloqueos(cliente, mundo, monkeypatch):
    """§3.3: el primero que aplique. Cada caso tiene a la vez ese bloqueo y TODOS los siguientes."""
    monkeypatch.delenv("ASSEMBLYAI_API_KEY")
    mundo.copia("ed-1", "Una copia")
    mundo.docs()["vacio"] = {"subidas": []}
    mundo.subida("largo", dur=6000.0, ancho=720, alto=1280)
    mundo.subida("h", dur=30.0)
    mundo.subida("roto", dur=30.0)
    mundo.medidas["videos/roto/subidas/roto.mp4"] = None
    # repetido gana a es_copia
    assert bloqueo(cotizar(cliente, "proyecto:ed-1", "proyecto:ed-1"))["codigo"] == "repetido"
    # es_copia gana a sin_metraje
    assert bloqueo(cotizar(cliente, "proyecto:vacio", "proyecto:ed-1"))["codigo"] == "es_copia"
    # sin_metraje gana a no_se_pudo_medir
    assert bloqueo(cotizar(cliente, "proyecto:roto", "proyecto:vacio"))["codigo"] == "sin_metraje"
    # no_se_pudo_medir gana a larga
    assert bloqueo(cotizar(cliente, "proyecto:largo", "proyecto:roto"))["codigo"] == "no_se_pudo_medir"
    # larga gana a formatos_distintos (el largo es vertical, el otro horizontal)
    assert bloqueo(cotizar(cliente, "proyecto:h", "proyecto:largo"))["codigo"] == "larga"
    # formatos_distintos gana a total_largo (suman 100 min Y hay un vertical)
    mundo.subida("v", dur=2800.0, ancho=720, alto=1280)
    mundo.subida("h2", dur=2800.0)
    assert bloqueo(cotizar(cliente, "proyecto:h2", "proyecto:v", "proyecto:h"))["codigo"] == "formatos_distintos"
    # total_largo gana a muy_pesado
    mundo.subida("h3", dur=2800.0, bytes_=16 * 1024**3)
    assert bloqueo(cotizar(cliente, "proyecto:h2", "proyecto:h3"))["codigo"] == "total_largo"
    # muy_pesado gana a corto_solo y a sin_transcripcion (cruda, sin clave)
    mundo.subida("pesado", dur=30.0, bytes_=16 * 1024**3)
    assert bloqueo(cotizar(cliente, "proyecto:pesado"))["codigo"] == "muy_pesado"
    # corto_solo gana a sin_transcripcion
    mundo.subida("corto", dur=30.0)
    assert bloqueo(cotizar(cliente, "proyecto:corto"))["codigo"] == "corto_solo"
    mundo.subida("normal", dur=300.0)
    assert bloqueo(cotizar(cliente, "proyecto:normal"))["codigo"] == "sin_transcripcion"


# ---------------------------------------------------------------------------
# de quién es cada video (R12)

def test_un_proyecto_ajeno_es_404_y_no_se_distingue_de_uno_inexistente(cliente, mundo):
    mundo.subida("de_otra", dur=30.0, user="u2")
    ajeno = cotizar(cliente, "proyecto:de_otra")
    inexistente = cotizar(cliente, "proyecto:no_existe")
    assert ajeno.status_code == inexistente.status_code == 404
    assert ajeno.json() == inexistente.json() == {"detail": (
        "No encontramos uno de los videos entre los tuyos. Recarga la lista e inténtalo de nuevo.")}


def test_un_clip_ajeno_es_404(cliente, mundo):
    mundo.clip(CLIP, user="u2")
    assert cotizar(cliente, f"clip:{CLIP}").status_code == 404


def test_si_uno_de_varios_es_ajeno_no_se_cotiza_nada(cliente, mundo):
    mundo.subida("mio", dur=30.0)
    mundo.subida("ajeno", dur=30.0, user="u2")
    assert cotizar(cliente, "proyecto:mio", "proyecto:ajeno").status_code == 404


@pytest.mark.parametrize("ref", [
    "proyecto:../x", "proyecto:a/b", "proyecto:", "proyecto:" + "a" * 65, "clip:clip-1", "clip:x",
    "videos/gen-1/subidas/x.mp4", "usuarios/u2/clips/clip-20261008-101500-ab12cd.mp4",
    "https://s3.amazonaws.com/b/k.mp4", "gen-1a2b3c4d", "", "PROYECTO:a"])
def test_una_ref_mal_formada_o_una_key_de_s3_es_422_y_no_toca_nada(cliente, mundo, ref):
    r = cotizar(cliente, ref)
    assert r.status_code == 422
    assert r.json()["detail"] == "No entendimos uno de los videos. Recarga la lista e inténtalo de nuevo."
    assert mundo.eventos == []


@pytest.mark.parametrize("cuerpo", [None, [], "texto", {"videos": "proyecto:a"}, {"videos": [1]},
                                    {"videos": [None]}, {"videos": [["proyecto:a"]]}])
def test_un_cuerpo_mal_formado_es_422(cliente, cuerpo):
    assert cliente.post("/api/edicion/cotizar", json=cuerpo).status_code == 422


def test_una_key_de_s3_dentro_del_documento_de_otra_persona_no_se_sirve(cliente, mundo):
    """Aunque el doc del proyecto apunte a un archivo fuera de su carpeta, no se mide ni se usa."""
    mundo.subida("tramposo", dur=30.0)
    mundo.docs()["tramposo"]["subidas"][0]["key"] = "videos/de_otra/subidas/secreto.mp4"
    mundo.medidas["videos/de_otra/subidas/secreto.mp4"] = {"duracion_s": 30.0, "ancho": 1, "alto": 1, "audio": True}
    assert bloqueo(cotizar(cliente, "proyecto:tramposo"))["codigo"] == "sin_metraje"
    assert "videos/de_otra/subidas/secreto.mp4" not in mundo.mediciones_hechas


def test_un_clip_cuyo_video_no_esta_en_la_carpeta_de_la_persona_no_se_usa(cliente, mundo):
    mundo.clip(CLIP)
    doc = json.loads(mundo.s3[f"usuarios/u1/clips/{CLIP}.json"])
    doc["key"] = "usuarios/u2/clips/clip-20261008-101500-ab12cd.mp4"
    mundo.s3[f"usuarios/u1/clips/{CLIP}.json"] = json.dumps(doc)
    assert bloqueo(cotizar(cliente, f"clip:{CLIP}"))["codigo"] == "sin_metraje"
    assert mundo.mediciones_hechas == []


# ---------------------------------------------------------------------------
# ocupado, no-nube y la caché de mediciones

def test_ocupado_es_informativo(cliente, mundo):
    mundo.subida("a", dur=300.0, canonico=True)
    assert cotizar(cliente, "proyecto:a").json()["ocupado"] is False
    mundo.copia("ed-1", "Otra", estado="corriendo")
    r = cotizar(cliente, "proyecto:a").json()
    assert r["ocupado"] is True and r["bloqueo"] is None and r["creditos"] is not None
    mundo.docs()["ed-1"]["editar"]["inicio"] = "2026-01-01T00:00:00+00:00"       # una corrida de meses atrás
    assert cotizar(cliente, "proyecto:a").json()["ocupado"] is False


def test_en_local_es_503(cliente, monkeypatch):
    from pipeline import db
    monkeypatch.setattr(db, "backend", lambda: "json")
    r = cotizar(cliente, "proyecto:a")
    assert r.status_code == 503
    assert r.json()["detail"] == ("El flujo web de edición corre en el servicio — "
                                  "en local usa /clean-cut desde Claude Code")


def test_la_medicion_se_guarda_y_no_se_repite(cliente, mundo):
    mundo.subida("a", dur=300.0)
    cotizar(cliente, "proyecto:a")
    meta = mundo.docs()["a"]["meta"]
    assert meta["key"] == "videos/a/subidas/a.mp4" and meta["bytes"] == 864_000_000
    assert (meta["duracion_s"], meta["ancho"], meta["alto"], meta["audio"]) == (300.0, 1920, 1080, True)
    mundo.mediciones_hechas.clear()
    r = cotizar(cliente, "proyecto:a").json()
    assert mundo.mediciones_hechas == [] and r["videos"][0]["duracion_s"] == 300.0


def test_si_la_subida_cambia_de_peso_la_caja_deja_de_valer(cliente, mundo):
    """Una subida reemplazada (mismo nombre, otro archivo) no puede cotizar con la duración vieja."""
    mundo.subida("a", dur=300.0)
    cotizar(cliente, "proyecto:a")
    mundo.docs()["a"]["subidas"][0]["bytes"] = 999
    mundo.medidas["videos/a/subidas/a.mp4"] = {"duracion_s": 90.0, "ancho": 1920, "alto": 1080, "audio": True}
    mundo.mediciones_hechas.clear()
    assert cotizar(cliente, "proyecto:a").json()["videos"][0]["duracion_s"] == 90.0
    assert mundo.mediciones_hechas == ["videos/a/subidas/a.mp4"]


def test_si_cambia_la_key_la_cache_tampoco_vale(cliente, mundo):
    mundo.subida("a", dur=300.0)
    cotizar(cliente, "proyecto:a")
    d = mundo.docs()["a"]
    d["subidas"].append({"key": "videos/a/subidas/nuevo.mov", "archivo": "nuevo.mov", "bytes": 864_000_000})
    mundo.medidas["videos/a/subidas/nuevo.mov"] = {"duracion_s": 120.0, "ancho": 1920, "alto": 1080, "audio": False}
    assert cotizar(cliente, "proyecto:a").json()["videos"][0]["duracion_s"] == 120.0


def test_un_clip_no_se_cachea(cliente, mundo):
    mundo.clip(CLIP)
    cotizar(cliente, f"clip:{CLIP}")
    mundo.mediciones_hechas.clear()
    cotizar(cliente, f"clip:{CLIP}")
    assert mundo.mediciones_hechas == [f"usuarios/u1/clips/{CLIP}.mp4"]


def test_un_canonico_de_otro_archivo_no_cuenta_como_transcript(cliente, mundo):
    """El canónico dura 100 s y el video 724 s: es de otro archivo con el mismo nombre. Se cobra transcribir."""
    mundo.subida("charla", dur=724.0, canonico=True)
    mundo.s3["videos/charla/work/transcripts/charla.canonical.json"] = json.dumps(
        {"schema_version": "1.0", "source": {"duration": 100.0}, "words": []})
    r = cotizar(cliente, "proyecto:charla").json()
    assert r["videos"][0]["con_transcript"] is False and r["videos"][0]["se_transcribe"] is True
    assert r["creditos"] == tarifa("edicion") + tarifa("transcripcion") * 3


def test_un_canonico_con_duracion_parecida_si_vale(cliente, mundo):
    mundo.subida("charla", dur=724.0)
    mundo.s3["videos/charla/work/transcripts/charla.canonical.json"] = json.dumps(
        {"schema_version": "1.0", "source": {"duration": 724.6}, "words": []})
    r = cotizar(cliente, "proyecto:charla").json()
    assert r["videos"][0]["con_transcript"] is True and r["creditos"] == tarifa("edicion")


def test_el_canonico_se_busca_en_s3_aunque_el_flag_no_este(cliente, mundo):
    """Un transcript hecho por shorts no marca `flags.canonico`: el listado lo encuentra."""
    mundo.subida("charla", dur=724.0)
    mundo.s3["videos/charla/work/transcripts/charla.canonical.json"] = json.dumps(
        {"schema_version": "1.0", "source": {"duration": 724.0}, "words": []})
    assert cotizar(cliente, "proyecto:charla").json()["creditos"] == tarifa("edicion")


# ---------------------------------------------------------------------------
# el plazo: la Lambda corta a los 29 s

def test_si_una_medicion_no_llega_a_tiempo_no_se_espera_y_se_dice_cual(cliente, mundo, monkeypatch):
    mundo.subida("rapido", dur=30.0)
    mundo.subida("lento", dur=30.0)
    original = mundo._medir

    def lento(key, *, timeout=8):
        if "lento" in key:
            time.sleep(3)
        return original(key)
    monkeypatch.setattr(edicion_api, "_medir", lento)
    monkeypatch.setattr(edicion_api, "MEDIR_PLAZO_S", 0.3)
    t0 = time.monotonic()
    r = cotizar(cliente, "proyecto:rapido", "proyecto:lento").json()
    assert time.monotonic() - t0 < 2.5
    assert r["bloqueo"]["codigo"] == "no_se_pudo_medir" and "«lento»" in r["bloqueo"]["texto"]
    assert r["videos"][0]["duracion_s"] == 30.0 and r["videos"][1]["duracion_s"] is None


def test_las_mediciones_corren_en_paralelo(cliente, mundo, monkeypatch):
    refs = []
    for i in range(6):
        mundo.subida(f"v{i}", dur=30.0)
        refs.append(f"proyecto:v{i}")
    original = mundo._medir

    def lento(key, *, timeout=8):
        time.sleep(0.4)
        return original(key)
    monkeypatch.setattr(edicion_api, "_medir", lento)
    t0 = time.monotonic()
    assert bloqueo(cotizar(cliente, *refs)) is None
    assert time.monotonic() - t0 < 6 * 0.4 * 0.7        # en serie serían 2.4 s


# ---------------------------------------------------------------------------
# _medir de verdad, con ffprobe y clips sintéticos (gratis)

sin_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None or shutil.which("ffprobe") is None,
                                reason="sin ffmpeg")


@pytest.fixture
def clips(tmp_path, monkeypatch):
    """Tres videos diminutos hechos con ffmpeg (gratis): normal, grabado de lado y sin audio."""
    from pipeline import media_sync
    monkeypatch.setattr(media_sync, "url_media", lambda k: k)   # ffprobe lee la ruta tal cual

    def ffmpeg(*a):
        subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *a], check=True)
    base = tmp_path / "a.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=24:duration=1.5",
           "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1.5",
           "-ac", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(base))
    rot = tmp_path / "a_rot.mp4"
    ffmpeg("-display_rotation", "90", "-i", str(base), "-c", "copy", str(rot))
    muda = tmp_path / "sin_audio.mp4"
    ffmpeg("-f", "lavfi", "-i", "testsrc=size=240x320:rate=25:duration=1", "-c:v", "libx264",
           "-pix_fmt", "yuv420p", str(muda))
    return {"base": base, "rot": rot, "muda": muda, "falso": tmp_path / "no_es_video.mp4"}


@sin_ffmpeg
def test__medir_lee_duracion_formato_y_audio(clips):
    m = edicion_api._medir(str(clips["base"]))
    assert (m["ancho"], m["alto"], m["audio"]) == (320, 180, True) and abs(m["duracion_s"] - 1.5) < 0.1
    assert edicion_api._formato_de(m["ancho"], m["alto"]) == "horizontal"
    s = edicion_api._medir(str(clips["muda"]))
    assert s["audio"] is False and (s["ancho"], s["alto"]) == (240, 320)
    assert edicion_api._formato_de(s["ancho"], s["alto"]) == "vertical"
    assert round(m["duracion_s"], 3) == m["duracion_s"]        # 3 decimales


@sin_ffmpeg
def test__medir_aplica_la_rotacion_del_telefono(clips):
    """Un 320×180 con `rotation: 90` se ve vertical (180×320): así lo recodifica ffmpeg."""
    r = edicion_api._medir(str(clips["rot"]))
    assert (r["ancho"], r["alto"]) == (180, 320)
    assert edicion_api._formato_de(r["ancho"], r["alto"]) == "vertical"


@sin_ffmpeg
def test__medir_lo_que_no_es_video_o_no_existe_es_none_nunca_una_excepcion(clips):
    clips["falso"].write_text("esto no es un video")
    assert edicion_api._medir(str(clips["falso"])) is None
    assert edicion_api._medir(str(clips["falso"].parent / "no_existe.mp4")) is None


@sin_ffmpeg
def test__medir_con_plazo_vencido_o_sin_url_es_none(clips, monkeypatch):
    from pipeline import media_sync
    assert edicion_api._medir(str(clips["base"]), timeout=0.0001) is None
    monkeypatch.setattr(media_sync, "url_media", lambda k: None)
    assert edicion_api._medir("videos/x/subidas/y.mp4") is None


def test_un_cuadrado_o_un_vertical_se_clasifican_por_sus_lados():
    assert edicion_api._formato_de(1080, 1080) == "horizontal"
    assert edicion_api._formato_de(1081, 1080) == "horizontal"
    assert edicion_api._formato_de(1080, 1081) == "vertical"
    assert edicion_api._formato_de(None, 1080) is None and edicion_api._formato_de(0, 0) is None


# ---------------------------------------------------------------------------
# de punta a punta con ffprobe REAL (sin el doble de `_medir`): el contrato dice que la
# rotación del teléfono decide si dos videos se pueden unir

_MEDIR_REAL = edicion_api._medir      # la de verdad, antes de que ningún fixture la reemplace


@pytest.fixture
def con_ffprobe_real(clips, mundo, monkeypatch):
    """Las keys de S3 apuntan a los archivos sintéticos de `clips`."""
    from pipeline import media_sync
    monkeypatch.setattr(edicion_api, "_medir", _MEDIR_REAL)
    archivos = {}
    monkeypatch.setattr(media_sync, "url_media", lambda k: str(archivos[k]))

    def subir(nombre, ruta, **kw):
        key = mundo.subida(nombre, **kw)
        archivos[key] = ruta
        return key
    mundo.subir_real = subir
    return mundo


@sin_ffmpeg
def test_un_video_grabado_de_lado_no_se_une_con_uno_horizontal(cliente, con_ffprobe_real, clips):
    m = con_ffprobe_real
    m.subir_real("horizontal", clips["base"], bytes_=10_000)
    m.subir_real("de_lado", clips["rot"], bytes_=10_000)
    r = cotizar(cliente, "proyecto:horizontal", "proyecto:de_lado").json()
    assert r["bloqueo"]["codigo"] == "formatos_distintos"
    assert [v["formato"] for v in r["videos"]] == ["horizontal", "vertical"]
    assert (r["videos"][1]["ancho"], r["videos"][1]["alto"]) == (180, 320)       # con la rotación aplicada


@sin_ffmpeg
def test_dos_horizontales_reales_se_cotizan_y_se_inician_con_lo_que_midio_ffprobe(cliente, con_ffprobe_real, clips):
    m = con_ffprobe_real
    m.subir_real("uno", clips["base"], bytes_=10_000, canonico=True)
    m.subir_real("dos", clips["base"], bytes_=10_000, canonico=True)
    for n in ("uno", "dos"):          # el canónico dura lo mismo que el video: cuenta como transcript
        m.s3[f"videos/{n}/work/transcripts/{n}.canonical.json"] = json.dumps(
            {"schema_version": "1.0", "source": {"duration": 1.5}, "words": []})
    r = cotizar(cliente, "proyecto:uno", "proyecto:dos").json()
    assert r["bloqueo"] is None and r["formato"] == "horizontal"
    assert abs(r["duracion_total_s"] - 3.0) < 0.2 and r["creditos"] == tarifa("edicion")
    ini = cliente.post("/api/edicion/iniciar", json=m.cuerpo("proyecto:uno", "proyecto:dos"))
    assert ini.status_code == 200, ini.text
    fuentes = m.docs()["ed-9f1c0a7b"]["editar"]["fuentes"]
    assert [round(f["duracion_s"], 1) for f in fuentes] == [1.5, 1.5]
    assert all((f["ancho"], f["alto"], f["audio"]) == (320, 180, True) for f in fuentes)
