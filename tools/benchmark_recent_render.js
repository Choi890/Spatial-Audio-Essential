const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium } = require("@playwright/test");

const projectRoot = path.resolve(__dirname, "..");
const serverUrl = process.env.SPATIAL_AUDIO_URL || "http://127.0.0.1:8768";
const cacheDir = path.join(projectRoot, "data", "outputs", "_cache", "analysis");
const artifactDir = path.join(projectRoot, "data", "outputs", "_benchmarks");

function latestAnalysisPath() {
  const entries = fs.readdirSync(cacheDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const filePath = path.join(cacheDir, name);
      return { filePath, modifiedMs: fs.statSync(filePath).mtimeMs };
    })
    .sort((left, right) => right.modifiedMs - left.modifiedMs);
  if (!entries.length) throw new Error(`No cached analyses found in ${cacheDir}`);
  return entries[0].filePath;
}

function sampleProcessTree(rootPid) {
  const script = [
    `$rootPid = ${Number(rootPid)}`,
    "$processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)",
    "$ids = [System.Collections.Generic.HashSet[int]]::new()",
    "$null = $ids.Add($rootPid)",
    "do {",
    "  $added = $false",
    "  foreach ($item in $processes) {",
    "    if ($ids.Contains([int]$item.ParentProcessId) -and -not $ids.Contains([int]$item.ProcessId)) {",
    "      $null = $ids.Add([int]$item.ProcessId)",
    "      $added = $true",
    "    }",
    "  }",
    "} while ($added)",
    "$cpu = 0.0",
    "$workingSet = 0L",
    "$privateMemory = 0L",
    "$count = 0",
    "foreach ($idValue in $ids) {",
    "  $process = Get-Process -Id $idValue -ErrorAction SilentlyContinue",
    "  if ($process) {",
    "    if ($null -ne $process.CPU) { $cpu += [double]$process.CPU }",
    "    $workingSet += [long]$process.WorkingSet64",
    "    $privateMemory += [long]$process.PrivateMemorySize64",
    "    $count += 1",
    "  }",
    "}",
    "[pscustomobject]@{cpuSeconds=$cpu;workingSetBytes=$workingSet;privateBytes=$privateMemory;processCount=$count} | ConvertTo-Json -Compress"
  ].join("\n");
  return JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true
  }));
}

async function monitorPromise(promise, rootPid, intervalMs = 500) {
  const samples = [];
  const startedAt = performance.now();
  const capture = () => {
    try {
      samples.push({ elapsedMs: performance.now() - startedAt, ...sampleProcessTree(rootPid) });
    } catch (error) {
      samples.push({ elapsedMs: performance.now() - startedAt, sampleError: error.message });
    }
  };
  capture();
  const timer = setInterval(capture, intervalMs);
  let value;
  try {
    value = await promise;
  } finally {
    clearInterval(timer);
    capture();
  }
  const valid = samples.filter((sample) => Number.isFinite(sample.cpuSeconds));
  const first = valid[0];
  const last = valid[valid.length - 1];
  let peakCoreEquivalentPercent = 0;
  for (let index = 1; index < valid.length; index += 1) {
    const wallSeconds = (valid[index].elapsedMs - valid[index - 1].elapsedMs) / 1000;
    const cpuSeconds = valid[index].cpuSeconds - valid[index - 1].cpuSeconds;
    if (wallSeconds > 0) {
      peakCoreEquivalentPercent = Math.max(peakCoreEquivalentPercent, cpuSeconds / wallSeconds * 100);
    }
  }
  const wallSeconds = Math.max(0.001, (last.elapsedMs - first.elapsedMs) / 1000);
  const cpuSeconds = Math.max(0, last.cpuSeconds - first.cpuSeconds);
  const logicalCores = os.cpus().length;
  return {
    value,
    load: {
      wallSeconds: Number(wallSeconds.toFixed(3)),
      cpuSeconds: Number(cpuSeconds.toFixed(3)),
      averageCoreEquivalentPercent: Number((cpuSeconds / wallSeconds * 100).toFixed(1)),
      peakCoreEquivalentPercent: Number(peakCoreEquivalentPercent.toFixed(1)),
      averageMachineCpuPercent: Number((cpuSeconds / wallSeconds / logicalCores * 100).toFixed(2)),
      peakMachineCpuPercent: Number((peakCoreEquivalentPercent / logicalCores).toFixed(2)),
      baselineWorkingSetMiB: Number((first.workingSetBytes / 1048576).toFixed(1)),
      peakWorkingSetMiB: Number((Math.max(...valid.map((sample) => sample.workingSetBytes)) / 1048576).toFixed(1)),
      peakPrivateMemoryMiB: Number((Math.max(...valid.map((sample) => sample.privateBytes)) / 1048576).toFixed(1)),
      maxProcessCount: Math.max(...valid.map((sample) => sample.processCount)),
      sampleCount: valid.length,
      logicalCores
    }
  };
}

