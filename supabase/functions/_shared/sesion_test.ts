import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { sesionDe } from "./sesion.ts";

Deno.test("sesionDe: error 401/403/400 de Auth → sin sesión", () => {
  for (const status of [400, 401, 403]) {
    assertEquals(sesionDe({ data: { user: null }, error: { name: "AuthApiError", status, message: "invalid JWT" } }), null);
  }
});

Deno.test("sesionDe: error 500, de red o reintentable → lanza", () => {
  assertThrows(() => sesionDe({ data: { user: null }, error: { name: "AuthApiError", status: 500, message: "x" } }));
  assertThrows(() => sesionDe({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 0, message: "fetch failed" } }));
  assertThrows(() => sesionDe({ data: { user: null }, error: { name: "AuthRetryableFetchError", status: 503, message: "x" } }));
  assertThrows(() => sesionDe({ data: null, error: { message: "sin estado" } }));
});

Deno.test("sesionDe: usuario válido → correo en minúsculas", () => {
  assertEquals(sesionDe({ data: { user: { email: " Ana.Lopez@Fluidra.COM " } }, error: null }), { email: "ana.lopez@fluidra.com" });
});

Deno.test("sesionDe: sin usuario o sin correo → sin sesión", () => {
  assertEquals(sesionDe({ data: { user: null }, error: null }), null);
  assertEquals(sesionDe({ data: { user: { email: "" } }, error: null }), null);
  assertEquals(sesionDe({ data: null, error: null }), null);
});
