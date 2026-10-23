import { client, createRandomOrder, describe, toMessage } from "./shared.ts";

const count = Number(process.argv[2] ?? 5);
const sender = client.createSender("orders");

// A batch is sent in one network call. tryAddMessage returns false when the batch is full.
const batch = await sender.createMessageBatch();
for (let i = 0; i < count; i++) {
    const order = createRandomOrder();
    if (!batch.tryAddMessage(toMessage(order))) {
        throw new Error("The batch is full");
    }
    console.log(`Added ${describe(order)}`);
}

await sender.sendMessages(batch);
console.log(`Sent ${count} messages to 'orders'`);
await client.close();
