import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  ScrollView, ActivityIndicator, Image, Alert,
  Animated, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { generateOutfits, generateCoupleOutfits, splitOutfitIntoItems } from '../../lib/claude';
import { getWeatherByCoords, getWeatherByCity } from '../../lib/weather';
import { imageToBase64, uploadPhoto, getSignedUrl } from '../../lib/storage';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius, Shadow } from '../../theme';
import { useAppStore } from '../../store';
import { HEADER_PADDING_TOP } from '../../lib/device';

const OCCASIONS = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const W = Dimensions.get('window').width;

// ── Outfit Card ──────────────────────────────────────────────
function OutfitCard({ outfit, index, onSave, saved }) {
  const [expanded, setExpanded] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 300, delay: index * 120, useNativeDriver: true }).start();
  }, []);

  const confColor = outfit.confidence >= 8 ? Colors.success : outfit.confidence >= 6 ? Colors.accent2 : Colors.warning;

  return (
    <Animated.View style={[oc.card, { opacity: fadeAnim }]}>
      <TouchableOpacity onPress={() => setExpanded(e => !e)} activeOpacity={0.9}>
        <View style={oc.header}>
          <View style={{ flex: 1 }}>
            <Text style={oc.optionLabel}>Option {index + 1}</Text>
            <Text style={oc.name}>{outfit.name}</Text>
            {outfit.tagline && <Text style={oc.tagline}>"{outfit.tagline}"</Text>}
          </View>
          <View style={{ alignItems: 'flex-end', gap: 6 }}>
            {outfit.confidence && (
              <View style={[oc.badge, { backgroundColor: confColor + '22', borderColor: confColor + '55' }]}>
                <Text style={[oc.badgeText, { color: confColor }]}>{outfit.confidence}/10</Text>
              </View>
            )}
            <TouchableOpacity onPress={() => onSave(outfit)} style={oc.saveBtn}>
              <Text style={{ fontSize: 18 }}>{saved ? '❤️' : '🤍'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {outfit.description && <Text style={oc.desc}>{outfit.description}</Text>}

        {/* Item chips */}
        <View style={oc.chips}>
          {(outfit.items || []).map((item, i) => (
            <View key={i} style={oc.chip}><Text style={oc.chipText}>{item}</Text></View>
          ))}
        </View>

        {/* Weather + occasion fit */}
        {(outfit.weather_fit || outfit.occasion_fit) && (
          <View style={oc.fitRow}>
            {outfit.weather_fit && <Text style={oc.fitText}>🌡 {outfit.weather_fit}</Text>}
            {outfit.occasion_fit && <Text style={oc.fitText}>📍 {outfit.occasion_fit}</Text>}
          </View>
        )}

        {expanded && (
          <View style={oc.expandedSection}>
            {outfit.why_it_works && (
              <View style={oc.infoBox}>
                <Text style={oc.infoLabel}>WHY IT WORKS</Text>
                <Text style={oc.infoText}>{outfit.why_it_works}</Text>
              </View>
            )}
            {outfit.styling_tip && (
              <View style={[oc.infoBox, { borderColor: Colors.warning + '30', backgroundColor: Colors.warning + '08' }]}>
                <Text style={[oc.infoLabel, { color: Colors.warning }]}>💡 STYLING TIP</Text>
                <Text style={oc.infoText}>{outfit.styling_tip}</Text>
              </View>
            )}
          </View>
        )}
        <Text style={oc.expandHint}>{expanded ? '▲ Less detail' : '▼ Why it works + styling tip'}</Text>
      </TouchableOpacity>
    </Animated.View>
  );
}

