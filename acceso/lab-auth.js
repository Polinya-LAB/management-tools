/* Acceso por correo: sesión de Supabase Auth compartida por todas las apps del portal (mismo origen, misma sesión).
   Script normal (sin módulos), sin interfaz: cada app pone su diálogo. Necesita acceso/config.js antes
   (window.LAB_SUPABASE = {url, anonKey}); si está vacío, LabAuth.activo es false y no se carga supabase-js.

   window.LabAuth:
     activo                     boolean: hay url y anonKey
     listo                      Promise<void>: se resuelve cuando el cliente está listo (o enseguida si no está activo);
                                nunca se rechaza (si supabase-js no carga, los métodos fallan con {code:'unavailable'})
     sesion()                   Promise<{email}|null>
     entrar(email, password)    Promise<void>; entra con correo y contraseña (la asigna un administrador en acceso/).
                                Normaliza el correo (espacios y mayúsculas); la contraseña va tal cual. Errores {code}:
                                'bad_credentials' (correo o contraseña incorrectos, o persona no dada de alta),
                                'rate' (demasiados intentos, 429), 'unavailable' (sin red o error 5xx de Supabase)
     pedirCodigo(email)         OBSOLETO (código por correo; se quita cuando las apps usen entrar). Promise<void>; errores
                                {code}: 'not_allowed' (no dado de alta), 'bad_email', 'rate' (demasiados envíos), 'error'
     verificar(email, codigo)   OBSOLETO, como pedirCodigo. Promise<void>; errores {code}: 'bad_code' (código incorrecto
                                o caducado), 'bad_email', 'error'
     salir()                    Promise<void>
     api(app)                   string: `${url}/functions/v1/github/${app}`
     apiAdmin()                 string: `${url}/functions/v1/admin`
     cabeceras()                Promise<{Authorization:'Bearer <jwt>', apikey}> con el JWT renovado si hace falta;
                                sin sesión, solo {apikey} (la función responde 401)
     onCambio(fn)               fn({email}|null) cada vez que se entra o se sale (también desde otra pestaña,
                                o si la sesión deja de valer al renovarla); devuelve una función para darse de baja
   Si la función responde 401 (sesión caducada o persona dada de baja), la app pasa a "Sign in again" sin borrar lo que
   tiene en pantalla; LabAuth no decide eso. */
