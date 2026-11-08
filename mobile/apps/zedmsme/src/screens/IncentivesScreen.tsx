import React, { useCallback } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import {
  BackBar,
  colors,
  dimens,
  htmlToPlain,
  Icon,
  lineHeight,
  ScreenFrame,
  textStyles,
  useAppText,
  useFocusEffect,
  useNavigation,
  useUi,
  ZedButton,
  type IconDefinition,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { isAnyCertificationCompleted } from '../models';
import type { PublicBuiltInIncentiveCard, PublicIncentive, PublicIncentiveCards } from '../api';

/**
 * The incentives that open the incentives page once a level is certified (GradedIncentivesActivity for all of them):
 * the Admin's card code (Main Dashboard Cards) when the Admin manages the card, title, description, the legacy logo
 * and how many leading characters of the description are in the coupon blue.
 */
type Graded = { code: string | null; title: string; detail: string; logo: ImageSourcePropType; blue: number };
const GRADED: Graded[] = [
  {
    code: 'HANDHOLDING',
    title: 'Handholding Support',
    detail: 'Cost: Rs. 2,00,000/- (Subsidy as per MSME size) for improving systems and processes',
    logo: images.handholding_logo,
    blue: 47,
  },
  {
    code: 'TECHNOLOGY_UPGRADATION',
    title: 'Technology Upgradation',
    detail: 'Support of up to Rs. 3,00,000/- for moving towards Zero Effect Solutions',
    logo: images.technology_logo,
    blue: 31,
  },
  { code: null, title: 'Ministry of MSME', detail: 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs', logo: images.msme_logo, blue: 0 },
  { code: null, title: 'States/UTs', detail: 'Incentives by States/UTs for ZED Certified MSMEs', logo: images.state_uts_logo, blue: 0 },
  {
    code: null,
    title: 'Financial Institutions',
    detail: 'Incentives by Financial Institutions for ZED Certified MSMEs',
    logo: images.financial_institution_logo,
    blue: 0,
  },
  {
    code: null,
    title: 'Other Incentives',
    detail: 'Incentives by Central Ministries/Other Organizations for ZED Certified MSMEs',
    logo: images.graded_incentives_logo,
    blue: 0,
  },
];

const JOINING_REWARD_TEXT = 'Rs. 10,000/- Limited purpose reward, linked with ZED Certification Levels';
const FINANCIAL_ASSISTANCE_TEXT = '75% of Subsidy (Max. Rs. 50,000/-) For System Certification or Product Certification of Product Testing';

/** getForegroundColorSpan: the first `n` characters in the coupon blue. */
const highlighted = (text: string, n: number) =>
  n > 0 ? (
    <>
      <Text style={{ color: colors.couponBorder }}>{text.slice(0, n)}</Text>
      {text.slice(n)}
    </>
  ) : (
    text
  );

const rupees = (value: string | null | undefined) => {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? '₹ ' + n.toLocaleString('en-IN') : value ?? '';
};

/** Trimmed text, or null when empty. */
const textOf = (value: string | null | undefined) => {
  const t = typeof value === 'string' ? value.trim() : '';
  return t ? t : null;
};

/** The Admin's details (simple HTML) as plain text, or null. */
const plainOf = (html: string | null | undefined) => {
  const t = textOf(html);
  return t ? textOf(htmlToPlain(t)) : null;
};

/** Only web links are opened from the Admin's cards (the server already keeps http(s) links only). */
const webLinkOf = (url: string | null | undefined) => {
  const t = textOf(url);
  return t && /^https?:\/\/\S+$/i.test(t) ? t : null;
};

/** A built-in card as shown: hidden when the Admin turned it off; the Admin's texts where given, else the built-in ones. */
export type BuiltInCardView = { visible: boolean; title: string; highlight: string | null; detail: React.ReactNode };

/**
 * New in V4 (2026-11-08): a built-in card with the Admin's row of Main Dashboard Cards (`code`), or the built-in
 * wording when there is no row (no answer from the server yet, or the Admin has not set that card).
 */
export function builtInCard(cards: PublicIncentiveCards | null, code: string | null, title: string, detail: string, blue: number): BuiltInCardView {
  const row: PublicBuiltInIncentiveCard | undefined = code ? cards?.builtIn.find(c => c.card?.toUpperCase() === code) : undefined;
  if (!row) return { visible: true, title, highlight: null, detail: highlighted(detail, blue) };
  return {
    visible: row.active !== false,
    title: textOf(row.title) ?? title,
    highlight: textOf(row.highlight),
    detail: plainOf(row.details) ?? highlighted(detail, blue),
  };
}

/** MyIncentivesFragment ("My Incentives"). */
export function IncentivesScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('incentives');
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  const certified = status ? isAnyCertificationCompleted(status) : false;
  const availInfo = useAppText('app.msme.incentives.joiningReward.availInfo');
  const open = (url: string, fallback?: string) =>
    Linking.openURL(url).catch(() => (fallback ? Linking.openURL(fallback) : Promise.reject()).catch(() => ui.toast('No suitable application found to perform this action')));
  /** A link of an Admin incentive card (website, video, e-mail, phone). */
  const openLink = async (url: string) => {
    try {
      await Linking.openURL(url);
    } catch {
      ui.toast('The link could not be opened.');
    }
  };

  // New in V4 (2026-11-08): the Admin's cards (Admin → Incentives → Main Dashboard Cards), asked when the screen opens.
  useFocusEffect(
    useCallback(() => {
      void app.refreshIncentiveCards();
    }, [app]),
  );
  const cards = app.incentiveCards;
  const reward = builtInCard(cards, 'JOINING_REWARD', 'Joining Reward', JOINING_REWARD_TEXT, 12);
  const assistance = builtInCard(cards, 'FINANCIAL_ASSISTANCE', 'Financial Assistance', FINANCIAL_ASSISTANCE_TEXT, 34);

  const joiningReward = () => {
    const message = status?.isCouponUsed
      ? `Date of avail: ${status.dateOfAvail ?? ''}\nAmount: ${rupees(status.joiningRewardAmount)}\nCertification level: ${status.latestCertification ?? ''}`
      : availInfo
        ? htmlToPlain(availInfo.html)
        : '';
    ui.alert(reward.title, message, [{ text: 'OK' }]);
  };

  return (
    <ScreenFrame title="My Incentives" onMenu={openDrawer} testID="incentives">
      <View style={{ flex: 1, backgroundColor: colors.lightGrey2 }}>
        {/* fragment_my_incentives: BACK only, no ZED ID. */}
        <BackBar onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {/* MSME KAWACH was removed (2026-11-06). */}
          {reward.visible ? (
            <Incentive
              title={reward.title}
              highlight={reward.highlight}
              logo={images.reward}
              detail={reward.detail}
              right={status?.isCouponUsed ? icons.ic_baseline_view_48 : icons.ic_incentive_arrow_enabled}
              onPress={joiningReward}
              testID="incentive-joining-reward"
            />
          ) : null}
          {assistance.visible ? (
            <Incentive
              title={assistance.title}
              highlight={assistance.highlight}
              logo={images.financial_assistance_logo}
              detail={assistance.detail}
              enabled={status?.financialAssistanceStatus === 1}
              right={icons.ic_incentive_arrow_enabled}
              onPress={() => nav.push('FinancialAssistance')}
              testID="incentive-financial-assistance"
            />
          ) : null}
          {GRADED.map((g, i) => {
            const card = builtInCard(cards, g.code, g.title, g.detail, g.blue);
            return card.visible ? (
              <Incentive
                key={g.title}
                title={card.title}
                highlight={card.highlight}
                logo={g.logo}
                detail={card.detail}
                enabled={certified}
                right={icons.ic_incentive_arrow_enabled}
                onPress={() => open(app.api.incentivesUrl)}
                testID={`incentive-graded-${i}`}
              />
            ) : null;
          })}
          {/* New in V4 (2026-11-08): the Admin's dashboard incentives, in the server's order. */}
          {(cards?.incentives ?? []).map((incentive, i) => (
            <AdminIncentive key={`${incentive.id ?? ''}-${i}`} incentive={incentive} onLink={openLink} testID={`incentive-admin-${incentive.id ?? i}`} />
          ))}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

/**
 * layout_incentives_option: the logo with the arrow (in its grey square) on the right, the title (TextSubheading) and
 * the description under it, on a white card with the green outline. A disabled option shows the disabled arrow and does
 * nothing. New in V4: the Admin's highlight line under the title (as on the web).
 */
function Incentive({
  title,
  highlight,
  logo,
  detail,
  right,
  enabled = true,
  onPress,
  testID,
}: {
  title: string;
  highlight?: string | null;
  logo: ImageSourcePropType;
  detail: React.ReactNode;
  right: IconDefinition;
  enabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable style={styles.card} onPress={enabled ? onPress : undefined} disabled={!enabled} testID={testID}>
      <View style={styles.top}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        {enabled && right === icons.ic_baseline_view_48 ? (
          <View style={styles.viewBox}>
            <Icon icon={right} />
          </View>
        ) : (
          <Icon icon={enabled ? right : icons.ic_incentive_arrow_disabled} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      {highlight ? <Text style={styles.highlight}>{highlight}</Text> : null}
      <Text style={styles.detail} numberOfLines={4}>
        {detail}
      </Text>
    </Pressable>
  );
}

/**
 * New in V4 (2026-11-08): an incentive the Admin shows on the dashboard: title, highlight line, details (plain text, a
 * few lines), department / contact person / e-mail / mobile when given, and the Website and Video buttons.
 */
function AdminIncentive({ incentive, onLink, testID }: { incentive: PublicIncentive; onLink: (url: string) => void; testID: string }) {
  const title = textOf(incentive.title);
  const highlight = textOf(incentive.highlight);
  const details = plainOf(incentive.details);
  const department = textOf(incentive.department);
  const contact = textOf(incentive.contactPerson);
  const email = textOf(incentive.email);
  const mobile = textOf(incentive.mobileNo);
  const web = webLinkOf(incentive.webLink);
  const video = webLinkOf(incentive.videoLink);
  return (
    <View style={styles.card} testID={testID}>
      {title ? <Text style={styles.adminTitle}>{title}</Text> : null}
      {highlight ? <Text style={styles.highlight}>{highlight}</Text> : null}
      {details ? (
        <Text style={styles.detail} numberOfLines={5}>
          {details}
        </Text>
      ) : null}
      {department ? <InfoLine label="Department" value={department} /> : null}
      {contact ? <InfoLine label="Contact person" value={contact} /> : null}
      {email ? <InfoLine label="Email" value={email} onPress={() => onLink('mailto:' + email)} testID={`${testID}-email`} /> : null}
      {mobile ? <InfoLine label="Mobile" value={mobile} onPress={() => onLink('tel:' + mobile.replace(/[^\d+]/g, ''))} testID={`${testID}-mobile`} /> : null}
      {web || video ? (
        <View style={styles.links}>
          {web ? <ZedButton title="Website" allCaps={false} onPress={() => onLink(web)} style={styles.linkButton} testID={`${testID}-website`} /> : null}
          {video ? <ZedButton title="Video" allCaps={false} onPress={() => onLink(video)} style={styles.linkButton} testID={`${testID}-video`} /> : null}
        </View>
      ) : null}
    </View>
  );
}

/** "Label: value"; a tappable value (e-mail, phone) in the link colour. */
function InfoLine({ label, value, onPress, testID }: { label: string; value: string; onPress?: () => void; testID?: string }) {
  return (
    <Text style={styles.info}>
      <Text style={styles.infoLabel}>{label}: </Text>
      {onPress ? (
        <Text style={styles.infoLink} onPress={onPress} testID={testID} accessibilityRole="link">
          {value}
        </Text>
      ) : (
        value
      )}
    </Text>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: dimens.padding2,
    padding: dimens.padding4,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: dimens.padding2,
    backgroundColor: colors.white,
  },
  viewBox: { padding: dimens.padding2, borderRadius: 8, backgroundColor: colors.lightGrey },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: dimens.incentiveLogoSize, height: dimens.incentiveLogoSize, borderRadius: 12 },
  title: { ...textStyles.subheading, marginTop: dimens.padding2 },
  detail: { color: colors.black, fontSize: dimens.textSize, lineHeight: lineHeight(dimens.textSize) },
  highlight: { color: colors.couponBorder, fontWeight: 'bold', fontSize: dimens.textSize, lineHeight: lineHeight(dimens.textSize) },
  adminTitle: { ...textStyles.subheading, fontWeight: 'bold' },
  info: { color: colors.black, fontSize: dimens.textSize14, lineHeight: lineHeight(dimens.textSize14), marginTop: dimens.padding1 },
  infoLabel: { fontWeight: 'bold' },
  infoLink: { color: colors.appColor, textDecorationLine: 'underline' },
  links: { flexDirection: 'row', flexWrap: 'wrap', marginTop: dimens.padding2, marginHorizontal: -dimens.padding2 },
  linkButton: { paddingVertical: dimens.padding2, paddingHorizontal: dimens.padding4 },
});
