import { app, InvocationContext, output } from "@azure/functions";
import { textStats } from "../lib/textStats";

const resultBlob = output.storageBlob({
    path: 'results/{name}.json',
    connection: 'AzureWebJobsStorage',
});

export async function analyzeTextFile(blob: Buffer, context: InvocationContext): Promise<string> {
    const name = context.triggerMetadata.name as string;
    const stats = textStats(blob.toString('utf8'));
    context.log(`${name}.txt: ${stats.lines} lines, ${stats.words} words`);

    return JSON.stringify({ file: `${name}.txt`, ...stats }, null, 2);
}

app.storageBlob('analyzeTextFile', {
    path: 'uploads/{name}.txt',
    connection: 'AzureWebJobsStorage',
    source: 'EventGrid',
    return: resultBlob,
    handler: analyzeTextFile,
});
