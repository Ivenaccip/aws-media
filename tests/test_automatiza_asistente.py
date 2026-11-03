"""Asistente de Automatizaciones, Fase A — la lógica pura de `pipeline/asistente.py` y las muestras de
`media/library/n8n/muestras_prueba.json`. Sin red, sin base, sin reloj de verdad (el reloj se inyecta):
nada de esto puede gastar un centavo.

Qué fija este archivo:

  - cada muestra «listo» pasa el MISMO validador que el generador real (`pipeline/validador.validar`),
    sin errores ni advertencias, y ninguna lleva nada que parezca una clave;
  - la selección por palabras clave (acentos, mayúsculas, subcadenas, la de reserva, y que «sin_cobertura»
    gana a las otras);
  - el id opaco `p1.…` (ida y vuelta, y todo lo que NO es un id propio y vigente → «no encontrada»);
  - el reloj: 4 pasos de 1.2 s (4.8 s: caben antes del primer sondeo de la web) y luego el final;
  - la lista blanca de llaves de cada estado y que `grafo` solo viaja donde existe;
  - que el `grafo` de las muestras es idéntico al de `ejemplos.ts` del Constructor, que cumple sus invariantes
    (port de `invariantesDelGrafo`, comparado con el original sobre 55 000 grafos) y que el `flujo` es la
    exportación del Constructor de ese grafo (`golden/flujos.json`), sin necesitar node.

Todo corre bajo los mismos espías de gasto y de red que `test_automatiza_api.py` (la lógica pura tampoco puede
tocar la base, la cola, un modelo ni una conexión).
"""
import base64
import copy
import dataclasses
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from pipeline import asistente, db, n8n_catalogo, validador
from pipeline import publico as freno
from test_automatiza_api import _entorno, _sin_gasto, espias  # noqa: F401 — los mismos espías de gasto y red
from test_automatiza_idioma import voseo

RAIZ = Path(__file__).resolve().parent.parent
EJEMPLOS_TS = RAIZ / "web" / "src" / "pantallas" / "constructor" / "modelo" / "ejemplos.ts"
T0 = 1_760_000_000.0           # un instante cualquiera; todo lo demás se mide desde aquí
USUARIO = "sub-de-ana"


def doc() -> dict:
    return json.loads(asistente.RUTA_MUESTRAS.read_text(encoding="utf-8"))


@pytest.fixture
def lista():
    return asistente.cargar_muestras()


def por_id(lista, id_):
    return next(m for m in lista if m.id == id_)


def forjar(u=None, t=None, m="correos", extras=None, *, canonico=True, ahora=T0) -> str:
    """Un id fabricado a mano. Por omisión es uno válido; cada prueba rompe una cosa."""
    carga = {"u": asistente.hash_usuario(USUARIO) if u is None else u,
             "t": round(ahora * 1000) if t is None else t, "m": m, **(extras or {})}
    crudo = json.dumps(carga, separators=(",", ":"), sort_keys=canonico)
    return asistente.PREFIJO_ID + asistente._b64(crudo.encode("ascii"))


# ---------------------------------------------------------------------------
# las muestras

def test_el_archivo_de_muestras_se_carga_y_tiene_la_forma_esperada(lista):
    assert [m.id for m in lista] == ["sin_cobertura", "correos", "preguntas", "resumen_diario"]
    assert [m.estado for m in lista] == ["sin_cobertura", "listo", "listo", "listo"]
    assert [m.por_omision for m in lista] == [False, False, False, True]


def test_cada_muestra_listo_pasa_el_validador_del_generador_real(lista):
    """El mismo `validar` que usa `armado.generar`: si una muestra no lo pasara, el modo de prueba
    enseñaría un flujo que el real jamás entregaría."""
    flujos = [m for m in lista if m.estado == "listo"]
    assert len(flujos) == 3
    for m in flujos:
        r = validador.validar(m.flujo)
        assert r.ok and r.errores == [] and r.advertencias == [], (m.id, r.errores, r.advertencias)
        # las del validador (ninguna) más, si el flujo abre un chat público, el aviso del Constructor
        assert m.advertencias == tuple(asistente.advertencias_de(m.flujo, r.advertencias))
        assert (asistente.ADVERTENCIA_CHAT_PUBLICO in m.advertencias) == (m.id == "preguntas")


def test_la_muestra_de_sin_cobertura_no_es_un_flujo(lista):
    m = por_id(lista, "sin_cobertura")
    assert m.flujo is None and m.grafo is None and m.nodos == () and m.pendientes == ()
    assert 1 <= len(m.faltan) <= asistente.MAX_FALTAN
    assert all(0 < len(x) <= asistente.MAX_FALTAN_CHARS for x in m.faltan)


def test_las_muestras_no_llevan_nada_que_parezca_una_clave():
    crudo = asistente.RUTA_MUESTRAS.read_text(encoding="utf-8")
    assert not [p.pattern for p in validador.SECRETOS if p.search(crudo)]


def test_los_nodos_de_las_muestras_son_permitidos_con_version_valida(lista):
    for m in lista:
        for n in (m.flujo or {}).get("nodes", []):
            v = n8n_catalogo.revisar(n["type"], n["typeVersion"])
            assert v.ok, (m.id, n["type"], v.mensaje)


def test_las_credenciales_van_vacias_y_no_hay_timezone_de_la_maquina(lista):
    """El generador real entrega `settings` sin zona; la «UTC» del arnés del mockup no se hereda."""
    for m in lista:
        if m.flujo is None:
            continue
        assert "timezone" not in m.flujo["settings"], m.id
        assert m.flujo["pinData"] == {}
        for n in m.flujo["nodes"]:
            for cred in (n.get("credentials") or {}).values():
                assert cred["id"] == "" and cred["name"], (m.id, n["name"])


def test_el_resumen_de_cada_muestra_es_corto_y_en_espanol_latam(lista):
    for m in lista:
        if m.estado != "listo":
            continue
        assert 0 < len(m.resumen) <= 500 and asistente.sin_clave(m.resumen)
        assert voseo(m.resumen) == [], m.id


def test_el_nombre_de_cada_nodo_sale_de_permitidos_y_las_herramientas_lo_dicen(lista):
    correos = por_id(lista, "correos")
    assert [n["nombre"] for n in correos.nodos] == [
        "Gmail Trigger", "AI Agent", "OpenAI Chat Model", "Google Sheets (herramienta)", "Gmail"]
    assert [n["nombre_en_flujo"] for n in correos.nodos] == [n["name"] for n in correos.flujo["nodes"]]
    assert [n["tipo"] for n in correos.nodos] == [n["type"] for n in correos.flujo["nodes"]]
    assert asistente.nombre_de_nodo("n8n-nodes-base.slackTool") == "Slack (herramienta)"
    assert asistente.nombre_de_nodo("n8n-nodes-base.noExiste") == "noExiste"


