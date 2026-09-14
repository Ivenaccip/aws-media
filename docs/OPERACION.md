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

```bash
set "PATH=D:ws-projectenv\Scripts;C:\Program Files
odejs;%PATH%" && npx cdk deploy aws-media-api aws-media-jobs --require-approval never
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
2. En **tu terminal cmd**, desde `D:\aws-project\infra`:

```bash
set "PATH=D:\aws-project\venv\Scripts;C:\Program Files\nodejs;%PATH%" && npx cdk deploy aws-media-api aws-media-jobs --require-approval never
```

   (agrega `aws-media-media` o `aws-media-db` solo si el PR tocó esos stacks;
   el synth fija el digest real de `:latest` — nunca deployar sin imagen nueva
   si cambió `static/` o código, porque viajan dentro de la imagen).
3. **Si el PR tocó `prompts/*.md`** (regla que nació con la llama «Fluffy»):

```bash
venv/Scripts/python tools/prompts_sync.py
```

   La nube sirve los prompts desde Langfuse (label `production`) — sin la
   siembra, producción sigue con el prompt viejo aunque el código sea nuevo.
   `--dry` primero si quieres ver qué cambiaría.
4. **Si el PR tocó el esquema** (`ESQUEMA` en `pipeline/db.py`): correr la
   migración (sección siguiente).
5. Marcar lo que quedó en el aire, para poder responder «¿qué tenías el
   jueves?» cuando un tester reporte algo:

```bash
git tag -a prod-$(date +%Y%m%d) -m "desplegado: <qué entró>" && git push origin --tags
```

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
