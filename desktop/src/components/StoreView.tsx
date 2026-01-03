import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { StoreProject, StoreVersion } from "../types";
import { formatDownloads, formatFileSize } from "../utils";

type StoreCategory = "mods" | "resourcepacks" | "shaderpacks";

// Map UI category to backend content_type
const CATEGORY_TO_CONTENT_TYPE: Record<StoreCategory, string> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaderpacks: "shaderpack",
};

interface StoreSearchInput {
  query: string;
  content_type: string;
  game_version?: string | null;
  loader?: string | null;
  limit?: number;
  platform?: string | null;
}

type StorePlatform = "all" | "modrinth" | "curseforge";

// Get URL to the project page on the source platform
function getProjectUrl(project: StoreProject, category: StoreCategory): string {
  const typeMap: Record<StoreCategory, { modrinth: string; curseforge: string }> = {
    mods: { modrinth: "mod", curseforge: "mc-mods" },
    resourcepacks: { modrinth: "resourcepack", curseforge: "texture-packs" },
    shaderpacks: { modrinth: "shader", curseforge: "shaders" },
  };

  const paths = typeMap[category];
  if (project.platform === "modrinth") {
    return `https://modrinth.com/${paths.modrinth}/${project.id}`;
  }
  return `https://www.curseforge.com/minecraft/${paths.curseforge}/${project.id}`;
}

// Module-level cache for popular results (persists across re-renders)
const popularCache: Record<StoreCategory, StoreProject[]> = {
  mods: [],
  resourcepacks: [],
  shaderpacks: [],
};
const cacheLoading: Record<StoreCategory, boolean> = {
  mods: false,
  resourcepacks: false,
  shaderpacks: false,
};

