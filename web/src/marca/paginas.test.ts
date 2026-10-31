// El HTML de las páginas de nivel (paginas.ts). PURO: genera el texto y lo mira; que los archivos commiteados de web/estudio/ sean idénticos
// a esto lo exige estudio.test.ts. Cada comprobación sale de un guardián del repo (se cita al lado) o de una regla del plan de rutas.
// Sin el prefijo `inicio.`: no son invariantes del registro de migración.
import { describe, expect, it } from 'vitest';

import { htmlDeNivel } from './paginas';
import { rutasDelRecorrido, type RutaDelRecorrido } from './rutas';

const NIVEL = '/src/pantallas/inicio/niveles/nivel.tsx';
const HERRAMIENTA = '/src/pantallas/inicio/herramienta.tsx';
const AUTH = '<script src="/auth.js">';
const MODULO = 'type="module"';

const rutas = rutasDelRecorrido();
const paginas = rutas.map(ruta => ({ ruta, html: htmlDeNivel(ruta) }));

const veces = (texto: string, aguja: string): number => texto.split(aguja).length - 1;

/** Lo que la plantilla trae de comentario: no cuenta como `<script>` ni como módulo, y los guardianes buscan la PRIMERA aparición. */
const comentario = (html: string): string => /<!--[\s\S]*?-->/.exec(html)?.[0] ?? '';

