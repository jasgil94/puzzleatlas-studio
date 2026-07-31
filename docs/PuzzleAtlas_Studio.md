**PUZZLEATLAS  /  STUDIO**

**PRODUCT SPECIFICATION**

**PuzzleAtlas Studio**

The visual, AI-assisted system for designing, testing and publishing hunts

| Defines the creator workflow, graph and map editors, content schema, templates, validation, testing, collaboration and publication model. |
| --- |

Version 0.1  •  30 July 2026

# 1. Product definition

PuzzleAtlas Studio is a web application for constructing hunts as structured content. It combines a visual logic canvas, physical map planning, reusable gameplay blocks, media management, simulation, field testing and controlled publication.

| **North star workflow  **Create visually → validate automatically → simulate → field-test → publish a versioned package → make it available in the Player App. |
| --- |

## Who it serves

| **Creator** | **Primary goal** | **Required experience** |
| --- | --- | --- |
| Founder/designer | Turn a concept into a complete playable hunt | No coding required |
| Puzzle designer | Create fair puzzles and nonlinear structures | Powerful graph and testing tools |
| Editor/reviewer | Check story, accuracy, accessibility and quality | Comments, status and approvals |
| Field tester | Report route and puzzle problems in context | Mobile test build and linked notes |
| Operator | Publish, maintain and analyse the catalogue | Versioning, controls and analytics |

## Product principles

Structured content first: standard components are safer and more reusable than per-hunt code.

Visual authoring with inspectable rules: connections represent real conditions, not decorative arrows.

AI proposes; creators approve: generated content remains draft until verified.

One source of truth: flow, map, preview and exported package reflect the same hunt model.

Testability is a feature: every node and route must be simulatable before publication.

Publication is controlled: a published version is immutable and auditable.

# 2. Information architecture

| **Area** | **Purpose** |
| --- | --- |
| Dashboard | Drafts, testing status, published hunts, issues and performance |
| Hunt workspace | Overview, flow, map, content, media, settings and release status |
| Template library | Reusable nodes, sections and whole-hunt structures |
| Test centre | Simulation runs, invitations, feedback and defect triage |
| Publishing | Validation, approvals, store metadata, pricing and releases |
| Operations | Versions, warnings, availability, analytics and support |

## Hunt workspace

Overview: concept, audience, practical constraints, completion status and ownership.

Flow: logical graph of scenes, puzzles, rules, branches and convergence.

Map: physical locations, routes, distances, zones and access notes.

Content: searchable list of nodes, text, solutions, hints and localization status.

Media: images, audio, video and downloadable documents with rights and accessibility metadata.

Test: simulation, automated checks, private builds and linked tester feedback.

Release: package preview, store listing, price, availability, approvals and version notes.

## Creator status model

| **Status** | **Meaning** |
| --- | --- |
| Concept | Structure is exploratory; completeness checks are advisory |
| Draft | Content is actively authored and may be shared internally |
| Ready for simulation | Mandatory graph and required fields are complete |
| Field testing | A fixed candidate version is being tested |
| Ready to publish | Checks and required approvals have passed |
| Published | Immutable version is available according to release settings |
| Retired | Unavailable to new customers; existing rights follow policy |

# 3. Visual flow editor

The canvas is the principal design surface. A creator drags components onto it, connects them and edits their content and rules in an inspector. The canvas must remain comprehensible at both puzzle and whole-hunt scale.

## Node families

| **Family** | **Examples** |
| --- | --- |
| Narrative | Scene, dialogue, document reveal, choice, audio or video |
| Puzzle | Answer, ordering, matching, hotspot, logic, lock, evidence linking |
| Location | GPS area, waypoint, observation, QR, bearing, timed access |
| State | Award item, set variable, score, achievement, timer |
| Control | Branch, convergence, conditional route, checkpoint, ending |
| Support | Hint, accessibility alternative, safety notice, issue prompt |

## Connections and rules

Connections express conditions under which content becomes available. The rule builder should offer plain-language composition while storing deterministic structured logic.

All of these nodes are complete.

Any two of these three branches are complete.

The player possesses an item or has learned a discovery.

A variable has a specified value or a choice was previously made.

The player is inside a location area during an allowed time.

A named player or team has submitted information.

An optional branch changes an ending without blocking the main route.

