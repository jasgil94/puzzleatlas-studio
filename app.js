/* =========================================================================
   ClueAtlas Studio — Phase 1 Local Prototype
   Single-file, zero-dependency, offline vanilla-JS implementation.
   No backend, no accounts. The canvas is a view over one canonical JSON
   "hunt model" (schema v0). Export/import/preview all read that same model.
   ========================================================================= */

(function () {
"use strict";

/* ---------------------------------------------------------------------
   Engine — the hunt schema, validation, style-pack renderer and player
   interpreter now live in engine.js (loaded before this file — see
   index.html), so Studio's canvas/inspector/library code and the
   standalone Player app both run the exact same interpreter. Studio
   never re-implements any of this; it only ever calls into PAEngine.
--------------------------------------------------------------------- */
var PAEngine = window.PAEngine;

var SCHEMA_VERSION = PAEngine.SCHEMA_VERSION;
var FAMILIES = PAEngine.FAMILIES;
var NODE_TYPES = PAEngine.NODE_TYPES;
var CONDITION_TYPES = PAEngine.CONDITION_TYPES;
var EFFECT_TYPES = PAEngine.EFFECT_TYPES;
var IMAGE_ASPECT_RATIOS = PAEngine.IMAGE_ASPECT_RATIOS;
var IMAGE_FRAME_STYLES = PAEngine.IMAGE_FRAME_STYLES;
var LOCK_STYLES = PAEngine.LOCK_STYLES;
var renderImageRevealBlock = PAEngine.renderImageRevealBlock;

var STYLE_PACK_SCHEMA_VERSION = PAEngine.STYLE_PACK_SCHEMA_VERSION;
var STYLE_PACKS = PAEngine.STYLE_PACKS;
var DEFAULT_STYLE_PACK_ID = PAEngine.DEFAULT_STYLE_PACK_ID;
var BUILTIN_STYLE_PACK_IDS = PAEngine.BUILTIN_STYLE_PACK_IDS;
var getStylePack = PAEngine.getStylePack;
var styleFieldsPresent = PAEngine.styleFieldsPresent;
var applyStylePack = PAEngine.applyStylePack;

var uid = PAEngine.uid;
var clone = PAEngine.clone;
var esc = PAEngine.esc;
var familyOf = PAEngine.familyOf;
var nodeTitle = PAEngine.nodeTitle;
var varName = PAEngine.varName;
var itemName = PAEngine.itemName;
var previousConnectingNode = PAEngine.previousConnectingNode;

var collectConditionRefs = PAEngine.collectConditionRefs;
var validateHunt = PAEngine.validateHunt;

var AUTO_TYPES = PAEngine.AUTO_TYPES;
var isAutoType = PAEngine.isAutoType;
var evaluateCondition = PAEngine.evaluateCondition;
var applyEffect = PAEngine.applyEffect;
var isConnectionAllowed = PAEngine.isConnectionAllowed;
var convergenceSatisfied = PAEngine.convergenceSatisfied;
var completeNodeInternal = PAEngine.completeNodeInternal;
var recompute = PAEngine.recompute;
var createSession = PAEngine.createSession;
var normalizeAnswer = PAEngine.normalizeAnswer;
var pv_action_continueScene = PAEngine.pv_action_continueScene;
var pv_action_selectChoice = PAEngine.pv_action_selectChoice;
var pv_action_submitAnswer = PAEngine.pv_action_submitAnswer;
var pv_action_submitOrdering = PAEngine.pv_action_submitOrdering;
var pv_action_submitMatching = PAEngine.pv_action_submitMatching;
var pv_action_revealHint = PAEngine.pv_action_revealHint;

var PLAYER_SCREEN_TYPES = PAEngine.PLAYER_SCREEN_TYPES;
var DEFAULT_BUTTON_LABEL = PAEngine.DEFAULT_BUTTON_LABEL;
var BUTTON_LABEL_TYPES = PAEngine.BUTTON_LABEL_TYPES;
var openLeadNodes = PAEngine.openLeadNodes;
var hintsForNode = PAEngine.hintsForNode;
var laneOptionsForScene = PAEngine.laneOptionsForScene;
var renderPreviewNode = PAEngine.renderPreviewNode;
var wirePreviewNodeInteractions = PAEngine.wirePreviewNodeInteractions;
var renderPinnedNode = PAEngine.renderPinnedNode;
var createPreviewController = PAEngine.createPreviewController;

/* ---------------------------------------------------------------------
   Utilities (Studio-only — canvas geometry, toasts, file download)
--------------------------------------------------------------------- */
function snap(v, size) { return Math.round(v / size) * size; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
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

// Downscales/recompresses an uploaded image file via canvas before it's
// stored as a data URI on the hunt, so a multi-megabyte phone photo doesn't
// blow past the browser's ~5-10MB localStorage quota — which otherwise
// breaks Save with no visible error (see persistLibrary below). Used by
// every "upload an image and stash it as a data URI" field (Image Reveal's
// own image, Background media). Skips anything that isn't a plain static
// raster image — GIFs and videos are passed through untouched so animation/
// playback survive — and falls back to the untouched original if decoding
// or canvas export fails for any reason (e.g. an unsupported format).
function readImageFileCompressed(file, cb) {
  var MAX_DIM = 1600, QUALITY = 0.82;
  if (!file || !/^image\//.test(file.type) || file.type === "image/gif") {
    var rawReader = new FileReader();
    rawReader.onload = function () { cb(rawReader.result); };
    rawReader.onerror = function () { cb(null); };
    rawReader.readAsDataURL(file);
    return;
  }
  var reader = new FileReader();
  reader.onload = function () {
    var img = new Image();
    img.onload = function () {
      try {
        var scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
        var cw = Math.max(1, Math.round(img.width * scale));
        var ch = Math.max(1, Math.round(img.height * scale));
        var canvas = document.createElement("canvas");
        canvas.width = cw; canvas.height = ch;
        canvas.getContext("2d").drawImage(img, 0, 0, cw, ch);
        var outType = file.type === "image/png" ? "image/png" : "image/jpeg";
        cb(canvas.toDataURL(outType, QUALITY));
      } catch (e) {
        cb(reader.result);
      }
    };
    img.onerror = function () { cb(reader.result); };
    img.src = reader.result;
  };
  reader.onerror = function () { cb(null); };
  reader.readAsDataURL(file);
}

/* ---------------------------------------------------------------------
   Style pack import (Studio-only authoring flow). The style pack schema
   itself, the built-in packs, and applyStylePack() all now live in
   engine.js — see the destructured references above.
--------------------------------------------------------------------- */
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
    scenes: [{ id: uid("scene"), title: "Scene 1" }],
    // Manual size overrides for the lane×scene grid — see computeLayout().
    // Undefined/missing means "auto-fit to content" for that lane/column;
    // a stored number can only ever push a lane taller or a column wider
    // than its auto-fit size, never smaller (dragging the handle back down
    // just clears the override once it reaches the content-fit floor).
    laneHeights: {},
    unassignedColWidth: undefined,
    stylePack: getStylePack(DEFAULT_STYLE_PACK_ID)
  };
}

function newNode(type, x, y, lane, sceneId) {
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
    effects: [],
    lane: lane || SUGGESTED_LANE[type] || "story",
    sceneId: sceneId !== undefined ? sceneId : null,
    buttonLabel: "", // overrides DEFAULT_BUTTON_LABEL[type] when set — see buildCompletionEditor
    completionOverride: { enabled: false, condition: { type: "always" } } // replaces the node's built-in completion trigger with a condition when enabled — see nodeCompletionOk in engine.js
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
    migrateHuntForLanes(hunt);
    this.hunt = hunt;
    this.selection = { type: null, id: null };
    this.multiSelectNodeIds = [];
    this.history = [clone(hunt)];
    this.future = [];
    render();
  },

  addNode: function (type, x, y, lane, sceneId) {
    var n = newNode(type, x, y, lane, sceneId);
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
   Validation engine (collectConditionRefs, validateHunt) now lives in
   engine.js — see the destructured references above.
--------------------------------------------------------------------- */

/* ---------------------------------------------------------------------
   Canvas geometry + rendering
--------------------------------------------------------------------- */
var NODE_W = 220, NODE_H = 100, EDGE_OFFSET = 5000, GRID = 20;
var NODE_MIN_W = 160, NODE_MIN_H = 64, NODE_MAX_W = 560, NODE_MAX_H = 480;

/* ---------------------------------------------------------------------
   Player-app lanes — the canvas is organized as 5 fixed horizontal lanes
   that mirror the Player app's bottom tab bar (Story / Leads / Map /
   Inventory / Hints), crossed by creator-defined vertical "Scene"
   columns. A node's lane + sceneId together pick its cell in this grid;
   computeLayout() (below) turns that into actual pixel position.
--------------------------------------------------------------------- */
// Player tab bar icons — plain single-color line drawings (stroke:
// currentColor, no fill) so they pick up whatever color the tab bar CSS
// gives them, including the active style pack's accent color.
var LANE_TAB_SVG = {
  story: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-1.8-1.3-4.2-2-7-2-1 0-2 .1-3 .3v13.7c1-.2 2-.3 3-.3 2.8 0 5.2.7 7 2 1.8-1.3 4.2-2 7-2 1 0 2 .1 3 .3V4.3c-1-.2-2-.3-3-.3-2.8 0-5.2.7-7 2Z"/><path d="M12 6v14"/></svg>',
  leads: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l1.5 1.5L8 5.5"/><path d="M11 6h9"/><path d="M4 12.5l1.5 1.5L8 11.5"/><path d="M11 12h9"/><path d="M4 18.5l1.5 1.5L8 17.5"/><path d="M11 18h9"/></svg>',
  map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-7.2 7-12a7 7 0 1 0-14 0c0 4.8 7 12 7 12Z"/><circle cx="12" cy="9" r="2.4"/></svg>',
  inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="11" rx="2"/><path d="M8 8V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M3 13h18"/></svg>',
  hints: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 21h4"/><path d="M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 .8 1.1 1.6l.1.5h4.6l.1-.5c.1-.8.5-1.2 1.1-1.6A6 6 0 0 0 12 3Z"/></svg>'
};
var LANES = [
  { id: "story",     label: "Story",     icon: LANE_TAB_SVG.story },
  { id: "leads",     label: "Leads",     icon: LANE_TAB_SVG.leads },
  { id: "map",       label: "Map",       icon: LANE_TAB_SVG.map },
  { id: "inventory", label: "Inventory", icon: LANE_TAB_SVG.inventory },
  { id: "hints",     label: "Hints",     icon: LANE_TAB_SVG.hints }
];
var LANE_INDEX = {}, LANE_BY_ID = {};
LANES.forEach(function (l, i) { LANE_INDEX[l.id] = i; LANE_BY_ID[l.id] = l; });

// A connection's "kind" is never stored on the connection itself — it's
// derived live from whichever lane its target node currently sits in.
// This keeps arrow semantics automatic and always in sync: dragging a
// node into a different lane instantly reclassifies (and recolours)
// every arrow pointing at it, with no separate field to fall out of date.
var CONNECTION_KIND_LABELS = {
  story: "Advance Story",
  leads: "Open Lead",
  inventory: "Grant Item",
  hints: "Reveal Hint",
  map: "Map Update"
};
function connectionLaneId(c) {
  var t = Store.getNode(c.targetId);
  return t ? t.lane : null;
}
function connectionKindLabel(laneId) {
  return CONNECTION_KIND_LABELS[laneId] || "Connection";
}

// The lane each node type is normally authored into. Dragging a node into
// a different lane is allowed (lane is a manual, per-node placement) but
// is flagged as a soft validation warning — see studioIssues().
var SUGGESTED_LANE = {
  scene: "story", ending: "story", storyBlock: "story",
  choice: "leads", answerEntry: "leads", ordering: "leads", matching: "leads", branch: "leads", convergence: "leads",
  locationPlaceholder: "map",
  awardItem: "inventory", score: "inventory", setVariable: "inventory",
  hint: "hints",
  // Node Type Expansion additions (see docs) — puzzle-family and
  // puzzle-like control-family types default alongside the existing
  // puzzles in Leads; state-family goes to Inventory; the new Support
  // type goes to Hints, same as the existing Hint node.
  cipher: "leads", mathLogic: "leads", anagram: "leads", sequencePattern: "leads", slidingTile: "leads",
  multiPartAnswer: "leads", physicalLockCode: "leads", cryptexLock: "leads", crossReferenceLookup: "leads",
  gate: "leads", randomizer: "leads", teamSplitMerge: "leads", metaPuzzleCombine: "leads",
  timer: "leads", attemptLimiter: "leads",
  combineCraftItem: "inventory", trade: "inventory",
  hintUnlockCost: "hints",
  // Media nodes are content reveals like Scene, so they default to Story;
  // Map Display is the one exception since it's literally a map.
  imageReveal: "story", audioReveal: "story", videoReveal: "story", documentReveal: "story", gallery: "story",
  mapDisplay: "map",
  // Real-world input nodes are Location Placeholder's siblings, so they
  // default to the same Map lane.
  photoUploadVerification: "map", geolocationCheckIn: "map", qrNfcScan: "map", gameMasterCheckIn: "map"
};

// Grid geometry. Lanes and scene columns are contiguous (no gap) and
// divided only by a border line; each lane's height and each column's
// width grow to fit whatever it currently contains.
var SCENE_HEADER_H = 40, LANE_H_BASE = 140, COL_W_BASE = 260;
var CELL_PAD_TOP = 14, CELL_PAD_SIDE = 14, STACK_GAP = 14;
var lastLayout = null; // populated by computeLayout(), consulted by drag/drop-target logic

// A node's on-canvas size, falling back to the default for nodes created
// before per-card resizing existed (demo/broken fixtures, older saves).
function nodeSize(node) {
  return {
    w: (node.size && node.size.w) || NODE_W,
    h: (node.size && node.size.h) || NODE_H
  };
}

function nodeCenter(node) {
  var sz = nodeSize(node);
  return { x: node.position.x + sz.w / 2, y: node.position.y + sz.h / 2 };
}

// Finds where the segment from a node's center toward (toX,toY) crosses the
// node's rectangular boundary, and which side that crossing is on. This lets
// a connection leave/enter a node from whichever side faces the other end
// (top, bottom, left, or right) instead of always using fixed left/right ports.
function edgeAnchor(node, toX, toY) {
  var sz = nodeSize(node);
  var c = nodeCenter(node);
  var dx = toX - c.x, dy = toY - c.y;
  var halfW = sz.w / 2, halfH = sz.h / 2;
  if (dx === 0 && dy === 0) return { x: c.x + halfW, y: c.y, side: "right" };
  var tX = dx !== 0 ? halfW / Math.abs(dx) : Infinity;
  var tY = dy !== 0 ? halfH / Math.abs(dy) : Infinity;
  var t = Math.min(tX, tY);
  var side = t === tX ? (dx > 0 ? "right" : "left") : (dy > 0 ? "bottom" : "top");
  return { x: c.x + dx * t, y: c.y + dy * t, side: side };
}

// Pushes a bezier control point outward from an anchor point, away from the
// node, in the direction implied by which side the anchor sits on.
function controlPoint(p, side, mag) {
  if (side === "left") return { x: p.x - mag, y: p.y };
  if (side === "bottom") return { x: p.x, y: p.y + mag };
  if (side === "top") return { x: p.x, y: p.y - mag };
  return { x: p.x + mag, y: p.y }; // "right" and fallback
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

/* ---------------------------------------------------------------------
   Lane x Scene grid — layout, rendering and scene-column management.

   The grid is the canonical arrangement of the canvas: 5 fixed lanes
   (rows) crossed by creator-defined Scene columns. Every node belongs to
   exactly one (lane, sceneId) cell, and computeLayout() recomputes each
   node's position.x/position.y from that cell on every render, growing
   the lane's height / the column's width to fit whatever it contains.
   Within a cell, a node either free-floats at its own dragged spot
   (n.cellPos, clamped to the cell) or, lacking one, auto-stacks
   top-to-bottom with its cellmates — see computeLayout()'s placement
   loop and wireGridInteractions()'s "move" mouseup handler, below. This
   keeps position.x/position.y valid for all the existing edge/port/
   marquee/resize code, which never needs to know the grid exists.
--------------------------------------------------------------------- */
function getColumns() {
  var scenes = Store.hunt.scenes || [];
  return [{ id: null, title: "Unassigned", unassigned: true, width: Store.hunt.unassignedColWidth }].concat(scenes);
}

// Stable ordering for the nodes stacked in one lane×scene cell: nodes
// connected to each other by a connection whose source AND target both
// land in this same cell stack in source-before-target order; a node with
// no such connection keeps its original relative position (from
// hunt.nodes array order) rather than being pushed to the end. This is a
// plain stable topological sort (Kahn's algorithm, always breaking ties by
// earliest original index among the currently-ready nodes) — any cycle
// among in-cell connections just falls back to original order for
// whatever's left, so a mistaken loop can never hang layout.
function orderByConnections(nodes, connections) {
  if (nodes.length < 2) return nodes;
  var indexOf = {};
  nodes.forEach(function (n, i) { indexOf[n.id] = i; });
  var indeg = nodes.map(function () { return 0; });
  var dependents = nodes.map(function () { return []; });
  connections.forEach(function (c) {
    var si = indexOf[c.sourceId], ti = indexOf[c.targetId];
    if (si === undefined || ti === undefined || si === ti) return;
    dependents[si].push(ti);
    indeg[ti]++;
  });
  var used = nodes.map(function () { return false; });
  var result = [];
  for (var remaining = nodes.length; remaining > 0; remaining--) {
    var pick = -1;
    for (var i = 0; i < nodes.length; i++) {
      if (!used[i] && indeg[i] === 0) { pick = i; break; }
    }
    if (pick === -1) { // cycle — bail out, keep whatever's left in original order
      for (var j = 0; j < nodes.length; j++) if (!used[j]) result.push(nodes[j]);
      break;
    }
    used[pick] = true;
    result.push(nodes[pick]);
    dependents[pick].forEach(function (ti) { indeg[ti]--; });
  }
  return result;
}

function computeLayout() {
  var hunt = Store.hunt;
  var columns = getColumns();
  var colOf = {};
  columns.forEach(function (c, i) { colOf[c.id === null ? "__u__" : c.id] = i; });

  // Bucket nodes into [laneIdx][colIdx], preserving hunt.nodes array order
  // as the fallback stacking order within a cell.
  var buckets = LANES.map(function () { return columns.map(function () { return []; }); });
  hunt.nodes.forEach(function (n) {
    if (!n.lane || LANE_INDEX[n.lane] === undefined) n.lane = SUGGESTED_LANE[n.type] || "story";
    var li = LANE_INDEX[n.lane];
    var key = n.sceneId === null || n.sceneId === undefined ? "__u__" : n.sceneId;
    var ci = colOf[key];
    if (ci === undefined) { n.sceneId = null; ci = 0; } // scene was deleted elsewhere — fall back to Unassigned
    buckets[li][ci].push(n);
  });

  // Within each cell, let connections between cellmates set the stacking
  // order (see orderByConnections() above) instead of leaving it as
  // whatever order hunt.nodes happens to be in.
  LANES.forEach(function (l, li) {
    columns.forEach(function (_, ci) {
      buckets[li][ci] = orderByConnections(buckets[li][ci], hunt.connections);
    });
  });

  // Column widths: wide enough for the widest node currently placed in it,
  // or the creator's manually-dragged width if that's wider still (a
  // manual override can only grow a column, never shrink it past what its
  // content needs — see wireGridInteractions()'s colResize handling).
  var colWidths = columns.map(function (col, ci) {
    var w = COL_W_BASE;
    LANES.forEach(function (l, li) {
      buckets[li][ci].forEach(function (n) { w = Math.max(w, nodeSize(n).w + CELL_PAD_SIDE * 2); });
    });
    if (col.width && col.width > w) w = col.width;
    return w;
  });
  var colX = [], run = 0;
  columns.forEach(function (_, ci) { colX[ci] = run; run += colWidths[ci]; });

  // Lane heights: tall enough to stack every node in that lane's fullest
  // column, or the creator's manually-dragged height if taller — same
  // grow-only rule as column widths, above.
  var laneHeights = LANES.map(function (l, li) {
    var h = LANE_H_BASE;
    columns.forEach(function (_, ci) {
      var cell = buckets[li][ci];
      if (!cell.length) return;
      var stackH = CELL_PAD_TOP * 2 + cell.reduce(function (sum, n) { return sum + nodeSize(n).h; }, 0) + STACK_GAP * (cell.length - 1);
      h = Math.max(h, stackH);
    });
    var manual = hunt.laneHeights && hunt.laneHeights[l.id];
    if (manual && manual > h) h = manual;
    return h;
  });
  var laneY = [], runY = SCENE_HEADER_H;
  LANES.forEach(function (l, li) { laneY[li] = runY; runY += laneHeights[li]; });

  // Place every node: left-aligned in its column, stacked top-down in its
  // cell — UNLESS the creator has freely dragged it somewhere else within
  // that same cell (n.cellPos, set on drop — see the "move" drag handler
  // in wireGridInteractions()'s mouseup below). A node keeps that manual
  // spot, clamped to stay inside its lane×scene cell, instead of being
  // snapped back into the rigid stack on every render; a node with no
  // cellPos yet (freshly created, or never dragged) still auto-stacks as
  // before. Crossing into a different cell just re-clamps the same
  // cellPos into the new cell's bounds — see the mouseup handler, which
  // recomputes cellPos relative to whichever cell the node was dropped in.
  LANES.forEach(function (l, li) {
    columns.forEach(function (_, ci) {
      var y = laneY[li] + CELL_PAD_TOP;
      buckets[li][ci].forEach(function (n) {
        var sz = nodeSize(n);
        if (n.cellPos) {
          n.position.x = colX[ci] + clamp(n.cellPos.x, 0, Math.max(0, colWidths[ci] - sz.w));
          n.position.y = laneY[li] + clamp(n.cellPos.y, 0, Math.max(0, laneHeights[li] - sz.h));
        } else {
          n.position.x = colX[ci] + CELL_PAD_SIDE;
          n.position.y = y;
        }
        y += sz.h + STACK_GAP;
      });
    });
  });

  lastLayout = { columns: columns, colX: colX, colWidths: colWidths, laneY: laneY, laneHeights: laneHeights,
    totalWidth: run, totalHeight: runY };
  return lastLayout;
}

function laneIndexForWorldY(y) {
  var L = lastLayout || computeLayout();
  for (var i = 0; i < LANES.length; i++) {
    if (y < L.laneY[i] + L.laneHeights[i] || i === LANES.length - 1) return i;
  }
  return LANES.length - 1;
}
function colIndexForWorldX(x) {
  var L = lastLayout || computeLayout();
  for (var i = 0; i < L.columns.length; i++) {
    if (x < L.colX[i] + L.colWidths[i] || i === L.columns.length - 1) return i;
  }
  return L.columns.length - 1;
}

function renderGrid() {
  var L = lastLayout || computeLayout();
  var layer = dom.gridLayer;
  layer.innerHTML = "";

  LANES.forEach(function (l, li) {
    var band = document.createElement("div");
    band.className = "lane-band";
    band.style.top = L.laneY[li] + "px";
    band.style.height = L.laneHeights[li] + "px";
    band.style.width = L.totalWidth + "px";
    band.style.background = "var(--lane-" + l.id + "-bg)";
    layer.appendChild(band);

    var label = document.createElement("div");
    label.className = "lane-label";
    label.style.top = L.laneY[li] + "px";
    label.style.height = L.laneHeights[li] + "px";
    label.innerHTML = '<span style="background:var(--lane-' + l.id + ')">' + esc(l.label) + '</span>';
    layer.appendChild(label);

    // Drag this lane's bottom edge to grow/shrink it — see the
    // "laneResize" drag kind in initCanvasInteraction(). Sits centered on
    // the border, well clear of any node's edge (CELL_PAD_TOP on both
    // sides of the border), so it never fights node dragging.
    var laneHandle = document.createElement("div");
    laneHandle.className = "lane-resize-handle";
    laneHandle.dataset.laneId = l.id;
    laneHandle.title = "Drag to resize lane · double-click to reset";
    laneHandle.style.top = (L.laneY[li] + L.laneHeights[li] - 4) + "px";
    laneHandle.style.width = L.totalWidth + "px";
    layer.appendChild(laneHandle);
  });

  L.columns.forEach(function (col, ci) {
    var colDiv = document.createElement("div");
    colDiv.className = "scene-col" + (col.unassigned ? " unassigned" : "");
    colDiv.style.left = L.colX[ci] + "px";
    colDiv.style.width = L.colWidths[ci] + "px";
    colDiv.style.height = L.totalHeight + "px";
    layer.appendChild(colDiv);

    var header = document.createElement("div");
    header.className = "scene-header" + (col.unassigned ? " unassigned" : "");
    header.style.left = L.colX[ci] + "px";
    header.style.width = L.colWidths[ci] + "px";
    if (col.unassigned) {
      header.innerHTML = '<span class="scene-title-text">Unassigned</span>';
    } else {
      header.innerHTML =
        '<button class="scene-hdr-btn scene-move-left" data-scene-id="' + col.id + '" title="Move left"' + (ci === 1 ? " disabled" : "") + '>◀</button>' +
        '<input type="text" class="scene-title-input" data-scene-id="' + col.id + '" value="' + esc(col.title) + '" />' +
        '<button class="scene-hdr-btn scene-move-right" data-scene-id="' + col.id + '" title="Move right"' + (ci === L.columns.length - 1 ? " disabled" : "") + '>▶</button>' +
        '<button class="scene-hdr-btn scene-delete" data-scene-id="' + col.id + '" title="Delete scene">🗑</button>';
    }
    layer.appendChild(header);

    // Drag this column's right edge to grow/shrink it — see the
    // "colResize" drag kind in initCanvasInteraction(). Same clearance
    // logic as the lane handle above, but along CELL_PAD_SIDE. Starts
    // below the header row so it never sits on top of the header's
    // move/delete buttons, which live right at that same right edge.
    var colHandle = document.createElement("div");
    colHandle.className = "scene-resize-handle";
    colHandle.dataset.colKey = col.unassigned ? "__u__" : col.id;
    colHandle.title = "Drag to resize column · double-click to reset";
    colHandle.style.left = (L.colX[ci] + L.colWidths[ci] - 4) + "px";
    colHandle.style.top = SCENE_HEADER_H + "px";
    colHandle.style.height = (L.totalHeight - SCENE_HEADER_H) + "px";
    layer.appendChild(colHandle);
  });

  var addBtn = document.createElement("button");
  addBtn.className = "btn small scene-add-btn";
  addBtn.textContent = "＋ Scene";
  addBtn.style.left = (L.colX[L.columns.length - 1] + L.colWidths[L.columns.length - 1] + 10) + "px";
  addBtn.onclick = function () { addScene(); };
  layer.appendChild(addBtn);

  wireGridInteractions();
}

function wireGridInteractions() {
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".scene-title-input"), function (inp) {
    inp.oninput = function (e) { renameScene(inp.dataset.sceneId, e.target.value); };
    inp.onblur = function () { Store.pushHistory(); };
  });
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".scene-move-left"), function (btn) {
    btn.onclick = function () { moveScene(btn.dataset.sceneId, -1); };
  });
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".scene-move-right"), function (btn) {
    btn.onclick = function () { moveScene(btn.dataset.sceneId, 1); };
  });
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".scene-delete"), function (btn) {
    btn.onclick = function () { deleteScene(btn.dataset.sceneId); };
  });
}

