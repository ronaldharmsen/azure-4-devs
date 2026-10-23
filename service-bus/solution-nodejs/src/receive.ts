import { client, describe, Order } from "./shared.ts";

// peekLock (the default): a received message is locked, not removed.
const receiver = client.createReceiver("orders");

const messages = await receiver.receiveMessages(10, { maxWaitTimeInMs: 5000 });
console.log(`Received ${messages.length} messages`);

for (const message of messages) {
    const order = message.body as Order;
    console.log(`${describe(order)} (delivery count ${message.deliveryCount})`);

    // Completing removes the message from the queue. Without it, the lock expires
    // and the message becomes available again.
    await receiver.completeMessage(message);
}

await client.close();
