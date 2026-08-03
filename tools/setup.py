"""Setup de video-stack: escaneo de hardware + calibración real + recomendación.

Usage:
  python tools/setup.py                 # interactivo
  python tools/setup.py --hours 10 --offline no          # sin preguntas
  python tools/setup.py --skip-calibration --model medium --asr local
  python tools/setup.py --calibrate-models small,medium  # calibrar más modelos

RE-EJECUTABLE por diseño: cambiar de máquina o comprar GPU = correrlo otra vez.
Escribe .video-stack/config.json (gitignored — cada máquina la suya, sin pisarse).

Reglas duras (handoff §5-§6):
- Reporta la calibración en TIEMPO ("1 hora te tomaría ~12 min"), no en specs.
- Tres rutas, la nube como conveniencia — nunca como rescate.
- Precios SOLO desde tools/pricing.json. En UI: "$0.21 dólares por hora", jamás "centavos".
- Nada del free tier de AssemblyAI se promete: "verifica tu crédito en el dashboard".
- Para español: prohibidas las variantes .en — solo modelos multilingües.
"""

import argparse
import ctypes
import io
import json
import os
import platform
import shutil
import subprocess
import sys
import time
from pathlib import Path

# Consolas Windows heredadas usan cp1252 y truenan con ✓/·/⚠ — forzar UTF-8.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

REPO = Path(__file__).resolve().parent.parent
PRICING = json.loads((REPO / "tools" / "pricing.json").read_text(encoding="utf-8"))
CALIBRATION_WAV = REPO / "assets" / "calibration" / "calibration-es.wav"
CONFIG_DIR = REPO / ".video-stack"
CONFIG = CONFIG_DIR / "config.json"

# Multilingües únicamente (nunca .en). VRAM aprox en float16; int8 ~ mitad.
MODELS = {
    "small":    {"vram_gb": 2,  "ram_gb_cpu": 3},
    "medium":   {"vram_gb": 5,  "ram_gb_cpu": 6},
    "large-v3": {"vram_gb": 10, "ram_gb_cpu": 12},
}


# ---------------------------------------------------------------- hardware scan

