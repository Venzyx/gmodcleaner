//! Steamworks bağlantısı: abonelikten çıkma, indirme ve yayınlama.
//! Steam açıkken ve hesapta Garry's Mod varken çalışır.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use steamworks::{
    AppIDs, AppId, Client, DownloadItemResult, FileType, ItemState, PublishedFileId,
    PublishedFileVisibility, UGCType, UpdateStatus, UserList, UserListOrder,
};

const GMOD: u32 = 4000;

/// Tek dosyalık dağıtım için Steam API kütüphanesi çalıştırılabilir dosyaya gömülür.
static STEAM_API_DLL: &[u8] = include_bytes!("../steam_api64.dll");

#[link(name = "kernel32")]
unsafe extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut std::ffi::c_void;
}

/// Gömülü DLL'i kullanıcı verisi klasörüne çıkarır ve yükler. steam_api64.dll gecikmeli
/// yüklendiği için (bkz. build.rs) ilk Steam çağrısından önce bunun çalışması yeterlidir.
fn ensure_api_loaded() -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    static LOADED: std::sync::OnceLock<Result<(), String>> = std::sync::OnceLock::new();
    LOADED
        .get_or_init(|| {
            let dir = std::env::var_os("LOCALAPPDATA")
                .map(PathBuf::from)
                .unwrap_or_else(std::env::temp_dir)
                .join("com.gmodcleaner.app");
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            let path = dir.join("steam_api64.dll");
            let current = std::fs::read(&path).map(|b| b == STEAM_API_DLL).unwrap_or(false);
            if !current {
                std::fs::write(&path, STEAM_API_DLL).map_err(|e| format!("steam_api64.dll yazılamadı: {e}"))?;
            }
            let wide: Vec<u16> = path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
            if unsafe { LoadLibraryW(wide.as_ptr()) }.is_null() {
                return Err("steam_api64.dll yüklenemedi.".to_string());
            }
            Ok(())
        })
        .clone()
}

#[derive(Default)]
pub struct Steam {
    client: Mutex<Option<Client>>,
    generation: Arc<AtomicU64>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub connected: bool,
    pub name: String,
    pub error: Option<String>,
}

impl Steam {
    pub fn get(&self) -> Option<Client> {
        self.client.lock().unwrap().clone()
    }

    pub fn connect(&self) -> Result<Client, String> {
        let mut guard = self.client.lock().unwrap();
        if let Some(c) = &*guard {
            return Ok(c.clone());
        }
        ensure_api_loaded()?;
        let client = Client::init_app(GMOD).map_err(|e| {
            format!("Steam'e bağlanılamadı. Steam'in açık olduğundan ve hesabında Garry's Mod bulunduğundan emin ol. ({e})")
        })?;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let pump = client.clone();
        let current = self.generation.clone();
        thread::spawn(move || {
            while current.load(Ordering::SeqCst) == generation {
                pump.run_callbacks();
                thread::sleep(Duration::from_millis(50));
            }
        });
        *guard = Some(client.clone());
        Ok(client)
    }

    pub fn disconnect(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.client.lock().unwrap() = None;
    }

    pub fn status(&self) -> Status {
        match self.get() {
            Some(c) => Status { connected: true, name: c.friends().name(), error: None },
            None => Status::default(),
        }
    }
}

/// Bir kullanıcının görünen adını Steam istemcisinden ister.
pub fn persona_name(c: &Client, steam_id: u64) -> Option<String> {
    let friends = c.friends();
    let id = steamworks::SteamId::from_raw(steam_id);
    let known = |n: String| (!n.is_empty() && n != "[unknown]").then_some(n);
    // false dönerse bilgi zaten eldedir; true ise birazdan gelir.
    if !friends.request_user_information(id, true) {
        return known(friends.get_friend(id).name());
    }
    let started = Instant::now();
    while started.elapsed() < Duration::from_secs(4) {
        thread::sleep(Duration::from_millis(100));
        if let Some(n) = known(friends.get_friend(id).name()) {
            return Some(n);
        }
    }
    None
}

pub fn subscribed(c: &Client) -> Vec<String> {
    c.ugc().subscribed_items(true).into_iter().map(|p| p.0.to_string()).collect()
}

/// Abone olunan öğeden çıkar. Abone değilse `Ok(false)` döner.
pub fn unsubscribe(c: &Client, id: u64) -> Result<bool, String> {
    let ugc = c.ugc();
    let pid = PublishedFileId(id);
    if !ugc.item_state(pid).contains(ItemState::SUBSCRIBED) {
        return Ok(false);
    }
    let (tx, rx) = mpsc::channel();
    ugc.unsubscribe_item(pid, move |r| {
        let _ = tx.send(r.map_err(|e| e.to_string()));
    });
    match rx.recv_timeout(Duration::from_secs(20)) {
        Ok(Ok(())) => Ok(true),
        Ok(Err(e)) => Err(format!("Abonelikten çıkılamadı: {e}")),
        Err(_) => Err("Abonelikten çıkılamadı: Steam yanıt vermedi.".into()),
    }
}

