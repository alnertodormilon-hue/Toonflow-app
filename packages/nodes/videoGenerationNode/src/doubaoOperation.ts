import type { NodeVideoResult, WorkspaceFiles } from "@toonflow/nodes-scaffold/runtime";

type Operation = { operationId: string; ended?: boolean; result?: NodeVideoResult };
type Snapshot = Awaited<ReturnType<WorkspaceFiles["readTextSnapshot"]>>;

function operationPath(nodeId: string) {
  if (!nodeId || /[\\/]/.test(nodeId) || [".", ".."].includes(nodeId)) throw new Error("节点标识无效");
  return `assets/${nodeId}/doubaoOperation.json`;
}

function fileCode(error: unknown) {
  return (error as { response?: { data?: { data?: { code?: string } } } })?.response?.data?.data?.code;
}

export async function readDoubaoOperation(files: WorkspaceFiles, nodeId: string) {
  let snapshot: Snapshot;
  try { snapshot = await files.readTextSnapshot(operationPath(nodeId)); }
  catch (error) { if (fileCode(error) === "ENOENT") return; throw error; }
  const value = JSON.parse(snapshot.text) as Operation;
  if (!/^[0-9a-f-]{36}$/i.test(value.operationId)) throw new Error("豆包任务记录无效，请保留文件并检查原任务");
  if (value.result && (value.result.mediaType !== "video" || value.result.mimeType !== "video/mp4"
    || !value.result.path.startsWith(`assets/${nodeId}/`) || value.result.path.includes("..") || value.result.path.includes("\\")))
    throw new Error("豆包结果记录无效，请在账号设置核对原任务");
  return { value, snapshot };
}

export async function reserveDoubaoOperation(files: WorkspaceFiles, nodeId: string, currentOutput?: string, operationId?: string) {
  const path = operationPath(nodeId);
  let saved = await readDoubaoOperation(files, nodeId);
  if (saved?.value.result && currentOutput !== saved.value.result.path) return { ...saved, recovered: saved.value.result };
  if (!saved || saved.value.ended || saved.value.result) {
    const value: Operation = { operationId: !saved && operationId ? operationId : crypto.randomUUID() };
    if (saved) await files.writeTextSnapshot(path, JSON.stringify(value), saved.snapshot);
    else {
      for (const directory of ["assets", `assets/${nodeId}`]) await files.mkdir(directory).catch(error => {
        if (fileCode(error) !== "EEXIST") throw error;
      });
      try { await files.writeJson(path, value, true); }
      catch (error) { if (fileCode(error) !== "EEXIST") throw error; }
    }
    saved = await readDoubaoOperation(files, nodeId);
  }
  if (!saved) throw new Error("未能保存豆包操作号，已停止发送");
  return { ...saved, recovered: undefined };
}

export async function finishDoubaoOperation(files: WorkspaceFiles, nodeId: string, saved: NonNullable<Awaited<ReturnType<typeof readDoubaoOperation>>>, result: NodeVideoResult) {
  await files.writeTextSnapshot(operationPath(nodeId), JSON.stringify({ ...saved.value, result }), saved.snapshot);
}

export async function endDoubaoOperation(files: WorkspaceFiles, nodeId: string) {
  const saved = await readDoubaoOperation(files, nodeId);
  if (saved) await files.writeTextSnapshot(operationPath(nodeId), JSON.stringify({ ...saved.value, ended: true }), saved.snapshot);
}
