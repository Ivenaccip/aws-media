"""RAG·17 — el almacén vectorial en S3 Vectors.

Sin red: el cliente es un boto3 real con botocore.Stubber, así que cada
llamada se valida contra el modelo del servicio que trae el boto3 fijado (un
parámetro mal escrito falla aquí, no en la cuenta). La infra (solo dev, y solo
lectura para el worker) se vigila en tests/test_entornos.py."""
import pytest

boto3 = pytest.importorskip("boto3")
from botocore.stub import ANY, Stubber  # noqa: E402

from infra import entornos  # noqa: E402
from pipeline import vectores  # noqa: E402
from tools import vectores as herramienta  # noqa: E402

BUCKET, INDICE = entornos.DEV.vectores_bucket, entornos.DEV.vectores_indice


@pytest.fixture
def s3v():
    c = boto3.client("s3vectors", region_name="us-east-1",
                     aws_access_key_id="x", aws_secret_access_key="x")
    with Stubber(c) as st:
        c.st = st
        yield c
        st.assert_no_pending_responses()


@pytest.fixture
def configurado(monkeypatch):
    monkeypatch.setenv("VECTORES_BUCKET", BUCKET)
    monkeypatch.setenv("VECTORES_INDICE", INDICE)


def _vec(x=0.1):
    return [x] * vectores.DIMENSION


def _indice(**cambios):
    i = {"vectorBucketName": BUCKET, "indexName": INDICE,
         "indexArn": f"arn:aws:s3vectors:us-east-1:123:bucket/{BUCKET}/index/{INDICE}",
         "creationTime": "2026-09-30T00:00:00Z",
         "dataType": "float32", "dimension": vectores.DIMENSION,
         "distanceMetric": vectores.METRICA,
         "metadataConfiguration": {"nonFilterableMetadataKeys": list(vectores.NO_FILTRABLES)}}
    i.update(cambios)
    return {"index": i}


def _no_existe(c, op):
    c.st.add_client_error(op, service_error_code="NotFoundException", http_status_code=404)


# ---------------------------------------------------------------------------
# lo que no se puede cambiar después

def test_la_configuracion_fijada():
    """Cambiar cualquiera de estas es un índice NUEVO (n8n-docs-v2), nunca
    pisar el que hay. Si este test falla, lee el docstring de pipeline/vectores.py."""
    assert vectores.DIMENSION == 1024
    assert vectores.METRICA == "cosine"
    assert vectores.TIPO_DATO == "float32"
    assert "texto" in vectores.NO_FILTRABLES
    assert INDICE.endswith("-v1")


def test_dev_tiene_indice_y_prod_todavia_no():
    assert entornos.PROD.vectores_bucket is None and entornos.PROD.vectores_indice is None
    assert BUCKET and INDICE
    assert BUCKET != entornos.PROD.vectores_bucket


# ---------------------------------------------------------------------------
# pipeline/vectores.py

def test_sin_configurar_no_habla_con_aws(monkeypatch):
    monkeypatch.delenv("VECTORES_BUCKET", raising=False)
    monkeypatch.delenv("VECTORES_INDICE", raising=False)
    assert not vectores.configurado()
    with pytest.raises(vectores.VectoresSinConfigurar):
        vectores.consultar(_vec(), s3v=object())


@pytest.mark.parametrize("malo", [
    [0.1] * 3, [0.0] * vectores.DIMENSION, [float("nan")] + [0.1] * (vectores.DIMENSION - 1)])
def test_vectores_invalidos_se_paran_antes(malo, configurado):
    with pytest.raises(vectores.VectorInvalido):
        vectores.consultar(malo, s3v=object())


def test_k_fuera_de_rango(configurado):
    for k in (0, vectores.K_MAXIMO + 1):
        with pytest.raises(ValueError):
            vectores.consultar(_vec(), k=k, s3v=object())


def test_consultar(s3v, configurado):
    s3v.st.add_response("query_vectors", {
        "vectors": [{"key": "a", "distance": 0.1, "metadata": {"texto": "hola", "tipo": "nodo"}},
                    {"key": "b"}],
        "distanceMetric": "cosine"},
        {"vectorBucketName": BUCKET, "indexName": INDICE, "topK": 5,
         "queryVector": {"float32": ANY}, "filter": {"tipo": "nodo"},
         "returnMetadata": True, "returnDistance": True})
    r = vectores.consultar(_vec(), k=5, filtro={"tipo": "nodo"}, s3v=s3v)
    assert [x.clave for x in r] == ["a", "b"]
    assert r[0].metadatos["texto"] == "hola" and r[0].distancia == 0.1
    assert r[1].metadatos == {} and r[1].distancia is None


