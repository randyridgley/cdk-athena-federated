import { CfnProactiveEngagement } from "aws-cdk-lib/aws-shield";
import { Construct } from "constructs";

export interface SheildProactiveEngagementProps {
  readonly contacts?: CfnProactiveEngagement.EmergencyContactProperty[];
}

export class SheildProactiveEngagement extends Construct {
  constructor(scope: Construct, id: string, props: SheildProactiveEngagementProps) {
    super(scope, id);

    new CfnProactiveEngagement(this, 'ProactiveEngagement', {
      proactiveEngagementStatus: 'ENABLED',
      emergencyContactList: props.contacts ? props.contacts : []
    })
  }
}