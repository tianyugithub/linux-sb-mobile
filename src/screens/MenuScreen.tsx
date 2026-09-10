import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { menuItems } from '../../data';
import { C } from '../theme/palette';
import { styles } from '../theme/app-styles';
import { useNav } from '../navigation/nav';
import { Icon, ScreenHeader } from '../components/ui';

export function MenuScreen() {
  const nav = useNav();
  return (
    <View style={styles.flex}>
      <ScreenHeader title="菜单" />
      <ScrollView contentContainerStyle={styles.pagePad}>
      {menuItems.map((item) => (
        <Pressable key={item.key} onPress={() => nav.open({ name: item.page })} style={styles.profileCell}>
          <View style={styles.cellIcon}><Icon name={item.icon} size={16} color={C.text} /></View>
          <Text style={styles.cellTitle}>{item.label}</Text>
          <Icon name="chevron-forward" size={16} color={C.dim} />
        </Pressable>
      ))}
      <Text style={styles.profileSectionTitle}>账号</Text>
      {nav.loggedIn ? (
        <Pressable onPress={() => nav.open({ name: 'settings' })} style={styles.profileCell}><View style={styles.cellIcon}><Icon name="settings-outline" size={16} color={C.text} /></View><Text style={styles.cellTitle}>设置</Text><Icon name="chevron-forward" size={16} color={C.dim} /></Pressable>
      ) : (
        <>
          <Pressable onPress={() => nav.open({ name: 'login' })} style={styles.profileCell}><View style={styles.cellIcon}><Icon name="log-in-outline" size={16} color={C.text} /></View><Text style={styles.cellTitle}>登录</Text><Icon name="chevron-forward" size={16} color={C.dim} /></Pressable>
          <Pressable onPress={() => nav.open({ name: 'register' })} style={styles.profileCell}><View style={styles.cellIcon}><Icon name="person-add-outline" size={16} color={C.text} /></View><Text style={styles.cellTitle}>注册</Text><Icon name="chevron-forward" size={16} color={C.dim} /></Pressable>
        </>
      )}
      </ScrollView>
    </View>
  );
}
