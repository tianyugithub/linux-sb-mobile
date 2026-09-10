import { useEffect, useState } from 'react';
import { OFFICIAL_PLUGINS_PATH, ensureOfficialAssets, officialAssets, subscribeOfficialAssets, type OfficialAssets } from '../services/official-assets';
import { linuxAsset } from '../services/live';

/**
 * 读一次官网 `plugins.js`，拿到发帖须知文案 / 表情面板 / 屏蔽设置上限。
 * 只在真正用到的页面（发帖页）调用；结果缓存在 SecureStore（24h），读不到就用内置副本。
 */
export function useOfficialAssets(): OfficialAssets {
  const [state, setState] = useState<OfficialAssets>(officialAssets);
  useEffect(() => subscribeOfficialAssets(() => setState(officialAssets())), []);
  useEffect(() => {
    void ensureOfficialAssets(() => linuxAsset(OFFICIAL_PLUGINS_PATH));
  }, []);
  return state;
}
