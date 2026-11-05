import { assertEquals } from "jsr:@std/assert@1";
import {
  type Acceso,
  coleccionesCambiadas,
  comprobarEscritura,
  puedeLeer,
  rolDe,
} from "./permisos.ts";

const acc = (roles: Acceso["roles"]): Acceso => ({
  email: "a@b.c",
  nombre: "A",
  roles,
  admin: false,
});

const ENS = "ensayos/ensayos.json";

Deno.test("rolDe: ocupacion usa el rol ensayos; ausente es ninguno", () => {
  const a = acc({ ensayos: "editar" });
  assertEquals(rolDe(a, "ocupacion"), "editar");
  assertEquals(rolDe(a, "piscina"), "ninguno");
});

Deno.test("puedeLeer", () => {
  const ver = acc({ ensayos: "ver" });
  assertEquals(puedeLeer(ver, "ensayos", "lab-data", ENS), true);
  assertEquals(puedeLeer(ver, "ensayos", "lab-data", "calibraciones/calibraciones.json"), true);
  assertEquals(puedeLeer(ver, "ensayos", "lab-data", "mantenimiento/registro.json"), false);
  assertEquals(puedeLeer(acc({ ensayos: "ninguno" }), "ensayos", "lab-data", ENS), false);
  assertEquals(puedeLeer(acc({ piscina: "ver" }), "piscina", "endurance-data", "piscina.json"), true);
  assertEquals(puedeLeer(acc({ piscina: "ver" }), "piscina", "otro-repo", "piscina.json"), false);
});

Deno.test("coleccionesCambiadas", () => {
  assertEquals(coleccionesCambiadas({ muestras: [1] }, { muestras: [2] }), { muestras: true, ensayos: false });
  assertEquals(
    coleccionesCambiadas({ config: { samples: { a: 1 } } }, { config: { samples: { a: 2 } } }),
    { muestras: true, ensayos: false },
  );
  assertEquals(
    coleccionesCambiadas({ config: { importAras: 1 } }, { config: { importAras: 2 } }),
    { muestras: false, ensayos: true },
  );
  assertEquals(
    coleccionesCambiadas({ tests: [1], muestras: [1] }, { tests: [2], muestras: [2] }),
    { muestras: true, ensayos: true },
  );
  assertEquals(
    coleccionesCambiadas({ tests: [{ a: 1, b: 2 }] }, { tests: [{ b: 2, a: 1 }] }),
    { muestras: false, ensayos: false },
  );
  assertEquals(coleccionesCambiadas({}, { tests: {} }), { muestras: false, ensayos: false });
});

Deno.test("comprobarEscritura", () => {
  const mix = acc({ muestras: "editar", ensayos: "ver" });
  const antes = { muestras: [1], tests: [1], config: { samples: { a: 1 }, importAras: 1 } };
  const soloMuestras = { muestras: [2], tests: [1], config: { samples: { a: 2 }, importAras: 1 } };
  assertEquals(comprobarEscritura(mix, "muestras", "lab-data", ENS, antes, soloMuestras), { ok: true });
  assertEquals(
    comprobarEscritura(mix, "muestras", "lab-data", ENS, antes, { ...soloMuestras, tests: [2] }).ok,
    false,
  );
  assertEquals(
    comprobarEscritura(acc({ ensayos: "editar" }), "ensayos", "lab-data", ENS, antes, soloMuestras).ok,
    false,
  );
  assertEquals(
    comprobarEscritura(acc({ calibraciones: "ver" }), "calibraciones", "lab-data", "calibraciones/calibraciones.json", {}, {}).ok,
    false,
  );
  assertEquals(
    comprobarEscritura(acc({ mantenimiento: "editar" }), "mantenimiento", "lab-data", "mantenimiento/mantenimiento.json", {}, {}).ok,
    false,
  );
  assertEquals(
    comprobarEscritura(acc({ mantenimiento: "editar" }), "mantenimiento", "lab-data", "mantenimiento/registro.json", null, { a: 1 }),
    { ok: true },
  );
});
