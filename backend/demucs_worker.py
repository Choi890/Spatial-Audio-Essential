"""GPU batching for Demucs 4.0.1, retaining its shift/overlap-add algorithm.

Uses upstream demucs.apply's TensorChunk and public model/checkpoint loaders.
Demucs is Copyright Meta Platforms, Inc. and affiliates, MIT licensed.
The parent process owns cancellation and kills this worker's process tree.
"""
from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path


def apply_batched(model, mix, *, shifts=2, overlap=0.36, segment=7, batch_size=4, device="cuda"):
    import torch
    from demucs.apply import BagOfModels, TensorChunk
    from demucs.utils import center_trim

    if isinstance(model, BagOfModels):
        result = None
        totals = [0.0] * len(model.sources)
        for member, weights in zip(model.models, model.weights):
            member.to(device).eval()
            estimate = apply_batched(member, mix, shifts=shifts, overlap=overlap,
                                     segment=segment, batch_size=batch_size, device=device)
            member.cpu()
            for index, weight in enumerate(weights):
                estimate[:, index] *= weight
                totals[index] += weight
            result = estimate if result is None else result + estimate
        for index, total in enumerate(totals):
            result[:, index] /= total
        return result

    length = mix.shape[-1]
    if shifts:
        max_shift = int(model.samplerate * 0.5)
        padded = TensorChunk(mix).padded(length + 2 * max_shift)
        result = None
        for _ in range(shifts):
            offset = random.randint(0, max_shift)
            shifted = TensorChunk(padded, offset, length + max_shift - offset)
            estimate = apply_batched(model, shifted, shifts=0, overlap=overlap,
                                     segment=segment, batch_size=batch_size, device=device)
            estimate = estimate[..., max_shift - offset:]
            result = estimate if result is None else result + estimate
        return result / shifts

    model.to(device).eval()
    transformer = getattr(model, "crosstransformer", None)
    consumes_random = transformer is not None and transformer.emb == "sin"
    if consumes_random and transformer.sin_random_shift:
        batch_size = 1
    size = int(model.samplerate * segment)
    stride = max(1, int((1 - overlap) * size))
    offsets = list(range(0, length, stride))
    weight = torch.minimum(torch.arange(1, size + 1), torch.arange(size, 0, -1)).float()
    weight /= weight.max()
    result = torch.zeros(1, len(model.sources), model.audio_channels, length)
    total = torch.zeros(length)
    position = 0
    while position < len(offsets):
        selected = offsets[position:position + batch_size]
        chunks = [TensorChunk(mix, offset, size) for offset in selected]
        inputs = None
        random_state = random.getstate()
        try:
            inputs = torch.cat([chunk.padded(size) for chunk in chunks]).to(device)
            with torch.inference_mode():
                estimates = model(inputs).cpu()
        except torch.cuda.OutOfMemoryError:
            del inputs
            random.setstate(random_state)
            if batch_size <= 1:
                raise
            batch_size = max(1, batch_size // 2)
            torch.cuda.empty_cache()
            continue
        del inputs
        # Upstream consumes one positional-embedding RNG draw per chunk even
        # with a zero random shift. Retain that sequence for the next shift pass.
        if consumes_random:
            for _ in range(len(chunks) - 1):
                random.randrange(transformer.sin_random_shift + 1)
        for index, (offset, chunk) in enumerate(zip(selected, chunks)):
            estimate = center_trim(estimates[index:index + 1], chunk.length)
            count = estimate.shape[-1]
            result[..., offset:offset + count] += estimate * weight[:count]
            total[offset:offset + count] += weight[:count]
        position += len(selected)
    return result / total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("track", type=Path)
    parser.add_argument("-n", "--name", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--shifts", type=int, default=2)
    parser.add_argument("--overlap", type=float, default=0.36)
    parser.add_argument("--segment", type=float, default=7)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("-j", type=int, default=1)
    parser.add_argument("--int24", action="store_true")
    parser.add_argument("--clip-mode", default="rescale")
    parser.add_argument("--auxiliary-out", type=Path)
    parser.add_argument("--auxiliary-model", default="htdemucs_6s")
    args = parser.parse_args()

    import torch
    from demucs.audio import save_audio
    from demucs.pretrained import get_model
    from demucs.separate import load_track

    torch.set_num_threads(1)
    random.seed(13)
    audio_cache = {}

    def separate(name, output_root):
        started = time.perf_counter()
        model = get_model(name).cpu().eval()
        audio_key = (model.audio_channels, model.samplerate)
        if audio_key not in audio_cache:
            wav = load_track(args.track, *audio_key)
            reference = wav.mean(0)
            mean, std = reference.mean(), reference.std()
            if not torch.isfinite(std) or std <= 1e-8:
                std = torch.tensor(1.0)
            audio_cache[audio_key] = ((wav - mean) / std, mean, std)
        normalized, mean, std = audio_cache[audio_key]
        sources = apply_batched(model, normalized[None], shifts=args.shifts, overlap=args.overlap,
                                segment=args.segment, batch_size=max(1, args.batch_size), device=args.device)[0]
        sources = sources * std + mean
        destination = output_root / name / args.track.stem
        destination.mkdir(parents=True, exist_ok=True)
        for stem_name, source in zip(model.sources, sources):
            save_audio(source, str(destination / f"{stem_name}.wav"), samplerate=model.samplerate,
                       clip=args.clip_mode, bits_per_sample=24)
        elapsed = time.perf_counter() - started
        print(f"Demucs {name}: {elapsed:.3f}s", flush=True)
        return elapsed

    timing = {"primarySeconds": separate(args.name, args.out)}
    if args.auxiliary_out is not None:
        started = time.perf_counter()
        try:
            timing["auxiliarySeconds"] = separate(args.auxiliary_model, args.auxiliary_out)
        except Exception as exc:
            timing["auxiliarySeconds"] = time.perf_counter() - started
            timing["auxiliaryReason"] = f"{type(exc).__name__}: {exc}"[-400:]
        (args.out / "worker-timing.json").write_text(json.dumps(timing), encoding="utf-8")


if __name__ == "__main__":
    main()
