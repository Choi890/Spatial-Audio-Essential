(function () {
  "use strict";

  const profiles = [
    {
      id: "neutral",
      label: "No device correction",
      shortLabel: "Neutral output",
      kind: "headphones",
      renderer: "binaural",
      preampDb: 0,
      filters: [],
      wetScale: 1,
      lateralScale: 1,
      note: "No playback-device EQ. Full Spatial processing remains active."
    },
    {
      id: "airpods-pro-3",
      label: "AirPods Pro 3 · bounded 5128 DF",
      shortLabel: "AirPods Pro 3",
      kind: "headphones",
      renderer: "binaural",
      preampDb: -3.15,
      wetScale: 0.96,
      lateralScale: 0.94,
      filters: [
        { type: "lowshelf", frequency: 55, gain: -3.50, q: 0.707 },
        { type: "peaking", frequency: 150, gain: 2.76, q: 2.08 },
        { type: "peaking", frequency: 650, gain: -0.26, q: 1.07 },
        { type: "peaking", frequency: 1600, gain: -1.09, q: 0.49 },
        { type: "peaking", frequency: 3200, gain: 3.50, q: 1.92 },
        { type: "peaking", frequency: 5800, gain: -3.15, q: 2.50 },
        { type: "highshelf", frequency: 9000, gain: -3.50, q: 0.707 }
      ],
      measurement: "B&K 5128 L/R average; earphonesarchive via Songbird",
      target: "5128 diffuse field with 10 dB perceptual tilt; 1/6-octave smoothing; ±3.5 dB bound",
      note: "Adaptive EQ changes with fit and seal. Keep Apple Spatialize Stereo off to avoid double spatial processing."
    },
    {
      id: "sennheiser-ie600",
      label: "Sennheiser IE 600 · bounded GRAS DF",
      shortLabel: "Sennheiser IE 600",
      kind: "headphones",
      renderer: "binaural",
      preampDb: -5.41,
      wetScale: 1,
      lateralScale: 1,
      filters: [
        { type: "lowshelf", frequency: 55, gain: -4.50, q: 0.707 },
        { type: "peaking", frequency: 180, gain: -4.50, q: 0.43 },
        { type: "peaking", frequency: 700, gain: 3.00, q: 0.84 },
        { type: "peaking", frequency: 1800, gain: -2.64, q: 0.51 },
        { type: "peaking", frequency: 3300, gain: 4.50, q: 0.87 },
        { type: "peaking", frequency: 5800, gain: 2.43, q: 0.35 },
        { type: "highshelf", frequency: 9000, gain: -4.50, q: 0.707 }
      ],
      measurement: "GRAS RA0045, silicone tips; HypetheSonics via AutoEq",
      target: "GRAS KEMAR diffuse field; 1/6-octave smoothing; ±4.5 dB bound; correction stops above 10 kHz",
      note: "Designed for the published silicone-tip measurement. Tip, insertion depth, and seal can dominate treble and bass."
    },
    {
      id: "edifier-mr4",
      label: "Edifier MR4 · Monitor/anechoic",
      shortLabel: "Edifier MR4",
      kind: "speakers",
      renderer: "stereo-speaker",
      preampDb: -3.60,
      wetScale: 0.82,
      lateralScale: 0.68,
      filters: [
        { type: "peaking", frequency: 41, gain: 2.59, q: 0.39 },
        { type: "peaking", frequency: 102, gain: 2.48, q: 1.88 },
        { type: "peaking", frequency: 144, gain: -1.63, q: 2.13 },
        { type: "peaking", frequency: 600, gain: -1.39, q: 3.00 },
        { type: "peaking", frequency: 3068, gain: 2.99, q: 2.97 },
        { type: "peaking", frequency: 6361, gain: 1.73, q: 2.85 },
        { type: "peaking", frequency: 12736, gain: -4.11, q: 1.05 }
      ],
      measurement: "Klippel NFS / CTA-2034 spinorama; ASR measurement, AutomaticEQ fit",
      target: "Anechoic listening-window/spinorama optimization",
      note: "Monitor mode, tone knobs at 0, tweeters at ear height. Room correction below roughly 300 Hz still needs an in-room microphone measurement."
    }
  ];

  const frozenProfiles = profiles.map((profile) => Object.freeze({
    ...profile,
    filters: Object.freeze(profile.filters.map((filter) => Object.freeze({ ...filter })))
  }));

  window.SpatialAudioDeviceProfiles = Object.freeze({
    defaultId: "neutral",
    profiles: Object.freeze(frozenProfiles),
    byId: Object.freeze(Object.fromEntries(frozenProfiles.map((profile) => [profile.id, profile])))
  });
})();
