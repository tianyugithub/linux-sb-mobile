import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform } from 'react-native';
import { TitlesCenter, type TitleTab } from './TitlesCenter';
import { useKeyboardLift } from '../hooks/useKeyboardLift';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { ScreenHeader } from '../components/ui';

export function TitlesScreen({ initialTab = '称号抽取' }: { initialTab?: TitleTab }) {
  const nav = useNav();
  const kb = useKeyboardLift();
  const [tab, setTab] = useState<TitleTab>(initialTab);
  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);
  return (
    <KeyboardAvoidingView style={[styles.flex, Platform.OS === 'android' ? { paddingBottom: kb.lift } : null]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title={tab} />
      <TitlesCenter
        tab={tab}
        onTab={setTab}
        loggedIn={nav.loggedIn}
        points={nav.me.points}
        toast={nav.toast}
        refreshMe={async (balance) => {
          if (balance && balance > 0) nav.patchMe({ points: balance });
          await nav.refreshMe(balance);
        }}
        openLogin={() => nav.open({ name: 'login' })}
      />
    </KeyboardAvoidingView>
  );
}
