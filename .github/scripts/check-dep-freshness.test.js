// @ts-check
import { createRequire } from 'node:module';
import { describe, it, expect, vi } from 'vitest';

// The script calls main() immediately on load, which calls process.exit().
// Intercept process.exit before require() so the module-level call does not
// propagate as an unhandled rejection inside the Vitest process.
vi.spyOn(process, 'exit').mockImplementation(/** @type {() => never} */ (() => {
  // intentionally swallow — we only test the pure exported functions
}));

const require = createRequire(import.meta.url);
const {
  parseNpmLockFile,
  parseYarnLockFile,
  parsePnpmLockFile,
  parseLockFile,
  detectBumps,
  formatComment,
  BOT_MARKER,
} = require('./check-dep-freshness.js');

// ---------------------------------------------------------------------------
// parseNpmLockFile
// ---------------------------------------------------------------------------

describe('parseNpmLockFile', () => {
  it('should return empty object for invalid JSON', () => {
    expect(parseNpmLockFile('not json at all')).toEqual({});
    expect(parseNpmLockFile('')).toEqual({});
    expect(parseNpmLockFile('{')).toEqual({});
  });

  it('should return empty object for valid JSON without packages key', () => {
    const content = JSON.stringify({ name: 'my-app', version: '1.0.0', lockfileVersion: 2 });
    expect(parseNpmLockFile(content)).toEqual({});
  });

  it('should parse a production dependency (no dev field)', () => {
    const lockfile = {
      name: 'my-app',
      version: '1.0.0',
      lockfileVersion: 2,
      packages: {
        '': { name: 'my-app', version: '1.0.0' },
        'node_modules/lodash': {
          version: '4.17.21',
          resolved: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
        },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(result).toEqual({
      lodash: { version: '4.17.21', dev: false },
    });
  });

  it('should mark dev: true for packages with "dev": true', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/vitest': { version: '1.0.0', dev: true },
        'node_modules/express': { version: '4.18.2' },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(result.vitest).toEqual({ version: '1.0.0', dev: true });
    expect(result.express).toEqual({ version: '4.18.2', dev: false });
  });

  it('should mark dev: true for packages with "devOptional": true', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/@types/node': { version: '20.11.0', devOptional: true },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(result['@types/node']).toEqual({ version: '20.11.0', dev: true });
  });

  it('should skip entries that do not start with node_modules/', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        '': { name: 'my-app', version: '1.0.0' },
        'node_modules/express': { version: '4.18.2' },
        'packages/utils': { version: '0.1.0' },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(Object.keys(result)).toEqual(['express']);
  });

  it('should skip nested node_modules entries (hoisted deduplication artifacts)', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/express': { version: '4.18.2' },
        'node_modules/express/node_modules/qs': { version: '6.11.0' },
        'node_modules/some-pkg/node_modules/lodash': { version: '3.10.1' },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(Object.keys(result)).toEqual(['express']);
  });

  it('should skip entries without a version string', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/has-no-version': { resolved: 'https://example.com' },
        'node_modules/version-is-number': { version: 1 },
        'node_modules/express': { version: '4.18.2' },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(Object.keys(result)).toEqual(['express']);
  });

  it('should handle scoped packages at top level', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/@scope/pkg': { version: '1.2.3' },
        'node_modules/@another/tool': { version: '2.0.0', dev: true },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(result['@scope/pkg']).toEqual({ version: '1.2.3', dev: false });
    expect(result['@another/tool']).toEqual({ version: '2.0.0', dev: true });
  });

  it('should handle a realistic multi-package lockfile (npm v3)', () => {
    const lockfile = {
      name: 'my-app',
      version: '0.1.0',
      lockfileVersion: 3,
      packages: {
        '': {
          name: 'my-app',
          version: '0.1.0',
          dependencies: { express: '^4.18.2' },
          devDependencies: { vitest: '^1.0.0' },
        },
        'node_modules/express': {
          version: '4.18.2',
          resolved: 'https://registry.npmjs.org/express/-/express-4.18.2.tgz',
          integrity: 'sha512-abc',
        },
        'node_modules/vitest': {
          version: '1.0.0',
          dev: true,
          resolved: 'https://registry.npmjs.org/vitest/-/vitest-1.0.0.tgz',
        },
        'node_modules/@hono/node-server': { version: '1.3.0' },
      },
    };
    const result = parseNpmLockFile(JSON.stringify(lockfile));
    expect(result).toEqual({
      express: { version: '4.18.2', dev: false },
      vitest: { version: '1.0.0', dev: true },
      '@hono/node-server': { version: '1.3.0', dev: false },
    });
  });
});

