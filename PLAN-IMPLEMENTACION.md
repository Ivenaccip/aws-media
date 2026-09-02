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

**Validado:** 72 tests (67 + 5 en `tests/test_asr_backend.py`: selección por config, key faltante → error claro, procedencia en el canónico). E2E local con `agregar_video.py` sobre un clip de 10 s bajo un MEDIA_ROOT de prueba: selector → `faster-whisper (small)`, canónico válido con `asr={faster-whisper, small}`, cuts.json actualizado con respaldo, proxy regenerado (NVENC). **Ruta AssemblyAI probada EN VIVO** (2026-08-27, con la key del usuario, $0.0006): clip de 10 s vía `agregar_video.py` con config `asr=assemblyai` → canónico válido con `asr={assemblyai, universal-3-5-pro}` (15 palabras vs 10 de whisper small). **Trazada en Langfuse**: generation `assemblyai_transcript` con `cost_details` ($0.000588), mismo patrón que `nano_banana`/`veo`; fallos van como `level=ERROR`; opcional (sin claves Langfuse la transcripción sigue igual). El config temporal se retiró: el dev local sigue en whisper $0; para nube, `tools/setup.py --asr assemblyai`. Free tier AssemblyAI: crédito único ~$50 para cuentas nuevas (≈238 h a $0.21/h) — política del repo: no prometerlo en UI, "verifica tu crédito en el dashboard".

### ✅ A3. Calibración ElevenLabs — COMPLETADA 2026-08-27

**Hallazgo de la medición** (canónico de gen-tesla, timestamps whisper del TTS real): la voz lee **1.98 pal/s de habla**, pero los slots de video (4/6/8 s) rellenan ~20% sobre el audio → **1.63 pal/s relativo a la película final**. La constante correcta para presupuestar película no era ~1.9 sino menos:

1. **Constante:** `writer.py` `PALABRAS_POR_S = 2.2 → 1.7` (película-relativa, con margen porque escenas más cortas rellenan menos); el prompt del guionista ya no dice "2,2 palabras por segundo" y marca el límite como estricto.
2. **Tasa por voz:** `voices.py` `TASA_HABLA = {George: 1.98}` (única voz con corrida real disponible — los audios de las demás se borraron con `work/`) + default conservador 1.9 y helper `tasa_habla(voz)`. Las demás voces se calibran con los datos que acumule el log del gate.
3. **Gate post-TTS:** `pipeline/duracion.py` — tras `tts_todas` y ANTES de imágenes/video (`run.py`, solo si el caller pasa `duracion_objetivo_s`; `flow.producir` pasa `p.duracion_s`): si `sum(slots)` excede el objetivo en >10%, elige las escenas más largas (las de 4 s no bajan más), un LLM recorta su narración al presupuesto de SU voz (prompts `recorte_system/user`) y solo esas regeneran TTS. Red de seguridad: respuesta vacía → narración original; pasada del límite → corte duro.
4. **Honestidad:** span `gate_duracion` en Langfuse registra SIEMPRE objetivo vs estimado (y `WARNING` si tras recortar sigue fuera); la película final loggea `objetivo_s` junto a la duración real.

**Validado:** 78 tests (6 nuevos en `test_duracion.py`, lógica pura con duraciones sintéticas, $0). La verificación del gate con gasto real queda absorbida por A5 (E2E con confirmación).

### ✅ A4. Dockerfile único — COMPLETADA 2026-08-28 (Ruta B: CI, sin Docker local)

**Decisión (2026-08-28):** sin Docker Desktop en esta máquina; la validación Linux corre en **GitHub Actions** (`.github/workflows/docker.yml`, runners gratis del repo privado) — el mismo workflow que en Fase 5 ganará el push a ECR. La E2E de A5 correrá local en Windows (el gate de confirmación de gasto no vive bien en CI); CI garantiza que el mismo código funciona en Linux.

**Imagen** (`Dockerfile`): `python:3.10-slim-bookworm` + ffmpeg 5.1 + Chromium 151 + Node 20 + deps fijadas de `requirements.txt` + `npm ci` de ambos proyectos Remotion. `MEDIA_ROOT=/data` (los media NUNCA viajan en la imagen), `CMD uvicorn server.app:app` con `PORT` parametrizado. `.dockerignore`: `media/` (decisión D2), `.env`, `venv/`, `videos/`, `work/`, credenciales.

