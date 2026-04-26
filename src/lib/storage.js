import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from './supabase';
import Logger from './logger';

const BUCKET = 'closet';
const MAX_CLAUDE_BYTES = 4 * 1024 * 1024; // 4MB — Claude max is 5MB, leave headroom
const MAX_DIMENSION = 1280; // resize long edge to this for Claude

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
 * Read image as base64 — compresses if over Claude's 5MB limit.
 * iOS photos can be 8-12MB; this brings them under 4MB reliably.
 */
export async function imageToBase64(uri) {
  try {
    // Check raw size first
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    const rawBytes = info.size || 0;
    Logger.debug('Storage', `Raw image size: ${(rawBytes / 1024 / 1024).toFixed(1)}MB`);

    if (rawBytes > MAX_CLAUDE_BYTES) {
      Logger.info('Storage', `Compressing image from ${(rawBytes/1024/1024).toFixed(1)}MB`);
      // Resize + compress to JPEG
      const compressed = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_DIMENSION } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      const compressedInfo = await FileSystem.getInfoAsync(compressed.uri, { size: true });
      Logger.info('Storage', `Compressed to ${(compressedInfo.size / 1024 / 1024).toFixed(1)}MB`);
      return FileSystem.readAsStringAsync(compressed.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
    }

    return FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    Logger.error('Storage', 'imageToBase64 failed, trying raw', e);
    // Fallback: read raw even if large
    return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  }
}
