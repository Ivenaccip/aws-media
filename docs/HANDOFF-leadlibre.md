HANDOFF · Juntar el Estudio (Irremplazables) y LeadLibre · 31-oct-2026
(Para la sesión de LeadLibre y para la del Estudio. Español LATAM, tuteo, «dólares» siempre. Es una PROPUESTA: nada está construido
todavía y el dueño decide. No contiene credenciales, ARN, ID de cuenta ni la URL de dev del Estudio.)

═══ 0. QUIÉN ES QUIÉN ═══
- DUEÑO (Ivenaccip): decide, aprueba gastos, crea cuentas/claves/DNS a mano y hace de PUENTE entre sesiones.
- SESIÓN ESTUDIO («desarrollador»): repo Ivenaccip/aws-media (Irremplazables). Construye la parte del Estudio.
- SESIÓN LEADLIBRE («Herramienta tipo Leadsales con WAPI»): repo Ivenaccip/Leadsales-reverse, rama ccr-6a8fe8dc-him6je.
  Construye la parte de LeadLibre.
- Ninguna sesión le manda a la otra secretos ni credenciales. Las claves las genera y las coloca el dueño.

═══ 1. LO QUE SE DECIDIÓ (dueño, 30–31 oct) ═══
- ESTRATEGIA A: LeadLibre vive APARTE, en Fly.io, bajo https://crm.irremplazables.xyz (CNAME en Cloudflare). No se monta
  dentro del AWS del Estudio.
- UN SOLO LOGIN: se entra a LeadLibre SOLO desde irremplazables.xyz. Quien ya inició sesión en el Estudio pulsa «Abrir Ventas»
  y llega a LeadLibre sin un segundo login.
- Se paga Fly.io. La sesión de LeadLibre dijo «unos 6 USD al mes»; no está en las tarifas del Estudio y no está verificado:
  antes de contratar, mostrarle al dueño el plan exacto (máquina, disco, tráfico) desde la página de Fly.io.
- NO se mandan credenciales del Estudio a LeadLibre: se manda un PASE DE ENTRADA FIRMADO, de un solo uso y que vence en 60 s
  (§4). Motivo: el token de Cognito del Estudio abre toda su API, gastar créditos incluido. Si LeadLibre lo tuviera y alguien
  entrara a ese servidor, entraría también al Estudio. Con el pase, una fuga solo abre LeadLibre.

═══ 2. LO QUE APRENDIMOS (para no repetir la discusión) ═══
Del Estudio:
- Es serverless: API Gateway (HTTP API) → Lambda (FastAPI en imagen Docker). Trabajos pesados en otra Lambda y en tareas de
  Fargate que arrancan por trabajo. Aurora Serverless v2 (Postgres) por Data API, S3 + CloudFront, Cognito.
  No hay un servicio siempre encendido, ni balanceador, ni discos persistentes: por eso LeadLibre (proceso fijo, Socket.IO,
  volumen /data, una réplica) no cabe tal como está.
- La Lambda del API corre FUERA de la VPC (llega a Aurora por Data API): ya tiene salida a internet, no hace falta NAT.
  Límite: 29 s por petición (API Gateway corta a los 30) y hay throttling por etapa.
- Corrección a lo dicho antes: no TODA la API del Estudio exige sesión. /api/pagos/stripe ya recibe webhooks de fuera
  protegidos solo con su firma (server/auth.py, RUTAS_PUBLICAS). Es el precedente si algún día LeadLibre tiene que avisarle
  algo al Estudio. En esta fase no hace falta: el Estudio JALA.
- Producción: https://irremplazables.xyz (Cloudflare → dominio de API Gateway con certificado de ACM → Lambda). Ya existen
  https://irremplazables.xyz/privacidad y /terminos. Hay que ampliarlas para cubrir los datos de WhatsApp.
