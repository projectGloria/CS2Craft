use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Palette {
    pub hex: String,
    pub lab: [f64; 3],
    pub weight: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Variant {
    pub id: String,
    pub wear: String,
    pub special: String,
    pub market_hash_name: String,
    pub image: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Reference {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub id: String,
    pub source_id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub image: String,
    pub weapon: String,
    pub rarity: String,
    pub rarity_color: String,
    pub collections: Vec<Reference>,
    pub containers: Vec<Reference>,
    pub wears: Vec<String>,
    pub stattrak: bool,
    pub souvenir: bool,
    pub phase: String,
    pub effect: String,
    pub tournament: String,
    pub team: String,
    pub min_float: Option<f64>,
    pub max_float: Option<f64>,
    pub paint_index: String,
    pub market_hash_name: Option<String>,
    pub variants: Vec<Variant>,
    pub palette: Vec<Palette>,
    pub contents: Vec<String>,
    pub active: bool,
    pub attributes: BTreeMap<String, String>,
}
impl Item {
    /// Match the default variant displayed by gallery price cards.
    pub fn gallery_market_name(&self) -> Option<&str> {
        let name = if self.variants.is_empty() {
            self.market_hash_name.as_deref()
        } else {
            self.variants
                .iter()
                .find(|v| v.special == "Normal" && v.wear == "Factory New")
                .or_else(|| self.variants.iter().find(|v| v.special == "Normal"))
                .or_else(|| self.variants.first())
                .map(|v| v.market_hash_name.as_str())
        };
        name.filter(|name| !name.is_empty())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub schema_version: u32,
    pub revision: String,
    pub generated_at: String,
    pub items: Vec<Item>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchQuery {
    pub text: String,
    pub categories: Vec<String>,
    pub weapons: Vec<String>,
    pub rarities: Vec<String>,
    pub collections: Vec<String>,
    pub wears: Vec<String>,
    pub specials: Vec<String>,
    pub effects: Vec<String>,
    pub tournaments: Vec<String>,
    pub teams: Vec<String>,
    pub phases: Vec<String>,
    pub factions: Vec<String>,
    pub sides: Vec<String>,
    pub container_types: Vec<String>,
    pub years: Vec<String>,
    pub exclude_categories: Vec<String>,
    pub exclude_weapons: Vec<String>,
    pub exclude_wears: Vec<String>,
    pub exclude_specials: Vec<String>,
    pub exclude_rarities: Vec<String>,
    pub colors: Vec<String>,
    pub float_min: Option<f64>,
    pub float_max: Option<f64>,
    pub price_min: Option<f64>,
    pub price_max: Option<f64>,
    pub price_snapshot: Option<String>,
    pub color: Option<String>,
    pub color_mode: String,
    pub similarity: f64,
    pub view: String,
    pub list_id: Option<i64>,
    pub sort: String,
    pub offset: usize,
    pub limit: usize,
}
impl Default for SearchQuery {
    fn default() -> Self {
        Self {
            text: String::new(),
            categories: vec![],
            weapons: vec![],
            rarities: vec![],
            collections: vec![],
            wears: vec![],
            specials: vec![],
            effects: vec![],
            tournaments: vec![],
            teams: vec![],
            phases: vec![],
            factions: vec![], sides: vec![], container_types: vec![], years: vec![],
            exclude_categories: vec![], exclude_weapons: vec![], exclude_wears: vec![],
            exclude_specials: vec![], exclude_rarities: vec![], colors: vec![],
            float_min: None, float_max: None, price_min: None, price_max: None,
            price_snapshot: None,
            color: None,
            color_mode: "accent".into(),
            similarity: 55.,
            view: "explore".into(),
            list_id: None,
            sort: "relevance".into(),
            offset: 0,
            limit: 80,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Facet {
    pub value: String,
    pub label: String,
    pub count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub items: Vec<Item>,
    pub total: usize,
    pub facets: BTreeMap<String, Vec<Facet>>,
    pub elapsed_ms: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SavedList {
    pub id: i64,
    pub name: String,
    pub count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Saves {
    pub favorites: Vec<String>,
    pub lists: Vec<SavedList>,
    pub memberships: BTreeMap<String, Vec<i64>>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogStatus {
    pub revision: String,
    pub generated_at: String,
    pub last_checked: Option<String>,
    pub count: usize,
    pub indexed: usize,
    pub refreshing: bool,
    pub progress: usize,
    pub message: String,
    pub error: Option<String>,
    pub cache_bytes: u64,
}
