//! Steam Community Market quotes. No credentials or third-party pricing service.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    io::Read,
    path::Path,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub market_hash_name: String,
    pub currency: String,
    pub lowest_price: Option<String>,
    pub median_price: Option<String>,
    pub volume: Option<String>,
    pub checked_at: Option<String>,
    #[serde(default)]
    pub pending: bool,
    #[serde(default)]
    pub error: Option<String>,
}
#[derive(Deserialize)]
struct Response {
    success: bool,
    lowest_price: Option<String>,
    median_price: Option<String>,
    volume: Option<String>,
}
type Key = (String, String);
#[derive(Default)]
struct Queue {
    revision: u64,
    quotes: HashMap<Key, Quote>,
    history: HashMap<Key, Vec<Quote>>,
    waiting: VecDeque<Key>,
    active: Option<Key>,
    attempts: HashMap<Key, Instant>,
    paused_until: Option<Instant>,
    failures: u32,
    bypass: Option<Key>,
    bypass_used: bool,
    snapshots: VecDeque<(String, String, HashMap<String, u64>)>,
}
impl Queue {
    fn finish(&mut self, key: Key, result: Result<Quote, String>) {
        self.active = None;
        match result {
            Ok(quote) => {
                self.failures = 0; self.paused_until = None; self.bypass_used = false;
                if self.quotes.get(&key).and_then(|q| q.lowest_price.as_ref())
                    != quote.lowest_price.as_ref()
                {
                    self.revision += 1;
                }
                self.quotes.insert(key, quote);
            }
            Err(mut error) => {
                // An unavailable listing must not block prices for other items.
                if !error.starts_with("Steam did not return a quote") {
                    let seconds = 15u64 * (1u64 << self.failures.min(3));
                    self.failures = self.failures.saturating_add(1);
                    self.paused_until = Some(Instant::now() + Duration::from_secs(seconds));
                    error = format!("{error} Background requests retry in {seconds}s.");
                    if !self.bypass_used { self.bypass = None; }
                    if !self.waiting.contains(&key) { self.waiting.push_back(key.clone()); }
                }
                let quote = self.quotes.entry(key.clone()).or_insert_with(|| Quote {
                    market_hash_name: key.0,
                    currency: key.1,
                    ..Default::default()
                });
                quote.error = Some(error);
            }
        }
    }
}
#[derive(Clone)]
pub struct Prices(Arc<(Mutex<Queue>, Condvar)>);