function highlightDropTarget(worldX, worldY) {
  var li = laneIndexForWorldY(worldY), ci = colIndexForWorldX(worldX);
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".lane-band"), function (el, i) { el.classList.toggle("drop-target", i === li); });
  Array.prototype.forEach.call(dom.gridLayer.querySelectorAll(".scene-col"), function (el, i) { el.classList.toggle("drop-target", i === ci); });
}

function addScene() {
  Store.hunt.scenes = Store.hunt.scenes || [];
  Store.hunt.scenes.push({ id: uid("scene"), title: "Scene " + (Store.hunt.scenes.length + 1) });
  Store.pushHistory();
  render();
}
function renameScene(id, title) {
  // No re-render here: the scene header lives inside #gridLayer, which a
  // render rebuilds from scratch — doing that on every keystroke would
  // yank focus out of the input the creator is still typing into. The
  // input already shows what they typed; onblur (below) persists it.
  var s = (Store.hunt.scenes || []).find(function (x) { return x.id === id; });
  if (s) s.title = title;
}
function moveScene(id, dir) {
  var arr = Store.hunt.scenes;
  var idx = arr.findIndex(function (s) { return s.id === id; });
  var swapIdx = idx + dir;
  if (idx < 0 || swapIdx < 0 || swapIdx >= arr.length) return;
  var tmp = arr[idx]; arr[idx] = arr[swapIdx]; arr[swapIdx] = tmp;
  Store.pushHistory();
  render();
}
function deleteScene(id) {
  var s = (Store.hunt.scenes || []).find(function (x) { return x.id === id; });
  if (!s) return;
  if (!confirm('Delete scene "' + s.title + '"? Its nodes will move to Unassigned.')) return;
  Store.hunt.nodes.forEach(function (n) { if (n.sceneId === id) n.sceneId = null; });
  Store.hunt.scenes = Store.hunt.scenes.filter(function (x) { return x.id !== id; });
  Store.pushHistory();
  render();
}

