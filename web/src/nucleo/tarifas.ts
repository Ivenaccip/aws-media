// Las tarifas en CRÉDITOS, de la única fuente: tools/tarifas.json.
//
// Llegan SIN notas ni `economia`: el plugin tarifasSinNotas de vite.config.ts
// deja solo los números (las notas citan costos de proveedor). Y solo con
// imports con nombre, para que al navegador viaje únicamente lo que se usa.
// tools/pricing.json (costos en dólares y márgenes) NUNCA se importa desde
// web/: lo prohíben eslint.config.js y tests/test_web_tuberia.py, que además
// lo busca en dist/.
export { video, shorts, estilos, competencia, clip, editar, mix, modelos } from '../../../tools/tarifas.json';
