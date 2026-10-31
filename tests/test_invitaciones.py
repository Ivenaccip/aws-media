"""Fase 2 — el invitador: a quién se le escribe, cuándo, y que nunca sea de más.

Lo que se protege aquí no es «que mande correos»: es que no mande uno de más.
Pasarse del tope de Cognito crea usuarios sin clave; repetir un paso es spam a
alguien que pagó; escribirle a quien se dio de baja en Skool es peor. Por eso:

  * la selección (pipeline/invitaciones.py) se prueba pura, con fechas fijas;
  * el handler (worker/invitador.py) con una base en memoria que imita el
    índice único parcial, un Cognito falso y SNS capturado;
  * el historial y la carga (tools/invitaciones.py) con archivos en el formato
    REAL de tools/ (tandaN.txt.altas.tsv, reenvioN.txt);
  * y que el registro manual de tools/usuarios.py jamás rompa el loop del dueño.

El SQL nuevo se corrió además contra un Postgres de verdad durante la entrega
(índice parcial, ON CONFLICT, NOT EXISTS, el LEAST de los reenvíos): los dobles
de aquí solo imitan su comportamiento.
"""
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from pipeline import db
from pipeline import invitaciones as inv

REPO = Path(__file__).resolve().parent.parent
UTC = timezone.utc
AHORA = datetime(2026, 10, 22, 16, 0, tzinfo=UTC)        # jueves, 10:00 hora centro
LUNES = datetime(2026, 10, 26, 16, 0, tzinfo=UTC)
POOL = "us-east-1_prueba"


def hace(dias: float, desde: datetime = AHORA) -> datetime:
    return desde - timedelta(days=dias)


def miembro(correo, categoria="anual", ingreso="2026-10-01", estado="ok", nombre=None):
    plan = None if categoria is None else ("mensual" if categoria == "mensual" else "anual")
    return inv.Miembro(correo=correo, nombre=nombre or correo.split("@")[0], plan=plan,
                       categoria=categoria, ingreso=inv.fecha(ingreso) if ingreso else None,
                       estado=estado)


def usuario(correo, creado_dias, modificado_dias=None, estado="FORCE_CHANGE_PASSWORD",
            habilitado=True, desde=AHORA):
    return {"correo": correo, "estado": estado, "habilitado": habilitado,
            "creado": hace(creado_dias, desde),
            "modificado": hace(creado_dias if modificado_dias is None else modificado_dias, desde)}


def envio(correo, paso, dias, origen="bot", resultado="enviado", desde=AHORA):
    return {"correo": correo, "paso": paso, "origen": origen, "resultado": resultado,
            "creado": hace(dias, desde).isoformat()}


# ---------------------------------------------------------------------------
# el plan desde Skool

@pytest.mark.parametrize("precio,intervalo,plan,categoria", [
    ("$197", "year", "anual", "anual"),
    ("$25", "month", "mensual", "mensual"),
    ("0", "", "anual", "fai"),            # regla del dueño: 0 = anual
    ("", "", "anual", "fai"),             # sin precio (tier standard) = anual
    ("$0", "year", "anual", "fai"),
    ("$1,197", "year", "anual", "anual"),
    ("$25", "", None, None),              # un precio sin intervalo no se adivina
    ("gratis", "", None, None),           # basura: fuera y reportado
    ("$25", "week", None, None),
])
def test_plan_de(precio, intervalo, plan, categoria):
    assert inv.plan_de(precio, intervalo) == plan
    assert inv.categoria_de(precio, intervalo) == categoria


CSV = ("FirstName,LastName,Email,Invited By,JoinedDate,Question1,Answer1,Price,"
       "Recurring Interval,Tier,LTV\n"
       "Ana,Pérez, Ana@Gmail.com ,,2026-10-21 10:00:00,,,$197,year,premium,197\n"
       "Sin,Correo,,,2026-10-20 10:00:00,,,$25,month,standard,25\n"
       "Ana,Repetida,ana@gmail.com,,2026-10-19 10:00:00,,,$25,month,standard,25\n"
       "Beto,Gratis,beto@x.com,,2026-04-01 08:00:00,,,0,,standard,0\n"
       "Caro,Rara,caro@x.com,,2026-10-01 08:00:00,,,$25,,standard,25\n")


def test_leer_export_con_bom_repetidos_y_sin_correo(tmp_path):
    ruta = tmp_path / "community_members.csv"
    ruta.write_bytes(b"\xef\xbb\xbf" + CSV.encode("utf-8"))      # Excel le pone BOM
    exp = inv.leer_export(ruta)
    assert exp.filas == 5
    assert [m.correo for m in exp.miembros] == ["ana@gmail.com", "beto@x.com", "caro@x.com"]
    ana = exp.miembros[0]
    assert (ana.nombre, ana.plan, ana.categoria) == ("Ana Pérez", "anual", "anual")
    assert ana.ingreso == datetime(2026, 10, 21, 10, 0, tzinfo=UTC)
    assert exp.sin_correo == [(3, "Sin Correo")]
    assert exp.duplicados == [(4, "ana@gmail.com")], "el primero gana"
    assert exp.miembros[1].plan == "anual" and exp.miembros[1].categoria == "fai"
    assert exp.miembros[2].plan is None, "precio sin intervalo: no se invita"
    # y también acepta el texto directo
    assert [m.correo for m in inv.leer_export(CSV).miembros] == [m.correo for m in exp.miembros]


@pytest.mark.parametrize("texto,esperado", [
    ("2026-10-22 19:22:35.123456", datetime(2026, 10, 22, 19, 22, 35, 123456, tzinfo=UTC)),
    ("2026-10-22 19:22:35.1234", datetime(2026, 10, 22, 19, 22, 35, 123400, tzinfo=UTC)),
    ("2026-10-22 19:22:35+00", datetime(2026, 10, 22, 19, 22, 35, tzinfo=UTC)),
    ("2026-10-22T13:22:35-06:00", datetime(2026, 10, 22, 19, 22, 35, tzinfo=UTC)),
    ("2026-10-22 00:32:12", datetime(2026, 10, 22, 0, 32, 12, tzinfo=UTC)),
    ("", None), ("no es fecha", None),
])
def test_fecha_lee_lo_que_devuelve_postgres(texto, esperado):
    """El `::text` de Postgres recorta los ceros de los microsegundos, y el
    fromisoformat de Python 3.10 no acepta 4 cifras: sin normalizar, una fila
    de cada diez se leería como «sin fecha»."""
    assert inv.fecha(texto) == esperado


# ---------------------------------------------------------------------------
# el cupo del día

def test_el_dia_de_cognito_empieza_a_las_nueve_utc():
    assert inv.corte_del_dia(AHORA) == datetime(2026, 10, 22, 9, 0, tzinfo=UTC)
    assert inv.corte_del_dia(datetime(2026, 10, 22, 8, 59, tzinfo=UTC)) == \
        datetime(2026, 10, 21, 9, 0, tzinfo=UTC)
    assert inv.corte_del_dia(datetime(2026, 10, 22, 9, 0, tzinfo=UTC)) == \
        datetime(2026, 10, 22, 9, 0, tzinfo=UTC)


def test_el_cupo_nunca_es_negativo():
    assert inv.cupo(40, 12) == 28
    assert inv.cupo(40, 55) == 0


def test_gastado_hoy_es_la_mayor_de_las_dos_cuentas():
    """Tabla y pools no se suman: se toma la mayor. El ensayo y los fallos no
    salieron; lo de antes de las 09:00 UTC es del día anterior."""
    temprano = datetime(2026, 10, 22, 8, 30, tzinfo=UTC)
    envios = [envio("a@x.com", 0, 0.1), envio("b@x.com", 1, 0.2, origen="manual"),
              envio("c@x.com", 1, 0.25, resultado="enviando"),          # 10:00 UTC
              envio("d@x.com", 0, 0.1, resultado="ensayo"),
              envio("e@x.com", 0, 0.1, resultado="fallo:LimitExceededException"),
              {**envio("f@x.com", 1, 0), "creado": temprano.isoformat()},     # ayer para Cognito
              envio("g@x.com", 2, 3)]
    assert inv.gastado_hoy(envios, [], AHORA) == 3
    pools = [usuario(f"p{i}@x.com", 10, 0.1) for i in range(5)]
    pools += [usuario("q@x.com", 10, 2), usuario("r@x.com", 10, 0.1, estado="CONFIRMED")]
    assert inv.gastado_hoy(envios, pools, AHORA) == 5
    # a las 08:00 todavía es el día que empezó ayer a las 09:00: lo de 08:30 cuenta
    assert inv.gastado_hoy([{**envio("f@x.com", 1, 0), "creado": temprano.isoformat()}],
                           [], datetime(2026, 10, 22, 8, 45, tzinfo=UTC)) == 1


# ---------------------------------------------------------------------------
# la selección

def test_invitaciones_primero_y_luego_r1_r2_r3():
    miembros = [miembro("r3@x.com"), miembro("r2@x.com"), miembro("r1@x.com"),
                miembro("fai@x.com", "fai"), miembro("nuevo@x.com", "anual")]
    usuarios = [usuario("r1@x.com", 5), usuario("r2@x.com", 10, 5), usuario("r3@x.com", 20, 8)]
    envios = [envio("r2@x.com", 1, 5), envio("r3@x.com", 1, 15), envio("r3@x.com", 2, 8)]
    todos = inv.candidatos(miembros, usuarios, envios, AHORA)
    assert [(e.correo, e.paso) for e in todos] == [
        ("nuevo@x.com", 0), ("fai@x.com", 0), ("r1@x.com", 1), ("r2@x.com", 2), ("r3@x.com", 3)]
    assert [e.correo for e in inv.elegir_del_dia(miembros, usuarios, envios, AHORA, 3)] == [
        "nuevo@x.com", "fai@x.com", "r1@x.com"]
    assert inv.elegir_del_dia(miembros, usuarios, envios, AHORA, 0) == []


def test_orden_anual_mensual_fai_y_el_mas_reciente_primero():
    miembros = [miembro("fai@x.com", "fai", "2026-10-21"),
                miembro("mensual-viejo@x.com", "mensual", "2026-09-01"),
                miembro("anual-viejo@x.com", "anual", "2026-08-01"),
                miembro("sin-fecha@x.com", "anual", None),
                miembro("mensual-nuevo@x.com", "mensual", "2026-10-20"),
                miembro("anual-nuevo@x.com", "anual", "2026-10-20")]
    assert [e.correo for e in inv.candidatos(miembros, [], [], AHORA)] == [
        "anual-nuevo@x.com", "anual-viejo@x.com", "sin-fecha@x.com",
        "mensual-nuevo@x.com", "mensual-viejo@x.com", "fai@x.com"]


def test_los_recordatorios_tambien_van_por_categoria_dentro_de_su_paso():
    miembros = [miembro("f@x.com", "fai", "2026-10-20"), miembro("m@x.com", "mensual"),
                miembro("a@x.com", "anual", "2026-01-01")]
    usuarios = [usuario(c, 4) for c in ("f@x.com", "m@x.com", "a@x.com")]
    assert [e.correo for e in inv.candidatos(miembros, usuarios, [], AHORA)] == [
        "a@x.com", "m@x.com", "f@x.com"]


@pytest.mark.parametrize("creado,toca", [
    (2.0, False),
    (2.25, False),      # el 20 a las 10:00 UTC: día de Cognito del 20, va en su día 2
    (2.3, True),        # el 20 a las 08:48 UTC todavía era el día de Cognito del 19
    (2.9, True),        # el 19 a las 18:24 UTC: es su día 3 aunque falten horas
    (3.0, True),
])
def test_r1_al_dia_3(creado, toca):
    m, u = [miembro("a@x.com")], [usuario("a@x.com", creado)]
    assert bool(inv.candidatos(m, u, [], AHORA)) is toca


def test_unos_segundos_de_mas_no_corren_la_serie_un_dia():
    """El bot invitó a las 16:00:45 y el reloj del día 3 se disparó a las
    16:00:20: faltan 25 segundos para 72 horas, pero es su día 3 y le toca R1.
    Con horas exactas la serie 3/7/14 se iría a 4/8/15 sin que nadie lo note."""
    ahora = datetime(2026, 10, 22, 16, 0, 20, tzinfo=UTC)
    invitado = datetime(2026, 10, 19, 16, 0, 45, tzinfo=UTC)
    u = [{"correo": "a@x.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
          "creado": invitado, "modificado": invitado + timedelta(seconds=2)}]
    e = [{"correo": "a@x.com", "paso": 0, "origen": "bot", "resultado": "enviado",
          "creado": invitado.isoformat()}]
    assert [x.paso for x in inv.candidatos([miembro("a@x.com")], u, e, ahora)] == [1]


@pytest.mark.parametrize("creado,r1_hace,toca", [
    (7, 4, True),       # el R1 salió en su día 3: el R2 sale el día 7
    (6, 4, False),      # todavía no es el día 7
    (7, 1, False),      # el R1 salió tarde (día 6): faltan 4 días desde él
    (10, 4, True),
])
def test_r2_al_dia_7_y_a_4_dias_del_r1(creado, r1_hace, toca):
    m, u = [miembro("a@x.com")], [usuario("a@x.com", creado, r1_hace)]
    e = [envio("a@x.com", 0, creado, origen="historial"), envio("a@x.com", 1, r1_hace)]
    elegidos = inv.candidatos(m, u, e, AHORA)
    assert [(x.correo, x.paso) for x in elegidos] == ([("a@x.com", 2)] if toca else [])


@pytest.mark.parametrize("r2_hace,toca", [(7, True), (6, False)])
def test_r3_al_dia_14_y_a_7_dias_del_r2(r2_hace, toca):
    m, u = [miembro("a@x.com")], [usuario("a@x.com", 14, r2_hace)]
    e = [envio("a@x.com", 1, 10), envio("a@x.com", 2, r2_hace)]
    assert [x.paso for x in inv.candidatos(m, u, e, AHORA)] == ([3] if toca else [])


def test_despues_del_r3_ya_no_se_escribe_y_queda_frio():
    m, u = [miembro("a@x.com")], [usuario("a@x.com", 40, 20)]
    e = [envio("a@x.com", 1, 37), envio("a@x.com", 2, 33), envio("a@x.com", 3, 20)]
    assert inv.candidatos(m, u, e, AHORA) == []
    assert [c for c, _ in inv.frios(u, e, AHORA)] == ["a@x.com"]
    # con el R3 de hace 6 días todavía no está frío
    assert inv.frios(u, [envio("a@x.com", 3, 6)], AHORA) == []


def test_los_reenvios_manuales_y_el_historial_cuentan_como_paso():
    """reenvio1-5.txt cuentan como R1: el siguiente es R2, nunca otro R1."""
    m, u = [miembro("a@x.com")], [usuario("a@x.com", 25, 8)]
    e = [envio("a@x.com", 1, 8, origen="historial")]
    assert [x.paso for x in inv.candidatos(m, u, e, AHORA)] == [2]
    e = [envio("a@x.com", 1, 8, origen="manual")]
    assert [x.paso for x in inv.candidatos(m, u, e, AHORA)] == [2]


def test_un_toque_reciente_en_cognito_cuenta_como_ultimo_contacto():
    """Un reenvío que no dejó fila (otra máquina, una prueba) se ve en la última
    modificación de la cuenta: no se le escribe a los 2 días de eso."""
    m, u = [miembro("a@x.com")], [usuario("a@x.com", 10, 1)]
    assert inv.candidatos(m, u, [], AHORA) == []


