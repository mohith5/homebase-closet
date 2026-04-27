/**
 * Vision pipeline: photo → detect items → crop each item → dedup → upload
 *
 * Flow:
 * 1. Claude detects items with bounding boxes (% coordinates)
 * 2. ImageManipulator crops each item from original photo
 * 3. Fingerprint matching deduplicates against existing wardrobe
 * 4. Cropped clean product shots uploaded to Supabase Storage
 */
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { splitOutfitIntoItems } from './claude';
import { imageToBase64, uploadPhoto } from './storage';
import Logger from './logger';

const BUCKET = 'closet';

/**
 * Crop a specific item from the original photo using bbox % coordinates.
 * Returns a local URI of the cropped image.
 */
export async function cropItemFromPhoto(originalUri, bbox, imageWidth, imageHeight) {
  const { left, top, width, height } = bbox;

  // Add padding around the item (8% on each side) so it's not too tight
  const PAD = 5;
  const cropLeft   = Math.max(0, (left - PAD) / 100 * imageWidth);
  const cropTop    = Math.max(0, (top - PAD) / 100 * imageHeight);
  const cropWidth  = Math.min(imageWidth - cropLeft, (width + PAD * 2) / 100 * imageWidth);
  const cropHeight = Math.min(imageHeight - cropTop, (height + PAD * 2) / 100 * imageHeight);

  Logger.debug('Vision', `Cropping item: L${cropLeft.toFixed(0)} T${cropTop.toFixed(0)} W${cropWidth.toFixed(0)} H${cropHeight.toFixed(0)}`);

  const result = await ImageManipulator.manipulateAsync(
    originalUri,
    [
      { crop: { originX: cropLeft, originY: cropTop, width: cropWidth, height: cropHeight } },
      { resize: { width: 600 } }, // normalize to 600px wide — consistent product shot
    ],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
  );

  return result.uri;
}

/**
 * Get image dimensions from a local URI.
 */
export async function getImageDimensions(uri) {
  return new Promise((resolve) => {
    // Use ImageManipulator to get dimensions by doing a no-op
    ImageManipulator.manipulateAsync(uri, [], { compress: 1 }).then(r => {
      resolve({ width: r.width, height: r.height });
    }).catch(() => resolve({ width: 1080, height: 1920 })); // fallback
  });
}

/**
 * Generate a dedup fingerprint from an item.
 * Items with same fingerprint = same item across multiple photos.
 */
function makeFingerprint(item) {
  // Use Claude's fingerprint if provided, otherwise build one
  if (item.fingerprint) return item.fingerprint.toLowerCase().replace(/\s+/g, '-');
  const parts = [
    item.brand || '',
    item.model || '',
    item.category || '',
    item.color || '',
  ].filter(Boolean).map(s => s.toLowerCase().replace(/\s+/g, '-'));
  return parts.join('_');
}

/**
 * Check if an item already exists in wardrobe using fingerprint similarity.
 * Returns the existing item if match found, null otherwise.
 */
function findDuplicate(item, existingWardrobe) {
  const fp = makeFingerprint(item);
  if (!fp || fp.length < 4) return null; // too vague to dedup

  for (const existing of existingWardrobe) {
    const existingFp = makeFingerprint(existing);
    if (!existingFp) continue;

    // Exact match
    if (fp === existingFp) {
      Logger.info('Vision', `Exact duplicate found: "${item.name}" matches "${existing.name}"`);
      return existing;
    }

    // Fuzzy match — same brand + category + color
    const fpParts = new Set(fp.split('_').filter(p => p.length > 2));
    const exParts = new Set(existingFp.split('_').filter(p => p.length > 2));
    const shared = [...fpParts].filter(p => exParts.has(p));
    if (shared.length >= 2 && item.category === existing.category) {
      Logger.info('Vision', `Fuzzy duplicate: "${item.name}" ≈ "${existing.name}" (shared: ${shared.join(',')})`);
      return existing;
    }
  }
  return null;
}

/**
 * Full pipeline: analyze photo → crop items → dedup → return results ready to save.
 *
 * Returns array of:
 * {
 *   item: { name, category, color, brand, model, ... },
 *   croppedUri: string (local URI of cropped product shot),
 *   isDuplicate: boolean,
 *   duplicateOf: existing wardrobe item | null,
 *   fingerprint: string,
 * }
 */
export async function processPhotoIntoItems(originalUri, existingWardrobe = []) {
  Logger.info('Vision', 'Starting full photo pipeline', { uri: originalUri.slice(-30) });
  const done = Logger.perf('Vision', 'processPhotoIntoItems');

  // Step 1: Get image dimensions for accurate cropping
  const { width: imgW, height: imgH } = await getImageDimensions(originalUri);
  Logger.info('Vision', `Image dimensions: ${imgW}x${imgH}`);

  // Step 2: Compress + convert to base64 for Claude
  const base64 = await imageToBase64(originalUri);

  // Step 3: Claude detects items with bounding boxes
  const detected = await splitOutfitIntoItems(base64, 'image/jpeg');
  Logger.info('Vision', `Claude detected ${detected.length} items`);

  // Step 4: For each item — crop + dedup
  const results = await Promise.all(detected.map(async (item) => {
    const fingerprint = makeFingerprint(item);
    const duplicate = findDuplicate(item, existingWardrobe);

    // Crop the item from the original photo if bbox is valid
    let croppedUri = null;
    if (item.bbox && item.bbox.width > 5 && item.bbox.height > 5) {
      try {
        croppedUri = await cropItemFromPhoto(originalUri, item.bbox, imgW, imgH);
        Logger.info('Vision', `Cropped: ${item.name} (${item.bbox.width.toFixed(0)}x${item.bbox.height.toFixed(0)}%)`);
      } catch (e) {
        Logger.error('Vision', `Crop failed for ${item.name}`, e);
      }
    } else {
      Logger.warn('Vision', `No valid bbox for ${item.name} — will use emoji fallback`);
    }

    return {
      item: {
        name: item.name || item.category,
        category: item.category,
        color: item.color,
        colors: item.colors || [item.color].filter(Boolean),
        material: item.material || '',
        fit: item.fit || '',
        brand: item.brand || '',
        model: item.model || '',
      },
      croppedUri,
      fingerprint,
      isDuplicate: !!duplicate,
      duplicateOf: duplicate || null,
    };
  }));

  done();
  return results;
}

/**
 * Upload a cropped item photo to Supabase Storage.
 * Returns the storage path (not a URL — convert with createSignedUrl).
 */
export async function uploadCroppedPhoto(croppedUri, profileId) {
  if (!croppedUri) return null;
  try {
    const path = `${profileId}/items/${Date.now()}_${Math.random().toString(36).slice(2,7)}.jpg`;
    const storagePath = await uploadPhoto(croppedUri, path);
    Logger.info('Vision', `Uploaded cropped photo: ${storagePath}`);
    return storagePath;
  } catch (e) {
    Logger.error('Vision', 'Cropped photo upload failed', e);
    return null;
  }
}

/**
 * Get a signed URL for a storage path.
 */
export async function getSignedPhotoUrl(storagePath) {
  if (!storagePath) return null;
  if (storagePath.startsWith('http')) return storagePath;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, 3600);
  return data?.signedUrl || null;
}
