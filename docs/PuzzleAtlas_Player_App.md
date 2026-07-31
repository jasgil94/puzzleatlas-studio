**PUZZLEATLAS  /  PLAYER APP**

**PRODUCT SPECIFICATION**

**PuzzleAtlas Player App**

The mobile experience for discovering, purchasing and playing puzzle hunts

| Defines the player-facing product, its game engine, primary journeys, state model, location behaviour, multiplayer foundations and release priorities. |
| --- |

Version 0.1  •  30 July 2026

# 1. Product definition

PuzzleAtlas Player is the consumer mobile application through which players browse, obtain and play self-contained puzzle adventures. It supports three formats—location-based hunts, armchair hunts and party hunts—through one reusable game engine and a shared player identity.

| **Core promise  **The app turns a structured hunt package into a coherent playable experience. New hunts are downloadable content; they do not require a new app release. |
| --- |

## Product boundaries

The app plays published hunts; it does not contain the creator’s visual authoring tools.

A hunt is a versioned package of narrative, puzzles, rules, locations and media interpreted by the app.

The player interface hides authoring concepts such as node IDs and dependency rules.

The engine supports nonlinear investigations without forcing the player to understand the underlying graph.

## Player groups

| **Player group** | **Primary need** | **Typical session** |
| --- | --- | --- |
| City explorer | A distinctive, safe way to investigate a real place | 2–4 hours, outdoors |
| Puzzle enthusiast | A substantial mystery with fair deductions | 60–180 minutes, anywhere |
| Social group | Low-friction shared play and lively collaboration | 30–120 minutes, co-located |
| Traveller or family | Clear expectations, accessibility and pause/resume | Flexible, often interrupted |

## Design principles

Investigation over scavenger hunting: discoveries contribute meaning, not merely another destination.

Choice without confusion: players can pursue multiple leads while always understanding what is available.

Story and puzzle are one system: narrative reveals, items and locations matter mechanically.

Fail forward: hints, skips and recovery paths prevent a single puzzle from destroying a session.

Outdoor reality first: GPS uncertainty, weather, closures, fatigue and safety are normal conditions.

Offline confidence: downloaded hunts remain playable through intermittent connectivity.

# 2. App structure and navigation

| **Area** | **Purpose** | **Key contents** |
| --- | --- | --- |
| Discover | Browse the catalogue | Featured hunts, collections, filters, location relevance |
| Library | Access owned and downloaded hunts | Ready to play, updates, active sessions, completed |
| Play | Run the current hunt | Objectives, leads, puzzles, map, inventory, hints |
| Groups | Create or join shared sessions | Lobby, roles, team state, invitations |
| Profile | Persistent identity and preferences | History, achievements, accessibility, privacy |

## Discover and store

The catalogue must help a player judge whether a hunt is suitable before purchase. Each listing should make practical constraints as prominent as theme and artwork.

Type, location, start area, duration, distance, terrain and expected physical effort.

Difficulty, recommended age, group size and whether one or multiple devices are supported.

Opening hours or access dependencies, offline availability and languages.

Content notes, accessibility notes, current version and last location verification date.

Price, entitlement status, download size, ratings and spoiler-controlled reviews.

## Library and session states

| **State** | **Meaning** | **Available action** |
| --- | --- | --- |
| Owned | Entitlement exists; package not stored locally | Download |
| Downloaded | Required package and assets are on device | Start |
| In progress | A saved session exists | Resume |
| Update available | A compatible newer package exists | Review and update |
| Completed | An ending has been reached | Review, replay or inspect results |

## Starting a hunt

Confirm players, device arrangement and session owner.

Run a readiness check for battery, location permission, downloaded assets and connectivity.

Show practical safety, accessibility and start-location guidance.

Create the session from a fixed hunt version and initialise player state.

Begin with an authored opening rather than exposing a technical loading screen.

# 3. The play experience

## Player-facing model

The app translates the hunt graph into a small set of concepts players can understand: current objective, open leads, discoveries, evidence and completed threads. It should not present every node as a checklist.

| **Concept** | **Player meaning** | **Engine meaning** |
| --- | --- | --- |
| Objective | The current high-level problem | Active milestone or convergence |
| Lead | A thread the player can pursue | Available branch or node cluster |
| Discovery | A fact learned through play | State change, variable or clue |
| Evidence | A reusable document, item or media object | Inventory entity with metadata |
| Revelation | Several discoveries becoming meaningful together | Convergence condition satisfied |

## Core screen

Story panel for the current scene, puzzle or conversation.

Open Leads view showing available investigations and their broad status.

Map for location hunts, with author-controlled disclosure of markers and routes.

Evidence casebook combining inventory, documents, clues and player notes.

Hint control that clearly states any score or achievement effect before use.

Session controls for pause, accessibility, safety assistance and reporting an issue.

## Puzzle interaction

Reusable renderers should cover the majority of hunts: text and number answers, choice, ordering, matching, image hotspots, timelines, combination locks, dialogue, evidence linking and configurable interactive templates. Answer matching must support normalisation and author-approved alternatives without accepting unrelated guesses.

## Hints and recovery

Hints are progressive: orientation, stronger nudge, near-solution, then explicit resolution.

A player may leave an unresolved branch and pursue another available lead.

A skip records that the puzzle was bypassed while delivering enough knowledge for later deductions.

Location problems offer an authored remote alternative or manual verification path where possible.