// Studio-only lane-mismatch notices, merged with the shared engine
// validation for the badge count and the validation drawer.
function studioIssues(hunt) {
  var issues = [];
  hunt.nodes.forEach(function (n) {
    var suggested = SUGGESTED_LANE[n.type];
    if (suggested && n.lane && n.lane !== suggested) {
      issues.push({
        level: "warning",
        title: "Lane placement",
        detail: '"' + n.title + '" is in the ' + LANE_BY_ID[n.lane].label + ' lane, but ' + NODE_TYPES[n.type].label + ' nodes are usually placed in ' + LANE_BY_ID[suggested].label + '.',
        nodeId: n.id
      });
    }
    if (n.type === "storyBlock") {
      (n.content.buttons || []).forEach(function (b) {
        if (b.kind !== "back" && !b.connectionId) {
          issues.push({
            level: "warning",
            title: "Unassigned Story Block button",
            detail: '"' + n.title + '" has a button ("' + (b.label || "Continue") + '") that isn\'t assigned to a connection yet — it won\'t lead anywhere.',
            nodeId: n.id
          });
        }
      });
    }
  });
  return issues;
}
function allIssues(hunt) {
  return validateHunt(hunt).concat(studioIssues(hunt));
}

// Bring a hunt saved/imported before the lane+scene grid existed up to
// date: assign every node a lane (from its type) and cluster nodes that
// shared roughly the same x position into inferred Scene columns, so
// older hunts open already organized instead of dumped into Unassigned.
function migrateHuntForLanes(hunt) {
  if (!hunt.scenes) hunt.scenes = [];
  if (!hunt.laneHeights) hunt.laneHeights = {}; // older saves predate manual lane/column sizing
  // Backfill fields from the completion-condition/button-label feature —
  // independent of the lane migration below (a hunt may already have
  // `lane` but predate these), so this always runs, not just when
  // needsMigration is true.
  hunt.nodes.forEach(function (n) {
    if (n.buttonLabel === undefined) n.buttonLabel = "";
    if (!n.completionOverride) n.completionOverride = { enabled: false, condition: { type: "always" } };
  });
  var needsMigration = hunt.nodes.some(function (n) { return !n.lane; });
  if (!needsMigration) return hunt;

  var THRESH = 150;
  var byX = hunt.nodes.map(function (n) { return { n: n, x: (n.position && n.position.x) || 0 }; })
    .sort(function (a, b) { return a.x - b.x; });
  var clusters = [];
  byX.forEach(function (item) {
    var last = clusters[clusters.length - 1];
    if (last && Math.abs(item.x - last.x0) <= THRESH) last.nodeIds.push(item.n.id);
    else clusters.push({ x0: item.x, nodeIds: [item.n.id] });
  });

  if (clusters.length > 1 || hunt.scenes.length === 0) {
    var scenes = clusters.map(function (cl, i) { return { id: uid("scene"), title: "Scene " + (i + 1), nodeIds: cl.nodeIds }; });
    hunt.scenes = scenes.map(function (s) { return { id: s.id, title: s.title }; });
    scenes.forEach(function (s) {
      s.nodeIds.forEach(function (nid) {
        var n = hunt.nodes.find(function (x) { return x.id === nid; });
        if (n && n.sceneId === undefined) n.sceneId = s.id;
      });
    });
  }
  hunt.nodes.forEach(function (n) {
    if (!n.lane) n.lane = SUGGESTED_LANE[n.type] || "story";
    if (n.sceneId === undefined) n.sceneId = null;
  });
  return hunt;
}

function renderNodes() {
  computeLayout();
  renderGrid();
  dom.nodeLayer.innerHTML = "";
  Store.hunt.nodes.forEach(function (n) {
    var def = NODE_TYPES[n.type];
    var div = document.createElement("div");
    var selected = Store.multiSelectNodeIds.indexOf(n.id) !== -1;
    var mismatch = SUGGESTED_LANE[n.type] && n.lane && n.lane !== SUGGESTED_LANE[n.type];
    div.className = "node fam-" + def.family + (selected ? " selected" : "") + (mismatch ? " lane-mismatch" : "");
    div.dataset.nodeId = n.id;
    div.style.left = n.position.x + "px";
    div.style.top = n.position.y + "px";
    var sz = nodeSize(n);
    div.style.width = sz.w + "px";
    div.style.height = sz.h + "px";
    var isEntry = Store.hunt.entryPointIds.indexOf(n.id) !== -1;
    div.innerHTML =
      '<div class="node-head">' + nodeIconSpan(n.type) +
        '<span class="node-type">' + def.icon + " " + esc(def.label) + (isEntry ? " · ENTRY" : "") + '</span>' +
        (mismatch ? '<span class="node-lane-warn" title="Usually placed in the ' + esc(LANE_BY_ID[SUGGESTED_LANE[n.type]].label) + ' lane">⚠</span>' : '') +
      '</div>' +
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
  var issues = allIssues(Store.hunt);
  var badIds = {};
  issues.forEach(function (i) { if (i.title === "Unreachable node" && i.nodeId) badIds[i.nodeId] = true; });
  Array.prototype.forEach.call(dom.nodeLayer.children, function (el) {
    if (badIds[el.dataset.nodeId]) el.classList.add("unreachable"); else el.classList.remove("unreachable");
  });
  renderValidationBadge(issues);
}

function edgePathD(p1, p2, side1, side2) {
  var mag = Math.max(50, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.5);
  var c1 = controlPoint(p1, side1 || "right", mag);
  var c2 = controlPoint(p2, side2 || "left", mag);
  return "M " + p1.x + " " + p1.y + " C " + c1.x + " " + c1.y + ", " + c2.x + " " + c2.y + ", " + p2.x + " " + p2.y;
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
    var laneId = t.lane;
    var laneClass = laneId ? " lane-" + laneId : "";
    var sCenter = nodeCenter(s), tCenter = nodeCenter(t);
    var p1 = edgeAnchor(s, tCenter.x, tCenter.y), p2 = edgeAnchor(t, sCenter.x, sCenter.y);
    p1.x += EDGE_OFFSET; p1.y += EDGE_OFFSET; p2.x += EDGE_OFFSET; p2.y += EDGE_OFFSET;
    var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
    var mag = Math.max(50, Math.hypot(p2.x - p1.x, p2.y - p1.y) * 0.5);
    var c2 = controlPoint(p2, p2.side, mag);
    var d = edgePathD(p1, p2, p1.side, p2.side);
    var hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
    hit.setAttribute("d", d); hit.setAttribute("class", "edge-hit"); hit.dataset.edgeId = c.id;
    var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    path.setAttribute("class", "edge-path" + laneClass + (Store.selection.type === "edge" && Store.selection.id === c.id ? " selected" : ""));
    path.dataset.edgeId = c.id;
    var midX = (p1.x + p2.x) / 2, midY = (p1.y + p2.y) / 2;
    var label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("x", midX); label.setAttribute("y", midY - 6);
    label.setAttribute("text-anchor", "middle");
    label.setAttribute("class", "edge-label");
    // Kind (Advance Story / Open Lead / Grant Item / Reveal Hint / Map
    // Update) is always shown first since it's derived automatically from
    // the target's lane; the creator's own label and any real condition
    // (anything other than "always") are appended for extra detail.
    var lbl = connectionKindLabel(laneId) +
      (c.label ? " — " + c.label : "") +
      (c.condition && c.condition.type !== "always" ? " · " + conditionSummary(c.condition, Store.hunt) : "");
    label.textContent = lbl;
    // arrowhead — angled along the curve's approach direction (c2 -> p2) so it
    // points correctly regardless of which side of the target it enters from
    var angle = Math.atan2(p2.y - c2.y, p2.x - c2.x);
    var ax = p2.x - 9 * Math.cos(angle), ay = p2.y - 9 * Math.sin(angle);
    var arrow = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    var a1 = [ax + 6 * Math.cos(angle + 2.5), ay + 6 * Math.sin(angle + 2.5)];
    var a2 = [ax + 6 * Math.cos(angle - 2.5), ay + 6 * Math.sin(angle - 2.5)];
    arrow.setAttribute("points", p2.x + "," + p2.y + " " + a1[0] + "," + a1[1] + " " + a2[0] + "," + a2[1]);
    arrow.setAttribute("class", "edge-arrow" + laneClass);
    g.appendChild(path); g.appendChild(arrow); g.appendChild(label); g.appendChild(hit);
    svg.appendChild(g);
  });
}

