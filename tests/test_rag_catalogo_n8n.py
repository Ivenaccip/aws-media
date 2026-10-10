"""RAG·18 — el catálogo de nodos de n8n y la lista de permitidos.

Sin red: el generador se prueba con paquetes de mentira armados aquí mismo
(tarball, sha512 y metadatos de npm), y el lector contra los dos archivos
comiteados en media/library/n8n/."""
import base64
import hashlib
import io
import json
import tarfile
from pathlib import Path

import pytest

from pipeline import n8n_catalogo as nc
from tools import n8n_catalogo as gen

RAIZ = Path(__file__).resolve().parent.parent
B, L = "n8n-nodes-base.", "@n8n/n8n-nodes-langchain."


# ---------------------------------------------------------------------------
# construir(): de nodes.json al catálogo

def _hoja(**cambios):
    n = {"name": "hoja", "displayName": "Hoja", "version": [3, 4, 4.1], "defaultVersion": 4.1,
         "group": ["input"], "inputs": ["main"], "outputs": ["main"], "usableAsTool": True,
         "properties": [
             {"name": "url", "type": "string", "required": True},
             {"name": "aviso", "type": "notice", "required": True},
             {"name": "hojaId", "type": "string", "required": True,
              "displayOptions": {"show": {"operacion": ["leer"]}}},
             {"name": "url", "type": "string", "required": True,
              "displayOptions": {"show": {"modo": ["x"]}}},
         ],
         "credentials": [{"name": "hojaOAuth2", "required": True,
                          "displayOptions": {"show": {"authentication": ["oAuth2"]}}},
                         {"name": "hojaApi"}],
         "codex": {"resources": {"primaryDocumentation": [{"url": "https://docs/hoja/"}],
                                 "credentialDocumentation": [{"url": "https://docs/cred/"}]}}}
    n.update(cambios)
    return n


def _vieja():
    return {"name": "hoja", "displayName": "Hoja vieja", "version": [1, 2], "defaultVersion": 4.1,
            "group": ["input"], "inputs": ["main"], "outputs": ["main"],
            "properties": [{"name": "sheetId", "type": "string", "required": True}]}


def _construir(base=None, lc=None):
    return gen.construir(
        {"n8n-nodes-base": {"nodes": base or [], "credentials": [{"name": "hojaApi", "displayName": "Hoja API"}]},
         "@n8n/n8n-nodes-langchain": {"nodes": lc or [], "credentials": []}},
        {"n8n": "9.9.9"})


def test_une_las_versiones_y_describe_la_por_defecto():
    n = _construir([_vieja(), _hoja()])["nodos"][B + "hoja"]
    assert n["versiones"] == [1, 2, 3, 4, 4.1]
    assert n["version_por_defecto"] == 4.1
    assert n["nombre"] == "Hoja"                   # de la entrada de 4.1, no de la vieja
    assert n["obligatorios"] == ["url"]            # el aviso no cuenta; sheetId es de la vieja
    assert n["obligatorios_segun_otros"] == ["hojaId"]   # url ya es obligatorio siempre
    assert n["credenciales"] == [
        {"nombre": "hojaOAuth2", "requerida": True, "si": {"authentication": ["oAuth2"]}},
        {"nombre": "hojaApi", "requerida": False}]
    assert n["como_herramienta"] and not n["disparador"] and not n["oculto"]
    assert (n["doc"], n["doc_credencial"]) == ("https://docs/hoja/", "https://docs/cred/")


def test_sin_default_version_toma_la_mayor():
    n = _construir([_hoja(defaultVersion=None, version=[1, 1.2, 1.1])])["nodos"][B + "hoja"]
    assert n["version_por_defecto"] == 1.2


def test_version_suelta_y_puertos_dinamicos():
    n = _construir(lc=[_hoja(name="almacen", version=1, defaultVersion=None,
                             inputs="={{ ((p) => [])($parameter) }}",
                             outputs=[{"type": "ai_tool", "displayName": "Tool"}])])
    n = n["nodos"][L + "almacen"]                  # el prefijo sale del paquete
    assert n["versiones"] == [1]
    assert n["entradas"] == "dinámico" and n["salidas"] == ["ai_tool"]


