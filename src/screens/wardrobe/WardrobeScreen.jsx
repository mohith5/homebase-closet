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
import { analyzeClothingPhoto } from '../../lib/claude';
import { lookupBarcode } from '../../lib/barcode';
import { uploadPhoto, imageToBase64 } from '../../lib/storage';
import { Pill } from '../../components/Pill';
import { Colors, Gradients, Spacing, Radius, Shadow } from '../../theme';
import { useAppStore } from '../../store';
import { HEADER_PADDING_TOP } from '../../lib/device';

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
const SIDEBAR_W = 58;
const CARD = (W - SIDEBAR_W - 28) / 2;

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
  const [photoUri, setPhotoUri] = useState(existingItem?.photo_url || null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();

  async function pickProductPhoto() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], quality: 0.8, allowsEditing: true, aspect: [3, 4],
    });
    if (!result.canceled) setPhotoUri(result.assets[0].uri);
  }

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
      // Upload product photo if a new local URI was picked
      let photo_url = form.photo_url || null;
      if (photoUri && photoUri.startsWith('file://')) {
        const ext = photoUri.split('.').pop() || 'jpg';
        const path = `${profile.id}/items/${Date.now()}.${ext}`;
        photo_url = await uploadPhoto(photoUri, path);
        Logger.info('Wardrobe', 'Product photo uploaded', { path: photo_url });
      }

      const payload = { ...form, photo_url };
      if (isEdit) {
        const { error } = await supabase.from('wardrobe_items').update(payload).eq('id', existingItem.id);
        if (error) throw error;
        onSaved({ ...existingItem, ...payload });
      } else {
        const { data, error } = await supabase.from('wardrobe_items')
          .insert({ ...payload, profile_id: profile.id, household_id: householdId })
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

      {/* Product photo — tap to add/change */}
      <TouchableOpacity onPress={pickProductPhoto} style={m.iconDisplay} activeOpacity={0.8}>
        {photoUri
          ? <Image source={{ uri: photoUri }} style={m.productPhoto} resizeMode="cover" />
          : <>
              <Text style={m.iconEmoji}>{CATEGORY_ICONS[form.category] || '👕'}</Text>
              <Text style={m.iconLabel}>{form.category}</Text>
            </>
        }
        <View style={m.photoOverlay}>
          <Text style={{ color:'#fff', fontSize:11, fontWeight:'600' }}>
            {photoUri ? '📷 Change Photo' : '📷 Add Product Photo'}
          </Text>
        </View>
      </TouchableOpacity>

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
  iconDisplay: { alignItems:'center', justifyContent:'center', height:160, backgroundColor:Colors.bg3, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, marginBottom:16, overflow:'hidden', position:'relative' },
  productPhoto: { width:'100%', height:'100%' },
  iconEmoji: { fontSize:48 },
  iconLabel: { fontSize:13, color:Colors.text2, marginTop:6, fontWeight:'600' },
  photoOverlay: { position:'absolute', bottom:0, left:0, right:0, backgroundColor:'rgba(0,0,0,0.55)', padding:6, alignItems:'center' },
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
   UPLOAD & SMART DETECT SHEET
   - Parallel analysis of multiple photos
   - Auto-crops each item from photo (no face/body shown)
   - Deduplicates against existing wardrobe
   - Shows clean cropped product shots in review UI
══════════════════════════════════════════════ */
function UploadSheet({ profile, householdId, onClose, onItemsSaved }) {
  const [processing, setProcessing] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [detectedItems, setDetectedItems] = useState([]);
  const [saving, setSaving] = useState(false);
  const { wardrobe } = useAppStore();

  async function pickAndAnalyze() {
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85, // higher quality for better cropping
      allowsMultipleSelection: true,
      selectionLimit: 10,
    });
    if (picked.canceled) return;

    setProcessing(true);
    setDetectedItems([]);
    setStatusMsg(`Scanning ${picked.assets.length} photo${picked.assets.length > 1 ? 's' : ''}...`);
    Logger.info('Wardrobe', `Processing ${picked.assets.length} photos with full vision pipeline`);

    try {
      // Process ALL photos in parallel — detect items + crop each one
      const allResults = await Promise.all(
        picked.assets.map(async (asset, photoIdx) => {
          try {
            setStatusMsg(`Detecting items in photo ${photoIdx + 1}...`);
            const { processPhotoIntoItems } = await import('../../lib/vision');
            const results = await processPhotoIntoItems(asset.uri, wardrobe);
            Logger.info('Wardrobe', `Photo ${photoIdx + 1}: ${results.length} items detected`);
            return results;
          } catch (e) {
            Logger.error('Wardrobe', `Photo ${photoIdx + 1} failed`, e);
            return [];
          }
        })
      );

      const flat = allResults.flat();
      const newItems = flat.filter(r => !r.isDuplicate);
      const dupes = flat.filter(r => r.isDuplicate);

      Logger.info('Wardrobe', `Total: ${flat.length} items, ${newItems.length} new, ${dupes.length} duplicates`);
      setStatusMsg('');

      // Convert to UI state
      const uiItems = flat.map(r => ({
        ...r.item,
        croppedUri: r.croppedUri,
        fingerprint: r.fingerprint,
        isDuplicate: r.isDuplicate,
        duplicateOf: r.duplicateOf,
        confirmed: !r.isDuplicate, // duplicates start unconfirmed
        _id: Math.random().toString(36).slice(2),
      }));

      setDetectedItems(uiItems);

      if (flat.length === 0) {
        Alert.alert(
          'No Items Detected',
          'Try a clearer photo with good lighting.\n\n• Full-body photos work best\n• Make sure clothes are clearly visible\n• Good lighting helps brand detection'
        );
      } else if (dupes.length > 0) {
        Alert.alert(
          `${dupes.length} Duplicate${dupes.length > 1 ? 's' : ''} Found`,
          `${dupes.length} item${dupes.length > 1 ? 's' : ''} already exist in your wardrobe and were unchecked. Review below.`
        );
      }
    } catch (e) {
      Logger.error('Wardrobe', 'Vision pipeline failed', e);
      Alert.alert('Error', 'Could not analyze photos. Try again.');
    }

    setProcessing(false);
  }

  function updateItem(id, field, value) {
    setDetectedItems(prev => prev.map(i => i._id === id ? { ...i, [field]: value } : i));
  }
  function removeItem(id) { setDetectedItems(prev => prev.filter(i => i._id !== id)); }
  function toggleConfirm(id) { setDetectedItems(prev => prev.map(i => i._id === id ? { ...i, confirmed: !i.confirmed } : i)); }

  async function saveAll() {
    const toSave = detectedItems.filter(i => i.confirmed);
    if (toSave.length === 0) { Alert.alert('Nothing selected', 'Tap ○ to confirm items before saving.'); return; }
    setSaving(true);
    setStatusMsg(`Uploading ${toSave.length} cropped photos...`);
    Logger.info('Wardrobe', `Saving ${toSave.length} items with cropped photos`);

    try {
      const { uploadCroppedPhoto, getSignedPhotoUrl } = await import('../../lib/vision');
      const ALLOWED = new Set(['name','category','color','colors','material','fit','brand','model','occasions','seasons','notes','barcode']);

      const inserts = await Promise.all(toSave.map(async ({ _id, confirmed, croppedUri, fingerprint, isDuplicate, duplicateOf, ...item }) => {
        // Upload the cropped product shot (clean item photo, no body/face)
        let photo_url = null;
        if (croppedUri) {
          photo_url = await uploadCroppedPhoto(croppedUri, profile.id);
        }
        const clean = {};
        for (const [k, v] of Object.entries(item)) { if (ALLOWED.has(k)) clean[k] = v; }
        return { ...clean, photo_url, profile_id: profile.id, household_id: householdId };
      }));

      setStatusMsg('Saving to wardrobe...');
      const { data, error } = await supabase.from('wardrobe_items').insert(inserts).select();
      if (error) throw error;

      // Resolve signed URLs immediately so grid shows photos
      const withUrls = await Promise.all(data.map(async item => {
        if (!item.photo_url) return item;
        const url = await getSignedPhotoUrl(item.photo_url);
        return { ...item, photo_url: url };
      }));

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setStatusMsg('');
      onItemsSaved(withUrls);
      onClose();
    } catch (e) {
      Logger.error('Wardrobe', 'Save failed', e);
      Alert.alert('Error', e.message);
    }
    setSaving(false);
  }

  const confirmed = detectedItems.filter(i => i.confirmed).length;
  const dupeCount = detectedItems.filter(i => i.isDuplicate).length;

  return (
    <ScrollView style={{ flex:1 }} contentContainerStyle={{ padding:Spacing.lg, paddingBottom:80 }}
      showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      <View style={u.handle} />
      <Text style={u.title}>Smart Wardrobe Scan</Text>
      <Text style={u.sub}>
        Upload any photo — outfit selfie, mirror pic, product shot.{'\n'}
        Stylie auto-detects each item, crops a clean product photo, and checks for duplicates.
      </Text>

      <TouchableOpacity onPress={pickAndAnalyze} disabled={processing} style={u.uploadBtn} activeOpacity={0.85}>
        <LinearGradient colors={['#1d4ed8','#7c3aed']} style={u.uploadBtnGrad} start={{x:0,y:0}} end={{x:1,y:0}}>
          {processing
            ? <><ActivityIndicator color="#fff" size="small" /><Text style={u.uploadBtnText}>  {statusMsg || 'Analyzing...'}</Text></>
            : <Text style={u.uploadBtnText}>📷  Select Photos (up to 10)</Text>
          }
        </LinearGradient>
      </TouchableOpacity>

      {detectedItems.length > 0 && (
        <>
          <View style={u.summaryRow}>
            <Text style={u.summaryText}>
              {detectedItems.length} items detected
              {dupeCount > 0 ? ` · ${dupeCount} duplicates` : ''}
            </Text>
            <Text style={u.summaryHint}>Tap item to edit • Long press to remove</Text>
          </View>

          {detectedItems.map(item => (
            <DetectedItemCard
              key={item._id}
              item={item}
              onToggleConfirm={() => toggleConfirm(item._id)}
              onRemove={() => removeItem(item._id)}
              onChange={(field, val) => updateItem(item._id, field, val)}
            />
          ))}

          <TouchableOpacity onPress={saveAll} disabled={saving || confirmed === 0} activeOpacity={0.85}>
            <LinearGradient
              colors={confirmed > 0 ? ['#1d4ed8','#7c3aed'] : ['#334155','#334155']}
              style={[u.saveAllBtn, saving && { opacity:0.6 }]}
              start={{x:0,y:0}} end={{x:1,y:0}}
            >
              {saving
                ? <><ActivityIndicator color="#fff" size="small" /><Text style={u.saveAllText}>  {statusMsg}</Text></>
                : <Text style={u.saveAllText}>Save {confirmed} Item{confirmed !== 1 ? 's' : ''} to Wardrobe</Text>
              }
            </LinearGradient>
          </TouchableOpacity>
        </>
      )}
    </ScrollView>
  );
}

