import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '../services/client';
import { cacheGet, cacheSet } from '../services/query-cache';

type Page<T> = { items: T[]; nextCursor: string | null };

export function usePagedList<T>(
  loader: (cursor: string | null) => Promise<Page<T>>,
  deps: unknown[],
) {
  const cacheKey = `list:${deps.map((item) => String(item)).join('|')}`;
  const cached = cacheGet<Page<T>>(cacheKey);
  const [items, setItems] = useState<T[]>(cached?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(cached?.nextCursor ?? null);
  const [loading, setLoading] = useState(!cached?.items.length);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(cached?.nextCursor ?? null);
  const itemsRef = useRef<T[]>(cached?.items ?? []);
  const busyRef = useRef(false);
  const genRef = useRef(0);
  const loaderRef = useRef(loader);
  const keyRef = useRef(cacheKey);
  loaderRef.current = loader;
  keyRef.current = cacheKey;
  itemsRef.current = items;

  const load = useCallback(async (mode: 'replace' | 'append' | 'refresh') => {
    if (busyRef.current && mode === 'append') return;
    const gen = mode === 'append' ? genRef.current : genRef.current + 1;
    if (mode !== 'append') genRef.current = gen;
    busyRef.current = true;
    if (mode === 'replace' && !itemsRef.current.length) setLoading(true);
    if (mode === 'refresh') setRefreshing(true);
    if (mode === 'append') setLoadingMore(true);
    try {
      const page = await loaderRef.current(mode === 'append' ? cursorRef.current : null);
      if (gen !== genRef.current) return;
      const nextItems = mode === 'append' ? [...itemsRef.current, ...page.items] : page.items;
      itemsRef.current = nextItems;
      setItems(nextItems);
      cursorRef.current = page.nextCursor;
      setCursor(page.nextCursor);
      setError(null);
      cacheSet(keyRef.current, { items: nextItems, nextCursor: page.nextCursor });
    } catch (err) {
      if (gen !== genRef.current) return;
      setError(err instanceof ApiError ? err.message : '请求失败');
    } finally {
      if (gen !== genRef.current) return;
      busyRef.current = false;
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
    }
  }, []);

  const key = cacheKey;
  useEffect(() => {
    const hit = cacheGet<Page<T>>(key);
    cursorRef.current = hit?.nextCursor ?? null;
    if (hit?.items.length) {
      itemsRef.current = hit.items;
      setItems(hit.items);
      setCursor(hit.nextCursor);
      setLoading(false);
      setError(null);
      load('replace');
      return;
    }
    if (!itemsRef.current.length) {
      itemsRef.current = [];
      setItems([]);
      cursorRef.current = null;
    }
    load('replace');
  }, [load, key]);

  return {
    items,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore: Boolean(cursor),
    reload: () => load('refresh'),
    loadMore: () => {
      if (cursorRef.current) load('append');
    },
  };
}
