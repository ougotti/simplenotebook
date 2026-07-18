import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command, _Object } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3Client = new S3Client({ region: process.env.AWS_REGION });
const NOTES_BUCKET = process.env.NOTES_BUCKET!;
const NOTES_PREFIX = process.env.NOTES_PREFIX || '';

interface Note {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

const MAX_TAGS = 20;
const MAX_TAG_LENGTH = 50;
// 無効要素だけの巨大配列で全件走査させられないよう、走査自体にも上限を設ける
const MAX_TAG_SCAN = 100;

// タグの入力サニタイゼーション: 文字列配列以外は空に、trim・空要素除去・重複排除・件数/長さ制限
function sanitizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of input.slice(0, MAX_TAG_SCAN)) {
    if (typeof raw !== 'string') continue;
    const tag = raw.trim().slice(0, MAX_TAG_LENGTH);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
    if (tags.length >= MAX_TAGS) break;
  }
  return tags;
}

interface UserSettings {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  try {
    // Extract user ID from Cognito JWT token
    const userId = event.requestContext.authorizer?.claims?.sub;
    if (!userId) {
      return {
        statusCode: 401,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    const httpMethod = event.httpMethod;
    const resource = event.resource;
    
    // Sanitize user ID to prevent path traversal
    const sanitizedUserId = userId.replace(/[^a-zA-Z0-9-]/g, '');
    const userPrefix = `${NOTES_PREFIX}${sanitizedUserId}/`;

    switch (`${httpMethod} ${resource}`) {
      case 'OPTIONS /notes':
      case 'OPTIONS /notes/{noteId}':
      case 'OPTIONS /users/me/settings':
        return {
          statusCode: 204,
          headers: {
            'Access-Control-Allow-Origin': 'https://ougotti.github.io',
            'Access-Control-Allow-Headers': 'Authorization,Content-Type',
            'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
          },
          body: '',
        };
      
      case 'GET /notes':
        return await listNotes(userPrefix);
      
      case 'POST /notes':
        return await createNote(userPrefix, JSON.parse(event.body || '{}'));
      
      case 'GET /notes/{noteId}':
        return await getNote(userPrefix, event.pathParameters?.noteId);
      
      case 'PUT /notes/{noteId}':
        return await updateNote(userPrefix, event.pathParameters?.noteId, JSON.parse(event.body || '{}'));
      
      case 'DELETE /notes/{noteId}':
        return await deleteNote(userPrefix, event.pathParameters?.noteId);
      
      case 'GET /users/me/settings':
        return await getUserSettings(sanitizedUserId);
      
      case 'PUT /users/me/settings':
        return await updateUserSettings(sanitizedUserId, JSON.parse(event.body || '{}'));
      
      
      default:
        return {
          statusCode: 405,
          headers: {
            'Access-Control-Allow-Origin': 'https://ougotti.github.io',
            'Access-Control-Allow-Headers': 'Authorization,Content-Type',
          },
          body: JSON.stringify({ error: 'Method not allowed' }),
        };
    }
  } catch (error) {
    console.error('Error:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Internal server error' }),
    };
  }
};

async function listNotes(userPrefix: string): Promise<APIGatewayProxyResult> {
  const command = new ListObjectsV2Command({
    Bucket: NOTES_BUCKET,
    Prefix: userPrefix,
  });

  const response = await s3Client.send(command);
  const notes = await Promise.all(
    (response.Contents || []).map(async (object: _Object) => {
      const noteId = object.Key!.replace(userPrefix, '').replace('.json', '');
      const getCommand = new GetObjectCommand({
        Bucket: NOTES_BUCKET,
        Key: object.Key!,
      });
      
      const noteResponse = await s3Client.send(getCommand);
      const noteContent = await noteResponse.Body!.transformToString();
      const note = JSON.parse(noteContent);
      
      return {
        id: noteId,
        title: note.title,
        // S3 上のデータが壊れていても型不整合を返さないよう読み出し側でも正規化する
        tags: sanitizeTags(note.tags),
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      };
    })
  );

  return {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': 'https://ougotti.github.io',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    },
    body: JSON.stringify({ notes }),
  };
}

