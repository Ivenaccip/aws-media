# ECONOMIA.md — La economía de créditos de la plataforma

> Reporte de estrategia (2026-09-02). Define cómo se cobra el uso de las
> herramientas de la comunidad: esta (video) y las siguientes, **todas bajo una
> misma economía**. Es la spec de negocio del monedero de C5
> (`PLAN-IMPLEMENTACION.md`) y el punto central que comparten los productos
> futuros. Versión presentable con el estudio comparativo completo:
> https://claude.ai/code/artifact/2375b6da-c547-4511-97e5-ceaa8654a75e

## 0. Contexto y modelo de negocio

- Las herramientas son **cerradas para la comunidad** (irremplazables): no hay
  venta al público general. Parte de la membresía se destina al mantenimiento
  de las herramientas.
- La membresía **regala créditos**: 100/mes al miembro mensual, 200/mes al
  anual. La cortesía se renueva sin acumularse. Los regalos podrán crecer
  conforme suba la suscripción — **la regla y los packs no cambian nunca; solo
  crece el regalo**. El precio del crédito es la constante de la economía; la
  generosidad es la variable de marketing.
- Los miembros pueden **comprar tantos créditos como quieran** (compra única,
  sin suscripción de créditos, y los comprados **no caducan**).
- Principio rector: **los créditos cobran lo que quema dinero por acción (IA y
  mensajería); lo que solo usa infra va incluido en la membresía** (CRM,
  plantillas, edición, re-renders locales).

## 1. Qué vale un crédito

| Mirada | Valor |
|---|---|
| Costo interno (servirlo) | **~$0.0135 dólares** — medido: la película de 30 s costó $1.35 en el E2E de C4 y se tarifa a 100 créditos |
| Venta (según pack) | **$0.0150–0.0199 dólares** |
| Piso duro de venta | **$0.015 dólares por crédito** — debajo, una subida de precios de fal nos deja en pérdida |
| En producto | 1 cr = ⅓ de segundo de video · 2 cr = 1 imagen · 100 cr = película de 30 s |

Referencia competitiva: el crédito de OpenArt vale ~$0.0023–0.0035 — es una
unidad ~6× más chica que la nuestra. **Nunca comparar créditos contra
créditos; siempre dólares contra dólares por el mismo resultado.**

## 2. La regla única de tarifas (herramienta de video)

**3 créditos = 1 segundo de video generado.** Todo cuelga de ahí:

| Acción | Créditos | Nos cuesta (pricing.json + E2E) |
|---|---|---|
| Imagen estándar (Grok edit / nanobanana) | 2 | $0.02–0.04 |
| Imagen pro (nanobanana pro) | 10 | $0.13 |
| Video generado, por segundo (Veo 3.1 lite 720p sin audio) | 3 /s | $0.03/s |
| Video con audio nativo o 1080p, por segundo | 4 /s | $0.05/s |
| Preparar película (guion + casting + estimación) | 10 | $0.08 |
| Re-generar una escena | 3 /s de la escena | proporcional |
| **Película de 30 s con director (10 + 90)** | **100** | **$1.35 medido** |
| Editar cortes, subtítulos, plantillas, re-renders locales | 0 | infra (membresía) |

Con esto la cortesía se lee sola: **el mensual tiene una película corta gratis
al mes; el anual, un minuto completo** (o 50–100 imágenes, o clips sueltos —
misma bolsa). El costo es casi lineal en segundos (Veo = 80 %), así que la
regla no se rompe con duraciones raras.

## 3. Packs de recarga

| Pack | Precio | $/crédito | Margen sobre costo | Se lee como |
|---|---|---|---|---|
| 100 cr | $1.99 dólares | $0.0199 | ~47 % | "una película más" |
| 550 cr | $9.99 dólares | $0.0182 | ~35 % | "un mes de práctica" |
| 1 200 cr | $18.00 dólares | $0.0150 | ~11 % | "modo creador" (sin link aún) |

(2026-09-05: el pack medio pasó de 500/$8.50 a **550/$9.99** — decisión del
dueño al crear los Payment Links; mantiene el rol del pack a empujar con ~20 %
de margen neto de comisión y descuento real frente al pack chico.)

Sin pack gigante tipo OpenArt Wonder: a nuestra escala, vender volumen barato
regala el margen que financia el mantenimiento.

## 4. Las tres reglas que nos diferencian (y no se negocian)

1. **El costo se enseña antes de gastar.** El gate 428 ya existe: se cobra la
   estimación redondeada hacia arriba y la desviación la absorbemos nosotros
   (varianza medida en el E2E: ±4 %). OpenArt quema la story sin decirte qué
   costará.
