// Arnés de la lógica de static/automatiza.js fuera del navegador (lo corre
// test_rag_pagina_logica.py).
//
// Aquí no se prueba lo que se ve —eso lo mira Playwright con la API simulada—
// sino las decisiones que pueden mentirle al visitante: qué pantalla toca con
// cada respuesta, cuánto dice que falta, qué cuenta el campo, cómo se llaman
// los nodos y qué origen viaja con la petición. automatiza.js exporta esa
// parte con module.exports y, sin `document`, no toca nada más.
'use strict';
const assert = require('assert');
const path = require('path');

const A = require(path.join(__dirname, '..', 'static', 'automatiza.js'));

let comprobaciones = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); comprobaciones++; };
const igual = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); comprobaciones++; };

// --- el enlace para volver ---------------------------------------------------
const ID = 'AbCdEfGhIjKlMn_-';
igual(A.idDeRuta('/automatiza/c/' + ID), ID, 'no leyó el id del enlace');
igual(A.idDeRuta('/automatiza'), null, '/automatiza no es un enlace para volver');
igual(A.idDeRuta('/automatiza/c/corto'), null, 'un id corto no es un id');
igual(A.idDeRuta('/automatiza/c/' + ID + 'x'), null, 'un id largo no es un id');
igual(A.idDeRuta('/automatiza/c/' + ID + '/'), null, 'con barra final no es la forma exacta');
igual(A.idDeRuta('/otra/c/' + ID), null, 'otra ruta no es el enlace');
igual(A.idDeRuta('/automatiza/c/AAAAAAAAAAAAAAA.'), null, 'un punto no es del alfabeto del id');
igual(A.idDeRuta(undefined), null, 'sin ruta, nada');
// un enlace cortado: el servidor da 404 con la misma página y aquí se avisa
ok(A.enlaceRoto('/automatiza/c/AAAAAAAAAAAAAAA') && A.enlaceRoto('/automatiza/c/' + ID + 'x'), 'un id cortado o largo es un enlace roto');
ok(!A.enlaceRoto('/automatiza/c/' + ID) && !A.enlaceRoto('/automatiza') && !A.enlaceRoto('/privacidad') && !A.enlaceRoto(undefined),
  'el enlace bueno y las otras rutas no son un enlace roto');

// --- qué pantalla toca -----------------------------------------------------
const P = A.pantallaPara;
igual(P({ estado: 'recibida' }), 'espera', 'recibida es la espera');
igual(P({ estado: 'en_fila', lugar: 1 }), 'espera', 'al frente de la fila es la espera con pasos');
igual(P({ estado: 'en_fila', lugar: A.FILA_DESDE - 1 }), 'espera', 'justo antes del umbral sigue en la espera');
igual(P({ estado: 'en_fila', lugar: A.FILA_DESDE }), 'fila', 'desde FILA_DESDE es «hay mucha gente»');
igual(P({ estado: 'en_fila', lugar: 40 }), 'fila', 'lugar 40 es la fila');
igual(P({ estado: 'en_fila' }), 'espera', 'sin lugar no se inventa una fila');
igual(P({ estado: 'armando', paso: 'armar' }), 'espera', 'armando es la espera');
igual(P({ estado: 'listo' }), 'correo', 'listo sin correo pide el correo');
igual(P({ estado: 'listo', correo: 'gu•••@gmail.com' }), 'listo', 'listo con correo va directo a «Listo»');
igual(P({ estado: 'listo' }, true), 'listo', 'si lo dejó en esta visita tampoco se lo vuelve a pedir');
igual(P({ estado: 'no_salio' }), 'no-salio', 'no_salio');
igual(P({ estado: 'sin_cobertura' }), 'no-salio', 'sin_cobertura es la misma pantalla');
igual(P({ estado: 'rechazada' }), 'rechazada', 'rechazada');
igual(P({ estado: 'algo_nuevo' }), 'espera', 'un estado desconocido no promete nada: espera');
igual(P(null), 'espera', 'sin cuerpo, espera');
// escribiendo el correo en la fila: la fila no se le quita de enfrente hasta que termine
igual(P({ estado: 'en_fila', lugar: 2 }, false, true), 'fila', 'la fila avanzó al lugar 2 mientras escribe: se queda');
igual(P({ estado: 'armando', paso: 'entender' }, false, true), 'fila', 'empezó a armarse mientras escribe: se queda');
igual(P({ estado: 'listo' }, false, true), 'correo', 'ya terminó: la pantalla 3 le pide el correo');
igual(P({ estado: 'no_salio' }, false, true), 'no-salio', 'un final siempre gana');
igual(P({ estado: 'en_fila', lugar: 2 }, false, false), 'espera', 'sin escribir, el lugar 2 es la espera');
igual(A.FILA_DESDE, 3, 'FILA_DESDE es 3 (contrato)');

