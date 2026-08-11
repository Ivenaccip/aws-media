---
name: empezar
description: Puerta de entrada de cada proyecto de video. Actívate ÚNICA y EXCLUSIVAMENTE cuando el usuario escriba el comando explícito /empezar. NO te actives por frases sin el comando — "quiero empezar", "nuevo video", "vamos a editar", "tengo un video" o similares NO son triggers (si detectas esa intención sin el comando, sugiérele escribir /empezar y detente). Crea el proyecto video-N, recibe el video crudo, transcribe UNA vez (con preview de costo si es nube) y pregunta el camino: ¿editar un video para redes o convertir un video largo a shorts? — y arranca /clean-cut o /shorts según la respuesta.
---

# empezar — la puerta de entrada de cada proyecto

Un solo comando para arrancar cualquier proyecto. Hace el tramo COMPARTIDO de los
dos caminos (proyecto → video → transcript) y al final bifurca con la pregunta.

**Trigger estricto**: solo el comando `/empezar`. Sin el comando, no te actives.

## Flujo

### 0. Prerrequisitos (rápido, sin sermón)

- ¿Existe `.video-stack/config.json`? Si no: "primero corre `python tools/setup.py`"
  y detente ahí (es una vez en la vida, no lo hagas tú en silencio: el usuario debe
  elegir su backend de transcripción).
- `/brand-setup` NO es prerrequisito — no lo menciones salvo que pregunten.

### 1. Crear el proyecto

Detecta el siguiente número libre (`videos/video-N`) y créalo:

```bash
python tools/project.py new video-N
```

Si hay proyectos a medias, NO los toques ni preguntes por ellos — `/empezar`
siempre es proyecto nuevo (para retomar uno existente está `/ayuda`).

### 2. Recibir el video crudo

Pide la ruta del video (o acéptala si ya la dio con el comando). Muévelo o cópialo
a `videos/video-N/` conservando extensión (pregunta si prefiere mover o copiar
solo cuando el archivo esté fuera del repo y sea grande — copiar duplica gigas).
Verifica con ffprobe que es un video válido y anota duración, resolución y fps —
la duración la necesitas para el preview de costo.

### 3. Transcribir — UNA vez, con costo antes si es nube

**Primero extrae el WAV que `transcribe.py` consume** (sin este paso, el primer
intento falla con "nada que transcribir") — uno por clip:

```bash
mkdir -p videos/video-N/work/audio
ffmpeg -i videos/video-N/<clip>.MP4 -vn -ac 1 -ar 16000 videos/video-N/work/audio/<id>.wav
```

(mismo formato que `/clean-cut` paso 2: 16 kHz mono; `<id>` = nombre del clip sin
extensión). Luego lee el backend de `.video-stack/config.json`:

- **Local**: corre directo `python tools/transcribe.py videos/video-N` (costo $0).
- **Nube (AssemblyAI)**: ANTES de correr, muestra el preview en el chat con datos
  de `tools/pricing.json`: duración del video × tarifa por hora ("$X.XX dólares",
  jamás "centavos"; del free tier: "verifica tu crédito en el dashboard"). Con el
  sí del usuario, corre la tool. **Corrida en nube sin preview de costo = bug.**

El resultado es el canónico `work/transcripts/<id>.canonical.json` — ambos caminos
lo consumen y NUNCA se vuelve a transcribir este proyecto.

### 4. La bifurcación (la pregunta del camino)

Pregunta con el selector de opciones, textual:

> **¿Qué quieres hacer con este video?**
> 1. **Editar un video para redes** — cortar relleno, subtítulos, b-roll con IA →
>    un video pulido para publicar
> 2. **Convertir un video largo a shorts** — extraer los mejores momentos como
>    clips verticales (YouTube Shorts, TikTok, Reels)

- Opción 1 → arranca el camino edición invocando `/clean-cut` sobre este proyecto.
- Opción 2 → arranca el camino shorts invocando `/shorts` sobre este proyecto.

Aclárale en una línea que los caminos no son excluyentes: al terminar uno puede
correr el otro sobre el mismo proyecto (los shorts salen mejor del video ya editado).

## Reglas

- **Nunca re-transcribas** un proyecto que ya tiene canónico (si por error corren
  `/empezar` sobre material ya procesado, detecta el canónico y salta al paso 4).
- **No adelantes trabajo de los caminos**: `/empezar` termina cuando la skill del
  camino elegido toma el control. Nada de "de una vez te propongo cortes".
- Los datos del ffprobe del paso 2 (duración/resolución/fps) déjalos dichos en el
  chat — las skills del camino los reutilizan sin re-probar.
- Si el usuario ya sabe su camino ("`/empezar` quiero shorts de este video"),
  respeta los pasos 0-3 igual y sáltate solo la pregunta.
