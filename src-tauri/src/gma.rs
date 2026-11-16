//! GMA (Garry's Mod Addon) okuma, çıkarma ve yazma.
//! Düz `.gma` dosyalarını ve Steam'in LZMA ile sıkıştırdığı eski `_legacy.bin` dosyalarını destekler.

use serde::Serialize;
use std::fs::{self, File};
use std::io::{self, BufRead, BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

const MAX_CSTR: u64 = 4 << 20;
const MAX_ENTRIES: usize = 500_000;

pub enum Source {
    Plain(BufReader<File>),
    Lzma(BufReader<xz2::read::XzDecoder<File>>),
}

impl Source {
    pub fn open(path: &Path) -> io::Result<Self> {
        let mut f = File::open(path)?;
        let mut magic = [0u8; 4];
        let n = f.read(&mut magic)?;
        f.seek(SeekFrom::Start(0))?;
        if n == 4 && &magic == b"GMAD" {
            Ok(Source::Plain(BufReader::with_capacity(1 << 16, f)))
        } else {
            let stream = xz2::stream::Stream::new_lzma_decoder(u64::MAX).map_err(io::Error::from)?;
            Ok(Source::Lzma(BufReader::with_capacity(
                1 << 16,
                xz2::read::XzDecoder::new_stream(f, stream),
            )))
        }
    }

    pub fn is_compressed(&self) -> bool {
        matches!(self, Source::Lzma(_))
    }

    fn skip(&mut self, n: u64) -> io::Result<()> {
        match self {
            Source::Plain(r) => r.seek_relative(n as i64),
            Source::Lzma(r) => {
                let copied = io::copy(&mut r.by_ref().take(n), &mut io::sink())?;
                if copied < n {
                    Err(io::ErrorKind::UnexpectedEof.into())
                } else {
                    Ok(())
                }
            }
        }
    }
}

impl Read for Source {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Source::Plain(r) => r.read(buf),
            Source::Lzma(r) => r.read(buf),
        }
    }
}

impl BufRead for Source {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        match self {
            Source::Plain(r) => r.fill_buf(),
            Source::Lzma(r) => r.fill_buf(),
        }
    }
    fn consume(&mut self, amt: usize) {
        match self {
            Source::Plain(r) => r.consume(amt),
            Source::Lzma(r) => r.consume(amt),
        }
    }
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct GmaMeta {
    pub title: String,
    pub description: String,
    pub author: String,
    pub addon_type: String,
    pub tags: Vec<String>,
    pub timestamp: u64,
    pub compressed: bool,
}

#[derive(Clone, Debug)]
pub struct GmaEntry {
    pub name: String,
    pub size: u64,
    pub crc: u32,
}

fn bad(msg: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, msg.to_string())
}

fn read_cstr<R: BufRead>(src: &mut R) -> io::Result<String> {
    let mut buf = Vec::new();
    src.by_ref().take(MAX_CSTR).read_until(0, &mut buf)?;
    if buf.pop() != Some(0) {
        return Err(bad("bozuk GMA metni"));
    }
    Ok(String::from_utf8_lossy(&buf).into_owned())
}

fn read_u32<R: BufRead>(src: &mut R) -> io::Result<u32> {
    let mut b = [0u8; 4];
    src.read_exact(&mut b)?;
    Ok(u32::from_le_bytes(b))
}

fn read_u64<R: BufRead>(src: &mut R) -> io::Result<u64> {
    let mut b = [0u8; 8];
    src.read_exact(&mut b)?;
    Ok(u64::from_le_bytes(b))
}

