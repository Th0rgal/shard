import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Modal } from "../Modal";
import { ModalFooter } from "../ModalFooter";
import { Field } from "../Field";
import { useAppStore } from "../../store";
import type { Profile, MinecraftVersionsResponse, ManifestVersion } from "../../types";

interface EditVersionModalProps {
  open: boolean;
  onClose: () => void;
  mode: "version" | "loader";
}

export function EditVersionModal({ open, onClose, mode }: EditVersionModalProps) {
  const { profile, loadProfile, notify } = useAppStore();

  // MC version state
  const [mcVersion, setMcVersion] = useState("");
  const [mcVersions, setMcVersions] = useState<ManifestVersion[]>([]);
  const [mcVersionsLoading, setMcVersionsLoading] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);

  // Loader state
  const [loaderType, setLoaderType] = useState("");
  const [loaderVersion, setLoaderVersion] = useState("");
  const [fabricVersions, setFabricVersions] = useState<string[]>([]);
  const [fabricVersionsLoading, setFabricVersionsLoading] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);

  // Load Minecraft versions
  const loadMcVersions = useCallback(async () => {
    setMcVersionsLoading(true);
    try {
      const response = await invoke<MinecraftVersionsResponse>("fetch_minecraft_versions_cmd");
      setMcVersions(response.versions);
    } catch (err) {
      console.error("Failed to load MC versions:", err);
    } finally {
      setMcVersionsLoading(false);
    }
  }, []);

  // Load Fabric versions
  const loadFabricVersions = useCallback(async () => {
    setFabricVersionsLoading(true);
    try {
      const versions = await invoke<string[]>("fetch_fabric_versions_cmd");
      setFabricVersions(versions);
    } catch (err) {
      console.error("Failed to load Fabric versions:", err);
    } finally {
      setFabricVersionsLoading(false);
    }
  }, []);

  // Initialize state from profile when modal opens
  useEffect(() => {
    if (open && profile) {
      setMcVersion(profile.mcVersion);
      setLoaderType(profile.loader?.type || "");
      setLoaderVersion(profile.loader?.version || "");
      void loadMcVersions();
      void loadFabricVersions();
    }
  }, [open, profile, loadMcVersions, loadFabricVersions]);

  // Handle loader type change
  const handleLoaderTypeChange = (newType: string) => {
    setLoaderType(newType);
    // Reset version when changing loader type
    if (newType === "fabric" && fabricVersions.length > 0) {
      setLoaderVersion(fabricVersions[0]);
    } else if (newType === "") {
      setLoaderVersion("");
    }
  };

  const handleSubmit = async () => {
    if (!profile) return;

    setIsSubmitting(true);
    try {
      await invoke<Profile>("update_profile_version_cmd", {
        id: profile.id,
        mcVersion,
        loaderType: loaderType || null,
        loaderVersion: loaderVersion || null,
      });
      await loadProfile(profile.id);
      notify("Profile updated", `Changed to ${mcVersion}${loaderType ? ` with ${loaderType}` : ""}`);
      onClose();
    } catch (err) {
      notify("Failed to update profile", String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filter versions based on showSnapshots toggle
  const filteredVersions = showSnapshots
    ? mcVersions
    : mcVersions.filter((v) => v.type === "release");

  const title = mode === "version" ? "Change Minecraft Version" : "Change Mod Loader";

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <div className="edit-version-modal">
        {mode === "version" && (
          <Field label="Minecraft version">
            <div className="version-row">
              <select
                className="select"
                value={mcVersion}
                onChange={(e) => setMcVersion(e.target.value)}
                disabled={mcVersionsLoading}
              >
                {mcVersionsLoading ? (
                  <option>Loading...</option>
                ) : (
                  filteredVersions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.id}
                    </option>
                  ))
                )}
              </select>
              <label className="snapshots-toggle">
                <input
                  type="checkbox"
                  checked={showSnapshots}
                  onChange={(e) => setShowSnapshots(e.target.checked)}
                />
                <span>Snapshots</span>
              </label>
            </div>
          </Field>
        )}

        {mode === "loader" && (
          <>
            <Field label="Mod loader">
              <select
                className="select"
                value={loaderType}
                onChange={(e) => handleLoaderTypeChange(e.target.value)}
              >
                <option value="">Vanilla (no loader)</option>
                <option value="fabric">Fabric</option>
                <option value="quilt">Quilt</option>
                <option value="forge">Forge</option>
                <option value="neoforge">NeoForge</option>
              </select>
            </Field>

            {loaderType === "fabric" && (
              <Field label="Fabric version">
                <select
                  className="select"
                  value={loaderVersion}
                  onChange={(e) => setLoaderVersion(e.target.value)}
                  disabled={fabricVersionsLoading}
                >
                  {fabricVersionsLoading ? (
                    <option>Loading...</option>
                  ) : (
                    fabricVersions.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))
                  )}
                </select>
              </Field>
            )}

            {(loaderType === "quilt" || loaderType === "forge" || loaderType === "neoforge") && (
              <Field label={`${loaderType.charAt(0).toUpperCase() + loaderType.slice(1)} version`}>
                <input
                  className="input"
                  value={loaderVersion}
                  onChange={(e) => setLoaderVersion(e.target.value)}
                  placeholder="Enter version (e.g., 0.20.0)"
                />
              </Field>
            )}
          </>
        )}

        <ModalFooter
          onCancel={onClose}
          onSubmit={handleSubmit}
          submitLabel="Save"
          submitDisabled={isSubmitting}
        />
      </div>

      <style>{`
        .edit-version-modal {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .version-row {
          display: flex;
          gap: 12px;
          align-items: center;
        }

        .version-row .select {
          flex: 1;
        }

        .snapshots-toggle {
          display: flex;
          gap: 6px;
          align-items: center;
          font-size: 12px;
          color: var(--text-muted);
          cursor: pointer;
          white-space: nowrap;
        }

        .snapshots-toggle input {
          cursor: pointer;
        }
      `}</style>
    </Modal>
  );
}
