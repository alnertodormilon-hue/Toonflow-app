<template>
  <el-container class="home">
    <el-header class="pageHeader">
      <div class="headerBrand">
        <img :src="logoUrl" alt="" />
        <span>{{ brand.name }}</span>
      </div>
      <div class="headerActions">
        <el-badge isDot :hidden="!hasDesktopUpdate">
          <el-button size="large" :icon="IconSettings" :aria-label="hasDesktopUpdate ? '设置，有新版本可用' : '设置'" @click="settingsVisible = true">设置</el-button>
        </el-badge>
        <el-button size="large" :type="deviceHubEnabled ? 'success' : undefined" :plain="deviceHubEnabled" :icon="deviceHubEnabled || mobileConnection.mode === 'remote' ? IconDeviceDesktop : IconQrcode" @click="mobileConnectVisible = true">{{ mobileConnectionLabel }}</el-button>
        <el-button text :icon="IconBrandGithub" tag="a" :href="brand.repositoryUrl" target="_blank" rel="noopener noreferrer" aria-label="查看项目源码">项目源码</el-button>
      </div>
    </el-header>
    <el-main class="pageContent">
      <section class="creationPanel" aria-label="创建项目">
        <div class="brand">
          <el-image class="brandLogo" :src="logoUrl" fit="contain" :alt="brand.name" />
          <h1>{{ brand.name }}</h1>
        </div>
        <p class="brandDescription">{{ brand.description }}</p>
        <div class="promptArea">
          <p class="composerLabel">从一个想法开始</p>
          <el-card class="promptCard" :class="{ draggingAttachments }" shadow="never" :bodyStyle="{ padding: '20px' }" :footerStyle="{ padding: '12px 16px' }" @dragenter.capture="dragEnterAttachments" @dragover.capture="dragOverAttachments" @dragleave.capture="dragLeaveAttachments" @drop.capture="dropAttachments">
            <div v-if="draggingAttachments" class="attachmentDropOverlay" role="status" aria-live="polite">
              <icon-paperclip :size="20" aria-hidden="true" />
              <strong>松开添加附件</strong>
              <span>图片、视频、文档或代码文件</span>
            </div>
            <input ref="attachmentInput" type="file" :accept="attachmentAccept" multiple hidden :disabled="creating || opening" @change="selectAttachments" />
            <attachmentList v-if="promptAttachments.length" class="promptAttachments" :attachments="promptAttachments" removable restorable :disabled="creating || opening" @remove="promptAttachments.splice($event, 1)" @restore="restoreAttachment" />
            <el-input ref="promptInput" v-model="prompt" type="textarea" :rows="4" resize="none" :disabled="creating || opening" :placeholder="promptPlaceholder" aria-label="创作描述" @paste.capture="pasteAttachments" />
            <template #footer>
              <div class="composerFooter">
                <workspacePicker ref="promptWorkspacePicker" v-model="workspaceDirectory" :disabled="creating || opening" />
                <el-space class="sendActions" wrap :size="12">
                  <el-button text circle :icon="IconPaperclip" :disabled="creating || opening" aria-label="添加附件" title="添加附件" @click="attachmentInput?.click()" />
                  <modelPopover v-model="selectedModel" v-model:reasoningEffort="reasoningEffort" class="modelSelect" :disabled="creating || opening" />
                  <el-button class="sendButton" type="primary" :circle="!!workspaceDirectory" :icon="workspaceDirectory ? IconArrowUp : IconFolder" :loading="creating" :disabled="creating || opening" :aria-label="workspaceDirectory ? '发送' : '选择工作目录'" @click="workspaceDirectory ? createProject() : promptWorkspacePicker?.chooseDirectory()">
                    <template v-if="!workspaceDirectory" #default>选择工作目录</template>
                  </el-button>
                </el-space>
              </div>
              <p v-if="!workspaceDirectory" class="workspaceHint" role="status">请先选择一个空文件夹作为工作目录，画布和素材会保存在这里。</p>
            </template>
          </el-card>
        </div>
      </section>
      <section class="projectList" aria-labelledby="projectListTitle">
        <div class="sectionHeader">
          <h2 id="projectListTitle">最近项目</h2>
          <el-space wrap>
            <el-button :icon="IconFolderOpen" :disabled="creating || opening" @click="openProject()">导入项目</el-button>
            <el-button :icon="IconFolderPlus" :disabled="creating || opening" @click="createProject(false)">添加项目</el-button>
            <el-button circle :icon="sortDescending ? IconSortDescending : IconSortAscending" :aria-label="sortDescending ? '按时间降序' : '按时间升序'" @click="sortDescending = !sortDescending" />
            <el-radio-group v-model="viewMode" aria-label="项目视图">
              <el-radio-button value="grid" aria-label="网格视图"><icon-layout-grid :size="16" /></el-radio-button>
              <el-radio-button value="list" aria-label="列表视图"><icon-list :size="16" /></el-radio-button>
            </el-radio-group>
          </el-space>
        </div>
        <div class="projectItems" :class="{ listView: viewMode === 'list' }">
          <el-card v-for="project in sortedProjects" :key="project.directory" class="projectCard" shadow="never" :bodyStyle="{ padding: '0' }">
            <button class="projectEntry" type="button" :disabled="creating || opening" :aria-label="`打开项目 ${project.name}`" @click="openProject(project)">
              <icon-folder class="projectIcon" :size="28" aria-hidden="true" />
              <span class="projectInfo">
                <span class="projectName" :title="project.name">{{ project.name }}</span>
                <span class="projectPath" :title="project.directory">{{ project.directory }}</span>
                <span class="projectTime">最近打开 {{ new Date(project.lastOpenedAt).toLocaleString(locale, { hour12: false }) }}</span>
              </span>
            </button>
            <div class="projectActions">
              <el-button text :icon="IconEdit" :disabled="creating || opening" :aria-label="`重命名项目 ${project.name}`" title="重命名" @click="renameProject(project)" />
              <el-button text type="danger" :icon="IconFolderMinus" :disabled="creating || opening" :aria-label="`移除项目 ${project.name}`" title="从列表移除，不删除文件" @click="workspaceStore.removeProject(project.directory)" />
            </div>
          </el-card>
        </div>
      </section>
    </el-main>
    <settings v-model="settingsVisible" />
    <mobileConnect v-model="mobileConnectVisible" />
    <workspacePicker ref="relocationPicker" hideTrigger />
  </el-container>
