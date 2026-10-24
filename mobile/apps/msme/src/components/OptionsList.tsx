import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, dimens, shapes } from '@zed/shared';
import type { Option } from '../models';

/**
 * OptionsListHelper.prepareList (CertificationRequirementsFragment.kt): each option in a grey outlined box with the
 * "major.(requirementIndex + 1)" badge, sub-options as bullet lines.
 */
export function OptionsList({ options, major, requirementIndex }: { options: Option[]; major: string; requirementIndex: number }) {
  return (
    <>
      {options.map((option, i) => (
        <View key={`${option.id}-${i}`} style={styles.option}>
          <View style={styles.box}>
            <Text style={styles.text}>{option.label}</Text>
            {(option.subOptions ?? []).map((s, j) => (
              <View key={`${s.id}-${j}`} style={styles.subRow}>
                <Text style={styles.bullet}>•</Text>
                <Text style={styles.subText}>{s.label}</Text>
              </View>
            ))}
          </View>
          <Text style={styles.badge}>{`${major}.${requirementIndex + 1}`}</Text>
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  option: { paddingBottom: dimens.padding1 },
  box: { ...shapes.greyOutlineRectangle, marginTop: dimens.padding3, padding: dimens.padding1 },
  text: { padding: dimens.padding2, fontSize: dimens.textSize, color: colors.black },
  badge: {
    position: 'absolute',
    top: 0,
    left: dimens.padding2,
    backgroundColor: colors.appColor,
    color: colors.white,
    paddingHorizontal: 2,
    fontSize: dimens.textSize14,
    fontWeight: 'bold',
  },
  subRow: { flexDirection: 'row', padding: dimens.padding1, paddingLeft: dimens.padding2 * 2 },
  bullet: { fontSize: dimens.textSize, color: colors.black },
  subText: { paddingHorizontal: dimens.padding2, fontSize: dimens.textSize, color: colors.black, flexShrink: 1 },
});
