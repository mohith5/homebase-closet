import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius } from '../../theme';
import { useAppStore } from '../../store';

const { width } = Dimensions.get('window');

const BODY_TYPES = ['Slim','Athletic','Average','Stocky','Tall-Slim','Broad Shoulders','Petite','Curvy','Plus Size'];
const SKIN_TONES = ['Fair','Light','Medium','Olive','Tan','Dark','Deep'];
const STYLE_VIBES = ['Classic','Minimalist','Casual','Smart Casual','Streetwear','Bohemian','Bold','Preppy','Edgy'];
const OCCASIONS  = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const HAIR_TYPES = ['Straight','Wavy','Curly','Coily'];
const HAIR_LENGTHS = ['Bald/Very Short','Short','Medium','Long','Very Long'];

const empty = (label) => ({ label, display_name:'', body_type:'', skin_tone:'', style_vibe:[], occasions:[], hair_type:'', hair_length:'' });

export default function OnboardingScreen({ onComplete }) {
  const insets = useSafeAreaInsets();
  const { session, householdId, setProfiles } = useAppStore();
  const [step, setStep] = useState(0); // 0=welcome, 1=his, 2=hers, 3=saving
  const [his, setHis] = useState(empty('His'));
  const [hers, setHers] = useState(empty('Hers'));
  const [saving, setSaving] = useState(false);

  const toggle = (setFn, field, val) => setFn(d => {
    const arr = d[field] || [];
    return { ...d, [field]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] };
  });

  async function finish() {
    setSaving(true);
    Logger.info('Onboarding', 'Saving profiles', { his: his.display_name, hers: hers.display_name });
    try {
      const toSave = [his, hers].filter(p => p.display_name.trim());
      const inserts = toSave.map(p => ({
        ...p,
        household_id: householdId,
        user_id: session.user.id,
      }));
      const { data, error } = await supabase.from('closet_profiles').insert(inserts).select();
      if (error) throw error;
      Logger.info('Onboarding', 'Profiles saved', { count: data.length });
      setProfiles(data);
      onComplete();
    } catch (e) {
      Logger.error('Onboarding', 'Save failed', e);
    }
    setSaving(false);
  }

  function ProfileForm({ data, setData, icon, title }) {
    return (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 120 }} showsVerticalScrollIndicator={false}>
        <View style={styles.formHeader}>
          <Text style={styles.formIcon}>{icon}</Text>
          <Text style={styles.formTitle}>{title}</Text>
        </View>

        <Field label="Display Name">
          <TextInput
            style={styles.input}
            value={data.display_name}
            onChangeText={v => setData(d => ({ ...d, display_name: v }))}
            placeholder={title === 'His Closet' ? 'e.g. M' : 'e.g. Priya'}
            placeholderTextColor={Colors.text3}
          />
        </Field>

        <Field label="Body Type">
          <View style={styles.pills}>
            {BODY_TYPES.map(b => <Pill key={b} label={b} active={data.body_type === b} onPress={() => setData(d => ({ ...d, body_type: b }))} />)}
          </View>
        </Field>

        <Field label="Skin Tone">
          <View style={styles.pills}>
            {SKIN_TONES.map(s => <Pill key={s} label={s} active={data.skin_tone === s} onPress={() => setData(d => ({ ...d, skin_tone: s }))} />)}
          </View>
        </Field>

        <Field label="Style Vibe (pick all that apply)">
          <View style={styles.pills}>
            {STYLE_VIBES.map(s => <Pill key={s} label={s} active={(data.style_vibe || []).includes(s)} onPress={() => toggle(setData, 'style_vibe', s)} />)}
          </View>
        </Field>

        <Field label="Occasions You Dress For">
          <View style={styles.pills}>
            {OCCASIONS.map(o => <Pill key={o} label={o} active={(data.occasions || []).includes(o)} onPress={() => toggle(setData, 'occasions', o)} />)}
          </View>
        </Field>

        <Field label="Hair Type">
          <View style={styles.pills}>
            {HAIR_TYPES.map(h => <Pill key={h} label={h} active={data.hair_type === h} onPress={() => setData(d => ({ ...d, hair_type: h }))} />)}
          </View>
        </Field>

        <Field label="Hair Length">
          <View style={styles.pills}>
            {HAIR_LENGTHS.map(h => <Pill key={h} label={h} active={data.hair_length === h} onPress={() => setData(d => ({ ...d, hair_length: h }))} />)}
          </View>
        </Field>
      </ScrollView>
    );
  }

  if (step === 0) return (
    <LinearGradient colors={Gradients.header} style={[styles.welcome, { paddingTop: insets.top }]}>
      <Text style={styles.welcomeIcon}>👗</Text>
      <Text style={styles.welcomeTitle}>HomeBase Closet</Text>
      <Text style={styles.welcomeSub}>Your personal AI stylist.{'\n'}Set up His & Hers profiles to get started.</Text>
      <TouchableOpacity onPress={() => setStep(1)} activeOpacity={0.8}>
        <LinearGradient colors={Gradients.accent} style={styles.startBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
          <Text style={styles.startBtnText}>Get Started →</Text>
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Step indicator */}
      <View style={styles.stepBar}>
        <View style={[styles.stepDot, step >= 1 && styles.stepDotActive]} />
        <View style={[styles.stepLine, step >= 2 && styles.stepLineActive]} />
        <View style={[styles.stepDot, step >= 2 && styles.stepDotActive]} />
      </View>

      {step === 1 && <ProfileForm data={his} setData={setHis} icon="👔" title="His Closet" />}
      {step === 2 && <ProfileForm data={hers} setData={setHers} icon="👗" title="Her Closet" />}

      {/* Bottom nav */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {step > 1 && (
          <TouchableOpacity onPress={() => setStep(s => s - 1)} style={styles.backBtn}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={step === 1 ? () => setStep(2) : finish}
          disabled={saving}
          activeOpacity={0.8}
          style={{ flex: 1 }}
        >
          <LinearGradient colors={Gradients.accent} style={[styles.nextBtn, saving && { opacity: 0.6 }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.nextBtnText}>{step === 1 ? 'Next: Her Closet →' : 'Finish Setup ✓'}</Text>
            }
          </LinearGradient>
        </TouchableOpacity>
      </View>
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
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
  welcomeIcon: { fontSize: 64, marginBottom: 16 },
  welcomeTitle: { fontSize: 30, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  welcomeSub: { fontSize: 16, color: Colors.text2, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  startBtn: { paddingHorizontal: 40, paddingVertical: 16, borderRadius: Radius.full },
  startBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stepBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: Spacing.md, gap: 0 },
  stepDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: Colors.border },
  stepDotActive: { backgroundColor: Colors.accent2 },
  stepLine: { width: 60, height: 2, backgroundColor: Colors.border, marginHorizontal: 6 },
  stepLineActive: { backgroundColor: Colors.accent2 },
  formHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 24 },
  formIcon: { fontSize: 28 },
  formTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  input: { backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.md, padding: 13, fontSize: 15, color: Colors.text },
  bottomBar: { flexDirection: 'row', gap: 12, padding: Spacing.md, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.bg2 },
  backBtn: { padding: 15, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, justifyContent: 'center' },
  backBtnText: { color: Colors.text2, fontSize: 14, fontWeight: '500' },
  nextBtn: { padding: 15, borderRadius: Radius.md, alignItems: 'center' },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
});
