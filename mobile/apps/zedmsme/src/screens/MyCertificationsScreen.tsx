import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import {
  BackBar,
  colors,
  dimens,
  errorOf,
  formatDate,
  isNetworkAvailable,
  isSuccess,
  OutlinedButton,
  parseLegacyDate,
  ScreenFrame,
  shapes,
  htmlToPlain,
  useAppText,
  useFocusEffect,
  useNavigation,
  useUi,
  ZedDialog,
} from '@zed/shared';
import type { CertificationStatusResponse, PublicLevel } from '../api';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { certificationStatus, CertificationStatusDialog, type CertificationStatus } from '../components/CertificationStatusDialog';
import { openDocument } from '../components/documents';
import { SyncAllButton } from '../components/SyncAllButton';
import {
  certificationDetailsOf,
  isDesktopLevel,
  isLegacyLevel,
  levelName,
  sameLevel,
  type BuiltInLevel,
  type CertificationType,
  type MsmeStatus,
} from '../models';
import { addedLevels, levelDisplayName, publicLevel, showZedx, v4LevelImage, zedxLevel } from '../levels';
import { DarkHeading } from '../ui/legacy';
import { refreshStatus, useCertificationClick } from './DashboardScreen';

/** showCertificationInfo: the level's two lines (donottranslate.xml bronze_info_one ... gold_info_two); ZED-X's from the Admin. */
const LEVEL_INFO: Record<Exclude<BuiltInLevel, 'ZEDX'>, { title: string; lines: [string, string] }> = {
  Bronze: {
    title: 'Bronze Certification',
    lines: [
      'This level has 5 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 10,000/- inclusive of taxes, subsidy, as applicable.',
    ],
  },
  Silver: {
    title: 'Silver Certification',
    lines: [
      'This level has 14 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 40,000/- inclusive of taxes; subsidy, as applicable.',
    ],
  },
  Gold: {
    title: 'Gold Certification',
    lines: [
      'This level has 20 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 90,000/- inclusive of taxes; subsidy, as applicable.',
    ],
  },
};

/** ZED-X's title strip: the web's ZED-X panel colour (the app colour itself is unchanged); the levels the Admin added too. */
export const ZEDX_COLOR = '#3F8F96';

type LevelCard = { type: CertificationType; title: string; color: string; image: ImageSourcePropType };

const LEVELS: LevelCard[] = [
  { type: 'Bronze', title: 'BRONZE CERTIFICATION', color: colors.bronze, image: images.bronze },
  { type: 'Silver', title: 'SILVER CERTIFICATION', color: colors.silver, image: images.silver },
  { type: 'Gold', title: 'GOLD CERTIFICATION', color: colors.gold, image: images.gold },
];

/**
 * The cards of the screen: Bronze, Silver, Gold and, when shown, ZED-X with the Admin's name and logo; then (2026-11-08)
 * every level the Admin added, by ZED-X's rule (enabled, or paid for), with its name and logo.
 */
export function levelCards(
  levels: PublicLevel[] | null | undefined,
  status: MsmeStatus | null | undefined,
  logoUrl: (url: string) => string,
): LevelCard[] {
  // 2026-11-08: Bronze / Silver / Gold with the Admin's name and logo (Certification Levels), and not a level the Admin disabled
  // unless the unit has started it. A list without any of the three (an older answer) leaves them as they are.
  const listsBuiltIn = !!levels?.some(l => LEVELS.some(b => b.type.toLowerCase() === l.code.toLowerCase()));
  const builtIn = LEVELS.flatMap(card => {
    const admin = levels?.find(l => l.code.toLowerCase() === card.type.toLowerCase());
    const started = (certificationDetailsOf(status, card.type)?.status ?? 0) > 0;
    if (listsBuiltIn && !admin && !started) return [];
    return [{
      ...card,
      title: admin?.name ? `${admin.name} CERTIFICATION`.toUpperCase() : card.title,
      image: admin?.logoUrl ? { uri: logoUrl(admin.logoUrl) } : card.image,
    }];
  });
  const zedx = zedxLevel(levels);
  const zedxCard: LevelCard[] = showZedx(levels, status)
    ? [{ type: 'ZEDX', title: `${levelName('ZEDX', zedx?.name)} CERTIFICATION`.toUpperCase(), color: ZEDX_COLOR, image: v4LevelImage('ZEDX', levels, logoUrl) }]
    : [];
  const added: LevelCard[] = addedLevels(levels, status).map(l => ({
    type: l.code,
    title: `${l.name} CERTIFICATION`.toUpperCase(),
    color: ZEDX_COLOR,
    image: v4LevelImage(l.code, levels, logoUrl),
  }));
  return [...builtIn, ...zedxCard, ...added];
}