/// Başlığı ve dosya tablosunu okur; okuyucu ilk dosyanın verisinin başında kalır.
pub fn read_header<R: BufRead>(src: &mut R, compressed: bool) -> io::Result<(GmaMeta, Vec<GmaEntry>)> {
    let mut magic = [0u8; 4];
    src.read_exact(&mut magic)?;
    if &magic != b"GMAD" {
        return Err(bad("GMA dosyası değil"));
    }
    let mut ver = [0u8; 1];
    src.read_exact(&mut ver)?;
    let _steamid = read_u64(src)?;
    let timestamp = read_u64(src)?;
    if ver[0] > 1 {
        while !read_cstr(src)?.is_empty() {}
    }
    let title = read_cstr(src)?;
    let raw_desc = read_cstr(src)?;
    let author = read_cstr(src)?;
    let _addon_version = read_u32(src)?;

    let mut meta = GmaMeta {
        title,
        author,
        timestamp,
        compressed,
        ..Default::default()
    };
    match serde_json::from_str::<serde_json::Value>(&raw_desc) {
        Ok(v) if v.is_object() => {
            meta.description = v["description"].as_str().unwrap_or("").to_string();
            meta.addon_type = v["type"].as_str().unwrap_or("").to_string();
            meta.tags = v["tags"]
                .as_array()
                .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                .unwrap_or_default();
        }
        _ => meta.description = raw_desc,
    }

    let mut entries = Vec::new();
    loop {
        if read_u32(src)? == 0 {
            break;
        }
        let name = read_cstr(src)?;
        let size = read_u64(src)?;
        let crc = read_u32(src)?;
        if size > i64::MAX as u64 || entries.len() >= MAX_ENTRIES {
            return Err(bad("bozuk GMA dosya tablosu"));
        }
        entries.push(GmaEntry { name, size, crc });
    }
    Ok((meta, entries))
}

pub fn read(path: &Path) -> io::Result<(GmaMeta, Vec<GmaEntry>)> {
    let mut src = Source::open(path)?;
    let compressed = src.is_compressed();
    read_header(&mut src, compressed)
}

/// GMA içindeki yolu hedef klasörün dışına çıkamayacak şekilde doğrular.
fn safe_rel(name: &str) -> Option<PathBuf> {
    let name = name.replace('\\', "/");
    let mut out = PathBuf::new();
    for part in name.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part == ".." || part.contains(':') || part.contains('\0') {
            return None;
        }
        out.push(part);
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Tüm dosyaları `dest` içine çıkarır. `progress(yazılan, toplam)` bayt cinsindendir.
pub fn extract(path: &Path, dest: &Path, mut progress: impl FnMut(u64, u64)) -> io::Result<u64> {
    let mut src = Source::open(path)?;
    let compressed = src.is_compressed();
    let (_, entries) = read_header(&mut src, compressed)?;
    let total: u64 = entries.iter().map(|e| e.size).sum();
    let mut done = 0u64;
    let mut count = 0u64;
    fs::create_dir_all(dest)?;
    for e in &entries {
        match safe_rel(&e.name) {
            Some(rel) => {
                let out = dest.join(rel);
                if let Some(p) = out.parent() {
                    fs::create_dir_all(p)?;
                }
                let mut w = BufWriter::new(File::create(&out)?);
                let copied = io::copy(&mut src.by_ref().take(e.size), &mut w)?;
                w.flush()?;
                if copied < e.size {
                    return Err(io::ErrorKind::UnexpectedEof.into());
                }
                count += 1;
            }
            None => src.skip(e.size)?,
        }
        done += e.size;
        progress(done, total);
    }
    Ok(count)
}

/// Tek bir dosyanın içeriğini okur (önizleme için), en fazla `max` bayt.
pub fn read_entry(path: &Path, name: &str, max: u64) -> io::Result<Vec<u8>> {
    let mut src = Source::open(path)?;
    let compressed = src.is_compressed();
    let (_, entries) = read_header(&mut src, compressed)?;
    for e in &entries {
        if e.name == name {
            let mut buf = Vec::new();
            src.by_ref().take(e.size.min(max)).read_to_end(&mut buf)?;
            return Ok(buf);
        }
        src.skip(e.size)?;
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "dosya bulunamadı"))
}

/// Okunan bayt sayısını tutan sarmalayıcı.
struct Counting<R> {
    inner: R,
    count: u64,
}

impl<R: Read> Read for Counting<R> {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.count += n as u64;
        Ok(n)
    }
}

