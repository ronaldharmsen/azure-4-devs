import { client, toMessage } from "./shared.ts";

const sender = client.createSender("orders");
await sender.sendMessages(toMessage({ id: 1, customer: "contoso", amount: -10, region: "EU" }));
await sender.sendMessages(toMessage({ id: 2, customer: "blocked", amount: 100, region: "US" }));
console.log("Sent an order with a negative amount and an order from a blocked customer");
await client.close();
