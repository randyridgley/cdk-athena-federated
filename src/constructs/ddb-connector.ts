import { Aws } from "aws-cdk-lib";
import { CfnDataCatalog } from "aws-cdk-lib/aws-athena";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { CfnTable } from "aws-cdk-lib/aws-glue";
import { Function } from "aws-cdk-lib/aws-lambda";
import { CfnApplication } from "aws-cdk-lib/aws-sam";
import { Construct } from "constructs";

export interface AthenaDDBConnectorProps {
  readonly glueDatabaseName: string;
  readonly dynamodbTable: Table;
  readonly columns: CfnTable.ColumnProperty[];
  readonly spillBucketName: string;
}

// AWS Serverless Application Repository: AthenaDynamoDBConnector
const AthenaDynamoDBConnectorApplicationId =
  'arn:aws:serverlessrepo:us-east-1:292517598671:applications/AthenaDynamoDBConnector';
const AthenaDynamoDBConnectorApplicationVersion = '2023.35.1';

export class AthenaDDBConnector extends Construct {
  constructor(scope: Construct, id: string, props: AthenaDDBConnectorProps) {
    super(scope, id);

    new CfnTable(this, 'GlueTable', {
      catalogId: Aws.ACCOUNT_ID,
      databaseName: props.glueDatabaseName,
      tableInput: {
        name: 'stocks',
        parameters: {
          sourceTable: props.dynamodbTable.tableName,
          classification: 'dynamodb', // https://docs.aws.amazon.com/athena/latest/ug/connectors-dynamodb.html
        },
        storageDescriptor: {
          location: props.dynamodbTable.tableArn,
          columns: props.columns,
          inputFormat: 'org.apache.hadoop.dynamodb.read.DynamoDBInputFormat',
          outputFormat: 'org.apache.hadoop.dynamodb.write.DynamoDBOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.dynamodb.DynamoDBSerDe',
          },
        },
      },
    });

    const samCfn = new CfnApplication(this, 'AthenaDynamodbConnector', {
      location: {
        applicationId: AthenaDynamoDBConnectorApplicationId,
        semanticVersion: AthenaDynamoDBConnectorApplicationVersion,
      },
      parameters: {
        AthenaCatalogName: 'dynamodb-catalog',
        SpillBucket: props.spillBucketName,
      },
    });

    const lambdaConnector = Function.fromFunctionArn(
      this,
      'LambdaConnector',
      `arn:aws:lambda:${Aws.REGION}:${Aws.ACCOUNT_ID}:function:dynamodb`,
    );
    lambdaConnector.node.addDependency(samCfn);

    new CfnDataCatalog(this, 'AthenaDataCatalog', {
      name: 'dynamodb-catalog',
      type: 'LAMBDA',
      parameters: {
        function: lambdaConnector.functionArn,
      },
    });
  }
}