import { useEffect, useCallback, useRef, useState, lazy, Suspense } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { check } from "@tauri-apps/plugin-updater";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";

import { useAppStore } from "./store";
import { useOnline } from "./hooks";
import type { LaunchEvent, ContentRef, ContentTab, Profile, LibraryItem } from "./types";
import {
  ErrorBoundary,
  Sidebar,
  ProfileView,
  AccountView,
  Toast,
  ConfirmDialog,
  CreateProfileModal,
  CloneProfileModal,
  DiffProfilesModal,
  AddContentModal,
  DeviceCodeModal,
  ProfileJsonModal,
} from "./components";
import { formatContentName } from "./utils";
import type { CreateProfileForm } from "./components";

// Lazy load heavy components (three.js/skinview3d)
const StoreView = lazy(() => import("./components/StoreView").then(m => ({ default: m.StoreView })));
const LogsView = lazy(() => import("./components/LogsView").then(m => ({ default: m.LogsView })));
const LibraryView = lazy(() => import("./components/LibraryView").then(m => ({ default: m.LibraryView })));
const SettingsView = lazy(() => import("./components/SettingsView").then(m => ({ default: m.SettingsView })));

const NO_DRAG_SELECTOR = [
  "button",
  "input",
  "select",
  "textarea",
  "a",
  "label",
  "[role='button']",
  "[contenteditable='true']",
  "[data-tauri-drag-region='false']",
  ".modal",
  ".modal-backdrop",
  ".no-drag",
].join(",");

