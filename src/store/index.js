import { create } from 'zustand';
import Logger from '../lib/logger';

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
  setProfiles: (profiles) => {
    Logger.info('Store', 'setProfiles', { count: profiles.length });
    set({ profiles });
  },
  setActiveProfileIndex: (i) => set({ activeProfileIndex: i }),
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
