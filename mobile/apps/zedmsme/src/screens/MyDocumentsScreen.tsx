import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, dimens, errorOf, Icon, isSuccess, ScreenFrame, textStyles, useNavigation, useUi } from '@zed/shared';
import type { CertificateLinks, DocumentsResponse, GuidelineDocument } from '../api';
import { icons } from '../assets/icons';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { openDocument } from '../components/documents';

/** The certificate rows of My Documents, in order, each shown only when its link is there. */
const CERTIFICATES: [keyof CertificateLinks, string][] = [
  ['Pledge', 'Pledge Certificate'],
  ['Bronze', 'Bronze Certificate'],
  ['Silver', 'Silver Certificate'],
  ['Gold', 'Gold Certificate'],
  ['ZEDX', 'ZED-X Certificate'],
  ['Wash', 'WASH Certificate'],
  ['Webinar', 'Webinar Participation Certificate'],
];

/** MyDocumentsActivity: the guidelines and the unit's certificates (GetMyDocuments); payment receipts are not listed. */
export function MyDocumentsScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('documents');
  const [answer, setAnswer] = useState<DocumentsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const zedId = app.user?.MsmeDetails?.ZedId ?? app.loginId;
    if (!zedId) return;
    setError(null);
    try {
      const r = await app.api.getMyDocuments(zedId);
      // The old service answered the lists without a status; a status other than "1" is an error only when set.
      if (r.status != null && !isSuccess(r)) setError(errorOf(r));
      setAnswer(r);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'Unknown Error Occurred');
      setAnswer({ status: '0' });
    }
  }, [app]);

  useEffect(() => {
    load();
  }, [load]);

  const guidelines = [...(answer?.Guidelines ?? [])].sort((a, b) => Number(a.OrderNo ?? 0) - Number(b.OrderNo ?? 0));
  const certificates = answer?.Certificates?.[0] ?? null;
  const certificateRows = CERTIFICATES.filter(([key]) => !!certificates?.[key]?.trim());

  return (
    <ScreenFrame title="My Documents" onMenu={openDrawer} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="my-documents">
      {answer == null ? (
        <ActivityIndicator style={{ marginTop: dimens.padding4 }} color={colors.appColor} />
      ) : (
        <ScrollView contentContainerStyle={styles.page}>
          {error ? (
            <Pressable onPress={load} testID="documents-retry">
              <Text style={styles.error}>{error} (tap to try again)</Text>
            </Pressable>
          ) : null}
          {guidelines.length > 0 ? (
            <View>
              <Text style={styles.heading}>Guidelines</Text>
              {guidelines.map((g: GuidelineDocument, i) => (
                <DocumentRow
                  key={`g-${i}`}
                  icon={icons.ic_doc_guidelines}
                  name={g.DocumentName ?? ''}
                  disabled={!g.DocumentPath?.trim()}
                  onPress={() => openDocument(app, ui, g.DocumentPath!.trim(), g.DocumentName ?? 'Document')}
                  testID={`guideline-${i}`}
                />
              ))}
            </View>
          ) : null}
          {certificateRows.length > 0 ? (
            <View>
              <Text style={styles.heading}>Certificates</Text>
              {certificateRows.map(([key, name]) => (
                <DocumentRow
                  key={key}
                  icon={icons.ic_doc_certificates}
                  name={name}
                  onPress={() => openDocument(app, ui, key === 'Pledge' ? 'pledge' : certificates![key]!.trim(), name)}
                  testID={`certificate-${key}`}
                />
              ))}
            </View>
          ) : null}
          {!error && guidelines.length === 0 && certificateRows.length === 0 ? <Text style={styles.empty}>No documents yet.</Text> : null}
        </ScrollView>
      )}
    </ScreenFrame>
  );
}

function DocumentRow({
  icon,
  name,
  disabled,
  onPress,
  testID,
}: {
  icon: (typeof icons)[keyof typeof icons];
  name: string;
  disabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable style={[styles.row, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} testID={testID}>
      <Icon icon={icon} />
      <Text style={styles.name}>{name}</Text>
      <Icon icon={icons.ic_doc_download} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  page: { padding: dimens.padding2, backgroundColor: colors.white, flexGrow: 1 },
  // @style/TextSubheading
  heading: { ...textStyles.subheading, marginTop: dimens.padding2 },
  // layout_clickable_option: the grey_2 box
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: dimens.padding2,
    padding: dimens.padding2,
    backgroundColor: colors.lightGrey2,
    borderRadius: 5,
  },
  name: { flex: 1, marginHorizontal: dimens.padding2, color: colors.black, fontSize: dimens.textSize },
  error: { color: colors.error, padding: dimens.padding2 },
  empty: { color: colors.labelColor, padding: dimens.padding3, textAlign: 'center' },
});