// ---------------------------------------------------------------------------
// parseYarnLockFile
// ---------------------------------------------------------------------------

describe('parseYarnLockFile', () => {
  it('should parse a simple yarn.lock block correctly', () => {
    const content = `# yarn lockfile v1

lodash@^4.17.21:
  version "4.17.21"
  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz#679591c564c3bffaae8454cf0b3df370c3d6911c"
  integrity sha512-abc==
`;
    const result = parseYarnLockFile(content);
    expect(result.lodash).toEqual({ version: '4.17.21', dev: false });
  });

  it('should handle scoped packages (@scope/name)', () => {
    const content = `# yarn lockfile v1

"@hono/node-server@^1.3.0":
  version "1.3.0"
  resolved "https://registry.yarnpkg.com/@hono/node-server/-/@hono/node-server-1.3.0.tgz"
  integrity sha512-xyz==
`;
    const result = parseYarnLockFile(content);
    expect(result['@hono/node-server']).toEqual({ version: '1.3.0', dev: false });
  });

  it('should return dev: false for all entries (yarn.lock does not encode dev status)', () => {
    const content = `# yarn lockfile v1

express@^4.18.0:
  version "4.18.2"
  resolved "https://registry.yarnpkg.com/express/-/express-4.18.2.tgz"
  integrity sha512-abc==

vitest@^1.0.0:
  version "1.0.0"
  resolved "https://registry.yarnpkg.com/vitest/-/vitest-1.0.0.tgz"
  integrity sha512-def==
`;
    const result = parseYarnLockFile(content);
    expect(result.express.dev).toBe(false);
    expect(result.vitest.dev).toBe(false);
  });

  it('should return empty object for empty content', () => {
    expect(parseYarnLockFile('')).toEqual({});
  });

  it('should return empty object for content with no version lines', () => {
    // A block that has a header but no version field is skipped
    const content = `# yarn lockfile v1\n\n__metadata:\n  version: 6\n`;
    expect(parseYarnLockFile(content)).toEqual({});
  });

  it('should parse multiple packages in one file', () => {
    const content = `# yarn lockfile v1

express@^4.18.0:
  version "4.18.2"
  resolved "https://registry.yarnpkg.com/express/-/express-4.18.2.tgz"
  integrity sha512-abc==
  dependencies:
    accepts "~1.3.8"

accepts@~1.3.8:
  version "1.3.8"
  resolved "https://registry.yarnpkg.com/accepts/-/accepts-1.3.8.tgz"
  integrity sha512-def==
`;
    const result = parseYarnLockFile(content);
    expect(result.express).toEqual({ version: '4.18.2', dev: false });
    expect(result.accepts).toEqual({ version: '1.3.8', dev: false });
  });
});

// ---------------------------------------------------------------------------
// parsePnpmLockFile
// ---------------------------------------------------------------------------

