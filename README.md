# Piscina de durabilidad

Aplicación web para llevar la ocupación de la piscina de durabilidad del laboratorio de Polinyà:
qué bomba hay en cada una de las 120 posiciones, a qué petaca (y fase) está conectada, las HotBox,
las fechas de cada ensayo y un registro de observaciones por proyecto.

**Abrir la aplicación:** https://daniq-93.github.io/polinya-lab/

## Cómo funciona

- Es una única página (`index.html`) publicada con GitHub Pages. No hay servidor.
- Todos los datos están en [`data/piscina.json`](data/piscina.json): bombas, HotBox, observaciones y ajustes.
- Cualquiera con el enlace puede **consultar** la aplicación.
- Para **registrar o modificar** hay que conectar la aplicación con una cuenta de GitHub que sea
  colaboradora del repositorio. Cada cambio se guarda como un commit, así que el
  [historial de cambios](https://github.com/daniq-93/polinya-lab/commits/main/data/piscina.json)
  muestra quién cambió qué y cuándo, y cualquier cambio se puede deshacer.

## Dar permiso de edición a una persona

1. En GitHub, abre **Settings → Collaborators** de este repositorio y pulsa **Add people**.
2. Escribe su usuario o correo de GitHub y envía la invitación.
3. La persona acepta la invitación que le llega por correo.

Para quitarle el permiso, elimínala de la misma lista.

## Conectar la aplicación (cada colaborador, una vez por navegador)

1. Crea una clave de acceso en
   [github.com/settings/tokens/new](https://github.com/settings/tokens/new?scopes=public_repo&description=Piscina%20de%20durabilidad)
   con el permiso `public_repo` (ya viene marcado con ese enlace). Elige la caducidad que quieras.
2. En la aplicación, pulsa **Conectar con GitHub** y pega la clave.

La clave se guarda solo en ese navegador. Con **Desconectar** se borra.
Si caduca, la aplicación lo avisa y basta con crear otra.

## Numeración de la piscina

- **Suelo:** 1–30 en el lado Valla y 31–60 de vuelta por el lado Pared.
- **Playa:** 61–90 en el lado Valla y 91–120 por el lado Pared.
- **Petacas:** 1–30 en el lado Valla y 31–60 en el lado Pared. Cada petaca está junto a la
  posición de suelo con su mismo número. Las monofásicas se conectan a una fase (`12.1`, `12.2`, `12.3`);
  una trifásica ocupa la petaca entera (`12`).
