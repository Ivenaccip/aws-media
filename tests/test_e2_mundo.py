"""E2 — el «mundo» en memoria que usan las pruebas de server/edicion_api.py.

No es una prueba: es el doble compartido de `test_e2_*.py`. Finge, en memoria y
sin gastar nada, todo lo que el API de E2 toca:

  - Postgres: proyectos del editor por persona, la reserva global de nombres, el
    monedero y su libro mayor, y el índice parcial único de «una copia corriendo
    por persona» (`mundo.indice`; apagado simula una base que aún no corrió
    `db_migrate`);
  - S3: los objetos (documentos de clips, canónicos) como texto;
  - la máquina de estados (`jobs.lanzar_editar`), con fallo configurable;
  - ffprobe (`_medir`): las mediciones se declaran por `key`.

Cada operación que cruza una frontera de dinero o de estado se anota en
`mundo.eventos`, en orden: así una prueba puede exigir «reservar → candado →
cobrar → anotar → lanzar» como una lista, y la mutación que cambie el orden
la rompe.

El monedero se finge UN nivel más abajo (`db.cobrar_creditos` / `abonar_creditos`)
para que corra el `pipeline/creditos.py` de verdad: la tarifa sale de
`tools/tarifas.json` y el `SinSaldo` real.
"""
import json
import subprocess
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from pipeline import creditos, db, jobs, media_sync
from pipeline.project import Proyecto
from server import edicion_api

PEDIDO = "9f1c0a7b4d2e4f6a8b3c1d5e7f9a0b2c"
PEDIDO_2 = "aaaaaaaa11112222333344445555666b"
INSTRUCCION = "Quita muletillas y silencios. Es para YouTube."


def gira(path: Path) -> bool:
    """¿El archivo se ve girado 90° (display matrix)? Lo mismo que mira `edicion_api._medir`."""
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream_side_data=rotation",
                        "-of", "json", str(path)], capture_output=True, text=True, encoding="utf-8")
    try:
        lado = [d for s in json.loads(r.stdout).get("streams", []) for d in s.get("side_data_list", [])]
    except ValueError:
        return False
    return any(abs(int(d.get("rotation", 0))) % 180 == 90 for d in lado)


def con_rotacion(src: Path, dst: Path) -> Path | None:
    """`src` SIN recodificar y con rotación de 90° (se ve vertical), o None si este ffmpeg no sabe
    marcarla. `-display_rotation` es de ffmpeg 6; la imagen del CI (Debian bookworm) trae la 5.1,
    que lo hace con el tag `rotate`. Se prueban las dos maneras y se COMPRUEBA con ffprobe que la
    rotación quedó marcada: un `returncode == 0` solo no basta, un ffmpeg puede aceptar la opción
    y no dejar nada escrito."""
    for args in (["-display_rotation", "90", "-i", str(src), "-c", "copy"],
                 ["-i", str(src), "-c", "copy", "-metadata:s:v:0", "rotate=90"]):
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", *args, str(dst)], capture_output=True)
        if r.returncode == 0 and gira(dst):
            return dst
        dst.unlink(missing_ok=True)
    return None


def ahora_iso(delta_s: float = 0) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=delta_s)).isoformat(timespec="seconds")