def test_una_cuenta_sin_fechas_no_revienta_la_seleccion():
    """Sin UserCreateDate ni última modificación los días son «infinitos»: le
    toca su R1 y el motivo dice «?» en vez de tumbar la corrida entera."""
    u = [{"correo": "a@x.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
          "creado": None, "modificado": None}]
    (e,) = inv.candidatos([miembro("a@x.com")], u, [], AHORA)
    assert e.paso == 1 and "?" in e.motivo


def test_una_fila_con_columnas_de_mas_no_tumba_la_lectura():
    exp = inv.leer_export("FirstName,Email,Price,Recurring Interval\n"
                          "Ana,ana@x.com,0,,sobra,otra\n")
    assert [m.correo for m in exp.miembros] == ["ana@x.com"]


def test_bajas_revisar_excluidos_confirmados_y_sin_plan_no_reciben_nada():
    miembros = [miembro("revisar@x.com", estado="revisar"),
                miembro("excluido@x.com", estado="excluido"),
                miembro("excluido-con-cuenta@x.com", estado="excluido"),
                miembro("sin-plan@x.com", None),
                miembro("entro@x.com"), miembro("suspendido@x.com")]
    usuarios = [usuario("baja@x.com", 10), usuario("excluido-con-cuenta@x.com", 10),
                usuario("entro@x.com", 10, estado="CONFIRMED"),
                usuario("suspendido@x.com", 10, habilitado=False)]
    assert inv.candidatos(miembros, usuarios, [], AHORA) == []
    assert inv.bajas(miembros, usuarios) == ["baja@x.com"]
    assert inv.bajas([], usuarios) == [], "sin export no se declara baja a todo el pool"


def test_un_paso_cero_atorado_no_se_vuelve_a_proponer():
    """La Lambda murió entre anotar 'enviando' y llamar a Cognito: el índice lo
    bloquearía igual; ni se propone, y sale como atorado."""
    e = [{**envio("a@x.com", 0, 0.5), "resultado": "enviando"}]
    assert inv.candidatos([miembro("a@x.com")], [], e, AHORA) == []
    assert [a["correo"] for a in inv.atorados(e, AHORA)] == ["a@x.com"]


def test_lista_blanca():
    lista = "dueno@x.com, dueno+"
    assert inv.permitido("dueno@x.com", lista)
    assert inv.permitido("DUENO+prueba3@x.com", lista)
    assert not inv.permitido("otro@x.com", lista)
    assert not inv.permitido("dueno@otro.com", lista)
    assert not inv.permitido("cualquiera@x.com", "")


@pytest.mark.parametrize("a,b,parecidos", [
    ("Guillermo López", "Guillermo Lopez", True),
    ("Guillermo Lopez", "Guillermo Lopez Garcia", True),
    ("Juan Lopez", "Juan Perez", False),
    ("Juan", "Juan Perez", False),          # una palabra sola no dice nada
    ("", "Juan Perez", False),
])
def test_nombres_parecidos(a, b, parecidos):
    assert inv.nombres_parecidos(a, b) is parecidos


# ---------------------------------------------------------------------------
# el handler, con una base en memoria

class BaseFalsa:
    """Imita lo que importa de las tablas: el índice único parcial del bot
    (un paso 'enviando'/'enviado' del bot por correo; ensayo y fallo no cuentan)."""

    def __init__(self, modo="activo", tope=40, miembros=(), envios=(), cortesia=False,
                 cada_dias=1):
        self.fila_interruptor = None if modo is None else {
            "modo": modo, "tope": tope, "cada_dias": cada_dias, "nota": None, "creado": "x"}
        self.cortesia = cortesia             # ¿ya entró la cortesía de un alta a medias?
        self.tabla_miembros = [{"correo": m.correo, "nombre": m.nombre, "plan": m.plan,
                                "categoria": m.categoria, "precio": m.precio,
                                "ingreso": m.ingreso.isoformat() if m.ingreso else None,
                                "estado": m.estado} for m in miembros]
        self.tabla = [dict(e, id=i) for i, e in enumerate(envios, 1)]
        self.chocan: set = set()            # (correo, paso) que otra corrida ganó
        self.limpiezas: list = []

    def instalar(self, monkeypatch):
        monkeypatch.setattr(db, "invitaciones_interruptor", lambda: self.fila_interruptor)
        monkeypatch.setattr(db, "invitaciones_miembros_vigentes", lambda: self.tabla_miembros)
        monkeypatch.setattr(db, "invitaciones_envios", self.envios)
        monkeypatch.setattr(db, "invitaciones_reclamar", self.reclamar)
        monkeypatch.setattr(db, "invitaciones_marcar", self.marcar)
        monkeypatch.setattr(db, "invitaciones_anotar", self.anotar)
        monkeypatch.setattr(db, "invitaciones_fijar_estado", self.fijar_estado)
        monkeypatch.setattr(db, "invitaciones_limpiar_solicitudes", self.limpiezas.append)
        monkeypatch.setattr(db, "invitaciones_cortesia_abonada",
                            lambda user_id, plan: self.cortesia)

    def envios(self, resultados=inv.VIVOS):
        return [dict(e) for e in self.tabla if e["resultado"] in resultados]

    def reclamar(self, correo, paso, detalle=None, *, corte=None, tope=None, desde=None):
        vivas = [e for e in self.tabla if e["resultado"] in inv.VIVOS]
        if desde and any(e["correo"] == correo and inv.fecha(e["creado"]) > inv.fecha(desde)
                         for e in vivas):
            return None, "contacto_reciente"
        if tope is not None and sum(inv.fecha(e["creado"]) >= inv.fecha(corte) for e in vivas) >= tope:
            return None, "sin_cupo"
        if (correo, paso) in self.chocan or any(
                e["origen"] == "bot" and e["correo"] == correo and e["paso"] == paso
                for e in vivas):
            return None, "ya_mandado"
        return self._agregar(correo, paso, "bot", "enviando", detalle), None

    def marcar(self, id_, resultado, detalle=None):
        for e in self.tabla:
            if e["id"] == id_:
                e["resultado"] = resultado
                e["detalle"] = detalle if detalle is not None else e.get("detalle")

    def anotar(self, correo, paso, origen, resultado, detalle=None):
        self._agregar(correo, paso, origen, resultado, detalle)

    def fijar_estado(self, correo, estado):
        for m in self.tabla_miembros:
            if m["correo"] == correo:
                m["estado"] = estado
        return True

    def _agregar(self, correo, paso, origen, resultado, detalle):
        id_ = len(self.tabla) + 1
        self.tabla.append({"id": id_, "correo": correo, "paso": paso, "origen": origen,
                           "resultado": resultado, "detalle": detalle,
                           "creado": AHORA.isoformat()})
        return id_

    def filas(self, **filtro):
        return [e for e in self.tabla if all(e.get(k) == v for k, v in filtro.items())]


def _error(codigo):
    e = Exception(f"falló con {codigo}")
    e.response = {"Error": {"Code": codigo}}
    return e


@pytest.fixture
def bot(monkeypatch):
    """→ arma(base, usuarios, errores=..., existen=...) y lo capturado."""
    import worker.invitador as invitador
    from tools import usuarios as usuarios_mod

    capturado = {"altas": [], "publicado": [], "pool_leido": [],
                 "reenviar_real": usuarios_mod.reenviar_provisional}
    monkeypatch.setenv("COGNITO_POOL_ID", POOL)
    monkeypatch.setenv("INVITADOR_ES_PROD", "1")
    monkeypatch.delenv("INVITADOR_POOL_HERMANO", raising=False)
    monkeypatch.delenv("INVITADOR_PERMITIDOS", raising=False)
    monkeypatch.setattr(invitador.time, "sleep", lambda s: None)
    monkeypatch.setattr(invitador, "publicar",
                        lambda asunto, cuerpo: capturado["publicado"].append((asunto, cuerpo)))

    def arma(base, usuarios=(), errores=None, existen=()):
        base.instalar(monkeypatch)

        def leer_pool(pool):
            capturado["pool_leido"].append(pool)
            if pool != POOL:
                raise _error("ResourceNotFoundException")
            return list(usuarios)
        monkeypatch.setattr(invitador, "leer_pool", leer_pool)

        def alta(pool, correo, plan, reenviar=False):
            capturado["altas"].append((correo, plan, reenviar))
            err = (errores or {}).get(correo)
            if err:
                raise err
            return "sub"
        monkeypatch.setattr(usuarios_mod, "alta", alta)
        # el bot manda los recordatorios con el RESEND solo (sin plan)
        monkeypatch.setattr(usuarios_mod, "reenviar_provisional",
                            lambda pool, correo: alta(pool, correo, None, reenviar=True))

        class Cognito:
            def admin_get_user(self, UserPoolId, Username):
                if Username in existen:
                    return {"Username": Username,
                            "UserAttributes": [{"Name": "sub", "Value": "sub-" + Username}]}
                raise _error("UserNotFoundException")
        monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Cognito())
        return invitador
    return arma, capturado


def test_apagado_no_hace_nada(bot, monkeypatch):
    arma, cap = bot
    invitador = arma(BaseFalsa(modo=None, miembros=[miembro("n@x.com")]))
    assert invitador.correr(AHORA) == {"modo": "apagado"}
    assert cap["altas"] == [] and cap["publicado"] == [] and cap["pool_leido"] == []
    invitador = arma(BaseFalsa(modo="apagado", miembros=[miembro("n@x.com")]))
    assert invitador.correr(AHORA) == {"modo": "apagado"}
    assert cap["altas"] == [] and cap["publicado"] == []


def test_ensayo_no_llama_a_cognito_y_lo_dice(bot):
    arma, cap = bot
    base = BaseFalsa(modo="ensayo", miembros=[miembro("n@x.com"), miembro("r@x.com")])
    invitador = arma(base, [usuario("r@x.com", 4)])
    r = invitador.correr(AHORA)
    assert cap["altas"] == []
    assert [(e["correo"], e["paso"]) for e in base.filas(resultado="ensayo")] == [
        ("n@x.com", 0), ("r@x.com", 1)]
    assert r["ensayo"] == 2 and r["enviados"] == 0
    (asunto, cuerpo), = cap["publicado"]
    assert "ENSAYO" in asunto and "ENSAYO" in cuerpo
    # el ensayo no bloquea: mañana en activo los mismos se pueden mandar
    assert base.reclamar("n@x.com", 0)[0] is not None


def test_activo_anota_enviando_y_luego_enviado(bot):
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro("n@x.com", "mensual"), miembro("r@x.com")])
    invitador = arma(base, [usuario("r@x.com", 4)])
    from tools import usuarios as usuarios_mod
    alta_falsa, reenviar_falso = usuarios_mod.alta, usuarios_mod.reenviar_provisional
    estados_al_llamar = []

    def alta(pool, correo, plan, reenviar=False):
        # cuando Cognito recibe la llamada, la fila ya existe y dice 'enviando'
        estados_al_llamar.append([e["resultado"] for e in base.filas(correo=correo)])
        return alta_falsa(pool, correo, plan, reenviar)

    def reenviar(pool, correo):
        estados_al_llamar.append([e["resultado"] for e in base.filas(correo=correo)])
        return reenviar_falso(pool, correo)
    usuarios_mod.alta = alta                  # el monkeypatch del fixture lo deshace
    usuarios_mod.reenviar_provisional = reenviar
    r = invitador.correr(AHORA)
    assert cap["altas"] == [("n@x.com", "mensual", False), ("r@x.com", None, True)]
    assert estados_al_llamar == [["enviando"], ["enviando"]], "se reclama ANTES de llamar"
    assert [(e["correo"], e["paso"], e["resultado"]) for e in base.filas(origen="bot")] == [
        ("n@x.com", 0, "enviado"), ("r@x.com", 1, "enviado")]
    assert r["enviados"] == 2
    (asunto, cuerpo), = cap["publicado"]
    assert asunto.isascii() and len(asunto) < 100, "SNS solo acepta ASCII en el asunto"
    assert "n@x.com" in cuerpo and "R1" in cuerpo


def test_si_otro_ya_reclamo_el_paso_no_se_manda(bot):
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro("n@x.com"), miembro("m@x.com")])
    base.chocan.add(("n@x.com", 0))
    invitador = arma(base)
    invitador.correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["m@x.com"]
    assert "Ya tenían ese paso anotado" in cap["publicado"][0][1]


def test_el_tope_de_cognito_aborta_el_dia(bot):
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro(f"n{i}@x.com", ingreso=f"2026-10-{20 - i:02d}")
                               for i in range(4)])
    invitador = arma(base, errores={"n1@x.com": _error("LimitExceededException")})
    r = invitador.correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["n0@x.com", "n1@x.com"]
    assert r["abortado"] and "LimitExceededException" in r["abortado"]
    assert base.filas(correo="n1@x.com")[0]["resultado"] == "fallo:LimitExceededException"
    assert "ABORTADO" in cap["publicado"][0][0]


def test_tres_fallos_seguidos_abortan(bot):
    arma, cap = bot
    miembros = [miembro(f"n{i}@x.com", ingreso=f"2026-10-{20 - i:02d}") for i in range(6)]
    invitador = arma(BaseFalsa(miembros=miembros),
                     errores={m.correo: _error("InternalErrorException") for m in miembros})
    r = invitador.correr(AHORA)
    assert len(cap["altas"]) == 3
    assert "3 fallos seguidos" in r["abortado"]


def test_quien_entro_a_medio_camino_se_salta_sin_contar(bot):
    """UnsupportedUserStateException: confirmó entre la lectura del pool y el
    RESEND. No es un fallo del envío: no cuenta para los tres seguidos."""
    arma, cap = bot
    miembros = [miembro(f"r{i}@x.com", ingreso=f"2026-10-{20 - i:02d}") for i in range(5)]
    usuarios = [usuario(m.correo, 4) for m in miembros]
    errores = {"r0@x.com": _error("InternalErrorException"),
               "r1@x.com": _error("InternalErrorException"),
               "r2@x.com": _error("UnsupportedUserStateException")}
    base = BaseFalsa(miembros=miembros)
    r = arma(base, usuarios, errores=errores).correr(AHORA)
    assert len(cap["altas"]) == 5 and r["abortado"] is None
    assert base.filas(correo="r2@x.com")[0]["resultado"] == "fallo:UnsupportedUserStateException"
    assert r["fallos"] == 2 and r["enviados"] == 2


def test_un_alta_a_medias_se_reporta_y_no_se_reabona(bot):
    """Cognito creó la cuenta (y mandó el correo) pero la base falló: el paso
    quedó mandado y la cortesía NO se vuelve a intentar sola."""
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro("n@x.com")])
    invitador = arma(base, errores={"n@x.com": _error("BadRequestException")},
                     existen={"n@x.com"})
    r = invitador.correr(AHORA)
    assert len(cap["altas"]) == 1, "no se repite el alta"
    fila, = base.filas(correo="n@x.com")
    assert fila["resultado"] == "enviado" and fila["detalle"].startswith("alta a medias")
    assert r["a_medias"] == 1 and r["fallos"] == 0
    assert "Altas a medias" in cap["publicado"][0][1]


