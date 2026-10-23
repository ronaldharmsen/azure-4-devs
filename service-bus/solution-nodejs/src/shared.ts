import { ServiceBusClient, ServiceBusMessage } from "@azure/service-bus";

// The connection string comes from the .env file (loaded with node --env-file=.env).
const connectionString = process.env.SERVICEBUS_CONNECTION_STRING;
if (!connectionString) {
    throw new Error("SERVICEBUS_CONNECTION_STRING is not set: create a .env file and run with --env-file=.env");
}

export const client = new ServiceBusClient(connectionString);

export interface Order {
    id: number;
    customer: string;
    amount: number;
    region: string;
}

const customers = ["contoso", "fabrikam", "northwind"];
const regions = ["EU", "US", "APAC"];
const pick = (items: string[]) => items[Math.floor(Math.random() * items.length)];

export function createRandomOrder(): Order {
    return {
        id: 1000 + Math.floor(Math.random() * 9000),
        customer: pick(customers),
        amount: (1 + Math.floor(Math.random() * 39)) * 50,
        region: pick(regions),
    };
}

export function describe(order: Order): string {
    return `order ${order.id}: ${order.customer}, EUR ${order.amount}, ${order.region}`;
}

export function toMessage(order: Order): ServiceBusMessage {
    return {
        body: order, // objects are sent as JSON
        messageId: order.id.toString(),
        subject: "order-created",
        contentType: "application/json",
        // Application properties are visible to the broker, for example for filters on topic subscriptions.
        applicationProperties: { region: order.region, amount: order.amount },
    };
}
