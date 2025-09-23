import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '../lib/api';
import { UserSettings, UpdateUserSettingsRequest } from '../types/userSettings';

export function useUserSettings() {
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await apiClient.getUserSettings();
      setSettings(response.settings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSettings = useCallback(async (updateRequest: UpdateUserSettingsRequest) => {
    try {
      setSaving(true);
      setError(null);
      const response = await apiClient.updateUserSettings(updateRequest);
      setSettings(response.settings);
      return response.settings;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update settings');
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return {
    settings,
    loading,
    error,
    saving,
    updateSettings,
    refetchSettings: fetchSettings,
  };
}