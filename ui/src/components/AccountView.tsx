import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "../store";
import { SkinViewer, type AnimationType, type ModelVariant } from "./SkinViewer";
import { Field } from "./Field";
import type { AccountInfo, Cape, Account } from "../types";
import { preloadCapeTextures } from "../lib/player-model";

// Local storage key for skin library
const SKIN_LIBRARY_KEY = "shard:skin-library";

interface SkinLibraryItem {
  url: string;
  name: string;
  variant: ModelVariant;
  addedAt: number;
}

// Animation options with labels
const ANIMATION_OPTIONS: { value: AnimationType; label: string; icon: string }[] = [
  { value: "idle", label: "Idle", icon: "M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" },
  { value: "walk", label: "Walk", icon: "M13 4v2l3.5 3.5L13 13v2l5-5-5-5Z M11 4v2L7.5 9.5 11 13v2l-5-5 5-5Z" },
  { value: "run", label: "Run", icon: "M13 4v2l4 4-4 4v2l6-6-6-6Z M5 4v2l4 4-4 4v2l6-6-6-6Z" },
  { value: "wave", label: "Wave", icon: "M7 11v-1a1 1 0 0 1 2 0v1M10 11V9a1 1 0 0 1 2 0v2m0 0v1m0-1a1 1 0 0 1 2 0v1m0 0v1a1 1 0 0 1-2 0m2-1a1 1 0 0 1 2 0v1a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3v-2a1 1 0 0 1 1-1" },
  { value: "crouch", label: "Crouch", icon: "M6 18h12M8 14l4 4 4-4M12 4v14" },
  { value: "fly", label: "Fly", icon: "M12 19V5M5 12l7-7 7 7" },
];

interface AccountViewProps {
  onAddAccount: () => void;
}

