/**
 * ユーザー設定の型定義
 */
export interface UserSettings {
  /** ユーザーの表示名（カスタム設定） */
  displayName?: string;
  /** その他の設定項目を将来追加する可能性を考慮 */
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    language?: string;
  };
  /** 設定の最終更新日時 */
  updatedAt: string;
}

/**
 * ユーザー設定のAPIレスポンス
 */
export interface UserSettingsResponse {
  settings: UserSettings;
}

/**
 * ユーザー設定の更新リクエスト
 */
export interface UpdateUserSettingsRequest {
  displayName?: string;
  preferences?: {
    theme?: 'light' | 'dark' | 'system';
    language?: string;
  };
}