2. **Los créditos comprados no caducan.** Solo la cortesía mensual se renueva
   sin acumularse — eso hace sostenible el regalo. En OpenArt caduca todo y de
   ahí sale gran parte de su margen.
3. **Lo que no quema dinero no gasta créditos**, y un fallo nuestro (SFN
   FAILED, timeout) **devuelve los créditos automáticamente**.

## 5. Dónde competimos y dónde no (estudio vs OpenArt, 2026-09-01)

- **Clip suelto: los aplastamos.** 8 s = 24 cr (~$0.36–0.48 dólares) contra
  sus 500–1 500 créditos ($1.13–5.25) por el mismo modelo. Es el número para
  presumir.
- **Imagen: compite en cortesía, no en precio.** Su imagen de "1 crédito"
  (~$0.003) cuesta menos que nuestro costo de generarla ($0.02) — por eso
  nuestro mínimo es 2 cr. El argumento ganador: "tus 100 créditos gratis son
  50 imágenes"; en OpenArt no hay imágenes sin pagar $14/mes.
- **Película (el director): paridad de precio, superioridad de producto.**
  $1.50–2.00 por 30 s contra su story ($1.24–2.80 por minuto según plan), pero
  con guion editorial, voz propia, gate de duración, versiones y editor.
- **Por minuto puro no les ganamos** (nuestro costo marginal $2.55/min; su
  piso a escala $1.24/min por descuentos de volumen). No es nuestra cancha:
  nuestro usuario no paga suscripción de créditos, no pierde lo comprado y
  recibe pipeline completo. La palanca de margen futura es bajar el costo del
  Veo (volumen en fal), no subir el crédito: cada $0.01/s menos ≈ 18 puntos de
  margen.
- La jugada de OpenArt (tarifar créditos al precio del tier premium y decidir
  por dentro qué tier servir) es copiable — nosotros con transparencia como
  diferencial: mostramos el tier y su costo antes de gastar.

## 6. Una misma economía para las próximas herramientas

El **monedero es pieza de plataforma, no una función del generador de video**.
Cada herramienta nueva declara el costo de sus acciones y pasa por el mismo
gate: **estimar → saldo → ejecutar → liquidar**.

### 6.1 RAG de automatización (info actualizada + flujos n8n)

| Acción | Créditos | Costo aprox. |
|---|---|---|
| Pregunta con fuentes (incluye los videos paso a paso ya grabados) | 1 | ~$0.005–0.01 (LLM eficiente; los videos son costo 0) |
| Flujo n8n generado completo (JSON + guía de instalación) | 30 | ~$0.20–0.35 (agéntico) |

Con la cortesía mensual: 100 preguntas o ~3 flujos gratis — retención pura.

### 6.2 CRM + mensajería (tipo Leadsales)

| Acción | Créditos | Costo aprox. |
|---|---|---|
| CRM, plantillas, embudos | 0 | infra (membresía) — es el gancho de retención |
| Respuesta automática del RAG a un cliente | 1 | ~$0.005–0.01 |
| Mensaje masivo saliente | 1–3 **según canal** | ver decisión abierta |

**Decisión abierta que precede al precio:** la bifurcación del CRM es el
canal, no la IA. Por la **API oficial de WhatsApp**, Meta cobra cada mensaje
de marketing (~$0.01–0.05 dólares según país — **POR VERIFICAR** antes de
tarifar, regla de pricing.json); por **sesión web** tipo Leadsales el costo
marginal es ~$0 pero con riesgo de bloqueo del número. El precio en créditos
del masivo se fija **después** de esa elección, nunca antes (a $0.04/mensaje
de Meta, cobrarlo a 1 crédito sería perder dinero en cada envío).

## 7. Gobierno de la economía única

1. **Un solo monedero por usuario** (Postgres, diseño de C5; la tabla `costes`
   ya existe) compartido por todas las herramientas.
2. **Cada herramienta publica su tarifa** en el mismo formato que
   `tools/pricing.json`, con `verified_on`. Ninguna skill ni UI hardcodea
   precios. En UI siempre "$X.XX dólares".
3. **Langfuse con `user_id` por traza** (C6) es la base de facturación de
   todas las herramientas, no solo del video.
4. **Rate-limit por miembro en las acciones de 1 crédito** — el RAG subsidiado
   es golosina para bots; el límite protege el margen.
5. **Criterio duro de C5:** un usuario sin saldo no puede lanzar nada que
   cueste dinero.

