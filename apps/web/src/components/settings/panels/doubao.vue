<template>
  <div class="doubaoSettings" v-loading="loading">
    <el-alert title="自有账号，官方确认" type="info" :closable="false">
      <p>账号在独立官方窗口登录，手机号和验证码由你本人填写。首版为Mini、15秒、9:16、720p、两张PNG；生成前核对官方免费条件，验证与新授权由本人处理。</p>
      <p>剩余免费次数无法准确读取时显示未知。本地完成数包含本网关全部已完成任务，不代表今日余额。</p>
    </el-alert>
    <el-alert v-if="!supported" title="账号会话保护首版需要Windows，请在运行Toonflow的本机操作。" type="warning" :closable="false" />
    <div class="actions">
      <el-button type="primary" :disabled="busy || !supported" @click="addAccount">添加账号</el-button>
      <el-button :disabled="busy || !supported" @click="configureProvider">配置视频供应商</el-button>
      <el-button :disabled="busy" @click="reload()">刷新</el-button>
    </div>
    <el-table :data="accounts" rowKey="id" emptyText="尚未添加账号">
      <el-table-column label="账号" minWidth="130">
        <template #default="{ row }"><span>{{ row.name }}</span><el-tag v-if="row.isDefault" size="small">默认</el-tag></template>
      </el-table-column>
      <el-table-column label="状态" minWidth="110"><template #default="{ row }">{{ accountLabels[row.state] || row.state }}</template></el-table-column>
      <el-table-column label="免费剩余" width="100"><template #default>未知</template></el-table-column>
      <el-table-column label="本地完成" width="100"><template #default="{ row }">{{ row.quota.localObservedCompleted }}</template></el-table-column>
      <el-table-column label="操作" minWidth="300">
        <template #default="{ row }">
          <el-button link :disabled="busy || row.state === 'disabled'" @click="accountAction(row as Account, 'open')">打开官方窗口</el-button>
          <el-button link :disabled="busy || row.state === 'disabled'" @click="accountAction(row as Account, 'capture')">保存登录</el-button>
          <el-button link :disabled="busy || row.state !== 'active' || row.isDefault" @click="updateAccount(row as Account, { isDefault: true })">设为默认</el-button>
          <el-button link :disabled="busy" @click="renameAccount(row as Account)">改名</el-button>
          <el-button link :disabled="busy" @click="updateAccount(row as Account, { enabled: row.state === 'disabled' })">{{ row.state === 'disabled' ? '启用' : '禁用' }}</el-button>
          <el-button link type="danger" :disabled="busy" @click="removeAccount(row as Account)">删除本地档案</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div class="sectionHeader"><h3>原任务与恢复</h3><span>处理后回原视频节点继续；不要重复新建生成。</span></div>
    <el-table :data="jobs" rowKey="id" emptyText="尚无本地视频任务">
      <el-table-column label="任务" minWidth="130"><template #default="{ row }"><code :title="row.clientRequestId">{{ row.clientRequestId.slice(0, 8) }}</code><br />{{ accountName(row.accountId) }}</template></el-table-column>
      <el-table-column label="状态" minWidth="110"><template #default="{ row }">{{ jobLabels[row.state] || row.state }}</template></el-table-column>
      <el-table-column label="说明" minWidth="240"><template #default="{ row }"><span class="jobMessage">{{ row.message }}</span></template></el-table-column>
      <el-table-column label="操作" minWidth="240">
        <template #default="{ row }">
          <el-button link :disabled="busy" @click="showIntent(row as Job)">查看本次内容</el-button>
          <el-button v-if="!['completed', 'cancelled', 'failed'].includes(row.state)" link :disabled="busy" @click="jobAction(row as Job, 'open')">官方窗口</el-button>
          <el-button v-if="!row.initialSent && !['cancelled', 'completed', 'failed'].includes(row.state)" link :disabled="busy" @click="resume(row as Job, 'prepare')">继续准备</el-button>
          <el-button v-if="row.initialSent && !['completed', 'cancelled', 'failed'].includes(row.state)" link :disabled="busy" @click="resume(row as Job, row.state === 'downloadFailed' ? 'download' : 'reconcile')">{{ row.state === 'downloadFailed' ? '恢复下载' : '只读核对' }}</el-button>
          <el-button v-if="row.state === 'completed'" link :disabled="busy" @click="downloadVideo(row as Job)">下载已有视频</el-button>
          <el-button v-if="!row.initialSent && !['cancelled', 'completed', 'failed'].includes(row.state)" link type="danger" :disabled="busy" @click="jobAction(row as Job, 'cancel')">发送前取消</el-button>
        </template>
      </el-table-column>
    </el-table>
    <el-dialog v-model="intentVisible" title="本次冻结内容" width="min(760px, 90vw)" appendToBody>
      <template v-if="selectedJob">
        <p>账号：{{ accountName(selectedJob.accountId) }}；Mini、15秒、9:16、720p；两张普通参考图。</p>
        <p>操作号：<code>{{ selectedJob.clientRequestId }}</code></p>
        <p>费用条件须在官方窗口核对；本机网关不增加账号权益，也不自动接受付费确认。</p>
        <pre class="intentText">{{ selectedJob.prompt }}</pre>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import axios from "axios";
