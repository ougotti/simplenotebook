import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';

export interface StoredObject {
  body: string;
  /** S3 の ETag(ダブルクォート付きのまま扱う) */
  etag: string;
}

export interface PutConditions {
  /** この ETag のときだけ上書きする */
  ifMatch?: string;
  /** '*' なら、まだ存在しないときだけ作成する */
  ifNoneMatch?: '*';
}

/** ノート・設定の保存先。テストではインメモリ実装に差し替える */
export interface ObjectStorage {
  get(key: string): Promise<StoredObject | null>;
  /** 条件を満たさなければ PreconditionFailedError。成功したら新しい ETag を返す */
  put(key: string, body: string, conditions?: PutConditions): Promise<string>;
  delete(key: string): Promise<void>;
  listKeys(prefix: string): Promise<string[]>;
}

/** 条件付き書き込みの条件を満たさなかった(ほかの書き込みと競合した) */
export class PreconditionFailedError extends Error {
  constructor() {
    super('Precondition failed');
    this.name = 'PreconditionFailedError';
  }
}

export function createS3Storage(client: S3Client, bucket: string): ObjectStorage {
  return {
    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return { body: await response.Body!.transformToString(), etag: response.ETag ?? '' };
      } catch (error) {
        if ((error as Error).name === 'NoSuchKey') return null;
        throw error;
      }
    },
    async put(key, body, conditions = {}) {
      try {
        const response = await client.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: 'application/json',
          ServerSideEncryption: 'AES256',
          IfMatch: conditions.ifMatch,
          IfNoneMatch: conditions.ifNoneMatch,
        }));
        return response.ETag ?? '';
      } catch (error) {
        // 412: 条件不一致 / 409: 同じキーへの条件付き書き込みが同時に走った
        const name = (error as Error).name;
        const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (name === 'PreconditionFailed' || name === 'ConditionalRequestConflict' || status === 412) {
          throw new PreconditionFailedError();
        }
        throw error;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async listKeys(prefix) {
      const keys: string[] = [];
      let continuationToken: string | undefined;
      // 1 回の List は最大 1,000 件なので、続きがあれば取り切る
      do {
        const response = await client.send(new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }));
        keys.push(...(response.Contents ?? []).map(object => object.Key!).filter(Boolean));
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    },
  };
}
