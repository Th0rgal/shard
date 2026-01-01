fn main() {
    // Re-run build script if these env vars change
    println!("cargo:rerun-if-env-changed=SHARD_MS_CLIENT_ID");
    println!("cargo:rerun-if-env-changed=SHARD_CURSEFORGE_API_KEY");
}
