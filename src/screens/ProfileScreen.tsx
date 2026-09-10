import React, { useState } from 'react';
import { MineScreen } from './MineScreen';
import { useNav } from '../navigation/nav';

export function ProfileScreen() {
  const nav = useNav();
  const [refreshing, setRefreshing] = useState(false);
  return (
    <MineScreen
      me={nav.me}
      loggedIn={nav.loggedIn}
      checkedIn={nav.checkedIn}
      unread={nav.unread}
      refreshing={refreshing}
      onRefresh={nav.loggedIn ? async () => {
        setRefreshing(true);
        try {
          await nav.refreshMe();
        } finally {
          setRefreshing(false);
        }
      } : undefined}
      onLogin={() => nav.open({ name: 'login' })}
      onSettings={() => nav.open({ name: 'settings' })}
      onUser={() => nav.openUser(nav.me.id)}
      onCheckin={() => nav.open({ name: 'checkin' })}
      onLeaderboard={() => nav.open({ name: 'leaderboard' })}
      onTitles={() => nav.open({ name: 'titles', tab: '称号抽取' })}
      onMyTitles={() => nav.open({ name: 'titles', tab: '我的称号' })}
      onTitlePress={() => nav.open({ name: 'titles', tab: '称号抽取' })}
      onInvite={() => nav.open({ name: 'invite' })}
      onWallet={() => nav.open({ name: 'wallet' })}
      onCollections={() => nav.open({ name: 'collections' })}
      onIdentity={() => nav.open({ name: 'identity' })}
      onMyTopics={() => nav.open({ name: 'my', kind: 'topics' })}
      onMyReplies={() => nav.open({ name: 'my', kind: 'replies' })}
      onInbox={() => nav.open({ name: 'inbox' })}
      onSaved={() => nav.open({ name: 'my', kind: 'saved' })}
      onMessages={() => nav.openTab('messages')}
      onSignOut={() => { void nav.signOut(); }}
    />
  );
}
