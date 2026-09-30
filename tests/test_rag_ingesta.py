"""RAG·19 — la ingesta de la documentación de n8n, sin red y sin gastar.

Se arma aquí un clon de mentira de n8n-docs con la misma forma que el real
(frontmatter y etiquetas de GitBook, carpetas por nodo, credenciales
compartidas), y el embebido y S3 Vectors son objetos que solo anotan."""
import json

import pytest

from infra import entornos
from pipeline import n8n_catalogo, vectores
from tools import ingesta

B = "n8n-nodes-base."
URL = ingesta.URL_DOCS + "integrations/builtin/"


def _md(titulo, cuerpo):
    return f"---\ntitle: {titulo}\ndescription: x\n---\n\n{cuerpo}\n"


@pytest.fixture
def docs(tmp_path, monkeypatch):
    raiz = tmp_path / "docs"
    b = raiz / "docs" / "integrations" / "builtin"
    (b / "core-nodes").mkdir(parents=True)
    (b / "core-nodes" / "n8n-nodes-base.if.md").write_text(_md("If", (
        "# If <a href=\"#if\" id=\"if\"></a>\n\nUse the If node.\n\n"
        "{% hint style=\"info\" %}\nA hint.\n{% endhint %}\n\n"
        "## Conditions <a href=\"#c\" id=\"c\"></a>\n\n" + "Compare values. " * 60 + "\n\n"
        "```js\n# not a heading\n```\n\n"
        "{% include \"https://app.gitbook.com/s/x/~/reusable/y/\" %}\n"
        "{% @n8n-blocks/n8n-workflow-demo content=\"%7B%22nodes%22\" %}\n")), encoding="utf-8")
    hoja = b / "app-nodes" / "n8n-nodes-base.googlesheets"
    hoja.mkdir(parents=True)
    (hoja / "README.md").write_text(_md("Google Sheets", (
        "# Google Sheets\n\nRefer to [Google credentials](../../credentials/google/README.md).\n\n"
        "## Operations\n\n" + "Append a row. " * 40)), encoding="utf-8")
    (hoja / "sheet-operations.md").write_text(_md("Sheet operations", (
        "# Sheet operations\n\n## Append row\n\n" + ("Long paragraph. " * 300 + "\n\n") * 3)),
        encoding="utf-8")
    gmail = b / "app-nodes" / "n8n-nodes-base.gmail"
    gmail.mkdir(parents=True)
    (gmail / "README.md").write_text(_md("Gmail", (
        "# Gmail\n\nRefer to [Google credentials](../../credentials/google/README.md).\n\n"
        "## Operations\n\n" + "Send an email. " * 40)), encoding="utf-8")
    cred = b / "credentials" / "google"
    cred.mkdir(parents=True)
    (cred / "README.md").write_text(_md("Google credentials", "# Google\n\n" + "OAuth. " * 100),
                                    encoding="utf-8")

    cat = json.loads(json.dumps(n8n_catalogo.catalogo()))
    cat["nodos"][B + "if"]["doc"] = URL + "core-nodes/n8n-nodes-base.if/"
    cat["nodos"][B + "googleSheets"]["doc"] = URL + "app-nodes/n8n-nodes-base.googlesheets/"
    cat["nodos"][B + "googleSheets"]["doc_credencial"] = URL + "credentials/google/"
    cat["nodos"][B + "gmail"]["doc"] = URL + "app-nodes/n8n-nodes-base.gmail/"
    cat["nodos"][B + "gmail"]["doc_credencial"] = None
    cat["nodos"][B + "telegram"]["doc"] = URL + "app-nodes/n8n-nodes-base.telegram/"   # no está
    monkeypatch.setattr(n8n_catalogo, "catalogo", lambda: cat)
    monkeypatch.setattr(ingesta, "commit", lambda d: "abc123")
    return raiz


TIPOS = [B + "if", B + "googleSheets", B + "gmail", B + "telegram"]


# ---------------------------------------------------------------------------
# limpiar y trocear

