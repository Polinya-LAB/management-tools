# Impresión de etiquetas desde los portátiles en la DYMO del laboratorio

Fecha: 10/11/2026 · Estado: aprobado en conversación por Daniel Quesada (opción C), pendiente de revisión del documento

## Cambios tras la revisión (10/11)

Una revisión independiente del diseño y la verificación del servicio de DYMO cambian estos puntos. Donde el resto del
documento diga otra cosa, vale esto:

- **Una llamada por ciclo.** La estación llama a `POST /impresion/estacion/ciclo` cada 10 s en reposo (latido + pedir
  trabajo en una sola llamada; ~260 000 llamadas/mes aunque el ordenador esté encendido siempre, dentro del plan
  gratuito). Solo pide trabajo si el servicio de DYMO responde y la impresora figura conectada (`GetPrinters`,
  `IsConnected`). Los trabajos viejos se borran como mucho una vez por hora.
- **Progreso por etiqueta.** Tras cada etiqueta la estación manda `POST /impresion/estacion/trabajos/<id>`
  `{hechas}`; al final, `{hechas, fin: "impreso" | "error", error}`. El trabajo guarda `hechas`; "interrumpido" cuenta
  3 minutos desde el último progreso, no desde que se tomó. Reintentar sigue desde `hechas`: no se repiten etiquetas
  ya impresas. Si la estación se reinicia con un trabajo a medias (guardado en disco), lo da por error con lo hecho.
- **Tamaño.** Imagen en blanco y negro puro (PNG de 1 bit generado en el navegador), como mucho 60 KB por etiqueta y
  3 MB por envío.
- **Unidades impresas al confirmarse.** El trabajo lleva las claves de las unidades; el portátil las marca como impresas
  cuando ve el trabajo en `impreso` (al abrir Muestras o mientras el cuadro está abierto). En la interfaz el estado final
  es "Enviado a la impresora": `PrintLabel` confirma que Windows lo ha aceptado, no que haya salido el papel.
- **Un solo dibujo.** La imagen para la DYMO es la misma etiqueta HTML de la vista previa, pasada a canvas (SVG con
  `foreignObject` y las fuentes incrustadas) y a 1 bit. "Imprimir aquí" sigue con el HTML tal cual.
- **Envío idempotente.** El portátil genera el `id` (uuid) del trabajo; si llega dos veces, no se duplica.
- **El rollo** lo sigue fijando una persona con Muestras: editar; la estación comprueba antes de imprimir que el trabajo
  es para el rollo puesto. En modo prueba registra lo que la 550 dice del rollo (`GetConsumableInfoIn550Printer`), por
  si más adelante se puede detectar solo.
- **Clave de la estación:** `POST /impresion/admin/clave` (solo administradores). Reintentar: quien mandó el trabajo o
  un administrador.
- **Servicio de DYMO:** `https://127.0.0.1:41951-41960` (y `localhost`), `GET …/DYMO/DLS/Printing/StatusConnected`,
  `GET …/GetPrinters` (XML), `POST …/PrintLabel` (formulario con `printerName`, `printParamsXml`, `labelXml`,
  `labelSetXml`). Etiqueta en el formato clásico `DieCutLabel` (twips) con un `ImageObject` que ocupa toda la etiqueta.
  El nombre exacto del papel de cada rollo no está documentado: por defecto se usan "11354 Multi-Purpose",
  "99012 Large Address", "99010 Standard Address" y "11352 Return Address Int", y la estación puede tomar papel y medidas
  de una etiqueta guardada desde DYMO Connect (`plantilla-<rollo>.label` junto al exe). Certificado propio de DYMO:
  la estación lo acepta solo para 127.0.0.1 y localhost.
- **Windows:** `instalar.cmd` desbloquea el exe (marca de Internet), crea el acceso directo de Inicio con PowerShell y
  avisa de que borren el `estacion-dymo.json` de Descargas. Los errores no capturados van al registro. `--prueba`
  imprime una etiqueta de prueba y deja en el registro impresoras y rollo.

## Objetivo

Cada persona imprime las etiquetas de Muestras desde su portátil en la DYMO LabelWriter 550 conectada al ordenador fijo
del laboratorio, sin ir a ese ordenador. En el ordenador fijo corre un programa pequeño ("estación") que recoge los
trabajos y los imprime solo.