function App() {
  const {
    profile,
    selectedProfileId,
    setSelectedProfileId,
    sidebarView,
    activeModal,
    setActiveModal,
    toast,
    launchStatus,
    setLaunchStatus,
    confirmState,
    setConfirmState,
    debugDrag,
    setDebugDrag,
    loadProfiles,
    loadProfile,
    loadAccounts,
    loadConfig,
    loadProfileOrganization,
    notify,
    runAction,
    getActiveAccount,
    activeTab,
  } = useAppStore();

  const isOnline = useOnline();
  const [launchHidden, setLaunchHidden] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const updateCheckRef = useRef(false);

  // Content modal state
  const contentKind = useAppStore((s) => s.activeTab);

  // Precache version data for instant dropdowns
  const { precacheMcVersions, precacheFabricVersions, prefetchActiveAccountSkin } = useAppStore();

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      await Promise.all([loadProfiles(), loadAccounts(), loadConfig(), loadProfileOrganization()]);
      // Precache version data and fetch real skin URL in background (don't await - non-blocking)
      void precacheMcVersions();
      void precacheFabricVersions();
      void prefetchActiveAccountSkin();
    };
    void loadInitial();
  }, [loadProfiles, loadAccounts, loadConfig, loadProfileOrganization, precacheMcVersions, precacheFabricVersions, prefetchActiveAccountSkin]);

  // Load profile when selection changes
  useEffect(() => {
    if (!selectedProfileId) {
      useAppStore.setState({ profile: null });
      return;
    }
    void loadProfile(selectedProfileId);
  }, [selectedProfileId, loadProfile]);

  // Launch event listener
  useEffect(() => {
    const unlisten = listen<LaunchEvent>("launch-status", (event) => {
      setLaunchStatus(event.payload);
      if (event.payload.stage === "error") {
        notify("Launch failed", event.payload.message ?? "Unknown error");
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setLaunchStatus, notify]);

  // Background app update check (non-blocking)
  useEffect(() => {
    if (!isOnline || updateCheckRef.current) return;
    updateCheckRef.current = true;
    const run = async () => {
      try {
        const update = await check();
        if (update) {
          notify("Update available", `Version ${update.version} is ready to install in Settings → Updates`);
        }
      } catch {
        // Ignore update errors during background check
      }
    };
    void run();
  }, [isOnline, notify]);

  // Auto-hide running banner after a short delay
  useEffect(() => {
    if (!launchStatus) return;

    setLaunchHidden(false);

    if (hideTimerRef.current) {
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }

    if (launchStatus.stage === "running") {
      // Only hide the banner, don't clear status while game is running
      // This preserves the double-click prevention (if (launchStatus) return)
      hideTimerRef.current = setTimeout(() => {
        setLaunchHidden(true);
      }, 3500);
    }

    if (launchStatus.stage === "done") {
      clearTimerRef.current = setTimeout(() => setLaunchStatus(null), 2500);
    }

    // Clear error status after displaying notification, so user can try again
    if (launchStatus.stage === "error") {
      clearTimerRef.current = setTimeout(() => setLaunchStatus(null), 3000);
    }
  }, [launchStatus, setLaunchStatus]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setDebugDrag(!debugDrag);
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setActiveModal("create");
        return;
      }
      if (event.key === "Escape") {
        if (confirmState) {
          setConfirmState(null);
          return;
        }
        if (activeModal) {
          setActiveModal(null);
          return;
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [activeModal, confirmState, debugDrag, setDebugDrag, setActiveModal, setConfirmState]);

  // Window dragging
  useEffect(() => {
    const handleMouseDown = async (e: MouseEvent) => {
      if (e.button !== 0) return;

      const target = e.target as HTMLElement;
      const dragRegion = target.closest(".titlebar-drag-region, [data-tauri-drag-region='true'], .drag-region");
      if (!dragRegion) return;
      if (target.closest(NO_DRAG_SELECTOR)) return;
      // Don't interfere with HTML5 drag operations (e.g., sidebar profile reordering)
      if (target.closest("[draggable='true']")) return;

      e.preventDefault();

      try {
        const appWindow = getCurrentWindow();
        if (e.detail === 2) {
          const isMaximized = await appWindow.isMaximized();
          if (isMaximized) {
            await appWindow.unmaximize();
          } else {
            await appWindow.maximize();
          }
        } else {
          await appWindow.startDragging();
        }
      } catch (err) {
        console.debug("Window drag not available:", err);
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, []);

  // Handlers
  const handleCreateProfile = useCallback(async (form: CreateProfileForm) => {
    await runAction(async () => {
      const payload = {
        id: form.id.trim(),
        mc_version: form.mcVersion.trim(),
        loader_type: form.loaderType.trim() || null,
        loader_version: form.loaderVersion.trim() || null,
        java: form.java.trim() || null,
        memory: form.memory.trim() || null,
        args: form.args.trim() || null,
      };
      await invoke<Profile>("create_profile_cmd", { input: payload });
      await loadProfiles();
      setSelectedProfileId(payload.id);
      setActiveModal(null);
    });
  }, [runAction, loadProfiles, setSelectedProfileId, setActiveModal]);

  const handleCloneProfile = useCallback(async (src: string, dst: string) => {
    await runAction(async () => {
      await invoke("clone_profile_cmd", { src, dst });
      await loadProfiles();
      setSelectedProfileId(dst);
      setActiveModal(null);
    });
  }, [runAction, loadProfiles, setSelectedProfileId, setActiveModal]);

  const handleAddContentFromLibrary = useCallback(async (item: LibraryItem) => {
    if (!selectedProfileId) return;
    await runAction(async () => {
      await invoke<Profile>("library_add_to_profile_cmd", {
        profileId: selectedProfileId,
        itemId: item.id,
      });
      await loadProfile(selectedProfileId);
      setActiveModal(null);
      notify("Added", `${formatContentName(item.name)} added to profile`);
    });
  }, [selectedProfileId, runAction, loadProfile, setActiveModal, notify]);

  const handleRemoveContent = useCallback((item: ContentRef) => {
    if (!selectedProfileId) return;
    setConfirmState({
      title: `Remove ${formatContentName(item.name)}?`,
      message: "This removes it from the profile but keeps the stored file.",
      confirmLabel: "Remove",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await runAction(async () => {
          const payload = { profileId: selectedProfileId, target: item.hash };
          if (activeTab === "mods") await invoke("remove_mod_cmd", payload);
          else if (activeTab === "resourcepacks") await invoke("remove_resourcepack_cmd", payload);
          else await invoke("remove_shaderpack_cmd", payload);
          await loadProfile(selectedProfileId);
        });
      },
    });
  }, [selectedProfileId, activeTab, setConfirmState, runAction, loadProfile]);

  const handleLaunch = useCallback(async () => {
    // Prevent double-click race condition - use getState() for synchronous check
    // to avoid stale closure values between renders
    if (useAppStore.getState().launchStatus) return;

    const activeAccount = getActiveAccount();
    if (!selectedProfileId || !activeAccount) {
      notify("No account", "Add an account first.");
      return;
    }

    // Set status immediately to prevent double-clicks
    setLaunchStatus({ stage: "queued" });

    try {
      await invoke("launch_profile_cmd", {
        profileId: selectedProfileId,
        accountId: activeAccount.uuid,
      });
      // Status will be updated by launch-status events
    } catch (err) {
      notify("Launch failed", String(err));
      setLaunchStatus(null);
    }
  }, [selectedProfileId, getActiveAccount, notify, setLaunchStatus]);

  const handleOpenInstance = useCallback(async () => {
    if (!selectedProfileId) return;
    try {
      const path = await invoke<string>("instance_path_cmd", { profileId: selectedProfileId });
      try {
        await revealItemInDir(path);
      } catch {
        await openPath(path);
      }
    } catch (err) {
      notify("Failed to open folder", String(err));
    }
  }, [selectedProfileId, notify]);

  const handleCopyCommand = useCallback(async () => {
    if (!selectedProfileId) return;
    const command = `shard launch ${selectedProfileId}`;
    await navigator.clipboard.writeText(command);
    notify("Copied", command);
  }, [selectedProfileId, notify]);

  const handleDeleteProfile = useCallback((id: string) => {
    setConfirmState({
      title: `Delete ${id}?`,
      message: "This will permanently delete the profile and its settings.",
      confirmLabel: "Delete",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await runAction(async () => {
          await invoke("delete_profile_cmd", { id });
          await loadProfiles();
          if (selectedProfileId === id) {
            setSelectedProfileId(null);
          }
        });
      },
    });
  }, [setConfirmState, runAction, loadProfiles, selectedProfileId, setSelectedProfileId]);

  const handleDeviceCodeSuccess = useCallback(async () => {
    await loadAccounts();
  }, [loadAccounts]);

  const openAddContentModal = useCallback((kind: ContentTab) => {
    useAppStore.setState({ activeTab: kind });
    setActiveModal("add-content");
  }, [setActiveModal]);

  return (
    <ErrorBoundary>
      <div className={clsx("app-root", debugDrag && "debug-drag")}>
        <div className="titlebar-drag-region" />
        <div className="sidebar-titlebar-bg" />

        {!isOnline && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              height: 4,
              background: "var(--accent-danger)",
              zIndex: 100,
              opacity: 0.8,
            }}
            title="You are offline"
          />
        )}

        <div className="app-layout drag-region">
          <Sidebar
            onCreateProfile={() => setActiveModal("create")}
            onCloneProfile={() => setActiveModal("clone")}
            onDiffProfiles={() => setActiveModal("diff")}
            onAddAccount={() => setActiveModal("device-code")}
            onDeleteProfile={handleDeleteProfile}
          />

          <main className="main-content">
            <div className="content-area">
              <ErrorBoundary>
                {sidebarView === "profiles" && profile && (
                  <ProfileView
                    key={profile.id}
                    onLaunch={handleLaunch}
                    onOpenInstance={handleOpenInstance}
                    onCopyCommand={handleCopyCommand}
                    onShowJson={() => setActiveModal("json")}
                    onAddContent={openAddContentModal}
                    onRemoveContent={handleRemoveContent}
                  />
                )}

                {sidebarView === "profiles" && !profile && (
                  <div className="empty-state">
                    <h3>No profile selected</h3>
                    <p>Create your first profile to start launching Minecraft.</p>
                    <button className="btn btn-primary" onClick={() => setActiveModal("create")}>Create profile</button>
                  </div>
                )}

                {sidebarView === "accounts" && (
                  <AccountView onAddAccount={() => setActiveModal("device-code")} />
                )}

                {sidebarView === "store" && (
                  <Suspense fallback={<div className="loading-view">Loading store...</div>}>
                    <StoreView />
                  </Suspense>
                )}

                {sidebarView === "logs" && (
                  <Suspense fallback={<div className="loading-view">Loading logs...</div>}>
                    <LogsView />
                  </Suspense>
                )}

                {sidebarView === "library" && (
                  <Suspense fallback={<div className="loading-view">Loading library...</div>}>
                    <LibraryView />
                  </Suspense>
                )}

                {sidebarView === "settings" && (
                  <Suspense fallback={<div className="loading-view">Loading settings...</div>}>
                    <SettingsView />
                  </Suspense>
                )}
              </ErrorBoundary>
            </div>
          </main>

          {launchStatus && (
            <div className={clsx("launch-status", launchHidden && "is-hidden")}>
              <div className={`launch-status-dot${launchStatus.stage === "running" ? " is-running" : ""}`} />
              <div className="launch-status-text">
                {launchStatus.stage.charAt(0).toUpperCase() + launchStatus.stage.slice(1)}
                {launchStatus.message && `: ${launchStatus.message}`}
              </div>
            </div>
          )}
        </div>

        {/* Modals */}
        <CreateProfileModal
          open={activeModal === "create"}
          onClose={() => setActiveModal(null)}
          onSubmit={handleCreateProfile}
        />

        <CloneProfileModal
          open={activeModal === "clone"}
          onClose={() => setActiveModal(null)}
          onSubmit={handleCloneProfile}
        />

        <DiffProfilesModal
          open={activeModal === "diff"}
          onClose={() => setActiveModal(null)}
        />

        <AddContentModal
          open={activeModal === "add-content"}
          kind={contentKind}
          onClose={() => setActiveModal(null)}
          onAddFromLibrary={handleAddContentFromLibrary}
        />

        <DeviceCodeModal
          open={activeModal === "device-code"}
          onClose={() => setActiveModal(null)}
          onSuccess={handleDeviceCodeSuccess}
        />

        <ProfileJsonModal
          open={activeModal === "json"}
          profile={profile}
          onClose={() => setActiveModal(null)}
        />

        {confirmState && (
          <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
        )}

        {toast && <Toast toast={toast} />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