/* Detected item card — shows CROPPED product shot, not the original photo */
function DetectedItemCard({ item, onToggleConfirm, onRemove, onChange }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <View style={[u.itemCard, !item.confirmed && { opacity: 0.5 }]}>
      <View style={u.itemCardHeader}>
        {/* Cropped product shot — or emoji if no crop available */}
        <TouchableOpacity onPress={onToggleConfirm} style={u.itemPhotoBox} activeOpacity={0.8}>
          {item.croppedUri
            ? <Image source={{ uri: item.croppedUri }} style={u.itemCroppedPhoto} resizeMode="cover" />
            : <View style={u.itemIconFallback}>
                <Text style={{ fontSize: 26 }}>{CATEGORY_ICONS[item.category] || '👕'}</Text>
              </View>
          }
          {/* Confirm overlay */}
          <View style={[u.checkOverlay, item.confirmed && u.checkOverlayActive]}>
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{item.confirmed ? '✓' : ''}</Text>
          </View>
        </TouchableOpacity>

        <View style={{ flex: 1, marginLeft: 12 }}>
          {item.isDuplicate && (
            <View style={u.dupeBadge}><Text style={u.dupeBadgeText}>Already in wardrobe</Text></View>
          )}
          <Text style={u.itemName} numberOfLines={2}>{item.name || item.category}</Text>
          <Text style={u.itemMeta}>{[item.color, item.brand, item.fit].filter(Boolean).join(' · ')}</Text>
          <Text style={u.itemCategory}>{item.category}</Text>
        </View>

        <TouchableOpacity onPress={onRemove} style={u.removeBtn}>
          <Text style={{ fontSize: 18, color: Colors.text3 }}>✕</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity onPress={() => setExpanded(e => !e)} style={u.editToggle}>
        <Text style={u.editToggleText}>{expanded ? '▲ Done' : '✏️ Edit'}</Text>
      </TouchableOpacity>

      {expanded && (
        <View style={u.editSection}>
          <Text style={u.editLabel}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={{ flexDirection:'row', gap:6, paddingVertical:4 }}>
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
            placeholder="Brand" placeholderTextColor={Colors.text3} />
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
  summaryRow: { marginBottom:12, gap:2 },
  summaryText: { fontSize:15, fontWeight:'700', color:Colors.text },
  summaryHint: { fontSize:11, color:Colors.text3 },
  itemCard: { backgroundColor:Colors.card, borderRadius:Radius.lg, borderWidth:1, borderColor:Colors.border, padding:14, marginBottom:12 },
  itemCardHeader: { flexDirection:'row', alignItems:'flex-start', marginBottom:6 },
  // Cropped product shot — square thumb
  itemPhotoBox: { width:72, height:72, borderRadius:Radius.md, overflow:'hidden', position:'relative' },
  itemCroppedPhoto: { width:'100%', height:'100%' },
  itemIconFallback: { width:'100%', height:'100%', backgroundColor:Colors.bg3, alignItems:'center', justifyContent:'center' },
  checkOverlay: { position:'absolute', bottom:0, right:0, width:22, height:22, borderRadius:11, backgroundColor:'rgba(0,0,0,0.4)', alignItems:'center', justifyContent:'center' },
  checkOverlayActive: { backgroundColor:Colors.success },
  dupeBadge: { backgroundColor:'rgba(251,191,36,0.15)', borderRadius:4, paddingHorizontal:6, paddingVertical:2, alignSelf:'flex-start', marginBottom:4 },
  dupeBadgeText: { fontSize:10, color:Colors.warning, fontWeight:'700' },
  itemName: { fontSize:13, fontWeight:'600', color:Colors.text, lineHeight:18 },
  itemMeta: { fontSize:11, color:Colors.text2, marginTop:2 },
  itemCategory: { fontSize:10, color:Colors.text3, marginTop:2, textTransform:'uppercase', letterSpacing:0.4 },
  removeBtn: { padding:4, marginLeft:4 },
  editToggle: { paddingTop:4 },
  editToggleText: { fontSize:12, color:Colors.accent2, fontWeight:'600' },
  editSection: { marginTop:10, gap:8 },
  editLabel: { fontSize:11, fontWeight:'600', color:Colors.text3, textTransform:'uppercase', letterSpacing:0.4 },
  editInput: { backgroundColor:Colors.inpBg, borderWidth:1, borderColor:Colors.inpBorder, borderRadius:Radius.sm, padding:10, fontSize:14, color:Colors.text },
  saveAllBtn: { padding:15, borderRadius:Radius.md, alignItems:'center', flexDirection:'row', justifyContent:'center', marginTop:8 },
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
    if (error) { Logger.error('Wardrobe', 'Load failed', error); }
    else {
      // Generate signed URLs for all items that have a storage path
      const withUrls = await Promise.all((data || []).map(async item => {
        if (!item.photo_url) return item;
        // Already a full URL (http) — use as-is
        if (item.photo_url.startsWith('http')) return item;
        // Storage path — get signed URL
        const { data: signed } = await supabase.storage
          .from('closet')
          .createSignedUrl(item.photo_url, 3600);
        return { ...item, photo_url: signed?.signedUrl || null };
      }));
      setWardrobe(withUrls);
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

  async function handleItemSaved(updated) {
    // Resolve signed URL for the saved item's photo
    let itemWithUrl = updated;
    if (updated.photo_url && !updated.photo_url.startsWith('http')) {
      const { data: signed } = await supabase.storage
        .from('closet').createSignedUrl(updated.photo_url, 3600);
      itemWithUrl = { ...updated, photo_url: signed?.signedUrl || null };
    }
    if (editingItem) {
      setWardrobe(wardrobe.map(i => i.id === itemWithUrl.id ? itemWithUrl : i));
    } else {
      addWardrobeItem(itemWithUrl);
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
      <LinearGradient colors={Gradients.header} style={[ws.header, { paddingTop: insets.top + 10 }]}>
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
            placeholder="Search..." placeholderTextColor={Colors.text3} />
          {search.length > 0 && <TouchableOpacity onPress={() => setSearch('')}><Text style={{ color:Colors.text3, fontSize:18 }}>×</Text></TouchableOpacity>}
        </View>
      </View>

      {/* Main layout: left sidebar tabs + right grid */}
      <View style={ws.body}>
        {/* Left sidebar — category tabs */}
        <ScrollView style={ws.sidebar} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
          {['All', ...CATEGORIES].map(c => {
            const active = filter === c;
            const count = c === 'All' ? wardrobe.length : wardrobe.filter(i => i.category === c).length;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => setFilter(c)}
                style={[ws.sideTab, active && ws.sideTabActive]}
                activeOpacity={0.7}
              >
                <Text style={ws.sideTabIcon}>{c === 'All' ? '✦' : (CATEGORY_ICONS[c] || '•')}</Text>
                <Text style={[ws.sideTabLabel, active && ws.sideTabLabelActive]} numberOfLines={1}>{c}</Text>
                {active && count > 0 && <Text style={[ws.sideTabCount, ws.sideTabCountActive]}>{count}</Text>}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Right content */}
        <View style={ws.gridArea}>
          {loading
            ? <ActivityIndicator color={Colors.accent2} style={{ marginTop:60 }} />
            : filtered.length === 0
              ? <View style={ws.empty}>
                  <Text style={{ fontSize:44 }}>👚</Text>
                  <Text style={ws.emptyText}>{wardrobe.length === 0
                    ? 'Your wardrobe is empty.\nUpload photos or add manually.'
                    : 'No items match.'
                  }</Text>
                </View>
              : <FlatList
                  data={filtered}
                  keyExtractor={i => i.id}
                  renderItem={renderItem}
                  numColumns={2}
                  contentContainerStyle={{ padding:8, paddingBottom:120 }}
                  columnWrapperStyle={{ gap:8 }}
                  ItemSeparatorComponent={() => <View style={{ height:8 }} />}
                  showsVerticalScrollIndicator={false}
                />
          }
        </View>
      </View>

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
          <View style={[ws.modalHeader, { justifyContent:'space-between' }]}>
            <TouchableOpacity onPress={() => setEditingItem(null)}>
              <Text style={{ color:Colors.text2, fontSize:15 }}>Cancel</Text>
            </TouchableOpacity>
            <Text style={{ color:Colors.text, fontSize:16, fontWeight:'600' }}>Edit Item</Text>
            <TouchableOpacity onPress={() => {
              const item = editingItem;
              if (!item) return;
              Alert.alert('Delete Item', `Permanently delete "${item.name || item.category}"?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                  await supabase.from('wardrobe_items').delete().eq('id', item.id);
                  removeWardrobeItem(item.id);
                  setEditingItem(null);
                  showToast('Item deleted');
                }}
              ]);
            }}>
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
  body: { flex:1, flexDirection:'row' },
  sidebar: { width:SIDEBAR_W, backgroundColor:Colors.bg2, borderRightWidth:1, borderRightColor:Colors.border },
  sideTab: { alignItems:'center', paddingVertical:9, paddingHorizontal:2, borderRightWidth:2, borderRightColor:'transparent' },
  sideTabActive: { backgroundColor:Colors.bg3, borderRightColor:Colors.accent2 },
  sideTabIcon: { fontSize:16, marginBottom:2 },
  sideTabLabel: { fontSize:9, color:Colors.text3, fontWeight:'500', textAlign:'center' },
  sideTabLabelActive: { color:Colors.accent2, fontWeight:'700' },
  sideTabCount: { fontSize:9, color:Colors.text3, marginTop:1 },
  sideTabCountActive: { color:Colors.accent2 },
  gridArea: { flex:1 },
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
