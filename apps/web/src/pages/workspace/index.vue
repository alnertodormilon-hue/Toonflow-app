<template>
  <main class="workspacePage" :style="{ '--agentWidth': `${agentVisible ? agentWidth : 0}px` }">
    <canvasPanel
      :key="workspaceStore.project?.directory"
      v-model:selectedTool="selectedTool"
      ref="canvasPanelRef"
      class="canvasPanel"
      :class="{ backgroundPanel: activePanel !== 'canvas' }"
      :inert="activePanel !== 'canvas'"
      :aria-hidden="activePanel !== 'canvas'"
      :active="activePanel === 'canvas'"
      :settingsVisible="settingsVisible" />
    <keep-alive :max="1">
      <documentPanel
        v-if="activePanel === 'document'"
        :key="workspaceStore.project?.directory"
        :ref="setDocumentPanel"
        :readNode="readDocumentNode"
        :readNodes="readDocumentNodes"
        :focusNode="focusDocumentNode"
        :mountNode="mountDocumentNode"
        :resolveNodeFile="resolveDocumentNodeFile"
        :observeNode="observeDocumentNode"
        :flushNodes="flushDocumentNodes"
        :fileAction="performFileAction"
        :saveNode="saveDocumentNode" />
    </keep-alive>
    <workspaceMenu class="workspaceMenu" @openSettings="settingsVisible = true" />
    <div class="workspaceTools">
      <el-segmented :modelValue="activePanel" class="panelSwitcher" :options="panelOptions" size="small" aria-label="切换面板" @change="switchPanel">
        <template #default="{ item }">
          <span class="panelOption">
            <component :is="item.icon" :size="14" aria-hidden="true" />
            {{ item.label }}
          </span>
        </template>
      </el-segmented>
      <div class="bottomTools">
        <el-card v-if="activePanel === 'canvas'" class="toolMenu" shadow="never" :bodyStyle="{ padding: '3px 6px' }">
          <div class="toolMenuContent" role="toolbar" aria-label="画布工具">
            <el-tooltip content="添加节点" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button class="toolButton addNodeButton" :disabled="!canvasPanelRef?.canvasReady || settingsVisible" aria-label="添加节点" aria-haspopup="menu" @click="canvasPanelRef?.addNodeAtPointer()">
                <icon-plus :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :content="selectedTool === 'move' ? '移动工具，点击切换为抓手' : '抓手工具，点击切换为移动'" placement="top" :showArrow="false" :hideAfter="0" :enterable="false" :triggerKeys="[]">
              <el-button
                class="toolButton"
                text
                :type="selectedTool === 'hand' ? 'primary' : 'default'"
                :aria-pressed="selectedTool === 'hand'"
                aria-label="切换抓手/移动工具"
                @click="selectedTool = selectedTool === 'move' ? 'hand' : 'move'">
                <component :is="selectedTool === 'move' ? IconPointer : IconHandStop" :size="18" aria-hidden="true" />
              </el-button>
            </el-tooltip>
            <el-tooltip :showArrow="false" content="帮助" placement="top" :hideAfter="0" :enterable="false" :triggerKeys="[]" :disabled="helpVisible">
              <span class="toolTrigger">
                <el-popover v-model:visible="helpVisible" trigger="click" placement="top-end" :width="196">
                  <template #reference>
                    <el-button class="toolButton" text aria-label="帮助">
                      <icon-help :size="18" />
                    </el-button>
                  </template>
                  <div class="helpMenu">
                    <el-button
                      class="helpAction"
                      tag="a"
                      text
                      :icon="IconBook"
                      :href="`${brand.repositoryUrl}#readme`"
                      target="_blank"
                      rel="noopener noreferrer"
                      @click="helpVisible = false">
                      项目文档
                    </el-button>
                    <el-button
                      class="helpAction"
                      tag="a"
                      text
                      :icon="IconBug"
                      :href="`${brand.repositoryUrl}/issues/new`"
                      target="_blank"
                      rel="noopener noreferrer"
                      :title="`${brand.name} 问题反馈`"
                      @click="helpVisible = false">
                      问题反馈
                    </el-button>
                  </div>
                </el-popover>
              </span>
            </el-tooltip>
          </div>
        </el-card>
        <el-tooltip v-if="!agentVisible" :content="`${brand.shortName}助手`" placement="top" :showArrow="false" :hideAfter="0">
          <el-button
            class="agentButton"
            :class="{ standalone: activePanel !== 'canvas' }"
            :aria-expanded="agentVisible"
            :aria-label="`${brand.shortName}助手`"
            aria-controls="agentPanel"
            @click="agentVisible = !agentVisible"><icon-sparkles :size="20" aria-hidden="true" /></el-button>
        </el-tooltip>
      </div>
    </div>
    <floatingAgent v-model="agentVisible" @resize="agentWidth = $event" />
    <settings v-model="settingsVisible" />
  </main>
