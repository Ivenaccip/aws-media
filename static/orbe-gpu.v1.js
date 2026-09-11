// M19 — motor WebGPU del orbe. Lo carga PEREZOSAMENTE static/orbe.js: la
// mayoría de las visitas nunca ven un orbe y no deben pagar este archivo.
//
// Qué es: el orbe «Glass Liquid» que trajo el dueño, portado a un componente
// del producto. Se conserva verbatim el shader (static/orbe.v1.wgsl — sin el
// camino de partículas style=24, que con estos ajustes no se ejecuta nunca) y
// los dos juegos de uniforms, con su interpolación de 220 ms al entrar a
// «pensando» y 650 ms al volver a «idle», en espacio lineal para el color.
//
// Lo que NO viene del original y es del producto:
//   · UN device, UN módulo y UN pipeline para toda la página, y UN solo rAF
//     que recorre todos los orbes vivos. Dos orbes no son dos contextos de GPU.
//   · Pausa con document.hidden (como monedero.js) + IntersectionObserver: un
//     orbe fuera de pantalla no pinta. Las esperas del producto duran minutos.
//   · dt topado a 50 ms: al volver de una pestaña oculta el reloj del shader no
//     pega un salto (ni un NaN en el acumulador).
//   · devicePixelRatio topado a 2.
//   · prefers-reduced-motion: UN frame estático por cambio de estado.
//   · device.lost no lanza excepción — si el driver se reinicia, el canvas se
//     quedaría congelado y se leería como «se trabó». Aquí avisa y orbe.js
//     revierte al núcleo CSS.
//
// El shader vive en su propio .wgsl a propósito: pegado en un template literal
// un backtick o un ${ sueltos lo corrompen en silencio, y no hay forma de
// validarlo sin una GPU.
(function () {
  'use strict';

  const WGSL_URL = '/orbe.v1.wgsl';
  const MS_ENTRADA = 220;    // idle → pensando: entra rápido, se nota
  const MS_SALIDA = 650;     // pensando → idle: se apaga con calma
  const DT_TOPE = 0.05;      // s — el salto máximo que se le deja al shader
  const DPR_TOPE = 2;

  // Los dos juegos de uniforms del dueño, verbatim. El orden es el de la
  // struct Uniforms del .wgsl: 40 escalares (size.xy, time, speed, …,
  // particleBloom) y luego 24 vec4 de color. NO reordenar: se escriben por
  // posición.
  const AJUSTES = {
    idle: [1, 1, 0, 0.6600000262260437, 0.7200000286102295, 0.36800000071525574, 1.7640000581741333, 0.23559999465942383, 1.784999966621399, 0.18000000715255737, 0.36000001430511475, 0.2800000011920929, 0.20000000298023224, 0.2199999988079071, 0.7315999865531921, 10, 0.004999999888241291, 0, 0, 1, 0.41999998688697815, 0.024000000208616257, 2, 0.41999998688697815, 0.7699999809265137, 0.23000000417232513, 65, 0, 0, 1, 0.2199999988079071, 0.25, 0.7200000286102295, 5, 0.41999998688697815, 1.25, 0.550000011920929, 0.30000001192092896, 1.2000000476837158, 0.699999988079071, 0.007843137718737125, 0.019607843831181526, 0.0470588244497776, 1, 0.11372549086809158, 0.4000000059604645, 0.3490196168422699, 1, 0.1568627506494522, 0.364705890417099, 0.47058823704719543, 1, 0.32549020648002625, 0.24313725531101227, 0.4588235318660736, 1, 0.572549045085907, 0.7137255072593689, 0.7019608020782471, 1, 1, 1, 1, 1, 0.19607843458652496, 0.658823549747467, 1, 1, 0.125490203499794, 0.9411764740943909, 0.7137255072593689, 1, 0.9176470637321472, 0.95686274766922, 1, 1, 0.8627451062202454, 0.9176470637321472, 1, 1, 0.003921568859368563, 0.007843137718737125, 0.027450980618596077, 1, 0.1568627506494522, 0.4156862795352936, 0.3843137323856354, 1, 0.9686274528503418, 0.9843137264251709, 1, 1, 0.9372549057006836, 0.9647058844566345, 0.9921568632125854, 1, 0.8784313797950745, 0.9333333373069763, 0.9764705896377563, 1, 0.8313725590705872, 0.9019607901573181, 0.9686274528503418, 1, 0.7333333492279053, 0.8352941274642944, 0.9529411792755127, 1, 0.6509804129600525, 0.7803921699523926, 0.9411764740943909, 1, 0.529411792755127, 0.6901960968971252, 0.9215686321258545, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1],
    pensando: [1, 1, 0, 3, 0.7200000286102295, 0.4000000059604645, 4.199999809265137, 0.6200000047683716, 2.0999999046325684, 0.18000000715255737, 0.36000001430511475, 0.2800000011920929, 0.20000000298023224, 0.2199999988079071, 1.1799999475479126, 10, 0.004999999888241291, 0, 0, 1, 0.41999998688697815, 0.07999999821186066, 2, 0.41999998688697815, 0.7699999809265137, 0.23000000417232513, 65, 0, 0, 1, 0.2199999988079071, 0.25, 0.7200000286102295, 5, 0.41999998688697815, 1.25, 0.550000011920929, 0.30000001192092896, 1.2000000476837158, 0.699999988079071, 0.0117647061124444, 0.0313725508749485, 0.08627451211214066, 1, 0.125490203499794, 0.9411764740943909, 0.7137255072593689, 1, 0.19607843458652496, 0.658823549747467, 1, 1, 0.6392157077789307, 0.29411765933036804, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.19607843458652496, 0.658823549747467, 1, 1, 0.125490203499794, 0.9411764740943909, 0.7137255072593689, 1, 0.9176470637321472, 0.95686274766922, 1, 1, 0.8627451062202454, 0.9176470637321472, 1, 1, 0.003921568859368563, 0.007843137718737125, 0.027450980618596077, 1, 0.125490203499794, 0.9411764740943909, 0.7137255072593689, 1, 0.9686274528503418, 0.9843137264251709, 1, 1, 0.9372549057006836, 0.9647058844566345, 0.9921568632125854, 1, 0.8784313797950745, 0.9333333373069763, 0.9764705896377563, 1, 0.8313725590705872, 0.9019607901573181, 0.9686274528503418, 1, 0.7333333492279053, 0.8352941274642944, 0.9529411792755127, 1, 0.6509804129600525, 0.7803921699523926, 0.9411764740943909, 1, 0.529411792755127, 0.6901960968971252, 0.9215686321258545, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1, 0.43529412150382996, 0.6196078658103943, 0.9098039269447327, 1],
  };
  const N = AJUSTES.idle.length;
  const I_TIEMPO = 2, I_VELOCIDAD = 3, I_COLOR = 40;

  // --- interpolación de estados (del original) --------------------------------
  const aLineal = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const aSrgb = v => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const mezclaSrgb = (a, b, k) => aSrgb(aLineal(a) + (aLineal(b) - aLineal(a)) * k);
  // el componente 4 de cada vec4 es alfa: se interpola lineal, no en sRGB
  const esColor = i => i >= I_COLOR && (i - I_COLOR) % 4 < 3;

  const reducido = () => {
    try { return matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch { return false; }
  };

  // --- arranque del device: memoizado, con las 4 capas de gate ----------------
  // No basta `if (navigator.gpu)`: con la aceleración por hardware apagada el
  // objeto EXISTE y requestAdapter() devuelve null.
  let arranquePromesa = null;
  let gpu = null;          // {device, formato, pipeline}
  const vivos = new Set();

  function conTope(promesa, ms) {
    return Promise.race([
      promesa,
      new Promise((_, rechaza) => setTimeout(() => rechaza(new Error('la GPU tardó demasiado')), ms)),
    ]);
  }

  function arrancar() {
    if (arranquePromesa) return arranquePromesa;
    arranquePromesa = (async () => {
      if (!navigator.gpu) throw new Error('sin WebGPU');
      // el .wgsl se pide EN PARALELO con el adaptador: son independientes
      const wgslP = fetch(WGSL_URL).then(r => {
        if (!r.ok) throw new Error('no se pudo leer el shader: ' + r.status);
        return r.text();
      });
      const adaptador = await navigator.gpu.requestAdapter();
      if (!adaptador) throw new Error('sin adaptador (¿aceleración por hardware apagada?)');
      const device = await adaptador.requestDevice();
      const formato = navigator.gpu.getPreferredCanvasFormat();
      const modulo = device.createShaderModule({ code: await wgslP });
      if (modulo.getCompilationInfo) {
        const info = await modulo.getCompilationInfo();
        const errores = info.messages.filter(m => m.type === 'error');
        if (errores.length) {
          throw new Error(errores.map(m => `${m.lineNum}:${m.linePos} ${m.message}`).join(' · '));
        }
      }
      const mezcla = {
        color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      };
      const pipeline = device.createRenderPipeline({
        layout: 'auto',
        vertex: { module: modulo, entryPoint: 'vs_main' },
        fragment: { module: modulo, entryPoint: 'fs_main', targets: [{ format: formato, blend: mezcla }] },
        primitive: { topology: 'triangle-list' },
      });
      device.lost.then(() => caer('la GPU se reinició'));
      gpu = { device, formato, pipeline };
      return gpu;
    })();
    // un arranque fallido NO se reintenta en cada montaje: la respuesta no va
    // a cambiar dentro de la misma carga de página
    arranquePromesa.catch(() => {});
    return arranquePromesa;
  }

  function caer(motivo) {
    gpu = null;
    for (const o of Array.from(vivos)) o.degradar(motivo);
  }

  // --- el bucle: UNO para toda la página --------------------------------------
  let rafId = 0, ultimo = null;

  function bucle(ahora) {
    rafId = 0;
    const dt = ultimo === null ? 0 : Math.min(DT_TOPE, Math.max(0, (ahora - ultimo) / 1000));
    ultimo = ahora;
    for (const o of vivos) o.frame(ahora, dt);
    programar();
  }

  function programar() {
    if (rafId || !vivos.size || document.hidden) return;
    // con movimiento reducido solo se pinta cuando algo cambió
    let hayQuePintar = false;
    for (const o of vivos) { if (o.necesitaFrame()) { hayQuePintar = true; break; } }
    if (!hayQuePintar) return;
    rafId = requestAnimationFrame(bucle);
  }

  // monedero.js ya usa este mismo gancho: una pestaña de fondo no pinta, y al
  // volver el reloj arranca de cero para no acumular el hueco
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      ultimo = null;
    } else {
      for (const o of vivos) o.sucio = true;
      programar();
    }
  });

  // --- un orbe ---------------------------------------------------------------
  function crear(canvas, estadoInicial, alDegradar, alPintar) {
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('sin contexto webgpu');
    ctx.configure({ device: gpu.device, format: gpu.formato, alphaMode: 'premultiplied' });

    const valores = new Float32Array(AJUSTES[estadoInicial] || AJUSTES.idle);
    const desde = new Float32Array(valores);
    const hacia = new Float32Array(valores);
    const buffer = gpu.device.createBuffer({
      size: valores.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    const grupo = gpu.device.createBindGroup({
      layout: gpu.pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer } }],
    });

    let modo = estadoInicial in AJUSTES ? estadoInicial : 'idle';
    let inicioTransicion = 0, duracionTransicion = 0;
    let fase = 0;            // tiempo*velocidad acumulado (continuo al cambiar de estado)
    let visible = true;
    let muerto = false;
    let pinto = false;
    const lento = reducido();

    const orbe = {
      sucio: true,
      get modo() { return modo; },

      necesitaFrame() {
        if (muerto || !visible) return false;
        if (!lento) return true;
        return orbe.sucio || duracionTransicion > 0;
      },

      estado(nuevo) {
        if (muerto || !(nuevo in AJUSTES) || nuevo === modo) return;
        // se parte del valor MOSTRADO ahora, no del estado anterior: un cambio
        // a media transición no da un salto
        desde.set(valores);
        hacia.set(AJUSTES[nuevo]);
        inicioTransicion = performance.now();
        duracionTransicion = nuevo === 'pensando' ? MS_ENTRADA : MS_SALIDA;
        modo = nuevo;
        orbe.sucio = true;
        programar();
      },

      frame(ahora, dt) {
        if (muerto || !visible) return;
        // tamaño real del lienzo (dpr topado): el shader pinta por pixel
        const dpr = Math.min(window.devicePixelRatio || 1, DPR_TOPE);
        const ancho = Math.max(1, Math.round(canvas.clientWidth * dpr));
        const alto = Math.max(1, Math.round(canvas.clientHeight * dpr));
        if (canvas.width !== ancho || canvas.height !== alto) {
          canvas.width = ancho; canvas.height = alto;
          orbe.sucio = true;
        }

        if (duracionTransicion > 0) {
          const crudo = Math.min(1, Math.max(0, (ahora - inicioTransicion) / duracionTransicion));
          // entrar es un ease-out (arranca fuerte); salir, un smoothstep
          const k = modo === 'pensando' ? 1 - Math.pow(1 - crudo, 3) : crudo * crudo * (3 - 2 * crudo);
          for (let i = I_TIEMPO + 1; i < N; i++) {
            valores[i] = esColor(i) ? mezclaSrgb(desde[i], hacia[i], k)
                                    : desde[i] + (hacia[i] - desde[i]) * k;
          }
          if (crudo >= 1) duracionTransicion = 0;
          orbe.sucio = true;
        }

        const velocidad = Math.max(valores[I_VELOCIDAD], 0);
        if (!lento) fase += dt * velocidad;
        valores[0] = ancho; valores[1] = alto;
        // el shader usa time*speed: guardando la FASE, cambiar de velocidad no
        // teletransporta la animación
        valores[I_TIEMPO] = fase / Math.max(velocidad, 0.001);
        gpu.device.queue.writeBuffer(buffer, 0, valores);

        const enc = gpu.device.createCommandEncoder();
        const paso = enc.beginRenderPass({
          colorAttachments: [{
            view: ctx.getCurrentTexture().createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 0 },
            loadOp: 'clear', storeOp: 'store',
          }],
        });
        paso.setPipeline(gpu.pipeline);
        paso.setBindGroup(0, grupo);
        paso.draw(3);
        paso.end();
        gpu.device.queue.submit([enc.finish()]);
        orbe.sucio = false;
        // El aviso va DESPUÉS del primer frame de verdad, no al adjuntar: si el
        // orbe monta con la pestaña oculta o fuera de la vista, aquí no se pinta
        // nada, y quien tape el núcleo CSS antes de tiempo deja un agujero.
        if (!pinto) {
          pinto = true;
          try { alPintar && alPintar(); } catch (e) { /* nunca tumba la página */ }
        }
      },

      degradar(motivo) {
        if (muerto) return;
        orbe.destruir();
        try { alDegradar && alDegradar(motivo); } catch (e) { /* nunca tumba la página */ }
      },

      destruir() {
        if (muerto) return;
        muerto = true;
        vivos.delete(orbe);
        if (observador) { try { observador.disconnect(); } catch (e) {} }
        try { buffer.destroy(); } catch (e) {}
        try { ctx.unconfigure(); } catch (e) {}
      },
    };

    // fuera de pantalla no se pinta — una espera puede durar 25 minutos
    let observador = null;
    if (window.IntersectionObserver) {
      observador = new IntersectionObserver(entradas => {
        visible = entradas[entradas.length - 1].isIntersecting;
        if (visible) { orbe.sucio = true; programar(); }
      });
      observador.observe(canvas);
    }

    vivos.add(orbe);
    programar();
    return orbe;
  }

  window.__orbeMotor = {
    // Promesa → control, o null si esta máquina no puede con el orbe. NUNCA
    // rechaza: quien llama solo quiere saber si hay canvas o no.
    async adjuntar(canvas, estado, alDegradar, alPintar) {
      try {
        await conTope(arrancar(), 1500);
        if (!gpu) return null;
        return crear(canvas, estado, alDegradar, alPintar);
      } catch (e) {
        return null;
      }
    },
    precargar() { arrancar(); },
  };
})();
