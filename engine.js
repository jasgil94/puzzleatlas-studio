/* =========================================================================
   ClueAtlas Engine — shared hunt schema, validation, style-pack renderer
   and player interpreter.

   This is the single source of truth for "what a hunt is and what it does
   when played." It has no dependency on the Studio's canvas, inspector or
   library UI, and (aside from applyStylePack, which only touches DOM
   elements it's explicitly told about, and no-ops outside a browser) it
   has no DOM dependency either — it can run under Node for testing.

   ClueAtlas Studio loads this file to drive its docked live Player
   mockup and its full-screen Preview overlay. The standalone ClueAtlas
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
    family: "narrative", label: "Simple Text", icon: "📜",
    defaultTitle: "New Scene",
    // mediaUrl/mediaType are optional on every node type's content (see
    // wrapWithMedia below) — when set, the player screen shows the media
    // full-bleed in the background with the node's content pinned to the
    // bottom third on top of it.
    // showBackButton: when true, a "← Back" button appears alongside the
    // Continue button, letting the player re-read the previous screen. Only
    // meaningful (and only exposed in the Studio inspector) when the node
    // directly upstream of this one is also a Simple Text node — see
    // previousConnectingNode below and buildTypeSpecificFields in app.js.
    defaultContent: function () { return { body: "Write the narrative text the player sees here.", mediaUrl: "", mediaType: "image", showBackButton: false }; },
    summary: function (c) { return c.body ? c.body.slice(0, 60) : ""; }
  },
  choice: {
    family: "narrative", label: "Choice", icon: "🔀",
    defaultTitle: "New Choice",
    defaultContent: function () {
      return { body: "What does the player choose?", options: [
        { id: uid("opt"), label: "Option A" },
        { id: uid("opt"), label: "Option B" }
      ], showBackButton: false };
    },
    summary: function (c) { return (c.options || []).map(function (o) { return o.label; }).join(" / "); }
  },
  storyBlock: {
    family: "narrative", label: "Story Block", icon: "📖",
    defaultTitle: "New Story Block",
    // body/mediaUrl/mediaType behave exactly like Simple Text. buttons: an
    // ordered list of completion buttons — each is either kind "connection"
    // (routes via an outgoing connection from this node, chosen in the
    // Studio inspector's Completion tab — see buildStoryBlockButtonsEditor
    // in app.js) or kind "back" (pure navigation, like Simple Text's back
    // button — no connection involved). Starts empty; a creator adds a
    // "Back" button (or any other button) via the Studio inspector's
    // Completion tab — off by default, like every other node type's back
    // button. buttonLayout: "vertical" (top to bottom, default) or
    // "horizontal" (left to right, buttons share a row — see the
    // pv-btn-row styling in renderPreviewNode/styles.css).
    defaultContent: function () {
      return {
        body: "Write the narrative text the player sees here.",
        mediaUrl: "", mediaType: "image",
        buttons: [],
        buttonLayout: "vertical"
      };
    },
    summary: function (c) { return c.body ? c.body.slice(0, 60) : ""; }
  },
  answerEntry: {
    family: "puzzle", label: "Answer Entry (text match)", icon: "🔑",
    defaultTitle: "New Puzzle",
    // imageAsset/caption/zoomable/aspectRatio/frameStyle/cropZoom/focalX/focalY
    // are the same optional "image reveal" fields Image Reveal nodes use (see
    // renderImageRevealBlock) — when imageAsset is set, the puzzle screen
    // shows the framed/cropped image above the prompt, same crop math and
    // Studio inspector as a dedicated Image Reveal node.
    defaultContent: function () {
      return {
        prompt: "Describe the puzzle prompt.", acceptedAnswers: ["ANSWER"], caseSensitive: false,
        imageAsset: "", caption: "", zoomable: true,
        aspectRatio: "original", frameStyle: "none",
        cropZoom: 1, focalX: 50, focalY: 50,
        showBackButton: false
      };
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
        correctOrder: [a, b, c],
        showBackButton: false
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
        correctPairs: [[l1, r1], [l2, r2]],
        showBackButton: false
      };
    },
    summary: function (c) { return (c.left || []).length + " pairs to match"; }
  },
  cipher: {
    family: "puzzle", label: "Cipher / Cryptogram", icon: "🔐",
    defaultTitle: "New Cipher Puzzle",
    defaultContent: function () {
      return { cipherType: "caesar", ciphertext: "Enter the ciphertext here.", key: "", acceptedAnswers: ["ANSWER"], showBackButton: false };
    },
    summary: function (c) { return (c.cipherType || "cipher") + " — " + (c.acceptedAnswers || []).join(", "); }
  },
  mathLogic: {
    family: "puzzle", label: "Math / Logic Puzzle", icon: "🧮",
    defaultTitle: "New Math / Logic Puzzle",
    defaultContent: function () { return { prompt: "Describe the math or logic puzzle.", expectedValue: "", tolerance: 0, unit: "", showBackButton: false }; },
    summary: function (c) { return "Answer: " + c.expectedValue + (c.unit ? " " + c.unit : ""); }
  },
  anagram: {
    family: "puzzle", label: "Anagram / Word Puzzle", icon: "🔤",
    defaultTitle: "New Anagram Puzzle",
    defaultContent: function () { return { scrambled: "TENISL", acceptedAnswers: ["LISTEN"], showBackButton: false }; },
    summary: function (c) { return "Scrambled: " + c.scrambled; }
  },
  sequencePattern: {
    family: "puzzle", label: "Sequence / Pattern (Simon-style)", icon: "🎹",
    defaultTitle: "New Sequence Puzzle",
    defaultContent: function () { return { sequence: ["red", "blue", "green"], inputMode: "playerRepeats", showBackButton: false }; },
    summary: function (c) { return (c.sequence || []).length + "-step sequence"; }
  },
  slidingTile: {
    family: "puzzle", label: "Sliding Tile / Jigsaw", icon: "🔲",
    defaultTitle: "New Sliding Tile Puzzle",
    defaultContent: function () { return { imageAsset: "", gridSize: 3, solvedState: "", showBackButton: false }; },
    summary: function (c) { return c.gridSize + "×" + c.gridSize + " tile puzzle"; }
  },
  multiPartAnswer: {
    family: "puzzle", label: "Multi-Part Answer", icon: "🧷",
    defaultTitle: "New Multi-Part Answer",
    defaultContent: function () {
      return { parts: [{ id: uid("part"), prompt: "Part 1 prompt", acceptedAnswers: ["A"] }, { id: uid("part"), prompt: "Part 2 prompt", acceptedAnswers: ["B"] }], combineRule: "concatenate", showBackButton: false };
    },
    summary: function (c) { return (c.parts || []).length + " parts to combine"; }
  },
  physicalLockCode: {
    family: "puzzle", label: "Physical Lock Code Entry", icon: "🔒",
    defaultTitle: "New Lock Code Entry",
    defaultContent: function () { return { codeLength: 4, codeFormat: "numeric", acceptedCode: "1234", lockStyle: "classicBrass", showBackButton: false }; },
    summary: function (c) {
      var style = LOCK_STYLES[c.lockStyle] || LOCK_STYLES.classicBrass;
      return style.label + " lock — " + c.codeFormat + " code, length " + c.codeLength;
    }
  },
  cryptexLock: {
    family: "puzzle", label: "Cryptex Dial Lock (3 Letter)", icon: "🗝️",
    defaultTitle: "New Cryptex Lock",
    // Three concentric letter rings (A–Z) the player drags to rotate, plus a
    // centre button that reads off the letter under the fixed pointer on
    // each ring and submits it through the normal free-text answer check
    // (checkTextAnswer/pv_action_submitAnswer) — see renderCryptexSvg/
    // wireCryptexInteractions below. acceptedAnswers holds one or more
    // 3-letter combinations, same shape as Answer Entry.
    defaultContent: function () { return { acceptedAnswers: ["CAT"], showBackButton: false }; },
    summary: function (c) { return "Combination: " + (c.acceptedAnswers || []).join(", "); }
  },
  crossReferenceLookup: {
    family: "puzzle", label: "Cross-Reference Lookup", icon: "🔍",
    defaultTitle: "New Cross-Reference Lookup",
    defaultContent: function () { return { sourceNodeIds: [], prompt: "Combine information from the referenced nodes.", acceptedAnswers: ["ANSWER"], showBackButton: false }; },
    summary: function (c) { return "Refs " + (c.sourceNodeIds || []).length + " node(s)"; }
  },
  fusePanel: {
    family: "puzzle", label: "Fuse Panel (Switch Bank)", icon: "⚡",
    defaultTitle: "New Fuse Panel",
    // A bank of knife switches (a distribution-panel prop, see
    // fuse-panel-puzzle.html for the original standalone version this node
    // type is based on). Each switch has its own player-visible on/off
    // labels — what the player reads at each throw position, e.g. a letter
    // supplied by some other clue — and its own required end position. The
    // node completes the instant every switch is in its required position;
    // there's no submit button and no per-switch right/wrong feedback (see
    // pv_action_submitFusePanel below), so a wrong guess can't be narrowed
    // down switch by switch — same "auto-validates on interaction" family
    // as Sequence Pattern/Sliding Tile.
    defaultContent: function () {
      var switches = [];
      for (var i = 0; i < 12; i++) {
        switches.push({ id: uid("sw"), label: "CKT " + (i + 1 < 10 ? "0" : "") + (i + 1), onLabel: "A", offLabel: "B", requiredOn: false });
      }
      return { prompt: "Set each switch to the position that matches the code.", switches: switches, showBackButton: false };
    },
    summary: function (c) {
      var switches = c.switches || [];
      var onCount = switches.filter(function (s) { return s.requiredOn; }).length;
      return switches.length + " switches — " + onCount + " must end ON, " + (switches.length - onCount) + " OFF";
    }
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
    // imageAsset: the uploaded/revealed image itself (data URI or URL) — distinct
    // from the shared mediaUrl/mediaType background-media fields (buildMediaFields
    // in app.js), which show a separate full-bleed backdrop behind this content.
    // aspectRatio "original" fits the whole image to the screen (no crop); every
    // other value crops the image to that ratio, framed by cropZoom/focalX/focalY.
    defaultContent: function () {
      return {
        imageAsset: "", caption: "", zoomable: true,
        aspectRatio: "original", frameStyle: "none",
        cropZoom: 1, focalX: 50, focalY: 50,
        showBackButton: false
      };
    },
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
  pdfReveal: {
    family: "media", label: "PDF Document Reader", icon: "📕",
    defaultTitle: "New PDF Document",
    // pdfAsset: the uploaded PDF itself, stored as a data URI (see
    // wirePdfRevealFields in app.js — same "stash it as a data URI on the
    // node, no backend" pattern as imageAsset). pageCount: authored by hand
    // rather than parsed from the file — this is a zero-dependency, offline,
    // single-file app (see the header comment at the top of this file), and
    // real PDF page-counting/rasterizing needs a parser like pdf.js that
    // isn't vendored here, so the creator just types in how many pages their
    // PDF has, same spirit as e.g. Sliding Tile's hand-set gridSize. At
    // player-time the PDF is shown via the browser's own built-in PDF
    // viewer (an <iframe> onto the data URI with a #page=N fragment — see
    // renderPdfRevealBlock/wirePdfReveal below); swiping/dragging
    // left-right or tapping the arrow buttons turns pages with a CSS 3D
    // page-turn animation layered on top.
    defaultContent: function () { return { pdfAsset: "", caption: "", pageCount: 1, showBackButton: false }; },
    summary: function (c) { return c.pdfAsset ? "PDF — " + (Number(c.pageCount) || 1) + " page(s)" + (c.caption ? " — " + c.caption : "") : "No PDF uploaded"; }
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
  clickableImage: {
    family: "media", label: "Clickable Image (Hotspots)", icon: "🖱️",
    defaultTitle: "New Clickable Image",
    // hotspotMediaUrl/hotspotMediaType hold this node's own primary image or
    // video — named distinctly from the shared background-media fields
    // (mediaUrl/mediaType, see buildMediaFields in app.js/wrapWithMedia
    // below) since those play full-bleed *behind* this node's content,
    // whereas hotspotMediaUrl IS the content. hotspots: an array of
    // { id, name, points, connectionId }, each points a normalised-0–1
    // polygon (drawn in the Studio's Hotspot Builder — see
    // openHotspotBuilder in app.js) and connectionId an outgoing connection
    // from this node, assigned in the Studio inspector's Completion section
    // exactly like Story Block's buttons (see buildClickableImageHotspotsEditor
    // in app.js). Clicking a hotspot in the player behaves like picking a
    // Choice option — it reuses pv_action_selectChoice/the choiceSelected
    // condition, just with the hotspot id standing in for an option id.
    // body/buttons/buttonLayout behave exactly like Story Block's own
    // fields (same shape, same [data-opt]/back-navigation handling in
    // wirePreviewNodeInteractions, starts empty by default) — a creator can
    // give this node narrative framing text and/or extra completion buttons
    // below the image, on top of (not instead of) clicking a hotspot.
    // hotspotGlow: whether hotspots get a hover/click highlight in the
    // player (see renderClickableImageBlock) — true by default so existing
    // behavior is unchanged; a creator can turn it off for a truly hidden,
    // no-affordance hidden-object feel.
    defaultContent: function () {
      return {
        hotspotMediaUrl: "", hotspotMediaType: "image", caption: "", hotspots: [],
        body: "", buttons: [], buttonLayout: "vertical",
        hotspotGlow: true
      };
    },
    summary: function (c) {
      var n = (c.hotspots || []).length;
      return n + " hotspot" + (n === 1 ? "" : "s") + (c.hotspotMediaUrl ? "" : " — no image/video set");
    }
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
    defaultContent: function () { return { placeholderNote: "Location/GPS logic is out of scope for this Phase 1 prototype. This node is a structural stub only.", showBackButton: false }; },
    summary: function () { return "GPS/map out of scope — stub only"; }
  }
};

var CONDITION_TYPES = {
  always:            { label: "Always (no condition)" },
  nodeComplete:       { label: "Node is complete" },
  allComplete:        { label: "All of these nodes are complete" },
  anyNComplete:       { label: "Any N of these nodes are complete" },
  choiceSelected:     { label: "A specific choice option, story block button, or hotspot was selected" },
  variableEquals:     { label: "Variable equals value" },
  variableAtLeast:    { label: "Variable is at least value" },
  itemHeld:           { label: "Player holds item" }
};

var EFFECT_TYPES = {
  awardItem:    { label: "Award item" },
  setVariable:  { label: "Set variable" },
  addScore:     { label: "Add to score" }
};

/* Image Reveal — aspect-ratio and frame options. "original" fits the whole
   uploaded image to the screen (no cropping); every other entry crops the
   image to that ratio, with the crop controlled by cropZoom/focalX/focalY. */
