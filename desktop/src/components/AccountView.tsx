import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import { SkinViewer, type ModelVariant } from "./SkinViewer";
import { Field } from "./Field";
import type { AccountInfo, Cape, Account, LibraryItem, LibraryFilter } from "../types";
import { preloadCapeTextures } from "../lib/player-model";

// Extended library item with resolved skin URL
interface SkinLibraryItemWithUrl extends LibraryItem {
  resolvedUrl?: string;
}

interface AccountViewProps {
  onAddAccount: () => void;
}

export function AccountView({ onAddAccount }: AccountViewProps) {
  const { accounts, loadAccounts, notify, runAction, getActiveAccount } = useAppStore();
  const activeAccount = getActiveAccount();

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"skin" | "library" | "capes">("library"); // Default to library
  const [uploading, setUploading] = useState(false);
  const [skinVariant, setSkinVariant] = useState<ModelVariant>("classic");
  const [skinUrl, setSkinUrl] = useState("");
  const [skinLibrary, setSkinLibrary] = useState<SkinLibraryItemWithUrl[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [librarySearch, setLibrarySearch] = useState("");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [selectedSkin, setSelectedSkin] = useState<SkinLibraryItemWithUrl | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load skin library from SQLite database
  const loadSkinLibrary = useCallback(async (search?: string) => {
    setLibraryLoading(true);
    try {
      const filter: LibraryFilter = {
        content_type: "skin",
        search: search || undefined,
        limit: 50,
      };
      const items = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });

      // Resolve file paths to asset URLs for each skin
      const itemsWithUrls: SkinLibraryItemWithUrl[] = await Promise.all(
        items.map(async (item) => {
          try {
            const path = await invoke<string | null>("library_get_item_path_cmd", { id: item.id });
            return {
              ...item,
              resolvedUrl: path ? convertFileSrc(path) : item.source_url || "",
            };
          } catch {
            return { ...item, resolvedUrl: item.source_url || "" };
          }
        })
      );

      setSkinLibrary(itemsWithUrls);
    } catch (err) {
      console.error("Failed to load skin library:", err);
    } finally {
      setLibraryLoading(false);
    }
  }, []);

  // Load skin library on mount
  useEffect(() => {
    void loadSkinLibrary();
  }, [loadSkinLibrary]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      void loadSkinLibrary(librarySearch);
    }, 300);
    return () => clearTimeout(timer);
  }, [librarySearch, loadSkinLibrary]);

  // Remove from library
  const removeFromLibrary = useCallback(async (item: SkinLibraryItemWithUrl) => {
    try {
      await invoke("library_delete_item_cmd", { id: item.id, deleteFile: true });
      await loadSkinLibrary(librarySearch);
      if (selectedSkin?.id === item.id) {
        setSelectedSkin(null);
      }
      notify("Skin removed from library");
    } catch (err) {
      notify("Failed to remove skin", String(err));
    }
  }, [loadSkinLibrary, librarySearch, selectedSkin, notify]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const loadAccountInfo = useCallback(async (accountId: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<AccountInfo>("get_account_info_cmd", { id: accountId });
      setInfo(data);
      // Set variant from current skin
      const activeSkin = data.profile?.skins?.find((s) => s.state === "ACTIVE");
      if (activeSkin?.variant) {
        setSkinVariant(activeSkin.variant as ModelVariant);
      }
      // Preload all cape textures for instant switching
      const capeUrls = data.profile?.capes?.map((c) => c.url).filter(Boolean) ?? [];
      if (capeUrls.length > 0) {
        preloadCapeTextures(capeUrls).catch(() => {
          // Silently ignore preload failures
        });
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load account info when active account changes
  useEffect(() => {
    if (activeAccount?.uuid) {
      void loadAccountInfo(activeAccount.uuid);
    } else {
      setInfo(null);
    }
  }, [activeAccount?.uuid, loadAccountInfo]);

  const handleSetActiveAccount = async (id: string) => {
    setDropdownOpen(false);
    await runAction(async () => {
      await invoke("set_active_account_cmd", { id });
      await loadAccounts();
      useAppStore.setState({ selectedAccountId: id });
    });
  };

  const handleRemoveAccount = async (account: Account) => {
    if (!confirm(`Remove ${account.username}? This account will be disconnected from Shard.`)) {
      return;
    }
    await runAction(async () => {
      await invoke("remove_account_cmd", { id: account.uuid });
      await loadAccounts();
    });
  };

  const handleUploadSkin = async () => {
    if (!activeAccount) return;

    const file = await open({
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      multiple: false,
    });

    if (!file) return;

    setUploading(true);
    try {
      // Upload skin and save to library (save_to_library defaults to true)
      await invoke("upload_skin_cmd", {
        id: activeAccount.uuid,
        path: file,
        variant: skinVariant,
        saveToLibrary: true,
      });
      await loadAccountInfo(activeAccount.uuid);
      await loadSkinLibrary(librarySearch); // Refresh library
      notify("Skin uploaded and added to library");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSetSkinUrl = async () => {
    if (!activeAccount || !skinUrl.trim()) return;

    setUploading(true);
    try {
      await invoke("set_skin_url_cmd", {
        id: activeAccount.uuid,
        url: skinUrl.trim(),
        variant: skinVariant,
      });
      await loadAccountInfo(activeAccount.uuid);
      setSkinUrl("");
      notify("Skin updated successfully");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleApplyLibrarySkin = async (item: SkinLibraryItemWithUrl) => {
    if (!activeAccount) return;

    setUploading(true);
    try {
      // Use apply_library_skin_cmd to apply from library
      await invoke("apply_library_skin_cmd", {
        id: activeAccount.uuid,
        itemId: item.id,
        variant: skinVariant,
      });
      await loadAccountInfo(activeAccount.uuid);
      setSelectedSkin(item);
      notify("Skin applied successfully");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleResetSkin = async () => {
    if (!activeAccount) return;

    setUploading(true);
    try {
      await invoke("reset_skin_cmd", { id: activeAccount.uuid });
      await loadAccountInfo(activeAccount.uuid);
      notify("Skin reset to default");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSetCape = async (capeId: string) => {
    if (!activeAccount) return;

    setUploading(true);
    try {
      await invoke("set_cape_cmd", { id: activeAccount.uuid, capeId });
      await loadAccountInfo(activeAccount.uuid);
      notify("Cape equipped");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleHideCape = async () => {
    if (!activeAccount) return;

    setUploading(true);
    try {
      await invoke("hide_cape_cmd", { id: activeAccount.uuid });
      await loadAccountInfo(activeAccount.uuid);
      notify("Cape hidden");
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const activeSkin = info?.profile?.skins?.find((s) => s.state === "ACTIVE");
  const activeCape = info?.profile?.capes?.find((c) => c.state === "ACTIVE");
  const activeSkinUrl = activeSkin?.url || info?.skin_url || "";
  const activeCapeUrl = activeCape?.url ?? (info?.profile ? null : info?.cape_url ?? null);

  // Get avatar URL from mc-heads.net
  const getAvatarUrl = (uuid: string) => {
    const cleanUuid = uuid.replace(/-/g, "");
    return `https://mc-heads.net/avatar/${cleanUuid}/64`;
  };

  if (!accounts || accounts.accounts.length === 0) {
    return (
      <div className="view-transition" >
        <h1 className="page-title">Account</h1>
        <div className="account-empty-state">
          <div className="account-empty-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <h3>No accounts connected</h3>
          <p>Add a Microsoft account to play Minecraft and customize your appearance.</p>
          <button className="btn btn-primary" onClick={onAddAccount}>
            Add Microsoft Account
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="view-transition account-view" >
      {/* Account Selector Header */}
      <div className="account-header">
        <div className="account-selector" ref={dropdownRef}>
          <button
            className="account-selector-trigger"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            {activeAccount && (
              <>
                <img
                  className="account-selector-avatar"
                  src={getAvatarUrl(activeAccount.uuid)}
                  alt={activeAccount.username}
                />
                <div className="account-selector-info">
                  <span className="account-selector-name">{activeAccount.username}</span>
                  <span className="account-selector-hint">Click to switch accounts</span>
                </div>
                <svg className="account-selector-chevron" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" />
                </svg>
              </>
            )}
          </button>

          {dropdownOpen && (
            <div className="account-selector-dropdown">
              {accounts.accounts.map((account) => (
                <button
                  key={account.uuid}
                  className={`account-selector-option ${account.uuid === activeAccount?.uuid ? "active" : ""}`}
                  onClick={() => handleSetActiveAccount(account.uuid)}
                >
                  <img
                    className="account-selector-option-avatar"
                    src={getAvatarUrl(account.uuid)}
                    alt={account.username}
                  />
                  <div className="account-selector-option-info">
                    <span className="account-selector-option-name">{account.username}</span>
                    <span className="account-selector-option-uuid">{account.uuid.slice(0, 8)}...</span>
                  </div>
                  {account.uuid === activeAccount?.uuid && (
                    <svg className="account-selector-check" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                      <path d="M13.5 4.5l-7 7-3-3" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  <button
                    className="account-selector-remove"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleRemoveAccount(account);
                    }}
                    title="Remove account"
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M3 3l8 8M11 3l-8 8" />
                    </svg>
                  </button>
                </button>
              ))}
              <div className="account-selector-dropdown-divider" />
              <button className="account-selector-add" onClick={onAddAccount}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                Add another account
              </button>
            </div>
          )}
        </div>
      </div>

      {loading && (
        <div className="account-loading">
          <div className="skin-viewer-loading" />
          <p>Loading account info...</p>
        </div>
      )}

      {error && !loading && (
        <div className="account-error">
          <p>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={() => activeAccount && loadAccountInfo(activeAccount.uuid)}>
            Retry
          </button>
        </div>
      )}

      {info && !loading && (
        <div className="account-content">
          {/* 3D Skin Viewer */}
          <div className="account-viewer">
            <SkinViewer
              skinUrl={activeSkinUrl}
              capeUrl={activeCapeUrl}
              model={skinVariant}
              width={280}
              height={400}
              animation="idle"
              animationSpeed={0.6}
            />
            {/* Simple variant toggle below viewer */}
            <div className="account-viewer-variant">
              <button
                className={`account-viewer-variant-btn ${skinVariant === "classic" ? "active" : ""}`}
                onClick={() => setSkinVariant("classic")}
                title="Classic (4px arms)"
              >
                <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
                  <rect x="3" y="0" width="8" height="8" rx="1" />
                  <rect x="3" y="9" width="8" height="7" rx="1" />
                  <rect x="0" y="9" width="2" height="7" rx="0.5" />
                  <rect x="12" y="9" width="2" height="7" rx="0.5" />
                </svg>
              </button>
              <button
                className={`account-viewer-variant-btn ${skinVariant === "slim" ? "active" : ""}`}
                onClick={() => setSkinVariant("slim")}
                title="Slim (3px arms)"
              >
                <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor">
                  <rect x="3" y="0" width="8" height="8" rx="1" />
                  <rect x="3" y="9" width="8" height="7" rx="1" />
                  <rect x="0.5" y="9" width="1.5" height="7" rx="0.5" />
                  <rect x="12" y="9" width="1.5" height="7" rx="0.5" />
                </svg>
              </button>
            </div>
          </div>

          {/* Customization Panel */}
          <div className="account-panel">
            {/* Tab switcher */}
            <div className="account-tabs">
              <button
                className={`account-tab ${tab === "skin" ? "active" : ""}`}
                onClick={() => setTab("skin")}
              >
                Skin
              </button>
              <button
                className={`account-tab ${tab === "library" ? "active" : ""}`}
                onClick={() => setTab("library")}
              >
                Library
                {skinLibrary.length > 0 && <span className="account-tab-count">{skinLibrary.length}</span>}
              </button>
              <button
                className={`account-tab ${tab === "capes" ? "active" : ""}`}
                onClick={() => setTab("capes")}
              >
                Capes
                {(info.profile?.capes?.length ?? 0) > 0 && (
                  <span className="account-tab-count">{info.profile?.capes?.length}</span>
                )}
              </button>
            </div>

            <div className="account-tab-content">
              {tab === "skin" && (
                <div className="account-skin-tab">
                  {/* Upload section */}
                  <div className="account-upload-section">
                    <button
                      className="btn btn-primary account-upload-btn"
                      onClick={handleUploadSkin}
                      disabled={uploading}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M14 10v3a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3M8 2v8M4 6l4-4 4 4" />
                      </svg>
                      {uploading ? "Uploading..." : "Upload Skin File"}
                    </button>
                    <p className="account-upload-hint">64x64 or 64x32 PNG file</p>
                  </div>

                  {/* URL section */}
                  <Field label="Or set from URL">
                    <div className="account-url-input">
                      <input
                        type="text"
                        className="input"
                        placeholder="https://..."
                        value={skinUrl}
                        onChange={(e) => setSkinUrl(e.target.value)}
                      />
                      <button
                        className="btn btn-secondary"
                        onClick={handleSetSkinUrl}
                        disabled={!skinUrl.trim() || uploading}
                      >
                        Apply
                      </button>
                    </div>
                  </Field>

                  {/* Reset */}
                  <button
                    className="btn btn-ghost account-reset-btn"
                    onClick={handleResetSkin}
                    disabled={uploading}
                  >
                    Reset to default skin
                  </button>
                </div>
              )}

              {tab === "library" && (
                <div className="account-library-tab">
                  {/* Search bar */}
                  <div className="account-library-search">
                    <svg className="account-library-search-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="M10.5 10.5L14 14" />
                    </svg>
                    <input
                      type="text"
                      className="input"
                      placeholder="Search skins..."
                      value={librarySearch}
                      onChange={(e) => setLibrarySearch(e.target.value)}
                    />
                    {librarySearch && (
                      <button
                        className="account-library-search-clear"
                        onClick={() => setLibrarySearch("")}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M2 2l8 8M10 2l-8 8" />
                        </svg>
                      </button>
                    )}
                  </div>

                  {/* Upload button in library tab for quick access */}
                  <button
                    className="btn btn-secondary account-library-upload-btn"
                    onClick={handleUploadSkin}
                    disabled={uploading}
                  >
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M12 9v2.5a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9M7 2v7M4 5l3-3 3 3" />
                    </svg>
                    Add Skin to Library
                  </button>

                  {libraryLoading ? (
                    <div className="account-library-loading">
                      <div className="skin-viewer-loading" />
                      <p>Loading skins...</p>
                    </div>
                  ) : skinLibrary.length === 0 ? (
                    <div className="account-library-empty">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.4">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                      <p>No skins in library</p>
                      <p className="hint">Upload skins to build your collection for quick switching.</p>
                    </div>
                  ) : (
                    <div className="account-library-grid-v2">
                      {skinLibrary.map((item) => {
                        const isSelected = selectedSkin?.id === item.id;
                        return (
                          <div
                            key={item.id}
                            className={`account-library-card ${isSelected ? "selected" : ""}`}
                            onClick={() => setSelectedSkin(isSelected ? null : item)}
                          >
                            <div className="account-library-card-preview">
                              <SkinViewer
                                skinUrl={item.resolvedUrl || ""}
                                width={80}
                                height={120}
                                animation="idle"
                                animationSpeed={0.5}
                              />
                            </div>
                            <div className="account-library-card-info">
                              <span className="account-library-card-name" title={item.name}>
                                {item.name}
                              </span>
                              <span className="account-library-card-date">
                                {new Date(item.added_at).toLocaleDateString()}
                              </span>
                            </div>
                            {isSelected && (
                              <div className="account-library-card-actions">
                                <button
                                  className="btn btn-primary btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void handleApplyLibrarySkin(item);
                                  }}
                                  disabled={uploading}
                                >
                                  Apply
                                </button>
                                <button
                                  className="btn btn-ghost btn-sm btn-icon-only"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void removeFromLibrary(item);
                                  }}
                                  title="Remove from library"
                                >
                                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
                                    <path d="M2 2l10 10M12 2l-10 10" />
                                  </svg>
                                </button>
                              </div>
                            )}
                            {isSelected && (
                              <div className="account-library-card-check">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                  <circle cx="8" cy="8" r="8" />
                                  <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {tab === "capes" && (
                <div className="account-capes-tab">
                  {(info.profile?.capes?.length ?? 0) === 0 ? (
                    <div className="account-capes-empty">
                      <p>No capes available</p>
                      <p className="hint">Capes are obtained through Minecraft events, purchases, or promotions.</p>
                    </div>
                  ) : (
                    <div className="account-capes-list">
                      {/* Show hide option if a cape is active */}
                      {activeCape && (
                        <button
                          className="account-cape-item account-cape-none"
                          onClick={handleHideCape}
                          disabled={uploading}
                        >
                          <div className="account-cape-preview">
                            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4">
                              <rect x="4" y="4" width="24" height="24" rx="2" strokeDasharray="4 2" />
                              <path d="M8 8l16 16M24 8l-16 16" />
                            </svg>
                          </div>
                          <div className="account-cape-info">
                            <span className="account-cape-name">No Cape</span>
                            <span className="account-cape-hint">Hide your cape</span>
                          </div>
                        </button>
                      )}
                      {(info.profile?.capes ?? []).map((cape: Cape) => (
                        <button
                          key={cape.id}
                          className={`account-cape-item ${cape.state === "ACTIVE" ? "active" : ""}`}
                          onClick={() => cape.state !== "ACTIVE" && handleSetCape(cape.id)}
                          disabled={uploading || cape.state === "ACTIVE"}
                        >
                          <div className="account-cape-preview">
                            <img src={cape.url} alt={cape.alias ?? cape.id} />
                          </div>
                          <div className="account-cape-info">
                            <span className="account-cape-name">{cape.alias ?? cape.id}</span>
                            {cape.state === "ACTIVE" && (
                              <span className="account-cape-active">Currently equipped</span>
                            )}
                          </div>
                          {cape.state !== "ACTIVE" && (
                            <span className="account-cape-equip">Equip</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
