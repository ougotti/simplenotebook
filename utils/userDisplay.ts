/**
 * ユーザー名表示のユーティリティ関数
 * 適切なフォールバック処理でユーザー名を取得
 */

interface UserWithAttributes {
  username?: string;
  signInDetails?: {
    loginId?: string;
  };
  // Google OAuth attributes from Cognito
  given_name?: string;
  family_name?: string;
  name?: string;
  email?: string;
  // Any additional properties
  [key: string]: any;
}

/**
 * ユーザーオブジェクトから表示用の名前を取得
 * 優先順位: name > given_name family_name > username > loginId > 'User'
 */
export function getUserDisplayName(user: UserWithAttributes | null): string {
  if (!user) {
    return 'User';
  }

  // 1. 'name' プロパティがある場合（Google OAuth）
  if (user.name && typeof user.name === 'string') {
    return user.name;
  }

  // 2. given_name と family_name を組み合わせ（Google OAuth）
  if (user.given_name || user.family_name) {
    const firstName = user.given_name || '';
    const lastName = user.family_name || '';
    const fullName = `${firstName} ${lastName}`.trim();
    if (fullName) {
      return fullName;
    }
  }

  // 3. username
  if (user.username && typeof user.username === 'string') {
    return user.username;
  }

  // 4. loginId（通常はメールアドレス）
  if (user.signInDetails?.loginId) {
    return user.signInDetails.loginId;
  }

  // 5. フォールバック
  return 'User';
}

/**
 * ユーザーのメールアドレスを取得
 */
export function getUserEmail(user: UserWithAttributes | null): string | null {
  if (!user) {
    return null;
  }

  // email プロパティ
  if (user.email && typeof user.email === 'string') {
    return user.email;
  }

  // loginId（通常はメールアドレス）
  if (user.signInDetails?.loginId) {
    return user.signInDetails.loginId;
  }

  return null;
}