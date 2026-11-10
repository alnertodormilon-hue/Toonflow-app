import { spawn } from "node:child_process";
import { invalid } from "./types";

async function protect(value: string, decrypt: boolean) {
  if (process.platform !== "win32") invalid("豆包会话加密当前仅支持Windows；不会退回明文保存", 422, "PLATFORM_UNSUPPORTED");
  const script = `Add-Type -AssemblyName System.Security; $p=[Console]::In.ReadToEnd()|ConvertFrom-Json; `
    + `$b=[Convert]::FromBase64String($p.data); $r=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}`
    + `($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
  return new Promise<string>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let result = "";
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(decrypt ? Buffer.from(result.trim(), "base64").toString("utf8") : result.trim());
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Windows会话保护超时")); }, 15000);
    child.stdout.on("data", chunk => {
      result += chunk.toString();
      if (result.length > 2 * 1024 * 1024) { child.kill(); finish(new Error("会话保护返回数据过大")); }
    });
    child.stderr.resume();
    child.on("error", () => finish(new Error("无法使用Windows当前用户凭据保护")));
    child.on("close", code => finish(code !== 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(result) ? new Error("Windows会话保护失败，请保持同一Windows用户") : undefined));
    child.stdin.on("error", () => finish(new Error("无法传递待保护会话")));
    child.stdin.end(JSON.stringify({ data: decrypt ? value : Buffer.from(value, "utf8").toString("base64") }));
  });
}

export function encryptSession(value: string) { return protect(value, false); }
export function decryptSession(value: string) { return protect(value, true); }
