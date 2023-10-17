
import { Code, Connection, ConnectionType, GlueVersion, Job, JobExecutable, PythonVersion } from '@aws-cdk/aws-glue-alpha';
import { DatabaseEngine, DatabaseScriptRunner, DatabaseUserGrant, DatabaseUserInitializer } from '@thundra/cdk-rds-initializer';
import { Duration, RemovalPolicy, SecretValue, Stack, StackProps } from 'aws-cdk-lib';
import { IVpc, Peer, Port, SecurityGroup, SubnetType } from 'aws-cdk-lib/aws-ec2';
import { Effect, ManagedPolicy, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import { CfnStreamConsumer, Stream, StreamMode } from 'aws-cdk-lib/aws-kinesis';
import { Code as LambdaCode, EventSourceMapping, Function, Runtime, StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { AuroraMysqlEngineVersion, Credentials, DatabaseCluster, DatabaseClusterEngine } from 'aws-cdk-lib/aws-rds';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Secret } from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

const path = require('path')

export interface RdsGenericStackProps extends StackProps {
  readonly table: string;
  readonly vpc: IVpc;
}

export class RdsGenericStack extends Stack {
  constructor(scope: Construct, id: string, props: RdsGenericStackProps) {
    super(scope, id, props);

    const bucket = new Bucket(this, 'DataBucket', {});

    const stream = new Stream(this, 'KinesisStream', {
      streamMode: StreamMode.ON_DEMAND
    });

    const securityGroup = new SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc
    });

    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(3306));
    securityGroup.addIngressRule(securityGroup, Port.allTcp())

    const databaseAdminUserSecret = new Secret(this, `database-admin-secret`, {
      secretName: `database-admin-secret`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          'username': 'dbadmin',
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    const databaseRWUserSecret = new Secret(this, `database-rw-user-secret`, {
      secretName: `database-rw-user-secret`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          'username': 'athena'
        }),
        excludePunctuation: true,
        includeSpace: false,
        generateStringKey: 'password'
      }
    });

    const cluster = new DatabaseCluster(this, 'DbCluster', {
      engine: DatabaseClusterEngine.auroraMysql({ version: AuroraMysqlEngineVersion.VER_3_01_1 }),
      port: 3306,
      defaultDatabaseName: "sales",
      credentials: Credentials.fromSecret(databaseAdminUserSecret, "dbadmin"),
      instances: 2,
      instanceProps: {
        publiclyAccessible: false,
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: SubnetType.PRIVATE_WITH_EGRESS
        },
        securityGroups: [securityGroup]
      },
      removalPolicy: RemovalPolicy.DESTROY,
      cloudwatchLogsExports: ['error', 'general', 'slowquery', 'audit'],
      cloudwatchLogsRetention: RetentionDays.ONE_DAY,
      monitoringInterval: Duration.seconds(60),
    });
    const subnet = props.vpc.privateSubnets[0]; // just pick one

    // make glue connection, use same security group and subnet as cluster above.
    const glueConnection = new Connection(this, 'MySqlGlueConnection', {
      type: ConnectionType.JDBC,
      connectionName: 'MySqlGlueConnectionToVpc',
      securityGroups: [securityGroup],
      subnet: subnet,      
      properties: {
        JDBC_CONNECTION_URL: `jdbc:mysql://${cluster.clusterEndpoint.socketAddress}/sales`,
        USERNAME: Credentials.fromSecret(databaseAdminUserSecret, "dbadmin").username,
        PASSWORD: SecretValue.unsafePlainText(Credentials.fromSecret(databaseAdminUserSecret, "dbadmin").password!.toString()).toString(),
        VPC: props.vpc.vpcId,
      }
    });
    var role = new Role(this, 'glue-job-managed-role', {
      assumedBy: new ServicePrincipal("glue.amazonaws.com")
    });

    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"));
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy"));
    role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName("AmazonS3FullAccess"));

    role.addToPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ["s3:GetObject", "s3:PutObject"],
        resources: [`arn:aws:s3:::${bucket.bucketName}/*`],
      })
    );
    stream.grantWrite(role);

    new Job(this, `MySqlGlueJobSingleTable`, {
      executable: JobExecutable.pythonEtl({
        glueVersion: GlueVersion.V4_0,
        pythonVersion: PythonVersion.THREE,
        script: Code.fromAsset(path.join(__dirname, `../glue-scripts/mysql.py`))
      }),
      role: role,
      connections: [
        glueConnection
      ],
      defaultArguments: {
        '--source_connection': glueConnection.connectionName,
        '--table_name': 'customer',
        '--kinesis_stream': stream.streamName
      }
    });

    const userInitializer = new DatabaseUserInitializer(this, 'sample-database-user-initializer', {
      databaseAdminUserSecret: databaseAdminUserSecret,
      databaseEngine: DatabaseEngine.MySQL,
      databaseUsers: [
        {
          username: 'athena',
          grants: [DatabaseUserGrant.ALL_PRIVILEGES],
          secret: databaseRWUserSecret
        },
      ],
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      }),
      securityGroups: [securityGroup],
    });
    userInitializer.node.addDependency(cluster);

    const scriptRunner = new DatabaseScriptRunner(this, 'sample-database-script-runner', {
      databaseAdminUserSecret: databaseAdminUserSecret,
      databaseEngine: DatabaseEngine.MySQL,
      script: `CREATE TABLE IF NOT EXISTS sales.customer(id VARCHAR(255), name VARCHAR(255)); 
      INSERT INTO sales.customer values ("1", "Randy"); 
      INSERT INTO sales.customer values ("2", "Randy");`,
      vpc: props.vpc,
      vpcSubnets: props.vpc.selectSubnets({
        subnetType: SubnetType.PRIVATE_WITH_EGRESS
      }),
      securityGroups: [securityGroup],      
    });
    scriptRunner.node.addDependency(cluster);

     const lambdaFunction = new Function(this, 'Function', {
      code: LambdaCode.fromAsset('src/lambda/consumer'),
      handler: 'index.handler',
      functionName: 'KinesisMessageHandler',
      runtime: Runtime.NODEJS_18_X,
    });
    stream.grantReadWrite(lambdaFunction);

    const consumer = new CfnStreamConsumer(this, 'EFOConsumer', {
      streamArn: stream.streamArn,
      consumerName: 'efoConsumer'
    });
    
    new EventSourceMapping(this, 'EventSourceMapping', {
      batchSize: 10000,
      startingPosition: StartingPosition.LATEST,
      eventSourceArn: consumer.attrConsumerArn,
      target: lambdaFunction,
    });

    lambdaFunction.addToRolePolicy(new PolicyStatement({
      actions: ['kinesis:SubscribeToShard'],
      effect: Effect.ALLOW,
      resources: [
          consumer.attrConsumerArn
      ]
    }));
  }
}