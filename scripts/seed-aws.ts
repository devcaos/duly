// Clears the demo household in DynamoDB: deletes every stored document (uploads and any
// sample documents written by older versions of this script). The sample documents themselves
// are never stored: the server rebuilds them from today's date on every request (lib/storage/merge.ts).
// Original files already in S3 are kept (they are only referenced by deleted documents).
// Deploy first, then run npm run seed:aws (it only clears stored uploads; the samples are built
// on every read). An older deployment reads only from DynamoDB, so running this before deploying
// leaves the demo household empty.
// Usage: npm run seed:aws   (run npm run setup:aws once before)

import { DeleteCommand } from "@aws-sdk/lib-dynamodb";
import { getDynamo, summarizeError, tableName } from "../lib/aws";
import { HOUSEHOLD_ID } from "../lib/storage";
import { queryHouseholdItems } from "../lib/storage/aws";
import { loadEnv } from "./env";

async function main() {
  loadEnv();
  const TableName = tableName();
  const dynamo = getDynamo();

  const existing = await queryHouseholdItems(HOUSEHOLD_ID);
  // One by one: the IAM user has DeleteItem but not BatchWriteItem.
  for (const item of existing) {
    await dynamo.send(new DeleteCommand({ TableName, Key: { pk: item.pk, sk: item.sk } }));
  }
  console.log(`Deleted ${existing.length} stored document(s) from household "${HOUSEHOLD_ID}" in "${TableName}".`);
  console.log("The sample documents are not stored: the server builds them from today's date on every request.");
}

main().catch((error) => {
  console.error(`\nClearing failed (${summarizeError(error)})`);
  console.error("Did you run npm run setup:aws first?");
  process.exit(1);
});