</template>

<script setup lang="ts">
import { locale, translate } from "@toonflow/i18n/vue";
import axios from "axios";
import { storeToRefs } from "pinia";
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { ElMessage, ElMessageBox, type InputInstance } from "element-plus";
import { getReadableFileMimeType, readableFileAccept } from "@toonflow/server/documentFormats";
import {
  IconSettings, IconBrandGithub, IconQrcode, IconDeviceDesktop,
  IconArrowUp, IconLayoutGrid,
  IconList, IconSortDescending,
  IconSortAscending, IconFolder, IconEdit,
  IconFolderMinus, IconFolderPlus, IconFolderOpen, IconPaperclip,
} from "@tabler/icons-vue";
import modelPopover from "@/components/modelPopover.vue";
import attachmentList from "@/components/agent/attachmentList.vue";
import { createPastedTextFile, readTextAttachment } from "@/components/agent/textAttachments";
import type { AgentAttachment } from "@/components/agent/types";
import logoUrl from "@toonflow/assets/logo.svg";
import brand from "@toonflow/assets/brand.ts";
import { useWorkspaceStore, type Project } from "@/stores/workspace";
import { hasDesktopUpdate } from "@/stores/desktopUpdate";
import { deviceHubEnabled, mobileConnection, mobileConnectionLabel } from "@/lib/mobile";
import useWorkspaceFiles from "@/lib/workspaceFiles";
import settings from "@/components/settings/index.vue";
import workspacePicker from "./workspacePicker.vue";

const settingsVisible = ref(false);
const mobileConnectVisible = ref(false);
const mobileConnect = defineAsyncComponent(() => import("@/components/mobileConnect.vue"));
const router = useRouter();
const creating = ref(false);
const opening = ref(false);
const promptWorkspacePicker = ref<InstanceType<typeof workspacePicker>>();
const relocationPicker = ref<InstanceType<typeof workspacePicker>>();
const prompt = ref("");
const promptInput = ref<InputInstance>();
const promptAttachments = ref<AgentAttachment[]>([]);
const attachmentInput = ref<HTMLInputElement>();
const attachmentAccept = `image/*,video/*,${readableFileAccept}`;
const draggingAttachments = ref(false);
let attachmentDragDepth = 0;
const workspaceStore = useWorkspaceStore();
const { project, projectList } = storeToRefs(workspaceStore);
const workspaceDirectory = ref(project.value?.directory ?? "");
const placeholderPhrases = [
  "描述你想创作的内容，让灵感从这里开始…",
  "把一个故事灵感，变成一段精彩的短片…",
  "为你的主角设计独特的外形和性格…",
  "创作一段雨夜街头的电影感镜头…",
  "把这段文字拆解成连贯的分镜画面…",
  "为一场奇幻冒险生成场景和角色…",
  "为你的画面配上一段合适的音乐…",
  "写一段温暖的旁白，讲述这个故事…",
  "设计一支富有想象力的产品宣传片…",
  "从一句话开始，搭建你的创作工作流…",
];
const promptPlaceholder = ref(translate(placeholderPhrases[0]!));

