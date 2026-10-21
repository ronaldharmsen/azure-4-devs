import { app, HttpRequest, HttpResponse, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import * as df from "durable-functions";
import { OrchestrationContext } from "durable-functions";
import { textStats } from "../lib/textStats";

const uploads = () =>
    BlobServiceClient.fromConnectionString(process.env.AzureWebJobsStorage).getContainerClient('uploads');

export async function startWordCount(request: HttpRequest, context: InvocationContext): Promise<HttpResponse> {
    const client = df.getClient(context);
    const instanceId = await client.startNew('wordCount');
    return client.createCheckStatusResponse(request, instanceId);
}

app.http('startWordCount', {
    methods: ['POST'],
    authLevel: 'anonymous',
    route: 'workflow/wordcount',
    extraInputs: [df.input.durableClient()],
    handler: startWordCount,
});

df.app.orchestration('wordCount', function* (context: OrchestrationContext) {
    const files: string[] = yield context.df.callActivity('listTextFiles');

    // Fan out: start one activity per file, without waiting for each one...
    const tasks = files.map((file) => context.df.callActivity('countWords', file));

    // ...fan in: wait until all of them are done.
    const counts: { file: string; words: number }[] = yield context.df.Task.all(tasks);

    return {
        files: counts.length,
        totalWords: counts.reduce((sum, c) => sum + c.words, 0),
        perFile: counts,
    };
});

df.app.activity('listTextFiles', {
    handler: async (): Promise<string[]> => {
        const names: string[] = [];
        for await (const blob of uploads().listBlobsFlat()) {
            if (blob.name.endsWith('.txt')) names.push(blob.name);
        }
        return names;
    },
});

df.app.activity('countWords', {
    handler: async (file: string, context: InvocationContext) => {
        const content = await uploads().getBlobClient(file).downloadToBuffer();
        await new Promise((resolve) => setTimeout(resolve, 3000)); // make each activity "slow"
        const words = textStats(content.toString('utf8')).words;
        context.log(`${file}: ${words} words`);
        return { file, words };
    },
});
