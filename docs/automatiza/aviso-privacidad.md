# Aviso de privacidad y términos de /automatiza · guía para el dueño (RAG·13)

Fecha: 29-sep-2026 · Versión del texto: `2026-09-29-borrador`

> **Esto no es asesoría legal.** Lo escribió un agente a partir del código del
> repo y de lo que pudo leer sobre la ley en fuentes secundarias (ver
> «Fuentes», al final: los sitios oficiales no se pudieron abrir desde el
> entorno). Antes de abrir el 10-oct, **pide a un abogado que revise** las dos
> páginas y, sobre todo, lo marcado con [VERIFICAR].

## En corto

- `/privacidad` es el **aviso integral** (las 8 secciones del lienzo) y
  `/terminos` son los **términos de uso**. Los dos dicen arriba «Borrador para
  revisión del dueño».
- El **aviso simplificado** (el bloque de 4 filas junto a cada formulario de
  correo) vive en `static/automatiza.html`, en dos plantillas: la completa
  (`<template id="plantilla-aviso">`, pantalla 3) y la compacta
  (`<template id="plantilla-aviso-compacto">`, la fila, «se pasó del tiempo»
  y «No salió»). La pantalla 1 lleva además una línea mínima con el
  responsable, el plazo, la huella de la IP y los Términos.
- Para llenar los huecos tocas **un solo archivo**: `server/aviso.py`
  (`DATOS`). Lo que no es un hueco de `DATOS` va en el HTML entre corchetes.
- Hay **decisiones tuyas** pendientes (lista abajo): la más urgente es el
  texto de la casilla de novedades, porque el permiso no se pide hacia atrás.

## Qué hay y dónde

| Archivo | Qué es |
|---|---|
| `static/privacidad.html` | Aviso de privacidad integral. Plantilla con huecos. |
| `static/terminos.html` | Términos de uso. Plantilla con huecos. |
| `static/legal.css` | El estilo de las dos (tokens de `static/carta.css`, sin JS, cabe en la CSP). |
| `server/aviso.py` | `DATOS`: los huecos que llenas. `AVISO_VERSION` y `RECONTACTO_TEXTO`: lo que se guarda con cada correo como prueba del consentimiento. |
| `static/automatiza.html` | Donde va el aviso simplificado (`plantilla-aviso` y `plantilla-aviso-compacto`), la línea de la pantalla 1 y la casilla. |

El server llena los huecos al servir la página (con escape HTML). Si una
página pide un hueco que no existe en `DATOS`, falla `tests/test_rag_paginas.py`
antes del deploy: no puede salir un aviso a medias.

## Qué pide la ley

La **Ley Federal de Protección de Datos Personales en Posesión de los
Particulares** (LFPDPPP) nueva se publicó en el DOF el **20 de marzo de 2025**
y está **vigente desde el 21 de marzo de 2025**; abrogó la de 2010. Varias
fuentes coinciden en esas fechas.

Los números de artículo de abajo salen de resúmenes de búsqueda de despachos y
de sitios que transcriben la ley. **No pude abrir el texto oficial** (DOF y
diputados.gob.mx bloqueados por la red del entorno). Por eso todos llevan
[VERIFICAR]: cotéjalos con el PDF oficial antes de citarlos en cualquier lado.

