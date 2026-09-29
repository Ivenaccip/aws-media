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
igual(A.minutosFila(1), 3, 'lugar 1: una tanda');
igual(A.minutosFila(2), 3, 'lugar 2: la misma tanda (el worker arma de 2 en 2)');
igual(A.minutosFila(3), 6, 'lugar 3: segunda tanda');
igual(A.minutosFila(12), 18, 'lugar 12: ceil(12/2) × 3');
igual(A.minutosFila(0), 3, 'un lugar raro no da 0 min');
igual(A.minutosFila('x'), 3, 'un lugar que no es número tampoco');

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

igual(A.textoFila(12, 12, false), 'Vas en el lugar 12 · calculamos unos 18 min', 'la fila');
igual(A.textoFila(7, 12, true), 'Vas en el lugar 7 · antes ibas en el 12 · unos 12 min', 'la fila con correo');
igual(A.textoFila(7, 7, true), 'Vas en el lugar 7 · unos 12 min', 'sin avance no dice «antes ibas»');
igual(A.textoFila(7, null, true), 'Vas en el lugar 7 · unos 12 min', 'sin lugar previo tampoco');

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
igual(A.origenDe('', 'https://www.instagram.com/', MIO, null), { referrer: 'https://www.instagram.com/' },
  'el referrer de afuera');
igual(A.origenDe('', MIO + '/privacidad', MIO, { utm_source: 'ig', referrer: 'https://x.com/' }),
  { utm_source: 'ig', referrer: 'https://x.com/' }, 'volver desde /privacidad no borra nada');
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

console.log(`automatiza: ${comprobaciones} comprobaciones OK`);
