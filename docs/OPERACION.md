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
- El `--user` es el **sub de Cognito o el id interno** que muestra
  `usuarios.py lista` / el dashboard admin.
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

## Deploy (checklist)

1. Merge del PR → GitHub Actions construye la imagen y la empuja a ECR.
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

## Base de datos (Aurora)

ARNs del stack `aws-media-db` (también salen en sus outputs de CloudFormation):

- cluster: `arn:aws:rds:us-east-1:191241816158:cluster:aws-media-db-db5d02a0a9-luualrjywhm7`
- secret: `arn:aws:secretsmanager:us-east-1:191241816158:secret:DbSecretCF6D79B0-OCMXnjHbEOrM-LAYvNT`

```bash
venv/Scripts/python tools/db_migrate.py --cluster-arn arn:aws:rds:us-east-1:191241816158:cluster:aws-media-db-db5d02a0a9-luualrjywhm7 --secret-arn "arn:aws:secretsmanager:us-east-1:191241816158:secret:DbSecretCF6D79B0-OCMXnjHbEOrM-LAYvNT"
```

`usuarios.py`, `creditos.py` y `costes.py` aceptan los mismos
`--cluster-arn/--secret-arn` (o las envs `DB_CLUSTER_ARN`/`DB_SECRET_ARN`).
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
