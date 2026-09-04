"""M1 — dinero y desbloqueo: personaje sin referencia (el P0 de la auditoría),
modificar opción con tarifa de imagen, muestra de voz fija cacheada y tarifas
completas en /api/creditos. Sin red — todo con monkeypatch."""
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

from pipeline import character, creditos, db, project
from pipeline.character import Descripcion
from pipeline.project import EscenaGuion, OpcionPersonaje, Personaje, Proyecto
from pipeline.styles import resolver_estilo

REPO = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# personaje desde el guion (sin imagen de referencia)

def test_describir_desde_guion_parsea(monkeypatch):
    async def falso_chat(name, system, user):
        assert name == "personaje_guion" and "1. " in user
        return {"nombre": "Semmelweis ", "especie": "persona",
                "descripcion": "a 40yo Hungarian doctor, dark coat"}
    monkeypatch.setattr(character, "chat_json", falso_chat)
    d = asyncio.run(character.describir_desde_guion("1. Viena, 1847."))
    assert d.nombre == "semmelweis" and d.especie == "persona"
    assert "doctor" in d.descripcion and d.mira_hacia == "camera"


def test_prompt_sin_ref_no_menciona_referencia():
    d = Descripcion(nombre="oso", descripcion="a brown bear")
    txt = character.prompt_opcion_sin_ref(d, resolver_estilo("animated"), character.VARIANTES[0])
    assert "a brown bear" in txt and "reference image" not in txt


def test_preparar_personaje_sin_ref_genera_2_opciones(tmp_path, monkeypatch):
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    prompts = []

    async def falsa_imagen(prompt, destino, referencia=None, meta=None):
        assert referencia is None  # sin imagen de referencia: texto puro
        prompts.append(prompt)
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        Path(destino).write_bytes(b"jpgdata")
        return f"http://fal/{Path(destino).name}"

    from pipeline import media_fal
    monkeypatch.setattr(media_fal, "imagen_nano", falsa_imagen)
    p = Proyecto(id="m1a", creado="2026-09-03T00:00:00", brief="x")
    d = Descripcion(nombre="semmelweis", descripcion="a Hungarian doctor")
    per = asyncio.run(character.preparar_personaje_sin_ref(p, resolver_estilo("animated"), d))
    assert len(per.opciones) == 2 and per.nombre == "semmelweis"
    assert per.opciones[0].url == "http://fal/opcion_0.jpg"
    assert (p.workdir / "personaje" / "opcion_1.jpg").read_bytes() == b"jpgdata"
    assert all("a Hungarian doctor" in t for t in prompts)


def test_preparar_sin_refs_saca_personaje_del_guion(tmp_path, monkeypatch):
    """El P0: un brief modo idea SIN referencias ya no termina con 0 opciones."""
    from pipeline import editor, flow, voices, writer
    from pipeline.voices import VozRank
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(Proyecto, "guardar", lambda self: None)
    guion = [EscenaGuion(id="1", narracion="Viena, 1847.")]

    async def _g(*a, **k):
        return guion
    monkeypatch.setattr(writer, "escribir_guion", _g)
    monkeypatch.setattr(editor, "editar_continuidad", _g)

    async def _v(*a, **k):
        return [VozRank(id="George", nivel="verde", motivo="")]
    monkeypatch.setattr(voices, "recomendar_voces", _v)
    llamadas = {}

    async def falso_describir(historia):
        llamadas["historia"] = historia
        return Descripcion(nombre="semmelweis", descripcion="a doctor")

    async def falso_sin_ref(p, estilo, d):
        llamadas["estilo"] = estilo.id
        return Personaje(nombre=d.nombre, descripcion=d.descripcion,
                         opciones=[OpcionPersonaje(url="http://f/0.jpg", path="p0"),
                                   OpcionPersonaje(url="http://f/1.jpg", path="p1")])
    monkeypatch.setattr(character, "describir_desde_guion", falso_describir)
    monkeypatch.setattr(character, "preparar_personaje_sin_ref", falso_sin_ref)
    # modo idea → forzado "historia": sin clasificador ni research (sin red)
    p = Proyecto(id="m1b", creado="2026-09-03T00:00:00", brief="Semmelweis", modo="idea")
    asyncio.run(flow._preparar(p))
    assert len(p.personaje.opciones) == 2 and p.personaje.nombre == "semmelweis"
    assert llamadas["historia"] == "1. Viena, 1847." and llamadas["estilo"] == "animated"


