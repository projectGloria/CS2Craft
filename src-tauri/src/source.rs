use crate::{color, model::*};
use rayon::prelude::*;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap},
    io::Read,
    path::{Path, PathBuf},
    sync::atomic::{AtomicUsize, Ordering},
    time::Duration,
};

pub const FILES: &[(&str, &str)] = &[
    ("skins", "skins"),
    ("stickers", "stickers"),
    ("keychains", "charms"),
    ("highlights", "charms"),
    ("sticker_slabs", "slabs"),
    ("agents", "agents"),
    ("graffiti", "graffiti"),
    ("patches", "patches"),
    ("music_kits", "music"),
    ("crates", "containers"),
    ("collections", "collections"),
    ("collectibles", "collectibles"),
    ("keys", "keys"),
    ("tools", "tools"),
    ("pets", "other"),
    ("base_weapons", "skins"),
    ("skins_not_grouped", "variants"),
];
pub fn allowed_url(url: &url::Url) -> bool {
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port_or_known_default() == Some(443)
        && matches!(
            url.host_str(),
            Some(
                "raw.githubusercontent.com"
                    | "api.github.com"
                    | "community.akamai.steamstatic.com"
                    | "community.cloudflare.steamstatic.com"
                    | "community.fastly.steamstatic.com"
                    | "cdn.steamstatic.com"
                    | "cdn.cloudflare.steamstatic.com"
                    | "cdn.akamai.steamstatic.com"
            )
        )
}
pub fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(35))
        .connect_timeout(Duration::from_secs(12))
        .user_agent("CS2-Craft/0.1 personal-catalog")
        .redirect(reqwest::redirect::Policy::custom(|a| {
            if allowed_url(a.url()) {
                if a.previous().len() > 5 {
                    a.error("Too many redirects")
                } else {
                    a.follow()
                }
            } else {
                a.error("Untrusted redirect")
            }
        }))
        .build()
        .map_err(|e| e.to_string())
}
fn download(c: &reqwest::blocking::Client, url: &str, max: u64) -> Result<Vec<u8>, String> {
    if !allowed_url(&url::Url::parse(url).map_err(|e| e.to_string())?) {
        return Err("Image/catalog host is not supported".into());
    }
    let mut last = String::new();
    for attempt in 0..3 {
        let result = (|| {
            let response = c
                .get(url)
                .timeout(Duration::from_secs(if max > 10_000_000 { 45 } else { 12 }))
                .send()
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
            if response.content_length().unwrap_or(0) > max {
                return Err("Download too large".into());
            }
            let mut bytes = vec![];
            response
                .take(max + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() as u64 > max {
                return Err("Download too large".into());
            }
            Ok(bytes)
        })();
        match result {
            Ok(v) => return Ok(v),
            Err(e) => {
                last = e;
                if attempt < 2 {
                    std::thread::sleep(Duration::from_millis(500 * (attempt + 1)));
                }
            }
        }
    }
    Err(last)
}
pub fn revision(c: &reqwest::blocking::Client) -> Result<String, String> {
    let v: Value = serde_json::from_slice(&download(
        c,
        "https://api.github.com/repos/ByMykel/CSGO-API/commits/main",
        5_000_000,
    )?)
    .map_err(|e| e.to_string())?;
    let s = v["sha"].as_str().ok_or("Missing source revision")?;
    if s.len() != 40 || !s.bytes().all(|x| x.is_ascii_hexdigit()) {
        return Err("Invalid source revision".into());
    }
    Ok(s.into())
}
pub fn cache_path(cache: &Path, url: &str) -> PathBuf {
    cache.join(format!("{:x}.png", Sha256::digest(url.as_bytes())))
}
pub fn cache_image(
    c: &reqwest::blocking::Client,
    cache: &Path,
    url: &str,
) -> Result<PathBuf, String> {
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let path = cache_path(cache, url);
    if path.is_file() {
        return Ok(path);
    }
    let bytes = download(c, url, 8_000_000)?;
    let img = decode_image(&bytes, url)?;
    if img.width() > 4096 || img.height() > 4096 {
        return Err("Image dimensions too large".into());
    }
    static NEXT_TEMP: AtomicUsize = AtomicUsize::new(0);
    let tmp = path.with_extension(format!(
        "{}-{}.tmp",
        std::process::id(),
        NEXT_TEMP.fetch_add(1, Ordering::Relaxed)
    ));
    img.save_with_format(&tmp, image::ImageFormat::Png)
        .map_err(|e| e.to_string())?;
    match std::fs::rename(&tmp, &path) {
        Ok(_) => Ok(path),
        Err(_) if path.is_file() => {
            let _ = std::fs::remove_file(tmp);
            Ok(path)
        }
        Err(e) => Err(e.to_string()),
    }
}
pub fn decode_image(bytes: &[u8], url: &str) -> Result<image::DynamicImage, String> {
    if url.split('?').next().unwrap_or(url).ends_with(".svg") {
        let options = resvg::usvg::Options::default();
        let tree =
            resvg::usvg::Tree::from_data_nested(bytes, &options).map_err(|e| e.to_string())?;
        let scale = 512. / tree.size().width().max(tree.size().height());
        let w = (tree.size().width() * scale).ceil().max(1.) as u32;
        let h = (tree.size().height() * scale).ceil().max(1.) as u32;
        let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).ok_or("Invalid SVG size")?;
        resvg::render(
            &tree,
            resvg::tiny_skia::Transform::from_scale(scale, scale),
            &mut pixmap.as_mut(),
        );
        image::load_from_memory(&pixmap.encode_png().map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    } else {
        image::load_from_memory(bytes).map_err(|e| e.to_string())
    }
}
fn s(v: &Value, k: &str) -> String {
    v.get(k).and_then(Value::as_str).unwrap_or("").into()
}
fn scalar(v: &Value) -> String {
    if let Some(x) = v.as_str() {
        x.into()
    } else if v.is_number() {
        v.to_string()
    } else {
        String::new()
    }
}
fn named(v: &Value, k: &str) -> String {
    match v.get(k) {
        Some(Value::String(x)) => x.clone(),
        Some(x) => s(x, "name"),
        None => String::new(),
    }
}
pub fn plain_text(raw: &str) -> String {
    let raw = raw
        .replace("\\n", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n")
        .replace("<br>", "\n");
    let mut out = String::new();
    let mut inside = false;
    for c in raw.chars() {
        if c == '<' {
            inside = true;
        } else if c == '>' {
            inside = false;
        } else if !inside {
            out.push(c);
        }
    }
    out.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}
fn identity(v: &Value, file: &str) -> String {
    if file == "skins" {
        return format!(
            "skin:{}:{}:{}",
            scalar(&v["weapon"]["weapon_id"]),
            scalar(&v["paint_index"]),
            s(v, "phase")
        );
    }
    if file == "base_weapons" {
        return format!("base:{}", scalar(&v["def_index"]));
    }
    let def = scalar(&v["def_index"]);
    let mut key = if def.is_empty() { s(v, "id") } else { def };
    if file == "crates" {
        return format!(
            "crates:{}:{}",
            key,
            if s(v, "type") == "Souvenir Highlight" {
                "highlight"
            } else {
                "normal"
            }
        );
    }
    if file == "music_kits" && s(v, "id").ends_with("_st") {
        key.push_str(":st");
    }
    if file == "graffiti" {
        key.push_str(&format!(":{}", scalar(&v["tint"]["id"])));
    }
    if file == "pets" {
        key = format!("{}:{}", scalar(&v["pet_id"]), scalar(&v["style"]));
    }
    format!("{file}:{key}")
}
fn refs(v: &Value, key: &str) -> Vec<Reference> {
    v[key]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|r| Reference {
                    id: s(r, "id"),
                    name: s(r, "name"),
                })
                .collect()
        })
        .unwrap_or_default()
}
pub fn normalize(raw: &BTreeMap<String, Value>, rev: String) -> Result<Snapshot, String> {
    let mut items = vec![];
    let mut ids = HashMap::new();
    for (file, category) in FILES.iter().filter(|(_, c)| *c != "variants") {
        let records = raw
            .get(*file)
            .and_then(Value::as_array)
            .ok_or(format!("Missing or malformed category: {file}"))?;
        for v in records {
            // A few default glove definitions have no public catalog image/name.
            // They are not skin finishes and cannot be displayed or color-indexed.
            if *file == "base_weapons" && (s(v, "name").is_empty() || s(v, "image").is_empty()) {
                continue;
            }
            let mut cat = category.to_string();
            let weapon = named(v, "weapon");
            let source_cat = named(v, "category");
            if *file == "skins" {
                if source_cat == "Gloves" {
                    cat = "gloves".into()
                } else if source_cat == "Knives" {
                    cat = "knives".into()
                }
            }
            if *file == "base_weapons" {
                if source_cat == "Gloves" {
                    cat = "gloves".into()
                } else if source_cat == "Knives" {
                    cat = "knives".into()
                }
            }
            let id = identity(v, file);
            let source_id = s(v, "id");
            let mut attrs = BTreeMap::new();
            for key in [
                "paint_index",
                "def_index",
                "release_date",
                "first_sale_date",
                "type",
                "tournament_player",
                "map",
                "stage",
                "legacy_model",
                "breed",
            ] {
                let val = scalar(&v[key]);
                if !val.is_empty() {
                    attrs.insert(key.replace('_', " "), val);
                }
            }
            if !source_cat.is_empty() {
                attrs.insert("weapon class".into(), source_cat);
            }
            if *file == "pets" {
                attrs.insert("source category".into(), "Pets".into());
            }
            let item = Item {
                id: id.clone(),
                source_id: source_id.clone(),
                name: s(v, "name"),
                description: plain_text(&s(v, "description")),
                category: cat,
                image: s(v, "image"),
                weapon: if *file == "base_weapons" {
                    s(v, "name")
                } else {
                    weapon
                },
                rarity: named(v, "rarity"),
                rarity_color: s(&v["rarity"], "color"),
                collections: refs(v, "collections"),
                containers: refs(v, "crates"),
                wears: refs(v, "wears").iter().map(|r| r.name.clone()).collect(),
                stattrak: v["stattrak"].as_bool().unwrap_or(false)
                    || s(v, "name").starts_with("StatTrak"),
                souvenir: v["souvenir"].as_bool().unwrap_or(false),
                phase: s(v, "phase"),
                effect: s(v, "effect"),
                tournament: if *file == "highlights" {
                    s(v, "tournament_event")
                } else {
                    named(v, "tournament")
                },
                team: named(v, "team"),
                min_float: v["min_float"].as_f64(),
                max_float: v["max_float"].as_f64(),
                paint_index: scalar(&v["paint_index"]),
                market_hash_name: v["market_hash_name"].as_str().map(String::from),
                variants: vec![],
                palette: vec![],
                contents: [refs(v, "contains"), refs(v, "contains_rare")]
                    .concat()
                    .into_iter()
                    .map(|r| r.id)
                    .collect(),
                active: true,
                attributes: attrs,
            };
            if item.name.is_empty() || item.image.is_empty() {
                return Err(format!("Incomplete item in {file}: {source_id}"));
            }
            ids.insert(source_id, id);
            items.push(item);
        }
    }
    let variants = raw
        .get("skins_not_grouped")
        .and_then(Value::as_array)
        .ok_or("Missing skin variants")?;
    let mut groups: HashMap<String, Vec<Variant>> = HashMap::new();
    for v in variants {
        let source = s(v, "skin_id");
        let wear = named(v, "wear");
        let special = if v["stattrak"].as_bool() == Some(true) {
            "StatTrak"
        } else if v["souvenir"].as_bool() == Some(true) {
            "Souvenir"
        } else {
            "Normal"
        };
        if let Some(id) = ids.get(&source) {
            groups.entry(id.clone()).or_default().push(Variant {
                id: format!("{id}:{wear}:{special}"),
                wear,
                special: special.into(),
                market_hash_name: s(v, "market_hash_name"),
                image: s(v, "image"),
            });
        }
    }
    for item in &mut items {
        item.variants = groups.remove(&item.id).unwrap_or_default();
        if item.category == "music" {
            if let Some(name) = &item.market_hash_name {
                item.variants.push(Variant {
                    id: format!("{}:market", item.id),
                    wear: String::new(),
                    special: if item.stattrak {
                        "StatTrak".into()
                    } else {
                        "Normal".into()
                    },
                    market_hash_name: name.clone(),
                    image: item.image.clone(),
                });
            }
        }
        for r in item
            .collections
            .iter_mut()
            .chain(item.containers.iter_mut())
        {
            if let Some(id) = ids.get(&r.id) {
                r.id = id.clone();
            }
        }
        item.contents = item
            .contents
            .iter()
            .filter_map(|id| ids.get(id).cloned())
            .collect();
        // Some newer souvenir skins explicitly declare their own collection under collection.
        if item.category == "collections" && item.contents.is_empty() {
            item.contents = vec![];
        }
    }
    // Derive reverse relationships too: collections and containers should show every known member.
    let mut members: HashMap<String, Vec<String>> = HashMap::new();
    for i in &items {
        for r in i.collections.iter().chain(i.containers.iter()) {
            members.entry(r.id.clone()).or_default().push(i.id.clone());
        }
    }
    for i in &mut items {
        if let Some(m) = members.remove(&i.id) {
            i.contents.extend(m);
            i.contents.sort();
            i.contents.dedup();
        }
    }
    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.id.cmp(&b.id))
    });
    let mut unique = std::collections::HashSet::new();
    for i in &items {
        if !unique.insert(i.id.clone()) {
            return Err(format!("Duplicate canonical ID: {}", i.id));
        }
    }
    Ok(Snapshot {
        schema_version: 1,
        revision: rev,
        generated_at: chrono::Utc::now().to_rfc3339(),
        items,
    })
}
pub fn fetch_snapshot(c: &reqwest::blocking::Client, rev: &str) -> Result<Snapshot, String> {
    let raw:Result<Vec<(String,Value)>,String>=FILES.par_iter().map(|(name,_)|{
        let url=format!("https://raw.githubusercontent.com/ByMykel/CSGO-API/{rev}/public/api/en/{name}.json");
        let bytes=download(c,&url,100_000_000)?;let data:Value=serde_json::from_slice(&bytes).map_err(|e|e.to_string())?;Ok((name.to_string(),data))
    }).collect();
    normalize(&raw?.into_iter().collect(), rev.into())
}
pub fn index_palettes<F: Fn(usize, usize) + Sync>(
    snapshot: &mut Snapshot,
    c: &reqwest::blocking::Client,
    cache: &Path,
    previous: &HashMap<String, Vec<Palette>>,
    progress: F,
) -> usize {
    let n = snapshot.items.len();
    let done = AtomicUsize::new(0);
    let failures = AtomicUsize::new(0);
    snapshot.items.par_iter_mut().for_each(|i| {
        if let Some(p) = previous.get(&i.image) {
            if !p.is_empty() {
                i.palette = p.clone();
            }
        }
        if i.palette.is_empty() {
            let p = cache_image(c, cache, &i.image)
                .and_then(|path| image::open(path).map_err(|e| e.to_string()))
                .map(|img| color::extract(&img));
            match p {
                Ok(p) if !p.is_empty() => i.palette = p,
                _ => {
                    failures.fetch_add(1, Ordering::Relaxed);
                }
            }
        }
        if matches!(i.category.as_str(), "skins" | "knives") { color::mask_weapon_hardware(&mut i.palette); }
        let finished = done.fetch_add(1, Ordering::Relaxed) + 1;
        if finished % 100 == 0 || finished == n {
            progress(finished, n);
        }
    });
    failures.load(Ordering::Relaxed)
}
pub fn apply_corrections(snapshot: &mut Snapshot, bytes: &[u8]) -> Result<(), String> {
    let data: Value = serde_json::from_slice(bytes).map_err(|e| e.to_string())?;
    for i in &mut snapshot.items {
        let key = format!("name:{}", i.name);
        let val = data["items"].get(&i.id).or_else(|| data["items"].get(&key));
        if let Some(v) = val {
            let entries = v.as_array().ok_or("Invalid palette correction")?;
            let mut p = vec![];
            for entry in entries {
                let hex = s(entry, "hex");
                let rgb = color::parse_hex(&hex).ok_or("Invalid correction color")?;
                let weight = entry["weight"]
                    .as_f64()
                    .ok_or("Invalid correction weight")?;
                if !(0.0..=1.).contains(&weight) {
                    return Err("Correction weight out of range".into());
                }
                p.push(Palette {
                    hex,
                    lab: color::rgb_to_lab(rgb),
                    weight,
                });
            }
            p.sort_by(|a, b| b.weight.total_cmp(&a.weight));
            i.palette = p;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn collection_svg_is_rasterized_and_indexable() {
        let svg=br##"<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><circle cx="64" cy="64" r="40" fill="#00ff00"/></svg>"##;
        let img = decode_image(
            svg,
            "https://raw.githubusercontent.com/ByMykel/counter-strike-image-tracker/main/icon.svg",
        )
        .unwrap();
        assert_eq!(img.width(), 512);
        assert_eq!(img.to_rgba8().get_pixel(0, 0)[3], 0);
        let p = color::extract(&img);
        assert!(p[0].lab[1] < -70.);
    }
    #[test]
    fn stable_ids_include_game_variants() {
        let mut a = serde_json::json!({"id":"skin-old-image-hash","weapon":{"weapon_id":7},"paint_index":"282","phase":""});
        let before = identity(&a, "skins");
        a["id"] = Value::String("skin-new-image-hash".into());
        assert_eq!(before, identity(&a, "skins"));
        let normal = serde_json::json!({"def_index":"5120","type":"Souvenir"});
        let highlight = serde_json::json!({"def_index":"5120","type":"Souvenir Highlight"});
        assert_ne!(identity(&normal, "crates"), identity(&highlight, "crates"));
        let regular = serde_json::json!({"id":"music_kit-3","def_index":"3"});
        let tracked = serde_json::json!({"id":"music_kit-3_st","def_index":"3"});
        assert_ne!(
            identity(&regular, "music_kits"),
            identity(&tracked, "music_kits")
        );
    }
    #[test]
    fn native_requests_reject_arbitrary_hosts_and_protocols() {
        for u in [
            "file:///C:/Windows/win.ini",
            "https://example.com/image.png",
            "http://cdn.steamstatic.com/image.png",
            "https://cdn.steamstatic.com.evil.example/image.png",
            "https://user:secret@cdn.steamstatic.com/image.png",
        ] {
            assert!(!allowed_url(&url::Url::parse(u).unwrap()));
        }
        assert!(allowed_url(
            &url::Url::parse("https://cdn.steamstatic.com/apps/730/icon.png").unwrap()
        ));
    }
    #[test]
    fn descriptions_are_plain_text() {
        assert_eq!(
            plain_text("Line<br/><b>bold</b>\\n&lt;note&gt;"),
            "Line\nbold\n<note>"
        );
    }
}
