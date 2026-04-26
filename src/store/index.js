import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Logger from '../lib/logger';

const PROFILE_KEY = '@hbc_activeProfileId';

async function getSavedProfileId() {
  try { return await AsyncStorage.getItem(PROFILE_KEY); } catch { return null; }
}
async function saveProfileId(id) {
  try { if (id) await AsyncStorage.setItem(PROFILE_KEY, id); } catch {}
}

export const useAppStore = create((set, get) => ({
  /* ── Auth ── */
  session: null,
  householdId: null,
  setSession: (session) => {
    Logger.info('Store', 'setSession', { userId: session?.user?.id });
    set({ session });
  },
  setHouseholdId: (id) => { Logger.info('Store', 'setHouseholdId', { id }); set({ householdId: id }); },

  /* ── Profiles ── */
  profiles: [],
  activeProfileIndex: 0,
  setProfiles: async (profiles) => {
    Logger.info('Store', 'setProfiles', { count: profiles.length });
    const savedId = await getSavedProfileId();
    let idx = 0;
    if (savedId) {
      const found = profiles.findIndex(p => p.id === savedId);
      if (found >= 0) idx = found;
    }
    Logger.info('Store', `Restoring profile index ${idx}`);
    set({ profiles, activeProfileIndex: idx });
  },
  setActiveProfileIndex: (i) => {
    const profile = get().profiles[i];
    if (profile) saveProfileId(profile.id);
    Logger.info('Store', `Active profile → index ${i}`, { name: profile?.display_name });
    set({ activeProfileIndex: i });
  },
  getActiveProfile: () => get().profiles[get().activeProfileIndex] || null,
  updateProfile: (updated) => set(s => ({
    profiles: s.profiles.map((p, i) => i === s.activeProfileIndex ? { ...p, ...updated } : p)
  })),

  /* ── Wardrobe ── */
  wardrobe: [],
  wardrobeLoaded: false,
  setWardrobe: (wardrobe) => {
    Logger.info('Store', 'setWardrobe', { count: wardrobe.length });
    set({ wardrobe, wardrobeLoaded: true });
  },
  addWardrobeItem: (item) => set(s => ({ wardrobe: [item, ...s.wardrobe] })),
  removeWardrobeItem: (id) => set(s => ({ wardrobe: s.wardrobe.filter(i => i.id !== id) })),

  /* ── Outfit history ── */
  outfitHistory: [],
  setOutfitHistory: (h) => set({ outfitHistory: h }),
  addOutfitHistory: (entry) => set(s => ({ outfitHistory: [entry, ...s.outfitHistory] })),

  /* ── UI ── */
  toastMsg: null,
  showToast: (msg, duration = 3000) => {
    Logger.debug('Store', 'toast', { msg });
    set({ toastMsg: msg });
    setTimeout(() => set({ toastMsg: null }), duration);
  },
}));
