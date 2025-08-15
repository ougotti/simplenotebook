import { Amplify } from 'aws-amplify';
import { getConfig } from './config';

let isConfigured = false;

export async function configureAmplify() {
  if (isConfigured) return;
  
  try {
    const config = await getConfig();
    
    Amplify.configure({
      Auth: {
        Cognito: {
          userPoolId: config.userPoolId,
          userPoolClientId: config.clientId,
          identityPoolId: config.identityPoolId,
          loginWith: {
            oauth: {
              domain: extractDomain(config.cognitoDomain),
              scopes: ['email', 'profile', 'openid'],
              redirectSignIn: ['https://ougotti.github.io/simplenotebook/note/new'],
              redirectSignOut: ['https://ougotti.github.io/simplenotebook/'],
              responseType: 'code',
            },
          },
        },
      },
      Storage: {
        S3: {
          bucket: config.notesBucket,
          region: config.region,
        },
      },
    });
    
    isConfigured = true;
  } catch (error) {
    console.error('Failed to configure Amplify:', error);
    throw error;
  }
}

function extractDomain(cognitoDomain: string): string {
  return cognitoDomain.replace('https://', '').replace('http://', '');
}