import { describe, expect, it } from 'vitest';

import { conClave, SECRETOS } from './secretos';

// Este archivo NO lee nada de fuera de web/ (la etapa `web` del Dockerfile solo copia web/): la paridad con
// pipeline/validador.py:SECRETOS la vigila tests/test_constructor_paridad.py, que lee los patrones y las sondas que
// catalogo.paridad.test.ts deja en golden/catalogo-usado.json.

// Cadenas armadas por pedazos: así ninguna parece una clave de verdad al revisar el repo
const repite = (c: string, n: number) => c.repeat(n);
const SK = `${'s'}k-${repite('a', 20)}`;
const AIZA = `${'AI'}za${repite('b', 35)}`;
const SLACK = `${'x'}oxb-${repite('1', 10)}`;
const GITHUB = `${'g'}hp_${repite('c', 30)}`;
const TELEGRAM = `${repite('1', 9)}:${repite('d', 35)}`;
const BEARER = `${'bea'}rer ${repite('e', 20)}`;
const PEM = `-----BEGIN ${'RSA PRIV'}ATE KEY-----`;
const AWS = `${'AK'}IA${repite('F', 16)}`;
// los ocho formatos que Python todavía no conoce (índices 8 a 15)
const NOTION = `${'n'}tn_${repite('N', 30)}`;
const NOTION_VIEJO = `${'sec'}ret_${repite('V', 40)}`;
const AIRTABLE = `${'pa'}t${repite('A', 14)}.${repite('0', 64)}`;
const META = `${'EA'}A${repite('M', 40)}`;
const SLACK_APP = `${'x'}app-1-${repite('S', 24)}`;
const GITHUB_FINO = `${'github'}_pat_${repite('G', 50)}`;
const STRIPE = `${'s'}k_live_${repite('T', 24)}`;
const STRIPE_RESTRINGIDA = `${'r'}k_test_${repite('T', 24)}`;
const SENDGRID = `${'S'}G.${repite('W', 22)}.${repite('W', 43)}`;

const FAMILIAS_DE_PYTHON = [SK, AIZA, SLACK, GITHUB, TELEGRAM, BEARER, PEM, AWS];
const FAMILIAS_NUEVAS = [NOTION, NOTION_VIEJO, AIRTABLE, META, SLACK_APP, GITHUB_FINO, STRIPE, SENDGRID];