def test_los_pendientes_se_derivan_de_las_credenciales_del_propio_flujo(lista):
    """Una línea por cuenta y, en las apps, lo que hay que elegir (los textos de `datos/pendientes.ts`)."""
    assert por_id(lista, "correos").pendientes == (
        "Conecta tu cuenta de Gmail en n8n y elige el destinatario.",
        "Conecta tu cuenta de OpenAI en n8n.",
        "Conecta tu cuenta de Google Sheets en n8n y elige el documento y la hoja.")
    assert por_id(lista, "preguntas").pendientes == (
        "Conecta tu cuenta de Anthropic en n8n.", "Conecta tu cuenta de OpenAI en n8n.",
        "Conecta tu cuenta de Notion en n8n y elige la página y el título.")
    assert por_id(lista, "resumen_diario").pendientes == (
        "Conecta tu cuenta de OpenAI en n8n.", "Conecta tu cuenta de Gmail en n8n y elige el destinatario.",
        "Conecta tu cuenta de Slack en n8n y elige el canal.")


def test_pendientes_de_no_repite_ni_inventa():
    flujo = {"nodes": [{"credentials": {"a": {"name": "Gmail"}, "b": {"name": "Gmail"}}},
                       {"credentials": {"c": {"name": "  Mi   Cuenta "}}}, {}, {"credentials": None},
                       {"credentials": {"slackApi": {}}}]}
    assert asistente.pendientes_de(flujo) == [
        "Conecta tu cuenta de Gmail en n8n.", "Conecta tu cuenta de Mi Cuenta en n8n.",
        "Conecta tu cuenta de slackApi en n8n."]
    assert asistente.pendientes_de({}) == []


def test_el_grafo_de_cada_muestra_es_coherente_con_su_flujo(lista):
    """Una comprobación estructural barata de que `grafo` y `flujo` cuentan el mismo flujo (la exacta,
    exportar el grafo y comparar, vive en el lado de la web)."""
    for m in lista:
        if m.estado != "listo":
            continue
        g = m.grafo
        assert set(g) == {"nombreFlujo", "nodes", "edges"} and g["nombreFlujo"] == m.flujo["name"]
        ids = [n["id"] for n in g["nodes"]]
        assert len(set(ids)) == len(ids) and len({e["id"] for e in g["edges"]}) == len(g["edges"])
        for e in g["edges"]:
            assert e["de"] in ids and e["a"] in ids and e["tipo"] in ("seq", "tool"), (m.id, e)
        for n in g["nodes"]:
            assert n["kind"] in ("trigger", "agent", "app")
            # las coordenadas son las del mockup (y = 180 y 380 no son múltiplos de 8: el Constructor
            # las ajusta al cargar); aquí solo se pide que estén dentro del lienzo
            assert all(isinstance(n[k], int) and 0 <= n[k] <= 2400 for k in "xy")
        agentes = [n for n in g["nodes"] if n["kind"] == "agent"]
        apps = [n for n in g["nodes"] if n["kind"] == "app"]
        # un disparador + cada agente con su modelo de IA + cada app
        assert len(m.flujo["nodes"]) == 1 + 2 * len(agentes) + len(apps), m.id
        nombres = {n["name"] for n in m.flujo["nodes"]}
        assert {n["nombre"] for n in agentes + apps} <= nombres, m.id


@pytest.mark.skipif(shutil.which("node") is None or not EJEMPLOS_TS.exists()
                    or not (RAIZ / "web" / "node_modules" / "typescript").exists(),
                    reason="hace falta node, web/node_modules y el modelo del Constructor")
def test_el_grafo_y_las_claves_son_identicos_a_los_de_ejemplos_ts(lista):
    """«Mantén ambos idénticos»: lo que el Asistente manda en `grafo` es lo que el Constructor trae en
    `ejemplos.ts`. Se transpila el .ts con el TypeScript de web/ y se comparan los datos."""
    guion = r"""
      const fs = require('fs'); const ts = require(process.argv[1] + '/node_modules/typescript');
      const src = fs.readFileSync(process.argv[2], 'utf8');
      const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      const req = (p) => (p.startsWith('.') ? { norm: (x) => String(x) } : require(p));   // los vecinos no importan: solo los datos
      const mod = { exports: {} }; new Function('exports', 'require', 'module', js)(mod.exports, req, mod);
      process.stdout.write(JSON.stringify(mod.exports.muestras()));
    """
    r = subprocess.run(["node", "-e", guion, str(RAIZ / "web"), str(EJEMPLOS_TS)], capture_output=True,
                       text=True, encoding="utf-8", timeout=120, check=True)
    del_ts = json.loads(r.stdout)
    mias = [m for m in lista if m.grafo is not None]
    assert len(del_ts) == len(mias) == 3
    for ts, m in zip(del_ts, mias):
        assert m.grafo == {"nombreFlujo": ts["nombre"], "nodes": ts["nodes"], "edges": ts["edges"]}, m.id
        assert list(m.claves) == [asistente.norm(c) for c in ts["claves"]], m.id


# ---------------------------------------------------------------------------
# el cargador falla cerrado

def _cargar_con(tmp_path, cambio) -> None:
    d = doc()
    cambio(d)
    ruta = tmp_path / "muestras.json"
    ruta.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    asistente.cargar_muestras(ruta)


def test_el_cargador_acepta_el_archivo_tal_cual(tmp_path):
    _cargar_con(tmp_path, lambda d: None)


@pytest.mark.parametrize("nombre,cambio", [
    ("flujo que no valida", lambda d: d["muestras"][1]["flujo"]["nodes"][0].update(type="n8n-nodes-base.noExiste")),
    ("flujo con una clave", lambda d: d["muestras"][1]["flujo"]["nodes"][1]["parameters"].update(
        x="sk-" + "a" * 30)),
    ("id repetido", lambda d: d["muestras"][2].update(id="correos")),
    ("id con mayúsculas", lambda d: d["muestras"][2].update(id="Preguntas")),
    ("estado desconocido", lambda d: d["muestras"][2].update(estado="listísimo")),
    ("sin muestra por omisión", lambda d: d["muestras"][3].pop("por_omision")),
    ("dos por omisión", lambda d: d["muestras"][2].update(por_omision=True)),
    ("por omisión sin_cobertura", lambda d: d["muestras"][0].update(por_omision=True)),
    ("clave vacía", lambda d: d["muestras"][1]["claves"].append("   ")),
    ("sin_cobertura sin faltan", lambda d: d["muestras"][0].update(faltan=[])),
    ("sin_cobertura con flujo", lambda d: d["muestras"][0].update(flujo=d["muestras"][1]["flujo"])),
    ("listo sin resumen", lambda d: d["muestras"][1].update(resumen="  ")),
    ("listo sin flujo", lambda d: d["muestras"][1].update(flujo=None)),
    ("grafo sin edges", lambda d: d["muestras"][1]["grafo"].pop("edges")),
    ("sin llave muestras", lambda d: d.pop("muestras")),
    ("lista vacía", lambda d: d.update(muestras=[])),
    ("muestra que no es objeto", lambda d: d["muestras"].append("hola")),
])
def test_el_cargador_rechaza_lo_roto(tmp_path, nombre, cambio):
    with pytest.raises(asistente.MuestrasInvalidas):
        _cargar_con(tmp_path, cambio)


