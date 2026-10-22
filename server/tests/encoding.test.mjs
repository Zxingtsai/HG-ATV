import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import { join } from 'node:path';
import { measuredProfile } from '../src/encoding.mjs';
test('1080p requires a recent passing measurement for this hardware, encoder and recipe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'hongguo-benchmark-'));
  const config = { dataDir: dir, profile: '1080p', encoder: 'libx264' };
  const report = { hardware: `${platform()}:${arch()}:${cpus()[0]?.model}:${cpus().length}`,
    recipe: 'h264-superfast-aac-v1', measuredAt: new Date().toISOString(), measurements: [{ profile: '1080p', encoder: 'libx264', realtimeRatio: 1.3, encodedSeconds: 20 }] };
  const save = value => writeFile(join(dir, 'benchmark.json'), JSON.stringify(value));
  try {
    assert.equal(await measuredProfile(config), '720p');
    await save(report); assert.equal(await measuredProfile(config), '1080p');
    for (const patch of [{ hardware: 'different' }, { recipe: 'old' }, { measuredAt: '2020-01-01' }, { measurements: [{ profile: '1080p', encoder: 'h264_qsv', realtimeRatio: 3, encodedSeconds: 20 }] }, { measurements: [{ profile: '1080p', encoder: 'libx264', realtimeRatio: 1.29, encodedSeconds: 20 }] }]) {
      await save({ ...report, ...patch }); assert.equal(await measuredProfile(config), '720p');
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