fn ready(state: ItemState) -> bool {
    state.contains(ItemState::INSTALLED)
        && !state.intersects(ItemState::NEEDS_UPDATE | ItemState::DOWNLOADING | ItemState::DOWNLOAD_PENDING)
}

/// Öğeyi (abone olmadan) indirir ve kurulduğu yolu döndürür.
pub fn download(c: &Client, id: u64, progress: impl Fn(u64, u64)) -> Result<PathBuf, String> {
    let ugc = c.ugc();
    let pid = PublishedFileId(id);
    if !ready(ugc.item_state(pid)) {
        let (tx, rx) = mpsc::channel();
        let _handle = c.register_callback(move |r: DownloadItemResult| {
            let _ = tx.send((r.published_file_id.0, r.error.map(|e| e.to_string())));
        });
        if !ugc.download_item(pid, true) {
            return Err("Steam indirmeyi başlatamadı.".into());
        }
        let started = Instant::now();
        let mut last_change = Instant::now();
        let mut last_bytes = 0u64;
        loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok((rid, err)) if rid == id => match err {
                    Some(e) => return Err(format!("İndirilemedi: {e}")),
                    None => break,
                },
                Ok(_) | Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => return Err("Steam bağlantısı koptu.".into()),
            }
            if started.elapsed() > Duration::from_secs(2) && ready(ugc.item_state(pid)) {
                break;
            }
            if let Some((done, total)) = ugc.item_download_info(pid) {
                if done != last_bytes {
                    last_bytes = done;
                    last_change = Instant::now();
                }
                progress(done, total);
            }
            if last_change.elapsed() > Duration::from_secs(180) {
                return Err("İndirme ilerlemiyor (zaman aşımı).".into());
            }
        }
    }
    ugc.item_install_info(pid)
        .map(|i| PathBuf::from(i.folder))
        .ok_or_else(|| "İndirilen öğenin konumu bulunamadı.".to_string())
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Published {
    pub id: String,
    pub title: String,
    pub preview: String,
    pub updated: u64,
    pub tags: Vec<String>,
}

