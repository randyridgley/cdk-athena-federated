import { Aws, Duration, Stack, StackProps } from "aws-cdk-lib";
import { CfnEnvironmentEC2 } from "aws-cdk-lib/aws-cloud9";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { ISecurityGroup, IVpc, SubnetType } from "aws-cdk-lib/aws-ec2";
import { CfnInstanceProfile, CompositePrincipal, Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { AdotLambdaExecWrapper, AdotLambdaLayerJavaScriptSdkVersion, AdotLayerVersion, Architecture, LambdaInsightsVersion, Runtime, Tracing } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Construct } from "constructs";

export interface LoaderStackProps extends StackProps {
  readonly securityGroup: ISecurityGroup;
  readonly vpc: IVpc,
  readonly dynamoDbTable: Table,
  readonly redisHost: string,
}

export class LoaderStack extends Stack {
  constructor(scope: Construct, id: string, props: LoaderStackProps) {
    super(scope, id, props);

    const loaderLambdaRole = new Role(this, 'loaderLambdaRole', {
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
    });

    loaderLambdaRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'dynamodb:PutItem',
        'dynamodb:BatchWriteItem',
      ],
      resources: [
        props.dynamoDbTable.tableArn,
      ],
      sid: 'AllowInsertAccessToTable',
    }));

    loaderLambdaRole.addToPolicy(new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:PutLogEvents',
      ],
      resources: [
        `arn:aws:logs:${Aws.REGION}:${Aws.ACCOUNT_ID}:*`,
      ],
      sid: 'LoaderLogging',
    }));

    new NodejsFunction(this, 'LoaderLambda', {
      functionName: 'AthenaFederatedLoader',
      entry: './src/lambda/loader/index.ts',
      runtime: Runtime.NODEJS_18_X,
      role: loaderLambdaRole,
      handler: 'handler',
      memorySize: 256,
      timeout: Duration.minutes(15),
      environment: {
        REDIS_HOST: props.redisHost,
        DYNAMODB_TABLE: props.dynamoDbTable.tableName,
      },
      vpc: props.vpc,
      securityGroups: [props.securityGroup],
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS,
      }),
      insightsVersion: LambdaInsightsVersion.VERSION_1_0_229_0,
      architecture: Architecture.ARM_64,
      bundling: {
        externalModules: [],
        nodeModules: [
          '@faker-js/faker',
          'ioredis',
        ],
        minify: false,
      },
      tracing: Tracing.ACTIVE,
      adotInstrumentation: {
        execWrapper: AdotLambdaExecWrapper.REGULAR_HANDLER,
        layerVersion: AdotLayerVersion.fromJavaScriptSdkLayerVersion(AdotLambdaLayerJavaScriptSdkVersion.LATEST),
      },
    });

    new CfnEnvironmentEC2(this, 'Cloud9Env', {
      name: 'redis-connection',
      instanceType: 't2.micro',
      automaticStopTimeMinutes: 60,
      connectionType: "CONNECT_SSM",
    });

    new Role(this, 'RedisAWSCloud9SSMAccessRole', {
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('cloud9.amazonaws.com'),
        new ServicePrincipal('ec2.amazonaws.com')
      ),
      roleName: 'RedisAWSCloud9SSMAccessRole',
      description: 'Service linked role for AWS Cloud9',
      path: '/service-role/',
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AWSCloud9SSMInstanceProfile'),
      ]
    });

    new CfnInstanceProfile(this, 'cloud9', {
      instanceProfileName: 'AWSCloud9SSMInstanceProfileRedisConnection',
      roles: ['RedisAWSCloud9SSMAccessRole'],
      path: '/cloud9/'
    })
  }
}