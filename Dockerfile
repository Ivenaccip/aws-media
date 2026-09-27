# Imagen única del producto (plan AWS, A4): Python + ffmpeg + Node/Chromium.
# La misma imagen sirve para el server (uvicorn), los trabajos cortos (Lambda
# contenedor: mux, g2, subs) y los renders largos (Fargate: masters, Remotion).
#
# Exclusiones deliberadas (.dockerignore): media/ NO viaja (decisión D2 — la
# librería SFX no se redistribuye), ni .env, ni venv/, ni proyectos del usuario
# (videos/, work/): los media viven bajo MEDIA_ROOT (volumen local o S3).
FROM python:3.10-slim-bookworm

# ffmpeg + Chromium (Remotion renderiza con --browser-executable=$CHROMIUM_PATH)
# + libs que piden opencv/mediapipe en Linux (libgl1, libglib2.0-0)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg chromium fonts-liberation fonts-noto-color-emoji \
    libgl1 libglib2.0-0 curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Node 20 LTS (los dos proyectos Remotion), copiado de la imagen oficial.
#
# Esto era `curl -fsSL https://deb.nodesource.com/setup_20.x | bash -`, y el
# 2026-09-14 ese curl murió a mitad de un build con «Recv failure: Connection
# reset by peer». El build no se detuvo ahí: el script de NodeSource anuncia sus
# propios fallos y sale con cero — «Failed to download and import the NodeSource
# signing key (Exit Code: 0)» —, así que el `&&` siguió adelante y apt instaló
# el nodejs de Debian, 18.20.4. Sin npm: en Debian npm es un paquete aparte y
# solo «recomendado», y aquí se instala con --no-install-recommends. El build
# siguió cuatro pasos más y reventó con `npm: not found`.
#
# Lo que estuvo en juego no fue esa tarde, fue la reproducibilidad: si npm
# hubiera entrado de todos modos, la imagen se habría construido entera con Node
# 18 y nadie se habría enterado — Remotion 4 arranca en 18. La versión de Node
# de la imagen dependía de si una descarga de un tercero funcionaba ese día.
#
# Copiarla de la imagen oficial fija la versión exacta, quita esa descarga (y su
# apt-get update) del build, y no añade un origen nuevo: bookworm-slim es la
# misma base Debian que la imagen de Python de arriba.
COPY --from=node:20.20.2-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20.20.2-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

# El seguro contra la próxima vez: si Node o npm no quedan como se espera, el
# build muere AQUÍ, diciendo por qué, y no cuatro pasos más abajo en un `npm ci`
# que solo sabe responder «not found».
RUN node --version && npm --version && npx --version \
 && case "$(node --version)" in \
      v20.*) ;; \
      *) echo "Node no quedo en la linea 20 - revisa el COPY --from de arriba"; exit 1 ;; \
    esac

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    MEDIA_ROOT=/data \
    CHROMIUM_PATH=/usr/bin/chromium

# deps Python fijadas (cache de capa: solo se reinstala si cambia requirements)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
# runtime interface client de Lambda (C1): el default CMD sigue siendo uvicorn;
# la Lambda sobreescribe entrypoint/cmd a awslambdaric + server.lambda_handler
RUN pip install --no-cache-dir "awslambdaric>=2,<4"
# M11 default: el alineador de la ruta narración (faster-whisper "small") viaja
# horneado — sin esto cada tarea Fargate bajaría ~460 MB de HuggingFace al vuelo
RUN python -c "from faster_whisper import WhisperModel; WhisperModel('small', device='cpu', compute_type='int8')"

# deps de los dos proyectos Remotion (shorts captions / beats longform)
COPY remotion/package.json remotion/package-lock.json remotion/
RUN cd remotion && npm ci --no-audit --no-fund
COPY remotion-longform/package.json remotion-longform/package-lock.json remotion-longform/
RUN cd remotion-longform && npm ci --no-audit --no-fund

COPY . .

RUN mkdir -p /data/videos /data/work

EXPOSE 8011
CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8011}"]
