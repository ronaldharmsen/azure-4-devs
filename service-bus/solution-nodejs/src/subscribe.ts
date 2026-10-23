import { createInterface } from "node:readline/promises";
import { client, describe, Order } from "./shared.ts";

const subscription = process.argv[2];
if (!subscription) {
    throw new Error("Usage: subscribe.ts <subscription>");
}

// Each subscription gets its own copy of every message that matches its filter.
const receiver = client.createReceiver("order-events", subscription);

receiver.subscribe({
    processMessage: async (message) => {
        console.log(`[${subscription}] ${describe(message.body as Order)}`);
        // autoCompleteMessages is true by default
    },
    processError: async (args) => {
        console.log(`[${subscription}] error: ${args.error.message}`);
    },
});

const input = createInterface({ input: process.stdin, output: process.stdout });
await input.question(`Listening on subscription '${subscription}'. Press Enter to stop.\n`);
input.close();
await client.close();
