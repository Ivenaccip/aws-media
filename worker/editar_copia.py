"""E2 — la corrida de una COPIA editable de uno o varios videos (Fargate).

    python -m worker.editar_task <user_id> <nombre>      # despacha aquí si doc.editar.copia

La caja «Edición» del inicio ya no edita el proyecto de la persona: el servidor
(`POST /api/edicion/iniciar`) crea un proyecto NUEVO, la copia (`ed-<8 hex>`), cobra
y lanza esta tarea. Aquí se hace todo lo pesado, en tres pasos que la bandeja
«Tus trabajos» enseña (`doc.editar.paso`):

  entender  copia cada original DENTRO del bucket (servidor a servidor, sin bajar
            nada) a `videos/<copia>/clips/c01…`, baja los clips de a UNO, los mide,
            deja un canónico por clip (el que ya traen, o transcrito si se cobró
            por eso, o ninguno), su wav 16 kHz y su `{words}` en ms;
  editar    una llamada al LLM por clip con transcript (tiempos LOCALES a su fuente,
            docs/SCHEMA.md) y arma `work/analysis/cuts.json` con `clip_order`;
  vista     genera el proxy del editor (`tools/make_proxy.py`) y sube SOLO `work/**`.

Reglas que esta tarea no negocia (CONTRATO E2 §4.3, §5, §10):

  * La copia NO se llama `pelicula.mp4` ni lleva `flags.generado`/`origen`/`subidas`:
    subtítulos, publicar y render la tomarían por una película SIN editar.
  * Nunca escribe fuera de `videos/<copia>/`, y antes de copiar comprueba que cada
    original es de ESTA cuenta (`usuarios/<user>/…` o un proyecto suyo).
  * El original no se toca: solo se LEE (`media_sync.copiar` fija su ETag).
  * Dinero: cualquier fallo devuelve el monto COMPLETO que dejó escrito quien cobró
    (`doc.editar.creditos`), con la referencia `editar-sugerir:<copia>` y
    reclamando antes (`db.reclamar_fallo_editor`): lo gana esta tarea o el barredor,
    nunca los dos. Una unión (2+ videos) jamás se regala por «cero sugerencias»
    (R17): la unión ES el entregable.
  * El LLM falla en cualquier clip → falla TODO y se devuelve todo (D-06).
  * Disco acotado: clips de a uno (no `bajar_prefijo` del proyecto) y tope de peso.
"""
from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import wave
from pathlib import Path

from worker import editar_task as et          # primero: carga el entorno (SSM) antes de pipeline

from pipeline import costes_infra, creditos, db, media_sync, storage

log = logging.getLogger("editar_copia")

MAX_VIDEOS = 12                       # los mismos topes de server/edicion_api.py (R10, R14)
MAX_BYTES_TOTAL = 15 * 1024 ** 3
HOLGURA_DISCO = 1024 ** 3             # lo que se deja libre además de los clips
EXTS = re.compile(r"\.[a-z0-9]{2,5}")
CLIP_ID = re.compile(r"c\d{2}")
PASOS = ("entender", "editar", "vista")
ESPERA_DEVOLUCION = (1.0, 3.0)        # segundos entre los 3 intentos de devolver
MAX_NO_APLICADO = 5                   # cuántos motivos «No aplicado» se guardan en el doc
LARGO_NO_APLICADO = 120
AJENO = "Un video de la lista no es de esta cuenta"
NO_APLICADO = re.compile(r"^\s*no\s+aplicado\s*:\s*", re.IGNORECASE)


class Cerrada(Exception):
    """Otra pieza (el barredor, la caducidad de la API) ya cerró esta corrida:
    no se escribe ni se devuelve nada más, porque ya lo hizo quien la cerró."""


# ---------------------------------------------------------------------------
# estado de la corrida en Postgres (doc.editar)

