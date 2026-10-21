# Lab: Azure Functions and Durable Functions with Node.js

In this lab you build a complete Azure Functions app in **TypeScript** with the Node.js programming model v4.
You start with a simple HTTP function, add queue and blob triggers, then build three workflows with
**Durable Functions**, and finally deploy everything to Azure on the **Flex Consumption** plan.

What you will build:

| Part | Function(s) | What it shows |
| --- | --- | --- |
| 2 | `hello` | HTTP trigger |
| 3 | `submitOrder`, `processOrder` | HTTP → queue output binding → queue trigger, retries and poison messages |
| 4 | `analyzeTextFile` | Blob trigger (Event Grid) + blob output binding |
| 5 | `orderWorkflow` | Durable: function chaining, retries, compensation |
| 6 | `wordCount` | Durable: fan-out/fan-in |
| 7 | `expenseApproval` | Durable: human interaction (external event + timeout) |

Estimated time: 2 to 2.5 hours. A finished version is in the [solution](solution/) folder, in case you get stuck.
To run it: start Azurite (Part 1, step 1), then run `npm install` and `npm start` in the `solution` folder.

---

## Prerequisites
- Your development environment set up as described in [Setting up your development environment](../setup/dev-station-setup.md):
  - Node.js 22 or 24
  - Azure Functions Core Tools v4 (`func --version`)
  - Azurite
  - Azure CLI, logged in (`az login`)
  - Azure Storage Explorer (recommended)
- Visual Studio Code with the Azure Functions extension

### Conventions in this lab
- Pick a **suffix** of 4-6 lowercase letters/digits, for example your initials plus three digits (`rh123`).
  Wherever you see `<suffix>`, use your own suffix. Some Azure resource names must be globally unique.
- All commands are single-line and work in bash, zsh and PowerShell.
- **Windows (PowerShell):** type `curl.exe` instead of `curl`, because in Windows PowerShell `curl` is an alias for something else.
  Wherever the lab sends JSON, it sends it from a file (`--data @file.json`) to avoid quoting problems.

---

## Part 1: Create the project

1. Start Azurite in a separate terminal and leave it running:
   ```sh
   azurite --silent --skipApiVersionCheck --location ./azurite-data
   ```
   > `--skipApiVersionCheck` prevents errors when the Azure SDK is newer than your Azurite version.

2. In another terminal, create a new Functions project and open it in VS Code:
   ```sh
   func init FunctionsLab --worker-runtime node --language typescript
   cd FunctionsLab
   code .
   ```

3. Have a look at what `func init` created:
   - `package.json`: note `"main": "dist/src/functions/*.js"`. That tells the Functions host where to find your functions.
   - `host.json`: settings for the Functions host. Note the `extensionBundle`: Node.js apps get the bindings
     (storage, Durable Functions, ...) from this bundle instead of installing them via npm.
   - `local.settings.json`: app settings for local development only. `AzureWebJobsStorage` is
     `UseDevelopmentStorage=true`, which means Azurite. This file is not deployed.

4. Bring the template up to date: newer Node.js type definitions and a newer JavaScript target.
   ```sh
   npm install --save-dev @types/node@24
   ```
   In `tsconfig.json`, change `"target": "es6"` to `"target": "es2022"`.

---

## Part 2: An HTTP trigger

1. Create your first function from a template:
   ```sh
   func new --template "HTTP trigger" --name hello
   ```
   This creates `src/functions/hello.ts`.

2. Replace its contents with:
   ```typescript
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
   ```
   - In the v4 programming model, there are no `function.json` files: `app.http(...)` registers the function in code.
   - `authLevel: 'anonymous'` means no key is needed to call it.

3. Build and start the app:
   ```sh
   npm start
   ```
   `npm start` cleans, compiles the TypeScript to `dist/`, and runs `func start`. The output lists every function and its URL.

4. Open http://localhost:7071/api/hello?name=Azure in your browser. Then try it with curl in a second terminal:
   ```sh
   curl "http://localhost:7071/api/hello?name=Azure"
   ```

Stop the app with `Ctrl+C` before you continue. You restart it with `npm start` after every part.

---

## Part 3: Queue storage: output binding and queue trigger

You build an order API: an HTTP function puts orders on a queue, and a queue-triggered function processes them.

