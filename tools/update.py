"""Actualizar la herramienta a la ultima version publicada (rama main).

Parte determinista de la skill /actualizar. Dos modos:

  python tools/update.py --check            # SOLO informa: que hay de nuevo,
                                            # que cambios locales tienes. No toca nada.
  python tools/update.py --apply            # guarda tus cambios locales (stash),
                                            # fast-forward a origin/main, los reaplica,
                                            # instala deps SOLO si cambiaron, diagnostica.
  opciones:  --branch <rama>   (default: main — la rama de los alumnos)

Garantias:
- Nunca git reset --hard, nunca borra un stash, nunca toca videos/, .env ni
  .video-stack/ (estan en .gitignore: el pull no los ve).
- Solo avanza por fast-forward. Si tu copia DIVERGIO (commits locales), se detiene
  y lo explica — no intenta merges automaticos.
- Si al reaplicar tus cambios locales hay conflicto, deja los marcadores en el
  archivo y CONSERVA el stash: nada se pierde.

Exit code: 0 = al dia / actualizado; 2 = actualizacion disponible (solo --check);
1 = no se pudo (explica por que).
"""

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Archivos que el alumno edita LEGITIMAMENTE (su voz editorial y su marca).
# Un cambio local aqui es esperado, no un error — se preserva con stash/pop.
USER_EDITABLE = {
    ".claude/skills/clean-cut/SKILL.md": "tu politica de corte",
    "references/scoring-rubric.md": "tu rubrica de shorts",
    "brand.md": "tu marca",
    "remotion-longform/src/brand.ts": "tu marca (Remotion)",
    "remotion-longform/src/fonts.ts": "tus fuentes (Remotion)",
}

DEPS = {
    "requirements.txt": "python",
    "remotion/package.json": "remotion",
    "remotion-longform/package.json": "remotion-longform",
}


def git(*args, check=True) -> subprocess.CompletedProcess:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True,
                          text=True, encoding="utf-8", errors="replace", check=check)


def out(*args) -> str:
    return git(*args).stdout.strip()


def try_out(*args) -> str | None:
    r = git(*args, check=False)
    return r.stdout.strip() if r.returncode == 0 else None


def venv_python() -> str | None:
    cfg = ROOT / ".video-stack" / "config.json"
    if cfg.is_file():
        try:
            p = json.loads(cfg.read_text(encoding="utf-8")).get("venv_python")
            if p and Path(p).is_file():
                return p
        except (json.JSONDecodeError, OSError):
            pass
    for cand in (ROOT / "venv" / "Scripts" / "python.exe", ROOT / "venv" / "bin" / "python"):
        if cand.is_file():
            return str(cand)
    return None


def describe(ref: str) -> str:
    """'v1.1' si el ref es un tag; 'v1.0-clases-12-g93c6af2' (tag + commits
    encima) si no — asi nunca se lee 'v1.0 -> v1.0' cuando si hay cambios."""
    return try_out("describe", "--tags", ref) or "sin version etiquetada"


