import { awscdk } from 'projen';
const project = new awscdk.AwsCdkTypeScriptApp({
  cdkVersion: '2.1.0',
  defaultReleaseBranch: 'main',
  name: 'cdk-athena-federated',
  projenrcTs: true,
  deps: [
    '@aws-cdk/aws-glue-alpha',
    '@thundra/cdk-rds-initializer',
  ],
  devDeps: [    
    '@aws-sdk/client-dynamodb',
    '@aws-sdk/util-dynamodb',
    '@faker-js/faker',
    'ioredis',    
  ],
  // deps: [],                /* Runtime dependencies of this module. */
  // description: undefined,  /* The description is just a string that helps people understand the purpose of the package. */
  // devDeps: [],             /* Build dependencies for this module. */
  // packageName: undefined,  /* The "name" in package.json. */
});
project.synth();