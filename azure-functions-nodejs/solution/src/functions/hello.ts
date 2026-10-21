import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { hostname } from "node:os";

export async function hello(request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
    const name = request.query.get('name') || 'world';
    context.log(`Saying hello to ${name}`);

    return {
        jsonBody: {
            message: `Hello, ${name}!`,
            functionApp: process.env.WEBSITE_SITE_NAME ?? '(running locally)',
            machine: hostname(),
            node: process.version,
        },
    };
};

app.http('hello', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: hello
});
