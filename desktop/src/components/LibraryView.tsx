import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import clsx from "clsx";
import { useAppStore } from "../store";
import { SkinHead } from "./SkinThumbnail";
import { ContentItemRow } from "./ContentItemRow";
import { PlatformIcon, PLATFORM_COLORS, type Platform } from "./PlatformIcon";
import type { LibraryItem, LibraryTag, LibraryStats, LibraryFilter, LibraryImportResult, LibraryContentType } from "../types";
import { formatFileSize, formatContentName, formatFileName, formatVersion } from "../utils";

// Extended library item with resolved skin URL for skins
interface LibraryItemWithUrl extends LibraryItem {
  resolvedUrl?: string;
}

type LibraryCategory = "all" | "mod" | "resourcepack" | "shaderpack" | "skin";

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  all: "All",
  mod: "Mods",
  resourcepack: "Packs",
  shaderpack: "Shaders",
  skin: "Skins",
};

export function LibraryView() {
  const { selectedProfileId, notify, loadProfile } = useAppStore();
  const [items, setItems] = useState<LibraryItemWithUrl[]>([]);
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<LibraryCategory>("all");
  const [search, setSearch] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<LibraryItemWithUrl | null>(null);
  const [importing, setImporting] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const isSystemTag = (name: string) => name.startsWith("mc:") || name.startsWith("loader:");
  const visibleTags = tags.filter((tag) => !isSystemTag(tag.name));

  // Focus input when search expands
  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchExpanded]);

  // Close search on click outside
  useEffect(() => {
    if (!searchExpanded) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".library-search-container")) {
        // Only collapse if search is empty
        if (!search) {
          setSearchExpanded(false);
        }
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [searchExpanded, search]);

  const loadItems = useCallback(async () => {
    try {
      const filter: LibraryFilter = {
        content_type: category === "all" ? undefined : category,
        search: search || undefined,
        tags: selectedTagFilter ? [selectedTagFilter] : undefined,
        limit: 100,
      };
      const data = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });

      // Resolve file paths to asset URLs for skin items
      const itemsWithUrls: LibraryItemWithUrl[] = await Promise.all(
        data.map(async (item) => {
          if (item.content_type === "skin") {
            try {
              const path = await invoke<string | null>("library_get_item_path_cmd", { id: item.id });
              return {
                ...item,
                resolvedUrl: path ? convertFileSrc(path) : item.source_url || "",
              };
            } catch {
              return { ...item, resolvedUrl: item.source_url || "" };
            }
          }
          return item;
        })
      );

      setItems(itemsWithUrls);
    } catch (err) {
      notify("Failed to load library", String(err));
    }
  }, [category, search, selectedTagFilter, notify]);

  const loadTags = useCallback(async () => {
    try {
      const data = await invoke<LibraryTag[]>("library_list_tags_cmd");
      setTags(data);
    } catch {
      // Silently fail
    }
  }, []);

  const loadStats = useCallback(async () => {
    try {
      const data = await invoke<LibraryStats>("library_get_stats_cmd");
      setStats(data);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      await Promise.all([loadItems(), loadTags(), loadStats()]);
      setLoading(false);
    };
    load();
  }, [loadItems, loadTags, loadStats]);

  const handleCategoryChange = (newCategory: LibraryCategory) => {
    setCategory(newCategory);
    setSelectedItem(null);
  };

  const handleImportFile = async () => {
    const extensions = category === "all" ? ["jar", "zip", "png"] :
      category === "mod" ? ["jar"] :
      category === "skin" ? ["png"] : ["zip", "jar"];

    const result = await open({
      multiple: true,
      filters: [{ name: "Content", extensions }],
    });

    if (!result) return;

    const paths = Array.isArray(result) ? result : [result];
    if (paths.length === 0) return;

    setImporting(true);
    let added = 0;
    let skipped = 0;

    const contentType = category === "all" ? "mod" : category;

    for (const path of paths) {
      try {
        await invoke<LibraryItem>("library_import_file_cmd", { path, content_type: contentType });
        added++;
      } catch (err) {
        const errStr = String(err);
        if (errStr.includes("UNIQUE constraint")) {
          skipped++;
        } else {
          notify("Import failed", errStr);
        }
      }
    }

    setImporting(false);
    notify("Import complete", `Added ${added}, skipped ${skipped} duplicates`);
    await Promise.all([loadItems(), loadStats()]);
  };

  const handleImportFolder = async () => {
    const result = await open({
      directory: true,
      multiple: false,
    });

    if (!result) return;

    setImporting(true);
    const contentType = category === "all" ? "mod" : category;

    try {
      const importResult = await invoke<LibraryImportResult>("library_import_folder_cmd", {
        path: result,
        content_type: contentType,
        recursive: true,
      });
      notify("Import complete", `Added ${importResult.added}, skipped ${importResult.skipped}`);
      if (importResult.errors.length > 0) {
        console.error("Import errors:", importResult.errors);
      }
    } catch (err) {
      notify("Import failed", String(err));
    }

    setImporting(false);
    await Promise.all([loadItems(), loadStats()]);
  };

  const handleSync = async () => {
    setImporting(true);
    try {
      const result = await invoke<LibraryImportResult>("library_sync_cmd");
      notify("Sync complete", `Found ${result.added} new items in store`);
    } catch (err) {
      notify("Sync failed", String(err));
    }
    setImporting(false);
    await Promise.all([loadItems(), loadStats()]);
  };

  const handleAddToProfile = async (item: LibraryItem) => {
    if (!selectedProfileId) {
      notify("No profile selected", "Select a profile first");
      return;
    }

    try {
      await invoke("library_add_to_profile_cmd", {
        profileId: selectedProfileId,
        itemId: item.id,
      });
      await loadProfile(selectedProfileId);
      notify("Added to profile", `${formatContentName(item.name)} added to ${selectedProfileId}`);
    } catch (err) {
      notify("Failed to add", String(err));
    }
  };

  const handleDeleteItem = async (item: LibraryItem) => {
    try {
      await invoke("library_delete_item_cmd", { id: item.id, deleteFile: false });
      setSelectedItem(null);
      await Promise.all([loadItems(), loadStats()]);
      notify("Removed", `${formatContentName(item.name)} removed from library`);
    } catch (err) {
      notify("Failed to remove", String(err));
    }
  };

  const getContentTypeLabel = (ct: LibraryContentType) => {
    switch (ct) {
      case "mod": return "Mod";
      case "resourcepack": return "Resource Pack";
      case "shaderpack": return "Shader";
      case "skin": return "Skin";
      default: return ct;
    }
  };

  const getSourceUrl = (item: LibraryItem): string | null => {
    const platform = item.source_platform?.toLowerCase();
    const projectId = item.source_project_id;

    if (!projectId || platform === "local" || platform === "store") return null;

    const typeMap: Record<string, { modrinth: string; curseforge: string }> = {
      mod: { modrinth: "mod", curseforge: "mc-mods" },
      resourcepack: { modrinth: "resourcepack", curseforge: "texture-packs" },
      shaderpack: { modrinth: "shader", curseforge: "shaders" },
    };

    const paths = typeMap[item.content_type];
    if (!paths) return null;

    if (platform === "modrinth") {
      return `https://modrinth.com/${paths.modrinth}/${projectId}`;
    }
    if (platform === "curseforge") {
      return `https://www.curseforge.com/minecraft/${paths.curseforge}/${projectId}`;
    }

    return null;
  };

  const getPlatformColor = (platform: string | null | undefined): string => {
    const p = platform?.toLowerCase();
    if (p === "modrinth") return PLATFORM_COLORS.modrinth;
    if (p === "curseforge") return PLATFORM_COLORS.curseforge;
    return PLATFORM_COLORS.local;
  };


  return (
    <div className="view-transition">
      {/* Category tabs */}
      <div className="content-tabs" style={{ marginBottom: 16 }}>
        {(Object.keys(CATEGORY_LABELS) as LibraryCategory[]).map((cat) => (
          <button
            key={cat}
            className={clsx("content-tab", category === cat && "active")}
            onClick={() => handleCategoryChange(cat)}
          >
            {CATEGORY_LABELS[cat]}
            {stats && cat !== "all" && (
              <span style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>
                ({cat === "mod" ? stats.mods_count :
                  cat === "resourcepack" ? stats.resourcepacks_count :
                  cat === "shaderpack" ? stats.shaderpacks_count :
                  stats.skins_count})
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Search and actions */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", position: "relative" }}>
        {/* Collapsible search */}
        <div className={clsx("library-search-container", searchExpanded && "expanded", search && "has-value")}>
          <button
            className="library-search-toggle"
            onClick={() => setSearchExpanded(!searchExpanded)}
            title="Search library"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </button>
          <input
            ref={searchInputRef}
            type="text"
            className="library-search-input"
            placeholder="Search library..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (search) {
                  setSearch("");
                } else {
                  setSearchExpanded(false);
                }
              }
            }}
          />
          {search && (
            <button
              className="library-search-clear"
              onClick={() => {
                setSearch("");
                searchInputRef.current?.focus();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        {/* Tag filter dropdown */}
        <div style={{ position: "relative" }}>
          <button
            className={clsx("btn btn-secondary", selectedTagFilter && "active")}
            onClick={() => setShowTagDropdown(!showTagDropdown)}
          >
            {selectedTagFilter || "Tags"}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ marginLeft: 6 }}>
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
            </svg>
          </button>
          {showTagDropdown && (
            <div className="sidebar-add-menu" style={{ right: 0, left: "auto", minWidth: 140 }}>
              <button onClick={() => { setSelectedTagFilter(null); setShowTagDropdown(false); }}>
                All tags
              </button>
              {visibleTags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => { setSelectedTagFilter(tag.name); setShowTagDropdown(false); }}
                >
                  {tag.color && (
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: tag.color,
                        display: "inline-block",
                        marginRight: 8,
                      }}
                    />
                  )}
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <button className="btn btn-secondary" onClick={handleImportFile} disabled={importing}>
          Import Files
        </button>
        <button className="btn btn-secondary" onClick={handleImportFolder} disabled={importing}>
          Import Folder
        </button>
        <button className="btn btn-secondary" onClick={handleSync} disabled={importing}>
          Sync
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 20 }}>
          {stats.total_items} items &middot; {formatFileSize(stats.total_size)} total
        </p>
      )}

      {/* Content */}
      <div style={{ display: "flex", gap: 24, flex: 1, minHeight: 0 }}>
        {/* Items list */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {loading && (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading library...</p>
          )}

          {!loading && items.length === 0 && (
            <div className="empty-state-container">
              <div className="empty-state">
                <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ opacity: 0.4, marginBottom: 16 }}>
                  <rect x="6" y="10" width="36" height="28" rx="4" stroke="currentColor" strokeWidth="2" />
                  <path d="M6 18h36" stroke="currentColor" strokeWidth="2" />
                  <rect x="12" y="24" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
                  <rect x="26" y="24" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.5" />
                </svg>
                <h3>Library is empty</h3>
                <p style={{ marginBottom: 0 }}>Import files or download content from the store to get started.</p>
              </div>
            </div>
          )}

          <div className="content-list">
          {items.map((item) => {
            // Use ContentItemRow for mods, resourcepacks, and shaderpacks
            if (item.content_type !== "skin") {
              return (
                <ContentItemRow
                  key={item.id}
                  item={{
                    name: item.name,
                    hash: item.hash,
                    version: item.source_version,
                    source_platform: item.source_platform,
                    source_project_id: item.source_project_id,
                    file_name: item.file_name,
                    file_size: item.file_size,
                  }}
                  contentType={item.content_type === "mod" ? "mods" : item.content_type === "resourcepack" ? "resourcepacks" : "shaderpacks"}
                  selected={selectedItem?.id === item.id}
                  onClick={() => setSelectedItem(item)}
                  showBadges={false}
                />
              );
            }

            // Custom rendering for skins with skin thumbnail
            return (
              <div
                key={item.id}
                className={clsx("content-item-v2", selectedItem?.id === item.id && "content-item-selected")}
                onClick={() => setSelectedItem(item)}
                style={{
                  cursor: "pointer",
                  background: selectedItem?.id === item.id ? "rgba(232, 168, 85, 0.08)" : undefined,
                  borderColor: selectedItem?.id === item.id ? "rgba(232, 168, 85, 0.2)" : undefined,
                }}
              >
                {/* Skin thumbnail */}
                <div className="content-item-icon">
                  {item.resolvedUrl ? (
                    <SkinHead skinUrl={item.resolvedUrl} size={36} />
                  ) : (
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 8,
                        background: "rgba(255, 255, 255, 0.05)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 14,
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                      }}
                    >
                      ?
                    </div>
                  )}
                </div>

                {/* Content info */}
                <div className="content-item-main">
                  <div className="content-item-header">
                    <h5 className="content-item-name">{formatContentName(item.name)}</h5>
                  </div>
                  <div className="content-item-meta">
                    <span className="content-meta-platform" style={{ color: "var(--text-muted)" }}>
                      Skin
                    </span>
                    {item.file_size && (
                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
                        {formatFileSize(item.file_size)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          </div>
        </div>

        {/* Detail panel */}
        {selectedItem && (
          <div
            style={{
              width: 300,
              flexShrink: 0,
              background: "rgba(255, 255, 255, 0.02)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              padding: 20,
              alignSelf: "flex-start",
              position: "sticky",
              top: 0,
            }}
          >
            <h4 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>
              {formatContentName(selectedItem.name)}
            </h4>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 13 }}>
              <div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                  Type
                </div>
                <div>{getContentTypeLabel(selectedItem.content_type)}</div>
              </div>

              {selectedItem.file_name && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                    File
                  </div>
                  <div style={{ wordBreak: "break-all" }}>{formatFileName(selectedItem.file_name)}</div>
                </div>
              )}

              {selectedItem.file_size && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                    Size
                  </div>
                  <div>{formatFileSize(selectedItem.file_size)}</div>
                </div>
              )}

              {selectedItem.source_platform && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                    Source
                  </div>
                  {(() => {
                    const sourceUrl = getSourceUrl(selectedItem);
                    const platformColor = getPlatformColor(selectedItem.source_platform);
                    if (sourceUrl) {
                      return (
                        <button
                          className="content-meta-platform content-meta-platform-link"
                          style={{ color: platformColor, padding: 0, fontSize: 13 }}
                          onClick={() => openUrl(sourceUrl)}
                          title={`Open on ${selectedItem.source_platform}`}
                        >
                          {selectedItem.source_platform.charAt(0).toUpperCase() + selectedItem.source_platform.slice(1)}
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 4 }}>
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </button>
                      );
                    }
                    return <div style={{ textTransform: "capitalize" }}>{selectedItem.source_platform}</div>;
                  })()}
                </div>
              )}

              <div>
                <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                  Added
                </div>
                <div>{new Date(selectedItem.added_at).toLocaleDateString()}</div>
              </div>

              {selectedItem.used_by_profiles.length > 0 && (
                <div>
                  <div style={{ color: "var(--text-muted)", fontSize: 11, textTransform: "uppercase", marginBottom: 2 }}>
                    Used by
                  </div>
                  <div>{selectedItem.used_by_profiles.join(", ")}</div>
                </div>
              )}

              <div style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 4 }}>
                {selectedItem.hash.slice(0, 16)}...
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 20 }}>
              {selectedItem.content_type !== "skin" && (
                <button
                  className="btn btn-primary"
                  onClick={() => handleAddToProfile(selectedItem)}
                  disabled={!selectedProfileId}
                >
                  Add to Profile
                </button>
              )}
              <button
                className="btn btn-secondary"
                onClick={() => handleDeleteItem(selectedItem)}
              >
                Remove from Library
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