def test_fuera_de_prod_solo_escribe_a_la_lista_blanca(bot, monkeypatch):
    arma, cap = bot
    monkeypatch.setenv("INVITADOR_ES_PROD", "0")
    monkeypatch.setenv("INVITADOR_PERMITIDOS", "dueno+")
    base = BaseFalsa(miembros=[miembro("dueno+1@x.com"), miembro("real@x.com")])
    r = arma(base).correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["dueno+1@x.com"]
    fila, = base.filas(correo="real@x.com")
    assert fila["resultado"] == "ensayo" and "lista blanca" in fila["detalle"]
    assert r["fuera_de_lista"] == 1
    assert cap["publicado"][0][0].startswith("[dev]")


def test_el_tope_corta_y_lo_demas_espera(bot):
    arma, cap = bot
    miembros = [miembro(f"n{i}@x.com", ingreso=f"2026-10-{20 - i:02d}") for i in range(4)]
    # ya salieron 33 hoy: con tope 40 y 5 reservados para la página solo caben 2
    envios = [envio(f"hoy{i}@x.com", 0, 0.1, origen="manual") for i in range(33)]
    base = BaseFalsa(tope=40, miembros=miembros, envios=envios)
    arma(base).correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["n0@x.com", "n1@x.com"]
    assert "Esperan cupo para otro día: 2 invitación" in cap["publicado"][0][1]


def test_un_tope_de_mas_de_50_no_se_respeta(bot):
    arma, cap = bot
    miembros = [miembro(f"n{i:02d}@x.com") for i in range(60)]
    arma(BaseFalsa(tope=80, miembros=miembros)).correr(AHORA)
    assert len(cap["altas"]) == inv.TOPE_MAXIMO - inv.RESERVA_PAGINA


def test_el_pool_hermano_cuenta_y_si_no_se_puede_leer_se_dice(bot, monkeypatch):
    arma, cap = bot
    monkeypatch.setenv("INVITADOR_POOL_HERMANO", "us-east-1_otro")
    arma(BaseFalsa(miembros=[miembro("n@x.com")])).correr(AHORA)
    assert cap["pool_leido"] == [POOL, "us-east-1_otro"]
    assert len(cap["altas"]) == 1
    assert "no se pudo leer el pool hermano" in cap["publicado"][0][1]


def test_los_lunes_va_la_lista_de_frios(bot):
    arma, cap = bot
    u = [usuario("frio@x.com", 40, 10, desde=LUNES), usuario("b@x.com", 40, 10, desde=LUNES)]
    e = [envio("frio@x.com", 3, 10, desde=LUNES), envio("b@x.com", 3, 10, desde=LUNES)]
    arma(BaseFalsa(miembros=[miembro("frio@x.com")], envios=e), u).correr(LUNES)
    cuerpo = cap["publicado"][0][1]
    assert "fríos" in cuerpo and "frio@x.com" in cuerpo
    assert "Bajas detectadas" in cuerpo and "b@x.com" in cuerpo
    cap["publicado"].clear()
    arma(BaseFalsa(miembros=[miembro("frio@x.com")], envios=e), u).correr(LUNES + timedelta(days=1))
    assert "fríos" not in cap["publicado"][0][1]


def test_el_handler_corre_con_el_evento_de_eventbridge(bot):
    arma, cap = bot
    invitador = arma(BaseFalsa(modo=None))
    assert invitador.handler({"tipo": "invitador"}, None) == {"modo": "apagado"}


# ---------------------------------------------------------------------------
# tools/invitaciones.py: historial y cargar, con los formatos reales de tools/

@pytest.fixture
def herramienta():
    spec = importlib.util.spec_from_file_location("invitaciones_tool",
                                                  REPO / "tools" / "invitaciones.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _carpeta_real(tmp_path):
    """Archivos con la forma EXACTA de los de tools/ (cabeceras incluidas)."""
    (tmp_path / "tanda1.txt").write_text(
        "# Tanda 1 — Irremplazables by FAI · 2 altas\n"
        "uno@gmail.com anual   # 2026-09-20 ($197/año)  Guillermo Lopez\n"
        "dos@gmail.com\n", encoding="utf-8")
    (tmp_path / "tanda1.txt.altas.tsv").write_text(
        "cuando\tcorreo\tplan\tresultado\tdetalle\n"
        "2026-09-27T03:18:39+00:00\tuno@gmail.com\tanual\tfallo\tModuleNotFoundError\n"
        "2026-09-27T03:21:47+00:00\tuno@gmail.com\tanual\talta\tsub-1\n"
        "2026-09-27T03:21:51+00:00\tdos@gmail.com\tanual\talta\tsub-2\n", encoding="utf-8")
    (tmp_path / "reenvio1.txt").write_text(
        "# Reenvío 1 de 6 — 14-oct-2026 · 3 contraseñas provisionales vencidas\n"
        "# Fuente: pool de prod leído el 14-oct 14:24 hora centro\n"
        "#   for /f \"eol=# tokens=1\" %c in (tools\\reenvio1.txt) do venv\\Scripts\\python "
        "tools\\usuarios.py alta %c --reenviar\n"
        "uno@gmail.com   # anual 2026-10-03  Guillermo Lopez  (tanda 1)\n"
        "dos@gmail.com   # anual sin fecha  (tanda 1)\n"
        "nadie@gmail.com   # fai 2026-04-19  Sin Cuenta  (tanda 8)\n", encoding="utf-8")
    (tmp_path / "reenvio2.txt").write_text(
        "# Reenvío 2 — 15-oct-2026 · 1 contraseña\n"
        "tres@gmail.com   # mensual 2026-09-25  Tres Tres  (tanda 4)\n", encoding="utf-8")
    return tmp_path


POOL_REAL = [
    # entró el 27-sep (tanda 1) y su reenvío del 14-oct (14:00 centro) se ve en Cognito
    {"correo": "uno@gmail.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
     "creado": datetime(2026, 9, 27, 3, 21, 48, tzinfo=UTC),
     "modificado": datetime(2026, 10, 14, 20, 0, tzinfo=UTC)},
    # su cuenta se tocó DESPUÉS del reenvío: se anota a mediodía de ese día
    {"correo": "dos@gmail.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
     "creado": datetime(2026, 9, 27, 3, 21, 52, tzinfo=UTC),
     "modificado": datetime(2026, 10, 16, 1, 0, tzinfo=UTC)},
    # no está en ninguna .altas.tsv: su invitación es la fecha de Cognito
    {"correo": "tres@gmail.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
     "creado": datetime(2026, 9, 30, 18, 0, tzinfo=UTC),
     "modificado": datetime(2026, 10, 15, 17, 30, tzinfo=UTC)},
]


def test_los_nombres_salen_de_los_comentarios_reales(herramienta):
    assert herramienta._nombre_de_comentario(" 2026-10-21 ($197/año)  Guillermo Lopez") == "Guillermo Lopez"
    assert herramienta._nombre_de_comentario(" anual 2026-10-03  Ramiro Goetschel  (tanda 9)") == "Ramiro Goetschel"
    assert herramienta._nombre_de_comentario(" FAI 2026-05-27 ($77/año)  Iván Velasco") == "Iván Velasco"
    assert herramienta._nombre_de_comentario(" anual sin fecha  (tanda 3)") == ""


def test_historial_es_idempotente_con_los_formatos_reales(herramienta, tmp_path, monkeypatch, capsys):
    import worker.invitador as invitador
    carpeta = _carpeta_real(tmp_path)
    monkeypatch.setattr(invitador, "leer_pool", lambda pool: [dict(u) for u in POOL_REAL])
    tabla: list[tuple] = []

    def anotar_historial(correo, paso, creado, detalle):
        # lo mismo que el NOT EXISTS de la sentencia
        if any(c == correo and p == paso and (paso == 0 or d == detalle)
               for c, p, _t, d in tabla):
            return False
        tabla.append((correo, paso, creado, detalle))
        return True
    monkeypatch.setattr(db, "invitaciones_anotar_historial", anotar_historial)

    assert herramienta.historial(POOL, carpeta) == 0 and tabla == [], "sin --ejecutar no escribe"
    # 3 invitaciones + uno y dos (reenvío 1) + tres (reenvío 2); «nadie» no tiene cuenta
    assert herramienta.historial(POOL, carpeta, ejecutar=True) == 6
    filas = {(c, p): (inv.fecha(t), d) for c, p, t, d in tabla}
    assert filas[("uno@gmail.com", 0)] == (datetime(2026, 9, 27, 3, 21, 47, tzinfo=UTC),
                                           "tanda1.txt.altas.tsv"), "la alta buena, no el fallo"
    assert filas[("tres@gmail.com", 0)] == (datetime(2026, 9, 30, 18, 0, tzinfo=UTC),
                                            "UserCreateDate")
    assert filas[("uno@gmail.com", 1)] == (datetime(2026, 10, 14, 20, 0, tzinfo=UTC),
                                           "reenvio1.txt"), "confirmado por Cognito"
    assert filas[("dos@gmail.com", 1)] == (datetime(2026, 10, 14, 18, 0, tzinfo=UTC),
                                           "reenvio1.txt"), "mediodía hora centro"
    assert filas[("tres@gmail.com", 1)] == (datetime(2026, 10, 15, 17, 30, tzinfo=UTC),
                                            "reenvio2.txt")
    assert ("nadie@gmail.com", 1) not in filas
    salida = capsys.readouterr().out
    assert "nadie@gmail.com" in salida and "SIN CUENTA" in salida
    # la segunda corrida no duplica nada
    assert herramienta.historial(POOL, carpeta, ejecutar=True) == 0
    assert len(tabla) == 6


def test_historial_lee_el_reenvio_sin_de_6(herramienta, tmp_path):
    reenvios = herramienta.leer_reenvios(_carpeta_real(tmp_path))
    assert [(a, str(d), c) for a, d, c in reenvios] == [
        ("reenvio1.txt", "2026-10-14", ["uno@gmail.com", "dos@gmail.com", "nadie@gmail.com"]),
        ("reenvio2.txt", "2026-10-15", ["tres@gmail.com"])]


def test_cargar_marca_sospechosos_y_sin_ejecutar_no_escribe(herramienta, tmp_path, monkeypatch, capsys):
    import worker.invitador as invitador
    carpeta = _carpeta_real(tmp_path)
    monkeypatch.setenv("DB_CLUSTER_ARN", "arn:prueba")
    monkeypatch.setenv("DB_SECRET_ARN", "arn:prueba")
    monkeypatch.setattr(invitador, "leer_pool", lambda pool: [dict(u) for u in POOL_REAL])
    monkeypatch.setattr(db, "invitaciones_miembros_todos", lambda: [])
    monkeypatch.setattr(db, "invitaciones_miembros_vigentes", lambda: [])
    guardado = []
    monkeypatch.setattr(db, "invitaciones_guardar_miembros",
                        lambda filas, visto_en: guardado.append((filas, visto_en)) or len(filas))
    csv_ = (tmp_path / "export.csv")
    csv_.write_bytes(b"\xef\xbb\xbf" + (
        "FirstName,LastName,Email,Invited By,JoinedDate,Price,Recurring Interval,Tier,LTV\n"
        "Guillermo,López,guille.otro@gmail.com,,2026-10-21 10:00:00,$197,year,premium,197\n"
        "Dedo,Gordo,dedo@gmial.com,,2026-10-21 10:00:00,$25,month,standard,25\n"
        "Nueva,Persona,nueva@gmail.com,,2026-10-21 10:00:00,0,,standard,0\n"
        "Uno,YaTiene,uno@gmail.com,,2026-09-20 10:00:00,$197,year,premium,197\n"
        "Mal,Correo,no-es-correo,,2026-09-20 10:00:00,0,,standard,0\n").encode("utf-8"))
    assert herramienta.cargar(POOL, csv_, carpeta) == 0
    assert guardado == []
    salida = capsys.readouterr().out
    assert "ENSAYO" in salida and "RECHAZO" in salida
    # el comando sugerido se copia tal cual en cmd: ruta entre comillas y el venv
    assert f'venv\\Scripts\\python tools\\invitaciones.py cargar "{csv_}" --ejecutar' in salida
    herramienta.cargar(POOL, csv_, carpeta, ejecutar=True)
    (filas, visto_en), = guardado
    estados = {f["correo"]: f["estado"] for f in filas}
    assert estados == {"guille.otro@gmail.com": "revisar",     # se llama como uno@ (tanda 1)
                       "dedo@gmial.com": "revisar",            # dedazo de dominio
                       "nueva@gmail.com": "ok",
                       "uno@gmail.com": "ok"}                  # ya tiene cuenta: ni se compara
    assert {f["plan"] for f in filas if f["correo"] == "nueva@gmail.com"} == {"anual"}
    assert visto_en


# ---------------------------------------------------------------------------
# tools/usuarios.py: lo manual queda anotado, y si no se puede, no rompe nada

@pytest.fixture
def usuarios_mod():
    spec = importlib.util.spec_from_file_location("usuarios_fase2", REPO / "tools" / "usuarios.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_el_registro_manual_avisa_y_sigue_si_la_base_falla(usuarios_mod, monkeypatch, capsys):
    monkeypatch.setenv("DB_CLUSTER_ARN", "arn:prueba")
    monkeypatch.setenv("DB_SECRET_ARN", "arn:prueba")

    def revienta(correo, reenviar, detalle=None):
        e = Exception('relation "invitaciones_envios" does not exist')
        e.response = {"Error": {"Code": "BadRequestException"}}
        raise e
    monkeypatch.setattr(db, "invitaciones_anotar_manual", revienta)
    usuarios_mod.anotar_envio_manual("a@x.com", reenviar=True)      # no levanta
    assert "NO quedó anotado" in capsys.readouterr().out


def test_sin_base_no_se_intenta_anotar(usuarios_mod, monkeypatch):
    monkeypatch.delenv("DB_CLUSTER_ARN", raising=False)
    monkeypatch.setattr(db, "invitaciones_anotar_manual",
                        lambda *a, **k: pytest.fail("sin base no se anota"))
    usuarios_mod.anotar_envio_manual("a@x.com", reenviar=False)


def test_alta_lote_sigue_aunque_el_registro_falle(usuarios_mod, monkeypatch, tmp_path):
    monkeypatch.setenv("DB_CLUSTER_ARN", "arn:prueba")
    monkeypatch.setenv("DB_SECRET_ARN", "arn:prueba")

    class Cognito:
        def admin_create_user(self, **kw):
            return {"User": {"Attributes": [{"Name": "sub", "Value": "sub-" + kw["Username"]}]}}
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Cognito())
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    monkeypatch.setattr(db, "abonar_creditos", lambda u, n, t, r=None: n)
    monkeypatch.setattr(db, "fijar_slots", lambda u, s: None)
    anotados = []

    def anotar(correo, reenviar, detalle=None):
        anotados.append(correo)
        raise RuntimeError("tabla ausente")
    monkeypatch.setattr(db, "invitaciones_anotar_manual", anotar)
    lista = tmp_path / "t.txt"
    lista.write_text("uno@gmail.com\ndos@gmail.com\n", encoding="utf-8")
    assert usuarios_mod.alta_lote(POOL, lista, "mensual", ejecutar=True, pausa=0) == 2
    assert anotados == ["uno@gmail.com", "dos@gmail.com"]


def test_alta_en_si_no_anota_para_no_duplicar_lo_del_bot(usuarios_mod, monkeypatch):
    class Cognito:
        def admin_create_user(self, **kw):
            return {"User": {"Attributes": [{"Name": "sub", "Value": "s"}]}}

        def admin_get_user(self, **kw):
            return {"UserAttributes": [{"Name": "sub", "Value": "s"}]}
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Cognito())
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: [])
    monkeypatch.setattr(db, "abonar_creditos", lambda u, n, t, r=None: n)
    monkeypatch.setattr(db, "fijar_slots", lambda u, s: None)
    monkeypatch.setattr(db, "invitaciones_anotar_manual",
                        lambda *a, **k: pytest.fail("alta() no anota: lo hace quien la llama"))
    usuarios_mod.alta(POOL, "a@x.com", "anual")
    usuarios_mod.alta(POOL, "a@x.com", "anual", reenviar=True)