describe('rutas · la página de cada nivel', () => {
  it('rutas.pagina.el_titulo_es_el_de_la_ruta_y_esta_una_sola_vez', () => {
    expect(paginas).toHaveLength(16);
    for (const { ruta, html } of paginas) {
      expect(html, ruta.url).toContain(`<title>${ruta.titulo}</title>`);
      expect(veces(html, '<title>'), ruta.url).toBe(1);
    }
    const video = rutas.find(r => r.url === '/estudio/marketing/distrito/video/');
    expect(video && htmlDeNivel(video)).toContain('<title>Estudio de video · Marketing · Distrito · Video</title>');
    const mapa = rutas.find(r => r.url === '/estudio/');
    expect(mapa && htmlDeNivel(mapa)).toContain('<title>Estudio de video</title>');
  });

  it('rutas.pagina.trae_el_favicon_literal: tests/test_m19_orbe.py lo busca así en toda página de web/', () => {
    for (const { ruta, html } of paginas) expect(html, ruta.url).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml">');
  });

  it('rutas.pagina.es_privada_y_no_se_indexa', () => {
    for (const { ruta, html } of paginas) expect(html, ruta.url).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('rutas.pagina.auth_js_clasico_va_antes_del_modulo: tests/test_migracion_ui.py (test_la_pantalla_nueva_tiene_su_pagina) compara la primera aparición de cada uno', () => {
    for (const { ruta, html } of paginas) {
      expect(html.indexOf(AUTH), ruta.url).toBeGreaterThan(-1);
      expect(html.indexOf(MODULO), ruta.url).toBeGreaterThan(-1);
      expect(html.indexOf(AUTH), ruta.url).toBeLessThan(html.indexOf(MODULO));
      expect(veces(html, MODULO), `${ruta.url}: un solo módulo`).toBe(1);
    }
  });

  it('rutas.pagina.el_comentario_no_nombra_ni_el_script_de_auth_ni_el_modulo: si lo hiciera, la «primera aparición» sería la del comentario', () => {
    for (const { ruta, html } of paginas) {
      const c = comentario(html);
      expect(c, ruta.url).not.toBe('');
      expect(c, ruta.url).not.toContain(AUTH);
      expect(c, ruta.url).not.toContain(MODULO);
      expect(c, ruta.url).not.toContain('<script');
    }
  });

  it('rutas.pagina.monedero_js_esta_presente_y_va_despues_de_auth_js: su fetch a /api/creditos es lo que dispara el inicio de sesión de una URL profunda', () => {
    for (const { ruta, html } of paginas) {
      expect(html, ruta.url).toContain('<script src="/monedero.js"></script>');
      expect(html.indexOf(AUTH), ruta.url).toBeLessThan(html.indexOf('<script src="/monedero.js">'));
      expect(html.indexOf('<script src="/monedero.js">'), ruta.url).toBeLessThan(html.indexOf(MODULO));
    }
  });

  it('rutas.pagina.la_bandeja_de_trabajos_va_en_todas_con_iconos_antes_que_trabajos: sin iconos.js el botón de cerrar de un aviso es invisible', () => {
    for (const { ruta, html } of paginas) {
      expect(html.indexOf('<script src="/iconos.js"></script>'), ruta.url).toBeGreaterThan(-1);
      expect(html.indexOf('<script src="/iconos.js">'), ruta.url).toBeLessThan(html.indexOf('<script src="/trabajos.js">'));
      expect(html.indexOf('<script src="/trabajos.js">'), ruta.url).toBeLessThan(html.indexOf(MODULO));
    }
  });

  it('rutas.pagina.sin_bandeja_la_plantilla_solo_pierde_esos_dos_scripts', () => {
    for (const { ruta, html } of paginas) {
      const sin = htmlDeNivel(ruta, false);
      expect(sin, ruta.url).not.toContain('/iconos.js');
      expect(sin, ruta.url).not.toContain('/trabajos.js');
      expect(sin, ruta.url).toContain('<script src="/monedero.js"></script>\n</head>');
      expect(sin.indexOf(AUTH), ruta.url).toBeLessThan(sin.indexOf(MODULO));
      expect(html, ruta.url).toBe(
        sin.replace('<script src="/monedero.js"></script>', '<script src="/monedero.js"></script>\n  <script src="/iconos.js"></script>\n  <script src="/trabajos.js"></script>'),
      );
    }
  });

  it('rutas.pagina.ninguna_direccion_es_relativa: a cuatro niveles de profundidad una relativa se rompe', () => {
    for (const { ruta, html } of paginas) {
      const direcciones = [...html.matchAll(/\b(?:src|href)="([^"]*)"/g)].map(m => m[1]);
      expect(direcciones.length, ruta.url).toBeGreaterThan(0);
      for (const d of direcciones) {
        expect(d, `${ruta.url}: ${d}`).toMatch(/^\//);
        expect(d, `${ruta.url}: ${d}`).not.toMatch(/^\/\//);
      }
      expect(html, ruta.url).not.toMatch(/\b(?:src|href)='/);
    }
  });

  it('rutas.pagina.un_solo_raiz: el contenedor donde la entrada monta la pantalla', () => {
    for (const { ruta, html } of paginas) {
      expect(veces(html, 'id="raiz"'), ruta.url).toBe(1);
      expect(html, ruta.url).toContain('<div id="raiz"></div>');
      expect(html.indexOf('id="raiz"'), ruta.url).toBeLessThan(html.indexOf(MODULO));
    }
  });

  it('rutas.pagina.el_modulo_de_entrada_lo_decide_el_tipo_de_nivel: la Caja solo en las tres herramientas', () => {
    let herramientas = 0;
    for (const { ruta, html } of paginas) {
      const esHerramienta = ruta.nivel.tipo === 'herramienta';
      if (esHerramienta) herramientas += 1;
      const entrada = esHerramienta ? HERRAMIENTA : NIVEL;
      expect(html, ruta.url).toContain(`<script type="module" src="${entrada}"></script>`);
      expect(html, ruta.url).not.toContain(esHerramienta ? NIVEL : HERRAMIENTA);
    }
    expect(herramientas).toBe(3);
    expect(paginas.filter(p => p.html.includes(NIVEL))).toHaveLength(13);
  });

  it('rutas.pagina.lo_unico_que_cambia_entre_paginas_es_el_titulo_y_la_entrada', () => {
    const neutras = new Set(
      paginas.map(({ ruta, html }) =>
        html.replace(`<title>${ruta.titulo}</title>`, '<title>@</title>').replace(/src="\/src\/[^"]+"/, 'src="@"'),
      ),
    );
    expect(neutras.size).toBe(1);
  });

  it('rutas.pagina.es_un_documento_completo_en_espanol: doctype, lang, charset, viewport y salto de línea final', () => {
    for (const { ruta, html } of paginas) {
      expect(html.startsWith('<!doctype html>\n<html lang="es">\n<head>\n'), ruta.url).toBe(true);
      expect(html, ruta.url).toContain('<meta charset="utf-8">');
      expect(html, ruta.url).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
      expect(html.endsWith('</body>\n</html>\n'), ruta.url).toBe(true);
    }
  });

  it('rutas.pagina.es_determinista: la misma ruta da el mismo texto (estudio.test.ts compara byte a byte)', () => {
    for (const { ruta, html } of paginas) expect(htmlDeNivel(ruta), ruta.url).toBe(html);
  });

  it('rutas.pagina.el_titulo_se_escapa: un título con & o < no rompe la cabecera', () => {
    const rara: RutaDelRecorrido = { url: '/estudio/x/', nivel: { tipo: 'area', area: 'x' }, titulo: 'A & B <i> "c"' };
    const html = htmlDeNivel(rara);
    expect(html).toContain('<title>A &amp; B &lt;i&gt; &quot;c&quot;</title>');
    expect(veces(html, '<title>')).toBe(1);
  });
});