def test_el_cargador_rechaza_un_archivo_que_no_existe_o_no_es_json(tmp_path):
    with pytest.raises(asistente.MuestrasInvalidas):
        asistente.cargar_muestras(tmp_path / "no_hay.json")
    roto = tmp_path / "roto.json"
    roto.write_text("{", encoding="utf-8")
    with pytest.raises(asistente.MuestrasInvalidas):
        asistente.cargar_muestras(roto)


# ---------------------------------------------------------------------------
# elegir la muestra

@pytest.mark.parametrize("pedido,esperada", [
    ("Quiero que cuando llegue un correo de un cliente, una IA le conteste", "correos"),
    ("responder mis EMAILS automáticamente con IA", "correos"),
    ("Respóndeme el Gmail de mi tienda cuando pregunten precios", "correos"),
    ("que mi mail se conteste solo cuando salgo de viaje", "correos"),
    ("CORRÉO con tilde de más", "correos"),
    ("Un asistente que responda preguntas de mis clientes", "preguntas"),
    ("Quiero un chat en mi página con una IA", "preguntas"),
    ("Un bot de WhatsApp para mi tienda de ropa", "preguntas"),
    ("que conteste en telegram a mis alumnos", "preguntas"),
    ("Una IA que me ayude a INVESTIGAR a mis competidores", "preguntas"),
    ("un asistente de investigación de mercado cada semana", "preguntas"),
    ("Cada mañana quiero un resumen de lo importante", "resumen_diario"),
    ("Cuéntame algo cualquiera para automatizar mi negocio hoy", "resumen_diario"),
    ("                    ", "resumen_diario"),
    ("", "resumen_diario"),
    # la de sin_cobertura va primero: gana aunque el pedido también diga «correo»
    ("Cuando entre un lead en HubSpot mándame un correo", "sin_cobertura"),
    ("Publicar en INSTAGRAM las fotos que ponga en una carpeta", "sin_cobertura"),
    ("Cuando alguien abra un issue en GitHub avísame en el chat", "sin_cobertura"),
    ("Agrega a mi Calendario las citas del formulario", "sin_cobertura"),
    ("Mándame las noticias de un feed RSS cada lunes", "sin_cobertura"),
])
def test_la_muestra_que_le_toca_a_cada_pedido(lista, pedido, esperada):
    assert asistente.elegir(pedido, lista).id == esperada


def test_elegir_ignora_acentos_y_mayusculas_en_el_pedido_y_en_las_claves():
    assert asistente.norm("  CORRÉO Ñandú  ") == "correo nandu"
    assert asistente.norm("cafe\u0301") == asistente.norm("caf\u00e9") == "cafe"      # tilde combinante o precompuesta
    assert asistente.norm(None) == "" and asistente.norm(42) == "42"


# ---------------------------------------------------------------------------
# el texto del pedido

def test_el_pedido_se_recorta_y_se_mide_contra_los_limites_de_publico():
    minimo, maximo = asistente.limites()
    assert (minimo, maximo) == (freno.LARGO_MINIMO, freno.LARGO_MAXIMO) == (20, 1500)
    assert asistente.revisar_texto("  " + "a" * minimo + "\n ") == "a" * minimo
    assert len(asistente.revisar_texto("ñ" * maximo)) == maximo


@pytest.mark.parametrize("texto,codigo,extras", [
    ("", "vacio", {}),
    ("   \n\t ", "vacio", {}),
    ("a" * 19, "corto", {"minimo": 20}),
    ("  " + "a" * 19 + "  ", "corto", {"minimo": 20}),
    ("a" * 1501, "largo", {"maximo": 1500}),
    ("hola\x00mundo " * 5, "texto_invalido", {}),
    ("pedido con sustituto suelto \ud800 y más texto", "texto_invalido", {}),
    ("\x00", "texto_invalido", {}),
])
def test_los_pedidos_que_no_se_pueden_atender(texto, codigo, extras):
    with pytest.raises(asistente.ErrorAsistente) as e:
        asistente.revisar_texto(texto)
    assert e.value.codigo == codigo and e.value.extras == extras


def test_los_limites_se_leen_en_cada_uso(monkeypatch):
    """Una sola fuente: si el dueño pone su número en `pipeline/publico.py`, el Asistente lo sigue."""
    monkeypatch.setattr(freno, "LARGO_MINIMO", 5)
    monkeypatch.setattr(freno, "LARGO_MAXIMO", 30)
    assert asistente.revisar_texto("cinco") == "cinco"
    with pytest.raises(asistente.ErrorAsistente) as e:
        asistente.revisar_texto("x" * 31)
    assert e.value.extras == {"maximo": 30}
    assert asistente.config(asistente.PRUEBA)["largo_maximo"] == 30


# ---------------------------------------------------------------------------
# el id

def test_ida_y_vuelta_del_id(lista):
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    assert id_.startswith("p1.") and len(id_) <= asistente.ID_MAX
    assert not re.fullmatch(r"[A-Za-z0-9_-]{16}", id_)            # nunca se confunde con un id real
    assert id_ == forjar()                                        # una sola forma de escribirlo
    muestra, t = asistente.leer_id(id_, USUARIO, T0 + 3, lista)
    assert muestra.id == "correos" and t == round(T0 * 1000)


def test_el_id_no_lleva_el_texto_ni_el_usuario_en_claro(lista):
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    cuerpo = id_[len(asistente.PREFIJO_ID):]
    carga = json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)))
    assert set(carga) == {"u", "t", "m"} and USUARIO not in json.dumps(carga)
    assert re.fullmatch(r"[0-9a-f]{12}", carga["u"])