class Mundo:
    def __init__(self, monkeypatch):
        self.mp = monkeypatch
        self.user = "u1"
        self.eventos: list[tuple] = []
        self.proyectos: dict[str, dict[str, dict]] = {}     # user -> nombre -> doc
        self.creados: dict[tuple, str] = {}                 # (user, nombre) -> creado iso
        self.nombres: dict[str, str] = {}                   # nombre -> user (nombres_editor)
        self.saldos: dict[str, int] = {"u1": 100, "u2": 100}
        self.libro: list[dict] = []                         # el libro mayor, en orden
        self.s3: dict[str, str] = {}
        self.medidas: dict[str, dict | None] = {}           # key -> lo que mide ffprobe
        self.peliculas: list[Proyecto] = []
        self.indice = True                                  # el índice parcial único existe
        self.lanzar_falla: Exception | None = None
        self.cobrar_falla_despues: Exception | None = None     # cobra y luego se cae la respuesta
        self.candado = threading.RLock()                        # cada sentencia de Postgres es atómica
        self.mediciones_hechas: list[str] = []
        self.tamanos: dict[str, int | None] = {}           # key -> bytes en S3 (si no está, los de la subida del doc)
        self.hay_sitio = True                               # Fargate tiene lugar
        self.abonar_fallas = 0                              # cuántos abonos siguientes truenan (el monedero titubea)
        self.abono_pierde_respuesta = 0                     # el abono entra pero la respuesta se pierde (N veces)
        self.al_abonar = None                               # callable, una vez: algo pasa MIENTRAS se devuelve
        self.tras_crear = None                              # callable, una vez: otra pestaña inserta justo después de mi INSERT
        self._parchar()

    # -- la parte de Postgres -------------------------------------------------
    def _parchar(self) -> None:
        mp = self.mp
        mp.setenv("STATE_BACKEND", "postgres")
        mp.setenv("ASSEMBLYAI_API_KEY", "x")
        mp.delenv("COGNITO_POOL_ID", raising=False)
        mp.setattr(db, "backend", lambda: "postgres")
        mp.setattr(db, "usuario_actual", lambda: self.user)
        mp.setattr(creditos, "activo", lambda: True)
        mp.setattr(db, "cargar_proyecto_editor", self._cargar)
        mp.setattr(db, "listar_proyectos_editor", self._listar)
        mp.setattr(db, "reservar_nombre_derivado", self._reservar)
        mp.setattr(db, "crear_copia_editor", self._crear)
        mp.setattr(db, "ediciones_corriendo", self._corriendo)
        mp.setattr(db, "fijar_campo_editor", self._fijar_campo)
        mp.setattr(db, "fijar_meta_editor", lambda u, n, m: self._fijar_campo(u, n, "meta", m))
        mp.setattr(db, "reclamar_fallo_editor", self._reclamar_fallo)
        mp.setattr(db, "reclamar_reintento_editor", self._reclamar_reintento)
        mp.setattr(db, "borrar_copia_sin_cobrar", self._borrar_sin_cobrar)
        mp.setattr(db, "movimientos_creditos", self._movimientos)
        mp.setattr(db, "saldo_creditos", lambda u: self.saldos.get(u, 0))
        mp.setattr(db, "cobrar_creditos", self._cobrar)
        mp.setattr(db, "abonar_creditos", self._abonar)
        mp.setattr(db, "abonar_devolucion_de_cargo", self._abonar_de_cargo)
        mp.setattr(db, "cerrar_editor_si_error", self._cerrar_si_error)
        mp.setattr(db, "devoluciones_pendientes", self._pendientes)
        mp.setattr(media_sync, "tamano", self._tamano)
        mp.setattr(jobs, "_hay_sitio", lambda: self.hay_sitio)
        mp.setattr(jobs, "lanzar_editar", self._lanzar)
        mp.setattr(media_sync, "listar_prefijo",
                   lambda pre: sorted(k for k in self.s3 if k.startswith(pre)))
        mp.setattr(media_sync, "leer_texto", lambda k: self.s3.get(k))
        mp.setattr(media_sync, "url_media", lambda k: f"https://media.test/{k}")
        mp.setattr(edicion_api, "_medir", self._medir)
        mp.setattr(edicion_api, "listar_proyectos", lambda: list(self.peliculas))
        # los clips leen su doc de S3 con el mismo `media_sync`; el prefijo lo da el usuario

    def docs(self, user: str | None = None) -> dict[str, dict]:
        return self.proyectos.setdefault(user or self.user, {})

    def _cargar(self, u, n):
        self.eventos.append(("cargar", n))
        d = self.docs(u).get(n)
        return json.loads(json.dumps(d)) if d is not None else None

    def _listar(self, u):
        filas = [{"nombre": n, "creado": self.creados.get((u, n)), "doc": json.loads(json.dumps(d))}
                 for n, d in self.docs(u).items()]
        return sorted(filas, key=lambda f: f["creado"] or "", reverse=True)

    def _ajeno(self, u, n) -> bool:
        return self.nombres.get(n, u) != u or any(
            n in docs for otro, docs in self.proyectos.items() if otro != u)

    def _reservar(self, u, base, *, con_base=True, reservar=True, intentos=8):
        self.eventos.append(("reservar", base, reservar))
        cands = ([base] if con_base else []) + [
            f"{base}-{db.sufijo_estable(u, base, i)}" for i in range(intentos)]
        for n in cands:
            if not self._ajeno(u, n):
                if reservar:
                    self.nombres[n] = u
                return n
        return None

    def _en_curso(self, u, excepto=None) -> bool:
        return any(d.get("editar", {}).get("estado") == "corriendo"
                   and d.get("editar", {}).get("copia") is True
                   for n, d in self.docs(u).items() if n != excepto)

    def _crear(self, u, n, doc) -> bool:
        with self.candado:
            return self._crear_atomico(u, n, doc)

    def _crear_atomico(self, u, n, doc) -> bool:
        self.eventos.append(("crear", n))
        if n in self.docs(u):
            return False
        d = json.loads(doc)
        if (self.indice and d.get("editar", {}).get("estado") == "corriendo"
                and d["editar"].get("copia") is True and self._en_curso(u)):
            return False                       # el índice parcial único
        self.docs(u)[n] = d
        self.creados[(u, n)] = ahora_iso()
        if self.tras_crear is not None:
            gancho, self.tras_crear = self.tras_crear, None
            gancho()                           # la otra pestaña inserta después de mí (sin índice no hay quien la frene)
        return True

    def _corriendo(self, u):
        self.eventos.append(("corriendo",))
        return [{"nombre": n, "editar": json.loads(json.dumps(d["editar"]))}
                for n, d in self.docs(u).items()
                if isinstance(d.get("editar"), dict) and d["editar"].get("estado") == "corriendo"]

    def _fijar_campo(self, u, n, campo, valor):
        v = json.loads(valor)
        if campo == "editar":
            self.eventos.append(("fijar", n, "editar", v.get("estado"), v.get("cobrado")))
        else:
            self.eventos.append(("fijar", n, campo))
        d = self.docs(u).get(n)
        if d is None:
            return
        if (campo == "editar" and self.indice and v.get("estado") == "corriendo"
                and v.get("copia") is True and self._en_curso(u, excepto=n)):
            raise RuntimeError("duplicate key value violates unique constraint "
                               "proyectos_editor_copia_en_curso")
        d[campo] = v

    def _reclamar_fallo(self, u, n, campo, mensaje):
        with self.candado:
            return self._reclamar_fallo_atomico(u, n, campo, mensaje)

    def _reclamar_fallo_atomico(self, u, n, campo, mensaje):
        d = self.docs(u).get(n)
        if d is None or (d.get(campo) or {}).get("estado") != "corriendo":
            self.eventos.append(("reclamar", n, False))
            return None
        d[campo].update(estado="error", error=mensaje)
        self.eventos.append(("reclamar", n, True))
        return json.loads(json.dumps(d[campo]))

    def _reclamar_reintento(self, u, n, editar) -> bool:
        with self.candado:
            return self._reclamar_reintento_atomico(u, n, editar)

    def _reclamar_reintento_atomico(self, u, n, editar) -> bool:
        d = self.docs(u).get(n)
        v = json.loads(editar)
        if d is None or (d.get("editar") or {}).get("estado") != "error" or d["editar"].get("copia") is not True:
            self.eventos.append(("reclamar_reintento", n, False))
            return False
        if self.indice and self._en_curso(u, excepto=n):
            self.eventos.append(("reclamar_reintento", n, False))
            return False                       # el índice rechaza el UPDATE
        d["editar"] = v
        self.eventos.append(("reclamar_reintento", n, True))
        return True

    def _borrar_sin_cobrar(self, u, n):
        self.eventos.append(("borrar", n))
        d = self.docs(u).get(n)
        if d and d.get("editar", {}).get("copia") is True and d["editar"].get("cobrado") is False:
            del self.docs(u)[n]

    def _cerrar_si_error(self, u, n, inicio, valor) -> bool:
        """`db.cerrar_editor_si_error`: escribe solo si la copia SIGUE en `error` con el mismo `inicio`."""
        with self.candado:
            d = self.docs(u).get(n)
            e = (d or {}).get("editar") or {}
            if d is None or e.get("estado") != "error" or (e.get("inicio") or "") != ("" if inicio is None else inicio):
                self.eventos.append(("cerrar", n, False))
                return False
            v = json.loads(valor)
            if (self.indice and v.get("estado") == "corriendo" and v.get("copia") is True
                    and self._en_curso(u, excepto=n)):
                raise RuntimeError("duplicate key value violates unique constraint proyectos_editor_copia_en_curso")
            d["editar"] = v
            self.eventos.append(("cerrar", n, True))
            return True

    def _pendientes(self, u):
        return [{"nombre": n, "editar": json.loads(json.dumps(d["editar"]))}
                for n, d in self.docs(u).items()
                if isinstance(d.get("editar"), dict) and d["editar"].get("devolucion_api") is True]

    def _tamano(self, key):
        """ContentLength del objeto en S3: lo que diga `self.tamanos` y, si no, lo que registró la subida."""
        if key in self.tamanos:
            return self.tamanos[key]
        for docs in self.proyectos.values():
            for d in docs.values():
                for s in d.get("subidas", []):
                    if s.get("key") == key:
                        return s.get("bytes")
        return None

    # -- el monedero ----------------------------------------------------------
    def _cobrar(self, u, n, ref):
        with self.candado:
            if self.saldos.get(u, 0) < n:
                return None
            self.saldos[u] -= n
            self.libro.append({"user": u, "creditos": -n, "tipo": "cargo", "referencia": ref})
            self.eventos.append(("cobrar", n, ref))
        if self.cobrar_falla_despues is not None:
            raise self.cobrar_falla_despues
        return self.saldos[u]

    def _titubea(self) -> None:
        if self.al_abonar is not None:
            gancho, self.al_abonar = self.al_abonar, None
            gancho()                           # p. ej.: la persona pulsa «Reintentar» mientras se devuelve
        if self.abonar_fallas > 0:
            self.abonar_fallas -= 1
            self.eventos.append(("abono_fallo",))
            raise RuntimeError("el monedero titubea (Data API)")

    def _abonar_de_cargo(self, u, n, ref):
        """`db.abonar_devolucion_de_cargo`: UNA sentencia; abona solo si el ÚLTIMO movimiento de esa
        referencia es un cargo (hay algo cobrado sin devolver); si ya era una devolución, no toca nada."""
        self._titubea()                        # fuera del candado: el gancho puede hacer otra petición
        with self.candado:
            propios = [m for m in self.libro if m["user"] == u and m["referencia"] == ref]
            if not propios or propios[-1]["tipo"] != "cargo":
                self.eventos.append(("devolver_repetida", n, ref))
                return None
            saldo = self._abonar(u, n, "devolucion", ref, _sin_fallo=True)
            if self.abono_pierde_respuesta > 0:
                self.abono_pierde_respuesta -= 1
                self.eventos.append(("abono_sin_respuesta",))
                raise TimeoutError("la respuesta del Data API se perdió (el abono SÍ entró)")
            return saldo

    def _abonar(self, u, n, tipo, ref, _sin_fallo=False):
        if not _sin_fallo and tipo == "devolucion":
            self._titubea()
        self.saldos[u] = self.saldos.get(u, 0) + n
        self.libro.append({"user": u, "creditos": n, "tipo": tipo, "referencia": ref})
        self.eventos.append(("devolver" if tipo == "devolucion" else tipo, n, ref))
        return self.saldos[u]

    def _movimientos(self, u, limite=20):
        return [m for m in reversed(self.libro) if m["user"] == u][:limite]

    def neto(self, ref: str, user: str | None = None) -> int:
        """Lo que la persona lleva pagado por esa referencia (cargos − devoluciones)."""
        return -sum(m["creditos"] for m in self.libro
                    if m["referencia"] == ref and m["user"] == (user or self.user))

    # -- máquina de estados y ffprobe -----------------------------------------
    def _lanzar(self, u, n):
        self.eventos.append(("lanzar", n))
        if self.lanzar_falla is not None:
            raise self.lanzar_falla
        return "arn:ejecucion"

    def _medir(self, key, *, timeout=8):
        self.mediciones_hechas.append(key)
        self.eventos.append(("medir", key))
        return self.medidas.get(key)

    # -- construir el mundo ---------------------------------------------------
    def subida(self, nombre, *, archivo=None, dur=724.0, ancho=1920, alto=1080, audio=True,
               bytes_=864_000_000, canonico=False, creado=None, user=None, titulo_yt=None,
               flags=None, meta=None) -> str:
        """Un proyecto del editor con UNA subida (lo que hace /api/media/confirmar)."""
        u = user or self.user
        archivo = archivo or f"{nombre}.mp4"
        key = f"videos/{nombre}/subidas/{archivo}"
        doc = {"subidas": [{"key": key, "archivo": archivo, "bytes": bytes_}]}
        if flags:
            doc["flags"] = dict(flags)
        if canonico:
            stem = archivo.rsplit(".", 1)[0]
            doc["flags"] = {**doc.get("flags", {}), "canonico": True}
            self.s3[f"videos/{nombre}/work/transcripts/{stem}.canonical.json"] = json.dumps(
                {"schema_version": "1.0", "source": {"duration": dur}, "words": []})
        if titulo_yt:
            doc["importar"] = {"titulo": titulo_yt}
        if meta:
            doc["meta"] = meta
        self.docs(u)[nombre] = doc
        self.creados[(u, nombre)] = creado or "2026-10-10T12:00:00+00:00"
        self.nombres[nombre] = u
        self.medidas[key] = {"duracion_s": dur, "ancho": ancho, "alto": alto, "audio": audio}
        return key

    def pelicula(self, id8, brief, *, modo="auto", dur=30.04, ancho=1280, alto=720, creado=None,
                 estado="listo", archivado=False, con_editor=True, editor_en_progreso=True,
                 transcript=True, user=None) -> str:
        """Una película lista y su proyecto `gen-<id8>` del editor (con canónico)."""
        u = user or self.user
        nombre = f"gen-{id8}"
        prog = {"editor": nombre} if (con_editor and editor_en_progreso) else {}
        self.peliculas.append(Proyecto(id=id8, creado="2026-10-02T15:04:05", brief=brief, modo=modo,
                                       estado=estado, archivado=archivado, progreso=prog,
                                       duracion_s=30))
        if not con_editor:
            return nombre
        key = f"videos/{nombre}/pelicula.mp4"
        doc = {"origen": {"generador": id8, "user_id": u},
               "flags": {"generado": True, "canonico": transcript, "cuts": True},
               "subidas": [{"key": key, "archivo": "pelicula.mp4", "bytes": 11_534_336}]}
        if transcript:
            self.s3[f"videos/{nombre}/work/transcripts/pelicula.canonical.json"] = json.dumps(
                {"schema_version": "1.0", "source": {"duration": dur}, "words": []})
        self.docs(u)[nombre] = doc
        self.creados[(u, nombre)] = creado or "2026-10-02T15:04:05+00:00"
        self.nombres[nombre] = u
        self.medidas[key] = {"duracion_s": dur, "ancho": ancho, "alto": alto, "audio": True}
        return nombre

    def clip(self, clip_id="clip-20261008-101500-ab12cd", texto="Perro en la playa", *,
             segundos=8, formato="horizontal", estado="listo", dur=8.0, ancho=1280, alto=720,
             audio=True, bytes_=3_145_728, user=None, con_key=True) -> str:
        u = user or self.user
        key = f"usuarios/{u}/clips/{clip_id}.mp4"
        doc = {"estado": estado, "inicio": "2026-10-08T10:14:00+00:00", "listo": "2026-10-08T10:15:00+00:00",
               "texto": texto, "formato": formato, "segundos": segundos, "audio": audio,
               "bytes": bytes_}
        if con_key:
            doc["key"] = key
        self.s3[f"usuarios/{u}/clips/{clip_id}.json"] = json.dumps(doc)
        self.medidas[key] = {"duracion_s": dur, "ancho": ancho, "alto": alto, "audio": audio}
        return clip_id

    def copia(self, nombre, titulo, *, estado="listo", de=None, user=None, **editar) -> None:
        u = user or self.user
        de = de or [{"orden": 1, "ref": "proyecto:gen-1a2b3c4d", "tipo": "pelicula",
                     "titulo": "El tren de papel", "clip_id": "c01"}]
        self.docs(u)[nombre] = {
            "titulo": titulo, "subidas": [],
            "copia": {"version": 1, "creada": "2026-10-13T20:11:00+00:00", "de": de},
            "flags": {"canonico": True, "cuts": True},
            "editar": {"copia": True, "estado": estado, "cobrado": True, "creditos": 2,
                       "inicio": ahora_iso(-60), "paso": "entender", "pedido": PEDIDO,
                       "instruccion": INSTRUCCION, "n_videos": len(de), **editar}}
        self.creados[(u, nombre)] = "2026-10-13T20:11:00+00:00"
        self.nombres[nombre] = u

    def cuerpo(self, *refs, pedido=PEDIDO, instruccion=INSTRUCCION, **extra) -> dict:
        return {"pedido": pedido, "videos": list(refs), "instruccion": instruccion, **extra}


@pytest.fixture
def mundo(monkeypatch):
    return Mundo(monkeypatch)


@pytest.fixture
def cliente(mundo):
    from server.app import app
    c = TestClient(app)
    c.mundo = mundo
    return c


def tarifa(clave: str) -> int:
    """Las cifras salen de tools/tarifas.json, no de números escritos en la prueba."""
    from pathlib import Path
    t = json.loads((Path(__file__).resolve().parent.parent / "tools" / "tarifas.json").read_text(encoding="utf-8"))
    return {"edicion": t["editar"]["sugerencias"],
            "transcripcion": t["shorts"]["transcripcion_por_5min"]}[clave]
