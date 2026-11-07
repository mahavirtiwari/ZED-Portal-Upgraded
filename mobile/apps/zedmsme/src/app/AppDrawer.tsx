import React, { createContext, useContext, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, Drawer, Icon, sharedIcons, useNavigation, useUi, zedDevice, type IconDefinition } from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useMsme } from './context';

export type DrawerKey = 'dashboard' | 'documents' | 'profile' | 'incentives' | 'pending' | 'history' | 'password';

type DrawerState = { open: boolean; checked: DrawerKey };
const DrawerContext = createContext<{ open: (checked: DrawerKey) => void; state: DrawerState; close: () => void } | null>(null);

/** BaseActivity.setUpDrawer: the navigation drawer (menu/navigation_drawer.xml, header_navigation_drawer.xml). */
export function AppDrawerHost({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<DrawerState>({ open: false, checked: 'dashboard' });
  return (
    <DrawerContext.Provider
      value={{ state, open: checked => setState({ open: true, checked }), close: () => setState(s => ({ ...s, open: false })) }}>
      {children}
    </DrawerContext.Provider>
  );
}

/** The drawer itself, rendered inside the navigator (it navigates). */
export function AppDrawerOverlay() {
  const ctx = useContext(DrawerContext);
  if (!ctx) return null;
  return <AppDrawer open={ctx.state.open} checked={ctx.state.checked} onClose={ctx.close} />;
}

export function useOpenDrawer(checked: DrawerKey) {
  const ctx = useContext(DrawerContext);
  return () => ctx?.open(checked);
}

/**
 * The Edit History item (2026-11-07) in the style of the other menu icons (ic_nav_*: the light grey rounded square, a dark
 * grey glyph): Material "history" centred in the square.
 */
const navEditHistory: IconDefinition = {
  width: 42,
  height: 42,
  viewBox: [0, 0, 42, 42],
  paths: [
    { d: 'M0 8c0-4.42 3.58-8 8-8h26c4.42 0 8 3.58 8 8v26c0 4.42-3.58 8-8 8h-26c-4.42 0-8-3.58-8-8z', fill: colors.lightGrey },
    {
      d: 'M13 3a9 9 0 0 0-9 9H1l3.89 3.89l0.07 0.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7s-3.13 7-7 7c-1.93 0-3.68-0.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0 0 13 21a9 9 0 0 0 0-18zm-1 5v5l4.28 2.54l0.72-1.21l-3.5-2.08V8H12z',
      fill: colors.darkGrey2,
      transform: 'translate(8 9)',
    },
  ],
};

function enterpriseTypeImage(type: string | null | undefined) {
  if (type === 'Micro') return images.ic_micro;
  if (type === 'Small') return images.ic_small;
  if (type === 'Medium') return images.ic_medium;
  return null;
}

function AppDrawer({ open, checked, onClose }: { open: boolean; checked: DrawerKey; onClose: () => void }) {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const details = app.user?.MsmeDetails;
  const typeImage = enterpriseTypeImage(details?.BasicDetails?.EnterpriseTypee);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      checkedKey={checked}
      version={`v${app.versionName}`}
      banner={images.zed_banner}
      largeBanner
      checkedTint={false}
      header={
        <View style={styles.headerBox}>
          {typeImage ? <Image source={typeImage} style={{ margin: dimens.padding1 }} /> : null}
          <Text style={styles.unitName}>{details?.PlantDetails?.UnitName ?? ''}</Text>
          <Pressable
            style={styles.zedId}
            testID="drawer-zed-id"
            onPress={() => {
              zedDevice().setClipboard(details?.ZedId ?? '');
              ui.toast('Copied!', { long: true });
            }}>
            <Text style={styles.zedIdText}>{details?.ZedId ?? ''}</Text>
            <Icon icon={sharedIcons.ic_copy} />
          </Pressable>
        </View>
      }
      items={[
        // item1: goToDashboard()
        { key: 'dashboard', title: 'Dashboard', icon: icons.ic_nav_dashboard, onPress: () => nav.reset([{ name: 'Dashboard' }]) },
        // item2 and item4 (hidden in the Bronze surveillance build).
        { key: 'documents', title: 'My Documents', icon: icons.ic_my_documents, onPress: () => nav.push('MyDocuments') },
        { key: 'profile', title: 'View Profile', icon: icons.ic_nav_my_account, onPress: () => nav.push('MyAccount') },
        // New (2026-11-07): the unit's changes, as the web's Edit History. (Pending Uploads left the menu: sending is automatic.)
        { key: 'history', title: 'Edit History', icon: navEditHistory, onPress: () => nav.push('EditHistory') },
        { key: 'incentives', title: 'Incentives', icon: icons.ic_incentives, onPress: () => nav.push('Incentives') },
        // item5: Utils.composeEmail(arrayOf("zed@qcin.org"), "")
        {
          key: 'contact',
          title: 'Contact ZED',
          icon: icons.ic_nav_contact_zed,
          // As the web's Contact ZED: the contact page (it was a mail to zed@qcin.org in the legacy app).
          onPress: () =>
            app.api
              .contactUrl()
              .then(url => Linking.openURL(url))
              .catch(() => ui.toast('No suitable application found to perform this action')),
        },
        // The profile's Change Password, also here.
        { key: 'password', title: 'Change Password', icon: icons.ic_change_pwd, onPress: () => nav.push('ChangePassword') },
        // item6: logout() -> LauncherActivity with a new task
        { key: 'logout', title: 'Logout', icon: icons.ic_nav_logout, onPress: () => nav.reset([{ name: 'Launcher' }]) },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  headerBox: { backgroundColor: colors.lightGrey, borderRadius: 5, padding: dimens.padding1, marginTop: dimens.padding2 },
  unitName: { margin: dimens.padding1, fontSize: dimens.textSize2, fontWeight: 'bold', color: colors.black },
  zedId: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    margin: dimens.padding1,
    padding: dimens.padding2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.couponBorder,
    borderRadius: 5,
  },
  zedIdText: { fontSize: dimens.textSize2, fontWeight: 'bold', color: colors.black },
});
