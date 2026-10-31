"""Fase 2 — el invitador desde la máquina del dueño (espejo de tools/usuarios.py).

    python tools/invitaciones.py cargar community_members.csv             # REVISA, no escribe
    python tools/invitaciones.py cargar community_members.csv --ejecutar  # ahora sí
    python tools/invitaciones.py aprobar correo@x.com                     # un 'revisar' pasa a 'ok'
    python tools/invitaciones.py excluir correo@x.com                     # no se le escribe nunca
    python tools/invitaciones.py historial --dir tools                    # REVISA el backfill
    python tools/invitaciones.py historial --dir tools --ejecutar
    python tools/invitaciones.py modo ensayo --nota "primer día"          # apagado | ensayo | activo
    python tools/invitaciones.py modo activo --tope 40 --cada 3 --nota "arranca el bot"
    python tools/invitaciones.py modo activo --cada 1 --nota "ya a diario"    # sin deploy
    python tools/invitaciones.py modo activo --tope 0 --nota "cierro la página"   # bot y página
    python tools/invitaciones.py hoy                                      # lo que haría el bot hoy
    python tools/invitaciones.py estado

En cmd de Windows va un comando por línea (cmd no entiende `&&` dentro de un
copiar-pegar de varias). Se corre desde la raíz del repo con el venv:
`venv\\Scripts\\python tools\\invitaciones.py ...`.

`cargar` lee el CSV que exporta Skool (no hay API) y lo deja como el export
VIGENTE: el bot solo invita y recuerda a quien viene en el último. Antes de
escribir revisa cada dirección con el mismo filtro de dedazos de las tandas
(`revisar()` de tools/usuarios.py) y busca a la misma persona con otro correo:
un nombre parecido al de alguien que ya tiene cuenta. Esos quedan en 'revisar'
y el bot no los toca hasta que el dueño diga `aprobar` o `excluir`.

`historial` anota lo que pasó antes del bot, leyendo los archivos REALES de
`--dir` (tools/ en la máquina del dueño): la invitación de cada cuenta del pool
(con la hora de su `tandaN.txt.altas.tsv`, o la de Cognito si no está en
ninguna) y cada reenvío de `reenvioN.txt` como R1 (regla del dueño: los
reenvíos manuales cuentan como R1), con la fecha de su encabezado
(«# Reenvío 3 — 16-oct-2026 · ...») confirmada contra la última modificación de
la cuenta en Cognito: si Cognito no la tocó desde antes de ese día, ese reenvío
no salió y NO se anota (sale como «NO SALIÓ»). Correrlo dos veces no duplica nada.

`hoy` y `estado` solo leen (el pool y la base): `hoy` es la selección EXACTA
que haría el bot en este momento, porque llama a la misma función, y dice si con
la frecuencia vigente corre la siguiente salida del reloj. Si no, enseña lo que
mandaría.

Necesita credenciales AWS (cognito-idp de lectura + Data API) y los ARNs de la
base (DB_CLUSTER_ARN / DB_SECRET_ARN o --cluster-arn/--secret-arn), como
tools/usuarios.py. Pool por COGNITO_POOL_ID o --pool.
"""
from __future__ import annotations

import argparse
import csv
import os
import re
import sys
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

RAIZ = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ))
sys.path.insert(0, str(RAIZ / "infra"))        # entornos.py es Python puro, sin CDK
import pipeline.config  # noqa: E402,F401 — carga el .env (DB_CLUSTER_ARN/DB_SECRET_ARN)