describe('parsePnpmLockFile', () => {
  it('should parse v6+ snapshot format (  name@version:)', () => {
    const content = `lockfileVersion: '6.0'

snapshots:
  lodash@4.17.21:
    resolution: {integrity: sha512-abc==}

  express@4.18.2:
    resolution: {integrity: sha512-def==}
    dependencies:
      accepts: 1.3.8
`;
    const result = parsePnpmLockFile(content);
    expect(result.lodash).toEqual({ version: '4.17.21', dev: false });
    expect(result.express).toEqual({ version: '4.18.2', dev: false });
  });

  it('should parse v5 format (  /name/version:)', () => {
    const content = `lockfileVersion: 5.4

packages:
  /lodash/4.17.21:
    resolution: {integrity: sha512-abc==}
    dev: false

  /express/4.18.2:
    resolution: {integrity: sha512-def==}
    dev: false
`;
    const result = parsePnpmLockFile(content);
    expect(result.lodash).toEqual({ version: '4.17.21', dev: false });
    expect(result.express).toEqual({ version: '4.18.2', dev: false });
  });

  it('should handle scoped packages in v6+ snapshot format', () => {
    const content = `lockfileVersion: '6.0'

snapshots:
  @hono/node-server@1.3.0:
    resolution: {integrity: sha512-abc==}

  @types/node@20.11.0:
    resolution: {integrity: sha512-def==}
`;
    const result = parsePnpmLockFile(content);
    expect(result['@hono/node-server']).toEqual({ version: '1.3.0', dev: false });
    expect(result['@types/node']).toEqual({ version: '20.11.0', dev: false });
  });

  it('should handle scoped packages in v5 format', () => {
    const content = `lockfileVersion: 5.4

packages:
  /@hono/node-server/1.3.0:
    resolution: {integrity: sha512-abc==}
    dev: false
`;
    const result = parsePnpmLockFile(content);
    expect(result['@hono/node-server']).toEqual({ version: '1.3.0', dev: false });
  });

  it('should return dev: false for all entries (snapshot section has no per-entry dev flag)', () => {
    const content = `lockfileVersion: '6.0'

snapshots:
  lodash@4.17.21:
    resolution: {integrity: sha512-abc==}

  vitest@1.0.0:
    resolution: {integrity: sha512-def==}
`;
    const result = parsePnpmLockFile(content);
    expect(result.lodash.dev).toBe(false);
    expect(result.vitest.dev).toBe(false);
  });

  it('should return empty object for content with no matching lines', () => {
    const content = `lockfileVersion: '6.0'\n\nsettings:\n  autoInstallPeers: true\n`;
    expect(parsePnpmLockFile(content)).toEqual({});
  });

  it('should ignore nested property lines (indented more than 2 spaces)', () => {
    const content = `lockfileVersion: '6.0'

snapshots:
  express@4.18.2:
    dependencies:
      accepts: 1.3.8
    resolution: {integrity: sha512-abc==}
`;
    const result = parsePnpmLockFile(content);
    // Only the snapshot header line should match, not the deeply indented dependency lines
    expect(Object.keys(result)).toEqual(['express']);
  });
});

// ---------------------------------------------------------------------------
// parseLockFile
// ---------------------------------------------------------------------------

