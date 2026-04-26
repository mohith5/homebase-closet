import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Image, Alert, ActivityIndicator, Modal,
  ScrollView, Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { supabase } from '../../lib/supabase';
import Logger from '../../lib/logger';
import { analyzeClothingPhoto, splitOutfitIntoItems } from '../../lib/claude';
import { lookupBarcode } from '../../lib/barcode';
import { uploadPhoto, imageToBase64 } from '../../lib/storage';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius, Shadow } from '../../theme';
import { useAppStore } from '../../store';

const CATEGORIES = ['Tops','Bottoms','Dresses','Outerwear','Shoes','Jewelry','Watches','Bags','Hats','Belts','Sunglasses','Activewear','Swimwear','Loungewear'];
const OCCASIONS  = ['Work/Office','Date Night','Weekend Casual','Formal/Event','Gym/Active','Travel','Beach','Party','Outdoor'];
const SEASONS    = ['Spring','Summer','Fall','Winter'];
const COLORS     = ['Black','White','Gray','Navy','Blue','Light Blue','Green','Olive','Khaki','Beige','Brown','Burgundy','Red','Pink','Purple','Yellow','Orange','Multicolor','Pattern'];
const FITS       = ['Slim','Regular','Loose','Oversized','Tailored'];
const CATEGORY_ICONS = {
  Tops:'👕', Bottoms:'👖', Dresses:'👗', Outerwear:'🧥', Shoes:'👟',
  Jewelry:'💎', Watches:'⌚', Bags:'👜', Hats:'🧢', Belts:'🪢',
  Sunglasses:'🕶', Activewear:'🏃', Swimwear:'🩱', Loungewear:'🩳',
};

const W = Dimensions.get('window').width;
const CARD = (W - 36) / 2;

function emptyForm(defaults = {}) {
  return { name:'', category:'Tops', color:'Black', colors:[], material:'', fit:'Regular', occasions:[], seasons:[], brand:'', notes:'', ...defaults };
}

