import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Image, Alert, ActivityIndicator, Modal,
  ScrollView, ActionSheetIOS, Platform,
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

const CATEGORY_ICONS = {
  Tops:'👕', Bottoms:'👖', Dresses:'👗', Outerwear:'🧥', Shoes:'👟',
  Accessories:'👜', Activewear:'🏃', Swimwear:'🩱', Loungewear:'🩳',
};

function empty() {
  return { name:'', category:'Tops', color:'Black', colors:[], material:'', fit:'Regular', occasions:[], seasons:[], brand:'', notes:'' };
}

/* ── Add Item Sheet ── */
function AddItemSheet({ profile, householdId, onClose, onSaved }) {
  const [form, setForm] = useState(empty());
  const [photoUri, setPhotoUri] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (k, v) => setForm(f => { const a = f[k]||[]; return { ...f, [k]: a.includes(v) ? a.filter(x=>x!==v) : [...a,v] }; });

  async function pickPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    Logger.info('Wardrobe', 'Photo picked — analyzing with Claude Vision');
    setAnalyzing(true);
    try {
      const b64 = await imageToBase64(uri);
      const parsed = await analyzeClothingPhoto(b64, 'image/jpeg');
      setForm(f => ({ ...f, ...parsed, colors: parsed.color ? [parsed.color] : f.colors }));
      Logger.info('Wardrobe', 'Claude Vision analysis done', parsed);
    } catch (e) {
      Logger.error('Wardrobe', 'Photo analysis failed', e);
    }
    setAnalyzing(false);
  }

  async function takePhoto() {
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setPhotoUri(uri);
    setAnalyzing(true);
    try {
      const b64 = await imageToBase64(uri);
      const parsed = await analyzeClothingPhoto(b64, 'image/jpeg');
      setForm(f => ({ ...f, ...parsed }));
    } catch (e) { Logger.error('Wardrobe', 'Camera analysis failed', e); }
    setAnalyzing(false);
  }

  function showPhotoOptions() {
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Cancel', 'Take Photo', 'Choose from Library'], cancelButtonIndex: 0 },
        (i) => { if (i === 1) takePhoto(); if (i === 2) pickPhoto(); }
      );
    } else {
      Alert.alert('Add Photo', '', [
        { text: 'Take Photo', onPress: takePhoto },
        { text: 'Choose from Library', onPress: pickPhoto },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
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
      Logger.info('Wardrobe', 'Product info loaded', info);
    } else {
      set('barcode', data);
      Logger.warn('Wardrobe', 'No product found for barcode', { data });
    }
  }

  async function save() {
    if (!form.category) { return; }
    setSaving(true);
    Logger.info('Wardrobe', 'Saving item', { name: form.name, category: form.category });
    try {
      let photo_url = null;
      if (photoUri) {
        const ext = photoUri.split('.').pop() || 'jpg';
        const path = `${profile.id}/${Date.now()}.${ext}`;
        photo_url = await uploadPhoto(photoUri, path);
        Logger.info('Wardrobe', 'Photo uploaded', { path: photo_url });
      }
      const { data, error } = await supabase.from('wardrobe_items').insert({
        ...form, photo_url, profile_id: profile.id, household_id: householdId,
      }).select().single();
      if (error) throw error;
      Logger.info('Wardrobe', 'Item saved', { id: data.id });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(data);
      onClose();
    } catch (e) {
      Logger.error('Wardrobe', 'Save failed', e);
      Alert.alert('Error', 'Could not save item. Please try again.');
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
      <View style={styles.scanOverlay}>
        <View style={styles.scanFrame} />
        <Text style={styles.scanHint}>Point at barcode</Text>
        <TouchableOpacity onPress={() => setScanning(false)} style={styles.scanCancel}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '600' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={{ padding: Spacing.lg, paddingBottom: 60 }} showsVerticalScrollIndicator={false}>
      <View style={styles.sheetHandle} />
      <Text style={styles.sheetTitle}>Add Clothing Item</Text>

      {/* Photo area */}
      <TouchableOpacity onPress={showPhotoOptions} style={[styles.photoBox, photoUri && { borderStyle: 'solid' }]}>
        {photoUri
          ? <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          : <View style={styles.photoPlaceholder}>
              <Text style={{ fontSize: 32 }}>{analyzing ? '🔍' : '📷'}</Text>
              <Text style={{ color: Colors.text2, fontSize: 13, marginTop: 6 }}>{analyzing ? 'Analyzing with AI...' : 'Tap to add photo'}</Text>
              {analyzing && <ActivityIndicator color={Colors.accent2} style={{ marginTop: 8 }} />}
            </View>
        }
      </TouchableOpacity>

      {/* Barcode */}
      <TouchableOpacity onPress={startBarcode} style={styles.barcodeBtn}>
        <Text style={{ fontSize: 16 }}>📊</Text>
        <Text style={{ color: Colors.accent2, fontSize: 13, fontWeight: '600', marginLeft: 8 }}>Scan Barcode</Text>
      </TouchableOpacity>

      <Field label="Item Name">
        <TextInput style={styles.input} value={form.name} onChangeText={v => set('name', v)} placeholder="e.g. White Oxford Shirt" placeholderTextColor={Colors.text3} />
      </Field>
      <Field label="Category">
        <View style={styles.pills}>{CATEGORIES.map(c => <Pill key={c} label={c} active={form.category===c} onPress={()=>set('category',c)} />)}</View>
      </Field>
      <Field label="Primary Color">
        <View style={styles.pills}>{COLORS.map(c => <Pill key={c} label={c} active={form.color===c} onPress={()=>set('color',c)} />)}</View>
      </Field>
      <Field label="Fit">
        <View style={styles.pills}>{FITS.map(f => <Pill key={f} label={f} active={form.fit===f} onPress={()=>set('fit',f)} />)}</View>
      </Field>
      <View style={{ flexDirection:'row', gap:12 }}>
        <View style={{ flex:1 }}>
          <Field label="Brand">
            <TextInput style={styles.input} value={form.brand} onChangeText={v=>set('brand',v)} placeholder="e.g. Zara" placeholderTextColor={Colors.text3} />
          </Field>
        </View>
        <View style={{ flex:1 }}>
          <Field label="Material">
            <TextInput style={styles.input} value={form.material} onChangeText={v=>set('material',v)} placeholder="e.g. Cotton" placeholderTextColor={Colors.text3} />
          </Field>
        </View>
      </View>
      <Field label="Best For (Occasions)">
        <View style={styles.pills}>{OCCASIONS.map(o => <Pill key={o} label={o} active={(form.occasions||[]).includes(o)} onPress={()=>toggle('occasions',o)} />)}</View>
      </Field>
      <Field label="Season">
        <View style={styles.pills}>{SEASONS.map(s => <Pill key={s} label={s} active={(form.seasons||[]).includes(s)} onPress={()=>toggle('seasons',s)} />)}</View>
      </Field>
      <Field label="Notes">
        <TextInput style={[styles.input,{height:70}]} value={form.notes} onChangeText={v=>set('notes',v)} placeholder="Any notes..." placeholderTextColor={Colors.text3} multiline />
      </Field>

      <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.8}>
        <LinearGradient colors={Gradients.accent} style={[styles.saveBtn, saving&&{opacity:0.6}]} start={{x:0,y:0}} end={{x:1,y:0}}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.saveBtnText}>Add to Wardrobe</Text>}
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Field({ label, children }) {
  return <View style={{ marginBottom: 16 }}><Text style={styles.fieldLabel}>{label}</Text>{children}</View>;
}

