// Resets the demo household in DynamoDB: deletes every document, then writes the
// sample documents (lib/storage/seed.ts) with dates relative to today. Run it again on demo day.
// Original files already in S3 are kept (they are only referenced by deleted documents).
// Usage: npm run seed:aws   (run npm run setup:aws once before)

import { DeleteCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamo, summarizeError, tableName } from "../lib/aws";
import { todayISO } from "../lib/dates";
import { HOUSEHOLD_ID } from "../lib/storage";
import { queryHouseholdItems, toItem } from "../lib/storage/aws";
import { buildSeedDocuments } from "../lib/storage/seed";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const TableName = tableName();
  const dynamo = getDynamo();

  const existing = await queryHouseholdItems(HOUSEHOLD_ID);
  // One by one: the IAM user has DeleteItem/PutItem but not BatchWriteItem.
  for (const item of existing) {
    await dynamo.send(new DeleteCommand({ TableName, Key: { pk: item.pk, sk: item.sk } }));
  }
  console.log(`Deleted ${existing.length} existing document(s) from household "${HOUSEHOLD_ID}".`);

  const today = todayISO();
  const docs = buildSeedDocuments(today);
  for (const doc of docs) {
    await dynamo.send(new PutCommand({ TableName, Item: toItem(doc) }));
    console.log(`  + ${doc.id}`);
  }
  console.log(`Wrote ${docs.length} sample documents to "${TableName}" (dates relative to ${today}).`);
}

main().catch((error) => {
  console.error(`\nSeeding failed (${summarizeError(error)})`);
  console.error("Did you run npm run setup:aws first?");
  process.exit(1);
});
