import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  FlatList, Image, Alert, ActivityIndicator, Modal,
  ScrollView, Dimensions, Animated, PanResponder,
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
// Category short codes shown in sidebar dots and empty card placeholder
const CAT_SHORT = {
  Tops:'TOP', Bottoms:'BTM', Dresses:'DRS', Outerwear:'OTR', Shoes:'SHO',
  Jewelry:'JWL', Watches:'WCH', Bags:'BAG', Hats:'HAT', Belts:'BLT',
  Sunglasses:'SNG', Activewear:'ACT', Swimwear:'SWM', Loungewear:'LNG',
};

const W = Dimensions.get('window').width;
const SIDEBAR_COLLAPSED = 52;
const SIDEBAR_EXPANDED  = 148;
const CARD_IMG_H = 180; // explicit px height — works with absolute grid

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
      mediaTypes: ['images'], quality: 0.85, allowsEditing: true, aspect: [3, 4],
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
      if (!granted) { Alert.alert('Camera Access Required', 'Allow camera access in Settings to scan barcodes.'); return; }
    }
    setScanning(true);
  }

  async function onBarcodeScanned({ data }) {
    setScanning(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const info = await lookupBarcode(data);
    if (info) { setForm(f => ({ ...f, ...info })); }
    else Alert.alert('Not Found', 'No product found for this barcode. Fill in details manually.');
  }

  async function save() {
    if (!form.name && !form.category) { Alert.alert('Missing Info', 'Please enter a name or select a category.'); return; }
    setSaving(true);
    try {
      let photo_url = form.photo_url || null;
      if (photoUri && photoUri.startsWith('file://')) {
        const ext = photoUri.split('.').pop() || 'jpg';
        const path = `${profile.id}/items/${Date.now()}.${ext}`;
        photo_url = await uploadPhoto(photoUri, path);
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

  // Barcode scanner fullscreen
  if (scanning) return (
    <View style={StyleSheet.absoluteFill}>
      <CameraView
        style={StyleSheet.absoluteFill}
        onBarcodeScanned={onBarcodeScanned}
        barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','upc_e','qr'] }}
      />
      {/* Dark vignette */}
      <View style={m.scanVignette} />
      <View style={m.scanUI}>
        <Text style={m.scanTitle}>Scan Barcode</Text>
        <Text style={m.scanSub}>Point at any product tag or label</Text>
        <View style={m.scanFrame}>
          {/* Corner marks */}
          <View style={[m.corner, m.cornerTL]} />
          <View style={[m.corner, m.cornerTR]} />
          <View style={[m.corner, m.cornerBL]} />
          <View style={[m.corner, m.cornerBR]} />
        </View>
        <TouchableOpacity onPress={() => setScanning(false)} style={m.scanCancelBtn}>
          <Text style={m.scanCancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={{ flex:1, backgroundColor: Colors.bg }}
      contentContainerStyle={m.formContainer}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {/* Photo picker */}
      <TouchableOpacity onPress={pickProductPhoto} style={m.photoWell} activeOpacity={0.8}>
        {photoUri
          ? <Image source={{ uri: photoUri }} style={m.productPhoto} resizeMode="cover" />
          : <View style={m.photoPlaceholder}>
              <Text style={m.photoPlaceholderIcon}>⊕</Text>
              <Text style={m.photoPlaceholderText}>Add Photo</Text>
            </View>
        }
        <View style={m.photoOverlay}>
          <Text style={m.photoOverlayText}>{photoUri ? 'Change Photo' : 'Tap to add'}</Text>
        </View>
      </TouchableOpacity>

      {/* Barcode scanner button — always visible, new + edit */}
      <TouchableOpacity onPress={startBarcode} style={m.barcodeBtn} activeOpacity={0.75}>
        <View style={m.barcodeBtnIcon}>
          <Text style={{ fontSize: 14, color: Colors.accent2 }}>▤</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={m.barcodeBtnTitle}>Scan Barcode</Text>
          <Text style={m.barcodeBtnSub}>Auto-fill brand, name & details</Text>
        </View>
        <Text style={{ fontSize: 12, color: Colors.text3 }}>›</Text>
      </TouchableOpacity>

      {/* Category */}
      <Text style={m.label}>Category</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.pillRow}>
        {CATEGORIES.map(c => <Pill key={c} label={c} active={form.category===c} onPress={() => set('category', c)} />)}
      </ScrollView>

      {/* Name */}
      <Text style={m.label}>Item Name</Text>
      <TextInput style={m.input} value={form.name} onChangeText={v => set('name', v)}
        placeholder="e.g. White Oxford Shirt" placeholderTextColor={Colors.text3}
        returnKeyType="next" />

      {/* Brand + Material */}
      <View style={{ flexDirection:'row', gap: 10 }}>
        <View style={{ flex:1 }}>
          <Text style={m.label}>Brand</Text>
          <TextInput style={m.input} value={form.brand} onChangeText={v => set('brand', v)}
            placeholder="Nike, Zara..." placeholderTextColor={Colors.text3} />
        </View>
        <View style={{ flex:1 }}>
          <Text style={m.label}>Material</Text>
          <TextInput style={m.input} value={form.material} onChangeText={v => set('material', v)}
            placeholder="Cotton, Wool..." placeholderTextColor={Colors.text3} />
        </View>
      </View>

      {/* Color */}
      <Text style={m.label}>Color</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={m.pillRow}>
        {COLORS.map(c => <Pill key={c} label={c} active={form.color===c} onPress={() => set('color', c)} />)}
      </ScrollView>

      {/* Fit */}
      <Text style={m.label}>Fit</Text>
      <View style={m.pillWrap}>
        {FITS.map(f => <Pill key={f} label={f} active={form.fit===f} onPress={() => set('fit', f)} />)}
      </View>

      {/* Occasions */}
      <Text style={m.label}>Best For</Text>
      <View style={m.pillWrap}>
        {OCCASIONS.map(o => <Pill key={o} label={o} active={(form.occasions||[]).includes(o)} onPress={() => toggle('occasions', o)} />)}
      </View>

      {/* Seasons */}
      <Text style={m.label}>Season</Text>
      <View style={m.pillWrap}>
        {SEASONS.map(s => <Pill key={s} label={s} active={(form.seasons||[]).includes(s)} onPress={() => toggle('seasons', s)} />)}
      </View>

      {/* Notes */}
      <Text style={m.label}>Notes</Text>
      <TextInput
        style={[m.input, m.notesInput]}
        value={form.notes}
        onChangeText={v => set('notes', v)}
        placeholder="Care instructions, where you bought it..."
        placeholderTextColor={Colors.text3}
        multiline
      />

      {/* Save */}
      <TouchableOpacity onPress={save} disabled={saving} activeOpacity={0.85} style={m.saveBtnWrap}>
        <LinearGradient colors={['#1d4ed8','#6d28d9']} style={[m.saveBtn, saving && { opacity: 0.6 }]}
          start={{x:0,y:0}} end={{x:1,y:0}}>
          {saving
            ? <ActivityIndicator color="#fff" size="small" />
            : <Text style={m.saveBtnText}>{isEdit ? 'Save Changes' : 'Add to Wardrobe'}</Text>
          }
        </LinearGradient>
      </TouchableOpacity>
    </ScrollView>
  );
}

const m = StyleSheet.create({
  formContainer: { padding: Spacing.lg, paddingBottom: 60, gap: 0 },

  // Photo
  photoWell: { height: 200, borderRadius: Radius.lg, overflow: 'hidden', backgroundColor: '#0d1220', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', marginBottom: 14, position: 'relative' },
  productPhoto: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  photoPlaceholderIcon: { fontSize: 32, color: Colors.text3 },
  photoPlaceholderText: { fontSize: 13, color: Colors.text3, fontWeight: '500' },
  photoOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(0,0,0,0.6)', paddingVertical: 8, alignItems: 'center' },
  photoOverlayText: { fontSize: 12, color: 'rgba(255,255,255,0.7)', fontWeight: '600', letterSpacing: 0.5 },

  // Barcode
  barcodeBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(29,78,216,0.08)', borderWidth: 1, borderColor: 'rgba(29,78,216,0.2)', borderRadius: Radius.md, padding: 14, marginBottom: 20 },
  barcodeBtnIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(29,78,216,0.2)', alignItems: 'center', justifyContent: 'center' },
  barcodeBtnTitle: { fontSize: 13, fontWeight: '700', color: Colors.text, marginBottom: 1 },
  barcodeBtnSub: { fontSize: 11, color: Colors.text3 },

  // Form fields
  label: { fontSize: 10, fontWeight: '700', color: Colors.text3, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8, marginTop: 18 },
  pillRow: { paddingVertical: 2, gap: 0 },
  pillWrap: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -3 },
  input: { backgroundColor: 'rgba(255,255,255,0.04)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: Radius.md, padding: 13, fontSize: 14, color: Colors.text },
  notesInput: { height: 72, textAlignVertical: 'top' },

  // Save button
  saveBtnWrap: { marginTop: 28 },
  saveBtn: { padding: 16, borderRadius: Radius.md, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  // Barcode scanner UI
  scanVignette: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  scanUI: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  scanTitle: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 6 },
  scanSub: { fontSize: 13, color: 'rgba(255,255,255,0.6)', marginBottom: 40 },
  scanFrame: { width: 260, height: 160, position: 'relative' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: Colors.accent2, borderWidth: 2 },
  cornerTL: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 4 },
  scanCancelBtn: { marginTop: 48, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: Radius.full, paddingHorizontal: 28, paddingVertical: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)' },
  scanCancelText: { color: '#fff', fontSize: 14, fontWeight: '600' },
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
  const [showUpload, setShowUpload] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [activeSection, setActiveSection] = useState('wardrobe');
  const [showVacation, setShowVacation] = useState(false);
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const sidebarAnim = useRef(new Animated.Value(SIDEBAR_COLLAPSED)).current;
  const currentW = useRef(SIDEBAR_COLLAPSED);

  // keep currentW in sync so PanResponder can read it without stale closure
  sidebarAnim.addListener(({ value }) => { currentW.current = value; });

  function toggleSidebar() {
    const toVal = currentW.current > (SIDEBAR_COLLAPSED + SIDEBAR_EXPANDED) / 2
      ? SIDEBAR_COLLAPSED : SIDEBAR_EXPANDED;
    setSidebarExpanded(toVal === SIDEBAR_EXPANDED);
    Animated.spring(sidebarAnim, { toValue: toVal, useNativeDriver: false, tension: 140, friction: 16 }).start();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }

  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 4,
    onPanResponderGrant: () => {},
    onPanResponderMove: (_, gs) => {
      const newW = Math.min(SIDEBAR_EXPANDED + 20, Math.max(SIDEBAR_COLLAPSED - 10, currentW.current + gs.dx));
      sidebarAnim.setValue(newW);
    },
    onPanResponderRelease: () => {
      const snapTo = currentW.current > (SIDEBAR_COLLAPSED + SIDEBAR_EXPANDED) / 2
        ? SIDEBAR_EXPANDED : SIDEBAR_COLLAPSED;
      setSidebarExpanded(snapTo === SIDEBAR_EXPANDED);
      Animated.spring(sidebarAnim, { toValue: snapTo, useNativeDriver: false, tension: 140, friction: 16 }).start();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
  })).current;

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
      // Generate signed URLs — 7 day TTL so they don't expire mid-session
      const withUrls = await Promise.all((data || []).map(async item => {
        if (!item.photo_url) return item;
        if (item.photo_url.startsWith('http')) return item;
        const { data: signed } = await supabase.storage
          .from('closet')
          .createSignedUrl(item.photo_url, 60 * 60 * 24 * 7); // 7 days
        return { ...item, _storagePath: item.photo_url, photo_url: signed?.signedUrl || null };
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
        .from('closet').createSignedUrl(updated.photo_url, 60 * 60 * 24 * 7);
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
      activeOpacity={0.78}
      onPress={() => setEditingItem(item)}
      onLongPress={() => deleteItem(item.id)}
    >
      {item.photo_url
        ? <Image
            source={{ uri: item.photo_url }}
            style={ws.itemPhoto}
            resizeMode="cover"
            onError={() => {
              // URL expired — re-sign on the fly
              if (item._storagePath) {
                supabase.storage.from('closet')
                  .createSignedUrl(item._storagePath, 60 * 60 * 24 * 7)
                  .then(({ data }) => {
                    if (data?.signedUrl) {
                      setWardrobe(prev => prev.map(w =>
                        w.id === item.id ? { ...w, photo_url: data.signedUrl } : w
                      ));
                    }
                  });
              }
            }}
          />
        : <View style={ws.itemIconBox}>
            <Text style={ws.itemIconText}>{CAT_SHORT[item.category] || '—'}</Text>
            <Text style={ws.itemCategoryLabel}>{item.category}</Text>
          </View>
      }
      <View style={ws.itemInfo}>
        <Text style={ws.itemName} numberOfLines={1}>{item.name || item.category}</Text>
        {(item.brand || item.color) ? (
          <Text style={ws.itemMeta} numberOfLines={1}>
            {[item.brand, item.color].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  ), [wardrobe]);

  // import VacationPlanner from outfits screen — lazy via modal
  const [showVacation, setShowVacation] = useState(false);

  return (
    <View style={ws.screen}>
      {/* ── Header ── */}
      <View style={[ws.header, { paddingTop: insets.top + 10 }]}>
        <View style={ws.headerRow}>
          <View>
            <Text style={ws.headerSub}>{profile?.display_name || 'My'} Closet</Text>
            <Text style={ws.headerTitle}>Wardrobe</Text>
          </View>
          <View style={ws.headerCount}>
            <Text style={ws.headerCountNum}>{wardrobe.length}</Text>
            <Text style={ws.headerCountLabel}>pieces</Text>
          </View>
        </View>
        <View style={ws.searchBox}>
          <Text style={ws.searchIcon}>⌕</Text>
          <TextInput
            style={ws.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search brand, color, name..."
            placeholderTextColor={Colors.text3}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Text style={{ color:Colors.text3, fontSize:18 }}>×</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* ── Main: sidebar + content ── */}
      <View style={ws.body}>

        {/* Sidebar */}
        <Animated.View style={[ws.sidebar, { width: sidebarAnim }]}>
          <TouchableOpacity onPress={toggleSidebar} style={ws.sideToggle} activeOpacity={0.6}>
            <Text style={ws.sideToggleIcon}>{sidebarExpanded ? '‹' : '›'}</Text>
          </TouchableOpacity>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 160 }}>
            {/* Vacation tab */}
            <TouchableOpacity
              onPress={() => { setShowVacation(true); Haptics.selectionAsync(); }}
              style={ws.sideTab}
              activeOpacity={0.65}
            >
              <View style={[ws.sideTabDot, ws.sideTabDotVacation]}>
                <Text style={[ws.sideTabDotText, { color: Colors.warning }]}>✈</Text>
              </View>
              {sidebarExpanded && (
                <Text style={[ws.sideTabLabel, { color: Colors.warning, fontWeight: '700' }]} numberOfLines={1}>Vacation</Text>
              )}
            </TouchableOpacity>

            <View style={ws.sideDivider} />

            {/* Category filters */}
            {['All', ...CATEGORIES].map(c => {
              const active = activeSection === 'wardrobe' && filter === c;
              const count = c === 'All' ? wardrobe.length : wardrobe.filter(i => i.category === c).length;
              if (!sidebarExpanded && count === 0 && c !== 'All') return null;
              return (
                <TouchableOpacity
                  key={c}
                  onPress={() => { setActiveSection('wardrobe'); setFilter(c); Haptics.selectionAsync(); }}
                  style={[ws.sideTab, active && ws.sideTabActive]}
                  activeOpacity={0.65}
                >
                  <View style={[ws.sideTabDot, active && ws.sideTabDotActive]}>
                    <Text style={[ws.sideTabDotText, active && ws.sideTabDotTextActive]}>
                      {c === 'All' ? '◆' : (CAT_SHORT[c]?.[0] || c[0])}
                    </Text>
                  </View>
                  {sidebarExpanded && (
                    <>
                      <Text style={[ws.sideTabLabel, active && ws.sideTabLabelActive]} numberOfLines={1}>{c}</Text>
                      {count > 0 && <Text style={[ws.sideTabCount, active && ws.sideTabCountActive]}>{count}</Text>}
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Animated.View>

        {/* Drag handle — grab to freely resize */}
        <Animated.View
          style={[ws.dragHandle, { left: Animated.subtract(sidebarAnim, 8) }]}
          {...panResponder.panHandlers}
        >
          <View style={ws.dragPill} />
        </Animated.View>

        {/* Content area */}
        <Animated.View style={[ws.gridArea, { left: sidebarAnim }]}>
          {loading
            ? <ActivityIndicator color={Colors.accent2} style={{ marginTop: 80 }} size="large" />
            : filtered.length === 0
              ? <View style={ws.empty}>
                  <Text style={ws.emptyTitle}>{wardrobe.length === 0 ? 'Your closet is empty' : 'Nothing here'}</Text>
                  <Text style={ws.emptyText}>
                    {wardrobe.length === 0
                      ? 'Upload outfit photos or tap + Add to get started.'
                      : 'No items match this filter.'}
                  </Text>
                  {wardrobe.length === 0 && (
                    <TouchableOpacity onPress={() => setShowUpload(true)} style={ws.emptyBtn}>
                      <Text style={ws.emptyBtnText}>Upload Photos</Text>
                    </TouchableOpacity>
                  )}
                </View>
              : <FlatList
                  data={filtered}
                  keyExtractor={i => i.id}
                  renderItem={renderItem}
                  numColumns={2}
                  key="grid2"
                  contentContainerStyle={{ padding: 10, paddingBottom: 150 }}
                  columnWrapperStyle={{ gap: 10 }}
                  ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
                  showsVerticalScrollIndicator={false}
                />
          }
        </Animated.View>
      </View>

      {/* FABs — sit exactly above tab bar using insets */}
      <View style={[ws.fabGroup, { bottom: insets.bottom + 80 }]}>
        <TouchableOpacity onPress={() => setShowAdd(true)} style={ws.fabSecondary} activeOpacity={0.8}>
          <Text style={ws.fabSecondaryText}>+ Add</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShowUpload(true)} activeOpacity={0.85}>
          <LinearGradient colors={Gradients.accent} style={ws.fab} start={{x:0,y:0}} end={{x:1,y:1}}>
            <Text style={ws.fabIcon}>⊕</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Vacation Planner Modal */}
      <Modal visible={showVacation} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowVacation(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <TouchableOpacity onPress={() => setShowVacation(false)} style={ws.modalClose}>
              <Text style={ws.modalCloseText}>Close</Text>
            </TouchableOpacity>
            <Text style={ws.modalTitle}>✈ Vacation Stylist</Text>
            <View style={{ width: 60 }} />
          </View>
          {/* Lazy import VacationPlanner from outfits */}
          <VacationPlannerInline profile={profile} wardrobe={wardrobe} />
        </View>
      </Modal>

      {/* Upload Modal */}
      <Modal visible={showUpload} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowUpload(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <TouchableOpacity onPress={() => setShowUpload(false)} style={ws.modalClose}>
              <Text style={ws.modalCloseText}>Done</Text>
            </TouchableOpacity>
            <Text style={ws.modalTitle}>Smart Scan</Text>
            <View style={{ width: 60 }} />
          </View>
          <UploadSheet profile={profile} householdId={householdId} onClose={() => setShowUpload(false)}
            onItemsSaved={(items) => { items.forEach(i => addWardrobeItem(i)); showToast(`${items.length} items saved`); }} />
        </View>
      </Modal>

      {/* Add Item Modal */}
      <Modal visible={showAdd} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <TouchableOpacity onPress={() => setShowAdd(false)} style={ws.modalClose}>
              <Text style={ws.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={ws.modalTitle}>Add Item</Text>
            <View style={{ width: 60 }} />
          </View>
          <ItemModal profile={profile} householdId={householdId} onClose={() => setShowAdd(false)}
            onSaved={(item) => { addWardrobeItem(item); showToast('Item added'); }} />
        </View>
      </Modal>

      {/* Edit Modal */}
      <Modal visible={!!editingItem} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setEditingItem(null)}>
        <View style={{ flex:1, backgroundColor:Colors.bg }}>
          <View style={ws.modalHeader}>
            <TouchableOpacity onPress={() => setEditingItem(null)} style={ws.modalClose}>
              <Text style={ws.modalCloseText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={ws.modalTitle}>Edit Item</Text>
            <TouchableOpacity style={ws.modalClose} onPress={() => {
              const item = editingItem;
              Alert.alert('Remove Item', `Delete "${item.name || item.category}"?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                  await supabase.from('wardrobe_items').delete().eq('id', item.id);
                  removeWardrobeItem(item.id);
                  setEditingItem(null);
                  showToast('Removed');
                }},
              ]);
            }}>
              <Text style={[ws.modalCloseText, { color: Colors.error }]}>Delete</Text>
            </TouchableOpacity>
          </View>
          {editingItem && <ItemModal profile={profile} householdId={householdId}
            existingItem={editingItem} onClose={() => setEditingItem(null)} onSaved={handleItemSaved} />}
        </View>
      </Modal>
    </View>
  );
}

// Lazy-loaded wrapper — avoids circular import at module init time
function VacationPlannerInline({ profile, wardrobe }) {
  const [Planner, setPlanner] = useState(null);
  useEffect(() => {
    import('../outfits/OutfitsScreen')
      .then(m => { if (m.VacationPlannerExport) setPlanner(() => m.VacationPlannerExport); })
      .catch(() => {});
  }, []);
  if (!Planner) return (
    <View style={{ flex:1, alignItems:'center', justifyContent:'center', padding: 40 }}>
      <ActivityIndicator color={Colors.accent2} />
    </View>
  );
  return <Planner profile={profile} wardrobe={wardrobe} />;
}

const ws = StyleSheet.create({
  screen: { flex:1, backgroundColor: Colors.bg },

  // Header
  header: { paddingHorizontal: Spacing.lg, paddingBottom: 12, backgroundColor: Colors.bg },
  headerRow: { flexDirection:'row', justifyContent:'space-between', alignItems:'flex-end', marginBottom: 14 },
  headerSub: { fontSize: 12, fontWeight: '600', color: Colors.text3, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 3 },
  headerTitle: { fontSize: 32, fontWeight: '800', color: Colors.text, letterSpacing: -1 },
  headerCount: { alignItems: 'center', backgroundColor: Colors.accentBg, borderWidth: 1, borderColor: 'rgba(59,110,248,0.25)', borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 8 },
  headerCountNum: { fontSize: 22, fontWeight: '800', color: Colors.accent2, lineHeight: 26 },
  headerCountLabel: { fontSize: 10, color: Colors.text3, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.8 },
  searchRow: {},
  searchBox: { flexDirection:'row', alignItems:'center', backgroundColor: Colors.bg3, borderWidth:1, borderColor: Colors.border, borderRadius: Radius.lg, paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  searchIcon: { fontSize: 17, color: Colors.text3 },
  searchInput: { flex:1, fontSize: 15, color: Colors.text },

  // Search — inside header
  searchBox: { flexDirection:'row', alignItems:'center', backgroundColor:'rgba(255,255,255,0.05)', borderWidth:1, borderColor:'rgba(255,255,255,0.08)', borderRadius: Radius.md, paddingHorizontal:14, paddingVertical:10, gap:8, marginTop: Spacing.md },
  // Body + sidebar
  body: { flex:1, position:'relative' },
  sidebar: { position:'absolute', top:0, bottom:0, left:0, backgroundColor: Colors.bg2, borderRightWidth:1, borderRightColor: Colors.border, zIndex:10, overflow:'hidden' },
  sideToggle: { alignItems:'center', justifyContent:'center', paddingVertical: 11, borderBottomWidth:1, borderBottomColor: Colors.border },
  sideToggleIcon: { fontSize: 15, color: Colors.text3 },

  sideTab: { flexDirection:'row', alignItems:'center', paddingVertical: 10, paddingHorizontal: 10, borderLeftWidth: 2, borderLeftColor:'transparent', gap: 8 },
  sideTabActive: { backgroundColor: Colors.accentBg, borderLeftColor: Colors.accent },
  sideTabVacation: { borderLeftColor: 'transparent' },
  sideDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 6, marginHorizontal: 8 },

  sideTabDot: { width: 26, height: 26, borderRadius: 7, backgroundColor: Colors.bg3, borderWidth:1, borderColor: Colors.border, alignItems:'center', justifyContent:'center', flexShrink: 0 },
  sideTabDotActive: { backgroundColor: Colors.accentBg, borderColor: Colors.accent2 },
  sideTabDotVacation: { backgroundColor: 'rgba(245,166,35,0.12)', borderColor: 'rgba(245,166,35,0.3)' },
  sideTabDotText: { fontSize: 10, fontWeight: '700', color: Colors.text3 },
  sideTabDotTextActive: { color: Colors.accent2 },
  sideTabLabel: { fontSize: 13, color: Colors.text2, fontWeight: '500', flex: 1 },
  sideTabLabelActive: { color: Colors.accent2, fontWeight: '700' },
  sideTabCount: { fontSize: 10, color: Colors.text3, fontWeight: '600' },
  sideTabCountActive: { color: Colors.accent2 },

  dragHandle: { position:'absolute', top:0, bottom:0, width:16, zIndex:20, justifyContent:'center', alignItems:'center' },
  dragPill: { width:4, height:44, backgroundColor: Colors.border, borderRadius:2 },

  // Grid
  gridArea: { position:'absolute', top:0, right:0, bottom:0 },
  itemCard: { flex:1, backgroundColor: Colors.card, borderRadius: Radius.lg, borderWidth:1, borderColor: Colors.cardBorder, overflow:'hidden', ...Shadow.card },
  itemPhoto: { width:'100%', height: CARD_IMG_H },
  itemIconBox: { width:'100%', height: CARD_IMG_H, backgroundColor: Colors.bg3, alignItems:'center', justifyContent:'center', gap: 6 },
  itemIconText: { fontSize: 16, fontWeight: '700', color: Colors.text3, letterSpacing: 1.5 },
  itemCategoryLabel: { fontSize: 10, color: Colors.text3, fontWeight: '600', letterSpacing: 1, textTransform:'uppercase' },
  itemInfo: { padding: 10 },
  itemName: { fontSize: 13, fontWeight: '600', color: Colors.text, marginBottom: 2, lineHeight: 18 },
  itemMeta: { fontSize: 11, color: Colors.text2 },

  // Empty
  empty: { flex:1, alignItems:'center', justifyContent:'center', padding: 40, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emptyText: { fontSize: 14, color: Colors.text2, textAlign:'center', lineHeight: 21 },
  emptyBtn: { marginTop: 10, backgroundColor: Colors.accentBg, borderWidth:1, borderColor: Colors.accent2, borderRadius: Radius.full, paddingHorizontal: 22, paddingVertical: 11 },
  emptyBtnText: { color: Colors.accent2, fontSize: 14, fontWeight: '700' },

  // FABs
  fabGroup: { position:'absolute', right: 16, flexDirection:'row', alignItems:'center', gap: 10 },
  fabSecondary: { backgroundColor: Colors.bg2, borderWidth:1, borderColor: Colors.border, borderRadius: Radius.full, paddingHorizontal: 18, paddingVertical: 13, ...Shadow.card },
  fabSecondaryText: { color: Colors.text2, fontSize: 14, fontWeight: '600' },
  fab: { width: 56, height: 56, borderRadius: 28, alignItems:'center', justifyContent:'center', ...Shadow.fab },
  fabIcon: { fontSize: 26, color: '#fff', lineHeight: 30 },

  // Modal
  modalHeader: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', paddingHorizontal: 18, paddingVertical: 15, borderBottomWidth:1, borderBottomColor: Colors.border },
  modalTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  modalClose: { minWidth: 64 },
  modalCloseText: { color: Colors.accent2, fontSize: 15, fontWeight: '600' },
});
