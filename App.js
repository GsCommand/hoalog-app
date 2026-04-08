import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, Modal, Alert, Platform, FlatList,
  SafeAreaView, StatusBar, Image, ActivityIndicator, Linking,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as Notifications from 'expo-notifications';

// ─── NOTIFICATIONS ────────────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const requestNotificationPermission = async () => {
  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
};

const scheduleReminder = async (hour = 9, minute = 0) => {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    const granted = await requestNotificationPermission();
    if (!granted) return false;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'HOALog',
        body: 'Have any incidents to log today? Document it before details fade.',
        sound: false,
      },
      trigger: {
        hour,
        minute,
        repeats: true,
      },
    });
    return true;
  } catch { return false; }
};

const cancelReminders = async () => {
  try { await Notifications.cancelAllScheduledNotificationsAsync(); } catch {}
};

// ─── COLORS ───────────────────────────────────────────────────────────────────
const C = {
  bg: '#F2F2F7', card: '#FFFFFF',
  orange: '#F97316', orangeLight: '#FEF3C7', orangeText: '#B45309',
  blue: '#2563EB', blueLight: '#DBEAFE', blueText: '#1D4ED8',
  green: '#10B981', greenLight: '#D1FAE5', greenText: '#065F46',
  purple: '#7C3AED', purpleLight: '#EDE9FE', purpleText: '#5B21B6',
  red: '#EF4444', text: '#111827', textSecondary: '#6B7280',
  textMuted: '#9CA3AF', border: '#E5E7EB', navBg: '#FFFFFF',
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const uuid = () => Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const fmtTime = (iso) => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
const fmtShort = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

const INCIDENT_TYPES = [
  { key: 'parking', label: 'Parking Violation', icon: '🚗' },
  { key: 'property', label: 'Property Condition', icon: '🏠' },
  { key: 'noise', label: 'Noise Complaint', icon: '🔊' },
  { key: 'pet', label: 'Pet Violation', icon: '🐾' },
  { key: 'damage', label: 'Property Damage', icon: '⚠️' },
  { key: 'lease', label: 'Lease / Rule Violation', icon: '📄' },
  { key: 'custom', label: 'Custom', icon: '···' },
];

const COMM_TYPES = [
  { key: 'email', label: 'Email', icon: '✉️' },
  { key: 'letter', label: 'Letter', icon: '📄' },
  { key: 'phone', label: 'Phone Call', icon: '📞' },
  { key: 'inperson', label: 'In Person', icon: '👤' },
  { key: 'text', label: 'Text Message', icon: '💬' },
];

const STATUSES = [
  { key: 'open',      label: 'Open',         color: C.blue,   bg: C.blueLight,   textColor: C.blueText },
  { key: 'submitted', label: 'Submitted',    color: C.orange, bg: C.orangeLight, textColor: C.orangeText },
  { key: 'review',    label: 'Under Review', color: C.purple, bg: C.purpleLight, textColor: C.purpleText },
  { key: 'resolved',  label: 'Resolved',     color: C.green,  bg: C.greenLight,  textColor: C.greenText },
];

const getStatus = (key) => STATUSES.find(s => s.key === key) || STATUSES[0];

const STORAGE_KEY = '@hoalog_v2';
const loadCases = async () => { try { const r = await AsyncStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : []; } catch { return []; } };
const saveCases = async (c) => { try { await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch {} };

// ─── GPS ──────────────────────────────────────────────────────────────────────
const getGPS = async () => {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location Access', 'Enable location access to log GPS coordinates on incidents.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return null;
    }
    // Try high accuracy first, fall back to last known
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 5000,
        distanceInterval: 0,
      });
      return `${loc.coords.latitude.toFixed(6)}, ${loc.coords.longitude.toFixed(6)}`;
    } catch {
      const last = await Location.getLastKnownPositionAsync();
      if (last) return `${last.coords.latitude.toFixed(6)}, ${last.coords.longitude.toFixed(6)}`;
      return null;
    }
  } catch { return null; }
};