import { onBeforeUnmount, ref, watch } from "vue";
import { ElMessage, ElMessageBox } from "element-plus";
import { saveSettings } from "@/stores/settings";

type Account = { id: string; name: string; state: string; isDefault: boolean; quota: { remaining: null; localObservedCompleted: number } };
type Job = { id: string; clientRequestId: string; accountId: string; state: string; stateVersion: number; initialSent: boolean; prompt: string; message: string };
const props = defineProps<{ visible?: boolean }>();
const accounts = ref<Account[]>([]);
const jobs = ref<Job[]>([]);
const supported = ref(true);
const loading = ref(false);
const busy = ref(false);
const intentVisible = ref(false);
const selectedJob = ref<Job>();
let timer: ReturnType<typeof setInterval> | undefined;
let disposed = false;
const accountLabels: Record<string, string> = { needsLogin: "待登录", active: "可用", needsVerification: "待本人验证", disabled: "已禁用" };
const jobLabels: Record<string, string> = { queued: "排队", preparing: "准备中", needsLogin: "待登录", needsConfirmation: "待官方确认", needsVerification: "待本人验证",
  submitting: "等待回执", submissionUnknown: "受理未知", awaitingTask: "等待实际任务", generating: "生成中", downloading: "取回中", downloadFailed: "待恢复下载", completed: "已取回", failed: "已失败", cancelled: "发送前取消" };

async function api<T>(path: string, body?: unknown, method = body === undefined ? "GET" : "POST") {
  const { data } = await axios.request<{ code: number; data: T; message: string }>({ url: `/api/doubao/${path}`, method,
    headers: { "x-toonflow-workspace": "1" }, ...(body === undefined ? {} : { data: body }) });
  if (data.code !== 200) throw new Error(data.message || "豆包本机请求失败");
  return data.data;
}

function failure(error: unknown) {
  if (error === "cancel" || error === "close") return;
  ElMessage.error(axios.isAxiosError(error) ? error.response?.data?.message || error.message : error instanceof Error ? error.message : "操作未完成");
}

async function reload(silent = false) {
  if (loading.value) return;
  if (!silent) loading.value = true;
  try {
    const [value, tasks] = await Promise.all([api<{ supported: boolean; accounts: Account[] }>("accounts/list"), api<Job[]>("jobs/list")]);
    if (disposed) return;
    supported.value = value.supported;
    accounts.value = value.accounts;
    jobs.value = tasks;
  } catch (error) { if (!silent) failure(error); }
  finally { loading.value = false; }
}

async function perform(operation: () => Promise<unknown>) {
  if (busy.value) return;
  busy.value = true;
  try { await operation(); }
  catch (error) { failure(error); }
  finally { await reload(true); busy.value = false; }
}