**Validado en CI** (run 33147068085, 2m41s, verde a la primera): build OK; **78 tests verdes DENTRO del contenedor**; server arranca **sin `.env`** y responde `/api/estilos`, `/api/edicion/proyectos` (vacío → `[]`) y f1 estático; runtimes presentes (node v20.20.2, ffmpeg 5.1.9, Chromium 151). Sin gotchas de Windows adentro: whisper = CPU o AssemblyAI (A2).

### ✅ A5. Validación E2E final — CORRIDA 2026-08-28 (verde salvo g2, bloqueado por Google)

**Corrida real** (brief Tambora/Karl Drais del usuario, gasto autorizado, driver por API contra el server local, `MEDIA_ROOT` al almacén de adquisition, guarda dura de $2.00 antes de producir):

- **Crear → revisión** (modo idea, 30 s, animated, referencia de época): guion 5 escenas / 56 palabras, voz George, 2 opciones de personaje. Estimación **$1.36**.
- **Producción completa en ~5 min** con el gate de A3 activo: película **32.79 s para objetivo 30 s (+9 %, dentro del ±10 %)** — antes de A3 habría salido ~+35 %. El estimador clavó: **costo real $1.35** (pelicula $1.28 + preparar $0.075, Langfuse).
- **Puente automático** → `gen-a44db907` en e1 (`editor_listo: true`, 50 palabras canónicas).
- **b1 subtítulos**: muestra + quemado → `pelicula` 19.5 MB, `subtitulado` 23.5 MB, `.srt`. **b3 fn1**: descarga 200 OK. **Títulos**: 3 sugeridos.
- **g2 COMPLETADO en el reintento** (mismo día, tras un 503 sostenido de Nano Banana de ~1 h en el que el producto respondió siempre con error limpio y $0 cobrados): 2 candidatos nano banana ($0.078) → Veo i2v → **v2 activa, película rearmada 32.83 s** ($0.40) → subtítulos re-quemados sobre la versión nueva. Libro de costes del proyecto: $0.478.
- Nota de entorno: subida a Drive no-fatal falló (falta `token_drive.json` en la copia nueva — correr `python auth_google.py` si se quiere entrega a Drive).

**Criterio del Bloque A: CUMPLIDO — Bloque A CERRADO al 100 %.** Gasto total de A5: **$1.83** ($1.35 producción+preparación por Langfuse + $0.478 g2), dentro del ~$1-2 autorizado. Desvío de duración +9 % (gate A3 en vivo); "verde en contenedor" cubierto por CI (A4).

---

## ✅ BLOQUE B — Cuenta AWS preparada (COMPLETADO 2026-08-28)

### ✅ B1. Cuenta y seguridad
Cuenta `191241816158` creada por el usuario con MFA en root (root no se usa más); usuario IAM `admin-cli` (AdministratorAccess, solo CLI) configurado con `aws configure` local (región `us-east-1`). **AWS Budgets activo ANTES que cualquier servicio:** presupuesto mensual `aws-media-mensual` de $50 con avisos a ivenaccip@gmail.com al 20 % ($10), 50 % ($25), 100 % ($50) y $75 absoluto (última alarma de escalada) reales + pronóstico >100 %.

### ✅ B2. IaC
CDK elegido (constructos de alto nivel para Lambda contenedor + Fargate + Step Functions; stack del producto ya es Python). AWS CLI 2.36 + CDK 2.1139 instalados en la máquina; **`cdk bootstrap` hecho** en `aws://191241816158/us-east-1` (stack CDKToolkit). Ubicación de la infra: carpeta `infra/` en este repo (se crea en C1).

### ✅ B3. ECR
Repositorio creado: `191241816158.dkr.ecr.us-east-1.amazonaws.com/aws-media` (scan on push activado). Sin Docker local (decisión de A4), el push de la imagen lo hará el workflow de CI — se cablea en C1/C4 con un rol OIDC GitHub→AWS (sin access keys en GitHub).

---

## BLOQUE C — Despliegue AWS en rebanadas (Fase 5, 2-4 semanas)

Arquitectura objetivo (sin cambios, §3 del HANDOFF): API Gateway + Lambda (Mangum, **fuera de VPC**) · Aurora Serverless v2 (0 ACU, **Data API**) · SQS + Lambda-contenedor/Fargate/Step Functions · S3 + CloudFront con subidas prefirmadas · Cognito · Parameter Store · CloudWatch + Langfuse. **Exclusiones deliberadas:** sin NAT Gateway, sin OpenSearch, sin SageMaker.

