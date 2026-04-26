import React, { useState, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius } from '../../theme';
import { useAppStore } from '../../store';

const BODY_TYPES  = ['Slim','Athletic','Average','Stocky','Tall-Slim','Broad Shoulders','Petite','Curvy','Plus Size'];
const SKIN_TONES  = ['Fair','Light','Medium','Olive','Tan','Dark','Deep'];
const STYLE_VIBES = ['Classic','Minimalist','Casual','Smart Casual','Streetwear','Bohemian','Bold','Preppy','Edgy'];
const OCCASIONS   = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const HAIR_TYPES  = ['Straight','Wavy','Curly','Coily'];
const HAIR_LENGTHS= ['Bald/Very Short','Short','Medium','Long','Very Long'];

const emptyProfile = (label) => ({
  label, display_name:'', body_type:'', skin_tone:'',
  style_vibe:[], occasions:[], hair_type:'', hair_length:'',
});

/* ── ProfileForm defined OUTSIDE parent — fixes keyboard dismiss bug ── */
function ProfileForm({ data, setData, icon, title }) {
  const toggle = (field, val) => setData(d => {
    const arr = d[field] || [];
    return { ...d, [field]: arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val] };
  });

  return (
    <ScrollView
      style={{ flex:1 }}
      contentContainerStyle={{ padding:Spacing.lg, paddingBottom:120 }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={s.formHeader}>
        <Text style={s.formIcon}>{icon}</Text>
        <Text style={s.formTitle}>{title}</Text>
      </View>

      <Text style={s.fieldLabel}>Display Name</Text>
      <TextInput
        style={s.input}
        value={data.display_name}
        onChangeText={v => setData(d => ({ ...d, display_name: v }))}
        placeholder={title === 'His Closet' ? 'e.g. M' : 'e.g. Priya'}
        placeholderTextColor={Colors.text3}
        autoCorrect={false}
      />

      <Text style={s.fieldLabel}>Body Type</Text>
      <View style={s.pills}>
        {BODY_TYPES.map(b => <Pill key={b} label={b} active={data.body_type===b} onPress={() => setData(d => ({ ...d, body_type: b }))} />)}
      </View>

      <Text style={s.fieldLabel}>Skin Tone</Text>
      <View style={s.pills}>
        {SKIN_TONES.map(st => <Pill key={st} label={st} active={data.skin_tone===st} onPress={() => setData(d => ({ ...d, skin_tone: st }))} />)}
      </View>

      <Text style={s.fieldLabel}>Style Vibe (pick all that apply)</Text>
      <View style={s.pills}>
        {STYLE_VIBES.map(sv => <Pill key={sv} label={sv} active={(data.style_vibe||[]).includes(sv)} onPress={() => toggle('style_vibe', sv)} />)}
      </View>

      <Text style={s.fieldLabel}>Occasions You Dress For</Text>
      <View style={s.pills}>
        {OCCASIONS.map(o => <Pill key={o} label={o} active={(data.occasions||[]).includes(o)} onPress={() => toggle('occasions', o)} />)}
      </View>

      <Text style={s.fieldLabel}>Hair Type</Text>
      <View style={s.pills}>
        {HAIR_TYPES.map(h => <Pill key={h} label={h} active={data.hair_type===h} onPress={() => setData(d => ({ ...d, hair_type: h }))} />)}
      </View>

      <Text style={s.fieldLabel}>Hair Length</Text>
      <View style={s.pills}>
        {HAIR_LENGTHS.map(h => <Pill key={h} label={h} active={data.hair_length===h} onPress={() => setData(d => ({ ...d, hair_length: h }))} />)}
      </View>
    </ScrollView>
  );
}

