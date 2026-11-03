// Las direcciones del recorrido (rutas.ts) y los datos de menu.ts de los que salen. PURO: ni DOM ni node:fs (la mitad que mira las
// carpetas de web/estudio/ es estudio.test.ts). Sin el prefijo `inicio.`: no son invariantes del registro de migración.
import { describe, expect, it } from 'vitest';

import { CONECTAR as CONECTAR_AGENDA } from '../pantallas/agenda/logica';
import { CONECTAR as CONECTAR_METRICAS } from '../pantallas/metricas/logica';
import { CONECTAR as CONECTAR_MIX } from '../pantallas/mix/logica';
import * as menu from './menu';
import { MENU, buscar, urlDeInicio } from './menu';
import {
  PREFIJO,
  RUTA_MAPA,
  carpetaDe,
  nivelDeDireccion,
  nivelDeRuta,
  rutasDelRecorrido,
  urlDeArea,
  urlDeCaja,
  urlDeGrupo,
  urlDeHerramienta,
} from './rutas';

const area = (clave: string) => {
  const a = MENU.find(x => x.clave === clave);
  if (!a) throw new Error(`MENU no trae el área «${clave}»`);
  return a;
};

describe('rutas · las direcciones salen de MENU', () => {
  const rutas = rutasDelRecorrido();

  it('rutas.lista.las_16_paginas_en_el_orden_del_recorrido: la principal, cada área, cada grupo y las tres herramientas de la Caja', () => {
    expect(rutas.map(r => r.url)).toEqual([
      '/estudio/',
      '/estudio/marketing/',
      '/estudio/marketing/distrito/',
      '/estudio/marketing/distrito/imagen/',
      '/estudio/marketing/distrito/video/',
      '/estudio/marketing/distrito/edicion/',
      '/estudio/marketing/blotato/',
      '/estudio/marketing/avanzado/',
      '/estudio/central/',
      '/estudio/central/distrito/',
      '/estudio/central/deepseek/',
      '/estudio/producto/',
      '/estudio/ventas/',
      '/estudio/automatizaciones/',
      '/estudio/automatizaciones/distrito/',
      '/estudio/automatizaciones/tus/',
    ]);
    expect(rutas).toHaveLength(16);
  });

  it('rutas.lista.cada_titulo_dice_donde_estas: «Estudio de video» y detrás área, grupo y herramienta', () => {
    expect(rutas.map(r => r.titulo)).toEqual([
      'Estudio de video',
      'Estudio de video · Marketing',
      'Estudio de video · Marketing · Distrito',
      'Estudio de video · Marketing · Distrito · Imagen',
      'Estudio de video · Marketing · Distrito · Video',
      'Estudio de video · Marketing · Distrito · Edición',
      'Estudio de video · Marketing · Blotato',
      'Estudio de video · Marketing · Avanzado',
      'Estudio de video · Central',
      'Estudio de video · Central · Distrito',
      'Estudio de video · Central · Deepseek',
      'Estudio de video · Producto',
      'Estudio de video · Ventas',
      'Estudio de video · Automatizaciones',
      'Estudio de video · Automatizaciones · Distrito',
      'Estudio de video · Automatizaciones · Tus automatizaciones',
    ]);
  });

  it('rutas.lista.cada_area_y_cada_grupo_de_MENU_tiene_su_pagina_tambien_las_proximamente_y_los_vacios', () => {
    const urls = new Set(rutas.map(r => r.url));
    for (const a of MENU) {
      expect(urls.has(urlDeArea(a)), a.clave).toBe(true);
      for (const g of a.grupos) expect(urls.has(urlDeGrupo(a, g)), `${a.clave}.${g.clave}`).toBe(true);
    }
    // Producto y Ventas (áreas apagadas) y Deepseek / Tus automatizaciones (grupos sin pantallas): su página dice «Todavía no está disponible.»
    for (const url of ['/estudio/producto/', '/estudio/ventas/', '/estudio/central/deepseek/', '/estudio/automatizaciones/tus/']) expect(urls.has(url), url).toBe(true);
  });

  it('rutas.lista.solo_las_pestanas_de_la_Caja_son_herramienta: una hoja con href o una ficha «Próximamente» no tiene nivel propio', () => {
    const herramientas = rutas.filter(r => r.nivel.tipo === 'herramienta');
    expect(herramientas.map(r => r.url)).toEqual(['/estudio/marketing/distrito/imagen/', '/estudio/marketing/distrito/video/', '/estudio/marketing/distrito/edicion/']);
    for (const r of herramientas) {
      if (r.nivel.tipo !== 'herramienta') continue;
      expect(buscar(r.nivel.lugar)?.pantalla.caja, r.url).toBeDefined();
    }
    const urls = new Set(rutas.map(r => r.url));
    let sinCaja = 0;
    for (const a of MENU)
      for (const g of a.grupos)
        for (const p of g.pantallas)
          if (p.caja === undefined) {
            sinCaja += 1;
            expect(urls.has(urlDeHerramienta(a, g, p)), `${a.clave}.${g.clave}.${p.clave}`).toBe(false);
          }
    expect(sinCaja, 'MENU dejó de traer hojas o fichas sin Caja: esta prueba ya no muerde').toBeGreaterThan(0);
  });

  it('rutas.nivel_de_ruta.es_la_inversa_de_la_lista: cada dirección nombra el mismo nivel que la generó, con o sin index.html', () => {
    for (const r of rutas) {
      expect(nivelDeRuta(r.url), r.url).toEqual(r.nivel);
      expect(nivelDeRuta(`${r.url}index.html`), `${r.url}index.html`).toEqual(r.nivel);
    }
    expect(nivelDeRuta('/estudio/')).toEqual({ tipo: 'mapa' });
    expect(nivelDeRuta('/estudio/index.html')).toEqual({ tipo: 'mapa' });
    expect(nivelDeRuta('/estudio/marketing/distrito/video/')).toEqual({ tipo: 'herramienta', lugar: { area: 'mkt', grupo: 'distrito', pantalla: 'video' } });
  });

  it('rutas.nivel_de_ruta.cada_nivel_vuelve_a_su_direccion: urlDeArea / urlDeGrupo / urlDeHerramienta ↔ nivelDeRuta', () => {
    for (const a of MENU) {
      expect(nivelDeRuta(urlDeArea(a)), a.clave).toEqual({ tipo: 'area', area: a.clave });
      for (const g of a.grupos) {
        expect(nivelDeRuta(urlDeGrupo(a, g)), `${a.clave}.${g.clave}`).toEqual({ tipo: 'grupo', area: a.clave, grupo: g.clave });
        for (const p of g.pantallas.filter(x => x.caja !== undefined))
          expect(nivelDeRuta(urlDeHerramienta(a, g, p))).toEqual({ tipo: 'herramienta', lugar: { area: a.clave, grupo: g.clave, pantalla: p.clave } });
      }
    }
  });

  it('rutas.nivel_de_ruta.lo_que_no_es_un_nivel_es_null: una hoja, mayúsculas, un nivel de más, claves de Object y lo que ya no existe', () => {
    for (const mala of [
      // las carpetas planas de antes de las hojas (desde E7, un 302 del servidor a su anidada) y las páginas planas de siempre
      '/estudio/coi/', '/estudio/biblioteca/', '/estudio/constructor/', '/estudio/asistente/', '/estudio/clip/', '/estudio/agenda/', '/estudio/inicio/',
      '/estudio/competencia/', '/estudio/metricas/', '/estudio/mix/', '/estudio/estilos/', '/estudio/_vitrina/',
      // una hoja en su anidada tampoco es un nivel de este recorrido: es su propia página (E7 la mudó ahí)
      '/estudio/marketing/blotato/agenda/', '/estudio/central/distrito/coi/', '/estudio/marketing/constructor/', '/estudio/automatizaciones/distrito/constructor/',
      '/estudio/central/distrito/biblioteca/', '/estudio/automatizaciones/distrito/asistente/', '/estudio/marketing/blotato/competencia/',
      '/estudio/marketing/blotato/metricas/', '/estudio/marketing/avanzado/automaticas/', '/estudio/marketing/avanzado/estilos/',
      // mayúsculas, sin barra final, barras dobles, un nivel de más
      '/estudio/Marketing/', '/estudio/MARKETING/', '/estudio/marketing', '/estudio/marketing/distrito', '/estudio//', '/estudio//marketing/', '/estudio/marketing//',
      '/estudio/marketing/distrito/imagen/x/', '/estudio/marketing/distrito/imagen/index.html/',
      // la clave del menú no es la dirección del área
      '/estudio/mkt/', '/estudio/mkt/distrito/',
      // claves de Object.prototype (hay una pantalla llamada «constructor»: nunca se busca con un objeto indexado)
      '/estudio/__proto__/', '/estudio/toString/', '/estudio/hasOwnProperty/', '/estudio/marketing/__proto__/',
      '/estudio/marketing/toString/', '/estudio/marketing/distrito/constructor/', '/estudio/marketing/distrito/__proto__/', '/estudio/marketing/distrito/valueOf/',
      // la dirección entera, sin query ni fragmento: eso lo quita quien llama (location.pathname)
      '/estudio/marketing/?x=1', '/estudio/marketing/#a', '/estudio/?prompt=hola',
      // fuera del prefijo
      '', '/', '/otra/', '/marketing/', 'estudio/marketing/', 'https://x.test/estudio/marketing/', '/estudiomarketing/', '/estudio', '/ESTUDIO/',
    ])
      expect(nivelDeRuta(mala), JSON.stringify(mala)).toBeNull();
  });

  it('rutas.nivel_de_ruta.index_html_solo_vale_como_nombre_de_archivo_completo', () => {
    // «index.html» pegado a otro texto no es el archivo de la carpeta
    expect(nivelDeRuta('/estudio/marketingindex.html')).toBeNull();
    expect(nivelDeRuta('/estudio/marketing/xindex.html')).toBeNull();
    expect(nivelDeRuta('/estudio/marketing/index.html')).toEqual({ tipo: 'area', area: 'mkt' });
  });

  it('rutas.formato.cada_trozo_es_minusculas_sin_acentos_ni_guiones_bajos_y_ninguna_direccion_se_repite', () => {
    for (const r of rutas) {
      expect(r.url.startsWith(PREFIJO), r.url).toBe(true);
      expect(r.url.endsWith('/'), r.url).toBe(true);
      expect(r.url, r.url).not.toContain('//');
    }
    for (const r of rutas.slice(1)) for (const trozo of r.url.slice(PREFIJO.length, -1).split('/')) expect(trozo, r.url).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(new Set(rutas.map(r => r.url)).size).toBe(rutas.length);
    expect(new Set(rutas.map(r => r.titulo)).size, 'dos páginas con el mismo título').toBe(rutas.length);
  });

  it('rutas.formato.ningun_area_se_llama_como_una_pagina_plana_de_siempre_ni_como_los_assets', () => {
    // la carpeta de primer nivel de un área no puede pisar a una página que ya existe en web/estudio/ ni a /estudio/assets/
    const planas = [
      'admin', 'agenda', 'asistente', 'assets', 'biblioteca', 'clip', 'coi', 'competencia', 'constructor', 'crear', 'estilos', 'imagenes', 'inicio', 'metricas',
      'mix', 'shorts', 'subir',
    ];
    for (const a of MENU) expect(planas, a.clave).not.toContain(urlDeArea(a).slice(PREFIJO.length, -1));
  });
});

