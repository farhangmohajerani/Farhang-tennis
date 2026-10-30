/** Stable, collision-resistant ids (crypto when available). */
export function uid(prefix = ''): string {
  let r = '';
  try {
    const a = new Uint8Array(8);
    globalThis.crypto.getRandomValues(a);
    r = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    r = Math.random().toString(16).slice(2) + Date.now().toString(16);
  }
  return prefix ? `${prefix}-${r}` : r;
}
