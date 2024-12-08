import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { aws_elasticache as ElastiCache } from "aws-cdk-lib";
import { SecurityGroup } from "aws-cdk-lib/aws-ec2";
import * as kms from 'aws-cdk-lib/aws-kms';
import { AwsElasticacheServerlessStackProps } from './AwsElasticacheServerlessStackProps';
import { parseVpcSubnetType } from '../utils/vpc-type-parser';
import { validatePassword, validateRedisEngine, validateValkeyEngineVersion } from '../utils/check-environment-variable';

export class AwsElasticacheServerlessStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AwsElasticacheServerlessStackProps) {
    super(scope, id, props);

    const vpc = ec2.Vpc.fromLookup(this, `${props.resourcePrefix}-VPC-Imported`, {
      vpcId: props.vpcId,
    });

    const vpcSubnetType = parseVpcSubnetType(props.vpcSubnetType);
    const elastiCacheSubnetIds = vpc.selectSubnets({
      subnetType: vpcSubnetType,
    }).subnetIds;

    const elastiCacheSecurityGroup = new SecurityGroup(this, `${props.resourcePrefix}-ElastiCache-Security-Group`, {
      vpc,
      description: `${props.resourcePrefix}-ElastiCache-Security-Group`,
      allowAllOutbound: true,
    });

    const kmsKey = new kms.Key(this, `${props.resourcePrefix}-KMS-Key`, {
      description: `${props.resourcePrefix}-KMS-Key`,
      enableKeyRotation: true,
    });

    // todo create user and group (CfnUser, CfnUserGroup)
    // https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-elasticache-user.html
    // https://stackoverflow.com/questions/46569432/does-redis-use-a-username-for-authentication
    // Replaced redis with Valkey https://github.com/infiniflow/ragflow/pull/3164/files

    if (!validatePassword(props.redisUserPassword)) {
      throw new Error('Password must be at least 16 characters long, maximum 128 characters, and contain a mix of uppercase, lowercase, numbers and special characters.');
    }

    if (!validateRedisEngine(props.redisEngine)) {
      throw new Error('Unsupported Redis engine. Supported engines are valkey, redis, memcached.');
    }

    const user = new ElastiCache.CfnUser(this, `${props.resourcePrefix}-ElastiCache-User`, {
      engine: props.redisEngine,
      noPasswordRequired: false,
      userId: `${props.appName}-user`,
      userName: props.redisUserName,
      passwords: [props.redisUserPassword],
    });

    const userGroup = new ElastiCache.CfnUserGroup(this, `${props.resourcePrefix}-ElastiCache-User-Group`, {
      engine: props.redisEngine,
      userGroupId: `${props.appName}-user-group`,
      userIds: [user.ref],
    });

    // check if the engine version is supported
    if (!validateValkeyEngineVersion(props.redisEngineVersion)) {
      throw new Error('Unsupported Valkey engine version. Supported versions are 7 and 8.');
    }

    const elastiCacheServerless = new ElastiCache.CfnServerlessCache(
      this,
      `${props.resourcePrefix}-ElastiCache-Serverless`,
      {
        engine: props.redisEngine,
        serverlessCacheName: `${props.appName}-${props.deployEnvironment}`,
        securityGroupIds: [elastiCacheSecurityGroup.securityGroupId],
        subnetIds: elastiCacheSubnetIds,
        kmsKeyId: kmsKey.keyId,
        description: `${props.resourcePrefix}-ElastiCache-Serverless`,
        majorEngineVersion: props.redisEngineVersion,
        dailySnapshotTime: "00:00",
        snapshotRetentionLimit: 2,
        tags: [
          { key: 'environment', value: props.deployEnvironment },
          { key: 'project', value: props.appName },
          { key: 'owner', value: props.owner }
        ],
        userGroupId: userGroup.ref,
      },
    );

    // export elastiCacheSecurityGroup Id
    new cdk.CfnOutput(this, `${props.resourcePrefix}-ElastiCache-Security-Group-Id`, {
      value: elastiCacheSecurityGroup.securityGroupId,
      exportName: `${props.resourcePrefix}-ElastiCache-Security-Group-Id`,
      description: `${props.resourcePrefix}-ElastiCache-Security-Group-Id`,
    });

    // export elastiCacheServerless Id
    new cdk.CfnOutput(this, `${props.resourcePrefix}-ElastiCache-Serverless-Id`, {
      value: elastiCacheServerless.ref,
      exportName: `${props.resourcePrefix}-ElastiCache-Serverless-Id`,
      description: `${props.resourcePrefix}-ElastiCache-Serverless-Id`,
    });
  }
}
