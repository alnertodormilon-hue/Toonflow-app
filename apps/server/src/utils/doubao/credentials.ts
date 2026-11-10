import { spawn } from "node:child_process";
import { gzipSync, gunzipSync } from "node:zlib";
import { invalid } from "./types";

const compressedPrefix = "dpapiGzip1:";
const maximumSessionBytes = 32 * 1024 * 1024;
const maximumProtectedBytes = maximumSessionBytes + 65536;

async function protect(bytes: Buffer, decrypt: boolean) {
  if (process.platform !== "win32") invalid("豆包会话加密当前仅支持Windows；不会退回明文保存", 422, "PLATFORM_UNSUPPORTED");
  if (bytes.length > maximumProtectedBytes) invalid("登录会话超过保存上限，请保留官方窗口并检查页面缓存", 413, "SESSION_TOO_LARGE");
  const script = `Add-Type -AssemblyName System.Security; $p=[Console]::In.ReadToEnd()|ConvertFrom-Json; `
    + `$b=[Convert]::FromBase64String($p.data); $r=[Security.Cryptography.ProtectedData]::${decrypt ? "Unprotect" : "Protect"}`
    + `($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Write([Convert]::ToBase64String($r))`;
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let result = "";
    let settled = false;
    // ACT: DPAPI输出按本次输入量设界限；Base64及加密封装不再共用固定2MiB限制。
    const maximumOutputCharacters = Math.max(4096, Math.ceil((bytes.length + 4096) / 3) * 4);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.from(result.trim(), "base64"));
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Windows会话保护超时")); }, 15000);
    child.stdout.on("data", chunk => {
      if (settled) return;
      result += chunk.toString();
      if (result.length > maximumOutputCharacters) { child.kill(); finish(new Error("会话保护返回数据超出预期大小")); }
    });
    child.stderr.resume();
    child.on("error", () => finish(new Error("无法使用Windows当前用户凭据保护")));
    child.on("close", code => finish(code !== 0 || !/^[A-Za-z0-9+/=\r\n]+$/.test(result) ? new Error("Windows会话保护失败，请保持同一Windows用户") : undefined));
    child.stdin.on("error", () => finish(new Error("无法传递待保护会话")));
    child.stdin.end(JSON.stringify({ data: bytes.toString("base64") }));
  });
}

export async function encryptSession(value: string) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length > maximumSessionBytes) invalid("登录会话超过32MiB保存上限，请保留官方窗口并检查页面缓存", 413, "SESSION_TOO_LARGE");
  const encrypted = await protect(gzipSync(bytes), false);
  return compressedPrefix + encrypted.toString("base64");
}

export async function decryptSession(value: string) {
  const compressed = value.startsWith(compressedPrefix);
  const encoded = compressed ? value.slice(compressedPrefix.length) : value;
  if (!encoded || encoded.length > Math.ceil(maximumProtectedBytes / 3) * 4 || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))
    invalid("保存的登录会话格式无效，请重新保存登录", 409, "SESSION_INVALID");
  const decrypted = await protect(Buffer.from(encoded, "base64"), true);
  const plaintext = compressed ? gunzipSync(decrypted, { maxOutputLength: maximumSessionBytes }) : decrypted;
  if (plaintext.length > maximumSessionBytes) invalid("保存的登录会话超过允许大小", 413, "SESSION_TOO_LARGE");
  return plaintext.toString("utf8");
}
