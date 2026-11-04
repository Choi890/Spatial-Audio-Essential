# Architecture redesign

This redesign preserves the existing interface, source-separation settings, measured assets and DSP coefficients. The baseline is the working tree saved under `data/outputs/_benchmarks/redesign-before/`, including earlier uncommitted changes.

## Ownership

- `static/js/transport.js`: command intent, playback clock, output gate, graph registration and retirement timers. Current and fading graphs share one registry. UI effects enter through callbacks.
- `static/js/spatial-renderer.js`: audio graph construction and impulse caches. A render plan freezes settings, stem metadata, calibration and asset selection; AudioBuffers and impulse caches stay shared by reference. Offline calibration derives plans instead of modifying playback settings.
- `static/js/task-scope.js`: latest analysis task and cancellation. Stale stem decoding and calibration results cannot publish into a newer track.
- `static/js/studio-view.js`: DOM references, canvas drawing, fixed card placement, meters and visual timers. Playback effects enter through the transport callbacks; its visual state is separate from the track and renderer.
- `backend/features.py`: pure music features and a shared, read-only analysis frame workspace. FFT processing is bounded to 256 frames per block. STFT, RMS and zero-crossing calculations reuse framing.
- `backend/audio_io.py`: decoding and production loudness/peak measurement.
- `backend/separation.py`: Demucs process execution, quality gates and stem-cache ownership. Model, FP32, shifts, overlap, segment and batching defaults are retained.
- `backend/audio_engine.py`: analysis orchestration and instrument activity inference.
- `app.py`: HTTP boundaries, cancellation propagation, upload limits and request/cache management.

No new application framework, bundler or runtime dependency is introduced.

## References and applied decisions

- [W3C Web Audio API](https://www.w3.org/TR/webaudio-1.0/): scheduled source lifetime, gain automation, graph routing and offline rendering. Keep the established signal graph; centralize its lifetime.
- [FastAPI concurrency](https://fastapi.tiangolo.com/async/), [Python asyncio cancellation](https://docs.python.org/3.12/library/asyncio-task.html#asyncio.shield): CPU work stays outside the request event loop and cancellation still reaches the worker. Do not replace parallel feature/separation execution with sequential awaits.
- [HT Demucs paper](https://arxiv.org/abs/2211.08553), [official Demucs implementation](https://github.com/facebookresearch/demucs/blob/main/demucs/apply.py): preserve quality-affecting inference settings and overlap-add behavior.
- [NumPy 1.26 sliding window views](https://numpy.org/doc/1.26/reference/generated/numpy.lib.stride_tricks.sliding_window_view.html): share read-only frame views. A view alone does not reduce arithmetic; bounded FFT batches and vectorized reductions provide the measured optimization.
- [DAFx BinRIR](https://dafx.de/paper-archive/details/lUF_cLvEDGdaZjWoH1jBrQ), [partitioned convolution implementation](https://dafx.de/paper-archive/details/S8X2gFWs-CsSUhrhJ7KeWQ): retain separate direct, early-reflection and late-field responsibilities. Native ConvolverNode processing remains in place; phase-discarding approximations and model replacement are outside this behavior-preserving redesign.

## Validation

Feature microbenchmarks compare STFT, RMS, zero crossings and chroma against the saved baseline; tested outputs are bit-identical. A 194.608-second source also produces an identical complete backend payload after removing timing fields. With existing Demucs stems, three measured alternating runs after warmup give medians of 4.8435 seconds before and 4.6769 seconds after (3.44% lower). This does not measure fresh model inference.

The 180-second isolated feature workload falls from 198.66 to 111.43 ms; its traced allocation peak falls from 111.18 to 53.21 MB. This is a feature-only result, not a whole-pipeline memory or speed claim.

Five browser audio differential cases preserve graph node counts, with maximum absolute PCM error 1.87e-7. Dark/light layouts at widths 1480, 1000 and 390 have matching computed styles across 175 non-script elements and their pseudo-elements after visual state settles. Audio and visual checks are synthetic regression checks, not listening-test evidence.

The controller entry files become smaller (`static/app.js`: 5890 → 1986 lines; `backend/audio_engine.py`: 2249 → 1005). Counting their extracted modules, total core source bytes increase from 351241 to 385053, including formatting and explicit lifetime boundaries. These figures include `app.py` on both sides. This redesign does **not** achieve a 50% total source reduction. No runtime dependency was added. Regression commands and limitations are recorded in `EVALUATION_PROTOCOL.md`.

Final checks: Python 33 passed, Node 8 passed, browser suite 114 passed and 2 conditional skips. Syntax checks passed. The first browser pass exposed a changed pause glyph and an old source-text assertion; the glyph was restored and the assertion now counts actual compressor nodes. The complete browser suite was then run again successfully.
