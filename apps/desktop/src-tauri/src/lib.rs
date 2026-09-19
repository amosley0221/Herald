//! Herald desktop shell.
//!
//! The Rust side is deliberately thin: all product logic lives in the shared
//! TypeScript core, and this exists to host the webview, wire up the updater,
//! open external links in the real browser, and lend the webview three things
//! it cannot do for itself -- unrestricted HTTP, a SQLite file, and somewhere
//! to keep a key.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        // Job boards send no CORS headers, so the webview's own fetch cannot
        // read one. This routes those requests through the native stack.
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build());

    // The updater has no meaning on mobile, where the platform owns installs.
    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Herald");
}
