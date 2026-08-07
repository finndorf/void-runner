import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const HTML = join(here, '..', 'void-runner.html');

const START = '// ===== ROGUELIKE CORE (PURE) =====';
const END = '// ===== END ROGUELIKE CORE (PURE) =====';

// Pulls the pure block out of the single-file game and evaluates it with no
// DOM present, so a stray document/canvas reference fails loudly here.
export function loadCore() {
  const src = readFileSync(HTML, 'utf8');
  const a = src.indexOf(START);
  const b = src.indexOf(END);
  if (a === -1 || b === -1) throw new Error('pure block sentinels not found');
  const body = src.slice(a + START.length, b);
  const sandbox = {};
  new Function('globalThis', `${body}\nglobalThis.RLCore = RLCore;`)(sandbox);
  return sandbox.RLCore;
}
