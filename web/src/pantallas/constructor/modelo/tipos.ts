// Los tipos del dominio del Constructor de automatizaciones. Solo tipos: aquí no
// corre nada (el motor puro vive en este mismo directorio; ver docs/migracion/constructor.md).
//
// El archivo está en secciones para que quien agregue acciones o estado (el reductor)
// lo amplíe sin tocar lo demás:
//   1. El flujo: nodos, aristas y la regla de enlace.
//   2. Catálogo: lo que sabemos de n8n (IA, disparadores, apps).
//   3. Lo que el lienzo recuerda: menú, conexión en curso, foco, aviso, Deshacer.
//   4. El estado completo del Constructor.
//   5. Acciones (las agrega el reductor).
//   6. Ejemplos y muestras.

// ---------------------------------------------------------------- 1. el flujo

/** Cómo arranca un flujo: a una hora, con un mensaje de chat, con un aviso web o con algo que pasa en una app. */
export type TipoDisparador = 'tiempo' | 'chat' | 'web' | 'app';

/** Cada cuánto corre un disparador de tiempo. Cualquier otro valor se trata como «dia». */
export type Frecuencia = 'hora' | 'dia' | 'lunes';

/** La app que dispara cuando el disparador es de tipo `app`. */
export type AppDisparador = 'gmail' | 'telegram';

/** Los cuatro proveedores de IA que se ofrecen. */
export type IdIA = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

/**
 * Cómo se conectan dos cuadros:
 * `seq` = un solo sentido (el de arriba termina y le pasa su respuesta al siguiente);
 * `tool` = ida y vuelta (un agente consulta una app, o conversa con otra IA, y recibe lo que responde).
 */
export type TipoArista = 'seq' | 'tool';

/** Lo que tienen en común todos los cuadros del lienzo. */
interface NodoBase {
  /** Único en el flujo: `t<n>` disparador, `a<n>` agente, `p<n>` app. */
  id: string;
  /** Esquina superior izquierda en px de lienzo, entre 0 y 2400. Al mover se acomoda a la rejilla de 8; los ejemplos traen y=180 y y=380. */
  x: number;
  y: number;
}

/** El cuadro con el que arranca el flujo. Como máximo hay uno. */
export interface NodoDisparador extends NodoBase {
  kind: 'trigger';
  /** Qué tipo de disparador es. */
  tipo: TipoDisparador;
  /** Solo importa con `tipo: 'tiempo'`. Los tres campos que no se usan se CONSERVAN al cambiar de tipo. */
  frec: Frecuencia;
  /** Solo importa con `tipo: 'web'`: el trozo del enlace del webhook (se limpia al exportar). */
  ruta: string;
  /** Solo importa con `tipo: 'app'`. */
  app: AppDisparador;
}

/** Un agente de IA. Si cuelga de otro agente por una arista `tool`, es un «ayudante» que conversa con él. */
export interface NodoAgente extends NodoBase {
  kind: 'agent';
  /** Cómo se llama el agente (texto libre; aparece en el lienzo y en el nombre del nodo de n8n). */
  nombre: string;
  /** Qué proveedor de IA usa. */
  ia: IdIA;
  /** Qué debe hacer cada vez que corre el flujo. Vacío es válido salvo tras un disparador que no sea chat. */
  tarea: string;
  /** Las instrucciones de fondo del agente (el «mensaje de sistema»). */
  instrucciones: string;
  /** Para qué le sirve a su agente principal. Solo importa si es ayudante; ahí es obligatoria. */
  desc?: string;
}

/** Una app (Gmail, Slack…). Es un paso del flujo o, si cuelga de un agente por `tool`, su herramienta. */
export interface NodoApp extends NodoBase {
  kind: 'app';
  /** Texto libre. Si coincide con una app del catálogo hay conector listo; si no, sale un HTTP Request. */
  nombre: string;
}

/** Cualquier cuadro del lienzo; se distingue por `kind`. */
export type Nodo = NodoDisparador | NodoAgente | NodoApp;

/** Una conexión entre dos cuadros. */
export interface Arista {
  /** `e<n>`, único en el flujo. */
  id: string;
  /** Desde dónde sale (en `tool`, siempre un agente). */
  de: string;
  /** A dónde llega. */
  a: string;
  /** Un solo sentido o ida y vuelta. */
  tipo: TipoArista;
}

/** El flujo completo: lo que se guarda en el borrador y lo que se exporta a n8n. */
export interface Flujo {
  /** Los cuadros, en el orden en que se crearon. */
  nodes: Nodo[];
  /** Las conexiones. */
  edges: Arista[];
  /** El nombre que lleva el archivo de n8n (hasta 80 caracteres). */
  nombreFlujo: string;
}

