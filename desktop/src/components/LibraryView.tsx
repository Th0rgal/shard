import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { useAppStore } from "../store";
import type { LibraryItem, LibraryTag, LibraryStats, LibraryFilter, LibraryImportResult, LibraryContentType } from "../types";
import { formatFileSize, formatContentName, formatFileName } from "../utils";

type LibraryCategory = "all" | "mod" | "resourcepack" | "shaderpack" | "skin";

const CATEGORY_LABELS: Record<LibraryCategory, string> = {
  all: "All",
  mod: "Mods",
  resourcepack: "Resource Packs",
  shaderpack: "Shaders",
  skin: "Skins",
};

export function LibraryView() {
  const { selectedProfileId, notify, loadProfile } = useAppStore();
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [tags, setTags] = useState<LibraryTag[]>([]);
  const [stats, setStats] = useState<LibraryStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<LibraryCategory>("all");
  const [search, setSearch] = useState("");
  const [selectedTagFilter, setSelectedTagFilter] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<LibraryItem | null>(null);
  const [importing, setImporting] = useState(false);
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const isSystemTag = (name: string) => name.startsWith("mc:") || name.startsWith("loader:");
  const visibleTags = tags.filter((tag) => !isSystemTag(tag.name));

  const loadItems = useCallback(async () => {
    try {
      const filter: LibraryFilter = {
        content_type: category === "all" ? undefined : category,
        search: search || undefined,
        tags: selectedTagFilter ? [selectedTagFilter] : undefined,
        limit: 100,
      };
      const data = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });
      setItems(data);
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
        profile_id: selectedProfileId,
        item_id: item.id,
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

  const getContentTypeIcon = (ct: LibraryContentType) => {
    switch (ct) {
      case "mod": return "M";
      case "resourcepack": return "R";
      case "shaderpack": return "S";
      case "skin": return "K";
      default: return "?";
    }
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
      <div style={{ display: "flex", gap: 12, marginBottom: 16, alignItems: "center" }}>
        <input
          type="text"
          className="input"
          placeholder="Search library..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />

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
      <div style={{ display: "flex", gap: 24 }}>
        {/* Items list */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {loading && (
            <p style={{ color: "var(--text-muted)", fontSize: 13 }}>Loading library...</p>
          )}

          {!loading && items.length === 0 && (
            <div className="empty-state" style={{ padding: 40 }}>
              <h3>Library is empty</h3>
              <p>Import files or download content from the store to get started.</p>
            </div>
          )}

          {items.map((item) => (
            <div
              key={item.id}
              className={clsx("content-item", selectedItem?.id === item.id && "selected")}
              onClick={() => setSelectedItem(item)}
              style={{
                cursor: "pointer",
                background: selectedItem?.id === item.id ? "rgba(232, 168, 85, 0.08)" : undefined,
                borderColor: selectedItem?.id === item.id ? "rgba(232, 168, 85, 0.2)" : undefined,
              }}
            >
              <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 8,
                    background: "rgba(255, 255, 255, 0.05)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                    fontWeight: 600,
                    flexShrink: 0,
                    color: "var(--text-secondary)",
                  }}
                >
                  {getContentTypeIcon(item.content_type)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <h5 style={{ margin: 0, fontSize: 14, fontWeight: 500 }}>{formatContentName(item.name)}</h5>
                  <p
                    style={{
                      margin: "4px 0 0",
                      fontSize: 12,
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {getContentTypeLabel(item.content_type)}
                    {item.file_size && ` • ${formatFileSize(item.file_size)}`}
                  </p>
                  {item.tags.filter((tag) => !isSystemTag(tag.name)).length > 0 && (
                    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
                      {item.tags.filter((tag) => !isSystemTag(tag.name)).map((tag) => (
                        <span
                          key={tag.id}
                          style={{
                            fontSize: 10,
                            padding: "2px 6px",
                            borderRadius: 4,
                            background: tag.color ? `${tag.color}20` : "rgba(232, 168, 85, 0.15)",
                            color: tag.color || "var(--accent-primary)",
                          }}
                        >
                          {tag.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
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
                  <div style={{ textTransform: "capitalize" }}>{selectedItem.source_platform}</div>
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
