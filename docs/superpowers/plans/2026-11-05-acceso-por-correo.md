# Acceso por correo y roles por app · Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que el personal del laboratorio entre en las apps con un código por correo y vea o modifique según su rol por app, sin cuenta de GitHub, con los datos en GitHub privados.

**Architecture:** Supabase Auth (código por correo) + tabla `acceso` con los roles + Edge Function `github` que imita las rutas de la API de GitHub que ya usan las apps, comprueba el rol y reenvía con una clave del servidor; Edge Function `admin` para la página de administración. Las apps cargan `acceso/lab-auth.js` y eligen origen de datos: función (sesión de correo) o `api.github.com` (clave de GitHub, como ahora).

**Tech Stack:** Supabase (Postgres, Auth, Edge Functions en Deno), `@supabase/supabase-js@2.49.4` (jsDelivr en las apps, `npm:` en Deno), Deno 2 para pruebas de funciones (`npx deno@2.9.6`), Playwright ya instalado para pruebas de las apps, Supabase CLI (`npx supabase@2.x`) para desplegar.

**Spec:** `docs/superpowers/specs/2026-11-05-acceso-por-correo-design.md`

## Global Constraints

- Roles: valores `ninguno`, `ver`, `editar`; claves `ensayos`, `muestras`, `calibraciones`, `mantenimiento`, `piscina`; `admin` booleano. Clave ausente = `ninguno`.
- Apps en la URL de la función: `ensayos`, `ocupacion` (usa el rol `ensayos`), `muestras`, `calibraciones`, `mantenimiento`, `piscina`.
- Tabla de lecturas/escrituras por app: la de la §3 del spec, copiada en `PERMISOS` (Tarea 1). No hay otra fuente.
- Repositorios permitidos: propietario `Polinya-LAB`, repos `lab-data` y `endurance-data`, rama `main`.
- `ensayos.json`: `muestras` y `config/samples` exigen `editar` en `muestras`; el resto de colecciones (incluido el resto de `config`) exige `editar` en `ensayos`.
- Código de acceso: 6 dígitos, validez 10 min, `shouldCreateUser:false`, registro libre desactivado.
- CORS: `https://polinya-lab.github.io` y `http://localhost:*`.
- Consulta periódica con sesión de correo: 60 s y solo con la pestaña visible; con clave de GitHub, sin cambios (30 s).
- Commits con `author` y `committer` = `{name: nombre, email}` de la persona.
- Correos guardados en minúsculas; las comparaciones de correo, en minúsculas.
- Idioma de la interfaz: inglés en Control de ensayos, Ocupación, Calibraciones y Mantenimiento ("Sign in with your email"); castellano en Muestras (con ES/EN), Piscina y la página de administración ("Entrar con tu correo").
- Sin configuración de Supabase (`acceso/config.js` vacío), las apps no muestran la opción de correo y funcionan como hoy.
- Ningún secreto en `management-tools`: la clave de GitHub del servidor solo como secreto `GITHUB_TOKEN` de Supabase.

## Review Focus

- **Sesión caducada o persona dada de baja con la app abierta:** la siguiente consulta recibe 401; la app pasa a "Sign in again" sin borrar lo que hay en pantalla ni los cambios pendientes de reintento. Test en Tarea 5.
- **Validar códigos en Muestras con rol `ver` en `ensayos`:** el guardado solo toca `muestras` y `config/samples` y debe pasar; tocar `config/importAras` debe exigir `ensayos`. Test en Tarea 1.
- **Dos personas guardan a la vez:** la función devuelve el 409/422 de GitHub tal cual para que la app reintente con el nuevo `sha`. Test en Tarea 3.
- **Correo escrito con mayúsculas o espacios** (`  Daniel.Q@Fluidra.com `): se normaliza al dar de alta y al pedir código. Tests en Tareas 4 y 5.
- **Fichero de más de 1 MB** (GitHub no devuelve `content`): la función lo rellena desde el blob y la app no pide `git/blobs`. Test en Tarea 3.

---

## Estructura de ficheros (todo en `management-tools`)

