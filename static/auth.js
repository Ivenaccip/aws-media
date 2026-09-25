// M2 — login con Cognito Hosted UI (Authorization Code + PKCE), sin librerías.
// Se carga ANTES que cualquier otro script: envuelve window.fetch para que
// todas las llamadas same-origin viajen con `Authorization: Bearer <id_token>`.
// 401 → intenta refrescar el token y reintenta UNA vez; si no, redirige al
// Hosted UI conservando la URL actual (incluye ?p=). 403 → aviso de acceso.
// El id_token también se guarda en la cookie `token` (la pone callback.html):
// con ella los <img>/<audio>/<video> que apuntan a /api/... funcionan solos.
// En dev local /api/auth/config responde activo=false y este archivo no hace nada.
(function () {
  const fetchReal = window.fetch.bind(window);
  const cfgPromesa = fetchReal('/api/auth/config')
    .then(r => (r.ok ? r.json() : { activo: false }))
    .catch(() => ({ activo: false }));

  const b64url = bytes => btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  function guardarTokens(d) {
    if (d.id_token) {
      localStorage.setItem('auth_id_token', d.id_token);
      document.cookie = 'token=' + d.id_token + '; path=/; SameSite=Lax' +
        (location.protocol === 'https:' ? '; Secure' : '');
    }
    if (d.refresh_token) localStorage.setItem('auth_refresh_token', d.refresh_token);
  }

  // /entrar valida `volver` y lo pasa; el 401 dentro de la app usa la página
  // actual. Single-flight: si llegan siete 401 juntos, solo el primero genera
  // el verifier y navega; los demás esperan la misma promesa. Antes cada uno
  // pisaba auth_verifier en sessionStorage y el canje de callback.html podía
  // quedarse con uno que no era el del código de Cognito.
  let loginEnCurso = null;
  function login(volver) {
    loginEnCurso = loginEnCurso || (async () => {
      const c = await cfgPromesa;
      if (!c.activo) return;
      const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
      sessionStorage.setItem('auth_verifier', verifier);
      sessionStorage.setItem('auth_volver', volver || (location.pathname + location.search));
      const reto = b64url(new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      location.href = 'https://' + c.dominio + '/oauth2/authorize' +
        '?client_id=' + c.client_id + '&response_type=code&scope=openid+email' +
        '&redirect_uri=' + encodeURIComponent(location.origin + '/callback.html') +
        '&code_challenge_method=S256&code_challenge=' + reto +
        '&lang=es';   // Managed Login: fuerza la pantalla en español
    })();
    return loginEnCurso;
  }
  // Si vuelven con «atrás» desde Cognito, el navegador restaura la página con
  // su JS tal cual (bfcache) y la promesa ya resuelta: el siguiente login no
  // navegaría. Se suelta al volver.
  window.addEventListener('pageshow', e => { if (e.persisted) loginEnCurso = null; });

  // Single-flight también: un refresh_token de Cognito se puede usar varias
  // veces, pero siete POST a /oauth2/token por un solo vencimiento son seis de
  // más. Los que llegan mientras uno está en vuelo esperan su resultado.
  let refrescoEnCurso = null;
  function refrescar() {
    refrescoEnCurso = refrescoEnCurso || (async () => {
      const c = await cfgPromesa;
      const rt = localStorage.getItem('auth_refresh_token');
      if (!c.activo || !rt) return false;
      try {
        const r = await fetchReal('https://' + c.dominio + '/oauth2/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'grant_type=refresh_token&client_id=' + c.client_id + '&refresh_token=' + encodeURIComponent(rt),
        });
        if (!r.ok) return false;
        guardarTokens(await r.json());
        return true;
      } catch { return false; }
    })().finally(() => { refrescoEnCurso = null; });
    return refrescoEnCurso;
  }

  // Segundos que le quedan al id_token guardado (0 si no hay o no se lee).
  // Lo usa /entrar para decidir si basta con rehacer la cookie —que es de
  // sesión y se pierde al cerrar el navegador— o hay que refrescar.
  function segundosRestantes() {
    const t = localStorage.getItem('auth_id_token');
    if (!t) return 0;
    try {
      const b = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return Math.max(0, JSON.parse(atob(b)).exp - Date.now() / 1000);
    } catch { return 0; }
  }

  function salir() {
    localStorage.removeItem('auth_id_token');
    localStorage.removeItem('auth_refresh_token');
    document.cookie = 'token=; path=/; Max-Age=0';
    cfgPromesa.then(c => {
      if (c.activo) location.href = 'https://' + c.dominio + '/logout?client_id=' +
        c.client_id + '&logout_uri=' + encodeURIComponent(location.origin + '/');
    });
  }

  function conToken(url, init) {
    const t = localStorage.getItem('auth_id_token');
    if (!t) return fetchReal(url, init);
    init = Object.assign({}, init);
    const h = new Headers(init.headers || undefined);
    h.set('Authorization', 'Bearer ' + t);
    init.headers = h;
    return fetchReal(url, init);
  }

  window.fetch = async function (entrada, init) {
    const url = typeof entrada === 'string' ? entrada : entrada.url;
    const propia = url.startsWith('/') || url.startsWith(location.origin);
    if (!propia) return fetchReal(entrada, init);
    const usado = localStorage.getItem('auth_id_token');
    let r = await conToken(entrada, init);
    if (r.status === 401 && (await cfgPromesa).activo) {
      // si otro fetch ya refrescó mientras este volaba con el token viejo,
      // basta reintentar con el nuevo: no hace falta otro refresh
      const ahora = localStorage.getItem('auth_id_token');
      if ((ahora && ahora !== usado) || await refrescar()) r = await conToken(entrada, init);
      if (r.status === 401) { await login(); return new Promise(() => {}); }
    }
    if (r.status === 403) avisoAcceso();
    return r;
  };

  // M19 fase 4: esto era un alert(). Un alert bloquea el hilo hasta que alguien
  // le da a Aceptar, y las pantallas que hacen poll (el editor, crear, shorts)
  // reciben el 403 una vez cada pocos segundos: salía un modal encima de otro y
  // la página quedaba inservible. Ahora es un aviso que se ve, no se apila y
  // no detiene nada.
  let aviso = null, avisoT = null;
  function avisoAcceso() {
    if (!document.body) return;
    if (!aviso) {
      aviso = document.createElement('div');
      aviso.setAttribute('role', 'status');
      aviso.style.cssText =
        'position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2000;' +
        'background:#2e1b1b;border:1px solid #8f4a4a;border-radius:999px;' +
        'padding:9px 18px;font:13px/1.4 system-ui,sans-serif;color:#ffb4b4;' +
        'box-shadow:0 2px 12px rgba(0,0,0,.4)';
      aviso.textContent = 'No tienes acceso a este proyecto.';
      document.body.appendChild(aviso);
    }
    clearTimeout(avisoT);               // un 403 nuevo reinicia el reloj
    avisoT = setTimeout(() => { aviso.remove(); aviso = null; }, 8000);
  }

  window.auth = { login, salir, refrescar, guardarTokens, segundosRestantes,
                  config: () => cfgPromesa };
})();
