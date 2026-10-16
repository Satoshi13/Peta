/* A real PNG for tests: w×h, RGBA (colorType 6) or RGB (2), deflated with the platform's zlib. */
const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (bytes: Uint8Array) => { let c = 0xffffffff; for (const b of bytes) c = table[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  view.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length))); return out;
}
export async function png(w: number, h: number, alpha = true): Promise<Uint8Array> {
  const channels = alpha ? 4 : 3, raw = new Uint8Array(h * (1 + w * channels));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const at = y * (1 + w * channels) + 1 + x * channels, inside = (x - w / 2) ** 2 + (y - h / 2) ** 2 < (Math.min(w, h) / 3) ** 2;
    raw.set(alpha ? [180, 90, 60, inside ? 255 : 0] : [180, 90, 60], at);
  }
  const deflated = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer());
  const ihdr = new Uint8Array(13), view = new DataView(ihdr.buffer);
  view.setUint32(0, w); view.setUint32(4, h); ihdr[8] = 8; ihdr[9] = alpha ? 6 : 2;
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflated), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { out.set(p, at); at += p.length; } return out;
}
