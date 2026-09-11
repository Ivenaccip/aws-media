// Arnés del componente `orbe` fuera del navegador (lo corre test_m19_orbe.py).
//
// Aquí NO se prueba lo que se ve —eso no se puede sin GPU— sino la lógica de
// TIEMPO, que es la que puede mentirle al usuario: el tope de paciencia, el
// cronómetro, el latido que reinicia el reloj cuando el trabajo avanza, y la
// idempotencia por contenedor. Con `navigator.gpu` ausente, orbe.js se queda
// en su píldora CSS, que es exactamente el camino que queremos auditar.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

// --- un DOM mínimo, solo lo que orbe.js toca ------------------------------
function nodo(tag) {
  const n = {
    tagName: tag, hijos: [], parentNode: null, textContent: '', className: '',
    attrs: {}, style: { setProperty() {} },
    setAttribute(k, v) { n.attrs[k] = v; },
    appendChild(h) { h.parentNode = n; n.hijos.push(h); return h; },
    removeChild(h) {
      const i = n.hijos.indexOf(h);
      if (i >= 0) n.hijos.splice(i, 1);
      h.parentNode = null;
      return h;
    },
  };
  const clases = new Set();
  n.classList = {
    add: c => clases.add(c), remove: c => clases.delete(c),
    contains: c => clases.has(c),
    toggle: (c, on) => (on ? clases.add(c) : clases.delete(c)),
  };
  return n;
}

const doc = nodo('#document');
doc.head = nodo('head');
doc.hidden = false;
doc.createElement = nodo;
doc.addEventListener = () => {};

const caja = { document: doc, navigator: {}, setInterval, clearInterval, console };
caja.window = caja;
vm.createContext(caja);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'static', 'orbe.js'), 'utf8'), caja);

const orbe = caja.window.orbe;
assert.ok(orbe && typeof orbe.montar === 'function', 'orbe.montar no quedó expuesto');

const pildoras = c => c.hijos.filter(h => h.className === 'orbe-p');
const leer = c => pildoras(c)[0].hijos.find(h => h.className === 'orbe-t').textContent;

// 1. montar pinta la píldora completa de inmediato, con su texto
let c = nodo('div');
let m = orbe.montar(c, { texto: 'Creando tu imagen · ~20 s' });
assert.strictEqual(pildoras(c).length, 1, 'montar no dejó una píldora');
assert.strictEqual(leer(c), 'Creando tu imagen · ~20 s');
assert.strictEqual(m.modo, 'pensando', 'el estado por defecto no es pensando');

// 2. idempotente por contenedor: dos montajes NO son dos orbes
const m2 = orbe.montar(c, { texto: 'otro' });
assert.strictEqual(m2, m, 'el segundo montaje devolvió otro mando');
assert.strictEqual(pildoras(c).length, 1, 'el segundo montaje duplicó la píldora');
assert.strictEqual(leer(c), 'otro', 'el montaje repetido no actualizó el texto');
m.desmontar();

// 3. el cronómetro cuelga del ÚLTIMO texto puesto, no del inicial
c = nodo('div');
m = orbe.montar(c, { texto: 'Revisando tu texto…', desde: Date.now() - 95000 });
m.texto('Grabando la narración');
m._tic(Date.now());
assert.strictEqual(leer(c), 'Grabando la narración · llevas 1:35',
  'el cronómetro no usó el último texto, o cuenta mal');
m.desmontar();

// 4. el tope apaga el orbe y avisa UNA sola vez
c = nodo('div');
let avisos = 0;
m = orbe.montar(c, {
  texto: 'Trabajando', tope: 1000, desde: Date.now() - 5000,
  alAgotar: mm => { avisos++; mm.texto('sin novedades'); },
});
m._tic(Date.now());
m._tic(Date.now());
assert.strictEqual(avisos, 1, 'alAgotar se disparó ' + avisos + ' veces');
assert.ok(pildoras(c)[0].classList.contains('apagado'), 'el orbe agotado no se apagó');
assert.strictEqual(leer(c), 'sin novedades');

// 5. latir() revive el orbe apagado y reinicia el reloj del tope
m.latir();
assert.ok(!pildoras(c)[0].classList.contains('apagado'), 'latir() no revivió el orbe');
m._tic(Date.now());
assert.strictEqual(avisos, 1, 'latir() no reinició el reloj: volvió a agotarse');
m.desmontar();

// 6. un tope que aún no vence no apaga nada
c = nodo('div');
avisos = 0;
m = orbe.montar(c, { texto: 'x', tope: 600000, alAgotar: () => avisos++ });
m._tic(Date.now());
assert.strictEqual(avisos, 0, 'se apagó antes de tiempo');

// 7. desmontar saca la píldora del DOM y deja volver a montar
m.desmontar();
assert.strictEqual(pildoras(c).length, 0, 'desmontar dejó la píldora puesta');
const m3 = orbe.montar(c, { texto: 'de nuevo' });
assert.notStrictEqual(m3, m, 'montar tras desmontar devolvió el mando muerto');
assert.strictEqual(leer(c), 'de nuevo');

// 8. un mando desmontado ya no habla: ni texto, ni tope, ni avisos
avisos = 0;
const zombi = orbe.montar(nodo('div'), {
  texto: 'z', tope: 1000, desde: Date.now() - 5000, alAgotar: () => avisos++,
});
zombi.desmontar();
zombi.texto('no deberías verme');
zombi._tic(Date.now());
assert.strictEqual(avisos, 0, 'un orbe desmontado siguió avisando');
m3.desmontar();

// 9. estado(): solo los dos que el shader conoce
const m4 = orbe.montar(nodo('div'), { texto: 'y' });
m4.estado('idle');
assert.strictEqual(m4.modo, 'idle');
m4.estado('bailando');
assert.strictEqual(m4.modo, 'idle', 'aceptó un estado que el shader no conoce');
m4.desmontar();

console.log('orbe: 9 comprobaciones OK');
process.exit(0);
