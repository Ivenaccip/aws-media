---
name: instalar
description: Onboarding e instalación de la herramienta — se hace UNA vez (y se re-corre sin miedo si cambia de máquina o de hardware). Úsala cuando el usuario escriba /instalar, diga "acabo de clonar el repo", "cómo instalo la herramienta", "configúrame todo desde cero", "no me corre nada", o pregunte qué necesita para arrancar. Cubre el diagnóstico idempotente (qué está y qué falta), venv + requirements fijados, ffmpeg/Node/jq, la decisión de transcripción con tools/setup.py (flags no-interactivos), el selector de conexiones OPCIONALES (Blotato, GPT Image, fal.ai, AssemblyAI — no elegir nada = todo local) y el cierre con el siguiente paso. Las API keys van en .env, NUNCA se piden en el chat.
---

# instalar — el onboarding, una sola vez

Deja la herramienta lista para `/empezar`. **Idempotente por diseño**: siempre
arranca con el diagnóstico y solo instala/configura lo que falte — re-correrla es
seguro (cambio de máquina, GPU nueva, alumno que se atoró a la mitad).

## Etapa 1 — Diagnóstico (siempre primero)

Verifica en orden y presenta la tabla "listo / falta" (sin sermones — dos líneas
por punto):

| Qué | Cómo verificar |
|---|---|
| Python 3.10+ | `python --version` |
| venv con deps | existe `venv/` y `venv/Scripts/python -c "import faster_whisper"` sale bien |
| ffmpeg + ffprobe | `ffmpeg -version` |
| Node 18+ | `node --version` |
| jq (Windows/Git Bash) | `jq --version` |
| Deps de Remotion | `remotion/node_modules/` y `remotion-longform/node_modules/` existen |
| Transcripción configurada | `.video-stack/config.json` existe |
| `.env` | existe (aunque esté vacío) |
| Sesión de Claude (chat del editor) | `python tools/check_claude_login.py` sale `[OK]` |

**Si todo está** → "Ya estás instalado" + resumen de su configuración (backend de
transcripción, qué conexiones tiene) + "escribe `/empezar` cuando tengas tu primer
video". Fin.

## Etapa 2 — Instalar lo que falte

- **venv + deps** (la receta vive en el encabezado de `requirements.txt`):
  `python -m venv venv` → `venv/Scripts/pip install -r requirements.txt`.
  Con GPU NVIDIA, ANTES: `pip install torch --index-url https://download.pytorch.org/whl/cu128`.
- **Remotion**: `npm install` en `remotion/` y en `remotion-longform/`.
- **ffmpeg / Node / jq ausentes**: proponer los comandos de winget
  (`winget install Gyan.FFmpeg`, `winget install OpenJS.NodeJS.LTS`,
  `winget install jqlang.jq`) y que el usuario apruebe — instalar software del
  sistema siempre con su OK. Tras instalar, abrir terminal nueva para el PATH.
- **`.env`**: si no existe, copiarlo de `.env.example` (vacío está bien).
- **Sesión de Claude ausente**: el chat embebido del editor de cortes la necesita
  (`claude-agent-sdk` usa la sesión del CLI). Entrega `claude /login` en su
  propio bloque ```bash``` (sale con botón Run — un click) + los pasos: click
  en Run → autorizar en el navegador → "avísame con listo"; luego re-corre el
  chequeo para confirmar `[OK]`. Es una vez por máquina y la sesión se refresca
  sola. El login es SIEMPRE con el CLI oficial — nunca ligas OAuth a mano, ni
  tokens ni códigos en el chat.
- Reglas del repo que se explican aquí en una línea cada una: todo se corre desde
  la raíz; en Windows es Git Bash (sin WSL); `.env` jamás se comitea.

## Etapa 3 — Configurar la transcripción (la única decisión obligatoria)

Pregunta en el chat (no dejes que `setup.py` pregunte por stdin):

