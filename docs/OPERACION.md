# OPERACION.md — runbook del dueño

Ligas y comandos de operación diaria del producto. Todos los comandos se corren
**desde la raíz del repo** (`D:\aws-project`). En Git Bash / PowerShell funciona
`venv/Scripts/python`; en cmd usa `venv\Scripts\python`. Los que hablan con
Aurora necesitan los ARNs (sección «Base de datos»).

## Ligas

| Qué | Liga |
|---|---|
| **Producto (API + web)** | https://irremplazables.xyz — el endpoint viejo sigue vivo: https://2ecset5i94.execute-api.us-east-1.amazonaws.com |
| **Dashboard admin** | https://irremplazables.xyz/admin.html (la nueva, en prueba: `/estudio/admin/`) |
| **Login (Hosted UI Cognito)** | https://media-ivenaccip.auth.us-east-1.amazoncognito.com — la misma pantalla cubre el cambio de contraseña del primer login; el branding se retoca en el editor visual de la consola Cognito (vive FUERA de CloudFormation) |
| **CDN de media** | https://d8bfm82hs0s6a.cloudfront.net |
| **Langfuse (trazas y prompts)** | https://us.cloud.langfuse.com |
| **Stripe** | https://dashboard.stripe.com — webhooks test y live se configuran POR SEPARADO |
| **Repo** | https://github.com/Ivenaccip/aws-media |
| **AWS** | cuenta `191241816158`, us-east-1 — Budget $50/mes con avisos $10/$25/$50 |

Identificadores fijos: Cognito pool `us-east-1_WyPvxnj1V`, client
`2kf9frusv9ae4fndns5f5nt9h9`; bucket `aws-media-media-mediaa721a567-bat5i0pvqczo`;
ECR `191241816158.dkr.ecr.us-east-1.amazonaws.com/aws-media`; API HTTP
`2ecset5i94`; dominio personalizado apuntando a
`d-hyornda8q1.execute-api.us-east-1.amazonaws.com`; certificado ACM
`arn:aws:acm:us-east-1:191241816158:certificate/2a234253-9f81-4338-b93a-20a2a935457d`
(vence el 2027-04-08).

## Usuarios (`tools/usuarios.py`)

No hay auto-registro: las altas son por CLI (Cognito manda el correo de
invitación en español con contraseña provisional).

```bash
venv/Scripts/python tools/usuarios.py alta correo@ejemplo.com --plan anual
```

```bash
venv/Scripts/python tools/usuarios.py alta correo@ejemplo.com --reenviar
```

```bash
venv/Scripts/python tools/usuarios.py lista
```

```bash
venv/Scripts/python tools/usuarios.py suspender correo@ejemplo.com
```

```bash
venv/Scripts/python tools/usuarios.py reactivar correo@ejemplo.com
```

- `alta` crea el usuario en Cognito + su fila con la cortesía del plan
  (mensual 100 cr / anual 200 cr, de `tools/tarifas.json`; anual = slots
  ilimitados, el resto 6 proyectos activos).
- `admin correo` lo mete al grupo admin de Cognito (necesita **re-login**
  para que el token traiga el grupo y abra `/admin.html`).
- `slots correo N|ilimitado` cambia su tope de proyectos activos.
- `adoptar correo --de piloto` migra proyectos/saldo/movimientos de un id
  viejo al usuario real (se usó una vez para el dueño; raro necesitarlo).

## El remitente de los correos (`hola@irremplazables.xyz`)

Todos los correos del pool —invitación, reenvío, recuperar contraseña— salen
firmados por `hola@irremplazables.xyz` y no por `no-reply@verificationemail.com`.
El envío sigue siendo el **integrado de Cognito** (`COGNITO_DEFAULT`), no el SES
de la cuenta, así que:

- **El tope sigue siendo 50 correos al día, y es de la CUENTA**, no del pool:
  lo comparten prod y dev, y se reinicia a las 09:00 UTC (03:00 hora centro).
  Una invitación de prueba en dev le quita un correo a la tanda de ese día.
- No depende de que SES salga del sandbox. El día que salga, pasar a
  `UserPoolEmail.with_ses(...)` es otro cambio, con su PR; hasta entonces
  `DEVELOPER` dejaría sin invitación a todo el mundo (solo entrega a
  direcciones verificadas) y `tests/test_entornos.py` lo impide.

Son tres piezas, y solo una vive en el CDK:

