# Guía de clases: diseño para construir

> Diseño del 19-oct-2026. La rebanada S1 ya está construida; lo demás es plan. Las marcas [V]/[I]/[POR MEDIR] son las del autor del diseño.

Fecha: 2026-10-19. Repo `/home/user/aws-media`, rama `claude/pensive-noether-v7xu1l` (HEAD `d6474ab`, un commit encima de `origin/dev` `dd7bfba`).
Solo lectura: no se tocó el repo, no hubo commits ni llamadas a APIs de pago. Lo único que corrí fue local y sin red (funciones de Python que leen `tools/pricing.json` y `pipeline/media_rutas.py`, y cuentas aritméticas).

Cómo leerlo:
- **Dueño (no técnico):** lee las secciones 1, 2, 7 y 9. Todo lo demás es para quien construya.
- **Desarrollador:** las secciones 3 a 6 son el contrato. La sección 9 dice en qué orden y con qué pruebas.
- **Marcas:** `[V]` = lo verifiqué yo abriendo el código o ejecutándolo (lo que tomé de un informe sin reabrirlo lo digo como «según …»). `[I]` = inferencia razonable, no probada. `[POR MEDIR]` = dato que hoy no existe y que no inventé. «Sin precio confirmado» = no está en `tools/pricing.json` ni en `tools/tarifas.json`.
- **Fuentes:** cinco informes de lectura (`rag.md`, `transcripcion.md`, `admin.md`, `menu.md`, `producto.md`, en la misma carpeta que este archivo) más mi verificación propia (Anexo A). Donde un informe y el código se contradicen, manda el código.
- Todo precio se escribe en «dólares». Las cifras de ejemplo con supuestos míos lo dicen en la misma línea.

---

## 1. Resumen de una pantalla

**Qué es.** Una pantalla nueva en Central › Distrito, «Guía de clases» (hoy es la tarjeta apagada «Preguntas sobre la clase», CEN·3, en `web/src/marca/menu.ts:164`). La persona escribe qué quiere lograr y, **con una sola consulta**, ve dos pestañas:

- **«Plan paso a paso»** (la que se abre primero): de 2 a 7 clases en el orden del curso, cada una con «Clase N · título · desde el minuto mm:ss».
- **«Solo el video»**: la clase más pertinente, una sola, ya puesta en el minuto exacto, sin plan.

**Cómo se arma.** En el admin (`/estudio/admin/`, pestaña nueva «4 · Clases») el dueño sube el video de cada clase. Cuando pulsa «Procesar» (viendo antes cuánto cuesta), un trabajo en la nube saca el audio, lo transcribe con AssemblyAI (la herramienta que ya existe), lo trocea por tiempo, calcula los embeddings y guarda el índice. La clase queda «lista» pero **no es visible** para los alumnos hasta que el dueño la active.

**Para quién.** Personas con cuenta (hoy: cualquier invitado al pool de usuarios; no existe un grupo «alumno», ver decisión 4).

**Qué NO hace (v1).**
- No es un chat ni responde preguntas. Dice qué clase ver, desde qué minuto y en qué orden.
- No inventa clases ni minutos: todo sale de las clases procesadas y de sus tiempos reales.
- No guarda lo que la persona escribe, ni la guía que arma (igual que COI): ni en la base, ni en trazas, ni en el navegador.
- No usa IA para redactar el plan en la consulta. El plan es el orden del curso filtrado a lo pertinente; una IA opcional que lo personalice es una rebanada aparte (S8).
- No descarga videos de YouTube, Vimeo, Skool ni Drive. Una liga se guarda solo como referencia.
- No gasta dinero sin un «sí» con el costo a la vista: procesar una clase siempre lo pide.
- No incluye el glosario (rebanada aparte, sección 10).
- No cobra créditos en v1 (decisión 6).

**Cuánto cuesta (precios de `tools/pricing.json`).**
- Preparar las clases: la transcripción es el único gasto grande, $0.21 dólares por hora de clase. 20 clases de 1 hora: **$4.20 dólares**.
- Cada consulta del alumno: del orden de $0.0003 dólares (la moderación domina; estimado con tokens supuestos por mí, no medido).
- Embeddings de Gemini y almacenamiento/transferencia de S3: **sin precio confirmado**.

**Qué puede empezar YA, sin esperar las ligas** (sección 9): S1 (admin «Clases» sin gasto), S2 (núcleo de búsqueda con vectores falsos), S3 (pantalla del alumno con datos de prueba) y S4 (trabajo de procesamiento, probado con dobles). Lo que necesita un video real es S5.

**Cinco decisiones de arquitectura que tomé yo** (y por qué se apartan de los informes):
1. **Una consulta, dos vistas**, no «elegir el modo antes» (el dueño pidió «ve DOS opciones»).
2. **Sin IA en la consulta en v1**: cabe holgado en los 29 s de la Lambda, no mete texto de transcripts a un modelo (cero inyección) y cuesta una fracción.
3. **El índice vive como archivos en S3**, no en S3 Vectors (el corpus son unos miles de vectores; evita tocar dos guardianes de seguridad y el precio de consultas que no está confirmado). Es reversible (sección 4.3).
4. **Worker y cola propios** para procesar, que esperan a AssemblyAI volviendo a la cola con retraso, en vez de dormir en una Lambda.
5. **«Lista» no es «visible»**: el dueño revisa antes de que los alumnos la vean.

---

## 2. Decisiones del dueño que faltan (8)

Cada una dice qué recomiendo y qué pasa si respondes que sí o que no.

### D1. ¿Quién o qué es Jev?
**Pregunta literal:** dijiste «lo vamos a construir con Jev y un rag». ¿Quién o qué es Jev? `[V]` No aparece en ningún archivo del repo (busqué la palabra completa en todo el árbol, sin `node_modules`, `venv` ni `.git`: 0 resultados).
- **Recomendación:** respóndelo antes de arrancar S2 y S4. Este diseño **no depende de Jev**: ninguna rebanada lo menciona y todo se construye con el código del repo.
- **Si Jev es una persona que construye el RAG por su lado:** S2 (buscador) y S4 (procesamiento) se solaparían con su trabajo; habría que repartir (por ejemplo, tú/Jev el buscador, yo el admin y la pantalla) y fijar el formato del índice (sección 4.2) como contrato entre ambos.
- **Si es una herramienta o servicio:** dime cuál; el diseño asume que la búsqueda es código propio sobre archivos de S3.
- **Qué bloquea:** nada de S1 ni S3. Sí bloquea empezar S2/S4 sin duplicar trabajo.

### D2. «Solo el video que les indiquemos»: ¿el más pertinente o uno fijado a mano?
**Mi lectura:** el video que **el sistema indica**, es decir, **la clase más pertinente según la búsqueda sobre lo que la persona escribió**, una sola, sin plan, calculada en la misma consulta que el plan.
**La otra lectura posible:** tú fijas a mano qué video corresponde a cada tema («si piden WhatsApp, esta clase»). Eso no necesita RAG, pero no entiende frases libres y exige que mantengas una tabla tema-video.
- **Recomendación:** la lectura automática en v1. Si después quieres control manual, se agrega un botón en el admin «Fijar esta clase para este tema» que pisa el resultado de la búsqueda (rebanada pequeña, no incluida).
- **Si prefieres la manual:** S2, S4 y S5 casi no se usan; la Guía se vuelve un directorio de temas; dime los temas.

### D3. Embeddings: ¿Gemini (lo que pediste) u OpenAI (lo que funciona hoy)?
- `[V]` Hoy dev **no** embebe con Gemini: `infra/entornos.py:166-167` fija `vectores_indice="n8n-docs-openai-v1"` y `embeddings="openai"`. El código de Gemini existe y está probado con dobles, pero el repo registra que Google tenía la cuenta «en verificación» y no aceptaba la tarjeta el 1-oct (`infra/entornos.py:160-165`, `pipeline/vectores.py`). Nada dice que eso se resolvió.
- `[V]` `gemini-embedding-001` **no tiene precio** en `tools/pricing.json`. El de OpenAI sí: `rag.modelos.text-embedding-3-small.entrada` = 0.02 dólares por millón de tokens.
- Gemini además exige: una clave propia de la Guía, una línea nueva en la política de privacidad (hoy Google solo aparece como «Gmail», `static/privacidad.html:202`), y un cálculo de costo distinto porque Gemini no reporta tokens (según `rag.md`, `pipeline/embeddings.py:100`; no lo reabrí).
- **Recomendación:** construir con un interruptor (`GUIA_EMBEDDINGS`) y arrancar con el que funcione hoy en dev (OpenAI) mientras confirmas la cuenta de Google y me das el precio. Cambiar a Gemini después significa **re-embeber, no re-transcribir** (el transcript queda guardado en S3): cuesta del orden de una fracción de dólar y se hace con un botón «Preparar de nuevo para buscar».
- **Si dices «solo Gemini desde el día uno»:** S5 espera a que (a) la cuenta de Google acepte la tarjeta, (b) exista la clave, (c) se agregue Google (Gemini) a la privacidad y (d) tú pongas el precio en `tools/pricing.json` (yo no lo invento; sin precio, el admin dirá «sin precio confirmado»).

### D4. ¿Quién ve las clases, y qué derechos tienes sobre los videos?
- Según `admin.md` (no lo reabrí): no existe un grupo «alumno» o «miembro»; el pool de usuarios es cerrado (solo invitados, `infra/stacks/api.py:169`) y cualquier cuenta puede entrar a las pantallas del estudio.
- **Recomendación:** v1 = cualquier persona con cuenta ve la Guía y las clases que marques «Visible». Si las clases son de pago o exclusivas de un grupo, dímelo antes de S6: se agrega un grupo de Cognito (por ejemplo `alumnos`) y el chequeo en los dos endpoints del alumno (trabajo de un día).
- **Derechos:** confirma que puedes reproducir esos videos a toda la comunidad (invitados, música, material de terceros) y que está bien mandar su audio a AssemblyAI y fragmentos de texto a OpenAI/Google. La Guía muestra y reproduce el video: un enlace firmado se puede compartir mientras dure (2 horas); no es protección contra copia.

### D5. ¿Qué son «las ligas», cuántos videos son y cuánto pesan?
- **Recomendación:** que **subas el archivo** (`.mp4`, `.mov` o `.m4v`, hasta 5 GiB, hasta 2 horas por clase en v1). Una liga se guarda solo como referencia («Abrir en su plataforma», nueva pestaña) y **no se descarga ni se transcribe**.
- **Por qué:** Vimeo está rechazado a propósito en el repo; Skool y Loom no tienen código; YouTube funciona vía Apify pero cuesta del orden de $1.21 dólares por hora de descarga (`apify.youtube_video_downloader`: $0.01 por video + $0.002 por MB, a ~10 MB/min) además de los $0.21 de transcribir, y descargar contenido protegido va contra los términos de esas plataformas. Para tus propias clases lo limpio es exportar el original desde donde lo grabaste.
- **Necesito de ti:** la lista de ligas **con la plataforma de cada una**, cuántas clases son, las horas totales y el peso del archivo más grande. Eso decide si basta subir de una vez (hasta ~2 GB) o si hay que hacer subida por partes (`admin.md` §2.2).

### D6. Tope diario y costo para el alumno
- **Recomendación:** gratis, con tope de **5 guías terminadas por persona y día** (día de México), mientras la consulta no use IA. COI usa 3 porque cada respuesta es una generación de modelo; esta consulta cuesta del orden de $0.0003 dólares.
- **Alternativa:** créditos. No existe tarifa de la Guía en `tools/tarifas.json`; crear una exige un costo medido (`[V]` la fórmula del repo es costo ÷ 0.75 ÷ piso de venta, redondeado hacia arriba: `tools/tarifas.json:33`, piso de $0.015 dólares por crédito en `:76`). Por eso lo dejo para después de medir.
- **Si agregas IA al plan (S8):** revisar el tope; ahí cada consulta cuesta del orden de $0.004 dólares (gpt-5-mini) a $0.024 dólares (claude-sonnet-5-5), con tokens supuestos.

### D7. Nombre de la tarjeta CEN·3
- **Recomendación:** renombrar «Preguntas sobre la clase» a **«Guía de clases»**. «Preguntas» promete un chat de preguntas y respuestas, que esto no es.
- **Costo del cambio:** 7 archivos de pruebas que fijan el título exacto y 2 documentos (lista en S6). Si prefieres no renombrar, se enciende con el nombre actual y se ahorra ese trabajo, pero la tarjeta promete otra cosa.

### D8. Glosario IA (CEN·4): ¿la IA lo saca sola o tú lo apruebas?
- **Recomendación:** la IA **propone** términos y definiciones de una frase a partir de los transcripts; **tú apruebas, editas o descartas** cada uno; solo los aprobados se publican, siempre con «Se explica en: Clase N · mm:ss». Detalle en la sección 10.
- **Si dices «que lo publique sola»:** hay riesgo de definiciones equivocadas bajo tu marca; no lo recomiendo.

---

## 3. Flujo completo

### 3.1 Diagrama

