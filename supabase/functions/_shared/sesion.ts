// Decide qué hacer con el resultado de `supabase.auth.getUser(jwt)`. Lógica pura, sin dependencias.
// Solo un error de autenticación (400/401/403) o la falta de usuario significan "sin sesión" (→ 401). Cualquier otro
// error (red, 5xx, AuthRetryableFetchError) se lanza para que el handler responda 502 y las apps sigan reintentando: una
// caída breve de Supabase Auth no debe hacer creer a todas las pestañas que la sesión ha caducado.

export interface ResultadoGetUser {
  data: { user: { email?: string | null } | null } | null;
  error: { status?: number; message?: string; name?: string } | null;
}

const SIN_SESION = new Set([400, 401, 403]);

export function sesionDe(r: ResultadoGetUser): { email: string } | null {
  if (r.error) {
    if (typeof r.error.status === "number" && SIN_SESION.has(r.error.status)) return null;
    throw new Error(`auth.getUser: ${r.error.name ?? "error"} ${r.error.status ?? "?"} ${r.error.message ?? ""}`.trim());
  }
  const email = r.data?.user?.email;
  if (!email) return null;
  return { email: email.trim().toLowerCase() };
}