def test_main_anota_el_reenvio_manual(usuarios_mod, monkeypatch):
    monkeypatch.setenv("DB_CLUSTER_ARN", "arn:prueba")
    monkeypatch.setenv("DB_SECRET_ARN", "arn:prueba")
    monkeypatch.setattr(usuarios_mod, "alta", lambda *a, **k: "s")
    vistos = []
    monkeypatch.setattr(db, "invitaciones_anotar_manual",
                        lambda correo, reenviar, detalle=None: vistos.append((correo, reenviar)) or 1)
    monkeypatch.setattr("sys.argv", ["usuarios.py", "alta", "a@x.com", "--reenviar"])
    usuarios_mod.main()
    assert vistos == [("a@x.com", True)]


# ---------------------------------------------------------------------------
# el SQL (forma; su comportamiento se probó contra Postgres en la entrega)

def test_el_esquema_trae_las_cuatro_tablas_y_el_indice_del_bot():
    texto = "\n".join(db.ESQUEMA)
    for tabla in ("invitaciones_miembros", "invitaciones_envios", "invitaciones_interruptor",
                  "invitaciones_cargas"):
        assert f"CREATE TABLE IF NOT EXISTS {tabla}" in texto
    indice = next(s for s in db.ESQUEMA if "invitaciones_envios_bot_paso" in s)
    assert "UNIQUE" in indice and "(correo, paso)" in indice
    assert "origen = 'bot'" in indice and "('enviando', 'enviado')" in indice


@pytest.mark.parametrize("fila,esperado", [
    ({"id": 7, "vivas": 3, "reciente": False}, (7, None)),
    ({"id": None, "vivas": 3, "reciente": False}, (None, "ya_mandado")),
    ({"id": None, "vivas": 35, "reciente": False}, (None, "sin_cupo")),
    ({"id": None, "vivas": 35, "reciente": True}, (None, "contacto_reciente")),
])
def test_reclamar_usa_el_indice_y_dice_por_que_pierde(monkeypatch, fila, esperado):
    vistas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append((sql, p)) or [fila])
    assert db.invitaciones_reclamar(" A@x.com", 0, corte="c", tope=35, desde="d") == esperado
    sql, p = vistas[0]
    assert "ON CONFLICT DO NOTHING" in sql and "'enviando'" in sql and p["c"] == "a@x.com"
    assert (p["corte"], p["t"], p["desde"]) == ("c", 35, "d")


def test_el_interruptor_rechaza_un_tope_de_mas_de_50(monkeypatch):
    escritas = []

    def ejecutar(sql, p=None):
        if sql.startswith("INSERT"):
            escritas.append(p)
            return []
        return [{"modo": "ensayo", "tope": 35, "nota": None, "creado": "x"}]
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    with pytest.raises(ValueError):
        db.invitaciones_ajustar("activo", tope=51, nota="no")
    with pytest.raises(ValueError):
        db.invitaciones_ajustar("encendido", nota="no")
    db.invitaciones_ajustar("activo", nota="hereda el tope")
    assert escritas == [{"m": "activo", "t": 35, "k": 1, "n": "hereda el tope"}]


def test_la_carga_de_miembros_va_en_lotes_y_no_pisa_el_estado(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append((sql, p)) or [])
    filas = [{"correo": f"m{i}@x.com", "estado": "ok"} for i in range(30)]
    assert db.invitaciones_guardar_miembros(filas, "2026-10-22T10:00:00+00:00") == 30
    assert len(vistas) == 3, "dos lotes y, al final, la fila de la carga completa"
    assert "INSERT INTO invitaciones_cargas" in vistas[-1][0]
    actualiza = vistas[0][0].split("DO UPDATE", 1)[1]
    assert "estado" not in actualiza, "una carga nueva no pisa lo que el dueño aprobó o excluyó"
    assert "visto_en = EXCLUDED.visto_en" in actualiza
    assert all(p["v"] == "2026-10-22T10:00:00+00:00" for _, p in vistas)


def test_el_reenvio_manual_calcula_su_paso_en_la_sentencia(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar",
                        lambda sql, p=None: vistas.append((sql, p)) or [{"paso": 2}])
    assert db.invitaciones_anotar_manual("A@x.com ", True) == 2
    sql, p = vistas[0]
    assert "LEAST(3, COALESCE(max(paso), 0) + 1)" in sql and p == {"c": "a@x.com", "r": True,
                                                                     "d": None}


# ---------------------------------------------------------------------------
# lo que encontró la revisión adversarial (22-oct-2026)

def test_un_tope_de_cero_es_cero_y_no_cuarenta(bot):
    """`modo activo --tope 0` es «hoy mando yo a mano». `0 or 40` lo volvía 40 y
    el bot se comía el cupo de la cuenta."""
    arma, cap = bot
    invitador = arma(BaseFalsa(tope=0, miembros=[miembro(f"n{i}@x.com") for i in range(5)]))
    r = invitador.correr(AHORA)
    assert cap["altas"] == [] and r["tope"] == 0
    assert "Esperan cupo para otro día: 5 invitación" in cap["publicado"][0][1]


def test_un_interruptor_sin_tope_vale_el_de_defecto(bot, monkeypatch):
    arma, _ = bot
    invitador = arma(BaseFalsa())
    monkeypatch.setattr(db, "invitaciones_interruptor", lambda: {"modo": "ensayo", "tope": None})
    assert invitador.tomar_foto(POOL, ahora=AHORA).tope == inv.TOPE_DEFECTO


def test_el_recordatorio_es_solo_el_resend(bot, monkeypatch):
    """Si el RESEND salió, nada posterior lo vuelve «fallo». Antes pasaba por
    `alta()`, que además pedía el sub: un error ahí marcaba 'fallo' un correo que
    ya había salido, y el mismo R1 se volvía a mandar días después."""
    arma, cap = bot
    from tools import usuarios as usuarios_mod
    base = BaseFalsa(miembros=[miembro("r@x.com")])
    invitador = arma(base, [usuario("r@x.com", 4)])
    llamadas = []

    class Cognito:
        def admin_create_user(self, **kw):
            llamadas.append(kw["MessageAction"])

        def admin_get_user(self, **kw):
            raise _error("TooManyRequestsException")
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Cognito())
    monkeypatch.setattr(usuarios_mod, "reenviar_provisional", cap["reenviar_real"])
    r = invitador.correr(AHORA)
    assert llamadas == ["RESEND"]
    assert r["enviados"] == 1 and r["abortado"] is None
    (fila,) = base.filas(correo="r@x.com", origen="bot")
    assert (fila["paso"], fila["resultado"]) == (1, "enviado")


def test_una_direccion_que_cognito_rechaza_pasa_a_revisar_y_no_tapa_la_cola(bot):
    """Tres anuales con direcciones que Cognito no acepta y un mensual sano. El
    primer día se corta en tres (por si es el pool y no las direcciones), pero
    esas tres pasan a 'revisar' y al día siguiente el sano recibe su invitación."""
    arma, cap = bot
    malos = [miembro(f"malo{i}.@x.com", "anual", f"2026-10-{20 - i:02d}") for i in range(3)]
    base = BaseFalsa(miembros=malos + [miembro("sano@x.com", "mensual")])
    errores = {m.correo: _error("InvalidParameterException") for m in malos}
    r = arma(base, errores=errores).correr(AHORA)
    assert "3 fallos seguidos" in r["abortado"] and "direcciones" in r["abortado"]
    assert {m["correo"]: m["estado"] for m in base.tabla_miembros} == {
        "malo0.@x.com": "revisar", "malo1.@x.com": "revisar", "malo2.@x.com": "revisar",
        "sano@x.com": "ok"}
    assert "pasaron a 'revisar'" in cap["publicado"][0][1]
    cap["altas"].clear()
    r = arma(base, errores=errores).correr(AHORA + timedelta(days=1))
    assert [c for c, _, _ in cap["altas"]] == ["sano@x.com"] and r["abortado"] is None


def test_si_el_interruptor_se_apaga_a_media_corrida_no_se_manda(bot, monkeypatch):
    """correr() lee el interruptor UNA vez: un «apagado» que llega entre dos
    lecturas no puede caer en el ciclo de envío. Y mandar() solo toca Cognito
    en 'activo'."""
    arma, cap = bot
    invitador = arma(BaseFalsa(miembros=[miembro("n@x.com")]))
    lecturas = iter([{"modo": "ensayo", "tope": 40}, {"modo": "apagado", "tope": 40}])
    monkeypatch.setattr(db, "invitaciones_interruptor", lambda: next(lecturas))
    r = invitador.correr(AHORA)
    assert cap["altas"] == [] and r["modo"] == "ensayo"
    foto = invitador.tomar_foto(POOL, ahora=AHORA, interruptor={"modo": "apagado", "tope": 40})
    assert [e.correo for e in foto.elegidos] == ["n@x.com"]
    assert invitador.mandar(foto, POOL, prod=True, pausa=0).enviados == []
    assert cap["altas"] == []


@pytest.mark.parametrize("cortesia,frase", [
    (True, "la cortesía SÍ entró, no la abones otra vez"),
    (False, "la cortesía NO entró: abónala a mano (200 créditos del plan anual"),
    ("revienta", "PUEDE que SÍ haya entrado"),
])
def test_el_alta_a_medias_dice_si_la_cortesia_entro(bot, monkeypatch, cortesia, frase):
    """`alta()` abona ANTES de fijar los slots del anual: si truena después, la
    cortesía ya entró. Decir «NO se abonó» sin mirar la abonaba dos veces."""
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro("n@x.com")], cortesia=cortesia)
    invitador = arma(base, errores={"n@x.com": _error("StatementTimeoutException")},
                     existen={"n@x.com"})
    if cortesia == "revienta":
        def revienta(user_id, plan):
            raise _error("BadRequestException")
        monkeypatch.setattr(db, "invitaciones_cortesia_abonada", revienta)
    invitador.correr(AHORA)
    cuerpo = cap["publicado"][0][1]
    assert frase in cuerpo and "NO se abonó la cortesía" not in cuerpo
    if cortesia != "revienta":
        assert "slots n@x.com ilimitado" in cuerpo
    (fila,) = base.filas(correo="n@x.com")
    assert fila["resultado"] == "enviado" and frase in fila["detalle"]


def test_tres_altas_a_medias_seguidas_abortan(bot):
    """Una base que falla después de Cognito en serie no puede dejar cuarenta
    cuentas sin cortesía: las altas a medias cuentan para los tres seguidos."""
    arma, cap = bot
    miembros = [miembro(f"n{i}@x.com", ingreso=f"2026-10-{20 - i:02d}") for i in range(6)]
    r = arma(BaseFalsa(miembros=miembros),
             errores={m.correo: _error("BadRequestException") for m in miembros},
             existen={m.correo for m in miembros}).correr(AHORA)
    assert len(cap["altas"]) == 3 and r["a_medias"] == 3
    assert "la base falla después" in r["abortado"]


def _tres_nuevos():
    return [miembro(f"{c}@x.com", ingreso=f"2026-10-{d}")
            for c, d in (("a", 20), ("b", 19), ("c", 18))]


def test_si_la_base_falla_al_marcar_se_corta_y_el_resumen_sale_igual(bot, monkeypatch):
    arma, cap = bot
    base = BaseFalsa(miembros=_tres_nuevos())
    invitador = arma(base)
    marcadas = []

    def marcar(id_, resultado, detalle=None):
        marcadas.append(id_)
        if len(marcadas) == 2:
            raise _error("ThrottlingException")
        base.marcar(id_, resultado, detalle)
    monkeypatch.setattr(db, "invitaciones_marcar", marcar)
    r = invitador.correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["a@x.com", "b@x.com"], "c ya no se toca"
    assert [(e["correo"], e["resultado"]) for e in base.filas(origen="bot")] == [
        ("a@x.com", "enviado"), ("b@x.com", "enviando")]
    assert "la base falló (ThrottlingException)" in r["abortado"] and "SÍ salió" in r["abortado"]
    assert r["enviados"] == 2
    (asunto, cuerpo), = cap["publicado"]
    assert "ABORTADO" in asunto and "b@x.com" in cuerpo


def test_si_la_base_falla_al_reclamar_no_se_manda_a_esa_persona(bot, monkeypatch):
    arma, cap = bot
    base = BaseFalsa(miembros=_tres_nuevos())
    invitador = arma(base)

    def reclamar(correo, paso, detalle=None, **kw):
        if correo == "b@x.com":
            raise _error("InternalServerErrorException")
        return base.reclamar(correo, paso, detalle, **kw)
    monkeypatch.setattr(db, "invitaciones_reclamar", reclamar)
    r = invitador.correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == ["a@x.com"]
    assert "antes de mandar a b@x.com" in r["abortado"]
    assert "ABORTADO" in cap["publicado"][0][0]


def test_un_error_inesperado_publica_el_resumen_y_sigue_su_camino(bot, monkeypatch):
    """Lo que no se esperaba también deja resumen (con lo que alcanzó a pasar) y
    luego se relanza: queda en el log, en la métrica Errors y en el destino de
    fallo de la Lambda."""
    arma, cap = bot
    base = BaseFalsa(modo="ensayo", miembros=[miembro("a@x.com"), miembro("b@x.com")])
    invitador = arma(base)
    vistas = []

    def anotar(*a, **k):
        vistas.append(a)
        if len(vistas) == 2:
            raise RuntimeError("se cayó")
        base.anotar(*a, **k)
    monkeypatch.setattr(db, "invitaciones_anotar", anotar)
    with pytest.raises(RuntimeError):
        invitador.correr(AHORA)
    (asunto, cuerpo), = cap["publicado"]
    assert "ABORTADO" in asunto and "error inesperado: RuntimeError" in cuerpo


def test_si_no_se_puede_ni_tomar_la_foto_tambien_se_avisa(bot, monkeypatch):
    arma, cap = bot
    invitador = arma(BaseFalsa(miembros=[miembro("a@x.com")]))

    def revienta(resultados=inv.VIVOS):
        raise _error("BadRequestException")
    monkeypatch.setattr(db, "invitaciones_envios", revienta)
    with pytest.raises(Exception):
        invitador.correr(AHORA)
    (asunto, cuerpo), = cap["publicado"]
    assert "ABORTADO antes de empezar" in asunto and asunto.isascii()
    assert cap["altas"] == []


def test_un_atorado_de_invitacion_con_cuenta_pide_revisar_la_cortesia(bot):
    arma, cap = bot
    atorado = {**envio("a@x.com", 0, 1), "resultado": "enviando"}
    base = BaseFalsa(modo="ensayo", miembros=[miembro("a@x.com")], envios=[atorado])
    arma(base, [usuario("a@x.com", 1)]).correr(AHORA)
    assert "TIENE cuenta: verifica su fila en usuarios y la cortesía" in cap["publicado"][0][1]