Decidido por Daniel:

- Opción C: programa propio en el ordenador fijo, independiente del navegador. Hace de enlace con el servicio local de
  DYMO Connect ("DYMO Connect Web Service").
- Ordenador fijo: Windows 10/11 con la sesión iniciada en horario de laboratorio. El programa arranca al iniciar sesión.
- Imprime en cuanto llega el trabajo, sin confirmación en el ordenador fijo.
- El formato del rollo lo decide la estación (rollo puesto); el portátil elige unidades y contenido.
- Se mantiene "Imprimir aquí" (cuadro de impresión del navegador) como alternativa.
- Pueden mandar trabajos quienes tengan Muestras: editar.
- Despliegue en Supabase autorizado (Claude lo hace).

Fuera de alcance: varias estaciones o impresoras, imprimir otras cosas que no sean etiquetas de Muestras, cola en
GitHub, instalar la estación como servicio de Windows (sin sesión iniciada).

## Piezas

```
Portátil (Muestras) ──POST trabajo──▶ Función `impresion` ──▶ tablas en Supabase
                                          ▲
Estación (.exe, ordenador fijo) ──latido / siguiente / resultado──┘
        │
        └──▶ DYMO Connect Web Service (https://127.0.0.1:41951) ──▶ LabelWriter 550
```

1. **Tablas** (migración nueva, solo accesibles con la clave de servicio, RLS sin políticas):
   - `impresion_estacion`: una fila (`id = 'lab'`) con `token_hash` (SHA-256 de la clave de la estación), `rollo`
     (`'11354'` por defecto; claves de `SMP_LABELS`), `visto` (último latido), `estado` (jsonb: servicio DYMO
     disponible, nombre de la impresora, último error), `actualizado`.
   - `impresion_trabajo`: `id` uuid, `creado`, `por` (correo), `nombre`, `rollo`, `etiquetas` (jsonb: lista de
     `{codigo, png}` con el PNG en base64), `n`, `estado` (`pendiente` | `imprimiendo` | `impreso` | `error`), `error`,
     `actualizado`. Los trabajos de más de 30 días se borran en cada latido.

2. **Función `impresion`** (Edge Function, `verify_jwt = false`, mismo patrón que `admin` y `github`: `handler.ts` con
   dependencias inyectadas y probado con Deno; `index.ts` con las reales). Rutas:
   - Portátil (JWT de Supabase; Muestras: editar; si no, 403):
     - `GET /impresion/estado` → estación (`conectada` si hubo latido en los últimos 30 s, `visto`, `rollo`, estado de
       DYMO) y los últimos 10 trabajos de quien llama, sin los PNG.
     - `POST /impresion/trabajos` `{rollo, etiquetas:[{codigo,png}]}` → 1–100 etiquetas, PNG válido (cabecera PNG) de
       como mucho 200 KB cada una. Si `rollo` no es el de la estación: 409 `roll_changed` (el portátil vuelve a leer el
       estado y redibuja). Devuelve el trabajo creado.
     - `PUT /impresion/rollo` `{rollo}` → cambia el rollo puesto (clave conocida).
     - `POST /impresion/trabajos/<id>/reintentar` → un trabajo en `error` vuelve a `pendiente`.
   - Estación (cabecera `x-estacion` con la clave; se compara su SHA-256 con `token_hash`; si no, 401):
     - `POST /impresion/estacion/latido` `{dymo:{ok, impresora, error}}` → guarda `visto` y `estado`; devuelve `rollo`.
     - `POST /impresion/estacion/siguiente` → toma el trabajo `pendiente` más antiguo, lo pasa a `imprimiendo` de forma
       atómica (`update … where estado = 'pendiente'`) y lo devuelve completo; `204` si no hay ninguno.
     - `POST /impresion/estacion/trabajos/<id>` `{ok, error}` → `impreso` o `error`.
     - Un trabajo que lleva más de 3 minutos en `imprimiendo` pasa a `error` ("interrumpido") en el siguiente latido:
       así no se imprime dos veces y quien lo mandó puede reintentarlo.
   - Administración (JWT; solo administradores): `POST /impresion/estacion/clave` → genera una clave aleatoria de 32
     bytes, guarda su hash (la anterior deja de valer) y devuelve la clave una sola vez.
   - Errores con `{message, code, args?}` como la función `admin`.