// ─── PDF ──────────────────────────────────────────────────────────────────────
const exportPDF = async (hoaCase) => {
  const incidents = (hoaCase.incidents || []).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const comms = (hoaCase.communications || []).sort((a, b) => new Date(a.date) - new Date(b.date));
  const totalPhotos = incidents.reduce((a, i) => a + (i.photos?.length || 0), 0);
  const gpsCount = incidents.filter(i => i.gps).length;

  const incRows = incidents.map(inc => {
    const t = INCIDENT_TYPES.find(x => x.key === inc.type) || INCIDENT_TYPES[0];
    const imgs = (inc.photos || []).map(uri =>
      `<img src="${uri}" style="width:110px;height:82px;object-fit:cover;border-radius:5px;margin:3px;" />`
    ).join('');
    return `<div style="margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:8px;border-left:3px solid #F97316;">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <b style="font-size:13px;">${t.icon} ${t.label}</b>
        <span style="font-size:11px;color:#6B7280;">${fmtDate(inc.timestamp)} · ${fmtTime(inc.timestamp)}</span>
      </div>
      ${inc.gps ? `<div style="font-size:10px;color:#2563EB;font-family:monospace;margin-bottom:3px;">📍 ${inc.gps}</div>` : ''}
      ${inc.address ? `<div style="font-size:11px;color:#6B7280;margin-bottom:3px;">📌 ${inc.address}</div>` : ''}
      ${inc.notes ? `<div style="font-size:12px;color:#374151;">${inc.notes}</div>` : ''}
      ${imgs ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;">${imgs}</div>` : ''}
    </div>`;
  }).join('');

  const commRows = comms.map(comm => {
    const t = COMM_TYPES.find(x => x.key === comm.type) || COMM_TYPES[0];
    return `<div style="margin-bottom:8px;padding:10px 12px;background:#f9fafb;border-radius:6px;">
      <b style="font-size:12px;">${t.icon} ${comm.subject || t.label}</b>
      <div style="font-size:10px;color:#6B7280;margin-top:2px;">${t.label} · ${fmtDate(comm.date)}</div>
      ${comm.notes ? `<div style="font-size:11px;color:#374151;margin-top:3px;">${comm.notes}</div>` : ''}
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <style>body{font-family:-apple-system,Helvetica,sans-serif;margin:0;padding:0;color:#111827;}
  .hdr{background:#F97316;padding:26px 30px;}.lbl{font-size:9px;font-weight:700;color:rgba(255,255,255,.7);letter-spacing:1px;text-transform:uppercase;}
  .ttl{font-size:22px;font-weight:800;color:#fff;margin:4px 0;}.sub{font-size:11px;color:rgba(255,255,255,.8);}
  .stats{display:flex;border-bottom:1px solid #E5E7EB;}
  .stat{flex:1;padding:14px;text-align:center;border-right:1px solid #E5E7EB;}
  .stat:last-child{border-right:none;}.snum{font-size:26px;font-weight:800;}.slbl{font-size:9px;color:#9CA3AF;margin-top:2px;}
  .body{padding:22px 30px;}.stitle{font-size:11px;font-weight:700;color:#9CA3AF;letter-spacing:.5px;text-transform:uppercase;margin:18px 0 10px;}
  .ftr{margin-top:24px;padding:14px 30px;border-top:1px solid #E5E7EB;font-size:9px;color:#9CA3AF;text-align:center;}</style>
  </head><body>
  <div class="hdr"><div class="lbl">HOALog Evidence Report</div>
  <div class="ttl">${hoaCase.title}</div>
  <div class="sub">${hoaCase.address ? hoaCase.address + ' · ' : ''}Status: ${getStatus(hoaCase.status).label} · ${fmtDate(new Date().toISOString())}</div></div>
  <div class="stats">
    <div class="stat"><div class="snum">${incidents.length}</div><div class="slbl">Incidents</div></div>
    <div class="stat"><div class="snum">${totalPhotos}</div><div class="slbl">Photos</div></div>
    <div class="stat"><div class="snum">${gpsCount}</div><div class="slbl">GPS Logged</div></div>
    <div class="stat"><div class="snum">${comms.length}</div><div class="slbl">Comms</div></div>
  </div>
  <div class="body">
    ${incidents.length ? `<div class="stitle">Incident Log</div>${incRows}` : ''}
    ${comms.length ? `<div class="stitle">Communications</div>${commRows}` : ''}
    ${hoaCase.notes ? `<div class="stitle">Case Notes</div><p style="font-size:12px;color:#374151;">${hoaCase.notes}</p>` : ''}
  </div>
  <div class="ftr">Generated by HOALog · Evidence documentation for HOA disputes</div>
  </body></html>`;

  try {
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `${hoaCase.title} — HOALog Report` });
    } else {
      Alert.alert('Report saved', uri);
    }
  } catch { Alert.alert('Error', 'Could not generate PDF.'); }
};

// ─── SHARED UI ────────────────────────────────────────────────────────────────
const StatusPill = ({ statusKey, small }) => {
  const s = getStatus(statusKey);
  return <View style={[styles.pill, { backgroundColor: s.bg }]}>
    <Text style={[styles.pillText, { color: s.textColor }, small && { fontSize: 10 }]}>{s.label}</Text>
  </View>;
};

const NavBar = ({ title, left, right, sub }) => (
  <View style={styles.navBar}>
    <View style={styles.navLeft}>{left}</View>
    <View style={styles.navCenter}>
      <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
      {sub ? <Text style={styles.navSub}>{sub}</Text> : null}
    </View>
    <View style={styles.navRight}>{right}</View>
  </View>
);

const Card = ({ children, style, onPress }) => {
  const W = onPress ? TouchableOpacity : View;
  return <W onPress={onPress} activeOpacity={0.7} style={[styles.card, style]}>{children}</W>;
};

const Btn = ({ label, onPress, color, outline, disabled }) => (
  <TouchableOpacity onPress={onPress} disabled={disabled} activeOpacity={0.8}
    style={[styles.btn, { backgroundColor: outline ? 'transparent' : (color || C.orange) },
      outline && { borderWidth: 1.5, borderColor: color || C.orange }, disabled && { opacity: 0.4 }]}>
    <Text style={[styles.btnText, outline && { color: color || C.orange }]}>{label}</Text>
  </TouchableOpacity>
);

const FilterPill = ({ label, active, onPress }) => (
  <TouchableOpacity onPress={onPress} activeOpacity={0.7}
    style={[styles.filterPill, active && { backgroundColor: C.text }]}>
    <Text style={[styles.filterPillText, active && { color: '#fff' }]}>{label}</Text>
  </TouchableOpacity>
);

const PhotoStrip = ({ photos, onAdd, onRemove }) => (
  <View>
    {photos.length > 0 && (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {photos.map((uri, i) => (
            <View key={i} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              {onRemove && (
                <TouchableOpacity onPress={() => onRemove(i)} style={styles.thumbX}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700', lineHeight: 16 }}>×</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
    )}
    {photos.length < 5 && onAdd && (
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TouchableOpacity onPress={() => onAdd('camera')} style={styles.photoBtn}>
          <Text style={styles.photoBtnTxt}>📷 Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => onAdd('library')} style={styles.photoBtn}>
          <Text style={styles.photoBtnTxt}>🖼 Library</Text>
        </TouchableOpacity>
      </View>
    )}
  </View>
);

// ─── CASE LIST ────────────────────────────────────────────────────────────────
const CaseListScreen = ({ cases, isPurchased, onOpenCase, onNewCase, onPaywall, onSettings }) => {
  const [filter, setFilter] = useState('all');
  const filtered = filter === 'all' ? cases : cases.filter(c => c.status === filter);
  const canAdd = isPurchased || cases.length < 1;

  const dateRange = (c) => {
    if (!c.incidents?.length) return 'No incidents';
    const dates = c.incidents.map(i => new Date(i.timestamp).getTime());
    const fmt = d => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const a = fmt(Math.min(...dates)), b = fmt(Math.max(...dates));
    return a === b ? a : `${a} – ${b}`;
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={C.navBg} />
      <NavBar title="HOALog"
        left={<TouchableOpacity onPress={onSettings}><Text style={[styles.backBtn, { fontSize: 20 }]}>⚙️</Text></TouchableOpacity>}
        right={
        <TouchableOpacity onPress={canAdd ? onNewCase : onPaywall} style={styles.addBtn}>
          <Text style={styles.addBtnTxt}>+</Text>
        </TouchableOpacity>
      } />
      <View style={styles.filterRow}>
        {['all', 'open', 'submitted', 'review', 'resolved'].map(f => (
          <FilterPill key={f} label={f === 'all' ? 'All' : getStatus(f).label} active={filter === f} onPress={() => setFilter(f)} />
        ))}
      </View>
      {filtered.length === 0 ? (
        <View style={styles.empty}>
          <Text style={{ fontSize: 52, marginBottom: 12 }}>📁</Text>
          <Text style={styles.emptyTitle}>No cases yet</Text>
          <Text style={styles.emptyText}>Create a case to start documenting an issue.</Text>
          <View style={{ marginTop: 16 }}><Btn label="New Case" onPress={canAdd ? onNewCase : onPaywall} /></View>
        </View>
      ) : (
        <FlatList data={filtered} keyExtractor={i => i.id} contentContainerStyle={{ padding: 16, gap: 10 }}
          renderItem={({ item: c }) => {
            const s = getStatus(c.status); const count = c.incidents?.length || 0;
            return (
              <Card onPress={() => onOpenCase(c)}>
                <View style={styles.caseTop}>
                  <Text style={styles.caseTitle} numberOfLines={2}>{c.title}</Text>
                  <StatusPill statusKey={c.status} small />
                </View>
                {c.address ? <Text style={styles.caseAddr}>{c.address}</Text> : null}
                <View style={[styles.progressBar, { marginTop: 8 }]}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, (count / 20) * 100)}%`, backgroundColor: s.color }]} />
                </View>
                <View style={styles.caseMeta}>
                  <Text style={styles.caseMetaTxt}>📷 {count} incident{count !== 1 ? 's' : ''}</Text>
                  <Text style={styles.caseMetaTxt}>{dateRange(c)}</Text>
                </View>
              </Card>
            );
          }} />
      )}
    </SafeAreaView>
  );
};