| Tema | Qué exige, en palabras simples | Artículo | Estado |
|---|---|---|---|
| Aviso integral | Debe decir, al menos: **I.** quién es el responsable y su domicilio; **II.** qué datos se tratan, señalando los sensibles; **III.** para qué, distinguiendo las finalidades que requieren consentimiento; **IV.** las opciones y medios para limitar el uso o la divulgación; **V.** cómo ejercer los derechos ARCO; **VI.** cómo se avisan los cambios al aviso. | art. 15 | [VERIFICAR número; contenido coincide en varias fuentes] |
| Transferencias en el aviso | Según EY, la ley nueva **quitó** la obligación de listar las transferencias en el aviso. Aun así las declaramos (no cuesta y da confianza). | art. 15 | [VERIFICAR] |
| Cuándo y cómo se pone a disposición | Si los datos se recaban **por medio electrónico**, hay que dar el aviso **simplificado**, con al menos lo de las fracciones **I a IV** del art. 15, y decir dónde está el integral. | art. 16 fr. II | [VERIFICAR número; contenido coincide en varias fuentes] |
| Consentimiento | Por regla general vale el **tácito**: se pone el aviso a disposición y la persona no se opone. Datos **financieros** requieren consentimiento expreso; **sensibles**, expreso y por escrito (firma o mecanismo de autenticación). Debe ser libre, específico e informado. | arts. 7 y 8 (aprox.) | [VERIFICAR números] |
| Negarse a finalidades | Tiene que haber mecanismos para que la persona diga que no a las finalidades que requieren su consentimiento **antes** de que ocurra el tratamiento. | — | [VERIFICAR artículo] |
| Revocación | Se puede revocar el consentimiento en cualquier momento, **sin efectos retroactivos**, con mecanismos sencillos y gratuitos. | — | [VERIFICAR artículo] |
| Derechos ARCO | Acceso, rectificación, cancelación y oposición. | arts. 21 a 26 (aprox.) | [VERIFICAR] |
| Solicitud ARCO | Nombre y domicilio o correo para notificaciones; documentos que acrediten la identidad (o la representación); descripción clara de los datos; qué derecho se ejerce. | art. 29 | [VERIFICAR] |
| Plazos ARCO | El responsable contesta en **máximo 20 días** desde que recibe la solicitud; si procede, lo hace efectivo **dentro de los 15 días** siguientes. Ampliables **una sola vez por un periodo igual** si se justifica. | art. 31 | [VERIFICAR: una fuente habla de «hasta 10 días» de ampliación, que parece ser la regla del sector público; y si son días hábiles o naturales] |
| Remisiones | Dar datos a un **encargado** (un proveedor que procesa por cuenta tuya: AWS, el proveedor de correo…) es una «remisión»: no requiere consentimiento ni informarse al titular (así lo decía el Reglamento de 2011, art. 53). | Reglamento 2011 | [VERIFICAR que siga aplicando] |
| Autoridad | El **INAI desapareció**. La autoridad de datos personales en el sector privado es la **Secretaría Anticorrupción y Buen Gobierno** (verificación, sanciones, procedimiento de protección de derechos). | — ; procedimiento arts. 40 a 50 (aprox.) | Confirmado en varias fuentes, incluidas notas de gob.mx; [VERIFICAR artículos] |
| Reglamento | El Ejecutivo tenía 90 días para el reglamento nuevo; según una fuente, a mediados de 2026 **seguía pendiente** y el de 2011 aplica en lo que no contradiga la ley. | transitorios | [VERIFICAR] |
| Reforma posterior | El índice de diputados.gob.mx registra una reforma publicada el **14-nov-2025**; según la búsqueda, al **art. 4** (homologación con el Código Nacional de Procedimientos Civiles y Familiares). No toca el aviso. | art. 4 | [VERIFICAR] |

## Cómo cumple cada sección del aviso integral