def inspect(branch: str) -> dict:
    """Fetch + comparacion. No modifica el working tree."""
    if not shutil.which("git"):
        return {"fatal": "git no esta instalado (o no esta en el PATH)."}
    if git("rev-parse", "--is-inside-work-tree", check=False).returncode != 0:
        return {"fatal": "esta carpeta no es un clon de git — la herramienta se actualiza desde el repo clonado."}
    if not try_out("remote", "get-url", "origin"):
        return {"fatal": "no hay remoto 'origin' configurado."}
    r = git("fetch", "--quiet", "--tags", "origin", branch, check=False)
    if r.returncode != 0:
        return {"fatal": f"no pude consultar el remoto (sin internet?): {r.stderr.strip()[:200]}"}

    current = out("rev-parse", "--abbrev-ref", "HEAD")
    local = out("rev-parse", "HEAD")
    remote = out("rev-parse", f"origin/{branch}")
    ff_ok = git("merge-base", "--is-ancestor", "HEAD", f"origin/{branch}", check=False).returncode == 0
    # sin merges (ruido para el alumno); si solo hubo merges, se muestran esos
    rng = f"HEAD..origin/{branch}"
    commits = [l.split("\t", 1) for l in out("log", "--no-merges", "--format=%h%x09%s", rng).splitlines() if l]
    if not commits:
        commits = [l.split("\t", 1) for l in out("log", "--format=%h%x09%s", rng).splitlines() if l]
    changed = [l for l in out("diff", "--name-only", "HEAD", f"origin/{branch}").splitlines() if l]
    # sin strip() global: el formato porcelain lleva el estado en las 2 primeras
    # columnas y un strip se comeria el espacio inicial de la primera linea
    local_mods = []
    for l in git("status", "--porcelain", "--untracked-files=no").stdout.splitlines():
        if l.strip():
            local_mods.append(l[3:].strip().replace("\\", "/"))
    return {
        "branch": branch, "current_branch": current,
        "local": local, "remote": remote, "up_to_date": local == remote,
        "fast_forward": ff_ok,
        "version_local": describe("HEAD"), "version_remote": describe(f"origin/{branch}"),
        "commits": commits, "changed": changed,
        "deps_changed": [f for f in changed if f in DEPS],
        "shots_changed": any(f.startswith("remotion-longform/src/shots/") for f in changed),
        "local_mods": local_mods,
        "local_mods_editable": [f for f in local_mods if f in USER_EDITABLE],
        "local_mods_other": [f for f in local_mods if f not in USER_EDITABLE],
        "upstream_touches_user_files": [f for f in changed if f in USER_EDITABLE],
    }


def report(info: dict) -> None:
    if info.get("fatal"):
        print(f"[ERROR] {info['fatal']}")
        return
    print(f"Rama actual: {info['current_branch']}  ·  version local: {info['version_local']}"
          f"  ·  publicada: {info['version_remote']}")
    if info["current_branch"] != info["branch"]:
        print(f"[AVISO] Estas en la rama '{info['current_branch']}', no en '{info['branch']}'. "
              f"La herramienta de los alumnos vive en '{info['branch']}'.")
    if info["up_to_date"]:
        print("[OK] Ya estas al dia — no hay nada que actualizar.")
    elif not info["fast_forward"]:
        print("[AVISO] Tu copia DIVERGIO del remoto (tienes commits propios). No actualizo "
              "automaticamente: hay que revisarlo a mano (git log --oneline origin/"
              f"{info['branch']}..HEAD muestra tus commits).")
    else:
        n = len(info["commits"])
        print(f"[NUEVO] {n} cambio{'s' if n != 1 else ''} publicado{'s' if n != 1 else ''}:")
        for sha, subj in info["commits"]:
            print(f"   {sha}  {subj}")
        print(f"   ({len(info['changed'])} archivos tocados)")
        if info["deps_changed"]:
            print(f"[DEPS] Cambiaron dependencias: {', '.join(info['deps_changed'])} — "
                  "se instalaran al aplicar.")
        if info["upstream_touches_user_files"]:
            print("[AVISO] La version nueva trae cambios en archivos que TU puedes haber editado: "
                  + ", ".join(f"{f} ({USER_EDITABLE[f]})" for f in info["upstream_touches_user_files"]))
    if info["local_mods"]:
        print("[LOCAL] Tienes cambios sin comitear:")
        for f in info["local_mods_editable"]:
            print(f"   {f}  <- {USER_EDITABLE[f]} (se conserva)")
        for f in info["local_mods_other"]:
            print(f"   {f}  <- cambio local fuera de los archivos editables (se conserva igual)")
        print("   Al aplicar: se guardan (git stash), se actualiza, y se reaplican. Si alguno "
              "choca con lo nuevo, el archivo queda con marcadores de conflicto y el stash se "
              "conserva — nada se pierde.")


def run_step(label: str, cmd: list[str], cwd: Path) -> bool:
    print(f"   -> {label}: {' '.join(cmd)}", flush=True)
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    if r.returncode != 0:
        tail = (r.stderr or r.stdout).strip().splitlines()[-5:]
        print(f"   [ERROR] {label} fallo:\n      " + "\n      ".join(tail))
        return False
    return True


