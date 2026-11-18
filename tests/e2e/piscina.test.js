// Pruebas del Seguimiento de la piscina de durabilidad (seguimiento-piscina-durabilidad/index.html) con el acceso por correo
// y con la clave de GitHub, sobre la simulación de tests/e2e/lab-mock.js (datos inventados).
// Uso, desde la raíz del repositorio: node tests/e2e/piscina.test.js
'use strict';
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { setupLab, CLAVE_PRUEBA } = require('./lab-mock.js');

const URL_APP = 'https://polinya-lab.github.io/management-tools/seguimiento-piscina-durabilidad/';
const FICHERO = 'piscina.json';
const CONTENTS = '/functions/v1/github/';
const FUNCION = 'https://lab-test.supabase.co' + CONTENTS;

const USUARIOS = [
  { email: 'ana.ruiz@fluidra.com', nombre: 'Ana Ruiz', roles: { piscina: 'editar' }, admin: false },
  { email: 'luis.ver@fluidra.com', nombre: 'Luis Ver', roles: { piscina: 'ver' }, admin: false },
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

// 4xx esperados (400 de una contraseña incorrecta, 401 de la sesión caducada, 403 de un rol sin acceso, 409/422 de conflictos) y el 404 de la lectura anónima de
// raw.githubusercontent.com (endurance-data es privado) salen en la consola como "Failed to load resource".
const erroresReales = (errores, extra = '') =>
  errores.filter((e) => !new RegExp(`Failed to load resource: the server responded with a status of (40[0134]|409|422${extra})`).test(e));
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
  const { reloj, clave, lang = 'es', ...labOpts } = opts;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...labOpts });
  // Chromium arranca en inglés (en-US): las pruebas en español fijan el idioma si nadie lo ha elegido aún.
  await ctx.addInitScript((l) => { try { if (!localStorage.getItem('lab.lang')) localStorage.setItem('lab.lang', l); } catch (e) { /* */ } }, lang);
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
const esperarCarga = (page) => page.waitForFunction(() => !/Cargando datos/.test(document.querySelector('#banners').textContent));
const textoBoton = (page) => page.locator('#btn-gh-label').textContent();
const esperarBoton = (page, t) => page.waitForFunction((n) => document.querySelector('#btn-gh-label').textContent === n, t);
const lecturas = (peticiones, origen) =>
  peticiones.filter((p) => p.method === 'GET' && p.url.startsWith(origen) && p.url.includes('/contents/' + FICHERO)).length;
const lecturasFuncion = (peticiones) => lecturas(peticiones, FUNCION);
const lecturasGithub = (peticiones) => lecturas(peticiones, 'https://api.github.com/');
const textoPagina = (page) => page.evaluate(() => document.body.innerText);
const hayDatos = (page) => page.evaluate(() => document.querySelector('#cnt-act').textContent.trim() === '2');
const toastTexto = (page) => page.locator('#toast').textContent();
const toastVisible = (page, re) => page.waitForFunction((s) => { const t = document.querySelector('#toast'); return !t.hidden && new RegExp(s, 'i').test(t.textContent); }, re.source);