- En el mapa del Estudio, el área «Ventas» existe pero está apagada («Próximamente»). Ahí vive la entrada a LeadLibre.
- Reglas del Estudio que aplican: cero gasto sin «sí» del dueño con el costo a la vista; lo que escribe una persona no va a
  logs, ni a trazas, ni a la base (molde de COI, server/coi_api.py); todo lo que llega de otro servidor se pinta como texto,
  nunca como HTML; secretos en SSM; sin dependencias nuevas; nada a producción sin pasar por dev.
De Meta (verificado por búsqueda; developers.facebook.com no se pudo abrir directo desde el contenedor del Estudio):
- Cobra por mensaje ENTREGADO (desde el 1-jul-2025), según categoría (marketing, utilidad, autenticación) y país.
  Los mensajes que escribe el cliente no se cobran.
- Desde el 1-oct-2026 cobra también los mensajes de servicio (respuestas libres dentro de la ventana de 24 h): 1,000
  gratis por número al mes y desde el 1,001 se cobran. Según algunos blogs, sin método de pago registrado los envíos se
  detienen al acabar los 1,000 gratis (sin confirmar con Meta). El doc 05 de LeadLibre ya lo describe.
- Meta le cobra al dueño de la WABA, con su tarjeta o con la línea de crédito de un socio. Tech Provider = cada negocio paga
  con su tarjeta. Solution Partner = línea de crédito para sus clientes, proceso largo. O una solución conjunta con un socio
  (360dialog, YCloud…), que cobra su comisión.
- El webhook de Meta exige HTTPS público con certificado válido (no autofirmado) y el saludo GET del verify token.
  Hay que contestar 200 rápido. Meta reintenta hasta 7 días.

═══ 3. CÓMO QUEDA ARMADO ═══
  (1) Persona → https://irremplazables.xyz (login de Cognito) → /estudio/ventas/ → botón «Abrir Ventas»
  (2) Navegador → POST /api/crm/entrar (Estudio, con su sesión) → el Estudio firma el PASE
  (3) El navegador envía el pase en un POST (formulario que se envía solo) → https://crm.irremplazables.xyz/auth/irremplazables
  (4) LeadLibre verifica el pase → crea o encuentra a la persona → abre su sesión (startSession) → redirige a la bandeja
  (5) Meta → https://crm.irremplazables.xyz/webhooks/whatsapp (público; firma X-Hub-Signature-256; sin cambios)
  (6) Fase 2: Estudio (Lambda) → https://crm.irremplazables.xyz/api/v1/... con llave (en SSM) para mostrar datos en «Ventas»
  (7) Fase 2: Estudio → LeadLibre: «cierra las sesiones de esta persona» cuando sale o pierde acceso

═══ 4. EL CONTRATO DEL PASE (los dos lados lo implementan IGUAL) ═══
- Formato: JWT firmado con HS256. Estudio: PyJWT, ya está en requirements.txt. LeadLibre: jsonwebtoken, ya está en su
  package.json. Nadie agrega dependencias.
- Algoritmo FIJO al verificar: solo HS256 (rechazar «none» y cualquier otro).
- Campos:
    iss    "irremplazables"
    aud    "leadlibre"
    sub    id estable de la persona en el Estudio (el `sub` de Cognito). NUNCA el correo como identificador.
    email  correo (para mostrar y para que el operador la reconozca)
    nombre nombre visible (puede faltar)
    espacio a qué espacio de LeadLibre entra (ver decisión D1)
    rol    "owner" | "admin" | "agent" (nombres finales: los de LeadLibre)
    iat, exp  exp = iat + 60 s
    jti    identificador único (UUID) para que no se pueda usar dos veces
- Viaje: POST application/x-www-form-urlencoded con un campo `pase`. Nunca en la URL ni en el fragmento: así no queda en logs,
  en el historial ni en el Referer.
- LeadLibre comprueba, en este orden: la firma con LEADLIBRE_PASE_SECRETO; alg = HS256; iss y aud; exp (tolerancia de reloj
  máxima de 30 s); que el jti no se haya usado (lo guarda hasta su exp); que el espacio exista y el rol sea válido.
