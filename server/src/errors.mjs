export class AppError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'AppError'; this.code = code; this.status = status; }
}
export const invalid = () => new AppError('INVALID_ARGUMENT', '请求参数不正确', 400);
export const cancelled = () => new AppError('CANCELLED', '播放已停止', 499);
export function publicError(error) {
  return error?.code && Number.isInteger(error.status) && error.status >= 400 && error.status < 600
    ? { status: error.status, error: { code: error.code, message: error.message } }
    : { status: 500, error: { code: 'INTERNAL_ERROR', message: '服务暂时不可用，请重试' } };
}
