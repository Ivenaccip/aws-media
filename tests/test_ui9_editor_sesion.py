"""UI·9 — el editor de cortes a los 60 min de sesión.

El id_token dura 60 min y el editor no cargaba auth.js: sus fetch relativos
("api/save") viajaban solo con la cookie, que vence con el token. Guardar daba
401 y lo editado no tenía a dónde ir. Ahora:

  · auth.js renueva la sesión cuando le quedan menos de 5 min;
  · el envoltorio de fetch también toma las rutas relativas;
  · si aun así hay que ir a entrar, el editor aparta lo no guardado y lo
    reenvía al volver, con la versión en la que se editó.

Los tests corren el código real en node con el navegador simulado.
"""
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
AUTH = RAIZ / "static" / "auth.js"
EDITOR = (RAIZ / "tools" / "editor" / "index.html").read_text(encoding="utf-8")
NODE = shutil.which("node")
pytestmark = pytest.mark.skipif(not NODE, reason="sin node")


def _node(js, *args):
    out = subprocess.run([NODE, "-e", js, *map(str, args)], capture_output=True,
                         text=True, check=True, timeout=30)
    return json.loads(out.stdout.strip().splitlines()[-1])


# ---------------------------------------------------------------------------
# auth.js en la página del editor

_NAVEGADOR = r"""
const cuenta = { refresh: 0, authorize: 0, saliendo: 0, conToken: 0 };
const exp = s => 'x.' + Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + s })).toString('base64url') + '.y';
const ls = new Map([['auth_id_token', exp(%(queda)d)], ['auth_refresh_token', 'RT']]);
const ss = new Map();
globalThis.localStorage = { getItem: k => ls.has(k) ? ls.get(k) : null,
  setItem: (k, v) => ls.set(k, v), removeItem: k => ls.delete(k) };
globalThis.sessionStorage = { getItem: k => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v),
  removeItem: k => ss.delete(k) };
const loc = { origin: 'https://irremplazables.xyz', pathname: '/editor/mi-video/', search: '',
  protocol: 'https:', href: 'https://irremplazables.xyz/editor/mi-video/' };
Object.defineProperty(loc, 'href', { get: () => 'https://irremplazables.xyz/editor/mi-video/',
  set: u => { if (u.includes('/oauth2/authorize')) cuenta.authorize++; } });
globalThis.location = loc;
globalThis.atob = s => Buffer.from(s, 'base64').toString('binary');
const intervalos = [];
globalThis.setInterval = f => { intervalos.push(f); return 0; };
globalThis.document = { cookie: '', body: null, visibilityState: 'visible', addEventListener: () => {} };
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.dispatchEvent = e => { if (e.type === 'auth:saliendo') cuenta.saliendo++; };
globalThis.Event = class { constructor(t) { this.type = t; } };
const espera = ms => new Promise(r => setTimeout(r, ms));
globalThis.fetch = async (url, init) => {
  if (url === '/api/auth/config') return { ok: true, status: 200,
    json: async () => ({ activo: true, dominio: 'x.auth', client_id: 'c' }) };
  if (String(url).includes('/oauth2/token')) {
    cuenta.refresh++;
    return %(refresca)s ? { ok: true, json: async () => ({ id_token: 'NUEVO' }) } : { ok: false };
  }
  const t = init && init.headers && init.headers.get('Authorization');
  if (t) cuenta.conToken++;
  return { status: t === 'Bearer NUEVO' ? 200 : 401 };
};
require(process.argv[1]);
(async () => {
  %(accion)s
  await espera(50);
  console.log(JSON.stringify(cuenta));
})();
"""


def _auth(queda=3600, refresca=True, accion=""):
    js = _NAVEGADOR % {"queda": queda, "refresca": "true" if refresca else "false", "accion": accion}
    return _node(js, AUTH)


def test_el_envoltorio_toma_las_rutas_relativas_del_editor():
    c = _auth(accion="const r = await Promise.race([window.fetch('api/save', { method: 'POST', body: '{}' }), espera(200)]); cuenta.status = r && r.status;")
    # llevó el token, dio 401, refrescó UNA vez y el reintento pasó
    assert c["conToken"] >= 1 and c["refresh"] == 1 and c["status"] == 200, c


def test_un_host_ajeno_no_se_toca():
    c = _auth(accion="await window.fetch('https://cdn.otro.example/x.mp4');")
    assert c["conToken"] == 0 and c["refresh"] == 0, c


