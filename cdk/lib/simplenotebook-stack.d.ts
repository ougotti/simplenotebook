import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface SimplenotebookStackProps extends cdk.StackProps {
    environment: string;
}
export declare class SimplenotebookStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: SimplenotebookStackProps);
}
