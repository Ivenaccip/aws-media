# PLAN DE IMPLEMENTACIÓN — Servicio AWS de edicion_y_generacion

**Fecha:** 2026-08-27 · **Estado:** A1 completada (commit 5c20215)
**Repo de esta versión:** github.com/Ivenaccip/**aws-media** (PRIVADO) = `D:\aws-project`, con toda la historia de edicion_y_generacion (remote local `source` = `D:\adquisition\video-stack`, para traer cambios futuros de allá). El working copy de adquisition conserva los cambios de A1 SIN commitear — la fusión original no se toca.
**Copia de desarrollo activa (desde 2026-08-27):** `D:\aws-project`, con venv propio (Python 3.10) y `.env` con `MEDIA_ROOT=D:\adquisition\video-stack` — los proyectos (`videos/`, `work/`) se leen del working copy original sin duplicarlos (primer uso real de A1). 67 tests verdes y gen-tesla abre en el editor desde aquí. Mover los media físicamente queda para cuando convenga (solo cambiar esa línea del `.env`).
**Fuente:** `D:\adquisition\HANDOFF-fusion-aws.md` (Fases 0-3 y F3.5 caso B completadas en local) + decisiones de riesgos acordadas el 2026-08-27.
**Código del producto:** `D:\adquisition\video-stack` (repo privado `edicion_y_generacion`, main = fusión). **No se crea un fork AWS**: la app es una sola; esta carpeta (`D:\aws-project`) contiene el plan y, más adelante, la infraestructura (IaC) si se decide repo aparte.

---

## Principio rector

El mismo código corre en local y en AWS. Todo lo que falta en local (Bloque A) existe para que el salto a la nube sea cambiar módulos de adaptación (disco→S3, JSON→Postgres, proceso→cola), no reescribir consumidores. El despliegue (Bloque C) va en rebanadas verificables: cada rebanada deja algo funcionando en AWS antes de empezar la siguiente.

## Decisiones registradas (2026-08-27)

| # | Tema | Decisión |
|---|---|---|
| D1 | Remotion | Dependencia source-available de terceros; gratis en desarrollo (1 persona). **Gate duro antes de cobrar:** comprar licencia de empresa o reemplazar captions animados de shorts (subtítulos longform ya no dependen: `.ass` de ffmpeg). Verificar precios en remotion.dev/license al llegar al gate. |
| D2 | Librería SFX/música | **Descartada del producto.** `media/library/` queda local para uso personal; no se redistribuye. Mecanismo: el Dockerfile NO copia esa carpeta (A4). |
| D3 | Calibración ElevenLabs | Cuatro sub-pasos en orden de esfuerzo (A3). El gate post-TTS es el que ahorra dinero: TTS es barato, Veo es ~85 % del costo. |
| D4 | Blotato + Metricool | Blotato = solo publicar (fn2), key **por usuario** en Parameter Store (C5, ya era Fase 5.6). Metricool = tendencias (pospuesto); verificar tier/costo de su API antes de comprometerse. |
| D5 | AssemblyAI | Requisito de Fase 4 (Lambda/Fargate sin GPU). Los normalizadores de ambos backends ya existen; falta que el puente y `agregar_video.py` respeten el config (A2). Costo despreciable: <$0.01 por película de 90 s. |

---

## BLOQUE A — Terminar Fase 4 en local (~1 semana, gasto $0 salvo A5)

Todo el trabajo de este bloque ocurre en `D:\adquisition\video-stack`. Criterio global: los 62 tests siguen verdes tras cada paso.

### ✅ A1. `MEDIA_ROOT` configurable (Fase 4.3) — COMPLETADA 2026-08-27

**Diseño implementado:** el análisis mostró que casi todas las rutas `work/` son relativas al proyecto (`p / "work" / …`) — esas no cambiaron. Lo que se centralizó fue el ancla:

- `pipeline/storage.py` = única fuente de verdad: `media_root()` (env `MEDIA_ROOT`, default = raíz del repo, **leído en cada llamada** para que los tests redirijan con monkeypatch), `videos_root()`, `ruta_proyecto(nombre)` (con validación de nombre — input del navegador) y `work_root()` (`WORK_DIR` explícito manda; si no, `MEDIA_ROOT/work`).
- `pipeline/config.py`: `settings.work_dir` ahora sale de `work_root()` (antes `./work` relativo al cwd).
- Los 5 routers de `server/` usan los helpers y pasan **rutas absolutas** a los CLIs por subprocess (que ya las aceptan vía pathlib — la mayoría no se tocó).
- Los 2 tools que derivan rutas desde un nombre leen `MEDIA_ROOT` del env sin importar `pipeline`: `tools/project.py::project_dir` (que también usa `generated_to_canonical.py`).
- Bugs colaterales corregidos: `pipeline/overlays.py` derivaba la raíz del repo como `project.parent.parent`; `tools/agregar_video.py` resolvía los sueltos contra el repo y hacía `proj.relative_to(ROOT)` (crash con proyecto externo).
- `.env.example` documenta `MEDIA_ROOT`/`WORK_DIR`.

**Validado:** 67 tests verdes (62 + 5 nuevos en `tests/test_storage_paths.py`); smoke con TestClient: default lista `gen-tesla` (comportamiento intacto), `MEDIA_ROOT` a dir vacío → lista vacía sin crash, y con `MEDIA_ROOT` a una raíz externa (junction) `gen-tesla` abre completo: data (cuts+manifest), proxy con Range 206, overlays.

### ✅ A2. Backend de transcripción configurable en puente e importador — COMPLETADA 2026-08-27

**Implementado:** `tools/normalizers/asr_backend.py` (nuevo) = selección compartida: `crear_transcriptor(model, device)` → `(transcribe_fn, backend, modelo)`. `.video-stack/config.json` decide `asr: local | assemblyai` (mismo contrato que `tools/transcribe.py`); **sin config = faster-whisper local con los args del caller** (comportamiento de siempre, fallback CUDA→CPU encapsulado). Ruta nube: sin prompt (los flujos corren desatendidos) pero SIEMPRE imprime el preview de costo desde `pricing.json` (~<$0.01 por película). El puente (`convertir()` ganó params `backend`/`model` para registrar la procedencia real en el canónico — el esquema ya tenía ambos en el enum) y `agregar_video.py` lo usan; el whisper directo desapareció de ambos.

**Validado:** 72 tests (67 + 5 en `tests/test_asr_backend.py`: selección por config, key faltante → error claro, procedencia en el canónico). E2E local con `agregar_video.py` sobre un clip de 10 s bajo un MEDIA_ROOT de prueba: selector → `faster-whisper (small)`, canónico válido con `asr={faster-whisper, small}`, cuts.json actualizado con respaldo, proxy regenerado (NVENC). **Pendiente de prueba en vivo:** ruta AssemblyAI (no hay `ASSEMBLYAI_API_KEY` en `.env` — mismo estatus que fn2/Blotato; el código replica el flujo verificado de `transcribe.py`).

### A3. Calibración ElevenLabs (nuevo, antes de la validación E2E)
En orden de esfuerzo:

1. **Constante (5 min):** `pipeline/writer.py:10` `PALABRAS_POR_S = 2.2` → tasa medida (~1.9).
2. **Tasa por voz (gratis):** medir palabras/segundo real de cada voz de `voices.py` con los audios ya generados (muestras + corridas como gen-tesla); guardar la tasa junto a la voz.
3. **Gate post-TTS (el que ahorra dinero):** tras generar el audio de cada escena y ANTES de imágenes/video, comparar duración real vs objetivo; si se pasa >10 %, recortar el guion de esa escena y regenerar solo su TTS. El sobrecosto del ~25 % desaparece donde duele.
4. **Mantenerla honesta:** loggear presupuesto vs real en Langfuse en cada corrida para detectar deriva (cambio de modelo de voz, etc.).

- **Validación:** tests unitarios del gate con duraciones sintéticas ($0); la verificación con gasto real queda absorbida por A5.

### A4. Dockerfile único (Fase 4.4)
Imagen Linux con Python + ffmpeg + Node/Chromium (Remotion). Es la misma imagen que luego vive en ECR y corre en Lambda-contenedor y Fargate: validarla local es validar el 70 % del despliegue.

0. **Prerequisito:** Docker Desktop + WSL2 en esta máquina (verificar/instalar).
1. Multi-stage: base Python slim + ffmpeg de apt + Node LTS + Chromium para Remotion; `requirements.txt` fijado (ya está).
2. **`media/library/` excluida** vía `.dockerignore` (decisión D2). Excluir también `venv/`, `work/`, `videos/`, `.env`.
3. Sin gotchas de Windows dentro del contenedor (el event loop y las DLLs cublas son problemas solo del dev local; whisper en contenedor = CPU o AssemblyAI vía A2).
4. Arranque: `uvicorn server.app:app` parametrizado por env (`PORT`, `MEDIA_ROOT`, `GEN_BACKEND`…).

- **Validación:** `docker build` + levantar el contenedor con `MEDIA_ROOT` montado como volumen; f1/e1/editor abren y la suite de tests corre verde DENTRO del contenedor Linux.

### A5. Validación E2E final ($1-3 — SOLO con confirmación explícita del usuario)
Flujo completo en local (idealmente contra el contenedor de A4): crear → producir (ya calibrado por A3) → editar → regenerar g2 → subtítulos → publicar fn1. Si para entonces existe `BLOTATO_API_KEY` real, probar fn2 (pendiente de Fase 3).

- **Criterio de salida del Bloque A:** flujo completo verde en contenedor Linux, costos trazados en Langfuse, presupuesto vs real dentro de ±10 %.

---

## BLOQUE B — Preparar la cuenta AWS (1-2 días, en paralelo al Bloque A)

### B1. Cuenta y seguridad
1. Cuenta AWS (o cuenta nueva dentro de una Organization). MFA en root; root no se usa más.
2. Usuario/rol IAM de administración con permisos mínimos para el desarrollo.
3. **Alarmas de presupuesto desde el día uno** (AWS Budgets: alerta a $10, $25, $50). Las APIs de video queman dinero; esto NO es opcional.

### B2. Herramienta de IaC
**Decisión recomendada: CDK en Python** — todo el stack del producto es Python y CDK tiene constructos de alto nivel para exactamente esta combinación (Lambda contenedor + Fargate + Step Functions).
- Ubicación pendiente de decidir: carpeta `infra/` dentro del repo (recomendado: el deploy siempre corresponde a un commit del producto) o repo aparte en `D:\aws-project`.
- Bootstrap: `cdk bootstrap` en la región elegida (recomendado `us-east-1`: Langfuse US ya está ahí y es donde antes llegan los servicios nuevos).

### B3. ECR
Repositorio para la imagen de A4; primer push manual para validar que la imagen corre en la nube tal cual.

---

## BLOQUE C — Despliegue AWS en rebanadas (Fase 5, 2-4 semanas)

Arquitectura objetivo (sin cambios, §3 del HANDOFF): API Gateway + Lambda (Mangum, **fuera de VPC**) · Aurora Serverless v2 (0 ACU, **Data API**) · SQS + Lambda-contenedor/Fargate/Step Functions · S3 + CloudFront con subidas prefirmadas · Cognito · Parameter Store · CloudWatch + Langfuse. **Exclusiones deliberadas:** sin NAT Gateway, sin OpenSearch, sin SageMaker.

### C1. Rebanada "API viva"
API Gateway HTTP + Lambda con Mangum sirviendo `server/app.py` + Cognito (login email) + Route 53/dominio.
- **Criterio:** f1 abre desde una URL de AWS tras login, aunque sin datos. La latencia de arranque en frío y de reanudación de Aurora (~15 s) se enmascara con la pantalla de carga de f1.

### C2. Rebanada "estado"
Aurora Sv2 Postgres (mín 0 ACU auto-pause, Data API) + migrar `pipeline/storage.py` de JSON a Postgres: proyectos, clips, versiones, libro de costes — **`user_id` en todo** desde el primer esquema.
- **Criterio:** crear/listar proyectos desde la UI en AWS; los datos sobreviven al pause/resume de Aurora.
- Gracias a A1/F4.1, esto es cambiar un módulo, no cazar `open()`.

### C3. Rebanada "media"
S3 (bucket por entorno) + CloudFront + subidas prefirmadas directo navegador↔S3. `MEDIA_ROOT` (A1) apunta al layout S3.
- **Criterio:** subir un MP4 desde el navegador, verlo servido por CloudFront en el editor.

### C4. Rebanada "trabajos"
SQS (estándar + DLQ) y los tres ejecutores con la imagen de ECR:
1. **Lambda contenedor** — trabajos <10 min: mux, recortes g2, subtítulos.
2. **ECS Fargate** (4 vCPU/8 GB) — renders largos: masters, Remotion.
3. **Step Functions Standard** — producciones completas (esperas de video de 4-8 min en wait states, que no cobran cómputo).
- **Regla dura:** producciones SIEMPRE por Step Functions, renders largos SIEMPRE por Fargate (límites Lambda: 15 min, 10 GB /tmp).
- **Regla dura:** nada multi-worker antes de que el estado viva en Postgres (C2) — el candado `_ocupado` y las tareas en memoria son single-worker por diseño.
- **Criterio:** una producción completa lanzada desde la UI en AWS termina y aparece en el editor.

### C5. Rebanada "dinero y secretos"
1. Claves de usuarios (Blotato, etc.) en SSM Parameter Store SecureString — nunca en frontend (decisión D4).
2. Monedero de créditos + **gates duros de gasto por usuario** (el gate 428 ya existe en la app; aquí se le suma el límite de saldo).
3. Precios SOLO de `tools/pricing.json` con `verified_on`; en UI siempre "$X.XX dólares".
- **Criterio:** un usuario sin saldo no puede lanzar nada que cueste dinero.

### C6. Observabilidad y cierre
CloudWatch (retención corta) + Langfuse con `user_id` en cada traza — el coste por proyecto es la base de facturación.
- **Criterio de salida de Fase 5 (= del plan):** flujo E2E completo (crear → editar → regenerar → publicar) corriendo en AWS, con presupuesto limitado y costes visibles por usuario.

---

## Gates previos al lanzamiento comercial (no bloquean el desarrollo)

- [ ] **Licencia Remotion** (D1): comprar o reemplazar captions de shorts. Obligatorio antes de cobrar.
- [ ] **fn2 en vivo** con `BLOTATO_API_KEY` real (pendiente de Fase 3).
- [ ] **Tendencias** (Metricool): verificar tier/costo de API antes de comprometerse (D4). Pospuesto.
- [ ] Port del cerebro b2 (gpt-5-mini → claude-agent-sdk). Pendiente documentado, no bloqueante.
- [ ] Decidir si propuestas "grafico" de b2 pueden solapar escenas IA.
- [ ] F3.5 casos A (unir películas generadas) y C (mezclar con inserción) — funcionalidad, no infraestructura; se puede intercalar cuando convenga.

## Reglas vigentes durante todo el plan

- Ningún gasto apreciable (producciones ~$1-3, validaciones E2E) sin confirmación explícita del usuario; validar antes con tests o una llamada barata.
- Aprobación humana antes de renderizar, regenerar o publicar; precio visible antes de cada botón que gasta (gate 428).
- Las versiones de clips nunca se borran — el undo cuesta dólares.
- Respetar las reglas no negociables de video-stack (loudness una pasada, stream copy en shorts, QA de corte, procedencia en `media/`).

## Costos esperados (del HANDOFF, vigentes)

- Fijo AWS: **$12-35/mes** en piloto (piso $1-2 sin uso).
- Variable: **$1.30-3.50 por película** + $0.15-0.26/h de audio transcrito → se traslada al usuario vía créditos.
- La línea dominante son las APIs, no la infra: 50 películas/mes ≈ $65-175 en APIs vs ~$25 de AWS.

## Orden de arranque sugerido

1. **Hoy:** A1 (MEDIA_ROOT) — puro refactor, $0, desbloquea A4 y C3. En paralelo: B1 (cuenta + alarmas).
2. A3.1-A3.2 (constante + tasas por voz) — minutos/gratis, se pueden intercalar.
3. A2 (backend transcript) → A3.3-A3.4 (gate post-TTS + Langfuse) → A4 (Dockerfile, con Docker Desktop ya instalado).
4. A5 (E2E, con confirmación) → B2/B3 → C1 y en adelante, una rebanada a la vez.
