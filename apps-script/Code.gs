/** EV Tracker — Apps Script ต่อกับ Google Sheet ที่ใช้เป็นฐานข้อมูล */

const ENTRY_HEADERS = ['id', 'ts', 'event', 'odo', 'soc', 'range', 'trip', 'mode', 'socAfter', 'kwh', 'cost', 'note'];

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('EV Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

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
    s.appendRow(ENTRY_HEADERS);
    s.setFrozenRows(1);
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
