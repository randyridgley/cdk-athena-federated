import { Aws } from "aws-cdk-lib";
import { CfnDataCatalog } from "aws-cdk-lib/aws-athena";
import { Port } from "aws-cdk-lib/aws-ec2";
import { CfnTable } from "aws-cdk-lib/aws-glue";
import { CfnApplication } from "aws-cdk-lib/aws-sam";
import { Construct } from "constructs";

export interface AthenaRedisConnectorProps {
  readonly subnets: string[];
  readonly securityGroup: any;
  readonly spillBucketName: string;
  readonly glueDatabaseName: string;
  readonly redisEndpoint: RedisEndpoint;
  readonly redisKeysZset: string;
  readonly redisValueType: string;
  readonly columns: CfnTable.ColumnProperty[];
}

export interface RedisEndpoint {
  readonly address: string;
  readonly port: Port;
}

// AWS Serverless Application Repository: AthenaRedisConnector
const AthenaRedisConnectorApplicationId =
'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaRedisConnector';
const AthenaRedisConnectorApplicationVersion = '2023.35.1';

export class AthenaRedisDDBConnector extends Construct {
  constructor(scope: Construct, id: string, props: AthenaRedisConnectorProps) {
    super(scope, id);

    new CfnTable(this, 'GlueRedisTable', {
      catalogId: Aws.ACCOUNT_ID,
      databaseName: props.glueDatabaseName,
      tableInput: {
        name: 'companies',
        parameters: {
          "redis-db-flag": "redis-db-flag", 
          "redis-endpoint": `${props.redisEndpoint.address}:${props.redisEndpoint.port}`, 
          "redis-keys-zset": props.redisKeysZset, 
          "redis-value-type": props.redisValueType,
        },
        storageDescriptor: {
          location: 's3://fake-bucket/',
          columns: props.columns
        },
      },
    });

    const athenaRedisDataSource = new CfnDataCatalog(this, 'athena-redis-source', {
      name: 'redis-catalog',
      description: 'catalog for redis Athena connectors',
      type: 'LAMBDA',
      parameters: {
        function: `arn:aws:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:redis-catalog`,
      },        
    });

    new CfnApplication(this, 'sam-redis-connector', {
      location: {
        applicationId: AthenaRedisConnectorApplicationId,
        semanticVersion: AthenaRedisConnectorApplicationVersion,
      },
      parameters: {
        AthenaCatalogName: athenaRedisDataSource.name,
        LambdaMemory: '3008',
        LambdaTimeout: '900',
        SpillBucket: props.spillBucketName,
        SpillPrefix: 'redis-connector',
        SecurityGroupIds: props.securityGroup.securityGroupId,
        SecretNameOrPrefix: 'redis-*',
        SubnetIds: props.subnets.join(","),
      },
    });
  }
}