// ─── CASE DETAIL ──────────────────────────────────────────────────────────────
const CaseDetailScreen = ({ hoaCase, onBack, onUpdate, onPaywall, isPurchased }) => {
  const [showAddInc, setShowAddInc] = useState(false);
  const [showAddComm, setShowAddComm] = useState(false);
  const [showStatus, setShowStatus] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [tab, setTab] = useState('incidents');
  const canAddInc = isPurchased || (hoaCase.incidents?.length || 0) < 10;

  const doExport = async () => {
    if (!isPurchased) { onPaywall(); return; }
    setExporting(true);
    await exportPDF(hoaCase);
    setExporting(false);
  };

  const delInc = (id) => Alert.alert('Delete Incident', 'Remove this?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () =>
      onUpdate({ ...hoaCase, incidents: hoaCase.incidents.filter(i => i.id !== id), updatedAt: new Date().toISOString() }) },
  ]);

  const delComm = (id) => Alert.alert('Delete', 'Remove this?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () =>
      onUpdate({ ...hoaCase, communications: hoaCase.communications.filter(c => c.id !== id), updatedAt: new Date().toISOString() }) },
  ]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" backgroundColor={C.navBg} />
      <NavBar
        title={hoaCase.title}
        sub={`${hoaCase.incidents?.length || 0} incidents`}
        left={<TouchableOpacity onPress={onBack}><Text style={styles.backBtn}>‹ Back</Text></TouchableOpacity>}
        right={
          <TouchableOpacity onPress={() => setShowStatus(true)}>
            <StatusPill statusKey={hoaCase.status} small />
          </TouchableOpacity>
        }
      />
      <View style={styles.tabRow}>
        {[['incidents', `Incidents (${hoaCase.incidents?.length || 0})`], ['comms', `Comms (${hoaCase.communications?.length || 0})`]].map(([k, lbl]) => (
          <TouchableOpacity key={k} style={[styles.tab, tab === k && styles.tabActive]} onPress={() => setTab(k)}>
            <Text style={[styles.tabTxt, tab === k && styles.tabTxtActive]}>{lbl}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        {tab === 'incidents' ? (
          <>
            {(hoaCase.incidents || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).map(inc => {
              const t = INCIDENT_TYPES.find(x => x.key === inc.type) || INCIDENT_TYPES[0];
              return (
                <Card key={inc.id}>
                  <View style={styles.incRow}>
                    <View style={[styles.incIcon]}><Text style={{ fontSize: 18 }}>{t.icon}</Text></View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <View style={styles.incTop}>
                        <Text style={styles.incType}>{t.label}</Text>
                        <Text style={styles.incTime}>{fmtShort(inc.timestamp)} · {fmtTime(inc.timestamp)}</Text>
                      </View>
                      {inc.notes ? <Text style={styles.incNotes} numberOfLines={2}>{inc.notes}</Text> : null}
                      {inc.gps ? <View style={styles.gpsRow}><View style={styles.gpsDot} /><Text style={styles.gpsTxt}>{inc.gps}</Text></View> : null}
                      {inc.photos?.length > 0 && (
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }}>
                          <View style={{ flexDirection: 'row', gap: 5 }}>
                            {inc.photos.map((uri, i) => <Image key={i} source={{ uri }} style={{ width: 60, height: 48, borderRadius: 6 }} />)}
                          </View>
                        </ScrollView>
                      )}
                    </View>
                    <TouchableOpacity onPress={() => delInc(inc.id)} style={{ padding: 4 }}>
                      <Text style={{ color: C.red, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
            <Btn label="+ Log Incident" onPress={canAddInc ? () => setShowAddInc(true) : onPaywall} />
          </>
        ) : (
          <>
            {(hoaCase.communications || []).sort((a, b) => new Date(b.date) - new Date(a.date)).map(comm => {
              const t = COMM_TYPES.find(x => x.key === comm.type) || COMM_TYPES[0];
              return (
                <Card key={comm.id}>
                  <View style={styles.incRow}>
                    <View style={styles.commIcon}><Text style={{ fontSize: 18 }}>{t.icon}</Text></View>
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.incType}>{comm.subject || t.label}</Text>
                      <Text style={styles.incTime}>{t.label} · {fmtDate(comm.date)}</Text>
                      {comm.notes ? <Text style={styles.incNotes} numberOfLines={2}>{comm.notes}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => delComm(comm.id)} style={{ padding: 4 }}>
                      <Text style={{ color: C.red, fontSize: 18 }}>×</Text>
                    </TouchableOpacity>
                  </View>
                </Card>
              );
            })}
            <Btn label="+ Log Communication" onPress={() => setShowAddComm(true)} />
          </>
        )}
        <View style={{ marginTop: 8 }}>
          {exporting
            ? <View style={[styles.btn, { backgroundColor: C.orange, opacity: 0.7 }]}>
                <ActivityIndicator color="#fff" size="small" />
              </View>
            : <Btn label="📤  Export PDF Report" onPress={doExport} />
          }
        </View>
        <View style={{ height: 20 }} />
      </ScrollView>

      {showAddInc && <AddIncidentModal onClose={() => setShowAddInc(false)}
        onSave={inc => { onUpdate({ ...hoaCase, incidents: [...(hoaCase.incidents || []), inc], updatedAt: new Date().toISOString() }); setShowAddInc(false); }} />}
      {showAddComm && <AddCommModal onClose={() => setShowAddComm(false)}
        onSave={comm => { onUpdate({ ...hoaCase, communications: [...(hoaCase.communications || []), comm], updatedAt: new Date().toISOString() }); setShowAddComm(false); }} />}
      {showStatus && (
        <Modal transparent animationType="fade" onRequestClose={() => setShowStatus(false)}>
          <TouchableOpacity style={styles.overlay} onPress={() => setShowStatus(false)}>
            <View style={styles.statusMenu}>
              <Text style={styles.statusMenuTitle}>Change Status</Text>
              {STATUSES.map(s => (
                <TouchableOpacity key={s.key} style={{ paddingVertical: 5 }}
                  onPress={() => { onUpdate({ ...hoaCase, status: s.key, updatedAt: new Date().toISOString() }); setShowStatus(false); }}>
                  <View style={[styles.pill, { backgroundColor: s.bg }]}>
                    <Text style={[styles.pillText, { color: s.textColor }]}>{s.label}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </TouchableOpacity>
        </Modal>
      )}
    </SafeAreaView>
  );
};

// ─── ADD INCIDENT MODAL ───────────────────────────────────────────────────────
const AddIncidentModal = ({ onClose, onSave }) => {
  const [type, setType] = useState('parking');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [photos, setPhotos] = useState([]);
  const [gps, setGps] = useState(null);
  const [locating, setLocating] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchGPS = async () => {
    setLocating(true);
    setGps(null);
    const g = await getGPS();
    setGps(g);
    setLocating(false);
  };

  useEffect(() => { fetchGPS(); }, []);

  const pickPhoto = async (source) => {
    if (photos.length >= 5) return;
    try {
      let result;
      if (source === 'camera') {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('Camera Access', 'Enable camera access to take incident photos.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
          ]);
          return;
        }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.8 });
      } else {
        const { status, canAskAgain } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert(
            'Photo Library Access',
            canAskAgain
              ? 'Photo library access is required to attach photos.'
              : 'Enable photo library access in Settings to attach photos.',
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          );
          return;
        }
        result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.8,
          allowsMultipleSelection: true,
          selectionLimit: 5 - photos.length,
        });
      }
      if (!result.canceled) setPhotos(p => [...p, ...result.assets.map(a => a.uri)].slice(0, 5));
    } catch { Alert.alert('Error', 'Could not access photos.'); }
  };

  const save = () => {
    setSaving(true);
    onSave({ id: uuid(), type, notes, address, photos, gps, timestamp: new Date().toISOString() });
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <NavBar title="Log Incident"
          left={<TouchableOpacity onPress={onClose}><Text style={styles.backBtn}>Cancel</Text></TouchableOpacity>}
          right={<TouchableOpacity onPress={save} disabled={saving}><Text style={[styles.backBtn, { color: C.orange, fontWeight: '700' }]}>Save</Text></TouchableOpacity>}
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={styles.secLabel}>TYPE</Text>
          <View style={{ gap: 6 }}>
            {INCIDENT_TYPES.map(t => (
              <TouchableOpacity key={t.key} activeOpacity={0.7} onPress={() => setType(t.key)}
                style={[styles.card, { flexDirection: 'row', alignItems: 'center' }, type === t.key && { borderColor: C.orange, borderWidth: 2 }]}>
                <Text style={{ fontSize: 20 }}>{t.icon}</Text>
                <Text style={[styles.incType, { marginLeft: 10, flex: 1 }]}>{t.label}</Text>
                {type === t.key && <Text style={{ color: C.orange, fontWeight: '700' }}>✓</Text>}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.secLabel}>PHOTOS ({photos.length}/5)</Text>
          <Card><PhotoStrip photos={photos} onAdd={pickPhoto} onRemove={i => setPhotos(p => p.filter((_, idx) => idx !== i))} /></Card>

          <Text style={styles.secLabel}>GPS</Text>
          <Card>
            {locating
              ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><ActivityIndicator size="small" color={C.blue} /><Text style={styles.incNotes}>Acquiring location…</Text></View>
              : gps
                ? <View style={styles.gpsRow}><View style={styles.gpsDot} /><Text style={styles.gpsTxt}>{gps}</Text></View>
                : <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <Text style={styles.incNotes}>Location unavailable</Text>
                    <TouchableOpacity onPress={fetchGPS}>
                      <Text style={{ color: C.blue, fontSize: 13, fontWeight: '600' }}>Retry</Text>
                    </TouchableOpacity>
                  </View>
            }
          </Card>

          <Text style={styles.secLabel}>NOTES</Text>
          <TextInput style={styles.textArea} placeholder="Describe the incident..." placeholderTextColor={C.textMuted}
            value={notes} onChangeText={setNotes} multiline numberOfLines={4} />

          <Text style={styles.secLabel}>LOCATION / UNIT</Text>
          <TextInput style={styles.input} placeholder="Address or unit number" placeholderTextColor={C.textMuted}
            value={address} onChangeText={setAddress} />

          <Btn label={saving ? 'Saving…' : 'Save Incident'} onPress={save} disabled={saving} />
          <View style={{ height: 20 }} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── ADD COMM MODAL ───────────────────────────────────────────────────────────
const AddCommModal = ({ onClose, onSave }) => {
  const [type, setType] = useState('email');
  const [subject, setSubject] = useState('');
  const [notes, setNotes] = useState('');
  const save = () => onSave({ id: uuid(), type, subject: subject || COMM_TYPES.find(t => t.key === type)?.label, notes, date: new Date().toISOString() });

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <NavBar title="Log Communication"
          left={<TouchableOpacity onPress={onClose}><Text style={styles.backBtn}>Cancel</Text></TouchableOpacity>}
          right={<TouchableOpacity onPress={save}><Text style={[styles.backBtn, { color: C.orange, fontWeight: '700' }]}>Save</Text></TouchableOpacity>}
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={styles.secLabel}>TYPE</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {COMM_TYPES.map(t => (
              <TouchableOpacity key={t.key} onPress={() => setType(t.key)} activeOpacity={0.7}
                style={[styles.commTypeBtn, type === t.key && { backgroundColor: C.orange, borderColor: C.orange }]}>
                <Text style={{ fontSize: 20 }}>{t.icon}</Text>
                <Text style={[{ fontSize: 11, marginTop: 3, color: C.textSecondary }, type === t.key && { color: '#fff' }]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.secLabel}>SUBJECT</Text>
          <TextInput style={styles.input} placeholder="Subject or summary" placeholderTextColor={C.textMuted} value={subject} onChangeText={setSubject} />
          <Text style={styles.secLabel}>NOTES</Text>
          <TextInput style={styles.textArea} placeholder="Additional notes..." placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
          <Btn label="Save" onPress={save} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── NEW CASE MODAL ───────────────────────────────────────────────────────────
const NewCaseModal = ({ onClose, onSave }) => {
  const [title, setTitle] = useState('');
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const save = () => {
    if (!title.trim()) { Alert.alert('Title required'); return; }
    onSave({ id: uuid(), title: title.trim(), address, notes, status: 'open',
      incidents: [], communications: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  };
  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <NavBar title="New Case"
          left={<TouchableOpacity onPress={onClose}><Text style={styles.backBtn}>Cancel</Text></TouchableOpacity>}
          right={<TouchableOpacity onPress={save}><Text style={[styles.backBtn, { color: C.orange, fontWeight: '700' }]}>Create</Text></TouchableOpacity>}
        />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={styles.secLabel}>CASE TITLE</Text>
          <TextInput style={styles.input} placeholder="e.g. Parking — Unit 12B" placeholderTextColor={C.textMuted} value={title} onChangeText={setTitle} autoFocus />
          <Text style={styles.secLabel}>ADDRESS / UNIT</Text>
          <TextInput style={styles.input} placeholder="Address or unit number" placeholderTextColor={C.textMuted} value={address} onChangeText={setAddress} />
          <Text style={styles.secLabel}>NOTES</Text>
          <TextInput style={styles.textArea} placeholder="Background info..." placeholderTextColor={C.textMuted} value={notes} onChangeText={setNotes} multiline numberOfLines={4} />
          <Btn label="Create Case" onPress={save} />
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── PAYWALL ──────────────────────────────────────────────────────────────────
const PaywallScreen = ({ onClose, onPurchase }) => (
  <Modal animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="dark-content" />
      <NavBar title="" left={<TouchableOpacity onPress={onClose}><Text style={[styles.backBtn, { color: C.textMuted }]}>Not Now</Text></TouchableOpacity>} />
      <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center', gap: 20 }}>
        <Text style={{ fontSize: 52 }}>📋</Text>
        <Text style={{ fontSize: 24, fontWeight: '800', color: C.text, textAlign: 'center' }}>HOALog Premium</Text>
        <Text style={[styles.incNotes, { textAlign: 'center' }]}>One-time purchase. No subscription. Yours forever.</Text>
        <Card style={{ width: '100%', gap: 14 }}>
          {[['∞','Unlimited incidents per case'],['📄','PDF evidence report — one tap'],['📷','Up to 5 photos per incident'],['📁','Unlimited cases'],['💬','Communications log'],['✓','Case status tracking']].map(([icon, txt], i) => (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.commIcon, { backgroundColor: C.blueLight }]}><Text style={{ fontSize: 16, color: C.blue }}>{icon}</Text></View>
              <Text style={styles.incType}>{txt}</Text>
            </View>
          ))}
        </Card>
        <Card style={{ width: '100%', backgroundColor: C.orangeLight }}>
          <Text style={[styles.incNotes, { textAlign: 'center', color: C.orangeText }]}>
            "A paralegal charges $200+ to assemble this report. HOALog generates it in one tap."
          </Text>
        </Card>
      </ScrollView>
      <View style={{ padding: 24, gap: 12 }}>
        <Btn label="Unlock HOALog · $9.99" onPress={onPurchase} />
        <TouchableOpacity onPress={onClose} style={{ alignItems: 'center' }}>
          <Text style={{ color: C.textMuted, fontSize: 14 }}>Restore Purchase</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  </Modal>
);

// ─── SETTINGS MODAL ──────────────────────────────────────────────────────────
const SettingsModal = ({ onClose }) => {
  const [remindersOn, setRemindersOn] = useState(false);
  const [hour, setHour] = useState('9');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@hoalog_reminders').then(v => {
      if (v) { const s = JSON.parse(v); setRemindersOn(s.on); setHour(String(s.hour || 9)); }
    });
  }, []);

  const toggleReminders = async (val) => {
    setSaving(true);
    if (val) {
      const ok = await scheduleReminder(parseInt(hour) || 9, 0);
      if (ok) {
        setRemindersOn(true);
        await AsyncStorage.setItem('@hoalog_reminders', JSON.stringify({ on: true, hour: parseInt(hour) || 9 }));
        Alert.alert('Reminders On', `You'll get a daily nudge at ${hour}:00am.`);
      } else {
        Alert.alert('Notifications Blocked', 'Enable notifications in Settings to receive daily reminders.', [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ]);
      }
    } else {
      await cancelReminders();
      setRemindersOn(false);
      await AsyncStorage.setItem('@hoalog_reminders', JSON.stringify({ on: false }));
    }
    setSaving(false);
  };

  return (
    <Modal animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.safeArea}>
        <StatusBar barStyle="dark-content" />
        <NavBar title="Settings"
          left={<TouchableOpacity onPress={onClose}><Text style={styles.backBtn}>Done</Text></TouchableOpacity>} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }}>
          <Text style={styles.secLabel}>REMINDERS</Text>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: remindersOn ? 12 : 0 }}>
              <View>
                <Text style={styles.incType}>Daily reminder</Text>
                <Text style={styles.incNotes}>Nudge to log incidents</Text>
              </View>
              <TouchableOpacity onPress={() => toggleReminders(!remindersOn)} disabled={saving}
                style={[styles.toggle, remindersOn && { backgroundColor: C.orange }]}>
                <View style={[styles.toggleThumb, remindersOn && { transform: [{ translateX: 20 }] }]} />
              </TouchableOpacity>
            </View>
            {remindersOn && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.incNotes}>Remind me at</Text>
                <TextInput
                  style={[styles.input, { width: 60, textAlign: 'center', padding: 8 }]}
                  value={hour}
                  onChangeText={setHour}
                  keyboardType="number-pad"
                  maxLength={2}
                />
                <Text style={styles.incNotes}>:00</Text>
                <TouchableOpacity onPress={() => toggleReminders(true)} style={{ marginLeft: 8 }}>
                  <Text style={{ color: C.orange, fontWeight: '700', fontSize: 13 }}>Update</Text>
                </TouchableOpacity>
              </View>
            )}
          </Card>

          <Text style={styles.secLabel}>ABOUT</Text>
          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={styles.incType}>HOALog</Text>
              <Text style={styles.incNotes}>v1.0.0</Text>
            </View>
            <Text style={styles.incNotes}>Evidence documentation for HOA disputes. One-time purchase, no subscription.</Text>
          </Card>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [cases, setCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState('list');
  const [activeCase, setActiveCase] = useState(null);
  const [showNewCase, setShowNewCase] = useState(false);
  const [showPaywall, setShowPaywall] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isPurchased, setIsPurchased] = useState(false);

  useEffect(() => { loadCases().then(c => { setCases(c); setLoading(false); }); }, []);

  const persist = (u) => { setCases(u); saveCases(u); };
  const handleNewCase = (c) => { persist([c, ...cases]); setShowNewCase(false); setActiveCase(c); setScreen('detail'); };
  const handleUpdate = (u) => { persist(cases.map(c => c.id === u.id ? u : c)); setActiveCase(u); };

  if (loading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}><ActivityIndicator color={C.orange} size="large" /></View>;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {screen === 'list' && <CaseListScreen cases={cases} isPurchased={isPurchased}
        onOpenCase={c => { setActiveCase(c); setScreen('detail'); }}
        onNewCase={() => setShowNewCase(true)} onPaywall={() => setShowPaywall(true)}
        onSettings={() => setShowSettings(true)} />}
      {screen === 'detail' && activeCase && <CaseDetailScreen hoaCase={activeCase} isPurchased={isPurchased}
        onBack={() => setScreen('list')} onUpdate={handleUpdate} onPaywall={() => setShowPaywall(true)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showNewCase && <NewCaseModal onClose={() => setShowNewCase(false)} onSave={handleNewCase} />}
      {showPaywall && <PaywallScreen onClose={() => setShowPaywall(false)}
        onPurchase={() => { setIsPurchased(true); setShowPaywall(false); Alert.alert('Unlocked! 🎉', 'HOALog Premium is now active.'); }} />}
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg },
  navBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.navBg, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: C.border, minHeight: 52 },
  navLeft: { width: 70 }, navCenter: { flex: 1, alignItems: 'center' }, navRight: { width: 70, alignItems: 'flex-end' },
  navTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  navSub: { fontSize: 11, color: C.blue, marginTop: 1 },
  backBtn: { fontSize: 15, color: C.blue, fontWeight: '500' },
  addBtn: { width: 30, height: 30, borderRadius: 15, backgroundColor: C.orange, alignItems: 'center', justifyContent: 'center' },
  addBtnTxt: { fontSize: 22, color: '#fff', lineHeight: 28 },
  filterRow: { flexDirection: 'row', padding: 10, gap: 6, backgroundColor: C.navBg, borderBottomWidth: 0.5, borderBottomColor: C.border },
  filterPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, backgroundColor: C.border },
  filterPillText: { fontSize: 11, fontWeight: '600', color: C.textSecondary },
  card: { backgroundColor: C.card, borderRadius: 12, padding: 14, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  pillText: { fontSize: 11, fontWeight: '700' },
  caseTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4, gap: 8 },
  caseTitle: { fontSize: 15, fontWeight: '700', color: C.text, flex: 1 },
  caseAddr: { fontSize: 12, color: C.textSecondary, marginBottom: 2 },
  caseMeta: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  caseMetaTxt: { fontSize: 11, color: C.textMuted },
  progressBar: { height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: C.text, marginBottom: 6 },
  emptyText: { fontSize: 14, color: C.textSecondary, textAlign: 'center' },
  tabRow: { flexDirection: 'row', backgroundColor: C.navBg, borderBottomWidth: 0.5, borderBottomColor: C.border },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.orange },
  tabTxt: { fontSize: 13, fontWeight: '500', color: C.textMuted },
  tabTxtActive: { color: C.orange, fontWeight: '700' },
  incRow: { flexDirection: 'row', alignItems: 'flex-start' },
  incIcon: { width: 36, height: 36, borderRadius: 9, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center' },
  incTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  incType: { fontSize: 13, fontWeight: '600', color: C.text },
  incTime: { fontSize: 11, color: C.blue },
  incNotes: { fontSize: 12, color: C.textSecondary, lineHeight: 17 },
  gpsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  gpsDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.blue },
  gpsTxt: { fontSize: 10, color: C.blue, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  commIcon: { width: 36, height: 36, borderRadius: 8, backgroundColor: C.blueLight, alignItems: 'center', justifyContent: 'center' },
  secLabel: { fontSize: 11, fontWeight: '700', color: C.textMuted, letterSpacing: 0.5 },
  input: { backgroundColor: C.card, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, borderWidth: 0.5, borderColor: C.border },
  textArea: { backgroundColor: C.card, borderRadius: 10, padding: 12, fontSize: 15, color: C.text, borderWidth: 0.5, borderColor: C.border, minHeight: 100, textAlignVertical: 'top' },
  btn: { paddingVertical: 14, paddingHorizontal: 24, borderRadius: 12, alignItems: 'center' },
  btnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  commTypeBtn: { flex: 1, minWidth: 90, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card },
  statusMenu: { backgroundColor: C.card, borderRadius: 16, padding: 16, margin: 24, gap: 10 },
  statusMenuTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 4 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' },
  thumbWrap: { position: 'relative' },
  thumb: { width: 72, height: 58, borderRadius: 8 },
  thumbX: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' },
  photoBtn: { flex: 1, backgroundColor: C.card, borderRadius: 10, padding: 10, alignItems: 'center', borderWidth: 1, borderColor: C.border, borderStyle: 'dashed' },
  toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: C.border, padding: 2, justifyContent: 'center' },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2 },
  photoBtnTxt: { fontSize: 13, color: C.blue, fontWeight: '600' },
});