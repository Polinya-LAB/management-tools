import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { type AdminActualizar, type ErrorAuth, ponerPasswordPorId } from "./password.ts";

const CLAVE = "clave-secreta-de-prueba-16";
function falso(error: ErrorAuth | null) {
  const llamadas: Array<[string, { password: string }]> = [];
  const admin: AdminActualizar = {
    updateUserById(id, a) {
      llamadas.push([id, a]);
      return Promise.resolve({ error });
    },
  };
  return { admin, llamadas };
}

Deno.test("ponerPasswordPorId: sin error → true y manda la contraseña a ese id", async () => {
  const f = falso(null);
  assertEquals(await ponerPasswordPorId(f.admin, "u-1", CLAVE), true);
  assertEquals(f.llamadas, [["u-1", { password: CLAVE }]]);
});

Deno.test("ponerPasswordPorId: usuario de Auth borrado (404 user_not_found) → false (el handler responde 409)", async () => {
  assertEquals(await ponerPasswordPorId(falso({ status: 404, code: "user_not_found", message: "User not found" }).admin, "u-x", CLAVE), false);
  assertEquals(await ponerPasswordPorId(falso({ status: 404, message: "Not found" }).admin, "u-x", CLAVE), false);
  assertEquals(await ponerPasswordPorId(falso({ code: "user_not_found", message: "x" }).admin, "u-x", CLAVE), false);
  assertEquals(await ponerPasswordPorId(falso({ message: "User not found" }).admin, "u-x", CLAVE), false);
});

Deno.test("ponerPasswordPorId: otros errores se lanzan sin la contraseña (→ 502)", async () => {
  for (const e of [{ status: 500, code: "unexpected_failure", message: "boom" }, { status: 422, code: "weak_password", message: "weak" }]) {
    const err = await assertRejects(() => ponerPasswordPorId(falso(e).admin, "u-1", CLAVE), Error);
    assert(err.message.includes(e.code), err.message);
    assert(!err.message.includes(CLAVE));
  }
});
