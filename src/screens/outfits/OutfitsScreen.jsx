import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Image, Alert, Modal,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { generateOutfits, analyzeWornOutfit } from '../../lib/claude';
import { imageToBase64, uploadPhoto } from '../../lib/storage';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius, Shadow } from '../../theme';
import { useAppStore } from '../../store';

const OCCASIONS  = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];

const CONFIDENCE_COLOR = (n) => n >= 8 ? Colors.success : n >= 6 ? Colors.accent2 : Colors.warning;

function OutfitCard({ outfit, index }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <TouchableOpacity style={styles.outfitCard} onPress={() => setExpanded(e => !e)} activeOpacity={0.9}>
      <View style={styles.outfitHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.outfitOption}>Option {index + 1}</Text>
          <Text style={styles.outfitName}>{outfit.name}</Text>
          {outfit.tagline && <Text style={styles.outfitTagline}>{outfit.tagline}</Text>}
        </View>
        {outfit.confidence && (
          <View style={[styles.confidenceBadge, { backgroundColor: CONFIDENCE_COLOR(outfit.confidence) + '22', borderColor: CONFIDENCE_COLOR(outfit.confidence) + '44' }]}>
            <Text style={[styles.confidenceText, { color: CONFIDENCE_COLOR(outfit.confidence) }]}>{outfit.confidence}/10</Text>
          </View>
        )}
      </View>

      {outfit.description && <Text style={styles.outfitDesc}>{outfit.description}</Text>}

      <View style={styles.itemChips}>
        {(outfit.items || []).map((item, i) => (
          <View key={i} style={styles.chip}><Text style={styles.chipText}>{item}</Text></View>
        ))}
      </View>

      {expanded && outfit.why_it_works && (
        <View style={styles.whyBox}>
          <Text style={styles.whyLabel}>Why it works</Text>
          <Text style={styles.whyText}>{outfit.why_it_works}</Text>
        </View>
      )}

      <Text style={styles.expandHint}>{expanded ? '▲ Less' : '▼ Why it works'}</Text>
    </TouchableOpacity>
  );
}