1. Create `src/functions/orders.ts`:
   ```typescript
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
   ```
   Things to notice:
   - `output.storageQueue(...)` defines an **output binding**. The function only calls `context.extraOutputs.set(...)`;
     the Functions host writes the message to the queue. No storage SDK code needed.
   - `submitOrder` has two outputs: the HTTP response (the return value) and the queue message.
   - `authLevel: 'function'` requires a key. Locally keys are not checked; in Azure they are.
   - `connection: 'AzureWebJobsStorage'` is the *name of an app setting*, not the connection string itself.

2. Make retries quicker for this lab. In `host.json`, add an `extensions` section after `extensionBundle`
   (mind the comma):
   ```json
   "extensions": {
     "queues": {
       "maxDequeueCount": 3,
       "visibilityTimeout": "00:00:05"
     }
   }
   ```

3. Create a folder `test` in the project with two files:

   `test/order.json`:
   ```json
   { "product": "coffee", "quantity": 2 }
   ```
   `test/bad-order.json`:
   ```json
   { "product": "tea", "quantity": 0 }
   ```

4. Start the app (`npm start`) and submit both orders from a second terminal:
   ```sh
   curl -X POST http://localhost:7071/api/orders -H "Content-Type: application/json" --data @test/order.json
   curl -X POST http://localhost:7071/api/orders -H "Content-Type: application/json" --data @test/bad-order.json
   ```

5. Watch the log of `func start`:
   - The coffee order is processed right away.
   - The tea order fails, is retried (attempt 2, 3), and then disappears.

6. Open **Azure Storage Explorer** → *Emulator & Attached* → *Storage Accounts* → *(Emulator - Default Ports)* → *Queues*.
   You will find the queue `orders` (empty) and **`orders-poison`** containing the tea order. After `maxDequeueCount`
   failed attempts, a message moves to the poison queue so it doesn't block the others.
   > Alternatively, from the command line:
   > `az storage message peek --queue-name orders-poison --connection-string "UseDevelopmentStorage=true"`.
   > The content is base64-encoded, because Functions encodes queue messages that way by default.

---

## Part 4: Blob trigger with Event Grid, and a blob output binding

When a `.txt` file is uploaded to the container `uploads`, a function counts its lines and words and writes
the result as JSON to the container `results`.

1. Create a helper `src/lib/textStats.ts` (a new folder `lib`, next to `functions`):
   ```typescript
   export interface TextStats {
       lines: number;
       words: number;
       characters: number;
       topWords: string[];
   }

   export function textStats(text: string): TextStats {
       const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
       const counts = new Map<string, number>();
       for (const word of words.filter((w) => w.length > 3)) {
           counts.set(word, (counts.get(word) ?? 0) + 1);
       }
       const topWords = [...counts.entries()]
           .sort((a, b) => b[1] - a[1])
           .slice(0, 5)
           .map(([word, count]) => `${word} (${count})`);
       const lines = text.trim() === '' ? 0 : text.trimEnd().split('\n').length;
       return { lines, words: words.length, characters: text.length, topWords };
   }
   ```

2. Create `src/functions/analyzeTextFile.ts`:
   ```typescript
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
   ```
   Things to notice:
   - `{name}` is a **binding expression**: the trigger fills it from the file name, and the output binding
     reuses it. `uploads/report.txt` produces `results/report.json`.
   - `return: resultBlob`: the return value of the function is written to the output binding.
   - `source: 'EventGrid'`: Azure Event Grid *pushes* a "blob created" event to the function, so it reacts within
     seconds. The classic blob trigger *polls* the container, which can take minutes, and it is not
     supported on the Flex Consumption plan we deploy to.

3. Start the app. Create the `uploads` container and upload a text file. In the commands below, use any small
   `.txt` file and upload it under the name `test.txt` (or use one from the [samples](samples/) folder):
   ```sh
   az storage container create --name uploads --connection-string "UseDevelopmentStorage=true"
   az storage blob upload --container-name uploads --name test.txt --file <path-to-a-txt-file> --connection-string "UseDevelopmentStorage=true"
   ```
   Nothing happens yet: locally there is no Event Grid to send the event.

