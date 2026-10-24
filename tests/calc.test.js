const test = require('node:test');
const assert = require('node:assert/strict');
const { analyze } = require('../calc.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `expected ${b}, got ${a}`);

const settings = { capacityKwh: 60, homePrice: 5, publicPrice: 9 };

test('ระยะ, kWh และอัตราการใช้ไฟจากไมล์ + แบต%', () => {
  const entries = [
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 1000, soc: 80 },
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'drive', odo: 1100, soc: 70, mode: 'Eco' },
  ];
  const r = analyze(entries, settings);
  assert.equal(r.segments.length, 1);
  const s = r.segments[0];
  assert.equal(s.km, 100);
  near(s.kwh, 6); // 10% ของ 60 kWh
  near(s.consumption, 6); // 6 kWh / 100 km
  assert.equal(s.mode, 'Eco');
  near(r.totals.avgConsumption, 6);
});

test('การชาร์จคำนวณ kWh และค่าไฟจากราคาบ้าน และต่อด้วยการวิ่งครั้งถัดไป', () => {
  const entries = [
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 1000, soc: 80 },
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'drive', odo: 1100, soc: 70, mode: 'Eco' },
    { id: 'c', ts: '2026-10-01T10:00:00Z', event: 'charge', odo: 1100, soc: 70, socAfter: 90, chargerType: 'home' },
    { id: 'd', ts: '2026-10-01T12:00:00Z', event: 'drive', odo: 1200, soc: 80, mode: 'Normal' },
  ];
  const r = analyze(entries, settings);
  const c = r.charges[0];
  near(c.gained, 12); // 20% ของ 60
  near(c.kwh, 12);
  near(c.cost, 60); // 12 kWh * 5 บาท
  assert.equal(r.totals.totalKm, 200);
  near(r.totals.chargedKwh, 12);
  near(r.totals.totalCost, 60);
  near(r.totals.costPerKm, 0.3);
  near(r.totals.avgPricePerKwh, 5);
  near(r.totals.estCostPerKm, 0.3); // 6 kWh/100km * 5 บาท
  assert.equal(r.byMode.length, 2);
});

test('ชาร์จสาธารณะ + kWh ที่ตู้แจ้งเอง คิดประสิทธิภาพการชาร์จได้', () => {
  const entries = [
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 1000, soc: 50 },
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'charge', odo: 1000, soc: 50, socAfter: 70, kwh: 24, cost: 216, chargerType: 'public' },
  ];
  const r = analyze(entries, settings);
  near(r.charges[0].gained, 12);
  near(r.charges[0].cost, 216); // ใช้ค่าที่กรอกเอง ไม่ใช่ราคาคำนวณ
  near(r.totals.efficiency, 0.5); // 12 / 24
});

test('เลขไมล์ลดลง และแบตเพิ่มขึ้นระหว่างวิ่ง ต้องมีคำเตือนและไม่นับอัตราการใช้ไฟ', () => {
  const entries = [
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 1000, soc: 80 },
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'drive', odo: 1100, soc: 85 }, // แบตเพิ่ม ทั้งที่วิ่ง
    { id: 'c', ts: '2026-10-01T10:00:00Z', event: 'drive', odo: 1050, soc: 80 }, // ไมล์ลด
  ];
  const r = analyze(entries, settings);
  assert.ok(r.warnings.b && r.warnings.b.length, 'ควรมีคำเตือนที่ b');
  assert.ok(r.warnings.c && r.warnings.c.length, 'ควรมีคำเตือนที่ c');
  assert.equal(r.totals.avgConsumption, null);
});

test('ไม่มีความจุแบต: ระยะยังคำนวณได้ แต่ kWh เป็น null', () => {
  const entries = [
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 0, soc: 100 },
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'drive', odo: 50, soc: 90 },
  ];
  const r = analyze(entries, {});
  assert.equal(r.totals.totalKm, 50);
  assert.equal(r.segments[0].kwh, null);
  assert.equal(r.totals.avgConsumption, null);
});

test('เรียงตามเวลาแม้บันทึกเข้ามาไม่เรียง', () => {
  const entries = [
    { id: 'b', ts: '2026-10-01T09:00:00Z', event: 'drive', odo: 1100, soc: 70 },
    { id: 'a', ts: '2026-10-01T08:00:00Z', event: 'start', odo: 1000, soc: 80 },
  ];
  const r = analyze(entries, settings);
  assert.equal(r.segments[0].km, 100);
});
