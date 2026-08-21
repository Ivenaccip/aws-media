---
name: actualizar
description: Actualiza la herramienta a la última versión publicada (rama main) sin perder nada del usuario. Úsala cuando el usuario escriba /actualizar, diga "actualiza la herramienta", "hay versión nueva", "baja los cambios", "update", "¿estoy en la última versión?", o cuando /ayuda o una skill detecten que su copia está atrasada. Cubre el reporte de qué hay de nuevo en lenguaje humano (tools/update.py --check), el gate de confirmación, la aplicación segura (stash de sus cambios locales → fast-forward → reaplicar → deps solo si cambiaron) y el diagnóstico de cierre. Nunca borra trabajo del usuario: videos/, .env y .video-stack/ ni se tocan; su política de corte y su marca se conservan.
---

# actualizar — traer la última versión sin perder lo tuyo

Equivalente a "descargar la actualización" de cualquier app. El trabajo delicado de
git lo hace `tools/update.py`; tú traduces su salida a lenguaje humano y cuidas el
gate. El alumno normalmente llega aquí porque le avisaron "hay versión nueva".

## Flujo

### 1. Mirar qué hay (sin tocar nada)

```bash
python tools/update.py --check
```

- **`[OK] Ya estás al día`** → díselo con su versión y termina. Fin.
- **`[AVISO] … DIVERGIÓ`** (tiene commits propios) → no se actualiza solo. Explícale
  en dos líneas: su copia tiene commits locales; la salida del tool trae el comando
  para verlos; lo normal es que los guarde en una rama (`git branch mis-cambios`)
  y le pida ayuda a `/ayuda` — no intentes merges tú.
- **`[AVISO] Estás en la rama 'X', no en 'main'`** → para alumnos, main es la
  rama; pregúntale si cambió de rama a propósito antes de seguir.
- **`[NUEVO]`** → sigue al paso 2.

### 2. Contarle qué cambia (el gate)

Traduce los commits a **qué cambia para él**, agrupado por skill/función, en 3-6
viñetas cortas ("el login de Claude ahora te lo da `/instalar` con un botón";
"los subtítulos traen el formato de la casa"). Sin shas, sin jerga de git. Luego:

- Si salió **`[DEPS]`**: "también instalo dependencias nuevas (1-3 min)".
- Si salió **`[LOCAL]`**: dile qué archivos suyos tiene modificados y que **se
  conservan** (se guardan, se actualiza y se reaplican). Si además salió
  `[AVISO] La versión nueva trae cambios en archivos que TÚ puedes haber
  editado`, avísale que ahí podría haber un choque y que el tool lo deja
  marcado sin perder su versión.

Pregunta: **"¿Actualizo?"** y espera el sí. Es un gate real: cambia archivos de su
repo.

### 3. Aplicar

```bash
python tools/update.py --apply
```

Lee la salida completa:

- **`[LISTO] Estás en vX`** → cierre (paso 4).
- **`[LISTO CON CONFLICTOS]`** → su cambio local chocó con lo nuevo en los archivos
  listados (casi siempre su política de corte o su marca). El tool dejó
  marcadores `<<<<<<<`/`>>>>>>>` y **conservó el stash**. Ofrécele las dos salidas
  en lenguaje llano y hazlo tú con su elección, archivo por archivo:
  - *conservar lo suyo*: `git checkout --theirs <archivo>` (en un stash pop,
    "theirs" = su versión guardada) y luego `git add <archivo>`;
  - *tomar lo nuevo*: `git checkout --ours <archivo>` y `git add <archivo>`.
  Al terminar todos: `git stash drop`. Si duda, que conserve lo suyo — su voz
  editorial es suya.
- **`[ERROR]`** → el tool ya revirtió o no tocó nada; muéstrale la causa (sin
  internet, venv ausente, npm ausente) y el siguiente paso (`/instalar` para
  deps faltantes).

### 4. Cierre

Una línea con la versión nueva y, si el diagnóstico marcó `[FALTA]`, el siguiente
paso concreto: sesión de Claude → el login (`claude /login` como comando clickeable,
ver `/instalar`); config ausente → `/instalar`. Recuérdale que sus proyectos en
`videos/` están intactos y que puede seguir donde iba (`/ayuda` le dice en qué paso
está).

## Reglas

- **Jamás** `git reset --hard`, `git checkout .`, `git stash drop` sin conflicto
  resuelto, ni borrar ramas. El tool tampoco lo hace.
- No actualices sin el "sí" del paso 2. `--check` es gratis; `--apply` no.
- No toques `videos/`, `.env`, `.video-stack/` — ni los menciones como riesgo: están
  fuera de git por diseño.
- Si el alumno no tiene internet, no hay actualización; díselo y punto.
- Si ves varios `[FALTA]` al cierre, manda a `/instalar` (idempotente) en vez de
  arreglar a mano aquí.