/** Una posición en el lienzo, en px. */
export interface Punto {
  x: number;
  y: number;
}

/** El resultado de preguntar «¿se puede?»: sí, o no con el motivo escrito para la persona. */
export type Resultado = { ok: true } | { ok: false; motivo: string };

// ---------------------------------------------------------------- 2. catálogo

/** Un valor que cabe en el JSON de n8n. */
export type ValorJson = string | number | boolean | null | ValorJson[] | { [clave: string]: ValorJson };

/** Los `parameters` de un nodo de n8n. */
export interface ParametrosN8n {
  [clave: string]: ValorJson;
}

/** Cómo se llama una credencial en n8n y con qué nombre se muestra (`{ id: '', name }` al exportar). */
export interface CredencialN8n {
  /** El nombre técnico de la credencial en el nodo (p. ej. `gmailOAuth2`). */
  clave: string;
  /** El nombre que ve la persona al conectarla (p. ej. `Gmail`). */
  nombre: string;
}

/** Un proveedor de IA y el nodo de «modelo de chat» de n8n que lo representa. */
export interface DefIA {
  id: IdIA;
  /** Cómo se llama en la lista de opciones. */
  nombre: string;
  /** Una frase que dice qué hace falta para usarlo. */
  detalle: string;
  /** El `type` del nodo de n8n. */
  tipo: string;
  /** El `typeVersion` (el que n8n trae por defecto en el catálogo). */
  version: number;
  /** El nombre base del nodo en el flujo («OpenAI Chat Model»). */
  nodo: string;
  /** La credencial que pide el nodo. */
  cred: CredencialN8n;
  /** Los `parameters` del nodo. Cada llamada devuelve un objeto NUEVO: nadie comparte referencias con el catálogo. */
  params: () => ParametrosN8n;
}

/** Un ícono por nombre (los de `ui/iconos.ts`); el motor no pinta nada. */
export type IconoDisparador = 'reloj' | 'chat' | 'web' | 'app';

/** Un tipo de disparador, tal como se ofrece en la tarjeta de «Elige cómo arranca tu flujo». */
export interface DefTipoDisparador {
  id: TipoDisparador;
  nombre: string;
  /** Una frase que lo explica. */
  detalle: string;
  icono: IconoDisparador;
}

/** Una opción de frecuencia para el disparador de tiempo. */
export interface DefFrecuencia {
  id: Frecuencia;
  /** El texto de la opción del selector («Cada día a las 9:00»). */
  opcion: string;
  /** El texto corto que se ve en el cuadro («Cada día, 9:00»). */
  corto: string;
}

/** Una app que puede iniciar el flujo (disparador de tipo `app`). */
export interface DefAppDisparador {
  id: AppDisparador;
  /** El texto de la opción del selector. */
  opcion: string;
  /** El texto corto que se ve en el cuadro. */
  detalle: string;
}

/** Cómo se exporta cada variante de disparador a n8n. */
export interface DefDisparadorN8n {
  /** El `type` del nodo de n8n. */
  tipo: string;
  /** El `typeVersion`. */
  version: number;
  /** El nombre base del nodo en el flujo («Schedule Trigger»). */
  nombreBase: string;
  /** La credencial que pide, si pide. */
  cred: CredencialN8n | null;
  /** Si el nodo lleva `webhookId` (chat y web). */
  conWebhookId: boolean;
  /** Si el flujo lleva `settings.timezone` (solo el disparador de tiempo). */
  conZona: boolean;
  /** Los `parameters` para ESTE disparador (dependen de su frecuencia o de su ruta). Objeto nuevo en cada llamada. */
  params: (nodo: NodoDisparador) => ParametrosN8n;
}

/** Una app con conector listo en n8n. */
export interface DefApp {
  /** El nombre con que se ofrece («Google Sheets», «Correo (SMTP)»). */
  nombre: string;
  /** Otros nombres con que la persona puede escribirla, ya normalizados (`norm`). */
  alias: readonly string[];
  /** El `type` del nodo de n8n cuando la app es un paso del flujo. */
  tipo: string;
  /** El `type` cuando es herramienta de un agente (`tipo` + `Tool`). */
  tipoHerramienta: string;
  /** El `typeVersion`. */
  version: number;
  /** La credencial que pide el nodo. */
  cred: CredencialN8n;
  /** Los `parameters` como PASO (recibe la respuesta del agente). Objeto nuevo en cada llamada. */
  paramsPaso: () => ParametrosN8n;
  /** Los `parameters` como HERRAMIENTA (el agente decide con `$fromAI`). Objeto nuevo en cada llamada. */
  paramsHerramienta: () => ParametrosN8n;
}

