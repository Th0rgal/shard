import { useState, useCallback, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
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
        project_id: project.id,
        platform: project.platform,
        game_version: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        profile_id: selectedProfileId ?? null,
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
        project_id: project.id,
        platform: project.platform,
        game_version: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        profile_id: selectedProfileId,
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
              className={clsx("content-item", selectedProject?.id === project.id && "selected")}
              onClick={() => handleSelectProject(project)}
              style={{
                cursor: "pointer",
                background: selectedProject?.id === project.id ? "rgba(232, 168, 85, 0.08)" : undefined,
                borderColor: selectedProject?.id === project.id ? "rgba(232, 168, 85, 0.2)" : undefined,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                {project.icon_url && (
                  <img
                    src={project.icon_url}
                    alt=""
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                  />
                )}
                {!project.icon_url && (
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
                      flexShrink: 0,
                    }}
                  >
                    {category === "mods" ? "M" : category === "resourcepacks" ? "R" : "S"}
                  </div>
                )}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h5 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{project.name}</h5>
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
                  <div style={{ display: "flex", gap: 12, marginTop: 6, fontSize: 11, color: "var(--text-muted)" }}>
                    <span>{formatDownloads(project.downloads)} downloads</span>
                    <span
                      style={{
                        background: project.platform === "modrinth" ? "rgba(30, 215, 96, 0.15)" : "rgba(246, 96, 54, 0.15)",
                        color: project.platform === "modrinth" ? "#1ed760" : "#f66036",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontWeight: 500,
                      }}
                    >
                      {project.platform}
                    </span>
                  </div>
                </div>
              </div>
              {/* Quick install button */}
              {selectedProfileId && (
                <button
                  className="btn btn-primary btn-sm"
                  onClick={(e) => handleQuickInstall(project, e)}
                  disabled={quickInstalling === `${project.platform}-${project.id}`}
                  style={{ flexShrink: 0 }}
                  title="Install latest compatible version"
                >
                  {quickInstalling === `${project.platform}-${project.id}` ? "..." : "Install"}
                </button>
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
            <h4 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
              {selectedProject.name}
            </h4>
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
