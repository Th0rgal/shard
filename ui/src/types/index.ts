export type ContentRef = {
  name: string;
  hash: string;
  version?: string | null;
  source?: string | null;
  file_name?: string | null;
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

export type SidebarView = "profiles" | "accounts" | "settings" | "store" | "logs";

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

export type AccountInfo = {
  id: string;
  name: string;
  skins: Skin[];
  capes: Cape[];
  active_skin?: Skin | null;
  active_cape?: Cape | null;
  avatar_url: string;
  body_url: string;
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

export type Template = {
  id: string;
  name: string;
  description: string;
  mc_version: string;
  loader?: TemplateLoader | null;
  mods: TemplateContent[];
  resourcepacks: TemplateContent[];
  shaderpacks: TemplateContent[];
};

// Content store types
export type StoreProject = {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon_url?: string | null;
  download_count: number;
  source: "modrinth" | "curseforge";
  categories: string[];
  author: string;
};

export type StoreVersion = {
  id: string;
  name: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  download_url: string;
  file_name: string;
  file_size: number;
  published: string;
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
