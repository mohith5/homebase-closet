import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import Logger from './logger';

const BUCKET = 'closet';
const MAX_DIMENSION = 1280; // cap the long edge at this for Claude (well under the 8000px hard limit)

export async function uploadPhoto(localUri, remotePath) {
  Logger.info('Storage', 'Uploading photo', { remotePath });
  const done = Logger.perf('Storage', 'upload');
  try {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const ext = localUri.split('.').pop()?.toLowerCase() || 'jpg';
    const mimeType = ext === 'png' ? 'image/png' : 'image/jpeg';
    const byteArray = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .upload(remotePath, byteArray, { contentType: mimeType, upsert: true });
    if (error) { Logger.error('Storage', 'Upload failed', error); throw error; }
    Logger.info('Storage', 'Upload OK', { path: data.path });
    done();
    return data.path;
  } catch (e) {
    Logger.error('Storage', 'uploadPhoto threw', e);
    throw e;
  }
}

export async function getSignedUrl(path) {
  try {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 3600);
    if (error) { Logger.warn('Storage', 'Signed URL failed', error); return null; }
    return data.signedUrl;
  } catch (e) {
    Logger.error('Storage', 'getSignedUrl threw', e);
    return null;
  }
}

/**
 * Read image as base64 for Claude's vision API.
 *
 * Claude rejects images whose width OR height exceeds 8000px, independent of
 * file size — a modern phone photo can be small in bytes yet 9000+px on the
 * long edge. So we ALWAYS normalize through ImageManipulator and constrain the
 * LONG edge to MAX_DIMENSION (capping only width would let tall portrait photos
 * stay over the pixel limit). This guarantees no dimension can trip the 8000px
 * cap and also keeps the payload well under the 5MB byte limit.
 */
export async function imageToBase64(uri) {
  try {
    // A no-op manipulate reads true pixel dimensions (post-orientation).
    const probe = await ImageManipulator.manipulateAsync(uri, [], { compress: 1 });
    const longEdge = Math.max(probe.width, probe.height);
    Logger.debug('Storage', `Image dimensions: ${probe.width}x${probe.height}`);

    // Resize the long edge to MAX_DIMENSION. expo-image-manipulator preserves
    // aspect ratio when only one of width/height is given, so pick the axis
    // that is actually the longer one.
    const resize = probe.width >= probe.height
      ? { width: MAX_DIMENSION }
      : { height: MAX_DIMENSION };

    // Only downscale — never upscale a small image.
    const ops = longEdge > MAX_DIMENSION ? [{ resize }] : [];

    const out = await ImageManipulator.manipulateAsync(
      uri,
      ops,
      { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
    );

    const outInfo = await FileSystem.getInfoAsync(out.uri, { size: true });
    Logger.info('Storage', `Normalized to ${out.width}x${out.height}, ${((outInfo.size || 0) / 1024 / 1024).toFixed(1)}MB`);

    return FileSystem.readAsStringAsync(out.uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    Logger.error('Storage', 'imageToBase64 failed, trying raw', e);
    // Fallback: read raw even if large (better to attempt than to hard-fail).
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
}