| Fichero | Responsabilidad |
|---|---|
| `supabase/config.toml` | Proyecto Supabase local para la CLI (funciones `github` y `admin`, `verify_jwt = false`: la función valida el JWT ella misma para dar 401 con CORS) |
| `supabase/migrations/20261105000000_acceso.sql` | Tabla `acceso`, RLS, disparador de `actualizado` |
| `supabase/functions/_shared/permisos.ts` (+ `_test.ts`) | Lógica pura de roles y ficheros |
| `supabase/functions/_shared/cors.ts` | Cabeceras CORS y respuesta a `OPTIONS` |
| `supabase/functions/github/handler.ts` (+ `_test.ts`), `index.ts` | Proxy a GitHub; `index.ts` solo conecta dependencias reales |
| `supabase/functions/admin/handler.ts` (+ `_test.ts`), `index.ts` | Altas, roles, bajas |
| `acceso/config.js` | `window.LAB_SUPABASE={url:'',anonKey:''}` (se rellena al desplegar) |
| `acceso/lab-auth.js` | Módulo común de sesión para las apps |
| `acceso/index.html` | Página de administración |
| `acceso/DESPLIEGUE.md` | Pasos de despliegue para Daniel |
| `tests/e2e/lab-mock.js` | Simulación de Supabase Auth + función `github`/`admin` sobre ficheros locales, para Playwright |
| `tests/e2e/*.test.js`, `tests/README.md` | Pruebas de las apps (node + Playwright) |
| `control-ensayos/app.js`, `control-ensayos/index.html`, `ocupacion/index.html`, `muestras/index.html` | Integración en la base común |
| `calibraciones/index.html`, `mantenimiento/index.html`, `seguimiento-piscina-durabilidad/index.html` | Integración en cada app |

---

### Task 1: Lógica de permisos

**Files:**
- Create: `supabase/functions/_shared/permisos.ts`
- Test: `supabase/functions/_shared/permisos_test.ts`

**Interfaces:**
- Produces:
  - `type Rol = 'ninguno'|'ver'|'editar'`; `type ClaveRol = 'ensayos'|'muestras'|'calibraciones'|'mantenimiento'|'piscina'`; `type AppId = ClaveRol|'ocupacion'`
  - `interface Acceso { email:string; nombre:string; roles:Partial<Record<ClaveRol,Rol>>; admin:boolean }`
  - `const PERMISOS: Record<AppId,{rol:ClaveRol; leer:string[]; escribir:string[]}>`; rutas como `"lab-data/ensayos/ensayos.json"`
  - `rolDe(a:Acceso, app:AppId): Rol`
  - `puedeLeer(a:Acceso, app:AppId, repo:string, path:string): boolean`
  - `coleccionesCambiadas(antes:Record<string,unknown>, despues:Record<string,unknown>): {muestras:boolean; ensayos:boolean}`
  - `comprobarEscritura(a:Acceso, app:AppId, repo:string, path:string, antes:unknown|null, despues:unknown): {ok:true}|{ok:false; motivo:string}`

- [ ] **Step 1: Escribir las pruebas** en `permisos_test.ts` (`Deno.test`, `assertEquals` de `jsr:@std/assert@1`):
  - `rolDe` con `ocupacion` devuelve el rol `ensayos`; clave ausente → `ninguno`.
  - `puedeLeer`: `ver` en `ensayos` lee `lab-data/ensayos/ensayos.json` y `lab-data/calibraciones/calibraciones.json`, no `lab-data/mantenimiento/registro.json`; `ninguno` no lee nada; `piscina` lee `endurance-data/piscina.json`; repo desconocido → `false`.
  - `coleccionesCambiadas`: solo `muestras` cambia → `{muestras:true,ensayos:false}`; solo `config.samples` → `{muestras:true,ensayos:false}`; `config.importAras` → `{muestras:false,ensayos:true}`; `tests` y `muestras` → ambos `true`; claves en distinto orden pero mismo contenido → ambos `false`.
  - `comprobarEscritura`: `editar` en `muestras` + `ver` en `ensayos` guardando un cambio solo en `muestras` y `config.samples` desde app `muestras` → ok; el mismo usuario cambiando `tests` → `{ok:false}`; `editar` en `ensayos` cambiando `muestras` → `{ok:false}`; `ver` en `calibraciones` escribiendo `calibraciones.json` → `{ok:false}`; `editar` en `mantenimiento` escribiendo `mantenimiento/mantenimiento.json` → `{ok:false}` (no está en `escribir`); `antes=null` (fichero nuevo, p. ej. `registro.json` la primera vez) con `editar` → ok.