def test_historial_no_anota_un_reenvio_que_cognito_dice_que_no_salio(
        herramienta, tmp_path, monkeypatch, capsys):
    """Un reenvioN.txt preparado y no corrido, o un RESEND que Cognito rechazó
    por el tope: la cuenta no se tocó desde antes de ese día. Anotarlo le
    quitaría su R1 (el bot le mandaría directo el R2)."""
    import worker.invitador as invitador
    carpeta = _carpeta_real(tmp_path)
    (carpeta / "reenvio3.txt").write_text(
        "# Reenvío 3 — 16-oct-2026 · 2 contraseñas\n"
        "uno@gmail.com   # anual 2026-10-03  Guillermo Lopez  (tanda 1)\n"
        "cuatro@gmail.com   # fai 2026-04-19  Cuatro Cuatro  (tanda 8)\n", encoding="utf-8")
    cuatro = {"correo": "cuatro@gmail.com", "estado": "FORCE_CHANGE_PASSWORD",
              "habilitado": True, "creado": datetime(2026, 9, 28, 3, 0, tzinfo=UTC),
              "modificado": datetime(2026, 10, 10, 17, 0, tzinfo=UTC)}    # antes del 16
    monkeypatch.setattr(invitador, "leer_pool",
                        lambda pool: [dict(u) for u in POOL_REAL] + [cuatro])
    tabla = []
    monkeypatch.setattr(db, "invitaciones_anotar_historial",
                        lambda c, p, t, d: tabla.append((c, p, d)) or True)
    herramienta.historial(POOL, carpeta, ejecutar=True)
    # uno@ se tocó el 14 (su reenvío 1), no el 16: el reenvío 3 tampoco salió
    assert ("cuatro@gmail.com", 1, "reenvio3.txt") not in tabla
    assert ("uno@gmail.com", 1, "reenvio3.txt") not in tabla
    assert ("uno@gmail.com", 1, "reenvio1.txt") in tabla
    assert ("cuatro@gmail.com", 0, "UserCreateDate") in tabla
    salida = capsys.readouterr().out
    assert "NO SALIÓ    reenvio3.txt: cuatro@gmail.com" in salida
    assert '--dir "' not in salida, "con --ejecutar no se sugiere otro comando"


def test_un_correo_repetido_con_otro_plan_queda_en_revisar(herramienta, tmp_path, monkeypatch,
                                                         capsys):
    """El orden de las filas no puede decidir si la cortesía es de 100 o de 200."""
    import worker.invitador as invitador
    texto = ("FirstName,LastName,Email,JoinedDate,Price,Recurring Interval\n"
             "Ana,Uno,ana@x.com,2026-10-20 10:00:00,$25,month\n"
             "Ana,Uno,ana@x.com,2026-10-21 10:00:00,$197,year\n"
             "Beto,Dos,beto@x.com,2026-10-20 10:00:00,0,\n"
             "Beto,Dos,beto@x.com,2026-10-20 10:00:00,,\n")
    exp = inv.leer_export(texto)
    assert exp.conflictos == [(3, "ana@x.com", "$25 month", "$197 year")]
    assert exp.duplicados == [(3, "ana@x.com"), (5, "beto@x.com")], "beto: misma categoría"
    csv_ = tmp_path / "community_members (11).csv"
    csv_.write_text(texto, encoding="utf-8")
    monkeypatch.setenv("DB_CLUSTER_ARN", "arn:prueba")
    monkeypatch.setenv("DB_SECRET_ARN", "arn:prueba")
    monkeypatch.setattr(invitador, "leer_pool", lambda pool: [])
    monkeypatch.setattr(db, "invitaciones_miembros_todos", lambda: [])
    monkeypatch.setattr(db, "invitaciones_miembros_vigentes", lambda: [])
    guardado = []
    monkeypatch.setattr(db, "invitaciones_guardar_miembros",
                        lambda filas, visto_en: guardado.append(filas) or len(filas))
    herramienta.cargar(POOL, csv_, tmp_path, ejecutar=True)
    (filas,) = guardado
    assert {f["correo"]: f["estado"] for f in filas} == {"ana@x.com": "revisar", "beto@x.com": "ok"}
    salida = capsys.readouterr().out
    assert "CONFLICTO" in salida and "$197 year" in salida


def test_una_carga_que_truena_a_la_mitad_no_queda_como_vigente(monkeypatch):
    """Sin transacción, los lotes que entraron ya traen el visto_en nuevo. La
    carga solo cuenta cuando se anota completa en invitaciones_cargas, y el
    vigente se mide contra esa: no queda un export recortado (ni bajas falsas)."""
    vistas = []

    def ejecutar(sql, p=None):
        vistas.append(sql)
        if len(vistas) == 2:
            raise _error("BadRequestException")
        return []
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    filas = [{"correo": f"m{i}@x.com", "estado": "ok"} for i in range(60)]
    with pytest.raises(Exception):
        db.invitaciones_guardar_miembros(filas, "2026-10-22T10:00:00+00:00")
    assert not any("invitaciones_cargas" in s for s in vistas)
    vistas.clear()
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append(sql) or [])
    db.invitaciones_miembros_vigentes()
    assert "visto_en >= (SELECT max(visto_en) FROM invitaciones_cargas)" in vistas[0]


# ---------------------------------------------------------------------------
# la reserva para la página /acceso (server/acceso.py)

@pytest.mark.parametrize("tope,gastado,cupo", [
    (40, 0, 35), (40, 34, 1), (40, 35, 0), (40, 39, 0), (40, 60, 0),
    (5, 0, 0), (3, 0, 0), (0, 0, 0), (50, 0, 45)])
def test_el_cupo_del_bot_deja_la_reserva(tope, gastado, cupo):
    assert inv.RESERVA_PAGINA == 5
    assert inv.cupo_bot(tope, gastado) == cupo


def test_el_bot_deja_cinco_libres_y_el_resumen_lo_dice(bot):
    arma, cap = bot
    miembros = [miembro(f"n{i:02d}@x.com") for i in range(60)]
    r = arma(BaseFalsa(tope=40, miembros=miembros)).correr(AHORA)
    assert len(cap["altas"]) == 35 and r["tope"] == 40
    cuerpo = cap["publicado"][0][1]
    assert "libre para el bot 0 (deja 5 para la página /acceso)" in cuerpo
    assert "Esperan cupo para otro día: 25 invitación" in cuerpo


def test_lo_que_mando_la_pagina_le_quita_cupo_al_bot(bot):
    arma, cap = bot
    envios = [envio(f"p{i}@x.com", 1, 0.1, origen="pagina") for i in range(30)]
    miembros = [miembro(f"n{i}@x.com", ingreso=f"2026-10-{20 - i:02d}") for i in range(9)]
    arma(BaseFalsa(tope=40, miembros=miembros, envios=envios)).correr(AHORA)
    assert [c for c, _, _ in cap["altas"]] == [f"n{i}@x.com" for i in range(5)]
    assert "Página /acceso: 30 correos pedidos hoy" in cap["publicado"][0][1]


def test_sin_pedidos_de_la_pagina_el_resumen_no_la_menciona_como_uso(bot):
    arma, cap = bot
    arma(BaseFalsa(miembros=[miembro("n@x.com")])).correr(AHORA)
    assert "correos pedidos hoy" not in cap["publicado"][0][1]


def test_la_foto_es_la_misma_para_hoy_y_para_el_bot(bot):
    arma, _ = bot
    invitador = arma(BaseFalsa(tope=40, miembros=[miembro(f"n{i:02d}@x.com") for i in range(60)]))
    foto = invitador.tomar_foto(POOL, ahora=AHORA)
    assert foto.cupo == 35 and len(foto.elegidos) == 35 and len(foto.todos) == 60