/* ── Main Screen ── */
export default function OnboardingScreen({ onComplete }) {
  const insets = useSafeAreaInsets();
  const { session, householdId, setProfiles } = useAppStore();
  const [step, setStep] = useState(0);
  const [his, setHis] = useState(emptyProfile('His'));
  const [hers, setHers] = useState(emptyProfile('Hers'));
  const [saving, setSaving] = useState(false);

  async function finish() {
    setSaving(true);
    Logger.info('Onboarding', 'Saving profiles', { his: his.display_name, hers: hers.display_name, householdId });
    try {
      const toSave = [his, hers].filter(p => p.display_name.trim());
      if (toSave.length === 0) toSave.push({ ...his, display_name: 'Me' });

      const inserts = toSave.map(p => ({
        ...p,
        household_id: householdId,
        user_id: session.user.id,
      }));

      Logger.info('Onboarding', 'Inserting', inserts.map(i => ({ label: i.label, name: i.display_name })));
      const { data, error } = await supabase.from('closet_profiles').insert(inserts).select();
      if (error) {
        Logger.error('Onboarding', 'Insert failed', { code: error.code, message: error.message });
        throw error;
      }
      Logger.info('Onboarding', 'Profiles saved', { count: data.length });
      setProfiles(data);
      onComplete();
    } catch (e) {
      Logger.error('Onboarding', 'Save threw', e);
      Alert.alert('Setup Error', e.message || 'Could not save. Check your connection.');
    }
    setSaving(false);
  }

  if (step === 0) return (
    <LinearGradient colors={Gradients.header} style={[s.welcome, { paddingTop: insets.top }]}>
      <Text style={s.welcomeIcon}>👗</Text>
      <Text style={s.welcomeTitle}>HomeBase Closet</Text>
      <Text style={s.welcomeSub}>Your personal AI stylist.{'\n'}Set up His & Hers profiles to get started.</Text>
      <TouchableOpacity onPress={() => setStep(1)} activeOpacity={0.85}>
        <LinearGradient colors={Gradients.accent} style={s.startBtn} start={{x:0,y:0}} end={{x:1,y:0}}>
          <Text style={s.startBtnText}>Get Started →</Text>
        </LinearGradient>
      </TouchableOpacity>
    </LinearGradient>
  );

  return (
    <View style={[s.screen, { paddingTop: insets.top }]}>
      <View style={s.stepBar}>
        <View style={[s.stepDot, step >= 1 && s.stepDotActive]} />
        <View style={[s.stepLine, step >= 2 && s.stepLineActive]} />
        <View style={[s.stepDot, step >= 2 && s.stepDotActive]} />
      </View>

      {step === 1 && <ProfileForm data={his} setData={setHis} icon="👔" title="His Closet" />}
      {step === 2 && <ProfileForm data={hers} setData={setHers} icon="👗" title="Her Closet" />}

      <View style={[s.bottomBar, { paddingBottom: insets.bottom + 12 }]}>
        {step > 1 && (
          <TouchableOpacity onPress={() => setStep(st => st - 1)} style={s.backBtn}>
            <Text style={s.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={step === 1 ? () => setStep(2) : finish} disabled={saving} activeOpacity={0.85} style={{ flex:1 }}>
          <LinearGradient colors={Gradients.accent} style={[s.nextBtn, saving && { opacity:0.6 }]} start={{x:0,y:0}} end={{x:1,y:0}}>
            {saving
              ? <ActivityIndicator color="#fff" />
              : <Text style={s.nextBtnText}>{step === 1 ? 'Next: Her Closet →' : 'Finish Setup ✓'}</Text>
            }
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex:1, backgroundColor:Colors.bg },
  welcome: { flex:1, alignItems:'center', justifyContent:'center', padding:Spacing.xl },
  welcomeIcon: { fontSize:64, marginBottom:16 },
  welcomeTitle: { fontSize:30, fontWeight:'700', color:Colors.text, marginBottom:12 },
  welcomeSub: { fontSize:16, color:Colors.text2, textAlign:'center', lineHeight:24, marginBottom:40 },
  startBtn: { paddingHorizontal:40, paddingVertical:16, borderRadius:Radius.full },
  startBtnText: { color:'#fff', fontSize:16, fontWeight:'700' },
  stepBar: { flexDirection:'row', alignItems:'center', justifyContent:'center', padding:Spacing.md },
  stepDot: { width:10, height:10, borderRadius:5, backgroundColor:Colors.border },
  stepDotActive: { backgroundColor:Colors.accent2 },
  stepLine: { width:60, height:2, backgroundColor:Colors.border, marginHorizontal:6 },
  stepLineActive: { backgroundColor:Colors.accent2 },
  formHeader: { flexDirection:'row', alignItems:'center', gap:12, marginBottom:24 },
  formIcon: { fontSize:28 },
  formTitle: { fontSize:22, fontWeight:'700', color:Colors.text },
  fieldLabel: { fontSize:12, fontWeight:'600', color:Colors.text2, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8, marginTop:16 },
  pills: { flexDirection:'row', flexWrap:'wrap', marginHorizontal:-3 },
  input: { backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.md, padding:13, fontSize:15, color:Colors.text, marginBottom:4 },
  bottomBar: { flexDirection:'row', gap:12, padding:Spacing.md, borderTopWidth:1, borderTopColor:Colors.border, backgroundColor:Colors.bg2 },
  backBtn: { padding:15, borderRadius:Radius.md, borderWidth:1, borderColor:Colors.border, justifyContent:'center' },
  backBtnText: { color:Colors.text2, fontSize:14, fontWeight:'500' },
  nextBtn: { padding:15, borderRadius:Radius.md, alignItems:'center' },
  nextBtnText: { color:'#fff', fontSize:15, fontWeight:'700' },
});
