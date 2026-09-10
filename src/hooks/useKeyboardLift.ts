import { useEffect, useState } from 'react';
import { Keyboard, type KeyboardEvent } from 'react-native';

/**
 * IME height from React Native (ime inset minus system bars).
 * Do not use endCoordinates.screenY: with adjustResize + edge-to-edge,
 * Android reports the screen bottom, not the keyboard top.
 *
 * DidShow/DidHide only. Extra frame events make the column stutter.
 */
let rememberedLift = 0;

function readHeight(event?: KeyboardEvent) {
  return event?.endCoordinates.height ?? Keyboard.metrics()?.height ?? 0;
}

export function useKeyboardLift() {
  const [lift, setLift] = useState(0);

  useEffect(() => {
    const apply = (event?: KeyboardEvent) => {
      const height = readHeight(event);
      const next = height >= 80 ? Math.round(height) : 0;
      if (next > 0) rememberedLift = next;
      setLift(next);
    };
    const show = Keyboard.addListener('keyboardDidShow', apply);
    const hide = Keyboard.addListener('keyboardDidHide', () => setLift(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return {
    lift,
    sync: () => {
      const height = Keyboard.metrics()?.height ?? 0;
      const next = height >= 80 ? Math.round(height) : 0;
      if (next > 0) rememberedLift = next;
      setLift(next);
    },
  };
}