impl<R: BufRead> BufRead for Counting<R> {
    fn fill_buf(&mut self) -> io::Result<&[u8]> {
        self.inner.fill_buf()
    }
    fn consume(&mut self, amt: usize) {
        self.count += amt as u64;
        self.inner.consume(amt)
    }
}

/// Sıkıştırılmışsa açarak düz bir `.gma` kopyası yazar.
/// Steam'in eski LZMA akışlarının sonu bozuk olabildiği için uzunluk başlıktan hesaplanır.
pub fn copy_plain(path: &Path, out: &Path) -> io::Result<u64> {
    let src = Source::open(path)?;
    let compressed = src.is_compressed();
    let mut counted = Counting { inner: src, count: 0 };
    let (_, entries) = read_header(&mut counted, compressed)?;
    let body = counted.count + entries.iter().map(|e| e.size).sum::<u64>();

    let mut src = Source::open(path)?;
    if let Some(p) = out.parent() {
        fs::create_dir_all(p)?;
    }
    let mut w = BufWriter::new(File::create(out)?);
    let copied = io::copy(&mut src.by_ref().take(body), &mut w)?;
    if copied < body {
        return Err(io::ErrorKind::UnexpectedEof.into());
    }
    // Sondaki CRC varsa ekle; yoksa ya da akış burada bozuksa yok say.
    let mut crc = [0u8; 4];
    if src.read_exact(&mut crc).is_ok() {
        w.write_all(&crc)?;
    }
    w.flush()?;
    Ok(copied)
}

// ---------------------------------------------------------------------------
// Yazma (yayınlama için)
// ---------------------------------------------------------------------------

/// gmad'in izin verdiği dosya kalıpları.
const WHITELIST: &[&str] = &[
    "lua/*.lua",
    "scenes/*.vcd",
    "particles/*.pcf",
    "resource/fonts/*.ttf",
    "scripts/vehicles/*.txt",
    "resource/localization/*/*.properties",
    "maps/*.bsp",
    "maps/*.lmp",
    "maps/*.nav",
    "maps/*.ain",
    "maps/thumb/*.png",
    "sound/*.wav",
    "sound/*.mp3",
    "sound/*.ogg",
    "materials/*.vmt",
    "materials/*.vtf",
    "materials/*.png",
    "materials/*.jpg",
    "materials/*.jpeg",
    "materials/colorcorrection/*.raw",
    "models/*.mdl",
    "models/*.vtx",
    "models/*.phy",
    "models/*.ani",
    "models/*.vvd",
    "gamemodes/*/*.txt",
    "gamemodes/*/*.fgd",
    "gamemodes/*/logo.png",
    "gamemodes/*/icon24.png",
    "gamemodes/*/gamemode/*.lua",
    "gamemodes/*/entities/effects/*.lua",
    "gamemodes/*/entities/weapons/*.lua",
    "gamemodes/*/entities/entities/*.lua",
    "gamemodes/*/backgrounds/*.png",
    "gamemodes/*/backgrounds/*.jpg",
    "gamemodes/*/backgrounds/*.jpeg",
    "gamemodes/*/content/models/*.mdl",
    "gamemodes/*/content/models/*.vtx",
    "gamemodes/*/content/models/*.phy",
    "gamemodes/*/content/models/*.ani",
    "gamemodes/*/content/models/*.vvd",
    "gamemodes/*/content/materials/*.vmt",
    "gamemodes/*/content/materials/*.vtf",
    "gamemodes/*/content/materials/*.png",
    "gamemodes/*/content/materials/*.jpg",
    "gamemodes/*/content/materials/*.jpeg",
    "gamemodes/*/content/materials/colorcorrection/*.raw",
    "gamemodes/*/content/scenes/*.vcd",
    "gamemodes/*/content/particles/*.pcf",
    "gamemodes/*/content/resource/fonts/*.ttf",
    "gamemodes/*/content/scripts/vehicles/*.txt",
    "gamemodes/*/content/resource/localization/*/*.properties",
    "gamemodes/*/content/maps/*.bsp",
    "gamemodes/*/content/maps/*.nav",
    "gamemodes/*/content/maps/*.ain",
    "gamemodes/*/content/maps/thumb/*.png",
    "gamemodes/*/content/sound/*.wav",
    "gamemodes/*/content/sound/*.mp3",
    "gamemodes/*/content/sound/*.ogg",
    "data_static/*.txt",
    "data_static/*.dat",
    "data_static/*.json",
    "data_static/*.xml",
    "data_static/*.csv",
    "data_static/*.dem",
    "data_static/*.vcd",
    "data_static/*.vtf",
    "data_static/*.vmt",
    "data_static/*.png",
    "data_static/*.jpg",
    "data_static/*.jpeg",
    "data_static/*.mp3",
    "data_static/*.wav",
    "data_static/*.ogg",
];

