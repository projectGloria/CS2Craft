use crate::model::*;
use rusqlite::{params, Connection};
use std::collections::HashMap;

pub fn initialize(c: &Connection) -> Result<(), String> {
    c.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY,data TEXT NOT NULL,active INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS variants(id TEXT PRIMARY KEY,item_id TEXT NOT NULL REFERENCES items(id),data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS variants_item_id ON variants(item_id);
        CREATE TABLE IF NOT EXISTS palettes(item_id TEXT PRIMARY KEY REFERENCES items(id),data TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS favorites(item_id TEXT PRIMARY KEY REFERENCES items(id));
        CREATE TABLE IF NOT EXISTS lists(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS list_members(list_id INTEGER REFERENCES lists(id) ON DELETE CASCADE,item_id TEXT REFERENCES items(id),PRIMARY KEY(list_id,item_id));
        PRAGMA user_version=1;").map_err(|e|e.to_string())
}
pub fn get_meta(c: &Connection, key: &str) -> Option<String> {
    c.query_row("SELECT value FROM meta WHERE key=?1", [key], |r| r.get(0))
        .ok()
}
pub fn set_meta(c: &Connection, key: &str, value: &str) -> Result<(), String> {
    c.execute(
        "INSERT INTO meta VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        params![key, value],
    )
    .map(|_| ())
    .map_err(|e| e.to_string())
}
pub fn validate(snapshot: &Snapshot, previous_count: usize) -> Result<(), String> {
    if snapshot.schema_version != 1
        || snapshot.items.len() < 100
        || (previous_count > 100 && snapshot.items.len() < previous_count / 2)
    {
        return Err("Catalog is incomplete; the previous catalog was preserved".into());
    }
    let mut ids = std::collections::HashSet::new();
    for i in &snapshot.items {
        if i.id.is_empty() || i.name.is_empty() || !ids.insert(&i.id) {
            return Err("Catalog contains invalid or duplicate items".into());
        }
        if i.palette.is_empty()
            || i.palette.iter().any(|p| {
                p.lab.iter().any(|n| !n.is_finite())
                    || !p.weight.is_finite()
                    || p.weight <= 0.
                    || p.weight > 1.
            })
        {
            return Err(format!("Missing or invalid color index: {}", i.name));
        }
        if !crate::source::allowed_url(&url::Url::parse(&i.image).map_err(|e| e.to_string())?) {
            return Err("Catalog contains unsupported image links".into());
        }
    }
    for category in [
        "skins",
        "knives",
        "gloves",
        "stickers",
        "charms",
        "agents",
        "graffiti",
        "patches",
        "music",
        "containers",
        "collectibles",
        "keys",
        "tools",
    ] {
        if !snapshot.items.iter().any(|i| i.category == category) {
            return Err(format!("Missing required category: {category}"));
        }
    }
    Ok(())
}
pub fn import(c: &mut Connection, snapshot: &Snapshot) -> Result<(), String> {
    let previous = c
        .query_row("SELECT COUNT(*) FROM items WHERE active=1", [], |r| {
            r.get::<_, usize>(0)
        })
        .map_err(|e| e.to_string())?;
    validate(snapshot, previous)?;
    let tx = c.transaction().map_err(|e| e.to_string())?;
    tx.execute("UPDATE items SET active=0", [])
        .map_err(|e| e.to_string())?;
    for i in &snapshot.items {
        let mut meta = i.clone();
        meta.variants.clear();
        meta.palette.clear();
        meta.active = true;
        tx.execute("INSERT INTO items VALUES(?1,?2,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,active=1",params![i.id,serde_json::to_string(&meta).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
        tx.execute("DELETE FROM variants WHERE item_id=?1", [&i.id])
            .map_err(|e| e.to_string())?;
        for v in &i.variants {
            tx.execute(
                "INSERT INTO variants VALUES(?1,?2,?3)",
                params![
                    v.id,
                    i.id,
                    serde_json::to_string(v).map_err(|e| e.to_string())?
                ],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute("INSERT INTO palettes VALUES(?1,?2) ON CONFLICT(item_id) DO UPDATE SET data=excluded.data",params![i.id,serde_json::to_string(&i.palette).map_err(|e|e.to_string())?]).map_err(|e|e.to_string())?;
    }
    set_meta(&tx, "revision", &snapshot.revision)?;
    set_meta(&tx, "generated_at", &snapshot.generated_at)?;
    tx.commit().map_err(|e| e.to_string())
}
pub fn load(c: &Connection) -> Result<Vec<Item>, String> {
    let mut vs: HashMap<String, Vec<Variant>> = HashMap::new();
    let mut stmt = c
        .prepare("SELECT item_id,data FROM variants")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let (id, data) = row.map_err(|e| e.to_string())?;
        vs.entry(id)
            .or_default()
            .push(serde_json::from_str(&data).map_err(|e| e.to_string())?);
    }
    let mut stmt = c
        .prepare(
            "SELECT i.data,i.active,p.data FROM items i LEFT JOIN palettes p ON p.item_id=i.id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, bool>(1)?,
                r.get::<_, Option<String>>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut items = vec![];
    for row in rows {
        let (data, active, p) = row.map_err(|e| e.to_string())?;
        let mut i: Item = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        i.active = active;
        i.palette = serde_json::from_str(&p.unwrap_or("[]".into())).map_err(|e| e.to_string())?;
        i.variants = vs.remove(&i.id).unwrap_or_default();
        items.push(i);
    }
    items.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then(a.id.cmp(&b.id))
    });
    Ok(items)
}
pub fn saves(c: &Connection) -> Result<Saves, String> {
    let mut result = Saves::default();
    let mut s = c
        .prepare("SELECT item_id FROM favorites ORDER BY item_id")
        .map_err(|e| e.to_string())?;
    result.favorites = s
        .query_map([], |r| r.get(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut s=c.prepare("SELECT l.id,l.name,COUNT(m.item_id) FROM lists l LEFT JOIN list_members m ON m.list_id=l.id GROUP BY l.id ORDER BY l.name COLLATE NOCASE").map_err(|e|e.to_string())?;
    result.lists = s
        .query_map([], |r| {
            Ok(SavedList {
                id: r.get(0)?,
                name: r.get(1)?,
                count: r.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    let mut s = c
        .prepare("SELECT item_id,list_id FROM list_members")
        .map_err(|e| e.to_string())?;
    for row in s
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
        .map_err(|e| e.to_string())?
    {
        let (id, list) = row.map_err(|e| e.to_string())?;
        result.memberships.entry(id).or_default().push(list);
    }
    Ok(result)
}
pub fn save_action(
    c: &Connection,
    action: &str,
    item_id: Option<&str>,
    list_id: Option<i64>,
    name: Option<&str>,
) -> Result<Saves, String> {
    let id = item_id.unwrap_or("");
    if matches!(action, "favorite" | "unfavorite" | "add" | "remove")
        && !c
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM items WHERE id=?1)",
                [id],
                |r| r.get::<_, bool>(0),
            )
            .map_err(|e| e.to_string())?
    {
        return Err("Item not found".into());
    }
    let valid_name = || -> Result<String, String> {
        let n = name.unwrap_or("").trim();
        if n.is_empty() || n.chars().count() > 80 {
            return Err("Use a list name between 1 and 80 characters".into());
        }
        Ok(n.into())
    };
    let execute = |sql: &str, args: &[&dyn rusqlite::ToSql]| {
        c.execute(sql, args).map(|_| ()).map_err(|e| e.to_string())
    };
    match action {
        "favorite" => execute("INSERT OR IGNORE INTO favorites VALUES(?1)", &[&id])?,
        "unfavorite" => execute("DELETE FROM favorites WHERE item_id=?1", &[&id])?,
        "create" => execute("INSERT INTO lists(name) VALUES(?1)", &[&valid_name()?])?,
        "rename" => execute(
            "UPDATE lists SET name=?1 WHERE id=?2",
            &[&valid_name()?, &list_id.ok_or("List required")?],
        )?,
        "delete" => execute(
            "DELETE FROM lists WHERE id=?1",
            &[&list_id.ok_or("List required")?],
        )?,
        "add" => execute(
            "INSERT OR IGNORE INTO list_members VALUES(?1,?2)",
            &[&list_id.ok_or("List required")?, &id],
        )?,
        "remove" => execute(
            "DELETE FROM list_members WHERE list_id=?1 AND item_id=?2",
            &[&list_id.ok_or("List required")?, &id],
        )?,
        _ => return Err("Unknown save action".into()),
    }
    saves(c)
}
pub fn import_list(c: &Connection, name: &str, ids: &[String]) -> Result<Saves, String> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 || ids.len() > 10000 { return Err("Use a list name of 1–80 characters and at most 10,000 items".into()); }
    let tx = c.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO lists(name) VALUES(?1)", [name]).map_err(|e| e.to_string())?;
    let list_id = tx.last_insert_rowid();
    for id in ids {
        if !tx.query_row("SELECT EXISTS(SELECT 1 FROM items WHERE id=?1)", [id], |r| r.get::<_, bool>(0)).map_err(|e| e.to_string())? { return Err(format!("Unknown catalog item: {id}")); }
        tx.execute("INSERT OR IGNORE INTO list_members VALUES(?1,?2)", rusqlite::params![list_id, id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())?;
    saves(c)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(revision: &str) -> Snapshot {
        let categories = [
            "skins",
            "knives",
            "gloves",
            "stickers",
            "charms",
            "agents",
            "graffiti",
            "patches",
            "music",
            "containers",
            "collectibles",
            "keys",
            "tools",
        ];
        let items = (0..130)
            .map(|n| Item {
                id: format!("item:{n}"),
                source_id: format!("upstream:{n}"),
                name: format!("Item {n}"),
                category: categories[n % categories.len()].into(),
                image: "https://cdn.steamstatic.com/apps/730/icon.png".into(),
                palette: vec![Palette {
                    hex: "#ff0000".into(),
                    lab: crate::color::rgb_to_lab([255, 0, 0]),
                    weight: 1.,
                }],
                active: true,
                ..Default::default()
            })
            .collect();
        Snapshot {
            schema_version: 1,
            revision: revision.into(),
            generated_at: chrono::Utc::now().to_rfc3339(),
            items,
        }
    }
    #[test]
    fn saves_survive_source_changes_and_removals() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        let mut s = fixture("first");
        import(&mut c, &s).unwrap();
        save_action(&c, "favorite", Some("item:0"), None, None).unwrap();
        let created = save_action(&c, "create", None, None, Some("Purple loadout")).unwrap();
        let list = created.lists[0].id;
        save_action(&c, "add", Some("item:0"), Some(list), None).unwrap();
        s.items.remove(0);
        s.items[0].source_id = "rehash".into();
        s.revision = "second".into();
        import(&mut c, &s).unwrap();
        let saved = saves(&c).unwrap();
        assert_eq!(saved.favorites, vec!["item:0"]);
        assert_eq!(saved.lists[0].count, 1);
        assert!(
            !load(&c)
                .unwrap()
                .iter()
                .find(|i| i.id == "item:0")
                .unwrap()
                .active
        );
        save_action(&c, "rename", None, Some(list), Some("New title")).unwrap();
        assert_eq!(saves(&c).unwrap().lists[0].name, "New title");
        save_action(&c, "delete", None, Some(list), None).unwrap();
        assert!(saves(&c).unwrap().memberships.is_empty());
        assert_eq!(saves(&c).unwrap().favorites.len(), 1);
    }
    #[test]
    fn failed_import_is_atomic_and_reopen_persists() {
        let root = std::env::temp_dir().join(format!("cs2-craft-test-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let path = root.join("catalog.sqlite");
        {
            let mut c = Connection::open(&path).unwrap();
            initialize(&c).unwrap();
            import(&mut c, &fixture("good")).unwrap();
            save_action(&c, "favorite", Some("item:3"), None, None).unwrap();
            let mut bad = fixture("bad");
            bad.items[99].id = bad.items[0].id.clone();
            assert!(import(&mut c, &bad).is_err());
            assert_eq!(get_meta(&c, "revision").unwrap(), "good");
            assert_eq!(load(&c).unwrap().len(), 130);
            let mut bad = fixture("bad");
            bad.items[70].palette.clear();
            assert!(import(&mut c, &bad).is_err());
        }
        {
            let c = Connection::open(&path).unwrap();
            assert_eq!(saves(&c).unwrap().favorites, vec!["item:3"]);
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn invalid_save_operations_are_rejected() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        import(&mut c, &fixture("test")).unwrap();
        assert!(save_action(&c, "create", None, None, Some("   ")).is_err());
        assert!(save_action(&c, "favorite", Some("missing"), None, None).is_err());
        assert!(save_action(&c, "add", Some("item:1"), Some(999), None).is_err());
    }

    #[test]
    fn mid_import_failure_rolls_back_catalog_and_saves() {
        let mut c = Connection::open_in_memory().unwrap();
        initialize(&c).unwrap();
        import(&mut c, &fixture("good")).unwrap();
        save_action(&c, "favorite", Some("item:0"), None, None).unwrap();
        let mut bad = fixture("partial");
        bad.items[0].name = "Should roll back".into();
        for i in 0..2 {
            bad.items[i].variants.push(Variant {
                id: "duplicate-variant".into(),
                market_hash_name: "Test".into(),
                ..Default::default()
            });
        }
        assert!(import(&mut c, &bad).is_err());
        let restored = load(&c).unwrap();
        assert_eq!(restored.len(), 130);
        assert!(restored.iter().all(|i| i.active));
        assert_eq!(
            restored.iter().find(|i| i.id == "item:0").unwrap().name,
            "Item 0"
        );
        assert_eq!(get_meta(&c, "revision").unwrap(), "good");
        assert_eq!(saves(&c).unwrap().favorites, vec!["item:0"]);
    }
}