@pytest.mark.parametrize("nombre,id_", [
    ("sin prefijo", forjar()[3:]),
    ("otro prefijo", "p2." + forjar()[3:]),
    ("prefijo en mayúscula", "P1." + forjar()[3:]),
    ("vacío", ""),
    ("solo el prefijo", "p1."),
    ("un id real de la página pública", "AbCdEfGhIjKlMnOp"),
    ("no es texto", None),
    ("es un número", 12345),
    ("más de 120 caracteres", forjar() + "A" * 120),
    ("caracter fuera del alfabeto", forjar() + "+"),
    ("relleno con =", forjar() + "="),
    ("espacio al final", forjar() + " "),
    ("salto de línea al final", forjar() + "\n"),
    ("barra", forjar() + "/"),
    ("base64 de un solo carácter de más", "p1." + forjar()[3:] + "A"),
    ("base64 roto", "p1.!!!!"),
    ("no es JSON", "p1." + "aG9sYQ"),                                     # «hola»
    ("JSON que no es objeto", "p1." + "WzEsMiwzXQ"),                        # [1,2,3]
    ("JSON con unicode", "p1." + "wqE"),                                    # bytes que no son ASCII
    ("llave de más", forjar(extras={"x": 1})),
    ("llave de menos", "p1." + asistente._b64(b'{"m":"correos","t":1760000000000}')),
    ("orden de llaves distinto", forjar(canonico=False)),
    ("de otra persona", forjar(u=asistente.hash_usuario("sub-de-beto"))),
    ("u que no es un hash", forjar(u="")),
    ("u mayúsculas", forjar(u=asistente.hash_usuario(USUARIO).upper())),
    ("t como texto", forjar(t="1760000000000")),
    ("t como decimal", forjar(t=1760000000000.5)),
    ("t booleano", forjar(t=True)),
    ("t nulo", "p1." + asistente._b64(b'{"m":"correos","t":null,"u":"%s"}'
                                       % asistente.hash_usuario(USUARIO).encode())),
    ("t del futuro", forjar(t=round((T0 + 61) * 1000))),
    ("t de hace más de una hora", forjar(t=round((T0 - 3601) * 1000))),
    ("muestra que no existe", forjar(m="nueva")),
    ("muestra con otro tipo", forjar(m=7)),
])
def test_todo_lo_que_no_es_un_id_propio_y_vigente_es_no_encontrada(lista, nombre, id_):
    with pytest.raises(asistente.ErrorAsistente) as e:
        asistente.leer_id(id_, USUARIO, T0, lista)
    assert e.value.codigo == "no_encontrada" and e.value.extras == {}, nombre


def test_la_ventana_de_validez_del_id(lista):
    inicio = round(T0 * 1000)
    leer = lambda ahora: asistente.leer_id(forjar(t=inicio), USUARIO, ahora, lista)    # noqa: E731
    leer(T0 - 60)                                   # reloj de otra máquina un minuto atrasado: pasa
    leer(T0 + 3600)                                 # la hora entera: pasa
    for ahora in (T0 - 60.01, T0 + 3600.01):
        with pytest.raises(asistente.ErrorAsistente):
            leer(ahora)


def test_dos_personas_no_se_ven(lista):
    mio = asistente.crear_id("sub-de-ana", "correos", T0)
    asistente.leer_id(mio, "sub-de-ana", T0, lista)
    with pytest.raises(asistente.ErrorAsistente):
        asistente.leer_id(mio, "sub-de-beto", T0, lista)


# ---------------------------------------------------------------------------
# el reloj y lo que ve la persona

def consultar(id_, ahora, usuario=USUARIO):
    return asistente.consultar(id_, usuario, ahora)


def test_los_pasos_de_prueba_son_los_de_la_cola_real_y_duran_cuatro_segundos_y_ocho_decimas():
    assert asistente.PASOS == db.PASOS_AUTOMATIZA == ("entender", "buscar", "armar", "revisar")
    assert asistente.PAUSA_PRUEBA_SEG == 1.2 and asistente.PAUSA_MS == 1200
    assert asistente.DURACION_MS == 4800


@pytest.mark.parametrize("despues,paso,lleva", [
    (0.0, "entender", 0), (1.0, "entender", 1), (1.199, "entender", 1), (1.2, "buscar", 1),
    (2.399, "buscar", 2), (2.4, "armar", 2), (3.599, "armar", 3), (3.6, "revisar", 3),
    (4.799, "revisar", 4),
])
def test_el_reloj_avanza_cuatro_pasos_de_un_segundo_y_dos_decimas(despues, paso, lleva):
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 + despues)
    assert (v["estado"], v["listo"], v["paso"], v["lleva_seg"]) == ("armando", False, paso, lleva)
    assert set(v) == {*asistente.LLAVES_BASE, "paso"} and v["modo"] == "prueba" and v["id"] == id_


def test_con_el_reloj_atrasado_arranca_desde_el_principio():
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 - 30)
    assert (v["estado"], v["paso"], v["lleva_seg"]) == ("armando", "entender", 0)


@pytest.mark.parametrize("despues", [4.8, 4.801, 5.0, 6.0, 60.0, 3600.0])
def test_pasados_los_cuatro_segundos_y_ocho_decimas_queda_en_su_final_y_ahi_se_queda(despues):
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 + despues)
    assert (v["estado"], v["listo"], v["lleva_seg"]) == ("listo", True, 4)
    assert consultar(id_, T0 + despues) == v                      # idempotente


def test_el_final_listo_trae_la_lista_blanca_exacta():
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 + 6)
    assert list(v) == [*asistente.LLAVES_BASE, *asistente.LLAVES_POR_ESTADO["listo"]]
    assert v["nombre"] == "Responder correos de clientes" == v["flujo"]["name"]
    assert v["resumen"].startswith("Cuando llega un correo nuevo")
    assert [n["tipo"] for n in v["nodos"]] == [n["type"] for n in v["flujo"]["nodes"]]
    assert all(set(n) == {"tipo", "nombre", "etiqueta", "nombre_en_flujo"} for n in v["nodos"])
    assert v["advertencias"] == [] and len(v["pendientes"]) == 3
    assert set(v["grafo"]) == {"nombreFlujo", "nodes", "edges"} and v["grafo"]["nombreFlujo"] == v["nombre"]
    assert validador.validar(v["flujo"]).ok


@pytest.mark.parametrize("muestra", ["correos", "preguntas", "resumen_diario"])
def test_las_tres_muestras_de_flujo_traen_grafo(muestra):
    v = consultar(asistente.crear_id(USUARIO, muestra, T0), T0 + 6)
    assert v["estado"] == "listo" and v["grafo"]["nodes"] and v["grafo"]["edges"]


def test_el_final_sin_cobertura_trae_mensaje_y_faltan_y_ningun_flujo():
    v = consultar(asistente.crear_id(USUARIO, "sin_cobertura", T0), T0 + 6)
    assert list(v) == [*asistente.LLAVES_BASE, *asistente.LLAVES_POR_ESTADO["sin_cobertura"]]
    assert (v["estado"], v["listo"]) == ("sin_cobertura", False)
    assert v["mensaje"] == "Todavía no sabemos armar esto con n8n."
    assert isinstance(v["faltan"], list) and v["faltan"]
    assert not {"flujo", "grafo", "nodos", "nombre", "resumen", "pendientes"} & set(v)


def test_nunca_viajan_las_llaves_internas():
    prohibidas = {"uso", "modelo", "fuentes", "intentos", "costo_usd", "costo", "ip_hash", "texto",
                  "advertencias_internas", "validador_ok", "motivo", "resultado", "cache_acerto"}
    for muestra in ("correos", "preguntas", "resumen_diario", "sin_cobertura"):
        for despues in (0, 2, 6):
            v = consultar(asistente.crear_id(USUARIO, muestra, T0), T0 + despues)
            assert not prohibidas & set(v), (muestra, despues)
            todas = set(asistente.LLAVES_BASE).union(*asistente.LLAVES_POR_ESTADO.values())
            assert set(v) <= todas


