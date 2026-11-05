// Pruebas de Control de ensayos, Ocupación y Muestras (control-ensayos/app.js) con el acceso por correo y con la clave
// de GitHub, sobre la simulación de tests/e2e/lab-mock.js (datos inventados).
// Uso, desde la raíz del repositorio: node tests/e2e/ensayos.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab } = require('./lab-mock.js');

const BASE = 'https://polinya-lab.github.io/management-tools/';
const ENSAYOS = BASE + 'control-ensayos/';
const OCUPACION = BASE + 'ocupacion/';
const MUESTRAS = BASE + 'muestras/';
const FICHERO = 'ensayos/ensayos.json';
const CONTENTS = '/functions/v1/github/';

const USUARIOS = [
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { ensayos: 'editar', muestras: 'editar' }, admin: false },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { ensayos: 'ver' }, admin: false },
  { email: 'marta.m@fluidra.com', nombre: 'Marta Muestras', roles: { ensayos: 'ver', muestras: 'editar' }, admin: false },
  { email: 'nora.n@fluidra.com', nombre: 'Nora Nadie', roles: { muestras: 'editar' }, admin: false },
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

// Los 4xx esperados (401 de la sesión caducada, 403 de un rol sin acceso, 409/422 de conflictos) salen en la consola
// como "Failed to load resource"; cualquier otro error cuenta.
// También el 404 de la lectura anónima de raw.githubusercontent.com (lab-data es privado, como hoy): se comprueba aparte
// que ningún otro recurso responde 404.
const erroresReales = (errores) =>
  errores.filter((e) => !/Failed to load resource: the server responded with a status of (40[134]|409|422)/.test(e));
const otros404 = (respuestas) => respuestas.filter((r) => r.status === 404 && !r.url.startsWith('https://raw.githubusercontent.com/'));

// Datos extra para estas pruebas (inventados): un PLR con piezas y sin muestras (propuesta de códigos en Muestras)
// y el PLR del enlace del QR.
function datosExtra(lab) {
  const d = lab.datos('lab-data', FICHERO);
  const base = d.tests['t-demo-002'];
  d.tests['t-demo-004'] = { ...base, plr: 'PLR900004', qtp: 'QTP9002', title: 'Grifo demo D - ciclos', pieces: 2, sequence: 1 };
  d.tests['t-demo-qr'] = { ...base, plr: 'PLR003715', qtp: 'QTP9001', title: 'Filtro demo QR - resistencia', pieces: 0 };
  lab.fijarDatos('lab-data', FICHERO, d);
}

async function abrir(browser, url, opts = {}) {
  const { reloj, clave, ...lab_opts } = opts;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...lab_opts });
  datosExtra(lab);
  if (clave) await ctx.addInitScript((t) => { try { if (!sessionStorage.getItem('__k')) { localStorage.setItem('pd-gh-token', t); sessionStorage.setItem('__k', '1'); } } catch (e) { /* */ } }, clave);
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errores = [];
  const peticiones = [];
  const respuestas = [];
  errores.otros404 = () => otros404(respuestas);
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('request', (r) => peticiones.push({ url: r.url(), method: r.method() }));
  page.on('response', (r) => respuestas.push({ url: r.url(), status: r.status() }));
  if (reloj) await page.clock.install();
  await page.goto(url);
  await esperarCarga(page);
  return { ctx, page, lab, errores, peticiones };
}
const esperarCarga = (page) => page.waitForFunction(() => {
  const v = document.querySelector('#view');
  return v && !/Loading lab data/.test(v.textContent);
});
const textoBoton = (page) => page.locator('#btn-gh span').textContent();
const lecturasFuncion = (peticiones) =>
  peticiones.filter((p) => p.method === 'GET' && p.url.includes(CONTENTS) && p.url.includes('/contents/' + FICHERO)).length;
const lecturasGithub = (peticiones) =>
  peticiones.filter((p) => p.method === 'GET' && p.url.startsWith('https://api.github.com/') && p.url.includes('/contents/' + FICHERO)).length;

