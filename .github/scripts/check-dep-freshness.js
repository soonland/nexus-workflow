#!/usr/bin/env node
// @ts-check
/**
 * Dependency Freshness Guard
 *
 * Detects production dependencies bumped to versions published fewer than
 * FRESHNESS_DAYS (default 5) days ago and posts a PR comment + fails CI.
 *
 * Environment variables (all provided by the GitHub Actions workflow):
 *   GITHUB_TOKEN   — for posting PR comments
 *   PR_NUMBER      — pull request number
 *   BASE_SHA       — base commit SHA
 *   REPO           — "owner/repo"
 *   FRESHNESS_DAYS — optional override (default 5)
 */

'use strict';

const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const FRESHNESS_DAYS = parseInt(process.env.FRESHNESS_DAYS ?? '5', 10);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN ?? '';
const PR_NUMBER = process.env.PR_NUMBER ?? '';
const BASE_SHA = process.env.BASE_SHA ?? '';
const REPO = process.env.REPO ?? '';
const BOT_MARKER = '<!-- dep-freshness-guard -->';

// ---------------------------------------------------------------------------
// Pure functions (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Parse a package-lock.json (npm v2/v3) and return a map of
 * { "package-name": { version: string, dev: boolean } }
 * Only includes top-level packages (node_modules/<name> entries).
 *
 * @param {string} content
 * @returns {Record<string, { version: string; dev: boolean }>}
 */
function parseNpmLockFile(content) {
  /** @type {Record<string, { version: string; dev: boolean }>} */
  const result = {};
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    return result;
  }
  const packages = parsed.packages ?? {};
  for (const [key, meta] of Object.entries(packages)) {
    // Only top-level node_modules entries; skip nested (node_modules/.../node_modules/...)
    if (!key.startsWith('node_modules/')) continue;
    const name = key.slice('node_modules/'.length);
    if (name.includes('/node_modules/')) continue; // nested dep
    if (typeof meta.version !== 'string') continue;
    result[name] = {
      version: meta.version,
      dev: meta.dev === true || meta.devOptional === true,
    };
  }
  return result;
}

/**
 * Parse a yarn.lock file and return a map of
 * { "package-name": { version: string, dev: boolean } }
 * dev is always false — yarn.lock doesn't encode dev status per-entry.
 *
 * @param {string} content
 * @returns {Record<string, { version: string; dev: boolean }>}
 */
function parseYarnLockFile(content) {
  /** @type {Record<string, { version: string; dev: boolean }>} */
  const result = {};
  // Each block starts with one or more descriptor lines, followed by indented fields.
  // e.g.:
  //   "lodash@^4.17.21":
  //     version "4.17.21"
  const blocks = content.split(/\n(?=\S)/);
  for (const block of blocks) {
    const headerMatch = block.match(/^"?(@?[^@"]+)@/);
    if (!headerMatch) continue;
    const name = headerMatch[1].trim();
    const versionMatch = block.match(/^\s+version\s+"([^"]+)"/m);
    if (!versionMatch) continue;
    result[name] = { version: versionMatch[1], dev: false };
  }
  return result;
}

/**
 * Parse a pnpm-lock.yaml file and return a map of
 * { "package-name": { version: string, dev: boolean } }
 *
 * @param {string} content
 * @returns {Record<string, { version: string; dev: boolean }>}
 */
function parsePnpmLockFile(content) {
  /** @type {Record<string, { version: string; dev: boolean }>} */
  const result = {};
  // pnpm-lock.yaml snapshots section (v6+):
  //   snapshots:
  //     lodash@4.17.21:
  //       ...
  // or packages section (v5):
  //   /lodash/4.17.21:
  const lines = content.split('\n');
  for (const line of lines) {
    // v6+ snapshot: "  name@version:" at top level under snapshots
    const snapshotMatch = line.match(/^  (@?[^@\s]+)@([\d][^\s:]*):$/);
    if (snapshotMatch) {
      result[snapshotMatch[1]] = { version: snapshotMatch[2], dev: false };
      continue;
    }
    // v5 package: "  /name/version:"
    const v5Match = line.match(/^  \/(@?[^/]+(?:\/[^/]+)?)\/([^:]+):$/);
    if (v5Match) {
      result[v5Match[1]] = { version: v5Match[2], dev: false };
    }
  }
  return result;
}

/**
 * Detect which production dependencies were bumped between base and head.
 *
 * @param {Record<string, { version: string; dev: boolean }>} base
 * @param {Record<string, { version: string; dev: boolean }>} head
 * @returns {{ name: string; oldVersion: string | null; newVersion: string }[]}
 */
