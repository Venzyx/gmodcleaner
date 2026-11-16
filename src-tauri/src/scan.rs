//! GMod'un yer kaplayan tüm içeriklerinin taranması.

use crate::gma;
use crate::paths::Paths;
use rayon::prelude::*;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Item {
    pub path: String,
    pub name: String,
    /// workshop | addons | server | cache | other
    pub section: &'static str,
    /// workshop | folder | gma | servergma | download | cache | map | userdata
    pub kind: &'static str,
    pub size: u64,
    pub files: u64,
    pub modified: u64,
    pub is_dir: bool,
    /// true ise silerken klasörün kendisi kalır, yalnızca içi boşaltılır.
    pub container: bool,
    pub workshop_id: Option<String>,
    /// İçeriği okunabilen GMA dosyasının yolu.
    pub gma_path: Option<String>,
    pub legacy: bool,
    pub title: Option<String>,
    pub addon_type: Option<String>,
    pub tags: Vec<String>,
    pub note: Option<String>,
    /// Birden çok dosyayı tek satırda toplayan öğelerde silinecek dosyalar.
    pub members: Vec<String>,
}

pub fn dir_stats(p: &Path) -> (u64, u64) {
    let mut size = 0u64;
    let mut files = 0u64;
    for e in walkdir::WalkDir::new(p).follow_links(false).into_iter().flatten() {
        if e.file_type().is_file() {
            size += e.metadata().map(|m| m.len()).unwrap_or(0);
            files += 1;
        }
    }
    (size, files)
}

