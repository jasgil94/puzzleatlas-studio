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
  videoStory: {
    family: "narrative", label: "Video Story", icon: "🎞️",
    defaultTitle: "New Video Story",
    // Video Reveal's narrative-family sibling, purpose-built for cutscene /
    // "level complete" style beats rather than a content reveal the player
    // browses at their own pace: the video starts playing itself the
    // instant this node becomes the active screen (no tap-to-play needed)
    // and the node completes itself the moment the video ends, advancing
    // straight into whatever connects out of it — no Continue button, no
    // player action required at all (see renderVideoStoryBlock/
    // wireVideoStoryPlayback below). Same videoAsset/caption/showControls
    // shape as Video Reveal, deliberately minus Video Reveal's `loop`
    // field — a looping video never fires the browser's "ended" event, so
    // it would never auto-advance, defeating the whole point of this node
    // type.
    defaultContent: function () { return { videoAsset: "", caption: "", showControls: false }; },
    summary: function (c) { return c.videoAsset ? "Video Story" + (c.caption ? " — " + c.caption : "") : "No video uploaded"; }
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
    defaultContent: function () { return { codeLength: 4, codeFormat: "numeric", acceptedCode: "1234", lockStyle: "classicBrass", appearance: "classic", showBackButton: false }; },
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
    defaultContent: function () { return { acceptedAnswers: ["CAT"], appearance: "classic", showBackButton: false }; },
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
      return { prompt: "Set each switch to the position that matches the code.", switches: switches, appearance: "classic", showBackButton: false };
    },
    summary: function (c) {
      var switches = c.switches || [];
      var onCount = switches.filter(function (s) { return s.requiredOn; }).length;
      return switches.length + " switches — " + onCount + " must end ON, " + (switches.length - onCount) + " OFF";
    }
  },
  ropeTying: {
    family: "puzzle", label: "Rope Tying", icon: "🪢",
    defaultTitle: "New Rope Tying Puzzle",
    // A square frame with 0-4 rope stubs per side (Left/Top/Right/Bottom,
    // independently configurable — see content.sides), each carrying its
    // own brass nameplate (content.ends[].label). The player taps two free
    // ends to tie them, tap a knot to untie it, then presses the node's
    // primary button (default label "Hoist" — see DEFAULT_BUTTON_LABEL
    // below) to check the current ties against content.correctPairs.
    // Adapted from the standalone rope-tying-puzzle.html prototype (a
    // fixed 2-ropes-per-side board with randomised colour pairing) into a
    // configurable node type: side counts, per-end label text and the
    // correct pairing are all set once in the Studio inspector (a
    // drag-and-drop pairing builder — see buildTypeSpecificFields/
    // wireNodeInspector in app.js) rather than randomised at load. See
    // renderRopeBoardSvg/wireRopeTyingInteractions/pv_action_submitRopeTying
    // below for the player-facing half.
    defaultContent: function () {
      var mkEnd = function (side) { return { id: uid("end"), side: side, label: "" }; };
      var ends = [];
      ["left", "top", "right", "bottom"].forEach(function (side) {
        for (var i = 0; i < 2; i++) ends.push(mkEnd(side));
      });
      return {
        prompt: "Tie each rope to its matching partner, then hoist.",
        sides: { left: 2, top: 2, right: 2, bottom: 2 },
        ends: ends,
        correctPairs: [],
        appearance: "classic",
        showBackButton: false
      };
    },
    summary: function (c) {
      var total = (c.ends || []).length;
      var pairs = (c.correctPairs || []).length;
      return total + " rope end(s) — " + pairs + " correct pair(s) set";
    }
  },
  lumenPuzzle: {
    family: "puzzle", label: "Lumen Beam Puzzle (Hex Grid)", icon: "🔆",
    defaultTitle: "New Lumen Puzzle",
    // A hex-grid light-routing puzzle: fixed light source(s) emit a beam
    // through a field of hexes; the player drags/taps mirrors and lenses
    // (placed by the creator, see content.pieces) to rotate them in 15°
    // steps and route the beam(s) onto every target at the intensity each
    // target's own condition demands (content.targets — at least/at most/
    // between/approximately, same shape as the standalone builder). Walls
    // and opaque cards (content.walls/content.cards) block beams; sources
    // are opaque cylinders with a narrow emission slit, so beams can also be
    // blocked by (or graze) another source's housing. Auto-validates after
    // every rotation — no submit button — same family as Fuse Panel/Sliding
    // Tile: the node completes the instant every target's condition is met
    // simultaneously (see pv_action_submitLumenPuzzle below).
    //
    // Adapted from the standalone lumen-puzzle-builder.html prototype (a
    // full multi-level project editor with a placement palette) into this
    // node type: one node = one level. The creator designs the level using
    // the same hex-grid placement UI, embedded directly in the Studio
    // inspector (see buildTypeSpecificFields/wireNodeInspector's
    // "lumenPuzzle" case in app.js), and the exact same geometry/beam-
    // tracing math (lumenComputeGeometry/lumenTraceAllBeams, defined further
    // down and exported as PAEngine.lumen*) drives both that design-time
    // preview and the real player screen (see the "lumenPuzzle" branch in
    // renderPreviewNode and wireLumenPuzzleInteractions, below), so there's
    // one shared implementation of the hex trigonometry and beam physics
    // rather than two.
    defaultContent: function () {
      return {
        prompt: "Rotate the mirrors and lenses to route the beam onto every target.",
        gridSize: 8,
        // fieldShape: "square" (default, every hex in the N×N offset field) or
        // "circle" (only hexes within radius of the field's center hex — see
        // lumenForEachGridHex/lumenHexCubeDistance below). Purely a level-design
        // choice; doesn't change the coordinate system pieces are stored in, so
        // switching it after placing pieces is safe (some may just end up
        // outside the new field, same as shrinking gridSize already allows).
        fieldShape: "square",
        sources: [{ id: uid("lsrc"), q: 0, r: 4, kind: "center", idx: 0, angle: 0 }],
        pieces: [{ id: uid("lpc"), type: "mirror", q: 1, r: 2, kind: "center", idx: 0, angle: 45 }],
        targets: [{ id: uid("ltg"), q: 4, r: 4, kind: "center", idx: 0, mode: "atleast", min: 0.8, max: 3, value: 1.5, tolerance: 0.15 }],
        walls: [],
        cards: [],
        appearance: "classic",
        showBackButton: false
      };
    },
    summary: function (c) {
      return (c.sources || []).length + " source(s), " + (c.pieces || []).length + " piece(s), " + (c.targets || []).length + " target(s)";
    }
  },
  gearPulley: {
    family: "puzzle", label: "Gear & Pulley Builder", icon: "⚙️",
    defaultTitle: "New Gear & Pulley Puzzle",
    // A mesh-graph gear puzzle: the creator places one handle and one hoist
    // (fixed, one-of-a-kind pivots) plus any number of axles between them on
    // a 900×620 board, and gives every piece a tooth count — two gears
    // "mesh" (drive each other) when the distance between their centers
    // exactly equals the sum of their pitch radii (see gpRadiusOf/
    // gpComputeMesh below), same physical rule as the standalone
    // gear-pulley-builder.html prototype this was adapted from. A layout is
    // solved when a chain of meshed gears connects the handle to the hoist
    // (gpSolveState — a breadth-first reachability walk over the mesh
    // graph, identical to the prototype's solveState).
    //
    // At player-time the positions are fixed exactly as designed, but each
    // axle's tooth count is hidden: the player only sees an empty socket at
    // each axle position and a tray of cogs (one per axle's correct tooth
    // count, plus content.decoyTeeth extra wrong-sized cogs) at the bottom
    // of the screen. Tapping a tray cog then an empty socket drops it in;
    // tapping a filled socket lifts it back out. The mesh/clash lines
    // (green solid / red dashed) redraw live after every placement — the
    // same visual feedback the creator sees while designing — so working
    // out which cog fits which post is the whole puzzle. Auto-validates the
    // instant the handle-to-hoist chain connects — no submit button, same
    // family as Fuse Panel/Lumen Puzzle/Category Grid (see
    // pv_action_submitGearPulley below).
    //
    // The creator designs the layout using the same select/place/drag-to-
    // snap board UI as the prototype, embedded directly in the Studio
    // inspector (see buildTypeSpecificFields/wireNodeInspector's
    // "gearPulley" case in app.js), and the exact same radius/mesh/solve
    // math (gpRadiusOf/gpGearPathD/gpComputeMesh/gpSolveState, defined
    // further down and exported as PAEngine.gp*) drives both that
    // design-time board and the real player screen (see the "gearPulley"
    // branch in renderPreviewNode and wireGearPulleyInteractions, below) —
    // one shared implementation of the geometry rather than two. Unlike
    // Lumen Puzzle, the player-facing rendering deliberately differs from
    // the design-time one (axle teeth hidden behind a tray instead of shown
    // outright), so only the math is shared, not the drawing code.
    defaultContent: function () {
      return {
        prompt: "Fit the right cogs onto the axles so the drive connects the handle to the hoist.",
        handle: { x: 150, y: 310, teeth: 14 },
        hoist: { x: 464.4, y: 310, teeth: 14 },
        axles: [
          { id: uid("gpax"), x: 254.8, y: 310, teeth: 14 },
          { id: uid("gpax"), x: 359.6, y: 310, teeth: 14 }
        ],
        decoyTeeth: [10, 20],
        appearance: "classic",
        showBackButton: false
      };
    },
    summary: function (c) {
      var axleCount = (c.axles || []).length;
      var decoyCount = (c.decoyTeeth || []).length;
      return axleCount + " axle(s), " + decoyCount + " decoy cog(s) in the tray";
    }
  },
  weightScale: {
    family: "puzzle", label: "Weight Scale Builder", icon: "⚖️",
    defaultTitle: "New Weight Scale Puzzle",
    // A two-pan balance scale, ported from the standalone
    // balance-scale-puzzle.html prototype: the creator lists up to
    // WS_MAX_ITEMS tokens (see below), each with a hidden weight plus either
    // a preset shape+colour or an uploaded photo, in a builder pane embedded
    // directly in the Studio inspector (buildTypeSpecificFields/
    // wireNodeInspector's "weightScale" case in app.js — a flat resizable
    // list, no spatial designer needed, so unlike Gear & Pulley/Lumen Puzzle
    // there's no shared geometry math to export). At player-time every
    // token starts in a tray below the scale; tapping a token then tapping
    // the tray or a pan moves it there (same "select then act" shape as
    // Gear & Pulley's cog tray — see wireWeightScaleInteractions below).
    // Weights are never shown until the puzzle is solved. Auto-validates
    // the instant every token is off the tray and the two pans' totals
    // exactly match (see pv_action_submitWeightScale) — same "auto-validate,
    // withhold while incomplete" family as Category Grid/Gear & Pulley.
    // The stage itself (renderWeightScaleStage) is plain positioned HTML
    // (not SVG) but every position/size is a percentage of a fixed 640×400
    // virtual coordinate space rather than a pixel value, and the pans use
    // flex-wrap for their token contents — so, same as the SVG viewBox
    // trick Gear & Pulley/Lumen Puzzle use, the whole scale (and however
    // many tokens end up piled on one pan) is always rendered in full at
    // any container width, never clipped or overflowing sideways.
    defaultContent: function () {
      return {
        prompt: "Tap a token, then tap the tray or a pan to move it there. Watch which way the beam tips, and keep rearranging until it settles perfectly level.",
        items: [
          { id: uid("wsit"), kind: "shape", shape: "circle", color: "#c0524a", weight: 4, imageAsset: "" },
          { id: uid("wsit"), kind: "shape", shape: "square", color: "#3f8f8f", weight: 7, imageAsset: "" },
          { id: uid("wsit"), kind: "shape", shape: "triangle", color: "#c9a233", weight: 9, imageAsset: "" },
          { id: uid("wsit"), kind: "shape", shape: "hexagon", color: "#5c7a35", weight: 10, imageAsset: "" },
          { id: uid("wsit"), kind: "shape", shape: "star", color: "#9c4368", weight: 12, imageAsset: "" },
          { id: uid("wsit"), kind: "shape", shape: "pentagon", color: "#4a5a91", weight: 14, imageAsset: "" }
        ],
        appearance: "classic",
        showBackButton: false
      };
    },
    summary: function (c) {
      var items = c.items || [];
      var total = items.reduce(function (s, it) { return s + (Number(it.weight) || 0); }, 0);
      return items.length + " token(s), total weight " + total + (total % 2 !== 0 ? " (odd — no exact balance is possible!)" : "");
    }
  },
  categoryGrid: {
    family: "puzzle", label: "Category Grid (3×3 Image Puzzle)", icon: "🖼️",
    defaultTitle: "New Category Grid",
    // A 3x3 grid of 9 creator-supplied images. Each image declares two
    // "first category" partners and two "second category" partners — the
    // other two images it's meant to share a hidden category with (see the
    // caGrid* helpers further down, shared with the player runtime below
    // and Studio's inspector — buildTypeSpecificFields/wireNodeInspector's
    // "categoryGrid" case in app.js). A correct arrangement is *any* 3x3
    // layout where every row of three and every column of three shares one
    // of the 6 categories — there's deliberately no single correct order
    // or orientation (rows/columns aren't pinned to "first"/"second"
    // category, and the whole grid can be reflected or rotated), and the
    // 6 category names are never shown to the player until they solve it.
    // See caGridCheckSolution for the exact centre-out check order the
    // design spec calls for, and wireCategoryGridInteractions for the
    // drag/drop + tap-to-swap board.
    defaultContent: function () {
      var imgs = [];
      for (var i = 0; i < 9; i++) imgs.push({ id: uid("cgimg"), title: "Image " + (i + 1), imageAsset: "", firstPartners: [], secondPartners: [] });
      // Default example: a ready-to-play, already-valid 3x3 grouping (first
      // category = rows of 3 by index, second category = columns of 3 by
      // index) so a freshly-added node isn't an unsolvable blank slate.
      imgs.forEach(function (im, i) {
        var rowGroup = Math.floor(i / 3), colGroup = i % 3;
        im.firstPartners = imgs.filter(function (x, xi) { return Math.floor(xi / 3) === rowGroup && xi !== i; }).map(function (x) { return x.id; });
        im.secondPartners = imgs.filter(function (x, xi) { return xi % 3 === colGroup && xi !== i; }).map(function (x) { return x.id; });
      });
      return {
        body: "Arrange the 9 images into the grid so that every row of three and every column of three shares a hidden category.",
        bodyFontSize: 15,
        images: imgs,
        categoryNames: { first: ["Category 1", "Category 2", "Category 3"], second: ["Category 4", "Category 5", "Category 6"] },
        // Off by default — an image's title is a creator-facing reference
        // name (used in the partner dropdowns/categories list) rather than
        // something meant for the player, unless the creator opts in. See
        // caGridPieceHtml below and the "Show image titles to player"
        // toggle in buildCategoryGridFields/wireCategoryGridFields (app.js).
        showImageTitles: false,
        showBackButton: false
      };
    },
    summary: function (c) {
      var v = caGridValidate(c);
      return (c.images || []).length + " images — " + (v.valid ? "grouping OK" : "⚠ " + v.issues[0]);
    }
  },
  constraintSatisfaction: {
    family: "puzzle", label: "Constraint Satisfaction Puzzle", icon: "⚖️",
    defaultTitle: "New Constraint Satisfaction Puzzle",
    // The player is handed a fixed pool of up to 6 item types (content.items)
    // and must split every last one of them across up to 6 recipients
    // (content.recipients) so each recipient ends up holding exactly the
    // count of each item set on recipient.requirements[itemId] (0 when
    // absent). There's no separate "pool size" field to keep in sync — the
    // total of a given item the player is handed is simply the sum of every
    // recipient's requirement for it (see cspItemTotal below, shared with
    // the player runtime and Studio's inspector/builder pane), so the puzzle
    // is always exactly solvable by construction and a creator only ever
    // edits one set of numbers. content.body is the requirements/clue text
    // the player reads to work out those per-recipient counts for
    // themselves; content.answerTitle is a short heading shown above the
    // answer entry grid. See renderPreviewNode's "constraintSatisfaction"
    // branch and wireConstraintSatisfactionInteractions further down for the
    // player-facing half (a top-right toggle swaps the whole screen between
    // the requirements text and the answer entry grid — see content mode in
    // ctl.cspDraft), and buildConstraintSatisfactionFields/
    // wireConstraintSatisfactionFields in app.js for the Studio inspector.
    defaultContent: function () {
      var items = [], recipients = [];
      for (var i = 0; i < 3; i++) items.push({ id: uid("cspit"), name: "Item " + (i + 1), imageAsset: "" });
      for (var r = 0; r < 3; r++) {
        var req = {};
        req[items[r].id] = 2;
        recipients.push({ id: uid("csprec"), name: "Recipient " + (r + 1), requirements: req });
      }
      return {
        body: "Write the requirements text that tells the player how the items should be distributed.",
        bodyFontSize: 15,
        answerTitle: "Distribute the items",
        answerTitleFontSize: 16,
        items: items,
        recipients: recipients,
        showBackButton: false
      };
    },
    summary: function (c) {
      var items = c.items || [], recipients = c.recipients || [];
      return items.length + " item(s) — " + recipients.length + " recipient(s)";
    }
  },
  lockAndKey: {
    family: "puzzle", label: "Lock and Key", icon: "🔒",
    defaultTitle: "New Lock and Key Puzzle",
    // A simple padlock, with a Key node's art hanging below it on a
    // foreshortened metal ring (the ring is a Keychain node — see the
    // "key"/"keychain" entries below). Which keys are "on the ring" is
    // never authored on this node directly: it's resolved live, at both
    // design-time and player-time, by walking this node's one incoming
    // "keychain supply" connection back to the Keychain that drew it, then
    // collecting every Key that Keychain itself connects to (see
    // lockAndKeySupplyConnection/lockAndKeyOptions further down, shared by
    // the player runtime and the Studio inspector's "correct key" picker —
    // buildTypeSpecificFields's "lockAndKey" case in app.js). The
    // "keychain supply" connection is auto-marked with
    // condition:{type:"keychainSupply"} the instant a creator drags a
    // connection from a Keychain node onto this node type (see
    // Store.addConnection in app.js) — purely a structural pointer, not a
    // real availability-granting condition (evaluateCondition's default
    // case returns false for it), so this node still needs its own
    // ordinary incoming connection from earlier content to ever become
    // available/reachable, same as any other puzzle node.
    //
    // Tapping the padlock (wireLockAndKeyInteractions below) tries
    // whichever key is currently swiped to the front of the ring against
    // content.correctKeyNodeId (chosen by the creator in the inspector,
    // limited to whatever the supplying Keychain offers). A wrong key lets
    // the padlock travel only as far as the top of the key art before
    // bouncing back with "Wrong key"; the correct key lets it continue on
    // down to that key's own blade/bow threshold (content.threshold on the
    // Key node), at which point the shackle pops open.
    defaultContent: function () {
      return { prompt: "Find the right key on the ring and unlock the padlock.", correctKeyNodeId: "", appearance: "classic", showBackButton: false };
    },
    summary: function (c, hunt) {
      if (!c.correctKeyNodeId) return "No correct key chosen yet";
      var keyNode = (hunt.nodes || []).find(function (n) { return n.id === c.correctKeyNodeId; });
      return "Correct key: " + (keyNode ? (keyNode.content.name || keyNode.title) : "(missing key)");
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
  key: {
    family: "state", label: "Key", icon: "🔑",
    defaultTitle: "New Key",
    // A single physical key, meant to sit in the Inventory lane like Award
    // Item. content.name is what the player reads in their Inventory (kept
    // separate from the node's own title, which is only the creator-facing
    // canvas label). content.imageAsset is a photo of the key uploaded by
    // the creator; content.threshold is a 0-100 percentage, set via a
    // slider over that photo in the inspector (buildKeyFields in app.js),
    // marking where the blade (always the upper part of the photo) ends
    // and the bow (always the lower part) begins. Nothing here enforces
    // photo orientation — the creator is expected to upload the key
    // blade-up, per the Lock and Key puzzle's own doc comment above. A Key
    // node only ever matters to the player once a Keychain node connects
    // to it (see the "keychain" entry directly below) and, through that
    // keychain, to a Lock and Key puzzle.
    defaultContent: function () { return { name: "Key", imageAsset: "", threshold: 55, showBackButton: false }; },
    summary: function (c) { return (c.name || "Key") + (c.imageAsset ? "" : " — no image set yet"); }
  },
  keychain: {
    family: "state", label: "Keychain", icon: "🗝️",
    defaultTitle: "New Keychain",
    // Also sits in the Inventory lane. A Keychain has no content of its
    // own beyond a display name — what it "holds" is entirely read off the
    // ordinary graph connections drawn out of it on the canvas: one
    // outgoing connection per Key node it carries, plus (usually) one more
    // outgoing connection into a Lock and Key puzzle node, which
    // Store.addConnection (app.js) auto-tags with
    // condition:{type:"keychainSupply"} the moment it's drawn, so the
    // puzzle on the other end always knows which keychain (and therefore
    // which keys) is supplying it. See lockAndKeyOptions further down for
    // the shared lookup that walks both connections.
    defaultContent: function () { return { name: "Keychain", showBackButton: false }; },
    summary: function (c) { return c.name || "Keychain"; }
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
      return { forNodeId: "", stages: [{ id: uid("hs"), text: "First, gentle nudge.", delayMinutes: 0, delaySeconds: 0 }, { id: uid("hs"), text: "A stronger hint.", delayMinutes: 1, delaySeconds: 0 }] };
    },
    summary: function (c, hunt) { return "For: " + nodeTitle(hunt, c.forNodeId) + " (" + (c.stages || []).length + " stages)"; }
  },
  hintUnlockCost: {
    family: "support", label: "Hint Unlock Cost", icon: "🔓",
    defaultTitle: "Hint (with unlock cost)",
    defaultContent: function () {
      return { forNodeId: "", costType: "score", costPerStage: 1, stages: [{ id: uid("hs"), text: "First, gentle nudge.", delayMinutes: 0, delaySeconds: 0 }, { id: uid("hs"), text: "A stronger hint.", delayMinutes: 1, delaySeconds: 0 }] };
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
    // videoAsset: the uploaded video itself, stored as a data URI — same
    // "no backend, stash it on the node" pattern as imageAsset/pdfAsset.
    // The video always fits to the screen at player-time (object-fit:
    // contain, no cropping — see renderVideoRevealBlock below), so unlike
    // Image Reveal there's no aspect-ratio/crop system here. showControls
    // toggles the browser's native control bar (play/pause, scrub, volume)
    // on or off — when off, a minimal custom play/pause tap target is
    // shown instead so the player still has *some* way to start it (see
    // wireVideoRevealPlayback). Off by default would strand the player
    // with an unplayable video, so it defaults on.
    defaultContent: function () { return { videoAsset: "", caption: "", showControls: true, loop: false, showBackButton: false }; },
    summary: function (c) { return c.videoAsset ? "Video" + (c.caption ? " — " + c.caption : "") + (c.showControls === false ? " — controls hidden" : "") : "No video uploaded"; }
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
  cellPhone: {
    family: "media", label: "Cell Phone", icon: "📱",
    defaultTitle: "New Cell Phone",
    // A self-contained, replayable prop rather than a one-shot content
    // reveal or puzzle: unlike every other PLAYER_SCREEN_TYPES entry it
    // never calls completeNodeInternal/pv_action_* and so never sets
    // state.completed[n.id] — it's meant to be placed in the Inventory
    // lane (see SUGGESTED_LANE.cellPhone in app.js), reached once via a
    // normal "Grant Item" connection into it, and then opened from the
    // player's Inventory tab as many times as they like for the rest of
    // the hunt (renderLaneOptionsList's "inventory" branch renders it as
    // a clickable entry, same [data-lead]/ctl.showNode mechanism as
    // Leads — see engine.js). Its own screen has fully custom internal
    // navigation (a D-pad + Back/Menu softkeys drawn as part of the phone
    // graphic, not the shared showBackButton field every other type uses)
    // — see the "cellPhone" branch of renderPreviewNode/
    // wireCellPhoneInteractions below and ctl.phoneNav in
    // createPreviewController.
    //
    // sections: which of the three built-in apps show as icons on the
    // phone's home screen — a builder can enable just the ones they're
    // using (e.g. an SMS-only prop doesn't need to show empty Calls/
    // Voicemails icons).
    //
    // contacts: entries in the Calls app. Each is
    // { id, name, numbers: "comma, separated, digit, strings",
    //   audioAsset, showInContacts }. numbers is matched against whatever
    // the player dials on the keypad (see normalizePhoneDigits) — a
    // contact can also be left out of the browsable contacts list
    // (showInContacts: false) so it's only reachable by a player who's
    // found the number elsewhere in the hunt and dials it from memory,
    // same spirit as a Physical Lock Code's real-world prop. audioAsset
    // plays after a short ringing tone once the call connects; a dialled
    // number matching no contact instead gets a busy/engaged tone and
    // never connects (see playEngagedTone/playRingTone).
    //
    // voicemails: entries in the Voicemails app — { id, name, audioAsset }
    // — a flat list, tap a name to play its clip.
    //
    // smsThreads: entries in the SMS app — { id, name, messages }, each
    // message { id, text, sent } where sent=true renders right-aligned
    // (player's own outgoing message) and sent=false renders left-aligned
    // (received) — same left/right convention as a real SMS app.
    defaultContent: function () {
      return {
        sections: { calls: true, voicemails: true, sms: true },
        contacts: [],
        voicemails: [],
        smsThreads: []
      };
    },
    summary: function (c) {
      var parts = [];
      parts.push((c.contacts || []).length + " contact(s)");
      parts.push((c.voicemails || []).length + " voicemail(s)");
      parts.push((c.smsThreads || []).length + " SMS thread(s)");
      return parts.join(", ");
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
  },
  controlPanel: {
    family: "puzzle", label: "Control Panel Builder", icon: "🎛️",
    defaultTitle: "New Control Panel",
    // A freeform hardware-panel puzzle: the creator places any number of
    // interactive components (switches, sliders, rotary knobs, push
    // buttons), conditional readouts (lights, gauges, digital displays)
    // and static dressing (images/GIFs, editable labels, shapes) onto a
    // two-tier board — an upper "wall" section and a lower "desk" section,
    // either of which can be set to 0 height to use just one (see
    // content.board/content.components below). Every component is freely
    // positioned, sized and rotated. Conditional components don't have
    // their own interaction: each carries a small ordered list of rules
    // (content.components[i].data.rules), evaluated top to bottom against
    // the live values of the panel's interactive components, first match
    // wins — same "component + operator + value" shape as Lumen Puzzle's
    // target conditions (see CTP_OP_LABELS/ctpEvalRules below), just
    // scoped to this node's own components instead of the hex grid. The
    // panel as a whole is solved when every entry in content.winConditions
    // is satisfied simultaneously (auto-validates on every interaction,
    // same "no submit button" family as Fuse Panel/Lumen Puzzle/Gear &
    // Pulley — see pv_action_submitControlPanel below). The creator builds
    // the board in the inspector-embedded designer (buildTypeSpecificFields/
    // wireNodeInspector's "controlPanel" case in app.js), and the exact
    // same widget markup (ctpComponentInnerHtml) and condition evaluator
    // (ctpEvalRules/ctpWinConditionsMet) drive both that design-time board
    // and the real player screen (see the "controlPanel" branch in
    // renderPreviewNode and wireControlPanelInteractions, below) — one
    // shared implementation of the visuals and logic, not two.
    defaultContent: function () {
      return {
        prompt: "Set the controls to bring the panel online.",
        board: { width: 640, upperHeight: 220, lowerHeight: 260 },
        components: [],
        winConditions: [],
        appearance: "classic",
        showBackButton: false
      };
    },
    summary: function (c) {
      var comps = c.components || [];
      var interactiveCount = comps.filter(function (x) { var k = ctpComponentKind(x.type); return k === "boolean" || k === "index" || k === "numeric"; }).length;
      var outputCount = comps.filter(function (x) { return ctpComponentKind(x.type) === "output"; }).length;
      return comps.length + " component(s) — " + interactiveCount + " interactive, " + outputCount + " readout(s), " + (c.winConditions || []).length + " win condition(s)";
    }
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

/* ---------------------------------------------------------------------
   Appearance — a per-node cosmetic skin choice offered on every physical-
   prop puzzle type (Physical Lock Code, Cryptex, Fuse Panel, Rope Tying,
   Lumen Beam, Gear & Pulley, Weight Scale, Lock and Key, Control Panel).
   "classic" reproduces each node's original look untouched. "darkMaritime"
   re-renders the same prop as a two-colour engraved scratchboard print —
   19th-century adventure-book illustration plate — strictly pale-aqua ink
   on near-black-green, no gradients/shadows/opacity shading; depth comes
   only from line density, cross-hatching and solid shape. Purely
   presentational, same as LOCK_STYLES below — never affects what counts as
   a correct answer. See dmDefs/dmClass and the DM_* helpers just below for
   the shared engraving toolkit every puzzle's darkMaritime branch draws
   from, so the nine illustrations read as one consistent art style rather
   than nine separate ones. */
var APPEARANCES = {
  classic:      { label: "Classic" },
  darkMaritime: { label: "Dark Maritime" }
};
function nodeAppearance(c) { return c && c.appearance === "darkMaritime" ? "darkMaritime" : "classic"; }
function isDarkMaritime(c) { return nodeAppearance(c) === "darkMaritime"; }

var DM_INK = "#BEE9E8";   // pale aqua — every line, hatch stroke and light shape
var DM_VOID = "#001514";  // near-black green — every ground/solid shape

// Shared <defs> pattern library for the engraved look — diagonal single-
// direction hatch (mid tone), crosshatch (dark tone) and a wavy wood-grain
// hatch, all drawn as plain strokes in DM_INK over a DM_VOID ground so no
// gradient/opacity trick is ever needed to fake shading. idp namespaces the
// pattern ids per node instance (same convention as every other *idp*
// prefix in this file — see renderCryptexSvg etc.) so several different
// darkMaritime illustrations never clash if more than one is ever on
// screen at once (e.g. Back-peek behind a live node).
function dmDefs(idp) {
  return (
    '<pattern id="' + idp + 'dmH1" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<rect width="7" height="7" fill="' + DM_VOID + '"/><line x1="0" y1="0" x2="0" y2="7" stroke="' + DM_INK + '" stroke-width="1.2"/>' +
    '</pattern>' +
    '<pattern id="' + idp + 'dmH2" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">' +
      '<rect width="5" height="5" fill="' + DM_VOID + '"/><line x1="0" y1="0" x2="0" y2="5" stroke="' + DM_INK + '" stroke-width="1.2"/>' +
    '</pattern>' +
    '<pattern id="' + idp + 'dmX" width="6" height="6" patternUnits="userSpaceOnUse">' +
      '<rect width="6" height="6" fill="' + DM_VOID + '"/><path d="M0 0L6 6M6 0L0 6" stroke="' + DM_INK + '" stroke-width="1.1"/>' +
    '</pattern>' +
    '<pattern id="' + idp + 'dmWood" width="13" height="9" patternUnits="userSpaceOnUse">' +
      '<rect width="13" height="9" fill="' + DM_VOID + '"/>' +
      '<path d="M-1 2 Q4 0.5 7 2 T15 2 M-1 5 Q4 3.3 7 5 T15 5 M-1 8 Q4 6.6 7 8 T15 8" stroke="' + DM_INK + '" stroke-width="0.9" fill="none"/>' +
    '</pattern>' +
    '<pattern id="' + idp + 'dmRope" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(28)">' +
      '<rect width="9" height="9" fill="' + DM_VOID + '"/>' +
      '<line x1="0" y1="0" x2="0" y2="9" stroke="' + DM_INK + '" stroke-width="1.4"/><line x1="4.5" y1="0" x2="4.5" y2="9" stroke="' + DM_INK + '" stroke-width="0.8"/>' +
    '</pattern>' +
    '<pattern id="' + idp + 'dmDot" width="6" height="6" patternUnits="userSpaceOnUse">' +
      '<rect width="6" height="6" fill="' + DM_VOID + '"/><circle cx="1.2" cy="1.2" r="1" fill="' + DM_INK + '"/>' +
    '</pattern>'
  );
}
// Convenience fill refs into the pattern library above — void (flat solid
// ground), ink (flat solid line colour), hatch1/hatch2/cross (three
// densities of shading, light to dark), wood, rope, dot (stipple, lightest
// texture — distant/background tone).
function dmFill(idp, which) {
  if (which === "ink") return DM_INK;
  if (which === "void") return DM_VOID;
  return 'url(#' + idp + 'dm' + { hatch1: "H1", hatch2: "H2", cross: "X", wood: "Wood", rope: "Rope", dot: "Dot" }[which] + ')';
}

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

/* Lock and Key — layout constants for the padlock/key-ring stage (shared
   between the render branch that lays the stage out and
   wireLockAndKeyInteractions, which animates the padlock along the same
   vertical axis — kept as one source of truth rather than duplicated
   literals in both places, same convention as the combination-lock
   constants just above). Everything is a plain top-offset in pixels
   within the fixed-size .pv-lk-stage (see styles.css), since the stage,
   the key art box and the padlock are all fixed dimensions regardless of
   the uploaded photo's own resolution/aspect ratio (object-fit: cover) —
   that fixed geometry is what lets this be worked out arithmetically
   instead of measuring the live DOM.
   LK_PADLOCK_BODY_H must equal .pv-lk-padlock/.pv-lk-body's own CSS
   height exactly (the shackle overflows above the box on a negative
   `top` offset — see .pv-lk-shackle in styles.css — so it never adds to
   this box's own height). Two constraints size this stage: it all has to
   fit inside a real player screen without scrolling (a taller-than-tall
   version of this stage was clipping/scrolling badly), and
   LK_PADLOCK_BODY_H has to stay >= LK_KEY_H so the padlock's body is
   always at least as tall as the key art itself — that's what guarantees
   the body fully covers the blade (everything from the key's top down to
   its own threshold line) the instant it reaches the "correct" position,
   for *any* threshold value a creator sets, not just typical ones (see
   the correctness argument in lkPadlockTop's own comment below). */
var LK_STAGE_H = 380;          // px height of the whole stage
var LK_KEY_H = 110;            // px height of the key-art box, bottom-anchored in the stage (so it appears to hang from the ring)
var LK_PADLOCK_BODY_H = 140;   // px height of the padlock's body box (not counting the shackle, which overflows above it) — must match .pv-lk-padlock/.pv-lk-body height in styles.css; kept > LK_KEY_H so the body always fully covers the blade once seated (see comment above)
var LK_PADLOCK_IDLE_TOP = 100; // px top offset of the padlock's resting position, before any attempt — leaves room above for the shackle's overhang (see .pv-lk-shackle's `top` offset in styles.css) and sits a bit further down the stage than a bare minimum idle position would, so it doesn't read as pinned to the very top of the screen

// Resolves the padlock's `top` (px, within .pv-lk-stage) for a given
// state: "idle" is its resting position; "wrong" stops it the instant its
// body would touch the top of the key art (it can't go any further in);
// "correct" (thresholdPct = the attempted key's own content.threshold)
// seats the body's *bottom* edge exactly on that key's blade/bow line —
// since the body is LK_PADLOCK_BODY_H tall and that's >= LK_KEY_H, its
// top edge always lands at or above the key's own top edge, so the body
// fully covers the blade (the whole span from the key's top down to the
// threshold line) no matter how high or low a creator sets that
// threshold. Shared by the initial render (renderPreviewNode's
// "lockAndKey" branch, for the idle/solved resting states) and the tap
// handler's animation (wireLockAndKeyInteractions, for the interactive
// wrong/correct states).
function lkPadlockTop(state, thresholdPct) {
  var keyTop = LK_STAGE_H - LK_KEY_H;
  if (state === "wrong") return keyTop - LK_PADLOCK_BODY_H;
  if (state === "correct") {
    var t = Number(thresholdPct);
    if (!isFinite(t)) t = 50;
    t = Math.max(0, Math.min(100, t));
    var thresholdY = keyTop + (t / 100) * LK_KEY_H;
    return thresholdY - LK_PADLOCK_BODY_H;
  }
  return LK_PADLOCK_IDLE_TOP; // "idle" (and any unrecognized state — fail safe to resting position)
}

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

// Lock and Key — the one incoming connection into a Lock and Key puzzle
// node that's tagged condition:{type:"keychainSupply"} (auto-assigned by
// Store.addConnection in app.js the moment a creator connects a Keychain
// node to one — see the "keychainSupply" comment on NODE_TYPES.lockAndKey
// above), or null if no Keychain currently supplies this puzzle.
function lockAndKeySupplyConnection(hunt, puzzleNodeId) {
  return (hunt.connections || []).find(function (c) {
    return c.targetId === puzzleNodeId && c.condition && c.condition.type === "keychainSupply";
  }) || null;
}
// Every Key node "on the ring" for a given Lock and Key puzzle: find the
// Keychain feeding it (lockAndKeySupplyConnection, above), then collect
// every Key that Keychain itself has its own outgoing connection to.
// Shared by the player runtime (renderPreviewNode/wireLockAndKeyInteractions
// below) and the Studio inspector's "correct key" picker
// (buildTypeSpecificFields's "lockAndKey" case in app.js) so the ring's
// contents and the builder's dropdown of choices can never drift apart.
function lockAndKeyOptions(hunt, puzzleNodeId) {
  var supply = lockAndKeySupplyConnection(hunt, puzzleNodeId);
  if (!supply) return [];
  var keyIds = (hunt.connections || [])
    .filter(function (c) { return c.sourceId === supply.sourceId; })
    .map(function (c) { return c.targetId; });
  return (hunt.nodes || []).filter(function (n) { return n.type === "key" && keyIds.indexOf(n.id) !== -1; });
}

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

// Returns an independent deep copy of `node`, ready to insert into
// hunt.nodes as a brand-new node: a fresh id, "copy" appended to the title,
// and any manual canvas placement (cellPos — see computeLayout in app.js)
// cleared so Studio auto-stacks it rather than sitting exactly on top of the
// original. Every other feature — content, effects, creator notes, lane/
// scene placement — comes across untouched.
//
// The one deliberate exception is connections: hunt.connections is a flat,
// hunt-level list, so the copy naturally starts with none (nothing here
// touches hunt.connections). But two node-content fields — Story Block/
// Clickable Image completion buttons and Clickable Image hotspots — each
// carry their own connectionId pointing at one specific Connection object
// owned by the original node (see setStoryButtonConnection/openHotspotBuilder
// in app.js). Left alone those would dangle (the id would no longer belong
// to a connection sourced from this node), so they're reset to unassigned
// here too — the button/hotspot itself (its label, order, points) is still
// copied, only its connection assignment is cleared.
function duplicateNode(node) {
  var copy = clone(node);
  copy.id = uid("n");
  var def = NODE_TYPES[node.type];
  copy.title = (node.title || (def && def.defaultTitle) || "Node") + " copy";
  delete copy.cellPos;
  var c = copy.content;
  if (c) {
    if (Array.isArray(c.buttons)) {
      c.buttons.forEach(function (b) { if (b.kind !== "back") b.connectionId = ""; });
    }
    if (Array.isArray(c.hotspots)) {
      c.hotspots.forEach(function (h) { h.connectionId = ""; });
    }
  }
  return copy;
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
        issues.push({ level: "warning", title: "Unattached hint", detail: "Hint \"" + n.title + "\" has no incoming connection, so it isn't auto-attached to anything. Draw a connection from the node it should attach to, into this hint node.", nodeId: n.id });
    }
    if (n.type === "awardItem" && n.content.itemId && itemIds.indexOf(n.content.itemId) === -1)
      issues.push({ level: "error", title: "Dangling item reference", detail: "Node \"" + n.title + "\" references missing item " + n.content.itemId + ".", nodeId: n.id });
    if (n.type === "setVariable" && n.content.variableId && varIds.indexOf(n.content.variableId) === -1)
      issues.push({ level: "error", title: "Dangling variable reference", detail: "Node \"" + n.title + "\" references missing variable " + n.content.variableId + ".", nodeId: n.id });
    if (n.type === "lockAndKey") {
      var lkSupply = lockAndKeySupplyConnection(hunt, n.id);
      if (!lkSupply) {
        issues.push({ level: "warning", title: "No keychain supply", detail: "\"" + n.title + "\" has no Keychain connected to it, so it has no keys to offer the player. Drag a connection from a Keychain node onto this node.", nodeId: n.id });
      } else {
        var lkOpts = lockAndKeyOptions(hunt, n.id);
        if (!lkOpts.length) issues.push({ level: "warning", title: "Keychain has no keys", detail: "\"" + n.title + "\"'s supplying keychain isn't connected to any Key nodes yet.", nodeId: n.id });
        else if (!n.content.correctKeyNodeId) issues.push({ level: "warning", title: "No correct key chosen", detail: "\"" + n.title + "\" hasn't had a correct key chosen yet — pick one in the inspector.", nodeId: n.id });
        else if (!lkOpts.some(function (k) { return k.id === n.content.correctKeyNodeId; }))
          issues.push({ level: "error", title: "Correct key not on the ring", detail: "\"" + n.title + "\"'s chosen correct key isn't one of the keys its supplying keychain actually offers.", nodeId: n.id });
      }
    }
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
// "key"/"keychain" join this list too: like Award Item, neither has a
// standalone player screen — reaching one (via an ordinary incoming
// connection, same as any node) just resolves it into the Inventory lane
// immediately, where renderLaneOptionsList's "inventory" branch below
// gives Key nodes their own name+photo card. A Keychain's own outgoing
// connections to its Key nodes then cascade those keys into the
// Inventory the same instant (same one-recompute-pass cascade as e.g.
// Convergence -> Award Item chains already do) — finding the keychain
// reveals every key on it at once.
var AUTO_TYPES = ["branch", "awardItem", "setVariable", "score", "convergence", "ending", "key", "keychain"];
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

// Marks a node available and stamps state.availableAt[id] with the moment
// it first became available (i.e. first accessed) — the only place this
// timestamp is ever set. Progressive hint stages (see
// autoRevealedHintStageCount below) time themselves off this stamp, read
// from whichever node is connected into the hint node.
function markAvailable(state, id) {
  state.available[id] = true;
  if (!state.availableAt) state.availableAt = {};
  if (!state.availableAt[id]) state.availableAt[id] = Date.now();
}

// A node sitting in the Inventory lane counts as "used up" the moment any
// one of its outgoing connections has fired — i.e. gone from "not yet
// allowed" to "completed source + allowed + target open" — for the first
// time ever. state.itemConsumed is a one-way ratchet (only ever set,
// never cleared) so once true it stays true even if the connection's own
// condition later flips back to false, matching "used" being a permanent,
// one-time event rather than a live truth. Runs as a final settle pass at
// the end of every recompute() (called after every single player action —
// see the recompute() call sites), so it always sees this action's fully
// resolved available/completed state, whichever path got a target node
// there. An item node with no outgoing connection at all never gets
// touched here, so it just stays in the Inventory tab forever. See
// globalInventoryItems below, which reads this map to decide what still
// shows.
function settleInventoryConsumption(hunt, state) {
  if (!state.itemConsumed) state.itemConsumed = {};
  hunt.connections.forEach(function (c) {
    if (state.itemConsumed[c.sourceId]) return; // already used — nothing left to check
    if (!state.available[c.targetId]) return;
    var src = hunt.nodes.find(function (n) { return n.id === c.sourceId; });
    if (!src || src.lane !== "inventory") return;
    if (!state.completed[c.sourceId] || !isConnectionAllowed(c, hunt, state)) return;
    state.itemConsumed[c.sourceId] = true;
  });
}

function recompute(session) {
  var hunt = session.hunt, state = session.state, changed = true, iter = 0;
  while (changed && iter++ < 2000) {
    changed = false;
    hunt.nodes.forEach(function (n) {
      if (state.completed[n.id] || state.available[n.id]) return;
      if (hunt.entryPointIds.indexOf(n.id) !== -1) { markAvailable(state, n.id); changed = true; return; }
      if (n.type === "hint") return; // hints are surfaced via their attached puzzle, not the main graph
      if (n.type === "convergence") {
        if (convergenceSatisfied(n, hunt, state)) { markAvailable(state, n.id); changed = true; }
        return;
      }
      var incoming = hunt.connections.filter(function (c) { return c.targetId === n.id; });
      var ok = incoming.some(function (c) { return state.completed[c.sourceId] && isConnectionAllowed(c, hunt, state); });
      if (ok) { markAvailable(state, n.id); changed = true; }
    });
    hunt.nodes.forEach(function (n) {
      if (!state.available[n.id] || state.completed[n.id]) return;
      if (isAutoType(n.type) && nodeCompletionOk(n, session, true)) { completeNodeInternal(n, hunt, state); changed = true; }
    });
  }
  settleInventoryConsumption(hunt, state);
}

function createSession(hunt) {
  var state = {
    completed: {}, available: {}, availableAt: {}, variables: {}, items: {}, score: 0,
    choiceSelections: {}, branchChoices: {}, hintProgress: {}, history: [], endingReached: null,
    feedback: {}, itemConsumed: {}, // itemConsumed: node id -> true once that Inventory-lane item's outgoing connection has fired for the first time — see settleInventoryConsumption/globalInventoryItems
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

/* ---------------------------------------------------------------------
   Category Grid (3x3 image puzzle) helpers — shared by the player runtime
   further down and by Studio's inspector-embedded category builder
   (buildTypeSpecificFields/wireNodeInspector's "categoryGrid" case in
   app.js), same "one shared implementation" approach as the Lumen Puzzle
   geometry above.

   Each of the 9 images declares up to two "first category" partners and
   two "second category" partners — the other images it's meant to end up
   sharing a hidden category with. caGridGroups unions those partner links
   per axis with a small Union-Find, so a creator only has to set the link
   from *one* member of a trio (listing the other two) for the whole trio
   to come out grouped together — the other two members don't also have to
   list it back. A well-formed puzzle ends up with exactly 3 groups of 3
   images on each axis, and the two axes have to be "orthogonal" (every
   first-group/second-group pair contains exactly one image) for a valid
   3x3 arrangement to exist at all — caGridValidate checks both and is
   used by both the Studio inspector (live validation) and NODE_TYPES.
   categoryGrid.summary above.
--------------------------------------------------------------------- */
function caGridUnionFind(images, partnerKey) {
  var parent = {};
  images.forEach(function (im) { parent[im.id] = im.id; });
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { if (!(a in parent) || !(b in parent)) return; var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  images.forEach(function (im) { (im[partnerKey] || []).forEach(function (pid) { union(im.id, pid); }); });
  var indexOf = {}; images.forEach(function (im, i) { indexOf[im.id] = i; });
  var groupsMap = {};
  images.forEach(function (im) { var r = find(im.id); (groupsMap[r] = groupsMap[r] || []).push(im.id); });
  var groups = Object.keys(groupsMap).map(function (r) {
    return groupsMap[r].slice().sort(function (a, b) { return indexOf[a] - indexOf[b]; });
  });
  // Canonical order (both across groups, and of members within each group)
  // so the same content always yields the same group order — categoryNames
  // is indexed positionally against this order (see buildTypeSpecificFields'
  // "categoryGrid" case in app.js), and caGridLineCategoryName below relies
  // on it staying stable between edits that don't change the groups.
  groups.sort(function (a, b) { return indexOf[a[0]] - indexOf[b[0]]; });
  return groups;
}
function caGridGroups(content) {
  var images = content.images || [];
  return { first: caGridUnionFind(images, "firstPartners"), second: caGridUnionFind(images, "secondPartners") };
}
function caGridGroupIndexMap(groups) {
  var map = {};
  groups.forEach(function (g, idx) { g.forEach(function (id) { map[id] = idx; }); });
  return map;
}
// Well-formed = exactly 3 groups of 3 images on each axis, and no two
// images share both the same first-group AND the same second-group (the
// two partitions have to be "orthogonal" — every first-group/second-group
// pair maps to exactly one image — or no 3x3 layout can satisfy every row
// and column simultaneously).
function caGridValidate(content) {
  var images = content.images || [];
  var issues = [];
  if (images.length !== 9) issues.push("Needs exactly 9 images.");
  var groups = caGridGroups(content);
  ["first", "second"].forEach(function (axis) {
    var g = groups[axis];
    if (g.length !== 3 || g.some(function (x) { return x.length !== 3; })) {
      issues.push((axis === "first" ? "First" : "Second") + " category partners don't yet form 3 groups of 3 images each.");
    }
  });
  if (!issues.length) {
    var fMap = caGridGroupIndexMap(groups.first), sMap = caGridGroupIndexMap(groups.second);
    var seen = {}, ok = true;
    images.forEach(function (im) {
      var key = fMap[im.id] + ":" + sMap[im.id];
      if (seen[key]) ok = false;
      seen[key] = true;
    });
    if (!ok) issues.push("Two images share the same pair of categories — no valid grid arrangement exists yet. Adjust the partner selections so every image has a unique first/second category combination.");
  }
  return { valid: issues.length === 0, issues: issues, groups: groups };
}
// True when the three given image ids (a grid line's contents) all share a
// first-group, or all share a second-group. Any missing (null/undefined)
// cell fails immediately — an incomplete line never "shares a category".
function caGridShareCategory(groups, ids) {
  if (ids.indexOf(null) !== -1 || ids.indexOf(undefined) !== -1) return false;
  var fMap = caGridGroupIndexMap(groups.first);
  var f0 = fMap[ids[0]];
  if (f0 !== undefined && f0 === fMap[ids[1]] && f0 === fMap[ids[2]]) return true;
  var sMap = caGridGroupIndexMap(groups.second);
  var s0 = sMap[ids[0]];
  if (s0 !== undefined && s0 === sMap[ids[1]] && s0 === sMap[ids[2]]) return true;
  return false;
}
// Grid cell indices, row-major:
//   0 1 2
//   3 4 5
//   6 7 8
var CA_GRID_LINES = {
  midRow: [3, 4, 5], midCol: [1, 4, 7],
  topRow: [0, 1, 2], bottomRow: [6, 7, 8],
  leftCol: [0, 3, 6], rightCol: [2, 5, 8]
};
// Solution-checker mechanics, straight off the design spec: start at the
// centre cell and work outward — middle row, then middle column, then top
// row, bottom row, left column, right column — short-circuiting on the
// first line that doesn't share a category. Any full, valid arrangement
// (there are many — different orders/orientations all work) passes.
var CA_GRID_CHECK_ORDER = ["midRow", "midCol", "topRow", "bottomRow", "leftCol", "rightCol"];
function caGridCheckSolution(content, cellIds) {
  if (!cellIds || cellIds.length !== 9 || cellIds.some(function (id) { return !id; })) return false;
  var groups = caGridGroups(content);
  for (var i = 0; i < CA_GRID_CHECK_ORDER.length; i++) {
    var idxs = CA_GRID_LINES[CA_GRID_CHECK_ORDER[i]];
    if (!caGridShareCategory(groups, idxs.map(function (ix) { return cellIds[ix]; }))) return false;
  }
  return true;
}
// Once solved, works out which named category each row/column actually
// matched on (first-axis or second-axis, whichever the three images in
// that line share) — drives the row-then-column completion graphic in
// wireCategoryGridInteractions below.
function caGridLineCategoryName(content, groups, ids) {
  var fMap = caGridGroupIndexMap(groups.first);
  var f0 = fMap[ids[0]];
  if (f0 !== undefined && f0 === fMap[ids[1]] && f0 === fMap[ids[2]]) {
    return (content.categoryNames && content.categoryNames.first && content.categoryNames.first[f0]) || ("Category " + (f0 + 1));
  }
  var sMap = caGridGroupIndexMap(groups.second);
  var s0 = sMap[ids[0]];
  if (s0 !== undefined && s0 === sMap[ids[1]] && s0 === sMap[ids[2]]) {
    return (content.categoryNames && content.categoryNames.second && content.categoryNames.second[s0]) || ("Category " + (s0 + 4));
  }
  return "";
}
function caGridSolvedCategoryNames(content, cellIds) {
  var groups = caGridGroups(content);
  var rowIdxs = [[0, 1, 2], [3, 4, 5], [6, 7, 8]];
  var colIdxs = [[0, 3, 6], [1, 4, 7], [2, 5, 8]];
  return {
    rows: rowIdxs.map(function (idxs) { return caGridLineCategoryName(content, groups, idxs.map(function (ix) { return cellIds[ix]; })); }),
    cols: colIdxs.map(function (idxs) { return caGridLineCategoryName(content, groups, idxs.map(function (ix) { return cellIds[ix]; })); })
  };
}
// Builds one grid piece's markup (a grid cell's contents, or a gallery
// item) — an image thumbnail when the creator has uploaded one, otherwise
// a text tile showing the image's title so an in-progress puzzle is still
// usable before every image is attached (title is always shown as a
// fallback here regardless of showTitle, since there's nothing else to
// show). `from` is "cell" or "gallery"; `draggable` is false while the
// completion graphic is playing (see renderPreviewNode's "categoryGrid"
// branch) so the solved board can't be disturbed mid-reveal. `showTitle`
// is content.showImageTitles — when true and an image is attached, the
// title is also shown as a caption over the thumbnail (off by default,
// since a title is normally just the creator's own reference name for the
// partner dropdowns, not something meant for the player to read).
function caGridPieceHtml(im, from, draggable, showTitle) {
  var inner = im.imageAsset
    ? '<img src="' + esc(im.imageAsset) + '" alt="' + esc(im.title || "") + '" draggable="false" />' + (showTitle ? '<span class="pv-cgrid-caption">' + esc(im.title || "") + '</span>' : "")
    : '<span class="pv-cgrid-noimg">' + esc(im.title || "?") + '</span>';
  return '<div class="pv-cgrid-piece" draggable="' + (draggable ? "true" : "false") + '" tabindex="0" data-cgimg="' + esc(im.id) + '" data-cgfrom="' + from + '" title="' + esc(im.title || "") + '">' + inner + '</div>';
}

// Constraint Satisfaction Puzzle helper — the total pool of a given item
// the player is handed is never stored on its own; it's always just the
// sum of every recipient's required count for that item (see the comment
// above NODE_TYPES.constraintSatisfaction). Shared between the player
// runtime (renderPreviewNode/wireConstraintSatisfactionInteractions below)
// and Studio's inspector (buildConstraintSatisfactionFields in app.js),
// so both always agree on the pool size without it ever going stale.
function cspItemTotal(content, itemId) {
  return (content.recipients || []).reduce(function (sum, r) {
    return sum + ((r.requirements && r.requirements[itemId]) || 0);
  }, 0);
}
// How many of a given item are still unallocated against a live player
// draft (ctl.cspDraft[nodeId].alloc — see renderPreviewNode's
// "constraintSatisfaction" branch): the pool total minus whatever's
// currently assigned to any recipient in `alloc`.
function cspItemRemaining(content, itemId, alloc) {
  var used = (content.recipients || []).reduce(function (sum, r) {
    return sum + (((alloc[r.id] || {})[itemId]) || 0);
  }, 0);
  return cspItemTotal(content, itemId) - used;
}

// The whole answer entry grid has to fit on one player screen with no
// scrolling regardless of how many items/recipients a creator configured
// (1-6 each) — see the design spec's "all options should be able to scale
// to fit a single player view screen". Three things make that work
// together:
//   - width never uses a fixed pixel size anywhere in styles.css's
//     .pv-csp-* rules — the recipient grid and each box's own item grid
//     are both fr-based (column counts set inline per node, from this
//     function), so they always fill exactly however much width the
//     actual screen has, whether that's the 236px docked Studio mock, the
//     larger Preview overlay, or a real phone.
//   - each item within a box is a compact single-line row (image beside
//     its stepper, not stacked above it — see .pv-csp-recip-item in
//     styles.css), which is what actually keeps a box with several items
//     short; itemCols (below) only spreads items across more than one
//     such row when there's clearly enough spare width for it (i.e. few
//     enough recipient columns), never at the cost of squeezing a
//     stepper's "− N +" into too little width to tap.
//   - every size that affects height (item image box, scroll-wheel widget,
//     fonts, padding, gaps) shrinks together, continuously, as a single
//     "complexity" score — recipRows (1 recipient row of up to 3 boxes, or
//     2 once there are 4-6 recipients) times itemRows (how many rows of
//     items a box needs once spread across itemCols) — grows, from 1 (a
//     single item, single recipient) up to 12 (6 recipients x 6 items,
//     the tightest configuration possible).
// Returned sizes are applied as CSS custom properties on .pv-csp-wrap (see
// the "constraintSatisfaction" branch in renderPreviewNode below), so
// styles.css stays the single source of truth for how each size is
// actually used — this just picks the numbers.
function cspLayoutScale(itemCount, recipCount) {
  itemCount = Math.max(1, itemCount || 1);
  recipCount = Math.max(1, recipCount || 1);
  // 4 recipients is a special case: a true 2x2 grid reads better and is no
  // less compact than the 3-then-1 layout the general "up to 3 columns"
  // rule would otherwise produce.
  var recipCols = recipCount === 4 ? 2 : Math.min(3, recipCount);
  var recipRows = Math.ceil(recipCount / recipCols);
  // With 3 recipient columns there's only ever room for a single column of
  // item-rows per box (they stack instead); with 2 recipient columns
  // there's room for 2 items side by side; with just 1 recipient the
  // whole screen width is free, so up to 3 can sit side by side.
  var maxItemCols = recipCols === 1 ? 3 : recipCols === 2 ? 2 : 1;
  var itemCols = Math.max(1, Math.min(itemCount, maxItemCols));
  var itemRows = Math.ceil(itemCount / itemCols);
  var complexity = recipRows * itemRows; // 1 (roomiest) .. 12 (tightest)
  var density = Math.max(0, Math.min(1, (complexity - 1) / 11));
  function lerp(a, b) { return Math.round((a + (b - a) * density) * 2) / 2; } // half-pixel precision is plenty
  return {
    recipCols: recipCols, itemCols: itemCols,
    imgSize: lerp(34, 14), menuImgSize: lerp(26, 14), stepSize: lerp(20, 13),
    fontCount: lerp(12, 8.5), fontName: lerp(11, 8), boxPad: lerp(7, 2), gap: lerp(7, 2)
  };
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
// Great-circle distance between two lat/lng points, in metres (haversine
// formula, Earth radius ~6,371,008m) — the same distance math a real phone's
// "how far to the pin" reading would use. Shared by pv_action_submitGeoCheckIn
// (below) and the Studio inspector's live "distance from here" preview (see
// the "geolocationCheckIn" case in buildTypeSpecificFields/app.js).
function geoDistanceMeters(lat1, lng1, lat2, lng2) {
  var R = 6371008;
  var toRad = function (d) { return d * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
// Geolocation Check-in — mechanicOk is true once the player's reported
// coordinates land within content.radiusMeters of the node's target point.
// playerLat/playerLng are whatever the browser's Geolocation API (or the
// Studio preview's manual "simulate arrival" control — see
// wirePreviewNodeInteractions' "geolocationCheckIn" branch below) reported;
// this function only ever does the distance math, never talks to
// navigator.geolocation itself, same separation as every other pv_action_*
// (mechanic check in engine.js, DOM/browser-API glue in the branch that
// calls it).
function pv_action_submitGeoCheckIn(session, nodeId, playerLat, playerLng) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var c = n.content;
  var dist = geoDistanceMeters(playerLat, playerLng, Number(c.lat) || 0, Number(c.lng) || 0);
  var radius = Number(c.radiusMeters) || 25;
  var mechanicOk = dist <= radius;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  session.state.geoLastDistance = session.state.geoLastDistance || {};
  session.state.geoLastDistance[nodeId] = Math.round(dist);
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

// Rope Tying — the player's ties are draft UI state (ctl.ropeDraft, see
// wireRopeTyingInteractions below), only turned into pairs and checked when
// the node's primary button ("Hoist" by default) is pressed. Correct only
// when the tied set exactly matches content.correctPairs — same unordered-
// pair normalization as Matching's submit above, except each pair here is
// itself unordered too (tying end A to end B is identical to B to A), so
// both the pair's own two ids and the outer pair list are sorted before
// comparing.
function pv_action_submitRopeTying(session, nodeId, pairs) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var norm = function (arr) {
    return (arr || []).map(function (p) { return [p[0], p[1]].sort().join(":"); }).sort().join(",");
  };
  var mechanicOk = (n.content.correctPairs || []).length > 0 && norm(pairs) === norm(n.content.correctPairs);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Lumen Puzzle — auto-validates after every rotation (same "auto-validate,
// no submit button" family as Fuse Panel), driven by
// wireLumenPuzzleInteractions below, which recomputes the beam trace after
// every drag/tap and passes in whether every target's condition is
// currently met simultaneously.
function pv_action_submitLumenPuzzle(session, nodeId, allTargetsSolved) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = !!allTargetsSolved;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Category Grid — auto-validates once every one of the 9 cells is filled
// (same "auto-validate, no submit button" family as Fuse Panel/Lumen
// Puzzle) — see wireCategoryGridInteractions below, which is the only
// caller: it withholds the call entirely while any cell is still empty, so
// feedback never flips to "incorrect" just because the player hasn't
// finished arranging the board yet. cellIds is the live 9-cell grid
// (row-major, see the CA_GRID_LINES comment above caGridCheckSolution).
function pv_action_submitCategoryGrid(session, nodeId, cellIds) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = caGridCheckSolution(n.content, cellIds);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Constraint Satisfaction Puzzle — auto-validates once every item in the
// pool is fully allocated to some recipient (same "auto-validate, no
// submit button" family as Fuse Panel/Lumen Puzzle/Category Grid) — see
// wireConstraintSatisfactionInteractions below, the only caller, which
// withholds the call entirely while any item still has an unallocated
// count left, so feedback never flips to "incorrect" just because the
// player hasn't finished distributing yet. `alloc` is the live draft map
// recipientId -> itemId -> count (ctl.cspDraft[nodeId].alloc). Correct only
// when every recipient's live count for every item exactly matches that
// recipient's own requirements (0 where unset).
function pv_action_submitConstraintSatisfaction(session, nodeId, alloc) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var items = n.content.items || [], recipients = n.content.recipients || [];
  var mechanicOk = items.length > 0 && recipients.length > 0 && recipients.every(function (r) {
    return items.every(function (it) {
      var want = (r.requirements && r.requirements[it.id]) || 0;
      var got = ((alloc[r.id] || {})[it.id]) || 0;
      return want === got;
    });
  });
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Gear & Pulley Builder — auto-validates the instant the mesh chain from
// handle to hoist connects (same "auto-validate, no submit button" family
// as Fuse Panel/Lumen Puzzle/Category Grid), driven by
// wireGearPulleyInteractions below, which recomputes gpSolveState after
// every cog placed/lifted and only calls this once solved becomes true.
function pv_action_submitGearPulley(session, nodeId, driveConnected) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = !!driveConnected;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Weight Scale Builder — auto-validates the instant every token is off the
// tray and the two pans balance exactly (same "auto-validate, no submit
// button" family as Gear & Pulley/Category Grid), driven by
// wireWeightScaleInteractions below, which only calls this once every
// token has been placed (never with a false/incorrect mechanicOk while the
// player's still mid-sort — same withholding idiom as
// wireCategoryGridInteractions' maybeCheck).
function pv_action_submitWeightScale(session, nodeId, allPlaced, balanced) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = !!allPlaced && !!balanced;
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Control Panel Builder — shared component-type metadata, condition
// evaluation and widget-rendering helpers, used identically by the
// Studio-embedded board designer (wireControlPanelDesigner in app.js) and
// the real player screen (the "controlPanel" branch of renderPreviewNode/
// wireControlPanelInteractions below) — see the doc comment above
// NODE_TYPES.controlPanel for the overall shape.
//
// Every placed component is { id, type, name, zone, x, y, w, h, rot, data }
// where type/data vary per CTP_COMPONENT_TYPES entry below: `kind` says
// what a component's live value looks like — "boolean" (switches, push
// buttons), "index" (numbered/named rotary knobs — an integer 0..points-1),
// "numeric" (sliders, the full-rotation knob — degrees 0-359), "output"
// (lights/gauges/digital displays — driven by rules, never by the player
// directly) or "static" (images/GIFs/labels/shapes — decorative only).
var CTP_COMPONENT_TYPES = {
  vSwitch:        { group: "interactive", label: "Vertical Switch",        icon: "🔀", kind: "boolean", defaultW: 40,  defaultH: 90 },
  hSwitch:        { group: "interactive", label: "Horizontal Switch",      icon: "🔀", kind: "boolean", defaultW: 90,  defaultH: 40 },
  pushButton:     { group: "interactive", label: "Push Button",            icon: "🔴", kind: "boolean", defaultW: 56,  defaultH: 56 },
  vSlider:        { group: "interactive", label: "Vertical Slider",        icon: "🎚️", kind: "numeric", defaultW: 46,  defaultH: 150 },
  hSlider:        { group: "interactive", label: "Horizontal Slider",      icon: "🎚️", kind: "numeric", defaultW: 150, defaultH: 46 },
  knob180Num:     { group: "interactive", label: "180° Knob (Numbered)",   icon: "🎛️", kind: "index",   defaultW: 74,  defaultH: 74 },
  knob270Num:     { group: "interactive", label: "270° Knob (Numbered)",   icon: "🎛️", kind: "index",   defaultW: 80,  defaultH: 80 },
  knob180Named:   { group: "interactive", label: "180° Knob (Named)",      icon: "🎛️", kind: "index",   defaultW: 86,  defaultH: 86 },
  knob270Named:   { group: "interactive", label: "270° Knob (Named)",      icon: "🎛️", kind: "index",   defaultW: 92,  defaultH: 92 },
  knobFull:       { group: "interactive", label: "Full Rotation Knob",     icon: "🎡", kind: "numeric", defaultW: 74,  defaultH: 74 },
  light:          { group: "conditional", label: "Light",                  icon: "💡", kind: "output",  defaultW: 30,  defaultH: 30 },
  gauge:          { group: "conditional", label: "Gauge",                  icon: "📊", kind: "output",  defaultW: 96,  defaultH: 96 },
  digitalDisplay: { group: "conditional", label: "Digital Number Display", icon: "🔢", kind: "output",  defaultW: 96,  defaultH: 40 },
  image:          { group: "static", label: "Image",          icon: "🖼️", kind: "static", defaultW: 120, defaultH: 90 },
  gif:            { group: "static", label: "GIF",             icon: "🎞️", kind: "static", defaultW: 120, defaultH: 90 },
  label:          { group: "static", label: "Editable Label",  icon: "🏷️", kind: "static", defaultW: 110, defaultH: 26 },
  shape:          { group: "static", label: "Shape / Divider", icon: "▭",  kind: "static", defaultW: 120, defaultH: 8 }
};
var CTP_GROUP_LABELS = { interactive: "Interactive", conditional: "Conditional", static: "Static / Look & Feel" };
var CTP_PUSHBUTTON_SKINS = { arcade: "Arcade (round)", toggle: "Toggle (square)", industrial: "Industrial (guarded)" };
var CTP_LIGHT_STYLES = { round: "Round bulb", square: "Square LED", strip: "LED strip" };
var CTP_OP_LABELS = { on: "Is ON", off: "Is OFF", equals: "Equals", atleast: "At least", atmost: "At most", between: "Between" };
var CTP_BOARD_MIN_W = 0, CTP_BOARD_MAX_W = 1400, CTP_ZONE_MAX_H = 600;

function ctpComponentKind(type) { return (CTP_COMPONENT_TYPES[type] || {}).kind || "static"; }
function ctpKnobArc(type) { return type.indexOf("270") !== -1 ? 270 : (type === "knobFull" ? 360 : 180); }
function ctpIsNamedKnob(type) { return type.indexOf("Named") !== -1; }

// Operators a win/rule condition can offer, based on what kind of live
// value the referenced component produces.
function ctpOpsForKind(kind) {
  if (kind === "boolean") return ["on", "off"];
  if (kind === "index") return ["equals"];
  if (kind === "numeric") return ["equals", "atleast", "atmost", "between"];
  return ["on", "off", "equals", "atleast", "atmost", "between"];
}

function ctpDefaultComponentData(type) {
  switch (type) {
    case "vSwitch": case "hSwitch": return { on: false, onLabel: "ON", offLabel: "OFF" };
    case "pushButton": return { on: false, skin: "arcade" };
    case "vSlider": case "hSlider": return { min: 0, max: 10, step: 1, value: 0 };
    case "knob180Num": case "knob270Num": return { points: 5, value: 0 };
    case "knob180Named": case "knob270Named": return { points: 5, names: ["1", "2", "3", "4", "5"], value: 0 };
    case "knobFull": return { value: 0, showIntervals: false, intervalCount: 12 };
    // mode: "rules" (default — if/then conditions, see ctpEvalRules) or
    // "formula" (a math expression over other components' live values,
    // assigned to variables x/y/z/... — see CTP_FORMULA_VAR_LETTERS/
    // ctpEvalFormula below). Both modes fall back to the same default*
    // field when nothing matches / the formula errors, so switching modes
    // never loses that fallback.
    case "light": return { style: "round", color: "#ff453a", rules: [], defaultOn: false, mode: "rules", formula: { vars: [], expression: "" } };
    case "gauge": return { min: 0, max: 100, rules: [], defaultValue: 0, mode: "rules", formula: { vars: [], expression: "" } };
    case "digitalDisplay": return { digits: 4, rules: [], defaultText: "----", mode: "rules", formula: { vars: [], expression: "", decimals: 0, prefix: "", suffix: "" } };
    case "image": return { src: "", fit: "contain" };
    case "gif": return { src: "" };
    case "label": return { text: "Label", fontSize: 14, color: "#e8e8e8", align: "center" };
    case "shape": return { shapeType: "rect", color: "#5a5f68", fill: "transparent", strokeWidth: 2 };
    default: return {};
  }
}

// A new placed instance of `type`, ready to push into content.components.
function ctpNewComponent(type, zone, x, y) {
  var meta = CTP_COMPONENT_TYPES[type] || { defaultW: 60, defaultH: 60, label: type };
  return {
    id: uid("ctpc"), type: type, name: meta.label, zone: zone || "upper",
    x: Math.round(x || 0), y: Math.round(y || 0), w: meta.defaultW, h: meta.defaultH, rot: 0,
    data: ctpDefaultComponentData(type)
  };
}

// The player's *current* value for an interactive component — boolean
// components as 0/1, indexed knobs as their point index, numeric
// components (sliders, the full-rotation knob) as their raw number. `data`
// is whatever live per-instance state is being tracked (either the
// component's own saved `data` at design-time, or a session draft value at
// player-time), always the same shape as ctpDefaultComponentData's output.
function ctpLiveValue(type, data) {
  var d = data || {};
  switch (type) {
    case "vSwitch": case "hSwitch": case "pushButton": return d.on ? 1 : 0;
    default: return Number(d.value) || 0;
  }
}

function ctpDefaultValuesById(content) {
  var out = {};
  (content.components || []).forEach(function (comp) {
    var kind = ctpComponentKind(comp.type);
    if (kind === "boolean" || kind === "index" || kind === "numeric") out[comp.id] = ctpLiveValue(comp.type, comp.data);
  });
  return out;
}

function ctpEvalSingleCondition(cond, valuesById) {
  var v = valuesById ? valuesById[cond.componentId] : undefined;
  if (v === undefined || v === null) return false;
  switch (cond.op) {
    case "on": return Number(v) === 1;
    case "off": return Number(v) === 0;
    case "equals": return Number(v) === Number(cond.value);
    case "atleast": return Number(v) >= Number(cond.value);
    case "atmost": return Number(v) <= Number(cond.value);
    case "between": return Number(v) >= Number(cond.min) && Number(v) <= Number(cond.max);
    default: return false;
  }
}
function ctpConditionsAllMet(conditions, valuesById) {
  return !!(conditions && conditions.length) && conditions.every(function (cond) { return ctpEvalSingleCondition(cond, valuesById); });
}
// First rule (in order) whose conditions are all met wins — returns that
// rule's `output`, or null if nothing matched (caller falls back to the
// component's own default* field).
function ctpEvalRules(rules, valuesById) {
  for (var i = 0; i < (rules || []).length; i++) {
    if (ctpConditionsAllMet(rules[i].conditions, valuesById)) return rules[i].output;
  }
  return null;
}
function ctpWinConditionsMet(winConditions, valuesById) {
  return !!(winConditions && winConditions.length) && winConditions.every(function (wc) { return ctpEvalSingleCondition(wc, valuesById); });
}

/* -------------------------------------------------------------------------
   Control Panel Builder — formula engine. An alternative to the if/then
   rules above for a light/gauge/digital-display component: instead of a
   fixed output per matched condition, the component's value is computed
   live from a math expression over other components' current values,
   assigned to short variable names (x, y, z, ... — see
   CTP_FORMULA_VAR_LETTERS) the creator picks in the Studio inspector (e.g.
   "this digital display shows this slider plus that slider" becomes
   expression "x + y" with x/y each assigned to a slider). Deliberately a
   hand-rolled tokenizer/recursive-descent parser/evaluator rather than
   `eval`/`new Function` — hunts are plain JSON that can be imported from
   anywhere, so a creator-authored expression must never be able to run
   arbitrary JS. ctpEvalFormula never throws; parse/eval errors are caught
   and reported back as { ok:false, error } so the caller (ctpComputeOutputs
   below, and the Studio formula editor's live preview in app.js) can fall
   back to the component's own default* field exactly like an unmatched
   rule, rather than breaking the whole panel over one bad expression.
------------------------------------------------------------------------- */
var CTP_FORMULA_VAR_LETTERS = ["x", "y", "z", "w", "v", "u", "t", "s"];
var CTP_FORMULA_FUNCS = {
  abs: function (a) { return Math.abs(a); },
  round: function (a) { return Math.round(a); },
  floor: function (a) { return Math.floor(a); },
  ceil: function (a) { return Math.ceil(a); },
  sqrt: function (a) { return Math.sqrt(a); },
  min: function () { return Math.min.apply(Math, arguments); },
  max: function () { return Math.max.apply(Math, arguments); },
  clamp: function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
};

function ctpFormulaTokenize(expr) {
  var s = String(expr || "");
  var i = 0, n = s.length, tokens = [];
  function isDigit(c) { return c >= "0" && c <= "9"; }
  function isAlpha(c) { return /[A-Za-z_]/.test(c); }
  while (i < n) {
    var c = s[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (isDigit(c) || (c === "." && isDigit(s[i + 1]))) {
      var startN = i;
      while (i < n && (isDigit(s[i]) || s[i] === ".")) i++;
      tokens.push({ type: "num", value: parseFloat(s.slice(startN, i)) });
      continue;
    }
    if (isAlpha(c)) {
      var startI = i;
      while (i < n && /[A-Za-z0-9_]/.test(s[i])) i++;
      var word = s.slice(startI, i);
      if (word === "and") tokens.push({ type: "op", value: "&&" });
      else if (word === "or") tokens.push({ type: "op", value: "||" });
      else if (word === "not") tokens.push({ type: "op", value: "!" });
      else tokens.push({ type: "ident", value: word });
      continue;
    }
    if (c === "<" || c === ">" || c === "=" || c === "!") {
      if (s[i + 1] === "=") { tokens.push({ type: "op", value: c + "=" }); i += 2; }
      else { tokens.push({ type: "op", value: c }); i++; }
      continue;
    }
    if (c === "&" && s[i + 1] === "&") { tokens.push({ type: "op", value: "&&" }); i += 2; continue; }
    if (c === "|" && s[i + 1] === "|") { tokens.push({ type: "op", value: "||" }); i += 2; continue; }
    if ("+-*/%^(),".indexOf(c) !== -1) { tokens.push({ type: "op", value: c }); i++; continue; }
    throw new Error("Unexpected character '" + c + "'");
  }
  return tokens;
}

// Recursive-descent parser — standard precedence, low to high:
// || / or  <  && / and  <  == !=  <  < <= > >=  <  + -  <  * / %  <  ^ (right-assoc)  <  unary - !  <  primary
function ctpFormulaPeek(tokens, pos) { return tokens[pos.i]; }
function ctpFormulaParseExpr(tokens, pos) { return ctpFormulaParseOr(tokens, pos); }
function ctpFormulaParseOr(tokens, pos) {
  var left = ctpFormulaParseAnd(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === "||") {
    pos.i++;
    left = { type: "logic", op: "||", left: left, right: ctpFormulaParseAnd(tokens, pos) };
  }
  return left;
}
function ctpFormulaParseAnd(tokens, pos) {
  var left = ctpFormulaParseEquality(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === "&&") {
    pos.i++;
    left = { type: "logic", op: "&&", left: left, right: ctpFormulaParseEquality(tokens, pos) };
  }
  return left;
}
function ctpFormulaParseEquality(tokens, pos) {
  var left = ctpFormulaParseComparison(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && (ctpFormulaPeek(tokens, pos).value === "==" || ctpFormulaPeek(tokens, pos).value === "!=")) {
    var op = tokens[pos.i].value; pos.i++;
    left = { type: "cmp", op: op, left: left, right: ctpFormulaParseComparison(tokens, pos) };
  }
  return left;
}
function ctpFormulaParseComparison(tokens, pos) {
  var left = ctpFormulaParseAdditive(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && ["<", "<=", ">", ">="].indexOf(ctpFormulaPeek(tokens, pos).value) !== -1) {
    var op = tokens[pos.i].value; pos.i++;
    left = { type: "cmp", op: op, left: left, right: ctpFormulaParseAdditive(tokens, pos) };
  }
  return left;
}
function ctpFormulaParseAdditive(tokens, pos) {
  var left = ctpFormulaParseMultiplicative(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && (ctpFormulaPeek(tokens, pos).value === "+" || ctpFormulaPeek(tokens, pos).value === "-")) {
    var op = tokens[pos.i].value; pos.i++;
    left = { type: "bin", op: op, left: left, right: ctpFormulaParseMultiplicative(tokens, pos) };
  }
  return left;
}
function ctpFormulaParseMultiplicative(tokens, pos) {
  var left = ctpFormulaParsePower(tokens, pos);
  while (ctpFormulaPeek(tokens, pos) && ["*", "/", "%"].indexOf(ctpFormulaPeek(tokens, pos).value) !== -1) {
    var op = tokens[pos.i].value; pos.i++;
    left = { type: "bin", op: op, left: left, right: ctpFormulaParsePower(tokens, pos) };
  }
  return left;
}
function ctpFormulaParsePower(tokens, pos) {
  var left = ctpFormulaParseUnary(tokens, pos);
  if (ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === "^") {
    pos.i++;
    return { type: "bin", op: "^", left: left, right: ctpFormulaParsePower(tokens, pos) }; // right-assoc
  }
  return left;
}
function ctpFormulaParseUnary(tokens, pos) {
  var t = ctpFormulaPeek(tokens, pos);
  if (t && t.type === "op" && (t.value === "-" || t.value === "!")) {
    pos.i++;
    return { type: "unary", op: t.value, operand: ctpFormulaParseUnary(tokens, pos) };
  }
  return ctpFormulaParsePrimary(tokens, pos);
}
function ctpFormulaParsePrimary(tokens, pos) {
  var t = ctpFormulaPeek(tokens, pos);
  if (!t) throw new Error("Unexpected end of formula");
  if (t.type === "num") { pos.i++; return { type: "num", value: t.value }; }
  if (t.type === "op" && t.value === "(") {
    pos.i++;
    var e = ctpFormulaParseExpr(tokens, pos);
    if (!(ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === ")")) throw new Error("Missing closing parenthesis");
    pos.i++;
    return e;
  }
  if (t.type === "ident") {
    pos.i++;
    if (ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === "(") {
      pos.i++;
      var args = [];
      if (!(ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === ")")) {
        args.push(ctpFormulaParseExpr(tokens, pos));
        while (ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === ",") { pos.i++; args.push(ctpFormulaParseExpr(tokens, pos)); }
      }
      if (!(ctpFormulaPeek(tokens, pos) && ctpFormulaPeek(tokens, pos).value === ")")) throw new Error("Missing closing parenthesis in " + t.value + "(...)");
      pos.i++;
      return { type: "call", name: t.value, args: args };
    }
    return { type: "var", name: t.value };
  }
  throw new Error("Unexpected '" + (t.value != null ? t.value : t.type) + "'");
}
function ctpFormulaEval(node, varsMap) {
  switch (node.type) {
    case "num": return node.value;
    case "var":
      if (!(node.name in varsMap)) throw new Error("'" + node.name + "' isn't assigned to a component");
      return Number(varsMap[node.name]) || 0;
    case "call":
      var fn = CTP_FORMULA_FUNCS[node.name];
      if (!fn) throw new Error("Unknown function '" + node.name + "()'");
      return fn.apply(null, node.args.map(function (a) { return ctpFormulaEval(a, varsMap); }));
    case "unary":
      var v = ctpFormulaEval(node.operand, varsMap);
      return node.op === "-" ? -v : (v ? 0 : 1);
    case "bin": {
      var l = ctpFormulaEval(node.left, varsMap), r = ctpFormulaEval(node.right, varsMap);
      if (node.op === "+") return l + r;
      if (node.op === "-") return l - r;
      if (node.op === "*") return l * r;
      if (node.op === "/") return r === 0 ? 0 : l / r;
      if (node.op === "%") return r === 0 ? 0 : l % r;
      if (node.op === "^") return Math.pow(l, r);
      break;
    }
    case "cmp": {
      var lc = ctpFormulaEval(node.left, varsMap), rc = ctpFormulaEval(node.right, varsMap);
      if (node.op === "<") return lc < rc ? 1 : 0;
      if (node.op === "<=") return lc <= rc ? 1 : 0;
      if (node.op === ">") return lc > rc ? 1 : 0;
      if (node.op === ">=") return lc >= rc ? 1 : 0;
      if (node.op === "==") return lc === rc ? 1 : 0;
      if (node.op === "!=") return lc !== rc ? 1 : 0;
      break;
    }
    case "logic": {
      var ll = ctpFormulaEval(node.left, varsMap);
      if (node.op === "&&") return (!ll) ? 0 : (ctpFormulaEval(node.right, varsMap) ? 1 : 0);
      if (node.op === "||") return ll ? 1 : (ctpFormulaEval(node.right, varsMap) ? 1 : 0);
      break;
    }
  }
  throw new Error("Malformed formula");
}
// Parses and evaluates `expr` against varsMap ({ x: 3, y: 4, ... }) in one
// shot — never throws; returns { ok:true, value } or { ok:false, error }.
function ctpEvalFormula(expr, varsMap) {
  try {
    var tokens = ctpFormulaTokenize(expr);
    if (!tokens.length) return { ok: false, error: "Empty formula" };
    var pos = { i: 0 };
    var ast = ctpFormulaParseExpr(tokens, pos);
    if (pos.i < tokens.length) throw new Error("Unexpected '" + tokens[pos.i].value + "'");
    var val = ctpFormulaEval(ast, varsMap || {});
    if (typeof val !== "number" || isNaN(val) || !isFinite(val)) throw new Error("Doesn't evaluate to a number");
    return { ok: true, value: val };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "Invalid formula" };
  }
}
// Evaluates one light/gauge/digitalDisplay component's own formula
// (component.data.formula = { vars:[{letter,componentId}], expression,
// decimals?, prefix?, suffix? }) against the panel's live component
// values, shaping the result the same way a matched rule's `output` would
// (see ctpEvalRules) so ctpComputeOutputs can treat both modes uniformly.
// Returns {} (meaning "use the component's own default*") on any error.
function ctpEvalComponentFormula(comp, valuesById) {
  var f = comp.data.formula || {};
  var varsMap = {};
  (f.vars || []).forEach(function (v) {
    var raw = valuesById ? valuesById[v.componentId] : undefined;
    varsMap[v.letter] = raw != null ? Number(raw) : 0;
  });
  var res = ctpEvalFormula(f.expression || "", varsMap);
  if (!res.ok) return {};
  if (comp.type === "light") return { on: !!res.value };
  if (comp.type === "gauge") return { value: res.value };
  if (comp.type === "digitalDisplay") {
    var decimals = Math.max(0, Math.min(6, Number(f.decimals) || 0));
    return { text: (f.prefix || "") + res.value.toFixed(decimals) + (f.suffix || "") };
  }
  return {};
}

// Resolves what a light/gauge/digital-display component should currently
// show — either runs its rule list (ctpEvalRules) or its formula
// (ctpEvalComponentFormula), per its own data.mode, against the panel's
// live component values, falling back to its own default* field when
// nothing matches / the formula errors.
function ctpComputeOutputs(content, valuesById) {
  var out = {};
  (content.components || []).forEach(function (comp) {
    if (ctpComponentKind(comp.type) !== "output") return;
    out[comp.id] = (comp.data.mode === "formula")
      ? ctpEvalComponentFormula(comp, valuesById)
      : (ctpEvalRules(comp.data.rules, valuesById) || {});
  });
  return out;
}

// The single number/boolean/string that should currently be shown on a
// component, whichever kind it is — interactive components read straight
// from valuesById (their own live state), output components resolve
// through their rules (outputsById, from ctpComputeOutputs), static
// components have nothing to resolve.
function ctpResolvedValue(comp, valuesById, outputsById) {
  var kind = ctpComponentKind(comp.type);
  if (kind === "boolean" || kind === "index" || kind === "numeric") {
    var v = valuesById ? valuesById[comp.id] : undefined;
    return v != null ? v : ctpLiveValue(comp.type, comp.data);
  }
  if (comp.type === "light") {
    var lo = outputsById && outputsById[comp.id];
    return lo && lo.on != null ? !!lo.on : !!comp.data.defaultOn;
  }
  if (comp.type === "gauge") {
    var go = outputsById && outputsById[comp.id];
    return go && go.value != null ? Number(go.value) : (Number(comp.data.defaultValue) || 0);
  }
  if (comp.type === "digitalDisplay") {
    var dop = outputsById && outputsById[comp.id];
    return dop && dop.text != null ? String(dop.text) : (comp.data.defaultText || "----");
  }
  return null;
}

// Small pie-slice of tick marks (or named labels) fanned out around a
// knob's arc — shared by the numbered/named rotary knobs and the optional
// interval marks on the full-rotation knob. Each tick is rotated into
// place then its label counter-rotated back upright.
function ctpKnobTicks(points, arc, names) {
  var html = "";
  for (var i = 0; i < points; i++) {
    var a = points > 1 ? (-arc / 2 + (arc / (points - 1)) * i) : 0;
    var text = names ? esc(String(names[i] || "")) : String(i + 1);
    html += '<div class="ctp-knob-tick" style="transform:rotate(' + a + 'deg)"><span style="transform:rotate(' + (-a) + 'deg)">' + text + '</span></div>';
  }
  return html;
}

// The visual markup for one component, given the value it should currently
// display (see ctpResolvedValue). Identical for the design-time board and
// the real player screen — only the wrapping element (with its
// drag/resize/rotate handles in the designer, or its click/drag input
// handlers at player-time) differs; see ctpComponentWrapStyle below and
// wireControlPanelDesigner (app.js) / wireControlPanelInteractions (below).
function ctpComponentInnerHtml(comp, val) {
  var d = comp.data || {};
  switch (comp.type) {
    case "vSwitch": case "hSwitch": {
      var on1 = !!val;
      return '<div class="ctp-switch ctp-switch-' + (comp.type === "vSwitch" ? "v" : "h") + (on1 ? " on" : "") + '">' +
        '<div class="ctp-switch-track"><div class="ctp-switch-knob"></div></div>' +
        '<span class="ctp-switch-poslabel ctp-switch-poslabel-on">' + esc(d.onLabel || "ON") + '</span>' +
        '<span class="ctp-switch-poslabel ctp-switch-poslabel-off">' + esc(d.offLabel || "OFF") + '</span>' +
      '</div>';
    }
    case "pushButton": {
      var on2 = !!val;
      return '<div class="ctp-pushbtn ctp-pushbtn-' + (d.skin || "arcade") + (on2 ? " on" : "") + '"><div class="ctp-pushbtn-cap"></div></div>';
    }
    case "vSlider": case "hSlider": {
      var min = Number(d.min) || 0, max = Number(d.max) || 10;
      var value = Number(val != null ? val : d.value) || 0;
      var pct = max > min ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
      var vertical = comp.type === "vSlider";
      return '<div class="ctp-slider ctp-slider-' + (vertical ? "v" : "h") + '">' +
        '<div class="ctp-slider-track">' +
          '<div class="ctp-slider-fill" style="' + (vertical ? "height:" + pct + "%" : "width:" + pct + "%") + '"></div>' +
          '<div class="ctp-slider-thumb" style="' + (vertical ? "bottom:" + pct + "%" : "left:" + pct + "%") + '"></div>' +
        '</div>' +
        '<div class="ctp-slider-val">' + value + '</div>' +
      '</div>';
    }
    case "knob180Num": case "knob270Num": case "knob180Named": case "knob270Named": {
      var arc = ctpKnobArc(comp.type), named = ctpIsNamedKnob(comp.type);
      var points = Math.max(2, Number(d.points) || 5);
      var idx = Math.max(0, Math.min(points - 1, Math.round(Number(val != null ? val : d.value) || 0)));
      var angle = points > 1 ? (-arc / 2 + (arc / (points - 1)) * idx) : 0;
      var label = named ? esc(String((d.names || [])[idx] || "")) : String(idx + 1);
      return '<div class="ctp-knob ctp-knob-detent">' +
        '<div class="ctp-knob-ticks">' + ctpKnobTicks(points, arc, named ? d.names : null) + '</div>' +
        '<div class="ctp-knob-body"><div class="ctp-knob-pointer" style="transform:rotate(' + angle + 'deg)"></div></div>' +
        '<div class="ctp-knob-label">' + label + '</div>' +
      '</div>';
    }
    case "knobFull": {
      var fval = Number(val != null ? val : d.value) || 0;
      return '<div class="ctp-knob ctp-knob-full">' +
        (d.showIntervals ? '<div class="ctp-knob-ticks">' + ctpKnobTicks(Math.max(2, Number(d.intervalCount) || 12), 360, null) + '</div>' : '') +
        '<div class="ctp-knob-body"><div class="ctp-knob-pointer" style="transform:rotate(' + fval + 'deg)"></div></div>' +
      '</div>';
    }
    case "light": {
      var lon = !!val;
      return '<div class="ctp-light ctp-light-' + (d.style || "round") + (lon ? " on" : "") + '" style="' + (lon ? "--ctp-light-color:" + (d.color || "#ff453a") + ";" : "") + '"></div>';
    }
    case "gauge": {
      var gmin = Number(d.min) || 0, gmax = Number(d.max) || 100;
      var gval = val != null ? Number(val) : (Number(d.defaultValue) || 0);
      var gpct = gmax > gmin ? Math.max(0, Math.min(1, (gval - gmin) / (gmax - gmin))) : 0;
      var gAngle = -120 + gpct * 240;
      return '<div class="ctp-gauge"><div class="ctp-gauge-face"><div class="ctp-gauge-needle" style="transform:rotate(' + gAngle + 'deg)"></div><div class="ctp-gauge-hub"></div></div><div class="ctp-gauge-val">' + Math.round(gval) + '</div></div>';
    }
    case "digitalDisplay": {
      var text = val != null ? String(val) : (d.defaultText || "----");
      return '<div class="ctp-digital"><span class="ctp-digital-text">' + esc(text) + '</span></div>';
    }
    case "image": case "gif":
      return d.src ? '<img class="ctp-media" src="' + esc(d.src) + '" style="object-fit:' + esc(d.fit || "contain") + '" draggable="false" alt="" />' : '<div class="ctp-media ctp-media-empty">' + (comp.type === "gif" ? "🎞" : "🖼") + '</div>';
    case "label":
      return '<div class="ctp-label-text" style="font-size:' + (Number(d.fontSize) || 14) + 'px;color:' + esc(d.color || "#e8e8e8") + ';text-align:' + esc(d.align || "center") + '">' + esc(d.text || "") + '</div>';
    case "shape":
      if (d.shapeType === "line") return '<div class="ctp-shape-line" style="background:' + esc(d.color || "#5a5f68") + '"></div>';
      return '<div class="ctp-shape-rect" style="border-width:' + (Number(d.strokeWidth) || 2) + 'px;border-color:' + esc(d.color || "#5a5f68") + ';background:' + esc(d.fill || "transparent") + '"></div>';
    default:
      return "";
  }
}

function ctpComponentWrapStyle(comp) {
  return "left:" + comp.x + "px;top:" + comp.y + "px;width:" + comp.w + "px;height:" + comp.h + "px;" + (comp.rot ? "transform:rotate(" + comp.rot + "deg);" : "");
}

function ctpRenderZoneComponents(comps, valuesById, outputsById, interactiveClass) {
  return comps.map(function (comp) {
    var kind = ctpComponentKind(comp.type);
    var isInteractive = interactiveClass && (kind === "boolean" || kind === "index" || kind === "numeric");
    return '<div class="ctp-comp ctp-comp-' + comp.type + (isInteractive ? " ctp-comp-interactive" : "") + '" data-compid="' + esc(comp.id) + '" data-comptype="' + comp.type + '" data-zone="' + esc(comp.zone) + '" style="' + ctpComponentWrapStyle(comp) + '" title="' + esc(comp.name || "") + '">' +
      ctpComponentInnerHtml(comp, ctpResolvedValue(comp, valuesById, outputsById)) +
    '</div>';
  }).join("");
}

// Renders the whole two-tier board — an upper "wall" zone and a lower
// "desk" zone, either collapsible to 0 height for a single-section panel
// (see content.board). `interactive` marks components as player-clickable
// (adds ctp-comp-interactive) — true at player-time while the node is
// still open, false once solved or when just previewing the design.
function ctpRenderBoard(content, valuesById, outputsById, interactive) {
  var board = content.board || {};
  var comps = content.components || [];
  var upperH = Math.max(0, Number(board.upperHeight) || 0);
  var lowerH = Math.max(0, Number(board.lowerHeight) || 0);
  // Not `Number(board.width) || 640` — that would treat an explicit,
  // intentional width of 0 (the minimum, so the panel fits a narrow player
  // screen) as falsy and silently reset it back to 640.
  var widthRaw = Number(board.width);
  var width = Math.max(CTP_BOARD_MIN_W, Math.min(CTP_BOARD_MAX_W, isFinite(widthRaw) ? widthRaw : 640));
  var html = '<div class="ctp-board" style="width:' + width + 'px">';
  if (upperH > 0) {
    html += '<div class="ctp-zone ctp-zone-upper" data-zone="upper" style="height:' + upperH + 'px">' +
      ctpRenderZoneComponents(comps.filter(function (x) { return x.zone === "upper"; }), valuesById, outputsById, interactive) +
    '</div>';
  }
  if (lowerH > 0) {
    html += '<div class="ctp-zone ctp-zone-lower" data-zone="lower" style="height:' + lowerH + 'px">' +
      ctpRenderZoneComponents(comps.filter(function (x) { return x.zone === "lower"; }), valuesById, outputsById, interactive) +
    '</div>';
  }
  if (upperH <= 0 && lowerH <= 0) html += '<div class="ctp-zone-empty-note">This panel has no height yet — set the wall and/or desk section height in the builder below.</div>';
  html += '</div>';
  return html;
}

// Control Panel Builder — auto-validates after every interaction (same
// "auto-validate, no submit button" family as Fuse Panel/Lumen Puzzle/Gear
// & Pulley), driven by wireControlPanelInteractions below, which only calls
// this once every entry in content.winConditions is simultaneously met.
function pv_action_submitControlPanel(session, nodeId, valuesById) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var mechanicOk = ctpWinConditionsMet(n.content.winConditions, valuesById);
  var ok = nodeCompletionOk(n, session, mechanicOk);
  session.state.feedback[nodeId] = ok ? "correct" : "incorrect";
  if (ok) { completeNodeInternal(n, session.hunt, session.state); recompute(session); }
  return ok;
}

// Lock and Key — unlike the other puzzle types above, correctness here
// isn't derived from the submitted value (there's no free-text or grid
// state to check) — the caller (wireLockAndKeyInteractions below) already
// worked out whether the key that was tapped-in matches
// content.correctKeyNodeId before calling this, since it also needs that
// same yes/no to decide which animation (wrong-key bounce vs. shackle
// pop) to play. This function's job is just the usual "record feedback,
// complete + recompute on success" bookkeeping, same shape as every
// pv_action_submit* above.
function pv_action_submitLockAndKey(session, nodeId, mechanicOk) {
  var n = session.hunt.nodes.find(function (x) { return x.id === nodeId; });
  var ok = nodeCompletionOk(n, session, !!mechanicOk);
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
var PLAYER_SCREEN_TYPES = ["scene", "choice", "storyBlock", "videoStory", "answerEntry", "ordering", "matching", "locationPlaceholder", "geolocationCheckIn", "ending",
  "cipher", "mathLogic", "anagram", "sequencePattern", "slidingTile", "multiPartAnswer", "physicalLockCode", "cryptexLock", "crossReferenceLookup",
  "imageReveal", "videoReveal", "fusePanel", "clickableImage", "pdfReveal", "ropeTying", "lumenPuzzle", "gearPulley", "weightScale", "categoryGrid", "constraintSatisfaction", "cellPhone", "lockAndKey", "controlPanel"];

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
var BACK_BUTTON_TYPES = ["choice", "answerEntry", "ordering", "matching", "locationPlaceholder", "geolocationCheckIn",
  "cipher", "mathLogic", "anagram", "sequencePattern", "slidingTile", "multiPartAnswer",
  "physicalLockCode", "cryptexLock", "crossReferenceLookup", "imageReveal", "videoReveal", "fusePanel", "pdfReveal", "ropeTying", "lumenPuzzle", "gearPulley", "weightScale", "categoryGrid", "constraintSatisfaction", "lockAndKey", "controlPanel"];

// Default primary-action button text per node type, used by
// renderPreviewNode below unless a creator sets node.buttonLabel to
// override it. Only types with one clear "do this to progress" button are
// listed — Choice (per-option buttons), Sequence Pattern and Sliding Tile
// (auto-validate on interaction, no discrete submit) aren't, so Studio's
// inspector doesn't offer a button-label field for those either (see
// BUTTON_LABEL_TYPES export).
var DEFAULT_BUTTON_LABEL = {
  scene: "Continue →", imageReveal: "Continue →", videoReveal: "Continue →", locationPlaceholder: "Continue →", pdfReveal: "Continue →",
  answerEntry: "Submit", cipher: "Submit", mathLogic: "Submit", anagram: "Submit", crossReferenceLookup: "Submit",
  ordering: "Submit order", matching: "Submit matches",
  multiPartAnswer: "Submit all parts", physicalLockCode: "Unlock", ropeTying: "Hoist", geolocationCheckIn: "📍 Check my location"
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

// A hint node (or Hint Unlock Cost node) no longer has its target picked
// manually in the inspector — it auto-attaches to whatever node is
// connected into it on the canvas (any node type, not just puzzles), same
// "one deterministic incoming connection" rule as previousConnectingNode.
// Studio calls this after every connection/node mutation (see Store.
// addConnection/removeConnection/removeNode/removeNodes/duplicateNode and
// Store.replaceHunt in app.js) to keep content.forNodeId in sync; it's
// also safe to call defensively any time since it's idempotent.
function syncHintForNodeIds(hunt) {
  (hunt.nodes || []).forEach(function (n) {
    if (n.type !== "hint" && n.type !== "hintUnlockCost") return;
    var connected = previousConnectingNode(hunt, n.id);
    n.content.forNodeId = connected ? connected.id : "";
  });
}

// How many of a hint's progressive stages should already be auto-revealed
// purely from elapsed time, independent of any manual "Reveal hint" click.
// Each stage's delayMinutes/delaySeconds is measured from the moment the
// hint's connecting node first became available (state.availableAt — see
// markAvailable in recompute), not from when a previous stage revealed —
// so stage 2's timer isn't relative to stage 1's, it's relative to the
// same activation moment. Stops at the first stage whose timer hasn't
// elapsed yet, so stages still surface in order.
function autoRevealedHintStageCount(hunt, state, hintNode) {
  var targetId = hintNode.content && hintNode.content.forNodeId;
  var activatedAt = targetId && state.availableAt ? state.availableAt[targetId] : null;
  if (!activatedAt) return 0;
  var elapsedMs = Date.now() - activatedAt;
  var stages = (hintNode.content && hintNode.content.stages) || [];
  var count = 0;
  for (var i = 0; i < stages.length; i++) {
    var delayMs = ((Number(stages[i].delayMinutes) || 0) * 60 + (Number(stages[i].delaySeconds) || 0)) * 1000;
    if (elapsedMs >= delayMs) count = i + 1; else break;
  }
  return count;
}

// Markup for one hint's "Reveal hint" button + its already-revealed stage
// text, shared by renderLaneOptionsList's Hints lane and by the hint block
// under whichever node is currently on screen (renderPreviewNode). Wrapped
// in a [data-hint-wrap] container keyed to the hint node's id so app.js's
// tickHintReveals() can refresh just this block in place every second (to
// surface time-based auto-reveals — see autoRevealedHintStageCount above)
// without touching the rest of the screen, which may hold in-progress
// puzzle input the player is mid-interacting with.
function renderHintBlockHtml(session, h) {
  var shown = Math.max(session.state.hintProgress[h.id] || 0, autoRevealedHintStageCount(session.hunt, session.state, h));
  var html = '<div data-hint-wrap="' + h.id + '" data-shown="' + shown + '">';
  html += '<button class="pv-hint-btn" data-hint="' + h.id + '" ' + (shown >= h.content.stages.length ? "disabled" : "") + '>💡 Reveal hint (' + shown + "/" + h.content.stages.length + ')</button>';
  for (var i = 0; i < shown; i++) html += '<div class="pv-hint-text"' + pvFontStyle(h.content.stages[i].fontSize, 12) + '>' + esc(h.content.stages[i].text) + '</div>';
  html += '</div>';
  return html;
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

// The Inventory tab's own listing, used instead of laneOptionsForScene:
// unlike Leads/Hints, items are NOT scoped to whatever scene the player
// currently has open — a granted item stays visible no matter which scene
// you're viewing. An item shows the instant its node becomes available
// (that's the "granted" moment — regardless of node type, and regardless
// of whether a non-auto-type item node has since been tapped/completed),
// and keeps showing indefinitely unless state.itemConsumed says one of
// its outgoing connections has fired (see settleInventoryConsumption in
// the interpreter above) — a node with no outgoing connection just never
// gets consumed. Sorted newest-grant-first via state.availableAt, the
// timestamp each node first became available.
function globalInventoryItems(session) {
  var hunt = session.hunt, state = session.state;
  var consumed = state.itemConsumed || {};
  var items = hunt.nodes.filter(function (n) {
    return n.lane === "inventory" && n.type !== "hint" && !!state.available[n.id] && !consumed[n.id];
  });
  return items.sort(function (a, b) { return (state.availableAt[b.id] || 0) - (state.availableAt[a.id] || 0); });
}

var LANE_LIST_TITLES = { leads: "Open leads", inventory: "Evidence & discoveries", hints: "Hints" };

// Renders the list markup for a lane tab tap: leads are clickable
// (data-lead, same mechanism as the Open Leads list) since they're
// live player screens; inventory entries are read-only "you're carrying
// this" cards for every currently-granted item across the whole hunt (see
// globalInventoryItems, whose ordering — most recently granted first — is
// preserved here as-is); hints are rendered as their normal progressive
// reveal control, labelled with which puzzle each one belongs to since
// more than one can be open at once. Caller is responsible for wiring
// [data-lead]/[data-hint] after inserting this into the DOM (see
// ctl.render / wireHintButtons).
function renderLaneOptionsList(session, laneId, nodes) {
  var hunt = session.hunt, state = session.state;
  var title = LANE_LIST_TITLES[laneId] || "Options";
  var html = '<p class="pv-side-title">' + esc(title) + (nodes.length ? " (" + nodes.length + ")" : "") + '</p>';
  if (!nodes.length) {
    html += '<div class="pv-empty" style="padding-top:20px">' + (laneId === "inventory" ? "Nothing in your inventory yet." : "Nothing available here yet in this scene.") + '</div>';
    return html;
  }
  if (laneId === "hints") {
    nodes.forEach(function (h) {
      html += '<div style="margin-bottom:16px"><div style="color:var(--pv-text-dim);font-size:11.5px;margin-bottom:4px">For: ' + esc(nodeTitle(hunt, h.content.forNodeId)) + '</div>';
      html += renderHintBlockHtml(session, h);
      html += '</div>';
    });
  } else if (laneId === "inventory") {
    // Auto types (Award Item, Score, Set Variable) resolve instantly and
    // have no player screen — the Inventory lane's original read-only
    // "here's what's happened so far" summary card is all there is to
    // show for them. Anything else placed in this lane (e.g. a Cell
    // Phone node — see NODE_TYPES.cellPhone) genuinely has a screen to
    // open, so it gets the same clickable [data-lead] treatment as an
    // Open Lead — see the [data-lead] wiring in ctl.render() below,
    // shared across every lane's list view.
    nodes.forEach(function (n) {
      // Key nodes get their own photo+name card (same "found item" reading
      // as the plain icon+summary cards below, just with the key's actual
      // uploaded art instead of a generic icon) — everything else keeps
      // the existing icon+summary treatment.
      if (n.type === "key") {
        html += '<div class="pv-info-card pv-key-inv-card">' +
          (n.content.imageAsset ? '<img class="pv-key-inv-thumb" src="' + esc(n.content.imageAsset) + '" alt="" />' : '<span class="pv-key-inv-thumb pv-key-inv-thumb-empty">🔑</span>') +
          '<span>' + esc(n.content.name || n.title) + '</span></div>';
      } else if (n.type === "awardItem") {
        // Show the actual granted item's catalog name (hunt.items), not
        // the Award Item node's own creator-facing title.
        html += '<div class="pv-info-card">' + NODE_TYPES[n.type].icon + " " + esc(itemName(hunt, n.content.itemId)) + '</div>';
      } else if (isAutoType(n.type)) {
        html += '<div class="pv-info-card">' + NODE_TYPES[n.type].icon + " " + esc(NODE_TYPES[n.type].summary(n.content, hunt)) + '</div>';
      } else {
        html += '<div class="pv-choice-btn" data-lead="' + n.id + '">' + NODE_TYPES[n.type].icon + " " + esc(n.title) + '</div>';
      }
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

// Video Reveal — shows the node's uploaded video (c.videoAsset, a data URI).
// Always fits the whole video to the screen (object-fit: contain, no
// cropping — see .pv-video-frame in styles.css), same "original" framing
// as Image Reveal's default, just without a crop/aspect system since a
// video's own dimensions should never be distorted or clipped. When
// c.showControls is true (the default) the browser's native control bar
// handles play/pause/seek/volume — that bar is effectively "the menu" a
// creator can choose to show or hide from the Studio inspector (see
// buildVideoRevealFields in app.js). When hidden, no controls at all would
// leave the player with no way to start playback on their own, so a
// minimal custom play/pause button is rendered over the video instead —
// wired up by wireVideoRevealPlayback below, which toggles a
// .pv-video-playing class in sync with the element's own play/pause
// events (so it also reflects native fullscreen playback controls, if the
// player double-taps into fullscreen).
function renderVideoRevealBlock(c) {
  c = c || {};
  var html = '<div class="pv-video-reveal">';
  if (!c.videoAsset) {
    html += '<div class="pv-video-frame pv-video-empty">No video uploaded</div>';
  } else {
    html += '<div class="pv-video-frame">' +
      '<video class="pv-video-el" id="pvVideoEl" src="' + esc(c.videoAsset) + '" playsinline' +
      (c.showControls !== false ? " controls" : "") +
      (c.loop ? " loop" : "") + '></video>' +
      (c.showControls === false
        ? '<button type="button" class="pv-video-playpause" id="pvVideoToggle" aria-label="Play video">▶</button>'
        : '') +
      '</div>';
  }
  if (c.caption) html += '<div class="pv-image-caption">' + esc(c.caption) + '</div>';
  html += '</div>';
  return html;
}

// Wires the custom play/pause overlay for a Video Reveal node when its
// native controls are hidden (c.showControls === false — see
// renderVideoRevealBlock). Tapping the video or the overlay button toggles
// playback; a "play"/"pause"/"ended" listener on the element itself (not a
// click count) keeps the button's icon and visibility in sync no matter
// what triggered the state change. No-ops when controls are shown, since
// the browser's own control bar already handles this.
function wireVideoRevealPlayback(root, c) {
  var wrap = root.querySelector(".pv-video-frame");
  var video = root.querySelector("#pvVideoEl");
  var toggle = root.querySelector("#pvVideoToggle");
  if (!video || !wrap || c.showControls !== false) return;
  var sync = function () {
    var playing = !video.paused && !video.ended;
    wrap.classList.toggle("pv-video-playing", playing);
    if (toggle) {
      toggle.textContent = playing ? "❚❚" : "▶";
      toggle.setAttribute("aria-label", playing ? "Pause video" : "Play video");
    }
  };
  video.addEventListener("play", sync);
  video.addEventListener("pause", sync);
  video.addEventListener("ended", sync);
  var toggleFn = function () { if (video.paused || video.ended) video.play(); else video.pause(); };
  wrap.onclick = toggleFn;
  sync();
}

// Video Story — same fit-to-screen markup as Video Reveal (reuses the
// .pv-video-frame/.pv-video-el classes, plus a .pv-video-story modifier for
// slightly more cinematic framing — see styles.css) but always carries the
// autoplay attribute, and its tap-to-play fallback button starts hidden —
// it's only revealed by wireVideoStoryPlayback below if the browser's
// autoplay policy actually blocks playback, so it's never shown for no
// reason during normal (successful) autoplay.
function renderVideoStoryBlock(c) {
  c = c || {};
  var html = '<div class="pv-video-reveal pv-video-story">';
  if (!c.videoAsset) {
    html += '<div class="pv-video-frame pv-video-empty">No video uploaded</div>';
  } else {
    html += '<div class="pv-video-frame">' +
      '<video class="pv-video-el" id="pvVideoEl" src="' + esc(c.videoAsset) + '" playsinline autoplay' +
      (c.showControls ? " controls" : "") + '></video>' +
      '<button type="button" class="pv-video-playpause" id="pvVideoToggle" aria-label="Play video" style="display:none">▶</button>' +
      '</div>';
  }
  if (c.caption) html += '<div class="pv-image-caption">' + esc(c.caption) + '</div>';
  html += '</div>';
  return html;
}

// Wires a Video Story node's fully-automatic playback (see the videoStory
// entry in NODE_TYPES above): attempts to start the video the instant it
// renders — the autoplay attribute alone is sometimes silently ignored by
// browser autoplay policy, so a direct .play() call, made synchronously
// here as part of the same render pass that's already inside the player's
// last tap/click handler, backs it up — and only reveals the fallback
// tap-to-play button if that attempt is actually blocked. The node
// completes itself the instant the video ends, popping straight into
// whatever connects out of it — no Continue button, no player action
// required. When the player is peeking back at an already-completed Video
// Story (e.g. via a later node's Back button pointing at this one — see
// ctl.peekStack), it doesn't re-complete the node (which could double up
// effects) — it just pops the peek stack once the replay finishes, same
// "forward action returns instead of re-completing" treatment pvContinue
// gives every other peeked node type. Guarded on the element actually
// being present, same convention as every other wireX helper here — and
// on the node actually being a Video Story, since Video Reveal's hidden-
// controls markup reuses the exact same #pvVideoEl/#pvVideoToggle ids and
// would otherwise get double-wired by both this and wireVideoRevealPlayback.
function wireVideoStoryPlayback(root, ctl, session, n) {
  var video = root.querySelector("#pvVideoEl");
  if (!video) return;
  var toggle = root.querySelector("#pvVideoToggle");
  var peeking = !!(ctl.peekStack && ctl.peekStack.length && ctl.peekStack[ctl.peekStack.length - 1] === n.id);
  var advanced = false;
  var advance = function () {
    if (advanced) return;
    advanced = true;
    if (peeking) { ctl.peekStack.pop(); ctl.render(); return; }
    var ok = pv_action_continueScene(session, n.id);
    if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  };
  video.addEventListener("ended", advance);
  if (toggle) {
    toggle.onclick = function () { video.play(); };
    video.addEventListener("play", function () { toggle.style.display = "none"; });
  }
  var playAttempt = video.play();
  if (playAttempt && typeof playAttempt.catch === "function") {
    playAttempt.catch(function () {
      // Autoplay was blocked (e.g. an unmuted video with no fresh enough
      // user gesture) — fall back to a tap-to-play button rather than
      // leaving the player stuck on a frozen first frame.
      if (toggle) toggle.style.display = "";
    });
  }
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

// The status line shown above a Geolocation Check-in's "Check my location"
// button — see renderPreviewNode's "geolocationCheckIn" branch, above,
// which is the only caller. lastDistance is session.state.geoLastDistance[nodeId]
// (metres, rounded) from the most recent check, if any.
function geoStatusMessage(status, lastDistance, radius) {
  if (status === "unsupported") return "This browser/device doesn’t support geolocation, so this check-in can’t be verified here.";
  if (status === "denied") return "Location permission was denied — allow location access and try again.";
  if (status === "locating") return "Getting your current location…";
  if (lastDistance != null) {
    return lastDistance <= radius
      ? "✓ You’re " + lastDistance + "m from the target — within range."
      : "You’re about " + lastDistance + "m from the target — get within " + radius + "m and check in again.";
  }
  return "Not checked in yet.";
}

// Choice options and Story Block buttons are each their own independent
// text field in the inspector (one per option/button), so each gets its
// own font size too, read off the option/button object itself.
function pvItemButton(cls, dataAttr, label, fontSize, baseStyle) {
  var fs = fontSize || 13.5;
  var style = (baseStyle ? baseStyle + ";" : "") + "font-size:" + fs + "px";
  return '<button class="' + cls + '" ' + dataAttr + ' style="' + style + '">' + esc(label) + '</button>';
}

/* ---------------------------------------------------------------------
   Cell Phone — player runtime helpers. A self-contained prop (see the
   cellPhone entry in NODE_TYPES above): its own internal screen-stack
   navigation (Home → Calls/Voicemails/SMS → sub-screens), driven by a
   D-pad (up/down/left/right/select) plus Back/Menu softkeys drawn as
   part of the phone graphic. Nav state lives in ctl.phoneNav[nodeId]
   (volatile, like ctl.orderingDraft etc. — see createPreviewController)
   rather than session.state, since it's just "where in the phone's menus
   is the player right now", not something that needs to survive a
   session reload.
--------------------------------------------------------------------- */

// Lazily creates/returns this node's nav state. focusIndex/focusCols
// drive the D-pad: the currently-rendered screen's focusable elements
// are numbered 0..N-1 in DOM order (data-cpfocus="i"), focusCols is how
// many of them sit in one "row" for the purposes of Up/Down vs
// Left/Right (1 for plain vertical lists, 3 for the keypad's digit
// grid) — see wireCellPhoneInteractions' dpad handling below.
function cpNav(ctl, nodeId) {
  var nav = ctl.phoneNav[nodeId];
  if (!nav) {
    nav = ctl.phoneNav[nodeId] = {
      stack: ["home"], dialedDigits: "",
      activeContactId: null, activeVoicemailId: null, activeThreadId: null,
      callPhase: null, // "ringing" | "connected" | "engaged" while stack top is "inCall"
      focusIndex: 0, focusCols: 1,
      ringTimeoutId: null, engagedIntervalId: null // timer handles so hanging up/backing out can cancel them — see cpStopCallAudio
    };
  }
  return nav;
}
function cpScreen(nav) { return nav.stack[nav.stack.length - 1]; }
function cpPush(nav, screen) { nav.stack.push(screen); nav.focusIndex = 0; nav.focusCols = 1; }
function cpPop(nav) { if (nav.stack.length > 1) nav.stack.pop(); nav.focusIndex = 0; nav.focusCols = 1; }
function cpGoHome(nav) { nav.stack = ["home"]; nav.focusIndex = 0; nav.focusCols = 1; }

// Cancels any in-flight ring timeout / engaged-tone interval — called
// whenever the player leaves the "inCall" screen (Hang Up, Back, Menu),
// so a stale timer never fires a phase change after the player's already
// moved on, and a busy-tone loop never keeps beeping in the background.
function cpStopCallAudio(nav) {
  if (nav.ringTimeoutId) { clearTimeout(nav.ringTimeoutId); nav.ringTimeoutId = null; }
  if (nav.engagedIntervalId) { clearInterval(nav.engagedIntervalId); nav.engagedIntervalId = null; }
}

function cpEnabledSections(c) {
  var s = c.sections || {};
  var out = [];
  if (s.calls) out.push({ key: "calls", label: "Calls", icon: "📞" });
  if (s.voicemails) out.push({ key: "voicemails", label: "Voicemails", icon: "📼" });
  if (s.sms) out.push({ key: "sms", label: "Messages", icon: "💬" });
  return out;
}

// Digits (and * / #) only — used both to render the keypad readout and to
// compare a dialled number against a contact's saved numbers, so
// formatting differences ("07911 123 456" vs "07911123456") don't matter.
function cpNormalizeDigits(s) { return String(s || "").replace(/[^0-9*#]/g, ""); }
function cpContactNumbers(contact) {
  return String(contact.numbers || "").split(",").map(cpNormalizeDigits).filter(function (x) { return x.length > 0; });
}
function cpFindContactByDigits(c, digits) {
  var norm = cpNormalizeDigits(digits);
  if (!norm) return null;
  return (c.contacts || []).find(function (ct) { return cpContactNumbers(ct).indexOf(norm) !== -1; }) || null;
}

// ---- Tone synthesis (Web Audio) — no vendored audio files needed for
// the ring/engaged tones, same "synthesize tiny clicks with an
// oscillator" approach as telephone-exchange.html's plug/jack sounds.
// No-ops quietly if Web Audio isn't available (e.g. under Node during
// export/validation) rather than throwing. ---------------------------
var _cpAudioCtx = null;
function cpAudioCtx() {
  if (typeof window === "undefined") return null;
  try {
    if (!_cpAudioCtx) _cpAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return _cpAudioCtx;
  } catch (e) { return null; }
}
function cpBeep(freq, startAt, dur) {
  var ctx = cpAudioCtx(); if (!ctx) return;
  try {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine"; o.frequency.value = freq;
    var t0 = ctx.currentTime + Math.max(0, startAt);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  } catch (e) { /* audio unavailable, ignore */ }
}
// Classic two-tone ring cadence (400Hz+450Hz together), ~0.4s on, played
// twice about a second apart to cover the couple of seconds a Calling…
// screen sits on before connecting.
function cpPlayRingCadence() {
  [0, 1].forEach(function (t) { cpBeep(400, t, 0.4); cpBeep(450, t, 0.4); });
}
// Busy/engaged tone — a single 400Hz tone pulsing on/off, looped until
// cpStopCallAudio clears the interval it's scheduled on.
function cpPlayEngagedPulse() { cpBeep(400, 0, 0.35); }

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
  } else if (n.type === "videoReveal") {
    html += renderVideoRevealBlock(c);
    html += pvPrimaryButton(n, "pvContinue", "max-width:200px");
    var fbVr = session.state.feedback[n.id];
    if (fbVr === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
  } else if (n.type === "videoStory") {
    // No Continue button — this node type completes itself when the video
    // ends (see wireVideoStoryPlayback below). The feedback line only ever
    // shows if a creator has added a completion override condition (see
    // nodeCompletionOk) that wasn't actually met the moment the video
    // finished — wireVideoStoryPlayback re-renders either way, so the
    // player sees this note and a freshly replayed video to try again.
    html += renderVideoStoryBlock(c);
    var fbVs = session.state.feedback[n.id];
    if (fbVs === "incorrect") html += '<div class="pv-feedback incorrect">Not yet — the requirement for this to continue hasn’t been met.</div>';
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
  } else if (n.type === "geolocationCheckIn") {
    // Real geolocation check — see pv_action_submitGeoCheckIn (mechanic
    // math) and wirePreviewNodeInteractions' "geolocationCheckIn" branch
    // below (talks to navigator.geolocation, then calls that action). The
    // status line below reflects ctl.geoStatus[n.id], a small state
    // machine ("idle" | "locating" | "denied" | "unsupported" | "checked")
    // set by that wiring — this render only ever reads it.
    var geoStatus = (ctl.geoStatus && ctl.geoStatus[n.id]) || "idle";
    var geoRadius = Number(c.radiusMeters) || 25;
    html += '<div class="pv-scene-body">Head to the marked location, then check in — you’ll need to be within ' + geoRadius + 'm of the target point.</div>';
    html += '<div class="pv-info-card" id="pvGeoStatus">' + geoStatusMessage(geoStatus, session.state.geoLastDistance && session.state.geoLastDistance[n.id], geoRadius) + '</div>';
    html += geoStatus === "locating"
      ? '<button type="button" class="pv-choice-btn" id="pvGeoCheck" style="max-width:220px" disabled>Locating…</button>'
      : pvPrimaryButton(n, "pvGeoCheck", "max-width:220px");
    var fbGeo = session.state.feedback[n.id];
    if (fbGeo === "incorrect") html += '<div class="pv-feedback incorrect">Too far away — get closer and check in again.</div>';
    // Real GPS rarely lines up with the target while testing from a desk,
    // so offer a manual stand-in for "I've arrived" instead of forcing
    // every playtest out into the field — gated behind ctl.previewOnly
    // (see createPreviewController, below) so a future standalone player
    // build can turn this off and require the real check.
    if (ctl.previewOnly) {
      html += '<button type="button" class="pv-choice-btn pv-back-btn" id="pvGeoSimulate" style="max-width:260px;margin-top:8px">🧪 Simulate arrival (preview only)</button>';
    }
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
    var lockDm = isDarkMaritime(c);
    var lockStyleKey = LOCK_STYLES[c.lockStyle] ? c.lockStyle : "classicBrass";
    var lockStyle = lockDm ? { playerLabel: "engraved iron ship's lock", brand: "Harrow & Sons, Chandlers" } : LOCK_STYLES[lockStyleKey];
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

    html += '<div class="pv-lock-wrap' + (lockDm ? ' pv-dm' : ' pv-lock-style-' + lockStyleKey) + (isAlphaLock ? ' pv-lock-alpha' : '') + (fbLo === "correct" ? ' pv-lock-open' : '') + '">';
    html += '<div class="pv-lock-shackle"></div>';
    html += '<div class="pv-lock-body">';
    if (lockDm) html += '<svg class="pv-dm-hatch-bg" viewBox="0 0 100 100" preserveAspectRatio="none"><defs>' + dmDefs("lk" + n.id.replace(/[^a-zA-Z0-9]/g, "") + "_") + '</defs><rect width="100" height="100" fill="url(#lk' + n.id.replace(/[^a-zA-Z0-9]/g, "") + '_dmH1)"/></svg>';
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
    html += renderCryptexSvg(n.id, ctl.cryptexDraft[n.id], isDarkMaritime(c));
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
    var fuseDm = isDarkMaritime(c);
    html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<div class="pv-fuse-panel' + (fuseDm ? ' pv-dm' : '') + '">';
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
  } else if (n.type === "ropeTying") {
    if (!ctl.ropeDraft[n.id]) ctl.ropeDraft[n.id] = { connections: [], selected: null };
    if (c.prompt) html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += renderRopeBoardSvg(n, ctl);
    html += pvPrimaryButton(n, "pvHoistBtn", "max-width:200px;margin-top:10px");
    var fbRt = session.state.feedback[n.id];
    if (fbRt === "incorrect") html += '<div class="pv-feedback incorrect">✗ Not tied correctly — try again.</div>';
    if (fbRt === "correct") html += '<div class="pv-feedback correct">✓ Hoisted!</div>';
  } else if (n.type === "lumenPuzzle") {
    if (c.prompt) html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<div class="pv-lumen-wrap' + (isDarkMaritime(c) ? ' pv-dm' : '') + '" data-node="' + esc(n.id) + '">' +
      '<canvas class="pv-lumen-canvas" data-node="' + esc(n.id) + '"></canvas>' +
      '<div class="pv-lumen-toast" data-node="' + esc(n.id) + '">All targets solved ✨</div>' +
      '</div>' +
      '<div class="pv-lumen-summary" data-node="' + esc(n.id) + '"></div>';
    var fbLu = session.state.feedback[n.id];
    if (fbLu === "correct") html += '<div class="pv-feedback correct">✓ Beam routed.</div>';
  } else if (n.type === "gearPulley") {
    ctl.gearDraft = ctl.gearDraft || {};
    if (!ctl.gearDraft[n.id]) ctl.gearDraft[n.id] = gpInitDraft(c);
    if (c.prompt) html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += renderGearPulleyBoardSvg(n, ctl);
    html += renderGearPulleyTray(n, ctl);
    var fbGp = session.state.feedback[n.id];
    if (fbGp === "correct") html += '<div class="pv-feedback correct">✓ Drive connected — it turns freely.</div>';
  } else if (n.type === "weightScale") {
    ctl.wsDraft = ctl.wsDraft || {};
    if (!ctl.wsDraft[n.id]) ctl.wsDraft[n.id] = wsInitDraft(c);
    var wsSolved = !!session.state.completed[n.id];
    if (c.prompt) html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += renderWeightScaleStage(n, ctl, wsSolved);
    html += renderWeightScaleTray(n, ctl, wsSolved);
    var fbWs = session.state.feedback[n.id];
    if (fbWs === "correct") html += '<div class="pv-feedback correct">✓ Balanced — the beam settles dead level.</div>';
  } else if (n.type === "controlPanel") {
    ctl.controlPanelDraft = ctl.controlPanelDraft || {};
    if (!ctl.controlPanelDraft[n.id]) ctl.controlPanelDraft[n.id] = ctpDefaultValuesById(c);
    var ctpValues = ctl.controlPanelDraft[n.id];
    var ctpOutputs = ctpComputeOutputs(c, ctpValues);
    var ctpLocked = !!session.state.completed[n.id];
    if (c.prompt) html += '<div class="pv-scene-body">' + esc(c.prompt) + '</div>';
    html += '<div class="pv-ctp-wrap' + (ctpLocked ? ' locked' : '') + (isDarkMaritime(c) ? ' pv-dm' : '') + '" data-node="' + esc(n.id) + '">' + ctpRenderBoard(c, ctpValues, ctpOutputs, !ctpLocked) + '</div>';
    var fbCtp = session.state.feedback[n.id];
    if (fbCtp === "correct") html += '<div class="pv-feedback correct">✓ Panel set correctly.</div>';
  } else if (n.type === "categoryGrid") {
    if (!ctl.categoryGridDraft[n.id]) {
      ctl.categoryGridDraft[n.id] = { cells: [null, null, null, null, null, null, null, null, null], gallery: (c.images || []).map(function (im) { return im.id; }), selected: null };
    }
    var cgDraft = ctl.categoryGridDraft[n.id];
    var cgReveal = ctl.categoryGridReveal && ctl.categoryGridReveal[n.id];
    var cgImgById = {}; (c.images || []).forEach(function (im) { cgImgById[im.id] = im; });
    var cgCells = cgReveal ? cgReveal.cellIds : cgDraft.cells;
    var cgShowTitles = !!c.showImageTitles;
    if (c.body) html += '<div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div>';
    html += '<div class="pv-cgrid-wrap" data-node="' + esc(n.id) + '">';
    html += '<div class="pv-cgrid-board' + (cgReveal ? ' pv-cgrid-locked' : '') + '">';
    for (var cgi = 0; cgi < 9; cgi++) {
      var cgImg = cgCells[cgi] ? cgImgById[cgCells[cgi]] : null;
      html += '<div class="pv-cgrid-cell' + (cgDraft.selected === cgi ? ' selected' : '') + '" data-cgcell="' + cgi + '">' +
        (cgImg ? caGridPieceHtml(cgImg, "cell", !cgReveal, cgShowTitles) : '') +
        '</div>';
    }
    html += '</div>';
    if (cgReveal) {
      var cgLabels = cgReveal.phase === "rows" ? cgReveal.names.rows : cgReveal.names.cols;
      html += '<div class="pv-cgrid-reveal pv-cgrid-reveal-' + cgReveal.phase + '">' +
        cgLabels.map(function (label, i) {
          var pos = cgReveal.phase === "rows" ? "grid-row:" + (i + 1) : "grid-column:" + (i + 1);
          return '<div class="pv-cgrid-reveal-label" style="' + pos + ';animation-delay:' + (i * 0.35) + 's">' + esc(label) + '</div>';
        }).join("") +
        '</div>';
    }
    html += '</div>'; // .pv-cgrid-wrap
    if (!cgReveal) {
      html += '<div class="pv-cgrid-gallery" data-node="' + esc(n.id) + '">' +
        cgDraft.gallery.map(function (imgId) {
          var im = cgImgById[imgId];
          return im ? caGridPieceHtml(im, "gallery", true, cgShowTitles) : "";
        }).join("") +
        '</div>';
      var fbCg = session.state.feedback[n.id];
      if (fbCg === "incorrect") html += '<div class="pv-feedback incorrect">✗ Not quite — some rows or columns don’t share a category yet.</div>';
    }
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
  } else if (n.type === "constraintSatisfaction") {
    var cspItems = c.items || [], cspRecipients = c.recipients || [];
    if (!ctl.cspDraft[n.id]) ctl.cspDraft[n.id] = { mode: "info", alloc: {} };
    var cspState = ctl.cspDraft[n.id];
    cspState.alloc = cspState.alloc || {};
    // Defensively fill in any recipient/item combination the live draft
    // doesn't have an entry for yet — covers both first render and a
    // creator adding items/recipients while a Studio preview session with
    // an in-progress draft is still open.
    cspRecipients.forEach(function (r) {
      cspState.alloc[r.id] = cspState.alloc[r.id] || {};
      cspItems.forEach(function (it) { if (cspState.alloc[r.id][it.id] === undefined) cspState.alloc[r.id][it.id] = 0; });
    });
    var cspInfoIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9.5"/><line x1="12" y1="11" x2="12" y2="16.5" stroke-linecap="round"/><circle cx="12" cy="7.4" r="1.15" fill="currentColor" stroke="none"/></svg>';
    var cspGridIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>';
    var cspToggleTarget = cspState.mode === "info" ? "answer" : "info";
    var cspScale = cspLayoutScale(cspItems.length, cspRecipients.length);
    var cspWrapStyle = 'style="--csp-img:' + cspScale.imgSize + 'px;--csp-menu-img:' + cspScale.menuImgSize + 'px;' +
      '--csp-step:' + cspScale.stepSize + 'px;--csp-font-count:' + cspScale.fontCount + 'px;--csp-font-name:' + cspScale.fontName + 'px;' +
      '--csp-pad:' + cspScale.boxPad + 'px;--csp-gap:' + cspScale.gap + 'px;"';
    html += '<div class="pv-csp-wrap" data-node="' + esc(n.id) + '" ' + cspWrapStyle + '>';
    html += '<button type="button" class="pv-csp-toggle" data-csptoggle="' + cspToggleTarget + '" title="' +
      (cspToggleTarget === "answer" ? "Show answer entry" : "Show instructions") + '" aria-label="' +
      (cspToggleTarget === "answer" ? "Show answer entry" : "Show instructions") + '">' +
      (cspToggleTarget === "answer" ? cspGridIcon : cspInfoIcon) + '</button>';
    if (cspState.mode === "info") {
      // Top-aligned (not vertically centred/bottom-pinned like a Simple
      // Text screen's narrative body) — see .pv-csp-wrap in styles.css.
      html += '<div class="pv-csp-info"><div class="pv-scene-body"' + pvFontStyle(c.bodyFontSize) + '>' + esc(c.body) + '</div></div>';
    } else {
      // Title/toggle/recipient boxes are one top-aligned group
      // (.pv-csp-answer-top); the remaining-items menu is a second group
      // pinned to the bottom of the screen (.pv-csp-answer-bottom) — see
      // .pv-csp-answer's justify-content:space-between in styles.css.
      html += '<div class="pv-csp-answer">';
      html += '<div class="pv-csp-answer-top">';
      html += '<div class="pv-csp-title"' + pvFontStyle(c.answerTitleFontSize, 16) + '>' + esc(c.answerTitle || "") + '</div>';
      html += '<div class="pv-csp-recipients" style="grid-template-columns:repeat(' + cspScale.recipCols + ',1fr)">';
      cspRecipients.forEach(function (r) {
        html += '<div class="pv-csp-recip-box"><div class="pv-csp-recip-name">' + esc(r.name || "") + '</div>' +
          '<div class="pv-csp-recip-items" style="grid-template-columns:repeat(' + cspScale.itemCols + ',1fr)">';
        cspItems.forEach(function (it) {
          var cspCount = cspState.alloc[r.id][it.id] || 0;
          var cspRemain = cspItemRemaining(c, it.id, cspState.alloc);
          var cspWheelCls = "pv-csp-wheel" + (cspCount <= 0 ? " pv-csp-wheel-min" : "") + (cspRemain <= 0 ? " pv-csp-wheel-max" : "");
          html += '<div class="pv-csp-recip-item">' +
            (it.imageAsset
              ? '<img class="pv-csp-item-img" src="' + esc(it.imageAsset) + '" alt="' + esc(it.name || "") + '" title="' + esc(it.name || "") + '" />'
              : '<div class="pv-csp-item-img pv-csp-item-noimg" title="' + esc(it.name || "") + '">' + esc(it.name || "?") + '</div>') +
            // No +/- buttons — scroll or drag up/down on this widget to
            // change the count (see wireConstraintSatisfactionInteractions).
            '<div class="' + cspWheelCls + '" data-cspwheel data-rid="' + esc(r.id) + '" data-iid="' + esc(it.id) + '" tabindex="0" role="spinbutton" ' +
              'aria-valuenow="' + cspCount + '" aria-valuemin="0" aria-valuemax="' + (cspCount + cspRemain) + '" aria-label="' + esc(it.name || "Item") + ' for ' + esc(r.name || "recipient") + '" ' +
              'title="Scroll or drag up/down to change">' +
              '<span class="pv-csp-wheel-arrow pv-csp-wheel-arrow-up" aria-hidden="true">▲</span>' +
              '<span class="pv-csp-count">' + cspCount + '</span>' +
              '<span class="pv-csp-wheel-arrow pv-csp-wheel-arrow-down" aria-hidden="true">▼</span>' +
            '</div>' +
          '</div>';
        });
        html += '</div></div>';
      });
      html += '</div>'; // .pv-csp-recipients
      html += '</div>'; // .pv-csp-answer-top
      // Always exactly one row — grid-template-columns is set to exactly
      // the item count (never fewer), so there's no wrapping mechanism for
      // it to fall back to a second row.
      html += '<div class="pv-csp-answer-bottom">';
      html += '<div class="pv-csp-itemmenu" style="grid-template-columns:repeat(' + cspItems.length + ',1fr)">';
      cspItems.forEach(function (it) {
        var cspRemainMenu = cspItemRemaining(c, it.id, cspState.alloc);
        html += '<div class="pv-csp-itemmenu-entry" title="' + esc(it.name || "") + '">' +
          (it.imageAsset
            ? '<img class="pv-csp-itemmenu-img" src="' + esc(it.imageAsset) + '" alt="' + esc(it.name || "") + '" />'
            : '<div class="pv-csp-itemmenu-img pv-csp-item-noimg">' + esc(it.name || "?") + '</div>') +
          '<span class="pv-csp-itemmenu-count">' + cspRemainMenu + '</span>' +
        '</div>';
      });
      html += '</div>'; // .pv-csp-itemmenu
      var fbCsp = session.state.feedback[n.id];
      if (fbCsp === "incorrect") html += '<div class="pv-feedback incorrect">✗ Not quite — check the requirements and try again.</div>';
      html += '</div>'; // .pv-csp-answer-bottom
      html += '</div>'; // .pv-csp-answer
    }
    html += '</div>'; // .pv-csp-wrap
  } else if (n.type === "cellPhone") {
    // See the Cell Phone player-runtime helpers just above (cpNav et al.)
    // and wireCellPhoneInteractions below for the D-pad/softkey wiring
    // that drives cpNavSt.stack between renders. Every screen below sets
    // cpNavSt.focusCols so the D-pad's Up/Down vs Left/Right handling
    // knows whether it's paging a plain vertical list (1 column) or the
    // keypad's digit grid (3 columns) — see wireCellPhoneInteractions.
    var cpNavSt = cpNav(ctl, n.id);
    var cpScr = cpScreen(cpNavSt);
    var cpInner = "";
    var cpSections = cpEnabledSections(c);

    if (cpScr === "home") {
      cpNavSt.focusCols = 1;
      cpInner = !cpSections.length
        ? '<div class="pv-phone-empty">This phone has no apps set up yet.</div>'
        : '<div class="pv-phone-title">My Phone</div><div class="pv-phone-list">' +
          cpSections.map(function (s, i) {
            return '<button type="button" class="pv-phone-row" data-cpfocus="' + i + '" data-cpaction="openSection" data-section="' + s.key + '">' +
              '<span class="pv-phone-row-icon">' + s.icon + '</span><span class="pv-phone-row-label">' + esc(s.label) + '</span>' +
              '<span class="pv-phone-row-chevron">›</span></button>';
          }).join("") + '</div>';
    } else if (cpScr === "callsHome") {
      cpNavSt.focusCols = 1;
      cpInner = '<div class="pv-phone-title">📞 Calls</div><div class="pv-phone-list">' +
        '<button type="button" class="pv-phone-row" data-cpfocus="0" data-cpaction="openContacts"><span class="pv-phone-row-icon">📇</span><span class="pv-phone-row-label">Contacts</span><span class="pv-phone-row-chevron">›</span></button>' +
        '<button type="button" class="pv-phone-row" data-cpfocus="1" data-cpaction="openKeypad"><span class="pv-phone-row-icon">🔢</span><span class="pv-phone-row-label">Keypad</span><span class="pv-phone-row-chevron">›</span></button>' +
        '</div>';
    } else if (cpScr === "contacts") {
      cpNavSt.focusCols = 1;
      var cpVisContacts = (c.contacts || []).filter(function (ct) { return ct.showInContacts !== false; });
      cpInner = '<div class="pv-phone-title">📇 Contacts</div>' + (!cpVisContacts.length
        ? '<div class="pv-phone-empty">No contacts saved.</div>'
        : '<div class="pv-phone-list">' + cpVisContacts.map(function (ct, i) {
            return '<button type="button" class="pv-phone-row" data-cpfocus="' + i + '" data-cpaction="callContact" data-contact="' + esc(ct.id) + '">' +
              '<span class="pv-phone-row-icon">👤</span><span class="pv-phone-row-label">' + esc(ct.name || "(unnamed)") + '</span></button>';
          }).join("") + '</div>');
    } else if (cpScr === "keypad") {
      cpNavSt.focusCols = 3;
      var cpKeys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
      cpInner = '<div class="pv-phone-dial-readout">' +
        (cpNavSt.dialedDigits ? esc(cpNavSt.dialedDigits) : '<span class="pv-phone-dial-placeholder">Enter a number…</span>') + '</div>';
      cpInner += '<div class="pv-phone-keygrid">' + cpKeys.map(function (k, i) {
        return '<button type="button" class="pv-phone-key" data-cpfocus="' + i + '" data-cpaction="digit" data-digit="' + k + '">' + k + '</button>';
      }).join("") + '</div>';
      cpInner += '<div class="pv-phone-keyrow">' +
        '<button type="button" class="pv-phone-key pv-phone-key-clear" data-cpfocus="12" data-cpaction="clearDigit">⌫ Clear</button>' +
        '<button type="button" class="pv-phone-key pv-phone-key-call" data-cpfocus="13" data-cpaction="dial">📞 Call</button>' +
        '</div>';
    } else if (cpScr === "inCall") {
      cpNavSt.focusCols = 1;
      var cpCallContact = cpNavSt.activeContactId ? (c.contacts || []).find(function (ct) { return ct.id === cpNavSt.activeContactId; }) : null;
      var cpCallLabel = cpCallContact ? (cpCallContact.name || "(unnamed)") : (cpNavSt.dialedDigits || "Unknown number");
      if (cpNavSt.callPhase === "engaged") {
        cpInner = '<div class="pv-phone-call-status">' + esc(cpCallLabel) + '</div><div class="pv-phone-call-sub">Line engaged</div>' +
          '<div class="pv-phone-call-icon pv-phone-call-busy">📵</div>';
      } else if (cpNavSt.callPhase === "connected") {
        cpInner = '<div class="pv-phone-call-status">' + esc(cpCallLabel) + '</div><div class="pv-phone-call-sub">Connected</div>' +
          '<div class="pv-phone-call-icon">📞</div>' +
          (cpCallContact && cpCallContact.audioAsset
            ? '<audio class="pv-phone-audio" src="' + esc(cpCallContact.audioAsset) + '" autoplay controls></audio>'
            : '<div class="pv-phone-empty">No audio clip attached to this contact yet.</div>');
      } else {
        cpInner = '<div class="pv-phone-call-status">' + esc(cpCallLabel) + '</div><div class="pv-phone-call-sub">Calling…</div>' +
          '<div class="pv-phone-call-icon pv-phone-call-ringing">📞</div>';
      }
      cpInner += '<button type="button" class="pv-phone-hangup" data-cpfocus="0" data-cpaction="hangUp">🔴 Hang up</button>';
    } else if (cpScr === "voicemails") {
      cpNavSt.focusCols = 1;
      var cpVms = c.voicemails || [];
      cpInner = '<div class="pv-phone-title">📼 Voicemails</div>' + (!cpVms.length
        ? '<div class="pv-phone-empty">No voicemails.</div>'
        : '<div class="pv-phone-list">' + cpVms.map(function (vm, i) {
            return '<button type="button" class="pv-phone-row" data-cpfocus="' + i + '" data-cpaction="playVoicemail" data-voicemail="' + esc(vm.id) + '">' +
              '<span class="pv-phone-row-icon">▶️</span><span class="pv-phone-row-label">' + esc(vm.name || "(untitled)") + '</span></button>';
          }).join("") + '</div>');
    } else if (cpScr === "voicemailPlay") {
      cpNavSt.focusCols = 1;
      var cpVm2 = (c.voicemails || []).find(function (x) { return x.id === cpNavSt.activeVoicemailId; });
      cpInner = '<div class="pv-phone-title">' + esc(cpVm2 ? (cpVm2.name || "(untitled)") : "Voicemail") + '</div>' +
        (cpVm2 && cpVm2.audioAsset
          ? '<audio class="pv-phone-audio" src="' + esc(cpVm2.audioAsset) + '" autoplay controls></audio>'
          : '<div class="pv-phone-empty">No audio clip attached yet.</div>');
    } else if (cpScr === "sms") {
      cpNavSt.focusCols = 1;
      var cpThreads = c.smsThreads || [];
      cpInner = '<div class="pv-phone-title">💬 Messages</div>' + (!cpThreads.length
        ? '<div class="pv-phone-empty">No message threads.</div>'
        : '<div class="pv-phone-list">' + cpThreads.map(function (t, i) {
            var cpLast = (t.messages || [])[t.messages.length - 1];
            return '<button type="button" class="pv-phone-row pv-phone-row-sms" data-cpfocus="' + i + '" data-cpaction="openThread" data-thread="' + esc(t.id) + '">' +
              '<span class="pv-phone-row-icon">👤</span><span class="pv-phone-row-text"><span class="pv-phone-row-label">' + esc(t.name || "(unnamed)") + '</span>' +
              (cpLast ? '<span class="pv-phone-row-preview">' + esc((cpLast.text || "").slice(0, 34)) + '</span>' : '') + '</span></button>';
          }).join("") + '</div>');
    } else if (cpScr === "smsThread") {
      cpNavSt.focusCols = 1;
      var cpThread = (c.smsThreads || []).find(function (x) { return x.id === cpNavSt.activeThreadId; });
      cpInner = '<div class="pv-phone-title">' + esc(cpThread ? (cpThread.name || "(unnamed)") : "Messages") + '</div>' +
        '<div class="pv-phone-sms-thread">' + (cpThread ? (cpThread.messages || []).map(function (m) {
          return '<div class="pv-phone-sms-bubble ' + (m.sent ? "sent" : "received") + '">' + esc(m.text || "") + '</div>';
        }).join("") : "") + '</div>';
    }

    html += '<div class="pv-phone" data-node="' + esc(n.id) + '">' +
      '<div class="pv-phone-lcd">' + cpInner + '</div>' +
      '<div class="pv-phone-controls">' +
        '<div class="pv-phone-dpad">' +
          '<button type="button" class="pv-phone-dbtn pv-phone-dbtn-up" data-cpnav="up" aria-label="Up">▲</button>' +
          '<button type="button" class="pv-phone-dbtn pv-phone-dbtn-left" data-cpnav="left" aria-label="Left">◀</button>' +
          '<button type="button" class="pv-phone-dbtn pv-phone-dbtn-select" data-cpnav="select" aria-label="Select">●</button>' +
          '<button type="button" class="pv-phone-dbtn pv-phone-dbtn-right" data-cpnav="right" aria-label="Right">▶</button>' +
          '<button type="button" class="pv-phone-dbtn pv-phone-dbtn-down" data-cpnav="down" aria-label="Down">▼</button>' +
        '</div>' +
        '<div class="pv-phone-softkeys">' +
          '<button type="button" class="pv-phone-softkey" data-cpnav="back">↩ Back</button>' +
          '<button type="button" class="pv-phone-softkey" data-cpnav="menu">☰ Menu</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  } else if (n.type === "lockAndKey") {
    // See wireLockAndKeyInteractions further down for the tap/swipe
    // interaction this markup drives, and the LK_*/lkPadlockTop doc
    // comment above for the geometry these inline top:…px offsets come
    // from. This branch only ever paints the *resting* state — idle
    // (nothing attempted yet) or solved (already completed) — because the
    // in-between wrong/correct animation is played by directly animating
    // this same markup's existing DOM nodes in the wire function rather
    // than by re-rendering mid-animation (a full innerHTML replace, which
    // is how ctl.render() normally works, can't itself be transitioned).
    var lkOptions = lockAndKeyOptions(session.hunt, n.id);
    if (!ctl.lockAndKeyDraft[n.id]) ctl.lockAndKeyDraft[n.id] = { index: 0, busy: false };
    var lkDraft = ctl.lockAndKeyDraft[n.id];
    if (lkDraft.index >= lkOptions.length) lkDraft.index = 0;
    var lkSolved = !!session.state.completed[n.id];
    var lkCorrectKey = lkOptions.find(function (k) { return k.id === c.correctKeyNodeId; });
    // Once solved, the node is shown read-only (renderPinnedNode skips
    // wiring for a completed node), so always settle on the correct key
    // seated at its own threshold with the shackle open — there's no more
    // ring to swipe.
    var lkCur = lkSolved ? (lkCorrectKey || lkOptions[lkDraft.index]) : lkOptions[lkDraft.index];

    html += '<div class="pv-scene-body"' + pvFontStyle(c.promptFontSize) + '>' + esc(c.prompt) + '</div>';

    if (!lkOptions.length) {
      html += '<div class="pv-empty" style="padding-top:12px">No keys are on offer yet — connect a Keychain node to this puzzle (it\'ll automatically become this puzzle\'s "keychain supply"), then connect at least one Key node to that Keychain.</div>';
    } else {
      var lkThreshold = lkCur ? Number(lkCur.content.threshold) : 50;
      if (!isFinite(lkThreshold)) lkThreshold = 50;
      var lkTop = lkPadlockTop(lkSolved ? "correct" : "idle", lkThreshold);
      var lkDm = isDarkMaritime(c);
      html += '<div class="pv-lk-stage' + (lkDm ? ' pv-dm' : '') + '" id="pvLkStage">';
      html += '<div class="pv-lk-ring"></div>';
      html += '<div class="pv-lk-key-layer"><div class="pv-lk-key"' +
        (lkCur && lkCur.content.imageAsset ? ' style="background-image:url(&quot;' + esc(lkCur.content.imageAsset) + '&quot;)"' : '') + '>' +
        (lkCur && !lkCur.content.imageAsset ? '<span class="pv-lk-key-noimg">🔑<br>' + esc(lkCur.content.name || lkCur.title) + '</span>' : '') +
        '</div></div>';
      html += '<button type="button" class="pv-lk-padlock' + (lkSolved ? ' pv-lk-unlocked' : '') + '" id="pvLkPadlock" style="top:' + lkTop + 'px" aria-label="Try this key"' + (lkSolved ? ' disabled' : '') + '>' +
        '<span class="pv-lk-shackle"></span><span class="pv-lk-body"></span></button>';
      html += '<div class="pv-lk-feedback" id="pvLkFeedback"></div>';
      html += '</div>'; // .pv-lk-stage
      html += lkSolved
        ? '<div class="pv-lk-hint-row">🔓 Unlocked with ' + esc(lkCur ? (lkCur.content.name || lkCur.title) : "the right key") + '.</div>'
        : '<div class="pv-lk-hint-row">↔ Swipe the ring for a different key — key ' + (lkDraft.index + 1) + ' of ' + lkOptions.length + '. Tap the padlock to try it.</div>';
    }
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
      html += renderHintBlockHtml(session, h);
    });
    html += '</div>';
  }
  return wrapWithMedia(c, html);
}

// Cell Phone — wires the D-pad/softkeys and every screen's tappable rows
// (a real device would only have the D-pad, but everything's also
// directly clickable since this runs in a browser/touch preview, not on
// physical hardware — see the "cellPhone" branch of renderPreviewNode
// above for the corresponding markup). A no-op for every other node
// type, same "no matching ids/selectors, nothing to wire" pattern as the
// other wireXInteractions helpers below.
function wireCellPhoneInteractions(root, ctl, session, n) {
  if (n.type !== "cellPhone") return;
  var nav = cpNav(ctl, n.id);
  var c = n.content;

  var items = Array.prototype.slice.call(root.querySelectorAll(".pv-phone [data-cpfocus]"));
  if (items.length) {
    if (nav.focusIndex >= items.length) nav.focusIndex = items.length - 1;
    if (nav.focusIndex < 0) nav.focusIndex = 0;
    items.forEach(function (el, i) { el.classList.toggle("pv-phone-focused", i === nav.focusIndex); });
  }

  function moveFocus(delta) {
    if (!items.length) return;
    nav.focusIndex = ((nav.focusIndex + delta) % items.length + items.length) % items.length;
    ctl.render();
  }
  // Left/Right on a plain vertical list (focusCols === 1) are just a
  // forgiving alias for Up/Down; on the keypad's 3-column digit grid
  // they step one cell without wrapping into the next/previous row.
  function moveFocusGrid(delta) {
    if (nav.focusCols <= 1) { moveFocus(delta); return; }
    if (!items.length) return;
    var next = nav.focusIndex + delta;
    if (next < 0 || next >= items.length) return;
    nav.focusIndex = next;
    ctl.render();
  }

  // Starts a call: contact is the matched Contact object, or null for an
  // unrecognised number. Always clears any previous call's timers first
  // (cpStopCallAudio) so re-dialling mid-ring/mid-busy-tone never leaves
  // two timers running at once. The ring cadence -> "connected" phase
  // change happens on a timeout rather than immediately so the Calling…
  // screen and its tones actually get seen/heard before the contact's
  // clip (or the engaged tone) takes over.
  function startCall(contact) {
    cpStopCallAudio(nav);
    nav.activeContactId = contact ? contact.id : null;
    cpPush(nav, "inCall");
    if (contact) {
      nav.callPhase = "ringing";
      cpPlayRingCadence();
      nav.ringTimeoutId = setTimeout(function () {
        nav.callPhase = "connected";
        nav.ringTimeoutId = null;
        ctl.render();
      }, 1900);
    } else {
      nav.callPhase = "engaged";
      cpPlayEngagedPulse();
      nav.engagedIntervalId = setInterval(cpPlayEngagedPulse, 750);
    }
  }

  Array.prototype.forEach.call(root.querySelectorAll(".pv-phone [data-cpnav]"), function (btn) {
    btn.onclick = function () {
      var dir = btn.dataset.cpnav;
      if (dir === "up") { moveFocus(-nav.focusCols); return; }
      if (dir === "down") { moveFocus(nav.focusCols); return; }
      if (dir === "left") { moveFocusGrid(-1); return; }
      if (dir === "right") { moveFocusGrid(1); return; }
      if (dir === "select") { var el = items[nav.focusIndex]; if (el) el.click(); return; }
      if (dir === "back") {
        if (cpScreen(nav) === "inCall") cpStopCallAudio(nav);
        cpPop(nav); ctl.render(); return;
      }
      if (dir === "menu") { cpStopCallAudio(nav); cpGoHome(nav); ctl.render(); return; }
    };
  });

  Array.prototype.forEach.call(root.querySelectorAll(".pv-phone [data-cpaction]"), function (btn) {
    btn.onclick = function () {
      var action = btn.dataset.cpaction;
      if (action === "openSection") {
        var section = btn.dataset.section;
        if (section === "calls") cpPush(nav, "callsHome");
        else if (section === "voicemails") cpPush(nav, "voicemails");
        else if (section === "sms") cpPush(nav, "sms");
      } else if (action === "openContacts") {
        cpPush(nav, "contacts");
      } else if (action === "openKeypad") {
        nav.dialedDigits = "";
        cpPush(nav, "keypad");
      } else if (action === "callContact") {
        var contact = (c.contacts || []).find(function (ct) { return ct.id === btn.dataset.contact; });
        if (contact) {
          nav.dialedDigits = cpContactNumbers(contact)[0] || "";
          startCall(contact);
        }
      } else if (action === "digit") {
        if ((nav.dialedDigits || "").length < 20) nav.dialedDigits = (nav.dialedDigits || "") + btn.dataset.digit;
      } else if (action === "clearDigit") {
        nav.dialedDigits = (nav.dialedDigits || "").slice(0, -1);
      } else if (action === "dial") {
        startCall(cpFindContactByDigits(c, nav.dialedDigits));
      } else if (action === "hangUp") {
        cpStopCallAudio(nav);
        cpPop(nav);
      } else if (action === "playVoicemail") {
        nav.activeVoicemailId = btn.dataset.voicemail;
        cpPush(nav, "voicemailPlay");
      } else if (action === "openThread") {
        nav.activeThreadId = btn.dataset.thread;
        cpPush(nav, "smsThread");
      }
      ctl.render();
    };
  });
}

// Lock and Key — swipe the ring left/right to cycle which key is
// presented at the front (a plain onpointerdown/move/up drag gesture,
// same shape as wireLockDials' wheel-dragging above, just the horizontal
// axis and no library), tap the padlock to try the key currently at the
// front.
//
// Deliberately bypasses ctl.render() for the animated middle of a tap
// attempt (see the doc comment on renderPreviewNode's "lockAndKey" branch
// above for why: a full innerHTML replace can't itself be CSS-transitioned)
// — it drives the padlock's own `top` and the shackle's "unlocked" class
// directly, exactly the two properties lkPadlockTop/the .pv-lk-unlocked
// CSS rule already know how to interpret, and only calls back into
// pv_action_submitLockAndKey/ctl.render() once the sequence has finished
// settling into its next *resting* state (same "animate freely, then
// resync through the normal render pipeline" idea as Gear & Pulley's
// checkSolved/setTimeout pairing above).
function wireLockAndKeyInteractions(root, ctl, session, n) {
  if (n.type !== "lockAndKey") return;
  var stage = root.querySelector("#pvLkStage");
  if (!stage) return;
  var draft = ctl.lockAndKeyDraft[n.id];
  if (!draft) return;
  var options = lockAndKeyOptions(session.hunt, n.id);
  if (!options.length) return;
  var padlock = stage.querySelector("#pvLkPadlock");
  var feedbackEl = stage.querySelector("#pvLkFeedback");
  if (!padlock) return;

  function cycle(delta) {
    if (draft.busy) return;
    draft.index = ((draft.index + delta) % options.length + options.length) % options.length;
    ctl.render();
  }

  var dragging = false, startX = 0;
  stage.onpointerdown = function (e) {
    if (draft.busy) return;
    if (e.target.closest && e.target.closest("#pvLkPadlock")) return; // the padlock has its own click handler, below
    dragging = true; startX = e.clientX;
    try { stage.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: drag still tracks via direct listeners */ }
  };
  stage.onpointerup = function (e) {
    if (!dragging) return;
    dragging = false;
    var dx = e.clientX - startX;
    // Dragging left brings the next key into view (like scrolling a strip
    // of keys leftward past a fixed viewing point); dragging right brings
    // the previous one back — same left=forward/right=back convention as
    // a normal horizontal photo swipe.
    if (Math.abs(dx) > 24) cycle(dx < 0 ? 1 : -1);
  };
  stage.onpointercancel = function () { dragging = false; };

  padlock.onclick = function () {
    if (draft.busy) return;
    var cur = options[draft.index];
    if (!cur) return;
    draft.busy = true;
    var correct = cur.id === n.content.correctKeyNodeId;
    var threshold = Number(cur.content.threshold);
    if (!isFinite(threshold)) threshold = 50;

    padlock.style.transition = "top .45s cubic-bezier(.3,.7,.4,1)";
    padlock.style.top = lkPadlockTop(correct ? "correct" : "wrong", threshold) + "px";

    if (correct) {
      setTimeout(function () {
        padlock.classList.add("pv-lk-unlocked"); // pops the shackle open — see .pv-lk-unlocked in styles.css, same idea as Physical Lock Code's .pv-lock-open
        pv_action_submitLockAndKey(session, n.id, true);
        setTimeout(function () { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); }, 700);
      }, 460);
    } else {
      setTimeout(function () {
        if (feedbackEl) feedbackEl.textContent = "Wrong key";
        setTimeout(function () {
          if (feedbackEl) feedbackEl.textContent = "";
          padlock.style.top = lkPadlockTop("idle", threshold) + "px";
          setTimeout(function () {
            draft.busy = false;
            pv_action_submitLockAndKey(session, n.id, false);
            ctl.render();
          }, 460);
        }, 900);
      }, 460);
    }
  };
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
function renderCryptexSvg(nodeId, rot, dm) {
  var cx = CRYPTEX_CX, cy = CRYPTEX_CY, idp = "cx" + nodeId.replace(/[^a-zA-Z0-9]/g, "") + "_";
  // Dark Maritime: same ring/shackle/plate geometry as Classic, but every
  // gradient swapped for a flat DM_VOID fill and a cross-hatched DM_INK
  // stroke (the pattern library from dmDefs, drawn at each ring's own huge
  // stroke-width so the hatch reads as the ring's material, not a hairline
  // outline) — see the doc comment on dmDefs/APPEARANCES above.
  var defs = dm ? dmDefs(idp) :
    '<radialGradient id="' + idp + 'plate" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#e4e1d6"/><stop offset="55%" stop-color="#a9a598"/><stop offset="100%" stop-color="#69665c"/></radialGradient>' +
    '<linearGradient id="' + idp + 'shackle" x1="0%" y1="0%" x2="100%" y2="0%"><stop offset="0%" stop-color="#8c8c8c"/><stop offset="50%" stop-color="#e8e8e8"/><stop offset="100%" stop-color="#6b6b6b"/></linearGradient>' +
    '<radialGradient id="' + idp + 'ro" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#c79a52"/><stop offset="100%" stop-color="#7a5a28"/></radialGradient>' +
    '<radialGradient id="' + idp + 'rm" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#d4b06a"/><stop offset="100%" stop-color="#8c6c34"/></radialGradient>' +
    '<radialGradient id="' + idp + 'ri" cx="40%" cy="35%" r="70%"><stop offset="0%" stop-color="#e0c17e"/><stop offset="100%" stop-color="#9c7c40"/></radialGradient>';
  var shackleStroke = dm ? DM_INK : 'url(#' + idp + 'shackle)';
  var plateFill = dm ? dmFill(idp, "hatch1") : 'url(#' + idp + 'plate)';
  var plateStroke = dm ? DM_INK : "#4a473e";
  var pointerFill = dm ? DM_INK : "#d8483f";
  var pointerStroke = dm ? DM_VOID : "#5a1a15";
  var ringFillO = dm ? DM_VOID : 'url(#' + idp + 'ro)', ringStrokeO = dm ? 'url(#' + idp + 'dmX)' : "#3d2f14";
  var ringFillM = dm ? DM_VOID : 'url(#' + idp + 'rm)', ringStrokeM = dm ? 'url(#' + idp + 'dmX)' : "#4a3a18";
  var ringFillI = dm ? DM_VOID : 'url(#' + idp + 'ri)', ringStrokeI = dm ? 'url(#' + idp + 'dmX)' : "#5a4622";
  var rimStroke = dm ? DM_INK : "#3d3a32";
  var btnFill = dm ? DM_VOID : "#caa15a", btnStroke = dm ? DM_INK : "#6b4a20";
  var keyholeFill = dm ? DM_INK : "#4a3a1c";
  return '<div class="pv-cryptex-wrap' + (dm ? ' pv-dm' : '') + '"><svg class="cryptex-svg' + (dm ? ' cryptex-svg-dm' : '') + '" data-node="' + nodeId + '" width="320" viewBox="0 0 500 600" style="display:block;margin:10px auto 0;max-width:100%;">' +
    '<defs>' + defs + '</defs>' +
    '<g class="cryptex-shackle"><path d="M 200 400 L 200 150 A 50 50 0 0 1 300 150 L 300 400" fill="none" stroke="' + shackleStroke + '" stroke-width="24" stroke-linecap="round"/></g>' +
    '<circle cx="250" cy="340" r="192" fill="' + plateFill + '" stroke="' + plateStroke + '" stroke-width="3"/>' +
    '<polygon points="250,132 240,150 260,150" fill="' + pointerFill + '" stroke="' + pointerStroke + '" stroke-width="1"/>' +
    '<g class="cryptex-ring" data-ring="outer" transform="rotate(' + rot.outer + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="165" fill="' + ringFillO + '" stroke="' + ringStrokeO + '" stroke-width="46"/>' + cryptexLetterMarkup(cx, cy, 165, cryptexPointerIndex(rot.outer)) + '</g>' +
    '<circle cx="250" cy="340" r="188" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/><circle cx="250" cy="340" r="142" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="outer" cx="250" cy="340" r="165" fill="#000" opacity="0" stroke="#000" stroke-width="46"/>' +
    '<g class="cryptex-ring" data-ring="middle" transform="rotate(' + rot.middle + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="117" fill="' + ringFillM + '" stroke="' + ringStrokeM + '" stroke-width="42"/>' + cryptexLetterMarkup(cx, cy, 117, cryptexPointerIndex(rot.middle)) + '</g>' +
    '<circle cx="250" cy="340" r="138" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/><circle cx="250" cy="340" r="96" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="middle" cx="250" cy="340" r="117" fill="#000" opacity="0" stroke="#000" stroke-width="42"/>' +
    '<g class="cryptex-ring" data-ring="inner" transform="rotate(' + rot.inner + ' 250 340)"><circle class="cryptex-ring-track" cx="250" cy="340" r="73" fill="' + ringFillI + '" stroke="' + ringStrokeI + '" stroke-width="38"/>' + cryptexLetterMarkup(cx, cy, 73, cryptexPointerIndex(rot.inner)) + '</g>' +
    '<circle cx="250" cy="340" r="92" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/><circle cx="250" cy="340" r="54" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/>' +
    '<circle class="cryptex-hit" data-ring="inner" cx="250" cy="340" r="73" fill="#000" opacity="0" stroke="#000" stroke-width="38"/>' +
    '<g class="cryptex-center">' +
      '<circle class="cryptex-btn-face" cx="250" cy="340" r="46" fill="' + btnFill + '" stroke="' + btnStroke + '" stroke-width="2"/>' +
      '<circle cx="250" cy="340" r="46" fill="none" stroke="' + rimStroke + '" stroke-width="1.5"/>' +
      '<circle cx="250" cy="330" r="9" fill="' + keyholeFill + '"/><polygon points="244,336 256,336 251,354 249,354" fill="' + keyholeFill + '"/>' +
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

/* ---------------------------------------------------------------------
   Rope Tying — a square frame with 0-4 rope stubs per side (Left/Top/
   Right/Bottom, independently configurable via content.sides), each stub
   carrying its own brass nameplate (content.ends[].label — set in the
   Studio inspector). The player taps two free ends to tie them (a curved
   rope + a knot appears where they meet), taps a knot to untie it, then
   presses the node's primary button (default label "Hoist", see
   DEFAULT_BUTTON_LABEL.ropeTying above) to check the current ties against
   content.correctPairs (pv_action_submitRopeTying above).

   Adapted from the standalone rope-tying-puzzle.html prototype (DOM-built
   SVG, fixed 2-ropes-per-side, colours randomised at load) into this
   node's string-built renderPreviewNode branch — same division of labour
   as renderCryptexSvg/wireCryptexInteractions just above: this block only
   ever reads/writes ctl.ropeDraft[n.id] = { connections: [{a,b,seed}],
   selected: endId|null }, so it has no idea whether it's in Studio's
   Preview overlay, the docked live mock, or the standalone Player app.
--------------------------------------------------------------------- */
var ROPE_BOARD = 500; // svg viewBox is 0 0 ROPE_BOARD ROPE_BOARD, same square the prototype used

function ropePrand(seed) {
  var x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}
// Cheap deterministic string hash (order-sensitive, always positive) — used
// to turn an end/connection id into a stable seed for ropePrand, so cosmetic
// jitter (stub length, fray shape, knot lumpiness) stays put across
// re-renders instead of reshuffling on every keystroke.
function ropeHash(s) {
  var h = 0;
  s = String(s || "");
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

// Fixed edge point + inward direction for the idx-th (0-based) rope on a
// given side, evenly spaced along that side among `count` total ropes on
// it (so 1 rope centers, 2 split evenly, etc. — same idea as the
// prototype's fixed 2-per-side SLOTS table, generalised to 0-4).
function ropeSlotGeometry(side, idx, count) {
  var t = (idx + 1) / (count + 1);
  if (side === "left") return { edge: { x: 0, y: ROPE_BOARD * t }, dir: { x: 1, y: 0 } };
  if (side === "top") return { edge: { x: ROPE_BOARD * t, y: 0 }, dir: { x: 0, y: 1 } };
  if (side === "right") return { edge: { x: ROPE_BOARD, y: ROPE_BOARD * t }, dir: { x: -1, y: 0 } };
  return { edge: { x: ROPE_BOARD * t, y: ROPE_BOARD }, dir: { x: 0, y: -1 } }; // bottom
}

// endId -> { end, side, idx, count, geom, stubLen, tip } for every
// configured end on this node — computed fresh every render (cheap, at
// most 16 ends) so a side-count/label edit in the Studio inspector is
// reflected immediately without any extra invalidation bookkeeping.
function ropeGeometryMap(c) {
  var bySide = { left: [], top: [], right: [], bottom: [] };
  (c.ends || []).forEach(function (e) { (bySide[e.side] || (bySide[e.side] = [])).push(e); });
  var map = {};
  ["left", "top", "right", "bottom"].forEach(function (side) {
    var list = bySide[side];
    list.forEach(function (e, idx) {
      var geom = ropeSlotGeometry(side, idx, list.length);
      // Deterministic per-end stub length (60-130px) purely so ties/knots
      // never all land at the same distance from the frame — hashed off
      // the end's own id, same trick as the prototype's random-but-seeded
      // slotLengths, just stable across renders instead of per "New Puzzle".
      var stubLen = 60 + ropePrand(ropeHash(e.id)) * 70;
      var tip = { x: geom.edge.x + geom.dir.x * stubLen, y: geom.edge.y + geom.dir.y * stubLen };
      map[e.id] = { end: e, side: side, idx: idx, count: list.length, geom: geom, stubLen: stubLen, tip: tip };
    });
  });
  return map;
}

var ROPE_FRAY_ANGLES = [-30, -18, -7, 7, 18, 30];
var ROPE_FRAY_TONES = ["light", "fiber", "light", "core", "fiber", "light"];
var ROPE_HEX = "#8a5a34", ROPE_LIGHT = "#c9a876";

function ropeFrayMarkup(seedBase, tip, dir, dm) {
  var s = "";
  ROPE_FRAY_ANGLES.forEach(function (deg, i) {
    var rad = deg * Math.PI / 180;
    var rdx = dir.x * Math.cos(rad) - dir.y * Math.sin(rad);
    var rdy = dir.x * Math.sin(rad) + dir.y * Math.cos(rad);
    var jitter = ropePrand(seedBase * 97 + i * 13 + 3);
    var len = 10 + jitter * 10;
    var start = { x: tip.x - dir.x * 5, y: tip.y - dir.y * 5 };
    var end = { x: tip.x + rdx * len, y: tip.y + rdy * len };
    var perp = { x: -rdy, y: rdx };
    var bow = (ropePrand(seedBase * 53 + i * 7 + 1) - 0.5) * 7;
    var ctrl = { x: (start.x + end.x) / 2 + perp.x * bow, y: (start.y + end.y) / 2 + perp.y * bow };
    var d = "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " Q " + ctrl.x.toFixed(1) + " " + ctrl.y.toFixed(1) + " " + end.x.toFixed(1) + " " + end.y.toFixed(1);
    var tone = ROPE_FRAY_TONES[i];
    var stroke = dm ? DM_INK : (tone === "fiber" ? "#e8d5b5" : (tone === "core" ? ROPE_HEX : ROPE_LIGHT));
    s += '<path d="' + d + '" fill="none" stroke="' + stroke + '" stroke-width="1.7" stroke-linecap="round"' + (dm ? '' : ' opacity="0.9"') + '/>';
  });
  return s;
}

// A free (untied) rope end — shaft + frayed tip + an invisible larger hit
// circle at the tip (.rope-end-cap) that wireRopeTyingInteractions listens
// for taps on.
function ropeStubMarkup(endId, info, selectedId, dm) {
  var edge = info.geom.edge, dir = info.geom.dir, tip = info.tip;
  var shaftEnd = { x: tip.x - dir.x * 7, y: tip.y - dir.y * 7 };
  var seedBase = ropeHash(endId);
  var s = '<g class="rope-stub">';
  if (dm) {
    // A solid ink strand with a dashed void "twist" line down the centre —
    // the engraved-scratchboard equivalent of the fibre highlight the
    // Classic version draws with a light-brown dash (see the else branch).
    s += '<line x1="' + edge.x + '" y1="' + edge.y + '" x2="' + shaftEnd.x + '" y2="' + shaftEnd.y + '" stroke="' + DM_INK + '" stroke-width="10" stroke-linecap="round"/>';
    s += '<line x1="' + edge.x + '" y1="' + edge.y + '" x2="' + shaftEnd.x + '" y2="' + shaftEnd.y + '" stroke="' + DM_VOID + '" stroke-width="2.2" stroke-dasharray="3 6" stroke-linecap="round"/>';
  } else {
    s += '<line x1="' + edge.x + '" y1="' + edge.y + '" x2="' + shaftEnd.x + '" y2="' + shaftEnd.y + '" stroke="#241b13" stroke-width="13" stroke-linecap="round"/>';
    s += '<line x1="' + edge.x + '" y1="' + edge.y + '" x2="' + shaftEnd.x + '" y2="' + shaftEnd.y + '" stroke="' + ROPE_HEX + '" stroke-width="10" stroke-linecap="round"/>';
    s += '<line x1="' + edge.x + '" y1="' + edge.y + '" x2="' + shaftEnd.x + '" y2="' + shaftEnd.y + '" stroke="' + ROPE_LIGHT + '" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round" opacity="0.8"/>';
  }
  s += ropeFrayMarkup(seedBase, tip, dir, dm);
  if (selectedId === endId) {
    s += '<circle class="rope-selected-ring" cx="' + tip.x + '" cy="' + tip.y + '" r="19" fill="none" stroke="' + (dm ? DM_INK : "#fff8e0") + '" stroke-width="3"' + (dm ? '' : ' opacity="0.9"') + '/>';
  }
  s += '<circle class="rope-end-cap" data-endid="' + esc(endId) + '" cx="' + tip.x + '" cy="' + tip.y + '" r="16" fill="transparent"/>';
  s += '</g>';
  return s;
}

function ropeBezierPoint(p0, p1, p2, p3, t) {
  var mt = 1 - t;
  return {
    x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
    y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y
  };
}
function ropeCurveControlPoints(pa, pb, seed) {
  var cx = ROPE_BOARD / 2, cy = ROPE_BOARD / 2;
  var c1 = { x: pa.x + (cx - pa.x) * 0.55 + seed, y: pa.y + (cy - pa.y) * 0.55 - seed * 0.4 };
  var c2 = { x: pb.x + (cx - pb.x) * 0.55 - seed, y: pb.y + (cy - pb.y) * 0.55 + seed * 0.4 };
  return [pa, c1, c2, pb];
}
// An irregular, lumpy closed blob (not a circle) for the knot's body, so it
// reads as a bulge of tangled rope rather than a disc.
function ropeBlobPath(cx, cy, r, seed) {
  var N = 9, pts = [];
  for (var i = 0; i < N; i++) {
    var angle = (i / N) * Math.PI * 2;
    var jitter = (ropePrand(seed + i * 7.31) - 0.5) * r * 0.5;
    var rad = r + jitter;
    pts.push({ x: cx + Math.cos(angle) * rad, y: cy + Math.sin(angle) * rad });
  }
  var mid = function (p1, p2) { return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }; };
  var start = mid(pts[N - 1], pts[0]);
  var d = "M " + start.x.toFixed(1) + " " + start.y.toFixed(1) + " ";
  for (var j = 0; j < N; j++) {
    var p = pts[j], m = mid(p, pts[(j + 1) % N]);
    d += "Q " + p.x.toFixed(1) + " " + p.y.toFixed(1) + " " + m.x.toFixed(1) + " " + m.y.toFixed(1) + " ";
  }
  return d + "Z";
}
// One curved strand draped across the knot body to suggest a wrap/loop.
function ropeKnotWrapPath(cx, cy, r, seed) {
  var ang = ropePrand(seed) * Math.PI;
  var p1 = { x: cx + Math.cos(ang) * r * 0.85, y: cy + Math.sin(ang) * r * 0.85 };
  var p2 = { x: cx - Math.cos(ang) * r * 0.85, y: cy - Math.sin(ang) * r * 0.85 };
  var bow = (ropePrand(seed + 2) - 0.5) * r * 1.3;
  var perp = { x: -Math.sin(ang), y: Math.cos(ang) };
  var ctrl = { x: cx + perp.x * bow, y: cy + perp.y * bow };
  return "M " + p1.x.toFixed(1) + " " + p1.y.toFixed(1) + " Q " + ctrl.x.toFixed(1) + " " + ctrl.y.toFixed(1) + " " + p2.x.toFixed(1) + " " + p2.y.toFixed(1);
}

// A tied connection — curved rope between two ends' edge points plus a knot
// where it crosses the shorter-stub side's proportional length (so the knot
// never lands at a fixed midpoint or overlaps another one), with an
// invisible larger hit circle (.rope-knot-hit) for untying. defsArr collects
// this connection's own radial gradient (for the knot's shading) to be
// flushed into the board's shared <defs> — ids are prefixed with idp so
// several instances of this node type never clash if more than one is ever
// on screen at once (e.g. Back-peek behind a live node).
function ropeConnectionMarkup(idp, conn, geomMap, defsArr, dm) {
  var infoA = geomMap[conn.a], infoB = geomMap[conn.b];
  if (!infoA || !infoB) return "";
  var pts = ropeCurveControlPoints(infoA.geom.edge, infoB.geom.edge, conn.seed);
  var p0 = pts[0], p1 = pts[1], p2 = pts[2], p3 = pts[3];
  var d = "M " + p0.x + " " + p0.y + " C " + p1.x + " " + p1.y + ", " + p2.x + " " + p2.y + ", " + p3.x + " " + p3.y;
  var s = '<g class="rope-connection' + (conn.animated ? "" : " rope-knot-pop") + '">';
  conn.animated = true;
  if (dm) {
    s += '<path d="' + d + '" fill="none" stroke="' + DM_INK + '" stroke-width="10" stroke-linecap="round"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + DM_VOID + '" stroke-width="2.2" stroke-dasharray="3 6" stroke-linecap="round"/>';
  } else {
    s += '<path d="' + d + '" fill="none" stroke="#241b13" stroke-width="13" stroke-linecap="round"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + ROPE_HEX + '" stroke-width="10" stroke-linecap="round"/>';
    s += '<path d="' + d + '" fill="none" stroke="' + ROPE_LIGHT + '" stroke-width="2" stroke-dasharray="3 7" stroke-linecap="round" opacity="0.8"/>';
  }

  var lenA = infoA.stubLen, lenB = infoB.stubLen;
  var t = lenA / (lenA + lenB);
  var mid = ropeBezierPoint(p0, p1, p2, p3, t);
  var before = ropeBezierPoint(p0, p1, p2, p3, Math.max(t - 0.09, 0));
  var after = ropeBezierPoint(p0, p1, p2, p3, Math.min(t + 0.09, 1));
  var knotSeed = ropeHash(conn.a) * 0.7 + ropeHash(conn.b) * 1.3 + Math.abs(conn.seed);
  var R = 15;

  s += '<g class="rope-knot-group">';
  [before, after].forEach(function (from) {
    var dx = mid.x - from.x, dy = mid.y - from.y;
    var len = Math.hypot(dx, dy) || 1;
    var dirx = dx / len, diry = dy / len;
    var x1 = mid.x - dirx * (R + 10), y1 = mid.y - diry * (R + 10);
    var x2 = mid.x - dirx * (R - 5), y2 = mid.y - diry * (R - 5);
    s += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + (dm ? DM_INK : ROPE_HEX) + '" stroke-width="9" stroke-linecap="round"/>';
  });
  if (dm) {
    // A solid-ink knot body (the brief's "balanced areas of solid ink"),
    // outlined in void so it stays a crisp readable silhouette against the
    // ink rope strands feeding into it, with void wrap-lines standing in
    // for the Classic version's two soft highlight loops.
    s += '<path d="' + ropeBlobPath(mid.x, mid.y, R, knotSeed) + '" fill="' + DM_INK + '" stroke="' + DM_VOID + '" stroke-width="2" stroke-linejoin="round"/>';
    s += '<path d="' + ropeKnotWrapPath(mid.x, mid.y, R * 0.8, knotSeed + 1) + '" fill="none" stroke="' + DM_VOID + '" stroke-width="2" stroke-linecap="round"/>';
    s += '<path d="' + ropeKnotWrapPath(mid.x, mid.y, R * 0.7, knotSeed + 11) + '" fill="none" stroke="' + DM_VOID + '" stroke-width="1.6" stroke-linecap="round"/>';
  } else {
    var bodyGradId = idp + "kg" + ropeHash(conn.a + "|" + conn.b);
    defsArr.push('<radialGradient id="' + bodyGradId + '" cx="32%" cy="28%" r="75%"><stop offset="0%" stop-color="#ad8a5a"/><stop offset="100%" stop-color="#6b5333"/></radialGradient>');
    s += '<path d="' + ropeBlobPath(mid.x, mid.y, R, knotSeed) + '" fill="url(#' + bodyGradId + ')" stroke="#241b13" stroke-width="3" stroke-linejoin="round"/>';
    s += '<path d="' + ropeKnotWrapPath(mid.x, mid.y, R * 0.8, knotSeed + 1) + '" fill="none" stroke="#3c2c1a" stroke-width="2.2" opacity="0.6" stroke-linecap="round"/>';
    s += '<path d="' + ropeKnotWrapPath(mid.x, mid.y, R * 0.7, knotSeed + 11) + '" fill="none" stroke="#3c2c1a" stroke-width="2" opacity="0.45" stroke-linecap="round"/>';
  }
  s += '<circle class="rope-knot-hit" data-a="' + esc(conn.a) + '" data-b="' + esc(conn.b) + '" cx="' + mid.x + '" cy="' + mid.y + '" r="' + (R + 9) + '" fill="transparent"/>';
  s += '</g></g>';
  return s;
}

// Small brass nameplate mounted where a rope enters the frame — the text
// the player reads is content.ends[].label, set in the Studio inspector.
// Top/bottom plaques sit upright; left/right ones rotate 90° to read along
// their side.
function ropePlaqueMarkup(idp, info, label, dm) {
  var edge = info.geom.edge, dir = info.geom.dir;
  var cx = edge.x + dir.x * 14, cy = edge.y + dir.y * 14;
  var rotation = dir.y === 0 ? 90 : 0;
  var w = 36, h = 17;
  var text = esc(String(label || "").slice(0, 8));
  var fontSize = text.length > 5 ? 9 : 11;
  var s = '<g transform="translate(' + cx.toFixed(1) + ',' + cy.toFixed(1) + ') rotate(' + rotation + ')" pointer-events="none">';
  if (dm) {
    s += '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="2.5" ry="2.5" fill="' + DM_VOID + '" stroke="' + DM_INK + '" stroke-width="1.3"/>';
    s += '<rect x="' + (-w / 2 + 2) + '" y="' + (-h / 2 + 2) + '" width="' + (w - 4) + '" height="' + (h - 4) + '" rx="1.5" ry="1.5" fill="none" stroke="' + DM_INK + '" stroke-width="0.6"/>';
    s += '<text x="0" y="4" text-anchor="middle" font-size="' + fontSize + '" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" fill="' + DM_INK + '">' + text + '</text>';
  } else {
    s += '<rect x="' + (-w / 2) + '" y="' + (-h / 2) + '" width="' + w + '" height="' + h + '" rx="2.5" ry="2.5" fill="url(#' + idp + 'brass)" stroke="#4a3510" stroke-width="1.3"/>';
    s += '<rect x="' + (-w / 2 + 2) + '" y="' + (-h / 2 + 2) + '" width="' + (w - 4) + '" height="' + (h - 4) + '" rx="1.5" ry="1.5" fill="none" stroke="#fceec2" stroke-width="0.6" opacity="0.55"/>';
    s += '<text x="0" y="4" text-anchor="middle" font-size="' + fontSize + '" font-family="Georgia, \'Times New Roman\', serif" font-weight="700" fill="#4a3510">' + text + '</text>';
  }
  s += '</g>';
  return s;
}

function renderRopeBoardSvg(n, ctl) {
  var c = n.content;
  var dm = isDarkMaritime(c);
  var draft = ctl.ropeDraft[n.id];
  var geomMap = ropeGeometryMap(c);
  var idp = "rt" + n.id.replace(/[^a-zA-Z0-9]/g, "") + "_";
  var defsArr = [];
  var body = "";
  draft.connections.forEach(function (conn) { body += ropeConnectionMarkup(idp, conn, geomMap, defsArr, dm); });
  (c.ends || []).forEach(function (e) {
    var tied = draft.connections.some(function (cc) { return cc.a === e.id || cc.b === e.id; });
    if (!tied && geomMap[e.id]) body += ropeStubMarkup(e.id, geomMap[e.id], draft.selected, dm);
  });
  (c.ends || []).forEach(function (e) { if (geomMap[e.id]) body += ropePlaqueMarkup(idp, geomMap[e.id], e.label, dm); });
  return '<div class="pv-rope-wrap' + (dm ? ' pv-dm' : '') + '" data-node="' + esc(n.id) + '">' +
    '<svg class="rope-svg" data-node="' + esc(n.id) + '" viewBox="0 0 ' + ROPE_BOARD + ' ' + ROPE_BOARD + '" style="display:block;margin:10px auto 0;max-width:100%;width:340px;">' +
      '<defs>' + (dm ? dmDefs(idp) : '<linearGradient id="' + idp + 'brass" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f6dfa0"/><stop offset="50%" stop-color="#caa54c"/><stop offset="100%" stop-color="#8a6a2c"/></linearGradient>') +
        defsArr.join("") +
      '</defs>' +
      '<rect x="4" y="4" width="' + (ROPE_BOARD - 8) + '" height="' + (ROPE_BOARD - 8) + '" rx="10" fill="none" stroke="' + (dm ? DM_INK : "rgba(255,255,255,0.08)") + '" stroke-width="2"/>' +
      body +
    '</svg>' +
  '</div>';
}

// Tap two free ends (.rope-end-cap) to tie them, tap a knot (.rope-knot-hit)
// to untie it — same select-then-tie interaction as the standalone
// prototype, just delegated off one click listener on the svg root (fresh
// every render, like every other wire* fn here) instead of DOM node
// references. The Hoist button (#pvHoistBtn) reads off the current ties,
// submits them, and drives the win/fail presentation described in
// NODE_TYPES.ropeTying's comment: wrong -> button flashes red + the whole
// board shakes, then resets for another attempt; correct -> button flashes
// green, the board animates away (.rope-clear-away, styles.css), and after
// a 2s pause (so the player actually sees it clear) the view advances to
// whatever comes next — the node itself already completed the moment
// pv_action_submitRopeTying returned true, this timeout only delays the
// re-render that moves the screen on (same trick as wireCryptexInteractions
// above, just a 2s hold instead of 3s and a clear-away instead of a
// shackle-open pose).
function wireRopeTyingInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-rope-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var svg = wrap.querySelector(".rope-svg");
  if (!ctl.ropeDraft[n.id]) ctl.ropeDraft[n.id] = { connections: [], selected: null };
  var draft = ctl.ropeDraft[n.id];

  svg.onclick = function (e) {
    if (wrap.dataset.rtLocked === "1") return;
    var target = e.target;
    if (!target || !target.classList) return;
    if (target.classList.contains("rope-knot-hit")) {
      var a = target.dataset.a, b = target.dataset.b;
      var idx = -1;
      draft.connections.forEach(function (cc, i) { if (cc.a === a && cc.b === b) idx = i; });
      if (idx !== -1) { draft.connections.splice(idx, 1); draft.selected = null; ctl.render(); }
      return;
    }
    if (target.classList.contains("rope-end-cap")) {
      var endId = target.dataset.endid;
      if (draft.selected === null) { draft.selected = endId; ctl.render(); }
      else if (draft.selected === endId) { draft.selected = null; ctl.render(); }
      else {
        draft.connections.push({ a: draft.selected, b: endId, seed: (Math.random() - 0.5) * 70, animated: false });
        draft.selected = null;
        ctl.render();
      }
    }
  };

  var hoistBtn = root.querySelector("#pvHoistBtn");
  if (!hoistBtn) return;
  hoistBtn.onclick = function () {
    if (wrap.dataset.rtLocked === "1") return; // guards a double-press during the 2s hold below
    var pairs = draft.connections.map(function (cc) { return [cc.a, cc.b]; });
    var ok = pv_action_submitRopeTying(session, n.id, pairs);
    if (ok) {
      wrap.dataset.rtLocked = "1";
      hoistBtn.classList.remove("pv-hoist-fail");
      hoistBtn.classList.add("pv-hoist-success");
      wrap.classList.remove("rope-shake");
      wrap.classList.add("rope-clear-away");
      setTimeout(function () {
        ctl.expandedNodeId = null; ctl.pinnedNodeId = null;
        ctl.render();
      }, 2000);
    } else {
      hoistBtn.classList.remove("pv-hoist-success");
      hoistBtn.classList.add("pv-hoist-fail");
      wrap.classList.remove("rope-shake");
      void wrap.offsetWidth; // restart the shake animation even on repeated wrong guesses
      wrap.classList.add("rope-shake");
      setTimeout(function () {
        hoistBtn.classList.remove("pv-hoist-fail");
        wrap.classList.remove("rope-shake");
        ctl.render();
      }, 650);
    }
  };
}

/* ---------------------------------------------------------------------
   Gear & Pulley Builder — mesh-graph geometry/solve-check math and SVG
   markup, ported from the standalone gear-pulley-builder.html prototype.
   Pure math (gpRadiusOf/gpGearPathD/gpComputeMesh/gpSolveState) is exported
   as PAEngine.gp* and shared with Studio's inspector-embedded designer
   (buildTypeSpecificFields/wireNodeInspector's "gearPulley" case in
   app.js), so a validated layout there stays mechanically identical here.
   The rendering below (gpNodeMarkup/gpSocketMarkup/render*) is
   player-runtime only — the design-time board draws differently (teeth
   always visible, no tray), see NODE_TYPES.gearPulley's comment above.
--------------------------------------------------------------------- */
var GP_BASE = 16, GP_PITCH = 2.6;
var GP_TEETH_MIN = 6, GP_TEETH_MAX = 30, GP_TEETH_DEFAULT = 14;
var GP_MAX_AXLES = 12;
var GP_MESH_TOL = 1.5;    // distance tolerance (px) to count as a true mesh
var GP_SNAP_RANGE = 28;   // while dragging in the designer, snap to this close a candidate mesh
var GP_VB_W = 900, GP_VB_H = 620;

function gpRadiusOf(teeth) { return GP_BASE + teeth * GP_PITCH; }

// Same tooth-silhouette path generator as the prototype — a closed SVG path
// string for a gear of pitch radius r with teethCount teeth.
function gpGearPathD(r, teethCount) {
  teethCount = Math.max(6, Math.round(teethCount));
  var step = (Math.PI * 2) / teethCount;
  var toothH = Math.max(4, r * 0.16);
  var rOut = r + toothH * 0.5, rIn = r - toothH * 0.5;
  var d = "";
  function pt(ang, rad) { return [Math.cos(ang) * rad, Math.sin(ang) * rad]; }
  for (var i = 0; i < teethCount; i++) {
    var a0 = i * step, a1 = a0 + step * 0.28, a2 = a0 + step * 0.5, a3 = a0 + step * 0.78, a4 = a0 + step;
    var p0 = pt(a0, rIn), p1 = pt(a1, rIn), p2 = pt(a1, rOut), p3 = pt(a2, rOut),
        p4 = pt(a3, rOut), p5 = pt(a3, rIn), p6 = pt(a4, rIn);
    if (i === 0) d += "M " + p0[0].toFixed(2) + " " + p0[1].toFixed(2) + " ";
    d += "L " + p1[0].toFixed(2) + " " + p1[1].toFixed(2) +
         " L " + p2[0].toFixed(2) + " " + p2[1].toFixed(2) +
         " L " + p3[0].toFixed(2) + " " + p3[1].toFixed(2) +
         " L " + p4[0].toFixed(2) + " " + p4[1].toFixed(2) +
         " L " + p5[0].toFixed(2) + " " + p5[1].toFixed(2) +
         " L " + p6[0].toFixed(2) + " " + p6[1].toFixed(2) + " ";
  }
  return d + "Z";
}

function gpNodeKey(kind, id) { return kind + (id != null ? ":" + id : ""); }

// nodes: [{kind:"handle"|"hoist"|"axle", id, x, y, teeth}, ...] — every
// currently-visible piece (at player-time, only axles with a cog placed).
// Returns { nodes, pairs: [{a,b,state:"mesh"|"clash"|"none",dist,sum}] }.
function gpComputeMesh(nodes) {
  var pairs = [];
  for (var i = 0; i < nodes.length; i++) {
    for (var j = i + 1; j < nodes.length; j++) {
      var A = nodes[i], B = nodes[j];
      var dx = A.x - B.x, dy = A.y - B.y;
      var dist = Math.sqrt(dx * dx + dy * dy);
      var sum = gpRadiusOf(A.teeth) + gpRadiusOf(B.teeth);
      var state = Math.abs(dist - sum) <= GP_MESH_TOL ? "mesh" : (dist < sum ? "clash" : "none");
      pairs.push({ a: A, b: B, state: state, dist: dist, sum: sum });
    }
  }
  return { nodes: nodes, pairs: pairs };
}

// Breadth-first reachability from the handle over "mesh" edges only.
// Returns { ready, solved, reachableCount, total, graph, depth } — depth is
// a nodeKey -> hop-count map used to drive the spin-direction/duration of
// every currently-driven gear (see gpNodeMarkup).
function gpSolveState(nodes) {
  var graph = gpComputeMesh(nodes);
  var handleNode = nodes.find(function (n) { return n.kind === "handle"; });
  var hoistNode = nodes.find(function (n) { return n.kind === "hoist"; });
  if (!handleNode || !hoistNode) {
    return { ready: false, solved: false, reachableCount: 0, total: nodes.length, graph: graph, depth: {} };
  }
  var adj = {};
  nodes.forEach(function (n) { adj[gpNodeKey(n.kind, n.id)] = []; });
  graph.pairs.forEach(function (p) {
    if (p.state === "mesh") {
      var ka = gpNodeKey(p.a.kind, p.a.id), kb = gpNodeKey(p.b.kind, p.b.id);
      adj[ka].push(kb); adj[kb].push(ka);
    }
  });
  var startKey = gpNodeKey("handle", null);
  var depth = {}; depth[startKey] = 0;
  var queue = [startKey], qi = 0;
  while (qi < queue.length) {
    var cur = queue[qi++];
    (adj[cur] || []).forEach(function (next) {
      if (!(next in depth)) { depth[next] = depth[cur] + 1; queue.push(next); }
    });
  }
  var hoistKey = gpNodeKey("hoist", null);
  var solved = hoistKey in depth;
  return { ready: true, solved: solved, reachableCount: queue.length, total: nodes.length, graph: graph, depth: depth };
}

// Per-node player draft: the shuffled tray of cogs (one per axle's correct
// tooth count, plus content.decoyTeeth extras) and the live axleId -> tileId
// placement map. Built once per node per session (see renderPreviewNode's
// "gearPulley" branch, which lazily creates ctl.gearDraft[n.id]) and mutated
// in place by wireGearPulleyInteractions as the player drags cogs around —
// content itself is never touched, same "draft, not the hunt" pattern as
// ctl.ropeDraft/ctl.lumenDraft.
function gpInitDraft(c) {
  var tiles = (c.axles || []).map(function (a) { return { id: uid("gpt"), teeth: a.teeth }; });
  (c.decoyTeeth || []).forEach(function (t) { tiles.push({ id: uid("gpt"), teeth: t }); });
  for (var i = tiles.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = tiles[i]; tiles[i] = tiles[j]; tiles[j] = tmp;
  }
  return { tiles: tiles, placements: {}, selectedTileId: null };
}

// The node list gpComputeMesh/gpSolveState actually see at player-time:
// handle + hoist (always present, teeth as designed) plus only the axles
// that currently have a cog placed (using that cog's own teeth — right or
// wrong, whatever the player chose), reflecting the physical mesh exactly.
function gpLiveNodes(c, draft) {
  var nodes = [];
  if (c.handle) nodes.push({ kind: "handle", id: null, x: c.handle.x, y: c.handle.y, teeth: c.handle.teeth });
  if (c.hoist) nodes.push({ kind: "hoist", id: null, x: c.hoist.x, y: c.hoist.y, teeth: c.hoist.teeth });
  (c.axles || []).forEach(function (a) {
    var tileId = draft.placements[a.id];
    if (!tileId) return;
    var tile = draft.tiles.find(function (t) { return t.id === tileId; });
    if (tile) nodes.push({ kind: "axle", id: a.id, x: a.x, y: a.y, teeth: tile.teeth });
  });
  return nodes;
}

function gpDefsMarkup(idp, dm) {
  if (dm) return "<defs>" + dmDefs(idp) + "</defs>";
  return "<defs>" +
    '<linearGradient id="' + idp + 'steel" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#e2e5e8"/><stop offset="45%" stop-color="#9aa0a6"/><stop offset="100%" stop-color="#54585d"/></linearGradient>' +
    '<radialGradient id="' + idp + 'hub" cx="35%" cy="30%" r="75%"><stop offset="0%" stop-color="#f0d9a0"/><stop offset="100%" stop-color="#8a6a2c"/></radialGradient>' +
    '<linearGradient id="' + idp + 'brass" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f6dfa0"/><stop offset="100%" stop-color="#8a6a2c"/></linearGradient>' +
    "</defs>";
}

// One handle/hoist/axle piece, player-side. Handle and hoist are always
// drawn (fixed, non-interactive); axle pieces are only drawn once a cog is
// placed there (clickableRemovable true), with an invisible larger hit
// circle (.gp-node-hit) wireGearPulleyInteractions listens for taps on to
// lift the cog back out. Spins in place via SMIL <animateTransform> when
// reachable from the handle (sv.depth), same alternating-direction-by-depth
// trick as the prototype so adjacent meshed gears visibly turn opposite
// ways.
function gpNodeMarkup(node, sv, idp, clickableRemovable, dm) {
  var r = gpRadiusOf(node.teeth);
  var key = gpNodeKey(node.kind, node.id);
  var driven = sv.ready && (key in sv.depth);
  var depth = sv.ready ? (sv.depth[key] || 0) : 0;
  var cls = "gp-node-group gp-node-" + node.kind + (clickableRemovable ? " gp-node-removable" : "");
  var s = '<g class="' + cls + '" transform="translate(' + node.x.toFixed(1) + "," + node.y.toFixed(1) + ')">';
  s += "<g>";
  if (driven) {
    var dur = Math.max(1.4, node.teeth * 0.32);
    var toAngle = (depth % 2 === 0) ? "360" : "-360";
    s += '<animateTransform attributeName="transform" type="rotate" from="0 0 0" to="' + toAngle + ' 0 0" dur="' + dur.toFixed(2) + 's" repeatCount="indefinite"/>';
  }
  var steelFill = dm ? DM_VOID : 'url(#' + idp + 'steel)', steelStroke = dm ? DM_INK : "#0a0e1a";
  var hubFill = dm ? dmFill(idp, "hatch1") : 'url(#' + idp + 'hub)';
  var brassFill = dm ? DM_VOID : 'url(#' + idp + 'brass)', brassStroke = dm ? DM_INK : "#4a3510";
  var spokeStroke = dm ? DM_INK : "#4b4f54";
  if (node.kind === "handle") {
    s += '<circle cx="0" cy="0" r="' + r + '" fill="' + steelFill + '" stroke="' + steelStroke + '" stroke-width="1.6"/>';
    for (var sp = 0; sp < 5; sp++) {
      var ang = sp * (Math.PI * 2 / 5);
      s += '<line x1="0" y1="0" x2="' + (Math.cos(ang) * r * 0.72).toFixed(1) + '" y2="' + (Math.sin(ang) * r * 0.72).toFixed(1) + '" stroke="' + spokeStroke + '" stroke-width="' + Math.max(3, r * 0.09).toFixed(1) + '" stroke-linecap="round"/>';
    }
    s += '<line x1="0" y1="0" x2="' + (r + 16) + '" y2="0" stroke="' + (dm ? DM_INK : "#3a3530") + '" stroke-width="6" stroke-linecap="round"/>';
    s += '<circle cx="' + (r + 16) + '" cy="0" r="8" fill="' + brassFill + '" stroke="' + brassStroke + '" stroke-width="1.2"/>';
    s += '<circle cx="0" cy="0" r="' + (r * 0.22).toFixed(1) + '" fill="' + hubFill + '" stroke="' + steelStroke + '" stroke-width="1"/>';
  } else if (node.kind === "hoist") {
    s += '<circle cx="0" cy="0" r="' + r + '" fill="' + steelFill + '" stroke="' + steelStroke + '" stroke-width="1.6"/>';
    s += '<circle cx="0" cy="0" r="' + (r * 0.82).toFixed(1) + '" fill="none" stroke="' + spokeStroke + '" stroke-width="' + (r * 0.14).toFixed(1) + '"/>';
    s += '<circle cx="0" cy="0" r="' + (r * 0.22).toFixed(1) + '" fill="' + hubFill + '" stroke="' + steelStroke + '" stroke-width="1"/>';
  } else {
    s += '<path d="' + gpGearPathD(r, node.teeth) + '" fill="' + steelFill + '" stroke="' + steelStroke + '" stroke-width="1.4" stroke-linejoin="round"/>';
    s += '<circle cx="0" cy="0" r="' + (r * 0.24).toFixed(1) + '" fill="' + hubFill + '" stroke="' + steelStroke + '" stroke-width="1"/>';
  }
  s += "</g>"; // spin group

  var tag = node.kind === "handle" ? "HANDLE" : node.kind === "hoist" ? "HOIST" : "AXLE";
  s += '<text class="gp-node-label" x="0" y="' + (r + 16) + '">' + tag + "</text>";
  s += '<circle cx="0" cy="0" r="11" fill="' + (dm ? DM_INK : "#ffe6a0") + '"' + (dm ? '' : ' opacity="0.92"') + ' pointer-events="none"/>';
  s += '<text class="gp-node-teeth" x="0" y="4"' + (dm ? ' fill="' + DM_VOID + '"' : '') + '>' + node.teeth + "</text>";

  if (clickableRemovable) {
    s += '<circle class="gp-node-hit" data-axleid="' + esc(String(node.id)) + '" cx="0" cy="0" r="' + (r + 10) + '" fill="transparent" pointer-events="all"/>';
  }
  s += "</g>";
  return s;
}

// An empty axle post — a fixed, neutral-sized dashed ring (deliberately NOT
// sized to the correct tooth count, or the radius alone would give the
// answer away) with an invisible larger hit circle (.gp-socket-hit) for
// wireGearPulleyInteractions to drop the currently-selected tray cog onto.
function gpSocketMarkup(axle, idp, armed, dm) {
  var r = 34;
  var s = '<g class="gp-socket' + (armed ? " gp-socket-armed" : "") + '" transform="translate(' + axle.x.toFixed(1) + "," + axle.y.toFixed(1) + ')">';
  s += '<circle r="' + r + '" fill="' + (dm ? DM_VOID : "rgba(255,255,255,0.03)") + '" stroke="' + (dm ? DM_INK : "#4a5578") + '" stroke-width="2" stroke-dasharray="5 5"/>';
  s += '<circle r="4" fill="' + (dm ? DM_INK : "#4a5578") + '"/>';
  s += '<circle class="gp-socket-hit" data-axleid="' + esc(String(axle.id)) + '" r="' + (r + 8) + '" fill="transparent" pointer-events="all"/>';
  s += "</g>";
  return s;
}

// Full board — mesh/clash lines under everything, then the handle, hoist,
// and every axle (a real gear if a cog is placed, an empty socket if not).
function renderGearPulleyBoardSvg(n, ctl) {
  var c = n.content;
  var dm = isDarkMaritime(c);
  var draft = ctl.gearDraft[n.id];
  var idp = "gp" + n.id.replace(/[^a-zA-Z0-9]/g, "") + "_";
  var nodes = gpLiveNodes(c, draft);
  var sv = gpSolveState(nodes);
  var body = "";
  sv.graph.pairs.forEach(function (p) {
    if (p.state === "none") return;
    body += '<line class="gp-mesh-line ' + p.state + '" x1="' + p.a.x + '" y1="' + p.a.y + '" x2="' + p.b.x + '" y2="' + p.b.y + '"/>';
  });
  if (c.handle) body += gpNodeMarkup({ kind: "handle", id: null, x: c.handle.x, y: c.handle.y, teeth: c.handle.teeth }, sv, idp, false, dm);
  if (c.hoist) body += gpNodeMarkup({ kind: "hoist", id: null, x: c.hoist.x, y: c.hoist.y, teeth: c.hoist.teeth }, sv, idp, false, dm);
  (c.axles || []).forEach(function (a) {
    var tileId = draft.placements[a.id];
    var tile = tileId ? draft.tiles.find(function (t) { return t.id === tileId; }) : null;
    if (tile) body += gpNodeMarkup({ kind: "axle", id: a.id, x: a.x, y: a.y, teeth: tile.teeth }, sv, idp, true, dm);
    else body += gpSocketMarkup(a, idp, draft.selectedTileId != null, dm);
  });
  return '<div class="pv-gear-wrap' + (dm ? ' pv-dm' : '') + '" data-node="' + esc(n.id) + '">' +
    '<svg class="pv-gear-svg" data-node="' + esc(n.id) + '" viewBox="0 0 ' + GP_VB_W + " " + GP_VB_H + '" preserveAspectRatio="xMidYMid meet">' +
      gpDefsMarkup(idp, dm) + body +
    "</svg></div>";
}

// The cog tray — every tile not currently placed on an axle, in one
// horizontally-scrollable row (see .pv-gear-tray in styles.css; the row
// never wraps, it scrolls/drags sideways instead, so it stays a single
// strip at the bottom of the screen even with a dozen cogs in it — see
// gpWireTrayDragScroll below for the drag-to-scroll behavior). Tapping a
// tile selects it (highlighted gold, matching the teeth-number halo used on
// the board); tapping it again deselects it.
function renderGearPulleyTray(n, ctl) {
  var dm = isDarkMaritime(n.content);
  var draft = ctl.gearDraft[n.id];
  var placedTileIds = {};
  Object.keys(draft.placements).forEach(function (axId) { placedTileIds[draft.placements[axId]] = true; });
  var remaining = draft.tiles.filter(function (t) { return !placedTileIds[t.id]; });
  var tilesHtml = remaining.map(function (t) {
    var sel = draft.selectedTileId === t.id;
    return '<div class="pv-gear-tile' + (sel ? " selected" : "") + '" data-tileid="' + esc(t.id) + '">' +
      '<svg viewBox="0 0 60 60" class="pv-gear-tile-svg"><path d="' + gpGearPathD(22, t.teeth) + '" transform="translate(30,30)"/></svg>' +
      '<span class="pv-gear-tile-teeth">' + t.teeth + "</span>" +
    "</div>";
  }).join("");
  return '<div class="pv-gear-tray-wrap' + (dm ? ' pv-dm' : '') + '">' +
    '<div class="pv-gear-tray-label">Cogs — drag to see them all, tap one, then tap an axle post</div>' +
    '<div class="pv-gear-tray" data-node="' + esc(n.id) + '">' +
      (tilesHtml || '<div class="pv-gear-tray-empty">All cogs placed</div>') +
    "</div></div>";
}

// Lets the player click-drag the tray sideways to see cogs past the visible
// edge (native overflow-x already gives touch/trackpad scrolling; this adds
// the same for a mouse drag) without that drag also registering as a tap on
// whatever tile the pointer happened to be over. Re-wired fresh on every
// render since the tray element itself is rebuilt each time.
function gpWireTrayDragScroll(trayEl) {
  var isDown = false, startX = 0, startScroll = 0, moved = false;
  trayEl.addEventListener("pointerdown", function (e) {
    isDown = true; moved = false;
    startX = e.clientX; startScroll = trayEl.scrollLeft;
    trayEl.classList.add("dragging");
    try { trayEl.setPointerCapture(e.pointerId); } catch (err) {}
  });
  trayEl.addEventListener("pointermove", function (e) {
    if (!isDown) return;
    var dx = e.clientX - startX;
    if (Math.abs(dx) > 4) moved = true;
    trayEl.scrollLeft = startScroll - dx;
  });
  function endDrag() { isDown = false; trayEl.classList.remove("dragging"); }
  trayEl.addEventListener("pointerup", endDrag);
  trayEl.addEventListener("pointercancel", endDrag);
  trayEl.addEventListener("pointerleave", endDrag);
  trayEl.addEventListener("click", function (e) {
    if (moved) { e.stopPropagation(); moved = false; }
  }, true);
}

// Player-runtime interaction — taps a tray tile to select it, taps an empty
// socket (.gp-socket-hit) to drop the selected tile there, taps a filled
// axle (.gp-node-hit) to lift its cog back into the tray. Every tap
// re-renders the whole node (board + tray are plain HTML strings, see
// render* above), same "select then act, then ctl.render()" shape as
// wireRopeTyingInteractions/wireCategoryGridInteractions — there's no
// requestAnimationFrame loop or persistent DOM refs, the mesh/clash lines
// and spin animations just fall out of whatever gpSolveState says on the
// next render. Recomputes gpSolveState after every placement and only
// calls pv_action_submitGearPulley once the handle-hoist chain actually
// connects (never with a false/incorrect mechanicOk — same "auto-validate,
// withhold while incomplete" shape as Category Grid).
function wireGearPulleyInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-gear-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var c = n.content;
  ctl.gearDraft = ctl.gearDraft || {};
  if (!ctl.gearDraft[n.id]) ctl.gearDraft[n.id] = gpInitDraft(c);
  var draft = ctl.gearDraft[n.id];

  var svg = wrap.querySelector(".pv-gear-svg");
  if (svg) svg.onclick = function (e) {
    var t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains("gp-socket-hit")) {
      var axleId = t.dataset.axleid;
      if (!axleId || !draft.selectedTileId) return;
      draft.placements[axleId] = draft.selectedTileId;
      draft.selectedTileId = null;
      checkSolved();
      return;
    }
    if (t.classList.contains("gp-node-hit")) {
      var axleId2 = t.dataset.axleid;
      if (!axleId2) return;
      delete draft.placements[axleId2];
      draft.selectedTileId = null;
      ctl.render();
    }
  };

  var trayEl = root.querySelector('.pv-gear-tray[data-node="' + n.id + '"]');
  if (trayEl) {
    Array.prototype.forEach.call(trayEl.querySelectorAll(".pv-gear-tile"), function (tile) {
      tile.onclick = function () {
        var tid = tile.dataset.tileid;
        draft.selectedTileId = draft.selectedTileId === tid ? null : tid;
        ctl.render();
      };
    });
    gpWireTrayDragScroll(trayEl);
  }

  function checkSolved() {
    var nodes = gpLiveNodes(c, draft);
    var sv = gpSolveState(nodes);
    if (sv.solved) {
      var ok = pv_action_submitGearPulley(session, n.id, true);
      if (ok) {
        ctl.render();
        setTimeout(function () { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); }, 900);
        return;
      }
    }
    ctl.render();
  }
}

/* ---------------------------------------------------------------------
   Weight Scale Builder — two-pan balance puzzle, ported from the
   standalone balance-scale-puzzle.html prototype. No shared geometry math
   with app.js here (unlike Gear & Pulley/Lumen Puzzle): the Studio builder
   is a flat resizable list of up to WS_MAX_ITEMS tokens (shape+colour or an
   uploaded photo, plus a hidden weight) with no spatial layout to keep in
   sync, so app.js only ever reads/writes n.content.items directly.

   Every position and size below is a percentage of a fixed WS_VB_W×WS_VB_H
   virtual coordinate space (the same "always render the whole board, never
   crop it" trick as the SVG viewBox on Gear & Pulley/Lumen Puzzle, just
   done with percentages instead since this stage is plain positioned HTML,
   not SVG) — see .pv-ws-stage in styles.css, which locks that aspect ratio
   via width:100%/aspect-ratio so the scale is always shown in full at any
   container width. The two pans (.pv-ws-pan) are flex-wrap containers, so
   however many tokens end up piled on one side never overflows sideways
   either — they just wrap onto another row inside the pan.
--------------------------------------------------------------------- */
var WS_VB_W = 640, WS_VB_H = 400;
var WS_PIVOT = { x: 320, y: 150 };
var WS_HALF_LEN = 170;
var WS_MAX_ANGLE = 20 * Math.PI / 180;
var WS_MAX_ITEMS = 8;
var WS_SHAPES = ["circle", "square", "triangle", "hexagon", "star", "pentagon", "diamond", "octagon"];

function wsClamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function wsPctX(v) { return (v / WS_VB_W * 100).toFixed(3); }
function wsPctY(v) { return (v / WS_VB_H * 100).toFixed(3); }

// Per-node player draft: a shuffled display order for the tray plus the
// live itemId -> "tray"|"left"|"right" placement map. Built once per node
// per session (see renderPreviewNode's "weightScale" branch, which lazily
// creates ctl.wsDraft[n.id]) and mutated in place by
// wireWeightScaleInteractions as the player taps tokens around — content
// itself is never touched, same "draft, not the hunt" pattern as
// ctl.gearDraft/ctl.ropeDraft.
function wsInitDraft(c) {
  var items = (c.items || []).slice(0, WS_MAX_ITEMS);
  var order = items.map(function (it) { return it.id; });
  for (var i = order.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = order[i]; order[i] = order[j]; order[j] = tmp;
  }
  var placements = {};
  items.forEach(function (it) { placements[it.id] = "tray"; });
  return { order: order, placements: placements, selectedId: null };
}

// left/right pan totals, the raw diff (right - left, same sign convention
// as the prototype's beam-tilt math) and whether every token has left the
// tray yet — solved only ever requires allPlaced && diff === 0 (see
// pv_action_submitWeightScale), which the beam's own weight-positivity
// already rules out ever being trivially true with one pan left empty.
function wsTotals(c, draft) {
  var items = c.items || [];
  var left = 0, right = 0, total = 0, allPlaced = true;
  items.forEach(function (it) {
    var w = Number(it.weight) || 0;
    total += w;
    var zone = draft.placements[it.id];
    if (zone === "left") left += w;
    else if (zone === "right") right += w;
    else allPlaced = false;
  });
  return { left: left, right: right, diff: right - left, total: total, allPlaced: allPlaced };
}

// One token, in whichever zone it currently lives in. Deliberately two
// nested divs, not one: the outer .pv-ws-token is the click target and
// carries the selected-state ring and the weight badge (.pv-ws-value-tag,
// always in the markup but only shown once solved — see the "solved"
// class), while the inner .pv-ws-token-inner/.pv-ws-token-image carries the
// actual clip-path shape. clip-path clips *everything* painted inside the
// element it's set on, badge included — putting it one level down keeps
// the badge (and the selection ring) from being silently clipped away on
// any non-round shape (star, hexagon, triangle, …). Shape tokens carry
// their creator-chosen colour as a CSS custom property (--tok-color) read
// by the .ws-shape-* clip-path classes in styles.css (shared with the
// small preview swatch buildWeightScaleFields draws in the Studio
// inspector, so the same 8 clip-paths aren't defined twice); image tokens
// skip the shape entirely and just show the uploaded photo.
function wsTokenMarkup(item, extraClass) {
  var cls = extraClass ? " " + extraClass : "";
  var weightLabel = esc(String(Math.round(Number(item.weight) || 0)));
  var inner;
  if (item.kind === "image" && item.imageAsset) {
    inner = '<div class="pv-ws-token-image" style="background-image:url(\'' + esc(item.imageAsset) + '\')"></div>';
  } else {
    inner = '<div class="pv-ws-token-inner ws-shape-' + esc(item.shape || "circle") + '" style="--tok-color:' + esc(item.color || "#8a8a8a") + '"></div>';
  }
  var body = '<div class="pv-ws-token' + cls + '" data-itemid="' + esc(item.id) + '">' + inner;
  body += '<span class="pv-ws-value-tag">' + weightLabel + '</span></div>';
  return body;
}

// The scale itself — base/post/pivot are fixed (styled entirely in CSS),
// only the beam's rotation and the two pans' positions change per render,
// recomputed fresh from the live left/right totals every time (no
// persistent DOM refs or CSS transitions to manage, same "just re-render
// the whole thing" shape as Gear & Pulley's mesh lines).
function renderWeightScaleStage(n, ctl, solved) {
  var c = n.content;
  var items = (c.items || []).slice(0, WS_MAX_ITEMS);
  var itemById = {}; items.forEach(function (it) { itemById[it.id] = it; });
  var draft = ctl.wsDraft[n.id];
  var totals = wsTotals(c, draft);

  var theta = totals.total > 0 ? wsClamp(totals.diff / totals.total, -1, 1) * WS_MAX_ANGLE : 0;
  var cosT = Math.cos(theta), sinT = Math.sin(theta);
  var leftX = WS_PIVOT.x - WS_HALF_LEN * cosT, leftY = WS_PIVOT.y - WS_HALF_LEN * sinT;
  var rightX = WS_PIVOT.x + WS_HALF_LEN * cosT, rightY = WS_PIVOT.y + WS_HALF_LEN * sinT;

  function tokensFor(zone) {
    return draft.order.map(function (id) { return itemById[id]; })
      .filter(function (it) { return it && draft.placements[it.id] === zone; })
      .map(function (it) { return wsTokenMarkup(it, (draft.selectedId === it.id ? "selected" : "") + (solved ? " solved" : "")); })
      .join("");
  }

  var statusText, statusClass;
  if (totals.allPlaced && totals.diff === 0) {
    statusText = "Balanced! The beam settles dead level."; statusClass = "balanced";
  } else if (totals.left === 0 && totals.right === 0) {
    statusText = "The beam rests, empty and level."; statusClass = "";
  } else if (totals.diff > 0) {
    statusText = "The right pan dips lower…"; statusClass = "right-heavy";
  } else if (totals.diff < 0) {
    statusText = "The left pan dips lower…"; statusClass = "left-heavy";
  } else {
    statusText = "Level for now — the tray isn't empty yet."; statusClass = "";
  }

  var html = '<div class="pv-ws-wrap' + (isDarkMaritime(c) ? ' pv-dm' : '') + '" data-node="' + esc(n.id) + '">';
  html += '<div class="pv-ws-stage">';
  html += '<div class="pv-ws-base"></div><div class="pv-ws-post"></div>';
  html += '<div class="pv-ws-beam" style="transform:translate(-50%,-50%) rotate(' + theta.toFixed(4) + 'rad)"></div>';
  html += '<div class="pv-ws-pivot"></div>';
  html += '<div class="pv-ws-arm" style="left:' + wsPctX(leftX) + '%;top:' + wsPctY(leftY) + '%">' +
    '<div class="pv-ws-rope"></div>' +
    '<div class="pv-ws-pan" data-node="' + esc(n.id) + '" data-wszone="left">' + tokensFor("left") + '</div>' +
    '</div>';
  html += '<div class="pv-ws-arm" style="left:' + wsPctX(rightX) + '%;top:' + wsPctY(rightY) + '%">' +
    '<div class="pv-ws-rope"></div>' +
    '<div class="pv-ws-pan" data-node="' + esc(n.id) + '" data-wszone="right">' + tokensFor("right") + '</div>' +
    '</div>';
  html += '</div>'; // .pv-ws-stage
  html += '<div class="pv-ws-status ' + statusClass + '">' + esc(statusText) + '</div>';
  html += '</div>'; // .pv-ws-wrap
  return html;
}

// The tray — every token not currently on a pan, in a wrapping row below
// the stage (see .pv-ws-tray in styles.css; flex-wrap, not the single
// scrolling strip Gear & Pulley's cog tray uses, since up to 8 tokens
// wraps onto at most two short rows rather than needing a long sideways
// scroll).
function renderWeightScaleTray(n, ctl, solved) {
  var c = n.content;
  var items = (c.items || []).slice(0, WS_MAX_ITEMS);
  var itemById = {}; items.forEach(function (it) { itemById[it.id] = it; });
  var draft = ctl.wsDraft[n.id];
  var tokensHtml = draft.order
    .filter(function (id) { return draft.placements[id] === "tray"; })
    .map(function (id) { var it = itemById[id]; return it ? wsTokenMarkup(it, (draft.selectedId === id ? "selected" : "") + (solved ? " solved" : "")) : ""; })
    .join("");
  return '<div class="pv-ws-tray-wrap' + (isDarkMaritime(c) ? ' pv-dm' : '') + '">' +
    '<div class="pv-ws-tray-label">Tray — tap a token, then tap the tray or a pan to move it there</div>' +
    '<div class="pv-ws-tray" data-node="' + esc(n.id) + '" data-wszone="tray">' +
    (tokensHtml || '<div class="pv-ws-tray-empty">All tokens placed on the scale</div>') +
    '</div></div>';
}

// Player-runtime interaction — tapping a token selects it (tapping it again
// deselects it, tapping a *different* token moves whatever was already
// selected into that token's own zone), tapping empty space in a pan or the
// tray moves the selected token there. Same "select then act, then
// ctl.render()" shape as wireGearPulleyInteractions above. Recomputes
// wsTotals after every placement and only calls
// pv_action_submitWeightScale once every token is off the tray (never with
// a false/incorrect mechanicOk while the player's still mid-sort — same
// withholding idiom as wireCategoryGridInteractions' maybeCheck).
function wireWeightScaleInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-ws-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var c = n.content;
  ctl.wsDraft = ctl.wsDraft || {};
  if (!ctl.wsDraft[n.id]) ctl.wsDraft[n.id] = wsInitDraft(c);
  var draft = ctl.wsDraft[n.id];

  function moveSelectedTo(zone) {
    if (!draft.selectedId) return;
    draft.placements[draft.selectedId] = zone;
    draft.selectedId = null;
    checkSolved();
  }

  Array.prototype.forEach.call(root.querySelectorAll(".pv-ws-token[data-itemid]"), function (tokEl) {
    tokEl.onclick = function (e) {
      e.stopPropagation();
      var id = tokEl.dataset.itemid;
      if (!draft.selectedId) { draft.selectedId = id; ctl.render(); return; }
      if (draft.selectedId === id) { draft.selectedId = null; ctl.render(); return; }
      var zoneEl = tokEl.closest("[data-wszone]");
      moveSelectedTo(zoneEl ? zoneEl.dataset.wszone : "tray");
    };
  });
  // Only reached on a genuine tap on empty pan/tray background — a tap that
  // landed on a token itself is already handled above, and stopPropagation
  // there keeps it from also bubbling up to this listener.
  Array.prototype.forEach.call(root.querySelectorAll("[data-wszone]"), function (zoneEl) {
    zoneEl.onclick = function () { moveSelectedTo(zoneEl.dataset.wszone); };
  });

  function checkSolved() {
    var totals = wsTotals(c, draft);
    if (!totals.allPlaced) { ctl.render(); return; }
    var ok = pv_action_submitWeightScale(session, n.id, true, totals.diff === 0);
    if (ok) {
      ctl.render();
      setTimeout(function () { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); }, 900);
      return;
    }
    ctl.render();
  }
}

// Category Grid — drag-and-drop (gallery <-> grid, grid <-> grid) plus
// tap-a-filled-cell-then-another-to-swap, same "select then act" shape as
// wireRopeTyingInteractions' tie interaction above. Auto-validates the
// instant every cell is filled (see maybeCheck below) — there's no submit
// button, same family as Fuse Panel/Lumen Puzzle. On a correct arrangement
// it plays the completion graphic the design spec calls for: the 3 row
// categories fade in in succession, hold for a beat, then the 3 column
// categories (rotated 90 degrees, via the .pv-cgrid-reveal-cols CSS —
// see styles.css) fade in the same way, hold, then the node actually
// completes and the view advances — mirroring the 2s/600ms "hold before
// advancing" trick wireRopeTyingInteractions/wireLumenPuzzleInteractions
// already use, just with the two longer named phases this puzzle needs.
// ~1200ms for the 3 labels to stagger in (2 * 350ms delay + 500ms fade),
// plus a 6000ms pause once they're all up, per phase.
var CA_GRID_REVEAL_PHASE_MS = 7200;
function wireCategoryGridInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-cgrid-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  if (!ctl.categoryGridDraft[n.id]) {
    ctl.categoryGridDraft[n.id] = { cells: [null, null, null, null, null, null, null, null, null], gallery: (n.content.images || []).map(function (im) { return im.id; }), selected: null };
  }
  var draft = ctl.categoryGridDraft[n.id];
  ctl.categoryGridReveal = ctl.categoryGridReveal || {};
  if (ctl.categoryGridReveal[n.id]) return; // frozen while the completion graphic plays

  function placeAt(cellIdx, imgId, fromCellIdx, fromGallery) {
    if (fromGallery) {
      var gi = draft.gallery.indexOf(imgId);
      if (gi !== -1) draft.gallery.splice(gi, 1);
    }
    var displaced = draft.cells[cellIdx];
    if (typeof fromCellIdx === "number") {
      draft.cells[fromCellIdx] = displaced; // swap (or clear, if the target cell was empty)
    } else if (displaced) {
      draft.gallery.push(displaced); // bump the previous occupant back to the gallery
    }
    draft.cells[cellIdx] = imgId;
  }

  function maybeCheck() {
    if (draft.cells.indexOf(null) !== -1) { ctl.render(); return; }
    var ok = pv_action_submitCategoryGrid(session, n.id, draft.cells);
    if (!ok) { ctl.render(); return; }
    var names = caGridSolvedCategoryNames(n.content, draft.cells);
    ctl.categoryGridReveal[n.id] = { phase: "rows", cellIds: draft.cells.slice(), names: names };
    ctl.render();
    setTimeout(function () {
      if (!ctl.categoryGridReveal[n.id]) return; // node/session was reset mid-reveal
      ctl.categoryGridReveal[n.id].phase = "cols";
      ctl.render();
      setTimeout(function () {
        if (!ctl.categoryGridReveal[n.id]) return;
        delete ctl.categoryGridReveal[n.id];
        ctl.expandedNodeId = null; ctl.pinnedNodeId = null;
        ctl.render();
      }, CA_GRID_REVEAL_PHASE_MS);
    }, CA_GRID_REVEAL_PHASE_MS);
  }

  var galleryEl = root.querySelector('.pv-cgrid-gallery[data-node="' + n.id + '"]');

  // Draggable pieces live in two separate DOM subtrees — the board's cells
  // (inside wrap) and the gallery below it (a sibling of wrap, not a
  // descendant, so a wrap-scoped query alone would silently miss every
  // gallery image — including all 9 of them on a fresh board, which is
  // exactly the set a player needs to be able to drag *from* first).
  var pieceEls = Array.prototype.slice.call(wrap.querySelectorAll('.pv-cgrid-piece[draggable="true"]'));
  if (galleryEl) pieceEls = pieceEls.concat(Array.prototype.slice.call(galleryEl.querySelectorAll('.pv-cgrid-piece[draggable="true"]')));
  pieceEls.forEach(function (piece) {
    piece.addEventListener("dragstart", function (e) {
      var cellEl = piece.closest("[data-cgcell]");
      e.dataTransfer.setData("text/plain", piece.dataset.cgimg + "|" + piece.dataset.cgfrom + "|" + (cellEl ? cellEl.dataset.cgcell : ""));
      e.dataTransfer.effectAllowed = "move";
    });
  });

  Array.prototype.forEach.call(wrap.querySelectorAll(".pv-cgrid-cell"), function (cellEl) {
    cellEl.addEventListener("dragover", function (e) { e.preventDefault(); cellEl.classList.add("dragover"); });
    cellEl.addEventListener("dragleave", function () { cellEl.classList.remove("dragover"); });
    cellEl.addEventListener("drop", function (e) {
      e.preventDefault();
      cellEl.classList.remove("dragover");
      var data = (e.dataTransfer.getData("text/plain") || "").split("|");
      var imgId = data[0], from = data[1], fromCellIdx = data[2] !== "" ? Number(data[2]) : null;
      if (!imgId) return;
      var toIdx = Number(cellEl.dataset.cgcell);
      if (from === "cell" && fromCellIdx === toIdx) return;
      placeAt(toIdx, imgId, from === "cell" ? fromCellIdx : null, from === "gallery");
      draft.selected = null;
      maybeCheck();
    });
    cellEl.onclick = function () {
      var idx = Number(cellEl.dataset.cgcell);
      if (!draft.cells[idx]) { draft.selected = null; ctl.render(); return; }
      if (draft.selected === null) { draft.selected = idx; ctl.render(); }
      else if (draft.selected === idx) { draft.selected = null; ctl.render(); }
      else {
        var a = draft.selected, b = idx;
        var tmp = draft.cells[a]; draft.cells[a] = draft.cells[b]; draft.cells[b] = tmp;
        draft.selected = null;
        maybeCheck();
      }
    };
    cellEl.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); cellEl.onclick(); } };
  });

  if (galleryEl) {
    galleryEl.addEventListener("dragover", function (e) { e.preventDefault(); galleryEl.classList.add("dragover"); });
    galleryEl.addEventListener("dragleave", function () { galleryEl.classList.remove("dragover"); });
    galleryEl.addEventListener("drop", function (e) {
      e.preventDefault();
      galleryEl.classList.remove("dragover");
      var data = (e.dataTransfer.getData("text/plain") || "").split("|");
      var imgId = data[0], from = data[1], fromCellIdx = data[2] !== "" ? Number(data[2]) : null;
      if (!imgId || from !== "cell" || fromCellIdx === null) return;
      draft.cells[fromCellIdx] = null;
      if (draft.gallery.indexOf(imgId) === -1) draft.gallery.push(imgId);
      draft.selected = null;
      ctl.render();
    });
  }
}

// Constraint Satisfaction Puzzle — the top-right toggle swaps the whole
// screen between the requirements text and the answer entry grid (purely a
// ctl.cspDraft[n.id].mode flip, re-rendered by renderPreviewNode's
// "constraintSatisfaction" branch above). There are no +/- buttons on each
// item's count — it's a scroll/drag "wheel" instead (mouse wheel, or a
// vertical drag/swipe, same reel-drag idea as the Physical Lock Code
// node's combination wheels — see wireLockDials above), always clamped so
// a recipient's count for an item can never go below 0 or take more of
// that item than the pool has left unallocated. Auto-validates the
// instant every item's pool is fully allocated (mirrors
// wireCategoryGridInteractions' "withhold the check while incomplete"
// pattern above) — see pv_action_submitConstraintSatisfaction.
function wireConstraintSatisfactionInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-csp-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var draft = ctl.cspDraft[n.id];
  if (!draft) return;

  var toggleBtn = wrap.querySelector("[data-csptoggle]");
  if (toggleBtn) toggleBtn.onclick = function () { draft.mode = toggleBtn.dataset.csptoggle; ctl.render(); };

  function maybeCheck() {
    var items = n.content.items || [];
    var allAllocated = items.length > 0 && items.every(function (it) { return cspItemRemaining(n.content, it.id, draft.alloc) === 0; });
    if (!allAllocated) { session.state.feedback[n.id] = null; ctl.render(); return; }
    var ok = pv_action_submitConstraintSatisfaction(session, n.id, draft.alloc);
    if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
    ctl.render();
  }

  // Nudges a recipient/item's live count by `delta` steps, clamped to
  // [0, current + remaining pool]. Returns true if the count actually
  // changed. Used by the wheel and keyboard handlers below, both of which
  // only ever move one step at a time.
  function adjustBy(rid, iid, delta) {
    if (!delta) return false;
    draft.alloc[rid] = draft.alloc[rid] || {};
    var cur = draft.alloc[rid][iid] || 0;
    var max = cur + cspItemRemaining(n.content, iid, draft.alloc);
    var next = Math.max(0, Math.min(max, cur + delta));
    if (next === cur) return false;
    draft.alloc[rid][iid] = next;
    return true;
  }
  // Sets a recipient/item's live count to an absolute target, same
  // clamping as adjustBy. Used by the drag handler below, which tracks a
  // drag distance relative to the count at drag-start rather than an
  // incremental step, so the value always converges correctly even after
  // a drag runs past a bound and back again.
  function setCount(rid, iid, desired) {
    draft.alloc[rid] = draft.alloc[rid] || {};
    var cur = draft.alloc[rid][iid] || 0;
    var max = cur + cspItemRemaining(n.content, iid, draft.alloc);
    var next = Math.max(0, Math.min(max, desired));
    if (next === cur) return false;
    draft.alloc[rid][iid] = next;
    return true;
  }

  var WHEEL_STEP_PX = 22; // scroll/drag distance per +/-1 step
  Array.prototype.forEach.call(wrap.querySelectorAll("[data-cspwheel]"), function (el) {
    var rid = el.dataset.rid, iid = el.dataset.iid;
    var countEl = el.querySelector(".pv-csp-count");

    // Patches just this widget's own number/state in place — used while a
    // drag is in progress so pointer capture survives the whole gesture
    // (a full ctl.render() mid-drag would replace `el` with a fresh
    // element and silently break the drag). The normal full
    // re-render + validation still runs once via maybeCheck() at the end
    // of every gesture (wheel tick, drag release, or key press).
    function syncDisplay() {
      var cur = (draft.alloc[rid] && draft.alloc[rid][iid]) || 0;
      var remain = cspItemRemaining(n.content, iid, draft.alloc);
      if (countEl) countEl.textContent = cur;
      el.setAttribute("aria-valuenow", cur);
      el.classList.toggle("pv-csp-wheel-min", cur <= 0);
      el.classList.toggle("pv-csp-wheel-max", remain <= 0);
    }

    // Mouse wheel / trackpad — each gesture accumulates deltaY until it
    // crosses one step's worth, so a light trackpad flick doesn't jump
    // several steps at once.
    var wheelAccum = 0;
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      wheelAccum += e.deltaY;
      var steps = 0;
      while (wheelAccum <= -WHEEL_STEP_PX) { steps--; wheelAccum += WHEEL_STEP_PX; }
      while (wheelAccum >= WHEEL_STEP_PX) { steps++; wheelAccum -= WHEEL_STEP_PX; }
      if (steps && adjustBy(rid, iid, -steps)) maybeCheck();
    }, { passive: false });

    // Drag up/down (mouse or touch) — dragging up increases the count
    // (like pulling a slot-machine reel toward you), dragging down
    // decreases it.
    var dragging = false, startY = 0, startCount = 0, changedDuringDrag = false;
    el.addEventListener("pointerdown", function (e) {
      dragging = true; changedDuringDrag = false;
      startY = e.clientY;
      startCount = (draft.alloc[rid] && draft.alloc[rid][iid]) || 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers: drag still tracks via direct listeners */ }
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var steps = Math.round((startY - e.clientY) / WHEEL_STEP_PX);
      if (setCount(rid, iid, startCount + steps)) { changedDuringDrag = true; syncDisplay(); }
    });
    function endDrag() {
      if (!dragging) return;
      dragging = false;
      if (changedDuringDrag) maybeCheck();
    }
    el.addEventListener("pointerup", endDrag);
    el.addEventListener("pointercancel", endDrag);

    // Keyboard — Up/Down arrows, same as a native role="spinbutton" is
    // expected to support.
    el.onkeydown = function (e) {
      if (e.key === "ArrowUp") { e.preventDefault(); if (adjustBy(rid, iid, 1)) maybeCheck(); }
      else if (e.key === "ArrowDown") { e.preventDefault(); if (adjustBy(rid, iid, -1)) maybeCheck(); }
    };
  });
}

/* ---------------------------------------------------------------------
   Lumen Beam Puzzle — hex-grid light-routing geometry and beam-tracing
   engine, ported from the standalone lumen-puzzle-builder.html prototype.
   Pure functions only (no DOM, no mutable module-level "current level"):
   everything takes an explicit geometry object (from lumenComputeGeometry,
   which depends only on content.gridSize) and/or a live piece-state object
   (sources/pieces/targets/walls/cards, straight off node.content or a
   player-side draft copy with live piece angles). Exported at the bottom
   of this module as PAEngine.lumen* so both the player runtime
   (wireLumenPuzzleInteractions, below) and Studio's inspector-embedded
   level designer (buildTypeSpecificFields/wireNodeInspector's
   "lumenPuzzle" case in app.js) share exactly the same math rather than
   maintaining two copies of hex trigonometry and beam physics.
--------------------------------------------------------------------- */
var LUMEN_STAGE_SIZE = 760;
var LUMEN_OVERSCAN = 1.05;
var LUMEN_EPS_MIN = 0.5;
var LUMEN_LENS_BOOST = 1.6, LUMEN_LENS_PENALTY = 0.9;
var LUMEN_SLIT_HALF_DEG = 20;

function lumenRad(d) { return d * Math.PI / 180; }
function lumenNorm360(d) { return ((d % 360) + 360) % 360; }
function lumenNum(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }
function lumenFmt(n) { return (Math.round(n * 100) / 100).toFixed(2); }

function lumenAxialLocal(hexR, q, r) {
  return { x: hexR * Math.sqrt(3) * (q + r / 2), y: hexR * 1.5 * r };
}
function lumenHexVerts(cx, cy, size) {
  var v = [];
  for (var i = 0; i < 6; i++) {
    var a = lumenRad(60 * i - 30);
    v.push({ x: cx + size * Math.cos(a), y: cy + size * Math.sin(a) });
  }
  return v;
}
function lumenHexEdges(cx, cy, size) {
  var v = lumenHexVerts(cx, cy, size);
  var e = [];
  for (var i = 0; i < 6; i++) e.push([v[i], v[(i + 1) % 6]]);
  return e;
}
// Square field of hexes built from offset (row,col) coordinates — raw axial
// q/r ranges form a rhombus, so each row's columns get a per-row offset to
// yield a rectangular field instead. Same approach as the prototype.
//
// shape "circle" keeps exactly the same (row,col)->axial mapping — so a
// piece's stored q/r means the same physical hex regardless of which shape
// is active — but only visits hexes within lumenHexCubeDistance of the
// field's own center hex, giving a hex-disk instead of the full rectangle.
function lumenForEachGridHex(N, shape, cb) {
  var rr, cc;
  var centerR = Math.floor((N - 1) / 2);
  var centerRowOffset = Math.floor(centerR / 2);
  var centerQ = Math.floor((N - 1) / 2) - centerRowOffset;
  var radius = (N - 1) / 2;
  for (rr = 0; rr < N; rr++) {
    var rowOffset = Math.floor(rr / 2);
    for (cc = 0; cc < N; cc++) {
      var q = cc - rowOffset, r = rr;
      if (shape === "circle" && lumenHexCubeDistance(q, r, centerQ, centerR) > radius) continue;
      cb(q, r);
    }
  }
}
// Standard cube-coordinate hex distance (axial q/r converted to cube x/z/-x-z),
// used to trim the square offset field down to a disk for "circle" fields.
function lumenHexCubeDistance(q1, r1, q2, r2) {
  var x1 = q1, z1 = r1, y1 = -x1 - z1;
  var x2 = q2, z2 = r2, y2 = -x2 - z2;
  return Math.max(Math.abs(x1 - x2), Math.abs(y1 - y2), Math.abs(z1 - z2));
}

// Builds the render/anchor geometry for a level purely from its grid size and
// field shape — independent of what's actually placed on it, so it only
// needs recomputing when gridSize/fieldShape change (not on every piece
// rotation).
function lumenComputeGeometry(gridSize, fieldShape) {
  var N = Math.max(3, Math.min(15, Math.round(lumenNum(gridSize, 8))));
  var shape = fieldShape === "circle" ? "circle" : "square";
  var xs = [], ys = [];
  lumenForEachGridHex(N, shape, function (q, r) {
    var c = lumenAxialLocal(1, q, r);
    lumenHexVerts(c.x, c.y, 1).forEach(function (v) { xs.push(v.x); ys.push(v.y); });
  });
  var minXu = Math.min.apply(null, xs), maxXu = Math.max.apply(null, xs);
  var minYu = Math.min.apply(null, ys), maxYu = Math.max.apply(null, ys);
  var w0 = maxXu - minXu, h0 = maxYu - minYu;
  var scale = (LUMEN_STAGE_SIZE / Math.min(w0, h0)) * LUMEN_OVERSCAN;

  var L = { gridSize: N, fieldShape: shape };
  L.hexR = scale;
  L.k = scale / 36;
  L.lensR = scale * 0.4;
  L.mirrorHalf = scale * 0.6;
  L.targetR = scale * 0.4;
  L.cylOuter = scale * 0.66;
  L.cylInner = scale * 0.5;
  L.eps = Math.max(LUMEN_EPS_MIN, scale * 0.02);

  var fieldW = w0 * scale, fieldH = h0 * scale;
  L.offsetX = -(minXu * scale) + (LUMEN_STAGE_SIZE - fieldW) / 2;
  L.offsetY = -(minYu * scale) + (LUMEN_STAGE_SIZE - fieldH) / 2;
  L.width = LUMEN_STAGE_SIZE; L.height = LUMEN_STAGE_SIZE;

  L.hexList = [];
  L.anchors = [];
  lumenForEachGridHex(N, shape, function (q, r) {
    var c = lumenHexPx(L, q, r);
    L.hexList.push({ q: q, r: r, x: c.x, y: c.y });
    L.anchors.push({ x: c.x, y: c.y, q: q, r: r, kind: "center", idx: 0 });
    var verts = lumenHexVerts(c.x, c.y, L.hexR);
    for (var i = 0; i < 6; i++) L.anchors.push({ x: verts[i].x, y: verts[i].y, q: q, r: r, kind: "corner", idx: i });
    for (var j = 0; j < 6; j++) {
      var a = verts[j], b = verts[(j + 1) % 6];
      L.anchors.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, q: q, r: r, kind: "edge", idx: j });
    }
  });
  return L;
}

function lumenHexPx(geom, q, r) {
  var p = lumenAxialLocal(geom.hexR, q, r);
  return { x: p.x + (geom.offsetX || 0), y: p.y + (geom.offsetY || 0) };
}
function lumenAnchorPx(geom, obj) {
  var c = lumenHexPx(geom, obj.q, obj.r);
  if (!obj.kind || obj.kind === "center") return c;
  var verts = lumenHexVerts(c.x, c.y, geom.hexR);
  if (obj.kind === "corner") {
    var i = ((obj.idx % 6) + 6) % 6;
    return { x: verts[i].x, y: verts[i].y };
  }
  var j = ((obj.idx % 6) + 6) % 6;
  var a = verts[j], b = verts[(j + 1) % 6];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
function lumenCardSegment(geom, card) {
  var c = lumenHexPx(geom, card.q, card.r);
  var verts = lumenHexVerts(c.x, c.y, geom.hexR);
  var i = ((card.edgeIdx % 6) + 6) % 6;
  return [verts[i], verts[(i + 1) % 6]];
}

function lumenSegIntersect(O, D, A, B, minT) {
  var v1x = O.x - A.x, v1y = O.y - A.y;
  var v2x = B.x - A.x, v2y = B.y - A.y;
  var v3x = -D.y, v3y = D.x;
  var dot = v2x * v3x + v2y * v3y;
  if (Math.abs(dot) < 1e-9) return null;
  var t1 = (v2x * v1y - v2y * v1x) / dot;
  var t2 = (v1x * v3x + v1y * v3y) / dot;
  if (t1 > minT && t2 >= 0 && t2 <= 1) return { t: t1, x: O.x + D.x * t1, y: O.y + D.y * t1 };
  return null;
}
function lumenCircleIntersect(O, D, C, r, minT) {
  var ocx = O.x - C.x, ocy = O.y - C.y;
  var b = 2 * (ocx * D.x + ocy * D.y);
  var c = ocx * ocx + ocy * ocy - r * r;
  var disc = b * b - 4 * c;
  if (disc < 0) return null;
  var sq = Math.sqrt(disc);
  var t0 = (-b - sq) / 2, t1 = (-b + sq) / 2;
  if (t0 > t1) { var tmp = t0; t0 = t1; t1 = tmp; }
  var entry = null, exit = null;
  if (t0 > minT) { entry = t0; exit = t1; }
  else if (t1 > minT) { entry = t1; exit = t1; }
  if (entry === null) return null;
  return { tEntry: entry, tExit: exit, xEntry: O.x + D.x * entry, yEntry: O.y + D.y * entry, xExit: O.x + D.x * exit, yExit: O.y + D.y * exit };
}
function lumenGetBlockerSegs(geom, level) {
  var segs = [];
  (level.walls || []).forEach(function (w) {
    var c = lumenHexPx(geom, w.q, w.r);
    lumenHexEdges(c.x, c.y, geom.hexR).forEach(function (e) { segs.push(e); });
  });
  (level.cards || []).forEach(function (cd) { segs.push(lumenCardSegment(geom, cd)); });
  return segs;
}
// A source's cylinder is solid everywhere except its narrow emission slit —
// any beam meeting the outer wall outside the slit angle stops there; a beam
// that enters via the slit but would exit into a solid section on the far
// side stops at that exit point instead.
function lumenSourceCylinderBlock(geom, O, D, src, minT) {
  var c = lumenAnchorPx(geom, src);
  var res = lumenCircleIntersect(O, D, c, geom.cylOuter, minT);
  if (!res) return null;
  var gapCenter = lumenNorm360(src.angle);
  function angleOf(px, py) { return lumenNorm360(Math.atan2(py - c.y, px - c.x) * 180 / Math.PI); }
  function inGap(ang) {
    var d = Math.abs(lumenNorm360(ang - gapCenter));
    d = Math.min(d, 360 - d);
    return d <= LUMEN_SLIT_HALF_DEG + 0.05;
  }
  var entryAngle = angleOf(res.xEntry, res.yEntry);
  if (!inGap(entryAngle)) return { t: res.tEntry, x: res.xEntry, y: res.yEntry };
  if (res.tExit > res.tEntry + 1e-6) {
    var exitAngle = angleOf(res.xExit, res.yExit);
    if (!inGap(exitAngle)) return { t: res.tExit, x: res.xExit, y: res.yExit };
  }
  return null;
}

function lumenEvaluateTarget(t, hit, intensity) {
  if (!t || !hit) return false;
  if (t.mode === "atleast") return intensity >= t.min;
  if (t.mode === "atmost") return intensity <= t.max;
  if (t.mode === "between") return intensity >= t.min && intensity <= t.max;
  if (t.mode === "exact") return Math.abs(intensity - t.value) <= t.tolerance;
  return false;
}
function lumenConditionLabel(t) {
  if (!t) return "";
  if (t.mode === "atleast") return "≥ " + lumenFmt(t.min);
  if (t.mode === "atmost") return "≤ " + lumenFmt(t.max);
  if (t.mode === "between") return lumenFmt(t.min) + "–" + lumenFmt(t.max);
  if (t.mode === "exact") return "≈ " + lumenFmt(t.value) + " ±" + lumenFmt(t.tolerance);
  return "";
}

function lumenTraceSingleBeam(geom, level, src, blockerSegs, boundary) {
  var O0 = lumenAnchorPx(geom, src);
  var O = { x: O0.x, y: O0.y };
  var D = { x: Math.cos(lumenRad(src.angle)), y: Math.sin(lumenRad(src.angle)) };
  var intensity = 1.0;
  var segments = [];
  var activated = {};
  var closeness = {};
  var hitTargetId = null, hitIntensity = 0;
  var eps = geom.eps;

  for (var bounce = 0; bounce < 60; bounce++) {
    var best = null;
    if (boundary.type === "circle") {
      // O is always inside the field circle, so lumenCircleIntersect's
      // "entry" (its first forward root) is really the far side — exactly
      // the point where the beam leaves the field.
      var bh = lumenCircleIntersect(O, D, { x: boundary.cx, y: boundary.cy }, boundary.r, eps);
      if (bh) best = { t: bh.tEntry, type: "boundary", x: bh.xEntry, y: bh.yEntry };
    } else {
      boundary.edges.forEach(function (seg) {
        var h = lumenSegIntersect(O, D, seg[0], seg[1], eps);
        if (h && (!best || h.t < best.t)) best = { t: h.t, type: "boundary", x: h.x, y: h.y };
      });
    }
    blockerSegs.forEach(function (seg) {
      var h = lumenSegIntersect(O, D, seg[0], seg[1], eps);
      if (h && (!best || h.t < best.t)) best = { t: h.t, type: "wall", x: h.x, y: h.y };
    });
    (level.sources || []).forEach(function (s) {
      var hitc = lumenSourceCylinderBlock(geom, O, D, s, eps);
      if (hitc && (!best || hitc.t < best.t)) best = { t: hitc.t, type: "wall", x: hitc.x, y: hitc.y };
    });
    (level.pieces || []).forEach(function (p) {
      if (p.type === "mirror") {
        var c = lumenAnchorPx(geom, p);
        var rA = lumenRad(p.angle);
        var A = { x: c.x + Math.cos(rA) * geom.mirrorHalf, y: c.y + Math.sin(rA) * geom.mirrorHalf };
        var B = { x: c.x - Math.cos(rA) * geom.mirrorHalf, y: c.y - Math.sin(rA) * geom.mirrorHalf };
        var h = lumenSegIntersect(O, D, A, B, eps);
        if (h && (!best || h.t < best.t)) best = { t: h.t, type: "mirror", piece: p, x: h.x, y: h.y };
      } else if (p.type === "lens") {
        var c2 = lumenAnchorPx(geom, p);
        var res = lumenCircleIntersect(O, D, c2, geom.lensR, eps);
        if (res && (!best || res.tEntry < best.t)) best = { t: res.tEntry, type: "lens", piece: p, x: res.xEntry, y: res.yEntry, exitX: res.xExit, exitY: res.yExit };
      }
    });
    (level.targets || []).forEach(function (tg) {
      var c3 = lumenAnchorPx(geom, tg);
      var res2 = lumenCircleIntersect(O, D, c3, geom.targetR, eps);
      if (res2 && (!best || res2.tEntry < best.t)) best = { t: res2.tEntry, type: "target", targetObj: tg, x: res2.xEntry, y: res2.yEntry };
    });

    if (!best) break;
    segments.push({ x1: O.x, y1: O.y, x2: best.x, y2: best.y, intensity: intensity });
    if (best.type === "boundary" || best.type === "wall") break;

    if (best.type === "mirror") {
      var p2 = best.piece;
      var rA2 = lumenRad(p2.angle);
      var lineDir = { x: Math.cos(rA2), y: Math.sin(rA2) };
      var normal = { x: -lineDir.y, y: lineDir.x };
      var dDotN = D.x * normal.x + D.y * normal.y;
      D = { x: D.x - 2 * dDotN * normal.x, y: D.y - 2 * dDotN * normal.y };
      var len = Math.hypot(D.x, D.y); D.x /= len; D.y /= len;
      O = { x: best.x + D.x * eps * 2, y: best.y + D.y * eps * 2 };
      activated[p2.id] = true;
      continue;
    }
    if (best.type === "lens") {
      var p3 = best.piece;
      var rayAngle = lumenNorm360(Math.atan2(D.y, D.x) * 180 / Math.PI) % 180;
      var lensAngle = lumenNorm360(p3.angle) % 180;
      var diff = Math.abs(rayAngle - lensAngle);
      diff = Math.min(diff, 180 - diff);
      var close = 1 - diff / 90;
      var factor = LUMEN_LENS_PENALTY + (LUMEN_LENS_BOOST - LUMEN_LENS_PENALTY) * close;
      intensity *= factor;
      segments.push({ x1: best.x, y1: best.y, x2: best.exitX, y2: best.exitY, intensity: intensity });
      closeness[p3.id] = Math.max(closeness[p3.id] || 0, close);
      if (close > 0.5) activated[p3.id] = true;
      O = { x: best.exitX + D.x * eps * 2, y: best.exitY + D.y * eps * 2 };
      continue;
    }
    if (best.type === "target") { hitTargetId = best.targetObj.id; hitIntensity = intensity; break; }
  }
  return { segments: segments, activated: activated, closeness: closeness, hitTargetId: hitTargetId, hitIntensity: hitIntensity, emitting: segments.length > 0 };
}

function lumenTraceAllBeams(geom, level) {
  // Square fields stop beams at the canvas rectangle (with a little
  // overscan overflow, same as the standalone prototype); circle fields
  // stop them at a circle inscribed in that same square, centered on the
  // stage, so the playable boundary actually matches the disk of hexes
  // drawn on screen instead of leaking out to the square canvas corners.
  var boundary = geom.fieldShape === "circle"
    ? { type: "circle", cx: geom.width / 2, cy: geom.height / 2, r: Math.min(geom.width, geom.height) / 2 }
    : {
        type: "rect", edges: [
          [{ x: 0, y: 0 }, { x: geom.width, y: 0 }],
          [{ x: geom.width, y: 0 }, { x: geom.width, y: geom.height }],
          [{ x: geom.width, y: geom.height }, { x: 0, y: geom.height }],
          [{ x: 0, y: geom.height }, { x: 0, y: 0 }]
        ]
      };
  var blockerSegs = lumenGetBlockerSegs(geom, level);

  var segments = [];
  var activated = {};
  var closeness = {};
  var targetIntensity = {};
  var targetHitAtAll = {};
  var emittingSources = {};

  (level.sources || []).forEach(function (src) {
    var r = lumenTraceSingleBeam(geom, level, src, blockerSegs, boundary);
    segments = segments.concat(r.segments);
    Object.keys(r.activated).forEach(function (id) { activated[id] = true; });
    Object.keys(r.closeness).forEach(function (id) { closeness[id] = Math.max(closeness[id] || 0, r.closeness[id]); });
    if (r.emitting) emittingSources[src.id] = true;
    if (r.hitTargetId) {
      targetIntensity[r.hitTargetId] = (targetIntensity[r.hitTargetId] || 0) + r.hitIntensity;
      targetHitAtAll[r.hitTargetId] = true;
    }
  });

  return { segments: segments, activated: activated, closeness: closeness, targetIntensity: targetIntensity, targetHitAtAll: targetHitAtAll, emittingSources: emittingSources };
}

function lumenAllTargetsSolved(level, trace) {
  var targets = level.targets || [];
  if (!targets.length) return false;
  return targets.every(function (t) {
    return lumenEvaluateTarget(t, !!trace.targetHitAtAll[t.id], trace.targetIntensity[t.id] || 0);
  });
}

function lumenBeamColor(i) {
  if (i <= 0.05) return "rgba(90,100,120,0.55)";
  var hue = Math.max(45, 205 - i * 55);
  var light = Math.min(85, 48 + i * 13);
  return "hsl(" + hue + ", 95%, " + light + "%)";
}
function lumenLerpColor(c1, c2, t) {
  var a = parseInt(c1.slice(1), 16), b = parseInt(c2.slice(1), 16);
  var ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  var br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  var r = Math.round(ar + (br - ar) * t), g = Math.round(ag + (bg - ag) * t), bl = Math.round(ab + (bb - ab) * t);
  return "rgb(" + r + "," + g + "," + bl + ")";
}
function lumenRoundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function lumenHexPathCtx(ctx, cx, cy, size) {
  var v = lumenHexVerts(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(v[0].x, v[0].y);
  for (var i = 1; i < 6; i++) ctx.lineTo(v[i].x, v[i].y);
  ctx.closePath();
}

function lumenFindNearestAnchor(geom, x, y, kindFilter) {
  var best = null, bestD = geom.hexR * 0.55;
  geom.anchors.forEach(function (a) {
    if (kindFilter && a.kind !== kindFilter) return;
    var d = Math.hypot(x - a.x, y - a.y);
    if (d < bestD) { bestD = d; best = a; }
  });
  return best;
}
function lumenFindNearestHex(geom, x, y) {
  var best = null, bestD = geom.hexR * 0.85;
  geom.hexList.forEach(function (h) {
    var d = Math.hypot(x - h.x, y - h.y);
    if (d < bestD) { bestD = d; best = h; }
  });
  return best;
}
// Player-mode piece lookup — only mirrors/lenses are player-rotatable
// (sources/targets/walls/cards are level-design elements set by the
// creator; see wireLumenPuzzleInteractions below).
function lumenFindPieceNear(geom, level, x, y) {
  var best = null, bestD = geom.hexR * 0.62;
  (level.pieces || []).forEach(function (p) {
    var c = lumenAnchorPx(geom, p);
    var d = Math.hypot(x - c.x, y - c.y);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}
// Design-mode piece lookup (used by Studio's inspector builder) — also
// considers sources, since the creator (not the player) sets their angle.
function lumenFindRotatableNear(geom, level, x, y) {
  var all = (level.sources || []).concat(level.pieces || []);
  var best = null, bestD = geom.hexR * 0.62;
  all.forEach(function (p) {
    var c = lumenAnchorPx(geom, p);
    var d = Math.hypot(x - c.x, y - c.y);
    if (d < bestD) { bestD = d; best = p; }
  });
  return best;
}
function lumenFindTargetNear(geom, level, x, y) {
  var best = null, bestD = geom.hexR * 0.62;
  (level.targets || []).forEach(function (t) {
    var c = lumenAnchorPx(geom, t);
    var d = Math.hypot(x - c.x, y - c.y);
    if (d < bestD) { bestD = d; best = t; }
  });
  return best;
}
function lumenDistToSegment(px, py, A, B) {
  var vx = B.x - A.x, vy = B.y - A.y, wx = px - A.x, wy = py - A.y;
  var len2 = vx * vx + vy * vy || 1e-9;
  var t = (wx * vx + wy * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  var cx = A.x + vx * t, cy = A.y + vy * t;
  return Math.hypot(px - cx, py - cy);
}
function lumenSegKey(seg) {
  var pts = [[Math.round(seg[0].x), Math.round(seg[0].y)], [Math.round(seg[1].x), Math.round(seg[1].y)]];
  pts.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
  return pts.map(function (p) { return p.join(","); }).join("|");
}
function lumenPointKeyFromPos(pos) { return Math.round(pos.x) + "," + Math.round(pos.y); }
function lumenSetPieceTargetAngle(p, snapped) {
  p.angle = lumenNorm360(snapped);
}

// ---- canvas drawing (shared by player + Studio design-time preview) ----
// Fills whatever path is currently on ctx (caller must ctx.beginPath()+
// trace it first) with a hard-edged diagonal ink hatch on a void ground —
// the canvas equivalent of dmDefs' SVG hatch patterns, using the exact
// clip-then-stroke-lines technique lumenDrawWalls already used for its
// (now-removed) coloured brick hatch, generalized so every Dark Maritime
// Lumen shape can share it instead of each re-deriving its own loop.
function lumenDmHatchFill(ctx, cx, cy, radius, spacing) {
  ctx.save();
  ctx.clip();
  ctx.fillStyle = DM_VOID;
  ctx.fillRect(cx - radius * 2, cy - radius * 2, radius * 4, radius * 4);
  ctx.strokeStyle = DM_INK;
  ctx.lineWidth = 1.2;
  for (var i = -radius * 2; i < radius * 3; i += spacing) {
    ctx.beginPath();
    ctx.moveTo(cx + i - radius, cy + radius);
    ctx.lineTo(cx + i + radius, cy - radius);
    ctx.stroke();
  }
  ctx.restore();
}
function lumenDrawGrid(ctx, geom, dm) {
  ctx.save();
  ctx.strokeStyle = dm ? DM_INK : "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  geom.hexList.forEach(function (h) { lumenHexPathCtx(ctx, h.x, h.y, geom.hexR * 0.96); ctx.stroke(); });
  ctx.restore();
}
function lumenDrawWalls(ctx, geom, level, dm) {
  (level.walls || []).forEach(function (w) {
    var p = lumenHexPx(geom, w.q, w.r);
    ctx.save();
    lumenHexPathCtx(ctx, p.x, p.y, geom.hexR * 0.92);
    if (dm) {
      lumenDmHatchFill(ctx, p.x, p.y, geom.hexR, 8 * geom.k);
      ctx.lineWidth = 1.4; ctx.strokeStyle = DM_INK; lumenHexPathCtx(ctx, p.x, p.y, geom.hexR * 0.92); ctx.stroke();
    } else {
      ctx.fillStyle = "#241c1c";
      ctx.fill();
      ctx.clip();
      ctx.strokeStyle = "rgba(120,70,70,0.5)";
      ctx.lineWidth = 3 * geom.k;
      for (var i = -geom.hexR * 2; i < geom.hexR * 3; i += 10 * geom.k) {
        ctx.beginPath();
        ctx.moveTo(p.x + i - geom.hexR, p.y + geom.hexR);
        ctx.lineTo(p.x + i + geom.hexR, p.y - geom.hexR);
        ctx.stroke();
      }
    }
    ctx.restore();
  });
}
function lumenDrawCards(ctx, geom, level, dm) {
  (level.cards || []).forEach(function (cd) {
    var seg = lumenCardSegment(geom, cd);
    var A = seg[0], B = seg[1];
    ctx.save();
    ctx.lineCap = "round";
    if (dm) {
      ctx.strokeStyle = DM_INK;
      ctx.lineWidth = 6 * geom.k;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.strokeStyle = DM_VOID;
      ctx.lineWidth = 2 * geom.k;
      ctx.setLineDash([5 * geom.k, 4 * geom.k]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    } else {
      ctx.strokeStyle = "#2a1e1e";
      ctx.lineWidth = 9 * geom.k;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      ctx.strokeStyle = "rgba(168,106,106,0.75)";
      ctx.lineWidth = 3 * geom.k;
      ctx.setLineDash([6 * geom.k, 4 * geom.k]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    }
    ctx.restore();
  });
}
function lumenDrawBeam(ctx, segments, dm) {
  ctx.save();
  ctx.lineCap = "round";
  if (dm) {
    // No glow/shadow — a solid ink beam, its width still carrying the
    // intensity signal, with a thin void centre-line rather than a
    // colour-coded halo.
    segments.forEach(function (s) {
      var w = Math.min(4 + s.intensity * 4, 18);
      ctx.strokeStyle = DM_INK;
      ctx.lineWidth = w;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    });
    segments.forEach(function (s) {
      ctx.strokeStyle = DM_VOID;
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    });
  } else {
    segments.forEach(function (s) {
      var w = Math.min(4 + s.intensity * 4, 20);
      ctx.strokeStyle = lumenBeamColor(s.intensity);
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = w * 2.4;
      ctx.shadowColor = lumenBeamColor(s.intensity);
      ctx.shadowBlur = 18 + s.intensity * 8;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    });
    segments.forEach(function (s) {
      var w = Math.min(3 + s.intensity * 3, 12);
      ctx.strokeStyle = lumenBeamColor(s.intensity);
      ctx.globalAlpha = 0.95;
      ctx.lineWidth = w;
      ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
    });
  }
  ctx.restore();
}
function lumenDrawSourceCylinder(ctx, geom, src, emitting, selected, dm) {
  var pos = lumenAnchorPx(geom, src);
  var x = pos.x, y = pos.y;
  var pulse = 1 + Math.sin(Date.now() / 260) * 0.08;
  ctx.save();
  ctx.translate(x, y);
  if (dm) {
    ctx.fillStyle = emitting ? DM_INK : DM_VOID;
    ctx.strokeStyle = DM_INK; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = DM_VOID;
    ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();

    var adm = lumenRad(src.angle);
    var gapStartDm = adm - lumenRad(LUMEN_SLIT_HALF_DEG);
    var gapEndDm = adm + lumenRad(LUMEN_SLIT_HALF_DEG);
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, geom.cylOuter, gapEndDm, gapStartDm + Math.PI * 2);
    ctx.arc(0, 0, geom.cylInner, gapStartDm + Math.PI * 2, gapEndDm, true);
    ctx.closePath();
    lumenDmHatchFill(ctx, 0, 0, geom.cylOuter, 7 * geom.k);
    ctx.lineWidth = 1.4; ctx.strokeStyle = DM_INK; ctx.stroke();
    ctx.restore();

    if (emitting) {
      ctx.save();
      ctx.rotate(adm);
      ctx.strokeStyle = DM_INK; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(-lumenRad(LUMEN_SLIT_HALF_DEG)) * (geom.cylOuter + 8), Math.sin(-lumenRad(LUMEN_SLIT_HALF_DEG)) * (geom.cylOuter + 8));
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(lumenRad(LUMEN_SLIT_HALF_DEG)) * (geom.cylOuter + 8), Math.sin(lumenRad(LUMEN_SLIT_HALF_DEG)) * (geom.cylOuter + 8));
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
    return;
  }
  ctx.shadowColor = "#ffd27f";
  ctx.shadowBlur = 20;
  var grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 11 * pulse);
  grad.addColorStop(0, "#ffffff"); grad.addColorStop(0.5, "#ffe6b0"); grad.addColorStop(1, "rgba(255,210,127,0)");
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(0, 0, 11 * pulse, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#fff8e8";
  ctx.beginPath(); ctx.arc(0, 0, 5, 0, Math.PI * 2); ctx.fill();

  var a = lumenRad(src.angle);
  var gapStart = a - lumenRad(LUMEN_SLIT_HALF_DEG);
  var gapEnd = a + lumenRad(LUMEN_SLIT_HALF_DEG);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, geom.cylOuter, gapEnd, gapStart + Math.PI * 2);
  ctx.arc(0, 0, geom.cylInner, gapStart + Math.PI * 2, gapEnd, true);
  ctx.closePath();
  var wallGrad = ctx.createLinearGradient(-geom.cylOuter, -geom.cylOuter, geom.cylOuter, geom.cylOuter);
  wallGrad.addColorStop(0, "#5a6784"); wallGrad.addColorStop(0.5, "#9aa8c8"); wallGrad.addColorStop(1, "#3f4a66");
  ctx.fillStyle = wallGrad;
  ctx.shadowColor = "rgba(160,180,220,0.4)";
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.restore();

  if (emitting) {
    ctx.save();
    ctx.rotate(a);
    var spillGrad = ctx.createRadialGradient(0, 0, geom.cylInner, 0, 0, geom.cylOuter + 8);
    spillGrad.addColorStop(0, "rgba(255,230,176,0.85)"); spillGrad.addColorStop(1, "rgba(255,230,176,0)");
    ctx.fillStyle = spillGrad;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, geom.cylOuter + 8, -lumenRad(LUMEN_SLIT_HALF_DEG), lumenRad(LUMEN_SLIT_HALF_DEG));
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
}
function lumenDrawTarget(ctx, geom, t, hit, intensity, selected, dm) {
  var pos = lumenAnchorPx(geom, t);
  var x = pos.x, y = pos.y;
  var solved = lumenEvaluateTarget(t, hit, intensity);
  if (dm) {
    // No colour-coded glow — state reads from fill density instead: an
    // empty hairline hex (unhit), a hatched hex (hit but not yet solved),
    // a solid ink hex (solved) — same "depth via line density, not colour"
    // rule as every other Dark Maritime illustration.
    ctx.save();
    lumenHexPathCtx(ctx, x, y, geom.targetR * 1.25);
    if (solved) { ctx.fillStyle = DM_INK; ctx.fill(); }
    else if (hit) { lumenDmHatchFill(ctx, x, y, geom.targetR * 1.25, 6 * geom.k); }
    ctx.lineWidth = 1.4; ctx.strokeStyle = DM_INK;
    lumenHexPathCtx(ctx, x, y, geom.targetR * 1.25); ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = DM_INK;
    ctx.font = (9 * geom.k) + "px Georgia, 'Times New Roman', serif";
    ctx.textAlign = "center";
    ctx.fillText(lumenConditionLabel(t), x, y + geom.hexR * 0.9);
    ctx.restore();
    if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
    return;
  }
  var color, glow;
  if (solved) { color = "#6bffb0"; glow = "#6bffb0"; }
  else if (hit) { color = "#ff9f4a"; glow = "#ff9f4a"; }
  else { color = "#3a4568"; glow = "transparent"; }
  var pulse = solved ? (1 + Math.sin(Date.now() / 200) * 0.12) : 1;

  ctx.save();
  ctx.shadowColor = glow;
  ctx.shadowBlur = (solved ? 28 : (hit ? 14 : 0));
  lumenHexPathCtx(ctx, x, y, (geom.targetR * 1.25) * pulse);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = (9 * geom.k) + "px Segoe UI, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(lumenConditionLabel(t), x, y + geom.hexR * 0.9);
  ctx.restore();
  if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
}
function lumenDrawMirror(ctx, geom, p, active, selected, dm) {
  var pos = lumenAnchorPx(geom, p);
  var x = pos.x, y = pos.y;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lumenRad(p.angle));
  var len = geom.mirrorHalf * 2, w = 8 * geom.k;
  if (dm) {
    lumenRoundRectPath(ctx, -len / 2, -w / 2, len, w, 4 * geom.k);
    ctx.fillStyle = active ? DM_INK : DM_VOID;
    ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = DM_INK;
    lumenRoundRectPath(ctx, -len / 2, -w / 2, len, w, 4 * geom.k); ctx.stroke();
    ctx.restore();
    if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
    return;
  }
  ctx.shadowColor = active ? "#bfeaff" : "transparent";
  ctx.shadowBlur = active ? 22 : 0;
  var grad = ctx.createLinearGradient(-len / 2, 0, len / 2, 0);
  grad.addColorStop(0, "#7f8ba8"); grad.addColorStop(0.5, active ? "#eaf7ff" : "#cfd8e8"); grad.addColorStop(1, "#7f8ba8");
  ctx.fillStyle = grad;
  lumenRoundRectPath(ctx, -len / 2, -w / 2, len, w, 4 * geom.k);
  ctx.fill();
  ctx.restore();
  if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
}
function lumenDrawLens(ctx, geom, p, active, close, selected, dm) {
  var pos = lumenAnchorPx(geom, p);
  var x = pos.x, y = pos.y;
  var t = active ? close : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lumenRad(p.angle));
  if (dm) {
    ctx.beginPath();
    ctx.ellipse(0, 0, geom.hexR * 0.22, geom.hexR * 0.42, 0, 0, Math.PI * 2);
    // Canvas paths can't reference the SVG pattern library, so "how close
    // to a correct fit" is signalled by solid-ink-or-not instead of a
    // hatch density step — same "density/solidity signals state" idiom as
    // the target hexes above, just binary rather than three-way.
    ctx.fillStyle = (active && close > 0.6) ? DM_INK : DM_VOID;
    ctx.fill();
    ctx.lineWidth = 1.4; ctx.strokeStyle = DM_INK;
    ctx.beginPath(); ctx.ellipse(0, 0, geom.hexR * 0.22, geom.hexR * 0.42, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -geom.hexR * 0.42); ctx.lineTo(0, geom.hexR * 0.42); ctx.stroke();
    ctx.restore();
    if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
    return;
  }
  ctx.shadowColor = active ? lumenLerpColor("#4a90c2", "#ffbf5c", t) : "transparent";
  ctx.shadowBlur = active ? (8 + t * 26) : 0;
  var grad = ctx.createLinearGradient(0, -geom.hexR * 0.42, 0, geom.hexR * 0.42);
  grad.addColorStop(0, lumenLerpColor("#bfeaff", "#fff3d6", t));
  grad.addColorStop(1, lumenLerpColor("#4a90c2", "#ffbf5c", t));
  ctx.fillStyle = grad;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.ellipse(0, 0, geom.hexR * 0.22, geom.hexR * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2 * geom.k;
  ctx.beginPath(); ctx.moveTo(0, -geom.hexR * 0.42); ctx.lineTo(0, geom.hexR * 0.42); ctx.stroke();
  ctx.restore();
  if (selected) lumenDrawSelectionRing(ctx, geom, x, y, dm);
}
function lumenDrawSelectionRing(ctx, geom, x, y, dm) {
  ctx.save();
  ctx.strokeStyle = dm ? DM_INK : "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5 * geom.k;
  ctx.setLineDash([3 * geom.k, 3 * geom.k]);
  ctx.beginPath(); ctx.arc(x, y, geom.hexR * 0.7, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

// Full-scene render — draws grid/walls/cards/beams/pieces/sources/targets
// in the right back-to-front order, then returns the trace (so callers can
// drive a target-status readout off the same pass). `selectedId`, if given,
// draws a dashed selection ring on whichever source/piece/target has that
// id (used by Studio's design-time builder; the player screen passes null).
function lumenRenderScene(ctx, geom, level, selectedId, dm) {
  ctx.clearRect(0, 0, geom.width, geom.height);
  lumenDrawGrid(ctx, geom, dm);
  lumenDrawWalls(ctx, geom, level, dm);
  lumenDrawCards(ctx, geom, level, dm);
  var trace = lumenTraceAllBeams(geom, level);
  lumenDrawBeam(ctx, trace.segments, dm);
  (level.pieces || []).forEach(function (p) {
    var active = !!trace.activated[p.id];
    if (p.type === "mirror") lumenDrawMirror(ctx, geom, p, active, selectedId === p.id, dm);
    else lumenDrawLens(ctx, geom, p, active, trace.closeness[p.id] || 0, selectedId === p.id, dm);
  });
  (level.sources || []).forEach(function (s) {
    lumenDrawSourceCylinder(ctx, geom, s, !!trace.emittingSources[s.id], selectedId === s.id, dm);
  });
  (level.targets || []).forEach(function (t) {
    var hit = !!trace.targetHitAtAll[t.id];
    var intensity = trace.targetIntensity[t.id] || 0;
    lumenDrawTarget(ctx, geom, t, hit, intensity, selectedId === t.id, dm);
  });
  return trace;
}

// Player-runtime interaction — locates its canvas (a no-op if a different
// node type is currently on screen, same guard style as
// wireRopeTyingInteractions above), draws the current beam trace, and wires
// pointer drag-rotate + tap-to-nudge on mirrors/lenses only — sources,
// targets, walls and cards are level-design elements set by the creator
// (Studio's inspector builder, see app.js), not player-interactive. Live
// piece angles are tracked in ctl.lumenDraft[n.id] (a deep-cloned copy of
// content.sources/pieces so dragging never mutates the hunt itself), and
// geometry (which only depends on content.gridSize) is memoized in
// ctl.lumenGeom[n.id] across re-renders. Every drag/tap redraws the canvas
// directly and re-checks target conditions — no requestAnimationFrame loop,
// since the canvas element itself is torn down and rebuilt by the
// surrounding ctl.render() innerHTML swap on any state change other than a
// piece rotation.
function wireLumenPuzzleInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-lumen-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var canvas = wrap.querySelector(".pv-lumen-canvas");
  var toastEl = wrap.querySelector(".pv-lumen-toast");
  var summaryEl = root.querySelector('.pv-lumen-summary[data-node="' + n.id + '"]');
  var c = n.content;

  ctl.lumenGeom = ctl.lumenGeom || {};
  if (!ctl.lumenGeom[n.id]) ctl.lumenGeom[n.id] = lumenComputeGeometry(c.gridSize, c.fieldShape);
  var geom = ctl.lumenGeom[n.id];

  ctl.lumenDraft = ctl.lumenDraft || {};
  if (!ctl.lumenDraft[n.id]) {
    ctl.lumenDraft[n.id] = {
      sources: clone(c.sources || []),
      pieces: clone(c.pieces || []),
      targets: c.targets || [],
      walls: c.walls || [],
      cards: c.cards || []
    };
  }
  var level = ctl.lumenDraft[n.id];

  canvas.width = geom.width;
  canvas.height = geom.height;
  var ctx = canvas.getContext("2d");

  var activePiece = null, dragMoved = false, dragStartClient = null, hoverPiece = null;
  var lastSolved = false;
  var locked = !!session.state.completed[n.id];

  function updateSummary(trace) {
    var targets = level.targets || [];
    if (!(level.sources || []).length) { if (summaryEl) summaryEl.textContent = "No light source placed"; return false; }
    if (!targets.length) { if (summaryEl) summaryEl.textContent = "No target placed"; return false; }
    var solvedCount = 0;
    targets.forEach(function (t) {
      if (lumenEvaluateTarget(t, !!trace.targetHitAtAll[t.id], trace.targetIntensity[t.id] || 0)) solvedCount++;
    });
    if (summaryEl) summaryEl.textContent = solvedCount + " of " + targets.length + " target" + (targets.length > 1 ? "s" : "") + " solved";
    return solvedCount === targets.length;
  }

  function redraw() {
    var trace = lumenRenderScene(ctx, geom, level, null, isDarkMaritime(c));
    var allSolved = updateSummary(trace);
    if (toastEl) toastEl.classList.toggle("show", !!allSolved);
    if (allSolved && !lastSolved && !locked) {
      var ok = pv_action_submitLumenPuzzle(session, n.id, true);
      if (ok) {
        lastSolved = true; locked = true;
        setTimeout(function () { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); }, 600);
        return;
      }
    }
    lastSolved = !!allSolved;
  }

  function canvasCoords(evt) {
    var rect = canvas.getBoundingClientRect();
    var scaleX = canvas.width / rect.width, scaleY = canvas.height / rect.height;
    return { x: (evt.clientX - rect.left) * scaleX, y: (evt.clientY - rect.top) * scaleY };
  }

  if (locked) { redraw(); return; } // read-only — draw once, no interaction wiring

  canvas.onpointerdown = function (evt) {
    var pos = canvasCoords(evt);
    var p = lumenFindPieceNear(geom, level, pos.x, pos.y);
    if (!p) return;
    activePiece = p; dragMoved = false;
    dragStartClient = { x: evt.clientX, y: evt.clientY };
    try { canvas.setPointerCapture(evt.pointerId); } catch (e) {}
    evt.preventDefault();
  };
  canvas.onpointermove = function (evt) {
    if (!activePiece) {
      var pos0 = canvasCoords(evt);
      hoverPiece = lumenFindPieceNear(geom, level, pos0.x, pos0.y);
      canvas.style.cursor = hoverPiece ? "grab" : "default";
      return;
    }
    var pos = canvasCoords(evt);
    var moveDist = Math.hypot(evt.clientX - dragStartClient.x, evt.clientY - dragStartClient.y);
    if (moveDist > 3) dragMoved = true;
    var center = lumenAnchorPx(geom, activePiece);
    var rawAngle = lumenNorm360(Math.atan2(pos.y - center.y, pos.x - center.x) * 180 / Math.PI);
    var snapped = Math.round(rawAngle / 15) * 15 % 360;
    lumenSetPieceTargetAngle(activePiece, snapped);
    canvas.style.cursor = "grabbing";
    redraw();
  };
  function endDrag() {
    if (activePiece && !dragMoved) {
      lumenSetPieceTargetAngle(activePiece, activePiece.angle + 15);
      redraw();
    }
    activePiece = null;
    canvas.style.cursor = hoverPiece ? "grab" : "default";
  }
  canvas.onpointerup = endDrag;
  canvas.onpointercancel = endDrag;

  redraw();
}

// Draws an already-completed Lumen Puzzle node's board with no interaction
// wiring — used when Studio's "pinned node" preview (a canvas click / Story
// tab jump, see renderPinnedNode below) shows a node that's already been
// solved, a path that skips wirePreviewNodeInteractions entirely (to avoid
// re-triggering completion effects) and so would otherwise leave the canvas
// blank, unlike the string-rendered node types where the read-only markup
// is already complete the moment it's assigned via innerHTML. Prefers the
// player's own last-seen piece angles (ctl.lumenDraft, if this puzzle was
// actually played this session) over the raw designed content, so a solved
// board is shown the way the player left it rather than back at its
// original unsolved layout.
function lumenDrawReadOnly(ctl, n) {
  var root = ctl.mainEl;
  var wrap = root.querySelector('.pv-lumen-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var canvas = wrap.querySelector(".pv-lumen-canvas");
  var c = n.content;
  ctl.lumenGeom = ctl.lumenGeom || {};
  if (!ctl.lumenGeom[n.id]) ctl.lumenGeom[n.id] = lumenComputeGeometry(c.gridSize, c.fieldShape);
  var geom = ctl.lumenGeom[n.id];
  var level = (ctl.lumenDraft && ctl.lumenDraft[n.id]) || { sources: c.sources || [], pieces: c.pieces || [], targets: c.targets || [], walls: c.walls || [], cards: c.cards || [] };
  canvas.width = geom.width; canvas.height = geom.height;
  lumenRenderScene(canvas.getContext("2d"), geom, level, null, isDarkMaritime(c));
  var summaryEl = root.querySelector('.pv-lumen-summary[data-node="' + n.id + '"]');
  if (summaryEl) summaryEl.textContent = (level.targets || []).length + " of " + (level.targets || []).length + " target(s) solved";
}

// Control Panel Builder — player-side interaction wiring: click toggles a
// switch/push button, drag sets a slider or rotates a knob. Every
// interaction recomputes conditional components' outputs (lights/gauges/
// digital displays) and re-renders just the affected `[data-compid]`
// elements' inner markup in place (see redraw below) rather than a full
// ctl.render(), the same "cheap live redraw, full re-render only on
// completion" shape as wireLumenPuzzleInteractions' canvas redraw — a full
// re-render mid-drag would tear down the very element capturing the
// pointer. Only calls pv_action_submitControlPanel once every win
// condition is simultaneously met (never with a false mechanicOk), same as
// wireGearPulleyInteractions' `if (sv.solved)` gate.
function wireControlPanelInteractions(root, ctl, session, n) {
  var wrap = root.querySelector('.pv-ctp-wrap[data-node="' + n.id + '"]');
  if (!wrap) return;
  var c = n.content;
  ctl.controlPanelDraft = ctl.controlPanelDraft || {};
  var values = ctl.controlPanelDraft[n.id];
  if (!values) return;
  var locked = !!session.state.completed[n.id];
  if (locked) return; // read-only — the markup rendered above already reflects final state

  function compById(id) { return (c.components || []).find(function (x) { return x.id === id; }); }

  function redraw() {
    var outputs = ctpComputeOutputs(c, values);
    Array.prototype.forEach.call(wrap.querySelectorAll("[data-compid]"), function (el) {
      var comp = compById(el.dataset.compid);
      if (!comp) return;
      el.innerHTML = ctpComponentInnerHtml(comp, ctpResolvedValue(comp, values, outputs));
    });
    if (!locked && ctpWinConditionsMet(c.winConditions, values)) {
      var ok = pv_action_submitControlPanel(session, n.id, values);
      if (ok) {
        locked = true;
        setTimeout(function () { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; ctl.render(); }, 700);
      }
    }
  }

  Array.prototype.forEach.call(wrap.querySelectorAll(".ctp-comp-interactive"), function (el) {
    var comp = compById(el.dataset.compid);
    if (!comp) return;
    var kind = ctpComponentKind(comp.type);

    if (kind === "boolean") {
      var toggle = function () { values[comp.id] = values[comp.id] ? 0 : 1; redraw(); };
      el.tabIndex = 0;
      el.setAttribute("role", "switch");
      el.onclick = toggle;
      el.onkeydown = function (e) { if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") { e.preventDefault(); toggle(); } };
      return;
    }

    if (comp.type === "vSlider" || comp.type === "hSlider") {
      var min = Number(comp.data.min) || 0, max = Number(comp.data.max) || 10, step = Number(comp.data.step) || 1;
      var vertical = comp.type === "vSlider";
      var dragging = false;
      var setFromEvent = function (evt) {
        var rect = el.getBoundingClientRect();
        var pct = vertical ? 1 - (evt.clientY - rect.top) / rect.height : (evt.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        var raw = min + pct * (max - min);
        var stepped = step > 0 ? Math.round(raw / step) * step : raw;
        values[comp.id] = Math.max(min, Math.min(max, stepped));
        redraw();
      };
      el.onpointerdown = function (evt) { dragging = true; try { el.setPointerCapture(evt.pointerId); } catch (e) {} setFromEvent(evt); };
      el.onpointermove = function (evt) { if (dragging) setFromEvent(evt); };
      el.onpointerup = function () { dragging = false; };
      el.onpointercancel = function () { dragging = false; };
      return;
    }

    // Rotary knobs — indexed (snap to one of N points over the knob's arc)
    // or continuous (the full-rotation knob, 0-359°).
    var isFull = comp.type === "knobFull";
    var arc = ctpKnobArc(comp.type);
    var points = isFull ? null : Math.max(2, Number(comp.data.points) || 5);
    var dragging2 = false;
    var angleFromEvent = function (evt) {
      var rect = el.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      return Math.atan2(evt.clientX - cx, -(evt.clientY - cy)) * 180 / Math.PI; // 0° = up, clockwise positive
    };
    var setFromEvent2 = function (evt) {
      var a = angleFromEvent(evt);
      if (isFull) {
        values[comp.id] = ((a % 360) + 360) % 360;
      } else {
        a = Math.max(-arc / 2, Math.min(arc / 2, a));
        var idx = points > 1 ? Math.round((a + arc / 2) / (arc / (points - 1))) : 0;
        values[comp.id] = Math.max(0, Math.min(points - 1, idx));
      }
      redraw();
    };
    el.onpointerdown = function (evt) { dragging2 = true; try { el.setPointerCapture(evt.pointerId); } catch (e) {} setFromEvent2(evt); };
    el.onpointermove = function (evt) { if (dragging2) setFromEvent2(evt); };
    el.onpointerup = function () { dragging2 = false; };
    el.onpointercancel = function () { dragging2 = false; };
  });

  redraw();
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

  // Geolocation Check-in — talks to the real browser Geolocation API, then
  // hands the coordinates it got back to pv_action_submitGeoCheckIn (engine
  // math only, see above) for the actual within-radius check. ctl.geoStatus
  // just tracks which message renderPreviewNode's "geolocationCheckIn"
  // branch should show while a request is in flight/denied/unsupported —
  // it's re-read fresh on every ctl.render(), never assumed still current.
  if (byId("pvGeoCheck")) {
    byId("pvGeoCheck").onclick = function () {
      if (!navigator.geolocation) {
        ctl.geoStatus[n.id] = "unsupported";
        ctl.render();
        return;
      }
      ctl.geoStatus[n.id] = "locating";
      ctl.render();
      navigator.geolocation.getCurrentPosition(function (pos) {
        ctl.geoStatus[n.id] = "checked";
        var ok = pv_action_submitGeoCheckIn(session, n.id, pos.coords.latitude, pos.coords.longitude);
        if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
        ctl.render();
      }, function () {
        ctl.geoStatus[n.id] = "denied";
        ctl.render();
      }, { enableHighAccuracy: true, timeout: 15000 });
    };
  }
  if (byId("pvGeoSimulate")) {
    byId("pvGeoSimulate").onclick = function () {
      var ok = pv_action_submitGeoCheckIn(session, n.id, Number(n.content.lat) || 0, Number(n.content.lng) || 0);
      ctl.geoStatus[n.id] = "checked";
      if (ok) { ctl.expandedNodeId = null; ctl.pinnedNodeId = null; }
      ctl.render();
    };
  }

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
  // Gated by type — Video Reveal and Video Story render the exact same
  // #pvVideoEl/#pvVideoToggle ids, so calling both unconditionally would
  // double-wire whichever one is actually on screen.
  if (n.type === "videoReveal") wireVideoRevealPlayback(root, n.content);
  if (n.type === "videoStory") wireVideoStoryPlayback(root, ctl, session, n);
  wireRopeTyingInteractions(root, ctl, session, n);
  wireLumenPuzzleInteractions(root, ctl, session, n);
  wireGearPulleyInteractions(root, ctl, session, n);
  wireWeightScaleInteractions(root, ctl, session, n);
  wireControlPanelInteractions(root, ctl, session, n);
  wireCategoryGridInteractions(root, ctl, session, n);
  wireConstraintSatisfactionInteractions(root, ctl, session, n);
  wireCellPhoneInteractions(root, ctl, session, n);
  wireLockAndKeyInteractions(root, ctl, session, n);

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
  // Lumen Puzzle's board is drawn imperatively onto a <canvas> rather than
  // built as innerHTML markup (see wireLumenPuzzleInteractions above), so a
  // completed node shown here still needs one draw call even though its
  // interaction wiring is skipped, or the canvas would be left blank.
  else if (n.type === "lumenPuzzle") lumenDrawReadOnly(ctl, n);
  ctl._activeIds = { expandedId: n.id, leadIds: openLeadNodes(session).map(function (x) { return x.id; }) };
}

function createPreviewController(mainEl, sideEl) {
  var ctl = {
    mainEl: mainEl, sideEl: sideEl,
    session: null, expandedNodeId: null, showState: false,
    orderingDraft: {}, matchingDraft: {},
    sequenceDraft: {}, tileDraft: {}, multiPartDraft: {}, lockDialDraft: {}, cryptexDraft: {}, fuseDraft: {}, ropeDraft: {},
    lumenDraft: {}, lumenGeom: {}, // lumenDraft: node id -> live {sources,pieces,targets,walls,cards} the player rotates; lumenGeom: node id -> memoized hex geometry (see wireLumenPuzzleInteractions)
    categoryGridDraft: {}, categoryGridReveal: {}, // categoryGridDraft: node id -> live {cells[9], gallery[], selected}; categoryGridReveal: node id -> {phase:"rows"|"cols", cellIds, names} while the completion graphic plays (see wireCategoryGridInteractions)
    gearDraft: {}, // node id -> live {tiles:[{id,teeth}], placements: axleId -> tileId, selectedTileId} (see gpInitDraft/wireGearPulleyInteractions)
    wsDraft: {}, // node id -> live {order:[itemId,...], placements: itemId -> "tray"|"left"|"right", selectedId} (see wsInitDraft/wireWeightScaleInteractions)
    controlPanelDraft: {}, // node id -> live componentId -> current value (boolean 0/1, knob point index, or numeric) for every interactive component (see ctpDefaultValuesById/wireControlPanelInteractions)
    cspDraft: {}, // node id -> live {mode:"info"|"answer", alloc: recipientId -> itemId -> count} (see renderPreviewNode's "constraintSatisfaction" branch / wireConstraintSatisfactionInteractions)
    pdfPageDraft: {}, pdfEnterAnim: {}, // pdfPageDraft: node id -> current page number; pdfEnterAnim: node id -> one-shot entrance-animation class for the page that just turned in (see wirePdfReveal/renderPdfRevealBlock)
    phoneNav: {}, // node id -> Cell Phone screen-stack/dial/focus state (see cpNav above and wireCellPhoneInteractions below) — volatile like every other *Draft map here, never persisted to session.state
    lockAndKeyDraft: {}, // node id -> live {index, busy} — which key on the ring is currently at the front, and whether a tap animation is mid-flight (see renderPreviewNode's "lockAndKey" branch / wireLockAndKeyInteractions)
    geoStatus: {}, // node id -> "idle" | "locating" | "denied" | "unsupported" | "checked", set by wirePreviewNodeInteractions' "geolocationCheckIn" branch as it talks to navigator.geolocation (see renderPreviewNode's matching branch, which only ever reads this)
    previewOnly: true, // both of Studio's controllers (Preview and the canvas's LiveMock — see app.js) are previews, never a deployed player; lets renderPreviewNode offer preview-only affordances like Geolocation Check-in's "simulate arrival" button
    pinnedFromLane: null, // {laneId, sceneId} when the currently-pinned node was opened by tapping it in a lane-list view (e.g. Inventory) rather than jumped to from the canvas — drives the "← Back to …" control in ctl.render()'s pinned branch, see showLaneList/showNode below
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
    ctl.ropeDraft = {};
    ctl.lumenDraft = {};
    ctl.lumenGeom = {};
    ctl.categoryGridDraft = {};
    ctl.categoryGridReveal = {};
    ctl.gearDraft = {};
    ctl.wsDraft = {};
    ctl.cspDraft = {};
    ctl.lockAndKeyDraft = {};
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
    ctl.pinnedFromLane = null; // reset here; a lane-list [data-lead] click (see ctl.render() below) sets it right back afterwards, so any other path to showNode (e.g. a canvas click) doesn't leave a stale "← Back to …" control showing
    var node = ctl.session && ctl.session.hunt.nodes.find(function (n) { return n.id === nodeId; });
    if (node) ctl.currentLane = node.lane;
    ctl.render();
  };
  // Force the view to show every currently-available option in one lane
  // × scene cell (Leads/Inventory/Hints tab bar taps) instead of jumping
  // straight into a single node.
  ctl.showLaneList = function (laneId, sceneId) { ctl.laneListId = laneId; ctl.laneListSceneId = sceneId || null; ctl.pinnedNodeId = null; ctl.pinnedFromLane = null; ctl.currentLane = laneId; ctl.render(); };
  ctl.clearPin = function () { if (ctl.pinnedNodeId || ctl.laneListId) { ctl.pinnedNodeId = null; ctl.laneListId = null; ctl.pinnedFromLane = null; ctl.render(); } };

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
      // A node opened by tapping it in a lane list (e.g. a Cell Phone or
      // other explorable node sitting in the Inventory lane — see the
      // "inventory" branch of renderLaneOptionsList above) gets a small
      // "← Back to …" control prepended above its own content, so there's
      // always an obvious way back to that list even for node types like
      // Cell Phone that have no showBackButton/Continue of their own.
      // Leads/Hints-adjacent nodes reached the same way get it too.
      if (ctl.pinnedFromLane) {
        var pfl = ctl.pinnedFromLane;
        var laneBackLabel = LANE_LIST_TITLES[pfl.laneId] || "list";
        main.innerHTML = '<button type="button" class="pv-choice-btn pv-lane-back-btn" id="pvLaneBackBtn">← Back to ' + esc(laneBackLabel) + '</button>' + main.innerHTML;
        var laneBackBtn = main.querySelector("#pvLaneBackBtn");
        if (laneBackBtn) laneBackBtn.onclick = function () { ctl.showLaneList(pfl.laneId, pfl.sceneId); };
      }
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
      var laneNodes = ctl.laneListId === "inventory" ? globalInventoryItems(session) : laneOptionsForScene(session, ctl.laneListId, ctl.laneListSceneId);
      main.innerHTML = renderLaneOptionsList(session, ctl.laneListId, laneNodes);
      wireHintButtons(session, main, ctl);
      Array.prototype.forEach.call(main.querySelectorAll("[data-lead]"), function (el) {
        el.onclick = function () {
          var fromLane = { laneId: ctl.laneListId, sceneId: ctl.laneListSceneId };
          ctl.showNode(el.dataset.lead); // resets ctl.pinnedFromLane to null internally
          ctl.pinnedFromLane = fromLane;
          ctl.render();
        };
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
  APPEARANCES: APPEARANCES,
  nodeAppearance: nodeAppearance,
  isDarkMaritime: isDarkMaritime,
  lockAndKeySupplyConnection: lockAndKeySupplyConnection,
  lockAndKeyOptions: lockAndKeyOptions,

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
  duplicateNode: duplicateNode,

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
  pv_action_submitGeoCheckIn: pv_action_submitGeoCheckIn,
  geoDistanceMeters: geoDistanceMeters,
  pv_action_submitSequence: pv_action_submitSequence,
  pv_action_submitSlidingTile: pv_action_submitSlidingTile,
  pv_action_submitMultiPartAnswer: pv_action_submitMultiPartAnswer,
  pv_action_submitLockCode: pv_action_submitLockCode,
  pv_action_submitCrossReferenceAnswer: pv_action_submitCrossReferenceAnswer,
  pv_action_submitFusePanel: pv_action_submitFusePanel,
  pv_action_submitRopeTying: pv_action_submitRopeTying,
  pv_action_submitLumenPuzzle: pv_action_submitLumenPuzzle,
  pv_action_submitGearPulley: pv_action_submitGearPulley,
  pv_action_submitWeightScale: pv_action_submitWeightScale,
  pv_action_submitControlPanel: pv_action_submitControlPanel,
  pv_action_submitCategoryGrid: pv_action_submitCategoryGrid,
  pv_action_submitConstraintSatisfaction: pv_action_submitConstraintSatisfaction,
  pv_action_revealHint: pv_action_revealHint,

  // Category Grid (3x3 image puzzle) — grouping/validation/solution-check
  // math, shared between the player runtime (above) and Studio's
  // inspector-embedded category builder (buildTypeSpecificFields/
  // wireNodeInspector's "categoryGrid" case in app.js).
  caGridGroups: caGridGroups,
  caGridGroupIndexMap: caGridGroupIndexMap,
  caGridValidate: caGridValidate,
  caGridCheckSolution: caGridCheckSolution,
  caGridSolvedCategoryNames: caGridSolvedCategoryNames,
  caGridPieceHtml: caGridPieceHtml,

  // Constraint Satisfaction Puzzle — pool-size math shared between the
  // player runtime (above) and Studio's inspector-embedded builder pane
  // (buildConstraintSatisfactionFields/wireConstraintSatisfactionFields in
  // app.js).
  cspItemTotal: cspItemTotal,
  cspItemRemaining: cspItemRemaining,
  cspLayoutScale: cspLayoutScale,

  // Lumen Puzzle — hex geometry/beam-tracing math and canvas drawing,
  // shared between the player runtime (above) and Studio's inspector-
  // embedded level designer (buildTypeSpecificFields/wireNodeInspector's
  // "lumenPuzzle" case in app.js).
  lumenComputeGeometry: lumenComputeGeometry,
  lumenHexPx: lumenHexPx,
  lumenAnchorPx: lumenAnchorPx,
  lumenCardSegment: lumenCardSegment,
  lumenTraceAllBeams: lumenTraceAllBeams,
  lumenAllTargetsSolved: lumenAllTargetsSolved,
  lumenEvaluateTarget: lumenEvaluateTarget,
  lumenConditionLabel: lumenConditionLabel,
  lumenRenderScene: lumenRenderScene,
  lumenFindNearestAnchor: lumenFindNearestAnchor,
  lumenFindNearestHex: lumenFindNearestHex,
  lumenFindRotatableNear: lumenFindRotatableNear,
  lumenFindTargetNear: lumenFindTargetNear,
  lumenDistToSegment: lumenDistToSegment,
  lumenSegKey: lumenSegKey,
  lumenPointKeyFromPos: lumenPointKeyFromPos,
  lumenSetPieceTargetAngle: lumenSetPieceTargetAngle,
  lumenNorm360: lumenNorm360,

  // Gear & Pulley Builder — mesh-graph geometry/solve-check math, shared
  // between the player runtime (above) and Studio's inspector-embedded
  // designer (buildTypeSpecificFields/wireNodeInspector's "gearPulley" case
  // in app.js).
  GP_TEETH_MIN: GP_TEETH_MIN, GP_TEETH_MAX: GP_TEETH_MAX, GP_TEETH_DEFAULT: GP_TEETH_DEFAULT,
  GP_MAX_AXLES: GP_MAX_AXLES, GP_SNAP_RANGE: GP_SNAP_RANGE, GP_MESH_TOL: GP_MESH_TOL,
  GP_VB_W: GP_VB_W, GP_VB_H: GP_VB_H,
  gpRadiusOf: gpRadiusOf,
  gpGearPathD: gpGearPathD,
  gpComputeMesh: gpComputeMesh,
  gpSolveState: gpSolveState,

  // Weight Scale Builder — just the shared constants (no geometry math to
  // export: unlike Gear & Pulley/Lumen Puzzle there's no spatial layout for
  // Studio's inspector to keep in sync, see the comment above
  // NODE_TYPES.weightScale). WS_MAX_ITEMS/WS_SHAPES are used by
  // buildWeightScaleFields/wireWeightScaleFields in app.js so the builder's
  // item cap and shape list can never drift from the player runtime's.
  WS_MAX_ITEMS: WS_MAX_ITEMS,
  WS_SHAPES: WS_SHAPES,

  // Control Panel Builder — component-type metadata, condition evaluation
  // and shared widget-rendering math, used identically by the player
  // runtime (above) and Studio's inspector-embedded board designer
  // (buildTypeSpecificFields/wireNodeInspector's "controlPanel" case /
  // wireControlPanelDesigner in app.js).
  CTP_COMPONENT_TYPES: CTP_COMPONENT_TYPES,
  CTP_GROUP_LABELS: CTP_GROUP_LABELS,
  CTP_PUSHBUTTON_SKINS: CTP_PUSHBUTTON_SKINS,
  CTP_LIGHT_STYLES: CTP_LIGHT_STYLES,
  CTP_OP_LABELS: CTP_OP_LABELS,
  CTP_BOARD_MIN_W: CTP_BOARD_MIN_W, CTP_BOARD_MAX_W: CTP_BOARD_MAX_W, CTP_ZONE_MAX_H: CTP_ZONE_MAX_H,
  ctpComponentKind: ctpComponentKind,
  ctpKnobArc: ctpKnobArc,
  ctpIsNamedKnob: ctpIsNamedKnob,
  ctpOpsForKind: ctpOpsForKind,
  ctpDefaultComponentData: ctpDefaultComponentData,
  ctpNewComponent: ctpNewComponent,
  ctpLiveValue: ctpLiveValue,
  ctpDefaultValuesById: ctpDefaultValuesById,
  ctpEvalSingleCondition: ctpEvalSingleCondition,
  ctpConditionsAllMet: ctpConditionsAllMet,
  ctpEvalRules: ctpEvalRules,
  ctpWinConditionsMet: ctpWinConditionsMet,
  ctpComputeOutputs: ctpComputeOutputs,
  ctpResolvedValue: ctpResolvedValue,
  ctpKnobTicks: ctpKnobTicks,
  ctpComponentInnerHtml: ctpComponentInnerHtml,
  ctpComponentWrapStyle: ctpComponentWrapStyle,
  ctpRenderZoneComponents: ctpRenderZoneComponents,
  ctpRenderBoard: ctpRenderBoard,
  CTP_FORMULA_VAR_LETTERS: CTP_FORMULA_VAR_LETTERS,
  CTP_FORMULA_FUNCS: CTP_FORMULA_FUNCS,
  ctpEvalFormula: ctpEvalFormula,
  ctpEvalComponentFormula: ctpEvalComponentFormula,

  PLAYER_SCREEN_TYPES: PLAYER_SCREEN_TYPES,
  BACK_BUTTON_TYPES: BACK_BUTTON_TYPES,
  DEFAULT_BUTTON_LABEL: DEFAULT_BUTTON_LABEL,
  BUTTON_LABEL_TYPES: BUTTON_LABEL_TYPES,
  buttonLabelFor: buttonLabelFor,
  nodeCompletionOk: nodeCompletionOk,
  openLeadNodes: openLeadNodes,
  hintsForNode: hintsForNode,
  syncHintForNodeIds: syncHintForNodeIds,
  autoRevealedHintStageCount: autoRevealedHintStageCount,
  renderHintBlockHtml: renderHintBlockHtml,
  laneOptionsForScene: laneOptionsForScene,
  globalInventoryItems: globalInventoryItems,
  renderLaneOptionsList: renderLaneOptionsList,
  wireHintButtons: wireHintButtons,
  wrapWithMedia: wrapWithMedia,
  mediaBrightnessOf: mediaBrightnessOf,
  mediaAdjustFilterCss: mediaAdjustFilterCss,
  renderImageRevealBlock: renderImageRevealBlock,
  renderVideoRevealBlock: renderVideoRevealBlock,
  renderVideoStoryBlock: renderVideoStoryBlock,
  renderPdfRevealBlock: renderPdfRevealBlock,
  renderClickableImageBlock: renderClickableImageBlock,
  renderPreviewNode: renderPreviewNode,
  wirePreviewNodeInteractions: wirePreviewNodeInteractions,
  renderPinnedNode: renderPinnedNode,
  createPreviewController: createPreviewController
};

});