function accountName(id: string) { return accounts.value.find(account => account.id === id)?.name ?? "原账号档案已移除"; }

function addAccount() {
  void perform(async () => {
    const { value } = await ElMessageBox.prompt("为自有账号填写本地名称。官方窗口中自行填写手机号和验证码。", "添加豆包账号", { inputValidator: value => !!value?.trim() && value.trim().length <= 80 || "请输入1—80字名称" });
    const account = await api<Account>("accounts/create", { name: value });
    await reload(true);
    await api("accounts/open", { id: account.id });
    ElMessage.info("完成官方登录后，点击该账号的“保存登录”，再设置默认账号。");
  });
}

function accountAction(account: Account, action: "open" | "capture") {
  void perform(async () => { await api(`accounts/${action}`, { id: account.id }); if (action === "capture") ElMessage.success("官方身份已核对，登录状态已加密保存"); });
}

function updateAccount(account: Account, patch: { name?: string; enabled?: boolean; isDefault?: boolean }) {
  void perform(() => api("accounts/update", { id: account.id, ...patch }, "PUT"));
}

function renameAccount(account: Account) {
  void perform(async () => {
    const { value } = await ElMessageBox.prompt("仅修改本地显示名称", "账号改名", { inputValue: account.name, inputValidator: value => !!value?.trim() && value.trim().length <= 80 || "请输入1—80字名称" });
    await api("accounts/update", { id: account.id, name: value }, "PUT");
  });
}

function removeAccount(account: Account) {
  void perform(async () => {
    await ElMessageBox.confirm("将移除本地登录快照和独立浏览器档案；保留已下载视频。有未决任务时不能删除。", `删除“${account.name}”的本地档案`, { type: "warning" });
    await api("accounts/remove", { id: account.id }, "DELETE");
  });
}

function configureProvider() {
  void perform(async () => {
    const config = await api<{ providerId: string; baseUrl: string; apiKey: string; accountId: string }>("configure", {});
    await saveSettings(current => ({ mediaProviderConfigs: { ...(current.mediaProviderConfigs as Record<string, unknown> | undefined),
      [config.providerId]: { baseUrl: config.baseUrl, apiKey: config.apiKey, accountId: config.accountId } } }));
    ElMessage.success("已配置豆包本机视频供应商，其他供应商设置保持不变");
  });
}

function showIntent(job: Job) { selectedJob.value = job; intentVisible.value = true; }

function jobAction(job: Job, action: "open" | "cancel") {
  void perform(() => api(`jobs/${action}`, { id: job.id, ...(action === "cancel" ? { stateVersion: job.stateVersion } : {}) }));
}

function resume(job: Job, mode: "prepare" | "reconcile" | "download") {
  void perform(() => api("jobs/resume", { id: job.id, mode, stateVersion: job.stateVersion }));
}

function downloadVideo(job: Job) {
  void perform(async () => {
    const { data } = await axios.get(`/api/doubao/jobs/content?id=${encodeURIComponent(job.id)}`, { responseType: "blob", headers: { "x-toonflow-workspace": "1" } });
    const url = URL.createObjectURL(data);
    const link = document.createElement("a");
    link.href = url; link.download = `doubao-${job.id}.mp4`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  });
}

watch(() => props.visible !== false, visible => {
  clearInterval(timer);
  if (!visible) return;
  void reload();
  timer = setInterval(() => { if (!busy.value) void reload(true); }, 5000);
}, { immediate: true });
onBeforeUnmount(() => { disposed = true; clearInterval(timer); });
</script>

<style lang="scss" scoped>
.doubaoSettings {
  display: flex;
  flex-direction: column;
  gap: 16px;
  p { margin: 6px 0; }
  .actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .sectionHeader {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 12px;
    h3 { margin: 0; }
    span { color: var(--el-text-color-secondary); font-size: 12px; }
  }
  .jobMessage { white-space: pre-wrap; overflow-wrap: anywhere; }
  .intentText { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 52vh; overflow: auto; }
}
</style>
