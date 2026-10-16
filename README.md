# Laboratorio Polinyà

Aplicaciones del laboratorio. Portada: https://polinya-lab.github.io/management-tools/

Repositorio de la organización [Polinya-LAB](https://github.com/Polinya-LAB) en GitHub.

## Dónde están los datos y quién puede modificarlos

El código y los datos están en repositorios distintos. Así cada persona solo puede modificar lo que le corresponde.

| Repositorio | Contenido | Visibilidad | Quién tiene acceso |
|---|---|---|---|
| [management-tools](https://github.com/Polinya-LAB/management-tools) (este) | Código de las apps y la web | Público | Solo administradores |
| [endurance-data](https://github.com/Polinya-LAB/endurance-data) | Datos de la piscina de durabilidad | Público | **Write** para quien registra bombas |
| [test-data](https://github.com/Polinya-LAB/test-data) | Datos de Control de ensayos | Privado | **Read** para consultar, **Write** para modificar |

Para dar acceso a una persona: en el repositorio de datos que corresponda, **Settings → Collaborators and teams → Add people**,
elige el rol y la persona acepta la invitación que le llega por correo. Para quitárselo, elimínala de la misma lista.

**Clave de acceso (una por persona y navegador).** Se crea en
[github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=repo&description=Laboratorio%20Polinya)
y se pega en la app con **Conectar con GitHub** / **Connect GitHub**. Es la misma para las dos apps.
- Si solo usa la piscina basta el permiso `public_repo`.
- Para Control de ensayos hace falta `repo`, porque sus datos son privados (el enlace anterior ya lo marca).

La clave se guarda solo en ese navegador; con **Desconectar** se borra. Si caduca, la app lo avisa y basta con crear otra.

## Control de ensayos

Aplicación para gestionar los ensayos del laboratorio: cola, tablero por estado, planificación y ocupación diaria
de técnicos y equipos, historial, biblioteca de procedimientos QTP con duraciones y perfiles de carga, e importación
de las solicitudes exportadas de ARAS. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/control-ensayos/

- Es una única página ([`control-ensayos/index.html`](control-ensayos/index.html)) que funciona igual que la del seguimiento de la piscina.
- Los datos están en [`ensayos.json`](https://github.com/Polinya-LAB/test-data/blob/main/ensayos.json) del repositorio privado `test-data`: ensayos (`tests`), personas (`personas`),
  equipos (`bancos`), procedimientos (`qtps`) y ajustes de importación (`config`).
- Como los datos son privados, para consultarla hay que **Connect GitHub** con una cuenta con acceso de lectura a `test-data`,
  y para modificar, con acceso de escritura.
- Los cambios hechos en poco tiempo (por ejemplo una importación de ARAS) se guardan juntos en un solo commit. El
  [historial](https://github.com/Polinya-LAB/test-data/commits/main/ensayos.json) muestra quién cambió qué y cuándo.
- Para importar de ARAS: exporta la búsqueda `a_Lab_Dashboard` a Excel y cárgala en la pestaña **Import ARAS**.

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