```
 ADMIN (dueño, grupo "admin")                WORKER «clases» (cola propia)             ALUMNO (con sesión)
 ------------------------------------        -------------------------------------     --------------------------------
 1  Crea la clase: número, título, fecha,
    «para qué sirve»  -> fila en `clases`
 2  Sube el video (PUT directo a S3)
    -> clases/<id>/video.mp4   (nunca CDN)
 3  «Medir»: ffprobe 8 s -> duración
 4  Ve el costo: «1.03 h x $0.21 dólares
    por hora = $0.22 dólares»
    Pulsa «Sí, procesar por $0.22 dólares»
    -> clases_trabajos(en_cola) + mensaje
       SQS con SOLO ids
                                              5  reclama el trabajo (UPDATE atómico)
                                              6  ffmpeg: video (URL firmada) -> WAV 16 kHz
                                              7  sube el WAV a AssemblyAI; POST /transcript;
                                                 GUARDA el id en la base ANTES de esperar
                                              8  vuelve a la cola con retraso (30-60 s) y
                                                 pregunta; repite hasta "completed"
                                              9  canónico -> clases/<id>/transcript.canonical.json
                                                 + fila en `costes` (proveedor assemblyai)
                                             10  trocear por tiempo (~1 200-2 000 caracteres)
                                             11  embeber (tarea=documento) en lotes de 100
                                             12  guardar clases/<id>/indice/v<N>/{vectores.f32,
                                                 trozos.json}
                                             13  clases.estado = 'lista'  (aún NO visible)
 14 Revisa (primeras líneas del texto,
    video) y activa «Visible en la Guía»
                                                                                       15  Abre la Guía.
                                                                                           GET /api/guia/estado
                                                                                           (despierta Aurora, calienta caché)
                                                                                       16  Escribe su meta (10-500 caracteres)
                                                                                           POST /api/guia
                                                                                           a. validar texto
                                                                                           b. leer estado/tope (falla cerrado)
                                                                                           c. ¿hay clases visibles? si no: 409
                                                                                           d. candado «una en curso»
                                                                                           e. MODERAR (<= 8 s, sin trazas)
                                                                                              -> rechaza: no gasta, no cuenta
                                                                                           f. embeber la consulta (<= 6 s)
                                                                                           g. buscar en los índices visibles
                                                                                           h. agrupar por clase -> `mejor` + `plan`
                                                                                           i. sumar el uso SOLO si hubo resultado
                                                                                           j. responder {plan, mejor, cobertura}
                                                                                       17  Pulsa «Ver desde 12:40»
                                                                                           GET /api/guia/clases/{id}/video
                                                                                           -> URL firmada de 2 h; el <video>
                                                                                           arranca 5 s antes, en pausa
```

### 3.2 Presupuesto de tiempo del `POST /api/guia` (la Lambda corta a 29 s)

`[V]` La Lambda del API tiene `timeout=29 s` y 1536 MB (`infra/stacks/api.py:66-67`). COI ya resolvió el problema con plazos por etapa (`pipeline/coi.py:23-27`: presupuesto 27 s, moderación 8 s, margen para sumar 3 s). La Guía copia ese molde.

| Etapa | Plazo propio | Notas |
|---|---|---|
| Validar texto, leer estado, candado, lista de clases visibles (Aurora) | hasta 3 s | Si Aurora estaba dormida (dev: ~25 s), el `GET /estado` de la pantalla ya la despertó |
| Moderación | 8 s (`PLAZO_MODERACION_S`) | Sin trazas, falla cerrado |
| Embedding de la consulta | 6 s | **Sin** la escalera de reintentos de 429 de hoy (5+15+30+60 s, `pipeline/embeddings.py:46`): un reintento corto y listo |
| Cargar índices (S3) y buscar | 4 s | En caliente (caché de la Lambda) casi cero |
| Armar la respuesta | menos de 0.1 s | Sin IA en v1 |
| Sumar el uso, soltar el candado, responder | 3 s de margen (`MARGEN_SUMAR_S`) | |
| **Total máximo** | **24 s, dentro de los 27 s de presupuesto** | Tiempo típico: `[POR MEDIR]` |

Si algún plazo se pasa, se devuelve `tardo` (504) y el intento **no** cuenta uso, solo cuenta contra el tope de intentos fallidos (como COI).

### 3.3 Estados de la clase

```
borrador --(presign)--> subiendo --(confirmar)--> subido --(Sí, procesar)--> procesando --> lista
   ^------(cancelar)----+                                                        |            |
                                                                                 v            v
                                                                               error   (el dueño activa) publicada=true
cualquier estado --(archivar)--> archivada --(restaurar)--> el estado que tenía
lista --(Rehacer / Preparar de nuevo)--> procesando   (la versión vieja del índice sigue sirviendo hasta que la nueva termina)
```

`publicada` es un campo aparte (verdadero/falso). Una clase la ve el alumno solo si `estado='lista' AND publicada AND archivada_en IS NULL`.

Estados del trabajo (`clases_trabajos`): `en_cola` → `trabajando` → `esperando` (AssemblyAI) → `trabajando` → `listo` | `fallo`. Sub-paso (`paso`): `audio`, `subiendo`, `esperando_asr`, `troceando`, `embebiendo`, `guardando`.

### 3.4 Puntos de control para no pagar dos veces

`[V]` Hoy el sondeo de AssemblyAI es `while True` sin tope y el id de la transcripción vive en una variable local (`tools/normalizers/asr_backend.py:151-152`). Si la Lambda muere, SQS reentrega y se paga otra transcripción. El procesamiento nuevo lo evita así:
1. Antes de llamar a AssemblyAI: si ya existe el canónico de esa versión del video (mismo `video_etag`), se salta.
2. En cuanto `POST /v2/transcript` responde, el id se guarda en `clases_trabajos.aai_transcript_id` **antes** de esperar. Una reentrega que ve el id hace `GET /v2/transcript/<id>` y nunca vuelve a crear.
3. Solo se reenvía a AssemblyAI cuando el transcript terminó en `error` **y** el dueño pulsa «Reintentar» (con el costo a la vista otra vez).
4. Reclamo atómico del trabajo (`UPDATE … WHERE estado IN (…) RETURNING`), con reclamo vencido a los 15 min, para que una entrega duplicada de SQS no corra en paralelo.
5. El registro del costo se escribe una sola vez por transcripción (`WHERE NOT EXISTS` sobre la columna `traza` = `aai:<id>`).
6. Canónico y trozos se guardan en S3 antes de embeber; las claves de archivos son deterministas, así que reintentar sobrescribe en vez de duplicar.

Ventana residual `[I]`: si el worker muere entre la respuesta de `POST /transcript` y el `UPDATE` que guarda el id (milisegundos), una reentrega crearía una segunda transcripción. Es un riesgo aceptado y documentado.

---

## 4. Modelo de datos e infraestructura

### 4.1 Tablas nuevas (cada sentencia es UNA entrada de `ESQUEMA` en `pipeline/db.py`; deben empezar con `CREATE TABLE IF NOT EXISTS <nombre>` porque así las detecta `tools/db_migrate.py`)

**`clases`** (catálogo; lo que ve el dueño y, filtrado, el alumno)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | text PK | `cl-` + 8 hex, lo genera el servidor |
| `clave` | text | UUID que manda el navegador; índice único parcial → el doble clic no duplica |
| `numero` | int NOT NULL | el «Clase N» que ve el alumno (1 a 999); el servidor rechaza repetidos entre clases vivas (409) |
| `titulo` | text NOT NULL | 1 a 120 caracteres |
| `resumen` | text | «Para qué sirve», máximo 140 caracteres; lo escribe o aprueba el dueño |
| `grabada_en` | date | la cita lo muestra |
| `origen` | text NOT NULL | `archivo` o `liga` |
| `video_key` | text | `clases/<id>/video.<ext>` (origen archivo) |
| `nombre_original` | text | solo para mostrar, limpio y de 120 caracteres o menos |
| `liga` | text | solo referencia; `https`, 500 caracteres o menos |
| `bytes` | bigint | |
| `duracion_s` | double precision | el Data API devuelve `numeric` como texto: usar float |
| `estado` | text NOT NULL DEFAULT `'borrador'` | ver 3.3 |
| `error` | text | motivo corto, **sin** URLs firmadas, ARNs ni texto de nadie |
| `publicada` | boolean NOT NULL DEFAULT false | visible para alumnos |
| `transcript_key` | text | `clases/<id>/transcript.canonical.json` |
| `indice_version` | int NOT NULL DEFAULT 0 | versión del índice que sirve |
| `indice_modelo` | text | por ejemplo `text-embedding-3-small/1024` |
| `trozos_n` | int | |
| `indexada_en` | timestamptz | |
| `creado_por` | text NOT NULL | `sub` de Cognito del admin |
| `creado`, `actualizado` | timestamptz NOT NULL DEFAULT now() | |
| `archivada_en` | timestamptz | borrado suave |

Índices: `CREATE UNIQUE INDEX IF NOT EXISTS clases_clave ON clases (clave) WHERE clave IS NOT NULL` y `CREATE INDEX IF NOT EXISTS clases_vivas ON clases (numero, creado) WHERE archivada_en IS NULL`. Sin llaves foráneas (igual que `coi_estado`, `biblioteca_mios`). Las transiciones de estado son comparar-y-cambiar en una sentencia (`UPDATE … WHERE estado = ANY(:desde) RETURNING id`), el patrón de `coi_tomar` (`pipeline/db.py:2157`).

**`clases_trabajos`** (una fila por corrida de procesamiento; historial y reclamo)

| Columna | Tipo | Notas |
|---|---|---|
| `id` | bigserial PK | es lo único que viaja en el mensaje SQS |
| `clase_id` | text NOT NULL | |
| `tipo` | text NOT NULL | `procesar` o `reembeber` |
| `estado` | text NOT NULL DEFAULT `'en_cola'` | `en_cola`, `trabajando`, `esperando`, `listo`, `fallo` |
| `paso` | text | ver 3.3 |
| `intentos` | int NOT NULL DEFAULT 0 | |
| `token` | text | reclamo; vence a los 15 min |
| `video_etag` | text | evita reprocesar el mismo video |
| `aai_transcript_id` | text | **se guarda apenas existe** |
| `aai_modelo` | text | el que AssemblyAI dice que usó, no el pedido |
| `aai_duracion_s` | double precision | lo que AssemblyAI midió |
| `con_palabras_clave` | boolean NOT NULL DEFAULT false | |
| `usd_visto` | double precision | lo que se le mostró al dueño |
| `usd_asr` | double precision | calculado con la duración real y `pricing.json` |
| `embeddings_modelo` | text | |
| `tokens_emb` | bigint | estimado (Gemini no los reporta) |
| `espera_hasta` | timestamptz | próxima consulta a AssemblyAI |
| `pedido_por` | text NOT NULL | |
| `empezo`, `actualizado`, `termino` | timestamptz | |
| `error` | text | clase del error y motivo corto; nunca texto de la persona |

**`clases_config`** (una fila por clave; v1 solo guarda `keyterms`, la lista opcional de términos para ayudar a la transcripción): `clave text PK`, `valor text NOT NULL`, `actualizado timestamptz`.

**`guia_estado`** (el contador de usos por persona, igual a `coi_estado`, `pipeline/db.py:491-499`): `usuario text PK`, `dia date`, `usos int NOT NULL DEFAULT 0`, `fallos int NOT NULL DEFAULT 0`, `en_curso_hasta timestamptz`, `candado text`. No guarda texto de nadie. Para no copiar SQL, las cuatro funciones de COI (`coi_estado`, `coi_tomar`, `coi_sumar`, `coi_soltar`) reciben un parámetro `servicio="coi"` y toman el nombre de la tabla de un diccionario cerrado (`{"coi": "coi_estado", "guia": "guia_estado"}`; jamás de la entrada de alguien). Ni las firmas ni los nombres `coi_*` cambian, así que `tests/test_coi_mundo.py` y `tests/test_coi_api.py` siguen intactos.

**Tabla ya existente que se reutiliza:** `costes` (`pipeline/db.py:196-205`): se escribe una fila por transcripción con `proveedor='assemblyai'`, `concepto='clases-transcribir'`, `proyecto_id=<id de clase>`, `traza='aai:<id>'`.

**Migración obligatoria** en cada entorno **antes** de desplegar: `tools/db_migrate.py` (dev y prod, cada uno con sus ARNs). Sin ella los endpoints dan 503. Se agrega a la lista de `docs/OPERACION.md` («Antes de desplegar: la migración es OBLIGATORIA»).

### 4.2 Archivos en S3 (todo bajo `clases/`, que nace cerrado al CDN)

```
clases/<id>/video.<ext>                       el video subido (clave elegida por el servidor, no por la persona)
clases/<id>/transcript.canonical.json         el canónico (esquema 1.0, docs/SCHEMA.md)
clases/<id>/indice/v<N>/vectores.f32          n x 1024 float32 little-endian, cada vector con norma L2 = 1
clases/<id>/indice/v<N>/trozos.json           [{"i":0,"inicio_s":12.4,"fin_s":131.9,"texto":"..."}, ...]
```

- `[V]` `clases/` **no** está en `SERVIBLES_CDN = ("imagenes/","usuarios/","voces/","work/")` (`pipeline/media_rutas.py:38-43`). Ejecuté `servible_por_cdn('clases/cl-ab12cd34/video.mp4')` → `False` (también con barra inicial). La política del bucket niega a CloudFront todo lo no listado (`infra/stacks/media.py`, `not_resources`), así que `https://<cdn>/clases/…` da 403 y los videos solo se ven con URL firmada. **No agregar `clases/` a esa lista**; un test lo fija.
- No poner transcripts ni audio derivado bajo `work/` ni `usuarios/` (esos los sirve el CDN sin login).
- `vectores.f32` se lee con `numpy.frombuffer(..., dtype="<f4").reshape(-1, 1024)`; **nunca** con pickle. `[V]` `numpy==2.2.6` está fijado en `requirements.txt:21` y el `Dockerfile` instala ese archivo.
- `[V]` `pipeline/media_sync.py` solo tiene helpers de texto y de archivo (`leer_texto`, `escribir_texto`, `subir_archivo`, `bajar_archivo`); hay que agregar `leer_bytes` y `escribir_bytes` (o subir desde un archivo temporal).
- La versión vieja del índice no se borra (`[V]` nadie borra en S3: el rol no tiene `s3:DeleteObject` a propósito, `infra/stacks/api.py:104`); ocupa unos MB.

