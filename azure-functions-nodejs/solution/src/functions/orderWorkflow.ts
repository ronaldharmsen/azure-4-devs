import { app, HttpRequest, HttpResponse, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { OrchestrationContext } from "durable-functions";

interface Order {
    product: string;
    quantity: number;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 1. Starter: an HTTP function that starts a new orchestration instance
export async function startOrderWorkflow(request: HttpRequest, context: InvocationContext): Promise<HttpResponse> {
    const client = df.getClient(context);
    const order = (await request.json()) as Order;
    const instanceId = await client.startNew('orderWorkflow', { input: order });
    context.log(`Started orchestration ${instanceId}`);
    return client.createCheckStatusResponse(request, instanceId);
}

app.http('startOrderWorkflow', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'workflow/orders',
    extraInputs: [df.input.durableClient()],
    handler: startOrderWorkflow,
});

// 2. Orchestrator: the workflow. Every `yield` is a checkpoint.
df.app.orchestration('orderWorkflow', function* (context: OrchestrationContext) {
    const order = context.df.getInput<Order>();

    const retry = new df.RetryOptions(2000, 4); // first retry after 2s, at most 4 attempts
    retry.backoffCoefficient = 2;               // 2s, 4s, 8s

    context.df.setCustomStatus('Reserving stock');
    const reservation: string = yield context.df.callActivity('reserveStock', order);

    let payment: string;
    try {
        context.df.setCustomStatus('Charging payment');
        payment = yield context.df.callActivityWithRetry('chargePayment', retry,
            { instanceId: context.df.instanceId, order });
    } catch (err) {
        context.df.setCustomStatus('Payment failed, releasing stock');
        yield context.df.callActivity('releaseStock', reservation);
        context.df.setCustomStatus('Cancelled');
        return `Order cancelled, ${reservation} released`;
    }

    context.df.setCustomStatus('Done');
    return `Order for ${order.quantity} x ${order.product} completed (${reservation}, ${payment})`;
});

// 3. Activities: the actual work
df.app.activity('reserveStock', {
    handler: async (order: Order, context: InvocationContext): Promise<string> => {
        await delay(3000); // pretend to call the warehouse
        const reservation = `reservation-${Math.floor(Math.random() * 10000)}`;
        context.log(`Reserved ${order.quantity} x ${order.product}: ${reservation}`);
        return reservation;
    },
});

// Simulated flaky payment provider: the first two attempts per order fail.
const attempts = new Map<string, number>();

df.app.activity('chargePayment', {
    handler: async (input: { instanceId: string; order: Order }, context: InvocationContext): Promise<string> => {
        const attempt = (attempts.get(input.instanceId) ?? 0) + 1;
        attempts.set(input.instanceId, attempt);
        await delay(2000);

        if (input.order.quantity > 10) {
            throw new Error('Card declined');
        }
        if (attempt <= 2) {
            context.warn(`Attempt ${attempt}: payment provider timed out`);
            throw new Error('Payment provider timed out');
        }
        context.log(`Attempt ${attempt}: payment succeeded`);
        return `payment-${attempt}`;
    },
});

df.app.activity('releaseStock', {
    handler: async (reservation: string, context: InvocationContext): Promise<void> => {
        context.log(`Released ${reservation}`);
    },
});
