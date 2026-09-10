export function decodeBase64Json<T = unknown>(raw: string): T | null {
  try {
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const normalized = padded.replace(/-/g, '+').replace(/_/g, '/');
    const atobFn = globalThis.atob;
    if (typeof atobFn !== 'function') return null;
    const binary = atobFn(normalized);
    return JSON.parse(binary) as T;
  } catch {
    return null;
  }
}