# ---------------------------------------------------------------------------
# endpoint /personaje/generar: gratis (incluido en preparar) y solo si faltan

def _proyecto_revision(**kw) -> Proyecto:
    base = dict(id="abc123", creado="2026-09-03T00:00:00", brief="b", estado="revision",
                guion=[EscenaGuion(id="1", narracion="hola")])
    base.update(kw)
    return Proyecto(**base)


def test_generar_personaje_repara_proyecto_varado(tmp_path, monkeypatch):
    from server import app as srv
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(Proyecto, "guardar", lambda self: None)
    p = _proyecto_revision()
    monkeypatch.setattr(srv, "cargar_proyecto", lambda i: p)
    monkeypatch.setattr(db, "cobrar_creditos",
                        lambda *a, **k: pytest.fail("generar opciones NO cobra"))

    async def falso_describir(historia):
        return Descripcion(nombre="ana", descripcion="a girl")

    async def falso_sin_ref(pp, estilo, d):
        return Personaje(nombre=d.nombre, descripcion=d.descripcion,
                         opciones=[OpcionPersonaje(url="u0", path="p0"),
                                   OpcionPersonaje(url="u1", path="p1")])
    monkeypatch.setattr(srv.character, "describir_desde_guion", falso_describir)
    monkeypatch.setattr(srv.character, "preparar_personaje_sin_ref", falso_sin_ref)
    out = asyncio.run(srv.generar_personaje("abc123"))
    assert len(out.personaje.opciones) == 2 and out.personaje.nombre == "ana"


def test_generar_personaje_409_si_ya_hay_opciones(tmp_path, monkeypatch):
    from fastapi import HTTPException
    from server import app as srv
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    p = _proyecto_revision(personaje=Personaje(opciones=[OpcionPersonaje(url="u", path="p")]))
    monkeypatch.setattr(srv, "cargar_proyecto", lambda i: p)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(srv.generar_personaje("abc123"))
    assert exc.value.status_code == 409


# ---------------------------------------------------------------------------
# endpoint /personaje/modificar: tarifa de imagen, agrega versión, devuelve en fallo

def _srv_modificar(tmp_path, monkeypatch):
    from server import app as srv
    monkeypatch.setenv("CREDITOS_BACKEND", "postgres")
    monkeypatch.setattr(project, "settings", SimpleNamespace(work_dir=tmp_path))
    monkeypatch.setattr(Proyecto, "guardar", lambda self: None)
    p = _proyecto_revision(personaje=Personaje(
        nombre="oso", opciones=[OpcionPersonaje(url="http://f/0.jpg", path="p0")], elegida=0))
    monkeypatch.setattr(srv, "cargar_proyecto", lambda i: p)
    return srv, p


def test_modificar_cobra_imagen_y_agrega_version(tmp_path, monkeypatch):
    srv, p = _srv_modificar(tmp_path, monkeypatch)
    cobros = []
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: cobros.append((u, n, r)) or 8)

    async def falso_llamar(app_, args, **kw):
        assert args["image_urls"] == ["http://f/0.jpg"] and "ponle lentes" in args["prompt"]
        return {"images": [{"url": "http://f/mod.jpg"}]}

    async def falso_descargar(url, destino):
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        Path(destino).write_bytes(b"x")
    monkeypatch.setattr(srv.fal, "llamar", falso_llamar)
    monkeypatch.setattr(srv.fal, "descargar", falso_descargar)
    out = asyncio.run(srv.modificar_personaje(
        "abc123", srv.ModificarPersonajeIn(instruccion="ponle lentes")))
    assert cobros == [("piloto", 2, "imagen:abc123")]
    assert len(out.personaje.opciones) == 2 and out.personaje.elegida == 1
    assert out.personaje.opciones[1].url == "http://f/mod.jpg"


