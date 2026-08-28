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

# Node 20 LTS (los dos proyectos Remotion)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PYTHONIOENCODING=utf-8 \
    MEDIA_ROOT=/data \
    CHROMIUM_PATH=/usr/bin/chromium

# deps Python fijadas (cache de capa: solo se reinstala si cambia requirements)
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# deps de los dos proyectos Remotion (shorts captions / beats longform)
COPY remotion/package.json remotion/package-lock.json remotion/
RUN cd remotion && npm ci --no-audit --no-fund
COPY remotion-longform/package.json remotion-longform/package-lock.json remotion-longform/
RUN cd remotion-longform && npm ci --no-audit --no-fund

COPY . .

RUN mkdir -p /data/videos /data/work

EXPOSE 8011
CMD ["sh", "-c", "uvicorn server.app:app --host 0.0.0.0 --port ${PORT:-8011}"]
