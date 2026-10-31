// Las carpetas de web/estudio/ frente a MENU: el guardián de las páginas de nivel y, con `npm run niveles`, su GENERADOR.
//
// Las 16 páginas de nivel (el mapa, cada área, cada grupo y las tres herramientas de la Caja) son archivos COMMITEADOS que genera
// `htmlDeNivel` (paginas.ts); aquí se exige que cada uno sea idéntico a lo que esa función devuelve. Con `--mode generar`
// (`npm run niveles` = `vitest run src/marca/estudio.test.ts --mode generar`) la MISMA prueba los escribe en vez de compararlos: se
// usa el modo de vitest y no una variable de entorno porque `VAR=x cmd` no existe en cmd.exe de Windows. Sin ese modo nada
// escribe jamás, y con él tampoco se toca un archivo que ya está al día (correrlo dos veces no cambia nada, ni siquiera la fecha).
//
// La otra mitad vigila que web/estudio/ y MENU digan lo mismo, en las dos direcciones:
//   · toda carpeta con index.html es una ruta generada, una hoja del menú o una de la lista cerrada PLANAS (si no, «carpeta huérfana»);
//   · toda hoja del menú (la que trae `href`) tiene su carpeta.
//
// Solo lee (o, con `--mode generar`, escribe) web/estudio/: la imagen Docker copia únicamente web/ (Dockerfile, etapa `web`).
// Sin el prefijo `inicio.`: no son invariantes del registro de migración (tests/test_migracion_ui.py).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { MENU, lugarATexto, trozoDeArea, type PantallaMenu } from './menu';
import { htmlDeNivel } from './paginas';
import { carpetaDe, rutasDelRecorrido } from './rutas';

// (new URL(…, import.meta.url) no sirve aquí: el URL global es el de jsdom)
const ESTUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'estudio');
const GENERAR = import.meta.env.MODE === 'generar';
const INDICE = 'index.html';

/**
 * Las carpetas de web/estudio/ que no están en el menú y no son de una ruta generada: pantallas que MENU no nombra y la vitrina interna.
 * Es una lista CERRADA: agregar una carpeta nueva a web/estudio/ sin que MENU la nombre es justo lo que esta prueba quiere que
 * alguien decida a propósito, editando esta línea. `inicio` (la página única de antes) salió de aquí al retirarse su carpeta: la
 * dirección /estudio/inicio/ ya no es una página sino un 302 a la principal (server/web.py, alias de server/migracion.py), así que
 * si alguien la vuelve a crear esta prueba la señala como «carpeta huérfana».
 */
const PLANAS: readonly string[] = ['admin', 'clip', 'crear', 'imagenes', 'shorts', 'subir', '_vitrina'];

/**
 * TRANSITORIA. Las hojas del menú (agenda, el Constructor…) que todavía no se mudaron a su dirección por nivel
 * (/estudio/marketing/blotato/agenda/): viven en una carpeta plana. Clave = `area.grupo.pantalla` de MENU; valor = la carpeta plana
 * de web/estudio/ (ojo: MIX es `automaticas` en el menú y `mix` allá). Cada commit de la etapa E7 muda UNA hoja y acorta este Map en
 * una fila (COI y la Biblioteca ya salieron); una hoja que NO está aquí tiene que existir en su carpeta anidada. Es un Map y no un
 * objeto: hay una pantalla que se llama `constructor` y choca con Object.prototype.
 */
const HOJAS_AUN_PLANAS: ReadonlyMap<string, string> = new Map([
  ['mkt.blotato.agenda', 'agenda'],
  ['mkt.blotato.competencia', 'competencia'],
  ['mkt.blotato.metricas', 'metricas'],
  ['mkt.avanzado.automaticas', 'mix'],
  ['mkt.avanzado.estilos', 'estilos'],
  ['automatizaciones.distrito.constructor', 'constructor'],
  ['automatizaciones.distrito.asistente', 'asistente'],
]);

interface Hoja {
  /** `area.grupo.pantalla`, como `lugarATexto`. */
  clave: string;
  /** La carpeta anidada que le toca: «marketing/blotato/agenda». */
  anidada: string;
  /** Su `href` en MENU: la dirección a la que el menú la manda hoy. */
  href: string;
}

/** Las pantallas de MENU que son una página aparte: con `href`, que no son una pestaña de la Caja ni «Próximamente». */
const esHoja = (p: PantallaMenu): boolean => p.href !== undefined && p.caja === undefined && !p.proximamente;

