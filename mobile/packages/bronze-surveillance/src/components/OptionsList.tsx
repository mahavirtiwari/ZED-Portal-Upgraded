import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, dimens, shapes } from '@zed/shared';
import type { Option } from '../models';
import { RequirementVideoButton, requirementVideoUrl } from './RequirementVideoButton';

/**
 * OptionsListHelper.prepareList (CertificationRequirementsFragment.kt): each option in a grey outlined box with the
 * "major.(requirementIndex + 1)" badge, sub-options as bullet lines. 2026-11-08: with the requirement's video (`videoUrl`,
 * set by the Admin) the first box has the play button at its right.
 */
export function OptionsList({
  options,
  major,
  requirementIndex,
  videoUrl,
  code,
}: {
  options: Option[];
  major: string;
  requirementIndex: number;
  videoUrl?: string | null;
  code?: string | null;
}) {
  const video = requirementVideoUrl(videoUrl);
  return (
    <>
      {options.map((option, i) => (
        <View key={`${option.id}-${i}`} style={styles.option}>
          <View style={[styles.box, i === 0 && video ? styles.boxWithVideo : null]}>
            <View style={styles.boxBody}>
              <Text style={styles.text}>{option.label}</Text>
              {(option.subOptions ?? []).map((s, j) => (
                <View key={`${s.id}-${j}`} style={styles.subRow}>
                  <Text style={styles.bullet}>•</Text>
                  <Text style={styles.subText}>{s.label}</Text>
                </View>
              ))}
            </View>
            {i === 0 && video ? <RequirementVideoButton url={video} code={code} style={styles.video} /> : null}
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
  boxWithVideo: { flexDirection: 'row', alignItems: 'flex-start' },
  boxBody: { flexShrink: 1, flexGrow: 1 },
  video: { marginTop: dimens.padding1, marginRight: dimens.padding1 },
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
