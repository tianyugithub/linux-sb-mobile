const SECRET = /(sk-[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]+|ghp_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/g;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE = /\b1[3-9]\d{9}\b/g;

export function redactSecrets(text: string): string {
  return text
    .replace(SECRET, '••••••••')
    .replace(EMAIL, '***@***')
    .replace(PHONE, '***********');
}