def test_oculto_solo_si_todas_sus_entradas_lo_estan():
    assert not _construir([_vieja() | {"hidden": True}, _hoja()])["nodos"][B + "hoja"]["oculto"]
    assert _construir([_hoja(hidden=True)])["nodos"][B + "hoja"]["oculto"]


def test_disparador_y_credenciales():
    cat = _construir([_hoja(name="gatillo", group=["trigger"])])
    assert cat["nodos"][B + "gatillo"]["disparador"]
    assert cat["credenciales"] == {"hojaApi": "Hoja API"}


# ---------------------------------------------------------------------------
# npm: versión, integridad y tarball

def _tgz(nodes, credentials=()):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for k, v in (("nodes", nodes), ("credentials", list(credentials))):
            datos = json.dumps(v).encode()
            info = tarfile.TarInfo(gen.DENTRO + k + ".json")
            info.size = len(datos)
            tar.addfile(info, io.BytesIO(datos))
    return buf.getvalue()


def _sha(datos):
    return "sha512-" + base64.b64encode(hashlib.sha512(datos).digest()).decode()


def _npm(stable="2.41.3", deps=None):
    deps = deps if deps is not None else {"n8n-nodes-base": "2.41.2",
                                          "@n8n/n8n-nodes-langchain": "2.41.2"}
    tarballs = {"n8n-nodes-base": _tgz([_hoja()]), "@n8n/n8n-nodes-langchain": _tgz([])}
    pedidos = []

    def pedir(url):
        pedidos.append(url)
        if url == f"{gen.REGISTRO}/n8n":
            return {"dist-tags": {"stable": stable, "latest": "2.41.3"},
                    "versions": {stable: {"dependencies": deps}, "2.40.0": {"dependencies": deps}}}
        for p, t in tarballs.items():
            if url.startswith(f"{gen.REGISTRO}/{p.replace('/', '%2F')}/"):
                return {"dist": {"tarball": "https://t/" + p, "integrity": _sha(t)}}
        raise AssertionError(url)

    def bajar(url):
        return tarballs[url.removeprefix("https://t/")]

    return pedir, bajar, pedidos, tarballs


def test_resuelve_desde_la_stable_de_n8n_no_desde_latest_del_paquete():
    pedir, *_ = _npm()
    r = gen.resolver(None, pedir)
    assert r == {"n8n": "2.41.3", "paquetes": {"n8n-nodes-base": "2.41.2",
                                               "@n8n/n8n-nodes-langchain": "2.41.2"}}
    assert gen.resolver("2.40.0", pedir)["n8n"] == "2.40.0"
    with pytest.raises(SystemExit, match="no existe"):
        gen.resolver("1.0.0", pedir)


def test_si_n8n_deja_de_depender_de_un_paquete_para():
    pedir, *_ = _npm(deps={"n8n-nodes-base": "2.41.2"})
    with pytest.raises(SystemExit, match="n8n-nodes-langchain"):
        gen.resolver(None, pedir)


def test_integridad():
    gen.verificar(b"hola", _sha(b"hola"))
    with pytest.raises(gen.Integridad):
        gen.verificar(b"hola", _sha(b"adios"))
    with pytest.raises(gen.Integridad):
        gen.verificar(b"hola", "sha1-xxx")


def test_generar_de_punta_a_punta_sin_red(tmp_path):
    pedir, bajar, pedidos, _ = _npm()
    cat = gen.generar(None, pedir, bajar, hoy="2026-09-30")
    assert cat["procedencia"]["n8n"] == "2.41.3" and cat["procedencia"]["generado"] == "2026-09-30"
    assert list(cat["nodos"]) == [B + "hoja"]
    assert f"{gen.REGISTRO}/@n8n%2Fn8n-nodes-langchain/2.41.2" in pedidos
    ruta = tmp_path / "catalog.json"
    gen.escribir(cat, ruta)
    texto = ruta.read_text(encoding="utf-8")
    assert json.loads(texto) == cat
    assert any(linea.strip().startswith(f'"{B}hoja"') for linea in texto.splitlines())


