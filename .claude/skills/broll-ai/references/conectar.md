# Conectar herramientas de b-roll — guiones para el usuario

Qué decirle al usuario cuando marca una herramienta en estado **(conectar)** en el
menú de `/broll-ai` (Etapa 0). Una herramienta a la vez, solo sus pasos, y al
terminar **re-verificar y volver a mostrar el menú** con el estado nuevo. Las
mismas guías sirven a `/instalar` (Etapa 4) y a `/publicar` (Etapa 0, Blotato).

Reglas que aplican a las tres:

- Los comandos van en su propio bloque ```bash``` — así salen con botón **Run**.
- **Ninguna credencial pasa por el chat.** Las keys las pega el usuario en `.env`
  con su editor; tú solo verificas que la variable existe, sin imprimir su valor.
- Precios SOLO de `tools/pricing.json`. Fuentes verificadas 2026-08-21:
  fal.ai/docs/model-apis/authentication · help.blotato.com/api/mcp/setup.

---

## Remotion (conectar) — gráficos y animaciones con tu marca · $0

Está "desconectado" solo cuando faltan sus dependencias locales
(`remotion-longform/node_modules/` no existe). No hay cuenta ni costo. Al usuario
no le hables de npm, dependencias ni registry — para él es "prepararla una vez".

> Remotion es la herramienta gratuita de gráficos y ya viene incluida — solo falta
> prepararla en tu computadora, una sola vez (1-3 minutos). Dale click a **Run** y
> espera a que termine:
>
> ```bash
> cd remotion-longform && npm install && npm run gen
> ```
>
> Cuando veas que terminó, dime **"listo"**.

Si falla porque no hay Node, no le expliques qué es Node: "Falta un programa base
que Remotion necesita. ¿Lo instalo? (un click, con tu permiso)" → con su sí, Run
`winget install OpenJS.NodeJS.LTS` → "abre una terminal nueva y repite el Run de
arriba" (instalar software del sistema siempre con su OK — regla de `/instalar`).

Verificar: existe `remotion-longform/node_modules/`. → Remotion (activo).

---

## fal.ai (conectar) — videos con IA (clips cortos) · pago por uso

Vocabulario para el usuario: la API key es **"una llave"** y `.env` es **"tu archivo
de llaves"**. Nada de "variable", "alcance API" ni "raíz del repo". Tú haces lo
técnico: **si `.env` no existe, cópialo de `.env.example` ANTES de abrírselo** (no
hay secretos en eso), y abres el archivo por él con un botón Run. El "$5 ≈ 10
clips" sale de `pricing.json` (~$0.43 por clip) — recalcúlalo si cambia.

> fal.ai es una tienda de modelos de IA: pagas solo lo que usas (cada clip cuesta
> centavos, y te digo el costo exacto antes de generar). Para que la herramienta
> pueda pedirle videos en tu nombre, fal te da una **llave** — una contraseña
> larga — que vamos a guardar en tu archivo de llaves. Dos minutos:
>
> 1. Crea tu cuenta en **fal.ai** y recarga un poco de saldo en *Billing* (es como
>    recargar una tarjeta: con $5 dólares alcanza para unos 10 clips).
> 2. Entra a **https://fal.ai/dashboard/keys**, dale a **Create Key**, ponle de
>    nombre `video-stack` y cópiala.
> 3. Dale click a **Run** — te abro tu archivo de llaves:
>
>    ```bash
>    notepad .env
>    ```
>
>    Busca la línea que dice `FAL_KEY=` y pega la llave justo después del `=`.
>    Guarda y cierra. (Pégala ahí y no aquí en el chat — así nadie más la ve.)
> 4. Dime **"listo"** y yo reviso que quedó, sin mirar la llave.

(En macOS el botón abre con `open -e .env`.) Verificar: la línea `FAL_KEY=` tiene
valor no vacío (leer el archivo y comprobar; JAMÁS imprimir el valor). → fal.ai
(activo). Si está vacía: "La línea `FAL_KEY=` sigue vacía — revisa que guardaste
el archivo".

---

## Blotato (conectar) — imágenes con IA (foto + zoom) · créditos de tu plan

Blotato se conecta como **servidor MCP** (no lleva key en `.env`): la
autenticación es OAuth en el navegador. **Requiere plan de pago de Blotato** (el
acceso por API/MCP no está en el plan gratuito). Suele requerir **reiniciar Claude
Code**: díselo desde el principio y deja claro que no se pierde nada — en este
punto todavía no se ha generado nada; al volver escribe `/broll-ai` y retomamos.

Vocabulario para el usuario: es **"conectar Blotato con Claude"** — sin decir
"MCP", "OAuth" ni "servidor". El único término que se queda es "conector".

> Blotato genera **imágenes con IA** (y es también con lo que publicas a tus redes
> desde aquí). Conectarlo con Claude son tres pasos y al final hay que reiniciar
> Claude Code — no te preocupes, retomamos exactamente aquí:
>
> 1. Ten tu cuenta de Blotato con **plan de pago** activo, y deja iniciada tu
>    sesión en **https://my.blotato.com** en tu navegador de siempre (ahí vas a
>    aprobar la conexión).
> 2. Dale click a **Run** — le digo a Claude dónde está Blotato:
>
>    ```bash
>    claude mcp add --transport http Blotato https://mcp.blotato.com/mcp
>    ```
>
> 3. Escribe **`/mcp`** aquí en el chat, elige **Blotato → Authenticate** y dale
>    "permitir" en la ventana del navegador que se abre.
> 4. **Cierra y vuelve a abrir Claude Code** (los conectores se cargan al
>    arrancar). Al volver, escribe `/broll-ai` y seguimos donde nos quedamos.

Si usa la app de escritorio de Claude en vez de la terminal: *Customize →
Connectors → + → Add custom connector*, nombre `Blotato`, URL
`https://mcp.blotato.com/mcp`, **Connect** y aprobar.

Verificar (en la sesión nueva): `blotato_get_credits` responde → Blotato (activo ·
N créditos ≈ M imágenes). Si las tools `blotato_*` no existen en la sesión, no
reinició o la autenticación no se completó: repetir el paso 3.
