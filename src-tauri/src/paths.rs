//! Ayarlar ve GMod / Steam klasörlerinin bulunması.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    /// `...\steamapps\common\GarrysMod`
    pub gmod_dir: Option<String>,
    pub to_trash: bool,
    pub export_dir: Option<String>,
}

impl Default for Config {
    fn default() -> Self {
        Config { gmod_dir: None, to_trash: true, export_dir: None }
    }
}

impl Config {
    pub fn load(path: &Path) -> Config {
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        if let Some(p) = path.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::write(path, serde_json::to_string_pretty(self).unwrap()).map_err(|e| e.to_string())
    }
}

#[derive(Clone, Debug)]
pub struct Paths {
    /// `...\common\GarrysMod`
    pub gmod: PathBuf,
    /// `...\common\GarrysMod\garrysmod`
    pub game: PathBuf,
    /// `...\steamapps\workshop`
    pub workshop: PathBuf,
    /// `...\steamapps\workshop\content\4000`
    pub content: PathBuf,
}

impl Paths {
    pub fn from_gmod(gmod: &Path) -> Option<Paths> {
        let game = gmod.join("garrysmod");
        if !game.join("addons").is_dir() && !game.join("cfg").is_dir() {
            return None;
        }
        let steamapps = gmod.parent()?.parent()?;
        let workshop = steamapps.join("workshop");
        Some(Paths {
            gmod: gmod.to_path_buf(),
            game,
            content: workshop.join("content").join("4000"),
            workshop,
        })
    }
}

fn steam_root() -> Option<PathBuf> {
    let hkcu = winreg::RegKey::predef(winreg::enums::HKEY_CURRENT_USER);
    let key = hkcu.open_subkey("Software\\Valve\\Steam").ok()?;
    let p: String = key.get_value("SteamPath").ok()?;
    Some(PathBuf::from(p.replace('/', "\\")))
}

/// Steam kütüphanelerini gezerek GMod kurulumunu bulur.
pub fn detect_gmod() -> Option<PathBuf> {
    let root = steam_root()?;
    let mut libs = vec![root.clone()];
    if let Ok(vdf) = fs::read_to_string(root.join("steamapps").join("libraryfolders.vdf")) {
        for line in vdf.lines() {
            let parts: Vec<&str> = line.split('"').collect();
            if parts.len() >= 4 && parts[1] == "path" {
                libs.push(PathBuf::from(parts[3].replace("\\\\", "\\")));
            }
        }
    }
    libs.into_iter()
        .map(|l| l.join("steamapps").join("common").join("GarrysMod"))
        .find(|g| Paths::from_gmod(g).is_some())
}

pub fn resolve(cfg: &Config) -> Result<Paths, String> {
    let gmod = cfg
        .gmod_dir
        .as_ref()
        .map(PathBuf::from)
        .filter(|p| Paths::from_gmod(p).is_some())
        .or_else(detect_gmod)
        .ok_or("Garry's Mod kurulumu bulunamadı. Ayarlar'dan GarrysMod klasörünü seç.")?;
    Paths::from_gmod(&gmod).ok_or_else(|| "Geçersiz GarrysMod klasörü.".to_string())
}

pub fn default_export_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Documents")
        .join("GMod Cleaner")
}

/// Windows dosya adında kullanılamayan karakterleri temizler.
pub fn safe_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    let mut s: String = trimmed.chars().take(80).collect();
    if s.is_empty() {
        s = "addon".into();
    }
    s
}

/// Var olan bir yolun üzerine yazmamak için sonuna sayı ekler.
pub fn unique(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    (2..)
        .map(|i| parent.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .unwrap()
}