def test_guardar_en_lotes(s3v, configurado):
    trozos = [vectores.Trozo(f"k{i}", _vec(), {"texto": "t"}) for i in range(vectores.LOTE_MAXIMO + 1)]
    for n in (vectores.LOTE_MAXIMO, 1):
        s3v.st.add_response("put_vectors", {},
                            {"vectorBucketName": BUCKET, "indexName": INDICE, "vectors": ANY})
    assert vectores.guardar(trozos, s3v=s3v) == vectores.LOTE_MAXIMO + 1


def test_guardar_valida_todo_antes_del_primer_lote(configurado):
    trozos = [vectores.Trozo("bien", _vec()), vectores.Trozo("mal", [1.0])]
    with pytest.raises(vectores.VectorInvalido):
        vectores.guardar(trozos, s3v=object())   # object(): si llamara, revienta
    with pytest.raises(ValueError, match="repetidas"):
        vectores.guardar([vectores.Trozo("a", _vec()), vectores.Trozo("a", _vec())], s3v=object())


# ---------------------------------------------------------------------------
# tools/vectores.py

def _crear_esperado(c):
    c.st.add_response("create_index", {"indexArn": "arn:x"}, {
        "vectorBucketName": BUCKET, "indexName": INDICE, "dataType": "float32",
        "dimension": vectores.DIMENSION, "distanceMetric": vectores.METRICA,
        "metadataConfiguration": {"nonFilterableMetadataKeys": sorted(vectores.NO_FILTRABLES)}})


def test_crear_sin_confirmar_no_crea_nada(s3v):
    _no_existe(s3v, "get_vector_bucket")
    hechos = herramienta.crear(entornos.DEV, False, s3v)
    assert len(hechos) == 2    # y el Stubber no tiene create_*: si llamara, revienta


def test_crear_desde_cero(s3v):
    _no_existe(s3v, "get_vector_bucket")
    s3v.st.add_response("create_vector_bucket", {"vectorBucketArn": "arn:x"}, {
        "vectorBucketName": BUCKET, "encryptionConfiguration": {"sseType": "AES256"},
        "tags": ANY})
    _crear_esperado(s3v)
    assert len(herramienta.crear(entornos.DEV, True, s3v)) == 2


def test_crear_solo_el_indice_si_el_bucket_ya_esta(s3v):
    s3v.st.add_response("get_vector_bucket", {"vectorBucket": {
        "vectorBucketName": BUCKET, "vectorBucketArn": "arn:x", "creationTime": "2026-09-30T00:00:00Z"}})
    _no_existe(s3v, "get_index")
    _crear_esperado(s3v)
    assert len(herramienta.crear(entornos.DEV, True, s3v)) == 1


def test_crear_es_idempotente(s3v):
    s3v.st.add_response("get_vector_bucket", {"vectorBucket": {
        "vectorBucketName": BUCKET, "vectorBucketArn": "arn:x", "creationTime": "2026-09-30T00:00:00Z"}})
    s3v.st.add_response("get_index", _indice())
    assert herramienta.crear(entornos.DEV, True, s3v) == []


def test_crear_se_niega_si_el_indice_existe_distinto(s3v):
    s3v.st.add_response("get_vector_bucket", {"vectorBucket": {
        "vectorBucketName": BUCKET, "vectorBucketArn": "arn:x", "creationTime": "2026-09-30T00:00:00Z"}})
    s3v.st.add_response("get_index", _indice(dimension=512))
    with pytest.raises(herramienta.Distinto, match="dimension"):
        herramienta.crear(entornos.DEV, True, s3v)


def test_prod_no_tiene_almacen_y_no_habla_con_aws():
    with pytest.raises(SystemExit, match="RAG·30"):
        herramienta.main(["--entorno", "prod", "estado"], s3v=object())


def test_estado(s3v, capsys):
    s3v.st.add_response("get_vector_bucket", {"vectorBucket": {
        "vectorBucketName": BUCKET, "vectorBucketArn": "arn:x", "creationTime": "2026-09-30T00:00:00Z"}})
    s3v.st.add_response("get_index", _indice())
    assert herramienta.main(["estado"], s3v=s3v) == 0
    assert "1024 dimensiones" in capsys.readouterr().out


def test_no_hay_comando_para_borrar():
    texto = open("tools/vectores.py", encoding="utf-8").read()
    assert "delete_" not in texto