### ✅ C1. Rebanada "API viva" — DESPLEGADA 2026-09-01

**URL:** `https://2ecset5i94.execute-api.us-east-1.amazonaws.com` — f1 abre, `/api/estilos` y `/api/edicion/proyectos` responden (arranque frío 26.8 s con la imagen de 1.2 GB — se enmascara con la pantalla de carga de f1; caliente 0.13 s).

**Cómo quedó:** `server/lambda_handler.py` (Mangum sobre la MISMA app) · Lambda contenedor con la imagen de A4 (`latest` de ECR, entrypoint sobreescrito a `awslambdaric`) · API Gateway HTTP · CI empuja la imagen validada vía **rol OIDC** `aws-media-github-ecr` (gotcha real: GitHub ahora emite el `sub` con IDs inmutables `owner@id/repo@id` — la trust acepta ambos formatos) · Cognito pool `us-east-1_WyPvxnj1V` + client + dominio `media-ivenaccip` creados.

**Deudas registradas de la rebanada:** (1) la **exigencia de login** se cablea cuando el frontend tenga pantalla de auth (pool listo, endpoints hoy abiertos — no publicar la URL); (2) `reserved_concurrency=1` no cupo en la cuota inicial de la cuenta (10 concurrentes; se auto-eleva) — restaurar cuando crezca; hoy no hay estado que proteger (FS solo lectura, sin datos); (3) actualizar la Lambda a una imagen nueva = `cdk deploy` (toma el `latest` del momento) — CD automático vendrá después. Gotchas aprendidos: dominio Cognito no admite la palabra "aws"; un CREATE fallido con RETAIN deja pools huérfanos (limpiados).

### ✅ C2. Rebanada "estado" — DESPLEGADA 2026-09-01

**Cómo quedó:** stack `aws-media-db` = Aurora Serverless v2 **PG 16.14** (mín 0 ACU con auto-pausa, máx 1, Data API, `RemovalPolicy.SNAPSHOT`) en VPC aislada sin NAT — la Lambda sigue FUERA de la VPC y habla por rds-data (HTTPS). `pipeline/db.py` = cliente Data API + esquema con **`user_id` en toda fila** (`usuarios`, `proyectos_gen`, `proyectos_editor`, `clip_versiones`, `costes`) + repo de proyectos; `pipeline/project.py` elige backend por `STATE_BACKEND` (json = dev local intacto; postgres = AWS, doc Pydantic entero como JSONB). Esquema idempotente con `tools/db_migrate.py`. Suite 90 tests.

**Criterio verificado en vivo:** POST `/api/proyectos` → fila en Aurora con `user_id=piloto` (y la actualización de estado del pipeline también viajó); GET lista desde Postgres; auto-pausa real a 0 ACU a los ~8 min y **primera petición tras la pausa: 200 en 25.0 s con datos intactos** (reintento ante `DatabaseResuming` en `db.ejecutar`).

**Gotchas reales:** (1) CloudFormation NO actualiza el código de la Lambda si la cadena ImageUri no cambia — `repo:latest` dejó la función con la imagen de C1; ahora `infra/app.py` fija el **digest real** de `:latest` en cada synth (cierra la deuda 3 de C1: actualizar imagen = `cdk deploy`, ahora sí). (2) Las versiones menores de RDS rotan más rápido que el enum del CDK (16.6 ya no existía) → `AuroraPostgresEngineVersion.of()`. (3) Los artefactos del workdir caen en `/tmp/work` (efímeros hasta C3/S3): comprobado que sin Postgres el proyecto "desaparecía" con el contenedor.

**Deudas de la rebanada:** (1) reanudar tras pausa consume ~25 de los 29 s del timeout — una petición muy temprana puede dar 504; lo enmascara la pantalla de carga de f1 y desaparece si C4 calienta el clúster antes de encolar; (2) `usuario piloto` fijo (`DEFAULT_USER_ID`) hasta exigir login Cognito (deuda C1); (3) `proyectos_editor`/`clip_versiones`/`costes` creadas pero se cablean en C3/C4/C5. Coste en reposo: ~$0.50/mes (secreto $0.40 + storage).

### ✅ C3. Rebanada "media" — DESPLEGADA 2026-09-01