/** El nodo de reserva para una app que no está en el catálogo: un HTTP Request que la persona configura en n8n. */
export interface DefOtraApp {
  /** El `type` del nodo de n8n cuando es un paso. */
  tipo: string;
  /** El `type` cuando es herramienta de un agente. */
  tipoHerramienta: string;
  version: number;
  paramsPaso: () => ParametrosN8n;
  paramsHerramienta: () => ParametrosN8n;
  /** La nota que lleva el nodo para decir qué falta configurar. */
  nota: (nombre: string) => string;
}

/** Cómo se exporta un agente a n8n. */
export interface DefAgenteN8n {
  tipo: string;
  version: number;
  /** El nombre del nodo si el agente no tiene nombre. */
  nombreBase: string;
}

// ---------------------------------------------------------------- 3. lo que el lienzo recuerda

/** El menú flotante del «+». */
export interface MenuMas {
  /** El cuadro del que sale lo nuevo. */
  ancla: string;
  /** `seq` = lo que va después; `tool` = una herramienta del agente. */
  tipo: TipoArista;
  /** En qué pantalla del menú está: elegir qué poner, o elegir la app. */
  paso: 'inicio' | 'app';
  /** El id de la conexión en cuyo medio se va a insertar, o null si se agrega al final. */
  insertarEn: string | null;
}

/** El modo «toca el cuadro destino». */
export interface Conectando {
  /** El cuadro desde el que se empezó. */
  ancla: string;
  /** Si el ancla es el origen o el destino de la conexión que se va a crear. */
  rol: 'origen' | 'destino';
  tipo: TipoArista;
}

/**
 * A dónde debe ir el foco del teclado después de una acción. El reductor lo pide y un efecto
 * de React lo cumple (así el reductor sigue siendo puro). El foco nunca debe caer a `<body>`.
 */
export type Foco =
  /** El cuadro con ese id. */
  | { k: 'nodo'; id: string }
  /** Un «+»: `der-<id>`, `tool-<id>` o `medio`. */
  | { k: 'mas'; clave: string }
  /** La insignia (el círculo) de la flecha con ese id. */
  | { k: 'insignia'; id: string }
  /** El panel de Ajustes. */
  | { k: 'ajustes' }
  /** La primera opción no bloqueada del menú abierto. */
  | { k: 'primeraOpcionMenu' }
  /** La opción «Un solo sentido» del editor de la flecha. */
  | { k: 'opcionUnSentido' }
  /** El primer cuadro que haya en el lienzo. */
  | { k: 'primerNodo' }
  /** La primera opción de «Elige cómo arranca tu flujo» (lienzo vacío). */
  | { k: 'primeraOpcionDisparador' };

/** Una petición de foco. `n` sube en cada una para que pedir lo mismo dos veces dispare el efecto otra vez. */
export interface PeticionFoco {
  objetivo: Foco;
  n: number;
}

/** Una petición de «hazme visible este cuadro» (desplazamiento horizontal del lienzo). */
export interface PeticionVer {
  id: string;
  n: number;
}

/** El tono de un aviso. */
export type TipoAviso = 'ok' | 'mal' | 'info';

/** El aviso que dice qué pasó (se anuncia a lectores de pantalla y se ve abajo a la derecha). */
export interface AvisoConstructor {
  /** Único: dos avisos con el mismo texto seguidos se anuncian los dos. */
  id: number;
  texto: string;
  tipo: TipoAviso;
  /**
   * Si trae el botón «Deshacer»: solo tras quitar o reacomodar (quitar un cuadro o una conexión, limpiar, cambiar el
   * tipo de una conexión, poner un cuadro en medio, cargar un flujo). Solo vale mientras nada más haya cambiado el
   * flujo: el reductor lo apaga (el `id` del aviso se queda) si después se edita, se mueve o se renombra algo.
   */
  conDeshacer: boolean;
}

/**
 * Una foto del flujo para «Deshacer» (hasta 20; ver MAX_HISTORIAL). Las matrices no se copian: el
 * reductor nunca las muta, así que guardar la referencia basta.
 */