## Canvas usability

Automatic layout, alignment guides, groups, labels, minimap and search.

Collapse a multi-node section into a named component without hiding warnings.

Trace prerequisites and consequences for a selected node.

Filter by player, location, mandatory status, content type or validation state.

Show unreachable, cyclic or over-connected regions without cluttering normal editing.

Provide undo/redo, change history and draft checkpoints.

| **Important distinction  **The canvas is not itself the hunt format. It is one view of the canonical structured model also used by the map, preview and export. |
| --- |

# 4. Map editor for location hunts

Flow explains logical dependency; map explains physical movement. Location nodes are shared objects between the two views, so editing coordinates or metadata updates every representation.

| **Map capability** | **Creator outcome** |
| --- | --- |
| Place and size GPS areas | Define arrival tolerance and confidence requirements |
| Draw route guidance | Describe safe recommended movement without forcing a single path |
| Measure branches | Compare distance, elevation, estimated time and imbalance |
| Attach access data | Record opening hours, stairs, surfaces, tickets and fallback |
| Define visibility | Control when exact points, zones or no markers appear |
| Field verification | Record who checked the location, when and under what conditions |

## Map warnings

Mandatory location lacks a fallback policy.

Sequential nodes create an excessive walk or unnecessary backtracking.

A route appears to cross a restricted or dangerous area.

A location depends on a venue whose opening times are incomplete.

Branches differ substantially in distance or expected duration.

GPS radius is implausibly narrow for the local environment.

Observation depends on a temporary, seasonal or easily changed object.

# 5. Component and template system

## Template levels

| **Level** | **Example** | **Purpose** |
| --- | --- | --- |
| Node | Progressive-hint text puzzle | Reuse one configured interaction |
| Section | Three leads converging on one deduction | Reuse a proven graph pattern |
| Hunt | Two-hour nonlinear city mystery | Start from a complete structural skeleton |
| Style pack | Noir case-file presentation | Apply coherent visual and narrative defaults |

## Template behaviour

Templates create editable copies unless explicitly linked to a maintained component.

Required placeholders are visible and validated.

A template declares compatible app and schema versions.

Creators can save selected canvas regions as private templates.

Official templates include accessibility and fallback expectations.

Updates to a template never silently rewrite existing hunts.

# 6. AI-assisted authoring

AI operates within the hunt’s schema and current context. It can create or revise structured drafts, explain its proposed changes and submit them for acceptance. It must not directly publish or silently change solved content.

## High-value actions

Generate a branch or whole-hunt skeleton from a concept and constraints.

Convert prose into nodes, connections, variables, items and placeholder research tasks.

Create progressive hints and plausible accepted-answer variants.

Turn a linear sequence into parallel leads with a meaningful convergence.

Suggest puzzle mechanics appropriate to a verified location feature.

Check fairness, ambiguity, accidental alternative answers and prerequisite knowledge.

Rewrite narrative to a defined voice while preserving solution facts.

Generate accessibility alternatives and flag mechanics that cannot be made equivalent.

Explain graph defects and propose minimal repairs.

Summarise tester data and propose a prioritized revision list.

## AI change review

The creator states an intent and constraints.

The assistant shows a plan or structured preview when the change is broad.

Proposed additions, removals and edits appear as a reviewable change set.

The Studio validates the resulting graph before acceptance.

The creator accepts all, accepts selected changes or rejects the proposal.

The action and prompt are retained in change history.

| **Verification boundary  **AI may draft history, routes and location-based puzzles, but publication requires human verification of factual accuracy, rights, permanence, accessibility and physical safety. |
| --- |

## Imports and custom interactions

JSON conforming to the PuzzleAtlas schema is the preferred AI import. Arbitrary HTML or JavaScript should not be a default content path. Rich interactions should begin as configurable, audited templates such as a cipher wheel, combination dial, hotspot image, sliding arrangement or evidence board.

# 7. Canonical hunt model

| **Entity** | **Key responsibilities** |
| --- | --- |
| Hunt | Identity, type, metadata, defaults, supported modes and entry points |
| Node | Typed unit of narrative, puzzle, location, control or state change |
| Connection | Source, target, condition, priority and presentation behaviour |
| Condition | Deterministic expression over session state and events |
| Effect | State mutation such as award, unlock, variable, timer or score |
| Asset | Media file, variants, rights, accessibility and offline policy |
| Location | Coordinates or area, access data, safety notes and verification |
| Ending | Completion criteria, narrative result and post-game information |

