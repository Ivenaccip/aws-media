// /automatiza (RAG·9 a RAG·13) — la máquina de estados de la página pública.
//
// Una sola página con todas las pantallas del lienzo como secciones
// (data-pantalla): pedir → espera | fila → correo → listo, y las de falla
// (no-salio, rechazada, no-disponible). Solo se ve una a la vez.
//
//   /automatiza            → GET /api/publico/estado; si está en pausa, la
//                            pantalla 6 antes de que escriba
//   /automatiza/c/<id>     → el enlace para volver: lee la corrida y abre justo
//                            donde va (nunca otra vez en el formulario)
//
// Lo único que se pide es /api/publico/*: esta página NO carga auth.js ni
// monedero.js (un 401 mandaría a Cognito a alguien que no tiene cuenta).
// La espera la mira window.Sondeo (static/sondeo.js, RAG·11), que se carga
// antes con defer.
//
// Por la CSP (script-src y style-src 'self') aquí no hay eval ni estilos en
// línea: la barra de progreso cambia con un data-atributo que pinta
// automatiza.css. Los textos que decide el dueño llegan en el HTML ya llenos
// (server/aviso.py); este archivo se sirve tal cual y no lleva marcadores.
//
// Arriba va la lógica sin DOM (qué pantalla toca, los textos del reloj y de la
// fila, los nombres de los nodos, el largo del campo, utm y referrer): la
// prueba tests/automatiza_nodo.js en node, sin navegador. Abajo, la página.
(function (raiz) {
  'use strict';

  // ---------------------------------------------------------------------
  // la lógica (sin DOM)

  // desde qué lugar de la fila se enseña «Hay mucha gente» en vez de la
  // espera con pasos, y cuántas corridas arma el worker a la vez
  const FILA_DESDE = 3;
  const CONCURRENCIA = 2;
  // cuánto suele tardar una corrida, en minutos. PROVISIONALES:
  // [POR MEDIR con tools/automatiza_e2e.py] antes de prometerlo en pantalla
  const TARDA_MIN = 1;
  const TARDA_MAX = 3;

  const PASOS = ['entender', 'buscar', 'armar', 'revisar'];
  const NOMBRES_PASO = ['Entendimos lo que pediste', 'Buscamos en la documentación de n8n',
    'Armando el flujo', 'Revisando que importe en n8n'];
  const FINALES = ['listo', 'no_salio', 'sin_cobertura', 'rechazada'];
  // el publico_id: secrets.token_urlsafe(12), igual que server/publico_api.py
  const ID = /^[A-Za-z0-9_-]{16}$/;
  const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
  const TOPE_ORIGEN = 500;   // lo que guarda la base de un referrer o un utm
  const TITULO_RECHAZO = 'Esta petición no la podemos armar';

  // Los nodos que más salen, con el nombre que la gente reconoce. La llave es
  // el tipo sin paquete ni «Trigger» y en minúsculas: gmailTrigger y gmail son
  // la misma app. Lo que no esté aquí se muestra limpio (ver nombreNodo).
  const NOMBRES_NODO = {
    gmail: 'Gmail', googledrive: 'Google Drive', googlesheets: 'Google Sheets',
    googlecalendar: 'Google Calendar', googledocs: 'Google Docs', googleslides: 'Google Slides',
    googlecontacts: 'Google Contacts', googletasks: 'Google Tasks',
    microsoftoutlook: 'Outlook', microsoftexcel: 'Excel', microsoftteams: 'Microsoft Teams',
    microsoftonedrive: 'OneDrive', slack: 'Slack', telegram: 'Telegram', whatsapp: 'WhatsApp',
    discord: 'Discord', notion: 'Notion', airtable: 'Airtable', trello: 'Trello', asana: 'Asana',
    clickup: 'ClickUp', mondaycom: 'monday.com', hubspot: 'HubSpot', pipedrive: 'Pipedrive',
    salesforce: 'Salesforce', shopify: 'Shopify', woocommerce: 'WooCommerce', stripe: 'Stripe',
    paypal: 'PayPal', mailchimp: 'Mailchimp', typeform: 'Typeform', jotform: 'Jotform',
    calendly: 'Calendly', dropbox: 'Dropbox', github: 'GitHub', gitlab: 'GitLab', twilio: 'Twilio',
    openai: 'OpenAI', lmchatopenai: 'Modelo de OpenAI', agent: 'Agente de IA',
    httprequest: 'Petición HTTP', webhook: 'Webhook', respondtowebhook: 'Responder al webhook',
    schedule: 'Horario', cron: 'Horario', manual: 'Inicio manual', form: 'Formulario de n8n',
    if: 'Condición', filter: 'Filtro', switch: 'Elegir camino', set: 'Editar campos',
    code: 'Código', function: 'Código', merge: 'Unir', splitinbatches: 'Por tandas',
    splitout: 'Separar', aggregate: 'Juntar', sort: 'Ordenar', limit: 'Limitar',
    removeduplicates: 'Quitar repetidos', wait: 'Esperar', datetime: 'Fecha y hora',
    emailsend: 'Enviar correo', emailreadimap: 'Leer correo', extractfromfile: 'Leer archivo',
    converttofile: 'Crear archivo', rssfeedread: 'RSS', html: 'HTML', noop: 'Sin acción',
    executeworkflow: 'Otro flujo',
  };

  // El id del enlace para volver, o null. Solo la forma exacta: lo demás ya lo
  // contestó el servidor con 404.
  function idDeRuta(ruta) {
    const m = /^\/automatiza\/c\/([^/]+)$/.exec(String(ruta || ''));
    return m && ID.test(m[1]) ? m[1] : null;
  }

  // Qué pantalla toca con lo que contestó el servidor. `conCorreo`: si ya lo
  // dejó en esta visita (la corrida puede no traerlo todavía).
  function pantallaPara(c, conCorreo) {
    const estado = c && c.estado;
    if (estado === 'listo') return c.correo || conCorreo ? 'listo' : 'correo';
    if (estado === 'no_salio' || estado === 'sin_cobertura') return 'no-salio';
    if (estado === 'rechazada') return 'rechazada';
    if (estado === 'en_fila' && Number(c.lugar) >= FILA_DESDE) return 'fila';
    // recibida, al frente de la fila o armando (y un estado que no se conozca:
    // la espera no promete nada que no sea cierto)
    return 'espera';
  }

  const esFinal = c => FINALES.indexOf(c && c.estado) >= 0;

  // la firma del progreso para el sondeo: si cambia, el aviso y el tope
  // vuelven a contar (la fila que baja de lugar SÍ es progreso)
  const firma = c => [c && c.estado, c && c.paso, c && c.lugar].join('|');

  // 0..3: en qué paso va. Mientras no arma, en el primero.
  function indicePaso(c) {
    if (!c || c.estado !== 'armando') return 0;
    const i = PASOS.indexOf(c.paso);
    return i < 0 ? 0 : i;
  }

  // «calculamos unos N min»: conservador, por tandas del worker
  function minutosFila(lugar) {
    const n = Math.max(1, Math.floor(Number(lugar) || 1));
    return Math.ceil(n / CONCURRENCIA) * TARDA_MAX;
  }

  function reloj(seg) {
    const s = Math.max(0, Math.floor(Number(seg) || 0));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function minutos(seg) {
    return Math.max(1, Math.floor((Number(seg) || 0) / 60)) + ' min';
  }

  // La línea de tiempo de la espera (2 y 2d).
  function textoEspera(o) {
    const tarda = 'entre ' + TARDA_MIN + ' y ' + TARDA_MAX + ' min';
    if (o.tope) return 'Llevas ' + minutos(o.seg) + ' · lo normal es ' + tarda;
    if (o.estado !== 'armando') return 'Petición n.º ' + o.id + ' · empezamos en un momento';
    if (o.porEnlace) {
      const m = Math.floor((Number(o.seg) || 0) / 60);
      return 'Lo pediste ' + (m < 1 ? 'hace un momento' : 'hace ' + m + ' min') + ' · suele tardar ' + tarda;
    }
    return 'Llevas ' + reloj(o.seg) + ' · suele tardar ' + tarda;
  }

  // La línea de la fila (2b y 2c). `antes`: el primer lugar que vio.
  function textoFila(lugar, antes, conCorreo) {
    const n = Math.max(1, Math.floor(Number(lugar) || 1));
    const mins = minutosFila(n);
    if (!conCorreo) return 'Vas en el lugar ' + n + ' · calculamos unos ' + mins + ' min';
    const previo = Number(antes) > n ? ' · antes ibas en el ' + Math.floor(antes) : '';
    return 'Vas en el lugar ' + n + previo + ' · unos ' + mins + ' min';
  }

  // Caracteres, como los cuenta el servidor: sin espacios en las orillas y por
  // punto de código (un emoji es uno, no dos).
  const largo = texto => Array.from(String(texto || '').trim()).length;

  function estadoCampo(n, min, max) {
    if (n === 0) return 'vacio';
    if (n < min) return 'corto';
    if (n > max) return 'largo';
    return 'bien';
  }

  const tipoCorto = tipo => { const t = String(tipo || '').trim(); return t.slice(t.lastIndexOf('.') + 1); };
  const esDisparador = tipo => /trigger$/i.test(tipoCorto(tipo)) || /^webhook$/i.test(tipoCorto(tipo));

  // «n8n-nodes-base.googleSheets» → «Google Sheets». Si no se reconoce, limpio
  // tal cual: sin paquete, sin «Trigger» y con espacios («fooBar» → «Foo bar»).
  function nombreNodo(tipo) {
    const t = tipoCorto(tipo);
    const base = t.replace(/Trigger$/, '') || t;
    const conocido = NOMBRES_NODO[base.toLowerCase()];
    if (conocido) return conocido;
    const palabras = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_\-.]+/g, ' ').trim();
    if (!palabras) return 'Nodo';
    return palabras.charAt(0).toUpperCase() + palabras.slice(1).toLowerCase();
  }

  // Los nodos de la corrida listos para pintar. Las notas del lienzo de n8n
  // (stickyNote) no son pasos.
  function nodosLegibles(lista) {
    return (Array.isArray(lista) ? lista : [])
      .filter(t => typeof t === 'string' && !/stickynote$/i.test(tipoCorto(t)))
      .map(t => ({ nombre: nombreNodo(t), disparador: esDisparador(t) }));
  }

  // De dónde vino (RAG·10/28): los utm de la URL y el referrer si es de fuera.
  // Unos utm nuevos reemplazan a los viejos juntos (son una sola campaña);
  // volver desde /privacidad no borra el referrer de afuera.
  function origenDe(busqueda, referrer, miOrigen, previo) {
    const fuera = {};
    for (const k of UTM.concat('referrer')) {
      if (previo && typeof previo[k] === 'string' && previo[k]) fuera[k] = previo[k].slice(0, TOPE_ORIGEN);
    }
    let q = null;
    try { q = new URLSearchParams(busqueda || ''); } catch (e) { q = null; }
    if (q && UTM.some(k => q.get(k))) {
      for (const k of UTM) {
        const v = (q.get(k) || '').trim();
        if (v) fuera[k] = v.slice(0, TOPE_ORIGEN);
        else delete fuera[k];
      }
    }
    if (referrer) {
      let externo = false;
      try { externo = new URL(referrer).origin !== miOrigen; } catch (e) { externo = false; }
      if (externo) fuera.referrer = String(referrer).slice(0, TOPE_ORIGEN);
    }
    return fuera;
  }

  // La misma idea que server/publico_api.py: un @, dominio con punto, sin
  // espacios. El servidor manda; esto solo evita un viaje por un dedazo.
  function correoParece(c) {
    const s = String(c || '').trim();
    return s.length <= 254 && /^[^@\s,;<>]+@(?:[^@\s,;<>.]+\.)+[^@\s,;<>.]+$/.test(s);
  }

  // El título de 5a ya dice «Esta petición no la podemos armar»; si el
  // mensaje del servidor empieza igual, debajo va solo lo que agrega.
  function mensajeRechazo(m) {
    let t = String(m || '').trim();
    if (t.toLowerCase().indexOf(TITULO_RECHAZO.toLowerCase()) === 0) {
      t = t.slice(TITULO_RECHAZO.length).replace(/^[\s.:,;—–-]+/, '');
      // «…armar: pide mandar…» → «Pide mandar…»: abajo del título es otra frase
      t = t.charAt(0).toUpperCase() + t.slice(1);
    }
    return t || 'Prueba describiéndola de otra forma.';
  }

  const Automatiza = {
    FILA_DESDE, CONCURRENCIA, TARDA_MIN, TARDA_MAX, PASOS, NOMBRES_PASO, FINALES, ID,
    idDeRuta, pantallaPara, esFinal, firma, indicePaso, minutosFila, reloj, textoEspera,
    textoFila, largo, estadoCampo, nombreNodo, esDisparador, nodosLegibles, origenDe,
    correoParece, mensajeRechazo,
  };
  if (typeof module === 'object' && module && module.exports) module.exports = Automatiza;
  if (!raiz || !raiz.document) return;
  raiz.Automatiza = Automatiza;

  // ---------------------------------------------------------------------
  // la página

  const doc = raiz.document;
  const $ = (sel, dentro) => (dentro || doc).querySelector(sel);
  const $$ = (sel, dentro) => Array.from((dentro || doc).querySelectorAll(sel));

  const principal = $('#principal');
  // los topes llegan llenos del servidor; si la página se abriera cruda, los del freno
  const MIN = parseInt(principal.dataset.largoMinimo, 10) || 20;
  const MAX = parseInt(principal.dataset.largoMaximo, 10) || 1500;

  const TITULOS = {
    pedir: 'Automatiza con n8n', espera: 'Armando tu flujo', fila: 'En la fila',
    correo: 'Tu flujo está armado', listo: 'Tu flujo está listo', 'no-salio': 'No salió',
    rechazada: 'No la podemos armar', 'no-disponible': 'No disponible',
  };
  const CLAVE_BORRADOR = 'automatiza:borrador';
  const CLAVE_PEDIDO = 'automatiza:pedido';
  const CLAVE_ORIGEN = 'automatiza:origen';
  const SIN_RED = 'No pudimos conectar. Revisa tu conexión e intenta de nuevo.';

  // localStorage y sessionStorage pueden no estar (incógnito estricto, sin
  // permiso): nada de eso puede tumbar la página
  function leer(almacen, clave) {
    try { return raiz[almacen].getItem(clave); } catch (e) { return null; }
  }
  function escribir(almacen, clave, valor) {
    try {
      if (valor == null) raiz[almacen].removeItem(clave);
      else raiz[almacen].setItem(clave, valor);
      return true;
    } catch (e) { return false; }
  }
  function leerJson(almacen, clave) {
    try { return JSON.parse(leer(almacen, clave) || 'null'); } catch (e) { return null; }
  }
  function cambiarRuta(ruta) {
    try { raiz.history.replaceState(null, '', ruta); } catch (e) { /* sin history: se queda */ }
  }

  const estado = {
    pantalla: 'pedir',
    id: null,              // la corrida que se mira
    corrida: null,         // lo último que contestó el servidor
    porEnlace: false,      // llegó con /automatiza/c/<id>
    llevaSeg: 0, llevaDesde: 0,
    correoSesion: null,    // el que escribió en esta visita (completo)
    correoVer: null,       // el enmascarado del servidor
    cambiandoCorreo: false,
    lugarAntes: null,      // el primer lugar que vio en la fila
    tope: false,           // el sondeo dejó de mirar (alTope)
    firma: null,
    sondeo: null,
    pedido: leerJson('localStorage', CLAVE_PEDIDO),   // {id, texto}: «Lo que pediste»
    intento: false,        // ya tocó «Armar» (el aviso de corto sale desde ahí)
    mensajeServidor: null, // un 422 corto/largo que el navegador no vio venir
    enviando: false,
    guardado: false,
  };

  const tieneCorreo = () => !!(estado.correoSesion || estado.correoVer);
  const correoMostrar = () => estado.correoSesion || estado.correoVer || '';
  const llevaAhora = () => estado.llevaSeg + Math.max(0, (Date.now() - estado.llevaDesde) / 1000);
  const pedidoTexto = () => (estado.pedido && estado.pedido.id === estado.id && estado.pedido.texto) || '';

  // --- anuncios para lectores de pantalla (aria-live="polite") ---
  const anuncio = $('[data-anuncio]');
  let ultimoAnuncio = '';
  function anunciar(texto) {
    if (!texto || texto === ultimoAnuncio) return;
    ultimoAnuncio = texto;
    anuncio.textContent = '';
    raiz.setTimeout(() => { anuncio.textContent = texto; }, 60);
  }

  // --- cambiar de pantalla: una a la vez, y el foco a su título ---
  function mostrar(nombre, enfocar) {
    $('[data-buscando]').hidden = true;
    for (const s of $$('[data-pantalla]')) s.hidden = s.dataset.pantalla !== nombre;
    const cambio = estado.pantalla !== nombre;
    estado.pantalla = nombre;
    doc.title = (TITULOS[nombre] || TITULOS.pedir) + ' · Irremplazables';
    relojTick();
    if (cambio && enfocar !== false) enfocarTitulo();
  }
  function enfocarTitulo() {
    const h = $('[data-pantalla="' + estado.pantalla + '"] h1');
    raiz.scrollTo(0, 0);
    if (h) h.focus({ preventScroll: true });
  }

  // Mientras trabaja, el botón dice qué hace y no acepta otro clic (lo cuidan
  // las banderas de quien lo llama). aria-disabled y no disabled: un botón
  // deshabilitado suelta el foco al <body> (DISENO §4), y si la red falla el
  // foco tiene que seguir ahí.
  function ocupar(boton, si, texto) {
    if (si) {
      boton.dataset.texto = boton.textContent;
      // el mismo tamaño mientras trabaja (DISENO §5)
      boton.style.minWidth = boton.offsetWidth + 'px';
      boton.textContent = texto;
      boton.setAttribute('aria-disabled', 'true');
      boton.setAttribute('aria-busy', 'true');
    } else {
      if (boton.dataset.texto) boton.textContent = boton.dataset.texto;
      boton.removeAttribute('aria-disabled');
      boton.removeAttribute('aria-busy');
      boton.style.minWidth = '';
    }
  }
  const ocupado = boton => boton.getAttribute('aria-busy') === 'true';

  async function pedirJson(url, opciones) {
    const r = await raiz.fetch(url, Object.assign({
      cache: 'no-store', credentials: 'same-origin',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }, opciones || {}));
    let cuerpo = null;
    try { cuerpo = await r.json(); } catch (e) { cuerpo = null; }
    return { status: r.status, ok: r.ok, cuerpo };
  }

  // ---------------------------------------------------------------------
  // 1 · pedir (y 1b: el campo)

  const formPedir = $('[data-form-pedir]');
  const campo = $('#peticion');
  const cajaCampo = campo.closest('.campo');
  const pie = $('.campo-pie', cajaCampo);
  const cuenta = $('[data-cuenta]');
  const ayuda = $('[data-ayuda]');
  const ayudaVacia = Array.from(ayuda.childNodes).map(n => n.cloneNode(true));
  const errorCampo = $('[data-error-campo]');
  const botonArmar = $('[data-armar]');
  const avisoEnvio = $('[data-aviso-envio]');

  const MSG_CORTO = 'Cuéntanos un poco más: al menos ' + MIN + ' caracteres. Nombra las apps y qué pasa primero.';
  const MSG_LARGO = 'Es demasiado largo: máximo ' + MAX + ' caracteres. Quita lo que no sea un paso, o pide la otra parte en una segunda petición.';

  // El contador siempre a la vista, gris; rojo solo al pasarse (y ahí dice
  // cuántos sobran) o tras tocar «Armar» con muy poco. El botón NO se apaga:
  // al tocarlo sale el aviso y el foco vuelve al campo (lienzo 1b).
  function pintarCampo() {
    const n = largo(campo.value);
    const est = estadoCampo(n, MIN, MAX);
    const error = estado.mensajeServidor
      || (est === 'largo' ? MSG_LARGO : null)
      || ((est === 'corto' || est === 'vacio') && estado.intento ? MSG_CORTO : null);
    cuenta.textContent = n + ' / ' + MAX;
    cuenta.classList.toggle('fuera', !!error);
    pie.classList.toggle('escribiendo', n > 0);
    if (est === 'largo') ayuda.textContent = (n - MAX) + ' de más';
    else if (n > 0) ayuda.textContent = estado.guardado ? 'Guardado en este navegador' : '';
    else ayuda.replaceChildren(...ayudaVacia.map(x => x.cloneNode(true)));
    cajaCampo.classList.toggle('con-error', !!error);
    campo.setAttribute('aria-invalid', error ? 'true' : 'false');
    errorCampo.hidden = !error;
    $('[data-error-texto]', errorCampo).textContent = error || '';
  }

  function temblar(el) {
    el.classList.remove('tiembla');
    void el.offsetWidth;   // reinicia la animación si ya estaba
    el.classList.add('tiembla');
  }
  campo.addEventListener('animationend', () => campo.classList.remove('tiembla'));

  // el borrador se guarda mientras escribe: sobrevive a recargar, a «no
  // disponible» y a una petición rechazada
  let temporizadorBorrador = 0;
  function guardarBorrador() {
    raiz.clearTimeout(temporizadorBorrador);
    const texto = campo.value;
    estado.guardado = escribir('localStorage', CLAVE_BORRADOR, texto.trim() ? texto : null);
    pintarCampo();
  }

  campo.addEventListener('input', () => {
    estado.mensajeServidor = null;
    if (estadoCampo(largo(campo.value), MIN, MAX) === 'bien') estado.intento = false;
    avisoEnvio.hidden = true;
    pintarCampo();
    raiz.clearTimeout(temporizadorBorrador);
    temporizadorBorrador = raiz.setTimeout(guardarBorrador, 250);
  });
  // Ctrl/⌘ + Enter manda (Enter solo es un salto de línea)
  campo.addEventListener('keydown', ev => {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) {
      ev.preventDefault();
      if (typeof formPedir.requestSubmit === 'function') formPedir.requestSubmit();
      else botonArmar.click();
    }
  });

  function cursorAlFinal() {
    try { campo.setSelectionRange(campo.value.length, campo.value.length); } catch (e) { /* nada */ }
  }

  for (const b of $$('[data-idea]')) {
    b.addEventListener('click', () => {
      const actual = campo.value.trim();
      const esIdea = $$('[data-idea]').some(x => x.dataset.idea === actual);
      if (actual && !esIdea && !raiz.confirm('¿Cambiar lo que escribiste por este ejemplo?')) return;
      campo.value = b.dataset.idea;
      estado.mensajeServidor = null;
      estado.intento = false;
      guardarBorrador();
      campo.focus();
      cursorAlFinal();
    });
  }

  function mostrarAvisoEnvio(texto) {
    $('[data-aviso-envio-texto]').textContent = texto;
    avisoEnvio.hidden = false;
  }

  function origenGuardado() {
    return leerJson('sessionStorage', CLAVE_ORIGEN) || {};
  }

  formPedir.addEventListener('submit', async ev => {
    ev.preventDefault();
    if (estado.enviando) return;   // doble clic = una sola petición
    const texto = campo.value;
    avisoEnvio.hidden = true;
    $('[data-aviso-no-encontrada]').hidden = true;
    if (estadoCampo(largo(texto), MIN, MAX) !== 'bien') {
      estado.intento = true;
      pintarCampo();
      temblar(campo);
      campo.focus();
      return;
    }
    guardarBorrador();
    estado.enviando = true;
    ocupar(botonArmar, true, 'Enviando…');
    let r = null;
    try {
      r = await pedirJson('/api/publico/corridas', {
        method: 'POST', body: JSON.stringify(Object.assign({ texto }, origenGuardado())),
      });
    } catch (e) { r = null; }
    estado.enviando = false;
    ocupar(botonArmar, false);
    const c = r && r.cuerpo;
    if (!r) { mostrarAvisoEnvio(SIN_RED + ' Lo que escribiste sigue aquí.'); return; }
    if (r.status === 202 && c && ID.test(String(c.id || ''))) { aceptada(c, texto); return; }
    if (r.status === 422 && c && (c.motivo === 'corto' || c.motivo === 'largo')) {
      estado.mensajeServidor = c.mensaje || (c.motivo === 'corto' ? MSG_CORTO : MSG_LARGO);
      estado.intento = true;
      pintarCampo();
      temblar(campo);
      campo.focus();
      return;
    }
    if (r.status === 422 && c && c.motivo === 'rechazada') {
      estado.id = null;
      pintarRechazada(c.mensaje);
      mostrar('rechazada');
      return;
    }
    // todo freno del servidor (apagado, tope, throttling) es UNA pantalla
    if (r.status === 503 || r.status === 429) { pintarPausa(); mostrar('no-disponible'); return; }
    mostrarAvisoEnvio('Algo falló de nuestro lado. Intenta de nuevo en un momento: lo que escribiste sigue aquí.');
  });

  // 202: ya está en la fila. La URL pasa a ser el enlace para volver.
  function aceptada(c, texto) {
    estado.pedido = { id: c.id, texto: texto.trim() };
    escribir('localStorage', CLAVE_PEDIDO, JSON.stringify(estado.pedido));
    escribir('localStorage', CLAVE_BORRADOR, null);
    cambiarRuta('/automatiza/c/' + c.id);
    empezarCorrida(c.id, false);
    pintarCorrida(Object.assign({ estado: 'en_fila', lleva_seg: 0 }, c));
    // el 202 ya es una respuesta fresca: el primer vistazo espera su escalón
    mirar(false);
  }

  // ---------------------------------------------------------------------
  // la corrida: qué se pinta con cada respuesta del sondeo

  function empezarCorrida(id, porEnlace) {
    if (estado.sondeo) estado.sondeo.detener();
    Object.assign(estado, {
      id, corrida: null, porEnlace, llevaSeg: 0, llevaDesde: Date.now(), correoSesion: null,
      correoVer: null, cambiandoCorreo: false, lugarAntes: null, tope: false, firma: null, sondeo: null,
    });
    for (const f of $$('[data-form-correo]')) { f.reset(); errorCorreo(f, null); }
    avisoEspera('tardando', false);
    avisoEspera('conexion', false);
    $('[data-tope]').hidden = true;
    const url = raiz.location.origin + '/automatiza/c/' + id;
    for (const a of $$('[data-enlace-volver]')) {
      a.href = url;
      a.textContent = raiz.location.host + '/automatiza/c/' + id;
    }
    for (const s of $$('[data-id]')) s.textContent = id;
  }

  function mirar(inmediato) {
    if (estado.sondeo) estado.sondeo.detener();
    const S = raiz.Sondeo;
    if (!S || typeof S.iniciar !== 'function') { sinConexion(); return; }
    const id = estado.id;
    const mia = () => estado.id === id;
    estado.sondeo = S.iniciar({
      url: '/api/publico/corridas/' + encodeURIComponent(id),
      inmediato,
      progreso: firma,
      esFinal,
      alCambiar: c => { if (mia()) pintarCorrida(c); },
      alAviso: () => { if (mia()) { avisoEspera('tardando', true); anunciar('Está tardando más que de costumbre.'); } },
      alTope: () => { if (mia()) entrarTope(); },
      alConexion: ok => { if (mia()) { if (ok) avisoEspera('conexion', false); else sinConexion(); } },
      alError: () => { if (mia()) corridaPerdida(); },
    });
  }

  function sinConexion() {
    if (!$('[data-buscando]').hidden) {
      $('[data-buscando]').textContent = 'No pudimos conectar. Seguimos intentando…';
      return;
    }
    avisoEspera('conexion', true);
    anunciar('Se cortó tu conexión. Volvemos a preguntar en unos segundos.');
  }

  function avisoEspera(cual, si) {
    for (const a of $$('[data-aviso="' + cual + '"]')) a.hidden = !si;
    if (cual === 'conexion') for (const b of $$('[data-preguntar-ahora]')) b.hidden = !si;
  }

  // 404 (o cualquier 4xx que cancela): el enlace no lleva a ninguna corrida
  function corridaPerdida() {
    estado.id = null;
    cambiarRuta('/automatiza');
    $('[data-aviso-no-encontrada]').hidden = false;
    mostrar('pedir');
  }

  function pintarCorrida(c) {
    if (!c || typeof c !== 'object') return;
    const f = firma(c);
    if (estado.firma !== null && f !== estado.firma) avisoEspera('tardando', false);
    estado.firma = f;
    estado.corrida = c;
    if (estado.tope) salirTope();
    if (typeof c.lleva_seg === 'number') { estado.llevaSeg = c.lleva_seg; estado.llevaDesde = Date.now(); }
    if (typeof c.correo === 'string' && c.correo) estado.correoVer = c.correo;
    if (c.estado === 'en_fila' && estado.lugarAntes === null && Number(c.lugar) > 0) estado.lugarAntes = Number(c.lugar);
    const p = pantallaPara(c, tieneCorreo());
    if (p === 'espera') pintarEspera(c);
    else if (p === 'fila') pintarFila(c);
    else if (p === 'correo') pintarCorreo(c);
    else if (p === 'listo') pintarListo(c);
    else if (p === 'no-salio') pintarNoSalio(c);
    else if (p === 'rechazada') pintarRechazada(c.mensaje);
    if (estado.pantalla !== p) {
      if (p === 'listo' || p === 'correo') detenerSondeo();
      mostrar(p);
    }
  }

  function detenerSondeo() {
    if (estado.sondeo) estado.sondeo.detener();
  }

  function pintarCorreos() {
    for (const s of $$('[data-correo-ver]')) s.textContent = correoMostrar();
  }

  // --- 2 · espera ---
  const pasosEspera = $$('[data-pasos] li');
  function pintarEspera(c) {
    const armando = c.estado === 'armando';
    const i = indicePaso(c);
    $('[data-espera-titulo]').textContent = estado.porEnlace ? 'Tu flujo sigue en camino'
      : armando ? 'Estamos armando tu flujo' : 'Recibimos tu petición';
    $('[data-progreso]').hidden = !armando || estado.tope;
    $('[data-barra]').dataset.avance = String(i + 1);
    $('[data-paso-texto]').textContent = 'Paso ' + (i + 1) + ' de ' + PASOS.length;
    pasosEspera.forEach((li, k) => {
      li.classList.toggle('hecho', k < i);
      li.classList.toggle('actual', k === i);
      if (k === i) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      $('[data-paso-estado]', li).textContent = k < i ? ': hecho' : k === i ? ': en curso' : ': pendiente';
    });
    $('[data-pasos]').hidden = estado.tope;
    $('[data-espera-correo]').hidden = estado.tope;
    $('[data-espera-correo]').textContent = tieneCorreo()
      ? 'Ya tenemos tu correo (' + correoMostrar() + '): al terminar pasa directo a «Listo».'
      : 'Al terminar te pedimos tu correo para mandártelo';
    const texto = pedidoTexto();
    $('[data-lo-que-pediste]').hidden = !texto;
    $('[data-pedido-texto]').textContent = texto;
    relojTick();
    if (armando) anunciar('Paso ' + (i + 1) + ' de ' + PASOS.length + ': ' + NOMBRES_PASO[i] + '.');
  }

  // --- 2d · se pasó del tiempo: dejamos de mirar, el trabajo sigue ---
  function entrarTope() {
    estado.tope = true;
    avisoEspera('tardando', false);
    avisoEspera('conexion', false);
    const c = estado.corrida || { estado: 'en_fila' };
    pintarEspera(c);
    pintarTope();
    const yaEstaba = estado.pantalla === 'espera';
    mostrar('espera');
    if (yaEstaba) enfocarTitulo();
  }
  function pintarTope() {
    $('[data-espera-titulo]').textContent = 'Está tardando mucho más de lo normal';
    $('[data-progreso]').hidden = true;
    $('[data-pasos]').hidden = true;
    $('[data-espera-correo]').hidden = true;
    const tope = $('[data-tope]');
    tope.hidden = false;
    $('[data-form-correo]', tope).hidden = tieneCorreo();
    $('[data-correo-listo]', tope).hidden = !tieneCorreo();
    pintarCorreos();
    relojTick();
  }
  function salirTope() {
    estado.tope = false;
    $('[data-tope]').hidden = true;
    $('[data-pasos]').hidden = false;
    $('[data-espera-correo]').hidden = false;
  }
  $('[data-volver-a-mirar]').addEventListener('click', () => {
    salirTope();
    pintarCorrida(estado.corrida || { estado: 'en_fila' });
    enfocarTitulo();
    if (estado.sondeo) estado.sondeo.reanudar(); else mirar(true);
  });
  for (const b of $$('[data-preguntar-ahora]')) {
    b.addEventListener('click', () => { if (estado.sondeo) estado.sondeo.reanudar(); else mirar(true); });
  }

  // --- 2b · fila (y 2c: ya con correo) ---
  function pintarFila(c) {
    const lugar = Math.max(1, Math.floor(Number(c.lugar) || 1));
    const conCorreo = tieneCorreo() && !estado.cambiandoCorreo;
    const antes = $('[data-lugar]').textContent;
    $('[data-lugar]').textContent = String(lugar);
    $('[data-fila-titulo]').textContent = tieneCorreo() ? 'Listo. Ya puedes cerrar la pestaña.'
      : 'Hay mucha gente. Ya estás en la fila.';
    $('[data-fila-tiempo]').textContent = textoFila(lugar, estado.lugarAntes, tieneCorreo());
    $('[data-fila-con-correo]').hidden = !conCorreo;
    $('[data-pantalla="fila"] [data-form-correo]').hidden = conCorreo;
    $('[data-fila-quedate]').hidden = !conCorreo;
    $('[data-fila-sin-correo]').hidden = conCorreo;
    pintarCorreos();
    if (antes && antes !== String(lugar)) anunciar('Vas en el lugar ' + lugar + '.');
  }

  // --- 3 · correo ---
  const FLECHA = 'M5 12h14M13 6l6 6-6 6';
  function icono(d) {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  }
  function el(tag, clase, texto) {
    const e = doc.createElement(tag);
    if (clase) e.className = clase;
    if (texto != null) e.textContent = texto;
    return e;
  }
  function pintarCorreo(c) {
    const nodos = nodosLegibles(c.nodos);
    const cadena = $('[data-cadena]');
    cadena.replaceChildren(...nodos.map((n, i) => {
      const li = el('li');
      if (i > 0) li.appendChild(icono(FLECHA));
      li.appendChild(el('span', 'cadena-nodo', n.nombre));
      return li;
    }));
    $('[data-cadena-caja]').hidden = !nodos.length;
  }

  // --- 4 · listo ---
  function urlDescarga(c) {
    const d = c && c.descarga;
    if (typeof d === 'string' && /^\/api\/publico\/corridas\/[A-Za-z0-9_-]{16}\/flujo\.json$/.test(d)) return d;
    return estado.id ? '/api/publico/corridas/' + estado.id + '/flujo.json' : null;
  }
  function pintarListo(c) {
    pintarCorreos();
    $('[data-listo-correo]').hidden = !tieneCorreo();
    const texto = pedidoTexto();
    $('[data-listo-pedido]').hidden = !texto;
    $('[data-listo-pedido]').textContent = texto ? '«' + texto + '»' : '';
    const nodos = nodosLegibles(c.nodos);
    $('[data-nodos]').replaceChildren(...nodos.map((n, i) => {
      const li = el('li');
      li.appendChild(el('span', 'nodo-n', String(i + 1)));
      li.appendChild(el('span', 'nodo-nombre', n.nombre));
      li.appendChild(el('span', 'nodo-que', n.disparador ? 'Arranca el flujo' : ''));
      return li;
    }));
    $('[data-nodos]').hidden = !nodos.length;
    const href = urlDescarga(c);
    if (href) $('[data-descargar]').href = href;
  }
  function descargar() {
    const href = urlDescarga(estado.corrida);
    if (!href) return;
    const a = el('a');
    a.href = href;
    a.download = '';
    a.hidden = true;
    doc.body.appendChild(a);
    a.click();
    a.remove();
  }

  // --- 5 · no salió ---
  function pintarNoSalio(c) {
    const m = $('[data-pantalla="no-salio"] [data-mensaje]');
    m.textContent = c.mensaje || 'Esta vez no pudimos armar un flujo que importe bien en n8n. Preferimos no darte uno roto.';
    // solo el número y el estado: nunca un motivo interno
    $('[data-detalles]').textContent = 'Petición n.º ' + (estado.id || c.id || '') + '\nEstado: ' + c.estado;
    const conCorreo = tieneCorreo() && !estado.cambiandoCorreo;
    $('[data-pantalla="no-salio"] [data-form-correo]').hidden = conCorreo;
    $('[data-pantalla="no-salio"] [data-correo-listo]').hidden = !conCorreo;
    pintarCorreos();
  }

  // --- 5a · rechazada ---
  function pintarRechazada(mensaje) {
    $('[data-pantalla="rechazada"] [data-mensaje]').textContent = mensajeRechazo(mensaje);
    // con el enlace desde otro navegador no hay texto que conservar: no se promete
    $('[data-texto-sigue]').hidden = !(pedidoTexto() || campo.value.trim());
  }

  // «Describirlo de otra forma»: de vuelta al formulario CON su texto
  function otraForma() {
    const texto = pedidoTexto() || campo.value;
    detenerSondeo();
    estado.id = null;
    estado.corrida = null;
    cambiarRuta('/automatiza');
    campo.value = texto;
    estado.intento = false;
    estado.mensajeServidor = null;
    guardarBorrador();
    mostrar('pedir', false);
    raiz.scrollTo(0, 0);
    campo.focus();
    cursorAlFinal();
  }
  for (const b of $$('[data-otra-forma]')) b.addEventListener('click', otraForma);

  // --- 6 · no disponible ---
  function pintarPausa() {
    const hay = !!campo.value.trim();
    if (hay) guardarBorrador();
    for (const e of $$('[data-si-borrador]')) e.hidden = !hay;
    $('[data-sigue-pausa]').hidden = true;
  }
  $('[data-reintentar]').addEventListener('click', async ev => {
    const b = ev.currentTarget;
    if (ocupado(b)) return;
    ocupar(b, true, 'Revisando…');
    let disponible = null;
    try {
      const r = await pedirJson('/api/publico/estado');
      if (r.ok && r.cuerpo) disponible = r.cuerpo.disponible !== false;
    } catch (e) { disponible = null; }
    ocupar(b, false);
    if (disponible) { mostrar('pedir'); return; }
    $('[data-sigue-pausa]').hidden = false;
  });

  // ---------------------------------------------------------------------
  // los formularios de correo (2b, 2d, 3 y 5): el mismo cable

  function errorCorreo(f, texto) {
    const caja = $('[data-error-correo]', f);
    const input = $('input[type=email]', f);
    caja.hidden = !texto;
    $('[data-error-texto]', caja).textContent = texto || '';
    input.classList.toggle('con-error', !!texto);
    input.setAttribute('aria-invalid', texto ? 'true' : 'false');
    if (texto) temblar(input);
  }

  async function mandarCorreo(f) {
    if (f.dataset.enviando) return;
    const input = $('input[type=email]', f);
    const casilla = $('input[name=recontacto]', f);
    const boton = $('button[type=submit]', f);
    const correo = input.value.trim();
    errorCorreo(f, null);
    if (!correoParece(correo)) {
      errorCorreo(f, 'Revisa tu correo: parece que le falta algo.');
      input.focus();
      return;
    }
    const id = estado.id;
    if (!id) return;
    f.dataset.enviando = '1';
    ocupar(boton, true, 'Mandando…');
    let r = null;
    try {
      r = await pedirJson('/api/publico/corridas/' + encodeURIComponent(id) + '/correo', {
        method: 'POST',
        // el texto de la casilla y la versión del aviso los pone el servidor
        body: JSON.stringify({ correo, recontacto: !!(casilla && casilla.checked), origen: f.dataset.origen }),
      });
    } catch (e) { r = null; }
    delete f.dataset.enviando;
    ocupar(boton, false);
    if (estado.id !== id) return;
    if (!r) { errorCorreo(f, SIN_RED); input.focus(); return; }
    if (r.ok && r.cuerpo && r.cuerpo.ok) { correoGuardado(f, correo, r.cuerpo.correo); return; }
    errorCorreo(f, (r.cuerpo && r.cuerpo.mensaje) || 'Algo falló al mandarlo. Intenta de nuevo en un momento.');
    input.focus();
  }
  for (const f of $$('[data-form-correo]')) {
    f.addEventListener('submit', ev => { ev.preventDefault(); mandarCorreo(f); });
  }

  function correoGuardado(f, correo, enmascarado) {
    // tal como lo guarda el servidor: en minúsculas y sin espacios
    estado.correoSesion = correo.toLowerCase();
    if (enmascarado) estado.correoVer = enmascarado;
    estado.cambiandoCorreo = false;
    pintarCorreos();
    const c = estado.corrida || {};
    if (f.dataset.origen === 'listo') {
      descargar();
      pintarListo(c);
      mostrar('listo');
      return;
    }
    if (estado.tope) {
      pintarTope();
      enfocar($('[data-tope] [data-correo-listo]'));
      return;
    }
    if (estado.pantalla === 'fila') {
      pintarFila(c);
      enfocarTitulo();
      return;
    }
    if (estado.pantalla === 'no-salio') {
      pintarNoSalio(c);
      enfocar($('[data-pantalla="no-salio"] [data-correo-listo]'));
    }
  }
  function enfocar(e) {
    if (!e) return;
    e.setAttribute('tabindex', '-1');
    e.focus();
  }

  for (const b of $$('[data-cambiar-correo]')) {
    b.addEventListener('click', () => {
      estado.cambiandoCorreo = true;
      const c = estado.corrida || {};
      if (estado.pantalla === 'fila') pintarFila(c);
      else if (estado.pantalla === 'no-salio') pintarNoSalio(c);
      const input = $('[data-pantalla="' + estado.pantalla + '"] [data-form-correo] input[type=email]');
      if (input) input.focus();
    });
  }

  // ---------------------------------------------------------------------
  // el reloj de la espera: «Llevas 1:12»

  function relojTick() {
    cuentaSiguiente();
    // sin ninguna respuesta todavía solo cabe el tope (la red nunca contestó)
    if (estado.pantalla !== 'espera' || !(estado.corrida || estado.tope)) return;
    $('[data-espera-tiempo]').textContent = textoEspera({
      estado: (estado.corrida || {}).estado, id: estado.id, seg: llevaAhora(),
      porEnlace: estado.porEnlace, tope: estado.tope,
    });
  }

  // «Volvemos a preguntar en 8 s» (lienzo 2d): lo dice el sondeo; mientras
  // la petición vuela (o si no lo sabe) queda «en unos segundos»
  function cuentaSiguiente() {
    const ms = estado.sondeo ? estado.sondeo.siguienteEn : null;
    const texto = typeof ms === 'number' ? 'en ' + Math.max(1, Math.ceil(ms / 1000)) + ' s' : 'en unos segundos';
    for (const s of $$('[data-siguiente]')) if (s.textContent !== texto) s.textContent = texto;
  }

  // ---------------------------------------------------------------------
  // al abrir

  // el aviso simplificado vive en DOS plantillas del HTML (la completa para la
  // pantalla 3, la compacta para los demás formularios): se copia a cada hueco
  function montarAvisos() {
    const completo = $('#plantilla-aviso');
    const compacto = $('#plantilla-aviso-compacto') || completo;
    $$('[data-aviso-aqui]').forEach((hueco, i) => {
      const plantilla = hueco.hasAttribute('data-completo') ? completo : compacto;
      if (!plantilla || !plantilla.content || !plantilla.content.firstElementChild) return;
      const copia = plantilla.content.firstElementChild.cloneNode(true);
      if (!hueco.hasAttribute('data-completo')) copia.classList.add('compacto');
      const h = $('h2', copia);
      h.id = 'aviso-simplificado-' + (i + 1);
      copia.setAttribute('aria-labelledby', h.id);
      hueco.replaceWith(copia);
    });
  }

  function guardarOrigen() {
    let miOrigen = '';
    try { miOrigen = raiz.location.origin; } catch (e) { miOrigen = ''; }
    const o = origenDe(raiz.location.search, doc.referrer, miOrigen, origenGuardado());
    escribir('sessionStorage', CLAVE_ORIGEN, JSON.stringify(o));
  }

  function restaurarBorrador() {
    const b = leer('localStorage', CLAVE_BORRADOR);
    if (b && !campo.value) { campo.value = b; estado.guardado = true; }
    pintarCampo();
  }

  async function comprobarEstado() {
    let r = null;
    try { r = await pedirJson('/api/publico/estado'); } catch (e) { r = null; }
    // solo si sigue en el formulario sin haber mandado nada
    if (r && r.ok && r.cuerpo && r.cuerpo.disponible === false
        && estado.pantalla === 'pedir' && !estado.enviando && !estado.id) {
      pintarPausa();
      mostrar('no-disponible', false);
    }
  }

  function entrarPorEnlace(id) {
    // nunca otra vez en el formulario: mientras llega la corrida, «Buscando…»
    $('[data-pantalla="pedir"]').hidden = true;
    $('[data-buscando]').hidden = false;
    estado.pantalla = null;
    empezarCorrida(id, true);
    mirar(true);
  }

  guardarOrigen();
  montarAvisos();
  restaurarBorrador();
  const idEnlace = idDeRuta(raiz.location.pathname);
  if (idEnlace) entrarPorEnlace(idEnlace);
  else comprobarEstado();
  raiz.setInterval(relojTick, 1000);
})(typeof window !== 'undefined' ? window : null);