describe('parseLockFile', () => {
  it('should dispatch to parseNpmLockFile for type "npm"', () => {
    const lockfile = {
      lockfileVersion: 2,
      packages: {
        'node_modules/lodash': { version: '4.17.21' },
      },
    };
    const result = parseLockFile(JSON.stringify(lockfile), 'npm');
    expect(result).toEqual({ lodash: { version: '4.17.21', dev: false } });
  });

  it('should dispatch to parseYarnLockFile for type "yarn"', () => {
    const content = [
      '# yarn lockfile v1',
      '',
      'lodash@^4.17.21:',
      '  version "4.17.21"',
      '  resolved "https://registry.yarnpkg.com/lodash/-/lodash-4.17.21.tgz"',
      '  integrity sha512-abc==',
      '',
    ].join('\n');
    const result = parseLockFile(content, 'yarn');
    expect(result).toEqual({ lodash: { version: '4.17.21', dev: false } });
  });

  it('should dispatch to parsePnpmLockFile for type "pnpm"', () => {
    const content = [
      "lockfileVersion: '6.0'",
      '',
      'snapshots:',
      '  lodash@4.17.21:',
      '    resolution: {integrity: sha512-abc==}',
      '',
    ].join('\n');
    const result = parseLockFile(content, 'pnpm');
    expect(result).toEqual({ lodash: { version: '4.17.21', dev: false } });
  });

  it('should return empty object for unknown type', () => {
    // @ts-expect-error intentionally testing invalid types
    expect(parseLockFile('anything', 'bower')).toEqual({});
    // @ts-expect-error intentionally testing invalid types
    expect(parseLockFile('anything', '')).toEqual({});
    // @ts-expect-error intentionally testing invalid types
    expect(parseLockFile('anything', 'bun')).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// detectBumps
// ---------------------------------------------------------------------------

describe('detectBumps', () => {
  it('should return empty array when nothing changed', () => {
    const base = {
      express: { version: '4.18.2', dev: false },
      lodash: { version: '4.17.21', dev: false },
    };
    const head = {
      express: { version: '4.18.2', dev: false },
      lodash: { version: '4.17.21', dev: false },
    };
    expect(detectBumps(base, head)).toEqual([]);
  });

  it('should detect a version bump (base v1, head v2)', () => {
    const base = { express: { version: '4.18.1', dev: false } };
    const head = { express: { version: '4.18.2', dev: false } };
    const result = detectBumps(base, head);
    expect(result).toEqual([{ name: 'express', oldVersion: '4.18.1', newVersion: '4.18.2' }]);
  });

  it('should detect a newly added production dependency (not in base)', () => {
    const base = { lodash: { version: '4.17.21', dev: false } };
    const head = {
      lodash: { version: '4.17.21', dev: false },
      zod: { version: '3.22.0', dev: false },
    };
    const result = detectBumps(base, head);
    expect(result).toEqual([{ name: 'zod', oldVersion: null, newVersion: '3.22.0' }]);
  });

  it('should skip dev dependencies that were bumped (dev: true)', () => {
    const base = { vitest: { version: '1.0.0', dev: true } };
    const head = { vitest: { version: '1.5.0', dev: true } };
    expect(detectBumps(base, head)).toEqual([]);
  });

  it('should skip newly added dev dependencies', () => {
    /** @type {Record<string, { version: string; dev: boolean }>} */
    const base = {};
    const head = { typescript: { version: '5.4.0', dev: true } };
    expect(detectBumps(base, head)).toEqual([]);
  });

  it('should not flag packages removed from head (iteration is over head only)', () => {
    const base = {
      lodash: { version: '4.17.21', dev: false },
      moment: { version: '2.29.4', dev: false },
    };
    const head = {
      lodash: { version: '4.17.21', dev: false },
      // moment intentionally removed
    };
    expect(detectBumps(base, head)).toEqual([]);
  });

  it('should not flag unchanged packages', () => {
    const base = {
      express: { version: '4.18.2', dev: false },
      lodash: { version: '4.17.21', dev: false },
    };
    const head = {
      express: { version: '4.18.2', dev: false },
      lodash: { version: '4.17.21', dev: false },
      zod: { version: '3.22.0', dev: false },
    };
    const result = detectBumps(base, head);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('zod');
  });

  it('should handle multiple bumps and new packages in one pass', () => {
    const base = {
      express: { version: '4.18.1', dev: false },
      lodash: { version: '4.17.20', dev: false },
      vitest: { version: '1.0.0', dev: true },
    };
    const head = {
      express: { version: '4.18.2', dev: false },
      lodash: { version: '4.17.21', dev: false },
      vitest: { version: '1.5.0', dev: true },
      zod: { version: '3.22.0', dev: false },
    };
    const result = detectBumps(base, head);
    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        { name: 'express', oldVersion: '4.18.1', newVersion: '4.18.2' },
        { name: 'lodash', oldVersion: '4.17.20', newVersion: '4.17.21' },
        { name: 'zod', oldVersion: null, newVersion: '3.22.0' },
      ]),
    );
  });

  it('should return empty array when both base and head are empty', () => {
    expect(detectBumps({}, {})).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// formatComment
// ---------------------------------------------------------------------------

describe('formatComment', () => {
  it('should return empty string for empty flagged array', () => {
    expect(formatComment([], 5)).toBe('');
  });

  it('should start with BOT_MARKER', () => {
    const flagged = [{ name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 }];
    const result = formatComment(flagged, 5);
    expect(result.startsWith(BOT_MARKER)).toBe(true);
  });

  it('should include the freshnessThreshold in the "fewer than N days ago" warning text', () => {
    const flagged = [{ name: 'express', version: '4.18.2', publishedAt: '2024-03-01', ageInDays: 3 }];
    expect(formatComment(flagged, 5)).toContain('fewer than 5 days ago');
    expect(formatComment(flagged, 7)).toContain('fewer than 7 days ago');
  });

  it('should include the freshnessThreshold in the "older than N days" footer text', () => {
    const flagged = [{ name: 'express', version: '4.18.2', publishedAt: '2024-03-01', ageInDays: 3 }];
    expect(formatComment(flagged, 5)).toContain('older than 5 days');
    expect(formatComment(flagged, 14)).toContain('older than 14 days');
  });

  it('should use singular "dependency was" when flagged array has exactly one package', () => {
    const flagged = [{ name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('dependency was');
    expect(result).not.toContain('dependencies were');
  });

  it('should use plural "dependencies were" when flagged array has multiple packages', () => {
    const flagged = [
      { name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 },
      { name: 'express', version: '4.18.2', publishedAt: '2024-01-11', ageInDays: 1 },
    ];
    const result = formatComment(flagged, 5);
    expect(result).toContain('dependencies were');
    expect(result).not.toContain('dependency was');
  });

  it('should use "day" (singular) when ageInDays === 1', () => {
    const flagged = [{ name: 'zod', version: '3.22.0', publishedAt: '2024-03-10', ageInDays: 1 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| 1 day |');
    expect(result).not.toContain('1 days');
  });

  it('should use "days" (plural) when ageInDays is 0', () => {
    const flagged = [{ name: 'zod', version: '3.22.0', publishedAt: '2024-03-10', ageInDays: 0 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| 0 days |');
  });

  it('should use "days" (plural) when ageInDays is greater than 1', () => {
    const flagged = [{ name: 'express', version: '4.18.2', publishedAt: '2024-03-09', ageInDays: 3 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| 3 days |');
  });

  it('should format a package row correctly in the markdown table', () => {
    const flagged = [{ name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| `lodash` | `4.17.21` | 2024-01-10 | 2 days |');
  });

  it('should format multiple rows in the markdown table', () => {
    const flagged = [
      { name: '@scope/pkg', version: '1.2.3', publishedAt: '2024-02-01', ageInDays: 1 },
      { name: 'express', version: '4.18.2', publishedAt: '2024-02-02', ageInDays: 4 },
    ];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| `@scope/pkg` | `1.2.3` | 2024-02-01 | 1 day |');
    expect(result).toContain('| `express` | `4.18.2` | 2024-02-02 | 4 days |');
  });

  it('should include the markdown table header and separator', () => {
    const flagged = [{ name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('| Package | Version | Published | Age |');
    expect(result).toContain('|---------|---------|-----------|-----|');
  });

  it('should include the "Dependency Freshness Warning" heading', () => {
    const flagged = [{ name: 'lodash', version: '4.17.21', publishedAt: '2024-01-10', ageInDays: 2 }];
    const result = formatComment(flagged, 5);
    expect(result).toContain('## Dependency Freshness Warning');
  });
});

// ---------------------------------------------------------------------------
// BOT_MARKER
// ---------------------------------------------------------------------------

describe('BOT_MARKER', () => {
  it('should be an HTML comment string', () => {
    expect(typeof BOT_MARKER).toBe('string');
    expect(BOT_MARKER.startsWith('<!--')).toBe(true);
    expect(BOT_MARKER.endsWith('-->')).toBe(true);
  });

  it('should contain a recognisable identifier so bot comments can be found', () => {
    expect(BOT_MARKER).toContain('dep-freshness');
  });
});
