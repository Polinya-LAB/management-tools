# Pruebas

## Funciones de Supabase (Deno, sin red)

```sh
npx deno@2.9.6 test supabase/functions/
```

## Navegador (Playwright, todo simulado)

Una vez, para instalar las dependencias de prueba:

```sh
cd tests && npm install
```

Después, desde la raíz del repositorio:

```sh
node tests/e2e/<fichero>.test.js     # p. ej. node tests/e2e/lab-auth.test.js
```

Cada fichero es un script de Node que imprime una línea por comprobación (`ok` / `FAIL`) y termina con código distinto de 0
si alguna falla. Usa el Playwright instalado en el sistema (`require('playwright')`, `chromium.launch()`).

### Simulación (`tests/e2e/lab-mock.js`)

`setupLab(ctx, opts)` prepara un contexto de Playwright sin red real:

- `https://polinya-lab.github.io/management-tools/**` se sirve desde el repositorio (`opts.mtDir`), y
  `acceso/config.js` se sustituye por uno con la configuración de prueba (`supabaseUrl`, `anonKey`; vacíos = sin correo).
- Las bibliotecas de CDN (xlsx de cdnjs; qrcode-generator, jsbarcode y `@supabase/supabase-js` de jsDelivr) se sirven
  desde `tests/node_modules`, con la misma versión que piden las apps. Google Fonts devuelve CSS vacío.
- Supabase Auth (`/auth/v1/otp`, `verify`, `token`, `user`, `logout`) con código fijo (`opts.codigo`, por defecto `123456`)
  y solo para los correos de `opts.usuarios`.
- `/functions/v1/github/**` y `/functions/v1/admin/**` ejecutan los handlers reales de `supabase/functions/` (empaquetados
  con esbuild) con dependencias falsas: la lógica de permisos es la de verdad.
- `api.github.com` (con `opts.github = {login, push}`) y `raw.githubusercontent.com` para el modo "clave de GitHub".
- Los datos son copias en memoria de `tests/e2e/fixtures/<repo>/<ruta>`: **datos inventados** (este repositorio es
  público; nunca copiar datos reales del laboratorio).
- Cualquier otra petición se bloquea y queda en `lab.bloqueadas`.

Devuelve `{puts, otps, verifies, tokens, logouts, bloqueadas, refrescos, setUsuarios(lista), usuarios(), revocar(email),
datos(repo, ruta), fijarDatos(repo, ruta, valor)}`. `revocar(email)` invalida las sesiones abiertas de esa persona: la
siguiente llamada a las funciones responde 401.

Crea los contextos con `browser.newContext({serviceWorkers: 'block'})`: las peticiones que atiende un service worker
(Muestras registra uno) no pasan por las rutas de Playwright.
