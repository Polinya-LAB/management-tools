// Modo --prueba: deja en el registro lo que dice DYMO e imprime una etiqueta de prueba en el rollo puesto.

import type { ApiEstacion } from "./api.ts";
import { ErrorApi } from "./api.ts";
import type { Config, Rollo } from "./config.ts";
import { type ClienteDymo, mensaje, papelDe, ROLLOS_DYMO, xmlEtiqueta, xmlParametros } from "./dymo.ts";
import { CLAVE_MALA } from "./estacion.ts";
import type { Registro } from "./log.ts";
import { base64, pngPrueba } from "./png.ts";

export async function prueba(
  cfg: Config,
  api: Pick<ApiEstacion, "ciclo">,
  dymo: ClienteDymo,
  log: Registro,
  plantilla: (r: Rollo) => string | null,
): Promise<boolean> {
  log("--- Prueba ---");
  const estado = await dymo.estado();
  log(`Servicio de DYMO: ${dymo.base ?? "no responde"}`);
  log(`Estado: ${JSON.stringify(estado)}`);
  if (dymo.ultimasImpresoras) log(`GetPrinters: ${dymo.ultimasImpresoras}`);
  if (estado.ok && estado.impresora) {
    try {
      log(`GetConsumableInfoIn550Printer: ${await dymo.consumibles(estado.impresora)}`);
    } catch (e) {
      log(`GetConsumableInfoIn550Printer: ${mensaje(e)}`);
    }
  }
  let rollo: Rollo;
  try {
    rollo = (await api.ciclo(estado, false)).rollo;
    log(`Servidor: conectado, rollo puesto ${rollo}`);
  } catch (e) {
    log(e instanceof ErrorApi && e.status === 401 ? CLAVE_MALA : `Servidor: ${mensaje(e)}`);
    return false;
  }
  if (!estado.ok || !estado.conectada) {
    log(`No se imprime la etiqueta de prueba: ${estado.error}`);
    return false;
  }
  try {
    const papel = papelDe(rollo, cfg.papel[rollo], plantilla(rollo));
    log(`Papel: ${papel.nombre} (${papel.ancho}×${papel.alto} twips, ${papel.orientacion})`);
    const r = ROLLOS_DYMO[rollo];
    const png = base64(await pngPrueba(r.largo, r.corto));
    await dymo.imprimir(estado.impresora, xmlEtiqueta(png, papel, cfg.girar180), xmlParametros("QTS-prueba"));
    log("Etiqueta de prueba enviada a la impresora. El triángulo negro debe quedar arriba a la izquierda.");
    return true;
  } catch (e) {
    log(`Etiqueta de prueba: ${mensaje(e)}`);
    return false;
  }
}