describe('rutas · nivelDeDireccion: lo que da location.pathname, tal como se escribió', () => {
  const rutas = rutasDelRecorrido();
  /** La misma dirección con cada letra escrita como «%XX» (la «a» es %61). */
  const conLetrasEnPorcentaje = (url: string) => url.replace(/[a-z]/g, c => `%${c.charCodeAt(0).toString(16)}`);
  /** Y con las barras de adentro como «%2F» (uvicorn las decodifica igual). */
  const conBarrasEnPorcentaje = (url: string) => url.replace(/(?<=.)\/(?=.)/g, '%2F');

  it('rutas.direccion.una_direccion_escrita_con_porcentajes_nombra_el_mismo_nivel_que_decodificada: las 16, letra por letra', () => {
    for (const r of rutas) {
      expect(nivelDeDireccion(conLetrasEnPorcentaje(r.url)), conLetrasEnPorcentaje(r.url)).toEqual(r.nivel);
      expect(nivelDeDireccion(conBarrasEnPorcentaje(r.url)), conBarrasEnPorcentaje(r.url)).toEqual(r.nivel);
      expect(nivelDeDireccion(conLetrasEnPorcentaje(`${r.url}index.html`)), r.url).toEqual(r.nivel);
    }
    expect(nivelDeDireccion('/estudio/%6Darketing/')).toEqual({ tipo: 'area', area: 'mkt' });
    expect(nivelDeDireccion('/estudio/marketing%2Fdistrito/')).toEqual({ tipo: 'grupo', area: 'mkt', grupo: 'distrito' });
  });

  it('rutas.direccion.una_direccion_normal_da_lo_mismo_que_nivelDeRuta: incluidas las que no son un nivel', () => {
    for (const r of rutas) expect(nivelDeDireccion(r.url)).toEqual(nivelDeRuta(r.url));
    for (const mala of ['/estudio/coi/', '/estudio/Marketing/', '/estudio/marketing', '/estudio/__proto__/', '/estudio/mkt/', '', '/', '/otra/'])
      expect(nivelDeDireccion(mala), mala).toBeNull();
  });

  it('rutas.direccion.lo_que_decodificado_no_es_un_nivel_sigue_sin_serlo_y_un_porcentaje_mal_formado_no_revienta', () => {
    for (const mala of [
      '/estudio/%4Darketing/', // «Marketing»: las mayúsculas siguen sin ser un nivel
      '/estudio/%2e%2e/', // «..»
      '/estudio/marketing%2F/', // «marketing//»
      '/estudio/%2Fmarketing/', // «//marketing/»
      '/estudio/marketing/%2e%2e/central/',
      '/estudio/%6Dkt/', // la clave del menú no es la dirección
      '/estudio/%5F%5Fproto%5F%5F/', // __proto__
      '/estudio/%/',
      '/estudio/%E0%A4%A/', // UTF-8 truncado: decodeURIComponent lanza URIError y aquí se atrapa
      '/estudio/marketing/%',
      '/estudio/%25/',
      '/estudio/%00/',
    ])
      expect(nivelDeDireccion(mala), mala).toBeNull();
  });
});