def test_hoy_y_estado_dicen_la_reserva(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    envios = [envio("p@x.com", 1, 0.1, origen="pagina")]
    arma(BaseFalsa(tope=40, miembros=[miembro("n@x.com")], envios=envios))
    herramienta.hoy(POOL, None)
    assert "deja 5 para la página /acceso" in capsys.readouterr().out
    herramienta.estado(POOL, None)
    salida = capsys.readouterr().out
    assert "cupo libre del bot" in salida and "deja 5 para la página /acceso" in salida


def _la_pagina_pide_antes_de_cada_reclamo(base, monkeypatch, maximo=None):
    """Antes de cada reclamo del bot la página anota lo suyo, con el tope del día.
    → los correos que la página alcanzó a mandar."""
    original, pagina = base.reclamar, []

    def reclamar(correo, paso, detalle=None, **kw):
        vivas = [e for e in base.tabla if e["resultado"] in inv.VIVOS]
        if len(vivas) < base.fila_interruptor["tope"] and (maximo is None or len(pagina) < maximo):
            pagina.append(base._agregar(f"p{len(pagina)}@x.com", 0, "pagina", "enviado", None))
        return original(correo, paso, detalle, **kw)
    monkeypatch.setattr(db, "invitaciones_reclamar", reclamar)
    return pagina


def test_la_pagina_gasta_mientras_corre_el_bot_y_el_total_no_pasa_del_tope(bot, monkeypatch):
    """La foto dice 35; con una solicitud por cada reclamo, sin volver a contar el
    día cerraba en 55. El bot para en tope - reserva y la página llega al tope."""
    arma, cap = bot
    base = BaseFalsa(tope=40, miembros=[miembro(f"n{i:02d}@x.com") for i in range(60)])
    invitador = arma(base)
    _la_pagina_pide_antes_de_cada_reclamo(base, monkeypatch)
    r = invitador.correr(AHORA)
    assert len([e for e in base.tabla if e["resultado"] in inv.VIVOS]) <= 40
    assert len(cap["altas"]) == 17 and r["enviados"] == 17
    assert r["cupo_agotado"] == 18 and r["abortado"] is None
    asunto, cuerpo = cap["publicado"][0]
    assert "ABORTADO" not in asunto, "no es una falla: la gente ocupó su lugar"
    assert "Se acabó el cupo a media corrida" in cuerpo and "18 se quedan para otro día" in cuerpo


def test_con_pocas_solicitudes_el_bot_sigue_dejando_libre_la_reserva(bot, monkeypatch):
    arma, cap = bot
    base = BaseFalsa(tope=40, miembros=[miembro(f"n{i:02d}@x.com") for i in range(60)])
    invitador = arma(base)
    _la_pagina_pide_antes_de_cada_reclamo(base, monkeypatch, maximo=3)
    r = invitador.correr(AHORA)
    assert len(cap["altas"]) == 32 and r["cupo_agotado"] == 3
    assert len([e for e in base.tabla if e["resultado"] in inv.VIVOS]) == 35, "quedan 5 libres"


def test_quien_pidio_clave_despues_de_la_foto_no_recibe_otra_del_bot(bot):
    """Otro RESEND invalidaría la clave que le acaba de llegar."""
    arma, cap = bot
    base = BaseFalsa(miembros=[miembro("a@x.com"), miembro("b@x.com"), miembro("c@x.com")])
    invitador = arma(base, [usuario("a@x.com", 4), usuario("b@x.com", 4), usuario("c@x.com", 4)])
    foto = invitador.tomar_foto(POOL, ahora=AHORA)
    assert len(foto.elegidos) == 3
    base.tabla.append({"id": 99, "correo": "b@x.com", "paso": 0, "origen": "pagina",
                       "resultado": "enviado", "creado": (AHORA + timedelta(seconds=5)).isoformat()})
    r = invitador.mandar(foto, POOL, prod=True, pausa=0)
    assert sorted(c for c, _, _ in cap["altas"]) == ["a@x.com", "c@x.com"]
    assert [(e.correo, c) for e, c in r.saltados] == [("b@x.com", "acaba de recibir otro correo")]
    assert [e["origen"] for e in base.tabla if e["correo"] == "b@x.com"] == ["pagina"]
    _, cuerpo = invitador.resumen(foto, r, entorno="prod")
    assert "b@x.com" in cuerpo and "acaba de recibir otro correo" in cuerpo


@pytest.mark.parametrize("modo", [None, "apagado", "activo"])
def test_cada_corrida_limpia_los_hashes_viejos_aunque_este_apagado(bot, modo):
    """Sin esto, la última solicitud de una racha se quedaría semanas en la tabla."""
    arma, _ = bot
    base = BaseFalsa(modo=modo)
    arma(base).correr(AHORA)
    assert base.limpiezas == [inv.corte_del_dia(AHORA).isoformat()]


def test_si_la_limpieza_falla_la_corrida_sigue(bot, monkeypatch):
    arma, cap = bot
    invitador = arma(BaseFalsa(miembros=[miembro("n@x.com")]))
    monkeypatch.setattr(db, "invitaciones_limpiar_solicitudes",
                        lambda corte: (_ for _ in ()).throw(_error("BadRequestException")))
    assert invitador.correr(AHORA)["enviados"] == 1
    assert [c for c, _, _ in cap["altas"]] == ["n@x.com"]


def test_la_limpieza_solo_toca_lo_de_antes_del_corte(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append((sql, p)) or [])
    db.invitaciones_limpiar_solicitudes("c")
    sql, p = vistas[0]
    assert sql.startswith("DELETE FROM invitaciones_solicitudes") and "creado <" in sql
    assert p == {"corte": "c"}


@pytest.mark.parametrize("modo", inv.MODOS)
def test_el_modo_avisa_que_el_tope_cero_no_se_acaba_solo(herramienta, modo):
    aviso = herramienta.aviso_del_modo({"modo": modo, "tope": 0})
    assert "también mañana" in aviso and f"modo {modo} --tope 40" in aviso
    assert herramienta.aviso_del_modo({"modo": modo, "tope": 40}) is None


def test_el_comando_modo_imprime_el_aviso(herramienta, monkeypatch, capsys):
    import sys
    monkeypatch.setattr(sys, "argv", ["invitaciones.py", "modo", "activo", "--nota", "x",
                                      "--cluster-arn", "c", "--secret-arn", "s", "--pool", POOL])
    monkeypatch.setattr(db, "invitaciones_ajustar",
                        lambda modo, tope=None, cada_dias=None, nota=None:
                        {"modo": modo, "tope": 0, "nota": nota})
    monkeypatch.setattr(db, "invitaciones_interruptor", lambda: {"modo": "activo", "tope": 0})
    herramienta.main()
    salida = capsys.readouterr().out
    assert "tope 0" in salida and "modo activo --tope 40" in salida


def test_el_runbook_dice_la_verdad_del_tope_cero_y_el_orden():
    from pathlib import Path
    doc = (Path(__file__).resolve().parent.parent / "docs" / "OPERACION.md").read_text(encoding="utf-8")
    assert "apaga también al bot ese día" not in doc and "no manda nada ese día" not in doc
    assert 'modo activo --tope 40 --nota "vuelvo a abrir"' in doc
    # historial antes de que exista la página: un RESEND suyo movería la fecha en Cognito
    assert doc.index("`historial --dir tools` (primero") < doc.index("`cdk diff` y `cdk deploy` de prod con")


def test_reenviar_provisional_no_imprime_el_correo(usuarios_mod, monkeypatch, capsys):
    """Lo llama también la Lambda del API (server/acceso.py): su log no lleva
    correos. Quien sí lo dice es el comando del dueño."""
    class Cognito:
        def admin_create_user(self, **kw):
            return {}

        def admin_get_user(self, **kw):
            return {"UserAttributes": [{"Name": "sub", "Value": "s"}]}
    monkeypatch.setattr(usuarios_mod, "_cognito", lambda pool=None: Cognito())
    usuarios_mod.reenviar_provisional(POOL, "a@x.com")
    assert capsys.readouterr().out == ""
    usuarios_mod.alta(POOL, "a@x.com", "anual", reenviar=True)
    assert "a@x.com: contraseña provisional reenviada" in capsys.readouterr().out


def test_un_frio_que_pidio_clave_dice_su_ultimo_correo_no_su_r3(bot):
    arma, cap = bot
    u = [usuario("a@x.com", 40, 8, desde=LUNES)]
    e = [envio("a@x.com", 3, 20, desde=LUNES), envio("a@x.com", 3, 8, origen="pagina", desde=LUNES)]
    arma(BaseFalsa(miembros=[miembro("a@x.com")], envios=e), u).correr(LUNES)
    assert "(último correo el 2026-10-18)" in cap["publicado"][0][1]


# ---------------------------------------------------------------------------
# la frecuencia (31-oct-2026): cada 3 días durante la prueba, luego a diario, sin deploy

def _fila_cruda(origen, resultado, dias, desde=AHORA):
    return {"correo": "x@x.com", "paso": 0, "origen": origen, "resultado": resultado,
            "creado": hace(dias, desde).isoformat()}


@pytest.mark.parametrize("fila,esperado", [
    (None, 1), ({}, 1), ({"cada_dias": None}, 1), ({"cada_dias": 3}, 3),
    ({"cada_dias": 0}, 1), ({"cada_dias": 99}, inv.CADA_DIAS_MAXIMO),
])
def test_la_frecuencia_del_interruptor(fila, esperado):
    assert inv.cada_dias_de(fila) == esperado


def test_a_diario_siempre_corre():
    ayer = [_fila_cruda("bot", "enviado", 1)]
    hoy_mismo = [_fila_cruda("bot", "enviado", 0)]
    assert inv.toca_correr(1, [], AHORA)
    assert inv.toca_correr(1, ayer, AHORA) and inv.toca_correr(1, hoy_mismo, AHORA)


@pytest.mark.parametrize("dias,toca", [(0, False), (1, False), (2, False), (3, True), (4, True)])
def test_cada_3_no_corre_los_dias_1_y_2_y_si_el_3(dias, toca):
    assert inv.toca_correr(3, [_fila_cruda("bot", "enviado", dias)], AHORA) is toca


def test_la_frecuencia_cuenta_dias_de_cognito_y_no_horas():
    """Mismo motivo que la serie: la fila queda unos segundos después del reloj."""
    corrida = [{"origen": "bot", "resultado": "enviado",
                "creado": (AHORA + timedelta(seconds=5)).isoformat()}]
    assert inv.toca_correr(3, corrida, AHORA + timedelta(days=3)), "faltan 5 segundos para 72 h"
    antes_del_corte = (AHORA + timedelta(days=3)).replace(hour=8)
    assert not inv.toca_correr(3, corrida, antes_del_corte), "sigue siendo el día 2 de Cognito"


@pytest.mark.parametrize("origen,resultado", [
    ("pagina", "enviado"), ("historial", "enviado"), ("manual", "enviado"),
    ("bot", "ensayo"), ("bot", "fallo:InternalErrorException"),
])
def test_lo_que_no_es_una_corrida_real_no_retrasa(origen, resultado):
    assert inv.toca_correr(3, [_fila_cruda(origen, resultado, 1)], AHORA)
    # tampoco tapa la corrida real de hace tres días
    filas = [_fila_cruda("bot", "enviado", 3), _fila_cruda(origen, resultado, 1)]
    assert inv.toca_correr(3, filas, AHORA)


def test_un_enviando_del_bot_si_cuenta_como_corrida():
    assert not inv.toca_correr(3, [_fila_cruda("bot", "enviando", 1)], AHORA)


def test_sin_corridas_previas_toca_y_una_fecha_rara_no_frena():
    assert inv.toca_correr(3, [], AHORA)
    assert inv.toca_correr(3, [{"origen": "bot", "resultado": "enviado", "creado": None}], AHORA)


@pytest.mark.parametrize("cada,dias,ahora,esperada", [
    (1, 0, AHORA - timedelta(hours=2), "2026-10-22 16:00"),     # hoy, aún no suena el reloj
    (1, 0, AHORA, "2026-10-23 16:00"),                          # ya sonó
    (3, 1, AHORA, "2026-10-24 16:00"),                          # la última fue ayer
    (3, 0, AHORA, "2026-10-25 16:00"),
    (3, 9, AHORA, "2026-10-23 16:00"),                          # vencida: la siguiente salida
    (3, 9, AHORA - timedelta(hours=2), "2026-10-22 16:00"),
])
def test_la_proxima_corrida_estimada(cada, dias, ahora, esperada):
    filas = [_fila_cruda("bot", "enviado", dias)]
    assert f"{inv.proxima_corrida(cada, filas, ahora):%Y-%m-%d %H:%M}" == esperada


def test_la_proxima_sin_corridas_previas_es_la_siguiente_salida_del_reloj():
    assert f"{inv.proxima_corrida(3, [], AHORA):%Y-%m-%d %H:%M}" == "2026-10-23 16:00"


def test_la_regla_de_eventbridge_sigue_diaria_a_la_hora_que_se_estima():
    api = (REPO / "infra" / "stacks" / "api.py").read_text(encoding="utf-8")
    assert f'events.Schedule.cron(minute="0", hour="{inv.HORA_CORRIDA_UTC}")' in api


# --- el SQL y el interruptor

def _interruptor_falso(monkeypatch, vigente):
    escritas = []

    def ejecutar(sql, p=None):
        if sql.startswith("INSERT"):
            escritas.append(p)
            return []
        return [vigente] if vigente else [{"modo": "x", "tope": 0}]
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    return escritas


def test_ajustar_hereda_la_frecuencia_de_la_fila_vigente(monkeypatch):
    escritas = _interruptor_falso(monkeypatch, {"modo": "activo", "tope": 40, "cada_dias": 3})
    db.invitaciones_ajustar("ensayo", nota="hereda")
    db.invitaciones_ajustar("activo", cada_dias=1, nota="a diario")
    assert [(p["k"], p["t"]) for p in escritas] == [(3, 40), (1, 40)]


def test_ajustar_sin_fila_previa_es_a_diario(monkeypatch):
    llamadas = iter([[], [{"modo": "activo", "tope": 40, "cada_dias": 1}]])
    escritas = []

    def ejecutar(sql, p=None):
        if sql.startswith("INSERT"):
            escritas.append(p)
            return []
        return next(llamadas)
    monkeypatch.setattr(db, "ejecutar", ejecutar)
    db.invitaciones_ajustar("activo", nota="primera")
    assert escritas == [{"m": "activo", "t": 40, "k": 1, "n": "primera"}]


def test_ajustar_hereda_de_una_fila_de_antes_de_la_columna(monkeypatch):
    escritas = _interruptor_falso(monkeypatch, {"modo": "activo", "tope": 40})
    db.invitaciones_ajustar("activo", nota="x")
    assert escritas[0]["k"] == 1


@pytest.mark.parametrize("malo", [0, -1, inv.CADA_DIAS_MAXIMO + 1])
def test_ajustar_rechaza_una_frecuencia_fuera_de_rango(monkeypatch, malo):
    escritas = _interruptor_falso(monkeypatch, {"modo": "activo", "tope": 40, "cada_dias": 3})
    with pytest.raises(ValueError):
        db.invitaciones_ajustar("activo", cada_dias=malo, nota="no")
    assert escritas == []


def test_el_esquema_trae_la_frecuencia_en_la_tabla_y_en_un_alter_idempotente():
    rango = f"CHECK (cada_dias BETWEEN 1 AND {inv.CADA_DIAS_MAXIMO})"
    i_tabla = next(i for i, s in enumerate(db.ESQUEMA)
                   if "CREATE TABLE IF NOT EXISTS invitaciones_interruptor" in s)
    altas = [(i, s) for i, s in enumerate(db.ESQUEMA)
             if s.startswith("ALTER TABLE invitaciones_interruptor")]
    assert all(i > i_tabla for i, _ in altas), "en una base nueva aún no habría tabla"
    assert rango in db.ESQUEMA[i_tabla] and "DEFAULT 1" in db.ESQUEMA[i_tabla]
    (_, columna), (_, quita), (_, pone) = altas
    assert "ADD COLUMN IF NOT EXISTS cada_dias int NOT NULL DEFAULT 1" in columna
    # dentro del ADD COLUMN, Postgres agregaría otro CHECK en cada migración
    assert "CHECK" not in columna
    assert "DROP CONSTRAINT IF EXISTS invitaciones_interruptor_cada_dias_check" in quita
    assert "ADD CONSTRAINT invitaciones_interruptor_cada_dias_check" in pone and rango in pone


def test_el_interruptor_devuelve_la_frecuencia(monkeypatch):
    vistas = []
    monkeypatch.setattr(db, "ejecutar", lambda sql, p=None: vistas.append(sql) or [{"cada_dias": 3}])
    assert db.invitaciones_interruptor()["cada_dias"] == 3
    assert "cada_dias" in vistas[0]


# --- la corrida

@pytest.mark.parametrize("modo", ["activo", "ensayo"])
def test_un_dia_sin_corrida_sale_callado(bot, modo):
    arma, cap = bot
    base = BaseFalsa(modo=modo, cada_dias=3, miembros=[miembro("n@x.com")],
                     envios=[envio("otro@x.com", 0, 1)])
    r = arma(base).correr(AHORA)
    assert r == {"modo": modo, "toca": False, "cada_dias": 3, "proxima": "2026-10-24"}
    assert cap["altas"] == [] and cap["publicado"] == [] and cap["pool_leido"] == []
    assert base.filas(resultado="ensayo") == [], "ni la tabla se toca"
    assert len(base.tabla) == 1


def test_un_dia_sin_corrida_deja_su_linea_en_el_log_sin_correos(bot, caplog):
    arma, _ = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")], envios=[envio("otro@x.com", 0, 1)])
    with caplog.at_level("INFO", logger="invitador"):
        arma(base).correr(AHORA)
    assert "hoy no toca (cada 3 días)" in caplog.text and "2026-10-24" in caplog.text
    assert "@x.com" not in caplog.text


@pytest.mark.parametrize("modo,cada,envios", [
    ("apagado", 1, []),
    ("activo", 3, [envio("otro@x.com", 0, 1)]),      # día sin corrida
    ("activo", 3, []),                               # día con corrida
    ("activo", 1, []),
])
def test_la_limpieza_de_la_pagina_corre_todos_los_dias(bot, modo, cada, envios):
    """La retención de los hashes de IP («unas 31 horas») depende de esto."""
    arma, _ = bot
    base = BaseFalsa(modo=modo, cada_dias=cada, envios=envios)
    arma(base).correr(AHORA)
    assert base.limpiezas == [inv.corte_del_dia(AHORA).isoformat()]


def test_el_dia_que_toca_manda_y_tres_dias_despues_otra_vez(bot):
    arma, cap = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")],
                     envios=[envio("otro@x.com", 0, 3)])
    r = arma(base).correr(AHORA)
    assert r["enviados"] == 1 and cap["altas"] == [("n@x.com", "anual", False)]
    assert len(cap["publicado"]) == 1
    assert "Próxima corrida estimada: 2026-10-25" in cap["publicado"][0][1]


def test_un_ensayo_de_ayer_no_retrasa_el_primer_envio_real(bot):
    arma, cap = bot
    base = BaseFalsa(modo="ensayo", cada_dias=3, miembros=[miembro("n@x.com")])
    invitador = arma(base)
    invitador.correr(AHORA)
    assert len(base.filas(resultado="ensayo")) == 1 and cap["altas"] == []
    base.fila_interruptor["modo"] = "activo"
    assert invitador.correr(AHORA + timedelta(days=1))["enviados"] == 1


def test_el_ensayo_con_frecuencia_corre_a_diario_hasta_el_primer_envio_real(bot):
    arma, cap = bot
    base = BaseFalsa(modo="ensayo", cada_dias=3, miembros=[miembro("n@x.com")])
    invitador = arma(base)
    for d in range(3):
        invitador.correr(AHORA + timedelta(days=d))
    assert len(cap["publicado"]) == 3


def test_una_corrida_sin_envios_se_reintenta_al_dia_siguiente(bot):
    arma, cap = bot
    invitador = arma(BaseFalsa(cada_dias=3))
    assert invitador.correr(AHORA)["enviados"] == 0
    assert "Próxima corrida estimada: 2026-10-23" in cap["publicado"][0][1]
    assert invitador.correr(AHORA + timedelta(days=1))["enviados"] == 0
    assert len(cap["publicado"]) == 2


def test_una_corrida_que_solo_dejo_fallos_se_reintenta_al_dia_siguiente(bot):
    arma, _ = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")])
    invitador = arma(base, errores={"n@x.com": _error("InternalErrorException")})
    assert invitador.correr(AHORA)["fallos"] == 1
    r = invitador.correr(AHORA + timedelta(days=1))
    assert r.get("toca") is not False and r["fallos"] == 1


@pytest.mark.parametrize("envios,toca", [([envio("otro@x.com", 0, 1)], False), ([], True)])
def test_el_interruptor_y_los_envios_se_leen_una_sola_vez(bot, monkeypatch, envios, toca):
    arma, _ = bot
    base = BaseFalsa(cada_dias=3, envios=envios)
    invitador = arma(base)
    lecturas = {"interruptor": 0, "envios": 0}

    def interruptor():
        lecturas["interruptor"] += 1
        return base.fila_interruptor

    def leer_envios():
        lecturas["envios"] += 1
        return base.envios()
    monkeypatch.setattr(db, "invitaciones_interruptor", interruptor)
    monkeypatch.setattr(db, "invitaciones_envios", leer_envios)
    r = invitador.correr(AHORA)
    assert ("toca" not in r) is toca
    assert lecturas == {"interruptor": 1, "envios": 1}


