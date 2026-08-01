export function parseArgs(t: string): string[] {
  return t.trim() ? t.trim().split(/\s+/) : [];
}

export function parseEnv(t: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) o[k] = v;
    }
  }
  return o;
}

export function parseHeaders(t: string): Record<string, string> {
  const o: Record<string, string> = {};
  for (const line of t.split("\n")) {
    const i = line.search(/[:=]/);
    if (i > 0) {
      const k = line.slice(0, i).trim();
      const v = line.slice(i + 1).trim();
      if (k) o[k] = v;
    }
  }
  return o;
}

export function parseIntSafe(t: string): number | undefined {
  const s = t.trim();
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
