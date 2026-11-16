pub mod gma;
pub mod paths;
pub mod scan;
pub mod steam;
pub mod web;

use base64::Engine;
use paths::{Config, Paths};
use serde::{Deserialize, Serialize};
use std::cell::Cell;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AppState {
    cfg: Mutex<Config>,
    cfg_path: PathBuf,
    details_path: PathBuf,
    details: Mutex<HashMap<String, web::Details>>,
    authors: Mutex<HashMap<String, String>>,
    steam: steam::Steam,
}

type Shared = Arc<AppState>;

impl AppState {
    fn paths(&self) -> Result<Paths, String> {
        paths::resolve(&self.cfg.lock().unwrap())
    }
}

async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
struct Task {
    kind: &'static str,
    index: usize,
    total: usize,
    label: String,
    fraction: f64,
}

/// İlerleme olaylarını seyrelterek arayüze gönderir.
struct Reporter {
    app: AppHandle,
    kind: &'static str,
    total: usize,
    last: Cell<Instant>,
}

impl Reporter {
    fn new(app: &AppHandle, kind: &'static str, total: usize) -> Self {
        Reporter { app: app.clone(), kind, total, last: Cell::new(Instant::now() - Duration::from_secs(1)) }
    }
    fn send(&self, index: usize, label: &str, fraction: f64, force: bool) {
        if !force && self.last.get().elapsed() < Duration::from_millis(80) {
            return;
        }
        self.last.set(Instant::now());
        let _ = self.app.emit(
            "task",
            Task { kind: self.kind, index, total: self.total, label: label.to_string(), fraction },
        );
    }
}

// ---------------------------------------------------------------------------
// Ayarlar ve tarama
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    config: Config,
    gmod_dir: Option<String>,
    export_dir: String,
    error: Option<String>,
}

fn info(st: &AppState) -> AppInfo {
    let config = st.cfg.lock().unwrap().clone();
    let resolved = paths::resolve(&config);
    AppInfo {
        export_dir: config
            .export_dir
            .clone()
            .unwrap_or_else(|| paths::default_export_dir().to_string_lossy().into_owned()),
        gmod_dir: resolved.as_ref().ok().map(|p| p.gmod.to_string_lossy().into_owned()),
        error: resolved.err(),
        config,
    }
}

#[tauri::command]
fn get_info(state: State<'_, Shared>) -> AppInfo {
    info(&state)
}

#[tauri::command]
fn set_config(state: State<'_, Shared>, config: Config) -> Result<AppInfo, String> {
    if let Some(dir) = &config.gmod_dir {
        if Paths::from_gmod(Path::new(dir)).is_none() {
            return Err("Bu klasör bir GarrysMod kurulumu değil. İçinde 'garrysmod' klasörü olan GarrysMod klasörünü seç.".into());
        }
    }
    config.save(&state.cfg_path)?;
    *state.cfg.lock().unwrap() = config;
    Ok(info(&state))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    items: Vec<scan::Item>,
    disk_free: u64,
    disk_total: u64,
    gmod_dir: String,
}

#[tauri::command]
async fn scan_all(state: State<'_, Shared>) -> Result<ScanResult, String> {
    let st = state.inner().clone();
    blocking(move || {
        let paths = st.paths()?;
        Ok(ScanResult {
            items: scan::scan(&paths),
            disk_free: fs4::available_space(&paths.gmod).unwrap_or(0),
            disk_total: fs4::total_space(&paths.gmod).unwrap_or(0),
            gmod_dir: paths.gmod.to_string_lossy().into_owned(),
        })
    })
    .await
}

