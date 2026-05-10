import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

interface SimpleAiStackProps extends cdk.StackProps {
  stageName: string;
}

export class SimpleAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimpleAiStackProps) {
    super(scope, id, props);

    const stage = props.stageName;
    const wahaApiKey = process.env.WAHA_API_KEY || 'simple-ai-waha-secret';

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

    // ========== S3 ==========
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

    // ========== VPC (solo subnets públicas, sin NAT Gateway) ==========
    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: `simple-ai-${stage}`,
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    // ========== EFS para sesiones WAHA (persiste tras reinicios) ==========
    const wahaEfs = new efs.FileSystem(this, 'WahaEfs', {
      vpc,
      fileSystemName: `simple-ai-waha-${stage}`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
    });

    const wahaAccessPoint = wahaEfs.addAccessPoint('WahaAP', {
      path: '/sessions',
      createAcl: { ownerGid: '1000', ownerUid: '1000', permissions: '755' },
      posixUser: { gid: '1000', uid: '1000' },
    });

    // ========== ECS Cluster ==========
    const cluster = new ecs.Cluster(this, 'WahaCluster', {
      vpc,
      clusterName: `simple-ai-waha-${stage}`,
    });

    // ========== Task Definition ==========
    const wahaTaskDef = new ecs.FargateTaskDefinition(this, 'WahaTaskDef', {
      family: `simple-ai-waha-${stage}`,
      memoryLimitMiB: 512,
      cpu: 256,
    });

    wahaTaskDef.addVolume({
      name: 'waha-sessions',
      efsVolumeConfiguration: {
        fileSystemId: wahaEfs.fileSystemId,
        transitEncryption: 'ENABLED',
        authorizationConfig: {
          accessPointId: wahaAccessPoint.accessPointId,
          iam: 'ENABLED',
        },
      },
    });

    wahaEfs.grantRootAccess(wahaTaskDef.taskRole);

    const wahaLogGroup = new logs.LogGroup(this, 'WahaLogGroup', {
      logGroupName: `/ecs/simple-ai-waha-${stage}`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const wahaContainer = wahaTaskDef.addContainer('waha', {
      // devlikeapro/waha incluye el engine NOWEB desde v2023+
      image: ecs.ContainerImage.fromRegistry('devlikeapro/waha'),
      environment: {
        WHATSAPP_API_KEY: wahaApiKey,
        WHATSAPP_DEFAULT_ENGINE: 'NOWEB',
        WHATSAPP_SESSIONS_PATH: '/app/.waha/sessions',
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'waha',
        logGroup: wahaLogGroup,
      }),
      portMappings: [{ containerPort: 3000 }],
      healthCheck: {
        command: ['CMD-SHELL', 'wget -qO- http://localhost:3000/ > /dev/null 2>&1 || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(90),
      },
    });

    wahaContainer.addMountPoints({
      sourceVolume: 'waha-sessions',
      containerPath: '/app/.waha/sessions',
      readOnly: false,
    });

    // ========== Fargate Service + ALB ==========
    const wahaService = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'WahaService', {
      cluster,
      taskDefinition: wahaTaskDef,
      serviceName: `simple-ai-waha-${stage}`,
      desiredCount: 1,
      publicLoadBalancer: true,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      listenerPort: 80,
      healthCheckGracePeriod: cdk.Duration.seconds(120),
    });

    // EFS accesible desde el servicio Fargate
    wahaEfs.connections.allowDefaultPortFrom(wahaService.service.connections);

    // ALB health check
    wahaService.targetGroup.configureHealthCheck({
      path: '/',
      healthyHttpCodes: '200-401', // WAHA devuelve 401 sin auth key — es válido, el servidor está up
      interval: cdk.Duration.seconds(30),
      timeout: cdk.Duration.seconds(10),
      healthyThresholdCount: 2,
      unhealthyThresholdCount: 5,
    });

    // Reducir tiempo de drenado (el servicio es stateless por fuera de WAHA)
    wahaService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '10');

    const wahaUrl = `http://${wahaService.loadBalancer.loadBalancerDnsName}`;
    new cdk.CfnOutput(this, 'WahaUrl', { value: wahaUrl });

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
        WAHA_URL: wahaUrl,
        WAHA_API_KEY: wahaApiKey,
        STAGE: stage,
      },
      timeout: cdk.Duration.seconds(120),
      memorySize: 512,
    });

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
        GROQ_API_KEY: `{{resolve:secretsmanager:simple-ai/${stage}/groq:SecretString:apiKey}}`,
        WAHA_URL: wahaUrl,
        WAHA_API_KEY: wahaApiKey,
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

    messageProcessorLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(incomingMessagesQueue, { batchSize: 1 })
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

    apiLambda.addEnvironment('API_BASE_URL', (httpApi.url ?? '').replace(/\/$/, ''));

    // ========== Outputs ==========
    new cdk.CfnOutput(this, 'ApiUrl', { value: httpApi.url ?? '' });
    new cdk.CfnOutput(this, 'TableName', { value: table.tableName });
    new cdk.CfnOutput(this, 'BucketName', { value: bucket.bucketName });
  }
}
