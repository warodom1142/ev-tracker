/*
 * EV Tracker — logic only (no DOM).
 * ทำงานได้ทั้งในเบราว์เซอร์ (window.EVCalc) และใน Node (module.exports) เพื่อใช้ทดสอบ
 *
 * โมเดลข้อมูล: แต่ละ entry คือ "การอ่านค่า" ณ เวลาหนึ่ง
 *   { id, ts, event: 'start'|'drive'|'charge', odo, soc, mode, range, trip, note,
 *     // เฉพาะ event = 'charge'
 *     socAfter, kwh, cost, chargerType: 'home'|'public' }
 *
 * หลักการคำนวณ: ระหว่าง entry สองอันที่อยู่ติดกัน
 *   ระยะ = odo ปัจจุบัน - odo ก่อนหน้า
 *   พลังงานที่ใช้ = (แบต% ก่อนหน้า - แบต% ปัจจุบัน) / 100 * ความจุ
 *   โหมดขับ = โหมดที่กรอกใน entry ปลายทาง (ใช้กับช่วงตั้งแต่บันทึกก่อนหน้า)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EVCalc = api;
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  const toNum = (v) => {
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const sum = (arr) => arr.reduce((a, b) => a + b, 0);

  function priceFor(chargerType, settings) {
    return toNum(chargerType === 'public' ? settings.publicPrice : settings.homePrice);
  }

  function analyze(entries, settings = {}) {
    const cap = toNum(settings.capacityKwh) || 0;

    const sorted = entries
      .filter((e) => toNum(e.odo) !== null && toNum(e.soc) !== null)
      .sort((a, b) => new Date(a.ts) - new Date(b.ts) || toNum(a.odo) - toNum(b.odo));

    const segments = [];
    const charges = [];
    const warnings = {};
    const warn = (id, msg) => {
      (warnings[id] = warnings[id] || []).push(msg);
    };

    let state = null; // ค่าการอ่านล่าสุด { odo, soc, ts }

    for (const e of sorted) {
      const odo = toNum(e.odo);
      const soc = toNum(e.soc);

      // 1) ระยะที่วิ่งมาตั้งแต่การอ่านครั้งก่อน
      if (state) {
        const km = odo - state.odo;
        const socDrop = state.soc - soc;

        if (km < 0) warn(e.id, 'เลขไมล์น้อยกว่าบันทึกก่อนหน้า');

        if (km > 0) {
          if (socDrop < 0) {
            warn(e.id, 'แบตเพิ่มขึ้นระหว่างวิ่ง (อาจลืมบันทึกการชาร์จ) จึงไม่นำมาคิดอัตราการใช้ไฟ');
          }
          const valid = socDrop >= 0 && cap > 0;
          const kwh = cap > 0 ? (socDrop / 100) * cap : null;
          segments.push({
            id: e.id,
            km,
            socDrop,
            kwh,
            mode: e.mode || '',
            valid,
            consumption: valid ? (kwh / km) * 100 : null, // kWh / 100 km
          });
        }
      }

      // 2) การชาร์จ (ถ้า entry นี้เป็นการชาร์จ)
      if (e.event === 'charge') {
        const socAfter = toNum(e.socAfter);
        const kwhIn = toNum(e.kwh);
        const gained = cap > 0 && socAfter !== null ? ((socAfter - soc) / 100) * cap : null;

        if (socAfter !== null && socAfter <= soc) {
          warn(e.id, 'แบตหลังชาร์จต้องมากกว่าก่อนชาร์จ');
        }

        const kwh = kwhIn !== null ? kwhIn : gained;
        const price = priceFor(e.chargerType, settings);
        const costIn = toNum(e.cost);
        const cost =
          costIn !== null ? costIn : kwh !== null && price !== null ? kwh * price : null;

        charges.push({
          id: e.id,
          ts: e.ts,
          odo,
          socBefore: soc,
          socAfter,
          kwh,
          kwhManual: kwhIn !== null,
          gained,
          cost,
          chargerType: e.chargerType || 'home',
        });

        state = { odo, soc: socAfter !== null ? socAfter : soc, ts: e.ts };
      } else {
        state = { odo, soc, ts: e.ts };
      }
    }

    // ---------- สรุปผล ----------
    const totalKm = sum(segments.map((s) => s.km));

    const energySegs = segments.filter((s) => s.valid);
    const energyKm = sum(energySegs.map((s) => s.km));
    const energyKwh = sum(energySegs.map((s) => s.kwh));
    const avgConsumption = energyKm > 0 ? (energyKwh / energyKm) * 100 : null;

    const withCost = charges.filter((c) => c.cost !== null);
    const totalCost = sum(withCost.map((c) => c.cost));
    const chargedKwh = sum(charges.filter((c) => c.kwh !== null).map((c) => c.kwh));

    const pricedCharges = charges.filter((c) => c.cost !== null && c.kwh !== null && c.kwh > 0);
    const avgPricePerKwh = pricedCharges.length
      ? sum(pricedCharges.map((c) => c.cost)) / sum(pricedCharges.map((c) => c.kwh))
      : null;

    const costPerKm = totalKm > 0 && withCost.length ? totalCost / totalKm : null;
    const estCostPerKm =
      avgConsumption !== null && avgPricePerKwh !== null ? (avgConsumption / 100) * avgPricePerKwh : null;

    // ประสิทธิภาพการชาร์จ = พลังงานที่แบตได้รับ / kWh ที่ตู้ชาร์จแจ้ง (เฉพาะที่กรอกเอง)
    const manual = charges.filter((c) => c.kwhManual && c.gained !== null && c.kwh > 0);
    const efficiency = manual.length
      ? sum(manual.map((c) => c.gained)) / sum(manual.map((c) => c.kwh))
      : null;

    const modeMap = {};
    for (const s of energySegs) {
      const key = s.mode || 'ไม่ระบุ';
      const m = (modeMap[key] = modeMap[key] || { mode: key, km: 0, kwh: 0 });
      m.km += s.km;
      m.kwh += s.kwh;
    }
    const byMode = Object.values(modeMap)
      .map((m) => ({ ...m, consumption: m.km > 0 ? (m.kwh / m.km) * 100 : null }))
      .sort((a, b) => b.km - a.km);

    const segmentsById = {};
    for (const s of segments) segmentsById[s.id] = s;
    const chargesById = {};
    for (const c of charges) chargesById[c.id] = c;

    return {
      segments,
      charges,
      warnings,
      segmentsById,
      chargesById,
      byMode,
      totals: {
        totalKm,
        energyKm,
        energyKwh,
        avgConsumption,
        chargedKwh,
        totalCost,
        missingCost: charges.length - withCost.length,
        avgPricePerKwh,
        costPerKm,
        estCostPerKm,
        efficiency,
        chargeCount: charges.length,
      },
    };
  }

  return { analyze, priceFor, toNum };
});
