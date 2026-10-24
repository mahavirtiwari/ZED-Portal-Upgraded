import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { PhotoStore } from '../../db/photoStore';
import type { Capturer } from '../../photo/usePhotoCapture';
import { removePhoto, viewPhoto, type PhotoSource } from '../../photo/photoCapture';
import { fileUri, isSubmitted, type PhotoData } from '../../photo/photoData';
import { sharedIcons } from '../sharedIcons';
import { colors, dimens, shapes } from '../theme';
import { useUi } from '../UiHost';
import { FieldBox, FieldLabel, ZedIconButton } from './Form';
import { Icon } from './Icon';
import { zedDevice } from '../../native';

/**
 * PhotosHelper (layout_photos + image_container): the photos of one field with the "Add" (or "Upload") button.
 *
 * - The button hides once `maxPhotos` are attached or a PDF is attached.
 * - With `allowPick`, Add offers "Take Photo / Pick Photo from Gallery / Pick PDF from Gallery / Cancel"
 *   (no PDF once a photo is attached).
 * - Each row: 48 dp thumbnail (PDF icon for PDFs), "<name>\nCaptured at <time>", and
 *   done (submitted, no replace) / replay (submitted, replace allowed) / delete (allowDelete) buttons.
 */
export function PhotosField({
  label,
  photos,
  onChange,
  capturer,
  store,
  maxPhotos = 1,
  allowPick = false,
  allowDelete = true,
  allowReplace = false,
  askName,
  buttonTitle = 'Add',
  testID,
}: {
  label?: string | null;
  photos: PhotoData[];
  onChange: (photos: PhotoData[]) => void;
  capturer: Capturer;
  store: PhotoStore;
  maxPhotos?: number;
  allowPick?: boolean;
  allowDelete?: boolean;
  allowReplace?: boolean;
  /** PhotoNameHandler (surveillance site tour): a name is asked after the capture. */
  askName?: () => Promise<string | null>;
  buttonTitle?: string;
  testID?: string;
}) {
  const ui = useUi();
  const [hidden, setHidden] = useState<string | null>(null);
  const pdfAdded = photos.some(p => p.isPdf);
  const anyPhoto = photos.some(p => !p.isPdf);

  const add = async (source: PhotoSource, replace: PhotoData | null = null) => {
    if (replace) setHidden(replace.photoId);
    try {
      const photo = await capturer.capture(source, { replacePhotoId: replace?.photoId ?? null, askName });
      if (!photo) return;
      let list = photos;
      if (replace) {
        // removePhotoData of the re-captured photo, then the new one (same id) at the end.
        if (replace.photoPath) zedDevice().deleteFile(replace.photoPath);
        list = photos.filter(p => p.photoId !== replace.photoId);
      }
      onChange([...list, photo]);
    } finally {
      setHidden(null);
    }
  };

  const onAdd = async () => {
    if (!allowPick) return add('camera');
    const options = anyPhoto
      ? ['Take Photo', 'Pick Photo from Gallery', 'Cancel']
      : ['Take Photo', 'Pick Photo from Gallery', 'Pick PDF from Gallery', 'Cancel'];
    const i = await ui.pickItem(null, options);
    if (i === 0) return add('camera');
    if (i === 1) return add('gallery');
    if (i === 2 && options.length === 4) return add('pdf');
  };

  return (
    <FieldBox testID={testID}>
      <FieldLabel label={label} />
      <View style={styles.dashed}>
        {photos
          .filter(p => p.photoId !== hidden)
          .map(photo => (
            <View key={photo.photoId} style={styles.row} testID={testID ? `${testID}-photo` : undefined}>
              <Pressable onPress={() => viewPhoto(photo)}>
                {photo.isPdf ? (
                  <View style={styles.thumb}>
                    <Icon icon={sharedIcons.ic_baseline_picture_as_pdf_18} size={48} />
                  </View>
                ) : (
                  <Image source={{ uri: fileUri(photo.photoPath ?? '') }} style={styles.thumb} resizeMode="stretch" />
                )}
              </Pressable>
              <Text style={styles.name} numberOfLines={4}>
                {(photo.name != null ? photo.name + '\n' : '') + 'Captured at ' + (photo.timeStamp ?? '')}
              </Text>
              <RowAction
                photo={photo}
                allowDelete={allowDelete}
                allowReplace={allowReplace}
                onDelete={async () => {
                  onChange(photos.filter(p => p.photoId !== photo.photoId));
                  await removePhoto(store, photo);
                }}
                onReplace={() => add('camera', photo)}
                testID={testID}
              />
            </View>
          ))}
        {photos.length < maxPhotos && !pdfAdded ? (
          <ZedIconButton title={buttonTitle} icon="add" onPress={onAdd} testID={testID ? `${testID}-add` : undefined} />
        ) : null}
      </View>
    </FieldBox>
  );
}

function RowAction({
  photo,
  allowDelete,
  allowReplace,
  onDelete,
  onReplace,
  testID,
}: {
  photo: PhotoData;
  allowDelete: boolean;
  allowReplace: boolean;
  onDelete: () => void;
  onReplace: () => void;
  testID?: string;
}) {
  if (isSubmitted(photo) && !allowReplace) {
    return (
      <View style={styles.action}>
        <Icon icon={sharedIcons.ic_done} />
      </View>
    );
  }
  if (!allowDelete) return null;
  if (isSubmitted(photo) && allowReplace) {
    return (
      <Pressable style={styles.action} onPress={onReplace} testID={testID ? `${testID}-replace` : undefined}>
        <Icon icon={sharedIcons.baseline_replay_24} />
      </Pressable>
    );
  }
  return (
    <Pressable style={styles.action} onPress={onDelete} testID={testID ? `${testID}-delete` : undefined}>
      <Icon icon={sharedIcons.ic_delete} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  dashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.progressBarColor,
    borderRadius: 5,
    padding: dimens.padding1,
  },
  row: { ...shapes.greyRectangle, flexDirection: 'row', alignItems: 'flex-start', margin: dimens.padding1, padding: dimens.padding1 },
  thumb: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  name: { flex: 1, padding: dimens.padding2, color: colors.darkGrey, fontSize: 14 },
  action: { margin: 5, alignSelf: 'center' },
});