def test_lo_que_se_entrega_es_una_copia(lista):
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 + 6)
    v["flujo"]["name"] = "cambiado"
    v["flujo"]["nodes"].clear()
    v["grafo"]["nodes"].clear()
    v["nodos"].clear()
    v["pendientes"].clear()
    otra = consultar(id_, T0 + 6)
    assert otra["flujo"]["name"] == "Responder correos de clientes" and len(otra["flujo"]["nodes"]) == 5
    assert otra["grafo"]["nodes"] and otra["nodos"] and otra["pendientes"]


def test_los_textos_libres_con_cara_de_clave_se_omiten(lista):
    """El filtro de `validador.SECRETOS` que el modo real necesitará para lo que escriba el modelo: si un
    texto libre parece una clave, ese campo no sale (no se parte ni se tapa: se omite)."""
    clave = "sk-" + "a1" * 15
    m = por_id(lista, "correos")
    sucia = dataclasses.replace(m, resumen=f"Usa la llave {clave}", advertencias=(f"copiaron {clave}",))
    v = asistente.vista(sucia, "p1.x", 7000)
    assert "resumen" not in v and "advertencias" not in v
    assert v["nombre"] == m.flujo["name"] and v["flujo"] and v["pendientes"]
    limpia = asistente.vista(dataclasses.replace(m, advertencias=("un nodo suelto",)), "p1.x", 7000)
    assert limpia["advertencias"] == ["un nodo suelto"] and limpia["resumen"] == m.resumen
    faltan = dataclasses.replace(por_id(lista, "sin_cobertura"), faltan=("falta " + clave,))
    v = asistente.vista(faltan, "p1.x", 7000)
    assert "faltan" not in v and v["mensaje"]
    assert not asistente.sin_clave(clave) and asistente.sin_clave("Conecta tu cuenta de Gmail en n8n.")


# ---------------------------------------------------------------------------
# iniciar

def test_iniciar_elige_la_muestra_y_arma_el_202():
    i = asistente.iniciar("  Quiero responder los correos de mis clientes  ", USUARIO, T0)
    assert (i.muestra, i.chars) == ("correos", len("Quiero responder los correos de mis clientes"))
    assert i.cuerpo == {"id": i.id, "estado": "armando", "modo": "prueba", "paso": "entender",
                        "costo_creditos": 0}
    assert i.id == asistente.crear_id(USUARIO, "correos", T0)


def test_iniciar_no_guarda_el_texto_en_ninguna_parte():
    secreto = "ZORRO-VIOLETA-731 quiero responder correos"
    i = asistente.iniciar(secreto, USUARIO, T0)
    assert "ZORRO" not in repr(i) and "ZORRO" not in i.id
    assert "ZORRO" not in json.dumps(consultar(i.id, T0 + 6))


def test_iniciar_rechaza_lo_que_revisar_texto_rechaza():
    with pytest.raises(asistente.ErrorAsistente) as e:
        asistente.iniciar("hola", USUARIO, T0)
    assert e.value.codigo == "corto"


def test_iniciar_y_consultar_usan_el_reloj_inyectable_por_omision(monkeypatch):
    monkeypatch.setattr(asistente, "reloj", lambda: T0)
    i = asistente.iniciar("Quiero un resumen diario de mis ventas", USUARIO)
    assert asistente.consultar(i.id, USUARIO)["lleva_seg"] == 0
    monkeypatch.setattr(asistente, "reloj", lambda: T0 + 6)
    assert asistente.consultar(i.id, USUARIO)["estado"] == "listo"


# ---------------------------------------------------------------------------
# config

def test_config_en_prueba_es_gratis_y_trae_los_limites_de_publico():
    c = asistente.config(asistente.PRUEBA)
    assert c == {"activo": True, "modo": "prueba", "gratis": True, "costo_creditos": 0,
                 "largo_minimo": freno.LARGO_MINIMO, "largo_maximo": freno.LARGO_MAXIMO, "cupo": None}


@pytest.mark.parametrize("modo_,dice", [(asistente.NO_DISPONIBLE, "no_disponible"), (asistente.REAL, "real")])
def test_config_apagada_cuando_no_es_prueba(modo_, dice):
    c = asistente.config(modo_)
    assert c["activo"] is False and c["modo"] == dice and c["gratis"] is False
    assert c["costo_creditos"] is None and c["cupo"] is None


def test_los_mensajes_son_los_del_publico():
    """Las dos copias de los finales que no son «listo» son las de la página pública: una sola voz."""
    from server import publico_api
    assert asistente.MENSAJES["sin_cobertura"] == publico_api.MENSAJES["sin_cobertura"]
    assert asistente.MENSAJES["no_salio"] == publico_api.MENSAJES["no_salio"]
    assert voseo(" ".join(asistente.MENSAJES.values())) == []


# ---------------------------------------------------------------------------
# revisión del backend · hallazgos arreglados (cada prueba nació fallando)

GOLDEN = RAIZ / "web" / "src" / "pantallas" / "constructor" / "modelo" / "golden" / "flujos.json"
PENDIENTES_TS = RAIZ / "web" / "src" / "pantallas" / "constructor" / "modelo" / "datos" / "pendientes.ts"
SONDEO_TS = RAIZ / "web" / "src" / "nucleo" / "sondeo.ts"


@pytest.mark.parametrize("nombre,id_", [
    ("u: sustituto alto", forjar(u="\ud800")),
    ("u: sustituto bajo", forjar(u="\udfff")),
    ("u: sustituto en medio de doce", forjar(u="ab\ud800cdef01234")),
    ("m: sustituto", forjar(m="\ud800")),
    ("m: válida con sustituto al final", forjar(m="correos\udc00")),
    ("u: un par de sustitutos que json junta en un emoji", forjar(u="😀")),
    ("u: no ASCII", forjar(u="ñ" * 12)),
    ("u: el hash más un carácter", forjar(u=asistente.hash_usuario(USUARIO) + "0")),
    ("u: el hash en mayúsculas con un sustituto", forjar(u=asistente.hash_usuario(USUARIO)[:11] + "\ud800")),
])
def test_un_id_forjado_con_caracteres_raros_es_no_encontrada_y_no_otra_excepcion(lista, nombre, id_):
    """H seg-2 / contrato-4: `hmac.compare_digest(u.encode("utf-8"), …)` reventaba con UnicodeEncodeError."""
    with pytest.raises(asistente.ErrorAsistente) as e:
        asistente.leer_id(id_, USUARIO, T0, lista)
    assert e.value.codigo == "no_encontrada", nombre
    with pytest.raises(asistente.ErrorAsistente):
        asistente.consultar(id_, USUARIO, T0)


