(function () {
  const SHORT_NAMES = {
    violins1: "Vn I",
    violins2: "Vn II",
    violas: "Va",
    cellos: "Vc",
    basses: "Cb",
    flute: "Fl",
    oboe: "Ob",
    clarinet: "Cl",
    bassoon: "Bn",
    horn: "Hn",
    trumpet: "Tp",
    trombone: "Tb",
    timpani: "Tmp",
    percussion: "Perc",
    harp: "Hp",
    piano: "Pf"
  };

  const STEM_ORDER = ["vocals", "other", "drums", "bass"];
  const METER_FRAME_INTERVAL = 1 / 30;

  const STEM_PROFILES = {
    vocals: {
      id: "vocals",
      label: "Lead Stem",
      description: "Lead melody and primary focus analysis stem",
      short: "Lead",
      color: "#c86f5a",
      position: { x: 0, y: 0.24, z: -2.35 }
    },
    other: {
      id: "other",
      label: "Music Stem",
      description: "Harmony and texture analysis stem",
      short: "Music",
      color: "#517f96",
      position: { x: -0.92, y: 0.24, z: -4.15 }
    },
    drums: {
      id: "drums",
      label: "Transient Stem",
      description: "Transient impact analysis stem",
      short: "Hit",
      color: "#b89148",
      position: { x: 1.18, y: 0.14, z: -4.35 }
    },
    bass: {
      id: "bass",
      label: "Low Stem",
      description: "Low-frequency anchor analysis stem",
      short: "Low",
      color: "#687f5b",
      position: { x: 0, y: -0.12, z: -1.85 }
    }
  };

  const LIVE_SIGNATURES = {
    violins1: {
      bands: [[620, 1200, 0.18], [1200, 2600, 0.34], [2600, 6200, 0.34], [6200, 9400, 0.14]],
      gate: "stringHigh"
    },
    violins2: {
      bands: [[420, 1000, 0.2], [1000, 2200, 0.36], [2200, 5200, 0.32], [5200, 8200, 0.12]],
      gate: "stringHigh"
    },
    violas: {
      bands: [[180, 620, 0.24], [620, 1500, 0.42], [1500, 3400, 0.26], [3400, 5600, 0.08]],
      gate: "stringMid"
    },
    cellos: {
      bands: [[65, 260, 0.34], [260, 760, 0.42], [760, 2200, 0.2], [2200, 4200, 0.04]],
      gate: "stringLow"
    },
    basses: {
      bands: [[38, 160, 0.58], [160, 460, 0.32], [460, 1000, 0.1]],
      gate: "low"
    },
    flute: {
      bands: [[760, 1600, 0.12], [1600, 3600, 0.32], [3600, 7600, 0.42], [7600, 11000, 0.14]],
      gate: "woodwindHigh"
    },
    oboe: {
      bands: [[420, 1100, 0.16], [1100, 2600, 0.44], [2600, 5200, 0.32], [5200, 8000, 0.08]],
      gate: "woodwindMid"
    },
    clarinet: {
      bands: [[180, 620, 0.22], [620, 1500, 0.44], [1500, 3400, 0.26], [3400, 6200, 0.08]],
      gate: "woodwindMid"
    },
    bassoon: {
      bands: [[70, 260, 0.22], [260, 760, 0.46], [760, 1800, 0.24], [1800, 3600, 0.08]],
      gate: "woodwindLow"
    },
    horn: {
      bands: [[80, 260, 0.18], [260, 760, 0.42], [760, 1700, 0.3], [1700, 3400, 0.1]],
      gate: "brassWarm"
    },
    trumpet: {
      bands: [[380, 1000, 0.14], [1000, 2600, 0.38], [2600, 6200, 0.36], [6200, 9800, 0.12]],
      gate: "brassBright"
    },
    trombone: {
      bands: [[100, 360, 0.18], [360, 1100, 0.42], [1100, 2600, 0.3], [2600, 5200, 0.1]],
      gate: "brassWarm"
    },
    timpani: {
      bands: [[45, 180, 0.68], [180, 360, 0.22], [360, 720, 0.1]],
      gate: "impactLow"
    },
    percussion: {
      bands: [[1000, 3000, 0.18], [3000, 7600, 0.46], [7600, 14000, 0.36]],
      gate: "impactHigh"
    },
    harp: {
      bands: [[260, 900, 0.16], [900, 2600, 0.3], [2600, 6200, 0.36], [6200, 11000, 0.18]],
      gate: "pluck"
    },
    piano: {
      bands: [[45, 180, 0.12], [180, 620, 0.26], [620, 1800, 0.3], [1800, 5200, 0.24], [5200, 9000, 0.08]],
      gate: "piano"
    }
  };

  window.SpatialAudioConfig = {
    LIVE_SIGNATURES,
    METER_FRAME_INTERVAL,
    SHORT_NAMES,
    STEM_ORDER,
    STEM_PROFILES
  };
})();
