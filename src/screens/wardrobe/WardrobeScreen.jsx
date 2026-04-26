import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Image, Alert, ActivityIndicator, Modal,
  ScrollView, Platform, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { analyzeClothingPhoto } from '../../lib/claude';
import { lookupBarcode } from '../../lib/barcode';
import { uploadPhoto, imageToBase64, getSignedUrl } from '../../lib/storage';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius, Shadow } from '../../theme';
import { useAppStore } from '../../store';

const CATEGORIES = ['Tops','Bottoms','Dresses','Outerwear','Shoes','Accessories','Activewear','Swimwear','Loungewear'];
const OCCASIONS  = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const SEASONS    = ['Spring','Summer','Fall','Winter'];
const COLORS     = ['Black','White','Gray','Navy','Blue','Light Blue','Green','Olive','Khaki','Beige','Brown','Burgundy','Red','Pink','Purple','Yellow','Orange','Multicolor','Pattern'];
const FITS       = ['Slim','Regular','Loose','Oversized','Tailored'];
const CATEGORY_ICONS = { Tops:'👕', Bottoms:'👖', Dresses:'👗', Outerwear:'🧥', Shoes:'👟', Accessories:'👜', Activewear:'🏃', Swimwear:'🩱', Loungewear:'🩳' };
const W = Dimensions.get('window').width;
const CARD = (W - 36) / 2;

function emptyForm() {
  return { name:'', category:'Tops', color:'Black', colors:[], material:'', fit:'Regular', occasions:[], seasons:[], brand:'', notes:'' };
}

/* ── AI Confirmation Modal — shown after photo analysis ── */
/* Defined outside AddItemSheet to avoid keyboard remount */
function AIConfirmModal({ visible, analysis, onConfirm, onDismiss }) {
  if (!analysis) return null;
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onDismiss}>
      <View style={conf.overlay}>
        <View style={conf.sheet}>
          <Text style={conf.title}>AI Detected This Item</Text>
          <Text style={conf.sub}>Confirm or edit before adding to wardrobe</Text>

          <View style={conf.row}><Text style={conf.key}>Category</Text><Text style={conf.val}>{analysis.category}</Text></View>
          <View style={conf.row}><Text style={conf.key}>Color</Text><Text style={conf.val}>{analysis.color}</Text></View>
          {analysis.material ? <View style={conf.row}><Text style={conf.key}>Material</Text><Text style={conf.val}>{analysis.material}</Text></View> : null}
          {analysis.fit ? <View style={conf.row}><Text style={conf.key}>Fit</Text><Text style={conf.val}>{analysis.fit}</Text></View> : null}
          {analysis.name ? <View style={conf.row}><Text style={conf.key}>Name</Text><Text style={conf.val}>{analysis.name}</Text></View> : null}

          <Text style={conf.hint}>Tags auto-filled below — review and adjust if needed</Text>

          <View style={conf.btnRow}>
            <TouchableOpacity onPress={onDismiss} style={conf.editBtn}>
              <Text style={conf.editBtnText}>Edit Manually</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onConfirm} activeOpacity={0.85} style={{ flex: 1 }}>
              <LinearGradient colors={['#1d4ed8','#7c3aed']} style={conf.confirmBtn} start={{x:0,y:0}} end={{x:1,y:0}}>
                <Text style={conf.confirmBtnText}>Looks Good ✓</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const conf = StyleSheet.create({
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.75)', justifyContent:'flex-end' },
  sheet: { backgroundColor:Colors.bg2, borderRadius:'20px 20px 0 0', borderTopLeftRadius:20, borderTopRightRadius:20, padding:24, paddingBottom:40 },
  title: { fontSize:18, fontWeight:'700', color:Colors.text, marginBottom:4 },
  sub: { fontSize:13, color:Colors.text2, marginBottom:20 },
  row: { flexDirection:'row', justifyContent:'space-between', paddingVertical:8, borderBottomWidth:1, borderBottomColor:Colors.border },
  key: { fontSize:13, color:Colors.text3 },
  val: { fontSize:13, fontWeight:'600', color:Colors.text },
  hint: { fontSize:12, color:Colors.accent2, marginTop:16, marginBottom:20, textAlign:'center' },
  btnRow: { flexDirection:'row', gap:12 },
  editBtn: { padding:14, borderRadius:Radius.md, borderWidth:1, borderColor:Colors.border, justifyContent:'center', alignItems:'center' },
  editBtnText: { color:Colors.text2, fontSize:14, fontWeight:'600' },
  confirmBtn: { padding:14, borderRadius:Radius.md, alignItems:'center' },
  confirmBtnText: { color:'#fff', fontSize:14, fontWeight:'700' },
});