const HOJAS: Hoja[] = MENU.flatMap(a =>
  a.grupos.flatMap(g =>
    g.pantallas.filter(esHoja).map(p => ({
      clave: lugarATexto({ area: a.clave, grupo: g.clave, pantalla: p.clave }),
      anidada: `${trozoDeArea(a)}/${g.clave}/${p.clave}`,
      href: p.href ?? '',
    })),
  ),
);

/** Dónde vive la hoja ahora: en su carpeta plana mientras esté en la tabla transitoria y, en cuanto sale de ella, en la anidada. */
const carpetaDeHoja = (h: Hoja): string => HOJAS_AUN_PLANAS.get(h.clave) ?? h.anidada;

/**
 * Las hojas ya mudadas (fuera de la tabla transitoria) que enlazan a la UI nueva por otra dirección que su anidada, como
 * «clave → href (su lugar: …)». Las que enlazan su URL vieja (`/agenda.html`) no cuentan: en `nueva` esa la decide el interruptor.
 */
const enlacesFueraDeSuLugar = (hojas: readonly Hoja[]): string[] =>
  hojas
    .filter(h => !HOJAS_AUN_PLANAS.has(h.clave) && h.href.startsWith('/estudio/') && h.href !== `/estudio/${h.anidada}/`)
    .map(h => `${h.clave} → ${h.href} (su lugar: /estudio/${h.anidada}/)`);

/** Las carpetas que generan las 16 rutas del recorrido («» es la principal). */
const GENERADAS: ReadonlySet<string> = new Set(rutasDelRecorrido().map(r => carpetaDe(r.url)));

/** De esas carpetas, las que ni son una ruta generada, ni una hoja del menú (donde le toca hoy), ni están en la lista cerrada. */
function huerfanas(carpetas: readonly string[]): string[] {
  const hojas = new Set(HOJAS.map(carpetaDeHoja));
  return carpetas.filter(c => !GENERADAS.has(c) && !hojas.has(c) && !PLANAS.includes(c));
}

const rutaDe = (carpeta: string): string => join(ESTUDIO, ...carpeta.split('/').filter(Boolean), INDICE);

/** El contenido de un archivo con el salto de línea de siempre: un clon de Windows con autocrlf no debe romper la comparación. */
const leer = (archivo: string): string => readFileSync(archivo, 'utf8').replace(/\r\n/g, '\n');

/**
 * Cada carpeta bajo `raiz` que tiene un index.html, a cualquier profundidad, como «marketing/distrito» («» es la raíz misma:
 * web/estudio/index.html). Mira lo mismo que miran Vite (vite.config.ts recorre todo web/estudio/) y el servidor
 * (server/web.py::rutas): ninguna carpeta se salta, salvo `assets` del PRIMER nivel, que en el dist es donde van los chunks con hash
 * (en la fuente nunca hay una). Una `assets/` o una `node_modules/` más adentro (marketing/assets/) SÍ es una página: Vite la compila
 * y el servidor la sirve, así que tiene que caer en «carpeta huérfana» y no pasar sin que nadie la vea.
 */
function carpetasConPagina(raiz: string, rel: string[] = []): string[] {
  const aqui = join(raiz, ...rel);
  const out = existsSync(join(aqui, INDICE)) ? [rel.join('/')] : [];
  for (const d of readdirSync(aqui, { withFileTypes: true })) {
    if (d.isDirectory() && !(rel.length === 0 && d.name === 'assets')) out.push(...carpetasConPagina(raiz, [...rel, d.name]));
  }
  return out;
}

type Estado = 'al_dia' | 'escrita' | 'distinta' | 'falta';

/**
 * Pone `html` en `destino`. `escribir` = el modo generar: crea las carpetas y escribe SOLO si el archivo no existe o es distinto
 * (uno que ya está al día no se toca: correr el generador dos veces no cambia nada). Sin `escribir` no hay ni un `writeFileSync`
 * ni un `mkdirSync`; solo dice cómo está.
 */
function sincronizar(destino: string, html: string, escribir: boolean): Estado {
  const hay = existsSync(destino);
  if (hay && leer(destino) === html) return 'al_dia';
  if (!escribir) return hay ? 'distinta' : 'falta';
  mkdirSync(dirname(destino), { recursive: true });
  writeFileSync(destino, html, 'utf8');
  return 'escrita';
}