describe('rutas · Marketing es `mkt` en el menú y «marketing» en la dirección', () => {
  it('rutas.marketing.mkt_se_llama_marketing_en_la_direccion_y_la_clave_no_cambia', () => {
    const mkt = area('mkt');
    expect(mkt.ruta).toBe('marketing');
    expect(menu.trozoDeArea(mkt)).toBe('marketing');
    expect(urlDeArea(mkt)).toBe('/estudio/marketing/');
    expect(nivelDeRuta('/estudio/marketing/')).toEqual({ tipo: 'area', area: 'mkt' });
    expect(nivelDeRuta('/estudio/mkt/')).toBeNull();
  });

  it('rutas.marketing.solo_marketing_trae_ruta: las demás áreas se llaman como su clave', () => {
    for (const a of MENU.filter(x => x.clave !== 'mkt')) {
      expect(a.ruta, a.clave).toBeUndefined();
      expect(menu.trozoDeArea(a), a.clave).toBe(a.clave);
      expect(urlDeArea(a), a.clave).toBe(`/estudio/${a.clave}/`);
    }
  });
});

describe('rutas · lo que menu.ts exporta para que otros módulos no creen un ciclo', () => {
  it('rutas.menu.prefijo_y_principal: la barra es parte de la dirección', () => {
    expect(menu.PREFIJO).toBe('/estudio/');
    expect(menu.RUTA_MAPA).toBe('/estudio/');
    expect(menu.urlDeArea(area('central'))).toBe('/estudio/central/');
  });

  it('rutas.menu.rutas_las_reexporta_tal_cual: son las mismas, no una copia que pueda desfasarse', () => {
    expect(PREFIJO).toBe(menu.PREFIJO);
    expect(RUTA_MAPA).toBe(menu.RUTA_MAPA);
    expect(urlDeArea).toBe(menu.urlDeArea);
  });
});

