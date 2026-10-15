use serde::{Deserialize, Serialize};
use std::{path::{Path, PathBuf}, process::Command, sync::Mutex};
use crate::model::Item;

static PREPARATION: Mutex<()> = Mutex::new(());
#[derive(Serialize, Deserialize)]
pub struct Preview {
    pub path: String,
    pub painted: bool,
    pub note: String,
}
pub fn indices(item: &Item) -> Result<(u32, u32), String> {
    if !matches!(item.category.as_str(), "skins" | "knives" | "gloves" | "agents" | "charms") {
        return Err("This category has no supported 3D model.".into());
    }
    if matches!(item.category.as_str(), "agents" | "charms") {
        return Ok((item.attributes.get("def index").ok_or("No model definition in this catalog entry")?.parse().map_err(|_| "Invalid model definition")?, 0));
    }
    let parts: Vec<_> = item.id.split(':').collect();
    match parts.as_slice() {
        ["base", def] => Ok((def.parse().map_err(|_| "Invalid weapon identifier")?, 0)),
        ["skin", def, paint, ..] => Ok((def.parse().map_err(|_| "Invalid weapon identifier")?, paint.parse().map_err(|_| "Invalid finish identifier")?)),
        _ => Err("This item does not have a supported weapon model.".into()),
    }
}
fn installed_game() -> Option<PathBuf> {
    let mut steam_roots = Vec::new();
    if let Ok(programs) = std::env::var("ProgramFiles(x86)") { steam_roots.push(PathBuf::from(programs).join("Steam")); }
    // Respect custom Steam installation directories without requiring a shell.
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        if let Ok(output) = Command::new("reg.exe").args(["query", r"HKCU\Software\Valve\Steam", "/v", "SteamPath"]).creation_flags(0x08000000).output() {
            if let Some(line) = String::from_utf8_lossy(&output.stdout).lines().find(|line| line.contains("REG_SZ")) {
                if let Some((_, value)) = line.split_once("REG_SZ") { steam_roots.push(PathBuf::from(value.trim())); }
            }
        }
    }
    let mut libraries = steam_roots.clone();
    for steam in &steam_roots {
        if let Ok(text) = std::fs::read_to_string(steam.join("steamapps/libraryfolders.vdf")) {
            for line in text.lines() {
                let tokens: Vec<_> = line.split('"').collect();
                if tokens.get(1) == Some(&"path") { if let Some(value) = tokens.get(3) { libraries.push(PathBuf::from(value.replace("\\\\", "\\"))); } }
            }
        }
    }
    libraries.into_iter().map(|library| library.join("steamapps/common/Counter-Strike Global Offensive/game/csgo/pak01_dir.vpk")).find(|file| file.is_file())
}
pub fn prepare(item: &Item, resources: &Path, cache: &Path) -> Result<Preview, String> {
    let (def_index, paint_index) = indices(item)?;
    let vpk = installed_game().ok_or("Install CS2 through Steam to use offline 3D. Prepared previews remain available while CS2 is installed.")?;
    let helper = resources.join("resources/viewer");
    if !helper.join("node.exe").is_file() || !helper.join("Source2Viewer-CLI.exe").is_file() { return Err("The offline viewer helper is missing. Reinstall CS2 Craft.".into()); }
    let _guard = PREPARATION.lock().map_err(|_| "The viewer is busy. Restart CS2 Craft.")?;
    std::fs::create_dir_all(cache).map_err(|e| e.to_string())?;
    let args = serde_json::json!({ "vpk": vpk, "cache": cache, "cli": helper.join("Source2Viewer-CLI.exe"), "defIndex": def_index, "paintIndex": paint_index, "category": item.category });
    let mut command = Command::new(helper.join("node.exe"));
    command.arg(helper.join("prepare.cjs")).arg("--prepare").arg(args.to_string()).current_dir(cache);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    let output = command.output().map_err(|e| format!("Could not start offline 3D: {e}"))?;
    if !output.status.success() { return Err(String::from_utf8_lossy(&output.stderr).trim().chars().take(1200).collect()); }
    let result: Preview = serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid viewer response: {e}"))?;
    let file = PathBuf::from(&result.path).canonicalize().map_err(|e| e.to_string())?;
    if !file.starts_with(cache.canonicalize().map_err(|e| e.to_string())?) || file.extension().is_none_or(|ext| ext != "glb") { return Err("The viewer returned an invalid model path.".into()); }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn accepts_only_catalog_weapon_identifiers() {
        let mut item = Item { id: "skin:9:279:".into(), category: "skins".into(), ..Default::default() };
        assert_eq!(indices(&item).unwrap(), (9, 279));
        item.id = "base:500".into(); item.category = "knives".into(); assert_eq!(indices(&item).unwrap(), (500, 0));
        item.category = "stickers".into(); assert!(indices(&item).is_err());
        item.category = "skins".into(); item.id = "skin:../../:279:".into(); assert!(indices(&item).is_err());
    }
}
