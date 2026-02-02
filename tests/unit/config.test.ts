import { isLocalMode } from '../../lib/config';

describe('config utilities', () => {
  describe('isLocalMode', () => {
    it('returns true for undefined config', () => {
      expect(isLocalMode()).toBe(true);
    });

    it('returns true for config with placeholder API URL containing "your-api-id"', () => {
      const config = {
        apiBaseUrl: 'https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://real-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'real-client-id',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns true for config with PLACEHOLDER_API_URL', () => {
      const config = {
        apiBaseUrl: 'PLACEHOLDER_API_URL',
        cognitoDomain: 'https://real-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'real-client-id',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns true for config with placeholder cognito domain containing "your-domain"', () => {
      const config = {
        apiBaseUrl: 'https://real-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://your-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'real-client-id',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns true for config with PLACEHOLDER_COGNITO_DOMAIN', () => {
      const config = {
        apiBaseUrl: 'https://real-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'PLACEHOLDER_COGNITO_DOMAIN',
        clientId: 'real-client-id',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns true for config with placeholder client ID containing "your-client-id"', () => {
      const config = {
        apiBaseUrl: 'https://real-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://real-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'your-client-id',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns true for config with PLACEHOLDER_CLIENT_ID', () => {
      const config = {
        apiBaseUrl: 'https://real-api-id.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://real-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'PLACEHOLDER_CLIENT_ID',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(true);
    });

    it('returns false for config with all real AWS values', () => {
      const config = {
        apiBaseUrl: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com/prod',
        cognitoDomain: 'https://real-domain.auth.ap-northeast-1.amazoncognito.com',
        clientId: 'real-client-id-123',
        userPoolId: 'ap-northeast-1_real-user-pool-id',
        identityPoolId: 'ap-northeast-1:real-identity-pool-id-123',
        region: 'ap-northeast-1',
        notesBucket: 'real-notes-bucket-123',
        notesPrefix: 'prod/'
      };
      expect(isLocalMode(config)).toBe(false);
    });
  });
});