1. ¿Cuántas horas de material grabas al mes? (aprox)
2. ¿Necesitas trabajar sin internet?

Luego corre **no-interactivo**: `python tools/setup.py --hours H --offline yes|no`
(deja que calibre — mide la velocidad REAL de su máquina, con o sin GPU; ese dato
es el que hace obvia la decisión local vs nube). Presenta el resultado en dos
líneas: backend elegido y por qué (velocidad calibrada o "$0.21 dólares por hora"
— precios SOLO de `tools/pricing.json`). Si eligió AssemblyAI, necesita su key en
`.env` (ver Etapa 4, regla de keys).

## Etapa 4 — Conexiones opcionales (el selector)

Presenta el selector de opciones múltiples, con este encuadre: **"Todas son
opcionales — cada una mejora una parte de la experiencia. No elegir ninguna =
todo local y gratis. Puedes conectarlas después en cualquier momento."**

1. **Blotato** — publicar en tus redes desde aquí y generar el b-roll con IA
   (imágenes + video). Más adelante: investigación de mercado y respuestas a
   clientes. → Conexión: MCP de Blotato (OAuth, plan de pago, requiere reiniciar
   Claude Code) — guion paso a paso en
   `.claude/skills/broll-ai/references/conectar.md` **[PENDIENTE-LIGA-VIDEO:
   tutorial en video de la conexión de Blotato]**.
2. **AssemblyAI** — transcripción en nube: ya no esperas a tus recursos locales;
   1 hora de video por $0.21 dólares. → `ASSEMBLYAI_API_KEY` en `.env`; si quiere
   cambiarse de backend: `python tools/setup.py --asr assemblyai`.
3. **API de GPT Image** — imágenes por bajo costo pagando solo lo que usas (vía
   API, independiente de tu suscripción de ChatGPT). Solo hace falta si NO vas a
   usar Blotato para el b-roll. → `OPENAI_API_KEY` en `.env`.
4. **fal.ai** — agregador de modelos: videos e imágenes a bajo costo; el respaldo
   de generación cuando Blotato se quede sin créditos. → `FAL_KEY` en `.env` (o su
   MCP si lo conecta); guion paso a paso en
   `.claude/skills/broll-ai/references/conectar.md`.

**Regla dura de keys: NUNCA pidas una API key en el chat.** Diles dónde
conseguirla y que la peguen ellos en `.env` con su editor; tú solo verificas
después que la variable existe (sin imprimir su valor).

## Etapa 5 — Cierre

1. Smoke test: `ffmpeg -version` OK, import de `faster_whisper` OK (si backend
   local), `.video-stack/config.json` presente, y
   `python tools/check_claude_login.py` sale `[OK]` — si salió `[FALTA]`,
   resuélvelo aquí (Etapa 2) antes de despedirte: este es el ÚLTIMO momento
   natural para el login; después de `/instalar` ya nadie debería toparse con él.
2. Menciona una vez, sin insistir: `/brand-setup` existe para poner SU marca en
   todos los renders — **es opcional, puede omitirse** (la marca de la casa es
   completa) y se puede correr cuando quiera.
3. Despedida con el siguiente paso concreto: "Listo. Cuando tengas tu primer
   video, escribe `/empezar`." (Y `/ayuda` para cualquier duda.)

## Reglas

- Diagnóstico antes que todo; nunca reinstalar lo que ya está.
- Las decisiones son del usuario: backend de transcripción y conexiones se eligen,
  no se asumen. Lo único que se instala sin preguntar son las deps del propio repo
  (venv, requirements, npm install).
- Instalación de software del sistema (winget) siempre con aprobación explícita.
- Sin GPU NO es bloqueante: la calibración de `setup.py` lo maneja (int8+cpu
  corre en cualquier máquina) y los renders detectan el encoder por hardware solos.
- Si algo falla a la mitad, el usuario puede re-correr `/instalar` — el
  diagnóstico retoma donde quedó.