function detectBumps(base, head) {
  /** @type {{ name: string; oldVersion: string | null; newVersion: string }[]} */
  const bumps = [];
  for (const [name, headMeta] of Object.entries(head)) {
    if (headMeta.dev) continue; // skip dev deps
    const baseMeta = base[name];
    if (!baseMeta) {
      // New package added
      bumps.push({ name, oldVersion: null, newVersion: headMeta.version });
    } else if (baseMeta.version !== headMeta.version) {
      // Version changed
      bumps.push({ name, oldVersion: baseMeta.version, newVersion: headMeta.version });
    }
  }
  return bumps;
}

/**
 * Format the PR comment body for flagged packages.
 *
 * @param {{ name: string; version: string; publishedAt: string; ageInDays: number }[]} flagged
 * @param {number} freshnessThreshold
 * @returns {string}
 */
function formatComment(flagged, freshnessThreshold) {
  if (flagged.length === 0) return '';

  const rows = flagged
    .map(
      (p) =>
        `| \`${p.name}\` | \`${p.version}\` | ${p.publishedAt} | ${p.ageInDays} day${p.ageInDays === 1 ? '' : 's'} |`,
    )
    .join('\n');

  return `${BOT_MARKER}
## Dependency Freshness Warning

The following production ${flagged.length === 1 ? 'dependency was' : 'dependencies were'} bumped to a version published **fewer than ${freshnessThreshold} days ago**. Very new releases may contain undiscovered regressions or breaking changes. Please review carefully before merging.

| Package | Version | Published | Age |
|---------|---------|-----------|-----|
${rows}

> To proceed, a team member must dismiss this check override via the GitHub UI, or wait until the packages are older than ${freshnessThreshold} days.
`;
}

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

/**
 * Read a file's content at a specific git commit (or null if it didn't exist).
 *
 * @param {string} sha
 * @param {string} filePath - path relative to repo root
 * @returns {string | null}
 */
function gitShow(sha, filePath) {
  try {
    return execSync(`git show "${sha}:${filePath}"`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    return null; // File didn't exist at that commit
  }
}

/**
 * Find all lock files that changed between base and head.
 *
 * @param {string} baseSha
 * @returns {string[]}
 */
function changedLockFiles(baseSha) {
  const output = execSync(`git diff --name-only "${baseSha}" HEAD`, {
    encoding: 'utf8',
  });
  const changed = output.trim().split('\n').filter(Boolean);
  return changed.filter((f) =>
    ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'].some((name) => f.endsWith(name)),
  );
}

/**
 * @param {string} lockFilePath
 * @returns {'npm' | 'yarn' | 'pnpm' | null}
 */
function lockFileType(lockFilePath) {
  const base = path.basename(lockFilePath);
  if (base === 'package-lock.json') return 'npm';
  if (base === 'yarn.lock') return 'yarn';
  if (base === 'pnpm-lock.yaml') return 'pnpm';
  return null;
}

/**
 * @param {string} content
 * @param {'npm' | 'yarn' | 'pnpm'} type
 * @returns {Record<string, { version: string; dev: boolean }>}
 */
function parseLockFile(content, type) {
  if (type === 'npm') return parseNpmLockFile(content);
  if (type === 'yarn') return parseYarnLockFile(content);
  if (type === 'pnpm') return parsePnpmLockFile(content);
  return {};
}

/**
 * Query the npm registry for the publish date of a specific package@version.
 * Returns null on network error (graceful degradation).
 *
 * @param {string} name
 * @param {string} version
 * @returns {Promise<string | null>} ISO date string or null
 */
async function fetchPublishDate(name, version) {
  const encodedName = name.startsWith('@')
    ? `@${encodeURIComponent(name.slice(1))}`
    : encodeURIComponent(name);
  const url = `https://registry.npmjs.org/${encodedName}`;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = /** @type {any} */ (await res.json());
    const time = data.time?.[version];
    return time ?? null;
  } catch {
    return null;
  }
}

/**
 * Find or update a bot comment on the PR. Returns the comment ID if found.
 *
 * @param {string} repo
 * @param {number} prNumber
 * @returns {Promise<number | null>}
 */
async function findBotComment(repo, prNumber) {
  const url = `https://api.github.com/repos/${repo}/issues/${prNumber}/comments?per_page=100`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
  if (!res.ok) return null;
  const comments = /** @type {any[]} */ (await res.json());
  const bot = comments.find((c) => c.body?.includes(BOT_MARKER));
  return bot?.id ?? null;
}

/**
 * Create or update the PR comment.
 *
 * @param {string} repo
 * @param {number} prNumber
 * @param {string} body
 * @param {number | null} existingCommentId
 */