def test_un_tarball_alterado_no_se_lee():
    pedir, _, _, tarballs = _npm()
    with pytest.raises(gen.Integridad):
        gen.generar(None, pedir, lambda url: tarballs["n8n-nodes-base"] + b"x")


# ---------------------------------------------------------------------------
# los archivos comiteados

def test_catalogo_comiteado_con_procedencia():
    cat = nc.catalogo()
    p = cat["procedencia"]
    assert p["n8n"] and p["generado"] and set(p["paquetes"]) == set(gen.PAQUETES)
    assert len(cat["nodos"]) > 400
    assert any(t.startswith(L) for t in cat["nodos"])     # los de IA también
    assert nc.RUTA_CATALOGO.stat().st_size < 1_000_000   # viaja en la imagen


def test_permitidos_cuadran_con_el_catalogo():
    assert nc.revisar_permitidos() == []


def test_el_prototipo_son_los_niveles_1_y_2():
    p = nc.permitidos()
    niveles = [n["nivel"] for n in p.values()]
    assert niveles.count(1) == 20
    assert niveles.count(2) == 27          # 30 del nivel 2 − 3 de subflujos + Simple Vector Store
    assert len(p) == 47                    # + HTTP Request Tool, que llega como variante


def test_sin_subflujos():
    fuera = {n["tipo"] for n in json.loads(nc.RUTA_PERMITIDOS.read_text("utf-8"))["fuera_por_ahora"]}
    assert fuera == {B + "executeWorkflow", B + "executeWorkflowTrigger", L + "toolWorkflow"}
    for t in fuera:
        assert nc.revisar(t).codigo == "no_soportado"


def test_hay_almacen_vectorial_para_los_nodos_de_documentos():
    p = nc.permitidos()
    assert L + "vectorStoreInMemory" in p
    for t in ("embeddingsOpenAi", "documentDefaultDataLoader",
              "textSplitterRecursiveCharacterTextSplitter"):
        assert L + t in p


def test_modelo_sugerido():
    m = nc.llm()
    assert (m["proveedor"], m["modelo"]) == ("openai", "gpt-5.4-mini")
    assert m["nodo"] == L + "lmChatOpenAi"
    assert "otro" in m["regla"]            # si el visitante pide otro, se usa el otro


# ---------------------------------------------------------------------------
# revisar(): lo que usará el validador de RAG·22

@pytest.mark.parametrize("tipo, version, codigo", [
    (B + "googleSheets", None, "ok"),
    (B + "googleSheetsTool", None, "ok"),          # variante de herramienta de un permitido
    (B + "httpRequestTool", None, "ok"),           # la «HTTP Request Tool» del nivel 2
    (B + "hubspot", None, "no_soportado"),         # real, aún no
    (B + "hubspotTool", None, "no_soportado"),
    (B + "nodoInventado", None, "no_existe"),
    (B + "ifTool", None, "no_existe"),             # If no sirve como herramienta
    (L + "toolHttpRequest", None, "oculto"),       # la vieja, retirada
    (B + "set", 99, "version_invalida"),
])
def test_revisar(tipo, version, codigo):
    assert nc.revisar(tipo, version).codigo == codigo


def test_mensajes_para_el_visitante():
    assert nc.revisar(B + "hubspot").mensaje == "Este nodo aún no lo soportamos: HubSpot."
    assert "no existe" in nc.revisar(B + "nodoInventado").mensaje
    v = nc.revisar(B + "set", nc.catalogo()["nodos"][B + "set"]["version_por_defecto"])
    assert v.ok and v.mensaje == ""


# ---------------------------------------------------------------------------
# empaquetado

def test_el_catalogo_entra_en_la_imagen_y_el_resto_de_media_no():
    lineas = [x.strip() for x in (RAIZ / ".dockerignore").read_text("utf-8").splitlines()]
    assert "media/" in lineas
    excepciones = [x for x in lineas if x.startswith("!media")]
    assert excepciones == ["!media/library/n8n/"]
    assert lineas.index("!media/library/n8n/") > lineas.index("media/")
