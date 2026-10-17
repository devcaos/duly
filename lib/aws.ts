import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";

// Shared AWS settings. Credentials come from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// through the SDK's default credential chain, so they never appear in the code.

export function awsRegion(): string {
  return process.env.AWS_REGION || "eu-west-1";
}

export function tableName(): string {
  return process.env.DYNAMODB_TABLE || "duly";
}

export function bucketName(): string {
  return process.env.S3_BUCKET || "duly-devcaos-files";
}

const MAX_LOG_MESSAGE_CHARS = 200;

// One safe line to log for any error: name, HTTP status and a short message.
// AWS messages can contain ARNs, account IDs and request IDs, so those are masked.
export function summarizeError(error: unknown): string {
  if (!(error instanceof Error)) return "UnknownError";
  const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  const message = error.message
    .replace(/arn:[\w-]+:[^\s"',;)]*/g, "[arn]")
    .replace(/\b\d{12}\b/g, "[account]")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "[id]")
    .replace(/request ?id:? ?\S+/gi, "[request-id]")
    .slice(0, MAX_LOG_MESSAGE_CHARS);
  return `${error.name}${status ? `, HTTP ${status}` : ""}: ${message}`;
}

let dynamo: DynamoDBDocumentClient | undefined;
let s3: S3Client | undefined;

// DynamoDB client that converts plain JS objects to DynamoDB items and back.
export function getDynamo(): DynamoDBDocumentClient {
  dynamo ??= DynamoDBDocumentClient.from(new DynamoDBClient({ region: awsRegion() }), {
    // Optional Document fields (amount, product...) can be undefined.
    marshallOptions: { removeUndefinedValues: true },
  });
  return dynamo;
}

export function getS3(): S3Client {
  s3 ??= new S3Client({ region: awsRegion() });
  return s3;
}
