# OPERACION.md — runbook del dueño

Ligas y comandos de operación diaria del producto. Todos los comandos se corren
**desde la raíz del repo** (`D:\aws-project`). En Git Bash / PowerShell funciona
`venv/Scripts/python`; en cmd usa `venv\Scripts\python`. Los que hablan con
Aurora necesitan los ARNs (sección «Base de datos»).

## Ligas

| Qué | Liga |
|---|---|
| **Producto (API + web)** | https://2ecset5i94.execute-api.us-east-1.amazonaws.com |
| **Dashboard admin** | https://2ecset5i94.execute-api.us-east-1.amazonaws.com/admin.html |
| **Login (Hosted UI Cognito)** | https://media-ivenaccip.auth.us-east-1.amazoncognito.com — la misma pantalla cubre el cambio de contraseña del primer login; el branding se retoca en el editor visual de la consola Cognito (vive FUERA de CloudFormation) |
| **CDN de media** | https://d8bfm82hs0s6a.cloudfront.net |
| **Langfuse (trazas y prompts)** | https://us.cloud.langfuse.com |
| **Stripe** | https://dashboard.stripe.com — webhooks test y live se configuran POR SEPARADO |
| **Repo** | https://github.com/Ivenaccip/aws-media |
| **AWS** | cuenta `191241816158`, us-east-1 — Budget $50/mes con avisos $10/$25/$50 |

Identificadores fijos: Cognito pool `us-east-1_WyPvxnj1V`, client
`2kf9frusv9ae4fndns5f5nt9h9`; bucket `aws-media-media-mediaa721a567-bat5i0pvqczo`;
ECR `191241816158.dkr.ecr.us-east-1.amazonaws.com/aws-media`.

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

## Créditos (`tools/creditos.py`)

`--user` acepta el **correo**: el tool lo resuelve al sub de Cognito (el
user_id real de la base) antes de tocar el monedero, y truena con aviso si el
correo no existe en el pool. También acepta el sub directo (el id que imprime
`usuarios.py lista`).

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
  análisis 2 + render 2 por short, Editar sugerencias 2 cr.
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

Desde C3 hay además una **Agenda** (`/agenda.html`, en el menú del inicio) con
todo lo que Blotato todavía no ha publicado. Si alguien pregunta por ella:

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

Y desde C4, **Métricas** (`/metricas.html`, también en el menú) con lo que ya
salió y lo que no pudo salir. Las preguntas que van a llegar:

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
| `main` | https://2ecset5i94.execute-api.us-east-1.amazonaws.com — **lo que usan los testers** |
| `dev` | solo en tu máquina: `venv/Scripts/python -m uvicorn server.app:app --port 8011` → http://localhost:8011 |

No hay un «dev en la nube». Con un solo entorno AWS, esa columna no existe.

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

## Deploy (checklist)

1. PR `dev` → `main` y merge → GitHub Actions construye la imagen y la
   empuja a ECR. **Solo main empuja**: desde `dev` o desde un PR se
   construye y se prueba, pero no se publica — la Lambda de producción
   consume el `latest` de ese mismo repositorio.
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

En cmd. El `& set IMAGE_TAG=` del final no sobra: es lo que impide que la
variable sobreviva al comando (ver la trampa, justo debajo).

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && set IMAGE_TAG=<sha> && npx cdk deploy aws-media-api aws-media-jobs --require-approval never & set IMAGE_TAG=
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

Ojo con el margen de la retención: la política conserva 20 imágenes, así que
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

## Alarmas

Siete alarmas de CloudWatch mandan correo cuando algo se rompe, a
`ivenaccip@gmail.com` y a `developer.leonardomedina@gmail.com`. Van las dos
direcciones porque la cuenta de AWS y el presupuesto de $50 se dieron de alta
con la primera, pero el trabajo del proyecto se sigue desde la segunda — y una
alarma que llega a la bandeja que nadie abre no es una alarma. Viven en un stack **aparte** (`aws-media-alertas`) y en su propia app CDK
(`infra/app_alertas.py`), por una razón concreta: `cdk deploy aws-media-api`
arrastra la base de datos —el diff lo dice literalmente, *«Including dependency
stacks: aws-media-db, aws-media-media»*— y desplegar unas alarmas no debería
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

El repositorio `aws-media` conserva las **20 imágenes más recientes** y expira el
resto. La política vive en `infra/ecr-lifecycle.json`.

### Por qué hace falta

Medido el 14 de septiembre de 2026: **86 imágenes, 122 GB**, ninguna sin tag. Era
el **43% de la factura** de AWS y crecía con cada merge a `main`.

Y crecía de verdad, no en apariencia: **dos builds consecutivos solo comparten 4
de sus 17 capas — 48 MB de 1.664.** El CI no cachea capas de Docker, así que cada
build reconstruye todo desde cero y sube ~1,6 GB genuinamente nuevos. Al ritmo de
merges de estos días, unos 4,8 GB al día.

Con la política, el repositorio se estabiliza en ~33 GB en vez de subir sin techo.

### El riesgo real, que no es el número

**Las Lambdas apuntan a un digest, no a un tag.** Si la imagen que corre
producción cae fuera de las 20 más recientes y se expira, la función deja de
poder arrancar contenedores nuevos.

Veinte son unos siete días de margen al ritmo actual. El peligro no es que el
número sea bajo: es **dejar pasar 20 merges sin desplegar**. Ya ha pasado estar
tres PRs por detrás.

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
Gotcha: Aurora se auto-pausa a 0 ACU — la primera llamada tras un rato puede
tardar ~25 s o dar 503/timeout; reintenta.

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
auto-pausado — sin transacciones no hay puntos nuevos que crear. Verlo horas
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
  `https://2ecset5i94.execute-api.us-east-1.amazonaws.com/api/pagos/stripe`,
  evento `checkout.session.completed`. Un pago que no abona casi siempre es
  el webhook del modo equivocado (revisar requests en CloudWatch).
- Pago raro (sin usuario, monto sin pack) → queda 200 con ERROR en CloudWatch
  → abonar a mano con `creditos.py abonar --tipo compra --ref <session_id>`.

## Reglas que no se negocian

- `.env` jamás se comitea ni se pega en el chat; claves de Stripe las pone el
  dueño.
- Precios en dólares SOLO de `tools/pricing.json`; tarifas en créditos SOLO de
  `tools/tarifas.json` («$X.XX dólares», jamás «centavos»).
- Versiones de clips nunca se borran; liberar slot = archivar, no borrar.
- `main` es lo desplegado. Un merge a `main` sin su `cdk deploy` deja al
  repo mintiendo sobre lo que usan los testers — y nada te avisa.
