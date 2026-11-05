// Pruebas de la página de administración de accesos (acceso/index.html) sobre la simulación de tests/e2e/lab-mock.js.
// Uso, desde la raíz del repositorio: node tests/e2e/admin.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab } = require('./lab-mock.js');

const URL_APP = 'https://polinya-lab.github.io/management-tools/acceso/';
const CLAVES = ['ensayos', 'muestras', 'calibraciones', 'mantenimiento', 'piscina'];
const ETIQUETAS = ['Control de ensayos y Ocupación', 'Muestras', 'Plan de calibraciones', 'Plan de mantenimiento', 'Piscina'];

const USUARIOS = [
  { email: 'admin@fluidra.com', nombre: 'Ada Admin', roles: { ensayos: 'editar' }, admin: true },
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { piscina: 'editar', muestras: 'ver' }, admin: false },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { piscina: 'ver' }, admin: false },
];

let fallos = 0;
async function check(nombre, fn) {
  try { await fn(); console.log(`ok   ${nombre}`); }
  catch (e) { fallos++; console.log(`FAIL ${nombre}\n     ${String(e && e.stack || e).split('\n').slice(0, 5).join('\n     ')}`); }
}
// 4xx esperados (401, 403, 400) salen en la consola como "Failed to load resource".
const erroresReales = (errores) => errores.filter((e) => !/Failed to load resource: the server responded with a status of (40[013]|422)/.test(e));

async function abrir(browser, opts = {}) {
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...opts });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errores = [], peticiones = [];
  page.on('console', (m) => { if (m.type() === 'error') errores.push(m.text()); });
  page.on('pageerror', (e) => errores.push(String(e)));
  page.on('request', (r) => peticiones.push({ url: r.url(), method: r.method() }));
  await page.goto(URL_APP);
  return { ctx, page, lab, errores, peticiones };
}
async function entrar(page, email) {
  await page.waitForSelector('#a-mail');
  await page.fill('#a-mail', email);
  await page.press('#a-mail', 'Enter');
  await page.waitForSelector('#a-code');
  await page.fill('#a-code', '123456');
  await page.press('#a-code', 'Enter');
}
const fila = (page, email) => page.locator(`tr[data-email="${email}"]`);
const toast = (page, re) => page.waitForFunction((s) => { const t = document.querySelector('#toast'); return !t.hidden && new RegExp(s).test(t.textContent); }, re.source);
const usuario = (lab, email) => lab.usuarios().find((u) => u.email === email);
async function waitFor(cond, ms = 5000) {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return; await new Promise((r) => setTimeout(r, 50)); }
  assert.fail('condición no cumplida en ' + ms + ' ms');
}
const texto = (page) => page.evaluate(() => document.body.innerText);