### 4.3 Decisión técnica mía: el índice como archivos, no en S3 Vectors

El dueño no tiene que decidir esto; lo dejo explícito porque cambia la infraestructura.

| | **Archivos en S3 (recomendado)** | S3 Vectors (lo que consideró `rag.md`) |
|---|---|---|
| Tamaño del problema | 20 clases de 1 h ≈ 600 a 1 100 trozos (`rag.md` §6.7: 30 a 55 trozos por hora) ≈ 2.4 a 4.5 MB | Pensado para millones de vectores |
| Infra nueva | Ninguna para consultar: `[V]` el API ya lee todo el bucket (`media_bucket.grant_read(fn)`, `infra/stacks/api.py:106`) | Índice nuevo; permisos de lectura para el API y de escritura para el worker; dueño corre `tools/vectores.py crear --confirmar` en dev **y** en prod; prod no tiene ni bucket vectorial (`PROD.vectores_bucket=None`) |
| Guardianes de seguridad | No los toca | `[V]` Hay que editar a propósito `tests/test_entornos.py:668` (el worker público tiene EXACTAMENTE una sentencia `s3vectors`) y `:703` (nadie más que `aws-media-jobs-dev` toca S3 Vectors; ni el API ni prod) |
| Precio de consulta | S3 GET: sin precio confirmado (no hay precios de S3 en `pricing.json`) | `s3vectors.consultas_por_millon`: sin precio confirmado (`tools/pricing.json`, `rag.pendiente`) |
| Borrar/archivar | Se filtra por `publicada` en Aurora; reescribir un archivo es trivial | No hay forma de borrar vectores en el repo; fantasmas al re-trocear |
| Latencia | Cargar 2 a 5 MB de S3 y un producto matricial; `[POR MEDIR]` | `[POR MEDIR]` |
| Escala | Cómodo hasta ~10 000 trozos (~40 MB float32; ~200 a 330 horas) | Sin tope práctico |

**Cuándo migrar a S3 Vectors:** más de ~150 horas de clases, o latencia medida de búsqueda por encima de 2 s. La migración es copiar los vectores ya calculados con `put_vectors`; no se re-embebe. Por eso el buscador se escribe detrás de una interfaz mínima, `buscar(vector, k) -> hallazgos`, en un solo archivo.

Riesgo de este camino `[I]`: cada Lambda en frío descarga los archivos de las clases visibles. Mitigación: caché en memoria por `(clase_id, indice_version)` con tope de 200 MB, y el `GET /api/guia/estado` (que la pantalla pide al abrirse) lanza la carga en un hilo para tenerlo caliente antes de la primera consulta.

### 4.4 Cambios de infraestructura (CDK) y permisos

| Cambio | Detalle | PR |
|---|---|---|
| Cola `ClasesQueue` + DLQ `ClasesDlq` | `visibility_timeout` 15 min; DLQ tras 3 recepciones; retención 14 días (la de la DLQ) | S4 |
| Worker `WorkerClases` | Lambda de imagen existente, `cmd=["worker.clases.handler"]`, 2048 MB, timeout 15 min, `max_concurrency=2` (el mínimo de SQS). Env: `STATE_BACKEND=postgres`, datos de Aurora, `MEDIA_BUCKET`, `SSM_ENV_PREFIX=/env` (necesita `ASSEMBLYAI_API_KEY` y la clave de embeddings), `GUIA_EMBEDDINGS`. Permisos: Data API; S3 `grant_put` y `grant_read` **solo sobre `clases/*`** (el patrón de `automatiza/*`, `infra/stacks/jobs.py`); enviar a su propia cola (para el re-encolado con retraso). **Nada más**: ni SES, ni `s3vectors`, ni la cola de pago, ni claves por usuario | S4 |
| API Lambda | Env `CLASES_QUEUE_URL`, `GUIA_ACTIVA`, `GUIA_EMBEDDINGS`; `grant_send_messages` a la cola nueva. **No** hay permisos de S3 nuevos (ya lee todo el bucket). La clave de embeddings sale del prefijo `/env` que el API ya puede leer (`infra/stacks/api.py:133`) | S4 |
| `Entorno` (`infra/entornos.py`) | Campos nuevos `guia_activa: bool = False` y `guia_embeddings: str \| None`. La Guía solo se enciende donde el entorno lo dice (patrón de `armado_real`) | S4 |
| Test de CDK nuevo | El worker de clases tiene S3 solo sobre `clases/*`, no menciona `s3vectors` y no puede enviar a ninguna cola ajena | S4 |
| Ciclo de vida del bucket | Según `admin.md` (no lo reabrí): la regla de Glacier Instant Retrieval a los 10 días no tiene filtro de prefijo (`infra/stacks/media.py:81-96`), así que `clases/` también pasaría. Releer un video cuesta recuperación: **sin precio confirmado** en `pricing.json`. No lo cambio en v1; decisión técnica pendiente antes de S7 | aparte |

### 4.5 Claves y variables

| Qué | Dónde | Nota |
|---|---|---|
| AssemblyAI | `ASSEMBLYAI_API_KEY` en `/env` (SSM) | `[V]` ya la usan los workers de pago (`worker/shorts_analizar.py`); en prod está verificada según `PLAN-PRODUCTO.md:393`; **en dev no la confirmé** |
| Embeddings con OpenAI | `OPENAI_API_KEY` de plataforma | Ya está en el API (la usan COI y la moderación) |
| Embeddings con Gemini | Clave **propia de la Guía**: `GEMINI_API_KEY_GUIA` en `/env` (agregar a la lista `CLAVES` de `tools/ssm_env.py`, que hoy tiene `GEMINI_API_KEY` en su línea 46) | `[V]` `embeddings.clave()` hoy cae en silencio a `GEMINI_API_KEY` (la de Veo/imágenes) si no hay la `_PUBLICO` (`pipeline/embeddings.py:58-62`); la Guía pasa la clave explícita para no mezclar gasto |
| Moderación | La de plataforma, con `sin_trazas` | `[V]` `moderacion.revisar(..., sin_trazas=True)` llama `llm.chat_json` con `settings.openai_model` (por defecto `gpt-5-mini`, `pipeline/config.py:33`; la variable `OPENAI_MODEL` de `/env` puede cambiarlo) sin Langfuse |
| `embeber()` | Parámetro nuevo `proveedor=` y `clave=` | `[V]` hoy el proveedor es una variable global (`vectores.proveedor()` lee `EMBEDDINGS`, `pipeline/vectores.py:101`) |

### 4.6 Módulos nuevos (nombres propuestos)

- `pipeline/clases.py`: constantes y límites, validación de liga y títulos, `costo_procesar(duracion_s, con_palabras_clave)` leyendo `tools/pricing.json` (jamás hardcodeado).
- `pipeline/transcripcion.py`: función **pública** `crear_transcripcion(wav, perfil, al_crear)` (llama a `al_crear(id)` para persistirlo) y `consultar_transcripcion(id)`. Sin `while True`. Reintentos con espera creciente para `/upload`, `POST` y cada `GET`. Devuelve modelo, idioma y duración reales. Perfil de clases: `language_code="es"`, el `prompt` de code-switching de `tools/transcribe.py:42-47`, y `keyterms_prompt` solo si hay lista. Hoy la ruta web fija `es` y no manda ni prompt ni keyterms (`asr_backend.py:148`), y el CLI sí (`transcribe.py:207-211`).
- `pipeline/clases_indice.py`: `trocear(canonico)`, `escribir_indice`, `leer_indice`, `buscar`, `armar_respuesta`.
- `pipeline/guia.py`: constantes del contrato y catálogo de errores.
- `server/clases_admin_api.py` (router con `dependencies=[Depends(_exigir_admin)]` a nivel de router, para que ninguna ruta nueva pueda olvidarlo; hoy `_exigir_admin()` se llama a mano en cada handler, `server/admin_api.py:40-45`) y `server/guia_api.py`.
- `worker/clases.py` (handler de la cola nueva) y `worker/clases_procesar.py`.
- `tools/eval_guia.py` (ensayo y corrida, patrón de `tools/eval_rag.py`) y `tools/guia_semilla.py` (solo dev, ver S3).
- Web: `web/src/pantallas/guia/*` y `web/src/pantallas/admin/Clases.tsx`.

### 4.7 Troceo por tiempo y búsqueda (parámetros)

- `[V]` El canónico trae palabras con `start`/`end` en segundos-float (`docs/SCHEMA.md`) y `segments[]` que cierran en una pausa de 0.8 s o más (`tools/normalizers/common.py:17`) o, según `transcripcion.md`, en puntuación final. Los segmentos son la unidad de troceo.
- **Trozo:** acumular segmentos hasta ~1 200 a 2 000 caracteres (≈1.5 a 2.5 minutos a ~150 palabras por minuto, supuesto mío). Mínimo 400 (`tools/ingesta.py` `MIN_CARACTERES`); tope duro 6 000 (`MAX_CARACTERES`, por el contexto de 2 048 tokens de Gemini con `auto_truncate=False`). Solape de 1 segmento entre vecinos. Si un segmento solo pasa el tope (habla sin puntuación), partir por palabras.
- `inicio_s = words[segmento.first_word].start`; `fin_s = words[segmento.last_word].end`.
- **Texto a embeber:** `Clase {numero}: {titulo}\n{texto hablado}` (el título va dentro del texto, como `tools/ingesta.py:233`). El sello de tiempo **no** va en el texto embebido.
- **Embedding:** documentos con `tarea="documento"` y la consulta con `tarea="consulta"` (`pipeline/embeddings.py` exige decir cuál, porque mezclarlos degrada la búsqueda sin error). 1024 dimensiones, norma L2 = 1 (`pipeline/vectores.py` `normalizar`/`validar`). Un índice solo se consulta con el mismo `indice_modelo` con el que se creó; las clases con otro modelo se excluyen y el admin las marca «Preparar de nuevo para buscar».
- **Búsqueda:** `puntajes = matriz @ q` por cada clase visible; puntaje de la clase = su trozo con mayor similitud. Según `rag.md` §6.7, un solo video puede llenar los 30 resultados de un `top-k`; por eso se agrupa por clase en vez de pedir `k` global.
- **Cobertura:** `alta` si `mejor ≥ UMBRAL_ALTA`; `parcial` si `UMBRAL ≤ mejor < UMBRAL_ALTA`; `ninguna` si `mejor < UMBRAL`.
- **Plan:** clases con puntaje ≥ `max(UMBRAL, mejor − MARGEN)`, hasta 7 (se quedan las 7 de mayor puntaje), **ordenadas por `numero`**. Cada paso: `inicio_s` = inicio de su mejor trozo; `fin_s` = fin de ese trozo, extendido a los vecinos inmediatos si su puntaje ≥ `UMBRAL`; `para_que` = `clases.resumen` (si no hay, se omite); `fragmento` = primeros 140 caracteres del mejor trozo, recortados en límite de palabra.
- **Mejor:** la clase de mayor puntaje, con el inicio de su mejor trozo; `en_plan` = su número de paso si está en el plan.
- **`UMBRAL`, `UMBRAL_ALTA` y `MARGEN` no existen todavía.** Según `rag.md` (`pipeline/armado.py:83`), el código de RAG de n8n entrega siempre los K más cercanos sin corte, así que no hay precedente. Se calibran en S5 con `tools/eval_guia.py`. Mientras sean `None`, el API responde `no_disponible` y `GUIA_ACTIVA` no se enciende.

---

## 5. Endpoints: contrato JSON, errores y límites

**Reglas comunes.** Todo bajo `/api/…` exige token (el middleware ya lo valida; `PREFIJOS_PUBLICOS` es solo `/api/publico/`). Los errores son `HTTPException(status, detail={"codigo": "...", "texto": "..."})`; `[V]` `ErrorApi` ya lee `detail.texto` (`web/src/nucleo/api.ts:47-57`). El texto de la persona **nunca** aparece en un error ni en un log. Los cuerpos usan `ConfigDict(extra="forbid")`. Nada que venga del navegador es una clave de S3, un precio ni una duración.

### 5.1 Admin (`/api/admin/clases`, solo grupo `admin`; 403 «Solo para administradores» si no)

