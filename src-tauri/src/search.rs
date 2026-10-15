use crate::{color, model::*};
use std::collections::{BTreeMap, HashMap, HashSet};
pub struct Catalog {
    pub items: Vec<Item>,
    names: Vec<SearchIndex>,
    colors: Vec<[f64; 3]>,
    palette_indices: Vec<Vec<usize>>,
}
pub fn normalize(s: &str) -> String {
    s.replace('&', "and").chars()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}
impl Catalog {
    pub fn new(mut items: Vec<Item>) -> Self {
        for item in &mut items { if matches!(item.category.as_str(), "skins" | "knives") { color::mask_weapon_hardware(&mut item.palette); } }
        let names = items
            .iter()
            .map(SearchIndex::new)
            .collect();
        let mut ids = HashMap::new(); let mut colors = Vec::new();
        let palette_indices = items.iter().map(|item| item.palette.iter().map(|p| {
            let key = p.lab.map(f64::to_bits);
            *ids.entry(key).or_insert_with(|| { let id = colors.len(); colors.push(p.lab); id })
        }).collect()).collect();
        Self { items, names, colors, palette_indices }
    }
    pub fn find(&self, id: &str) -> Option<&Item> {
        self.items.iter().find(|i| i.id == id)
    }
    pub fn weapon_icons(&self, selections: &HashMap<String, String>) -> Vec<Item> {
        let mut icons: BTreeMap<&str, &Item> = BTreeMap::new();
        for item in self
            .items
            .iter()
            .filter(|item| item.active && !item.weapon.is_empty() && !item.image.is_empty())
        {
            let rank = |candidate: &Item| {
                (
                    selections
                        .get(&candidate.weapon)
                        .is_none_or(|id| id != &candidate.id),
                    !candidate.name.contains(" | "),
                    candidate.name.clone(),
                    candidate.id.clone(),
                )
            };
            let icon = icons.entry(&item.weapon).or_insert(item);
            if rank(item) < rank(icon) {
                *icon = item;
            }
        }
        icons.into_values().cloned().collect()
    }
    pub fn search(&self, q: &SearchQuery, saves: &Saves) -> SearchResult {
        self.search_with_prices(q, saves, &HashMap::new())
    }
    pub fn search_with_prices(
        &self,
        q: &SearchQuery,
        saves: &Saves,
        prices: &HashMap<String, u64>,
    ) -> SearchResult {
        let start = std::time::Instant::now();
        let (positive, negative) = parse_query(&q.text);
        let text = normalize(&positive.join(" "));
        let tokens = positive.iter().map(|s| normalize(s)).filter(|s| !s.is_empty()).collect::<Vec<_>>();
        let targets = q.color.iter().chain(q.colors.iter()).take(2)
            .filter_map(|s| color::parse_hex(s).map(color::rgb_to_lab)).collect::<Vec<_>>();
        let mut color_distances: Vec<Vec<Option<f64>>> = targets.iter().map(|_| vec![None; self.colors.len()]).collect();
        let favorite: HashSet<&str> = saves.favorites.iter().map(String::as_str).collect();
        let mut matches = vec![];
        let mut facets: BTreeMap<String, BTreeMap<String, (String, usize)>> = BTreeMap::new();
        for (idx, i) in self.items.iter().enumerate() {
            if q.view == "favorites" {
                if !favorite.contains(i.id.as_str()) {
                    continue;
                }
            } else if q.view == "list" {
                if !saves
                    .memberships
                    .get(&i.id)
                    .is_some_and(|m| q.list_id.is_some_and(|id| m.contains(&id)))
                {
                    continue;
                }
            } else if !i.active {
                continue;
            }
            let index = &self.names[idx];
            if negative.iter().any(|term| index.excludes(term))
                || q.exclude_categories.iter().any(|c| category_matches(c, i))
                || q.exclude_weapons.contains(&i.weapon) || q.exclude_rarities.contains(&i.rarity) {
                continue;
            }
            if q.exclude_wears.iter().any(|w| index.matches(Some("wear"), w)) || q.exclude_specials.iter().any(|s| index.matches(Some("special"), s)) { continue; }
            let Some(name_score) = text_score(index, &text, &tokens) else {
                continue;
            };
            let mut color_score = 0.; let mut color_matches = true;
            for (target_id, target) in targets.iter().enumerate() {
                let distance = i.palette.iter().enumerate().filter(|(p, color)| q.color_mode != "dominant" || *p < 2 && color.weight >= 0.15).map(|(p, _)| {
                    let id = self.palette_indices[idx][p];
                    *color_distances[target_id][id].get_or_insert_with(|| color::delta_e_2000(&self.colors[id], target))
                }).fold(f64::INFINITY, f64::min);
                if distance > 6. + q.similarity.clamp(0., 100.) * 0.35 { color_matches = false; break; }
                color_score += distance;
            }
            if !color_matches { continue; }
            // Facets describe this category/text/color context; other selections stay available for OR filtering.
            add(&mut facets, "categories", &i.category, &i.category);
            if i.category == "agents" { let side = if i.team == "Counter-Terrorist" { "ct_agents" } else { "t_agents" }; add(&mut facets, "categories", side, side); }
            if !q.categories.is_empty() && !q.categories.iter().any(|c| category_matches(c, i)) {
                continue;
            }
            add(&mut facets, "weapons", &i.weapon, &i.weapon);
            add(&mut facets, "rarities", &i.rarity, &i.rarity);
            for r in &i.collections {
                add(&mut facets, "collections", &r.id, &r.name);
            }
            for w in &i.wears {
                add(&mut facets, "wears", w, w);
            }
            for (key, value) in [
                ("effects", &i.effect),
                ("tournaments", &i.tournament),
                ("phases", &i.phase),
            ] {
                add(&mut facets, key, value, value);
            }
            if matches!(i.team.as_str(), "Counter-Terrorist" | "Terrorist" | "Both Teams") { add(&mut facets, "sides", &i.team, &i.team); }
            else { add(&mut facets, "teams", &i.team, &i.team); }
            let faction = &index.faction; let subtype = &index.subtype; let years = &index.years;
            add(&mut facets, "factions", &faction, &faction);
            add(&mut facets, "containerTypes", &subtype, &subtype);
            for year in years { add(&mut facets, "years", year, year); }
            if i.stattrak {
                add(&mut facets, "specials", "StatTrak", "StatTrak");
            }
            if i.souvenir {
                add(&mut facets, "specials", "Souvenir", "Souvenir");
            }
            if !i.variants.is_empty() {
                add(&mut facets, "specials", "Normal", "Normal");
            }
            if !one(&q.weapons, &i.weapon)
                || !one(&q.rarities, &i.rarity)
                || !many(
                    &q.collections,
                    &i.collections
                        .iter()
                        .map(|r| r.id.clone())
                        .collect::<Vec<_>>(),
                )
                || !one(&q.effects, &i.effect)
                || !one(&q.tournaments, &i.tournament)
                || !one(&q.teams, &i.team)
                || !one(&q.phases, &i.phase)
                || !one(&q.factions, &faction) || !one(&q.sides, &i.team) || !one(&q.container_types, &subtype) || !many(&q.years, &years)
            {
                continue;
            }
            if !q.wears.is_empty() || !q.specials.is_empty() {
                if !i
                    .variants
                    .iter()
                    .any(|v| one(&q.wears, &v.wear) && one(&q.specials, &v.special) && !q.exclude_wears.contains(&v.wear) && !q.exclude_specials.contains(&v.special))
                {
                    continue;
                }
            }
            if q.float_min.is_some() || q.float_max.is_some() {
                if !i.min_float.zip(i.max_float).is_some_and(|(min, max)| max >= q.float_min.unwrap_or(0.) && min <= q.float_max.unwrap_or(1.)) { continue; }
            }
            if q.price_min.is_some() || q.price_max.is_some() {
                if !i.gallery_market_name().and_then(|name| prices.get(name)).is_some_and(|cents| {
                    let price = *cents as f64 / 100.; price >= q.price_min.unwrap_or(0.) && price <= q.price_max.unwrap_or(f64::INFINITY)
                }) { continue; }
            }
            matches.push((idx, name_score as f64 * 100. + color_score));
        }
        matches.sort_by(|a, b| {
            if q.sort == "price_asc" || q.sort == "price_desc" {
                let left = self.items[a.0]
                    .gallery_market_name()
                    .and_then(|name| prices.get(name));
                let right = self.items[b.0]
                    .gallery_market_name()
                    .and_then(|name| prices.get(name));
                let order = match (left, right) {
                    (Some(left), Some(right)) if q.sort == "price_desc" => right.cmp(left),
                    (Some(left), Some(right)) => left.cmp(right),
                    (Some(_), None) => std::cmp::Ordering::Less,
                    (None, Some(_)) => std::cmp::Ordering::Greater,
                    (None, None) => std::cmp::Ordering::Equal,
                };
                order.then(a.0.cmp(&b.0))
            } else if q.sort != "name" {
                a.1.total_cmp(&b.1).then(a.0.cmp(&b.0))
            } else {
                a.0.cmp(&b.0)
            }
        });
        let total = matches.len();
        let items = matches
            .into_iter()
            .skip(q.offset)
            .take(q.limit.clamp(1, 200))
            .map(|(idx, _)| self.items[idx].clone())
            .collect();
        let facets = facets
            .into_iter()
            .map(|(k, v)| {
                let mut values: Vec<Facet> = v
                    .into_iter()
                    .map(|(value, (label, count))| Facet {
                        value,
                        label,
                        count,
                    })
                    .collect();
                values.sort_by(|a, b| a.label.cmp(&b.label));
                (k, values)
            })
            .collect();
        SearchResult {
            items,
            total,
            facets,
            elapsed_ms: start.elapsed().as_secs_f64() * 1000.,
        }
    }
}
fn one(values: &[String], v: &str) -> bool {
    values.is_empty() || values.iter().any(|x| x == v)
}
fn many(values: &[String], vs: &[String]) -> bool {
    values.is_empty() || values.iter().any(|x| vs.contains(x))
}
fn add(
    f: &mut BTreeMap<String, BTreeMap<String, (String, usize)>>,
    key: &str,
    value: &str,
    label: &str,
) {
    if !value.is_empty() {
        let v = f
            .entry(key.into())
            .or_default()
            .entry(value.into())
            .or_insert((label.into(), 0));
        v.1 += 1;
    }
}
pub fn category_matches(category: &str, i: &Item) -> bool {
    match category {
        "ct_agents" => i.category == "agents" && i.team == "Counter-Terrorist",
        "t_agents" => i.category == "agents" && i.team == "Terrorist",
        "containers" => i.category == "containers" || i.category == "tools" && container_type(i) == "Operation passes",
        _ => category == i.category,
    }
}
pub fn faction(i: &Item) -> String {
    if i.category == "agents" { i.name.split(" | ").nth(1).unwrap_or("").into() } else { String::new() }
}
pub fn container_type(i: &Item) -> String {
    if i.category != "containers" && i.category != "tools" { return String::new(); }
    let n = i.name.to_lowercase();
    if n.contains("souvenir") && n.contains("package") { "Souvenir packages" }
    else if n.contains("autograph") && n.contains("capsule") { "Autograph capsules" }
    else if n.contains("capsule") { "Sticker capsules" }
    else if n.contains("case") { "Weapon cases" }
    else if n.contains("pass") { "Operation passes" } else { "Other containers" }.into()
}
fn years(i: &Item) -> Vec<String> {
    format!("{} {}", i.name, i.tournament).split(|c: char| !c.is_ascii_digit())
        .filter(|s| s.len() == 4 && s.starts_with("20")).map(str::to_string).collect::<HashSet<_>>().into_iter().collect()
}
fn wear_alias(s: &str) -> &str {
    match s { "Factory New" => "fn", "Minimal Wear" => "mw", "Field-Tested" => "ft", "Well-Worn" => "ww", "Battle-Scarred" => "bs", _ => "" }
}
struct SearchIndex { name: String, fields: Vec<(String, String, u16)>, words: Vec<String>, faction: String, subtype: String, years: Vec<String> }
impl SearchIndex {
    fn new(i: &Item) -> Self {
        let mut fields = Vec::new();
        let mut push = |field: &str, value: &str, weight| { if !value.is_empty() {
            fields.push((field.into(), normalize(value), weight));
            for word in value.replace('&', " and ").split(|c: char| !c.is_alphanumeric()).filter(|s| !s.is_empty()) { fields.push((field.into(), normalize(word), weight)); }
        } };
        push("name", &i.name, 100); push("weapon", &i.weapon, 80); push("phase", &i.phase, 75);
        for r in &i.collections { push("collection", &r.name, 50); }
        for r in &i.containers { push("case", &r.name, 50); }
        for wear in i.wears.iter().chain(i.variants.iter().map(|v| &v.wear)) { push("wear", wear, 35); push("wear", wear_alias(wear), 35); }
        if i.stattrak { push("special", "stattrak", 35); push("special", "st", 35); }
        if i.souvenir { push("special", "souvenir", 35); }
        if i.variants.iter().any(|v| v.special == "Normal") { push("special", "normal", 35); }
        push("rarity", &i.rarity, 35); push("cat", &i.category, 35);
        push("team", &i.team, 35); push("faction", &faction(i), 35);
        if i.category == "agents" { push("cat", if i.team == "Counter-Terrorist" { "ct_agents" } else { "t_agents" }, 35); push("team", if i.team == "Counter-Terrorist" { "ct" } else { "t" }, 35); }
        push("effect", &i.effect, 35); push("tournament", &i.tournament, 50);
        let words = i.name.replace('&', " and ").split(|c: char| !c.is_alphanumeric()).map(normalize).filter(|s| !s.is_empty()).collect();
        Self { name: normalize(&i.name), fields, words, faction: faction(i), subtype: container_type(i), years: years(i) }
    }
    fn matches(&self, field: Option<&str>, value: &str) -> bool {
        let value = normalize(value);
        !value.is_empty() && self.fields.iter().any(|(f, v, _)| {
            field.is_none_or(|x| x == f) && if value.len() <= 2 { v == &value } else { v.contains(&value) }
        })
    }
    fn excludes(&self, term: &str) -> bool {
        if let Some((field, value)) = term.split_once(':') {
            let field = match field { "category" => "cat", "container" => "case", "variant" => "special", _ => field };
            self.matches(Some(field), value)
        } else { self.matches(None, term) }
    }
}
fn parse_query(text: &str) -> (Vec<String>, Vec<String>) {
    let mut positive = Vec::new(); let mut negative = Vec::new();
    // Quotes preserve multi-word exclusions such as -"black pearl".
    let mut token = String::new(); let mut quoted = false;
    for c in text.chars().chain(std::iter::once(' ')) {
        if c == '"' { quoted = !quoted; }
        else if c.is_whitespace() && !quoted {
            if !token.is_empty() {
                if token.starts_with(['-', '!']) && token.len() > 1 { negative.push(token[1..].to_string()); } else { positive.push(token.clone()); }
                token.clear();
            }
        } else { token.push(c); }
    }
    if !token.is_empty() { positive.push(token); }
    (positive, negative)
}
fn text_score(index: &SearchIndex, text: &str, tokens: &[String]) -> Option<u16> {
    if text.is_empty() { return Some(0); }
    if index.name == text { return Some(0); }
    if index.name.contains(text) { return Some(1); }
    let mut score = 0;
    for token in tokens {
        if let Some(weight) = index.fields.iter().filter(|(_, value, _)| if token.len() <= 2 { value == token } else { value.contains(token) }).map(|(_, _, w)| *w).max() {
            score += 100 - weight;
        } else if token.len() >= 4 && index.words.iter().any(|word| strsim::levenshtein(token, word) <= if token.len() >= 8 { 2 } else { 1 }) { score += 90; }
        else { return None; }
    }
    Some(2 + score)
}
pub fn market_url(name: &str) -> String {
    let mut u = url::Url::parse("https://steamcommunity.com/market/listings/730/").unwrap();
    u.path_segments_mut().unwrap().pop_if_empty().push(name);
    u.to_string()
}
#[cfg(test)]
mod tests {
    use super::*;
    fn item(id: &str, name: &str, category: &str, weapon: &str) -> Item {
        Item {
            id: id.into(),
            name: name.into(),
            category: category.into(),
            weapon: weapon.into(),
            active: true,
            ..Default::default()
        }
    }
    #[test]
    fn names_and_boolean_filters() {
        assert_eq!(normalize("FİELD-TESTED"), "fieldtested");
        let c = Catalog::new(vec![
            item("a", "AK-47 | Redline", "skins", "AK-47"),
            item("b", "M4A4 | Redline", "skins", "M4A4"),
            item("c", "Sticker | Redline", "stickers", ""),
        ]);
        let mut q = SearchQuery {
            text: "ak47 redlne".into(),
            ..Default::default()
        };
        assert_eq!(c.search(&q, &Saves::default()).total, 1);
        q.text = "redline".into();
        q.categories = vec!["skins".into(), "stickers".into()];
        q.weapons = vec!["M4A4".into()];
        assert_eq!(c.search(&q, &Saves::default()).items[0].id, "b");
    }
    #[test]
    fn searches_attributes_aliases_punctuation_and_negative_operators() {
        let mut skin = item("a", "AK-47 | Doppler", "skins", "AK-47");
        skin.phase = "Sapphire".into(); skin.rarity = "Covert".into(); skin.stattrak = true;
        skin.wears = vec!["Field-Tested".into()];
        skin.collections = vec![Reference { id: "dreams".into(), name: "Dreams & Nightmares".into() }];
        let mut agent = item("b", "Commander | SEAL Team 6", "agents", ""); agent.team = "Counter-Terrorist".into();
        let catalog = Catalog::new(vec![skin, agent]);
        for (text, total) in [("ak 47 ft stattrak covert sapphire", 1), ("dreams and nightmares", 1), ("field tested", 1), ("ct seal", 1), ("ak47 -doppler", 0), ("ak47 !safari", 1), ("-wear:ft", 1), ("-cat:ct_agents", 1), ("-special:st", 1)] {
            assert_eq!(catalog.search(&SearchQuery { text: text.into(), ..Default::default() }, &Saves::default()).total, total, "{text}");
        }
        let result = catalog.search(&SearchQuery { categories: vec!["ct_agents".into()], factions: vec!["SEAL Team 6".into()], ..Default::default() }, &Saves::default());
        assert_eq!(result.items[0].id, "b");
        assert_eq!(catalog.search(&SearchQuery { exclude_wears: vec!["Field-Tested".into()], ..Default::default() }, &Saves::default()).total, 1);
    }
    #[test]
    fn float_overlap_and_cached_price_range_are_applied_before_pagination() {
        let mut i = item("a", "Float capped", "skins", "AWP"); i.min_float = Some(0.18); i.max_float = Some(1.); i.market_hash_name = Some("a".into());
        let catalog = Catalog::new(vec![i]);
        let mut query = SearchQuery { float_min: Some(0.), float_max: Some(0.05), ..Default::default() };
        assert_eq!(catalog.search(&query, &Saves::default()).total, 0);
        query.float_max = Some(0.2); query.price_max = Some(3.);
        assert_eq!(catalog.search(&query, &Saves::default()).total, 0);
        assert_eq!(catalog.search_with_prices(&query, &Saves::default(), &HashMap::from([("a".into(), 250)])).total, 1);
    }
    #[test]
    fn weapon_icons_respect_choices_and_fall_back_after_catalog_changes() {
        let mut base = item("base", "AK-47", "skins", "AK-47");
        base.image = "base.png".into();
        let mut skin = item("skin", "AK-47 | Redline", "skins", "AK-47");
        skin.image = "skin.png".into();
        let mut other = item("other", "USP-S | Cortex", "skins", "USP-S");
        other.image = "other.png".into();
        let mut retired = item("retired", "AK-47 | Retired", "skins", "AK-47");
        retired.image = "old.png".into();
        retired.active = false;
        let mut no_image = item("empty", "AK-47 | Empty", "skins", "AK-47");
        no_image.image.clear();
        let c = Catalog::new(vec![base, skin, other, retired, no_image]);
        let defaults = c.weapon_icons(&HashMap::new());
        assert_eq!(
            defaults.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(),
            vec!["skin", "other"]
        );
        assert_eq!(
            c.weapon_icons(&HashMap::from([("AK-47".into(), "base".into())]))[0].id,
            "base"
        );
        for invalid in ["other", "retired", "empty", "deleted"] {
            let icons = c.weapon_icons(&HashMap::from([("AK-47".into(), invalid.into())]));
            assert_eq!(icons[0].id, "skin", "{invalid}");
            assert_eq!(icons[1].id, "other");
        }
    }
    #[test]
    fn price_sort_uses_gallery_variant_before_pagination_and_keeps_unknown_last() {
        let mut expensive = item("a", "Alpha", "skins", "AK-47");
        expensive.market_hash_name = Some("expensive".into());
        let mut cheap = item("b", "Beta", "skins", "AK-47");
        cheap.variants = vec![
            Variant {
                market_hash_name: "special".into(),
                special: "StatTrak".into(),
                wear: "Factory New".into(),
                ..Default::default()
            },
            Variant {
                market_hash_name: "worn".into(),
                special: "Normal".into(),
                wear: "Field-Tested".into(),
                ..Default::default()
            },
            Variant {
                market_hash_name: "cheap".into(),
                special: "Normal".into(),
                wear: "Factory New".into(),
                ..Default::default()
            },
        ];
        let unknown = item("c", "Gamma", "skins", "AK-47");
        let mut tie = item("d", "Delta", "skins", "AK-47");
        tie.market_hash_name = Some("tie".into());
        let mut excluded = item("e", "Epsilon", "stickers", "");
        excluded.market_hash_name = Some("excluded".into());
        let c = Catalog::new(vec![expensive, cheap, unknown, tie, excluded]);
        let prices = HashMap::from([
            ("expensive".into(), 1000),
            ("cheap".into(), 200),
            ("tie".into(), 200),
            ("special".into(), 5000),
            ("worn".into(), 1),
            ("excluded".into(), 1),
        ]);
        let mut q = SearchQuery {
            sort: "price_asc".into(),
            categories: vec!["skins".into()],
            limit: 2,
            ..Default::default()
        };
        let result = c.search_with_prices(&q, &Saves::default(), &prices);
        assert_eq!(result.total, 4);
        assert_eq!(
            result
                .items
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            vec!["b", "d"]
        );
        q.offset = 2;
        assert_eq!(
            c.search_with_prices(&q, &Saves::default(), &prices)
                .items
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "c"]
        );
        q.sort = "price_desc".into();
        q.offset = 0;
        q.limit = 80;
        assert_eq!(
            c.search_with_prices(&q, &Saves::default(), &prices)
                .items
                .iter()
                .map(|i| i.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b", "d", "c"]
        );
    }
    #[test]
    fn wear_and_special_share_one_variant() {
        let mut i = item("a", "Skin", "skins", "");
        i.variants = vec![
            Variant {
                wear: "Factory New".into(),
                special: "Normal".into(),
                ..Default::default()
            },
            Variant {
                wear: "Field-Tested".into(),
                special: "Souvenir".into(),
                ..Default::default()
            },
        ];
        let c = Catalog::new(vec![i]);
        let q = SearchQuery {
            wears: vec!["Factory New".into()],
            specials: vec!["Souvenir".into()],
            ..Default::default()
        };
        assert_eq!(c.search(&q, &Saves::default()).total, 0);
    }
    #[test]
    fn url_encodes_market_names() {
        let u = market_url("★ StatTrak™ Knife | Test (Factory New)");
        assert!(u.contains("%E2%98%85"));
        assert!(u.contains("%20"));
        assert!(!u.contains(" | "));
    }
    #[test]
    fn removed_items_still_saved() {
        let mut i = item("a", "Removed", "skins", "");
        i.active = false;
        let c = Catalog::new(vec![i]);
        let saves = Saves {
            favorites: vec!["a".into()],
            ..Default::default()
        };
        assert_eq!(c.search(&SearchQuery::default(), &saves).total, 0);
        let q = SearchQuery {
            view: "favorites".into(),
            ..Default::default()
        };
        assert_eq!(c.search(&q, &saves).total, 1);
    }
}
