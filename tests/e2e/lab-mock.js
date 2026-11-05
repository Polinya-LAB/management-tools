// Simulación para las pruebas de navegador (Playwright) de las apps de management-tools.
//
// setupLab(ctx, opts) intercepta en el contexto `ctx`:
//   - https://polinya-lab.github.io/management-tools/**  → ficheros de `mtDir` (acceso/config.js con la configuración de prueba)
//   - CDN (cdnjs xlsx, jsDelivr qrcode-generator / jsbarcode / @supabase/supabase-js) → tests/node_modules
//   - Google Fonts → CSS vacío
//   - <supabaseUrl>/auth/v1/{token,otp,verify,user,logout} → Supabase Auth simulado: correo + contraseña
//     (grant_type=password; cada usuario tiene `password`, por defecto CLAVE_PRUEBA) y, hasta que las apps dejen de
//     usarlo, el código de 6 dígitos (otp/verify)
//   - <supabaseUrl>/functions/v1/github/**, /functions/v1/admin/** → los handlers REALES (supabase/functions/*/handler.ts,
//     empaquetados con esbuild) con dependencias falsas: así las pruebas ejercitan la lógica de permisos de verdad
//   - api.github.com y raw.githubusercontent.com → modo "clave de GitHub" sobre los mismos ficheros
//   - cualquier otra petición se bloquea (queda en `bloqueadas`)
// Los ficheros de datos son copias en memoria de tests/e2e/fixtures/<repo>/<ruta> (datos inventados).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const Module = require('node:module');

const RAIZ = path.resolve(__dirname, '..', '..');
const NODE_MODULES = path.resolve(__dirname, '..', 'node_modules');
const PAGES = 'https://polinya-lab.github.io/management-tools/';
const OWNER = 'Polinya-LAB';
const CLAVE_PRUEBA = 'clave-de-prueba-1234'; // contraseña de los usuarios que no traen `password`

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.md': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const tipo = (f) => TIPOS[path.extname(f).toLowerCase()] || 'application/octet-stream';

// ---------- Handlers reales, empaquetados una vez por proceso ----------
let handlers = null;
function cargarHandlers() {
  if (handlers) return handlers;
  const esbuild = require('esbuild');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-mock-'));
  const cargar = (entrada) => {
    const r = esbuild.buildSync({
      entryPoints: [path.join(RAIZ, entrada)], bundle: true, platform: 'node', format: 'cjs', target: 'node20', write: false,
    });
    const fichero = path.join(dir, entrada.replace(/[\\/]/g, '_') + '.cjs');
    const m = new Module(fichero);
    m.filename = fichero;
    m._compile(r.outputFiles[0].text, fichero);
    return m.exports;
  };
  handlers = {
    crearHandler: cargar('supabase/functions/github/handler.ts').crearHandler,
    crearHandlerAdmin: cargar('supabase/functions/admin/handler.ts').crearHandlerAdmin,
  };
  return handlers;
}

// ---------- Utilidades ----------
const norm = (e) => String(e ?? '').trim().toLowerCase();
const b64url = (s) => Buffer.from(s).toString('base64url');
const shaGit = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const uuidDe = (s) => {
  const h = crypto.createHash('sha1').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
// Como GitHub: base64 en líneas de 60 caracteres.
const b64Lineas = (buf) => (buf.toString('base64').match(/.{1,60}/g) || ['']).join('\n') + '\n';
const json = (status, body, headers = {}) => ({
  status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers }, body: JSON.stringify(body),
});

function leerFixtures(dirs) {
  const store = new Map();
  for (const [repo, dir] of Object.entries(dirs)) {
    const recorrer = (d) => {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, ent.name);
        if (ent.isDirectory()) recorrer(full);
        else if (ent.isFile()) {
          const buf = fs.readFileSync(full);
          store.set(`${repo}/${path.relative(dir, full).split(path.sep).join('/')}`, { buf, sha: shaGit(buf) });
        }
      }
    };
    recorrer(dir);
  }
  return store;
}

/**
 * @param {import('playwright').BrowserContext} ctx
 * @param {{usuarios?: Array<{email:string,nombre:string,roles:object,admin:boolean,password?:string}>, codigo?: string,
 *   supabaseUrl?: string, anonKey?: string, mtDir?: string, fixturesDir?: string, dataDirs?: Record<string,string>,
 *   github?: {login:string, push:boolean, token?:string}, rawPublico?: string[], expiresIn?: number,
 *   formatoErrores?: 'legacy'|'2024'}} opts
 */
