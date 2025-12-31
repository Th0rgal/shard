export type ContentRef = {
  name: string;
  hash: string;
  version?: string | null;
  source?: string | null;
  file_name?: string | null;
  platform?: string | null;
  project_id?: string | null;
  version_id?: string | null;
  enabled?: boolean;
  pinned?: boolean;
};

export type Loader = {
  type: string;
  version: string;
};

export type Runtime = {
  java?: string | null;
  memory?: string | null;
  args: string[];
};

export type Profile = {
  id: string;
  mcVersion: string;
  loader?: Loader | null;
  mods: ContentRef[];
  resourcepacks: ContentRef[];
  shaderpacks: ContentRef[];
  runtime: Runtime;
};

export type Account = {
  uuid: string;
  username: string;
  xuid?: string | null;
};

export type Accounts = {
  active?: string | null;
  accounts: Account[];
};

export type Config = {
  msa_client_id?: string | null;
  msa_client_secret?: string | null;
  auto_update_enabled?: boolean;
};

export type DeviceCode = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  message: string;
  expires_in: number;
  interval: number;
};

export type LaunchPlan = {
  instance_dir: string;
  java_exec: string;
  jvm_args: string[];
  classpath: string;
  main_class: string;
  game_args: string[];
};

export type DiffResult = {
  only_a: string[];
  only_b: string[];
  both: string[];
};

export type LaunchEvent = {
  stage: string;
  message?: string | null;
};

export type ManifestVersion = {
  id: string;
  type: string;
  releaseTime?: string;
};

export type MinecraftVersionsResponse = {
  versions: ManifestVersion[];
  latest_release?: string | null;
  latest_snapshot?: string | null;
};

export type ContentTab = "mods" | "resourcepacks" | "shaderpacks";

export type ModalType =
  | "create"
  | "clone"
  | "diff"
  | "json"
  | "add-content"
  | "prepare"
  | "device-code"
  | "account-details"
  | "skin-upload"
  | "logs"
  | "store";

export type SidebarView = "profiles" | "accounts" | "store" | "logs" | "library" | "settings";

// Profile folder organization (UI-only, stored in localStorage)
export type ProfileFolder = {
  id: string;
  name: string;
  profiles: string[]; // profile IDs in this folder
  collapsed: boolean;
};

export type ProfileOrganization = {
  folders: ProfileFolder[];
  ungrouped: string[]; // profile IDs not in any folder
  favoriteProfile?: string | null; // the default/favorite profile to launch
};

// Skin/Cape types
export type Skin = {
  id: string;
  state: string;
  url: string;
  variant?: string | null;
};

export type Cape = {
  id: string;
  state: string;
  url: string;
  alias?: string | null;
};

export type MinecraftProfile = {
  id: string;
  name: string;
  skins: Skin[];
  capes: Cape[];
};

export type AccountInfo = {
  uuid: string;
  username: string;
  avatar_url: string;
  body_url: string;
  skin_url: string;
  cape_url: string;
  profile?: MinecraftProfile | null;
};

// Template types
export type TemplateLoader = {
  type: string;
  version: string;
};

export type ContentSource =
  | { type: "modrinth"; project: string }
  | { type: "curseforge"; project_id: number }
  | { type: "url"; url: string };

export type TemplateContent = {
  name: string;
  source: ContentSource;
  version?: string | null;
  required: boolean;
};

export type TemplateRuntime = {
  java?: string | null;
  memory?: string | null;
  args?: string[];
};

export type Template = {
  id: string;
  name: string;
  description: string;
  mc_version: string;
  loader?: TemplateLoader | null;
  mods: TemplateContent[];
  resourcepacks: TemplateContent[];
  shaderpacks: TemplateContent[];
  runtime?: TemplateRuntime | null;
};

// Java detection types
export type JavaInstallation = {
  path: string;
  version?: string | null;
  major?: number | null;
  vendor?: string | null;
  arch?: string | null;
  is_valid: boolean;
};

export type JavaValidation = {
  is_valid: boolean;
  version?: string | null;
  major?: number | null;
  vendor?: string | null;
  arch?: string | null;
  error?: string | null;
};

// Content store types - matches Rust ContentItem
export type StoreProject = {
  id: string;
  slug: string;
  name: string;
  description: string;
  body?: string | null;
  icon_url?: string | null;
  platform: "modrinth" | "curseforge";
  content_type: "mod" | "resourcepack" | "shaderpack" | "modpack";
  downloads: number;
  updated: string;
  categories: string[];
  game_versions: string[];
  loaders: string[];
};

// Content store version - matches Rust ContentVersion
export type StoreVersion = {
  id: string;
  project_id: string;
  name: string;
  version: string;
  download_url: string;
  filename: string;
  size: number;
  sha256?: string | null;
  sha1?: string | null;
  platform: "modrinth" | "curseforge";
  game_versions: string[];
  loaders: string[];
  release_type: string;
};

// Logs types
export type LogLevel = "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

export type LogEntry = {
  timestamp?: string | null;
  level: LogLevel;
  thread?: string | null;
  message: string;
  raw: string;
  line_number: number;
};

export type LogFile = {
  name: string;
  path: string;
  size: number;
  modified: number;
  is_current: boolean;
};

export type ConfirmState = {
  title: string;
  message: string;
  confirmLabel?: string;
  tone?: "danger" | "default";
  onConfirm: () => void | Promise<void>;
};

export type Toast = {
  title: string;
  detail?: string;
};

// Library types
export type LibraryContentType = "mod" | "resourcepack" | "shaderpack" | "skin";

export type LibraryTag = {
  id: number;
  name: string;
  color?: string | null;
};

export type LibraryItem = {
  id: number;
  hash: string;
  content_type: LibraryContentType;
  name: string;
  file_name?: string | null;
  file_size?: number | null;
  source_url?: string | null;
  source_platform?: string | null;
  source_project_id?: string | null;
  source_version?: string | null;
  added_at: string;
  updated_at: string;
  notes?: string | null;
  tags: LibraryTag[];
  used_by_profiles: string[];
};

export type LibraryFilter = {
  content_type?: string;
  search?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
};

export type LibraryStats = {
  total_items: number;
  mods_count: number;
  resourcepacks_count: number;
  shaderpacks_count: number;
  skins_count: number;
  total_size: number;
  tags_count: number;
};

export type LibraryImportResult = {
  added: number;
  skipped: number;
  errors: string[];
};

// Storage statistics types
export type StorageStats = {
  total_bytes: number;
  mods_bytes: number;
  resourcepacks_bytes: number;
  shaderpacks_bytes: number;
  skins_bytes: number;
  minecraft_bytes: number;
  database_bytes: number;
  unique_items: number;
  total_references: number;
  deduplication_savings: number;
};

// Update checking types
export type ContentUpdate = {
  profile_id: string;
  content: ContentRef;
  content_type: string;
  current_version?: string | null;
  latest_version: string;
  latest_version_id: string;
  changelog?: string | null;
};

export type UpdateCheckResult = {
  updates: ContentUpdate[];
  checked: number;
  skipped: number;
  errors: string[];
};
