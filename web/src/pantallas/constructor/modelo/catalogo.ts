// El catálogo del Constructor: lo que sabemos de n8n (proveedores de IA, disparadores, apps) y
// cómo se busca. Es una tabla escrita a mano (decisión D6 del plan) con una prueba que la compara
// con media/library/n8n/catalog.json y permitidos.json, no una copia de ellos: el navegador no
// necesita los 568 nodos del catálogo. Los datos viven en datos/; aquí se juntan y se buscan.
//
// Todo `params…()` devuelve un objeto NUEVO: quien exporta puede modificarlo sin tocar el catálogo.

import { APPS, OTRA_APP } from './datos/apps';
import { AGENTE_N8N, AYUDANTE_N8N, DISPARADORES_N8N, disparadorN8n } from './datos/disparadoresN8n';
import {
  APPS_DISPARADOR,
  FRECUENCIAS,
  TIPO_CHAT,
  TIPOS_DISPARADOR,
} from './datos/disparadores';
import { IA_OPENAI, IAS, MODELO_OPENAI } from './datos/ias';
import { PENDIENTES, pendienteDe } from './datos/pendientes';
import { norm } from './texto';
import type { DefApp, DefIA, DefTipoDisparador } from './tipos';

export {
  AGENTE_N8N,
  APPS,
  APPS_DISPARADOR,
  AYUDANTE_N8N,
  DISPARADORES_N8N,
  disparadorN8n,
  FRECUENCIAS,
  IAS,
  MODELO_OPENAI,
  OTRA_APP,
  PENDIENTES,
  pendienteDe,
  TIPOS_DISPARADOR,
};

/** El ícono (de `ui/iconos.ts`) de un agente de IA. */
export const ICONO_AGENTE = 'magia';
/** El ícono (de `ui/iconos.ts`) de una app. */
export const ICONO_APP = 'app';

/** El proveedor de IA con ese id. Si no existe cae en OpenAI (el de por defecto). */
export function iaDe(id: unknown): DefIA {
  return IAS.find(x => x.id === id) ?? IA_OPENAI;
}

/** El tipo de disparador con ese id. Si no existe cae en «Chat». */
export function tipoDeDisparador(id: unknown): DefTipoDisparador {
  return TIPOS_DISPARADOR.find(x => x.id === id) ?? TIPO_CHAT;
}

/**
 * La app del catálogo a la que se refiere ese nombre: el nombre exacto o uno de sus alias, sin
 * mayúsculas ni acentos («sheets» y «Google Hojas» son Google Sheets). Sin nombre, o si no es de
 * ninguna, null: ahí se exporta un HTTP Request.
 */
export function appDe(nombre: unknown): DefApp | null {
  const n = norm(nombre);
  if (!n) return null;
  return APPS.find(a => norm(a.nombre) === n || a.alias.includes(n)) ?? null;
}
