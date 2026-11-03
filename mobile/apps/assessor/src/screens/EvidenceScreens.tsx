import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { htmlToPlain, useAppText, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import { useInlineCapture } from '../photo/capture';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, newPhotoInformation, type PhotoInformation } from '../models';
import { Badge, C, CharCounter, Card, HeroHeader, Page, ProgressBar, SectionLabel, Strip, ZButton, ZIcon, z, type Tone } from '../ui/zed';
import { decodeTourComment, encodeTourComment, sectionFull, sectionsOf, tourCounts, type TourSection } from '../siteTour';
import { randomUuid } from '../util/uuid';

const COMMENT_LIMIT = 500;

/** Photos taken before the sections (no tag, or one the unit does not have) are listed under "Other". */
const OTHER = 'other';

const dataUri = (base64: string) => `data:image/jpeg;base64,${base64.replace(/\s/g, '')}`;

/** The dark geo-tagged viewfinder of the add sheets: the photo once captured, the shutter to (re)take it. */
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

/** The name / remark box of the add sheets: orange with the edit mark once something is typed. */
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

/** Cancel + the primary action at the foot of the add sheets. */
function SheetActions({ title, onSave, onCancel, saveID, cancelID }: { title: string; onSave: () => void; onCancel: () => void; saveID: string; cancelID: string }) {
  return (
    <View style={styles.actions}>
      <ZButton title="Cancel" variant="ghost" onPress={onCancel} style={styles.cancel} testID={cancelID} />
      <ZButton title={title} onPress={onSave} style={styles.save} testID={saveID} />
    </View>
  );
}

