/* =========================================================================
   PuzzleAtlas Studio — Phase 1 Local Prototype
   Single-file, zero-dependency, offline vanilla-JS implementation.
   No backend, no accounts. The canvas is a view over one canonical JSON
   "hunt model" (schema v0). Export/import/preview all read that same model.
   ========================================================================= */

(function () {
"use strict";

/* ---------------------------------------------------------------------
   Utilities
--------------------------------------------------------------------- */
function uid(prefix) {
  return (prefix || "id") + "_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function snap(v, size) { return Math.round(v / size) * size; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function esc(s) {
  s = (s === undefined || s === null) ? "" : String(s);
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function toast(msg, ms) {
  var t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._h);
  toast._h = setTimeout(function () { t.classList.add("hidden"); }, ms || 2200);
}
function download(filename, text) {
  var blob = new Blob([text], { type: "application/json" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
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
  stub:      { label: "Stub",      color: "stub" }
};

var NODE_TYPES = {
  scene: {
    family: "narrative", label: "Scene / Text Reveal", icon: "📜",
    defaultTitle: "New Scene",
    defaultContent: function () { return { body: "Write the narrative text the player sees here." }; },
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
  hint: {
    family: "support", label: "Hint (progressive)", icon: "💡",
    defaultTitle: "Hint",
    defaultContent: function () {
      return { forNodeId: "", stages: [{ id: uid("hs"), text: "First, gentle nudge." }, { id: uid("hs"), text: "A stronger hint." }] };
    },
    summary: function (c, hunt) { return "For: " + nodeTitle(hunt, c.forNodeId) + " (" + (c.stages || []).length + " stages)"; }
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
   Style packs — pluggable, standalone files that set the player-facing
   visual/tonal norms for a hunt (fonts, colours, imagery treatment,
   pacing). See docs/PuzzleAtlas_Style_Packs.md and
   style-packs/schema/style-pack.schema.json for the full format.
   These built-ins are embedded so they work with zero network access;
   "studio-default" reproduces the existing look exactly, so hunts with
   no style pack chosen render identically to before this feature.
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

function applyStylePack(pack) {
  pack = pack && styleFieldsPresent(pack) ? pack : getStylePack(DEFAULT_STYLE_PACK_ID);
  var t = pack.typography, pal = pack.palette, sh = pack.shape || {}, img = pack.imagery || {};
  var fam = pal.families || {};
  // Applied to the full-screen Preview overlay, the docked Player mockup's
  // phone screen, and the Style Builder's own live-preview phone screen —
  // whichever of these exist in the DOM at the time all mirror the pack.
  ["previewOverlay", "phoneScreen", "styleBuilderPreview"].forEach(function (targetId) {
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

function importStylePackFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var pack = JSON.parse(reader.result);
      if (!styleFieldsPresent(pack)) throw new Error("File is missing required style pack fields (typography.headingFont/bodyFont, palette.background/surface/text/textDim/accent).");
      if (!pack.id) pack.id = "imported-" + uid("style");
      if (!pack.name) pack.name = "Imported Style Pack";
      STYLE_PACKS[pack.id] = pack; // register so it appears in the picker for this session
      Store.hunt.stylePack = clone(pack);
      Store.pushHistory();
      renderHuntMeta();
      applyStylePack(Store.hunt.stylePack); // keeps both the Preview overlay and the docked mock panel in sync
      toast("Imported style pack \"" + pack.name + "\".");
    } catch (e) {
      toast("Style pack import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------
   Style Library (custom style packs) — localStorage-backed, separate
   from both the built-in STYLE_PACKS and the Hunt Library. A creator
   crafts/saves styles here (via the Style Builder screen), and any
   saved style then shows up in a hunt's Style Pack picker alongside the
   built-ins. Saved custom packs are also merged into the in-memory
   STYLE_PACKS registry so existing lookup/apply code (getStylePack,
   applyStylePack, the Hunt Setup picker) needs no special-casing.
--------------------------------------------------------------------- */
var CUSTOM_STYLE_KEY = "puzzleatlas_studio_custom_styles_v1";

function loadCustomStylePacksRaw() {
  var raw = localStorage.getItem(CUSTOM_STYLE_KEY);
  if (!raw) return [];
  try { return JSON.parse(raw).packs || []; } catch (e) { return []; }
}
function persistCustomStylePacks(list) {
  localStorage.setItem(CUSTOM_STYLE_KEY, JSON.stringify({ packs: list }));
}
function getCustomStylePacks() {
  return loadCustomStylePacksRaw().slice().sort(function (a, b) {
    return new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0);
  });
}
function getCustomStylePackById(id) {
  return loadCustomStylePacksRaw().find(function (p) { return p.id === id; });
}
function isCustomStylePackId(id) { return BUILTIN_STYLE_PACK_IDS.indexOf(id) === -1; }

function upsertCustomStylePack(pack) {
  pack.updatedAt = new Date().toISOString();
  var list = loadCustomStylePacksRaw();
  var idx = list.findIndex(function (p) { return p.id === pack.id; });
  var copy = clone(pack);
  if (idx === -1) list.push(copy); else list[idx] = copy;
  persistCustomStylePacks(list);
  STYLE_PACKS[pack.id] = clone(pack); // keep in-memory registry (picker, getStylePack) in sync
}
function deleteCustomStylePack(id) {
  persistCustomStylePacks(loadCustomStylePacksRaw().filter(function (p) { return p.id !== id; }));
  delete STYLE_PACKS[id];
}
function loadCustomStylePacksIntoRegistry() {
  getCustomStylePacks().forEach(function (p) { STYLE_PACKS[p.id] = clone(p); });
}
function newBlankStylePack() {
  var base = clone(STYLE_PACKS[DEFAULT_STYLE_PACK_ID]);
  base.id = uid("style");
  base.name = "New Style";
  base.description = "";
  base.vibe = { tags: [], toneNotes: "" };
  return base;
}

function familyOf(nodeType) { return (NODE_TYPES[nodeType] || {}).family || "stub"; }
function nodeTitle(hunt, id) { var n = (hunt.nodes || []).find(function (x) { return x.id === id; }); return n ? n.title : "(none)"; }
function varName(hunt, id) { var v = (hunt.variables || []).find(function (x) { return x.id === id; }); return v ? v.name : "(unset)"; }
function itemName(hunt, id) { var it = (hunt.items || []).find(function (x) { return x.id === id; }); return it ? it.name : "(unset)"; }

function newHunt(title) {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid("hunt"),
    title: title || "Untitled Hunt",
    metadata: {
      concept: "",
      audience: "",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    },
    entryPointIds: [],
    variables: [],
    items: [],
    nodes: [],
    connections: [],
    stylePack: getStylePack(DEFAULT_STYLE_PACK_ID)
  };
}

function newNode(type, x, y) {
  var def = NODE_TYPES[type];
  return {
    id: uid("n"),
    type: type,
    family: def.family,
    title: def.defaultTitle,
    position: { x: x || 0, y: y || 0 },
    size: { w: NODE_W, h: NODE_H },
    content: def.defaultContent(),
    creatorNotes: "",
    effects: []
  };
}

function newConnection(sourceId, targetId) {
  return {
    id: uid("c"),
    sourceId: sourceId,
    targetId: targetId,
    condition: { type: "always" },
    priority: 0,
    label: ""
  };
}

/* ---------------------------------------------------------------------
   Store — canonical hunt model + selection + undo/redo history
--------------------------------------------------------------------- */
var Store = {
  hunt: newHunt(),
  selection: { type: null, id: null },      // type: 'node' | 'edge' | null
  multiSelectNodeIds: [],                    // for multi-select/delete
  view: { x: 0, y: 0, zoom: 1 },
  snapEnabled: true,
  history: [],
  future: [],
  _suspend: false,

  init: function () {
    this.hunt = newHunt();
    this.pushHistory();
  },

  pushHistory: function () {
    if (this._suspend) return;
    this.history.push(clone(this.hunt));
    if (this.history.length > 100) this.history.shift();
    this.future = [];
    this.hunt.metadata.updatedAt = new Date().toISOString();
  },

  undo: function () {
    if (this.history.length < 2) { toast("Nothing to undo"); return; }
    this.future.push(this.history.pop());
    this.hunt = clone(this.history[this.history.length - 1]);
    this.selection = { type: null, id: null };
    render();
  },

  redo: function () {
    if (!this.future.length) { toast("Nothing to redo"); return; }
    var state = this.future.pop();
    this.history.push(state);
    this.hunt = clone(state);
    this.selection = { type: null, id: null };
    render();
  },

  replaceHunt: function (hunt) {
    this.hunt = hunt;
    this.selection = { type: null, id: null };
    this.multiSelectNodeIds = [];
    this.history = [clone(hunt)];
    this.future = [];
    render();
  },

  addNode: function (type, x, y) {
    var n = newNode(type, x, y);
    this.hunt.nodes.push(n);
    if (this.hunt.entryPointIds.length === 0) this.hunt.entryPointIds.push(n.id);
    this.pushHistory();
    return n;
  },

  removeNode: function (id) {
    this.hunt.nodes = this.hunt.nodes.filter(function (n) { return n.id !== id; });
    this.hunt.connections = this.hunt.connections.filter(function (c) { return c.sourceId !== id && c.targetId !== id; });
    this.hunt.entryPointIds = this.hunt.entryPointIds.filter(function (eid) { return eid !== id; });
    this.pushHistory();
  },

  removeNodes: function (ids) {
    var self = this;
    ids.forEach(function (id) {
      self.hunt.nodes = self.hunt.nodes.filter(function (n) { return n.id !== id; });
      self.hunt.entryPointIds = self.hunt.entryPointIds.filter(function (eid) { return eid !== id; });
    });
    this.hunt.connections = this.hunt.connections.filter(function (c) {
      return ids.indexOf(c.sourceId) === -1 && ids.indexOf(c.targetId) === -1;
    });
    this.pushHistory();
  },

  getNode: function (id) { return this.hunt.nodes.find(function (n) { return n.id === id; }); },
  getConnection: function (id) { return this.hunt.connections.find(function (c) { return c.id === id; }); },

  addConnection: function (sourceId, targetId) {
    if (sourceId === targetId) return null;
    var exists = this.hunt.connections.some(function (c) { return c.sourceId === sourceId && c.targetId === targetId; });
    if (exists) { toast("Connection already exists"); return null; }
    var c = newConnection(sourceId, targetId);
    this.hunt.connections.push(c);
    this.pushHistory();
    return c;
  },

  removeConnection: function (id) {
    this.hunt.connections = this.hunt.connections.filter(function (c) { return c.id !== id; });
    this.pushHistory();
  },

  select: function (type, id) {
    this.selection = { type: type, id: id };
    this.multiSelectNodeIds = (type === "node" && id) ? [id] : [];
    renderSelectionOnly();
    renderInspector();
    syncLiveMockSelection();
  },

  clearSelection: function () {
    this.selection = { type: null, id: null };
    this.multiSelectNodeIds = [];
    renderSelectionOnly();
    renderInspector();
    syncLiveMockSelection();
  }
};

/* ---------------------------------------------------------------------
   Validation engine — structural graph checks over the canonical model
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

/* ---------------------------------------------------------------------
   Canvas geometry + rendering
--------------------------------------------------------------------- */
var NODE_W = 220, NODE_H = 100, EDGE_OFFSET = 5000, GRID = 20;
var NODE_MIN_W = 160, NODE_MIN_H = 64, NODE_MAX_W = 560, NODE_MAX_H = 480;

// A node's on-canvas size, falling back to the default for nodes created
// before per-card resizing existed (demo/broken fixtures, older saves).
function nodeSize(node) {
  return {
    w: (node.size && node.size.w) || NODE_W,
    h: (node.size && node.size.h) || NODE_H
  };
}

function getPortPos(node, isOutput) {
  var sz = nodeSize(node);
  return {
    x: node.position.x + (isOutput ? sz.w : 0),
    y: node.position.y + sz.h / 2
  };
}

var dom = {}; // cached DOM refs, populated in init()

function applyViewportTransform() {
  dom.canvasViewport.style.transform =
    "translate(" + Store.view.x + "px," + Store.view.y + "px) scale(" + Store.view.zoom + ")";
}

function screenToWorld(clientX, clientY) {
  var rect = dom.canvasWrap.getBoundingClientRect();
  var lx = clientX - rect.left, ly = clientY - rect.top;
  return {
    x: (lx - Store.view.x) / Store.view.zoom,
    y: (ly - Store.view.y) / Store.view.zoom
  };
}

function nodeIconSpan(type) {
  return '<span class="node-icon" style="background:var(--' + FAMILIES[familyOf(type)].color + ')"></span>';
}

function renderNodes() {
  dom.nodeLayer.innerHTML = "";
  Store.hunt.nodes.forEach(function (n) {
    var def = NODE_TYPES[n.type];
    var div = document.createElement("div");
    var selected = Store.multiSelectNodeIds.indexOf(n.id) !== -1;
    div.className = "node fam-" + def.family + (selected ? " selected" : "");
    div.dataset.nodeId = n.id;
    div.style.left = n.position.x + "px";
    div.style.top = n.position.y + "px";
    var sz = nodeSize(n);
    div.style.width = sz.w + "px";
    div.style.height = sz.h + "px";
    var isEntry = Store.hunt.entryPointIds.indexOf(n.id) !== -1;
    div.innerHTML =
      '<div class="node-head">' + nodeIconSpan(n.type) +
        '<span class="node-type">' + def.icon + " " + esc(def.label) + (isEntry ? " · ENTRY" : "") + '</span></div>' +
      '<div class="node-title">' + esc(n.title) + '</div>' +
      '<div class="node-sub">' + esc(def.summary(n.content, Store.hunt)) + '</div>' +
      '<div class="node-port in" title="Incoming"></div>' +
      '<div class="node-port out" title="Drag to connect"></div>' +
      '<div class="node-resize-handle" title="Drag to resize · double-click to reset"></div>';
    dom.nodeLayer.appendChild(div);
  });
  markUnreachable();
  updateCanvasPlayerHighlight(LiveMock);
}

function markUnreachable() {
  var issues = validateHunt(Store.hunt);
  var badIds = {};
  issues.forEach(function (i) { if (i.title === "Unreachable node" && i.nodeId) badIds[i.nodeId] = true; });
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el) {
    if (badIds[el.dataset.nodeId]) el.classList.add("unreachable"); else el.classList.remove("unreachable");
  });
  renderValidationBadge(issues);
}

function edgePathD(p1, p2) {
  var dx = Math.max(60, Math.abs(p2.x - p1.x) * 0.5);
  var c1x = p1.x + dx, c1y = p1.y, c2x = p2.x - dx, c2y = p2.y;
  return "M " + p1.x + " " + p1.y + " C " + c1x + " " + c1y + ", " + c2x + " " + c2y + ", " + p2.x + " " + p2.y;
}

function conditionSummary(cond, hunt) {
  if (!cond || cond.type === "always") return "Always";
  if (cond.type === "nodeComplete") return nodeTitle(hunt, cond.nodeId) + " complete";
  if (cond.type === "allComplete") return "All of [" + cond.nodeIds.map(function (id) { return nodeTitle(hunt, id); }).join(", ") + "] complete";
  if (cond.type === "anyNComplete") return "Any " + cond.n + " of [" + cond.nodeIds.map(function (id) { return nodeTitle(hunt, id); }).join(", ") + "]";
  if (cond.type === "choiceSelected") return nodeTitle(hunt, cond.nodeId) + " → option selected";
  if (cond.type === "variableEquals") return varName(hunt, cond.variableId) + " = " + cond.value;
  if (cond.type === "variableAtLeast") return varName(hunt, cond.variableId) + " ≥ " + cond.value;
  if (cond.type === "itemHeld") return "Holds " + itemName(hunt, cond.itemId);
  return cond.type;
}

function renderEdges() {
  var svg = dom.edgeLayer;
  svg.innerHTML = "";
  var defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  svg.appendChild(defs);
  Store.hunt.connections.forEach(function (c) {
    var s = Store.getNode(c.sourceId), t = Store.getNode(c.targetId);
    if (!s || !t) return;
    var p1 = getPortPos(s, true), p2 = getPortPos(t, false);
    p1.x += EDGE_OFFSET; p1.y += EDGE_OFFSET; p2.x += EDGE_OFFSET; p2.y += EDGE_OFFSET;
    var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    var d = edgePathD(p1, p2);
    var hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d); hit.setAttribute("class", "edge-hit"); hit.dataset.edgeId = c.id;
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "edge-path" + (Store.selection.type === "edge" && Store.selection.id === c.id ? " selected" : ""));
    path.dataset.edgeId = c.id;
    var midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    var label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", midX); label.setAttribute("y", midY - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "edge-label");
    var lbl = (c.label ? c.label + " · " : "") + conditionSummary(c.condition, Store.hunt);
    label.textContent = lbl;
    // arrowhead
    var angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    var ax = p2.x - 9 * Math.cos(angle), ay = p2.y - 9 * Math.sin(angle);
    var arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    var a1 = [ax + 6 * Math.cos(angle + 2.5), ay + 6 * Math.sin(angle + 2.5)];
    var a2 = [ax + 6 * Math.cos(angle - 2.5), ay + 6 * Math.sin(angle - 2.5)];
    arrow.setAttribute("points", p2.x + "," + p2.y + " " + a1[0] + "," + a1[1] + " " + a2[0] + "," + a2[1]);
    arrow.setAttribute("class", "edge-arrow");
    g.appendChild(path); g.appendChild(arrow); g.appendChild(label); g.appendChild(hit);
    svg.appendChild(g);
  });
}

function renderValidationBadge(issues) {
  issues = issues || validateHunt(Store.hunt);
  var errCount = issues.filter(function (i) { return i.level === "error"; }).length;
  var badge = document.getElementById("warnBadge");
  badge.textContent = String(issues.length);
  badge.classList.toggle("zero", issues.length === 0);
  return issues;
}

function render() {
  renderNodes();
  renderEdges();
  renderPalette();
  renderHuntMeta();
  renderInspector();
  applyViewportTransform();
  updateUndoRedoButtons();
  dom.canvasHint.style.display = Store.hunt.nodes.length ? "none" : "block";
  document.getElementById("huntTitleInput").value = Store.hunt.title;
  if (document.getElementById("validationPanel").classList.contains("hidden") === false) renderValidationPanel();
  syncLiveMock();
}

function renderSelectionOnly() {
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el) {
    el.classList.toggle("selected", Store.multiSelectNodeIds.indexOf(el.dataset.nodeId) !== -1);
  });
  Array.prototype.forEach.call(dom.edgeLayer.querySelectorAll(".edge-path"), function (el) {
    el.classList.toggle("selected", Store.selection.type === "edge" && Store.selection.id === el.dataset.edgeId);
  });
}

function updateUndoRedoButtons() {
  document.getElementById("btnUndo").disabled = Store.history.length < 2;
  document.getElementById("btnRedo").disabled = Store.future.length === 0;
}

/* ---------------------------------------------------------------------
   Canvas interaction: pan, zoom, node drag, marquee select, connect
--------------------------------------------------------------------- */
var drag = null; // active drag/interaction descriptor

function setZoom(newZoom, pivotClientX, pivotClientY) {
  var rect = dom.canvasWrap.getBoundingClientRect();
  var px = pivotClientX !== undefined ? pivotClientX - rect.left : rect.width / 2;
  var py = pivotClientY !== undefined ? pivotClientY - rect.top : rect.height / 2;
  var worldX = (px - Store.view.x) / Store.view.zoom;
  var worldY = (py - Store.view.y) / Store.view.zoom;
  Store.view.zoom = clamp(newZoom, 0.25, 2);
  Store.view.x = px - worldX * Store.view.zoom;
  Store.view.y = py - worldY * Store.view.zoom;
  applyViewportTransform();
}

function initCanvasInteraction() {
  dom.canvasWrap.addEventListener("wheel", function (e) {
    e.preventDefault();
    var factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    setZoom(Store.view.zoom * factor, e.clientX, e.clientY);
  }, { passive: false });

  document.getElementById("btnZoomIn").onclick = function () { setZoom(Store.view.zoom * 1.2); };
  document.getElementById("btnZoomOut").onclick = function () { setZoom(Store.view.zoom / 1.2); };
  document.getElementById("btnZoomReset").onclick = function () { Store.view = { x: 40, y: 40, zoom: 1 }; applyViewportTransform(); };

  dom.canvasWrap.addEventListener("mousedown", function (e) {
    if (e.button !== 0) return;
    var nodeEl = e.target.closest(".node");
    var portEl = e.target.closest(".node-port");
    var edgeEl = e.target.closest(".edge-hit");
    var resizeHandleEl = e.target.closest(".node-resize-handle");

    if (resizeHandleEl && nodeEl) {
      var rId = nodeEl.dataset.nodeId;
      var rNode = Store.getNode(rId);
      if (!rNode) return;
      Store.select("node", rId);
      var rStartWorld = screenToWorld(e.clientX, e.clientY);
      drag = { kind: "resize", nodeId: rId, startWorld: rStartWorld, startSize: nodeSize(rNode), resized: false };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (portEl && portEl.classList.contains("out")) {
      var srcNode = nodeEl;
      var srcId = srcNode.dataset.nodeId;
      var startWorld = screenToWorld(e.clientX, e.clientY);
      drag = { kind: "connect", sourceId: srcId, cur: startWorld };
      renderTempEdge();
      e.preventDefault();
      return;
    }

    if (nodeEl) {
      var id = nodeEl.dataset.nodeId;
      if (e.shiftKey) {
        var idx = Store.multiSelectNodeIds.indexOf(id);
        if (idx === -1) Store.multiSelectNodeIds.push(id); else Store.multiSelectNodeIds.splice(idx, 1);
        Store.selection = { type: "node", id: id };
        renderSelectionOnly(); renderInspector(); syncLiveMockSelection();
      } else if (Store.multiSelectNodeIds.indexOf(id) === -1) {
        Store.select("node", id);
      }
      var world = screenToWorld(e.clientX, e.clientY);
      var starts = {};
      Store.multiSelectNodeIds.forEach(function (nid) {
        var n = Store.getNode(nid);
        if (n) starts[nid] = { x: n.position.x, y: n.position.y };
      });
      drag = { kind: "move", startWorld: world, starts: starts, moved: false };
      e.preventDefault();
      return;
    }

    if (edgeEl) {
      Store.select("edge", edgeEl.dataset.edgeId);
      renderEdges();
      return;
    }

    // empty canvas
    if (e.shiftKey) {
      var w = screenToWorld(e.clientX, e.clientY);
      drag = { kind: "marquee", startClient: { x: e.clientX, y: e.clientY }, startWorld: w };
      dom.marquee.classList.remove("hidden");
    } else {
      Store.clearSelection();
      drag = { kind: "pan", startClient: { x: e.clientX, y: e.clientY }, startView: { x: Store.view.x, y: Store.view.y } };
    }
  });

  window.addEventListener("mousemove", function (e) {
    if (!drag) return;
    if (drag.kind === "pan") {
      Store.view.x = drag.startView.x + (e.clientX - drag.startClient.x);
      Store.view.y = drag.startView.y + (e.clientY - drag.startClient.y);
      applyViewportTransform();
    } else if (drag.kind === "move") {
      var world = screenToWorld(e.clientX, e.clientY);
      var dx = world.x - drag.startWorld.x, dy = world.y - drag.startWorld.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      Object.keys(drag.starts).forEach(function (nid) {
        var n = Store.getNode(nid);
        if (!n) return;
        var nx = drag.starts[nid].x + dx, ny = drag.starts[nid].y + dy;
        if (Store.snapEnabled) { nx = snap(nx, GRID); ny = snap(ny, GRID); }
        n.position.x = nx; n.position.y = ny;
      });
      renderNodes(); renderEdges();
    } else if (drag.kind === "resize") {
      var n2 = Store.getNode(drag.nodeId);
      if (n2) {
        var world2 = screenToWorld(e.clientX, e.clientY);
        var dw = world2.x - drag.startWorld.x, dh = world2.y - drag.startWorld.y;
        if (Math.abs(dw) > 2 || Math.abs(dh) > 2) drag.resized = true;
        var nw = drag.startSize.w + dw, nh = drag.startSize.h + dh;
        if (Store.snapEnabled) { nw = snap(nw, GRID); nh = snap(nh, GRID); }
        nw = clamp(nw, NODE_MIN_W, NODE_MAX_W);
        nh = clamp(nh, NODE_MIN_H, NODE_MAX_H);
        n2.size = { w: nw, h: nh };
        renderNodes(); renderEdges();
      }
    } else if (drag.kind === "connect") {
      drag.cur = screenToWorld(e.clientX, e.clientY);
      renderTempEdge(e.target.closest(".node"));
    } else if (drag.kind === "marquee") {
      var w2 = screenToWorld(e.clientX, e.clientY);
      var rect = dom.canvasWrap.getBoundingClientRect();
      var x1 = Math.min(drag.startClient.x, e.clientX) - rect.left, x2 = Math.max(drag.startClient.x, e.clientX) - rect.left;
      var y1 = Math.min(drag.startClient.y, e.clientY) - rect.top, y2 = Math.max(drag.startClient.y, e.clientY) - rect.top;
      dom.marquee.style.left = x1 + "px"; dom.marquee.style.top = y1 + "px";
      dom.marquee.style.width = (x2 - x1) + "px"; dom.marquee.style.height = (y2 - y1) + "px";
      drag.curWorld = w2;
    }
  });

  window.addEventListener("mouseup", function (e) {
    if (!drag) return;
    if (drag.kind === "move") {
      if (drag.moved) Store.pushHistory();
    } else if (drag.kind === "resize") {
      if (drag.resized) Store.pushHistory();
    } else if (drag.kind === "connect") {
      var targetEl = e.target.closest(".node");
      clearTempEdge();
      if (targetEl) {
        var targetId = targetEl.dataset.nodeId;
        var c = Store.addConnection(drag.sourceId, targetId);
        if (c) { render(); Store.select("edge", c.id); }
      }
    } else if (drag.kind === "marquee") {
      dom.marquee.classList.add("hidden");
      var x1 = Math.min(drag.startWorld.x, drag.curWorld ? drag.curWorld.x : drag.startWorld.x);
      var x2 = Math.max(drag.startWorld.x, drag.curWorld ? drag.curWorld.x : drag.startWorld.x);
      var y1 = Math.min(drag.startWorld.y, drag.curWorld ? drag.curWorld.y : drag.startWorld.y);
      var y2 = Math.max(drag.startWorld.y, drag.curWorld ? drag.curWorld.y : drag.startWorld.y);
      var picked = Store.hunt.nodes.filter(function (n) {
        var sz = nodeSize(n);
        return n.position.x + sz.w >= x1 && n.position.x <= x2 && n.position.y + sz.h >= y1 && n.position.y <= y2;
      }).map(function (n) { return n.id; });
      if (picked.length) { Store.multiSelectNodeIds = picked; Store.selection = { type: "node", id: picked[0] }; }
      renderSelectionOnly(); renderInspector(); syncLiveMockSelection();
    }
    drag = null;
  });

  dom.canvasWrap.addEventListener("dblclick", function (e) {
    var handleEl = e.target.closest(".node-resize-handle");
    if (!handleEl) return;
    var nodeEl = e.target.closest(".node");
    var n = nodeEl && Store.getNode(nodeEl.dataset.nodeId);
    if (!n) return;
    n.size = { w: NODE_W, h: NODE_H };
    renderNodes(); renderEdges();
    Store.pushHistory();
    toast("Reset card to default size.");
  });

  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || e.target.isContentEditable) return;
    if ((e.key === "Delete" || e.key === "Backspace")) {
      if (Store.selection.type === "edge") { Store.removeConnection(Store.selection.id); Store.clearSelection(); render(); }
      else if (Store.multiSelectNodeIds.length) { Store.removeNodes(Store.multiSelectNodeIds); Store.clearSelection(); render(); }
      e.preventDefault();
    } else if (e.ctrlKey || e.metaKey) {
      if (e.key === "z" && !e.shiftKey) { Store.undo(); e.preventDefault(); }
      else if (e.key === "y" || (e.key === "z" && e.shiftKey)) { Store.redo(); e.preventDefault(); }
    }
  });
}

function renderTempEdge(hoverNodeEl) {
  clearTempEdge();
  var s = Store.getNode(drag.sourceId);
  if (!s) return;
  var p1 = getPortPos(s, true);
  var p2 = drag.cur;
  p1.x += EDGE_OFFSET; p1.y += EDGE_OFFSET; p2 = { x: p2.x + EDGE_OFFSET, y: p2.y + EDGE_OFFSET };
  var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", edgePathD(p1, p2));
  path.setAttribute("class", "edge-path temp");
  path.id = "tempEdge";
  dom.edgeLayer.appendChild(path);
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el) { el.style.outline = ""; });
  if (hoverNodeEl) hoverNodeEl.style.outline = "2px solid var(--accent2)";
}
function clearTempEdge() {
  var el = document.getElementById("tempEdge");
  if (el) el.remove();
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el2) { el2.style.outline = ""; });
}

