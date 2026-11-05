// Pruebas de acceso/lab-auth.js contra la simulación de Supabase y GitHub (tests/e2e/lab-mock.js).
// Uso, desde la raíz del repositorio: node tests/e2e/lab-auth.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab } = require('./lab-mock.js');

const BASE = 'https://polinya-lab.github.io/management-tools/';
const PAGINA = BASE + '__prueba-lab-auth.html';
const HTML = `<!doctype html><meta charset="utf-8"><title>prueba</title>
<script src="acceso/config.js"></script><script src="acceso/lab-auth.js"></script><body>ok</body>`;

const USUARIOS = [
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { ensayos: 'editar', muestras: 'ver' }, admin: true },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { ensayos: 'ver' }, admin: false },
];

let fallos = 0;
async function check(nombre, fn) {
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FAIL ${nombre}\n     ${String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')}`);
  }
}

// Abre la página de prueba en un contexto nuevo con la simulación. Devuelve {ctx, page, lab, errores, peticiones}.
async function abrir(browser, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...opts });
  await ctx.route(PAGINA, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: HTML }));
  const page = await ctx.newPage();
  const errores = [];
  const peticiones = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('request', (r) => peticiones.push(r.url()));
  await page.goto(PAGINA);
  await page.evaluate(() => window.LabAuth.listo);
  return { ctx, page, lab, errores, peticiones };
}

