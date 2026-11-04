(function (global) {
  "use strict";
  function createTransport(hooks) {
    const { clamp } = global.SpatialAudioUtils || {
      clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    };
    const clock = hooks.clock || global;
    const state = {
      mode: "spatial",
      playing: false,
      desired: false,
      commandRevision: 0,
      transitionRevision: 0,
      startedAt: 0,
      offset: 0,
      graph: null,
      output: null,
      graphs: new Map(),
    };

    async function togglePlayback() {
      const shouldPlay = !(state.desired || state.playing);
      state.desired = shouldPlay;
      const requestRevision = ++state.commandRevision;
      if (!shouldPlay) {
        if (!state.playing) return;
        const time = getPlaybackTime();
        stopPlayback({ keepOffset: true });
        state.offset = time;
        return;
      }
      await startPlayback({ requestRevision });
    }

    async function startPlayback(options = {}) {
      if (!hooks.readTrack().audioBuffer || !hooks.readTrack().analysis) return;
      const buffer = hooks.readTrack().audioBuffer;
      const analysis = hooks.readTrack().analysis;
      let requestRevision = Number(options.requestRevision);
      if (!Number.isFinite(requestRevision)) {
        state.desired = true;
        requestRevision = ++state.commandRevision;
      }
      const context = await hooks.ensureContext();
      const isCurrent = () =>
        state.desired &&
        requestRevision === state.commandRevision &&
        buffer === hooks.readTrack().audioBuffer &&
        analysis === hooks.readTrack().analysis;
      if (!isCurrent()) return;
      stopPlayback({ keepOffset: true, silent: true, preserveIntent: true });
      if (!isCurrent()) return;
      hooks.onPrepare?.();

      const graph = hooks.createGraph(context, hooks.readTrack().audioBuffer, hooks.readTrack().analysis, state.mode);
      state.graph = graph;
      const safeOffset = clamp(state.offset, 0, Math.max(0, hooks.readTrack().audioBuffer.duration - 0.02));
      const startAt = context.currentTime + 0.015;
      state.startedAt = startAt - safeOffset;
      state.playing = true;
      try {
        if (graph.master) {
          graph.master.gain.cancelScheduledValues(context.currentTime);
          graph.master.gain.setValueAtTime(0, context.currentTime);
          scheduleGraphGainCurve(graph, 0, getGraphTargetGain(graph), startAt, 0.035, "in", "equalPower");
        }
        hooks.startSources(
          graph,
          safeOffset,
          () => {
            if (
              state.playing &&
              state.graph === graph &&
              getPlaybackTime() >= hooks.readTrack().audioBuffer.duration - 0.05
            ) {
              stopPlayback();
            }
          },
          startAt,
        );
        setPlaybackOutputEnabled(true);
      } catch (error) {
        stopPlayback({ keepOffset: true, silent: true });
        throw error;
      }
      hooks.onStart?.();
    }

    async function crossfadePlaybackMode(time) {
      if (!hooks.readTrack().audioBuffer || !hooks.readTrack().analysis || !state.playing) return;
      const revision = ++state.transitionRevision;
      const commandRevision = state.commandRevision;
      const buffer = hooks.readTrack().audioBuffer;
      const analysis = hooks.readTrack().analysis;
      const mode = state.mode;
      const isCurrent = () =>
        revision === state.transitionRevision &&
        commandRevision === state.commandRevision &&
        state.playing &&
        buffer === hooks.readTrack().audioBuffer &&
        analysis === hooks.readTrack().analysis &&
        mode === state.mode;
      let context;
      try {
        context = await hooks.ensureContext();
      } catch (error) {
        if (isCurrent()) throw error;
        return;
      }
      if (!isCurrent()) return;
      // An unrelated offline render must never hold up a requested mode change.
      const oldGraph = state.graph;
      const newGraph = hooks.createGraph(context, buffer, analysis, mode);
      time = getPlaybackTime();
      const safeOffset = clamp(time, 0, Math.max(0, hooks.readTrack().audioBuffer.duration - 0.02));
      const now = context.currentTime;
      const scheduleLead = getModeSwitchScheduleLead(context);
      const startAt = now + scheduleLead;
      const preRoll =
        newGraph.mode === "spatial" ? Math.min(0.08, Math.max(0, scheduleLead - 0.015)) : 0;
      newGraph.transitionPreRollSeconds = preRoll;
      newGraph.transitionScheduleLeadSeconds = scheduleLead;
      const sourceStartAt = startAt - preRoll;
      const sourceOffset = clamp(
        safeOffset + Math.max(0, sourceStartAt - now),
        0,
        Math.max(0, hooks.readTrack().audioBuffer.duration - 0.02),
      );
      const fadeSeconds = mode === "spatial" ? 0.42 : 0.34;
      const targetGain = getGraphTargetGain(newGraph);
      const incomingStartGain = 0;

      try {
        if (newGraph.master) {
          newGraph.master.gain.cancelScheduledValues(now);
          newGraph.master.gain.setValueAtTime(0, now);
          newGraph.crossfadeUntil = startAt + fadeSeconds;
          scheduleGraphGainCurve(newGraph, incomingStartGain, targetGain, startAt, fadeSeconds, "in", "linear");
        }
        hooks.startSources(
          newGraph,
          sourceOffset,
          () => {
            if (
              state.playing &&
              state.graph === newGraph &&
              getPlaybackTime() >= hooks.readTrack().audioBuffer.duration - 0.05
            ) {
              stopPlayback();
            }
          },
          sourceStartAt,
        );
      } catch (error) {
        disposeGraph(newGraph);
        throw error;
      }
      state.graph = newGraph;
      state.offset = safeOffset;
      state.startedAt = now - safeOffset;

      if (oldGraph && oldGraph.master) {
        try {
          scheduleGraphGainCurve(
            oldGraph,
            getGraphCurrentGain(oldGraph, context.currentTime),
            0,
            startAt,
            fadeSeconds,
            "out",
            "linear",
          );
          retireGraphAfterFade(oldGraph, scheduleLead + fadeSeconds);
        } catch (error) {
          // A failed outgoing automation must not leave the old mode audible.
          disposeGraph(oldGraph);
        }
      } else if (oldGraph) {
        retireGraphAfterFade(oldGraph, 0);
      }
    }

    function getModeSwitchScheduleLead(context) {
      const latency = context && Number.isFinite(context.baseLatency) ? context.baseLatency : 0.012;
      return clamp(latency * 4, 0.09, 0.16);
    }

    function startGraphSources(graph, offset, onEnded, startAt = 0) {
      const sources = graph.sources || [graph.source];
      sources.forEach((source) => {
        if (!source) return;
        const when = Number.isFinite(startAt) && startAt > 0 ? startAt : 0;
        if (source.buffer) {
          const alignmentOffset = Number(source.spatialAlignmentOffsetSeconds) || 0;
          const alignedPosition = offset + alignmentOffset;
          const delay = Math.max(0, -alignedPosition);
          const alignedWhen = delay ? Math.max(when, source.context.currentTime) + delay : when;
          const sourceOffset = clamp(alignedPosition, 0, source.buffer.duration);
          source.start(alignedWhen, sourceOffset);
          return;
        }
        source.start(when);
      });
      if (sources[0]) {
        sources[0].onended = onEnded;
      }
    }

    function scheduleGraphGainCurve(graph, fromGain, toGain, now, seconds, direction, curveType = "equalPower") {
      if (!graph || !graph.master) return;
      const gain = graph.master.gain;
      const duration = Math.max(0.04, seconds);
      const from = Number.isFinite(fromGain) ? fromGain : gain.value;
      const to = Number.isFinite(toGain) ? toGain : gain.value;
      const curve =
        curveType === "linear" ? buildLinearGainCurve(from, to) : buildEqualPowerGainCurve(from, to, direction);

      const cancelTime = graph.master.context?.currentTime ?? now;
      const heldGain = getGraphCurrentGain(graph, cancelTime);
      if (typeof gain.cancelAndHoldAtTime === "function") {
        gain.cancelAndHoldAtTime(cancelTime);
      } else {
        gain.cancelScheduledValues(0);
        gain.setValueAtTime(heldGain, cancelTime);
      }
      gain.setValueAtTime(curve[0], now);
      try {
        gain.setValueCurveAtTime(curve, now, duration);
      } catch (curveError) {
        gain.linearRampToValueAtTime(to, now + duration);
      }
      // The curve (or fallback ramp) already ends at the target. An extra
      // scheduled target can overlap a still-active curve during rapid restarts.
      graph.gainAutomation = {
        direction,
        from,
        to,
        startTime: now,
        endTime: now + duration,
        curveType,
      };
    }

    function buildLinearGainCurve(from, to) {
      const points = 64;
      const curve = new Float32Array(points);
      for (let index = 0; index < points; index += 1) {
        const ratio = index / (points - 1);
        curve[index] = from + (to - from) * ratio;
      }
      curve[0] = from;
      curve[points - 1] = to;
      return curve;
    }

    function buildEqualPowerGainCurve(from, to, direction) {
      const points = 64;
      const curve = new Float32Array(points);
      for (let index = 0; index < points; index += 1) {
        const ratio = index / (points - 1);
        if (direction === "out") {
          curve[index] = to + (from - to) * Math.cos(ratio * Math.PI * 0.5);
        } else {
          curve[index] = from + (to - from) * Math.sin(ratio * Math.PI * 0.5);
        }
      }
      curve[0] = from;
      curve[points - 1] = to;
      return curve;
    }

    function getGraphCurrentGain(graph, time) {
      if (!graph || !graph.master) return getGraphTargetGain(graph);
      const automation = graph.gainAutomation;
      if (!automation) return graph.master.gain.value;
      if (time <= automation.startTime) return automation.from;
      if (time >= automation.endTime) return automation.to;
      const ratio = clamp(
        (time - automation.startTime) / Math.max(0.001, automation.endTime - automation.startTime),
        0,
        1,
      );
      if (automation.curveType === "linear") {
        return automation.from + (automation.to - automation.from) * ratio;
      }
      if (automation.direction === "out") {
        return automation.to + (automation.from - automation.to) * Math.cos(ratio * Math.PI * 0.5);
      }
      return automation.from + (automation.to - automation.from) * Math.sin(ratio * Math.PI * 0.5);
    }

    function getGraphTargetGain(graph) {
      const scale = graph && Number.isFinite(graph.outputGainScale) ? graph.outputGainScale : 1;
      return scale;
    }

    function retireGraphAfterFade(graph, seconds) {
      if (!graph) return;
      for (const source of graph.sources || [graph.source]) if (source) source.onended = null;
      const previous = state.graphs.get(graph);
      if (previous) clock.clearTimeout(previous);
      state.graphs.set(
        graph,
        clock.setTimeout(() => disposeGraph(graph), Math.max(0, seconds * 1000 + 80)),
      );
    }

    function disposeGraph(graph) {
      if (!graph || graph.disposed) return;
      graph.disposed = true;
      const timer = state.graphs.get(graph);
      if (timer) clock.clearTimeout(timer);
      state.graphs.delete(graph);
      // Cancel future fades too: a scheduled ramp must never reopen a stopped graph.
      if (graph.master) {
        try {
          graph.master.gain.cancelScheduledValues(0);
          graph.master.gain.setValueAtTime(0, graph.master.context.currentTime);
        } catch (error) {
          // Disconnecting below also isolates nodes from a closed context.
        }
      }
      const sources = graph.sources || [graph.source];
      sources.forEach((source) => {
        if (!source) return;
        try {
          source.onended = null;
          source.stop();
        } catch (stopError) {
          // 이미 정지된 소스에 stop()이 다시 호출되어도 정리 과정은 계속한다.
        }
        try {
          source.disconnect();
        } catch (disconnectError) {
          // 이미 연결이 해제된 소스도 있으므로 정리 중 발생하는 예외는 무시한다.
        }
      });
      hooks.disconnectGraph(graph);
      graph.previousLiveScores = {};
      graph.livePowerData = null;
      graph.livePowerPrefixData = null;
      graph.frequencyData = null;
      graph.timeData = null;
      graph.stemAnalysisMeters = null;
      graph.spatialLayer = null;
    }

    function stopPlayback(options = {}) {
      const { keepOffset = false, silent = false, preserveIntent = false } = options;
      setPlaybackOutputEnabled(false);
      state.transitionRevision += 1;
      if (!preserveIntent) {
        state.desired = false;
        state.commandRevision += 1;
      }
      if (state.graph) {
        disposeGraph(state.graph);
        state.graph = null;
      }
      // Include graphs created during a transition that never became state.graph.
      for (const graph of state.graphs.keys()) disposeGraph(graph);
      state.playing = false;
      if (!keepOffset) state.offset = 0;
      hooks.onStop?.({ keepOffset, silent });
    }

    function createPlaybackGraph(context, buffer, analysis, mode) {
      const graph = hooks.renderGraph(context, buffer, analysis, mode);
      state.graphs.set(graph, null);
      if (!state.output || state.output.context !== context) {
        state.output = context.createGain();
        state.output.gain.value = 0;
        state.output.connect(context.destination);
      }
      graph.master.disconnect(context.destination);
      graph.master.connect(state.output);
      return graph;
    }

    function setPlaybackOutputEnabled(enabled) {
      const output = state.output;
      if (!output) return;
      output.gain.cancelScheduledValues(0);
      output.gain.value = enabled ? 1 : 0;
      if (enabled) output.connect(output.context.destination);
      else output.disconnect();
    }

    function getPlaybackTime() {
      if (!state.playing || !hooks.readTrack().audioContext) return state.offset;
      return clamp(
        Math.max(state.offset, hooks.readTrack().audioContext.currentTime - state.startedAt),
        0,
        hooks.readTrack().audioBuffer ? hooks.readTrack().audioBuffer.duration : 0,
      );
    }

    return {
      state,
      togglePlayback,
      startPlayback,
      crossfadePlaybackMode,
      getModeSwitchScheduleLead,
      startGraphSources,
      scheduleGraphGainCurve,
      buildLinearGainCurve,
      buildEqualPowerGainCurve,
      getGraphCurrentGain,
      getGraphTargetGain,
      retireGraphAfterFade,
      disposeGraph,
      stopPlayback,
      createPlaybackGraph,
      setPlaybackOutputEnabled,
      getPlaybackTime,
    };
  }
  if (typeof module === "object" && module.exports) module.exports = createTransport;
  else global.createSpatialTransport = createTransport;
})(typeof window === "object" ? window : globalThis);