def scan_nvidia():
    """(vram_total_gb, vram_libre_gb) o None si no hay nvidia-smi."""
    exe = shutil.which("nvidia-smi")
    if not exe:
        return None
    try:
        out = subprocess.run(
            [exe, "--query-gpu=memory.total,memory.free", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=15, check=True).stdout.strip()
        total, free = (float(x) for x in out.splitlines()[0].split(","))
        return round(total / 1024, 1), round(free / 1024, 1)
    except Exception:
        return None


def scan_apple_silicon():
    """Memoria unificada en GB vía sysctl (nvidia-smi no existe en Apple Silicon)."""
    if sys.platform != "darwin" or platform.machine() != "arm64":
        return None
    try:
        out = subprocess.run(["sysctl", "-n", "hw.memsize"],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        return round(int(out.strip()) / 1024 ** 3, 1)
    except Exception:
        return None


def ram_free_gb():
    if sys.platform == "win32":
        class MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtualExtended", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong)]
        st = MEMORYSTATUSEX(); st.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(st))
        return round(st.ullAvailPhys / 1024 ** 3, 1)
    if sys.platform == "darwin":
        try:
            total = int(subprocess.run(["sysctl", "-n", "hw.memsize"], capture_output=True,
                                       text=True, timeout=10).stdout.strip())
            return round(total * 0.5 / 1024 ** 3, 1)  # aproximación conservadora
        except Exception:
            return None
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable"):
                return round(int(line.split()[1]) / 1024 ** 2, 1)
    except Exception:
        return None


def disk_free_gb():
    return round(shutil.disk_usage(REPO).free / 1024 ** 3, 1)


def find_venv_python():
    """Python con faster-whisper: venv del repo > ~/.video-skill > ~/.shorts-skill."""
    exe = "python.exe" if sys.platform == "win32" else "python3"
    candidates = [REPO / "venv" / "Scripts" / exe, REPO / "venv" / "bin" / "python3",
                  Path.home() / ".video-skill" / "bin" / "python3",
                  Path.home() / ".video-skill" / "Scripts" / exe,
                  Path.home() / ".shorts-skill" / "bin" / "python3",
                  Path.home() / ".shorts-skill" / "Scripts" / exe]
    for p in candidates:
        if p.exists():
            r = subprocess.run([str(p), "-c", "import faster_whisper"],
                               capture_output=True, timeout=60)
            if r.returncode == 0:
                return p
    return None


def ensure_bin_alias(venv: Path):
    """Los scripts de S1 asumen $VENV/bin/ (POSIX). En un venv Windows solo existe
    Scripts/ — se crea bin/ con copias (DECISIONES pendiente #1)."""
    scripts, bin_dir = venv / "Scripts", venv / "bin"
    if sys.platform != "win32" or not scripts.exists() or bin_dir.exists():
        return
    bin_dir.mkdir()
    for name, target in [("python3.exe", "python.exe"), ("python.exe", "python.exe"),
                         ("pip.exe", "pip.exe"), ("activate", "activate")]:
        src = scripts / target
        if src.exists():
            shutil.copy2(src, bin_dir / name)
    print(f"  alias bin/ creado en {venv} (compatibilidad con scripts de S1)")


def check_cli_deps():
    missing = [c for c in ("ffmpeg", "ffprobe", "node") if not shutil.which(c)]
    if sys.platform == "win32":
        for c in ("bash", "jq"):
            if not shutil.which(c):
                missing.append(f"{c} (requisito Windows: Git Bash + jq — ver docs/DECISIONES.md)")
    return missing


# ---------------------------------------------------------------- calibración

CALIB_SNIPPET = r"""
import json, sys, time
from faster_whisper import WhisperModel
wav, model_size, device, compute = sys.argv[1:5]
model = WhisperModel(model_size, device=device, compute_type=compute)  # descarga/carga fuera del cronómetro
t0 = time.perf_counter()
segments, info = model.transcribe(wav, beam_size=5, word_timestamps=True)
n = sum(len(s.words or []) for s in segments)
elapsed = time.perf_counter() - t0
print(json.dumps({"elapsed": elapsed, "audio": info.duration, "words": n}))
"""


def calibrate(py: Path, model: str, device: str, compute: str):
    """Transcribe el WAV de muestra y devuelve minutos-por-hora-de-audio, o None."""
    print(f"  calibrando {model} ({device}/{compute})... "
          "(la primera vez descarga el modelo; la descarga no se cronometra)")
    r = subprocess.run([str(py), "-c", CALIB_SNIPPET, str(CALIBRATION_WAV),
                        model, device, compute],
                       capture_output=True, text=True, timeout=3600)
    if r.returncode != 0:
        print(f"  {model}: calibración falló — {r.stderr.strip().splitlines()[-1] if r.stderr.strip() else '?'}")
        return None
    data = json.loads(r.stdout.strip().splitlines()[-1])
    min_per_hour = data["elapsed"] / data["audio"] * 60
    return round(min_per_hour, 1)


# ---------------------------------------------------------------- recomendación

def eligible_models(vram_free, ram_free, has_gpu):
    """Modelos que corren en este equipo, con su device/compute. Siempre hay ruta:
    int8 + cpu corre en cualquier máquina (lento pero universal)."""
    out = {}
    for name, req in MODELS.items():
        if has_gpu and vram_free and vram_free >= req["vram_gb"]:
            out[name] = ("cuda", "float16")
        elif has_gpu and vram_free and vram_free >= req["vram_gb"] / 2:
            out[name] = ("cuda", "int8")
        elif ram_free is None or ram_free >= req["ram_gb_cpu"] / 2:
            out[name] = ("cpu", "int8")
    return out


def cloud_cost_line(hours):
    m = PRICING["assemblyai"]["models"]["universal-3-5-pro"]["usd_per_hour"]
    k = PRICING["assemblyai"]["addons"]["keyterms_prompt"]["usd_per_hour"]
    base, con_kt = hours * m, hours * (m + k)
    return (f"{hours} h/mes ≈ ${base:.2f} dólares al mes con Universal-3.5 Pro "
            f"(${m:.2f} dólares por hora; ${con_kt:.2f} con keyterms), facturado por segundo. "
            "Free tier: verifica tu crédito en el dashboard de AssemblyAI.")


def ask(question, default):
    try:
        r = input(f"{question} [{default}]: ").strip()
        return r or default
    except EOFError:
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hours", type=float, help="horas de material al mes (evita la pregunta)")
    ap.add_argument("--offline", choices=["yes", "no"], help="¿trabajar sin internet?")
    ap.add_argument("--asr", choices=["local", "assemblyai"], help="forzar ruta")
    ap.add_argument("--model", help="forzar modelo local (small|medium|large-v3)")
    ap.add_argument("--skip-calibration", action="store_true")
    ap.add_argument("--calibrate-models", default="small",
                    help="modelos a calibrar, coma-separados (default: small)")
    args = ap.parse_args()

    print("== video-stack setup (re-ejecutable — corre esto otra vez si cambias de máquina) ==\n")

    # 1) escaneo
    print("[1/5] Escaneo de hardware")
    nv = scan_nvidia()
    apple = scan_apple_silicon()
    ram, disk = ram_free_gb(), disk_free_gb()
    if nv:
        print(f"  GPU NVIDIA: {nv[0]} GB VRAM total, {nv[1]} GB libres")
    elif apple:
        print(f"  Apple Silicon: {apple} GB de memoria unificada")
    else:
        print("  Sin GPU NVIDIA / Apple Silicon — la ruta local sigue siendo viable (int8 + cpu)")
    print(f"  RAM libre: {ram} GB · Disco libre: {disk} GB")
    if disk < 12:
        print("  ⚠ large-v3 pesa varios GB descargado; con poco disco los instaladores "
              "fallan sin avisar. Considera small/medium o libera espacio.")
    missing = check_cli_deps()
    if missing:
        print("  ⚠ Faltan en PATH: " + ", ".join(missing))

    vram_free = nv[1] if nv else (apple * 0.65 if apple else None)
    has_gpu = bool(nv)  # faster-whisper usa CUDA; en Apple corre por CPU int8
    options = eligible_models(vram_free, ram, has_gpu)

    # 2) calibración real (no solo specs)
    print("\n[2/5] Calibración real (transcribe ~80 s de muestra y extrapola)")
    measured = {}
    py = find_venv_python()
    if args.skip_calibration:
        print("  omitida (--skip-calibration)")
    elif not py:
        print("  faster-whisper no está instalado en ningún venv conocido "
              "(venv/ del repo, ~/.video-skill, ~/.shorts-skill).")
        print("  Instálalo con: python -m venv venv && venv/Scripts/pip install -r requirements.txt")
        print("  La calibración se omite por ahora; el setup sigue siendo re-ejecutable.")
    else:
        print(f"  usando {py}")
        for m in [x.strip() for x in args.calibrate_models.split(",") if x.strip()]:
            if m not in MODELS:
                print(f"  {m}: no es un modelo multilingüe soportado (nada de variantes .en)")
                continue
            if m not in options:
                print(f"  {m}: no cabe cómodo en este equipo, se omite")
                continue
            device, compute = options[m]
            mph = calibrate(py, m, device, compute)
            if mph:
                measured[m] = mph
                print(f"  ✓ Transcribir 1 hora te tomaría ~{mph:.0f} min con `{m}` ({device}/{compute})")
        for m in options:
            if m not in measured and measured:
                base = next(iter(measured))
                factor = MODELS[m]["vram_gb"] / MODELS[base]["vram_gb"]
                est = measured[base] * factor
                print(f"  · estimado (sin medir): 1 hora ≈ ~{est:.0f} min con `{m}` — "
                      f"calíbralo con --calibrate-models {m}")

    # 3) dos preguntas de contexto
    print("\n[3/5] Contexto de uso")
    hours = args.hours if args.hours is not None else float(ask("¿Cuántas horas de material procesas al mes?", "10"))
    offline = args.offline or ask("¿Necesitas trabajar sin internet? (yes/no)", "no")
    offline = offline == "yes"

    # 4) recomendación — tres rutas, la nube como conveniencia (nunca como rescate)
    print("\n[4/5] Tus tres rutas")
    best_local = next((m for m in ("large-v3", "medium", "small") if m in measured), None) or \
        next((m for m in ("large-v3", "medium", "small") if m in options), "small")
    b_dev, b_comp = options.get(best_local, ("cpu", "int8"))
    t = f" (~{measured[best_local]:.0f} min por hora de material, medido en TU equipo)" if best_local in measured else ""
    print(f"  A. Local con `{best_local}` ({b_dev}/{b_comp}) — gratis{t}.")
    print("  B. Local universal: `small` o `medium` con int8 + cpu — gratis, más lento, "
          "corre en cualquier máquina y funciona sin internet.")
    print(f"  C. Nube (AssemblyAI) — también existe la ruta de nube si prefieres no "
          f"instalar nada: {cloud_cost_line(hours)}")
    if offline:
        print("  Como necesitas trabajar sin internet, tu ruta principal es local (A o B); "
              "la nube queda para cuando tengas conexión.")

    recommended_asr = "local" if offline else ("assemblyai" if (hours <= 5 and not measured) else "local")
    if args.asr:
        recommended_asr = args.asr
    model = args.model or (best_local if recommended_asr == "local" else "universal-3-5-pro")
    if recommended_asr == "local":
        device, compute = options.get(model, ("cpu", "int8"))
    else:
        device, compute = "cloud", "n/a"

    # 5) config por máquina
    print("\n[5/5] Escribiendo config")
    CONFIG_DIR.mkdir(exist_ok=True)
    cfg = {
        "schema_version": "1.0",
        "asr": recommended_asr,
        "model": model,
        "compute_type": compute,
        "device": device,
        "machine": platform.node(),
        "updated_on": time.strftime("%Y-%m-%d"),
        "calibration_min_per_hour": measured or None,
        "venv_python": str(py) if py else None,
    }
    CONFIG.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
    if py and "Scripts" in str(py):
        ensure_bin_alias(py.parent.parent)
    gitignore = (REPO / ".gitignore").read_text(encoding="utf-8")
    assert ".video-stack/" in gitignore, ".video-stack/ debe estar en .gitignore"
    print(f"  ✓ {CONFIG.relative_to(REPO)} — asr={recommended_asr}, model={model}, "
          f"device={device}, compute_type={compute}")
    print("\nListo. Puedes re-correr este setup cuando quieras; la config es por máquina "
          "y nunca se comitea.")


if __name__ == "__main__":
    main()