export interface Instantanea {
  /** Los cuadros antes de la acción. */
  nodes: Nodo[];
  /** Las conexiones antes de la acción. */
  edges: Arista[];
  /** Qué cuadro estaba elegido. */
  sel: string | null;
  /** Qué hizo la acción, en una frase («Quitamos «X»…»). */
  texto: string;
  // Las tres siguientes las llena SIEMPRE el reductor; son opcionales solo para que quien arme
  // una instantánea a mano (una prueba) no tenga que escribirlas.
  /** El nombre del flujo antes de la acción (Deshacer lo restaura). Si falta, Deshacer deja el actual. */
  nombreFlujo?: string;
  /** El `id` del aviso que dio esta acción. «Deshacer» desde un aviso solo vale si ese aviso es el de la instantánea de arriba. */
  avisoId?: number;
  /** Qué tipo de cambio fue (decide el texto de «Listo: …» al deshacer). Si falta, es `cambiar`. */
  clase?: ClaseCambio;
}

/**
 * Qué tipo de cambio guardó una instantánea:
 * `quitar` = se quitó algo (un cuadro, una conexión, todo); `agregar` = se agregó algo (un cuadro o el disparador);
 * `cambiar` = se reacomodó o se cambió el tipo de una conexión, o se conectó o se puso un cuadro en medio;
 * `cargar` = se reemplazó todo el flujo por el ejemplo o por uno de afuera.
 */
export type ClaseCambio = 'quitar' | 'agregar' | 'cambiar' | 'cargar';

// ---------------------------------------------------------------- 4. el estado completo

/**
 * Todo lo que el Constructor sabe (menos lo puramente de interfaz: el texto de «¿Otra app?»
 * y el panel JSON abierto viven en los componentes). Lo único que se guarda como borrador es `flujo`.
 */
export interface EstadoConstructor {
  /** El flujo que se está armando. */
  flujo: Flujo;
  /** El cuadro elegido. Nunca a la vez que `selEdge`. */
  sel: string | null;
  /** La conexión elegida. Nunca a la vez que `sel`. */
  selEdge: string | null;
  /** El menú del «+» abierto. Nunca a la vez que `conectando`. */
  menu: MenuMas | null;
  /** El modo «toca el cuadro destino». */
  conectando: Conectando | null;
  /** Las fotos para Deshacer; la más reciente al final. */
  historial: Instantanea[];
  /**
   * El último número usado para los ids (`t21`, `a22`, `e23`…). Nunca baja, ni siquiera al deshacer. Arranca en 20 y, al
   * abrir un flujo de afuera, en `max(20, mayor número que termine algún id + 1)` (`contadorParaFlujo`). El borrador NO lo
   * guarda: al recargar sale del flujo.
   */
  siguiente: number;
  /** El foco pendiente de cumplir. */
  foco: PeticionFoco | null;
  /** El cuadro que hay que traer a la vista. */
  ver: PeticionVer | null;
  /** Sube cuando hay que llevar el panel de Ajustes a la vista (pantallas estrechas). */
  scrollAjustes: number;
  /** El último aviso. */
  aviso: AvisoConstructor | null;
  /**
   * Contador que reparte los `id` de los avisos y los `n` de las peticiones. Arranca en 0 con cada `estadoInicial`: si la
   * pantalla reinicia el reductor (una clave de remonte, un borrador nuevo) con un aviso con «Deshacer» todavía a la vista,
   * debe quitarlo antes (`quitarAviso`), porque el `id` de ese aviso viejo podría coincidir con el de la instantánea de arriba
   * del estado nuevo.
   */
  eventos: number;
}

// ---------------------------------------------------------------- 5. acciones
// Todo lo que puede pasar en el lienzo. `reducir(estado, accion)` (reductor.ts) es la ÚNICA puerta:
// los componentes no cambian el estado de otra manera. Un `id` que ya no existe deja el estado igual.

/** Las cuatro flechas del teclado. */
export type DireccionTecla = 'izquierda' | 'derecha' | 'arriba' | 'abajo';

/**
 * Lo que se puede cambiar de un cuadro con `editarNodo`. Los campos que no son de ese tipo de cuadro,
 * los que traen un valor que no existe (un proveedor de IA que no se ofrece) y los que no se editan
 * a mano (`id`, `kind`, `x`, `y`) se ignoran.
 */
export type ParcheNodo =
  | Partial<Pick<NodoDisparador, 'tipo' | 'frec' | 'ruta' | 'app'>>
  | Partial<Pick<NodoAgente, 'nombre' | 'ia' | 'tarea' | 'instrucciones' | 'desc'>>
  | Partial<Pick<NodoApp, 'nombre'>>;