function renderValidationBadge(issues) {
  issues = issues || allIssues(Store.hunt);
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
    var laneHandleEl = e.target.closest(".lane-resize-handle");
    var colHandleEl = e.target.closest(".scene-resize-handle");

    if (laneHandleEl) {
      var L0 = lastLayout || computeLayout();
      var lhIdx = LANE_INDEX[laneHandleEl.dataset.laneId];
      drag = { kind: "laneResize", laneId: laneHandleEl.dataset.laneId, startClientY: e.clientY, startHeight: L0.laneHeights[lhIdx], resized: false };
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (colHandleEl) {
      var L1 = lastLayout || computeLayout();
      var chKey = colHandleEl.dataset.colKey;
      var chIdx = L1.columns.findIndex(function (c) { return (c.unassigned ? "__u__" : c.id) === chKey; });
      drag = { kind: "colResize", colKey: chKey, startClientX: e.clientX, startWidth: L1.colWidths[chIdx], resized: false };
      e.preventDefault();
      e.stopPropagation();
      return;
    }

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
      // Live drag: move the dragged node(s) directly via their DOM elements
      // and their in-memory position, without calling renderNodes() —
      // renderNodes() runs computeLayout(), which would otherwise
      // re-layout the node back into its *current* lane/scene cell every
      // frame. The lane/scene reassignment happens once, on mouseup below
      // (which also records exactly where it was dropped as n.cellPos —
      // see computeLayout()), then a normal render() lays everything out.
      // No grid-snap here: a node moves freely, unsnapped, pixel-for-pixel
      // with the pointer, as long as it stays within a Lane and Scene —
      // it's only reassigned to a different cell if actually dropped in
      // one (see mouseup below), never snapped to a position grid.
      var world = screenToWorld(e.clientX, e.clientY);
      var dx = world.x - drag.startWorld.x, dy = world.y - drag.startWorld.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
      var lastN = null;
      Object.keys(drag.starts).forEach(function (nid) {
        var n = Store.getNode(nid);
        if (!n) return;
        var nx = drag.starts[nid].x + dx, ny = drag.starts[nid].y + dy;
        n.position.x = nx; n.position.y = ny;
        var el = dom.nodeLayer.querySelector('[data-node-id="' + nid + '"]');
        if (el) { el.style.left = nx + "px"; el.style.top = ny + "px"; }
        lastN = n;
      });
      if (lastN) {
        var sz = nodeSize(lastN);
        highlightDropTarget(lastN.position.x + sz.w / 2, lastN.position.y + sz.h / 2);
      }
      renderEdges();
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
    } else if (drag.kind === "laneResize") {
      var dyLane = (e.clientY - drag.startClientY) / Store.view.zoom;
      if (Math.abs(dyLane) > 2) drag.resized = true;
      Store.hunt.laneHeights = Store.hunt.laneHeights || {};
      Store.hunt.laneHeights[drag.laneId] = Math.max(40, Math.round(drag.startHeight + dyLane));
      renderNodes(); renderEdges(); // computeLayout() clamps back up to content-fit if this override is too small
    } else if (drag.kind === "colResize") {
      var dxCol = (e.clientX - drag.startClientX) / Store.view.zoom;
      if (Math.abs(dxCol) > 2) drag.resized = true;
      var newW = Math.max(60, Math.round(drag.startWidth + dxCol));
      if (drag.colKey === "__u__") {
        Store.hunt.unassignedColWidth = newW;
      } else {
        var sc = (Store.hunt.scenes || []).find(function (s) { return s.id === drag.colKey; });
        if (sc) sc.width = newW;
      }
      renderNodes(); renderEdges();
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
      if (drag.moved) {
        // Whichever lane row / scene column each dropped node's centre now
        // falls in becomes its new home cell — this membership assignment
        // still happens on every drop (a node always belongs to *some*
        // Lane and Scene). What no longer happens is snapping its pixel
        // position back to a rigid stack slot: cellPos records exactly
        // where it was dropped, relative to that cell's top-left corner,
        // so computeLayout() (see above) renders it right where it was
        // let go, clamped only to stay inside that cell.
        Object.keys(drag.starts).forEach(function (nid) {
          var n = Store.getNode(nid);
          if (!n) return;
          var sz = nodeSize(n);
          var cx = n.position.x + sz.w / 2, cy = n.position.y + sz.h / 2;
          var li = laneIndexForWorldY(cy), ci = colIndexForWorldX(cx);
          n.lane = LANES[li].id;
          var col = lastLayout.columns[ci];
          n.sceneId = col.unassigned ? null : col.id;
          n.cellPos = { x: n.position.x - lastLayout.colX[ci], y: n.position.y - lastLayout.laneY[li] };
        });
        Store.pushHistory();
      }
      renderNodes(); renderEdges(); // clears the live-drag DOM overrides + drop highlight, relayouts into the grid
    } else if (drag.kind === "resize") {
      if (drag.resized) Store.pushHistory();
    } else if (drag.kind === "laneResize" || drag.kind === "colResize") {
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
    var laneHandleEl = e.target.closest(".lane-resize-handle");
    var colHandleEl = e.target.closest(".scene-resize-handle");
    if (laneHandleEl) {
      if (Store.hunt.laneHeights) delete Store.hunt.laneHeights[laneHandleEl.dataset.laneId];
      renderNodes(); renderEdges();
      Store.pushHistory();
      toast("Reset lane to auto height.");
      return;
    }
    if (colHandleEl) {
      var chKey = colHandleEl.dataset.colKey;
      if (chKey === "__u__") delete Store.hunt.unassignedColWidth;
      else {
        var sc = (Store.hunt.scenes || []).find(function (s) { return s.id === chKey; });
        if (sc) delete sc.width;
      }
      renderNodes(); renderEdges();
      Store.pushHistory();
      toast("Reset column to auto width.");
      return;
    }
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
  var cur = drag.cur;
  var hoverNode = hoverNodeEl && Store.getNode(hoverNodeEl.dataset.nodeId);
  var p1 = edgeAnchor(s, cur.x, cur.y);
  // If hovering a candidate target node, snap the endpoint to that node's
  // boundary on whichever side faces the source, same as a committed edge.
  var p2 = hoverNode ? edgeAnchor(hoverNode, p1.x, p1.y) : { x: cur.x, y: cur.y, side: (Math.abs(cur.x - p1.x) >= Math.abs(cur.y - p1.y)) ? (cur.x >= p1.x ? "left" : "right") : (cur.y >= p1.y ? "top" : "bottom") };
  p1.x += EDGE_OFFSET; p1.y += EDGE_OFFSET; p2 = { x: p2.x + EDGE_OFFSET, y: p2.y + EDGE_OFFSET, side: p2.side };
  var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", edgePathD(p1, p2, p1.side, p2.side));
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
// Palette grouping is by node *family* (Narrative/Puzzle/State/Control/
// Support/Media/Real-World Input/Stub) — a different axis from the
// canvas's Story/Leads/Map/Inventory/Hints *lanes* (see LANES above).
// Deliberately not calling this "lane" to avoid colliding with that.
var PALETTE_FAMILY_ORDER = ["narrative", "puzzle", "state", "control", "support", "media", "input", "stub"];
var PALETTE_COLLAPSED = {}; // familyId -> true when collapsed; expanded by default

function renderPalette() {
  var list = document.getElementById("paletteList");
  if (list.dataset.built) return; // static, build once
  list.dataset.built = "1";

  // Group every registered node type by family, preserving declaration order within each family.
  var byFamily = {};
  Object.keys(NODE_TYPES).forEach(function (type) {
    var fam = NODE_TYPES[type].family;
    (byFamily[fam] = byFamily[fam] || []).push(type);
  });

  var families = PALETTE_FAMILY_ORDER.filter(function (f) { return byFamily[f] && byFamily[f].length; });
  // Catch any family not accounted for above so new families never silently disappear from the palette.
  Object.keys(byFamily).forEach(function (f) { if (families.indexOf(f) === -1) families.push(f); });

  list.innerHTML = "";
  families.forEach(function (famId) {
    var types = byFamily[famId];
    var famDef = FAMILIES[famId] || { label: famId };
    var group = document.createElement("div");
    group.className = "palette-group" + (PALETTE_COLLAPSED[famId] ? " collapsed" : "");
    group.dataset.family = famId;

    var header = document.createElement("div");
    header.className = "palette-group-header";
    header.innerHTML = '<span class="palette-group-chevron">▾</span>' +
      '<span class="fam-dot fam-' + famId + '"></span>' +
      '<span class="palette-group-label">' + esc(famDef.label) + '</span>' +
      '<span class="palette-group-count">' + types.length + '</span>';
    header.addEventListener("click", function () {
      PALETTE_COLLAPSED[famId] = !PALETTE_COLLAPSED[famId];
      group.classList.toggle("collapsed", !!PALETTE_COLLAPSED[famId]);
    });
    group.appendChild(header);

    var itemsWrap = document.createElement("div");
    itemsWrap.className = "palette-group-items";
    types.forEach(function (type) {
      var def = NODE_TYPES[type];
      var item = document.createElement("div");
      item.className = "palette-item";
      item.draggable = true;
      item.dataset.type = type;
      item.title = def.label;
      item.innerHTML = '<span>' + def.icon + " " + esc(def.label) + "</span>";
      item.addEventListener("dragstart", function (e) {
        e.dataTransfer.setData("text/plain", type);
        e.dataTransfer.effectAllowed = "copy";
      });
      itemsWrap.appendChild(item);
    });
    group.appendChild(itemsWrap);

    list.appendChild(group);
  });
}

function initPaletteDrop() {
  dom.canvasWrap.addEventListener("dragover", function (e) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
  dom.canvasWrap.addEventListener("drop", function (e) {
    e.preventDefault();
    var type = e.dataTransfer.getData("text/plain");
    if (!NODE_TYPES[type]) return;
    var world = screenToWorld(e.clientX, e.clientY);
    // Where it's dropped picks its starting lane + scene column; the grid
    // lays out the exact pixel position once it's added.
    var li = laneIndexForWorldY(world.y), ci = colIndexForWorldX(world.x);
    var col = lastLayout.columns[ci];
    var n = Store.addNode(type, world.x, world.y, LANES[li].id, col.unassigned ? null : col.id);
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

/* Player-visible text fields (text the player will actually see on the
   real player screen, per engine.js's renderPreviewNode) get a +/- font-
   size control next to the label and auto-grow instead of a fixed-height
   scrollbox. "prop" identifies where the chosen size is stored on the
   node content, e.g. "bodyFontSize"/"promptFontSize", or for dynamic
   sub-items "stage:<id>" (hint stages). engine.js reads these same
   content properties when it renders the player screen, so the buttons
   here control what the player actually sees, not just the editor. */
var PV_FONT_MIN = 10, PV_FONT_MAX = 32, PV_FONT_DEFAULT = 15, PV_FONT_STEP = 1;

// prop also supports three prefixes for button text, each a separate text
// field per option/button (or, for a node's single primary action button,
// stored on the node itself rather than its content):
//   "opt:<id>"  — a Choice node's per-option button label (content.options)
//   "btn:<id>"  — a Story Block's per-button label (content.buttons)
//   "node:<prop>" — a property on the node itself, not its content (e.g.
//                   "node:buttonLabelFontSize" for the Completion section's
//                   single button-label field)
var PV_BTN_FONT_DEFAULT = 13.5; // matches .pv-choice-btn/.pv-option-btn's own CSS default
function pvFontSize(n, prop) {
  var c = n.content;
  if (prop.indexOf("stage:") === 0) {
    var s = (c.stages || []).find(function (x) { return x.id === prop.slice(6); });
    return (s && s.fontSize) || 12;
  }
  if (prop.indexOf("opt:") === 0) {
    var o = (c.options || []).find(function (x) { return x.id === prop.slice(4); });
    return (o && o.fontSize) || PV_BTN_FONT_DEFAULT;
  }
  if (prop.indexOf("btn:") === 0) {
    var b = (c.buttons || []).find(function (x) { return x.id === prop.slice(4); });
    return (b && b.fontSize) || PV_BTN_FONT_DEFAULT;
  }
  if (prop.indexOf("node:") === 0) return n[prop.slice(5)] || PV_BTN_FONT_DEFAULT;
  return c[prop] || PV_FONT_DEFAULT;
}
function setPvFontSize(n, prop, val) {
  var c = n.content;
  if (prop.indexOf("stage:") === 0) {
    var s = (c.stages || []).find(function (x) { return x.id === prop.slice(6); });
    if (s) s.fontSize = val;
    return;
  }
  if (prop.indexOf("opt:") === 0) {
    var o = (c.options || []).find(function (x) { return x.id === prop.slice(4); });
    if (o) o.fontSize = val;
    return;
  }
  if (prop.indexOf("btn:") === 0) {
    var b = (c.buttons || []).find(function (x) { return x.id === prop.slice(4); });
    if (b) b.fontSize = val;
    return;
  }
  if (prop.indexOf("node:") === 0) { n[prop.slice(5)] = val; return; }
  c[prop] = val;
}

function playerTextField(labelText, elId, prop, value, fontSize) {
  fontSize = fontSize || PV_FONT_DEFAULT;
  return '<div class="field">' +
    '<div class="field-label-row"><label>' + esc(labelText) + '</label>' +
      '<div class="fs-controls">' +
        '<button type="button" class="fs-btn" data-fsdec="' + esc(prop) + '" data-fstarget="' + elId + '" title="Decrease font size">−</button>' +
        '<span class="fs-val" data-fsval="' + esc(prop) + '">' + fontSize + 'px</span>' +
        '<button type="button" class="fs-btn" data-fsinc="' + esc(prop) + '" data-fstarget="' + elId + '" title="Increase font size">+</button>' +
      '</div>' +
    '</div>' +
    '<textarea id="' + elId + '" class="autoscale-ta" style="font-size:' + fontSize + 'px">' + esc(value) + '</textarea>' +
  '</div>';
}

// Same idea as playerTextField, but for a single-line button label (a
// plain <input>, not a textarea — button text doesn't wrap/grow the way a
// paragraph box does, so there's no autoscale-ta class here).
function playerButtonField(labelText, elId, prop, value, fontSize, placeholder) {
  fontSize = fontSize || PV_BTN_FONT_DEFAULT;
  return '<div class="field">' +
    '<div class="field-label-row"><label>' + esc(labelText) + '</label>' +
      '<div class="fs-controls">' +
        '<button type="button" class="fs-btn" data-fsdec="' + esc(prop) + '" data-fstarget="' + elId + '" title="Decrease font size">−</button>' +
        '<span class="fs-val" data-fsval="' + esc(prop) + '">' + fontSize + 'px</span>' +
        '<button type="button" class="fs-btn" data-fsinc="' + esc(prop) + '" data-fstarget="' + elId + '" title="Increase font size">+</button>' +
      '</div>' +
    '</div>' +
    '<input type="text" id="' + elId + '" style="font-size:' + fontSize + 'px" placeholder="' + esc(placeholder || "") + '" value="' + esc(value) + '" />' +
  '</div>';
}

// A compact +/- control (no separate label row) for a button label that
// lives inline in a list row — Choice options and Story Block buttons,
// where each row is already just "[input][...][delete]".
function inlineFsControls(prop, targetId, fontSize) {
  fontSize = fontSize || PV_BTN_FONT_DEFAULT;
  return '<div class="fs-controls" style="flex:0 0 auto">' +
    '<button type="button" class="fs-btn" data-fsdec="' + esc(prop) + '" data-fstarget="' + targetId + '" title="Decrease font size">−</button>' +
    '<span class="fs-val" data-fsval="' + esc(prop) + '">' + fontSize + 'px</span>' +
    '<button type="button" class="fs-btn" data-fsinc="' + esc(prop) + '" data-fstarget="' + targetId + '" title="Increase font size">+</button>' +
  '</div>';
}

function autoGrowTextarea(el) {
  if (!el || el.tagName !== "TEXTAREA") return; // no-op on single-line inputs (e.g. button-label fields)
  el.style.height = "auto";
  el.style.height = Math.max(el.scrollHeight, 60) + "px";
}
function autoGrowAll(root) {
  Array.prototype.forEach.call((root || document).querySelectorAll(".autoscale-ta"), autoGrowTextarea);
}

function wireFontSizeButtons(n) {
  Array.prototype.forEach.call(document.querySelectorAll("[data-fsinc],[data-fsdec]"), function (btn) {
    btn.onclick = function () {
      var prop = btn.dataset.fsinc || btn.dataset.fsdec;
      var delta = btn.dataset.fsinc ? PV_FONT_STEP : -PV_FONT_STEP;
      var next = Math.min(PV_FONT_MAX, Math.max(PV_FONT_MIN, pvFontSize(n, prop) + delta));
      setPvFontSize(n, prop, next);
      var ta = document.getElementById(btn.dataset.fstarget);
      if (ta) { ta.style.fontSize = next + "px"; autoGrowTextarea(ta); }
      Array.prototype.forEach.call(document.querySelectorAll('[data-fsval="' + prop.replace(/"/g, "") + '"]'), function (span) { span.textContent = next + "px"; });
      afterEdit(false);
    };
  });
}
/* Any autoscale textarea also grows as the player-visible text is typed,
   on top of whatever save-on-input handler the field already has. */
function wireAutoscaleTextareas() {
  Array.prototype.forEach.call(document.querySelectorAll(".autoscale-ta"), function (el) {
    el.addEventListener("input", function () { autoGrowTextarea(el); });
  });
  autoGrowAll();
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
    var laneId = connectionLaneId(c);
    title.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;' +
      'background:var(--lane-' + (laneId || "story") + ');margin-right:7px;vertical-align:middle;"></span>' +
      esc(connectionKindLabel(laneId));
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
  html += '<div class="section-title">Canvas placement</div>';
  html += fieldWrap("Lane", '<select id="fLane">' +
    LANES.map(function (l) { return '<option value="' + l.id + '"' + (n.lane === l.id ? " selected" : "") + '>' + esc(l.label) + '</option>'; }).join("") +
    '</select>');
  var sceneOpts = '<option value=""' + (!n.sceneId ? " selected" : "") + '>Unassigned</option>' +
    (Store.hunt.scenes || []).map(function (s) { return '<option value="' + s.id + '"' + (n.sceneId === s.id ? " selected" : "") + '>' + esc(s.title) + '</option>'; }).join("");
  html += fieldWrap("Scene column", '<select id="fSceneId">' + sceneOpts + '</select>');
  if (SUGGESTED_LANE[n.type] && n.lane && SUGGESTED_LANE[n.type] !== n.lane) {
    html += '<p class="lane-warn-note">⚠ ' + esc(NODE_TYPES[n.type].label) + ' nodes are usually placed in the <b>' + esc(LANE_BY_ID[SUGGESTED_LANE[n.type]].label) + '</b> lane.</p>';
  }
  html += buildTypeSpecificFields(n);
  if (n.type !== "hint") html += buildCompletionEditor(n);
  html += '<div class="section-title">Effects (applied when node completes)</div>';
  html += buildEffectsEditor(n);
  html += '<div class="section-title">Creator-only notes (never shown to player)</div>';
  html += '<div class="creator-note-box">' + fieldWrap("Notes / solution reasoning", '<textarea id="fNotes">' + esc(n.creatorNotes) + '</textarea>') + '</div>';
  html += '<div class="section-title"></div><button class="small-btn" id="btnDeleteNode" style="color:var(--danger)">Delete this node</button>';
  return html;
}

function buildTypeSpecificFields(n) {
  var c = n.content, hunt = Store.hunt, html = '<div class="section-title">Content</div>';
  switch (n.type) {
    case "scene":
      html += playerTextField("Body text (player-visible)", "fBody", "bodyFontSize", c.body, c.bodyFontSize);
      var prevForScene = previousConnectingNode(hunt, n.id);
      if (prevForScene && prevForScene.type === "scene") {
        html += fieldWrap("Back button", '<select id="fShowBackButton"><option value="0"' + (!c.showBackButton ? " selected" : "") + '>No</option><option value="1"' + (c.showBackButton ? " selected" : "") + '>Yes — let the player return to "' + esc(prevForScene.title) + '"</option></select>');
      } else if (c.showBackButton) {
        html += '<p class="lane-warn-note">⚠ Back button is enabled, but the node connecting into this one is no longer a Simple Text node — it won\'t be shown to players. <button class="small-btn" id="btnClearBackButton" style="margin-left:6px">Clear</button></p>';
      } else {
        html += '<p style="font-size:11px;color:var(--text-dim)">Back button is only offered when the node connecting into this one is also a Simple Text node.</p>';
      }
      break;
    case "storyBlock":
      html += playerTextField("Body text (player-visible)", "fBody", "bodyFontSize", c.body, c.bodyFontSize);
      html += '<p style="font-size:11px;color:var(--text-dim)">Completion buttons (added, ordered and connected) are set up below, in the Completion section.</p>';
      break;
    case "choice":
      html += playerTextField("Prompt text (player-visible)", "fBody", "bodyFontSize", c.body, c.bodyFontSize);
      html += '<div class="field"><label>Options</label><div id="optList">' +
        c.options.map(function (o, i) {
          var optElId = "optlbl_" + o.id, optProp = "opt:" + o.id, optFs = o.fontSize || PV_BTN_FONT_DEFAULT;
          return '<div class="list-item"><input type="text" id="' + optElId + '" style="font-size:' + optFs + 'px" value="' + esc(o.label) + '" data-oid="' + o.id + '" class="optLabelInput" />' +
            inlineFsControls(optProp, optElId, optFs) +
            '<button class="small-btn" data-oid="' + o.id + '">✕</button></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddOption">+ Add option</button></div>';
      html += '<p style="font-size:11px;color:var(--text-dim)">Connect a rule from this node with condition "choice option selected" to route based on the player\'s pick.</p>';
      break;
    case "answerEntry":
      html += playerTextField("Prompt (player-visible)", "fPrompt", "promptFontSize", c.prompt, c.promptFontSize);
      html += '<div class="field"><label>Accepted answers</label><div id="ansList">' +
        (c.acceptedAnswers || []).map(function (a, i) {
          return '<div class="list-item"><input type="text" value="' + esc(a) + '" data-idx="' + i + '" class="ansInput" /><button class="small-btn" data-idx="' + i + '">✕</button></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddAnswer">+ Add accepted variant</button></div>';
      html += fieldWrap("Case sensitive?", '<select id="fCaseSensitive"><option value="0"' + (!c.caseSensitive ? " selected" : "") + '>No</option><option value="1"' + (c.caseSensitive ? " selected" : "") + '>Yes</option></select>');
      html += '<div class="section-title">Image reveal (optional)</div>';
      html += '<p style="font-size:11px;color:var(--text-dim);margin:-4px 0 8px">Attach an image (a clue, a photo, a found document) to show above the prompt — same crop, frame and caption options as an Image Reveal node.</p>';
      html += buildImageRevealFields(c);
      break;
    case "ordering":
      html += playerTextField("Prompt (player-visible)", "fPrompt", "promptFontSize", c.prompt, c.promptFontSize);
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
      html += playerTextField("Prompt (player-visible)", "fPrompt", "promptFontSize", c.prompt, c.promptFontSize);
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
    case "physicalLockCode":
      html += fieldWrap("Lock appearance", '<select id="fLockStyle">' +
        Object.keys(LOCK_STYLES).map(function (key) {
          return '<option value="' + key + '"' + ((c.lockStyle || "classicBrass") === key ? " selected" : "") + '>' + LOCK_STYLES[key].icon + ' ' + esc(LOCK_STYLES[key].label) + '</option>';
        }).join("") + '</select>');
      html += '<p style="font-size:11px;color:var(--text-dim);margin:-4px 0 8px">Cosmetic only — describes the real-world prop to the player. Doesn\'t affect the accepted code.</p>';
      html += fieldWrap("Code format", '<select id="fCodeFormat"><option value="numeric"' + (c.codeFormat !== "alpha" ? " selected" : "") + '>Numeric</option><option value="alpha"' + (c.codeFormat === "alpha" ? " selected" : "") + '>Letters</option></select>');
      html += fieldWrap("Code length", '<input type="number" id="fCodeLength" min="1" value="' + (c.codeLength || 4) + '" />');
      html += fieldWrap("Accepted code", '<input type="text" id="fAcceptedCode" value="' + esc(c.acceptedCode || "") + '" />');
      break;
    case "cryptexLock":
      html += '<p style="font-size:12px;color:var(--text-dim)">Player drags three letter rings and presses the centre stud to try a combination. Letters are always A–Z, matched case-insensitively.</p>';
      html += '<div class="field"><label>Accepted combinations (3 letters)</label><div id="ansList">' +
        (c.acceptedAnswers || []).map(function (a, i) {
          return '<div class="list-item"><input type="text" value="' + esc(a) + '" data-idx="' + i + '" class="ansInput" maxlength="3" style="text-transform:uppercase;letter-spacing:2px;font-family:\'Courier New\',monospace;width:70px;flex:none" /><button class="small-btn" data-idx="' + i + '">✕</button></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddAnswer">+ Add accepted variant</button></div>';
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
      html += playerTextField("Ending text (player-visible)", "fBody", "bodyFontSize", c.body, c.bodyFontSize);
      break;
    case "hint":
      var puzzleNodes = hunt.nodes.filter(function (x) { return familyOf(x.type) === "puzzle"; });
      html += fieldWrap("Attached to puzzle node", '<select id="fForNodeId">' + selectOptions(puzzleNodes, "id", "title", c.forNodeId, "— choose puzzle —") + '</select>');
      html += '<div class="field"><label>Progressive stages (revealed in order, player-visible)</label><div id="hintStages">' +
        c.stages.map(function (s, idx) {
          var hid = "fHintStage_" + s.id, prop = "stage:" + s.id, fs = s.fontSize || 12;
          return '<div class="hint-block"><div class="field-label-row" style="margin-bottom:6px"><span class="hint-badge">STAGE ' + (idx + 1) + '</span>' +
            '<div class="fs-controls">' +
              '<button type="button" class="fs-btn" data-fsdec="' + prop + '" data-fstarget="' + hid + '" title="Decrease font size">−</button>' +
              '<span class="fs-val" data-fsval="' + prop + '">' + fs + 'px</span>' +
              '<button type="button" class="fs-btn" data-fsinc="' + prop + '" data-fstarget="' + hid + '" title="Increase font size">+</button>' +
            '</div></div>' +
            '<textarea id="' + hid + '" data-hid="' + s.id + '" class="hintStageInput autoscale-ta" style="font-size:' + fs + 'px">' + esc(s.text) + '</textarea><div style="text-align:right;margin-top:4px"><button class="small-btn" data-hid="' + s.id + '">Remove stage</button></div></div>';
        }).join("") + '</div><button class="small-btn" id="btnAddHintStage">+ Add stage</button></div>';
      break;
    case "locationPlaceholder":
      html += '<p style="font-size:12px;color:var(--text-dim)">' + esc(c.placeholderNote) + '</p>';
      break;
    case "imageReveal":
      html += buildImageRevealFields(c);
      break;
    default:
      html += buildGenericContentFields(n);
      break;
  }
  html += buildMediaFields(c);
  return html;
}

/* Image Reveal — bespoke inspector: upload the image the player will see,
   choose how it's framed (aspect ratio + crop/pan/zoom) and presented
   (polaroid / gallery frame / none), and a caption. This is the node's own
   "revealed" image (c.imageAsset), kept separate from the shared
   background-media fields (buildMediaFields, appended after this by
   buildTypeSpecificFields) which show full-bleed behind everything —
   so the background always plays outside this frame, never inside it. */
function buildImageRevealFields(c) {
  var html = '<div class="field"><label>Revealed image</label>' +
    '<input type="file" id="fImageAsset" accept="image/*" style="display:none" />' +
    '<button class="small-btn" id="btnImageAssetUpload">⬆ Upload image</button>' +
    (c.imageAsset ? ' <button class="small-btn" id="btnImageAssetClear" style="color:var(--danger)">✕ Remove image</button>' : '') +
    '</div>';

  html += fieldWrap("Aspect ratio", '<select id="fImageAspect">' +
    Object.keys(IMAGE_ASPECT_RATIOS).map(function (key) {
      return '<option value="' + key + '"' + ((c.aspectRatio || "original") === key ? " selected" : "") + '>' + esc(IMAGE_ASPECT_RATIOS[key].label) + '</option>';
    }).join("") + '</select>');

  html += fieldWrap("Frame", '<select id="fImageFrame">' +
    Object.keys(IMAGE_FRAME_STYLES).map(function (key) {
      return '<option value="' + key + '"' + ((c.frameStyle || "none") === key ? " selected" : "") + '>' + esc(IMAGE_FRAME_STYLES[key].label) + '</option>';
    }).join("") + '</select>');

  if (c.imageAsset) {
    var ratio = c.aspectRatio || "original";
    html += '<div class="field"><label>Crop &amp; position preview' + (ratio === "original" ? "" : ' — click/drag on the image to reposition it in the frame') + '</label>' +
      '<div id="imageCropPreview" style="max-width:260px">' + renderImageRevealBlock(c) + '</div></div>';
    if (ratio !== "original") {
      html += fieldWrap("Zoom / scale", '<input type="range" id="fImageZoom" min="100" max="300" step="1" value="' + Math.round((Number(c.cropZoom) || 1) * 100) + '" />');
    }
  } else {
    html += '<p style="font-size:11px;color:var(--text-dim)">Upload an image above to set its crop, position and frame.</p>';
  }

  html += fieldWrap("Caption (optional)", '<input type="text" id="fImageCaption" value="' + esc(c.caption || "") + '" />');
  html += fieldWrap("Let player zoom the image", '<select id="fImageZoomable"><option value="1"' + (c.zoomable !== false ? " selected" : "") + '>Yes</option><option value="0"' + (c.zoomable === false ? " selected" : "") + '>No</option></select>');
  return html;
}

/* Background media — standard on every node type. When set, the node's
   player screen plays the image/GIF/video full-bleed behind whatever that
   node type normally shows, with the content pinned to the bottom third
   on top (see wrapWithMedia in engine.js). Shared by buildTypeSpecificFields
   so every type gets the same fields without repeating this block. */
function buildMediaFields(c) {
  var html = '<div class="section-title">Background media (optional)</div>';
  html += '<p style="font-size:11px;color:var(--text-dim);margin:-4px 0 8px">Attach an image, GIF or video and it plays full-screen behind this node’s content — the content pane moves to the bottom third of the screen and sits over the media.</p>';
  html += fieldWrap("Media type", '<select id="fMediaType">' +
    [["image", "Image"], ["gif", "GIF"], ["video", "Video"]].map(function (t) {
      return '<option value="' + t[0] + '"' + ((c.mediaType || "image") === t[0] ? " selected" : "") + '>' + t[1] + '</option>';
    }).join("") + '</select>');
  html += fieldWrap("Media URL", '<input type="text" id="fMediaUrl" placeholder="https://… or upload a file below" value="' + esc(c.mediaUrl || "") + '" />');
  html += '<div class="field"><input type="file" id="fMediaUpload" accept="image/*,video/*" style="display:none" />' +
    '<button class="small-btn" id="btnMediaUpload">⬆ Upload file</button>' +
    (c.mediaUrl ? ' <button class="small-btn" id="btnMediaClear" style="color:var(--danger)">✕ Remove media</button>' : '') + '</div>';
  if (c.mediaUrl) {
    html += c.mediaType === "video"
      ? '<video src="' + esc(c.mediaUrl) + '" class="pv-image" style="max-height:140px;width:100%;object-fit:cover" muted controls></video>'
      : '<img src="' + esc(c.mediaUrl) + '" class="pv-image" style="max-height:140px;width:100%;object-fit:cover" />';
  }
  return html;
}

function wireMediaFields(c) {
  var byId = function (id) { return document.getElementById(id); };
  if (byId("fMediaType")) byId("fMediaType").onchange = function (e) { c.mediaType = e.target.value; afterEdit(); renderInspector(); };
  if (byId("fMediaUrl")) {
    byId("fMediaUrl").oninput = function (e) { c.mediaUrl = e.target.value; };
    byId("fMediaUrl").onblur = function () { afterEdit(); renderInspector(); };
  }
  if (byId("btnMediaUpload")) byId("btnMediaUpload").onclick = function () { byId("fMediaUpload").click(); };
  if (byId("fMediaUpload")) byId("fMediaUpload").onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!c.mediaType || c.mediaType === "image") {
      if (/^video\//.test(file.type)) c.mediaType = "video";
      else if (file.type === "image/gif") c.mediaType = "gif";
    }
    readImageFileCompressed(file, function (dataUrl) {
      if (!dataUrl) { toast("Couldn't read that file."); return; }
      c.mediaUrl = dataUrl;
      afterEdit(); renderInspector();
      toast("Media attached.");
    });
  };
  if (byId("btnMediaClear")) byId("btnMediaClear").onclick = function () {
    c.mediaUrl = ""; afterEdit(); renderInspector();
  };
}

function wireImageRevealFields(c) {
  var byId = function (id) { return document.getElementById(id); };
  if (byId("btnImageAssetUpload")) byId("btnImageAssetUpload").onclick = function () { byId("fImageAsset").click(); };
  if (byId("fImageAsset")) byId("fImageAsset").onchange = function (e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    readImageFileCompressed(file, function (dataUrl) {
      if (!dataUrl) { toast("Couldn't read that image file."); return; }
      c.imageAsset = dataUrl;
      afterEdit(); renderInspector();
      toast("Image attached.");
    });
  };
  if (byId("btnImageAssetClear")) byId("btnImageAssetClear").onclick = function () {
    c.imageAsset = ""; afterEdit(); renderInspector();
  };

  if (byId("fImageAspect")) byId("fImageAspect").onchange = function (e) { c.aspectRatio = e.target.value; afterEdit(); renderInspector(); };
  if (byId("fImageFrame")) byId("fImageFrame").onchange = function (e) { c.frameStyle = e.target.value; afterEdit(); renderInspector(); };

  if (byId("fImageCaption")) {
    byId("fImageCaption").oninput = function (e) { c.caption = e.target.value; };
    byId("fImageCaption").onblur = function () { afterEdit(); };
  }
  if (byId("fImageZoomable")) byId("fImageZoomable").onchange = function (e) { c.zoomable = e.target.value === "1"; afterEdit(); };

  // Zoom/scale slider and click-drag panning both act on the same child
  // <img class="pv-image-frame-img"> that renderImageRevealBlock renders
  // (object-fit: cover + object-position + transform: scale) — so the
  // inspector preview uses the exact same crop math as the real player
  // screen, just manipulated live instead of rebuilt from scratch on
  // every input event.
  var zoomEl = byId("fImageZoom");
  var previewBox = byId("imageCropPreview");
  var frameEl = previewBox ? previewBox.querySelector(".pv-image-frame") : null;
  var imgEl = frameEl ? frameEl.querySelector(".pv-image-frame-img") : null;

  if (zoomEl && imgEl) {
    zoomEl.oninput = function (e) {
      c.cropZoom = Number(e.target.value) / 100;
      imgEl.style.transform = "scale(" + c.cropZoom + ")";
    };
    zoomEl.onchange = function () { afterEdit(false); };
  }

  // Click/drag directly on the crop preview to move the image within the
  // frame — sets the focal point under the cursor, then pans live as the
  // mouse moves.
  if (imgEl && c.aspectRatio && c.aspectRatio !== "original") {
    frameEl.style.cursor = "move";
    frameEl.onmousedown = function (e) {
      e.preventDefault();
      var rect = frameEl.getBoundingClientRect();
      function setFromEvent(ev) {
        var x = Math.min(Math.max((ev.clientX - rect.left) / rect.width, 0), 1);
        var y = Math.min(Math.max((ev.clientY - rect.top) / rect.height, 0), 1);
        c.focalX = Math.round(x * 100);
        c.focalY = Math.round(y * 100);
        imgEl.style.objectPosition = c.focalX + "% " + c.focalY + "%";
      }
      setFromEvent(e);
      function move(ev) { setFromEvent(ev); }
      function up() {
        document.removeEventListener("mousemove", move);
        document.removeEventListener("mouseup", up);
        afterEdit(false);
      }
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    };
  }
}

/* Generic content editor for node types without a bespoke inspector layout
   (currently: the node types proposed in the Node Type Expansion draft).
   Renders a plain input/textarea per string/number/boolean field, and a
   raw-JSON textarea for anything array/object-shaped, keyed off whatever
   shape that type's defaultContent() produced. Keeps every new node type
   immediately usable in the canvas + inspector without a bespoke editor
   per type; swap in a hand-built case above as each type's fields settle. */
function genericFieldLabel(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, function (s) { return s.toUpperCase(); });
}
function buildGenericContentFields(n) {
  var c = n.content || {}, html = "";
  // mediaUrl/mediaType are handled by the shared buildMediaFields section
  // (appended after this) rather than shown again generically here.
  Object.keys(c).filter(function (key) { return key !== "mediaUrl" && key !== "mediaType"; }).forEach(function (key) {
    var v = c[key], label = genericFieldLabel(key);
    if (typeof v === "string") {
      var longField = v.length > 60 || /body|prompt|instruction|note|final/i.test(key);
      html += fieldWrap(label, longField
        ? '<textarea data-gkey="' + key + '" class="genericField">' + esc(v) + '</textarea>'
        : '<input type="text" data-gkey="' + key + '" class="genericField" value="' + esc(v) + '" />');
    } else if (typeof v === "number") {
      html += fieldWrap(label, '<input type="number" data-gkey="' + key + '" class="genericField" value="' + v + '" />');
    } else if (typeof v === "boolean") {
      html += fieldWrap(label, '<select data-gkey="' + key + '" class="genericField"><option value="1"' + (v ? " selected" : "") + '>Yes</option><option value="0"' + (!v ? " selected" : "") + '>No</option></select>');
    } else {
      html += fieldWrap(label + " (advanced — raw JSON)", '<textarea data-gkey="' + key + '" data-gjson="1" class="genericField" style="font-family:\'Courier New\',monospace;font-size:11.5px">' + esc(JSON.stringify(v, null, 2)) + '</textarea>');
    }
  });
  html += '<p style="font-size:11px;color:var(--text-dim);margin-top:6px">This node type doesn’t have a custom editor yet, so fields are shown generically. List/object fields are edited as raw JSON.</p>';
  return html;
}
function wireGenericContentFields(n) {
  var c = n.content || {};
  Array.prototype.forEach.call(document.querySelectorAll(".genericField"), function (el) {
    var key = el.dataset.gkey, isJson = el.dataset.gjson === "1";
    if (el.tagName === "SELECT") {
      el.onchange = function (e) { c[key] = e.target.value === "1"; afterEdit(); };
      return;
    }
    el.oninput = function (e) {
      if (isJson) return; // JSON fields commit on blur only, so partial typing doesn't break parsing
      c[key] = (el.type === "number") ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value;
    };
    el.onblur = function () {
      if (isJson) {
        try { c[key] = JSON.parse(el.value); afterEdit(); }
        catch (err) { toast('Invalid JSON for "' + key + '" — change not saved.'); }
      } else {
        afterEdit();
      }
    };
  });
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
  if (byId("fLane")) byId("fLane").onchange = function (e) { n.lane = e.target.value; afterEdit(); renderInspector(); };
  if (byId("fSceneId")) byId("fSceneId").onchange = function (e) { n.sceneId = e.target.value || null; afterEdit(); renderInspector(); };
  if (n.type !== "hint") wireCompletionEditor(n);
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
      if (byId("fShowBackButton")) byId("fShowBackButton").onchange = function (e) { c.showBackButton = e.target.value === "1"; afterEdit(); };
      if (byId("btnClearBackButton")) byId("btnClearBackButton").onclick = function () { c.showBackButton = false; afterEdit(); renderInspector(); };
      break;
    case "storyBlock":
      bindText("fBody", "body");
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
      wireImageRevealFields(c);
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
    case "physicalLockCode":
      bindChange("fLockStyle", function (v) { c.lockStyle = v; });
      bindChange("fCodeFormat", function (v) { c.codeFormat = v; });
      if (byId("fCodeLength")) { byId("fCodeLength").oninput = function (e) { c.codeLength = Number(e.target.value); }; byId("fCodeLength").onblur = function () { afterEdit(false); }; }
      bindText("fAcceptedCode", "acceptedCode");
      break;
    case "cryptexLock":
      Array.prototype.forEach.call(document.querySelectorAll(".ansInput"), function (inp) {
        inp.oninput = function (e) { c.acceptedAnswers[+inp.dataset.idx] = e.target.value.toUpperCase(); };
        inp.onblur = function () { afterEdit(false); renderInspector(); };
      });
      Array.prototype.forEach.call(document.querySelectorAll("#ansList button"), function (btn) {
        btn.onclick = function () { c.acceptedAnswers.splice(+btn.dataset.idx, 1); afterEdit(false); renderInspector(); };
      });
      if (byId("btnAddAnswer")) byId("btnAddAnswer").onclick = function () { c.acceptedAnswers.push("CAT"); afterEdit(false); renderInspector(); };
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
    case "imageReveal":
      wireImageRevealFields(c);
      break;
    default:
      wireGenericContentFields(n);
      break;
  }

  // player-visible text fields: +/- font-size buttons and auto-grow boxes
  wireFontSizeButtons(n);
  wireAutoscaleTextareas();

  // background media (shared across all node types)
  wireMediaFields(c);

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

  if (byId("btnDeleteNode")) byId("btnDeleteNode").onclick = function () {
    if (!confirm('Delete "' + (n.title || "this node") + '"? Its connections will also be removed.')) return;
    Store.removeNode(n.id);
    Store.clearSelection();
    render();
    toast("Node deleted.");
  };
}

// Shared condition-type editor — the same field set/behavior backs both a
// connection's "when does this open" rule (buildEdgeInspector) and a
// node's completion-override condition (buildCompletionEditor). `prefix`
// namespaces the DOM ids/classes so the two never collide (they can't
// actually be on screen at once — inspector only ever shows one selected
// thing — but distinct prefixes keep each block's ids self-describing).
function buildConditionFields(cond, prefix) {
  var hunt = Store.hunt, allNodes = hunt.nodes;
  var html = fieldWrap("Condition type", '<select id="' + prefix + 'CondType">' +
    Object.keys(CONDITION_TYPES).map(function (k) { return '<option value="' + k + '"' + (cond.type === k ? " selected" : "") + '>' + CONDITION_TYPES[k].label + '</option>'; }).join("") +
    '</select>');

  if (cond.type === "nodeComplete") {
    html += fieldWrap("Node", '<select id="' + prefix + 'CondNode">' + selectOptions(allNodes, "id", "title", cond.nodeId, "— choose node —") + '</select>');
  } else if (cond.type === "allComplete" || cond.type === "anyNComplete") {
    html += '<div class="field"><label>Nodes (check all that apply)</label>' +
      allNodes.map(function (nd) {
        var checked = (cond.nodeIds || []).indexOf(nd.id) !== -1;
        return '<div class="list-item"><label style="display:flex;gap:6px;align-items:center;font-size:12px"><input type="checkbox" class="' + prefix + 'CondNodeChk" value="' + nd.id + '"' + (checked ? " checked" : "") + ' /> ' + esc(nd.title) + '</label></div>';
      }).join("") + '</div>';
    if (cond.type === "anyNComplete") html += fieldWrap("N required", '<input type="number" id="' + prefix + 'CondN" min="1" value="' + (cond.n || 1) + '" />');
  } else if (cond.type === "choiceSelected") {
    var choiceNodes = allNodes.filter(function (nd) { return nd.type === "choice" || nd.type === "storyBlock"; });
    html += fieldWrap("Choice / Story Block node", '<select id="' + prefix + 'CondNode">' + selectOptions(choiceNodes, "id", "title", cond.nodeId, "— choose node —") + '</select>');
    var chosen = choiceNodes.find(function (nd) { return nd.id === cond.nodeId; });
    var opts = chosen ? (chosen.type === "storyBlock" ? (chosen.content.buttons || []).filter(function (b) { return b.kind !== "back"; }) : chosen.content.options) : [];
    html += fieldWrap("Option / Button", '<select id="' + prefix + 'CondOption">' + selectOptions(opts, "id", "label", cond.optionId, "— choose option —") + '</select>');
  } else if (cond.type === "variableEquals" || cond.type === "variableAtLeast") {
    html += fieldWrap("Variable", '<select id="' + prefix + 'CondVar">' + selectOptions(hunt.variables, "id", "name", cond.variableId, "— choose variable —") + '</select>');
    html += fieldWrap("Value", '<input type="text" id="' + prefix + 'CondValue" value="' + esc(cond.value !== undefined ? cond.value : "") + '" />');
  } else if (cond.type === "itemHeld") {
    html += fieldWrap("Item", '<select id="' + prefix + 'CondItem">' + selectOptions(hunt.items, "id", "name", cond.itemId, "— choose item —") + '</select>');
  } else {
    html += '<p style="font-size:12px;color:var(--text-dim)">Always true — treated as immediately satisfied.</p>';
  }
  return html;
}

function conditionForType(t) {
  if (t === "nodeComplete") return { type: t, nodeId: "" };
  if (t === "allComplete") return { type: t, nodeIds: [] };
  if (t === "anyNComplete") return { type: t, nodeIds: [], n: 1 };
  if (t === "choiceSelected") return { type: t, nodeId: "", optionId: "" };
  if (t === "variableEquals" || t === "variableAtLeast") return { type: t, variableId: "", value: "" };
  if (t === "itemHeld") return { type: t, itemId: "" };
  return { type: t }; // "always"
}

// setCondition(newCond): called on a condition-*type* change, replaces the
// whole condition object — caller decides where it's stored.
// onChange(needsRerender): called after an in-place field edit on the
// existing condition (nodeId/value/etc.) — caller persists + optionally
// re-renders (needed when picking a Choice node, to refresh its Option list).
function wireConditionFields(cond, prefix, setCondition, onChange) {
  var byId = function (id) { return document.getElementById(id); };
  byId(prefix + "CondType").onchange = function (e) { setCondition(conditionForType(e.target.value)); };
  if (byId(prefix + "CondNode")) byId(prefix + "CondNode").onchange = function (e) { cond.nodeId = e.target.value; onChange(cond.type === "choiceSelected"); };
  if (byId(prefix + "CondOption")) byId(prefix + "CondOption").onchange = function (e) { cond.optionId = e.target.value; onChange(false); };
  if (byId(prefix + "CondN")) { byId(prefix + "CondN").oninput = function (e) { cond.n = Number(e.target.value); }; byId(prefix + "CondN").onblur = function () { onChange(false); }; }
  Array.prototype.forEach.call(document.querySelectorAll("." + prefix + "CondNodeChk"), function (chk) {
    chk.onchange = function () {
      var ids = Array.prototype.filter.call(document.querySelectorAll("." + prefix + "CondNodeChk"), function (x) { return x.checked; }).map(function (x) { return x.value; });
      cond.nodeIds = ids;
      onChange(false);
    };
  });
  if (byId(prefix + "CondVar")) byId(prefix + "CondVar").onchange = function (e) { cond.variableId = e.target.value; onChange(false); };
  if (byId(prefix + "CondValue")) { byId(prefix + "CondValue").oninput = function (e) { cond.value = e.target.value; }; byId(prefix + "CondValue").onblur = function () { onChange(false); }; }
  if (byId(prefix + "CondItem")) byId(prefix + "CondItem").onchange = function (e) { cond.itemId = e.target.value; onChange(false); };
}

// A concise description of what completes a node today, shown as the
// "Default" option's label in the Completion Rule picker below — so a
// creator can see what they're overriding before they do it.
function defaultCompletionSummary(n) {
  if (n.type === "convergence") return "its incoming branches converge (fires automatically)";
  if (isAutoType(n.type)) return "it becomes available (fires automatically)";
  if (n.type === "choice") return "the player picks an option";
  if (n.type === "storyBlock") return "the player presses one of its buttons";
  if (BUTTON_LABEL_TYPES[n.type] && (n.type === "scene" || n.type === "imageReveal" || n.type === "locationPlaceholder")) return "the player presses the button";
  return "the player submits a correct answer/solution";
}

// Generic, all-node-types completion controls: a custom button label
// (where the node type has one clear action button) and a completion
// override that replaces the node's built-in trigger with a condition —
// see nodeCompletionOk in engine.js for the runtime side. Not shown for
// Hint nodes, which have no completion concept (see buildNodeInspector).
// Story Block doesn't fit the single-button-label pattern (it can have
// several buttons), so it gets its own buttons editor instead — see
// buildStoryBlockButtonsEditor.
function buildCompletionEditor(n) {
  var html = '<div class="section-title">Completion</div>';
  if (n.type === "storyBlock") {
    html += buildStoryBlockButtonsEditor(n);
  } else if (BUTTON_LABEL_TYPES[n.type]) {
    html += playerButtonField('Button label (blank = default "' + esc(DEFAULT_BUTTON_LABEL[n.type]) + '") — player-visible',
      "fButtonLabel", "node:buttonLabelFontSize", n.buttonLabel || "", n.buttonLabelFontSize, DEFAULT_BUTTON_LABEL[n.type]);
  }
  var ov = n.completionOverride || (n.completionOverride = { enabled: false, condition: { type: "always" } });
  html += fieldWrap("This node is complete when…", '<select id="fCompletionMode">' +
    '<option value="0"' + (!ov.enabled ? " selected" : "") + '>Default — ' + esc(defaultCompletionSummary(n)) + '</option>' +
    '<option value="1"' + (ov.enabled ? " selected" : "") + '>A custom condition is met</option>' +
    '</select>');
  if (ov.enabled) {
    html += '<p style="font-size:11px;color:var(--text-dim);margin:-4px 0 8px">While this is set, the node’s own answer/interaction no longer decides completion — it’s marked complete (and its outgoing connections can fire) only once this condition is true.</p>';
    html += buildConditionFields(ov.condition, "fNode");
  }
  return html;
}

// Story Block's completion buttons — added, reordered left-to-right, and
// each (other than the auto-included Back button) assigned to one of this
// node's existing outgoing connections. Assigning a connection here writes
// a "choiceSelected" condition onto that connection automatically (the
// same mechanism Choice nodes use, just driven by button assignment
// instead of manually editing the connection's own inspector) — see
// wireStoryBlockButtonsEditor for the write-back and cleanup logic.
function buildStoryBlockButtonsEditor(n) {
  var c = n.content;
  c.buttons = c.buttons || [];
  if (!c.buttonLayout) c.buttonLayout = "vertical";
  var outgoing = Store.hunt.connections.filter(function (cn) { return cn.sourceId === n.id; });
  var html = fieldWrap("Button layout", '<select id="fSbButtonLayout">' +
    '<option value="vertical"' + (c.buttonLayout !== "horizontal" ? " selected" : "") + '>Top to Bottom</option>' +
    '<option value="horizontal"' + (c.buttonLayout === "horizontal" ? " selected" : "") + '>Left to Right</option>' +
    '</select>');
  var orderHint = c.buttonLayout === "horizontal" ? "shown left → right" : "shown top → bottom";
  html += '<div class="field"><label>Buttons (' + orderHint + ')</label><div id="storyBtnList">';
  c.buttons.forEach(function (b, i) {
    var btnElId = "storybtnlbl_" + b.id, btnProp = "btn:" + b.id, btnFs = b.fontSize || PV_BTN_FONT_DEFAULT;
    html += '<div class="list-item" data-btnid="' + b.id + '" style="flex-wrap:wrap">';
    html += '<input type="text" id="' + btnElId + '" value="' + esc(b.label) + '" data-btnid="' + b.id + '" class="storyBtnLabelInput" style="flex:1;min-width:90px;font-size:' + btnFs + 'px" />';
    html += inlineFsControls(btnProp, btnElId, btnFs);
    if (b.kind === "back") {
      html += '<span style="font-size:11px;color:var(--text-dim);padding:0 6px">back navigation — no connection needed</span>';
    } else {
      html += '<select data-btnid="' + b.id + '" class="storyBtnConnSelect" style="min-width:150px">' +
        '<option value=""' + (!b.connectionId ? " selected" : "") + '>— choose connection —</option>' +
        outgoing.map(function (cn) {
          var t = Store.getNode(cn.targetId);
          return '<option value="' + cn.id + '"' + (b.connectionId === cn.id ? " selected" : "") + '>→ ' + esc(t ? t.title : "?") + '</option>';
        }).join("") + '</select>';
    }
    html += '<button class="small-btn storyBtnUp" data-btnid="' + b.id + '"' + (i === 0 ? " disabled" : "") + '>↑</button>';
    html += '<button class="small-btn storyBtnDown" data-btnid="' + b.id + '"' + (i === c.buttons.length - 1 ? " disabled" : "") + '>↓</button>';
    html += '<button class="small-btn storyBtnDelete" data-btnid="' + b.id + '">✕</button>';
    html += '</div>';
  });
  html += '</div><button class="small-btn" id="btnAddStoryButton">+ Add button</button>';
  if (!c.buttons.some(function (b) { return b.kind === "back"; })) {
    html += ' <button class="small-btn" id="btnAddStoryBack">+ Add back button</button>';
  }
  html += '</div>';
  if (!outgoing.length) {
    html += '<p style="font-size:11px;color:var(--text-dim)">Drag a connection out of this node on the canvas first, then assign it to a button here.</p>';
  }
  return html;
}

// Keeps a button's assigned connection's routing condition in sync: setting
// b.connectionId writes {type:"choiceSelected", nodeId, optionId:b.id} onto
// that connection, and clearing/reassigning resets whatever connection this
// button previously owned back to "always" — but only if this button is
// still the one that set it, so we never clobber a condition the creator
// configured by hand elsewhere.
function setStoryButtonConnection(n, b, newConnectionId) {
  if (b.connectionId) {
    var prevConn = Store.getConnection(b.connectionId);
    if (prevConn && prevConn.condition && prevConn.condition.type === "choiceSelected" &&
        prevConn.condition.nodeId === n.id && prevConn.condition.optionId === b.id) {
      prevConn.condition = { type: "always" };
    }
  }
  b.connectionId = newConnectionId || "";
  if (b.connectionId) {
    var conn = Store.getConnection(b.connectionId);
    if (conn) conn.condition = { type: "choiceSelected", nodeId: n.id, optionId: b.id };
  }
}

function wireStoryBlockButtonsEditor(n) {
  var c = n.content;
  var byId = function (id) { return document.getElementById(id); };
  if (byId("fSbButtonLayout")) byId("fSbButtonLayout").onchange = function (e) { c.buttonLayout = e.target.value; afterEdit(); renderInspector(); };
  Array.prototype.forEach.call(document.querySelectorAll(".storyBtnLabelInput"), function (inp) {
    inp.oninput = function (e) {
      var b = c.buttons.find(function (x) { return x.id === inp.dataset.btnid; });
      if (b) b.label = e.target.value;
    };
    inp.onblur = function () { afterEdit(); };
  });
  Array.prototype.forEach.call(document.querySelectorAll(".storyBtnConnSelect"), function (sel) {
    sel.onchange = function (e) {
      var b = c.buttons.find(function (x) { return x.id === sel.dataset.btnid; });
      if (b) setStoryButtonConnection(n, b, e.target.value);
      afterEdit(); renderInspector();
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll(".storyBtnUp"), function (btn) {
    btn.onclick = function () {
      var idx = c.buttons.findIndex(function (x) { return x.id === btn.dataset.btnid; });
      if (idx > 0) { var t = c.buttons[idx - 1]; c.buttons[idx - 1] = c.buttons[idx]; c.buttons[idx] = t; afterEdit(); renderInspector(); }
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll(".storyBtnDown"), function (btn) {
    btn.onclick = function () {
      var idx = c.buttons.findIndex(function (x) { return x.id === btn.dataset.btnid; });
      if (idx < c.buttons.length - 1) { var t = c.buttons[idx + 1]; c.buttons[idx + 1] = c.buttons[idx]; c.buttons[idx] = t; afterEdit(); renderInspector(); }
    };
  });
  Array.prototype.forEach.call(document.querySelectorAll(".storyBtnDelete"), function (btn) {
    btn.onclick = function () {
      var removed = c.buttons.find(function (x) { return x.id === btn.dataset.btnid; });
      if (removed && removed.connectionId) setStoryButtonConnection(n, removed, "");
      c.buttons = c.buttons.filter(function (x) { return x.id !== btn.dataset.btnid; });
      afterEdit(); renderInspector();
    };
  });
  if (byId("btnAddStoryButton")) byId("btnAddStoryButton").onclick = function () {
    c.buttons.push({ id: uid("btn"), label: "Continue", kind: "connection", connectionId: "" });
    afterEdit(); renderInspector();
  };
  if (byId("btnAddStoryBack")) byId("btnAddStoryBack").onclick = function () {
    c.buttons.unshift({ id: uid("btn"), label: "Back", kind: "back" });
    afterEdit(); renderInspector();
  };
}

function wireCompletionEditor(n) {
  var byId = function (id) { return document.getElementById(id); };
  if (n.type === "storyBlock") wireStoryBlockButtonsEditor(n);
  if (byId("fButtonLabel")) {
    byId("fButtonLabel").oninput = function (e) { n.buttonLabel = e.target.value; };
    byId("fButtonLabel").onblur = function () { afterEdit(false); };
  }
  if (byId("fCompletionMode")) {
    byId("fCompletionMode").onchange = function (e) {
      n.completionOverride.enabled = e.target.value === "1";
      afterEdit(false);
      renderInspector();
    };
  }
  var ov = n.completionOverride;
  if (ov && ov.enabled) {
    wireConditionFields(ov.condition, "fNode",
      function (newCond) { ov.condition = newCond; afterEdit(false); renderInspector(); },
      function (needsRerender) { afterEdit(false); if (needsRerender) renderInspector(); });
  }
}

function buildEdgeInspector(c) {
  var s = Store.getNode(c.sourceId), t = Store.getNode(c.targetId);
  var html = '<div class="section-title">Route</div>';
  html += '<p style="font-size:12px;color:var(--text-dim)">' + esc(s ? s.title : "?") + " → " + esc(t ? t.title : "?") + '</p>';
  html += fieldWrap("Label (optional, for your own reference)", '<input type="text" id="fLabel" value="' + esc(c.label) + '" />');
  html += fieldWrap("Priority (lower = evaluated first)", '<input type="number" id="fPriority" value="' + c.priority + '" />');

  html += '<div class="section-title">Condition — when does this connection open?</div>';
  html += buildConditionFields(c.condition, "f");
  html += '<div class="section-title"></div><button class="small-btn" id="btnDeleteEdge" style="color:var(--danger)">Delete this connection</button>';
  return html;
}

function wireEdgeInspector(c) {
  var byId = function (id) { return document.getElementById(id); };
  byId("fLabel").oninput = function (e) { c.label = e.target.value; renderEdges(); };
  byId("fLabel").onblur = function () { afterEdit(false); };
  byId("fPriority").oninput = function (e) { c.priority = Number(e.target.value); };
  byId("fPriority").onblur = function () { afterEdit(false); };

  wireConditionFields(c.condition, "f",
    function (newCond) { c.condition = newCond; afterEdit(); renderInspector(); },
    function (needsRerender) { afterEdit(); if (needsRerender) renderInspector(); });

  byId("btnDeleteEdge").onclick = function () { Store.removeConnection(c.id); Store.clearSelection(); render(); };
}

/* ---------------------------------------------------------------------
   Validation panel (drawer)
--------------------------------------------------------------------- */
function renderValidationPanel() {
  var issues = allIssues(Store.hunt);
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
   Hunt library (per-hunt IndexedDB records) + per-hunt Save / Export / Import
   -----------------------------------------------------------------------
   Each hunt is its own IndexedDB record now, not one shared JSON blob in
   localStorage. That fixes the two problems the old blob approach had:
     1. Quota — localStorage tops out around 5-10MB *total*, shared across
        every hunt in the library, so one image-heavy hunt could block
        saving any hunt. IndexedDB's quota scales with free disk space
        (typically hundreds of MB to several GB).
     2. Write cost — saving one hunt used to mean re-serializing and
        rewriting the entire library every time. Now it's a single-record
        write, so unrelated hunts can't interfere with each other's saves.
   A small in-memory cache (LibraryCache) mirrors IndexedDB so the rest of
   the app keeps reading the library synchronously, same as before — only
   initLibraryStorage() (called once from init()) is actually async.
   Falls back to the old localStorage-blob behavior if IndexedDB isn't
   available at all (very old browsers, some locked-down private modes).
--------------------------------------------------------------------- */
var LEGACY_STORAGE_KEY = "puzzleatlas_studio_hunt_v0";     // Phase 1 single-slot save
var LEGACY_LIBRARY_KEY = "puzzleatlas_studio_library_v1";  // Phase 2 single-blob library, migrated below
var IDB_NAME = "puzzleatlas_studio_db";
var IDB_VERSION = 1;
var IDB_STORE = "hunts";
var IDB_SUPPORTED = typeof indexedDB !== "undefined";

var LibraryCache = [];  // in-memory mirror of every hunt in the library
var _idbHandle = null;  // cached open IDBDatabase connection

function openIdb() {
  if (_idbHandle) return Promise.resolve(_idbHandle);
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: "id" });
    };
    req.onsuccess = function () { _idbHandle = req.result; resolve(_idbHandle); };
    req.onerror = function () { reject(req.error || new Error("Couldn't open IndexedDB.")); };
  });
}
function idbGetAll() {
  return openIdb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var req = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).getAll();
      req.onsuccess = function () { resolve(req.result || []); };
      req.onerror = function () { reject(req.error || new Error("Couldn't read hunt library.")); };
    });
  });
}
function idbPut(hunt) {
  return openIdb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(hunt);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error("Couldn't save hunt.")); };
      tx.onabort = function () { reject(tx.error || new Error("Couldn't save hunt.")); };
    });
  });
}
function idbDelete(id) {
  return openIdb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error || new Error("Couldn't delete hunt.")); };
    });
  });
}