function sha256(filePath) {
  const digest = crypto.createHash("sha256");
  digest.update(fs.readFileSync(filePath));
  return digest.digest("hex");
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const analysisPath = latestAnalysisPath();
  const analysisFile = path.basename(analysisPath);
  const analysis = JSON.parse(fs.readFileSync(analysisPath, "utf8"));
  const browserServer = await chromium.launchServer({
    channel: "chrome",
    headless: true,
    args: ["--autoplay-policy=no-user-gesture-required"]
  });
  const browserRootPid = browserServer.process().pid;
  const browser = await chromium.connect(browserServer.wsEndpoint());
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    const navigationStarted = performance.now();
    const response = await page.goto(serverUrl, { waitUntil: "networkidle" });
    if (!response || !response.ok()) throw new Error(`Application navigation failed: ${response?.status()}`);
    const navigationMs = performance.now() - navigationStarted;

    const preparation = await page.evaluate(async ({ analysisFile }) => {
      const preparationStarted = performance.now();
      const response = await fetch(`/outputs/_cache/analysis/${analysisFile}`);
      if (!response.ok) throw new Error(`Analysis cache load failed: ${response.status}`);
      const analysis = await response.json();
      await ensureUniversalHrtfProfile();
      const audioContext = await ensureAudioContext();
      await ensureMeasuredBrirBuffer(audioContext);
      const stemItems = getDemucsStemItems(analysis);
      const decoded = await Promise.all(stemItems.map(async (stem) => {
        const stemResponse = await fetch(`/outputs/${stem.path}`);
        if (!stemResponse.ok) throw new Error(`${stem.id} load failed: ${stemResponse.status}`);
        const bytes = await stemResponse.arrayBuffer();
        const buffer = await audioContext.decodeAudioData(bytes);
        return { ...stem, buffer, alignmentSamples: 0, alignmentOffsetSeconds: 0 };
      }));
      const coreIds = ["vocals", "drums", "bass", "other"];
      if (coreIds.some((id) => !decoded.some((stem) => stem.id === id))) {
        throw new Error(`Missing core stems: ${decoded.map((stem) => stem.id).join(", ")}`);
      }
      const sampleRate = decoded[0].buffer.sampleRate;
      const frameCount = Math.min(...decoded.map((stem) => stem.buffer.length));
      // Accepted auxiliary stems are subtracted from other before post-processing.
      // Include every final stem; independent masking makes this an approximation.
      const mix = audioContext.createBuffer(2, frameCount, sampleRate);
      for (let channel = 0; channel < 2; channel += 1) {
        const target = mix.getChannelData(channel);
        decoded.forEach((stem) => {
          const source = stem.buffer.getChannelData(Math.min(channel, stem.buffer.numberOfChannels - 1));
          for (let frame = 0; frame < frameCount; frame += 1) target[frame] += source[frame];
        });
      }
      state.file = { name: analysis.file?.name || "recent-render.wav" };
      state.analysis = analysis;
      state.audioBuffer = mix;
      state.stemBuffers = Object.fromEntries(decoded.map((stem) => [stem.id, stem]));
      state.playbackCalibration = analyzeAudioBufferCalibration(mix, analysis);
      state.spatialOutputCalibration = null;
      state.audioQualityTier = "full";
      updateSpatialSettingsFromAnalysis(analysis);
      const calibrationStarted = performance.now();
      state.spatialOutputCalibration = await calibrateSpatialProcessedOutput(mix, analysis, { fast: true });
      const calibrationMs = performance.now() - calibrationStarted;
      return {
        calibrationMs,
        preparationMs: performance.now() - preparationStarted,
        sourceName: state.file.name,
        durationSeconds: mix.duration,
        sampleRate,
        channels: mix.numberOfChannels,
        stems: decoded.map((stem) => stem.id),
        qualityTier: state.audioQualityTier,
        hrtfProfile: state.hrtfProfileId,
        brirProfile: state.brirProfileId
      };
    }, { analysisFile });

    const renderPromise = page.evaluate(async () => {
      const buffer = state.audioBuffer;
      const tailSeconds = audioRenderer.hasMeasuredBrirLibrary() ? 3.2 : 1.8;
      const frameCount = Math.ceil((buffer.duration + tailSeconds) * buffer.sampleRate);
      const context = new OfflineAudioContext(2, frameCount, buffer.sampleRate);
      const graph = createSpatialPlaybackGraph(context, buffer, state.analysis, { visualMeters: false });
      const graphMetrics = {
        stemCount: graph.spatialLayer.stemObjects.length,
        externalizationTaps: graph.spatialLayer.externalization.taps.length,
        orchestralTaps: graph.spatialLayer.orchestralHall.taps.length,
        lateEnvelopmentTaps: graph.spatialLayer.lateEnvelopment.taps.length,
        usesMeasuredBrir: Boolean(graph.spatialLayer.venueTail?.nodes?.length),
        qualityTier: graph.spatialLayer.audioQuality.id
      };
      startGraphSources(graph, 0);
      const startedAt = performance.now();
      const rendered = await context.startRendering();
      const renderMs = performance.now() - startedAt;
      let peak = 0;
      let energy = 0;
      let finite = true;
      for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
        const data = rendered.getChannelData(channel);
        for (let index = 0; index < data.length; index += 1) {
          const sample = data[index];
          finite = finite && Number.isFinite(sample);
          peak = Math.max(peak, Math.abs(sample));
          energy += sample * sample;
        }
      }
      window.__benchmarkRendered = rendered;
      disconnectGraph(graph);
      return {
        renderMs,
        renderedDurationSeconds: rendered.duration,
        renderedFrames: rendered.length,
        renderedChannels: rendered.numberOfChannels,
        realtimeFactor: buffer.duration / (renderMs / 1000),
        peak,
        rms: Math.sqrt(energy / (rendered.length * rendered.numberOfChannels)),
        finite,
        graph: graphMetrics
      };
    });
    const monitoredRender = await monitorPromise(renderPromise, browserRootPid);

    const outputName = `recent-full-spatial-${Date.now()}.wav`;
    const outputPath = path.join(artifactDir, outputName);
    const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
    const finalizePromise = page.evaluate(async ({ outputName }) => {
      const startedAt = performance.now();
      const rendered = window.__benchmarkRendered;
      if (!rendered) throw new Error("Rendered audio buffer is missing");
      let stageStarted = performance.now();
      const meterBlob = await encodeWaveBlobAsync(rendered, { bitDepth: 32, float: true, gain: 1 });
      const meterEncodingMs = performance.now() - stageStarted;
      stageStarted = performance.now();
      const response = await fetch(`/api/measure-output?filename=${encodeURIComponent(outputName)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: meterBlob
      });
      if (!response.ok) throw new Error(`Output measurement failed: ${response.status} ${await response.text()}`);
      const measurement = await response.json();
      const meterRequestMs = performance.now() - stageStarted;
      const truePeakDb = Number(measurement.estimatedTruePeakDb);
      const finalGain = Number.isFinite(truePeakDb) && truePeakDb > -1
        ? Math.pow(10, (-1 - truePeakDb) / 20)
        : 1;
      stageStarted = performance.now();
      const outputBlob = await encodeWaveBlobAsync(rendered, { bitDepth: 24, float: false, gain: finalGain });
      const outputEncodingMs = performance.now() - stageStarted;
      stageStarted = performance.now();
      const finalMeterResponse = await fetch(`/api/measure-output?filename=${encodeURIComponent(outputName)}`, {
        method: "POST",
        headers: { "Content-Type": "audio/wav" },
        body: outputBlob
      });
      if (!finalMeterResponse.ok) {
        throw new Error(`Final output verification failed: ${finalMeterResponse.status} ${await finalMeterResponse.text()}`);
      }
      const finalMeasurement = await finalMeterResponse.json();
      const verificationRequestMs = performance.now() - stageStarted;
      downloadBlob(outputBlob, outputName);
      delete window.__benchmarkRendered;
      return {
        finalizeMs: performance.now() - startedAt,
        meterEncodingMs, meterRequestMs, outputEncodingMs, verificationRequestMs,
        meterUploadBytes: meterBlob.size,
        outputBytes: outputBlob.size,
        finalGain,
        measurement,
        finalMeasurement
      };
    }, { outputName });
    const [download, finalized] = await Promise.all([downloadPromise, finalizePromise]);
    await download.saveAs(outputPath);

    const result = {
      benchmarkVersion: 2,
      inputKind: "sum-of-final-stems; processed reconstruction, not the original mix",
      measuredAt: new Date().toISOString(),
      applicationUrl: serverUrl,
      analysisCache: path.relative(projectRoot, analysisPath),
      navigationMs: Number(navigationMs.toFixed(1)),
      preparation: {
        ...preparation,
        preparationMs: Number(preparation.preparationMs.toFixed(1))
      },
      render: {
        ...monitoredRender.value,
        renderMs: Number(monitoredRender.value.renderMs.toFixed(1)),
        realtimeFactor: Number(monitoredRender.value.realtimeFactor.toFixed(2)),
        peak: Number(monitoredRender.value.peak.toFixed(6)),
        rms: Number(monitoredRender.value.rms.toFixed(6)),
        load: monitoredRender.load
      },
      finalize: {
        ...finalized,
        finalizeMs: Number(finalized.finalizeMs.toFixed(1))
      },
      output: {
        path: path.relative(projectRoot, outputPath),
        bytes: fs.statSync(outputPath).size,
        sha256: sha256(outputPath)
      },
      errors: consoleErrors
    };
    const resultPath = path.join(artifactDir, "latest-render-benchmark.json");
    fs.writeFileSync(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.render.finite || result.errors.length) process.exitCode = 1;
  } finally {
    await context.close();
    await browser.close();
    await browserServer.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