describe('rutas · de una pestaña de la Caja a su página', () => {
  it('rutas.caja.cada_pestana_tiene_su_pagina: urlDeCaja(\'videos\') === /estudio/marketing/distrito/video/', () => {
    expect(urlDeCaja('imagenes')).toBe('/estudio/marketing/distrito/imagen/');
    expect(urlDeCaja('videos')).toBe('/estudio/marketing/distrito/video/');
    expect(urlDeCaja('edicion')).toBe('/estudio/marketing/distrito/edicion/');
  });

  it('rutas.caja.la_pagina_de_una_pestana_es_una_herramienta_de_esa_pestana', () => {
    for (const pestana of ['imagenes', 'videos', 'edicion'] as const) {
      const url = urlDeCaja(pestana);
      const nivel = url === null ? null : nivelDeRuta(url);
      expect(nivel?.tipo, pestana).toBe('herramienta');
      if (nivel?.tipo === 'herramienta') expect(buscar(nivel.lugar)?.pantalla.caja, pestana).toBe(pestana);
    }
  });
});

describe('rutas · la carpeta de web/estudio/ que sirve cada dirección', () => {
  it('rutas.carpeta.de_la_url_a_la_carpeta: sin el prefijo ni la barra final; la principal es la raíz', () => {
    expect(carpetaDe('/estudio/marketing/')).toBe('marketing');
    expect(carpetaDe('/estudio/marketing/distrito/')).toBe('marketing/distrito');
    expect(carpetaDe('/estudio/marketing/distrito/imagen/')).toBe('marketing/distrito/imagen');
    expect(carpetaDe(RUTA_MAPA)).toBe('');
  });

  it('rutas.carpeta.ninguna_carpeta_se_repite_y_ninguna_empieza_por_guion_bajo: las que empiezan así son privadas (_vitrina)', () => {
    const carpetas = rutasDelRecorrido().map(r => carpetaDe(r.url));
    expect(new Set(carpetas).size).toBe(carpetas.length);
    for (const c of carpetas) expect(c.startsWith('_'), c).toBe(false);
  });
});

