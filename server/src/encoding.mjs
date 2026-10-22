import { availableParallelism, cpus, platform, arch } from 'node:os';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './processes.mjs';
import { AppError } from './errors.mjs';
export const threads = Math.min(4, availableParallelism());
export function videoArgs(profile, encoder) {
  const [width, height] = profile === '1080p' ? [1920, 1080] : [1280, 720];
  const pixelFormat = encoder === 'h264_qsv' ? 'nv12' : 'yuv420p';
  const vf = `scale=${width}:${height}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30,format=${pixelFormat}`;
  return ['-vf', vf, '-c:v', encoder, ...(encoder === 'h264_qsv'
    ? ['-preset', 'veryfast', '-global_quality', '24', '-look_ahead', '0']
    : ['-preset', 'superfast', '-crf', '23', '-threads', String(threads)]),
    '-pix_fmt', pixelFormat, '-profile:v', 'high', '-g', '60', '-keyint_min', '60', '-sc_threshold', '0',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000'];
}
export async function chooseEncoder(ffmpeg, requested) {
  if (requested === 'libx264') return 'libx264';
  const result = await run(ffmpeg, ['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=size=1280x720:rate=30',
    '-frames:v', '8', '-pix_fmt', 'nv12', '-c:v', 'h264_qsv', '-f', 'null', '-'], { timeout: 12000 }).catch(() => null);
  if (result?.code === 0) return 'h264_qsv';
  if (requested === 'h264_qsv') throw new AppError('QSV_UNAVAILABLE', 'Intel 核显编码不可用；请使用 auto 或 libx264 启动', 503);
  return 'libx264';
}
const hardwareIdentity = () => `${platform()}:${arch()}:${cpus()[0]?.model}:${cpus().length}`;
const recipe = 'h264-superfast-aac-v1';
export async function measuredProfile(config) {
  if (config.profile !== '1080p') return '720p';
  try {
    const report = JSON.parse(await readFile(join(config.dataDir, 'benchmark.json'), 'utf8'));
    const result = report.measurements.find(value => value.profile === '1080p' && value.encoder === config.encoder);
    const age = Date.now() - Date.parse(report.measuredAt);
    if (report.recipe === recipe && report.hardware === hardwareIdentity() && age >= 0 && age < 30 * 86400000 && Number.isFinite(result?.realtimeRatio) && result.realtimeRatio >= 1.3 && result.encodedSeconds >= 5) return '1080p';
  } catch {}
  console.log('尚无本机 1080p ≥1.3 倍实时测速记录，使用 720p；可先运行 windows/benchmark.cmd。');
  return '720p';
}
export async function benchmark(config, filename) {
  const encoder = await chooseEncoder(config.ffmpeg, config.encoder);
  const measurements = [];
  for (const profile of ['1080p', '720p']) {
    console.log(`正在实测 ${profile} / ${encoder}，截取本地视频最多 20 秒…`);
    const start = performance.now();
    const result = await run(config.ffmpeg, ['-hide_banner', '-v', 'error', '-threads', String(threads), '-filter_threads', String(threads), '-i', filename,
      '-t', '20', ...videoArgs(profile, encoder), '-progress', 'pipe:1', '-nostats', '-f', 'null', '-'], { timeout: 180000 });
    const seconds = (performance.now() - start) / 1000;
    const matches = [...result.stdout.matchAll(/^out_time_us=(\d+)/gm)];
    const encodedSeconds = Number(matches.at(-1)?.[1] || 0) / 1000000;
    if (result.code || encodedSeconds < 5) throw new Error('性能测试失败；请提供不少于 5 秒的有效本地视频');
    measurements.push({ profile, encoder, encodedSeconds, wallSeconds: seconds, realtimeRatio: encodedSeconds / seconds });
  }
  const recommendedProfile = measurements[0].realtimeRatio >= 1.3 ? '1080p' : '720p';
  const report = { measuredAt: new Date().toISOString(), hardware: hardwareIdentity(), recipe, measurements, recommendedProfile };
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  await writeFile(join(config.dataDir, 'benchmark.json.tmp'), JSON.stringify(report, null, 2), { mode: 0o600 });
  await rename(join(config.dataDir, 'benchmark.json.tmp'), join(config.dataDir, 'benchmark.json'));
  console.log(JSON.stringify(report, null, 2));
  console.log(`建议使用 ${recommendedProfile}。实际播放仍应确认无缓冲；默认配置保持 720p。`);
  return { measurements, recommendedProfile };
}
