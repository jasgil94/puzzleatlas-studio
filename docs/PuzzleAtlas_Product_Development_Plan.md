**PUZZLEATLAS  /  PRODUCT DEVELOPMENT PLAN**

**PRODUCT STRATEGY**

**PuzzleAtlas Product Development Plan**

A staged strategy for maturing the platform, content catalogue and commercial offering

| Defines how PuzzleAtlas should progress from a focused proof of concept to a reliable consumer product, scalable content operation and—only when justified—a broader creator platform. |
| --- |

Version 0.1  •  30 July 2026

# 1. Strategic intent

PuzzleAtlas is not one application feature or one puzzle hunt. It is an integrated offering made from four mutually dependent capabilities: a reusable player engine, a visual creator studio, a catalogue of high-quality hunts and the commercial and operational systems that connect them. Product maturity therefore cannot be measured by the number of screens built. It is measured by whether the full system can repeatedly create, publish, sell, deliver and support excellent experiences.

| **Central strategy  **Prove the smallest complete loop before broadening the platform: author one hunt as structured content, publish a fixed package, play it end to end, learn from real players, and repeat. |
| --- |

## The maturity sequence

- Prove that a hunt can be represented as reusable structured content.

- Prove that a non-developer can author and revise that content effectively.

- Prove that players enjoy and complete a polished hunt.

- Prove that multiple hunts can be published and maintained without engine rewrites.

- Prove that customers will pay and that the experience can be operated responsibly.

- Scale content production, discovery and retention.

- Open selected platform capabilities to external creators only after quality control is mature.

## What not to optimise for initially

A large catalogue before one exceptional hunt has been repeatedly tested.

A visually impressive Studio whose exports do not drive the Player App.

Many node types before the core progression model is reliable.

Real-time multiplayer, augmented reality or live AI characters before offline single-session play works.

An open creator marketplace before editorial, rights, safety and support processes exist.

Growth metrics that hide weak completion, poor reviews or high support cost.

# 2. The overall offering

| **Pillar** | **Customer value** | **Maturity test** |
| --- | --- | --- |
| Player App | A dependable and enjoyable way to discover, obtain and play hunts | A downloaded hunt can be completed without intervention |
| Studio | A visual way to create, test and publish hunts without per-hunt coding | A creator can revise a nonlinear hunt safely |
| Hunt catalogue | Distinctive experiences worth travelling for, playing at home or sharing | Players recommend, complete and buy another hunt |
| Platform operations | Purchases, delivery, versioning, safety, support and analytics | Problems can be diagnosed and corrected without breaking sessions |
| Brand and community | Trust that PuzzleAtlas means clever, fair and memorable play | The catalogue feels coherent without becoming repetitive |

## Balanced maturity

The weakest pillar limits the whole offering. A strong app cannot rescue weak hunts; excellent hunts cannot scale through a brittle engine; a powerful Studio is commercially irrelevant without players; and sales growth becomes dangerous if route maintenance, privacy and support are immature.

Engine maturity: deterministic progression, saving, offline behaviour and compatibility.

Experience maturity: fair puzzles, strong narrative, accessibility and satisfying endings.

Content maturity: repeatable research, authoring, playtesting and editorial standards.

Commercial maturity: understandable listings, entitlements, pricing and customer support.

Operational maturity: version control, route checks, incident response and privacy discipline.

# 3. Strategic principles

| **Principle** | **Implication** |
| --- | --- |
| Vertical slices over broad foundations | Every stage ends in something playable from authoring through delivery |
| Content before feature abundance | Build new mechanics when a real hunt needs them and reuse is plausible |
| Structured components before custom code | Prefer safe, configurable renderers and templates |
| Evidence before scale | Advance stages when defined learning and quality gates are met |
| Human verification at critical boundaries | AI accelerates drafting but does not certify safety, history, rights or fairness |
| Reliability is part of the game design | Offline, GPS fallbacks and recovery paths are player experience |
| Catalogue coherence without sameness | Shared quality standards; varied cognitive and narrative identities |