/** NewEvidenceActivity: a new evidence photo with its name, or (pick mode) a site tour photo used as evidence. */
export function NewEvidenceScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  /** `name`: V4, an evidence the Admin lists for the requirement (its name filled in). */
  const { params } = useRoute<{ pickEvidence?: boolean; name?: string; onResult?: (evidenceId: string | null) => void }>();
  const pickMode = params.pickEvidence === true;
  const [evidence, setEvidence] = useState<PhotoInformation>(() => newPhotoInformation(randomUuid));
  const [name, setName] = useState(params.name ?? '');
  const [nameError, setNameError] = useState(false);
  const counterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { capture } = useInlineCapture();

  const finishWith = (id: string | null) => {
    nav.pop();
    params.onResult?.(id);
  };

  useEffect(() => {
    if (!pickMode) return;
    (async () => {
      const photos = await app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR);
      if (photos.length === 0) {
        ui.toast('No Site Tour images available to pick from', { long: true });
        nav.pop();
        return;
      }
      nav.push('SiteTour', {
        pickEvidence: true,
        onResult: async (id: string | null) => {
          if (id == null) {
            ui.toast('Request Cancelled', { long: true });
            nav.pop();
            return;
          }
          const picked = await app.store.evidence(app.userId, id);
          if (picked) setEvidence(picked);
          else ui.showAlert('Failed to add Evidence');
        },
      });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const take = async () => {
    const shot = await capture();
    if (!shot) return;
    setEvidence(p => ({ ...p, photo: shot.base64, timeStamp: shot.timeStamp, latitude: shot.coords?.latitude, longitude: shot.coords?.longitude }));
  };

  /** edittextCharacterCounter: "n/500 characters entered" for 3 s while typing. */
  const onName = (t: string) => {
    setName(t);
    setNameError(false);
    if (counterTimer.current) clearTimeout(counterTimer.current);
    counterTimer.current = setTimeout(() => ui.toast(`${t.length}/500 characters entered`), 150);
  };

  const add = async () => {
    if (!evidence.photo?.trim()) return ui.toast('Please capture Evidence photo');
    // The hidden name spinner had no items (position -1 == size - 1): the typed name is required.
    if (name.trim() === '') {
      setNameError(true);
      return ui.toast('Please provide evidence name');
    }
    const info: PhotoInformation = { ...evidence };
    if (!info.name) info.name = name.trim();
    if (!info.name?.trim()) return ui.toast('Please provide evidence name');
    if (info.evidenceId == null) info.evidenceId = app.saId + Date.now();
    if (pickMode) {
      await app.store.saveEvidence(app.userId, info);
      finishWith(info.evidenceId);
    } else {
      info.type = EVIDENCE_ADDED;
      if (await app.store.saveEvidence(app.userId, info)) finishWith(info.evidenceId);
      else ui.toast('Failed to add Evidence');
    }
  };

  return (
    <Page testID="new-evidence">
      <HeroHeader title="Add evidence" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]} keyboardShouldPersistTaps="handled">
        <Card>
          <Viewfinder photo={evidence.photo} onShutter={pickMode ? undefined : take} testID="evidence-photo" />
          <Text style={styles.noteLabel}>EVIDENCE NAME</Text>
          <NoteBox value={name} onChangeText={onName} placeholder="Name this evidence" error={nameError} testID="evidence-name" />
          {nameError ? <Text style={styles.error}>Required</Text> : null}
          <Text style={styles.hint}>Geo-coordinates and timestamp are added automatically.</Text>
          <SheetActions title="Save evidence" onSave={add} onCancel={() => nav.pop()} saveID="evidence-add" cancelID="evidence-cancel" />
        </Card>
      </ScrollView>
    </Page>
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

/** A section's status badge: grey "Min n" untouched, amber "n of min" partial, green "n photos" at the minimum. */
function sectionStatus(count: number, min: number | null): { label: string; tone: Tone; chip: string; chipText: string } {
  const photos = `${count} photo${count === 1 ? '' : 's'}`;
  if (min == null) return { label: photos, tone: 'neutral', chip: C.muted, chipText: C.tSecondary };
  if (count >= min) return { label: photos, tone: 'success', chip: C.success, chipText: C.tInverse };
  if (count > 0) return { label: `${count} of ${min}`, tone: 'warning', chip: C.primary, chipText: C.tInverse };
  return { label: `Min ${min}`, tone: 'neutral', chip: C.muted, chipText: C.tSecondary };
}

const THUMBS_SHOWN = 4;

/**
 * SiteTourActivity: the site photos with comments under the unit's sections (Admin → Site Tour Sections: at most each
 * section's maximum, the team's photos included), or, in pick mode, a list to pick an evidence from.
 */
export function SiteTourScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const insets = useSafeAreaInsets();
  const { params } = useRoute<{ pickEvidence?: boolean; onResult?: (id: string | null) => void }>();
  const pickMode = params.pickEvidence === true;
  const pickText = useAppText('app.assessor.siteTour.pickInstruction');
  const tourText = useAppText('app.assessor.siteTour.tourInstruction');
  const [photos, setPhotos] = useState<PhotoInformation[] | null>(null);
  const [expanded, setExpanded] = useState<string[]>([]);
  const coords = useRef<Coordinates | null>(null);
  const picked = useRef(false);

  const reload = () => app.store.evidencesOfType(app.userId, EVIDENCE_SITE_TOUR).then(setPhotos);

  useEffect(() => {
    reload();
    // Instructions shown once (getPreferences of SiteTourActivity).
    const once = (key: string, text: { html: string } | null) => {
      if (app.prefs.get(PREFS.siteTour, key) != null || !text) return;
      ui.alert(null, htmlToPlain(text.html), [{ text: 'OK', onPress: () => app.prefs.setBoolean(PREFS.siteTour, key, true) }], true);
    };
    if (pickMode) once(PREFS.pickInstruction, pickText);
    once(PREFS.tourInstruction, tourText);
    return () => {
      // Back without a pick: RESULT_CANCELED.
      if (pickMode && !picked.current) params.onResult?.(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openPhoto = (index: number | null, section: string | null = null) => {
    if (pickMode && index != null) {
      picked.current = true;
      nav.pop();
      params.onResult?.(photos![index]!.evidenceId ?? null);
      return;
    }
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
  const maxTotal = sections.reduce((n, s) => n + s.max, 0);
  const total = sections.reduce((n, s) => n + (counts[s.key] ?? 0), 0);
  const canAdd = !pickMode && photos != null;
  const groups = groupTour(sections, list);
  const done = sections.filter(s => (counts[s.key] ?? 0) >= s.min).length;
  const minTotal = sections.reduce((n, s) => n + s.min, 0);

  return (
    <Page testID="site-tour">
      <HeroHeader title="Site Tour" subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]}>
        <View style={styles.summary}>
          <View style={z.rowCenter}>
            <ZIcon name="image" size={22} color={C.primaryDark} />
            <View style={styles.summaryText}>
              <Text style={styles.summaryTitle} testID="site-tour-count">{`${total} of ${maxTotal} photos captured`}</Text>
              <Text style={styles.summarySub}>{`${done} of ${sections.length} sections complete · min ${minTotal} photos`}</Text>
            </View>
          </View>
          <View style={styles.summaryBar}>
            <ProgressBar value={maxTotal ? total / maxTotal : 0} />
          </View>
        </View>
        {pickMode ? <Strip text="Tap a photo to use it as evidence." tone="info" /> : null}
        {!pickMode && photos != null && list.length === 0 ? <Strip text="Walk the unit in flow order and capture each section." tone="warning" /> : null}
        <SectionLabel label="Material flow · inward to outward" brand />
        {groups.map((g, gi) => {
          // The section's photos: the team's uploaded ones and this phone's (the list shows this phone's).
          const count = g.key === OTHER ? g.items.length : (counts[g.key] ?? 0);
          const st = sectionStatus(count, g.min);
          const section = g.key === OTHER ? null : g.key;
          const addHere = canAdd && section != null && g.max != null && count < g.max;
          // "+n" opens the rest of the section's photos, so each stays reachable (edit or pick).
          const open = expanded.includes(g.key);
          const extra = open ? 0 : g.items.length - THUMBS_SHOWN;
          return (
            <Card key={g.key} style={styles.sectionCard} onPress={addHere ? () => openPhoto(null, section) : undefined} testID={`site-tour-section-${g.key}`}>
              <View style={styles.rail}>
                <View style={[styles.flowChip, { backgroundColor: st.chip }]}>
                  <Text style={[styles.flowChipText, { color: st.chipText }]}>{g.key === OTHER ? '·' : gi + 1}</Text>
                </View>
                {gi < groups.length - 1 ? (
                  <View style={styles.railLine}>
                    {[0, 1, 2, 3].map(d => (
                      <View key={d} style={styles.railDot} />
                    ))}
                  </View>
                ) : null}
              </View>
              <View style={styles.sectionBody}>
                <View style={styles.sectionHead}>
                  <View style={styles.sectionTitles}>
                    <Text style={styles.sectionTitle} numberOfLines={1}>
                      {g.title}
                    </Text>
                    <Text style={styles.sectionHint} numberOfLines={1}>
                      {g.hint}
                    </Text>
                  </View>
                  <Badge label={st.label} tone={st.tone} small testID={`site-tour-badge-${g.key}`} />
                </View>
                <View style={styles.thumbs}>
                  {g.items.slice(0, open ? undefined : THUMBS_SHOWN).map(({ photo, index }) => (
                    <Pressable key={photo.evidenceId ?? index} style={styles.thumb} onPress={() => openPhoto(index)} testID={`site-tour-${index}`}>
                      {photo.photo ? <Image source={{ uri: dataUri(photo.photo) }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <ZIcon name="image" size={14} color={C.primaryDark} />}
                      <View style={styles.thumbPin}>
                        <ZIcon name="map-pin" size={7} color={C.tInverse} strokeWidth={2.4} />
                      </View>
                    </Pressable>
                  ))}
                  {extra > 0 ? (
                    <Pressable style={[styles.thumb, styles.moreThumb]} onPress={() => setExpanded(e => [...e, g.key])} testID={`site-tour-more-${g.key}`}>
                      <Text style={styles.more}>{`+${extra}`}</Text>
                    </Pressable>
                  ) : null}
                  {addHere ? (
                    <Pressable style={[styles.thumb, styles.addThumb]} onPress={() => openPhoto(null, section)} testID={`site-tour-add-${g.key}`}>
                      <ZIcon name="plus" size={14} color={C.primary} />
                    </Pressable>
                  ) : null}
                </View>
              </View>
              {addHere ? (
                <View style={styles.chevron}>
                  <ZIcon name="chevron-right" size={18} color={C.tMuted} />
                </View>
              ) : null}
            </Card>
          );
        })}
        {!pickMode ? (
          <>
            <ZButton title="Done" onPress={() => nav.pop()} style={styles.done} testID="site-tour-done" />
            <Text style={styles.footer}>Every photo is geo-tagged and time-stamped automatically.</Text>
          </>
        ) : null}
      </ScrollView>
    </Page>
  );
}

/** NewSitePhotoActivity: a site tour photo and its comment (new, or edit of one already taken). */
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

  const pickSection = async () => {
    const i = await ui.pickItem('Section', sections.map((s, n) => `${n + 1}. ${s.title}`));
    if (i == null) return;
    setSection(sections[i]?.key ?? null);
  };

  const onComment = (t: string) => {
    setComment(t);
    setCommentError(false);
  };

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

  const index = sections.findIndex(s => s.key === section);
  const current = index >= 0 ? sections[index]! : null;
  // Photos already filed under the section (this one excluded): the team's uploaded ones and this phone's.
  const others = tour.filter(p => p.evidenceId !== evidence?.evidenceId);
  const inSection = section ? (tourCounts(sections, others, !!app.details?.isSiteTourSubmitted)[section] ?? 0) : 0;
  const maxTotal = sections.reduce((n, s) => n + s.max, 0);

  return (
    <Page testID="new-site-photo">
      <HeroHeader title={editMode ? 'Edit tour photo' : 'Add tour photo'} subtitle={app.zedId} onBack={() => nav.pop()} />
      <ScrollView contentContainerStyle={[z.screenPad, { paddingBottom: 32 + insets.bottom }]} keyboardShouldPersistTaps="handled">
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
          <Viewfinder photo={evidence?.photo} onShutter={take} counter={editMode ? null : `Photo ${tour.length + 1} / ${maxTotal}`} testID="site-photo" />
          <View style={[z.rowBetween, styles.remarkHead]}>
            <Text style={[styles.noteLabel, styles.flush]}>REMARK</Text>
            <CharCounter used={comment.length} limit={COMMENT_LIMIT} />
          </View>
          <NoteBox value={comment} onChangeText={onComment} placeholder="Add a remark for this photo" error={commentError} testID="site-photo-comment" />
          {commentError ? <Text style={styles.error}>Required</Text> : null}
          <Text style={styles.hint}>Geo-coordinates and timestamp are added automatically.</Text>
          <SheetActions title={editMode ? 'Update photo' : 'Save photo'} onSave={add} onCancel={() => nav.pop()} saveID="site-photo-submit" cancelID="site-photo-cancel" />
        </Card>
      </ScrollView>
    </Page>
  );
}

const styles = StyleSheet.create({
  finder: { height: 210, borderRadius: 14, backgroundColor: '#18223A', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginTop: 4 },
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
  noteLabel: { fontSize: 11, fontWeight: '600', color: C.tMuted, letterSpacing: 0.4, marginTop: 14, marginBottom: 6 },
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
  sectionCard: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 12, marginBottom: 10, borderRadius: 12 },
  rail: { width: 28, alignItems: 'center', marginRight: 12 },
  railLine: { flex: 1, justifyContent: 'space-evenly', marginTop: 6, marginBottom: -14 },
  railDot: { width: 2, height: 3, borderRadius: 1, backgroundColor: C.border },
  flowChip: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  flowChipText: { fontSize: 11, fontWeight: '700' },
  sectionBody: { flex: 1 },
  sectionHead: { flexDirection: 'row', alignItems: 'flex-start' },
  sectionTitles: { flex: 1, marginRight: 8 },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: C.tPrimary },
  sectionHint: { fontSize: 11, color: C.tMuted, marginTop: 3 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  thumb: { width: 34, height: 34, borderRadius: 6, backgroundColor: C.primaryBg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbPin: { position: 'absolute', top: 1, right: 1, width: 10, height: 10, borderRadius: 5, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  moreThumb: { backgroundColor: C.muted },
  addThumb: { backgroundColor: C.surface, borderWidth: 1.4, borderColor: C.primary },
  more: { fontSize: 11, fontWeight: '700', color: C.tSecondary },
  chevron: { justifyContent: 'center', marginLeft: 6 },
  done: { marginTop: 4 },
  footer: { fontSize: 10, color: C.tMuted, textAlign: 'center', marginTop: 10 },
  flush: { marginTop: 0 },
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
