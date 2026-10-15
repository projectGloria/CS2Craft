#[allow(dead_code)] #[path="../../../src-tauri/src/color.rs"] mod color;
#[allow(dead_code)] #[path="../../../src-tauri/src/model.rs"] mod model;
#[path="../../../src-tauri/src/source.rs"] mod source;
use std::{collections::HashMap,path::PathBuf};
fn main()->Result<(),Box<dyn std::error::Error>> {
    rayon::ThreadPoolBuilder::new().num_threads(24).build_global()?;
    let root=PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().join("src-tauri");
    let out=root.join("resources/catalog.json");let cache=root.parent().unwrap().join(".catalog-cache/images");
    let c=source::client()?;let rev=source::revision(&c)?;println!("Fetching pinned catalog {rev}");
    let mut snapshot=source::fetch_snapshot(&c,&rev)?;
    let previous=std::fs::read(&out).ok().and_then(|b|serde_json::from_slice::<model::Snapshot>(&b).ok()).map(|s|s.items.into_iter().map(|i|(i.image,i.palette)).collect::<HashMap<_,_>>()).unwrap_or_default();
    std::fs::create_dir_all(root.parent().unwrap().join(".catalog-cache"))?;
    std::fs::write(root.parent().unwrap().join(".catalog-cache/normalized.json"),serde_json::to_vec(&snapshot)?)?;
    println!("{} catalog entries; indexing foreground palettes",snapshot.items.len());
    let failed=source::index_palettes(&mut snapshot,&c,&cache,&previous,|done,n|{if done%1000==0 || done==n {println!("Color index {done}/{n}");}});
    source::apply_corrections(&mut snapshot,&std::fs::read(root.join("resources/color-corrections.json"))?)?;
    if failed>0 { let missing:Vec<_>=snapshot.items.iter().filter(|i|i.palette.is_empty()).map(|i|format!("{} · {}",i.id,i.name)).collect(); std::fs::write(root.parent().unwrap().join(".catalog-cache/missing-palettes.txt"),missing.join("\n"))?; return Err(format!("{failed} images failed indexing; rerun to resume from cached images. See .catalog-cache/missing-palettes.txt").into()); }
    let bytes=serde_json::to_vec(&snapshot)?;let tmp=out.with_extension("tmp");std::fs::write(&tmp,bytes)?;std::fs::rename(tmp,&out)?;
    println!("Catalog ready: {} items, revision {}",snapshot.items.len(),snapshot.revision);Ok(())
}
