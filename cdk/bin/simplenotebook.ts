#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { SimplenotebookStack } from '../lib/simplenotebook-stack';

const app = new cdk.App();

const stackName = process.env.STACK_NAME || 'SimplenotebookStack';
const environment = process.env.ENVIRONMENT || 'prod';

// simplenotebook 専用の CDK ブートストラップ(qualifier: snbook)を使う。
// 既定のブートストラップ(hnb659fds)の実行ロールは同じアカウントのほかの CDK アプリと共有で AdministratorAccess のため、
// 専用ブートストラップの実行ロールにだけ simplenotebook のリソースに絞った権限を付けている(B-21。docs/iam/README.md)
export const BOOTSTRAP_QUALIFIER = 'snbook';

new SimplenotebookStack(app, stackName, {
  environment,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
  },
  synthesizer: new cdk.DefaultStackSynthesizer({ qualifier: BOOTSTRAP_QUALIFIER }),
});
