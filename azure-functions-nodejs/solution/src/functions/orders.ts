import { app, HttpRequest, HttpResponseInit, InvocationContext, output } from "@azure/functions";

interface Order {
    product: string;
    quantity: number;
}

const ordersQueue = output.storageQueue({
    queueName: 'orders',
    connection: 'AzureWebJobsStorage',
});

export async function submitOrder(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const order = (await request.json()) as Order;
    context.log(`Queueing order: ${order.quantity} x ${order.product}`);
    context.extraOutputs.set(ordersQueue, order);
    return { status: 202, jsonBody: { queued: order } };
}

export async function processOrder(message: unknown, context: InvocationContext): Promise<void> {
    const order = message as Order;
    const dequeueCount = context.triggerMetadata.dequeueCount;
    context.log(`Processing order (attempt ${dequeueCount}): ${order.quantity} x ${order.product}`);

    if (order.quantity <= 0) {
        throw new Error(`Invalid quantity ${order.quantity} for ${order.product}`);
    }
    context.log('Order processed');
}

app.http('submitOrder', {
    methods: ['POST'],
    authLevel: 'function',
    route: 'orders',
    extraOutputs: [ordersQueue],
    handler: submitOrder,
});

app.storageQueue('processOrder', {
    queueName: 'orders',
    connection: 'AzureWebJobsStorage',
    handler: processOrder,
});