/* ── Add Item Sheet — defined OUTSIDE parent to fix keyboard dismiss bug ── */
function AddItemSheet({ profile, householdId, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [photos, setPhotos] = useState([]); // array of { uri, analyzing, analysis }
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pendingAnalysis, setPendingAnalysis] = useState(null); // analysis waiting for confirm
  const [showConfirm, setShowConfirm] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scannerRef = useRef(null);

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);
  const toggle = useCallback((k, v) => setForm(f => {
    const a = f[k] || [];
    return { ...f, [k]: a.includes(v) ? a.filter(x => x !== v) : [...a, v] };
  }), []);

  async function pickPhotos() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.75,
      allowsMultipleSelection: true, // multi-select
      selectionLimit: 10,
    });
    if (result.canceled) return;

    const newPhotos = result.assets.map(a => ({ uri: a.uri, analyzing: true, analysis: null }));
    setPhotos(prev => [...prev, ...newPhotos]);

    // Analyze first photo with Claude, apply to form
    for (let i = 0; i < newPhotos.length; i++) {
      const asset = result.assets[i];
      try {
        Logger.info('Wardrobe', `Analyzing photo ${i + 1}/${result.assets.length}`);
        const b64 = await imageToBase64(asset.uri);
        const analysis = await analyzeClothingPhoto(b64, 'image/jpeg');
        Logger.info('Wardrobe', 'Analysis done', analysis);

        setPhotos(prev => prev.map(p =>
          p.uri === asset.uri ? { ...p, analyzing: false, analysis } : p
        ));

        // Show confirmation modal for first photo only
        if (i === 0) {
          setPendingAnalysis(analysis);
          setShowConfirm(true);
        }
      } catch (e) {
        Logger.error('Wardrobe', 'Photo analysis failed', e);
        setPhotos(prev => prev.map(p =>
          p.uri === asset.uri ? { ...p, analyzing: false } : p
        ));
      }
    }
  }

  function applyAnalysis(analysis) {
    setForm(f => ({
      ...f,
      name: analysis.name || f.name,
      category: analysis.category || f.category,
      color: analysis.color || f.color,
      colors: analysis.colors?.length ? analysis.colors : f.colors,
      material: analysis.material || f.material,
      fit: analysis.fit || f.fit,
    }));
  }

  function handleConfirm() {
    if (pendingAnalysis) applyAnalysis(pendingAnalysis);
    setPendingAnalysis(null);
    setShowConfirm(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  async function startBarcode() {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) { Alert.alert('Camera permission required to scan barcodes'); return; }
    }
    setScanning(true);
  }

  async function onBarcodeScanned({ data }) {
    setScanning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    Logger.info('Wardrobe', 'Barcode scanned', { data });
    const info = await lookupBarcode(data);
    if (info) {
      setForm(f => ({ ...f, ...info }));
      Logger.info('Wardrobe', 'Product info loaded from barcode', info);
    } else {
      Alert.alert('Product Not Found', 'Barcode scanned but no product info found. Fill in details manually.');
    }
  }

  async function save() {
    setSaving(true);
    try {
      let photo_url = null;
      if (photos.length > 0) {
        const ext = photos[0].uri.split('.').pop() || 'jpg';
        const path = `${profile.id}/${Date.now()}.${ext}`;
        photo_url = await uploadPhoto(photos[0].uri, path);
      }
      // If multiple photos, save remaining as extra (future feature — just save first for now)
      const { data, error } = await supabase.from('wardrobe_items')
        .insert({ ...form, photo_url, profile_id: profile.id, household_id: householdId })
        .select().single();
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(data);
      onClose();
    } catch (e) {
      Logger.error('Wardrobe', 'Save failed', e);
      Alert.alert('Error', 'Could not save item: ' + e.message);
    }
    setSaving(false);
  }

  if (scanning) return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        onBarcodeScanned={onBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','upc_e','qr'] }}
      />
      <View style={add.scanOverlay}>
        <View style={add.scanFrame} />
        <Text style={add.scanHint}>Point at barcode</Text>
        <TouchableOpacity onPress={() => setScanning(false)} style={add.scanCancel}>
          <Text style={{ color:'#fff', fontSize:14, fontWeight:'600' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <>
      <AIConfirmModal
        visible={showConfirm}
        analysis={pendingAnalysis}
        onConfirm={handleConfirm}
        onDismiss={() => { setPendingAnalysis(null); setShowConfirm(false); }}
      />
      <ScrollView
        style={{ flex:1 }}
        contentContainerStyle={{ padding:Spacing.lg, paddingBottom:80 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={add.handle} />
        <Text style={add.title}>Add Clothing Item</Text>

        {/* Photo strip */}
        <View style={add.photoRow}>
          <TouchableOpacity onPress={pickPhotos} style={add.photoAddBtn}>
            <Text style={{ fontSize:28 }}>📷</Text>
            <Text style={{ color:Colors.text2, fontSize:12, marginTop:4 }}>Add Photos</Text>
            <Text style={{ color:Colors.text3, fontSize:10 }}>Select multiple</Text>
          </TouchableOpacity>
          {photos.map((p, i) => (
            <View key={i} style={add.photoThumb}>
              <Image source={{ uri: p.uri }} style={{ width:'100%', height:'100%' }} />
              {p.analyzing && (
                <View style={add.analyzingOverlay}>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={{ color:'#fff', fontSize:9, marginTop:2 }}>AI</Text>
                </View>
              )}
              <TouchableOpacity
                onPress={() => setPhotos(prev => prev.filter((_,j) => j !== i))}
                style={add.photoRemove}
              >
                <Text style={{ color:'#fff', fontSize:12 }}>×</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>

        {/* Barcode */}
        <TouchableOpacity onPress={startBarcode} style={add.barcodeBtn}>
          <Text style={{ fontSize:16 }}>📊</Text>
          <Text style={{ color:Colors.accent2, fontSize:13, fontWeight:'600', marginLeft:8 }}>Scan Barcode</Text>
        </TouchableOpacity>

        {/* Fields — all stable, no inline component definitions */}
        <Text style={add.label}>Item Name</Text>
        <TextInput
          style={add.input}
          value={form.name}
          onChangeText={v => set('name', v)}
          placeholder="e.g. White Oxford Shirt"
          placeholderTextColor={Colors.text3}
        />

        <Text style={add.label}>Category</Text>
        <View style={add.pills}>
          {CATEGORIES.map(c => <Pill key={c} label={c} active={form.category===c} onPress={() => set('category', c)} />)}
        </View>

        <Text style={add.label}>Primary Color</Text>
        <View style={add.pills}>
          {COLORS.map(c => <Pill key={c} label={c} active={form.color===c} onPress={() => set('color', c)} />)}
        </View>

        <Text style={add.label}>Fit</Text>
        <View style={add.pills}>
          {FITS.map(f => <Pill key={f} label={f} active={form.fit===f} onPress={() => set('fit', f)} />)}
        </View>

        <View style={{ flexDirection:'row', gap:12 }}>
          <View style={{ flex:1 }}>
            <Text style={add.label}>Brand</Text>
            <TextInput style={add.input} value={form.brand} onChangeText={v => set('brand', v)} placeholder="e.g. Zara" placeholderTextColor={Colors.text3} />
          </View>
          <View style={{ flex:1 }}>
            <Text style={add.label}>Material</Text>
            <TextInput style={add.input} value={form.material} onChangeText={v => set('material', v)} placeholder="e.g. Cotton" placeholderTextColor={Colors.text3} />
          </View>
        </View>

        <Text style={add.label}>Best For (Occasions)</Text>
        <View style={add.pills}>
          {OCCASIONS.map(o => <Pill key={o} label={o} active={(form.occasions||[]).includes(o)} onPress={() => toggle('occasions', o)} />)}
        </View>

        <Text style={add.label}>Season</Text>
        <View style={add.pills}>
          {SEASONS.map(s => <Pill key={s} label={s} active={(form.seasons||[]).includes(s)} onPress={() => toggle('seasons', s)} />)}
        </View>

        <Text style={add.label}>Notes</Text>
        <TextInput
          style={[add.input, { height:70 }]}
          value={form.notes}
          onChangeText={v => set('notes', v)}
          placeholder="Any notes..."
          placeholderTextColor={Colors.text3}
          multiline
        />

        <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.85}>
          <LinearGradient colors={['#1d4ed8','#7c3aed']} style={[add.saveBtn, saving && { opacity:0.6 }]} start={{x:0,y:0}} end={{x:1,y:0}}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={add.saveBtnText}>Add to Wardrobe</Text>}
          </LinearGradient>
        </TouchableOpacity>
      </ScrollView>
    </>
  );
}

const add = StyleSheet.create({
  handle: { width:36, height:4, backgroundColor:Colors.border, borderRadius:2, alignSelf:'center', marginBottom:16 },
  title: { fontSize:20, fontWeight:'700', color:Colors.text, marginBottom:20 },
  label: { fontSize:12, fontWeight:'600', color:Colors.text2, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8, marginTop:4 },
  input: { backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.md, padding:12, fontSize:14, color:Colors.text, marginBottom:4 },
  pills: { flexDirection:'row', flexWrap:'wrap', marginHorizontal:-3, marginBottom:4 },
  photoRow: { flexDirection:'row', flexWrap:'wrap', gap:10, marginBottom:16 },
  photoAddBtn: { width:90, height:90, borderWidth:2, borderColor:Colors.border, borderStyle:'dashed', borderRadius:Radius.md, alignItems:'center', justifyContent:'center', backgroundColor:Colors.bg3 },
  photoThumb: { width:90, height:90, borderRadius:Radius.md, overflow:'hidden', position:'relative' },
  analyzingOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor:'rgba(0,0,0,0.55)', alignItems:'center', justifyContent:'center' },
  photoRemove: { position:'absolute', top:4, right:4, backgroundColor:'rgba(0,0,0,0.6)', borderRadius:10, width:20, height:20, alignItems:'center', justifyContent:'center' },
  barcodeBtn: { flexDirection:'row', alignItems:'center', padding:12, backgroundColor:Colors.bg3, borderRadius:Radius.md, borderWidth:1, borderColor:Colors.border, marginBottom:20 },
  saveBtn: { padding:15, borderRadius:Radius.md, alignItems:'center', marginTop:12 },
  saveBtnText: { color:'#fff', fontSize:15, fontWeight:'700' },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center' },
  scanFrame: { width:240, height:140, borderWidth:2, borderColor:Colors.accent2, borderRadius:Radius.md },
  scanHint: { color:'#fff', fontSize:14, marginTop:16, fontWeight:'500' },
  scanCancel: { marginTop:32, padding:12, backgroundColor:'rgba(0,0,0,0.6)', borderRadius:Radius.md },
});

/* ── Wardrobe Screen ── */
export default function WardrobeScreen() {
  const insets = useSafeAreaInsets();
  const { wardrobe, setWardrobe, addWardrobeItem, removeWardrobeItem, showToast, householdId } = useAppStore();
  const profile = useAppStore(s => s.getActiveProfile());
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [signedUrls, setSignedUrls] = useState({});

  async function loadWardrobe() {
    if (!profile) return;
    setLoading(true);
    const done = Logger.perf('Wardrobe', 'loadWardrobe');
    const { data, error } = await supabase
      .from('wardrobe_items').select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) { Logger.error('Wardrobe', 'Load failed', error); }
    else {
      setWardrobe(data || []);
      const urls = {};
      await Promise.all((data || []).map(async item => {
        if (item.photo_url) {
          const signed = await getSignedUrl(item.photo_url);
          if (signed) urls[item.id] = signed;
        }
      }));
      setSignedUrls(urls);
    }
    done();
    setLoading(false);
  }

  useEffect(() => { loadWardrobe(); }, [profile?.id]);

  async function deleteItem(id) {
    Alert.alert('Remove Item', 'Remove this from your wardrobe?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        await supabase.from('wardrobe_items').delete().eq('id', id);
        removeWardrobeItem(id);
        showToast('Item removed');
      }},
    ]);
  }

  const filtered = wardrobe.filter(i => {
    const matchCat = filter === 'All' || i.category === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || (i.name||'').toLowerCase().includes(q) || (i.brand||'').toLowerCase().includes(q) || (i.color||'').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity style={ws.itemCard} activeOpacity={0.85} onLongPress={() => deleteItem(item.id)}>
      {signedUrls[item.id]
        ? <Image source={{ uri: signedUrls[item.id] }} style={ws.itemPhoto} />
        : <View style={[ws.itemPhoto, ws.itemPhotoPlaceholder]}>
            <Text style={{ fontSize:28 }}>{CATEGORY_ICONS[item.category] || '👕'}</Text>
          </View>
      }
      <View style={ws.itemInfo}>
        <Text style={ws.itemName} numberOfLines={1}>{item.name || item.category}</Text>
        <Text style={ws.itemMeta} numberOfLines={1}>{[item.color, item.brand, item.fit].filter(Boolean).join(' · ')}</Text>
        {item.occasions?.length > 0 && <Text style={ws.itemOcc} numberOfLines={1}>{item.occasions.slice(0,2).join(', ')}</Text>}
      </View>
    </TouchableOpacity>
  ), [signedUrls]);

  return (
    <View style={[ws.screen, { paddingTop: insets.top }]}>
      <LinearGradient colors={['#0a0f1e','#0f1729','#1a2f52','#1e3a5f']} style={ws.header}>
        <Text style={ws.headerTitle}>Wardrobe</Text>
        <Text style={ws.headerSub}>{wardrobe.length} items · {profile?.display_name || profile?.label}</Text>
      </LinearGradient>

      <View style={ws.searchRow}>
        <View style={ws.searchBox}>
          <Text style={ws.searchIcon}>🔍</Text>
          <TextInput
            style={ws.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search clothes..."
            placeholderTextColor={Colors.text3}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color:Colors.text3, fontSize:18 }}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ws.filterRow}>
        {['All', ...CATEGORIES].map(c => <Pill key={c} label={c} active={filter===c} onPress={() => setFilter(c)} />)}
      </ScrollView>

      {loading
        ? <ActivityIndicator color={Colors.accent2} style={{ marginTop:60 }} />
        : filtered.length === 0
          ? <View style={ws.empty}>
              <Text style={{ fontSize:48 }}>👚</Text>
              <Text style={ws.emptyText}>{wardrobe.length === 0 ? 'Your wardrobe is empty.\nTap + to add your first item.' : 'No items match.'}</Text>
            </View>
          : <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={renderItem}
              numColumns={2}
              contentContainerStyle={{ padding:12, paddingBottom:110 }}
              columnWrapperStyle={{ gap:12 }}
              ItemSeparatorComponent={() => <View style={{ height:12 }} />}
              showsVerticalScrollIndicator={false}
            />
      }

      <TouchableOpacity style={[ws.fab, Shadow.fab]} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
        <LinearGradient colors={['#1d4ed8','#7c3aed']} style={ws.fabGrad} start={{x:0,y:0}} end={{x:1,y:1}}>
          <Text style={ws.fabText}>+</Text>
        </LinearGradient>
      </TouchableOpacity>

      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Text style={{ color:Colors.accent2, fontSize:15, fontWeight:'600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <AddItemSheet
            profile={profile}
            householdId={householdId}
            onClose={() => setShowAdd(false)}
            onSaved={(item) => { addWardrobeItem(item); showToast('Added to wardrobe'); }}
          />
        </View>
      </Modal>
    </View>
  );
}