| Método y ruta | Cuerpo | Respuesta | Errores `codigo` |
|---|---|---|---|
| `GET /api/admin/clases?archivadas=0` | n/a | `{clases:[Clase], limites:{…}, precios:{…}}` | `no_admin` 403 |
| `POST /api/admin/clases` | `{clave, numero, titulo, resumen?, grabada_en?, origen:"archivo"\|"liga", liga?}` | 201 `{clase}` (misma `clave` = misma clase) | `titulo_invalido` 422, `numero_invalido` 422, `numero_repetido` 409, `liga_invalida` 422, `resumen_largo` 422 |
| `PATCH /api/admin/clases/{id}` | `{numero?, titulo?, resumen?, grabada_en?, liga?}` | `{clase}` | `no_existe` 404, `numero_repetido` 409 |
| `POST /api/admin/clases/{id}/subida` | `{archivo, content_type, bytes}` | `{url, content_type, expira_s}` (la clave la decide el servidor) | `extension_no_soportada` 422, `tipo_no_soportado` 422, `tamano_invalido` 422, `estado_no_permite` 409, `origen_liga` 409 |
| `POST /api/admin/clases/{id}/confirmar` | `{nombre?}` | `{clase}` (`head_object`; estado `subido`) | `archivo_no_esta` 404, `video_vacio` 422, `tamano_invalido` 422, `tipo_no_soportado` 422 |
| `POST /api/admin/clases/{id}/medir` | n/a | `{clase}` con `duracion_s` (ffprobe, 8 s) | `medir_fallo` 502 |
| `POST /api/admin/clases/{id}/cancelar` | n/a | `{clase}` (`subiendo` → `borrador`) | `estado_no_permite` 409 |
| `GET /api/admin/clases/{id}/video` | n/a | `{url, expira_s}` (vista previa del dueño, firmada, 2 h) | `no_existe` 404 |
| `GET /api/admin/clases/{id}/costo` | n/a | ver ejemplo abajo | `sin_duracion` 422, `duracion_fuera_de_rango` 422 |
| `POST /api/admin/clases/costo` | `{ids:[…]}` | costo total del lote | igual |
| `POST /api/admin/clases/{id}/procesar` | `{confirmo:true, usd_visto, palabras_clave?:false, rehacer?:false}` | 202 `{clase, trabajo:{id, estado}}` | `costo_cambio` 409, `ya_procesando` 409, `ya_lista` 409, `sin_duracion` 422, `sin_cola` 503 |
| `GET /api/admin/clases/{id}/trabajo` | n/a | `{estado, paso, intentos, error, actualizado}` | `no_existe` 404 |
| `GET /api/admin/clases/{id}/texto` | n/a | `{inicio:"primeros 600 caracteres del transcript", palabras:N}` (para revisar antes de publicar) | `sin_transcript` 409 |
| `POST /api/admin/clases/{id}/publicar` | `{publicada:true\|false}` | `{clase}` | `no_lista` 409, `indice_viejo` 409 |
| `PUT /api/admin/clases/palabras-clave` | `{valor}` (una por línea, 200 líneas o menos) | `{ok:true}` | `palabras_invalidas` 422 |
| `DELETE /api/admin/clases/{id}` | n/a | `{ok:true}` (**borrado suave**: `archivada_en`; no toca S3 ni el índice) | `no_existe` 404 |
| `POST /api/admin/clases/{id}/restaurar` | n/a | `{clase}` | `no_existe` 404 |

Las rutas de segmento fijo (`/costo`, `/palabras-clave`) se declaran **antes** de `/{id}` (el repo ya se mordió con esto). El router se incluye en `server/app.py` **antes** del montaje `/` de archivos estáticos (`admin.md` §1.4).

**`GET /api/admin/clases` (extracto):**
```json
{
  "clases": [{
    "id": "cl-3f9a21bc", "numero": 5, "titulo": "Respuestas automáticas con tus datos",
    "resumen": "Conectas la IA con la información de tu negocio para que conteste como tú.",
    "grabada_en": "2026-03-12", "origen": "archivo", "nombre_original": "clase5.mp4",
    "liga": null, "bytes": 1503238553, "duracion_s": 3720.4,
    "estado": "lista", "paso": null, "error": null, "publicada": false,
    "indice": {"version": 1, "modelo": "text-embedding-3-small/1024", "trozos": 118, "en": "2026-10-20T15:02:11Z"},
    "creado": "2026-10-19T20:00:00Z", "actualizado": "2026-10-20T15:02:11Z"
  }],
  "limites": {
    "max_bytes": 5368709120, "extensiones": [".mp4", ".mov", ".m4v"],
    "content_types": ["video/mp4", "video/quicktime", "video/x-m4v"], "presign_s": 900,
    "duracion_min_s": 60, "duracion_max_s": 7200, "titulo_max": 120, "resumen_max": 140
  },
  "precios": {
    "transcripcion_usd_por_hora": 0.21, "palabras_clave_usd_por_hora": 0.05,
    "embeddings": {"modelo": "text-embedding-3-small", "usd_por_millon_tokens": 0.02}
  }
}
```
Si el proveedor de embeddings es Gemini, `precios.embeddings` es `{"modelo":"gemini-embedding-001","usd_por_millon_tokens":null,"texto":"sin precio confirmado"}`. Los precios los pone el servidor leyendo `tools/pricing.json`; el bundle web **nunca** importa ese archivo (lo prohíbe eslint).

**`GET /api/admin/clases/{id}/costo`:**
```json
{
  "clase_id": "cl-3f9a21bc", "duracion_s": 3720.4, "horas": 1.0334,
  "lineas": [
    {"paso": "Transcribir con AssemblyAI", "usd": 0.217, "formula": "1.03 h × $0.21 dólares por hora"},
    {"paso": "Palabras clave (opcional)", "usd": 0.052, "formula": "1.03 h × $0.05 dólares por hora", "activa": false},
    {"paso": "Preparar para buscar", "usd": 0.0002, "formula": "≈ 14 000 tokens × $0.02 dólares por millón"}
  ],
  "total_usd": 0.217,
  "pendientes": [],
  "texto": "Transcribir esta clase cuesta unos $0.22 dólares. Verifica tu crédito en el dashboard de AssemblyAI."
}
```
Con Gemini, la línea de embeddings trae `"usd": null` y entra a `pendientes` con «sin precio confirmado»; `total_usd` suma solo lo que sí tiene precio y el texto lo dice. `usd_visto` de `procesar` debe coincidir con `total_usd` (tolerancia $0.005); si el precio o la duración cambiaron, responde `costo_cambio` 409 y la pantalla vuelve a mostrar el costo nuevo.

### 5.2 Alumno

**`GET /api/guia/estado`** (falla cerrado; despierta Aurora; lanza la carga de índices en un hilo):
```json
{"tope": 5, "usos": 1, "quedan": 4, "renueva_en_s": 19200, "se_renueva": true,
 "en_curso": false, "gratis": true, "clases_listas": 18, "actualizado": "2026-10-17"}
```
`actualizado` = fecha de la última clase activada. Errores: `no_disponible` 503.

**`POST /api/guia`** con `{"texto": "Quiero automatizar las respuestas a mis clientes por WhatsApp"}`:
```json
{
  "cobertura": "alta",
  "plan": [
    {"paso": 1, "clase_id": "cl-aa11bb22", "numero": 2, "titulo": "Cómo hablarle a la IA",
     "inicio_s": 250, "fin_s": 870, "grabada_en": "2026-02-10",
     "para_que": "Aprendes a pedirle las cosas a la IA para que te responda lo que necesitas.",
     "por_que": null, "fragmento": "…y por eso conviene decirle primero quién eres y qué quieres…"},
    {"paso": 2, "clase_id": "cl-3f9a21bc", "numero": 5, "titulo": "Respuestas automáticas con tus datos",
     "inicio_s": 760, "fin_s": 1325, "grabada_en": "2026-03-12",
     "para_que": null, "por_que": null, "fragmento": "…aquí conectamos WhatsApp con la IA paso a paso…"}
  ],
  "mejor": {"clase_id": "cl-3f9a21bc", "numero": 5, "titulo": "Respuestas automáticas con tus datos",
            "inicio_s": 760, "grabada_en": "2026-03-12", "por_que": null, "en_plan": 2},
  "estado": {"tope": 5, "usos": 2, "quedan": 3, "renueva_en_s": 19200, "se_renueva": true,
             "en_curso": false, "gratis": true, "clases_listas": 18, "actualizado": "2026-10-17"}
}
```
- Los valores de arriba son **ilustrativos**: no hay ninguna clase cargada en el repo.
- `cobertura:"ninguna"` → HTTP 200 con `plan: []` y `mejor: null`; **no** cuenta uso, sí cuenta contra el tope de intentos fallidos (para que nadie barra el catálogo).
- `por_que` es `null` en v1; lo llena S8 si se aprueba la IA.
- Todo texto que llega al navegador (`titulo`, `para_que`, `fragmento`) se pinta como texto, nunca como HTML.

**`GET /api/guia/clases/{id}/video?desde=760`**:
```json
{"url": "https://…firmada…", "expira_s": 7200, "inicio_s": 755, "duracion_s": 3720}
```
`inicio_s = max(0, desde − 5)` (colchón de 5 segundos para no cortar la primera frase). 404 `clase_no_disponible` si la clase no existe, no está lista, no está visible o está archivada (mismo 404 para todos, para no revelar nada). `[V]` Se firma con `media_sync.url_firmada` (siempre S3), **no** con `url_media` (que podría elegir el CDN si alguien agregara `clases/` a la lista por error).

### 5.3 Errores del alumno `{codigo, texto}` (copiables a `ERRORES` de `pipeline/guia.py`)

| `codigo` | HTTP | `texto` | ¿Cuenta uso? |
|---|---|---|---|
| `texto_vacio` | 422 | Escribe primero qué quieres lograr, aunque sea en una frase. | no |
| `texto_corto` | 422 | Cuéntanos un poco más para poder buscar bien: escribe al menos 10 caracteres. | no |
| `texto_largo` | 422 | Es muy largo: el máximo es de 500 caracteres. Acórtalo para armar tu guía. | no |
| `texto_invalido` | 422 | Tu texto trae un carácter que no se puede procesar (suele venir de pegar desde otro programa). Bórralo e inténtalo de nuevo. | no |
| `moderacion` | 422 | No pudimos usar ese texto. {motivo corto del servidor} Cuéntalo con otras palabras e inténtalo otra vez. No se gastó ninguno de tus usos. | no (cuenta como intento fallido) |
| `limite_diario` | 429 | Ya usaste tus 5 guías de hoy. Se renuevan a la medianoche, hora de México. | n/a (+`renueva_en_s`) |
| `demasiados_intentos` | 429 | Por hoy ya no podemos intentarlo más. Vuelve mañana. | n/a (+`renueva_en_s`) |
| `en_curso` | 409 | Estamos armando la guía que pediste hace un momento. Espera a que termine para pedir otra. | no |
| `sin_clases` | 409 | Todavía no hay clases listas para la guía. Vuelve pronto. | no |
| `tardo` | 504 | La búsqueda tardó demasiado. No se gastó ninguno de tus usos; inténtalo otra vez. | no (intento fallido) |
| `busqueda` | 502 | Algo falló de nuestro lado. No se gastó ninguno de tus usos; inténtalo otra vez. | no (intento fallido) |
| `no_disponible` | 503 | La guía no está disponible ahora. Inténtalo en unos minutos. | no |
| `clase_no_disponible` | 404 | Esta clase no está disponible. | n/a |

### 5.4 Límites

| Límite | Valor | De dónde |
|---|---|---|
| Texto de la persona | 10 a 500 caracteres (puntos de código, como cuenta el servidor) | mío; COI usa 2 000 (`pipeline/coi.py:21`); una meta no necesita tanto |
| Guías terminadas por persona y día | 5 (día de México) | decisión 6 (COI: 3, `coi.py:20`) |
| Intentos que no cuentan, por persona y día | 20 | `MAX_FALLOS_DIARIOS` de COI (`coi.py:35`) |
| Una guía en curso por persona | candado de 60 s | `CADUCA_CANDADO_S` de COI |
| Pasos del plan | 2 a 7 | `producto.md` |
| Fragmento mostrado | 140 caracteres | |
| URL de video firmada | 7 200 s (2 h) | mío; la de hoy es 3 600 s por defecto y una clase larga se congelaría |
| Video: extensiones / tamaño | `.mp4`, `.mov`, `.m4v` / 5 GiB (PUT de una parte) | `[V]` `server/media_api.py:32-34` |
| Duración de una clase (v1, provisional) | 60 s a 7 200 s (2 h) | mío: `[V]` `/tmp` de la Lambda es 512 MB (no hay `ephemeral_storage`), un WAV de 16 kHz mono pesa ~115 MB por hora (cálculo mío) y el límite de 90 min del flujo de pago existe porque «más largo no cabe en el worker de 15 min» (`server/shorts_api.py:38`). Se recalibra en S5 |
| Título / resumen | 120 / 140 caracteres | |
| Palabras clave | 200 líneas | mío |

---

## 6. Pantallas

### 6.1 Alumno: `/estudio/guia/` (clave de menú `guia`, atajo `/guia.html`)

Se copia el esqueleto de COI (`web/src/pantallas/coi/`): `h1` «Irremplazables» dorado, migas «Central › Distrito › Guía de clases», columna de 760 px, un solo botón ámbar. Reglas de la carta de diseño que mandan (`docs/DISENO.md`): un botón ámbar por pantalla; botones apagados con `aria-disabled`; área táctil de 44 px o más; texto de 13 px o más; sin recursos externos; pista que rota solo con las reglas de Edición; `<video>` con `<track kind="captions" />` (eslint `jsx-a11y` lo exige).

**Textos de la pantalla (finales)**

