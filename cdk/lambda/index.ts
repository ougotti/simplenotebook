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
  createdAt: string;
  updatedAt: string;
}

interface UserSettings {
  displayName?: string;
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    language?: string;
  };
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
      case 'OPTIONS /user/settings':
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
      
      case 'GET /user/settings':
        return await getUserSettings(sanitizedUserId);
      
      case 'PUT /user/settings':
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

async function getUserSettings(userId: string): Promise<APIGatewayProxyResult> {
  const settingsKey = `${NOTES_PREFIX}${userId}/settings.json`;

  try {
    const command = new GetObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: settingsKey,
    });

    const response = await s3Client.send(command);
    const settingsContent = await response.Body!.transformToString();
    const settings = JSON.parse(settingsContent);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ settings }),
    };
  } catch (error: any) {
    if (error.name === 'NoSuchKey') {
      // Return default settings if none exist
      const defaultSettings: UserSettings = {
        updatedAt: new Date().toISOString(),
      };
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': 'https://ougotti.github.io',
          'Access-Control-Allow-Headers': 'Authorization,Content-Type',
        },
        body: JSON.stringify({ settings: defaultSettings }),
      };
    }
    throw error;
  }
}

async function updateUserSettings(userId: string, updateData: Partial<UserSettings>): Promise<APIGatewayProxyResult> {
  const settingsKey = `${NOTES_PREFIX}${userId}/settings.json`;

  try {
    // Get existing settings
    let existingSettings: UserSettings = {
      updatedAt: new Date().toISOString(),
    };

    try {
      const getCommand = new GetObjectCommand({
        Bucket: NOTES_BUCKET,
        Key: settingsKey,
      });
      const response = await s3Client.send(getCommand);
      const settingsContent = await response.Body!.transformToString();
      existingSettings = JSON.parse(settingsContent);
    } catch (error: any) {
      if (error.name !== 'NoSuchKey') {
        throw error;
      }
      // If settings don't exist, continue with default
    }

    // Update settings
    const updatedSettings: UserSettings = {
      ...existingSettings,
      displayName: updateData.displayName !== undefined ? updateData.displayName : existingSettings.displayName,
      preferences: updateData.preferences !== undefined ? updateData.preferences : existingSettings.preferences,
      updatedAt: new Date().toISOString(),
    };

    // Save updated settings
    const putCommand = new PutObjectCommand({
      Bucket: NOTES_BUCKET,
      Key: settingsKey,
      Body: JSON.stringify(updatedSettings),
      ContentType: 'application/json',
    });

    await s3Client.send(putCommand);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': 'https://ougotti.github.io',
        'Access-Control-Allow-Headers': 'Authorization,Content-Type',
      },
      body: JSON.stringify({ settings: updatedSettings }),
    };
  } catch (error) {
    console.error('Error updating user settings:', error);
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