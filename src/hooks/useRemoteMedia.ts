import { useEffect, useState } from 'react';
import { cacheRemoteMedia, needsDohMedia, peekCachedMedia } from '../utils/remote-media';

/** 站内图先落到本地再交给 <Image>，避免 Fresco 走被污染的系统 DNS。 */
export function useRemoteMedia(url?: string | null): string | undefined {
  const [uri, setUri] = useState<string | undefined>(() => {
    if (!url) return undefined;
    if (!needsDohMedia(url)) return url;
    return peekCachedMedia(url);
  });
  useEffect(() => {
    if (!url) {
      setUri(undefined);
      return;
    }
    if (!needsDohMedia(url)) {
      setUri(url);
      return;
    }
    const cached = peekCachedMedia(url);
    if (cached) {
      setUri(cached);
      return;
    }
    setUri(undefined);
    let cancelled = false;
    cacheRemoteMedia(url).then(
      (next) => {
        if (!cancelled) setUri(next);
      },
      () => {
        if (!cancelled) setUri(url);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return uri;
}
