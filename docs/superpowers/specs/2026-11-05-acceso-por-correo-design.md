# Acceso a las apps del laboratorio sin cuenta de GitHub

Fecha: 5/11/2026 · Estado: borrador para revisión de Daniel Quesada

## Cambio 5/11: contraseña en lugar de código

Aprobado por Daniel el 5/11. No hay servicio de correo (ni Brevo, ni Gmail, ni el SMTP de Fluidra), así que no se envía
ningún correo y el código de un solo uso desaparece. Donde el resto de este documento habla de código, OTP, SMTP o
plantillas de correo, vale lo siguiente:

- **Entrar:** en las apps y en `acceso/`, un solo paso con correo y contraseña (`LabAuth.entrar`, que usa
  `signInWithPassword` de supabase-js). La sesión se recuerda como antes (refresh token, `storageKey` `lab-auth`).
  Errores: `bad_credentials` ("Correo o contraseña incorrectos" / "Wrong email or password."), `rate`, `unavailable`.
  Las apps leen la contraseña y vacían el campo enseguida, y dicen "¿Has olvidado la contraseña? Pídesela a un
  administrador."
- **Alta** (`acceso/`): la página genera una contraseña aleatoria de 16 letras y números sin ambiguos (sin 0/O/1/l/I) y
  la enseña una sola vez, con botón Copiar; el administrador puede escribir otra (mínimo 12 caracteres).
- **Nueva contraseña** en cada fila de `acceso/`: genera otra, la enseña una vez y la guarda; la anterior deja de valer
  (las sesiones abiertas siguen).
- **Función `admin`:** `POST /admin/usuarios` acepta `password` (obligatoria al crear el usuario de Auth, ≥ 12
  caracteres); `POST /admin/usuarios/<correo>/password` con `{password}` la cambia (400 si es corta, 404 si la persona no
  está dada de alta, 409 si no tiene usuario de Auth). Solo administradores. La contraseña nunca se guarda en `acceso`,
  no se devuelve ni se escribe en el log.
- **Supabase:** proveedor Email activo, registro libre desactivado, *Confirm email* desactivado, longitud mínima 12 y sin
  requisitos de tipos de carácter; sin SMTP ni plantillas. El primer administrador (Daniel) se crea en
  *Authentication → Users* con su propia contraseña (Auto Confirm) y el `INSERT` de la guía.
- **Sin cambios:** roles, permisos, función `github`, clave de GitHub como alternativa, borrado de datos al salir, cambio
  de persona entre pestañas.
- **Fuera de alcance:** que cada persona cambie su propia contraseña desde las apps.

Criterios de éxito 1 y 4, con este cambio: la persona entra con su contraseña; con un correo no dado de alta o una
contraseña equivocada no se obtiene sesión ni datos.

## 1. Objetivo

Cualquier persona del laboratorio entra en las apps de https://polinya-lab.github.io/management-tools/ con su correo, sin
cuenta de GitHub, y ve o modifica según el rol que Daniel le asigne en cada app. Los datos siguen en GitHub y dejan de
ser accesibles directamente: la única puerta es la app con su rol.

Decisiones de Daniel (5/11):

- Identificación con un código de un solo uso que llega por correo.
- Servicio intermedio en Supabase (proyecto nuevo).
- Roles por aplicación.
- La conexión actual con clave de GitHub sigue como alternativa.
- `endurance-data` pasa a privado; `management-tools` y `new-projects` siguen públicos (GitHub Pages).
- Al terminar, solo Daniel y la cuenta del servidor tienen acceso directo a `lab-data` y `endurance-data` en GitHub.

Criterios de éxito:

1. Una persona dada de alta con su correo entra en Control de ensayos con un código y ve los ensayos sin cuenta de GitHub.
2. Con rol "ver" no puede guardar nada: la app se abre en modo consulta y la función rechaza cualquier escritura.
3. Con rol "editar", sus cambios se guardan como commits en GitHub con su nombre como autor.
4. Un correo no dado de alta no recibe código ni obtiene datos.
5. Daniel da de alta, cambia roles y da de baja desde una página de administración.
6. Quien ya usa su clave de GitHub sigue trabajando igual.

Fuera de alcance: inicio de sesión con Microsoft (Entra ID), mover los datos a una base de datos, páginas privadas de
GitHub Pages y la tarea programada de SharePoint (no cambia: escribe en `lab-data` con su propia sesión).

## 2. Arquitectura

