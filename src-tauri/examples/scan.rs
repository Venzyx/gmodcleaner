//! Arayüz olmadan taramayı doğrulamak için: `cargo run --example scan`
use gmodcleaner_lib::{paths, scan};

fn main() {
    let p = paths::resolve(&paths::Config::default()).expect("gmod bulunamadı");
    println!("gmod: {}", p.gmod.display());
    let t = std::time::Instant::now();
    let items = scan::scan(&p);
    println!("{} öğe, {:?}", items.len(), t.elapsed());
    for sec in ["workshop", "addons", "server", "cache", "other"] {
        let list: Vec<_> = items.iter().filter(|i| i.section == sec).collect();
        let size: u64 = list.iter().map(|i| i.size).sum();
        let titled = list.iter().filter(|i| i.title.is_some()).count();
        let legacy = list.iter().filter(|i| i.legacy).count();
        println!("{sec:9} {:4} öğe {:8.1} MB  başlıklı={titled} legacy={legacy}", list.len(), size as f64 / 1048576.0);
        for i in list.iter().take(3) {
            println!("    {:>9.1} MB  {:?} [{}] files={} type={:?}", i.size as f64 / 1048576.0, i.title.as_deref().unwrap_or(&i.name), i.kind, i.files, i.addon_type);
        }
    }
    let unread: Vec<_> = items.iter().filter(|i| i.gma_path.is_some() && i.title.is_none()).map(|i| &i.path).take(5).collect();
    println!("başlığı okunamayan gma: {unread:?}");
}