def test_el_hash_de_un_usuario_no_revienta_con_un_sustituto():
    assert re.fullmatch(r"[0-9a-f]{12}", asistente.hash_usuario("sub\ud800"))
    assert asistente.hash_usuario("sub\ud800") != asistente.hash_usuario("sub")


# ----- H contrato-1: el flujo de cada muestra ES lo que exporta el Constructor

def diferencias_con_el_constructor(muestras) -> list[str]:
    """Compara el `flujo` de cada muestra «listo» con la exportación del Constructor de su propio grafo:
    `golden/flujos.json` (casos muestra_0..2, que vitest regenera con `construirFlujo(muestras()[i])` y
    compara en cada corrida) sin `settings.timezone`, que el generador real tampoco manda."""
    dorado = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert dorado["zona"] == "UTC"
    exportados = {c["flujo"]["name"]: c["flujo"] for k, c in dorado["casos"].items() if k.startswith("muestra_")}
    assert len(exportados) == 3
    dif = []
    for m in muestras:
        if m.estado != "listo":
            continue
        esperado = copy.deepcopy(exportados.get(m.flujo["name"]))
        if esperado is None:
            dif.append(f"{m.id}: el Constructor no exporta ningún flujo llamado {m.flujo['name']!r}")
            continue
        esperado["settings"].pop("timezone", None)
        if m.flujo != esperado:
            dif.append(f"{m.id}: el flujo no es la exportación del Constructor")
    return dif


def test_el_flujo_de_cada_muestra_es_la_exportacion_que_hace_el_constructor_de_su_grafo(lista):
    assert diferencias_con_el_constructor(lista) == []


def test_ninguna_muestra_nombra_un_modelo_de_claude_que_no_tiene_fuente():
    """D5 del plan: no se fija modelo (n8n usa el suyo). `claude-haiku-5-5` no tiene fuente en el repo."""
    assert "claude-haiku" not in asistente.RUTA_MUESTRAS.read_text(encoding="utf-8")
    for m in asistente.muestras():
        for n in (m.flujo or {}).get("nodes", []):
            if n["type"].endswith("lmChatAnthropic"):
                assert "model" not in n["parameters"], m.id


def test_cada_flujo_tiene_su_propio_webhook_id(lista):
    """El `webhookId` fijo del mockup provocaba choques (la URL del chat es `/webhook/<webhookId>/chat`)."""
    viejo = "6a99b44c-8a80-442b-8e6d-5c49206bc530"
    ids = [n["webhookId"] for m in lista for n in (m.flujo or {}).get("nodes", []) if "webhookId" in n]
    assert ids and viejo not in ids and len(set(ids)) == len(ids)


def _con_cambio(tmp_path, cambio):
    d = doc()
    cambio(d)
    ruta = tmp_path / "muestras.json"
    ruta.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    return asistente.cargar_muestras(ruta)


def _nodo(d, muestra, nombre):
    flujo = next(m for m in d["muestras"] if m["id"] == muestra)["flujo"]
    return next(n for n in flujo["nodes"] if n["name"] == nombre)


@pytest.mark.parametrize("nombre,cambio", [
    ("D02 · un modelo de Claude inventado", lambda d: _nodo(d, "preguntas", "Anthropic Chat Model")["parameters"].update(
        model={"__rl": True, "mode": "id", "value": "claude-modelo-que-no-existe-9"})),
    ("D03 · otro webhookId", lambda d: _nodo(d, "preguntas", "When chat message received").update(
        webhookId="00000000-0000-4000-8000-000000000000")),
    ("DA · otras instrucciones del agente", lambda d: _nodo(d, "preguntas", "Atención")["parameters"]["options"].update(
        systemMessage="Otra cosa distinta de lo que dice el grafo.")),
    ("la tarea del agente de correos", lambda d: _nodo(d, "correos", "Atención por correo")["parameters"].update(
        text="=Haz otra cosa")),
    ("la hora del resumen diario", lambda d: _nodo(d, "resumen_diario", "Schedule Trigger")["parameters"]["rule"][
        "interval"][0].update(triggerAtHour=23)),
    ("un nodo de más", lambda d: next(m for m in d["muestras"] if m["id"] == "correos")["flujo"]["nodes"].append(
        {"parameters": {}, "id": "ffffffff-0000-4000-8000-000000000000", "name": "Merge",
         "type": "n8n-nodes-base.merge", "typeVersion": 3.2, "position": [0, 0]})),
])
def test_el_flujo_que_se_aparta_de_la_exportacion_del_constructor_se_nota(tmp_path, nombre, cambio):
    """Mutaciones del hallazgo: antes sobrevivían las tres (274 passed)."""
    assert diferencias_con_el_constructor(_con_cambio(tmp_path, cambio)) != [], nombre


# ----- H contrato-3: el grafo se valida en Python con las reglas de `invariantesDelGrafo`

def _grafo(muestra="correos"):
    return copy.deepcopy(por_id(asistente.muestras(), muestra).grafo)


def test_el_grafo_de_las_tres_muestras_cumple_los_invariantes_del_constructor():
    for id_ in ("correos", "preguntas", "resumen_diario"):
        assert asistente.invariantes_del_grafo(_grafo(id_)) == [], id_


def _arista(g, i, de, a, tipo):
    g["edges"].append({"id": f"e{i}", "de": de, "a": a, "tipo": tipo})
    return g


def _nodo_g(g, id_, kind, **extra):
    base = {"id": id_, "kind": kind, "x": 100, "y": 100}
    base.update({"trigger": {"tipo": "tiempo", "frec": "dia", "ruta": "", "app": "gmail"},
                 "agent": {"nombre": "A", "ia": "openai", "tarea": "", "instrucciones": ""},
                 "app": {"nombre": "Slack"}}[kind])
    g["nodes"].append({**base, **extra})
    return g


