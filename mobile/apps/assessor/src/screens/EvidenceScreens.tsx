import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { htmlToPlain, OutlinedInput, useAppText, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import { useInlineCapture } from '../photo/capture';
import { EVIDENCE_ADDED, EVIDENCE_SITE_TOUR, newPhotoInformation, type PhotoInformation } from '../models';
import { PhotoTile, SaButton, SaFrame, sa } from '../ui/kit';
import { randomUuid } from '../util/uuid';

const MAX_SITE_TOUR = 20;

/** NewEvidenceActivity: a new evidence photo with its name, or (pick mode) a site tour photo used as evidence. */
export function NewEvidenceScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ pickEvidence?: boolean; onResult?: (evidenceId: string | null) => void }>();
  const pickMode = params.pickEvidence === true;
  const [evidence, setEvidence] = useState<PhotoInformation>(() => newPhotoInformation(randomUuid));
  const [name, setName] = useState('');
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
    <SaFrame testID="new-evidence">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PhotoTile title="Evidence" base64={evidence.photo} onPress={pickMode ? undefined : take} testID="evidence-photo" />
        <TextInput
          style={[styles.nameInput, nameError && { borderColor: '#B00020' }]}
          value={name}
          onChangeText={onName}
          placeholder="Enter Evidence Name"
          placeholderTextColor={sa.coolGrey}
          multiline
          numberOfLines={3}
          maxLength={500}
          autoCapitalize="sentences"
          testID="evidence-name"
        />
        {nameError ? <Text style={styles.error}>Required</Text> : null}
        <SaButton title="Add Evidence" large onPress={add} testID="evidence-add" />
      </ScrollView>
    </SaFrame>
  );
}

/** SiteTourActivity: up to 20 site photos with comments (or, in pick mode, a list to pick an evidence from). */
export function SiteTourScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ pickEvidence?: boolean; onResult?: (id: string | null) => void }>();
  const pickMode = params.pickEvidence === true;
  const pickText = useAppText('app.assessor.siteTour.pickInstruction');
  const tourText = useAppText('app.assessor.siteTour.tourInstruction');
  const [photos, setPhotos] = useState<PhotoInformation[] | null>(null);
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

  const openPhoto = (index: number | null) => {
    if (pickMode && index != null) {
      picked.current = true;
      nav.pop();
      params.onResult?.(photos![index]!.evidenceId ?? null);
      return;
    }
    nav.push('NewSitePhoto', {
      evidenceId: index != null ? photos![index]!.evidenceId : null,
      coords: index == null ? coords.current : null,
      onResult: (result: { evidenceId: string; coords?: Coordinates | null }) => {
        if (result.coords) coords.current = result.coords;
        reload();
      },
    });
  };

  const list = photos ?? [];
  return (
    <SaFrame title="Site Tour" testID="site-tour">
      <Text style={styles.count} testID="site-tour-count">{`${list.length}/${MAX_SITE_TOUR} Images Added`}</Text>
      <ScrollView contentContainerStyle={styles.content}>
        {list.map((p, i) => (
          <Pressable key={p.evidenceId ?? i} style={styles.tourTile} onPress={() => openPhoto(i)} testID={`site-tour-${i}`}>
            <View style={styles.tourImage}>
              {p.photo ? <Image source={{ uri: `data:image/jpeg;base64,${p.photo.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="stretch" /> : null}
            </View>
            <Text style={styles.tourComment}>{p.comment ?? ''}</Text>
          </Pressable>
        ))}
        {!pickMode && photos != null && list.length < MAX_SITE_TOUR ? (
          <Pressable style={styles.tourTile} onPress={() => openPhoto(null)} testID="site-tour-add">
            <View style={[styles.tourImage, styles.center]}>
              <Text style={styles.tapHere}>{list.length === 0 ? 'Take Photo' : 'Add More'}</Text>
            </View>
          </Pressable>
        ) : null}
        {!pickMode ? <SaButton title="Done" large onPress={() => nav.pop()} testID="site-tour-done" /> : null}
      </ScrollView>
    </SaFrame>
  );
}

/** NewSitePhotoActivity: a site tour photo and its comment (new, or edit of one already taken). */
export function NewSitePhotoScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const { params } = useRoute<{ evidenceId?: string | null; coords?: Coordinates | null; onResult?: (r: { evidenceId: string; coords?: Coordinates | null }) => void }>();
  const [evidence, setEvidence] = useState<PhotoInformation | null>(null);
  const [comment, setComment] = useState('');
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
    (async () => {
      if (params.evidenceId) {
        const stored = await app.store.evidence(app.userId, params.evidenceId);
        if (stored?.photo?.trim()) {
          setEvidence(stored);
          setComment(stored.comment ?? '');
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

  const add = async () => {
    if (!evidence?.photo?.trim()) return ui.showAlert('Please capture Evidence photo');
    if (comment.trim() === '') {
      setCommentError(true);
      return ui.showAlert('Please enter comment');
    }
    const info: PhotoInformation = { ...evidence, comment: comment.trim(), type: EVIDENCE_SITE_TOUR };
    if (info.evidenceId == null) info.evidenceId = app.saId + Date.now();
    if (!(await app.store.saveEvidence(app.userId, info))) return ui.toast('Failed to add Evidence');
    if (!editMode) ui.toast('Photo added successfully');
    nav.pop();
    params.onResult?.({ evidenceId: info.evidenceId, coords: editMode ? undefined : coords.current });
  };

  return (
    <SaFrame testID="new-site-photo">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <PhotoTile title="Site Photo" base64={evidence?.photo} onPress={take} testID="site-photo" />
        <OutlinedInput
          value={comment}
          onChangeText={t => (setComment(t), setCommentError(false))}
          multiline
          showCounter
          maxLength={500}
          autoCapitalize="sentences"
          error={commentError ? 'Required' : null}
          testID="site-photo-comment"
        />
        <SaButton title={editMode ? 'Update Photo' : 'Submit Photo'} large onPress={add} testID="site-photo-submit" />
      </ScrollView>
    </SaFrame>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16 },
  nameInput: {
    borderColor: '#C7CACD',
    borderWidth: 1,
    borderRadius: 4,
    minHeight: 72,
    textAlignVertical: 'top',
    padding: 8,
    fontSize: 15,
    marginVertical: 8,
    color: sa.darkGrey,
  },
  error: { color: '#B00020', fontSize: 13 },
  count: { color: sa.darkGrey, fontSize: 15, fontWeight: 'bold', padding: 12 },
  tourTile: { alignSelf: 'flex-start', marginBottom: 10 },
  tourImage: { width: 128, height: 128, backgroundColor: sa.paleGrey, borderColor: sa.silver, borderWidth: 0.5, borderRadius: 3, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tapHere: { color: sa.darkGrey, fontSize: 15 },
  tourComment: { color: sa.darkGrey, fontSize: 14, maxWidth: 200, marginTop: 4 },
});
