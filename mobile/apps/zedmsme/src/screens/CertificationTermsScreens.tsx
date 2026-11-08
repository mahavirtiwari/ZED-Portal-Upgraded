import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  CheckBox,
  colors,
  dimens,
  htmlToPlain,
  Icon,
  isNetworkAvailable,
  ScreenFrame,
  shapes,
  useAppText,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { useMsme } from '../app/context';
import { openDocument } from '../components/documents';
import { certificationDetailsOf, levelName, type CertificationType } from '../models';
import { zedxLevel } from '../levels';
import { EnterpriseCard } from './DashboardScreen';

type Params = { certificationType: CertificationType };

/** "Bronze Certification", or the ZED-X level's own name. */
function useTitle(type: CertificationType): string {
  const app = useMsme();
  return `${levelName(type, type === 'ZEDX' ? zedxLevel(app.levels)?.name : undefined)} Certification`;
}

/**
 * ComplianceFragment ("Undertaking of Compliances"), restored 2026-11-08 at the Admin's request: before Basic Information is
 * filled for the first time, the unit's card and the undertaking (Admin text app.msme.assessment.complianceUndertaking),
 * ACCEPT & PROCEED to the certification requirements. Nothing is sent to the server, as in the old app.
 */
export function ComplianceScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const type = useRoute<Params>().params.certificationType;
  const undertaking = useAppText('app.msme.assessment.complianceUndertaking');
  const title = useTitle(type);
  const msme = app.user?.MsmeDetails;

  return (
    <ScreenFrame title={title} backBar={{ zedId: msme?.ZedId, onBack: () => nav.pop() }} testID="compliance">
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.heading}>Undertaking of Compliances</Text>
        {msme ? <EnterpriseCard details={msme} /> : null}
        <View style={styles.section}>
          <Text style={styles.sectionHead}>Undertaking of Compliances</Text>
          <Text style={styles.body} testID="compliance-text">
            {undertaking ? htmlToPlain(undertaking.html) : ''}
          </Text>
        </View>
        <ZedButton
          title="Accept & Proceed"
          onPress={() => nav.replace('CertificationRequirements', { certificationType: type })}
          testID="compliance-accept"
        />
      </ScrollView>
    </ScreenFrame>
  );
}

/**
 * CertificationRequirementsFragment, restored 2026-11-08: the level's parameters ("1. Leadership" with 1.1, 1.2 ...), Open PDF
 * (the ZED Model and Standard among the guidelines of My Documents), the checkbox (Admin text
 * app.msme.assessment.requirementsAccepted.checkbox) and SUBMIT to Basic Information. Nothing is sent to the server.
 */
export function CertificationRequirementsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<Params>().params.certificationType;
  const details = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
  const checkboxText = useAppText('app.msme.assessment.requirementsAccepted.checkbox');
  const [accepted, setAccepted] = useState(false);
  const title = useTitle(type);
  const zedId = app.user?.MsmeDetails?.ZedId;

  const openPdf = async () => {
    if (!zedId || !(await isNetworkAvailable())) {
      ui.toast('Please connect to the Internet to open the document.', { long: true });
      return;
    }
    ui.showLoading();
    let path: string | null = null;
    let name = 'ZED Model and Standard';
    try {
      const r = await app.api.getMyDocuments(zedId);
      const guidelines = (r.Guidelines ?? []).filter(g => !!g.DocumentPath?.trim());
      const doc = guidelines.find(g => /standard|model/i.test(g.DocumentName ?? '')) ?? guidelines[0];
      if (doc) {
        path = doc.DocumentPath!.trim();
        name = doc.DocumentName ?? name;
      }
    } catch {
      path = null;
    } finally {
      ui.hideLoading();
    }
    if (path) await openDocument(app, ui, path, name);
    else ui.toast('The document is not available right now. Please see My Documents.', { long: true });
  };

  return (
    <ScreenFrame title={title} backBar={{ zedId, onBack: () => nav.pop() }} testID="requirements">
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.heading}>Certification Requirements</Text>
        {(details?.parameters ?? []).map((parameter, p) => {
          const major = String(p + 1);
          return (
            <View key={`${parameter.id}-${p}`} style={styles.section} testID={`requirements-parameter-${p}`}>
              <Text style={styles.sectionHead}>{`${major}. ${parameter.label ?? ''}`}</Text>
              {(parameter.requirements ?? []).map((requirement, r) =>
                (requirement.options ?? []).map((option, o) => (
                  <View key={`${requirement.id}-${o}`} style={styles.option}>
                    <View style={styles.optionBox}>
                      <Text style={styles.optionText}>{option.label}</Text>
                      {(option.subOptions ?? []).map((s, j) => (
                        <View key={`${s.id}-${j}`} style={styles.subRow}>
                          <Text style={styles.optionText}>•</Text>
                          <Text style={[styles.optionText, styles.subText]}>{s.label}</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.badge}>{`${major}.${r + 1}`}</Text>
                  </View>
                )),
              )}
            </View>
          );
        })}
        <Pressable style={styles.pdf} onPress={openPdf} testID="requirements-pdf">
          <Text style={styles.pdfText}>Open PDF</Text>
          <Icon icon={icons.ic_external_link} />
        </Pressable>
        <CheckBox
          label={checkboxText ? htmlToPlain(checkboxText.html) : ''}
          checked={accepted}
          onChange={setAccepted}
          testID="requirements-accept"
        />
        <ZedButton
          title="Submit"
          onPress={() => {
            if (!accepted) {
              ui.toast('Please read and accept the terms');
              return;
            }
            nav.replace('BasicInformation', { certificationType: type });
          }}
          testID="requirements-submit"
        />
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding2, paddingBottom: dimens.padding2 * 4 },
  heading: { fontSize: 22, fontWeight: 'bold', color: colors.black, margin: dimens.padding1, marginBottom: dimens.padding2 },
  section: { ...shapes.greyOutlineRectangle, margin: dimens.padding1, padding: dimens.padding1, marginTop: dimens.padding2 },
  sectionHead: {
    backgroundColor: '#3A3B3D',
    color: colors.white,
    fontSize: 17,
    fontWeight: 'bold',
    paddingHorizontal: dimens.padding2,
    paddingVertical: dimens.padding2,
    borderRadius: 6,
  },
  body: { fontSize: dimens.textSize, color: colors.black, lineHeight: 24, padding: dimens.padding2 },
  option: { paddingBottom: dimens.padding1 },
  optionBox: { ...shapes.greyOutlineRectangle, marginTop: dimens.padding3, marginHorizontal: dimens.padding1, padding: dimens.padding1 },
  optionText: { padding: dimens.padding1, fontSize: dimens.textSize, color: colors.black },
  subRow: { flexDirection: 'row', paddingLeft: dimens.padding2 },
  subText: { flexShrink: 1 },
  badge: {
    position: 'absolute',
    top: 0,
    left: dimens.padding2 * 2,
    backgroundColor: colors.appColor,
    color: colors.white,
    paddingHorizontal: 3,
    fontSize: dimens.textSize14,
    fontWeight: 'bold',
  },
  pdf: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    margin: dimens.padding1,
    marginTop: dimens.padding2 * 2,
    padding: dimens.padding2 * 1.5,
  },
  pdfText: { flex: 1, fontSize: dimens.textSize, color: colors.black },
});