CAMBIOS_DEL_GRAFO = [
    ("DD · un segundo disparador", lambda g: _nodo_g(g, "t9", "trigger"), "varios-disparadores"),
    ("DE · una herramienta que sale de una app", lambda g: _arista(_nodo_g(g, "p9", "app"), 90, "p1", "p9", "tool"),
     "herramienta-de-no-agente"),
    ("DF · un círculo de pasos", lambda g: _arista(g, 91, "p2", "a1", "seq"), "ciclo-de-pasos"),
    ("un círculo entre pasos y herramientas", lambda g: _arista(g, 97, "p1", "a1", "seq"), "ciclo-mixto"),
    ("5 agentes", lambda g: [_nodo_g(g, f"a{i}", "agent") for i in range(7, 12)] and g, "tope-agentes"),
    ("9 apps", lambda g: [_nodo_g(g, f"p{i}", "app") for i in range(20, 29)] and g, "tope-apps"),
    ("ids de cuadros repetidos", lambda g: g["nodes"].append(dict(g["nodes"][0])), "ids-nodos-duplicados"),
    ("ids de conexiones repetidos", lambda g: g["edges"].append(dict(g["edges"][0])), "ids-aristas-duplicados"),
    ("una conexión huérfana", lambda g: _arista(g, 92, "a1", "fantasma", "seq"), "arista-huerfana"),
    ("algo llega al disparador", lambda g: _arista(g, 93, "a1", "t1", "seq"), "llega-al-disparador"),
    ("una conexión a sí misma", lambda g: _arista(g, 94, "a1", "a1", "seq"), "arista-a-si-mismo"),
    ("un tipo de conexión inventado", lambda g: _arista(g, 95, "a1", "p1", "doble"), "arista-tipo-invalido"),
    ("una herramienta y además un paso", lambda g: _arista(g, 96, "p1", "p2", "seq"), "herramienta-y-paso"),
    ("una herramienta con dos padres", lambda g: _arista(_nodo_g(g, "a8", "agent"), 98, "a8", "p1", "tool"),
     "herramienta-con-varios-padres"),
    ("un ayudante al que además le llega un paso", lambda g: _arista(_arista(_nodo_g(g, "a8", "agent"), 98, "a1", "a8", "tool"),
                                                                     99, "t1", "a8", "seq"),
     "ayudante-con-paso-entrante"),
    ("una conexión repetida", lambda g: g["edges"].append({**g["edges"][0], "id": "e77"}), "arista-duplicada"),
    ("un cuadro fuera del lienzo", lambda g: g["nodes"][0].update(x=2401), "caja-fuera-del-lienzo"),
    ("un cuadro con x negativa", lambda g: g["nodes"][0].update(x=-1), "caja-fuera-del-lienzo"),
    ("un cuadro con x que no es número", lambda g: g["nodes"][0].update(x="10"), "caja-no-finita"),
    ("un cuadro con x booleana", lambda g: g["nodes"][0].update(x=True), "caja-no-finita"),
    ("un cuadro sin id", lambda g: g["nodes"][0].pop("id"), "nodo-malformado"),
    ("un cuadro de un tipo que no existe", lambda g: g["nodes"][0].update(kind="robot"), "nodo-malformado"),
    ("cuadros que no son lista", lambda g: g.update(nodes={}), "nodos-no-es-lista"),
    ("conexiones que no son lista", lambda g: g.update(edges=None), "aristas-no-es-lista"),
]


@pytest.mark.parametrize("nombre,cambio,codigo", CAMBIOS_DEL_GRAFO, ids=[c[0] for c in CAMBIOS_DEL_GRAFO])
def test_el_validador_del_grafo_ve_lo_que_el_del_constructor_ve(nombre, cambio, codigo):
    g = _grafo("correos")
    cambio(g)
    assert codigo in {v.split(":")[0] for v in asistente.invariantes_del_grafo(g)}, nombre


@pytest.mark.parametrize("nombre,cambio,codigo", CAMBIOS_DEL_GRAFO, ids=[c[0] for c in CAMBIOS_DEL_GRAFO])
def test_una_muestra_con_el_grafo_roto_no_se_carga(tmp_path, nombre, cambio, codigo):
    """Con y sin node: antes solo se pedían las llaves `nodes`, `edges` y `nombreFlujo`."""
    def en_el_archivo(d):
        cambio(next(m for m in d["muestras"] if m["id"] == "correos")["grafo"])
    with pytest.raises(asistente.MuestrasInvalidas):
        _con_cambio(tmp_path, en_el_archivo)


def test_una_muestra_cuyo_grafo_se_llama_distinto_que_su_flujo_no_se_carga(tmp_path):
    def renombra(d):
        next(m for m in d["muestras"] if m["id"] == "correos")["grafo"]["nombreFlujo"] = "Otro flujo"
    with pytest.raises(asistente.MuestrasInvalidas):
        _con_cambio(tmp_path, renombra)


def test_el_grafo_no_lleva_nada_que_parezca_una_clave_ni_texto_enorme():
    for m in asistente.muestras():
        if m.grafo:
            assert asistente.sin_clave(json.dumps(m.grafo, ensure_ascii=False)), m.id


def test_una_muestra_con_una_clave_en_el_grafo_no_se_carga(tmp_path):
    """DG del hallazgo: la clave en el grafo ya moría; se deja fijada."""
    def pon(d):
        next(m for m in d["muestras"] if m["id"] == "correos")["grafo"]["nodes"][1]["instrucciones"] = "sk-" + "a" * 30
    with pytest.raises(asistente.MuestrasInvalidas):
        _con_cambio(tmp_path, pon)


# ----- H contrato-3 (sin node): el grafo está fijado por su huella

def test_la_huella_del_grafo_de_cada_muestra_es_la_conocida():
    """Sin node no se puede comparar con `ejemplos.ts`; esto avisa si alguien edita el grafo en el JSON sin
    regenerar el flujo (DL del hallazgo: `frec: 'lunes'` con un flujo diario). Si el grafo cambia a
    propósito: regenera el flujo con el exportador (vitest actualiza golden/flujos.json), compara arriba y
    actualiza esta huella. La comparación exacta con `ejemplos.ts` corre donde hay node."""
    import hashlib
    huellas = {m.id: hashlib.sha256(json.dumps(m.grafo, sort_keys=True, separators=(",", ":"),
                                               ensure_ascii=True).encode("ascii")).hexdigest()[:16]
               for m in asistente.muestras() if m.grafo}
    assert huellas == HUELLAS_DE_GRAFOS


HUELLAS_DE_GRAFOS = {"correos": "e850049c7bead4da", "preguntas": "523781f9f7e09489",
                     "resumen_diario": "9c8a45dc7d5f42db"}


def test_un_cambio_en_el_grafo_cambia_la_huella(tmp_path):
    import hashlib
    antes = por_id(asistente.muestras(), "resumen_diario").grafo

    def lunes(d):
        next(m for m in d["muestras"] if m["id"] == "resumen_diario")["grafo"]["nodes"][0]["frec"] = "lunes"
    despues = por_id(_con_cambio(tmp_path, lunes), "resumen_diario").grafo
    h = lambda g: hashlib.sha256(json.dumps(g, sort_keys=True).encode()).hexdigest()    # noqa: E731
    assert h(antes) != h(despues)


# ----- H contrato-2: los avisos que da el Constructor para el mismo flujo

def avisos_del_constructor(clave):
    return json.loads(GOLDEN.read_text(encoding="utf-8"))["casos"][clave]["avisos"]


def test_el_chat_publico_se_avisa_igual_que_en_el_constructor(lista):
    p = por_id(lista, "preguntas")
    assert asistente.ADVERTENCIA_CHAT_PUBLICO in avisos_del_constructor("muestra_1")
    assert asistente.ADVERTENCIA_CHAT_PUBLICO in p.advertencias
    assert asistente.ADVERTENCIA_CHAT_PUBLICO in consultar(asistente.crear_id(USUARIO, "preguntas", T0), T0 + 6)["advertencias"]
    for otra in ("correos", "resumen_diario"):
        assert asistente.ADVERTENCIA_CHAT_PUBLICO not in por_id(lista, otra).advertencias


