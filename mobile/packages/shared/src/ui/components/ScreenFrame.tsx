import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, type ImageSourcePropType, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { headerDate } from '../../util/dates';
import { sharedIcons } from '../sharedIcons';
import { colors, dimens } from '../theme';
import { GradientFill, Icon, type IconDefinition } from './Icon';

export const OFFLINE_NOTE = 'You are offline, don’t forget to Sync your information once you are connected to Internet again.';

/**
 * New in V4: the offline note as the Admin set it (an app wraps its screens with the text it resolved); `null` when
 * the Admin switched it off (no banner).
 */
const OfflineNoteContext = createContext<string | null>(OFFLINE_NOTE);
export const OfflineNoteProvider = OfflineNoteContext.Provider;

/**
 * BaseActivity's layout (activity_base + default_header): status bar in the secondary colour, the gradient header
 * (menu icon, date, title), the red offline note, the grey "BACK ... ZED ID" bar, then the screen content.
 */
export function ScreenFrame({
  title,
  showHeader = true,
  onMenu,
  headerRight,
  offline = false,
  backBar,
  children,
  testID,
}: {
  title: string;
  showHeader?: boolean;
  /** setUpDrawer: the menu icon on the left of the header. */
  onMenu?: () => void;
  headerRight?: React.ReactNode;
  /** handleNetworkNote */
  offline?: boolean;
  /** zed_id_container: BACK on the left (setUpBackNavigation), the ZED ID on the right. */
  backBar?: { zedId?: string | null; onBack?: () => void } | null;
  children: React.ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const offlineNote = useContext(OfflineNoteContext);
  return (
    <View style={styles.root} testID={testID}>
      <StatusBar barStyle="dark-content" />
      <View style={{ height: insets.top, backgroundColor: colors.appColorSecondary }} />
      {showHeader && (
        <View style={styles.header}>
          <GradientFill from={colors.appColor} to={colors.appColorSecondary} angle={90} />
          {onMenu ? (
            <Pressable onPress={onMenu} testID="header-menu" style={{ width: 36, height: 36 }}>
              <Icon icon={sharedIcons.ic_baseline_menu_48} size={36} />
            </Pressable>
          ) : null}
          <View style={styles.headerTexts}>
            <Text style={styles.headerDate}>{headerDate()}</Text>
            <Text style={styles.headerTitle} testID="header-title">
              {title}
            </Text>
          </View>
          {headerRight}
        </View>
      )}
      {offline && offlineNote != null && (
        <View style={styles.offline} testID="offline-note">
          <Icon icon={sharedIcons.ic_offline_cloud} />
          <Text style={styles.offlineText}>{offlineNote}</Text>
        </View>
      )}
      {backBar ? <BackBar zedId={backBar.zedId} onBack={backBar.onBack} /> : null}
      <View style={[styles.content, { paddingBottom: insets.bottom }]}>{children}</View>
    </View>
  );
}

/** The grey bar with "BACK" (ic_back_arrow) and the ZED ID (zed_id_container / MyCertifications header). */
export function BackBar({ zedId, onBack }: { zedId?: string | null; onBack?: () => void }) {
  return (
    <View style={styles.backBar}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton} testID="back-button">
          <Icon icon={sharedIcons.ic_back_arrow} />
          <Text style={styles.backText}>BACK</Text>
        </Pressable>
      ) : (
        <View />
      )}
      <Text style={styles.backText} testID="zed-id">
        {zedId ?? ''}
      </Text>
    </View>
  );
}

export type DrawerItem = { key: string; title: string; icon: IconDefinition; onPress: () => void };

/** NavigationView with header_navigation_drawer, the menu items and the version at the bottom. */
export function Drawer({
  open,
  onClose,
  header,
  items,
  checkedKey,
  version,
  banner,
}: {
  open: boolean;
  onClose: () => void;
  header?: React.ReactNode;
  items: DrawerItem[];
  checkedKey?: string;
  version: string;
  banner?: ImageSourcePropType;
}) {
  const insets = useSafeAreaInsets();
  const x = useRef(new Animated.Value(-300)).current;
  useEffect(() => {
    if (open) Animated.timing(x, { toValue: 0, duration: 200, useNativeDriver: true }).start();
    else x.setValue(-300);
  }, [open, x]);
  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} testID="drawer-scrim" />
      <Animated.View style={[styles.drawer, { paddingTop: insets.top, paddingBottom: insets.bottom, transform: [{ translateX: x }] }]}>
        <ScrollView>
          <View style={styles.drawerHeader}>
            <View style={styles.drawerTop}>
              <Pressable onPress={onClose} testID="drawer-close">
                <Icon icon={sharedIcons.ic_close_dialog} size={36} />
              </Pressable>
              {banner ? <Image source={banner} style={styles.banner} resizeMode="contain" /> : null}
            </View>
            {header}
          </View>
          {items.map(item => {
            const checked = item.key === checkedKey;
            return (
              <Pressable
                key={item.key}
                testID={`drawer-${item.key}`}
                style={[styles.drawerItem, checked && styles.drawerItemChecked]}
                onPress={() => {
                  onClose();
                  if (!checked) setTimeout(item.onPress, 220); // MenuDrawerListener.runWhenIdle
                }}>
                <Icon icon={item.icon} size={24} />
                <Text style={[styles.drawerItemText, checked && { color: colors.appColor }]}>{item.title}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Text style={styles.version}>{version}</Text>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: dimens.padding3,
    elevation: dimens.padding1,
    overflow: 'hidden',
  },
  headerTexts: { flex: 1, paddingStart: dimens.padding2 },
  headerDate: { color: colors.white, fontSize: 12, fontWeight: 'bold' },
  headerTitle: { color: colors.white, fontSize: dimens.textSize3, fontWeight: 'bold' },
  offline: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.ncRed, padding: dimens.padding1 },
  offlineText: { color: colors.white, marginLeft: dimens.padding1, flex: 1, fontSize: dimens.textSize },
  backBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.progressBarColor,
    padding: dimens.padding3,
  },
  backButton: { flexDirection: 'row', alignItems: 'center' },
  backText: { fontSize: dimens.textSize14, fontWeight: 'bold', color: colors.black, marginLeft: dimens.padding1 },
  content: { flex: 1 },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.6)' },
  drawer: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 300, backgroundColor: colors.white, elevation: 16 },
  drawerHeader: { padding: dimens.padding3 },
  drawerTop: { flexDirection: 'row', alignItems: 'center' },
  banner: { flex: 1, height: 64, marginLeft: dimens.padding2 },
  drawerItem: { flexDirection: 'row', alignItems: 'center', height: 48, paddingHorizontal: 16, marginHorizontal: 8, borderRadius: 4 },
  drawerItemChecked: { backgroundColor: 'rgba(69,165,173,0.12)' },
  drawerItemText: { marginLeft: 32, fontSize: 14, fontWeight: '500', color: 'rgba(0,0,0,0.87)' },
  version: { textAlign: 'center', padding: dimens.padding1, color: colors.labelColor, fontSize: dimens.textSize },
});
