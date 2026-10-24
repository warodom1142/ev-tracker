/**
 * EV Tracker — Apps Script เป็น API ให้หน้าเว็บ (web/index.html) เรียกใช้
 * ข้อมูลเก็บใน Google Sheet ของไฟล์นี้: ชีท "entries" และ "settings"
 *
 * Deploy: Deploy → New deployment → Web app
 *   Execute as: Me · Who has access: Anyone
 */

const ENTRY_HEADERS = ['id', 'ts', 'event', 'odo', 'soc', 'range', 'trip', 'mode', 'socAfter', 'kwh', 'cost', 'note', 'lat', 'lng'];

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

function saveSettings(settings) {
  return withLock_(() => {
    const s = settingsSheet_();
    s.clearContents();
    Object.keys(settings).forEach((k, i) => s.getRange(i + 1, 1, 1, 2).setValues([[k, settings[k]]]));
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
