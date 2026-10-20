# Laboratorio Polinyà

Aplicaciones del laboratorio. Portada: https://polinya-lab.github.io/management-tools/

Repositorio de la organización [Polinya-LAB](https://github.com/Polinya-LAB) en GitHub.

## Dónde están los datos y quién puede modificarlos

El código y los datos están en repositorios distintos. Así cada persona solo puede modificar lo que le corresponde.

| Repositorio | Contenido | Visibilidad | Quién tiene acceso |
|---|---|---|---|
| [management-tools](https://github.com/Polinya-LAB/management-tools) (este) | Código de las apps y la web | Público | Solo administradores |
| [endurance-data](https://github.com/Polinya-LAB/endurance-data) | Datos de la piscina de durabilidad | Público | **Write** para quien registra bombas |
| [lab-data](https://github.com/Polinya-LAB/lab-data) | Datos privados del laboratorio: `ensayos/` (Control de ensayos), `calibraciones/` (Plan de calibraciones) y `mantenimiento/` (Plan de mantenimiento) | Privado | **Read** para consultar, **Write** para modificar |

Para dar acceso a una persona: en el repositorio de datos que corresponda, **Settings → Collaborators and teams → Add people**,
elige el rol y la persona acepta la invitación que le llega por correo. Para quitárselo, elimínala de la misma lista.

**Clave de acceso (una por persona y navegador).** Se crea en
[github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=Laboratorio%20Polinya)
y se pega en la app con **Conectar con GitHub** / **Connect GitHub**. Es la misma para todas las apps.
- Si solo usa la piscina basta el permiso `public_repo`.
- Para Control de ensayos y el Plan de calibraciones hace falta `repo`, porque sus datos son privados (el enlace anterior ya lo marca).

La clave se guarda solo en ese navegador; con **Desconectar** se borra. Si caduca, la app lo avisa y basta con crear otra.

## Control de ensayos

Aplicación para gestionar los ensayos del laboratorio: cola, tablero por estado, planificación por recurso
(con opción de ocultar los equipos sin ensayos en el periodo), historial, biblioteca de procedimientos QTP con duraciones y perfiles de carga, e importación de las solicitudes exportadas de ARAS.
La carga y ocupación diaria de técnicos y equipos están en su propia aplicación, [Ocupación](#ocupación-de-equipos-y-técnicos).
La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/control-ensayos/

- Es una página ([`control-ensayos/index.html`](control-ensayos/index.html)) con su código en `app.js` y `app.css`, que comparte con Ocupación.
- Los datos están en [`ensayos/ensayos.json`](https://github.com/Polinya-LAB/lab-data/blob/main/ensayos/ensayos.json) del repositorio privado `lab-data`: ensayos (`tests`), personas (`personas`),
  equipos (`bancos`), procedimientos (`qtps`) y ajustes de importación (`config`).
- Como los datos son privados, para consultarla hay que **Connect GitHub** con una cuenta con acceso de lectura a `lab-data`,
  y para modificar, con acceso de escritura.
- Los cambios hechos en poco tiempo (por ejemplo una importación de ARAS) se guardan juntos en un solo commit. El
  [historial](https://github.com/Polinya-LAB/lab-data/commits/main/ensayos/ensayos.json) muestra quién cambió qué y cuándo.
- Para importar de ARAS: exporta la búsqueda `a_Lab_Dashboard` a Excel y cárgala en la pestaña **Import ARAS**. Las líneas nuevas
  y los datos de solicitud se importan al cargar el fichero (la primera vez, o si aparece un equipo desconocido, se confirma a mano).
  Si un ensayo ya existente tiene otro estado en ARAS, la app pregunta cuál quedarse; si se mantiene el de la app, no vuelve a
  preguntar hasta que ARAS cambie (`tests/<id>.arasStatusKept`). Planned cuenta como In Queue, y Endurance running, On hold y
  Report como In Progress. En el nombre ARAS de un equipo se pueden poner varios nombres separados por `;`.
- Cada equipo y cada QTP pueden tener asignados los instrumentos (FLE) del Plan de calibraciones que se usan habitualmente
  (pestañas **Equipment & team** y **QTP library**, al editar). Se guardan en `bancos/<id>.instrumentos` y `qtps/<id>.instrumentos` como lista de ids de
  `calibraciones/calibraciones.json` → `equipment` (por ejemplo `eq-FLE-014`); se usan ids y no códigos porque hay códigos FLE repetidos.

## Ocupación de equipos y técnicos

Carga de técnicos y equipos a partir de los ensayos de Control de ensayos: resumen con la carga semanal de las
próximas 8 semanas, planificación por recurso, ocupación diaria y alertas de equipos por encima de su capacidad
o técnicos sobrecargados. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/ocupacion/

- Usa los mismos datos que Control de ensayos (`ensayos/ensayos.json` en `lab-data`) y el mismo código
  ([`control-ensayos/app.js`](control-ensayos/app.js)); [`ocupacion/index.html`](ocupacion/index.html) solo elige qué vistas mostrar.
- Los ensayos se crean e importan en Control de ensayos. Aquí se pueden abrir y cambiar (técnico, equipo, fechas),
  y cada cambio se guarda como commit con el prefijo «Ocupación».
- Como los datos son privados, hace falta **Connect GitHub** con una cuenta con acceso a `lab-data`. GitHub da acceso
  al repositorio entero, así que quien pueda abrir Control de ensayos también puede abrir esta aplicación.

## Plan de calibraciones

Plan de calibración de los equipos del laboratorio (formulario F-IM-FM-001): equipos con sus puntos y tolerancias,
plan anual, registro y cierre de calibraciones, evaluación de la tolerancia de uso (|e| + U ≤ TU), hojas de validación
por cámara frente a las normas de ensayo (ISO 9227, IEC 60068), imprimibles en PDF, revisión de datos e
importación del Excel del plan. El mantenimiento está en su propia aplicación, [Plan de mantenimiento](#plan-de-mantenimiento). La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/calibraciones/

- Es una única página ([`calibraciones/index.html`](calibraciones/index.html)) que guarda igual que Control de ensayos.
- Los datos están en [`calibraciones/calibraciones.json`](https://github.com/Polinya-LAB/lab-data/blob/main/calibraciones/calibraciones.json) del repositorio privado `lab-data`:
  equipos (`equipment`), calibraciones (`calibrations`), evaluaciones TU (`evaluations`) y ajustes (`config`). La colección `maintenance` se conserva en el fichero pero ya no se usa.
- Para consultarla hay que **Connect GitHub** con una cuenta con acceso de lectura a `lab-data`, y para modificar, con acceso de escritura.
  La clave es la misma que la de las otras apps.
- Cada cambio es un commit; el [historial](https://github.com/Polinya-LAB/lab-data/commits/main/calibraciones/calibraciones.json) muestra quién cambió qué y cuándo.

## Plan de mantenimiento

Plan de mantenimiento de equipos e instalaciones del laboratorio (formulario F-IM-FM-002), separado del Plan de calibraciones:
resumen con lo vencido y lo próximo agrupado por proveedor, plan con filtros, plan anual por meses, acciones correctivas,
ofertas y partes de trabajo, y revisión de fechas. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/mantenimiento/

- Es una única página ([`mantenimiento/index.html`](mantenimiento/index.html)) que guarda igual que el Plan de calibraciones.
- El plan sale del Excel `Maintenance Plan.xlsx` de SharePoint (07. Laboratory › 4. Equipment › 1. Maintenance). Una tarea
  programada lo copia, junto con los PDF de ofertas, partes y correctivas (resumen y enlace), a
  [`mantenimiento/mantenimiento.json`](https://github.com/Polinya-LAB/lab-data/blob/main/mantenimiento/mantenimiento.json) los días 1 y 15
  ([instrucciones](https://github.com/Polinya-LAB/lab-data/blob/main/sharepoint-sync.md)). La app solo lee ese fichero:
  los equipos, acciones y periodos se cambian en el Excel.
- Lo que se hace en la app (mantenimientos programados y realizados, ajustes) se guarda en
  [`mantenimiento/registro.json`](https://github.com/Polinya-LAB/lab-data/blob/main/mantenimiento/registro.json) (`records`, `config`),
  que crea el primer guardado. Un mantenimiento registrado como hecho después de la fecha del Excel mueve la próxima fecha (fecha + periodo).
- El código y la descripción de cada equipo (`equipmentIds`, p. ej. `eq-FLE-003`) se leen de `calibraciones/calibraciones.json`.
- Se consulta y modifica con la misma clave de GitHub que las otras apps (lectura o escritura en `lab-data`).

## Seguimiento piscina durabilidad

Aplicación web para llevar la ocupación de la piscina de durabilidad del laboratorio de Polinyà:
qué bomba hay en cada una de las 120 posiciones, a qué petaca (y fase) está conectada, las HotBox,
las fechas de cada ensayo y un registro de observaciones por proyecto.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/seguimiento-piscina-durabilidad/

### Cómo funciona

- Es una única página ([`seguimiento-piscina-durabilidad/index.html`](seguimiento-piscina-durabilidad/index.html)) publicada con GitHub Pages. No hay servidor.
- Todos los datos están en [`piscina.json`](https://github.com/Polinya-LAB/endurance-data/blob/main/piscina.json) del repositorio `endurance-data`: bombas, HotBox, observaciones y ajustes.
- Cualquiera con el enlace puede **consultar** la aplicación.
- Para **registrar o modificar** hay que conectar la aplicación con una cuenta de GitHub con rol **Write**
  en `endurance-data`. Cada cambio se guarda como un commit, así que el
  [historial de cambios](https://github.com/Polinya-LAB/endurance-data/commits/main/piscina.json)
  muestra quién cambió qué y cuándo, y cualquier cambio se puede deshacer.

### Numeración de la piscina

- **Suelo:** 1–30 en el lado Valla y 31–60 de vuelta por el lado Pared.
- **Playa:** 61–90 en el lado Valla y 91–120 por el lado Pared.
- **Petacas:** 1–30 en el lado Valla y 31–60 en el lado Pared. Cada petaca está junto a la
  posición de suelo con su mismo número. Las monofásicas se conectan a una fase (`12.1`, `12.2`, `12.3`);
  una trifásica ocupa la petaca entera (`12`).