const oc = StyleSheet.create({
  card: { backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 14, ...Shadow.card },
  header: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  optionLabel: { fontSize: 10, fontWeight: '700', color: Colors.accent2, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 3 },
  name: { fontSize: 18, fontWeight: '700', color: Colors.text },
  tagline: { fontSize: 12, color: Colors.text2, fontStyle: 'italic', marginTop: 2 },
  badge: { borderRadius: Radius.sm, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  saveBtn: { padding: 4 },
  desc: { fontSize: 13, color: Colors.text2, lineHeight: 20, marginBottom: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: { backgroundColor: Colors.bg3, borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { fontSize: 12, color: Colors.text },
  fitRow: { gap: 4, marginBottom: 6 },
  fitText: { fontSize: 11, color: Colors.text3, lineHeight: 16 },
  expandedSection: { marginTop: 10, gap: 8 },
  infoBox: { backgroundColor: Colors.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 10 },
  infoLabel: { fontSize: 10, fontWeight: '700', color: Colors.text3, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  infoText: { fontSize: 12, color: Colors.text2, lineHeight: 18 },
  expandHint: { fontSize: 10, color: Colors.text3, textAlign: 'right', marginTop: 6 },
});

// ── Weather Widget ────────────────────────────────────────────
function WeatherWidget({ weather, onRefresh, loading }) {
  if (loading) return (
    <View style={ww.card}>
      <ActivityIndicator color={Colors.accent2} size="small" />
      <Text style={ww.loading}>Fetching weather...</Text>
    </View>
  );
  if (!weather) return null;

  const dangerAlerts = (weather.alerts || []).filter(a => a.level === 'danger');
  const warningAlerts = (weather.alerts || []).filter(a => a.level === 'warning');

  return (
    <View style={ww.card}>
      {/* Danger alerts — shown prominently */}
      {dangerAlerts.map((a, i) => (
        <View key={i} style={ww.dangerAlert}>
          <Text style={ww.dangerText}>{a.message}</Text>
        </View>
      ))}

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View>
          <Text style={ww.emoji}>{weather.emoji}</Text>
          <Text style={ww.temp}>{weather.temp}°F</Text>
          <Text style={ww.condition}>{weather.condition}</Text>
          <Text style={ww.city}>{weather.city}</Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 3 }}>
          <Text style={ww.detail}>Feels {weather.feelsLike}°F</Text>
          <Text style={ww.detail}>H:{weather.high}° L:{weather.low}°</Text>
          <Text style={ww.detail}>{weather.rainChance}% rain</Text>
          <Text style={ww.detail}>💨 {weather.wind}mph {weather.windGusts > 30 ? `(gusts ${weather.windGusts})` : ''}</Text>
        </View>
      </View>

      {/* Warning alerts */}
      {warningAlerts.map((a, i) => (
        <Text key={i} style={ww.warningText}>{a.message}</Text>
      ))}

      <Text style={ww.advice}>{weather.dressingAdvice}</Text>

      {/* 2-day forecast */}
      {weather.forecast?.length > 0 && (
        <View style={ww.forecastRow}>
          {weather.forecast.map((f, i) => (
            <View key={i} style={ww.forecastDay}>
              <Text style={ww.forecastLabel}>{i === 0 ? 'Tomorrow' : 'Day 3'}</Text>
              <Text style={{ fontSize: 16 }}>{f.emoji}</Text>
              <Text style={ww.forecastTemp}>H:{f.high}° L:{f.low}°</Text>
              <Text style={ww.forecastRain}>{f.rainChance}% 🌧</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity onPress={onRefresh} style={ww.refresh}>
        <Text style={ww.refreshText}>↺ Refresh weather</Text>
      </TouchableOpacity>
    </View>
  );
}

const ww = StyleSheet.create({
  card: { backgroundColor: 'rgba(29,78,216,0.08)', borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(29,78,216,0.2)', padding: Spacing.md, marginBottom: 16, flexDirection: 'column', gap: 8 },
  emoji: { fontSize: 28, marginBottom: 2 },
  temp: { fontSize: 28, fontWeight: '700', color: Colors.text },
  condition: { fontSize: 13, color: Colors.text2 },
  city: { fontSize: 11, color: Colors.text3, marginTop: 2 },
  detail: { fontSize: 12, color: Colors.text2 },
  advice: { fontSize: 12, color: Colors.accent2, lineHeight: 18, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border },
  loading: { color: Colors.text2, fontSize: 13, marginLeft: 8 },
  refresh: { alignSelf: 'flex-end', paddingTop: 6 },
  refreshText: { fontSize: 12, color: Colors.text3 },
  dangerAlert: { backgroundColor: Colors.error + '18', borderRadius: Radius.sm, borderWidth: 1, borderColor: Colors.error + '40', padding: 8, marginBottom: 8 },
  dangerText: { color: Colors.error, fontSize: 13, fontWeight: '600', lineHeight: 18 },
  warningText: { color: Colors.warning, fontSize: 12, lineHeight: 18, marginTop: 4 },
  forecastRow: { flexDirection: 'row', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: Colors.border, marginTop: 4 },
  forecastDay: { flex: 1, alignItems: 'center', gap: 2 },
  forecastLabel: { fontSize: 10, color: Colors.text3, fontWeight: '600' },
  forecastTemp: { fontSize: 11, color: Colors.text2 },
  forecastRain: { fontSize: 10, color: Colors.text3 },
});

// ── Main Screen ───────────────────────────────────────────────
export default function OutfitsScreen() {
  const insets = useSafeAreaInsets();
  const profile = useAppStore(s => s.getActiveProfile());
  const { wardrobe, setWardrobe, outfitHistory, setOutfitHistory, addOutfitHistory, showToast, householdId } = useAppStore();

  const [occasion, setOccasion] = useState('');
  const [customOcc, setCustomOcc] = useState('');
  const [cityInput, setCityInput] = useState('');
  const [weather, setWeather] = useState(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState(null);
  const [coupleMode, setCoupleMode] = useState(false);
  const [savedIds, setSavedIds] = useState(new Set());
  const [wornUri, setWornUri] = useState(null);
  const [analyzingWorn, setAnalyzingWorn] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [savedOutfits, setSavedOutfits] = useState([]);
  const [usageCount, setUsageCount] = useState(0);
  const { profiles } = useAppStore();
  const otherProfile = profiles.find(p => p.id !== profile?.id);

  useEffect(() => {
    if (!profile) return;
    loadHistory();      // free — Supabase read
    loadSaved();        // free — Supabase read
    fetchUsage();       // free — Supabase read
    fetchWeatherAuto(); // free — Open-Meteo, cached 30min, no AI cost
  }, [profile?.id]);

  async function fetchUsage() {
    const month = new Date().toISOString().slice(0, 7);
    const { data } = await supabase.from('closet_ai_usage').select('calls').eq('month', month).maybeSingle();
    setUsageCount(data?.calls || 0);
  }

  async function fetchWeatherAuto() {
    setWeatherLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const w = await getWeatherByCoords(loc.coords.latitude, loc.coords.longitude);
        setWeather(w);
      }
    } catch (e) { Logger.warn('Outfits', 'Auto weather failed', e); }
    setWeatherLoading(false);
  }

  async function fetchWeatherByCity() {
    if (!cityInput.trim()) return;
    setWeatherLoading(true);
    const w = await getWeatherByCity(cityInput.trim());
    if (w) setWeather(w);
    else showToast('City not found — try a different spelling');
    setWeatherLoading(false);
  }

  async function loadHistory() {
    const { data } = await supabase.from('closet_outfits').select('*').eq('profile_id', profile.id).order('created_at', { ascending: false }).limit(10);
    setOutfitHistory(data || []);
  }

  async function loadSaved() {
    const { data } = await supabase.from('closet_saved_outfits').select('*').eq('profile_id', profile.id).order('saved_at', { ascending: false });
    setSavedOutfits(data || []);
  }

  async function handleWornPhoto() {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.75});
    if (res.canceled) return;
    const uri = res.assets[0].uri;
    setWornUri(uri);
    setAnalyzingWorn(true);
    Logger.info('Outfits', 'Splitting worn outfit into items');
    try {
      const b64 = await imageToBase64(uri);
      const items = await splitOutfitIntoItems(b64, 'image/jpeg');
      Logger.info('Outfits', 'Items detected', { count: items.length });
      if (items.length > 0) {
        for (const item of items) {
          await supabase.from('wardrobe_items').insert({ ...item, profile_id: profile.id, household_id: householdId });
        }
        showToast(`${items.length} items saved separately to wardrobe`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        showToast('No items detected — try a clearer full-body photo');
      }
    } catch (e) {
      Logger.error('Outfits', 'Worn photo split failed', e);
      showToast('Could not analyze photo');
    }
    setAnalyzingWorn(false);
  }

  async function generate(isMore = false) {
    const occ = customOcc.trim() || occasion;
    if (!occ) { showToast('Pick an occasion first'); return; }
    if (!profile) return;

    setGenerating(true);
    if (!isMore) setResult(null);

    // Always fetch fresh wardrobe from DB
    let freshWardrobe = wardrobe;
    try {
      const { data: fresh } = await supabase
        .from('wardrobe_items').select('*')
        .eq('profile_id', profile.id)
        .order('category');
      if (fresh && fresh.length > 0) {
        freshWardrobe = fresh;
        setWardrobe(fresh);
        Logger.info('Outfits', `Fresh wardrobe: ${fresh.length} items`, fresh.map(i => `${i.brand||''} ${i.name||i.category}`).join(', '));
      }
    } catch (e) { Logger.warn('Outfits', 'Fresh wardrobe load failed', e); }

    Logger.info('Outfits', isMore ? 'Getting more' : 'Generating', { occ, couple: coupleMode, wardrobeCount: freshWardrobe.length });

    try {
      let data;
      if (coupleMode && otherProfile && !isMore) {
        // Fetch partner's wardrobe too
        const { data: partnerWardrobe } = await supabase
          .from('wardrobe_items').select('*')
          .eq('profile_id', otherProfile.id).order('category');

        const isHis = profile.label === 'His';
        data = await generateCoupleOutfits({
          hisProfile: isHis ? profile : otherProfile,
          herProfile: isHis ? otherProfile : profile,
          hisWardrobe: isHis ? freshWardrobe : (partnerWardrobe || []),
          herWardrobe: isHis ? (partnerWardrobe || []) : freshWardrobe,
          occasion: occ, location: weather?.city, weather,
        });
        data._isCouple = true;
        Logger.info('Outfits', 'Couple outfits generated', { count: data.couple_outfits?.length });
      } else {
        data = await generateOutfits({
          profile,
          wardrobeItems: freshWardrobe,
          occasion: occ,
          location: weather?.city,
          weather,
          previousOutfitIds: isMore ? (result?.outfits?.map((_, i) => i) || []) : [],
        }, isMore);
      }

      Logger.info('Outfits', 'Generation done', { outfits: data.outfits?.length });
      setResult(data);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchUsage(); // update count

      // Save to history
      const { data: saved } = await supabase.from('closet_outfits').insert({
        profile_id: profile.id,
        household_id: householdId,
        occasion: occ,
        location: weather?.city,
        weather: weather?.summary,
        ai_suggestion: data,
        hair_suggestion: data.hair?.suggestion,
        worn_on: new Date().toISOString().split('T')[0],
      }).select().single();
      if (saved) addOutfitHistory(saved);
    } catch (e) {
      Logger.error('Outfits', 'Generation failed', e);
      showToast(e.message?.includes('limit') ? e.message : 'Could not generate outfits. Try again.');
    }
    setGenerating(false);
  }

  async function saveOutfit(outfit) {
    if (!profile) return;
    const occ = customOcc.trim() || occasion;
    try {
      await supabase.from('closet_saved_outfits').insert({
        profile_id: profile.id,
        household_id: householdId,
        occasion: occ,
        weather_note: result?.weather_note,
        outfit_data: outfit,
        hair_suggestion: result?.hair?.suggestion,
      });
      setSavedIds(s => new Set([...s, outfit.name]));
      showToast('Outfit saved ❤️');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      loadSaved();
    } catch (e) {
      Logger.error('Outfits', 'Save failed', e);
      showToast('Could not save outfit');
    }
  }

  const occ = customOcc.trim() || occasion;

  return (
    <View style={s.screen}>
      <LinearGradient colors={Gradients.header} style={[s.header, { paddingTop: HEADER_PADDING_TOP }]}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text style={s.headerTitle}>✨ Stylie</Text>
            <Text style={s.headerSub}>{profile?.display_name} · Stylie AI · {usageCount}/100 outfit calls this month</Text>
          </View>
          <TouchableOpacity onPress={() => setShowSaved(s => !s)} style={s.savedToggle}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: showSaved ? Colors.accent2 : Colors.text3 }}>
              {showSaved ? '✨ Generate' : `❤️ Saved (${savedOutfits.length})`}
            </Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={{ padding: Spacing.md, paddingBottom: 100 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* ── Saved outfits view ── */}
        {showSaved ? (
          <View>
            <Text style={s.sectionLabel}>Saved Outfits</Text>
            {savedOutfits.length === 0
              ? <Text style={{ color: Colors.text3, fontSize: 13, textAlign: 'center', padding: 32 }}>No saved outfits yet. Generate and tap 🤍 to save.</Text>
              : savedOutfits.map((so, i) => (
                <View key={so.id} style={s.historyRow}>
                  <Text style={s.historyOcc}>{so.outfit_data?.name || 'Outfit'}</Text>
                  <Text style={s.historyDetail}>{so.occasion} · {so.saved_at?.split('T')[0]}</Text>
                  {so.hair_suggestion && <Text style={s.historyHair}>💇 {so.hair_suggestion}</Text>}
                  {so.outfit_data?.items && <Text style={s.historyItems}>{so.outfit_data.items.slice(0,3).join(' · ')}</Text>}
                </View>
              ))
            }
          </View>
        ) : (
          <>
            {/* ── Weather ── */}
            <Text style={s.sectionLabel}>🌡 Live Weather</Text>
            <WeatherWidget weather={weather} onRefresh={fetchWeatherAuto} loading={weatherLoading} />
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={cityInput}
                onChangeText={setCityInput}
                placeholder="Or enter city name..."
                placeholderTextColor={Colors.text3}
                returnKeyType="search"
                onSubmitEditing={fetchWeatherByCity}
              />
              <TouchableOpacity onPress={fetchWeatherByCity} style={s.cityBtn}>
                <Text style={{ color: Colors.accent2, fontWeight: '600', fontSize: 13 }}>Search</Text>
              </TouchableOpacity>
            </View>

            {/* ── Worn photo ── */}
            <View style={s.wornCard}>
              <Text style={s.sectionLabel}>📸 Upload Worn Outfit Photo</Text>
              <Text style={s.wornSub}>Each item (tee, pants, shoes, watch) gets saved separately so Stylie can mix & match them.</Text>
              <TouchableOpacity onPress={handleWornPhoto} disabled={analyzingWorn} style={s.wornBtn}>
                {wornUri && <Image source={{ uri: wornUri }} style={s.wornThumb} />}
                {analyzingWorn
                  ? <><ActivityIndicator color={Colors.accent2} size="small" /><Text style={{ color: Colors.accent2, fontSize: 13, marginLeft: 8 }}>Splitting into items...</Text></>
                  : <Text style={{ color: Colors.accent2, fontSize: 13, fontWeight: '600' }}>{wornUri ? '+ Upload Another' : '+ Upload Photo'}</Text>
                }
              </TouchableOpacity>
            </View>

            {/* ── Occasion ── */}
            <Text style={s.sectionLabel}>What's the occasion?</Text>
            <View style={s.pills}>
              {OCCASIONS.map(o => <Pill key={o} label={o} active={occasion === o} onPress={() => { setOccasion(o); setCustomOcc(''); }} />)}
            </View>
            <TextInput
              style={[s.input, { marginTop: 10, marginBottom: 12 }]}
              value={customOcc}
              onChangeText={v => { setCustomOcc(v); setOccasion(''); }}
              placeholder="Or describe your occasion..."
              placeholderTextColor={Colors.text3}
            />

            {/* ── Couple mode — show if 2 profiles exist ── */}
            {otherProfile && (
              <TouchableOpacity
                onPress={() => setCoupleMode(m => !m)}
                style={[s.coupleToggle, coupleMode && s.coupleToggleActive]}
              >
                <Text style={{ fontSize: 18 }}>👫</Text>
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={[s.coupleToggleTitle, coupleMode && { color: Colors.accent2 }]}>
                    Couple Outfits {coupleMode ? '(ON)' : '(OFF)'}
                  </Text>
                  <Text style={s.coupleToggleSub}>
                    Coordinated looks for {profile?.display_name} & {otherProfile?.display_name} going together
                  </Text>
                </View>
                <Text style={{ fontSize: 16 }}>{coupleMode ? '✓' : '○'}</Text>
              </TouchableOpacity>
            )}

            {/* ── Generate ── */}
            <TouchableOpacity onPress={() => generate(false)} disabled={generating || !occ} activeOpacity={0.85}>
              <LinearGradient
                colors={occ ? Gradients.accent : ['#334155', '#334155']}
                style={[s.genBtn, generating && { opacity: 0.7 }]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                {generating && !result
                  ? <><ActivityIndicator color="#fff" /><Text style={s.genBtnText}>  Stylie is styling you...</Text></>
                  : <Text style={s.genBtnText}>✨  Ask Stylie for Outfits</Text>
                }
              </LinearGradient>
            </TouchableOpacity>

            {/* ── Results ── */}
            {result && (
              <View style={{ marginTop: 24 }}>
                {/* ── Couple results ── */}
                {result._isCouple && (result.couple_outfits || []).map((co, i) => (
                  <View key={i} style={s.coupleCard}>
                    <Text style={s.coupleCardBadge}>Option {i+1}</Text>
                    <Text style={s.coupleCardName}>{co.name}</Text>
                    <Text style={s.coupleCardVibe}>"{co.vibe}"</Text>
                    <View style={s.coupleRow}>
                      <View style={s.coupleHalf}>
                        <Text style={s.coupleWho}>👔 {profiles.find(p=>p.label==='His')?.display_name||'His'}</Text>
                        <Text style={s.coupleDesc}>{co.his?.description}</Text>
                        {(co.his?.items||[]).map((item,j)=><Text key={j} style={s.coupleItem}>• {item}</Text>)}
                        {co.his?.styling_tip && <Text style={s.coupleTip}>💡 {co.his.styling_tip}</Text>}
                      </View>
                      <View style={s.coupleDivider}/>
                      <View style={s.coupleHalf}>
                        <Text style={s.coupleWho}>👗 {profiles.find(p=>p.label==='Hers')?.display_name||'Hers'}</Text>
                        <Text style={s.coupleDesc}>{co.her?.description}</Text>
                        {(co.her?.items||[]).map((item,j)=><Text key={j} style={s.coupleItem}>• {item}</Text>)}
                        {co.her?.styling_tip && <Text style={s.coupleTip}>💡 {co.her.styling_tip}</Text>}
                      </View>
                    </View>
                    {co.why_together && <Text style={s.coupleWhy}>👫 {co.why_together}</Text>}
                    {co.color_story && <Text style={s.coupleColorStory}>🎨 {co.color_story}</Text>}
                  </View>
                ))}
                {result._isCouple && result.couple_tip && (
                  <View style={[s.tipCard, { borderColor: Colors.success+'30', backgroundColor: Colors.success+'08' }]}>
                    <Text style={{ color:Colors.success, fontSize:11, fontWeight:'700', marginBottom:4 }}>👫 COUPLE TIP</Text>
                    <Text style={s.tipText}>{result.couple_tip}</Text>
                  </View>
                )}
                {result._isCouple && (result.his_hair || result.her_hair) && (
                  <View style={s.hairCard}>
                    <Text style={s.hairLabel}>💇 Hair Suggestions</Text>
                    {result.his_hair?.suggestion && <Text style={[s.hairSuggestion,{fontSize:14}]}>👔 {result.his_hair.suggestion} {result.his_hair.time_needed ? `(${result.his_hair.time_needed})`:''}</Text>}
                    {result.her_hair?.suggestion && <Text style={[s.hairSuggestion,{fontSize:14}]}>👗 {result.her_hair.suggestion} {result.her_hair.time_needed ? `(${result.her_hair.time_needed})`:''}</Text>}
                  </View>
                )}

                {/* Context notes */}
                {!result._isCouple && (result.weather_note || result.trend_note) && (
                  <View style={s.contextCard}>
                    {result.weather_note && <Text style={s.contextText}>🌡 {result.weather_note}</Text>}
                    {result.trend_note && <Text style={s.contextText}>🔥 {result.trend_note}</Text>}
                  </View>
                )}

                {/* Hair */}
                {result.hair && (
                  <View style={s.hairCard}>
                    <Text style={s.hairLabel}>💇 Hair Suggestion</Text>
                    <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center' }}>
                      <Text style={s.hairSuggestion}>{result.hair.suggestion}</Text>
                      {result.hair.time_needed && <Text style={{ fontSize:11, color:'#a78bfa', fontWeight:'600' }}>⏱ {result.hair.time_needed}</Text>}
                    </View>
                    {result.hair.how_to && <Text style={s.hairDetail}>{result.hair.how_to}</Text>}
                    {result.hair.cap_recommendation && (
                      <View style={{ backgroundColor:'rgba(251,191,36,0.08)', borderRadius:8, padding:8, marginTop:6 }}>
                        <Text style={{ fontSize:12, color:Colors.warning }}>🧢 {result.hair.cap_recommendation}</Text>
                      </View>
                    )}
                    {result.hair.why && <Text style={s.hairWhy}>{result.hair.why}</Text>}
                  </View>
                )}

                {/* Avoid + Shopping gap */}
                {result.avoid_today && (
                  <View style={[s.tipCard, { borderColor: Colors.error + '30', backgroundColor: Colors.error + '08' }]}>
                    <Text style={{ color: Colors.error, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>⚠️ AVOID TODAY</Text>
                    <Text style={s.tipText}>{result.avoid_today}</Text>
                  </View>
                )}
                {result.shopping_gap && (
                  <View style={[s.tipCard, { borderColor: Colors.warning + '30', backgroundColor: Colors.warning + '08' }]}>
                    <Text style={{ color: Colors.warning, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>🛍 WARDROBE GAP</Text>
                    <Text style={s.tipText}>{result.shopping_gap}</Text>
                  </View>
                )}

                <Text style={s.outfitsHeader}>3 Outfit Options</Text>
                {(result.outfits || []).map((o, i) => (
                  <OutfitCard
                    key={`${o.name}-${i}`}
                    outfit={o}
                    index={i}
                    onSave={saveOutfit}
                    saved={savedIds.has(o.name)}
                  />
                ))}

                {/* More suggestions */}
                <TouchableOpacity onPress={() => generate(true)} disabled={generating} activeOpacity={0.85} style={s.moreBtn}>
                  {generating
                    ? <><ActivityIndicator color={Colors.accent2} size="small" /><Text style={s.moreBtnText}>  Getting more...</Text></>
                    : <Text style={s.moreBtnText}>✨ Give Me 3 More Suggestions</Text>
                  }
                </TouchableOpacity>
              </View>
            )}

            {/* ── History ── */}
            {outfitHistory.length > 0 && !result && (
              <View style={{ marginTop: 24 }}>
                <Text style={s.sectionLabel}>Recent Outfits</Text>
                {outfitHistory.slice(0, 6).map(h => (
                  <View key={h.id} style={s.historyRow}>
                    <Text style={s.historyOcc}>{h.occasion}</Text>
                    {h.hair_suggestion && <Text style={s.historyHair}>💇 {h.hair_suggestion}</Text>}
                    <Text style={s.historyDetail}>{h.worn_on}{h.location ? ` · ${h.location}` : ''}</Text>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: Spacing.lg, paddingBottom: 14 },
  headerTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, letterSpacing: 0.5 },
  headerSub: { fontSize: 11, color: Colors.text2, marginTop: 3 },
  savedToggle: { padding: 8, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.bg3 },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },
  coupleToggle: { flexDirection:'row', alignItems:'center', padding:14, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, backgroundColor:Colors.bg3, marginBottom:20 },
  coupleToggleActive: { borderColor:Colors.accent2, backgroundColor:'rgba(29,78,216,0.1)' },
  coupleToggleTitle: { fontSize:13, fontWeight:'700', color:Colors.text },
  coupleToggleSub: { fontSize:11, color:Colors.text3, marginTop:2 },
  coupleCard: { backgroundColor:Colors.card, borderRadius:Radius.lg, borderWidth:1, borderColor:'rgba(124,58,237,0.3)', padding:Spacing.md, marginBottom:16 },
  coupleCardBadge: { fontSize:10, fontWeight:'700', color:'#a78bfa', textTransform:'uppercase', letterSpacing:1, marginBottom:4 },
  coupleCardName: { fontSize:17, fontWeight:'700', color:Colors.text, marginBottom:2 },
  coupleCardVibe: { fontSize:12, color:Colors.text2, fontStyle:'italic', marginBottom:12 },
  coupleRow: { flexDirection:'row', gap:12, marginBottom:12 },
  coupleHalf: { flex:1 },
  coupleDivider: { width:1, backgroundColor:Colors.border },
  coupleWho: { fontSize:13, fontWeight:'700', color:Colors.accent2, marginBottom:6 },
  coupleDesc: { fontSize:12, color:Colors.text2, lineHeight:17, marginBottom:6 },
  coupleItem: { fontSize:12, color:Colors.text, marginBottom:2 },
  coupleTip: { fontSize:11, color:Colors.warning, marginTop:6, lineHeight:16 },
  coupleWhy: { fontSize:12, color:Colors.text2, lineHeight:18, paddingTop:10, borderTopWidth:1, borderTopColor:Colors.border, marginBottom:4 },
  coupleColorStory: { fontSize:11, color:Colors.text3, lineHeight:16 },
  input: { backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.md, padding: 12, fontSize: 14, color: Colors.text },
  cityBtn: { padding: 12, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.accent2, justifyContent: 'center' },
  wornCard: { backgroundColor: Colors.bg3, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, marginBottom: 20 },
  wornSub: { fontSize: 12, color: Colors.text3, marginBottom: 10, lineHeight: 18 },
  wornBtn: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  wornThumb: { width: 44, height: 44, borderRadius: Radius.sm },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  genBtn: { padding: 16, borderRadius: Radius.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  genBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  contextCard: { backgroundColor: Colors.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, padding: 12, marginBottom: 12, gap: 4 },
  contextText: { fontSize: 12, color: Colors.text2, lineHeight: 18 },
  hairCard: { backgroundColor: 'rgba(124,58,237,0.1)', borderRadius: Radius.lg, borderWidth: 1, borderColor: 'rgba(124,58,237,0.25)', padding: Spacing.md, marginBottom: 10 },
  hairLabel: { fontSize: 10, fontWeight: '700', color: '#a78bfa', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 6 },
  hairSuggestion: { fontSize: 16, fontWeight: '600', color: Colors.text, marginBottom: 4 },
  hairDetail: { fontSize: 13, color: Colors.text2, marginBottom: 4 },
  hairWhy: { fontSize: 12, color: Colors.text3, lineHeight: 18 },
  tipCard: { borderRadius: Radius.md, borderWidth: 1, padding: 12, marginBottom: 10 },
  tipText: { fontSize: 13, color: Colors.text2, lineHeight: 20 },
  outfitsHeader: { fontSize: 16, fontWeight: '700', color: Colors.text, marginBottom: 12, marginTop: 8 },
  moreBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 14, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.accent2, marginTop: 4, marginBottom: 20 },
  moreBtnText: { color: Colors.accent2, fontSize: 14, fontWeight: '600' },
  historyRow: { padding: 12, backgroundColor: Colors.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 8, gap: 3 },
  historyOcc: { fontSize: 13, fontWeight: '600', color: Colors.text },
  historyDetail: { fontSize: 11, color: Colors.text3 },
  historyHair: { fontSize: 12, color: Colors.text2 },
  historyItems: { fontSize: 11, color: Colors.text3 },
});