async function setupLab(ctx, opts = {}) {
  const codigo = opts.codigo ?? '123456';
  const supabaseUrl = String(opts.supabaseUrl ?? 'https://lab-test.supabase.co').replace(/\/+$/, '');
  const anonKey = opts.anonKey ?? 'anon-test';
  const mtDir = path.resolve(opts.mtDir ?? RAIZ);
  const fixturesDir = path.resolve(opts.fixturesDir ?? path.join(__dirname, 'fixtures'));
  const dataDirs = opts.dataDirs ?? Object.fromEntries(
    fs.readdirSync(fixturesDir, { withFileTypes: true }).filter((e) => e.isDirectory())
      .map((e) => [e.name, path.join(fixturesDir, e.name)]),
  );
  const expiresIn = opts.expiresIn ?? 3600;
  const formato2024 = opts.formatoErrores === '2024';
  const rawPublico = new Set(opts.rawPublico ?? []);

  const store = leerFixtures(dataDirs);
  let usuarios = [];
  const claves = new Map(); // email → contraseña (en Supabase vive en Auth, no en `acceso`)
  const setUsuarios = (lista) => {
    claves.clear();
    usuarios = (lista || []).map(({ password, ...u }) => {
      const email = norm(u.email);
      claves.set(email, password ?? CLAVE_PRUEBA);
      return { ...u, email, roles: { ...(u.roles || {}) } };
    });
  };
  setUsuarios(opts.usuarios);
  const buscar = (email) => usuarios.find((u) => u.email === norm(email)) || null;

  const estado = {
    puts: [], logins: [], otps: [], verifies: [], tokens: [], logouts: [], bloqueadas: [], refrescos: 0,
  };
  const VALIDEZ_CODIGO_MS = 600 * 1000; // el código vale 10 minutos desde que se pide
  const codigosPedidos = new Map(); // email → momento del último /otp aceptado
  const sesiones = new Map(); // session_id → {email, revocada}
  const refreshes = new Map(); // refresh_token → session_id (solo el vigente)

  // ---------- JWT simulado (sin firma) ----------
  const crearJwt = (email, sid) => {
    const ahora = Math.floor(Date.now() / 1000);
    const payload = {
      sub: uuidDe(email), email, exp: ahora + expiresIn, iat: ahora, role: 'authenticated', aud: 'authenticated',
      session_id: sid, jti: crypto.randomUUID(),
    };
    return `${b64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))}.${b64url(JSON.stringify(payload))}.sin-firma`;
  };
  const leerJwt = (jwt) => {
    try {
      const p = JSON.parse(Buffer.from(String(jwt).split('.')[1], 'base64url').toString('utf8'));
      if (!p || typeof p.exp !== 'number' || p.exp * 1000 <= Date.now()) return null;
      const s = sesiones.get(p.session_id);
      if (!s || s.revocada || s.email !== norm(p.email)) return null;
      return p;
    } catch {
      return null;
    }
  };
  const revocar = (email) => {
    for (const s of sesiones.values()) if (s.email === norm(email)) s.revocada = true;
  };

  const usuarioAuth = (email) => {
    const t = '2026-01-01T00:00:00.000Z';
    return {
      id: uuidDe(email), aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: t,
      app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: t, updated_at: t,
    };
  };
  const nuevaSesion = (email, sid = crypto.randomUUID()) => {
    if (!sesiones.has(sid)) sesiones.set(sid, { email, revocada: false });
    const access = crearJwt(email, sid);
    const refresh = crypto.randomBytes(12).toString('hex');
    refreshes.set(refresh, sid);
    estado.tokens.push(access);
    return {
      access_token: access, token_type: 'bearer', expires_in: expiresIn, expires_at: Math.floor(Date.now() / 1000) + expiresIn,
      refresh_token: refresh, user: usuarioAuth(email),
    };
  };

  // ---------- Ficheros (GitHub simulado) ----------
  const datos = (repo, p) => {
    const f = store.get(`${repo}/${p}`);
    if (!f) return undefined;
    const texto = f.buf.toString('utf8');
    try {
      return JSON.parse(texto);
    } catch {
      return texto;
    }
  };
  const fijarDatos = (repo, p, valor) => {
    const buf = Buffer.from(typeof valor === 'string' ? valor : JSON.stringify(valor, null, 1) + '\n');
    store.set(`${repo}/${p}`, { buf, sha: shaGit(buf) });
  };
  const ficheroJson = (repo, p, f) => ({
    name: p.split('/').pop(), path: p, sha: f.sha, size: f.buf.length, type: 'file', encoding: 'base64',
    content: b64Lineas(f.buf), url: `https://api.github.com/repos/${OWNER}/${repo}/contents/${p}?ref=main`,
  });

  // GitHub REST simulado: solo lo que usan las apps. Devuelve un Response (fetch API) para los handlers.
  const gh = async (ruta, init = {}, via = 'funcion') => {
    const u = new URL(ruta, 'https://api.github.com');
    const metodo = (init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    const resp = (status, body, extra = {}) => new Response(body === undefined ? null : JSON.stringify(body), {
      status, headers: { ...(body === undefined ? {} : { 'content-type': 'application/json; charset=utf-8' }), ...extra },
    });
    let m = /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs\/([0-9a-f]+)$/.exec(u.pathname);
    if (m && metodo === 'GET') {
      const f = [...store.entries()].find(([k, v]) => k.startsWith(`${m[2]}/`) && v.sha === m[3]);
      if (m[1] !== OWNER || !f) return resp(404, { message: 'Not Found' });
      return resp(200, { sha: f[1].sha, size: f[1].buf.length, encoding: 'base64', content: b64Lineas(f[1].buf) });
    }
    m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(u.pathname);
    if (!m || m[1] !== OWNER) return resp(404, { message: 'Not Found' });
    const repo = m[2];
    const p = decodeURIComponent(m[3]);
    const clave = `${repo}/${p}`;
    const f = store.get(clave);
    if (metodo === 'GET') {
      const ref = u.searchParams.get('ref');
      if (ref && ref !== 'main') return resp(404, { message: 'No commit found for the ref ' + ref });
      if (!f) return resp(404, { message: 'Not Found' });
      const etag = `"${f.sha}"`;
      if (headers.get('if-none-match') === etag) return resp(304, undefined, { etag });
      return resp(200, ficheroJson(repo, p, f), { etag });
    }
    if (metodo === 'PUT') {
      let body;
      try {
        body = JSON.parse(typeof init.body === 'string' ? init.body : Buffer.from(init.body || '').toString('utf8'));
      } catch {
        return resp(400, { message: 'Problems parsing JSON' });
      }
      if (body.branch && body.branch !== 'main') return resp(404, { message: 'Branch not found' });
      if (f && !body.sha) return resp(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (f ? body.sha !== f.sha : !!body.sha) return resp(409, { message: `${p} does not match ${body.sha}` });
      const buf = Buffer.from(String(body.content || '').replace(/\s/g, ''), 'base64');
      const nuevo = { buf, sha: shaGit(buf) };
      store.set(clave, nuevo);
      let data;
      try {
        data = JSON.parse(buf.toString('utf8'));
      } catch {
        data = buf.toString('utf8');
      }
      estado.puts.push({
        repo, path: p, message: body.message, author: body.author ?? null, committer: body.committer ?? null, data, via,
      });
      const commit = crypto.createHash('sha1').update(nuevo.sha + estado.puts.length).digest('hex');
      const r = ficheroJson(repo, p, nuevo);
      delete r.content;
      delete r.encoding;
      return resp(f ? 200 : 201, { content: r, commit: { sha: commit, message: body.message } });
    }
    return resp(404, { message: 'Not Found' });
  };

  // ---------- Dependencias falsas de las funciones ----------
  const usuario = async (jwt) => {
    const p = leerJwt(jwt);
    return p ? { email: norm(p.email) } : null;
  };
  const acceso = async (email) => {
    const u = buscar(email);
    return u ? { email: u.email, nombre: u.nombre, roles: { ...u.roles }, admin: u.admin === true } : null;
  };
  const { crearHandler, crearHandlerAdmin } = cargarHandlers();
  const fnGithub = crearHandler({ usuario, acceso, gh: (p, init) => gh(p, init, 'funcion') });
  const fnAdmin = crearHandlerAdmin({
    usuario,
    acceso,
    listar: async () => usuarios.map((u) => ({ email: u.email, nombre: u.nombre, roles: { ...u.roles }, admin: u.admin === true })),
    guardar: async (a) => {
      const fila = { email: norm(a.email), nombre: a.nombre, roles: { ...a.roles }, admin: a.admin === true };
      const i = usuarios.findIndex((u) => u.email === fila.email);
      if (i >= 0) usuarios[i] = { ...usuarios[i], ...fila };
      else usuarios.push(fila);
    },
    borrar: async (email) => {
      usuarios = usuarios.filter((u) => u.email !== norm(email));
    },
    crearUsuarioAuth: async (email, password) => {
      claves.set(norm(email), password);
      return uuidDe(norm(email));
    },
    borrarUsuarioAuth: async (email) => {
      revocar(email);
      claves.delete(norm(email));
    },
    // Como updateUserById: cambia la contraseña sin cerrar las sesiones abiertas.
    ponerPassword: async (email, password) => {
      if (!claves.has(norm(email))) return false;
      claves.set(norm(email), password);
      return true;
    },
  });

  // ---------- Rutas (en Playwright gana la última registrada) ----------
  await ctx.route('**/*', (route) => {
    estado.bloqueadas.push(route.request().url());
    return route.abort('blockedbyclient');
  });

  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
    route.fulfill({ status: 200, contentType: 'text/css; charset=utf-8', body: '' }));

  // CDN → tests/node_modules, comprobando que la versión pedida es la instalada.
  const servirPaquete = (route, pkg, ver, fichero) => {
    let pj;
    try {
      pj = JSON.parse(fs.readFileSync(path.join(NODE_MODULES, pkg, 'package.json'), 'utf8'));
    } catch {
      return route.fulfill({ status: 404, body: `paquete ${pkg} no instalado en tests/node_modules` });
    }
    if (pj.version !== ver) return route.fulfill({ status: 404, body: `${pkg}@${ver} no instalado (hay ${pj.version})` });
    const base = path.join(NODE_MODULES, pkg);
    // Solo ficheros que existen en el paquete: una URL equivocada da 404 también en las pruebas.
    const full = path.resolve(base, fichero);
    if (!full.startsWith(base + path.sep)) return route.fulfill({ status: 404, body: 'Not Found' });
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return route.fulfill({ status: 404, body: 'Not Found' });
    return route.fulfill({
      status: 200, contentType: tipo(full), body: fs.readFileSync(full), headers: { 'access-control-allow-origin': '*' },
    });
  };
  await ctx.route(/^https:\/\/cdn\.jsdelivr\.net\/npm\//, (route) => {
    const u = new URL(route.request().url());
    const m = /^\/npm\/((?:@[^/@]+\/)?[^/@]+)@([^/]+)\/(.+)$/.exec(decodeURIComponent(u.pathname));
    if (!m) return route.fulfill({ status: 404, body: 'Not Found' });
    return servirPaquete(route, m[1], m[2], m[3]);
  });
  await ctx.route(/^https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\//, (route) => {
    const u = new URL(route.request().url());
    const m = /^\/ajax\/libs\/xlsx\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (!m) return route.fulfill({ status: 404, body: 'Not Found' });
    return servirPaquete(route, 'xlsx', m[1], path.posix.join('dist', m[2]));
  });

  // management-tools en GitHub Pages → mtDir
  await ctx.route(PAGES + '**', (route) => {
    const u = new URL(route.request().url());
    let rel;
    try {
      rel = decodeURIComponent(u.pathname.slice('/management-tools/'.length));
    } catch {
      return route.fulfill({ status: 400, body: 'Bad Request' });
    }
    let full = path.resolve(mtDir, rel);
    if (full !== mtDir && !full.startsWith(mtDir + path.sep)) return route.fulfill({ status: 404, body: 'Not Found' });
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) full = path.join(full, 'index.html');
    if (!fs.existsSync(full)) return route.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' });
    return route.fulfill({ status: 200, contentType: tipo(full), body: fs.readFileSync(full) });
  });
  await ctx.route(PAGES + 'acceso/config.js', (route) => route.fulfill({
    status: 200, contentType: 'text/javascript; charset=utf-8',
    body: `window.LAB_SUPABASE={url:${JSON.stringify(supabaseUrl)},anonKey:${JSON.stringify(anonKey)}};\n`,
  }));

  // ---------- Supabase ----------
  if (supabaseUrl) {
    const corsAuth = (origin) => ({
      'access-control-allow-origin': origin || '*',
      'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info, x-supabase-api-version',
      'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'access-control-expose-headers': 'x-supabase-api-version',
      vary: 'Origin',
    });
    const errorAuth = (status, code, msg, origin) => formato2024
      ? json(status, { code, msg }, { ...corsAuth(origin), 'x-supabase-api-version': '2024-01-01' })
      : json(status, { code: status, error_code: code, msg }, corsAuth(origin));

    await ctx.route(supabaseUrl + '/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const h = await req.allHeaders();
      const origin = h.origin;
      const metodo = req.method();

      // Funciones: los handlers reales reciben la ruta sin "/functions/v1", como en Supabase.
      const fm = /^\/functions\/v1(\/(?:github|admin)(?:\/.*)?)$/.exec(u.pathname);
      if (fm) {
        const cabeceras = new Headers();
        for (const [k, v] of Object.entries(h)) if (!k.startsWith(':')) cabeceras.set(k, v);
        const cuerpo = metodo === 'GET' || metodo === 'HEAD' || metodo === 'OPTIONS' ? undefined : req.postDataBuffer() ?? undefined;
        const r = await (fm[1].startsWith('/github') ? fnGithub : fnAdmin)(
          new Request(`${supabaseUrl}${fm[1]}${u.search}`, { method: metodo, headers: cabeceras, body: cuerpo }),
        );
        const body = r.status === 204 || r.status === 304 ? undefined : Buffer.from(await r.arrayBuffer());
        return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers.entries()), body });
      }

      if (metodo === 'OPTIONS') return route.fulfill({ status: 204, headers: corsAuth(origin) });
      if (h.apikey !== anonKey) return route.fulfill(json(401, { message: 'Invalid API key' }, corsAuth(origin)));
      let body = {};
      try {
        body = req.postData() ? JSON.parse(req.postData()) : {};
      } catch { /* cuerpo vacío */ }

      if (u.pathname === '/auth/v1/token' && metodo === 'POST' && u.searchParams.get('grant_type') === 'password') {
        const email = norm(body.email);
        estado.logins.push({ email: body.email }); // sin la contraseña
        const clave = claves.get(email);
        if (!body.email || !buscar(email) || clave === undefined || body.password !== clave) {
          return route.fulfill(errorAuth(400, 'invalid_credentials', 'Invalid login credentials', origin));
        }
        return route.fulfill(json(200, nuevaSesion(email), corsAuth(origin)));
      }
      if (u.pathname === '/auth/v1/otp' && metodo === 'POST') {
        estado.otps.push(body);
        // Registro libre desactivado: solo los usuarios dados de alta reciben código.
        if (!body.email || !buscar(body.email) || body.email !== norm(body.email) || body.create_user !== false) {
          return route.fulfill(errorAuth(422, 'otp_disabled', 'Signups not allowed for otp', origin));
        }
        codigosPedidos.set(body.email, Date.now());
        return route.fulfill(json(200, {}, corsAuth(origin)));
      }
      if (u.pathname === '/auth/v1/verify' && metodo === 'POST') {
        estado.verifies.push(body);
        if (body.type !== 'email' || !body.email) {
          return route.fulfill(errorAuth(400, 'validation_failed', 'Verify requires a verification type', origin));
        }
        const email = norm(body.email);
        const pedido = codigosPedidos.get(email);
        const vigente = pedido !== undefined && Date.now() - pedido <= VALIDEZ_CODIGO_MS;
        if (!buscar(email) || !vigente || String(body.token) !== codigo) {
          return route.fulfill(errorAuth(403, 'otp_expired', 'Token has expired or is invalid', origin));
        }
        codigosPedidos.delete(email); // de un solo uso
        return route.fulfill(json(200, nuevaSesion(email), corsAuth(origin)));
      }
      if (u.pathname === '/auth/v1/token' && metodo === 'POST' && u.searchParams.get('grant_type') === 'refresh_token') {
        const sid = refreshes.get(body.refresh_token);
        const s = sid && sesiones.get(sid);
        if (!s || s.revocada || !buscar(s.email)) {
          return route.fulfill(errorAuth(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found', origin));
        }
        refreshes.delete(body.refresh_token);
        estado.refrescos++;
        return route.fulfill(json(200, nuevaSesion(s.email, sid), corsAuth(origin)));
      }
      const jwt = (/^Bearer\s+(\S+)$/i.exec(h.authorization || '') || [])[1];
      if (u.pathname === '/auth/v1/user' && metodo === 'GET') {
        const p = jwt && leerJwt(jwt);
        if (!p) return route.fulfill(errorAuth(403, 'bad_jwt', 'invalid JWT: unable to parse or verify signature', origin));
        return route.fulfill(json(200, usuarioAuth(norm(p.email)), corsAuth(origin)));
      }
      if (u.pathname === '/auth/v1/logout' && metodo === 'POST') {
        const p = jwt && leerJwt(jwt);
        estado.logouts.push({ email: p ? p.email : null, scope: u.searchParams.get('scope') });
        if (p) {
          const s = sesiones.get(p.session_id);
          if (s) s.revocada = true;
        }
        return route.fulfill({ status: 204, headers: corsAuth(origin) });
      }
      return route.fulfill(json(404, { message: 'Not Found' }, corsAuth(origin)));
    });
  }

  // ---------- Modo clave de GitHub ----------
  const corsGh = {
    'access-control-allow-origin': '*',
    'access-control-expose-headers': 'ETag, X-RateLimit-Remaining',
    'access-control-allow-headers': 'Authorization, Content-Type, If-None-Match, Accept',
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
  };
  await ctx.route(/^https:\/\/api\.github\.com\//, async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const metodo = req.method();
    if (metodo === 'OPTIONS') return route.fulfill({ status: 204, headers: corsGh });
    const h = await req.allHeaders();
    const token = (/^(?:Bearer|token)\s+(\S+)$/i.exec(h.authorization || '') || [])[1];
    if (!token) return route.fulfill(json(401, { message: 'Requires authentication' }, corsGh));
    const g = opts.github;
    if (!g || (g.token && g.token !== token)) return route.fulfill(json(401, { message: 'Bad credentials' }, corsGh));
    if (u.pathname === '/user' && metodo === 'GET') {
      return route.fulfill(json(200, { login: g.login, id: 1, name: g.name ?? g.login }, corsGh));
    }
    const repos = new Set(Object.keys(dataDirs));
    const rm = /^\/repos\/([^/]+)\/([^/]+)$/.exec(u.pathname);
    if (rm && metodo === 'GET') {
      if (rm[1] !== OWNER || !repos.has(rm[2])) return route.fulfill(json(404, { message: 'Not Found' }, corsGh));
      return route.fulfill(json(200, {
        name: rm[2], full_name: `${OWNER}/${rm[2]}`, private: true, default_branch: 'main',
        permissions: { admin: false, push: !!g.push, pull: true },
      }, corsGh));
    }
    if (/^\/repos\/[^/]+\/[^/]+\/(contents|git\/blobs)\//.test(u.pathname) && (metodo === 'GET' || metodo === 'PUT')) {
      if (metodo === 'PUT' && !g.push) {
        return route.fulfill(json(403, { message: 'Resource not accessible by personal access token' }, corsGh));
      }
      const init = { method: metodo, headers: {} };
      if (h['if-none-match']) init.headers['If-None-Match'] = h['if-none-match'];
      if (metodo === 'PUT') init.body = req.postData() || '';
      const r = await gh(u.pathname + u.search, init, 'clave');
      const body = r.status === 304 ? undefined : Buffer.from(await r.arrayBuffer());
      return route.fulfill({ status: r.status, headers: { ...Object.fromEntries(r.headers.entries()), ...corsGh }, body });
    }
    return route.fulfill(json(404, { message: 'Not Found' }, corsGh));
  });
  await ctx.route(/^https:\/\/raw\.githubusercontent\.com\//, (route) => {
    const u = new URL(route.request().url());
    const m = /^\/([^/]+)\/([^/]+)\/main\/(.+)$/.exec(u.pathname);
    const f = m && m[1] === OWNER && rawPublico.has(m[2]) && store.get(`${m[2]}/${decodeURIComponent(m[3])}`);
    if (!f) return route.fulfill({ status: 404, contentType: 'text/plain', body: '404: Not Found', headers: { 'access-control-allow-origin': '*' } });
    return route.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: f.buf, headers: { 'access-control-allow-origin': '*' } });
  });

  return {
    puts: estado.puts,
    logins: estado.logins,
    otps: estado.otps,
    verifies: estado.verifies,
    tokens: estado.tokens,
    logouts: estado.logouts,
    bloqueadas: estado.bloqueadas,
    get refrescos() {
      return estado.refrescos;
    },
    setUsuarios,
    usuarios: () => usuarios.map((u) => ({ ...u, roles: { ...u.roles } })),
    claveDe: (email) => claves.get(norm(email)),
    revocar,
    datos,
    fijarDatos,
  };
}

module.exports = { setupLab, CLAVE_PRUEBA };