/* ---------------------------------------------------------------------
   Palette — drag new nodes onto canvas
--------------------------------------------------------------------- */
function renderPalette() {
  var list = document.getElementById("paletteList");
  if (list.dataset.built) return; // static, build once
  list.dataset.built = "1";
  var order = ["scene","choice","answerEntry","ordering","matching","awardItem","setVariable","score","branch","convergence","ending","hint","locationPlaceholder"];
  order.forEach(function (type) {
    var def = NODE_TYPES[type];
    var item = document.createElement("div");
    item.className = "palette-item";
    item.draggable = true;
    item.dataset.type = type;
    item.innerHTML = '<span class="fam-dot fam-' + def.family + '"></span><span>' + def.icon + " " + esc(def.label) + "</span>";
    item.addEventListener("dragstart", function (e) {
      e.dataTransfer.setData("text/plain", type);
      e.dataTransfer.effectAllowed = "copy";
    });
    list.appendChild(item);
  });
}

function initPaletteDrop() {
  dom.canvasWrap.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  dom.canvasWrap.addEventListener("drop", function (e) {
    e.preventDefault();
    var type = e.dataTransfer.getData("text/plain");
    if (!NODE_TYPES[type]) return;
    var world = screenToWorld(e.clientX, e.clientY);
    var x = Store.snapEnabled ? snap(world.x - NODE_W / 2, GRID) : world.x - NODE_W / 2;
    var y = Store.snapEnabled ? snap(world.y - NODE_H / 2, GRID) : world.y - NODE_H / 2;
    var n = Store.addNode(type, x, y);
    render();
    Store.select("node", n.id);
  });
}

