# Despliegue del acceso por correo

Guía para poner en marcha el acceso por correo y los roles por app. Diseño completo en
[`docs/superpowers/specs/2026-11-05-acceso-por-correo-design.md`](../docs/superpowers/specs/2026-11-05-acceso-por-correo-design.md).

Mientras `acceso/config.js` esté vacío, las apps funcionan como hasta ahora, con la clave de GitHub. Puedes publicar el
código antes de desplegar nada.

Cada persona entra con su correo y una **contraseña que le asigna un administrador** desde la página de administración.
No se envía ningún correo: no hace falta servicio de correo, SMTP ni plantillas.

Los nombres de menús de Supabase y GitHub pueden diferir algo de los de esta guía; busca el ajuste por su nombre.

Necesitas: una cuenta de Supabase, permisos de administrador en la organización
[Polinya-LAB](https://github.com/Polinya-LAB) y Node.js 18 o superior (para `npx`). Ejecuta los comandos desde la raíz de
este repositorio.

## 1. Proyecto de Supabase

1. En [supabase.com/dashboard](https://supabase.com/dashboard) crea un proyecto: nombre **Laboratorio**, región
   **Central EU (Frankfurt)**, plan gratuito. Guarda la contraseña de la base de datos en tu gestor de contraseñas.
2. Anota el **Project ref** (la parte `xxxx` de `https://xxxx.supabase.co`), la **URL del proyecto** y la clave
   **anon public** (*Project Settings → API*).

## 2. Ajustes de Auth

En *Authentication* (los mismos valores que `supabase/config.toml`):

- **Sign In / Providers → Email**: activo. **Allow new users to sign up** = **desactivado** (solo entran las personas que
  el administrador da de alta). **Confirm email** = **desactivado** (no se envía ningún correo; los usuarios se crean ya
  confirmados).
- **Sign In / Providers → Email → Minimum password length** (en algunas versiones, *Authentication → Policies* o
  *Password security*): `12`. **Password requirements**: **ninguno** (*No required characters*). Si exiges tipos de
  carácter, las altas fallan con `weak_password`: las contraseñas generadas llevan letras y números, sin símbolos.
- No configures SMTP ni plantillas de correo.

## 3. Clave de GitHub del servidor

La función `github` escribe en los repositorios con una clave propia, que vive solo como secreto en Supabase.

1. En [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
   crea una clave **fine-grained**:
   - Nombre: `Laboratorio Supabase`.
   - **Resource owner:** `Polinya-LAB`.
   - **Expiration:** 1 año.
   - **Repository access:** *Only select repositories* → `lab-data` y `endurance-data`.
   - **Permissions → Repository → Contents:** *Read and write*.
2. Copia la clave (`github_pat_…`). Si la organización exige aprobar las claves, apruébala en
   *Organization → Settings → Personal access tokens*.
3. **Anota la fecha de caducidad** y programa un recordatorio 11 meses después (ver [Renovar la clave](#renovar-la-clave-del-servidor)).

## 4. Tabla y funciones (CLI de Supabase)

```sh
npx supabase@2 login
npx supabase@2 link --project-ref <PROJECT_REF>
npx supabase@2 secrets set GITHUB_TOKEN=github_pat_xxxxxxxx
npx supabase@2 db push
npx supabase@2 functions deploy github
npx supabase@2 functions deploy admin
```

- `login` abre el navegador para autorizar la CLI. `link` pide la contraseña de la base de datos.
- `db push` aplica `supabase/migrations/20261105000000_acceso.sql` (tabla `acceso`, con RLS y sin políticas: solo las
  funciones la leen, con la clave de servicio).
- Las dos funciones usan `verify_jwt = false` (`supabase/config.toml`) porque validan ellas mismas la sesión con
  `auth.getUser`. No añadas `--no-verify-jwt` ni lo quites: la CLI lee el ajuste del `config.toml`.

Comprobaciones tras el despliegue:

- Si `functions deploy` no da error, `supabase/config.toml` se lee bien. Para comprobarlo sin desplegar, ejecuta
  `npx supabase@2 db lint` (necesita Docker) o `npx supabase@2 start`.
- En *Edge Functions → github → Logs*, la primera petición real debe llegar con ruta que empieza por `/github/`
  (por ejemplo `/github/ensayos/...`) y la de `admin` por `/admin/`. El código separa las rutas por ese primer segmento; si
  Supabase entregara otro prefijo, las respuestas serían 404 y habría que ajustar `handler.ts`.
- En *Edge Functions → Secrets* aparece `GITHUB_TOKEN`.

## 5. Primer administrador

Con el registro desactivado, nadie puede crearse una cuenta, y la página de administración (que crea las demás) exige
haber entrado antes. Por eso el primer administrador se crea a mano, en dos pasos:

1. En Supabase, *Authentication → Users → Add user → Create new user*: tu correo **en minúsculas**, **tu propia
   contraseña** (12 caracteres o más; mejor larga y generada con un gestor de contraseñas, y guárdala en él) y
   **Auto Confirm User** marcado. Con esa contraseña entrarás en las apps y en la página de administración.
2. En *SQL Editor* ejecuta la alta, que toma el `user_id` de ese usuario:

```sql
insert into public.acceso (email, user_id, nombre, roles, admin)
values (
  'tu.correo@fluidra.com',
  (select id from auth.users where email = 'tu.correo@fluidra.com'),
  'Tu nombre',
  '{"ensayos":"editar","muestras":"editar","calibraciones":"editar","mantenimiento":"editar","piscina":"editar"}',
  true
);
```

Si `user_id` queda vacío (el usuario no existía), la baja posterior dejaría un usuario huérfano en Auth: comprueba con
`select email, user_id from public.acceso;`. La tabla rechaza correos con mayúsculas. Desde aquí, el resto de altas se hacen
en la página de administración, que crea el usuario de Auth y la fila a la vez.

## 6. Contraseñas: altas y "Nueva contraseña"

En `https://polinya-lab.github.io/management-tools/acceso/`:

- **Añadir persona:** el campo *Contraseña* ya trae una generada (16 letras y números, sin los que se confunden: 0, O, 1,
  l, I). Puedes escribir otra en su lugar (mínimo 12 caracteres). Al guardar, la página la enseña **una sola vez**, con
  el botón *Copiar*: dásela a la persona en mano o por un canal privado (Teams, por ejemplo). No se guarda en ningún
  sitio más: ni en la tabla `acceso` ni en la página; Supabase solo guarda su huella.
- **Nueva contraseña** (en cada fila, también en la tuya): genera otra, la enseña una vez y la guarda. La anterior deja de
  valer para entrar; las sesiones ya abiertas siguen hasta que caducan o la persona sale.
- **Si alguien olvida la contraseña**, las apps le dicen que la pida a un administrador: usa *Nueva contraseña*.
- Nadie puede cambiar su propia contraseña desde las apps. *Nueva contraseña* siempre genera una; una contraseña escrita
  a mano solo se puede poner al dar de alta.

## 7. Configurar las apps

1. Rellena `acceso/config.js` con la URL y la clave anónima (es pública por diseño; ningún secreto va en el repositorio):

   ```js
   window.LAB_SUPABASE={url:'https://xxxx.supabase.co',anonKey:'eyJ...'};
   ```

2. **Muestras es una app instalable con service worker**, y guarda `config.js` en su caché. Sube la versión de
   `muestras/sw.js` para que las copias instaladas recojan la configuración: cambia `CACHE` (por ejemplo
   `muestras-v20261109`, si la actual es `muestras-v20261108`) y el `?v=` de `SHELL`. El valor nuevo de `?v=` debe ser **el mismo** en `muestras/sw.js` (`CACHE` y
   `SHELL`) y en todos los `index.html` que cargan `lab-auth.js`, `app.js` o `app.css` (los de management-tools y, si se
   quiere mantener la beta, `new-projects/muestras/index.html` y su `sw.js`). Antes de subir el `?v=` de la beta, comprueba
   que `new-projects/muestras/sw.js` tiene la misma exclusión que `muestras/sw.js`: no atiende peticiones a
   `github.com`, `githubusercontent.com` ni `*.supabase.co`, ni ninguna con cabecera `Authorization`. Si guardara en caché
   las respuestas de la función, los datos privados quedarían en disco tras salir y otra persona en el mismo navegador
   vería los de la anterior.
3. Haz commit y push a `main`. GitHub Pages publica en uno o dos minutos.
4. Comprueba que `https://polinya-lab.github.io/management-tools/acceso/config.js` devuelve la configuración nueva y que
   Control de ensayos ofrece **Sign in with your email** (correo y contraseña).

## 8. Prueba con 2 o 3 personas

Antes de abrirlo a todo el laboratorio:

1. Abre `https://polinya-lab.github.io/management-tools/acceso/` con tu cuenta y da de alta a 2 o 3 personas con roles
   distintos (una con `ver`, otra con `editar` en varias apps).
2. Dale a cada persona su contraseña (la que enseña la página al darla de alta) y que entre en una app con su correo y esa
   contraseña. Prueba también una contraseña equivocada (aviso "Wrong email or password." / "Correo o contraseña
   incorrectos.") y *Nueva contraseña*: la anterior deja de valer.
3. Con `ver`: la app abre en modo consulta y no deja guardar. Con `editar`: guarda. Sin rol en esa app: aviso
   "No tienes acceso a esta app".
4. Haz un cambio con `editar` y mira el historial de commits en GitHub: el autor y el *committer* son la persona (nombre y
   correo del alta), aunque el commit lo envíe la clave del servidor.
5. Prueba también la piscina con una sesión de correo y rol `piscina`, con `endurance-data` todavía público.
6. Comprueba que la clave de GitHub sigue funcionando para quien ya la usa.

## 9. Cierre del acceso por GitHub

Cuando la prueba sale bien:

1. **`endurance-data` a privado:** en GitHub, *Settings → General → Danger Zone → Change visibility → Make private*.
   Comprueba la piscina con una sesión de correo.
2. **Altas del resto del laboratorio** desde `acceso/` (correo en minúsculas, nombre y un rol por app).
3. **Retira los colaboradores directos** de `lab-data` y `endurance-data`, salvo Daniel (*Settings → Collaborators and
   teams*). Quien seguía con clave de GitHub pasa a entrar con correo.

## Vuelta atrás

Si Supabase falla o está en pausa (el plan gratuito pausa tras 7 días sin uso), los administradores entran con su clave de
GitHub, porque siguen siendo colaboradores, y reanudan el proyecto desde el panel de Supabase. Quien no es colaborador
espera a que vuelva el servicio.

## Renovar la clave del servidor

La clave de GitHub caduca al año. Programa el recordatorio **11 meses después de crearla** (por ejemplo, una tarea de un solo
uso de Claude). Para renovarla: crea otra clave con los mismos permisos (paso 3), ejecuta
`npx supabase@2 secrets set GITHUB_TOKEN=github_pat_nuevo` y borra la antigua en GitHub. No hace falta redesplegar las
funciones.

## Mantenimiento

- **Pausa del plan gratuito:** si el proyecto lleva 7 días sin uso, reanúdalo desde el panel.
- **Límites:** 500 000 llamadas al mes a funciones; el límite de GitHub es de 5000 peticiones por hora entre todos.
- **Quién puede escribir con la clave del servidor:** cualquiera con acceso administrador al proyecto de Supabase. Limita
  ese acceso.
- **Pruebas** (antes de cambiar código): `npx deno@2.9.6 test supabase/functions/` y `node tests/e2e/<fichero>.test.js`
  (ver [`tests/README.md`](../tests/README.md)).
