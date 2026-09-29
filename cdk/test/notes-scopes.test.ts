process.env.NOTES_BUCKET = 'test-bucket';

import { isRouteAllowed } from '../lambda/index';

const COGNITO = { authType: 'cognito', scopes: 'notes:read notes:write notes:delete' };
const READ_ONLY_PAT = { authType: 'pat', scopes: 'notes:read' };
const READ_WRITE_PAT = { authType: 'pat', scopes: 'notes:read notes:write' };

describe('isRouteAllowed', () => {
  it('ブラウザのログイン(Cognito)は従来どおり全操作できる', () => {
    for (const route of [
      'GET /notes',
      'GET /notes/{noteId}',
      'POST /notes',
      'PUT /notes/{noteId}',
      'DELETE /notes/{noteId}',
      'GET /users/me/settings',
      'PUT /users/me/settings',
    ]) {
      expect(isRouteAllowed(route, COGNITO)).toBe(true);
    }
  });

  it('notes:read だけの PAT は参照のみ', () => {
    expect(isRouteAllowed('GET /notes', READ_ONLY_PAT)).toBe(true);
    expect(isRouteAllowed('GET /notes/{noteId}', READ_ONLY_PAT)).toBe(true);
    expect(isRouteAllowed('POST /notes', READ_ONLY_PAT)).toBe(false);
    expect(isRouteAllowed('PUT /notes/{noteId}', READ_ONLY_PAT)).toBe(false);
    expect(isRouteAllowed('DELETE /notes/{noteId}', READ_ONLY_PAT)).toBe(false);
  });

  it('notes:write の PAT でも削除はできない', () => {
    expect(isRouteAllowed('POST /notes', READ_WRITE_PAT)).toBe(true);
    expect(isRouteAllowed('PUT /notes/{noteId}', READ_WRITE_PAT)).toBe(true);
    expect(isRouteAllowed('DELETE /notes/{noteId}', READ_WRITE_PAT)).toBe(false);
  });

  it('設定の参照・変更は PAT ではできない(スコープが揃っていても)', () => {
    const allScopesPat = { authType: 'pat', scopes: 'notes:read notes:write notes:delete' };
    expect(isRouteAllowed('GET /users/me/settings', allScopesPat)).toBe(false);
    expect(isRouteAllowed('PUT /users/me/settings', allScopesPat)).toBe(false);
  });

  it('context にスコープがなければ拒否する(安全側に倒す)', () => {
    expect(isRouteAllowed('GET /notes', { authType: 'pat' })).toBe(false);
    expect(isRouteAllowed('GET /notes', undefined)).toBe(false);
    expect(isRouteAllowed('GET /notes', { authType: 'pat', scopes: 'notes:read:extra' })).toBe(false);
  });
});

describe('OAuth のトークン(B-20)', () => {
  it('宛先は MCP だけなので、スコープがあっても REST API では使えない', () => {
    const oauth = { authType: 'oauth', scopes: 'notes:read notes:write' };
    for (const route of ['GET /notes', 'GET /notes/{noteId}', 'POST /notes', 'PUT /notes/{noteId}', 'GET /tags']) {
      expect(isRouteAllowed(route, oauth)).toBe(false);
    }
  });
});
