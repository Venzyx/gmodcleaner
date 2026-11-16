fn main() {
    // steam_api64.dll gecikmeli yüklenir: uygulama DLL yanında olmadan açılabilir ve
    // gömülü kopyayı ilk Steam çağrısından önce kendisi çıkarıp yükler (bkz. steam.rs).
    println!("cargo:rustc-link-arg-bins=/DELAYLOAD:steam_api64.dll");
    println!("cargo:rustc-link-arg-bins=delayimp.lib");
    println!("cargo:rustc-link-arg-examples=/DELAYLOAD:steam_api64.dll");
    println!("cargo:rustc-link-arg-examples=delayimp.lib");
    tauri_build::build()
}