class _Corrida:
    """Lee y escribe `doc.editar` SIN pisar a quien lo cerró: cada escritura vuelve a
    leer el doc y, si ya no está `corriendo`, levanta `Cerrada` en vez de revivirlo."""

    def __init__(self, user_id: str, nombre: str):
        self.user_id, self.nombre = user_id, nombre
        self.doc: dict = {}
        self.st: dict = {}

    def vivo(self) -> dict:
        doc = db.cargar_proyecto_editor(self.user_id, self.nombre)
        st = (doc or {}).get("editar") or {}
        if not doc or st.get("estado") != "corriendo":
            raise Cerrada(self.nombre)
        self.doc, self.st = doc, st
        return st

    def escribir(self, **campos) -> dict:
        st = self.vivo()
        st.update(campos)
        db.fijar_campo_editor(self.user_id, self.nombre, "editar",
                              json.dumps(st, ensure_ascii=False))
        return st

    def paso(self, paso: str) -> dict:
        """Cada fase escribe su `paso` al EMPEZAR (la bandeja lo sondea cada 15 s).

        Cambia SOLO `editar.paso` y solo si la corrida sigue `corriendo` (`db.fijar_paso_editor`, un
        UPDATE condicionado): en vez de leer el `editar` entero y volver a escribirlo, que pisaba
        lo que otro hubiera escrito en medio y podía revivir una corrida cerrada."""
        log.info("%s: paso %s", self.nombre, paso)
        st = self.vivo()
        if not db.fijar_paso_editor(self.user_id, self.nombre, paso):
            raise Cerrada(self.nombre)           # la cerraron entre la lectura y la escritura
        st["paso"] = paso
        return st


# ---------------------------------------------------------------------------
# defensa: de quién es cada key

def _limpia(key: object) -> str:
    if (not isinstance(key, str) or not key or key.startswith("/") or "\\" in key
            or ".." in key.split("/")):
        raise RuntimeError(AJENO)
    return key


def _fuentes(st: dict) -> list[dict]:
    """Los videos de la corrida, EN EL ORDEN ELEGIDO, y de forma. Lo escribió el API:
    aquí se vuelve a comprobar porque el doc es entrada de otro proceso."""
    fuentes = st.get("fuentes")
    if not isinstance(fuentes, list) or not fuentes or not all(isinstance(f, dict) for f in fuentes):
        raise RuntimeError("La edición no trae la lista de videos")
    if len(fuentes) > MAX_VIDEOS:
        raise RuntimeError(f"La edición trae más de {MAX_VIDEOS} videos")
    fuentes = sorted(fuentes, key=lambda f: int(f.get("orden") or 0))
    ids = [str(f.get("clip_id") or "") for f in fuentes]
    if not all(CLIP_ID.fullmatch(i) for i in ids) or len(set(ids)) != len(ids):
        raise RuntimeError("Los identificadores de clip de la edición no son válidos")
    for f in fuentes:
        f["ext"] = str(f.get("ext") or "").lower()          # «.MP4» del teléfono = «.mp4»
        if not EXTS.fullmatch(f["ext"]):
            raise RuntimeError("La extensión de un video de la lista no es válida")
    return fuentes


def _verificar_duenos(user_id: str, nombre: str, fuentes: list[dict]) -> None:
    """Cada `origen_key` empieza por `usuarios/<user_id>/` o es de un proyecto de
    ESTA cuenta (`db.cargar_proyecto_editor(user_id, n)`), y `canonico_key`/`wav_key`
    cuelgan del MISMO prefijo que el origen. Si no, error (y el monto se devuelve)."""
    propio = f"usuarios/{user_id}/"
    proyectos: dict[str, bool] = {}
    for f in fuentes:
        origen = _limpia(f.get("origen_key"))
        if origen.startswith(propio):
            prefijo = propio
        else:
            m = re.match(r"^(videos/([A-Za-z0-9_-]+)/)", origen)
            if not m or m.group(2) == nombre:       # ni de nadie ni de la propia copia
                raise RuntimeError(AJENO)
            if m.group(2) not in proyectos:
                proyectos[m.group(2)] = db.cargar_proyecto_editor(user_id, m.group(2)) is not None
            if not proyectos[m.group(2)]:
                raise RuntimeError(AJENO)
            prefijo = m.group(1)
        for campo in ("canonico_key", "wav_key"):
            if f.get(campo) and not _limpia(f[campo]).startswith(prefijo):
                raise RuntimeError(AJENO)


# ---------------------------------------------------------------------------
# ffmpeg / ASR (puntos de reemplazo de las pruebas)