- Si algo falla: 401 con una página corta, «Entra desde irremplazables.xyz», y un enlace a
  https://irremplazables.xyz/estudio/ventas/. Ni el pase ni su contenido van al log: solo el motivo y el jti.
- La clave: LEADLIBRE_PASE_SECRETO, mínimo 32 bytes aleatorios (p. ej. `openssl rand -base64 48`). Una por entorno: la de
  pruebas no es la de producción. La genera el DUEÑO y la coloca en dos lugares: SSM SecureString del Estudio y
  `fly secrets set` de LeadLibre. Nunca en el chat, en el repo ni en un .env que se comitee.
- Rotarla: el verificador acepta dos claves (actual y anterior) durante el cambio. Opcional en la primera versión.

═══ 5. LO QUE HACE LEADLIBRE (sesión LeadLibre) ═══
L1. Ruta POST /auth/irremplazables: verifica el pase (§4). Busca a la persona por (proveedor="irremplazables", sub) o la crea
    la primera vez: hace falta una columna o tabla de identidad externa, porque el correo NO es la llave. Le da membresía
    en el espacio con su rol, llama a startSession y redirige a la bandeja.
L2. Modo «solo con pase» (p. ej. AUTH_SOLO_PASE=true): apaga el login con contraseña y el registro (ALLOW_SIGNUP=false).
    La pantalla de login muestra «Entra desde irremplazables.xyz» con el enlace. Deja una salida de emergencia SOLO para el
    administrador de la instancia (variable o comando de consola), documentada, para cuando el Estudio esté caído.
L3. Un solo nombre: atender solo Host=crm.irremplazables.xyz (más localhost en desarrollo). <app>.fly.dev no sirve la
    interfaz (redirige o 421), salvo el chequeo de salud de Fly.
L4. Revocar desde el servidor (fase 2): un endpoint con llave de administrador que cierre todas las sesiones de una persona
    (por sub externo) y la desactive. Las sesiones ya son revocables (tabla sessions).
L5. Deploy en Fly.io: una sola réplica, volumen en /data, respaldos activados (el disco vive en un solo servidor), chequeo
    de salud, certificado para crm.irremplazables.xyz. OJO con Cloudflare: si el registro va con proxy (nube naranja),
    revisar cómo emite Fly el certificado (puede requerir DNS sin proxy durante la emisión, o un certificado de origen).
    Decir exactamente qué registro DNS tiene que crear el dueño.
L6. Meta: webhook a https://crm.irremplazables.xyz/webhooks/whatsapp. Política de privacidad de la app de Meta:
    https://irremplazables.xyz/privacidad (el Estudio la amplía, E5). Modo de pago por omisión: meta_direct (decisión D2).
L7. Precio: antes de que el dueño contrate, el plan exacto de Fly.io con su precio, sacado de la página de Fly.
L8. Pruebas, sin red: pase válido; firma mala; alg none; aud o iss equivocados; vencido; jti repetido; espacio inexistente;
    rol inválido; segunda entrada de la misma persona (no la duplica); el login con contraseña apagado; Host equivocado.
L9. Fase 2: lista de los endpoints de /api/v1 que leerá «Ventas» (contactos, conversaciones recientes, etiquetas, etapa del
    embudo), con su forma de respuesta y límites, para que el Estudio construya el panel.

═══ 6. LO QUE HACE EL ESTUDIO (sesión Estudio) ═══
E1. POST /api/crm/entrar (exige sesión de Cognito): revisa que la persona tenga permiso (según D1: grupo de Cognito o
    regla por cuenta), arma y firma el pase (§4) y devuelve la página con el formulario que se envía solo hacia
    /auth/irremplazables. Log: solo sub, jti y resultado, nunca el pase. Con tope de intentos por persona.
E2. La clave en SSM por entorno y su cableado en el stack del API (CDK). Se despliega con el procedimiento de siempre
    (IMAGE_TAG fijo, primero dev).
