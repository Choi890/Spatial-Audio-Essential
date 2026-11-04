const test = require("node:test");
const assert = require("node:assert/strict");
const TaskScope = require("../static/js/task-scope.js");
const createTransport = require("../static/js/transport.js");

test("aligned stem starts at the correct time and never repeats its final samples", () => {
  const transport = createTransport({});
  const calls = [];
  const makeSource = (alignment) => ({ buffer: { duration: 10 }, context: { currentTime: 5 },
    spatialAlignmentOffsetSeconds: alignment, start: (...args) => calls.push(args) });
  transport.startGraphSources({ sources: [makeSource(-0.1)] }, 0, () => {}, 0);
  transport.startGraphSources({ sources: [makeSource(-0.1)] }, 0.05, () => {}, 6);
  transport.startGraphSources({ sources: [makeSource(0.1)] }, 9.99, () => {}, 6);
  assert.deepEqual(calls, [[5.1, 0], [6.05, 0], [6, 10]]);
});

test("replaced, cancelled and completed tasks cannot publish results", () => {
  const scope = new TaskScope();
  const first = scope.begin();
  const next = scope.begin();
  let result = "";
  assert.equal(first.signal.aborted, true);
  assert.equal(
    first.commit(() => {
      result = "stale";
    }),
    false,
  );
  assert.equal(
    next.commit(() => {
      result = "current";
    }),
    true,
  );
  scope.finish(first);
  assert.equal(next.isCurrent(), true);
  scope.finish(next);
  assert.equal(
    next.commit(() => {
      result = "completed";
    }),
    false,
  );
  const cancelled = scope.begin();
  scope.cancel();
  assert.equal(cancelled.signal.aborted, true);
  assert.equal(cancelled.isCurrent(), false);
  assert.equal(result, "current");
});

test("stop cancels a playback command waiting for its audio context", async () => {
  let resume;
  let builds = 0;
  const track = { audioBuffer: { duration: 20 }, analysis: {} };
  const transport = createTransport({
    readTrack: () => track,
    ensureContext: () =>
      new Promise((resolve) => {
        resume = resolve;
      }),
    createGraph: () => {
      builds++;
    },
  });
  const pending = transport.startPlayback();
  transport.stopPlayback();
  resume({ currentTime: 0 });
  await pending;
  assert.equal(builds, 0);
  assert.equal(transport.state.playing, false);
  assert.equal(transport.state.desired, false);
});

test("disposing a fading graph cancels its timer and stops every source once", () => {
  const timers = new Map();
  let serial = 0;
  let stopped = 0;
  let disconnected = 0;
  const transport = createTransport({
    readTrack: () => ({}),
    clock: {
      setTimeout(callback) {
        const id = ++serial;
        timers.set(id, callback);
        return id;
      },
      clearTimeout(id) {
        timers.delete(id);
      },
    },
    disconnectGraph() {
      disconnected++;
    },
  });
  const graph = {
    sources: [
      {
        stop() {
          stopped++;
        },
        disconnect() {},
      },
    ],
  };
  transport.retireGraphAfterFade(graph, 0.2);
  transport.retireGraphAfterFade(graph, 0.4);
  assert.equal(timers.size, 1);
  transport.disposeGraph(graph);
  transport.disposeGraph(graph);
  assert.equal(timers.size, 0);
  assert.equal(transport.state.graphs.size, 0);
  assert.equal(stopped, 1);
  assert.equal(disconnected, 1);
});


test("spatial playback starts without waiting for an offline render", async () => {
  let builds = 0;
  const track = { audioBuffer: { duration: 20 }, analysis: {}, spatialRenderPromise: new Promise(() => {}) };
  const transport = createTransport({
    readTrack: () => track,
    ensureContext: async () => ({ currentTime: 0, destination: {} }),
    createGraph: () => { builds++; return { sources: [], nodes: [] }; },
    startSources: () => {},
  });
  await transport.startPlayback();
  assert.equal(builds, 1);
  assert.equal(transport.state.playing, true);
});

test("mode transition keeps a nonzero playback position on its timeline", async () => {
  const context = {currentTime: 10, baseLatency: 0.012};
  const track = {audioBuffer: {duration: 20}, analysis: {}, audioContext: context};
  let scheduled;
  const transport = createTransport({readTrack: () => track, ensureContext: async () => context,
    createGraph: () => ({mode: "spatial", sources: []}),
    startSources: (graph, offset, onEnded, when) => { scheduled = {offset, when, preRoll: graph.transitionPreRollSeconds}; }});
  transport.state.playing = true;
  transport.state.desired = true;
  transport.state.mode = "spatial";
  transport.state.offset = 5;
  transport.state.startedAt = 5;
  await transport.crossfadePlaybackMode(5);
  assert.ok(Math.abs(transport.getPlaybackTime() - 5) < 1e-9);
  assert.ok(Math.abs(scheduled.offset - (5 + scheduled.when - context.currentTime)) < 1e-9);
  assert.ok(scheduled.preRoll > 0);
  context.currentTime += 0.2;
  assert.ok(Math.abs(transport.getPlaybackTime() - 5.2) < 1e-9);
});

test("mode transition accounts for time spent building the spatial graph", async () => {
  const context = {currentTime: 10, baseLatency: 0.012};
  const track = {audioBuffer: {duration: 20}, analysis: {}, audioContext: context};
  let scheduled;
  const transport = createTransport({readTrack: () => track, ensureContext: async () => context,
    createGraph: () => { context.currentTime += 0.3; return {mode: "spatial", sources: []}; },
    startSources: (graph, offset, onEnded, when) => { scheduled = {offset, when}; }});
  transport.state.playing = true;
  transport.state.desired = true;
  transport.state.mode = "spatial";
  transport.state.offset = 5;
  transport.state.startedAt = 5;
  await transport.crossfadePlaybackMode(5);
  assert.ok(Math.abs(transport.getPlaybackTime() - 5.3) < 1e-9);
  assert.ok(Math.abs(scheduled.offset - (5 + scheduled.when - 10)) < 1e-9);
});

test("failed transition automation disposes the new graph and keeps the old graph", async () => {
  const context = {currentTime: 10, baseLatency: 0.012};
  const track = {audioBuffer: {duration: 20}, analysis: {}, audioContext: context};
  const previous = {sources: []};
  let disconnected = 0, started = 0;
  const graph = {mode: "spatial", sources: [], master: {gain: {
    cancelScheduledValues() { throw new Error("automation failed"); }
  }}};
  const transport = createTransport({readTrack: () => track, ensureContext: async () => context,
    createGraph: () => graph, disconnectGraph: () => { disconnected++; }, startSources: () => { started++; }});
  transport.state.playing = true;
  transport.state.desired = true;
  transport.state.graph = previous;
  transport.state.mode = "spatial";
  await assert.rejects(transport.crossfadePlaybackMode(0), /automation failed/);
  assert.equal(disconnected, 1);
  assert.equal(started, 0);
  assert.equal(transport.state.graph, previous);
  assert.equal(transport.state.playing, true);
});