/* ---------------------------------------------------------------------
   Hunt meta panel (left palette, bottom section): title/concept/audience,
   entry point, variables, items declarations
--------------------------------------------------------------------- */
function renderHuntMeta() {
  var box = document.getElementById("huntMeta");
  var h = Store.hunt;
  var entrySelect = '<select id="metaEntrySelect" multiple size="' + Math.min(4, Math.max(2, h.nodes.length)) + '">' +
    h.nodes.map(function (n) {
      return '<option value="' + n.id + '"' + (h.entryPointIds.indexOf(n.id) !== -1 ? " selected" : "") + '>' + esc(n.title) + '</option>';
    }).join("") + '</select>';

  var currentPackId = (h.stylePack && h.stylePack.id) || DEFAULT_STYLE_PACK_ID;
  var optionHtml = function (id) { return '<option value="' + id + '"' + (id === currentPackId ? " selected" : "") + '>' + esc(STYLE_PACKS[id].name) + '</option>'; };
  var allPackIds = Object.keys(STYLE_PACKS);
  var builtinIds = allPackIds.filter(function (id) { return BUILTIN_STYLE_PACK_IDS.indexOf(id) !== -1; });
  var otherIds = allPackIds.filter(function (id) { return BUILTIN_STYLE_PACK_IDS.indexOf(id) === -1; });
  var packSelect = '<select id="metaStylePack">' +
    '<optgroup label="Built-in">' + builtinIds.map(optionHtml).join("") + '</optgroup>' +
    (otherIds.length ? '<optgroup label="My Styles">' + otherIds.map(optionHtml).join("") + '</optgroup>' : "") +
    '</select>';
  var currentPackDesc = (h.stylePack && h.stylePack.description) || STYLE_PACKS[DEFAULT_STYLE_PACK_ID].description;

  box.innerHTML =
    '<label>Concept</label><textarea id="metaConcept">' + esc(h.metadata.concept) + '</textarea>' +
    '<label>Audience</label><input id="metaAudience" type="text" value="' + esc(h.metadata.audience) + '" />' +
    '<label>Entry point(s)</label>' + entrySelect +
    '<div class="section-title" style="margin-top:14px">Style Pack</div>' +
    '<label>Sets fonts, colours, imagery treatment and vibe for Preview / Play</label>' + packSelect +
    '<p id="metaStylePackDesc" style="font-size:11px;color:var(--text-dim);margin:6px 0 8px">' + esc(currentPackDesc) + '</p>' +
    '<button class="small-btn" id="btnOpenStyleBuilder">🎨 Craft a style…</button>' +
    '<button class="small-btn" id="btnImportStylePack">⬆ Import Style Pack…</button>' +
    '<input type="file" id="styleImportInput" accept="application/json" style="display:none" />' +
    '<div class="section-title">Variables</div>' +
    '<div id="varList"></div>' +
    '<button class="small-btn" id="btnAddVar">+ Add variable</button>' +
    '<div class="section-title">Items</div>' +
    '<div id="itemList"></div>' +
    '<button class="small-btn" id="btnAddItem">+ Add item</button>';

  document.getElementById("metaConcept").oninput = function (e) { h.metadata.concept = e.target.value; };
  document.getElementById("metaConcept").onblur = function () { Store.pushHistory(); };
  document.getElementById("metaAudience").oninput = function (e) { h.metadata.audience = e.target.value; };
  document.getElementById("metaAudience").onblur = function () { Store.pushHistory(); };
  document.getElementById("metaEntrySelect").onchange = function (e) {
    h.entryPointIds = Array.prototype.filter.call(e.target.options, function (o) { return o.selected; }).map(function (o) { return o.value; });
    Store.pushHistory(); renderNodes(); renderEdges();
  };
  document.getElementById("metaStylePack").onchange = function (e) {
    h.stylePack = getStylePack(e.target.value);
    Store.pushHistory();
    document.getElementById("metaStylePackDesc").textContent = h.stylePack.description || "";
    applyStylePack(h.stylePack); // keeps both the Preview overlay and the docked mock panel in sync
    toast("Style pack set to \"" + h.stylePack.name + "\".");
  };
  document.getElementById("btnImportStylePack").onclick = function () { document.getElementById("styleImportInput").click(); };
  document.getElementById("styleImportInput").onchange = function (e) {
    if (e.target.files[0]) importStylePackFile(e.target.files[0]);
    e.target.value = "";
  };
  document.getElementById("btnOpenStyleBuilder").onclick = function () {
    // Craft/edit styles live in the Library's own Style Library section, not inline in the hunt —
    // the hunt is auto-saved first so nothing is lost, matching the "back to library" pattern.
    if (Store.hunt && Store.hunt.id) saveCurrentHuntToLibrary(true);
    goToStyleLibrary();
  };

  var varList = document.getElementById("varList");
  h.variables.forEach(function (v) {
    var row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = '<input type="text" value="' + esc(v.name) + '" data-vid="' + v.id + '" class="varNameInput" />' +
      '<select data-vid="' + v.id + '" class="varTypeSelect">' +
        ["number","string","boolean"].map(function (t) { return '<option value="' + t + '"' + (v.type === t ? " selected" : "") + '>' + t + '</option>'; }).join("") +
      '</select><button class="small-btn" data-vid="' + v.id + '">✕</button>';
    varList.appendChild(row);
    row.querySelector(".varNameInput").oninput = function (e) { v.name = e.target.value; };
    row.querySelector(".varNameInput").onblur = function () { Store.pushHistory(); renderEdges(); };
    row.querySelector(".varTypeSelect").onchange = function (e) { v.type = e.target.value; Store.pushHistory(); };
    row.querySelector("button").onclick = function () {
      h.variables = h.variables.filter(function (x) { return x.id !== v.id; });
      Store.pushHistory(); render();
    };
  });
  document.getElementById("btnAddVar").onclick = function () {
    h.variables.push({ id: uid("var"), name: "newVariable", type: "number", initial: 0 });
    Store.pushHistory(); render();
  };

  var itemList = document.getElementById("itemList");
  h.items.forEach(function (it) {
    var row = document.createElement("div");
    row.className = "list-item";
    row.innerHTML = '<input type="text" value="' + esc(it.name) + '" class="itemNameInput" /><button class="small-btn">✕</button>';
    itemList.appendChild(row);
    row.querySelector(".itemNameInput").oninput = function (e) { it.name = e.target.value; };
    row.querySelector(".itemNameInput").onblur = function () { Store.pushHistory(); renderEdges(); };
    row.querySelector("button").onclick = function () {
      h.items = h.items.filter(function (x) { return x.id !== it.id; });
      Store.pushHistory(); render();
    };
  });
  document.getElementById("btnAddItem").onclick = function () {
    h.items.push({ id: uid("item"), name: "New Item", description: "" });
    Store.pushHistory(); render();
  };
}

/* ---------------------------------------------------------------------
   Inspector — node content editor / edge rule (condition) editor
--------------------------------------------------------------------- */
function fieldWrap(labelText, innerHtml) {
  return '<div class="field"><label>' + esc(labelText) + '</label>' + innerHtml + '</div>';
}
function selectOptions(list, valueKey, labelKey, current, placeholder) {
  var html = placeholder ? '<option value="">' + esc(placeholder) + '</option>' : "";
  html += list.map(function (item) {
    return '<option value="' + esc(item[valueKey]) + '"' + (item[valueKey] === current ? " selected" : "") + '>' + esc(item[labelKey]) + '</option>';
  }).join("");
  return html;
}

function afterEdit(refreshNodesEdges) {
  Store.pushHistory();
  if (refreshNodesEdges !== false) { renderNodes(); renderEdges(); }
  syncLiveMock();
}

function renderInspector() {
  var body = document.getElementById("inspectorBody");
  var title = document.getElementById("inspectorTitle");
  var sel = Store.selection;

  if (sel.type === "node" && Store.multiSelectNodeIds.length <= 1) {
    var n = Store.getNode(sel.id);
    if (!n) { title.textContent = "Nothing selected"; body.innerHTML = ""; return; }
    title.textContent = NODE_TYPES[n.type].icon + " " + NODE_TYPES[n.type].label;
    body.innerHTML = buildNodeInspector(n);
    wireNodeInspector(n);
    return;
  }
  if (sel.type === "node" && Store.multiSelectNodeIds.length > 1) {
    title.textContent = Store.multiSelectNodeIds.length + " nodes selected";
    body.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px">Multiple nodes selected. Drag to move together, or press Delete to remove them all.</p>';
    return;
  }
  if (sel.type === "edge") {
    var c = Store.getConnection(sel.id);
    if (!c) { title.textContent = "Nothing selected"; body.innerHTML = ""; return; }
    title.textContent = "🔀 Connection Rule";
    body.innerHTML = buildEdgeInspector(c);
    wireEdgeInspector(c);
    return;
  }
  title.textContent = "Nothing selected";
  body.innerHTML = '<p style="color:var(--text-dim);font-size:12.5px">Select a node to edit its content, or a connection to edit its rule.<br><br>Hunt-level settings (title, concept, audience, entry point, variables, items) are in the left panel.</p>';
}

function buildNodeInspector(n) {
  var html = '<div class="section-title">Basics</div>';
  html += fieldWrap("Title", '<input type="text" id="fTitle" value="' + esc(n.title) + '" />');
  html += buildTypeSpecificFields(n);
  html += '<div class="section-title">Effects (applied when node completes)</div>';
  html += buildEffectsEditor(n);
  html += '<div class="section-title">Creator-only notes (never shown to player)</div>';
  html += '<div class="creator-note-box">' + fieldWrap("Notes / solution reasoning", '<textarea id="fNotes">' + esc(n.creatorNotes) + '</textarea>') + '</div>';
  return html;
}