describe('rutas · las páginas de nivel de web/estudio/ son las que genera paginas.ts', () => {
  for (const ruta of rutasDelRecorrido()) {
    it(`rutas.pagina_al_dia: ${ruta.url}`, () => {
      const destino = rutaDe(carpetaDe(ruta.url));
      const esperado = htmlDeNivel(ruta);
      const estado = sincronizar(destino, esperado, GENERAR);
      const donde = `web/estudio/${carpetaDe(ruta.url) ? `${carpetaDe(ruta.url)}/` : ''}${INDICE}`;
      expect(
        estado === 'al_dia' || estado === 'escrita',
        `${donde} ${estado === 'falta' ? 'no existe' : 'no es igual a lo que genera paginas.ts'}: corre «npm run niveles» en web/ y commitea el resultado`,
      ).toBe(true);
      expect(leer(destino)).toBe(esperado);
    });
  }

  it('rutas.pagina_al_dia.la_raiz_es_web_estudio_index_html: la principal no vive en una carpeta hija', () => {
    expect(carpetaDe('/estudio/')).toBe('');
    expect(rutaDe('')).toBe(join(ESTUDIO, INDICE));
  });
});

describe('rutas · el generador (`npm run niveles`)', () => {
  const temporales: string[] = [];
  const temporal = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'niveles-'));
    temporales.push(dir);
    return dir;
  };
  afterAll(() => {
    for (const dir of temporales) rmSync(dir, { recursive: true, force: true });
  });

  it('rutas.generador.sin_el_modo_generar_nunca_escribe: ni el archivo ni las carpetas', () => {
    const raiz = temporal();
    const destino = join(raiz, 'marketing', 'distrito', INDICE);
    expect(sincronizar(destino, 'nuevo\n', false)).toBe('falta');
    expect(existsSync(join(raiz, 'marketing'))).toBe(false);

    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, 'viejo\n', 'utf8');
    expect(sincronizar(destino, 'nuevo\n', false)).toBe('distinta');
    expect(readFileSync(destino, 'utf8')).toBe('viejo\n');
  });

  it('rutas.generador.en_el_modo_generar_crea_las_carpetas_y_escribe', () => {
    const raiz = temporal();
    const destino = join(raiz, 'marketing', 'distrito', 'imagen', INDICE);
    expect(sincronizar(destino, 'nuevo\n', true)).toBe('escrita');
    expect(readFileSync(destino, 'utf8')).toBe('nuevo\n');
    // y reemplaza uno que había cambiado a mano
    writeFileSync(destino, 'a mano\n', 'utf8');
    expect(sincronizar(destino, 'nuevo\n', true)).toBe('escrita');
    expect(readFileSync(destino, 'utf8')).toBe('nuevo\n');
  });

  it('rutas.generador.es_idempotente: lo que ya esta al dia no se vuelve a escribir (ni cambia su fecha)', () => {
    const raiz = temporal();
    const destino = join(raiz, INDICE);
    expect(sincronizar(destino, 'igual\n', true)).toBe('escrita');
    const antes = new Date('2026-01-01T00:00:00Z');
    utimesSync(destino, antes, antes);
    expect(sincronizar(destino, 'igual\n', true)).toBe('al_dia');
    expect(sincronizar(destino, 'igual\n', true)).toBe('al_dia');
    expect(statSync(destino).mtime.getTime()).toBe(antes.getTime());
  });

  it('rutas.generador.un_clon_de_windows_con_saltos_de_linea_crlf_cuenta_como_al_dia', () => {
    const raiz = temporal();
    const destino = join(raiz, INDICE);
    writeFileSync(destino, 'uno\r\ndos\r\n', 'utf8');
    expect(sincronizar(destino, 'uno\ndos\n', false)).toBe('al_dia');
    expect(sincronizar(destino, 'uno\ndos\n', true)).toBe('al_dia');
  });
});