pub fn glob(pat: &[u8], s: &[u8]) -> bool {
    match pat.first() {
        None => s.is_empty(),
        Some(b'*') => (0..=s.len()).any(|i| glob(&pat[1..], &s[i..])),
        Some(c) => s.first() == Some(c) && glob(&pat[1..], &s[1..]),
    }
}

pub fn whitelisted(rel: &str) -> bool {
    WHITELIST.iter().any(|p| glob(p.as_bytes(), rel.as_bytes()))
}

pub struct PackPlan {
    /// (GMA içindeki yol, diskteki yol, boyut)
    pub files: Vec<(String, PathBuf, u64)>,
    pub skipped: Vec<String>,
}

/// Klasörü tarar; beyaz listeye uymayan ve `ignore` kalıplarına takılan dosyaları ayırır.
pub fn plan(folder: &Path, ignore: &[String]) -> io::Result<PackPlan> {
    let mut files = Vec::new();
    let mut skipped = Vec::new();
    for e in walkdir::WalkDir::new(folder).follow_links(false) {
        let e = e.map_err(io::Error::other)?;
        if !e.file_type().is_file() {
            continue;
        }
        let rel = e
            .path()
            .strip_prefix(folder)
            .map_err(io::Error::other)?
            .to_string_lossy()
            .replace('\\', "/")
            .to_lowercase();
        if rel == "addon.json" {
            continue;
        }
        let ignored = ignore.iter().any(|p| glob(p.to_lowercase().as_bytes(), rel.as_bytes()));
        if ignored || !whitelisted(&rel) {
            skipped.push(rel);
            continue;
        }
        let size = e.metadata().map_err(io::Error::other)?.len();
        files.push((rel, e.path().to_path_buf(), size));
    }
    files.sort_by(|a, b| a.0.cmp(&b.0));
    skipped.sort();
    Ok(PackPlan { files, skipped })
}

struct CrcWriter<W: Write> {
    inner: W,
    hasher: crc32fast::Hasher,
}

impl<W: Write> Write for CrcWriter<W> {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let n = self.inner.write(buf)?;
        self.hasher.update(&buf[..n]);
        Ok(n)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}

fn file_crc(path: &Path) -> io::Result<u32> {
    let mut f = BufReader::with_capacity(1 << 16, File::open(path)?);
    let mut h = crc32fast::Hasher::new();
    loop {
        let buf = f.fill_buf()?;
        if buf.is_empty() {
            break;
        }
        h.update(buf);
        let n = buf.len();
        f.consume(n);
    }
    Ok(h.finalize())
}

