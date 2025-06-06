import * as path from 'path';
import { App, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from '../lib';
import * as integ from '@aws-cdk/integ-tests-alpha';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/*
 * Stack verification steps:
 * * aws lambda invoke --function-name <deployed fn name> --invocation-type Event --payload '"OK"' response.json
 */

class TestStack extends Stack {
  public readonly lambdaFunction: IFunction;
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.lambdaFunction = new lambda.GoFunction(this, 'go-handler-docker-root-user', {
      entry: path.join(__dirname, 'lambda-handler-vendor', 'cmd', 'api'),
      bundling: {
        forcedDockerBundling: true,
        goBuildFlags: ['-mod=readonly', '-ldflags "-s -w"'],
        commandHooks: {
          beforeBundling(_inputDir: string, _outputDir: string): string[] {
            return [
              'cat /etc/os-release',
            ];
          },
          afterBundling: function (_inputDir: string, _outputDir: string): string[] {
            return ['touch cdk_test.txt'];
          },
        },
      },
    });
  }
}

const app = new App({
  postCliContext: {
    '@aws-cdk/aws-lambda:useCdkManagedLogGroup': false,
  },
});
const stack = new TestStack(app, 'cdk-integ-lambda-golang');

const integTest = new integ.IntegTest(app, 'cdk-integ-lambda-golang-bundling-user-test', {
  testCases: [stack],
});

const response1 = integTest.assertions.invokeFunction({
  functionName: stack.lambdaFunction.functionName,
});

response1.expect(integ.ExpectedResult.objectLike({
  StatusCode: 200,
  ExecutedVersion: '$LATEST',
  Payload: '256',
}));