## Schema requirements

Stable unique IDs and an explicit schema version.

Strict typing and validation for nodes, conditions and effects.

Separation of player-visible content from creator-only solutions and notes.

Localization-ready text references rather than duplicated hard-coded strings.

Asset manifest with hashes and required/streamable/offline classifications.

Deterministic evaluation of progression rules.

Extension points that fail safely in older Player App versions.

## Import pipeline

Parse into a quarantine draft; never merge unknown data directly into a live hunt.

Validate schema, identifiers, references, assets and supported component versions.

Display a human-readable summary and any dropped or transformed fields.

Create a reversible change set.

Run graph validation after import.

Require explicit creator acceptance.

# 8. Validation and simulation

## Automated validation

| **Category** | **Examples** |
| --- | --- |
| Structural | Unreachable nodes, unintended cycles, missing endings, dangling references |
| Progression | Deadlocks, impossible conditions, consumable item conflicts, broken branches |
| Content | Missing solution, hint, alt text, media or player instruction |
| Location | Missing radius, fallback, verification, access or safety information |
| Release | Incomplete listing, price, rights, rating, language or compatibility |
| Quality signals | Branch imbalance, excessive linearity, repeated mechanics, abrupt ending |

## Simulation mode

Play the hunt using the same renderers and rules as the Player App.

Simulate location, time, player count, accuracy and connectivity.

Jump to a node while automatically constructing a valid prerequisite state.

Inspect completed, available and locked content, variables, items and event history.

Save named scenarios such as ‘two hints used’ or ‘location branch unavailable’.

Generate a coverage report showing which paths and endings were exercised.

## Field testing

Freeze a test candidate and distribute an expiring private link or QR code.

Tester downloads the exact candidate into the Player App.

Notes, screenshots and issue reports attach to the current node, location and version.

Studio combines route, timing, attempts, hints and qualitative feedback.

Creator triages findings and revises a new draft.

A subsequent candidate starts a distinct test cycle.

# 9. Publishing, operations and analytics

## Publication gate

No unresolved blocking validation errors.

Required editorial, puzzle, location and release approvals recorded.

Store listing, price, regions, languages and content rating complete.

Package compatibility and asset integrity checks pass.

At least one completed end-to-end test on the release candidate.

Rollback, warning and support ownership are assigned.

## Version model

Published packages are immutable. Corrections occur in a new version created from the previous release. Compatibility metadata determines whether active sessions remain fixed, may opt in, or can migrate safely.

| **Change** | **Typical handling** |
| --- | --- |
| Copy or media correction | Patch version; active sessions may update if state-safe |
| Puzzle solution or graph change | New version; active sessions normally remain pinned |
| Safety closure | Immediate warning or disable plus replacement route/version |
| Schema capability | Require a minimum Player App version |
| Commercial metadata only | Catalogue update without rebuilding content package |

## Creator analytics

Starts, completions, abandonment and completion time by version.

Attempts, hints and skips by puzzle.

Path distribution and branch duration.

GPS arrival failures and manual fallback use.

Issue reports and accessibility feedback.

Privacy-preserving cohort comparisons rather than unnecessary raw location histories.

# 10. Staged delivery

| **Stage** | **Outcome** |
| --- | --- |
| 1. Local prototype | Flow canvas, core nodes, rules, JSON export and browser preview |
| 2. Private end-to-end | Accounts, backend drafts, Player test link, GPS and media |
| 3. Publication MVP | Validation, immutable packages, catalogue delivery and versioning |
| 4. AI-native Studio | Structured generation, change review, graph analysis and testing support |
| 5. Creator platform | Roles, submissions, editorial workflow, royalties and moderation |

## Prototype acceptance criteria

A non-developer can construct a branching five-puzzle hunt and understand why each node unlocks.

The hunt can be saved, reopened and exported without losing graph meaning.

The preview interprets the export rather than using a separate hard-coded flow.

Validation identifies an unreachable node and an impossible convergence.

A template can insert a three-branch investigation as editable content.

An AI-generated schema fragment can be imported through a reviewable, reversible process.

PuzzleAtlas product definition  •  Working document