fn mtime(p: &Path) -> u64 {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn s(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn fname(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

fn ext(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn apply_gma(item: &mut Item, gma_file: &Path) {
    item.gma_path = Some(s(gma_file));
    if let Ok((meta, entries)) = gma::read(gma_file) {
        item.legacy = meta.compressed;
        if !meta.title.trim().is_empty() {
            item.title = Some(meta.title.trim().to_string());
        }
        if !meta.addon_type.is_empty() {
            item.addon_type = Some(meta.addon_type);
        }
        item.tags = meta.tags;
        if !item.is_dir || item.kind == "workshop" {
            item.files = entries.len() as u64;
        }
    }
}

/// Workshop klasöründeki GMA'yı (veya eski `.bin` dosyasını) bulur.
pub fn find_gma(dir: &Path) -> Option<PathBuf> {
    let mut best: Option<(u64, PathBuf)> = None;
    for e in fs::read_dir(dir).ok()?.flatten() {
        let p = e.path();
        if p.is_file() && matches!(ext(&p).as_str(), "gma" | "bin") {
            let len = e.metadata().map(|m| m.len()).unwrap_or(0);
            if best.as_ref().is_none_or(|b| len > b.0) {
                best = Some((len, p));
            }
        }
    }
    best.map(|b| b.1)
}

fn workshop_item(dir: PathBuf) -> Item {
    let (size, files) = dir_stats(&dir);
    let id = fname(&dir);
    let mut item = Item {
        path: s(&dir),
        name: id.clone(),
        section: "workshop",
        kind: "workshop",
        size,
        files,
        modified: mtime(&dir),
        is_dir: true,
        workshop_id: id.chars().all(|c| c.is_ascii_digit()).then_some(id),
        ..Default::default()
    };
    if let Some(g) = find_gma(&dir) {
        item.modified = mtime(&g);
        apply_gma(&mut item, &g);
    }
    item
}

fn folder_item(dir: PathBuf, section: &'static str, kind: &'static str, container: bool) -> Item {
    let (size, files) = dir_stats(&dir);
    Item {
        path: s(&dir),
        name: fname(&dir),
        section,
        kind,
        size,
        files,
        modified: mtime(&dir),
        is_dir: true,
        container,
        ..Default::default()
    }
}

fn file_item(file: PathBuf, section: &'static str, kind: &'static str) -> Item {
    let meta = fs::metadata(&file).ok();
    Item {
        path: s(&file),
        name: fname(&file),
        section,
        kind,
        size: meta.map(|m| m.len()).unwrap_or(0),
        files: 1,
        modified: mtime(&file),
        ..Default::default()
    }
}

fn addon_folder(dir: PathBuf) -> Item {
    let mut item = folder_item(dir.clone(), "addons", "folder", false);
    if let Ok(txt) = fs::read_to_string(dir.join("addon.json")) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&txt) {
            item.title = v["title"].as_str().filter(|t| !t.trim().is_empty()).map(String::from);
            item.addon_type = v["type"].as_str().map(String::from);
        }
    }
    item
}

fn gma_file(file: PathBuf, section: &'static str, kind: &'static str) -> Item {
    let mut item = file_item(file.clone(), section, kind);
    apply_gma(&mut item, &file);
    item
}

/// Dosya düz ya da LZMA sıkıştırmalı bir GMA mı? (Görsel önbelleklerini ayırmak için.)
fn is_gma(p: &Path) -> bool {
    use std::io::Read;
    let mut b = [0u8; 4];
    match fs::File::open(p).and_then(|mut f| f.read_exact(&mut b)) {
        Ok(()) => &b == b"GMAD" || b[0] == 0x5d,
        Err(_) => false,
    }
}

type Job = Box<dyn FnOnce() -> Option<Item> + Send>;

fn children(dir: &Path) -> Vec<PathBuf> {
    fs::read_dir(dir).map(|r| r.flatten().map(|e| e.path()).collect()).unwrap_or_default()
}

fn noted(mut item: Item, title: &str, note: &str) -> Item {
    item.title = Some(title.to_string());
    item.note = Some(note.to_string());
    item
}

pub fn scan(paths: &Paths) -> Vec<Item> {
    let mut jobs: Vec<Job> = Vec::new();
    let game = &paths.game;

    // Workshop abonelikleri ve Steam'in indirdiği öğeler
    for p in children(&paths.content) {
        if p.is_dir() {
            jobs.push(Box::new(move || Some(workshop_item(p)).filter(|i| i.size > 0)));
        }
    }

    // addons klasörü
    for p in children(&game.join("addons")) {
        if p.is_dir() {
            jobs.push(Box::new(move || Some(addon_folder(p))));
        } else if ext(&p) == "gma" {
            jobs.push(Box::new(move || Some(gma_file(p, "addons", "gma"))));
        }
    }

    // Sunuculardan inen workshop önbelleği: GMA'lar tek tek, önizleme görselleri tek satırda
    let mut thumbs = Item {
        path: s(&game.join("cache").join("workshop")),
        name: "workshop-thumbs".into(),
        section: "cache",
        kind: "cache",
        title: Some("Workshop önizleme görselleri".into()),
        note: Some("Oyun içi Workshop menüsünün indirdiği küçük resimler. Güvenle silinir.".into()),
        ..Default::default()
    };
    for p in children(&game.join("cache").join("workshop")) {
        if p.is_dir() {
            jobs.push(Box::new(move || {
                let mut i = folder_item(p, "server", "download", true);
                i.title = Some(format!("cache/workshop/{}", i.name));
                Some(i).filter(|i| i.files > 0)
            }));
        } else if is_gma(&p) {
            jobs.push(Box::new(move || {
                let mut i = gma_file(p.clone(), "server", "servergma");
                // Oyun bu dosyaları workshop kimliğiyle adlandırır (ör. 1695584175.gma).
                let stem = p.file_stem().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                if ext(&p) == "gma" && stem.len() >= 6 && stem.len() <= 12 && stem.chars().all(|c| c.is_ascii_digit()) {
                    i.workshop_id = Some(stem);
                }
                Some(i)
            }));
        } else {
            thumbs.size += fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            thumbs.files += 1;
            thumbs.modified = thumbs.modified.max(mtime(&p));
            thumbs.members.push(s(&p));
        }
    }
    if thumbs.files > 0 {
        jobs.push(Box::new(move || Some(thumbs)));
    }

    // Sunuculardan inen dosyalar (FastDL)
    for p in children(&game.join("download")) {
        if p.is_dir() {
            jobs.push(Box::new(move || {
                let mut i = folder_item(p, "server", "download", true);
                i.title = Some(format!("download/{}", i.name));
                Some(i).filter(|i| i.files > 0)
            }));
        }
    }

    // Bazı sunucuların kendi indiricisiyle indirdiği şifreli içerik paketi
    let hc = game.join("hc_cache");
    if hc.is_dir() {
        jobs.push(Box::new(move || {
            Some(noted(
                folder_item(hc, "server", "download", true),
                "Sunucu içerik paketi (hc_cache)",
                "Bir sunucunun kendi indiricisiyle indirdiği şifreli içerik önbelleği. Silersen o sunucuya girdiğinde yeniden iner.",
            ))
            .filter(|i| i.files > 0)
        }));
    }

    // Önbellekler
    let caches: Vec<(PathBuf, &str, &str)> = vec![
        (game.join("cache").join("lua"), "Sunucu Lua önbelleği", "Sunucuların gönderdiği Lua dosyaları. Sunucuya girince yeniden iner."),
        (game.join("downloadlists"), "İndirme listeleri", "Sunucuların harita başına indirme listeleri."),
        (paths.gmod.join("crashes"), "Çökme dökümleri", "Oyun çöktüğünde oluşan döküm dosyaları."),
        (paths.workshop.join("downloads"), "Steam yarım indirmeleri", "Tamamlanmamış Workshop indirmeleri (tüm oyunlar)."),
        (paths.workshop.join("temp"), "Steam geçici dosyaları", "Workshop geçici dosyaları (tüm oyunlar)."),
    ];
    for (p, title, note) in caches {
        if p.is_dir() {
            let (title, note) = (title.to_string(), note.to_string());
            jobs.push(Box::new(move || {
                Some(noted(folder_item(p, "cache", "cache", true), &title, &note)).filter(|i| i.files > 0)
            }));
        }
    }

    // Haritalar
    for p in children(&game.join("maps")) {
        if p.is_file() && ext(&p) == "bsp" {
            let stem = p.file_stem().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
            if stem != "gm_construct" && stem != "gm_flatgrass" {
                jobs.push(Box::new(move || Some(file_item(p, "other", "map"))));
            }
        }
    }

    // Kullanıcı verileri
    let user: Vec<(&str, &str, &str)> = vec![
        ("data", "Addon verileri (data)", "Addonların kayıtlı ayarları ve verileri. Silersen addon ayarların sıfırlanabilir."),
        ("demos", "Demolar", "Kaydettiğin demo dosyaları."),
        ("screenshots", "Ekran görüntüleri", "Oyun içinde aldığın ekran görüntüleri."),
        ("saves", "Kayıtlar", "Sandbox kayıtların."),
        ("dupes", "Dupe'lar", "Kaydettiğin duplicator yapıları."),
    ];
    for (dir, title, note) in user {
        let p = game.join(dir);
        if p.is_dir() {
            let (title, note) = (title.to_string(), note.to_string());
            jobs.push(Box::new(move || {
                Some(noted(folder_item(p, "other", "userdata", true), &title, &note)).filter(|i| i.files > 0)
            }));
        }
    }

    jobs.into_par_iter().filter_map(|j| j()).collect()
}