pub fn write(
    out: &Path,
    title: &str,
    description: &str,
    addon_type: &str,
    tags: &[String],
    plan: &PackPlan,
    mut progress: impl FnMut(u64, u64),
) -> io::Result<()> {
    let total: u64 = plan.files.iter().map(|f| f.2).sum::<u64>() * 2;
    let mut done = 0u64;

    let mut crcs = Vec::with_capacity(plan.files.len());
    for (_, abs, size) in &plan.files {
        crcs.push(file_crc(abs)?);
        done += size;
        progress(done, total);
    }

    if let Some(p) = out.parent() {
        fs::create_dir_all(p)?;
    }
    let mut w = CrcWriter {
        inner: BufWriter::with_capacity(1 << 16, File::create(out)?),
        hasher: crc32fast::Hasher::new(),
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let desc = serde_json::json!({ "description": description, "type": addon_type, "tags": tags });

    w.write_all(b"GMAD")?;
    w.write_all(&[3u8])?;
    w.write_all(&0u64.to_le_bytes())?;
    w.write_all(&now.to_le_bytes())?;
    w.write_all(&[0u8])?; // gerekli içerik listesi (boş)
    w.write_all(title.as_bytes())?;
    w.write_all(&[0u8])?;
    w.write_all(desc.to_string().as_bytes())?;
    w.write_all(&[0u8])?;
    w.write_all(b"Author Name\0")?;
    w.write_all(&1i32.to_le_bytes())?;

    for (i, (rel, _, size)) in plan.files.iter().enumerate() {
        w.write_all(&(i as u32 + 1).to_le_bytes())?;
        w.write_all(rel.as_bytes())?;
        w.write_all(&[0u8])?;
        w.write_all(&(*size as i64).to_le_bytes())?;
        w.write_all(&crcs[i].to_le_bytes())?;
    }
    w.write_all(&0u32.to_le_bytes())?;

    for (rel, abs, size) in &plan.files {
        let copied = io::copy(&mut File::open(abs)?, &mut w)?;
        if copied != *size {
            return Err(bad(&format!("dosya paketlenirken değişti: {rel}")));
        }
        done += size;
        progress(done, total);
    }
    let crc = w.hasher.clone().finalize();
    w.inner.write_all(&crc.to_le_bytes())?;
    w.inner.flush()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_then_read_roundtrip() {
        let base = std::env::temp_dir().join(format!("gmodcleaner-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&base);
        let src = base.join("src");
        fs::create_dir_all(src.join("lua/autorun")).unwrap();
        fs::create_dir_all(src.join("materials/x")).unwrap();
        fs::write(src.join("lua/autorun/Hello.lua"), b"print('hi')").unwrap();
        fs::write(src.join("materials/x/a.vmt"), b"\"UnlitGeneric\" {}").unwrap();
        fs::write(src.join("materials/x/notes.psd"), b"skip me").unwrap();
        fs::write(src.join("addon.json"), b"{}").unwrap();
        fs::write(src.join("readme.md"), b"skip").unwrap();

        let plan = plan(&src, &["materials/x/a.vm?".to_string()]).unwrap();
        assert_eq!(plan.files.len(), 2);
        assert_eq!(plan.skipped, vec!["materials/x/notes.psd", "readme.md"]);

        let out = base.join("out.gma");
        write(&out, "Title", "Desc", "tool", &["fun".to_string()], &plan, |_, _| {}).unwrap();
        let (meta, entries) = read(&out).unwrap();
        assert_eq!(meta.title, "Title");
        assert_eq!(meta.description, "Desc");
        assert_eq!(meta.addon_type, "tool");
        assert_eq!(meta.tags, vec!["fun"]);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].name, "lua/autorun/hello.lua");
        assert_eq!(entries[0].crc, crc32fast::hash(b"print('hi')"));

        let dest = base.join("extracted");
        assert_eq!(extract(&out, &dest, |_, _| {}).unwrap(), 2);
        assert_eq!(fs::read(dest.join("lua/autorun/hello.lua")).unwrap(), b"print('hi')");
        assert_eq!(read_entry(&out, "materials/x/a.vmt", 1 << 20).unwrap(), b"\"UnlitGeneric\" {}");

        let copy = base.join("copy.gma");
        copy_plain(&out, &copy).unwrap();
        assert_eq!(fs::read(&copy).unwrap(), fs::read(&out).unwrap());
        fs::remove_dir_all(&base).unwrap();
    }

    #[test]
    fn rejects_paths_escaping_destination() {
        assert!(safe_rel("../evil.lua").is_none());
        assert!(safe_rel("lua/../../evil.lua").is_none());
        assert!(safe_rel("C:/evil.lua").is_none());
        assert_eq!(safe_rel(r"lua\a.lua").unwrap(), PathBuf::from("lua").join("a.lua"));
    }
}
