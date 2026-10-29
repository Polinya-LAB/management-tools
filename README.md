# Laboratorio Polinyà

Aplicaciones del laboratorio. Portada: https://polinya-lab.github.io/management-tools/

Repositorio de la organización [Polinya-LAB](https://github.com/Polinya-LAB) en GitHub.

## Dónde están los datos y quién puede modificarlos

El código y los datos están en repositorios distintos: cada persona modifica lo que le corresponde.

| Repositorio | Contenido | Visibilidad | Quién tiene acceso |
|---|---|---|---|
| [management-tools](https://github.com/Polinya-LAB/management-tools) (este) | Código de las apps y la web | Público | Solo administradores |
| [endurance-data](https://github.com/Polinya-LAB/endurance-data) | Datos de la piscina de durabilidad | Público | **Write** para quien registra bombas |
| [lab-data](https://github.com/Polinya-LAB/lab-data) | Datos privados del laboratorio: `ensayos/` (Control de ensayos), `calibraciones/` (Plan de calibraciones) y `mantenimiento/` (Plan de mantenimiento) | Privado | **Read** para consultar, **Write** para modificar |

Para dar acceso a una persona: en el repositorio de datos que toque, **Settings → Collaborators and teams → Add people**,
elige el rol y la persona acepta la invitación que recibe por correo. Para quitárselo, elimínala de la misma lista.

**Clave de acceso (una por persona y navegador).** Se crea en
[github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=Laboratorio%20Polinya)
y la pegas en la app con **Conectar con GitHub** / **Connect GitHub**. Sirve para todas las apps.
- Para usar solo la piscina basta el permiso `public_repo`.
- Control de ensayos y el Plan de calibraciones necesitan `repo`, porque sus datos son privados (el enlace anterior lo marca).

El navegador guarda la clave y **Desconectar** la borra. Si caduca, la app avisa y basta con crear otra.

## Control de ensayos

Aplicación para gestionar los ensayos del laboratorio: cola, tablero por estado, planificación por recurso
(con opción de ocultar los equipos sin ensayos en el periodo), historial, biblioteca de procedimientos QTP con duraciones y perfiles de carga, e importación de las solicitudes exportadas de ARAS.
La carga y ocupación diaria de técnicos y equipos están en su propia aplicación, [Ocupación](#ocupación-de-equipos-y-técnicos).
La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/control-ensayos/

- Es una página ([`control-ensayos/index.html`](control-ensayos/index.html)) con su código en `app.js` y `app.css`, que comparte con Ocupación.
- Los datos están en [`ensayos/ensayos.json`](https://github.com/Polinya-LAB/lab-data/blob/main/ensayos/ensayos.json) del repositorio privado `lab-data`: ensayos (`tests`), personas (`personas`),
  equipos (`bancos`), procedimientos (`qtps`), muestras (`muestras`, de la app [Muestras](#muestras)) y ajustes (`config`).
- Los datos son privados: para consultarla, **Connect GitHub** con una cuenta con acceso de lectura a `lab-data`;
  para modificar, con acceso de escritura.
- La app junta en un solo commit los cambios hechos en poco tiempo (por ejemplo una importación de ARAS). El
  [historial](https://github.com/Polinya-LAB/lab-data/commits/main/ensayos/ensayos.json) muestra quién cambió qué y cuándo.
- Para importar de ARAS: exporta la búsqueda `a_Lab_Dashboard` a Excel y cárgala en la pestaña **Import ARAS**. Las líneas nuevas
  y los datos de solicitud entran al cargar el fichero (la primera vez, o si aparece un equipo desconocido, los confirmas a mano).
  Si un ensayo existente tiene otro estado en ARAS, la app pregunta cuál quedarse; si mantienes el de la app, no vuelve a
  preguntar hasta que ARAS cambie (`tests/<id>.arasStatusKept`). Planned cuenta como In Queue, y Endurance running, On hold y
  Report como In Progress. En el nombre ARAS de un equipo puedes poner varios nombres separados por `;`.
- A cada equipo y a cada QTP le puedes asignar los instrumentos (FLE) del Plan de calibraciones que usa
  (pestañas **Equipment & team** y **QTP library**, al editar). La app los guarda en `bancos/<id>.instrumentos` y `qtps/<id>.instrumentos` como lista de ids de
  `calibraciones/calibraciones.json` → `equipment` (por ejemplo `eq-FLE-014`). Guarda ids en lugar de códigos porque hay códigos FLE repetidos.

## Muestras

Identificación de las muestras del laboratorio: cada PLR de ARAS recibe sus códigos `FLS-xxxxx` correlativos, con un sufijo
`-1, -2…` por unidad física, y la app imprime sus etiquetas en la DYMO LabelWriter 550. La interfaz está en castellano, con botón ES / EN.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/muestras/

- Usa los datos de Control de ensayos (`ensayos/ensayos.json` en `lab-data`, colección `muestras`) y su mismo código
  ([`control-ensayos/app.js`](control-ensayos/app.js)); [`muestras/index.html`](muestras/index.html) elige las vistas *Muestras* e *Import ARAS*.
- **Códigos por validar:** la app propone los códigos de cada PLR activo con piezas pedidas en ARAS que aún no tienen código:
  un FLS para el PLR si sus líneas QTP comparten las piezas, o uno por línea si piden piezas distintas. Al validar, la app asigna
  los números (contador en `config/samples`, sin reutilizar números) y las unidades quedan *Pendiente de recibir*. **Descartar**
  aparta un PLR que no lleva muestra; el botón **Generar códigos** de cada PLR vuelve a proponer los que falten.
- Al llegar la muestra, **Marcar recibidas** pasa sus unidades a *Recibida* con la fecha del día. **+ Recibir muestras** registra
  a mano una muestra que no viene de ARAS.
- **Etiquetas DYMO:** tamaños 99012, 99010, 11354 y 11352, con QR que abre la muestra en la app, código de barras Code 128 o sin código.
  Se imprimen desde el navegador, sin instalar nada.
- Se puede instalar en el PC desde Chrome o Edge (**Instalar app**) y se abre sin conexión; los datos los sigue leyendo de GitHub.
- Control de ensayos muestra en el tablero el chip *📦 Muestras x/y* de cada PLR y, en la ficha de un ensayo, sus muestras.
- Como Control de ensayos, hace falta **Connect GitHub** con acceso de lectura a `lab-data` para consultarla y de escritura para modificarla.

## Ocupación de equipos y técnicos

Carga de técnicos y equipos a partir de los ensayos de Control de ensayos: resumen con la carga semanal de las
próximas 8 semanas, planificación por recurso, ocupación diaria y alertas de equipos por encima de su capacidad
o técnicos sobrecargados. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/ocupacion/

- Usa los mismos datos que Control de ensayos (`ensayos/ensayos.json` en `lab-data`) y el mismo código
  ([`control-ensayos/app.js`](control-ensayos/app.js)); [`ocupacion/index.html`](ocupacion/index.html) elige qué vistas mostrar.
- Los ensayos los creas e importas en Control de ensayos. Aquí los abres y cambias (técnico, equipo, fechas),
  y la app guarda cada cambio como commit con el prefijo «Ocupación».
- Los datos son privados: hace falta **Connect GitHub** con una cuenta con acceso a `lab-data`. GitHub da acceso
  al repositorio entero, así que quien abre Control de ensayos puede abrir esta aplicación.

## Plan de calibraciones

Plan de calibración de los equipos del laboratorio (formulario F-IM-FM-001): equipos con sus puntos y tolerancias,
plan anual, registro y cierre de calibraciones, evaluación de la tolerancia de uso (|e| + U ≤ TU), hojas de validación
por cámara frente a las normas de ensayo (ISO 9227, IEC 60068), imprimibles en PDF, revisión de datos e
importación del Excel del plan. El mantenimiento está en su propia aplicación, [Plan de mantenimiento](#plan-de-mantenimiento). La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/calibraciones/

- Es una página ([`calibraciones/index.html`](calibraciones/index.html)) que guarda como Control de ensayos.
- Los datos están en [`calibraciones/calibraciones.json`](https://github.com/Polinya-LAB/lab-data/blob/main/calibraciones/calibraciones.json) del repositorio privado `lab-data`:
  equipos (`equipment`), calibraciones (`calibrations`), evaluaciones TU (`evaluations`) y ajustes (`config`). La colección `maintenance` sigue en el fichero, sin uso.
- Para consultarla, **Connect GitHub** con una cuenta con acceso de lectura a `lab-data`; para modificar, con acceso de escritura.
  La clave es la de las otras apps.
- Cada cambio es un commit; el [historial](https://github.com/Polinya-LAB/lab-data/commits/main/calibraciones/calibraciones.json) muestra quién cambió qué y cuándo.

## Plan de mantenimiento

Plan de mantenimiento de equipos e instalaciones del laboratorio (formulario F-IM-FM-002), separado del Plan de calibraciones:
resumen con lo vencido y lo próximo agrupado por proveedor, plan con filtros, plan anual por meses, acciones correctivas,
ofertas y partes de trabajo, y revisión de fechas. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/mantenimiento/

- Es una página ([`mantenimiento/index.html`](mantenimiento/index.html)) que guarda como el Plan de calibraciones.
- El plan sale del Excel `Maintenance Plan.xlsx` de SharePoint (07. Laboratory › 4. Equipment › 1. Maintenance). Una tarea
  programada lo copia, junto con los PDF de ofertas, partes y correctivas (resumen y enlace), a
  [`mantenimiento/mantenimiento.json`](https://github.com/Polinya-LAB/lab-data/blob/main/mantenimiento/mantenimiento.json) los días 1 y 15
  ([instrucciones](https://github.com/Polinya-LAB/lab-data/blob/main/sharepoint-sync.md)). La app lee ese fichero sin escribirlo:
  los equipos, acciones y periodos los cambias en el Excel.
- Lo que registras en la app (mantenimientos programados y realizados, ajustes) va a
  [`mantenimiento/registro.json`](https://github.com/Polinya-LAB/lab-data/blob/main/mantenimiento/registro.json) (`records`, `config`),
  que crea el primer guardado. Un mantenimiento registrado como hecho después de la fecha del Excel mueve la próxima fecha (fecha + periodo).
- La app lee el código y la descripción de cada equipo (`equipmentIds`, p. ej. `eq-FLE-003`) de `calibraciones/calibraciones.json`.
- Usa la clave de GitHub de las otras apps (lectura o escritura en `lab-data`).

## Seguimiento piscina durabilidad

Aplicación web para llevar la ocupación de la piscina de durabilidad del laboratorio de Polinyà:
qué bomba hay en cada una de las 120 posiciones, a qué petaca (y fase) está conectada, las HotBox,
las fechas de cada ensayo y un registro de observaciones por proyecto.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/seguimiento-piscina-durabilidad/

### Cómo funciona

- Es una página ([`seguimiento-piscina-durabilidad/index.html`](seguimiento-piscina-durabilidad/index.html)) publicada con GitHub Pages, sin servidor.
- Los datos están en [`piscina.json`](https://github.com/Polinya-LAB/endurance-data/blob/main/piscina.json) del repositorio `endurance-data`: bombas, HotBox, observaciones y ajustes.
- Cualquiera con el enlace puede **consultar** la aplicación.
- Para **registrar o modificar**, conecta la aplicación con una cuenta de GitHub con rol **Write**
  en `endurance-data`. La app guarda cada cambio como un commit, así que el
  [historial de cambios](https://github.com/Polinya-LAB/endurance-data/commits/main/piscina.json)
  muestra quién cambió qué y cuándo, y puedes deshacer cualquier cambio.

### Numeración de la piscina

- **Suelo:** 1–30 en el lado Valla y 31–60 de vuelta por el lado Pared.
- **Playa:** 61–90 en el lado Valla y 91–120 por el lado Pared.
- **Petacas:** 1–30 en el lado Valla y 31–60 en el lado Pared. Cada petaca está junto a la
  posición de suelo con su mismo número. Una bomba monofásica va a una fase (`12.1`, `12.2`, `12.3`);
  una trifásica ocupa la petaca entera (`12`).
