/**
 * EV Tracker — Apps Script เป็น API ให้หน้าเว็บ (web/index.html) เรียกใช้
 * ข้อมูลเก็บใน Google Sheet ของไฟล์นี้: ชีท "entries" และ "settings"
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me · Who has access: Anyone
 */

// vehicle: 'ev' | 'fuel' (ข้อมูลเก่าไม่มีค่านี้ ถือเป็น 'ev')
// liters, full: ใช้กับการเติมน้ำมัน (full = 1 เมื่อเติมเต็มถัง)
// tripName: ชื่อทริป เก็บไว้ที่รายการแรกของทริปนั้น
const ENTRY_HEADERS = ['id', 'ts', 'event', 'odo', 'soc', 'range', 'trip', 'mode', 'socAfter', 'kwh', 'cost', 'note', 'lat', 'lng', 'vehicle', 'liters', 'full', 'tripName'];

// ---------- HTTP ----------
// GET  ?action=getData
// POST text/plain body เป็น JSON: { action, ...payload }
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getData';
  return route_(action, {});
}

function doPost(e) {
  const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  return route_(body.action, body);
}

function route_(action, body) {
  try {
    let data;
    if (action === 'getData') data = getData();
    else if (action === 'addEntry') data = addEntry(body.entry);
    else if (action === 'deleteEntry') data = deleteEntry(body.id);
    else if (action === 'saveSettings') data = saveSettings(body.settings);
    else if (action === 'updateEntry') data = updateEntry(body.id, body.fields);
    else if (action === 'deleteMany') data = deleteMany(body.ids);
    else throw new Error('unknown action: ' + action);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- data ----------
function getData() {
  return { entries: readEntries_(), settings: readSettings_() };
}

function addEntry(entry) {
  return withLock_(() => {
    entriesSheet_().appendRow(ENTRY_HEADERS.map(h => (entry[h] === null || entry[h] === undefined ? '' : entry[h])));
    return getData();
  });
}

// แก้ไขบางคอลัมน์ของรายการหนึ่ง (เช่น ชื่อทริป)
function updateEntry(id, fields) {
  return withLock_(() => {
    const s = entriesSheet_();
    const last = s.getLastRow();
    if (last >= 2) {
      const ids = s.getRange(2, 1, last - 1, 1).getValues();
      for (let i = 0; i < ids.length; i++) {
        if (String(ids[i][0]) === String(id)) {
          Object.keys(fields || {}).forEach(k => {
            const col = ENTRY_HEADERS.indexOf(k);
            if (col >= 0) {
              const v = fields[k];
              s.getRange(i + 2, col + 1).setValue(v === null || v === undefined ? '' : v);
            }
          });
          break;
        }
      }
    }
    return getData();
  });
}

// ลบหลายรายการพร้อมกัน (ใช้ลบทั้งทริป)
function deleteMany(ids) {
  const set = new Set((ids || []).map(String));
  return withLock_(() => {
    const s = entriesSheet_();
    const last = s.getLastRow();
    if (last >= 2) {
      const vals = s.getRange(2, 1, last - 1, 1).getValues();
      for (let i = vals.length - 1; i >= 0; i--) {
        if (set.has(String(vals[i][0]))) s.deleteRow(i + 2);
      }
    }
    return getData();
  });
}

function deleteEntry(id) {
  return withLock_(() => {
    const s = entriesSheet_();
    const n = Math.max(s.getLastRow() - 1, 0);
    if (n > 0) {
      const ids = s.getRange(2, 1, n, 1).getValues();
      for (let i = ids.length - 1; i >= 0; i--) {
        if (String(ids[i][0]) === String(id)) s.deleteRow(i + 2);
      }
    }
    return getData();
  });
}

// รวมค่าใหม่เข้ากับค่าเดิม เพื่อให้บันทึกรถไฟฟ้าไม่ทับรถน้ำมัน และกลับกัน
function saveSettings(settings) {
  return withLock_(() => {
    const s = settingsSheet_();
    const cur = readSettings_();
    Object.keys(settings).forEach(k => { cur[k] = settings[k]; });
    s.clearContents();
    Object.keys(cur).forEach((k, i) => s.getRange(i + 1, 1, 1, 2).setValues([[k, cur[k]]]));
    return getData();
  });
}

// ---------- helpers ----------
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try { return fn(); } finally { lock.releaseLock(); }
}

function ss_() { return SpreadsheetApp.getActiveSpreadsheet(); }

function entriesSheet_() {
  let s = ss_().getSheetByName('entries');
  if (!s) {
    s = ss_().insertSheet('entries');
    s.setFrozenRows(1);
  }
  // เพิ่มหัวคอลัมน์ใหม่ (lat, lng) ให้ชีทเดิมอัตโนมัติ
  if (s.getLastRow() === 0 || s.getLastColumn() < ENTRY_HEADERS.length) {
    s.getRange(1, 1, 1, ENTRY_HEADERS.length).setValues([ENTRY_HEADERS]);
  }
  return s;
}

function settingsSheet_() {
  return ss_().getSheetByName('settings') || ss_().insertSheet('settings');
}

function readEntries_() {
  const s = entriesSheet_();
  const last = s.getLastRow();
  if (last < 2) return [];
  return s.getRange(2, 1, last - 1, ENTRY_HEADERS.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => {
      const o = {};
      ENTRY_HEADERS.forEach((h, i) => {
        let v = r[i];
        if (v instanceof Date) v = v.toISOString();
        o[h] = v === '' ? null : v;
      });
      return o;
    });
}

function readSettings_() {
  const s = settingsSheet_();
  const last = s.getLastRow();
  const out = {};
  if (last > 0) {
    s.getRange(1, 1, last, 2).getValues().forEach(([k, v]) => { if (k) out[k] = v; });
  }
  return out;
}
