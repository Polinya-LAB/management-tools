// Pruebas del Plan de calibraciones (calibraciones/index.html) con el acceso por correo y con la clave de GitHub,
// sobre la simulación de tests/e2e/lab-mock.js (datos inventados).
// Uso, desde la raíz del repositorio: node tests/e2e/calibraciones.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab } = require('./lab-mock.js');

const URL_APP = 'https://polinya-lab.github.io/management-tools/calibraciones/';
const FICHERO = 'calibraciones/calibraciones.json';
const CERTS = 'calibraciones/certificados.json';
const CONTENTS = '/functions/v1/github/';

const USUARIOS = [
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { calibraciones: 'editar' }, admin: false },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { calibraciones: 'ver' }, admin: false },
  { email: 'nora.n@fluidra.com', nombre: 'Nora Nadie', roles: { ensayos: 'editar' }, admin: false },
];

let fallos = 0;
async function check(nombre, fn) {
  try {
    await fn();
    console.log(`ok   ${nombre}`);
  } catch (e) {
    fallos++;
    console.log(`FAIL ${nombre}\n     ${String(e && e.stack || e).split('\n').slice(0, 5).join('\n     ')}`);
  }
}

// 4xx esperados (401 de la sesión caducada, 403 de un rol sin acceso, 409/422 de conflictos) salen en la consola como
// "Failed to load resource"; también el 404 de la lectura anónima de raw.githubusercontent.com (lab-data es privado).
const erroresReales = (errores, extra = '') =>
  errores.filter((e) => !new RegExp(`Failed to load resource: the server responded with a status of (40[134]|409|422${extra})`).test(e));
const otros404 = (respuestas) => respuestas.filter((r) => r.status === 404 && !r.url.startsWith('https://raw.githubusercontent.com/'));

async function averiarUser(ctx, estado) {
  await ctx.route(/\/functions\/v1\/github\/[^/]+\/user$/, (route) => {
    if (!estado.status || route.request().method() === 'OPTIONS') return route.fallback();
    estado.fallos = (estado.fallos || 0) + 1;
    return route.fulfill({ status: estado.status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': 'https://polinya-lab.github.io' }, body: '{"message":"Error al contactar con el servicio"}' });
  });
}

async function abrir(browser, opts = {}) {
  const { reloj, clave, ...lab_opts } = opts;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...lab_opts });
  if (clave) await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('__k')) { localStorage.setItem('pd-gh-token', t); sessionStorage.setItem('__k', '1'); } } catch (e) { /* */ } }, clave);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errores = [], peticiones = [], respuestas = [];
  errores.otros404 = () => otros404(respuestas);
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('request', (r) => peticiones.push({ url: r.url(), method: r.method(), headers: r.headers() }));
  page.on('response', (r) => respuestas.push({ url: r.url(), status: r.status() }));
  if (reloj) await page.clock.install();
  await page.goto(URL_APP);
  await esperarCarga(page);
  return { ctx, page, lab, errores, peticiones };
}
const esperarCarga = (page) => page.waitForFunction(() => {
  const v = document.querySelector('#view');
  return v && !/Loading calibration data/.test(v.textContent);
});
const textoBoton = (page) => page.locator('#btn-gh span').textContent();
const lecturas = (peticiones, origen, f = FICHERO) =>
  peticiones.filter((p) => p.method === 'GET' && p.url.startsWith(origen) && p.url.includes('/contents/' + f)).length;
const lecturasFuncion = (peticiones, f) => lecturas(peticiones, 'https://lab-test.supabase.co' + CONTENTS, f);
const lecturasGithub = (peticiones, f) => lecturas(peticiones, 'https://api.github.com/', f);