</template>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onScopeDispose, provide, ref, shallowRef, watch, type ComponentPublicInstance } from "vue";
import { onBeforeRouteLeave } from "vue-router";
import axios from "axios";
import { IconVector, IconFileText, IconPointer, IconHandStop, IconPlus, IconHelp, IconBook, IconBug, IconSparkles } from "@tabler/icons-vue";
import { ElMessage, ElMessageBox } from "element-plus";
import brand from "@toonflow/assets/brand.ts";
import settings from "@/components/settings/index.vue";
import { useWorkspaceStore } from "@/stores/workspace";
import { registerWorkspaceControl, waitForControlValue } from "@/lib/mcpControl";
import anonymousData from "@/lib/anonymousData";
import { useProviderBalances } from "@/lib/providerBilling";
import canvasPanel from "./panels/canvas/canvasHost.vue";
import type { DocumentNodeOptions } from "./panels/canvas/canvasFiles";
import workspaceMenu from "./components/workspaceMenu.vue";
import floatingAgent from "./components/floatingAgent.vue";

const documentPanel = defineAsyncComponent(() => import("./panels/document/index.vue"));

const activePanel = ref<"canvas" | "document">("canvas");
const selectedTool = ref<"move" | "hand">("move");
onMounted(() => anonymousData.track("workspace.canvas"));
const workspaceStore = useWorkspaceStore();
useProviderBalances();
const panelOptions = [
  { label: "画布", value: "canvas", icon: IconVector },
  { label: "文档", value: "document", icon: IconFileText },
];
const agentVisible = ref(true);
const agentWidth = ref(0);
const settingsVisible = ref(false);
const helpVisible = ref(false);
const canvasPanelRef = ref<InstanceType<typeof canvasPanel>>();
const documentPanelCache = shallowRef<{ directory: string; instance: InstanceType<typeof documentPanel> }>();
const documentPanelRef = computed(() => documentPanelCache.value?.directory === workspaceStore.project?.directory ? documentPanelCache.value?.instance : undefined);
watch(() => workspaceStore.project?.directory, () => { documentPanelCache.value = undefined; }, { flush: "sync" });
function setDocumentPanel(value: Element | ComponentPublicInstance | null) {
  const directory = workspaceStore.project?.directory;
  // KeepAlive 失活会清空模板 ref，保留同一工作区实例以协调后台文档保存和文件操作。
  if (value && directory) documentPanelCache.value = { directory, instance: value as InstanceType<typeof documentPanel> };
}
provide("canvas", () => canvasPanelRef.value?.getCanvasContext());
provide("mentionCanvas", () => canvasPanelRef.value?.mentionSource);
provide("activateCanvasPanel", () => switchPanel("canvas"));
provide("performWorkspaceFileAction", (directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, entryType: "canvas" | "directory" = "canvas") =>
  documentPanelRef.value ? documentPanelRef.value.performFileAction(directory, action, path, target, entryType) : performFileAction(directory, action, path, target));