def _medir_clip(path: Path) -> dict:
    """Lo que SE VE del archivo local (con la rotación del teléfono aplicada), su
    duración y si trae pista de audio. Lo medido AQUÍ manda para los cortes."""
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=codec_type,width,height:stream_side_data=rotation",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True, timeout=300)
    j = json.loads(r.stdout)
    ss = j.get("streams") or []
    v = next((s for s in ss if s.get("codec_type") == "video"), None)
    dur = float((j.get("format") or {}).get("duration") or 0)
    if v is None or not dur > 0:
        raise RuntimeError(f"No se pudo leer el video {path.name}")
    gira = abs(int((v.get("side_data_list") or [{}])[0].get("rotation", 0))) % 180 == 90
    w, h = (v["height"], v["width"]) if gira else (v["width"], v["height"])
    return {"dur": dur, "w": w, "h": h, "audio": any(s.get("codec_type") == "audio" for s in ss)}


def _extraer_wav(video: Path, wav: Path, dur: float, con_audio: bool) -> None:
    """16 kHz mono para TODOS los clips (render_cuts.AudioProbe lo exige): el audio
    del clip, o SILENCIO de su duración si no trae pista."""
    wav.parent.mkdir(parents=True, exist_ok=True)
    if con_audio:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(video),
               "-vn", "-ac", "1", "-ar", "16000", str(wav)]
    else:
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
               "-t", f"{dur:.3f}", "-c:a", "pcm_s16le", str(wav)]
    subprocess.run(cmd, check=True, timeout=1800)


def _wav_valido(wav: Path, dur: float) -> bool:
    """Un wav bajado de otro proyecto sirve solo si es PCM de 16 bits MONO (así lee
    AudioProbe) y dura lo que el clip."""
    try:
        with wave.open(str(wav), "rb") as w:
            return (w.getnchannels() == 1 and w.getsampwidth() == 2
                    and abs(w.getnframes() / w.getframerate() - dur) <= max(1.0, 0.02 * dur))
    except (wave.Error, EOFError, OSError, ZeroDivisionError):
        return False


def _transcribir(wav: Path) -> list[dict]:
    """AssemblyAI sobre el wav (cuesta dinero: solo lo llama `_canonico` para los
    clips que el API cobró como `transcribir`)."""
    sys.path.insert(0, str(et.ROOT / "tools"))
    from tools.normalizers import asr_backend
    return asr_backend._transcriptor_assemblyai()(wav)


def _proxy(destino: Path) -> None:
    subprocess.run([sys.executable, str(et.ROOT / "tools" / "make_proxy.py"), str(destino)],
                   check=True, cwd=str(et.ROOT / "tools"))


# ---------------------------------------------------------------------------
# fase «entender»

def _canonico_valido(doc: object) -> dict:
    if (not isinstance(doc, dict) or not str(doc.get("schema_version", "")).startswith("1.")
            or not isinstance(doc.get("words"), list)):
        raise RuntimeError("Un transcript de la lista no tiene el formato esperado")
    return doc


def _canonico(c: dict, f: dict, destino: Path, prefijo: str) -> dict | None:
    """El canónico de UN clip (`work/transcripts/<clip>.canonical.json`), con
    `source.id` = el id del clip, `source.path` = su archivo en la copia y
    `source.duration` = lo medido aquí; o None si no hay (clip sin transcript).

    Tres orígenes, en este orden: el que el original ya trae (`canonico_key`), el que
    un intento anterior dejó en la copia, o transcribirlo (solo si el API lo cobró:
    `transcribir`, y el clip trae audio). Jamás «el primero que haya» (la función de
    E1 tomaba el de OTRO clip en una unión)."""
    cid, dur = c["id"], c["dur"]
    ruta = destino / "work" / "transcripts" / f"{cid}.canonical.json"
    ruta.parent.mkdir(parents=True, exist_ok=True)
    doc = None
    if f.get("canonico_key"):
        if not media_sync.bajar_archivo(_limpia(f["canonico_key"]), ruta):
            raise RuntimeError(f"No pude bajar el transcript de «{c['titulo']}»")
        doc = _canonico_valido(json.loads(ruta.read_text(encoding="utf-8")))
    elif f.get("transcribir") and c["audio"]:
        previo = f"{prefijo}work/transcripts/{cid}.canonical.json"
        if media_sync.bajar_archivo(previo, ruta):
            # un reintento no paga dos veces la transcripción: reutiliza la del intento
            # anterior si es de ESTE clip (misma duración)
            try:
                doc = _canonico_valido(json.loads(ruta.read_text(encoding="utf-8")))
                if abs(float(doc["source"]["duration"]) - dur) > max(1.0, 0.02 * dur):
                    doc = None
            except (ValueError, KeyError, TypeError, RuntimeError):
                doc = None
        if doc is None:
            sys.path.insert(0, str(et.ROOT / "tools"))
            from tools.normalizers import asr_backend, common
            palabras = _transcribir(destino / "work" / "audio" / f"{cid}.wav")
            doc = common.build_canonical(cid, dur, "es", "assemblyai",
                                         asr_backend.SPEECH_MODELS[0], palabras)
            log.info("transcrito %s: %d palabras, %.0f s", cid, len(palabras), dur)
            doc["source"] = {"id": cid, "path": c["rel"], "duration": round(dur, 3)}
            ruta.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
            media_sync.subir_archivo(ruta, previo)       # solo bajo videos/<copia>/
    if doc is None:
        ruta.unlink(missing_ok=True)
        return None
    doc["source"] = {"id": cid, "path": c["rel"], "duration": round(dur, 3)}
    ruta.write_text(json.dumps(doc, ensure_ascii=False, indent=1), encoding="utf-8")
    return doc


