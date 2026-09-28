"""tools/verificar_web.py: el chequeo de producción de UI·6, con respuestas falsas."""
from tools.verificar_web import claves_prohibidas, verificar

VITRINA = '<link href="/estudio/assets/v-Ab12.css"><script src="/estudio/assets/v-Cd34.js"></script>'


def _prod(**cambios):
    r = {
        "/estudio/_vitrina/": (200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-cache",
                                     "x-robots-tag": "noindex, nofollow"}, VITRINA),
        "/estudio/assets/v-Ab12.css": (200, {"cache-control": "public, max-age=31536000, immutable",
                                             "cf-cache-status": "HIT"}, "body{}"),
        "/estudio/assets/v-Cd34.js": (200, {"cache-control": "public, max-age=31536000, immutable",
                                            "cf-cache-status": "HIT"}, "console.log(1)"),
        "/estudio/assets/no-existe.js": (404, {"content-type": "application/json"}, "{}"),
        "/auth.js": (200, {"cache-control": "no-cache"}, ""),
    }
    r.update(cambios)
    return lambda url: r[url.removeprefix("https://x")]


def _fallas(res):
    return [t for ok, t in res if not ok]


def test_produccion_sana_pasa_todo():
    assert _fallas(verificar("https://x", _prod(), {"clave_secreta"})) == []


def test_sin_vitrina_para_ahi():
    res = verificar("https://x", _prod(**{"/estudio/_vitrina/": (404, {"content-type": "application/json"}, "")}), set())
    assert len(res) == 1 and not res[0][0]


def test_auth_js_pisado_por_cloudflare_falla():
    res = verificar("https://x", _prod(**{"/auth.js": (200, {"cache-control": "max-age=14400"}, "")}), set())
    assert _fallas(res) == ["/auth.js no-cache (salió 200, max-age=14400)"]


def test_asset_sin_hit_o_sin_immutable_falla():
    malo = (200, {"cache-control": "no-cache", "cf-cache-status": "MISS"}, "")
    res = verificar("https://x", _prod(**{"/estudio/assets/v-Cd34.js": malo}), set())
    assert len(_fallas(res)) == 2


def test_clave_de_pricing_colada_falla():
    js = (200, {"cache-control": "immutable", "cf-cache-status": "HIT"}, "x.veo_usd_seg=1")
    res = verificar("https://x", _prod(**{"/estudio/assets/v-Cd34.js": js}), {"veo_usd_seg"})
    assert _fallas(res) == ["sin claves de pricing.json en los assets: ['veo_usd_seg']"]


def test_el_asset_inexistente_no_puede_ser_html():
    res = verificar("https://x", _prod(**{"/estudio/assets/no-existe.js": (200, {"content-type": "text/html"}, "")}), set())
    assert len(_fallas(res)) == 1


def test_las_claves_prohibidas_salen_de_pricing_json():
    k = claves_prohibidas()
    assert "pricing.json" in k and "usd_por_mes" not in k and len(k) > 5