| Sección (lienzo) | Qué dice | Qué requisito cubre | De dónde sale lo que dice |
|---|---|---|---|
| 1. Quién es el responsable | `responsable`, `domicilio` y `correo_privacidad`. | fr. I | `server/aviso.py` DATOS |
| 2. Qué datos recabamos | Descripción (se guarda aunque se rechace), flujo y estado, correo + prueba del consentimiento (casilla, texto, versión, fecha, historial de cambios), **huella** de la IP (no la IP), de dónde llegó (referrer y utm), descargas y reporte. Datos sensibles: no se piden. Qué se queda en el navegador y cookies. | fr. II | `pipeline/db.py` (`automatiza_corridas`, `automatiza_contactos`), `pipeline/publico.py` (`hash_ip`), `server/publico_api.py`, `static/automatiza.js` |
| 3. Para qué los usamos | **Necesarias:** armar, entregar, avisar de la petición, topes y abuso, atender reportes y derechos. **Adicionales que se pueden rechazar:** mejorar el servicio, medir de dónde llegan, y novedades **solo con la casilla aparte y desmarcada**. Cómo negarse. «Lo que no hacemos». | fr. III y IV | tarjetas RAG·3, RAG·5/6, RAG·12, RAG·13, RAG·28 |
| 4. Cuánto tiempo | `plazo_peticion`, `plazo_correo`, registros del servidor (1 semana), navegador. Qué pasa al vencer. | lo pide la tarjeta RAG·13 («qué se guarda y por cuánto») | `infra/stacks/api.py` y `jobs.py` (`log_retention=ONE_WEEK`) |
| 5. Con quién | Encargados: AWS (Lambda, Aurora, S3, SQS; us-east-1), Cloudflare, proveedor del modelo de IA [RAG·21], Langfuse, `proveedor_correo` [RAG·14]. Sin transferencias a terceros, salvo autoridad con fundamento legal. | transferencias y remisiones (según EY ya no es obligatorio listarlas; se declaran igual) | `infra/app.py` (región), `server/app.py` (Cloudflare), `pipeline/llm.py` y `pipeline/moderacion.py` (OpenAI + Langfuse hoy) |
| 6. Tus derechos | Qué es cada derecho ARCO, a qué correo, qué mandar (incluido el número de petición, que es lo único que liga a una persona anónima con sus datos), plazos 20/15, gratis, autoridad. | fr. V | art. 29 y 31 [VERIFICAR] |
| 7. Retirar el consentimiento | Baja de novedades (enlace en cada correo + correo), negarse a lo adicional, borrar petición o correo. Sin efectos hacia atrás. | revocación y fr. IV | — |
| 8. Cambios | Se publican en la misma URL con versión y fecha; aviso por correo si cambian finalidades o proveedores; nuevo consentimiento si hace falta. Cada correo guarda la versión vigente. | fr. VI | `automatiza_contactos.aviso_version` |

## Qué dicen los términos, en corto

Servicio **gratis y experimental del 10 al 25-oct-2026** (la ventana del plan:
RAG·30 enciende el 10, RAG·31 reconvierte el 25), que se puede pausar; el flujo
lo arma **un sistema automático** y se entrega **tal cual, sin garantía**:
hay que revisarlo y probarlo antes de conectarle cuentas reales. **Usos
prohibidos** copiados del filtro de moderación
(`prompts/moderar_automatiza_system.md`: spam, fraude y phishing, raspar datos
de terceros, acoso, saltarse protecciones o atacar sistemas, menores/odio/daño
real) más inyección de instrucciones y bots. **Límites**: tope diario y por
conexión (sin cifras), largo `largo_minimo`–`largo_maximo`, cambios de correo
limitados. **El flujo es para ti**, sin exclusividad; lo que escribes sigue
siendo tuyo. **Responsabilidad limitada** «en la medida en que la ley lo
permita». **Ley mexicana**; tribunales [POR DECIDIR]. Contacto con los
mismos datos del aviso.

Si cambias el filtro de moderación, cambia también la lista de usos
prohibidos: tienen que decir lo mismo.

## Lo que tienes que llenar o decidir

### En `server/aviso.py` → `DATOS`

| Clave | Qué poner | Ojo |
|---|---|---|
| `responsable` | Tu nombre completo (persona física) o la razón social (si hay empresa). | «Irremplazables» es la marca, no una persona: la ley pide la identidad de quien responde. |
| `domicilio` | Domicilio para oír y recibir notificaciones. | Sale en el aviso simplificado junto a cada formulario: es obligatorio (fr. I). |
| `correo_privacidad` | Un correo que leas, para derechos ARCO. | Sale como enlace `mailto:`. Lo usan también los términos como contacto. |
| `plazo_peticion` | Cuánto guardas la descripción, el flujo y los datos de la petición (RAG·0). | Se lee después de «durante»: escribe algo como «12 meses desde tu petición». |
| `plazo_correo` | Cuánto guardas el correo (RAG·0). | El aviso ya dice aparte que, si marcó la casilla, se guarda hasta la baja (ver decisiones). |
| `proveedor_correo` | El proveedor de envío separado de SES (RAG·14). | Solo el nombre, p. ej. «Resend» o «Postmark». |
| `fecha_aviso` | La fecha de la versión que publiques. | |
| `AVISO_VERSION` | Súbela **cada vez que cambie el texto** (p. ej. `2026-10-06`). | Se guarda con cada correo: así se prueba qué aviso aceptó cada quien. Hoy la comparten el aviso y los términos. |

### En el HTML (entre corchetes, no son huecos de `DATOS`)