// One-time migration from the old localStorage-blob library (and, before
// that, the even older single-slot save) into IndexedDB. Only runs when
// IndexedDB has no records yet, so it can never clobber newer IDB data.
function migrateLegacyLibraryIntoIdb() {
  var hunts = [];
  var raw = localStorage.getItem(LEGACY_LIBRARY_KEY);
  if (raw) {
    try { hunts = JSON.parse(raw).hunts || []; } catch (e) { hunts = []; }
  } else {
    var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      try { var h = JSON.parse(legacy); if (h && h.id) hunts = [h]; } catch (e) { /* ignore corrupted legacy save */ }
    }
  }
  if (!hunts.length) return Promise.resolve([]);
  return Promise.all(hunts.map(function (h) { return idbPut(h).catch(function () { /* best-effort */ }); }))
    .then(function () {
      // Free up the localStorage quota now that these live in IndexedDB.
      try { localStorage.removeItem(LEGACY_LIBRARY_KEY); localStorage.removeItem(LEGACY_STORAGE_KEY); } catch (e) { /* ignore */ }
      return hunts;
    });
}

// Fallback path for the rare case IndexedDB isn't available at all: behave
// like the old Phase 2 single-blob library, quota limits and all.
function loadLibraryFallback() {
  var raw = localStorage.getItem(LEGACY_LIBRARY_KEY);
  if (raw) { try { return JSON.parse(raw).hunts || []; } catch (e) { return []; } }
  var legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (legacy) { try { var h = JSON.parse(legacy); if (h && h.id) return [h]; } catch (e) { /* ignore corrupted legacy save */ } }
  return [];
}
function persistLibraryFallback() {
  try {
    localStorage.setItem(LEGACY_LIBRARY_KEY, JSON.stringify({ hunts: LibraryCache }));
    return true;
  } catch (e) {
    toast("Save failed — your hunt library is too large for browser storage, most likely from an attached image or video. Try a smaller image, remove an unused attachment, or use “Export JSON” to keep a copy of your work.", 7000);
    return false;
  }
}