describe('SECRETOS', () => {
  it('constructor.secretos.los_dieciseis_patrones_no_guardan_estado_ni_usan_lookbehind_y_solo_bearer_ignora_mayusculas', () => {
    expect(SECRETOS).toHaveLength(16);
    SECRETOS.forEach((r, i) => {
      // sin `g` ni `y`: con ellas `test` recordaría dónde se quedó y respondería distinto la segunda vez
      expect(r.global, `patrón ${i} g`).toBe(false);
      expect(r.sticky, `patrón ${i} y`).toBe(false);
      expect(r.multiline, `patrón ${i} m`).toBe(false);
      expect(r.unicode, `patrón ${i} u`).toBe(false);
      // un lookbehind rompe la carga del módulo en un Safari viejo
      expect(r.source, `patrón ${i}`).not.toMatch(/\(\?<[!=]/);
      expect(r.ignoreCase, `patrón ${i} (?i)`).toBe(i === 5);
    });
    expect(new Set(SECRETOS.map(r => r.source)).size).toBe(SECRETOS.length);
    // y la segunda vez, igual (sin estado)
    for (const clave of [...FAMILIAS_DE_PYTHON, ...FAMILIAS_NUEVAS]) {
      expect(conClave(clave)).toBe(true);
      expect(conClave(clave)).toBe(true);
    }
  });

  it('constructor.secretos.con_clave_reconoce_las_ocho_familias_de_python_y_deja_pasar_el_texto_normal', () => {
    FAMILIAS_DE_PYTHON.forEach((clave, i) => {
      expect(SECRETOS[i]?.test(clave), `la familia ${i} reconoce su clave`).toBe(true);
      // metida en una frase, también
      expect(conClave(`mi llave es ${clave} y ya`), `familia ${i} en una frase`).toBe(true);
      // y la segunda vez, igual (sin estado)
      expect(conClave(clave)).toBe(true);
      expect(conClave(clave)).toBe(true);
    });
    // bearer no distingue mayúsculas; los demás sí
    expect(conClave(`BEARER ${repite('e', 20)}`)).toBe(true);
    expect(conClave(`Bearer ${repite('e', 20)}`)).toBe(true);
    expect(conClave(SK.toUpperCase())).toBe(false);

    const normales = [
      '',
      '   ',
      'Eres el asistente de atención a clientes. Responde en español, con claridad.',
      'Mi Flujo Ñandú',
      'mi-flujo',
      'Resumen diario de {{ $json.output }}',
      'sk-corto',
      `${'AI'}za${repite('b', 34)}`, // falta uno
      'xoxb-123',
      `${'g'}hp_${repite('c', 29)}`,
      `${repite('1', 7)}:${repite('d', 35)}`, // menos de 8 dígitos
      `${repite('1', 11)}:${repite('d', 35)}`, // más de 10 dígitos
      `${repite('1', 9)}:${repite('d', 34)}`,
      `${'bea'}rer ${repite('e', 19)}`,
      '-----BEGIN PUBLIC KEY-----',
      '-----BEGIN PRIVATE-----',
      `x${AWS}`, // pegada a una letra no es un límite de palabra
      `${AWS}G`,
      `${'AK'}IA${repite('F', 15)}`,
      '日本語 😀',
    ];
    for (const t of normales) expect(conClave(t), t).toBe(false);
  });

  it('constructor.secretos.una_palabra_con_sk_dentro_no_es_una_clave_pero_la_clave_suelta_o_con_etiqueta_si', () => {
    // texto normal con guiones: «task-…», «risk-…», «disk-…» llevan «sk-» pero no son una clave
    const normales = [
      'task-management-system-webhook',
      'risk-assessment-for-the-quarter',
      'disk-usage-report-daily-summary',
      'mi-flujo-de-seguimiento-de-tareas',
      'Resumen del task-management-system-webhook de cada lunes',
      'https://www.notion.so/Task-Tracker-Weekly-Plan-0123456789abcdef',
      `https://www.notion.so/Risk-Register-Q3-${repite('0', 32)}`,
      `high${'p'}_${repite('c', 30)}`, // «highp_…»: «gh» pegado a una letra no empieza una clave
      `${'a'}${GITHUB}`,
    ];
    for (const t of normales) expect(conClave(t), t).toBe(false);

    // la clave de verdad, sola, con su etiqueta, entre comillas o en una URL, sí
    const claves = [
      `${'sk'}-proj-${repite('a', 24)}`,
      `OPENAI_API_KEY=${SK}`,
      ` Authorization: ${SK}`,
      `"${SK}"`,
      `https://example.com/?k=${SK}`,
      `usa la llave:${SK}`,
      `- ${SK}`,
      `OPENROUTER_API_KEY=${'sk'}-or-v1-${repite('0', 32)}`,
      `token ${GITHUB}`,
    ];
    for (const t of claves) expect(conClave(t), t).toBe(true);
  });

  it('constructor.secretos.con_clave_reconoce_los_ocho_formatos_de_notion_airtable_whatsapp_slack_github_stripe_y_sendgrid', () => {
    const nombres = ['Notion', 'Notion (viejo)', 'Airtable', 'WhatsApp/Meta', 'Slack (aplicación)', 'GitHub (grano fino)', 'Stripe', 'SendGrid'];
    FAMILIAS_NUEVAS.forEach((clave, i) => {
      expect(SECRETOS[8 + i]?.test(clave), `${nombres[i]} lo reconoce su patrón`).toBe(true);
      // y solo ese: ningún otro patrón se mete
      expect(
        SECRETOS.flatMap((r, j) => (r.test(clave) ? [j] : [])),
        `${nombres[i]}`,
      ).toEqual([8 + i]);
      expect(conClave(`pegué esto: ${clave} ¿sirve?`), `${nombres[i]} en una frase`).toBe(true);
      expect(conClave(`TOKEN=${clave}`), `${nombres[i]} con etiqueta`).toBe(true);
    });
    expect(conClave(STRIPE_RESTRINGIDA)).toBe(true);
    expect(SECRETOS[14]?.test(STRIPE_RESTRINGIDA)).toBe(true);

    const normales = [
      `${'n'}tn_${repite('N', 29)}`, // falta uno
      `${'sec'}ret_${repite('V', 39)}`,
      `${'pa'}t${repite('A', 13)}.${repite('0', 64)}`,
      `${'pa'}t${repite('A', 14)}.${repite('0', 63)}`,
      `${'pa'}t${repite('A', 14)}.${repite('Z', 64)}`, // la segunda parte es hexadecimal
      `${'EA'}A${repite('M', 39)}`,
      `${'x'}app-1-${repite('S', 19)}`,
      `${'github'}_pat_${repite('G', 49)}`,
      `${'s'}k_live_${repite('T', 15)}`,
      `${'p'}k_live_${repite('T', 24)}`, // la clave publicable no es secreta
      `${'s'}k_prod_${repite('T', 24)}`,
      `${'S'}G.${repite('W', 15)}.${repite('W', 43)}`,
      `${'S'}G.${repite('W', 22)}`,
      `x${NOTION}`, // pegado a una letra no es un límite de palabra
      `x${AIRTABLE}`,
      `x${META}`,
      `x${SENDGRID}`,
      `x${STRIPE}`,
      'secret_santa_2026_lista_de_regalos', // «secret_» sin 40 caracteres seguidos
      'EAA tiene que ver con el correo',
      'ntn_',
    ];
    for (const t of normales) expect(conClave(t), t).toBe(false);
  });

  it('constructor.secretos.con_clave_tolera_lo_que_no_es_texto', () => {
    expect(conClave(null)).toBe(false);
    expect(conClave(undefined)).toBe(false);
    expect(conClave(0)).toBe(false);
    expect(conClave(false)).toBe(false);
    expect(conClave(12345)).toBe(false);
    expect(conClave({})).toBe(false);
    expect(conClave([SK])).toBe(false);
    // un objeto de JSON cuyo toString no es una función hace lanzar a String(): aquí no
    const sinToString: unknown = JSON.parse('{"toString":null}');
    expect(() => conClave(sinToString)).not.toThrow();
    expect(conClave(sinToString)).toBe(false);
    // __proto__, constructor y toString son texto como cualquier otro
    for (const t of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) expect(conClave(t), t).toBe(false);
  });

  it('constructor.secretos.ningun_patron_se_atora_con_un_texto_enorme_hecho_a_proposito', () => {
    // sin retroceso catastrófico: cada texto malicioso mide 1 millón de caracteres y los 16 patrones lo recorren en una fracción de segundo
    const MIL = 1_000_000;
    const textos = [
      repite('a', MIL),
      repite('sk-', MIL / 3),
      repite('sk-a', MIL / 4),
      repite('SG.', MIL / 3),
      repite('SG.a.', MIL / 5),
      repite('pat', MIL / 3),
      repite('EAA', MIL / 3),
      repite('ntn_', MIL / 4),
      repite('secret_', MIL / 7),
      repite('github_pat_', MIL / 11),
      repite('xapp-1-', MIL / 7),
      repite('sk_live_', MIL / 8),
      repite('1234567890:', MIL / 11),
      repite('AKIA', MIL / 4),
      `${'bea'}rer ${repite(' ', MIL)}`,
      `${repite('-', MIL)}`,
    ];
    const inicio = performance.now();
    for (const t of textos) conClave(t);
    // 1 000 ms: la medida real es de unas decenas de milisegundos; esto solo atrapa un retroceso exponencial
    expect(performance.now() - inicio).toBeLessThan(1000);
  });
});
