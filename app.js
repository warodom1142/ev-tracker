(() => {
  'use strict';

  const { analyze } = EVCalc;
  const KEY = 'ev-tracker-v1';
  const EVENT_LABEL = { start: 'จุดเริ่มต้น', drive: 'ระหว่างทาง', charge: 'ชาร์จ' };
  const CHARGER_LABEL = { home: 'บ้าน', public: 'สาธารณะ' };

  const $ = (sel) => document.querySelector(sel);
  const fmt = (v, d = 2) =>
    v === null || v === undefined || !Number.isFinite(v)
      ? '—'
      : v.toLocaleString('th-TH', { maximumFractionDigits: d, minimumFractionDigits: 0 });
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const fmtTime = (ts) => new Date(ts).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
  const nowLocal = () => {
    const d = new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };
  const newId = () =>
    (crypto && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  // ---------- storage ----------
  const defaultSettings = () => ({ name: '', capacityKwh: '', homePrice: '', publicPrice: '' });

  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY));
      if (d && Array.isArray(d.entries)) return { settings: { ...defaultSettings(), ...d.settings }, entries: d.entries };
    } catch (_) {
      /* ข้อมูลเสีย → เริ่มใหม่ */
    }
    return { settings: defaultSettings(), entries: [] };
  }

  let db = load();
  const persist = () => localStorage.setItem(KEY, JSON.stringify(db));

  // ---------- settings ----------
  const settingFields = { name: '#setName', capacityKwh: '#setCap', homePrice: '#setHome', publicPrice: '#setPublic' };

  function loadSettingsUI() {
    for (const [k, sel] of Object.entries(settingFields)) $(sel).value = db.settings[k] ?? '';
  }

  $('#settings').addEventListener('input', () => {
    for (const [k, sel] of Object.entries(settingFields)) db.settings[k] = $(sel).value;
    persist();
    render();
  });

  // ---------- form ----------
  const form = $('#entryForm');
  const field = (name) => form.elements[name];
  const val = (name) => field(name).value.trim();
  const eventType = () => form.querySelector('input[name=event]:checked').value;

  function updateEventUI() {
    const isCharge = eventType() === 'charge';
    $('#chargeFields').hidden = !isCharge;
    $('#socLabel').textContent = isCharge ? 'แบต (%) ก่อนชาร์จ' : 'แบต (%)';
    field('socAfter').required = isCharge;
  }
  form.addEventListener('change', updateEventUI);

  function showMsg(text, isError = false) {
    const el = $('#formMsg');
    el.textContent = text;
    el.className = isError ? 'hint error' : 'hint ok';
  }

  function resetForm() {
    ['odo', 'soc', 'range', 'trip', 'socAfter', 'kwh', 'cost', 'note'].forEach((n) => (field(n).value = ''));
    field('time').value = nowLocal();
    updateEventUI();
    refreshPlaceholders();
  }

  function refreshPlaceholders() {
    const last = [...db.entries].sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
    field('odo').placeholder = last ? `ล่าสุด ${last.odo}` : '';
    field('soc').placeholder = last ? `ล่าสุด ${last.event === 'charge' && last.socAfter != null ? last.socAfter : last.soc}` : '';
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const type = eventType();
    const entry = {
      id: newId(),
      ts: new Date(val('time')).toISOString(),
      event: type,
      odo: Number(val('odo')),
      soc: Number(val('soc')),
      range: val('range') === '' ? null : Number(val('range')),
      trip: val('trip') === '' ? null : Number(val('trip')),
      mode: val('mode'),
      note: val('note'),
    };

    if (!(entry.soc >= 0 && entry.soc <= 100)) return showMsg('แบตต้องอยู่ระหว่าง 0–100%', true);

    if (type === 'charge') {
      entry.socAfter = Number(val('socAfter'));
      entry.kwh = val('kwh') === '' ? null : Number(val('kwh'));
      entry.cost = val('cost') === '' ? null : Number(val('cost'));
      entry.chargerType = val('charger');
      if (!(entry.socAfter > entry.soc && entry.socAfter <= 100)) {
        return showMsg('แบตหลังชาร์จต้องมากกว่าก่อนชาร์จและไม่เกิน 100%', true);
      }
    }

    db.entries.push(entry);
    const { warnings } = analyze(db.entries, db.settings);
    const w = warnings[entry.id];
    if (w && w.length && !confirm('มีคำเตือน:\n- ' + w.join('\n- ') + '\n\nยังต้องการบันทึกไหม?')) {
      db.entries.pop();
      return;
    }

    persist();
    resetForm();
    render();
    showMsg('บันทึกแล้ว ✓');
  });

  // ---------- render ----------
  function render() {
    const res = analyze(db.entries, db.settings);
    $('#capWarn').hidden = Number(db.settings.capacityKwh) > 0;
    renderLast();
    renderSummary(res.totals);
    renderModes(res.byMode);
    renderEntries(res);
    refreshPlaceholders();
  }

  function renderLast() {
    const last = [...db.entries].sort((a, b) => new Date(b.ts) - new Date(a.ts))[0];
    $('#last').textContent = last
      ? `ล่าสุด: ${fmtTime(last.ts)} · ไมล์ ${fmt(last.odo, 1)} km · แบต ${fmt(last.event === 'charge' && last.socAfter != null ? last.socAfter : last.soc, 1)}%`
      : 'ยังไม่มีบันทึก — เริ่มจากกรอก "จุดเริ่มต้น"';
  }

  function renderSummary(t) {
    const cards = [
      ['ระยะทางรวม', fmt(t.totalKm, 1), 'km'],
      ['พลังงานจากแบตที่ใช้', fmt(t.energyKwh, 2), 'kWh'],
      ['อัตราการใช้ไฟเฉลี่ย', fmt(t.avgConsumption, 2), 'kWh/100 km'],
      ['ชาร์จรวม', fmt(t.chargedKwh, 2), 'kWh'],
      ['ค่าชาร์จรวม', fmt(t.totalCost, 0), '฿'],
      ['ค่าใช้จ่ายจริง/กม.', fmt(t.costPerKm, 2), '฿/km'],
      ['ค่าไฟโดยประมาณ/กม.', fmt(t.estCostPerKm, 2), '฿/km'],
      ['ประสิทธิภาพการชาร์จ', t.efficiency === null ? '—' : fmt(t.efficiency * 100, 1), '%'],
    ];
    $('#summary').innerHTML = cards
      .map(([label, value, unit]) => `<div class="stat"><div class="label">${label}</div><div class="value">${value}</div><div class="unit">${unit}</div></div>`)
      .join('');

    const miss = $('#missingCost');
    miss.hidden = t.missingCost === 0;
    miss.textContent = `มี ${t.missingCost} ครั้งที่ไม่มีค่าใช้จ่าย (ไม่ได้ใส่ ฿ และไม่มีราคาไฟในการตั้งค่า) จึงไม่รวมในค่าใช้จ่าย`;
  }

  function renderModes(rows) {
    $('#modes-body').innerHTML = rows.length
      ? rows
          .map(
            (m) =>
              `<tr><td>${esc(m.mode)}</td><td>${fmt(m.km, 1)}</td><td>${fmt(m.kwh, 2)}</td><td>${fmt(m.consumption, 2)}</td></tr>`
          )
          .join('')
      : '<tr><td colspan="4" class="hint">ยังไม่มีข้อมูลการขับที่คำนวณได้ (ต้องตั้งความจุแบตและมีบันทึกอย่างน้อย 2 รายการ)</td></tr>';
  }

  function renderEntries(res) {
    const rows = [...db.entries].sort((a, b) => new Date(b.ts) - new Date(a.ts));
    $('#entries').innerHTML = rows.length
      ? rows.map((e) => entryRow(e, res)).join('')
      : '<tr><td colspan="8" class="hint">ยังไม่มีบันทึก</td></tr>';
  }

  function entryRow(e, res) {
    const seg = res.segmentsById[e.id];
    const ch = res.chargesById[e.id];
    const parts = [];

    if (seg) {
      parts.push(
        `วิ่ง ${fmt(seg.km, 1)} km` +
          (seg.kwh !== null ? ` · ใช้ ${fmt(seg.kwh, 2)} kWh` : '') +
          (seg.consumption !== null ? ` · ${fmt(seg.consumption, 2)} kWh/100km` : '')
      );
    }
    if (ch) {
      parts.push(
        `ชาร์จ${CHARGER_LABEL[ch.chargerType] ?? ''} ${fmt(ch.kwh, 2)} kWh` +
          (ch.cost !== null ? ` · ${fmt(ch.cost, 2)} ฿` : '') +
          (ch.kwhManual ? '' : ' (คำนวณจาก %)')
      );
    }
    if (!parts.length && e.event !== 'charge') parts.push('ค่าเริ่มต้น');

    const warn = res.warnings[e.id];
    const warnHtml = warn
      ? `<span class="warn-badge" title="${esc(warn.join('\n'))}">⚠</span>`
      : '';
    const socText =
      e.event === 'charge' && e.socAfter != null ? `${fmt(e.soc, 1)} → ${fmt(e.socAfter, 1)}%` : `${fmt(e.soc, 1)}%`;
    const rangeText = e.range != null ? `${fmt(e.range, 1)} km` : '—';

    return `<tr>
      <td>${fmtTime(e.ts)}</td>
      <td><span class="tag tag-${e.event}">${EVENT_LABEL[e.event] ?? e.event}</span></td>
      <td>${fmt(e.odo, 1)}</td>
      <td>${socText}</td>
      <td>${rangeText}${e.trip != null ? `<div class="sub-text">trip ${fmt(e.trip, 1)}</div>` : ''}</td>
      <td>${esc(e.mode)}${e.note ? `<div class="sub-text">${esc(e.note)}</div>` : ''}</td>
      <td class="detail">${parts.join('<br>')} ${warnHtml}</td>
      <td><button class="danger small" data-del="${esc(e.id)}" title="ลบ">ลบ</button></td>
    </tr>`;
  }

  $('#entries').addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-del]');
    if (!btn) return;
    if (!confirm('ลบบันทึกนี้?')) return;
    db.entries = db.entries.filter((x) => x.id !== btn.dataset.del);
    persist();
    render();
  });

  // ---------- export / import ----------
  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  $('#exportJson').addEventListener('click', () => {
    download(`ev-tracker-${stamp()}.json`, JSON.stringify(db, null, 2), 'application/json');
  });

  $('#exportCsv').addEventListener('click', () => {
    const res = analyze(db.entries, db.settings);
    const header = ['เวลา', 'ประเภท', 'ไมล์', 'แบต%', 'ระยะหน้าจอ', 'trip', 'โหมด', 'ระยะช่วงนี้(km)', 'kWh ที่ใช้', 'kWh/100km', 'kWh ที่ชาร์จ', 'ค่าชาร์จ(฿)', 'หมายเหตุ'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.map(q).join(',')];
    for (const e of [...db.entries].sort((a, b) => new Date(a.ts) - new Date(b.ts))) {
      const s = res.segmentsById[e.id];
      const c = res.chargesById[e.id];
      lines.push(
        [
          fmtTime(e.ts), EVENT_LABEL[e.event], e.odo, e.event === 'charge' ? `${e.soc}->${e.socAfter}` : e.soc,
          e.range, e.trip, e.mode,
          s ? s.km.toFixed(1) : '', s && s.kwh !== null ? s.kwh.toFixed(2) : '', s && s.consumption !== null ? s.consumption.toFixed(2) : '',
          c && c.kwh !== null ? c.kwh.toFixed(2) : '', c && c.cost !== null ? c.cost.toFixed(2) : '', e.note,
        ].map(q).join(',')
      );
    }
    download(`ev-tracker-${stamp()}.csv`, '﻿' + lines.join('\n'), 'text/csv;charset=utf-8');
  });

  $('#importFile').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    ev.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const incoming = Array.isArray(data.entries) ? data.entries : null;
      if (!incoming || !incoming.every((e) => e.id && e.ts && e.odo != null && e.soc != null)) {
        throw new Error('รูปแบบไฟล์ไม่ถูกต้อง');
      }
      const have = new Set(db.entries.map((e) => e.id));
      const fresh = incoming.filter((e) => !have.has(e.id));
      if (!confirm(`พบ ${incoming.length} รายการ เพิ่มใหม่ ${fresh.length} รายการ (ที่เหลือมีอยู่แล้ว) ต้องการนำเข้า?`)) return;
      db.entries.push(...fresh);
      if (data.settings && !db.settings.capacityKwh) db.settings = { ...db.settings, ...data.settings };
      loadSettingsUI();
      persist();
      render();
    } catch (err) {
      alert('นำเข้าไม่สำเร็จ: ' + err.message);
    }
  });

  // ---------- init ----------
  loadSettingsUI();
  field('time').value = nowLocal();
  updateEventUI();
  render();
})();
