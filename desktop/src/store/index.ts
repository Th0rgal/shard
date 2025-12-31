import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Profile,
  Accounts,
  Config,
  ContentTab,
  SidebarView,
  ModalType,
  ConfirmState,
  Toast,
  LaunchEvent,
  DeviceCode,
  DiffResult,
  ManifestVersion,
  ProfileFolder,
  ProfileOrganization,
  AccountInfo,
} from "../types";

const PROFILE_ORG_KEY = "shard:profile-organization";

interface AppState {
  // Core data
  profiles: string[];
  profile: Profile | null;
  selectedProfileId: string | null;
  accounts: Accounts | null;
  selectedAccountId: string | null;
  activeAccountSkinUrl: string | null;
  config: Config | null;

  // UI state
  profileFilter: string;
  activeTab: ContentTab;
  sidebarView: SidebarView;
  activeModal: ModalType | null;
  toast: Toast | null;
  launchStatus: LaunchEvent | null;
  isWorking: boolean;
  confirmState: ConfirmState | null;
  debugDrag: boolean;

  // Profile organization (folders)
  profileOrg: ProfileOrganization;
  contextMenuTarget: { type: "profile" | "folder"; id: string; x: number; y: number } | null;

  // Modal-specific state
  deviceCode: DeviceCode | null;
  devicePending: boolean;
  diffResult: DiffResult | null;

  // Minecraft versions
  mcVersions: ManifestVersion[];
  mcVersionLoading: boolean;
  loaderVersions: string[];
  loaderLoading: boolean;

  // Actions
  setProfiles: (profiles: string[]) => void;
  setProfile: (profile: Profile | null) => void;
  setSelectedProfileId: (id: string | null) => void;
  setAccounts: (accounts: Accounts | null) => void;
  setSelectedAccountId: (id: string | null) => void;
  setActiveAccountSkinUrl: (url: string | null) => void;
  setConfig: (config: Config | null) => void;
  setProfileFilter: (filter: string) => void;
  setActiveTab: (tab: ContentTab) => void;
  setSidebarView: (view: SidebarView) => void;
  setActiveModal: (modal: ModalType | null) => void;
  setToast: (toast: Toast | null) => void;
  setLaunchStatus: (status: LaunchEvent | null) => void;
  setIsWorking: (working: boolean) => void;
  setConfirmState: (state: ConfirmState | null) => void;
  setDebugDrag: (debug: boolean) => void;
  setDeviceCode: (code: DeviceCode | null) => void;
  setDevicePending: (pending: boolean) => void;
  setDiffResult: (result: DiffResult | null) => void;
  setMcVersions: (versions: ManifestVersion[]) => void;
  setMcVersionLoading: (loading: boolean) => void;
  setLoaderVersions: (versions: string[]) => void;
  setLoaderLoading: (loading: boolean) => void;
  setContextMenuTarget: (target: { type: "profile" | "folder"; id: string; x: number; y: number } | null) => void;

  // Profile organization actions
  createFolder: (name: string) => string;
  renameFolder: (folderId: string, name: string) => void;
  deleteFolder: (folderId: string) => void;
  toggleFolderCollapsed: (folderId: string) => void;
  moveProfileToFolder: (profileId: string, folderId: string | null) => void;
  reorderProfileInFolder: (profileId: string, folderId: string | null, targetIndex: number) => void;
  setFavoriteProfile: (profileId: string | null) => void;
  renameProfileInOrganization: (oldId: string, newId: string) => void;
  loadProfileOrganization: () => void;
  syncProfileOrganization: () => void;

  // Async actions
  loadProfiles: () => Promise<void>;
  loadProfile: (id: string) => Promise<void>;
  loadAccounts: () => Promise<void>;
  loadConfig: () => Promise<void>;
  precacheMcVersions: () => Promise<void>;
  precacheFabricVersions: () => Promise<void>;
  prefetchActiveAccountSkin: () => Promise<void>;
  notify: (title: string, detail?: string) => void;
  runAction: (action: () => Promise<void>) => Promise<void>;

  // Computed helpers
  getActiveAccount: () => import("../types").Account | null;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  profiles: [],
  profile: null,
  selectedProfileId: null,
  accounts: null,
  selectedAccountId: null,
  activeAccountSkinUrl: null,
  config: null,
  profileFilter: "",
  activeTab: "mods",
  sidebarView: "profiles",
  activeModal: null,
  toast: null,
  launchStatus: null,
  isWorking: false,
  confirmState: null,
  debugDrag: false,
  profileOrg: { folders: [], ungrouped: [] },
  contextMenuTarget: null,
  deviceCode: null,
  devicePending: false,
  diffResult: null,
  mcVersions: [],
  mcVersionLoading: false,
  loaderVersions: [],
  loaderLoading: false,