describe('rutas · web/estudio/ y MENU dicen lo mismo', () => {
  // se leen DENTRO de cada prueba, no al definirlas: con `--mode generar` las páginas se escriben en la describe de arriba, ya con las pruebas corriendo
  const carpetas = (): string[] => carpetasConPagina(ESTUDIO);

  it('rutas.toda_carpeta_es_del_menu: cada index.html es una ruta generada, una hoja del menú o una de PLANAS', () => {
    const hay = carpetas();
    const sobran = huerfanas(hay);
    expect(
      sobran,
      `carpeta huérfana: web/estudio/${sobran[0] ?? ''}/index.html no es una ruta de rutasDelRecorrido(), ni una hoja de MENU, ni está en PLANAS`,
    ).toEqual([]);
    // el control: sin él, «no hay huérfanas» pasaría también si la búsqueda de carpetas no encontrara nada
    expect(hay).toContain('');
    expect(hay).toContain('marketing/distrito/imagen');
    expect(hay.length).toBeGreaterThanOrEqual(GENERADAS.size + PLANAS.length);
  });

  it('rutas.toda_carpeta_es_del_menu.una_carpeta_que_nadie_nombra_se_detecta: la prueba sí muerde', () => {
    // la anidada de una hoja que TODAVÍA está en la tabla transitoria es una carpeta de más: su casa es la plana
    const anidadasDeMas = HOJAS.filter(h => HOJAS_AUN_PLANAS.has(h.clave)).map(h => h.anidada);
    // `inicio` es la página única de antes: su carpeta se retiró (E5.3) y /estudio/inicio/ es un 302, así que volver a crearla también es de más
    const intrusas = ['marketing/distrito/musica', 'marketing/distrito/imagen/otra', 'nueva', 'mkt', 'coi/viejo', 'marketing/assets', 'inicio', ...anidadasDeMas];
    // el control NO mira el disco (`carpetas()`): si hubiera una huérfana de verdad, la de arriba falla con su mensaje y esta seguiría
    // diciendo que la prueba muerde, en vez de fallar también con un diff de dos listas de 14 elementos que sugiere lo contrario
    expect(huerfanas(intrusas)).toEqual(intrusas);
    // y lo que SÍ es del menú no se marca: las generadas, la lista cerrada y las hojas donde les toca hoy
    expect(huerfanas(['', 'marketing/distrito/imagen', ...PLANAS, ...HOJAS.map(carpetaDeHoja)])).toEqual([]);
  });

  it('rutas.toda_carpeta_es_del_menu.una_carpeta_assets_o_node_modules_anidada_tambien_se_ve: solo la del primer nivel se salta', () => {
    const raiz = mkdtempSync(join(tmpdir(), 'carpetas-'));
    try {
      for (const c of ['', 'marketing', 'marketing/assets', 'marketing/distrito/node_modules/x', 'assets', 'assets/dentro']) {
        mkdirSync(join(raiz, ...c.split('/').filter(Boolean)), { recursive: true });
        writeFileSync(join(raiz, ...c.split('/').filter(Boolean), INDICE), '<!doctype html>\n', 'utf8');
      }
      // el servidor (server/web.py::rutas) solo descarta `assets` en el primer tramo: lo de más adentro lo sirve, así que se ve
      const hay = carpetasConPagina(raiz).sort();
      expect(hay).toEqual(['', 'marketing', 'marketing/assets', 'marketing/distrito/node_modules/x']);
      // y como no es de nadie, cae en «carpeta huérfana»
      expect(huerfanas(hay)).toEqual(['marketing/assets', 'marketing/distrito/node_modules/x']);
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  it('rutas.cada_hoja_tiene_su_carpeta: cada pantalla de MENU con href (no Caja, no «Próximamente») tiene su index.html', () => {
    // el control del filtro: las hojas de verdad entran; las pestañas de la Caja y las «Próximamente» no
    const claves = HOJAS.map(h => h.clave);
    expect(claves).toEqual(expect.arrayContaining(['mkt.blotato.agenda', 'mkt.avanzado.automaticas', 'central.distrito.coi', 'automatizaciones.distrito.constructor']));
    expect(claves).not.toContain('mkt.distrito.imagen');
    expect(claves).not.toContain('central.distrito.glosario');
    expect(claves).not.toContain('automatizaciones.distrito.actualizar');
    const hay = carpetas();
    const sinCarpeta = HOJAS.filter(h => !hay.includes(carpetaDeHoja(h))).map(h => `${h.clave} → web/estudio/${carpetaDeHoja(h)}/index.html`);
    expect(sinCarpeta, `hojas de MENU sin su carpeta: ${sinCarpeta.join('; ')}`).toEqual([]);
  });

  it('rutas.cada_hoja_tiene_su_carpeta.la_tabla_transitoria_solo_nombra_hojas_que_existen_y_cada_commit_de_E7_la_acorta', () => {
    const claves = new Set(HOJAS.map(h => h.clave));
    for (const [clave, plana] of HOJAS_AUN_PLANAS) {
      expect(claves.has(clave), `la tabla transitoria nombra «${clave}», que ya no es una hoja de MENU: quita la fila`).toBe(true);
      // la carpeta plana es una sola palabra, sin niveles: una anidada va fuera de la tabla
      expect(plana, clave).toMatch(/^[a-z0-9]+$/);
    }
    // sin repetidos: dos hojas no comparten carpeta
    expect(new Set(HOJAS_AUN_PLANAS.values()).size).toBe(HOJAS_AUN_PLANAS.size);
    // es un Map: buscar `constructor` o `toString` (hay una pantalla que se llama así) no encuentra lo de Object.prototype
    expect(HOJAS_AUN_PLANAS.get('constructor')).toBeUndefined();
    expect(HOJAS_AUN_PLANAS.get('toString')).toBeUndefined();
    expect(HOJAS_AUN_PLANAS.get('__proto__')).toBeUndefined();
  });

  it('rutas.cada_hoja_tiene_su_carpeta.si_el_href_ya_es_de_la_nueva_la_carpeta_plana_es_la_de_su_href', () => {
    // las que nacieron en la UI nueva y siguen en la tabla (Constructor, Asistente) apuntan a /estudio/<carpeta>/; las demás
    // (/agenda.html…) las manda server/migracion.py
    for (const h of HOJAS) {
      const plana = HOJAS_AUN_PLANAS.get(h.clave);
      const m = /^\/estudio\/([^/]+)\/$/.exec(h.href);
      if (plana !== undefined && m) expect(plana, h.clave).toBe(m[1]);
    }
  });

  it('rutas.cada_hoja_tiene_su_carpeta.una_hoja_mudada_que_enlaza_a_la_ui_nueva_enlaza_su_anidada', () => {
    // la carpeta plana de antes sigue llevando a la anidada con un 302 (server/migracion.py::alias_del_estudio): un enlace que se quedó
    // en la plana no rompe nada a la vista, cuesta un salto de más y deja la dirección vieja en los marcadores. Solo se ve aquí
    const fuera = enlacesFueraDeSuLugar(HOJAS);
    expect(fuera, `hojas mudadas que el menú todavía manda a otra dirección: ${fuera.join('; ')}`).toEqual([]);
    // la prueba muerde: una hoja fuera de la tabla con su href plano se marca; con la anidada o con su URL vieja, no
    const hoja: Hoja = { clave: 'mkt.blotato.prueba', anidada: 'marketing/blotato/prueba', href: '/estudio/prueba/' };
    expect(enlacesFueraDeSuLugar([hoja])).toEqual(['mkt.blotato.prueba → /estudio/prueba/ (su lugar: /estudio/marketing/blotato/prueba/)']);
    expect(enlacesFueraDeSuLugar([{ ...hoja, href: '/estudio/marketing/blotato/prueba/' }, { ...hoja, href: '/prueba.html' }])).toEqual([]);
    // y una que sigue en la tabla, con el href de su carpeta plana, tampoco: todavía vive ahí
    const aunPlana = HOJAS.find(h => HOJAS_AUN_PLANAS.has(h.clave));
    if (aunPlana) expect(enlacesFueraDeSuLugar([{ ...aunPlana, href: `/estudio/${HOJAS_AUN_PLANAS.get(aunPlana.clave) ?? ''}/` }])).toEqual([]);
  });

  it('rutas.cada_hoja_tiene_su_carpeta.la_anidada_sale_de_las_claves_del_menu_con_marketing_en_vez_de_mkt', () => {
    const anidadas = HOJAS.map(h => h.anidada);
    expect(anidadas).toEqual(expect.arrayContaining(['marketing/blotato/agenda', 'marketing/avanzado/automaticas', 'central/distrito/coi']));
    expect(anidadas.filter(a => a.startsWith('mkt/'))).toEqual([]);
    // cada una cuelga de la dirección de su grupo: `rutasDelRecorrido()` ya trae el grupo con esa carpeta
    const grupos = new Set(rutasDelRecorrido().filter(r => r.nivel.tipo === 'grupo').map(r => carpetaDe(r.url)));
    for (const a of anidadas) expect(grupos.has(a.split('/').slice(0, 2).join('/')), a).toBe(true);
  });

  it('rutas.planas.cada_carpeta_de_la_lista_cerrada_existe: si una se retira, se quita de PLANAS (no queda un permiso para volver a crearla)', () => {
    const hay = carpetas();
    const sobran = PLANAS.filter(c => !hay.includes(c));
    expect(sobran, `PLANAS nombra carpetas que ya no existen: ${sobran.join(', ')}`).toEqual([]);
    // y ninguna se pisa con una ruta generada ni con una hoja
    for (const c of PLANAS) expect(GENERADAS.has(c) || HOJAS.some(h => carpetaDeHoja(h) === c), c).toBe(false);
  });
});