pub fn currency_id(currency: &str) -> Result<u8, String> {
    match currency {
        "USD" => Ok(1),
        "EUR" => Ok(3),
        "TRY" => Ok(17),
        "GBP" => Ok(2), "CAD" => Ok(20), "AUD" => Ok(21), "CNY" => Ok(23),
        "BRL" => Ok(7), "JPY" => Ok(8), "PLN" => Ok(6),
        _ => Err("Unsupported price currency".into()),
    }
}
fn initialize(c: &Connection) -> Result<(), String> {
    c.execute_batch("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS quotes(name TEXT NOT NULL,currency TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(name,currency)); CREATE TABLE IF NOT EXISTS history(name TEXT NOT NULL,currency TEXT NOT NULL,checked TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(name,currency,checked));").map_err(|e| e.to_string())
}
fn store(c: &Connection, q: &Quote) -> Result<(), String> {
    c.execute("INSERT INTO quotes VALUES(?1,?2,?3) ON CONFLICT(name,currency) DO UPDATE SET data=excluded.data", params![q.market_hash_name, q.currency, serde_json::to_string(q).map_err(|e| e.to_string())?]).map_err(|e|e.to_string())?;
    if let Some(checked) = &q.checked_at {
        c.execute("INSERT OR IGNORE INTO history VALUES(?1,?2,?3,?4)", params![q.market_hash_name, q.currency, checked, serde_json::to_string(q).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        c.execute("DELETE FROM history WHERE checked < ?1", [(chrono::Utc::now() - chrono::Duration::days(90)).to_rfc3339()]).map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn parse(bytes: &[u8], name: &str, currency: &str) -> Result<Quote, String> {
    let r: Response =
        serde_json::from_slice(bytes).map_err(|_| "Steam returned an invalid price response")?;
    if !r.success {
        return Err("Steam did not return a quote for this listing".into());
    }
    for s in [&r.lowest_price, &r.median_price, &r.volume]
        .into_iter()
        .flatten()
    {
        if s.len() > 80 || s.chars().any(|c| c.is_control()) {
            return Err("Steam returned an invalid price value".into());
        }
    }
    Ok(Quote {
        market_hash_name: name.into(),
        currency: currency.into(),
        lowest_price: r.lowest_price.filter(|s| !s.is_empty()),
        median_price: r.median_price.filter(|s| !s.is_empty()),
        volume: r.volume.filter(|s| !s.is_empty()),
        checked_at: Some(chrono::Utc::now().to_rfc3339()),
        ..Default::default()
    })
}
fn fetch(client: &reqwest::blocking::Client, key: &Key) -> Result<Quote, String> {
    let response = client
        .get("https://steamcommunity.com/market/priceoverview/")
        .query(&[
            ("appid", "730".to_string()),
            ("currency", currency_id(&key.1)?.to_string()),
            ("market_hash_name", key.0.clone()),
        ])
        .send()
        .map_err(|_| "Unable to reach Steam. Cached prices are retained.".to_string())?;
    if response.status().as_u16() == 429 {
        return Err("Steam is limiting requests (HTTP 429). Cached prices are retained.".into());
    }
    if !response.status().is_success() {
        return Err(format!(
            "Steam price request failed ({}). Cached prices are retained.",
            response.status()
        ));
    }
    let mut bytes = Vec::new();
    response
        .take(65_537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65_536 {
        return Err("Steam returned an oversized price response".into());
    }
    parse(&bytes, &key.0, &key.1)
}
fn fresh(q: &Quote) -> bool {
    q.checked_at
        .as_deref()
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .is_some_and(|t| chrono::Utc::now().signed_duration_since(t).num_seconds() < 3600)
}
/// Steam may format currencies with either decimal separator and grouping symbols.
fn price_cents(value: &str) -> Option<u64> {
    if value.contains('-') {
        return None;
    }
    let digits: String = value
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.' || *c == ',')
        .collect();
    let decimal = digits
        .rfind(['.', ','])
        .filter(|&pos| matches!(digits.len() - pos - 1, 1 | 2));
    let (whole, fraction) = decimal
        .map(|pos| (&digits[..pos], &digits[pos + 1..]))
        .unwrap_or((&digits, ""));
    let whole: String = whole.chars().filter(char::is_ascii_digit).collect();
    let whole = whole.parse::<u64>().ok()?;
    let fraction = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<u64>().ok()?.checked_mul(10)?,
        2 => fraction.parse::<u64>().ok()?,
        _ => return None,
    };
    whole.checked_mul(100)?.checked_add(fraction)
}
impl Prices {
    pub fn sort_snapshot(&self, token: &str, currency: &str) -> Result<HashMap<String, u64>, String> {
        if token.len() > 100 { return Err("Invalid price snapshot".into()); }
        currency_id(currency)?;
        let mut q = self.0.0.lock().map_err(|_| "Price cache is busy")?;
        if let Some((_, _, prices)) = q.snapshots.iter().find(|(id, c, _)| id == token && c == currency) { return Ok(prices.clone()); }
        let prices: HashMap<String, u64> = q.quotes.iter().filter_map(|((name, c), quote)| if c == currency { price_cents(quote.lowest_price.as_deref()?).map(|value| (name.clone(), value)) } else { None }).collect();
        if q.snapshots.len() >= 8 { q.snapshots.pop_front(); }
        q.snapshots.push_back((token.into(), currency.into(), prices.clone()));
        Ok(prices)
    }
    pub fn cached_quote(&self, name: &str, currency: &str) -> Result<Option<Quote>, String> {
        currency_id(currency)?;
        Ok(self.0.0.lock().map_err(|_| "Price cache is busy")?.quotes.get(&(name.into(), currency.into())).cloned())
    }
    pub fn history(&self, name: &str, currency: &str) -> Result<Vec<Quote>, String> {
        currency_id(currency)?;
        Ok(self.0.0.lock().map_err(|_| "Price cache is busy")?.history.get(&(name.into(), currency.into())).cloned().unwrap_or_default())
    }
    pub fn revision(&self) -> Result<u64, String> {
        Ok(self
            .0
             .0
            .lock()
            .map_err(|_| "Price cache is busy")?
            .revision)
    }
    /// Read the existing cache only; sorting must not enqueue full-catalog requests.
    pub fn cached_prices(&self, currency: &str) -> Result<HashMap<String, u64>, String> {
        currency_id(currency)?;
        let queue = self.0 .0.lock().map_err(|_| "Price cache is busy")?;
        Ok(queue
            .quotes
            .iter()
            .filter_map(|((name, stored_currency), quote)| {
                if stored_currency != currency {
                    return None;
                }
                price_cents(quote.lowest_price.as_deref()?).map(|value| (name.clone(), value))
            })
            .collect())
    }
    pub fn start(path: &Path) -> Result<Self, String> {
        let c = Connection::open(path).map_err(|e| e.to_string())?;
        initialize(&c)?;
        let mut queue = Queue::default();
        {
            let mut stmt = c
                .prepare("SELECT data FROM quotes")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |r| r.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            for raw in rows.flatten() {
                if let Ok(mut quote) = serde_json::from_str::<Quote>(&raw) {
                    quote.pending = false;
                    quote.error = None;
                    queue.quotes.insert(
                        (quote.market_hash_name.clone(), quote.currency.clone()),
                        quote,
                    );
                }
            }
        }
        {
            let mut stmt = c.prepare("SELECT data FROM history ORDER BY checked").map_err(|e| e.to_string())?;
            for raw in stmt.query_map([], |r| r.get::<_, String>(0)).map_err(|e| e.to_string())?.flatten() {
                if let Ok(quote) = serde_json::from_str::<Quote>(&raw) { queue.history.entry((quote.market_hash_name.clone(), quote.currency.clone())).or_default().push(quote); }
            }
        }
        let service = Self(Arc::new((Mutex::new(queue), Condvar::new())));
        let worker = service.clone();
        std::thread::spawn(move || {
            let client = match reqwest::blocking::Client::builder()
                .timeout(Duration::from_secs(20))
                .connect_timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent("CS2Craft/0.2 personal catalog")
                .build()
            {
                Ok(c) => c,
                Err(_) => return,
            };
            let mut next_request = Instant::now();
            loop {
                let key = {
                    let (mutex, cond) = &*worker.0;
                    let mut q = mutex.lock().unwrap();
                    loop {
                        let bypass = q.waiting.front().is_some_and(|key| q.bypass.as_ref() == Some(key));
                        let until = if bypass { next_request } else { q.paused_until.unwrap_or(next_request).max(next_request) };
                        if q.waiting.is_empty() {
                            q = cond.wait(q).unwrap();
                        } else if until > Instant::now() {
                            q = cond
                                .wait_timeout(q, until.saturating_duration_since(Instant::now()))
                                .unwrap()
                                .0;
                        } else {
                            break;
                        }
                    }
                    let key = q.waiting.pop_front().unwrap();
                    if q.bypass.as_ref() == Some(&key) { q.bypass = None; }
                    q.attempts.insert(key.clone(), Instant::now());
                    q.active = Some(key.clone());
                    key
                };
                let result = fetch(&client, &key).and_then(|quote| {
                    store(&c, &quote)?;
                    Ok(quote)
                });
                let mut q = worker.0 .0.lock().unwrap();
                if let Ok(quote) = &result {
                    let points = q.history.entry(key.clone()).or_default(); points.push(quote.clone());
                    let cutoff = (chrono::Utc::now() - chrono::Duration::days(90)).to_rfc3339();
                    points.retain(|p| p.checked_at.as_ref().is_some_and(|t| t >= &cutoff));
                }
                q.finish(key, result);
                next_request = Instant::now() + Duration::from_secs(4);
            }
        });
        Ok(service)
    }
    pub fn get(
        &self,
        name: &str,
        currency: &str,
        priority: bool,
        refresh: bool,
    ) -> Result<Quote, String> {
        currency_id(currency)?;
        let key = (name.to_string(), currency.to_string());
        let (mutex, cond) = &*self.0;
        let mut q = mutex.lock().map_err(|_| "Price cache is busy")?;
        let mut quote = q.quotes.get(&key).cloned().unwrap_or_else(|| Quote {
            market_hash_name: name.into(),
            currency: currency.into(),
            ..Default::default()
        });
        let queued = q.waiting.contains(&key) || q.active.as_ref() == Some(&key);
        let attempted = q
            .attempts
            .get(&key)
            .is_some_and(|t| t.elapsed() < Duration::from_secs(if refresh { 60 } else { 600 }));
        let paused = q.paused_until.is_some_and(|t| t > Instant::now());
        if !paused { q.bypass = None; q.bypass_used = false; }
        let bypass = paused && priority && refresh && !q.bypass_used;
        if bypass { q.bypass = Some(key.clone()); q.bypass_used = true; }
        if !queued && !attempted && (refresh || !fresh(&quote)) {
            if priority && (q.bypass.is_none() || q.bypass.as_ref() == Some(&key)) {
                q.waiting.push_front(key.clone());
            } else {
                q.waiting.push_back(key.clone());
            }
            cond.notify_one();
        } else if priority && q.waiting.contains(&key) && (q.bypass.is_none() || q.bypass.as_ref() == Some(&key)) {
            q.waiting.retain(|k| k != &key);
            q.waiting.push_front(key.clone());
            cond.notify_one();
        }
        quote.pending = q.waiting.contains(&key) || q.active.as_ref() == Some(&key);
        if paused && quote.error.is_none() {
            let seconds = q.paused_until.unwrap().saturating_duration_since(Instant::now()).as_secs();
            quote.error = Some(format!("Steam prices are backing off for {seconds}s. Cached quotes remain available."));
        }
        Ok(quote)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_localized_prices_numerically() {
        for (raw, cents) in [
            ("$1,234.56", 123456),
            ("1.234,56€", 123456),
            ("₺1 234,56", 123456),
            ("0,03 TL", 3),
            ("$9.9", 990),
            ("$0.00", 0),
            ("$1,234", 123400),
            ("€ 1\u{a0}234,56", 123456),
        ] {
            assert_eq!(price_cents(raw), Some(cents), "{raw}");
        }
        assert_eq!(price_cents("Unavailable"), None);
        assert_eq!(price_cents("-1.00"), None);
        assert_eq!(price_cents("18446744073709551615.99"), None);
    }
    #[test]
    fn exponential_backoff_and_single_explicit_bypass() {
        let mut queue = Queue::default(); let key = ("item".into(), "USD".into());
        for seconds in [15, 30, 60, 120, 120] {
            queue.finish(key.clone(), Err("Steam is limiting requests (HTTP 429).".into()));
            let remaining = queue.paused_until.unwrap().saturating_duration_since(Instant::now()).as_secs();
            assert!(remaining >= seconds - 1 && remaining <= seconds);
        }
        let prices = Prices(Arc::new((Mutex::new(queue), Condvar::new())));
        assert!(prices.get("detail", "USD", true, true).unwrap().pending);
        let bypass = prices.0.0.lock().unwrap().bypass.clone();
        assert_eq!(bypass.as_ref().unwrap().0, "detail");
        prices.get("another", "USD", true, true).unwrap();
        assert_eq!(prices.0.0.lock().unwrap().bypass, bypass);
    }
    #[test]
    fn price_sort_snapshot_does_not_shift_later_pages() {
        let prices = Prices(Arc::new((Mutex::new(Queue::default()), Condvar::new())));
        assert!(prices.sort_snapshot("page-session", "USD").unwrap().is_empty());
        prices.0.0.lock().unwrap().quotes.insert(("a".into(), "USD".into()), Quote { lowest_price: Some("$5.00".into()), ..Default::default() });
        assert!(prices.sort_snapshot("page-session", "USD").unwrap().is_empty());
        assert_eq!(prices.sort_snapshot("next-session", "USD").unwrap().get("a"), Some(&500));
    }
    #[test]
    fn sorting_cache_is_currency_specific_and_does_not_queue_requests() {
        let mut queue = Queue::default();
        for (currency, price) in [("USD", "$2.00"), ("EUR", "1,50€"), ("TRY", "99,50 TL")] {
            let quote = Quote {
                market_hash_name: "item".into(),
                currency: currency.into(),
                lowest_price: Some(price.into()),
                ..Default::default()
            };
            queue.quotes.insert(("item".into(), currency.into()), quote);
        }
        queue
            .quotes
            .insert(("missing".into(), "USD".into()), Quote::default());
        let service = Prices(Arc::new((Mutex::new(queue), Condvar::new())));
        assert_eq!(
            service.cached_prices("USD").unwrap(),
            HashMap::from([("item".into(), 200)])
        );
        assert_eq!(
            service.cached_prices("EUR").unwrap().get("item"),
            Some(&150)
        );
        assert_eq!(
            service.cached_prices("TRY").unwrap().get("item"),
            Some(&9950)
        );
        assert!(service.cached_prices("XYZ").is_err());
        assert!(service.0 .0.lock().unwrap().waiting.is_empty());
        let quote = parse(br#"{"success":true,"lowest_price":"$3.00"}"#, "item", "USD").unwrap();
        service
            .0
             .0
            .lock()
            .unwrap()
            .finish(("item".into(), "USD".into()), Ok(quote.clone()));
        assert_eq!(service.revision().unwrap(), 1);
        service
            .0
             .0
            .lock()
            .unwrap()
            .finish(("item".into(), "USD".into()), Ok(quote));
        assert_eq!(service.revision().unwrap(), 1);
    }
    #[test]
    fn handles_live_and_missing_listings() {
        let q = parse(
            br#"{"success":true,"lowest_price":"$33.03","median_price":"$31.60","volume":"74"}"#,
            "AK-47 | Redline (Field-Tested)",
            "USD",
        )
        .unwrap();
        assert_eq!(q.lowest_price.as_deref(), Some("$33.03"));
        assert_eq!(q.market_hash_name, "AK-47 | Redline (Field-Tested)");
        assert!(parse(br#"{"success":true}"#, "x", "USD")
            .unwrap()
            .lowest_price
            .is_none());
        assert!(parse(br#"{"success":false}"#, "x", "USD").is_err());
        assert!(parse(b"<html>error</html>", "x", "USD").is_err());
    }
    #[test]
    fn unavailable_listing_does_not_pause_other_items() {
        let mut q = Queue::default();
        q.finish(
            ("missing".into(), "USD".into()),
            parse(br#"{"success":false}"#, "missing", "USD"),
        );
        assert!(q.paused_until.is_none());
        assert!(q.quotes.values().next().unwrap().error.is_some());
    }
    #[test]
    fn cached_quote_roundtrip_and_variant_isolation() {
        let c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        for name in [
            "AK-47 | Redline (Field-Tested)",
            "StatTrak™ AK-47 | Redline (Field-Tested)",
        ] {
            store(
                &c,
                &parse(br#"{"success":true,"lowest_price":"$33.03"}"#, name, "USD").unwrap(),
            )
            .unwrap();
        }
        assert_eq!(
            c.query_row("SELECT COUNT(*) FROM quotes", [], |r| r.get::<_, i32>(0))
                .unwrap(),
            2
        );
        let raw: String = c
            .query_row(
                "SELECT data FROM quotes WHERE name=?1",
                ["AK-47 | Redline (Field-Tested)"],
                |r| r.get(0),
            )
            .unwrap();
        assert!(fresh(&serde_json::from_str::<Quote>(&raw).unwrap()));
        assert!(currency_id("XYZ").is_err());
    }
    #[test]
    fn failed_refresh_preserves_cached_quote_and_keeps_all_requests() {
        let key = ("item".into(), "USD".into());
        let mut q = Queue::default();
        q.quotes.insert(
            key.clone(),
            parse(br#"{"success":true,"lowest_price":"$1.25"}"#, "item", "USD").unwrap(),
        );
        q.active = Some(key.clone());
        q.finish(key.clone(), Err("Unable to reach Steam".into()));
        assert!(q.active.is_none());
        assert!(q.paused_until.is_some());
        let service = Prices(Arc::new((Mutex::new(q), Condvar::new())));
        let quote = service.get("item", "USD", true, true).unwrap();
        assert_eq!(quote.lowest_price.as_deref(), Some("$1.25"));
        assert!(quote.error.is_some());
        assert!(quote.pending);
        service.0 .0.lock().unwrap().paused_until = None;
        for i in 0..100 {
            service
                .get(&format!("item-{i}"), "USD", false, false)
                .unwrap();
        }
        assert_eq!(service.0 .0.lock().unwrap().waiting.len(), 101);
        service.get("detail", "USD", true, false).unwrap();
        assert_eq!(
            service.0 .0.lock().unwrap().waiting.front().unwrap().0,
            "detail"
        );
    }
}