def test_si_la_base_falla_al_ver_si_toca_se_dice_y_no_se_manda(bot, monkeypatch):
    arma, cap = bot
    invitador = arma(BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")]))

    def revienta():
        raise _error("InternalServerErrorException")
    monkeypatch.setattr(db, "invitaciones_envios", revienta)
    with pytest.raises(Exception, match="InternalServerErrorException"):
        invitador.correr(AHORA)
    assert cap["altas"] == []
    assert "ABORTADO antes de empezar" in cap["publicado"][0][0]


# --- el resumen semanal

@pytest.mark.parametrize("cada,lunes_o_no,sale,titulo", [
    (1, LUNES, True, "Lunes: fríos"),
    (1, LUNES + timedelta(days=1), False, None),
    (3, LUNES + timedelta(days=1), True, "Fríos — recibieron R3"),
    (3, LUNES, True, "Lunes: fríos"),
])
def test_la_seccion_de_frios_con_frecuencia(bot, cada, lunes_o_no, sale, titulo):
    arma, cap = bot
    u = [usuario("frio@x.com", 40, 20, desde=LUNES)]
    # su R3 fue hace 20 días: con frecuencia, esta corrida sí toca
    e = [envio("frio@x.com", 3, 20, desde=LUNES)]
    arma(BaseFalsa(cada_dias=cada, miembros=[miembro("frio@x.com")], envios=e), u).correr(lunes_o_no)
    cuerpo = cap["publicado"][0][1]
    assert ("frio@x.com (último correo" in cuerpo) is sale
    if titulo:
        assert titulo in cuerpo


def test_un_lunes_sin_corrida_no_pierde_la_seccion_de_frios(bot):
    """Corrida el domingo, lunes callado, y la del miércoles los trae."""
    arma, cap = bot
    domingo = LUNES - timedelta(days=1)
    u = [usuario("frio@x.com", 40, 20, desde=LUNES)]
    e = [envio("frio@x.com", 3, 20, desde=LUNES), envio("otro@x.com", 0, 0, desde=domingo)]
    invitador = arma(BaseFalsa(cada_dias=3, miembros=[miembro("frio@x.com")], envios=e), u)
    assert invitador.correr(LUNES)["toca"] is False and cap["publicado"] == []
    invitador.correr(LUNES + timedelta(days=2))
    assert "frio@x.com (último correo" in cap["publicado"][0][1]


@pytest.mark.parametrize("cada", range(2, 8))
def test_hasta_7_dias_los_frios_salen_al_menos_cada_semana(cada):
    envios, salieron = [], []
    for d in range(60):
        ahora = LUNES + timedelta(days=d)
        if inv.toca_correr(cada, envios, ahora):
            envios.append({"origen": "bot", "resultado": "enviado", "creado": ahora.isoformat()})
            if inv.lleva_semanal(cada, ahora):
                salieron.append(d)
    assert max(b - a for a, b in zip(salieron, salieron[1:])) <= 7


def test_un_dia_a_diario_no_lleva_linea_de_frecuencia(bot):
    arma, cap = bot
    arma(BaseFalsa(miembros=[miembro("n@x.com")])).correr(AHORA)
    assert "Frecuencia:" not in cap["publicado"][0][1]


# --- tools/invitaciones.py

def _modo(monkeypatch, herramienta, *extra, previo="activo"):
    import sys
    vistos = {}

    def ajustar(modo, tope=None, cada_dias=None, nota=None):
        vistos.update(modo=modo, tope=tope, cada_dias=cada_dias)
        return {"modo": modo, "tope": 40, "cada_dias": cada_dias or 3, "nota": nota}
    monkeypatch.setattr(db, "invitaciones_ajustar", ajustar)
    monkeypatch.setattr(db, "invitaciones_interruptor",
                        lambda: previo and {"modo": previo, "tope": 40, "cada_dias": 3})
    monkeypatch.setattr(sys, "argv", ["invitaciones.py", "modo", "activo", "--nota", "x",
                                      "--cluster-arn", "c", "--secret-arn", "s", "--pool", POOL,
                                      *extra])
    herramienta.main()
    return vistos


def test_el_comando_modo_pasa_la_frecuencia_y_la_imprime(herramienta, monkeypatch, capsys):
    assert _modo(monkeypatch, herramienta, "--cada", "3")["cada_dias"] == 3
    assert "tope 40 · cada 3 días" in capsys.readouterr().out
    assert _modo(monkeypatch, herramienta, "--cada", "1")["cada_dias"] == 1
    assert "tope 40 · a diario" in capsys.readouterr().out


def test_el_comando_modo_sin_cada_hereda(herramienta, monkeypatch, capsys):
    assert _modo(monkeypatch, herramienta)["cada_dias"] is None
    assert "cada 3 días" in capsys.readouterr().out, "lo que imprime es lo que quedó en la fila"


@pytest.mark.parametrize("malo", ["0", "15"])
def test_el_comando_modo_rechaza_una_frecuencia_fuera_de_rango(herramienta, monkeypatch, malo, capsys):
    with pytest.raises(SystemExit):
        _modo(monkeypatch, herramienta, "--cada", malo)
    assert "--cada entre 1 y 14" in capsys.readouterr().err


def test_el_aviso_del_modo_con_frecuencia(herramienta):
    assert herramienta.aviso_del_modo({"modo": "activo", "tope": 40, "cada_dias": 3}) is None
    assert herramienta.aviso_del_modo({"modo": "activo", "tope": 40, "cada_dias": 7}) is None
    aviso = herramienta.aviso_del_modo({"modo": "activo", "tope": 40, "cada_dias": 8})
    assert "menos de una vez por semana" in aviso and "también mañana" not in aviso
    assert "la clave provisional dura 7 días" in aviso
    aviso = herramienta.aviso_del_modo({"modo": "activo", "tope": 0, "cada_dias": 8})
    assert "también mañana" in aviso and "menos de una vez por semana" in aviso


def test_hoy_dice_que_no_toca_y_sigue_ensenando_la_seleccion(bot, herramienta, capsys):
    arma, cap = bot
    ayer = datetime.now(UTC) - timedelta(days=1)
    arma(BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")],
                   envios=[envio("otro@x.com", 0, 0, desde=ayer)]))
    herramienta.hoy(POOL, None)
    salida = capsys.readouterr().out
    assert "Frecuencia: cada 3 días." in salida and "NO corre (la última con envíos" in salida
    assert "Esto es lo que mandaría si corriera ahora:" in salida and "n@x.com" in salida
    assert cap["publicado"] == [] and cap["altas"] == []


