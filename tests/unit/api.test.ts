/**
 * @jest-environment jsdom
 */
import { apiClient } from '../../lib/api';

// Mock the config module
jest.mock('../../lib/config', () => ({
  getConfig: jest.fn(),
}));

import { getConfig } from '../../lib/config';
const mockGetConfig = getConfig as jest.MockedFunction<typeof getConfig>;

describe('ApiClient', () => {
  let mockFetch: jest.SpyInstance;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();
    
    // Clear the API client's internal state
    (apiClient as any).baseUrl = '';
    (apiClient as any).accessToken = '';
    
    // Mock fetch
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation();
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe('initialization', () => {
    it('should initialize with config from getConfig', async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });

      await apiClient.initialize();
      
      expect(mockGetConfig).toHaveBeenCalledTimes(1);
    });

    it('should throw error for unconfigured API with placeholder values', async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });

      // Mock fetch to simulate failure - but the error should be thrown before fetch is called
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ notes: [] }),
      });

      await expect(apiClient.listNotes()).rejects.toThrow('API is not configured. Please set up your AWS API Gateway endpoint.');
      
      // Fetch should not be called if the API is not configured
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('setAccessToken', () => {
    it('should set access token', () => {
      const token = 'test-token-123';
      apiClient.setAccessToken(token);
      // We can't directly test the private property, but we'll test it in API calls
    });
  });

  describe('listNotes', () => {
    beforeEach(async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });
    });

    it('should make GET request to /notes endpoint', async () => {
      const mockResponse = {
        notes: [
          { id: '1', title: 'Test Note', createdAt: '2023-01-01', updatedAt: '2023-01-01' }
        ]
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await apiClient.listNotes();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.execute-api.ap-northeast-1.amazonaws.com/prod/notes',
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ',
          },
        }
      );
      expect(result).toEqual(mockResponse);
    });

    it('should include access token in authorization header', async () => {
      // Reset access token first
      apiClient.setAccessToken('');
      apiClient.setAccessToken('test-token-123');
      
      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue({ notes: [] }),
      });

      await apiClient.listNotes();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            'Authorization': 'Bearer test-token-123',
          }),
        })
      );
    });

    it('should handle API errors', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: jest.fn().mockResolvedValue({ error: 'Server error' }),
      });

      await expect(apiClient.listNotes()).rejects.toThrow('API request failed: 500 Internal Server Error');
    });
  });

  describe('createNote', () => {
    beforeEach(async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });
    });

    it('should make POST request to /notes endpoint', async () => {
      const noteData = { title: 'New Note', content: 'Note content' };
      const mockResponse = {
        note: { id: '1', title: 'New Note', content: 'Note content', createdAt: '2023-01-01', updatedAt: '2023-01-01' }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await apiClient.createNote(noteData);

      expect(mockFetch).toHaveBeenCalledWith(
        'https://test.execute-api.ap-northeast-1.amazonaws.com/prod/notes',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ',
          },
          body: JSON.stringify(noteData),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('getNote', () => {
    beforeEach(async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });
    });

    it('should make GET request to /notes/:id endpoint', async () => {
      const noteId = 'test-note-id';
      const mockResponse = {
        note: { id: noteId, title: 'Test Note', content: 'Test content', createdAt: '2023-01-01', updatedAt: '2023-01-01' }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await apiClient.getNote(noteId);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://test.execute-api.ap-northeast-1.amazonaws.com/prod/notes/${noteId}`,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ',
          },
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('updateNote', () => {
    beforeEach(async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });
    });

    it('should make PUT request to /notes/:id endpoint', async () => {
      const noteId = 'test-note-id';
      const noteData = { title: 'Updated Note', content: 'Updated content' };
      const mockResponse = {
        note: { id: noteId, title: 'Updated Note', content: 'Updated content', createdAt: '2023-01-01', updatedAt: '2023-01-02' }
      };

      mockFetch.mockResolvedValue({
        ok: true,
        json: jest.fn().mockResolvedValue(mockResponse),
      });

      const result = await apiClient.updateNote(noteId, noteData);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://test.execute-api.ap-northeast-1.amazonaws.com/prod/notes/${noteId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ',
          },
          body: JSON.stringify(noteData),
        }
      );
      expect(result).toEqual(mockResponse);
    });
  });

  describe('deleteNote', () => {
    beforeEach(async () => {
      mockGetConfig.mockResolvedValue({
        apiBaseUrl: 'https://test.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://test.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'test-client-id',
        userPoolId: 'ap-northeast-1_test-user-pool-id',
        identityPoolId: 'ap-northeast-1:test-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'test-notes-bucket',
        notesPrefix: 'prod/'
      });
    });

    it('should make DELETE request to /notes/:id endpoint', async () => {
      const noteId = 'test-note-id';

      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: jest.fn(),
      });

      const result = await apiClient.deleteNote(noteId);

      expect(mockFetch).toHaveBeenCalledWith(
        `https://test.execute-api.ap-northeast-1.amazonaws.com/prod/notes/${noteId}`,
        {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ',
          },
        }
      );
      expect(result).toBeUndefined();
    });
  });
});