```
Navegador (app en GitHub Pages)
  │  1. correo → código de 6 dígitos (Supabase Auth)
  │  2. peticiones "estilo API de GitHub" con la sesión (JWT)
  ▼
Supabase · proyecto "Laboratorio" (región UE)
  ├─ Auth: códigos por correo (SMTP externo), sin registro libre
  ├─ Tabla acceso: correo, nombre, rol por app, administrador
  ├─ Función github: comprueba sesión + rol y reenvía a GitHub
  └─ Función admin: altas, roles y bajas (solo administradores)
  │  3. con la clave del servidor (secreto GITHUB_TOKEN)
  ▼
GitHub · lab-data y endurance-data (privados)
```

Las apps no ven nunca la clave de GitHub del servidor. La clave "anon" y la dirección de Supabase van en el código público,
como prevé Supabase: sin sesión válida y alta en `acceso`, la función no devuelve datos.

## 3. Roles

Cada persona tiene, para cada app, `ninguno`, `ver` o `editar`. Además, `admin` (sí/no) da acceso a la página de
administración.

| Clave de rol | Apps | Puede leer | Puede escribir (con `editar`) |
|---|---|---|---|
| `ensayos` | Control de ensayos, Ocupación | `lab-data/ensayos/ensayos.json`, `lab-data/calibraciones/calibraciones.json` | `ensayos.json`: todo salvo la colección `muestras` y `config/samples` |
| `muestras` | Muestras | `lab-data/ensayos/ensayos.json`, `lab-data/calibraciones/calibraciones.json` | `ensayos.json`: solo la colección `muestras` y `config/samples` |
| `calibraciones` | Plan de calibraciones | `lab-data/calibraciones/calibraciones.json`, `lab-data/calibraciones/certificados.json` | `calibraciones.json` |
| `mantenimiento` | Plan de mantenimiento | `lab-data/mantenimiento/registro.json`, `lab-data/mantenimiento/mantenimiento.json`, `lab-data/calibraciones/calibraciones.json` | `registro.json` |
| `piscina` | Seguimiento piscina durabilidad | `endurance-data/piscina.json` | `piscina.json` |

Reglas:

- Leer un fichero exige `ver` o `editar` en la app que hace la petición, y que el fichero esté en su lista "Puede leer".
- Escribir exige `editar` y que el fichero esté en su lista "Puede escribir".
- `ensayos.json` lo comparten Control de ensayos y Muestras. La función compara el fichero actual con el nuevo y mira qué
  colecciones cambian: `muestras` y `config/samples` exigen `editar` en `muestras`; cualquier otra (`tests`, `personas`,
  `bancos`, `qtps`, el resto de `config`) exige `editar` en `ensayos`. Si falta alguno, rechaza el commit entero.
- La vista *Import ARAS* de la app Muestras escribe ensayos: solo se muestra a quien tiene `editar` en `ensayos`.
- Quien no tiene ningún rol en una app ve en ella el aviso "No tienes acceso a esta app; pídeselo a un administrador".
- El portal (`index.html`) muestra a todos las seis tarjetas; cada app aplica su rol al abrirse.

## 4. Componentes

### 4.1 Tabla `acceso` (Postgres de Supabase)

| Campo | Tipo | Notas |
|---|---|---|
| `email` | text, clave primaria | en minúsculas |
| `user_id` | uuid | usuario de Supabase Auth, se rellena al dar de alta |
| `nombre` | text | aparece como autor de los commits y en la app |
| `roles` | jsonb | `{"ensayos":"editar","muestras":"ver",...}`; una clave ausente vale `ninguno` |
| `admin` | boolean | |
| `creado`, `actualizado` | timestamptz | |

Row Level Security activada sin políticas para clientes: solo las funciones la leen y escriben, con la clave de servicio.

### 4.2 Supabase Auth

- Inicio de sesión con código de un solo uso de 6 dígitos (`signInWithOtp` con `shouldCreateUser:false`, verificación con
  `verifyOtp`). Se usa el código, no el enlace mágico, porque el enlace se abre a menudo en otro navegador.
- Registro libre desactivado (*Allow new users to sign up* = off). Los usuarios los crea la función `admin`.
- Plantilla del correo en castellano con `{{ .Token }}`; validez del código 10 minutos.
- SMTP externo: **Brevo** (plan gratuito, 300 correos al día, remitente verificado sin dominio propio). Alternativa:
  cuenta de Gmail con contraseña de aplicación. El SMTP integrado de Supabase no sirve: solo envía a miembros del proyecto.
- La sesión se renueva sola (refresh token) y dura hasta que la persona sale o un administrador la da de baja.

### 4.3 Función `github` (Edge Function, Deno)