var IMAGE_ASPECT_RATIOS = {
  original: { label: "Original size (fit to screen)", ratio: null },
  square:   { label: "Square (1:1)", ratio: "1 / 1" },
  "4x3":    { label: "Standard (4:3)", ratio: "4 / 3" },
  "3x4":    { label: "Portrait (3:4)", ratio: "3 / 4" },
  "16x9":   { label: "Widescreen (16:9)", ratio: "16 / 9" },
  "9x16":   { label: "Tall / Story (9:16)", ratio: "9 / 16" },
  "3x2":    { label: "Classic photo (3:2)", ratio: "3 / 2" },
  "2x3":    { label: "Classic portrait (2:3)", ratio: "2 / 3" }
};
var IMAGE_FRAME_STYLES = {
  none:     { label: "None" },
  polaroid: { label: "Polaroid" },
  gallery:  { label: "Gallery frame" }
};

/* Physical Lock Code Entry — cosmetic appearance options for the real-world
   prop the player is holding. Purely presentational (label shown to the
   player above the code input); the accepted-code check itself is unaffected
   by which style is chosen. */
var LOCK_STYLES = {
  classicBrass: { label: "Classic Brass", icon: "🔒", playerLabel: "classic brass lock", brand: "Heritage Lock Co." },
  modernSilver: { label: "Modern Silver", icon: "🔐", playerLabel: "modern silver lock", brand: "Secure-Tech" },
  rusted:       { label: "Rusted", icon: "🗝️", playerLabel: "old, rusted lock", brand: "Salvage Hardware" }
};
// Layout constants for the combination-lock number wheels (shared between
// the render branch that lays out each wheel's track and wireLockDials,
// which drags it — must stay in sync, hence pulled out as one source of
// truth rather than duplicated literals in both places.
var LOCK_ROW_H = 50;       // px height of one digit/letter row in a wheel's window — must match .pv-lock-wheel-window/.pv-lock-wheel-row height in styles.css
var LOCK_REPEATS = 5;      // how many copies of the alphabet are stacked in the track, to give a drag headroom of +/-2 full wheel turns before hitting the end
var LOCK_CENTER_COPY = 2;  // which copy (0-based) each drag gesture re-centers on