def test_el_aviso_del_chat_publico_sale_del_propio_flujo():
    flujo = {"nodes": [{"name": "x", "type": "n8n-nodes-base.webhook", "parameters": {"public": True}}]}
    assert asistente.advertencias_de(flujo, []) == [asistente.ADVERTENCIA_CHAT_PUBLICO]
    assert asistente.advertencias_de(flujo, ["uno suelto"]) == ["uno suelto", asistente.ADVERTENCIA_CHAT_PUBLICO]
    assert asistente.advertencias_de({"nodes": [{"parameters": {"public": "true"}}, {"parameters": None}, {}]}, []) == []
    assert asistente.advertencias_de({}, []) == []


def test_lo_que_hay_que_elegir_es_lo_mismo_que_dice_el_constructor():
    """Paridad con `datos/pendientes.ts` (la tabla PEND del mockup): mismas apps, mismas frases."""
    ts = PENDIENTES_TS.read_text(encoding="utf-8")
    del_constructor = dict(re.findall(r"\['([^']+)',\s*'([^']+)'\]", ts))
    assert len(del_constructor) == 10
    mias = {nombre: elegir for nombre, elegir in asistente.APPS_DE_N8N.values()}
    assert mias == del_constructor
    for tipo in asistente.APPS_DE_N8N:
        assert asistente.n8n_catalogo.revisar(tipo).ok, tipo


def test_los_avisos_del_constructor_dicen_lo_mismo_que_los_pendientes_de_la_api(lista):
    """Cada «Al abrir «X» … elegir Y» del Constructor tiene su «elige Y» en `pendientes`."""
    for clave, id_ in (("muestra_0", "correos"), ("muestra_1", "preguntas"), ("muestra_2", "resumen_diario")):
        for aviso in avisos_del_constructor(clave):
            hallado = re.fullmatch(r"Al abrir «(.+)» en n8n tendrás que conectar tu cuenta y elegir (.+)\.", aviso)
            if hallado:
                nombre, elegir = hallado.groups()
                assert f"Conecta tu cuenta de {nombre} en n8n y elige {elegir}." in por_id(lista, id_).pendientes, aviso


def test_pendientes_de_junta_lo_que_se_elige_por_cuenta_sin_repetir():
    flujo = {"nodes": [
        {"type": "n8n-nodes-base.gmailTrigger", "credentials": {"gmailOAuth2": {"name": "Gmail"}}},
        {"type": "n8n-nodes-base.gmail", "credentials": {"gmailOAuth2": {"name": "Gmail"}}},
        {"type": "n8n-nodes-base.gmail", "credentials": {"gmailOAuth2": {"name": "Gmail"}}},
        {"type": "n8n-nodes-base.googleSheetsTool", "credentials": {"x": {"name": "Google Sheets"}}},
        {"type": "n8n-nodes-base.noExiste", "credentials": {"y": {"name": "Otra"}}},
    ]}
    assert asistente.pendientes_de(flujo) == [
        "Conecta tu cuenta de Gmail en n8n y elige el destinatario.",
        "Conecta tu cuenta de Google Sheets en n8n y elige el documento y la hoja.",
        "Conecta tu cuenta de Otra en n8n."]


# ----- H contrato-7: etiquetas en español y el nombre del nodo en el flujo

def test_cada_nodo_trae_una_etiqueta_en_espanol_y_el_nombre_que_tiene_en_el_flujo(lista):
    for m in lista:
        if m.estado != "listo":
            continue
        assert [n["nombre_en_flujo"] for n in m.nodos] == [n["name"] for n in m.flujo["nodes"]]
        for n in m.nodos:
            assert set(n) == {"tipo", "nombre", "etiqueta", "nombre_en_flujo"}
            assert n["etiqueta"] and n["etiqueta"] != n["nombre"], (m.id, n)
        etiquetas = [n["etiqueta"] for n in m.nodos]
        assert len(set(zip(etiquetas, [n["nombre_en_flujo"] for n in m.nodos]))) == len(etiquetas)
    assert [n["etiqueta"] for n in por_id(lista, "correos").nodos] == [
        "Llega un correo (Gmail)", "Agente de IA", "Modelo de IA (OpenAI)", "Google Sheets (lo consulta el agente)",
        "Gmail (paso)"]
    assert [n["nombre_en_flujo"] for n in por_id(lista, "preguntas").nodos if n["nombre"] == "AI Agent"] == [
        "Atención", "Revisor"]


def test_todo_nodo_permitido_tiene_su_etiqueta_en_espanol():
    """Si alguien permite un nodo nuevo y no le pone etiqueta, la persona vería el nombre en inglés."""
    for tipo, entrada in n8n_catalogo.permitidos().items():
        e = asistente.etiqueta_de_nodo(tipo)
        assert e and e != entrada["nombre"], tipo
    assert asistente.etiqueta_de_nodo("n8n-nodes-base.slackTool") == "Slack (lo consulta el agente)"
    assert asistente.etiqueta_de_nodo("n8n-nodes-base.noExiste") == "noExiste"


# ----- H contrato-8: el reloj de la prueba y la escalera de sondeo de la web

def escalera_de_la_web() -> list[int]:
    m = re.search(r"export const ESCALERA = \[([\d_,\s]+)\]", SONDEO_TS.read_text(encoding="utf-8"))
    assert m, "web/src/nucleo/sondeo.ts ya no declara ESCALERA así"
    return [int(x.replace("_", "")) for x in m.group(1).split(",") if x.strip()]


def test_el_primer_sondeo_de_la_web_ya_ve_el_resultado():
    """La web sondea a los 5 s (ESCALERA[0]); con 6 s de espera el primer sondeo veía «revisar» y el listo
    aparecía a los 10 s. La espera de la prueba tiene que caber en el primer sondeo."""
    primero = escalera_de_la_web()[0]
    assert asistente.DURACION_MS <= primero - 100, (asistente.DURACION_MS, primero)
    id_ = asistente.crear_id(USUARIO, "correos", T0)
    v = consultar(id_, T0 + primero / 1000)
    assert v["estado"] == "listo" and v["listo"] is True


# ----- H seg-3 / contrato-9: el estado «no disponible» no se hace pasar por «real»

def test_config_distingue_el_modo_real_del_que_no_esta_disponible():
    assert asistente.config(asistente.NO_DISPONIBLE)["modo"] == "no_disponible"
    assert asistente.config(asistente.REAL)["modo"] == "real"
    assert asistente.config(asistente.PRUEBA)["modo"] == "prueba"
    assert set(asistente.MODOS) == {"prueba", "real", "no_disponible"}
