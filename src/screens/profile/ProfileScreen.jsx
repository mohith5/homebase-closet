import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, Alert, ActivityIndicator,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius } from '../../theme';
import { useAppStore } from '../../store';
import { HEADER_PADDING_TOP } from '../../lib/device';

const BODY_TYPES  = ['Slim','Athletic','Average','Stocky','Tall-Slim','Broad Shoulders','Petite','Curvy','Plus Size'];
const SKIN_TONES  = ['Fair','Light','Medium','Olive','Tan','Dark','Deep'];
const STYLE_VIBES = ['Classic','Minimalist','Casual','Smart Casual','Streetwear','Bohemian','Bold','Preppy','Edgy'];
const OCCASIONS   = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const HAIR_TYPES   = ['Straight','Wavy','Curly','Coily'];
const HAIR_LENGTHS = ['Bald/Very Short','Short','Medium','Long','Very Long'];
const HAIR_METHODS = ['Blowdry & Straighten','Blowdry & Curl','Air Dry Natural','Diffuse (Curly)','Quick Towel Dry','Always Wear Cap/Hat'];
const HAIR_TOOLS   = ['Blowdryer','Straightener','Curling Iron','Diffuser','Round Brush','No Tools'];

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { profiles, activeProfileIndex, setActiveProfileIndex, setProfiles, updateProfile, setSession, showToast, session, householdId } = useAppStore();
  const profile = profiles[activeProfileIndex];
  const [form, setForm] = useState(profile ? { ...profile } : {});
  const [saving, setSaving] = useState(false);
  const [addingProfile, setAddingProfile] = useState(false);

  // Sync form when switching profiles
  React.useEffect(() => { if (profile) setForm({ ...profile }); }, [activeProfileIndex]);

  const toggle = (field, val) => setForm(f => {
    const a = f[field] || [];
    return { ...f, [field]: a.includes(val) ? a.filter(x => x !== val) : [...a, val] };
  });

  async function save() {
    setSaving(true);
    Logger.info('Profile', 'Saving profile', { id: profile.id });
    const { error } = await supabase.from('closet_profiles').update(form).eq('id', profile.id);
    if (error) {
      Logger.error('Profile', 'Save failed', error);
      showToast('Could not save profile');
    } else {
      updateProfile(form);
      showToast('Profile updated');
      Logger.info('Profile', 'Saved OK');
    }
    setSaving(false);
  }

  async function addSecondProfile() {
    if (profiles.length >= 2) { showToast('Maximum 2 profiles per household'); return; }
    setAddingProfile(true);
    Logger.info('Profile', 'Adding second profile');
    try {
      const label = profiles[0]?.label === 'His' ? 'Hers' : 'His';
      const { data, error } = await supabase.from('closet_profiles').insert({
        label,
        display_name: label === 'Hers' ? 'Her' : 'Him',
        household_id: householdId,
        user_id: session.user.id,
      }).select().single();
      if (error) throw error;
      setProfiles([...profiles, data]);
      setActiveProfileIndex(profiles.length);
      setForm({ ...data });
      showToast(`${label} profile added — fill in details and save`);
      Logger.info('Profile', 'Second profile added', { id: data.id });
    } catch (e) {
      Logger.error('Profile', 'Add profile failed', e);
      showToast('Could not add profile: ' + e.message);
    }
    setAddingProfile(false);
  }

  async function signOut() {
    Alert.alert('Sign Out', 'Sign out of HomeBase Closet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign Out', style: 'destructive', onPress: async () => {
          Logger.info('Profile', 'Signing out');
          await supabase.auth.signOut();
          setSession(null);
        }
      }
    ]);
  }

  if (!profile) return null;

  return (
    <View style={styles.screen}>
      <LinearGradient colors={Gradients.header} style={[styles.header, { paddingTop: HEADER_PADDING_TOP }]}>
        <Text style={styles.headerTitle}>Profile</Text>
        <Text style={styles.headerSub}>Edit your style profile</Text>
      </LinearGradient>

      {/* Profile switcher */}
      <View style={styles.switcher}>
          {profiles.map((p, i) => (
            <TouchableOpacity
              key={p.id}
              onPress={() => setActiveProfileIndex(i)}
              style={[styles.switchBtn, i === activeProfileIndex && styles.switchBtnActive]}
            >
              <Text style={[styles.switchLabel, i === activeProfileIndex && styles.switchLabelActive]}>
                {i === 0 ? '👔' : '👗'} {p.display_name || p.label}
              </Text>
            </TouchableOpacity>
          ))}
          {profiles.length < 2 && (
            <TouchableOpacity onPress={addSecondProfile} disabled={addingProfile} style={styles.addProfileBtn}>
              {addingProfile ? <ActivityIndicator color={Colors.accent2} size="small" /> : <Text style={styles.addProfileText}>+ Add Hers</Text>}
            </TouchableOpacity>
          )}
        </View>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>
        <Field label="Display Name">
          <TextInput style={styles.input} value={form.display_name || ''} onChangeText={v => setForm(f => ({ ...f, display_name: v }))} placeholder="Your name" placeholderTextColor={Colors.text3} />
        </Field>
        <Field label="Body Type">
          <View style={styles.pills}>{BODY_TYPES.map(b => <Pill key={b} label={b} active={form.body_type === b} onPress={() => setForm(f => ({ ...f, body_type: b }))} />)}</View>
        </Field>
        <Field label="Skin Tone">
          <View style={styles.pills}>{SKIN_TONES.map(s => <Pill key={s} label={s} active={form.skin_tone === s} onPress={() => setForm(f => ({ ...f, skin_tone: s }))} />)}</View>
        </Field>
        <Field label="Style Vibe">
          <View style={styles.pills}>{STYLE_VIBES.map(s => <Pill key={s} label={s} active={(form.style_vibe || []).includes(s)} onPress={() => toggle('style_vibe', s)} />)}</View>
        </Field>
        <Field label="Occasions">
          <View style={styles.pills}>{OCCASIONS.map(o => <Pill key={o} label={o} active={(form.occasions || []).includes(o)} onPress={() => toggle('occasions', o)} />)}</View>
        </Field>
        <Field label="Hair Type">
          <View style={styles.pills}>{HAIR_TYPES.map(h => <Pill key={h} label={h} active={form.hair_type === h} onPress={() => setForm(f => ({ ...f, hair_type: h }))} />)}</View>
        </Field>
        <Field label="Hair Length">
          <View style={styles.pills}>{HAIR_LENGTHS.map(h => <Pill key={h} label={h} active={form.hair_length === h} onPress={() => setForm(f => ({ ...f, hair_length: h }))} />)}</View>
        </Field>
        <Field label="How You Style Your Hair">
          <Text style={styles.fieldHint}>Stylie uses this to suggest realistic hairstyles you can actually do</Text>
          <View style={styles.pills}>{HAIR_METHODS.map(h => <Pill key={h} label={h} active={form.hair_styling_method === h} onPress={() => setForm(f => ({ ...f, hair_styling_method: h }))} />)}</View>
        </Field>
        <Field label="Hair Tools You Own">
          <View style={styles.pills}>{HAIR_TOOLS.map(h => <Pill key={h} label={h} active={(form.hair_styling_tools||[]).includes(h)} onPress={() => toggle('hair_styling_tools', h)} />)}</View>
        </Field>

        <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.8}>
          <LinearGradient colors={Gradients.accent} style={[styles.saveBtn, saving && { opacity: 0.6 }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Save Profile</Text>}
          </LinearGradient>
        </TouchableOpacity>

        {/* App info */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>HomeBase Closet</Text>
          <Text style={styles.infoSub}>Linked to your HomeBase household · Secure · Private</Text>
          <View style={styles.infoDivider} />
          <Text style={styles.infoRow}>📊 {useAppStore.getState().wardrobe.length} wardrobe items</Text>
          <Text style={styles.infoRow}>✨ {useAppStore.getState().outfitHistory.length} outfits generated</Text>
        </View>

        <TouchableOpacity onPress={signOut} style={styles.signOutBtn}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function Field({ label, children }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: Spacing.lg, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  switcher: { flexDirection: 'row', padding: 12, gap: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  addProfileBtn: { paddingHorizontal: 12, paddingVertical: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.accent2, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(29,78,216,0.08)' },
  addProfileText: { fontSize: 12, fontWeight: '700', color: Colors.accent2 },
  switchBtn: { flex: 1, padding: 10, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, alignItems: 'center', backgroundColor: Colors.bg3 },
  switchBtnActive: { borderColor: Colors.accent2, backgroundColor: 'rgba(29,78,216,0.15)' },
  switchLabel: { fontSize: 13, fontWeight: '600', color: Colors.text2 },
  switchLabelActive: { color: Colors.accent2 },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  fieldHint: { fontSize: 11, color: Colors.text3, marginBottom: 8, lineHeight: 16 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  input: { backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.md, padding: 13, fontSize: 15, color: Colors.text },
  saveBtn: { padding: 15, borderRadius: Radius.md, alignItems: 'center', marginBottom: 24 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  infoCard: { backgroundColor: Colors.bg3, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20 },
  infoTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  infoSub: { fontSize: 12, color: Colors.text3, marginBottom: 12 },
  infoDivider: { height: 1, backgroundColor: Colors.border, marginBottom: 10 },
  infoRow: { fontSize: 13, color: Colors.text2, marginBottom: 6 },
  signOutBtn: { padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.error + '40', alignItems: 'center', marginBottom: 20 },
  signOutText: { color: Colors.error, fontSize: 14, fontWeight: '600' },
});
