"use strict";

const referenceInput = document.querySelector("#reference-file");
const spatialInput = document.querySelector("#spatial-file");
const candidates = document.querySelector("#candidates");
const saveButton = document.querySelector("#save");
let session = null;
let activeAudio = null;
const prepareButton = document.querySelector("#prepare");
const sessionStatus = document.querySelector("#session-status");

document.querySelector("#prepare").addEventListener("click", () => prepareSession().catch(showMushraError));
saveButton.addEventListener("click", saveSession);

async function prepareSession() {
  if (!referenceInput.files[0] || !spatialInput.files[0]) {
    disposeSession();
    saveButton.disabled = true;
    sessionStatus.textContent = "Original과 Full Spatial 파일을 모두 선택하세요.";
    return;
  }
  prepareButton.disabled = true;
  saveButton.disabled = true;
  disposeSession();
  const inputs = [...document.querySelectorAll('input[type="file"], #eq-condition')];
  for (const input of inputs) input.disabled = true;
  sessionStatus.textContent = "파일 음량과 길이를 측정하고 있습니다…";
  try {
    const anchorFile = await createLowpassAnchor(referenceInput.files[0]);
    const records = [
      { id: crypto.randomUUID(), kind: "reference", file: referenceInput.files[0] },
      { id: crypto.randomUUID(), kind: "hidden-reference", file: referenceInput.files[0] },
      { id: crypto.randomUUID(), kind: "spatial", file: spatialInput.files[0] },
      { id: crypto.randomUUID(), kind: "anchor-3.5khz", file: anchorFile }
    ];
    for (const [inputId, kind] of [["fullmix-file", "fullmix-spatial"], ["stems-file", "stem-spatial"]]) {
      const file = document.querySelector(`#${inputId}`).files[0];
      if (file) records.push({ id: crypto.randomUUID(), kind, file });
    }
    const measurements = new Map();
    for (const record of records) {
      if (!measurements.has(record.file)) measurements.set(record.file, await measureListeningFile(record.file));
      record.measurement = measurements.get(record.file);
    }
    const referenceDuration = records[0].measurement.duration;
    if (records.some(record => Math.abs(record.measurement.duration - referenceDuration) > 0.05)) {
      throw new Error("동일한 시작점과 길이의 WAV 구간을 준비하세요. 파일 길이 차이가 50ms를 넘습니다.");
    }
    // Only attenuate: match LUFS and leave at least 1 dB estimated true-peak headroom.
    const targetLufs = Math.min(...records.map(record => Math.min(
      record.measurement.integratedLufs,
      record.measurement.integratedLufs - 1 - record.measurement.estimatedTruePeakDb
    )));
    for (const record of records) record.gainDb = targetLufs - record.measurement.integratedLufs;
    for (let index = records.length - 1; index > 0; index -= 1) {
      const other = Math.floor(crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 * (index + 1));
      [records[index], records[other]] = [records[other], records[index]];
    }
    session = {
      schema: "SpatialAudioEssential.ListeningTest/3.0",
      sessionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      targetLufs,
      eqCondition: document.querySelector("#eq-condition").value,
      records
    };
    candidates.replaceChildren(...records.map((record, index) => makeCard(record, index)));
    saveButton.disabled = false;
    sessionStatus.textContent = `음량 일치: ${targetLufs.toFixed(2)} LUFS-I · 전환 시 재생 위치 유지 · EQ는 입력 파일의 설정을 사용합니다.`;
  } finally {
    prepareButton.disabled = false;
    for (const input of inputs) input.disabled = false;
  }
}

async function measureListeningFile(file) {
  const response = await fetch(`/api/measure-output?filename=${encodeURIComponent(file.name)}`, {
    method: "POST", headers: { "Content-Type": "audio/wav" }, body: file
  });
  if (!response.ok) throw new Error("WAV 음량 측정에 실패했습니다. WAV 파일과 서버 연결을 확인하세요.");
  const measurement = await response.json();
  if (![measurement.integratedLufs, measurement.estimatedTruePeakDb, measurement.duration].every(Number.isFinite)
      || measurement.integratedLufs <= -70 || measurement.duration < 0.4) {
    throw new Error("음량을 비교할 수 있는 0.4초 이상의 무음이 아닌 구간을 준비하세요.");
  }
  return measurement;
}

function disposeSession() {
  if (activeAudio) activeAudio.pause();
  activeAudio = null;
  for (const record of session?.records || []) {
    record.audio?.pause();
    if (record.url) URL.revokeObjectURL(record.url);
  }
  session = null;
  candidates.replaceChildren();
}