def test_limpiar_quita_gitbook():
    texto, titulo = ingesta.limpiar(_md("If", (
        "# If <a href=\"#if\" id=\"if\"></a>\n{% hint style=\"info\" %}\nOjo\n{% endhint %}\n"
        "{% include \"https://x\" %}\n{% @n8n-blocks/n8n-workflow-demo content=\"%7B\"\nurl=\"u\" %}\n"
        "![img](a.png)\n{% tabs %}{% tab title=\"A\" %}a{% endtab %}{% endtabs %}")))
    assert titulo == "If"
    assert "{%" not in texto and "<a href" not in texto and "%7B" not in texto and "![" not in texto
    assert "# If" in texto and "Ojo" in texto


def test_un_comentario_en_codigo_no_es_encabezado():
    secs = ingesta._secciones("# A\n\nx\n\n```\n# no\n```\n\n## B\n\ny")
    assert [r for r, _ in secs] == [["A"], ["A", "B"]]
    assert "# no" in secs[0][1]


def test_partir_respeta_el_tope():
    partes = ingesta._partir(("p " * 400 + "\n\n") * 10, 1000)
    assert all(len(p) <= 1000 for p in partes) and len(partes) > 5
    assert ingesta._partir("x" * 2500, 1000) == ["x" * 1000, "x" * 1000, "x" * 500]


def test_archivos_de_url_con_punto_en_el_nombre(docs):
    # «n8n-nodes-base.if» no se puede partir en el punto (with_suffix)
    [p] = ingesta._archivos_de_url(docs, URL + "core-nodes/n8n-nodes-base.if/")
    assert p.name == "n8n-nodes-base.if.md"
    carpeta = ingesta._archivos_de_url(docs, URL + "app-nodes/n8n-nodes-base.googlesheets/")
    assert [p.name for p in carpeta] == ["README.md", "sheet-operations.md"]
    assert ingesta._archivos_de_url(docs, None) == []
    assert ingesta._archivos_de_url(docs, "https://otro.sitio/x") == []


def test_la_credencial_compartida_es_una_sola_pagina_con_sus_nodos(docs):
    mapa, sin_docs = ingesta.paginas(docs, TIPOS)
    cred = [(p, d) for p, d in mapa.items() if "credentials" in str(p)]
    assert len(cred) == 1
    assert cred[0][1] == {"nodos": [B + "googleSheets", B + "gmail"], "tipo": "credencial"}
    assert sin_docs == [B + "telegram"]


def test_trozos(docs):
    trozos, sin_docs = ingesta.trozos_de(docs, TIPOS)
    claves = [t.clave for t in trozos]
    assert len(claves) == len(set(claves))
    assert all(len(t.texto) <= ingesta.MAX_CARACTERES for t in trozos)
    # la sección grande se partió, y sus claves son de la misma sección
    partes = [c for c in claves if "sheet-operations.md#append-row#" in c]
    assert len(partes) >= 2 and partes[0].endswith("#0")
    t = next(t for t in trozos if t.clave.startswith("integrations/builtin/core-nodes/n8n-nodes-base.if.md#"))
    assert t.texto.startswith("n8n docs — If")
    assert t.metadatos == {"fuente": "n8n-docs", "docs_commit": "abc123",
                           "version_n8n": n8n_catalogo.catalogo()["procedencia"]["n8n"],
                           "idioma": "en", "nodos": [B + "if"], "tipo": "nodo",
                           "titulo": "If", "url": URL + "core-nodes/n8n-nodes-base.if/"}
    readme = next(t for t in trozos if "googlesheets/README.md" in t.clave)
    assert readme.metadatos["url"] == URL + "app-nodes/n8n-nodes-base.googlesheets/"


def test_mismas_paginas_mismas_claves(docs):
    a, _ = ingesta.trozos_de(docs, TIPOS)
    b, _ = ingesta.trozos_de(docs, TIPOS)
    assert [t.clave for t in a] == [t.clave for t in b]


