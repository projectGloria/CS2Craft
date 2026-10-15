use cs2_craft_lib::{db, model::*, search::Catalog, source};
use std::{path::PathBuf, time::Instant};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let snapshot: Snapshot =
        serde_json::from_slice(&std::fs::read(root.join("resources/catalog.json"))?)?;
    db::validate(&snapshot, 0)?;
    let qa = root.parent().unwrap().join(".qa");
    std::fs::create_dir_all(&qa)?;
    let path = qa.join("offline-check.sqlite");
    for suffix in ["", "-wal", "-shm"] {
        let file = qa.join(format!("offline-check.sqlite{suffix}"));
        if file.is_file() {
            std::fs::remove_file(file)?;
        }
    }
    let start = Instant::now();
    let mut conn = rusqlite::Connection::open(&path)?;
    db::initialize(&conn)?;
    db::import(&mut conn, &snapshot)?;
    let catalog = Catalog::new(db::load(&conn)?);
    let init_ms = start.elapsed().as_secs_f64() * 1000.;
    let favorites = db::saves(&conn)?;
    let mut checks = vec![];
    for mut query in [
        SearchQuery::default(),
        SearchQuery {
            text: "ak47 redlne".into(),
            ..Default::default()
        },
        SearchQuery {
            categories: vec!["stickers".into()],
            ..Default::default()
        },
        SearchQuery {
            color: Some("#d83b46".into()),
            color_mode: "accent".into(),
            ..Default::default()
        },
        SearchQuery {
            color: Some("#4885de".into()),
            color_mode: "dominant".into(),
            categories: vec!["charms".into()],
            ..Default::default()
        },
    ] {
        query.limit = 80;
        let r = catalog.search(&query, &favorites);
        assert!(r.total > 0, "No results for {}", query.text);
        assert!(
            r.elapsed_ms < 200.,
            "Search exceeded target (text={}, color={:?}): {}ms",
            query.text, query.color, r.elapsed_ms
        );
        checks.push(serde_json::json!({"text":query.text,"categories":query.categories,"color":query.color,"total":r.total,"elapsedMs":r.elapsed_ms}));
    }
    let item = &catalog.items[0];
    db::save_action(&conn, "favorite", Some(&item.id), None, None)?;
    let created = db::save_action(&conn, "create", None, None, Some("Offline test"))?;
    let list = created.lists[0].id;
    db::save_action(&conn, "add", Some(&item.id), Some(list), None)?;
    drop(conn);
    let conn = rusqlite::Connection::open(&path)?;
    let saved = db::saves(&conn)?;
    assert_eq!(saved.favorites, vec![item.id.clone()]);
    assert_eq!(saved.lists[0].count, 1);
    let report = serde_json::json!({"revision":snapshot.revision,"items":snapshot.items.len(),"colorIndexed":snapshot.items.iter().filter(|i|!i.palette.is_empty()).count(),"offlineInitializeMs":init_ms,"searches":checks,"persistentSaves":true});
    std::fs::write(
        qa.join("native-verification.json"),
        serde_json::to_vec_pretty(&report)?,
    )?;
    println!("{}", serde_json::to_string_pretty(&report)?);
    let cache = qa.join("image-test");
    std::fs::create_dir_all(&cache)?;
    let url = "https://cdn.steamstatic.com/apps/730/offline-test.png";
    let img = image::RgbaImage::from_pixel(32, 32, image::Rgba([255u8, 0, 0, 255]));
    img.save(source::cache_path(&cache, url))?;
    let blocked = reqwest::blocking::Client::builder()
        .proxy(reqwest::Proxy::all("http://127.0.0.1:9")?)
        .timeout(std::time::Duration::from_secs(1))
        .build()?;
    assert!(source::cache_image(&blocked, &cache, url).is_ok());
    assert!(source::cache_image(
        &blocked,
        &cache,
        "https://cdn.steamstatic.com/apps/730/not-cached.png"
    )
    .is_err());
    println!(
        "Cached image works with network unavailable; uncached image returns a recoverable error."
    );
    Ok(())
}
