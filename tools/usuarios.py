"""M2 — altas y bajas de usuarios (espejo de tools/creditos.py, corre el dueño).

    python tools/usuarios.py alta correo@x.com --plan mensual  # invita + 100 cr
    python tools/usuarios.py alta correo@x.com --plan anual    # invita + 200 cr
    python tools/usuarios.py alta correo@x.com --reenviar      # reenvía la provisional (sin re-abonar)
    python tools/usuarios.py alta --desde tanda1.txt           # REVISA la lista, no da de alta a nadie
    python tools/usuarios.py alta --desde tanda1.txt --ejecutar # ahora sí
    python tools/usuarios.py suspender correo@x.com            # churn: no entra más (sus datos quedan)
    python tools/usuarios.py reactivar correo@x.com
    python tools/usuarios.py adoptar correo@x.com --de piloto  # migra proyectos+saldo del id viejo
    python tools/usuarios.py slots correo@x.com 10             # tope de proyectos activos (o `ilimitado`)
    python tools/usuarios.py lista

`alta` crea el usuario en Cognito (correo = username; Cognito envía la
contraseña provisional por email y fuerza el cambio al primer login), registra
la fila en `usuarios` (id = sub) y abona la cortesía del plan en el mismo
comando. La cortesía sale de tools/tarifas.json. `suspender` deshabilita al
usuario Y revoca sus sesiones (global sign-out) — el VPS de la comunidad
llamará esto mismo cuando detecte churn.

`alta --desde <archivo>` es el camino para las tandas de apertura: revisa la
lista entera ANTES de tocar Cognito y, sin `--ejecutar`, no da de alta a nadie.
Ver el bloque «altas en tanda» más abajo para por qué el ensayo es el default.

Necesita credenciales AWS: cognito-idp + Data API (DB_CLUSTER_ARN /
DB_SECRET_ARN o --cluster-arn/--secret-arn, outputs del stack aws-media-db).
Pool por COGNITO_POOL_ID o --pool.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import pipeline.config  # noqa: E402,F401 — carga el .env (DB_CLUSTER_ARN/DB_SECRET_ARN)

# La consola de Windows es cp1252 y no sabe encodear «→»: sin esto, `slots` y
# el informe de las tandas mueren con UnicodeEncodeError en vez de imprimir.
# Mismo idiom que tools/setup.py y tools/mix_sfx.py.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

POOL_DEFAULT = os.getenv("COGNITO_POOL_ID", "us-east-1_WyPvxnj1V")


def cortesia(plan: str) -> int:
    tarifas = json.loads((Path(__file__).parent / "tarifas.json").read_text(encoding="utf-8"))
    return int(tarifas["cortesia_mensual"][plan])


def _cognito(pool: str = POOL_DEFAULT):
    import boto3
    return boto3.client("cognito-idp", region_name=pool.split("_")[0])


def _sub(respuesta_usuario: dict) -> str:
    for a in respuesta_usuario.get("Attributes", respuesta_usuario.get("UserAttributes", [])):
        if a["Name"] == "sub":
            return a["Value"]
    raise RuntimeError("Cognito no devolvió el sub del usuario")


def alta(pool: str, correo: str, plan: str, reenviar: bool = False) -> str:
    from pipeline import db
    c = _cognito(pool)
    kwargs = dict(UserPoolId=pool, Username=correo,
                  UserAttributes=[{"Name": "email", "Value": correo},
                                  {"Name": "email_verified", "Value": "true"}],
                  DesiredDeliveryMediums=["EMAIL"])
    if reenviar:
        # reenvía la contraseña provisional a un invitado que la dejó vencer;
        # NO vuelve a abonar cortesía
        c.admin_create_user(MessageAction="RESEND", **kwargs)
        print(f"{correo}: contraseña provisional reenviada")
        return _sub(c.admin_get_user(UserPoolId=pool, Username=correo))
    r = c.admin_create_user(**kwargs)
    sub = _sub(r["User"])
    db.ejecutar("""INSERT INTO usuarios (id, email) VALUES (:i, :e)
                   ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email""",
                {"i": sub, "e": correo})
    saldo = db.abonar_creditos(sub, cortesia(plan), "cortesia", f"alta-{plan}")
    # M12: el plan anual incluye slots ilimitados (6 activos es el default de
    # la columna para el mensual; el archivo congelado no cuenta nunca)
    if plan == "anual":
        db.fijar_slots(sub, None)
    tope = "ilimitados" if plan == "anual" else "6"
    print(f"{correo}: alta OK (id {sub}) — {cortesia(plan)} créditos de cortesía, "
          f"saldo {saldo}, slots de proyectos: {tope}")
    print("Cognito le envió la contraseña provisional por email; el primer login fuerza el cambio.")
    return sub


# ---------------------------------------------------------------------------
# altas en tanda: revisar la lista antes de que la lista toque Cognito
#
# Tres cosas hacen esto distinto de correr `alta` cincuenta veces:
#
# 1. Un rebote duro no es «un correo que no llegó»: cuenta contra la reputación
#    del remitente. Con 182 direcciones, 10 malas son un 5.5% — por encima del
#    umbral que pone una cuenta bajo revisión. Cuando eso pasa dejan de llegar
#    TODAS, también las buenas, y ya no hay forma de arreglar la apertura.
# 2. El pool manda los correos con COGNITO_DEFAULT, con un tope de 50 al día.
#    Pasado el tope, el usuario se crea IGUAL y no recibe nada: queda con fila
#    en `usuarios` y créditos abonados, esperando una clave que nunca llegó. Por
#    eso el tope es un freno del comando y no una nota en un documento, y por
#    eso un rechazo de Cognito por límite ABORTA la corrida en el sitio en vez
#    de seguir creando fantasmas.
# 3. Una corrida de 50 se muere a la mitad. Sin bitácora no se sabe por quién
#    ibas, y `alta` repetida sobre alguien que ya existe re-abonaría cortesía
#    (el índice único del monedero solo cubre `tipo='compra'`).

# Los dominios que de verdad aparecen en una lista LATAM. NO es una allowlist:
# un dominio que no esté aquí pasa igual. Están para medir distancia contra
# ellos y cazar el dedazo — y los parecidos legítimos (mail.com a un paso de
# gmail.com) viven aquí precisamente para que no se marquen como sospechosos.
DOMINIOS_COMUNES = (
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com",
    "live.com", "mail.com", "me.com", "aol.com", "msn.com", "proton.me",
    "protonmail.com", "gmx.com", "zoho.com", "yandex.com", "tutanota.com",
    "hotmail.es", "hotmail.com.mx", "outlook.es", "outlook.com.mx",
    "yahoo.com.mx", "yahoo.es", "live.com.mx", "prodigy.net.mx",
)

# Se aplica sobre el correo YA normalizado (minúsculas, sin espacios), así que
# no necesita ser insensible a mayúsculas. Deliberadamente permisiva en la
# parte local: el objetivo es cazar basura evidente, no reimplementar el RFC.
RE_CORREO = re.compile(r"^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$")


def _distancia(a: str, b: str) -> int:
    """Damerau-Levenshtein (alineamiento óptimo).

    Cuenta la TRANSPOSICIÓN como un solo paso, y eso es justo lo que hace falta:
    en Levenshtein puro «gmial.com» queda a distancia 2 de «gmail.com» —el
    dedazo más común de todos— y se colaría por el filtro.
    """
    if a == b:
        return 0
    m = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(len(a) + 1):
        m[i][0] = i
    for j in range(len(b) + 1):
        m[0][j] = j
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            coste = 0 if a[i - 1] == b[j - 1] else 1
            m[i][j] = min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + coste)
            if i > 1 and j > 1 and a[i - 1] == b[j - 2] and a[i - 2] == b[j - 1]:
                m[i][j] = min(m[i][j], m[i - 2][j - 2] + 1)
    return m[len(a)][len(b)]


def revisar(entrada: str) -> tuple[str, str | None, str | None]:
    """→ (correo normalizado, rechazo, sospecha). Los tres pueden ser None-ish.

    `rechazo` bloquea: la dirección no tiene forma de correo y el alta fallaría
    o reboteraría seguro. `sospecha` NO bloquea por sí sola pero excluye de la
    corrida salvo que se pida lo contrario: el dominio se parece demasiado a uno
    conocido, y un rebote duro cuesta más que preguntarle a la persona.
    """
    correo = entrada.strip().strip("<>").lower()
    if not correo:
        return correo, "línea vacía", None
    if not RE_CORREO.match(correo):
        return correo, "no tiene forma de correo", None
    dominio = correo.rsplit("@", 1)[1]
    if dominio in DOMINIOS_COMUNES:
        return correo, None, None
    for conocido in DOMINIOS_COMUNES:
        if _distancia(dominio, conocido) <= 1:
            return correo, None, f"¿«{conocido}» y no «{dominio}»?"
    return correo, None, None


def leer_lista(ruta: Path, plan_default: str) -> list[tuple[int, str, str]]:
    """→ [(nº de línea, texto crudo, plan)]. Todavía sin validar.

    Una línea, una dirección. `#` comenta y las vacías se ignoran, así que la
    lista se puede anotar con el nombre de la tanda. Un segundo campo (coma,
    punto y coma o espacios) fija el plan de ESA persona: en una tanda conviven
    mensuales y anuales, y partir el archivo en dos es exactamente el tipo de
    paso manual que se olvida a las once de la noche.
    """
    filas = []
    for n, linea in enumerate(ruta.read_text(encoding="utf-8").splitlines(), 1):
        linea = linea.split("#", 1)[0].strip()
        if not linea:
            continue
        campos = [c for c in re.split(r"[,;\s]+", linea) if c]
        plan = campos[1] if len(campos) > 1 else plan_default
        filas.append((n, campos[0], plan))
    return filas


def _codigo(e: Exception) -> str:
    """El código de error de botocore, o el nombre de la clase si no lo trae."""
    return (getattr(e, "response", None) or {}).get("Error", {}).get(
        "Code", type(e).__name__)


# Cognito devuelve estos cuando el pool ya no puede mandar más correo hoy. Son
# los ÚNICOS que abortan la corrida entera: seguir adelante crearía usuarios
# que no van a recibir su clave, que es el fallo silencioso que se quiere evitar.
CODIGOS_DE_TOPE = ("LimitExceededException", "TooManyRequestsException")


def alta_lote(pool: str, ruta: Path, plan_default: str, *, ejecutar: bool = False,
              tope: int = 50, pausa: float = 1.0, con_sospechosos: bool = False,
              registro: Path | None = None) -> int:
    """Revisa una lista y, solo con `ejecutar=True`, da de alta. → nº de altas."""
    filas = leer_lista(ruta, plan_default)
    planes_validos = ("mensual", "anual")

    listos: list[tuple[str, str]] = []      # (correo, plan)
    rechazos: list[tuple[int, str, str]] = []
    sospechosos: list[tuple[int, str, str, str]] = []
    vistos: dict[str, int] = {}

    for n, crudo, plan in filas:
        correo, rechazo, sospecha = revisar(crudo)
        if plan not in planes_validos:
            rechazo = rechazo or f"plan desconocido: {plan!r}"
        if rechazo:
            rechazos.append((n, crudo, rechazo))
        elif correo in vistos:
            rechazos.append((n, correo, f"repetida (ya venía en la línea {vistos[correo]})"))
        elif sospecha:
            vistos[correo] = n
            sospechosos.append((n, correo, plan, sospecha))
        else:
            vistos[correo] = n
            listos.append((correo, plan))

    if con_sospechosos:
        listos += [(c, p) for _, c, p, _ in sospechosos]

    print(f"{ruta}: {len(filas)} líneas → {len(listos)} para dar de alta, "
          f"{len(rechazos)} rechazadas, {len(sospechosos)} sospechosas")
    for n, texto, motivo in rechazos:
        print(f"  RECHAZO  línea {n}: {texto}  ({motivo})")
    for n, correo, _plan, sospecha in sospechosos:
        marca = "INCLUIDA" if con_sospechosos else "FUERA"
        print(f"  SOSPECHA línea {n}: {correo}  {sospecha}  [{marca}]")
    if sospechosos and not con_sospechosos:
        print("  Las sospechosas NO se dan de alta: corrige el archivo, o pasa "
              "--con-sospechosos si de verdad son correctas.")

    if not listos:
        print("Nada que hacer.")
        return 0

    if len(listos) > tope:
        print(f"\nABORTA: {len(listos)} altas contra un tope de {tope}.")
        print(f"El pool manda con COGNITO_DEFAULT y su límite es ~50 correos al "
              f"día; pasado el tope el usuario SE CREA pero no recibe la clave. "
              f"Parte el archivo en tandas de {tope} o sube --tope a sabiendas.")
        return 0

    if not ejecutar:
        print(f"\nENSAYO — no se tocó Cognito ni la base. Para hacerlo de verdad:")
        print(f"  python tools/usuarios.py alta --desde {ruta} --ejecutar")
        cuenta = {}
        for _, p in listos:
            cuenta[p] = cuenta.get(p, 0) + 1
        detalle = ", ".join(f"{n} {p} ({cortesia(p) * n} cr)" for p, n in sorted(cuenta.items()))
        print(f"Daría de alta {len(listos)}: {detalle}")
        return 0

    if registro is None:
        registro = ruta.with_suffix(ruta.suffix + ".altas.tsv")
    nuevo = not registro.exists()
    hechas = fallidos = existian = 0
    seguidos = 0
    with registro.open("a", encoding="utf-8") as bitacora:
        if nuevo:
            bitacora.write("cuando\tcorreo\tplan\tresultado\tdetalle\n")
        for i, (correo, plan) in enumerate(listos, 1):
            cuando = datetime.now(timezone.utc).isoformat(timespec="seconds")
            try:
                sub = alta(pool, correo, plan)
                hechas, seguidos = hechas + 1, 0
                bitacora.write(f"{cuando}\t{correo}\t{plan}\talta\t{sub}\n")
            except Exception as e:                      # noqa: BLE001 — ver abajo
                codigo = _codigo(e)
                # Una corrida de 50 no se puede morir por una dirección: se
                # anota y se sigue. Salvo los dos casos de abajo.
                if codigo == "UsernameExistsException":
                    existian, seguidos = existian + 1, 0
                    print(f"{correo}: ya existía — NO se re-abona cortesía. "
                          f"Si dejó vencer la clave: alta {correo} --reenviar")
                    bitacora.write(f"{cuando}\t{correo}\t{plan}\tya-existia\t\n")
                else:
                    fallidos, seguidos = fallidos + 1, seguidos + 1
                    print(f"{correo}: FALLÓ ({codigo}) {e}")
                    bitacora.write(f"{cuando}\t{correo}\t{plan}\tfallo\t{codigo}\n")
                    if codigo in CODIGOS_DE_TOPE:
                        bitacora.flush()
                        print(f"\nABORTA en la {i} de {len(listos)}: Cognito ya no "
                              f"manda más correo ({codigo}). Seguir crearía "
                              f"usuarios sin clave. Reanuda mañana desde "
                              f"{correo} — quien falta está en {registro}.")
                        break
                    if seguidos >= 3:
                        bitacora.flush()
                        print(f"\nABORTA en la {i} de {len(listos)}: 3 fallos "
                              f"seguidos, esto no son direcciones malas. "
                              f"Revisa credenciales y pool antes de reanudar.")
                        break
            if i < len(listos):
                time.sleep(pausa)

    print(f"\n{hechas} altas, {existian} ya existían, {fallidos} fallaron. "
          f"Bitácora: {registro}")
    if hechas:
        print("Cognito le mandó la clave provisional a cada uno; vence a los 7 "
              "días (UnusedAccountValidityDays) y el reenvío come del tope de "
              "ESE día.")
    return hechas


def suspender(pool: str, correo: str) -> None:
    c = _cognito(pool)
    c.admin_disable_user(UserPoolId=pool, Username=correo)
    c.admin_user_global_sign_out(UserPoolId=pool, Username=correo)
    print(f"{correo}: suspendido y sesiones revocadas (sus proyectos y saldo quedan intactos)")


def reactivar(pool: str, correo: str) -> None:
    _cognito(pool).admin_enable_user(UserPoolId=pool, Username=correo)
    print(f"{correo}: reactivado")


def adoptar(pool: str, correo: str, de: str) -> None:
    """Migra TODO lo del id viejo (p. ej. el 'piloto' de antes del login) al
    usuario real: proyectos, versiones, costes, movimientos y saldo."""
    from pipeline import db
    sub = _sub(_cognito(pool).admin_get_user(UserPoolId=pool, Username=correo))
    db.ejecutar("INSERT INTO usuarios (id, email) VALUES (:i, :e) ON CONFLICT (id) DO NOTHING",
                {"i": sub, "e": correo})
    # nombres_editor va con proyectos_editor: sin ella, el usuario real
    # recibiría 409 al subir a los proyectos que acaba de adoptar
    for tabla in ("proyectos_gen", "proyectos_editor", "nombres_editor",
                  "clip_versiones", "costes", "monedero_movimientos"):
        db.ejecutar(f"UPDATE {tabla} SET user_id = :n WHERE user_id = :v",  # noqa: S608 — tablas fijas
                    {"n": sub, "v": de})
    saldo_viejo = db.saldo_creditos(de)
    if saldo_viejo:
        db.abonar_creditos(sub, saldo_viejo, "ajuste", f"adopcion:{de}")
        db.abonar_creditos(de, -saldo_viejo, "ajuste", f"adopcion:{sub}")
    print(f"{correo}: adoptó lo de '{de}' (+{saldo_viejo} créditos, saldo {db.saldo_creditos(sub)})")


def admin(pool: str, correo: str) -> None:
    """M6: mete al usuario al grupo `admin` de Cognito — con eso su id_token
    trae cognito:groups=[admin] y puede abrir /admin.html. OJO: el token
    vigente no cambia; tiene que cerrar sesión y volver a entrar."""
    _cognito(pool).admin_add_user_to_group(
        UserPoolId=pool, Username=correo, GroupName="admin")
    print(f"{correo}: agregado al grupo admin — que cierre sesión y vuelva a "
          "entrar para que su token traiga el grupo")


def slots(pool: str, correo: str, valor: str) -> None:
    """M12: cambia el tope de proyectos activos (`ilimitado` o un número)."""
    from pipeline import db
    sub = _sub(_cognito(pool).admin_get_user(UserPoolId=pool, Username=correo))
    n = None if valor == "ilimitado" else int(valor)
    db.fijar_slots(sub, n)
    print(f"{correo}: slots de proyectos → {valor}")


def lista(pool: str) -> None:
    con_db = bool(os.getenv("DB_CLUSTER_ARN") and os.getenv("DB_SECRET_ARN"))
    if con_db:
        from pipeline import db
    pag = _cognito(pool).get_paginator("list_users")
    for pagina in pag.paginate(UserPoolId=pool):
        for u in pagina["Users"]:
            correo = next((a["Value"] for a in u["Attributes"] if a["Name"] == "email"), "?")
            estado = "activo" if u["Enabled"] else "SUSPENDIDO"
            extra = f"  saldo {db.saldo_creditos(_sub(u))}" if con_db else ""
            # el sub es el user_id de la base — es lo que piden creditos.py
            # --user y el drill-down del admin
            print(f"  {correo:35s} {estado:10s} {u['UserStatus']:20s}{extra}  id {_sub(u)}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("accion", choices=["alta", "suspender", "reactivar", "adoptar", "admin", "slots", "lista"])
    ap.add_argument("correo", nargs="?")
    ap.add_argument("valor", nargs="?", help="para slots: un número o `ilimitado`")
    ap.add_argument("--plan", default="mensual", choices=["mensual", "anual"])
    ap.add_argument("--reenviar", action="store_true")
    ap.add_argument("--de", default="piloto", help="id viejo que adopta el usuario")
    ap.add_argument("--pool", default=POOL_DEFAULT)
    ap.add_argument("--cluster-arn", default=os.getenv("DB_CLUSTER_ARN"))
    ap.add_argument("--secret-arn", default=os.getenv("DB_SECRET_ARN"))
    g = ap.add_argument_group("altas en tanda (alta --desde)")
    g.add_argument("--desde", type=Path, metavar="ARCHIVO",
                   help="lista de correos, uno por línea (`#` comenta; segundo "
                        "campo = plan de esa persona)")
    g.add_argument("--ejecutar", action="store_true",
                   help="sin esto la tanda solo se REVISA y no se crea a nadie")
    g.add_argument("--tope", type=int, default=50,
                   help="máximo de altas por corrida (default 50: el límite "
                        "diario de correo del pool con COGNITO_DEFAULT)")
    g.add_argument("--pausa", type=float, default=1.0,
                   help="segundos entre altas (default 1.0)")
    g.add_argument("--con-sospechosos", action="store_true",
                   help="incluye las direcciones cuyo dominio parece un dedazo")
    g.add_argument("--registro", type=Path,
                   help="bitácora TSV (default: <archivo>.altas.tsv)")
    args = ap.parse_args()
    if args.desde:
        if args.accion != "alta":
            ap.error("--desde solo aplica a `alta`")
        if args.correo:
            ap.error("--desde y un correo suelto son excluyentes: elige uno")
        if args.reenviar:
            ap.error("--desde no reenvía; cada reenvío come del tope de correo "
                     "del día, así que van de uno en uno y a sabiendas")
        if not args.desde.is_file():
            ap.error(f"no existe el archivo {args.desde}")
    elif args.accion != "lista" and not args.correo:
        ap.error(f"{args.accion} necesita el correo (o --desde para una tanda)")
    # El ensayo de una tanda no consulta la base: se puede revisar una lista
    # desde cualquier máquina, sin credenciales y sin .env.
    ensayo = bool(args.desde) and not args.ejecutar
    if args.accion in ("alta", "adoptar", "slots") and not ensayo:
        if not args.cluster_arn or not args.secret_arn:
            ap.error("faltan --cluster-arn/--secret-arn (o DB_CLUSTER_ARN/DB_SECRET_ARN)")
        os.environ["DB_CLUSTER_ARN"] = args.cluster_arn
        os.environ["DB_SECRET_ARN"] = args.secret_arn
    os.environ.setdefault("AWS_DEFAULT_REGION", args.pool.split("_")[0])

    if args.accion == "alta" and args.desde:
        alta_lote(args.pool, args.desde, args.plan, ejecutar=args.ejecutar,
                  tope=args.tope, pausa=args.pausa,
                  con_sospechosos=args.con_sospechosos, registro=args.registro)
    elif args.accion == "alta":
        alta(args.pool, args.correo, args.plan, reenviar=args.reenviar)
    elif args.accion == "suspender":
        suspender(args.pool, args.correo)
    elif args.accion == "reactivar":
        reactivar(args.pool, args.correo)
    elif args.accion == "adoptar":
        adoptar(args.pool, args.correo, args.de)
    elif args.accion == "admin":
        admin(args.pool, args.correo)
    elif args.accion == "slots":
        if not args.valor or (args.valor != "ilimitado" and not args.valor.isdigit()):
            ap.error("slots necesita un número o `ilimitado`")
        slots(args.pool, args.correo, args.valor)
    else:
        lista(args.pool)


if __name__ == "__main__":
    main()
