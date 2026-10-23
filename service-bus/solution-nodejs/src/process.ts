import { createInterface } from "node:readline/promises";
import { client, describe, Order } from "./shared.ts";

const name = process.argv[2] ?? "worker";
const receiver = client.createReceiver("orders");

// subscribe keeps receiving messages in the background and calls processMessage for each one.
receiver.subscribe(
    {
        processMessage: async (message) => {
            const order = message.body as Order;
            console.log(`[${name}] ${describe(order)} (delivery count ${message.deliveryCount})`);
            await new Promise((resolve) => setTimeout(resolve, 1000)); // simulate work

            if (order.customer === "blocked") {
                // This can never succeed: move it to the dead-letter queue right away.
                await receiver.deadLetterMessage(message, {
                    deadLetterReason: "CustomerBlocked",
                    deadLetterErrorDescription: "This customer may not order",
                });
                console.log(`[${name}]   -> dead-lettered`);
                return;
            }
            if (order.amount < 0) {
                // Give the message back: it will be delivered again, until the max delivery count.
                await receiver.abandonMessage(message);
                console.log(`[${name}]   -> abandoned, will be retried`);
                return;
            }

            await receiver.completeMessage(message);
            console.log(`[${name}]   -> completed`);
        },
        processError: async (args) => {
            console.log(`[${name}] error: ${args.error.message}`);
        },
    },
    { autoCompleteMessages: false, maxConcurrentCalls: 1 },
);

const input = createInterface({ input: process.stdin, output: process.stdout });
await input.question(`[${name}] Processing messages from 'orders'. Press Enter to stop.\n`);
input.close();
await client.close();