const controlLifetime = new AbortController();
onScopeDispose(() => controlLifetime.abort(new Error("工作区已关闭")));
registerWorkspaceControl({
  getState: () => ({
    directory: workspaceStore.project?.directory ?? null,
    canvasId: canvasPanelRef.value?.canvasId || null,
    panel: activePanel.value,
    tools: canvasPanelRef.value?.canvasReady ? canvasPanelRef.value.getCanvasContext()?.tools ?? [] : [],
    document: documentPanelRef.value?.getDocument(false),
  }),
  flushSave,
  async call(request, signal) {
    const directory = workspaceStore.project?.directory;
    if (!directory) throw new Error("请先打开工作区");
    const callSignal = AbortSignal.any([signal, controlLifetime.signal]);
    const checkDirectory = () => {
      callSignal.throwIfAborted();
      if (directory !== workspaceStore.project?.directory) throw new Error("工作区已切换，本次调用已停止");
    };
    checkDirectory();
    if (request.name === "switchPanel") {
      if (request.args.panel !== "canvas" && request.args.panel !== "document") throw new Error("未知面板");
      if (!(await switchPanel(request.args.panel))) throw new Error("面板切换失败，请检查文档是否保存成功");
      checkDirectory();
      return { panel: activePanel.value };
    }
    if (["getDocument", "openDocument", "writeDocument"].includes(request.name)) {
      if (!(await switchPanel("document"))) throw new Error("文档面板无法打开");
      const panel = await waitForControlValue(() => documentPanelRef.value, callSignal);
      checkDirectory();
      if (request.name === "openDocument") await panel.openDocument(request.args, callSignal);
      if (request.name === "writeDocument") await panel.writeDocument(request.args, callSignal);
      checkDirectory();
      return panel.getDocument();
    }
    if (!(await switchPanel("canvas"))) throw new Error("画布面板无法打开");
    const context = await waitForControlValue(
      () => (canvasPanelRef.value?.canvasReady || (!canvasPanelRef.value?.canvasId && canvasPanelRef.value?.canvasListReady) ? canvasPanelRef.value.getCanvasContext() : undefined),
      callSignal
    );
    checkDirectory();
    return context.call({ name: request.name, args: request.args }, callSignal);
  },
});

async function flushSave() {
  await documentPanelRef.value?.flushSave();
  await canvasPanelRef.value?.flushSave();
}

onBeforeRouteLeave(async () => {
  if (canvasPanelRef.value?.saveBusy) {
    ElMessage.warning("画布操作尚未完成，请稍后退出");
    return false;
  }
  try {
    await flushSave();
    return true;
  } catch (error) {
    const message = axios.isAxiosError<{ message?: string }>(error)
      ? error.response?.data?.message || error.message
      : error instanceof Error
      ? error.message
      : "项目保存失败";
    const leave = await ElMessageBox.confirm(`无法保存项目：${message}。文件或目录可能已被移动或删除。仍然退出将丢弃尚未保存的修改。`, "项目未保存", {
      type: "warning",
      confirmButtonText: "仍然退出",
      cancelButtonText: "留在项目",
      closeOnClickModal: false,
    }).then(
      () => true,
      () => false
    );
    if (leave) {
      documentPanelRef.value?.cancelSave();
      canvasPanelRef.value?.cancelSave();
    }
    return leave;
  }
});

async function switchPanel(value: string | number | boolean) {
  if (value !== "canvas" && value !== "document") return false;
  try {
    if (activePanel.value === "document") await documentPanelRef.value?.flushSave();
    const changed = activePanel.value !== value;
    activePanel.value = value;
    await nextTick();
    if (changed) anonymousData.track(value === "canvas" ? "workspace.canvas" : "workspace.document");
    return true;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "文本保存失败");
    return false;
  }
}

function readDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNode(directory, canvasPath, nodeId);
}

function readDocumentNodes(directory: string, options?: DocumentNodeOptions) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.readDocumentNodes(directory, options);
}

async function focusDocumentNode(directory: string, canvasPath: string, nodeId: string) {
  if (!directory || workspaceStore.project?.directory !== directory) throw new Error("工作目录已切换，请重新选择节点");
  if (!await switchPanel("canvas")) throw new Error("画布面板无法打开");
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.focusDocumentNode(directory, canvasPath, nodeId);
}

