import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Modal } from "../Modal";
import { useAppStore } from "../../store";

interface JavaDownloadModalProps {
  open: boolean;
  onClose: () => void;
  javaMajor: number;
  mcVersion: string;
  onSuccess: (javaPath: string) => void;
}

interface AdoptiumRelease {
  version: string;
  major: number;
  download_url: string;
  filename: string;
  size: number;
  checksum: string | null;
}

interface DownloadProgress {
  downloaded: number;
  total: number;
  percentage: number;
}

export function JavaDownloadModal({ open, onClose, javaMajor, mcVersion, onSuccess }: JavaDownloadModalProps) {
  const { notify } = useAppStore();
  const [stage, setStage] = useState<"confirm" | "downloading" | "extracting" | "done">("confirm");
  const [releaseInfo, setReleaseInfo] = useState<AdoptiumRelease | null>(null);
  const [progress, setProgress] = useState<DownloadProgress>({ downloaded: 0, total: 0, percentage: 0 });
  const [error, setError] = useState<string | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      setStage("confirm");
      setReleaseInfo(null);
      setProgress({ downloaded: 0, total: 0, percentage: 0 });
      setError(null);
      // Fetch release info
      fetchReleaseInfo();
    }
  }, [open, javaMajor]);

  // Listen for progress events
  useEffect(() => {
    if (!open) return;

    const unlisten = listen<DownloadProgress>("java-download-progress", (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [open]);

  const fetchReleaseInfo = async () => {
    try {
      const info = await invoke<AdoptiumRelease>("fetch_adoptium_release_cmd", { javaMajor });
      setReleaseInfo(info);
    } catch (err) {
      setError(`Failed to fetch Java info: ${err}`);
    }
  };

  const handleDownload = async () => {
    setStage("downloading");
    setError(null);

    try {
      const javaPath = await invoke<string>("download_java_cmd", { javaMajor });
      setStage("done");
      setTimeout(() => {
        onSuccess(javaPath);
        onClose();
      }, 1000);
    } catch (err) {
      setError(`Download failed: ${err}`);
      setStage("confirm");
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  };

  // Don't allow closing during download
  const handleClose = stage === "downloading" ? () => {} : onClose;

  return (
    <Modal open={open} onClose={handleClose} title="Java Required">
      <div className="java-download-modal">
        {error && (
          <div className="java-download-error">
            {error}
          </div>
        )}

        {stage === "confirm" && (
          <>
            <p className="java-download-desc">
              Minecraft {mcVersion} requires <strong>Java {javaMajor}</strong> which is not installed on your system.
            </p>
            <p className="java-download-desc">
              Would you like to download and install it automatically from Eclipse Adoptium (Temurin)?
            </p>

            {releaseInfo && (
              <div className="java-download-info">
                <div className="java-download-info-row">
                  <span className="java-download-info-label">Version</span>
                  <span className="java-download-info-value">{releaseInfo.version}</span>
                </div>
                <div className="java-download-info-row">
                  <span className="java-download-info-label">Size</span>
                  <span className="java-download-info-value">{formatSize(releaseInfo.size)}</span>
                </div>
              </div>
            )}

            <div className="java-download-actions">
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleDownload}
                disabled={!releaseInfo}
              >
                {releaseInfo ? "Download Java" : "Loading..."}
              </button>
            </div>
          </>
        )}

        {stage === "downloading" && (
          <>
            <p className="java-download-desc">
              Downloading Java {javaMajor}...
            </p>

            <div className="java-download-progress">
              <div className="java-download-progress-bar">
                <div
                  className="java-download-progress-fill"
                  style={{ width: `${progress.percentage}%` }}
                />
              </div>
              <div className="java-download-progress-text">
                {formatSize(progress.downloaded)} / {formatSize(progress.total)} ({progress.percentage}%)
              </div>
            </div>

            <p className="java-download-hint">
              Please wait, this may take a few minutes...
            </p>
          </>
        )}

        {stage === "extracting" && (
          <>
            <p className="java-download-desc">
              Extracting Java {javaMajor}...
            </p>
            <div className="java-download-spinner" />
          </>
        )}

        {stage === "done" && (
          <>
            <div className="java-download-success">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <circle cx="24" cy="24" r="20" stroke="var(--accent-success)" strokeWidth="3" />
                <path d="M16 24l6 6 12-12" stroke="var(--accent-success)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <p>Java {javaMajor} installed successfully!</p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