// Entra con correo desde el botón de la cabecera; textos en inglés (es=false) o castellano (Muestras).
async function entrar(page, email, nombre, es = false) {
  await page.click('#btn-gh');
  await page.waitForSelector('#gh-mail');
  assert.ok(await page.locator('#dlg').getByText(es ? 'Entrar con tu correo' : 'Sign in with your email').isVisible());
  await page.fill('#gh-mail', email);
  await page.press('#gh-mail', 'Enter');
  await page.waitForSelector('#gh-code');
  await page.fill('#gh-code', '123456');
  await page.press('#gh-code', 'Enter');
  await page.waitForFunction((n) => document.querySelector('#btn-gh span').textContent === n && !document.querySelector('#dlg').open, nombre);
}

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- Control de ensayos, editar ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser, ENSAYOS);
      await check('diálogo: "Sign in with your email" arriba y "Use a GitHub key" debajo', async () => {
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        const a = await page.locator('#dlg').getByText('Sign in with your email').boundingBox();
        const b = await page.locator('#dlg').getByText('Use a GitHub key').boundingBox();
        assert.ok(a && b, 'los dos textos están en el diálogo');
        assert.ok(a.y < b.y, `correo (${a.y}) antes que clave (${b.y})`);
        await page.click('#dlg [data-act="close"]');
      });
      await check('correo no dado de alta → aviso en el diálogo', async () => {
        await page.click('#btn-gh');
        await page.fill('#gh-mail', 'nadie@fluidra.com');
        await page.press('#gh-mail', 'Enter');
        await page.waitForFunction(() => !document.querySelector('#f-err').hidden);
        assert.match(await page.locator('#f-err').textContent(), /not registered/i);
        await page.click('#dlg [data-act="close"]');
      });
      await check('correo → código → la cabecera muestra el nombre (Ana Ruiz)', async () => {
        await entrar(page, '  Ana.Ruiz@Fluidra.com ', 'Ana Ruiz');
        assert.equal(await page.isVisible('#btn-new'), true, '+ New test visible con editar');
      });
      await check('editar: cambiar el estado de un ensayo hace un PUT a la función "Control de ensayos: update …"', async () => {
        await page.click('#tabs [data-view="queue"]');
        await page.selectOption('select[data-setstatus="t-demo-002"]', 'Planned');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        await waitFor(() => lab.puts.length === 1);
        const p = lab.puts[0];
        assert.equal(p.via, 'funcion');
        assert.match(p.message, /^Control de ensayos: update PLR900002 · QTP9002/);
        assert.deepEqual(p.author, { name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
        assert.equal(p.data.tests['t-demo-002'].status, 'Planned');
      });
      await check('la sesión sigue al recargar (cabecera con el nombre)', async () => {
        await page.reload();
        await esperarCarga(page);
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
      });
      await check('salir: vuelve a "Sign in" y queda en solo lectura', async () => {
        await page.click('#btn-gh');
        await page.click('#dlg [data-act="gh-out"]');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in');
        assert.equal(await page.isVisible('#btn-new'), false);
      });
      await check('Control de ensayos (editar): sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Control de ensayos, ver ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser, ENSAYOS);
      await check('ver: no aparecen "+ New test" ni la carga de Import ARAS; ningún PUT', async () => {
        await entrar(page, 'luis.ver@fluidra.com', 'Luis Ver');
        assert.equal(await page.isVisible('#btn-new'), false);
        await page.click('#tabs [data-view="import"]');
        assert.equal(await page.locator('[data-dz="aras"]').count(), 0);
        await page.click('#tabs [data-view="queue"]');
        assert.equal(await page.locator('select[data-setstatus]').count(), 0, 'sin selectores de estado editables');
        assert.match(await page.locator('#view').textContent(), /cannot change|view the data/i);
        assert.equal(lab.puts.length, 0);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
        assert.deepEqual(lab.bloqueadas, []);
      });
      await ctx.close();
    }

    // ---------- Muestras ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser, MUESTRAS);
      await check('Muestras (editar muestras, ver ensayos): "Entrar con tu correo"; no aparece Import ARAS', async () => {
        assert.equal(await textoBoton(page), 'Entrar');
        await entrar(page, 'marta.m@fluidra.com', 'Marta Muestras', true);
        assert.equal(await page.locator('#tabs [data-view="import"]').count(), 0);
      });
      await check('Muestras: validar una propuesta guarda (PUT aceptado por la función)', async () => {
        await page.click('#tabs [data-view="samples"]');
        await page.click('[data-sa="prop-ok"][data-plr="PLR900004"]');
        await waitFor(() => lab.puts.length === 1);
        const p = lab.puts[0];
        assert.equal(p.via, 'funcion');
        assert.match(p.message, /^Muestras: /);
        const nuevas = Object.values(p.data.muestras).filter((m) => (m.plrs || []).includes('PLR900004'));
        assert.ok(nuevas.length >= 1, 'muestra nueva del PLR900004');
        assert.equal(p.data.config.samples.seq >= 3, true);
      });
      await check('Muestras: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores } = await abrir(browser, MUESTRAS);
      await check('Muestras con editar en ensayos: Import ARAS sí aparece', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz', true);
        assert.equal(await page.locator('#tabs [data-view="import"]').count(), 1);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores } = await abrir(browser, MUESTRAS);
      await check('Muestras con ninguno: "No tienes acceso a esta app" y ningún dato', async () => {
        lab.setUsuarios([...USUARIOS, { email: 'sin.muestras@fluidra.com', nombre: 'Sin Muestras', roles: { ensayos: 'editar' }, admin: false }]);
        await entrar(page, 'sin.muestras@fluidra.com', 'Sin Muestras', true);
        await page.waitForFunction(() => /No tienes acceso a esta app/.test(document.querySelector('#view').textContent));
        assert.doesNotMatch(await page.locator('#view').textContent(), /QTS-00001/);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Ocupación sin acceso ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, OCUPACION);
      await check('Ocupación con ninguno en ensayos: "You don\'t have access to this app"; no se leen datos', async () => {
        await entrar(page, 'nora.n@fluidra.com', 'Nora Nadie');
        await page.waitForFunction(() => /You don't have access to this app\. Ask an administrator\./.test(document.querySelector('#view').textContent));
        assert.equal(lecturasFuncion(peticiones), 0);
        assert.equal(peticiones.filter((p) => p.url.includes('/contents/')).length, 0);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- 401 con la app abierta y consulta periódica ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, ENSAYOS, { reloj: true });
      await check('entrar (Ana) con el reloj simulado', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        await page.click('#tabs [data-view="queue"]');
      });
      await check('consulta periódica con sesión de correo: cada 60 s (no a los 30 s)', async () => {
        // Primero una consulta completa con la sesión ya abierta; luego se mide el intervalo siguiente.
        const n0 = lecturasFuncion(peticiones);
        await page.clock.fastForward(61000);
        await waitFor(() => lecturasFuncion(peticiones) === n0 + 1);
        const n = lecturasFuncion(peticiones);
        await page.clock.fastForward(31000);
        await page.waitForTimeout(400);
        assert.equal(lecturasFuncion(peticiones), n, 'sin lectura a los 31 s');
        await page.clock.fastForward(30000);
        await waitFor(() => lecturasFuncion(peticiones) === n + 1);
      });
      await check('cambio pendiente cuando la sesión deja de valer → aviso (no se pierde en silencio) y "Sign in again"', async () => {
        lab.revocar('ana.ruiz@fluidra.com');
        await page.selectOption('select[data-setstatus="t-demo-001"]', 'On hold');
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
        assert.match(txt, /PLR900002/);
        assert.match(txt, /session has expired/i);
        assert.equal(await page.isVisible('#btn-new'), false);
      });
      await check('"Sign in again" abre el diálogo en el paso del correo, con el correo puesto; volver a entrar recupera la edición', async () => {
        lab.setUsuarios(USUARIOS);
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        assert.equal(await page.inputValue('#gh-mail'), 'ana.ruiz@fluidra.com');
        await page.press('#gh-mail', 'Enter');
        await page.waitForSelector('#gh-code');
        await page.fill('#gh-code', '123456');
        await page.press('#gh-code', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Ana Ruiz');
        assert.equal(await page.isVisible('#btn-new'), true);
      });
      await check('401: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Persona dada de baja con la app abierta (403 en la siguiente consulta): datos en pantalla ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser, ENSAYOS, { reloj: true });
      await check('baja con la app abierta: la siguiente consulta falla y los datos siguen en pantalla', async () => {
        await entrar(page, 'luis.ver@fluidra.com', 'Luis Ver');
        lab.setUsuarios(USUARIOS.filter((u) => u.email !== 'luis.ver@fluidra.com'));
        lab.revocar('luis.ver@fluidra.com');
        await page.clock.fastForward(61000);
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'Sign in again');
        assert.match(await page.locator('#view').textContent(), /PLR900001/);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Enlace del QR ----------
    for (const modo of ['correo', 'clave']) {
      const { ctx, page, lab, errores } = await abrir(browser, ENSAYOS, modo === 'clave'
        ? { clave: 'ghp_prueba', github: { login: 'persona-gh', push: true } } : {});
      await check(`QR control-ensayos/#queue?plr=PLR003715 abre la cola filtrada (${modo})`, async () => {
        if (modo === 'correo') await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        else await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        // El QR abre la página de nuevo (no es un cambio de #): otra pestaña del mismo navegador.
        const qr = await ctx.newPage();
        qr.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
        qr.on('pageerror', (e) => errores.push(String(e)));
        await qr.goto(ENSAYOS + '#queue?plr=PLR003715');
        await esperarCarga(qr);
        await qr.waitForFunction((n) => document.querySelector('#btn-gh span').textContent === n, modo === 'correo' ? 'Ana Ruiz' : 'persona-gh');
        await qr.waitForFunction(() => /PLR003715/.test(document.querySelector('#view').textContent));
        assert.equal(await qr.inputValue('#q'), 'PLR003715');
        assert.equal(await qr.getAttribute('#tabs [data-view="queue"]', 'aria-current'), 'page');
        const txt = await qr.locator('#view tbody').textContent();
        assert.doesNotMatch(txt, /PLR900002/);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Clave de GitHub con correo configurado ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, ENSAYOS, { reloj: true, github: { login: 'persona-gh', push: true } });
      await check('con correo configurado, "Use a GitHub key" sigue funcionando (PUT por api.github.com)', async () => {
        await page.click('#btn-gh');
        await page.click('#dlg summary');
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh' && !document.querySelector('#dlg').open);
        await page.click('#tabs [data-view="queue"]');
        await page.selectOption('select[data-setstatus="t-demo-002"]', 'Planned');
        await page.clock.fastForward(1000);
        await waitFor(() => lab.puts.length === 1);
        assert.equal(lab.puts[0].via, 'clave');
        assert.match(lab.puts[0].message, /^Control de ensayos: update /);
      });
      await check('clave en el diálogo con correo: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, ENSAYOS, {
        reloj: true, clave: 'ghp_prueba', github: { login: 'persona-gh', push: true },
      });
      await check('consulta periódica con clave guardada: 30 s (sin cambios)', async () => {
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        const n = lecturasGithub(peticiones);
        await page.clock.fastForward(31000);
        await waitFor(() => lecturasGithub(peticiones) === n + 1);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Sin configuración de Supabase: como hoy ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, ENSAYOS, {
        supabaseUrl: '', anonKey: '', github: { login: 'persona-gh', push: true },
      });
      await check('sin config: el diálogo es el de hoy (Connect GitHub, sin correo) y la clave funciona', async () => {
        assert.equal(await textoBoton(page), 'Connect GitHub');
        await page.click('#btn-gh');
        assert.equal(await page.locator('#dlg h2').textContent(), 'Connect GitHub');
        assert.equal(await page.locator('#gh-mail').count(), 0);
        assert.equal(await page.locator('#dlg').getByText(/email/i).count(), 0);
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh span').textContent === 'persona-gh');
        await page.click('#tabs [data-view="queue"]');
        await page.selectOption('select[data-setstatus="t-demo-002"]', 'Planned');
        await waitFor(() => lab.puts.length === 1);
        assert.equal(lab.puts[0].via, 'clave');
        assert.ok(!peticiones.some((p) => p.url.includes('supabase')), 'ninguna petición a Supabase');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores } = await abrir(browser, MUESTRAS, { supabaseUrl: '', anonKey: '' });
      await check('sin config, Muestras: botón "Connect GitHub" e Import ARAS visible como hoy', async () => {
        assert.equal(await textoBoton(page), 'Connect GitHub');
        assert.equal(await page.locator('#tabs [data-view="import"]').count(), 1);
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
