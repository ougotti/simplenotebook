process.env.AUTH_TABLE_NAME = 'test-auth-table';
process.env.ENVIRONMENT = 'prod';

import type { DynamoDBDocumentClient, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import {
  forEachWithConcurrency,
  orderForRevocation,
  REVOKE_CONCURRENCY,
  revokeFamilyInTable,
} from '../oauth/index';
import { createDynamoTokenStore } from '../tokens/index';

const NOW = new Date('2026-09-29T00:00:00.000Z');

/** 系列のキー: 接続 1 件 + トークン多数(Query の結果に接続が後ろに来る並びにする) */
function familyKeys(count: number) {
  const keys = Array.from({ length: count }, (_, i) => ({ PK: `TOKEN#T${String(i).padStart(15, '0')}`, SK: 'META' }));
  return [...keys, { PK: 'CONN#F000000000000000', SK: 'META' }];
}

/** send を記録し、UpdateItem の同時実行数を数える偽のクライアント */
function fakeClient(items: { PK: string; SK: string }[], owner = 'user-1') {
  const updates: string[] = [];
  const queries: QueryCommandInput[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const client = {
    // Lambda ごとに @aws-sdk/lib-dynamodb の別のコピーを読み込むため、instanceof ではなくクラス名で判定する
    async send(command: { constructor: { name: string }; input: Record<string, any> }) {
      const kind = command.constructor.name;
      if (kind === 'GetCommand') {
        return { Item: { PK: 'CONN#F000000000000000', userId: owner } };
      }
      if (kind === 'QueryCommand') {
        queries.push(command.input as QueryCommandInput);
        return { Items: items };
      }
      if (kind === 'UpdateCommand') {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise(resolve => setTimeout(resolve, 1));
        updates.push(command.input.Key.PK as string);
        inFlight--;
        return {};
      }
      throw new Error('unexpected command');
    },
  } as unknown as DynamoDBDocumentClient;
  return { client, updates, queries, maxInFlight: () => maxInFlight };
}

describe('forEachWithConcurrency', () => {
  it('同時実行数を上限以下に抑えて、すべて処理する', async () => {
    let inFlight = 0;
    let max = 0;
    const done: number[] = [];
    await forEachWithConcurrency(Array.from({ length: 50 }, (_, i) => i), 4, async i => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise(resolve => setTimeout(resolve, 1));
      done.push(i);
      inFlight--;
    });
    expect(max).toBeLessThanOrEqual(4);
    expect(done.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i));
  });

  it('空配列では何もしない。失敗は呼び出し元に伝える', async () => {
    await expect(forEachWithConcurrency([], 10, async () => { throw new Error('never'); })).resolves.toBeUndefined();
    await expect(forEachWithConcurrency([1, 2, 3], 2, async i => { if (i === 2) throw new Error('boom'); })).rejects.toThrow('boom');
  });
});

describe('orderForRevocation', () => {
  it('接続(CONN)を先頭にする', () => {
    const ordered = orderForRevocation(familyKeys(3));
    expect(ordered[0].PK).toBe('CONN#F000000000000000');
    expect(ordered).toHaveLength(4);
  });
});

describe('系列の失効', () => {
  it('OAuth: まだ使えるものだけを引き、接続を先に、上限付きで更新する', async () => {
    const fake = fakeClient(familyKeys(30));
    await revokeFamilyInTable(fake.client, 'test-auth-table', 'F000000000000000', NOW);

    expect(fake.queries[0]).toMatchObject({
      IndexName: 'GSI2',
      FilterExpression: 'attribute_not_exists(revokedAt) AND attribute_not_exists(usedAt) AND expiresAt > :now',
      ExpressionAttributeValues: { ':pk': 'FAMILY#F000000000000000', ':now': NOW.toISOString() },
    });
    expect(fake.updates).toHaveLength(31);
    expect(fake.updates[0]).toBe('CONN#F000000000000000');
    expect(fake.maxInFlight()).toBeLessThanOrEqual(REVOKE_CONCURRENCY);
  });

  it('トークン管理 API: 本人の接続なら同じく上限付きで失効させる', async () => {
    const fake = fakeClient(familyKeys(30));
    const store = createDynamoTokenStore('test-auth-table', fake.client);
    expect(await store.revokeConnection('user-1', 'F000000000000000', NOW)).toBe(true);

    expect(fake.queries[0].FilterExpression).toBe('attribute_not_exists(revokedAt) AND attribute_not_exists(usedAt) AND expiresAt > :now');
    expect(fake.updates).toHaveLength(31);
    expect(fake.updates[0]).toBe('CONN#F000000000000000');
    expect(fake.maxInFlight()).toBeLessThanOrEqual(REVOKE_CONCURRENCY);
  });

  it('トークン管理 API: 他人の接続は何も更新しない', async () => {
    const fake = fakeClient(familyKeys(3), 'someone-else');
    const store = createDynamoTokenStore('test-auth-table', fake.client);
    expect(await store.revokeConnection('user-1', 'F000000000000000', NOW)).toBe(false);
    expect(fake.queries).toHaveLength(0);
    expect(fake.updates).toHaveLength(0);
  });
});