(async () => {
  const browser = await chromium.launch();
  try {
    {
      const { ctx, page, errores } = await abrir(browser, { supabaseUrl: '', anonKey: '' });
      await check('sin configuración: solo el aviso de que el acceso no está configurado', async () => {
        await page.waitForSelector('#no-config');
        assert.match(await texto(page), /El acceso por correo todavía no está configurado\./);
        assert.equal(await page.locator('#a-mail').count(), 0);
        assert.ok(!(await page.locator('table').isVisible()));
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, errores } = await abrir(browser);
      await check('sin sesión: formulario de correo y código; un correo no dado de alta se rechaza', async () => {
        await page.waitForSelector('#a-mail');
        assert.match(await texto(page), /Entrar con tu correo/);
        await page.fill('#a-mail', 'intruso@fluidra.com');
        await page.press('#a-mail', 'Enter');
        await page.waitForFunction(() => /no está dado de alta/.test(document.querySelector('#a-hint').textContent));
        assert.equal(await page.locator('#a-code').count(), 0);
      });
      await check('no administrador: "Esta página es solo para administradores" y botón Salir que vuelve al formulario', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com');
        await page.waitForSelector('#denegado');
        assert.match(await texto(page), /Esta página es solo para administradores/);
        assert.ok(!(await page.locator('table').isVisible()));
        await page.click('#denegado button');
        await page.waitForSelector('#a-mail');
      });
      await check('sin errores de consola inesperados', async () => assert.deepEqual(erroresReales(errores), []));
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser);
      await entrar(page, 'Admin@Fluidra.com');
      await page.waitForSelector('table');
      await check('administrador: tabla con nombre, correo, un selector por rol, administrador y quién ha entrado', async () => {
        const cab = (await page.locator('thead th').allTextContents()).map((s) => s.trim());
        for (const e of ETIQUETAS) assert.ok(cab.includes(e), e);
        assert.equal(await page.locator('tbody tr').count(), 3);
        const f = fila(page, 'ana.ruiz@fluidra.com');
        assert.match(await f.textContent(), /Ana Ruiz/);
        assert.deepEqual(await f.locator('select option').allTextContents().then((o) => o.slice(0, 3)), ['—', 'Ver', 'Editar']);
        assert.equal(await f.locator('select').count(), 5);
        assert.equal(await f.locator('select[data-rol="piscina"]').inputValue(), 'editar');
        assert.equal(await f.locator('select[data-rol="muestras"]').inputValue(), 'ver');
        assert.equal(await f.locator('select[data-rol="ensayos"]').inputValue(), 'ninguno');
        assert.match(await page.locator('header').textContent(), /admin@fluidra\.com/);
        assert.ok(await page.locator('header').getByText('Salir').isVisible());
      });
      await check('la casilla de administrador propia está desactivada y no hay "Dar de baja" para uno mismo', async () => {
        const yo = fila(page, 'admin@fluidra.com');
        assert.ok(await yo.locator('input[type=checkbox]').isDisabled());
        assert.equal(await yo.getByText('Dar de baja').count(), 0);
        assert.ok(await fila(page, 'luis.ver@fluidra.com').locator('input[type=checkbox]').isEnabled());
      });
      await check('cambiar un selector envía POST con la fila entera y muestra "Guardado"', async () => {
        const antes = peticiones.length;
        await fila(page, 'luis.ver@fluidra.com').locator('select[data-rol="muestras"]').selectOption('editar');
        await toast(page, /Guardado/);
        const posts = peticiones.slice(antes).filter((p) => p.method === 'POST' && p.url.endsWith('/functions/v1/admin/usuarios'));
        assert.equal(posts.length, 1);
        const u = usuario(lab, 'luis.ver@fluidra.com');
        assert.equal(u.roles.muestras, 'editar');
        assert.equal(u.roles.piscina, 'ver');
        assert.equal(u.nombre, 'Luis Ver');
      });
      await check('marcar administrador guarda admin = true', async () => {
        await fila(page, 'luis.ver@fluidra.com').locator('input[type=checkbox]').check();
        await toast(page, /Guardado/);
        await waitFor(() => usuario(lab, 'luis.ver@fluidra.com').admin === true);
        await fila(page, 'luis.ver@fluidra.com').locator('input[type=checkbox]').uncheck();
        await waitFor(() => usuario(lab, 'luis.ver@fluidra.com').admin === false);
      });
      await check('"Añadir persona" crea la fila con todos los roles en ninguno', async () => {
        await page.fill('#n-mail', '  Nuevo.Tec@Fluidra.com ');
        await page.fill('#n-nombre', 'Nuria Nueva');
        await page.click('#n-add');
        await toast(page, /Guardado/);
        const f = fila(page, 'nuevo.tec@fluidra.com');
        await f.waitFor();
        assert.match(await f.textContent(), /Nuria Nueva/);
        for (const c of CLAVES) assert.equal(await f.locator(`select[data-rol="${c}"]`).inputValue(), 'ninguno');
        const u = usuario(lab, 'nuevo.tec@fluidra.com');
        assert.equal(u.nombre, 'Nuria Nueva');
        assert.equal(u.admin, false);
        assert.equal(await page.inputValue('#n-mail'), '');
      });
      await check('error 400 (correo no válido): se muestra el mensaje de la función y no se añade la fila', async () => {
        await page.fill('#n-mail', 'no-es-un-correo');
        await page.fill('#n-nombre', 'Persona Rara');
        await page.click('#n-add');
        await toast(page, /Correo no válido/);
        assert.equal(await page.locator('tbody tr').count(), 4);
      });
      await check('error al guardar una fila (el servidor rechaza): el mensaje sale y el control vuelve a su valor', async () => {
        await ctx.route(/\/functions\/v1\/admin\/usuarios$/, (route) => route.request().method() === 'POST'
          ? route.fulfill({ status: 400, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://polinya-lab.github.io' }, body: '{"message":"Valor no válido para piscina"}' })
          : route.fallback());
        const sel = fila(page, 'ana.ruiz@fluidra.com').locator('select[data-rol="piscina"]');
        await sel.selectOption('ninguno');
        await toast(page, /Valor no válido para piscina/);
        await page.waitForFunction(() => document.querySelector('tr[data-email="ana.ruiz@fluidra.com"] select[data-rol="piscina"]').value === 'editar');
        assert.equal(usuario(lab, 'ana.ruiz@fluidra.com').roles.piscina, 'editar');
        await ctx.unroute(/\/functions\/v1\/admin\/usuarios$/);
      });
      await check('"Dar de baja" pide confirmación en la página: cancelar no borra, aceptar envía DELETE', async () => {
        const f = fila(page, 'luis.ver@fluidra.com');
        await f.getByText('Dar de baja').click();
        await page.waitForSelector('#confirmar:not([hidden])');
        assert.match(await page.locator('#confirmar').textContent(), /Luis Ver/);
        await page.click('#c-no');
        assert.ok(usuario(lab, 'luis.ver@fluidra.com'));
        const antes = peticiones.length;
        await f.getByText('Dar de baja').click();
        await page.click('#c-si');
        await toast(page, /Dada de baja|Guardado/);
        await f.waitFor({ state: 'detached' });
        assert.equal(usuario(lab, 'luis.ver@fluidra.com'), undefined);
        const del = peticiones.slice(antes).filter((p) => p.method === 'DELETE');
        assert.equal(del.length, 1);
        assert.ok(del[0].url.endsWith('/usuarios/luis.ver%40fluidra.com'));
      });
      await check('"Salir" vuelve al formulario de correo', async () => {
        await page.locator('header').getByText('Salir').click();
        await page.waitForSelector('#a-mail');
        assert.ok(!(await page.locator('table').isVisible()));
      });
      await check('sin errores de consola inesperados', async () => assert.deepEqual(erroresReales(errores), []));
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(browser);
      await entrar(page, 'admin@fluidra.com');
      await page.waitForSelector('table');
      await check('401 al guardar: vuelve al formulario de entrada', async () => {
        await ctx.route(/\/functions\/v1\/admin\/usuarios$/, (route) => route.request().method() === 'POST'
          ? route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://polinya-lab.github.io' }, body: '{"message":"Sesión no válida"}' })
          : route.fallback());
        await fila(page, 'ana.ruiz@fluidra.com').locator('select[data-rol="calibraciones"]').selectOption('ver');
        await page.waitForSelector('#a-mail');
        assert.match(await texto(page), /sesión ha caducado/i);
      });
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      await setupLab(ctx, { usuarios: USUARIOS });
      await ctx.route(/\/functions\/v1\/admin\/usuarios$/, (route) => route.request().method() === 'GET'
        ? route.fulfill({ status: 401, contentType: 'application/json', headers: { 'access-control-allow-origin': 'https://polinya-lab.github.io' }, body: '{"message":"Sesión no válida"}' })
        : route.fallback());
      const page = await ctx.newPage();
      page.setDefaultTimeout(8000);
      await page.goto(URL_APP);
      await check('401 al cargar la lista tras entrar: vuelve al formulario de entrada', async () => {
        await entrar(page, 'admin@fluidra.com');
        await page.waitForFunction(() => /sesión ha caducado/i.test(document.body.innerText));
        await page.waitForSelector('#a-mail');
      });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  console.log(fallos ? `\n${fallos} prueba(s) fallida(s)` : '\nTodas las pruebas pasan');
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
