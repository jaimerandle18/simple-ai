#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SimpleAiStack } from '../lib/stack';

const app = new cdk.App();
const env = app.node.tryGetContext('env') || 'dev';

new SimpleAiStack(app, `SimpleAi-${env}`, {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: 'sa-east-1',
  },
  stageName: env,
});