**Cómo quedó:** stack `aws-media-media` = bucket S3 privado (`BLOCK_ALL` + `RETAIN` + CORS para el PUT del navegador) + CloudFront `d8bfm82hs0s6a.cloudfront.net` con OAC. `server/media_api.py`: presign PUT 15 min (Content-Type dentro de la firma), `confirmar` verifica con `head_object` y registra en `proyectos_editor` (esquema C2), guard 409 sin `MEDIA_BUCKET` (local intacto: archivos en `videos/`). El video NUNCA pasa por la Lambda (API Gateway corta payloads en 10 MB): navegador→S3 directo. Layout de claves espeja MEDIA_ROOT (`videos/<proyecto>/subidas/…`) para que los ejecutores de C4 sincronicen por prefijo. UI: sección "Subir metraje" en e1.html (solo si `/api/media/config` está activo) + fila "ver subida"; `/api/edicion/proyectos` fusiona los proyectos solo-nube desde Postgres. Suite 110 tests. IAM de la Lambda: `grant_put`+`grant_read` SIN delete (las versiones no se borran).

**Criterio verificado en vivo (doble):** (1) por API: presign→PUT 200 (0.7 s)→confirmar→GET CloudFront 200 bytes idénticos + **Range 206** (el seek del player); (2) **desde el navegador real** (UI e1 desplegada): elección de archivo→subida con preflight CORS→player visible con src de CloudFront. Proyectos de prueba: `video-nube-1`/`video-nube-2` (artefactos de smoke, sin coste apreciable).

**Deudas de la rebanada:** (1) CORS del bucket con origen `*` mientras no se exige login — restringir al dominio de la app cuando haya auth (misma deuda C1); (2) las subidas aún no alimentan el pipeline de edición (transcribir/cortar sobre S3 = C4: los ejecutores bajan por prefijo); (3) CloudFront sirve con caché por defecto — si algún día se re-sube la misma key, invalidar o versionar la key.

### ✅ C4. Rebanada "trabajos" — DESPLEGADA Y VALIDADA E2E 2026-09-01

**Cómo quedó:** stack `aws-media-jobs` = SQS+DLQ (`maxReceiveCount=2`) → **worker Lambda** contenedor (3 GB/15 min, `max_concurrency=2`, corre `preparar` y `smoke`) · **Fargate 4 vCPU/8 GB** en VPC propia SOLO pública (IP pública por tarea = internet sin NAT; habla con Aurora por Data API, no toca la VPC de la DB) · **Step Functions Standard** `aws-media-producir` (RunTask.sync, timeout 2 h; el comando viaja en el input — SFN no interpola JsonPath en arrays). `pipeline/jobs.py` despacha por `JOBS_BACKEND` (local = dev intacto); `pipeline/media_sync.py` mueve artefactos por el layout S3 de C3; `worker/producir_task.py` corre `flow.producir` completo + puente y registra el proyecto en `proyectos_editor` (flags + película vía CDN); `server/app.py` cae al CDN cuando el artefacto lo escribió otro ejecutor. Claves de API en SSM `/media-ivenaccip/env` (SecureString, `tools/ssm_env.py` — **"aws\*" es prefijo reservado de SSM**, mismo gotcha que Cognito); los tres procesos las cargan al arrancar. Reglas duras respetadas: producciones SIEMPRE por SFN, Fargate para lo largo, sin delete en IAM. Suite 108.

**Verificado en vivo (barato):** job `smoke` por SQS → "postgres respondió, s3 accesible" (43 s con frío); ejecución SFN con proyecto inexistente → Fargate arrancó, cargó claves, consultó Postgres y salió con exit 1 → SFN FAILED limpio en 77 s. Gotcha: el runtime Lambda ya instala handler de logging — `basicConfig(force=True)`.

**E2E validado (gasto autorizado, real $1.31 vs estimado $1.36):** proyecto `84de6b8c` (John Snow/cólera, 30 s, ref de A5) — crear→`preparar` en el worker SQS (revisión en 2m17s, 5 escenas, voz George, 2 opciones de personaje) → estimación visible ($1.36) → producir por SFN→Fargate: **SUCCEEDED en 407 s**, película 31.13 s (+3.8% del objetivo — mejor gate hasta ahora), puente `gen-84de6b8c` con canonico+cuts, fila en e1 y película servida por CloudFront (13.9 MB). Fargate ≈ $0.02. Costos por Langfuse: preparar $0.08 + película $1.23. Gotcha del arranque: el primer POST tras pausa larga dio 503 (frío Lambda + resume Aurora > 29 s) — calentar con un GET antes; ya estaba registrado como deuda C2. **Deudas:** descomponer la SFN en pasos con wait states (hoy Fargate corre toda la producción; a escala piloto son centavos) · los renders del cut-editor (masters/Remotion) siguen en el server local, no encolados · el cut-editor interactivo sobre artefactos S3 · muestra de voz cacheada por instancia (miss entre instancias) · calentar Aurora antes de encolar (mata el 504 post-pausa).

