export function isNativeApp(): boolean {
  return typeof navigator !== 'undefined' && (navigator as { product?: string }).product === 'ReactNative';
}

export function siteCredentials(): RequestCredentials {
  return isNativeApp() ? 'include' : 'omit';
}
