import type { CodeTokenKind } from '../theme/code-themes';

export type CodeLang =
  | 'json'
  | 'js'
  | 'ts'
  | 'python'
  | 'bash'
  | 'sql'
  | 'html'
  | 'css'
  | 'yaml'
  | 'go'
  | 'rust'
  | 'java'
  | 'php'
  | 'c'
  | 'generic';

export type HlToken = { t: string; k: CodeTokenKind };

const LANG_ALIAS: Record<string, CodeLang> = {
  json: 'json', jsonc: 'json', json5: 'json',
  js: 'js', javascript: 'js', jsx: 'js', mjs: 'js', cjs: 'js', node: 'js',
  ts: 'ts', typescript: 'ts', tsx: 'ts',
  py: 'python', python: 'python',
  sh: 'bash', bash: 'bash', zsh: 'bash', shell: 'bash', console: 'bash',
  sql: 'sql',
  html: 'html', xml: 'html', svg: 'html',
  css: 'css', scss: 'css', less: 'css',
  yml: 'yaml', yaml: 'yaml',
  go: 'go', golang: 'go',
  rs: 'rust', rust: 'rust',
  java: 'java', kt: 'java', kotlin: 'java',
  php: 'php',
  c: 'c', h: 'c', cpp: 'c', cc: 'c', cxx: 'c', hpp: 'c',
};

export const LANG_LABEL: Record<CodeLang, string> = {
  json: 'JSON',
  js: 'JavaScript',
  ts: 'TypeScript',
  python: 'Python',
  bash: 'Shell',
  sql: 'SQL',
  html: 'HTML',
  css: 'CSS',
  yaml: 'YAML',
  go: 'Go',
  rust: 'Rust',
  java: 'Java',
  php: 'PHP',
  c: 'C / C++',
  generic: 'CODE',
};