def _entender(corrida: _Corrida, destino: Path) -> list[dict]:
    st = corrida.paso("entender")
    nombre, user_id = corrida.nombre, corrida.user_id
    prefijo = f"videos/{nombre}/"
    fuentes = _fuentes(st)
    _verificar_duenos(user_id, nombre, fuentes)

    # 1) copia servidor a servidor de TODOS los originales (barata: detecta de entrada
    # uno que falte, antes de bajar nada ni pagar una transcripción)
    total = 0
    for f in fuentes:
        titulo = f.get("titulo") or f["clip_id"]
        destino_key = f"{prefijo}clips/{f['clip_id']}{f['ext']}"
        esperado = f.get("bytes")
        actual = media_sync.tamano(destino_key)
        if not (isinstance(esperado, int) and esperado > 0 and actual == esperado):
            media_sync.copiar(_limpia(f["origen_key"]), destino_key)
            actual = media_sync.tamano(destino_key)
        if not actual:
            raise RuntimeError(f"La copia de «{titulo}» no quedó guardada")
        total += actual
        if total > MAX_BYTES_TOTAL:
            raise RuntimeError("Los videos pesan más de lo que cabe en una edición")
    destino.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(destino).free < total + HOLGURA_DISCO:
        raise RuntimeError("No hay disco suficiente para editar estos videos")

    # 2) clips de a UNO a destino/clips/ y se miden: lo medido aquí manda para los cortes
    clips: list[dict] = []
    for f in fuentes:
        cid, ext = f["clip_id"], f["ext"]
        local = destino / "clips" / f"{cid}{ext}"
        titulo = f.get("titulo") or cid
        if not media_sync.bajar_archivo(f"{prefijo}clips/{cid}{ext}", local):
            raise RuntimeError(f"No pude bajar «{titulo}»")
        m = _medir_clip(local)
        clips.append({"id": cid, "titulo": titulo, "rel": f"clips/{cid}{ext}", "local": local,
                      "dur": round(m["dur"], 3), "audio": m["audio"], "vertical": m["h"] > m["w"],
                      "fuente": f, "canonico": None})
    if len({c["vertical"] for c in clips}) > 1:
        # el API ya lo rechazó (R5); si aun así llega, es un error nuestro y se devuelve
        raise RuntimeError("Los videos horizontales y los verticales no se mezclan")

    # 3) por clip: wav 16 kHz, canónico (si hay) y sus palabras en ms
    for c in clips:
        f = c["fuente"]
        wav = destino / "work" / "audio" / f"{c['id']}.wav"
        wav.parent.mkdir(parents=True, exist_ok=True)
        if not (f.get("wav_key") and c["audio"]
                and media_sync.bajar_archivo(_limpia(f["wav_key"]), wav)
                and _wav_valido(wav, c["dur"])):
            _extraer_wav(c["local"], wav, c["dur"], c["audio"])
        c["canonico"] = _canonico(c, f, destino, prefijo)
        if c["canonico"] is not None:
            et._asegurar_words(destino, c["id"], c["canonico"])
        else:
            words = destino / "work" / "transcripts" / f"{c['id']}.json"
            words.write_text(json.dumps({"words": []}), encoding="utf-8")
    return clips


# ---------------------------------------------------------------------------
# fase «editar»

