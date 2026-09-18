//! Herald desktop shell.
//!
//! The Rust side is deliberately thin: all product logic lives in the shared
//! TypeScript core and the engine, and this exists to host the webview, wire up
//! the updater, and open external links in the real browser rather than inside
//! the app.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init());

    // The updater has no meaning on mobile, where the platform owns installs.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Herald");
}