def test_renueva_antes_de_que_venza():
    c = _auth(queda=240, accion="for (const f of intervalos) await f();")
    assert c["refresh"] == 1, c


def test_no_renueva_si_aun_queda_tiempo():
    c = _auth(queda=1800, accion="for (const f of intervalos) await f();")
    assert c["refresh"] == 0, c


def test_avisa_antes_de_irse_a_entrar():
    c = _auth(refresca=False, accion="await Promise.race([window.fetch('api/save', { method: 'POST' }), espera(200)]);")
    assert c["authorize"] == 1 and c["saliendo"] == 1, c


# ---------------------------------------------------------------------------
# el editor: apartar lo no guardado y reenviarlo al volver

def test_el_editor_carga_auth_js():
    assert '<script src="/auth.js"></script>' in EDITOR
    assert EDITOR.index('src="/auth.js"') < EDITOR.index('"use strict"')


def _bloque_pendiente():
    ini = EDITOR.index('const PENDIENTE = ')
    fin = EDITOR.index('async function render()')
    return EDITOR[ini:fin]


_EDITOR_JS = r"""
const ss = new Map(%(sesion)s);
globalThis.sessionStorage = { getItem: k => ss.get(k) ?? null, setItem: (k, v) => ss.set(k, v),
  removeItem: k => ss.delete(k) };
const res = { posts: [], status: null, recargo: false };
globalThis.location = { pathname: '/editor/mi-video/', reload: () => { res.recargo = true; } };
const oyentes = {};
globalThis.addEventListener = (t, f) => { oyentes[t] = f; };
let VERSION = %(version)d, dirty = %(dirty)s, txDirty = false, changes = ['corte manual'], txEdits = {};
const cortesParaGuardar = () => ({ clips: ['EDITADO'] });
const setStatus = (m, c) => { res.status = [m, c]; };
globalThis.fetch = async (url, init) => {
  res.posts.push([url, JSON.parse(init.body)]);
  return { json: async () => (%(guarda)s ? { saved: true, version: 8 } : { saved: false, error: 'se cayó' }) };
};
%(bloque)s
(async () => {
  %(accion)s
  res.sesion = Object.fromEntries(ss);
  console.log(JSON.stringify(res));
})();
"""

CLAVE = "editor_pendiente:/editor/mi-video/"


def _editor(accion, sesion=None, version=7, dirty=False, guarda=True):
    js = _EDITOR_JS % {"sesion": json.dumps(list((sesion or {}).items())), "version": version,
                       "dirty": "true" if dirty else "false", "guarda": "true" if guarda else "false",
                       "bloque": _bloque_pendiente(), "accion": accion}
    return _node(js)


def test_al_irse_aparta_lo_no_guardado():
    r = _editor("oyentes['auth:saliendo']();", dirty=True)
    p = json.loads(r["sesion"][CLAVE])
    assert p == {"base": 7, "cuts": {"clips": ["EDITADO"]}, "changes": ["corte manual"], "edits": None}


def test_sin_cambios_no_aparta_nada():
    r = _editor("oyentes['auth:saliendo']();", dirty=False)
    assert CLAVE not in r["sesion"]


def _pendiente(base=7):
    return {CLAVE: json.dumps({"base": base, "cuts": {"clips": ["EDITADO"]},
                               "changes": ["corte manual"], "edits": None})}


def test_al_volver_lo_guarda_con_su_version_y_recarga():
    r = _editor("await recuperarPendiente();", sesion=_pendiente())
    assert r["posts"] == [["api/save", {"cuts": {"clips": ["EDITADO"]}, "changes": ["corte manual"], "base": 7}]]
    assert r["recargo"] and CLAVE not in r["sesion"] and r["sesion"][CLAVE + ":ok"] == "1"


def test_tras_recargar_dice_que_se_guardo():
    r = _editor("await recuperarPendiente();", sesion={CLAVE + ":ok": "1"})
    assert r["status"][1] == "ok" and "guardamos" in r["status"][0]
    assert r["posts"] == [] and not r["recargo"]


def test_si_otro_guardo_en_medio_no_lo_pisa():
    r = _editor("await recuperarPendiente();", sesion=_pendiente(base=6), version=7)
    assert r["posts"] == [] and r["status"][1] == "err" and not r["recargo"]


def test_si_falla_el_guardado_lo_conserva():
    r = _editor("await recuperarPendiente();", sesion=_pendiente(), guarda=False)
    assert r["status"][1] == "err" and "se cayó" in r["status"][0]
    assert CLAVE in r["sesion"] and not r["recargo"]
