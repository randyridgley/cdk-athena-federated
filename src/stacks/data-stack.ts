import { Database } from "@aws-cdk/aws-glue-alpha";
import { RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import { IVpc, Peer, Port, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import { CfnReplicationGroup, CfnSubnetGroup } from "aws-cdk-lib/aws-elasticache";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { AthenaRedisDDBConnector } from "../constructs/redis-connector";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { AthenaDDBConnector } from "../constructs/ddb-connector";

export interface PrimaryEndpoint {
  address: string;
  port: Port;
}

export interface DataStackProps extends StackProps {
  vpc: IVpc;
}

export class DataStack extends Stack {
  private static readonly portNumber = 6379;

  public readonly securityGroup: SecurityGroup;
  public readonly primaryEndpoint: PrimaryEndpoint;
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { vpc } = props;

    const subnetGroup = new CfnSubnetGroup(this, "CacheSubnetGroup", {
      description: "Subnet group for the Redis cluster",
      subnetIds: vpc.privateSubnets.map((s) => s.subnetId),
    });

    this.securityGroup = new SecurityGroup(this, "RedisSecurityGroup", { vpc });
    this.securityGroup.connections.allowFrom(Peer.ipv4(props.vpc.vpcCidrBlock), Port.tcp(6379), 'From VPC');

    const replicationGroup = new CfnReplicationGroup(this, "RedisReplicationGroup", {
      replicationGroupDescription: "Replication group for Redis",
      numCacheClusters: 1,
      automaticFailoverEnabled: false,
      transitEncryptionEnabled: false,
      cacheSubnetGroupName: subnetGroup.ref,
      engine: "redis",
      cacheNodeType: "cache.m5.large",
      securityGroupIds: [this.securityGroup.securityGroupId],
      port: DataStack.portNumber,
      atRestEncryptionEnabled: true,
    });

    this.primaryEndpoint = {
      address: replicationGroup.attrPrimaryEndPointAddress,
      port: Port.tcp(DataStack.portNumber),
    };

    const databaseName = 'dynamodb_demo';

    this.table = new Table(this, 'DynamoDB', {
      partitionKey: { name: 'id', type: AttributeType.STRING },
      pointInTimeRecovery: true,
      tableName: 'demo',
      removalPolicy: RemovalPolicy.DESTROY,
      billingMode: BillingMode.PAY_PER_REQUEST,
    });

    new Database(this, 'GlueDatabase', {
      databaseName: databaseName, 
      locationUri: 'dynamo-db-flag',
    });

    const spillBucket = new Bucket(this, 'SpillBucket', {
      encryption: BucketEncryption.KMS,
      enforceSSL: true,
    });

    new AthenaDDBConnector(this, 'AthenaDDBConnector', {
      glueDatabaseName: databaseName,
      dynamodbTable: this.table,
      columns:     [
        {
          name: 'id',
          type: 'string'
        },
        {
          name: 'ticker',
          type: 'string'
        }
      ],
      spillBucketName: spillBucket.bucketName,
    });
    
    const redisDatabaseName = 'redis_demo';

    new Database(this, 'GlueDatabase', {
      databaseName: redisDatabaseName,
      locationUri: 'redis-db-flag', // https://docs.aws.amazon.com/athena/latest/ug/connectors-dynamodb.html
    });

    const athenaSpillBucket = new Bucket(this, 'bucket-ath-spill', {
      bucketName: 'redis-athena-federated-cdk-datalake-spill-bucket',
      autoDeleteObjects: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new AthenaRedisDDBConnector(this, 'AthenaRedisConnector', {
      glueDatabaseName: redisDatabaseName,
      redisEndpoint: {
        address: this.primaryEndpoint.address,
        port: this.primaryEndpoint.port,
      },
      redisKeysZset: 'companies',
      redisValueType: 'hash',
      columns: [
        {
            name: 'ticker',
            type: 'string'
        },
        {
            name: 'price',
            type: 'string'
        }
      ],
      securityGroup: this.securityGroup,
      spillBucketName: athenaSpillBucket.bucketName,
      subnets: vpc.privateSubnets.map((s) => s.subnetId)
    });
  }
}