ok(A.esFinal({ estado: 'listo' }) && A.esFinal({ estado: 'no_salio' })
  && A.esFinal({ estado: 'sin_cobertura' }) && A.esFinal({ estado: 'rechazada' }), 'los cuatro finales');
ok(!A.esFinal({ estado: 'en_fila' }) && !A.esFinal({ estado: 'armando' }) && !A.esFinal(null), 'lo demás no es final');

// la firma del progreso: cambia con el paso y con el lugar (la fila que avanza SÍ es progreso)
ok(A.firma({ estado: 'en_fila', lugar: 7 }) !== A.firma({ estado: 'en_fila', lugar: 6 }), 'el lugar no movió la firma');
ok(A.firma({ estado: 'armando', paso: 'buscar' }) !== A.firma({ estado: 'armando', paso: 'armar' }), 'el paso no movió la firma');
igual(A.firma({ estado: 'armando', paso: 'buscar', lleva_seg: 1 }), A.firma({ estado: 'armando', paso: 'buscar', lleva_seg: 99 }),
  'el reloj NO es progreso: si no, el tope nunca llegaría');

// --- los pasos ---------------------------------------------------------------
igual(A.PASOS, ['entender', 'buscar', 'armar', 'revisar'], 'los cuatro pasos, en orden');
A.PASOS.forEach((p, i) => igual(A.indicePaso({ estado: 'armando', paso: p }), i, 'índice de ' + p));
igual(A.indicePaso({ estado: 'armando' }), 0, 'armando sin paso anotado: el primero');
igual(A.indicePaso({ estado: 'armando', paso: 'inventado' }), 0, 'un paso raro no rompe la barra');
igual(A.indicePaso({ estado: 'en_fila', paso: 'revisar' }), 0, 'fuera de armando el paso no cuenta');

// --- los tiempos ---------------------------------------------------------------
igual([A.TARDA_MIN, A.TARDA_MAX], [1, 3], 'TARDA_MIN/TARDA_MAX provisionales del contrato');
// hasta que ESTÁ LISTO, en el peor caso: el lugar no cuenta las 2 que ya se
// arman, así que el lugar 1 espera una tanda y se arma en otra
igual(A.minutosFila(1), 6, 'lugar 1: la tanda que se arma + la suya');
igual(A.minutosFila(2), 6, 'lugar 2: igual (el worker arma de 2 en 2)');
igual(A.minutosFila(3), 9, 'lugar 3: empieza hacia el 6 y termina hacia el 9');
igual(A.minutosFila(12), 21, 'lugar 12: (ceil(12/2) + 1) × 3');
igual(A.minutosFila(0), 6, 'un lugar raro no da 0 min');
igual(A.minutosFila('x'), 6, 'un lugar que no es número tampoco');

igual(A.reloj(0), '0:00', 'reloj en cero');
igual(A.reloj(72), '1:12', 'Llevas 1:12');
igual(A.reloj(600.9), '10:00', 'sin décimas');
igual(A.reloj(-5), '0:00', 'nunca negativo');

igual(A.textoEspera({ estado: 'armando', seg: 72 }), 'Llevas 1:12 · suele tardar entre 1 y 3 min', 'la espera');
igual(A.textoEspera({ estado: 'en_fila', id: ID, seg: 3 }), 'Petición n.º ' + ID + ' · empezamos en un momento',
  'recién enviada');
igual(A.textoEspera({ estado: 'armando', seg: 372, porEnlace: true }), 'Lo pediste hace 6 min · suele tardar entre 1 y 3 min',
  'volviste con el enlace');
igual(A.textoEspera({ estado: 'armando', seg: 20, porEnlace: true }), 'Lo pediste hace un momento · suele tardar entre 1 y 3 min',
  'volviste enseguida');
igual(A.textoEspera({ estado: 'armando', seg: 660, tope: true }), 'Llevas 11 min · lo normal es entre 1 y 3 min',
  'se pasó del tiempo');

igual(A.textoFila(12, 12, false), 'Vas en el lugar 12 · calculamos unos 21 min', 'la fila');
igual(A.textoFila(7, 12, true), 'Vas en el lugar 7 · antes ibas en el 12 · unos 15 min', 'la fila con correo');
igual(A.textoFila(7, 7, true), 'Vas en el lugar 7 · unos 15 min', 'sin avance no dice «antes ibas»');
igual(A.textoFila(7, null, true), 'Vas en el lugar 7 · unos 15 min', 'sin lugar previo tampoco');