async function createNote(userPrefix: string, noteData: Partial<Note>): Promise<APIGatewayProxyResult> {
  const noteId = generateNoteId();
  const now = new Date().toISOString();
  
  const note: Note = {
    id: noteId,
    title: noteData.title || 'Untitled',
    content: noteData.content || '',
    tags: sanitizeTags(noteData.tags),
    createdAt: now,
    updatedAt: now,
  };

  const command = new PutObjectCommand({
    Bucket: NOTES_BUCKET,
    Key: `${userPrefix}${noteId}.json`,
    Body: JSON.stringify(note),
    ContentType: 'application/json',
  });

  await s3Client.send(command);

  return {
    statusCode: 201,
    headers: {
      'Access-Control-Allow-Origin': 'https://ougotti.github.io',
      'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    },
    body: JSON.stringify({ note }),
  };
}

async function getNote(userPrefix: string, noteId?: string): Promise<APIGatewayProxyResult> {
  if (!noteId) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Note ID is required' }),
    };
  }

  // Sanitize note ID
  const sanitizedNoteId = noteId.replace(/[^a-zA-Z0-9-]/g, '');

  try {
    const command = new GetObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${userPrefix}${sanitizedNoteId}.json`,
    });

    const response = await s3Client.send(command);
    const noteContent = await response.Body!.transformToString();
    const note = JSON.parse(noteContent);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ note }),
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: 'Note not found' }),
      };
    }
    throw error;
  }
}

async function updateNote(userPrefix: string, noteId?: string, noteData?: Partial<Note>): Promise<APIGatewayProxyResult> {
  if (!noteId) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Note ID is required' }),
    };
  }

  // Sanitize note ID
  const sanitizedNoteId = noteId.replace(/[^a-zA-Z0-9-]/g, '');

  try {
    // Get existing note
    const getCommand = new GetObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${userPrefix}${sanitizedNoteId}.json`,
    });

    const response = await s3Client.send(getCommand);
    const noteContent = await response.Body!.transformToString();
    const existingNote = JSON.parse(noteContent);

    // Update note
    const updatedNote: Note = {
      ...existingNote,
      ...noteData,
      id: existingNote.id, // Prevent ID change
      // 既存データ側が壊れている場合も含めて、保存前に必ず正規化する
      tags: sanitizeTags(noteData?.tags !== undefined ? noteData.tags : existingNote.tags),
      createdAt: existingNote.createdAt, // Prevent creation date change
      updatedAt: new Date().toISOString(),
    };

    const putCommand = new PutObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${userPrefix}${sanitizedNoteId}.json`,
      Body: JSON.stringify(updatedNote),
      ContentType: 'application/json',
    });

    await s3Client.send(putCommand);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ note: updatedNote }),
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: 'Note not found' }),
      };
    }
    throw error;
  }
}

async function deleteNote(userPrefix: string, noteId?: string): Promise<APIGatewayProxyResult> {
  if (!noteId) {
    return {
      statusCode: 400,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Note ID is required' }),
    };
  }

  // Sanitize note ID
  const sanitizedNoteId = noteId.replace(/[^a-zA-Z0-9-]/g, '');

  try {
    const command = new DeleteObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${userPrefix}${sanitizedNoteId}.json`,
    });

    await s3Client.send(command);

    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: '',
    };
  } catch (error) {
    console.error('Error deleting note:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Failed to delete note' }),
    };
  }
}

function generateNoteId(): string {
  return `note-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * 表示名のバリデーション
 */
function validateDisplayName(input: string): { isValid: boolean; displayName?: string; error?: string } {
  if (typeof input !== 'string') {
    return { isValid: false, error: '表示名は文字列である必要があります' };
  }

  // 前後空白をトリミング
  let displayName = input.trim();

  // NFC正規化
  displayName = displayName.normalize('NFC');

  // 空文字チェック
  if (displayName.length === 0) {
    return { isValid: false, error: '表示名を入力してください' };
  }

  // 制御文字とゼロ幅文字を除外
  const controlCharRegex = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/g;
  displayName = displayName.replace(controlCharRegex, '');

  // 再度空文字チェック（制御文字除去後）
  if (displayName.length === 0) {
    return { isValid: false, error: '有効な文字を含む表示名を入力してください' };
  }

  // 最大100文字チェック（正規化・制御文字除去後）
  if (displayName.length > 100) {
    return { isValid: false, error: '表示名は100文字以内で入力してください' };
  }

  return { isValid: true, displayName };
}

/**
 * ユーザー設定を取得
 */
async function getUserSettings(userId: string): Promise<APIGatewayProxyResult> {
  try {
    const command = new GetObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${NOTES_PREFIX}users/${userId}/settings.json`,
    });

    const response = await s3Client.send(command);
    const settingsContent = await response.Body!.transformToString();
    const settings = JSON.parse(settingsContent);

    console.log(`Settings retrieved successfully for user: ${userId}`);
    
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify(settings),
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      console.log(`Settings not found for user: ${userId}`);
      return {
        statusCode: 404,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: 'Settings not found' }),
      };
    }

    console.error('Error getting settings:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Failed to get settings' }),
    };
  }
}

/**
 * ユーザー設定を更新
 */
async function updateUserSettings(userId: string, settingsData: Partial<UserSettings>): Promise<APIGatewayProxyResult> {
  try {
    if (!settingsData.displayName) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: '表示名は必須です' }),
      };
    }

    const validation = validateDisplayName(settingsData.displayName);
    if (!validation.isValid) {
      return {
        statusCode: 400,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ error: validation.error }),
      };
    }

    // 既存の設定を取得（createdAtを保持するため）
    let existingSettings: UserSettings | null = null;
    try {
      const getCommand = new GetObjectCommand({
        Bucket: NOTES_BUCKET,
        Key: `${NOTES_PREFIX}users/${userId}/settings.json`,
      });
      const response = await s3Client.send(getCommand);
      const content = await response.Body!.transformToString();
      existingSettings = JSON.parse(content);
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        console.error('Error getting existing settings:', error);
      }
    }

    const now = new Date().toISOString();
    const settings: UserSettings = {
      displayName: validation.displayName!,
      createdAt: existingSettings?.createdAt || now,
      updatedAt: now,
    };

    const command = new PutObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: `${NOTES_PREFIX}users/${userId}/settings.json`,
      Body: JSON.stringify(settings),
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256',
    });

    await s3Client.send(command);

    console.log(`Settings updated successfully for user: ${userId}`);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify(settings),
    };
  } catch (error) {
    console.error('Error updating settings:', error);
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ error: 'Failed to update settings' }),
    };
  }
}