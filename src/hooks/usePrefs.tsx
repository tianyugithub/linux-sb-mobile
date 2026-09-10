import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useFonts } from 'expo-font';
import {
  FONT_FACTOR,
  getPrefs,
  hydratePrefs,
  patchPrefs,
  subscribePrefs,
  type AppPrefs,
  type CodeFontPref,
  type CodeSizePref,
  type CodeThemePref,
  type FontSizePref,
  type AccessChannelPref,
} from '../services/prefs';
import { applyScheme, type ColorScheme } from '../theme/palette';

type PrefsApi = AppPrefs & {
  fontFactor: number;
  codeFontsReady: boolean;
  setFontSize: (fontSize: FontSizePref) => Promise<void>;
  setPostingNoticeSkip: (postingNoticeSkip: boolean) => Promise<void>;
  /** 首页「每日热帖」区块的展开状态。 */
  setHotTopicsOpen: (hotTopicsOpen: boolean) => Promise<void>;
  /** 官网访问通道：镜像（默认）/ DoH / 直连。 */
  setAccessChannel: (accessChannel: AccessChannelPref) => Promise<void>;
  /** DoH / 直连通道下是否先试 HTTP/3。 */
  setH3First: (h3First: boolean) => Promise<void>;
  /** 插件开关（见 src/plugins/registry.ts）。 */
  setPluginEnabled: (id: string, enabled: boolean) => Promise<void>;
  setScheme: (scheme: ColorScheme) => Promise<void>;
  setCodeTheme: (codeTheme: CodeThemePref) => Promise<void>;
  setCodeFont: (codeFont: CodeFontPref) => Promise<void>;
  setCodeSize: (codeSize: CodeSizePref) => Promise<void>;
  setCodeLineNumbers: (codeLineNumbers: boolean) => Promise<void>;
  setCodeWrap: (codeWrap: boolean) => Promise<void>;
  setCodePrettyJson: (codePrettyJson: boolean) => Promise<void>;
};

const PrefsCtx = createContext<PrefsApi | null>(null);

export function PrefsProvider({ children }: { children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<AppPrefs>(getPrefs);
  const [fontsReady] = useFonts({
    JetBrainsMono: require('../../assets/fonts/JetBrainsMono-Regular.ttf'),
    IBMPlexMono: require('../../assets/fonts/IBMPlexMono-Regular.ttf'),
    FiraCode: require('../../assets/fonts/FiraCode-Regular.ttf'),
  });
  useEffect(() => {
    void hydratePrefs().then(setPrefs);
    return subscribePrefs(() => setPrefs(getPrefs()));
  }, []);
  useEffect(() => {
    applyScheme(prefs.scheme);
  }, [prefs.scheme]);
  const value = useMemo<PrefsApi>(() => ({
    ...prefs,
    fontFactor: FONT_FACTOR[prefs.fontSize],
    codeFontsReady: fontsReady,
    setFontSize: async (fontSize) => {
      await patchPrefs({ fontSize });
    },
    setPostingNoticeSkip: async (postingNoticeSkip) => {
      await patchPrefs({ postingNoticeSkip });
    },
    setHotTopicsOpen: async (hotTopicsOpen) => {
      await patchPrefs({ hotTopicsOpen });
    },
    setH3First: async (h3First) => {
      await patchPrefs({ h3First });
    },
    setAccessChannel: async (accessChannel: AccessChannelPref) => {
      const { bustLiveCache } = await import('../services/live');
      bustLiveCache();
      await patchPrefs({ accessChannel });
    },
    setPluginEnabled: async (id, enabled) => {
      await patchPrefs({ plugins: { ...prefs.plugins, [id]: enabled } });
    },
    setScheme: async (scheme) => {
      applyScheme(scheme);
      await patchPrefs({ scheme });
    },
    setCodeTheme: async (codeTheme) => {
      await patchPrefs({ codeTheme });
    },
    setCodeFont: async (codeFont) => {
      await patchPrefs({ codeFont });
    },
    setCodeSize: async (codeSize) => {
      await patchPrefs({ codeSize });
    },
    setCodeLineNumbers: async (codeLineNumbers) => {
      await patchPrefs({ codeLineNumbers });
    },
    setCodeWrap: async (codeWrap) => {
      await patchPrefs({ codeWrap });
    },
    setCodePrettyJson: async (codePrettyJson) => {
      await patchPrefs({ codePrettyJson });
    },
  }), [prefs, fontsReady]);
  return <PrefsCtx.Provider value={value}>{children}</PrefsCtx.Provider>;
}

export function usePrefs() {
  const ctx = useContext(PrefsCtx);
  if (!ctx) throw new Error('Prefs missing');
  return ctx;
}
