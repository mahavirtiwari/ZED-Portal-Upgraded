import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, Icon, ScreenFrame, shapes, textStyles, useNavigation, useRoute, useUi, ZedButton } from '@zed/shared';
import { icons } from '../assets/icons';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { basicDetailsAddress } from '../models';

/** MyAccountActivity ("Enterprise Profile"). The change-password entry is gone/commented out in the legacy build. */
export function MyAccountScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const route = useRoute<{ showProceed?: boolean; hideHeaderMenu?: boolean }>();
  const openDrawer = useOpenDrawer('profile');
  const details = app.user?.MsmeDetails;
  const basic = details?.BasicDetails;
  const address = basic ? basicDetailsAddress(basic) : null;

  const showLocationOnMaps = () => {
    if (!address) ui.showAlert('Invalid Address');
    Linking.openURL('geo:0,0?q=' + String(address).replace(/ /g, '+')).catch(() => ui.showAlert('Failed to load given Address'));
  };

  return (
    <ScreenFrame
      title="Enterprise Profile"
      onMenu={route.params?.hideHeaderMenu ? undefined : openDrawer}
      backBar={{ zedId: details?.ZedId, onBack: () => nav.pop() }}
      testID="my-account">
      <ScrollView>
        <View style={styles.container}>
          <Text style={textStyles.subheading}>Basic Information</Text>
          <View style={shapes.greyOutlineRectangle}>
            <Row label="ZED ID" value={details?.ZedId} />
            <Divider />
            <Row label="Enterprise Name" value={basic?.EnterpriseName} />
          </View>

          <Text style={textStyles.subheading}>Unit Address</Text>
          <View style={shapes.greyOutlineRectangle}>
            <Divider />
            <Row
              label="Unit Address"
              value={address}
              right={<Icon icon={icons.baseline_location_on_24} />}
              onPress={showLocationOnMaps}
            />
            <Divider />
            <Row label="State/UT" value={basic?.state_name} />
            <Divider />
            <Row label="District" value={basic?.DISTRICT_NAME} />
            <Divider />
            <Row label="PIN Code" value={basic?.PINCode} />
          </View>

          <Text style={textStyles.subheading}>Unit SPOC Details</Text>
          <View style={shapes.greyOutlineRectangle}>
            <Divider />
            <Row label="Email ID" value={basic?.EmailId} />
            <Divider />
            <Row label="Mobile No" value={basic?.MobileNo} />
          </View>

          {route.params?.showProceed ? (
            <ZedButton title="Proceed" allCaps={false} textStyle={{ fontSize: 16 }} style={{ marginBottom: 20 }} onPress={() => nav.pop()} testID="profile-proceed" />
          ) : null}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

/** general_row: label (45%) and bold value. */
export function Row({ label, value, right, onPress }: { label: string; value?: string | null; right?: React.ReactNode; onPress?: () => void }) {
  const valueView = (
    <View style={styles.valueBox}>
      <Text style={styles.value}>{value ?? ''}</Text>
      {right}
    </View>
  );
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      {onPress ? (
        <Pressable onPress={onPress} style={{ flex: 55 }}>
          {valueView}
        </Pressable>
      ) : (
        <View style={{ flex: 55 }}>{valueView}</View>
      )}
    </View>
  );
}

const Divider = () => <View style={{ height: 1, backgroundColor: colors.progressBarColor }} />;

const styles = StyleSheet.create({
  container: { margin: dimens.padding2, padding: dimens.padding2, paddingBottom: dimens.padding1 },
  row: { flexDirection: 'row', padding: dimens.padding1 },
  label: { flex: 45, color: colors.labelColor, padding: 5, fontSize: dimens.textSize },
  valueBox: { flexDirection: 'row', alignItems: 'flex-start' },
  value: { flexShrink: 1, fontWeight: 'bold', padding: 5, color: colors.black, fontSize: dimens.textSize },
});
