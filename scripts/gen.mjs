// Unify owns page discovery, Markdown, metadata, URLs and layout composition.
// Keep the existing Python toolchain, with an argument-array subprocess.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { environment } from './environment.mjs';

const [, , sourceRoot, generatedDir, contextPath] = process.argv;
const context = JSON.parse(readFileSync(contextPath, 'utf8'));
if (context.schemaVersion !== 1 || !context.inputs?.sourcePages) {
  throw new Error('Navigation needs Unify source-inventory: true');
}
const env = environment();
const result = spawnSync('python3', [fileURLToPath(new URL('./gen-index.py', import.meta.url)), sourceRoot, generatedDir, context.inputs.sourcePages], { stdio: 'inherit', env });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
