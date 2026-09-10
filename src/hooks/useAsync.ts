import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import { ApiError } from '../services/client';
import { cacheDelete, cacheGet, cacheSet } from '../services/query-cache';

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], cacheKey?: string) {
  const cached = cacheKey ? cacheGet<T>(cacheKey) : undefined;
  const [data, setDataState] = useState<T | undefined>(cached);
  const [loading, setLoading] = useState(!cached);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const dataRef = useRef<T | undefined>(cached);
  const keyRef = useRef(cacheKey);
  keyRef.current = cacheKey;

  const setData = useCallback((update: SetStateAction<T | undefined>) => {
    setDataState((prev) => {
      const next = typeof update === 'function' ? (update as (value: T | undefined) => T | undefined)(prev) : update;
      dataRef.current = next;
      if (keyRef.current && next !== undefined) cacheSet(keyRef.current, next);
      return next;
    });
  }, []);

  const reload = useCallback((mode: 'replace' | 'refresh' = 'refresh') => {
    const id = ++seq.current;
    const key = cacheKey;
    if (mode === 'replace') {
      const hit = key ? cacheGet<T>(key) : undefined;
      if (hit !== undefined) {
        dataRef.current = hit;
        setDataState(hit);
        setError(null);
        setLoading(false);
      } else {
        dataRef.current = undefined;
        setDataState(undefined);
        setError(null);
        setLoading(true);
      }
    } else if (dataRef.current === undefined) {
      setLoading(true);
    }
    setFetching(true);
    fn()
      .then((result) => {
        if (id !== seq.current) return;
        dataRef.current = result;
        if (key) cacheSet(key, result);
        setDataState(result);
        setError(null);
      })
      .catch((err) => {
        if (id !== seq.current) return;
        setError(err instanceof ApiError ? err.message : '请求失败');
        if (err instanceof ApiError && err.status === 404) {
          dataRef.current = undefined;
          setDataState(undefined);
          if (key) cacheDelete(key);
        }
      })
      .finally(() => {
        if (id !== seq.current) return;
        setLoading(false);
        setFetching(false);
      });
  }, deps);

  useEffect(() => {
    reload('replace');
  }, [reload]);

  return { data, setData, loading, fetching, error, reload: () => reload('refresh') };
}
