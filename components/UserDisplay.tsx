'use client';

import { useState, useEffect } from 'react';
import { UserSettings } from '../lib/api';

interface UserDisplayProps {
  className?: string;
}

export default function UserDisplay({ className = '' }: UserDisplayProps) {
  const [userSettings, setUserSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUserSettings() {
      try {
        const { apiClient } = await import('../lib/api');
        const settings = await apiClient.getUserSettings();
        setUserSettings(settings);
      } catch (error) {
        console.error('設定読み込みエラー:', error);
      } finally {
        setLoading(false);
      }
    }

    loadUserSettings();
  }, []);

  if (loading) {
    return (
      <div className={`flex items-center space-x-2 ${className}`}>
        <div className="animate-pulse">
          <div className="h-4 bg-gray-300 rounded w-20"></div>
        </div>
      </div>
    );
  }

  if (!userSettings) {
    return (
      <div className={`text-gray-500 text-sm ${className}`}>
        設定未読み込み
      </div>
    );
  }

  return (
    <div className={`${className}`}>
      <div className="text-sm font-medium text-gray-900 break-words whitespace-pre-wrap">
        {userSettings.displayName}
      </div>
    </div>
  );
}