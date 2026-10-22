// El HTML de cada página de nivel (rutas.ts), generado por una función PURA: lo único que cambia de una página a otra es el
// `<title>` y el módulo de entrada. Los archivos web/estudio/**/index.html están commiteados (los guardianes que leen fuentes
// los ven) y web/src/marca/estudio.test.ts exige que cada uno sea idéntico a lo que esta función devuelve: cambiar la cabecera de
// todas las páginas es editar la plantilla de aquí y regenerar con `npm run niveles`; la deriva respecto de MENU es imposible
// sin que falle `npm run verificar`.
//
// Todas las direcciones del HTML son absolutas (`/auth.js`, `/src/…`): a cuatro niveles de profundidad una relativa se rompe.
import type { RutaDelRecorrido } from './rutas';

/** Las páginas de navegación (mapa, áreas, grupos) llevan el mapa del recorrido; ninguna trae la Caja. */
const ENTRADA_NIVEL = '/src/pantallas/inicio/niveles/nivel.tsx';
/** Las tres herramientas de la Caja (Imagen, Video, Edición): una misma página con la pestaña que dice la dirección. */
const ENTRADA_HERRAMIENTA = '/src/pantallas/inicio/herramienta.tsx';

/**
 * La bandeja «Tus trabajos» (iconos.js + trabajos.js) en todas las páginas, como en el inicio de hoy (decisión D9 del plan).
 * Quitarla de las páginas de navegación es poner esto en `false` y regenerar.
 */
const CON_BANDEJA = true;

const escapar = (texto: string): string =>
  texto.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

/**
 * El index.html de una página de nivel. `conBandeja` solo existe para probar las dos formas de la plantilla; las páginas
 * commiteadas salen siempre con `CON_BANDEJA`.
 *
 * El comentario de la plantilla no puede nombrar el `<script src="/auth.js">` ni el `type="module"` tal cual: los guardianes
 * (tests/test_migracion_ui.py) buscan la PRIMERA aparición de cada uno para exigir que auth.js clásico vaya antes del módulo.
 */
export function htmlDeNivel(ruta: RutaDelRecorrido, conBandeja: boolean = CON_BANDEJA): string {
  const entrada = ruta.nivel.tipo === 'herramienta' ? ENTRADA_HERRAMIENTA : ENTRADA_NIVEL;
  const bandeja = conBandeja ? '\n  <script src="/iconos.js"></script>\n  <script src="/trabajos.js"></script>' : '';
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <!-- GENERADO por web/src/marca/paginas.ts (npm run niveles); no se edita a mano: web/src/marca/estudio.test.ts exige que sea idéntico a lo que genera.
       Privada: auth.js clásico ANTES del módulo, monedero.js para la píldora del saldo, iconos.js y trabajos.js para «Tus trabajos». -->
  <meta name="robots" content="noindex, nofollow">
  <title>${escapar(ruta.titulo)}</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <script src="/auth.js"></script>
  <script src="/monedero.js"></script>${bandeja}
</head>
<body>
  <div id="raiz"></div>
  <script type="module" src="${entrada}"></script>
</body>
</html>
`;
}