4. Send the event yourself. Create `test/blob-created.json`. This is what Event Grid would send:
   ```json
   [
     {
       "id": "1",
       "eventType": "Microsoft.Storage.BlobCreated",
       "subject": "/blobServices/default/containers/uploads/blobs/test.txt",
       "eventTime": "2026-01-01T00:00:00Z",
       "dataVersion": "",
       "metadataVersion": "1",
       "topic": "/subscriptions/local/resourceGroups/local/providers/Microsoft.Storage/storageAccounts/devstoreaccount1",
       "data": {
         "api": "PutBlob",
         "blobType": "BlockBlob",
         "url": "http://127.0.0.1:10000/devstoreaccount1/uploads/test.txt"
       }
     }
   ]
   ```
   Post it to the webhook that the blob extension listens on:
   ```sh
   curl -X POST "http://localhost:7071/runtime/webhooks/blobs?functionName=Host.Functions.analyzeTextFile" -H "Content-Type: application/json" -H "aeg-event-type: Notification" --data @test/blob-created.json
   ```

5. The `func start` log shows `analyzeTextFile` running. In Storage Explorer, open the container **`results`**
   (created automatically by the output binding) and open `test.json`.

---

## Part 5: Durable Functions: function chaining

Durable Functions lets you write **stateful workflows** as ordinary code. A workflow consists of:
- a **starter** (client) function that starts a workflow, here via HTTP;
- an **orchestrator** function that describes the steps;
- **activity** functions that do the actual work.

The orchestrator's progress is stored in storage after every step. When a step completes, the orchestrator
is **replayed** from the start, and steps that already ran return their stored result. Because of this, an
orchestrator must be **deterministic**: no `new Date()`, `Math.random()`, or network/file I/O in an orchestrator.
Do those things in activities.

You build an order workflow: reserve stock → charge payment (with retries) → done. If the payment keeps
failing, the workflow releases the reserved stock again (a *compensating action*).

1. Install the Durable Functions library:
   ```sh
   npm install durable-functions
   ```

2. Add Durable Functions settings to the `extensions` section of `host.json`, so it looks like this:
   ```json
   "extensions": {
     "queues": {
       "maxDequeueCount": 3,
       "visibilityTimeout": "00:00:05"
     },
     "durableTask": {
       "storageProvider": {
         "maxQueuePollingInterval": "00:00:02"
       }
     }
   }
   ```
   > Durable Functions uses queues in the storage account internally. When idle, it slows down its polling to at
   > most once every 30 seconds, which makes waiting steps feel slow in a lab. Two seconds is snappier
   > but costs more storage transactions in production.

3. Create `src/functions/orderWorkflow.ts`:
   ```typescript
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
   ```
   Things to notice:
   - The orchestrator is a **generator function** (`function*`). `yield` hands control back to the Durable
     Functions framework, which schedules the activity and resumes the orchestrator once there's a result.
   - `extraInputs: [df.input.durableClient()]` + `df.getClient(context)` give the starter a client to start
     and manage orchestrations.
   - Retries are declarative (`callActivityWithRetry`), and a failure after the last retry is an ordinary
     exception you can `catch`.
   - `Math.random()` is fine in the `reserveStock` *activity*, but would break the *orchestrator*.

4. Start the app and start a workflow:
   ```sh
   curl -X POST http://localhost:7071/api/workflow/orders -H "Content-Type: application/json" --data @test/order.json
   ```
   The response is `202 Accepted` with a set of URLs: this is the **async HTTP API** pattern.
   Copy the **`statusQueryGetUri`** and open it in your browser. Refresh a few times and watch `runtimeStatus` and
   `customStatus` change, until the status is `Completed` with an `output`. In the `func start` log you can see
   the two failed payment attempts and the retry.

5. Now an order that fails. Create `test/big-order.json`:
   ```json
   { "product": "coffee", "quantity": 50 }
   ```
   ```sh
   curl -X POST http://localhost:7071/api/workflow/orders -H "Content-Type: application/json" --data @test/big-order.json
   ```
   Follow the `statusQueryGetUri` again. After four declined attempts (about 25 seconds), the stock is
   released and the output says the order was cancelled.