/* ---------------------------------------------------------------------
   Style packs — pluggable, standalone documents that set the
   player-facing visual/tonal norms for a hunt (fonts, colours, imagery
   treatment, pacing). See docs/ClueAtlas_Style_Packs.md and
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

// The node directly upstream of `nodeId`, via whichever incoming connection
// comes first in hunt.connections — used by every node type's optional Back
// button (both to decide, in the Studio inspector, whether Back makes sense
// to offer, and at runtime to know which node to peek back to; see
// BACK_BUTTON_TYPES above the NODE_TYPES registry). A node can have several
// incoming connections (e.g. a convergence); this
// deliberately just picks one deterministic "previous" node rather than
// modeling branching history.
function previousConnectingNode(hunt, nodeId) {
  var conn = (hunt.connections || []).find(function (c) { return c.targetId === nodeId; });
  if (!conn) return null;
  return (hunt.nodes || []).find(function (n) { return n.id === conn.sourceId; }) || null;
}

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
      if (isAutoType(n.type) && nodeCompletionOk(n, session, true)) { completeNodeInternal(n, hunt, state); changed = true; }
    });
  }
}

function createSession(hunt) {
  var state = {
    completed: {}, available: {}, variables: {}, items: {}, score: 0,
    choiceSelections: {}, branchChoices: {}, hintProgress: {}, history: [], endingReached: null,
    feedback: {},
    seenAvailable: {} // nodeIds the player has already "seen" via visiting their lane's tab — drives the tab-bar notification badges (app.js laneBadgeCount/dismissLane)
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
  var ok = nodeCompletionOk(n, session, true);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_selectChoice(session, nodeId, optionId) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = nodeCompletionOk(n, session, true);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) {
    session.state.choiceSelections[nodeId] = optionId;
    completeNodeInternal(n, session.hunt, session.state);
    recompute(session);
  }
  return ok;
}
function pv_action_submitAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = checkTextAnswer(n.content, text);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitOrdering(session, nodeId, orderIds) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = JSON.stringify(orderIds) === JSON.stringify(n.content.correctOrder);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMatching(session, nodeId, pairs) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var norm = function (arr) { return arr.map(function (p) { return p[0] + ":" + p[1]; }).sort().join(","); };
  var mechanicOk = norm(pairs) === norm(n.content.correctPairs);
  var ok = nodeCompletionOk(n, session, mechanicOk);
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
  var mechanicOk = checkTextAnswer(n.content, text);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMathAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var val = parseFloat(text), expected = parseFloat(n.content.expectedValue);
  var tolerance = Math.abs(Number(n.content.tolerance)) || 0;
  var mechanicOk = !isNaN(val) && !isNaN(expected) && Math.abs(val - expected) <= tolerance;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitAnagramAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = checkTextAnswer(n.content, text);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitSequence(session, nodeId, attempt) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = JSON.stringify(attempt) === JSON.stringify(n.content.sequence || []);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitSlidingTile(session, nodeId, tiles) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var size = Number(n.content.gridSize) || 3;
  var mechanicOk = JSON.stringify(tiles) === JSON.stringify(solvedTileOrder(size));
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitMultiPartAnswer(session, nodeId, partAnswers) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var parts = n.content.parts || [];
  var mechanicOk = parts.length > 0 && parts.every(function (p) { return checkTextAnswer(p, (partAnswers || {})[p.id] || ""); });
  var ok = nodeCompletionOk(n, session, mechanicOk);
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
  var mechanicOk = normalize(code) === normalize(n.content.acceptedCode) && normalize(code).length > 0;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
function pv_action_submitCrossReferenceAnswer(session, nodeId, text) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = checkTextAnswer(n.content, text);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}
// Fuse Panel — auto-validates after every switch toggle (same family as
// Sequence Pattern/Sliding Tile), so this runs on every flip rather than
// behind a discrete submit button. switchState maps switch id -> boolean
// (true = ON). Correct only when every configured switch's live state
// matches its own requiredOn.
function pv_action_submitFusePanel(session, nodeId, switchState) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var switches = n.content.switches || [];
  var mechanicOk = switches.length > 0 && switches.every(function (s) { return !!(switchState || {})[s.id] === !!s.requiredOn; });
  var ok = nodeCompletionOk(n, session, mechanicOk);
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
var PLAYER_SCREEN_TYPES = ["scene", "choice", "storyBlock", "answerEntry", "ordering", "matching", "locationPlaceholder", "ending",
  "cipher", "mathLogic", "anagram", "sequencePattern", "slidingTile", "multiPartAnswer", "physicalLockCode", "cryptexLock", "crossReferenceLookup",
  "imageReveal", "fusePanel", "clickableImage", "pdfReveal"];

// Node types offering a generic, opt-in "← Back" button — every
// PLAYER_SCREEN_TYPES type except Simple Text (its own showBackButton
// handling, above the NODE_TYPES registry), Story Block/Clickable Image
// (back is one of their own connection buttons instead — see their
// defaultContent) and Ending (a terminal screen — there's nowhere to
// continue on to, so "back" doesn't apply). Off by default on every type
// here; a creator opts in per node in the Studio inspector, and it's only
// ever shown at player-time when previousConnectingNode(hunt, nodeId)
// actually resolves to something to return to. See the generic render
// block at the end of renderPreviewNode's node-type if/else chain, and
// buildTypeSpecificFields/wireNodeInspector in app.js for the matching
// Studio inspector field.
var BACK_BUTTON_TYPES = ["choice", "answerEntry", "ordering", "matching", "locationPlaceholder",
  "cipher", "mathLogic", "anagram", "sequencePattern", "slidingTile", "multiPartAnswer",
  "physicalLockCode", "cryptexLock", "crossReferenceLookup", "imageReveal", "fusePanel", "pdfReveal"];

// Default primary-action button text per node type, used by
// renderPreviewNode below unless a creator sets node.buttonLabel to
// override it. Only types with one clear "do this to progress" button are
// listed — Choice (per-option buttons), Sequence Pattern and Sliding Tile
// (auto-validate on interaction, no discrete submit) aren't, so Studio's
// inspector doesn't offer a button-label field for those either (see
// BUTTON_LABEL_TYPES export).
var DEFAULT_BUTTON_LABEL = {
  scene: "Continue →", imageReveal: "Continue →", locationPlaceholder: "Continue →", pdfReveal: "Continue →",
  answerEntry: "Submit", cipher: "Submit", mathLogic: "Submit", anagram: "Submit", crossReferenceLookup: "Submit",
  ordering: "Submit order", matching: "Submit matches",
  multiPartAnswer: "Submit all parts", physicalLockCode: "Unlock"
};
var BUTTON_LABEL_TYPES = DEFAULT_BUTTON_LABEL; // same key set — presence in this map is the "supports a custom label" flag
function buttonLabelFor(n) {
  return (n.buttonLabel && String(n.buttonLabel).trim()) || DEFAULT_BUTTON_LABEL[n.type] || "Continue →";
}

// Node-level completion override — lets a creator replace a node's normal
// completion trigger (correct answer, a button press, or "fires once
// available" for automatic types) with an arbitrary condition over session
// state, reusing the same CONDITION_TYPES vocabulary connections use.
// `mechanicOk` is whatever the node's own built-in check produced (true for
// button-only types, the correctness result for puzzle types, true for
// automatic types once available); when no override is enabled this passes
// straight through unchanged, so default behavior is identical to before.
function nodeCompletionOk(n, session, mechanicOk) {
  var ov = n.completionOverride;
  if (ov && ov.enabled) return evaluateCondition(ov.condition, session.state, session.hunt);
  return mechanicOk;
}

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
      for (var i = 0; i < shown; i++) html += '<div class="pv-hint-text"' + pvFontStyle(h.content.stages[i].fontSize, 12) + '>' + esc(h.content.stages[i].text) + '</div>';
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

// If content declares a mediaUrl, wraps innerHtml so the media plays
// full-bleed behind it with innerHtml pinned to the bottom third on top
// (via .pv-scene-media-wrap / .pv-scene-textpane) — shared by every node
// type's player screen and by the ending screen, so background media is a
// standard option regardless of node type. Returns innerHtml unchanged
// when no media is set.
// Background media brightness is stored as a plain percentage on the
// content (100 = unchanged). Shared by wrapWithMedia below and by the
// Studio inspector's live preview thumbnail (buildMediaFields in app.js,
// which reads this via the PAEngine export) so undefined/invalid values
// fall back to 100 consistently in both places.
function mediaBrightnessOf(c) {
  var b = Number(c && c.mediaBrightness);
  return isFinite(b) && b > 0 ? b : 100;
}

// Builds the CSS filter string for a node's background media from its
// mediaBlur/mediaBrightness fields (set via the Studio inspector's
// background-adjustments row — see buildMediaFields in app.js). Returns
// "" when there's nothing to apply. blurPx lets callers use a smaller
// radius for small preview thumbnails than for the full-bleed player.
function mediaAdjustFilterCss(c, blurPx) {
  var parts = [];
  if (c && c.mediaBlur) parts.push("blur(" + (blurPx || 14) + "px)");
  var brightness = mediaBrightnessOf(c);
  if (brightness !== 100) parts.push("brightness(" + (brightness / 100) + ")");
  return parts.join(" ");
}

function wrapWithMedia(c, innerHtml) {
  if (!c || !c.mediaUrl) return innerHtml;
  var mediaTag = c.mediaType === "video"
    ? '<video class="pv-scene-media" src="' + esc(c.mediaUrl) + '" autoplay loop muted playsinline></video>'
    : '<img class="pv-scene-media" src="' + esc(c.mediaUrl) + '" alt="" />';
  // Blur/brightness are applied on a wrapper around just the media, not
  // on .pv-scene-media-wrap itself, so the adjustment never touches the
  // .pv-scene-textpane content pinned on top of it.
  var filterCss = mediaAdjustFilterCss(c);
  var adjustStyle = filterCss ? ' style="filter:' + filterCss + '"' : "";
  return '<div class="pv-scene-media-wrap"><div class="pv-scene-media-adjust"' + adjustStyle + '>' + mediaTag + '</div><div class="pv-scene-textpane">' + innerHtml + '</div></div>';
}

// Builds the framed/cropped markup for an Image Reveal node's own uploaded
// image (c.imageAsset) — separate from the shared background-media system
// above (c.mediaUrl/mediaType). Used both for the real player screen and
// for the Studio inspector's live crop/frame preview, so the two always
// match. "original" aspect ratio renders a plain <img> that fits the whole
// picture to the screen (object-fit: contain, no cropping). Every other
// ratio renders a fixed-ratio box (overflow hidden) containing an <img>
// with object-fit: cover — object-position (focalX/focalY) picks which
// part of the image is visible, and transform: scale (cropZoom) zooms in
// further from that cover baseline, same technique as standard photo-crop
// UIs so the image always fully fills the frame with no letterboxing.
function renderImageRevealBlock(c) {
  c = c || {};
  var ratio = IMAGE_ASPECT_RATIOS[c.aspectRatio] ? c.aspectRatio : "original";
  var frame = IMAGE_FRAME_STYLES[c.frameStyle] ? c.frameStyle : "none";
  var arClass = "pv-ar-" + ratio;
  var html = '<div class="pv-image-reveal pv-frame-' + frame + '">';
  if (!c.imageAsset) {
    html += '<div class="pv-image-frame ' + arClass + ' pv-image-empty">No image uploaded</div>';
  } else if (ratio === "original") {
    html += '<img class="pv-image-frame ' + arClass + '" src="' + esc(c.imageAsset) + '" alt="" />';
  } else {
    var scale = Math.max(1, Number(c.cropZoom) || 1);
    var fx = Math.min(100, Math.max(0, Number(c.focalX != null ? c.focalX : 50)));
    var fy = Math.min(100, Math.max(0, Number(c.focalY != null ? c.focalY : 50)));
    html += '<div class="pv-image-frame ' + arClass + '"><img class="pv-image-frame-img" src="' + esc(c.imageAsset) +
      '" alt="" style="object-position:' + fx + '% ' + fy + '%;transform:scale(' + scale + ')" /></div>';
  }
  if (c.caption) html += '<div class="pv-image-caption">' + esc(c.caption) + '</div>';
  html += '</div>';
  return html;
}

// PDF Document Reader — shows the node's uploaded PDF (c.pdfAsset, a data
// URI) via the browser's own built-in PDF viewer, one page at a time. There's
// no rasterizing/parsing library vendored in this zero-dependency app (see
// the pdfReveal entry in NODE_TYPES above), so page navigation works by
// pointing an <iframe> at the same data URI with a "#page=N" fragment —
// supported by Chrome/Edge's built-in viewer; Safari/Firefox support for the
// page fragment on a data: URI is inconsistent, a disclosed limitation of
// this approach. `enterCls` is a one-shot CSS class (see wirePdfReveal
// below) that plays a "swinging into place" entrance animation on the sheet
// right after a page turn, continuing the motion of the turn-away animation
// that wirePdfReveal plays directly on the previous DOM before re-rendering.
function renderPdfRevealBlock(c, pageNum, enterCls) {
  c = c || {};
  var pages = Math.max(1, Number(c.pageCount) || 1);
  var page = Math.min(Math.max(1, Number(pageNum) || 1), pages);
  var html = '<div class="pv-pdf-reader">';
  if (!c.pdfAsset) {
    html += '<div class="pv-pdf-empty">No PDF uploaded</div>';
  } else {
    var src = c.pdfAsset + "#page=" + page + "&toolbar=0&navpanes=0&scrollbar=0&view=FitH";
    html += '<div class="pv-pdf-viewport" data-pdf-pages="' + pages + '">' +
      '<div class="pv-pdf-sheet' + (enterCls ? " " + enterCls : "") + '" id="pvPdfSheet">' +
        '<iframe class="pv-pdf-frame" id="pvPdfFrame" src="' + esc(src) + '" title="PDF page ' + page + ' of ' + pages + '"></iframe>' +
      '</div>' +
      '<div class="pv-pdf-swipe-catcher" id="pvPdfCatcher"></div>' +
      '<button class="pv-pdf-arrow pv-pdf-arrow-left" id="pvPdfPrev" aria-label="Previous page"' + (page <= 1 ? " disabled" : "") + '>‹</button>' +
      '<button class="pv-pdf-arrow pv-pdf-arrow-right" id="pvPdfNext" aria-label="Next page"' + (page >= pages ? " disabled" : "") + '>›</button>' +
    '</div>' +
    '<div class="pv-pdf-pagectr">Page ' + page + ' of ' + pages + '</div>';
  }
  if (c.caption) html += '<div class="pv-image-caption">' + esc(c.caption) + '</div>';
  html += '</div>';
  return html;
}

// Wires swipe (touch)/click-drag (mouse) and the prev/next arrow buttons for
// a PDF Reader node. A transparent .pv-pdf-swipe-catcher div sits over the
// iframe to capture the gesture — dragging directly on an <iframe> doesn't
// work, since once the pointer is over it, mouse/touch events land in the
// iframe's own document instead of bubbling to this one. Uses Pointer Events
// + setPointerCapture (same pattern as wireLockDials/wireCryptexInteractions
// above) so a drag that ends outside the catcher still resolves correctly,
// with no listener attached outside `root` to clean up. The page turn itself
// is animated directly on the live DOM (classList, like the cryptex's shake)
// rather than through ctl.render(), which only runs once the turn-away
// animation finishes, to swap in the new page and play its entrance
// animation — see renderPdfRevealBlock's `enterCls`.
function wirePdfReveal(root, ctl, session, n) {
  var viewport = root.querySelector(".pv-pdf-viewport");
  if (!viewport) return;
  var pages = Math.max(1, Number(n.content.pageCount) || 1);
  var current = ctl.pdfPageDraft[n.id] || 1;
  var TURN_MS = 320;

  function goTo(next, dir) {
    next = Math.min(Math.max(1, next), pages);
    if (next === current) return;
    var sheet = root.querySelector("#pvPdfSheet");
    if (sheet) sheet.classList.add(dir > 0 ? "pv-pdf-turn-fwd" : "pv-pdf-turn-back");
    setTimeout(function () {
      ctl.pdfPageDraft[n.id] = next;
      ctl.pdfEnterAnim[n.id] = dir > 0 ? "pv-pdf-sheet-enter-fwd" : "pv-pdf-sheet-enter-back";
      ctl.render();
    }, sheet ? TURN_MS : 0);
  }

  var prevBtn = root.querySelector("#pvPdfPrev");
  var nextBtn = root.querySelector("#pvPdfNext");
  if (prevBtn) prevBtn.onclick = function () { goTo(current - 1, -1); };
  if (nextBtn) nextBtn.onclick = function () { goTo(current + 1, 1); };

  var catcher = root.querySelector("#pvPdfCatcher");
  if (!catcher) return;
  var startX = 0, startY = 0, dragging = false;
  var THRESHOLD = 40;
  catcher.onpointerdown = function (e) {
    dragging = true; startX = e.clientX; startY = e.clientY;
    try { catcher.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: drag still tracks via direct listeners */ }
  };
  function finish(e) {
    if (!dragging) return;
    dragging = false;
    var dx = e.clientX - startX, dy = e.clientY - startY;
    if (Math.abs(dx) > THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) goTo(current + 1, 1); else goTo(current - 1, -1);
    }
  }
  catcher.onpointerup = finish;
  catcher.onpointercancel = function () { dragging = false; };
}