The app can restore the last consistent state if a session is interrupted during a transition.

## Completion

An ending should resolve both the logical mystery and the player’s emotional journey. The completion screen may show route, time, hints, optional content, achievements and alternate endings, but should prioritise the authored finale before statistics.

# 4. Location-based play

## Location behaviours

| **Mechanic** | **Expected behaviour** | **Fallback** |
| --- | --- | --- |
| GPS arrival | Unlock within an authored radius after a stable reading | Manual check or alternate evidence |
| Map marker | Reveal only when narratively appropriate | Text directions and landmark image |
| Observation | Ask about durable public details | Verified alternate puzzle |
| Bearing task | Use heading with tolerance and clear calibration | On-screen compass simulation |
| Route choice | Show safe, practical movement between areas | Author-provided reroute |
| Timed access | Explain time window before commitment | Deferred or substitute branch |

## Location reliability

Use accuracy-aware arrival logic rather than a single instantaneous coordinate.

Never require the player to trespass, enter roads, obstruct access or focus on the screen while crossing.

Location collection should be session-limited and minimised; the privacy model must be explicit.

Downloaded content should include the route’s essential maps, text and media.

A prominent safety action should pause play without losing progress.

Every published hunt needs a field-test date and a route maintenance process.

| **Authoring implication  **Every location-dependent mandatory step needs a declared fallback policy. The Player App executes it; the Studio validates that one exists. |
| --- |

## Map disclosure styles

Guided: current destination is visible; suitable for accessible or family hunts.

Investigative: a bounded search area is visible but the exact point must be deduced.

Emergent: independent clues combine to reveal a location later.

Free-roam: several known leads are visible and can be visited in any order.

# 5. Party and multiplayer play

Party hunts should use the same content engine while adding session membership, ownership and information distribution. The first release can support co-located, turn-based or shared-screen play before real-time multi-device complexity.

## Session models

| **Model** | **Devices** | **Use** |
| --- | --- | --- |
| Pass-and-play | One | Fastest onboarding; short party puzzles |
| Host and companions | One primary plus optional viewers | Narrative control stays with host |
| Synchronized team | One per player or team | Parallel leads and split information |
| Competitive teams | One or more per team | Race, scoring and timed reveals |

## Multiplayer rules

The session owner controls start, pause, skip and ending decisions unless the hunt overrides this.

Player-private information must remain private until explicitly shared or combined.

Reconnect and host-transfer behaviour must be predictable.

The server is authoritative for entitlements and synchronized state; the device remains useful during temporary disconnection.

Late joining, player departure and abandoned devices require authored or automatic recovery.

# 6. Data and engine model

A running session binds one published hunt version to player state. The engine evaluates conditions after relevant events, determines newly available content and records an append-only event history sufficient for support and recovery.

| **Entity** | **Responsibility** |
| --- | --- |
| Hunt package | Immutable published content, schema version, assets and manifest |
| Entitlement | Who may download or start the hunt |
| Session | Selected hunt version, participants, mode and lifecycle |
| Player state | Completed nodes, variables, evidence, attempts, hints and score |
| Event log | Ordered record of meaningful state-changing actions |
| Asset cache | Verified local media required for offline play |

## Save and synchronization

Persist locally after every meaningful state change.

Use idempotent events so retrying a synchronization cannot duplicate rewards.

Resolve conflicts according to session authority rather than last-write-wins everywhere.

Do not migrate an active session to a new hunt version unless compatibility is explicitly declared.

Provide a support export containing safe diagnostic state without exposing solutions to the player.

# 7. Accessibility, trust and operations

Support screen readers, dynamic text, sufficient contrast, captions and reduced motion.

Allow authors to provide non-audio and non-visual equivalents where the mechanic permits.

State walking, stairs, surfaces, noise, lighting and venue access before purchase.

Make permissions contextual: explain why location, camera or microphone access is requested.

Provide spoiler-aware issue reporting tied to the current hunt node and package version.

Keep purchases, location history and child safety subject to dedicated legal and security review.

## Operational capabilities

| **Capability** | **Reason** |
| --- | --- |
| Remote disable or warning | A route may become unsafe or inaccessible |
| Version targeting | Fix content without breaking active sessions |
| Issue triage | Connect reports to exact location, node and version |
| Completion analytics | Find confusion, abandonment and unreliable triggers |
| Refund/support view | Understand entitlement and session history |

# 8. Release plan

| **Release** | **Included** | **Deferred** |
| --- | --- | --- |
| Prototype | Browser or mobile shell; one package; text, choice, inventory, branching | Store, accounts, GPS, multiplayer |
| Private alpha | Accounts, downloads, GPS checkpoints, offline save, test links | Payments, public catalogue |
| Commercial MVP | Catalogue, purchases, versioning, issue reporting, analytics | AI characters, arbitrary custom code |
| Expansion | Party synchronization, richer templates, creator ecosystem | Open marketplace until quality controls mature |

## MVP acceptance criteria

A player can purchase or receive access to a hunt, download it and start it without an app update.

One nonlinear location hunt can be completed offline after download, except for clearly disclosed services.

Progress survives app termination and device restart.

A mandatory GPS failure has a safe recovery path.

A content correction can be published without corrupting active sessions.

Support can identify the exact hunt version and player state behind a reported problem.

PuzzleAtlas product definition  •  Working document