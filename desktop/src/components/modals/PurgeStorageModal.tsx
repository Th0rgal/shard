import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import type { UnusedItemsSummary, PurgeResult } from "../../types";
import { formatFileSize } from "../../utils";

interface PurgeStorageModalProps {
  open: boolean;
  onClose: () => void;
  onPurged: (result: PurgeResult) => void;
}

type CategoryKey = "mods" | "resourcepacks" | "shaderpacks" | "skins";

interface CategoryInfo {
  key: CategoryKey;
  label: string;
  color: string;
  typeString: string;
}

const CATEGORIES: CategoryInfo[] = [
  { key: "mods", label: "Mods", color: "#7cc7ff", typeString: "mod" },
  { key: "resourcepacks", label: "Resource Packs", color: "#a78bfa", typeString: "resourcepack" },
  { key: "shaderpacks", label: "Shader Packs", color: "#f472b6", typeString: "shaderpack" },
  { key: "skins", label: "Skins", color: "#34d399", typeString: "skin" },
];

export function PurgeStorageModal({ open, onClose, onPurged }: PurgeStorageModalProps) {
  const [loading, setLoading] = useState(true);
  const [purging, setPurging] = useState(false);
  const [unused, setUnused] = useState<UnusedItemsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<CategoryKey>>(new Set());

  // Load unused items when modal opens
  useEffect(() => {
    if (!open) return;

    setLoading(true);
    setError(null);
    setSelected(new Set());

    invoke<UnusedItemsSummary>("get_unused_items_cmd")
      .then((data) => {
        setUnused(data);
        // Pre-select all categories that have unused items
        const preselected = new Set<CategoryKey>();
        if (data.mods.length > 0) preselected.add("mods");
        if (data.resourcepacks.length > 0) preselected.add("resourcepacks");
        if (data.shaderpacks.length > 0) preselected.add("shaderpacks");
        if (data.skins.length > 0) preselected.add("skins");
        setSelected(preselected);
      })
      .catch((err) => {
        setError(String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [open]);

  const toggleCategory = (key: CategoryKey) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getSelectedCount = () => {
    if (!unused) return 0;
    let count = 0;
    if (selected.has("mods")) count += unused.mods.length;
    if (selected.has("resourcepacks")) count += unused.resourcepacks.length;
    if (selected.has("shaderpacks")) count += unused.shaderpacks.length;
    if (selected.has("skins")) count += unused.skins.length;
    return count;
  };

  const getSelectedBytes = () => {
    if (!unused) return 0;
    let bytes = 0;
    if (selected.has("mods")) {
      bytes += unused.mods.reduce((sum, item) => sum + (item.file_size ?? 0), 0);
    }
    if (selected.has("resourcepacks")) {
      bytes += unused.resourcepacks.reduce((sum, item) => sum + (item.file_size ?? 0), 0);
    }
    if (selected.has("shaderpacks")) {
      bytes += unused.shaderpacks.reduce((sum, item) => sum + (item.file_size ?? 0), 0);
    }
    if (selected.has("skins")) {
      bytes += unused.skins.reduce((sum, item) => sum + (item.file_size ?? 0), 0);
    }
    return bytes;
  };

  const handlePurge = async () => {
    if (selected.size === 0) return;

    setPurging(true);
    setError(null);

    try {
      const contentTypes = Array.from(selected).map(
        (key) => CATEGORIES.find((c) => c.key === key)!.typeString
      );
      const result = await invoke<PurgeResult>("purge_unused_items_cmd", {
        contentTypes,
      });
      onPurged(result);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setPurging(false);
    }
  };

  const getCategoryItems = (key: CategoryKey): number => {
    if (!unused) return 0;
    return unused[key].length;
  };

  const getCategoryBytes = (key: CategoryKey): number => {
    if (!unused) return 0;
    return unused[key].reduce((sum, item) => sum + (item.file_size ?? 0), 0);
  };

  const selectedCount = getSelectedCount();
  const selectedBytes = getSelectedBytes();

  return (
    <Modal open={open} onClose={onClose} title="Clean Unused Content">
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {loading && (
          <div className="purge-loading">
            <svg className="spin" width="20" height="20" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="2" strokeDasharray="28" strokeDashoffset="8" />
            </svg>
            <span>Scanning for unused content...</span>
          </div>
        )}

        {error && (
          <div className="purge-error">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 5v4M8 11h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && unused && unused.total_count === 0 && (
          <div className="purge-empty">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M9 12l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
              <circle cx="12" cy="12" r="10" />
            </svg>
            <p>No unused content found</p>
            <span>All items in your library are currently used by at least one profile.</span>
          </div>
        )}

        {!loading && !error && unused && unused.total_count > 0 && (
          <>
            <p className="purge-description">
              Select which categories of unused content to remove. Items that are not used by any profile will be permanently deleted.
            </p>

            <div className="purge-categories">
              {CATEGORIES.map((cat) => {
                const count = getCategoryItems(cat.key);
                const bytes = getCategoryBytes(cat.key);
                const isSelected = selected.has(cat.key);
                const isEmpty = count === 0;

                return (
                  <button
                    key={cat.key}
                    className={`purge-category ${isSelected ? "selected" : ""} ${isEmpty ? "empty" : ""}`}
                    onClick={() => !isEmpty && toggleCategory(cat.key)}
                    disabled={isEmpty}
                  >
                    <div className="purge-category-check">
                      {isSelected ? (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <rect x="1" y="1" width="14" height="14" rx="3" fill="currentColor" />
                          <path d="M4.5 8l2.5 2.5 4.5-5" stroke="var(--bg-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                          <rect x="1.5" y="1.5" width="13" height="13" rx="2.5" stroke="currentColor" />
                        </svg>
                      )}
                    </div>
                    <span className="purge-category-dot" style={{ background: isEmpty ? "var(--text-muted)" : cat.color }} />
                    <span className="purge-category-label">{cat.label}</span>
                    <span className="purge-category-count">
                      {isEmpty ? "None" : `${count} item${count !== 1 ? "s" : ""}`}
                    </span>
                    {!isEmpty && bytes > 0 && (
                      <span className="purge-category-size">{formatFileSize(bytes)}</span>
                    )}
                  </button>
                );
              })}
            </div>

            {selectedCount > 0 && (
              <div className="purge-summary">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 4h12M5 4V3a1 1 0 011-1h4a1 1 0 011 1v1M13 4v9a1 1 0 01-1 1H4a1 1 0 01-1-1V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>
                  Will delete <strong>{selectedCount}</strong> item{selectedCount !== 1 ? "s" : ""}, freeing{" "}
                  <strong>{formatFileSize(selectedBytes)}</strong>
                </span>
              </div>
            )}
          </>
        )}

        <ModalFooter
          onCancel={onClose}
          onSubmit={handlePurge}
          cancelLabel="Cancel"
          submitLabel={purging ? "Deleting..." : "Delete Selected"}
          submitDisabled={loading || purging || selectedCount === 0}
          tone="danger"
        />
      </div>
    </Modal>
  );
}