  // Simple setters
  setProfiles: (profiles) => set({ profiles }),
  setProfile: (profile) => set({ profile }),
  setSelectedProfileId: (selectedProfileId) => set({ selectedProfileId }),
  setAccounts: (accounts) => set({ accounts }),
  setSelectedAccountId: (selectedAccountId) => set({ selectedAccountId }),
  setActiveAccountSkinUrl: (activeAccountSkinUrl) => set({ activeAccountSkinUrl }),
  setConfig: (config) => set({ config }),
  setProfileFilter: (profileFilter) => set({ profileFilter }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSidebarView: (sidebarView) => set({ sidebarView }),
  setActiveModal: (activeModal) => set({ activeModal }),
  setToast: (toast) => set({ toast }),
  setLaunchStatus: (launchStatus) => set({ launchStatus }),
  setIsWorking: (isWorking) => set({ isWorking }),
  setConfirmState: (confirmState) => set({ confirmState }),
  setDebugDrag: (debugDrag) => set({ debugDrag }),
  setDeviceCode: (deviceCode) => set({ deviceCode }),
  setDevicePending: (devicePending) => set({ devicePending }),
  setDiffResult: (diffResult) => set({ diffResult }),
  setMcVersions: (mcVersions) => set({ mcVersions }),
  setMcVersionLoading: (mcVersionLoading) => set({ mcVersionLoading }),
  setLoaderVersions: (loaderVersions) => set({ loaderVersions }),
  setLoaderLoading: (loaderLoading) => set({ loaderLoading }),
  setContextMenuTarget: (contextMenuTarget) => set({ contextMenuTarget }),

  // Profile organization actions
  createFolder: (name: string) => {
    const { profileOrg } = get();
    const id = `folder-${Date.now()}`;
    const newFolder: ProfileFolder = { id, name, profiles: [], collapsed: false };
    const newOrg = { ...profileOrg, folders: [...profileOrg.folders, newFolder] };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
    return id;
  },

  renameFolder: (folderId: string, name: string) => {
    const { profileOrg } = get();
    const newOrg = {
      ...profileOrg,
      folders: profileOrg.folders.map((f) => (f.id === folderId ? { ...f, name } : f)),
    };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  deleteFolder: (folderId: string) => {
    const { profileOrg } = get();
    const folder = profileOrg.folders.find((f) => f.id === folderId);
    const newOrg = {
      folders: profileOrg.folders.filter((f) => f.id !== folderId),
      ungrouped: [...profileOrg.ungrouped, ...(folder?.profiles ?? [])],
    };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  toggleFolderCollapsed: (folderId: string) => {
    const { profileOrg } = get();
    const newOrg = {
      ...profileOrg,
      folders: profileOrg.folders.map((f) =>
        f.id === folderId ? { ...f, collapsed: !f.collapsed } : f
      ),
    };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  moveProfileToFolder: (profileId: string, folderId: string | null) => {
    const { profileOrg } = get();
    // Remove from current location
    let newFolders = profileOrg.folders.map((f) => ({
      ...f,
      profiles: f.profiles.filter((p) => p !== profileId),
    }));
    let newUngrouped = profileOrg.ungrouped.filter((p) => p !== profileId);

    // Add to new location
    if (folderId === null) {
      newUngrouped = [...newUngrouped, profileId];
    } else {
      newFolders = newFolders.map((f) =>
        f.id === folderId ? { ...f, profiles: [...f.profiles, profileId] } : f
      );
    }

    const newOrg = { ...profileOrg, folders: newFolders, ungrouped: newUngrouped };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  reorderProfileInFolder: (profileId: string, folderId: string | null, targetIndex: number) => {
    const { profileOrg } = get();
    // Remove from current location
    let newFolders = profileOrg.folders.map((f) => ({
      ...f,
      profiles: f.profiles.filter((p) => p !== profileId),
    }));
    let newUngrouped = profileOrg.ungrouped.filter((p) => p !== profileId);

    // Add at specific index in target location
    if (folderId === null) {
      newUngrouped.splice(targetIndex, 0, profileId);
    } else {
      newFolders = newFolders.map((f) => {
        if (f.id === folderId) {
          const profiles = [...f.profiles];
          profiles.splice(targetIndex, 0, profileId);
          return { ...f, profiles };
        }
        return f;
      });
    }

    const newOrg = { ...profileOrg, folders: newFolders, ungrouped: newUngrouped };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  setFavoriteProfile: (profileId: string | null) => {
    const { profileOrg } = get();
    const newOrg = { ...profileOrg, favoriteProfile: profileId };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  renameProfileInOrganization: (oldId: string, newId: string) => {
    const { profileOrg } = get();
    // Update profile ID in folders
    const newFolders = profileOrg.folders.map((f) => ({
      ...f,
      profiles: f.profiles.map((p) => (p === oldId ? newId : p)),
    }));
    // Update profile ID in ungrouped
    const newUngrouped = profileOrg.ungrouped.map((p) => (p === oldId ? newId : p));
    // Update favorite if it was the renamed profile
    const newFavorite = profileOrg.favoriteProfile === oldId ? newId : profileOrg.favoriteProfile;

    const newOrg = {
      folders: newFolders,
      ungrouped: newUngrouped,
      favoriteProfile: newFavorite,
    };
    set({ profileOrg: newOrg });
    localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
  },

  loadProfileOrganization: () => {
    try {
      const stored = localStorage.getItem(PROFILE_ORG_KEY);
      if (stored) {
        set({ profileOrg: JSON.parse(stored) });
      }
    } catch {
      // Ignore parse errors
    }
  },

  syncProfileOrganization: () => {
    const { profiles, profileOrg } = get();
    const allOrganized = new Set([
      ...profileOrg.folders.flatMap((f) => f.profiles),
      ...profileOrg.ungrouped,
    ]);

    // Find profiles that exist but aren't organized
    const newProfiles = profiles.filter((p) => !allOrganized.has(p));
    // Find organized profiles that no longer exist
    const validFolders = profileOrg.folders.map((f) => ({
      ...f,
      profiles: f.profiles.filter((p) => profiles.includes(p)),
    }));
    const validUngrouped = profileOrg.ungrouped.filter((p) => profiles.includes(p));

    const newOrg = {
      folders: validFolders,
      ungrouped: [...validUngrouped, ...newProfiles],
    };

    if (
      newProfiles.length > 0 ||
      validFolders.some((f, i) => f.profiles.length !== profileOrg.folders[i]?.profiles.length) ||
      validUngrouped.length !== profileOrg.ungrouped.length
    ) {
      set({ profileOrg: newOrg });
      localStorage.setItem(PROFILE_ORG_KEY, JSON.stringify(newOrg));
    }
  },

  // Async actions
  loadProfiles: async () => {
    try {
      const list = await invoke<string[]>("list_profiles_cmd");
      set({ profiles: list });
      const { selectedProfileId } = get();
      if (!selectedProfileId && list.length > 0) {
        set({ selectedProfileId: list[0] });
      }
    } catch (err) {
      get().notify("Failed to load profiles", String(err));
    }
  },

  // Precache Minecraft versions (call on app init for instant dropdowns)
  precacheMcVersions: async () => {
    const { mcVersions } = get();
    if (mcVersions.length > 0) return; // Already cached
    set({ mcVersionLoading: true });
    try {
      const response = await invoke<{ versions: ManifestVersion[] }>("fetch_minecraft_versions_cmd");
      set({ mcVersions: response.versions });
    } catch {
      // Silently fail - will retry when dropdown opens
    } finally {
      set({ mcVersionLoading: false });
    }
  },

  // Precache Fabric versions (call on app init for instant dropdowns)
  precacheFabricVersions: async () => {
    const { loaderVersions } = get();
    if (loaderVersions.length > 0) return; // Already cached
    set({ loaderLoading: true });
    try {
      const versions = await invoke<string[]>("fetch_fabric_versions_cmd");
      set({ loaderVersions: versions });
    } catch {
      // Silently fail - will retry when dropdown opens
    } finally {
      set({ loaderLoading: false });
    }
  },

  loadProfile: async (id: string) => {
    try {
      const data = await invoke<Profile>("load_profile_cmd", { id });
      set({ profile: data });
    } catch (err) {
      // Clear profile and selection when load fails (e.g., profile was deleted)
      set({ profile: null, selectedProfileId: null });
      get().notify("Failed to load profile", String(err));
    }
  },

  loadAccounts: async () => {
    try {
      const data = await invoke<Accounts>("list_accounts_cmd");
      set({ accounts: data });
      const { selectedAccountId } = get();
      if (!selectedAccountId) {
        set({ selectedAccountId: data.active ?? data.accounts[0]?.uuid ?? null });
      }
    } catch (err) {
      get().notify("Failed to load accounts", String(err));
    }
  },

  loadConfig: async () => {
    try {
      const data = await invoke<Config>("get_config_cmd");
      set({ config: data });
    } catch (err) {
      get().notify("Failed to load config", String(err));
    }
  },

  // Prefetch the active account's skin URL from Minecraft API
  // This ensures the sidebar shows the real skin instead of cached mc-heads.net avatar
  prefetchActiveAccountSkin: async () => {
    const { accounts, selectedAccountId } = get();
    if (!accounts) return;
    const accountId = selectedAccountId ?? accounts.active ?? accounts.accounts[0]?.uuid;
    if (!accountId) return;
    try {
      const info = await invoke<AccountInfo>("get_account_info_cmd", { id: accountId });
      set({ activeAccountSkinUrl: info.skin_url });
    } catch {
      // Silently fail - sidebar will fall back to mc-heads.net
    }
  },

  notify: (title: string, detail?: string) => {
    set({ toast: { title, detail } });
    setTimeout(() => set({ toast: null }), 3800);
  },

  runAction: async (action: () => Promise<void>) => {
    set({ isWorking: true });
    try {
      await action();
    } catch (err) {
      get().notify("Action failed", String(err));
    } finally {
      set({ isWorking: false });
    }
  },

  // Computed helper
  getActiveAccount: () => {
    const { accounts, selectedAccountId } = get();
    if (!accounts) return null;
    const id = selectedAccountId ?? accounts.active ?? null;
    return accounts.accounts.find((account) => account.uuid === id) ?? null;
  },
}));