| Elemento | Texto |
|---|---|
| Línea de apoyo en el mapa | Dinos qué quieres lograr y te decimos qué clases ver |
| `h2` | Guía de clases |
| Bajada | Cuéntanos qué quieres lograr y te decimos qué clases ver, en qué orden y desde qué minuto. |
| Alcance | Buscamos solo en las clases de la academia. No es un chat de IA general. |
| Etiqueta del campo | ¿Qué quieres lograr? |
| Ayuda bajo el campo | Cuéntalo como se lo contarías a un amigo: qué quieres lograr, para quién y cuánto tiempo tienes. Por ejemplo: «Quiero automatizar las respuestas a mis clientes por WhatsApp». |
| Contador de caracteres | 87 de 500 (desde 400 caracteres: «Te quedan 100») |
| Botón (único ámbar) | Armar mi guía · trabajando: Armando… · tras un resultado: Armar otra guía |
| Contador de usos | Te quedan 5 de 5 hoy · Te queda 1 de 5 hoy · Ya usaste tus 5 de hoy |
| Promesa de uso | Gratis por ahora. Solo cuentan las guías que terminan bien. |
| Privacidad | No guardamos lo que escribes ni la guía que te armamos. Para buscar en las clases, tu texto pasa por servicios de IA. |
| Pie | ¿Prefieres un prompt ya hecho? · enlace «Mira la Biblioteca de prompts» |

**Ejemplos que rotan dentro del campo** (provisionales; **deben ser metas que las clases sí cubran**, así que los aprueba el dueño contra el temario real; 62 caracteres o menos cada uno):
1. Quiero automatizar las respuestas a mis clientes por WhatsApp
2. Quiero escribir mejores prompts para mi negocio
3. Quiero hacer un video corto con IA para mi marca
4. No sé por dónde empezar con la IA y tengo poco tiempo

**Resultado.** Encabezado `h3` «Tu guía» (recibe el foco), línea «Para: «…»» con enlace «Cambiar mi texto», y las pestañas (`ui/Pestanas`, etiqueta «Vistas de tu guía»): **Plan paso a paso** y **Solo el video**.

Vista «Plan paso a paso»: primera línea «Sigue este orden. Son 4 clases y, en total, unos 52 min de video.» (si falta `fin_s`, se omite la duración). Lista ordenada (`<ol aria-label="Pasos del plan">`); cada paso:
- `h4`: «Paso 2 de 4 · Clase 5: Respuestas automáticas con tus datos»
- «Desde 12:40, hasta 22:05 (unos 9 min) · Grabada en marzo de 2026»
- «Para qué sirve:» (solo si hay `para_que`)
- «Lo que dice la clase:» (el fragmento, en un `<details>`)
- Botón secundario «Ver desde 12:40» (abre el reproductor dentro del paso y mueve el foco al `<video>`, en pausa) y enlace «Abrir la clase completa».

Al final, caja de aviso: «Los minutos vienen directo de las clases: ante la duda, míralo ahí. El texto de «Lo que dice la clase» sale de una transcripción automática y puede traer errores.»

Vista «Solo el video»: «Si solo tienes tiempo para una clase, empieza por esta.» Tarjeta con título, «Empieza en el minuto 12:40 · Grabada en marzo de 2026», reproductor 16:9 en pausa en el minuto exacto, botones «Volver al 12:40» y «Abrir la clase completa», y el pie «¿Quieres ver el orden completo? Ver el plan paso a paso». Si el plan sale con menos de 2 pasos, esta es la pestaña inicial y la del plan dice «Para lo que pides solo hay una clase, así que no hace falta un plan.»

**Reproductor.** `<video controls preload="metadata" playsInline>` **sin `autoPlay`**; el `src` es la URL firmada (se pide al pulsar «Ver desde…», nunca se guarda) con `#t=<inicio_s>` y además `currentTime = inicio_s` en `loadedmetadata` (algunos navegadores móviles ignoran el fragmento). `[V]` El repo ya usa `#t=0.5` en las miniaturas de video (`HojaVideos.tsx:396`, `Obras.tsx:178`); que en producción esas URLs sean firmadas lo afirma `admin.md`, no lo comprobé. `[I]` En Safari/iOS con URLs largas de video no lo probé. Si el video falla: «No pudimos cargar este video. Puedes abrir la clase completa o volver a intentarlo.» con «Reintentar» (pide una URL nueva; la anterior pudo caducar).

**Estados de la pantalla**

| Estado | Cuándo | Título y texto | Foco / anuncio |
|---|---|---|---|
| Revisando usos | llega `GET /estado` | «Revisando cuántos te quedan…»; botón apagado con motivo | sin mover |
| Reposo | hay usos y clases | la pantalla de arriba | |
| Sin clases | `clases_listas = 0` | «Estamos preparando las clases» · «Todavía no hay clases listas para la guía. Vuelve pronto.» + enlace a la Biblioteca. Entrada apagada con motivo | |
| Cargando | POST en vuelo | «Armando tu guía…» · «Estamos buscando en las clases lo que más te sirve y poniéndolo en orden. Llevas 0:07.» · «No se gasta ninguno de tus usos si algo falla. No cierres ni recargues esta pantalla: no guardamos nada, así que si sales antes de que termine, el uso se cuenta igual y no podrás ver la guía.» Giro con `motion-safe:animate-spin`. **Un solo paso real y el reloj**, sin pasos falsos (`docs/DISENO.md:357`) | región `role="status"`: «Armando tu guía…»; al terminar: «Tu guía está lista: 4 clases en orden.» |
| Sin resultado | `cobertura:"ninguna"` | **«No encontramos una clase para esto»** · «Buscamos en las N clases de la academia y ninguna habla de esto todavía. No se gastó ninguno de tus usos.» · «Prueba así: di qué quieres lograr, no la herramienta; agrega para quién es; usa una frase, no una palabra suelta.» Botones: «Cambiar mi texto», enlace «Mira la Biblioteca de prompts» | foco al `h3` |
| Resultado parcial | `cobertura:"parcial"` | Caja de aviso arriba de las pestañas: «Esto es lo más cercano que encontramos y puede que no cubra todo lo que pides.» | |
| Moderación | `moderacion` | junto al cuadro, en rojo: «No pudimos usar ese texto.» + motivo + «Cuéntalo con otras palabras e inténtalo otra vez.» (el texto se queda en el cuadro) | foco al cuadro |
| Límite diario | `limite_diario` | caja neutra, no error: «Ya usaste tus 5 guías de hoy» · «Se renuevan a la medianoche, hora de México (12:00 a. m.). Faltan 5 h 20 min.» · «Mientras tanto, tu última guía sigue aquí arriba.» | cuadro y botón apagados |
| Demasiados intentos | `demasiados_intentos` | «Por hoy ya no podemos intentarlo más» + texto del servidor + «Faltan…» | |
| Otra en curso | `en_curso` | «Ya hay una guía en camino» | botón apagado con motivo |
| Error de búsqueda | `busqueda`, `tardo` | «Algo falló de nuestro lado» / «Tardó demasiado» · «No se gastó ninguno de tus usos.» · «Tu texto sigue en el cuadro. Pulsa «Armar mi guía» para intentarlo otra vez.» | `role="alert"` |
| Sin conexión | estado 0 o aborto a los 45 s | «No hay conexión» · «No recibimos respuesta. Revisa tu conexión e inténtalo otra vez.» | |
| Guía no disponible | `no_disponible` o no se leyó el contador | «La guía no está disponible ahora» + «Reintentar» | |

**Reglas de privacidad en la pantalla:** nada de lo escrito ni de la guía toca `localStorage`, `sessionStorage`, IndexedDB ni cookies; `beforeunload` solo mientras se arma; los enlaces a otras pantallas se abren en pestaña nueva con `rel="noopener"` cuando hay una guía en pantalla (porque la guía no se guarda). Un guardián `tests/test_guia_web_guardianes.py` (copia parametrizada de `tests/test_coi_web_guardianes.py`) lo vigila.

**Accesibilidad.** Jerarquía `h1` Irremplazables → `h2` Guía de clases → `h3` Tu guía → `h4` por paso. Ctrl/Cmd+Enter envía (`aria-keyshortcuts`). «Ver desde 12:40» mueve el foco al reproductor y lo anuncia en pausa; su nombre accesible incluye la clase. Los ejemplos que rotan se quedan fijos con «reducir movimiento», con foco, con texto escrito o con la pestaña oculta. Pruebas con Playwright a 1100, 390 y 320 px más axe.

### 6.2 Admin: pestaña «4 · Clases» en `/estudio/admin/`

`[V]` Hoy son tres pestañas (`web/src/pantallas/admin/Admin.tsx:144-153`) y la barra solo se pinta cuando `GET /api/admin/resumen` salió bien (`Admin.tsx:139`). Se agrega una cuarta, **última**, para no tocar las otras tres. Radix desmonta el contenido de la pestaña inactiva `[I]`, así que «Clases» solo pide sus datos cuando se abre. Limitación aceptada: si `resumen` falla (Aurora dormida, CloudWatch), tampoco hay pestaña «Clases».

**Textos**

| Elemento | Texto |
|---|---|
| Pestaña | 4 · Clases |
| Ayuda | Aquí subes los videos de las clases que usa la Guía. Subir no cuesta nada. Procesar sí: transcribe el video y lo prepara para buscar, y siempre te mostramos el costo antes de empezar. |
| Botón principal (único ámbar de la vista) | Nueva clase |
| Formulario | Número de clase («Es el «Clase N» que verá la persona») · Título · Fecha de grabación · Para qué sirve (máx. 140) · Liga de referencia (opcional) · botón «Guardar clase» |
| Subir | «Subir video de la clase» · «Subiendo… 42 %» · «Cancelar» · «Listo: 1 h 02 min · 1.4 GB» · error: «No se pudo subir el video. Revisa tu conexión e inténtalo otra vez.» |
| Procesar (diálogo) | Título «Procesar la clase 5» · «Esto manda el audio de la clase a AssemblyAI y gasta dinero real:» · líneas del costo (las de `GET …/costo`) · «Total: $0.22 dólares» · si hay líneas sin precio: «Sin precio confirmado: preparar para buscar con Gemini. No está incluido arriba.» · «Verifica tu crédito en el dashboard de AssemblyAI.» · botón «Sí, procesar por $0.22 dólares» (foco inicial en «Cancelar») |
| Lote | «Procesar las 6 pendientes» → mismo diálogo con la suma y la lista |
| Al terminar | «Lista. Ya se puede buscar en ella, pero los alumnos no la ven hasta que actives «Visible en la Guía».» |
| Visible | Interruptor «Visible en la Guía»; apagado y con motivo «Primero hay que procesarla» mientras no esté lista |
| Revisar | «Ver video» · «Ver las primeras líneas del texto» (600 caracteres, pintados como texto) |
| Reindexar | «Preparar de nuevo para buscar» (con su costo) |
| Archivar | Confirmar con `peligro`: «¿Archivar la clase 5?» · «Deja de aparecer en la Guía. No se borra nada y se puede restaurar.» · foco inicial en «Cancelar» |
| Falló | «Falló: {motivo corto}.» · «Reintentar» (si va a reenviar a AssemblyAI, muestra el costo otra vez) |
| Palabras clave | Disclosure «Palabras clave para la transcripción (opcional, +$0.05 dólares por hora)»: una por línea |

**Estados (chip por clase):** Borrador · Subiendo · Subido · En cola · Transcribiendo · Preparando para buscar · Lista · Falló · Archivada; y aparte «Visible» / «Oculta». `useListaViva` sondea la lista mientras haya una clase trabajando, y `EsperaPasos` muestra los pasos **reales** (Sacando el audio → Transcribiendo → Troceando → Calculando embeddings → Listo) con el tiempo estimado `[POR MEDIR]` hasta tener la primera clase.

**Pruebas que cambian a propósito (registro anti-pérdida):** `[V]` `Admin.test.tsx:104` (`admin.vistas.tres_pestanas_con_aria`) afirma EXACTAMENTE `['1 · Ingresos','2 · Costos','3 · Flujo']`. Con una cuarta pestaña falla. Hay que renombrar el ID (por ejemplo `admin.vistas.las_pestanas_con_aria`) **en tres sitios a la vez**: el `it(...)`, `INVARIANTES["admin"]` en `tests/test_migracion_ui.py` y `docs/migracion/admin.md`. Además se actualiza la bajada «Tres vistas…» (`Admin.tsx:104`). Los tests nuevos de Clases se registran como `admin.clases.*` (solo admin, doble clic = un registro, cancelar no confirma, el texto del servidor se pinta como texto).

---

## 7. COSTOS

Todos los precios salen de `tools/pricing.json` (o de `tools/tarifas.json`). Lo que no está ahí dice «sin precio confirmado». `pricing.json` trae `verified_on` de 2026-08-03 para AssemblyAI (2.5 meses): conviene reverificarlo antes de prometer un número.

### 7.1 Tabla por paso