onMounted(() => {
  window.addEventListener("dragend", clearAttachmentDrag, true);
  window.addEventListener("drop", clearAttachmentDrag, true);
  window.addEventListener("blur", clearAttachmentDrag);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let phraseIndex = 0;
  watch([() => !!prompt.value, locale], ([hasInput], _previous, onCleanup) => {
    if (reduceMotion) {
      promptPlaceholder.value = translate(placeholderPhrases[0]!);
      return;
    }
    if (hasInput) return;
    const segmenter = new Intl.Segmenter(locale.value, { granularity: "grapheme" });
    const phrases = placeholderPhrases.map(phrase => [...segmenter.segment(translate(phrase))].map(part => part.segment));
    let characterCount = 0;
    let deleting = false;
    let timer: ReturnType<typeof setTimeout>;
    promptPlaceholder.value = "";

    function typePlaceholder() {
      const phrase = phrases[phraseIndex]!;
      characterCount += deleting ? -1 : 1;
      promptPlaceholder.value = phrase.slice(0, characterCount).join("");
      let delay = deleting ? 35 : 85;
      if (characterCount === phrase.length) {
        deleting = true;
        delay = 1800;
      } else if (characterCount === 0) {
        deleting = false;
        phraseIndex = (phraseIndex + 1) % placeholderPhrases.length;
        delay = 300;
      }
      timer = setTimeout(typePlaceholder, delay);
    }

    timer = setTimeout(typePlaceholder, 300);
    onCleanup(() => clearTimeout(timer));
  }, { immediate: true });
});

onUnmounted(() => {
  window.removeEventListener("dragend", clearAttachmentDrag, true);
  window.removeEventListener("drop", clearAttachmentDrag, true);
  window.removeEventListener("blur", clearAttachmentDrag);
});
watch([creating, opening], ([creating, opening]) => {
  if (creating || opening) clearAttachmentDrag();
}, { flush: "sync" });

const selectedModel = ref("");
const reasoningEffort = ref("");
const sortDescending = ref(true);
const viewMode = ref("grid");
const sortedProjects = computed(() => [...projectList.value].sort((left, right) =>
  sortDescending.value ? right.lastOpenedAt - left.lastOpenedAt : left.lastOpenedAt - right.lastOpenedAt
));

function pasteAttachments(event: ClipboardEvent) {
  if (creating.value || opening.value) return;
  try {
    const files = Array.from(event.clipboardData?.files ?? []);
    if (!files.length) {
      const file = createPastedTextFile(event.clipboardData?.getData("text/plain") ?? "");
      if (file) files.push(file);
    }
    if (!files.length) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    addAttachments(files);
  } catch (error) {
    event.preventDefault();
    event.stopImmediatePropagation();
    ElMessage.error(error instanceof Error ? error.message : "添加附件失败，请重试");
  }
}

function selectAttachments(event: Event) {
  const input = event.target as HTMLInputElement;
  addAttachments(Array.from(input.files ?? []));
  input.value = "";
}

function clearAttachmentDrag() {
  attachmentDragDepth = 0;
  draggingAttachments.value = false;
}

function dragEnterAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  if (creating.value || opening.value) return clearAttachmentDrag();
  attachmentDragDepth++;
  draggingAttachments.value = true;
}

function dragOverAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = creating.value || opening.value ? "none" : "copy";
  if (creating.value || opening.value) return clearAttachmentDrag();
  attachmentDragDepth = Math.max(1, attachmentDragDepth);
  draggingAttachments.value = true;
}

function dragLeaveAttachments(event: DragEvent) {
  if (!draggingAttachments.value) return;
  attachmentDragDepth = Math.max(0, attachmentDragDepth - 1);
  const target = event.currentTarget;
  if (!attachmentDragDepth || (target instanceof Node && event.relatedTarget instanceof Node && !target.contains(event.relatedTarget))) clearAttachmentDrag();
}

function dropAttachments(event: DragEvent) {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  event.stopPropagation();
  clearAttachmentDrag();
  addAttachments(Array.from(event.dataTransfer.files));
}