/* ── Wardrobe Screen ── */
export default function WardrobeScreen() {
  const insets = useSafeAreaInsets();
  const { wardrobe, wardrobeLoaded, setWardrobe, addWardrobeItem, removeWardrobeItem, showToast, householdId } = useAppStore();
  const profile = useAppStore(s => s.getActiveProfile());
  const [loading, setLoading] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [signedUrls, setSignedUrls] = useState({});

  async function loadWardrobe() {
    if (!profile) return;
    setLoading(true);
    Logger.info('Wardrobe', 'Loading items', { profileId: profile.id });
    const done = Logger.perf('Wardrobe', 'loadWardrobe');
    const { data, error } = await supabase.from('wardrobe_items').select('*').eq('profile_id', profile.id).order('created_at', { ascending: false });
    if (error) { Logger.error('Wardrobe', 'Load failed', error); }
    else {
      Logger.info('Wardrobe', `Loaded ${data.length} items`);
      Logger.table('Wardrobe', data.slice(0, 5).map(i => ({ id: i.id.slice(0,8), name: i.name, category: i.category })));
      setWardrobe(data || []);
      // Fetch signed URLs for private photos
      const urls = {};
      for (const item of data) {
        if (item.photo_url) {
          const signed = await getSignedUrl(item.photo_url);
          if (signed) urls[item.id] = signed;
        }
      }
      setSignedUrls(urls);
    }
    done();
    setLoading(false);
  }

  useEffect(() => { loadWardrobe(); }, [profile?.id]);

  async function deleteItem(id) {
    Alert.alert('Remove Item', 'Remove this item from your wardrobe?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove', style: 'destructive', onPress: async () => {
          await supabase.from('wardrobe_items').delete().eq('id', id);
          removeWardrobeItem(id);
          showToast('Item removed');
          Logger.info('Wardrobe', 'Item deleted', { id });
        }
      }
    ]);
  }

  const filtered = wardrobe.filter(i => {
    const matchCat = filter === 'All' || i.category === filter;
    const q = search.toLowerCase();
    const matchSearch = !q || (i.name||'').toLowerCase().includes(q) || (i.brand||'').toLowerCase().includes(q) || (i.color||'').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  function renderItem({ item }) {
    return (
      <TouchableOpacity style={styles.itemCard} activeOpacity={0.85} onLongPress={() => deleteItem(item.id)}>
        {signedUrls[item.id]
          ? <Image source={{ uri: signedUrls[item.id] }} style={styles.itemPhoto} />
          : <View style={[styles.itemPhoto, styles.itemPhotoPlaceholder]}>
              <Text style={{ fontSize: 28 }}>{CATEGORY_ICONS[item.category] || '👕'}</Text>
            </View>
        }
        <View style={styles.itemInfo}>
          <Text style={styles.itemName} numberOfLines={1}>{item.name || item.category}</Text>
          <Text style={styles.itemMeta} numberOfLines={1}>{[item.color, item.brand, item.fit].filter(Boolean).join(' · ')}</Text>
          {item.occasions?.length > 0 && <Text style={styles.itemOcc} numberOfLines={1}>{item.occasions.slice(0,2).join(', ')}</Text>}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Header */}
      <LinearGradient colors={Gradients.header} style={styles.header}>
        <Text style={styles.headerTitle}>Wardrobe</Text>
        <Text style={styles.headerSub}>{wardrobe.length} items · {profile?.display_name || profile?.label}</Text>
      </LinearGradient>

      {/* Search */}
      <View style={styles.searchRow}>
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput style={styles.searchInput} value={search} onChangeText={setSearch} placeholder="Search clothes..." placeholderTextColor={Colors.text3} />
          {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Text style={{ color: Colors.text3, fontSize: 16 }}>×</Text></TouchableOpacity>}
        </View>
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
        {['All', ...CATEGORIES].map(c => <Pill key={c} label={c} active={filter===c} onPress={()=>setFilter(c)} />)}
      </ScrollView>

      {loading
        ? <ActivityIndicator color={Colors.accent2} style={{ marginTop: 60 }} />
        : filtered.length === 0
          ? <View style={styles.empty}>
              <Text style={{ fontSize: 48 }}>👚</Text>
              <Text style={styles.emptyText}>{wardrobe.length === 0 ? 'Your wardrobe is empty.\nTap + to add your first item.' : 'No items match this filter.'}</Text>
            </View>
          : <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={renderItem}
              numColumns={2}
              contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
              columnWrapperStyle={{ gap: 12 }}
              ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
              showsVerticalScrollIndicator={false}
            />
      }

      {/* FAB */}
      <TouchableOpacity style={[styles.fab, Shadow.fab]} onPress={() => setShowAdd(true)} activeOpacity={0.85}>
        <LinearGradient colors={Gradients.accent} style={styles.fabGrad} start={{x:0,y:0}} end={{x:1,y:1}}>
          <Text style={styles.fabText}>+</Text>
        </LinearGradient>
      </TouchableOpacity>

      {/* Add sheet modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex: 1, backgroundColor: Colors.bg }}>
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Text style={{ color: Colors.accent2, fontSize: 15, fontWeight: '600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <AddItemSheet
            profile={profile}
            householdId={householdId}
            onClose={() => setShowAdd(false)}
            onSaved={(item) => { addWardrobeItem(item); showToast('Item added to wardrobe'); }}
          />
        </View>
      </Modal>
    </View>
  );
}

const CARD_W = (Dimensions?.get?.('window')?.width - 36) / 2;
import { Dimensions } from 'react-native';
const W = Dimensions.get('window').width;
const CARD = (W - 36) / 2;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.bg },
  header: { padding: Spacing.lg, paddingBottom: 12 },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  headerSub: { fontSize: 12, color: Colors.text2, marginTop: 2 },
  searchRow: { padding: 12, paddingTop: 8 },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.full, paddingHorizontal: 14, paddingVertical: 9, gap: 8 },
  searchIcon: { fontSize: 14 },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  filterRow: { paddingHorizontal: 12, paddingBottom: 8, gap: 0 },
  itemCard: { width: CARD, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth: 1, borderColor: Colors.border, overflow: 'hidden', ...Shadow.card },
  itemPhoto: { width: '100%', height: CARD * 1.2, resizeMode: 'cover' },
  itemPhotoPlaceholder: { backgroundColor: Colors.bg3, alignItems: 'center', justifyContent: 'center' },
  itemInfo: { padding: 10 },
  itemName: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 2 },
  itemMeta: { fontSize: 11, color: Colors.text2 },
  itemOcc: { fontSize: 10, color: Colors.text3, marginTop: 3 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 12 },
  emptyText: { fontSize: 14, color: Colors.text2, textAlign: 'center', lineHeight: 22 },
  fab: { position: 'absolute', bottom: 90, right: 20, borderRadius: 28, overflow: 'hidden' },
  fabGrad: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  fabText: { color: '#fff', fontSize: 28, fontWeight: '300', lineHeight: 56 },
  modalHeader: { padding: 16, borderBottomWidth: 1, borderBottomColor: Colors.border, alignItems: 'flex-end' },
  sheet: { flex: 1, backgroundColor: Colors.bg },
  sheetHandle: { width: 36, height: 4, backgroundColor: Colors.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 20 },
  photoBox: { height: 200, borderWidth: 2, borderColor: Colors.border, borderStyle: 'dashed', borderRadius: Radius.lg, overflow: 'hidden', marginBottom: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.bg3 },
  photoPreview: { width: '100%', height: '100%', resizeMode: 'cover' },
  photoPlaceholder: { alignItems: 'center' },
  barcodeBtn: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: Colors.bg3, borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, marginBottom: 20 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  input: { backgroundColor: Colors.inpBg, borderWidth: 1, borderColor: Colors.inpBorder, borderRadius: Radius.md, padding: 12, fontSize: 14, color: Colors.text },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.text2, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  saveBtn: { padding: 15, borderRadius: Radius.md, alignItems: 'center', marginTop: 8 },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanFrame: { width: 240, height: 140, borderWidth: 2, borderColor: Colors.accent2, borderRadius: Radius.md },
  scanHint: { color: '#fff', fontSize: 14, marginTop: 16, fontWeight: '500' },
  scanCancel: { marginTop: 32, padding: 12, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.md },
});
