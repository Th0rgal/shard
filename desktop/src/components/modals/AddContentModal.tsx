import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import clsx from "clsx";
import { Modal } from "../Modal";
import type { ContentTab, LibraryItem, LibraryFilter, StoreProject } from "../../types";
import { getContentTypeLabel, formatFileSize, formatContentName } from "../../utils";
import { useAppStore } from "../../store";
import { PlatformIcon } from "../PlatformIcon";

interface AddContentModalProps {
  open: boolean;
  kind: ContentTab;
  onClose: () => void;
  onAddFromLibrary?: (item: LibraryItem) => Promise<void>;
}

type SearchSource = "library" | "store";

const contentTypeMap: Record<ContentTab, string> = {
  mods: "mod",
  resourcepacks: "resourcepack",
  shaderpacks: "shaderpack",
};

export function AddContentModal({ open, kind, onClose, onAddFromLibrary }: AddContentModalProps) {
  const { notify, profile, loadProfile } = useAppStore();
  const [source, setSource] = useState<SearchSource>("library");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Library state
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [selectedLibraryItem, setSelectedLibraryItem] = useState<LibraryItem | null>(null);

  // Store state
  const [storeResults, setStoreResults] = useState<StoreProject[]>([]);
  const [selectedStoreItem, setSelectedStoreItem] = useState<StoreProject | null>(null);
  const [installing, setInstalling] = useState(false);

  const dropRef = useRef<HTMLDivElement>(null);

  // Load library items
  const loadLibraryItems = useCallback(async () => {
    setLoading(true);
    try {
      const filter: LibraryFilter = {
        content_type: contentTypeMap[kind],
        search: search || undefined,
        limit: 50,
      };
      const items = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });
      setLibraryItems(items);
    } catch (err) {
      console.error("Failed to load library items:", err);
    } finally {
      setLoading(false);
    }
  }, [kind, search]);

  // Search store (empty query returns popular/trending)
  const searchStore = useCallback(async () => {
    setLoading(true);
    try {
      const input = {
        query: search.trim(),
        content_type: contentTypeMap[kind],
        game_version: profile?.mcVersion ?? null,
        loader: profile?.loader?.type ?? null,
        limit: 20,
      };
      const results = await invoke<StoreProject[]>("store_search_cmd", { input });
      setStoreResults(results);
    } catch (err) {
      console.error("Store search failed:", err);
      notify("Search failed", String(err));
    } finally {
      setLoading(false);
    }
  }, [search, kind, profile, notify]);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setSource("library");
      setSearch("");
      setSelectedLibraryItem(null);
      setSelectedStoreItem(null);
      setStoreResults([]);
      void loadLibraryItems();
    }
  }, [open]);

  // Load based on source and search
  useEffect(() => {
    if (!open) return;

    // Debounce search queries, but load immediately for initial popular results
    const delay = source === "store" && search.trim() ? 300 : 0;
    const debounce = setTimeout(() => {
      if (source === "library") {
        void loadLibraryItems();
      } else {
        void searchStore();
      }
    }, delay);

    return () => clearTimeout(debounce);
  }, [search, source, open, loadLibraryItems, searchStore]);

  // Handle file import
  const handleImport = async (paths?: string[]) => {
    if (!paths) {
      const extensions = kind === "mods" ? ["jar"] : ["zip", "jar"];
      const result = await dialogOpen({
        multiple: true,
        filters: [{ name: "Content", extensions }],
      });
      if (!result) return;
      paths = Array.isArray(result) ? result : [result];
    }

    if (paths.length === 0) return;

    setImporting(true);
    let added = 0;
    let lastItem: LibraryItem | null = null;

    for (const path of paths) {
      try {
        const item = await invoke<LibraryItem>("library_import_file_cmd", {
          path,
          contentType: contentTypeMap[kind],
        });
        lastItem = item;
        added++;
      } catch (err) {
        const errStr = String(err);
        if (!errStr.includes("UNIQUE constraint")) {
          notify("Import failed", errStr);
        }
      }
    }

    setImporting(false);
    if (added > 0) {
      notify("Imported", `Added ${added} ${getContentTypeLabel(kind).toLowerCase()}${added === 1 ? "" : "s"}`);
      await loadLibraryItems();
      if (lastItem) {
        setSelectedLibraryItem(lastItem);
      }
    }
  };

  // Handle drop
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const files = Array.from(e.dataTransfer.files);
    const paths = files.map(f => (f as File & { path?: string }).path).filter((p): p is string => !!p);

    if (paths.length > 0) {
      void handleImport(paths);
    }
  }, [kind]);

  // Handle store install
  const handleStoreInstall = async () => {
    if (!selectedStoreItem || !profile) return;

    setInstalling(true);
    try {
      const input = {
        profile_id: profile.id,
        project_id: selectedStoreItem.id,
        platform: selectedStoreItem.platform,
        content_type: contentTypeMap[kind],
      };
      await invoke("store_install_cmd", { input });
      await loadProfile(profile.id);
      notify("Installed", `${selectedStoreItem.name} added to profile`);
      onClose();
    } catch (err) {
      notify("Install failed", String(err));
    } finally {
      setInstalling(false);
    }
  };

  // Handle library add
  const handleLibraryAdd = async () => {
    if (!selectedLibraryItem || !onAddFromLibrary) return;
    await onAddFromLibrary(selectedLibraryItem);
  };

  const canSubmit = source === "library"
    ? selectedLibraryItem !== null && onAddFromLibrary !== undefined
    : selectedStoreItem !== null;

  const contentLabel = getContentTypeLabel(kind);

  return (
    <Modal open={open} onClose={onClose} title={`Add ${contentLabel}`} className="modal-lg">
      <div className="add-content-modal">
        {/* Source tabs */}
        <div className="add-content-tabs">
          <button
            className={clsx("add-content-tab", source === "library" && "active")}
            onClick={() => { setSource("library"); setSelectedStoreItem(null); }}
          >
            Library
          </button>
          <button
            className={clsx("add-content-tab", source === "store" && "active")}
            onClick={() => { setSource("store"); setSelectedLibraryItem(null); }}
          >
            Store
          </button>
        </div>

        {/* Search input */}
        <input
          type="text"
          className="input"
          placeholder={source === "library" ? "Search your library..." : `Search ${contentLabel.toLowerCase()}s...`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        {/* Content area with drop zone */}
        <div
          ref={dropRef}
          className={clsx("add-content-list", isDragging && "dragging")}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          {isDragging && (
            <div className="add-content-drop-overlay">
              <span>Drop files to import</span>
            </div>
          )}

          {loading && (
            <div className="add-content-empty">
              <span className="text-muted">Searching...</span>
            </div>
          )}

          {!loading && source === "library" && libraryItems.length === 0 && (
            <div className="add-content-empty">
              <span className="text-muted">
                {search ? "No matches found" : `No ${contentLabel.toLowerCase()}s in library`}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => handleImport()} disabled={importing}>
                {importing ? "Importing..." : "Import files"}
              </button>
            </div>
          )}

          {!loading && source === "store" && storeResults.length === 0 && (
            <div className="add-content-empty">
              <span className="text-muted">
                {search ? "No compatible results found" : "No popular content available"}
              </span>
            </div>
          )}

          {/* Library items */}
          {source === "library" && libraryItems.map((item) => (
            <div
              key={item.id}
              className={clsx("add-content-item", selectedLibraryItem?.id === item.id && "selected")}
              onClick={() => setSelectedLibraryItem(item)}
            >
              <div className="add-content-item-info">
                <span className="add-content-item-name">{formatContentName(item.name)}</span>
                <span className="add-content-item-meta">
                  {item.file_size && formatFileSize(item.file_size)}
                  {item.source_platform && (
                    <>
                      <span className="dot">·</span>
                      <PlatformIcon platform={item.source_platform as "modrinth" | "curseforge" | "local"} size="sm" />
                    </>
                  )}
                </span>
              </div>
              {selectedLibraryItem?.id === item.id && (
                <svg className="add-content-check" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M6.5 12.5L2 8l1.5-1.5L6.5 9.5 12.5 3.5 14 5z" fill="currentColor" />
                </svg>
              )}
            </div>
          ))}

          {/* Store items */}
          {source === "store" && storeResults.map((item) => (
            <div
              key={item.id}
              className={clsx("add-content-item", selectedStoreItem?.id === item.id && "selected")}
              onClick={() => setSelectedStoreItem(item)}
            >
              {item.icon_url && (
                <img src={item.icon_url} alt="" className="add-content-item-icon" />
              )}
              <div className="add-content-item-info">
                <span className="add-content-item-name">{item.name}</span>
                <span className="add-content-item-meta">
                  {item.downloads.toLocaleString()} downloads
                  <span className="dot">·</span>
                  <PlatformIcon platform={item.platform} size="sm" />
                </span>
              </div>
              {selectedStoreItem?.id === item.id && (
                <svg className="add-content-check" width="16" height="16" viewBox="0 0 16 16">
                  <path d="M6.5 12.5L2 8l1.5-1.5L6.5 9.5 12.5 3.5 14 5z" fill="currentColor" />
                </svg>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="modal-footer">
          {source === "library" && (
            <button className="btn btn-ghost" onClick={() => handleImport()} disabled={importing}>
              {importing ? "Importing..." : "Import files"}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={source === "library" ? handleLibraryAdd : handleStoreInstall}
            disabled={!canSubmit || installing}
          >
            {installing ? "Installing..." : "Add to profile"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
