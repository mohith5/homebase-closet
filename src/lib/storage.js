import * as FileSystem from 'expo-file-system';
import { supabase } from './supabase';
import Logger from './logger';

const BUCKET = 'closet';

/**
 * Upload a local file URI to Supabase Storage.
 * Returns the public or signed URL.
 */
export async function uploadPhoto(localUri, remotePath) {
  Logger.info('Storage', 'Uploading photo', { localUri: localUri.slice(-40), remotePath });
  const done = Logger.perf('Storage', 'upload');

  try {
    const fileInfo = await FileSystem.getInfoAsync(localUri);
    if (!fileInfo.exists) throw new Error('File does not exist: ' + localUri);

    const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
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

/**
 * Get a 1-hour signed URL for a private storage path
 */
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
 * Read a local image as base64 for Claude Vision
 */
export async function imageToBase64(uri) {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}
