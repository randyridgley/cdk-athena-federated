import { App } from 'aws-cdk-lib';
import { DataStack } from './stacks/data-stack';
import { VpcFlowLogsStack } from './stacks/vpc-stack';
import { LoaderStack } from './stacks/loader-stack';
import { RdsGenericStack } from './stacks/rds-stack';


// for development, use account/region from cdk cli
const devEnv = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

const vpcStack = new VpcFlowLogsStack(app, 'cdk-vpc-stack', {
  env: devEnv,
});

const dataStack = new DataStack(app, 'cdk-redis-stack', {
  env: devEnv,
  vpc: vpcStack.vpc,
});

new RdsGenericStack(app, 'cdk-rds-stack', {
  env: devEnv,
  vpc: vpcStack.vpc,
  table: 'customer',
});

new LoaderStack(app, 'cdk-loader', {
  env: devEnv,
  dynamoDbTable: dataStack.table,
  redisHost: dataStack.primaryEndpoint.address,
  vpc: vpcStack.vpc,
  securityGroup: dataStack.securityGroup,
})
app.synth();