import { PutObjectCommand } from "@aws-sdk/client-s3";
import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { NativeAttributeValue } from "@aws-sdk/lib-dynamodb";
import { bucketName, getDynamo, getS3, tableName } from "@/lib/aws";
import { todayISO } from "@/lib/dates";
import type { FileMimeType } from "@/lib/llm";
import type { Document } from "@/lib/types";
import { liveDocuments, mergeWithSeed, pickDocument } from "./merge";
import type { StoredDocument } from "./merge";
import { fileKeyFor } from "./types";
import type { SaveOptions, StorageAdapter } from "./types";

type Item = Record<string, NativeAttributeValue>;

// DynamoDB single-table keys (SPEC.md section 5): pk = HOUSEHOLD#<id>, sk = DOC#<id>.
export const householdPk = (householdId: string) => `HOUSEHOLD#${householdId}`;
export const docSk = (docId: string) => `DOC#${docId}`;

// expiresAt (epoch seconds) is the attribute DynamoDB TTL reads; documents without it never expire.
export function toItem(doc: Document, expiresAt?: number): Item {
  const item: Item = { pk: householdPk(doc.householdId), sk: docSk(doc.id), ...doc };
  if (expiresAt !== undefined) item.expiresAt = expiresAt;
  return item;
}

export function fromItem(item: Item): Document {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { pk, sk, expiresAt, ...doc } = item;
  return doc as Document;
}

export function fromStoredItem(item: Item): StoredDocument {
  return { doc: fromItem(item), expiresAt: typeof item.expiresAt === "number" ? item.expiresAt : undefined };
}

// All document items of a household, following DynamoDB pagination.
export async function queryHouseholdItems(householdId: string): Promise<Item[]> {
  const items: Item[] = [];
  let startKey: Item | undefined;
  do {
    const page = await getDynamo().send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :doc)",
        ExpressionAttributeValues: { ":pk": householdPk(householdId), ":doc": "DOC#" },
        ExclusiveStartKey: startKey,
      }),
    );
    items.push(...(page.Items ?? []));
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return items;
}

// Uploaded documents in DynamoDB, original files in a private S3 bucket.
// The sample documents are not stored: every read rebuilds them (see ./merge.ts).
export class AwsStorage implements StorageAdapter {
  async listDocuments(householdId: string): Promise<Document[]> {
    const stored = (await queryHouseholdItems(householdId)).map(fromStoredItem);
    return mergeWithSeed(householdId, liveDocuments(stored, Date.now()), todayISO());
  }

  async getDocument(householdId: string, id: string): Promise<Document | undefined> {
    return pickDocument(householdId, id, todayISO(), async () => {
      const { Item } = await getDynamo().send(
        new GetCommand({ TableName: tableName(), Key: { pk: householdPk(householdId), sk: docSk(id) } }),
      );
      return Item ? liveDocuments([fromStoredItem(Item)], Date.now())[0] : undefined;
    });
  }

  async saveDocument(doc: Document, options?: SaveOptions): Promise<void> {
    await getDynamo().send(new PutCommand({ TableName: tableName(), Item: toItem(doc, options?.expiresAt) }));
  }

  async saveFile(householdId: string, docId: string, bytes: Buffer, mimeType: FileMimeType): Promise<string> {
    const fileKey = fileKeyFor(householdId, docId, mimeType);
    await getS3().send(
      new PutObjectCommand({ Bucket: bucketName(), Key: fileKey, Body: bytes, ContentType: mimeType }),
    );
    return fileKey;
  }
}
