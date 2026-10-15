pub mod color;
pub mod inventory;
pub mod markets;
pub mod db;
pub mod model;
pub mod prices;
pub mod search;
pub mod source;
pub mod viewer;
use model::*;
use search::Catalog;
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock},
};
use tauri::{Emitter, Manager};
use tauri_plugin_opener::OpenerExt;

struct Inner {
    db: Mutex<rusqlite::Connection>,
    catalog: RwLock<Catalog>,
    status: Mutex<CatalogStatus>,
    cache: PathBuf,
    client: reqwest::blocking::Client,
    corrections: Vec<u8>,
    cache_lock: RwLock<()>,
    prices: prices::Prices,
}
#[derive(Clone)]
struct State(Arc<Inner>);
#[tauri::command]
async fn prepare_model(app: tauri::AppHandle, state: tauri::State<'_, State>, id: String) -> Result<viewer::Preview, String> {
    let item = state.0.catalog.read().map_err(|_| err_lock())?.find(&id).cloned().ok_or("Item not found")?;
    let resources = app.path().resource_dir().map_err(|e| e.to_string())?;
    let cache = app.path().app_cache_dir().map_err(|e| e.to_string())?.join("models");
    tauri::async_runtime::spawn_blocking(move || viewer::prepare(&item, &resources, &cache)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn get_price(
    state: tauri::State<'_, State>,
    id: String,
    variant_id: Option<String>,
    currency: String,
    priority: bool,
    refresh: bool,
) -> Result<prices::Quote, String> {
    let name = {
        let catalog = state.0.catalog.read().map_err(|_| err_lock())?;
        let item = catalog.find(&id).ok_or("Item not found")?;
        if let Some(variant_id) = variant_id {
            item.variants
                .iter()
                .find(|v| v.id == variant_id)
                .map(|v| v.market_hash_name.clone())
                .ok_or("Variant not found")?
        } else if item.variants.is_empty() {
            item.market_hash_name
                .clone()
                .ok_or("This item has no market listing")?
        } else {
            return Err("Select an available wear and special variant".into());
        }
    };
    if name.is_empty() {
        return Err("This item has no market listing".into());
    }
    state.0.prices.get(&name, &currency, priority, refresh)
}
fn err_lock() -> String {
    "Local data is busy; restart the app if this persists".into()
}
#[tauri::command]
fn get_price_revision(state: tauri::State<'_, State>) -> Result<u64, String> {
    state.0.prices.revision()
}
#[tauri::command]
fn import_list(state: tauri::State<'_, State>, name: String, ids: Vec<String>) -> Result<Saves, String> {
    db::import_list(&*state.0.db.lock().map_err(|_| err_lock())?, &name, &ids)
}
#[tauri::command]
async fn import_inventory(state: tauri::State<'_, State>, profile: String) -> Result<inventory::Inventory, String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let catalog = s.0.catalog.read().map_err(|_| err_lock())?;
        inventory::fetch(&profile, &catalog)
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_cash_price(app: tauri::AppHandle, state: tauri::State<'_, State>, id: String, variant_id: Option<String>, currency: String) -> Result<markets::CashQuote, String> {
    let name = {
        let catalog = state.0.catalog.read().map_err(|_| err_lock())?; let item = catalog.find(&id).ok_or("Item not found")?;
        if let Some(variant) = variant_id { item.variants.iter().find(|v| v.id == variant).map(|v| v.market_hash_name.clone()) } else { item.gallery_market_name().map(str::to_string) }.ok_or("No market listing")?
    };
    let cache = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("cash-prices");
    tauri::async_runtime::spawn_blocking(move || markets::skinport(&name, &currency, &cache)).await.map_err(|e| e.to_string())?
}
#[tauri::command]
fn get_cached_price(state: tauri::State<'_, State>, id: String, currency: String, variant_id: Option<String>) -> Result<Option<prices::Quote>, String> {
    let catalog = state.0.catalog.read().map_err(|_| err_lock())?;
    let item = catalog.find(&id).ok_or("Item not found")?;
    let name = if let Some(variant) = variant_id { item.variants.iter().find(|v| v.id == variant).map(|v| v.market_hash_name.as_str()) } else { item.gallery_market_name() };
    match name { Some(name) => state.0.prices.cached_quote(name, &currency), None => Ok(None) }
}
#[tauri::command]
fn get_prices(state: tauri::State<'_, State>, ids: Vec<String>, currency: String) -> Result<HashMap<String, prices::Quote>, String> {
    if ids.len() > 80 { return Err("Request at most 80 visible prices".into()); }
    let catalog = state.0.catalog.read().map_err(|_| err_lock())?;
    let mut quotes = HashMap::new();
    for id in ids { if let Some(name) = catalog.find(&id).and_then(Item::gallery_market_name) { quotes.insert(id, state.0.prices.get(name, &currency, false, false)?); } }
    Ok(quotes)
}
#[tauri::command]
fn get_price_history(state: tauri::State<'_, State>, id: String, variant_id: Option<String>, currency: String) -> Result<Vec<prices::Quote>, String> {
    let catalog = state.0.catalog.read().map_err(|_| err_lock())?;
    let item = catalog.find(&id).ok_or("Item not found")?;
    let name = if let Some(variant) = variant_id { item.variants.iter().find(|v| v.id == variant).map(|v| v.market_hash_name.as_str()) } else { item.gallery_market_name() }.ok_or("No market listing")?;
    state.0.prices.history(name, &currency)
}
#[tauri::command]
async fn search_catalog(
    state: tauri::State<'_, State>,
    query: SearchQuery,
    currency: Option<String>,
) -> Result<SearchResult, String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if query.text.chars().count() > 200 {
            return Err("Search text is too long".into());
        }
        if let Some(color) = &query.color {
            if color::parse_hex(color).is_none() {
                return Err("Invalid search color".into());
            }
        }
        if query.colors.len() + usize::from(query.color.is_some()) > 2 || query.colors.iter().any(|c| color::parse_hex(c).is_none()) { return Err("Choose at most two valid search colors".into()); }
        for (min, max, ceiling) in [(query.float_min, query.float_max, 1.), (query.price_min, query.price_max, f64::MAX)] {
            if min.into_iter().chain(max).any(|v| !v.is_finite() || v < 0. || v > ceiling) || min.zip(max).is_some_and(|(a,b)| a > b) { return Err("Invalid filter range: minimum must not exceed maximum".into()); }
        }
        let saves = db::saves(&*s.0.db.lock().map_err(|_| err_lock())?)?;
        if query.sort == "price_asc" || query.sort == "price_desc" || query.price_min.is_some() || query.price_max.is_some() {
            let currency = currency.as_deref().unwrap_or("USD");
            let prices = if let Some(token) = &query.price_snapshot { s.0.prices.sort_snapshot(token, currency)? } else { s.0.prices.cached_prices(currency)? };
            return Ok(s
                .0
                .catalog
                .read()
                .map_err(|_| err_lock())?
                .search_with_prices(&query, &saves, &prices));
        }
        Ok(s.0
            .catalog
            .read()
            .map_err(|_| err_lock())?
            .search(&query, &saves))
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn get_item(state: tauri::State<'_, State>, id: String) -> Result<Item, String> {
    state
        .0
        .catalog
        .read()
        .map_err(|_| err_lock())?
        .find(&id)
        .cloned()
        .ok_or("Item not found".into())
}
#[tauri::command]
async fn get_saves(state: tauri::State<'_, State>) -> Result<Saves, String> {
    db::saves(&*state.0.db.lock().map_err(|_| err_lock())?)
}
#[tauri::command]
async fn get_weapon_icons(
    state: tauri::State<'_, State>,
    selections: HashMap<String, String>,
) -> Result<Vec<Item>, String> {
    Ok(state
        .0
        .catalog
        .read()
        .map_err(|_| err_lock())?
        .weapon_icons(&selections))
}
#[tauri::command]
async fn save_action(
    state: tauri::State<'_, State>,
    action: String,
    item_id: Option<String>,
    list_id: Option<i64>,
    name: Option<String>,
) -> Result<Saves, String> {
    db::save_action(
        &*state.0.db.lock().map_err(|_| err_lock())?,
        &action,
        item_id.as_deref(),
        list_id,
        name.as_deref(),
    )
}
#[tauri::command]
async fn resolve_image(
    state: tauri::State<'_, State>,
    id: String,
    variant_id: Option<String>,
) -> Result<String, String> {
    let s = state.inner().clone();
    let url = {
        let cat = s.0.catalog.read().map_err(|_| err_lock())?;
        let i = cat.find(&id).ok_or("Item not found")?;
        if let Some(id) = variant_id {
            i.variants
                .iter()
                .find(|v| v.id == id)
                .map(|v| v.image.clone())
                .ok_or("Variant not found")?
        } else {
            i.image.clone()
        }
    };
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = s.0.cache_lock.read().map_err(|_| err_lock())?;
        source::cache_image(&s.0.client, &s.0.cache, &url).map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_market(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
    id: String,
    variant_id: Option<String>,
) -> Result<(), String> {
    let name = {
        let cat = state.0.catalog.read().map_err(|_| err_lock())?;
        let i = cat.find(&id).ok_or("Item not found")?;
        if let Some(v) = variant_id {
            i.variants
                .iter()
                .find(|x| x.id == v)
                .map(|x| x.market_hash_name.clone())
                .ok_or("Variant not found")?
        } else {
            i.market_hash_name
                .clone()
                .ok_or("Select an available wear and special variant")?
        }
    };
    if name.is_empty() {
        return Err("This item has no market listing".into());
    }
    app.opener()
        .open_url(search::market_url(&name), None::<&str>)
        .map_err(|e| e.to_string())
}
fn cache_bytes(path: &std::path::Path) -> u64 {
    std::fs::read_dir(path)
        .map(|d| {
            d.flatten()
                .filter_map(|e| e.metadata().ok())
                .filter(|m| m.is_file())
                .map(|m| m.len())
                .sum()
        })
        .unwrap_or(0)
}
#[tauri::command]
async fn get_status(state: tauri::State<'_, State>) -> Result<CatalogStatus, String> {
    let mut status = state.0.status.lock().map_err(|_| err_lock())?.clone();
    status.cache_bytes = cache_bytes(&state.0.cache);
    Ok(status)
}
#[tauri::command]
async fn clear_cache(state: tauri::State<'_, State>) -> Result<(), String> {
    let s = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _g = s.0.cache_lock.write().map_err(|_| err_lock())?;
        if s.0.status.lock().map_err(|_| err_lock())?.refreshing {
            return Err("Wait for catalog refresh to finish".into());
        }
        if s.0.cache.is_dir() {
            for e in std::fs::read_dir(&s.0.cache).map_err(|e| e.to_string())? {
                let p = e.map_err(|e| e.to_string())?.path();
                if p.is_file() {
                    std::fs::remove_file(p).map_err(|e| e.to_string())?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn notify(app: &tauri::AppHandle, s: &State, message: &str, progress: usize) {
    if let Ok(mut st) = s.0.status.lock() {
        st.message = message.into();
        st.progress = progress;
        let _ = app.emit("catalog-status", st.clone());
    }
}
fn refresh(app: tauri::AppHandle, s: State) -> Result<(), String> {
    let result = (|| {
        let now = chrono::Utc::now().to_rfc3339();
        db::set_meta(
            &*s.0.db.lock().map_err(|_| err_lock())?,
            "last_checked",
            &now,
        )?;
        s.0.status.lock().map_err(|_| err_lock())?.last_checked = Some(now.clone());
        let rev = source::revision(&s.0.client)?;
        if rev == s.0.status.lock().map_err(|_| err_lock())?.revision {
            db::set_meta(
                &*s.0.db.lock().map_err(|_| err_lock())?,
                "last_checked",
                &now,
            )?;
            let mut st = s.0.status.lock().map_err(|_| err_lock())?;
            st.last_checked = Some(now);
            st.message = "Catalog is up to date".into();
            return Ok(());
        }
        notify(&app, &s, "Downloading catalog metadata…", 3);
        let mut snapshot = source::fetch_snapshot(&s.0.client, &rev)?;
        let previous: HashMap<String, Vec<Palette>> =
            s.0.catalog
                .read()
                .map_err(|_| err_lock())?
                .items
                .iter()
                .map(|i| (i.image.clone(), i.palette.clone()))
                .collect();
        let failed = source::index_palettes(
            &mut snapshot,
            &s.0.client,
            &s.0.cache,
            &previous,
            |done, n| {
                notify(
                    &app,
                    &s,
                    &format!("Indexing colors · {done}/{n}"),
                    5 + done * 90 / n.max(1),
                )
            },
        );
        source::apply_corrections(&mut snapshot, &s.0.corrections)?;
        if failed > 0 {
            return Err(format!("{failed} images could not be indexed. Your previous catalog is intact. Retry to resume."));
        }
        notify(&app, &s, "Applying validated catalog…", 97);
        let items = {
            let mut c = s.0.db.lock().map_err(|_| err_lock())?;
            db::import(&mut c, &snapshot)?;
            db::set_meta(&c, "last_checked", &now)?;
            db::load(&c)?
        };
        let count = snapshot.items.len();
        *s.0.catalog.write().map_err(|_| err_lock())? = Catalog::new(items);
        let mut st = s.0.status.lock().map_err(|_| err_lock())?;
        st.revision = rev;
        st.generated_at = snapshot.generated_at;
        st.last_checked = Some(now);
        st.count = count;
        st.indexed = count;
        st.message = "Catalog updated".into();
        Ok(())
    })();
    {
        let mut st = s.0.status.lock().map_err(|_| err_lock())?;
        st.refreshing = false;
        st.progress = 100;
        if let Err(ref e) = result {
            st.error = Some(e.clone());
            st.message = "Refresh failed · previous catalog preserved".into();
        }
        let _ = app.emit("catalog-status", st.clone());
    }
    result
}
#[tauri::command]
async fn refresh_catalog(
    app: tauri::AppHandle,
    state: tauri::State<'_, State>,
) -> Result<(), String> {
    let s = state.inner().clone();
    {
        let mut st = s.0.status.lock().map_err(|_| err_lock())?;
        if st.refreshing {
            return Ok(());
        }
        st.refreshing = true;
        st.error = None;
        st.message = "Checking source updates…".into();
        st.progress = 0;
    }
    tauri::async_runtime::spawn_blocking(move || refresh(app, s));
    Ok(())
}
pub fn run() {
    let _ = rayon::ThreadPoolBuilder::new()
        .num_threads(12)
        .build_global();
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = app.path().app_local_data_dir()?;
            let cache = app.path().app_cache_dir()?.join("images");
            std::fs::create_dir_all(&data)?;
            std::fs::create_dir_all(&cache)?;
            let resources = app.path().resource_dir()?;
            let mut connection = rusqlite::Connection::open(data.join("catalog.sqlite"))?;
            db::initialize(&connection)?;
            let snapshot: Snapshot =
                serde_json::from_slice(&std::fs::read(resources.join("resources/catalog.json"))?)?;
            if db::get_meta(&connection, "revision").is_none() {
                db::import(&mut connection, &snapshot)?;
            }
            let items = db::load(&connection)?;
            let count = items.iter().filter(|i| i.active).count();
            let status = CatalogStatus {
                revision: db::get_meta(&connection, "revision").unwrap_or_default(),
                generated_at: db::get_meta(&connection, "generated_at").unwrap_or_default(),
                last_checked: db::get_meta(&connection, "last_checked"),
                count,
                indexed: items
                    .iter()
                    .filter(|i| i.active && !i.palette.is_empty())
                    .count(),
                message: "Ready".into(),
                ..Default::default()
            };
            let due = status
                .last_checked
                .as_deref()
                .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
                .is_none_or(|t| chrono::Utc::now().signed_duration_since(t).num_hours() >= 24);
            let state = State(Arc::new(Inner {
                db: Mutex::new(connection),
                catalog: RwLock::new(Catalog::new(items)),
                status: Mutex::new(status),
                cache,
                client: source::client()?,
                corrections: std::fs::read(resources.join("resources/color-corrections.json"))?,
                cache_lock: RwLock::new(()),
                prices: prices::Prices::start(&data.join("prices.sqlite"))?,
            }));
            app.manage(state.clone());
            if due {
                let handle = app.handle().clone();
                state.0.status.lock().unwrap().refreshing = true;
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = refresh(handle, state);
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_cached_price, get_prices, get_price_history, import_list, import_inventory, get_cash_price,
            prepare_model,
            search_catalog,
            get_price,
            get_price_revision,
            get_weapon_icons,
            get_item,
            get_saves,
            save_action,
            resolve_image,
            open_market,
            get_status,
            clear_cache,
            refresh_catalog
        ])
        .run(tauri::generate_context!())
        .expect("Unable to start CS2 Craft");
}