async function upsertComment(repo, prNumber, body, existingCommentId) {
  if (existingCommentId) {
    await fetch(`https://api.github.com/repos/${repo}/issues/comments/${existingCommentId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
  } else {
    await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    });
  }
}

/**
 * Delete the bot comment if it exists.
 *
 * @param {string} repo
 * @param {number} commentId
 */
async function deleteComment(repo, commentId) {
  await fetch(`https://api.github.com/repos/${repo}/issues/comments/${commentId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
    },
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!PR_NUMBER || !BASE_SHA || !REPO) {
    console.log('Not a pull request context or missing env vars — skipping.');
    process.exit(0);
  }

  const lockFiles = changedLockFiles(BASE_SHA);
  if (lockFiles.length === 0) {
    console.log('No lock files changed — nothing to check.');
    process.exit(0);
  }

  console.log(`Checking lock files: ${lockFiles.join(', ')}`);

  // Collect all bumped production deps across all changed lock files (deduplicated)
  /** @type {Map<string, { name: string; oldVersion: string | null; newVersion: string }>} */
  const allBumps = new Map();

  for (const lockFile of lockFiles) {
    const type = lockFileType(lockFile);
    if (!type) continue;

    const baseContent = gitShow(BASE_SHA, lockFile);
    const headContent = fs.existsSync(lockFile) ? fs.readFileSync(lockFile, 'utf8') : null;

    if (!headContent) continue; // Lock file was deleted — nothing to check

    const basePackages = baseContent ? parseLockFile(baseContent, type) : {};
    const headPackages = parseLockFile(headContent, type);
    const bumps = detectBumps(basePackages, headPackages);

    for (const bump of bumps) {
      if (!allBumps.has(bump.name)) {
        allBumps.set(bump.name, bump);
      }
    }
  }

  if (allBumps.size === 0) {
    console.log('No production dependency bumps detected.');
    const existingCommentId = await findBotComment(REPO, parseInt(PR_NUMBER, 10));
    if (existingCommentId) {
      await deleteComment(REPO, existingCommentId);
      console.log('Removed stale freshness warning comment.');
    }
    process.exit(0);
  }

  console.log(`Found ${allBumps.size} bumped production ${allBumps.size === 1 ? 'dep' : 'deps'}:`);
  for (const bump of allBumps.values()) {
    console.log(`  ${bump.name}: ${bump.oldVersion ?? '(new)'} → ${bump.newVersion}`);
  }

  // Query npm registry for publish timestamps
  const now = Date.now();
  let registryUnreachable = false;

  /** @type {{ name: string; version: string; publishedAt: string; ageInDays: number }[]} */
  const flagged = [];

  await Promise.all(
    Array.from(allBumps.values()).map(async (bump) => {
      const publishedAt = await fetchPublishDate(bump.name, bump.newVersion);
      if (publishedAt === null) {
        registryUnreachable = true;
        console.warn(`  WARNING: could not fetch publish date for ${bump.name}@${bump.newVersion}`);
        return;
      }
      const publishedMs = new Date(publishedAt).getTime();
      const ageInDays = Math.floor((now - publishedMs) / (1000 * 60 * 60 * 24));
      console.log(`  ${bump.name}@${bump.newVersion} — published ${publishedAt} (${ageInDays}d ago)`);
      if (ageInDays < FRESHNESS_DAYS) {
        flagged.push({
          name: bump.name,
          version: bump.newVersion,
          publishedAt: publishedAt.slice(0, 10), // YYYY-MM-DD
          ageInDays,
        });
      }
    }),
  );

  const existingCommentId = await findBotComment(REPO, parseInt(PR_NUMBER, 10));

  if (registryUnreachable && flagged.length === 0) {
    // Post a warning but don't fail CI — we couldn't verify
    const body = `${BOT_MARKER}
## Dependency Freshness — Registry Unavailable

Could not reach the npm registry to verify the age of bumped dependencies. The freshness check was skipped to avoid blocking the PR on a network issue. Please re-run the check when the registry is available.
`;
    await upsertComment(REPO, parseInt(PR_NUMBER, 10), body, existingCommentId);
    console.log('Registry unreachable — posted warning comment, not failing CI.');
    process.exit(0);
  }

  if (flagged.length === 0) {
    console.log(`All bumped dependencies are older than ${FRESHNESS_DAYS} days. ✓`);
    if (existingCommentId) {
      await deleteComment(REPO, existingCommentId);
      console.log('Removed stale freshness warning comment.');
    }
    process.exit(0);
  }

  // Post/update the warning comment
  const commentBody = formatComment(flagged, FRESHNESS_DAYS);
  await upsertComment(REPO, parseInt(PR_NUMBER, 10), commentBody, existingCommentId);

  console.error(`\n❌ ${flagged.length} ${flagged.length === 1 ? 'dependency is' : 'dependencies are'} younger than ${FRESHNESS_DAYS} days. CI check failed.`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Unhandled error in freshness check:', err);
  process.exit(1);
});

// Export pure functions for testing
module.exports = {
  parseNpmLockFile,
  parseYarnLockFile,
  parsePnpmLockFile,
  parseLockFile,
  detectBumps,
  formatComment,
  BOT_MARKER,
};
