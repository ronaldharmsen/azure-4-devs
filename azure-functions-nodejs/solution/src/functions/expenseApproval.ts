import { app, HttpRequest, HttpResponse, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as df from "durable-functions";
import { OrchestrationContext } from "durable-functions";

interface Expense {
    employee: string;
    amount: number;
    description: string;
}

export async function startExpenseApproval(request: HttpRequest, context: InvocationContext): Promise<HttpResponse> {
    const client = df.getClient(context);
    const expense = (await request.json()) as Expense;
    const instanceId = await client.startNew('expenseApproval', { input: expense });
    return client.createCheckStatusResponse(request, instanceId);
}

export async function decideExpense(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const client = df.getClient(context);
    const instanceId = request.params.instanceId;
    const approved = request.params.decision === 'approve';
    await client.raiseEvent(instanceId, 'ApprovalResult', approved);
    return { status: 202, body: `Sent ${request.params.decision} to ${instanceId}` };
}

app.http('startExpenseApproval', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'workflow/expenses',
    extraInputs: [df.input.durableClient()],
    handler: startExpenseApproval,
});

app.http('decideExpense', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'workflow/expenses/{instanceId}/{decision}',
    extraInputs: [df.input.durableClient()],
    handler: decideExpense,
});

df.app.orchestration('expenseApproval', function* (context: OrchestrationContext) {
    const expense = context.df.getInput<Expense>();
    if (expense.amount < 100) {
        return `Auto-approved: ${expense.description}`;
    }

    // Deterministic "now": never use new Date() in an orchestrator
    const deadline = new Date(context.df.currentUtcDateTime.getTime() + 2 * 60 * 1000);
    context.df.setCustomStatus(`Waiting for approval until ${deadline.toISOString()}`);

    const approval = context.df.waitForExternalEvent('ApprovalResult');
    const timeout = context.df.createTimer(deadline);
    const winner = yield context.df.Task.any([approval, timeout]);

    if (winner === approval) {
        timeout.cancel();
        const verdict = approval.result ? 'Approved' : 'Rejected';
        context.df.setCustomStatus(verdict);
        return `${verdict}: ${expense.description} (EUR ${expense.amount})`;
    }

    context.df.setCustomStatus('Timed out');
    return `No decision within 2 minutes: ${expense.description} is escalated`;
});
