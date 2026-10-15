# CS2 Craft

A personal Windows desktop catalog for Counter-Strike 2 cosmetics. Search by name, appearance color, and category-specific properties; save favorites and lists; compare up to four items.

## Version 0.4.0

The supplied fixes report has been implemented in a broad first delivery. See [implementation status](IMPLEMENTATION_STATUS.md) for completed features, verification, and remaining work. The **Craft** menu opens trade-ups, sticker/charm concepts, CT/T loadouts, and public Steam inventory import. **Library → Export / import lists** handles portable files and share codes.

Search understands wears, variants, rarity, phases, collections/cases, factions, and exclusions such as **ak47 ft -safari**. Suggestions support arrows, Enter, Escape, and recent searches/items. CT and T agents have their own categories. Relevant filters offer an Exclude mode; side/squad filters are separate from esports teams. Float ranges check catalog-cap overlap; price ranges use known default-variant quotes. Two colors can be matched simultaneously with CIEDE2000.

## Use the app

Run the Windows installer in `release/`. It installs for the current user and creates a Start menu entry. The catalog and color index are bundled. Images download when viewed and are retained for offline use. The app checks catalog updates on launch when the previous check is older than 24 hours; manual refresh and cache controls are in **Settings & catalog**.

Discover categories and dropdown filters sit above the full-width gallery. The gallery opens directly below the top controls; the total catalog count is under **Settings & catalog → Catalog statistics**. Favorites and named lists are in the **Library** menu; settings are in the top-right gear button. Filter dropdowns support searching long option lists, multiple selections, Escape, and closing by clicking outside. Selected options appear first, followed by frequently used choices; the order stays stable while a dropdown is open. Reopening a dropdown clears its option search. Weapon names include skin thumbnails; choose a skin for each weapon under **Settings & catalog → Weapon icons**. Icon choices are retained across restarts, and unavailable or removed skins fall back to an automatic icon. **Explore all** searches across item categories. Sort order, text/color search, color mode, and tolerance are retained across navigation and restarts. Each item type and Library view remembers its own filters; **Reset filters** explicitly clears filters without changing sorting. Filters combine with AND, while multiple values in one filter combine with OR. The color slider adjusts matching tolerance; dominant matching considers the main palette clusters, while accent matching includes smaller details. The wide item detail popup places artwork, market controls, and information side by side. Belonging collections and cases appear as clickable thumbnail rows directly in Information. Lists and container contents have tabs with pagination; long case lists are paginated within Information. Wear and special selections choose the precise Steam Market name.