async function entrar(page, email, nombre) {
  await page.click('#btn-gh');
  await page.waitForSelector('#gh-mail');
  assert.ok(await page.locator('#dlg').getByText('Sign in with your email').isVisible());
  await page.fill('#gh-mail', email);
  await page.press('#gh-mail', 'Enter');
  await page.waitForSelector('#gh-code');
  await page.fill('#gh-code', '123456');
  await page.press('#gh-code', 'Enter');
  await page.waitForFunction((n) => document.querySelector('#btn-gh span').textContent === n && !document.querySelector('#dlg').open, nombre);
}
const botonesEdicion = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-act="eq-new"],[data-act="cal-new"]')].filter((b) => b.offsetParent !== null).length);
async function registrarPlan(page) {
  await page.click('#tabs [data-view="calibrations"]');
  await page.click('#view [data-act="cal-new"]');
  await page.selectOption('#f-equipmentId', 'eq-DEMO-002');
  await page.selectOption('#f-status', 'Planned');
  await page.fill('#f-month', '2027-06');
  await page.click('#dlg-form button[type="submit"]');
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- editar ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('diálogo: "Sign in with your email" arriba y "Use a GitHub key" debajo; correo no registrado avisa', async () => {
        assert.equal(await textoBoton(page), 'Sign in');
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        const a = await page.locator('#dlg').getByText('Sign in with your email').boundingBox();
        const b = await page.locator('#dlg').getByText('Use a GitHub key').boundingBox();
        assert.ok(a && b && a.y < b.y);
        await page.fill('#gh-mail', 'nadie@fluidra.com');
        await page.press('#gh-mail', 'Enter');
        await page.waitForFunction(() => !document.querySelector('#f-err').hidden);
        assert.match(await page.locator('#f-err').textContent(), /not registered/i);
        await page.click('#dlg [data-act="close"]');
      });
      await check('editar: entra con correo (con mayúsculas y espacios) y se leen calibraciones.json y certificados.json por la función', async () => {
        await entrar(page, '  Ana.Ruiz@Fluidra.com ', 'Ana Ruiz');
        assert.ok(lecturasFuncion(peticiones, FICHERO) >= 1, 'calibraciones.json');
        await waitFor(() => lecturasFuncion(peticiones, CERTS) >= 1);
        assert.match(await page.locator('#view').textContent(), /DEMO-001/);
        assert.ok(await botonesEdicion(page) > 0, 'botones de edición visibles');
      });
      await check('editar: registrar una calibración genera un PUT a la función con el nombre de la persona', async () => {
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await waitFor(() => lab.puts.length === 1);
        const p = lab.puts[0];
        assert.equal(p.via, 'funcion');
        assert.match(p.message, /^Plan de calibraciones: /);
        assert.deepEqual(p.author, { name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
        assert.ok(Object.values(p.data.calibrations).some((c) => c.equipmentId === 'eq-DEMO-002' && c.month === '2027-06'));
      });
      await check('la sesión sigue al recargar; salir vuelve a "Sign in" en solo lectura', async () => {
        await page.reload();
        await esperarCarga(page);
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        await page.click('#btn-gh');
        await page.click('#dlg [data-act="gh-out"]');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in');
        assert.equal(await botonesEdicion(page), 0);
      });
      await check('salir: los datos privados salen de la pantalla y de la memoria, sale el aviso de datos privados y no hay peticiones con credenciales a GitHub', async () => {
        const t = await page.evaluate(() => document.body.innerText);
        assert.doesNotMatch(t, /DEMO-00[0-9]/);
        assert.match(await page.locator('#view').textContent(), /calibration data is private/i);
        assert.equal(peticiones.filter((q) => q.url.startsWith('https://api.github.com/') || ((q.headers.authorization || q.headers.apikey) && q.url.startsWith('https://raw.githubusercontent.com/'))).length, 0);
      });
      await check('editar: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- ver ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser);
      await check('ver: se leen los dos ficheros, no hay botones de edición ni PUT', async () => {
        await entrar(page, 'luis.ver@fluidra.com', 'Luis Ver');
        await waitFor(() => lecturasFuncion(peticiones, CERTS) >= 1);
        assert.match(await page.locator('#view').textContent(), /DEMO-001/);
        assert.equal(await botonesEdicion(page), 0);
        await page.click('#tabs [data-view="calibrations"]');
        assert.equal(await botonesEdicion(page), 0);
        assert.match(await page.locator('#view').textContent(), /cannot change|view the data/i);
        assert.equal(lab.puts.length, 0);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- ninguno ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser);
      await check('ninguno: "You don\'t have access to this app. Ask an administrator." y ningún dato', async () => {
        await entrar(page, 'nora.n@fluidra.com', 'Nora Nadie');
        await page.waitForFunction(() => /You don't have access to this app\. Ask an administrator\./.test(document.querySelector('#view').textContent));
        assert.doesNotMatch(await page.locator('#view').textContent(), /DEMO-001/);
        assert.equal(peticiones.filter((p) => p.url.includes('/contents/')).length, 0);
        assert.equal(await botonesEdicion(page), 0);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- 401 con la app abierta y consulta periódica ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('entrar (Ana) con el reloj simulado', async () => { await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz'); });
      await check('consulta periódica con sesión de correo: cada 60 s (no a los 30 s)', async () => {
        const n0 = lecturasFuncion(peticiones, FICHERO);
        await page.clock.fastForward(61000);
        await waitFor(() => lecturasFuncion(peticiones, FICHERO) === n0 + 1);
        const n = lecturasFuncion(peticiones, FICHERO);
        await page.clock.fastForward(31000);
        await page.waitForTimeout(400);
        assert.equal(lecturasFuncion(peticiones, FICHERO), n, 'sin lectura a los 31 s');
        await page.clock.fastForward(30000);
        await waitFor(() => lecturasFuncion(peticiones, FICHERO) === n + 1);
      });
      await check('cambio pendiente cuando la sesión deja de valer → aviso y "Sign in again"; no se envía', async () => {
        lab.revocar('ana.ruiz@fluidra.com');
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await page.waitForFunction(() => !document.querySelector('#toast').hidden && /expired/i.test(document.querySelector('#toast').textContent));
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in again');
        assert.equal(lab.puts.length, 0);
      });
      await check('401 en la siguiente consulta: los datos siguen en pantalla, solo lectura', async () => {
        await page.clock.fastForward(61000);
        await page.waitForTimeout(400);
        assert.equal(await textoBoton(page), 'Sign in again');
        const txt = await page.locator('#view').textContent();
        assert.match(txt, /DEMO-001/);
        assert.match(txt, /session has expired/i);
        assert.equal(await botonesEdicion(page), 0);
      });
      await check('"Sign in again" abre el diálogo en el paso del correo con el correo puesto; volver a entrar recupera la edición', async () => {
        lab.setUsuarios(USUARIOS);
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        assert.equal(await page.inputValue('#gh-mail'), 'ana.ruiz@fluidra.com');
        await page.press('#gh-mail', 'Enter');
        await page.waitForSelector('#gh-code');
        await page.fill('#gh-code', '123456');
        await page.press('#gh-code', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        assert.ok(await botonesEdicion(page) > 0);
      });
      await check('401: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- La función falla al arrancar con una sesión guardada (sin 401) ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser);
      const averia = { status: 0 };
      await averiarUser(ctx, averia);
      const conCabecera = [];
      ctx.on('request', (r) => {
        const h = r.headers();
        if (r.url().startsWith('https://api.github.com/') && (h.authorization || h.apikey)) conCabecera.push(r.url());
      });
      await check('función con 500 al arrancar: ninguna petición a api.github.com lleva la sesión; la consulta siguiente, ya recuperada, carga los datos', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        averia.status = 500;
        const p2 = await ctx.newPage();
        p2.setDefaultTimeout(8000);
        p2.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
        p2.on('pageerror', (e) => errores.push(String(e)));
        await p2.clock.install();
        await p2.goto(URL_APP);
        await esperarCarga(p2);
        assert.ok(averia.fallos >= 1, 'la función falló al arrancar');
        assert.match(await p2.locator('#view').textContent(), /Could not load the calibration data/);
        assert.doesNotMatch(await p2.locator('#view').textContent(), /session has expired/i);
        assert.notEqual(await p2.locator('#btn-gh span').textContent(), 'Sign in again');
        averia.status = 0;
        await p2.clock.fastForward(61000);
        await p2.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        await p2.waitForFunction(() => /DEMO-001/.test(document.querySelector('#view').textContent));
        assert.ok(await botonesEdicion(p2) > 0);
        assert.deepEqual(conCabecera, []);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores, '|500'), []);
      });
      await ctx.close();
    }

    // ---------- Código correcto pero la función falla justo después ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser);
      const averia = { status: 0 };
      await averiarUser(ctx, averia);
      await check('código correcto pero la función responde 503 → mensaje concreto; reintentar sin pedir otro código', async () => {
        await page.click('#btn-gh');
        await page.fill('#gh-mail', 'ana.ruiz@fluidra.com');
        await page.press('#gh-mail', 'Enter');
        await page.waitForSelector('#gh-code');
        await page.fill('#gh-code', '123456');
        averia.status = 503;
        await page.press('#gh-code', 'Enter');
        await page.waitForFunction(() => !document.querySelector('#f-err').hidden);
        assert.match(await page.locator('#f-err').textContent(), /not responding/i);
        averia.status = 0;
        const verifies = lab.verifies.length;
        await page.press('#gh-code', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz' && !document.querySelector('#dlg').open);
        assert.equal(lab.verifies.length, verifies, 'sin volver a verificar el código');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores, '|429|503'), []);
      });
      await ctx.close();
    }

    // ---------- Clave de GitHub ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true, github: { login: 'persona-gh', push: true } });
      await check('con correo configurado, "Use a GitHub key" sigue funcionando (PUT por api.github.com)', async () => {
        await page.click('#btn-gh');
        await page.click('#dlg summary');
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh' && !document.querySelector('#dlg').open);
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await waitFor(() => lab.puts.length === 1);
        assert.equal(lab.puts[0].via, 'clave');
        assert.match(lab.puts[0].message, /^Plan de calibraciones: /);
        assert.equal(peticiones.filter((p) => p.url.includes(CONTENTS) && p.method === 'PUT').length, 0);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, {
        reloj: true, clave: 'ghp_prueba', github: { login: 'persona-gh', push: true },
      });
      await check('clave guardada: la sesión de correo no se usa; consulta periódica cada 30 s; el certificado también por api.github.com', async () => {
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        assert.equal(peticiones.filter((p) => p.url.includes(CONTENTS)).length, 0);
        assert.ok(lecturasGithub(peticiones, CERTS) >= 1);
        const n = lecturasGithub(peticiones, FICHERO);
        await page.clock.fastForward(31000);
        await waitFor(() => lecturasGithub(peticiones, FICHERO) === n + 1);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Sin configuración de Supabase: como hoy ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, {
        supabaseUrl: '', anonKey: '', github: { login: 'persona-gh', push: true },
      });
      await check('sin config: diálogo de hoy (Connect GitHub, sin correo) y la clave funciona', async () => {
        assert.equal(await textoBoton(page), 'Connect GitHub');
        await page.click('#btn-gh');
        assert.equal(await page.locator('#dlg h2').textContent(), 'Connect GitHub');
        assert.equal(await page.locator('#gh-mail').count(), 0);
        assert.equal(await page.locator('#dlg').getByText(/email/i).count(), 0);
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        await registrarPlan(page);
        await waitFor(() => lab.puts.length === 1, 8000);
        assert.equal(lab.puts[0].via, 'clave');
        assert.ok(!peticiones.some((p) => p.url.includes('supabase')), 'ninguna petición a Supabase');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fallos ? `\n${fallos} prueba(s) fallida(s)` : '\nTodas las pruebas pasan');
  process.exit(fallos ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

async function waitFor(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.fail('condición no cumplida en ' + ms + ' ms');
}