// Ejecuta fn en la página y devuelve {ok, valor} o {ok:false, error:{code, message}}.
const enPagina = (page, fn, arg) => page.evaluate(async ([src, a]) => {
  try {
    return { ok: true, valor: await (0, eval)(`(${src})`)(a) };
  } catch (e) {
    return { ok: false, error: { code: e && e.code, message: e && e.message } };
  }
}, [fn.toString(), arg]);

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- Con configuración de Supabase ----------
    const { page, lab, errores, peticiones, ctx } = await abrir(browser);

    await check('config.js inyectado y LabAuth.activo === true; supabase-js cargado desde jsDelivr', async () => {
      const r = await page.evaluate(() => ({
        url: window.LAB_SUPABASE.url, activo: window.LabAuth.activo, sdk: typeof (window.supabase && window.supabase.createClient),
      }));
      assert.deepEqual(r, { url: 'https://lab-test.supabase.co', activo: true, sdk: 'function' });
      assert.ok(peticiones.includes('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.js'));
    });

    await check('supabase-js con Subresource Integrity (sha384 del fichero servido) y crossorigin="anonymous"', async () => {
      const fs = require('node:fs');
      const path = require('node:path');
      const crypto = require('node:crypto');
      const fichero = path.resolve(__dirname, '..', 'node_modules', '@supabase', 'supabase-js', 'dist', 'umd', 'supabase.js');
      const esperado = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(fichero)).digest('base64');
      const r = await page.evaluate(() => {
        const s = document.querySelector('script[src*="@supabase/supabase-js@"]');
        return s && { integrity: s.integrity, crossorigin: s.getAttribute('crossorigin') };
      });
      assert.deepEqual(r, { integrity: esperado, crossorigin: 'anonymous' });
    });

    await check('sin sesión: sesion() === null', async () => {
      assert.equal(await page.evaluate(() => window.LabAuth.sesion()), null);
    });

    await check('entrar con contraseña incorrecta → {code:"bad_credentials"} y sigue sin sesión', async () => {
      const r = await enPagina(page, () => window.LabAuth.entrar('ana.ruiz@fluidra.com', 'no-es-la-clave'));
      assert.equal(r.ok, false);
      assert.equal(r.error.code, 'bad_credentials');
      assert.equal(await page.evaluate(() => window.LabAuth.sesion()), null);
    });

    await check('entrar con un correo no dado de alta → {code:"bad_credentials"}', async () => {
      const r = await enPagina(page, () => window.LabAuth.entrar('nadie@fluidra.com', 'clave-de-prueba-1234'));
      assert.equal(r.ok, false);
      assert.equal(r.error.code, 'bad_credentials');
    });

    await check('entrar con correo vacío o sin contraseña → {code:"bad_credentials"} sin llamar a Auth', async () => {
      const antes = lab.logins.length;
      for (const [e, p] of [['', 'clave-de-prueba-1234'], ['ana.ruiz@fluidra.com', ''], ['sin-arroba', 'clave-de-prueba-1234']]) {
        const r = await enPagina(page, ([e, p]) => window.LabAuth.entrar(e, p), [e, p]);
        assert.equal(r.ok, false);
        assert.equal(r.error.code, 'bad_credentials');
      }
      assert.equal(lab.logins.length, antes);
    });

    await page.evaluate(() => {
      window.__cambios = [];
      window.LabAuth.onCambio((s) => window.__cambios.push(s));
    });

    await check("entrar('  ANA.Ruiz@Fluidra.com ', clave) → correo normalizado, sesión y aviso a onCambio", async () => {
      const r = await enPagina(page, () => window.LabAuth.entrar('  ANA.Ruiz@Fluidra.com ', 'clave-de-prueba-1234'));
      assert.deepEqual(r, { ok: true, valor: undefined });
      assert.equal(lab.logins.at(-1).email, 'ana.ruiz@fluidra.com');
      assert.deepEqual(await page.evaluate(() => window.LabAuth.sesion()), { email: 'ana.ruiz@fluidra.com' });
      assert.deepEqual(await page.evaluate(() => window.__cambios), [{ email: 'ana.ruiz@fluidra.com' }]);
      assert.ok(await page.evaluate(() => !!localStorage.getItem('lab-auth')), 'sesión guardada con storageKey lab-auth');
    });

    await check('la contraseña no se guarda en localStorage', async () => {
      const todo = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
      assert.ok(!todo.includes('clave-de-prueba-1234'));
    });

    await check('api() y cabeceras() dan acceso a la función github simulada (permisos reales)', async () => {
      const r = await page.evaluate(async () => {
        const L = window.LabAuth;
        const h = await L.cabeceras();
        const u = await fetch(L.api('ensayos') + '/user', { headers: h });
        const f = await fetch(L.api('ensayos') + '/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main', { headers: h });
        const j = await f.json();
        const ajeno = await fetch(L.api('ensayos') + '/repos/Polinya-LAB/endurance-data/contents/piscina.json', { headers: h });
        return { api: L.api('ensayos'), h, user: await u.json(), st: f.status, etag: f.headers.get('etag'),
          tests: Object.keys(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\s/g, '')), (c) => c.charCodeAt(0)))).tests).length,
          ajeno: ajeno.status };
      });
      assert.equal(r.api, 'https://lab-test.supabase.co/functions/v1/github/ensayos');
      assert.equal(r.h.apikey, 'anon-test');
      assert.match(r.h.Authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]*$/);
      assert.deepEqual(r.user, { login: 'Ana Ruiz', name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
      assert.equal(r.st, 200);
      assert.ok(r.etag, 'ETag expuesto');
      assert.ok(r.tests >= 2);
      assert.equal(r.ajeno, 403);
    });

    await check('ETag sin cambios → 304', async () => {
      const st = await page.evaluate(async () => {
        const L = window.LabAuth;
        const url = L.api('ensayos') + '/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json?ref=main';
        const a = await fetch(url, { headers: await L.cabeceras(), cache: 'no-store' });
        const b = await fetch(url, { headers: { ...await L.cabeceras(), 'If-None-Match': a.headers.get('etag') }, cache: 'no-store' });
        return b.status;
      });
      assert.equal(st, 304);
    });

    await check('PUT por la función: se registra con autor y datos; sha viejo → 409', async () => {
      const r = await page.evaluate(async () => {
        const L = window.LabAuth;
        const url = L.api('ensayos') + '/repos/Polinya-LAB/lab-data/contents/ensayos/ensayos.json';
        const h = await L.cabeceras();
        const j = await (await fetch(url + '?ref=main', { headers: h })).json();
        const dec = (b) => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\s/g, '')), (c) => c.charCodeAt(0)));
        const enc = (s) => btoa(String.fromCharCode(...new TextEncoder().encode(s)));
        const d = JSON.parse(dec(j.content));
        d.tests['t-demo-002'].status = 'Planned';
        const body = (sha) => JSON.stringify({ message: 'Prueba', content: enc(JSON.stringify(d)), sha, branch: 'main' });
        const ok = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: body(j.sha) });
        const okJ = await ok.json();
        const viejo = await fetch(url, { method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' }, body: body(j.sha) });
        return { ok: ok.status, nuevoSha: okJ.content.sha, antes: j.sha, viejo: viejo.status };
      });
      assert.equal(r.ok, 200);
      assert.notEqual(r.nuevoSha, r.antes);
      assert.equal(r.viejo, 409);
      assert.equal(lab.puts.length, 1);
      const p = lab.puts[0];
      assert.equal(p.repo, 'lab-data');
      assert.equal(p.path, 'ensayos/ensayos.json');
      assert.equal(p.message, 'Prueba');
      assert.deepEqual(p.author, { name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
      assert.equal(p.data.tests['t-demo-002'].status, 'Planned');
      assert.equal(lab.datos('lab-data', 'ensayos/ensayos.json').tests['t-demo-002'].status, 'Planned');
    });

    await check('función admin simulada: GET /usuarios para un administrador', async () => {
      const r = await page.evaluate(async () => {
        const res = await fetch(window.LAB_SUPABASE.url + '/functions/v1/admin/usuarios', { headers: await window.LabAuth.cabeceras() });
        return { st: res.status, n: (await res.json()).usuarios.length };
      });
      assert.deepEqual(r, { st: 200, n: 2 });
    });

    await check('tras recargar la página la sesión sigue', async () => {
      await page.reload();
      await page.evaluate(() => window.LabAuth.listo);
      assert.deepEqual(await page.evaluate(() => window.LabAuth.sesion()), { email: 'ana.ruiz@fluidra.com' });
    });

    await check('revocar(email) → la siguiente consulta a la función recibe 401 (la app pasa a "Sign in again")', async () => {
      lab.revocar('ANA.RUIZ@fluidra.com');
      const st = await page.evaluate(async () => {
        const res = await fetch(window.LabAuth.api('ensayos') + '/user', { headers: await window.LabAuth.cabeceras() });
        return res.status;
      });
      assert.equal(st, 401);
    });

    await check('salir() borra la sesión, la guarda vacía y avisa a onCambio', async () => {
      await page.evaluate(() => {
        window.__cambios = [];
        window.LabAuth.onCambio((s) => window.__cambios.push(s));
      });
      const r = await enPagina(page, () => window.LabAuth.salir());
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(await page.evaluate(() => window.LabAuth.sesion()), null);
      assert.equal(await page.evaluate(() => localStorage.getItem('lab-auth')), null);
      assert.deepEqual(await page.evaluate(() => window.__cambios), [null]);
      await page.reload();
      await page.evaluate(() => window.LabAuth.listo);
      assert.equal(await page.evaluate(() => window.LabAuth.sesion()), null);
    });

    await check('cabeceras() sin sesión: solo apikey (la función responde 401)', async () => {
      const r = await page.evaluate(async () => {
        const h = await window.LabAuth.cabeceras();
        const res = await fetch(window.LabAuth.api('ensayos') + '/user', { headers: h });
        return { h, st: res.status };
      });
      assert.deepEqual(r, { h: { apikey: 'anon-test' }, st: 401 });
    });

    await check('setUsuarios: un alta nueva entra con su contraseña (usuarios[].password)', async () => {
      lab.setUsuarios([...USUARIOS, { email: 'Nuevo@Fluidra.com', nombre: 'Nuevo', roles: {}, admin: false, password: 'otra-clave-de-16c' }]);
      const mal = await enPagina(page, () => window.LabAuth.entrar('nuevo@fluidra.com', 'clave-de-prueba-1234'));
      assert.equal(mal.error && mal.error.code, 'bad_credentials');
      const r = await enPagina(page, () => window.LabAuth.entrar('nuevo@fluidra.com', 'otra-clave-de-16c'));
      assert.equal(r.ok, true, JSON.stringify(r));
      await enPagina(page, () => window.LabAuth.salir());
    });

    await check('ningún error de consola ni petición fuera de la simulación', async () => {
      assert.deepEqual(lab.bloqueadas, []);
      // Los 4xx esperados de fetch aparecen como "Failed to load resource"; cualquier otro error, no.
      assert.deepEqual(errores.filter((e) => !/Failed to load resource: the server responded with a status of (40[013]|409|422)/.test(e)), []);
    });
    await ctx.close();

    // ---------- Token a punto de caducar: cabeceras() lo renueva ----------
    await check('cabeceras() renueva el JWT si caduca (refresh_token)', async () => {
      const t = await abrir(browser, { expiresIn: 60 });
      try {
        const v = await enPagina(t.page, () => window.LabAuth.entrar('luis.ver@fluidra.com', 'clave-de-prueba-1234'));
        assert.equal(v.ok, true, JSON.stringify(v));
        const primero = t.lab.tokens.at(-1);
        const h = await t.page.evaluate(() => window.LabAuth.cabeceras());
        assert.ok(t.lab.refrescos >= 1, 'se llamó a /auth/v1/token?grant_type=refresh_token');
        assert.notEqual(h.Authorization, `Bearer ${primero}`);
        const st = await t.page.evaluate(async (h) => (await fetch(window.LabAuth.api('ensayos') + '/user', { headers: h })).status, h);
        assert.equal(st, 200);
      } finally {
        await t.ctx.close();
      }
    });

    // ---------- Errores de Auth con el formato de API 2024-01-01 ----------
    await check('errores en formato 2024-01-01 también se traducen (bad_credentials)', async () => {
      const t = await abrir(browser, { formatoErrores: '2024' });
      try {
        const c = await enPagina(t.page, () => window.LabAuth.entrar('ana.ruiz@fluidra.com', 'no-es-la-clave'));
        assert.equal(c.error && c.error.code, 'bad_credentials');
        const n = await enPagina(t.page, () => window.LabAuth.entrar('nadie@fluidra.com', 'clave-de-prueba-1234'));
        assert.equal(n.error && n.error.code, 'bad_credentials');
      } finally {
        await t.ctx.close();
      }
    });

    // ---------- entrar: demasiados intentos, servicio caído y sin red ----------
    await check('entrar: 429 → rate; 500/503 → unavailable; sin red → unavailable', async () => {
      const t = await abrir(browser);
      try {
        const casos = [[429, 'rate'], [500, 'unavailable'], [503, 'unavailable'], [0, 'unavailable']];
        for (const [st, code] of casos) {
          await t.ctx.route(/\/auth\/v1\/token\?grant_type=password/, (route) => {
            if (route.request().method() === 'OPTIONS') return route.fallback();
            if (!st) return route.abort('failed');
            return route.fulfill({
              status: st, contentType: 'application/json',
              headers: { 'access-control-allow-origin': 'https://polinya-lab.github.io' },
              body: JSON.stringify(st === 429 ? { code: 429, error_code: 'over_request_rate_limit', msg: 'Request rate limit reached' } : { code: st, msg: 'boom' }),
            });
          });
          const r = await enPagina(t.page, () => window.LabAuth.entrar('ana.ruiz@fluidra.com', 'clave-de-prueba-1234'));
          assert.equal(r.error && r.error.code, code, `${st}: ${JSON.stringify(r)}`);
          await t.ctx.unroute(/\/auth\/v1\/token\?grant_type=password/);
        }
        assert.equal(await t.page.evaluate(() => window.LabAuth.sesion()), null);
      } finally {
        await t.ctx.close();
      }
    });

    // ---------- El código por correo ya no existe ----------
    await check('pedirCodigo y verificar ya no existen; LabAuth está congelado', async () => {
      const t = await abrir(browser);
      try {
        const r = await t.page.evaluate(() => ({
          p: typeof window.LabAuth.pedirCodigo, v: typeof window.LabAuth.verificar, frozen: Object.isFrozen(window.LabAuth),
        }));
        assert.deepEqual(r, { p: 'undefined', v: 'undefined', frozen: true });
      } finally {
        await t.ctx.close();
      }
    });

    // ---------- Sin configuración ----------
    await check("LAB_SUPABASE={url:'',anonKey:''} → activo === false y no se carga supabase-js", async () => {
      const t = await abrir(browser, { supabaseUrl: '', anonKey: '' });
      try {
        const r = await t.page.evaluate(async () => ({
          activo: window.LabAuth.activo, sdk: typeof window.supabase, sesion: await window.LabAuth.sesion(),
        }));
        assert.deepEqual(r, { activo: false, sdk: 'undefined', sesion: null });
        assert.ok(!t.peticiones.some((u) => u.includes('supabase')), t.peticiones.join(', '));
        assert.deepEqual(t.errores, []);
      } finally {
        await t.ctx.close();
      }
    });

    // ---------- Modo clave de GitHub (api.github.com simulado) ----------
    await check('modo clave de GitHub: /user, /repos y contents GET/PUT sobre los mismos ficheros', async () => {
      const t = await abrir(browser, { github: { login: 'persona-gh', push: true } });
      try {
        const r = await t.page.evaluate(async () => {
          const h = { Accept: 'application/vnd.github+json', Authorization: 'Bearer ghp_prueba' };
          const api = 'https://api.github.com/repos/Polinya-LAB/lab-data';
          const u = await (await fetch('https://api.github.com/user', { headers: h })).json();
          const repo = await (await fetch(api, { headers: h })).json();
          const f = await fetch(api + '/contents/mantenimiento/registro.json?ref=main', { headers: h, cache: 'no-store' });
          const j = await f.json();
          const put = await fetch(api + '/contents/mantenimiento/registro.json', {
            method: 'PUT', headers: { ...h, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: 'Clave', content: btoa('{"records":{},"config":{}}'), sha: j.sha, branch: 'main' }),
          });
          const sinClave = await fetch('https://api.github.com/user');
          const raw = await fetch('https://raw.githubusercontent.com/Polinya-LAB/lab-data/main/ensayos/ensayos.json');
          return { login: u.login, push: repo.permissions.push, st: f.status, put: put.status, sinClave: sinClave.status, raw: raw.status };
        });
        assert.deepEqual(r, { login: 'persona-gh', push: true, st: 200, put: 200, sinClave: 401, raw: 404 });
        assert.equal(t.lab.puts.length, 1);
        assert.equal(t.lab.puts[0].message, 'Clave');
        assert.deepEqual(t.lab.datos('lab-data', 'mantenimiento/registro.json'), { records: {}, config: {} });
      } finally {
        await t.ctx.close();
      }
    });
  } finally {
    await browser.close();
  }
  console.log(fallos ? `\n${fallos} prueba(s) fallida(s)` : '\nTodas las pruebas pasan');
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
