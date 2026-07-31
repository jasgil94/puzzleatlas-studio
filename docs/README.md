# PuzzleAtlas Studio — Phase 1 Prototype

A local, browser-based visual authoring tool for building nonlinear puzzle hunts, per the PuzzleAtlas Studio spec v0.1 and the Phase 1 exit gate in the Product Development Plan v0.1 (30 July 2026).

## How to run it

No install, no server, no account. Two equivalent ways to open it:

- **Single file:** double-click `PuzzleAtlas-Studio.html` — everything (HTML/CSS/JS) is inlined in one file.
- **Folder version:** double-click `index.html` (keep it next to `styles.css` and `app.js` in the same folder).

Either opens directly in your browser via `file://` — nothing is sent over the network, and it works fully offline.

## A note on how this was built

The spec suggested React + React Flow. This sandbox has no npm registry access (all package installs are blocked), so this prototype is built as dependency-free vanilla JavaScript instead — same data model, same features, zero external dependencies, guaranteed to run offline by opening the file. It's a implementation-detail swap, not a scope change.

## What's in the box

- **Canvas** — drag nodes from the palette, connect them by dragging from a node's right-hand port to another node, pan (drag empty canvas), zoom (scroll wheel or +/- buttons), multi-select (shift-drag a marquee), grid-snap, undo/redo (Ctrl+Z / Ctrl+Y).
- **Node families** — Narrative (scene, choice), Puzzle (answer entry, ordering, matching), State (award item, set variable, score), Control (branch, convergence, ending), Support (progressive hint), and a Location stub (explicitly out of scope, included only as a structural placeholder).
- **Inspector** — click a node to edit its content, effects, and creator-only notes (never shown to the player) in the right panel. Click a connection to open the rule inspector and build its condition from dropdowns (node/variable/item pickers) — no free-text logic required.
- **Hunt setup** — title, concept, audience, entry point(s), and declared variables/items live in the bottom of the left panel.
- **Save/reopen** — "Save" writes the hunt to this browser's local storage; "Reopen" restores it, positions and all.
- **Export/import** — "Export JSON" downloads the canonical hunt document; "Import JSON" reconstructs the canvas from a file. Round-tripping is lossless (verified — see Testing below).
- **Validation** — the warnings panel flags unreachable nodes, dangling references, missing endings, and impossible convergences, and clicking a warning jumps you to the offending node/connection.
- **Preview** — click "Preview / Play" to interpret the *exported* JSON directly and play the hunt end to end: open leads, answer entry, ordering/matching, progressive hints, branching, convergence, and endings. There is no separate hard-coded demo flow — preview and export share one interpreter.

## Reference hunt: "The Printer's Last Edition"

Click **"Load Demo Hunt"** for a working 8-node example (condensed from the location-hunt concept of the same name): an intro scene fans out into three parallel, non-exclusive puzzle leads (answer entry ×2, an ordering puzzle), which converge once **any 2 of the 3** are solved, then a **branch** node auto-routes to one of two endings depending on whether the courier lead was solved. It demonstrates nonlinear structure, a real convergence, and branching endings within the 5–8 node range.

## Broken test hunt (validation demo)

Click **"Load Broken Test Hunt"** to load a small fixture with exactly two deliberate defects: an **unreachable node** (no incoming connections at all) and an **impossible convergence** (requires 3 of only 2 incoming branches). Opening the Validation panel shows both flagged, with nothing else.

## Canonical schema (v0)

Every hunt is one JSON document: `Hunt` (id, title, schema version, metadata, entry points, declared variables/items) → `Node[]` (typed, with position, player-visible `content`, `effects`, and creator-only `creatorNotes`) → `Connection[]` (source, target, `condition`, priority, label). Conditions are a small structured vocabulary (always / node complete / all-of / any-N-of / choice selected / variable comparison / item held) composed via dropdowns in the rule inspector, not free text. The canvas is only ever a *view* of this document — nothing is tracked separately, which is what lets Preview interpret the same export a Player app eventually would.

## Testing performed

Since this sandbox also has no way to drive a real browser for this session, verification was done at the logic level: the schema, validation engine, and player interpreter were extracted and run under Node against both the reference hunt and the broken test hunt. Confirmed: the reference hunt validates with zero warnings; both playthrough paths (courier solved / not solved) reach their correct distinct endings with correct score/item/variable effects; wrong answers are correctly rejected without completing a node; the broken hunt flags exactly its two deliberate defects and nothing else; export → import round-trips byte-for-byte. You should still click through it yourself in a browser to sanity-check the drag/drop and visual layer, which wasn't covered by this pass.

## Known Phase 1 limitations (by design, per spec)

No accounts, backend, publishing, GPS/map editor, media pipeline, templates library, AI authoring, or analytics — all explicitly out of scope for this build. The location node is a structural stub only.
