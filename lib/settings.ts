/**
 * ユーザー設定データの型定義とバリデーション
 */

export interface UserSettings {
  displayName: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * 表示名のバリデーション
 * - ゼロ幅・制御文字は除外
 * - 前後空白トリミング＋NFC正規化
 * - 最大100文字
 */
export function validateDisplayName(input: string): { isValid: boolean; displayName?: string; error?: string } {
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
  // Unicode categories: Cc (制御文字), Cf (フォーマット文字)
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
 * 設定データ全体のバリデーション
 */
export function validateUserSettings(input: Partial<UserSettings>): { isValid: boolean; settings?: UserSettings; errors?: string[] } {
  const errors: string[] = [];

  if (!input.displayName) {
    errors.push('表示名は必須です');
    return { isValid: false, errors };
  }

  const displayNameValidation = validateDisplayName(input.displayName);
  if (!displayNameValidation.isValid) {
    errors.push(displayNameValidation.error!);
    return { isValid: false, errors };
  }

  const now = new Date().toISOString();
  const settings: UserSettings = {
    displayName: displayNameValidation.displayName!,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };

  return { isValid: true, settings };
}