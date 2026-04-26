import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import Logger from './logger';

const SUPABASE_URL = 'https://wpzgcwvjzhzurmbirdsj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indwemdjd3Zqemh6dXJtYmlyZHNqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MDI4MjksImV4cCI6MjA5MDQ3ODgyOX0.ItnKc6cuVJAk-2cmvY-a1e3dXLW1L-Xiqm83wAmQl1M';

/* ── Secure storage adapter for session tokens ── */
const SecureStoreAdapter = {
  getItem: async (key) => {
    try {
      const val = await SecureStore.getItemAsync(key);
      Logger.debug('SecureStore', `GET ${key}`, val ? '(found)' : '(null)');
      return val;
    } catch (e) {
      Logger.error('SecureStore', `GET failed for ${key}`, e);
      return null;
    }
  },
  setItem: async (key, value) => {
    try {
      await SecureStore.setItemAsync(key, value);
      Logger.debug('SecureStore', `SET ${key}`);
    } catch (e) {
      Logger.error('SecureStore', `SET failed for ${key}`, e);
    }
  },
  removeItem: async (key) => {
    try {
      await SecureStore.deleteItemAsync(key);
      Logger.debug('SecureStore', `DEL ${key}`);
    } catch (e) {
      Logger.error('SecureStore', `DEL failed for ${key}`, e);
    }
  },
};

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: SecureStoreAdapter,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

Logger.info('Supabase', 'Client initialized', { url: SUPABASE_URL });

/* ── Typed query helpers with logging ── */
export async function sbQuery(tag, queryFn) {
  const done = Logger.perf(tag, 'query');
  try {
    const result = await queryFn(supabase);
    if (result.error) {
      Logger.error(tag, 'Query error', result.error);
      throw result.error;
    }
    Logger.debug(tag, `Query OK — ${Array.isArray(result.data) ? result.data.length + ' rows' : 'single row'}`);
    done();
    return result.data;
  } catch (e) {
    Logger.error(tag, 'Query threw', e);
    throw e;
  }
}

export default supabase;