def apply(info: dict) -> int:
    if info.get("fatal") or info["up_to_date"] or not info["fast_forward"]:
        report(info)
        return 0 if info.get("up_to_date") else 1
    if info["current_branch"] != info["branch"]:
        report(info)
        print(f"[ERROR] No aplico sobre la rama '{info['current_branch']}'. "
              f"Cambia a '{info['branch']}' o pasa --branch {info['current_branch']} a proposito.")
        return 1

    print(f"Actualizando {info['version_local']} -> {info['version_remote']} ...")
    stashed = False
    if info["local_mods"]:
        stamp = time.strftime("%Y-%m-%d %H:%M")
        r = git("stash", "push", "-m", f"actualizar {stamp}: cambios locales previos", check=False)
        if r.returncode != 0:
            print(f"[ERROR] no pude guardar tus cambios locales: {r.stderr.strip()[:200]}")
            return 1
        stashed = True
        print("   -> cambios locales guardados (git stash)")

    r = git("merge", "--ff-only", f"origin/{info['branch']}", check=False)
    if r.returncode != 0:
        print(f"[ERROR] fast-forward fallo: {r.stderr.strip()[:300]}")
        if stashed:
            git("stash", "pop", check=False)
            print("   -> tus cambios locales fueron restaurados; nada cambio.")
        return 1
    print(f"   -> codigo actualizado a {out('rev-parse', '--short', 'HEAD')}")

    conflicts = []
    if stashed:
        r = git("stash", "pop", check=False)
        if r.returncode == 0:
            print("   -> tus cambios locales reaplicados sin problema")
        else:
            conflicts = [l for l in out("diff", "--name-only", "--diff-filter=U").splitlines() if l]
            print("   [CONFLICTO] al reaplicar tus cambios locales. El stash se CONSERVA "
                  "(git stash list). Archivos con marcadores <<<<<<< / >>>>>>>:")
            for f in conflicts:
                print(f"      {f}  ({USER_EDITABLE.get(f, 'archivo del repo')})")

    # deps: solo lo que cambio
    ok = True
    if "requirements.txt" in info["deps_changed"]:
        py = venv_python()
        if py:
            ok &= run_step("deps de Python", [py, "-m", "pip", "install", "-q", "-r", "requirements.txt"], ROOT)
        else:
            print("   [AVISO] no encontre el venv — corre /instalar para las deps de Python nuevas")
            ok = False
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    for f, where in DEPS.items():
        if where == "python" or f not in info["deps_changed"]:
            continue
        if npm:
            ok &= run_step(f"deps de {where}", [npm, "install", "--silent"], ROOT / where)
        else:
            print(f"   [AVISO] npm no esta en el PATH — corre `npm install` en {where}/")
            ok = False
    if info["shots_changed"] and npm:
        ok &= run_step("registry de shots", [npm, "run", "gen", "--silent"], ROOT / "remotion-longform")

    # diagnostico de cierre
    print("Diagnostico:")
    sys.path.insert(0, str(ROOT / "tools"))
    try:
        from check_claude_login import credential_status
        st = credential_status()
        print("   [OK] sesion de Claude" if st["ok"] else
              "   [FALTA] sesion de Claude — pidele a Claude el login (claude /login)")
        ok &= st["ok"]
    except ImportError:
        pass
    cfg_ok = (ROOT / ".video-stack" / "config.json").is_file()
    print("   [OK] transcripcion configurada" if cfg_ok else
          "   [FALTA] .video-stack/config.json — corre /instalar")
    ok &= cfg_ok

    print()
    if conflicts:
        print(f"[LISTO CON CONFLICTOS] Estas en {describe('HEAD')}. Resuelve los archivos de "
              "arriba (conserva tu version o toma la nueva) y luego `git stash drop`.")
        return 1
    print(f"[LISTO] Estas en {describe('HEAD')}." +
          ("" if ok else " Algo del diagnostico marco FALTA: corre /instalar (es idempotente)."))
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    branch = "main"
    if "--branch" in args:
        branch = args[args.index("--branch") + 1]
    mode = "apply" if "--apply" in args else "check"
    info = inspect(branch)
    if mode == "check":
        report(info)
        if info.get("fatal"):
            return 1
        return 0 if info["up_to_date"] else 2
    return apply(info)


if __name__ == "__main__":
    sys.exit(main())