| **Decision rule  **When choosing between a new capability and improving a complete player journey, prefer the journey unless the capability removes a demonstrated constraint. |
| --- |

# 4. Phase 0 — Product definition and risk reduction

The first phase converts the broad vision into a small set of stable decisions. It should be short, concrete and oriented toward eliminating architectural ambiguity.

## Objectives

Define the minimum hunt schema and the player-state model.

Choose one flagship use case: a nonlinear location hunt for one device and one small group.

Select a small standard component set covering narrative, answer entry, choice, inventory, location and convergence.

Write the first hunt’s concept, graph, ending and field-research plan.

Identify non-negotiable privacy, safety, purchase and platform-review work.

## Deliverables

| **Deliverable** | **Evidence of completion** |
| --- | --- |
| Schema v0 | One representative hunt can be expressed without ad hoc exceptions |
| Experience prototype | Key screens and transitions can be tested without a backend |
| Reference hunt graph | Branches, conditions, discoveries and ending are explicit |
| Risk register | Critical product, operational, legal and content risks have owners |
| Stage plan | The next build has a bounded scope and measurable gate |

## Exit gate

The team can explain how a published hunt becomes playable without shipping a new app.

The first hunt can be completed using the proposed component vocabulary.

No unresolved architectural question blocks the first end-to-end slice.

Deferred features are written down and protected from accidental scope growth.

# 5. Phase 1 — Playable engine and authoring prototype

This phase proves the core technical proposition: the same structured hunt is editable in the Studio prototype and interpreted by the Player prototype. The system may be local and private, but it must be real.

## Build scope

Studio canvas with nodes, connections, a rule inspector, save/reopen and JSON import/export.

Player renderer for narrative, text answer, choice, evidence/item, branch, convergence and ending.

One GPS checkpoint type with a test-mode simulation.

Local save state and deterministic progression evaluation.

Basic graph checks for missing references, unreachable nodes and absent endings.

One rough reference hunt played through entirely in preview and on a device.

## Learning agenda

| **Question** | **Evidence** |
| --- | --- |
| Can the schema express genuine nonlinear play? | The reference hunt contains parallel leads and a knowledge-based convergence |
| Can a non-developer understand the graph? | Observed authoring sessions require minimal technical explanation |
| Does one export drive both preview and player? | No duplicate hard-coded flow exists |
| Where does custom content become necessary? | Gaps are recorded against real design needs |
| Is the state model recoverable? | Closing and reopening preserves a consistent session |

## Exit gate

A creator builds or materially revises a small nonlinear hunt without editing application code.

The Player runs the exported package and reaches every intended ending.

Saving, resuming and hint/skip paths do not corrupt progression.

The prototype exposes enough friction to define the next Studio improvements.

# 6. Phase 2 — Private end-to-end alpha

The alpha connects authoring, backend delivery and real-world play. It replaces convenient local assumptions with the minimum reliable private service.

## Build scope

Creator accounts, hunt drafts, media storage and fixed test candidates.

Private publication to a test catalogue and QR or link-based access.

Player accounts, package download, asset verification and offline session saving.

GPS areas, map presentation, manual or authored fallback and route safety controls.

Version pinning, issue reporting and basic diagnostic state.

Tester invitations, node-linked feedback and timing/attempt analytics.

## Content programme

Complete one flagship location hunt to release-candidate standard.

Create one compact armchair hunt to test whether the engine is truly format-independent.

Run internal, accompanied and then blind tests with distinct participant groups.

Establish editorial, puzzle fairness, accessibility and field-verification checklists.

Create a maintenance record for every real-world dependency.

## Exit gate

| **Dimension** | **Required proof** |
| --- | --- |
| Experience | Blind testers complete the flagship hunt and understand the nonlinear structure |
| Reliability | Sessions survive poor connectivity, app termination and GPS uncertainty |
| Creation | Revisions move through Studio, test candidate and Player without manual package repair |
| Support | A tester issue can be tied to the exact node, location, app and hunt version |
| Operations | A route problem can trigger a warning, fallback or replacement version |

