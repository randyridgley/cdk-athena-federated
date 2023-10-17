import { CfnOutput, Stack, StackProps } from "aws-cdk-lib";
import { ManagedRule } from "aws-cdk-lib/aws-config";
import { 
  FlowLog, 
  FlowLogDestination, 
  FlowLogResourceType, 
  FlowLogTrafficType, 
  GatewayVpcEndpoint, 
  GatewayVpcEndpointAwsService, 
  InterfaceVpcEndpoint, 
  InterfaceVpcEndpointAwsService, 
  SubnetType, 
  Vpc 
} from "aws-cdk-lib/aws-ec2";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

export class VpcFlowLogsStack extends Stack {
  readonly vpc: Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // The code that defines your stack goes here
    this.vpc = new Vpc(this, 'vpc', {
      cidr: '10.0.0.0/16',
      enableDnsHostnames: true,
      enableDnsSupport: true,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'Public Subnet 1',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'Public Subnet 2',
          subnetType: SubnetType.PUBLIC,
          cidrMask: 24
        },
        {
          name: 'Private Subnet 1',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        },
        {
          name: 'Private Subnet 2',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 24
        }
      ]
    })

    const logGroup = new LogGroup(this, 'athea-redis-vpc-logs');

    const role = new Role(this, 'VPCFlowLogsRole', {
      assumedBy: new ServicePrincipal('vpc-flow-logs.amazonaws.com')
    });

    new FlowLog(this, 'FlowLog', {
      resourceType: FlowLogResourceType.fromVpc(this.vpc),
      destination: FlowLogDestination.toCloudWatchLogs(logGroup, role),
      trafficType: FlowLogTrafficType.ALL,
    });

    new GatewayVpcEndpoint(this, 's3-vpce', {
      service: GatewayVpcEndpointAwsService.S3,
      vpc: this.vpc,
    });

    new InterfaceVpcEndpoint(this, 'cloudwatch', {
      service: InterfaceVpcEndpointAwsService.CLOUDWATCH,
      vpc: this.vpc,
    });

    new InterfaceVpcEndpoint(this, 'secretsManager', {
      service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
      vpc: this.vpc,
    });

    new InterfaceVpcEndpoint(this, 'athena', {
      service: InterfaceVpcEndpointAwsService.ATHENA,
      vpc: this.vpc,
    });

    new InterfaceVpcEndpoint(this, 'cloudwatchevents', {
      service: InterfaceVpcEndpointAwsService.CLOUDWATCH_EVENTS,
      vpc: this.vpc
    });

    new InterfaceVpcEndpoint(this, 'cloudwatchlogs', {
      service: InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
      vpc: this.vpc
    })

    new InterfaceVpcEndpoint(this, 'glue_interface_vpc_endpoint', {
      vpc: this.vpc,
      service: InterfaceVpcEndpointAwsService.GLUE
    });

    new ManagedRule(this, 'VpcFlowLogsEnabled', {
      identifier: 'VPC_FLOW_LOGS_ENABLED',
    });

    new CfnOutput(this, "VpcNetworkId", {
      exportName: "VpcNetworkId",
      value: this.vpc.vpcId
    });
  }
}