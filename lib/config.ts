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

export function isLocalMode(config?: AppConfig): boolean {
  if (!config) return true;
  
  // Check if config contains placeholder values indicating local development
  return config.apiBaseUrl.includes('your-api-id') ||
         config.apiBaseUrl.includes('PLACEHOLDER_API_URL') ||
         config.cognitoDomain.includes('your-domain') ||
         config.cognitoDomain.includes('PLACEHOLDER_COGNITO_DOMAIN') ||
         config.clientId.includes('your-client-id') ||
         config.clientId.includes('PLACEHOLDER_CLIENT_ID');
}