/** Una acción del reductor. `k` dice cuál es. */
export type AccionConstructor =
  /** Elige cómo arranca el flujo. Si ya hay un disparador no crea otro. */
  | { k: 'elegirDisparador'; tipo: TipoDisparador }
  /** Toca un cuadro. Con el modo «conectando» activo, es el cuadro destino. `teclado` = Enter o Espacio (el foco pasa a Ajustes). */
  | { k: 'abrirNodo'; id: string; teclado?: boolean }
  /** Toca la insignia de una flecha: se abre su editor. */
  | { k: 'abrirEnlace'; id: string }
  /** Toca un «+» (o lo vuelve a tocar: cierra). `insertarEn` = el id de la conexión `seq` donde va el cuadro nuevo. */
  | { k: 'abrirMenu'; ancla: string; tipo: TipoArista; insertarEn?: string | null }
  | { k: 'cerrarMenu' }
  | { k: 'pasoMenu'; paso: MenuMas['paso'] }
  /** Crea lo que se eligió en el menú abierto. `nombreApp` solo importa con `que: 'app'`. */
  | { k: 'crearDesdeMenu'; que: 'agente' | 'app'; nombreApp?: string }
  /** «Conectar con uno que ya está»: empieza el modo «toca el cuadro destino» (o lo cancela si ya era ese). */
  | { k: 'iniciarConexion'; ancla: string; rol: Conectando['rol']; tipo: TipoArista }
  /** Toca el cuadro con el que se quiere conectar. */
  | { k: 'intentarConexion'; id: string }
  | { k: 'cancelarConexion' }
  /** Esc sobre un cuadro: cierra el menú y el modo «conectando». */
  | { k: 'cerrarTodo' }
  /** El editor de la flecha: un solo sentido (`seq`) o ida y vuelta (`tool`). */
  | { k: 'cambiarTipoEnlace'; id: string; tipo: TipoArista }
  | { k: 'quitarEnlace'; id: string }
  | { k: 'quitarNodo'; id: string }
  /** Mueve un cuadro a esta posición (se ajusta a la rejilla de 8 y al lienzo). Un valor que no es número se ignora. */
  | { k: 'moverNodo'; id: string; x: number; y: number }
  /** Mueve un cuadro 8 px con una flecha del teclado (24 con `grande`, que es Mayús). */
  | { k: 'moverConTeclado'; id: string; direccion: DireccionTecla; grande?: boolean }
  | { k: 'editarNodo'; id: string; parche: ParcheNodo }
  | { k: 'renombrarFlujo'; nombre: string }
  /** Borra todo el flujo (el nombre se queda). La pregunta «¿seguro?» es de la interfaz; esto sí se puede deshacer. */
  | { k: 'limpiar' }
  | { k: 'cargarEjemplo' }
  /**
   * Reemplaza el flujo por uno de afuera (Asistente, borrador). El reductor es la única barrera: el flujo pasa por
   * `normalizarFlujo` (la misma limpieza del borrador: campos con su tipo, enumeraciones que existen, ids seguros, sin claves,
   * invariantes del grafo y topes) y entra con los textos ya recortados; si no la pasa, se rechaza con un aviso y no cambia nada.
   * Sin `nombreFlujo` (o si no es texto), el flujo se llama como uno nuevo.
   */
  | { k: 'cargarFlujo'; flujo: Flujo }
  /** Vuelve a la última instantánea. Desde un aviso se manda su `avisoId`: si ya no es el de arriba, no hace nada y lo dice. */
  | { k: 'deshacer'; avisoId?: number }
  /** Esc dentro de Ajustes: el foco vuelve a la flecha o al cuadro que se estaba editando. */
  | { k: 'volverDeAjustes' }
  /** La interfaz ya cumplió el foco y el «hazme visible»: los apaga. Con `hasta`, solo los pedidos con `n` menor o igual (no pisa uno más nuevo). */
  | { k: 'limpiarPeticiones'; hasta?: number };

// ---------------------------------------------------------------- 6. ejemplos y muestras

/** Un flujo de muestra que el Asistente enlatado devuelve según las palabras del pedido. */
export interface Muestra {
  /** Las palabras que, si salen en el pedido, eligen esta muestra (la última no tiene: es la de reserva). */
  claves: string[];
  /** El nombre del flujo. */
  nombre: string;
  /** Los cuadros. */
  nodes: Nodo[];
  /** Las conexiones. */
  edges: Arista[];
  /** Los pasos del flujo en lenguaje de persona, para los chips del resultado. */
  fuentes: string[];
}
