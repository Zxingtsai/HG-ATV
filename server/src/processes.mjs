import { spawn } from 'node:child_process';
import { AppError, cancelled } from './errors.mjs';
// Arguments are arrays, never shell strings. Child stdout/stderr are bounded.
export function run(command, args, { input, signal, timeout = 60000, outputLimit = 262144 } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', failure, killTimer;
    const terminate = () => { child.kill(); killTimer ||= setTimeout(() => child.kill('SIGKILL'), 1000); };
    const onAbort = () => { failure = cancelled(); terminate(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
    const timer = setTimeout(() => { failure = new AppError('PROCESS_TIMEOUT', '媒体处理超时，请重试', 504); terminate(); }, timeout);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > outputLimit) { failure = new Error('OutputLimit'); terminate(); } });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-outputLimit); });
    child.on('error', error => { failure = error; });
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer); signal?.removeEventListener('abort', onAbort);
      if (signal?.aborted) reject(cancelled());
      else if (failure) reject(failure);
      else resolve({ code, stdout, stderr });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input || '');
  });
}
