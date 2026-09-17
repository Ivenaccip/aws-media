"""Fase 3: payloads de Blotato, filtro de propuestas b2 y descargables de b3.
Sin red — solo lógica pura y filesystem temporal."""
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(REPO))

from pipeline.blotato import payload_post, target_de  # noqa: E402
from server.broll_api import filtrar_propuestas  # noqa: E402
from server.publicar_api import descargables  # noqa: E402


def test_payload_post_agendado():
    # TikTok exige siete campos en target (M23 C2): sin ellos Blotato da 422
    target = target_de("tiktok", {"privacidad": "PUBLIC_TO_EVERYONE"})
    body = payload_post("98432", "tiktok", "Hola", ["https://x/v.mp4"],
                        scheduled_time="2026-09-01T15:00:00Z", target=target)
    assert body == {
        "post": {"accountId": "98432",
                 "content": {"text": "Hola", "mediaUrls": ["https://x/v.mp4"], "platform": "tiktok"},
                 "target": {"targetType": "tiktok", "privacyLevel": "PUBLIC_TO_EVERYONE",
                            "disabledComments": False, "disabledDuet": False,
                            "disabledStitch": False, "isBrandedContent": False,
                            "isYourBrand": False, "isAiGenerated": True}},
        # en la raíz: dentro de `post` Blotato lo ignora y publica al instante
        "scheduledTime": "2026-09-01T15:00:00Z",
    }


def test_payload_post_inmediato_sin_scheduled():
    target = target_de("youtube", {"titulo": "Ya", "privacidad": "unlisted"})
    body = payload_post(123, "youtube", "Ya", [], target=target)
    assert "scheduledTime" not in body and body["post"]["accountId"] == "123"
    assert body["post"]["target"]["title"] == "Ya"


def test_payload_post_no_deja_que_target_cambie_la_red():
    body = payload_post("1", "twitter", "x", [], target={"targetType": "tiktok"})
    assert body["post"]["target"] == {"targetType": "twitter"}


def test_filtrar_propuestas():
    crudas = [
        {"t": 5, "dur_s": 4, "familia": "grafico", "titulo": "Cifra clave", "motivo": "dato"},
        {"t": 20, "dur_s": 5, "familia": "audiovisual", "titulo": "Pisa overlay", "motivo": "x"},   # pisa 18-25
        {"t": 100, "dur_s": 5, "familia": "grafico", "titulo": "Fuera del video", "motivo": "x"},
        {"t": 40, "dur_s": 20, "familia": "audiovisual", "titulo": "Larga", "motivo": "x",
         "prompt_imagen": "castle"},
        {"t": 50, "familia": "invalida", "titulo": "x", "motivo": "x"},
        {"t": "no", "familia": "grafico"},
    ]
    out = filtrar_propuestas(crudas, duracion_s=80.0, ocupados=[(18.0, 25.0)])
    assert [p["titulo"] for p in out] == ["Cifra clave", "Larga"]
    assert out[1]["dur_s"] == 8.0                 # 20s se recorta al máximo de 8
    assert out[1]["prompt_imagen"] == "castle"


def test_filtrar_maximo_cinco():
    crudas = [{"t": i * 9, "dur_s": 4, "familia": "grafico", "titulo": str(i), "motivo": ""}
              for i in range(8)]
    assert len(filtrar_propuestas(crudas, 100.0, [])) == 5


def test_descargables(tmp_path):
    p = tmp_path / "gen-x"
    (p / "work" / "subs").mkdir(parents=True)
    (p / "output").mkdir()
    (p / "pelicula.mp4").write_bytes(b"v")
    (p / "output" / "tight-final.mp4").write_bytes(b"m")
    (p / "work" / "subs" / "subs.srt").write_text("1", encoding="utf-8")
    d = descargables(p)
    assert set(d) == {"pelicula", "tight-final", "srt"}
    assert d["srt"].name == "subs.srt"
