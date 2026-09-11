#!/usr/bin/env node
/**
 * 在 node 里跑需要 App 模块的离线脚本（如 scripts/check-official-drift.ts）。
 *
 * App 模块会间接 import react-native / expo-secure-store / linux-notify 等原生模块，
 * node 直接跑不了。这里用 esbuild 打包一次，并把这些原生模块换成空实现，
 * 于是「读 App 的数据表 + 抓官网比对」这类脚本可以在开发机/CI 离线跑。
 *
 *   node scripts/run-stubbed.mjs scripts/check-official-drift.ts [参数…]
 */
import { build } from 'esbuild';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entry = process.argv[2];
if (!entry) {
  console.error('用法：node scripts/run-stubbed.mjs <入口 .ts>');
  process.exit(2);
}
const entryPath = resolve(process.cwd(), entry);
const out = join(tmpdir(), `lsb-stubbed-${process.pid}-${Date.now()}.mjs`);

const stubs = {
  'react-native': `export const Platform = { OS: 'android', select: (o) => o.android ?? o.default };
export const NativeModules = {};
export const Appearance = { getColorScheme: () => 'dark', setColorScheme: () => {}, addChangeListener: () => ({ remove() {} }) };
export const useColorScheme = () => 'dark';
export const Dimensions = { get: () => ({ width: 390, height: 844 }) };
export const PixelRatio = { get: () => 3 };
export const StyleSheet = { create: (s) => s, hairlineWidth: 1, flatten: (s) => s, absoluteFill: {} };
export const Linking = { openURL: async () => true, addEventListener: () => ({ remove() {} }) };
export const I18nManager = { isRTL: false };
export default { Platform, Appearance, Dimensions, StyleSheet };`,
  'expo-secure-store': `const mem = (globalThis.__secureStore ??= new Map());
export const getItemAsync = async (k) => (mem.has(k) ? mem.get(k) : null);
export const setItemAsync = async (k, v) => { mem.set(k, v); };
export const deleteItemAsync = async (k) => { mem.delete(k); };
export default {};`,
  'expo-file-system': `const files = (globalThis.__fsFiles ??= new Map());
const uriOf = (part) => (typeof part === 'string' ? part : part?.uri ?? '');
export class File {
  constructor(...parts) { this.uri = parts.map(uriOf).join('/'); }
  get exists() { return files.has(this.uri); }
  textSync() { return files.get(this.uri) ?? ''; }
  info() { const v = files.get(this.uri); return { exists: v != null, size: v == null ? 0 : (v.byteLength ?? String(v).length) }; }
  write(text) { files.set(this.uri, text); }
  create() { if (!files.has(this.uri)) files.set(this.uri, ''); }
  delete() { files.delete(this.uri); }
  static async downloadFileAsync(_url, dest) { return dest; }
}
export class Directory {
  constructor(...parts) { this.uri = parts.map(uriOf).join('/'); }
  get exists() { return true; }
  create() {}
}
export const Paths = { document: { uri: 'file:///doc' }, cache: { uri: 'file:///cache' } };
export default { File, Directory, Paths };`,
  'linux-notify': `export const syncNotifySession = () => undefined;
export const setAccessChannel = () => undefined;
export const canInstallPackages = () => false;
export const openInstallPermission = () => false;
export const downloadApk = async (url, dest) => dest;
export const installApk = async () => true;
export default {};`,
  '@react-native-cookies/cookies': 'export const get = async () => ({});\nexport const set = async () => true;\nexport default {};',
  'expo-modules-core': 'export const requireOptionalNativeModule = () => null;\nexport default {};',
};

await build({
  entryPoints: [entryPath],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: out,
  logLevel: 'warning',
  absWorkingDir: root,
  plugins: [{
    name: 'stub-native',
    setup(b) {
      b.onResolve({ filter: /^(react-native|expo-secure-store|expo-file-system|linux-notify|@react-native-cookies\/cookies|expo-modules-core)$/ }, (args) => ({
        path: args.path,
        namespace: 'stub',
      }));
      b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({
        contents: stubs[args.path] ?? 'export default {};',
        loader: 'js',
      }));
    },
  }],
});

try {
  await import(pathToFileURL(out).href);
} finally {
  try {
    rmSync(out, { force: true });
  } catch {
    /* 临时文件清不掉无所谓 */
  }
}
