import Ionicons from '@expo/vector-icons/Ionicons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConfigProvider } from '@nutui/nutui-react-native';
import type { ForumBoard, IonName } from '../../data';
import { ContentSkeleton } from '../components/ContentSkeleton';
import { useAsync } from '../hooks/useAsync';
import { api, mapForum } from '../services/api';
import { subscribeForums } from '../services/live';
import { C, registerStyleSync, type Palette } from '../theme/palette';
import { nutThemeFor } from '../theme/nut-mine';
import { forumHasDot, hydrateForumSeen, markForumSeen } from '../utils/forum-seen';

const GROUP_ORDER = ['官方', '交流', '发现'] as const;

function tone(accent: string) {
  const hex = accent?.startsWith('#') ? accent : '#6FA8FF';
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16) || 111;
  const g = parseInt(n.slice(2, 4), 16) || 168;
  const b = parseInt(n.slice(4, 6), 16) || 255;
  return { bg: `rgba(${r},${g},${b},0.12)`, fg: hex };
}

function fmt(n: number) {
  if (n >= 10000) {
    const wan = n / 10000;
    const text = wan >= 10 ? wan.toFixed(0) : wan.toFixed(1).replace(/\.0$/, '');
    return `${text}万`;
  }
  return String(n);
}

function Glyph({ name, accent, size = 44 }: { name: IonName; accent: string; size?: number }) {
  const { bg, fg } = tone(accent);
  return (
    <View style={[styles.glyph, { width: size, height: size, borderRadius: 12, backgroundColor: bg }]}>
      <Ionicons name={name} size={Math.round(size * 0.5)} color={fg} />
    </View>
  );
}

function SearchPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.searchPill, pressed && styles.pressed]}>
      <Ionicons name="search" size={16} color={C.dim} />
      <Text style={styles.searchPlaceholder}>搜索版块、帖子</Text>
    </Pressable>
  );
}