export function AccountView({ onAddAccount }: AccountViewProps) {
  const { accounts, loadAccounts, notify, runAction, getActiveAccount } = useAppStore();
  const activeAccount = getActiveAccount();

  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"skin" | "library" | "capes">("skin");
  const [uploading, setUploading] = useState(false);
  const [skinVariant, setSkinVariant] = useState<ModelVariant>("classic");
  const [skinUrl, setSkinUrl] = useState("");
  const [skinLibrary, setSkinLibrary] = useState<SkinLibraryItem[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [animation, setAnimation] = useState<AnimationType>("walk");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load skin library from local storage
  useEffect(() => {
    try {
      const stored = localStorage.getItem(SKIN_LIBRARY_KEY);
      if (stored) {
        setSkinLibrary(JSON.parse(stored));
      }
    } catch {
      // Ignore parse errors
    }
  }, []);

  // Save skin to library
  const addToLibrary = useCallback((url: string, name: string, variant: ModelVariant) => {
    setSkinLibrary((prev) => {
      // Don't add duplicates
      if (prev.some((item) => item.url === url)) {
        return prev;
      }
      const newLibrary = [{ url, name, variant, addedAt: Date.now() }, ...prev].slice(0, 20); // Max 20 items
      localStorage.setItem(SKIN_LIBRARY_KEY, JSON.stringify(newLibrary));
      return newLibrary;
    });
  }, []);

  // Remove from library
  const removeFromLibrary = useCallback((url: string) => {
    setSkinLibrary((prev) => {
      const newLibrary = prev.filter((item) => item.url !== url);
      localStorage.setItem(SKIN_LIBRARY_KEY, JSON.stringify(newLibrary));
      return newLibrary;
    });
  }, []);

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
      // Add current skin to library if it has a URL
      if (activeSkin?.url) {
        addToLibrary(activeSkin.url, data.username, (activeSkin.variant as ModelVariant) || "classic");
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
  }, [addToLibrary]);

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
      await invoke("upload_skin_cmd", {
        id: activeAccount.uuid,
        path: file,
        variant: skinVariant,
      });
      await loadAccountInfo(activeAccount.uuid);
      notify("Skin uploaded successfully");
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

  const handleApplyLibrarySkin = async (item: SkinLibraryItem) => {
    if (!activeAccount) return;

    setSkinVariant(item.variant);
    setUploading(true);
    try {
      await invoke("set_skin_url_cmd", {
        id: activeAccount.uuid,
        url: item.url,
        variant: item.variant,
      });
      await loadAccountInfo(activeAccount.uuid);
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
      <div className="view-transition">
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
    <div className="view-transition account-view">
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
              <div className="account-selector-dropdown-header">Switch Account</div>
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
              animation={animation}
              animationSpeed={0.8}
            />
            {/* Animation selector below viewer */}
            <div className="account-animation-controls">
              <div className="account-animation-selector">
                {ANIMATION_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    className={`account-animation-btn ${animation === opt.value ? "active" : ""}`}
                    onClick={() => setAnimation(opt.value)}
                    title={opt.label}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d={opt.icon} />
                    </svg>
                    {animation === opt.value && (
                      <span className="account-animation-label">{opt.label}</span>
                    )}
                  </button>
                ))}
              </div>
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
                  {/* Variant selector */}
                  <Field label="Model Type">
                    <div className="account-variant-selector">
                      <button
                        className={`account-variant-btn ${skinVariant === "classic" ? "active" : ""}`}
                        onClick={() => setSkinVariant("classic")}
                      >
                        <div className="account-variant-icon">
                          <svg width="20" height="32" viewBox="0 0 20 32" fill="currentColor" opacity="0.8">
                            <rect x="4" y="0" width="12" height="12" rx="1" />
                            <rect x="4" y="13" width="12" height="12" rx="1" />
                            <rect x="0" y="13" width="3" height="12" rx="1" />
                            <rect x="17" y="13" width="3" height="12" rx="1" />
                            <rect x="4" y="26" width="5" height="6" rx="1" />
                            <rect x="11" y="26" width="5" height="6" rx="1" />
                          </svg>
                        </div>
                        <span>Classic</span>
                        <span className="account-variant-hint">Standard arms</span>
                      </button>
                      <button
                        className={`account-variant-btn ${skinVariant === "slim" ? "active" : ""}`}
                        onClick={() => setSkinVariant("slim")}
                      >
                        <div className="account-variant-icon">
                          <svg width="20" height="32" viewBox="0 0 20 32" fill="currentColor" opacity="0.8">
                            <rect x="4" y="0" width="12" height="12" rx="1" />
                            <rect x="4" y="13" width="12" height="12" rx="1" />
                            <rect x="1" y="13" width="2" height="12" rx="1" />
                            <rect x="17" y="13" width="2" height="12" rx="1" />
                            <rect x="4" y="26" width="5" height="6" rx="1" />
                            <rect x="11" y="26" width="5" height="6" rx="1" />
                          </svg>
                        </div>
                        <span>Slim</span>
                        <span className="account-variant-hint">Thinner arms</span>
                      </button>
                    </div>
                  </Field>

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
                  {skinLibrary.length === 0 ? (
                    <div className="account-library-empty">
                      <p>Your skin library is empty</p>
                      <p className="hint">Skins you upload or apply will appear here for quick access.</p>
                    </div>
                  ) : (
                    <div className="account-library-grid">
                      {skinLibrary.map((item) => (
                        <div key={item.url} className="account-library-item">
                          <img
                            src={`https://mc-heads.net/body/${encodeURIComponent(item.url)}/100`}
                            alt={item.name}
                            onError={(e) => {
                              // Fallback to just showing the skin texture
                              e.currentTarget.src = item.url;
                            }}
                          />
                          <div className="account-library-item-info">
                            <span className="account-library-item-name">{item.name}</span>
                            <span className="account-library-item-variant">{item.variant}</span>
                          </div>
                          <div className="account-library-item-actions">
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleApplyLibrarySkin(item)}
                              disabled={uploading}
                            >
                              Apply
                            </button>
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={() => removeFromLibrary(item.url)}
                              title="Remove from library"
                            >
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                                <path d="M2 2l8 8M10 2l-8 8" />
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
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