- `privacidad.html` §2 **Cookies**: [VERIFICAR en el panel de Cloudflare qué
  cookies pone y cuánto duran]. Si Bot Fight Mode o Turnstile están activos,
  Cloudflare pone cookies técnicas (p. ej. `__cf_bm`).
- `privacidad.html` §5 **proveedor del modelo de IA** [POR DECIDIR (RAG·21)] y
  país. Hoy el código de moderación llama a **OpenAI** (`pipeline/llm.py`).
- `privacidad.html` §5 **Langfuse** [VERIFICAR región]: el código apunta por
  defecto a `us.cloud.langfuse.com` (Estados Unidos). Ya está en el camino
  público: `moderacion.revisar` lleva `@observe` y el cliente de OpenAI va
  envuelto por Langfuse, así que la descripción llega ahí en cuanto
  `ARMADO_DE_MENTIRA` pase a `False`.
- `privacidad.html` §6 **identificación ARCO** [VERIFICAR con un abogado]: la
  ley pide documentos que acrediten la identidad, pero el visitante es anónimo.
  El texto propone: escribir desde el correo que dio + el número de petición.
  Pedir una INE para una petición anónima sería pedir más datos de los que
  tienes.
- `terminos.html` §1 **edad mínima** [POR DECIDIR; se recomienda 18].
- `terminos.html` §9 **ciudad de los tribunales** [POR DECIDIR] y
  [VERIFICAR con un abogado] esa cláusula y la de responsabilidad limitada.

Cuando apruebes el texto: borra el bloque `<div class="aviso-caja borrador">`
de las dos páginas y sube `AVISO_VERSION`.

### Decisiones (el texto ya las asume; cámbialo si decides otra cosa)

1. **Texto de la casilla de novedades.** Hoy: «Quiero recibir por correo nuevas
   automatizaciones y tutoriales de Irremplazables.» **No cubre ofertas ni
   invitaciones a pagar.** Si el 26-oct quieres ofrecerles la versión de pago
   o la comunidad, cámbialo ANTES del 10-oct (propuesta: «…nuevas
   automatizaciones, tutoriales y ofertas de Irremplazables.»). Esa lista es
   el activo del ejercicio y el permiso no se pide hacia atrás.
2. **«Mejorar el servicio» como finalidad adicional (que se puede rechazar).**
   Es la razón de ser de RAG·3 (saber qué pide la gente), pero no es necesaria
   para entregar el flujo, así que la puse como adicional con un «no» por
   correo. La alternativa (tratarla como necesaria) tiene más riesgo. Si
   alguien se niega, hay que excluir su petición de los análisis a mano.
3. **Medir de dónde llegan (utm/referrer)** también como adicional, en números
   agregados.
4. **Correo con novedades se guarda hasta la baja**, aunque `plazo_correo` sea
   más corto. Sin eso la casilla no sirve para nada.
5. **Después de una baja se guarda que se dio de baja** (para no volver a
   escribirle). Eso es una lista de supresión: decide si la quieres.
6. **Entrenamiento de modelos.** El aviso NO promete que la descripción no se
   use para entrenar modelos. Si eliges (RAG·21) un proveedor cuyas
   condiciones lo prohíben, puedes agregarlo a «Lo que no hacemos».
7. **El flujo es para quien lo pide, sin exclusividad**, y no reclamas
   derechos sobre él (términos §5).
8. **Aceptar los términos desde la pantalla 1.** Los usos prohibidos aplican
   desde la primera petición, así que la línea de la pantalla 1 ya dice «Al
   armarlo aceptas los Términos» (además de «Al mandarlo…» en la del correo).
   Confírmalo con el abogado.

## Lo que el texto promete y alguien tiene que cumplir

El aviso compromete cosas que hoy **no existen todavía** en el código o en la
operación. Son parte de dejarlo listo, no adornos:

- **Borrar al vencer los plazos.** No hay ninguna tarea que borre corridas o
  correos viejos. Hace falta antes de que venza el primer plazo (RAG·0 fija
  los plazos; el borrado es tarea aparte).
- **Enlace para darse de baja en cada correo de novedades** (RAG·14/16 y la
  lista de opt-in, RAG·35).