function makeCard(record, index) {
  const card = document.createElement("article");
  card.className = "evaluation-card";
  const title = document.createElement("h2");
  title.textContent = `Sample ${String.fromCharCode(65 + index)}`;
  const play = document.createElement("button");
  play.className = "ghost-button";
  play.type = "button";
  play.textContent = "재생 / 정지";
  record.url = URL.createObjectURL(record.file);
  const audio = new Audio(record.url);
  record.audio = audio;
  audio.preload = "auto";
  audio.volume = Math.min(1, 10 ** (record.gainDb / 20));
  play.addEventListener("click", async () => {
    try {
      const position = activeAudio?.currentTime || 0;
      if (activeAudio && activeAudio !== audio) activeAudio.pause();
      if (audio.paused) {
        audio.currentTime = position >= record.measurement.duration ? 0 : position;
        activeAudio = audio;
        await audio.play();
      } else { audio.pause(); }
    } catch (error) { sessionStatus.textContent = error.message; }
  });
  card.append(title, play);
  for (const [key, label] of [["externalization","외재화"],["width","좌우 폭"],["depth","앞뒤 깊이"],["timbre","음색 보존"],["artifacts","무왜곡/무아티팩트"]]) {
    const wrapper = document.createElement("label");
    wrapper.append(document.createTextNode(`${label}: 50`));
    const slider = document.createElement("input");
    slider.type = "range"; slider.min = "0"; slider.max = "100"; slider.value = "50";
    slider.dataset.metric = key;
    slider.addEventListener("input", () => { wrapper.firstChild.textContent = `${label}: ${slider.value}`; });
    wrapper.append(slider); card.append(wrapper);
  }
  record.card = card;
  return card;
}

function saveSession() {
  if (!session) return;
  const result = {
    schema: session.schema,
    sessionId: session.sessionId,
    createdAt: session.createdAt,
    completedAt: new Date().toISOString(),
    targetLufs: session.targetLufs,
    eqCondition: session.eqCondition,
    levelMatching: "BS.1770 integrated LUFS; attenuation only; estimated peak <= -1 dBTP",
    samples: session.records.map((record, index) => ({
      blindLabel: String.fromCharCode(65 + index),
      source: record.kind,
      filename: record.file.name,
      measurement: record.measurement,
      gainDb: record.gainDb,
      scores: Object.fromEntries([...record.card.querySelectorAll("input[type=range]")].map(input => [input.dataset.metric, Number(input.value)]))
    }))
  };
  persistListeningTestResult(result);
  const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: "application/json" }));
  const link = document.createElement("a"); link.href = url; link.download = "spatial-listening-test.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function createLowpassAnchor(file) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const decodeContext = new AudioContextClass();
  try {
    const decoded = await decodeContext.decodeAudioData((await file.arrayBuffer()).slice(0));
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const context = new OfflineContext(2, decoded.length, decoded.sampleRate);
    const source = context.createBufferSource();
    const lowpass = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = decoded;
    lowpass.type = "lowpass";
    lowpass.frequency.value = 3500;
    lowpass.Q.value = 0.707;
    gain.gain.value = 0.9;
    source.connect(lowpass).connect(gain).connect(context.destination);
    source.start();
    const rendered = await context.startRendering();
    return new File([encodeMushraWave(rendered)], "hidden-anchor-3.5khz.wav", { type: "audio/wav" });
  } finally {
    decodeContext.close().catch(() => {});
  }
}

function encodeMushraWave(buffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  const bytes = new ArrayBuffer(44 + buffer.length * channels * 2);
  const view = new DataView(bytes);
  const ascii = (offset, value) => [...value].forEach((character, index) => view.setUint8(offset + index, character.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, buffer.length * channels * 2, true);
  let offset = 44;
  for (let frame = 0; frame < buffer.length; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[frame] || 0));
      view.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      offset += 2;
    }
  }
  return bytes;
}

function persistListeningTestResult(result) {
  try {
    const key = "spatial-audio-essential-listening-history";
    const history = JSON.parse(localStorage.getItem(key) || "[]");
    history.unshift(result);
    localStorage.setItem(key, JSON.stringify(history.slice(0, 50)));
  } catch {
    // 브라우저 저장소가 차단돼도 JSON 다운로드는 유지한다.
  }
}

function showMushraError(error) {
  console.error(error);
  disposeSession();
  saveButton.disabled = true;
  sessionStatus.textContent = error?.message || "청감 테스트 세션을 만들지 못했습니다.";
}
