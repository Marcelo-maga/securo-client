fn main() {
    let dist_dir = std::path::Path::new("../dist");
    if !dist_dir.exists() {
        let _ = std::fs::create_dir_all(dist_dir);
    }
    tauri_build::build()
}