- **Atender solicitudes ARCO a mano** en 20 días: alguien tiene que leer
  `correo_privacidad`. Buscar por `publico_id` o por correo en
  `automatiza_contactos`.
- **Excluir de los análisis** a quien se niegue a «mejorar el servicio».
- **No guardar la IP en claro en ningún lado.** Hoy se cumple
  (`hash_ip` y ningún log la escribe); cuidar que siga así cuando lleguen los
  spans de Langfuse (RAG·23) y cualquier log nuevo.
- **Contratos con los encargados** (AWS, Cloudflare, proveedor de IA,
  Langfuse, proveedor de correo): revisa que sus condiciones incluyan un
  acuerdo de tratamiento de datos (DPA). [VERIFICAR con un abogado qué exige la
  ley nueva a la relación con encargados.]

## Diferencias que encontré entre el lienzo, el contrato y el repo

- La línea de la pantalla 1 del lienzo decía «No guardamos tu IP.» Es cierto
  que la IP no se guarda, pero sí una huella (HMAC con sal): la página ya dice
  «solo una huella cifrada», igual que el simplificado y el integral.
- La pantalla 1 **ya recaba datos** (descripción, huella, origen; aun si se
  rechaza): su línea ya nombra al responsable, el plazo y la finalidad
  (se cambió contra el lienzo por eso).
- El contrato decía que el navegador solo guarda el borrador. `static/automatiza.js`
  guarda además `automatiza:pedido` (el número de petición y el texto, en
  `localStorage`, sin caducidad) y `automatiza:origen` (utm y referrer, en
  `sessionStorage`). El aviso describe lo que hace el código. Si eso cambia,
  cambia el §2.

## Fuentes

**Oficiales** (no se pudieron abrir desde el entorno: la red del entorno
rechaza diputados.gob.mx, dof.gob.mx, gob.mx y scjn.gob.mx; aparecen en las
búsquedas como el texto oficial):

- Texto vigente de la LFPDPPP: https://www.diputados.gob.mx/LeyesBiblio/pdf/LFPDPPP.pdf
- Historial de reformas: https://www.diputados.gob.mx/LeyesBiblio/ref/lfpdppp.htm
- Texto original del 20-mar-2025: https://www.diputados.gob.mx/LeyesBiblio/ref/lfpdppp/LFPDPPP_orig_20mar25.pdf
- Reglamento de 2011: https://www.diputados.gob.mx/LeyesBiblio/regley/Reg_LFPDPPP.pdf
- Secretaría Anticorrupción y Buen Gobierno, entrega-recepción con el INAI: https://www.gob.mx/buengobierno/prensa/la-secretaria-anticorrupcion-y-buen-gobierno-e-inai-formalizan-entrega-recepcion-institucional

**Secundarias** (solo se leyeron los resúmenes del buscador, no las páginas):

- Art. 15 transcrito: https://leyes-mx.com/ley_federal_de_proteccion_de_datos_personales_en_posesion_de_los_particulares/15.htm
- Art. 16 transcrito: https://leyes-mx.com/ley_federal_de_proteccion_de_datos_personales_en_posesion_de_los_particulares/16.htm
- EY, entrada en vigor (quita transferencias del aviso): https://www.ey.com/es_mx/technical/tax/boletines-fiscales/nueva-ley-federal-proteccion-datos-personal-posesion-particulares
- IDC, ajustes al aviso: https://idconline.mx/corporativo/2025/03/31/ajustes-en-el-aviso-de-privacidad-con-la-ley-de-proteccion-de-datos
- IDC, la Secretaría asume funciones del INAI: https://idconline.mx/corporativo/2025/03/04/secretaria-anticorrupcion-y-buen-gobierno-asumira-funciones-del-inai
- SDV, art. 22 (derechos ARCO): https://sdv.com.mx/compendio/ley-proteccion-datos-personales/articulo-22/
- SDV, art. 8 (consentimiento): https://sdv.com.mx/compendio/ley-proteccion-datos-personales/articulo-8/
- Sharkit, reglamento pendiente: https://sharkit.mx/nueva-lfpdppp-reglamento-pendiente/
- Garrigues, panorama de la ley nueva: https://www.garrigues.com/es_ES/noticia/mexico-nueva-ley-federal-proteccion-datos-personales-posesion-particulares-introduce
