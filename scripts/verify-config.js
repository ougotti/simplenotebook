#!/usr/bin/env node

/**
 * Verify that config.json contains valid AWS resource URLs
 * and no placeholder values remain
 */

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../public/config/config.json');

function verifyConfig() {
  console.log('🔍 Verifying config.json...');

  // Check if config file exists
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('❌ Error: config.json not found at', CONFIG_PATH);
    process.exit(1);
  }

  // Read and parse config
  let config;
  try {
    const configContent = fs.readFileSync(CONFIG_PATH, 'utf8');
    config = JSON.parse(configContent);
  } catch (error) {
    console.error('❌ Error: config.json is not valid JSON:', error.message);
    process.exit(1);
  }

  console.log('📄 Config content:');
  console.log(JSON.stringify(config, null, 2));

  // Required fields
  const requiredFields = [
    'apiBaseUrl',
    'cognitoDomain',
    'clientId',
    'userPoolId',
    'identityPoolId',
    'region',
    'notesBucket',
    'notesPrefix'
  ];

  // Check for missing fields
  const missingFields = requiredFields.filter(field => !config[field]);
  if (missingFields.length > 0) {
    console.error('❌ Error: Missing required fields:', missingFields);
    process.exit(1);
  }

  // Check for placeholder values
  const placeholders = ['PLACEHOLDER', 'your-', 'your_', 'example.com'];
  const configString = JSON.stringify(config);
  
  for (const placeholder of placeholders) {
    if (configString.includes(placeholder)) {
      console.error('❌ Error: Config contains placeholder values:', placeholder);
      console.error('Config:', configString);
      process.exit(1);
    }
  }

  // Validate URL formats
  const urlFields = ['apiBaseUrl', 'cognitoDomain'];
  for (const field of urlFields) {
    try {
      new URL(config[field]);
    } catch (error) {
      console.error(`❌ Error: ${field} is not a valid URL:`, config[field]);
      process.exit(1);
    }
  }

  // Check AWS-specific formats
  try {
    const apiUrl = new URL(config.apiBaseUrl);
    // AWS API Gateway endpoint pattern: {restapi-id}.execute-api.{region}.amazonaws.com
    const apiGatewayRegex = /^[a-z0-9\-]+\.execute-api\.[a-z0-9\-]+\.amazonaws\.com$/;
    if (!apiGatewayRegex.test(apiUrl.hostname)) {
      console.error('❌ Error: apiBaseUrl does not look like a valid AWS API Gateway URL:', config.apiBaseUrl);
      process.exit(1);
    }
  } catch (error) {
    console.error('❌ Error: apiBaseUrl is not a valid URL:', config.apiBaseUrl);
    process.exit(1);
  }

  // Validate Cognito domain format: https://{domain}.auth.{region}.amazoncognito.com
  const cognitoDomainPattern = /^https:\/\/([a-zA-Z0-9-]+)\.auth\.([a-z0-9-]+)\.amazoncognito\.com$/;
  if (!cognitoDomainPattern.test(config.cognitoDomain)) {
    console.error('❌ Error: cognitoDomain does not match expected Cognito domain pattern:', config.cognitoDomain);
    process.exit(1);
  }

  // Validate identityPoolId format: region:uuid
  const identityPoolIdRegex = /^[a-z]{2}-[a-z]+-\d{1}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  if (!identityPoolIdRegex.test(config.identityPoolId)) {
    console.error('❌ Error: identityPoolId does not match AWS format (region:uuid):', config.identityPoolId);
    process.exit(1);
  }

  console.log('✅ Config validation passed!');
  console.log('✅ All required fields present');
  console.log('✅ No placeholder values found');
  console.log('✅ URLs are valid');
  console.log('✅ AWS resource formats look correct');
}

if (require.main === module) {
  verifyConfig();
}

module.exports = verifyConfig;