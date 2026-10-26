import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountDeviceControl } from '../src/account-device.mjs';
import { AccountManager } from '../src/account.mjs';

test('device QR operations reject other owners and superseded operations', async () => {
  const account = { generation: 0, start: async function () { this.generation++; },
    status: ({ admin } = {}) => ({ state: 'waiting_scan', ...(admin ? { qrImage: 'private-qr' } : {}) }),
    cancel: async () => ({ state: 'signed_out' }) };
  const control = new AccountDeviceControl(account);
  const first = await control.start('device-a');
  assert.equal(first.qrImage, 'private-qr');
  assert.equal(account.status().qrImage, undefined);
  assert.throws(() => control.get('device-b', first.operationId), { code: 'ACCOUNT_OPERATION_EXPIRED' });
  const next = await control.start('device-a');
  await assert.rejects(control.cancel('device-a', first.operationId), { code: 'ACCOUNT_OPERATION_EXPIRED' });
  assert.equal(control.get('device-a', next.operationId).operationId, next.operationId);
  account.generation++;
  assert.throws(() => control.get('device-a', next.operationId), { code: 'ACCOUNT_OPERATION_EXPIRED' });
});

test('late screen cancellation preserves a completed login and rejects stale generations', async () => {
  const manager = new AccountManager('/unused', { store: {} });
  manager.state = 'authenticated';
  const generation = manager.generation, revision = manager.revision;
  assert.equal((await manager.cancel({ generation })).authenticated, true);
  assert.equal(manager.revision, revision);
  await assert.rejects(manager.cancel({ generation: generation - 1 }), { code: 'ACCOUNT_OPERATION_EXPIRED' });
  assert.equal(manager.status().authenticated, true);
});
