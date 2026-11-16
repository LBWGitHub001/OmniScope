export const COLORS = [
  "#00f0ff",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#eab308",
  "#3b82f6",
];

export function decodeArrayPayload(elemType: number, b64: string): ArrayLike<number> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const buf = bytes.buffer;
  switch (elemType) {
    case 0: return new Float32Array(buf, 0, Math.floor(bytes.length / 4));
    case 1: return new Int32Array(buf, 0, Math.floor(bytes.length / 4));
    case 2: return new Uint32Array(buf, 0, Math.floor(bytes.length / 4));
    case 3: return new Int16Array(buf, 0, Math.floor(bytes.length / 2));
    case 4: return new Uint16Array(buf, 0, Math.floor(bytes.length / 2));
    case 5: return new Int8Array(buf, 0, bytes.length);
    default: return new Uint8Array(buf, 0, bytes.length);
  }
}

export function fmtHex(addr: number): string {
  return "0x" + (addr >>> 0).toString(16).toUpperCase().padStart(8, "0");
}
