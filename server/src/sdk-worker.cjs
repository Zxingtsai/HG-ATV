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
  function boxes(buffer) {
    const result = [];
    for (let offset = 0; offset < buffer.length;) {
      if (offset + 8 > buffer.length) throw new Error('Truncated MP4 box');
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString('ascii', offset + 4, offset + 8);
      if (size === 1) {
        if (offset + 16 > buffer.length) throw new Error('Truncated large MP4 box');
        const value = buffer.readBigUInt64BE(offset + 8);
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Oversized MP4 box');
        size = Number(value);
      } else if (size === 0) size = buffer.length - offset;
      if (size < 8 || offset + size > buffer.length) throw new Error('Invalid MP4 box bounds');
      result.push({ offset, size, type });
      offset += size;
    }
    return result;
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
      const input = fs.readFileSync(job.input);
      const fragments = boxes(input).filter(box => box.type === 'moof');
      if (!fragments.length) throw new Error('NoFragmentedMP4Media');
      output = fs.openSync(job.output, 'w', 0o600);
      const header = await call({ method: 'decryptHeader', buf: Uint8Array.from(input.subarray(0, fragments[0].offset)), isVideo: job.isVideo });
      if (!header.res || !header.res.byteLength) throw new Error('NoClearInitSegment');
      fs.writeSync(output, header.res);
      let written = header.res.byteLength, samples = 0;
      for (let index = 0; index < fragments.length; index++) {
        const start = fragments[index].offset;
        const end = index + 1 < fragments.length ? fragments[index + 1].offset : input.length;
        const body = await call({ method: 'decryptBody', args: {
          buf: Uint8Array.from(input.subarray(start, end)), isVideo: job.isVideo, needRemux: true } });
        if (!body.res || !body.res.byteLength) throw new Error('NoClearMediaFragment');
        fs.writeSync(output, body.res);
        written += body.res.byteLength;
        samples += job.isVideo ? body.videoSamples || 0 : body.audioSamples || 0;
      }
      return { inputBytes: input.length, outputBytes: written, fragments: fragments.length, samples,
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
    const results = [];
    for (const track of jobs) results.push(await decryptTrack(track, sdkPath));
    process.stdout.write(JSON.stringify({ ok: true, tracks: results }) + '\n');
  })().catch(error => {
    process.stdout.write(JSON.stringify({ ok: false, errorType: error.name,
      code:
      /^(WorkerOperationTimeout|WorkerStartTimeout|NoFragmentedMP4Media|NoClearInitSegment|NoClearMediaFragment|JobInputTooLarge|Invalid MP4 box bounds|Truncated MP4 box)$/.test(error.message)
        ? error.message : 'SDK_OR_BRIDGE_ERROR' }) + '\n');
    process.exitCode = 1;
  });
}
