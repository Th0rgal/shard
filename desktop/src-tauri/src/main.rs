#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        if std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").is_err() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }

        if std::env::var("APPIMAGE").is_ok() {
            for path in [
                "/usr/lib64/libwayland-client.so.0",
                "/usr/lib64/libwayland-client.so",
                "/usr/lib/libwayland-client.so.0",
                "/usr/lib/libwayland-client.so",
                "/usr/lib/x86_64-linux-gnu/libwayland-client.so.0",
                "/usr/lib/x86_64-linux-gnu/libwayland-client.so",
            ] {
                if std::path::Path::new(path).exists() {
                    let preload = match std::env::var("LD_PRELOAD") {
                        Ok(existing) if !existing.is_empty() => {
                            if existing.split(':').any(|entry| entry == path) {
                                existing
                            } else {
                                format!("{existing}:{path}")
                            }
                        }
                        _ => path.to_string(),
                    };
                    std::env::set_var("LD_PRELOAD", preload);
                    break;
                }
            }
        }
    }

    shard_ui::run();
}
