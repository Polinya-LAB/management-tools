// CORS de las Edge Functions: solo la web del laboratorio y localhost (pruebas).

const PAGES = "https://polinya-lab.github.io";
const LOCALHOST = /^http:\/\/localhost(:\d{1,5})?$/;

export function origenPermitido(origin: string | null): boolean {
  return !!origin && (origin === PAGES || LOCALHOST.test(origin));
}

export function corsHeaders(origin: string | null): HeadersInit {
  const h: Record<string, string> = {
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, if-none-match, x-client-info",
    "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
    "Access-Control-Expose-Headers": "etag",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin",
  };
  if (origenPermitido(origin)) h["Access-Control-Allow-Origin"] = origin!;
  return h;
}

export function preflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}
