"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SimplenotebookStack = void 0;
const cdk = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const s3 = require("aws-cdk-lib/aws-s3");
const iam = require("aws-cdk-lib/aws-iam");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
class SimplenotebookStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment } = props;
        // Secrets Manager for Google OAuth credentials
        const googleOAuthSecret = secretsmanager.Secret.fromSecretNameV2(this, 'GoogleOAuthSecret', 'google/oauth');
        // S3 Bucket for notes storage
        const notesBucket = new s3.Bucket(this, 'NotesBucket', {
            bucketName: `simplenotebook-notes-${environment}-${this.account}`,
            publicReadAccess: false,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
            encryption: s3.BucketEncryption.S3_MANAGED,
            enforceSSL: true,
            cors: [
                {
                    allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.DELETE],
                    allowedOrigins: ['https://ougotti.github.io'],
                    allowedHeaders: ['*'],
                    maxAge: 300,
                },
            ],
            removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        });
        // Cognito User Pool
        const userPool = new cognito.UserPool(this, 'UserPool', {
            userPoolName: `simplenotebook-users-${environment}`,
            selfSignUpEnabled: true,
            signInAliases: {
                email: true,
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
        });
        // Google Identity Provider
        const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
            userPool,
            clientId: googleOAuthSecret.secretValueFromJson('client_id').unsafeUnwrap(),
            clientSecretValue: googleOAuthSecret.secretValueFromJson('client_secret'),
            scopes: ['email', 'profile'],
            attributeMapping: {
                email: cognito.ProviderAttribute.GOOGLE_EMAIL,
                givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
                familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
            },
        });
        // User Pool Client
        const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
            userPool,
            userPoolClientName: `simplenotebook-client-${environment}`,
            generateSecret: false,
            authFlows: {
                userSrp: true,
                adminUserPassword: false,
                custom: false,
                userPassword: false,
            },
            oAuth: {
                flows: {
                    authorizationCodeGrant: true,
                },
                scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE, cognito.OAuthScope.OPENID],
                callbackUrls: ['https://ougotti.github.io/simplenotebook/'],
                logoutUrls: ['https://ougotti.github.io/simplenotebook/'],
            },
            supportedIdentityProviders: [
                cognito.UserPoolClientIdentityProvider.GOOGLE,
            ],
        });
        // Ensure Google provider is created before the client
        userPoolClient.node.addDependency(googleProvider);
        // Cognito User Pool Domain
        const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
            userPool,
            cognitoDomain: {
                domainPrefix: `simplenotebook-${environment}-${this.account}`,
            },
        });
        // Identity Pool
        const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
            identityPoolName: `simplenotebook_identity_${environment}`,
            allowUnauthenticatedIdentities: false,
            cognitoIdentityProviders: [
                {
                    clientId: userPoolClient.userPoolClientId,
                    providerName: userPool.userPoolProviderName,
                },
            ],
        });
        // IAM roles for authenticated users
        const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
            assumedBy: new iam.FederatedPrincipal('cognito-identity.amazonaws.com', {
                StringEquals: {
                    'cognito-identity.amazonaws.com:aud': identityPool.ref,
                },
                'ForAnyValue:StringLike': {
                    'cognito-identity.amazonaws.com:amr': 'authenticated',
                },
            }, 'sts:AssumeRoleWithWebIdentity'),
            inlinePolicies: {
                S3Access: new iam.PolicyDocument({
                    statements: [
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
                            resources: [`${notesBucket.bucketArn}/\${cognito-identity.amazonaws.com:sub}/*`],
                        }),
                    ],
                }),
            },
        });
        // Attach roles to identity pool
        new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
            identityPoolId: identityPool.ref,
            roles: {
                authenticated: authenticatedRole.roleArn,
            },
        });
        // Lambda function for notes API
        const notesFunction = new lambda.Function(this, 'NotesFunction', {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'index.handler',
            code: lambda.Code.fromAsset('lambda'),
            environment: {
                NOTES_BUCKET: notesBucket.bucketName,
                NOTES_PREFIX: `${environment}/`,
            },
        });
        // Grant Lambda permissions to access S3
        notesBucket.grantReadWrite(notesFunction);
        // API Gateway
        const api = new apigateway.RestApi(this, 'NotesApi', {
            restApiName: `simplenotebook-api-${environment}`,
            description: 'API for Simplenotebook app',
            defaultCorsPreflightOptions: {
                allowOrigins: ['https://ougotti.github.io'],
                allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
                allowHeaders: ['Content-Type', 'Authorization'],
            },
        });
        // Cognito Authorizer
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
            cognitoUserPools: [userPool],
        });
        // API Resources
        const notesResource = api.root.addResource('notes');
        const noteResource = notesResource.addResource('{noteId}');
        // Lambda integration
        const lambdaIntegration = new apigateway.LambdaIntegration(notesFunction);
        // API Methods
        notesResource.addMethod('GET', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        notesResource.addMethod('POST', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        noteResource.addMethod('GET', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        noteResource.addMethod('PUT', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        noteResource.addMethod('DELETE', lambdaIntegration, {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        // IAM Role for GitHub Actions OIDC
        const githubOidcRole = new iam.Role(this, 'GitHubActionsCdkDeployRole', {
            roleName: 'GitHubActionsCdkDeployRole',
            assumedBy: new iam.WebIdentityPrincipal('arn:aws:iam::' + this.account + ':oidc-provider/token.actions.githubusercontent.com', {
                StringEquals: {
                    'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                },
                StringLike: {
                    'token.actions.githubusercontent.com:sub': 'repo:ougotti/simplenotebook:*',
                },
            }),
            inlinePolicies: {
                CDKDeployPolicy: new iam.PolicyDocument({
                    statements: [
                        // CloudFormation permissions
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                'cloudformation:CreateStack',
                                'cloudformation:UpdateStack',
                                'cloudformation:DeleteStack',
                                'cloudformation:DescribeStacks',
                                'cloudformation:DescribeStackEvents',
                                'cloudformation:DescribeStackResources',
                                'cloudformation:GetTemplate',
                                'cloudformation:ValidateTemplate',
                                'cloudformation:CreateChangeSet',
                                'cloudformation:DescribeChangeSet',
                                'cloudformation:ExecuteChangeSet',
                                'cloudformation:DeleteChangeSet',
                                'cloudformation:ListStacks',
                                'cloudformation:ListStackResources',
                            ],
                            resources: ['*'],
                        }),
                        // AWS service permissions
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: [
                                's3:*',
                                'lambda:*',
                                'apigateway:*',
                                'cognito-idp:*',
                                'cognito-identity:*',
                                'iam:*',
                                'logs:*',
                            ],
                            resources: ['*'],
                        }),
                        // Secrets Manager permissions
                        new iam.PolicyStatement({
                            effect: iam.Effect.ALLOW,
                            actions: ['secretsmanager:GetSecretValue'],
                            resources: [googleOAuthSecret.secretArn],
                        }),
                    ],
                }),
            },
        });
        // Outputs
        new cdk.CfnOutput(this, 'ApiUrl', {
            value: api.url,
            description: 'API Gateway URL',
            exportName: `${id}-ApiUrl`,
        });
        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
            exportName: `${id}-UserPoolId`,
        });
        new cdk.CfnOutput(this, 'UserPoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
            exportName: `${id}-UserPoolClientId`,
        });
        new cdk.CfnOutput(this, 'IdentityPoolId', {
            value: identityPool.ref,
            description: 'Cognito Identity Pool ID',
            exportName: `${id}-IdentityPoolId`,
        });
        new cdk.CfnOutput(this, 'CognitoDomain', {
            value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
            description: 'Cognito Hosted UI Domain',
            exportName: `${id}-CognitoDomain`,
        });
        new cdk.CfnOutput(this, 'NotesBucketName', {
            value: notesBucket.bucketName,
            description: 'S3 Bucket for notes',
            exportName: `${id}-NotesBucket`,
        });
        new cdk.CfnOutput(this, 'GitHubOidcRoleArn', {
            value: githubOidcRole.roleArn,
            description: 'GitHub Actions OIDC Role ARN',
            exportName: `${id}-GitHubOidcRoleArn`,
        });
    }
}
exports.SimplenotebookStack = SimplenotebookStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoic2ltcGxlbm90ZWJvb2stc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJzaW1wbGVub3RlYm9vay1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7QUFBQSxtQ0FBbUM7QUFDbkMsbURBQW1EO0FBQ25ELHlEQUF5RDtBQUN6RCxpREFBaUQ7QUFDakQseUNBQXlDO0FBQ3pDLDJDQUEyQztBQUMzQyxpRUFBaUU7QUFPakUsTUFBYSxtQkFBb0IsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNoRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQStCO1FBQ3ZFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFOUIsK0NBQStDO1FBQy9DLE1BQU0saUJBQWlCLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDOUQsSUFBSSxFQUNKLG1CQUFtQixFQUNuQixjQUFjLENBQ2YsQ0FBQztRQUVGLDhCQUE4QjtRQUM5QixNQUFNLFdBQVcsR0FBRyxJQUFJLEVBQUUsQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLGFBQWEsRUFBRTtZQUNyRCxVQUFVLEVBQUUsd0JBQXdCLFdBQVcsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ2pFLGdCQUFnQixFQUFFLEtBQUs7WUFDdkIsaUJBQWlCLEVBQUUsRUFBRSxDQUFDLGlCQUFpQixDQUFDLFNBQVM7WUFDakQsVUFBVSxFQUFFLEVBQUUsQ0FBQyxnQkFBZ0IsQ0FBQyxVQUFVO1lBQzFDLFVBQVUsRUFBRSxJQUFJO1lBQ2hCLElBQUksRUFBRTtnQkFDSjtvQkFDRSxjQUFjLEVBQUUsQ0FBQyxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLEdBQUcsRUFBRSxFQUFFLENBQUMsV0FBVyxDQUFDLE1BQU0sQ0FBQztvQkFDL0UsY0FBYyxF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QUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxXQUFXLGNBQWMsQ0FBQyxVQUFVLFNBQVMsSUFBSSxDQUFDLE1BQU0sb0JBQW9CO1lBQ25GLFdBQVcsRUFBRSwwQkFBMEI7WUFDdkMsVUFBVSxFQUFFLEdBQUcsRUFBRSxnQkFBZ0I7U0FDbEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN6QyxLQUFLLEVBQUUsV0FBVyxDQUFDLFVBQVU7WUFDN0IsV0FBVyxFQUFFLHFCQUFxQjtZQUNsQyxVQUFVLEVBQUUsR0FBRyxFQUFFLGNBQWM7U0FDaEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxtQkFBbUIsRUFBRTtZQUMzQyxLQUFLLEVBQUUsY0FBYyxDQUFDLE9BQU87WUFDN0IsV0FBVyxFQUFFLDhCQUE4QjtZQUMzQyxVQUFVLEVBQUUsR0FBRyxFQUFFLG9CQUFvQjtTQUN0QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4VEQsa0RBd1RDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNvZ25pdG8gZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZ25pdG8nO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgKiBhcyBzMyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFNpbXBsZW5vdGVib29rU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIFNpbXBsZW5vdGVib29rU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogU2ltcGxlbm90ZWJvb2tTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50IH0gPSBwcm9wcztcblxuICAgIC8vIFNlY3JldHMgTWFuYWdlciBmb3IgR29vZ2xlIE9BdXRoIGNyZWRlbnRpYWxzXG4gICAgY29uc3QgZ29vZ2xlT0F1dGhTZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICAgIHRoaXMsXG4gICAgICAnR29vZ2xlT0F1dGhTZWNyZXQnLFxuICAgICAgJ2dvb2dsZS9vYXV0aCdcbiAgICApO1xuXG4gICAgLy8gUzMgQnVja2V0IGZvciBub3RlcyBzdG9yYWdlXG4gICAgY29uc3Qgbm90ZXNCdWNrZXQgPSBuZXcgczMuQnVja2V0KHRoaXMsICdOb3Rlc0J1Y2tldCcsIHtcbiAgICAgIGJ1Y2tldE5hbWU6IGBzaW1wbGVub3RlYm9vay1ub3Rlcy0ke2Vudmlyb25tZW50fS0ke3RoaXMuYWNjb3VudH1gLFxuICAgICAgcHVibGljUmVhZEFjY2VzczogZmFsc2UsXG4gICAgICBibG9ja1B1YmxpY0FjY2VzczogczMuQmxvY2tQdWJsaWNBY2Nlc3MuQkxPQ0tfQUxMLFxuICAgICAgZW5jcnlwdGlvbjogczMuQnVja2V0RW5jcnlwdGlvbi5TM19NQU5BR0VELFxuICAgICAgZW5mb3JjZVNTTDogdHJ1ZSxcbiAgICAgIGNvcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBbczMuSHR0cE1ldGhvZHMuR0VULCBzMy5IdHRwTWV0aG9kcy5QVVQsIHMzLkh0dHBNZXRob2RzLkRFTEVURV0sXG4gICAgICAgICAgYWxsb3dlZE9yaWdpbnM6IFsnaHR0cHM6Ly9vdWdvdHRpLmdpdGh1Yi5pbyddLFxuICAgICAgICAgIGFsbG93ZWRIZWFkZXJzOiBbJyonXSxcbiAgICAgICAgICBtYXhBZ2U6IDMwMCxcbiAgICAgICAgfSxcbiAgICAgIF0sXG4gICAgICByZW1vdmFsUG9saWN5OiBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnID8gY2RrLlJlbW92YWxQb2xpY3kuUkVUQUlOIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sXG4gICAgY29uc3QgdXNlclBvb2wgPSBuZXcgY29nbml0by5Vc2VyUG9vbCh0aGlzLCAnVXNlclBvb2wnLCB7XG4gICAgICB1c2VyUG9vbE5hbWU6IGBzaW1wbGVub3RlYm9vay11c2Vycy0ke2Vudmlyb25tZW50fWAsXG4gICAgICBzZWxmU2lnblVwRW5hYmxlZDogdHJ1ZSxcbiAgICAgIHNpZ25JbkFsaWFzZXM6IHtcbiAgICAgICAgZW1haWw6IHRydWUsXG4gICAgICB9LFxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcbiAgICAgICAgbWluTGVuZ3RoOiA4LFxuICAgICAgICByZXF1aXJlTG93ZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlVXBwZXJjYXNlOiB0cnVlLFxuICAgICAgICByZXF1aXJlRGlnaXRzOiB0cnVlLFxuICAgICAgfSxcbiAgICAgIGFjY291bnRSZWNvdmVyeTogY29nbml0by5BY2NvdW50UmVjb3ZlcnkuRU1BSUxfT05MWSxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGVudmlyb25tZW50ID09PSAncHJvZCcgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4gOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgLy8gR29vZ2xlIElkZW50aXR5IFByb3ZpZGVyXG4gICAgY29uc3QgZ29vZ2xlUHJvdmlkZXIgPSBuZXcgY29nbml0by5Vc2VyUG9vbElkZW50aXR5UHJvdmlkZXJHb29nbGUodGhpcywgJ0dvb2dsZVByb3ZpZGVyJywge1xuICAgICAgdXNlclBvb2wsXG4gICAgICBjbGllbnRJZDogZ29vZ2xlT0F1dGhTZWNyZXQuc2VjcmV0VmFsdWVGcm9tSnNvbignY2xpZW50X2lkJykudW5zYWZlVW53cmFwKCksXG4gICAgICBjbGllbnRTZWNyZXRWYWx1ZTogZ29vZ2xlT0F1dGhTZWNyZXQuc2VjcmV0VmFsdWVGcm9tSnNvbignY2xpZW50X3NlY3JldCcpLFxuICAgICAgc2NvcGVzOiBbJ2VtYWlsJywgJ3Byb2ZpbGUnXSxcbiAgICAgIGF0dHJpYnV0ZU1hcHBpbmc6IHtcbiAgICAgICAgZW1haWw6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0VNQUlMLFxuICAgICAgICBnaXZlbk5hbWU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0dJVkVOX05BTUUsXG4gICAgICAgIGZhbWlseU5hbWU6IGNvZ25pdG8uUHJvdmlkZXJBdHRyaWJ1dGUuR09PR0xFX0ZBTUlMWV9OQU1FLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIFVzZXIgUG9vbCBDbGllbnRcbiAgICBjb25zdCB1c2VyUG9vbENsaWVudCA9IG5ldyBjb2duaXRvLlVzZXJQb29sQ2xpZW50KHRoaXMsICdVc2VyUG9vbENsaWVudCcsIHtcbiAgICAgIHVzZXJQb29sLFxuICAgICAgdXNlclBvb2xDbGllbnROYW1lOiBgc2ltcGxlbm90ZWJvb2stY2xpZW50LSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGdlbmVyYXRlU2VjcmV0OiBmYWxzZSxcbiAgICAgIGF1dGhGbG93czoge1xuICAgICAgICB1c2VyU3JwOiB0cnVlLFxuICAgICAgICBhZG1pblVzZXJQYXNzd29yZDogZmFsc2UsXG4gICAgICAgIGN1c3RvbTogZmFsc2UsXG4gICAgICAgIHVzZXJQYXNzd29yZDogZmFsc2UsXG4gICAgICB9LFxuICAgICAgb0F1dGg6IHtcbiAgICAgICAgZmxvd3M6IHtcbiAgICAgICAgICBhdXRob3JpemF0aW9uQ29kZUdyYW50OiB0cnVlLFxuICAgICAgICB9LFxuICAgICAgICBzY29wZXM6IFtjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsIGNvZ25pdG8uT0F1dGhTY29wZS5QUk9GSUxFLCBjb2duaXRvLk9BdXRoU2NvcGUuT1BFTklEXSxcbiAgICAgICAgY2FsbGJhY2tVcmxzOiBbJ2h0dHBzOi8vb3Vnb3R0aS5naXRodWIuaW8vc2ltcGxlbm90ZWJvb2svJ10sXG4gICAgICAgIGxvZ291dFVybHM6IFsnaHR0cHM6Ly9vdWdvdHRpLmdpdGh1Yi5pby9zaW1wbGVub3RlYm9vay8nXSxcbiAgICAgIH0sXG4gICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyczogW1xuICAgICAgICBjb2duaXRvLlVzZXJQb29sQ2xpZW50SWRlbnRpdHlQcm92aWRlci5HT09HTEUsXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gRW5zdXJlIEdvb2dsZSBwcm92aWRlciBpcyBjcmVhdGVkIGJlZm9yZSB0aGUgY2xpZW50XG4gICAgdXNlclBvb2xDbGllbnQubm9kZS5hZGREZXBlbmRlbmN5KGdvb2dsZVByb3ZpZGVyKTtcblxuICAgIC8vIENvZ25pdG8gVXNlciBQb29sIERvbWFpblxuICAgIGNvbnN0IHVzZXJQb29sRG9tYWluID0gbmV3IGNvZ25pdG8uVXNlclBvb2xEb21haW4odGhpcywgJ1VzZXJQb29sRG9tYWluJywge1xuICAgICAgdXNlclBvb2wsXG4gICAgICBjb2duaXRvRG9tYWluOiB7XG4gICAgICAgIGRvbWFpblByZWZpeDogYHNpbXBsZW5vdGVib29rLSR7ZW52aXJvbm1lbnR9LSR7dGhpcy5hY2NvdW50fWAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgLy8gSWRlbnRpdHkgUG9vbFxuICAgIGNvbnN0IGlkZW50aXR5UG9vbCA9IG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbCh0aGlzLCAnSWRlbnRpdHlQb29sJywge1xuICAgICAgaWRlbnRpdHlQb29sTmFtZTogYHNpbXBsZW5vdGVib29rX2lkZW50aXR5XyR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGFsbG93VW5hdXRoZW50aWNhdGVkSWRlbnRpdGllczogZmFsc2UsXG4gICAgICBjb2duaXRvSWRlbnRpdHlQcm92aWRlcnM6IFtcbiAgICAgICAge1xuICAgICAgICAgIGNsaWVudElkOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgICAgIHByb3ZpZGVyTmFtZTogdXNlclBvb2wudXNlclBvb2xQcm92aWRlck5hbWUsXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gSUFNIHJvbGVzIGZvciBhdXRoZW50aWNhdGVkIHVzZXJzXG4gICAgY29uc3QgYXV0aGVudGljYXRlZFJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0F1dGhlbnRpY2F0ZWRSb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLkZlZGVyYXRlZFByaW5jaXBhbChcbiAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbScsXG4gICAgICAgIHtcbiAgICAgICAgICBTdHJpbmdFcXVhbHM6IHtcbiAgICAgICAgICAgICdjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206YXVkJzogaWRlbnRpdHlQb29sLnJlZixcbiAgICAgICAgICB9LFxuICAgICAgICAgICdGb3JBbnlWYWx1ZTpTdHJpbmdMaWtlJzoge1xuICAgICAgICAgICAgJ2NvZ25pdG8taWRlbnRpdHkuYW1hem9uYXdzLmNvbTphbXInOiAnYXV0aGVudGljYXRlZCcsXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgJ3N0czpBc3N1bWVSb2xlV2l0aFdlYklkZW50aXR5J1xuICAgICAgKSxcbiAgICAgIGlubGluZVBvbGljaWVzOiB7XG4gICAgICAgIFMzQWNjZXNzOiBuZXcgaWFtLlBvbGljeURvY3VtZW50KHtcbiAgICAgICAgICBzdGF0ZW1lbnRzOiBbXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgYWN0aW9uczogWydzMzpHZXRPYmplY3QnLCAnczM6UHV0T2JqZWN0JywgJ3MzOkRlbGV0ZU9iamVjdCddLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFtgJHtub3Rlc0J1Y2tldC5idWNrZXRBcm59L1xcJHtjb2duaXRvLWlkZW50aXR5LmFtYXpvbmF3cy5jb206c3VifS8qYF0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBBdHRhY2ggcm9sZXMgdG8gaWRlbnRpdHkgcG9vbFxuICAgIG5ldyBjb2duaXRvLkNmbklkZW50aXR5UG9vbFJvbGVBdHRhY2htZW50KHRoaXMsICdJZGVudGl0eVBvb2xSb2xlQXR0YWNobWVudCcsIHtcbiAgICAgIGlkZW50aXR5UG9vbElkOiBpZGVudGl0eVBvb2wucmVmLFxuICAgICAgcm9sZXM6IHtcbiAgICAgICAgYXV0aGVudGljYXRlZDogYXV0aGVudGljYXRlZFJvbGUucm9sZUFybixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIG5vdGVzIEFQSVxuICAgIGNvbnN0IG5vdGVzRnVuY3Rpb24gPSBuZXcgbGFtYmRhLkZ1bmN0aW9uKHRoaXMsICdOb3Rlc0Z1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2xhbWJkYScpLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgTk9URVNfQlVDS0VUOiBub3Rlc0J1Y2tldC5idWNrZXROYW1lLFxuICAgICAgICBOT1RFU19QUkVGSVg6IGAke2Vudmlyb25tZW50fS9gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IExhbWJkYSBwZXJtaXNzaW9ucyB0byBhY2Nlc3MgUzNcbiAgICBub3Rlc0J1Y2tldC5ncmFudFJlYWRXcml0ZShub3Rlc0Z1bmN0aW9uKTtcblxuICAgIC8vIEFQSSBHYXRld2F5XG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnTm90ZXNBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYHNpbXBsZW5vdGVib29rLWFwaS0ke2Vudmlyb25tZW50fWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBmb3IgU2ltcGxlbm90ZWJvb2sgYXBwJyxcbiAgICAgIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9uczoge1xuICAgICAgICBhbGxvd09yaWdpbnM6IFsnaHR0cHM6Ly9vdWdvdHRpLmdpdGh1Yi5pbyddLFxuICAgICAgICBhbGxvd01ldGhvZHM6IFsnR0VUJywgJ1BPU1QnLCAnUFVUJywgJ0RFTEVURScsICdPUFRJT05TJ10sXG4gICAgICAgIGFsbG93SGVhZGVyczogWydDb250ZW50LVR5cGUnLCAnQXV0aG9yaXphdGlvbiddLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIC8vIENvZ25pdG8gQXV0aG9yaXplclxuICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQXV0aG9yaXplcicsIHtcbiAgICAgIGNvZ25pdG9Vc2VyUG9vbHM6IFt1c2VyUG9vbF0sXG4gICAgfSk7XG5cbiAgICAvLyBBUEkgUmVzb3VyY2VzXG4gICAgY29uc3Qgbm90ZXNSZXNvdXJjZSA9IGFwaS5yb290LmFkZFJlc291cmNlKCdub3RlcycpO1xuICAgIGNvbnN0IG5vdGVSZXNvdXJjZSA9IG5vdGVzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tub3RlSWR9Jyk7XG5cbiAgICAvLyBMYW1iZGEgaW50ZWdyYXRpb25cbiAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKG5vdGVzRnVuY3Rpb24pO1xuXG4gICAgLy8gQVBJIE1ldGhvZHNcbiAgICBub3Rlc1Jlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6ZXIsXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxuICAgIH0pO1xuXG4gICAgbm90ZXNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICBub3RlUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICBub3RlUmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICBub3RlUmVzb3VyY2UuYWRkTWV0aG9kKCdERUxFVEUnLCBsYW1iZGFJbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXplcixcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXG4gICAgfSk7XG5cbiAgICAvLyBJQU0gUm9sZSBmb3IgR2l0SHViIEFjdGlvbnMgT0lEQ1xuICAgIGNvbnN0IGdpdGh1Yk9pZGNSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdHaXRIdWJBY3Rpb25zQ2RrRGVwbG95Um9sZScsIHtcbiAgICAgIHJvbGVOYW1lOiAnR2l0SHViQWN0aW9uc0Nka0RlcGxveVJvbGUnLFxuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLldlYklkZW50aXR5UHJpbmNpcGFsKFxuICAgICAgICAnYXJuOmF3czppYW06OicgKyB0aGlzLmFjY291bnQgKyAnOm9pZGMtcHJvdmlkZXIvdG9rZW4uYWN0aW9ucy5naXRodWJ1c2VyY29udGVudC5jb20nLFxuICAgICAgICB7XG4gICAgICAgICAgU3RyaW5nRXF1YWxzOiB7XG4gICAgICAgICAgICAndG9rZW4uYWN0aW9ucy5naXRodWJ1c2VyY29udGVudC5jb206YXVkJzogJ3N0cy5hbWF6b25hd3MuY29tJyxcbiAgICAgICAgICB9LFxuICAgICAgICAgIFN0cmluZ0xpa2U6IHtcbiAgICAgICAgICAgICd0b2tlbi5hY3Rpb25zLmdpdGh1YnVzZXJjb250ZW50LmNvbTpzdWInOiAncmVwbzpvdWdvdHRpL3NpbXBsZW5vdGVib29rOionLFxuICAgICAgICAgIH0sXG4gICAgICAgIH1cbiAgICAgICksXG4gICAgICBpbmxpbmVQb2xpY2llczoge1xuICAgICAgICBDREtEZXBsb3lQb2xpY3k6IG5ldyBpYW0uUG9saWN5RG9jdW1lbnQoe1xuICAgICAgICAgIHN0YXRlbWVudHM6IFtcbiAgICAgICAgICAgIC8vIENsb3VkRm9ybWF0aW9uIHBlcm1pc3Npb25zXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpDcmVhdGVTdGFjaycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOlVwZGF0ZVN0YWNrJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVsZXRlU3RhY2snLFxuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrcycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkRlc2NyaWJlU3RhY2tFdmVudHMnLFxuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpEZXNjcmliZVN0YWNrUmVzb3VyY2VzJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246R2V0VGVtcGxhdGUnLFxuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpWYWxpZGF0ZVRlbXBsYXRlJyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246Q3JlYXRlQ2hhbmdlU2V0JyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVzY3JpYmVDaGFuZ2VTZXQnLFxuICAgICAgICAgICAgICAgICdjbG91ZGZvcm1hdGlvbjpFeGVjdXRlQ2hhbmdlU2V0JyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246RGVsZXRlQ2hhbmdlU2V0JyxcbiAgICAgICAgICAgICAgICAnY2xvdWRmb3JtYXRpb246TGlzdFN0YWNrcycsXG4gICAgICAgICAgICAgICAgJ2Nsb3VkZm9ybWF0aW9uOkxpc3RTdGFja1Jlc291cmNlcycsXG4gICAgICAgICAgICAgIF0sXG4gICAgICAgICAgICAgIHJlc291cmNlczogWycqJ10sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICAgIC8vIEFXUyBzZXJ2aWNlIHBlcm1pc3Npb25zXG4gICAgICAgICAgICBuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICAgICAgICdzMzoqJyxcbiAgICAgICAgICAgICAgICAnbGFtYmRhOionLFxuICAgICAgICAgICAgICAgICdhcGlnYXRld2F5OionLFxuICAgICAgICAgICAgICAgICdjb2duaXRvLWlkcDoqJyxcbiAgICAgICAgICAgICAgICAnY29nbml0by1pZGVudGl0eToqJyxcbiAgICAgICAgICAgICAgICAnaWFtOionLFxuICAgICAgICAgICAgICAgICdsb2dzOionLFxuICAgICAgICAgICAgICBdLFxuICAgICAgICAgICAgICByZXNvdXJjZXM6IFsnKiddLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAvLyBTZWNyZXRzIE1hbmFnZXIgcGVybWlzc2lvbnNcbiAgICAgICAgICAgIG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgICAgICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgICAgICAgICBhY3Rpb25zOiBbJ3NlY3JldHNtYW5hZ2VyOkdldFNlY3JldFZhbHVlJ10sXG4gICAgICAgICAgICAgIHJlc291cmNlczogW2dvb2dsZU9BdXRoU2VjcmV0LnNlY3JldEFybl0sXG4gICAgICAgICAgICB9KSxcbiAgICAgICAgICBdLFxuICAgICAgICB9KSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaVVybCcsIHtcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7aWR9LUFwaVVybGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xJZCcsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbC51c2VyUG9vbElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tVXNlclBvb2xJZGAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcbiAgICAgIHZhbHVlOiB1c2VyUG9vbENsaWVudC51c2VyUG9vbENsaWVudElkLFxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBDbGllbnQgSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7aWR9LVVzZXJQb29sQ2xpZW50SWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0lkZW50aXR5UG9vbElkJywge1xuICAgICAgdmFsdWU6IGlkZW50aXR5UG9vbC5yZWYsXG4gICAgICBkZXNjcmlwdGlvbjogJ0NvZ25pdG8gSWRlbnRpdHkgUG9vbCBJRCcsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tSWRlbnRpdHlQb29sSWRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0NvZ25pdG9Eb21haW4nLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt1c2VyUG9vbERvbWFpbi5kb21haW5OYW1lfS5hdXRoLiR7dGhpcy5yZWdpb259LmFtYXpvbmNvZ25pdG8uY29tYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBIb3N0ZWQgVUkgRG9tYWluJyxcbiAgICAgIGV4cG9ydE5hbWU6IGAke2lkfS1Db2duaXRvRG9tYWluYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdOb3Rlc0J1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogbm90ZXNCdWNrZXQuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgQnVja2V0IGZvciBub3RlcycsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tTm90ZXNCdWNrZXRgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0dpdEh1Yk9pZGNSb2xlQXJuJywge1xuICAgICAgdmFsdWU6IGdpdGh1Yk9pZGNSb2xlLnJvbGVBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ0dpdEh1YiBBY3Rpb25zIE9JREMgUm9sZSBBUk4nLFxuICAgICAgZXhwb3J0TmFtZTogYCR7aWR9LUdpdEh1Yk9pZGNSb2xlQXJuYCxcbiAgICB9KTtcbiAgfVxufSJdfQ==