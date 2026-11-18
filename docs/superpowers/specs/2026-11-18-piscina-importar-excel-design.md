# Piscina: importar bombas desde un Excel

Fecha: 18/11/2026 · Aprobado en conversación por Daniel Quesada

## Para qué

Cuando entra una tanda de bombas en la piscina de durabilidad, darlas de alta una a una con «Nueva bomba» es lento. Se
cargan todas desde el Excel que ya se prepara para cada tanda, revisándolas en una ventana antes de guardar nada.

## Qué hace

- Botón **Importar Excel** en la cabecera, junto a «Nueva bomba»; solo con permiso de edición.
- Lee la primera hoja que tenga una fila de cabecera con «Posición» y «Petaca», esté donde esté (en el ejemplo, D5).
  Columnas: Posición, Petaca, Proyecto, Fabricante motor, Potencia, Referencia, S/N, Fecha Inicio, Fecha Fin (y Notas,
  si viene). Fichero de ejemplo: `18_bombas_durabilidad.xlsx` (18 filas).
- Lectura de cada valor (decidido con Daniel):
  - **Petaca** `27.3` = petaca 27, fase 3 (monofásica); sin decimal = trifásica.
  - **Potencia** `150M` = 1,5 HP monofásica; `100M` = 1 HP; `T` = trifásica. Un número suelto menor de 25 son HP.
  - **Fecha Fin** vacía = inicio + 6 meses, como el formulario.
  - **S/N** numérico se guarda como texto.
- **Ventana de verificación**: una fila por bomba con casilla, todos los campos corregibles y el resultado de las mismas
  comprobaciones del formulario (posición libre, petaca/fase libres, fechas, n.º de serie repetido), contra las bombas
  que ya están y contra las demás filas del Excel. Las filas con error no se importan; las que coinciden con una bomba
  activa (misma posición y mismo n.º de serie) salen como «ya está en la piscina».
- **Fabricantes que no existen todavía**: aviso arriba con un campo para sustituir el nombre en todas las filas que lo
  llevan (en el ejemplo, `HEIENENG` y `HEINENG` → `HAINENG MSL`).
- Al aceptar, las filas marcadas y correctas se guardan en un solo cambio (un commit en endurance-data).

## Qué no hace

No modifica ni finaliza bombas que ya están en la piscina: solo da de alta.

## Formas de hacerlo que se consideraron

1. **Leer el Excel de la tanda tal cual** (elegida): no cambia cómo se prepara el fichero.
2. Plantilla descargable con columnas fijas: obligaría a copiar los datos a otro formato.
3. Pegar desde el portapapeles: más frágil con fechas y números de serie largos.

## Cómo está hecho

Todo en `seguimiento-piscina-durabilidad/index.html`. El lector de Excel (xlsx 0.18.5, el mismo de Control de ensayos)
se carga solo al pulsar el botón. `validate()` acepta una lista extra de bombas para comprobar las filas entre sí.
Español e inglés. Prueba e2e en `tests/e2e/piscina.test.js` con un Excel generado como el de ejemplo.