export function StoreView() {
  const { profile, selectedProfileId, loadProfile, notify } = useAppStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StoreCategory>("mods");
  const [platform, setPlatform] = useState<StorePlatform>("all");
  const [searchResults, setSearchResults] = useState<StoreProject[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<StoreProject | null>(null);
  const [versions, setVersions] = useState<StoreVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);
  const [quickInstalling, setQuickInstalling] = useState<string | null>(null);
  const [, forceUpdate] = useState(0);

  // Load popular content for current category
  useEffect(() => {
    const loadPopular = async () => {
      if (popularCache[category].length > 0 || cacheLoading[category]) return;

      cacheLoading[category] = true;
      try {
        const input: StoreSearchInput = {
          query: "",
          content_type: CATEGORY_TO_CONTENT_TYPE[category],
          game_version: null,
          loader: null,
          limit: 5,
        };
        const data = await invoke<StoreProject[]>("store_search_cmd", { input });
        popularCache[category] = data;
        forceUpdate(n => n + 1);
      } catch {
        // Silently fail for popular results
      } finally {
        cacheLoading[category] = false;
      }
    };

    loadPopular();
  }, [category]);

  // Results to display: search results if searching, otherwise cached popular
  const displayResults = searchResults ?? popularCache[category];
  const isShowingPopular = searchResults === null && displayResults.length > 0;

  // Check if a project is already installed in the current profile
  const isProjectInstalled = useCallback((project: StoreProject): boolean => {
    if (!profile) return false;
    const contentArray = category === "mods" ? profile.mods
      : category === "resourcepacks" ? profile.resourcepacks
      : profile.shaderpacks;

    // Normalize name for comparison (lowercase, remove special chars)
    const normalizeForComparison = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const projectNameNorm = normalizeForComparison(project.name);
    const projectSlugNorm = normalizeForComparison(project.slug);

    return contentArray.some((item) => {
      // Try exact platform + project_id match (project_id could be id or slug)
      // Use case-insensitive comparison for platform since storage may have inconsistent casing
      if (item.platform?.toLowerCase() === project.platform.toLowerCase()) {
        if (item.project_id === project.id || item.project_id === project.slug) {
          return true;
        }
      }
      // Fall back to name-based matching for items without platform metadata
      const itemNameNorm = normalizeForComparison(item.name);
      return itemNameNorm === projectNameNorm || itemNameNorm === projectSlugNorm;
    });
  }, [profile, category]);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) {
      setSearchResults(null);
      return;
    }

    setLoading(true);
    setSearchResults([]);
    setSelectedProject(null);
    setVersions([]);

    try {
      const input: StoreSearchInput = {
        query: query.trim(),
        content_type: CATEGORY_TO_CONTENT_TYPE[category],
        game_version: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        limit: 20,
        platform: platform === "all" ? null : platform,
      };
      const data = await invoke<StoreProject[]>("store_search_cmd", { input });
      setSearchResults(data);
    } catch (err) {
      notify("Search failed", String(err));
    } finally {
      setLoading(false);
    }
  }, [query, category, platform, profile, notify]);

  const handleCategoryChange = useCallback((newCategory: StoreCategory) => {
    setCategory(newCategory);
    setSearchResults(null);
    setQuery("");
    setSelectedProject(null);
    setVersions([]);
  }, []);

  const handleSelectProject = useCallback(async (project: StoreProject) => {
    setSelectedProject(project);
    setLoadingVersions(true);
    setVersions([]);

    try {
      const data = await invoke<StoreVersion[]>("store_get_versions_cmd", {
        projectId: project.id,
        platform: project.platform,
        gameVersion: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        profileId: selectedProfileId ?? null,
      });
      setVersions(data);
    } catch (err) {
      notify("Failed to load versions", String(err));
    } finally {
      setLoadingVersions(false);
    }
  }, [profile, selectedProfileId, notify]);

  const handleInstall = useCallback(async (version: StoreVersion) => {
    if (!selectedProfileId || !selectedProject) return;

    setInstalling(version.id);
    try {
      const input = {
        profile_id: selectedProfileId,
        platform: selectedProject.platform,
        project_id: selectedProject.id,
        version_id: version.id,
        content_type: CATEGORY_TO_CONTENT_TYPE[category],
      };
      await invoke("store_install_cmd", { input });
      await loadProfile(selectedProfileId);
      notify("Installed", `${selectedProject.name} v${version.version}`);
    } catch (err) {
      notify("Install failed", String(err));
    } finally {
      setInstalling(null);
    }
  }, [selectedProfileId, selectedProject, category, loadProfile, notify]);

  // Quick install - fetch latest version and install directly
  const handleQuickInstall = useCallback(async (project: StoreProject, e: React.MouseEvent) => {
    e.stopPropagation(); // Don't select the project
    if (!selectedProfileId) return;

    const projectKey = `${project.platform}-${project.id}`;
    setQuickInstalling(projectKey);
    try {
      // Fetch versions for this project
      const versions = await invoke<StoreVersion[]>("store_get_versions_cmd", {
        projectId: project.id,
        platform: project.platform,
        gameVersion: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        profileId: selectedProfileId,
      });

      if (versions.length === 0) {
        notify("No compatible version", `No compatible version found for ${project.name}`);
        return;
      }

      // Install the first (latest) version
      const latestVersion = versions[0];
      const input = {
        profile_id: selectedProfileId,
        platform: project.platform,
        project_id: project.id,
        version_id: latestVersion.id,
        content_type: CATEGORY_TO_CONTENT_TYPE[category],
      };
      await invoke("store_install_cmd", { input });
      await loadProfile(selectedProfileId);
      notify("Installed", `${project.name} v${latestVersion.version}`);
    } catch (err) {
      notify("Install failed", String(err));
    } finally {
      setQuickInstalling(null);
    }
  }, [selectedProfileId, profile, category, loadProfile, notify]);

  return (
    <div className="view-transition">
      {/* Category tabs */}
      <div className="content-tabs" style={{ marginBottom: 16 }}>
        <button
          className={clsx("content-tab", category === "mods" && "active")}
          onClick={() => handleCategoryChange("mods")}
        >
          Mods
        </button>
        <button
          className={clsx("content-tab", category === "resourcepacks" && "active")}
          onClick={() => handleCategoryChange("resourcepacks")}
        >
          Resource Packs
        </button>
        <button
          className={clsx("content-tab", category === "shaderpacks" && "active")}
          onClick={() => handleCategoryChange("shaderpacks")}
        >
          Shaders
        </button>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 16 }}>
        <input
          type="text"
          className="input"
          placeholder={`Search ${category}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <select
          className="select"
          value={platform}
          onChange={(e) => setPlatform(e.target.value as StorePlatform)}
          style={{ width: 130 }}
        >
          <option value="all">All platforms</option>
          <option value="modrinth">Modrinth</option>
          <option value="curseforge">CurseForge</option>
        </select>
        <button
          className="btn btn-primary"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Version context */}
      {profile && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          {isShowingPopular ? "Popular" : "Results"} compatible with Minecraft {profile.mcVersion}
          {profile.loader && ` + ${profile.loader.type}`}
        </p>
      )}

      {!selectedProfileId && (
        <div
          style={{
            background: "rgba(244, 178, 127, 0.1)",
            border: "1px solid rgba(244, 178, 127, 0.2)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <p style={{ color: "var(--accent-secondary)", margin: 0, fontSize: 14 }}>
            Select a profile first to install content with the correct version compatibility.
          </p>
        </div>
      )}

      <div style={{ display: "flex", gap: 24 }}>
        {/* Results list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {displayResults.length === 0 && !loading && searchResults !== null && (
            <div className="empty-state" style={{ padding: 40 }}>
              <h3>No results</h3>
              <p>Try a different search term or category.</p>
            </div>
          )}

          {displayResults.length === 0 && !loading && searchResults === null && cacheLoading[category] && (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading popular {category}...</p>
          )}

          {displayResults.map((project) => (
            <div
              key={`${project.platform}-${project.id}`}
              className={clsx("content-item-v2", selectedProject?.id === project.id && "content-item-selected")}
              onClick={() => handleSelectProject(project)}
              style={{
                cursor: "pointer",
                background: selectedProject?.id === project.id ? "rgba(232, 168, 85, 0.08)" : undefined,
                borderColor: selectedProject?.id === project.id ? "rgba(232, 168, 85, 0.2)" : undefined,
                alignItems: "flex-start",
              }}
            >
              {/* Project icon */}
              <div className="content-item-icon" style={{ width: 48, height: 48, alignSelf: "flex-start" }}>
                {project.icon_url ? (
                  <img
                    src={project.icon_url}
                    alt=""
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      objectFit: "cover",
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      background: "rgba(255, 255, 255, 0.05)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: 20,
                    }}
                  >
                    {category === "mods" ? "M" : category === "resourcepacks" ? "R" : "S"}
                  </div>
                )}
              </div>

              {/* Content info */}
              <div className="content-item-main">
                <div className="content-item-header">
                  <h5 className="content-item-name">{project.name}</h5>
                </div>
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {project.description}
                </p>
                <div className="content-item-meta" style={{ marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{formatDownloads(project.downloads)} downloads</span>
                  <button
                    className="content-meta-platform content-meta-platform-link"
                    style={{
                      color: project.platform === "modrinth" ? "#1ed760" : "#f66036",
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      openUrl(getProjectUrl(project, category));
                    }}
                    title={`Open on ${project.platform === "modrinth" ? "Modrinth" : "CurseForge"}`}
                  >
                    {project.platform === "modrinth" ? "Modrinth" : "CurseForge"}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                      <polyline points="15 3 21 3 21 9" />
                      <line x1="10" y1="14" x2="21" y2="3" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Quick install button - vertically centered */}
              {selectedProfileId && (
                <div className="content-item-actions" style={{ opacity: 1, alignSelf: "center" }}>
                  {isProjectInstalled(project) ? (
                    <div
                      className="btn-icon"
                      style={{
                        color: "var(--success)",
                        cursor: "default",
                        background: "rgba(30, 215, 96, 0.1)",
                      }}
                      title="Already installed"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                  ) : (
                    <button
                      className="btn-icon btn-install"
                      onClick={(e) => handleQuickInstall(project, e)}
                      disabled={quickInstalling === `${project.platform}-${project.id}`}
                      title="Install latest compatible version"
                    >
                      {quickInstalling === `${project.platform}-${project.id}` ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                          <circle cx="12" cy="12" r="10" opacity="0.3" />
                          <path d="M12 6v6l4 2" />
                        </svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      )}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Version panel */}
        {selectedProject && (
          <div
            style={{
              width: 300,
              flexShrink: 0,
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 20,
              alignSelf: "flex-start",
              maxHeight: 500,
              overflow: "auto",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <h4 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>
                {selectedProject.name}
              </h4>
              <button
                className="btn-icon"
                onClick={() => openUrl(getProjectUrl(selectedProject, category))}
                title={`Open on ${selectedProject.platform === "modrinth" ? "Modrinth" : "CurseForge"}`}
                style={{ color: selectedProject.platform === "modrinth" ? "#1ed760" : "#f66036" }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
            </div>
            <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-secondary)" }}>
              {selectedProject.description}
            </p>

            {loadingVersions && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading versions...</p>
            )}

            {!loadingVersions && versions.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                No compatible versions found for {profile?.mcVersion ?? "your Minecraft version"}.
              </p>
            )}

            {!loadingVersions && versions.length > 0 && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <p style={{ fontSize: 11, color: "var(--text-muted)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                  Available Versions
                </p>
                {versions.slice(0, 10).map((version) => (
                  <div
                    key={version.id}
                    style={{
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 10,
                      padding: 12,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{version.version}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {formatFileSize(version.size)} &middot; {version.game_versions.slice(0, 3).join(", ")}
                          {version.game_versions.length > 3 && ` +${version.game_versions.length - 3}`}
                        </div>
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        onClick={() => handleInstall(version)}
                        disabled={!selectedProfileId || installing === version.id}
                      >
                        {installing === version.id ? "..." : "Install"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