## 8. Recarga de créditos: la pasarela (análisis 2026-09-02)

> **DECISIÓN 2026-09-03: arrancamos con Stripe US + Payment Links**, revisable
> más adelante (p. ej. migrar a un MoR si el frente fiscal se vuelve un dolor —
> ver "el tema fiscal", que sigue en manos del contador). Mientras se implementa
> opera el modo concierge: pago manual → abono por
> `tools/creditos.py abonar N --tipo compra`.

### Opciones evaluadas

| Opción | Comisión aprox. | Lectura |
|---|---|---|
| **Stripe US + Payment Links** (recomendada) | 2.9 % + $0.30 (+~1.5 % tarjeta internacional) | Mínimo código; cobra en USD (la moneda de toda la economía); OJO: **sin OXXO/SPEI** — esos solo existen en cuentas Stripe México |
| PayPal (respaldo) | similar | Común en LATAM, funciona con entidad US; segunda opción para quien no tiene tarjeta |
| Paddle / Lemon Squeezy (Merchant of Record) | ~5 % + $0.50 | Ellos son el vendedor de registro y declaran impuestos globales; el fijo de $0.50 obliga a matar el pack de $1.99 y arrancar en ~$4.99 |
| Mercado Pago | — | Descartada: pide entidad local por país |
| Stripe Tax (punto medio) | extra sobre Stripe | Calcula y cobra el impuesto, pero declararlo sigue siendo nuestro |

### Lo que las comisiones le hacen a los packs (Stripe US, tarjeta MX ~4.4 % + $0.30)

| Pack | Precio | Comisión | Se come | Margen neto |
|---|---|---|---|---|
| 100 cr | $1.99 | ~$0.39 | ~20 % | ~27 % — vive como gancho |
| 550 cr | $9.99 | ~$0.74 | ~7 % | ~20 % — el pack a empujar |
| 1 200 cr | $18.00 | ~$1.09 | ~6 % | **~5 % — demasiado fino** |

**Ajuste propuesto (pendiente de decidir):** subir el pack grande a **$19.99
dólares** ($0.0167/cr, margen ~17 % neto de comisión), o mantener precio y
actualizar el piso de venta en `tools/tarifas.json` a **$0.0165 neto de
pasarela**. La regla 3 cr/s no cambia — solo se reconoce que el piso se mide
*después* de la comisión.

### El tema fiscal (bloqueante de la decisión)

Una LLC de USA vendiendo servicios digitales a consumidores en México toca el
régimen de IVA del SAT para plataformas digitales extranjeras, y las ventas en
USA pueden generar sales tax según el estado. **Es terreno del contador.** Si
su respuesta es "ni te metas", se cambia a Paddle/Lemon Squeezy sin tocar el
monedero: el webhook de abono es idéntico en ambos.

### La rebanada de implementación (cuando se decida; ~media jornada)

1. Tres Payment Links (uno por pack) con `user_id` en `client_reference_id`.
2. Endpoint `POST /api/pagos/stripe` en la Lambda existente: verificar firma;
   en `checkout.session.completed` → `abonar_creditos(user, pack, "compra",
   referencia=session_id)`.
3. **Idempotencia por el libro mayor**: si ya existe un movimiento con esa
   `referencia`, no abonar (Stripe reintenta webhooks).
4. Reembolso = ajuste negativo con referencia al refund.
5. La sección "más créditos" de la UI = tres botones que abren los links.
   Jamás manejamos tarjetas nosotros (PCI es problema de la pasarela).

Lanzamiento por etapas: concierge hoy → webhook cuando haya más de un puñado
de recargas semanales, con datos reales de qué pack compra la gente.

## 9. Base de los números (para auditar este reporte)

- Nuestro lado: E2E de C4 medido en Langfuse (proyecto `84de6b8c`: real $1.31
  vs estimado $1.36; película 31.13 s) + infra AWS ~$0.04 por producción +
  tarifas de `tools/pricing.json` (fal/Google, verified 2026-08-22/24).
- OpenArt: openart.ai/suite/pricing (planes/créditos, consultado 2026-09-01) +
  fuentes secundarias 2026 para créditos por modelo (aproximados ±20 %, sin
  tier declarado).
- Tiers de Kling 2.1 verificados en fal (2026-09-01): standard $0.25 / 5 s ·
  master $1.40 / 5 s — "Kling 2.1" a secas no es un precio, son tres tiers.
- El costo del regalo mensual está acotado: máximo $1.35 dólares por miembro
  mensual activo y $2.70 por anual — solo si lo redimen.
