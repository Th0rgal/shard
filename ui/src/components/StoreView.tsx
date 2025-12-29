import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import { useAppStore } from "../store";
import { Field } from "./Field";
import type { StoreProject, StoreVersion } from "../types";
import { formatDownloads, formatFileSize } from "../utils";

type StoreCategory = "mods" | "resourcepacks" | "shaderpacks";

interface StoreSearchInput {
  query: string;
  category: StoreCategory;
  game_version?: string | null;
  loader?: string | null;
  limit?: number;
}

export function StoreView() {
  const { profile, selectedProfileId, loadProfile, notify } = useAppStore();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<StoreCategory>("mods");
  const [results, setResults] = useState<StoreProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedProject, setSelectedProject] = useState<StoreProject | null>(null);
  const [versions, setVersions] = useState<StoreVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [installing, setInstalling] = useState<string | null>(null);

  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setResults([]);
    setSelectedProject(null);
    setVersions([]);

    try {
      const input: StoreSearchInput = {
        query: query.trim(),
        category,
        game_version: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        limit: 20,
      };
      const data = await invoke<StoreProject[]>("store_search_cmd", { input });
      setResults(data);
    } catch (err) {
      notify("Search failed", String(err));
    } finally {
      setLoading(false);
    }
  }, [query, category, profile, notify]);

  const handleSelectProject = useCallback(async (project: StoreProject) => {
    setSelectedProject(project);
    setLoadingVersions(true);
    setVersions([]);

    try {
      const data = await invoke<StoreVersion[]>("store_get_versions_cmd", {
        projectId: project.id,
        source: project.source,
        gameVersion: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
      });
      setVersions(data);
    } catch (err) {
      notify("Failed to load versions", String(err));
    } finally {
      setLoadingVersions(false);
    }
  }, [profile, notify]);

  const handleInstall = useCallback(async (version: StoreVersion) => {
    if (!selectedProfileId || !selectedProject) return;

    setInstalling(version.id);
    try {
      const input = {
        profile_id: selectedProfileId,
        source: selectedProject.source,
        project_id: selectedProject.id,
        version_id: version.id,
        category,
      };
      await invoke("store_install_cmd", { input });
      await loadProfile(selectedProfileId);
      notify("Installed", `${selectedProject.name} v${version.version_number}`);
    } catch (err) {
      notify("Install failed", String(err));
    } finally {
      setInstalling(null);
    }
  }, [selectedProfileId, selectedProject, category, loadProfile, notify]);

  return (
    <div className="view-transition">
      <h1 className="page-title">Content Store</h1>
      <p style={{ margin: "-24px 0 24px", fontSize: 14, color: "var(--text-secondary)" }}>
        Browse and install mods, resource packs, and shaders from Modrinth and CurseForge.
      </p>

      {/* Category tabs */}
      <div className="content-tabs" style={{ marginBottom: 24 }}>
        <button
          className={clsx("content-tab", category === "mods" && "active")}
          onClick={() => setCategory("mods")}
        >
          Mods
        </button>
        <button
          className={clsx("content-tab", category === "resourcepacks" && "active")}
          onClick={() => setCategory("resourcepacks")}
        >
          Resource Packs
        </button>
        <button
          className={clsx("content-tab", category === "shaderpacks" && "active")}
          onClick={() => setCategory("shaderpacks")}
        >
          Shaders
        </button>
      </div>

      {/* Search bar */}
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <input
          type="text"
          className="input"
          placeholder={`Search ${category}...`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSearch()}
          style={{ flex: 1 }}
        />
        <button
          className="btn-primary"
          onClick={handleSearch}
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching..." : "Search"}
        </button>
      </div>

      {/* Version context */}
      {profile && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          Showing results compatible with Minecraft {profile.mcVersion}
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
          {results.length === 0 && !loading && query && (
            <div className="empty-state" style={{ padding: 40 }}>
              <h3>No results</h3>
              <p>Try a different search term or category.</p>
            </div>
          )}

          {results.map((project) => (
            <div
              key={`${project.source}-${project.id}`}
              className={clsx("content-item", selectedProject?.id === project.id && "selected")}
              onClick={() => handleSelectProject(project)}
              style={{
                cursor: "pointer",
                background: selectedProject?.id === project.id ? "rgba(124, 199, 255, 0.08)" : undefined,
                borderColor: selectedProject?.id === project.id ? "rgba(124, 199, 255, 0.2)" : undefined,
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
                    <span>by {project.author}</span>
                    <span>{formatDownloads(project.download_count)} downloads</span>
                    <span
                      style={{
                        background: project.source === "modrinth" ? "rgba(30, 215, 96, 0.15)" : "rgba(246, 96, 54, 0.15)",
                        color: project.source === "modrinth" ? "#1ed760" : "#f66036",
                        padding: "1px 6px",
                        borderRadius: 4,
                        fontWeight: 500,
                      }}
                    >
                      {project.source}
                    </span>
                  </div>
                </div>
              </div>
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
              borderRadius: 16,
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
                        <div style={{ fontSize: 13, fontWeight: 500 }}>{version.version_number}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                          {formatFileSize(version.file_size)} &middot; {version.game_versions.slice(0, 3).join(", ")}
                          {version.game_versions.length > 3 && ` +${version.game_versions.length - 3}`}
                        </div>
                      </div>
                      <button
                        className="btn-primary btn-sm"
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
