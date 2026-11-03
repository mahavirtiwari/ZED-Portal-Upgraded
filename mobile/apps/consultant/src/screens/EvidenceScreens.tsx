import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { htmlToPlain, useAppText, useBackHandler, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import { useInlineCapture } from '../photo/capture';
import { EVIDENCE_SITE_TOUR, newPhotoInformation, type PhotoInformation } from '../models';
import { decodeTourComment, encodeTourComment, sectionFull, sectionsOf, tourCounts, type TourSection } from '../siteTour';
import { C, Card, CharCounter, HeroHeader, Page, ProgressBar, SectionLabel, Strip, z, ZButton, ZIcon, ZScroll, type IconName, type Tone } from '../ui/zed';
import { randomUuid } from '../util/uuid';

const COMMENT_LIMIT = 500;

/** Photos taken before the sections (no tag, or one the unit does not have) are listed under "Other". */
const OTHER = 'other';

/** The icon wells of the section rows, in the sections' order. */
const SECTION_ICONS: IconName[] = ['flag', 'document', 'settings', 'check', 'clipboard', 'shield', 'sync', 'users', 'map-pin', 'image'];

const dataUri = (base64: string) => `data:image/jpeg;base64,${base64.replace(/\s/g, '')}`;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The dark geo-tagged viewfinder of the add sheet: the photo once captured, the shutter to (re)take it. */
function Viewfinder({ photo, onShutter, counter, testID }: { photo?: string | null; onShutter?: () => void; counter?: string | null; testID: string }) {
  return (
    <Pressable style={styles.finder} onPress={onShutter} disabled={!onShutter} testID={testID}>
      {photo ? <Image source={{ uri: dataUri(photo) }} style={StyleSheet.absoluteFill} resizeMode="cover" testID={`${testID}-image`} /> : <View style={styles.subject} />}
      <View style={[styles.bracket, styles.bracketTL]} />
      <View style={[styles.bracket, styles.bracketTR]} />
      <View style={[styles.bracket, styles.bracketBL]} />
      <View style={[styles.bracket, styles.bracketBR]} />
      <View style={[styles.finderChip, styles.chipLeft]}>
        <ZIcon name="map-pin" size={12} color={C.primaryDark} />
        <Text style={styles.finderChipText}>Geo-tag on</Text>
      </View>
      {counter ? (
        <View style={[styles.finderChip, styles.chipRight]}>
          <Text style={styles.finderChipText}>{counter}</Text>
        </View>
      ) : null}
      {onShutter ? (
        <View style={styles.shutter}>
          <View style={styles.shutterInner}>
            <ZIcon name="camera" size={22} color={C.tInverse} />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

/** The remark box of the add sheet: in the app colour with the edit mark once something is typed. */
function NoteBox({ value, onChangeText, placeholder, error, testID }: { value: string; onChangeText: (t: string) => void; placeholder: string; error: boolean; testID: string }) {
  const filled = value.length > 0;
  return (
    <View style={[styles.note, filled && styles.noteFilled, error && styles.noteError]}>
      {filled ? <ZIcon name="edit" size={18} color={C.primary} /> : null}
      <TextInput
        style={[styles.noteInput, filled && styles.noteInputFilled]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={C.tMuted}
        multiline
        maxLength={COMMENT_LIMIT}
        autoCapitalize="sentences"
        testID={testID}
      />
    </View>
  );
}

type TourGroup = { key: string; title: string; hint: string; min: number | null; max: number | null; items: Array<{ photo: PhotoInformation; index: number }> };

/** The list's groups: the unit's sections in flow order, then "Other" for photos without a (known) section. */
function groupTour(sections: readonly TourSection[], photos: PhotoInformation[]): TourGroup[] {
  const groups: TourGroup[] = sections.map(s => ({ key: s.key, title: s.title, hint: s.hint, min: s.min, max: s.max, items: [] }));
  const other: TourGroup = { key: OTHER, title: 'Other', hint: 'Photos taken without a section', min: null, max: null, items: [] };
  photos.forEach((photo, index) => {
    const { section } = decodeTourComment(sections, photo.comment);
    (groups.find(g => g.key === section) ?? other).items.push({ photo, index });
  });
  return other.items.length > 0 ? [...groups, other] : groups;
}

/** The colour of a section's "n of max photos captured": green at its minimum, amber partial, grey untouched. */
const countColor = (count: number, min: number | null) => (min == null ? C.tSecondary : count > 0 && count >= min ? C.success : count > 0 ? C.warning : C.tMuted);

/**
 * SiteTourActivity: the site photos with comments under the unit's sections (Admin → Site Tour Sections: at most each
 * section's maximum, the team's photos included). The list shows the sections with their counts; a section opens its
 * photos (each with its edit) and, while it has room, the capture tile.
 */
export function SiteTourScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const tourText = useAppText('app.consultant.siteTour.tourInstruction');
  const [photos, setPhotos] = useState<PhotoInformation[] | null>(null);
  /** The section open (its photos); null: the list of sections. */
  const [open, setOpen] = useState<string | null>(null);
  const coords = useRef<Coordinates | null>(null);

  const reload = () => app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR).then(setPhotos);

  useEffect(() => {
    reload();
    // The instruction is shown once (getPreferences of SiteTourActivity).
    if (app.prefs.get(PREFS.siteTour, PREFS.tourInstruction) == null && tourText) {
      ui.alert(null, htmlToPlain(tourText.html), [{ text: 'OK', onPress: () => app.prefs.setBoolean(PREFS.siteTour, PREFS.tourInstruction, true) }], true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from a section returns to the list of sections.
  useBackHandler(() => {
    if (open == null) return false;
    setOpen(null);
    return true;
  });

  const openPhoto = (index: number | null, section: string | null = null) => {
    nav.push('NewSitePhoto', {
      evidenceId: index != null ? photos![index]!.evidenceId : null,
      coords: index == null ? coords.current : null,
      section,
      onResult: (result: { evidenceId: string; coords?: Coordinates | null }) => {
        if (result.coords) coords.current = result.coords;
        reload();
      },
    });
  };

  const list = photos ?? [];
  const sections = sectionsOf(app.details);
  const counts = tourCounts(sections, list, !!app.details?.isSiteTourSubmitted);
  // The overall limit is the sum of the sections' maxima.
  const maxTotal = sections.reduce((n, s) => n + s.max, 0);
  const total = sections.reduce((n, s) => n + (counts[s.key] ?? 0), 0);
  const groups = groupTour(sections, list);
  const covered = sections.filter(s => (counts[s.key] ?? 0) >= s.min).length;
  const countOf = (g: TourGroup) => (g.key === OTHER ? g.items.length : (counts[g.key] ?? 0));
  const current = open != null ? (groups.find(g => g.key === open) ?? null) : null;

  if (current) {
    const gi = groups.indexOf(current);
    const count = countOf(current);
    const isOther = current.key === OTHER;
    const max = current.max ?? 0;
    const min = current.min ?? 0;
    const addHere = photos != null && !isOther && count < max;
    const full = !isOther && count >= max;
    // The team's photos are counted with the section but kept on the server; the grid shows this phone's.
    const team = isOther ? 0 : Math.max(0, count - current.items.length);
    const strip: { title?: string; text: string; tone: Tone; icon: IconName } = isOther
      ? { text: 'Tap a photo to file it under a section.', tone: 'info', icon: 'info' }
      : count === 0
        ? { title: 'Nothing captured yet', text: `Capture at least ${plural(min, 'photograph')} of this area. Each photo is geo-tagged and time stamped.`, tone: 'warning', icon: 'camera' }
        : full
          ? { text: `Maximum of ${plural(max, 'photograph')} reached for this section.`, tone: 'info', icon: 'info' }
          : count >= min
            ? { text: `Minimum met. You may add up to ${plural(max, 'photograph')} for this section.`, tone: 'success', icon: 'check' }
            : { text: `${plural(min - count, 'more photograph')} needed for this section.`, tone: 'warning', icon: 'camera' };
    const last = [...current.items].reverse().find(i => i.photo.latitude || i.photo.timeStamp)?.photo ?? null;
    return (
      <Page testID="site-tour">
        <HeroHeader title="Site Tour" subtitle={`${current.title} · ${app.zedId}`} onBack={() => setOpen(null)} />
        <ZScroll contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]}>
          <View style={styles.summary}>
            <View style={z.rowCenter}>
              <ZIcon name="image" size={22} color={C.primaryDark} />
              <View style={styles.summaryText}>
                <Text style={styles.summaryTitle} testID="site-tour-section-count">
                  {isOther ? plural(count, 'photograph') : `${count} of ${plural(max, 'photograph')}`}
                </Text>
                <Text style={styles.summarySub}>
                  {isOther ? current.hint : `Minimum ${plural(min, 'photograph')}, maximum ${max} for this section.${team > 0 ? ` ${team} uploaded by the team.` : ''}`}
                </Text>
              </View>
            </View>
            {!isOther ? (
              <View style={styles.summaryBar}>
                <ProgressBar value={max ? count / max : 0} />
              </View>
            ) : null}
          </View>
          <Strip title={strip.title} text={strip.text} tone={strip.tone} icon={strip.icon} />
          <SectionLabel label="Photographs" />
          <View style={styles.grid}>
            {current.items.map(({ photo, index }, n) => (
              <View key={photo.evidenceId ?? index} style={styles.cell}>
                <Pressable style={styles.tile} onPress={() => openPhoto(index)} testID={`site-tour-${index}`}>
                  {photo.photo ? <Image source={{ uri: dataUri(photo.photo) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <ZIcon name="image" size={20} color={C.primaryDark} />}
                  <View style={styles.tilePin}>
                    <ZIcon name="map-pin" size={9} color={C.tInverse} strokeWidth={2.4} />
                  </View>
                  <Pressable style={styles.tileEdit} onPress={() => openPhoto(index)} hitSlop={6} testID={`site-tour-${index}-edit`}>
                    <ZIcon name="edit" size={12} color={C.tInverse} strokeWidth={2.2} />
                  </Pressable>
                </Pressable>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {`Photo ${n + 1}`}
                </Text>
                <Text style={styles.tileRemark} numberOfLines={2}>
                  {decodeTourComment(sections, photo.comment).remark}
                </Text>
              </View>
            ))}
            {addHere ? (
              <View style={styles.cell}>
                <Pressable style={[styles.tile, styles.captureTile]} onPress={() => openPhoto(null, current.key)} testID="site-tour-add">
                  <ZIcon name="camera" size={26} color={C.primary} />
                </Pressable>
                <Text style={styles.tileLabel}>{count === 0 ? 'Take Photo' : 'Tap to capture'}</Text>
              </View>
            ) : null}
          </View>
          {last ? (
            <>
              <SectionLabel label="Capture details" />
              <Card style={styles.details}>
                {last.latitude ? (
                  <View style={[z.rowCenter, styles.detailRow, last.timeStamp ? styles.detailDivider : null]}>
                    <ZIcon name="map-pin" size={18} color={C.primaryDark} />
                    <Text style={styles.detailText}>{`${last.latitude}, ${last.longitude ?? ''}`}</Text>
                  </View>
                ) : null}
                {last.timeStamp ? (
                  <View style={[z.rowCenter, styles.detailRow]}>
                    <ZIcon name="calendar" size={18} color={C.primaryDark} />
                    <Text style={styles.detailText}>{last.timeStamp}</Text>
                  </View>
                ) : null}
              </Card>
            </>
          ) : null}
          <ZButton title="Done" onPress={() => setOpen(null)} style={styles.done} testID="site-tour-section-done" />
          <Text style={styles.footer}>{isOther ? 'Every photo is geo-tagged and time-stamped automatically.' : `Section ${gi + 1} of ${sections.length} · every photo is geo-tagged and time-stamped.`}</Text>
        </ZScroll>
      </Page>
    );
  }

  return (
    <Page testID="site-tour">
      <HeroHeader title="Site Tour" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]}>
        <View style={styles.summary}>
          <View style={z.rowCenter}>
            <ZIcon name="image" size={22} color={C.primaryDark} />
            <View style={styles.summaryText}>
              <Text style={styles.summaryTitle}>{`${covered} of ${sections.length} sections covered`}</Text>
              <Text style={styles.summarySub} testID="site-tour-count">{`${total} of ${maxTotal} photos captured`}</Text>
            </View>
          </View>
          <View style={styles.summaryBar}>
            <ProgressBar value={sections.length ? covered / sections.length : 0} />
          </View>
        </View>
        {photos != null && total === 0 ? <Strip text="Walk the unit in flow order and capture each section. Every photo is geo-tagged on capture." tone="warning" icon="camera" /> : null}
        {photos != null && sections.length > 0 && covered === sections.length ? <Strip text={`All ${sections.length} sections covered with their minimum photographs.`} tone="success" icon="check" /> : null}
        <SectionLabel label="Defined sections" />
        {groups.map((g, gi) => {
          const count = countOf(g);
          const isOther = g.key === OTHER;
          const full = !isOther && count >= (g.max ?? 0);
          return (
            <Card key={g.key} style={styles.row} onPress={() => setOpen(g.key)} testID={`site-tour-section-${g.key}`}>
              <View style={styles.well}>
                <ZIcon name={isOther ? 'image' : SECTION_ICONS[gi % SECTION_ICONS.length]!} size={20} color={C.primaryDark} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowTitle} numberOfLines={2}>
                  {g.title}
                </Text>
                <Text style={[styles.rowSub, { color: countColor(count, g.min) }]} numberOfLines={1}>
                  {isOther ? `${plural(count, 'photo')} to file under a section` : `${count} of ${plural(g.max ?? 0, 'photo')} captured · min ${g.min}`}
                </Text>
              </View>
              <View style={[styles.pill, full && styles.pillFull]} testID={`site-tour-badge-${g.key}`}>
                <Text style={[styles.pillText, full && styles.pillTextFull]}>{isOther ? `${count}` : `${count}/${g.max}`}</Text>
                <ZIcon name="chevron-right" size={14} color={full ? C.tInverse : C.primaryDark} />
              </View>
            </Card>
          );
        })}
        <ZButton title="Done" onPress={() => nav.pop()} style={styles.done} testID="site-tour-done" />
        <Text style={styles.footer}>Every photo is geo-tagged and time-stamped automatically.</Text>
      </ZScroll>
    </Page>
  );
}

/** NewSitePhotoActivity: a site tour photo and its comment (new, or edit of one already taken), filed under a section. */
export function NewSitePhotoScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<{
    evidenceId?: string | null;
    coords?: Coordinates | null;
    /** The list's section the photo is filed under. */
    section?: string | null;
    onResult?: (r: { evidenceId: string; coords?: Coordinates | null }) => void;
  }>();
  const [evidence, setEvidence] = useState<PhotoInformation | null>(null);
  const [comment, setComment] = useState('');
  const sections = sectionsOf(app.details);
  const [section, setSection] = useState<string | null>(params.section ?? null);
  const [tour, setTour] = useState<PhotoInformation[]>([]);
  const [editMode, setEditMode] = useState(false);
  const coords = useRef<Coordinates | null>(params.coords ?? null);
  const [commentError, setCommentError] = useState(false);
  const { capture } = useInlineCapture();

  const take = async () => {
    const shot = await capture({ coords: coords.current });
    if (!shot) return;
    coords.current = shot.coords;
    setEvidence(p => ({ ...(p ?? newPhotoInformation(randomUuid)), photo: shot.base64, timeStamp: shot.timeStamp, latitude: shot.coords?.latitude, longitude: shot.coords?.longitude }));
  };

  useEffect(() => {
    app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR).then(setTour);
    (async () => {
      if (params.evidenceId) {
        const stored = await app.store.evidence(app.userId, params.evidenceId);
        if (stored?.photo?.trim()) {
          const decoded = decodeTourComment(sections, stored.comment);
          setEvidence(stored);
          setComment(decoded.remark);
          setSection(decoded.section);
          setEditMode(true);
          return;
        }
      }
      setEvidence(newPhotoInformation(randomUuid));
      // A new photo: the camera opens at once.
      take();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The unit's sections only (no "Other" for a photo). */
  const pickSection = async () => {
    const i = await ui.pickItem('Section', sections.map((s, n) => `${n + 1}. ${s.title}`));
    if (i == null) return;
    setSection(sections[i]?.key ?? null);
  };

  const onComment = (t: string) => {
    setComment(t);
    setCommentError(false);
  };

  const index = sections.findIndex(s => s.key === section);
  const current = index >= 0 ? sections[index]! : null;
  // Photos already filed under the section (this one excluded): the team's uploaded ones and this phone's.
  const others = tour.filter(p => p.evidenceId !== evidence?.evidenceId);
  const inSection = section ? (tourCounts(sections, others, !!app.details?.isSiteTourSubmitted)[section] ?? 0) : 0;
  const maxTotal = sections.reduce((n, s) => n + s.max, 0);

  const add = async () => {
    if (!evidence?.photo?.trim()) return ui.showAlert('Please capture Evidence photo');
    if (comment.trim() === '') {
      setCommentError(true);
      return ui.showAlert('Please enter comment');
    }
    // A new photo (or one moved to another section) needs a section with room (its maximum, the team's photos included).
    const target = sections.find(s => s.key === section);
    if (!target) return ui.showAlert('Please select the section of this photo');
    const before = editMode ? decodeTourComment(sections, tour.find(p => p.evidenceId === evidence.evidenceId)?.comment).section : null;
    if (before !== target.key && inSection >= target.max) return ui.showAlert(sectionFull(target));
    const info: PhotoInformation = { ...evidence, comment: encodeTourComment(sections, section, comment.trim()), type: EVIDENCE_SITE_TOUR };
    if (info.evidenceId == null) info.evidenceId = app.saId + Date.now();
    if (!(await app.store.saveEvidence(app.userId, info))) return ui.toast('Failed to add Evidence');
    if (!editMode) ui.toast('Photo added successfully');
    nav.pop();
    params.onResult?.({ evidenceId: info.evidenceId, coords: editMode ? undefined : coords.current });
  };

  const counter = editMode ? null : current ? `Photo ${Math.min(inSection + 1, current.max)} / ${current.max}` : `Photo ${tour.length + 1} / ${maxTotal}`;

  return (
    <Page testID="new-site-photo">
      <HeroHeader title={editMode ? 'Edit tour photo' : 'Add tour photo'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ZScroll contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Card>
          <SectionLabel label="Section" brand style={styles.flush} />
          <Pressable style={styles.picker} onPress={pickSection} testID="site-photo-section">
            <View style={[styles.flowChip, { backgroundColor: current ? C.primary : C.muted }]}>
              <Text style={[styles.flowChipText, { color: current ? C.tInverse : C.tSecondary }]}>{current ? index + 1 : '·'}</Text>
            </View>
            <View style={styles.pickerText}>
              <Text style={styles.pickerTitle} numberOfLines={1}>
                {current?.title ?? 'Select section'}
              </Text>
              <Text style={styles.pickerSub}>{current ? `${inSection} captured · min ${current.min}, max ${current.max}` : 'Select the section of this photo'}</Text>
            </View>
            <ZIcon name="chevron-down" size={20} color={C.primaryDark} />
          </Pressable>
          <Viewfinder photo={evidence?.photo} onShutter={take} counter={counter} testID="site-photo" />
          <View style={[z.rowBetween, styles.remarkHead]}>
            <Text style={styles.noteLabel}>Remark</Text>
            <CharCounter used={comment.length} limit={COMMENT_LIMIT} />
          </View>
          <NoteBox value={comment} onChangeText={onComment} placeholder="Add a remark for this photo" error={commentError} testID="site-photo-comment" />
          {commentError ? <Text style={styles.error}>Required</Text> : null}
          <Text style={styles.hint}>Geo-coordinates and timestamp are added automatically.</Text>
          <View style={styles.actions}>
            <ZButton title="Cancel" variant="ghost" onPress={() => nav.pop()} style={styles.cancel} testID="site-photo-cancel" />
            <ZButton title={editMode ? 'Update photo' : 'Save photo'} onPress={add} style={styles.save} testID="site-photo-submit" />
          </View>
        </Card>
      </ZScroll>
    </Page>
  );
}

const styles = StyleSheet.create({
  finder: { height: 210, borderRadius: 14, backgroundColor: '#1E2A33', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  subject: { width: 120, height: 92, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.14)', marginBottom: 30 },
  bracket: { position: 'absolute', width: 14, height: 14, borderColor: 'rgba(255,255,255,0.9)' },
  bracketTL: { top: 16, left: 40, borderTopWidth: 2, borderLeftWidth: 2 },
  bracketTR: { top: 16, right: 40, borderTopWidth: 2, borderRightWidth: 2 },
  bracketBL: { bottom: 16, left: 40, borderBottomWidth: 2, borderLeftWidth: 2 },
  bracketBR: { bottom: 16, right: 40, borderBottomWidth: 2, borderRightWidth: 2 },
  finderChip: { position: 'absolute', top: 14, height: 22, borderRadius: 11, paddingHorizontal: 10, backgroundColor: 'rgba(255,255,255,0.95)', flexDirection: 'row', alignItems: 'center', gap: 4 },
  chipLeft: { left: 14 },
  chipRight: { right: 14 },
  finderChipText: { fontSize: 10, fontWeight: '700', color: C.primaryDark },
  shutter: { position: 'absolute', bottom: 14, width: 54, height: 54, borderRadius: 27, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  noteLabel: { fontSize: 12, fontWeight: '600', color: C.tSecondary },
  note: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface, paddingHorizontal: 12, marginTop: 6 },
  noteFilled: { borderColor: C.primary },
  noteError: { borderColor: C.danger },
  noteInput: { flex: 1, fontSize: 13, color: C.tPrimary, paddingVertical: 10, textAlignVertical: 'top' },
  noteInputFilled: { marginLeft: 10 },
  error: { color: C.danger, fontSize: 12, marginTop: 4 },
  hint: { fontSize: 11, color: C.tMuted, marginTop: 8 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 18 },
  cancel: { flex: 36 },
  save: { flex: 64 },
  summary: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 16, marginBottom: 12 },
  summaryText: { flex: 1, marginLeft: 14 },
  summaryTitle: { fontSize: 13, fontWeight: '700', color: C.tPrimary },
  summarySub: { fontSize: 11, color: C.tSecondary, marginTop: 3 },
  summaryBar: { marginTop: 12 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, marginBottom: 8, borderRadius: 12, borderWidth: 1, borderColor: C.border },
  well: { width: 36, height: 36, borderRadius: 9, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  rowText: { flex: 1, marginRight: 8 },
  rowTitle: { fontSize: 13.5, fontWeight: '700', color: C.tPrimary },
  rowSub: { fontSize: 11, marginTop: 3 },
  pill: { flexDirection: 'row', alignItems: 'center', height: 26, borderRadius: 8, paddingLeft: 10, paddingRight: 6, backgroundColor: C.primaryBg, gap: 4 },
  pillFull: { backgroundColor: C.primary },
  pillText: { fontSize: 11, fontWeight: '700', color: C.primaryDark },
  pillTextFull: { color: C.tInverse },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -5 },
  cell: { width: '33.333%', paddingHorizontal: 5, marginBottom: 12 },
  tile: { aspectRatio: 1, borderRadius: 12, backgroundColor: C.primaryBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  captureTile: { backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  tilePin: { position: 'absolute', top: 6, right: 6, width: 16, height: 16, borderRadius: 8, backgroundColor: C.primaryDark, alignItems: 'center', justifyContent: 'center' },
  tileEdit: { position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: 11, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 10.5, color: C.tSecondary, textAlign: 'center', marginTop: 5 },
  tileRemark: { fontSize: 10, color: C.tMuted, textAlign: 'center', marginTop: 1 },
  details: { paddingVertical: 4 },
  detailRow: { paddingVertical: 12 },
  detailDivider: { borderBottomWidth: 1, borderBottomColor: C.divider },
  detailText: { fontSize: 13, fontWeight: '600', color: C.tPrimary, marginLeft: 12, flex: 1 },
  done: { marginTop: 8 },
  footer: { fontSize: 10, color: C.tMuted, textAlign: 'center', marginTop: 10 },
  flush: { marginTop: 0 },
  flowChip: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  flowChipText: { fontSize: 11, fontWeight: '700' },
  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    borderRadius: 10,
    borderWidth: 1.4,
    borderColor: C.primary,
    backgroundColor: C.primaryBg,
    paddingHorizontal: 12,
    marginBottom: 14,
  },
  pickerText: { flex: 1, marginLeft: 10 },
  pickerTitle: { fontSize: 13.5, fontWeight: '700', color: C.tPrimary },
  pickerSub: { fontSize: 10.5, color: C.tSecondary, marginTop: 2 },
  remarkHead: { marginTop: 14 },
});
