import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export function configuration(env = process.env) {
  const port = Number(env.HONGGUO_PORT || 8751);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('端口应在 1024–65535 之间');
  if (env.HONGGUO_PROFILE && !['720p', '1080p'].includes(env.HONGGUO_PROFILE)) throw new Error('不支持的输出分辨率');
  if (env.HONGGUO_ENCODER && !['auto', 'libx264', 'h264_qsv'].includes(env.HONGGUO_ENCODER)) throw new Error('不支持的编码器');
  return { port, bind: env.HONGGUO_BIND || '0.0.0.0',
    dataDir: resolve(env.HONGGUO_DATA_DIR || resolve(root, 'data')),
    ffmpeg: env.HONGGUO_FFMPEG || 'ffmpeg',
    profile: env.HONGGUO_PROFILE || '720p', encoder: env.HONGGUO_ENCODER || 'auto' };
}