// --- el campo (1b) --------------------------------------------------------------
igual(A.largo('  hola  '), 4, 'cuenta sin las orillas, como el servidor');
igual(A.largo('🙂🙂'), 2, 'un emoji es UN carácter (punto de código), no dos');
igual(A.largo(''), 0, 'vacío');
igual(A.largo(null), 0, 'null');
igual(A.estadoCampo(0, 20, 1500), 'vacio', 'vacío');
igual(A.estadoCampo(19, 20, 1500), 'corto', '19 es corto');
igual(A.estadoCampo(20, 20, 1500), 'bien', '20 ya alcanza');
igual(A.estadoCampo(1500, 20, 1500), 'bien', '1500 cabe');
igual(A.estadoCampo(1501, 20, 1500), 'largo', '1501 se pasa');

// --- los nodos ------------------------------------------------------------------
igual(A.nombreNodo('n8n-nodes-base.gmailTrigger'), 'Gmail', 'el disparador de Gmail es Gmail');
igual(A.nombreNodo('n8n-nodes-base.googleSheets'), 'Google Sheets', 'Google Sheets');
igual(A.nombreNodo('n8n-nodes-base.filter'), 'Filtro', 'filter en español');
igual(A.nombreNodo('n8n-nodes-base.manualTrigger'), 'Inicio manual', 'el del flujo de mentira');
igual(A.nombreNodo('n8n-nodes-base.set'), 'Editar campos', 'set');
igual(A.nombreNodo('@n8n/n8n-nodes-langchain.agent'), 'Agente de IA', 'con paquete de dos partes');
igual(A.nombreNodo('acme-nodes.fooBarBaz'), 'Foo bar baz', 'uno desconocido sale limpio');
igual(A.nombreNodo('n8n-nodes-base.someThingTrigger'), 'Some thing', 'sin «Trigger»');
igual(A.nombreNodo(''), 'Nodo', 'vacío no rompe');
ok(A.esDisparador('n8n-nodes-base.gmailTrigger') && A.esDisparador('n8n-nodes-base.webhook'), 'disparadores');
ok(!A.esDisparador('n8n-nodes-base.googleSheets'), 'Sheets no es disparador');
igual(A.nodosLegibles(['n8n-nodes-base.manualTrigger', 'n8n-nodes-base.stickyNote', 'n8n-nodes-base.set', 42, null]),
  [{ nombre: 'Inicio manual', disparador: true }, { nombre: 'Editar campos', disparador: false }],
  'sin notas del lienzo ni basura');
igual(A.nodosLegibles(undefined), [], 'sin nodos, lista vacía');

// --- de dónde vino (RAG·10) -------------------------------------------------------
const MIO = 'https://irremplazables.xyz';
igual(A.origenDe('?utm_source=ig&utm_campaign=oct', '', MIO, null), { utm_source: 'ig', utm_campaign: 'oct' },
  'los utm de la URL');
igual(A.origenDe('', 'https://www.instagram.com/', MIO, null), { referrer: 'https://www.instagram.com' },
  'el sitio de afuera');
// del referrer, SOLO el sitio: la ruta y el query de otro sitio pueden traer tokens o correos
igual(A.origenDe('', 'https://externo.example/articulo?token=abc#x', MIO, null), { referrer: 'https://externo.example' },
  'sin ruta, query ni ancla');
igual(A.origenDe('', 'https://ana:clave@externo.example:8443/p', MIO, null), { referrer: 'https://externo.example:8443' },
  'sin usuario ni contraseña');
igual(A.origenDe('', 'android-app://com.google.android.gm/', MIO, null), { referrer: 'android-app://com.google.android.gm' },
  'una app también dice de dónde');
igual(A.origenDe('', MIO + '/privacidad', MIO, { utm_source: 'ig', referrer: 'https://x.com/un/post?id=9' }),
  { utm_source: 'ig', referrer: 'https://x.com' }, 'volver desde /privacidad no borra nada, y lo guardado entero se recorta');
igual(A.sitioDe('no es url'), null, 'sin URL no hay sitio');
igual(A.origenDe('?utm_source=wa', '', MIO, { utm_source: 'ig', utm_campaign: 'oct' }), { utm_source: 'wa' },
  'una campaña nueva reemplaza a la vieja entera');
igual(A.origenDe('?x=1', '', MIO, { utm_medium: 'post' }), { utm_medium: 'post' }, 'sin utm nuevos se queda lo guardado');
igual(A.origenDe('?utm_source=' + 'a'.repeat(900), '', MIO, null).utm_source.length, 500, 'tope de 500 como la base');
igual(A.origenDe('', 'no es url', MIO, null), {}, 'un referrer roto no se guarda');
igual(A.origenDe('', '', MIO, { otra: 'cosa' }), {}, 'solo viajan las claves conocidas');

// --- el correo ----------------------------------------------------------------------
for (const c of ['tu@correo.com', 'a.b+c@sub.dominio.mx', 'GU@Gmail.COM'])
  ok(A.correoParece(c), 'debería parecer correo: ' + c);
