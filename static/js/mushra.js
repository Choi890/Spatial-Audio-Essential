"use strict";

const referenceInput = document.querySelector("#reference-file");
const spatialInput = document.querySelector("#spatial-file");
const candidates = document.querySelector("#candidates");
const saveButton = document.querySelector("#save");
let session = null;
let activeAudio = null;

document.querySelector("#prepare").addEventListener("click", () => prepareSession().catch(showMushraError));
saveButton.addEventListener("click", saveSession);

async function prepareSession() {
  if (!referenceInput.files[0] || !spatialInput.files[0]) {
    candidates.textContent = "Original과 Full Spatial 파일을 모두 선택하세요.";
    return;
  }
  if (activeAudio) activeAudio.pause();
  const anchorFile = await createLowpassAnchor(referenceInput.files[0]);
  const records = [
    { id: crypto.randomUUID(), kind: "reference", file: referenceInput.files[0] },
    { id: crypto.randomUUID(), kind: "hidden-reference", file: referenceInput.files[0] },
    { id: crypto.randomUUID(), kind: "spatial", file: spatialInput.files[0] },
    { id: crypto.randomUUID(), kind: "anchor-3.5khz", file: anchorFile }
  ].sort(() => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32 - 0.5);
  session = {
    schema: "SpatialAudioEssential.ListeningTest/2.0",
    sessionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    records
  };
  candidates.replaceChildren(...records.map((record, index) => makeCard(record, index)));
  saveButton.disabled = false;
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
  const audio = new Audio(URL.createObjectURL(record.file));
  play.addEventListener("click", () => {
    if (activeAudio && activeAudio !== audio) activeAudio.pause();
    if (audio.paused) { activeAudio = audio; audio.play(); } else { audio.pause(); }
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
    samples: session.records.map((record, index) => ({
      blindLabel: String.fromCharCode(65 + index),
      source: record.kind,
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
  candidates.textContent = error?.message || "청감 테스트 세션을 만들지 못했습니다.";
}
