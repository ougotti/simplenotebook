import { ObjectStorage, PreconditionFailedError } from '../../lambda/storage';

/** S3 の条件付き書き込み(IfMatch / IfNoneMatch)と同じ振る舞いをするインメモリ実装 */
export function memoryStorage(initial: Record<string, unknown> = {}) {
  const objects = new Map<string, { body: string; etag: string }>();
  let version = 0;
  const nextEtag = () => `"v${++version}"`;
  for (const [key, value] of Object.entries(initial)) {
    objects.set(key, { body: typeof value === 'string' ? value : JSON.stringify(value), etag: nextEtag() });
  }

  const storage: ObjectStorage & { beforePut?: (key: string) => void } = {
    async get(key) {
      const object = objects.get(key);
      return object ? { ...object } : null;
    },
    async put(key, body, conditions = {}) {
      // 読み出しから書き込みまでの間にほかの書き込みが入る状況を再現するためのフック
      storage.beforePut?.(key);
      const existing = objects.get(key);
      if (conditions.ifNoneMatch === '*' && existing) throw new PreconditionFailedError();
      if (conditions.ifMatch !== undefined && existing?.etag !== conditions.ifMatch) throw new PreconditionFailedError();
      const etag = nextEtag();
      objects.set(key, { body, etag });
      return etag;
    },
    async delete(key) {
      objects.delete(key);
    },
    async listKeys(prefix) {
      return [...objects.keys()].filter(key => key.startsWith(prefix)).sort();
    },
  };

  /** ほかのクライアントによる書き込みを模擬する */
  function externalWrite(key: string, value: unknown) {
    objects.set(key, { body: JSON.stringify(value), etag: nextEtag() });
  }

  return { storage, objects, externalWrite, read: (key: string) => JSON.parse(objects.get(key)!.body) };
}