| # | Paso | ¿Gasta dinero real? | Precio y fuente | Cálculo de ejemplo | ¿Se prueba con doble? |
|---|---|---|---|---|---|
| 1 | Subir el video a S3 | Sí, almacenamiento | **Sin precio confirmado** (no hay precios de S3 en `pricing.json`) | n/a | Sí (S3 falso) |
| 2 | Medir duración (ffprobe en el API, 8 s) | Sí, cómputo | `pricing.json` → `aws_infra.lambda.usd_por_gb_segundo` = 0.0000166667 | 1.5 GB × 8 s = 12 GB·s → **$0.0002 dólares** | Sí |
| 3 | Sacar el audio (ffmpeg en el worker) | Sí, cómputo | misma clave | Tope por invocación: 2 GB × 900 s = 1 800 GB·s → $0.03 dólares; lo real `[POR MEDIR]` | Sí (ffmpeg y S3 falsos) |
| 4 | **Transcribir (AssemblyAI)** | **Sí, es el gasto grande** | `assemblyai.models.universal-3-5-pro.usd_per_hour` = **0.21** dólares por hora (facturación por segundo). Con palabras clave: `+ assemblyai.addons.keyterms_prompt.usd_per_hour` 0.05 = **0.26**. Respaldo `universal-2`: 0.15 | 1 h = $0.21; 20 h = **$4.20**; con palabras clave $5.20; con el respaldo $3.00 | **Sí**: `requests` falso; `tests/fixtures/assemblyai_sample.json` (sintético) |
| 5 | Esperar a AssemblyAI (consultas por SQS con retraso) | Sí, cómputo mínimo + SQS | Lambda como arriba; SQS **sin precio confirmado** | ~1 a 2 s × 2 GB por consulta ≈ $0.00006 dólares | Sí |
| 6 | Trocear | No | n/a | Python puro | Sí |
| 7 | **Embeddings de las clases** | Sí, muy poco | OpenAI: `rag.modelos.text-embedding-3-small.entrada` = 0.02 dólares por millón de tokens. **Gemini `gemini-embedding-001`: sin precio confirmado** (no existe en `pricing.json`) | Supuesto mío: ~13 500 tokens por hora (caracteres ÷ 4, como `tools/ingesta.py`). 20 h = 270 000 tokens → **$0.0054 dólares** con OpenAI (con encabezados y solape, del orden de $0.01) | **Sí**: cliente falso |
| 8 | Guardar canónico e índice en S3 | Sí, almacenamiento | **Sin precio confirmado** | n/a | Sí |
| 9 | Resúmenes sugeridos por IA (opcional, S7/S10) | Sí | `rag.modelos.gpt-5-mini`: entrada 0.25, salida 2.00 dólares por millón de tokens | Por clase de 1 h: 13 500 entrada + 300 salida → **$0.0040**; 20 clases = **$0.08 dólares** (tokens supuestos) | Sí |
| 10 | Consulta del alumno: **moderación** | Sí | `rag.modelos.gpt-5-mini` (la usa `moderar`, `settings.openai_model`) | `[V]` el prompt `prompts/moderar_system.md` pesa 1 098 bytes (~300 tokens). Supuesto: ~375 entrada + ~30 salida → **$0.00015 dólares** | Sí |
| 11 | Consulta: embedding de la pregunta | Sí, casi nada | OpenAI: 0.02 por millón; Gemini: sin precio confirmado | ~125 tokens → $0.0000025 dólares (OpenAI) | Sí |
| 12 | Consulta: cargar índice y buscar (cómputo del API) | Sí | `aws_infra.lambda.usd_por_gb_segundo` | 1.5 GB × 2 a 5 s = 3 a 7.5 GB·s → **$0.00005 a $0.00013 dólares**; lecturas de S3: sin precio confirmado | Sí |
| 13 | Consulta: Aurora (contador, lista de clases) | Sí, ya existente | `aws_infra.aurora.usd_por_acu_hora` = 0.12 | Marginal; no lo atribuyo | Sí (shim) |
| 14 | Plan redactado con IA (opcional, S8) | Sí | `gpt-5-mini` 0.25/2.00; `claude-sonnet-5-5` 2.00/10.00 dólares por millón (sin caché; `cache_leida` de Sonnet **falta** en `pricing.json`) | 6 000 entrada + 1 200 salida: gpt-5-mini **$0.0039**; sonnet **$0.024** dólares (tokens supuestos) | Sí (modelo falso) |
| 15 | Reproducir el video (transferencia desde S3) | Sí | **Sin precio confirmado** (ni transferencia ni, si aplica, la recuperación de Glacier IR) | n/a | n/a |
| 16 | Glosario: extracción con IA (S10) | Sí | `gpt-5-mini` / `claude-sonnet-5-5` como arriba | ver sección 10 | Sí |

### 7.2 Ejemplo: preparar N clases de 1 hora

Fórmula: `N × H × $0.21` de transcripción (más `N × H × $0.05` si activas palabras clave), más lo de los pasos 2, 3, 5 y 7.

Para **N = 20 clases de 1 hora** (H = 1):

| Concepto | Dólares |
|---|---|
| Transcripción (paso 4) | **4.20** |
| Si activas palabras clave | + 1.00 (total 5.20) |
| Embeddings con OpenAI (paso 7, supuesto mío) | ≈ 0.01 |
| Embeddings con Gemini | **sin precio confirmado** |
| Cómputo del worker (pasos 3 y 5) | tope duro $0.06 por clase (2 invocaciones de 15 min × 2 GB) = $1.20 en 20 clases; lo esperado es mucho menos `[POR MEDIR]` |
| Resúmenes con IA (opcional) | ≈ 0.08 |
| S3, SQS, transferencia | **sin precio confirmado** |
| **Total con precio confirmado** | **≈ $4.21 dólares** (+ lo que no tiene precio) |

**Primera clase de calibración (S5):** 10 minutos de audio = 10/60 × $0.21 = **$0.035 dólares**; una hora = **$0.21 dólares**. Verifica tu crédito en el dashboard de AssemblyAI (el free tier tiene datos en conflicto; no prometo nada).

### 7.3 Ejemplo: lo que cuesta usar la Guía

Por consulta ≈ moderación $0.00015 + embedding ≈ $0 + cómputo $0.00005 a $0.00013 ≈ **$0.0003 dólares** (supuestos míos, no medido). Fórmula mensual: `alumnos activos × consultas por día × 30 × $0.0003`. Con 100 alumnos activos × 5 consultas × 30 días = 15 000 consultas ≈ **$4.5 dólares al mes** (los 100 alumnos son un supuesto mío). Con IA en el plan (S8) sube a ≈ $0.004 a $0.024 dólares por consulta.

### 7.4 Qué gasta dinero real y qué se prueba con dobles

- **Siempre con dobles (cero dólares):** todo `pytest` y `vitest` y el e2e. AssemblyAI con `requests` falso, embeddings con cliente falso (como `tests/test_rag_*`), moderación con doble, S3 y Aurora con `monkeypatch`/shim (`conftest.py` ya bloquea la red real).
- **Dinero real, con «sí» del dueño y costo a la vista:** S5 (calibración, $0.035 a $0.21), S7 (lote, `N × H × $0.21`), S8 (IA en el plan, por consulta) y S10 (glosario con IA).
- **Dinero real muy pequeño, sin «sí» (acotado por topes):** la moderación y el embedding de cada consulta del alumno (del orden de $0.0003 dólares), limitada por el tope diario y el de intentos.
- La regla del repo se cumple en el servidor, no en la pantalla: `procesar` exige `confirmo:true` y `usd_visto` igual al costo recalculado. En un worker no hay prompt interactivo (`[V]` el CLI auto-confirma sin terminal, `tools/transcribe.py` `except EOFError: ok = "yes"`), así que el «sí» **tiene que vivir en la interfaz**, antes de encolar.

### 7.5 Dónde se registra el costo real

Hoy el costo de AssemblyAI se anota solo vía Langfuse (`tools/normalizers/asr_backend.py`), con el proveedor equivocado: `[V]` ejecuté `proveedor_de_modelo('universal-3-5-pro')` y `('universal-2')` y devuelven `'fal'` (`tools/costes.py:41-55`; `gpt-5-mini` devuelve `openai`). Según `transcripcion.md` la observación va además sin usuario ni proyecto. `[V]` En dev no se anota nada: sin claves de Langfuse `_langfuse()` devuelve `None` y `tools/ssm_env.py:87-98` marca los `LANGFUSE_*` como `SOLO_PROD`. Para clases: una fila directa en `costes` con `proveedor='assemblyai'`, `concepto='clases-transcribir'`, `proyecto_id=<id de clase>`, `traza='aai:<id>'`, `costo_usd = audio_duration real / 3600 × tarifa de pricing.json` (más `keyterms_prompt` solo si se mandó), con `WHERE NOT EXISTS` sobre `traza`. Se corrige `proveedor_de_modelo` para `universal-*` → `assemblyai` y se agrega `assemblyai` a la tupla de proveedores del tablero (`server/admin_api.py:127-129`, hoy lo manda a «otros»). Es el cálculo con tarifa de lista, no la factura: se concilia a fin de mes contra el panel de AssemblyAI. Para embeddings con Gemini no se escribe ningún dólar mientras no haya precio (`costo_usd` es NOT NULL); solo se guardan los tokens estimados.

---

## 8. Seguridad y privacidad

| Riesgo | Qué haremos | Cómo se prueba |
|---|---|---|
| **Inyección de instrucciones desde los transcripts** (alguien dijo «ignora lo anterior» en una clase, o una diapositiva con texto) | v1: ningún modelo lee transcripts al consultar; los fragmentos solo se muestran, como texto. En S8 y S10 (donde un modelo sí los lee): el modelo devuelve **solo identificadores** que estén en el conjunto recuperado y frases cortas validadas; títulos, minutos y enlaces los pone el servidor; el contexto va escapado y delimitado (según `rag.md`, hoy `armado.contexto()` no escapa nada, `pipeline/armado.py:90-99`: no copiar); falla cerrado a la versión determinista; sin herramientas ni acciones para el modelo; regex de secretos (`pipeline/validador.py`) sobre todo texto que se muestre | pytest con un transcript que contiene `</documentacion>` e «ignora lo anterior» |
| **Texto de la persona** (metas con datos personales) | Moderación **antes** de gastar, sin trazas (`sin_trazas=True`), falla cerrado. No va a la base, ni a Langfuse, ni a logs, ni al navegador; el log lleva solo números y la **clase** del error, nunca su mensaje. No usar `trazas_rag.corrida()`. El vector de la consulta no se guarda. Según `rag.md`, `enmascarar()` solo quita correos y teléfonos (`pipeline/trazas_rag.py`), así que no se confía en él | guardián de bundle y de logs (copia de `tests/test_coi_web_guardianes.py`), prueba de que ningún `log.*` recibe `texto` |
| **Privacidad (política publicada)** | `[V]` `static/privacidad.html:202-208` y su copia `server/sin_automatiza/privacidad.html`: Google aparece **solo como Gmail**. Si el buscador usa Gemini, hay que agregar «Google (Gemini): recibe el texto que escribes en la Guía de clases, y el texto de las clases, para buscar». La línea de OpenAI se amplía a «lo que escribes en la Guía de clases (para revisarlo y, si el buscador usa OpenAI, para buscar)». La frase «No guardamos lo que escribes» solo es cierta mientras Langfuse no reciba nada de esto. Lo que ofrezca Google según el nivel de la cuenta (gratis o de pago) **no lo afirmo**: se verifica con Google antes de publicar la frase | revisión manual; buscar el test que fija la lista de proveedores `[no verificado]` |
| **Derechos sobre los videos** | Decisión 4. Solo se reproduce lo que el dueño marca «Visible». Archivar quita de la Guía; la **purga real** (borrar `clases/<id>/` con sus versiones) es una CLI del dueño, no un botón, porque `[V]` el rol de la Lambda no puede borrar en S3 a propósito y el bucket está versionado | prueba de que `DELETE` no llama `delete_object` |
| **Quién sube** | Solo el grupo `admin`. `_exigir_admin` se pone en el **router** (no a mano por handler) y un test recorre `app.routes` y exige 403 en todo lo de `/api/admin/clases`. `[I]` Revocar admin tarda hasta el vencimiento del token (60 min). Sin rol más fino que `admin` (decisión técnica pendiente) | pytest que enumera rutas; sin token = 401 |
| **Archivos subidos** | Lista cerrada de extensiones **y** de `Content-Type`; la clave la hace el servidor (`clases/<id>/video.<ext>`, el nombre de la persona nunca entra a la clave); `HEAD` al confirmar; `ffprobe` valida que haya video. El tamaño no queda firmado en la URL: S3 corta a 5 GiB. Un PUT prefirmado se puede reutilizar mientras dure (15 min, `PRESIGN_S`; según `admin.md`). Sin «reemplazar video» en v1: se archiva y se crea otra clase | pytest de presign y confirmar |
| **ffmpeg leyendo un archivo hostil** | Un contenedor mal hecho (lista HLS o `concat`) puede hacer que ffmpeg pida otras URLs. Defensa en profundidad `[I]`, no probada: forzar el demuxer (`-f mov`) y limitar protocolos (`-protocol_whitelist`) al leer la URL firmada. Hay que probarlo con el primer video real | prueba manual en S5 |
| **SSRF en ligas** | Según `admin.md` (no lo reabrí), no existe ninguna guarda anti-SSRF en el repo y nuestra Lambda nunca hace `GET` a una URL arbitraria. v1: la liga solo se **guarda**; ningún código nuestro la baja. Validación del servidor: esquema `https`, sin credenciales, sin IP literal, sin `localhost`, host en una lista permitida que defina el dueño, 500 caracteres o menos; en pantalla solo se pinta como `<a rel="noopener noreferrer" target="_blank">` si empieza con `https:`. Si algún día un worker la descarga: resolver DNS y rechazar loopback, privadas y link-local (incluidos `169.254.169.254` y `169.254.170.2`), no seguir redirecciones sin revalidar, tope de bytes y de tiempo | pytest con `javascript:alert(1)`, `file:///etc/passwd`, `http://…`, `https://169.254.169.254/`, `https://localhost`, `https://[::1]/`, `https://user:pw@host`, 2 000 caracteres |
| **Barrer el catálogo con muchas consultas** | Tope diario de guías, tope de intentos que no cuentan (la búsqueda sin resultado cuenta como intento), una sola en curso, y todo exige sesión. Solo se ve lo `publicada` | pytest del contador (shim de Postgres) |
| **Enlace de video compartido** | La URL firmada es un enlace que sirve a quien lo tenga durante 2 h; no es DRM. Lo digo al dueño en la decisión 4 | n/a |
| **Costos ocultos** | Procesar nunca se dispara al subir ni al confirmar; exige `confirmo` + `usd_visto`. Subir y listar no llaman a ningún proveedor | pytest: `confirmar` no toca AssemblyAI |
| **CDN** | `clases/` no se sirve por CloudFront (`[V]` ejecutado). Test: `servible_por_cdn('clases/…')` es `False` y `url_media('clases/…')` con `CDN_BASE` devuelve la URL firmada | `tests/test_cdn_lista_blanca.py` ampliado |
| **Errores que filtran infraestructura** | El campo `error` se guarda sin ARNs ni URLs firmadas (`tachar_infra` de `server/editar_api.py`) | pytest |
| **XSS** | Todo lo que viene del servidor se pinta como texto (`<img src=x onerror=…>` en un título, como `admin.textos.del_server_se_pintan_como_texto`) | vitest |

