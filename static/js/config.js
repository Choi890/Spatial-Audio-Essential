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

  const CORE_STEM_ORDER = ["vocals", "other", "drums", "bass"];
  const STEM_ORDER = ["vocals", "guitar", "piano", "other", "drums", "bass"];
  const METER_FRAME_INTERVAL = 1 / 30;

  // Stem columns: id, label, short name, color, x, y, z, description.
  const STEM_PROFILES = Object.fromEntries([
    ["vocals","Lead Stem","Lead","#c86f5a",0,0.24,-2.35,"Lead melody and primary focus analysis stem"],
    ["guitar","Guitar Stem","Guitar","#b87954",1.18,0.2,-3.35,"Quality-gated adaptive guitar stem"],
    ["piano","Piano Stem","Piano","#8b79a8",-1.12,0.2,-3.45,"Quality-gated adaptive piano stem"],
    ["other","Music Stem","Music","#517f96",-0.92,0.24,-4.15,"Harmony and texture analysis stem"],
    ["drums","Transient Stem","Hit","#b89148",1.18,0.14,-4.35,"Transient impact analysis stem"],
    ["bass","Low Stem","Low","#687f5b",0,-0.12,-1.85,"Low-frequency anchor analysis stem"]
  ].map(([id, label, short, color, x, y, z, description]) =>
    [id, { id, label, description, short, color, position: { x, y, z } }]));

  // Signature columns: instrument id, gate, [low Hz, high Hz, weight] bands.
  const LIVE_SIGNATURES = Object.fromEntries([
    ["violins1","stringHigh",[[620,1200,0.18],[1200,2600,0.34],[2600,6200,0.34],[6200,9400,0.14]]],
    ["violins2","stringHigh",[[420,1000,0.2],[1000,2200,0.36],[2200,5200,0.32],[5200,8200,0.12]]],
    ["violas","stringMid",[[180,620,0.24],[620,1500,0.42],[1500,3400,0.26],[3400,5600,0.08]]],
    ["cellos","stringLow",[[65,260,0.34],[260,760,0.42],[760,2200,0.2],[2200,4200,0.04]]],
    ["basses","low",[[38,160,0.58],[160,460,0.32],[460,1000,0.1]]],
    ["flute","woodwindHigh",[[760,1600,0.12],[1600,3600,0.32],[3600,7600,0.42],[7600,11000,0.14]]],
    ["oboe","woodwindMid",[[420,1100,0.16],[1100,2600,0.44],[2600,5200,0.32],[5200,8000,0.08]]],
    ["clarinet","woodwindMid",[[180,620,0.22],[620,1500,0.44],[1500,3400,0.26],[3400,6200,0.08]]],
    ["bassoon","woodwindLow",[[70,260,0.22],[260,760,0.46],[760,1800,0.24],[1800,3600,0.08]]],
    ["horn","brassWarm",[[80,260,0.18],[260,760,0.42],[760,1700,0.3],[1700,3400,0.1]]],
    ["trumpet","brassBright",[[380,1000,0.14],[1000,2600,0.38],[2600,6200,0.36],[6200,9800,0.12]]],
    ["trombone","brassWarm",[[100,360,0.18],[360,1100,0.42],[1100,2600,0.3],[2600,5200,0.1]]],
    ["timpani","impactLow",[[45,180,0.68],[180,360,0.22],[360,720,0.1]]],
    ["percussion","impactHigh",[[1000,3000,0.18],[3000,7600,0.46],[7600,14000,0.36]]],
    ["harp","pluck",[[260,900,0.16],[900,2600,0.3],[2600,6200,0.36],[6200,11000,0.18]]],
    ["piano","piano",[[45,180,0.12],[180,620,0.26],[620,1800,0.3],[1800,5200,0.24],[5200,9000,0.08]]]
  ].map(([id, gate, bands]) => [id, { bands, gate }]));

  window.SpatialAudioConfig = {
    LIVE_SIGNATURES,
    METER_FRAME_INTERVAL,
    SHORT_NAMES,
    CORE_STEM_ORDER,
    STEM_ORDER,
    STEM_PROFILES
  };
})();
