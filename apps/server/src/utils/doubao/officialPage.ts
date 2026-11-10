import type { Page } from "puppeteer-core";
import { canonical, invalid } from "./types";

type PageElement = { textContent: string | null; disabled?: boolean; getBoundingClientRect(): { width: number }; getAttribute(name: string): string | null };
declare const document: { querySelector(selector: string): PageElement | null; querySelectorAll(selector: string): PageElement[] };

async function clickChoice(page: Page, selector: string, pattern: string) {
  await page.waitForFunction((selector, pattern) => [...document.querySelectorAll(selector)].filter(element =>
    element.getBoundingClientRect().width > 0 && new RegExp(pattern).test(element.textContent?.trim() ?? "")).length === 1,
  { timeout: 30000 }, selector, pattern);
  const elements = await page.$$(selector);
  try {
    const matching = await Promise.all(elements.map(element => element.evaluate((element, pattern) =>
      element.getBoundingClientRect().width > 0 && new RegExp(pattern).test(element.textContent?.trim() ?? ""), pattern)));
    if (matching.filter(Boolean).length !== 1) invalid("找不到唯一的官方参数选项", 409, "VIDEO_PARAMETERS_NOT_READY");
    await elements[matching.indexOf(true)]!.click();
  } finally { await Promise.all(elements.map(element => element.dispose())); }
}

export async function configureVideoPage(page: Page) {
  await page.waitForSelector('[data-testid="chat_input"] textarea, [data-testid="chat_input"] [contenteditable="true"]',
    { visible: true, timeout: 90000 });
  const editor = await page.$('[data-testid="chat_input"] [contenteditable="true"]') ?? await page.$('[data-testid="chat_input"] textarea');
  await editor!.click();
  // ACT: 首屏可能先渲染空输入壳，技能栏稍后才加载；不能把壳当成已准备完成。
  await page.waitForFunction(() => document.querySelector('[data-input-engine-actionbar-control-key="video-model"]')
    || document.querySelector('[data-testid="skill_bar_button_17"]'), { timeout: 90000 });
  if (!await page.$('[data-input-engine-actionbar-control-key="video-model"]'))
    await page.click('[data-testid="skill_bar_button_17"]');
  const model = await page.waitForSelector('[data-input-engine-actionbar-control-key="video-model"]', { visible: true, timeout: 90000 });
  if (!/Seedance\s*2\.0\s*Mini\s*$/.test(await model!.evaluate(element => element.textContent ?? ""))) {
    await model!.click();
    await clickChoice(page, '[role="menuitem"], [role="menu"] button', '^Seedance\\s*2\\.0\\s*Mini');
  }
  const parameters = '[data-input-engine-actionbar-render-entry-key="video-generation-params-panel"]';
  await page.waitForSelector(parameters, { visible: true, timeout: 30000 });
  await page.click(parameters);
  await clickChoice(page, "button", "^9:16$");
  const slider = await page.waitForSelector('[role="slider"]', { visible: true, timeout: 15000 });
  await slider!.press("End");
  await page.keyboard.press("Escape");
  await page.waitForFunction(selector => /9:16\s*·\s*15s/.test(document.querySelector(selector)?.textContent ?? ""),
    { timeout: 15000 }, parameters);
  await page.waitForSelector('input[type="file"][accept*=".png"]', { timeout: 30000 });
}

export async function writeVideoText(page: Page, text: string) {
  const editor = await page.$('[data-testid="chat_input"] [contenteditable="true"]') ?? await page.$('[data-testid="chat_input"] textarea');
  if (!editor) invalid("官方视频输入框尚未就绪", 409, "VIDEO_EDITOR_NOT_READY");
  await editor.click();
  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.sendCharacter(text);
  const actual = await editor.evaluate(element => element.tagName === "TEXTAREA"
    ? (element as unknown as { value: string }).value : (element as unknown as { innerText: string }).innerText);
  // 官网富文本段落会增加显示换行；提交拦截仍逐字校验真实请求和缓存原文。
  if (canonical(actual).replace(/\s/g, "") !== canonical(text).replace(/\s/g, ""))
    invalid("官方输入框未完整接收提示词，已停止提交", 409, "INTENT_MISMATCH");
}

export async function sendVideoText(page: Page, beforeClick: () => void) {
  const selector = '[data-testid="chat_input_send_button"]';
  await page.waitForSelector(selector, { visible: true, timeout: 30000 });
  await page.waitForFunction(selector => {
    const button = document.querySelector(selector);
    return button && !button.disabled && button.getAttribute("aria-disabled") !== "true";
  }, { timeout: 30000 }, selector);
  beforeClick();
  await page.click(selector);
}
