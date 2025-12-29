use crate::paths::Paths;
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

/// A profile template that can be used to generate new profiles
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    /// Unique identifier for this template
    pub id: String,
    /// Human-readable name
    pub name: String,
    /// Description of what this template provides
    #[serde(default)]
    pub description: String,
    /// Minecraft version (e.g., "1.20.4" or "latest")
    #[serde(rename = "mcVersion")]
    pub mc_version: String,
    /// Mod loader configuration
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub loader: Option<TemplateLoader>,
    /// Mods to include
    #[serde(default)]
    pub mods: Vec<TemplateContent>,
    /// Resource packs to include
    #[serde(default)]
    pub resourcepacks: Vec<TemplateContent>,
    /// Shader packs to include
    #[serde(default)]
    pub shaderpacks: Vec<TemplateContent>,
    /// Runtime configuration
    #[serde(default)]
    pub runtime: TemplateRuntime,
}

/// Loader configuration for a template
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateLoader {
    /// Loader type (e.g., "fabric", "forge", "quilt", "neoforge")
    #[serde(rename = "type")]
    pub loader_type: String,
    /// Version (e.g., "0.15.3" or "latest")
    pub version: String,
}

/// Content reference in a template (mod, resourcepack, or shaderpack)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TemplateContent {
    /// Human-readable name
    pub name: String,
    /// Source type and identifier
    pub source: ContentSource,
    /// Optional specific version (defaults to latest compatible)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Whether this content is required or optional
    #[serde(default = "default_true")]
    pub required: bool,
}

fn default_true() -> bool {
    true
}

/// Source for template content
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum ContentSource {
    /// Modrinth project
    Modrinth {
        /// Project slug or ID
        project: String,
    },
    /// CurseForge project
    CurseForge {
        /// Project ID
        project_id: u32,
    },
    /// Direct URL download
    Url {
        /// URL to download from
        url: String,
    },
}

/// Runtime configuration for a template
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TemplateRuntime {
    /// Java executable path (optional, uses system default)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub java: Option<String>,
    /// Memory allocation (e.g., "4G")
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<String>,
    /// Additional JVM arguments
    #[serde(default)]
    pub args: Vec<String>,
}

impl Paths {
    /// Get the templates directory path
    pub fn templates_dir(&self) -> PathBuf {
        self.profiles.parent().unwrap().join("templates")
    }

    /// Get path to a specific template
    pub fn template_json(&self, id: &str) -> PathBuf {
        self.templates_dir().join(format!("{}.json", id))
    }

    /// Check if a template exists
    pub fn is_template_present(&self, id: &str) -> bool {
        self.template_json(id).exists()
    }
}

/// Load a template by ID
pub fn load_template(paths: &Paths, id: &str) -> Result<Template> {
    let path = paths.template_json(id);
    let data = fs::read_to_string(&path)
        .with_context(|| format!("failed to read template file: {}", path.display()))?;
    let template: Template = serde_json::from_str(&data)
        .with_context(|| format!("failed to parse template JSON: {}", path.display()))?;
    Ok(template)
}

/// Save a template
pub fn save_template(paths: &Paths, template: &Template) -> Result<()> {
    let dir = paths.templates_dir();
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create templates directory: {}", dir.display()))?;
    let path = paths.template_json(&template.id);
    let data = serde_json::to_string_pretty(template).context("failed to serialize template")?;
    fs::write(&path, data)
        .with_context(|| format!("failed to write template file: {}", path.display()))?;
    Ok(())
}

/// List all available templates
pub fn list_templates(paths: &Paths) -> Result<Vec<String>> {
    let mut ids = Vec::new();
    let dir = paths.templates_dir();
    if !dir.exists() {
        return Ok(ids);
    }
    for entry in fs::read_dir(&dir)
        .with_context(|| format!("failed to read templates dir: {}", dir.display()))?
    {
        let entry = entry.context("failed to read templates dir entry")?;
        let path = entry.path();
        if path.extension().map(|e| e == "json").unwrap_or(false)
            && let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                ids.push(stem.to_string());
            }
    }
    ids.sort();
    Ok(ids)
}

/// Delete a template by ID
pub fn delete_template(paths: &Paths, id: &str) -> Result<bool> {
    let path = paths.template_json(id);
    if path.exists() {
        fs::remove_file(&path)
            .with_context(|| format!("failed to delete template: {}", path.display()))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Create a built-in default template for optimized Fabric gameplay
pub fn create_default_template() -> Template {
    Template {
        id: "optimized-fabric".to_string(),
        name: "Optimized Fabric".to_string(),
        description: "A clean Fabric setup with Sodium, Iris, and Distant Horizons for optimal performance and visuals.".to_string(),
        mc_version: "1.21.4".to_string(),
        loader: Some(TemplateLoader {
            loader_type: "fabric".to_string(),
            version: "latest".to_string(),
        }),
        mods: vec![
            TemplateContent {
                name: "Sodium".to_string(),
                source: ContentSource::Modrinth {
                    project: "sodium".to_string(),
                },
                version: None,
                required: true,
            },
            TemplateContent {
                name: "Iris Shaders".to_string(),
                source: ContentSource::Modrinth {
                    project: "iris".to_string(),
                },
                version: None,
                required: true,
            },
            TemplateContent {
                name: "Distant Horizons".to_string(),
                source: ContentSource::Modrinth {
                    project: "distanthorizons".to_string(),
                },
                version: None,
                required: true,
            },
            TemplateContent {
                name: "Fabric API".to_string(),
                source: ContentSource::Modrinth {
                    project: "fabric-api".to_string(),
                },
                version: None,
                required: true,
            },
            TemplateContent {
                name: "Mod Menu".to_string(),
                source: ContentSource::Modrinth {
                    project: "modmenu".to_string(),
                },
                version: None,
                required: false,
            },
            TemplateContent {
                name: "Lithium".to_string(),
                source: ContentSource::Modrinth {
                    project: "lithium".to_string(),
                },
                version: None,
                required: false,
            },
        ],
        resourcepacks: vec![],
        shaderpacks: vec![
            TemplateContent {
                name: "Complementary Reimagined".to_string(),
                source: ContentSource::Modrinth {
                    project: "complementary-reimagined".to_string(),
                },
                version: None,
                required: false,
            },
        ],
        runtime: TemplateRuntime {
            java: None,
            memory: Some("4G".to_string()),
            args: vec![],
        },
    }
}

/// Initialize built-in templates if they don't exist
pub fn init_builtin_templates(paths: &Paths) -> Result<()> {
    let dir = paths.templates_dir();
    fs::create_dir_all(&dir)
        .with_context(|| format!("failed to create templates directory: {}", dir.display()))?;

    // Create default optimized Fabric template if not present
    if !paths.is_template_present("optimized-fabric") {
        let template = create_default_template();
        save_template(paths, &template)?;
    }

    Ok(())
}
