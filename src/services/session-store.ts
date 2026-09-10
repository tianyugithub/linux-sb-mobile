import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  restoreSiteSession,
  setSiteSessionPersist,
  type SiteSessionSnapshot,
} from './site-session';

export {
  cookiesForToken,
  createUpstreamSession,
  destroyUpstreamSession,
  rotateUpstreamSession,
  sessionForToken,
  updateUpstreamCookies,
  updateUpstreamUser,
} from './site-session';
export type { UpstreamSession } from './site-session';

const FILE = join(process.cwd(), '.data', 'sessions.json');

function persistDisk(snapshot: SiteSessionSnapshot) {
  mkdirSync(dirname(FILE), { recursive: true });
  writeFileSync(FILE, JSON.stringify(snapshot), { mode: 0o600 });
}

function restoreDisk() {
  if (!existsSync(FILE)) return;
  try {
    const data = JSON.parse(readFileSync(FILE, 'utf8')) as SiteSessionSnapshot;
    restoreSiteSession(data);
  } catch {
    /* ignore corrupt jar */
  }
}

restoreDisk();
setSiteSessionPersist(persistDisk);