function StatStrip({ boards }: { boards: ForumBoard[] }) {
  const topics = boards.reduce((sum, item) => sum + item.topics, 0);
  const today = boards.reduce((sum, item) => sum + item.today, 0);
  const items = [
    { value: fmt(boards.length), label: '版块' },
    { value: fmt(topics), label: '主题' },
    { value: fmt(today), label: '今日' },
  ];
  return (
    <View style={styles.stats}>
      {items.map((item, index) => (
        <View key={item.label} style={[styles.stat, index > 0 && styles.statSplit]}>
          <Text style={styles.statValue}>{item.value}</Text>
          <Text style={styles.statLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function SectionHead({ title, extra }: { title: string; extra?: string }) {
  return (
    <View style={styles.sectionHead}>
      <View style={styles.sectionBar} />
      <Text style={styles.sectionTitle}>{title}</Text>
      {extra ? <Text style={styles.sectionExtra}>{extra}</Text> : null}
    </View>
  );
}

function BoardRow({ board, last, onPress }: { board: ForumBoard; last?: boolean; onPress: () => void }) {
  const fresh = forumHasDot(board);
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, last && styles.rowLast, pressed && styles.pressed]}>
      <View>
        <Glyph name={board.icon} accent={board.accent} />
        {fresh ? <View style={styles.hotDot} /> : null}
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text numberOfLines={1} style={styles.rowName}>{board.name}</Text>
          <Text style={styles.rowCount}>{fmt(board.topics)}</Text>
        </View>
        {board.desc ? <Text numberOfLines={1} style={styles.rowDesc}>{board.desc}</Text> : null}
        {board.latest ? <Text numberOfLines={1} style={styles.rowLatest}>{board.latest}</Text> : null}
        <Text numberOfLines={1} style={styles.rowMeta}>
          {fmt(board.topics)} 主题
          {board.today > 0 ? ` · 今 ${fmt(board.today)}` : ''}
          {board.latestTime ? ` · ${board.latestTime}` : ''}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={14} color={C.dim} />
    </Pressable>
  );
}

function BoardGrid({ boards, onOpen }: { boards: ForumBoard[]; onOpen: (board: ForumBoard) => void }) {
  return (
    <View style={styles.grid}>
      {boards.map((board) => (
        <Pressable
          key={board.name}
          onPress={() => onOpen(board)}
          style={({ pressed }) => [styles.gridItem, pressed && styles.pressed]}
        >
          <View>
            <Glyph name={board.icon} accent={board.accent} size={40} />
            {forumHasDot(board) ? <View style={styles.hotDot} /> : null}
          </View>
          <Text numberOfLines={1} style={styles.gridName}>{board.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ForumsBody({
  onOpenForum,
  onSearch,
}: {
  onOpenForum: (forum: string) => void;
  onSearch: () => void;
}) {
  const query = useAsync(() => api.forums().then((result) => result.items.map(mapForum)), [], 'forums:boards');
  const boards = query.data ?? [];
  const [rail, setRail] = useState('全部');
  const [, setSeenRev] = useState(0);

  useEffect(() => {
    void hydrateForumSeen().then(() => setSeenRev((value) => value + 1));
  }, []);

  useEffect(() => subscribeForums((items) => {
    query.setData(items.map(mapForum));
  }), [query.setData]);

  const openBoard = (board: ForumBoard) => {
    markForumSeen(board);
    setSeenRev((value) => value + 1);
    onOpenForum(board.name);
  };

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const extra: string[] = [];
    for (const board of boards) {
      if (!GROUP_ORDER.includes(board.group as typeof GROUP_ORDER[number]) && !seen.has(board.group)) {
        seen.add(board.group);
        extra.push(board.group);
      }
    }
    return [...GROUP_ORDER.filter((group) => !boards.length || boards.some((item) => item.group === group)), ...extra];
  }, [boards]);

  const rails = ['全部', ...groups];
  const active = rails.includes(rail) ? rail : '全部';
  const visible = active === '全部' ? boards : boards.filter((item) => item.group === active);

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <Text style={styles.pageTitle}>版块</Text>
        <SearchPill onPress={onSearch} />
      </View>
      <View style={styles.body}>
        <View style={styles.rail}>
          {rails.map((item) => {
            const on = item === active;
            const count = item === '全部' ? boards.length : boards.filter((board) => board.group === item).length;
            return (
              <Pressable key={item} onPress={() => setRail(item)} style={[styles.railItem, on && styles.railItemOn]}>
                {on ? <View style={styles.railMark} /> : null}
                <Text style={[styles.railText, on && styles.railTextOn]}>{item}</Text>
                {count > 0 ? <Text style={styles.railCount}>{count}</Text> : null}
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          style={styles.main}
          contentContainerStyle={styles.mainContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={Boolean(query.fetching && boards.length)}
              onRefresh={query.reload}
              tintColor={C.red}
              colors={[C.red]}
            />
          }
        >
          {query.loading && !boards.length ? <ContentSkeleton /> : null}
          {query.error && !boards.length ? (
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>{query.error}</Text>
              <Pressable onPress={query.reload} style={styles.retry}>
                <Text style={styles.retryText}>重试</Text>
              </Pressable>
            </View>
          ) : null}
          {boards.length && active === '全部' ? (
            <>
              <StatStrip boards={boards} />
              <View style={styles.card}>
                <SectionHead title="快捷入口" extra="点图标直达" />
                <BoardGrid boards={boards} onOpen={openBoard} />
              </View>
              {groups.map((group) => {
                const rows = boards.filter((item) => item.group === group);
                if (!rows.length) return null;
                return (
                  <View key={group} style={styles.card}>
                    <SectionHead title={group} extra={`${rows.length} 个`} />
                    {rows.map((board, index) => (
                      <BoardRow
                        key={board.name}
                        board={board}
                        last={index === rows.length - 1}
                        onPress={() => openBoard(board)}
                      />
                    ))}
                  </View>
                );
              })}
            </>
          ) : null}
          {boards.length && active !== '全部' ? (
            <>
              <StatStrip boards={visible} />
              <View style={styles.card}>
              <SectionHead title={active} extra={`${visible.length} 个`} />
              {visible.length ? visible.map((board, index) => (
                <BoardRow
                  key={board.name}
                  board={board}
                  last={index === visible.length - 1}
                  onPress={() => openBoard(board)}
                />
              )) : (
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>这个分类还没有版块</Text>
                </View>
              )}
              </View>
            </>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}

export function ForumsScreen(props: { onOpenForum: (forum: string) => void; onSearch: () => void }) {
  return (
    <ConfigProvider theme={nutThemeFor(C.scheme)}>
      <ForumsBody {...props} />
    </ConfigProvider>
  );
}

function createForumStyles(C: Palette) {
  return StyleSheet.create({
  page: { flex: 1, backgroundColor: C.canvas },
  header: {
    height: 48,
    paddingLeft: 16,
    paddingRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTitle: { color: C.text, fontSize: 20, fontWeight: '800' },
  searchPill: {
    flex: 1,
    height: 32,
    borderRadius: 16,
    backgroundColor: C.searchPill,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  searchPlaceholder: { color: C.dim, fontSize: 13 },
  body: { flex: 1, flexDirection: 'row' },
  rail: { width: 72, backgroundColor: C.rail },
  railItem: {
    minHeight: 48,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    justifyContent: 'center',
  },
  railItemOn: { backgroundColor: C.canvas },
  railMark: {
    position: 'absolute',
    left: 0,
    top: 16,
    bottom: 16,
    width: 2,
    borderRadius: 1,
    backgroundColor: C.red,
  },
  railText: { color: C.dim, fontSize: 13, fontWeight: '500' },
  railTextOn: { color: C.red, fontWeight: '800' },
  railCount: { color: C.dim, fontSize: 10, marginTop: 2 },
  main: { flex: 1, backgroundColor: C.canvas },
  mainContent: { padding: 10, paddingBottom: 28, gap: 8 },
  stats: {
    flexDirection: 'row',
    backgroundColor: C.card,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  stat: { flex: 1, alignItems: 'center', paddingVertical: 10 },
  statSplit: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: C.line },
  statValue: { color: C.muted, fontSize: 15, fontWeight: '700' },
  statLabel: { color: C.dim, fontSize: 10, marginTop: 3 },
  card: {
    backgroundColor: C.card,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: C.line,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 4,
    gap: 6,
  },
  sectionBar: { width: 2, height: 10, borderRadius: 1, backgroundColor: C.red },
  sectionTitle: { color: C.text, fontSize: 13, fontWeight: '800', flex: 1 },
  sectionExtra: { color: C.dim, fontSize: 10 },
  glyph: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingBottom: 8, paddingHorizontal: 2 },
  gridItem: { width: '25%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 2, gap: 5 },
  gridName: { color: C.muted, fontSize: 11, fontWeight: '600', width: '100%', textAlign: 'center' },
  hotDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: C.red,
    borderWidth: 1.5,
    borderColor: C.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: C.line,
  },
  rowLast: { borderBottomWidth: 0 },
  rowBody: { flex: 1, minWidth: 0, gap: 2 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  rowName: { color: C.text, fontSize: 15, fontWeight: '800', flex: 1, minWidth: 0 },
  rowCount: { color: C.dim, fontSize: 11, fontWeight: '500' },
  rowDesc: { color: C.muted, fontSize: 12, lineHeight: 17 },
  rowLatest: { color: C.dim, fontSize: 11, lineHeight: 16 },
  rowMeta: { color: C.dim, fontSize: 10 },
  empty: { alignItems: 'center', paddingVertical: 36, gap: 10 },
  emptyTitle: { color: C.muted, fontSize: 13 },
  retry: { height: 32, paddingHorizontal: 16, borderRadius: 6, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  pressed: { opacity: 0.72 },
  });
}

let styles = createForumStyles(C);
registerStyleSync(() => {
  styles = createForumStyles(C);
});