Favorites and lists live in SQLite under `%LOCALAPPDATA%\com.cs2craft.catalog\`. Images use the app cache directory. Clearing the image cache leaves the database and saves intact. Comparison selection is a local view preference retained across restarts. Browsing preferences, weapon icons, and usage statistics are saved in the app’s local webview storage. **Library → Your statistics** (also linked in Settings) shows weapon selections and searches, frequent search phrases, common filter choices, and item views. Activity counts start with this feature, exclude background catalog/price refreshes and preference restoration, and can be cleared from the statistics page. Searches count after a typing pause, Enter, or leaving the search box. Weapon priority combines explicit filter selections with searches that name the weapon.

## Development

Requires Node.js, Rust's Windows MSVC toolchain, the Visual Studio C++ build tools, and WebView2.

```powershell
npm ci
npm run desktop
```

The committed snapshot is ready to use; preparing it again is optional. To regenerate from a pinned upstream commit with full foreground-palette analysis:

```powershell
npm run catalog:prepare
```

The builder caches downloaded artwork under `.catalog-cache/images/` and can be rerun after a failed download. It refuses to package a partial color index. The standalone builder and desktop updater share the Rust normalization and palette code. `src-tauri/resources/color-corrections.json` accepts canonical IDs or `name:Exact Item Name`, each mapped to an array of `{ "hex": "#rrggbb", "weight": 0.3 }` corrections.

```powershell
npm test
npm run test:native
cargo run --manifest-path src-tauri/Cargo.toml --release --features verification --bin catalog-check
npm run package
```

The native integration check creates an isolated test database under `.qa/`, validates the full catalog, checks offline initialization and persistent saves, benchmarks search, and checks cached/uncached images with an unavailable network. Installer output is under `src-tauri/target/release/bundle/nsis/`.

`npm run dev` provides a development-only browser review of the same React interface using the bundled snapshot and prepared image cache. The preview's local-storage saves are separate from desktop saves. Packaged builds contain no browser adapter and use Rust/SQLite exclusively.

## Data and appearance

Catalog metadata: [ByMykel/CSGO-API](https://github.com/ByMykel/CSGO-API). The bundled snapshot records its commit SHA and generation date. Artwork references come from Steam and [counter-strike-image-tracker](https://github.com/ByMykel/counter-strike-image-tracker). MIT notices for the catalog and tracker software are bundled under `resources/licenses`; underlying artwork belongs to its respective owners. CS2 Craft is unofficial and is not affiliated with Valve.

The catalog mirrors upstream definitions, which can include legacy or unreleased items. Definitions without a usable name/image are excluded from default weapon entries. Images and palettes are representative, rather than exact float/seed renders; holographic finishes and pattern-dependent skins can look different in-game. Failed updates retain the previous validated catalog. Source items removed by later updates remain accessible through saved references.

Steam Market prices are fetched directly from the Community Market price overview endpoint. Visible gallery cards request default variants in batches; detail views prioritize exact wear/special names. USD, EUR, TRY, GBP, CAD, AUD, CNY, BRL, JPY, and PLN are available. Quotes are retained in **prices.sqlite**, reused for an hour, and recorded for price-history charts. Unknown prices are explicitly identified.

The queue keeps every admitted request and sends at most one request every four seconds. Network/server errors trigger 15/30/60/120-second backoff; an explicit detail refresh may bypass a backoff once. Price sorting uses a frozen cache snapshot across pages, with unknown quotes last. New quotes show an update-order banner instead of moving cards automatically. Skinport's public cash quotes are available in details and cached for 15 minutes; unsupported JPY cash quotes are explicitly shown in USD. Other marketplaces are not integrated yet.

## Offline 3D

Open a weapon or knife and select **3D view** above its image. Drag to rotate, scroll to zoom, use reset or auto-rotate, or expand the viewer. The app locates CS2 through Steam, exports the weapon geometry and textures locally, and caches a self-contained GLB under the app cache's `models/` directory. No viewer account, subscription, remote rendering, or internet connection is needed. The first view can take tens of seconds; later views reuse the prepared asset. CS2 must be installed. Updating its VPK invalidates the conversion cache. Clearing the image cache does not remove 3D assets.

The viewer supports weapon, knife, default-glove, agent, and charm model export and clean approximations of solid, anodized, custom paint, and gunsmith finishes. Paint textures, UV geometry, and protected regions come from the installed game. Position-projected paint styles show a clearly labelled base weapon model. Wear, CS2 pattern seeds, applied stickers, StatTrak counters, pearlescence, and other special effects are not simulated. An independent approximate wear slider is available for supported painted models. Glove finish projection and exact in-game shaders remain unsupported; base models are labelled. Lighting presets, inspect rotation, and procedural wear are approximations.

Builds run `scripts/prepare-viewer.mjs` to bundle a private Node runtime, the conversion script, and the official Source 2 Viewer CLI 20.0. If absent, the build downloads that pinned CLI from its official GitHub release once. The running app performs local file conversion only. Source 2 Viewer, Node, pngjs, and Three.js notices are included under `resources/licenses`; exported game assets belong to Valve and their original creators. The conversion script uses Source 2 Viewer's material DATA blocks to avoid dependence on current compiled shader formats. Rendering is a browser PBR approximation of the game shaders.

Public inventory import and the crafting planners are implemented. Exact inspect floats, surface placement, projected paint shaders, and wear/seed rendering remain unfinished; see IMPLEMENTATION_STATUS.md.