- [ ] **Step 2:** `npx deno@2.9.6 test supabase/functions/_shared/` → FAIL (módulo no existe).
- [ ] **Step 3: Implementar** `permisos.ts`. `PERMISOS` copia la §3 del spec. `coleccionesCambiadas` compara con JSON canónico (claves ordenadas) colección a colección; `config` se compara por documento, y `config.samples` cuenta como `muestras`. `comprobarEscritura` solo aplica `coleccionesCambiadas` a `lab-data/ensayos/ensayos.json`.
- [ ] **Step 4:** `npx deno@2.9.6 test supabase/functions/_shared/` → PASS.
- [ ] **Step 5: Commit** `Acceso: lógica de permisos por app`.

### Task 2: Tabla `acceso` y proyecto Supabase local

**Files:**
- Create: `supabase/config.toml`, `supabase/migrations/20261105000000_acceso.sql`

- [ ] **Step 1:** `config.toml` con `project_id = "laboratorio"`, `[functions.github] verify_jwt = false`, `[functions.admin] verify_jwt = false`, `[auth] enable_signup = false`, `[auth.email] otp_length = 6`, `otp_expiry = 600`.
- [ ] **Step 2:** migración: tabla `public.acceso(email text primary key check (email = lower(email)), user_id uuid references auth.users on delete set null, nombre text not null, roles jsonb not null default '{}', admin boolean not null default false, creado timestamptz not null default now(), actualizado timestamptz not null default now())`; `alter table ... enable row level security` sin políticas; disparador que pone `actualizado = now()` en cada `update`.
- [ ] **Step 3:** comprobar la sintaxis con `npx supabase@2 db lint` si hay Docker; si no, revisar a mano que la migración se aplica en orden en el editor SQL (se aplica en el despliegue, Tarea 11).
- [ ] **Step 4: Commit** `Acceso: tabla de roles`.

### Task 3: Función `github`

**Files:**
- Create: `supabase/functions/_shared/cors.ts`, `supabase/functions/github/handler.ts`, `supabase/functions/github/index.ts`
- Test: `supabase/functions/github/handler_test.ts`

**Interfaces:**
- Consumes: `PERMISOS`, `rolDe`, `puedeLeer`, `comprobarEscritura`, `Acceso` (Tarea 1).
- Produces:
  - `corsHeaders(origin:string|null): HeadersInit`; `preflight(req:Request): Response|null` (cors.ts)
  - `interface Deps { usuario(jwt:string): Promise<{email:string}|null>; acceso(email:string): Promise<Acceso|null>; gh(path:string, init?:RequestInit): Promise<Response> }`, donde `gh` llama a `https://api.github.com${path}` con `GITHUB_TOKEN`
  - `crearHandler(deps:Deps): (req:Request) => Promise<Response>`
  - Rutas: `/github/<app>/user`, `/github/<app>/repos/Polinya-LAB/<repo>`, `/github/<app>/repos/Polinya-LAB/<repo>/contents/<path>` (GET con `?ref=main`, PUT)

