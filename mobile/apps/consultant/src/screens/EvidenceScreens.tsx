import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { htmlToPlain, Icon, OutlinedInput, useAppText, useNavigation, useRoute, useUi, type Coordinates } from '@zed/shared';
import { icons } from '../assets/icons';
import { useSa } from '../app/context';
import { PREFS } from '../db/stores';
import { useInlineCapture } from '../photo/capture';
import { EVIDENCE_SITE_TOUR, newPhotoInformation, type PhotoInformation } from '../models';
import { PhotoTile, SaButton, SaFrame, sa } from '../ui/kit';
import { randomUuid } from '../util/uuid';

const MAX_SITE_TOUR = 20;

/**
 * SiteTourActivity: up to 20 site photos with comments, each with its edit button. (Its pick mode, for the evidences of
 * the old question screens, is not reachable in this app.)
 */
export function SiteTourScreen() {
  const app = useSa();
  const ui = useUi();
  const nav = useNavigation();
  const tourText = useAppText('app.consultant.siteTour.tourInstruction');
  const [photos, setPhotos] = useState<PhotoInformation[] | null>(null);
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

  const openPhoto = (index: number | null) => {
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
          <View key={p.evidenceId ?? i} style={styles.tourTile} testID={`site-tour-${i}`}>
            <View style={styles.tourImage}>
              {p.photo ? <Image source={{ uri: `data:image/jpeg;base64,${p.photo.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="stretch" /> : null}
              <Pressable style={styles.editButton} onPress={() => openPhoto(i)} testID={`site-tour-${i}-edit`} hitSlop={6}>
                <Icon icon={icons.ic_baseline_edit_24} size={24} />
              </Pressable>
            </View>
            <Text style={styles.tourComment}>{p.comment ?? ''}</Text>
          </View>
        ))}
        {photos != null && list.length < MAX_SITE_TOUR ? (
          <Pressable style={styles.tourTile} onPress={() => openPhoto(null)} testID="site-tour-add">
            <View style={[styles.tourImage, styles.center]}>
              <Text style={styles.tapHere}>{list.length === 0 ? 'Take Photo' : 'Add More'}</Text>
            </View>
          </Pressable>
        ) : null}
        <SaButton title="Done" large onPress={() => nav.pop()} testID="site-tour-done" />
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
  count: { color: sa.darkGrey, fontSize: 15, fontWeight: 'bold', padding: 12 },
  tourTile: { alignSelf: 'flex-start', marginBottom: 10 },
  tourImage: { width: 128, height: 128, backgroundColor: sa.paleGrey, borderColor: sa.silver, borderWidth: 0.5, borderRadius: 3, overflow: 'hidden' },
  center: { alignItems: 'center', justifyContent: 'center' },
  tapHere: { color: sa.darkGrey, fontSize: 15 },
  tourComment: { color: sa.darkGrey, fontSize: 14, maxWidth: 200, marginTop: 4 },
  editButton: { position: 'absolute', right: 4, top: 4, backgroundColor: '#FFFFFFCC', borderRadius: 12, padding: 2 },
});