### C5. Rebanada "dinero y secretos" — ✅ DESPLEGADA Y VERIFICADA 2026-09-02
> La spec de negocio del monedero vive en **`docs/ECONOMIA.md`** (2026-09-02): regla 3 cr/s, packs, cortesía de membresía (100/200), y la economía ÚNICA que compartirán las herramientas futuras (RAG de automatización, CRM+mensajería). El monedero se construye como pieza de plataforma.
1. ✅ Claves por-usuario en SSM SecureString (D4): `/media-ivenaccip/usuarios/<user_id>/` — `worker/env_ssm.cargar_env_usuario()` las carga en los DOS ejecutores y **pisan** a las de plataforma; `tools/ssm_env.py --usuario <id>` sube la lista blanca (`BLOTATO_API_KEY`); IAM de api/jobs ampliado al prefijo. Sin clave real de usuario aún (fn2 sigue esperando BLOTATO_API_KEY).
2. ✅ Monedero (`pipeline/creditos.py` + tablas `monedero`/`monedero_movimientos`): saldo materializado + libro mayor; **el gate duro es un UPDATE condicionado atómico** (`WHERE saldo >= :n RETURNING`). Se cobra la estimación hacia arriba ANTES de lanzar (preparar 10 cr, producir `ceil(3×duracion_s)` — 30 s = 90); los workers **devuelven** créditos si preparar termina en error o la producción no llega a "listo". `CREDITOS_BACKEND=off` default → dev local intacto; "postgres" en los stacks. API: gates 402 en crear/producir, `GET /api/creditos` (saldo+tarifas+movimientos), estimación con créditos y saldo, botón de producir los enseña. Admin: `tools/creditos.py` (saldo/abonar/movimientos vía Data API).
3. ✅ Tarifa en créditos SOLO de `tools/tarifas.json` (`verified_on`, formato pricing.json); los dólares de vendors siguen solo en `tools/pricing.json`.

**Verificado en vivo (sin gasto + llamada barata $0.08):** `GET /api/creditos` → activo, saldo 100 (cortesía sembrada por CLI); con saldo 5, `POST /api/proyectos` → **402 real sin encolar nada** y mensaje legible; restauración y mayor auditado. Cobro real: crear `fcab9e66` debitó 10 cr ANTES de encolar (movimiento `cargo preparar:fcab9e66`), el worker preparó (5 escenas) y el saldo quedó en 90. Suite 123 tests (15 nuevos). GOTCHA Postgres: en `INSERT … ON CONFLICT DO UPDATE` el CHECK se evalúa sobre la fila propuesta → `GREATEST(:n, 0)` en el upsert (commit 7783378, encontrado por el smoke).

**Criterio CUMPLIDO:** un usuario sin saldo no puede lanzar nada que cueste dinero (402 verificado en producción).

**Deudas de la rebanada:** (1) compra de packs = pasarela de pago pendiente — hoy los abonos son por CLI admin; (2) cortesía mensual manual (CLI) — automatizar cuando haya más usuarios; (3) un crash DURO del worker (excepción → DLQ) no devuelve créditos — solo los caminos limpios (estado error / SFN FAILED); (4) doble clic ultrarrápido en producir podría cobrar dos veces (ventana entre el check de estado y guardar) — edge de piloto; (5) UI de monedero mínima (saldo en el botón) — falta sección de créditos con movimientos y packs; (6) rate-limit por miembro pendiente (importará con las acciones de 1 cr del RAG); (7) la Lambda desplegada va un commit detrás del fix GREATEST (solo afecta ajustes admin negativos, ruta CLI local — viaja en el próximo deploy); (8) el proyecto barato `fcab9e66` quedó en revisión con 0 opciones de personaje (sin refs, modo idea) — revisar si el casting sin referencias es camino soportado antes de producirlo.

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
