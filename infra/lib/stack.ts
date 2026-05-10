import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';

interface SimpleAiStackProps extends cdk.StackProps {
  stageName: string;
}

export class SimpleAiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimpleAiStackProps) {
    super(scope, id, props);

    const stage = props.stageName;
    const wahaApiKey = process.env.WAHA_API_KEY || 'simple-ai-waha-key';

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

    // ========== EC2: Evolution API ==========

    // Use default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVpc', { isDefault: true });

    const evolutionSg = new ec2.SecurityGroup(this, 'EvolutionSg', {
      vpc,
      description: 'Evolution API',
      allowAllOutbound: true,
    });
    evolutionSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(3000), 'WAHA API');
    evolutionSg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'SSH');

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'yum update -y',
      'yum install -y docker',
      'systemctl start docker',
      'systemctl enable docker',
      'mkdir -p /usr/local/lib/docker/cli-plugins',
      'curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 -o /usr/local/lib/docker/cli-plugins/docker-compose',
      'chmod +x /usr/local/lib/docker/cli-plugins/docker-compose',
      'mkdir -p /opt/waha',
      `docker login -u devlikeapro -p ${process.env.DOCKER_HUB_TOKEN || ''}`,
      'docker pull devlikeapro/waha-plus:latest',
      'docker logout',
      `cat > /opt/waha/docker-compose.yml << 'COMPOSE'
version: '3'
services:
  waha:
    image: devlikeapro/waha-plus:latest
    ports:
      - "3000:3000"
    environment:
      WHATSAPP_API_KEY: ${wahaApiKey}
    restart: always
COMPOSE`,
      'cd /opt/waha && docker compose up -d'
    );

    const evolutionInstance = new ec2.Instance(this, 'WahaInstance', {
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      securityGroup: evolutionSg,
      userData,
      userDataCausesReplacement: true,
      role: new iam.Role(this, 'EvolutionInstanceRole', {
        assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
        ],
      }),
    });

    const eip = new ec2.CfnEIP(this, 'EvolutionEIP', { domain: 'vpc' });
    new ec2.CfnEIPAssociation(this, 'EvolutionEIPAssoc', {
      allocationId: eip.attrAllocationId,
      instanceId: evolutionInstance.instanceId,
    });

    const wahaUrl = `http://${eip.ref}:3000`;
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
