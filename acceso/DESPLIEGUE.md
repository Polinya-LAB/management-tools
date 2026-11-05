# Despliegue del acceso por correo

Guía para poner en marcha el acceso por correo y los roles por app. Diseño completo en
[`docs/superpowers/specs/2026-11-05-acceso-por-correo-design.md`](../docs/superpowers/specs/2026-11-05-acceso-por-correo-design.md).

Mientras `acceso/config.js` esté vacío, las apps funcionan como hasta ahora, con la clave de GitHub. Puedes publicar el
código antes de desplegar nada.

Los nombres de menús de Supabase, Brevo y GitHub pueden diferir algo de los de esta guía; busca el ajuste por su nombre.

Necesitas: una cuenta de Supabase, una de Brevo, permisos de administrador en la organización
[Polinya-LAB](https://github.com/Polinya-LAB) y Node.js 18 o superior (para `npx`). Ejecuta los comandos desde la raíz de
este repositorio.

## 1. Proyecto de Supabase

1. En [supabase.com/dashboard](https://supabase.com/dashboard) crea un proyecto: nombre **Laboratorio**, región
   **Central EU (Frankfurt)**, plan gratuito. Guarda la contraseña de la base de datos en tu gestor de contraseñas.
2. Anota el **Project ref** (la parte `xxxx` de `https://xxxx.supabase.co`), la **URL del proyecto** y la clave
   **anon public** (*Project Settings → API*).

## 2. Correo de salida con Brevo

Supabase limita mucho los correos de su servicio por defecto. Usa SMTP propio:

1. En [brevo.com](https://www.brevo.com) crea una cuenta y, en *Senders, domains & dedicated IPs*, añade un remitente
   (por ejemplo `laboratorio@…`) y **verifícalo** con el enlace que llega a su buzón. Si el dominio es de Fluidra,
   pide a IT que autentique el dominio (SPF y DKIM) para que los códigos no caigan en spam.
2. En *SMTP & API → SMTP* copia el servidor (`smtp-relay.brevo.com`), el puerto (`587`), el usuario y crea una clave SMTP.
3. En Supabase: *Authentication → Emails → SMTP Settings* (en algunas versiones, *Project Settings → Authentication*).
   Activa **Enable custom SMTP** y rellena remitente (el verificado), nombre (`Laboratorio Polinyà`), servidor, puerto,
   usuario y clave SMTP.

## 3. Ajustes de Auth y plantilla del correo

En *Authentication*:

- **Sign In / Providers → Email**: activo. **Allow new users to sign up** = **desactivado** (solo entran las personas que
  el administrador da de alta).
- **OTP length** = `6` y **OTP expiry** = `600` segundos (los mismos valores de `supabase/config.toml`).
- **Emails → Templates → Magic Link**: pon este asunto y cuerpo (el código va en `{{ .Token }}`; no pongas enlace):

  Asunto: `Tu código de acceso al laboratorio`

  ```html
  <p>Tu código para entrar a las apps del laboratorio es:</p>
  <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
  <p>Caduca en 10 minutos. Si no lo has pedido tú, ignora este correo.</p>
  ```


## 4. Clave de GitHub del servidor

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

## 5. Tabla y funciones (CLI de Supabase)

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

## 6. Primer administrador

Con el registro desactivado, Supabase no envía código a un correo que no existe en Auth, y la página de administración (que
crea los usuarios de Auth) exige haber entrado antes. Por eso el primer administrador se crea a mano, en dos pasos:

1. En Supabase, *Authentication → Users → Add user → Create new user*: tu correo **en minúsculas**, una contraseña
   cualquiera (no se usará) y **Auto Confirm User** marcado.
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

## 7. Configurar las apps

1. Rellena `acceso/config.js` con la URL y la clave anónima (es pública por diseño; ningún secreto va en el repositorio):

   ```js
   window.LAB_SUPABASE={url:'https://xxxx.supabase.co',anonKey:'eyJ...'};
   ```

2. **Muestras es una app instalable con service worker**, y guarda `config.js` en su caché. Sube la versión de
   `muestras/sw.js` para que las copias instaladas recojan la configuración: cambia `CACHE` (por ejemplo
   `muestras-v20261107`) y el `?v=` de `SHELL`. El valor nuevo de `?v=` debe ser **el mismo** en `muestras/sw.js` (`CACHE` y
   `SHELL`) y en todos los `index.html` que cargan `lab-auth.js`, `app.js` o `app.css` (los de management-tools y, si se
   quiere mantener la beta, `new-projects/muestras/index.html` y su `sw.js`).
3. Haz commit y push a `main`. GitHub Pages publica en uno o dos minutos.
4. Comprueba que `https://polinya-lab.github.io/management-tools/acceso/config.js` devuelve la configuración nueva y que
   Control de ensayos ofrece **Entrar con correo**.

## 8. Prueba con 2 o 3 personas

Antes de abrirlo a todo el laboratorio:

1. Abre `https://polinya-lab.github.io/management-tools/acceso/` con tu cuenta y da de alta a 2 o 3 personas con roles
   distintos (una con `ver`, otra con `editar` en varias apps).
2. Cada persona pide el código en una app. Comprueba que **el correo llega** (y mira la carpeta de spam de Fluidra; si lo
   retiene, pide a IT que permita el remitente de Brevo).
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
uso de Claude). Para renovarla: crea otra clave con los mismos permisos (paso 4), ejecuta
`npx supabase@2 secrets set GITHUB_TOKEN=github_pat_nuevo` y borra la antigua en GitHub. No hace falta redesplegar las
funciones.

## Mantenimiento

- **Pausa del plan gratuito:** si el proyecto lleva 7 días sin uso, reanúdalo desde el panel.
- **Límites:** 500 000 llamadas al mes a funciones; el límite de GitHub es de 5000 peticiones por hora entre todos.
- **Quién puede escribir con la clave del servidor:** cualquiera con acceso administrador al proyecto de Supabase. Limita
  ese acceso.
- **Pruebas** (antes de cambiar código): `npx deno@2.9.6 test supabase/functions/` y `node tests/e2e/<fichero>.test.js`
  (ver [`tests/README.md`](../tests/README.md)).
