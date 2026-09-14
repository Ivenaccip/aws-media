"""Cómo entra Node en la imagen, y por qué no puede volver a entrar como entraba.

El 2026-09-14 un build falló con `npm: not found` en un Dockerfile que llevaba
86 imágenes construidas sin tocarse. La cadena fue esta:

    curl: (56) Recv failure: Connection reset by peer
    Error: Failed to download and import the NodeSource signing key (Exit Code: 0)
    ...
    Setting up nodejs (18.20.4+dfsg-1~deb12u2) ...

El script de NodeSource informa de sus fallos y **sale con cero**, así que el
`&&` que lo seguía siguió corriendo y apt instaló el nodejs de Debian en vez del
20.x de NodeSource. En Debian npm es un paquete aparte y solo «recomendado»; con
--no-install-recommends no entró, y el build murió cuatro pasos más allá.

Que muriera fue la suerte. Si npm hubiera entrado igualmente, la imagen se
habría construido entera con Node 18 —Remotion 4 arranca en 18— y la versión de
Node de producción habría dependido de si una descarga de un tercero funcionaba
ese día. Eso es lo que estos tests impiden que vuelva.

No hablan con Docker ni con la red: leen dos archivos de texto. El CI los corre
en su primer paso, antes del build, para fallar en segundos en vez de en
minutos; por eso no pueden importar nada del proyecto (corren --noconftest).
"""
import re
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
DOCKERFILE = RAIZ / "Dockerfile"
WF_PATH = RAIZ / ".github" / "workflows" / "docker.yml"

# Los comentarios del Dockerfile citan el patrón viejo para explicar por qué se
# fue — mirar el archivo entero daría por rota una regla que precisamente se
# está documentando. Estos tests leen instrucciones, no prosa.
CODIGO = "\n".join(l for l in DOCKERFILE.read_text(encoding="utf-8").splitlines()
                   if not l.lstrip().startswith("#"))


def test_node_no_llega_por_un_script_remoto_canalizado_a_bash():
    """`curl … | bash -` no puede fallar de forma ruidosa.

    Con un pipe, el código de salida de la línea es el de `bash`, no el de
    `curl`; y aquí ni siquiera hizo falta esa sutileza, porque el script de
    NodeSource devolvió cero por su cuenta después de anunciar el error.
    """
    sospechoso = re.search(r"curl[^\n]*\|\s*bash", CODIGO)
    assert sospechoso is None, (
        f"vuelve el patrón que rompió el build del 2026-09-14: "
        f"«{sospechoso.group(0) if sospechoso else ''}»")


def test_la_version_de_node_esta_fijada_a_una_version_exacta():
    """El objetivo no es «tener Node»: es tener SIEMPRE el mismo Node.

    Un tag flotante (`node:20-bookworm-slim`) cambia bajo los pies entre dos
    builds del mismo commit, que es justo la propiedad que se perdió.
    """
    copias = re.findall(r"COPY --from=node:(\S+)", CODIGO)
    assert copias, "nadie copia Node de la imagen oficial"
    for tag in copias:
        assert re.match(r"^\d+\.\d+\.\d+-", tag), (
            f"«node:{tag}» es un tag flotante; fija major.minor.patch")
    assert len(set(copias)) == 1, (
        f"dos versiones de Node distintas en el mismo build: {set(copias)}")


def test_npm_y_npx_quedan_en_el_path():
    """La imagen oficial de Node deja npm y npx como symlinks dentro de
    /usr/local/bin. Copiando solo el binario y node_modules hay que rehacerlos,
    y olvidar uno reproduce exactamente el fallo que se está arreglando."""
    for cmd in ("npm", "npx"):
        assert f"/usr/local/bin/{cmd}" in CODIGO, f"{cmd} no queda enlazado"


def test_el_build_verifica_node_antes_de_usarlo():
    """El gate tiene que estar ANTES del primer `npm ci`.

    Colocado después no sirve de nada: el `npm ci` ya habría fallado, que es
    precisamente el diagnóstico confuso del que se viene.
    """
    assert "npm --version" in CODIGO, "el build no comprueba que npm exista"
    assert CODIGO.index("npm --version") < CODIGO.index("npm ci"), (
        "la comprobación de npm está después del primer `npm ci`: llega tarde")


def test_el_gate_fija_la_linea_de_node_no_solo_su_presencia():
    """Preguntar solo «¿existe node?» es lo que dejó pasar el 18.20.4."""
    assert re.search(r"v20\.\*", CODIGO), (
        "el build acepta cualquier versión de Node con tal de que exista")


@pytest.mark.skipif(not WF_PATH.exists(),
                    reason="sin .github/ (dentro del contenedor) — corre en el runner")
def test_el_ci_tambien_pregunta_por_npm():
    """El paso «Runtimes de render presentes» existe para cazar justo esto y
    aquel día no lo cazó: preguntaba por node, ffmpeg y chromium, y npm era el
    único que faltaba."""
    wf = WF_PATH.read_text(encoding="utf-8")
    i = wf.index("- name: Runtimes de render presentes")
    j = wf.find("- name:", i + 10)
    paso = wf[i:j if j != -1 else len(wf)]
    for cmd in ("node --version", "npm --version", "ffmpeg", "chromium"):
        assert cmd in paso, f"el CI no comprueba {cmd} en la imagen"
