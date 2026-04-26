/**
 * Simple async key-value store using AsyncStorage.
 * Drop-in replacement for MMKV that works in Expo Go.
 * Synchronous-looking API with async internals cached in memory.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from './logger';

const PREFIX = 'hbc_kv_';
const memCache = {};

export const KV = {
  async get(key) {
    if (memCache[key] !== undefined) return memCache[key];
    try {
      const val = await AsyncStorage.getItem(PREFIX + key);
      const parsed = val ? JSON.parse(val) : null;
      memCache[key] = parsed;
      return parsed;
    } catch (e) {
      Logger.error('KV', `get ${key} failed`, e);
      return null;
    }
  },
  async set(key, value) {
    try {
      memCache[key] = value;
      await AsyncStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch (e) {
      Logger.error('KV', `set ${key} failed`, e);
    }
  },
  async remove(key) {
    try {
      delete memCache[key];
      await AsyncStorage.removeItem(PREFIX + key);
    } catch (e) {
      Logger.error('KV', `remove ${key} failed`, e);
    }
  },
};
