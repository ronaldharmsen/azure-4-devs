import { client, createRandomOrder, describe, toMessage } from "./shared.ts";

const count = Number(process.argv[2] ?? 10);

// Sending to a topic looks exactly like sending to a queue.
const sender = client.createSender("order-events");

for (let i = 0; i < count; i++) {
    const order = createRandomOrder();
    await sender.sendMessages(toMessage(order));
    console.log(`Published ${describe(order)}`);
}

await client.close();
