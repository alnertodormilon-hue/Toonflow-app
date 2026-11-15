<template>
  <div class="about">
    <div class="brand">
      <div class="brandMark"><img class="brandLogo" :src="logoUrl" :alt="brand.name + '标志'" /></div>
      <div class="brandInfo">
        <h3>{{ brand.name }}</h3>
        <div class="brandMeta">
          <span v-if="currentVersion">v{{ currentVersion }}</span>
          <el-tag v-if="clientBuild?.channel || snapshot?.channel" type="info" size="small" round>{{ clientBuild?.channel || snapshot?.channel }}</el-tag>
        </div>
      </div>
    </div>

    <el-card v-if="isMobile || !isRemoteConnection" class="infoCard updateCard" shadow="never">
      <div class="cardHeader">
        <div class="updateCopy">
          <div class="cardLabel">
            <icon-refresh :size="18" aria-hidden="true" />
            <span>版本更新</span>
          </div>
        </div>
        <div class="updateActions">
          <el-button v-if="isMobile" tag="a" size="small" type="primary" plain :href="`${repositoryUrl}/releases/latest`" target="_blank" rel="noopener noreferrer">
            前往 GitHub 更新
          </el-button>
          <template v-else>
            <el-select :modelValue="updateSource" aria-label="更新源" size="small" :disabled="working || sourceSaving" @change="saveUpdateSource">
              <template #prefix>
                <icon-brand-github v-if="updateSource === 'github'" :size="14" aria-hidden="true" />
                <icon-world v-else :size="14" aria-hidden="true" />
              </template>
              <el-option label="项目源" value="official" />
              <el-option label="GitHub" value="github" />
              <el-option v-if="customUpdateUrl" label="自定义源" value="custom" />
            </el-select>
            <el-badge isDot :hidden="!hasDesktopUpdate">
              <el-button size="small" type="primary" plain :loading="checking" :disabled="sourceSaving" @click="openUpdate">
                {{ snapshot?.installFailure ? "查看更新失败原因" : snapshot?.updateReady ? "更新已就绪" : snapshot?.updating || action === "download" ? "查看更新进度" : "检查更新" }}
              </el-button>
            </el-badge>
          </template>
        </div>
      </div>
      <div v-if="!isMobile && snapshot?.hash" class="buildInfo">
        <span>构建标识</span>
        <code>{{ snapshot.hash }}</code>
      </div>
      <div v-if="!isMobile && snapshot?.installFailure" class="installFailureNotice" role="alert">
        <strong>上次更新未成功</strong>
        <p>{{ snapshot.installFailure.message }}</p>
        <p>请前往 GitHub 最新发布页，选择适合当前系统的完整安装包，关闭客户端后重新安装。</p>
        <el-button tag="a" type="primary" size="small" :href="snapshot.installFailure.downloadUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
      </div>
    </el-card>

    <section class="projectSummary">
      <h4>为自己的作品，留一张工作台。</h4>
      <p>{{ brand.description }}</p>
      <div class="capabilities"><span>创作画布</span><span>素材与项目</span><span>模型服务</span></div>
    </section>

    <el-card class="infoCard repositoryCard" shadow="never">
      <a class="repositoryLink" :href="repositoryUrl" target="_blank" rel="noopener noreferrer" :aria-label="brand.name + '项目仓库'">
        <icon-brand-github class="repositoryIcon" :size="20" aria-hidden="true" />
        <div class="repositoryInfo"><span class="repositoryTitle">项目仓库</span><span class="repositoryDescription">查看源码、文档与版本记录</span></div>
        <icon-external-link class="externalIcon" :size="16" aria-hidden="true" />
      </a>
    </el-card>

    <details class="licenseDisclosure">
      <summary>开源许可与第三方声明</summary>
      <p>本项目保留所使用开源软件的版权与许可声明。</p>
      <pre>{{ notices }}</pre>
    </details>

    <el-dialog v-model="resultVisible" title="版本更新" width="min(480px, 92vw)" alignCenter appendToBody>
      <div class="updateResult" aria-live="polite" :aria-busy="working">
        <div class="resultHeader">
          <span class="resultIcon" :class="{ warning: !!updateError, success: !working && !updateError && !snapshot?.updateAvailable }">
            <icon-refresh v-if="working" class="loadingIcon" :size="22" aria-hidden="true" />
            <icon-alert-circle v-else-if="updateError" :size="22" aria-hidden="true" />
            <icon-arrow-up-circle v-else-if="snapshot?.updateAvailable" :size="22" aria-hidden="true" />
            <icon-circle-check v-else :size="22" aria-hidden="true" />
          </span>
          <div class="resultCopy">
            <h3>{{ resultTitle }}</h3>
            <p>{{ resultMessage }}</p>
          </div>
        </div>
        <div
          v-if="!updateError && !snapshot?.installFailure && (action === 'download' || updateProgress || (snapshot?.updateReady && !updateInProgress))"
          class="updateProgress">
          <div v-if="updateInProgress" class="progressHeader">
            <span>{{ updateProgress?.phase === "preparing" ? "正在解压并校验更新包" : "下载进度" }}</span>
            <span v-if="updateProgress && (updateProgress.received > 0 || updateProgress.total)">
              {{ formatBytes(updateProgress.received) }}<template v-if="updateProgress.total"> / {{ formatBytes(updateProgress.total) }}</template>
            </span>
          </div>
          <el-progress
            v-if="updateProgress?.total || (!updateInProgress && snapshot?.updateReady)"
            :percentage="updatePercentage"
            :status="!updateInProgress && snapshot?.updateReady ? 'success' : undefined" />
        </div>
        <div v-if="!checking && !updateError && snapshot?.updateAvailable" class="releaseInfo">
          <div class="versionComparison">
            <div class="versionItem">
              <span>当前版本</span>
              <strong>v{{ currentVersion }}</strong>
            </div>
            <icon-arrow-right class="versionArrow" :size="18" aria-hidden="true" />
            <div class="versionItem latestVersion">
              <span>最新版本</span>
              <strong>v{{ snapshot.latestVersion }}</strong>
            </div>
          </div>
          <div v-if="snapshot.channel || snapshot.latestHash" class="releaseMeta">
            <el-tag v-if="snapshot.channel" type="info" size="small" round>{{ snapshot.channel }}</el-tag>
            <code v-if="snapshot.latestHash" :title="snapshot.latestHash">{{ snapshot.latestHash }}</code>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button size="small" @click="resultVisible = false">关闭</el-button>
        <el-button v-if="updateError && !snapshot?.installFailure && !updateInProgress" tag="a" size="small" :href="`${repositoryUrl}/releases/latest`" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
        <el-button v-if="snapshot?.installFailure" tag="a" type="primary" size="small" :href="snapshot.installFailure.downloadUrl" target="_blank" rel="noopener noreferrer">前往下载页</el-button>
        <el-button v-else-if="snapshot?.updating && !working" size="small" type="primary" @click="runUpdate('read')">重新读取状态</el-button>
        <el-button
          v-else-if="snapshot?.canUpdate && snapshot.updateAvailable"
          size="small"
          :type="snapshot.updateReady ? 'danger' : 'primary'"
          :loading="working"
          @click="runUpdate(snapshot.updateReady ? 'apply' : 'download')">
          {{ snapshot.updateReady ? "重启并更新" : "下载更新" }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { translate, t } from "@toonflow/i18n/vue";

import { computed, onMounted, onBeforeUnmount, ref } from "vue";
import axios from "axios";
import { ElMessage } from "element-plus";
import { isMobile, isDesktop, isRemoteConnection } from "@/lib/platform";
import {
  IconRefresh,
  IconBrandGithub,
  IconExternalLink,
  IconAlertCircle,
  IconArrowUpCircle,
  IconCircleCheck,
  IconArrowRight,
  IconWorld,
} from "@tabler/icons-vue";
import logoUrl from "@toonflow/assets/logo.svg";
import brand from "@toonflow/assets/brand.ts";
import notices from "@toonflow/assets/openSourceNotices.txt?raw";
import { saveSettings } from "@/stores/settings";
import {
  desktopUpdateSource as updateSource,
  desktopUpdateCustomUrl as customUpdateUrl,
  desktopUpdateSnapshot as snapshot,
  desktopUpdateError as updateError,
  desktopUpdateAction as action,
  desktopUpdateChecking,
  hasDesktopUpdate,
  runDesktopUpdate,
} from "@/stores/desktopUpdate";

const repositoryUrl = brand.repositoryUrl;
const clientBuild = ref<{ version: string; channel: string }>();
const currentVersion = computed(() => isDesktop && isRemoteConnection
  ? clientBuild.value?.version || "" : snapshot.value?.version || import.meta.env.appVersion);
const sourceSaving = ref(false);
const checking = computed(() => desktopUpdateChecking.value);
const working = computed(() => !!action.value);
const updateInProgress = computed(() => working.value || !!snapshot.value?.updating);
const updateProgress = computed(() => snapshot.value?.updateProgress);
const updatePercentage = computed(() => !updateInProgress.value && snapshot.value?.updateReady ? 100
  : updateProgress.value?.total ? Math.min(100, Math.floor(updateProgress.value.received / updateProgress.value.total * 100)) : 0);
const resultVisible = ref(false);
const controller = new AbortController();
const resultTitle = computed(() => {
  if (snapshot.value?.installFailure) return translate("上次更新未成功");
  if (updateError.value) return translate("更新未完成");
  if (checking.value) return translate("正在检查更新");
  if (action.value === "read") return translate("正在读取更新状态");
  if (action.value === "apply") return translate("正在重启并更新");
  if (working.value) return translate("正在准备更新");
  if (snapshot.value?.updateReady) return translate("更新已准备完成");
  return snapshot.value?.updateAvailable ? translate("发现新版本") : translate("暂无更新");
});
const resultMessage = computed(() => {
  if (snapshot.value?.installFailure) return snapshot.value.installFailure.message;
  if (updateError.value) return updateError.value;
  if (checking.value) return translate("正在获取最新版本信息…");
  if (action.value === "read") return translate("正在确认客户端的更新状态，请稍候…");
  if (action.value === "apply") return translate("客户端即将关闭，更新完成后会自动重新打开。");
  if (working.value) return translate("正在下载并校验更新包，可以关闭此弹窗继续使用。");
  if (snapshot.value?.updateReady) return translate("点击“重启并更新”安装新版本，请先完成正在进行的任务。");
  if (!snapshot.value?.updateAvailable) return t`当前已是最新版本 v${currentVersion.value}`;
  return snapshot.value.canUpdate ? translate("有新的版本可用，下载完成后可重启更新。") : translate("当前客户端不支持应用内更新，请下载安装包。");
});


onMounted(async () => {
  if (!isDesktop) return;
  try {
    if (isRemoteConnection) {
      const { data } = await axios.get<{ data: { version: string; channel: string } }>("/api/desktop/update", { signal: controller.signal, timeout: 10000 });
      clientBuild.value = data.data;
      return;
    }
    await runDesktopUpdate("read");
  } catch {
    // ACT: 本机版本读取失败不阻塞关于页；远程页面的构建版本不冒充客户端版本。
  }
});
onBeforeUnmount(() => controller.abort());

function openUpdate() {
  resultVisible.value = true;
  if (working.value || snapshot.value?.updateReady || snapshot.value?.installFailure) return;
  void runUpdate("check");
}

async function saveUpdateSource(source: string) {
  if (isRemoteConnection) return;
  if (source === updateSource.value || sourceSaving.value || working.value) return;
  if (source !== "official" && source !== "github" && (source !== "custom" || !customUpdateUrl.value)) return;
  sourceSaving.value = true;
  try {
    await saveSettings(() => ({ desktopUpdateSource: source }));
  } catch (error) {
    ElMessage.error(getUpdateError(error));
  } finally {
    sourceSaving.value = false;
  }
}

function getUpdateError(error: unknown) {
  return axios.isAxiosError<{ message?: string }>(error) ? error.response?.data?.message || error.message : String(error);
}

function formatBytes(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${(bytes / 1024).toFixed(1)} KB`;
}

async function runUpdate(nextAction: "read" | "check" | "download" | "apply") {
  if (working.value || sourceSaving.value) return;
  updateError.value = "";
  if (!isDesktop) {
    updateError.value = "请在桌面客户端中检查更新。";
    return;
  }
  try {
    await runDesktopUpdate(nextAction);
    if (snapshot.value?.channel === "dev") updateError.value = "开发版本不提供更新检查，请使用正式桌面客户端。";
  } catch {
    // 错误与交接状态由全局 Store 保留，关闭面板不取消更新观察。
  }
}
</script>

<style lang="scss" scoped>
.about {
  display: flex;
  flex-direction: column;
  gap: 14px;
  .brand { display: flex; align-items: center; gap: 14px; padding: 6px 0 14px; }
  .brandMark { display: grid; place-items: center; flex-shrink: 0; width: 54px; height: 54px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius-large); background: var(--el-bg-color); }
  .brandLogo { width: 34px; height: 34px; object-fit: contain; }
  .brandInfo { min-width: 0; h3 { margin: 0 0 8px; color: var(--el-text-color-primary); font-size: 21px; font-weight: 600; } }
  .brandMeta { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
  .projectSummary {
    padding: 22px;
    border: 1px solid var(--el-border-color-light);
    border-radius: var(--ui-radius);
    background: var(--el-fill-color-extra-light);
    h4 { margin: 0 0 10px; color: var(--el-text-color-primary); font-size: 16px; font-weight: 500; }
    p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.8; }
    .capabilities { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
    .capabilities span { padding: 4px 9px; border: 1px solid var(--el-border-color-lighter); border-radius: var(--ui-radius-small); color: var(--el-text-color-regular); background: var(--el-bg-color); font-size: 11px; }
  }
  .infoCard {
    min-width: 0;
    border-radius: var(--ui-radius);
    box-shadow: none;
    :deep(.el-card__body) { padding: 16px; }
    .cardHeader { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; }
    .cardLabel { display: flex; align-items: center; gap: 8px; color: var(--el-text-color-primary); font-size: 13px; font-weight: 500; }
    .updateCopy { flex: 1; min-width: 120px; }
    .updateActions { display: flex; align-items: center; gap: 8px; a { text-decoration: none; } :deep(.el-select) { width: 112px; } }
    .buildInfo { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px 12px; margin-top: 12px; color: var(--el-text-color-secondary); font-size: 11px; code { overflow-wrap: anywhere; } }
    .installFailureNotice { margin-top: 14px; padding: 12px; border-radius: var(--ui-radius); background: var(--el-color-danger-light-9); strong { color: var(--el-color-danger); } p { margin: 8px 0 12px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; } }
    &.repositoryCard :deep(.el-card__body) { padding: 0; }
    .repositoryLink { display: flex; align-items: center; gap: 12px; padding: 16px; color: var(--el-text-color-primary); text-decoration: none; &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; border-radius: inherit; } }
    .repositoryInfo { display: flex; flex: 1; flex-direction: column; gap: 4px; }
    .repositoryTitle { font-size: 13px; font-weight: 500; }
    .repositoryDescription { font-size: 11px; color: var(--el-text-color-secondary); }
    .repositoryIcon, .externalIcon { flex-shrink: 0; color: var(--el-text-color-secondary); }
  }
  .licenseDisclosure {
    padding: 14px 0;
    border-top: 1px solid var(--el-border-color-lighter);
    color: var(--el-text-color-secondary);
    font-size: 12px;
    summary { width: fit-content; cursor: pointer; color: var(--el-text-color-regular); &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 4px; } }
    p { line-height: 1.7; }
    pre { max-height: 320px; overflow: auto; padding: 16px; border: 1px solid var(--el-border-color-light); border-radius: var(--ui-radius); background: var(--el-fill-color-extra-light); font-size: 11px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
  }
}
.updateResult {
  .resultHeader { display: flex; gap: 14px; align-items: flex-start; }
  .resultIcon { display: grid; place-items: center; flex-shrink: 0; width: 42px; height: 42px; border-radius: var(--ui-radius); background: var(--el-color-primary-light-9); color: var(--el-color-primary); &.warning { background: var(--el-color-warning-light-9); color: var(--el-color-warning); } &.success { background: var(--el-color-success-light-9); color: var(--el-color-success); } }
  .resultCopy { min-width: 0; h3 { margin: 1px 0 8px; font-size: 16px; font-weight: 600; } p { margin: 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; } }
  .updateProgress { margin-top: 22px; }
  .progressHeader { display: flex; justify-content: space-between; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
  .releaseInfo { margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--el-border-color-lighter); }
  .versionComparison { display: flex; align-items: center; gap: 20px; }
  .versionItem { display: flex; flex: 1; flex-direction: column; gap: 8px; min-width: 0; span { color: var(--el-text-color-secondary); font-size: 12px; } strong { font-size: 16px; font-weight: 500; overflow-wrap: anywhere; } }
  .latestVersion strong { color: var(--el-color-primary); }
  .versionArrow { color: var(--el-text-color-secondary); }
  .releaseMeta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 16px; code { color: var(--el-text-color-secondary); font-size: 11px; overflow-wrap: anywhere; } }
  .loadingIcon { animation: updateSpin 1s linear infinite; }
}
@keyframes updateSpin { to { transform: rotate(360deg); } }
</style>