def _clave_motivo(texto: str) -> str:
    """Para juntar «No aplicado: Fundidos suaves.» con «no aplicado: fundidos suaves»:
    sin mayúsculas, sin acentos, sin espacios ni puntuación de los extremos."""
    sin_acentos = "".join(ch for ch in unicodedata.normalize("NFD", texto.lower())
                          if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", sin_acentos).strip(" .,;:!¡?¿…\"'«»")


def construir_cuts_union(nombre: str, clips: list[dict]) -> tuple[dict, list[str]]:
    """`cuts.json` de N clips (generaliza `editar_task.construir_cuts`, que se queda).

    `clips[i]` = {"id", "file" (relativo al proyecto), "dur", "salida" (lo que devolvió
    el LLM de ESE clip, o None), "sin_transcript" (bool)}. Devuelve `(cuts, no_aplicado)`:

      * `clip_order` en el orden dado; los `keeps` de cada clip son el complemento de
        sus cortes seguros (el material jamás se pierde). Un clip SIN transcript se
        incluye entero y lleva `"sin_transcript": true`.
      * `flags` con ids consecutivos 1..K en TODO el proyecto (por clip chocarían).
      * «No aplicado:» — cada LLM lo repite: queda UNA duda por motivo distinto (en el
        primer clip, `at: "00:00"`, `default: "keep both"`), y los motivos sin el
        prefijo van aparte (≤ 120 caracteres c/u, máximo 5) para `editar.no_aplicado`.
    """
    sys.path.insert(0, str(et.ROOT / "tools"))
    from tools.normalizers.generated_to_canonical import STYLES_DEFAULT

    primero = clips[0]["id"]
    entradas: list[dict] = []
    flags: list[dict] = []
    motivos: dict[str, str] = {}
    for c in clips:
        if c.get("sin_transcript"):
            dur = round(float(c["dur"]), 3)
            entradas.append({"id": c["id"], "file": c["file"], "duration": dur,
                             "keeps": [{"s": 0.0, "e": dur, "text": ""}], "cuts": [],
                             "fluff_suggestions": [], "sin_transcript": True})
            continue
        uno = et.construir_cuts(nombre, c["id"], c["file"], float(c["dur"]), c.get("salida") or {})
        entradas.append(uno["clips"][0])
        for fl in uno["flags"]:
            m = NO_APLICADO.match(fl["issue"])
            if not m:
                flags.append(dict(fl))
                continue
            motivo = fl["issue"][m.end():].strip()
            clave = _clave_motivo(motivo)
            if clave in motivos:
                continue
            motivos[clave] = motivo
            flags.append({"id": 0, "clip": primero, "at": "00:00",
                          "issue": f"No aplicado: {motivo}"[:300], "default": "keep both",
                          "status": "pending"})
    for i, fl in enumerate(flags, 1):
        fl["id"] = i
    cuts = {"project": nombre, "clip_order": [c["id"] for c in clips], "clips": entradas,
            "styles": STYLES_DEFAULT, "flags": flags}
    no_aplicado = [m[:LARGO_NO_APLICADO] for m in motivos.values() if m][:MAX_NO_APLICADO]
    return cuts, no_aplicado


def _editar(corrida: _Corrida, destino: Path, clips: list[dict]) -> tuple[dict, list[str]]:
    st = corrida.paso("editar")
    instruccion = st.get("instruccion") or ""
    n = len(clips)
    entradas = []
    for k, c in enumerate(clips, 1):
        salida = None
        if c["canonico"] is not None and c["canonico"].get("words"):
            # UNA llamada por clip, con el mismo texto y tiempos locales a su fuente. Con
            # un solo video es la llamada de E1 sin una coma de más.
            salida = (et._sugerencias_llm(c["canonico"], instruccion) if n == 1
                      else et._sugerencias_llm(c["canonico"], instruccion, union=(k, n)))
        entradas.append({"id": c["id"], "file": c["rel"], "dur": c["dur"], "salida": salida,
                         "sin_transcript": c["canonico"] is None})
    cuts, no_aplicado = construir_cuts_union(corrida.nombre, entradas)
    carpeta = destino / "work" / "analysis"
    carpeta.mkdir(parents=True, exist_ok=True)
    (carpeta / "cuts.json").write_text(json.dumps(cuts, ensure_ascii=False, indent=2),
                                       encoding="utf-8")
    return cuts, no_aplicado


# ---------------------------------------------------------------------------
# fase «vista»