def test_modificar_devuelve_si_falla(tmp_path, monkeypatch):
    from fastapi import HTTPException
    srv, p = _srv_modificar(tmp_path, monkeypatch)
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: 8)
    devueltos = []
    monkeypatch.setattr(db, "abonar_creditos",
                        lambda u, n, t, r=None: devueltos.append((n, t)) or 10)

    async def truena(*a, **k):
        raise RuntimeError("fal caída")
    monkeypatch.setattr(srv.fal, "llamar", truena)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(srv.modificar_personaje(
            "abc123", srv.ModificarPersonajeIn(instruccion="x")))
    assert exc.value.status_code == 502 and devueltos == [(2, "devolucion")]
    assert len(p.personaje.opciones) == 1  # la versión mala no se agrega


def test_modificar_402_sin_saldo(tmp_path, monkeypatch):
    from fastapi import HTTPException
    srv, p = _srv_modificar(tmp_path, monkeypatch)
    monkeypatch.setattr(db, "cobrar_creditos", lambda u, n, r=None: None)
    monkeypatch.setattr(db, "saldo_creditos", lambda u: 1)
    monkeypatch.setattr(srv.fal, "llamar",
                        lambda *a, **k: pytest.fail("sin saldo no se llama a fal"))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(srv.modificar_personaje(
            "abc123", srv.ModificarPersonajeIn(instruccion="x")))
    assert exc.value.status_code == 402


# ---------------------------------------------------------------------------
# muestra de voz: texto fijo, caché global — la segunda vez NO llama a TTS

def test_muestra_voz_fija_y_cacheada(tmp_path, monkeypatch):
    from server import app as srv
    monkeypatch.setenv("MEDIA_ROOT", str(tmp_path))
    monkeypatch.delenv("MEDIA_BUCKET", raising=False)
    llamadas = []

    async def falso_llamar(app_, args, **kw):
        llamadas.append(args["text"])
        return {"audio": {"url": "http://a/m.mp3"}}

    async def falso_descargar(url, destino):
        Path(destino).parent.mkdir(parents=True, exist_ok=True)
        Path(destino).write_bytes(b"mp3")
    monkeypatch.setattr(srv.fal, "llamar", falso_llamar)
    monkeypatch.setattr(srv.fal, "descargar", falso_descargar)
    asyncio.run(srv.muestra_voz("George"))
    asyncio.run(srv.muestra_voz("George"))
    assert llamadas == ["Hola, mi nombre es George y seré tu locutor."]  # UNA sola generación
    assert (tmp_path / "media" / "voces" / "George.mp3").read_bytes() == b"mp3"


def test_muestra_voz_desconocida_404(monkeypatch):
    from fastapi import HTTPException
    from server import app as srv
    with pytest.raises(HTTPException) as exc:
        asyncio.run(srv.muestra_voz("NoExiste"))
    assert exc.value.status_code == 404


# ---------------------------------------------------------------------------
# tarifas: imagen y packs salen de tools/tarifas.json (única fuente)

def test_tarifa_imagen_y_packs_de_tarifas_json():
    datos = json.loads((REPO / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    assert creditos.costo_imagen() == datos["video"]["imagen"] == 2
    assert creditos.PACKS == datos["packs_usd"] and len(creditos.PACKS) == 3


# ---------------------------------------------------------------------------
# backend fal (2026-09-03: se agotaron los créditos del Studio de Google)

def test_gen_backend_default_es_fal(monkeypatch):
    monkeypatch.delenv("GEN_BACKEND", raising=False)
    from pipeline.config import Settings
    assert Settings().gen_backend == "fal"


def test_costo_fal_nano_banana():
    from pipeline.pricing import costo_fal, estimar_regeneracion, unidades_fal
    assert costo_fal("fal-ai/nano-banana", {"prompt": "x", "num_images": 1}) == 0.04
    assert costo_fal("fal-ai/nano-banana/edit",
                     {"prompt": "x", "num_images": 2, "image_urls": ["u"]}) == 0.08
    assert unidades_fal("fal-ai/nano-banana/edit",
                        {"num_images": 1, "image_urls": ["u"]}) == {"images": 1, "reference_images": 1}
    est = estimar_regeneracion(6.5, n_imagenes=2, backend="fal")
    assert est["imagen"] == pytest.approx(0.08)          # 2 × $0.04 nano banana fal
    assert est["video"] == pytest.approx(0.24)           # 8 s × $0.03 veo lite 720p