URL: `https://<proyecto>.supabase.co/functions/v1/github/<app>/<ruta de la API de GitHub>`, con
`<app>` ∈ {`ensayos`, `ocupacion`, `muestras`, `calibraciones`, `mantenimiento`, `piscina`} (`ocupacion` usa el rol
`ensayos`).

Imita las rutas de la API de GitHub que las apps ya usan, para que su código cambie lo mínimo:

| Petición | Respuesta |
|---|---|
| `GET /user` | `{login: nombre, name: nombre, email}` de la persona |
| `GET /repos/{owner}/{repo}` | `{full_name, private:true, permissions:{pull, push}}`; `push` = `editar` en la app |
| `GET /repos/{owner}/{repo}/contents/{path}?ref=main` | reenvía a GitHub si el fichero está en "Puede leer"; siempre devuelve `content` (si GitHub no lo trae, por tamaño, la función lo pide como blob y lo rellena); pasa `If-None-Match` y `ETag` para que las consultas sin cambios respondan 304 |
| `PUT /repos/{owner}/{repo}/contents/{path}` | comprueba `editar`, el fichero y (en `ensayos.json`) las colecciones; reenvía con `author` y `committer` = nombre y correo de la persona; devuelve la respuesta de GitHub (incluidos 409/422 de conflicto) |
| Cualquier otra | 403 |

Comprobaciones en cada petición: JWT válido (Supabase), fila en `acceso`, repositorio en `{lab-data, endurance-data}` del
propietario `Polinya-LAB`, rama `main`. CORS solo para `https://polinya-lab.github.io` (y `http://localhost:*` en pruebas).
Errores con el mismo código HTTP que espera la app: 401 sin sesión, 403 sin rol, 404 fichero fuera de su lista.

La lógica de permisos va en un módulo puro (`permisos.ts`: `puedeLeer`, `puedeEscribir`, `coleccionesCambiadas`) separado
del reenvío a GitHub, para probarla sin red.

### 4.4 Función `admin`

Solo para filas con `admin = true`.

- `GET /usuarios`: lista de `acceso`.
- `POST /usuarios` `{email, nombre, roles, admin}`: crea o actualiza; si el usuario de Auth no existe, lo crea con el correo
  ya confirmado.
- `DELETE /usuarios/{email}`: borra la fila y el usuario de Auth (cierra sus sesiones).
- Un administrador no puede quitarse a sí mismo el rol de administrador (evita quedarse sin ninguno).

### 4.5 Módulo común en las apps: `management-tools/acceso/lab-auth.js`

Cargado por las cuatro bases de código (Control de ensayos/Ocupación/Muestras, Calibraciones, Mantenimiento, Piscina),
junto con `supabase-js` en versión fija desde jsDelivr. Expone:

- `LabAuth.sesion()`: sesión actual o `null`.
- `LabAuth.pedirCodigo(email)`, `LabAuth.verificar(email, codigo)`, `LabAuth.salir()`.
- `LabAuth.api(app)`: base de URL de la función para esa app.
- `LabAuth.cabeceras()`: `Authorization: Bearer <JWT>` y `apikey`.

La sesión se guarda en el navegador para el origen `polinya-lab.github.io`: entrar una vez vale para todas las apps del
portal (y para las betas de `new-projects`, que comparten origen).

### 4.6 Cambios en cada app

- **Diálogo de conexión:** primera opción "Entrar con tu correo" (correo → código); debajo, "Usar una clave de GitHub" como
  ahora. El botón de la cabecera muestra el nombre de la persona.
- **Capa de datos:** donde hoy se calcula `API` y se añade `Authorization: Bearer <clave>`, se elige el origen: con sesión de
  correo, `LabAuth.api(app)` y `LabAuth.cabeceras()`; con clave de GitHub, `api.github.com` como ahora. El resto (lectura,
  commits con `sha`, reintentos por conflicto, ETag) no cambia.
- **Consulta periódica:** con sesión de correo, cada 60 s y solo con la pestaña visible (ahora 30 s con clave), para
  quedar dentro de los límites del plan gratuito (§7).
- **Sin sesión:** la lectura anónima de `raw.githubusercontent.com` deja de funcionar en `endurance-data` al pasar a privado; la
  piscina muestra el aviso de entrar, como ya hacen las apps de `lab-data`.
- **Muestras:** oculta *Import ARAS* sin `editar` en `ensayos`.

### 4.7 Página de administración `management-tools/acceso/index.html`

Mismos tokens visuales que las apps. Tras entrar con correo, si la persona es administradora:

- Tabla de personas: nombre, correo, un selector por app (`—`, `Ver`, `Editar`) y casilla de administrador.
- "Añadir persona" (correo y nombre) y "Dar de baja" (con confirmación).
- Cada cambio se guarda al momento con la función `admin` y muestra un aviso.

No administradores: "Esta página es solo para administradores".

## 5. Clave de GitHub del servidor

- Clave *fine-grained* creada por Daniel: propietario `Polinya-LAB`, repositorios `lab-data` y `endurance-data`, permiso
  *Contents: Read and write* (y *Metadata: Read*), caducidad 1 año. Se guarda solo como secreto `GITHUB_TOKEN` de Supabase.
- Los commits los hace la cuenta de Daniel con la persona como autor (`author.name`, `author.email`). El historial muestra
  "Nombre Apellido" y el mensaje de siempre (`Control de ensayos: update PLR… · QTP…`).
- Aviso un mes antes de caducar: una tarea programada de Claude de un solo uso recuerda a Daniel que renueve la clave y
  actualice el secreto.
- Mejora posible más adelante: una GitHub App de la organización en lugar de la clave personal (no caduca ni depende de una
  persona).

## 6. Despliegue y transición

1. Daniel crea el proyecto Supabase "Laboratorio" (región Frankfurt), la cuenta de Brevo y la clave de GitHub del servidor.
2. Despliegue de tabla y funciones: con un token de acceso de Supabase guardado como secreto del entorno de Claude
   (`SUPABASE_ACCESS_TOKEN`), Claude despliega con la CLI; si no, Daniel sigue unos pasos escritos (`acceso/DESPLIEGUE.md`).
3. Daniel queda como primer administrador: una inserción inicial en `acceso` desde el editor SQL de Supabase (o en el
   despliegue, si lo hace Claude).
4. Publicación de las apps con las dos formas de entrar. La clave de GitHub sigue funcionando para todos.
5. Prueba con Daniel y 2 o 3 personas: llegan los códigos (revisar spam de Fluidra), roles `ver` y `editar` en varias apps,
   autor de los commits.
6. `endurance-data` pasa a privado y se comprueba la piscina con sesión de correo.
7. Alta del resto del laboratorio desde la página de administración.
8. Se retiran los colaboradores directos de `lab-data` y `endurance-data`, salvo Daniel. Quien seguía con clave de GitHub
   pasa a entrar con correo.

Vuelta atrás: si Supabase falla o está en pausa, los administradores entran con su clave de GitHub (siguen siendo
colaboradores) y pueden reanudar el proyecto desde el panel de Supabase.

## 7. Límites y riesgos

- **Plan gratuito de Supabase:** 500 000 llamadas a funciones al mes y pausa tras 7 días sin uso. Con consulta cada 60 s solo
  en pestañas visibles, 20 pestañas abiertas 10 h al día en 22 días son unas 264 000 llamadas. Si se supera, plan Pro (25 $/mes)
  o consulta cada 120 s.
- **Límite de GitHub de la clave del servidor:** 5000 peticiones por hora entre todos. Las respuestas 304 (sin cambios) no
  cuentan, así que la función reenvía siempre `If-None-Match`.
- **Correo:** el antispam de Fluidra podría retener los códigos. Se prueba en el paso 5 antes de dar de alta a todos.
- **Datos personales:** Supabase guarda correo y nombre de cada persona en la UE. Si Fluidra exige registrar el tratamiento,
  lo gestiona Daniel con quien corresponda.
- **La clave del servidor puede escribir en los dos repositorios.** Solo vive como secreto en Supabase; quien administre el
  proyecto Supabase tiene ese poder.

## 8. Pruebas

- **Permisos (Deno, sin red):** `puedeLeer`, `puedeEscribir` y `coleccionesCambiadas` para cada app y rol, incluidos los
  casos de `ensayos.json` compartido (solo muestras, solo tests, ambos).
- **Función `github` (Deno, GitHub simulado):** 401 sin sesión, 403 sin rol, 404 fichero ajeno, PUT con autor, paso de ETag y 304,
  relleno de `content` en ficheros grandes.
- **Apps (Playwright, función simulada):** entrar con correo y código, modo consulta con `ver`, guardar con `editar`, Import
  ARAS oculto en Muestras sin `editar` en `ensayos`, la clave de GitHub sigue funcionando, ningún error de consola.
- **Página de administración (Playwright, función simulada):** alta, cambio de rol, baja, administrador sin poder quitarse
  el rol.
- **Prueba real** (paso 5 del despliegue) con cuentas de prueba antes de abrirlo al laboratorio.
