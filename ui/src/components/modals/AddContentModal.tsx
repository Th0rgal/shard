import { useState, useEffect, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import type { ContentTab, LibraryItem, LibraryFilter } from "../../types";
import { getContentTypeLabel, formatFileSize, formatContentName } from "../../utils";
import { useAppStore } from "../../store";

interface AddContentModalProps {
  open: boolean;
  kind: ContentTab;
  onClose: () => void;
  onAddFromLibrary?: (item: LibraryItem) => Promise<void>;
}

export function AddContentModal({ open, kind, onClose, onAddFromLibrary }: AddContentModalProps) {
  const { notify, profile } = useAppStore();
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [librarySearch, setLibrarySearch] = useState("");
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<LibraryItem | null>(null);
  const [compatibleOnly, setCompatibleOnly] = useState(false);
  const [importing, setImporting] = useState(false);

  const contentTypeMap: Record<ContentTab, string> = {
    mods: "mod",
    resourcepacks: "resourcepack",
    shaderpacks: "shaderpack",
  };

  const loadLibraryItems = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const filter: LibraryFilter = {
        content_type: contentTypeMap[kind],
        search: librarySearch || undefined,
        limit: 50,
      };
      const items = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });
      setLibraryItems(items);
    } catch (err) {
      console.error("Failed to load library items:", err);
    } finally {
      setLoadingLibrary(false);
    }
  }, [kind, librarySearch]);

  useEffect(() => {
    if (open) {
      setSelectedLibraryItem(null);
      setLibrarySearch("");
      setCompatibleOnly(false);
      void loadLibraryItems();
    }
  }, [open, loadLibraryItems]);

  useEffect(() => {
    if (open) {
      void loadLibraryItems();
    }
  }, [librarySearch, open, loadLibraryItems]);

  const visibleLibraryItems = useMemo(() => {
    if (!compatibleOnly || !profile?.mcVersion) return libraryItems;
    const versionTag = `mc:${profile.mcVersion}`;
    return libraryItems.filter((item) => item.tags.some((tag) => tag.name === versionTag));
  }, [compatibleOnly, libraryItems, profile?.mcVersion]);

  useEffect(() => {
    if (selectedLibraryItem && !visibleLibraryItems.find((item) => item.id === selectedLibraryItem.id)) {
      setSelectedLibraryItem(null);
    }
  }, [selectedLibraryItem, visibleLibraryItems]);

  const handleImport = async () => {
    const extensions = kind === "mods" ? ["jar"] : ["zip", "jar"];
    const result = await dialogOpen({
      multiple: true,
      filters: [{ name: "Content", extensions }],
    });

    if (!result) return;
    const paths = Array.isArray(result) ? result : [result];
    if (paths.length === 0) return;

    setImporting(true);
    let added = 0;
    let lastItem: LibraryItem | null = null;

    for (const path of paths) {
      try {
        const item = await invoke<LibraryItem>("library_import_file_cmd", {
          path,
          content_type: contentTypeMap[kind],
        });
        lastItem = item;
        added++;
      } catch (err) {
        notify("Import failed", String(err));
      }
    }

    setImporting(false);
    if (added > 0) {
      notify("Import complete", `Added ${added} ${getContentTypeLabel(kind).toLowerCase()}${added === 1 ? "" : "s"} to library`);
    }
    await loadLibraryItems();
    if (lastItem) {
      setSelectedLibraryItem(lastItem);
    }
  };

  const handleSubmit = async () => {
    if (!selectedLibraryItem || !onAddFromLibrary) return;
    await onAddFromLibrary(selectedLibraryItem);
  };

  const canSubmit = selectedLibraryItem !== null && onAddFromLibrary !== undefined;

  return (
    <Modal open={open} onClose={onClose} title={`Add ${getContentTypeLabel(kind)}`} className="modal-lg">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <input
              type="text"
              className="input"
              placeholder="Search library..."
              value={librarySearch}
              onChange={(e) => setLibrarySearch(e.target.value)}
              style={{ flex: 1 }}
            />

            {profile?.mcVersion && (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={compatibleOnly}
                  onChange={(e) => setCompatibleOnly(e.target.checked)}
                />
                Compatible with {profile.mcVersion}
              </label>
            )}

            <button className="btn btn-secondary" onClick={handleImport} disabled={importing}>
              Upload more
            </button>
          </div>

          <div
            style={{
              maxHeight: 280,
              overflowY: "auto",
              border: "1px solid var(--border-subtle)",
              borderRadius: 12,
              background: "rgba(0, 0, 0, 0.2)",
            }}
          >
            {loadingLibrary && (
              <p style={{ padding: 16, color: "var(--text-muted)", fontSize: 13 }}>
                Loading...
              </p>
            )}

            {!loadingLibrary && visibleLibraryItems.length === 0 && (
              <div style={{ padding: 24, textAlign: "center" }}>
                <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                  {compatibleOnly && profile?.mcVersion
                    ? `No ${getContentTypeLabel(kind)}s tagged for Minecraft ${profile.mcVersion}.`
                    : `No ${getContentTypeLabel(kind)}s in library yet.`}
                </p>
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 12 }}
                  onClick={handleImport}
                  disabled={importing}
                >
                  Upload more
                </button>
              </div>
            )}

            {visibleLibraryItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setSelectedLibraryItem(item)}
                style={{
                  padding: "12px 16px",
                  cursor: "pointer",
                  borderBottom: "1px solid var(--border-subtle)",
                  background: selectedLibraryItem?.id === item.id
                    ? "rgba(124, 199, 255, 0.1)"
                    : "transparent",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{formatContentName(item.name)}</div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                      {item.file_size && formatFileSize(item.file_size)}
                      {item.source_platform && ` • ${item.source_platform}`}
                    </div>
                  </div>
                  {selectedLibraryItem?.id === item.id && (
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="var(--accent-primary)">
                      <path d="M6.5 12.5L2 8l1.5-1.5L6.5 9.5 12.5 3.5 14 5z" />
                    </svg>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        <ModalFooter
          onCancel={onClose}
          onSubmit={handleSubmit}
          submitLabel="Add to profile"
          submitDisabled={!canSubmit}
        />
      </div>
    </Modal>
  );
}