- [ ] **Step 1: Escribir las pruebas** con `Deps` falsos y un `gh` simulado que guarda las peticiones:
  - Sin `Authorization` → 401; JWT válido sin fila en `acceso` → 403; `OPTIONS` → 204 con `Access-Control-Allow-Origin: https://polinya-lab.github.io`.
  - `GET /github/ensayos/user` → `{login:'Ana Ruiz', name:'Ana Ruiz', email:'ana@fluidra.com'}`.
  - `GET /github/calibraciones/repos/Polinya-LAB/lab-data` con `editar` → `permissions.push === true`; con `ver` → `false`.
  - GET contents permitido reenvía `If-None-Match` y devuelve el `304` y el `ETag` de GitHub; ruta fuera de `leer` → 404 sin llamar a `gh`; `ref` distinto de `main` → 403.
  - GitHub responde sin `content` y con `sha` → la función pide `/repos/Polinya-LAB/lab-data/git/blobs/<sha>` y devuelve el JSON con `content` relleno.
  - PUT permitido: el cuerpo que llega a `gh` lleva `author` y `committer` `{name:'Ana Ruiz', email:'ana@fluidra.com'}`, conserva `message`, `sha`, `branch`, `content`; la función lee el fichero actual (GET contents) para `comprobarEscritura`.
  - PUT rechazado por `comprobarEscritura` → 403 con `{message:<motivo>}` y sin PUT a GitHub.
  - GitHub responde 409 al PUT → la función devuelve 409 con el mismo cuerpo.
  - Ruta `/github/ensayos/repos/Polinya-LAB/lab-data/git/blobs/x` o repo `management-tools` → 403.