---

## 9. Plan de entrega en rebanadas

Reglas de todas: un PR a `dev` por rebanada; `tools/db_migrate.py` en dev antes de desplegar cualquier rebanada que agregue tablas; los textos de la web escriben los precios en dólares (regla de redacción de `tools/pricing.json`); cada rebanada corre `npm run verificar`, vitest, pytest y `tests/test_migracion_ui.py`. Orden: lo que no gasta va primero.

### S1. Admin «Clases» sin gasto  **(puede empezar YA)**
- **Qué incluye:** tablas `clases` (y `clases_config`), `server/clases_admin_api.py` con crear, listar, editar, subida (presign propio, `clases/<id>/video.<ext>`), confirmar, medir, cancelar, vista previa de video, archivar y restaurar (**sin** procesar); pestaña «4 · Clases» con formulario, subida con progreso y cancelar (se reutilizan `subirConProgreso`, `mb` y el aviso `beforeunload`; **no** `/api/media/presign`, que reserva nombres de proyecto del editor y metería la clase en «Mis creaciones»); límites que vienen del servidor.
- **PR:** «Clases: admin para subir y listar videos (sin gasto)».
- **Pruebas:** `tests/test_clases_admin.py` (autorización por router y enumeración de rutas, presign sin nombre del usuario en la clave, rechazo de `.exe` y `text/html`, `bytes=0` y más de 5 GiB, confirmar con HEAD fallido, idempotencia por `clave`, `DELETE` archiva y el doble de S3 revienta si alguien llama `delete_object`, ligas hostiles, esquema válido para `db_migrate`); ampliar `tests/test_cdn_lista_blanca.py`; `Clases.test.tsx` (4.ª pestaña sin `fetch` hasta abrirla, doble clic = un presign, cancelar no confirma, texto del servidor como texto, un solo ámbar, precios en dólares); renombrar el invariante de las pestañas en sus tres sitios.
- **Prueba manual del dueño en dev:** crear una clase de ejemplo, subir un `.mp4` pequeño (y uno grande si tienes), verlo con «Ver video», comprobar que `https://<cdn>/clases/<id>/video.mp4` da 403, archivar y restaurar.
- **Gasto:** solo almacenamiento de S3 (sin precio confirmado). Cero llamadas de pago.

### S2. Núcleo de búsqueda con vectores falsos  **(puede empezar YA, en paralelo con S1; aclarar D1 primero)**
- **Qué incluye:** `pipeline/clases_indice.py` (troceo por tiempo, formato `vectores.f32` + `trozos.json`, escritura/lectura, búsqueda matricial, agrupación por clase, cobertura, plan determinista, `mejor`), `media_sync.leer_bytes/escribir_bytes`, `embeddings.embeber(proveedor=, clave=)`, y `tools/eval_guia.py` en modo ensayo.
- **PR:** «Guía: núcleo de búsqueda (troceo, índice y plan) con dobles».
- **Pruebas:** troceo con un canónico sintético (`tests/fixtures/assemblyai_sample.json` es sintético; se agregan más) que respete mínimo 400, tope 6 000, solape y tiempos exactos; vectores de juguete con clases conocidas (la clase pertinente gana; un video con 40 trozos no desplaza a los demás; el plan sale ordenado por `numero`; máximo 7 pasos; `ninguna` bajo el umbral); `.f32` con `allow_pickle` inexistente; versión nueva del índice no pisa la vieja.
- **Prueba manual del dueño:** ninguna (sin pantalla). Revisa un ejemplo impreso del plan y del `mejor` sobre datos de juguete.
- **Gasto:** cero.

### S3. Guía del alumno con datos de prueba (tarjeta aún apagada)  **(puede empezar YA; necesita S2)**
- **Qué incluye:** `guia_estado` y la generalización de las cuatro funciones de COI con `servicio`; `server/guia_api.py` (`GET /estado`, `POST /api/guia`, `GET /clases/{id}/video`) con moderación sin trazas, candado, topes y plazos; pantalla `/estudio/guia/` completa (pestañas, estados, reproductor), registro en `server/migracion.py` (`"guia": Pantalla(vieja="/guia.html", nueva="/estudio/guia/", etapa="retirada")`), `web/estudio/guia/index.html` (con `/auth.js` antes del módulo), `docs/migracion/guia.md`, `tests/test_guia_web_guardianes.py`; mover a `nucleo/` lo genérico del contador (`contadorTexto`, `faltanTexto`, `puntitos`, `largo`, `useEstadoUso(cargar)`) con re-exportaciones en `coi/` para que las pruebas de COI no se muevan; `tools/guia_semilla.py` (solo dev; crea 3 a 5 clases **marcadas «DEMO» con texto escrito por nosotros**, calcula sus embeddings reales y se niega a correr en prod; `--quitar` las borra).
- **La tarjeta sigue apagada** (`GUIA_ACTIVA=0`, la fila de `menu.ts` no se toca todavía). El dueño entra por la URL directa.
- **PR:** «Guía: pantalla y API del alumno (apagadas)».
- **Pruebas:** pytest del contrato (orden validar → estado → 429 → clases visibles → candado → moderar → embeber → buscar → sumar solo con resultado → soltar; texto jamás en logs; `sin_clases` antes de moderar, así no se gasta nada si no hay clases); `test_coi_postgres.py` generalizado con el shim; vitest de la pantalla (los IDs `guia.*` de `menu.md` §1.4 sirven de esqueleto); e2e a 1100/390/320 px con `page.route`, axe, foco nunca en `body`, un solo ámbar, reducir movimiento; las pruebas de COI siguen verdes sin cambiar.
- **Prueba manual del dueño en dev:** con la semilla, escribir 3 metas distintas y ver plan y «Solo el video»; probar una meta fuera de tema («receta de cocina») y ver «No encontramos una clase para esto»; probar el tope; probar a 390 px en el teléfono.
- **Gasto:** moderación y embedding reales en las pruebas manuales (≈ $0.0003 dólares por consulta, con OpenAI; con Gemini el embedding es «sin precio confirmado»). El semillado de 5 clases cortas: del orden de unos miles de tokens (≈ $0.0001 dólares con OpenAI). Sin AssemblyAI.

### S4. Procesar clases: cola, worker, costo y «sí»  **(puede empezar YA con dobles; necesita S1 y S2)**
- **Qué incluye:** `pipeline/transcripcion.py` (id persistido al crear, espera por consultas, reintentos, perfil de clases), `worker/clases.py` y `worker/clases_procesar.py` (máquina de estados de 3.1, espera por re-encolado con retraso de 30 s las primeras 5 veces y 60 s después, tope total de 2 h), tabla `clases_trabajos`, `GET …/costo`, `POST …/procesar`, `GET …/trabajo`, `…/texto`, `…/publicar`, `…/palabras-clave`, el diálogo «Procesar» con el costo, `EsperaPasos` con pasos reales, registro del costo real en `costes`, corrección de `proveedor_de_modelo`, CDK (cola, DLQ, worker con permisos mínimos, env del API y de `Entorno`) y el test de CDK de 4.4.
- **PR:** dos, para poder revertir: «Clases: procesar (código, con dobles)» y «Clases: cola y worker en CDK».
- **Pruebas:** el sondeo de AssemblyAI con `requests` falso (hoy `_llamar` no tiene pruebas): éxito, `error`, red intermitente, **reentrega con id ya guardado = ninguna transcripción nueva**, tope de 2 h; reclamo atómico y reclamo vencido; el costo registrado una vez; `procesar` con `usd_visto` distinto = 409; `confirmar` y `subir` jamás llaman a AssemblyAI; `tests/test_entornos.py` nuevo para el worker de clases (S3 solo `clases/*`, sin `s3vectors`).
- **Prueba manual del dueño en dev:** desplegar y ver que el diálogo «Procesar» muestra un costo (sin pulsar el «sí»).
- **Gasto:** cero hasta que el dueño pulse «Sí, procesar».

### S5. Primera clase real de calibración  **(necesita un video; gasta; lleva «sí» con costo)**
- **Qué incluye:** procesar UNA clase real (idealmente de 10 minutos: **$0.035 dólares**; una de 1 hora: **$0.21 dólares**), comparando la calidad de la transcripción con jerga de IA (decidir si hacen falta palabras clave, +$0.05 por hora), medir los `[POR MEDIR]`: tiempo de AssemblyAI por hora, tiempo de ffmpeg sobre la URL firmada, latencia de cargar el índice y de la consulta completa, `moov` al final (arranque lento del video), desfase de audio en grabaciones de Zoom/QuickTime y `-protocol_whitelist`; con 20 a 30 metas reales que escriba el dueño y la clase esperada para cada una, correr `tools/eval_guia.py` y fijar `UMBRAL`, `UMBRAL_ALTA`, `MARGEN`; ajustar el tope de duración y los plazos con datos.
- **PR:** «Guía: umbrales y plazos calibrados con la primera clase» (solo constantes y `docs/OPERACION.md`).
- **Prueba manual del dueño:** el «sí» con el costo a la vista; leer las primeras líneas del texto; reproducir el video en un minuto cualquiera.
- **Gasto real:** $0.035 a $0.21 dólares de AssemblyAI + una fracción de dólar de cómputo `[POR MEDIR]` (S3 y SQS: sin precio confirmado).
- **Se salta si el dueño prefiere calibrar con el lote (S7), a costa de calibrar con más clases y no con una.**

### S6. Encender en dev
- **Qué incluye:** `GUIA_ACTIVA=1` en `Entorno` de dev; la fila de `menu.ts` (quitar `proximamente`, `href: '/estudio/guia/'`, `texto`, y renombrar clave y título si se aprobó D7); las pruebas que dan por apagada la fila: `tests/test_coi_web_guardianes.py:283-297` (y sus frases exactas en `inicio.md` y `DISENO.md`), `Pantallas.test.tsx`, `Recorrido.test.tsx`, `Inicio.test.tsx` (`inicio.menu.entradas_y_grupos_en_orden`), `estadoRecorrido.test.ts`, `Mapa.test.tsx`, `web/e2e/inicio-recorrido.spec.ts`; los documentos `docs/DISENO.md`, `docs/QA-UI.md`, `docs/migracion/inicio.md`, `docs/OPERACION.md` (sección de la Guía); **la privacidad**: agregar Google (Gemini) si aplica y ampliar la línea de OpenAI, en las dos copias de `privacidad.html`.
- **PR:** «Guía de clases: encender en dev».
- **Prueba manual del dueño en dev:** recorrer `docs/QA-UI.md` (sección nueva de la Guía, a 390 y 1100 px), comprobar que Glosario sigue «Próximamente», que la tarjeta aparece y navega, y que una clase **no** marcada «Visible» no sale en ninguna guía.
- **Gasto:** el de las consultas de prueba (≈ $0.0003 dólares cada una).

### S7. Procesar todas las clases (lote)  **(gasta; lleva «sí» con costo)**
- **Qué incluye:** el lote «Procesar las N pendientes» con la suma y la lista a la vista; activar «Visible» clase por clase tras revisar; recalibrar umbrales con el catálogo completo; decidir lo del ciclo de vida de Glacier para `clases/` (4.4).
- **Prueba manual del dueño:** el «sí» del total; revisar cada clase; correr de nuevo las 20 a 30 metas.
- **Gasto real:** `N × H × $0.21 dólares` (20 clases de 1 h: **$4.20**; con palabras clave $5.20) + embeddings (≈ $0.01 con OpenAI; Gemini sin precio confirmado).

### S8. Plan redactado con IA (opcional)  **(gasta por consulta; decisión del dueño)**
- **Qué incluye:** una llamada a un modelo con precio en `pricing.json` (`gpt-5-mini` o `claude-sonnet-5-5`) que, dado el texto ya moderado y los candidatos (id, título, resumen, fragmento escapado), devuelve **solo** `{"por_que": {"<clase_id>": "frase de 140 caracteres o menos"}}`; validación estricta (ids ⊆ candidatos, largo, sin URLs ni secretos); plazo 10 s y solo si quedan ≥ 10 s del presupuesto; si falla o tarda, se devuelve el plan determinista (la pantalla ya soporta `por_que: null`); sin trazas. La IA **no** decide el orden ni los minutos.
- **Pruebas:** con modelo falso, incluyendo un transcript con «ignora lo anterior» y `</documentacion>`.
- **Gasto real:** por consulta ≈ $0.0039 dólares (gpt-5-mini) o $0.024 dólares (claude-sonnet-5-5), con tokens supuestos; revisar el tope diario.