from pipeline import invitaciones as inv  # noqa: E402
from tools import usuarios  # noqa: E402
from entornos import PROD  # noqa: E402

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# Las fechas de los encabezados de los reenvíos son de hora centro.
CENTRO = ZoneInfo("America/Mexico_City")
MESES = {"ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
         "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12}
RE_REENVIO = re.compile(r"^#\s*Reenv[ií]o\s+\d+.*?—\s*(\d{1,2})-([a-záéíóú]{3,})-(\d{4})",
                        re.IGNORECASE)
PALABRAS_DE_PLAN = {"anual", "mensual", "fai", "gratis", "tester"}


# ---------------------------------------------------------------------------
# los archivos de las tandas y los reenvíos (formatos reales de tools/)

def _numero(ruta: Path) -> int:
    m = re.search(r"(\d+)", ruta.name)
    return int(m.group(1)) if m else 0


def _nombre_de_comentario(comentario: str) -> str:
    """«2026-10-21 ($197/año)  Guillermo Lopez» → «Guillermo Lopez».

    Los comentarios de las tandas y los reenvíos separan sus campos con dos o más
    espacios: fecha y precio, nombre, «(tanda 9)». El nombre es el primer campo
    que no es fecha, plan ni paréntesis."""
    for parte in re.split(r"\s{2,}", comentario.strip()):
        parte = parte.strip()
        if (not parte or parte.startswith("(")
                or re.search(r"\d{4}-\d{2}-\d{2}|sin fecha", parte)
                or parte.lower() in PALABRAS_DE_PLAN):
            continue
        return parte
    return ""


def leer_tandas(carpeta: Path) -> list[tuple[str, str, str]]:
    """→ [(correo, nombre, archivo)] de tandaN.txt (el nombre, si la línea lo trae)."""
    out = []
    for ruta in sorted(carpeta.glob("tanda*.txt"), key=_numero):
        for linea in ruta.read_text(encoding="utf-8-sig").splitlines():
            if not linea.strip() or linea.lstrip().startswith("#"):
                continue
            datos, _, comentario = linea.partition("#")
            campos = datos.split()
            if campos:
                out.append((inv.normalizar_correo(campos[0]),
                            _nombre_de_comentario(comentario), ruta.name))
    return out


def leer_altas(carpeta: Path) -> dict[str, tuple[datetime, str]]:
    """correo → (primera alta que salió bien, archivo) de tandaN.txt.altas.tsv.
    Las filas 'fallo' y 'ya-existia' no cuentan: esa vez no salió invitación."""
    out: dict[str, tuple[datetime, str]] = {}
    for ruta in sorted(carpeta.glob("tanda*.txt.altas.tsv"), key=_numero):
        with ruta.open(encoding="utf-8-sig", newline="") as f:
            for fila in csv.DictReader(f, delimiter="\t"):
                if (fila.get("resultado") or "").strip() != "alta":
                    continue
                correo, cuando = inv.normalizar_correo(fila.get("correo")), inv.fecha(fila.get("cuando"))
                if correo and cuando and (correo not in out or cuando < out[correo][0]):
                    out[correo] = (cuando, ruta.name)
    return out


def leer_reenvios(carpeta: Path) -> list[tuple[str, date | None, list[str]]]:
    """→ [(archivo, fecha del encabezado, correos)] de reenvioN.txt."""
    out = []
    for ruta in sorted(carpeta.glob("reenvio*.txt"), key=_numero):
        dia, correos = None, []
        for linea in ruta.read_text(encoding="utf-8-sig").splitlines():
            m = RE_REENVIO.match(linea.strip())
            if m and dia is None:
                mes = MESES.get(m.group(2).lower()[:3])
                if mes:
                    dia = date(int(m.group(3)), mes, int(m.group(1)))
                continue
            datos = linea.split("#", 1)[0].split()
            if datos:
                correos.append(inv.normalizar_correo(datos[0]))
        out.append((ruta.name, dia, correos))
    return out


# ---------------------------------------------------------------------------
# cargar el export de Skool

def _hay_db() -> bool:
    return bool(os.getenv("DB_CLUSTER_ARN") and os.getenv("DB_SECRET_ARN"))


def cargar(pool: str, ruta: Path, carpeta: Path, *, ejecutar: bool = False) -> int:
    """Revisa el CSV y, solo con `ejecutar`, lo deja como export vigente. → filas."""
    from pipeline import db
    from worker.invitador import leer_pool

    exp = inv.leer_export(ruta)
    previos: list[dict] = []
    vigentes_previos: set[str] = set()
    if _hay_db():
        try:
            previos = db.invitaciones_miembros_todos()
            # el vigente lo dice la base (la última carga COMPLETA), no el max
            # de visto_en: una carga que tronó a la mitad no cuenta
            vigentes_previos = {f["correo"] for f in db.invitaciones_miembros_vigentes()}
        except Exception as e:                      # noqa: BLE001 — se dice y se decide abajo
            print(f"AVISO: no se pudo leer invitaciones_miembros ({usuarios._codigo(e)}). "
                  "¿Corriste tools/db_migrate.py en este entorno?")
            if ejecutar:
                sys.exit("No se carga nada sin la tabla.")
    elif ejecutar:
        sys.exit("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")
    cuentas = {u["correo"] for u in leer_pool(pool)}
    por_correo = {f["correo"]: f for f in previos}
    conflictos = {c: (n, primero, otro) for n, c, primero, otro in exp.conflictos}
    con_cuenta = [(f.get("nombre") or "", f["correo"], "export anterior")
                  for f in previos if f["correo"] in cuentas]
    con_cuenta += [(n, c, a) for c, n, a in leer_tandas(carpeta) if n]

    filas, rechazados, sospechosos = [], [], []
    for m in exp.miembros:
        correo, rechazo, sospecha = usuarios.revisar(m.correo)
        if rechazo:
            rechazados.append((m, rechazo))
            continue
        motivo = None
        if correo not in por_correo and correo not in cuentas:
            if m.correo in conflictos:
                # el orden de las filas no decide si la cortesía es de 100 o de 200
                n, primero, otro = conflictos[m.correo]
                motivo = (f"viene dos veces con distinto cobro: «{primero}» (fila {m.fila}, "
                          f"la que se guardó) y «{otro}» (fila {n})")
            elif sospecha:
                motivo = f"dominio {sospecha}"
            else:
                for nombre, otro, fuente in con_cuenta:
                    if otro != correo and inv.nombres_parecidos(m.nombre, nombre):
                        motivo = (f"se llama como «{nombre}» <{otro}> ({fuente}), "
                                  "que ya tiene cuenta")
                        break
        if motivo:
            sospechosos.append((m, motivo))
        filas.append({"correo": correo, "nombre": m.nombre, "plan": m.plan,
                      "categoria": m.categoria, "precio": m.precio,
                      "ingreso": m.ingreso.isoformat() if m.ingreso else None,
                      "estado": "revisar" if motivo else "ok"})

    def estado(f):   # el que valdrá: una carga no pisa el de una fila que ya existía
        return (por_correo.get(f["correo"]) or f)["estado"]

    en_este = {f["correo"] for f in filas}
    nuevos = [f for f in filas if f["correo"] not in vigentes_previos] if previos else []
    bajas = sorted(vigentes_previos - en_este)
    sin_plan = [f for f in filas if not f["plan"]]
    a_invitar = [f for f in filas
                 if f["correo"] not in cuentas and f["plan"] and estado(f) == "ok"]

    print(f"{ruta}: {exp.filas} filas → {len(filas)} miembros, {len(exp.sin_correo)} sin "
          f"correo, {len(exp.duplicados)} repetidos, {len(rechazados)} rechazados")
    cuenta = {}
    for f in filas:
        cuenta[f["categoria"] or "sin plan"] = cuenta.get(f["categoria"] or "sin plan", 0) + 1
    print("  por categoría: " + ", ".join(f"{n} {c}" for c, n in sorted(cuenta.items())))
    for n, nombre in exp.sin_correo:
        print(f"  SIN CORREO  fila {n}: {nombre or '(sin nombre)'}")
    for n, correo in exp.duplicados:
        print(f"  REPETIDO    fila {n}: {correo} (vale la primera vez que aparece)")
    for n, correo, primero, otro in exp.conflictos:
        print(f"  CONFLICTO   fila {n}: {correo} trae «{otro}» y la primera vez «{primero}»"
              + ("" if correo in por_correo or correo in cuentas
                 else ": entra en 'revisar'"))
    for m, motivo in rechazados:
        print(f"  RECHAZO     fila {m.fila}: {m.correo} ({motivo})")
    for f in sin_plan:
        print(f"  SIN PLAN    {f['correo']} (precio {f['precio']!r}): no se le invita")
    for m, motivo in sospechosos:
        print(f"  REVISAR     {m.correo} «{m.nombre}»: {motivo}")
    if previos:
        print(f"Contra el export anterior: {len(nuevos)} nuevos, {len(bajas)} bajas.")
        for c in bajas:
            print(f"  BAJA        {c}" + ("  (tiene cuenta: el bot ya no le escribe)"
                                        if c in cuentas else ""))
    else:
        print("Primer export cargado: no hay contra qué comparar nuevos y bajas.")
    print(f"Sin cuenta en el pool y listos para invitar: {len(a_invitar)}")
    for f in a_invitar:
        print(f"  INVITAR     {f['correo']}  {f['categoria']}  «{f['nombre']}»")
    if sospechosos:
        print("Los de REVISAR no se tocan hasta `aprobar` o `excluir` (después de cargar).")

    if not ejecutar:
        print(f"\nENSAYO — no se escribió nada. Para cargarlo de verdad:")
        # entre comillas: el navegador baja «community_members (11).csv»
        print(f'  venv\\Scripts\\python tools\\invitaciones.py cargar "{ruta}" --ejecutar')
        return 0
    visto_en = datetime.now(timezone.utc).isoformat(timespec="seconds")
    n = db.invitaciones_guardar_miembros(filas, visto_en)
    print(f"\nCargados {n} miembros como export vigente (visto_en {visto_en}).")
    return n


# ---------------------------------------------------------------------------
# historial: lo que pasó antes del bot

def historial(pool: str, carpeta: Path, *, ejecutar: bool = False) -> int:
    """Backfill idempotente. → filas escritas (0 en el ensayo)."""
    from pipeline import db
    from worker.invitador import leer_pool

    cuentas = {u["correo"]: u for u in leer_pool(pool)}
    altas = leer_altas(carpeta)
    filas: list[tuple[str, int, datetime, str]] = []      # (correo, paso, cuándo, detalle)
    de_tanda = de_cognito = 0
    for correo, u in sorted(cuentas.items()):
        if correo in altas:
            cuando, archivo = altas[correo]
            de_tanda += 1
        elif u.get("creado"):
            cuando, archivo = u["creado"], "UserCreateDate"
            de_cognito += 1
        else:
            continue
        filas.append((correo, 0, cuando, archivo))

    confirmados = sin_confirmar = 0
    sin_cuenta: list[tuple[str, str]] = []
    no_salio: list[tuple[str, str, datetime]] = []
    for archivo, dia, correos in leer_reenvios(carpeta):
        if dia is None:
            print(f"AVISO {archivo}: no trae la fecha en el encabezado "
                  "(«# Reenvío N — 22-oct-2026 · ...»): se salta entero.")
            continue
        for correo in correos:
            u = cuentas.get(correo)
            if u is None:
                sin_cuenta.append((archivo, correo))
                continue
            modificado = u.get("modificado")
            dia_mod = modificado.astimezone(CENTRO).date() if modificado else None
            if dia_mod is not None and dia_mod < dia:
                # un RESEND toca la cuenta: si Cognito no la tocó desde ese día, el
                # reenvío no salió (archivo preparado y no corrido, o un RESEND que
                # Cognito rechazó por el tope). Anotarlo le quitaría su R1.
                no_salio.append((archivo, correo, modificado))
                continue
            if dia_mod == dia:
                cuando = modificado                  # la hora real del reenvío
                confirmados += 1
            else:
                # la cuenta se tocó después (o no se sabe): mediodía de ese día
                cuando = datetime.combine(dia, time(12, 0), tzinfo=CENTRO)
                sin_confirmar += 1
            filas.append((correo, 1, cuando.astimezone(timezone.utc), archivo))

    print(f"Invitaciones (paso 0): {de_tanda + de_cognito} cuentas — {de_tanda} con la hora "
          f"de su tanda, {de_cognito} con la de Cognito (no están en ninguna .altas.tsv).")
    print(f"Reenvíos (cuentan como R1): {confirmados + sin_confirmar} — {confirmados} "
          f"confirmados por la última modificación en Cognito, {sin_confirmar} sin "
          "confirmar (la cuenta se tocó después: se anotan a mediodía de ese día).")
    for archivo, correo in sin_cuenta:
        print(f"  SIN CUENTA  {archivo}: {correo} (no está en el pool: no se anota)")
    if no_salio:
        print(f"NO CONFIRMADOS ({len(no_salio)}): Cognito no tocó la cuenta desde antes del "
              "día del encabezado, así que ese reenvío no salió. No se anotan: el bot les "
              "mandará su R1 como si nunca lo hubiera recibido.")
        for archivo, correo, modificado in no_salio:
            print(f"  NO SALIÓ    {archivo}: {correo} (última modificación "
                  f"{modificado.astimezone(CENTRO):%Y-%m-%d %H:%M} hora centro)")
    if not ejecutar:
        print(f"\nENSAYO — no se escribió nada ({len(filas)} filas por anotar). Para hacerlo:")
        print(f'  venv\\Scripts\\python tools\\invitaciones.py historial --dir "{carpeta}" --ejecutar')
        return 0
    escritas = sum(db.invitaciones_anotar_historial(c, p, t.isoformat(), d)
                   for c, p, t, d in filas)
    print(f"\n{escritas} filas nuevas; {len(filas) - escritas} ya estaban de una corrida anterior.")
    return escritas


# ---------------------------------------------------------------------------
# hoy / estado / modo

def aviso_del_modo(fila: dict) -> str | None:
    """El interruptor vale la última fila y el tope que no se pasa se hereda: un
    tope 0 no se acaba solo a la mañana siguiente, y nada más lo diría. Lo mismo la
    frecuencia de más de una semana: los fríos dejan de salir cada semana, y toda
    clave provisional se vence antes del siguiente correo."""
    avisos = []
    if int(fila["tope"]) == 0:
        avisos.append(
            f"OJO: tope 0 hasta que lo cambies, también mañana. El bot no manda nada y la "
            f"página /acceso contesta a todos que ya no hay correos hoy. Para volver: "
            f'tools/invitaciones.py modo {fila["modo"]} --tope {inv.TOPE_DEFECTO} --nota "..."')
    cada = inv.cada_dias_de(fila)
    if cada > 7:
        avisos.append(f"OJO: cada {cada} días, los fríos del resumen salen en cada corrida: "
                      "menos de una vez por semana. Y la clave provisional dura 7 días: toda "
                      "se vence antes del siguiente correo (la salida es la página /acceso).")
    return " ".join(avisos) or None


def cambio_de_modo(previo: dict | None, fila: dict) -> str | None:
    """No hay forma de cambiar la frecuencia o el tope sin repetir el modo: copiar
    `modo activo --cada 3` con el bot en ensayo también lo enciende."""
    antes = (previo or {}).get("modo") or "apagado"
    if antes == fila["modo"]:
        return None
    if fila["modo"] == "activo":
        return (f"OJO: el modo cambió de {antes} a activo: en la siguiente corrida salen "
                "correos reales.")
    return f"El modo cambió de {antes} a {fila['modo']}."


def _linea_de_hoy(foto) -> str:
    """La frecuencia y si corre la siguiente salida del reloj: `hoy` y `estado` dicen
    lo mismo. Va sobre la salida y no sobre «hoy»: a las 18:00 la de hoy ya pasó, y a
    la 01:00 de un día que toca, el día de Cognito todavía es el anterior."""
    nombre = inv.nombre_frecuencia(foto.cada_dias)
    if foto.modo == "apagado":
        return f"Frecuencia guardada: {nombre}. Apagado: no corre hasta que muevas el modo."
    if foto.tope == 0:
        return f"Frecuencia: {nombre}. Tope 0: no sale ningún correo hasta que fijes otro tope."
    salida = inv.siguiente_salida(foto.ahora).astimezone(CENTRO)
    ya_paso = "El reloj de hoy ya pasó. " if salida.date() > foto.ahora.astimezone(CENTRO).date() else ""
    texto = (f"Frecuencia: {nombre}. {ya_paso}La siguiente salida del reloj "
             f"({salida:%Y-%m-%d %H:%M} hora centro)")
    if foto.toca:
        return f"{texto} SÍ corre."
    ultima = inv.ultima_corrida(foto.envios)
    proxima = inv.proxima_corrida(foto.cada_dias, foto.envios, foto.ahora).astimezone(CENTRO)
    return (f"{texto} NO corre (la última con envíos fue el {ultima:%Y-%m-%d}): el bot sale "
            f"callado. Próxima estimada: {proxima:%Y-%m-%d %H:%M} hora centro.")


def _corre_este_dia(foto) -> bool:
    """¿Lo que cabe en el cupo de este día de Cognito va a salir de verdad?"""
    return (foto.modo != "apagado" and foto.toca
            and inv.corte_del_dia(inv.siguiente_salida(foto.ahora)) == inv.corte_del_dia(foto.ahora))


def hoy(pool: str, hermano: str | None) -> None:
    from worker.invitador import tomar_foto
    foto = tomar_foto(pool, hermano)
    print(f"Modo {foto.modo} · tope {foto.tope} · ya salieron hoy {foto.gastado} · "
          f"cupo libre del bot {foto.cupo} (deja {inv.RESERVA_PAGINA} para la página /acceso; "
          f"el día de Cognito empezó {inv.corte_del_dia(foto.ahora):%Y-%m-%d %H:%M} UTC)")
    if foto.aviso_hermano:
        print(f"OJO: {foto.aviso_hermano}")
    if foto.modo == "apagado":
        print("El bot está APAGADO: esto es lo que haría si estuviera en ensayo o activo.")
    print(_linea_de_hoy(foto))
    if foto.modo != "apagado" and foto.elegidos and not _corre_este_dia(foto):
        print("Esto es lo que mandaría si corriera ahora:")
    for i, e in enumerate(foto.elegidos, 1):
        print(f"{i:>3}. {inv.NOMBRE_PASO[e.paso]:<10} {e.correo:<40} {e.nombre}  — {e.motivo}")
    resto = foto.todos[len(foto.elegidos):]
    if resto:
        print(f"Y {len(resto)} más esperan cupo para otro día." + inv.frase_de_atraso(resto))
    if not foto.todos:
        print("Hoy no le toca a nadie.")
    print("(Solo lectura: no se mandó ni se anotó nada.)")


def estado(pool: str, hermano: str | None) -> None:
    from worker.invitador import paginas_de_hoy, tomar_foto
    foto = tomar_foto(pool, hermano)
    from pipeline import db
    fila = db.invitaciones_interruptor()
    if fila:
        print(f"Interruptor: {fila['modo']} · tope {fila['tope']} · "
              f"{inv.nombre_frecuencia(inv.cada_dias_de(fila))} · desde {fila['creado']} UTC"
              + (f" · «{fila['nota']}»" if fila.get("nota") else ""))
    else:
        print("Interruptor: nunca se puso (APAGADO).")
    print(_linea_de_hoy(foto))
    print(f"Hoy: ya salieron {foto.gastado} de {foto.tope}; cupo libre del bot {foto.cupo} "
          f"(deja {inv.RESERVA_PAGINA} para la página /acceso); "
          + (f"tocan {len(foto.todos)} ({len(foto.elegidos)} caben hoy)."
             if _corre_este_dia(foto)
             else f"tocarían {len(foto.todos)} ({len(foto.elegidos)} cabrían)."))
    pagina = paginas_de_hoy(foto.envios, foto.ahora)
    if pagina:
        print(f"Página /acceso: {pagina} correos pedidos hoy por la propia gente.")
    if foto.aviso_hermano:
        print(f"OJO: {foto.aviso_hermano}")
    entraron = sum(1 for u in foto.usuarios if u["estado"] == "CONFIRMED")
    nunca = [u for u in foto.usuarios if u["estado"] == "FORCE_CHANGE_PASSWORD"]
    print(f"Cuentas en el pool: {len(foto.usuarios)} — {entraron} entraron, {len(nunca)} nunca.")
    pasos = inv.pasos_por_correo(foto.envios)
    por_paso: dict[int, int] = {}
    for u in nunca:
        p = pasos.get(u["correo"], (0, None))[0]
        por_paso[p] = por_paso.get(p, 0) + 1
    print("  Los que nunca entraron, por el último correo que recibieron: "
          + ", ".join(f"{inv.NOMBRE_PASO[p]} {n}" for p, n in sorted(por_paso.items())))
    print(f"Export vigente: {len(foto.miembros)} miembros.")
    revisar = [m for m in foto.miembros if m.estado == "revisar"]
    if revisar:
        print(f"Esperan aprobar/excluir ({len(revisar)}): " + ", ".join(m.correo for m in revisar))
    frios = inv.frios(foto.usuarios, foto.envios, foto.ahora)
    print(f"Fríos (R3 hace {inv.DIAS_FRIO}+ días y siguen sin entrar): {len(frios)}")
    for c, f in frios:
        print(f"  {c}" + (f"  (último correo el {f:%Y-%m-%d})" if f else ""))
    bajas = inv.bajas(foto.miembros, foto.usuarios)
    print(f"Bajas (nunca entraron y ya no están en el export): {len(bajas)}")
    for c in bajas:
        print(f"  {c}")
    for a in inv.atorados(foto.envios, foto.ahora):
        print(f"ATORADO en 'enviando': {a['correo']} paso {a['paso']} desde {a['creado']} UTC")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["cargar", "aprobar", "excluir", "historial",
                                       "modo", "hoy", "estado"])
    ap.add_argument("objetivo", nargs="?",
                    help="cargar: el CSV · aprobar/excluir: el correo · modo: apagado|ensayo|activo")
    ap.add_argument("--ejecutar", action="store_true",
                    help="cargar e historial: sin esto solo se REVISA y no se escribe nada")
    ap.add_argument("--dir", type=Path, default=Path(__file__).resolve().parent,
                    help="dónde están tandaN.txt(.altas.tsv) y reenvioN.txt (default: tools/)")
    ap.add_argument("--tope", type=int, help="modo: correos al día (0..50; default el vigente o 40)")
    ap.add_argument("--cada", type=int,
                    help=f"modo: cada cuántos días corre el bot (1..{inv.CADA_DIAS_MAXIMO}; "
                         "default el vigente o 1)")
    ap.add_argument("--nota", help="modo: por qué (queda en la fila del interruptor)")
    ap.add_argument("--pool", default=usuarios.POOL_DEFAULT)
    ap.add_argument("--pool-hermano", default=None,
                    help="pool que comparte el tope de correo de la cuenta (default: el de "
                         "dev cuando --pool es prod; '' para no contarlo)")
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    args = ap.parse_args()

    if args.accion in ("cargar", "aprobar", "excluir", "modo") and not args.objetivo:
        ap.error(f"{args.accion} necesita su argumento (ver --help)")
    if args.accion == "cargar" and not Path(args.objetivo).is_file():
        ap.error(f"no existe el archivo {args.objetivo}")
    if args.accion == "modo":
        if args.objetivo not in inv.MODOS:
            ap.error(f"modo: uno de {', '.join(inv.MODOS)}")
        if not args.nota:
            ap.error("modo necesita --nota: queda escrito quién lo movió y por qué")
        if args.tope is not None and not 0 <= args.tope <= inv.TOPE_MAXIMO:
            ap.error(f"--tope entre 0 y {inv.TOPE_MAXIMO}: Cognito manda 50 al día por "
                     "cuenta, y pasado eso crea usuarios que no reciben su clave")
        if args.cada is not None and not 1 <= args.cada <= inv.CADA_DIAS_MAXIMO:
            ap.error(f"--cada entre 1 y {inv.CADA_DIAS_MAXIMO}: 1 es a diario")
    if args.accion == "historial" and not args.dir.is_dir():
        ap.error(f"no existe la carpeta {args.dir}")
    # El ensayo de `cargar` se puede correr sin base (solo no compara contra el
    # export anterior); lo demás la necesita.
    if not (args.accion == "cargar" and not args.ejecutar):
        if not args.cluster_arn or not args.secret_arn:
            ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")
    if args.cluster_arn and args.secret_arn:
        os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
        os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", args.pool.split("_")[0])
    hermano = args.pool_hermano
    if hermano is None:
        # el de dev cuenta para el tope de prod (misma cuenta de AWS); al revés no
        hermano = PROD.pool_cuota_compartida if args.pool != PROD.pool_cuota_compartida else None
    hermano = hermano or None

    from pipeline import db
    if args.accion == "cargar":
        cargar(args.pool, Path(args.objetivo), args.dir, ejecutar=args.ejecutar)
    elif args.accion in ("aprobar", "excluir"):
        nuevo = "ok" if args.accion == "aprobar" else "excluido"
        if db.invitaciones_fijar_estado(args.objetivo, nuevo):
            print(f"{args.objetivo}: {nuevo}")
        else:
            print(f"{args.objetivo}: no está en ningún export cargado")
    elif args.accion == "historial":
        historial(args.pool, args.dir, ejecutar=args.ejecutar)
    elif args.accion == "modo":
        previo = db.invitaciones_interruptor()
        fila = db.invitaciones_ajustar(args.objetivo, tope=args.tope, cada_dias=args.cada,
                                       nota=args.nota)
        print(f"Interruptor: {fila['modo']} · tope {fila['tope']} · "
              f"{inv.nombre_frecuencia(inv.cada_dias_de(fila))} · «{fila.get('nota') or ''}»")
        for aviso in (cambio_de_modo(previo, fila), aviso_del_modo(fila)):
            if aviso:
                print(aviso)
    elif args.accion == "hoy":
        hoy(args.pool, hermano)
    else:
        estado(args.pool, hermano)


if __name__ == "__main__":
    main()