(function () {
  'use strict';
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js';
  // Subresource Integrity: el navegador rechaza el fichero si el CDN sirve otro contenido. Al cambiar de versión, recalcular:
  // openssl dgst -sha384 -binary supabase.js | openssl base64 -A
  var SDK_SRI = 'sha384-rwykjmWNwVxboyFmvK9OXN0wj9hnMHA2aAHtits54DuACyCq0M2PrSNxhRb+hvXT';
  var cfg = window.LAB_SUPABASE || {};
  var url = String(cfg.url || '').trim().replace(/\/+$/, '');
  var anonKey = String(cfg.anonKey || '').trim();
  var activo = !!(url && anonKey);

  var cliente = null;
  var ultimo; // último email avisado (undefined = aún ninguno)
  var subs = [];

  function err(code, message) {
    var e = new Error(message || code);
    e.code = code;
    return e;
  }
  function normalizar(email) {
    return String(email == null ? '' : email).trim().toLowerCase();
  }
  function pareceCorreo(s) {
    return /^[^@\s]+@[^@\s]+$/.test(s);
  }
  function deSesion(s) {
    return s && s.user && s.user.email ? { email: normalizar(s.user.email) } : null;
  }
  function avisar(s) {
    var v = deSesion(s);
    var email = v ? v.email : null;
    if (email === ultimo) return;
    var antes = ultimo;
    ultimo = email;
    if (antes === undefined && email === null) return; // estado inicial sin sesión: no es un cambio
    subs.slice().forEach(function (fn) {
      try { fn(v); } catch (e) { setTimeout(function () { throw e; }); }
    });
  }

  function cargarSdk() {
    if (window.supabase && typeof window.supabase.createClient === 'function') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = SDK;
      s.integrity = SDK_SRI;
      s.crossOrigin = 'anonymous';
      s.async = true;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(err('unavailable', 'No se pudo cargar supabase-js')); };
      (document.head || document.documentElement).appendChild(s);
    });
  }

  var listo = !activo ? Promise.resolve() : cargarSdk().then(function () {
    cliente = window.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, storageKey: 'lab-auth', autoRefreshToken: true, detectSessionInUrl: false },
    });
    // Sin llamadas a supabase dentro del callback (supabase-js lo desaconseja: puede bloquearse).
    cliente.auth.onAuthStateChange(function (_evento, s) { avisar(s); });
    return cliente.auth.getSession().then(function (r) { avisar(r.data && r.data.session); });
  }).catch(function (e) {
    cliente = null;
    if (window.console) console.warn('LabAuth:', e && e.message || e);
  });

  function conCliente() {
    return listo.then(function () {
      if (!activo) throw err('inactive', 'El acceso por correo no está configurado');
      if (!cliente) throw err('unavailable', 'El acceso por correo no está disponible');
      return cliente;
    });
  }
  function sesionActual() {
    return conCliente().then(function (c) {
      return c.auth.getSession().then(function (r) { return (r.data && r.data.session) || null; });
    });
  }
  function codigoDe(e) {
    return e && (e.code || e.error_code) || '';
  }

  function sesion() {
    if (!activo) return Promise.resolve(null);
    return sesionActual().then(deSesion, function () { return null; });
  }

  function entrar(email, password) {
    var e = normalizar(email);
    var p = typeof password === 'string' ? password : '';
    // Sin correo con forma de correo o sin contraseña no hay nada que comprobar: mismo error que unas credenciales malas.
    if (!pareceCorreo(e) || !p) return Promise.reject(err('bad_credentials', 'Correo o contraseña incorrectos'));
    return conCliente().then(function (c) {
      return c.auth.signInWithPassword({ email: e, password: p });
    }).then(function (r) {
      if (!r.error) {
        if (!r.data || !r.data.session) throw err('unavailable', 'Sin sesión');
        avisar(r.data.session);
        return;
      }
      var st = r.error.status;
      var msg = r.error.message || '';
      if (st === 429 || /rate_limit/.test(codigoDe(r.error))) throw err('rate', msg);
      // Sin red (status 0 o sin status), 5xx o una respuesta que no se entiende: el servicio no está disponible.
      if (!st || st >= 500) throw err('unavailable', msg);
      // GoTrue: 400 invalid_credentials "Invalid login credentials"; cualquier otro 4xx tampoco deja entrar.
      throw err('bad_credentials', msg);
    });
  }

  // OBSOLETO: código por correo. Se mantiene sin cambios hasta que las apps usen entrar().
  function pedirCodigo(email) {
    var e = normalizar(email);
    if (!pareceCorreo(e)) return Promise.reject(err('bad_email', 'Correo no válido'));
    return conCliente().then(function (c) {
      return c.auth.signInWithOtp({ email: e, options: { shouldCreateUser: false } });
    }).then(function (r) {
      if (!r.error) return;
      var code = codigoDe(r.error);
      var msg = r.error.message || '';
      if (code === 'otp_disabled' || code === 'signup_disabled' || code === 'user_not_found' ||
        /signups not allowed|user not found/i.test(msg)) throw err('not_allowed', msg);
      if (r.error.status === 429 || /rate_limit/.test(code)) throw err('rate', msg);
      throw err('error', msg);
    });
  }

  function verificar(email, codigo) {
    var e = normalizar(email);
    var token = String(codigo == null ? '' : codigo).replace(/\s+/g, '');
    if (!pareceCorreo(e)) return Promise.reject(err('bad_email', 'Correo no válido'));
    if (!/^\d{6}$/.test(token)) return Promise.reject(err('bad_code', 'El código tiene 6 cifras'));
    return conCliente().then(function (c) {
      return c.auth.verifyOtp({ email: e, token: token, type: 'email' });
    }).then(function (r) {
      if (!r.error) {
        if (!r.data || !r.data.session) throw err('error', 'Sin sesión');
        avisar(r.data.session);
        return;
      }
      var code = codigoDe(r.error);
      var st = r.error.status;
      if (code === 'otp_expired' || code === 'otp_invalid' || code === 'invalid_credentials' ||
        st === 400 || st === 401 || st === 403 || /expired|invalid/i.test(r.error.message || '')) {
        throw err('bad_code', r.error.message);
      }
      throw err('error', r.error.message);
    });
  }

  function salir() {
    if (!activo) return Promise.resolve();
    return conCliente().then(function (c) {
      // Solo esta sesión (scope local): salir en un navegador no cierra la de otros dispositivos.
      return c.auth.signOut({ scope: 'local' }).then(function (r) {
        if (r && r.error) {
          // Sin red: la sesión se borra igualmente en este navegador.
          try { localStorage.removeItem('lab-auth'); } catch (e) { /* sin almacenamiento */ }
        }
        avisar(null);
      });
    });
  }

  function api(app) {
    if (!activo) throw err('inactive', 'El acceso por correo no está configurado');
    return url + '/functions/v1/github/' + encodeURIComponent(app);
  }
  function apiAdmin() {
    if (!activo) throw err('inactive', 'El acceso por correo no está configurado');
    return url + '/functions/v1/admin';
  }

  function cabeceras() {
    if (!activo) return Promise.reject(err('inactive', 'El acceso por correo no está configurado'));
    return sesionActual().then(function (s) {
      var h = { apikey: anonKey };
      if (s && s.access_token) h.Authorization = 'Bearer ' + s.access_token;
      return h;
    });
  }

  function onCambio(fn) {
    if (typeof fn !== 'function') return function () {};
    subs.push(fn);
    return function () { subs = subs.filter(function (x) { return x !== fn; }); };
  }

  window.LabAuth = Object.freeze({
    activo: activo,
    listo: listo,
    sesion: sesion,
    entrar: entrar,
    pedirCodigo: pedirCodigo, // obsoleto
    verificar: verificar, // obsoleto
    salir: salir,
    api: api,
    apiAdmin: apiAdmin,
    cabeceras: cabeceras,
    onCambio: onCambio,
  });
})();
