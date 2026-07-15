// ================================================================
// ADB控制层 - 连接雷电模拟器，执行截图/点击/输入/UI解析
// ================================================================
import { execSync, exec } from 'child_process';
import fs from 'fs';
import path from 'path';

const CONFIG = {
  adbPath: 'adb',                    // adb路径（雷电自带，加到PATH或用完整路径）
  host: '127.0.0.1',
  port: 5555,                        // 雷电模拟器ADB端口
  screenshotDir: 'data/screenshots/' // 截图保存目录
};

export function configure(cfg) { Object.assign(CONFIG, cfg); }
export function getConfig() { return { ...CONFIG }; }

function adb(cmd, device = '') {
  const dev = device || `${CONFIG.host}:${CONFIG.port}`;
  return execSync(`${CONFIG.adbPath} -s ${dev} ${cmd}`, { encoding: 'utf-8', timeout: 10000 });
}

// 连接模拟器
export function connect() {
  try {
    const r = execSync(`${CONFIG.adbPath} connect ${CONFIG.host}:${CONFIG.port}`, { encoding: 'utf-8', timeout: 5000 });
    return { ok: r.includes('connected') || r.includes('already'), message: r.trim() };
  } catch (e) { return { error: '连接失败: ' + e.message }; }
}

// 断开
export function disconnect() {
  try { execSync(`${CONFIG.adbPath} disconnect ${CONFIG.host}:${CONFIG.port}`); return { ok: true }; }
  catch (e) { return { error: e.message }; }
}

// 截图
export function screenshot(name) {
  try {
    if (!fs.existsSync(CONFIG.screenshotDir)) fs.mkdirSync(CONFIG.screenshotDir, { recursive: true });
    const file = path.join(CONFIG.screenshotDir, name + '.png');
    const buf = execSync(`${CONFIG.adbPath} -s ${CONFIG.host}:${CONFIG.port} exec-out screencap -p`, { timeout: 5000 });
    fs.writeFileSync(file, buf);
    return { file };
  } catch (e) { return { error: '截图失败: ' + e.message }; }
}

// 点击坐标
export function tap(x, y) {
  try { adb(`shell input tap ${x} ${y}`); return { ok: true }; }
  catch (e) { return { error: e.message }; }
}

// 输入文字
export function inputText(text) {
  try {
    const safe = text.replace(/ /g, '%s').replace(/"/g, '\\"').replace(/[&|<>()^!]/g, '');
    adb(`shell input text "${safe}"`);
    return { ok: true };
  } catch (e) { return { error: e.message }; }
}

// 获取UI布局（uiautomator dump）
export function dumpUI() {
  try {
    adb('shell uiautomator dump /sdcard/ui.xml');
    const xml = execSync(`${CONFIG.adbPath} -s ${CONFIG.host}:${CONFIG.port} shell cat /sdcard/ui.xml`, { encoding: 'utf-8', timeout: 5000 });
    return { xml };
  } catch (e) { return { error: 'UI解析失败: ' + e.message }; }
}

// 按文字查找按钮位置（从UI XML中查找）
export function findText(text) {
  const r = dumpUI();
  if (r.error) return r;
  // 在XML中查找包含目标文字的按钮
  const match = r.xml.match(new RegExp(`text="${text}"[^>]*bounds="\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]"`));
  if (match) {
    const cx = (parseInt(match[1]) + parseInt(match[3])) / 2;
    const cy = (parseInt(match[2]) + parseInt(match[4])) / 2;
    return { x: Math.round(cx), y: Math.round(cy), bounds: match[0] };
  }
  // 模糊匹配：包含该文字的
  const fuzz = r.xml.match(new RegExp(`text="[^"]*${escapeRegex(text)}[^"]*"[^>]*bounds="\\[(-?\\d+),(-?\\d+)\\]\\[(-?\\d+),(-?\\d+)\\]"`));
  if (fuzz) {
    const cx = (parseInt(fuzz[1]) + parseInt(fuzz[3])) / 2;
    const cy = (parseInt(fuzz[2]) + parseInt(fuzz[4])) / 2;
    return { x: Math.round(cx), y: Math.round(cy), fuzzy: true };
  }
  return { error: `未找到文字"${text}"` };
}

function escapeRegex(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// 按文字点击
export function tapText(text) {
  const pos = findText(text);
  if (pos.error) return pos;
  return tap(pos.x, pos.y);
}

// 获取剪贴板内容（用于获取注册后的QQ号）
export function getClipboard() {
  try {
    const r = adb('shell am broadcast -a clipper.get').trim();
    return { text: r };
  } catch { return { error: '获取剪贴板失败' }; }
}

// 检查设备是否在线
export function isOnline() {
  try {
    const r = execSync(`${CONFIG.adbPath} -s ${CONFIG.host}:${CONFIG.port} shell getprop sys.boot_completed`, { encoding: 'utf-8', timeout: 3000 }).trim();
    return r === '1';
  } catch { return false; }
}

export default {
  configure, getConfig, connect, disconnect, screenshot, tap, inputText,
  tapText, findText, dumpUI, isOnline
};