Orden: la 2 y la 3 van ANTES de desplegar la 1. Al revés, el update del pool
falla (`InvalidEmailRoleAccessPolicyException`) y CloudFormation lo deshace.
Las dos quedaron hechas el 7-oct-2026; los comandos están por si hay que
repetirlas, y se corren desde la raíz del repo (`file://` es relativo a donde
estés, no a `infra\`).

1. `remitente_correo` en `infra/entornos.py` → `EmailConfiguration` del pool
   (`infra/stacks/api.py`). Con el correo integrado, Cognito pide el ARN de
   la **dirección** y rechaza el campo `From`; el remitente es esa dirección.
2. **La dirección verificada en SES por separado.** No basta con tener
   verificado el dominio: SES no admite envío delegado (que es lo que hace
   Cognito aquí) con una dirección que solo hereda la verificación. Se crea
   una vez y se confirma con la liga que AWS manda a ese buzón:

```bash
aws sesv2 create-email-identity --region us-east-1 --email-identity hola@irremplazables.xyz
```

3. **La política de envío de esa dirección**, en
   `infra/ses-politica-remitente.json`. Autoriza a los pools de esta cuenta a
   firmar como ella. La pone el dueño, una vez:

```bash
aws sesv2 create-email-identity-policy --region us-east-1 --email-identity hola@irremplazables.xyz --policy-name cognito-remitente --policy file://infra/ses-politica-remitente.json
```

Para cambiarla, el mismo comando con `update-email-identity-policy`. Para ver
cómo está la identidad (verificación, política y DKIM):

```bash
aws sesv2 get-email-identity --region us-east-1 --email-identity hola@irremplazables.xyz
```

Después de cada deploy que toque el pool (prod `us-east-1_WyPvxnj1V`, dev
`us-east-1_XChDzHHjw`):

```bash
aws cognito-idp describe-user-pool --region us-east-1 --user-pool-id us-east-1_WyPvxnj1V --query UserPool.EmailConfiguration
```

Tiene que traer `EmailSendingAccount: COGNITO_DEFAULT` y el `SourceArn` de la
dirección. Y la prueba que cuenta es un correo real: una invitación o un
«¿Olvidaste tu contraseña?» que llegue de `hola@irremplazables.xyz`.

El buzón `hola@irremplazables.xyz` tiene que existir de verdad (hoy es una
regla de Cloudflare Email Routing): ahí llegan las respuestas de los
invitados y la liga de verificación si algún día hay que repetirla.

### Lo que NO se toca mientras el pool firme con la dirección

Ninguna de estas cosas hace fallar un deploy en el momento: se nota cuando el
correo deja de llegar.

**Dejan al pool sin poder mandar**, y hacen fallar el siguiente deploy que
toque el pool (al actualizarlo, Cognito vuelve a comprobar el permiso; sin la
política contesta `InvalidEmailRoleAccessPolicyException`, medido el 7-oct):

- Borrar la identidad `hola@irremplazables.xyz` o su política
  `cognito-remitente` en SES. Quitar la política **no** devuelve el remitente
  de fábrica: el pool sigue apuntando a la identidad.
- Ponerle a esa identidad un *configuration set* por defecto: según la guía de
  SES no hay envío delegado sobre una identidad que lo tenga (no medido aquí).

**No cortan el envío, pero el correo sale sin la firma del dominio** y lo más
probable es que caiga en spam:

- Apagarle la firma DKIM a la dirección (hoy hereda la del dominio).
- Borrar la identidad del dominio `irremplazables.xyz`, o en Cloudflare los
  tres CNAME de `_domainkey`.

**Y no se cambia el correo del pool desde la consola ni con `aws cognito-idp
update-user-pool`:** ese comando devuelve a su valor de fábrica todo lo que no
se le pase (la plantilla de invitación, la protección de borrado y
`AllowAdminCreateUserOnly`, o sea, abre el auto-registro).

### Volver al remitente de fábrica

Primero el pool, y la política se queda puesta (sola no hace nada). El
remitente NO viaja en la imagen: sale de `infra/entornos.py` del árbol desde
el que despliegas, así que fijar un `IMAGE_TAG` viejo no lo quita.

1. `remitente_correo=None` en el entorno (`PROD`, `DEV` o los dos) de
   `infra/entornos.py`.
2. En `tests/test_entornos.py`, el cambio «a sabiendas» que pide su mensaje:
   `test_el_pool_de_prod_firma_…` fija el remitente de prod y falla. El CI lo
   corre antes del build: sin tocarlo, ese commit no publica imagen.
3. Desplegar el stack del API de ese entorno con la imagen que ya corre.

Para producción con prisa, sin esperar un PR: desplegar el ÁRBOL del commit de
`main` anterior al cambio (`git checkout --detach` con su sha), no solo su
imagen, con el `IMAGE_TAG` de la imagen que corre en ese momento. La receta
de «Desplegar UN commit concreto» sola contesta `(no changes)` y el pool no
se mueve. Después se vuelve a `main` y se hace el PR con calma.

Se comprueba con el `describe-user-pool` de arriba: tiene que quedar solo
`EmailSendingAccount: COGNITO_DEFAULT`, sin `SourceArn`. Esta vuelta atrás se
ensaya en dev antes de confiar en ella para prod.

## Créditos (`tools/creditos.py`)

`--user` acepta el **correo**: el tool lo resuelve al sub de Cognito (el
user_id real de la base) antes de tocar el monedero, y truena con aviso si el
correo no existe en el pool. También acepta el sub directo (el id que imprime
`usuarios.py lista`).

**Para resolver un correo hace falta `COGNITO_POOL_ID`** (o `--pool`). Lo pone
`.env.local`, que genera `tools/env_local.py`:

```bash
venv/Scripts/python tools/env_local.py --ejecutar
```

Antes había un pool de producción cableado como default, y con dev en pie eso
resolvía el correo contra el pool equivocado **sin avisar**: abonaría al `sub` de
un usuario de producción dentro de la base de dev. Ahora falla y lo dice. Pasar
el sub directo no necesita pool.

`abonar` además comprueba contra CloudFormation que el clúster es el del
`--entorno` que le declaraste, y en producción hace teclear `PROD`. `saldo` y
`movimientos` no preguntan nada.

```bash
venv/Scripts/python tools/creditos.py saldo --user correo@ejemplo.com
```

```bash
venv/Scripts/python tools/creditos.py abonar 100 --user correo@ejemplo.com --tipo cortesia --ref regalo-bienvenida
```

```bash
venv/Scripts/python tools/creditos.py movimientos --user correo@ejemplo.com -n 20
```

- `--tipo` ∈ `cortesia | compra | ajuste` (ajuste acepta negativos).
- Tarifa (de `tools/tarifas.json`, única fuente): preparar película 10 cr,
  producir 3 cr/s, imagen 2 cr (pro 10), shorts transcripción 2 cr/5 min +
  análisis 2 + render 2 por short, Editar sugerencias 2 cr (la regla de cuando se
  juntan varios videos está en «Edición con copia y unión», más abajo).
  Packs Stripe: 100/$1.99 · 550/$9.99 · 1200/$18.00 dólares — los Payment
  Links DEBEN costar el monto exacto (el webhook mapea por monto).

### «Me dice que mi video es muy corto»

Es a propósito, desde el 14 de septiembre de 2026. Shorts y las sugerencias de
corte piden **entre 1 y 90 minutos**: por debajo de un minuto el video ya dura
menos que un short, no hay nada que recortar, y antes cobrábamos igual por una
corrida que terminaba en «no encontró candidatos válidos». El rechazo ocurre
ANTES del cobro, así que no hay nada que devolver; el botón se apaga solo y el
aviso dice la duración real y la mínima.

La otra mitad del mismo arreglo: una corrida de sugerencias que termina bien
pero **sin una sola propuesta** devuelve la parte del LLM (2 cr) y lo dice en
la pantalla. La parte de transcripción no vuelve, y con razón: el canónico
queda hecho en el proyecto y la siguiente corrida ya no lo cobra.

Si alguien pregunta por un cobro raro, el extracto lo cuenta entero:

```bash
venv/Scripts/python tools/creditos.py movimientos --user correo@ejemplo.com -n 40
```

### «Le dije a la IA qué quería al editar y no lo hizo»

Desde el 13 de octubre de 2026, `POST /api/editar/<proyecto>/sugerir` acepta un
cuerpo **opcional** `{"instruccion": "…"}` (la caja «Edición» del inicio); sin
cuerpo —`static/e1.html` y `/estudio/subir/`— todo es igual que antes. El
servidor la limpia (quita caracteres de control e invisibles y los espacios de
los extremos; vacía = como si no hubiera) y la guarda en
`doc.editar.instruccion`; si no es texto, pasa de 2000 caracteres o el cuerpo no
es un objeto JSON (un `text/plain` con texto, un JSON roto) responde 422
**antes de cobrar**, y el cobro y la devolución siguen con la referencia
`editar-sugerir:<proyecto>`. Las claves de más del cuerpo se ignoran (nunca
viajan créditos: el servidor decide el precio) y volver a pedir sin cuerpo no
hereda la instrucción de la corrida anterior. El worker la pone en el mensaje de
*usuario* del LLM, entre `<<<` y `>>>`, como un dato que no cambia sus reglas ni
el formato de salida; el system prompt (`prompts/cortes_system.md`) no se toca,
así que no hay nada que sincronizar con Langfuse. Y le recuerda que este motor solo sabe
**quitar tramos**: lo que la instrucción pida y no se pueda lograr así
(vertical, subtítulos, música, títulos, fundidos) NO se aplica y sale como duda
en el editor, con un texto que empieza por «No aplicado:» — es lo esperado, no
un fallo. Pendientes: hoy, si lo único que devuelve la IA son esas dudas, cuenta
como entrega (hay `flags`) y no se devuelve nada. Y el candado por cuenta ya
existe, pero solo para las copias de E2 (ver «Edición con copia y unión», más
abajo): la ruta vieja `sugerir` sigue bloqueando únicamente por proyecto, con 409,
así que `static/e1.html` y `/estudio/subir/` pueden correr dos proyectos a la
vez. La caja del inicio ya no usa esa ruta.

### Edición con copia y unión (E2)

Desde la etapa E2 la pestaña Edición de la caja del inicio puede **elegir videos
de Mis creaciones, subir varios y unirlos**, y siempre trabaja sobre una **copia**.
Cuatro rutas nuevas, todas en `server/edicion_api.py` y todas solo de nube:

| ruta | qué hace | cobra |
|---|---|---|
| `GET /api/edicion/elegibles` | la lista de la hoja «Agregar videos»: películas, cuentos, clips y ediciones, con duración y formato medidos | no |
| `POST /api/edicion/cotizar` | el precio de varios videos y, si algo no cuadra, el `bloqueo` con su texto | no |
| `POST /api/edicion/iniciar` | hace la copia, cobra y lanza | sí |
| `POST /api/edicion/<copia>/reintentar` | la misma copia otra vez | sí |

**Qué se copia y qué no.** La copia es un proyecto nuevo (`ed-<8 hex del pedido>`,
por ejemplo `ed-9f1c0a7b`) con su título («El tren de papel + 2 más»). El worker
copia cada original de servidor a servidor, dentro del bucket, a
`videos/<copia>/clips/c01.mp4`, `c02…`; **el original no se toca ni se escribe jamás**
(solo se lee), y la copia no lleva `pelicula.mp4`, ni `flags.generado`, ni
`origen.generador`, ni subidas: de lo contrario subtítulos, publicar y render la
confundirían con una película sin editar. La copia duplica los bytes de los
originales; el ciclo de vida del bucket la enfría a los 10 días como todo lo demás y
no se borra nada. Las copias **no se vuelven a unir** en E2 (salen apagadas en la
hoja con «Ya es una edición»).

**Qué acepta el servidor.** Un video se nombra con una referencia,
`proyecto:<nombre>` o `clip:<id>`, y el servidor averigua todo lo demás. Jamás se
acepta una `key` de S3, un precio ni unas duraciones del navegador; un video que no
es de la persona responde 404 igual que uno que no existe.

**Reglas de negocio** (todas del lado del servidor y ANTES de cobrar):

- Un video SOLO: de **1 a 90 min** (la regla de siempre; `MIN/MAX_DURACION_S` de
  `server/shorts_api.py` no se tocaron). Al **unir 2 o más** no hay mínimo por clip.
- El total de lo elegido no pasa de **90 min**, ni de **15 GB**, ni de **12 videos**.
- Horizontales y verticales **no se mezclan**; el formato se mide con ffprobe con la
  rotación del teléfono aplicada. El mismo video no entra dos veces.
- El precio es **la edición UNA vez** (`editar.sugerencias` de `tools/tarifas.json`)
  **más la transcripción** (`shorts.transcripcion_por_5min`) por la **suma de
  minutos** de lo que no trae transcript, en bloques de 5 min empezados:
  100 s + 100 s sin transcript son un solo bloque (la suma se redondea a
  milisegundos antes de contar bloques: una suma que cae justo en 300 s no cobra
  uno de más). Los clips de IA no se transcriben (se unen tal cual) **ni los videos
  sin pista de audio** (el worker no llama a la transcripción sin sonido, así que
  cobrarlos sería pagar un servicio que no ocurre). Con un video es la fórmula de
  siempre (`creditos.costo_editar_sugerencias`, ahora un envoltorio de `creditos.costo_editar`).
- Los nombres de proyecto que acepta una `ref` son los del resto del producto
  (`storage.ruta_proyecto`: letras y cifras de cualquier alfabeto, `-` y `_`, hasta
  255 caracteres): «presentación-final» se lista, se cotiza y se inicia.
- El transcript de un proyecto se acepta solo si su duración coincide con la del
  video (margen de 1 s o 2 %): uno que se quedó de otro archivo con el mismo nombre
  no abarata el precio.

**El dinero.** La referencia del cobro y de toda devolución es **siempre
`editar-sugerir:<copia>`** (la lee `worker/barredor.py`). `iniciar` toma el candado
(INSERT de la copia) **antes** de cobrar y cobra **antes** de lanzar; cada camino de
fallo devuelve lo cobrado y lo deja escrito en `doc.editar.devueltos` (que es lo que
lee la bandeja para decir «Te devolvimos ✦ N»):

| fallo | quién devuelve |
|---|---|
| sin saldo | nadie: no se cobró; la copia sin cobrar se borra |
| no hay capacidad en Fargate | nadie: `iniciar` y `reintentar` lo preguntan **antes** de cobrar (`jobs.hay_sitio`, falla abierto) y responden 503 sin copia ni cargo |
| no se pudo lanzar (o la capacidad se agotó entre la pregunta y `start_execution`) | el API, en la misma petición (502 / 503); la copia queda marcada `no_lanzada` y ni la bandeja ni «Mis creaciones» ni la hoja la enseñan |
| el worker truena | el worker, tras ganar el claim |
| la tarea muere antes de correr | el barredor |
| la petición murió entre cobrar y anotar el cobro | `_liberar_caducadas` (ver abajo) |

El **claim** (`db.reclamar_fallo_editor`, un UPDATE condicionado a `corriendo`) es
lo que impide devolver dos veces: gana uno solo.

**El abono es idempotente por cobro.** `db.abonar_creditos` y `db.cobrar_creditos` son cada
uno UNA sentencia (el saldo y el libro mayor entran los dos o ninguno). El API devuelve con
`creditos.devolver_cargo`, que solo abona si lo ÚLTIMO del libro para `editar-sugerir:<copia>`
es un cargo: repetir un abono que sí entró (su respuesta se perdió) no abona dos veces, y la
devolución del cobro de un «Reintentar» (misma referencia) sí entra. Se intenta hasta 3 veces.
**Si el monedero no responde en ninguna**, el reclamo ya está puesto y nadie más devolvería: la
deuda queda ANOTADA en el doc (`editar.devolucion_pendiente` = cuántos ✦ y `editar.devolucion_api = true`)
y se salda en la siguiente llamada de la persona: `iniciar`, `reintentar` (que se niega con 409
hasta saldarla, para no cobrar de nuevo sin haber devuelto) o `GET /api/edicion/proyectos` (lo primero
que se pide al abrir la app; ahí también se sueltan las copias huérfanas caducadas, sin esperar a que la
persona vuelva a editar). Mientras se debe, la bandeja dice «Estamos devolviendo tus ✦ N» y no
ofrece «Reintentar». Para ver lo que se debe:

```sql
SELECT user_id, nombre, doc #>> '{editar,devolucion_pendiente}' AS debe
FROM proyectos_editor WHERE doc #>> '{editar,devolucion_api}' = 'true';
```

El cierre de una corrida que ya se reclamó (`db.cerrar_editor_si_error`) solo escribe si la copia
sigue en `error` y con el mismo `inicio`: si la persona pulsó «Reintentar» mientras se devolvía, el
cierre viejo no pisa la corrida nueva. Una unión **nunca** se devuelve por
«cero sugerencias» (solo un video sin nada que cortar devuelve la parte de la edición).
Repetir el mismo `pedido` (red caída, doble clic, dos pestañas) devuelve la primera
respuesta sin cobrar otra vez. «Reintentar» cobra de nuevo `editar.creditos`, lo que
costó la primera vez, y solo una llamada gana el claim.

**El candado.** Una sola tarea de edición a la vez por persona: la lectura
(`db.ediciones_corriendo`) responde 409 y un **índice parcial único**
(`proyectos_editor_copia_en_curso`, sobre las copias con `editar.estado = 'corriendo'`)
lo garantiza en la base. Una corrida «corriendo» deja de contar a las **2 horas** (a
los **5 minutos** si todavía no se anotó el cobro) y `_liberar_caducadas` la suelta
antes de tomar el candado, devolviendo lo que corresponda: con el cobro anotado,
`editar.creditos`; sin anotar, lo que diga el libro mayor
(`tools/creditos.py movimientos`: un cargo `editar-sugerir:<copia>` sin su
devolución). Sin esto, una petición que muriera entre reservar y cobrar dejaría a
esa persona bloqueada por el índice hasta que alguien lo arreglara a mano.

**Migración: SÍ, un índice.** Es un solo `CREATE UNIQUE INDEX IF NOT EXISTS`, sin tabla
ni columna nueva, idempotente y vacío al crearse. **Correr `python tools/db_migrate.py`
ANTES de desplegar la API** (paso 4 del checklist de Deploy), en dev primero. No es
bloqueante: sin el índice el API funciona igual: lee antes de insertar y **vuelve a leer
después de su propio INSERT** (la copia que mira más tarde ve a la otra y se retira sin haber
cobrado), así que dos pestañas simultáneas no cobran dos veces; sin pérdida de dinero (cada
cobro tiene su copia y su devolución). Para comprobar que quedó:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'proyectos_editor';
```

**Lo que `iniciar` comprueba contra S3 antes de cobrar.** La medición de un proyecto se guarda
en `doc.meta` y vale mientras `key` y `bytes` coincidan con la subida del doc. Un PUT presignado
a la misma key sin pasar por `/api/media/confirmar` cambia el objeto sin cambiar el doc, así que
`iniciar` (no `cotizar`) hace un HEAD, compara el peso real y, si cambió, vuelve a medir y cobra
lo que de verdad hay (con los topes de 90 min y 15 GB sobre lo nuevo). El worker debería repetir
esa comprobación contra lo que `iniciar` midió (pendiente de S2).

**Lo que no admite una copia.** `/api/media/presign` y `/api/media/confirmar` responden 409 sobre una
copia («Esa es una edición: no se le pueden agregar videos.»), y `confirmar` ya no reescribe el doc
entero: solo la llave `subidas`.

**Cómo comprobarlo sin gastar** (cuenta de prueba, en dev): `GET /api/edicion/elegibles`
→ 200 con `limites`; `POST /api/edicion/cotizar` con 2 o 3 creaciones → un precio y
`bloqueo: null`, con una vertical y una horizontal → `formatos_distintos`, y el
monedero no se mueve; dos `POST /api/edicion/iniciar` casi simultáneos con `pedido`
distinto → uno 200 y el otro 409, y **un solo** cargo en `tools/creditos.py movimientos`.

**Lo que NO hace.** El motor solo quita tramos y junta clips con cortes directos: no
hace fundidos, música, títulos, ni nivela el sonido, ni cambia a vertical. Lo que la
instrucción pida y no se pueda sale como «No aplicado:» en el editor.

### «Quiero mi video en vertical»

Desde el 14 de septiembre de 2026 se elige al crear la película: horizontal
(16:9, YouTube) o vertical (9:16, Reels/TikTok/Shorts). **No se puede cambiar
después** — el aspecto se le pide a Grok y a Veo en cada llamada, y una
película a medias con dos aspectos no concatena. Quien lo pida a mitad de un
proyecto tiene que crear otro.

Las películas anteriores a esa fecha son todas horizontales: el campo no existe
en sus documentos y cae a ese default.

El b-roll del editor no tiene selector porque no elige: hereda el aspecto del
video sobre el que se inserta.

### «No me deja descargar» / «se me abre en una pestaña»

Arreglado el 14 de septiembre de 2026. Lo que pasaba: el atributo `download` de
un enlace **lo ignora el navegador cuando el archivo vive en otro origen**, y
todo lo nuestro vive en el CDN. Ahora la descarga pasa por
`/api/media/descarga?key=…`, que devuelve el archivo firmado por S3 con
`Content-Disposition: attachment` — el navegador ya no tiene nada que decidir.

Si alguien vuelve a reportarlo, lo primero es mirar **de dónde** cuelga el
enlace: uno que apunte directo a `d8bfm82hs0s6a.cloudfront.net` abre en pestaña
por diseño y hay que cambiarlo al endpoint.

Caso aparte, dentro del editor: **publicar a redes (Blotato) y sugerir títulos
funcionan en el servicio desde C2** (M23). Si alguien reporta que una
publicación no salió:

- El modal de Publicar enseña cada envío con su estado. «No sabemos si llegó»
  (`incierto`) significa que Blotato pudo haberlo recibido: que revise su
  calendario de Blotato **antes** de reintentar, o saldrá dos veces.
- El registro de cada envío vive en S3,
  `usuarios/<sub>/publicaciones/<proyecto>/<id>.json` (estado, id del post en
  Blotato, error). Nunca lleva la clave.
- El trabajo corre en el worker SQS (`tipo: publicar`, log group del worker) y
  nunca relanza: un fallo queda escrito en el registro, no en la DLQ.
- Los rechazos de Blotato (422: falta la página, la privacidad, límite diario
  de la red…) llegan a la pantalla con el mensaje de Blotato.

Desde C3 hay además una **Agenda** (`/agenda.html`; en el inicio, Marketing ›
Blotato) con todo lo que Blotato todavía no ha publicado. Si alguien pregunta
por ella:

- Lo que enseña sale de Blotato, no de nosotros: también aparece lo que el
  usuario haya programado desde blotato.com. Solo se ve lo **futuro** — en
  cuanto pasa la hora, Blotato lo saca de esa lista.
- Solo se puede **cambiar la hora** y **cancelar**. Cambiar el texto obligaría a
  reenviar la publicación entera, y Blotato no la fusiona: un campo de menos
  deja el post sin video. Para cambiar el texto, se cancela y se programa otra
  vez desde el editor.
- Cancelar **no se deshace**, y por eso la tarjeta dice a qué página o tablero
  va: dos publicaciones de la misma cuenta a páginas distintas se distinguen.
- Al cancelar, nuestro registro queda en «Cancelada» si lo encontramos. El
  emparejamiento va por la URL del video que acuña Blotato al subirlo
  (`usuarios/<sub>/agenda/<sha256>.json`). Lo programado **antes** de C3 no
  tiene ese índice: se cancela igual en Blotato, pero el modal de Publicar
  acabará diciendo «No sabemos si llegó».
- «No pudimos traer tu agenda» no es una agenda vacía: si Blotato falla o pide
  esperar (60 peticiones por minuto y por usuario), la lista conserva lo que ya
  estaba y avisa. La pantalla no consulta sola: solo al abrirla, al pulsar
  «Actualizar» y después de cada cambio.

Y desde C4, **Métricas** (`/metricas.html`, también en Marketing › Blotato) con
lo que ya salió y lo que no pudo salir. Las preguntas que van a llegar:

- **«No me aparecen los números».** Casi siempre es que Blotato todavía no los
  ha recogido: los junta por tandas, desde un par de horas después de publicar
  y hasta 90 días. **Ningún endpoint fuerza una medición nueva**, así que no hay
  nada que reintentar; por eso el botón dice «Ver números» y no «Actualizar».
  La pantalla distingue cuatro motivos y cada uno dice el suyo en la tarjeta.
- **LinkedIn no da números** y no es un fallo nuestro: Blotato aún no los
  recoge de esa red. Las otras ocho sí.
- **«Esta publicación es vieja y dice que no hay números».** Blotato solo
  guarda lo que llegó a medir: de lo anterior a que empezara no hay nada, y no
  se puede reconstruir.
- Una carga cuesta **dos** llamadas a Blotato (la lista y los números) y
  cambiar a «Las más vistas» no cuesta ninguna: es la misma respuesta. Pedir
  los números de una publicación suelta cuesta una más.
- La pantalla llega **hasta un año atrás**, en tramos de 30 días.

Y desde C5, **Investiga tu competencia** (`/competencia.html`). Es la única
sección del grupo de Blotato que **no usa Blotato**: mira cuentas públicas de
Instagram, TikTok y YouTube con Apify, así que funciona aunque el usuario no
haya conectado su clave. Lo que va a preguntar:

- **«¿Por qué esta publicación está arriba si tiene menos vistas?»** Porque la
  lista no va por vistas: va por cuánto rindió **comparada con lo normal de su
  propia cuenta** («3× lo normal»). Ordenar por vistas pondría siempre arriba a
  la cuenta más grande, que no enseña nada. Si una cuenta trajo menos de tres
  publicaciones con vistas, no hay mediana y esa etiqueta no aparece.
- **«Me cobró menos de lo que decía el botón».** Se cobra por cuenta (3
  créditos) y la cuenta que no devolvió nada **se devuelve**: el informe lo
  dice arriba, con el motivo. Pasa con cuentas privadas, vacías o renombradas.
- **«Faltan los compartidos».** Instagram y YouTube no los informan. Un hueco
  («—») es eso y nunca un cero.
- **«No me deja agregar la cuenta».** Hay que pegar la liga del **perfil**
  (`instagram.com/lacuenta`), no la de una publicación. Se vigilan hasta 5
  cuentas y solo se puede lanzar una revisión a la vez.
- Una revisión cuesta **una corrida de Apify por cuenta**, con tope de gasto
  por corrida. Guardar o quitar cuentas y volver a abrir un informe ya hecho
  no cuesta nada.

### «Mi película se quedó en las imágenes y no avanza»

No está atascada: está **esperando**. Desde el 14 de septiembre de 2026, en
revisión hay dos modos — «⚡ De corrido» (el de siempre) y «🖼 Enséñame las
imágenes antes de animar». Con el segundo la producción para al tener la imagen
de cada toma y no sigue hasta que alguien pulse **Animar**. Puede quedarse ahí
días sin costar nada: la tarea terminó, no hay ningún servidor esperando.

De ahí se sale por tres puertas:

- **Animar** — sigue la producción. No cobra: la película se pagó entera al
  pulsar Producir.
- **Pedir otra** en una imagen — cuesta la tarifa de imagen (`tools/tarifas.json`,
  §video.imagen), avisada antes con un 428. Es lo único que gasta en esta
  pantalla, y es 12 veces más barato que animar y rehacer.
- **Mejor no** — vuelve a revisión y devuelve lo que no se gastó: la producción
  menos las imágenes ya quemadas. En el monedero sale como `cancelar:<id>`.

Se aprueban las **cabezas de cadena**, no todas las escenas: una escena que
continúa a la anterior arranca del último frame de su clip, que todavía no
existe. Por eso una película de 5 escenas puede enseñar solo 2 imágenes — y
cada una dice de cuántos planos manda.

Si una película aparece en `imagenes` y la pantalla sale vacía, mirar
`estado.json` bajo `work/<user>/<id>/` en S3: es de donde salen las imágenes y
el casting que usa la segunda mitad.

## Administración y costos

- **Dashboard**: `/admin.html` (grupo admin) — 3 pestañas: Ingresos, Costos
  (IA de Langfuse separada de AWS `infra-*`), Flujo; drill-down por corrida
  con liga a la traza de Langfuse; botón de sync (también corre solo a las
  06:00 UTC vía EventBridge).
- Por CLI:

```bash
venv/Scripts/python tools/costes.py resumen --dias 30
```

```bash
venv/Scripts/python tools/costes.py sync --dias 3
```

## Ramas

Dos, y solo dos:

| rama | qué es | qué entra |
|---|---|---|
| `main` | **lo que corre en AWS** — lo que ven los testers | solo merges de `dev`, cada uno seguido de su deploy |
| `dev` | integración: el trabajo se acumula aquí | un PR por cambio, desde una rama propia |

Cada cambio sale de `dev` en su rama y su PR vuelve a `dev`. Liberar es un PR
`dev` → `main`, y el deploy va pegado al merge.

**Por qué esto importa, y qué NO resuelve.** Hay UN entorno AWS: los testers usan
la misma Aurora, el mismo Cognito y el mismo bucket donde tú pruebas. `dev` no es
un lugar seguro donde romper cosas en la nube — un `cdk deploy` desde cualquier
rama pisa el mismo stack. Lo que las dos ramas compran es otra cosa: saber qué
están usando los testers sin ir a interrogar a ECR. Si la regla se cumple,
`git log main` lo responde.

Por eso `dev` se prueba **en local** — la suite, `tools/check_js.py` y el server
en 8011 — y por eso el deploy no es "cuando se pueda": un merge a `main` sin su
`cdk deploy` deja al repo diciendo algo falso.

### Dónde se ve cada una

| rama | dónde se ve |
|---|---|
| `main` | https://irremplazables.xyz — **lo que usan los testers** |
| `dev` | solo en tu máquina: `venv/Scripts/python -m uvicorn server.app:app --port 8011` → http://localhost:8011 |

No hay un «dev en la nube». Con un solo entorno AWS, esa columna no existe.

#### El 8011 con login real (`.env.local`)

Por default el 8011 corre **sin login**: `server/auth.py` solo exige el JWT si ve
`COGNITO_POOL_ID`, y sin esa variable todo pasa como `DEFAULT_USER_ID`. Para
probar el login, el monedero o los créditos de verdad hay que darle el cableado
de AWS, y ese cableado **no se teclea**: sale de los outputs del stack.

```bash
venv/Scripts/python tools/env_local.py              # ENSAYO: dice qué escribiría
venv/Scripts/python tools/env_local.py --ejecutar    # escribe .env.local
```

`.env.local` se carga después del `.env` y con override (`pipeline/config.py`),
así que el cableado generado gana sin que nadie edite el `.env` a mano. Para
volver al dev local de siempre, **borra el archivo**: no hay que deshacer nada.

**Mientras no existan los stacks `-dev` (paso 8 del entorno dev), eso apunta a
PRODUCCIÓN.** El pool, la base y el monedero que veas en localhost:8011 son los
reales: lo que cobres o borres ahí le pasa a un usuario de verdad. La
herramienta te hace teclear `PROD` antes de escribir el archivo.

Lo que **no** pone, a propósito: `JOBS_BACKEND`, `JOBS_QUEUE_URL` y
`PRODUCIR_SM_ARN` —con esos tres tu máquina encola en la cola de producción y el
worker de prod recoge y paga la generación—, `STRIPE_WEBHOOK_SECRET`,
`LANGFUSE_PROMPTS` y **los dos prefijos de SSM**.

El de usuarios es el que más duele y **no falla: publica**. Con
`SSM_USUARIOS_PREFIX` de producción puesto, `claves_usuario.en_nube()` da `True` y
`blotato.clave_y_origen()` devuelve la clave de Blotato de un usuario **real**
leída de SSM: a partir de ahí cualquier prueba de MIX en tu máquina publica en la
cuenta de redes de ese cliente. Sin el prefijo, las claves salen de
`work/_claves` —archivo local que git ignora— y el flujo de «conecta tu clave» se
prueba igual. `SSM_ENV_PREFIX` se queda fuera por otra razón: en local no lo lee
nadie, porque lo consume `worker/env_ssm.py` desde `server/lambda_handler.py` y
uvicorn arranca `server/app.py`.

El porqué de cada uno está en el docstring de `tools/env_local.py`, y
`tests/test_entorno_local.py` lo fija.

### Los comandos, por caso

**Un cambio cualquiera** — sale de `dev` y vuelve a `dev`:

```bash
git checkout dev && git pull && git checkout -b mi-cambio
# … trabajar, y probar en local antes de subir …
git push -u origin mi-cambio && gh pr create --base dev --fill
gh pr merge <N> --squash --delete-branch
```

**Liberar a producción** — `dev` → `main`, y el deploy pegado:

```bash
git checkout dev && git pull
gh pr create --base main --head dev --title "Release: <qué entra>" --body "…"
gh pr merge <N> --merge          # SIN --delete-branch: se llevaría dev
```

En cmd:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && npx cdk deploy aws-media-api aws-media-jobs --require-approval never
```

En PowerShell (5.1 **no tiene `&&`**: la línea de cmd ahí es un error de
sintaxis, no un comando que falla):

```powershell
$env:PATH = "D:\aws-project\venv\Scripts;C:\Program Files\nodejs;$env:PATH"
npx cdk deploy aws-media-api aws-media-jobs --require-approval never
```

```bash
git checkout dev && git merge origin/main && git push   # dev no se queda atrás
```

**Un arreglo urgente** que no puede esperar a que `dev` esté estable: sale de
`main`, su PR vuelve a `main`, se despliega, y después se baja a `dev` con ese
mismo `git merge origin/main` de arriba. Es la única excepción a «todo pasa por
dev», y conviene que siga siendo excepción.

Si esa bajada trae conflictos y por eso viaja en un PR a `dev` (pasó con lo
legal: el PR #174 a `main`, octubre de 2026), **ese PR no lleva el `--squash`
de «un cambio cualquiera»: se fusiona con `gh pr merge <N> --merge`**. Lo que
evita que el siguiente release choque es que `main` quede como ancestro de
`dev`, y eso solo lo deja un commit de merge. Con squash, o con «Rebase and
merge», los mismos archivos vuelven a chocar en el `dev` → `main`. Antes de
fusionar un release, esto tiene que contestar:

```bash
git fetch origin && git merge-base --is-ancestor origin/main origin/dev && echo "main ya está dentro de dev"
```

### La trampa de `--delete-branch-on-merge`

Esa opción del repo está **apagada a propósito** (2026-09-13). Borra la rama
*head* de todo PR mergeado — y en el release el head es `dev`, así que se la
lleva por delante. Ya pasó una vez. Lo que sí conviene es `--delete-branch` en
el `gh pr merge` de cada rama de trabajo: hace lo mismo, pero solo en ese PR.

Proteger `dev` sería la solución limpia, pero la protección de ramas pide
GitHub Pro en repos privados.

El día que haya testers suficientes para que no puedas permitirte romperles nada,
lo que toca es un segundo entorno AWS, no una tercera rama. Los dos stacks con
VPC ya van con `nat_gateways=0`, así que duplicar no arrastra el costo fijo del
NAT; lo que falta es parametrizar cuatro nombres cableados (`aws-media-users`,
el dominio `media-ivenaccip`, `aws-media-producir` y el rol OIDC).

## Entornos (prod y dev)

Decisión del 24-sep: dos entornos, y dev con su **propio** pool de Cognito. Hoy
solo existe prod; dev llega con su propia app de CDK (paso 8 del plan, después
del 10-oct).

- Los nombres físicos de cada entorno viven en `infra/entornos.py` (`PROD` y
  `DEV`): pool y dominio de Cognito, prefijos de SSM, máquina de estados y
  nombre del API. `ApiStack` y `JobsStack` reciben `entorno=` y su default es
  `PROD`.
- **Nunca** se pasa `entorno=DEV` a los stacks de `infra/app.py`: eso no crea un
  dev, le cambia el pool al stack vivo por uno vacío (el viejo queda huérfano
  con los usuarios dentro y el `client_id` cambia).
- `tests/test_entornos.py` sintetiza la composición real con
  `app.construir()` y fija los nombres de prod, los ids lógicos de Cognito y
  de la máquina de estados, las variables de SSM y los permisos de IAM. El CI
  lo corre en el paso «Nombres de producción (CDK)», antes del build.
- Importar `infra/app.py` ya no sintetiza ni consulta el ECR: eso vive bajo
  `if __name__ == "__main__"`. `cdk` lo corre igual que antes.

Cuando un PR toque `infra/app.py`, `infra/entornos.py` o `infra/stacks/`, el
`cdk diff` de los stacks de prod contra la imagen que ya corre tiene que salir
vacío salvo lo que el PR diga que cambia:

```bash
cd infra
IMAGE_TAG=<sha completo de lo desplegado> npx cdk diff aws-media-db aws-media-media aws-media-jobs aws-media-api
```

Con `IMAGE_TAG` y no con `latest`: en cuanto algo nuevo llegue a main, el diff
contra `:latest` sale con el `ImageUri` cambiado aunque la infra sea la misma.

### Deploy del entorno dev

Cada push a `dev` (un merge de PR incluido) publica, cuando el CI pasa, la
imagen `aws-media:dev-<sha completo del commit>`. Nunca `latest`. El sha es el
de `git log -1 --format=%H origin/dev` tras un `git fetch`. En cmd, desde
`D:\aws-project\infra`:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && set "IMAGE_TAG=dev-<sha>" && npx cdk --app "python app_dev.py" diff aws-media-api-dev aws-media-jobs-dev & set "IMAGE_TAG="
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && set "IMAGE_TAG=dev-<sha>" && npx cdk --app "python app_dev.py" deploy aws-media-api-dev aws-media-jobs-dev --require-approval never & set "IMAGE_TAG="
```

Sin `--app` no pasa nada malo (esos nombres no existen en `app.py`). Ojo: las
imágenes de dev cuentan para las 30 que conserva la regla del ECR.

**En dev se navega por las pantallas nuevas.** La Lambda de `aws-media-api-dev`
lleva `UI_ETAPA_MINIMA=todos`: cada URL vieja (`/clip.html`, `/crear.html`,
`/index.html`…) responde 302 a su pantalla nueva (`/estudio/<p>/`; la del inicio,
a `/estudio/`), aunque `server/migracion.py` la tenga en `nueva`. Producción no
tiene la variable (lo fija `tests/test_entornos.py`), así que sus etapas siguen
siendo las de `PANTALLAS`. Ninguna pantalla enseña ya «Usar la versión anterior»;
para volver a una clásica se teclea `/ui/clasica?pantalla=<p>`. Dev no tiene
dominio propio: su liga es su `execute-api`, el output `ApiUrl` de
`aws-media-api-dev` que imprime el `cdk deploy` (las comprobaciones de las rutas
por nivel están en «La UI nueva» › «Rutas por nivel»).

**Aurora de dev se duerme.** `aws-media-db-dev` tiene suelo de 0 ACU y se
auto-pausa a los 5 min sin uso (`infra/stacks/db.py`). Despertarla puede tardar
más que los ~24 s que `pipeline/db.py` reintenta por su cuenta, así que
`tools/db_migrate.py` con los `--cluster-arn/--secret-arn` de dev (nunca los de
prod) puede terminar con `DatabaseResumingException` (en el traceback, también
`DespertandoError: la base de datos sigue despertando`). No es un error de la
migración: espera 1–2 min y vuelve a correrla, las veces que haga falta; es
idempotente. La primera llamada de la app tras la pausa también tarda: la API
contesta 503 con `Retry-After` y la pantalla reintenta sola.

## Deploy (checklist)

1. PR `dev` → `main` y merge → GitHub Actions construye la imagen y la
   empuja a ECR. **Solo main empuja `latest`**: un PR se construye y se
   prueba sin publicar, y `dev` publica únicamente `dev-<sha>` para el
   entorno dev (abajo) — la Lambda de producción consume el `latest` de ese
   mismo repositorio.
2. En tu terminal, desde `D:\aws-project\infra` — en cmd:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && npx cdk deploy aws-media-api aws-media-jobs --require-approval never
```

   o en PowerShell, que es la que suele estar abierta y **no entiende `&&`**:

```powershell
$env:PATH = "D:\aws-project\venv\Scripts;C:\Program Files\nodejs;$env:PATH"
npx cdk deploy aws-media-api aws-media-jobs --require-approval never
```

   (agrega `aws-media-media` o `aws-media-db` solo si el PR tocó esos stacks;
   el synth fija el digest real de `:latest` — nunca deployar sin imagen nueva
   si cambió `static/` o código, porque viajan dentro de la imagen). El synth
   imprime qué imagen pone (`imagen: latest -> sha256:…`): esa línea es la
   única forma de comprobar que desplegaste lo que querías, porque el tag no
   aparece en el diff de CDK.
3. **Si el PR tocó `prompts/*.md`** (regla que nació con la llama «Fluffy»):

```bash
venv/Scripts/python tools/prompts_sync.py
```

   La nube sirve los prompts desde Langfuse (label `production`) — sin la
   siembra, producción sigue con el prompt viejo aunque el código sea nuevo.
   `--dry` primero si quieres ver qué cambiaría.
4. **Si el PR tocó el esquema** (`ESQUEMA` en `pipeline/db.py`): correr la
   migración (sección «Base de datos») **antes del paso 2**. Una tabla o
   columna nueva no le estorba al código viejo, pero el código nuevo falla
   sin ella. Por ejemplo, sin `nombres_editor` cada subida de video daría 500.
5. Marcar lo que quedó en el aire, para poder responder «¿qué tenías el
   jueves?» cuando un tester reporte algo:

```bash
git tag -a prod-$(date +%Y%m%d) -m "desplegado: <qué entró>" && git push origin --tags
```

### Desplegar UN commit concreto, y volver atrás

`cdk deploy` a secas significa «pon lo que haya en `:latest`»: **todo** lo
mergeado desde el último deploy, lo haya probado alguien o no. Es todo o nada,
y muerde justo cuando más duele — un arreglo urgente el día del lanzamiento se
lleva con él cualquier cosa que estuviera esperando en `main`.

El CI etiqueta cada imagen con el sha de su commit además de con `latest`, así
que se puede pedir una por su nombre:

En cmd, y las comillas NO son adorno. Sin ellas, `set IMAGE_TAG=<sha> &&`
asigna tambien el espacio que hay antes del `&&`: el tag queda con un espacio
al final y el ECR lo rechaza por no cumplir `^[a-zA-Z0-9-_.]{1,300}$`. Mordio
el 2026-09-22, con este mismo runbook delante, en un deploy que no era ni
urgente. El `& set "IMAGE_TAG="` del final tampoco sobra: es lo que impide
que la variable sobreviva al comando (ver la trampa, justo debajo).

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && set "IMAGE_TAG=<sha>" && npx cdk deploy aws-media-api aws-media-jobs --require-approval never & set "IMAGE_TAG="
```

En PowerShell, donde el `finally` hace ese mismo trabajo y encima aguanta que
canceles con Ctrl-C:

```powershell
$env:PATH = "D:\aws-project\venv\Scripts;C:\Program Files\nodejs;$env:PATH"
try {
  $env:IMAGE_TAG = "<sha>"
  npx cdk deploy aws-media-api aws-media-jobs --require-approval never
} finally {
  Remove-Item Env:IMAGE_TAG -ErrorAction SilentlyContinue
}
```

Eso sirve para las dos cosas:

- **desplegar solo lo tuyo** cuando hay cosas más nuevas mergeadas que todavía
  no quieres en producción;
- **volver atrás**, que antes no se podía pedir — solo esperar a que el CI
  reconstruyera el commit viejo. El sha que corría antes sale de
  `aws lambda get-function --function-name <la Lambda> --query Code.ImageUri`,
  o de la lista del ECR por fecha.

Un tag que no exista **para el deploy** con un mensaje claro; no cae a
`latest`. Desplegar una imagen distinta de la que pediste, y en silencio, es el
peor final posible para una vuelta atrás.

Ojo con el margen de la retención: la política conserva 30 imágenes, así que
una imagen vieja se puede haber borrado ya. Si la necesitas y no está, la única
salida es reconstruirla desde su commit.

### La trampa de `IMAGE_TAG`: el deploy que no despliega

`set IMAGE_TAG=<sha>` **dura lo que dure la ventana, no lo que dure el
comando**. Un rato después, en esa misma ventana, un `cdk deploy` normal ya no
significa «pon lo último»: significa «pon otra vez aquel sha». Y como esa
imagen ya está puesta, CloudFormation contesta lo que de verdad ve:

```
✅  aws-media-api (no changes)
```

Eso pasó el 20 de septiembre de 2026. El deploy que debía llevar el arreglo de
MIX a producción no llevó nada, los cuatro stacks dijeron «no changes», y la
lectura natural —«ya estaba todo al día»— era exactamente la contraria de lo
que había ocurrido. Peor todavía: si en esa ventana heredada despliegas después
de mergear algo nuevo, no es que no avance, es que **revierte**.

Tres cosas, por orden de utilidad:

1. **Usa las formas de arriba.** El `& set IMAGE_TAG=` de cmd y el `finally` de
   PowerShell existen para que la variable no sobreviva al comando. No son
   adorno.
2. **Lee la línea `imagen:`.** Cada synth imprime qué está poniendo, y es la
   única prueba de lo que desplegaste:

   ```
   imagen: 8f8f7f5c6fb264b9c2079fc41cd519d584dc7435 -> sha256:b71d7c58…
   ```

   Si esperabas `latest` y ves un sha, la variable viene heredada: cierra la
   ventana (o `Remove-Item Env:IMAGE_TAG`) y repite. Desde el 21-sep el synth
   además **grita con un recuadro** cuando la imagen fijada no es la más nueva
   del ECR, que es el caso en el que el deploy vuelve atrás sin querer.
3. **`(no changes)` justo después de un merge es una alarma, no un alivio.**
   Si acabas de mergear y desplegar, algo tuvo que cambiar. Cuando no cambia
   nada, empieza por la línea `imagen:`.

## El dominio propio (`aws-media-dominio`)

El producto se sirve en **https://irremplazables.xyz** desde el 2026-09-23. La
cadena completa, de fuera hacia dentro: Cloudflare (proxy, TLS del visitante) →
dominio personalizado de API Gateway (TLS con el certificado de ACM) → el mismo
API `2ecset5i94` de siempre → la Lambda.

El `execute-api` **sigue vivo y sirviendo** (`DisableExecuteApiEndpoint = False`)
y las dos URLs están en los callbacks de Cognito. No se apaga: hay usuarios con
esa liga, y correos de invitación ya enviados que apuntan ahí.

Vive en un stack **aparte** y en su propia app CDK (`infra/app_dominio.py`), por
la misma razón que las alarmas: poner un CNAME no puede costar estrenar una
imagen sin probar en el API, el worker y Fargate a la vez.

### Los tres hostnames que se confunden

| Cuál | Qué es |
|---|---|
| `irremplazables.xyz` | El nombre público. Lo que teclea la gente. |
| `2ecset5i94.execute-api.us-east-1.amazonaws.com` | El endpoint del API. Sigue vivo. |
| `d-hyornda8q1.execute-api.us-east-1.amazonaws.com` | **Al que apunta el CNAME de Cloudflare.** |

El tercero es el que nadie adivina. Apuntar Cloudflare al segundo resuelve
perfecto y el TLS ni siquiera llega a validar: ese endpoint presenta el
certificado de `*.execute-api.us-east-1.amazonaws.com`, que no cubre nuestro
nombre. Se saca con:

```bash
aws apigatewayv2 get-domain-name --domain-name irremplazables.xyz --region us-east-1 --query "DomainNameConfigurations[0].ApiGatewayDomainName" --output text
```

### Desplegarlo

Desde `D:\aws-project\infra`, en cmd, y **solo con el certificado en ISSUED**:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && set "CERT_ARN=arn:aws:acm:us-east-1:191241816158:certificate/2a234253-9f81-4338-b93a-20a2a935457d" && npx cdk --app "python app_dominio.py" deploy aws-media-dominio & set "CERT_ARN="
```

Ojo con el `--app`: sin él, `cdk` usa `app.py` y despliega producción.

### Cloudflare: los dos ajustes que importan

- **SSL/TLS = Full (strict).** Con `Flexible`, Cloudflare habla HTTP a un origen
  que solo escucha en 443: da 5xx o bucle de redirecciones, y se ve idéntico a
  «la app está caída». Verificado el 2026-09-23 que `Full (strict)` funciona —
  Cloudflare manda el hostname del visitante como SNI, cosa que su propia
  documentación no dice en ningún sitio.
- **El CNAME del ápice va PROXEADO (nube naranja).** En el ápice no existe el
  CNAME plano, así que Cloudflare lo aplana siempre; en gris eso publicaría las
  IP del endpoint de API Gateway, que no son estables.

### La caché de los estáticos (UI·3)

La decide el servidor (`_StaticCacheado` en `server/app.py`), no Cloudflare:

| Qué | `Cache-Control` | Borde |
|---|---|---|
| HTML | `no-cache` | no se cachea (DYNAMIC) |
| JS y CSS | `no-cache` | `Cloudflare-CDN-Cache-Control: max-age=60` |
| Imágenes | `public, max-age=86400` | lo que decida Cloudflare |
| Versionados (`*.v1.*`) | `public, max-age=604800, immutable` | ídem |

Antes del 27-sep el JS y el CSS salían sin cabecera y Cloudflare les ponía
`max-age=14400`: un fix de UI tardaba hasta 4 h en llegar. Con la tabla, un
deploy llega al borde en ≤ 60 s y el navegador lo ve en su siguiente carga,
**sin purgar nada**.

Comprobación después de cada deploy que toque esto:

```bash
curl -s -D - -o /dev/null https://irremplazables.xyz/auth.js | grep -iE "cache-control|cf-cache-status|^age"
```

Lo esperado: `cache-control: no-cache`, `cf-cache-status` en HIT a la segunda
petición y `age` ≤ 60. Si sale `max-age=14400`, es que Cloudflare está pisando
la cabecera: en **Caching → Configuration → Browser Cache TTL**, elige
«Respect Existing Headers».

### Lo que NO se puede borrar nunca

El CNAME `_181ee3334b127307304e024ff9aefc56` de la zona es el de validación de
ACM, y ACM **lo relee para renovar**. El certificado vence el **2027-04-08** y
la renovación arranca 45 días antes: son dos ciclos al año, no uno. Borrar ese
registro no rompe nada hoy y rompe todo en medio año, cuando nadie se acuerde
de este trabajo.

Tampoco los tres CNAME de `_domainkey` de esa misma zona: son la firma DKIM
con la que salen los correos del pool (ver «El remitente de los correos»).

### La trampa que se cobró media hora el día del cambio

Un dominio recién registrado arrastra respuestas negativas cacheadas: quien
preguntó por él antes de que existiera el registro se guarda ese «no existe»
hasta el mínimo del SOA de la zona (1800 s). Y el resolver de casa resultó ser
el **router** (`fe80::1`), que caduca peor y al que `ipconfig /flushdns` no
toca. Síntoma: `DNS_PROBE_FINISHED_NXDOMAIN` en tu navegador mientras el sitio
responde 200 para el resto del mundo. Se confirma preguntando a dos resolvers
públicos distintos — si Google y Cloudflare lo resuelven, el problema es local:

```bash
curl -s -H "accept: application/dns-json" "https://dns.google/resolve?name=irremplazables.xyz&type=A"
```

Salidas, de más rápida a más lenta: DNS seguro en el navegador (salta router y
proveedor), reiniciar el router, o esperar.

## Alarmas

Siete alarmas de CloudWatch mandan correo cuando algo se rompe, a
`ivenaccip@gmail.com` y a `developer.leonardomedina@gmail.com`. Van las dos
direcciones porque la cuenta de AWS y el presupuesto de $50 se dieron de alta
con la primera, pero el trabajo del proyecto se sigue desde la segunda — y una
alarma que llega a la bandeja que nadie abre no es una alarma. Viven en un stack **aparte** (`aws-media-alertas`) y en su propia app CDK
(`infra/app_alertas.py`), por una razón concreta: `cdk deploy aws-media-api`
arrastra la base de datos —el diff lo dice literalmente, *«Including dependency
stacks: aws-media-db, aws-media-media, aws-media-jobs»* (TRES: `app.py` le
pasa a ApiStack el `jobs_queue` y el `producir_sm`, que salen de JobsStack)— y desplegar unas alarmas no debería
poder meter al clúster Aurora en el radio de una actualización.

### Desplegarlas

Desde `D:\aws-project\infra`, en cmd:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && npx cdk --app "python app_alertas.py" deploy aws-media-alertas --require-approval never
```

O en PowerShell:

```powershell
$env:PATH = "D:\aws-project\venv\Scripts;C:\Program Files\nodejs;$env:PATH"
npx cdk --app "python app_alertas.py" deploy aws-media-alertas --require-approval never
```

Ojo con el `--app`: sin él, `cdk` usa `app.py` y despliega producción.

### El paso manual sin el que nada de esto sirve

La suscripción de correo nace en `PendingConfirmation` y **CloudFormation
reporta CREATE_COMPLETE igual**. Hasta que no hagas clic en el enlace del correo
de AWS, las siete alarmas disparan al vacío.

```bash
aws sns list-subscriptions-by-topic --topic-arn arn:aws:sns:us-east-1:191241816158:aws-media-alertas --query "Subscriptions[*].SubscriptionArn" --output text
```

**Cada dirección confirma la suya por separado.** Si alguna sale como la cadena
literal `PendingConfirmation`, esa bandeja no recibe nada: busca ahí el correo
«AWS Notification - Subscription Confirmation» (mira también en spam).

Y una vez confirmada, comprueba que el correo llega de verdad:

```bash
aws cloudwatch set-alarm-state --alarm-name DlqConMensajes --state-value ALARM --state-reason "prueba del canal de avisos"
```

Vuelve sola a OK en cuanto CloudWatch reevalúe la métrica.

### Qué significa cada una

| alarma | qué mira | qué hacer |
|---|---|---|
| `Api5xx` | ≥5 respuestas 5xx en 5 min | mira `ApiThrottles` y `ConcurrenciaCuenta` **primero**, no Aurora |
| `ApiThrottles` | ≥1 petición perdida por cuota | la cuota de concurrencia de la cuenta, no `max_concurrency` |
| `ConcurrenciaCuenta` | ≥8 de 10 ejecuciones simultáneas | es el techo real del producto |
| `AuroraTecho` | ≥80% del techo de ACU, 15 min | `db.py:31` de 1 a **2** y observar |
| `DlqConMensajes` | ≥1 trabajo perdido | revisa el mensaje antes de reencolarlo |
| `ColaAtascada` | el más viejo lleva >20 min | mira `ApiThrottles` antes de subir workers |
| `ProduccionFallida` | ≥1 producción rota | logs de Step Functions |

**El orden del diagnóstico importa.** Ante 5xx, la tentación es culpar a la base
de datos porque suele estar al 100% de su techo de 1 ACU. Pero ese 100% aparece
decenas de veces sin un solo 5xx, y los dos incidentes reales con peticiones
perdidas tenían Aurora al **30%**. La causa estaba en la concurrencia. Mira
throttles primero.

**API y worker comparten la misma cuota de 10.** Subir `max_concurrency`
(`infra/stacks/jobs.py:97`) para desatascar la cola le roba concurrencia al API
y produce **más** 5xx de cara al usuario. Esa palanca solo es segura después de
que suba la cuota de la cuenta.

### Dos cosas que hay que revisar en el calendario

**Los umbrales de `Api5xx`, `ConcurrenciaCuenta` y `ProduccionFallida` se
calibraron con 5 testers.** Están pensados para 5.819 peticiones en 14 días. Con
166 usuarios, `Api5xx` se convierte en un buscapersonas diario. **Retararlos el
24 de septiembre**, con una semana de datos reales.

**Re-verificar los ids tras cualquier deploy que reemplace un recurso.** Las
dimensiones van cableadas como literales, y con `treat_missing_data=notBreaching`
una alarma cuya dimensión deje de existir **no cae en INSUFFICIENT_DATA: se
queda en OK**, ciega y en silencio. Es la contrapartida de que «sin datos» sea
«sano» — necesaria, porque el API solo tiene tráfico en el 8% de las ventanas de
5 minutos.

```bash
aws cloudwatch describe-alarms --query "MetricAlarms[*].[AlarmName,StateValue]" --output text
```

Los seis ids que pueden cambiar están en la cabecera de
`infra/stacks/alertas.py`, con la fecha en que se verificaron.

## Imágenes en segundo plano

`POST /api/imagenes` generaba la imagen dentro de la petición, y la Lambda del API corta a los 29 s (API Gateway: tope
fijo de 30 s; un arranque en frío ya gasta unos 16). Cortada la petición, se cobraba, no se devolvía y fal cobraba igual. Por
eso los modelos que tardaron **más de 10 s** en la prueba pagada —Seedream 5.0 Flash, Seedream 4.5, FLUX 3 y las dos calidades de Nano Banana Pro (2K y 4K)— se encolan
como el clip. Cuáles lo dice una bandera por fila, `segundo_plano` en `pipeline/modelos_ia.py`
(la tabla con los segundos medidos está en `docs/modelos-ia/POR-VERIFICAR.md`); los rápidos siguen síncronos y en local todo es
síncrono. Las dos excepciones a la regla son Grok y Nano Banana 2 al crear (ver «Decisión del dueño: Grok y Nano Banana 2», abajo).

El camino: cobrar → doc en S3 (`usuarios/<user>/imagenes-pedidos/<id>.json`) → SQS → `worker/imagen_generar.py` → la imagen
queda en `imagenes/<user>/<nombre>` (donde viven las de siempre) y la pantalla, que sondea `GET /api/imagenes/pedidos/<id>`,
la ve `listo`. Un usuario no puede tener más de 3 pedidos generándose a la vez (409).

**La caducidad es de 45 min** (`HORAS_CADUCA` en `server/imagen_cola.py`; la comparten el tope de 3 y el aviso de abajo). Eran 30,
y era poco: la cola reentrega a los 15 y un pedido puede esperar detrás de dos clips. Un `generando` de más de 45 min ya no
cuenta para el tope de 3 y deja de enseñarse como «Generando…»: «Mis creaciones» y «Tus trabajos» lo enseñan como **error**
—«Esta imagen tardó demasiado y no llegó. Si no ves tus créditos de vuelta, escríbenos.», sin afirmar que se devolvieron—
durante la hora desde su inicio (o sea, 15 min), y pasada la hora ya no sale. `GET /api/imagenes/pedidos/<id>` NO aplica esta
regla: sigue contestando `generando` a cualquier edad (la pantalla corta su sondeo a los 5 min), así que «lo enseña como error»
vale solo para la lista y para «Tus trabajos».

**`GET /api/imagenes` y la lectura que puede fallar.** Trae `imagenes`, `pendientes` (los pedidos en marcha y los que fallaron en
la última hora) y `pendientes_ok`. Leer los pedidos es de cortesía: si S3 falla al listarlos o al abrir uno, la lista de imágenes
sigue saliendo con un 200, `pendientes` sale sin lo que no se pudo leer (`[]` si falló el listado) y **`pendientes_ok` es
`false`**; con todo leído —y siempre en local, donde no hay cola— es `true`. Un `pendientes: []` con `pendientes_ok: false` NO
significa «no hay pendientes», sino «no lo sé»: quien lo lee tiene que conservar lo que tenía y seguir sondeando. Un doc que
no es JSON no apaga la bandera (no se arregla solo). La señal es de esa lectura: no se queda pegada.

**La cola es COMPARTIDA** con los clips y con preparar (`infra/stacks/jobs.py`): el worker corre con `max_concurrency=2`, su
timeout y la visibilidad del mensaje son de 15 min y el mensaje va a la DLQ tras 2 recepciones. Si hay dos clips de Veo en
marcha (minutos cada uno), una imagen espera detrás: el usuario ve «Generando…» más tiempo del normal. Pasados los 45 min la
pantalla ya le dice «tardó demasiado y no llegó» aunque el mensaje siga en la cola; si el worker lo termina después, la imagen
aparece sola en «Mis creaciones» (ver «El worker no mira la edad del pedido», abajo). La señal de una cola atascada es
`ColaAtascada` (el mensaje más viejo lleva más de 20 min durante 15 min, o sea que suena hacia los 35 min: antes de que el usuario
vea el aviso de los 45). Subir `max_concurrency` le roba concurrencia al API (ver Alarmas), así que no es la primera palanca.

**Qué hace el worker** (`worker/imagen_generar.py`):

- **Reclamo con token.** SQS estándar entrega al menos una vez y a veces dos a la vez, así que antes de generar el worker reclama
  el pedido con una escritura condicional de S3 sobre `usuarios/<user>/imagenes-pedidos/<id>.reclamo` (If-None-Match). Quien
  pierde no hace nada: ni fal, ni devolución. Un reclamo de **14 min o más** es de un worker que ya murió (la visibilidad de la cola
  es de 15) y se toma con If-Match de la etiqueta que se leyó. El reclamo guarda la hora y un **`token`** uuid propio de cada
  invocación: botocore reintenta solo un PUT cuya respuesta se perdió, y el reintento de un PUT condicional que SÍ se aplicó
  recibe 412; sin el token el worker se creía perdedor de su propio reclamo y salía en silencio (pedido cobrado, sin fal, sin
  devolución, sin DLQ ni alarma). Ahora, al perder, lee el reclamo y, si lleva SU token, lo trata como ganado (las dos rutas: crear
  y tomar uno vencido). Queda un `.reclamo` por pedido, junto al doc; para forzar a mano que el siguiente intento corra, bórralo.
  Después del reclamo, el trabajo solo corre con el doc en `generando`.
- **Devuelve primero, escribe después, y la devolución es idempotente.** Si fal rechaza o la subida falla, el worker devuelve lo
  cobrado (el número sale del doc, `creditos`) y SOLO ENTONCES escribe el doc `error`. El doc guarda `devuelto: true|false`, y el
  mensaje que ve el usuario solo dice «Se te devolvieron los créditos» si salió bien (si no se había cobrado nada, dice «No se te
  cobró»). Así la pantalla nunca lee `error` con el saldo todavía sin abonar. Devuelve con `creditos.devolver_unica` →
  `db.abonar_devolucion`: **una sola sentencia SQL atómica** (el libro y el saldo juntos) que no abona dos veces la misma
  referencia (`imagen:<id>`, única por pedido) y devuelve `None` si ya estaba. `creditos.devolver` y `db.abonar_creditos` NO
  cambiaron: son tres sentencias sueltas del Data API y otros llamadores repiten referencias a propósito (`imagen:estudio`,
  `imagen:editor`).
- **El fallo se marca en el reclamo, antes de devolver.** Lo primero que hace el worker al fallar la generación es escribir
  `fallo: true` en el reclamo (escritura condicional, 3 intentos, best-effort: si no sale queda en el log y se sigue; nunca impide
  devolver). Una reentrega que encuentra esa marca, o el doc en `error` con `devuelto: false`, **nunca regenera**: solo repite la
  devolución (idempotente) y escribe el doc.
- **Cuándo levanta** (SQS reentrega y, a la segunda, la DLQ y suena `DlqConMensajes`, `infra/stacks/alertas.py`): (a) si la
  devolución falla: el doc queda `error` con `devuelto: false` y el mensaje «La imagen no se pudo generar y no pudimos devolverte
  los créditos automáticamente; ya quedó avisado.», y el log dice `NO se pudieron devolver N créditos a <user>`; (b) si devolvió
  pero no pudo escribir el doc `error` (`DocNoEscrito`; el log dice `no se pudo escribir el doc error`), para que no quede un doc
  diciendo «no pudimos devolverte» con el saldo ya abonado, ni uno en `generando` que la reentrega regeneraría. Al levantar,
  suelta el reclamo (lo deja vencido y con el fallo marcado) para que la reentrega no tenga que esperar los 14 minutos justos.
- **Si la imagen ya está subida** (`imagenes/<user>/<nombre>`) y falla la escritura del doc `listo`, se reintenta 3 veces y, si
  sigue fallando, NO se devuelve nada ni se marca `error`, y el worker no levanta (no hay reentrega): el usuario ya tiene su
  imagen en «Mis creaciones». Queda un `la imagen quedó en la galería … pero no se pudo escribir el doc listo` en el log. El pedido
  se verá «Generando…» hasta que caduque (45 min) y después como error «tardó demasiado» hasta la hora, aunque la imagen sí está en
  «Mis creaciones».

Qué pasa cuando la generación falla (fal rechaza o la subida falla) y algo más falla a la vez:

| qué falla | qué queda | la reentrega |
|---|---|---|
| nada más | doc `error` con `devuelto: true`; termina bien | no hay |
| Aurora no devuelve | doc `error` con `devuelto: false`; el worker levanta | solo devuelve y escribe `devuelto: true` |
| devuelve, pero el doc `error` no se puede escribir | doc en `generando` y reclamo con `fallo`; levanta (`DocNoEscrito`) | no regenera: `devolver_unica` da `None` (ya estaba) y escribe el doc con `devuelto: true` |
| Aurora Y la escritura del doc | igual: doc `generando`, reclamo con `fallo`; levanta | no regenera: devuelve y escribe el doc |
| una reentrega que devuelve, pero S3 no deja escribir el doc | el doc sigue diciendo `devuelto: false`; levanta otra vez | la siguiente cierra el doc sin abonar de nuevo; si no hay otra, va a la DLQ |
| lo anterior Y S3 no deja ni marcar el reclamo ni soltarlo | doc `generando`, reclamo SIN marca | **regenera**: indistinguible de un worker que murió generando (una llamada más a fal, que paga la plataforma, no el usuario) |

**Si el worker muere dos veces** (timeout de 15 min, falta de memoria): SQS reentrega una vez y luego manda el mensaje a la DLQ
(`DlqConMensajes`). Qué hacer depende del estado del doc del pedido (`usuarios/<user>/imagenes-pedidos/<id>.json`; el mensaje de
la DLQ es `{"tipo": "imagen", "user_id", "imagen_id"}`):

- **Doc en `generando`** (murió generando, las dos veces): los créditos quedan cobrados sin devolver, igual que hoy con el clip.
  Devuelve lo que dice su campo `creditos` (`tools/creditos.py abonar <n> --user <sub> --tipo ajuste --ref imagen:<id>`; ese tool no
  acepta el tipo `devolucion`). **No hagas redrive:** sin marca de `fallo` en el reclamo, la reentrega REGENERA —fal cobra otra
  llamada— y el usuario se queda con el abono Y la imagen. El doc seguirá en `generando` y a los 45 min la pantalla lo enseñará
  como «tardó demasiado» (ya no cuenta para el tope de 3).
- **Doc en `error` con `devuelto: false`** (la devolución o la escritura del doc fallaron, y la reentrega también): un redrive es
  seguro si nadie abonó a mano, porque repite solo la devolución, que es idempotente. Si YA devolviste a mano **no hagas redrive**:
  el abono a mano es un `ajuste` y la devolución automática no lo ve (solo mira las de tipo `devolucion`), así que abonaría otra
  vez. Con la devolución idempotente, antes de devolver a mano mira `tools/creditos.py movimientos` por `imagen:<id>`: si ya hay
  una `devolucion`, el saldo ya se repuso y solo falta el doc.

Un fallo normal (fal rechaza, la subida falla) NO llega a la DLQ: el worker devuelve, marca `error` y termina bien.

**El worker no mira la edad del pedido (aceptado, no se arregla).** La pantalla da por perdido un pedido a los 45 min, pero el
worker solo mira el estado del doc y el reclamo: uno que la pantalla ya dio por perdido todavía puede terminar de generarse. La
imagen aparece sola en «Mis creaciones» y el aviso de «tardó demasiado» se esfuma; si el usuario lo repitió pagó dos imágenes por
dos cobros, y si soporte ya había devuelto a mano se queda con las dos. Exige una cola atascada más de 45 min (`ColaAtascada` avisa
hacia los 35) o una muerte más una espera larga.

**«Tus trabajos»** (`GET /api/trabajos`, el cuadro de abajo a la derecha) también enseña las imágenes en segundo plano, como los
clips: en curso, lista o con error, y los créditos devueltos solo si el doc no dice `devuelto: false`. El enlace de su ficha lleva
a **`/estudio/marketing/distrito/imagen/`** —la caja en Imagen, donde «Mis creaciones» enseña el pedido, la imagen terminada o su
error (`URL_IMAGEN` de `server/trabajos_api.py`; del 14 al 22-oct-2026 era `/estudio/inicio/`)—, no a `/imagenes.html` ni a
`/estudio/imagenes/`, que son el formulario de crear, vacío; y no a `/estudio/`, que desde las rutas por nivel es el mapa y no trae
la caja. `static/trabajos.js` oculta la ficha en la
pantalla a la que apunta, y la caja es una sola pantalla con tres direcciones: en Imagen, Video y Edición no se repite lo que «Mis
creaciones» ya dice (ni su «Ver» carga otra página, que descartaría lo escrito en la caja). Para las imágenes lee los
pedidos con `imagen_cola._mios` (los ids de hoy y de ayer, y solo abre los 10 más nuevos), no el prefijo entero: ese guarda un
`.json` y un `.reclamo` por pedido, para siempre.

**Apagar un modelo:** quita su número de `tools/tarifas.json` §modelos «imagen», «editar» o «clip» (y, si es Veo Lite o Veo Fast, también su fila de «clip_sin_audio»: sin número de con sonido tampoco se vende mudo, pero la fila suelta queda como precio huérfano) (el servidor lo rechaza con 422 sin cobrar) y pon
`activo: false` en `web/src/pantallas/inicio/modelos.ts`. Los pedidos que ya estaban en la cola siguen y terminan: el worker usa
lo que dice el doc, no la tarifa de hoy. Mover un modelo entre síncrono y segundo plano es cambiar su `segundo_plano`.

**El interruptor de sonido del clip (13-oct-2026).** El pie del menú de modelos de «Un video corto» trae el interruptor «Audio»
(propuesta A del lienzo de diseño, elegida por el dueño): arranca «con sonido», se recuerda por navegador (`localStorage`,
clave `caja.sonido`) y el pedido del clip lleva `audio: true|false`. Solo se puede apagar en los modelos con
`Modelo.audio_opcional` (su endpoint trae `generate_audio`: Veo, LTX, Kling y Seedance) **y** con número en
`tools/tarifas.json` §modelos.`clip_sin_audio` a esa duración (hoy Veo Lite 12, 16 y 22 y Veo Fast 36, 54 y 72 créditos a 4, 6 y 8 s:
costo sin audio ÷ 0.75 ÷ $0.015 dólares, hacia arriba y al par). Todo lo demás lo decide el servidor, no el navegador:
`audio` llega tal cual (solo vale un booleano de verdad), «sin sonido» en MiniMax, Grok o Grok Lite da 422 sin cobrar ni
encolar (traen su pista y no se puede quitar), un modelo sin número «sin sonido» tampoco se vende apagado, y el doc del clip
guarda `audio` para que el worker pida `generate_audio` y anote el costo con la tarifa sin audio de la ficha (un doc de antes del
interruptor vale con sonido). Para **cambiar un número**: edítalo en `clip_sin_audio` (y que siga siendo menor que el de con sonido).
Para **quitar el interruptor de un modelo**: borra su fila de `clip_sin_audio` (queda siempre con sonido). Para **sumar uno**: su
endpoint debe traer `generate_audio`, `audio_opcional=True` en su fila de `pipeline/modelos_ia.py`, `sonido: 'opcional'` en el
catálogo de la web (`tests/test_r4_ola4.py` compara los dos) y su número aquí. La pantalla heredada `/clip.html` no manda `audio`: sigue siendo con sonido.

**Decisión del dueño (11-oct-2026): Grok y Nano Banana 2 siguen síncronos «de momento».** Se deja todo como estaba y se anota
para volver a verlo; no es que la regla no los alcance. **Grok (el predeterminado) sigue síncrono con 13 a 29 s medidos.** La prueba pagada del 18-sep (ocho
llamadas con prompts reales; `PLAN-PRODUCTO.md` y `tools/pricing.json`, `grok_nota`) midió **13 a 29 s por imagen, mediana 16, y el
vertical (720×1280) 28.7 s**. Por la regla de la tabla —segundo plano si algún tiempo medido pasó de 10 s— Grok iría a segundo
plano. Sigue síncrono porque esa decisión es del dueño, y es la ruta de más tráfico: la pantalla de Imágenes y la página vieja no
mandan `modelo`, así que caen en Grok. Ya en síncrono rozaba el muro: 28.7 s más el cobro y la subida (~2 s) pasan de los 29 s de
la Lambda y de los 30 s del gateway (el arranque en frío, ~16 s, no cuenta contra los 29 s de la función pero sí contra los 30 s
del gateway). El usuario ve entonces un 5xx con la imagen cobrada y, si la Lambda muere sin pasar por el `except` que devuelve, sin
devolución, y fal cobra igual. Opciones: (a) `segundo_plano=True` en la fila de Grok de `pipeline/modelos_ia.py` (una línea; la
prueba de `tests/test_imagen_segundo_plano.py` obliga entonces a borrar su excepción `EXCEPCIONES_A_LA_REGLA`, y cambia la respuesta
de `POST /api/imagenes` para el modelo predeterminado: el cliente ya acepta las dos formas); (b) un `asyncio.wait_for` de ~24 s en
`server/app.py` que devuelva los créditos antes de que muera la Lambda. **La bandera de Grok sigue en `False`.**

**Nano Banana 2 al crear sigue síncrono, igual que desde que salió a la venta el 9-oct.** Midió **11.7 s** al crear (DATOS §9);
por la regla iría a segundo plano, y en una versión de esta rama su bandera estaba en `True`: se quitó por decisión del dueño.
Con un arranque en frío (~16 s) más el cobro y la subida (~2 s) la petición suma ~29.7 s, al borde de los 29 s de la Lambda y por
encima de los 30 s del gateway: es el MISMO riesgo que ya tenía antes de esta rama, no uno nuevo. Para moverlo basta
`segundo_plano=True` en su fila de crear en `pipeline/modelos_ia.py` y borrar su línea de `EXCEPCIONES_A_LA_REGLA` en
`tests/test_imagen_segundo_plano.py` (la prueba obliga a que la bandera siga a la regla). Editar con Nano Banana 2 dejó de
venderse el 14-oct-2026 (abajo).

**Decisión del dueño (14-oct-2026): Nano Banana 2 sale de «editar»,** al pasar el inicio a `todos`. Se quitó su número de
`tools/tarifas.json` §modelos.editar: sin número la caja no lo ofrece y el servidor responde 422 antes de cobrar. Su fila en
`pipeline/modelos_ia.py` y su lugar en `CON_EDICION` (`web/src/pantallas/inicio/modelos.ts`) se quedan: volver a venderlo es
poner su número, después de pasar editar a segundo plano, y sacarlo de `APAGADOS` (`tests/test_r4_modelos_servidor.py` y
`web/src/pantallas/inicio/modelos.test.ts`) y de `INERTES` (`tests/test_r4_ola1.py`). Crear con él sigue igual. Lo que sigue es el porqué. Antes, **EDITAR con
Nano Banana 2 seguía síncrono** (`/api/imagenes/editar` no se encola). Al editar midió
11.5 y 13.9 s (crear midió 11.7 s); con un arranque en frío (~16 s, `infra/stacks/alertas.py`) más el cobro y la subida (~2 s) la
petición suma de ~29.5 a ~32 s y supera los 29 s de la Lambda y los 30 s del gateway: el usuario ve un 5xx con la imagen ya cobrada
(y, si la Lambda llega a morir, sin pasar por la devolución). Solo se llegaba desde la caja del inicio con ese modelo, y con el
inicio en `todos` ese camino se abría a todos. Pasarlo a
segundo plano cambia el contrato de editar y la pantalla, por eso no se hizo.

**Pendiente del dueño (`db_migrate`): un índice único parcial para la devolución.** `db.abonar_devolucion` no tiene un índice único
detrás (uno global sobre `tipo = 'devolucion'` rompería las referencias que se repiten a propósito), así que dos sentencias
EXACTAMENTE simultáneas con la misma referencia podrían abonar las dos: las dos pasan el `NOT EXISTS` antes de que la otra confirme.
Se reprodujo contra un Postgres 16 desechable (dos transacciones abiertas a la vez, y 8 conexiones en autocommit con 40
referencias compartidas dejaron 41 filas de libro y 7 créditos de más). En la práctica no puede pasar con el worker: el reclamo
serializa las entregas (es exclusivo 14 min y la Lambda muere a los 15). Si se quisiera cerrarlo del todo, `ESQUEMA` de
`pipeline/db.py` recibiría `CREATE UNIQUE INDEX IF NOT EXISTS monedero_mov_devolucion_ref ON monedero_movimientos (user_id,
referencia) WHERE tipo = 'devolucion' AND referencia LIKE 'imagen:img-%'` y la sentencia de `abonar_devolucion` un `ON CONFLICT
(user_id, referencia) WHERE tipo = 'devolucion' AND referencia LIKE 'imagen:img-%' DO NOTHING` antes del `RETURNING id)`. Validado
en el mismo Postgres: tres corridas de 3,200 sentencias, 0 duplicados y 280 créditos exactos, y el índice no estorba a
`imagen:estudio`. Exige correr `python tools/db_migrate.py`, que corre el dueño; no se aplicó.

**Un detalle de Python en los workers:** un worker tibio corre `asyncio.run()` en cada invocación y lo que se ata a un event loop
no sirve en la siguiente. `pipeline/fal.py` guarda por eso un cliente de fal y un semáforo POR event loop (antes, el cliente
global de `fal_client` hacía fallar cada segunda invocación con «Event loop is closed»). Sirve igual al clip, MIX y overlay.
**`pipeline/llm.py` tiene el mismo defecto de clase y NO está arreglado:** guarda un `AsyncOpenAI` global (`_client`) cuyo pool
de conexiones keep-alive es del loop de la primera corrida. Hoy lo salva el reintento del SDK (`max_retries=2`: cada invocación
tibia gasta ~0.4 s y deja un «Retrying request» en el log), pero deja de salvarlo con 3 o más conexiones muertas en el pool, es
decir, con un flujo de worker que haga 3 o más llamadas LLM concurrentes: entonces la llamada revienta con `APIConnectionError`
(«Event loop is closed») y, en `preparar`, eso es un error y la devolución de créditos. Hoy `flow.preparar` mezcla como mucho 2
llamadas concurrentes, así que es latente. El arreglo sería el mismo patrón (un cliente por event loop); queda pendiente.

## La UI nueva (`web/`, UI·6)

Vite 8 + React 19 + TS estricto + Tailwind v4 + Radix, multipágina
(docs/PLAN-UI.md §3). Cada carpeta `web/estudio/<p>/index.html` es una
pantalla en `/estudio/<p>/`. La primera es la vitrina, `/estudio/_vitrina/`
(noindex): todos los componentes en todos sus estados.

**Del código a producción:**
1. La etapa `web` del Dockerfile corre `npm run verificar`, que hace tipos,
   lint, vitest y build. Si algo falla, **falla el build** y no sale imagen.
2. `web/dist` se copia a la imagen.
3. `server/web.py` lo monta si existe. Sin `dist` no se monta nada y el resto
   sigue igual: `/estudio/` lleva al inicio clásico (`/index.html`).

**Caché:** los assets de `/estudio/assets/` llevan hash y son `immutable`
por un año. El HTML va con `no-cache`.

**Después del primer deploy con `web/`** (cierra UI·6):

```bash
python tools/verificar_web.py
```

Solo hace GET. Revisa que la vitrina salga `noindex`, que sus assets sean
`immutable` y salgan con HIT, que un asset inexistente dé 404, que `/auth.js`
siga `no-cache` y que ninguna clave de `pricing.json` viaje en el JS. Lo que
queda es tuyo: abrir `/estudio/_vitrina/` en el teléfono y aprobarla.

**Local:**

```bash
cd web && npm ci
npm run dev                    # Vite en 8011 (el origen registrado en Cognito)
uvicorn server.app:app --port 8012   # desde la raíz, en otra terminal
```

Vite manda a uvicorn todo lo que no es suyo: la API, `auth.js` y las
pantallas viejas. Pide Node 20.19 o más nuevo. `/instalar` y `/actualizar`
lo comprueban y compilan `web/`.

**Reglas que vigilan `tests/test_web_tuberia.py` y `eslint.config.js`:**
- La etapa web usa el mismo Node que la imagen. `.nvmrc` dice lo mismo.
- Las versiones son exactas.
- No entran `next`, `gsap`, `axios` ni `motion`.
- Sin `dangerouslySetInnerHTML`.
- **`pricing.json` nunca llega al navegador.** Las tarifas se importan de
  `tools/tarifas.json` con nombre, y el plugin `tarifasSinNotas` de
  `vite.config.ts` les quita las notas (citan costos de proveedor) y `economia`.

**Para añadir una dependencia**, usa `npx npm@11 install -D paquete@x.y.z`
dentro de `web/`. El npm 10 del Node 20 se cae con «Cannot read properties
of null (reading 'edgesOut')» al resolver los peers opcionales de vitest
4.1. `npm ci` con el lockfile sí funciona en npm 10, que es lo que corre el
build. `engine-strict` rechaza cualquier paquete que pida Node 22; ya pasó
con `@testing-library/jest-dom@6.10`, y por eso está fijado a 6.9.1.

### El interruptor de migración (UI·7)

`server/migracion.py` es lo único que decide qué versión de una pantalla ve
cada quien. Cada pantalla migrada tiene una etapa en `PANTALLAS`:

| Etapa | URL vieja (`/admin.html`) | URL nueva (`/estudio/admin/`) |
|---|---|---|
| `nueva` | la vieja, igual que siempre | existe; solo se llega tecleándola |
| `todos` | 302 a la nueva, **salvo** la cookie `ui=clasica` | la ven todos |
| `retirada` | 302 siempre; el HTML viejo ya no existe | la ven todos |

- El 302 **conserva el query** y lleva `Cache-Control: no-store`.
- Si una pantalla nueva falla, se abre **`/ui/clasica?pantalla=<p>`** a mano
  (el botón «Usar la versión anterior» se quitó el 28-sep). Eso deja la cookie
  7 días y lo lleva a la vieja, **sin desplegar**. Para volver antes:
  `/ui/nueva?pantalla=<p>`.
- **Cambiar de etapa** = editar `etapa=` en `PANTALLAS` y desplegar (lo
  corres tú). Rollback: desplegar el sha anterior, con el sha COMPLETO en
  `IMAGE_TAG` (el ECR etiqueta con `github.sha`).
- **Medir el retiro** (≥ 3 de 5 usuarios pasaron por la nueva, 7 días sin
  incidentes): cada 302 deja en CloudWatch una línea como
  `migracion 302 pantalla=admin etapa=todos sub=<sub>`, y cada elección de la
  clásica `migracion clasica …`. El sub se lee de la cookie **sin verificar**
  la firma: sirve para contar, nunca para dar acceso.
- **Antes de `retirada`:** `tests/test_migracion_ui.py` exige que cada
  invariante del registro exista como test en `web/` y que haya un
  `docs/migracion/<p>.md` con cada aserción vieja y su destino. En `retirada`
  exige que el HTML viejo ya no exista.

Piloto: **admin** (solo lo usa el dueño), hoy en `nueva`. Su mapa está en
`docs/migracion/admin.md`.

La primera en `todos` es **inicio**, desde el 14-oct-2026 (decisión del
dueño). Del 14 al 22-oct-2026 `/estudio/` respondía 302 a `/estudio/inicio/`;
desde las rutas por nivel `/estudio/` ES el inicio (el mapa), su URL vieja es
`/index.html` y esa responde 302 a `/estudio/`. Las demás siguen en
`nueva`, así que los enlaces del inicio nuevo llevan a sus pantallas viejas,
salvo la foto del personaje de cuentos e historias, que lleva a la Crear
nueva (`/estudio/crear/`). Para devolver a alguien a la clásica:
`https://irremplazables.xyz/ui/clasica?pantalla=inicio` (deja la cookie y lo
lleva a `/index.html`, la clásica). Mientras tenga la cookie (7 días),
`/estudio/` también lo lleva ahí: el login, los «← Estudio» de las pantallas
clásicas y el editor de cortes apuntan a `/estudio/`. `/ui/nueva?pantalla=inicio`
la borra.

### Rutas por nivel: las direcciones del estudio

Desde el 22-oct-2026 el inicio es **una página por nivel** (detalle en
`docs/migracion/inicio.md` § «Rutas por nivel»). Las que existen:

| Dirección | Qué es |
|---|---|
| `/estudio/` | la principal: el mapa «Elige un área» |
| `/estudio/marketing/`, `/estudio/central/`, `/estudio/automatizaciones/` | las opciones de cada área |
| `/estudio/producto/`, `/estudio/ventas/` | «Todavía no está disponible.» (200) |
| `/estudio/marketing/distrito/`, `…/blotato/`, `…/avanzado/` | las listas de Marketing |
| `/estudio/central/distrito/`, `/estudio/central/deepseek/` | las de Central (Deepseek: «Todavía no está disponible.») |
| `/estudio/automatizaciones/distrito/`, `/estudio/automatizaciones/tus/` | las de Automatizaciones (Tus automatizaciones: «Todavía no está disponible.») |
| `/estudio/marketing/distrito/imagen/`, `…/video/`, `…/edicion/` | la caja, en cada pestaña |

Las hojas (Agenda, COI, el Constructor…) siguen en `/estudio/<p>/`. El HTML de
todas se sirve **sin sesión** (lo que pide entrar es la primera llamada a
`/api/`), así que un `curl` sin cookie basta para comprobarlas.

**Lo que redirige**, siempre con un **302 relativo** (el `location` va sin
dominio, así que sirve igual detrás de API Gateway y de Cloudflare: la app nunca
arma una URL absoluta con un Host que no es el de afuera), con
`cache-control: no-store` y el query intacto. 302 y no 301: un 301 se queda para
siempre en la caché del navegador.

| Lo que llega | A dónde va |
|---|---|
| `/estudio/inicio/` y `/estudio/inicio` (la página única de antes), con o sin query | `/estudio/` con el mismo query |
| `/estudio/?prompt=…` | `/estudio/marketing/distrito/imagen/?prompt=…` |
| `/estudio/?brief=…` | `/estudio/marketing/distrito/video/?brief=…` |
| `/estudio/?blotato=conectar` (lo mandan el editor de cortes y Agenda, Métricas y MIX clásicas) | `/estudio/marketing/blotato/?blotato=conectar` |
| `/estudio/` con otro query (`?p=`, `?desde=…&ver=…`) | no redirige: 200, el mapa |
| una dirección sin barra o en mayúsculas (`/estudio/marketing`, `/estudio/Marketing/`, `/ESTUDIO`) | su forma normal (`/estudio/marketing/`) |
| `/index.html` | `/estudio/`, salvo la cookie `ui=clasica` (la clásica) |
| `/estudio/` con la cookie `ui=clasica` (o sin `web/dist`) | `/index.html` con el mismo query: la clásica |

Una dirección que no existe bajo `/estudio/` da **404**: con `Accept: text/html`
(un navegador), una página mínima «No encontramos esa página» con «Subir un
nivel» e «Ir al inicio»; sin él, el 404 JSON de siempre. Detrás de API Gateway
una dirección escrita con `%XX` no se corrige (Mangum no pasa la ruta cruda): se
sirve tal cual y la página la entiende igual.

**Comprobarlo contra dev** después de cada deploy que toque `server/web.py`,
`server/migracion.py` o `web/estudio/` (`<ApiUrl de dev>` es el output `ApiUrl`
de `aws-media-api-dev`, con su `https://`). La principal:

```bash
curl -s -D - -o /dev/null "<ApiUrl de dev>/estudio/" | grep -iE "^HTTP|cache-control"
```

Lo esperado: `200` y `cache-control: no-cache`. La página única de antes:

```bash
curl -s -D - -o /dev/null "<ApiUrl de dev>/estudio/inicio/?x=1" | grep -iE "^HTTP|^location|cache-control"
```

Lo esperado: `302`, `location: /estudio/?x=1` (relativa: si sale con
`https://…` delante, algo cambió) y `cache-control: no-store`. Las entradas de
antes:

```bash
curl -s -D - -o /dev/null "<ApiUrl de dev>/estudio/?prompt=hola" | grep -iE "^HTTP|^location"
curl -s -D - -o /dev/null "<ApiUrl de dev>/estudio/?blotato=conectar" | grep -iE "^HTTP|^location"
```

Lo esperado: `302` con `location: /estudio/marketing/distrito/imagen/?prompt=hola`
y `location: /estudio/marketing/blotato/?blotato=conectar`. Sin barra:

```bash
curl -s -D - -o /dev/null "<ApiUrl de dev>/estudio/marketing" | grep -iE "^HTTP|^location"
```

Lo esperado: `302` y `location: /estudio/marketing/`. El 404 con página:

```bash
curl -s -D - -o /dev/null -H "Accept: text/html" "<ApiUrl de dev>/estudio/nada/" | grep -iE "^HTTP|content-type|^vary"
```

Lo esperado: `404`, `content-type: text/html; charset=utf-8` y `vary: Accept`
(sin el `-H`, el mismo 404 en `application/json`). Lo mismo vale contra
`https://irremplazables.xyz` cuando el corte llegue a `main`.

**Pruebas de navegador (Playwright; no corren en CI):** `cd web && npm run e2e` compila y las corre todas; para una sola,
`npm run build && npx playwright test e2e/niveles.spec.ts --workers=2`.
`web/e2e/servidor.mjs` repite en Node lo que deciden `server/web.py` (las páginas por nivel, la barra, las mayúsculas, el
`//` y el `%XX`, las entradas de antes, el 404 con página para quien pide HTML) y `server/migracion.py` (`/index.html`, la
cookie `ui=clasica` también en `/estudio/`, `/ui/clasica` y `/ui/nueva`, las pantallas `retirada`): una página se sirve solo si su
dirección es una del registro de `dist`. `tests/test_web_rutas.py` exige que sus tablas y el texto del 404 sean los de Python y,
con Node, pasa las mismas peticiones por los dos y compara estado, `Location` y la cara del 404. Lo único que NO repite son las
cabeceras de lo servido (todo sale `no-store`, no `no-cache` con ETag). Si `web.py` o `migracion.py` cambian, ése también.
La guarda del doble clic se prueba con `Date.now()` de la página quieto (`relojFijo`, `web/e2e/recorrido.ts`): con el reloj de
verdad el resultado dependía de la velocidad de la máquina. Hay dos pruebas intermitentes que vienen de antes de las rutas por
nivel (se repiten igual con el `servidor.mjs` anterior): `inicio-edicion.spec.ts` «toda la caja se recorre solo con el teclado» a
veces agota `page.waitForEvent('filechooser')` (1 de 16 con 4 trabajadores; una revisión la vio también en `29344bb`, 1 de 12), y
las de `asistente.spec.ts` que usan `page.clock.install()` más `fastForward(5000)` a veces no encuentran el título del resultado
para enfocarlo (1 de 64, en pruebas distintas cada vez). Una tercera, también de antes: `biblioteca.spec.ts` «axe, estado por
estado › a 1100 px › sin resultados, «Míos» vacío…» a veces ve `color-contrast` en `.bg-ambar` justo después de pasar a «Míos»
(4 de 5 con el `dist` y el `servidor.mjs` de `9666380`; a 390 y 320 px pasa). En esta máquina la del teclado de
`inicio-edicion.spec.ts` falló más (2 de 4 solas, también en `9666380`). Antes de darlas por rotas, repetirlas solas con
`--workers=1` y compararlas con un worktree de la base.

## La imagen (Node, y por qué está fijado)

Node entra en la imagen **copiado de la imagen oficial** y con la versión exacta
escrita en el Dockerfile:

```dockerfile
COPY --from=node:20.20.2-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:20.20.2-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
```

### Qué pasó el 14 de septiembre de 2026

Antes se instalaba con `curl https://deb.nodesource.com/setup_20.x | bash -`. Ese
día el curl murió a mitad de un build («Recv failure: Connection reset by peer»)
y **el build no se detuvo**: el script de NodeSource anuncia sus fallos y sale
con cero —literalmente `Error: Failed to download and import the NodeSource
signing key (Exit Code: 0)`—, así que el `&&` siguió y apt instaló el nodejs de
Debian, 18.20.4. En Debian npm es un paquete aparte y solo «recomendado», y el
Dockerfile instala con `--no-install-recommends`, así que npm no entró. El build
murió cuatro pasos después con `npm: not found`.

**Que muriera fue la suerte, no el diseño.** Si npm hubiera entrado igualmente,
la imagen se habría construido entera con Node 18 —Remotion 4 arranca en 18— y
nadie se habría enterado. La versión de Node de producción dependía de si una
descarga de un tercero funcionaba ese día.

### Los dos seguros

1. **En el Dockerfile**, justo después de copiar Node: `node --version && npm
   --version && npx --version` más un `case` que exige la línea `v20.*`. Si algo
   no queda como se espera, el build muere ahí y dice por qué.
2. **En el CI**, el paso «Runtimes de render presentes» pregunta también por
   `npm`. Antes preguntaba por node, ffmpeg y chromium — npm era justo el que
   faltaba.

`tests/test_imagen_node.py` fija las dos cosas y corre en el primer paso del CI,
antes del build, para fallar en segundos y no en minutos.

### Si el build vuelve a fallar por Node

No es un fallo de red que se arregle reintentando: ya no hay descarga. Mira qué
dice el gate. Para subir de versión, cambia **las dos** líneas `COPY --from=` a
la vez (hay un test que impide que queden en versiones distintas) y el `v20.*`
del `case`.

### Pendiente: Node 20 está fuera de soporte

Terminó su mantenimiento el **30 de abril de 2026** — ya no recibe parches de
seguridad. Node 22 va hasta abril de 2027. No se subió junto al arreglo de
arriba a propósito: cambiar la major cambia el runtime con el que Remotion
renderiza, y eso se valida con un render real, no con el CI.

## ECR (ciclo de vida de las imágenes)

El repositorio `aws-media` conserva las **30 imágenes más recientes** y expira el
resto. La política vive en `infra/ecr-lifecycle.json`.

**11-oct-2026: de 20 a 30.** El repositorio tenía 21 imágenes y la de producción
(`c970e23…`) era la 12.ª más nueva: aguantaba 8 fusiones más a `dev` y la 9.ª la
expiraba, con el release a producción detenido. Subir el número compra margen; no
arregla el fondo (ver «El riesgo real»). Se aplica con el procedimiento de abajo: el
CI no la aplica, la aplica una persona.

### Por qué hace falta

Medido el 14 de septiembre de 2026: **86 imágenes, 122 GB**, ninguna sin tag. Era
el **43% de la factura** de AWS y crecía con cada merge a `main`.

Y crecía de verdad, no en apariencia: **dos builds consecutivos solo comparten 4
de sus 17 capas — 48 MB de 1.664.** El CI no cachea capas de Docker, así que cada
build reconstruye todo desde cero y sube ~1,6 GB genuinamente nuevos. Al ritmo de
merges de estos días, unos 4,8 GB al día.

Con la política de 20, el repositorio se estabilizaba en ~33 GB; con 30 son ~50 GB (30 × ~1,6 GB), en vez de subir sin techo.

### El riesgo real, que no es el número

**Las Lambdas apuntan a un digest, no a un tag.** Si la imagen que corre
producción cae fuera de las 30 más recientes y se expira, la función deja de
poder arrancar contenedores nuevos.

Treinta son unos diez días de margen al ritmo de septiembre (~3 imágenes al día) y
unos seis al de los días con trabajo (~5 al día). El peligro no es que el
número sea bajo: es **dejar pasar 30 merges sin desplegar**. Ya ha pasado estar
tres PRs por detrás. Para saber cuánto margen queda hoy: cuenta las imágenes
más NUEVAS que la de producción (`aws ecr describe-images`, ordenadas por
`imagePushedAt`); la de producción se expira cuando esa cuenta llega a 30.

### Antes de tocar nada: el preview

ECR sabe decir qué borraría sin borrarlo. Úsalo siempre, también al cambiar el
número:

```bash
aws ecr start-lifecycle-policy-preview --repository-name aws-media --lifecycle-policy-text file://infra/ecr-lifecycle.json
```

```bash
aws ecr get-lifecycle-policy-preview --repository-name aws-media --query "summary" --output json
```

Y el chequeo que importa — que ninguna de las imágenes vivas esté en la lista:

```bash
venv/Scripts/python tools/ecr_preview.py
```

Compara el resultado del preview contra los digests que corren ahora mismo la
Lambda del API, la del worker y la task definition de Fargate. Si alguno aparece
en la lista de expiración, **no apliques**: despliega primero, o sube el número.

### Aplicarla

Esto sí borra, y no se deshace:

```bash
aws ecr put-lifecycle-policy --repository-name aws-media --lifecycle-policy-text file://infra/ecr-lifecycle.json
```

ECR la evalúa cada 24 horas, así que el borrado no es instantáneo. Para ver qué
política está aplicada:

```bash
aws ecr get-lifecycle-policy --repository-name aws-media --query "lifecyclePolicyText" --output text
```

### La causa de fondo sigue ahí

La política limpia; no evita que cada build suba 1,6 GB. Eso se arregla con cache
de capas en el CI (`cache-from` / `cache-to` sobre el propio ECR), que además
recortaría los 162 segundos del build — 56 de ellos son el `pip install`. Queda
pendiente; toca `.github/workflows/docker.yml` y los tests que fijan los nombres
de sus pasos.

## Base de datos (Aurora)

ARNs del stack `aws-media-db` (también salen en sus outputs de CloudFormation):

- cluster: `arn:aws:rds:us-east-1:191241816158:cluster:aws-media-db-db5d02a0a9-luualrjywhm7`
- secret: `arn:aws:secretsmanager:us-east-1:191241816158:secret:DbSecretCF6D79B0-OCMXnjHbEOrM-LAYvNT`

```bash
venv/Scripts/python tools/db_migrate.py --cluster-arn arn:aws:rds:us-east-1:191241816158:cluster:aws-media-db-db5d02a0a9-luualrjywhm7 --secret-arn "arn:aws:secretsmanager:us-east-1:191241816158:secret:DbSecretCF6D79B0-OCMXnjHbEOrM-LAYvNT"
```

Los cuatro tools (`db_migrate`, `usuarios`, `creditos`, `costes`) cargan el
`.env` del repo — con `DB_CLUSTER_ARN`/`DB_SECRET_ARN` ahí (ya están en el
del dueño), los flags `--cluster-arn/--secret-arn` sobran.
Gotcha: desde el 21-sep el clúster de producción tiene suelo de 0.5 ACU y NO se
auto-pausa (infra/stacks/db.py). El de dev (`aws-media-db-dev`) sí: suelo de 0 ACU
y auto-pausa a los 5 min sin uso. Ahí (o en prod, si algún día vuelve a 0 ACU) la
primera llamada tras un rato puede tardar ~25 s o dar 503/timeout; reintenta. Con
`db_migrate` el despertar de dev puede pedir **1–2 min entre reintentos**
(`DatabaseResumingException`): ver «Deploy del entorno dev».

### Que los datos sobrevivan

Aquí viven los proyectos, los saldos y los movimientos de créditos. **No hay otra
copia**: ni réplica, ni export periódico, ni un segundo entorno. Desde el 14 de
septiembre de 2026 hay tres guardas, y cada una cubre un camino distinto:

| guarda | de qué protege |
|---|---|
| `DeletionProtection: true` | un `delete-db-cluster` por CLI o un clic en la consola |
| `DeletionPolicy: Snapshot` | un `cdk destroy` del stack |
| backups de 7 días | un error de datos que se detecta días después |

Las dos primeras **no son la misma cosa**, y es el malentendido caro: la política
de CloudFormation solo actúa cuando el borrado pasa por CDK. RDS obedece igual a
quien llame a su API directamente, y ese camino no pasa por CloudFormation. Las
tres viven en `infra/stacks/db.py` y `tests/test_db_protegida.py` las fija.

#### Snapshot manual

Antes de una migración, de un cambio de esquema o de cualquier cosa que dé
respeto:

```bash
aws rds create-db-cluster-snapshot --db-cluster-identifier aws-media-db-db5d02a0a9-luualrjywhm7 --db-cluster-snapshot-identifier aws-media-manual-AAAA-MM-DD --region us-east-1
```

```bash
aws rds describe-db-cluster-snapshots --db-cluster-identifier aws-media-db-db5d02a0a9-luualrjywhm7 --snapshot-type manual --region us-east-1 --query "DBClusterSnapshots[].{Id:DBClusterSnapshotIdentifier,Estado:Status,Creado:SnapshotCreateTime}" --output table
```

Los manuales **no caducan**: viven hasta que los borres, al margen de la ventana
de 7 días. El primero es `aws-media-manual-2026-09-14`.

#### Hasta dónde se puede volver

```bash
aws rds describe-db-clusters --db-cluster-identifier aws-media-db-db5d02a0a9-luualrjywhm7 --region us-east-1 --query "DBClusters[0].{Desde:EarliestRestorableTime,Hasta:LatestRestorableTime}" --output table
```

**Gotcha:** `LatestRestorableTime` no avanza mientras el clúster está
auto-pausado (hoy producción no se pausa: suelo de 0.5 ACU; aplica a un clúster
con mínimo 0) — sin transacciones no hay puntos nuevos que crear. Verlo horas
atrasado es lo normal si nadie ha usado el producto en toda la mañana; no
significa que los backups estén rotos.

#### Si hay que restaurar

Restaurar **no devuelve el clúster a un estado anterior: crea uno nuevo**, con
otro identificador y otro ARN. La aplicación y los cuatro tools apuntan al ARN
del actual (`DB_CLUSTER_ARN` en `.env`, y el stack en CDK), así que una
restauración de verdad son tres pasos: restaurar, apuntar todo al clúster nuevo,
y solo entonces retirar el viejo. No es un comando; planea un rato.

#### Para borrarlo de verdad

La protección es deliberadamente incómoda. Hay que quitar `deletion_protection`
en `infra/stacks/db.py`, desplegar ese cambio, y solo después borrar. Si algún
día hace falta, ese rodeo es exactamente la pausa que se busca.

## Stripe

- Los 3 Payment Links viven en `.env` como `STRIPE_LINK_100/550/1200` y el
  `whsec_` como `STRIPE_WEBHOOK_SECRET`; suben a SSM con:

```bash
venv/Scripts/python tools/ssm_env.py
```

- Webhook (test Y live por separado): endpoint
  `https://irremplazables.xyz/api/pagos/stripe`. El del `execute-api` sigue
  funcionando: **se agrega el nuevo antes de quitar el viejo, nunca al revés**
  — un webhook mal apuntado no da error visible, solo pagos que no se abonan.
  Evento: `checkout.session.completed`. Un pago que no abona casi siempre es
  el webhook del modo equivocado (revisar requests en CloudWatch).
- Pago raro (sin usuario, monto sin pack) → queda 200 con ERROR en CloudWatch
  → abonar a mano con `creditos.py abonar --tipo compra --ref <session_id>`.

## COI y la Biblioteca de prompts (Ajustes 3)

Dos herramientas de **Central › Distrito**, las dos con login y las dos en
`server/` (`coi_api.py`, `biblioteca_api.py`):

| ruta | qué hace |
|---|---|
| `GET /api/coi/estado` | cuántas respuestas lleva hoy la persona, cuántas le quedan y cuándo se renuevan |
| `POST /api/coi` | `{"texto": "…"}` → el **COI** (Contexto · Objetivo · Instrucciones): el modelo responde UNA vez con tres bloques |
| `GET /api/biblioteca` | todo en una carga: categorías, «De la casa», «Míos» de la persona y su top 3 fijado |
| `PUT /api/biblioteca/fijados` | REEMPLAZA el top 3 fijado (el orden importa). Con `esperada` (la lista que la pantalla cree vigente) solo escribe si nadie la cambió desde entonces; si no, 409 `cambiaron` |
| `POST /api/biblioteca/mios` | guarda un COI en «Míos» (botón «Guardar»; la `clave` evita el doble clic) |
| `DELETE /api/biblioteca/mios/{id}` | borra uno de «Míos» (y lo quita de los fijados) |

### Las reglas de COI

- **Gratis para la persona (0 créditos), 3 respuestas por día**, y el día es el de
  **México** (`America/Mexico_City`; se renueva a las 12:00 a. m. de allá). El día se
  calcula **en la base** (una sola fuente de tiempo): el navegador no manda su reloj.
- **Solo cuentan las respuestas terminadas.** Si el modelo falla, se pasa de tiempo, la
  moderación rechaza el texto o no se pudo sumar, **no se gasta ninguna**. «Terminada» es
  `finish_reason == "stop"` con texto: cualquier otro motivo de fin (`length`, `content_filter`,
  ninguno) es una respuesta incompleta (502 `modelo`, no suma) y un pedazo de COI no se entrega.
- **Los intentos que no cuentan tienen su propio tope: 20 por persona y día de México**
  (`MAX_FALLOS_DIARIOS` en `pipeline/coi.py`, columna `fallos` de `coi_estado`). Cada uno costó una
  llamada al proveedor aunque no gastara un uso, y sin tope bastaba repetirlos para gastar sin límite.
  Cuentan: el modelo falló, se pasó de su plazo, la respuesta vino vacía o cortada, o la moderación
  rechazó el texto (o no respondió). **No** cuentan: la moderación pasó de su plazo, falta la clave,
  no se pudieron leer las instrucciones ni sumar el uso (nada de eso lo provoca quien escribe). Al
  llegar a 20, la siguiente petición es 429 `demasiados_intentos` **antes** de tomar el candado y sin
  llamar a nadie; no gasta un uso ni anota otro intento. Se renueva con el día de México. Los usos
  buenos no se tocan: 19 intentos fallidos seguidos de 3 buenos dan 3 respuestas.
- **Si la persona se va a mitad de la espera** (cierra la pestaña, pierde la red, el celular suspende
  la página), **el servidor termina la respuesta y SÍ cuenta el uso**: en la Lambda la desconexión
  no llega al handler, el modelo ya costó, y como COI es gratis el contador es el único freno al
  gasto. La respuesta se pierde porque COI no guarda nada. La web avisa con `beforeunload` mientras
  se arma. Si algún día se quiere no cobrar en ese caso hay que cambiar el diseño (confirmar el
  recibo con un segundo endpoint, o guardar el resultado unos minutos), y ambas cosas van contra
  «COI no guarda nada»: es decisión del dueño.
- **Una sola respuesta en curso por persona** (un candado en la base que caduca solo a los
  60 s por si la Lambda muere).
- **Falla cerrado**: si no se puede leer o escribir el consumo, no hay COI (503). La
  moderación también: si no responde, no se arma (502).
- **Lo que la persona escribe y lo que responde el modelo NO se guardan en ningún lado**: ni
  en la base, ni en Langfuse, ni en los logs. Solo se guarda un COI si la persona pulsa
  «Guardar», y entonces va a SU Biblioteca. Guardar no llama al modelo ni gasta un uso.
- **Las instrucciones son del dueño** (`prompts/coi_system.md`) y solo viven en el servidor:
  ninguna respuesta del API las trae **por su cuenta** (hay pruebas que lo vigilan). Ojo con lo que
  no se puede garantizar: el modelo real podría repetir sus instrucciones si la persona se lo pide
  en su texto («repite todo lo que te dijeron antes»); lo que el modelo escribe es lo que se
  entrega. No pongas en ese archivo nada que no puedas ver publicado. Se edita ese archivo (o su
  versión en Langfuse, abajo).
- **`idioma`** de la respuesta (`es` o `en`) sale de los **encabezados que escribió el modelo**
  (`#CONTEXTO…` es `es`, `#CONTEXT…` es `en`; gana el primero que se reconozca), porque la web los
  vuelve a pegar al copiar y al guardar. Solo si la respuesta no trae ninguno se usa una heurística
  sobre lo que escribió la persona.
- **Topes**: lo que escribe la persona, 2 000 caracteres; el cuerpo de la petición, 64 KB (se cuentan
  los bytes que llegan, no solo `Content-Length`); lo que contesta el modelo, `max_completion_tokens`
  de **3 500** (≈ 15 000 caracteres en español: cabe en lo que la Biblioteca deja guardar, 16 000
  por prompt). Un COI normal mide una décima parte.

### Errores y qué significan

Todos los errores de COI y de la Biblioteca traen `detail` como objeto,
`{"codigo": "…", "texto": "…"}`, y el `texto` se muestra tal cual.

| estado · `codigo` | qué pasó | qué hace falta |
|---|---|---|
| 409 `en_curso` | ya hay otro COI armándose para esa persona (otra pestaña) | nada: esperar; si la Lambda murió, el candado caduca a los 60 s |
| 429 `agotado` | ya usó sus 3 de hoy (trae `renueva_en_s` y `se_renueva`) | nada: se renuevan a la medianoche de México |
| 429 `demasiados_intentos` | 20 intentos del día que no terminaron (ver «Los intentos que no cuentan»). Trae lo mismo que `agotado` (`tope`, `usos`, `quedan`, `renueva_en_s`, `se_renueva`) pero con los usos **reales**: todavía tiene los suyos | nada: se renueva a la medianoche de México y no se gastó ningún uso. Si es un reclamo, mira `fallos` en `coi_estado` y el log `coi: el modelo falló` |
| 422 `moderacion` | la moderación frenó el texto (trae el `motivo`, nunca el texto) | nada; no se gastó ningún uso |
| 422 `vacio` / `muy_largo` / `cuerpo` | el texto va vacío, pasa de 2 000 caracteres (o el cuerpo de 64 KB) o el cuerpo no es un JSON válido | nada |
| 422 `texto_invalido` | el texto trae un NUL (`\u0000`) o un sustituto UTF-16 suelto (`\ud800` a `\udfff`), que no son texto | nada: suele venir de pegar desde otro programa; el `texto` se muestra tal cual |
| 502 `modelo` | el modelo falló, la respuesta vino vacía o cortada por el tope de tokens, o la moderación no respondió | mirar el log (`coi: el modelo falló (clase, estado)`): clave, saldo o cuota del proveedor |
| 504 `tardo` | el modelo (o la moderación) pasó de su plazo | ver «El límite conocido» |
| 503 `no_disponible` | no se pudo leer o escribir el consumo, falta `OPENAI_API_KEY`, o no se pudieron leer las instrucciones | **lo primero: ¿corriste la migración?** Luego el log `coi: …` |
| 503 `no_nube` | se llamó en local sin Postgres (`STATE_BACKEND` ≠ `postgres`). Aplica a COI y a `PUT`, `POST` y `DELETE` de la Biblioteca; **`GET /api/biblioteca` en local responde 200** con «De la casa» y «Míos» y fijados vacíos | usar el servicio |
| 422 `demasiados` / `repetido` / `desconocido` | fijados: más de 3, un id repetido, o un id que no es de la casa ni un «mío» de esa persona | nada |
| 409 `cambiaron` | `PUT /api/biblioteca/fijados` con `esperada` (la lista que la pantalla creía vigente) que ya no coincide con lo guardado: otra pestaña o aparato cambió los fijados. Trae `fijados` (la lista vigente) y **no escribe nada** | nada: la pantalla adopta esa lista y lo dice. Sin `esperada` el `PUT` reemplaza como siempre |
| 422 `titulo_vacio` / `prompt_vacio` / `categoria` / `etiquetas` / `origen` / `clave` / `muy_largo` | `POST /api/biblioteca/mios` («Guardar»): título o prompt vacíos; categoría fuera de las cuatro; más de 3 etiquetas o de más de 24 caracteres; `origen` distinto de `coi`; `clave` que no son 32 caracteres hexadecimales; o un campo sobre su tope (`muy_largo` trae `campo` y `max`: título 80, descripción 160, prompt 16 000) | nada: el `texto` ya dice qué corregir. La web los evita, así que verlos apunta a otro cliente o a una web desactualizada |
| 422 `titulo_invalido` / `prompt_invalido` / `para_que_invalido` / `etiquetas_invalido` | «Guardar» con un NUL o un sustituto suelto en ese campo (trae `campo`). Antes salía como 503 «no disponible» | nada: el `texto` se muestra tal cual |
| 409 `lleno` | 100 prompts en «Míos» | borrar alguno (borrar siempre se puede) |
| 404 `no_es_tuyo` | borrar un «mío» que no existe o es de otra persona (no se distingue) | nada |

Un error 5xx de COI **nunca** descuenta un uso. Si alguien reclama «me gastó uno», se
comprueba en la base sin ver texto alguno:
`SELECT usuario, dia, usos, fallos, en_curso_hasta FROM coi_estado WHERE usuario = '<sub>';`

### Antes de desplegar: la migración es OBLIGATORIA en cada entorno

Hay tres tablas nuevas (`coi_estado`, `biblioteca_mios`, `biblioteca_fijados`, más el índice
único parcial `biblioteca_mios_clave`). El código nuevo falla sin ellas: **COI responde 503
`no_disponible` y la Biblioteca 503 completa** (ni «De la casa» sale). Corre, en **dev y en
prod, cada uno con sus ARNs**, ANTES del `cdk deploy` (paso 4 del checklist de «Deploy»):

```bash
venv/Scripts/python tools/db_migrate.py
```

Es idempotente (`IF NOT EXISTS`). Desde esta entrega `db_migrate` termina con error si, tras
correr, falta alguna tabla del esquema. No se borra ni se toca ninguna fila existente.

`coi_estado` lleva además la columna `fallos` (los intentos del día que no contaron). En un entorno
donde la tabla ya existía la agrega el mismo `db_migrate`
(`ALTER TABLE IF EXISTS coi_estado ADD COLUMN IF NOT EXISTS fallos …`): **sin esa migración el código
nuevo no puede leer el estado y COI responde 503**.

### Los prompts: `prompts/coi_system.md` y Langfuse

El archivo cae en la regla de siempre (paso 3 del checklist): `tools/prompts_sync.py` lo
siembra en Langfuse con el nombre `coi_system`. En **producción** (`LANGFUSE_PROMPTS=1`) se
lee la versión `production` de Langfuse y, si Langfuse no responde o el prompt no existe
allá, **se usa el archivo** (así que COI funciona aunque nadie haya sembrado). En **dev**
local no hay claves de Langfuse y siempre se lee el archivo. Sembrar copia las instrucciones
a TU proyecto de Langfuse (privado); lo que no hace nadie es mandarlas al navegador.

### Los 14 de muestra y cómo los cambia el dueño: `server/biblioteca_casa.json`

«De la casa» sale de ese archivo, que es **estático y solo de lectura** (su almacén es
propio: nada que ver con `prompts/`). Los 14 que trae son **de muestra**; se reemplazan
editando el archivo y desplegando (viaja dentro de la imagen y se lee una vez por proceso).
Reglas (están también en el comentario del propio archivo):

- `id` único y **estable**, con forma `casa-<palabras-con-guiones>`. Si cambias un `id`, a
  quien lo tenía fijado se le cae el pin (los fijados que ya no existen se omiten solos).
- `titulo` de 1 a 80 caracteres, `para_que` de hasta 160, `prompt` de 1 a 16 000.
- `categoria`: `imagen`, `video`, `guion` o `investigacion`. Hasta **3 etiquetas** de hasta
  24 caracteres.
- `lleva_a`: `"imagen"` si la categoría es imagen, `"video"` si es video y `null` en guion e
  investigación (esos dos solo se copian). Los de imagen y video llevan sus `[corchetes]`
  para lo que la persona cambia, y miden hasta 1 800 caracteres (más largos no se pueden
  llevar a la caja por la dirección).
- El orden de la lista es el orden en pantalla.

Antes de desplegar: `venv/Scripts/python -m pytest tests/test_biblioteca_casa.py`. Las pruebas
solo revisan la **forma** (ids únicos, categorías, largos, `lleva_a`, etiquetas): no fijan cuántos
prompts hay ni cuáles, así que agregar, quitar o reemplazar no obliga a tocarlas. Si aun así se cuela
un error, el API se queda con los prompts válidos y deja el motivo en el log
(`biblioteca: biblioteca_casa.json: #3 (…): …`); un JSON roto deja «De la casa» vacía y el log dice
el motivo y el lugar (`no es un JSON válido: Invalid control character … (línea 41, columna 18)`).
El archivo puede estar guardado con o sin BOM (los editores de Windows lo agregan): se lee como
`utf-8-sig`. Lo que sí rompe es otra codificación (el log lo dice: «no está guardado como UTF-8»).

### Variables de entorno

| variable | por defecto | qué hace |
|---|---|---|
| `COI_MODELO` | el modelo del producto (`OPENAI_MODEL`) | qué modelo arma el COI. Si no está en `tools/pricing.json` el costo del log sale `None` |
| `COI_RAZONAMIENTO` | `minimal` | el esfuerzo de razonamiento (lo más bajo que acepta el modelo). `ninguno` o vacío = no se manda el parámetro (modelos que no lo aceptan). Si la API lo rechaza con un 400, se reintenta UNA vez sin él y queda un `warning` en el log |
| `OPENAI_API_KEY` | — | la clave de plataforma (SSM `/env`). Sin ella: 503 `no_disponible` |

### Cuánto cuesta cada uso (con tokens reales)

COI es gratis para la persona pero **no para el dueño**. Cada respuesta terminada deja UNA
línea en el log (CloudWatch, busca `coi: respuesta terminada`) con el modelo, los tokens
de entrada y de salida, los que vinieron de caché, los milisegundos y el costo:

```
coi: respuesta terminada · modelo=… · entrada=1500 · salida=700 · en_cache=1000 · ms=9800 · costo_usd=0.00155
```

El costo sale de los tokens que devolvió la API y de la tarifa de `tools/pricing.json`
(§`rag.modelos`, dólares por millón de tokens: entrada 0.25, entrada en caché 0.025, salida
2.00; la dio el dueño el 15-oct-2026). Los tokens en caché se cobran con su precio y no con
el de entrada. En el ejemplo de arriba: 500 × 0.25 + 1 000 × 0.025 + 700 × 2.00, entre un
millón = 0.00155 dólares. Con el tope de 3 al día, una respuesta terminada típica como la de
arriba deja unos 0.005 dólares diarios por persona. Si el modelo no está en la tarifa, `costo_usd`
sale `None`: se agrega la fila, nunca se inventa un precio. El log **no lleva** el texto de
entrada ni el de salida, y los errores se loguean por su clase y su estado, nunca por su mensaje.

**El techo de verdad** incluye los intentos que no cuentan. Un intento que se corta por el tope de
3 500 tokens de salida cuesta, como máximo, 3 500 × 2.00 + 1 500 × 0.25 (los 1 500 tokens de
entrada del ejemplo), entre un millón = 0.007375 dólares con la tarifa de arriba. Con 20 de esos al día más las 3 respuestas terminadas
son 23 llamadas: unos **0.17 dólares diarios por persona** como techo absoluto. Sin el tope de
intentos no había techo: con el candado y el plazo de 24 s, una sola cuenta podía pasar de 1
dólar por hora.

La moderación de COI (`moderar (sin trazas)` en el log, con sus tokens de entrada y de salida) pide
el mismo esfuerzo mínimo de razonamiento que COI (`COI_RAZONAMIENTO`): es una clasificación corta y,
con el razonamiento por defecto del modelo, podía pasar de sus 8 s y dar un 504 que no era. Su costo
no se suma al `costo_usd` de COI (son unos cientos de tokens); si algún día importa, sale de esas
líneas del log.

> No subas el nivel de log a `DEBUG` ni exportes `OPENAI_LOG=debug` en producción: el SDK de
> OpenAI escribe el cuerpo completo de cada petición a ese nivel, y ahí viaja lo que la
> persona escribió. El API arranca en `INFO` (`server/app.py`) y hay una prueba que lo vigila.

### Por qué COI no usa el cliente de siempre

El cliente de OpenAI del producto pasa por Langfuse, y **Langfuse parchea el método
`create` del SDK de TODO el proceso en cuanto se importa** (no solo el de su cliente): en una
Lambda tibia, hasta un cliente «pelón» de OpenAI quedaría trazado, con el texto entero de
entrada y de salida. Por eso `llm.chat_texto` y `moderacion.revisar(sin_trazas=True)` llaman
a la función original que ese parche guarda. `tests/test_coi_guardianes.py` lo vigila con el
parche de Langfuse activo y su `get_client` convertido en espía.

### El límite conocido: la Lambda corta a 29 s

API Gateway corta a los 30 s y la Lambda a los 29. Por eso: la moderación tiene tope de 8 s,
el modelo de **24 s** y el total de **27 s** (lo que gaste la moderación se le resta al
modelo), y al modelo se le **guardan 3 s** (`MARGEN_SUMAR_S`) para sumar el uso y responder: su
plazo es `min(24, 27 − 3 − lo ya gastado)`, así que con una moderación lenta de 5 s vence en el
segundo 24 como mucho y quedan 5 s. Si el modelo tarda más: 504 `tardo`, no se gasta ningún uso y
el candado se suelta.
Una respuesta larga que de verdad necesite más de 24 s no se puede dar hoy; la salida es
pasar a una cola (como las demás herramientas) y no se hizo en esta versión.

### Lo que NO está en esta versión

Editar un «mío», sugerir prompts, votar, crear uno a mano o compartirlos: no existen. Lo
único que escribe un prompt en «Míos» es el botón «Guardar» de COI.

### Pruebas

`pytest tests/test_coi_*.py tests/test_biblioteca_*.py` corre con dobles. El SQL nuevo (la
carrera del candado, el día de México, los fijados) se prueba contra un **Postgres 16 real**:
`COI_PG_SOCK=<directorio del socket> pytest tests/test_coi_postgres.py` (sin esa variable se
omite). Los dobles no cazan un error de sintaxis ni una carrera; esa prueba ya cazó un
`ORDER BY` ambiguo que los dobles dejaban pasar. Ahí viven también las carreras reales (16 hilos
por el candado, 12 por un compare-and-set de fijados, 8 pestañas con intentos que fallan), la lectura
de «Míos» con otra pestaña escribiendo entre página y página, y una prueba que revisa que ninguna
sentencia de COI ni de la Biblioteca lleve un `:` seguido de letra fuera de un parámetro (el
analizador del Data API de Aurora no se pudo probar contra literales como `'HH24:MI:SS'`: las
fechas se devuelven como números o `::text` y se formatean en Python).

## Guía de clases · admin (S1)

Primera rebanada de la Guía de clases (diseño en `docs/DISENO-GUIA.md`, sección 9; el resto de la guía es plan): el dueño crea las clases y
sube el video de cada una desde `/estudio/admin/` (pestaña «4 · Clases»). **No gasta dinero**: ninguna ruta
de aquí llama a AssemblyAI, Gemini ni OpenAI, y el servidor no escribe en S3 (el video lo sube el navegador
con una URL firmada). Código: `server/clases_admin_api.py`, `pipeline/clases.py` (límites y validación) y
`db.clases_*` en `pipeline/db.py`.

### Guía de clases: la migración es OBLIGATORIA en cada entorno

Hay dos tablas nuevas, `clases` y `clases_config`, y dos índices únicos parciales (`clases_clave` y
`clases_vivas`). Sin ellas **todas las rutas de `/api/admin/clases` responden 503 `no_disponible`** (el
resto de la app no se entera). La columna `clases.subida_token` (el token de cada subida, ver abajo) va en
el `CREATE TABLE` y, además, en un `ALTER TABLE IF EXISTS clases ADD COLUMN IF NOT EXISTS subida_token text`:
un entorno que ya creó la tabla con la primera versión de S1 recibe la columna al volver a correr la
migración (sin ella, la tabla existe pero **todas las rutas dan 503**: el `SELECT` pide una columna que no
hay). Corre, en **dev y en prod, cada uno con sus ARNs**, ANTES del `cdk deploy`
(paso 4 del checklist de «Deploy»):

```bash
venv/Scripts/python tools/db_migrate.py
```

Es idempotente. `db_migrate` detecta las tablas nuevas solo (cada una es una entrada de `ESQUEMA` que
empieza con `CREATE TABLE IF NOT EXISTS <nombre>`) y termina con error si tras correr falta alguna.
`clases_config` no la usa nadie todavía (S4 guardará ahí las palabras clave de la transcripción).

### Las rutas (solo el grupo `admin`; las demás cuentas reciben 403, sin token 401)

| ruta | qué hace |
|---|---|
| `GET /api/admin/clases?archivadas=0\|1` | `{clases, limites}`: las clases vivas por número, o las archivadas. Sin precios (llegan con S4) |
| `POST /api/admin/clases` | crea una clase en `borrador`. Idempotente por `clave` (el doble clic no duplica). El `numero` es único entre las clases vivas: 409 `numero_repetido` |
| `PATCH /api/admin/clases/{id}` | cambia `numero`, `titulo`, `resumen`, `grabada_en` o `liga`; `null` borra resumen y fecha |
| `POST …/{id}/subida` | `{archivo, content_type, bytes}` → `{url, content_type, expira_s, token}`. Pasa a `subiendo`. **La clave de S3 la decide el servidor** (`clases/<id>/video.<ext>`); la URL vale 15 min. El `token` (32 hex) identifica ESTA subida. El nombre del archivo acepta los espacios Unicode (el U+202F de las grabaciones de pantalla de macOS) y se guarda con un espacio normal; los controles, las barras y los invisibles se rechazan |
| `POST …/{id}/confirmar` | cuerpo opcional `{nombre?, token?}`. HEAD a S3: que exista, que no esté vacío, que sea de un tipo permitido y que pese lo declarado. Pasa a `subido`. Con `token` que no es el de la subida vigente: 409 `subida_cambio`, sin mirar S3 |
| `POST …/{id}/medir` | ffprobe sobre una URL firmada (8 s, un reintento) → `duracion_s`. Con `-protocol_whitelist https,tls,tcp,crypto -f mov,mp4` (ver «Lo que NO hace S1») |
| `POST …/{id}/cancelar` | cuerpo opcional `{token?}`. `subiendo` → `borrador`. Con `token` que no es el vigente: 409 `subida_cambio` y no se toca la clase |
| `GET …/{id}/video` | `{url, expira_s}`: vista previa del dueño, URL firmada de 2 h (nunca la del CDN) |
| `DELETE …/{id}` | **archiva** (borrado suave: pone `archivada_en`). No toca S3 ni cambia el estado |
| `POST …/{id}/restaurar` | deshace el archivado; 409 si otra clase viva ya tomó su número |

Estados: `borrador` → `subiendo` → `subido` (`procesando`, `lista` y `error` los escribirá S4). Cada cambio es
un comparar-y-cambiar en UNA sentencia: de dos subidas a la vez gana una y la otra recibe 409
`estado_no_permite`. Una clase archivada solo se puede ver, restaurar o archivar otra vez.
Los errores son `{codigo, texto}`; nunca llevan URLs firmadas, ARNs ni texto de nadie, y los logs solo
llevan el id de la clase y la transición.

**El token de la subida.** La clave de S3 es la misma para todas las subidas de una clase
(`clases/<id>/video.<ext>`), así que `confirmar` solo distingue una subida de otra por los bytes declarados. Para
que la subida huérfana de otra pestaña (el PUT sigue aunque el panel cambie de pestaña) no cancele ni confirme la
subida nueva, cada `POST …/subida` devuelve un `token` de 32 hex que el servidor guarda en `clases.subida_token`
(en la misma sentencia que pasa `borrador` → `subiendo`) y olvida al cancelar y al confirmar. La web lo manda en
`confirmar` y `cancelar` de SU subida; si no coincide con el guardado: 409 `subida_cambio` («Esa subida ya no es la
vigente: se empezó otra o se canceló. No se cambió nada.») y la clase no se toca. **Sin token** las dos rutas
siguen como siempre (la tarjeta que perdió su subida puede cancelarla); `confirmar` sobre una clase ya `subido`
devuelve la clase aunque traiga un token (doble clic). Un token que no tiene 32 hex es 422 `clave_invalida`. El
token nunca sale en la lista, en un log ni en un error.

### Límites (los entrega el servidor en `limites`; la web no copia ninguno)

| | |
|---|---|
| Video | `.mp4`, `.mov`, `.m4v` y `video/mp4`, `video/quicktime`, `video/x-m4v` (lista cerrada, las dos) |
| Tamaño | 1 byte a 5 GiB (un PUT de una sola parte). El tamaño NO queda firmado en la URL: `confirmar` lo compara con el HEAD |
| Duración | 60 s a 2 h: lo recalibra S5 y lo aplicará el costo de S4; `medir` guarda lo que mide |
| Título / resumen | 120 / 140 caracteres. Número: 1 a 999 |
| Liga | `https`, 500 caracteres o menos, sin usuario ni IP ni `localhost`. **Solo se guarda como referencia**: ningún código la descarga. `HOSTS_PERMITIDOS` (en `pipeline/clases.py`) está vacío: el dueño decide si se limita a ciertas plataformas |
| La lista | hasta 400 clases (`db.LIMITE_CLASES`) |

### Lo que NO hace S1, a propósito

- **No procesa ni cobra**: nada de transcripción, costo, trabajo, texto, publicar, palabras clave, cola, worker,
  embeddings ni la pantalla del alumno. Eso es S2 a S4.
- **No borra nada en S3.** El rol de la Lambda no tiene `s3:DeleteObject` a propósito y el bucket está versionado:
  archivar solo escribe `archivada_en`. Los objetos huérfanos (una subida cancelada que sí terminó) se quedan.
  Un test falla si cualquier código del servidor pide `delete_object`. La purga real, si algún día hace falta, es
  una CLI del dueño.
- **No hay «reemplazar video»**: se archiva la clase y se crea otra.
- **Los videos de `clases/` no los sirve el CDN, nunca.** `clases/` no está en `media_rutas.SERVIBLES_CDN` y
  `tests/test_cdn_lista_blanca.py` lo fija (la política del bucket y la lista de Python dicen lo mismo). Si
  `https://<cdn>/clases/<id>/video.mp4` no da 403, hay un error grave: avísale al dueño.
- **Ciclo de vida del bucket**: la regla de Glacier Instant Retrieval a los 10 días no tiene filtro de prefijo, así
  que `clases/` también pasa. Releer un video cuesta recuperación: **sin precio confirmado** (no está en
  `tools/pricing.json`). Decisión pendiente antes de S7; hoy no se cambia.
- **ffprobe** lee un archivo que sube un admin, no cualquiera, y elige el lector por el CONTENIDO: un «.mp4» que es
  un MPD de DASH le haría pedir otras URLs desde la Lambda (una petición ciega, también a la red interna). Por eso
  `medir` lo llama con `-protocol_whitelist https,tls,tcp,crypto -f mov,mp4` antes de `-i` (el parámetro `seguro`
  de `edicion_api._medir`, solo para las clases; el editor mide como siempre). `-f mov,mp4` es lo que frena a
  DASH (con ffmpeg 6.1.1 la lista de protocolos sola NO lo frena); la lista es la segunda capa (nada de `file:` ni
  `http:`). Un test corre el ffprobe de verdad contra servidores locales y exige 0 peticiones al señuelo;
  **lo que falta (S5) es repetirlo con el ffmpeg de la imagen (Debian bookworm, 5.1) y con el primer video real**:
  aquí se probó con ffmpeg 6.1.1.

### Prueba manual del dueño en dev

Crear una clase de ejemplo, subir un `.mp4` pequeño (y uno grande si tienes), «Medir», verlo con «Ver video»,
comprobar que `https://<cdn>/clases/<id>/video.mp4` da **403**, archivar y restaurar. Gasto: solo almacenamiento
de S3 (sin precio confirmado).

### Pruebas de las clases (S1)

`pytest tests/test_clases_admin.py tests/test_cdn_lista_blanca.py` corre con dobles (S3, ffprobe). Las pruebas de la
API corren dos veces con la misma batería: contra un doble de la base en memoria y, si hay Postgres, contra el SQL
real: `COI_PG_SOCK=<directorio del socket> pytest tests/test_clases_admin.py` (sin esa variable se omite la mitad
de Postgres; ver «COI y la Biblioteca de prompts» para levantar uno). Ahí viven también las carreras reales (16
hilos pidiendo la misma subida, 8 creando la misma clave, un número que otra transacción está tomando) y la
migración de una tabla `clases` que no tenía `subida_token`.

La variante Postgres necesita `psycopg`, que está fijado en la sección «# --- tests» de `requirements.txt`
(`psycopg[binary]`). En un venv que no lo tenga (armado antes de este cambio) solo se omite esa variante: las demás
pruebas (autorización, no-borrar-en-S3, validadores, ligas, CDN) corren igual, no se omite el archivo entero. La sección «ffprobe de verdad» del mismo archivo levanta servidores HTTPS
locales (necesita `ffprobe`, `ffmpeg` y `openssl` en el PATH; sin ellos se omite).

## El Asistente de Automatizaciones (modo prueba)

**Automatizaciones › Distrito › Asistente** (`/estudio/asistente/`): la persona cuenta qué quiere automatizar y la pantalla le
devuelve un flujo de n8n para descargarlo o abrirlo en el Constructor (`/estudio/constructor/`, cuyo código no hace pedidos al servidor: los scripts de la página, `auth.js`, `monedero.js` y `trabajos.js`, sí piden `/api/auth/config`, `/api/creditos` y `/api/trabajos`). Esta es la
**Fase A: el modo «prueba», que no gasta dinero**. El servidor no arma nada de verdad: devuelve un flujo de **ejemplo enlatado**, elegido por
las palabras del pedido. No hay modelo, base de datos, cola ni monedero en ese camino, y lo que la persona escribe no se guarda ni se
registra. El armado real (el RAG con Claude, que sí cuesta y sí guardaría texto de la gente) **no está construido**: es la Fase B, y todo
lo que exige está en «Para ir en serio (Fase B)», abajo. Código: `server/automatiza_api.py` (las rutas), `pipeline/asistente.py` (la
lógica pura: el modo, las muestras, el id y el reloj) y `media/library/n8n/muestras_prueba.json` (las muestras).

| ruta | qué hace |
|---|---|
| `GET /api/automatiza/config` | `{activo, modo, gratis, costo_creditos, largo_minimo, largo_maximo, cupo}`; con `activo: false` trae además `texto` (la frase para mostrar). En prueba: `activo: true`, `modo: "prueba"`, `gratis: true`, `costo_creditos: 0`, `cupo: null`. Los límites del pedido salen de `pipeline/publico.py` (hoy 20 a 1 500 caracteres): la pantalla no lleva los suyos |
| `POST /api/automatiza/armar` | `{"texto": "…"}` → **202** `{id, estado: "armando", modo, paso: "entender", costo_creditos}`. Lo que se escribió se descarta ahí mismo |
| `GET /api/automatiza/armar/{id}` | cómo va ese pedido; terminado, el flujo de n8n |

Las tres llevan sesión: `/api/automatiza/*` cae en `PREFIJOS_PROTEGIDOS` de `server/auth.py` (401 sin token) y la identidad es
`db.usuario_actual()` (el `sub`), que aquí solo sirve para saber QUIÉN pregunta. Están a propósito **fuera de `/api/publico/`**: esa es la
página pública `/automatiza`, sin sesión, con otro camino.

### El contrato de `GET /api/automatiza/armar/{id}`

Siempre: `id`, `estado`, `listo`, `modo` y `lleva_seg`. Y según el estado:

| `estado` | llaves de más |
|---|---|
| `armando` | `paso`: `entender`, `buscar`, `armar` o `revisar` |
| `listo` | `nombre` (el del flujo), `resumen`, `nodos` (`[{tipo, nombre, etiqueta, nombre_en_flujo}]`: `nombre` es el de n8n, en inglés; `etiqueta` es el chip en español que ve la persona), `pendientes` («Conecta tu cuenta de X en n8n y elige el destinatario.»), `advertencias`, `flujo` (el JSON de n8n, listo para descargar) y la llave opcional `grafo` |
| `sin_cobertura` | `mensaje` y `faltan` |
| reservados para la Fase B | `en_fila` (con `lugar`), `no_salio` y `rechazada` (con `mensaje`) |

- **La llave opcional `grafo`.** Es `{nombreFlujo, nodes, edges}`, el mismo grafo del Constructor, y viaja **solo** en las muestras de
  prueba que lo traen (hoy las tres de tipo «listo»). Es lo que permite el botón «Abrir en el constructor» sin un importador de n8n a
  grafo: si la respuesta no trae `grafo` (la muestra de «sin cobertura», o un modo real que no lo mande), la pantalla no ofrece ese botón y
  deja solo «Descargar .json». Al cargar el archivo de muestras, cada `grafo` se revisa con los mismos invariantes del Constructor (ids
  únicos, 1 disparador, 4 agentes y 8 apps como máximo, sin círculos, posiciones dentro del lienzo, que se llame igual que el flujo y que
  no lleve nada que parezca una clave); si no pasa, el archivo se da por roto (503, ver abajo).
- **Lo que nunca viaja:** `uso`, `modelo`, `fuentes`, `intentos`, `costo_usd`, el texto del pedido ni la IP. Los textos libres (`resumen`,
  `faltan`, `advertencias`) pasan por `validador.SECRETOS` antes de salir: si alguno parece una clave, ese campo se omite.
- Las respuestas del módulo (éxitos y errores propios: 422, 404 `no_encontrada`, 503) llevan `Cache-Control: no-store`. El 401 de la
  sesión y el 404 o 405 del enrutado los contesta otra capa y no lo llevan; son JSON sin datos.

### Errores y qué significan

Todos traen `detail` como objeto, `{"codigo": "…", "texto": "…"}` (más extras como `minimo` o `maximo`), y el `texto` se muestra tal cual.

| estado · `codigo` | qué pasó | qué hace falta |
|---|---|---|
| 422 `vacio` / `corto` / `largo` | el pedido va vacío, con menos de 20 caracteres (`minimo`) o con más de 1 500 (`maximo`); `largo` es también el cuerpo de más de 64 KiB (se cuentan los bytes que llegan, no solo `Content-Length`) | nada: la web lo dice junto al cuadro antes de mandar |
| 422 `cuerpo` / `texto_invalido` | el cuerpo no es un JSON con `texto` de tipo texto; o el texto trae un NUL o un sustituto UTF-16 suelto (suele venir de pegar desde otro programa) | nada |
| 404 `no_encontrada` | un id mal formado, de otra persona, caducado, del futuro o de una muestra que no existe (nunca 403: no se distingue) | nada: la persona vuelve a escribir su pedido |
| 503 `no_disponible` | el modo no se puede servir (ver la matriz), el archivo de muestras está roto, o falló algo que ningún caso previó | mirar el log `automatiza_api` (ver «Qué queda en el log»). **Nunca** degrada a un ejemplo en silencio |
| reservados para la Fase B: 422 `moderacion`, 409 `en_curso`, 429 `agotado`, 402 `sin_saldo`, 503 `no_nube` | el catálogo de errores ya los trae para que la pantalla los conozca, pero hoy **nada los emite** | — |

### El id de prueba: se deriva del reloj y caduca a la hora

En prueba no hay fila en ninguna parte: el estado de un pedido se calcula con el reloj. El `id` es opaco y autocontenido,
`p1.<base64url(json)>`, con tres llaves: `u` (los 12 primeros hex de sha256 del `sub`: de quién es), `t` (el instante de inicio, en
milisegundos) y `m` (la clave de la muestra que salió). **Sin firma ni secreto:** lo único que logra quien fabrique uno a mano es ver una
muestra enlatada de su propio usuario.

- **Validación estricta:** prefijo `p1.`, alfabeto base64url, largo de 120 o menos, JSON canónico con exactamente esas tres llaves, `u`
  igual al de quien pregunta, `-60 s ≤ ahora − t ≤ 3 600 s` y `m` existente. Todo lo demás es 404 `no_encontrada`. La forma `p1.…` lleva un
  punto, que los ids reales (`[A-Za-z0-9_-]{16}`) no tienen: nunca se confunden.
- **La espera son 4 pasos de 1.2 s (4.8 s en total)**; después el pedido queda «listo» (o «sin_cobertura») hasta que el id **caduca, a la
  hora** (3 600 s). Esos 4.8 s caben antes del primer sondeo de la web (a los 5 s: `ESCALERA` de `web/src/nucleo/sondeo.ts`, y una prueba
  lo fija): con 6 s la pantalla veía el último paso y el resultado, ya listo, no aparecía hasta los 10 s.
- Como no hay estado, funciona igual en cualquier instancia de la Lambda y no deja nada que limpiar.

### Las muestras y cómo se elige una

`media/library/n8n/muestras_prueba.json` trae cuatro. Se elige **la primera** cuya lista de palabras clave tenga una subcadena del pedido
(sin acentos ni mayúsculas); si ninguna, la que lleva `por_omision`. El orden del archivo es el de prioridad:

| clave | palabras | nombre del flujo |
|---|---|---|
| `sin_cobertura` | `hubspot`, `github`, `instagram`, `rss`, `calendar` | — (no es un flujo: `mensaje` y `faltan`) |
| `correos` | `correo`, `gmail`, `email`, `mail` | Responder correos de clientes |
| `preguntas` | `chat`, `preguntas`, `whatsapp`, `telegram`, `investig` | Asistente de preguntas frecuentes |
| `resumen_diario` | — (por omisión) | Resumen diario |

Cada muestra «listo» pasa por `validador.validar` al cargarse (el mismo que revisa lo que entrega el generador real). El archivo **falla
cerrado**: cualquier problema es `MuestrasInvalidas`, el API contesta 503 `no_disponible` sin detalles y el log dice cuál muestra y por qué.
Para cambiar una muestra se edita el archivo y se despliega (viaja dentro de la imagen y se lee una vez por proceso); sus flujos son la
exportación del Constructor de los grafos de `web/src/pantallas/constructor/modelo/ejemplos.ts`.

### Qué queda en el log: el texto NO se guarda ni se registra

La rama de prueba no lee ni escribe la base, no usa la cola, no llama a ningún modelo ni sale a la red. El texto se descarta al elegir la
muestra. Del pedido solo queda una línea en el log del API:

```
INFO automatiza_api: automatiza: armar · modo=prueba · muestra=correos · chars=87
```

(con la fecha por delante; solo la clave de la muestra y el largo, nada de lo escrito). Un error inesperado loguea solo el **tipo** de la excepción, porque su mensaje
podría traer el texto de la persona. Si alguien reclama «¿qué escribí?», no hay dónde verlo: no existe en ningún lado.

El log de acceso del servidor (el logger `peticiones`, una línea por petición: método, ruta, estado y milisegundos) es otro registro y **sí** anota la ruta completa, y la del sondeo
lleva el `id` (`GET /api/automatiza/armar/p1.…`). Ese `id` codifica la clave de la muestra que salió y el hash corto del usuario (ver «El id de prueba»), así que el log de acceso sabe
**qué ejemplo** salió y de quién es el hash, nunca el texto. Por eso la promesa es sobre el texto: no se guarda ni se registra; la muestra elegida sí deja rastro en el log de acceso.

### La matriz de `pipeline/asistente.py::modo()` y `AUTOMATIZA_ASISTENTE_REAL`

`modo()` es una función pura sobre el entorno y devuelve `prueba`, `real` o `no_disponible`. La única rama que se activa sola es «prueba».
`AUTOMATIZA_ASISTENTE_REAL` es el interruptor propio del Asistente: **ausente = apagada** (default invertido) y **independiente de
`ARMADO_REAL`**. Solo el valor exacto `1` cuenta, en las dos variables.

| `ARMADO_REAL` | `AUTOMATIZA_ASISTENTE_REAL` | fila del asistente en la base | `cobro_por_uso` | `CREDITOS_BACKEND` + `STATE_BACKEND` | resultado |
|---|---|---|---|---|---|
| ausente | cualquiera | cualquiera | cualquiera | cualquiera | **prueba** |
| `1` | ausente | — | — | — | **prueba** |
| `1` | `1` | sin fila, apagada o sin topes | — | — | `no_disponible` |
| `1` | `1` | encendida con topes | falta | — | `no_disponible` |
| `1` | `1` | encendida con topes | un entero mayor que 0 | alguno no es `postgres` | `no_disponible` (el real **nunca** corre sin monedero) |
| `1` | `1` | encendida con topes | un entero mayor que 0 | `postgres` y `postgres` | **real** |

- **DEV ya tiene `ARMADO_REAL=1`** (`armado_real=True` en `infra/entornos.py`: lo pone en la Lambda del API y en el worker público para que
  la página pública `/automatiza` arme de verdad, con su tope de corridas) y **este endpoint NO gasta por eso**: con solo `ARMADO_REAL=1`
  el Asistente sigue en prueba. En prueba tampoco se encola nada, porque el worker público decide «de mentira» o «real» por el entorno
  donde corre y no por la corrida: una corrida del Asistente metida en esa cola se armaría de verdad en DEV.
- **En la Fase A la fila de la base y `cobro_por_uso` no se leen** (no hay base en esa rama): `modo()` se llama con sus valores por
  omisión, así que el real es inalcanzable. Si alguien pusiera las dos variables en `1`, el resultado es `no_disponible`: `GET /config`
  contesta `activo: false`, `modo: "no_disponible"` y `texto`, y las otras dos rutas 503. Nunca un ejemplo enlatado haciéndose pasar por el
  flujo de la persona, ni «real» sin que exista.
- **Hoy ningún entorno enciende la variable.** `tests/test_automatiza_guardianes.py` (`test_ningun_entorno_de_la_infra_enciende_el_modo_real`)
  revisa que no aparezca en `infra/`, `worker/`, el `Dockerfile`, `.env.example`, `tools/ssm_env.py` ni `.github/`. Cuando se construya la
  Fase B, esa prueba se cambia a sabiendas.

### Lo que NO hace el modo prueba, a propósito

- **No arma nada a medida:** el flujo es la muestra más parecida por palabras. La pantalla lo dice («Prueba: por ahora armamos flujos de
  ejemplo.») mientras `config.modo` sea `prueba`.
- **No cobra ni muestra un precio:** la pantalla solo ofrece escribir si el servidor dice `activo` **y** `gratis`; si algún día el servidor
  cobra, la pantalla no ofrece nada hasta que alguien le enseñe a mostrar el costo.
- **No importa ningún SDK ni los módulos que gastan.** `pipeline/asistente.py` y `server/automatiza_api.py` no importan (ni arriba ni dentro
  de una función) `anthropic`, `openai`, `google`, `boto3`, `langfuse` ni `pipeline.claude_rag`, `armado`, `embeddings`, `vectores`, `jobs`,
  `moderacion`, `creditos` o `llm`; lo fijan las pruebas de abajo.
- **No guarda la corrida:** si el servidor se reinicia no se pierde nada porque no había nada. Tampoco hay historial ni «Tus automatizaciones»
  (ese grupo del mapa dice «Todavía no está disponible.»).

### Para ir en serio (Fase B): lo que tiene que hacer el dueño

Nada de esto está construido ni encendido. Es la lista de lo que hay que decidir y poner antes de que el Asistente arme flujos de verdad, y
**cada punto es decisión del dueño, con su sí y el costo a la vista**. Las banderas se prenden en este orden y todas nacen cerradas:
`ARMADO_REAL=1` (ya está en DEV, no en PROD) → `AUTOMATIZA_ASISTENTE_REAL=1` (variable que hoy ninguna infraestructura pone) → la fila
del asistente con topes → un `cobro_por_uso` → `CREDITOS_BACKEND=postgres` y `STATE_BACKEND=postgres` (ya así en el API de AWS).

1. **Un interruptor propio con topes.** La fila de la base que maneja `tools/automatiza.py` (`estado`, `encender`, `tope`) es la de la página
   pública `/automatiza`. El Asistente necesita la suya, con un tope diario global y uno por persona y día (día de México), y que **sin
   topes quede apagado**, como hace `pipeline/publico.py` (`permiso`) con la de `/automatiza`: sin fila o sin ningún tope es «apagado», y
   cualquier fallo al leerla también. Hoy no existe: `modo()` solo espera saber si esa fila está «encendida con topes». *(Decisión del dueño, con su sí y el costo a la vista.)*
2. **El precio en créditos.** `tools/tarifas.json`, §`rag`, no tiene `cobro_por_uso`: solo `abono_tester_por_uso`,
   `abono_tester_max_por_dia` y una nota. Sin un entero mayor que 0 ahí, `modo()` no llega a `real`. El número lo decide el dueño con los
   datos de la prueba de testers (`docs/RAG_TESTERS.md`, «Al terminar la prueba»: el abono de 20 era un incentivo, no la tarifa) y **sale de
   `tools/tarifas.json`, nunca de una constante en el código ni de la pantalla**. La pantalla tampoco sabe mostrarlo todavía: cobrar pide
   un botón «Armar ✦ N» (un verbo nuevo en `tests/test_m21_botones.py` y en `web/src/marca/verbos.ts`) y el costo a la vista antes de
   gastar. En dólares, siempre «$X.XX dólares», nunca «centavos». *(Decisión del dueño, con su sí y el costo a la vista.)*
3. **La política de devolución.** La regla de la plataforma es cobrar antes de lanzar y devolver lo cobrado si falla algo nuestro
   (`pipeline/creditos.py`, `docs/ECONOMIA.md`). Falta decidir qué cuenta como fallo nuestro en el Asistente: `no_salio` y `rechazada` son
   candidatas claras; `sin_cobertura` («todavía no sabemos armar esto») es la pregunta abierta, porque no hay entrega. Además, el worker
   público no toca el monedero a propósito (`infra/stacks/jobs.py`): la devolución la tendría que hacer el API. *(Decisión del dueño, con su
   sí y el costo a la vista.)*
4. **El aviso de privacidad al guardar textos.** En prueba no se guarda nada. El modo real tendría que guardar lo que la persona
   escribe para armar y devolver el flujo, y el aviso vigente (`server/aviso.py`, `AVISO_VERSION` = `2026-10-04`, y
   `docs/automatiza/aviso-privacidad.md`) describe solo las peticiones públicas de `/automatiza`. Antes de guardar texto de personas
   con sesión: decidir el plazo de borrado (`plazo_peticion` sigue en `SIN_DECIDIR`), cambiar el aviso, subir `AVISO_VERSION`, decidir qué
   clave de OpenAI paga la moderación y moderar sin dejar el texto en Langfuse (`sin_trazas=True`, como COI). *(Decisión del dueño, con
   su sí y el costo a la vista.)*
5. **Cola y worker de producción.** PROD no publica `/automatiza` ni su worker: `pipeline/publico.py::publicado()` se deriva de
   `PUBLICO_QUEUE_URL`, que solo se pone donde `publico` es verdadero en `infra/entornos.py`. Darle a PROD una cola pública «solo para el
   Asistente» publicaría además `/automatiza` y `/api/publico/*`, así que `publicado()` hay que desacoplarlo antes. Y solo DEV tiene
   límite de peticiones en API Gateway (`throttle_etapa` y `throttle_publico` en `infra/entornos.py`); PROD no tiene ninguno. *(Decisión del
   dueño, con su sí y el costo a la vista.)*
6. **Completar `tools/pricing.json`, §`rag`.** Su nota `pendiente` dice que faltan `cache_leida` (lectura de caché) de Opus 5.5 y de
   Sonnet 5.5 y `s3vectors.consultas_por_millon` (el precio de las consultas, no el del almacenamiento). Mientras falten, la corrida queda
   «sin precio confirmado»: no hay `costo_usd`, el tope en dólares de la base suma 0 y no frena nada (hasta entonces solo frena el tope de
   corridas) y `tools/automatiza.py corridas` no puede decir cuánto costó. Se agregan los precios que da el dueño; jamás se inventa uno.
   *(Decisión del dueño, con su sí y el costo a la vista.)*
7. **Qué modelo y qué camino.** `RAG_MODELO` es `claude-opus-5-5` por defecto (`pipeline/claude_rag.py`); DEV lo fija igual en
   `infra/entornos.py`, marcado «PROVISIONAL hasta el eval de 50 corridas (RAG·26)». `RAG_CAMINO` es `directo` (por defecto, cero
   llamadas) o `reescrita` (un modelo reescribe la petición antes de buscar: una llamada más, `pipeline/puente.py`). Elegir entre Opus 5.5 y Sonnet 5.5 pide correr `tools/eval_rag.py`: `python tools/eval_rag.py ensayo` imprime
   qué correría **sin llamar a nadie**; `correr --confirmar` sí gasta. *(Decisión del dueño, con su sí y el costo a la vista.)*
8. **Los flujos que el Constructor dibuja y el generador real no.** El Constructor exporta `@n8n/n8n-nodes-langchain.agentTool` cuando dos
   IA conversan, y ese nodo existe en `media/library/n8n/catalog.json` pero **no** en `permitidos.json`: el validador del repo rechaza esos
   flujos hoy (decisión pendiente, `web/src/pantallas/constructor/modelo/golden/LEEME.md`). Y al revés: el modo real devuelve el flujo de
   n8n y no un `grafo`, así que «Abrir en el constructor» no se ofrece hasta que exista un importador de n8n a grafo. *(Decisión del
   dueño, con su sí y el costo a la vista.)*

Antes de encender nada: `python tools/automatiza.py estado` (el interruptor y los topes de hoy), `python tools/eval_rag.py ensayo` y un
tope diario chico.

### Pruebas del Asistente (modo prueba)

`venv/Scripts/python -m pytest tests/test_automatiza_*.py` (528 pruebas el 20-oct-2026) corre sin red, sin base y sin gasto: el reloj se
inyecta. Las 92 pruebas de `test_automatiza_api.py` terminan, una por una, comprobando que nadie tocó la base, la cola, un modelo, la
moderación ni los créditos (una fixture automática lo exige); las de `test_automatiza_guardianes.py` lo comprueban en recorridos completos
y las de `test_automatiza_asistente.py` y `test_automatiza_idioma.py` son lógica y texto puros, sin nada que espiar.

- `tests/test_automatiza_api.py`: el contrato HTTP (las llaves de cada estado, los errores, `no-store`, que el texto no aparece en la
  respuesta, las cabeceras ni el log, que el log del pedido lleva solo la muestra y el largo).
- `tests/test_automatiza_asistente.py`: la lógica pura y las muestras (cada una pasa el validador, la selección por palabras, el id y su
  caducidad, el reloj, que el `grafo` es el de `ejemplos.ts` y cumple los invariantes del Constructor).
- `tests/test_automatiza_guardianes.py`: que nada importe proveedores ni módulos de gasto (con la prueba de que el guardián **cae**), que un
  recorrido completo no toque ninguna frontera, la matriz de `modo()`, el inventario de las tres rutas y que la infraestructura no
  encienda el modo real.
- `tests/test_automatiza_idioma.py`: el español de LATAM con tuteo en todos los textos que ve la persona.

La paridad del Constructor con el catálogo y el validador de Python es otra batería: `tests/test_constructor_paridad.py` (134 pruebas).
La web se prueba con vitest, y con Playwright (`web/e2e/asistente.spec.ts`, `web/e2e/constructor.spec.ts`; no corren en el CI de Docker,
ver `docs/QA-UI.md`).

## Reglas que no se negocian

- `.env` jamás se comitea ni se pega en el chat; claves de Stripe las pone el
  dueño.
- Precios en dólares SOLO de `tools/pricing.json`; tarifas en créditos SOLO de
  `tools/tarifas.json` («$X.XX dólares», jamás «centavos»).
- Versiones de clips nunca se borran; liberar slot = archivar, no borrar.
- `main` es lo desplegado. Un merge a `main` sin su `cdk deploy` deja al
  repo mintiendo sobre lo que usan los testers — y nada te avisa.
