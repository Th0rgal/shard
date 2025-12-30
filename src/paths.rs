use anyhow::{Context, Result};
use std::env;
use std::path::PathBuf;

#[derive(Debug, Clone)]
pub struct Paths {
    pub store_mods: PathBuf,
    pub store_resourcepacks: PathBuf,
    pub store_shaderpacks: PathBuf,
    pub store_skins: PathBuf,
    pub profiles: PathBuf,
    pub instances: PathBuf,
    pub cache_downloads: PathBuf,
    pub cache_manifests: PathBuf,
    pub logs: PathBuf,
    pub minecraft_versions: PathBuf,
    pub minecraft_libraries: PathBuf,
    pub minecraft_assets_objects: PathBuf,
    pub minecraft_assets_indexes: PathBuf,
    pub accounts: PathBuf,
    pub config: PathBuf,
    pub library_db: PathBuf,
}

impl Paths {
    pub fn new() -> Result<Self> {
        let mut base = if let Ok(value) = env::var("SHARD_HOME") {
            PathBuf::from(value)
        } else {
            let home = dirs::home_dir().context("could not determine home directory")?;
            home.join(".shard")
        };
        if !base.is_absolute() {
            let cwd = std::env::current_dir().context("failed to read current directory")?;
            base = cwd.join(base);
        }

        let store_mods = base.join("store").join("mods").join("sha256");
        let store_resourcepacks = base.join("store").join("resourcepacks").join("sha256");
        let store_shaderpacks = base.join("store").join("shaderpacks").join("sha256");
        let store_skins = base.join("store").join("skins").join("sha256");
        let profiles = base.join("profiles");
        let instances = base.join("instances");
        let cache_downloads = base.join("caches").join("downloads");
        let cache_manifests = base.join("caches").join("manifests");
        let logs = base.join("logs");

        let minecraft_root = base.join("minecraft");
        let minecraft_versions = minecraft_root.join("versions");
        let minecraft_libraries = minecraft_root.join("libraries");
        let minecraft_assets_objects = minecraft_root.join("assets").join("objects");
        let minecraft_assets_indexes = minecraft_root.join("assets").join("indexes");

        let accounts = base.join("accounts.json");
        let config = base.join("config.json");
        let library_db = base.join("library.db");

        Ok(Self {
            store_mods,
            store_resourcepacks,
            store_shaderpacks,
            store_skins,
            profiles,
            instances,
            cache_downloads,
            cache_manifests,
            logs,
            minecraft_versions,
            minecraft_libraries,
            minecraft_assets_objects,
            minecraft_assets_indexes,
            accounts,
            config,
            library_db,
        })
    }

    pub fn ensure(&self) -> Result<()> {
        std::fs::create_dir_all(&self.store_mods)
            .context("failed to create store/mods directory")?;
        std::fs::create_dir_all(&self.store_resourcepacks)
            .context("failed to create store/resourcepacks directory")?;
        std::fs::create_dir_all(&self.store_shaderpacks)
            .context("failed to create store/shaderpacks directory")?;
        std::fs::create_dir_all(&self.store_skins)
            .context("failed to create store/skins directory")?;
        std::fs::create_dir_all(&self.profiles).context("failed to create profiles directory")?;
        std::fs::create_dir_all(&self.instances).context("failed to create instances directory")?;
        std::fs::create_dir_all(&self.cache_downloads)
            .context("failed to create cache downloads directory")?;
        std::fs::create_dir_all(&self.cache_manifests)
            .context("failed to create cache manifests directory")?;
        std::fs::create_dir_all(&self.logs).context("failed to create logs directory")?;
        std::fs::create_dir_all(&self.minecraft_versions)
            .context("failed to create minecraft versions directory")?;
        std::fs::create_dir_all(&self.minecraft_libraries)
            .context("failed to create minecraft libraries directory")?;
        std::fs::create_dir_all(&self.minecraft_assets_objects)
            .context("failed to create minecraft assets objects directory")?;
        std::fs::create_dir_all(&self.minecraft_assets_indexes)
            .context("failed to create minecraft assets indexes directory")?;
        Ok(())
    }

    pub fn profile_dir(&self, id: &str) -> PathBuf {
        self.profiles.join(id)
    }

    pub fn profile_json(&self, id: &str) -> PathBuf {
        self.profile_dir(id).join("profile.json")
    }

    pub fn profile_overrides(&self, id: &str) -> PathBuf {
        self.profile_dir(id).join("overrides")
    }

    pub fn instance_dir(&self, id: &str) -> PathBuf {
        self.instances.join(id)
    }

    pub fn store_mod_path(&self, hash_hex: &str) -> PathBuf {
        self.store_mods.join(hash_hex)
    }

    pub fn store_resourcepack_path(&self, hash_hex: &str) -> PathBuf {
        self.store_resourcepacks.join(hash_hex)
    }

    pub fn store_shaderpack_path(&self, hash_hex: &str) -> PathBuf {
        self.store_shaderpacks.join(hash_hex)
    }

    pub fn store_skin_path(&self, hash_hex: &str) -> PathBuf {
        self.store_skins.join(hash_hex)
    }

    pub fn is_profile_present(&self, id: &str) -> bool {
        self.profile_json(id).exists()
    }

    pub fn minecraft_version_dir(&self, id: &str) -> PathBuf {
        self.minecraft_versions.join(id)
    }

    pub fn minecraft_version_json(&self, id: &str) -> PathBuf {
        self.minecraft_version_dir(id).join(format!("{id}.json"))
    }

    pub fn minecraft_version_jar(&self, id: &str) -> PathBuf {
        self.minecraft_version_dir(id).join(format!("{id}.jar"))
    }

    pub fn minecraft_library_path(&self, maven_path: &str) -> PathBuf {
        self.minecraft_libraries.join(maven_path)
    }

    pub fn minecraft_asset_index(&self, id: &str) -> PathBuf {
        self.minecraft_assets_indexes.join(format!("{id}.json"))
    }

    pub fn minecraft_asset_object(&self, hash: &str) -> PathBuf {
        let prefix = hash.get(0..2).unwrap_or(hash);
        self.minecraft_assets_objects.join(prefix).join(hash)
    }

    pub fn cache_manifest(&self, name: &str) -> PathBuf {
        self.cache_manifests.join(name)
    }
}