6. Explore the state: in Storage Explorer, look at the tables `TestHubNameInstances` and `TestHubNameHistory`
   (the default task hub name is `TestHubName` locally; in Azure it's the Function App name). The History table
   holds every event of every instance: that is what the replay uses.

---

## Part 6: Durable Functions: fan-out/fan-in

Count the words in **all** text files in `uploads`, processing the files **in parallel**.

1. Install the Blob Storage SDK (the activities read blobs directly):
   ```sh
   npm install @azure/storage-blob
   ```

2. Create `src/functions/wordCount.ts`:
   ```typescript
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
   ```

3. Upload some more text files, for example all files from the [samples](samples/) folder:
   ```sh
   az storage blob upload-batch --destination uploads --source <path-to-samples-folder> --connection-string "UseDevelopmentStorage=true"
   ```

4. Start the app and run the word count:
   ```sh
   curl -X POST http://localhost:7071/api/workflow/wordcount
   ```
   Open the `statusQueryGetUri`. Every `countWords` activity takes at least 3 seconds. Compare `createdTime`
   and `lastUpdatedTime` in the status: the whole orchestration takes about 3 seconds, not 3 seconds × the number of files.

---

## Part 7: Durable Functions: human interaction

An expense of EUR 100 or more needs a manager's approval. The workflow waits for an **external event**
(approve/reject), but not forever: after 2 minutes it times out.

1. Create `src/functions/expenseApproval.ts`:
   ```typescript
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
   ```
   Things to notice:
   - `Task.any` waits for whichever comes first: the event or the durable timer.
   - While the orchestration waits, **no code runs** and on a consumption plan **nothing is billed**. The state
     is in storage, so the wait survives restarts and redeployments (even if it waits for days).
   - `timeout.cancel()`: without it, the orchestration stays open until the timer fires.

2. Create `test/expense.json`:
   ```json
   { "employee": "Alex", "amount": 250, "description": "Conference ticket" }
   ```

3. Start the app and submit the expense:
   ```sh
   curl -X POST http://localhost:7071/api/workflow/expenses -H "Content-Type: application/json" --data @test/expense.json
   ```
   Note the **`id`** in the response and open the `statusQueryGetUri`: `Running`, waiting for approval.

4. Approve it (replace `<id>`):
   ```sh
   curl -X POST http://localhost:7071/api/workflow/expenses/<id>/approve
   ```
   Refresh the status: `Completed`, `Approved`.

5. Submit another expense and do **nothing** for 2 minutes. Then check the status: `Timed out`.
   Also try `reject`, and an expense below EUR 100.

> **Built-in alternative:** the `sendEventPostUri` from the 202 response raises an event too, without writing
> your own `decideExpense` function. You'll need to fill in `{eventName}` and post the event data as JSON.

---

## Part 8: Deploy to Azure (Flex Consumption)

1. Create a resource group and a storage account. Every Function App needs a storage account for its own
   state, triggers and the Durable Functions task hub:
   ```sh
   az group create --name rg-functionslab-<suffix> --location westeurope
   az storage account create --name stfunclab<suffix> --resource-group rg-functionslab-<suffix> --location westeurope --sku Standard_LRS
   ```

2. Create the Function App on the **Flex Consumption** plan (serverless, scales to zero, pay per execution):
   ```sh
   az functionapp create --name func-lab-<suffix> --resource-group rg-functionslab-<suffix> --storage-account stfunclab<suffix> --flexconsumption-location westeurope --runtime node --runtime-version 24
   ```
   This also creates an **Application Insights** resource for logging and monitoring.

3. Create the `uploads` container in the new storage account:
   ```sh
   az storage container create --name uploads --account-name stfunclab<suffix> --auth-mode key
   ```

4. Publish your code from the project folder:
   ```sh
   func azure functionapp publish func-lab-<suffix>
   ```
   Core Tools builds the project, packages it and deploys it (about 1.5 minutes). At the end it lists the
   functions and the URLs of the HTTP functions.

5. Test the HTTP function in the browser: `https://<your-function-app-host>/api/hello?name=Azure`
   (the URL is shown at the end of the publish output). `functionApp` and `machine` now show it runs in Azure.

6. `submitOrder` requires a key in Azure. Get the default function key:
   ```sh
   az functionapp keys list --name func-lab-<suffix> --resource-group rg-functionslab-<suffix> --query functionKeys.default -o tsv
   ```
   First call it without a key (expect `401 Unauthorized`), then with the key:
   ```sh
   curl -i -X POST "https://<your-function-app-host>/api/orders" -H "Content-Type: application/json" --data @test/order.json
   curl -X POST "https://<your-function-app-host>/api/orders?code=<function-key>" -H "Content-Type: application/json" --data @test/order.json
   ```

7. Run the order workflow in Azure and follow its `statusQueryGetUri` in the browser:
   ```sh
   curl -X POST "https://<your-function-app-host>/api/workflow/orders" -H "Content-Type: application/json" --data @test/order.json
   ```

---

## Part 9: Connect Event Grid to the blob trigger

In Azure, Event Grid has to know where to send the "blob created" events. You create an **event subscription**
on the storage account that calls the blob extension's webhook in your Function App.

1. Get the system key of the blob extension. The webhook is protected with it:
   ```sh
   az functionapp keys list --name func-lab-<suffix> --resource-group rg-functionslab-<suffix> --query systemKeys.blobs_extension -o tsv
   ```

2. Get the resource ID of the storage account:
   ```sh
   az storage account show --name stfunclab<suffix> --query id -o tsv
   ```

3. Create the event subscription (replace the three placeholders; keep the quotes around the URL):
   ```sh
   az eventgrid event-subscription create --name uploads-to-function --source-resource-id <storage-account-id> --endpoint "https://<your-function-app-host>/runtime/webhooks/blobs?functionName=Host.Functions.analyzeTextFile&code=<blobs-extension-key>" --included-event-types Microsoft.Storage.BlobCreated --subject-begins-with /blobServices/default/containers/uploads/
   ```
   Event Grid first validates the endpoint (a handshake the blob extension answers), then creates the subscription.
   > **Portal alternative:** Storage account → *Events* → *+ Event Subscription*, endpoint type *Web Hook*, with the
   > same URL. Under *Filters*, enable subject filtering with the same "begins with" value.

4. Upload a text file to Azure:
   ```sh
   az storage blob upload --container-name uploads --name test.txt --file <path-to-a-txt-file> --account-name stfunclab<suffix> --auth-mode key
   ```
   Within seconds, `results/test.json` appears in the storage account. Check it in Storage Explorer or the
   portal (*Storage browser*).

5. Upload the samples and run the word count in Azure:
   ```sh
   az storage blob upload-batch --destination uploads --source <path-to-samples-folder> --account-name stfunclab<suffix> --auth-mode key
   curl -X POST "https://<your-function-app-host>/api/workflow/wordcount"
   ```

6. Look at the monitoring in the portal: your Function App → *Monitoring* → *Application Insights* → *Logs*, and run:
   ```
   traces
   | where timestamp > ago(30m)
   | order by timestamp desc
   ```
   Also look at *Live metrics* while you start a few workflows, and the *Invocations* tab of a single function.

---

## Part 10: Clean up

Delete the resource group with everything in it:
```sh
az group delete --name rg-functionslab-<suffix> --yes --no-wait
```

---

## Bonus challenges

1. **Timer trigger**: add a function that runs every minute (`app.timer(...)`, schedule `0 */1 * * * *`) and
   starts a `wordCount` orchestration. Tip: add `extraInputs: [df.input.durableClient()]` to the timer trigger too.
2. **Retry handling**: change the `chargePayment` retry options to 2 attempts. What happens to a normal order now?
3. **Monitor pattern**: write an orchestrator that checks something every 10 seconds (`createTimer` in a loop)
   and stops after 1 minute. Why should you use `context.df.continueAsNew(...)` for very long-running loops?
4. **Durable Entities**: implement a counter entity (`df.app.entity(...)`) that counts processed orders, and
   signal it from `processOrder`.
5. **Managed identity**: the lab uses the storage connection string. Find out what changes when you use
   `AzureWebJobsStorage__accountName` with a managed identity instead.

---

## Troubleshooting

| Problem | Solution |
| --- | --- |
| `The API version ... is not supported by Azurite` | Start Azurite with `--skipApiVersionCheck`, or update it: `npm install -g azurite` |
| `func start`: "No job functions found" | Did the build succeed? Check that `dist/src/functions/` contains `.js` files, and run `npm start` (which builds) instead of `func start` |
| Blob trigger doesn't fire locally | Locally there's no Event Grid: post the event yourself (Part 4, step 4). The file name in the event must match the uploaded blob |
| Blob trigger doesn't fire in Azure | Check the event subscription (Storage account → *Events*), the key in the URL, and that the file name ends with `.txt` |
| Durable status stays `Pending` for a while | Normal after a restart; the polling backs off when idle. Check the `durableTask` settings in `host.json` |
| `curl` in PowerShell behaves strangely | Use `curl.exe` |

---

## Congratulations!
You built an Azure Functions app with HTTP, queue and blob triggers, input/output bindings, and three Durable
Functions patterns, and you deployed it to Azure on the Flex Consumption plan.
