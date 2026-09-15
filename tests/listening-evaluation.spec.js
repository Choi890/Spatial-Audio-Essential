const { test, expect } = require('@playwright/test');

function wave(seconds = 1, amplitude = 0.1) {
  const samples = Math.round(48000 * seconds);
  const data = Buffer.alloc(44 + samples * 4);
  data.write('RIFF', 0); data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22);
  data.writeUInt32LE(48000, 24); data.writeUInt32LE(192000, 28);
  data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(32767 * amplitude * Math.sin(2 * Math.PI * 1000 * i / 48000));
    data.writeInt16LE(value, 44 + i * 4); data.writeInt16LE(value, 46 + i * 4);
  }
  return { name: 'fixture.wav', mimeType: 'audio/wav', buffer: data };
}

test('measures, matches and switches a six-condition listening session', async ({ page }) => {
  await page.goto('/mushra');
  await page.locator('#reference-file').setInputFiles(wave(2, 0.1));
  await page.locator('#spatial-file').setInputFiles(wave(2, 0.2));
  await page.locator('#fullmix-file').setInputFiles(wave(2, 0.15));
  await page.locator('#stems-file').setInputFiles(wave(2, 0.12));
  await page.locator('#prepare').click();
  await expect(page.locator('.evaluation-card')).toHaveCount(6);
  await expect(page.locator('#save')).toBeEnabled();
  const levels = await page.evaluate(() => session.records.map(record => ({
    level: record.measurement.integratedLufs + 20 * Math.log10(record.audio.volume),
    target: session.targetLufs, gain: record.gainDb,
    peak: record.measurement.estimatedTruePeakDb + record.gainDb
  })));
  for (const level of levels) {
    expect(level.level).toBeCloseTo(level.target, 2);
    expect(level.gain).toBeLessThanOrEqual(0);
    expect(level.peak).toBeLessThanOrEqual(-1);
  }
  await page.waitForFunction(() => session.records.every(record => record.audio.readyState >= 1));
  await page.locator('.evaluation-card button').nth(0).click();
  await page.evaluate(() => { activeAudio.pause(); activeAudio.currentTime = 0.5; });
  await page.locator('.evaluation-card button').nth(1).click();
  const position = await page.evaluate(() => activeAudio.currentTime);
  expect(position).toBeGreaterThanOrEqual(0.49);
  expect(position).toBeLessThan(1.2);
  await page.locator('#save').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('spatial-audio-essential-listening-history'))[0]);
  expect(saved.schema).toBe('SpatialAudioEssential.ListeningTest/3.0');
  expect(saved.samples).toHaveLength(6);
  expect(saved.eqCondition).toBe('off');
  expect(saved.samples.every(sample => Number.isFinite(sample.gainDb))).toBe(true);
});

test('rejects mismatched excerpts and keeps save disabled', async ({ page }) => {
  await page.goto('/mushra');
  await page.locator('#reference-file').setInputFiles(wave(1));
  await page.locator('#spatial-file').setInputFiles(wave(2));
  await page.locator('#prepare').click();
  await expect(page.locator('#session-status')).toContainText('50ms');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('.evaluation-card')).toHaveCount(0);
  await expect(page.locator('#prepare')).toBeEnabled();
});

test('does not start an unmeasured session when the meter is unavailable', async ({ page }) => {
  await page.goto('/mushra');
  await page.route('**/api/measure-output?**', route => route.fulfill({ status: 503, body: '{}' }));
  await page.locator('#reference-file').setInputFiles(wave());
  await page.locator('#spatial-file').setInputFiles(wave());
  await page.locator('#prepare').click();
  await expect(page.locator('#session-status')).toContainText('측정에 실패');
  await expect(page.locator('#save')).toBeDisabled();
  await expect(page.locator('#prepare')).toBeEnabled();
});