3. **Estación** (`estacion-dymo/` en management-tools): programa en TypeScript para Deno, compilado a un único
   `estacion-dymo.exe` para Windows sin ventana de consola. Bucle:
   - Cada 3 s: latido (comprueba el servicio de DYMO cada 30 s, o tras un fallo) y `siguiente`.
   - Por cada etiqueta del trabajo: arma el XML de etiqueta DYMO con la imagen PNG ocupando toda la etiqueta y el papel
     del rollo, y la manda a `PrintLabel` del servicio local. Si una falla, el trabajo queda en `error` con el motivo y
     las demás no se imprimen.
   - Sin servicio de DYMO no pide trabajos: siguen en la cola.
   - Configuración en `estacion-dymo.json` junto al exe: `url` de la función, `clave` de la estación y, opcional,
     `impresora` (si no, la primera LabelWriter conectada).
   - Registro en `estacion-dymo.log` junto al exe (se recorta a ~1 MB). Una sola instancia (bloqueo por puerto local).
   - Instalación: `instalar.cmd` copia el exe y la configuración a `%LOCALAPPDATA%\EstacionDymo`, crea el acceso directo
     en la carpeta Inicio de Windows y lo arranca. `desinstalar.cmd` lo quita.
   - Distribución: un workflow de GitHub Actions compila el exe y lo publica en una release de management-tools
     (`estacion-dymo.zip` con exe, `instalar.cmd`, `desinstalar.cmd` y `LEEME.txt`). El exe no lleva secretos.

4. **Portátil (Muestras, cuadro de etiquetas)**:
   - Destino: **Impresora del laboratorio** (por defecto) o **Imprimir aquí**. Se recuerda en el navegador.
   - Con la impresora del laboratorio: el formato es el rollo puesto (se muestra, con "Cambiar rollo puesto"), sin
     opción de giro; estado de la estación (conectada / sin señal desde…); botón **Enviar a la impresora del
     laboratorio**. Sin señal de la estación se puede enviar igual ("se imprimirán cuando vuelva").
   - Las etiquetas se dibujan en un `<canvas>` a 300 ppp (la resolución de la 550) con el mismo diseño que la vista
     previa, y la vista previa muestra esas imágenes: lo que se ve es lo que se imprime.
   - Al enviarse, las unidades quedan marcadas como impresas, igual que hoy tras el cuadro de impresión.
   - "Últimos envíos": estado de los trabajos propios y "Reintentar" en los que fallaron. Mientras el cuadro está
     abierto se actualiza cada 5 s.
   - Español e inglés, como el resto de la app.

5. **Página de accesos**: sección "Impresora del laboratorio" con **Generar clave de la estación**, que descarga
   `estacion-dymo.json` ya rellenado (url y clave). Avisa de que la clave anterior deja de valer.

## Seguridad

- La clave de la estación solo permite tomar trabajos de impresión y dar el resultado; no da acceso a datos del
  laboratorio ni a GitHub. Se guarda solo su hash.
- La estación habla con DYMO solo en 127.0.0.1 y acepta el certificado autofirmado únicamente para esa dirección.
- Las tablas no son accesibles con la clave pública (RLS sin políticas); todo pasa por la función.
- Ningún secreto en el repositorio ni en el exe.

## Pruebas

- Deno: `handler.ts` de la función (permisos, validación, reparto atómico, interrumpidos, clave) y la lógica de la
  estación contra un servicio DYMO simulado y una función simulada (XML generado, errores, sin servicio).
- e2e (Playwright): cuadro de etiquetas con la impresora del laboratorio (envío, rollo cambiado, reintentar, estado sin
  señal), sobre el simulador de `tests/e2e/lab-mock.js` ampliado con la función `impresion`.
- No se puede probar aquí con la impresora real: la primera prueba en el laboratorio la hace Daniel con una etiqueta.

## Pasos que hará Daniel

1. En el ordenador fijo, comprobar que DYMO Connect está instalado y su servicio responde.
2. En la página de accesos, **Generar clave de la estación** (descarga `estacion-dymo.json`).
3. Descargar `estacion-dymo.zip`, descomprimirlo junto al json y ejecutar `instalar.cmd`.
4. Enviar una etiqueta de prueba desde un portátil.
