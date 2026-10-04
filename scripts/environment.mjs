import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { fileURLToPath } from 'node:url';

export function environment() {
  const path = fileURLToPath(new URL('../.env', import.meta.url));
  return { ...(existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}), ...process.env };
}
