//! Steam Web API: workshop öğe ayrıntıları ve koleksiyon içerikleri (anahtar gerektirmez).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

const DETAILS: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/";
const COLLECTION: &str = "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Details {
    pub id: String,
    pub found: bool,
    pub title: String,
    pub description: String,
    pub preview: String,
    pub size: u64,
    pub updated: u64,
    pub tags: Vec<String>,
    pub app_id: u64,
    /// Yapımcının SteamID64'ü.
    #[serde(default)]
    pub creator: String,
}

fn num(v: &Value) -> u64 {
    v.as_u64().or_else(|| v.as_str().and_then(|s| s.parse().ok())).unwrap_or(0)
}

fn post(url: &str, form: &[(String, String)]) -> Result<Value, String> {
    let pairs: Vec<(&str, &str)> = form.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    ureq::post(url)
        .timeout(Duration::from_secs(20))
        .send_form(&pairs)
        .map_err(|e| format!("Steam'e ulaşılamadı: {e}"))?
        .into_json::<Value>()
        .map_err(|e| format!("Steam yanıtı okunamadı: {e}"))
}

pub fn details(ids: &[String]) -> Result<Vec<Details>, String> {
    let mut out = Vec::new();
    for chunk in ids.chunks(100) {
        let mut form = vec![("itemcount".to_string(), chunk.len().to_string())];
        for (i, id) in chunk.iter().enumerate() {
            form.push((format!("publishedfileids[{i}]"), id.clone()));
        }
        let v = post(DETAILS, &form)?;
        for d in v["response"]["publishedfiledetails"].as_array().into_iter().flatten() {
            let id = d["publishedfileid"].as_str().unwrap_or("").to_string();
            if id.is_empty() {
                continue;
            }
            out.push(Details {
                id,
                found: num(&d["result"]) == 1,
                title: d["title"].as_str().unwrap_or("").to_string(),
                description: d["description"].as_str().unwrap_or("").chars().take(4000).collect(),
                preview: d["preview_url"].as_str().unwrap_or("").to_string(),
                size: num(&d["file_size"]),
                updated: num(&d["time_updated"]),
                tags: d["tags"]
                    .as_array()
                    .map(|a| a.iter().filter_map(|t| t["tag"].as_str().map(String::from)).collect())
                    .unwrap_or_default(),
                app_id: num(&d["consumer_app_id"]),
                creator: d["creator"].as_str().unwrap_or("").to_string(),
            });
        }
    }
    Ok(out)
}

/// Koleksiyonun doğrudan çocuklarını döndürür: (id, koleksiyon mu). Koleksiyon değilse `None`.
fn collection_children(id: &str) -> Result<Option<Vec<(String, bool)>>, String> {
    let form = vec![
        ("collectioncount".to_string(), "1".to_string()),
        ("publishedfileids[0]".to_string(), id.to_string()),
    ];
    let v = post(COLLECTION, &form)?;
    let c = &v["response"]["collectiondetails"][0];
    if num(&c["result"]) != 1 {
        return Ok(None);
    }
    let Some(children) = c["children"].as_array() else {
        return Ok(None);
    };
    Ok(Some(
        children
            .iter()
            .filter_map(|ch| {
                ch["publishedfileid"].as_str().map(|i| (i.to_string(), num(&ch["filetype"]) == 2))
            })
            .collect(),
    ))
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Resolved {
    pub id: String,
    /// item | collection
    pub kind: &'static str,
    pub title: String,
    pub preview: String,
    pub items: Vec<Details>,
}

/// Bir bağlantı ya da metinden workshop kimliğini ayıklar.
pub fn parse_id(input: &str) -> Option<String> {
    let t = input.trim();
    if !t.is_empty() && t.chars().all(|c| c.is_ascii_digit()) {
        return Some(t.to_string());
    }
    let pos = t.find("id=")?;
    let digits: String = t[pos + 3..].chars().take_while(|c| c.is_ascii_digit()).collect();
    (!digits.is_empty()).then_some(digits)
}

pub fn resolve(input: &str) -> Result<Resolved, String> {
    let id = parse_id(input).ok_or("Geçerli bir Workshop bağlantısı ya da kimliği gir.")?;
    let own = details(std::slice::from_ref(&id))?.into_iter().next().unwrap_or_default();

    let Some(first) = collection_children(&id)? else {
        if !own.found {
            return Err("Bu öğe bulunamadı (silinmiş ya da gizli olabilir).".into());
        }
        if own.app_id != 0 && own.app_id != 4000 {
            return Err("Bu öğe Garry's Mod'a ait değil.".into());
        }
        return Ok(Resolved {
            id,
            kind: "item",
            title: own.title.clone(),
            preview: own.preview.clone(),
            items: vec![own],
        });
    };

    // İç içe koleksiyonları da aç (döngüye karşı görülenleri tut).
    let mut seen: HashSet<String> = HashSet::from([id.clone()]);
    let mut ids: Vec<String> = Vec::new();
    let mut queue = first;
    let mut depth = 0;
    while !queue.is_empty() && depth < 4 {
        let mut next = Vec::new();
        for (cid, is_collection) in queue {
            if !seen.insert(cid.clone()) {
                continue;
            }
            if is_collection {
                if let Some(ch) = collection_children(&cid)? {
                    next.extend(ch);
                }
            } else {
                ids.push(cid);
            }
        }
        queue = next;
        depth += 1;
    }

    let by_id: HashMap<String, Details> = details(&ids)?.into_iter().map(|d| (d.id.clone(), d)).collect();
    let items = ids
        .iter()
        .map(|i| by_id.get(i).cloned().unwrap_or(Details { id: i.clone(), ..Default::default() }))
        .collect();
    Ok(Resolved { id, kind: "collection", title: own.title, preview: own.preview, items })
}

/// Bir SteamID64'ün görünen adını herkese açık profil XML'inden okur (anahtar gerektirmez).
pub fn persona_name(steam_id: &str) -> Result<String, String> {
    if steam_id.is_empty() || !steam_id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Geçersiz SteamID.".into());
    }
    let xml = ureq::get(&format!("https://steamcommunity.com/profiles/{steam_id}/?xml=1"))
        .timeout(Duration::from_secs(15))
        .call()
        .map_err(|e| format!("Steam'e ulaşılamadı: {e}"))?
        .into_string()
        .map_err(|e| e.to_string())?;
    let start = xml.find("<steamID>").ok_or("Profil bulunamadı.")? + "<steamID>".len();
    let end = xml[start..].find("</steamID>").ok_or("Profil bulunamadı.")? + start;
    let name = xml[start..end].trim().trim_start_matches("<![CDATA[").trim_end_matches("]]>").trim();
    if name.is_empty() {
        return Err("Profil bulunamadı.".into());
    }
    Ok(name.to_string())
}
