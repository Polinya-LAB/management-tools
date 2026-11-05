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
  const { reloj, clave, ...labOpts } = opts;
  const ctx = await browser.newContext({ serviceWorkers: 'block' });
  const lab = await setupLab(ctx, { usuarios: USUARIOS, ...labOpts });
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