/* ══════════════════════════════════════════════
   EDIT / ADD ITEM MODAL
   Used for both adding new items and editing existing ones
══════════════════════════════════════════════ */
function ItemModal({ profile, householdId, existingItem, onClose, onSaved }) {
  const isEdit = !!existingItem;
  const [form, setForm] = useState(emptyForm(existingItem || {}));
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  const set = useCallback((k, v) => setForm(f => ({ ...f, [k]: v })), []);
  const toggle = useCallback((k, v) => setForm(f => {
    const a = f[k] || [];
    return { ...f, [k]: a.includes(v) ? a.filter(x => x !== v) : [...a, v] };
  }), []);

  async function startBarcode() {
    if (!permission?.granted) {
      const { granted } = await requestPermission();
      if (!granted) { Alert.alert('Camera permission required'); return; }
    }
    setScanning(true);
  }

  async function onBarcodeScanned({ data }) {
    setScanning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const info = await lookupBarcode(data);
    if (info) { setForm(f => ({ ...f, ...info })); }
    else Alert.alert('Barcode scanned', 'No product found. Fill in details manually.');
  }

  async function save() {
    setSaving(true);
    try {
      if (isEdit) {
        const { error } = await supabase.from('wardrobe_items').update(form).eq('id', existingItem.id);
        if (error) throw error;
        onSaved({ ...existingItem, ...form });
      } else {
        const { data, error } = await supabase.from('wardrobe_items')
          .insert({ ...form, profile_id: profile.id, household_id: householdId })
          .select().single();
        if (error) throw error;
        onSaved(data);
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onClose();
    } catch (e) {
      Logger.error('Wardrobe', 'Item save failed', e);
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  }

  if (scanning) return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView style={StyleSheet.absoluteFill} onBarcodeScanned={onBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','upc_e','qr'] }} />
      <View style={m.scanOverlay}>
        <View style={m.scanFrame} />
        <Text style={m.scanHint}>Point at barcode</Text>
        <TouchableOpacity onPress={() => setScanning(false)} style={m.scanCancel}>
          <Text style={{ color:'#fff', fontSize:14, fontWeight:'600' }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView style={{ flex:1 }} contentContainerStyle={{ padding:Spacing.lg, paddingBottom:80 }}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={m.handle} />
      <Text style={m.title}>{isEdit ? 'Edit Item' : 'Add Item'}</Text>

      {/* Category icon display — no personal photo */}
      <View style={m.iconDisplay}>
        <Text style={m.iconEmoji}>{CATEGORY_ICONS[form.category] || '👕'}</Text>
        <Text style={m.iconLabel}>{form.category}</Text>
      </View>

      {/* Barcode only for new items */}
      {!isEdit && (
        <TouchableOpacity onPress={startBarcode} style={m.barcodeBtn}>
          <Text style={{ fontSize:16 }}>📊</Text>
          <Text style={{ color:Colors.accent2, fontSize:13, fontWeight:'600', marginLeft:8 }}>Scan Barcode to Auto-Fill</Text>
        </TouchableOpacity>
      )}

      <Text style={m.label}>Category</Text>
      <View style={m.pills}>
        {CATEGORIES.map(c => <Pill key={c} label={c} active={form.category===c} onPress={() => set('category', c)} />)}
      </View>

      <Text style={m.label}>Item Name</Text>
      <TextInput style={m.input} value={form.name} onChangeText={v => set('name', v)}
        placeholder="e.g. White Oxford Shirt" placeholderTextColor={Colors.text3} />

      <Text style={m.label}>Primary Color</Text>
      <View style={m.pills}>
        {COLORS.map(c => <Pill key={c} label={c} active={form.color===c} onPress={() => set('color', c)} />)}
      </View>

      <Text style={m.label}>Fit</Text>
      <View style={m.pills}>
        {FITS.map(f => <Pill key={f} label={f} active={form.fit===f} onPress={() => set('fit', f)} />)}
      </View>

      <View style={{ flexDirection:'row', gap:12 }}>
        <View style={{ flex:1 }}>
          <Text style={m.label}>Brand</Text>
          <TextInput style={m.input} value={form.brand} onChangeText={v => set('brand', v)}
            placeholder="e.g. Nike" placeholderTextColor={Colors.text3} />
        </View>
        <View style={{ flex:1 }}>
          <Text style={m.label}>Material</Text>
          <TextInput style={m.input} value={form.material} onChangeText={v => set('material', v)}
            placeholder="e.g. Cotton" placeholderTextColor={Colors.text3} />
        </View>
      </View>

      <Text style={m.label}>Best For</Text>
      <View style={m.pills}>
        {OCCASIONS.map(o => <Pill key={o} label={o} active={(form.occasions||[]).includes(o)} onPress={() => toggle('occasions', o)} />)}
      </View>

      <Text style={m.label}>Season</Text>
      <View style={m.pills}>
        {SEASONS.map(s => <Pill key={s} label={s} active={(form.seasons||[]).includes(s)} onPress={() => toggle('seasons', s)} />)}
      </View>

      <Text style={m.label}>Notes</Text>
      <TextInput style={[m.input, { height:60 }]} value={form.notes} onChangeText={v => set('notes', v)}
        placeholder="Any notes..." placeholderTextColor={Colors.text3} multiline />

      <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.85} style={{ marginTop:16 }}>
        <LinearGradient colors={['#1d4ed8','#7c3aed']} style={[m.saveBtn, saving && { opacity:0.6 }]}
          start={{x:0,y:0}} end={{x:1,y:0}}>
          {saving ? <ActivityIndicator color="#fff" /> : <Text style={m.saveBtnText}>{isEdit ? 'Save Changes' : 'Add to Wardrobe'}</Text>}
        </LinearGradient>
      </TouchableOpacity>

      {isEdit && (
        <TouchableOpacity onPress={onClose} style={m.cancelBtn}>
          <Text style={m.cancelBtnText}>Cancel</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const m = StyleSheet.create({
  handle: { width:36, height:4, backgroundColor:Colors.border, borderRadius:2, alignSelf:'center', marginBottom:16 },
  title: { fontSize:20, fontWeight:'700', color:Colors.text, marginBottom:20 },
  iconDisplay: { alignItems:'center', padding:20, backgroundColor:Colors.bg3, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, marginBottom:16 },
  iconEmoji: { fontSize:48 },
  iconLabel: { fontSize:13, color:Colors.text2, marginTop:6, fontWeight:'600' },
  barcodeBtn: { flexDirection:'row', alignItems:'center', padding:12, backgroundColor:Colors.bg3, borderRadius:Radius.md, borderWidth:1, borderColor:Colors.border, marginBottom:20 },
  label: { fontSize:12, fontWeight:'600', color:Colors.text2, textTransform:'uppercase', letterSpacing:0.5, marginBottom:8, marginTop:16 },
  pills: { flexDirection:'row', flexWrap:'wrap', marginHorizontal:-3 },
  input: { backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.md, padding:12, fontSize:14, color:Colors.text },
  saveBtn: { padding:15, borderRadius:Radius.md, alignItems:'center' },
  saveBtnText: { color:'#fff', fontSize:15, fontWeight:'700' },
  cancelBtn: { padding:14, alignItems:'center', marginTop:8 },
  cancelBtnText: { color:Colors.text3, fontSize:14 },
  scanOverlay: { ...StyleSheet.absoluteFillObject, alignItems:'center', justifyContent:'center' },
  scanFrame: { width:240, height:140, borderWidth:2, borderColor:Colors.accent2, borderRadius:Radius.md },
  scanHint: { color:'#fff', fontSize:14, marginTop:16, fontWeight:'500' },
  scanCancel: { marginTop:32, padding:12, backgroundColor:'rgba(0,0,0,0.6)', borderRadius:Radius.md },
});

/* ══════════════════════════════════════════════
   UPLOAD & SEGREGATE SHEET
   Handles multi-photo upload, parallel analysis,
   shows detected items (not full-body photos)
══════════════════════════════════════════════ */
function UploadSheet({ profile, householdId, onClose, onItemsSaved }) {
  const [processing, setProcessing] = useState(false);
  const [detectedItems, setDetectedItems] = useState([]); // [{...itemData, confirmed, editing}]
  const [saving, setSaving] = useState(false);

  async function pickAndAnalyze() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.75,
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (result.canceled) return;

    setProcessing(true);
    setDetectedItems([]);
    Logger.info('Wardrobe', `Analyzing ${result.assets.length} photos in parallel`);

    // Analyze ALL photos simultaneously (parallel)
    const promises = result.assets.map(async (asset) => {
      try {
        const b64 = await imageToBase64(asset.uri);
        // Detect if it's a full-body/outfit photo or a single item
        const items = await splitOutfitIntoItems(b64, 'image/jpeg');
        Logger.info('Wardrobe', `Photo detected ${items.length} items`);
        return items.map(item => ({ ...item, confirmed: true, _editing: false, _id: Math.random().toString(36) }));
      } catch (e) {
        Logger.error('Wardrobe', 'Photo analysis failed', e);
        return [];
      }
    });

    const results = await Promise.all(promises);
    const allItems = results.flat();
    Logger.info('Wardrobe', `Total items detected across all photos: ${allItems.length}`);
    setDetectedItems(allItems);
    setProcessing(false);

    if (allItems.length === 0) {
      Alert.alert('No Items Detected', 'Try a clearer photo with good lighting. Full-body photos work best.');
    }
  }

  function updateItem(id, field, value) {
    setDetectedItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  }

  function removeItem(id) {
    setDetectedItems(prev => prev.filter(i => i._id !== id));
  }

  function toggleConfirm(id) {
    setDetectedItems(prev => prev.map(i => i._id === id ? { ...i, confirmed: !i.confirmed } : i));
  }

  async function saveAll() {
    const toSave = detectedItems.filter(i => i.confirmed);
    if (toSave.length === 0) { Alert.alert('Nothing to save', 'Confirm at least one item first.'); return; }
    setSaving(true);
    Logger.info('Wardrobe', `Saving ${toSave.length} confirmed items`);
    try {
      const inserts = toSave.map(({ _id, confirmed, _editing, ...item }) => ({
        ...item,
        photo_url: null, // No personal photo stored — category icon used instead
        profile_id: profile.id,
        household_id: householdId,
      }));
      const { data, error } = await supabase.from('wardrobe_items').insert(inserts).select();
      if (error) throw error;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onItemsSaved(data);
      onClose();
    } catch (e) {
      Logger.error('Wardrobe', 'Batch save failed', e);
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  }

  return (
    <ScrollView style={{ flex:1 }} contentContainerStyle={{ padding:Spacing.lg, paddingBottom:80 }}
      showsVerticalScrollIndicator={false}>
      <View style={u.handle} />
      <Text style={u.title}>Upload & Auto-Detect Items</Text>
      <Text style={u.sub}>Upload outfit photos — JARVIS detects and separates every item automatically. Your personal photos are never stored.</Text>

      <TouchableOpacity onPress={pickAndAnalyze} disabled={processing} style={u.uploadBtn} activeOpacity={0.85}>
        <LinearGradient colors={['#1d4ed8','#7c3aed']} style={u.uploadBtnGrad} start={{x:0,y:0}} end={{x:1,y:0}}>
          {processing
            ? <><ActivityIndicator color="#fff" size="small" /><Text style={u.uploadBtnText}>  Analyzing all photos...</Text></>
            : <Text style={u.uploadBtnText}>📷  Select Photos (up to 10)</Text>
          }
        </LinearGradient>
      </TouchableOpacity>

      {processing && (
        <View style={u.progressCard}>
          <ActivityIndicator color={Colors.accent2} />
          <Text style={u.progressText}>JARVIS is scanning all photos simultaneously and detecting each item...</Text>
        </View>
      )}

      {detectedItems.length > 0 && (
        <>
          <Text style={u.detectedHeader}>
            {detectedItems.length} items detected — confirm what to save
          </Text>
          <Text style={u.detectedSub}>Tap to confirm ✓ or remove ✕. Edit any field before saving.</Text>

          {detectedItems.map((item) => (
            <DetectedItemCard
              key={item._id}
              item={item}
              onToggleConfirm={() => toggleConfirm(item._id)}
              onRemove={() => removeItem(item._id)}
              onChange={(field, val) => updateItem(item._id, field, val)}
            />
          ))}

          <TouchableOpacity onPress={saveAll} disabled={saving} activeOpacity={0.85}>
            <LinearGradient colors={['#1d4ed8','#7c3aed']} style={[u.saveAllBtn, saving && { opacity:0.6 }]}
              start={{x:0,y:0}} end={{x:1,y:0}}>
              {saving
                ? <ActivityIndicator color="#fff" />
                : <Text style={u.saveAllText}>Save {detectedItems.filter(i=>i.confirmed).length} Items to Wardrobe</Text>
              }
            </LinearGradient>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

/* Single detected item card — shows category icon, NOT the photo */
function DetectedItemCard({ item, onToggleConfirm, onRemove, onChange }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[u.itemCard, !item.confirmed && { opacity:0.45 }]}>
      <View style={u.itemCardHeader}>
        {/* Category icon — never a personal photo */}
        <View style={u.itemIcon}>
          <Text style={{ fontSize:28 }}>{CATEGORY_ICONS[item.category] || '👕'}</Text>
        </View>
        <View style={{ flex:1 }}>
          <Text style={u.itemName}>{item.name || item.category}</Text>
          <Text style={u.itemMeta}>{[item.color, item.category, item.fit].filter(Boolean).join(' · ')}</Text>
        </View>
        <View style={{ flexDirection:'row', gap:8 }}>
          <TouchableOpacity onPress={onToggleConfirm} style={[u.confirmBtn, item.confirmed && u.confirmBtnActive]}>
            <Text style={{ fontSize:16 }}>{item.confirmed ? '✓' : '○'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onRemove} style={u.removeBtn}>
            <Text style={{ fontSize:16, color:Colors.error }}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={u.editToggle}>
        <Text style={u.editToggleText}>{expanded ? '▲ Less' : '✏️ Edit details'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={u.editSection}>
          <Text style={u.editLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection:'row', gap:6 }}>
              {CATEGORIES.map(c => <Pill key={c} label={c} active={item.category===c} onPress={() => onChange('category', c)} />)}
            </View>
          </ScrollView>
          <Text style={u.editLabel}>Name</Text>
          <TextInput style={u.editInput} value={item.name || ''} onChangeText={v => onChange('name', v)}
            placeholder="Item name" placeholderTextColor={Colors.text3} />
          <Text style={u.editLabel}>Color</Text>
          <TextInput style={u.editInput} value={item.color || ''} onChangeText={v => onChange('color', v)}
            placeholder="Color" placeholderTextColor={Colors.text3} />
          <Text style={u.editLabel}>Brand</Text>
          <TextInput style={u.editInput} value={item.brand || ''} onChangeText={v => onChange('brand', v)}
            placeholder="Brand (optional)" placeholderTextColor={Colors.text3} />
        </View>
      )}
    </View>
  );
}

const u = StyleSheet.create({
  handle: { width:36, height:4, backgroundColor:Colors.border, borderRadius:2, alignSelf:'center', marginBottom:16 },
  title: { fontSize:20, fontWeight:'700', color:Colors.text, marginBottom:8 },
  sub: { fontSize:13, color:Colors.text2, lineHeight:19, marginBottom:20 },
  uploadBtn: { borderRadius:Radius.md, overflow:'hidden', marginBottom:16 },
  uploadBtnGrad: { padding:16, flexDirection:'row', alignItems:'center', justifyContent:'center' },
  uploadBtnText: { color:'#fff', fontSize:15, fontWeight:'700' },
  progressCard: { backgroundColor:Colors.bg3, borderRadius:Radius.md, borderWidth:1, borderColor:Colors.border, padding:16, flexDirection:'row', alignItems:'center', gap:12, marginBottom:16 },
  progressText: { flex:1, fontSize:13, color:Colors.text2, lineHeight:19 },
  detectedHeader: { fontSize:16, fontWeight:'700', color:Colors.text, marginBottom:4, marginTop:8 },
  detectedSub: { fontSize:12, color:Colors.text3, marginBottom:14 },
  itemCard: { backgroundColor:Colors.card, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, padding:14, marginBottom:12 },
  itemCardHeader: { flexDirection:'row', alignItems:'center', gap:12, marginBottom:8 },
  itemIcon: { width:52, height:52, backgroundColor:Colors.bg3, borderRadius:Radius.md, alignItems:'center', justifyContent:'center', borderWidth:1, borderColor:Colors.border },
  itemName: { fontSize:14, fontWeight:'600', color:Colors.text },
  itemMeta: { fontSize:12, color:Colors.text2, marginTop:2 },
  confirmBtn: { width:36, height:36, borderRadius:18, borderWidth:1.5, borderColor:Colors.border, alignItems:'center', justifyContent:'center', backgroundColor:Colors.bg3 },
  confirmBtnActive: { borderColor:Colors.success, backgroundColor:'rgba(74,222,128,0.15)' },
  removeBtn: { width:36, height:36, borderRadius:18, alignItems:'center', justifyContent:'center' },
  editToggle: { paddingTop:6 },
  editToggleText: { fontSize:12, color:Colors.accent2, fontWeight:'600' },
  editSection: { marginTop:10, gap:8 },
  editLabel: { fontSize:11, fontWeight:'600', color:Colors.text3, textTransform:'uppercase', letterSpacing:0.4 },
  editInput: { backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.sm, padding:10, fontSize:14, color:Colors.text },
  saveAllBtn: { padding:15, borderRadius:Radius.md, alignItems:'center', marginTop:8 },
  saveAllText: { color:'#fff', fontSize:15, fontWeight:'700' },
});

/* ══════════════════════════════════════════════
   WARDROBE SCREEN
══════════════════════════════════════════════ */
export default function WardrobeScreen() {
  const insets = useSafeAreaInsets();
  const { wardrobe, setWardrobe, addWardrobeItem, removeWardrobeItem, showToast, householdId } = useAppStore();
  const profile = useAppStore(s => s.getActiveProfile());
  const [loading, setLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);  // multi-photo upload sheet
  const [editingItem, setEditingItem] = useState(null); // item being edited
  const [showAdd, setShowAdd] = useState(false);        // manual add sheet
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');

  async function loadWardrobe() {
    if (!profile) return;
    setLoading(true);
    const done = Logger.perf('Wardrobe', 'loadWardrobe');
    const { data, error } = await supabase
      .from('wardrobe_items').select('*')
      .eq('profile_id', profile.id)
      .order('created_at', { ascending: false });
    if (error) Logger.error('Wardrobe', 'Load failed', error);
    else setWardrobe(data || []);
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

  function handleItemSaved(updated) {
    // Update in store without full reload
    if (editingItem) {
      setWardrobe(wardrobe.map(i => i.id === updated.id ? updated : i));
    } else {
      addWardrobeItem(updated);
    }
    showToast(editingItem ? 'Item updated' : 'Item added');
    setEditingItem(null);
  }

  const filtered = wardrobe.filter(i => {
    const matchCat = filter === 'All' || i.category === filter;
    const q = search.toLowerCase();
    const matchSearch = !q ||
      (i.name||'').toLowerCase().includes(q) ||
      (i.brand||'').toLowerCase().includes(q) ||
      (i.color||'').toLowerCase().includes(q) ||
      (i.category||'').toLowerCase().includes(q);
    return matchCat && matchSearch;
  });

  // Group by category for display
  const grouped = CATEGORIES.reduce((acc, cat) => {
    const items = filtered.filter(i => i.category === cat);
    if (items.length > 0) acc[cat] = items;
    return acc;
  }, {});

  const renderItem = useCallback(({ item }) => (
    <TouchableOpacity
      style={ws.itemCard}
      activeOpacity={0.85}
      onPress={() => setEditingItem(item)}
      onLongPress={() => deleteItem(item.id)}
    >
      {/* Show signed photo if available, else category emoji */}
      {item.photo_url
        ? <Image source={{ uri: item.photo_url }} style={ws.itemPhoto} resizeMode="cover" />
        : <View style={ws.itemIconBox}>
            <Text style={ws.itemEmoji}>{CATEGORY_ICONS[item.category] || '👕'}</Text>
          </View>
      }
      <View style={ws.itemInfo}>
        <Text style={ws.itemName} numberOfLines={1}>{item.name || item.category}</Text>
        <Text style={ws.itemMeta} numberOfLines={1}>
          {[item.color, item.brand].filter(Boolean).join(' · ')}
        </Text>
        {item.fit ? <Text style={ws.itemFit}>{item.fit}</Text> : null}
      </View>
      <View style={ws.editBadge}>
        <Text style={{ fontSize:10, color:Colors.text3 }}>✏️</Text>
      </View>
    </TouchableOpacity>
  ), [wardrobe]);

  return (
    <View style={ws.screen}>
      <LinearGradient colors={Gradients.header} style={[ws.header, { paddingTop: insets.top + 12 }]}>
        <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'flex-start' }}>
          <View>
            <Text style={ws.headerTitle}>Wardrobe</Text>
            <Text style={ws.headerSub}>{wardrobe.length} items · {profile?.display_name || profile?.label} · tap item to edit</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Search */}
      <View style={ws.searchRow}>
        <View style={ws.searchBox}>
          <Text>🔍</Text>
          <TextInput style={ws.searchInput} value={search} onChangeText={setSearch}
            placeholder="Search by name, color, brand..." placeholderTextColor={Colors.text3} />
          {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Text style={{ color:Colors.text3, fontSize:18 }}>×</Text></TouchableOpacity>}
        </View>
      </View>

      {/* Category filter */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={ws.filterRow}>
        {['All', ...CATEGORIES].map(c => <Pill key={c} label={`${CATEGORY_ICONS[c] || ''} ${c}`.trim()} active={filter===c} onPress={() => setFilter(c)} />)}
      </ScrollView>

      {loading
        ? <ActivityIndicator color={Colors.accent2} style={{ marginTop:60 }} />
        : filtered.length === 0
          ? <View style={ws.empty}>
              <Text style={{ fontSize:52 }}>👚</Text>
              <Text style={ws.emptyText}>{wardrobe.length === 0
                ? 'Your wardrobe is empty.\nUpload outfit photos or add items manually.'
                : 'No items match this filter.'
              }</Text>
            </View>
          : <FlatList
              data={filtered}
              keyExtractor={i => i.id}
              renderItem={renderItem}
              numColumns={2}
              contentContainerStyle={{ padding:12, paddingBottom:120 }}
              columnWrapperStyle={{ gap:12 }}
              ItemSeparatorComponent={() => <View style={{ height:12 }} />}
              showsVerticalScrollIndicator={false}
            />
      }

      {/* FABs — Upload (primary) + Manual add (secondary) */}
      <View style={ws.fabGroup}>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={ws.fabSecondary} activeOpacity={0.85}>
          <Text style={ws.fabSecondaryText}>+ Manual</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowUpload(true)} activeOpacity={0.85}>
          <LinearGradient colors={['#1d4ed8','#7c3aed']} style={ws.fab} start={{x:0,y:0}} end={{x:1,y:1}}>
            <Text style={ws.fabText}>📷</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Upload & Segregate Modal */}
      <Modal visible={showUpload} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowUpload(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <Text style={{ color:Colors.text, fontSize:16, fontWeight:'600' }}>Upload Photos</Text>
            <TouchableOpacity onPress={() => setShowUpload(false)}>
              <Text style={{ color:Colors.accent2, fontSize:15, fontWeight:'600' }}>Done</Text>
            </TouchableOpacity>
          </View>
          <UploadSheet
            profile={profile}
            householdId={householdId}
            onClose={() => setShowUpload(false)}
            onItemsSaved={(items) => {
              items.forEach(i => addWardrobeItem(i));
              showToast(`${items.length} items saved to wardrobe`);
            }}
          />
        </View>
      </Modal>

      {/* Manual Add Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <Text style={{ color:Colors.text, fontSize:16, fontWeight:'600' }}>Add Item</Text>
            <TouchableOpacity onPress={() => setShowAdd(false)}>
              <Text style={{ color:Colors.accent2, fontSize:15, fontWeight:'600' }}>Cancel</Text>
            </TouchableOpacity>
          </View>
          <ItemModal
            profile={profile}
            householdId={householdId}
            onClose={() => setShowAdd(false)}
            onSaved={(item) => { addWardrobeItem(item); showToast('Item added'); }}
          />
        </View>
      </Modal>

      {/* Edit Item Modal */}
      <Modal visible={!!editingItem} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditingItem(null)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <Text style={{ color:Colors.text, fontSize:16, fontWeight:'600' }}>Edit Item</Text>
            <TouchableOpacity onPress={() => setEditingItem(null)}>
              <Text style={{ color:Colors.error, fontSize:15, fontWeight:'600' }}>Delete</Text>
            </TouchableOpacity>
          </View>
          {editingItem && (
            <ItemModal
              profile={profile}
              householdId={householdId}
              existingItem={editingItem}
              onClose={() => setEditingItem(null)}
              onSaved={handleItemSaved}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

const ws = StyleSheet.create({
  screen: { flex:1, backgroundColor:Colors.bg },
  header: { padding:Spacing.lg, paddingBottom:12 },
  headerTitle: { fontSize:22, fontWeight:'700', color:Colors.text },
  headerSub: { fontSize:11, color:Colors.text2, marginTop:2 },
  searchRow: { padding:12, paddingTop:8 },
  searchBox: { flexDirection:'row', alignItems:'center', backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.full, paddingHorizontal:14, paddingVertical:9, gap:8 },
  searchInput: { flex:1, fontSize:14, color:Colors.text },
  filterRow: { paddingHorizontal:12, paddingBottom:8 },
  itemCard: { width:CARD, backgroundColor:Colors.card, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, overflow:'hidden', ...Shadow.card, position:'relative' },
  itemPhoto: { width:'100%', height:CARD * 0.9 },
  itemIconBox: { height:CARD * 0.9, backgroundColor:Colors.bg3, alignItems:'center', justifyContent:'center' },
  itemEmoji: { fontSize:52 },
  itemInfo: { padding:10 },
  itemName: { fontSize:13, fontWeight:'600', color:Colors.text, marginBottom:2 },
  itemMeta: { fontSize:11, color:Colors.text2 },
  itemFit: { fontSize:10, color:Colors.text3, marginTop:2 },
  editBadge: { position:'absolute', top:8, right:8, backgroundColor:'rgba(0,0,0,0.4)', borderRadius:10, padding:4 },
  empty: { flex:1, alignItems:'center', justifyContent:'center', padding:40, gap:12 },
  emptyText: { fontSize:14, color:Colors.text2, textAlign:'center', lineHeight:22 },
  fabGroup: { position:'absolute', bottom:90, right:16, flexDirection:'row', alignItems:'center', gap:10 },
  fabSecondary: { backgroundColor:Colors.bg2, borderWidth:1, borderColor:Colors.border, borderRadius:Radius.full, paddingHorizontal:16, paddingVertical:12 },
  fabSecondaryText: { color:Colors.text2, fontSize:13, fontWeight:'600' },
  fab: { width:56, height:56, borderRadius:28, alignItems:'center', justifyContent:'center', ...Shadow.fab },
  fabText: { fontSize:24 },
  modalHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, borderBottomWidth:1, borderBottomColor:Colors.border },
});
