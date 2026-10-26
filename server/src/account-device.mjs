import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';
// Pairing authentication is applied by the HTTP router before any call here.
export class AccountDeviceControl {
  constructor(account) { this.account = account; this.operation = null; this.chain = Promise.resolve(); }
  serial(work) { const next = this.chain.catch(() => {}).then(work); this.chain = next; return next; }
  start(owner, verifyOnly = false) {
    return this.serial(async () => {
      await this.account.start({ verifyOnly });
      this.operation = { id: randomUUID(), owner, generation: this.account.generation };
      return this.get(owner, this.operation.id);
    });
  }
  get(owner, id) {
    const op = this.operation;
    if (!op || op.owner !== owner || op.id !== id || op.generation !== this.account.generation)
      throw new AppError('ACCOUNT_OPERATION_EXPIRED', '本次登录已结束或被替换，请重新生成二维码', 409);
    return { ...this.account.status({ admin: true }), operationId: op.id };
  }
  cancel(owner, id) {
    return this.serial(async () => {
      this.get(owner, id);
      const result = await this.account.cancel({ generation: this.operation.generation });
      this.operation = null; return result;
    });
  }
  logout() { return this.serial(async () => { await this.account.logout(); this.operation = null; return this.account.status(); }); }
}