def test_hoy_dice_que_si_toca(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    invitador = arma(BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")]))
    _a_las(monkeypatch, invitador, AHORA - timedelta(hours=1))
    herramienta.hoy(POOL, None)
    salida = capsys.readouterr().out
    assert ("Frecuencia: cada 3 días. La siguiente salida del reloj (2026-10-22 10:00 hora "
            "centro) SÍ corre.") in salida and "n@x.com" in salida
    assert "si corriera" not in salida


def test_estado_dice_la_frecuencia_y_la_proxima_fecha(bot, herramienta, capsys):
    arma, _ = bot
    ayer = datetime.now(UTC) - timedelta(days=1)
    envios = [envio("otro@x.com", 0, 0, desde=ayer)]
    arma(BaseFalsa(cada_dias=3, envios=envios))
    herramienta.estado(POOL, None)
    salida = capsys.readouterr().out
    esperada = inv.corte_del_dia(ayer) + timedelta(days=3)
    assert "Interruptor: activo · tope 40 · cada 3 días" in salida
    assert f"Próxima estimada: {esperada:%Y-%m-%d} 10:00 hora centro" in salida


def test_estado_a_diario(bot, herramienta, capsys):
    arma, _ = bot
    arma(BaseFalsa())
    herramienta.estado(POOL, None)
    assert "tope 40 · a diario" in capsys.readouterr().out


# --- la serie 3/7/14 con corridas espaciadas, con el código real

def _serie(cada, *, con_cola, dias=30):
    """→ {paso: día en que le salió a la persona invitada el día 0}. `con_cola`: cada
    corrida trae a alguien nuevo que invitar, así que todas mandan algo y caen en 0, 3,
    6, 9… Sin cola, una corrida sin envíos no cuenta y se reintenta al día siguiente.
    El cupo aquí es de sobra: con el real y mucha gente, ver `_calendario`."""
    miembros, usuarios, envios, salio = [miembro("a@x.com")], [], [], {}
    for d in range(dias):
        ahora = AHORA + timedelta(days=d)
        if not inv.toca_correr(cada, envios, ahora):
            continue
        if con_cola:
            miembros.append(miembro(f"cola{d}@x.com"))
        for e in inv.elegir_del_dia(miembros, usuarios, envios, ahora, 1000):
            # la fila y Cognito quedan unos segundos después del reloj
            cuando = ahora + timedelta(seconds=5)
            envios.append({"correo": e.correo, "paso": e.paso, "origen": "bot",
                           "resultado": "enviado", "creado": cuando.isoformat()})
            if e.paso == 0:
                usuarios.append({"correo": e.correo, "estado": "FORCE_CHANGE_PASSWORD",
                                 "habilitado": True, "creado": cuando, "modificado": cuando})
            else:
                next(u for u in usuarios if u["correo"] == e.correo)["modificado"] = cuando
            if e.correo == "a@x.com":
                salio[e.paso] = d
    return salio


def test_la_serie_a_diario_es_3_7_14():
    assert _serie(1, con_cola=True) == {0: 0, 1: 3, 2: 7, 3: 14}


def test_la_serie_con_corridas_cada_3_dias_es_3_9_18():
    """El diseño esperaba R3 en el día 15, y el código real da el 18: el día 15 ya
    pasaron los 14 desde la invitación, pero R2 salió el 9 y solo van 6 de los 7 días
    que DIAS_DESDE_ULTIMO pide desde el último correo. Las constantes no se tocan. Vale
    solo si todo cabe en el cupo: `test_con_cola_real_la_serie_se_atrasa...`."""
    assert inv.DIAS_DESDE_INVITACION == {1: 3, 2: 7, 3: 14}
    assert inv.DIAS_DESDE_ULTIMO == {1: 3, 2: 4, 3: 7}
    assert _serie(3, con_cola=True) == {0: 0, 1: 3, 2: 9, 3: 18}


def test_sin_cola_los_reintentos_diarios_devuelven_la_serie_a_3_7_14():
    """Sin nadie más a quien escribirle, las corridas vacías no cuentan: el bot se
    reintenta a diario a partir del tercer día y alcanza a cada paso en su fecha."""
    assert _serie(3, con_cola=False) == {0: 0, 1: 3, 2: 7, 3: 14}


def test_el_runbook_dice_la_frecuencia():
    doc = (REPO / "docs" / "OPERACION.md").read_text(encoding="utf-8")
    assert "modo activo --tope 40 --cada 3" in doc and "modo activo --cada 1" in doc
    assert "**hasta 35 por corrida**" in doc
    assert "Un día sin ningún correo del invitador quiere decir\n`apagado`, no" not in doc
    # el primer modo activo del orden de encendido ya es con la frecuencia de prueba
    orden = doc[doc.index("### El orden para encenderlo"):doc.index("## Reglas que no se negocian")]
    assert "modo activo --tope 40 --cada 3" in orden
    assert "cada_dias" in orden


# --- con el cupo real: 35 por corrida y la cola que de verdad haya

def _calendario(cada, *, pendientes=0, altas_al_dia=0, dias=130):
    """→ {correo: {paso: día}} con el cupo real del bot (tope 40) y nadie entra. Es lo
    que `_serie` no puede ver: ahí el cupo es de 1000 y entra un alta por corrida."""
    miembros = [miembro(f"p{i:03d}@x.com") for i in range(pendientes)]
    usuarios, envios, salio = {}, [], {}
    for d in range(dias):
        miembros += [miembro(f"a{d}-{j}@x.com") for j in range(altas_al_dia)]
        ahora = AHORA + timedelta(days=d)
        if not inv.toca_correr(cada, envios, ahora):
            continue
        for e in inv.elegir_del_dia(miembros, list(usuarios.values()), envios, ahora,
                                    inv.cupo_bot(40, 0)):
            cuando = ahora + timedelta(seconds=5)
            envios.append({"correo": e.correo, "paso": e.paso, "origen": "bot",
                           "resultado": "enviado", "creado": cuando.isoformat()})
            if e.paso == 0:
                usuarios[e.correo] = {"correo": e.correo, "estado": "FORCE_CHANGE_PASSWORD",
                                      "habilitado": True, "creado": cuando, "modificado": cuando}
            else:
                usuarios[e.correo]["modificado"] = cuando
            salio.setdefault(e.correo, {})[e.paso] = d
    return salio


@pytest.mark.parametrize("pendientes,a_diario,cada_3", [
    (35, [0, 3, 7, 14], [0, 3, 7, 14]),
    (50, [0, 3, 7, 14], [0, 3, 9, 16]),
    (100, [0, 3, 7, 14], [0, 6, 15, 24]),
    (200, [0, 5, 11, 18], [0, 15, 33, 51]),
    (400, [0, 11, 22, 34], [0, 33, 66, 102]),
])
def test_con_cola_real_la_serie_se_atrasa_y_el_runbook_lo_dice(pendientes, a_diario, cada_3):
    """Invitaciones primero y 35 por corrida: 3/9/18 solo vale si todo cabe."""
    doc = (REPO / "docs" / "OPERACION.md").read_text(encoding="utf-8")
    for cada, esperada in ((1, a_diario), (3, cada_3)):
        salio = _calendario(cada, pendientes=pendientes)["p000@x.com"]
        assert [salio[p] for p in range(4)] == esperada
        assert "/".join(map(str, esperada)) in doc


@pytest.mark.parametrize("altas,cada,invitados,r1,r2,r3", [
    (3, 3, 300, 300, 300, 300),         # dentro de las 2.9 personas al día, por poco
    (4, 3, 400, 400, 400, 0),
    (5, 3, 500, 500, 235, 0),
    (12, 3, 1167, 0, 0, 0),
    (4, 1, 400, 400, 400, 400),         # a diario, las mismas 4 altas sí llegan a R3
])
def test_con_altas_constantes_un_recordatorio_puede_no_salir_nunca(altas, cada, invitados, r1, r2, r3):
    salio = _calendario(cada, altas_al_dia=altas, dias=150)
    tempranos = [v for v in salio.values() if 0 in v and v[0] < 100]
    assert len(tempranos) == invitados
    assert [sum(p in v for v in tempranos) for p in (1, 2, 3)] == [r1, r2, r3]


def test_el_recordatorio_sabe_cuantos_dias_lleva_vencido():
    m = [miembro("v@x.com")]
    # R1 pide 3 días: a los 10 lleva 7 de retraso
    assert [e.atraso for e in inv.candidatos(m, [usuario("v@x.com", 10)], [], AHORA)] == [7]
    # R2: 20 desde la invitación (pide 7) pero 6 desde el R1 (pide 4); manda la que se cumplió al último
    u, e = [usuario("v@x.com", 20, 6)], [envio("v@x.com", 1, 6)]
    assert [(c.paso, c.atraso) for c in inv.candidatos(m, u, e, AHORA)] == [(2, 2)]
    # en su fecha, y una invitación: sin retraso
    assert [e.atraso for e in inv.candidatos(m, [usuario("v@x.com", 3)], [], AHORA)] == [0]
    assert [e.atraso for e in inv.candidatos(m, [], [], AHORA)] == [0]
    # una cuenta sin fechas no se puede medir
    sin_fechas = {"correo": "v@x.com", "estado": "FORCE_CHANGE_PASSWORD", "habilitado": True,
                  "creado": None, "modificado": None}
    assert [e.atraso for e in inv.candidatos(m, [sin_fechas], [], AHORA)] == [0]


def _con_cola_y_recordatorios_atrasados():
    nuevos = [miembro(f"n{i:02d}@x.com") for i in range(35)]
    return (BaseFalsa(miembros=nuevos + [miembro("v@x.com"), miembro("w@x.com")]),
            [usuario("v@x.com", 10), usuario("w@x.com", 4)])


def test_el_resumen_dice_cuanto_lleva_el_recordatorio_mas_atrasado(bot):
    arma, cap = bot
    base, usuarios = _con_cola_y_recordatorios_atrasados()
    arma(base, usuarios).correr(AHORA)
    cuerpo = cap["publicado"][0][1]
    assert "Esperan cupo para otro día: 2 R1. El recordatorio más atrasado lleva 7 días de retraso." in cuerpo


def test_sin_recordatorios_atrasados_el_resumen_no_habla_de_retraso(bot):
    arma, cap = bot
    arma(BaseFalsa(miembros=[miembro(f"n{i:02d}@x.com") for i in range(40)])).correr(AHORA)
    cuerpo = cap["publicado"][0][1]
    assert "Esperan cupo para otro día: 5 invitación." in cuerpo and "retraso" not in cuerpo


def test_un_solo_dia_de_retraso_va_en_singular():
    e = inv.Elegido("v@x.com", 1, "anual", "v", "R1", atraso=1)
    assert inv.frase_de_atraso([e]) == " El recordatorio más atrasado lleva 1 día de retraso."
    assert inv.frase_de_atraso([]) == ""


def _a_las(monkeypatch, invitador, ahora):
    """`hoy` y `estado` toman la foto con el reloj de verdad: aquí, a una hora fija."""
    real = invitador.tomar_foto
    monkeypatch.setattr(invitador, "tomar_foto", lambda pool, hermano=None: real(pool, hermano, ahora))


def test_hoy_tambien_dice_el_retraso(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    base, usuarios = _con_cola_y_recordatorios_atrasados()
    _a_las(monkeypatch, arma(base, usuarios), AHORA)
    herramienta.hoy(POOL, None)
    assert ("Y 2 más esperan cupo para otro día. El recordatorio más atrasado lleva 7 días "
            "de retraso.") in capsys.readouterr().out


# --- la clave provisional dura 7 días y la frecuencia puede pasarse de eso

def test_el_modo_avisa_que_con_mas_de_una_semana_toda_clave_se_vence(herramienta):
    aviso = herramienta.aviso_del_modo({"modo": "activo", "tope": 40, "cada_dias": 8})
    assert "la clave provisional dura 7 días" in aviso and "/acceso" in aviso
    assert herramienta.aviso_del_modo({"modo": "activo", "tope": 40, "cada_dias": 7}) is None


@pytest.mark.parametrize("cada,serie,vencida", [
    (1, [0, 3, 7, 14], 0), (2, [0, 4, 8, 16], 1), (3, [0, 3, 9, 18], 2), (5, [0, 5, 10, 20], 3),
])
def test_cuantos_dias_queda_vencida_la_clave_y_el_runbook_lo_dice(cada, serie, vencida):
    """Corridas que siempre mandan algo (una alta al día); los 7 días son los de la plantilla."""
    salio = _calendario(cada, pendientes=1, altas_al_dia=1, dias=40)["p000@x.com"]
    assert [salio[p] for p in range(4)] == serie
    assert max(0, max(b - a for a, b in zip(serie, serie[1:])) - 7) == vencida


# --- lo que el resumen promete es lo que `toca_correr` va a decidir

def _marcar_que_falla(monkeypatch):
    def marcar(id_, resultado, detalle=None):
        raise _error("InternalServerErrorException")
    monkeypatch.setattr(db, "invitaciones_marcar", marcar)


def test_una_fila_que_quedo_en_enviando_cuenta_en_la_proxima_del_resumen(bot, monkeypatch):
    """Cognito falla y la base también: ninguno salió, pero la fila viva frena 3 días."""
    arma, cap = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")])
    invitador = arma(base, errores={"n@x.com": _error("InternalErrorException")})
    _marcar_que_falla(monkeypatch)
    r = invitador.correr(AHORA)
    assert r["enviados"] == 0 and "quedó en 'enviando'" in r["abortado"]
    assert "Próxima corrida estimada: 2026-10-25" in cap["publicado"][0][1]
    siguiente = invitador.correr(AHORA + timedelta(days=1))
    assert siguiente["toca"] is False and siguiente["proxima"] == "2026-10-25"


def test_un_fallo_bien_marcado_no_tapa_un_envio_de_antes_en_la_misma_corrida(bot):
    arma, cap = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("a@x.com"), miembro("b@x.com")])
    invitador = arma(base, errores={"b@x.com": _error("InternalErrorException")})
    assert invitador.correr(AHORA)["enviados"] == 1
    assert "Próxima corrida estimada: 2026-10-25" in cap["publicado"][0][1]


@pytest.mark.parametrize("codigo", ["InternalErrorException", "UsernameExistsException"])
def test_un_fallo_bien_marcado_se_reintenta_mañana_y_el_resumen_lo_dice(bot, codigo):
    arma, cap = bot
    base = BaseFalsa(cada_dias=3, miembros=[miembro("n@x.com")])
    arma(base, errores={"n@x.com": _error(codigo)}).correr(AHORA)
    assert "Próxima corrida estimada: 2026-10-23" in cap["publicado"][0][1]
    assert base.filas(resultado="enviando") == []


# --- la corrida que cuenta aunque no terminó: cómo reintentar

def _seis():
    return [miembro(f"n{i}@x.com") for i in range(6)]


def test_el_aborto_que_cuenta_dice_como_reintentar_y_la_receta_funciona(bot):
    arma, cap = bot
    errores = {f"n{i}@x.com": _error("InternalErrorException") for i in (1, 2, 3)}
    base = BaseFalsa(cada_dias=3, miembros=_seis())
    invitador = arma(base, errores=errores)
    r = invitador.correr(AHORA)
    assert r["enviados"] == 1 and "3 fallos seguidos" in r["abortado"]
    cuerpo = cap["publicado"][0][1]
    assert 'tools/invitaciones.py modo activo --cada 1 --nota "reintento"' in cuerpo
    assert "de vuelta a --cada 3" in cuerpo
    assert invitador.correr(AHORA + timedelta(days=1))["toca"] is False
    # lo que dice el resumen: a diario, y mañana mismo salen los que faltaban
    errores.clear()
    base.fila_interruptor["cada_dias"] = 1
    assert invitador.correr(AHORA + timedelta(days=1))["enviados"] == 5


def test_el_aborto_sin_nada_vivo_no_pide_forzar_porque_mañana_reintenta(bot):
    arma, cap = bot
    errores = {f"n{i}@x.com": _error("InternalErrorException") for i in range(3)}
    arma(BaseFalsa(cada_dias=3, miembros=_seis()), errores=errores).correr(AHORA)
    cuerpo = cap["publicado"][0][1]
    assert "ABORTADO" in cuerpo and "--cada 1" not in cuerpo
    assert "Próxima corrida estimada: 2026-10-23" in cuerpo


def test_a_diario_el_aborto_no_lleva_la_receta(bot):
    arma, cap = bot
    errores = {f"n{i}@x.com": _error("InternalErrorException") for i in (1, 2, 3)}
    arma(BaseFalsa(miembros=_seis()), errores=errores).correr(AHORA)
    assert "--cada 1" not in cap["publicado"][0][1]


def test_si_la_pagina_agota_el_cupo_tras_un_envio_tambien_dice_como_reintentar(bot, monkeypatch):
    arma, cap = bot
    base = BaseFalsa(cada_dias=3, miembros=_seis())
    invitador = arma(base)
    original, llamadas = base.reclamar, []

    def reclamar(correo, paso, detalle=None, **kw):
        llamadas.append(correo)
        return (None, "sin_cupo") if len(llamadas) > 1 else original(correo, paso, detalle, **kw)
    monkeypatch.setattr(db, "invitaciones_reclamar", reclamar)
    r = invitador.correr(AHORA)
    assert r["enviados"] == 1 and r["cupo_agotado"] == 5 and r["abortado"] is None
    assert '--cada 1 --nota "reintento"' in cap["publicado"][0][1]


# --- `hoy` y `estado` no prometen lo que no va a pasar

def _linea(arma, herramienta, ahora, **kw):
    invitador = arma(BaseFalsa(**kw))
    return herramienta._linea_de_hoy(invitador.tomar_foto(POOL, ahora=ahora))


@pytest.mark.parametrize("kw", [
    {"modo": None}, {"modo": "apagado", "cada_dias": 3},
    {"modo": "apagado", "cada_dias": 3, "envios": [envio("o@x.com", 0, 1)]},
])
def test_apagado_no_dice_que_toca_ni_da_proxima_fecha(bot, herramienta, kw):
    arma, _ = bot
    linea = _linea(arma, herramienta, AHORA, **kw)
    assert "no corre hasta que muevas el modo" in linea
    assert "SÍ" not in linea and "Próxima" not in linea and "salida del reloj" not in linea


def test_con_tope_cero_no_dice_que_toca(bot, herramienta):
    arma, _ = bot
    linea = _linea(arma, herramienta, AHORA, tope=0, cada_dias=3)
    assert "Tope 0: no sale ningún correo" in linea and "SÍ" not in linea


@pytest.mark.parametrize("cada,dias,ahora,esperada", [
    # a diario, antes del reloj y después
    (1, None, AHORA - timedelta(hours=1), "La siguiente salida del reloj (2026-10-22 10:00 hora centro) SÍ corre."),
    (1, None, AHORA + timedelta(hours=2),
     "El reloj de hoy ya pasó. La siguiente salida del reloj (2026-10-23 10:00 hora centro) SÍ corre."),
    # 01:00 hora centro del día que toca: el día de Cognito aún es el anterior
    (3, 3, AHORA - timedelta(hours=9), "La siguiente salida del reloj (2026-10-22 10:00 hora centro) SÍ corre."),
    # corrida de hoy sin envíos: el reloj ya pasó y mañana se reintenta
    (3, None, AHORA + timedelta(hours=2),
     "El reloj de hoy ya pasó. La siguiente salida del reloj (2026-10-23 10:00 hora centro) SÍ corre."),
])
def test_la_linea_habla_de_la_siguiente_salida(bot, herramienta, cada, dias, ahora, esperada):
    arma, _ = bot
    envios = [] if dias is None else [envio("o@x.com", 0, dias)]
    assert esperada in _linea(arma, herramienta, ahora, cada_dias=cada, envios=envios)


def test_la_linea_de_un_dia_sin_corrida_da_la_proxima(bot, herramienta):
    arma, _ = bot
    # hoy salieron correos, a las 18:00 UTC: el reloj ya pasó y tampoco mañana corre
    linea = _linea(arma, herramienta, AHORA + timedelta(hours=2), cada_dias=3,
                   envios=[envio("o@x.com", 0, 0)])
    assert "El reloj de hoy ya pasó." in linea
    assert "(2026-10-23 10:00 hora centro) NO corre (la última con envíos fue el 2026-10-22)" in linea
    assert "Próxima estimada: 2026-10-25 10:00 hora centro" in linea


def test_estado_apagado_no_promete_nada(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    invitador = arma(BaseFalsa(modo="apagado", cada_dias=3, miembros=[miembro("n@x.com")]))
    _a_las(monkeypatch, invitador, AHORA - timedelta(hours=1))
    herramienta.estado(POOL, None)
    salida = capsys.readouterr().out
    assert "Interruptor: apagado" in salida and "no corre hasta que muevas el modo" in salida
    assert "SÍ corre" not in salida and "Próxima estimada" not in salida
    assert "tocarían 1 (1 cabrían)" in salida and "caben hoy" not in salida


def test_estado_sin_interruptor_no_promete_nada(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    _a_las(monkeypatch, arma(BaseFalsa(modo=None)), AHORA)
    herramienta.estado(POOL, None)
    salida = capsys.readouterr().out
    assert "nunca se puso (APAGADO)" in salida and "SÍ corre" not in salida


@pytest.mark.parametrize("cada,dias,ahora,caben", [
    (1, None, AHORA - timedelta(hours=1), True),      # aún no suena el reloj de hoy
    (1, None, AHORA + timedelta(hours=2), False),     # ya sonó
    (3, 1, AHORA - timedelta(hours=1), False),        # hoy no toca
    (3, 3, AHORA - timedelta(hours=9), False),        # toca, pero en el siguiente día de Cognito
])
def test_estado_solo_dice_caben_hoy_si_hoy_aun_va_a_correr(bot, herramienta, capsys, monkeypatch,
                                                           cada, dias, ahora, caben):
    arma, _ = bot
    envios = [] if dias is None else [envio("o@x.com", 0, dias)]
    invitador = arma(BaseFalsa(cada_dias=cada, miembros=[miembro("n@x.com")], envios=envios))
    _a_las(monkeypatch, invitador, ahora)
    herramienta.estado(POOL, None)
    salida = capsys.readouterr().out
    assert ("tocan 1 (1 caben hoy)" in salida) is caben
    assert ("tocarían 1 (1 cabrían)" in salida) is not caben


def test_hoy_con_el_reloj_ya_pasado_dice_que_es_lo_que_mandaria(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    _a_las(monkeypatch, arma(BaseFalsa(miembros=[miembro("n@x.com")])), AHORA + timedelta(hours=2))
    herramienta.hoy(POOL, None)
    salida = capsys.readouterr().out
    assert "El reloj de hoy ya pasó." in salida
    assert "Esto es lo que mandaría si corriera ahora:" in salida and "n@x.com" in salida


def test_hoy_apagado_no_repite_el_encabezado(bot, herramienta, capsys, monkeypatch):
    arma, _ = bot
    _a_las(monkeypatch, arma(BaseFalsa(modo="apagado", miembros=[miembro("n@x.com")])), AHORA)
    herramienta.hoy(POOL, None)
    salida = capsys.readouterr().out
    assert "El bot está APAGADO" in salida and "si corriera ahora" not in salida


# --- `modo` también enciende: que se note

@pytest.mark.parametrize("previo,esperado", [
    ("apagado", "OJO: el modo cambió de apagado a activo"),
    ("ensayo", "OJO: el modo cambió de ensayo a activo"),
    (None, "OJO: el modo cambió de apagado a activo"),      # sin fila está apagado
])
def test_el_comando_modo_avisa_si_enciende_el_bot(herramienta, monkeypatch, capsys, previo, esperado):
    _modo(monkeypatch, herramienta, "--cada", "3", previo=previo)
    salida = capsys.readouterr().out
    assert esperado in salida and "salen correos reales" in salida


def test_el_comando_modo_no_avisa_si_el_modo_no_cambio(herramienta, monkeypatch, capsys):
    _modo(monkeypatch, herramienta, "--cada", "3", previo="activo")
    assert "cambió" not in capsys.readouterr().out


def test_bajar_el_modo_lo_dice_sin_alarma(herramienta):
    aviso = herramienta.cambio_de_modo({"modo": "activo"}, {"modo": "apagado"})
    assert aviso == "El modo cambió de activo a apagado."


# --- el runbook

def test_el_runbook_no_promete_3_9_18_con_cola_y_da_las_salidas():
    import re
    doc = (REPO / "docs" / "OPERACION.md").read_text(encoding="utf-8")
    frecuencia = doc[doc.index("### La frecuencia"):doc.index("### El resumen")]
    assert "Con cola de verdad, no es 3/9/18" in frecuencia
    assert "2.9 personas al día" in frecuencia
    assert "**Un recordatorio puede no salir nunca mientras haya cola.**" in frecuencia
    assert "entre el día 33 y el 45" in frecuencia
    # la clave se vence entre correos
    assert "**La clave provisional dura 7 días" in frecuencia and "/acceso" in frecuencia
    # el comando de la frecuencia también enciende
    assert "también fija el modo" in frecuencia and "modo ensayo --cada 3 --nota" in frecuencia
    # cómo forzar una corrida, y qué pasa sin eso
    assert "`toca: false`" in frecuencia
    assert 'modo activo --cada 1 --nota "reintento tras el aborto"' in frecuencia
    assert 'modo activo --cada 3 --nota "de vuelta a la prueba"' in frecuencia
    # todo comando de la frecuencia se puede copiar tal cual: `modo` exige --nota
    comandos = (re.findall(r"^venv/Scripts/python tools/invitaciones\.py modo .*$", doc, re.M)
                + re.findall(r"`modo \w+ [^`\n]*--cada[^`\n]*`", doc))
    assert comandos and all("--nota" in c for c in comandos), comandos
    orden = doc[doc.index("### El orden para encenderlo"):doc.index("## Reglas que no se negocian")]
    assert 'modo activo --cada 1 --nota "ya hay videos: a diario"' in orden
    assert "`toca: false`" in orden
