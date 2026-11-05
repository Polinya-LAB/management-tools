// Pruebas del Plan de mantenimiento (mantenimiento/index.html) con el acceso por correo y con la clave de GitHub,
// sobre la simulación de tests/e2e/lab-mock.js (datos inventados).
// Uso, desde la raíz del repositorio: node tests/e2e/mantenimiento.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab } = require('./lab-mock.js');

const URL_APP = 'https://polinya-lab.github.io/management-tools/mantenimiento/';
const FICHERO = 'mantenimiento/registro.json';
const MAIN = 'mantenimiento/mantenimiento.json';
const CAL = 'calibraciones/calibraciones.json';
const CONTENTS = '/functions/v1/github/';

const USUARIOS = [
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { mantenimiento: 'editar' }, admin: false },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { mantenimiento: 'ver' }, admin: false },
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
  return v && !/Loading maintenance data/.test(v.textContent);
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
// Botón "Settings" de la pestaña Data (visible solo con permiso de edición); sin pestañas (sin acceso) no hay ninguno.
const botonesEdicion = async (page) => {
  if (await page.locator('#tabs [data-view="data"]').count()) await page.click('#tabs [data-view="data"]');
  return page.evaluate(() => [...document.querySelectorAll('[data-act="settings"]')].filter((b) => b.offsetParent !== null).length);
};
// Programa un mantenimiento desde el diálogo de una fila del plan.
async function registrarPlan(page) {
  await page.evaluate(() => openRow('mp-demo-1'));
  await page.click('#dlg [data-act="rec-plan"]');
  await page.fill('#f-month', '2027-06');
  await page.click('#dlg-form button[type="submit"]');
}
// Con rol "ver" los botones no existen: se abre el diálogo de registro y se envía con Enter, que es lo que haría
// alguien que lo abriera por otro camino.
async function enviarRegistroSinPermiso(page) {
  await page.evaluate(() => openRec(null, { planId: 'mp-demo-2', status: 'Planned', month: '2027-06' }));
  await page.press('#f-month', 'Enter');
}
const toastTexto = (page) => page.locator('#toast').textContent();
const fsx = require('node:fs');
const osx = require('node:os');
const pathx = require('node:path');
// Copia de los datos inventados sin mantenimiento/registro.json: el primer guardado lo crea.
function datosSinRegistro() {
  const raiz = fsx.mkdtempSync(pathx.join(osx.tmpdir(), 'mt-fix-'));
  fsx.cpSync(pathx.join(__dirname, 'fixtures'), raiz, { recursive: true });
  fsx.rmSync(pathx.join(raiz, 'lab-data', 'mantenimiento', 'registro.json'));
  return Object.fromEntries(['lab-data', 'endurance-data'].map((r) => [r, pathx.join(raiz, r)]));
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
      await check('editar: entra con correo (mayúsculas y espacios) y se leen mantenimiento, registro y calibraciones por la función', async () => {
        await entrar(page, '  Ana.Ruiz@Fluidra.com ', 'Ana Ruiz');
        assert.ok(lecturasFuncion(peticiones, MAIN) >= 1, 'mantenimiento.json');
        assert.ok(lecturasFuncion(peticiones, FICHERO) >= 1, 'registro.json');
        assert.ok(lecturasFuncion(peticiones, CAL) >= 1, 'calibraciones.json');
        assert.equal(lecturasGithub(peticiones, MAIN) + lecturasGithub(peticiones, FICHERO) + lecturasGithub(peticiones, CAL), 0);
        assert.match(await page.locator('#view').textContent(), /Banco demo 1/);
        assert.ok(await botonesEdicion(page) > 0, 'botones de edición visibles');
      });
      await check('editar: programar un mantenimiento hace un único PUT, por la función, solo a registro.json, con el nombre de la persona', async () => {
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await waitFor(() => lab.puts.length === 1);
        await page.clock.fastForward(3000);
        const p = lab.puts[0];
        assert.equal(lab.puts.length, 1);
        assert.equal(p.via, 'funcion');
        assert.equal(p.path, FICHERO);
        assert.match(p.message, /^Plan de mantenimiento: /);
        assert.deepEqual(p.author, { name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
        assert.ok(Object.values(p.data.records).some((r) => r.month === '2027-06' && r.status === 'Planned'));
        assert.ok(Object.keys(p.data.records).includes('r-demo-1'), 'conserva los registros anteriores');
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
      await check('editar: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- registro.json inexistente ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser, { reloj: true, dataDirs: datosSinRegistro() });
      await check('registro.json inexistente: la app carga y el primer guardado lo crea (PUT sin sha)', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        assert.match(await page.locator('#view').textContent(), /Banco demo 1/);
        assert.equal(lab.datos('lab-data', FICHERO), undefined);
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await waitFor(() => lab.puts.length === 1);
        assert.equal(lab.puts[0].path, FICHERO);
        assert.equal(lab.puts[0].via, 'funcion');
        assert.equal(Object.keys(lab.puts[0].data.records).length, 1);
        assert.equal(Object.values(lab.puts[0].data.records)[0].month, '2027-06');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }

    // ---------- ver ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('ver: se leen los tres ficheros y no hay botones de edición', async () => {
        await entrar(page, 'luis.ver@fluidra.com', 'Luis Ver');
        assert.ok(lecturasFuncion(peticiones, MAIN) >= 1);
        assert.ok(lecturasFuncion(peticiones, FICHERO) >= 1);
        assert.ok(lecturasFuncion(peticiones, CAL) >= 1);
        assert.match(await page.locator('#view').textContent(), /Banco demo 1/);
        assert.equal(await botonesEdicion(page), 0);
        assert.match(await page.locator('#view').textContent(), /cannot change|view the data/i);
      });
      await check('ver: intentar guardar un registro da el aviso de permiso y no hace ningún PUT', async () => {
        await enviarRegistroSinPermiso(page);
        await page.waitForFunction(() => !document.querySelector('#toast').hidden && /cannot change/i.test(document.querySelector('#toast').textContent));
        assert.match(await toastTexto(page), /does not have edit access|cannot change data/i);
        await page.clock.fastForward(3000);
        await page.waitForTimeout(300);
        assert.equal(lab.puts.length, 0);
        assert.equal(peticiones.filter((p) => p.method === 'PUT').length, 0);
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
        assert.doesNotMatch(await page.locator('#view').textContent(), /Banco demo 1/);
        assert.equal(peticiones.filter((p) => p.url.includes('/contents/')).length, 0);
        assert.equal(await botonesEdicion(page), 0);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- consulta periódica y 401 con la app abierta ----------
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
      await check('401 en una consulta sin cambios pendientes: "Sign in again", los datos siguen en pantalla, solo lectura', async () => {
        lab.revocar('ana.ruiz@fluidra.com');
        await page.clock.fastForward(61000);
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in again');
        const txt = await page.locator('#view').textContent();
        assert.match(txt, /Banco demo 1/);
        assert.match(txt, /session has expired/i);
        assert.equal(await botonesEdicion(page), 0);
        assert.equal(lab.puts.length, 0);
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
    {
      const { ctx, page, lab, errores } = await abrir(browser, { reloj: true });
      await check('cambio pendiente cuando la sesión deja de valer → aviso, "Sign in again" y los datos siguen; no se envía', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        lab.revocar('ana.ruiz@fluidra.com');
        await registrarPlan(page);
        await page.clock.fastForward(1000);
        await page.waitForFunction(() => !document.querySelector('#toast').hidden && /expired/i.test(document.querySelector('#toast').textContent));
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in again');
        assert.equal(lab.puts.length, 0);
        assert.match(await page.locator('#view').textContent(), /Banco demo 1/);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
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
        assert.match(await p2.locator('#view').textContent(), /Could not load the maintenance data/);
        assert.doesNotMatch(await p2.locator('#view').textContent(), /session has expired/i);
        assert.notEqual(await p2.locator('#btn-gh span').textContent(), 'Sign in again');
        averia.status = 0;
        await p2.clock.fastForward(61000);
        await p2.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        await p2.waitForFunction(() => /Banco demo 1/.test(document.querySelector('#view').textContent));
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
        assert.equal(lab.puts[0].path, FICHERO);
        assert.match(lab.puts[0].message, /^Plan de mantenimiento: /);
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
      await check('clave guardada: la sesión de correo no se usa; los tres ficheros por api.github.com; consulta cada 30 s', async () => {
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        assert.equal(peticiones.filter((p) => p.url.includes(CONTENTS)).length, 0);
        assert.ok(lecturasGithub(peticiones, MAIN) >= 1 && lecturasGithub(peticiones, CAL) >= 1);
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
