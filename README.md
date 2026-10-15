# Laboratorio Polinyà

Aplicaciones del laboratorio. Portada: https://polinya-lab.github.io/management-tools/

Repositorio de la organización [Polinya-LAB](https://github.com/Polinya-LAB) en GitHub.

## Control de ensayos

Aplicación para gestionar los ensayos del laboratorio: cola, tablero por estado, planificación y ocupación diaria
de técnicos y equipos, historial, biblioteca de procedimientos QTP con duraciones y perfiles de carga, e importación
de las solicitudes exportadas de ARAS. La interfaz está en inglés.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/control-ensayos/

- Es una única página ([`control-ensayos/index.html`](control-ensayos/index.html)) que funciona igual que la del seguimiento de la piscina.
- Los datos están en [`control-ensayos/data/ensayos.json`](control-ensayos/data/ensayos.json): ensayos (`tests`), personas (`personas`),
  equipos (`bancos`), procedimientos (`qtps`) y ajustes de importación (`config`).
- Cualquiera con el enlace puede consultarla. Para modificar hay que **Connect GitHub** con la clave de un colaborador del repositorio;
  es la misma clave que la de la piscina, así que si ya está conectada en ese navegador sirve para las dos.
- Los cambios hechos en poco tiempo (por ejemplo una importación de ARAS) se guardan juntos en un solo commit. El
  [historial](https://github.com/Polinya-LAB/management-tools/commits/main/control-ensayos/data/ensayos.json) muestra quién cambió qué y cuándo.
- Para importar de ARAS: exporta la búsqueda `a_Lab_Dashboard` a Excel y cárgala en la pestaña **Import ARAS**.

## Seguimiento piscina durabilidad

Aplicación web para llevar la ocupación de la piscina de durabilidad del laboratorio de Polinyà:
qué bomba hay en cada una de las 120 posiciones, a qué petaca (y fase) está conectada, las HotBox,
las fechas de cada ensayo y un registro de observaciones por proyecto.

**Abrir la aplicación:** https://polinya-lab.github.io/management-tools/seguimiento-piscina-durabilidad/

### Cómo funciona

- Es una única página ([`seguimiento-piscina-durabilidad/index.html`](seguimiento-piscina-durabilidad/index.html)) publicada con GitHub Pages. No hay servidor.
- Todos los datos están en [`seguimiento-piscina-durabilidad/data/piscina.json`](seguimiento-piscina-durabilidad/data/piscina.json): bombas, HotBox, observaciones y ajustes.
- Cualquiera con el enlace puede **consultar** la aplicación.
- Para **registrar o modificar** hay que conectar la aplicación con una cuenta de GitHub que sea
  colaboradora del repositorio. Cada cambio se guarda como un commit, así que el
  [historial de cambios](https://github.com/Polinya-LAB/management-tools/commits/main/seguimiento-piscina-durabilidad/data/piscina.json)
  muestra quién cambió qué y cuándo, y cualquier cambio se puede deshacer.

### Dar permiso de edición a una persona

1. En GitHub, abre **Settings → Collaborators and teams** de este repositorio y pulsa **Add people**.
2. Escribe su usuario o correo de GitHub y envía la invitación.
3. Elige el rol **Write** y la persona acepta la invitación que le llega por correo.

Para quitarle el permiso, elimínala de la misma lista.

### Conectar la aplicación (cada colaborador, una vez por navegador)

1. Crea una clave de acceso en
   [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=public_repo&description=Piscina%20de%20durabilidad)
   con el permiso `public_repo` (ya viene marcado con ese enlace). Elige la caducidad que quieras.
2. En la aplicación, pulsa **Conectar con GitHub** y pega la clave.

La clave se guarda solo en ese navegador. Con **Desconectar** se borra.
Si caduca, la aplicación lo avisa y basta con crear otra.

### Numeración de la piscina

- **Suelo:** 1–30 en el lado Valla y 31–60 de vuelta por el lado Pared.
- **Playa:** 61–90 en el lado Valla y 91–120 por el lado Pared.
- **Petacas:** 1–30 en el lado Valla y 31–60 en el lado Pared. Cada petaca está junto a la
  posición de suelo con su mismo número. Las monofásicas se conectan a una fase (`12.1`, `12.2`, `12.3`);
  una trifásica ocupa la petaca entera (`12`).