function addAttachments(files: File[]) {
  if (creating.value || opening.value) return;
  for (const file of files) {
    const readableMimeType = getReadableFileMimeType(file.name, file.type);
    const mimeType = readableMimeType ?? file.type.split(";")[0]!.trim().toLowerCase();
    if (!readableMimeType && !/^(image|video)\//.test(mimeType)) {
      ElMessage.warning("只支持图片、视频和受支持的文本或文档文件");
      continue;
    }
    if (!file.size || file.size > 100 * 1024 * 1024) {
      ElMessage.warning("附件不能为空且不能超过 100 MB");
      continue;
    }
    if (mimeType === "text/plain" && file.size > 400000) {
      ElMessage.warning("文本附件不能超过 400000 字节");
      continue;
    }
    if (promptAttachments.value.length >= 20) {
      ElMessage.warning("每条消息最多添加 20 个附件");
      break;
    }
    promptAttachments.value.push({ name: file.name, path: "", mimeType, file });
  }
}

async function restoreAttachment(index: number) {
  const attachment = promptAttachments.value[index];
  if (attachment?.mimeType !== "text/plain" || creating.value || opening.value) return;
  try {
    const text = await readTextAttachment(attachment);
    const currentIndex = promptAttachments.value.indexOf(attachment);
    if (currentIndex < 0 || creating.value || opening.value) return;
    prompt.value += `${prompt.value ? "\n" : ""}${text}`;
    promptAttachments.value.splice(currentIndex, 1);
    await nextTick();
    promptInput.value?.focus();
    promptInput.value?.textarea?.setSelectionRange(prompt.value.length, prompt.value.length);
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : "取回文本失败，请重试");
  }
}

async function openProject(project?: Project) {
  if (creating.value || opening.value) return;
  opening.value = true;
  try {
    const directory = project?.directory ?? await relocationPicker.value?.chooseDirectory();
    if (!directory) return;
    try { await workspaceStore.openProject(directory); }
    catch (err) {
      if (!project || !axios.isAxiosError(err) || err.response?.status !== 404) throw err;
      const reselect = await ElMessageBox.confirm(`项目“${project.name}”的文件夹不存在，是否重新选择文件夹？`, "工作目录不存在", {
        confirmButtonText: "重新选择", cancelButtonText: "取消", type: "warning",
      }).then(() => true, () => false);
      if (!reselect) return;
      const directory = await relocationPicker.value?.chooseDirectory();
      if (!directory) return;
      await workspaceStore.openProject(directory, project.directory);
    }
    await router.push("/workspace");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "无法打开项目，请重试"
      : err instanceof Error ? err.message : "无法打开项目，请重试");
  } finally { opening.value = false; }
}

async function renameProject(project: Project) {
  const result = await ElMessageBox.prompt("请输入项目名称", "重命名项目", {
    inputValue: project.name, confirmButtonText: "保存", cancelButtonText: "取消",
    inputValidator: value => !!value?.trim() || "项目名称不能为空",
  }).catch(() => null);
  if (result) workspaceStore.renameProject(project.directory, result.value);
}

async function createProject(fromPrompt = true) {
  if (creating.value || opening.value || (fromPrompt && !workspaceDirectory.value)) return;
  creating.value = true;
  try {
    let path = workspaceDirectory.value;
    if (!fromPrompt) {
      const confirmed = await ElMessageBox.confirm("请选择一个空文件夹作为项目目录，画布和素材将保存在其中。", "添加项目", {
        confirmButtonText: "选择空文件夹", cancelButtonText: "取消", type: "info",
      }).then(() => true, () => false);
      if (!confirmed) return;
      path = await relocationPicker.value?.chooseDirectory() ?? "";
      if (!path) return;
    }
    const { directory, empty } = await useWorkspaceFiles(path).list();
    if (!empty) return ElMessage.warning("该文件夹不为空，请重新选择空文件夹；已有项目请使用“导入项目”或点击项目列表打开。");
    await useWorkspaceFiles(directory).writeJson("画布1.json", { toonflowCanvas: true, nodes: [], edges: [], viewport: { x: 0, y: 0, zoom: 1 } }, true);
    await workspaceStore.openProject(directory);
    if (fromPrompt && (prompt.value.trim() || promptAttachments.value.length)) {
      workspaceStore.pendingAgentMessage = { directory: workspaceStore.project!.directory, prompt: prompt.value, attachments: [...promptAttachments.value], model: selectedModel.value, reasoningEffort: reasoningEffort.value };
    }
    await router.push("/workspace");
  } catch (err) {
    ElMessage.error(axios.isAxiosError<{ message?: string }>(err)
      ? err.response?.data.message || "创建项目失败，请重试"
      : err instanceof Error ? err.message : "创建项目失败，请重试");
  } finally {
    creating.value = false;
  }
}
</script>

