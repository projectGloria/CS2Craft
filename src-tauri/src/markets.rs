use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::Read, path::Path, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
#[derive(Clone, Deserialize)]
struct Listing { market_hash_name: String, currency: String, min_price: Option<f64>, quantity: u64, updated_at: i64 }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CashQuote { pub provider: String, pub currency: String, pub price: Option<f64>, pub quantity: u64, pub checked_at: String, pub error: Option<String> }
type Cache = HashMap<String, (Instant, HashMap<String, Listing>)>;
static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
pub fn skinport(name: &str, currency: &str, directory: &Path) -> Result<CashQuote, String> {
    if !["USD", "EUR", "TRY", "GBP", "CAD", "AUD", "CNY", "BRL", "PLN"].contains(&currency) { return Err("Skinport does not support this currency".into()); }
    let mut cache = CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock().map_err(|_| "Cash price cache is busy")?;
    let path = directory.join(format!("skinport-{currency}.json")); let mut error = None;
    if !cache.get(currency).is_some_and(|(checked, _)| checked.elapsed() < Duration::from_secs(900)) {
        let request = || -> Result<Vec<u8>, String> {
            let client = reqwest::blocking::Client::builder().brotli(true).timeout(Duration::from_secs(30)).redirect(reqwest::redirect::Policy::none()).user_agent("CS2Craft price comparison").build().map_err(|e| e.to_string())?;
            let response = client.get("https://api.skinport.com/v1/items").query(&[("app_id", "730"), ("currency", currency), ("tradable", "1")]).header("Accept-Encoding", "br").send().map_err(|_| "Could not reach Skinport")?;
            if !response.status().is_success() { return Err(format!("Skinport price request failed ({})", response.status())); }
            let mut bytes = Vec::new(); response.take(32_000_001).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            if bytes.len() > 32_000_000 { return Err("Skinport response exceeds size limit".into()); } Ok(bytes)
        };
        let bytes = match request() {
            Ok(bytes) => { let _: Vec<Listing> = serde_json::from_slice(&bytes).map_err(|_| "Invalid Skinport response")?; std::fs::create_dir_all(directory).map_err(|e| e.to_string())?; std::fs::write(&path, &bytes).map_err(|e| e.to_string())?; bytes }
            Err(failure) => { error = Some(format!("{failure}. Showing saved cash quotes.")); std::fs::read(&path).map_err(|_| failure)? }
        };
        let listings: Vec<Listing> = serde_json::from_slice(&bytes).map_err(|_| "Invalid cached Skinport data")?;
        cache.insert(currency.into(), (Instant::now(), listings.into_iter().filter(|l| l.currency == currency && l.min_price.is_none_or(|p| p.is_finite() && p >= 0.)).map(|l| (l.market_hash_name.clone(), l)).collect()));
    }
    let listing = cache.get(currency).and_then(|(_, items)| items.get(name));
    Ok(CashQuote { provider: "Skinport".into(), currency: currency.into(), price: listing.and_then(|l| l.min_price), quantity: listing.map_or(0, |l| l.quantity), checked_at: listing.and_then(|l| chrono::DateTime::from_timestamp(l.updated_at, 0)).map_or_else(|| chrono::Utc::now().to_rfc3339(), |d| d.to_rfc3339()), error })
}
