import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

const tauriConfigPath = path.join(repoRoot, "desktop", "src-tauri", "tauri.conf.json");
const desktopPackagePath = path.join(repoRoot, "desktop", "package.json");
const tauriCargoPath = path.join(repoRoot, "desktop", "src-tauri", "Cargo.toml");
const launcherCargoPath = path.join(repoRoot, "launcher", "Cargo.toml");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  const contents = `${JSON.stringify(data, null, 2)}\n`;
  fs.writeFileSync(filePath, contents, "utf8");
}

function updateCargoVersion(filePath, version) {
  const contents = fs.readFileSync(filePath, "utf8");
  const packageIndex = contents.indexOf("[package]");
  if (packageIndex === -1) {
    throw new Error(`Missing [package] section in ${filePath}`);
  }

  const nextHeaderIndex = contents.indexOf("\n[", packageIndex + 1);
  const blockEnd = nextHeaderIndex === -1 ? contents.length : nextHeaderIndex;
  const packageBlock = contents.slice(packageIndex, blockEnd);
  const versionPattern = /^(\s*version\s*=\s*\")([^\"]+)(\"[^\r\n]*)(\r?\n|$)/m;
  if (!versionPattern.test(packageBlock)) {
    throw new Error(`Missing version field in [package] section of ${filePath}`);
  }

  const updatedBlock = packageBlock.replace(versionPattern, (match, prefix, _oldVersion, suffix, lineEnding) => {
    return `${prefix}${version}${suffix}${lineEnding ?? ""}`;
  });

  const updatedContents = `${contents.slice(0, packageIndex)}${updatedBlock}${contents.slice(blockEnd)}`;
  if (updatedContents !== contents) {
    fs.writeFileSync(filePath, updatedContents, "utf8");
  }
}

const tauriConfig = readJson(tauriConfigPath);
const version = tauriConfig.version;

if (!version || typeof version !== "string") {
  throw new Error("Missing version in tauri.conf.json");
}

const desktopPackage = readJson(desktopPackagePath);
if (desktopPackage.version !== version) {
  desktopPackage.version = version;
  writeJson(desktopPackagePath, desktopPackage);
}

updateCargoVersion(tauriCargoPath, version);
updateCargoVersion(launcherCargoPath, version);
