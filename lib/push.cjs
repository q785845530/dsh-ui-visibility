// lib/push.js —— 三远端推送（GitHub + Gitee + AtomGit）
//
// 【全局约定】令牌一律走 lib/token-source.js：
//   环境变量 → 任务日记「关于」令牌库 → config/tokens.json。
// 不在命令里硬编码令牌，也不把令牌留在 .git/config 里。
//
// 用法：
//   node lib/push.js --dry      只打印打算做什么
//   node lib/push.js --create   先建公共仓库（不存在时）再推送
//   node lib/push.js            只推送
'use strict'

const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { resolveToken } = require('./token-source.cjs')

const ROOT = path.resolve(__dirname, '..')
const BRANCH = 'main'
const REPO = 'dsh-ui-visibility'
const DESC = 'DSH 界面管理插件：把左侧边栏条目与设置分区按需显示/隐藏（只改可见性，不启停插件）'

const REMOTES = [
  { name: 'origin', slot: 'github', host: 'github.com', api: 'https://api.github.com',
    user: 'q785845530', repo: `${'q785845530'}/${REPO}` },
  { name: 'gitee', slot: 'gitee', host: 'gitee.com', api: 'https://gitee.com/api/v5',
    user: 'wasen', repo: `wasen/${REPO}` },
  { name: 'atomgit', slot: 'atomgit', host: 'atomgit.com', api: 'https://api.atomgit.com/api/v5',
    user: 'gcw_zzRyjlPJ', repo: 'gcw_zzRyjlPJ/dsh-ui-visibility' },
]

function git(args, opts = {}) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts })
}

/** 推送用的代理：PUSH_PROXY 环境变量优先；否则探测本机 7891（本机实测可通 github） */
function detectProxy() {
  if (process.env.PUSH_PROXY) return process.env.PUSH_PROXY
  if (process.env.PUSH_PROXY === '') return null // 显式关闭
  // 同步探测：node 没有同步 connect，用 shell 的 /dev/tcp 最稳（不堵事件循环）
  const { execFileSync } = require('node:child_process')
  for (const cand of ['http://127.0.0.1:7891', 'http://127.0.0.1:7890']) {
    const port = new URL(cand).port
    try {
      execFileSync('bash', ['-c', `timeout 1 bash -c 'echo > /dev/tcp/127.0.0.1/${port}'`],
        { stdio: 'ignore' })
      return cand
    } catch { /* 下一个 */ }
  }
  return null
}

function authedUrl(r, token) {
  return `https://${r.user}:${encodeURIComponent(token)}@${r.host}/${r.repo}.git`
}

/** 建公共仓库；已存在则视作成功 */
async function ensureRepo(r, token) {
  if (r.slot === 'github') {
    const res = await fetch(`${r.api}/user/repos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
                 'Content-Type': 'application/json', 'User-Agent': 'dsh-ui-visibility' },
      body: JSON.stringify({ name: REPO, description: DESC, private: false, has_issues: true }),
    })
    if (res.status === 201) return { ok: true, created: true }
    const body = await res.text()
    if (res.status === 422 && /already exists/i.test(body)) return { ok: true, created: false }
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 160)}` }
  }
  if (r.slot === 'gitee' || r.slot === 'atomgit') {
    const form = new URLSearchParams({ access_token: token, name: REPO, path: REPO,
      private: 'false', description: DESC, auto_init: 'false' })
    const res = await fetch(`${r.api}/user/repos`, { method: 'POST', body: form })
    const body = await res.text()
    if (res.ok) return { ok: true, created: true }
    if (/already exist|已存在|重复/i.test(body)) return { ok: true, created: false }
    return { ok: false, reason: `HTTP ${res.status}: ${body.slice(0, 160)}` }
  }
  // AtomGit：接口与账号待定，先只推送
  return { ok: true, created: false, note: 'AtomGit 建仓未实现（缺令牌与账号名）' }
}

/** 把 v5 风格仓库强制设为公开（Gitee 建仓时 private 参数会被忽略，必须 PATCH 一次） */
async function ensurePublicV5(r, token) {
  const url = `${r.api}/repos/${r.repo}`
  const body = new URLSearchParams({ access_token: token, name: REPO, private: 'false' })
  try {
    const res = await fetch(url, { method: 'PATCH', body })
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` }
    const j = await res.json().catch(() => ({}))
    return { ok: true, public: j.public ?? j.private === false }
  } catch (e) { return { ok: false, reason: String(e.message || e) } }
}

async function main() {
  const dry = process.argv.includes('--dry')
  const create = process.argv.includes('--create')
  const proxy = detectProxy()
  if (proxy) console.log(`  使用代理：${proxy}`)
  const results = []

  const onlyArg = process.argv.find((a) => a.startsWith('--only='))
  const only = onlyArg ? onlyArg.split('=')[1].split(',') : null
  console.log(`════ 推送 ${REPO}（分支 ${BRANCH}${only ? `，仅 ${only.join('/')}` : ''}）════`)
  for (const r of REMOTES) {
    if (only && !only.includes(r.slot)) continue
    const { value: token, source } = resolveToken(r.slot)
    if (!token) {
      console.log(`  ⚠️  ${r.name}：无令牌，跳过 —— 去「任务日记 → 关于」保存 ${r.slot} 令牌`)
      results.push({ remote: r.name, ok: false, reason: 'NO_TOKEN' })
      continue
    }
    if (!r.repo) {
      console.log(`  ⚠️  ${r.name}：账号/仓库地址未定，跳过`)
      results.push({ remote: r.name, ok: false, reason: 'NO_REMOTE' })
      continue
    }
    console.log(`  → ${r.name}（${r.repo}｜令牌来源 ${source}，${token.slice(0, 4)}…${token.slice(-4)}）`)

    if (create && !dry) {
      const made = await ensureRepo(r, token)
      if (!made.ok) {
        console.log(`    ❌ 建仓失败: ${made.reason}`)
        results.push({ remote: r.name, ok: false, reason: made.reason })
        continue
      }
      console.log(`    ${made.created ? '✅ 已建公共仓库' : 'ℹ️  仓库已存在'}`)
      if (r.slot === 'gitee' || r.slot === 'atomgit') {
        const pub = await ensurePublicV5(r, token)
        console.log(pub.ok ? '    ✅ 已确认为公开' : `    ⚠️  改公开失败：${pub.reason}`)
      }
    }
    if (dry) { results.push({ remote: r.name, ok: true, dry: true }); continue }

    try {
      // 直接用带令牌的 URL 推，避免令牌写进 .git/config
      const proxyArgs = proxy ? ['-c', `http.proxy=${proxy}`, '-c', `https.proxy=${proxy}`] : []
      const out = git([...proxyArgs, 'push', authedUrl(r, token), `${BRANCH}:${BRANCH}`],
        { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 })
      console.log('    ✅ 推送成功')
      results.push({ remote: r.name, ok: true })
      if (out.trim()) console.log('    ' + out.trim().split('\n').slice(-2).join('\n    '))
    } catch (e) {
      const msg = String(e.stderr || e.message || '').split('\n').filter(Boolean).slice(-3).join(' | ')
      console.log(`    ❌ 推送失败: ${msg}`)
      results.push({ remote: r.name, ok: false, reason: msg })
    }
  }
  const okCount = results.filter((x) => x.ok).length
  console.log(`\n  结论：${okCount}/${REMOTES.length} 个远端完成`)
  return okCount === REMOTES.length ? 0 : 1
}

module.exports = { main, REMOTES }
if (require.main === module) main().then((c) => process.exit(c))