- [ ] **Step 2:** `npx deno@2.9.6 test supabase/functions/github/` → FAIL.
- [ ] **Step 3: Implementar** `cors.ts` y `handler.ts`. `index.ts` crea `Deps` reales: `usuario` con `createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).auth.getUser(jwt)`, `acceso` con una consulta a la tabla (correo en minúsculas), `gh` con `fetch` y `Authorization: Bearer ${Deno.env.get('GITHUB_TOKEN')}`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`; y llama a `Deno.serve(crearHandler(deps))`.
- [ ] **Step 4:** `npx deno@2.9.6 test supabase/functions/` → PASS; `npx deno@2.9.6 check supabase/functions/github/index.ts` sin errores.
- [ ] **Step 5: Commit** `Acceso: función github (proxy con roles)`.

### Task 4: Función `admin`

**Files:**
- Create: `supabase/functions/admin/handler.ts`, `supabase/functions/admin/index.ts`
- Test: `supabase/functions/admin/handler_test.ts`

**Interfaces:**
- Consumes: `Acceso`, `corsHeaders`, `preflight`.
- Produces:
  - `interface AdminDeps { usuario(jwt:string):Promise<{email:string}|null>; acceso(email:string):Promise<Acceso|null>; listar():Promise<Acceso[]>; guardar(a:Acceso):Promise<void>; borrar(email:string):Promise<void>; crearUsuarioAuth(email:string):Promise<string>; borrarUsuarioAuth(email:string):Promise<void> }`
  - `crearHandlerAdmin(deps:AdminDeps)`; rutas `GET /admin/usuarios`, `POST /admin/usuarios` (cuerpo `{email,nombre,roles,admin}`), `DELETE /admin/usuarios/<email>`; respuestas JSON `{usuarios:Acceso[]}` / `{ok:true}`

- [ ] **Step 1: Escribir las pruebas:** no administrador → 403 en las tres rutas; `POST` con `"  Ana.Ruiz@Fluidra.com "` guarda `ana.ruiz@fluidra.com` y llama a `crearUsuarioAuth` solo si no existía; `roles` con un valor que no es `ninguno|ver|editar` o una clave desconocida → 400; un administrador que se guarda a sí mismo con `admin:false` → 400; `DELETE` de sí mismo → 400; `DELETE` de otro llama a `borrar` y `borrarUsuarioAuth`; `GET` devuelve la lista ordenada por `nombre`.
- [ ] **Step 2:** `npx deno@2.9.6 test supabase/functions/admin/` → FAIL.
- [ ] **Step 3: Implementar.** `index.ts`: `crearUsuarioAuth` con `auth.admin.createUser({email, email_confirm:true})`; `borrarUsuarioAuth` busca el `user_id` en `acceso` y llama a `auth.admin.deleteUser`.
- [ ] **Step 4:** `npx deno@2.9.6 test supabase/functions/` → PASS; `deno check` de `admin/index.ts`.
- [ ] **Step 5: Commit** `Acceso: función admin`.

### Task 5: Módulo común `lab-auth.js` y simulación para pruebas

**Files:**
- Create: `acceso/config.js`, `acceso/lab-auth.js`, `tests/e2e/lab-mock.js`, `tests/e2e/lab-auth.test.js`, `tests/README.md`

**Interfaces:**
- Consumes: el contrato HTTP de la Tarea 3.
- Produces (en `window.LabAuth`):
  - `LabAuth.activo: boolean` (hay `url` y `anonKey` en `LAB_SUPABASE`)
  - `LabAuth.sesion(): Promise<{email:string}|null>`
  - `LabAuth.pedirCodigo(email:string): Promise<void>` (normaliza el correo; error `{code:'not_allowed'}` si Supabase responde que el usuario no existe)
  - `LabAuth.verificar(email:string, codigo:string): Promise<void>` (error `{code:'bad_code'}`)
  - `LabAuth.salir(): Promise<void>`
  - `LabAuth.api(app:string): string` → `${url}/functions/v1/github/${app}`
  - `LabAuth.cabeceras(): Promise<Record<string,string>>` → `{Authorization:'Bearer <jwt>', apikey:<anonKey>}` con el JWT renovado si hace falta
  - `LabAuth.onCambio(fn:(sesion)=>void)`
  - `tests/e2e/lab-mock.js`: `setupLab(ctx, {usuarios:Acceso[], codigo:'123456', mtDir, dataDirs})` que simula `/auth/v1/otp`, `/auth/v1/verify`, `/auth/v1/token`, `/auth/v1/user`, `/functions/v1/github/**` y `/functions/v1/admin/**`, reutilizando la tabla `PERMISOS` (el mock la carga transpilando `permisos.ts` con esbuild) y registra los PUT recibidos

- [ ] **Step 1: Escribir `lab-auth.test.js`:** página de prueba que carga `acceso/config.js` (con valores de prueba inyectados), `supabase-js` y `lab-auth.js`; `pedirCodigo('  Ana.Ruiz@Fluidra.com ')` envía `ana.ruiz@fluidra.com` a `/auth/v1/otp` con `create_user:false`; correo no dado de alta → `not_allowed`; `verificar` con `000000` → `bad_code`, con `123456` → `sesion()` devuelve el correo; tras recargar la página la sesión sigue; `salir()` la borra; con `LAB_SUPABASE={url:'',anonKey:''}` → `LabAuth.activo === false` y no se carga `supabase-js`.
- [ ] **Step 2:** `node tests/e2e/lab-auth.test.js` → FAIL.
- [ ] **Step 3: Implementar.** `lab-auth.js` carga `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.4/dist/umd/supabase.min.js` solo si `activo`; `createClient(url, anonKey, {auth:{persistSession:true, storageKey:'lab-auth'}})`. `tests/README.md`: cómo ejecutar las pruebas (`npx deno@2.9.6 test supabase/functions/` y `node tests/e2e/<fichero>.test.js`) y que las bibliotecas de CDN se sirven desde `node_modules` en las pruebas.
- [ ] **Step 4:** `node tests/e2e/lab-auth.test.js` → PASS.
- [ ] **Step 5: Commit** `Acceso: módulo común de sesión y simulación para pruebas`.

### Task 6: Control de ensayos, Ocupación y Muestras

**Files:**
- Modify: `control-ensayos/app.js` (capa de datos: `ghFetch`, `fetchApi`, `loadCal`, `connectGh`, `disconnectGh`, `renderGh`, `openGh`, `refresh`, intervalo de consulta), `control-ensayos/index.html`, `ocupacion/index.html`, `muestras/index.html` (cargar `../acceso/config.js` y `../acceso/lab-auth.js` antes de `app.js`; subir `?v=`)
- Test: `tests/e2e/ensayos.test.js`

**Interfaces:**
- Consumes: `LabAuth` (Tarea 5); `app` de la función = `ensayos` | `ocupacion` | `muestras` según `APP` (`tests` → `ensayos`, `occupancy` → `ocupacion`, `samples` → `muestras`).
- Produces: `GH.modo: 'correo'|'clave'|null`; con `correo`, `API` = `${LabAuth.api(app)}/repos/Polinya-LAB/lab-data`, `GH.login` = nombre, `GH.push` = `permissions.push` de la función.

- [ ] **Step 1: Escribir `ensayos.test.js`** con `setupLab`:
  - Diálogo de conexión: "Sign in with your email" arriba, "Use a GitHub key" debajo; correo → código → cabecera con el nombre.
  - `ver` en `ensayos`: no aparecen "+ New test" ni "Import ARAS"; ningún PUT.
  - `editar` en `ensayos`: editar un ensayo genera un PUT a la función con mensaje `Control de ensayos: update …`.
  - Muestras con `editar` en `muestras` y `ver` en `ensayos`: no aparece *Import ARAS*; validar una propuesta guarda (PUT aceptado); Ocupación con `ninguno` en `ensayos` muestra "You don't have access to this app".
  - La función responde 401 en la siguiente consulta → botón de cabecera "Sign in again", los datos siguen en pantalla.
  - Clave de GitHub (mock de `api.github.com` existente en `manual/fuente/mock.js`) sigue funcionando.
  - Consulta periódica: con sesión de correo, 60 s.
  - Ningún error de consola.
- [ ] **Step 2:** `node tests/e2e/ensayos.test.js` → FAIL.
- [ ] **Step 3: Implementar.** `ghFetch` añade las cabeceras de `LabAuth` en modo correo; el resto de la capa de datos no cambia. *Import ARAS* en Muestras depende de un `GH.pushEnsayos` que la app obtiene con `GET ${LabAuth.api('ensayos')}/repos/Polinya-LAB/lab-data`. Textos de Muestras con `tx()` (ES/EN).
- [ ] **Step 4:** `node tests/e2e/ensayos.test.js` → PASS (incluye que `control-ensayos/#queue?plr=PLR003715` sigue abriendo la cola filtrada, con sesión de correo y con clave).
- [ ] **Step 5: Commit** `Control de ensayos, Ocupación y Muestras: entrar con correo`.

### Task 7: Plan de calibraciones

**Files:**
- Modify: `calibraciones/index.html` (su copia de la capa de datos, en torno a `REPO`/`API`/`connectGh`, líneas ~1398-1640)
- Test: `tests/e2e/calibraciones.test.js`

- [ ] **Step 1: Escribir las pruebas:** con `ver` en `calibraciones` se leen `calibraciones.json` y `certificados.json` y no hay botones de edición; con `editar`, registrar una calibración genera un PUT; con `ninguno`, aviso de sin acceso; clave de GitHub sigue funcionando.
- [ ] **Step 2:** ejecutar → FAIL.
- [ ] **Step 3: Implementar** con el mismo patrón que la Tarea 6 (app `calibraciones`; consulta cada 60 s con sesión de correo).
- [ ] **Step 4:** ejecutar → PASS.
- [ ] **Step 5: Commit** `Plan de calibraciones: entrar con correo`.

### Task 8: Plan de mantenimiento

**Files:**
- Modify: `mantenimiento/index.html` (capa de datos, líneas ~689-890)
- Test: `tests/e2e/mantenimiento.test.js`

- [ ] **Step 1: Escribir las pruebas:** con `ver` se leen `mantenimiento.json`, `registro.json` y `calibraciones.json`; con `editar`, registrar un mantenimiento hace PUT solo a `registro.json`; `registro.json` inexistente (primer guardado) funciona; clave de GitHub sigue funcionando.
- [ ] **Step 2:** ejecutar → FAIL.
- [ ] **Step 3: Implementar** (app `mantenimiento`; consulta cada 60 s con sesión de correo).
- [ ] **Step 4:** ejecutar → PASS.
- [ ] **Step 5: Commit** `Plan de mantenimiento: entrar con correo`.

### Task 9: Seguimiento piscina durabilidad

**Files:**
- Modify: `seguimiento-piscina-durabilidad/index.html` (capa de datos, líneas ~1714-1900)
- Test: `tests/e2e/piscina.test.js`

- [ ] **Step 1: Escribir las pruebas:** sin sesión y con `raw.githubusercontent.com` respondiendo 404 (repo privado) → aviso "Entra con tu correo para ver la piscina"; con `ver` se ve el plano sin botones de registro; con `editar`, "Nueva bomba" guarda con PUT a `endurance-data/piscina.json`; clave de GitHub sigue funcionando.
- [ ] **Step 2:** ejecutar → FAIL.
- [ ] **Step 3: Implementar** (app `piscina`; textos en castellano; consulta cada 60 s con sesión de correo).
- [ ] **Step 4:** ejecutar → PASS.
- [ ] **Step 5: Commit** `Piscina: entrar con correo y aviso con el repositorio privado`.

### Task 10: Página de administración

**Files:**
- Create: `acceso/index.html`
- Modify: `index.html` (enlace discreto "Administrar accesos" al pie de la portada)
- Test: `tests/e2e/admin.test.js`

**Interfaces:**
- Consumes: `LabAuth`; rutas de la Tarea 4 en `${LAB_SUPABASE.url}/functions/v1/admin`.

- [ ] **Step 1: Escribir las pruebas:** no administrador → "Esta página es solo para administradores"; administrador ve la tabla (nombre, correo, un selector `—/Ver/Editar` por cada clave de rol, casilla de administrador); "Añadir persona" con correo y nombre crea la fila; cambiar un selector envía `POST` y muestra "Guardado"; "Dar de baja" pide confirmación y envía `DELETE`; la casilla de administrador propia está desactivada.
- [ ] **Step 2:** ejecutar → FAIL.
- [ ] **Step 3: Implementar** con los tokens visuales de la portada.
- [ ] **Step 4:** ejecutar → PASS.
- [ ] **Step 5: Commit** `Acceso: página de administración`.

### Task 11: Documentación, beta y despliegue

**Files:**
- Create: `acceso/DESPLIEGUE.md`
- Modify: `README.md` (sección "Acceso con correo" y tabla de repositorios), `new-projects/muestras/` (copiar `app.js`/`app.css` con `PREVIEW=true`, cargar `config.js` y `lab-auth.js` desde `https://polinya-lab.github.io/management-tools/acceso/`, regenerar el parche), memoria en `lab-data/archivos-traspaso/memoria/`

- [ ] **Step 1: Escribir `DESPLIEGUE.md`** con los pasos 1-8 de la §6 del spec, concretos: crear el proyecto (Frankfurt), Brevo (remitente verificado, SMTP en *Auth → SMTP settings*), plantilla del correo con `{{ .Token }}`, *Allow new users to sign up* = off, crear la clave *fine-grained* (propietario `Polinya-LAB`, `lab-data` y `endurance-data`, *Contents: Read and write*, 1 año), `supabase secrets set GITHUB_TOKEN=…`, `supabase db push`, `supabase functions deploy github admin`, insertar a Daniel como administrador, rellenar `acceso/config.js`.
- [ ] **Step 2:** README y beta de Muestras; `git apply --check` del parche sobre `main`.
- [ ] **Step 3:** ejecutar todas las pruebas: `npx deno@2.9.6 test supabase/functions/` y cada `node tests/e2e/*.test.js` → PASS.
- [ ] **Step 4: Commit** y push a la rama; con el visto bueno de Daniel, a `main` (sin Supabase configurado, las apps funcionan como hoy).
- [ ] **Step 5: Despliegue real con Daniel** (según `DESPLIEGUE.md`): desplegar, probar con 2-3 personas (llegada del código, roles, autor de los commits), `endurance-data` a privado, altas del laboratorio, retirar colaboradores directos. Programar el recordatorio de renovación de la clave (tarea de Claude de un solo uso, 11 meses después).