const ws = StyleSheet.create({
  screen: { flex:1, backgroundColor:Colors.bg },
  header: { padding:Spacing.lg, paddingBottom:12 },
  headerTitle: { fontSize:22, fontWeight:'700', color:Colors.text },
  headerSub: { fontSize:12, color:Colors.text2, marginTop:2 },
  searchRow: { padding:12, paddingTop:8 },
  searchBox: { flexDirection:'row', alignItems:'center', backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.full, paddingHorizontal:14, paddingVertical:9, gap:8 },
  searchIcon: { fontSize:14 },
  searchInput: { flex:1, fontSize:14, color:Colors.text },
  filterRow: { paddingHorizontal:12, paddingBottom:8 },
  itemCard: { width:CARD, backgroundColor:Colors.card, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, overflow:'hidden', ...Shadow.card },
  itemPhoto: { width:'100%', height:CARD * 1.2, resizeMode:'cover' },
  itemPhotoPlaceholder: { backgroundColor:Colors.bg3, alignItems:'center', justifyContent:'center' },
  itemInfo: { padding:10 },
  itemName: { fontSize:13, fontWeight:'600', color:Colors.text, marginBottom:2 },
  itemMeta: { fontSize:11, color:Colors.text2 },
  itemOcc: { fontSize:10, color:Colors.text3, marginTop:3 },
  empty: { flex:1, alignItems:'center', justifyContent:'center', padding:40, gap:12 },
  emptyText: { fontSize:14, color:Colors.text2, textAlign:'center', lineHeight:22 },
  fab: { position:'absolute', bottom:90, right:20, borderRadius:28, overflow:'hidden' },
  fabGrad: { width:56, height:56, alignItems:'center', justifyContent:'center' },
  fabText: { color:'#fff', fontSize:28, lineHeight:56 },
  modalHeader: { padding:16, borderBottomWidth:1, borderBottomColor:Colors.border, alignItems:'flex-end' },
});
