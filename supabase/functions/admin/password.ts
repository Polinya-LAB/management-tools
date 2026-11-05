// Cambio de contraseña en Supabase Auth (auth.admin.updateUserById), aparte de index.ts para poder probarlo sin cliente real.

export interface ErrorAuth {
  status?: number;
  code?: string;
  message: string;
}
export interface AdminActualizar {
  updateUserById(id: string, atributos: { password: string }): Promise<{ error: ErrorAuth | null }>;
}

// GoTrue responde 404 user_not_found cuando el id ya no existe (p. ej. un acceso.user_id de un usuario de Auth borrado).
export function esUsuarioNoEncontrado(e: ErrorAuth): boolean {
  return e.status === 404 || e.code === "user_not_found" || /user not found/i.test(e.message ?? "");
}

// true: contraseña cambiada; false: ese usuario de Auth no existe (el handler responde 409). Cualquier otro error se
// lanza con estado, código y mensaje de Auth, nunca con la contraseña (el handler escribe el error en el log).
export async function ponerPasswordPorId(admin: AdminActualizar, id: string, password: string): Promise<boolean> {
  const { error } = await admin.updateUserById(id, { password });
  if (!error) return true;
  if (esUsuarioNoEncontrado(error)) return false;
  throw new Error(`updateUserById: ${error.status ?? ""} ${error.code ?? ""} ${error.message}`);
}