E3. Encender el área «Ventas» del mapa (hoy apagada) con la página /estudio/ventas/ y su botón «Abrir Ventas» (el único
    botón ámbar de la pantalla, carta docs/DISENO.md). Cambia pruebas que hoy afirman «Producto y Ventas apagadas»
    (e2e inicio-recorrido y niveles, vitest del mapa) y DISENO §7.
E4. Fase 2: al cerrar sesión o perder acceso, llamar a la revocación de LeadLibre (L4) con su llave en SSM.
E5. Ampliar /privacidad y /terminos: WhatsApp y LeadLibre como encargado de datos. El texto lo aprueba el dueño.
E6. Fase 2: panel en «Ventas» que lee /api/v1 (L9) a través de la Lambda (la llave nunca llega al navegador), sin guardar
    texto de mensajes en Aurora y consultando solo con el panel abierto, cada `sondeo_s` que decide el servidor.
E7. Pruebas: pytest del pase (campos, exp de 60 s, jti único, el pase no aparece en logs, sin sesión → 401) y vitest y e2e
    del botón y de la página.
Va en su PROPIA rama y su PROPIO PR hacia dev; no se mezcla con el PR de rutas por nivel.

═══ 7. LO QUE HACE EL DUEÑO ═══
D1. Decidir quién usa «Ventas»: (a) solo tú y tu equipo → un espacio, rol por grupo de Cognito; o (b) cada negocio de tu
    comunidad → un espacio por cuenta y el pase dice cuál. Esto cambia L1 y E1.
D2. Decidir cómo se paga Meta. Recomendado: meta_direct (cada negocio con su tarjeta en WhatsApp Manager). La alternativa
    prepaid exige ser Solution Partner o asociarse con uno.
D3. Crear la cuenta de Fly.io con tu tarjeta y aprobar el precio exacto (L7).
D4. Generar LEADLIBRE_PASE_SECRETO (uno para pruebas y otro para producción) y colocarlo en SSM y en Fly. Las sesiones te
    dan el comando, nunca la clave.
D5. Cloudflare: el registro de crm.irremplazables.xyz que indique L5.
D6. Meta: portafolio comercial verificado, app de Meta con WhatsApp, número y método de pago (doc 03 de LeadLibre).
D7. Aprobar el texto legal de E5.
D8. ¿Una instancia de pruebas de LeadLibre (otra máquina en Fly, más costo) o se prueba en local con el canal sandbox?

═══ 8. FASES ═══
F0  Decisiones D1, D2, D3 y D8.
F1  LeadLibre en Fly con su nombre y su webhook de Meta funcionando (primero con el canal sandbox, luego con un número real):
    L3, L5, L6, L7.
F2  Un solo login: L1, L2, L8 + E1, E2, E3, E7, con D4 y D5. Se prueba primero en el dev del Estudio contra la instancia
    o el entorno de pruebas que se decida en D8.
F3  Revocación y panel de datos: L4, L9 + E4, E6.
F4  (Opcional) Embedded Signup como Tech Provider, para que cada negocio conecte su número con un clic.

═══ 9. CÓMO TRABAJAN LAS DOS SESIONES JUNTAS ═══
- El contrato del pase (§4) es la frontera: si alguien necesita cambiarlo, lo propone por escrito y el dueño lo aprueba antes
  de que cualquiera de los dos lados lo implemente.
- Cada sesión trabaja en su repo y su rama; ninguna toca el repo de la otra.
- Para probar F2 hace falta un pase de ejemplo: el Estudio da un script que firma uno con una clave de PRUEBA conocida
  (solo para tests); LeadLibre lo usa en sus pruebas. Nada de claves reales.
- Lo que se le pida correr al dueño va en UN cuadro corto «TAREA · <qué>»: pasos numerados, condición de PARA en cada paso y
  qué devolver.
- No abrir PR sin «abre el PR» del dueño; nunca fusionar; cero gasto sin «sí» con el costo a la vista.