# 7. Phase 3 — Closed beta and product validation

The closed beta tests whether PuzzleAtlas is a desirable repeatable offering, not merely a functioning project. Participants should encounter near-commercial onboarding, catalogue descriptions and support.

## Beta proposition

A small invitation-only catalogue containing location, armchair and simple party formats.

Realistic store listings and entitlement flows, even if payment is initially simulated or tightly limited.

Clear pre-play expectations for difficulty, duration, walking, accessibility and device arrangement.

Structured feedback after completion, abandonment and support interactions.

Deliberate tests of replay, cross-format interest and willingness to pay.

## What to measure

| **Signal** | **Interpretation** | **Do not optimise blindly** |
| --- | --- | --- |
| Completion rate | Overall clarity and technical reliability | A high rate caused by over-easy puzzles |
| Hint and skip patterns | Puzzle fairness and instruction quality | Low hint use if players simply abandon |
| Time by branch | Pacing and branch balance | Speed without enjoyment |
| Recommendation intent | Memorability and perceived value | Polite feedback without observed advocacy |
| Second-hunt intent | Catalogue and platform value | Discount-driven clicks |
| Issue/support rate | Operational burden and trust | Suppressing reports through poor tooling |

## Exit gate

Players describe PuzzleAtlas accurately after use and can distinguish its formats.

At least two hunts demonstrate repeatable content delivery through the same engine.

Critical technical failures are exceptional and recoverable.

The flagship hunt achieves defined quality thresholds for completion, recommendation and support burden.

There is credible evidence of willingness to pay or strong purchase intent at a tested price range.

# 8. Phase 4 — Commercial minimum viable product

Commercial launch should be a controlled introduction of a dependable offering, not the moment every envisioned capability appears.

## Launch scope

Public catalogue, accounts, purchase entitlements, downloads, refunds and support visibility.

Immutable hunt versions, compatibility rules and emergency warning or withdrawal.

Privacy controls, permission explanations and retention policies.

A small launch portfolio with one clear flagship in each supported format.

Store assets, onboarding, review prompts and spoiler-aware feedback.

Operational ownership for incidents, route checks, content corrections and customer communication.

## Recommended launch portfolio

| **Role** | **Purpose** | **Recommended shape** |
| --- | --- | --- |
| Flagship location hunt | Communicate the distinctive real-world proposition | 2–3 hours; nonlinear; one city district |
| Accessible location hunt | Broaden audience and test lower-friction play | 60–90 minutes; guided; strong fallbacks |
| Flagship armchair hunt | Provide an anytime product and express the Atlas brand | 90–150 minutes; rich evidence case |
| Party hunt | Demonstrate social value without complex live networking | 45–75 minutes; checkpoint synchronization |
| Introductory sampler | Reduce uncertainty and teach the interaction language | 20–30 minutes; free or bundled |

| **Launch discipline  **It is better to launch with five excellent, clearly differentiated hunts than with twenty uneven experiences that weaken trust in the whole catalogue. |
| --- |

## Commercial exit gate

Purchases and access remain consistent across reinstall, device change and refund scenarios.

The team can support real customers with defined response and escalation paths.

A safety or content defect can be mitigated quickly without an app-store release.

Unit economics and operational workload are understood well enough to plan the next catalogue investment.

# 9. Phase 5 — Catalogue and retention expansion

Once the commercial loop is reliable, the strategic focus moves from proving individual purchases to building a durable relationship with players.

## Growth levers

More hunts in proven cities before entering too many new locations.

Recurring story lines and collections that encourage cross-purchase without requiring prior knowledge.

Seasonal and event-based content using proven components.

Bundles, gifting, group entitlements and traveller-focused discovery.

Personalised recommendations based on explicit preferences and completed formats.

Creator productivity improvements that reduce lead time without lowering verification standards.

## Catalogue strategy

