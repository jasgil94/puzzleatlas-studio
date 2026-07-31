# PuzzleAtlas — Style Packs

Addendum to the Studio spec (section 5, "Style pack" template level). Defines a standalone file format that sets a hunt's visual and tonal norms — font, colour, imagery treatment, pacing — so a creator can swap the whole look of a hunt without touching individual nodes.

## What a style pack controls

A style pack governs the **player-facing presentation** only: the Preview/Play overlay in Studio today, and the Player App later. It does **not** restyle the Studio's own editor chrome (palette, canvas, inspector) — that stays a consistent dark IDE regardless of which hunt is open, so authoring never becomes harder to read.

It sets: heading/body/mono fonts, a colour palette (background, surface, text, accent, feedback colours, and optional per-node-family accents), shape language (sharp vs. rounded, border weight), a default image treatment (for when media support lands), and short tone/vibe notes for narrative voice.

## File format

`style-packs/schema/style-pack.schema.json` is the JSON Schema. A style pack is a single JSON file conforming to it. See `style-packs/examples/` for three ready-to-use packs:

- **noir-case-file.json** — dark, serif, moody 1940s pressroom mystery.
- **bright-academic.json** — light, clean, museum-exhibit feel for armchair/investigative hunts.
- **neon-arcade.json** — high-contrast, playful, for party/social hunts.

## How it plugs in

- `hunt.stylePack` on the Hunt document holds a full copy of the chosen pack (not just a reference by id). This keeps an exported hunt package self-contained and portable — consistent with the existing "one export, no external dependencies" principle — rather than requiring the Player to separately fetch a style pack file.
- In Studio, the Hunt Setup panel has a **Style Pack** picker: choose one of the built-in packs, or **Import Style Pack…** to load any JSON file matching the schema (the same drag-a-file-in pattern already used for hunt Import JSON). Importing embeds a copy into the current hunt.
- Studio applies the pack by setting CSS custom properties (`--pv-*`) scoped to the Preview window only, so switching packs is instant and never touches editor styling.
- Built-in packs also ship embedded directly in `app.js` (`STYLE_PACKS`) so they're available with zero network access, matching the app's offline-first, dependency-free build.

## Authoring a new style pack

Copy an example file, keep `schemaVersion` and `id` (unique, kebab-case), then adjust `typography`, `palette`, `shape`, `imagery`, and `vibe`. Import it via **Style Pack → Import Style Pack…**. There's no build step — it's just JSON.

## What's deliberately out of scope for now

Shipping actual font files for true offline Player playback (currently font stacks assume system/web-safe fonts, or an optional `typography.importUrl` for live-preview-only web fonts). Per-node style overrides (a style pack sets hunt-wide norms, not per-node exceptions). Automatic AI generation of a style pack from a concept — a natural Phase 6 (AI-native Studio) candidate once the manual format is proven.