// Loads the library into LibraryCache once at startup. Must resolve before
// the Library screen first renders — called from init(). Returns a promise.
function initLibraryStorage() {
  if (!IDB_SUPPORTED) { LibraryCache = loadLibraryFallback(); return Promise.resolve(); }
  return idbGetAll().then(function (hunts) {
    if (hunts.length) { LibraryCache = hunts; return; }
    return migrateLegacyLibraryIntoIdb().then(function (migrated) { LibraryCache = migrated; });
  }).catch(function (err) {
    console.error("IndexedDB unavailable, falling back to localStorage:", err);
    IDB_SUPPORTED = false;
    LibraryCache = loadLibraryFallback();
  });
}

function getLibraryHunts() {
  return LibraryCache.slice().sort(function (a, b) {
    return new Date((b.metadata || {}).updatedAt || 0) - new Date((a.metadata || {}).updatedAt || 0);
  });
}
function getHuntFromLibrary(id) {
  return LibraryCache.find(function (h) { return h.id === id; });
}
// Writes synchronously to the in-memory cache (so the rest of the UI sees
// the change immediately, same as before) and persists to IndexedDB in the
// background. Returns true/false for the cache write; a failed background
// persist surfaces its own toast rather than blocking or reverting the UI.
function upsertHuntInLibrary(hunt) {
  hunt.metadata = hunt.metadata || {};
  hunt.metadata.updatedAt = new Date().toISOString();
  var copy = clone(hunt);
  var idx = LibraryCache.findIndex(function (h) { return h.id === copy.id; });
  if (idx === -1) LibraryCache.push(copy); else LibraryCache[idx] = copy;

  if (!IDB_SUPPORTED) return persistLibraryFallback();
  idbPut(copy).catch(function (err) {
    console.error(err);
    toast("Save failed — couldn't write “" + (copy.title || "this hunt") + "” to browser storage: " + err.message, 7000);
  });
  return true;
}
function deleteHuntFromLibrary(id) {
  LibraryCache = LibraryCache.filter(function (h) { return h.id !== id; });
  if (!IDB_SUPPORTED) { persistLibraryFallback(); return; }
  idbDelete(id).catch(function (err) {
    console.error(err);
    toast("Couldn't delete that hunt from browser storage: " + err.message, 7000);
  });
}
function saveCurrentHuntToLibrary(quiet) {
  var ok = upsertHuntInLibrary(Store.hunt);
  if (ok && !quiet) toast("Saved “" + Store.hunt.title + "” to your hunt library.");
  return ok;
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
      if (!hunt.schemaVersion || !hunt.nodes || !hunt.connections) throw new Error("File does not look like a ClueAtlas hunt export.");
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
      if (!hunt.schemaVersion || !hunt.nodes || !hunt.connections) throw new Error("File does not look like a ClueAtlas hunt export.");
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

// 30 widely-installed system/web-safe fonts, offered as quick-pick dropdown
// options for the typography fields. Each option is rendered in its own
// font (via an inline style) so the name previews the face. The stack
// value (not just the bare name) is what actually gets stored/applied,
// matching how style packs already declare fonts as CSS font stacks.
var SYSTEM_FONT_OPTIONS = [
  { label: "Arial", stack: "Arial, Helvetica, sans-serif" },
  { label: "Helvetica", stack: "Helvetica, Arial, sans-serif" },
  { label: "Verdana", stack: "Verdana, Geneva, sans-serif" },
  { label: "Tahoma", stack: "Tahoma, Geneva, sans-serif" },
  { label: "Trebuchet MS", stack: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: "Segoe UI", stack: "'Segoe UI', Tahoma, sans-serif" },
  { label: "Calibri", stack: "Calibri, Candara, sans-serif" },
  { label: "Candara", stack: "Candara, Calibri, sans-serif" },
  { label: "Century Gothic", stack: "'Century Gothic', Futura, sans-serif" },
  { label: "Futura", stack: "Futura, 'Century Gothic', sans-serif" },
  { label: "Gill Sans", stack: "'Gill Sans', 'Gill Sans MT', sans-serif" },
  { label: "Franklin Gothic Medium", stack: "'Franklin Gothic Medium', Arial, sans-serif" },
  { label: "Georgia", stack: "Georgia, 'Times New Roman', serif" },
  { label: "Times New Roman", stack: "'Times New Roman', Times, serif" },
  { label: "Palatino Linotype", stack: "'Palatino Linotype', Palatino, serif" },
  { label: "Book Antiqua", stack: "'Book Antiqua', Palatino, serif" },
  { label: "Garamond", stack: "Garamond, 'Times New Roman', serif" },
  { label: "Cambria", stack: "Cambria, Georgia, serif" },
  { label: "Constantia", stack: "Constantia, Georgia, serif" },
  { label: "Baskerville", stack: "Baskerville, 'Times New Roman', serif" },
  { label: "Rockwell", stack: "Rockwell, 'Courier New', serif" },
  { label: "Bookman Old Style", stack: "'Bookman Old Style', Bookman, serif" },
  { label: "Courier New", stack: "'Courier New', Courier, monospace" },
  { label: "Consolas", stack: "Consolas, 'Courier New', monospace" },
  { label: "Lucida Console", stack: "'Lucida Console', Monaco, monospace" },
  { label: "Monaco", stack: "Monaco, Consolas, monospace" },
  { label: "Impact", stack: "Impact, Haettenschweiler, sans-serif" },
  { label: "Comic Sans MS", stack: "'Comic Sans MS', cursive, sans-serif" },
  { label: "Papyrus", stack: "Papyrus, fantasy" },
  { label: "Brush Script MT", stack: "'Brush Script MT', cursive" }
];

function sbField(labelText, path, value, type) {
  return '<div class="field"><label>' + esc(labelText) + '</label><input type="' + (type || "text") + '" data-path="' + path + '" value="' + esc(value == null ? "" : value) + '" /></div>';
}
function sbFontField(labelText, path, value) {
  var isPreset = SYSTEM_FONT_OPTIONS.some(function (f) { return f.stack === value; });
  var options = '<option value=""' + (isPreset ? "" : " selected") + '>Custom (type below)…</option>' +
    SYSTEM_FONT_OPTIONS.map(function (f) {
      return '<option value="' + esc(f.stack) + '" style="font-family:' + esc(f.stack) + '"' + (f.stack === value ? " selected" : "") + '>' + esc(f.label) + '</option>';
    }).join("");
  return '<div class="field"><label>' + esc(labelText) + '</label>' +
    '<select data-fpath="' + path + '" class="font-pick-select">' + options + '</select>' +
    '<input type="text" data-path="' + path + '" value="' + esc(value == null ? "" : value) + '" placeholder="CSS font stack, e.g. Georgia, serif" style="margin-top:6px" />' +
  '</div>';
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
  html += sbFontField("Heading font", "typography.headingFont", p.typography.headingFont);
  html += sbFontField("Body font", "typography.bodyFont", p.typography.bodyFont);
  html += sbFontField("Mono font (codes / answers)", "typography.monoFont", p.typography.monoFont);
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
      var picker = box.querySelector('[data-fpath="' + path + '"]');
      if (picker) picker.value = SYSTEM_FONT_OPTIONS.some(function (f) { return f.stack === val; }) ? val : "";
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
  Array.prototype.forEach.call(box.querySelectorAll("[data-fpath]"), function (el) {
    el.onchange = function (e) {
      var path = el.dataset.fpath;
      var val = e.target.value;
      if (!val) return; // "Custom (type below)…" chosen — leave the typed stack in the text field alone
      setDeep(p, path, val);
      var twin = box.querySelector('[data-path="' + path + '"]');
      if (twin) twin.value = val;
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

/* ---------------------------------------------------------------------
   Player interpreter, and the Preview/Player UI controller factory
   (createPreviewController, renderPreviewNode, wirePreviewNodeInteractions,
   renderPinnedNode, openLeadNodes, hintsForNode) all now live in
   engine.js — see the destructured references above. What's left here is
   just Studio's two call sites: the full-screen Preview overlay (a frozen
   snapshot of the exported JSON) and the docked live mockup (below).
--------------------------------------------------------------------- */
var Preview, LiveMock;

/* ---------------------------------------------------------------------
   Player bottom tab bar — five buttons (Story/Leads/Map/Inventory/Hints)
   mirroring the canvas lanes. Tapping a tab jumps the mock/preview
   screen to a node in that lane within whatever scene is currently on
   screen, using the same pin mechanism as clicking a node on the canvas
   (ctl.showNode). Shared by both the docked mockup and the full-screen
   Preview overlay.
--------------------------------------------------------------------- */

// The node currently on screen in a preview controller, however it got
// there (a pinned/selected node, the expanded open lead, or a reached
// ending) — renderPinnedNode/render() in engine.js keep _activeIds.expandedId
// pointed at it in every case.
function currentPreviewNode(ctl) {
  if (!ctl.session) return null;
  var id = ctl._activeIds && ctl._activeIds.expandedId;
  if (!id) return null;
  return ctl.session.hunt.nodes.find(function (n) { return n.id === id; }) || null;
}

// Which Scene column the tab bar should search within: the scene of
// whatever's on screen, falling back to the hunt's first scene (or
// Unassigned) once nothing is showing yet (e.g. an empty state).
function currentSceneIdForCtl(ctl) {
  var node = currentPreviewNode(ctl);
  if (node) return node.sceneId || null;
  if (ctl.laneListId) return ctl.laneListSceneId || null; // a lane-list tap doesn't pin a node, but shouldn't lose the scene it was opened from
  var scenes = (ctl.session && ctl.session.hunt.scenes) || [];
  return scenes.length ? scenes[0].id : null;
}

// Pick the node a Story/Map lane tap should jump straight into: prefer
// whatever's currently an open (available, not yet completed) node in
// that lane+scene; failing that, the most recently completed one;
// failing that, just the first node placed there. (Leads/Inventory/Hints
// taps go through ctl.showLaneList instead — see LANE_LIST_TABS below —
// since those lanes can hold several available options at once.)
function nodeForLane(ctl, laneId) {
  if (!ctl.session) return null;
  var hunt = ctl.session.hunt, state = ctl.session.state;
  var sceneId = currentSceneIdForCtl(ctl);
  var inScene = hunt.nodes.filter(function (n) { return n.lane === laneId && (n.sceneId || null) === sceneId; });
  if (!inScene.length) return null;

  var open = inScene.find(function (n) { return state.available[n.id] && !state.completed[n.id]; });
  if (open) return open;
  for (var i = inScene.length - 1; i >= 0; i--) {
    if (state.completed[inScene[i].id]) return inScene[i];
  }
  return inScene[0];
}

// Lane tabs that show a scene-wide "everything currently available here"
// list (per laneOptionsForScene in engine.js) rather than jumping into a
// single node — Story and Map stay single-node jumps since they're
// linear/geographic, not a set of parallel options to choose among.
var LANE_LIST_TABS = { leads: true, inventory: true, hints: true };

// Notification badges — a connection that unlocks content in a lane other
// than the one the player is currently viewing doesn't jump the main panel
// there (see ctl.render()'s currentLane filtering in engine.js); instead
// the affected tab picks up a small count badge so the player knows
// something is waiting without losing their place. "New" = currently an
// option in laneOptionsForScene (same eligibility rule the Leads/
// Inventory/Hints list views already use) that the player hasn't yet
// dismissed by visiting that lane. Dismissal state lives in
// session.state.seenAvailable so it resets naturally with the session.
function laneBadgeCount(ctl, laneId) {
  if (!ctl.session) return 0;
  var nodes = laneOptionsForScene(ctl.session, laneId, currentSceneIdForCtl(ctl));
  var seen = ctl.session.state.seenAvailable || {};
  return nodes.filter(function (n) { return !seen[n.id]; }).length;
}
function dismissLane(ctl, laneId, sceneId) {
  if (!ctl.session) return;
  var nodes = laneOptionsForScene(ctl.session, laneId, sceneId !== undefined ? sceneId : currentSceneIdForCtl(ctl));
  var seen = ctl.session.state.seenAvailable || (ctl.session.state.seenAvailable = {});
  nodes.forEach(function (n) { seen[n.id] = true; });
}

function renderPlayerTabBar(ctl, tabBarEl) {
  if (!tabBarEl || !ctl.session) return;
  var current = currentPreviewNode(ctl);
  var activeLane = ctl.laneListId || (current ? current.lane : null);
  // Whatever lane the player is already looking at reads as "seen" on
  // every render, so its own badge never lights up just because it's the
  // lane something new landed in — only other lanes accumulate a count.
  if (activeLane) dismissLane(ctl, activeLane, currentSceneIdForCtl(ctl));

  tabBarEl.innerHTML = LANES.map(function (l) {
    var active = l.id === activeLane;
    var count = active ? 0 : laneBadgeCount(ctl, l.id);
    return '<button class="player-tab' + (active ? " active" : "") + '" data-lane="' + l.id + '"' +
      ' title="' + esc(l.label) + '" aria-label="' + esc(l.label) + '">' +
      '<span class="player-tab-icon">' + l.icon + '</span>' +
      (count > 0 ? '<span class="player-tab-badge">' + (count > 9 ? "9+" : count) + '</span>' : '') +
      '</button>';
  }).join("");

  Array.prototype.forEach.call(tabBarEl.querySelectorAll(".player-tab"), function (btn) {
    btn.onclick = function () {
      var laneId = btn.dataset.lane;
      dismissLane(ctl, laneId, currentSceneIdForCtl(ctl));
      if (LANE_LIST_TABS[laneId]) { ctl.showLaneList(laneId, currentSceneIdForCtl(ctl)); return; }
      var node = nodeForLane(ctl, laneId);
      if (node) ctl.showNode(node.id);
      else toast("No " + LANE_BY_ID[laneId].label.toLowerCase() + " content in this scene yet.");
    };
  });
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
  dom.gridLayer = document.getElementById("gridLayer");
  dom.edgeLayer = document.getElementById("edgeLayer");
  dom.nodeLayer = document.getElementById("nodeLayer");
  dom.canvasHint = document.getElementById("canvasHint");
  dom.marquee = document.getElementById("marquee");

  loadCustomStylePacksIntoRegistry();

  Store.view = { x: 60, y: 60, zoom: 1 };
  Store.init();

  Preview = createPreviewController(document.getElementById("previewMain"), document.getElementById("previewSide"));
  LiveMock = createPreviewController(document.getElementById("mockMain"), document.getElementById("mockSide"));

  var mockTabBarEl = document.getElementById("mockTabBar");
  var previewTabBarEl = document.getElementById("previewTabBar");
  LiveMock.onRender = function (ctl) { updateCanvasPlayerHighlight(ctl); renderPlayerTabBar(ctl, mockTabBarEl); };
  Preview.onRender = function (ctl) { renderPlayerTabBar(ctl, previewTabBarEl); };

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
  document.getElementById("btnAddSceneSide").onclick = function () { addScene(); };

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
  // Library must be loaded from IndexedDB (async) before the Library screen
  // reads it via getLibraryHunts(); see initLibraryStorage() above.
  initLibraryStorage().then(function () {
    showLibraryScreen();
    toast("Welcome to ClueAtlas Studio. Open a hunt from your library, or start a new one.", 4000);
  });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