// Clickable Image (Hotspots) — the node's own uploaded image/video
// (c.hotspotMediaUrl) with one or more polygon hotspots drawn over it (see
// openHotspotBuilder in app.js). Hotspot corners are stored normalised 0–1
// against the media's own width/height; an SVG with viewBox "0 0 1 1" and
// preserveAspectRatio="none" maps them onto the rendered media with zero
// pixel math, which is safe here (unlike the Studio's Hotspot Builder,
// which draws real, fixed-size vertex handles and does need actual pixel
// geometry) because the player only ever needs click hit-testing, not
// precise on-screen handle sizing. .pv-hotspot-wrap sizes itself exactly to
// the media's own rendered box (width:fit-content — see styles.css) so the
// two never drift apart regardless of viewport width or aspect ratio.
// Each polygon carries data-opt="<hotspotId>" — the exact same attribute
// Choice options and Story Block buttons use — so the generic [data-opt]
// click wiring already in wirePreviewNodeInteractions (below) picks these
// up for free; no bespoke wire function needed for this node type.
function renderClickableImageBlock(c) {
  c = c || {};
  if (!c.hotspotMediaUrl) {
    return '<div class="pv-hotspot-empty">No image or video has been set for this node yet.</div>';
  }
  var mediaTag = c.hotspotMediaType === "video"
    ? '<video class="pv-hotspot-media" src="' + esc(c.hotspotMediaUrl) + '" autoplay muted loop playsinline></video>'
    : '<img class="pv-hotspot-media" src="' + esc(c.hotspotMediaUrl) + '" alt="" />';
  var polys = (c.hotspots || []).map(function (h) {
    var pts = (h.points || []).map(function (p) { return p[0] + "," + p[1]; }).join(" ");
    return '<polygon points="' + pts + '" data-opt="' + esc(h.id) + '" class="pv-hotspot-poly"><title>' + esc(h.name || "") + '</title></polygon>';
  }).join("");
  // hotspotGlow (default true) toggles the hover/click highlight via a CSS
  // custom property read by .pv-hotspot-poly:hover/:active in styles.css —
  // set to 0 here disables it without needing a second, near-duplicate
  // stylesheet rule.
  var glowStyle = c.hotspotGlow === false ? ' style="--pv-hotspot-glow-opacity:0"' : "";
  var html = '<div class="pv-hotspot-wrap"' + glowStyle + '>' + mediaTag +
    '<svg class="pv-hotspot-svg" viewBox="0 0 1 1" preserveAspectRatio="none">' + polys + '</svg></div>';
  if (c.caption) html += '<div class="pv-image-caption">' + esc(c.caption) + '</div>';
  return html;
}

// Renders body/prompt/hint text at the font size chosen (via the Studio
// inspector's +/- controls, see playerTextField/wireFontSizeButtons in
// app.js) at content.bodyFontSize / content.promptFontSize / a hint
// stage's own fontSize — so those buttons change what the player
// actually sees here, not just the editor. Falls back to the class's own
// CSS default (15px for .pv-scene-body, 12px for .pv-hint-text) when a
// field's size was never customized.
function pvFontStyle(size, defaultSize) {
  return ' style="font-size:' + (size || defaultSize || 15) + 'px"';
}

// Same idea as pvFontStyle, but for button text. A node's single primary
// action button (Continue/Submit/Unlock/etc., whichever buttonLabelFor
// picks) shares one size stored on the node itself — node.buttonLabelFontSize
// — since a button label isn't part of node.content and only one such
// button is ever on screen per node. baseStyle is the button's existing
// non-font inline CSS (e.g. "max-width:200px"), folded into the same
// style attribute. Default 13.5px matches .pv-choice-btn's own CSS default.
function pvPrimaryButton(n, idAttr, baseStyle) {
  var fs = n.buttonLabelFontSize || 13.5;
  var style = (baseStyle ? baseStyle + ";" : "") + "font-size:" + fs + "px";
  return '<button class="pv-choice-btn" id="' + idAttr + '" style="' + style + '">' + esc(buttonLabelFor(n)) + '</button>';
}

// Choice options and Story Block buttons are each their own independent
// text field in the inspector (one per option/button), so each gets its
// own font size too, read off the option/button object itself.
function pvItemButton(cls, dataAttr, label, fontSize, baseStyle) {
  var fs = fontSize || 13.5;
  var style = (baseStyle ? baseStyle + ";" : "") + "font-size:" + fs + "px";
  return '<button class="' + cls + '" ' + dataAttr + ' style="' + style + '">' + esc(label) + '</button>';
}