// ---------------------------------------------------------------------------
// İnceleme / önizleme
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct Entry {
    name: String,
    size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Inspect {
    meta: Option<gma::GmaMeta>,
    entries: Vec<Entry>,
    total_files: u64,
    truncated: bool,
}

const MAX_LIST: usize = 30_000;

#[tauri::command]
async fn inspect_item(path: String, gma_path: Option<String>) -> Result<Inspect, String> {
    blocking(move || {
        if let Some(g) = gma_path {
            let (meta, entries) = gma::read(Path::new(&g)).map_err(|e| format!("GMA okunamadı: {e}"))?;
            let total = entries.len();
            return Ok(Inspect {
                meta: Some(meta),
                entries: entries.into_iter().take(MAX_LIST).map(|e| Entry { name: e.name, size: e.size }).collect(),
                total_files: total as u64,
                truncated: total > MAX_LIST,
            });
        }
        let root = PathBuf::from(&path);
        let mut entries = Vec::new();
        let mut total = 0u64;
        if root.is_dir() {
            for e in walkdir::WalkDir::new(&root).follow_links(false).into_iter().flatten() {
                if !e.file_type().is_file() {
                    continue;
                }
                total += 1;
                if entries.len() < MAX_LIST {
                    let name = e
                        .path()
                        .strip_prefix(&root)
                        .unwrap_or(e.path())
                        .to_string_lossy()
                        .replace('\\', "/");
                    entries.push(Entry { name, size: e.metadata().map(|m| m.len()).unwrap_or(0) });
                }
            }
        }
        Ok(Inspect { meta: None, truncated: total as usize > entries.len(), entries, total_files: total })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Preview {
    /// text | image | none
    kind: &'static str,
    text: Option<String>,
    data_url: Option<String>,
    truncated: bool,
}

const TEXT_EXT: &[&str] = &[
    "lua", "txt", "json", "vmt", "cfg", "properties", "vdf", "res", "xml", "csv", "md", "lst", "qc", "fgd", "ini",
    "html", "css", "js", "vcd", "kv", "log",
];

#[tauri::command]
async fn read_entry(path: String, gma_path: Option<String>, name: String) -> Result<Preview, String> {
    blocking(move || {
        let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
        let mime = match ext.as_str() {
            "png" => Some("image/png"),
            "jpg" | "jpeg" => Some("image/jpeg"),
            "gif" => Some("image/gif"),
            "webp" => Some("image/webp"),
            _ => None,
        };
        let is_text = TEXT_EXT.contains(&ext.as_str());
        if mime.is_none() && !is_text {
            return Ok(Preview { kind: "none", text: None, data_url: None, truncated: false });
        }
        let max: u64 = if mime.is_some() { 16 << 20 } else { 256 << 10 };
        let data = match gma_path {
            Some(g) => gma::read_entry(Path::new(&g), &name, max + 1).map_err(|e| e.to_string())?,
            None => {
                if name.split(['/', '\\']).any(|p| p == "..") || name.contains(':') {
                    return Err("Geçersiz dosya yolu.".into());
                }
                use std::io::Read;
                let mut buf = Vec::new();
                fs::File::open(Path::new(&path).join(&name))
                    .map_err(|e| e.to_string())?
                    .take(max + 1)
                    .read_to_end(&mut buf)
                    .map_err(|e| e.to_string())?;
                buf
            }
        };
        let truncated = data.len() as u64 > max;
        if let Some(mime) = mime {
            if truncated {
                return Ok(Preview { kind: "none", text: None, data_url: None, truncated: true });
            }
            let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
            return Ok(Preview {
                kind: "image",
                text: None,
                data_url: Some(format!("data:{mime};base64,{b64}")),
                truncated: false,
            });
        }
        let slice = &data[..data.len().min(max as usize)];
        Ok(Preview {
            kind: "text",
            text: Some(String::from_utf8_lossy(slice).into_owned()),
            data_url: None,
            truncated,
        })
    })
    .await
}

// ---------------------------------------------------------------------------
// Silme
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeleteReq {
    path: String,
    workshop_id: Option<String>,
    container: bool,
}

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct OpResult {
    path: String,
    ok: bool,
    error: Option<String>,
    warning: Option<String>,
    output: Option<String>,
}

fn depth_under(root: &Path, target: &Path) -> Option<Vec<String>> {
    let root = fs::canonicalize(root).ok()?;
    let rel = target.strip_prefix(&root).ok()?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect())
}

/// Yalnızca taramanın listelediği türden konumların silinmesine izin verir.
fn check_deletable(paths: &Paths, target: &Path, container: bool) -> Result<PathBuf, String> {
    let t = fs::canonicalize(target).map_err(|e| format!("Yol bulunamadı: {e}"))?;
    let game = depth_under(&paths.game, &t);
    let ok = if container {
        let top = ["hc_cache", "downloadlists", "data", "demos", "screenshots", "saves", "dupes"];
        match &game {
            Some(rel) if rel.len() == 1 => top.contains(&rel[0].as_str()),
            Some(rel) if rel.len() >= 2 => rel[0] == "cache" || rel[0] == "download",
            _ => {
                depth_under(&paths.workshop, &t)
                    .is_some_and(|r| r.len() == 1 && (r[0] == "downloads" || r[0] == "temp"))
                    || depth_under(&paths.gmod, &t).is_some_and(|r| r.len() == 1 && r[0] == "crashes")
            }
        }
    } else {
        match &game {
            Some(rel) if rel.len() == 2 => rel[0] == "addons" || rel[0] == "maps",
            Some(rel) if rel.len() == 3 => rel[0] == "cache" && rel[1] == "workshop",
            _ => depth_under(&paths.content, &t).is_some_and(|r| r.len() == 1),
        }
    };
    if ok {
        Ok(t)
    } else {
        Err("Bu konumun silinmesine izin verilmiyor.".into())
    }
}

fn remove(path: &Path, container: bool, to_trash: bool) -> Result<(), String> {
    let targets: Vec<PathBuf> = if container {
        fs::read_dir(path).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).collect()
    } else {
        vec![path.to_path_buf()]
    };
    if targets.is_empty() {
        return Ok(());
    }
    if to_trash {
        return trash::delete_all(&targets).map_err(|e| format!("Geri Dönüşüm Kutusu'na taşınamadı: {e}"));
    }
    for t in targets {
        let res = if t.is_dir() { fs::remove_dir_all(&t) } else { fs::remove_file(&t) };
        match res {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(format!("Silinemedi: {e}")),
            _ => {}
        }
    }
    Ok(())
}

#[tauri::command]
async fn delete_items(
    app: AppHandle,
    state: State<'_, Shared>,
    items: Vec<DeleteReq>,
    to_trash: bool,
    allow_without_steam: bool,
) -> Result<Vec<OpResult>, String> {
    let st = state.inner().clone();
    blocking(move || {
        let paths = st.paths()?;
        let needs_steam = items.iter().any(|i| i.workshop_id.is_some());
        let client = if needs_steam { st.steam.connect().ok() } else { None };
        let rep = Reporter::new(&app, "delete", items.len());
        let mut out = Vec::with_capacity(items.len());

        for (i, item) in items.iter().enumerate() {
            let label = Path::new(&item.path).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            rep.send(i, &label, 0.0, false);
            let mut res = OpResult { path: item.path.clone(), ..Default::default() };
            let outcome = (|| -> Result<(), String> {
                let target = check_deletable(&paths, Path::new(&item.path), item.container)?;
                if let Some(id) = item.workshop_id.as_ref().and_then(|w| w.parse::<u64>().ok()) {
                    match &client {
                        Some(c) => {
                            steam::unsubscribe(c, id)?;
                        }
                        None if allow_without_steam => {
                            res.warning = Some("Steam bağlı değildi; abonelik varsa Steam yeniden indirebilir.".into());
                        }
                        None => return Err("Steam bağlı değil; abonelikten çıkılamadı.".into()),
                    }
                }
                // Abonelik bitince Steam klasörü kendisi silmiş olabilir.
                if !target.exists() {
                    return Ok(());
                }
                remove(&target, item.container, to_trash)
            })();
            match outcome {
                Ok(()) => res.ok = true,
                Err(e) => res.error = Some(e),
            }
            out.push(res);
        }
        rep.send(items.len(), "", 1.0, true);
        Ok(out)
    })
    .await
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportReq {
    gma_path: String,
    name: String,
}

/// `mode`: "extract" klasöre çıkarır, "gma" tek dosya olarak kopyalar.
fn export_one(gma_path: &Path, name: &str, dest: &Path, mode: &str, progress: impl FnMut(u64, u64)) -> Result<PathBuf, String> {
    let base = paths::safe_name(name);
    if !dest.is_absolute() {
        return Err("Hedef klasör geçersiz.".into());
    }
    if mode == "gma" {
        let out = paths::unique(dest.join(format!("{base}.gma")));
        gma::copy_plain(gma_path, &out).map_err(|e| format!("Kopyalanamadı: {e}"))?;
        Ok(out)
    } else {
        let out = paths::unique(dest.join(base));
        gma::extract(gma_path, &out, progress).map_err(|e| format!("Çıkarılamadı: {e}"))?;
        Ok(out)
    }
}

#[tauri::command]
async fn export_items(
    app: AppHandle,
    items: Vec<ExportReq>,
    dest: String,
    mode: String,
) -> Result<Vec<OpResult>, String> {
    blocking(move || {
        let dest = PathBuf::from(dest);
        if !dest.is_absolute() {
            return Err("Hedef klasör geçersiz.".into());
        }
        fs::create_dir_all(&dest).map_err(|e| format!("Hedef klasör oluşturulamadı: {e}"))?;
        let rep = Reporter::new(&app, "export", items.len());
        let mut out = Vec::new();
        for (i, item) in items.iter().enumerate() {
            rep.send(i, &item.name, 0.0, true);
            let r = export_one(Path::new(&item.gma_path), &item.name, &dest, &mode, |d, t| {
                rep.send(i, &item.name, if t > 0 { d as f64 / t as f64 } else { 1.0 }, false)
            });
            out.push(match r {
                Ok(p) => OpResult { path: item.gma_path.clone(), ok: true, output: Some(p.to_string_lossy().into_owned()), ..Default::default() },
                Err(e) => OpResult { path: item.gma_path.clone(), error: Some(e), ..Default::default() },
            });
        }
        rep.send(items.len(), "", 1.0, true);
        Ok(out)
    })
    .await
}

#[derive(Deserialize)]
struct DownloadReq {
    id: String,
    title: String,
}

#[tauri::command]
async fn download_export(
    app: AppHandle,
    state: State<'_, Shared>,
    items: Vec<DownloadReq>,
    dest: String,
    mode: String,
    keep: bool,
) -> Result<Vec<OpResult>, String> {
    let st = state.inner().clone();
    blocking(move || {
        let paths = st.paths()?;
        let client = st.steam.connect()?;
        let dest = PathBuf::from(dest);
        if !dest.is_absolute() {
            return Err("Hedef klasör geçersiz.".into());
        }
        fs::create_dir_all(&dest).map_err(|e| format!("Hedef klasör oluşturulamadı: {e}"))?;
        let rep = Reporter::new(&app, "download", items.len());
        let subscribed = steam::subscribed(&client);
        let mut out = Vec::new();

        for (i, item) in items.iter().enumerate() {
            let name = if item.title.trim().is_empty() { item.id.clone() } else { item.title.clone() };
            rep.send(i, &format!("İndiriliyor: {name}"), 0.0, true);
            let r = (|| -> Result<PathBuf, String> {
                let id: u64 = item.id.parse().map_err(|_| "Geçersiz kimlik.".to_string())?;
                let local = paths.content.join(&item.id);
                let existed = local.exists();
                let installed = steam::download(&client, id, |d, t| {
                    rep.send(i, &format!("İndiriliyor: {name}"), if t > 0 { d as f64 / t as f64 * 0.7 } else { 0.0 }, false)
                })?;
                let gma_file = if installed.is_file() {
                    installed.clone()
                } else {
                    scan::find_gma(&installed).ok_or("İndirilen öğede GMA dosyası yok.")?
                };
                rep.send(i, &format!("Dışa aktarılıyor: {name}"), 0.7, true);
                let outp = export_one(&gma_file, &name, &dest, &mode, |d, t| {
                    rep.send(i, &format!("Dışa aktarılıyor: {name}"), 0.7 + if t > 0 { d as f64 / t as f64 * 0.3 } else { 0.3 }, false)
                })?;
                // Yalnızca bu işlem için indirildiyse ve abone olunmamışsa indirilen kopyayı temizle.
                if !existed && !keep && !subscribed.contains(&item.id) {
                    if let Ok(t) = check_deletable(&paths, &local, false) {
                        let _ = remove(&t, false, false);
                    }
                }
                Ok(outp)
            })();
            out.push(match r {
                Ok(p) => OpResult { path: item.id.clone(), ok: true, output: Some(p.to_string_lossy().into_owned()), ..Default::default() },
                Err(e) => OpResult { path: item.id.clone(), error: Some(e), ..Default::default() },
            });
        }
        rep.send(items.len(), "", 1.0, true);
        Ok(out)
    })
    .await
}

// ---------------------------------------------------------------------------
// Workshop bilgileri
// ---------------------------------------------------------------------------

#[tauri::command]
async fn workshop_details(state: State<'_, Shared>, ids: Vec<String>, refresh: bool) -> Result<Vec<web::Details>, String> {
    let st = state.inner().clone();
    blocking(move || {
        let missing: Vec<String> = {
            let cache = st.details.lock().unwrap();
            ids.iter()
                .filter(|i| refresh || cache.get(*i).is_none_or(|d| d.found && d.creator.is_empty()))
                .cloned()
                .collect()
        };
        let mut fetch_error = None;
        if !missing.is_empty() {
            match web::details(&missing) {
                Ok(list) => {
                    let mut cache = st.details.lock().unwrap();
                    for d in list {
                        cache.insert(d.id.clone(), d);
                    }
                    if let Some(p) = st.details_path.parent() {
                        let _ = fs::create_dir_all(p);
                    }
                    let _ = fs::write(&st.details_path, serde_json::to_string(&*cache).unwrap_or_default());
                }
                Err(e) => fetch_error = Some(e),
            }
        }
        let cache = st.details.lock().unwrap();
        let found: Vec<web::Details> = ids.iter().filter_map(|i| cache.get(i).cloned()).collect();
        match fetch_error {
            Some(e) if found.is_empty() => Err(e),
            _ => Ok(found),
        }
    })
    .await
}

/// Yapımcının görünen adını döndürür (oturum boyunca önbelleğe alınır).
#[tauri::command]
async fn steam_author(state: State<'_, Shared>, steam_id: String) -> Result<String, String> {
    let st = state.inner().clone();
    blocking(move || {
        if let Some(n) = st.authors.lock().unwrap().get(&steam_id) {
            return Ok(n.clone());
        }
        // Steam bağlıysa adı istemciden al; değilse herkese açık profil sayfasından oku.
        let from_client = st
            .steam
            .get()
            .zip(steam_id.parse::<u64>().ok())
            .and_then(|(c, id)| steam::persona_name(&c, id));
        let name = match from_client {
            Some(n) => n,
            None => web::persona_name(&steam_id)?,
        };
        st.authors.lock().unwrap().insert(steam_id, name.clone());
        Ok(name)
    })
    .await
}

#[tauri::command]
async fn resolve_link(input: String) -> Result<web::Resolved, String> {
    blocking(move || web::resolve(&input)).await
}

// ---------------------------------------------------------------------------
// Steam
// ---------------------------------------------------------------------------

#[tauri::command]
fn steam_status(state: State<'_, Shared>) -> steam::Status {
    state.steam.status()
}

#[tauri::command]
async fn steam_connect(state: State<'_, Shared>) -> Result<steam::Status, String> {
    let st = state.inner().clone();
    blocking(move || {
        Ok(match st.steam.connect() {
            Ok(_) => st.steam.status(),
            Err(e) => steam::Status { error: Some(e), ..Default::default() },
        })
    })
    .await
}

#[tauri::command]
fn steam_disconnect(state: State<'_, Shared>) -> steam::Status {
    state.steam.disconnect();
    state.steam.status()
}

#[tauri::command]
fn steam_subscribed(state: State<'_, Shared>) -> Vec<String> {
    state.steam.get().map(|c| steam::subscribed(&c)).unwrap_or_default()
}

#[tauri::command]
async fn my_published(state: State<'_, Shared>) -> Result<Vec<steam::Published>, String> {
    let st = state.inner().clone();
    blocking(move || steam::my_published(&st.steam.connect()?)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PublishPreview {
    files: usize,
    size: u64,
    skipped: Vec<String>,
    skipped_count: usize,
    title: Option<String>,
    addon_type: Option<String>,
    tags: Vec<String>,
    ignore: Vec<String>,
}

fn strings(v: &serde_json::Value) -> Vec<String> {
    v.as_array().map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect()).unwrap_or_default()
}

/// Seçilen klasörü inceler: addon.json'u okur ve pakete girecek dosyaları sayar.
#[tauri::command]
async fn publish_preview(folder: String, ignore: Option<Vec<String>>) -> Result<PublishPreview, String> {
    blocking(move || {
        let dir = Path::new(&folder);
        if !dir.is_dir() {
            return Err("Klasör bulunamadı.".into());
        }
        let json = fs::read_to_string(dir.join("addon.json"))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
            .unwrap_or(serde_json::Value::Null);
        let ignore = ignore.unwrap_or_else(|| strings(&json["ignore"]));
        let plan = gma::plan(dir, &ignore).map_err(|e| e.to_string())?;
        Ok(PublishPreview {
            files: plan.files.len(),
            size: plan.files.iter().map(|f| f.2).sum(),
            skipped_count: plan.skipped.len(),
            skipped: plan.skipped.into_iter().take(200).collect(),
            title: json["title"].as_str().map(String::from),
            addon_type: json["type"].as_str().map(|s| s.to_lowercase()),
            tags: strings(&json["tags"]).into_iter().map(|s| s.to_lowercase()).collect(),
            ignore,
        })
    })
    .await
}

#[tauri::command]
async fn publish(app: AppHandle, state: State<'_, Shared>, request: steam::PublishRequest) -> Result<steam::PublishResult, String> {
    let st = state.inner().clone();
    blocking(move || {
        let client = st.steam.connect()?;
        let rep = Reporter::new(&app, "publish", 1);
        let res = steam::publish(&client, &request, |label, f| rep.send(0, label, f, false));
        rep.send(1, "", 1.0, true);
        res
    })
    .await
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let cfg_dir = app.path().app_config_dir()?;
            let cache_dir = app.path().app_cache_dir()?;
            let cfg_path = cfg_dir.join("config.json");
            let details_path = cache_dir.join("workshop-details.json");
            let details = fs::read_to_string(&details_path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_default();
            app.manage(Arc::new(AppState {
                cfg: Mutex::new(Config::load(&cfg_path)),
                cfg_path,
                details_path,
                details: Mutex::new(details),
                authors: Mutex::new(HashMap::new()),
                steam: steam::Steam::default(),
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_info,
            set_config,
            scan_all,
            inspect_item,
            read_entry,
            delete_items,
            export_items,
            download_export,
            workshop_details,
            resolve_link,
            steam_author,
            steam_status,
            steam_connect,
            steam_disconnect,
            steam_subscribed,
            my_published,
            publish_preview,
            publish,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
