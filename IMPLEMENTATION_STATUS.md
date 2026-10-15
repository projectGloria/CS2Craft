# CS2 Craft backlog implementation — 14 October 2026

This records what was actually implemented from the supplied master report. The full roadmap is **not complete**. No marketplace accounts, credentials, or Steam ownership data were invented. Version: 0.4.0.

## Implemented

| Report section | Result |
|---|---|
| 1.1–1.2 | Precomputed, weighted multi-field search: names, weapons, wears/abbreviations, variants, rarity, phase, collections/cases, agent side/squad; ampersand and punctuation normalization. |
| 1.3 | Shader-specific errors and material/texture error handling; finish preparation falls back to an embedded base model when possible. Tested conversion with the installed CS2 files. |
| 1.4–1.6 | Visible-card price requests, batched IPC, no queue eviction, 15/30/60/120-second backoff, one explicit detail refresh bypass per backoff period, an explicit sort-update banner, and frozen price snapshots across subsequent pages. |
| 1.7–1.10 | Library badge/exit, viewport-clamped popovers, measured virtual rows, flexible card height, and three-digit hex support. |
| 2.1 | Search dropdown with thumbnails, rarity bars, cached quote badges, items/weapons/categories/collection/case suggestions, keyboard navigation, and recent searches/items. |
| 2.2 | `-term`, `!term`, quoted exclusions, `-wear:bs`, `-cat:slabs`, `-special:souvenir`, and `-rarity:consumer`; exclusion mode in relevant popovers and red exclusion chips. Structured exclusions remove items carrying that attribute, consistently with text operators. |
| 2.3 | Two float-range handles, price inputs, cached-price filtering, and float-cap badges. Float filtering checks whether the item's supported range overlaps the requested interval; it does not imply an owned item's exact float. |
| 2.4 | CIEDE2000 distance, two simultaneous colors, and a conservative dark-hardware palette mask. Shared palette distances are memoized per search. |
| 3.1 | CT/T categories, squad and side facets separate from esports teams, Master badge, and a persisted three-slot patch **planner**. Actual agent-specific slot geometry is not in the catalog. |
| 3.2–3.5 | Weapon-class bulk selection, blade/glove-model facets, phase labels/filter, tournament/effect/year facets, a sticker-slab toggle, and container subtypes including operation passes. |
| 4.1 | Ten-slot Consumer→Classified contracts, exact float input validation, collection outcome odds, normal/StatTrak modes, exact-wear quote requests, configurable sale-fee estimates, EV/ROI/break-even estimates, and 1,000-outcome simulation. Both normalized-input float math and the report's raw-average formula are available and labelled. |
| 4.2–4.3 | A **2D concept** studio with up to five movable/rotatable/scalable stickers, approximate scraping, a movable charm, budget completeness indicators, quote requests, PNG/JSON export and craft-code import/export. |
| 4.4 | Persisted CT/T equipment planning, weapon/side slot validation, color-themed picking, cached-value totals with missing-price counts, SVG/JSON export, and configuration-code import/export. |
| 5.1 | Local model lookup/export for gloves, agents, and charms, retaining complete meshes and materials. Default gloves, an agent, and a charm were exported from the installed game. |
| 5.3 | Map-inspired lighting presets, inspect rotation, and explicitly approximate procedural wear for supported painted weapons. |
| 6.1 | Steam wallet quotes plus cached Skinport cash quotes using its documented public API. |
| 6.2–6.3 | GBP/CAD/AUD/CNY/BRL/JPY/PLN in addition to USD/EUR/TRY; persisted quote history, 7/30/90-day charts, observed volatility, and sales-volume changes when sufficient history exists. |
| 7.1 | Read-only public inventory import by SteamID64 or vanity profile URL; asset quantities, exact-variant cached valuation, available sticker/charm descriptions, and explicit unpriced/unmatched entries. |
| 7.2–7.3 | JSON/CSV/Markdown list export, transactional JSON/code import, portable share codes, card context menus, clearer badges, page selection and jump-to-top. |

## Still outstanding / material limits

- **Source 2 Viewer upgrade:** the report assumes an available 21.0+ release. The official release listing checked during implementation still identifies **20.0** as latest. The existing official 20.0 CLI is retained; no fictional download URL was added. A future compatible release can replace it after verification. [Official releases](https://github.com/ValveResourceFormat/ValveResourceFormat/releases).
- **Exact paint projection and wear:** full Source 2 position-projected shaders, pattern seeds, finish-specific glove painting, exact sticker scraping/placement on the 3D surface, game inspect animation clips, map lighting assets, and dedicated left/right glove inspection remain unfinished. Unsupported finishes are labelled as base models. The concept studio and procedural wear are not exact in-game renders.
- **Three additional cash providers:** CSFloat, Buff163 and DMarket are not connected. They require verified provider access/authentication and tested integrations. Only Steam and Skinport prices are currently displayed. [Skinport API](https://docs.skinport.com/items), [CSFloat authentication](https://docs.csfloat.com/).
- **Inventory floats and placement:** public Steam inventory descriptions do not supply the full inspect data needed for exact float values and applied sticker coordinates. An inspect-data integration is still required. Inventory import has validation tests; a live user inventory was not fetched because no profile was supplied.
- **Additional contracts:** the calculator implements the report's ten-input rarity ladder. Five-Covert knife/glove contracts are not implemented. The supplied report formula is preserved as an explicit alternative rather than presented as a verified current Valve formula. [Reference implementation for normalized floats and collection odds](https://github.com/CS2Cap/cs2-tradeup-calculator).
- **Sharing:** codes/files are portable; there is no hosted link service or custom URI handler. CSV and Markdown are export formats; list import uses JSON or a CS2 Craft code.
- **Pricing history:** records accumulate from quotes fetched by this application. No past 90-day market history is fabricated or backfilled.
- **Palette masking:** this is a palette-level heuristic. Exact foreground hardware segmentation and re-extraction from per-pixel masks remain a potential improvement.

## Verification

- Frontend type checking and production build.
- 36 frontend regression tests and 3 viewer-script tests.
- 28 Rust unit tests, including field search, exclusions, price backoff, no queue loss, sort snapshots, and public profile validation.
- Full 29,280-item catalog integration check: persistent saves and offline image handling; measured searches 19–69 ms after caching shared palette distances.
- Actual local exports: charm definition 78, default gloves 5029, agent 4619, and painted AK-47 definition 7 / paint 282.
- Browser checks at 1366×768: multi-attribute suggestions, keyboard item opening, CT count (29), exclusion chips (23 after excluding Master agents), a full ten-input contract with two 50% outcomes, explicit test-price EV/ROI, and crafting workspace layout.

The source backup is under `.backups/before-backlog-20261014/`. Development-only browser saves remain separate from the desktop SQLite library. The installer is built from these sources; it is not installed automatically.
