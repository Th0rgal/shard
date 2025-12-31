import { useState, useEffect, useCallback } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "../Modal";
import { SkinViewer } from "../SkinViewer";
import { Field } from "../Field";
import type { AccountInfo, Cape, LibraryItem, LibraryFilter } from "../../types";

interface AccountDetailsModalProps {
  open: boolean;
  accountId: string | null;
  onClose: () => void;
}

type Tab = "skin" | "capes";

export function AccountDetailsModal({ open: isOpen, accountId, onClose }: AccountDetailsModalProps) {
  const [info, setInfo] = useState<AccountInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("skin");
  const [uploading, setUploading] = useState(false);
  const [skinVariant, setSkinVariant] = useState<"classic" | "slim">("classic");
  const [librarySkins, setLibrarySkins] = useState<LibraryItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [selectedLibrarySkin, setSelectedLibrarySkin] = useState<LibraryItem | null>(null);
  const [skinSearch, setSkinSearch] = useState("");

  const loadAccountInfo = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await invoke<AccountInfo>("get_account_info_cmd", { id: accountId });
      setInfo(data);
      // Set variant from current skin
      const activeSkin = data.profile?.skins?.find(s => s.state === "ACTIVE");
      if (activeSkin?.variant) {
        setSkinVariant(activeSkin.variant as "classic" | "slim");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  const loadLibrarySkins = useCallback(async () => {
    setLoadingLibrary(true);
    try {
      const filter: LibraryFilter = {
        content_type: "skin",
        limit: 50,
      };
      const items = await invoke<LibraryItem[]>("library_list_items_cmd", { filter });
      setLibrarySkins(items);
    } catch (err) {
      console.error("Failed to load library skins:", err);
    } finally {
      setLoadingLibrary(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen && accountId) {
      void loadAccountInfo();
      void loadLibrarySkins();
      setSelectedLibrarySkin(null);
      setSkinSearch("");
    }
  }, [isOpen, accountId, loadAccountInfo, loadLibrarySkins]);

  const handleUploadSkin = async () => {
    if (!accountId) return;

    const file = await open({
      filters: [{ name: "PNG Image", extensions: ["png"] }],
      multiple: false,
    });

    if (!file) return;

    setUploading(true);
    try {
      await invoke("upload_skin_cmd", {
        id: accountId,
        path: file,
        variant: skinVariant,
        save_to_library: true,
      });
      await loadAccountInfo();
      await loadLibrarySkins();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleApplyLibrarySkin = async () => {
    if (!accountId || !selectedLibrarySkin) return;

    setUploading(true);
    try {
      await invoke("apply_library_skin_cmd", {
        id: accountId,
        item_id: selectedLibrarySkin.id,
        variant: skinVariant,
      });
      await loadAccountInfo();
      setSelectedLibrarySkin(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleResetSkin = async () => {
    if (!accountId) return;

    setUploading(true);
    try {
      await invoke("reset_skin_cmd", { id: accountId });
      await loadAccountInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleSetCape = async (capeId: string) => {
    if (!accountId) return;

    setUploading(true);
    try {
      await invoke("set_cape_cmd", { id: accountId, capeId });
      await loadAccountInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  const handleHideCape = async () => {
    if (!accountId) return;

    setUploading(true);
    try {
      await invoke("hide_cape_cmd", { id: accountId });
      await loadAccountInfo();
    } catch (err) {
      setError(String(err));
    } finally {
      setUploading(false);
    }
  };

  if (!isOpen) return null;

  const activeSkin = info?.profile?.skins?.find((s) => s.state === "ACTIVE");
  const activeCape = info?.profile?.capes?.find((c) => c.state === "ACTIVE");
  const activeSkinUrl = activeSkin?.url || info?.skin_url || "";
  const activeCapeUrl = activeCape?.url ?? (info?.profile ? null : info?.cape_url ?? null);

  return (
    <Modal open={isOpen} onClose={onClose} className="modal-lg">
      <h2 className="modal-title">{info?.username ?? "Account"}</h2>

      {loading && (
        <div style={{ textAlign: "center", padding: 40 }}>
          <div className="skin-viewer-loading" />
          <p style={{ marginTop: 16, color: "var(--text-secondary)" }}>Loading account info...</p>
        </div>
      )}

      {error && !loading && (
        <div
          style={{
            background: "rgba(248, 113, 113, 0.1)",
            border: "1px solid rgba(248, 113, 113, 0.2)",
            borderRadius: 12,
            padding: 16,
            marginBottom: 24,
          }}
        >
          <p style={{ color: "var(--accent-danger)", margin: 0, fontSize: 14 }}>{error}</p>
        </div>
      )}

      {info && !loading && (
        <div style={{ display: "flex", gap: 32 }}>
          {/* 3D Skin Viewer */}
          <div style={{ flexShrink: 0 }}>
            <SkinViewer
              skinUrl={activeSkinUrl}
              capeUrl={activeCapeUrl}
              width={200}
              height={320}
              animation="mixed"
            />
          </div>

          {/* Controls */}
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* Tab switcher */}
            <div className="content-tabs" style={{ marginBottom: 20 }}>
              <button
                className={clsx("content-tab", tab === "skin" && "active")}
                onClick={() => setTab("skin")}
              >
                Skin
                {librarySkins.length > 0 && (
                  <span className="count">{librarySkins.length}</span>
                )}
              </button>
              <button
                className={clsx("content-tab", tab === "capes" && "active")}
                onClick={() => setTab("capes")}
              >
                Capes
                {(info.profile?.capes?.length ?? 0) > 0 && (
                  <span className="count">{info.profile?.capes?.length}</span>
                )}
              </button>
            </div>

            {tab === "skin" && (
              <div>
                {/* Search and upload row */}
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <input
                    type="text"
                    className="input"
                    placeholder="Search skins..."
                    value={skinSearch}
                    onChange={(e) => setSkinSearch(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn btn-secondary"
                    onClick={handleUploadSkin}
                    disabled={uploading}
                    title="Add Skin to Library"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                      <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>

                {/* Library grid */}
                {loadingLibrary ? (
                  <p style={{ color: "var(--text-muted)", fontSize: 13, textAlign: "center", padding: 20 }}>Loading skins...</p>
                ) : librarySkins.length === 0 ? (
                  <div style={{ textAlign: "center", padding: 24, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.3, marginBottom: 12 }}>
                      <rect x="8" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                      <rect x="8" y="12" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                      <rect x="4" y="12" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                      <rect x="16" y="12" width="4" height="6" rx="1" stroke="currentColor" strokeWidth="1.5" />
                    </svg>
                    <p style={{ color: "var(--text-muted)", fontSize: 13, marginBottom: 12 }}>
                      No skins in library yet
                    </p>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={handleUploadSkin}
                      disabled={uploading}
                    >
                      {uploading ? "Uploading..." : "Upload Your First Skin"}
                    </button>
                  </div>
                ) : (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(3, 1fr)",
                      gap: 8,
                      maxHeight: 180,
                      overflowY: "auto",
                      marginBottom: 12,
                    }}
                  >
                    {librarySkins
                      .filter((skin) => !skinSearch || skin.name.toLowerCase().includes(skinSearch.toLowerCase()))
                      .map((skin) => (
                      <div
                        key={skin.id}
                        onClick={() => setSelectedLibrarySkin(selectedLibrarySkin?.id === skin.id ? null : skin)}
                        style={{
                          padding: 8,
                          borderRadius: 8,
                          cursor: "pointer",
                          textAlign: "center",
                          background: selectedLibrarySkin?.id === skin.id
                            ? "rgba(232, 168, 85, 0.15)"
                            : "rgba(255, 255, 255, 0.03)",
                          border: selectedLibrarySkin?.id === skin.id
                            ? "1px solid rgba(232, 168, 85, 0.3)"
                            : "1px solid var(--border-subtle)",
                          transition: "all 0.15s ease",
                        }}
                        title={skin.name}
                      >
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            margin: "0 auto 6px",
                            background: "rgba(255, 255, 255, 0.05)",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.4 }}>
                            <rect x="8" y="4" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                            <rect x="8" y="12" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </div>
                        <div style={{
                          fontSize: 10,
                          color: "var(--text-primary)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}>
                          {skin.name}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Apply section */}
                {selectedLibrarySkin && (
                  <div style={{ marginTop: 12, padding: 12, background: "rgba(255,255,255,0.02)", borderRadius: 10, border: "1px solid var(--border-subtle)" }}>
                    <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
                      <button
                        className={clsx("btn btn-secondary btn-sm", skinVariant === "classic" && "active")}
                        onClick={() => setSkinVariant("classic")}
                        style={{
                          flex: 1,
                          background: skinVariant === "classic" ? "rgba(232, 168, 85, 0.15)" : undefined,
                          borderColor: skinVariant === "classic" ? "rgba(232, 168, 85, 0.3)" : undefined,
                        }}
                      >
                        Classic
                      </button>
                      <button
                        className={clsx("btn btn-secondary btn-sm", skinVariant === "slim" && "active")}
                        onClick={() => setSkinVariant("slim")}
                        style={{
                          flex: 1,
                          background: skinVariant === "slim" ? "rgba(232, 168, 85, 0.15)" : undefined,
                          borderColor: skinVariant === "slim" ? "rgba(232, 168, 85, 0.3)" : undefined,
                        }}
                      >
                        Slim
                      </button>
                    </div>
                    <button
                      className="btn btn-primary"
                      onClick={handleApplyLibrarySkin}
                      disabled={uploading}
                      style={{ width: "100%" }}
                    >
                      {uploading ? "Applying..." : `Apply "${selectedLibrarySkin.name}"`}
                    </button>
                  </div>
                )}

                {/* Reset option */}
                <div style={{ marginTop: 12, textAlign: "center" }}>
                  <button
                    className="btn btn-ghost btn-sm"
                    onClick={handleResetSkin}
                    disabled={uploading}
                    style={{ color: "var(--text-muted)", fontSize: 11 }}
                  >
                    Reset to default
                  </button>
                </div>
              </div>
            )}

            {tab === "capes" && (
              <div>
                {(info.profile?.capes?.length ?? 0) === 0 ? (
                  <div
                    style={{
                      textAlign: "center",
                      padding: 32,
                      color: "var(--text-secondary)",
                    }}
                  >
                    <p>No capes available for this account.</p>
                    <p style={{ fontSize: 12, marginTop: 8, color: "var(--text-muted)" }}>
                      Capes are obtained through Minecraft events, purchases, or promotions.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {(info.profile?.capes ?? []).map((cape: Cape) => (
                      <div
                        key={cape.id}
                        className="content-item"
                        style={{
                          background:
                            cape.state === "ACTIVE"
                              ? "rgba(232, 168, 85, 0.1)"
                              : undefined,
                          borderColor:
                            cape.state === "ACTIVE"
                              ? "rgba(232, 168, 85, 0.2)"
                              : undefined,
                        }}
                      >
                        <div className="content-item-info">
                          <h5>{cape.alias ?? cape.id}</h5>
                          {cape.state === "ACTIVE" && (
                            <p style={{ color: "var(--accent-primary)" }}>Currently active</p>
                          )}
                        </div>
                        <div className="content-item-actions" style={{ opacity: 1 }}>
                          {cape.state === "ACTIVE" ? (
                            <button
                              className="btn btn-ghost btn-sm"
                              onClick={handleHideCape}
                              disabled={uploading}
                            >
                              Hide
                            </button>
                          ) : (
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={() => handleSetCape(cape.id)}
                              disabled={uploading}
                            >
                              Equip
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="modal-footer">
        <button className="btn btn-secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
