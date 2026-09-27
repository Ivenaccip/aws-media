# Migración de admin (UI·7, el piloto)

`static/admin.html` → `/estudio/admin/` (`web/src/pantallas/admin/`).

Es la primera pantalla que pasa por el interruptor (`server/migracion.py`) y
la única que usa solo el dueño: aquí se prueban el interruptor, `api.ts`, las
tablas y las pestañas antes de tocar una pantalla que cobre.

## Etapas

| Etapa | Qué pasa | Cómo se pasa | Estado |
|---|---|---|---|
| `nueva` | `/estudio/admin/` existe; `/admin.html` sigue igual | este PR | ⏳ al desplegar |
| `todos` | `/admin.html` → 302 a `/estudio/admin/` (conserva el query), salvo la cookie `ui=clasica` | `etapa="todos"` en `PANTALLAS` + deploy | pendiente |
| `retirada` | 302 siempre; se borran `static/admin.html` y sus tests viejos (tabla de abajo) | `etapa="retirada"`, `git rm` + deploy | pendiente |

Regla de retiro (docs/PLAN-UI.md §7): 7 días en `todos` sin incidentes. Para
admin no hay dinero de por medio, pero el criterio se mide igual: cada 302
deja en CloudWatch una línea `migracion 302 pantalla=admin etapa=todos sub=…`.

## Los invariantes (tests/test_migracion_ui.py)

Cada uno es un test de vitest en `web/src/pantallas/admin/Admin.test.tsx`
con ese nombre exacto.

| ID | Qué garantiza |
|---|---|
| `admin.vistas.tres_pestanas_con_aria` | Ingresos, Costos y Flujo, en ese orden, como pestañas de verdad (flechas, `aria-selected`) |
| `admin.acceso.sin_permiso_muestra_solo_administradores` | un 403 enseña «solo para administradores» y ningún dato |
| `admin.carga.sin_red_pide_revisar_la_conexion` | sin red, el panel no se queda en «Cargando…» |
| `admin.carga.error_del_server_muestra_su_detalle` | el `detail` del server se enseña tal cual |
| `admin.textos.del_server_se_pintan_como_texto` | un correo con HTML se lee como texto, nunca se ejecuta |
| `admin.dinero.totales_en_dolares` | los totales en «$X.XX dólares»; por usuario, cuatro decimales; nunca «centavos» |
| `admin.detalle.uid_codificado_en_la_ruta` | un id con `/` o espacios no rompe `/api/admin/usuarios/…` |
| `admin.detalle.traza_con_id_codificado` | el enlace a Langfuse codifica el id y abre aparte con `noopener` |
| `admin.detalle.sin_red_avisa_y_reintenta` | sin red, el detalle avisa y «Reintentar» lo abre (UI·16) |
| `admin.detalle.error_del_server_en_su_tarjeta` | «Error N.» dentro de la tarjeta del detalle |
| `admin.sync.doble_clic_un_solo_post` | doble clic en Sincronizar = 1 POST |
| `admin.sync.error_deja_volver_a_intentar` | tras un error, el botón vuelve a funcionar |
| `admin.flujo.signo_pinta_verde_o_rojo` | flujo positivo en verde, negativo en rojo |
| `admin.marco.enlaces_estudio_y_version_anterior` | «← Estudio» y «Usar la versión anterior» (`/ui/clasica?pantalla=admin`) |

## Cada aserción vieja y su destino

Al pasar a `retirada` se borran estos tests junto con `static/admin.html`.

### tests/test_ui14_admin.py (la carta de diseño en la vieja)

| Test viejo | Destino |
|---|---|
| `test_carga_la_carta_y_los_iconos` | Sin equivalente directo: en web/ los tokens salen de `tokens.css` y los iconos de `ui/iconos.ts`, que `test_web_tuberia.py::test_los_iconos_son_los_de_iconos_js` mantiene iguales a `iconos.js` |
| `test_titulos_en_bricolage_y_texto_en_geist` | `tokens.css` (`--font-titulo`, `--font-texto`); el `h1` del `Marco` usa `font-titulo`; las cifras usan `tabular-nums` |
| `test_sin_tamanos_de_letra_fuera_de_la_escala` | `tokens.css` borra la escala de Tailwind (`--text-*: initial`): fuera de los seis tamaños no hay clase que compile |
| `test_sin_emojis_como_iconos` | Guardián M19/M21 sobre `web/` (UI·1) y los iconos de trazo de `<Icono>` |
| `test_los_iconos_que_usa_admin_existen` | TypeScript: `NombreIcono` es la lista de `iconos.ts`; un nombre que no existe no compila |
| `test_un_solo_principal_por_vista` | Sincronizar es el único `nivel="principal"` de `Admin.tsx` |
| `test_la_vista_elegida_no_es_ambar` | `ui/Pestanas.tsx`: la elegida va en blanco (`border-texto`); arreglado en este PR, venía en ámbar desde UI·6 |
| `test_enlaces_en_azul_claro_y_sin_colores_sueltos` | Guardián M20 sobre `web/` (UI·1): ningún color fuera de la paleta; enlaces con `text-enlace` |
| `test_filas_tocables_de_44` | La fila ya no se toca entera: el nombre es un botón de 44 px (`min-h-11`) con `aria-label`, así el teclado y el lector lo encuentran |
| `test_sin_sepia` | Guardián M20 sobre `web/` |

### tests/test_ui16_admin.py (los avisos del panel)

| Test viejo | Destino |
|---|---|
| `test_detalle_envuelve_el_fetch_y_avisa_en_el_cuadro` | `admin.detalle.sin_red_avisa_y_reintenta` y `admin.detalle.error_del_server_en_su_tarjeta`. El aviso ya no va al cuadro de `trabajos.js`: la pantalla nueva no lo carga y avisa dentro del detalle, con Reintentar |
| `test_lo_que_se_queda_en_su_sitio` | `admin.carga.sin_red_pide_revisar_la_conexion` y `admin.sync.error_deja_volver_a_intentar` |
| `test_sin_red_cierra_el_detalle_y_reintentar_lo_abre` | `admin.detalle.sin_red_avisa_y_reintenta` |

### Otros módulos que miran admin

| Aserción vieja | Destino |
|---|---|
| `test_ui_escapar.py::test_se_encontraron_las_esc` (`static/admin.html` define su `esc`) | `admin.textos.del_server_se_pintan_como_texto`. Al retirar, se quita `static/admin.html` de la lista esperada |
| `test_cache_estaticos.py` (`/admin.html` es HTML `no-cache`) | Mientras la vieja exista la sirve `server/migracion.py` con `no-cache` (`test_migracion.py::test_nueva_sirve_la_vieja_sin_redirigir`). Al retirar, el 302 lleva `no-store` y `/admin.html` sale de esa lista |

## Diferencias a propósito

- Tras sincronizar, el resumen se vuelve a pedir en su sitio; la vieja
  recargaba la página entera.
- Un flujo negativo se escribe `-$0.3000`; la vieja escribía `$-0.3000`.
- No carga `monedero.js` (el panel no cobra) ni `trabajos.js` (los avisos
  van dentro de la pantalla).
- Fuera de la paleta, en React no hay `innerHTML`: el escape lo hace React
  (y eslint prohíbe `dangerouslySetInnerHTML`).
- La nota de Costos ya no nombra `pricing.json`: el bundle es público y
  `test_web_tuberia.py` prohíbe que el nombre llegue a `web/dist`. Dice «la
  tarifa de Aurora» y «las tarifas de AWS».