function mountDocumentNode(directory: string, canvasPath: string, nodeId: string, target: HTMLElement) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.mountDocumentNode(directory, canvasPath, nodeId, target);
}

function resolveDocumentNodeFile(directory: string, path: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.resolveDocumentNodeFile(directory, path);
}

function observeDocumentNode(directory: string, canvasPath: string, nodeId: string, onState: (state: { dirty: boolean; error: string; deleted: boolean }) => void) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.observeDocumentNode(directory, canvasPath, nodeId, onState);
}

async function flushDocumentNodes() {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  await canvasPanelRef.value.flushSave();
}

function performFileAction(directory: string, action: "copy" | "rename" | "move" | "delete", path: string, target?: string, nodeId?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.performFileAction(directory, action, path, target, nodeId);
}

function saveDocumentNode(directory: string, canvasPath: string, nodeId: string, handleId: string, text: string, expectedText?: string) {
  if (!canvasPanelRef.value) throw new Error("画布尚未就绪");
  return canvasPanelRef.value.saveDocumentNode(directory, canvasPath, nodeId, handleId, text, expectedText);
}
</script>

<style scoped lang="scss">
.workspacePage {
  position: relative;
  width: 100%;
  height: 100dvh;
  background-color: var(--el-bg-color-page);
  .canvasPanel { position: absolute; inset: 0; width: calc(100% - var(--agentWidth, 0px)); container: canvasWorkspace / inline-size; &.backgroundPanel { opacity: 0; visibility: hidden; pointer-events: none; } }
  .workspaceMenu { position: absolute; top: 16px; left: 16px; z-index: 5; }
  .workspaceTools {
    position: absolute;
    inset: 0;
    width: calc(100% - var(--agentWidth, 0px));
    container: workspaceTools / inline-size;
    pointer-events: none;
    .panelSwitcher {
      --el-border-radius-base: var(--ui-radius);
      --el-segmented-bg-color: var(--el-bg-color-overlay);
      --el-segmented-item-selected-color: var(--el-color-primary);
      --el-segmented-item-selected-bg-color: var(--el-color-primary-light-9);
      position: absolute;
      top: 16px;
      left: 50%;
      z-index: 5;
      min-height: 34px;
      padding: 3px;
      border: 1px solid var(--el-border-color-light);
      box-shadow: none;
      font-size: 12px;
      transform: translateX(-50%);
      pointer-events: auto;
      .panelOption { display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0 6px; line-height: 24px; }
    }
    .bottomTools {
      position: absolute;
      bottom: 18px;
      left: 50%;
      z-index: 5;
      display: flex;
      align-items: center;
      gap: 8px;
      transform: translateX(-50%);
      pointer-events: auto;
      .toolMenu {
        flex-shrink: 0;
        transition: none;
        box-shadow: none;
        border-color: var(--el-border-color-light);
        .toolMenuContent {
          display: flex;
          align-items: center;
          gap: 3px;
          .toolButton { width: 32px; height: 32px; margin: 0; padding: 0; }
          .addNodeButton { margin-right: 6px; color: var(--el-color-white); background: var(--el-color-primary); border-color: transparent; &:hover { opacity: 0.85; } &.is-disabled { opacity: 0.45; } }
          .toolTrigger { display: inline-flex; }
          .el-divider { margin: 0; }
        }
      }
      .agentButton {
        position: absolute;
        left: calc(100% + 8px);
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        margin: 0;
        padding: 0;
        border: 1px solid var(--el-color-primary-light-7);
        border-radius: var(--ui-radius-large);
        background: var(--el-color-primary-light-9);
        color: var(--el-color-primary);
        box-shadow: none;
        &.standalone { position: relative; left: auto; }
        &:hover { border-color: var(--el-color-primary-light-5); background: var(--el-color-primary-light-8); }
        &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: 3px; }
      }
    }
  }
}
.helpMenu { display: flex; flex-direction: column; gap: 4px; .helpAction { justify-content: flex-start; margin-left: 0; } }
</style>
