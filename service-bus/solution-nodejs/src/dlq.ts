import { client, describe, Order } from "./shared.ts";

// The dead-letter queue is a sub-queue of 'orders'.
const receiver = client.createReceiver("orders", { subQueueType: "deadLetter" });

// Peek: read without locking or removing the messages.
const messages = await receiver.peekMessages(20);
console.log(`${messages.length} messages in the dead-letter queue`);

for (const message of messages) {
    const order = message.body as Order;
    console.log(`${describe(order)}: ${message.deadLetterReason} (${message.deadLetterErrorDescription})`);
}

await client.close();
