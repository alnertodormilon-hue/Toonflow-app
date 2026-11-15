import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, rmSync, writeAtomicSync } from "@toonflow/file";
import { file } from "@toonflow/file/bun";
import { basename, isAbsolute, join } from "node:path";
import brand from "@toonflow/assets/brand.ts";

const directories = process.argv.slice(2);
if (directories.length !== 3 || directories.some(directory => !isAbsolute(directory))) {
  throw new Error("需要安装目录、桌面目录和开始菜单目录的绝对路径。");
}
const [installDirectory, desktopDirectory, programsDirectory] = directories as [string, string, string];
const resourcesDirectory = join(installDirectory, "app", "Resources");
const { identifier, name, channel } = await file(join(resourcesDirectory, "version.json")).json();
if (typeof identifier !== "string" || typeof name !== "string" || channel !== "stable") {
  throw new Error("应用安装信息无效，请重新构建安装包。");
}

// ACT: 系统注册由 NSIS 负责；补齐 Electrobun 2.0.1 的记录，避免首次启动再次调用 PowerShell。
// 保留真实更新助手和完整 manifest，不用占位文件跳过 SDK 检查。
copyFileSync(join(resourcesDirectory, "uninstall"), join(installDirectory, "uninstall.exe"));
writeAtomicSync(join(installDirectory, ".electrobun-uninstall.json"), JSON.stringify({
  schema_version: 1,
  install_nonce: randomUUID().replaceAll("-", ""),
  identifier,
  name,
  channel,
  desktop_shortcut: join(desktopDirectory, `${brand.name}.lnk`),
  start_menu_shortcut: join(programsDirectory, `${brand.name}.lnk`),
  install_root_name: basename(installDirectory),
  data_path_versions: [1],
}, null, 2));

// ACT: 只在新快捷方式确属本次安装时，移除指向同一安装的旧品牌快捷方式。
const legacyName = identifier === "local.toonflow.doubaoTest" ? "toonflowDoubaoTest" : identifier === "local.toonflow.desktop" ? "Toonflow" : undefined;
if (legacyName) {
  const candidates = [desktopDirectory, programsDirectory].map(directory => ({
    oldPath: join(directory, `${legacyName}.lnk`), replacement: join(directory, `${brand.name}.lnk`),
  }));
  const script = `$p=[Console]::In.ReadToEnd()|ConvertFrom-Json; $shell=New-Object -ComObject WScript.Shell; $result=@(); `
    + `foreach($item in $p.items){if((Test-Path -LiteralPath $item.oldPath -PathType Leaf) -and (Test-Path -LiteralPath $item.replacement -PathType Leaf)){`
    + `$old=$shell.CreateShortcut($item.oldPath); $next=$shell.CreateShortcut($item.replacement); `
    + `if([String]::Equals([IO.Path]::GetFullPath($old.TargetPath),$p.target,[StringComparison]::OrdinalIgnoreCase) -and `
    + `[String]::Equals([IO.Path]::GetFullPath($next.TargetPath),$p.target,[StringComparison]::OrdinalIgnoreCase)){$result+=$item.oldPath}}}; `
    + `[Console]::Write((ConvertTo-Json -InputObject @($result) -Compress))`;
  let obsolete: string[] = [];
  try {
    const value = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")], {
      input: JSON.stringify({ items: candidates, target: join(resourcesDirectory, "app", "startupLauncher.exe") }),
      encoding: "utf8", windowsHide: true, timeout: 15000,
    }));
    if (Array.isArray(value) && value.every(path => typeof path === "string" && candidates.some(item => item.oldPath === path))) obsolete = value;
  } catch { console.warn("旧快捷方式未能自动迁移，请在安装完成后手动确认旧快捷方式。"); }
  for (const path of obsolete) rmSync(path, { force: true });
}

// 重装同一构建也重新同步内置节点、工具和供应商；技能沿用首次初始化，保留用户修改。
for (const directory of ["nodes", "tools", "providers"]) {
  rmSync(join(installDirectory, "data", directory, "initialized"), { force: true });
}