async function entrar(page, email, nombre) {
  await page.click('#btn-gh');
  await page.waitForSelector('#gh-mail');
  assert.ok(await page.locator('#ov-gh').getByText('Entrar con tu correo').first().isVisible());
  await page.fill('#gh-mail', email);
  await page.fill('#gh-pass', CLAVE_PRUEBA);
  assert.ok(await page.isVisible('#gh-save'), 'botón de entrar visible');
  await page.click('#gh-save'); // con el ratón, como la mayoría
  await page.waitForFunction((n) => document.querySelector('#btn-gh-label').textContent === n && document.querySelector('#ov-gh').hidden, nombre);
}
const botonNueva = (page) => page.evaluate(() => !document.querySelector('#btn-new').hidden && document.querySelector('#btn-new').offsetParent !== null);
// "Nueva bomba": rellena el formulario con datos inventados y guarda.
async function nuevaBomba(page) {
  await page.click('#btn-new');
  await page.fill('#f-proyecto', 'Proyecto Demo Piscina');
  await page.fill('#f-referencia', 'REF-DEMO-NUEVA');
  await page.fill('#f-serie', 'SN-DEMO-NUEVA');
  await page.fill('#f-potencia', '1.5');
  await page.fill('#f-posicion', '40');
  await page.fill('#f-petaca', '20');
  await page.fill('#f-inicio', '2026-11-01');
  await page.fill('#f-fin', '2027-05-01');
  await page.click('#b-save');
}
// Envía por el camino real los formularios de guardado aunque sus botones estén ocultos (rol "ver").
const enviarSinPermiso = (page) => page.evaluate(() => {
  for (const id of ['form', 'cfg-form', 'obs-form', 'cons-precio-form']) document.getElementById(id).dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
});