export default function OutfitsScreen() {
  const insets = useSafeAreaInsets();
  const profile = useAppStore(s => s.getActiveProfile());
  const { wardrobe, outfitHistory, setOutfitHistory, addOutfitHistory, showToast, householdId } = useAppStore();
  const [occasion, setOccasion] = useState('');
  const [customOcc, setCustomOcc] = useState('');
  const [location, setLocation] = useState('');
  const [weather, setWeather] = useState('');
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [wornUri, setWornUri] = useState(null);
  const [analyzingWorn, setAnalyzingWorn] = useState(false);

  useEffect(() => {
    if (!profile) return;
    supabase.from('closet_outfits').select('*').eq('profile_id', profile.id)
      .order('created_at', { ascending: false }).limit(15)
      .then(({ data, error }) => {
        if (error) Logger.error('Outfits', 'History load failed', error);
        else { Logger.info('Outfits', `Loaded ${data.length} history entries`); setOutfitHistory(data || []); }
      });
  }, [profile?.id]);

  async function handleWornPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setWornUri(uri);
    setAnalyzingWorn(true);
    Logger.info('Outfits', 'Analyzing worn-outfit photo');
    try {
      const b64 = await imageToBase64(uri);
      const parsed = await analyzeWornOutfit(b64, 'image/jpeg');
      Logger.info('Outfits', 'Worn outfit analyzed', { itemCount: parsed.items?.length });
      // Auto-add recognized items to wardrobe
      if (parsed.items?.length > 0) {
        for (const item of parsed.items) {
          await supabase.from('wardrobe_items').insert({ ...item, profile_id: profile.id, household_id: householdId });
        }
        showToast(`${parsed.items.length} items added to wardrobe from photo`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showToast('No items detected — try a clearer photo');
      }
    } catch (e) {
      Logger.error('Outfits', 'Worn photo analysis failed', e);
      showToast('Could not analyze photo');
    }
    setAnalyzingWorn(false);
  }

  async function generate() {
    const occ = customOcc.trim() || occasion;
    if (!occ) { showToast('Pick an occasion first'); return; }
    if (!profile) return;

    setGenerating(true);
    setResult(null);
    Logger.info('Outfits', 'Generating outfits', { occasion: occ, wardrobeCount: wardrobe.length });
    const done = Logger.perf('Outfits', 'generateOutfits');

    try {
      const data = await generateOutfits({ profile, wardrobeItems: wardrobe, occasion: occ, location, weather });
      Logger.info('Outfits', 'Outfits generated', { count: data.outfits?.length });
      Logger.group('Outfits', 'Result', () => { Logger.debug('Outfits', 'Full result', data); });
      setResult(data);
      done();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // Save to history
      const { data: saved } = await supabase.from('closet_outfits').insert({
        profile_id: profile.id,
        household_id: householdId,
        occasion: occ,
        location,
        weather,
        ai_suggestion: data,
        hair_suggestion: data.hair?.suggestion,
        worn_on: new Date().toISOString().split('T')[0],
      }).select().single();
      if (saved) addOutfitHistory(saved);

    } catch (e) {
      Logger.error('Outfits', 'Generation failed', e);
      showToast('Could not generate outfits. Check your connection.');
    }
    setGenerating(false);
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <LinearGradient colors={Gradients.header} style={styles.header}>
        <Text style={styles.headerTitle}>Outfit Generator</Text>
        <Text style={styles.headerSub}>{profile?.display_name || profile?.label} · AI Powered</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100 }} showsVerticalScrollIndicator={false}>

        {/* Worn-before photo */}
        <View style={styles.wornCard}>
          <Text style={styles.sectionLabel}>📸 Worn Before? Upload a Photo</Text>
          <Text style={styles.sectionSub}>We'll recognize your outfit and add those items to your wardrobe automatically.</Text>
          <TouchableOpacity onPress={handleWornPhoto} disabled={analyzingWorn} style={styles.wornBtn}>
            {wornUri && <Image source={{ uri: wornUri }} style={styles.wornThumb} />}
            <Text style={{ color: Colors.accent2, fontSize: 13, fontWeight: '600' }}>
              {analyzingWorn ? 'Analyzing outfit...' : wornUri ? 'Upload Another' : '+ Upload Photo'}
            </Text>
            {analyzingWorn && <ActivityIndicator color={Colors.accent2} style={{ marginLeft: 8 }} />}
          </TouchableOpacity>
        </View>

        {/* Occasion */}
        <Text style={styles.sectionLabel}>What's the occasion?</Text>
        <View style={styles.pills}>
          {OCCASIONS.map(o => (
            <Pill key={o} label={o} active={occasion===o} onPress={() => { setOccasion(o); setCustomOcc(''); }} />
          ))}
        </View>
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          value={customOcc}
          onChangeText={v => { setCustomOcc(v); setOccasion(''); }}
          placeholder="Or describe your own occasion..."
          placeholderTextColor={Colors.text3}
        />

        {/* Location + Weather */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TextInput style={[styles.input, { flex: 1 }]} value={location} onChangeText={setLocation} placeholder="📍 Location" placeholderTextColor={Colors.text3} />
          <TextInput style={[styles.input, { flex: 1 }]} value={weather} onChangeText={setWeather} placeholder="🌤 Weather" placeholderTextColor={Colors.text3} />
        </View>

        {/* Generate button */}
        <TouchableOpacity onPress={generate} disabled={generating} activeOpacity={0.85} style={{ marginTop: 16 }}>
          <LinearGradient colors={Gradients.accent} style={[styles.generateBtn, generating && { opacity: 0.7 }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            {generating
              ? <><ActivityIndicator color="#fff" /><Text style={styles.generateBtnText}>  Styling your outfit...</Text></>
              : <Text style={styles.generateBtnText}>✨  Generate My Outfits</Text>
            }
          </LinearGradient>
        </TouchableOpacity>

        {/* Results */}
        {result && (
          <View style={{ marginTop: 24 }}>
            {/* Hair */}
            {result.hair && (
              <View style={styles.hairCard}>
                <Text style={styles.hairLabel}>💇 Hair Suggestion</Text>
                <Text style={styles.hairSuggestion}>{result.hair.suggestion}</Text>
                {result.hair.style_detail && <Text style={styles.hairDetail}>{result.hair.style_detail}</Text>}
                {result.hair.why && <Text style={styles.hairWhy}>{result.hair.why}</Text>}
              </View>
            )}

            {/* Tip + Avoid */}
            {result.styling_tip && (
              <View style={styles.tipCard}>
                <Text style={{ color: Colors.warning, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>💡 STYLING TIP</Text>
                <Text style={styles.tipText}>{result.styling_tip}</Text>
              </View>
            )}
            {result.avoid && (
              <View style={[styles.tipCard, { borderColor: Colors.error + '30', backgroundColor: Colors.error + '08' }]}>
                <Text style={{ color: Colors.error, fontSize: 12, fontWeight: '600', marginBottom: 4 }}>⚠️ AVOID</Text>
                <Text style={[styles.tipText, { color: Colors.text2 }]}>{result.avoid}</Text>
              </View>
            )}

            {/* Outfit cards */}
            <Text style={styles.outfitsHeader}>3 Outfit Options</Text>
            {(result.outfits || []).map((o, i) => <OutfitCard key={i} outfit={o} index={i} />)}
          </View>
        )}

        {/* History */}
        {outfitHistory.length > 0 && (
          <View style={{ marginTop: 28 }}>
            <Text style={styles.sectionLabel}>Recent Outfits</Text>
            {outfitHistory.slice(0, 8).map(h => (
              <View key={h.id} style={styles.historyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.historyOcc}>{h.occasion}</Text>
                  {h.hair_suggestion && <Text style={styles.historyHair}>💇 {h.hair_suggestion}</Text>}
                </View>
                <Text style={styles.historyDate}>{h.worn_on}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: Spacing.lg, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4 },
  sectionSub: { fontSize: 12, color: Colors.text3, marginBottom: 10, lineHeight: 18 },
  wornCard: { backgroundColor: Colors.bg3, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20 },
  wornBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wornThumb: { width: 44, height: 44, borderRadius: Radius.sm, resizeMode: 'cover' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3, marginBottom: 4 },
  input: { backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.md, padding: 12, fontSize: 14, color: Colors.text },
  generateBtn: { padding: 16, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  generateBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hairCard: { backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)', padding: Spacing.md, marginBottom: 12 },
  hairLabel: { fontSize: 11, fontWeight: '700', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  hairSuggestion: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  hairDetail: { fontSize: 13, color: Colors.text2, marginBottom: 4 },
  hairWhy: { fontSize: 12, color: Colors.text3, lineHeight: 18 },
  tipCard: { backgroundColor: 'rgba(251,191,36,0.08)', borderRadius: Radius.md, borderWidth: 1, borderColor: 'rgba(251,191,36,0.2)', padding: 12, marginBottom: 10 },
  tipText: { fontSize: 13, color: Colors.text2, lineHeight: 20 },
  outfitsHeader: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 12, marginTop: 8 },
  outfitCard: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 14, ...Shadow.card },
  outfitHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  outfitOption: { fontSize: 11, fontWeight: '700', color: Colors.accent2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 2 },
  outfitName: { fontSize: 17, fontWeight: '700', color: Colors.text },
  outfitTagline: { fontSize: 12, color: Colors.text2, marginTop: 2, fontStyle: 'italic' },
  confidenceBadge: { borderRadius: Radius.md, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 4 },
  confidenceText: { fontSize: 13, fontWeight: '700' },
  outfitDesc: { fontSize: 13, color: Colors.text2, lineHeight: 20, marginBottom: 10 },
  itemChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { backgroundColor: Colors.bg3, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, color: Colors.text },
  whyBox: { backgroundColor: Colors.bg3, borderRadius: Radius.md, padding: 10, marginTop: 4 },
  whyLabel: { fontSize: 11, fontWeight: '700', color: Colors.text3, textTransform: 'uppercase', marginBottom: 4 },
  whyText: { fontSize: 12, color: Colors.text2, lineHeight: 18 },
  expandHint: { fontSize: 11, color: Colors.text3, textAlign: 'right', marginTop: 6 },
  historyRow: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8 },
  historyOcc: { fontSize: 13, fontWeight: '600', color: Colors.text },
  historyHair: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  historyDate: { fontSize: 11, color: Colors.text3 },
});