| **Portfolio layer** | **Role** | **Investment logic** |
| --- | --- | --- |
| Flagships | Define the brand and attract attention | High editorial and production investment |
| Core catalogue | Provide dependable choice and repeat purchase | Reusable patterns with distinct stories |
| Introductory | Teach the format and reduce purchase risk | Short, accessible and operationally simple |
| Experimental | Test mechanics, audiences or commercial models | Small exposure and explicit learning goal |
| Seasonal/event | Create urgency and community moments | Reuse infrastructure; avoid fragile one-off systems |

## Retention gate

A meaningful share of satisfied players starts or purchases another hunt.

Recommendations improve discovery rather than simply promoting the newest release.

Content production cadence is sustainable under existing editorial and field-testing capacity.

Route maintenance and customer support do not deteriorate as the catalogue grows.

# 10. Phase 6 — AI-native creation and operations

AI should be expanded after the canonical model, quality standards and review workflows are stable. Otherwise it will accelerate inconsistency rather than production.

## Priority AI capabilities

- Explain validation errors and propose minimal structured repairs.

- Draft hints, accepted-answer variants and accessibility alternatives.

- Generate a branch from explicit narrative, mechanical and difficulty constraints.

- Convert a prose specification into a reviewable graph change set.

- Analyse test data and identify likely confusion or pacing problems.

- Support localization drafts while preserving puzzle-critical text controls.

- Assist catalogue tagging, support triage and maintenance prioritisation.

## Governance

Generated changes remain drafts and are attributable in history.

Solutions, safety, historical claims, rights and location permanence require human approval.

Evaluation sets test whether AI preserves graph correctness and puzzle fairness.

Player data used for AI features follows explicit privacy and retention rules.

AI features must degrade gracefully; the core hunt remains deterministic and playable without live generation.

# 11. Phase 7 — Selective creator ecosystem

External creators can multiply catalogue growth, but they also transfer substantial editorial, safety, rights, payment and support risk to PuzzleAtlas. The platform should open in controlled layers.

## Opening sequence

- Internal creators using the full workflow.

- Invited professional partners working under direct editorial review.

- A small verified creator programme with training and release quotas.

- Submission tools for broader creators, still requiring review before sale.

- A marketplace only after moderation, rights, royalties, quality ranking and dispute processes are proven.

## Creator-platform prerequisites

| **Capability** | **Why it must precede scale** |
| --- | --- |
| Roles and permissions | Protect unpublished content, solutions and commercial settings |
| Editorial workflow | Make review state, requested changes and approval auditable |
| Rights declarations | Reduce copyright, image, audio and location-permission risk |
| Quality standards | Keep the PuzzleAtlas brand meaningful across creators |
| Revenue and tax handling | Pay creators accurately and manage disputes |
| Moderation and enforcement | Remove unsafe, misleading or unacceptable content |
| Creator analytics | Help creators improve without exposing unnecessary player data |

| **Marketplace rule  **Do not use an open marketplace as a shortcut to catalogue scale. A weak marketplace converts content risk into brand risk. |
| --- |

# 12. Cross-cutting workstreams

| **Workstream** | **Early focus** | **Mature focus** |
| --- | --- | --- |
| Architecture | Canonical schema and deterministic state | Compatibility, scale and extension governance |
| Experience design | Core play loop and open leads | Personalisation and cross-format coherence |
| Content | One reference hunt and test standards | Portfolio planning and sustainable cadence |
| Safety/accessibility | Fallbacks and explicit constraints | Audits, alternatives and continuous maintenance |
| Commercial | Value proposition and price tests | Bundles, gifting, regional strategy and unit economics |
| Operations | Issue capture and version identity | Incident response, service levels and catalogue health |
| Data | Event definitions and consent | Decision dashboards and privacy-preserving analysis |
| Brand/community | Clear product language | Collections, advocacy, events and creator reputation |

# 13. Governance and prioritisation

## Decision hierarchy

- Safety, legality, privacy and entitlement correctness.