/// Kullanıcının GMod için yayınladığı öğeler (ilk sayfa).
pub fn my_published(c: &Client) -> Result<Vec<Published>, String> {
    let account = c.user().steam_id().account_id();
    let query = c
        .ugc()
        .query_user(
            account,
            UserList::Published,
            UGCType::Items,
            UserListOrder::LastUpdatedDesc,
            AppIDs::ConsumerAppId(AppId(GMOD)),
            1,
        )
        .map_err(|_| "Steam sorgusu oluşturulamadı.".to_string())?;
    let (tx, rx) = mpsc::channel();
    query.fetch(move |res| {
        let out = res.map_err(|e| e.to_string()).map(|r| {
            (0..r.returned_results())
                .filter_map(|i| {
                    r.get(i).map(|q| Published {
                        id: q.published_file_id.0.to_string(),
                        title: q.title,
                        preview: r.preview_url(i).unwrap_or_default(),
                        updated: q.time_updated as u64,
                        tags: q.tags,
                    })
                })
                .collect::<Vec<_>>()
        });
        let _ = tx.send(out);
    });
    rx.recv_timeout(Duration::from_secs(30))
        .map_err(|_| "Steam yanıt vermedi.".to_string())?
        .map_err(|e| format!("Yayınlanan öğeler alınamadı: {e}"))
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishRequest {
    pub folder: String,
    pub title: String,
    pub description: String,
    pub addon_type: String,
    pub tags: Vec<String>,
    pub ignore: Vec<String>,
    pub icon: Option<String>,
    pub existing_id: Option<String>,
    pub change_note: String,
    /// public | friends | private | unlisted (yalnızca yeni öğede kullanılır)
    pub visibility: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PublishResult {
    pub id: String,
    pub needs_agreement: bool,
    pub files: usize,
}

pub fn publish(
    c: &Client,
    req: &PublishRequest,
    progress: impl Fn(&str, f64),
) -> Result<PublishResult, String> {
    let folder = Path::new(&req.folder);
    if !folder.is_dir() {
        return Err("Addon klasörü bulunamadı.".into());
    }
    let is_new = req.existing_id.is_none();
    if is_new && req.title.trim().is_empty() {
        return Err("Başlık boş olamaz.".into());
    }
    if let Some(icon) = &req.icon {
        let len = std::fs::metadata(icon).map_err(|e| format!("Görsel okunamadı: {e}"))?.len();
        if len > 1_000_000 {
            return Err("Önizleme görseli 1 MB'den küçük olmalı.".into());
        }
    }

    progress("Dosyalar taranıyor", 0.0);
    let plan = crate::gma::plan(folder, &req.ignore).map_err(|e| e.to_string())?;
    if plan.files.is_empty() {
        return Err("Klasörde GMod'un kabul ettiği hiçbir dosya yok.".into());
    }

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let work = std::env::temp_dir().join("gmodcleaner").join(format!("publish-{stamp}"));
    let gma_tmp = work.join("addon.gma");
    let result = (|| {
        crate::gma::write(
            &gma_tmp,
            req.title.trim(),
            &req.description,
            &req.addon_type,
            &req.tags,
            &plan,
            |d, t| progress("GMA paketleniyor", if t > 0 { d as f64 / t as f64 } else { 1.0 }),
        )
        .map_err(|e| format!("GMA oluşturulamadı: {e}"))?;

        let ugc = c.ugc();
        let mut needs_agreement = false;
        let id = match &req.existing_id {
            Some(raw) => crate::web::parse_id(raw)
                .and_then(|s| s.parse::<u64>().ok())
                .ok_or("Güncellenecek öğenin kimliği geçersiz.")?,
            None => {
                progress("Workshop öğesi oluşturuluyor", 0.0);
                let (tx, rx) = mpsc::channel();
                ugc.create_item(AppId(GMOD), FileType::Community, move |r| {
                    let _ = tx.send(r.map_err(|e| e.to_string()));
                });
                let (pid, agreement) = rx
                    .recv_timeout(Duration::from_secs(60))
                    .map_err(|_| "Steam yanıt vermedi.".to_string())?
                    .map_err(|e| format!("Workshop öğesi oluşturulamadı: {e}"))?;
                needs_agreement = agreement;
                pid.0
            }
        };

        std::fs::rename(&gma_tmp, work.join(format!("{id}.gma"))).map_err(|e| e.to_string())?;

        let mut tags = vec!["Addon".to_string()];
        if !req.addon_type.is_empty() {
            tags.push(req.addon_type.clone());
        }
        tags.extend(req.tags.iter().cloned());

        let mut update = ugc.start_item_update(AppId(GMOD), PublishedFileId(id)).content_path(&work).tags(tags, false);
        if !req.title.trim().is_empty() {
            update = update.title(req.title.trim());
        }
        if is_new || !req.description.trim().is_empty() {
            update = update.description(&req.description);
        }
        if let Some(icon) = &req.icon {
            update = update.preview_path(Path::new(icon));
        }
        if is_new {
            update = update.visibility(match req.visibility.as_str() {
                "public" => PublishedFileVisibility::Public,
                "friends" => PublishedFileVisibility::FriendsOnly,
                "unlisted" => PublishedFileVisibility::Unlisted,
                _ => PublishedFileVisibility::Private,
            });
        }

        let (tx, rx) = mpsc::channel();
        let note = req.change_note.trim();
        let watch = update.submit((!note.is_empty()).then_some(note), move |r| {
            let _ = tx.send(r.map_err(|e| e.to_string()));
        });
        let started = Instant::now();
        let (_, agreement) = loop {
            match rx.recv_timeout(Duration::from_millis(200)) {
                Ok(r) => break r.map_err(|e| format!("Yükleme başarısız: {e}"))?,
                Err(RecvTimeoutError::Timeout) => {
                    let (status, done, total) = watch.progress();
                    let label = match status {
                        UpdateStatus::PreparingConfig => "Hazırlanıyor",
                        UpdateStatus::PreparingContent => "İçerik hazırlanıyor",
                        UpdateStatus::UploadingContent => "Yükleniyor",
                        UpdateStatus::UploadingPreviewFile => "Görsel yükleniyor",
                        UpdateStatus::CommittingChanges => "Değişiklikler kaydediliyor",
                        UpdateStatus::Invalid => "Yükleniyor",
                    };
                    progress(label, if total > 0 { done as f64 / total as f64 } else { 0.0 });
                    if started.elapsed() > Duration::from_secs(3600) {
                        return Err("Yükleme zaman aşımına uğradı.".to_string());
                    }
                }
                Err(RecvTimeoutError::Disconnected) => return Err("Steam bağlantısı koptu.".to_string()),
            }
        };
        Ok(PublishResult {
            id: id.to_string(),
            needs_agreement: needs_agreement || agreement,
            files: plan.files.len(),
        })
    })();
    let _ = std::fs::remove_dir_all(&work);
    result
}