(async () => {
  const browser = await chromium.launch();
  try {
    // ---------- sin sesión, repositorio privado (raw responde 404) ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser);
      await check('sin sesión y raw 404 (repo privado): "Entra con tu correo para ver la piscina." y ningún dato', async () => {
        assert.match(await page.locator('#banners').textContent(), /Entra con tu correo para ver la piscina\./);
        assert.doesNotMatch(await page.locator('#banners').textContent(), /Conectar con GitHub/);
        assert.equal(await hayDatos(page), false);
        assert.equal(await textoBoton(page), 'Entrar con tu correo');
        assert.equal(lecturasGithub(peticiones) + lecturasFuncion(peticiones), 0);
      });
      await check('diálogo: "Entrar con tu correo" arriba y "Usar una clave de GitHub" debajo; correo no registrado → "Correo o contraseña incorrectos."', async () => {
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        const a = await page.locator('#ov-gh h3').boundingBox();
        const b = await page.locator('#ov-gh summary').boundingBox();
        assert.ok(a && b && a.y < b.y);
        assert.equal(await page.getAttribute('#gh-pass', 'type'), 'password');
        assert.equal(await page.locator('#gh-save').textContent(), 'Entrar');
        assert.ok(await page.isVisible('#gh-save'), 'el botón Entrar se ve antes de entrar');
        assert.ok(await page.locator('#ov-gh').getByText('¿Has olvidado la contraseña? Pídesela a un administrador.').isVisible());
        assert.equal(await page.locator('#gh-code').count(), 0, 'sin paso de código');
        await page.fill('#gh-mail', 'nadie@fluidra.com');
        await page.fill('#gh-pass', CLAVE_PRUEBA);
        await page.press('#gh-pass', 'Enter');
        await page.waitForFunction(() => !document.querySelector('#gm-hint').hidden);
        assert.equal(await page.locator('#gm-hint').textContent(), 'Correo o contraseña incorrectos.');
        await page.click('#ov-gh .foot-row [data-close]');
      });
      await check('contraseña incorrecta → "Correo o contraseña incorrectos.", sin sesión y el campo de contraseña vacío', async () => {
        await page.click('#btn-gh');
        await page.fill('#gh-mail', 'ana.ruiz@fluidra.com');
        await page.fill('#gh-pass', 'no-es-la-clave-1234');
        await page.press('#gh-pass', 'Enter');
        await page.waitForFunction(() => !document.querySelector('#gm-hint').hidden);
        assert.equal(await page.locator('#gm-hint').textContent(), 'Correo o contraseña incorrectos.');
        assert.equal(await page.inputValue('#gh-pass'), '', 'la contraseña no se queda en la página');
        assert.equal(await page.evaluate(() => window.LabAuth.sesion()), null);
        assert.equal(await textoBoton(page), 'Entrar con tu correo');
        assert.equal(await hayDatos(page), false);
        await page.click('#ov-gh .foot-row [data-close]');
      });
      await check('sin sesión: sin errores de consola ni peticiones bloqueadas', async () => {
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Contraseña correcta pero la función falla justo después ----------
    {
      const { ctx, page, lab, errores } = await abrir(browser);
      const averia = { status: 0 };
      await averiarUser(ctx, averia);
      await check('contraseña correcta pero la función responde 503 → mensaje concreto; reintentar sin volver a escribir la contraseña', async () => {
        await page.click('#btn-gh');
        await page.fill('#gh-mail', 'ana.ruiz@fluidra.com');
        await page.fill('#gh-pass', CLAVE_PRUEBA);
        averia.status = 503;
        await page.press('#gh-pass', 'Enter');
        await page.waitForFunction(() => /no responde/.test(document.querySelector('#gm-hint').textContent));
        assert.equal(await page.inputValue('#gh-pass'), '', 'la contraseña no se queda en la página');
        assert.equal(await page.inputValue('#gh-mail'), 'ana.ruiz@fluidra.com');
        averia.status = 0;
        const logins = lab.logins.length;
        await page.press('#gh-pass', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh-label').textContent === 'Ana Ruiz' && document.querySelector('#ov-gh').hidden);
        assert.equal(lab.logins.length, logins, 'sin volver a enviar la contraseña');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores, '|503'), []);
      });
      await ctx.close();
    }

    // ---------- editar ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('editar: entra con correo (mayúsculas y espacios) y lee piscina.json por la función, sin tocar api.github.com', async () => {
        await entrar(page, '  Ana.Ruiz@Fluidra.com ', 'Ana Ruiz');
        await page.waitForFunction(() => document.querySelector('#cnt-act').textContent.trim() === '2');
        assert.ok(lecturasFuncion(peticiones) >= 1);
        assert.equal(lecturasGithub(peticiones), 0);
        assert.ok(await botonNueva(page), '"Nueva bomba" visible');
        assert.doesNotMatch(await page.locator('#banners').textContent(), /Entra con tu correo|Modo consulta/);
      });
      await check('editar: "Nueva bomba" hace un único PUT a endurance-data/piscina.json por la función, con el nombre de la persona', async () => {
        await nuevaBomba(page);
        await waitFor(() => lab.puts.length === 1);
        const p = lab.puts[0];
        assert.equal(p.via, 'funcion');
        assert.equal(p.repo, 'endurance-data');
        assert.equal(p.path, FICHERO);
        assert.deepEqual(p.author, { name: 'Ana Ruiz', email: 'ana.ruiz@fluidra.com' });
        assert.ok(Object.values(p.data.bombas).some((b) => b.numSerie === 'SN-DEMO-NUEVA'));
        assert.ok(Object.keys(p.data.bombas).includes('bd-001'), 'conserva las bombas anteriores');
        assert.equal(peticiones.filter((q) => q.method === 'PUT' && !q.url.startsWith(FUNCION)).length, 0);
      });
      await check('la sesión sigue al recargar; salir vuelve a "Entrar con tu correo" en solo lectura', async () => {
        await page.reload();
        await esperarCarga(page);
        await esperarBoton(page, 'Ana Ruiz');
        await page.click('#btn-gh');
        await page.click('#gm-out');
        await esperarBoton(page, 'Entrar con tu correo');
        assert.equal(await botonNueva(page), false);
      });
      await check('salir: los datos privados desaparecen de la pantalla y sale "Entra con tu correo para ver la piscina."', async () => {
        assert.equal(await hayDatos(page), false);
        const t = await textoPagina(page);
        assert.doesNotMatch(t, /Proyecto Demo Piscina|REF-DEMO|SN-DEMO|Hotbox demo/);
        assert.match(await page.locator('#banners').textContent(), /Entra con tu correo para ver la piscina\./);
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
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('ver: se ve el plano con los datos y sin botones de registro', async () => {
        await entrar(page, 'luis.ver@fluidra.com', 'Luis Ver');
        await page.waitForFunction(() => document.querySelector('#cnt-act').textContent.trim() === '2');
        assert.ok(lecturasFuncion(peticiones) >= 1);
        assert.equal(await botonNueva(page), false);
        assert.match(await page.locator('#banners').textContent(), /solo puedes consultar/i);
      });
      await check('ver: intentar guardar por cualquier formulario da el aviso de permiso y no hace ningún PUT', async () => {
        await enviarSinPermiso(page);
        await toastVisible(page, /no puedes modificar/);
        assert.match(await toastTexto(page), /permiso de edición/);
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
      await check('ninguno: "No tienes acceso a esta app. Pídeselo a un administrador." y ningún dato', async () => {
        await entrar(page, 'nora.n@fluidra.com', 'Nora Nadie');
        await page.waitForFunction(() => /No tienes acceso a esta app\. Pídeselo a un administrador\./.test(document.querySelector('#banners').textContent));
        assert.equal(await hayDatos(page), false);
        assert.equal(peticiones.filter((p) => p.url.includes('/contents/')).length, 0);
        assert.equal(await botonNueva(page), false);
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
      await check('401 en una consulta sin cambios pendientes: "Vuelve a entrar", los datos siguen en pantalla, solo lectura', async () => {
        lab.revocar('ana.ruiz@fluidra.com');
        await page.clock.fastForward(61000);
        await esperarBoton(page, 'Vuelve a entrar');
        assert.equal(await hayDatos(page), true);
        assert.match(await page.locator('#banners').textContent(), /sesión ha caducado/i);
        assert.equal(await botonNueva(page), false);
        assert.equal(lab.puts.length, 0);
      });
      await check('"Vuelve a entrar" abre el diálogo con el correo puesto; volver a entrar recupera la edición', async () => {
        lab.setUsuarios(USUARIOS);
        await page.click('#btn-gh');
        await page.waitForSelector('#gh-mail');
        assert.equal(await page.inputValue('#gh-mail'), 'ana.ruiz@fluidra.com');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'gh-pass', 'el foco va a la contraseña');
        await page.fill('#gh-pass', CLAVE_PRUEBA);
        await page.press('#gh-pass', 'Enter');
        await esperarBoton(page, 'Ana Ruiz');
        assert.ok(await botonNueva(page));
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
      await check('guardar cuando la sesión ya no vale (401 al enviar) → aviso, "Vuelve a entrar", los datos siguen; no hay PUT', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        lab.revocar('ana.ruiz@fluidra.com');
        await nuevaBomba(page);
        await toastVisible(page, /caducado/);
        await esperarBoton(page, 'Vuelve a entrar');
        assert.equal(lab.puts.length, 0);
        assert.equal(await hayDatos(page), true);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }
    {
      // La sesión caduca (lo nota una consulta) mientras el formulario sigue abierto: al guardar no se hace ninguna lectura
      // anónima de raw ni ninguna escritura.
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('sesión caducada entre abrir el formulario y guardar: se rechaza con el aviso, sin lectura anónima de raw ni PUT', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        await page.click('#btn-new');
        lab.revocar('ana.ruiz@fluidra.com');
        await page.clock.fastForward(61000);
        await esperarBoton(page, 'Vuelve a entrar');
        const raw0 = peticiones.filter((p) => p.url.startsWith('https://raw.githubusercontent.com/')).length;
        await page.evaluate(() => document.getElementById('form').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
        await toastVisible(page, /caducado/);
        assert.equal(lab.puts.length, 0);
        assert.equal(peticiones.filter((p) => p.url.startsWith('https://raw.githubusercontent.com/')).length, raw0);
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
        if (r.url().startsWith('https://raw.githubusercontent.com/') && (h.authorization || h.apikey)) conCabecera.push(r.url());
      });
      await check('función con 500 al arrancar: ninguna petición a GitHub lleva la sesión; la consulta siguiente, ya recuperada, carga los datos', async () => {
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
        assert.match(await p2.locator('#banners').textContent(), /No se pudieron cargar los datos/);
        assert.doesNotMatch(await p2.locator('#banners').textContent(), /caducado/i);
        assert.notEqual(await textoBoton(p2), 'Vuelve a entrar');
        averia.status = 0;
        await p2.clock.fastForward(61000);
        await p2.waitForFunction(() => document.querySelector('#btn-gh-label').textContent === 'Ana Ruiz');
        await p2.waitForFunction(() => document.querySelector('#cnt-act').textContent.trim() === '2');
        assert.ok(await botonNueva(p2));
        assert.deepEqual(conCabecera, []);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores, '|500'), []);
      });
      await ctx.close();
    }

    // ---------- Clave de GitHub ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true, github: { login: 'persona-gh', push: true } });
      await check('con correo configurado, "Usar una clave de GitHub" sigue funcionando (PUT por api.github.com)', async () => {
        await page.click('#btn-gh');
        await page.click('#ov-gh summary');
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await page.waitForFunction(() => document.querySelector('#btn-gh-label').textContent === '@persona-gh' && document.querySelector('#ov-gh').hidden);
        await page.waitForFunction(() => document.querySelector('#cnt-act').textContent.trim() === '2');
        await nuevaBomba(page);
        await waitFor(() => lab.puts.length === 1);
        assert.equal(lab.puts[0].via, 'clave');
        assert.equal(lab.puts[0].path, FICHERO);
        assert.equal(peticiones.filter((p) => p.url.includes(CONTENTS)).length, 0, 'la sesión de correo no se usa con la clave');
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
      await check('clave guardada: todo por api.github.com; consulta cada 30 s', async () => {
        await esperarBoton(page, '@persona-gh');
        assert.equal(peticiones.filter((p) => p.url.includes(CONTENTS)).length, 0);
        assert.ok(lecturasGithub(peticiones) >= 1);
        const n = lecturasGithub(peticiones);
        await page.clock.fastForward(31000);
        await waitFor(() => lecturasGithub(peticiones) === n + 1);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }

    // ---------- Idioma: el interruptor ES | EN cambia los textos sin recargar y sin escribir nada ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, { reloj: true });
      await check('idioma: ES → EN → ES cambia pestañas, botones, cifras y el diálogo abierto, sin recargar ni escribir', async () => {
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        await page.waitForFunction(() => document.querySelector('#cnt-act').textContent.trim() === '2');
        await page.evaluate(() => { window.__sinRecarga = 1; });
        const escrituras = () => peticiones.filter((p) => p.method !== 'GET' && p.method !== 'OPTIONS' && !/\/auth\/v1\/token/.test(p.url)).length;
        const w0 = escrituras(), lect0 = peticiones.length;
        assert.equal(await page.locator('#tab-listado span[data-i18n]').textContent(), 'En ensayo');
        assert.equal(await page.locator('#btn-new span').textContent(), 'Nueva bomba');
        await page.click('.lab-lang button[data-l="en"]');
        assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
        assert.equal(await page.locator('#tab-listado span[data-i18n]').textContent(), 'On test');
        assert.equal(await page.locator('#btn-new span').textContent(), 'New pump');
        assert.match(await page.locator('#kpis').textContent(), /Occupied positions/);
        assert.match(await page.locator('#pool').textContent(), /Socket boxes/);
        assert.equal(await page.title(), 'Endurance pool');
        assert.equal(await page.locator('#btn-gh-label').textContent(), 'Ana Ruiz');
        await page.click('#tab-potencia');
        assert.match(await page.locator('#tbl-pot').textContent(), /Phase 1/);
        // Con un diálogo abierto (el interruptor queda debajo; otra vía llama a LabLang.set): se retitula y conserva lo escrito.
        await page.click('#btn-new');
        assert.equal(await page.locator('#f-title').textContent(), 'New pump');
        assert.equal(await page.locator('#b-save').textContent(), 'Register pump');
        await page.fill('#f-proyecto', 'Proyecto a medias');
        await page.evaluate(() => window.LabLang.set('es'));
        assert.equal(await page.locator('#f-title').textContent(), 'Nueva bomba');
        assert.equal(await page.locator('#b-save').textContent(), 'Registrar bomba');
        assert.equal(await page.inputValue('#f-proyecto'), 'Proyecto a medias', 'lo escrito se conserva');
        await page.click('#ov-form .x');
        await page.click('.lab-lang button[data-l="en"]');
        assert.equal(await page.evaluate(() => window.__sinRecarga), 1, 'sin recarga');
        assert.equal(await page.evaluate(() => localStorage.getItem('lab.lang')), 'en');
        await page.click('.lab-lang button[data-l="es"]');
        assert.equal(await page.locator('#tab-listado span[data-i18n]').textContent(), 'En ensayo');
        assert.match(await page.locator('#tbl-pot').textContent(), /Fase 1/);
        assert.equal(await page.title(), 'Piscina de durabilidad');
        await page.waitForTimeout(300);
        assert.equal(escrituras(), w0, 'cambiar de idioma no envía ninguna escritura');
        assert.equal(lab.puts.length, 0);
        assert.ok(peticiones.length - lect0 <= 1, 'cambiar de idioma no recarga datos');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores } = await abrir(browser, { lang: 'en' });
      await check('idioma: en inglés desde el arranque, sin sesión: aviso y botón en inglés', async () => {
        await page.waitForFunction(() => /Sign in with your email to see the pool\./.test(document.querySelector('#banners').textContent));
        assert.equal(await textoBoton(page), 'Sign in with your email');
        assert.equal(await page.locator('#tab-consumo span[data-i18n]').textContent(), 'Energy consumption');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }

    // ---------- Sin configuración de Supabase: como hoy ----------
    {
      const { ctx, page, lab, errores, peticiones } = await abrir(browser, {
        supabaseUrl: '', anonKey: '', github: { login: 'persona-gh', push: true }, rawPublico: ['endurance-data'],
      });
      await check('sin config y con raw público: los datos se ven como hoy, botón "Conectar con GitHub", sin opción de correo', async () => {
        assert.equal(await hayDatos(page), true);
        assert.equal(await textoBoton(page), 'Conectar con GitHub');
        assert.match(await page.locator('#banners').textContent(), /Modo consulta\. Para registrar o modificar bombas, pulsa «Conectar con GitHub»/);
        await page.click('#btn-gh');
        assert.equal(await page.locator('#ov-gh h2').textContent(), 'Conectar con GitHub');
        assert.equal(await page.locator('#gh-mail').count(), 0);
        assert.equal(await page.locator('#ov-gh summary').count(), 0);
        assert.equal(await page.locator('#ov-gh').getByText('Entrar con tu correo').count(), 0);
      });
      await check('sin config: la clave funciona y "Nueva bomba" guarda por api.github.com', async () => {
        await page.fill('#gh-token', 'ghp_prueba');
        await page.press('#gh-token', 'Enter');
        await esperarBoton(page, '@persona-gh');
        await nuevaBomba(page);
        await waitFor(() => lab.puts.length === 1, 8000);
        assert.equal(lab.puts[0].via, 'clave');
        assert.ok(!peticiones.some((p) => p.url.includes('supabase')), 'ninguna petición a Supabase');
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
        assert.deepEqual(errores.otros404(), []);
      });
      await ctx.close();
    }
    {
      // Importar Excel: la tabla empieza en D5, como en el fichero de las tandas (18_bombas_durabilidad.xlsx).
      const XLSX = require('xlsx');
      const filas = [
        ['Posición', 'Petaca', 'Proyecto', 'Fabricante motor', 'Potencia', 'Referencia', 'S/N', 'Fecha Inicio', 'Fecha Fin'],
        [27, 27.3, '25046 SSP TO VSP CONVERSION', 'HEIENENG', '150M', '78491 VICTORIA VS 150M', 33262078867, new Date(Date.UTC(2026, 10, 12)), null],
        [28, 28.1, '25046 SSP TO VSP CONVERSION', 'HEINENG ', '100M', '78490 VICTORIA VS 100M', 33262078846, new Date(Date.UTC(2026, 10, 12)), null],
        [29, 28.1, '25046 SSP TO VSP CONVERSION', 'HEINENG ', '100M', '78490 VICTORIA VS 100M', 33262078851, new Date(Date.UTC(2026, 10, 12)), null], // misma fase que la fila anterior
        [1, 40.2, '25046 SSP TO VSP CONVERSION', 'HEINENG ', '100M', '78490 VICTORIA VS 100M', 33262078852, new Date(Date.UTC(2026, 10, 12)), null], // posición ocupada
        [2, 2.1, 'Demo', 'Motor Demo', '100M', 'REF', 'SN-DEMO-2', new Date(Date.UTC(2026, 10, 12)), null], // ya está (misma posición y serie)
        [30, 30, '25046 SSP TO VSP CONVERSION', 'HEINENG ', '300T', '78495 TRI', 'TRI-1', '12/11/2026', '30/04/2027'],
      ];
      const ws = XLSX.utils.aoa_to_sheet(filas, { origin: 'D5', cellDates: true });
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      const excel = { name: '18_bombas_durabilidad.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) };
      const { ctx, page, lab, errores } = await abrir(browser);
      const celda = (i, k) => page.locator(`#imp-tbl tr[data-i="${i}"] [data-imp="${k}"]`);
      const estadoFila = (i) => page.locator(`#imp-tbl tr[data-i="${i}"] .c-st`).textContent();
      await check('Importar Excel: solo con permiso de edición', async () => {
        assert.ok(await page.isHidden('#btn-imp'));
        await entrar(page, 'ana.ruiz@fluidra.com', 'Ana Ruiz');
        assert.ok(await page.isVisible('#btn-imp'));
      });
      await check('Importar Excel: lee la tabla desde D5 e interpreta petaca, potencia, serie y fechas; nada se guarda todavía', async () => {
        await page.setInputFiles('#imp-file', excel);
        await page.waitForSelector('#ov-imp:not([hidden])');
        assert.match(await page.textContent('#imp-sub'), /6 filas leídas de 18_bombas_durabilidad\.xlsx/);
        assert.equal(await celda(0, 'posicion').inputValue(), '27');
        assert.equal(await celda(0, 'petaca').inputValue(), '27.3');
        assert.equal(await celda(0, 'tipo').inputValue(), 'mono');
        assert.equal(await celda(0, 'potencia').inputValue(), '1,5');
        assert.equal(await celda(0, 'numSerie').inputValue(), '33262078867');
        assert.equal(await celda(0, 'fechaInicio').inputValue(), '2026-11-12');
        assert.equal(await celda(0, 'fechaFin').inputValue(), '2027-05-12', 'fin = inicio + 6 meses');
        assert.equal(await celda(5, 'tipo').inputValue(), 'tri');
        assert.equal(await celda(5, 'potencia').inputValue(), '3');
        assert.equal(await celda(5, 'fechaFin').inputValue(), '2027-04-30');
        assert.equal(lab.puts.length, 0);
      });
      await check('Importar Excel: marca la fase repetida entre filas, la posición ocupada y la bomba que ya está', async () => {
        assert.match(await estadoFila(0), /Correcta/);
        assert.match(await estadoFila(1), /Correcta/);
        assert.match(await estadoFila(2), /La fase 28\.1 está ocupada/);
        assert.match(await estadoFila(3), /La posición 1 está ocupada/);
        assert.match(await estadoFila(4), /Ya está en la piscina/);
        assert.match(await page.textContent('#imp-sum'), /3 correctas · 2 con errores \(no se importan\) · 1 ya en la piscina/);
        assert.match(await page.textContent('#imp-ok'), /Importar 3 bombas/);
      });
      await check('Importar Excel: sustituir un fabricante mal escrito en todas sus filas y corregir una celda', async () => {
        assert.match(await page.textContent('#imp-fab'), /«HEIENENG» no existe todavía \(1 fila\)/);
        assert.match(await page.textContent('#imp-fab'), /«HEINENG» no existe todavía \(4 filas\)/);
        for (const n of ['HEIENENG', 'HEINENG']) {
          await page.fill(`#imp-fab input[data-fab="${n}"]`, 'HAINENG MSL');
          await page.click(`#imp-fab [data-fab-go="${n}"]`);
        }
        assert.equal(await celda(0, 'fabricante').inputValue(), 'HAINENG MSL');
        assert.equal(await celda(1, 'fabricante').inputValue(), 'HAINENG MSL');
        assert.match(await page.textContent('#imp-fab'), /«HAINENG MSL» no existe todavía \(5 filas\)/);
        await celda(2, 'petaca').fill('28.2');
        await celda(2, 'petaca').blur();
        await page.waitForFunction(() => /Importar 4 bombas/.test(document.querySelector('#imp-ok').textContent));
        assert.match(await estadoFila(2), /Correcta/);
      });
      await check('Importar Excel: aceptar guarda las filas correctas en un único PUT, con los campos del formulario', async () => {
        await page.click('#imp-ok');
        await waitFor(() => lab.puts.length === 1);
        const p = lab.puts[0];
        assert.equal(p.via, 'funcion');
        assert.match(p.message, /^Importa 4 bombas desde Excel \(pos\. 27, 28, 29, 30\)$/);
        const nuevas = Object.values(p.data.bombas).filter((b) => String(b.origen || '').startsWith('Importación'));
        assert.equal(nuevas.length, 4);
        const b27 = nuevas.find((b) => b.posicion === 27);
        assert.deepEqual(
          [b27.petaca, b27.fase, b27.tipo, b27.potencia, b27.unidad, b27.fabricante, b27.numSerie, b27.fechaInicio, b27.fechaFin, b27.estado, b27.fechaRetirada],
          [27, 3, 'mono', 1.5, 'HP', 'HAINENG MSL', '33262078867', '2026-11-12', '2027-05-12', 'activa', null]);
        const b30 = nuevas.find((b) => b.posicion === 30);
        assert.deepEqual([b30.petaca, b30.fase, b30.tipo, b30.potencia], [30, null, 'tri', 3]);
        assert.equal(Object.values(p.data.bombas).filter((b) => b.posicion === 1 && b.estado === 'activa').length, 1, 'la posición ocupada no se toca');
        await page.waitForSelector('#ov-imp', { state: 'hidden' });
        assert.match(await page.textContent('#toast'), /4 bombas importadas/);
      });
      await check('Importar Excel: un fichero sin la tabla avisa y no abre la ventana; sin errores de consola', async () => {
        const otro = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(otro, XLSX.utils.aoa_to_sheet([['Hola', 'Mundo'], [1, 2]]), 'H');
        await page.setInputFiles('#imp-file', { ...excel, name: 'otro.xlsx', buffer: XLSX.write(otro, { type: 'buffer', bookType: 'xlsx' }) });
        await page.waitForFunction(() => /No encuentro la tabla/.test(document.querySelector('#toast').textContent));
        assert.ok(await page.isHidden('#ov-imp'));
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
      });
      await ctx.close();
    }
    {
      const { ctx, page, lab, errores } = await abrir(browser, { supabaseUrl: '', anonKey: '' });
      await check('sin config y raw 404: el aviso de siempre ("Los datos de esta app son privados"), sin mención al correo', async () => {
        const t = await page.locator('#banners').textContent();
        assert.match(t, /Los datos de esta app son privados\. Pulsa «Conectar con GitHub»/);
        assert.doesNotMatch(t, /Entra con tu correo/i);
        assert.deepEqual(lab.bloqueadas, []);
        assert.deepEqual(erroresReales(errores), []);
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
