import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

interface SimpleAiStackProps extends cdk.StackProps {
  stageName: string;
}

export class SimpleAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimpleAiStackProps) {
    super(scope, id, props);

    const stage = props.stageName;

    // ========== DynamoDB (single-table) ==========
    const table = new dynamodb.Table(this, 'MainTable', {
      tableName: `simple-ai-${stage}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      timeToLiveAttribute: 'ttl',
    });

    table.addGlobalSecondaryIndex({
      indexName: 'byTenantAndUpdatedAt',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'byChannelExternalId',
      partitionKey: { name: 'channelExternalId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'byEmail',
      partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
    });

    table.addGlobalSecondaryIndex({
      indexName: 'byContactPhone',
      partitionKey: { name: 'contactPhone', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
    });

    // ========== S3 (attachments) ==========
    const bucket = new s3.Bucket(this, 'AttachmentsBucket', {
      bucketName: `simple-ai-attachments-${stage}`,
      removalPolicy: stage === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: stage !== 'prod',
    });

    // ========== SQS ==========
    const incomingMessagesQueue = new sqs.Queue(this, 'IncomingMessagesQueue', {
      queueName: `simple-ai-incoming-messages-${stage}`,
      visibilityTimeout: cdk.Duration.seconds(120),
    });

    // ========== Lambdas ==========
    const apiLambda = new lambda.Function(this, 'ApiLambda', {
      functionName: `simple-ai-api-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/api/dist')),
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        INCOMING_MESSAGES_QUEUE_URL: incomingMessagesQueue.queueUrl,
        OPENAI_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/openai:SecretString:apiKey}}`,
        ANTHROPIC_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/anthropic:SecretString:apiKey}}`,
        GOOGLE_SEARCH_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/google-search:SecretString:apiKey}}`,
        GOOGLE_SEARCH_CX: `{{resolve:secretsmanager:simple-ai/${stage}/google-search:SecretString:cx}}`,
        FIRECRAWL_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/firecrawl:SecretString:apiKey}}`,
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
    });

    // Function URL for long-running requests (no 30s API Gateway limit)
    const apiLambdaUrl = apiLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
      cors: {
        allowedOrigins: ['*'],
        allowedMethods: [lambda.HttpMethod.ALL],
        allowedHeaders: ['*'],
      },
    });

    new cdk.CfnOutput(this, 'ApiLambdaUrl', { value: apiLambdaUrl.url });

    const webhookLambda = new lambda.Function(this, 'WebhookReceiverLambda', {
      functionName: `simple-ai-webhook-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/webhook-receiver/dist')),
      environment: {
        INCOMING_MESSAGES_QUEUE_URL: incomingMessagesQueue.queueUrl,
        WHATSAPP_VERIFY_TOKEN: `{{resolve:secretsmanager:simple-ai/${stage}/whatsapp:SecretString:verifyToken}}`,
      },
      timeout: cdk.Duration.seconds(10),
      memorySize: 128,
    });

    const messageProcessorLambda = new lambda.Function(this, 'MessageProcessorLambda', {
      functionName: `simple-ai-message-processor-${stage}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/message-processor/dist')),
      environment: {
        TABLE_NAME: table.tableName,
        BUCKET_NAME: bucket.bucketName,
        ANTHROPIC_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/anthropic:SecretString:apiKey}}`,
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(90),
      memorySize: 512,
    });

    // ========== Permissions ==========
    table.grantReadWriteData(apiLambda);
    table.grantReadWriteData(messageProcessorLambda);
    bucket.grantReadWrite(apiLambda);
    bucket.grantRead(messageProcessorLambda);
    incomingMessagesQueue.grantSendMessages(webhookLambda);
    incomingMessagesQueue.grantSendMessages(apiLambda);

    // SQS trigger for message processor
    messageProcessorLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(incomingMessagesQueue, {
        batchSize: 1,
      })
    );

    // ========== API Gateway ==========
    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', {
      apiName: `simple-ai-api-${stage}`,
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [apigatewayv2.CorsHttpMethod.ANY],
        allowHeaders: ['*'],
      },
    });

    httpApi.addRoutes({
      path: '/webhook',
      methods: [apigatewayv2.HttpMethod.GET, apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration('WebhookIntegration', webhookLambda),
    });

    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2Integrations.HttpLambdaIntegration('ApiIntegration', apiLambda),
    });

    // ========== Outputs ==========
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}
