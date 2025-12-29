import { useEffect, useCallback, useState, lazy, Suspense } from "react";
import clsx from "clsx";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openPath } from "@tauri-apps/plugin-opener";

import { useAppStore } from "./store";
import { useOnline } from "./hooks";
import type { LaunchEvent, ContentRef, ContentTab, Account, Profile } from "./types";
import {
  ErrorBoundary,
  Sidebar,
  ProfileView,
  AccountsView,
  SettingsView,
  Toast,
  ConfirmDialog,
  CreateProfileModal,
  CloneProfileModal,
  DiffProfilesModal,
  AddContentModal,
  DeviceCodeModal,
  LaunchPlanModal,
  ProfileJsonModal,
} from "./components";
import type { CreateProfileForm } from "./components";

// Lazy load heavy components (three.js/skinview3d)
const StoreView = lazy(() => import("./components/StoreView").then(m => ({ default: m.StoreView })));
const LogsView = lazy(() => import("./components/LogsView").then(m => ({ default: m.LogsView })));
const AccountDetailsModal = lazy(() => import("./components/modals/AccountDetailsModal").then(m => ({ default: m.AccountDetailsModal })));

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
    plan,
    setPlan,
    loadProfiles,
    loadProfile,
    loadAccounts,
    loadConfig,
    notify,
    runAction,
    getActiveAccount,
    activeTab,
  } = useAppStore();

  const isOnline = useOnline();

  // Content modal state
  const contentKind = useAppStore((s) => s.activeTab);

  // Account details modal state
  const [selectedAccountForDetails, setSelectedAccountForDetails] = useState<string | null>(null);

  // Initial load
  useEffect(() => {
    const loadInitial = async () => {
      await Promise.all([loadProfiles(), loadAccounts(), loadConfig()]);
    };
    void loadInitial();
  }, [loadProfiles, loadAccounts, loadConfig]);

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
      if (event.payload.stage === "done") {
        setTimeout(() => setLaunchStatus(null), 2500);
      }
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [setLaunchStatus, notify]);

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

  const handleAddContent = useCallback(async (input: string, name: string | null, version: string | null) => {
    if (!selectedProfileId) return;
    await runAction(async () => {
      const payload = {
        profile_id: selectedProfileId,
        input,
        name,
        version,
      };
      if (contentKind === "mods") await invoke("add_mod_cmd", payload);
      else if (contentKind === "resourcepacks") await invoke("add_resourcepack_cmd", payload);
      else await invoke("add_shaderpack_cmd", payload);
      await loadProfile(selectedProfileId);
      setActiveModal(null);
    });
  }, [selectedProfileId, contentKind, runAction, loadProfile, setActiveModal]);

  const handleRemoveContent = useCallback((item: ContentRef) => {
    if (!selectedProfileId) return;
    setConfirmState({
      title: `Remove ${item.name}?`,
      message: "This removes it from the profile but keeps the stored file.",
      confirmLabel: "Remove",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await runAction(async () => {
          const payload = { profile_id: selectedProfileId, target: item.hash };
          if (activeTab === "mods") await invoke("remove_mod_cmd", payload);
          else if (activeTab === "resourcepacks") await invoke("remove_resourcepack_cmd", payload);
          else await invoke("remove_shaderpack_cmd", payload);
          await loadProfile(selectedProfileId);
        });
      },
    });
  }, [selectedProfileId, activeTab, setConfirmState, runAction, loadProfile]);

  const handleLaunch = useCallback(async () => {
    const activeAccount = getActiveAccount();
    if (!selectedProfileId || !activeAccount) {
      notify("No account", "Add an account first.");
      return;
    }
    await runAction(async () => {
      await invoke("launch_profile_cmd", {
        profile_id: selectedProfileId,
        account_id: activeAccount.uuid,
      });
      setLaunchStatus({ stage: "queued" });
    });
  }, [selectedProfileId, getActiveAccount, notify, runAction, setLaunchStatus]);

  const handlePrepare = useCallback(async () => {
    const activeAccount = getActiveAccount();
    if (!selectedProfileId || !activeAccount) {
      notify("No account", "Add an account first.");
      return;
    }
    await runAction(async () => {
      const planData = await invoke<typeof plan>("prepare_profile_cmd", {
        profile_id: selectedProfileId,
        account_id: activeAccount.uuid,
      });
      setPlan(planData);
      setActiveModal("prepare");
    });
  }, [selectedProfileId, getActiveAccount, notify, runAction, setPlan, setActiveModal]);

  const handleOpenInstance = useCallback(async () => {
    if (!selectedProfileId) return;
    const path = await invoke<string>("instance_path_cmd", { profile_id: selectedProfileId });
    await openPath(path);
  }, [selectedProfileId]);

  const handleCopyCommand = useCallback(async () => {
    if (!selectedProfileId) return;
    const command = `shard launch ${selectedProfileId}`;
    await navigator.clipboard.writeText(command);
    notify("Copied", command);
  }, [selectedProfileId, notify]);

  const handleSetActiveAccount = useCallback(async (id: string) => {
    await runAction(async () => {
      await invoke("set_active_account_cmd", { id });
      await loadAccounts();
      useAppStore.setState({ selectedAccountId: id });
    });
  }, [runAction, loadAccounts]);

  const handleRemoveAccount = useCallback((account: Account) => {
    setConfirmState({
      title: `Remove ${account.username}?`,
      message: "This account will be disconnected from Shard.",
      confirmLabel: "Remove",
      tone: "danger",
      onConfirm: async () => {
        setConfirmState(null);
        await runAction(async () => {
          await invoke("remove_account_cmd", { id: account.uuid });
          await loadAccounts();
        });
      },
    });
  }, [setConfirmState, runAction, loadAccounts]);

  const handleSaveConfig = useCallback(async () => {
    const { config } = useAppStore.getState();
    await runAction(async () => {
      const updated = await invoke<typeof config>("save_config_cmd", {
        client_id: config?.msa_client_id ?? null,
        client_secret: config?.msa_client_secret ?? null,
      });
      useAppStore.setState({ config: updated });
      notify("Settings saved");
    });
  }, [runAction, notify]);

  const handleDeviceCodeSuccess = useCallback(async () => {
    await loadAccounts();
  }, [loadAccounts]);

  const openAddContentModal = useCallback((kind: ContentTab) => {
    useAppStore.setState({ activeTab: kind });
    setActiveModal("add-content");
  }, [setActiveModal]);

  const handleViewAccountDetails = useCallback((account: Account) => {
    setSelectedAccountForDetails(account.uuid);
    setActiveModal("account-details");
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
          />

          <main className="main-content">
            <div className="content-area">
              <ErrorBoundary>
                {sidebarView === "profiles" && profile && (
                  <ProfileView
                    key={profile.id}
                    onLaunch={handleLaunch}
                    onPrepare={handlePrepare}
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
                    <button className="btn-primary" onClick={() => setActiveModal("create")}>Create profile</button>
                  </div>
                )}

                {sidebarView === "accounts" && (
                  <AccountsView
                    onSetActive={handleSetActiveAccount}
                    onRemove={handleRemoveAccount}
                    onAdd={() => setActiveModal("device-code")}
                    onViewDetails={handleViewAccountDetails}
                  />
                )}

                {sidebarView === "settings" && (
                  <SettingsView onSave={handleSaveConfig} />
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
              </ErrorBoundary>
            </div>
          </main>

          {launchStatus && (
            <div className="launch-status">
              <div className="launch-status-dot" />
              <div className="launch-status-text">
                {launchStatus.stage}
                {launchStatus.message && ` — ${launchStatus.message}`}
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
          onSubmit={handleAddContent}
        />

        <DeviceCodeModal
          open={activeModal === "device-code"}
          onClose={() => setActiveModal(null)}
          onSuccess={handleDeviceCodeSuccess}
        />

        <LaunchPlanModal
          open={activeModal === "prepare"}
          plan={plan}
          onClose={() => setActiveModal(null)}
        />

        <ProfileJsonModal
          open={activeModal === "json"}
          profile={profile}
          onClose={() => setActiveModal(null)}
        />

        <Suspense fallback={null}>
          <AccountDetailsModal
            open={activeModal === "account-details"}
            accountId={selectedAccountForDetails}
            onClose={() => {
              setActiveModal(null);
              setSelectedAccountForDetails(null);
            }}
          />
        </Suspense>

        {confirmState && (
          <ConfirmDialog state={confirmState} onClose={() => setConfirmState(null)} />
        )}

        {toast && <Toast toast={toast} />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
