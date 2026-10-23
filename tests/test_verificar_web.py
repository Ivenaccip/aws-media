"""tools/verificar_web.py: el chequeo de producción de UI·6, con respuestas falsas."""
from tools.verificar_web import claves_prohibidas, verificar

VITRINA = '<link href="/estudio/assets/v-Ab12.css"><script src="/estudio/assets/v-Cd34.js"></script>'


def _prod(**cambios):
    r = {
        "/estudio/_vitrina/": (200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-cache",
                                     "x-robots-tag": "noindex, nofollow"}, VITRINA),
        "/estudio/": (200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-cache"}, "<title>mapa</title>"),
        "/estudio/marketing": (200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-cache"}, "<title>m</title>"),
        "/estudio/assets/v-Ab12.css": (200, {"cache-control": "public, max-age=31536000, immutable",
                                             "cf-cache-status": "HIT"}, "body{}"),
        "/estudio/assets/v-Cd34.js": (200, {"cache-control": "public, max-age=31536000, immutable",
                                            "cf-cache-status": "HIT"}, "console.log(1)"),
        "/estudio/assets/no-existe.js": (404, {"content-type": "application/json"}, "{}"),
        "/auth.js": (200, {"cache-control": "no-cache"}, ""),
    }
    r.update(cambios)

    def pedir(url, seguir=True):
        # como urllib: con `seguir` (lo de siempre) un 302 se sigue hasta su destino; sin él, se entrega el 302
        st, h, cuerpo = r[url.removeprefix("https://x")]
        if seguir and st in (301, 302, 303, 307, 308):
            return pedir("https://x" + h["location"])
        return st, h, cuerpo
    return pedir


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


def test_la_principal_tiene_que_ser_una_pagina_que_revalida():
    """/estudio/ ya no es un 302 al inicio: se sirve (200, HTML, no-cache). Una que devuelve JSON, un 404 o se queda en la caché falla."""
    res = verificar("https://x", _prod(**{"/estudio/": (404, {"content-type": "application/json"}, "{}")}), set())
    assert _fallas(res) == ["principal /estudio/ 200 y HTML (salió 404, application/json)", "principal no-cache (salió —)"]
    en_cache = (200, {"content-type": "text/html", "cache-control": "public, max-age=14400"}, "")
    res = verificar("https://x", _prod(**{"/estudio/": en_cache}), set())
    assert _fallas(res) == ["principal no-cache (salió public, max-age=14400)"]


def test_la_principal_no_puede_ser_un_302_aunque_su_destino_de_200():
    """Como estaba main antes de las rutas por nivel: /estudio/ → 302 → /estudio/inicio/ (200, HTML, no-cache). Seguir el 302 lo daría
    por bueno; la principal se pide sin seguirlo y falla."""
    pagina = (200, {"content-type": "text/html; charset=utf-8", "cache-control": "no-cache"}, "<title>inicio</title>")
    res = verificar("https://x", _prod(**{"/estudio/": (302, {"location": "/estudio/inicio/"}, ""), "/estudio/inicio/": pagina}), set())
    assert _fallas(res) == ["principal /estudio/ 200 y HTML (salió 302, —)", "principal no-cache (salió —)"]


def test_el_pedido_sin_seguir_entrega_el_302_de_verdad():
    """`pedir(..., seguir=False)` contra un servidor local que redirige: el estado es 302 y su Location, no el 200 del destino."""
    import http.server
    import threading

    from tools.verificar_web import pedir

    class Manejador(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            if self.path == "/estudio/":
                self.send_response(302)
                self.send_header("Location", "/estudio/inicio/")
                self.end_headers()
            else:
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"<title>inicio</title>")

        def log_message(self, *a):
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Manejador)
    hilo = threading.Thread(target=srv.serve_forever, daemon=True)
    hilo.start()
    try:
        base = f"http://127.0.0.1:{srv.server_address[1]}"
        st, h, _ = pedir(base + "/estudio/", seguir=False)
        assert st == 302 and h["location"] == "/estudio/inicio/"
        assert pedir(base + "/estudio/")[0] == 200, "lo de siempre sigue el 302"
    finally:
        srv.shutdown()
        srv.server_close()


def test_una_direccion_sin_barra_tiene_que_llegar_a_una_pagina():
    """/estudio/marketing da 404 JSON hasta que el servidor la corrige (server/web.py); urllib sigue el 302 y mira el destino."""
    res = verificar("https://x", _prod(**{"/estudio/marketing": (404, {"content-type": "application/json"}, "{}")}), set())
    assert _fallas(res) == ["/estudio/marketing (sin barra) llega a una página 200 y HTML (salió 404, application/json)"]


def test_las_claves_prohibidas_salen_de_pricing_json():
    k = claves_prohibidas()
    assert "pricing.json" in k and "usd_por_mes" not in k and len(k) > 5