- Ability to complete and recover the core experience.

- Puzzle fairness, narrative coherence and accessibility.

- Creator efficiency and operational maintainability.

- Commercial conversion and retention.

- Novelty, delight and experimental differentiation.

## Feature test

Which validated player or creator problem does this solve?

Which current hunt or workflow requires it?

Can an existing component or content solution address the need?

What new failure, maintenance or review burden does it create?

What evidence will show that it worked?

What will be removed or delayed to make room for it?

## Portfolio reviews

| **Cadence** | **Review** |
| --- | --- |
| Weekly | Delivery risks, defects, test findings and immediate decisions |
| Monthly | Stage evidence, quality metrics, support themes and roadmap trade-offs |
| Quarterly | Offering maturity, catalogue balance, economics and strategic assumptions |
| Per release | Readiness, compatibility, safety, rights, support and rollback |
| Per location cycle | Physical route access, observation permanence and fallback validity |

# 14. Metrics that indicate maturity

| **Area** | **Leading indicators** | **Outcome indicators** |
| --- | --- | --- |
| Creation | Time to prototype; validation errors; revision cycles | Time to publish; creator success without engineering |
| Player experience | Puzzle attempts; hint patterns; GPS fallback use | Completion, recommendation and support burden |
| Catalogue | Test coverage; release cadence; maintenance backlog | Repeat purchase and cross-format adoption |
| Reliability | Crash-free sessions; save/sync recovery; package integrity | Completed sessions without intervention |
| Commercial | Listing engagement; checkout completion; refund reasons | Revenue per customer and sustainable contribution |
| Trust | Issue response; accessibility gaps; route rechecks | Ratings, advocacy and low serious-incident frequency |

Targets should be set only after baseline testing. Early numbers are primarily diagnostic; they should not be turned into rigid performance goals before the product and sample are stable.

# 15. Principal risks and responses

| **Risk** | **Early warning** | **Strategic response** |
| --- | --- | --- |
| Studio outpaces Player | Many authoring features cannot be played reliably | Require end-to-end use before expanding components |
| Technology outpaces content | Impressive demos but weak completed hunts | Fund flagship content as a core product stream |
| Catalogue outpaces operations | Stale routes and growing support backlog | Cap releases to maintenance capacity |
| AI reduces quality | Generic puzzles, factual errors or hidden graph defects | Structured review, evaluation sets and human gates |
| Feature proliferation | Many rarely used node types and inconsistent interfaces | Component admission and deprecation process |
| Premature marketplace | Unsafe or low-quality submissions overwhelm review | Invite-only progression and enforced standards |
| Weak repeat value | Players enjoy one hunt but see no reason to return | Collections, format breadth and better discovery |
| Economics do not support quality | Field testing and support exceed revenue | Price, scope and production model experiments |

# 16. Recommended immediate plan

The next development period should produce a single convincing vertical slice and the evidence needed to plan the alpha. The sequence below is intentionally narrower than the complete vision.

- Freeze the initial schema vocabulary and define the session-state rules.

- Choose one reference location hunt and finish its graph, convergence and ending.

- Build the smallest Studio canvas that can create and export that graph.

- Build the smallest Player that interprets the exported package.

- Add save/resume, progressive hints and one simulated GPS trigger.

- Run creator usability sessions and complete-path technical tests.

- Play the hunt as content, not as a developer demo, and revise it.

- Decide whether the model is strong enough to justify backend delivery and field alpha work.

## Near-term success definition

| **Success  **A non-developer can visually revise a small nonlinear hunt, export it, and complete it in the Player prototype—with saved state, branches and convergence behaving correctly—without adding hunt-specific application code. |
| --- |

## Final strategic position

PuzzleAtlas should mature as an experience company supported by a content platform, not as a tooling project searching for content. The engine and Studio create leverage, but the brand will ultimately be built by the quality, reliability and distinctiveness of the hunts players actually complete.

PuzzleAtlas product definition  •  Working document