import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * 应用是否在前台。循环动画用它做门控：
 * 切到后台时原生动画仍在跑，会白耗电并让页面永远不 idle。
 */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => sub.remove();
  }, []);
  return active;
}