describe('rutas · los enlaces directos: de las hojas a la página del nivel', () => {
  const rutas = rutasDelRecorrido();
  const lugares = MENU.flatMap(a => a.grupos.flatMap(g => g.pantallas.map(p => ({ area: a.clave, grupo: g.clave, pantalla: p.clave }))));

  it('rutas.enlaces.las_migas_van_directo_a_una_pagina_del_recorrido_sin_parametros: el mapa y las opciones del área, nunca /estudio/inicio/', () => {
    expect(lugares.length, 'MENU dejó de traer pantallas: esta prueba ya no muerde').toBeGreaterThan(5);
    const urls = new Set(rutas.map(r => r.url));
    for (const l of lugares) {
      for (const ver of ['mapa', 'grupos'] as const) {
        const url = urlDeInicio(l, ver);
        expect(urls.has(url), `${l.area}.${l.grupo}.${l.pantalla} (${ver}) → ${url}`).toBe(true);
        expect(url, 'ya no viaja ni ?desde= ni ?ver=').not.toMatch(/[?#]/);
        expect(url).not.toContain('inicio');
      }
    }
  });

  it('rutas.enlaces.una_miga_de_mkt_va_a_marketing_y_no_a_mkt: la dirección del área, no su clave', () => {
    const agenda = { area: 'mkt', grupo: 'blotato', pantalla: 'agenda' };
    expect(urlDeInicio(agenda, 'mapa')).toBe('/estudio/');
    expect(urlDeInicio(agenda, 'grupos')).toBe('/estudio/marketing/');
    expect(urlDeInicio({ area: 'central', grupo: 'distrito', pantalla: 'coi' }, 'grupos')).toBe('/estudio/central/');
  });

  it('rutas.enlaces.un_area_que_el_mapa_no_conoce_cae_en_la_principal: no inventa una dirección', () => {
    const rara = { area: 'nada', grupo: 'x', pantalla: 'y' };
    expect(urlDeInicio(rara, 'grupos')).toBe('/estudio/');
    expect(urlDeInicio(rara, 'mapa')).toBe('/estudio/');
    // la clave de Object.prototype tampoco es un área (el menú se busca con find, no con un objeto indexado)
    expect(urlDeInicio({ area: 'constructor', grupo: 'x', pantalla: 'y' }, 'grupos')).toBe('/estudio/');
    expect(urlDeInicio({ area: '__proto__', grupo: 'x', pantalla: 'y' }, 'grupos')).toBe('/estudio/');
  });

  it('rutas.enlaces.conectar_blotato_de_agenda_metricas_y_mix_abre_el_dialogo_en_la_pagina_del_grupo_Blotato', () => {
    const mkt = area('mkt');
    const blotato = mkt.grupos.find(g => g.clave === 'blotato');
    if (!blotato) throw new Error('MENU no trae el grupo Blotato de Marketing');
    const pagina = urlDeGrupo(mkt, blotato);
    expect(pagina).toBe('/estudio/marketing/blotato/');
    expect(nivelDeRuta(pagina)).toEqual({ tipo: 'grupo', area: 'mkt', grupo: 'blotato' });
    for (const conectar of [CONECTAR_AGENDA, CONECTAR_METRICAS, CONECTAR_MIX]) expect(conectar).toBe(`${pagina}?blotato=conectar`);
  });
});
