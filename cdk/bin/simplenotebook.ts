#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SimplenotebookStack } from '../lib/simplenotebook-stack';

const app = new cdk.App();

const stackName = process.env.STACK_NAME || 'SimplenotebookStack';
const environment = process.env.ENVIRONMENT || 'prod';

new SimplenotebookStack(app, stackName, {
  environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
  },
});