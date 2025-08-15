#!/usr/bin/env node

/**
 * Generate config.json from CDK outputs
 * This script reads cdk-outputs.json and generates public/config/config.json
 * with real AWS resource URLs, mirroring what the GitHub Actions workflow does.
 */

const fs = require('fs');
const path = require('path');

const CDK_OUTPUTS_PATH = path.join(__dirname, '../cdk/cdk-outputs.json');
const CONFIG_DIR = path.join(__dirname, '../public/config');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

function generateConfig() {
  console.log('🔧 Generating config.json from CDK outputs...');

  // Check if CDK outputs file exists
  if (!fs.existsSync(CDK_OUTPUTS_PATH)) {
    console.error('❌ Error: cdk-outputs.json not found at', CDK_OUTPUTS_PATH);
    console.error('');
    console.error('Please run the following commands first:');
    console.error('  cd cdk');
    console.error('  npx cdk deploy --outputs-file cdk-outputs.json');
    console.error('');
    console.error('This will deploy your CDK stack and generate the outputs file.');
    process.exit(1);
  }

  // Read and parse CDK outputs
  let cdkOutputs;
  try {
    const cdkOutputsContent = fs.readFileSync(CDK_OUTPUTS_PATH, 'utf8');
    cdkOutputs = JSON.parse(cdkOutputsContent);
  } catch (error) {
    console.error('❌ Error: cdk-outputs.json is not valid JSON:', error.message);
    process.exit(1);
  }

  console.log('📄 CDK outputs found:');
  console.log(JSON.stringify(cdkOutputs, null, 2));

  // Extract stack name (first key in outputs)
  const stackName = Object.keys(cdkOutputs)[0];
  if (!stackName) {
    console.error('❌ Error: No stack outputs found in cdk-outputs.json');
    process.exit(1);
  }

  const stackOutputs = cdkOutputs[stackName];

  // Extract required values from CDK outputs
  const apiUrl = stackOutputs.ApiUrl;
  const clientId = stackOutputs.UserPoolClientId;
  const userPoolId = stackOutputs.UserPoolId;
  const identityPoolId = stackOutputs.IdentityPoolId;
  const cognitoDomain = stackOutputs.CognitoDomain;
  const notesBucket = stackOutputs.NotesBucketName;

  // Validate that all required outputs were extracted
  const requiredVars = {
    'ApiUrl': apiUrl,
    'UserPoolClientId': clientId,
    'UserPoolId': userPoolId,
    'IdentityPoolId': identityPoolId,
    'CognitoDomain': cognitoDomain,
    'NotesBucketName': notesBucket
  };

  const missingVars = [];
  for (const [varName, value] of Object.entries(requiredVars)) {
    if (!value || value === 'null') {
      missingVars.push(varName);
    }
  }

  if (missingVars.length > 0) {
    console.error('❌ Error: One or more CDK outputs are missing:');
    missingVars.forEach(varName => {
      console.error(`  - ${varName}`);
    });
    console.error('');
    console.error('Make sure your CDK stack deployed successfully and contains all required outputs.');
    process.exit(1);
  }

  console.log('✅ Successfully extracted all CDK outputs:');
  console.log(`API_URL: ${apiUrl}`);
  console.log(`CLIENT_ID: ${clientId}`);
  console.log(`USER_POOL_ID: ${userPoolId}`);
  console.log(`IDENTITY_POOL_ID: ${identityPoolId}`);
  console.log(`COGNITO_DOMAIN: ${cognitoDomain}`);
  console.log(`NOTES_BUCKET: ${notesBucket}`);

  // Create config object
  const config = {
    apiBaseUrl: apiUrl,
    cognitoDomain: cognitoDomain,
    clientId: clientId,
    userPoolId: userPoolId,
    identityPoolId: identityPoolId,
    region: 'ap-northeast-1',
    notesBucket: notesBucket,
    notesPrefix: 'prod/'
  };

  // Create config directory if it doesn't exist
  if (!fs.existsSync(CONFIG_DIR)) {
    console.log('📁 Creating config directory...');
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }

  // Write config.json
  try {
    const configContent = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_PATH, configContent, 'utf8');
    console.log('✅ Generated config.json at', CONFIG_PATH);
  } catch (error) {
    console.error('❌ Error writing config.json:', error.message);
    process.exit(1);
  }

  // Validate the generated config using the verification script
  console.log('🔍 Validating generated config...');
  try {
    const verifyConfig = require('./verify-config.js');
    verifyConfig();
    console.log('✅ Config validation successful!');
  } catch (error) {
    console.error('❌ Error: Generated config failed validation:', error.message);
    process.exit(1);
  }

  console.log('');
  console.log('🎉 Configuration generated successfully!');
  console.log('Your application is now ready to use with real AWS resources.');
  console.log('');
  console.log('Next steps:');
  console.log('  npm run dev    # Start development server');
  console.log('  npm run build  # Build for production');
}

if (require.main === module) {
  generateConfig();
}

module.exports = generateConfig;