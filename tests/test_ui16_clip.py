"""UI·16 — el clip manda el fallo al traer su lista al cuadro de trabajos.js
(window.avisos), con «Reintentar», sin perder el reintento solo de 15 s.

Se quedan en su sitio: #estado (validación y error junto a «Generar») y
#est-foto (el error de la foto, junto a las fotos).
"""
import re
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
CLIP = (RAIZ / "static" / "clip.html").read_text(encoding="utf-8")


def _cargar():
    i = CLIP.index("async function clCargar()")
    return CLIP[i:CLIP.index("\n}\n", i)]


def test_el_fallo_de_carga_va_al_cuadro_con_reintentar():
    c = _cargar()
    assert re.search(r'window\.avisos\?\.mostrar\("No pudimos traer tus clips\.[^"]*",\s*'
                     r'\{ tipo: "mal", clave: "clip-carga", accion: \{ texto: "Reintentar", al: clCargar \} \}\);', c)
    assert '$("clips").innerHTML = `<span class="err">' not in CLIP


def test_sigue_el_reintento_solo_y_se_quita_al_cargar_bien():
    c = _cargar()
    catch = c[c.index("} catch (e) {"):]
    assert "clPoll = setTimeout(clCargar, 15000);" in catch
    ok = c[:c.index("} catch (e) {")]
    assert 'window.avisos?.quitar("clip-carga");' in ok
    assert ok.index('const j = await clFj("/api/clip");') < ok.index('window.avisos?.quitar("clip-carga");')


def test_todas_las_llamadas_usan_encadenamiento_opcional():
    assert not re.search(r"window\.avisos\.(mostrar|quitar)", CLIP)


def test_estado_y_est_foto_siguen_en_su_sitio():
    assert 'if (!texto) { $("estado").textContent = "Escribe qué quieres ver primero."; return; }' in CLIP
    assert '$("estado").textContent = "Espera a que terminen de subir tus fotos.";' in CLIP
    assert "$(\"estado\").innerHTML = `<span class=\"err\">${clEsc(e.message)}</span>`;" in CLIP
    assert '$("est-foto").innerHTML = \'<span class="err">Esa foto pesa demasiado (máximo 20 MB).</span>\';' in CLIP
    assert "$(\"est-foto\").innerHTML = `<span class=\"err\">${clEsc(e.message)}</span>`;" in CLIP