function renderPreviewNode(session, n, ctl) {
  var c = n.content, html = "";
  var hints = hintsForNode(session.hunt, n.id);
  if (n.type === "scene") {
    html += '<div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div>' + pvPrimaryButton(n, "pvContinue", "max-width:200px");
    if (c.showBackButton) {
      var prevSc = previousConnectingNode(session.hunt, n.id);
      if (prevSc && prevSc.type === "scene") {
        html += '<button class="pv-choice-btn pv-back-btn" data-back-target="' + esc(prevSc.id) + '" style="max-width:200px;margin-top:8px">← Back</button>';
      }
    }
    var fbSc = session.state.feedback[n.id];
    if (fbSc === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "storyBlock") {
    html += '<div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div>';
    var sbHorizontal = c.buttonLayout === "horizontal";
    var sbBtnBaseStyle = sbHorizontal ? "" : "max-width:220px;margin-top:6px";
    var sbBtnsHtml = "";
    (c.buttons || []).forEach(function (b) {
      if (b.kind === "back") {
        var prevSb = previousConnectingNode(session.hunt, n.id);
        if (prevSb) sbBtnsHtml += pvItemButton("pv-choice-btn pv-back-btn", 'data-back-target="' + esc(prevSb.id) + '"', b.label || "← Back", b.fontSize, sbBtnBaseStyle);
      } else {
        sbBtnsHtml += pvItemButton("pv-choice-btn", 'data-opt="' + esc(b.id) + '"', b.label || "Continue", b.fontSize, sbBtnBaseStyle);
      }
    });
    // Horizontal layout puts every button in a shared row (pv-btn-row —
    // see styles.css), which also scales the font down and wraps longer
    // labels onto multiple lines so they don't overflow their share of the
    // row. Vertical (default) keeps the original one-per-line stack.
    html += sbHorizontal ? '<div class="pv-btn-row">' + sbBtnsHtml + '</div>' : sbBtnsHtml;
    var fbSb = session.state.feedback[n.id];
    if (fbSb === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "choice") {
    html += '<div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div>';
    c.options.forEach(function (o) { html += pvItemButton("pv-option-btn", 'data-opt="' + o.id + '"', o.label, o.fontSize); });
    var fbCh = session.state.feedback[n.id];
    if (fbCh === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "answerEntry") {
    if (c.imageAsset) html += renderImageRevealBlock(c);
    html += '<div class="pv-scene-body"' + pvFontStyle(c.promptFontSize) + '>' + esc(c.prompt) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvAnswerInput" placeholder="Type your answer…" />';
    html += pvPrimaryButton(n, "pvSubmitAnswer", "max-width:160px");
    var fb = session.state.feedback[n.id];
    if (fb) html += '<div class="pv-feedback ' + fb + '">' + (fb === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "ordering") {
    if (!ctl.orderingDraft[n.id]) ctl.orderingDraft[n.id] = c.items.map(function (it) { return it.id; });
    html += '<div class="pv-scene-body"' + pvFontStyle(c.promptFontSize) + '>' + esc(c.prompt) + '</div>';
    ctl.orderingDraft[n.id].forEach(function (id, idx) {
      var it = c.items.find(function (x) { return x.id === id; });
      html += '<div class="list-item" data-ordidx="' + idx + '"><span class="chip">' + (idx + 1) + '</span><span style="flex:1">' + esc(it.label) + '</span><button class="small-btn ordUpPv">↑</button><button class="small-btn ordDownPv">↓</button></div>';
    });
    html += pvPrimaryButton(n, "pvSubmitOrdering", "max-width:160px;margin-top:10px");
    var fb2 = session.state.feedback[n.id];
    if (fb2) html += '<div class="pv-feedback ' + fb2 + '">' + (fb2 === "correct" ? "✓ Correct order." : "✗ Not the right order — try again.") + '</div>';
  } else if (n.type === "matching") {
    if (!ctl.matchingDraft[n.id]) {
      ctl.matchingDraft[n.id] = {};
      c.left.forEach(function (l) { ctl.matchingDraft[n.id][l.id] = c.right[0] ? c.right[0].id : ""; });
    }
    html += '<div class="pv-scene-body"' + pvFontStyle(c.promptFontSize) + '>' + esc(c.prompt) + '</div>';
    c.left.forEach(function (l) {
      html += '<div class="list-item"><span style="flex:1">' + esc(l.label) + ' →</span><select class="pvPairSelect" data-lid="' + l.id + '">' +
        c.right.map(function (r) { return '<option value="' + r.id + '"' + (ctl.matchingDraft[n.id][l.id] === r.id ? " selected" : "") + '>' + esc(r.label) + '</option>'; }).join("") + '</select></div>';
    });
    html += pvPrimaryButton(n, "pvSubmitMatching", "max-width:160px;margin-top:10px");
    var fb3 = session.state.feedback[n.id];
    if (fb3) html += '<div class="pv-feedback ' + fb3 + '">' + (fb3 === "correct" ? "✓ Correct matches." : "✗ Some pairs are wrong — try again.") + '</div>';
  } else if (n.type === "imageReveal") {
    html += renderImageRevealBlock(c);
    html += pvPrimaryButton(n, "pvContinue", "max-width:200px");
    var fbIr = session.state.feedback[n.id];
    if (fbIr === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "pdfReveal") {
    var pdfPage = ctl.pdfPageDraft[n.id] || 1;
    var pdfEnterCls = ctl.pdfEnterAnim[n.id] || "";
    ctl.pdfEnterAnim[n.id] = ""; // one-shot — only plays right after the turn that set it
    html += renderPdfRevealBlock(c, pdfPage, pdfEnterCls);
    html += pvPrimaryButton(n, "pvContinue", "max-width:200px");
    var fbPdf = session.state.feedback[n.id];
    if (fbPdf === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "locationPlaceholder") {
    html += '<div class="pv-scene-body">' + esc(c.placeholderNote) + '</div>' + pvPrimaryButton(n, "pvContinue", "max-width:200px");
    var fbLp = session.state.feedback[n.id];
    if (fbLp === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "cipher") {
    html += '<div class="pv-mono-block">' + esc(c.ciphertext) + '</div>';
    html += '<div class="pv-info-card">Cipher: ' + esc(c.cipherType || "cipher") + (c.key ? " · Key: " + esc(c.key) : "") + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvCipherInput" placeholder="Type the decoded answer…" />';
    html += pvPrimaryButton(n, "pvSubmitCipher", "max-width:160px");
    var fbCi = session.state.feedback[n.id];
    if (fbCi) html += '<div class="pv-feedback ' + fbCi + '">' + (fbCi === "correct" ? "✓ Decoded correctly." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "mathLogic") {
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<input type="text" inputmode="decimal" class="pv-answer-input" id="pvMathInput" placeholder="Enter a number' + (c.unit ? " (" + esc(c.unit) + ")" : "") + '…" />';
    html += pvPrimaryButton(n, "pvSubmitMath", "max-width:160px");
    var fbMa = session.state.feedback[n.id];
    if (fbMa) html += '<div class="pv-feedback ' + fbMa + '">' + (fbMa === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "anagram") {
    html += '<div class="pv-mono-block">' + esc((c.scrambled || "").toUpperCase().split("").join(" ")) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvAnagramInput" placeholder="Type the unscrambled word/phrase…" />';
    html += pvPrimaryButton(n, "pvSubmitAnagram", "max-width:160px");
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
    html += pvPrimaryButton(n, "pvSubmitMultiPart", "max-width:160px");
    var fbMp = session.state.feedback[n.id];
    if (fbMp) html += '<div class="pv-feedback ' + fbMp + '">' + (fbMp === "correct" ? "✓ All parts correct." : "✗ One or more parts are wrong — try again.") + '</div>';
  } else if (n.type === "physicalLockCode") {
    var lockStyleKey = LOCK_STYLES[c.lockStyle] ? c.lockStyle : "classicBrass";
    var lockStyle = LOCK_STYLES[lockStyleKey];
    var isAlphaLock = c.codeFormat === "alpha";
    var wheelValues = isAlphaLock ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") : "0123456789".split("");
    var wheelN = wheelValues.length;
    var dialCount = c.codeLength || 4;
    if (!ctl.lockDialDraft[n.id]) ctl.lockDialDraft[n.id] = [];
    var dialState = ctl.lockDialDraft[n.id];
    while (dialState.length < dialCount) dialState.push(0);
    dialState.length = dialCount;
    var fbLo = session.state.feedback[n.id];

    // Each wheel's track is several stacked copies of the full alphabet so a
    // drag can spin a couple of full turns before running out of rows to
    // reveal (see LOCK_REPEATS) — same trick a real combination lock doesn't
    // need, but a scroll-based DOM one does.
    var trackRowsHtml = "";
    for (var rep = 0; rep < LOCK_REPEATS; rep++) {
      trackRowsHtml += wheelValues.map(function (ch) { return '<div class="pv-lock-wheel-row">' + ch + '</div>'; }).join('');
    }
    var upArrowSvg = '<svg viewBox="0 0 24 24"><path d="M12 6l8 10H4z"/></svg>';
    var downArrowSvg = '<svg viewBox="0 0 24 24"><path d="M4 8h16l-8 10z"/></svg>';

    html += '<div class="pv-scene-body">Drag a wheel, scroll it, or use the arrow buttons to line up the ' + (isAlphaLock ? "letter" : "number") + ' from the ' + esc(lockStyle.playerLabel) + ', then try the combination.</div>';

    html += '<div class="pv-lock-wrap pv-lock-style-' + lockStyleKey + (isAlphaLock ? ' pv-lock-alpha' : '') + (fbLo === "correct" ? ' pv-lock-open' : '') + '">';
    html += '<div class="pv-lock-shackle"></div>';
    html += '<div class="pv-lock-body">';
    html += '<div class="pv-lock-brand">' + esc(lockStyle.brand) + '</div>';
    html += '<div class="pv-lock-dials">';
    for (var wi = 0; wi < dialCount; wi++) {
      var centerRow = LOCK_CENTER_COPY * wheelN + dialState[wi];
      var trackY = -centerRow * LOCK_ROW_H;
      html += '<div class="pv-lock-wheel" data-lockidx="' + wi + '">' +
        '<button type="button" class="pv-lock-arrow" data-lockidx="' + wi + '" data-lockdir="1" aria-label="Next">' + upArrowSvg + '</button>' +
        '<div class="pv-lock-wheel-window">' +
          '<div class="pv-lock-wheel-track" style="transform:translateY(' + trackY + 'px)">' + trackRowsHtml + '</div>' +
        '</div>' +
        '<button type="button" class="pv-lock-arrow" data-lockidx="' + wi + '" data-lockdir="-1" aria-label="Previous">' + downArrowSvg + '</button>' +
      '</div>';
    }
    html += '</div>'; // .pv-lock-dials
    html += '<div class="pv-lock-readout" id="pvLockReadout">' + dialState.map(function (i) { return wheelValues[i]; }).join(" ") + '</div>';
    html += '</div>'; // .pv-lock-body
    html += '</div>'; // .pv-lock-wrap
    html += '<input type="hidden" id="pvLockInput" value="' + esc(dialState.map(function (i) { return wheelValues[i]; }).join("")) + '" />';
    html += pvPrimaryButton(n, "pvSubmitLock", "max-width:200px");
    if (fbLo) html += '<div class="pv-feedback ' + fbLo + '">' + (fbLo === "correct" ? "✓ Unlocked." : "✗ Incorrect code — try again.") + '</div>';
  } else if (n.type === "cryptexLock") {
    if (!ctl.cryptexDraft[n.id]) ctl.cryptexDraft[n.id] = { outer: 0, middle: 0, inner: 0 };
    html += '<div class="pv-scene-body">Drag each ring to line up a letter against the pointer at the top, then press the centre stud to try that combination.</div>';
    html += renderCryptexSvg(n.id, ctl.cryptexDraft[n.id]);
    var fbCx = session.state.feedback[n.id];
    if (fbCx) html += '<div class="pv-feedback ' + fbCx + '">' + (fbCx === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "crossReferenceLookup") {
    var srcTitles = (c.sourceNodeIds || []).map(function (id) { return nodeTitle(session.hunt, id); });
    if (srcTitles.length) html += '<div class="pv-info-card">References: ' + esc(srcTitles.join(", ")) + '</div>';
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<input type="text" class="pv-answer-input" id="pvCrossRefInput" placeholder="Type your answer…" />';
    html += pvPrimaryButton(n, "pvSubmitCrossRef", "max-width:160px");
    var fbCr = session.state.feedback[n.id];
    if (fbCr) html += '<div class="pv-feedback ' + fbCr + '">' + (fbCr === "correct" ? "✓ Correct." : "✗ Not quite — try again.") + '</div>';
  } else if (n.type === "fusePanel") {
    if (!ctl.fuseDraft[n.id]) {
      ctl.fuseDraft[n.id] = {};
      (c.switches || []).forEach(function (s) { ctl.fuseDraft[n.id][s.id] = false; });
    }
    var fuseState = ctl.fuseDraft[n.id];
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<div class="pv-fuse-panel">';
    (c.switches || []).forEach(function (s) {
      var swOn = !!fuseState[s.id];
      html += '<div class="pv-fuse-switch' + (swOn ? ' on' : '') + '" data-swid="' + esc(s.id) + '" tabindex="0" role="switch" aria-checked="' + (swOn ? "true" : "false") + '" aria-label="' + esc(s.label || "Switch") + '">' +
        '<div class="pv-fuse-switch-label">' + esc(s.label || "") + '</div>' +
        '<div class="pv-fuse-mech">' +
          '<div class="pv-fuse-post"></div>' +
          '<div class="pv-fuse-blade-group"><div class="pv-fuse-blade"></div><div class="pv-fuse-handle"></div></div>' +
          '<div class="pv-fuse-contact pv-fuse-contact-on"></div>' +
          '<div class="pv-fuse-contact pv-fuse-contact-off"></div>' +
          '<span class="pv-fuse-poslabel pv-fuse-poslabel-on">' + esc(s.onLabel || "") + '</span>' +
          '<span class="pv-fuse-poslabel pv-fuse-poslabel-off">' + esc(s.offLabel || "") + '</span>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    var fbFu = session.state.feedback[n.id];
    if (fbFu === "correct") html += '<div class="pv-feedback correct">✓ Power restored.</div>';
  } else if (n.type === "clickableImage") {
    if (c.body) html += '<div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div>';
    html += renderClickableImageBlock(c);
    // Buttons below the image — identical shape/rendering to Story Block's
    // own buttons (see the "storyBlock" branch above), just optional here:
    // a hotspot click alone is enough to complete this node, buttons are
    // an extra way to route/navigate on top of that, not a replacement.
    var ciHorizontal = c.buttonLayout === "horizontal";
    var ciBtnBaseStyle = ciHorizontal ? "" : "max-width:220px;margin-top:6px";
    var ciBtnsHtml = "";
    (c.buttons || []).forEach(function (b) {
      if (b.kind === "back") {
        var prevCi = previousConnectingNode(session.hunt, n.id);
        if (prevCi) ciBtnsHtml += pvItemButton("pv-choice-btn pv-back-btn", 'data-back-target="' + esc(prevCi.id) + '"', b.label || "← Back", b.fontSize, ciBtnBaseStyle);
      } else {
        ciBtnsHtml += pvItemButton("pv-choice-btn", 'data-opt="' + esc(b.id) + '"', b.label || "Continue", b.fontSize, ciBtnBaseStyle);
      }
    });
    if (ciBtnsHtml) html += ciHorizontal ? '<div class="pv-btn-row">' + ciBtnsHtml + '</div>' : ciBtnsHtml;
    var fbCk = session.state.feedback[n.id];
    if (fbCk === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  }
  // Generic optional Back button — every BACK_BUTTON_TYPES node type gets
  // this same "← Back" affordance as Simple Text's showBackButton, off by
  // default and only rendered when there's actually an upstream node to
  // return to. Story Block/Clickable Image opt into their own back button
  // via their buttons list instead (handled in their branches above), and
  // Simple Text handles its own showBackButton at the top of this chain.
  if (c.showBackButton && BACK_BUTTON_TYPES.indexOf(n.type) !== -1) {
    var prevGeneric = previousConnectingNode(session.hunt, n.id);
    if (prevGeneric) {
      html += '<button class="pv-choice-btn pv-back-btn" data-back-target="' + esc(prevGeneric.id) + '" style="max-width:200px;margin-top:8px">← Back</button>';
    }
  }
  if (hints.length) {
    html += '<div style="margin-top:14px">';
    hints.forEach(function (h) {
      var shown = session.state.hintProgress[h.id] || 0;
      html += '<div><button class="pv-hint-btn" data-hint="' + h.id + '" ' + (shown >= h.content.stages.length ? "disabled" : "") + '>💡 Reveal hint (' + shown + "/" + h.content.stages.length + ')</button>';
      for (var i = 0; i < shown; i++) html += '<div class="pv-hint-text"' + pvFontStyle(h.content.stages[i].fontSize, 12) + '>' + esc(h.content.stages[i].text) + '</div>';
      html += '</div>';
    });
    html += '</div>';
  }
  return wrapWithMedia(c, html);
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

// Physical Lock Code Entry — draggable combination-lock number wheels, like
// a real bike/luggage lock: each wheel is a vertical reel of every value in
// the code's alphabet (digits or letters), dragged up/down with mouse or
// finger to scroll the next value into the window. Purely a presentation
// layer: this function only ever keeps the hidden #pvLockInput (and the
// #pvLockReadout text) in sync with ctl.lockDialDraft[n.id], so the existing
// wireTextSubmitAction/pv_action_submitLockCode plumbing (wired against that
// same input a few lines below) never needs to know wheels exist. No-op if
// this node's markup isn't on screen (same guard convention as every other
// wire* fn).
function wireLockDials(root, ctl, session, n) {
  var wheels = root.querySelectorAll(".pv-lock-wheel");
  if (!wheels.length) return;
  var c = n.content;
  var wheelValues = c.codeFormat === "alpha" ? "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("") : "0123456789".split("");
  var wheelN = wheelValues.length;
  var maxOffsetRows = LOCK_REPEATS * wheelN - 1;
  var dialState = ctl.lockDialDraft[n.id];
  var readoutEl = root.querySelector("#pvLockReadout");
  var hiddenInput = root.querySelector("#pvLockInput");
  if (!dialState) return;

  function syncOutputs() {
    var code = dialState.map(function (idx) { return wheelValues[idx]; }).join("");
    if (readoutEl) readoutEl.textContent = code.split("").join(" ");
    if (hiddenInput) hiddenInput.value = code;
  }

  Array.prototype.forEach.call(wheels, function (wheelEl) {
    var idx = +wheelEl.dataset.lockidx;
    var track = wheelEl.querySelector(".pv-lock-wheel-track");
    var win = wheelEl.querySelector(".pv-lock-wheel-window");
    if (!track || dialState[idx] === undefined) return;

    var dragging = false, startY = 0, startOffsetRows = 0, liveOffsetRows = 0;

    function applyTransform(offsetRows) {
      track.style.transform = "translateY(" + (-offsetRows * LOCK_ROW_H) + "px)";
    }

    // Arrow buttons / scroll wheel — a single-step nudge that always resets
    // onto the middle copy of the stacked alphabet, same re-centering idea
    // as a drag gesture's start (see below), so repeated clicks/scrolls
    // never drift toward the copy-array's edges.
    function step(delta) {
      var newIndex = ((dialState[idx] + delta) % wheelN + wheelN) % wheelN;
      dialState[idx] = newIndex;
      track.style.transition = "transform .18s cubic-bezier(.2,.8,.3,1)";
      applyTransform(LOCK_CENTER_COPY * wheelN + newIndex);
      syncOutputs();
    }

    wheelEl.onpointerdown = function (e) {
      if (e.target.closest && e.target.closest(".pv-lock-arrow")) return; // let the arrow's own click handler fire
      e.preventDefault();
      dragging = true;
      startY = e.clientY;
      // Every drag gesture re-centers on the middle copy of the stacked
      // alphabet (see LOCK_REPEATS) — that's what gives each individual
      // drag its own +/-2-turn headroom without needing true infinite-
      // scroll wraparound bookkeeping across separate gestures.
      startOffsetRows = LOCK_CENTER_COPY * wheelN + dialState[idx];
      liveOffsetRows = startOffsetRows;
      track.style.transition = "none";
      try { wheelEl.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: drag still tracks via direct listeners */ }
    };
    wheelEl.onpointermove = function (e) {
      if (!dragging) return;
      var dy = e.clientY - startY; // drag down = reveal the previous (smaller) value, like a real picker wheel
      liveOffsetRows = startOffsetRows - dy / LOCK_ROW_H;
      if (liveOffsetRows < 0) liveOffsetRows = 0;
      if (liveOffsetRows > maxOffsetRows) liveOffsetRows = maxOffsetRows;
      applyTransform(liveOffsetRows);
      var liveIndex = Math.round(liveOffsetRows);
      liveIndex = ((liveIndex % wheelN) + wheelN) % wheelN;
      if (readoutEl) {
        var vals = dialState.slice(); vals[idx] = liveIndex;
        readoutEl.textContent = vals.map(function (i) { return wheelValues[i]; }).join(" ");
      }
    };
    function finish() {
      if (!dragging) return;
      dragging = false;
      var snapped = Math.round(liveOffsetRows);
      if (snapped < 0) snapped = 0;
      if (snapped > maxOffsetRows) snapped = maxOffsetRows;
      dialState[idx] = ((snapped % wheelN) + wheelN) % wheelN;
      track.style.transition = "transform .18s cubic-bezier(.2,.8,.3,1)";
      applyTransform(snapped);
      syncOutputs();
    }
    wheelEl.onpointerup = finish;
    wheelEl.onpointercancel = finish;

    if (win) win.onwheel = function (e) {
      e.preventDefault();
      step(e.deltaY > 0 ? -1 : 1);
    };

    Array.prototype.forEach.call(wheelEl.querySelectorAll(".pv-lock-arrow"), function (btn) {
      btn.onclick = function () { step(+btn.dataset.lockdir); };
    });
  });

  syncOutputs();
}

// Cryptex Dial Lock (3 Letter) — three concentric letter rings (A–Z) drawn
// as inline SVG. Each ring has an invisible "hit" circle the player drags
// (mouse or touch, via pointer capture) to spin it; a fixed pointer at the
// top of the housing marks the letter currently "selected" on each ring.
// Pressing the centre stud reads off the three pointer letters and submits
// them through the same free-text answer pipeline as Answer Entry
// (pv_action_submitAnswer/checkTextAnswer), so grading, feedback and node
// completion all reuse existing plumbing — only the input UI is bespoke.
// Purely presentational, same division of labour as wireLockDials above:
// renderCryptexSvg draws from ctl.cryptexDraft[n.id], wireCryptexInteractions
// keeps that same state in sync with drag gestures and clicks.
var CRYPTEX_CX = 250, CRYPTEX_CY = 340, CRYPTEX_STEP = 360 / 26;

// activeIdx: index (0-25) of the letter currently sitting under the fixed
// pointer on this ring — that letter's text gets the .cryptex-letter-active
// class (a darker highlight colour, see styles.css) so the player can read
// off their current combination at a glance, live as they drag.
function cryptexLetterMarkup(cx, cy, r, activeIdx) {
  var s = "";
  for (var i = 0; i < 26; i++) {
    var angle = i * CRYPTEX_STEP;
    var cls = "cryptex-letter" + (i === activeIdx ? " cryptex-letter-active" : "");
    s += '<g class="cryptex-letter-g" data-index="' + i + '" transform="rotate(' + angle + ' ' + cx + ' ' + cy + ')"><text x="' + cx + '" y="' + (cy - r + 6) + '" text-anchor="middle" class="' + cls + '">' + String.fromCharCode(65 + i) + '</text></g>';
  }
  return s;
}

function cryptexPointerIndex(rotationDeg) {
  var idx = Math.round(-rotationDeg / CRYPTEX_STEP);
  return ((idx % 26) + 26) % 26;
}
function cryptexPointerLetter(rotationDeg) {
  return String.fromCharCode(65 + cryptexPointerIndex(rotationDeg));
}

// Wrapped in .pv-cryptex-wrap (rather than shaking/transforming the <svg>
// root directly) so the wrong-answer shake — a plain CSS animation toggled
// in wireCryptexInteractions — has a reliable box to apply translateX to.
function renderCryptexSvg(nodeId, rot) {
  var cx = CRYPTEX_CX, cy = CRYPTEX_CY, idp = "cx" + nodeId.replace(/[^a-zA-Z0-9]/g, "") + "_";
  return '<div class="pv-cryptex-wrap"><svg class="cryptex-svg" data-node="' + nodeId + '" width="320" viewBox="0 0 500 600" style="display:block;margin:10px auto 0;max-width:100%;">' +
    '<defs>' +
      '<radialGradient id="' + idp + 'plate" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#e4e1d6"/><stop offset="55%" stop-color="#a9a598"/><stop offset="100%" stop-color="#69665c"/></radialGradient>' +
      '<linearGradient id="' + idp + 'shackle" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#8c8c8c"/><stop offset="50%" stop-color="#e8e8e8"/><stop offset="100%" stop-color="#6b6b6b"/></linearGradient>' +
      '<radialGradient id="' + idp + 'ro" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#c79a52"/><stop offset="100%" stop-color="#7a5a28"/></radialGradient>' +
      '<radialGradient id="' + idp + 'rm" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#d4b06a"/><stop offset="100%" stop-color="#8c6c34"/></radialGradient>' +
      '<radialGradient id="' + idp + 'ri" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#e0c17e"/><stop offset="100%" stop-color="#9c7c40"/></radialGradient>' +
    '</defs>' +
    '<g class="cryptex-shackle"><path d="M 200 400 L 200 150 A 50 50 0 0 1 300 150 L 300 400" fill="none" stroke="url(#' + idp + 'shackle)" stroke-width="24" stroke-linecap="round"/></g>' +
    '<circle cx="250" cy="340" r="192" fill="url(#' + idp + 'plate)" stroke="#4a473e" stroke-width="3"/>' +
    '<polygon points="250,132 240,150 260,150" fill="#d8483f" stroke="#5a1a15" stroke-width="1"/>' +
    '<g class="cryptex-ring" data-ring="outer" transform="rotate(' + rot.outer + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="165" fill="url(#' + idp + 'ro)" stroke="#3d2f14" stroke-width="46"/>' + cryptexLetterMarkup(cx, cy, 165, cryptexPointerIndex(rot.outer)) + '</g>' +
    '<circle cx="250" cy="340" r="188" fill="none" stroke="#3d3a32" stroke-width="1.5"/><circle cx="250" cy="340" r="142" fill="none" stroke="#3d3a32" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="outer" cx="250" cy="340" r="165" fill="#000" opacity="0" stroke="#000" stroke-width="46"/>' +
    '<g class="cryptex-ring" data-ring="middle" transform="rotate(' + rot.middle + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="117" fill="url(#' + idp + 'rm)" stroke="#4a3a18" stroke-width="42"/>' + cryptexLetterMarkup(cx, cy, 117, cryptexPointerIndex(rot.middle)) + '</g>' +
    '<circle cx="250" cy="340" r="138" fill="none" stroke="#3d3a32" stroke-width="1.5"/><circle cx="250" cy="340" r="96" fill="none" stroke="#3d3a32" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="middle" cx="250" cy="340" r="117" fill="#000" opacity="0" stroke="#000" stroke-width="42"/>' +
    '<g class="cryptex-ring" data-ring="inner" transform="rotate(' + rot.inner + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="73" fill="url(#' + idp + 'ri)" stroke="#5a4622" stroke-width="38"/>' + cryptexLetterMarkup(cx, cy, 73, cryptexPointerIndex(rot.inner)) + '</g>' +
    '<circle cx="250" cy="340" r="92" fill="none" stroke="#3d3a32" stroke-width="1.5"/><circle cx="250" cy="340" r="54" fill="none" stroke="#3d3a32" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="inner" cx="250" cy="340" r="73" fill="#000" opacity="0" stroke="#000" stroke-width="38"/>' +
    '<g class="cryptex-center">' +
      '<circle class="cryptex-btn-face" cx="250" cy="340" r="46" fill="#caa15a" stroke="#6b4a20" stroke-width="2"/>' +
      '<circle cx="250" cy="340" r="46" fill="none" stroke="#3d3a32" stroke-width="1.5"/>' +
      '<circle cx="250" cy="330" r="9" fill="#4a3a1c"/><polygon points="244,336 256,336 251,354 249,354" fill="#4a3a1c"/>' +
    '</g>' +
  '</svg></div>';
}

// Wired fresh on every render (like every other wire* fn here) — pointer
// capture on each ring's own hit circle means move/up keep routing to that
// same element even once the cursor leaves it, so no persistent window-level
// listener or module-scope drag variable is needed.
function wireCryptexInteractions(root, ctl, session, n) {
  var svg = root.querySelector('.cryptex-svg[data-node="' + n.id + '"]');
  if (!svg) return;
  if (!ctl.cryptexDraft[n.id]) ctl.cryptexDraft[n.id] = { outer: 0, middle: 0, inner: 0 };
  var rot = ctl.cryptexDraft[n.id];
  var wrapEl = svg.closest(".pv-cryptex-wrap");

  function angleFromEvent(evt) {
    var pt = svg.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return (Math.atan2(p.y - CRYPTEX_CY, p.x - CRYPTEX_CX) * 180 / Math.PI) + 90;
  }

  // Keeps the .cryptex-letter-active highlight on whichever letter is
  // currently under the fixed pointer in sync with rot[ring] — called both
  // live during a drag and once more on release/snap.
  function updateActiveLetter(ring) {
    var idx = cryptexPointerIndex(rot[ring]);
    var ringEl = svg.querySelector('.cryptex-ring[data-ring="' + ring + '"]');
    if (!ringEl) return;
    Array.prototype.forEach.call(ringEl.querySelectorAll(".cryptex-letter-g"), function (g) {
      var text = g.querySelector("text");
      if (text) text.classList.toggle("cryptex-letter-active", +g.dataset.index === idx);
    });
  }

  Array.prototype.forEach.call(svg.querySelectorAll(".cryptex-hit"), function (hit) {
    var ring = hit.dataset.ring;
    var ringEl = svg.querySelector('.cryptex-ring[data-ring="' + ring + '"]');
    var dragging = false, lastAngle = 0;

    hit.onpointerdown = function (e) {
      dragging = true;
      lastAngle = angleFromEvent(e);
      e.preventDefault();
      try { hit.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: drag still tracks via direct listeners */ }
    };
    hit.onpointermove = function (e) {
      if (!dragging) return;
      var angle = angleFromEvent(e);
      var delta = angle - lastAngle;
      while (delta > 180) delta -= 360;
      while (delta < -180) delta += 360;
      lastAngle = angle;
      rot[ring] += delta;
      if (ringEl) ringEl.setAttribute("transform", "rotate(" + rot[ring] + " " + CRYPTEX_CX + " " + CRYPTEX_CY + ")");
      updateActiveLetter(ring);
    };
    function finish() {
      if (!dragging) return;
      dragging = false;
      rot[ring] = Math.round(rot[ring] / CRYPTEX_STEP) * CRYPTEX_STEP;
      if (ringEl) ringEl.setAttribute("transform", "rotate(" + rot[ring] + " " + CRYPTEX_CX + " " + CRYPTEX_CY + ")");
      updateActiveLetter(ring);
    }
    hit.onpointerup = finish;
    hit.onpointercancel = finish;
  });

  var center = svg.querySelector(".cryptex-center");
  var ringEls = Array.prototype.slice.call(svg.querySelectorAll(".cryptex-ring"));
  var shackleEl = svg.querySelector(".cryptex-shackle");

  if (center) center.onclick = function () {
    // Guards against a second submission (e.g. an eager double-click) during
    // the 3-second "unlocked" pause below, while the node has already
    // completed but the view hasn't advanced off it yet.
    if (svg.dataset.cxLocked === "1") return;
    var combo = cryptexPointerLetter(rot.outer) + cryptexPointerLetter(rot.middle) + cryptexPointerLetter(rot.inner);
    var ok = pv_action_submitAnswer(session, n.id, combo);

    if (ok) {
      svg.dataset.cxLocked = "1";
      center.classList.remove("cryptex-fail");
      center.classList.add("cryptex-success");
      ringEls.forEach(function (g) { g.classList.add("cryptex-flash-success"); });
      if (shackleEl) shackleEl.classList.add("cryptex-open");
      // Hold the unlocked pose on screen for 3 seconds before the view
      // actually advances to whatever comes next, so the player gets to see
      // it — the node itself already completed above (session/available
      // leads etc. are already up to date); this timeout only delays the
      // re-render that moves the screen on.
      setTimeout(function () {
        ctl.expandedNodeId = null; ctl.pinnedNodeId = null;
        ctl.render();
      }, 3000);
    } else {
      center.classList.remove("cryptex-success");
      center.classList.add("cryptex-fail");
      ringEls.forEach(function (g) { g.classList.add("cryptex-flash-fail"); });
      if (wrapEl) {
        wrapEl.classList.remove("cryptex-shake");
        void wrapEl.offsetWidth; // restart the shake animation even on repeated wrong guesses
        wrapEl.classList.add("cryptex-shake");
      }
      setTimeout(function () {
        center.classList.remove("cryptex-fail");
        ringEls.forEach(function (g) { g.classList.remove("cryptex-flash-fail"); });
        ctl.render();
      }, 650);
    }
  };
}

function wirePreviewNodeInteractions(session, n, ctl) {
  if (!n) return;
  var root = ctl.mainEl;
  var byId = function (id) { return root.querySelector("#" + id); };
  // True when the screen currently on display is a Back-peek at an
  // already-completed node (see ctl.peekStack, below, and the peek branch
  // in ctl.render()) rather than the player's live current node — in that
  // case the primary/option button(s) just return to where the player was
  // instead of re-completing an already-completed node.
  var peeking = !!(ctl.peekStack && ctl.peekStack.length && ctl.peekStack[ctl.peekStack.length - 1] === n.id);
  if (byId("pvContinue")) byId("pvContinue").onclick = function () {
    if (peeking) { ctl.peekStack.pop(); ctl.render(); return; }
    var ok = pv_action_continueScene(session, n.id);
    if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };
  Array.prototype.forEach.call(root.querySelectorAll("[data-opt]"), function (el) {
    el.onclick = function () {
      if (peeking) { ctl.peekStack.pop(); ctl.render(); return; }
      var ok = pv_action_selectChoice(session, n.id, el.dataset.opt);
      if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
      ctl.render();
    };
  });
  // Back button (Simple Text / Story Block) — always pushes the target node
  // onto the peek stack, whether we're currently live or already mid-peek
  // (peeking further back), so pv-back-btn behaves identically either way.
  Array.prototype.forEach.call(root.querySelectorAll(".pv-back-btn"), function (el) {
    el.onclick = function () {
      var target = el.dataset.backTarget;
      if (!target) return;
      ctl.peekStack = ctl.peekStack || [];
      ctl.peekStack.push(target);
      ctl.render();
    };
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
  wireLockDials(root, ctl, session, n);
  wireCryptexInteractions(root, ctl, session, n);
  wireTextSubmitAction(root, ctl, session, n, "pvCrossRefInput", "pvSubmitCrossRef", pv_action_submitCrossReferenceAnswer);
  wirePdfReveal(root, ctl, session, n);

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

  // Fuse Panel — click/tap or Enter/Space toggles a switch; auto-validates
  // after every flip, same interaction shape as Sliding Tile above.
  Array.prototype.forEach.call(root.querySelectorAll("[data-swid]"), function (el) {
    var flip = function () {
      var draft = ctl.fuseDraft[n.id];
      if (!draft) return;
      draft[el.dataset.swid] = !draft[el.dataset.swid];
      var ok = pv_action_submitFusePanel(session, n.id, draft);
      if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
      ctl.render();
    };
    el.onclick = flip;
    el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); flip(); } };
  });

  wireHintButtons(session, root, ctl);
}

// Renders whatever node was pinned via ctl.showNode() (e.g. a Studio
// canvas selection) exactly as the player screen would — no creator
// chrome overlaid — and hands control back to the normal auto-following
// flow as soon as the player actually interacts with something.
function renderPinnedNode(session, n, ctl) {
  var state = session.state;

  if (n.type === "ending") {
    ctl.mainEl.innerHTML = wrapWithMedia(n.content, '<div class="pv-ending"><h2>🏁 ' + esc(n.content.resultName) + '</h2><p class="pv-scene-body"' + pvFontStyle(n.content.bodyFontSize) + '>' + esc(n.content.body) + '</p></div>');
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
    sequenceDraft: {}, tileDraft: {}, multiPartDraft: {}, lockDialDraft: {}, cryptexDraft: {}, fuseDraft: {},
    pdfPageDraft: {}, pdfEnterAnim: {}, // pdfPageDraft: node id -> current page number; pdfEnterAnim: node id -> one-shot entrance-animation class for the page that just turned in (see wirePdfReveal/renderPdfRevealBlock)
    pinnedNodeId: null, // set when an outside selection (e.g. the canvas) asks to force-show a node
    peekStack: [], // node ids the player has stepped back through via a Simple Text/Story Block Back button — see the peek branch in ctl.render() and wirePreviewNodeInteractions' pv-back-btn handling. Last entry is the node currently shown; its own forward button pops one level instead of re-completing it.
    laneListId: null, laneListSceneId: null, // set when a lane tab (Leads/Inventory/Hints) asks to show its scene-wide options list instead of a single node
    currentLane: "story", // which lane the main panel's default "open leads" view is scoped to — see ctl.render(); kept in sync by showNode/showLaneList (tab bar taps) so a connection into a different lane never silently jumps the view there
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
    ctl.lockDialDraft = {};
    ctl.cryptexDraft = {};
    ctl.fuseDraft = {};
    ctl.pinnedNodeId = null;
    ctl.peekStack = [];
    ctl.laneListId = null;
    ctl.laneListSceneId = null;
    ctl.currentLane = "story";
    ctl.render();
  };

  ctl.restart = function () { if (ctl.session) ctl.open(ctl.session.hunt); };

  // Force the view to show a specific node regardless of the normal
  // "current open leads" flow — used when a node is selected on canvas or
  // the Story/Map tab jumps to a node. Also updates ctl.currentLane to that
  // node's lane, so if the pin is later cleared the default view falls
  // back to that same lane rather than wherever it happened to be before.
  ctl.showNode = function (nodeId) {
    ctl.pinnedNodeId = nodeId; ctl.laneListId = null;
    var node = ctl.session && ctl.session.hunt.nodes.find(function (n) { return n.id === nodeId; });
    if (node) ctl.currentLane = node.lane;
    ctl.render();
  };
  // Force the view to show every currently-available option in one lane
  // × scene cell (Leads/Inventory/Hints tab bar taps) instead of jumping
  // straight into a single node.
  ctl.showLaneList = function (laneId, sceneId) { ctl.laneListId = laneId; ctl.laneListSceneId = sceneId || null; ctl.pinnedNodeId = null; ctl.currentLane = laneId; ctl.render(); };
  ctl.clearPin = function () { if (ctl.pinnedNodeId || ctl.laneListId) { ctl.pinnedNodeId = null; ctl.laneListId = null; ctl.render(); } };

  ctl.render = function () {
    var session = ctl.session;
    if (!session) return;
    var hunt = session.hunt, state = session.state;
    var main = ctl.mainEl, side = ctl.sideEl;

    var pinnedNode = ctl.pinnedNodeId ? hunt.nodes.find(function (n) { return n.id === ctl.pinnedNodeId; }) : null;
    if (ctl.pinnedNodeId && !pinnedNode) ctl.pinnedNodeId = null; // was deleted — fall back to normal flow

    // Drop any peeked node ids that no longer exist (e.g. deleted mid-preview).
    if (ctl.peekStack && ctl.peekStack.length) {
      ctl.peekStack = ctl.peekStack.filter(function (id) { return !!hunt.nodes.find(function (n) { return n.id === id; }); });
    }
    var peekNode = (ctl.peekStack && ctl.peekStack.length) ? hunt.nodes.find(function (n) { return n.id === ctl.peekStack[ctl.peekStack.length - 1]; }) : null;

    if (pinnedNode) {
      renderPinnedNode(session, pinnedNode, ctl);
    } else if (peekNode) {
      // A Back button (Simple Text / Story Block) sent the player to look at
      // an already-completed earlier screen — render it exactly like a live
      // node (so its own Continue/Back buttons work), but wirePreviewNodeInteractions
      // detects we're mid-peek and makes the forward button return instead
      // of re-completing an already-completed node.
      main.innerHTML = renderPreviewNode(session, peekNode, ctl);
      wirePreviewNodeInteractions(session, peekNode, ctl);
      ctl._activeIds = { expandedId: peekNode.id, leadIds: openLeadNodes(session).map(function (x) { return x.id; }) };
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
        wrapWithMedia(en.content, '<div class="pv-ending"><h2>🏁 ' + esc(en.content.resultName) + '</h2><p class="pv-scene-body"' + pvFontStyle(en.content.bodyFontSize) + '>' + esc(en.content.body) + '</p>' +
        '<p style="color:var(--pv-text-dim);font-size:12px">Hunt complete. ' + Object.keys(state.completed).length + " nodes visited · Score " + state.score + '</p></div>')
        : '<div class="pv-empty">The reached ending was removed from the hunt.</div>';
      ctl._activeIds = { expandedId: null, leadIds: [] };
    } else {
      // Only nodes in the lane the player is currently viewing drive the
      // default main-panel view — a connection that unlocks something in a
      // different lane must not yank the player over to it. That other
      // lane's new item still becomes available (state.available is
      // unaffected) and surfaces as a badge on its tab (see
      // laneBadgeCounts/renderPlayerTabBar in app.js); the player reaches
      // it by switching tabs themselves. allLeads (unfiltered) is still
      // used for canvas "open" highlighting below, which stays whole-graph.
      var allLeads = openLeadNodes(session);
      var currentLane = ctl.currentLane || "story";
      var leads = allLeads.filter(function (n) { return n.lane === currentLane; });
      if (!allLeads.length) {
        main.innerHTML = '<div class="pv-empty">No content is currently available. This may indicate an unreachable section — check the Validation panel.</div>';
        ctl._activeIds = { expandedId: null, leadIds: [] };
      } else if (!leads.length) {
        main.innerHTML = '<div class="pv-empty">Nothing more here right now — check the other tabs for what has opened up.</div>';
        ctl._activeIds = { expandedId: null, leadIds: allLeads.map(function (n) { return n.id; }) };
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
        ctl._activeIds = { expandedId: expanded ? expanded.id : null, leadIds: allLeads.map(function (n) { return n.id; }) };
      }
    }

    if (side) {
      var sideHtml = "";
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
  IMAGE_ASPECT_RATIOS: IMAGE_ASPECT_RATIOS,
  IMAGE_FRAME_STYLES: IMAGE_FRAME_STYLES,
  LOCK_STYLES: LOCK_STYLES,

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
  previousConnectingNode: previousConnectingNode,

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
  pv_action_submitFusePanel: pv_action_submitFusePanel,
  pv_action_revealHint: pv_action_revealHint,

  PLAYER_SCREEN_TYPES: PLAYER_SCREEN_TYPES,
  BACK_BUTTON_TYPES: BACK_BUTTON_TYPES,
  DEFAULT_BUTTON_LABEL: DEFAULT_BUTTON_LABEL,
  BUTTON_LABEL_TYPES: BUTTON_LABEL_TYPES,
  buttonLabelFor: buttonLabelFor,
  nodeCompletionOk: nodeCompletionOk,
  openLeadNodes: openLeadNodes,
  hintsForNode: hintsForNode,
  laneOptionsForScene: laneOptionsForScene,
  renderLaneOptionsList: renderLaneOptionsList,
  wireHintButtons: wireHintButtons,
  wrapWithMedia: wrapWithMedia,
  mediaBrightnessOf: mediaBrightnessOf,
  mediaAdjustFilterCss: mediaAdjustFilterCss,
  renderImageRevealBlock: renderImageRevealBlock,
  renderPdfRevealBlock: renderPdfRevealBlock,
  renderClickableImageBlock: renderClickableImageBlock,
  renderPreviewNode: renderPreviewNode,
  wirePreviewNodeInteractions: wirePreviewNodeInteractions,
  renderPinnedNode: renderPinnedNode,
  createPreviewController: createPreviewController
};

});
