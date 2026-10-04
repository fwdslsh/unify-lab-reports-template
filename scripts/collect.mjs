// Explicit collection command. Unify never calls this.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { environment } from './environment.mjs';

const result = spawnSync('python3', [fileURLToPath(new URL('./collect.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', env: environment() });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
