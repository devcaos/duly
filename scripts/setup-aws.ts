// Creates the AWS resources Duly needs. Safe to run many times (idempotent).
//   - DynamoDB table (on-demand), keys pk + sk
//   - Private S3 bucket for the original uploaded files (all public access blocked)
// Usage: npm run setup:aws   (reads AWS_REGION and the AWS keys from .env.local)

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceNotFoundException,
  waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { BucketAlreadyOwnedByYou, CreateBucketCommand, PutPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import type { BucketLocationConstraint } from "@aws-sdk/client-s3";
import { awsRegion, bucketName, getS3, summarizeError, tableName } from "../lib/aws";
import { loadEnv } from "./env";

async function setupTable() {
  const client = new DynamoDBClient({ region: awsRegion() });
  const TableName = tableName();
  try {
    const { Table } = await client.send(new DescribeTableCommand({ TableName }));
    console.log(`DynamoDB table "${TableName}" already exists (${Table?.TableStatus}).`);
    return;
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  console.log(`Creating DynamoDB table "${TableName}" (on-demand)...`);
  await client.send(
    new CreateTableCommand({
      TableName,
      BillingMode: "PAY_PER_REQUEST",
      AttributeDefinitions: [
        { AttributeName: "pk", AttributeType: "S" },
        { AttributeName: "sk", AttributeType: "S" },
      ],
      KeySchema: [
        { AttributeName: "pk", KeyType: "HASH" },
        { AttributeName: "sk", KeyType: "RANGE" },
      ],
    }),
  );
  await waitUntilTableExists({ client, maxWaitTime: 120 }, { TableName });
  console.log(`DynamoDB table "${TableName}" is ready.`);
}

async function setupBucket() {
  const Bucket = bucketName();
  try {
    await getS3().send(
      new CreateBucketCommand({
        Bucket,
        CreateBucketConfiguration: { LocationConstraint: awsRegion() as BucketLocationConstraint },
      }),
    );
    console.log(`Created S3 bucket "${Bucket}".`);
  } catch (error) {
    if (!(error instanceof BucketAlreadyOwnedByYou)) throw error;
    console.log(`S3 bucket "${Bucket}" already exists.`);
  }

  // Applied on every run, so the bucket is always private.
  await getS3().send(
    new PutPublicAccessBlockCommand({
      Bucket,
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      },
    }),
  );
  console.log(`S3 bucket "${Bucket}": all public access blocked.`);
}

async function main() {
  loadEnv();
  console.log(`AWS region: ${awsRegion()}`);
  await setupTable();
  await setupBucket();
  console.log("Done.");
}

main().catch((error) => {
  console.error(`\nSetup failed (${summarizeError(error)})`);
  process.exit(1);
});
