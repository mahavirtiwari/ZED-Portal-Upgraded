import React, { createContext, useContext, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, Drawer, Icon, sharedIcons, useNavigation, useUi, zedDevice } from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useMsme } from './context';

export type DrawerKey = 'dashboard' | 'profile' | 'pending';

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
        // item2 My Documents and item4 Incentives are android:visible="false" in the legacy menu.
        { key: 'profile', title: 'View Profile', icon: icons.ic_nav_my_account, onPress: () => nav.push('MyAccount') },
        // New: what is waiting to be sent (the legacy app had no such list).
        { key: 'pending', title: 'Pending Uploads', icon: icons.ic_upload, onPress: () => nav.push('PendingUploads') },
        // item5: Utils.composeEmail(arrayOf("zed@qcin.org"), "")
        {
          key: 'contact',
          title: 'Contact ZED',
          icon: icons.ic_nav_contact_zed,
          onPress: () => Linking.openURL('mailto:zed@qcin.org').catch(() => ui.toast('No suitable application found to perform this action')),
        },
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
