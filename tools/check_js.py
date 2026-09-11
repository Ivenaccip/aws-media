"""Arnés de sintaxis del JavaScript del repo — el que no existía.

    python tools/check_js.py            # todo
    python tools/check_js.py static/e1.html

Corre `node --check` sobre:
  · cada static/*.js y tools/editor/*.js sueltos, y
  · cada bloque <script> INLINE de los HTML de la UI (static/*.html y
    tools/editor/index.html), que es donde vive la mayor parte del JS del
    producto y donde un paréntesis de menos no lo nota nadie hasta producción.

Los <script src="..."> se saltan (no traen cuerpo) y los <script type="..."> que
no son JavaScript también. Cada bloque se escribe a un temporal con el MISMO
número de líneas que en el archivo original, así el `node --check` reporta una
línea que se puede abrir tal cual en el HTML.

Sale con 1 si algo no compila. No ejecuta nada: solo parsea.
"""
from __future__ import annotations

import re
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
OBJETIVOS = ["static/*.js", "static/*.html", "tools/editor/*.js", "tools/editor/index.html"]

_SCRIPT = re.compile(r"<script\b([^>]*)>(.*?)</script\s*>", re.S | re.I)
_TIPO = re.compile(r"""type\s*=\s*["']([^"']+)["']""", re.I)
_TIPOS_JS = {"text/javascript", "application/javascript", "module"}


def _nodo() -> str | None:
    from shutil import which
    return which("node")


def _bloques(html: str) -> list[tuple[int, str]]:
    """(línea donde empieza el cuerpo, código) de cada <script> con cuerpo."""
    fuera = []
    for m in _SCRIPT.finditer(html):
        atributos, cuerpo = m.group(1), m.group(2)
        if "src=" in atributos.lower() or not cuerpo.strip():
            continue
        tipo = _TIPO.search(atributos)
        if tipo and tipo.group(1).lower() not in _TIPOS_JS:
            continue   # application/json, text/template, etc.
        fuera.append((html[:m.start(2)].count("\n") + 1, cuerpo))
    return fuera


def _revisar(nodo: str, etiqueta: str, codigo: str, linea_base: int) -> str | None:
    # el relleno mantiene la numeración: lo que node reporte se abre tal cual
    with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False,
                                     encoding="utf-8") as f:
        f.write("\n" * (linea_base - 1) + codigo)
        tmp = f.name
    try:
        r = subprocess.run([nodo, "--check", tmp], capture_output=True, text=True)
        if r.returncode == 0:
            return None
        return f"{etiqueta}\n{(r.stderr or r.stdout).replace(tmp, etiqueta).strip()}"
    finally:
        Path(tmp).unlink(missing_ok=True)


def revisar_archivo(nodo: str, ruta: Path) -> list[str]:
    # relativa al repo cuando se pueda (es lo legible); si no, tal cual — a
    # esta herramienta se le puede pasar cualquier archivo suelto
    try:
        rel = ruta.resolve().relative_to(RAIZ).as_posix()
    except ValueError:
        rel = str(ruta)
    texto = ruta.read_text(encoding="utf-8")
    if ruta.suffix == ".js":
        fallo = _revisar(nodo, rel, texto, 1)
        return [fallo] if fallo else []
    fallos = []
    for i, (linea, codigo) in enumerate(_bloques(texto), 1):
        fallo = _revisar(nodo, f"{rel} (script {i}, línea {linea})", codigo, linea)
        if fallo:
            fallos.append(fallo)
    return fallos


def main(argv: list[str]) -> int:
    nodo = _nodo()
    if not nodo:
        print("node no está en el PATH — sin él no hay revisión de sintaxis")
        return 2
    if argv:
        archivos = [RAIZ / a for a in argv]
    else:
        archivos = sorted({p for patron in OBJETIVOS for p in RAIZ.glob(patron)})
    fallos: list[str] = []
    for ruta in archivos:
        if not ruta.is_file():
            print(f"no existe: {ruta}")
            return 2
        fallos += revisar_archivo(nodo, ruta)
    print(f"{len(archivos)} archivos revisados, {len(fallos)} con errores")
    for f in fallos:
        print("\n" + f)
    return 1 if fallos else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