const KW: Record<CodeLang, Set<string>> = {
  json: new Set(),
  js: new Set(['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new', 'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with', 'yield']),
  ts: new Set(['async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do', 'else', 'enum', 'export', 'extends', 'finally', 'for', 'from', 'function', 'if', 'implements', 'import', 'in', 'infer', 'interface', 'keyof', 'let', 'namespace', 'new', 'of', 'private', 'protected', 'public', 'readonly', 'return', 'satisfies', 'static', 'super', 'switch', 'this', 'throw', 'try', 'type', 'typeof', 'var', 'void', 'while', 'yield', 'as', 'is']),
  python: new Set(['and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']),
  bash: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'in', 'do', 'done', 'while', 'until', 'case', 'esac', 'function', 'select', 'time', 'coproc']),
  sql: new Set(['select', 'from', 'where', 'and', 'or', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'index', 'view', 'drop', 'alter', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'limit', 'offset', 'as', 'distinct', 'having', 'union', 'all', 'not', 'null', 'in', 'exists', 'between', 'like', 'is', 'asc', 'desc', 'with']),
  html: new Set(),
  css: new Set(['important', 'from', 'to']),
  yaml: new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off']),
  go: new Set(['break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var']),
  rust: new Set(['as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum', 'extern', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'type', 'unsafe', 'use', 'where', 'while']),
  java: new Set(['abstract', 'assert', 'boolean', 'break', 'byte', 'case', 'catch', 'class', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extends', 'final', 'finally', 'float', 'for', 'goto', 'if', 'implements', 'import', 'instanceof', 'int', 'interface', 'long', 'native', 'new', 'package', 'private', 'protected', 'public', 'return', 'short', 'static', 'strictfp', 'super', 'switch', 'synchronized', 'this', 'throw', 'throws', 'transient', 'try', 'void', 'volatile', 'while', 'var', 'record', 'sealed', 'yield']),
  php: new Set(['abstract', 'and', 'array', 'as', 'break', 'callable', 'case', 'catch', 'class', 'clone', 'const', 'continue', 'declare', 'default', 'do', 'echo', 'else', 'elseif', 'empty', 'enddeclare', 'endfor', 'endforeach', 'endif', 'endswitch', 'endwhile', 'extends', 'final', 'finally', 'fn', 'for', 'foreach', 'function', 'global', 'goto', 'if', 'implements', 'include', 'include_once', 'instanceof', 'insteadof', 'interface', 'isset', 'list', 'match', 'namespace', 'new', 'or', 'print', 'private', 'protected', 'public', 'readonly', 'require', 'require_once', 'return', 'static', 'switch', 'throw', 'trait', 'try', 'unset', 'use', 'var', 'while', 'xor', 'yield']),
  c: new Set(['auto', 'break', 'case', 'char', 'const', 'continue', 'default', 'do', 'double', 'else', 'enum', 'extern', 'float', 'for', 'goto', 'if', 'inline', 'int', 'long', 'register', 'restrict', 'return', 'short', 'signed', 'sizeof', 'static', 'struct', 'switch', 'typedef', 'union', 'unsigned', 'void', 'volatile', 'while', 'class', 'namespace', 'template', 'typename', 'using', 'virtual', 'public', 'private', 'protected', 'new', 'delete', 'this', 'try', 'catch', 'throw']),
  generic: new Set(['if', 'else', 'for', 'while', 'return', 'function', 'class', 'const', 'let', 'var', 'import', 'export', 'from', 'true', 'false', 'null', 'def', 'async', 'await']),
};

const BOOLS = new Set(['true', 'false', 'null', 'undefined', 'None', 'True', 'False', 'nil', 'NaN', 'Infinity']);
const TYPES = new Set(['string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'any', 'unknown', 'never', 'void', 'int', 'float', 'double', 'char', 'bool', 'usize', 'isize', 'str', 'Self']);
const MAX_CHARS = 16000;

function push(out: HlToken[], t: string, k: CodeTokenKind) {
  if (t) out.push({ t, k });
}

export function normalizeLang(raw?: string): CodeLang | undefined {
  if (!raw) return undefined;
  return LANG_ALIAS[raw.toLowerCase().trim()] ?? undefined;
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  return (t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'));
}

export function tryPrettyJson(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function detectLang(text: string, hinted?: string): CodeLang {
  const named = normalizeLang(hinted);
  if (named) return named;
  const t = text.trim();
  if (looksLikeJson(t) && tryPrettyJson(t)) return 'json';
  if (/^<!DOCTYPE|^<html[\s>]|^<[a-zA-Z][\w:-]*(?:\s[\s\S]*)?>/i.test(t) && /<\/[a-zA-Z]/.test(t)) return 'html';
  if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|WITH|ALTER|DROP)\b/i.test(t)) return 'sql';
  if (/^#!/.test(t) || /^\s*\$\s+\S/.test(t)) return 'bash';
  return 'generic';
}

function isIdentStart(ch: string) {
  return /[A-Za-z_$\u00C0-\uFFFF]/.test(ch);
}

function isIdentPart(ch: string) {
  return /[A-Za-z0-9_$\u00C0-\uFFFF]/.test(ch);
}

export function tokenizeJson(src: string): HlToken[] {
  const out: HlToken[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      let j = i + 1;
      while (j < src.length && ' \t\n\r'.includes(src[j])) j += 1;
      push(out, src.slice(i, j), 'text');
      i = j;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      const raw = src.slice(i, j);
      let k = j;
      while (k < src.length && ' \t\n\r'.includes(src[k])) k += 1;
      push(out, raw, src[k] === ':' ? 'key' : 'string');
      i = j;
      continue;
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) {
      const m = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (m) {
        push(out, m[0], 'number');
        i += m[0].length;
        continue;
      }
    }
    const word = src.slice(i).match(/^(true|false|null)/);
    if (word && !isIdentPart(src[i + word[0].length] || '')) {
      push(out, word[0], 'bool');
      i += word[0].length;
      continue;
    }
    if ('{}[],:'.includes(ch)) {
      push(out, ch, 'punct');
      i += 1;
      continue;
    }
    push(out, ch, 'text');
    i += 1;
  }
  return out;
}

function readQuoted(src: string, start: number, quote: string): number {
  let i = start + quote.length;
  while (i < src.length) {
    if (src[i] === '\\') {
      i += 2;
      continue;
    }
    if (src.startsWith(quote, i)) return i + quote.length;
    i += 1;
  }
  return src.length;
}

export function tokenizeHtml(src: string): HlToken[] {
  const out: HlToken[] = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      const j = end < 0 ? src.length : end + 3;
      push(out, src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (src[i] === '<') {
      const close = src.indexOf('>', i);
      if (close < 0) {
        push(out, src.slice(i), 'tag');
        break;
      }
      let j = i + 1;
      push(out, src[i], 'punct');
      if (src[j] === '/' || src[j] === '!') {
        push(out, src[j], 'punct');
        j += 1;
      }
      const nameStart = j;
      while (j < close && (isIdentPart(src[j]) || src[j] === '-' || src[j] === ':')) j += 1;
      push(out, src.slice(nameStart, j), 'tag');
      while (j < close) {
        if (src[j] === ' ' || src[j] === '\t' || src[j] === '\n' || src[j] === '\r') {
          let k = j + 1;
          while (k < close && ' \t\n\r'.includes(src[k])) k += 1;
          push(out, src.slice(j, k), 'text');
          j = k;
          continue;
        }
        if (src[j] === '"' || src[j] === "'") {
          const end = readQuoted(src, j, src[j]);
          push(out, src.slice(j, Math.min(end, close)), 'string');
          j = Math.min(end, close);
          continue;
        }
        if (src[j] === '=' || src[j] === '/') {
          push(out, src[j], 'punct');
          j += 1;
          continue;
        }
        const attrStart = j;
        while (j < close && !' \t\n\r="\'/>'.includes(src[j])) j += 1;
        push(out, src.slice(attrStart, j), 'attr');
      }
      push(out, '>', 'punct');
      i = close + 1;
      continue;
    }
    const next = src.indexOf('<', i);
    const j = next < 0 ? src.length : next;
    push(out, src.slice(i, j), 'text');
    i = j;
  }
  return out;
}

function tokenizeCode(src: string, lang: CodeLang): HlToken[] {
  const out: HlToken[] = [];
  const keys = KW[lang];
  const hash = lang === 'python' || lang === 'bash' || lang === 'yaml' || lang === 'php';
  const dashComment = lang === 'sql';
  const slash = lang !== 'python' && lang !== 'bash' && lang !== 'yaml';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('"""', i) || src.startsWith("'''", i)) {
      const q = src.slice(i, i + 3);
      const end = readQuoted(src, i, q);
      push(out, src.slice(i, end), 'string');
      i = end;
      continue;
    }
    if ((src[i] === '"' || src[i] === "'" || src[i] === '`') && !(lang === 'bash' && src[i] === '`')) {
      const end = readQuoted(src, i, src[i]);
      push(out, src.slice(i, end), 'string');
      i = end;
      continue;
    }
    if (slash && src.startsWith('//', i)) {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      push(out, src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (slash && src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      const j = end < 0 ? src.length : end + 2;
      push(out, src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (hash && src[i] === '#' && (i === 0 || src[i - 1] === '\n' || src[i - 1] === ' ' || src[i - 1] === '\t')) {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      push(out, src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (dashComment && src.startsWith('--', i)) {
      const end = src.indexOf('\n', i);
      const j = end < 0 ? src.length : end;
      push(out, src.slice(i, j), 'comment');
      i = j;
      continue;
    }
    if (src[i] === '-' || (src[i] >= '0' && src[i] <= '9')) {
      const m = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (m && (i === 0 || !isIdentPart(src[i - 1]))) {
        push(out, m[0], 'number');
        i += m[0].length;
        continue;
      }
    }
    if (isIdentStart(src[i])) {
      let j = i + 1;
      while (j < src.length && isIdentPart(src[j])) j += 1;
      const word = src.slice(i, j);
      let k = j;
      while (k < src.length && (src[k] === ' ' || src[k] === '\t')) k += 1;
      if (BOOLS.has(word)) push(out, word, 'bool');
      else if (keys.has(word) || keys.has(word.toLowerCase())) push(out, word, 'keyword');
      else if (TYPES.has(word)) push(out, word, 'type');
      else if (src[k] === '(') push(out, word, 'fn');
      else if ((lang === 'yaml' || lang === 'css') && src[k] === ':') push(out, word, 'key');
      else if (/^[A-Z][A-Za-z0-9_]+$/.test(word) && lang !== 'generic') push(out, word, 'type');
      else push(out, word, 'text');
      i = j;
      continue;
    }
    if ('+-*/%=<>!&|^~?:'.includes(src[i])) {
      let j = i + 1;
      while (j < src.length && '+-*/%=<>!&|^~?:'.includes(src[j])) j += 1;
      push(out, src.slice(i, j), 'operator');
      i = j;
      continue;
    }
    if ('{}[](),.;'.includes(src[i])) {
      push(out, src[i], 'punct');
      i += 1;
      continue;
    }
    push(out, src[i], 'text');
    i += 1;
  }
  return out;
}

export function tokenize(src: string, lang: CodeLang): HlToken[] {
  if (lang === 'json') return tokenizeJson(src);
  if (lang === 'html') return tokenizeHtml(src);
  return tokenizeCode(src, lang);
}

export function tokensToLines(tokens: HlToken[]): HlToken[][] {
  const lines: HlToken[][] = [[]];
  tokens.forEach((tok) => {
    const parts = tok.t.split('\n');
    parts.forEach((part, index) => {
      if (index) lines.push([]);
      if (part) lines[lines.length - 1].push({ t: part, k: tok.k });
    });
  });
  return lines;
}

export function prepareCode(raw: string, hinted: string | undefined, prettyJson: boolean) {
  let text = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let lang = detectLang(text, hinted);
  if (prettyJson && lang === 'json') {
    const pretty = tryPrettyJson(text);
    if (pretty) text = pretty;
  }
  const overflow = text.length > MAX_CHARS;
  const head = overflow ? text.slice(0, MAX_CHARS) : text;
  const tokens = tokenize(head, lang);
  if (overflow) tokens.push({ t: text.slice(MAX_CHARS), k: 'text' });
  return { text, lang, tokens, label: LANG_LABEL[lang] };
}
