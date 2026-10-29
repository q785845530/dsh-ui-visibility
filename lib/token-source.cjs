// lib/token-source.js —— 统一令牌来源
//
// 【全局约定】令牌统一从「任务日记 → 关于」的令牌库取，不再各处硬编码。
// 来源优先级（高 → 低）：
//   1. 环境变量（GH_TOKEN / GITHUB_TOKEN / GITEE_TOKEN）—— 便于轮换与 CI
//   2. 任务日记令牌库（DSH 任务日记插件「关于」页签里存的那份，加密落盘）
//      位置：$DSH_HOME/.dsh-task-journal/{key,tokens.json}，默认 /root/.dsh/.dsh-task-journal
//   3. config/tokens.json —— 本地兜底（已 gitignore）
//
// 为什么第 2 项要起子进程：任务日记的令牌是 AES-GCM 加密的，解密逻辑在它自己的
// ESM 模块里。本仓库是零依赖 CJS 工程，直接 import 会踩 ESM/CJS 互操作；
// 起一个 `node --input-type=module -e` 子进程是最稳的读法，且结果进程内缓存。
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const OPS_ROOT = path.resolve(__dirname, '..');
const FALLBACK_FILE = path.join(OPS_ROOT, 'config', 'tokens.json');

// 任务日记插件的候选安装位置（本机 web profile 优先，其次全局 checkout）
const JOURNAL_CANDIDATES = [
  '/root/.dsh/profiles/web/node_modules/dsh-task-journal/lib/tokens.js',
  path.resolve(OPS_ROOT, '..', 'dsh-task-journal', 'lib', 'tokens.js'),
  '/root/.dsh/dsh-task-journal/lib/tokens.js',
];

// 环境变量名映射（与任务日记 SLOTS 声明保持一致）
const ENV_VARS = {
  github: ['GH_TOKEN', 'GITHUB_TOKEN'],
  gitee: ['GITEE_TOKEN'],
};

const cache = new Map();

/** 找可用的任务日记 tokens.js 模块路径；找不到返回 null */
function findJournalModule() {
  for (const p of JOURNAL_CANDIDATES) {
    try {
      if (fs.existsSync(p)) return p;
    } catch { /* 忽略权限等异常，继续找下一个 */ }
  }
  return null;
}

/** 从任务日记令牌库读一个槽位（子进程 + 进程内缓存） */
function fromJournal(name) {
  const key = `journal:${name}`;
  if (cache.has(key)) return cache.get(key);

  const mod = findJournalModule();
  if (mod === null) {
    cache.set(key, null);
    return null;
  }

  let value = null;
  try {
    const script = `import { resolve } from ${JSON.stringify(mod)};` +
      `const v = await resolve(${JSON.stringify(name)});` +
      `process.stdout.write(v === null || v === undefined ? "" : String(v));`;
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    value = out && out.trim() !== '' ? out.trim() : null;
  } catch {
    value = null;
  }
  cache.set(key, value);
  return value;
}

/** 从环境变量读一个槽位 */
function fromEnv(name) {
  for (const env of ENV_VARS[name] || []) {
    const v = process.env[env];
    if (v && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** 从 config/tokens.json 兜底读 */
function fromFile(name) {
  try {
    const j = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8'));
    if (name === 'github') return j.github || null;
    if (name === 'gitee') return j.gitee || null;
    return null;
  } catch {
    return null;
  }
}

/**
 * 解析令牌。返回 { value, source }；找不到时 value 为 null。
 * source ∈ 'env' | 'journal' | 'file' | 'none'
 */
function resolveToken(name) {
  const env = fromEnv(name);
  if (env) return { value: env, source: 'env' };

  const journal = fromJournal(name);
  if (journal) return { value: journal, source: 'journal' };

  const file = fromFile(name);
  if (file) return { value: file, source: 'file' };

  return { value: null, source: 'none' };
}

/** 只取值，不要来源 */
function getToken(name) {
  return resolveToken(name).value;
}

/** 清缓存（令牌轮换后调用） */
function clearCache() {
  cache.clear();
}

module.exports = {
  resolveToken,
  getToken,
  clearCache,
  findJournalModule,
  JOURNAL_CANDIDATES,
  ENV_VARS,
  FALLBACK_FILE,
};

if (require.main === module) {
  for (const name of ['github', 'gitee']) {
    const r = resolveToken(name);
    const shown = r.value === null ? '（未配置）'
      : `${String(r.value).slice(0, 4)}…${String(r.value).slice(-4)}（${String(r.value).length} 字符）`;
    console.log(`${name.padEnd(7)} ${String(r.source).padEnd(8)} ${shown}`);
  }
}