for (const c of ['', 'tu@correo', 'tu correo@x.com', 'a@b@c.com', 'a@b.com,c@d.com', 'a@.com', '@x.com',
  'a'.repeat(250) + '@x.com'])
  ok(!A.correoParece(c), 'no debería parecer correo: ' + c);

// --- el correo de esta pestaña vs el del servidor (se cambió en otra) --------------------
ok(A.sigueSiendoMio('pr•••@ejemplo.mx', 'pr•••@ejemplo.mx'), 'el mismo: se sigue enseñando el completo');
ok(!A.sigueSiendoMio('pr•••@ejemplo.mx', 'se•••@otro.mx'), 'otro: se enseña el del servidor');
ok(A.sigueSiendoMio('pr•••@ejemplo.mx', undefined) && A.sigueSiendoMio(null, 'se•••@otro.mx'), 'sin dato, nada cambia');

// --- 5a ---------------------------------------------------------------------------------
igual(A.mensajeRechazo('Esta petición no la podemos armar. Prueba describiéndola de otra forma.'),
  'Prueba describiéndola de otra forma.', 'no repite el título');
igual(A.mensajeRechazo('Eso se parece a mandar mensajes a mucha gente que no pidió recibirlos.'),
  'Eso se parece a mandar mensajes a mucha gente que no pidió recibirlos.', 'el del revisor, tal cual');
igual(A.mensajeRechazo('Esta petición no la podemos armar: pide mandar mensajes a gente que no pidió recibirlos.'),
  'Pide mandar mensajes a gente que no pidió recibirlos.', 'lo que queda tras el título empieza con mayúscula');
igual(A.mensajeRechazo(''), 'Prueba describiéndola de otra forma.', 'sin mensaje, el general');
igual(A.mensajeRechazo('Esta petición no la podemos armar.'), 'Prueba describiéndola de otra forma.',
  'solo el título: el general');

// --- el aviso de privacidad (RAG·13): cuándo sale el diálogo -------------------------
// Sale la primera vez que manda algo y ya no, mientras sea la MISMA versión.
// Un almacén de mentira (como localStorage) y uno que truena en todo.
function almacen() {
  const datos = {};
  return { getItem: k => (k in datos ? datos[k] : null), setItem: (k, v) => { datos[k] = String(v); },
    removeItem: k => { delete datos[k]; }, datos };
}
const truena = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
const V = '2026-09-29-borrador';
igual(A.CLAVE_AVISO, 'automatiza:aviso', 'la llave del aviso aceptado');

const ls = almacen();
igual(A.avisoGuardado(ls), null, 'navegador nuevo: nada aceptado');
ok(A.avisoPendiente(V, A.avisoGuardado(ls), null), 'la primera vez sale el aviso');
ok(A.guardarAviso(ls, V), 'aceptar guarda la versión');
igual(ls.datos['automatiza:aviso'], V, 'se guarda la versión, no un «sí»');
ok(!A.avisoPendiente(V, A.avisoGuardado(ls), null), 'ya aceptó esta versión: no vuelve a salir');
// el dueño cambió el texto y subió AVISO_VERSION: se vuelve a pedir
ok(A.avisoPendiente('2026-10-06', A.avisoGuardado(ls), null), 'otra versión: vuelve a salir');
ok(A.avisoPendiente(V, 'si', null) && A.avisoPendiente(V, 'true', null), 'un valor que no es la versión no cuenta');
// sin versión en la página (la sirvieron cruda) se pide siempre: el servidor tampoco aceptaría
ok(A.avisoPendiente('', '', '') && A.avisoPendiente('', null, null), 'sin versión, siempre se pide');

// localStorage bloqueado (incógnito estricto, sin permiso): no tumba nada
igual(A.avisoGuardado(truena), null, 'leer un almacén que truena = nada aceptado');
igual(A.avisoGuardado(null), null, 'sin almacén = nada aceptado');
ok(!A.guardarAviso(truena, V), 'guardar en un almacén que truena dice que no');
ok(!A.guardarAviso(null, V), 'sin almacén, guardar dice que no');
// …pero en esta visita ya aceptó: no se le vuelve a pedir en el correo
ok(!A.avisoPendiente(V, A.avisoGuardado(truena), V), 'aceptado en esta visita, aunque no se guardó');
// …y en la próxima visita (memoria vacía) sí se vuelve a pedir
ok(A.avisoPendiente(V, A.avisoGuardado(truena), null), 'la próxima visita sin almacén: se vuelve a pedir');
// en memoria una versión vieja no cuenta
ok(A.avisoPendiente('2026-10-06', null, V), 'la versión aceptada en memoria tiene que ser la vigente');

console.log(`automatiza: ${comprobaciones} comprobaciones OK`);
