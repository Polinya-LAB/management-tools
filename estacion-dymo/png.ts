// PNG en blanco y negro (1 bit, escala de grises) sin dependencias, para la etiqueta de prueba.

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of datos) c = TABLA_CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(datos: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  // "deflate" de CompressionStream es zlib (cabecera + adler32), que es lo que pide PNG.
  const s = new Blob([datos]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

function bloque(tipo: string, datos: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + datos.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, datos.length);
  out.set(new TextEncoder().encode(tipo), 4);
  out.set(datos, 8);
  v.setUint32(8 + datos.length, crc32(out.subarray(4, 8 + datos.length)));
  return out;
}

/** `negro(x, y)` dice qué píxeles van en negro. */
export async function png1bit(ancho: number, alto: number, negro: (x: number, y: number) => boolean): Promise<Uint8Array> {
  const fila = 1 + Math.ceil(ancho / 8);
  const crudo = new Uint8Array(fila * alto); // byte de filtro 0 + píxeles; 1 = blanco
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      if (!negro(x, y)) crudo[y * fila + 1 + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, ancho);
  v.setUint32(4, alto);
  ihdr.set([1, 0, 0, 0, 0], 8); // 1 bit, gris, deflate, filtro 0, sin entrelazado
  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    bloque("IHDR", ihdr),
    bloque("IDAT", await deflate(crudo)),
    bloque("IEND", new Uint8Array()),
  ];
  const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

export function base64(datos: Uint8Array): string {
  let s = "";
  for (let i = 0; i < datos.length; i += 0x8000) s += String.fromCharCode(...datos.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Etiqueta de prueba apaisada a 300 ppp: marco, aspa y un triángulo arriba a la izquierda para ver la orientación. */
export function pngPrueba(largoMm: number, cortoMm: number): Promise<Uint8Array> {
  const px = (mm: number) => Math.round(mm / 25.4 * 300);
  const w = px(largoMm), h = px(cortoMm);
  const m = 12; // margen
  return png1bit(w, h, (x, y) => {
    const dentro = x >= m && y >= m && x < w - m && y < h - m;
    if (!dentro) return false;
    const marco = x < m + 6 || y < m + 6 || x >= w - m - 6 || y >= h - m - 6;
    const triangulo = x - m + (y - m) < h / 3;
    const diag1 = Math.abs((x - m) * (h - 2 * m) - (y - m) * (w - 2 * m)) < 2 * (w - 2 * m);
    const diag2 = Math.abs((x - m) * (h - 2 * m) - (h - m - 1 - y) * (w - 2 * m)) < 2 * (w - 2 * m);
    return marco || triangulo || diag1 || diag2;
  });
}
