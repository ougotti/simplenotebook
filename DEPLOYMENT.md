# SimpleNotebook Deployment Guide

This guide explains how to deploy the SimpleNotebook application with AWS backend and GitHub Pages frontend.

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **Google Cloud Console** project for OAuth credentials
3. **GitHub repository** with GitHub Pages enabled

## Setup Steps

### 1. Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google+ API
4. Go to "Credentials" > "Create Credentials" > "OAuth 2.0 Client IDs"
5. Set application type to "Web application"
6. Add authorized redirect URI: `https://your-cognito-domain.auth.region.amazoncognito.com/oauth2/idpresponse`
7. Note down the Client ID and Client Secret

### 2. AWS Secrets Manager Setup

Store the Google OAuth credentials in AWS Secrets Manager:

```bash
aws secretsmanager create-secret \
  --name "google/oauth" \
  --description "Google OAuth credentials for SimpleNotebook" \
  --secret-string '{"client_id":"your-client-id","client_secret":"your-client-secret"}'
```

### 3. GitHub OIDC Setup

Create an OIDC provider in AWS IAM:

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1
```

### 4. GitHub Secrets Configuration

Add the following secrets to your GitHub repository:

- `AWS_ACCOUNT_ID`: Your AWS account ID

### 5. Deploy Infrastructure

The CDK stack will be automatically deployed when you push to the main branch. The stack includes:

- Cognito User Pool with Google IdP
- API Gateway with Lambda functions
- S3 bucket for note storage
- IAM roles and policies

### 6. Manual Configuration (if needed)

If automatic configuration fails, you can manually update the config file:

1. After CDK deployment, get the stack outputs:
   ```bash
   cd cdk
   npx cdk output
   ```

2. Update `public/config/config.json` with the correct values:
   ```json
   {
     "apiBaseUrl": "https://your-api-id.execute-api.ap-northeast-1.amazonaws.com/prod",
     "cognitoDomain": "https://your-domain.auth.ap-northeast-1.amazoncognito.com",
     "clientId": "your-cognito-client-id",
     "identityPoolId": "ap-northeast-1:your-identity-pool-id",
     "region": "ap-northeast-1",
     "notesBucket": "your-notes-bucket",
     "notesPrefix": "prod/"
   }
   ```

## Security Features

- **No secrets in GitHub**: All sensitive data stored in AWS Secrets Manager
- **OIDC authentication**: No AWS credentials in GitHub Actions
- **S3 security**: Public access blocked, SSL enforced, user-based access control
- **CORS protection**: API and S3 restricted to GitHub Pages origin
- **Input sanitization**: Lambda functions sanitize user inputs

## Local Development

For local development:

1. Install dependencies: `npm install`
2. Configure AWS credentials locally
3. Update config.json with development values
4. Run: `npm run dev`

## Troubleshooting

1. **Authentication fails**: Check Cognito configuration and Google OAuth settings
2. **API errors**: Verify API Gateway and Lambda function logs
3. **CORS errors**: Ensure origin is correctly configured in API Gateway and S3
4. **CDK deployment fails**: Check IAM permissions and AWS account limits