/** MyCertificationsFragment ("ZED Certifications"): Bronze, Silver, Gold (and ZED-X), then the ZED Pledge Certificate. */
export function MyCertificationsScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('dashboard');
  const onCertificationClick = useCertificationClick();
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  // MsmeDetails.getFormattedPledgeDate: "MMM dd, yyyy"; nothing when the date cannot be read.
  const pledgeDate = formatPledgeDate(app.user?.MsmeDetails?.DateOfPledge);
  const [info, setInfo] = useState<CertificationType | null>(null);
  const [statusOf, setStatusOf] = useState<{ level: CertificationType; status: CertificationStatus } | null>(null);

  const openStatus = async (level: CertificationType) => {
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    ui.showLoading();
    let r: CertificationStatusResponse;
    try {
      r = await app.api.getCertificationStatus(level);
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r) && r.steps) setStatusOf({ level, status: certificationStatus(level, r.steps, isDesktopLevel(level, status)) });
    else ui.toast(errorOf(r), { long: true });
  };
  useFocusEffect(
    useCallback(() => {
      void refreshStatus(app).catch(() => undefined);
      void app.refreshLevels();
    }, [app]),
  );
  const cards = levelCards(app.levels, status, url => app.api.levelLogoUrl(url));

  return (
    <ScreenFrame title="ZED Certifications" onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {cards.map(level => {
            const details = certificationDetailsOf(status, level.type);
            const action = certificationAction(status, level.type);
            // setCertificationStatus is only called when the details exist; otherwise the card keeps its defaults.
            // ZED-X (and a level the Admin added) may have no details yet (left out by servers that cannot read it): greyed out
            // all the same when it cannot be applied for. A desktop level the Admin added has Bronze's steps.
            const state = certificationCardState(details, isDesktopLevel(level.type, status), (details != null || !isLegacyLevel(level.type)) && action === 'none');
            return (
              <CertificationCard
                key={level.type}
                title={level.title}
                titleColor={level.color}
                image={level.image}
                action={action}
                state={state}
                onApply={() => nav.push('Payment', { certificationType: level.type })}
                onOpen={() => onCertificationClick(level.type)}
                onInfo={() => setInfo(level.type)}
                // VIEW DETAILS: once the level has started (the card past Get Started).
                onDetails={details != null && action !== 'apply' && state.statusText !== 'Get Started' ? () => openStatus(level.type) : null}
                testID={`${level.type.toLowerCase()}-card`}
              />
            );
          })}
          <View style={{ marginHorizontal: dimens.padding2 }}>
            <DarkHeading title="ZED Pledge Certificate" />
          </View>
          <View style={styles.pledgeBox}>
            {pledgeDate ? <Text style={styles.pledgeDate}>Pledge taken on {pledgeDate}</Text> : null}
            <OutlinedButton title="Download" color={colors.darkGrey} onPress={() => openDocument(app, ui, 'pledge', 'Pledge Certificate')} testID="pledge-download" />
          </View>
        </ScrollView>
      </View>
      {info ? (
        <CertificationInfoDialog type={info} zedx={publicLevel(app.levels, info)} name={levelDisplayName(info, app.levels, status)} onClose={() => setInfo(null)} />
      ) : null}
      {statusOf ? (
        <CertificationStatusDialog
          level={statusOf.level}
          name={levelDisplayName(statusOf.level, app.levels, status)}
          status={statusOf.status}
          onClose={() => setStatusOf(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

/**
 * dialog_certification_info: the level's title and its bullet lines. 2026-11-08: Bronze / Silver / Gold from the Admin texts
 * app.msme.dashboard.levelInfo.* (the built-in lines until they arrive; none when the Admin hid the text).
 */
function CertificationInfoDialog({
  type,
  zedx,
  name,
  onClose,
}: {
  type: CertificationType;
  zedx: PublicLevel | null;
  name?: string | null;
  onClose: () => void;
}) {
  const adminText = useAppText(`app.msme.dashboard.levelInfo.${type.toLowerCase()}`);
  const { title, lines: builtInLines } = levelInfo(type, zedx, name);
  const lines = !isLegacyLevel(type) ? builtInLines : adminText ? textLines(adminText.html) : [];
  return (
    <ZedDialog visible title={title} onClose={onClose} testID="certification-info">
      {lines.map(line => (
        <View key={line} style={styles.infoLine}>
          <Text style={styles.infoText}>{'•'}</Text>
          <Text style={[styles.infoText, { flex: 1, paddingHorizontal: dimens.padding2 }]}>{line}</Text>
        </View>
      ))}
    </ZedDialog>
  );
}

/** An Admin text's bullet points (its <li>s), or the whole text as one line. */
export function textLines(html: string): string[] {
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => htmlToPlain(m[1] ?? '').trim()).filter(l => l.length > 0);
  if (items.length > 0) return items;
  const plain = htmlToPlain(html).trim();
  return plain ? [plain] : [];
}

/**
 * The info dialog's title and lines: the built-in ones, or the description and comment of ZED-X (or of a level the Admin
 * added; `level` is that level from the enabled list) as the Admin wrote them.
 */
export function levelInfo(type: CertificationType, level: PublicLevel | null, name?: string | null): { title: string; lines: string[] } {
  if (type === 'Bronze' || type === 'Silver' || type === 'Gold') return LEVEL_INFO[type as Exclude<BuiltInLevel, 'ZEDX'>];
  const lines = [level?.description, level?.comment].map(l => l?.trim() ?? '').filter(l => l.length > 0);
  return { title: `${levelName(type, level?.name || name)} Certification`, lines };
}

/** DateOfPledge ("MM/dd/yyyy hh:mm:ss a") as "MMM dd, yyyy"; '' when it cannot be read. */
export function formatPledgeDate(value: string | null | undefined): string {
  const d = parseLegacyDate(value);
  return d ? formatDate(d, 'MMM dd, yyyy') : '';
}

/**
 * handleCertificationAction: APPLY when the level has no details or all three are inactive; the arrow for status 1-4;
 * for status 0, Silver and Gold may be applied for when the levels below allow it; otherwise nothing.
 * New in V4, ZED-X as the web dashboard (and the server, Certifications.BlockedBy): ZED-X and Bronze / Silver / Gold never
 * run at once. ZED-X cannot be applied for while one of the three is in progress, and once ZED-X is paid the three that
 * have not started are greyed out.
 * 2026-11-08 (generic levels): every level the Admin added as ZED-X; a V4 level also waits while another V4 level is in
 * progress (the server's rule).
 */
export function certificationAction(status: MsmeStatus | null, type: CertificationType): 'apply' | 'arrow' | 'none' {
  const details = certificationDetailsOf(status, type);
  const of = (t: CertificationType) => certificationDetailsOf(status, t)?.status;
  // In progress: paid and not yet certified (Bronze and the desktop levels 1-2, Silver, Gold and the site levels 1-3).
  const inProgress = (t: CertificationType) => {
    const v = of(t) ?? 0;
    return isDesktopLevel(t, status) ? v === 1 || v === 2 : v >= 1 && v <= 3;
  };
  const v4 = ['ZEDX', ...(status?.levels ?? []).map(l => l?.code).filter((c): c is string => !!c && !isLegacyLevel(c) && !sameLevel(c, 'ZEDX'))];
  if (!isLegacyLevel(type)) {
    if (details == null || details.status === 0) {
      const others = [...(['Bronze', 'Silver', 'Gold'] as const), ...v4.filter(c => !sameLevel(c, type))];
      return others.some(inProgress) ? 'none' : 'apply';
    }
    return details.status >= 1 && details.status <= 4 ? 'arrow' : 'none';
  }
  if (v4.some(c => (of(c) ?? 0) >= 1) && (details == null || details.status === 0)) return 'none';
  const allInactive = status != null && of('Bronze') === 0 && of('Silver') === 0 && of('Gold') === 0;
  if (details == null || allInactive) return 'apply';
  if (details.status >= 1 && details.status <= 4) return 'arrow';
  if (details.status === 0) {
    const bronze = of('Bronze');
    if (type === 'Silver' && (bronze === 3 || bronze === 0) && of('Gold') === 0) return 'apply';
    if (type === 'Gold' && (bronze === 0 || bronze === 3) && (of('Silver') === 0 || of('Silver') === 4)) return 'apply';
  }
  return 'none';
}

const styles = StyleSheet.create({
  infoLine: { flexDirection: 'row', padding: dimens.padding1 },
  infoText: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  pledgeBox: { ...shapes.greyRectangle, margin: dimens.padding2, padding: dimens.padding2 },
  pledgeDate: { color: colors.black, fontSize: dimens.textSize, marginBottom: dimens.padding1 },
});
