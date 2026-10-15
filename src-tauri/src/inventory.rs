use crate::{model::Item, search::Catalog};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Read};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OwnedItem { pub asset_id: String, pub name: String, pub quantity: u32, pub item: Option<Item>, pub variant_id: Option<String>, pub details: Vec<String> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inventory { pub steam_id: String, pub items: Vec<OwnedItem> }
#[derive(Deserialize)]
struct Asset { assetid: String, classid: String, instanceid: String, amount: String }
#[derive(Deserialize)]
struct Description { classid: String, instanceid: String, market_hash_name: Option<String>, name: String, #[serde(default)] descriptions: Vec<serde_json::Value> }
#[derive(Deserialize)]
struct Page { success: Option<u8>, #[serde(default)] assets: Vec<Asset>, #[serde(default)] descriptions: Vec<Description>, more_items: Option<u8>, last_assetid: Option<String>, error: Option<String> }
fn response(client: &reqwest::blocking::Client, url: &str, query: &[(&str, &str)]) -> Result<Vec<u8>, String> {
    let response = client.get(url).query(query).send().map_err(|_| "Could not reach Steam. Try again shortly.")?;
    if !response.status().is_success() { return Err(format!("Steam inventory request failed ({}). The inventory must be public.", response.status())); }
    let mut bytes = Vec::new(); response.take(15_000_001).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    if bytes.len() > 15_000_000 { return Err("Steam inventory response exceeds the size limit.".into()); } Ok(bytes)
}
fn profile(input: &str) -> Result<(bool, String), String> {
    let input = input.trim();
    if input.len() == 17 && input.bytes().all(|c| c.is_ascii_digit()) { return Ok((false, input.into())); }
    let value = if input.starts_with("https://") {
        let url = url::Url::parse(input).map_err(|_| "Invalid Steam profile URL")?;
        if url.host_str() != Some("steamcommunity.com") || !url.username().is_empty() || url.password().is_some() || url.port_or_known_default() != Some(443) { return Err("Use a steamcommunity.com profile URL".into()); }
        let parts = url.path_segments().ok_or("Invalid Steam profile URL")?.filter(|p| !p.is_empty()).collect::<Vec<_>>();
        if parts.len() != 2 || !matches!(parts[0], "id" | "profiles") { return Err("Use a SteamID64 or Steam vanity profile URL".into()); }
        if parts[0] == "profiles" { return profile(parts[1]); }
        parts[1].to_string()
    } else { input.to_string() };
    if value.is_empty() || value.len() > 64 || !value.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-')) { return Err("Invalid Steam vanity name".into()); }
    Ok((true, value))
}
pub fn fetch(input: &str, catalog: &Catalog) -> Result<Inventory, String> {
    let client = reqwest::blocking::Client::builder().timeout(std::time::Duration::from_secs(25)).redirect(reqwest::redirect::Policy::none()).user_agent("CS2Craft public inventory reader").build().map_err(|e| e.to_string())?;
    let (vanity, mut steam_id) = profile(input)?;
    if vanity {
        let bytes = response(&client, &format!("https://steamcommunity.com/id/{steam_id}/"), &[("xml", "1")])?;
        let xml = String::from_utf8_lossy(&bytes);
        steam_id = xml.split("<steamID64>").nth(1).and_then(|s| s.split("</steamID64>").next()).map(str::trim).ok_or("Could not resolve this Steam profile")?.to_string();
        if steam_id.len() != 17 || !steam_id.bytes().all(|c| c.is_ascii_digit()) { return Err("Steam returned an invalid profile identifier".into()); }
    }
    let mut lookup = HashMap::new();
    for item in &catalog.items {
        if let Some(name) = &item.market_hash_name { lookup.entry(name.as_str()).or_insert((item, None)); }
        for variant in &item.variants { lookup.entry(variant.market_hash_name.as_str()).or_insert((item, Some(variant.id.clone()))); }
    }
    let mut items = Vec::new(); let mut cursor = String::new();
    loop {
        let bytes = response(&client, &format!("https://steamcommunity.com/inventory/{steam_id}/730/2"), &[("l", "english"), ("count", "5000"), ("start_assetid", &cursor)])?;
        let page: Page = serde_json::from_slice(&bytes).map_err(|_| "Steam returned an invalid inventory response")?;
        if page.success != Some(1) { return Err(page.error.unwrap_or_else(|| "This Steam inventory is private or unavailable".into())); }
        let descriptions: HashMap<_, _> = page.descriptions.iter().map(|d| ((d.classid.as_str(), d.instanceid.as_str()), d)).collect();
        for asset in page.assets {
            let Some(description) = descriptions.get(&(asset.classid.as_str(), asset.instanceid.as_str())) else { continue; };
            let name = description.market_hash_name.as_ref().unwrap_or(&description.name);
            let matched = lookup.get(name.as_str());
            let details = description.descriptions.iter().filter_map(|d| d["value"].as_str()).filter(|s| s.contains("Sticker:") || s.contains("Charm:")).map(|s| {
                let mut text = String::new(); let mut tag = false; for c in s.chars() { if c == '<' { tag = true; } else if c == '>' { tag = false; text.push(' '); } else if !tag { text.push(c); } } text
            }).collect();
            items.push(OwnedItem { asset_id: asset.assetid, name: name.clone(), quantity: asset.amount.parse::<u32>().unwrap_or(1).clamp(1, 100000), item: matched.map(|(item, _)| (*item).clone()), variant_id: matched.and_then(|(_, variant)| variant.clone()), details });
        }
        if page.more_items != Some(1) { break; }
        if items.len() >= 20000 { return Err("Inventory exceeds 20,000 assets. No partial inventory was imported.".into()); }
        let next = page.last_assetid.ok_or("Steam omitted the inventory page cursor")?;
        if next == cursor { return Err("Steam repeated an inventory page; try again later".into()); } cursor = next;
        std::thread::sleep(std::time::Duration::from_secs(1));
    }
    Ok(Inventory { steam_id, items })
}
#[cfg(test)] mod tests { use super::*;
    #[test] fn validates_profiles_and_rejects_foreign_hosts() {
        assert_eq!(profile("76561198000000000").unwrap(), (false, "76561198000000000".into()));
        assert_eq!(profile("https://steamcommunity.com/id/example/").unwrap(), (true, "example".into()));
        assert!(profile("https://example.org/id/x").is_err()); assert!(profile("https://steamcommunity.com@evil.test/id/x").is_err());
        assert!(profile("../../foo").is_err());
    }
}
