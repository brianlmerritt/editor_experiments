import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

function svelteSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return svelteSources(path);
    return entry.name.endsWith('.svelte') || entry.name.endsWith('.svelte.ts') ? [path] : [];
  });
}

describe('Svelte 5 reactivity policy', () => {
  it('contains no legacy reactive, prop, slot, event-directive, or writable-store syntax', () => {
    const violations = svelteSources(resolve('src')).flatMap((path) => {
      const source = readFileSync(path, 'utf8');
      const checks: Array<[RegExp, string]> = [
        [/^\s*\$:/m, 'legacy reactive declaration'],
        [/^\s*export\s+let\b/m, 'legacy component prop'],
        [/<slot(?:\s|\/|>)/, 'legacy slot'],
        [/\son:[a-z]+(?:\||=)/, 'legacy event directive'],
        [/from\s+['"]svelte\/store['"]/, 'legacy Svelte store']
      ];
      return checks.flatMap(([pattern, label]) => pattern.test(source) ? [`${path}: ${label}`] : []);
    });

    expect(violations).toEqual([]);
  });
});