def _subir_work(destino: Path, prefijo: str) -> int:
    """Sube SOLO `work/**` (y de él, ni las partes del proxy ni su lista): `clips/` ya
    está en S3 por la copia, y `media_sync.subir_dir` de hoy re-subiría todo el árbol,
    videos fuente incluidos (con el bucket versionado, otra versión de varios GB)."""
    n = 0
    for f in sorted((destino / "work").rglob("*")):
        if not f.is_file():
            continue
        rel = f.relative_to(destino).as_posix()
        if (rel.startswith("work/editor/part-") and rel.endswith(".mp4")) or rel == "work/editor/list.txt":
            continue
        media_sync.subir_archivo(f, prefijo + rel)
        n += 1
    return n


def _vista(corrida: _Corrida, destino: Path, clips: list[dict], cuts: dict,
           no_aplicado: list[str]) -> dict:
    corrida.paso("vista")
    prefijo = f"videos/{corrida.nombre}/"
    _proxy(destino)
    subidos = _subir_work(destino, prefijo)
    log.info("%s: %d artefactos subidos", corrida.nombre, subidos)

    corrida.vivo()                                   # ¿sigue siendo nuestra? (no revivir un cierre)
    flags = dict(corrida.doc.get("flags") or {})
    flags.update(canonico=any(c["canonico"] is not None for c in clips), cuts=True)
    db.fijar_campo_editor(corrida.user_id, corrida.nombre, "flags", json.dumps(flags))
    entradas = cuts["clips"]
    dur_salida = sum(k["e"] - k["s"] for e in entradas for k in e["keeps"])
    return corrida.escribir(
        estado="listo", paso="vista", fin=et._ahora(),
        cortes=sum(len(e["cuts"]) for e in entradas),
        fluff=sum(len(e["fluff_suggestions"]) for e in entradas),
        flags=len(cuts["flags"]),
        resultado={"n": len(clips), "dur_entrada_s": round(sum(c["dur"] for c in clips), 3),
                   "dur_salida_s": round(dur_salida, 3)},
        no_aplicado=no_aplicado)


# ---------------------------------------------------------------------------
# dinero

def _devolver(user_id: str, nombre: str, n: int) -> bool:
    """`creditos.devolver` con la referencia del cobro. Tres intentos: un fallo
    pasajero del monedero no debe dejar a nadie sin sus créditos."""
    for i in range(len(ESPERA_DEVOLUCION) + 1):
        try:
            creditos.devolver(n, f"editar-sugerir:{nombre}", user_id)
            return True
        except Exception:  # noqa: BLE001 — el monedero puede fallar de mil formas
            log.exception("%s: no se pudieron devolver %d créditos (intento %d)", nombre, n, i + 1)
            if i < len(ESPERA_DEVOLUCION):
                time.sleep(ESPERA_DEVOLUCION[i])
    return False


def _fallar(user_id: str, nombre: str, err: Exception) -> int:
    """El `except` de la corrida. Primero RECLAMA (UPDATE condicionado a `corriendo`:
    lo gana esta tarea o el barredor, nunca los dos) y SOLO si ganó devuelve lo
    cobrado COMPLETO (`trabajo["creditos"]`, lo que escribió quien cobró) y deja
    `devueltos`. Si el reclamo lo perdió, alguien ya cerró y devolvió: nada que hacer."""
    mensaje = f"{type(err).__name__}: {str(err)[:300]}"
    trabajo = db.reclamar_fallo_editor(user_id, nombre, "editar", mensaje)
    if trabajo is None:
        log.warning("%s: ya estaba cerrada (barredor o caducidad): no se devuelve de nuevo", nombre)
        return 1
    n = int(trabajo.get("creditos") or 0)
    if n and creditos.activo():
        if _devolver(user_id, nombre, n):
            trabajo["devueltos"] = n
            log.info("%s: %d créditos devueltos", nombre, n)
        else:
            # Lo último que queda: volver a abrir el doc y salir con 1. La ejecución muere
            # FAILED, el barredor reclama (el doc vuelve a estar `corriendo`) y lo
            # intenta con su propia conexión. Mejor eso que un `error` sin devolver.
            log.error("%s: NO se devolvieron %d créditos; se deja para el barredor", nombre, n)
            trabajo["estado"] = "corriendo"
            trabajo["devolucion_pendiente"] = n
    try:
        db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(trabajo, ensure_ascii=False))
    except Exception:  # noqa: BLE001
        if trabajo.get("estado") != "corriendo":
            raise
        # No se pudo reabrir: el índice único de una copia en curso lo rechaza si la persona
        # lanzó OTRA mientras el monedero fallaba (el doc ya estaba en `error`, y se pueden
        # lanzar). El doc se queda en `error` pero CON la deuda anotada: el evento FAILED de esta
        # ejecución llega al barredor y `_cobrar_deuda_editar` la cobra desde ahí.
        log.exception("%s: no se pudo reabrir para el barredor; la deuda de %d créditos queda "
                      "anotada con el doc en «error»", nombre, n)
        trabajo["estado"] = "error"
        try:
            db.fijar_campo_editor(user_id, nombre, "editar", json.dumps(trabajo, ensure_ascii=False))
        except Exception:  # noqa: BLE001
            log.exception("%s: NO se devolvieron %d créditos y el doc no se pudo marcar: revisar el "
                          "libro mayor de %s", nombre, n, user_id)
    return 1


