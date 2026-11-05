// Lógica pura de permisos por app. Sin dependencias: la usa la Edge Function `github`.

export type Rol = "ninguno" | "ver" | "editar";
export type ClaveRol = "ensayos" | "muestras" | "calibraciones" | "mantenimiento" | "piscina";
export type AppId = ClaveRol | "ocupacion";

export interface Acceso {
  email: string;
  nombre: string;
  roles: Partial<Record<ClaveRol, Rol>>;
  admin: boolean;
}

const ENSAYOS = "lab-data/ensayos/ensayos.json";
const CALIBRACIONES = "lab-data/calibraciones/calibraciones.json";

// Copia de la §3 del diseño. Rutas: "<repo>/<ruta dentro del repo>".
export const PERMISOS: Record<AppId, { rol: ClaveRol; leer: string[]; escribir: string[] }> = {
  ensayos: { rol: "ensayos", leer: [ENSAYOS, CALIBRACIONES], escribir: [ENSAYOS] },
  ocupacion: { rol: "ensayos", leer: [ENSAYOS, CALIBRACIONES], escribir: [ENSAYOS] },
  muestras: { rol: "muestras", leer: [ENSAYOS, CALIBRACIONES], escribir: [ENSAYOS] },
  calibraciones: {
    rol: "calibraciones",
    leer: [CALIBRACIONES, "lab-data/calibraciones/certificados.json"],
    escribir: [CALIBRACIONES],
  },
  mantenimiento: {
    rol: "mantenimiento",
    leer: [
      "lab-data/mantenimiento/registro.json",
      "lab-data/mantenimiento/mantenimiento.json",
      CALIBRACIONES,
    ],
    escribir: ["lab-data/mantenimiento/registro.json"],
  },
  piscina: {
    rol: "piscina",
    leer: ["endurance-data/piscina.json"],
    escribir: ["endurance-data/piscina.json"],
  },
};

const REPOS = new Set(["lab-data", "endurance-data"]);

export function rolDe(a: Acceso, app: AppId): Rol {
  return a.roles[PERMISOS[app].rol] ?? "ninguno";
}

export function puedeLeer(a: Acceso, app: AppId, repo: string, path: string): boolean {
  if (!REPOS.has(repo)) return false;
  if (rolDe(a, app) === "ninguno") return false;
  return PERMISOS[app].leer.includes(`${repo}/${path}`);
}

// JSON canónico: claves de objeto ordenadas.
function canon(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canon).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canon(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

// Ausente y {} se consideran lo mismo.
function vacio(v: unknown): boolean {
  return v === undefined || (v !== null && typeof v === "object" && !Array.isArray(v) &&
    Object.keys(v).length === 0);
}

function distinto(a: unknown, b: unknown): boolean {
  if (vacio(a) && vacio(b)) return false;
  return canon(a) !== canon(b);
}

// `config.samples` cuenta como `muestras`; el resto de `config` y las demás colecciones, como `ensayos`.
export function coleccionesCambiadas(
  antes: Record<string, unknown>,
  despues: Record<string, unknown>,
): { muestras: boolean; ensayos: boolean } {
  let muestras = false;
  let ensayos = false;
  const claves = new Set([...Object.keys(antes), ...Object.keys(despues)]);
  for (const k of claves) {
    if (k === "config") {
      const ca = (antes.config ?? {}) as Record<string, unknown>;
      const cd = (despues.config ?? {}) as Record<string, unknown>;
      for (const d of new Set([...Object.keys(ca), ...Object.keys(cd)])) {
        if (distinto(ca[d], cd[d])) {
          if (d === "samples") muestras = true;
          else ensayos = true;
        }
      }
    } else if (distinto(antes[k], despues[k])) {
      if (k === "muestras") muestras = true;
      else ensayos = true;
    }
  }
  return { muestras, ensayos };
}

export function comprobarEscritura(
  a: Acceso,
  app: AppId,
  repo: string,
  path: string,
  antes: unknown | null,
  despues: unknown,
): { ok: true } | { ok: false; motivo: string } {
  if (!REPOS.has(repo)) return { ok: false, motivo: `Repositorio desconocido: ${repo}` };
  if (rolDe(a, app) !== "editar") return { ok: false, motivo: "No tienes permiso de edición en esta app" };
  const ruta = `${repo}/${path}`;
  if (!PERMISOS[app].escribir.includes(ruta)) {
    return { ok: false, motivo: `Esta app no puede escribir ${ruta}` };
  }
  if (ruta === ENSAYOS) {
    const obj = (v: unknown) => (v && typeof v === "object" ? v as Record<string, unknown> : {});
    const c = coleccionesCambiadas(obj(antes), obj(despues));
    if (c.muestras && a.roles.muestras !== "editar") {
      return { ok: false, motivo: "Cambia muestras y no tienes permiso de edición en muestras" };
    }
    if (c.ensayos && a.roles.ensayos !== "editar") {
      return { ok: false, motivo: "Cambia ensayos y no tienes permiso de edición en ensayos" };
    }
  }
  return { ok: true };
}
