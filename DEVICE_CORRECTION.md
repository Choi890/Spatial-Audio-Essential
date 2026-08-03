# Playback-device correction v1

## Scope

The playback-device selector applies linear, symmetric IIR correction to `Full Spatial` only, before the final spatial peak guard. `Original` is a strict unity-gain reference and bypasses device EQ, preamp, HRTF, room processing, and the peak guard. Every Full Spatial boost profile includes explicit preamp headroom, followed by a same-window level match against Original. A second render is used only when the predicted matched peak reaches the nonlinear peak-guard range; it then measures and removes the remaining level error after the guard.

Headphone and IEM measurements are not transferable across fixtures. AirPods Pro 3 uses a B&K 5128 measurement and a rig-matched 5128 diffuse-field target. IE 600 uses a GRAS RA0045 measurement and the GRAS KEMAR diffuse-field target. MR4 uses anechoic CTA-2034/spinorama data rather than a headphone DF curve.

## Profiles

### AirPods Pro 3

- Measurement: left/right average, B&K 5128, earphonesarchive data exposed by Songbird.
- Target: 5128 diffuse field with 10 dB perceptual tilt.
- Fit: log-frequency interpolation, normalization at 500 Hz, 1/6-octave smoothing, correction bounded to ±3.5 dB, seven broad biquads, correction fit limited to 25 Hz–10 kHz.
- Safety: -3.15 dB preamp. Adaptive EQ and acoustic seal can change the measured response, so this is intentionally conservative.

Sources: [Apple technical specifications](https://www.apple.com/airpods-pro/specs/), [Songbird measurement catalog](https://songbird.rocks/catalog/apple-airpods-pro-3), [RTINGS measurement and consistency discussion](https://www.rtings.com/headphones/reviews/apple/airpods-pro-3).

### Sennheiser IE 600

- Measurement: silicone tips, GRAS RA0045, HypetheSonics measurement distributed through AutoEq.
- Target: GRAS KEMAR diffuse field.
- Fit: normalization at 500 Hz, 1/6-octave smoothing, correction bounded to ±4.5 dB, seven broad biquads, correction fit limited to 25 Hz–10 kHz.
- Safety: -5.41 dB preamp. The bound prevents a literal diffuse-field inversion from removing more than 10 dB of bass. Tip, seal, and insertion depth remain important.

Sources: [AutoEq IE 600 silicone measurement](https://github.com/jaakkopasanen/AutoEq/blob/master/measurements/HypetheSonics/data/in-ear/GRAS%20RA0045/Sennheiser%20IE%20600%20%28silicone%20eartips%29.csv), [AutoEq GRAS KEMAR diffuse-field target](https://github.com/jaakkopasanen/AutoEq/blob/master/targets/Diffuse%20field%20GRAS%20KEMAR.csv), [Sennheiser IE 600 data sheet](https://www.telquestintl.com/site/Product%20Manuals/Sennheiser%20IE%20600%20In%20Ear%20Audiophile%20Headphones%20%28IE600%29%20Data%20Sheet.pdf).

### Edifier MR4

- Measurement: Klippel NFS / CTA-2034, Monitor mode, tone controls at zero.
- Target: published AutomaticEQ spinorama optimization.
- Safety: the published -3.6 dB preamp is retained.
- Speaker renderer: selecting MR4 bypasses headphone HRTF convolution and uses a symmetric speaker-safe stereo field. This avoids feeding binaural ear signals through acoustic crosstalk.

Sources: [Spinorama MR4 EQ](https://www.spinorama.org/speakers/Edifier%20MR4/ASR/index_asr_eq.html), [Erin's Audio Corner CTA-2034 measurement](https://www.erinsaudiocorner.com/loudspeakers/edifier_mr4/), [Edifier MR4 product page](https://us.edifier.com/products/mr4).

## Limits

The MR4 profile is anechoic loudspeaker correction, not room correction. Below roughly 300 Hz, placement and room modes can dominate; correcting that region accurately requires a calibrated microphone measurement at the listening position. AirPods Adaptive EQ and IE 600 fit can likewise shift the actual ear response. These profiles therefore make traceable, bounded corrections rather than claiming per-user calibration.

Filter coefficients and device-specific renderer scales are the canonical implementation in `static/js/device-profiles.js`.