def test_resumen(docs):
    trozos, sin = ingesta.trozos_de(docs, TIPOS)
    r = ingesta.resumen(trozos, sin)
    assert r["trozos"] == len(trozos) and r["paginas"] == 5
    assert r["tokens"] == sum(ingesta.tokens(t.texto) for t in trozos)
    assert r["por_nodo"][B + "gmail"] >= 2 and r["sin_docs"] == [B + "telegram"]


# ---------------------------------------------------------------------------
# subir: embebe como DOCUMENTO y guarda con pipeline.vectores

class _S3V:
    def __init__(self):
        self.lotes = []

    def put_vectors(self, **kw):
        self.lotes.append(kw)


def test_subir(docs, monkeypatch):
    trozos, _ = ingesta.trozos_de(docs, TIPOS)
    pedidos = []

    def embeber(textos, tarea):
        pedidos.append(tarea)
        return [[0.1] * vectores.DIMENSION for _ in textos]
    s3v = _S3V()
    monkeypatch.delenv("VECTORES_BUCKET", raising=False)
    assert ingesta.subir(trozos, entornos.DEV, embeber=embeber, s3v=s3v) == len(trozos)
    assert pedidos == ["documento"]
    [lote] = s3v.lotes
    assert (lote["vectorBucketName"], lote["indexName"]) == (
        entornos.DEV.vectores_bucket, entornos.DEV.vectores_indice)
    v = lote["vectors"][0]
    assert v["metadata"]["texto"] == trozos[0].texto
    for x in lote["vectors"]:
        m = x["metadata"]
        assert len(m) <= 10                                   # tope de llaves de S3 Vectors
        filtrables = {k: m[k] for k in m if k not in vectores.NO_FILTRABLES}
        assert len(json.dumps(filtrables).encode()) < 2048    # tope de metadatos filtrables


def test_la_clave_sale_de_ssm_publico(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY_PUBLICO", raising=False)
    pedidas = []

    class _SSM:
        def get_parameter(self, Name, WithDecryption):
            pedidas.append((Name, WithDecryption))
            return {"Parameter": {"Value": "secreto"}}
    import boto3
    monkeypatch.setattr(boto3, "client", lambda s: _SSM())
    ingesta._clave_gemini(entornos.DEV)
    assert pedidas == [(entornos.DEV.ssm_publico + "/GEMINI_API_KEY", True)]
    import os
    assert os.environ["GEMINI_API_KEY_PUBLICO"] == "secreto"


# ---------------------------------------------------------------------------
# la línea de comandos: sin --confirmar no sale nada de la máquina

@pytest.fixture
def cli(docs, monkeypatch):
    monkeypatch.setattr(ingesta, "asegurar_docs", lambda d, a: None)
    subidas = []
    monkeypatch.setattr(ingesta, "subir", lambda t, e, **kw: subidas.append(len(t)) or len(t))
    return subidas


def test_ensayo_no_sube(docs, cli, capsys):
    assert ingesta.main(["--docs", str(docs), "ensayo"]) == 0
    assert cli == []
    out = capsys.readouterr().out
    assert "Tokens a embeber" in out and "sin precio confirmado" in out and "centavos" not in out


def test_subir_sin_confirmar_es_ensayo(docs, cli, capsys):
    assert ingesta.main(["--docs", str(docs), "subir"]) == 0
    assert cli == [] and "--confirmar" in capsys.readouterr().out


def test_subir_confirmado_solo_lo_pedido(docs, cli):
    assert ingesta.main(["--docs", str(docs), "--solo", B + "if", "subir", "--confirmar"]) == 0
    assert len(cli) == 1 and cli[0] >= 1


def test_solo_acepta_permitidos(docs, cli):
    with pytest.raises(SystemExit, match="hubspot"):
        ingesta.main(["--docs", str(docs), "--solo", B + "hubspot", "ensayo"])


def test_prod_todavia_no(docs, cli):
    with pytest.raises(SystemExit, match="RAG·30"):
        ingesta.main(["--entorno", "prod", "--docs", str(docs), "ensayo"])


def test_no_hay_comando_para_borrar():
    assert "delete_" not in open("tools/ingesta.py", encoding="utf-8").read()