<style lang="scss" scoped>
.home {
  min-height: 100dvh;
  color: var(--el-text-color-primary);
  background: var(--el-bg-color-page);
  .pageHeader {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 20px;
    height: 76px;
    padding: 0 clamp(20px, 5vw, 72px);
    border-bottom: 1px solid var(--el-border-color-lighter);
    .headerBrand { display: flex; align-items: center; gap: 10px; color: inherit; font-size: 15px; font-weight: 600; text-decoration: none; }
    .headerBrand img { width: 28px; height: 28px; }
    .headerActions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .headerActions a { text-decoration: none; }
  }
  .pageContent {
    padding: 30px clamp(20px, 5vw, 72px) 64px;
    .creationPanel {
      max-width: 800px;
      margin: clamp(30px, 6vh, 64px) auto 64px;
      .brand { display: flex; align-items: center; justify-content: center; gap: 14px; }
      .brandLogo { width: 42px; height: 42px; }
      h1 { margin: 0; font-size: clamp(28px, 4vw, 38px); font-weight: 600; letter-spacing: -1px; }
      .brandDescription { margin: 16px 0 36px; color: var(--el-text-color-secondary); font-size: 14px; line-height: 1.8; text-align: center; }
      .composerLabel { margin: 0 0 12px 2px; color: var(--el-text-color-regular); font-size: 13px; }
      .promptCard {
        position: relative;
        border-radius: var(--ui-radius-large);
        border-color: var(--el-border-color);
        box-shadow: none;
        &:focus-within, &.draggingAttachments { border-color: var(--el-color-primary-light-5); }
        .attachmentDropOverlay {
          position: absolute;
          inset: 0;
          z-index: 2;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 5px;
          border-radius: inherit;
          background: var(--el-bg-color);
          color: var(--el-text-color-primary);
          pointer-events: none;
          > svg { color: var(--el-color-primary); }
          strong { font-size: 14px; font-weight: 500; }
          span { color: var(--el-text-color-secondary); font-size: 12px; }
        }
        .promptAttachments { margin-bottom: 12px; }
        :deep(.el-textarea__inner) { padding: 4px 0; box-shadow: none; background: transparent; font-size: 15px; line-height: 1.85; }
        :deep(.el-card__footer) { background: var(--el-fill-color-extra-light); }
        .composerFooter {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          .sendActions { margin-left: auto; justify-content: flex-end; }
          .modelSelect { width: 190px; }
          .sendButton { height: 36px; &.is-circle { width: 36px; } }
        }
        .workspaceHint { margin: 12px 0 0; color: var(--el-text-color-regular); font-size: 13px; line-height: 1.6; }
      }
    }
    .projectList {
      max-width: 1120px;
      margin: 0 auto;
      .sectionHeader {
        display: flex;
        align-items: center;
        justify-content: space-between;
        flex-wrap: wrap;
        gap: 16px;
        padding-bottom: 18px;
        border-bottom: 1px solid var(--el-border-color-lighter);
        h2 { margin: 0; font-size: 17px; font-weight: 600; }
      }
      .projectItems {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 290px), 1fr));
        gap: 14px;
        margin-top: 20px;
        &.listView { grid-template-columns: 1fr; }
        .projectCard {
          position: relative;
          border-color: var(--el-border-color-lighter);
          box-shadow: none;
          &:hover { border-color: var(--el-border-color-darker); }
          .projectActions { position: absolute; top: 14px; right: 8px; display: flex; gap: 2px; }
          .projectActions .el-button { width: 30px; height: 30px; margin: 0; padding: 0; }
        }
        .projectEntry {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          width: 100%;
          padding: 22px 80px 22px 20px;
          border: 0;
          background: transparent;
          color: inherit;
          font: inherit;
          text-align: left;
          cursor: pointer;
          &:focus-visible { outline: 2px solid var(--el-color-primary); outline-offset: -2px; }
          &:disabled { cursor: wait; opacity: 0.6; }
          .projectIcon { flex-shrink: 0; color: var(--el-color-primary); }
          .projectInfo { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
          .projectName, .projectPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
          .projectName { font-size: 14px; font-weight: 600; }
          .projectPath { font-size: 12px; color: var(--el-text-color-regular); }
          .projectTime { font-size: 11px; color: var(--el-text-color-secondary); }
        }
      }
    }
  }
  @media (max-width: 720px) {
    .pageHeader { min-height: 76px; height: auto; flex-wrap: wrap; padding-top: 16px; padding-bottom: 16px; }
    .headerActions { width: 100%; }
    .pageContent .creationPanel { margin-top: 20px; margin-bottom: 44px; }
  }
}
</style>