def _devolver_si_vacia(corrida: _Corrida, st: dict, n_videos: int) -> bool:
    """Terminó bien pero con CERO sugerencias: con UN video se devuelve la parte del LLM
    como en E1 (`creditos_a_devolver`). Con 2+ NUNCA (R17): la unión es el entregable.
    La corrida ya quedó `listo` ANTES de tocar el monedero: si el abono sale y la
    anotación falla, el `except` no puede reclamar (ya no está `corriendo`) y no hay
    doble devolución.

    Devuelve True si el abono FALLÓ y quedó anotado en `devolucion_pendiente`: la copia se
    entregó, pero no hay ninguna ejecución caída que lo cobre. Quien llama sale entonces con 1 para
    que la ejecución termine FAILED y su evento llegue al barredor, que cobra la deuda
    (`barredor._cobrar_deuda_editar`)."""
    n = et.creditos_a_devolver(st) if n_videos == 1 else 0
    if not n or not creditos.activo():
        return False
    pendiente = not _devolver(corrida.user_id, corrida.nombre, n)
    if pendiente:
        campos = {"devolucion_pendiente": n}
        log.error("%s: NO se devolvieron %d créditos por cero sugerencias; se deja para el barredor",
                  corrida.nombre, n)
    else:
        campos = {"devueltos": n}
        log.info("%s: sin sugerencias — %d créditos devueltos", corrida.nombre, n)
    st.update(campos)
    db.fijar_campo_editor(corrida.user_id, corrida.nombre, "editar",
                          json.dumps(st, ensure_ascii=False))
    return pendiente


# ---------------------------------------------------------------------------
# la corrida

def correr(user_id: str, nombre: str, doc: dict) -> int:
    """0 si terminó (o ya no era suya), 1 si falló (y ya devolvió) o si quedó una deuda sin cobrar."""
    t0 = time.monotonic()
    estado = (doc.get("editar") or {}).get("estado")
    if estado != "corriendo":
        # el barredor o una ejecución duplicada ya la cerró: ni se trabaja ni se devuelve
        log.warning("%s: la edición está en «%s», no «corriendo»: no hago nada", nombre, estado)
        return 0
    corrida = _Corrida(user_id, nombre)
    corrida.doc, corrida.st = doc, doc["editar"]
    try:
        destino = storage.ruta_proyecto(nombre)
        clips = _entender(corrida, destino)
        cuts, no_aplicado = _editar(corrida, destino, clips)
        st = _vista(corrida, destino, clips, cuts, no_aplicado)
        pendiente = _devolver_si_vacia(corrida, st, len(clips))
        log.info("%s: %d videos unidos — %d cortes, %d fluff, %d flags", nombre, len(clips),
                 st["cortes"], st["fluff"], st["flags"])
        # la copia ya está entregada; salir con 1 solo cuando quedó una deuda sin cobrar, para que
        # el evento FAILED de la ejecución llegue al barredor (no hay otro lector de la deuda)
        return 1 if pendiente else 0
    except Cerrada:
        log.warning("%s: la cerró otra pieza mientras corría: no se escribe ni se devuelve más", nombre)
        return 0
    except Exception as err:  # noqa: BLE001 — estado y devolución a Postgres
        log.exception("%s: la edición falló", nombre)
        return _fallar(user_id, nombre, err)
    finally:
        costes_infra.registrar(user_id, nombre, "infra-editar",
                               costes_infra.costo_fargate(time.monotonic() - t0))
