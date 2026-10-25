/* Runtime adapter for the public player's normal WebWorker messages.
 * Keys arrive only over stdin and remain in memory. No key-export operation.
 * The original public worker file is evaluated without changing its crypto code.
 */
'use strict';
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

if (!isMainThread) {
  globalThis.self = globalThis;
  globalThis.location = new URL('https://hongguoduanju.com/');
  globalThis.onmessage = null;
  let logCount = 0;
  const quiet = () => { logCount++; };
  globalThis.console = { log: quiet, warn: quiet, error: quiet, info: quiet, debug: quiet };
  globalThis.postMessage = message => {
    const result = message.args && message.args.data;
    parentPort.postMessage({ id: message.id, method: message.method,
      res: result && result.res,
      videoSamples: result && result.videoTrack && result.videoTrack.samples.length,
      audioSamples: result && result.audioTrack && result.audioTrack.samples.length });
  };
  try {
    vm.runInThisContext(fs.readFileSync(workerData.sdkPath, 'utf8'), { filename: 'official-player-worker.js' });
    parentPort.on('message', async message => {
      try {
        globalThis.onmessage.call(globalThis, { data: message });
        if (message.method === 'updateValue') {
          await globalThis.p;
          await Promise.resolve();
          parentPort.postMessage({ id: message.id, method: 'updateValue', ready: true, sdkLogCount: logCount });
        }
      } catch (error) {
        parentPort.postMessage({ id: message.id, errorType: error.name,
          diagnostic: workerData.selfTest ? String(error.message).slice(0, 200) : undefined,
          sdkLogCount: logCount });
      }
    });
    parentPort.postMessage({ ready: true });
  } catch (error) {
    parentPort.postMessage({ errorType: error.name, diagnostic: String(error.message).slice(0, 200), phase: 'worker-start' });
  }
} else {
  const { fragments } = require('./fragmented-mp4.cjs');
  const { setTimeout: delay } = require('node:timers/promises');
  async function* growingInput(job) {
    let file, position = 0;
    try {
      while (file === undefined) {
        try { file = fs.openSync(job.input, 'r'); }
        catch (error) { if (error.code !== 'ENOENT') throw error; await delay(30); }
      }
      for (;;) {
        const buffer = Buffer.allocUnsafe(65536);
        const size = fs.readSync(file, buffer, 0, buffer.length, position);
        if (size) { position += size; yield buffer.subarray(0, size); }
        else if ((!job.growing || fs.existsSync(job.input + '.complete')) && position >= fs.fstatSync(file).size) return;
        else await delay(30);
      }
    } finally { if (file !== undefined) fs.closeSync(file); }
  }
  function writeAll(fd, bytes) {
    let offset = 0;
    while (offset < bytes.byteLength) offset += fs.writeSync(fd, bytes, offset, bytes.byteLength - offset);
  }

  async function decryptTrack(job, sdkPath) {
    const worker = new Worker(__filename, { workerData: { sdkPath, selfTest: Boolean(job.selfTest) },
      resourceLimits: { maxOldGenerationSizeMb: 192 } });
    let nextId = 1;
    const pending = new Map();
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    worker.on('message', message => {
      if (!message.id) {
        if (message.errorType) readyReject(new Error(message.diagnostic || message.errorType));
        else if (message.ready) readyResolve();
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timeout);
      if (message.errorType) entry.reject(new Error(message.diagnostic || message.errorType));
      else entry.resolve(message);
    });
    worker.on('error', error => {
      readyReject(error);
      for (const entry of pending.values()) { clearTimeout(entry.timeout); entry.reject(error); }
      pending.clear();
    });
    const call = message => new Promise((resolve, reject) => {
      const id = nextId++;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('WorkerOperationTimeout')); }, 25000);
      pending.set(id, { resolve, reject, timeout });
      const bytes = message.buf || (message.args && message.args.buf);
      worker.postMessage({ ...message, id }, bytes ? [bytes.buffer] : []);
    });
    let output;
    try {
      await Promise.race([ready, new Promise((_, reject) => {
        const timer = setTimeout(() => reject(new Error('WorkerStartTimeout')), 20000); timer.unref();
      })]);
      const initialized = await call({ method: 'updateValue', value: { secretKey: job.secretKey } });
      if (job.selfTest) return { workerReady: true, wasmReady: initialized.ready, sdkLogCount: initialized.sdkLogCount,
        scope: 'worker initialization only; no media decoded' };
      output = fs.openSync(job.output, 'w', 0o600);
      let written = 0, samples = 0, count = 0, inputBytes = 0;
      for await (const part of fragments(growingInput(job))) {
        inputBytes += part.data.length;
        const body = part.kind === 'init'
          ? await call({ method: 'decryptHeader', buf: Uint8Array.from(part.data), isVideo: job.isVideo })
          : await call({ method: 'decryptBody', args: {
            buf: Uint8Array.from(part.data), isVideo: job.isVideo, needRemux: true } });
        if (!body.res || !body.res.byteLength) throw new Error(part.kind === 'init' ? 'NoClearInitSegment' : 'NoClearMediaFragment');
        written += body.res.byteLength;
        if (written > 256 * 1024 * 1024) throw new Error('OversizedClearTrack');
        writeAll(output, body.res);
        if (part.kind === 'fragment') {
          count++; samples += job.isVideo ? body.videoSamples || 0 : body.audioSamples || 0;
          if (job.growing && count === 1) process.stdout.write(JSON.stringify({ event: 'trackReady', isVideo: job.isVideo }) + '\n');
        }
      }
      if (job.growing) process.stdout.write(JSON.stringify({ event: 'trackDone', isVideo: job.isVideo }) + '\n');
      return { inputBytes, outputBytes: written, fragments: count, samples,
        sdkLogCount: initialized.sdkLogCount, isVideo: job.isVideo };
    } finally {
      if (output !== undefined) fs.closeSync(output);
      await worker.terminate();
    }
  }

  (async () => {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (input.length > 131072) throw new Error('JobInputTooLarge');
    }
    const job = JSON.parse(input);
    const sdkPath = path.resolve(job.sdkPath || path.join(__dirname, 'sdk-worker.public.js'));
    const jobs = job.tracks || [{ secretKey: '', selfTest: true }];
    const results = await Promise.all(jobs.map(track => decryptTrack(track, sdkPath)));
    process.stdout.write(JSON.stringify({ ok: true, tracks: results }) + '\n');
  })().catch(error => {
    process.stdout.write(JSON.stringify({ ok: false, errorType: error.name,
      code:
      /^(WorkerOperationTimeout|WorkerStartTimeout|NoFragmentedMP4Media|NoClearInitSegment|NoClearMediaFragment|JobInputTooLarge|Invalid MP4 box bounds|Truncated MP4 box)$/.test(error.message)
        ? error.message : 'SDK_OR_BRIDGE_ERROR' }) + '\n');
    process.exit(1);
  });
}
