/* =========================================================================
   PuzzleAtlas Engine — shared hunt schema, validation, style-pack renderer
   and player interpreter.

   This is the single source of truth for "what a hunt is and what it does
   when played." It has no dependency on the Studio's canvas, inspector or
   library UI, and (aside from applyStylePack, which only touches DOM
   elements it's explicitly told about, and no-ops outside a browser) it
   has no DOM dependency either — it can run under Node for testing.

   PuzzleAtlas Studio loads this file to drive its docked live Player
   mockup and its full-screen Preview overlay. The standalone PuzzleAtlas
   Player app loads this exact same file to drive real play. Two shells,
   one interpreter — that's what guarantees a hunt looks and behaves
   identically in Studio's preview and in the real Player app.

   Exposed as window.PAEngine in a browser, or via module.exports under
   Node/CommonJS (e.g. for test scripts or a future server-side use).
   ========================================================================= */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
  } else {
    root.PAEngine = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
"use strict";

/* ---------------------------------------------------------------------
   Utilities
--------------------------------------------------------------------- */
function uid(prefix) {
  return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function esc(s) {
  s = (s === undefined || s === null) ? "" : String(s);
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

/* ---------------------------------------------------------------------
   Schema v0 — node type registry
   Each node type declares: family, label, icon, default content factory,
   and which content fields are "player-visible" vs "creator-only".
--------------------------------------------------------------------- */
var SCHEMA_VERSION = "0.1.0";

var FAMILIES = {
  narrative: { label: "Narrative", color: "narrative" },
  puzzle:    { label: "Puzzle",    color: "puzzle" },
  state:     { label: "State",     color: "state" },
  control:   { label: "Control",   color: "control" },
  support:   { label: "Support",   color: "support" },
  media:     { label: "Media",     color: "media" },
  input:     { label: "Real-World Input", color: "input" },
  stub:      { label: "Stub",      color: "stub" }
};

var NODE_TYPES = {
  scene: {
    family: "narrative", label: "Scene / Text Reveal", icon: "📜",
    defaultTitle: "New Scene",
    // mediaUrl/mediaType are optional — when set, the player screen shows
    // the media full-bleed in the background with the text pane pinned to
    // the bottom third on top of it (see renderPreviewNode below).
    defaultContent: function () { return { body: "Write the narrative text the player sees here.", mediaUrl: "", mediaType: "image" }; },
    summary: function (c) { return c.body ? c.body.slice(0, 60) : ""; }
  },
  choice: {
    family: "narrative", label: "Choice", icon: "🔀",
    defaultTitle: "New Choice",
    defaultContent: function () {
      return { body: "What does the player choose?", options: [
        { id: uid("opt"), label: "Option A" },
        { id: uid("opt"), label: "Option B" }
      ] };
    },
    summary: function (c) { return (c.options || []).map(function (o) { return o.label; }).join(" / "); }
  },
  answerEntry: {
    family: "puzzle", label: "Answer Entry (text match)", icon: "🔑",
    defaultTitle: "New Puzzle",
    defaultContent: function () {
      return { prompt: "Describe the puzzle prompt.", acceptedAnswers: ["ANSWER"], caseSensitive: false };
    },
    summary: function (c) { return "Answer: " + (c.acceptedAnswers || []).join(", "); }
  },
  ordering: {
    family: "puzzle", label: "Ordering Puzzle", icon: "🔢",
    defaultTitle: "New Ordering Puzzle",
    defaultContent: function () {
      var a = uid("it"), b = uid("it"), c = uid("it");
      return {
        prompt: "Put these in the correct order.",
        items: [{ id: a, label: "First item" }, { id: b, label: "Second item" }, { id: c, label: "Third item" }],
        correctOrder: [a, b, c]
      };
    },
    summary: function (c) { return (c.items || []).length + " items to order"; }
  },
  matching: {
    family: "puzzle", label: "Matching Puzzle", icon: "🧩",
    defaultTitle: "New Matching Puzzle",
    defaultContent: function () {
      var l1 = uid("l"), l2 = uid("l"), r1 = uid("r"), r2 = uid("r");
      return {
        prompt: "Match each item on the left to the right.",
        left: [{ id: l1, label: "Left A" }, { id: l2, label: "Left B" }],
        right: [{ id: r1, label: "Right A" }, { id: r2, label: "Right B" }],
        correctPairs: [[l1, r1], [l2, r2]]
      };
    },
    summary: function (c) { return (c.left || []).length + " pairs to match"; }
  },
  cipher: {
    family: "puzzle", label: "Cipher / Cryptogram", icon: "🔐",
    defaultTitle: "New Cipher Puzzle",
    defaultContent: function () {
      return { cipherType: "caesar", ciphertext: "Enter the ciphertext here.", key: "", acceptedAnswers: ["ANSWER"] };
    },
    summary: function (c) { return (c.cipherType || "cipher") + " — " + (c.acceptedAnswers || []).join(", "); }
  },
  mathLogic: {
    family: "puzzle", label: "Math / Logic Puzzle", icon: "🧮",
    defaultTitle: "New Math / Logic Puzzle",
    defaultContent: function () { return { prompt: "Describe the math or logic puzzle.", expectedValue: "", tolerance: 0, unit: "" }; },
    summary: function (c) { return "Answer: " + c.expectedValue + (c.unit ? " " + c.unit : ""); }
  },
  anagram: {
    family: "puzzle", label: "Anagram / Word Puzzle", icon: "🔤",
    defaultTitle: "New Anagram Puzzle",
    defaultContent: function () { return { scrambled: "TENISL", acceptedAnswers: ["LISTEN"] }; },
    summary: function (c) { return "Scrambled: " + c.scrambled; }
  },
  sequencePattern: {
    family: "puzzle", label: "Sequence / Pattern (Simon-style)", icon: "🎹",
    defaultTitle: "New Sequence Puzzle",
    defaultContent: function () { return { sequence: ["red", "blue", "green"], inputMode: "playerRepeats" }; },
    summary: function (c) { return (c.sequence || []).length + "-step sequence"; }
  },
  slidingTile: {
    family: "puzzle", label: "Sliding Tile / Jigsaw", icon: "🔲",
    defaultTitle: "New Sliding Tile Puzzle",
    defaultContent: function () { return { imageAsset: "", gridSize: 3, solvedState: "" }; },
    summary: function (c) { return c.gridSize + "×" + c.gridSize + " tile puzzle"; }
  },
  multiPartAnswer: {
    family: "puzzle", label: "Multi-Part Answer", icon: "🧷",
    defaultTitle: "New Multi-Part Answer",
    defaultContent: function () {
      return { parts: [{ id: uid("part"), prompt: "Part 1 prompt", acceptedAnswers: ["A"] }, { id: uid("part"), prompt: "Part 2 prompt", acceptedAnswers: ["B"] }], combineRule: "concatenate" };
    },
    summary: function (c) { return (c.parts || []).length + " parts to combine"; }
  },
  physicalLockCode: {
    family: "puzzle", label: "Physical Lock Code Entry", icon: "🔒",
    defaultTitle: "New Lock Code Entry",
    defaultContent: function () { return { codeLength: 4, codeFormat: "numeric", acceptedCode: "1234" }; },
    summary: function (c) { return c.codeFormat + " code, length " + c.codeLength; }
  },
  crossReferenceLookup: {
    family: "puzzle", label: "Cross-Reference Lookup", icon: "🔍",
    defaultTitle: "New Cross-Reference Lookup",
    defaultContent: function () { return { sourceNodeIds: [], prompt: "Combine information from the referenced nodes.", acceptedAnswers: ["ANSWER"] }; },
    summary: function (c) { return "Refs " + (c.sourceNodeIds || []).length + " node(s)"; }
  },
  awardItem: {
    family: "state", label: "Award Item", icon: "🎒",
    defaultTitle: "Award Item",
    defaultContent: function () { return { itemId: "" }; },
    summary: function (c, hunt) { return "Item: " + itemName(hunt, c.itemId); }
  },
  setVariable: {
    family: "state", label: "Set Variable", icon: "🔧",
    defaultTitle: "Set Variable",
    defaultContent: function () { return { variableId: "", operation: "set", value: "1" }; },
    summary: function (c, hunt) { return varName(hunt, c.variableId) + " " + c.operation + " " + c.value; }
  },
  score: {
    family: "state", label: "Score", icon: "🏆",
    defaultTitle: "Score Change",
    defaultContent: function () { return { delta: 1 }; },
    summary: function (c) { return "Score " + (c.delta >= 0 ? "+" : "") + c.delta; }
  },
  combineCraftItem: {
    family: "state", label: "Combine / Craft Item", icon: "🛠️",
    defaultTitle: "Combine / Craft Item",
    defaultContent: function () { return { inputItemIds: [], outputItemId: "" }; },
    summary: function (c, hunt) { return "Crafts: " + itemName(hunt, c.outputItemId); }
  },
  trade: {
    family: "state", label: "Trade", icon: "💱",
    defaultTitle: "Trade",
    defaultContent: function () { return { costType: "score", costValue: 1, rewardType: "hint", rewardId: "" }; },
    summary: function (c) { return "Cost " + c.costValue + " " + c.costType; }
  },
  branch: {
    family: "control", label: "Branch", icon: "🌿",
    defaultTitle: "Branch Point",
    defaultContent: function () { return {}; },
    summary: function () { return "Routes to first satisfied outgoing connection"; }
  },
  convergence: {
    family: "control", label: "Convergence", icon: "🔗",
    defaultTitle: "Convergence",
    defaultContent: function () { return { requiredMode: "all", requiredCount: 2 }; },
    summary: function (c) {
      return c.requiredMode === "all" ? "Requires ALL incoming branches" : "Requires ANY " + c.requiredCount + " of incoming branches";
    }
  },
  ending: {
    family: "control", label: "Ending", icon: "🏁",
    defaultTitle: "New Ending",
    defaultContent: function () { return { resultName: "An Ending", body: "Describe how the hunt concludes." }; },
    summary: function (c) { return "Result: " + c.resultName; }
  },
  gate: {
    family: "control", label: "Gate (multi-condition)", icon: "🚦",
    defaultTitle: "New Gate",
    defaultContent: function () { return { conditionGroups: [] }; },
    summary: function (c) { return (c.conditionGroups || []).length + " condition group(s)"; }
  },
  randomizer: {
    family: "control", label: "Randomizer", icon: "🎲",
    defaultTitle: "New Randomizer",
    defaultContent: function () { return { mode: "uniform", weights: [] }; },
    summary: function (c) { return c.mode + " random routing"; }
  },
  teamSplitMerge: {
    family: "control", label: "Team Split / Merge", icon: "👥",
    defaultTitle: "New Team Split / Merge",
    defaultContent: function () { return { splitCount: 2, mergeNodeId: "" }; },
    summary: function (c) { return "Splits into " + c.splitCount; }
  },
  metaPuzzleCombine: {
    family: "control", label: "Meta-Puzzle / Combine", icon: "🕸️",
    defaultTitle: "New Meta-Puzzle",
    defaultContent: function () { return { sourceNodeIds: [], combineRule: "concatenate", finalPrompt: "Combine the fragments to form the master answer.", acceptedAnswers: ["ANSWER"] }; },
    summary: function (c) { return "Combines " + (c.sourceNodeIds || []).length + " node(s)"; }
  },
  timer: {
    family: "control", label: "Timer", icon: "⏱️",
    defaultTitle: "New Timer",
    defaultContent: function () { return { durationSeconds: 300, onExpireNodeId: "", scope: "node" }; },
    summary: function (c) { return c.durationSeconds + "s (" + c.scope + ")"; }
  },
  attemptLimiter: {
    family: "control", label: "Attempt Limiter / Penalty", icon: "⛔",
    defaultTitle: "New Attempt Limiter",
    defaultContent: function () { return { maxAttempts: 3, penaltyType: "hintAutoReveal", penaltyValue: 0 }; },
    summary: function (c) { return "Max " + c.maxAttempts + " attempts → " + c.penaltyType; }
  },
  hint: {
    family: "support", label: "Hint (progressive)", icon: "💡",
    defaultTitle: "Hint",
    defaultContent: function () {
      return { forNodeId: "", stages: [{ id: uid("hs"), text: "First, gentle nudge." }, { id: uid("hs"), text: "A stronger hint." }] };
    },
    summary: function (c, hunt) { return "For: " + nodeTitle(hunt, c.forNodeId) + " (" + (c.stages || []).length + " stages)"; }
  },
  hintUnlockCost: {
    family: "support", label: "Hint Unlock Cost", icon: "🔓",
    defaultTitle: "Hint (with unlock cost)",
    defaultContent: function () {
      return { forNodeId: "", costType: "score", costPerStage: 1, stages: [{ id: uid("hs"), text: "First, gentle nudge." }, { id: uid("hs"), text: "A stronger hint." }] };
    },
    summary: function (c, hunt) { return "For: " + nodeTitle(hunt, c.forNodeId) + " — costs " + c.costPerStage + " " + c.costType + "/stage"; }
  },
  imageReveal: {
    family: "media", label: "Image Reveal", icon: "🖼️",
    defaultTitle: "New Image Reveal",
    defaultContent: function () { return { imageAsset: "", caption: "", zoomable: true }; },
    summary: function (c) { return c.caption || "Image reveal"; }
  },
  audioReveal: {
    family: "media", label: "Audio Reveal", icon: "🔊",
    defaultTitle: "New Audio Reveal",
    defaultContent: function () { return { audioAsset: "", caption: "", loop: false }; },
    summary: function (c) { return c.caption || "Audio reveal"; }
  },
  videoReveal: {
    family: "media", label: "Video Reveal", icon: "🎬",
    defaultTitle: "New Video Reveal",
    defaultContent: function () { return { videoAsset: "", caption: "" }; },
    summary: function (c) { return c.caption || "Video reveal"; }
  },
  documentReveal: {
    family: "media", label: "Document / Letter Reveal", icon: "📄",
    defaultTitle: "New Document Reveal",
    defaultContent: function () { return { body: "Write the found document's text here.", documentStyle: "letter" }; },
    summary: function (c) { return c.body ? c.body.slice(0, 60) : ""; }
  },
  mapDisplay: {
    family: "media", label: "Map Display", icon: "🗺️",
    defaultTitle: "New Map Display",
    defaultContent: function () { return { mapAsset: "", markers: [] }; },
    summary: function (c) { return (c.markers || []).length + " marker(s)"; }
  },
  gallery: {
    family: "media", label: "Gallery", icon: "🗂️",
    defaultTitle: "New Gallery",
    defaultContent: function () { return { images: [], layout: "grid" }; },
    summary: function (c) { return (c.images || []).length + " image(s)"; }
  },
  photoUploadVerification: {
    family: "input", label: "Photo Upload Verification", icon: "📸",
    defaultTitle: "New Photo Upload",
    defaultContent: function () { return { instructions: "Describe what the player should photograph.", requiresApproval: true }; },
    summary: function (c) { return c.requiresApproval ? "Requires approval" : "Auto-passes"; }
  },
  geolocationCheckIn: {
    family: "input", label: "Geolocation Check-in", icon: "🧭",
    defaultTitle: "New Geolocation Check-in",
    defaultContent: function () { return { lat: 0, lng: 0, radiusMeters: 25 }; },
    summary: function (c) { return "Within " + c.radiusMeters + "m of point"; }
  },
  qrNfcScan: {
    family: "input", label: "QR / NFC Scan Trigger", icon: "📱",
    defaultTitle: "New QR / NFC Scan",
    defaultContent: function () { return { expectedCode: "" }; },
    summary: function (c) { return "Expects code: " + (c.expectedCode || "(unset)"); }
  },
  gameMasterCheckIn: {
    family: "input", label: "Game Master Check-in", icon: "🛂",
    defaultTitle: "New GM Check-in",
    defaultContent: function () { return { instructions: "Describe what the Game Master should verify.", approverNote: "" }; },
    summary: function () { return "Manual Game Master approval"; }
  },
  locationPlaceholder: {
    family: "stub", label: "Location Placeholder (stub)", icon: "📍",
    defaultTitle: "Location (stub)",
    defaultContent: function () { return { placeholderNote: "Location/GPS logic is out of scope for this Phase 1 prototype. This node is a structural stub only." }; },
    summary: function () { return "GPS/map out of scope — stub only"; }
  }
};

var CONDITION_TYPES = {
  always:            { label: "Always (no condition)" },
  nodeComplete:       { label: "Node is complete" },
  allComplete:        { label: "All of these nodes are complete" },
  anyNComplete:       { label: "Any N of these nodes are complete" },
  choiceSelected:     { label: "A specific choice option was selected" },
  variableEquals:     { label: "Variable equals value" },
  variableAtLeast:    { label: "Variable is at least value" },
  itemHeld:           { label: "Player holds item" }
};

var EFFECT_TYPES = {
  awardItem:    { label: "Award item" },
  setVariable:  { label: "Set variable" },
  addScore:     { label: "Add to score" }
};

/* ---------------------------------------------------------------------
   Style packs — pluggable, standalone documents that set the
   player-facing visual/tonal norms for a hunt (fonts, colours, imagery
   treatment, pacing). See docs/PuzzleAtlas_Style_Packs.md and
   style-packs/schema/style-pack.schema.json for the full format.
   These built-ins are embedded so they work with zero network access;
   "studio-default" reproduces the original look exactly, so hunts with
   no style pack chosen render identically everywhere.
--------------------------------------------------------------------- */
var STYLE_PACK_SCHEMA_VERSION = "0.1.0";

var STYLE_PACKS = {
  "studio-default": {
    schemaVersion: STYLE_PACK_SCHEMA_VERSION,
    id: "studio-default", name: "Studio Default",
    description: "The Studio's own neutral dark theme, unchanged. Used when no style pack has been chosen.",
    vibe: { tags: ["neutral", "editor-dark"], toneNotes: "" },
    typography: {
      headingFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      bodyFont: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      monoFont: "'Courier New', Courier, monospace",
      headingTransform: "none", headingLetterSpacing: "normal"
    },
    palette: {
      background: "#1e2129", surface: "#2f3440", text: "#e8eaf0", textDim: "#9aa1b2",
      accent: "#6c8cff", accent2: "#8f6cff", ok: "#57d38c", warn: "#ffb454", danger: "#ff6464",
      families: { narrative: "#5b8def", puzzle: "#e2a33a", state: "#57d38c", control: "#c86bd6", support: "#4fc3c8" }
    },
    shape: { radius: "8px", borderWidth: "1px", borderStyle: "solid" },
    imagery: { treatment: "none", filterCss: "" },
    motion: { pace: "subtle", reducedMotionSafe: true }
  },
  "noir-case-file": {
    schemaVersion: STYLE_PACK_SCHEMA_VERSION,
    id: "noir-case-file", name: "Noir Case-File",
    description: "Dark, moody 1940s pressroom mystery. Serif headlines, warm brass accent, hard-boiled tone.",
    vibe: { tags: ["noir", "1940s pressroom", "urgent", "hard-boiled"], toneNotes: "Clipped, present-tense narration. Short sentences. Let evidence carry the atmosphere." },
    typography: {
      headingFont: "'Playfair Display', Georgia, 'Times New Roman', serif",
      bodyFont: "Georgia, 'Times New Roman', serif",
      monoFont: "'Courier New', Courier, monospace",
      headingTransform: "uppercase", headingLetterSpacing: "0.04em",
      importUrl: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@600;700&display=swap"
    },
    palette: {
      background: "#15120d", surface: "#211c15", text: "#ece4d3", textDim: "#a89a82",
      accent: "#b8862f", accent2: "#7c1f1f", ok: "#6b9c5f", warn: "#c78a2e", danger: "#a3312f",
      families: { narrative: "#8a7554", puzzle: "#b8862f", state: "#6b9c5f", control: "#7c1f1f", support: "#6a8a8c" }
    },
    shape: { radius: "2px", borderWidth: "1px", borderStyle: "solid" },
    imagery: { treatment: "duotone", filterCss: "grayscale(1) sepia(0.35) contrast(1.15)" },
    motion: { pace: "subtle", reducedMotionSafe: true }
  },
  "bright-academic": {
    schemaVersion: STYLE_PACK_SCHEMA_VERSION,
    id: "bright-academic", name: "Bright Academic",
    description: "Light, clean museum-exhibit look. Confident serif headlines, restrained ink-blue accent.",
    vibe: { tags: ["museum exhibit", "archival", "daylight", "precise"], toneNotes: "Measured, curatorial voice. Present facts plainly; let the deduction be the drama." },
    typography: {
      headingFont: "'Source Serif Pro', Georgia, serif",
      bodyFont: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      monoFont: "'IBM Plex Mono', 'Courier New', monospace",
      headingTransform: "none", headingLetterSpacing: "normal",
      importUrl: "https://fonts.googleapis.com/css2?family=Source+Serif+Pro:wght@600;700&family=Inter:wght@400;600&display=swap"
    },
    palette: {
      background: "#f6f3ec", surface: "#ffffff", text: "#211f1b", textDim: "#6b675c",
      accent: "#1f4e79", accent2: "#a8763e", ok: "#2f7d4f", warn: "#b8823a", danger: "#b3352c",
      families: { narrative: "#1f4e79", puzzle: "#a8763e", state: "#2f7d4f", control: "#6a3fa0", support: "#2b7f8c" }
    },
    shape: { radius: "6px", borderWidth: "1px", borderStyle: "solid" },
    imagery: { treatment: "none", filterCss: "" },
    motion: { pace: "subtle", reducedMotionSafe: true }
  },
  "neon-arcade": {
    schemaVersion: STYLE_PACK_SCHEMA_VERSION,
    id: "neon-arcade", name: "Neon Arcade",
    description: "High-contrast, playful, celebratory. Rounded shapes, punchy magenta/cyan accents.",
    vibe: { tags: ["party", "neon", "playful", "high-energy"], toneNotes: "Upbeat, second-person, a little cheeky. Encouraging (not mocking) on wrong answers." },
    typography: {
      headingFont: "'Poppins', 'Segoe UI', sans-serif",
      bodyFont: "'Poppins', 'Segoe UI', sans-serif",
      monoFont: "'Space Mono', 'Courier New', monospace",
      headingTransform: "uppercase", headingLetterSpacing: "0.02em",
      importUrl: "https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&family=Space+Mono&display=swap"
    },
    palette: {
      background: "#1a1030", surface: "#26183f", text: "#f5f0ff", textDim: "#b8a8d8",
      accent: "#ff3fa4", accent2: "#35e0e0", ok: "#4be07f", warn: "#ffcf4d", danger: "#ff5c5c",
      families: { narrative: "#35e0e0", puzzle: "#ff3fa4", state: "#4be07f", control: "#ffcf4d", support: "#9d7bff" }
    },
    shape: { radius: "16px", borderWidth: "2px", borderStyle: "solid" },
    imagery: { treatment: "high-contrast", filterCss: "saturate(1.4) contrast(1.1)" },
    motion: { pace: "dramatic", reducedMotionSafe: true }
  }
};
var DEFAULT_STYLE_PACK_ID = "studio-default";
var BUILTIN_STYLE_PACK_IDS = Object.keys(STYLE_PACKS); // captured before any custom/imported packs are merged in
var _injectedFontUrls = {};

function getStylePack(id) { return clone(STYLE_PACKS[id] || STYLE_PACKS[DEFAULT_STYLE_PACK_ID]); }

function styleFieldsPresent(p) {
  return !!(p && p.typography && p.typography.headingFont && p.typography.bodyFont &&
    p.palette && p.palette.background && p.palette.surface && p.palette.text && p.palette.textDim && p.palette.accent);
}

// Applies a style pack's fonts/colours/shape as CSS custom properties onto
// whichever of `targetIds` exist in the DOM. Defaults to Studio's own three
// player-facing surfaces (Preview overlay, docked mock phone screen, Style
// Builder's live preview) so existing Studio calls are unchanged; a
// standalone Player app passes its own root element id(s) instead. No-ops
// outside a browser (e.g. under Node) and if a target id isn't present.
function applyStylePack(pack, targetIds) {
  if (typeof document === "undefined") return;
  targetIds = targetIds || ["previewOverlay", "phoneScreen", "styleBuilderPreview"];
  pack = pack && styleFieldsPresent(pack) ? pack : getStylePack(DEFAULT_STYLE_PACK_ID);
  var t = pack.typography, pal = pack.palette, sh = pack.shape || {}, img = pack.imagery || {};
  var fam = pal.families || {};
  targetIds.forEach(function (targetId) {
    var target = document.getElementById(targetId);
    if (!target) return;
    var s = target.style;
    s.setProperty("--pv-bg", pal.background);
    s.setProperty("--pv-surface", pal.surface);
    s.setProperty("--pv-text", pal.text);
    s.setProperty("--pv-text-dim", pal.textDim);
    s.setProperty("--pv-accent", pal.accent);
    s.setProperty("--pv-accent2", pal.accent2 || pal.accent);
    s.setProperty("--pv-ok", pal.ok || "#57d38c");
    s.setProperty("--pv-warn", pal.warn || "#ffb454");
    s.setProperty("--pv-danger", pal.danger || "#ff6464");
    s.setProperty("--pv-narrative", fam.narrative || pal.accent);
    s.setProperty("--pv-puzzle", fam.puzzle || pal.accent);
    s.setProperty("--pv-state", fam.state || pal.ok || "#57d38c");
    s.setProperty("--pv-control", fam.control || pal.accent2 || pal.accent);
    s.setProperty("--pv-support", fam.support || pal.accent);
    s.setProperty("--pv-font-heading", t.headingFont);
    s.setProperty("--pv-font-body", t.bodyFont);
    s.setProperty("--pv-font-mono", t.monoFont || t.bodyFont);
    s.setProperty("--pv-heading-transform", t.headingTransform || "none");
    s.setProperty("--pv-heading-letter-spacing", t.headingLetterSpacing || "normal");
    s.setProperty("--pv-radius", sh.radius || "8px");
    s.setProperty("--pv-border-width", sh.borderWidth || "1px");
    s.setProperty("--pv-border-style", sh.borderStyle || "solid");
    s.setProperty("--pv-image-filter", img.filterCss || "none");
  });

  if (t.importUrl && !_injectedFontUrls[t.importUrl]) {
    var link = document.createElement("link");
    link.rel = "stylesheet"; link.href = t.importUrl;
    document.head.appendChild(link);
    _injectedFontUrls[t.importUrl] = true; // best-effort; silently no-ops offline (file://)
  }
}

function familyOf(nodeType) { return (NODE_TYPES[nodeType] || {}).family || "stub"; }
function nodeTitle(hunt, id) { var n = (hunt.nodes || []).find(function (x) { return x.id === id; }); return n ? n.title : "(none)"; }
function varName(hunt, id) { var v = (hunt.variables || []).find(function (x) { return x.id === id; }); return v ? v.name : "(unset)"; }
function itemName(hunt, id) { var it = (hunt.items || []).find(function (x) { return x.id === id; }); return it ? it.name : "(unset)"; }

/* ---------------------------------------------------------------------
   Validation engine — structural graph checks over the canonical model.
   Studio runs this continuously while authoring; a Player app can run it
   once on load to refuse (or warn on) a corrupt/incompatible package.
--------------------------------------------------------------------- */
function collectConditionRefs(cond) {
  var refs = { nodeIds: [], variableIds: [], itemIds: [] };
  if (!cond) return refs;
  if (cond.type === "nodeComplete") refs.nodeIds.push(cond.nodeId);
  if (cond.type === "allComplete" || cond.type === "anyNComplete") refs.nodeIds = refs.nodeIds.concat(cond.nodeIds || []);
  if (cond.type === "choiceSelected") refs.nodeIds.push(cond.nodeId);
  if (cond.type === "variableEquals" || cond.type === "variableAtLeast") refs.variableIds.push(cond.variableId);
  if (cond.type === "itemHeld") refs.itemIds.push(cond.itemId);
  return refs;
}

function validateHunt(hunt) {
  var issues = []; // { level: 'error'|'warning', title, detail, nodeId?, connectionId? }
  var nodeIds = hunt.nodes.map(function (n) { return n.id; });
  var nodeById = {};
  hunt.nodes.forEach(function (n) { nodeById[n.id] = n; });
  var varIds = hunt.variables.map(function (v) { return v.id; });
  var itemIds = hunt.items.map(function (i) { return i.id; });

  // --- Dangling references ---------------------------------------------
  hunt.connections.forEach(function (c) {
    if (nodeIds.indexOf(c.sourceId) === -1) {
      issues.push({ level: "error", title: "Dangling connection source", detail: "Connection " + c.id + " references missing source node " + c.sourceId + ".", connectionId: c.id });
    }
    if (nodeIds.indexOf(c.targetId) === -1) {
      issues.push({ level: "error", title: "Dangling connection target", detail: "Connection " + c.id + " references missing target node " + c.targetId + ".", connectionId: c.id });
    }
    var refs = collectConditionRefs(c.condition);
    refs.nodeIds.forEach(function (id) {
      if (id && nodeIds.indexOf(id) === -1) issues.push({ level: "error", title: "Dangling condition reference", detail: "Connection " + c.id + "'s condition references missing node " + id + ".", connectionId: c.id });
    });
    refs.variableIds.forEach(function (id) {
      if (id && varIds.indexOf(id) === -1) issues.push({ level: "error", title: "Dangling variable reference", detail: "Connection " + c.id + "'s condition references missing variable " + id + ".", connectionId: c.id });
    });
    refs.itemIds.forEach(function (id) {
      if (id && itemIds.indexOf(id) === -1) issues.push({ level: "error", title: "Dangling item reference", detail: "Connection " + c.id + "'s condition references missing item " + id + ".", connectionId: c.id });
    });
  });

  hunt.nodes.forEach(function (n) {
    (n.effects || []).forEach(function (e) {
      if (e.type === "awardItem" && e.itemId && itemIds.indexOf(e.itemId) === -1)
        issues.push({ level: "error", title: "Dangling effect reference", detail: "Node \"" + n.title + "\" awards missing item " + e.itemId + ".", nodeId: n.id });
      if (e.type === "setVariable" && e.variableId && varIds.indexOf(e.variableId) === -1)
        issues.push({ level: "error", title: "Dangling effect reference", detail: "Node \"" + n.title + "\" sets missing variable " + e.variableId + ".", nodeId: n.id });
    });
    if (n.type === "hint") {
      if (n.content.forNodeId && nodeIds.indexOf(n.content.forNodeId) === -1)
        issues.push({ level: "error", title: "Dangling hint target", detail: "Hint \"" + n.title + "\" points at missing node " + n.content.forNodeId + ".", nodeId: n.id });
      if (!n.content.forNodeId)
        issues.push({ level: "warning", title: "Unattached hint", detail: "Hint \"" + n.title + "\" is not attached to any puzzle node.", nodeId: n.id });
    }
    if (n.type === "awardItem" && n.content.itemId && itemIds.indexOf(n.content.itemId) === -1)
      issues.push({ level: "error", title: "Dangling item reference", detail: "Node \"" + n.title + "\" references missing item " + n.content.itemId + ".", nodeId: n.id });
    if (n.type === "setVariable" && n.content.variableId && varIds.indexOf(n.content.variableId) === -1)
      issues.push({ level: "error", title: "Dangling variable reference", detail: "Node \"" + n.title + "\" references missing variable " + n.content.variableId + ".", nodeId: n.id });
  });

  hunt.entryPointIds.forEach(function (id) {
    if (nodeIds.indexOf(id) === -1) issues.push({ level: "error", title: "Dangling entry point", detail: "Entry point references missing node " + id + "." });
  });

  // --- Structural reachability (ignoring hint nodes, which attach via forNodeId) ---
  var adjacency = {};
  hunt.nodes.forEach(function (n) { adjacency[n.id] = []; });
  hunt.connections.forEach(function (c) {
    if (adjacency[c.sourceId]) adjacency[c.sourceId].push(c.targetId);
  });
  var reachable = {};
  var queue = hunt.entryPointIds.slice();
  queue.forEach(function (id) { reachable[id] = true; });
  while (queue.length) {
    var cur = queue.shift();
    (adjacency[cur] || []).forEach(function (t) {
      if (!reachable[t]) { reachable[t] = true; queue.push(t); }
    });
  }
  // hints are "reachable" if their associated puzzle node is reachable
  hunt.nodes.forEach(function (n) {
    if (n.type === "hint" && n.content.forNodeId && reachable[n.content.forNodeId]) reachable[n.id] = true;
  });

  var unreachable = hunt.nodes.filter(function (n) { return !reachable[n.id]; });
  if (hunt.nodes.length === 0) {
    issues.push({ level: "warning", title: "Empty hunt", detail: "This hunt has no nodes yet." });
  } else if (hunt.entryPointIds.length === 0) {
    issues.push({ level: "error", title: "No entry point set", detail: "The hunt has no designated entry point node." });
  }
  unreachable.forEach(function (n) {
    issues.push({ level: "error", title: "Unreachable node", detail: "\"" + n.title + "\" (" + n.type + ") has no path from any entry point.", nodeId: n.id });
  });

  // --- No ending reachable ------------------------------------------------
  var endingReachable = hunt.nodes.some(function (n) { return n.type === "ending" && reachable[n.id]; });
  if (!endingReachable) {
    issues.push({ level: "error", title: "No ending reachable", detail: "No Ending node can be reached from any entry point." });
  }

  // --- Impossible convergence ----------------------------------------------
  hunt.nodes.filter(function (n) { return n.type === "convergence"; }).forEach(function (n) {
    var incoming = hunt.connections.filter(function (c) { return c.targetId === n.id; });
    var distinctSources = incoming.map(function (c) { return c.sourceId; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
    var needed = n.content.requiredMode === "all" ? distinctSources.length : (n.content.requiredCount || 0);
    if (distinctSources.length === 0) {
      issues.push({ level: "error", title: "Convergence has no inputs", detail: "\"" + n.title + "\" has no incoming connections at all.", nodeId: n.id });
      return;
    }
    if (n.content.requiredMode !== "all" && n.content.requiredCount > distinctSources.length) {
      issues.push({ level: "error", title: "Impossible convergence", detail: "\"" + n.title + "\" requires " + n.content.requiredCount + " of only " + distinctSources.length + " incoming branch(es) — can never be satisfied.", nodeId: n.id });
    }
    if (n.content.requiredMode === "all") {
      var anyUnreachableSource = distinctSources.some(function (sid) { return !reachable[sid]; });
      if (anyUnreachableSource) {
        issues.push({ level: "error", title: "Impossible convergence", detail: "\"" + n.title + "\" requires ALL incoming branches to complete, but at least one source branch is unreachable — it can never be satisfied.", nodeId: n.id });
      }
    }
  });

  return issues;
}

/* =========================================================================
   Player interpreter — walks the exported JSON hunt model directly.
   No hard-coded flow: every screen a player sees comes from evaluating
   this data. This is what both Studio's Preview/live mockup and the
   standalone Player app run.
   ========================================================================= */
var AUTO_TYPES = ["branch", "awardItem", "setVariable", "score", "convergence", "ending"];
function isAutoType(t) { return AUTO_TYPES.indexOf(t) !== -1; }

function evaluateCondition(cond, state, hunt) {
  if (!cond) return true;
  switch (cond.type) {
    case "always": return true;
    case "nodeComplete": return !!state.completed[cond.nodeId];
    case "allComplete": return (cond.nodeIds || []).every(function (id) { return !!state.completed[id]; });
    case "anyNComplete":
      var n1 = (cond.nodeIds || []).filter(function (id) { return !!state.completed[id]; }).length;
      return n1 >= (cond.n || 1);
    case "choiceSelected": return state.choiceSelections[cond.nodeId] === cond.optionId;
    case "variableEquals": return String(state.variables[cond.variableId]) === String(cond.value);
    case "variableAtLeast": return Number(state.variables[cond.variableId]) >= Number(cond.value);
    case "itemHeld": return !!state.items[cond.itemId];
    default: return false;
  }
}

function applyEffect(effect, state) {
  if (effect.type === "awardItem") { if (effect.itemId) state.items[effect.itemId] = true; }
  else if (effect.type === "setVariable") {
    var cur = Number(state.variables[effect.variableId]); if (isNaN(cur)) cur = 0;
    var val = Number(effect.value); if (isNaN(val)) val = 0;
    if (effect.operation === "set") state.variables[effect.variableId] = isNaN(Number(effect.value)) ? effect.value : val;
    else if (effect.operation === "increment") state.variables[effect.variableId] = cur + val;
    else if (effect.operation === "decrement") state.variables[effect.variableId] = cur - val;
  } else if (effect.type === "addScore") { state.score += Number(effect.delta) || 0; }
}

function isConnectionAllowed(c, hunt, state) {
  var src = hunt.nodes.find(function (n) { return n.id === c.sourceId; });
  if (src && src.type === "branch") return state.branchChoices[src.id] === c.id;
  return evaluateCondition(c.condition, state, hunt);
}

function convergenceSatisfied(n, hunt, state) {
  var incoming = hunt.connections.filter(function (c) { return c.targetId === n.id; });
  var distinctSources = incoming.map(function (c) { return c.sourceId; }).filter(function (v, i, a) { return a.indexOf(v) === i; });
  if (!distinctSources.length) return false;
  var satisfied = distinctSources.filter(function (sid) {
    return state.completed[sid] && incoming.some(function (c) { return c.sourceId === sid && isConnectionAllowed(c, hunt, state); });
  });
  var needed = n.content.requiredMode === "all" ? distinctSources.length : (n.content.requiredCount || 1);
  return satisfied.length >= needed;
}

function completeNodeInternal(n, hunt, state) {
  state.completed[n.id] = true;
  state.history.push({ nodeId: n.id, title: n.title, type: n.type, t: Date.now() });
  (n.effects || []).forEach(function (e) { applyEffect(e, state); });
  if (n.type === "branch") {
    var outs = hunt.connections.filter(function (c) { return c.sourceId === n.id; }).slice().sort(function (a, b) { return a.priority - b.priority; });
    var winner = outs.find(function (c) { return evaluateCondition(c.condition, state, hunt); });
    state.branchChoices[n.id] = winner ? winner.id : null;
  }
  if (n.type === "ending") state.endingReached = n.id;
}

function recompute(session) {
  var hunt = session.hunt, state = session.state, changed = true, iter = 0;
  while (changed && iter++ < 2000) {
    changed = false;
    hunt.nodes.forEach(function (n) {
      if (state.completed[n.id] || state.available[n.id]) return;
      if (hunt.entryPointIds.indexOf(n.id) !== -1) { state.available[n.id] = true; changed = true; return; }
      if (n.type === "hint") return; // hints are surfaced via their attached puzzle, not the main graph
      if (n.type === "convergence") {
        if (convergenceSatisfied(n, hunt, state)) { state.available[n.id] = true; changed = true; }
        return;
      }
      var incoming = hunt.connections.filter(function (c) { return c.targetId === n.id; });
      var ok = incoming.some(function (c) { return state.completed[c.sourceId] && isConnectionAllowed(c, hunt, state); });
      if (ok) { state.available[n.id] = true; changed = true; }
    });
    hunt.nodes.forEach(function (n) {
      if (!state.available[n.id] || state.completed[n.id]) return;
      if (isAutoType(n.type)) { completeNodeInternal(n, hunt, state); changed = true; }
    });
  }
}

function createSession(hunt) {
  var state = {
    completed: {}, available: {}, variables: {}, items: {}, score: 0,
    choiceSelections: {}, branchChoices: {}, hintProgress: {}, history: [], endingReached: null,
    feedback: {}
  };
  (hunt.variables || []).forEach(function (v) { state.variables[v.id] = v.initial; });
  var session = { hunt: hunt, state: state };
  recompute(session);
  return session;
}

function normalizeAnswer(s, caseSensitive) {
  s = String(s || "").trim();
  return caseSensitive ? s : s.toLowerCase();
}

// Shared "does this free-text answer match one of the accepted answers"
// check — used by Answer Entry and by every puzzle-family node that's
// mechanically a themed variant of it (Cipher, Anagram, Cross-Reference
// Lookup). Defaults to case-insensitive when a node type's content has no
// caseSensitive field of its own.
function checkTextAnswer(content, text) {
  var caseSensitive = !!content.caseSensitive;
  return (content.acceptedAnswers || []).some(function (a) { return normalizeAnswer(a, caseSensitive) === normalizeAnswer(text, caseSensitive); });
}

// Sliding Tile helpers — a classic numbered slide puzzle (no image asset
// support yet, see the Node Type Expansion draft's open question on asset
// storage) used as the simple functioning demo for this node type. Tiles
// are stored as a flat array, 0 standing in for the empty cell.
function tileNeighbors(idx, size) {
  var r = Math.floor(idx / size), col = idx % size, out = [];
  if (r > 0) out.push(idx - size);
  if (r < size - 1) out.push(idx + size);
  if (col > 0) out.push(idx - 1);
  if (col < size - 1) out.push(idx + 1);
  return out;
}
function solvedTileOrder(size) {
  var out = []; for (var i = 1; i < size * size; i++) out.push(i); out.push(0); return out;
}
// Always shuffles by performing random legal slides from the solved state,
// which guarantees the result stays solvable (no illegal-permutation risk).
function generateSolvableTiles(size) {
  var tiles = solvedTileOrder(size);
  var blank = tiles.length - 1;
  var steps = size * size * 25;
  for (var s = 0; s < steps; s++) {
    var neighbors = tileNeighbors(blank, size);
    var pick = neighbors[Math.floor(Math.random() * neighbors.length)];
    tiles[blank] = tiles[pick]; tiles[pick] = 0; blank = pick;
  }
  return tiles;
}

function pv_action_continueScene(session, nodeId) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  completeNodeInternal(n, session.hunt, session.state);
  recompute(session);
}
function pv_action_selectChoice(session, nodeId, optionId) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  session.state.choiceSelections[nodeId] = optionId;
  completeNodeInternal(n, session.hunt, session.state);
  recompute(session);
}
function pv_action_submitAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = checkTextAnswer(n.content, text);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitOrdering(session, nodeId, orderIds) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = JSON.stringify(orderIds) === JSON.stringify(n.content.correctOrder);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMatching(session, nodeId, pairs) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var norm = function (arr) { return arr.map(function (p) { return p[0] + ":" + p[1]; }).sort().join(","); };
  var ok = norm(pairs) === norm(n.content.correctPairs);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
// --- Node Type Expansion: simple functioning submit actions for the
// puzzle-family types added alongside Answer Entry/Ordering/Matching.
// Each follows the same shape as the actions above: validate, record
// feedback, and on success complete the node + recompute availability.
function pv_action_submitCipherAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = checkTextAnswer(n.content, text);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMathAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var val = parseFloat(text), expected = parseFloat(n.content.expectedValue);
  var tolerance = Math.abs(Number(n.content.tolerance)) || 0;
  var ok = !isNaN(val) && !isNaN(expected) && Math.abs(val - expected) <= tolerance;
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitAnagramAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = checkTextAnswer(n.content, text);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitSequence(session, nodeId, attempt) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = JSON.stringify(attempt) === JSON.stringify(n.content.sequence || []);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitSlidingTile(session, nodeId, tiles) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var size = Number(n.content.gridSize) || 3;
  var ok = JSON.stringify(tiles) === JSON.stringify(solvedTileOrder(size));
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMultiPartAnswer(session, nodeId, partAnswers) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var parts = n.content.parts || [];
  var ok = parts.length > 0 && parts.every(function (p) { return checkTextAnswer(p, (partAnswers || {})[p.id] || ""); });
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitLockCode(session, nodeId, code) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var normalize = function (s) {
    s = String(s || "").trim();
    return n.content.codeFormat === "alpha" ? s.toUpperCase().replace(/[^A-Z]/g, "") : s.replace(/\D/g, "");
  };
  var ok = normalize(code) === normalize(n.content.acceptedCode) && normalize(code).length > 0;
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitCrossReferenceAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = checkTextAnswer(n.content, text);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

function pv_action_revealHint(session, hintNodeId) {
  var cur = session.state.hintProgress[hintNodeId] || 0;
  var n = session.hunt.nodes.find(function (x) { return x.id === hintNodeId; });
  if (cur < n.content.stages.length) session.state.hintProgress[hintNodeId] = cur + 1;
}

/* ---------------------------------------------------------------------
   Preview / Player UI — a reusable controller factory. It renders the
   node markup and wires interactions purely in terms of a mainEl/sideEl
   root pair, so it has no idea whether it's running inside Studio's
   Preview overlay, Studio's docked live mockup, or a standalone Player
   app screen. Each controller owns its own session and UI state, and
   only ever queries inside its own root element, so several can be on
   screen at once without id clashes.
--------------------------------------------------------------------- */
var PLAYER_SCREEN_TYPES = ["scene", "choice", "answerEntry", "ordering", "matching", "locationPlaceholder", "ending",
  "cipher", "mathLogic", "anagram", "sequencePattern", "slidingTile", "multiPartAnswer", "physicalLockCode", "crossReferenceLookup"];

function openLeadNodes(session) {
  var hunt = session.hunt, state = session.state;
  return hunt.nodes.filter(function (n) {
    return state.available[n.id] && !state.completed[n.id] && !isAutoType(n.type) && n.type !== "hint";
  });
}

function hintsForNode(hunt, nodeId) {
  return hunt.nodes.filter(function (n) { return n.type === "hint" && n.content.forNodeId === nodeId; });
}

// Which nodes placed in a given lane+scene cell of the canvas are
// currently player-facing "options" — the same availability rules that
// already drive the Open Leads list and the canvas's player-here/
// player-open highlighting, just scoped to one lane×scene cell instead
// of the whole graph. Interactive types (puzzles, choices) count while
// still open (available, not yet completed) — an already-solved one
// isn't something to pursue anymore. Auto types (award item, score, set
// variable, branch, convergence) resolve the instant they're reached, so
// they're counted once they've fired at least once — for the Inventory
// lane this reads as "what this scene has unlocked so far". Hint nodes
// are counted when the puzzle they're attached to is currently open,
// wherever in the lane grid the hint itself happens to be placed.
function laneOptionsForScene(session, laneId, sceneId) {
  var hunt = session.hunt, state = session.state;
  var inScene = hunt.nodes.filter(function (n) {
    return n.lane === laneId && (n.sceneId || null) === (sceneId || null);
  });
  return inScene.filter(function (n) {
    if (n.type === "hint") {
      var target = n.content && n.content.forNodeId;
      return !!target && !!state.available[target] && !state.completed[target];
    }
    if (isAutoType(n.type)) return !!state.available[n.id];
    return !!state.available[n.id] && !state.completed[n.id];
  });
}

var LANE_LIST_TITLES = { leads: "Open leads", inventory: "Evidence & discoveries", hints: "Hints" };

// Renders the list markup for a lane tab tap: leads are clickable
// (data-lead, same mechanism as the Open Leads list) since they're
// live player screens; inventory entries are read-only summaries of
// what's fired in this scene's Inventory lane so far; hints are
// rendered as their normal progressive reveal control, labelled with
// which puzzle each one belongs to since more than one can be open at
// once. Caller is responsible for wiring [data-lead]/[data-hint] after
// inserting this into the DOM (see ctl.render / wireHintButtons).
function renderLaneOptionsList(session, laneId, nodes) {
  var hunt = session.hunt, state = session.state;
  var title = LANE_LIST_TITLES[laneId] || "Options";
  var html = '<p class="pv-side-title">' + esc(title) + (nodes.length ? " (" + nodes.length + ")" : "") + '</p>';
  if (!nodes.length) {
    html += '<div class="pv-empty" style="padding-top:20px">Nothing available here yet in this scene.</div>';
    return html;
  }
  if (laneId === "hints") {
    nodes.forEach(function (h) {
      var shown = state.hintProgress[h.id] || 0;
      html += '<div style="margin-bottom:16px"><div style="color:var(--pv-text-dim);font-size:11.5px;margin-bottom:4px">For: ' + esc(nodeTitle(hunt, h.content.forNodeId)) + '</div>';
      html += '<button class="pv-hint-btn" data-hint="' + h.id + '" ' + (shown >= h.content.stages.length ? "disabled" : "") + '>💡 Reveal hint (' + shown + "/" + h.content.stages.length + ')</button>';
      for (var i = 0; i < shown; i++) html += '<div class="pv-hint-text">' + esc(h.content.stages[i].text) + '</div>';
      html += '</div>';
    });
  } else if (laneId === "inventory") {
    nodes.forEach(function (n) {
      html += '<div class="pv-info-card">' + NODE_TYPES[n.type].icon + " " + esc(NODE_TYPES[n.type].summary(n.content, hunt)) + '</div>';
    });
  } else {
    nodes.forEach(function (n) {
      html += '<div class="pv-choice-btn" data-lead="' + n.id + '">' + NODE_TYPES[n.type].icon + " " + esc(n.title) + '</div>';
    });
  }
  return html;
}

// Shared by wirePreviewNodeInteractions (hints attached to whatever
// node is on screen) and the lane-list view (hints across a whole
// scene at once) — doesn't depend on which node is "current".
function wireHintButtons(session, root, ctl) {
  Array.prototype.forEach.call(root.querySelectorAll("[data-hint]"), function (btn) {
    btn.onclick = function () { pv_action_revealHint(session, btn.dataset.hint); ctl.render(); };
  });
}

function renderPreviewNode(session, n, ctl) {
  var c = n.content, html = "";
  var hints = hintsForNode(session.hunt, n.id);
  if (n.type === "scene") {
    if (c.mediaUrl) {
      var sceneMediaTag = c.mediaType === "video"
        ? '<video class="pv-scene-media" src="' + esc(c.mediaUrl) + '" autoplay loop muted playsinline></video>'
        : '<img class="pv-scene-media" src="' + esc(c.mediaUrl) + '" alt="" />';
      html += '<div class="pv-scene-media-wrap">' + sceneMediaTag +
        '<div class="pv-scene-textpane"><div class="pv-scene-body">' + esc(c.body) + '</div>' +
        '<button class="pv-choice-btn" id="pvContinue" style="max-width:200px">Continue →</button></div></div>';
    } else {
      html += '<div class="pv-scene-body">' + esc(c.body) + '</div><button class="pv-choice-btn" id="pvContinue" style="max-width:200px">Continue →</button>';
    }
  } else if (n.type === "choice") {
    html += '<div class="pv-scene-body">' + esc(c.body) + '</div>';
    c.options.forEach(function (o) { html += '<button class="pv-option-btn" data-opt="' + o.id + '">' + esc(o.label) + '</button>'; });
  } else if (n.type === "answerEntry") {
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvAnswerInput" placeholder="Type your answer…" />';
    html += '<button class="pv-choice-btn" id="pvSubmitAnswer" style="max-width:160px">Submit</button>';
    var fb = session.state.feedback[n.id];
    if (fb) html += '<div class="pv-feedback ' + fb + '">' + (fb === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "ordering") {
    if (!ctl.orderingDraft[n.id]) ctl.orderingDraft[n.id] = c.items.map(function (it) { return it.id; });
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    ctl.orderingDraft[n.id].forEach(function (id, idx) {
      var it = c.items.find(function (x) { return x.id === id; });
      html += '<div class="list-item" data-ordidx="' + idx + '"><span class="chip">' + (idx + 1) + '</span><span style="flex:1">' + esc(it.label) + '</span><button class="small-btn ordUpPv">↑</button><button class="small-btn ordDownPv">↓</button></div>';
    });
    html += '<button class="pv-choice-btn" id="pvSubmitOrdering" style="max-width:160px;margin-top:10px">Submit order</button>';
    var fb2 = session.state.feedback[n.id];
    if (fb2) html += '<div class="pv-feedback ' + fb2 + '">' + (fb2 === "correct" ? "✓ Correct order." : "✗ Not the right order — try again.") + '</div>';
  } else if (n.type === "matching") {
    if (!ctl.matchingDraft[n.id]) {
      ctl.matchingDraft[n.id] = {};
      c.left.forEach(function (l) { ctl.matchingDraft[n.id][l.id] = c.right[0] ? c.right[0].id : ""; });
    }
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    c.left.forEach(function (l) {
      html += '<div class="list-item"><span style="flex:1">' + esc(l.label) + ' →</span><select class="pvPairSelect" data-lid="' + l.id + '">' +
        c.right.map(function (r) { return '<option value="' + r.id + '"' + (ctl.matchingDraft[n.id][l.id] === r.id ? " selected" : "") + '>' + esc(r.label) + '</option>'; }).join("") + '</select></div>';
    });
    html += '<button class="pv-choice-btn" id="pvSubmitMatching" style="max-width:160px;margin-top:10px">Submit matches</button>';
    var fb3 = session.state.feedback[n.id];
    if (fb3) html += '<div class="pv-feedback ' + fb3 + '">' + (fb3 === "correct" ? "✓ Correct matches." : "✗ Some pairs are wrong — try again.") + '</div>';
  } else if (n.type === "locationPlaceholder") {
    html += '<div class="pv-scene-body">' + esc(c.placeholderNote) + '</div><button class="pv-choice-btn" id="pvContinue" style="max-width:200px">Continue →</button>';
  } else if (n.type === "cipher") {
    html += '<div class="pv-mono-block">' + esc(c.ciphertext) + '</div>';
    html += '<div class="pv-info-card">Cipher: ' + esc(c.cipherType || "cipher") + (c.key ? " · Key: " + esc(c.key) : "") + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvCipherInput" placeholder="Type the decoded answer…" />';
    html += '<button class="pv-choice-btn" id="pvSubmitCipher" style="max-width:160px">Submit</button>';
    var fbCi = session.state.feedback[n.id];
    if (fbCi) html += '<div class="pv-feedback ' + fbCi + '">' + (fbCi === "correct" ? "✓ Decoded correctly." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "mathLogic") {
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<input type="text" inputmode="decimal" class="pv-answer-input" id="pvMathInput" placeholder="Enter a number' + (c.unit ? " (" + esc(c.unit) + ")" : "") + '…" />';
    html += '<button class="pv-choice-btn" id="pvSubmitMath" style="max-width:160px">Submit</button>';
    var fbMa = session.state.feedback[n.id];
    if (fbMa) html += '<div class="pv-feedback ' + fbMa + '">' + (fbMa === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "anagram") {
    html += '<div class="pv-mono-block">' + esc((c.scrambled || "").toUpperCase().split("").join(" ")) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvAnagramInput" placeholder="Type the unscrambled word/phrase…" />';
    html += '<button class="pv-choice-btn" id="pvSubmitAnagram" style="max-width:160px">Submit</button>';
    var fbAn = session.state.feedback[n.id];
    if (fbAn) html += '<div class="pv-feedback ' + fbAn + '">' + (fbAn === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "sequencePattern") {
    if (!ctl.sequenceDraft[n.id]) ctl.sequenceDraft[n.id] = [];
    var seq = c.sequence || [];
    var palette = seq.filter(function (v, i) { return seq.indexOf(v) === i; });
    html += '<div class="pv-scene-body">Tap ▶ to watch the sequence, then repeat it by tapping the swatches in the same order.</div>';
    html += '<button class="pv-choice-btn" id="pvPlaySequence" style="max-width:160px">▶ Play sequence</button>';
    html += '<div class="pv-swatch-row" id="pvSeqSwatches">' + palette.map(function (v) {
      return '<button class="pv-swatch" data-seqval="' + esc(v) + '" style="background:' + esc(v) + '" title="' + esc(v) + '"></button>';
    }).join("") + '</div>';
    html += '<div class="pv-scene-body" style="margin-top:10px;font-size:12.5px;color:var(--pv-text-dim)">Your input: ' +
      (ctl.sequenceDraft[n.id].length ? ctl.sequenceDraft[n.id].map(esc).join(" → ") : "(nothing yet)") + '</div>';
    html += '<button class="pv-choice-btn" id="pvClearSequence" style="max-width:160px">Clear</button>';
    var fbSe = session.state.feedback[n.id];
    if (fbSe) html += '<div class="pv-feedback ' + fbSe + '">' + (fbSe === "correct" ? "✓ Sequence matched." : "✗ Wrong order — try again.") + '</div>';
  } else if (n.type === "slidingTile") {
    var size = Number(c.gridSize) || 3;
    if (!ctl.tileDraft[n.id]) ctl.tileDraft[n.id] = generateSolvableTiles(size);
    var tiles = ctl.tileDraft[n.id];
    html += '<div class="pv-scene-body">Slide the tiles (click one next to the empty space) to put them back in order, 1 through ' + (size * size - 1) + '.</div>';
    html += '<div class="pv-tile-grid" style="grid-template-columns:repeat(' + size + ',1fr)">';
    tiles.forEach(function (v, idx) {
      html += v === 0 ? '<div class="pv-tile pv-tile-blank"></div>' : '<button class="pv-tile" data-tileidx="' + idx + '">' + v + '</button>';
    });
    html += '</div>';
    html += '<button class="pv-choice-btn" id="pvShuffleTiles" style="max-width:160px;margin-top:10px">🔀 Shuffle again</button>';
  } else if (n.type === "multiPartAnswer") {
    if (!ctl.multiPartDraft[n.id]) {
      ctl.multiPartDraft[n.id] = {};
      (c.parts || []).forEach(function (p) { ctl.multiPartDraft[n.id][p.id] = ""; });
    }
    html += '<div class="pv-scene-body">Answer each part below, then submit them together.</div>';
    (c.parts || []).forEach(function (p, i) {
      html += '<div class="pv-part-block"><div class="pv-part-label">Part ' + (i + 1) + '</div>' +
        '<div class="pv-scene-body" style="margin-bottom:8px;font-size:13.5px">' + esc(p.prompt) + '</div>' +
        '<input type="text" class="pv-answer-input pvPartInput" data-partid="' + p.id + '" placeholder="Answer…" value="' + esc(ctl.multiPartDraft[n.id][p.id] || "") + '" /></div>';
    });
    html += '<button class="pv-choice-btn" id="pvSubmitMultiPart" style="max-width:160px">Submit all parts</button>';
    var fbMp = session.state.feedback[n.id];
    if (fbMp) html += '<div class="pv-feedback ' + fbMp + '">' + (fbMp === "correct" ? "✓ All parts correct." : "✗ One or more parts are wrong — try again.") + '</div>';
  } else if (n.type === "physicalLockCode") {
    html += '<div class="pv-scene-body">Enter the ' + (c.codeLength || 4) + '-character ' + (c.codeFormat === "alpha" ? "letter" : "numeric") + ' code from the lock.</div>';
    html += '<input type="text" class="pv-answer-input pv-keypad-input" id="pvLockInput" maxlength="' + (c.codeLength || 4) +
      '" placeholder="' + (c.codeFormat === "alpha" ? "ABCD" : "0000") + '" inputmode="' + (c.codeFormat === "alpha" ? "text" : "numeric") + '" />';
    html += '<button class="pv-choice-btn" id="pvSubmitLock" style="max-width:160px">Unlock</button>';
    var fbLo = session.state.feedback[n.id];
    if (fbLo) html += '<div class="pv-feedback ' + fbLo + '">' + (fbLo === "correct" ? "✓ Unlocked." : "✗ Incorrect code — try again.") + '</div>';
  } else if (n.type === "crossReferenceLookup") {
    var srcTitles = (c.sourceNodeIds || []).map(function (id) { return nodeTitle(session.hunt, id); });
    if (srcTitles.length) html += '<div class="pv-info-card">References: ' + esc(srcTitles.join(", ")) + '</div>';
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvCrossRefInput" placeholder="Type your answer…" />';
    html += '<button class="pv-choice-btn" id="pvSubmitCrossRef" style="max-width:160px">Submit</button>';
    var fbCr = session.state.feedback[n.id];
    if (fbCr) html += '<div class="pv-feedback ' + fbCr + '">' + (fbCr === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  }
  if (hints.length) {
    html += '<div style="margin-top:14px">';
    hints.forEach(function (h) {
      var shown = session.state.hintProgress[h.id] || 0;
      html += '<div><button class="pv-hint-btn" data-hint="' + h.id + '" ' + (shown >= h.content.stages.length ? "disabled" : "") + '>💡 Reveal hint (' + shown + "/" + h.content.stages.length + ')</button>';
      for (var i = 0; i < shown; i++) html += '<div class="pv-hint-text">' + esc(h.content.stages[i].text) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  return html;
}

// Shared wiring for the several puzzle types that are just "one text
// input + one submit button" (Cipher, Math/Logic, Anagram, Physical Lock
// Code, Cross-Reference Lookup) — Enter submits, success clears the
// pinned/expanded view same as every other puzzle type. A no-op when
// this node's markup doesn't include the given ids (i.e. it's some other
// node type), same as the existing per-type `if (byId(...))` guards.
function wireTextSubmitAction(root, ctl, session, n, inputId, btnId, submitFn) {
  var byId = function (id) { return root.querySelector("#" + id); };
  if (!byId(btnId) || !byId(inputId)) return;
  var submit = function () {
    var ok = submitFn(session, n.id, byId(inputId).value);
    if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };
  byId(btnId).onclick = submit;
  byId(inputId).onkeydown = function (e) { if (e.key === "Enter") submit(); };
}

function wirePreviewNodeInteractions(session, n, ctl) {
  if (!n) return;
  var root = ctl.mainEl;
  var byId = function (id) { return root.querySelector("#" + id); };
  if (byId("pvContinue")) byId("pvContinue").onclick = function () { pv_action_continueScene(session, n.id); ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); };
  Array.prototype.forEach.call(root.querySelectorAll("[data-opt]"), function (el) {
    el.onclick = function () { pv_action_selectChoice(session, n.id, el.dataset.opt); ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); };
  });
  if (byId("pvSubmitAnswer")) {
    var submit = function () { pv_action_submitAnswer(session, n.id, byId("pvAnswerInput").value); if (session.state.feedback[n.id] === "correct") { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; } ctl.render(); };
    byId("pvSubmitAnswer").onclick = submit;
    byId("pvAnswerInput").onkeydown = function (e) { if (e.key === "Enter") submit(); };
  }
  Array.prototype.forEach.call(root.querySelectorAll(".ordUpPv"), function (btn) {
    btn.onclick = function () {
      var row = btn.closest("[data-ordidx]"); var idx = +row.dataset.ordidx; var arr = ctl.orderingDraft[n.id];
      if (idx > 0) { var t = arr[idx - 1]; arr[idx - 1] = arr[idx]; arr[idx] = t; ctl.render(); }
    };
  });
  Array.prototype.forEach.call(root.querySelectorAll(".ordDownPv"), function (btn) {
    btn.onclick = function () {
      var row = btn.closest("[data-ordidx]"); var idx = +row.dataset.ordidx; var arr = ctl.orderingDraft[n.id];
      if (idx < arr.length - 1) { var t = arr[idx + 1]; arr[idx + 1] = arr[idx]; arr[idx] = t; ctl.render(); }
    };
  });
  if (byId("pvSubmitOrdering")) byId("pvSubmitOrdering").onclick = function () {
    pv_action_submitOrdering(session, n.id, ctl.orderingDraft[n.id]);
    if (session.state.feedback[n.id] === "correct") { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };
  Array.prototype.forEach.call(root.querySelectorAll(".pvPairSelect"), function (sel) {
    sel.onchange = function (e) { ctl.matchingDraft[n.id][sel.dataset.lid] = e.target.value; };
  });
  if (byId("pvSubmitMatching")) byId("pvSubmitMatching").onclick = function () {
    var pairs = Object.keys(ctl.matchingDraft[n.id]).map(function (lid) { return [lid, ctl.matchingDraft[n.id][lid]]; });
    pv_action_submitMatching(session, n.id, pairs);
    if (session.state.feedback[n.id] === "correct") { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };

  // Simple text-answer puzzle variants (Cipher, Math/Logic, Anagram,
  // Physical Lock Code, Cross-Reference Lookup) — each a no-op unless its
  // own markup is what's currently on screen.
  wireTextSubmitAction(root, ctl, session, n, "pvCipherInput", "pvSubmitCipher", pv_action_submitCipherAnswer);
  wireTextSubmitAction(root, ctl, session, n, "pvMathInput", "pvSubmitMath", pv_action_submitMathAnswer);
  wireTextSubmitAction(root, ctl, session, n, "pvAnagramInput", "pvSubmitAnagram", pv_action_submitAnagramAnswer);
  wireTextSubmitAction(root, ctl, session, n, "pvLockInput", "pvSubmitLock", pv_action_submitLockCode);
  wireTextSubmitAction(root, ctl, session, n, "pvCrossRefInput", "pvSubmitCrossRef", pv_action_submitCrossReferenceAnswer);

  // Sequence / Pattern — tap swatches in order; auto-validates once the
  // attempt is as long as the target sequence, resetting on a miss.
  if (byId("pvPlaySequence")) {
    byId("pvPlaySequence").onclick = function () {
      var seq = n.content.sequence || [];
      var btns = root.querySelectorAll("#pvSeqSwatches [data-seqval]");
      seq.forEach(function (val, i) {
        setTimeout(function () {
          var btn = Array.prototype.filter.call(btns, function (b) { return b.dataset.seqval === String(val); })[0];
          if (!btn) return;
          btn.classList.add("playing");
          setTimeout(function () { btn.classList.remove("playing"); }, 350);
        }, i * 550);
      });
    };
  }
  Array.prototype.forEach.call(root.querySelectorAll("#pvSeqSwatches [data-seqval]"), function (btn) {
    btn.onclick = function () {
      ctl.sequenceDraft[n.id] = ctl.sequenceDraft[n.id] || [];
      ctl.sequenceDraft[n.id].push(btn.dataset.seqval);
      var target = n.content.sequence || [];
      if (ctl.sequenceDraft[n.id].length >= target.length) {
        var ok = pv_action_submitSequence(session, n.id, ctl.sequenceDraft[n.id]);
        if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
        else ctl.sequenceDraft[n.id] = [];
      }
      ctl.render();
    };
  });
  if (byId("pvClearSequence")) byId("pvClearSequence").onclick = function () { ctl.sequenceDraft[n.id] = []; ctl.render(); };

  // Sliding Tile — click a tile adjacent to the blank to slide it in;
  // auto-validates after every move.
  Array.prototype.forEach.call(root.querySelectorAll("[data-tileidx]"), function (btn) {
    btn.onclick = function () {
      var idx = +btn.dataset.tileidx;
      var size = Number(n.content.gridSize) || 3;
      var tiles = ctl.tileDraft[n.id];
      if (!tiles) return;
      var blank = tiles.indexOf(0);
      if (tileNeighbors(blank, size).indexOf(idx) === -1) return;
      tiles[blank] = tiles[idx]; tiles[idx] = 0;
      var ok = pv_action_submitSlidingTile(session, n.id, tiles);
      if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
      ctl.render();
    };
  });
  if (byId("pvShuffleTiles")) byId("pvShuffleTiles").onclick = function () {
    ctl.tileDraft[n.id] = generateSolvableTiles(Number(n.content.gridSize) || 3);
    ctl.render();
  };

  // Multi-Part Answer — each part's input is tracked independently; submit
  // checks every part at once.
  Array.prototype.forEach.call(root.querySelectorAll(".pvPartInput"), function (inp) {
    inp.oninput = function (e) {
      ctl.multiPartDraft[n.id] = ctl.multiPartDraft[n.id] || {};
      ctl.multiPartDraft[n.id][inp.dataset.partid] = e.target.value;
    };
  });
  if (byId("pvSubmitMultiPart")) byId("pvSubmitMultiPart").onclick = function () {
    var ok = pv_action_submitMultiPartAnswer(session, n.id, ctl.multiPartDraft[n.id]);
    if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };

  wireHintButtons(session, root, ctl);
}

// Renders whatever node was pinned via ctl.showNode() (e.g. a Studio
// canvas selection) exactly as the player screen would — no creator
// chrome overlaid — and hands control back to the normal auto-following
// flow as soon as the player actually interacts with something.
function renderPinnedNode(session, n, ctl) {
  var state = session.state;

  if (n.type === "ending") {
    ctl.mainEl.innerHTML = '<div class="pv-ending"><h2>🏁 ' + esc(n.content.resultName) + '</h2><p class="pv-scene-body">' + esc(n.content.body) + '</p></div>';
    ctl._activeIds = { expandedId: n.id, leadIds: openLeadNodes(session).map(function (x) { return x.id; }) };
    return;
  }
  if (PLAYER_SCREEN_TYPES.indexOf(n.type) === -1) {
    ctl.mainEl.innerHTML = '<div class="pv-empty" style="padding-top:16px">' + NODE_TYPES[n.type].icon + " " + esc(NODE_TYPES[n.type].label) +
      ' nodes run automatically and have no standalone player screen.' + (n.type === "hint" ? " Hints appear attached to their puzzle node instead." : "") + '</div>';
    ctl._activeIds = { expandedId: n.id, leadIds: openLeadNodes(session).map(function (x) { return x.id; }) };
    return;
  }
  ctl.mainEl.innerHTML = renderPreviewNode(session, n, ctl);
  // Already-completed nodes are shown read-only — wiring their controls
  // again would let a resubmit silently double up effects like score.
  if (!state.completed[n.id]) wirePreviewNodeInteractions(session, n, ctl);
  ctl._activeIds = { expandedId: n.id, leadIds: openLeadNodes(session).map(function (x) { return x.id; }) };
}

function createPreviewController(mainEl, sideEl) {
  var ctl = {
    mainEl: mainEl, sideEl: sideEl,
    session: null, expandedNodeId: null, showState: false,
    orderingDraft: {}, matchingDraft: {},
    sequenceDraft: {}, tileDraft: {}, multiPartDraft: {},
    pinnedNodeId: null, // set when an outside selection (e.g. the canvas) asks to force-show a node
    laneListId: null, laneListSceneId: null, // set when a lane tab (Leads/Inventory/Hints) asks to show its scene-wide options list instead of a single node
    _activeIds: { expandedId: null, leadIds: [] },
    onRender: null
  };

  ctl.open = function (hunt) {
    ctl.session = createSession(hunt);
    ctl.expandedNodeId = null;
    ctl.showState = false;
    ctl.orderingDraft = {};
    ctl.matchingDraft = {};
    ctl.sequenceDraft = {};
    ctl.tileDraft = {};
    ctl.multiPartDraft = {};
    ctl.pinnedNodeId = null;
    ctl.laneListId = null;
    ctl.laneListSceneId = null;
    ctl.render();
  };

  ctl.restart = function () { if (ctl.session) ctl.open(ctl.session.hunt); };

  // Force the view to show a specific node regardless of the normal
  // "current open leads" flow — used when a node is selected on canvas.
  ctl.showNode = function (nodeId) { ctl.pinnedNodeId = nodeId; ctl.laneListId = null; ctl.render(); };
  // Force the view to show every currently-available option in one lane
  // × scene cell (Leads/Inventory/Hints tab bar taps) instead of jumping
  // straight into a single node.
  ctl.showLaneList = function (laneId, sceneId) { ctl.laneListId = laneId; ctl.laneListSceneId = sceneId || null; ctl.pinnedNodeId = null; ctl.render(); };
  ctl.clearPin = function () { if (ctl.pinnedNodeId || ctl.laneListId) { ctl.pinnedNodeId = null; ctl.laneListId = null; ctl.render(); } };

  ctl.render = function () {
    var session = ctl.session;
    if (!session) return;
    var hunt = session.hunt, state = session.state;
    var main = ctl.mainEl, side = ctl.sideEl;

    var pinnedNode = ctl.pinnedNodeId ? hunt.nodes.find(function (n) { return n.id === ctl.pinnedNodeId; }) : null;
    if (ctl.pinnedNodeId && !pinnedNode) ctl.pinnedNodeId = null; // was deleted — fall back to normal flow

    if (pinnedNode) {
      renderPinnedNode(session, pinnedNode, ctl);
    } else if (ctl.laneListId && !state.endingReached) {
      var laneNodes = laneOptionsForScene(session, ctl.laneListId, ctl.laneListSceneId);
      main.innerHTML = renderLaneOptionsList(session, ctl.laneListId, laneNodes);
      wireHintButtons(session, main, ctl);
      Array.prototype.forEach.call(main.querySelectorAll("[data-lead]"), function (el) {
        el.onclick = function () { ctl.showNode(el.dataset.lead); };
      });
      ctl._activeIds = { expandedId: null, leadIds: laneNodes.map(function (n) { return n.id; }) };
    } else if (state.endingReached) {
      var en = hunt.nodes.find(function (n) { return n.id === state.endingReached; });
      main.innerHTML = en ?
        ('<div class="pv-ending"><h2>🏁 ' + esc(en.content.resultName) + '</h2><p class="pv-scene-body">' + esc(en.content.body) + '</p>' +
        '<p style="color:var(--pv-text-dim);font-size:12px">Hunt complete. ' + Object.keys(state.completed).length + " nodes visited · Score " + state.score + '</p></div>')
        : '<div class="pv-empty">The reached ending was removed from the hunt.</div>';
      ctl._activeIds = { expandedId: null, leadIds: [] };
    } else {
      var leads = openLeadNodes(session);
      if (!leads.length) {
        main.innerHTML = '<div class="pv-empty">No content is currently available. This may indicate an unreachable section — check the Validation panel.</div>';
        ctl._activeIds = { expandedId: null, leadIds: [] };
      } else {
        if (leads.length === 1 && !ctl.expandedNodeId) ctl.expandedNodeId = leads[0].id;
        var html = "";
        if (leads.length > 1) {
          html += '<p class="pv-side-title">Open leads (' + leads.length + ')</p>';
          leads.forEach(function (n) {
            var active = n.id === ctl.expandedNodeId;
            html += '<div class="pv-choice-btn" style="' + (active ? "border-color:var(--pv-accent)" : "") + '" data-lead="' + n.id + '">' + NODE_TYPES[n.type].icon + " " + esc(n.title) + '</div>';
          });
          html += "<hr style='border-color:var(--pv-text-dim);opacity:.25;margin:16px 0'/>";
        }
        var expanded = leads.find(function (n) { return n.id === ctl.expandedNodeId; }) || leads[0];
        if (expanded) html += renderPreviewNode(session, expanded, ctl);
        main.innerHTML = html;

        Array.prototype.forEach.call(main.querySelectorAll("[data-lead]"), function (el) {
          el.onclick = function () { ctl.expandedNodeId = el.dataset.lead; ctl.render(); };
        });
        wirePreviewNodeInteractions(session, expanded, ctl);
        ctl._activeIds = { expandedId: expanded ? expanded.id : null, leadIds: leads.map(function (n) { return n.id; }) };
      }
    }

    if (side) {
      var sideHtml = '<div class="pv-side-title">Score</div><div>' + state.score + '</div>';
      sideHtml += '<div class="pv-side-title">Items</div><div>' + (Object.keys(state.items).length ? Object.keys(state.items).map(function (id) { return '<span class="chip">' + esc(itemName(hunt, id)) + '</span>'; }).join("") : '<span style="color:var(--pv-text-dim)">none</span>') + '</div>';
      sideHtml += '<div class="pv-side-title">Variables</div><div>' + (hunt.variables.length ? hunt.variables.map(function (v) { return '<div>' + esc(v.name) + " = " + esc(String(state.variables[v.id])) + '</div>'; }).join("") : '<span style="color:var(--pv-text-dim)">none</span>') + '</div>';
      sideHtml += '<div class="pv-side-title">Progress</div><div>' + Object.keys(state.completed).length + " / " + hunt.nodes.length + ' nodes complete</div>';
      if (ctl.showState) {
        sideHtml += '<div class="pv-side-title">Event history</div>' + state.history.slice().reverse().slice(0, 12).map(function (h) { return '<div style="font-size:11px;color:var(--pv-text-dim)">' + esc(h.title) + '</div>'; }).join("");
        sideHtml += '<div class="pv-side-title">Available (not yet done)</div>' + Object.keys(state.available).filter(function (id) { return !state.completed[id]; }).map(function (id) { return '<div style="font-size:11px;color:var(--pv-text-dim)">' + esc(nodeTitle(hunt, id)) + '</div>'; }).join("");
      }
      side.innerHTML = sideHtml;
    }

    if (ctl.onRender) ctl.onRender(ctl);
  };

  return ctl;
}

/* ---------------------------------------------------------------------
   Public API
--------------------------------------------------------------------- */
return {
  SCHEMA_VERSION: SCHEMA_VERSION,
  FAMILIES: FAMILIES,
  NODE_TYPES: NODE_TYPES,
  CONDITION_TYPES: CONDITION_TYPES,
  EFFECT_TYPES: EFFECT_TYPES,

  STYLE_PACK_SCHEMA_VERSION: STYLE_PACK_SCHEMA_VERSION,
  STYLE_PACKS: STYLE_PACKS,
  DEFAULT_STYLE_PACK_ID: DEFAULT_STYLE_PACK_ID,
  BUILTIN_STYLE_PACK_IDS: BUILTIN_STYLE_PACK_IDS,
  getStylePack: getStylePack,
  styleFieldsPresent: styleFieldsPresent,
  applyStylePack: applyStylePack,

  uid: uid,
  clone: clone,
  esc: esc,
  familyOf: familyOf,
  nodeTitle: nodeTitle,
  varName: varName,
  itemName: itemName,

  collectConditionRefs: collectConditionRefs,
  validateHunt: validateHunt,

  AUTO_TYPES: AUTO_TYPES,
  isAutoType: isAutoType,
  evaluateCondition: evaluateCondition,
  applyEffect: applyEffect,
  isConnectionAllowed: isConnectionAllowed,
  convergenceSatisfied: convergenceSatisfied,
  completeNodeInternal: completeNodeInternal,
  recompute: recompute,
  createSession: createSession,
  normalizeAnswer: normalizeAnswer,
  pv_action_continueScene: pv_action_continueScene,
  pv_action_selectChoice: pv_action_selectChoice,
  pv_action_submitAnswer: pv_action_submitAnswer,
  pv_action_submitOrdering: pv_action_submitOrdering,
  pv_action_submitMatching: pv_action_submitMatching,
  pv_action_submitCipherAnswer: pv_action_submitCipherAnswer,
  pv_action_submitMathAnswer: pv_action_submitMathAnswer,
  pv_action_submitAnagramAnswer: pv_action_submitAnagramAnswer,
  pv_action_submitSequence: pv_action_submitSequence,
  pv_action_submitSlidingTile: pv_action_submitSlidingTile,
  pv_action_submitMultiPartAnswer: pv_action_submitMultiPartAnswer,
  pv_action_submitLockCode: pv_action_submitLockCode,
  pv_action_submitCrossReferenceAnswer: pv_action_submitCrossReferenceAnswer,
  pv_action_revealHint: pv_action_revealHint,

  PLAYER_SCREEN_TYPES: PLAYER_SCREEN_TYPES,
  openLeadNodes: openLeadNodes,
  hintsForNode: hintsForNode,
  laneOptionsForScene: laneOptionsForScene,
  renderLaneOptionsList: renderLaneOptionsList,
  wireHintButtons: wireHintButtons,
  renderPreviewNode: renderPreviewNode,
  wirePreviewNodeInteractions: wirePreviewNodeInteractions,
  renderPinnedNode: renderPinnedNode,
  createPreviewController: createPreviewController
};

});
