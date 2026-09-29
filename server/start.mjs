// Запуск сервера с сертификатом Минцифры (Russian Trusted Root CA).
// API MAX (platform-api2.max.ru) использует этот сертификат; Node.js не знает его по умолчанию,
// поэтому передаём его через NODE_EXTRA_CA_CERTS. Работает одинаково в Windows, macOS и Linux.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
const ca = join(root, 'certs', 'russian_trusted_root_ca.pem');

if (!existsSync(envFile)) {
  console.error('Нет файла .env. Скопируйте .env.example в .env и впишите BOT_TOKEN.');
  process.exit(1);
}

const watch = process.argv.includes('--watch');
const args = ['--import', 'tsx', `--env-file=${envFile}`, ...(watch ? ['--watch'] : []), join(root, 'server', 'index.ts')];
const child = spawn(process.execPath, args, {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, NODE_EXTRA_CA_CERTS: ca },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
