import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir, readFile, writeAtomic } from "@toonflow/file";
import { dataRoot, saveAsset } from "./store";
import { invalid } from "./types";

export async function acceptAsset(data: string) {
  if (!data || data.length > Math.ceil(10 * 1024 * 1024 / 3) * 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(data) || data.length % 4 !== 0)
    invalid("参考图须为不超过10MiB的PNG", 422, "INVALID_ASSET");
  const bytes = Buffer.from(data, "base64");
  if (bytes.length < 24 || bytes.length > 10 * 1024 * 1024 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    invalid("参考图必须是真实PNG文件", 422, "INVALID_ASSET");
  const image = new Bun.Image(bytes);
  let width: number, height: number;
  try {
    const metadata = await image.metadata();
    width = metadata.width;
    height = metadata.height;
  } catch { invalid("PNG无法解码，请重新选择参考图", 422, "INVALID_ASSET"); }
  if (!width || !height || width * height > 16000000) invalid("参考图不能超过1600万像素", 422, "INVALID_ASSET");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const directory = join(dataRoot(), "assets");
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${sha256}.png`);
  try { await writeAtomic(path, bytes, { exclusive: true }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (createHash("sha256").update(await readFile(path)).digest("hex") !== sha256) invalid("参考图缓存完整性检查失败", 409, "ASSET_INTEGRITY_FAILED");
  }
  return saveAsset({ id: sha256, sha256, path, bytes: bytes.length, width, height });
}
