interface AppConfig {
  apiBaseUrl: string;
  cognitoDomain: string;
  clientId: string;
  identityPoolId: string;
  userPoolId: string;
  region: string;
  notesBucket: string;
  notesPrefix: string;
}

let config: AppConfig | null = null;

export async function getConfig(): Promise<AppConfig> {
  if (!config) {
    try {
      const response = await fetch('/simplenotebook/config/config.json');
      if (!response.ok) {
        throw new Error(`Failed to load config: ${response.status}`);
      }
      config = await response.json();
    } catch (error) {
      console.error('Failed to load configuration:', error);
      throw error;
    }
  }
  return config!;
}