### S9. Producción
- **Qué incluye:** `tools/db_migrate.py` en prod **antes** del deploy; CDK en prod (cola, worker, env); `ASSEMBLYAI_API_KEY` y la clave de embeddings en el `/env` de prod; privacidad ya publicada; encender `guia_activa` en el `Entorno` de prod. Con el índice como archivos **no** hace falta crear bucket ni índice vectorial en prod (con S3 Vectors sí: `PROD.vectores_bucket` es `None`).
- **Prueba manual del dueño en prod:** una clase de prueba oculta, una consulta, y apagarla.

### S10. Glosario IA (CEN·4)
Ver sección 10 (G1 a G3).

**Dependencias:** S1 ‖ S2 → S3 y S4 → S5 → S6 → S7 → S9; S8 y S10 después de S7.

---

## 10. Glosario IA: cómo se deriva de los transcripts con lo mismo

Reglas de partida: lo que publica es **del dueño**; la IA solo propone. Mismo almacén (los canónicos de `clases/<id>/`), mismos topes y mismas reglas de privacidad.

### 10.1 Cómo se saca

1. **G1. Candidatos (por clase, en el worker).** Un modelo con precio en `pricing.json` lee el transcript en tramos de ~20 minutos (≈ 4 500 tokens; el límite de contexto de cada modelo no está en el repo, `[no verificado]`, por eso se parte) y devuelve JSON: `[{"termino", "termino_en"?, "definicion" (una frase, 160 caracteres o menos), "cita" (la frase textual del transcript donde se define)}]`. Nada más.
2. **Minuto determinista.** El servidor **no cree** el minuto que diga el modelo: busca el `termino` (normalizado, sin acentos ni mayúsculas) en la secuencia de `words[]` del canónico y toma el `start` de la primera aparición donde además aparece la `cita`; si no la encuentra, el candidato se descarta. Así el «Se explica en: Clase N · mm:ss» siempre es real.
3. **Fusión.** Mismo término en varias clases = un solo término con varias citas (normalizado por texto; el dueño puede fusionar o separar a mano). La cita principal es la que **define**, no la que solo menciona.
4. **Revisión.** El dueño aprueba, edita o descarta en una sub-vista «Glosario» de la pestaña «4 · Clases». Solo los aprobados salen al alumno.
5. **Opcional:** la lista aprobada se ofrece como `keyterms_prompt` para las clases futuras (+$0.05 dólares por hora), para que la transcripción de «embeddings» o «RAG» salga bien.

### 10.2 Datos
- `glosario_terminos`: `id`, `termino`, `termino_en`, `definicion`, `estado` (`propuesto`, `aprobado`, `descartado`), `creado`, `aprobado_por`, `aprobado_en`.
- `glosario_citas`: `termino_id`, `clase_id`, `inicio_s`, `es_definicion` (boolean).

### 10.3 Pantalla `/estudio/glosario/` (la tarjeta CEN·4)
Buscador, índice A a Z (botones de 44 px), cada término con su definición y «Se explica en: Clase 3 · 11:05 (y 2 clases más)» que abre el mismo reproductor de la Guía en pestaña nueva (`GET /api/guia/clases/{id}/video`). En inglés se escribe «en español (en inglés)» porque las clases mezclan idiomas. En celular, cada término es plegable. Sin cobro ni tope: es consulta de datos ya aprobados. Desde la Guía se puede mostrar «Términos de este paso» más adelante.

### 10.4 Costo (solo con precios de `pricing.json`)
Fórmula: `tokens de entrada × entrada + tokens de salida × salida` por millón. Ejemplo con **supuestos míos**: 20 horas ≈ 270 000 tokens de entrada y ≈ 30 000 de salida (1 500 por clase):
- `gpt-5-mini` (0.25 / 2.00): 270 000 × 0.25 / 1 000 000 + 30 000 × 2.00 / 1 000 000 = $0.0675 + $0.06 = **≈ $0.13 dólares**.
- `claude-sonnet-5-5` (2.00 / 10.00): $0.54 + $0.30 = **≈ $0.84 dólares**.
No incluye reintentos. El embedding para fusionar términos similares, si se usara, tiene el mismo precio por millón de tokens de la sección 7 (OpenAI) o ninguno confirmado (Gemini).

### 10.5 Rebanadas
- **G1.** Extracción y revisión en el admin (gasta con «sí» y costo a la vista; depende de S7).
- **G2.** Pantalla del alumno `/estudio/glosario/` y encender la tarjeta CEN·4 (otro conjunto de pruebas que dan por apagada la fila: ver S6).
- **G3.** (Opcional) enlazar términos desde los pasos de la Guía y alimentar `keyterms_prompt`.

---

## 11. Riesgos y lo que NO pude verificar

### 11.1 Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Gemini no está disponible o sin precio (D3) | Bloquea una versión «Gemini desde el día uno» | Interruptor `GUIA_EMBEDDINGS`; arrancar con OpenAI; re-embeber es barato porque el transcript queda guardado |
| La transcripción con jerga de IA en inglés sale mal | Minutos y fragmentos con errores; búsqueda peor | Perfil de code-switching + palabras clave opcionales; S5 lo mide; el aviso en pantalla |
| Umbrales mal calibrados | Falsos «sí encontramos» o falsos «no encontramos» | `tools/eval_guia.py`; no se enciende (`GUIA_ACTIVA`) sin S5; recalibrar en S7 |
| Aurora dormida en dev (~25 s) | Primera petición lenta o 504 | El `GET /estado` al abrir la despierta; la pantalla lo explica |
| Cargar índices en frío tarda | Primera consulta lenta | Caché por versión + precarga en `/estado`; si pasa de 2 s medidos, migrar a S3 Vectors |
| Un video de 2 h no cabe en 15 min de worker (ffmpeg sobre URL + subida del WAV) | Clase en `error` | Presupuesto interno (ffmpeg 420 s, subida 300 s); tope de 2 h en v1; S5 lo mide |
| Pagar dos veces a AssemblyAI | Dinero | Puntos de control de 3.4; ventana residual documentada |
| `GET /api/admin/resumen` caído = sin pestaña «Clases» | No se gestionan clases | Aceptado en v1; mover el gating sería reescribir 3 invariantes |
| Glacier IR a los 10 días encarece releer videos e índices | Costo (sin precio confirmado) | Decidir antes de S7; PR aparte de CDK |
| Prompt-injection en S8/S10 | Recomendaciones manipuladas | Sección 8; la IA devuelve solo ids y frases validadas |
| Contenido con derechos de terceros | Legal | Decisión 4 |
| Otra persona está trabajando en COI en paralelo (el árbol de otro informe mostró archivos modificados que no eran suyos) | Choques al generalizar `coi_*` | S3 generaliza con un parámetro por omisión, sin cambiar firmas, y en PR pequeño |

### 11.2 Lo que NO pude verificar

- **Quién o qué es Jev.** No está en el repo.
- **Qué son las ligas** ni cuántas clases, horas y GB hay.
- **Si la cuenta de Google ya acepta la tarjeta** ni si existe `GEMINI_API_KEY` o `GEMINI_API_KEY_GUIA` en SSM. Tampoco si `ASSEMBLYAI_API_KEY` está cargada en el SSM de **dev**.
- **Que existan hoy** el bucket `media-ivenaccip-vectores-dev` y los índices de n8n (irrelevante si se usan archivos).
- **Precios:** `gemini-embedding-001`; consultas de S3 Vectors; S3 (almacenamiento, peticiones, transferencia, recuperación de Glacier IR); SQS; CloudFront; `cache_leida` de Opus y Sonnet. Sin precio confirmado.
- **Cualquier medición de tiempo:** cuánto tarda AssemblyAI por hora de audio; ffmpeg sobre una URL firmada; cargar un índice de S3; la consulta completa. No hay ninguna en el repo y no gasté.
- **Si el API de AssemblyAI acepta `prompt` y `keyterms_prompt` juntos con Universal-3.5 Pro** (el CLI los manda juntos, `tools/transcribe.py:207-211`, pero no lo probé), si un transcript que termina en error se factura, y sus límites de duración, tamaño y concurrencia.
- **Subida de varias partes (multipart)** de punta a punta, y que firmar `ContentLength` lo haga obligatorio.
- **`#t=` en Safari/iOS** con URLs firmadas largas; desfase audio/video; `moov` al final.
- **Que Radix desmonte las pestañas inactivas** (comportamiento estándar, no lo probé).
- **El efecto de revocar admin** (hasta 60 min).
- **Las suites de pruebas:** no corrí `pytest`, `vitest` ni Playwright sobre el diseño (no hay código). Los números de línea citados vienen de leer el HEAD; los marcados «según el informe X» no los reabrí.
- **Mi propia estimación de tokens** (13 500 por hora, 375 + 30 de moderación) es un supuesto, no una medición.
- **Qué ofrece Google al texto enviado** según el nivel de la cuenta: se verifica con Google, no se afirma aquí.

---

## Anexo A. Lo que verifiqué yo mismo (y cómo resolví las contradicciones)

Verificadas abriendo el código o ejecutándolo (todas coinciden con los informes salvo donde se indica):

| # | Afirmación | Evidencia | Resultado |
|---|---|---|---|
| 1 | Dev embebe con OpenAI, no con Gemini | `infra/entornos.py:166-167`, comentarios `:160-165`; `pipeline/vectores.py` encabezado | Confirmado. **Contradice la premisa del pedido** («ya hay Gemini»): el código existe, pero no corre en dev |
| 2 | No hay precio de Gemini ni de consultas de S3 Vectors; AssemblyAI = 0.21 / 0.26 / 0.15; `rag.pendiente` lo dice | `tools/pricing.json:5-17` y `:284-295` (sección `rag`); ejecuté la lectura del JSON | Confirmado. `aws_infra` solo trae Fargate, Lambda y Aurora (nada de S3/SQS/CloudFront) |
| 3 | Dos guardianes impiden que el API toque S3 Vectors | `tests/test_entornos.py:668` y `:703`; regla en `pipeline/vectores.py:24` | Confirmado. Por eso elegí archivos en S3 |
| 4 | `clases/` nace cerrado al CDN | `pipeline/media_rutas.py:38-52`; ejecuté `servible_por_cdn`: `False` para `clases/…`, `True` para `work/…` | Confirmado |
| 5 | El sondeo de AssemblyAI es `while True` sin tope y el id es local; la ruta web fija `es` y no manda prompt ni keyterms; el CLI sí | `tools/normalizers/asr_backend.py:148-152`; `tools/transcribe.py:42-47,207-211` | Confirmado |
| 6 | COI resuelve los 29 s con plazos por etapa; la moderación es una llamada a modelo sin trazas; la Lambda corta a 29 s | `pipeline/coi.py:20-35`; `server/coi_api.py:292-345`; `pipeline/moderacion.py`; `pipeline/llm.py:175-187`; `infra/stacks/api.py:66-67` | Confirmado. De aquí sale el costo de moderación |
| 7 | El admin tiene tres pestañas fijadas por una prueba; `_exigir_admin` se llama a mano | `web/src/pantallas/admin/Admin.tsx:144-153`; `Admin.test.tsx:104-114`; `server/admin_api.py:40-45` | Confirmado |
| 8 | La privacidad nombra a Google solo como Gmail | `static/privacidad.html:202` (OpenAI `:203`, AssemblyAI `:206`, Langfuse `:208`) | Confirmado |
| 9 | `numpy` está fijado; el API lee todo el bucket; el rol no borra | `requirements.txt:21`; `infra/stacks/api.py:104-106` | Confirmado |
| 10 | «Jev» no existe en el repo | búsqueda de palabra completa en todo el árbol (sin `node_modules`, `venv`, `.git`, `package-lock.json`): 0 | Confirmado |
| 11 | El worker de pago es de 15 min, 2 concurrentes, DLQ tras 2 recepciones; 90 min es tope de producto | `infra/stacks/jobs.py:83-94,108`; `server/shorts_api.py:38` | Confirmado |
| 12 | `media_sync` no tiene helpers de bytes | `pipeline/media_sync.py` (lista de funciones) | Confirmado; hay que agregarlos |

Contradicciones entre informes y cómo las resolví:
- **Pestañas con una consulta (`producto.md`) vs. elegir el modo antes (`menu.md` §3, que lo marcaba «decisión pendiente»).** Decidí **una consulta, dos pestañas**: es lo que pidió el dueño («ve DOS opciones»), cuesta lo mismo y cambiar de vista es gratis.
- **Índice en S3 Vectors aparte (`rag.md` §2, opción A) vs. archivos.** Decidí archivos (4.3) por tamaño del problema, guardianes y precio; `rag.md` solo comparó dos usos de S3 Vectors. Es reversible.
- **Petición síncrona (`producto.md`, `rag.md`) vs. worker (`transcripcion.md`).** Ambos son correctos para partes distintas: la consulta del alumno es síncrona (cabe en 27 s sin IA); procesar una clase es de worker.
- **Esperar a AssemblyAI durmiendo hasta 12 min y re-encolar (`transcripcion.md` §6.2.3) vs. consultas separadas por SQS con retraso.** Decidí la segunda: no paga cómputo por dormir y no choca con el límite de 15 min.
- **Tope de 3 al día (`producto.md`) vs. 5.** Con consulta sin IA cuesta del orden de $0.0003; 3 se justifica cuando cada respuesta es una generación de modelo (COI).
- **La consulta en el worker público (`rag.md` §4) vs. en el API.** En el API: es para usuarios con sesión, el worker público es solo la tubería anónima de `/automatiza`, y el API ya tiene el contador, la moderación y los plazos.