function buildTypeSpecificFields(n) {
  var c = n.content, hunt = Store.hunt, html = '<div class="section-title">Content</div>';
  switch (n.type) {
    case "scene":
      html += fieldWrap("Body text (player-visible)", '<textarea id="fBody">' + esc(c.body) + '</textarea>');
      break;
    case "choice":
      html += fieldWrap("Prompt text", '<textarea id="fBody">' + esc(c.body) + '</textarea>');
      html += '<div class="field"><label>Options</label><div id="optList">' +
        c.options.map(function (o, i) {
          return '<div class="list-item"><input type="text" value="' + esc(o.label) + '" data-oid="' + o.id + '" class="optLabelInput" /><button class="small-btn" data-oid="' + o.id + '">✕</button></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddOption">+ Add option</button></div>';
      html += '<p style="font-size:11px;color:var(--text-dim)">Connect a rule from this node with condition "choice option selected" to route based on the player\'s pick.</p>';
      break;
    case "answerEntry":
      html += fieldWrap("Prompt (player-visible)", '<textarea id="fPrompt">' + esc(c.prompt) + '</textarea>');
      html += '<div class="field"><label>Accepted answers</label><div id="ansList">' +
        (c.acceptedAnswers || []).map(function (a, i) {
          return '<div class="list-item"><input type="text" value="' + esc(a) + '" data-idx="' + i + '" class="ansInput" /><button class="small-btn" data-idx="' + i + '">✕</button></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddAnswer">+ Add accepted variant</button></div>';
      html += fieldWrap("Case sensitive?", '<select id="fCaseSensitive"><option value="0"' + (!c.caseSensitive ? " selected" : "") + '>No</option><option value="1"' + (c.caseSensitive ? " selected" : "") + '>Yes</option></select>');
      break;
    case "ordering":
      html += fieldWrap("Prompt", '<textarea id="fPrompt">' + esc(c.prompt) + '</textarea>');
      html += '<div class="field"><label>Items (edit labels)</label><div id="itemsEditList">' +
        c.items.map(function (it) {
          return '<div class="list-item"><input type="text" value="' + esc(it.label) + '" data-iid="' + it.id + '" class="itLabelInput" /></div>';
        }).join("") + '</div></div>';
      html += '<div class="field"><label>Correct order (top = first)</label><div id="correctOrderList">' +
        c.correctOrder.map(function (id, idx) {
          var it = c.items.find(function (x) { return x.id === id; });
          return '<div class="list-item" data-idx="' + idx + '"><span class="chip">' + (idx + 1) + '</span><span style="flex:1">' + esc(it ? it.label : "?") + '</span>' +
            '<button class="small-btn ordUp">↑</button><button class="small-btn ordDown">↓</button></div>';
        }).join("") + '</div></div>';
      break;
    case "matching":
      html += fieldWrap("Prompt", '<textarea id="fPrompt">' + esc(c.prompt) + '</textarea>');
      html += '<div class="field"><label>Left items</label>' + c.left.map(function (it) {
        return '<div class="list-item"><input type="text" value="' + esc(it.label) + '" data-lid="' + it.id + '" class="leftLabelInput" /></div>';
      }).join("") + '</div>';
      html += '<div class="field"><label>Right items</label>' + c.right.map(function (it) {
        return '<div class="list-item"><input type="text" value="' + esc(it.label) + '" data-rid="' + it.id + '" class="rightLabelInput" /></div>';
      }).join("") + '</div>';
      html += '<div class="field"><label>Correct pairs</label>' + c.left.map(function (it) {
        var curPair = c.correctPairs.find(function (p) { return p[0] === it.id; });
        return '<div class="list-item"><span style="flex:1">' + esc(it.label) + ' →</span><select class="pairSelect" data-lid="' + it.id + '">' +
          c.right.map(function (r) { return '<option value="' + r.id + '"' + (curPair && curPair[1] === r.id ? " selected" : "") + '>' + esc(r.label) + '</option>'; }).join("") +
          '</select></div>';
      }).join("") + '</div>';
      break;
    case "awardItem":
      html += fieldWrap("Item to award", '<select id="fItemId">' + selectOptions(hunt.items, "id", "name", c.itemId, "— choose item —") + '</select>');
      break;
    case "setVariable":
      html += fieldWrap("Variable", '<select id="fVarId">' + selectOptions(hunt.variables, "id", "name", c.variableId, "— choose variable —") + '</select>');
      html += fieldWrap("Operation", '<select id="fOp"><option value="set"' + (c.operation === "set" ? " selected" : "") + '>Set to</option><option value="increment"' + (c.operation === "increment" ? " selected" : "") + '>Increment by</option><option value="decrement"' + (c.operation === "decrement" ? " selected" : "") + '>Decrement by</option></select>');
      html += fieldWrap("Value", '<input type="text" id="fValue" value="' + esc(c.value) + '" />');
      break;
    case "score":
      html += fieldWrap("Score delta", '<input type="number" id="fDelta" value="' + c.delta + '" />');
      break;
    case "branch":
      html += '<p style="font-size:12px;color:var(--text-dim)">No content fields. Add outgoing connections below with conditions and priorities — the first connection (in priority order) whose condition is satisfied is taken.</p>';
      break;
    case "convergence":
      html += fieldWrap("Requirement", '<select id="fReqMode"><option value="all"' + (c.requiredMode === "all" ? " selected" : "") + '>ALL incoming branches</option><option value="any"' + (c.requiredMode === "any" ? " selected" : "") + '>ANY N of incoming branches</option></select>');
      if (c.requiredMode === "any") html += fieldWrap("N required", '<input type="number" id="fReqCount" min="1" value="' + c.requiredCount + '" />');
      break;
    case "ending":
      html += fieldWrap("Result name", '<input type="text" id="fResultName" value="' + esc(c.resultName) + '" />');
      html += fieldWrap("Ending text (player-visible)", '<textarea id="fBody">' + esc(c.body) + '</textarea>');
      break;
    case "hint":
      var puzzleNodes = hunt.nodes.filter(function (x) { return familyOf(x.type) === "puzzle"; });
      html += fieldWrap("Attached to puzzle node", '<select id="fForNodeId">' + selectOptions(puzzleNodes, "id", "title", c.forNodeId, "— choose puzzle —") + '</select>');
      html += '<div class="field"><label>Progressive stages (revealed in order)</label><div id="hintStages">' +
        c.stages.map(function (s, idx) {
          return '<div class="hint-block"><span class="hint-badge">STAGE ' + (idx + 1) + '</span><textarea data-hid="' + s.id + '" class="hintStageInput" style="margin-top:6px">' + esc(s.text) + '</textarea><div style="text-align:right;margin-top:4px"><button class="small-btn" data-hid="' + s.id + '">Remove stage</button></div></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddHintStage">+ Add stage</button></div>';
      break;
    case "locationPlaceholder":
      html += '<p style="font-size:12px;color:var(--text-dim)">' + esc(c.placeholderNote) + '</p>';
      break;
  }
  return html;
}

function buildEffectsEditor(n) {
  var hunt = Store.hunt;
  var html = '<div id="effectsList">';
  (n.effects || []).forEach(function (e, idx) {
    html += '<div class="hint-block" data-eidx="' + idx + '">';
    html += '<select class="effTypeSelect" data-eidx="' + idx + '">' +
      Object.keys(EFFECT_TYPES).map(function (t) { return '<option value="' + t + '"' + (e.type === t ? " selected" : "") + '>' + EFFECT_TYPES[t].label + '</option>'; }).join("") + '</select>';
    if (e.type === "awardItem") {
      html += '<select class="effItemSelect" data-eidx="' + idx + '" style="margin-top:6px">' + selectOptions(hunt.items, "id", "name", e.itemId, "— item —") + '</select>';
    } else if (e.type === "setVariable") {
      html += '<div class="field-row" style="margin-top:6px">' +
        '<select class="effVarSelect" data-eidx="' + idx + '">' + selectOptions(hunt.variables, "id", "name", e.variableId, "— variable —") + '</select>' +
        '<select class="effOpSelect" data-eidx="' + idx + '"><option value="set"' + (e.operation === "set" ? " selected" : "") + '>Set</option><option value="increment"' + (e.operation === "increment" ? " selected" : "") + '>+=</option><option value="decrement"' + (e.operation === "decrement" ? " selected" : "") + '>-=</option></select>' +
        '<input type="text" class="effValueInput" data-eidx="' + idx + '" value="' + esc(e.value) + '" /></div>';
    } else if (e.type === "addScore") {
      html += '<input type="number" class="effDeltaInput" data-eidx="' + idx + '" value="' + (e.delta || 0) + '" style="margin-top:6px" />';
    }
    html += '<div style="text-align:right;margin-top:6px"><button class="small-btn effRemoveBtn" data-eidx="' + idx + '">Remove effect</button></div>';
    html += '</div>';
  });
  html += '</div><button class="small-btn" id="btnAddEffect">+ Add effect</button>';
  return html;
}

function wireNodeInspector(n) {
  var byId = function (id) { return document.getElementById(id); };
  if (byId("fTitle")) {
    byId("fTitle").oninput = function (e) { n.title = e.target.value; renderNodes(); };
    byId("fTitle").onblur = function () { afterEdit(false); };
  }
  var c = n.content;

  function bindText(elId, prop, onCommit) {
    var el = byId(elId); if (!el) return;
    el.oninput = function (e) { c[prop] = e.target.value; if (onCommit) onCommit(); };
    el.onblur = function () { afterEdit(); };
  }
  function bindChange(elId, fn) {
    var el = byId(elId); if (!el) return;
    el.onchange = function (e) { fn(e.target.value); afterEdit(); };
  }

  switch (n.type) {
    case "scene": case "ending":
      bindText("fBody", "body");
      if (n.type === "ending") bindText("fResultName", "resultName");
      break;
    case "choice":
      bindText("fBody", "body");
      Array.prototype.forEach.call(document.querySelectorAll(".optLabelInput"), function (inp) {
        inp.oninput = function (e) {
          var o = c.options.find(function (x) { return x.id === inp.dataset.oid; });
          if (o) o.label = e.target.value;
        };
        inp.onblur = function () { afterEdit(); };
      });
      Array.prototype.forEach.call(document.querySelectorAll("#optList button"), function (btn) {
        btn.onclick = function () { c.options = c.options.filter(function (o) { return o.id !== btn.dataset.oid; }); afterEdit(); renderInspector(); };
      });
      if (byId("btnAddOption")) byId("btnAddOption").onclick = function () {
        c.options.push({ id: uid("opt"), label: "New option" }); afterEdit(); renderInspector();
      };
      break;
    case "answerEntry":
      bindText("fPrompt", "prompt");
      Array.prototype.forEach.call(document.querySelectorAll(".ansInput"), function (inp) {
        inp.oninput = function (e) { c.acceptedAnswers[+inp.dataset.idx] = e.target.value; };
        inp.onblur = function () { afterEdit(false); };
      });
      Array.prototype.forEach.call(document.querySelectorAll("#ansList button"), function (btn) {
        btn.onclick = function () { c.acceptedAnswers.splice(+btn.dataset.idx, 1); afterEdit(false); renderInspector(); };
      });
      if (byId("btnAddAnswer")) byId("btnAddAnswer").onclick = function () { c.acceptedAnswers.push("new answer"); afterEdit(false); renderInspector(); };
      bindChange("fCaseSensitive", function (v) { c.caseSensitive = v === "1"; });
      break;
    case "ordering":
      bindText("fPrompt", "prompt");
      Array.prototype.forEach.call(document.querySelectorAll(".itLabelInput"), function (inp) {
        inp.oninput = function (e) {
          var it = c.items.find(function (x) { return x.id === inp.dataset.iid; });
          if (it) it.label = e.target.value;
        };
        inp.onblur = function () { afterEdit(false); renderInspector(); };
      });
      Array.prototype.forEach.call(document.querySelectorAll(".ordUp"), function (btn) {
        btn.onclick = function () {
          var row = btn.closest(".list-item"); var idx = +row.dataset.idx;
          if (idx > 0) { var t = c.correctOrder[idx - 1]; c.correctOrder[idx - 1] = c.correctOrder[idx]; c.correctOrder[idx] = t; afterEdit(false); renderInspector(); }
        };
      });
      Array.prototype.forEach.call(document.querySelectorAll(".ordDown"), function (btn) {
        btn.onclick = function () {
          var row = btn.closest(".list-item"); var idx = +row.dataset.idx;
          if (idx < c.correctOrder.length - 1) { var t = c.correctOrder[idx + 1]; c.correctOrder[idx + 1] = c.correctOrder[idx]; c.correctOrder[idx] = t; afterEdit(false); renderInspector(); }
        };
      });
      break;
    case "matching":
      bindText("fPrompt", "prompt");
      Array.prototype.forEach.call(document.querySelectorAll(".leftLabelInput"), function (inp) {
        inp.oninput = function (e) { var it = c.left.find(function (x) { return x.id === inp.dataset.lid; }); if (it) it.label = e.target.value; };
        inp.onblur = function () { afterEdit(false); renderInspector(); };
      });
      Array.prototype.forEach.call(document.querySelectorAll(".rightLabelInput"), function (inp) {
        inp.oninput = function (e) { var it = c.right.find(function (x) { return x.id === inp.dataset.rid; }); if (it) it.label = e.target.value; };
        inp.onblur = function () { afterEdit(false); renderInspector(); };
      });
      Array.prototype.forEach.call(document.querySelectorAll(".pairSelect"), function (sel) {
        sel.onchange = function (e) {
          var lid = sel.dataset.lid;
          c.correctPairs = c.correctPairs.filter(function (p) { return p[0] !== lid; });
          c.correctPairs.push([lid, e.target.value]);
          afterEdit(false);
        };
      });
      break;
    case "awardItem":
      bindChange("fItemId", function (v) { c.itemId = v; });
      break;
    case "setVariable":
      bindChange("fVarId", function (v) { c.variableId = v; });
      bindChange("fOp", function (v) { c.operation = v; });
      bindText("fValue", "value");
      break;
    case "score":
      var fd = byId("fDelta");
      if (fd) { fd.oninput = function (e) { c.delta = Number(e.target.value); }; fd.onblur = function () { afterEdit(false); }; }
      break;
    case "convergence":
      bindChange("fReqMode", function (v) { c.requiredMode = v; });
      if (byId("fReqCount")) { byId("fReqCount").oninput = function (e) { c.requiredCount = Number(e.target.value); }; byId("fReqCount").onblur = function () { afterEdit(false); renderInspector(); }; }
      if (byId("fReqMode")) byId("fReqMode").onchange = function (e) { c.requiredMode = e.target.value; afterEdit(false); renderInspector(); };
      break;
    case "hint":
      bindChange("fForNodeId", function (v) { c.forNodeId = v; });
      Array.prototype.forEach.call(document.querySelectorAll(".hintStageInput"), function (ta) {
        ta.oninput = function (e) { var s = c.stages.find(function (x) { return x.id === ta.dataset.hid; }); if (s) s.text = e.target.value; };
        ta.onblur = function () { afterEdit(false); };
      });
      Array.prototype.forEach.call(document.querySelectorAll("#hintStages button"), function (btn) {
        btn.onclick = function () { c.stages = c.stages.filter(function (s) { return s.id !== btn.dataset.hid; }); afterEdit(false); renderInspector(); };
      });
      if (byId("btnAddHintStage")) byId("btnAddHintStage").onclick = function () { c.stages.push({ id: uid("hs"), text: "Another hint stage." }); afterEdit(false); renderInspector(); };
      break;
  }

  // effects editor (shared across all node types)
  Array.prototype.forEach.call(document.querySelectorAll(".effTypeSelect"), function (sel) {
    sel.onchange = function (e) {
      var idx = +sel.dataset.eidx; var t = e.target.value;
      n.effects[idx] = t === "awardItem" ? { type: t, itemId: "" } : t === "setVariable" ? { type: t, variableId: "", operation: "set", value: "1" } : { type: t, delta: 1 };
      afterEdit(false); renderInspector();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll(".effItemSelect"), function (sel) { sel.onchange = function (e) { n.effects[+sel.dataset.eidx].itemId = e.target.value; afterEdit(false); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".effVarSelect"), function (sel) { sel.onchange = function (e) { n.effects[+sel.dataset.eidx].variableId = e.target.value; afterEdit(false); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".effOpSelect"), function (sel) { sel.onchange = function (e) { n.effects[+sel.dataset.eidx].operation = e.target.value; afterEdit(false); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".effValueInput"), function (inp) { inp.oninput = function (e) { n.effects[+inp.dataset.eidx].value = e.target.value; }; inp.onblur = function () { afterEdit(false); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".effDeltaInput"), function (inp) { inp.oninput = function (e) { n.effects[+inp.dataset.eidx].delta = Number(e.target.value); }; inp.onblur = function () { afterEdit(false); }; });
  Array.prototype.forEach.call(document.querySelectorAll(".effRemoveBtn"), function (btn) { btn.onclick = function () { n.effects.splice(+btn.dataset.eidx, 1); afterEdit(false); renderInspector(); }; });
  if (byId("btnAddEffect")) byId("btnAddEffect").onclick = function () { n.effects.push({ type: "awardItem", itemId: "" }); afterEdit(false); renderInspector(); };

  if (byId("fNotes")) {
    byId("fNotes").oninput = function (e) { n.creatorNotes = e.target.value; };
    byId("fNotes").onblur = function () { afterEdit(false); };
  }
}

function buildEdgeInspector(c) {
  var hunt = Store.hunt;
  var s = Store.getNode(c.sourceId), t = Store.getNode(c.targetId);
  var html = '<div class="section-title">Route</div>';
  html += '<p style="font-size:12px;color:var(--text-dim)">' + esc(s ? s.title : "?") + " → " + esc(t ? t.title : "?") + '</p>';
  html += fieldWrap("Label (optional, for your own reference)", '<input type="text" id="fLabel" value="' + esc(c.label) + '" />');
  html += fieldWrap("Priority (lower = evaluated first)", '<input type="number" id="fPriority" value="' + c.priority + '" />');

  html += '<div class="section-title">Condition — when does this connection open?</div>';
  html += fieldWrap("Condition type", '<select id="fCondType">' +
    Object.keys(CONDITION_TYPES).map(function (k) { return '<option value="' + k + '"' + (c.condition.type === k ? " selected" : "") + '>' + CONDITION_TYPES[k].label + '</option>'; }).join("") +
    '</select>');

  var cond = c.condition, allNodes = hunt.nodes;
  if (cond.type === "nodeComplete") {
    html += fieldWrap("Node", '<select id="fCondNode">' + selectOptions(allNodes, "id", "title", cond.nodeId, "— choose node —") + '</select>');
  } else if (cond.type === "allComplete" || cond.type === "anyNComplete") {
    html += '<div class="field"><label>Nodes (check all that apply)</label>' +
      allNodes.map(function (nd) {
        var checked = (cond.nodeIds || []).indexOf(nd.id) !== -1;
        return '<div class="list-item"><label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" class="condNodeChk" value="' + nd.id + '"' + (checked ? " checked" : "") + ' /> ' + esc(nd.title) + '</label></div>';
      }).join("") + '</div>';
    if (cond.type === "anyNComplete") html += fieldWrap("N required", '<input type="number" id="fCondN" min="1" value="' + (cond.n || 1) + '" />');
  } else if (cond.type === "choiceSelected") {
    var choiceNodes = allNodes.filter(function (nd) { return nd.type === "choice"; });
    html += fieldWrap("Choice node", '<select id="fCondNode">' + selectOptions(choiceNodes, "id", "title", cond.nodeId, "— choose choice node —") + '</select>');
    var chosen = choiceNodes.find(function (nd) { return nd.id === cond.nodeId; });
    var opts = chosen ? chosen.content.options : [];
    html += fieldWrap("Option", '<select id="fCondOption">' + selectOptions(opts, "id", "label", cond.optionId, "— choose option —") + '</select>');
  } else if (cond.type === "variableEquals" || cond.type === "variableAtLeast") {
    html += fieldWrap("Variable", '<select id="fCondVar">' + selectOptions(hunt.variables, "id", "name", cond.variableId, "— choose variable —") + '</select>');
    html += fieldWrap("Value", '<input type="text" id="fCondValue" value="' + esc(cond.value !== undefined ? cond.value : "") + '" />');
  } else if (cond.type === "itemHeld") {
    html += fieldWrap("Item", '<select id="fCondItem">' + selectOptions(hunt.items, "id", "name", cond.itemId, "— choose item —") + '</select>');
  } else {
    html += '<p style="font-size:12px;color:var(--text-dim)">This connection is always open once its source node is reachable.</p>';
  }
  html += '<div class="section-title"></div><button class="small-btn" id="btnDeleteEdge" style="color:var(--danger)">Delete this connection</button>';
  return html;
}

function wireEdgeInspector(c) {
  var byId = function (id) { return document.getElementById(id); };
  byId("fLabel").oninput = function (e) { c.label = e.target.value; renderEdges(); };
  byId("fLabel").onblur = function () { afterEdit(false); };
  byId("fPriority").oninput = function (e) { c.priority = Number(e.target.value); };
  byId("fPriority").onblur = function () { afterEdit(false); };

  byId("fCondType").onchange = function (e) {
    var t = e.target.value;
    if (t === "always") c.condition = { type: t };
    else if (t === "nodeComplete") c.condition = { type: t, nodeId: "" };
    else if (t === "allComplete") c.condition = { type: t, nodeIds: [] };
    else if (t === "anyNComplete") c.condition = { type: t, nodeIds: [], n: 1 };
    else if (t === "choiceSelected") c.condition = { type: t, nodeId: "", optionId: "" };
    else if (t === "variableEquals" || t === "variableAtLeast") c.condition = { type: t, variableId: "", value: "" };
    else if (t === "itemHeld") c.condition = { type: t, itemId: "" };
    afterEdit();
    renderInspector();
  };

  if (byId("fCondNode")) byId("fCondNode").onchange = function (e) { c.condition.nodeId = e.target.value; afterEdit(); if (c.condition.type === "choiceSelected") renderInspector(); };
  if (byId("fCondOption")) byId("fCondOption").onchange = function (e) { c.condition.optionId = e.target.value; afterEdit(); };
  if (byId("fCondN")) { byId("fCondN").oninput = function (e) { c.condition.n = Number(e.target.value); }; byId("fCondN").onblur = function () { afterEdit(); }; }
  Array.prototype.forEach.call(document.querySelectorAll(".condNodeChk"), function (chk) {
    chk.onchange = function () {
      var ids = Array.prototype.filter.call(document.querySelectorAll(".condNodeChk"), function (x) { return x.checked; }).map(function (x) { return x.value; });
      c.condition.nodeIds = ids;
      afterEdit();
    };
  });
  if (byId("fCondVar")) byId("fCondVar").onchange = function (e) { c.condition.variableId = e.target.value; afterEdit(); };
  if (byId("fCondValue")) { byId("fCondValue").oninput = function (e) { c.condition.value = e.target.value; }; byId("fCondValue").onblur = function () { afterEdit(); }; }
  if (byId("fCondItem")) byId("fCondItem").onchange = function (e) { c.condition.itemId = e.target.value; afterEdit(); };

  byId("btnDeleteEdge").onclick = function () { Store.removeConnection(c.id); Store.clearSelection(); render(); };
}

/* ---------------------------------------------------------------------
   Validation panel (drawer)
--------------------------------------------------------------------- */
function renderValidationPanel() {
  var issues = validateHunt(Store.hunt);
  renderValidationBadge(issues);
  var list = document.getElementById("validationList");
  if (!issues.length) { list.innerHTML = '<div class="warn-empty">✓ No structural issues detected.</div>'; return; }
  list.innerHTML = issues.map(function (i, idx) {
    return '<div class="warn-item ' + i.level + '" data-idx="' + idx + '"><span class="warn-icon">' + (i.level === "error" ? "⛔" : "⚠") + '</span>' +
      '<div><div class="warn-title">' + esc(i.title) + '</div><div class="warn-detail">' + esc(i.detail) + '</div></div></div>';
  }).join("");
  Array.prototype.forEach.call(list.children, function (el, idx) {
    el.onclick = function () {
      var i = issues[idx];
      if (i.nodeId) { Store.select("node", i.nodeId); focusOnNode(i.nodeId); }
      else if (i.connectionId) { Store.select("edge", i.connectionId); renderEdges(); }
    };
  });
}

function focusOnNode(nodeId) {
  var n = Store.getNode(nodeId);
  if (!n) return;
  var sz = nodeSize(n);
  var rect = dom.canvasWrap.getBoundingClientRect();
  Store.view.x = rect.width / 2 - (n.position.x + sz.w / 2) * Store.view.zoom;
  Store.view.y = rect.height / 2 - (n.position.y + sz.h / 2) * Store.view.zoom;
  applyViewportTransform();
  renderNodes(); renderEdges();
}

/* ---------------------------------------------------------------------
   Hunt library (multi-project localStorage) + per-hunt Save + Export / Import
--------------------------------------------------------------------- */
var LEGACY_STORAGE_KEY = "puzzleatlas_studio_hunt_v0"; // Phase 1 single-slot save, migrated below
var LIBRARY_KEY = "puzzleatlas_studio_library_v1";

function loadLibraryRaw() {
  var raw = localStorage.getItem(LIBRARY_KEY);
  if (raw) {
    try { return JSON.parse(raw).hunts || []; } catch (e) { return []; }
  }
  // First run after this update: migrate a Phase 1 single-slot save, if any.
  var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) {
    try {
      var h = JSON.parse(legacy);
      if (h && h.id) { persistLibrary([h]); return [h]; }
    } catch (e) { /* ignore corrupted legacy save */ }
  }
  return [];
}
function persistLibrary(hunts) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify({ hunts: hunts }));
}
function getLibraryHunts() {
  return loadLibraryRaw().slice().sort(function (a, b) {
    return new Date((b.metadata || {}).updatedAt || 0) - new Date((a.metadata || {}).updatedAt || 0);
  });
}
function getHuntFromLibrary(id) {
  return loadLibraryRaw().find(function (h) { return h.id === id; });
}
function upsertHuntInLibrary(hunt) {
  hunt.metadata = hunt.metadata || {};
  hunt.metadata.updatedAt = new Date().toISOString();
  var hunts = loadLibraryRaw();
  var idx = hunts.findIndex(function (h) { return h.id === hunt.id; });
  var copy = clone(hunt);
  if (idx === -1) hunts.push(copy); else hunts[idx] = copy;
  persistLibrary(hunts);
}
function deleteHuntFromLibrary(id) {
  persistLibrary(loadLibraryRaw().filter(function (h) { return h.id !== id; }));
}
function saveCurrentHuntToLibrary(quiet) {
  upsertHuntInLibrary(Store.hunt);
  if (!quiet) toast("Saved “" + Store.hunt.title + "” to your hunt library.");
}

function exportHuntObj(hunt) {
  var json = JSON.stringify(hunt, null, 2);
  var filename = (hunt.title || "hunt").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase() + ".json";
  download(filename, json);
  toast("Exported " + filename);
}
function exportHunt() { exportHuntObj(Store.hunt); }

function importHuntFile(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var hunt = JSON.parse(reader.result);
      if (!hunt.schemaVersion || !hunt.nodes || !hunt.connections) throw new Error("File does not look like a PuzzleAtlas hunt export.");
      Store.replaceHunt(hunt);
      saveCurrentHuntToLibrary(true);
      toast("Imported \"" + hunt.title + "\".");
    } catch (e) {
      toast("Import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}
function importHuntFileToLibrary(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var hunt = JSON.parse(reader.result);
      if (!hunt.schemaVersion || !hunt.nodes || !hunt.connections) throw new Error("File does not look like a PuzzleAtlas hunt export.");
      if (!hunt.id) hunt.id = uid("hunt");
      upsertHuntInLibrary(hunt);
      renderLibrary();
      toast("Imported \"" + hunt.title + "\" into your library.");
    } catch (e) {
      toast("Import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}

/* ---------------------------------------------------------------------
   Screens: Library (Hunt Library / Style Library tabs) <-> Studio (canvas)
   <-> Style Builder (craft a style pack)
--------------------------------------------------------------------- */
var LibraryActiveTab = "hunt";
function showLibraryScreen(tab) {
  dom.studioScreen.classList.add("hidden");
  dom.styleBuilderScreen.classList.add("hidden");
  dom.libraryScreen.classList.remove("hidden");
  setLibraryTab(tab || LibraryActiveTab);
}
function setLibraryTab(tab) {
  LibraryActiveTab = tab;
  document.getElementById("tabHuntLibrary").classList.toggle("active", tab === "hunt");
  document.getElementById("tabStyleLibrary").classList.toggle("active", tab === "style");
  document.getElementById("huntLibrarySection").classList.toggle("hidden", tab !== "hunt");
  document.getElementById("styleLibrarySection").classList.toggle("hidden", tab !== "style");
  document.getElementById("libraryActionsHunt").classList.toggle("hidden", tab !== "hunt");
  document.getElementById("libraryActionsStyle").classList.toggle("hidden", tab !== "style");
  if (tab === "style") renderStyleLibrary(); else renderLibrary();
}
function showStudioScreen() {
  dom.libraryScreen.classList.add("hidden");
  dom.styleBuilderScreen.classList.add("hidden");
  dom.studioScreen.classList.remove("hidden");
  render();
}
function goToLibrary() {
  // Auto-save the open project so the library always reflects current state.
  if (Store.hunt && Store.hunt.id) saveCurrentHuntToLibrary(true);
  showLibraryScreen("hunt");
}
function goToStyleLibrary() {
  showLibraryScreen("style");
}
function openHuntById(id) {
  var hunt = getHuntFromLibrary(id);
  if (!hunt) { toast("That hunt could not be found."); return; }
  Store.replaceHunt(clone(hunt));
  showStudioScreen();
}
function createNewHuntAndOpen() {
  var h = newHunt();
  upsertHuntInLibrary(h);
  Store.replaceHunt(clone(h));
  showStudioScreen();
  toast("Created a new hunt.");
}
function openTemplateAndOpen(template, label) {
  var h = clone(template);
  h.id = uid("hunt");
  h.metadata = h.metadata || {};
  h.metadata.createdAt = new Date().toISOString();
  upsertHuntInLibrary(h);
  Store.replaceHunt(clone(h));
  showStudioScreen();
  toast("Created new hunt from " + label + ".");
}

function formatUpdated(iso) {
  var d = iso ? new Date(iso) : null;
  if (!d || isNaN(d.getTime())) return "unknown";
  var now = new Date();
  var sameYear = d.getFullYear() === now.getFullYear();
  var datePart = d.toLocaleDateString(undefined, sameYear ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" });
  var timePart = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return datePart + " at " + timePart;
}

function renderLibrary() {
  var hunts = getLibraryHunts();
  var grid = document.getElementById("libraryGrid");
  var empty = document.getElementById("libraryEmpty");
  grid.innerHTML = "";
  empty.classList.toggle("hidden", hunts.length > 0);

  hunts.forEach(function (h) {
    var nodeCount = (h.nodes || []).length;
    var entryCount = (h.entryPointIds || []).length;
    var card = document.createElement("div");
    card.className = "hunt-card";
    card.innerHTML =
      '<button class="hunt-card-title" data-open="' + h.id + '">' + esc(h.title || "Untitled Hunt") + "</button>" +
      '<div class="hunt-card-meta">' + nodeCount + " node" + (nodeCount === 1 ? "" : "s") + " · " + entryCount + " entry point" + (entryCount === 1 ? "" : "s") + "</div>" +
      '<div class="hunt-card-meta">Updated ' + esc(formatUpdated((h.metadata || {}).updatedAt)) + "</div>" +
      '<div class="hunt-card-actions">' +
        '<button class="small-btn" data-open="' + h.id + '">Open</button>' +
        '<button class="small-btn" data-rename="' + h.id + '">Rename</button>' +
        '<button class="small-btn" data-dup="' + h.id + '">Duplicate</button>' +
        '<button class="small-btn" data-export="' + h.id + '">Export</button>' +
        '<button class="small-btn" data-del="' + h.id + '">Delete</button>' +
      "</div>";
    grid.appendChild(card);
  });

  Array.prototype.forEach.call(grid.querySelectorAll("[data-open]"), function (btn) {
    btn.onclick = function () { openHuntById(btn.dataset.open); };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-rename]"), function (btn) {
    btn.onclick = function () {
      var hunt = getHuntFromLibrary(btn.dataset.rename);
      if (!hunt) return;
      var name = prompt("Rename hunt:", hunt.title || "Untitled Hunt");
      if (name === null) return;
      name = name.trim();
      if (!name) return;
      hunt.title = name;
      upsertHuntInLibrary(hunt);
      renderLibrary();
    };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-dup]"), function (btn) {
    btn.onclick = function () {
      var hunt = getHuntFromLibrary(btn.dataset.dup);
      if (!hunt) return;
      var copy = clone(hunt);
      copy.id = uid("hunt");
      copy.title = (hunt.title || "Untitled Hunt") + " (copy)";
      copy.metadata = copy.metadata || {};
      copy.metadata.createdAt = new Date().toISOString();
      upsertHuntInLibrary(copy);
      renderLibrary();
      toast("Duplicated “" + (hunt.title || "Untitled Hunt") + "”.");
    };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-export]"), function (btn) {
    btn.onclick = function () {
      var hunt = getHuntFromLibrary(btn.dataset.export);
      if (hunt) exportHuntObj(hunt);
    };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-del]"), function (btn) {
    btn.onclick = function () {
      var hunt = getHuntFromLibrary(btn.dataset.del);
      if (!hunt) return;
      if (!confirm('Delete "' + (hunt.title || "Untitled Hunt") + '"? This cannot be undone.')) return;
      deleteHuntFromLibrary(hunt.id);
      renderLibrary();
      toast("Deleted “" + (hunt.title || "Untitled Hunt") + "”.");
    };
  });
}

/* ---------------------------------------------------------------------
   Style Library grid (Library screen, "🎨 Style Library" tab) — built-in
   packs (read-only templates) plus any custom packs the creator has
   saved via the Style Builder.
--------------------------------------------------------------------- */
function exportStylePackObj(pack) {
  var json = JSON.stringify(pack, null, 2);
  var filename = (pack.name || "style-pack").replace(/[^a-z0-9\-_]+/gi, "_").toLowerCase() + ".json";
  download(filename, json);
  toast("Exported " + filename);
}
function importStylePackFileToLibrary(file) {
  var reader = new FileReader();
  reader.onload = function () {
    try {
      var pack = JSON.parse(reader.result);
      if (!styleFieldsPresent(pack)) throw new Error("File is missing required style pack fields (typography.headingFont/bodyFont, palette.background/surface/text/textDim/accent).");
      if (!pack.id || !isCustomStylePackId(pack.id)) pack.id = "imported-" + uid("style");
      if (!pack.name) pack.name = "Imported Style Pack";
      upsertCustomStylePack(pack);
      renderStyleLibrary();
      toast("Imported \"" + pack.name + "\" into your Style Library.");
    } catch (e) {
      toast("Style pack import failed: " + e.message);
    }
  };
  reader.readAsText(file);
}

function renderStyleLibrary() {
  var grid = document.getElementById("styleLibraryGrid");
  grid.innerHTML = "";

  function makeCard(pack, isBuiltin) {
    var pal = pack.palette || {};
    var card = document.createElement("div");
    card.className = "hunt-card";
    card.innerHTML =
      '<div class="style-card-swatch" style="background:' + esc(pal.background || "#000") + '">' +
        '<span style="background:' + esc(pal.accent || "#888") + '"></span>' +
        '<span style="background:' + esc(pal.accent2 || pal.accent || "#888") + '"></span>' +
        '<span style="background:' + esc(pal.ok || "#57d38c") + '"></span>' +
      '</div>' +
      '<div class="hunt-card-title" style="cursor:default">' + esc(pack.name || "Untitled Style") + (isBuiltin ? ' <span class="tag-builtin">Built-in</span>' : '') + '</div>' +
      '<div class="hunt-card-meta">' + esc(pack.description || "No description.") + '</div>' +
      '<div class="hunt-card-actions">' +
        (isBuiltin
          ? '<button class="small-btn" data-duplicate="' + pack.id + '">⧉ Duplicate &amp; Edit</button>'
          : '<button class="small-btn" data-edit="' + pack.id + '">Edit</button>' +
            '<button class="small-btn" data-duplicate="' + pack.id + '">Duplicate</button>' +
            '<button class="small-btn" data-export="' + pack.id + '">Export</button>' +
            '<button class="small-btn" data-del="' + pack.id + '">Delete</button>') +
      '</div>';
    return card;
  }

  BUILTIN_STYLE_PACK_IDS.forEach(function (id) {
    if (STYLE_PACKS[id]) grid.appendChild(makeCard(STYLE_PACKS[id], true));
  });
  getCustomStylePacks().forEach(function (p) {
    grid.appendChild(makeCard(p, false));
  });

  Array.prototype.forEach.call(grid.querySelectorAll("[data-edit]"), function (btn) {
    btn.onclick = function () { openStyleBuilder(btn.dataset.edit); };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-duplicate]"), function (btn) {
    btn.onclick = function () {
      var src = STYLE_PACKS[btn.dataset.duplicate];
      if (!src) return;
      var copy = clone(src);
      copy.id = uid("style");
      copy.name = (src.name || "Style") + " (copy)";
      upsertCustomStylePack(copy);
      openStyleBuilder(copy.id);
      toast("Duplicated “" + (src.name || "Style") + "” — editing your copy.");
    };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-export]"), function (btn) {
    btn.onclick = function () {
      var p = STYLE_PACKS[btn.dataset.export];
      if (p) exportStylePackObj(p);
    };
  });
  Array.prototype.forEach.call(grid.querySelectorAll("[data-del]"), function (btn) {
    btn.onclick = function () {
      var p = getCustomStylePackById(btn.dataset.del);
      if (!p) return;
      if (!confirm('Delete style "' + (p.name || "Untitled Style") + '"? Hunts already using it keep their own saved copy — this only removes it from your Style Library.')) return;
      deleteCustomStylePack(p.id);
      renderStyleLibrary();
      toast("Deleted “" + (p.name || "Untitled Style") + "”.");
    };
  });
}

/* ---------------------------------------------------------------------
   Style Builder screen — craft a style pack's typography, palette,
   shape, imagery and motion, with a live phone-mockup preview driven by
   the same --pv-* variables the Preview overlay and Player mockup use.
   Opened from the Style Library grid ("+ New Style" / Edit / Duplicate).
--------------------------------------------------------------------- */
var StyleBuilder = { pack: null };

function createNewStyleAndOpen() {
  var pack = newBlankStylePack();
  upsertCustomStylePack(pack);
  openStyleBuilder(pack.id);
  toast("Created a new style — craft it, then Save.");
}

function openStyleBuilder(id) {
  var pack = STYLE_PACKS[id];
  if (!pack) { toast("That style could not be found."); return; }
  StyleBuilder.pack = clone(pack);
  showStyleBuilderScreen();
}

function showStyleBuilderScreen() {
  dom.libraryScreen.classList.add("hidden");
  dom.studioScreen.classList.add("hidden");
  dom.styleBuilderScreen.classList.remove("hidden");
  renderStyleBuilderScreen();
}

function persistStyleBuilderDraft(quiet) {
  if (!StyleBuilder.pack) return;
  upsertCustomStylePack(StyleBuilder.pack);
  if (!quiet) toast("Saved “" + (StyleBuilder.pack.name || "Untitled Style") + "”.");
}

function backToStyleLibrary() {
  persistStyleBuilderDraft(true); // quiet auto-save, mirrors goToLibrary()'s auto-save for hunts
  StyleBuilder.pack = null;
  goToStyleLibrary();
}

function liveUpdateStyleBuilder() {
  if (!StyleBuilder.pack) return;
  applyStylePack(StyleBuilder.pack);
}

function setDeep(obj, path, value) {
  var parts = path.split(".");
  var cur = obj;
  for (var i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] === undefined || cur[parts[i]] === null || typeof cur[parts[i]] !== "object") cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function sbField(labelText, path, value, type) {
  return '<div class="field"><label>' + esc(labelText) + '</label><input type="' + (type || "text") + '" data-path="' + path + '" value="' + esc(value == null ? "" : value) + '" /></div>';
}
function sbColorField(labelText, path, value) {
  var hex = /^#[0-9a-fA-F]{6}$/.test(value || "") ? value : "#000000";
  return '<div class="field"><label>' + esc(labelText) + '</label><div class="color-field-row">' +
    '<input type="color" data-cpath="' + path + '" value="' + hex + '" />' +
    '<input type="text" data-path="' + path + '" value="' + esc(value || "") + '" />' +
  '</div></div>';
}
function sbSelectField(labelText, path, options, value) {
  return '<div class="field"><label>' + esc(labelText) + '</label><select data-path="' + path + '">' +
    options.map(function (o) { return '<option value="' + o + '"' + (o === value ? " selected" : "") + '>' + o + '</option>'; }).join("") +
  '</select></div>';
}
function sbTextareaField(labelText, path, value) {
  return '<div class="field"><label>' + esc(labelText) + '</label><textarea data-path="' + path + '">' + esc(value || "") + '</textarea></div>';
}

function renderStyleBuilderForm() {
  var box = document.getElementById("styleBuilderForm");
  var p = StyleBuilder.pack;
  p.typography = p.typography || {};
  p.palette = p.palette || {};
  p.palette.families = p.palette.families || {};
  p.shape = p.shape || {};
  p.imagery = p.imagery || {};
  p.motion = p.motion || {};
  p.vibe = p.vibe || {};

  var html = '<div class="style-builder-desc">Sets the fonts, colours, shape and pacing a hunt’s Preview / Play uses. Never affects this Studio editor.</div>';

  html += '<div class="section-title" style="border-top:none;margin-top:0;padding-top:0">Identity</div>';
  html += sbTextareaField("Description", "description", p.description);
  html += sbField("Vibe tags (comma-separated)", "__vibeTags", (p.vibe.tags || []).join(", "));
  html += sbTextareaField("Tone notes", "vibe.toneNotes", p.vibe.toneNotes);

  html += '<div class="section-title">Typography</div>';
  html += sbField("Heading font (CSS font stack)", "typography.headingFont", p.typography.headingFont);
  html += sbField("Body font", "typography.bodyFont", p.typography.bodyFont);
  html += sbField("Mono font (codes / answers)", "typography.monoFont", p.typography.monoFont);
  html += '<div class="field-row">' +
    sbSelectField("Heading transform", "typography.headingTransform", ["none", "uppercase", "capitalize"], p.typography.headingTransform || "none") +
    sbField("Heading letter spacing", "typography.headingLetterSpacing", p.typography.headingLetterSpacing || "normal") +
  '</div>';
  html += sbField("Google Fonts import URL (optional)", "typography.importUrl", p.typography.importUrl);

  html += '<div class="section-title">Palette</div>';
  html += sbColorField("Background", "palette.background", p.palette.background);
  html += sbColorField("Surface", "palette.surface", p.palette.surface);
  html += sbColorField("Text", "palette.text", p.palette.text);
  html += sbColorField("Text (dim)", "palette.textDim", p.palette.textDim);
  html += sbColorField("Accent", "palette.accent", p.palette.accent);
  html += sbColorField("Accent 2", "palette.accent2", p.palette.accent2);
  html += sbColorField("Success", "palette.ok", p.palette.ok);
  html += sbColorField("Warning / hint", "palette.warn", p.palette.warn);
  html += sbColorField("Danger / incorrect", "palette.danger", p.palette.danger);

  html += '<div class="section-title">Node family accents</div>';
  html += sbColorField("Narrative", "palette.families.narrative", p.palette.families.narrative);
  html += sbColorField("Puzzle", "palette.families.puzzle", p.palette.families.puzzle);
  html += sbColorField("State", "palette.families.state", p.palette.families.state);
  html += sbColorField("Control", "palette.families.control", p.palette.families.control);
  html += sbColorField("Support", "palette.families.support", p.palette.families.support);

  html += '<div class="section-title">Shape</div>';
  html += '<div class="field-row">' +
    sbField("Border radius", "shape.radius", p.shape.radius || "8px") +
    sbField("Border width", "shape.borderWidth", p.shape.borderWidth || "1px") +
  '</div>';
  html += sbSelectField("Border style", "shape.borderStyle", ["none", "solid", "dashed", "double"], p.shape.borderStyle || "solid");

  html += '<div class="section-title">Imagery</div>';
  html += sbSelectField("Treatment", "imagery.treatment", ["none", "grayscale", "sepia", "duotone", "high-contrast"], p.imagery.treatment || "none");
  html += sbField("Filter CSS", "imagery.filterCss", p.imagery.filterCss);

  html += '<div class="section-title">Motion</div>';
  html += sbSelectField("Pace", "motion.pace", ["none", "subtle", "standard", "dramatic"], p.motion.pace || "subtle");
  html += '<label class="motion-check"><input type="checkbox" id="styleMotionSafe"' + (p.motion.reducedMotionSafe !== false ? " checked" : "") + ' /> Respect reduced-motion preference</label>';

  box.innerHTML = html;

  Array.prototype.forEach.call(box.querySelectorAll("[data-path]"), function (el) {
    var handler = function (e) {
      var path = el.dataset.path;
      var val = e.target.value;
      if (path === "__vibeTags") {
        p.vibe.tags = val.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
      } else {
        setDeep(p, path, val);
      }
      var swatch = box.querySelector('[data-cpath="' + path + '"]');
      if (swatch && /^#[0-9a-fA-F]{6}$/.test(val)) swatch.value = val;
      liveUpdateStyleBuilder();
    };
    el.oninput = handler; el.onchange = handler; // onchange covers <select>, which doesn't reliably fire input in every browser
  });
  Array.prototype.forEach.call(box.querySelectorAll("[data-cpath]"), function (el) {
    el.oninput = function (e) {
      var path = el.dataset.cpath;
      setDeep(p, path, e.target.value);
      var twin = box.querySelector('[data-path="' + path + '"]');
      if (twin) twin.value = e.target.value;
      liveUpdateStyleBuilder();
    };
  });
  var motionChk = document.getElementById("styleMotionSafe");
  if (motionChk) motionChk.onchange = function (e) { p.motion.reducedMotionSafe = e.target.checked; };
}

function renderStyleBuilderPreviewContent() {
  var main = document.getElementById("styleBuilderPreviewMain");
  main.innerHTML =
    '<p class="pv-side-title">Open leads (2)</p>' +
    '<div class="pv-choice-btn" style="border-color:var(--pv-accent)">📜 The Archive Room</div>' +
    '<div class="pv-choice-btn">🔑 A Locked Drawer</div>' +
    '<hr style="border-color:var(--pv-text-dim);opacity:.25;margin:16px 0" />' +
    '<p class="pv-scene-body">Dust hangs in the light from the high windows. Someone has been through these files recently — the drawers aren’t quite square.</p>' +
    '<p class="pv-scene-body">A brass plate on the desk reads: <b>THE CURATOR’S BENCH</b>.</p>' +
    '<div class="pv-choice-btn">Search the desk</div>' +
    '<div class="pv-choice-btn">Read the ledger</div>' +
    '<input class="pv-answer-input" type="text" placeholder="TYPE YOUR ANSWER" disabled />' +
    '<p class="pv-feedback correct">✓ Correct — the drawer clicks open.</p>' +
    '<p class="pv-feedback incorrect">✗ Not quite. Try again.</p>' +
    '<button class="pv-hint-btn">💡 Show a hint</button>' +
    '<p class="pv-hint-text">First, gentle nudge: look at the ledger’s dates.</p>' +
    '<div class="pv-ending" style="padding:20px 0 4px">' +
      '<h2 style="font-size:18px;margin:0 0 6px">🏁 A CLEAN CLOSE</h2>' +
      '<p class="pv-scene-body" style="margin:0">The case is closed, the files are back in order.</p>' +
    '</div>';
}

function renderStyleBuilderScreen() {
  var p = StyleBuilder.pack;
  if (!p) return;
  document.getElementById("styleNameInput").value = p.name || "";
  document.getElementById("btnStyleDelete").classList.toggle("hidden", !isCustomStylePackId(p.id));
  renderStyleBuilderForm();
  renderStyleBuilderPreviewContent();
  applyStylePack(p);
}

/* =========================================================================
   Player interpreter — walks the exported JSON hunt model directly.
   This same engine backs both the in-Studio Preview and (conceptually) a
   standalone Player app: it only ever reads the canonical JSON, never a
   hard-coded flow.
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
  var ok = (n.content.acceptedAnswers || []).some(function (a) { return normalizeAnswer(a, n.content.caseSensitive) === normalizeAnswer(text, n.content.caseSensitive); });
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
function pv_action_revealHint(session, hintNodeId) {
  var cur = session.state.hintProgress[hintNodeId] || 0;
  var n = session.hunt.nodes.find(function (x) { return x.id === hintNodeId; });
  if (cur < n.content.stages.length) session.state.hintProgress[hintNodeId] = cur + 1;
}

/* ---------------------------------------------------------------------
   Preview / Player UI — a reusable controller factory. It powers both
   the full-screen "Preview / Play" overlay (a frozen snapshot of the
   exported JSON, for a distraction-free test run) and the always-visible
   docked Player mockup beside the canvas (a live mirror bound directly
   to Store.hunt — see "Live Player mockup" below). Each controller owns
   its own session and UI state, and only ever queries inside its own
   root element, so both can be on screen at once without id clashes.
--------------------------------------------------------------------- */
var Preview, LiveMock;

function createPreviewController(mainEl, sideEl) {
  var ctl = {
    mainEl: mainEl, sideEl: sideEl,
    session: null, expandedNodeId: null, showState: false,
    orderingDraft: {}, matchingDraft: {},
    pinnedNodeId: null, // set when an outside selection (e.g. the canvas) asks to force-show a node
    _activeIds: { expandedId: null, leadIds: [] },
    onRender: null
  };

  ctl.open = function (hunt) {
    ctl.session = createSession(hunt);
    ctl.expandedNodeId = null;
    ctl.showState = false;
    ctl.orderingDraft = {};
    ctl.matchingDraft = {};
    ctl.pinnedNodeId = null;
    ctl.render();
  };

  ctl.restart = function () { if (ctl.session) ctl.open(ctl.session.hunt); };

  // Force the mockup to show a specific node regardless of the normal
  // "current open leads" flow — used when a node is selected on canvas.
  ctl.showNode = function (nodeId) { ctl.pinnedNodeId = nodeId; ctl.render(); };
  ctl.clearPin = function () { if (ctl.pinnedNodeId) { ctl.pinnedNodeId = null; ctl.render(); } };

  ctl.render = function () {
    var session = ctl.session;
    if (!session) return;
    var hunt = session.hunt, state = session.state;
    var main = ctl.mainEl, side = ctl.sideEl;

    var pinnedNode = ctl.pinnedNodeId ? hunt.nodes.find(function (n) { return n.id === ctl.pinnedNodeId; }) : null;
    if (ctl.pinnedNodeId && !pinnedNode) ctl.pinnedNodeId = null; // was deleted — fall back to normal flow

    if (pinnedNode) {
      renderPinnedNode(session, pinnedNode, ctl);
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

function previewOpen() {
  // Interpret the EXPORTED JSON, not the live editable object — proves
  // "one export drives both preview and player". A frozen snapshot,
  // distinct from the always-live docked mockup below.
  var exportedJson = JSON.stringify(Store.hunt);
  var hunt = JSON.parse(exportedJson);
  document.getElementById("previewHuntTitle").textContent = hunt.title;
  document.getElementById("previewOverlay").classList.remove("hidden");
  applyStylePack(hunt.stylePack);
  Preview.open(hunt);
}
function previewClose() { document.getElementById("previewOverlay").classList.add("hidden"); }
function previewRestart() { Preview.restart(); }

var PLAYER_SCREEN_TYPES = ["scene", "choice", "answerEntry", "ordering", "matching", "locationPlaceholder", "ending"];

// Renders whatever node was pinned via ctl.showNode() (canvas selection).
// This shows the node exactly as the player screen would — no creator
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

function openLeadNodes(session) {
  var hunt = session.hunt, state = session.state;
  return hunt.nodes.filter(function (n) {
    return state.available[n.id] && !state.completed[n.id] && !isAutoType(n.type) && n.type !== "hint";
  });
}

function hintsForNode(hunt, nodeId) {
  return hunt.nodes.filter(function (n) { return n.type === "hint" && n.content.forNodeId === nodeId; });
}

function renderPreviewNode(session, n, ctl) {
  var c = n.content, html = "";
  var hints = hintsForNode(session.hunt, n.id);
  if (n.type === "scene") {
    html += '<div class="pv-scene-body">' + esc(c.body) + '</div><button class="pv-choice-btn" id="pvContinue" style="max-width:200px">Continue →</button>';
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
  Array.prototype.forEach.call(root.querySelectorAll("[data-hint]"), function (btn) {
    btn.onclick = function () { pv_action_revealHint(session, btn.dataset.hint); ctl.render(); };
  });
}

/* ---------------------------------------------------------------------
   Live Player mockup — an always-visible mobile mirror of the Player
   app, docked beside the canvas. Unlike the Preview overlay above, its
   session.hunt IS Store.hunt (the same live object, not a JSON
   snapshot), so content edits appear immediately without a restart.
   Structural changes (nodes/connections added or removed) are picked
   up by re-running recompute() without discarding the player's current
   progress through the hunt.
--------------------------------------------------------------------- */
function syncLiveMock() {
  if (!LiveMock || !LiveMock.mainEl) return;
  applyStylePack(Store.hunt.stylePack);
  if (!LiveMock.session || LiveMock.session.hunt !== Store.hunt) {
    LiveMock.open(Store.hunt);
  } else {
    // Seed state for any variables added after this session started.
    (Store.hunt.variables || []).forEach(function (v) {
      if (!(v.id in LiveMock.session.state.variables)) LiveMock.session.state.variables[v.id] = v.initial;
    });
    recompute(LiveMock.session);
    LiveMock.render();
  }
}

// Reflects whichever node(s) are currently on screen in the live
// mockup back onto the design canvas, so a creator can see at a glance
// where "the player" currently is while they work.
function updateCanvasPlayerHighlight(ctl) {
  if (!dom.nodeLayer) return;
  var ids = (ctl && ctl._activeIds) || { expandedId: null, leadIds: [] };
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el) {
    var id = el.dataset.nodeId;
    el.classList.toggle("player-here", id === ids.expandedId);
    el.classList.toggle("player-open", id !== ids.expandedId && ids.leadIds.indexOf(id) !== -1);
  });
}

// The reverse direction: selecting a node on the canvas should switch
// the live mockup to show that node (see LiveMock.showNode/clearPin).
// Selecting an edge is left alone — there's nothing to preview for it.
function syncLiveMockSelection() {
  if (!LiveMock || !LiveMock.mainEl) return;
  if (Store.selection.type === "node" && Store.multiSelectNodeIds.length === 1) {
    LiveMock.showNode(Store.multiSelectNodeIds[0]);
  } else if (Store.selection.type === "node" && Store.multiSelectNodeIds.length > 1) {
    LiveMock.clearPin(); // nothing single to show — fall back to the normal auto-following view
  } else if (!Store.selection.type) {
    LiveMock.clearPin();
  }
}

/* ---------------------------------------------------------------------
   Reference demo hunt — "The Printer's Last Edition" (condensed armchair
   version of a location-hunt concept: 8 nodes, 3 parallel puzzle leads,
   an any-2-of-3 convergence, and a branch that picks between two endings).
--------------------------------------------------------------------- */
var DEMO_HUNT = {
  schemaVersion: "0.1.0",
  id: "hunt_printers_last_edition",
  title: "The Printer's Last Edition",
  metadata: {
    concept: "A suppressed newspaper was printed the night before a decisive political event. The player must reconstruct its final edition before a rival collector destroys the surviving evidence.",
    audience: "Armchair / at-home, 20-30 minute compact reference hunt",
    createdAt: "2026-07-30T00:00:00.000Z",
    updatedAt: "2026-07-30T00:00:00.000Z"
  },
  entryPointIds: ["n_prologue"],
  variables: [
    { id: "var_trust", name: "trust", type: "number", initial: 0 }
  ],
  items: [
    { id: "item_altered_proof", name: "Altered Proof Fragment", description: "A torn proof sheet showing a deliberately changed headline." }
  ],
  nodes: [
    {
      id: "n_prologue", type: "scene", family: "narrative", title: "Prologue — The Suppressed Edition",
      position: { x: 40, y: 220 },
      content: { body: "A newspaper archive has hired you to reconstruct a suppressed final edition, printed the night before a decisive political event. Three leads survive: the printer's type-case, the courier's delivery route, and a witness's account of that night. A rival collector is racing to destroy what's left — you don't need all three leads, but you'll need at least two." },
      creatorNotes: "Entry point. Fans out to three parallel, non-exclusive leads so players can tackle them in any order.",
      effects: []
    },
    {
      id: "n_printer", type: "answerEntry", family: "puzzle", title: "The Printer's Type-Case",
      position: { x: 360, y: 40 },
      content: { prompt: "Two surviving proofs show the same headline, but one word was reset in a different typeface — a printer's tell for a late, unauthorized change. Compare the proofs (in the archive materials) and name the altered word.", acceptedAnswers: ["TREASON", "TREASONOUS"], caseSensitive: false },
      creatorNotes: "Solution: the word 'treason' was substituted at the last minute to justify a raid that never happened. Accept both the noun and adjective form.",
      effects: [{ type: "awardItem", itemId: "item_altered_proof" }]
    },
    {
      id: "n_courier", type: "answerEntry", family: "puzzle", title: "The Courier's Route",
      position: { x: 360, y: 220 },
      content: { prompt: "Cross-reference the delivery boy's route sheet against the district map to find the one stop he logged that doesn't exist on any map from that year. Name the street.", acceptedAnswers: ["MOLASSES LANE", "MOLASSES"], caseSensitive: false },
      creatorNotes: "Molasses Lane was a private lane later absorbed into a rail yard — finding it proves the courier met someone off the record. Completing this branch is what later tips the ending toward 'Deception Preserved'.",
      effects: []
    },
    {
      id: "n_witness", type: "ordering", family: "puzzle", title: "The Witness's Timeline",
      position: { x: 360, y: 400 },
      content: {
        prompt: "A witness described four events out of order. Put them back into the true chronological sequence.",
        items: [
          { id: "wi_1", label: "Lights seen in the print-room after midnight" },
          { id: "wi_2", label: "A coded knock at the back door" },
          { id: "wi_3", label: "The press runs one final time" },
          { id: "wi_4", label: "A single carriage leaves before dawn" }
        ],
        correctOrder: ["wi_1", "wi_2", "wi_3", "wi_4"]
      },
      creatorNotes: "Order establishes that the press ran AFTER the secret visitor arrived, not before — key to the final reveal.",
      effects: [{ type: "setVariable", variableId: "var_trust", operation: "increment", value: "1" }]
    },
    {
      id: "n_convergence", type: "convergence", family: "control", title: "Reconstruct the Front Page",
      position: { x: 700, y: 220 },
      content: { requiredMode: "any", requiredCount: 2 },
      creatorNotes: "Any two of the three leads are enough to reconstruct the page — deliberately non-linear so players don't need to exhaust every branch.",
      effects: [{ type: "addScore", delta: 10 }]
    },
    {
      id: "n_branch", type: "branch", family: "control", title: "Weigh the Evidence",
      position: { x: 980, y: 220 },
      content: {},
      creatorNotes: "Auto-routes based on whether the player uncovered the courier's off-record meeting. Connections are evaluated in priority order below.",
      effects: []
    },
    {
      id: "n_ending_deception", type: "ending", family: "control", title: "Ending — Deception Preserved",
      position: { x: 1260, y: 100 },
      content: { resultName: "Deception Preserved", body: "You realize the 'treasonous' edition was deliberate misinformation, designed to protect a clandestine evacuation the courier's meeting reveals. You choose to let the deception stand." },
      creatorNotes: "Reached when the courier branch was solved.",
      effects: []
    },
    {
      id: "n_ending_truth", type: "ending", family: "control", title: "Ending — Truth Printed",
      position: { x: 1260, y: 340 },
      content: { resultName: "Truth Printed", body: "Without the courier's off-record evidence, you publish the reconstructed front page as historical record — the truth, without knowing what it once protected." },
      creatorNotes: "Default/fallback ending when the courier branch was not solved.",
      effects: []
    }
  ],
  connections: [
    { id: "c_1", sourceId: "n_prologue", targetId: "n_printer", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_2", sourceId: "n_prologue", targetId: "n_courier", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_3", sourceId: "n_prologue", targetId: "n_witness", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_4", sourceId: "n_printer", targetId: "n_convergence", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_5", sourceId: "n_courier", targetId: "n_convergence", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_6", sourceId: "n_witness", targetId: "n_convergence", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_7", sourceId: "n_convergence", targetId: "n_branch", condition: { type: "always" }, priority: 0, label: "" },
    { id: "c_8", sourceId: "n_branch", targetId: "n_ending_deception", condition: { type: "nodeComplete", nodeId: "n_courier" }, priority: 0, label: "if courier branch solved" },
    { id: "c_9", sourceId: "n_branch", targetId: "n_ending_truth", condition: { type: "always" }, priority: 1, label: "otherwise" }
  ]
};

/* ---------------------------------------------------------------------
   Deliberately broken test hunt — for validation demo. Contains exactly
   one unreachable node and one structurally impossible convergence.
--------------------------------------------------------------------- */
var BROKEN_HUNT = {
  schemaVersion: "0.1.0",
  id: "hunt_broken_validation_test",
  title: "Validation Test Hunt (deliberately broken)",
  metadata: { concept: "Fixture for exercising the validation panel.", audience: "QA", createdAt: "2026-07-30T00:00:00.000Z", updatedAt: "2026-07-30T00:00:00.000Z" },
  entryPointIds: ["b_start"],
  variables: [],
  items: [],
  nodes: [
    { id: "b_start", type: "scene", family: "narrative", title: "Start", position: { x: 40, y: 160 }, content: { body: "Two branches lead onward." }, creatorNotes: "", effects: [] },
    { id: "b_branchA", type: "answerEntry", family: "puzzle", title: "Branch A Puzzle", position: { x: 320, y: 60 }, content: { prompt: "Placeholder A", acceptedAnswers: ["A"], caseSensitive: false }, creatorNotes: "", effects: [] },
    { id: "b_branchB", type: "answerEntry", family: "puzzle", title: "Branch B Puzzle", position: { x: 320, y: 260 }, content: { prompt: "Placeholder B", acceptedAnswers: ["B"], caseSensitive: false }, creatorNotes: "", effects: [] },
    { id: "b_gate", type: "convergence", family: "control", title: "Impossible Gate", position: { x: 600, y: 160 }, content: { requiredMode: "any", requiredCount: 3 }, creatorNotes: "Deliberately requires 3 of only 2 incoming branches — structurally impossible. Validation should flag this.", effects: [] },
    { id: "b_end", type: "ending", family: "control", title: "Good End", position: { x: 880, y: 160 }, content: { resultName: "Reached", body: "You made it." }, creatorNotes: "", effects: [] },
    { id: "b_isolated", type: "answerEntry", family: "puzzle", title: "Isolated Puzzle", position: { x: 600, y: 400 }, content: { prompt: "Nothing connects to this node — deliberately unreachable.", acceptedAnswers: ["X"], caseSensitive: false }, creatorNotes: "Deliberately has no incoming connection at all. Validation should flag this as unreachable.", effects: [] }
  ],
  connections: [
    { id: "bc_1", sourceId: "b_start", targetId: "b_branchA", condition: { type: "always" }, priority: 0, label: "" },
    { id: "bc_2", sourceId: "b_start", targetId: "b_branchB", condition: { type: "always" }, priority: 0, label: "" },
    { id: "bc_3", sourceId: "b_branchA", targetId: "b_gate", condition: { type: "always" }, priority: 0, label: "" },
    { id: "bc_4", sourceId: "b_branchB", targetId: "b_gate", condition: { type: "always" }, priority: 0, label: "" },
    { id: "bc_5", sourceId: "b_gate", targetId: "b_end", condition: { type: "always" }, priority: 0, label: "" }
  ]
};

/* ---------------------------------------------------------------------
   Bootstrap
--------------------------------------------------------------------- */
function init() {
  dom.libraryScreen = document.getElementById("libraryScreen");
  dom.studioScreen = document.getElementById("studioScreen");
  dom.styleBuilderScreen = document.getElementById("styleBuilderScreen");
  dom.canvasWrap = document.getElementById("canvasWrap");
  dom.canvasViewport = document.getElementById("canvasViewport");
  dom.edgeLayer = document.getElementById("edgeLayer");
  dom.nodeLayer = document.getElementById("nodeLayer");
  dom.canvasHint = document.getElementById("canvasHint");
  dom.marquee = document.getElementById("marquee");

  loadCustomStylePacksIntoRegistry();

  Store.view = { x: 60, y: 60, zoom: 1 };
  Store.init();

  Preview = createPreviewController(document.getElementById("previewMain"), document.getElementById("previewSide"));
  LiveMock = createPreviewController(document.getElementById("mockMain"), document.getElementById("mockSide"));
  LiveMock.onRender = updateCanvasPlayerHighlight;

  initCanvasInteraction();
  initPaletteDrop();

  document.getElementById("huntTitleInput").oninput = function (e) { Store.hunt.title = e.target.value; };
  document.getElementById("huntTitleInput").onblur = function () { Store.pushHistory(); };

  document.getElementById("btnLibrary").onclick = goToLibrary;
  document.getElementById("btnUndo").onclick = function () { Store.undo(); };
  document.getElementById("btnRedo").onclick = function () { Store.redo(); };
  document.getElementById("btnSave").onclick = function () { saveCurrentHuntToLibrary(false); };
  document.getElementById("btnExport").onclick = exportHunt;
  document.getElementById("btnImport").onclick = function () { document.getElementById("fileImport").click(); };
  document.getElementById("fileImport").onchange = function (e) {
    if (e.target.files[0]) importHuntFile(e.target.files[0]);
    e.target.value = "";
  };
  document.getElementById("btnDemo").onclick = function () { Store.replaceHunt(clone(DEMO_HUNT)); toast("Loaded reference demo hunt: \"The Printer's Last Edition\"."); };
  document.getElementById("btnBroken").onclick = function () {
    Store.replaceHunt(clone(BROKEN_HUNT));
    toast("Loaded broken test hunt — open Validation to see the flagged issues.");
    document.getElementById("validationPanel").classList.remove("hidden");
    renderValidationPanel();
  };

  document.getElementById("chkSnap").onchange = function (e) { Store.snapEnabled = e.target.checked; };

  document.getElementById("btnValidation").onclick = function () {
    var panel = document.getElementById("validationPanel");
    panel.classList.toggle("hidden");
    if (!panel.classList.contains("hidden")) renderValidationPanel();
  };
  document.getElementById("btnCloseValidation").onclick = function () { document.getElementById("validationPanel").classList.add("hidden"); };

  document.getElementById("btnPreview").onclick = previewOpen;
  document.getElementById("btnClosePreview").onclick = previewClose;
  document.getElementById("btnPreviewRestart").onclick = previewRestart;
  document.getElementById("btnPreviewState").onclick = function () { Preview.showState = !Preview.showState; Preview.render(); };

  document.getElementById("btnMockRestart").onclick = function () { LiveMock.open(Store.hunt); toast("Player view restarted."); };
  document.getElementById("btnMockState").onclick = function () { LiveMock.showState = !LiveMock.showState; LiveMock.render(); };

  // Library screen controls
  document.getElementById("btnNewHunt").onclick = createNewHuntAndOpen;
  document.getElementById("btnLibImport").onclick = function () { document.getElementById("fileLibImport").click(); };
  document.getElementById("fileLibImport").onchange = function (e) {
    if (e.target.files[0]) importHuntFileToLibrary(e.target.files[0]);
    e.target.value = "";
  };
  document.getElementById("btnDemoFromLibrary").onclick = function () { openTemplateAndOpen(DEMO_HUNT, "the demo hunt"); };
  document.getElementById("btnBrokenFromLibrary").onclick = function () {
    openTemplateAndOpen(BROKEN_HUNT, "the broken test hunt");
    document.getElementById("validationPanel").classList.remove("hidden");
    renderValidationPanel();
  };

  // Library tabs: Hunt Library <-> Style Library (a separate section, not the Hunt grid)
  document.getElementById("tabHuntLibrary").onclick = function () { setLibraryTab("hunt"); };
  document.getElementById("tabStyleLibrary").onclick = function () { setLibraryTab("style"); };
  document.getElementById("btnNewStyle").onclick = createNewStyleAndOpen;
  document.getElementById("btnLibImportStyle").onclick = function () { document.getElementById("fileLibImportStyle").click(); };
  document.getElementById("fileLibImportStyle").onchange = function (e) {
    if (e.target.files[0]) importStylePackFileToLibrary(e.target.files[0]);
    e.target.value = "";
  };

  // Style Builder screen controls
  document.getElementById("btnStyleBack").onclick = backToStyleLibrary;
  document.getElementById("styleNameInput").oninput = function (e) { if (StyleBuilder.pack) StyleBuilder.pack.name = e.target.value; };
  document.getElementById("styleNameInput").onblur = function () { persistStyleBuilderDraft(true); };
  document.getElementById("btnStyleSave").onclick = function () { persistStyleBuilderDraft(false); };
  document.getElementById("btnStyleDuplicate").onclick = function () {
    if (!StyleBuilder.pack) return;
    var copy = clone(StyleBuilder.pack);
    copy.id = uid("style");
    copy.name = (copy.name || "Style") + " (copy)";
    upsertCustomStylePack(copy);
    StyleBuilder.pack = copy;
    renderStyleBuilderScreen();
    toast("Duplicated as “" + copy.name + "”.");
  };
  document.getElementById("btnStyleExport").onclick = function () { if (StyleBuilder.pack) exportStylePackObj(StyleBuilder.pack); };
  document.getElementById("btnStyleDelete").onclick = function () {
    if (!StyleBuilder.pack) return;
    if (!confirm('Delete style "' + (StyleBuilder.pack.name || "Untitled Style") + '"? Hunts already using it keep their own saved copy.')) return;
    deleteCustomStylePack(StyleBuilder.pack.id);
    StyleBuilder.pack = null;
    toast("Style deleted.");
    goToStyleLibrary();
  };

  syncLiveMock();
  showLibraryScreen();
  toast("Welcome to PuzzleAtlas Studio. Open a hunt from your library, or start a new one.", 4000);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
