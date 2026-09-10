export function formatRelative(iso: string, now = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, now - then);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < 45 * 1000) return '刚刚';
  if (diff < hour) return `${Math.max(1, Math.round(diff / minute))}分钟前`;
  if (diff < day) return `${Math.max(1, Math.round(diff / hour))}小时前`;
  if (diff < 2 * day) return '昨天';
  if (diff < 7 * day) return `${Math.round(diff / day)}天前`;
  return new Date(iso).toISOString().slice(0, 10);
}

export function parseRelativeToIso(label: string, now = Date.now()): string {
  const compact = label.replace(/\s+/g, '').replace(/<[^>]+>/g, '').trim();
  if (!compact) return new Date(now).toISOString();
  if (compact === '刚刚') return new Date(now - 30 * 1000).toISOString();
  if (compact === '昨天') return new Date(now - 20 * 60 * 60 * 1000).toISOString();
  if (compact === '前天') return new Date(now - 40 * 60 * 60 * 1000).toISOString();
  const minute = compact.match(/^(\d+)分钟前$/);
  if (minute) return new Date(now - Number(minute[1]) * 60 * 1000).toISOString();
  const hour = compact.match(/^(\d+)小时前$/);
  if (hour) return new Date(now - Number(hour[1]) * 60 * 60 * 1000).toISOString();
  const day = compact.match(/^(\d+)天前$/);
  if (day) return new Date(now - Number(day[1]) * 24 * 60 * 60 * 1000).toISOString();
  const week = compact.match(/^(\d+)周前$/);
  if (week) return new Date(now - Number(week[1]) * 7 * 24 * 60 * 60 * 1000).toISOString();
  const month = compact.match(/^(\d+)个?月前$/);
  if (month) return new Date(now - Number(month[1]) * 30 * 24 * 60 * 60 * 1000).toISOString();
  if (/^\d{4}-\d{2}-\d{2}/.test(compact)) return new Date(`${compact.slice(0, 10)}T12:00:00+08:00`).toISOString();
  return new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString();
}

export function requestId(): string {
  return `lsb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
