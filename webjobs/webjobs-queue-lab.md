# Lab: Integrating Azure Storage Queue with WebJobs (C#)

In this lab, you'll build a simple web application with a form that sends messages to an Azure Storage Queue. You'll then create a WebJob that listens to the queue and logs the message content. This demonstrates event-driven background processing using Azure WebJobs and Storage Queues.

You'll use .NET 10, the **WebJobs SDK 3.x** (the same SDK that Azure Functions is built on), and a **Linux** App Service.
You develop and test everything locally with Azurite first, then deploy to Azure.

---

## Prerequisites
- .NET 10 SDK installed
- Azure CLI installed, logged in (`az login`)
- Azurite and Azure Storage Explorer (see [Setting up your development environment](../setup/dev-station-setup.md))
- An active Azure subscription
- Visual Studio or Visual Studio Code

### Conventions in this lab
- Pick a **suffix** of 4-6 lowercase letters/digits, for example your initials plus three digits (`rh123`).
  Wherever you see `<suffix>`, use your own suffix. Some Azure resource names must be globally unique.
- All commands are single-line and work in bash, zsh and PowerShell.

---

## Step 1: Start Azurite

Start the storage emulator in a separate terminal and leave it running:
```sh
azurite --silent --skipApiVersionCheck --location ./azurite-data
```

Locally, both the web app and the WebJob use Azurite. In Azure, they use a real storage account.

---

## Step 2: Build the Web Application

1. Create a new ASP.NET Core web app:
   ```sh
   dotnet new webapp -n QueueWebApp
   cd QueueWebApp
   ```
2. Add the Azure Storage Queues package:
   ```sh
   dotnet add package Azure.Storage.Queues
   ```
3. Add the storage connection string for local development to `appsettings.Development.json`:
   ```json
   {
     "AzureWebJobsStorage": "UseDevelopmentStorage=true",
     "DetailedErrors": true,
     "Logging": {
       "LogLevel": {
         "Default": "Information",
         "Microsoft.AspNetCore": "Warning"
       }
     }
   }
   ```
   > The setting is called `AzureWebJobsStorage` because the WebJob uses the same name. In Azure, you set it **once**
   > as an app setting, and both the web app and the WebJob read it.

4. Register a `QueueClient` in `Program.cs`. Add `using Azure.Storage.Queues;` at the top, and add these lines right after `builder.Services.AddRazorPages();`:
   ```csharp
   // The storage connection string comes from the setting 'AzureWebJobsStorage': the WebJob uses the same one.
   // Base64: the WebJobs SDK expects base64-encoded queue messages.
   string storage = builder.Configuration["AzureWebJobsStorage"]
       ?? throw new InvalidOperationException("Setting 'AzureWebJobsStorage' is missing");
   builder.Services.AddSingleton(new QueueClient(storage, "myqueue",
       new QueueClientOptions { MessageEncoding = QueueMessageEncoding.Base64 }));
   ```
   > **Why base64?** The WebJobs SDK (and Azure Functions) expect queue messages to be base64-encoded by default.
   > If you send plain text, the WebJob can't read the messages and moves them to the poison queue.

5. Replace the contents of `Pages/Index.cshtml` with a form:
   ```html
   @page
   @model IndexModel
   @{
       ViewData["Title"] = "Send a message";
   }

   <h1>Send a message to the queue</h1>
   <form method="post">
       <input asp-for="Message" placeholder="Enter your message" required />
       <button type="submit">Send</button>
   </form>
   @if (Model.Result != null)
   {
       <p>@Model.Result</p>
   }
   ```

6. Replace the contents of `Pages/Index.cshtml.cs` with code that sends the message to the queue:
   ```csharp
   using Azure.Storage.Queues;
   using Microsoft.AspNetCore.Mvc;
   using Microsoft.AspNetCore.Mvc.RazorPages;

   namespace QueueWebApp.Pages;

   public class IndexModel(QueueClient queue) : PageModel
   {
       [BindProperty]
       public string Message { get; set; } = "";

       public string? Result { get; private set; }

       public void OnGet() { }

       public async Task OnPostAsync()
       {
           await queue.CreateIfNotExistsAsync();
           await queue.SendMessageAsync(Message);
           Result = $"Message sent: {Message}";
       }
   }
   ```
   The `QueueClient` is injected through the constructor (dependency injection), instead of being created on every request.

7. Run the app and send a few messages:
   ```sh
   dotnet run
   ```
   Open the URL shown in the terminal. In **Azure Storage Explorer** → *Emulator & Attached* → *Storage Accounts* →
   *(Emulator - Default Ports)* → *Queues* → `myqueue`, you can see the messages waiting. Nobody processes them yet.

   Leave the web app running.

---

## Step 3: Create the WebJob to Process Queue Messages

1. In a new terminal, go back to your working folder (next to `QueueWebApp`), and create a console app for the WebJob:
   ```sh
   dotnet new console -n QueueWebJob
   cd QueueWebJob
   ```
2. Add the WebJobs SDK queue extension and the .NET hosting and logging packages:
   ```sh
   dotnet add package Microsoft.Azure.WebJobs.Extensions.Storage.Queues
   dotnet add package Microsoft.Extensions.Hosting
   dotnet add package Microsoft.Extensions.Logging.Console
   ```
3. Replace `Program.cs` with the host configuration:
   ```csharp
   using Microsoft.Extensions.Hosting;
   using Microsoft.Extensions.Logging;

   var host = Host.CreateDefaultBuilder(args)
       .ConfigureWebJobs(webJobs =>
       {
           webJobs.AddAzureStorageQueues(options =>
           {
               options.MaxDequeueCount = 3; // after 3 failed attempts, a message moves to 'myqueue-poison'
           });
       })
       .ConfigureLogging(logging =>
       {
           logging.AddSimpleConsole(options => options.SingleLine = true);
           logging.AddFilter("Azure.Core", LogLevel.Warning);
       })
       .Build();

   await host.RunAsync();
   ```
   > Older samples use `new JobHost()` and `host.RunAndBlock()`. That's the WebJobs SDK 2.x API, which no longer exists.
   > Since version 3, a WebJob is a normal .NET generic host with `ConfigureWebJobs`.

4. Create a file `Functions.cs` with the function that processes the messages:
   ```csharp
   using Microsoft.Azure.WebJobs;
   using Microsoft.Extensions.Logging;

   public static class Functions
   {
       public static void ProcessQueueMessage([QueueTrigger("myqueue")] string message, long dequeueCount, ILogger logger)
       {
           logger.LogInformation("WebJob received message: {Message} (attempt {Attempt})", message, dequeueCount);

           if (message.Contains("fail", StringComparison.OrdinalIgnoreCase))
           {
               throw new InvalidOperationException("Messages containing 'fail' always fail");
           }
       }
   }
   ```
   - `[QueueTrigger("myqueue")]`: the SDK polls the queue and calls this method for every message. If the method
     completes, the message is deleted. If it throws, the message is retried.
   - `dequeueCount` shows the attempt number.
   - Looks familiar? Azure Functions uses exactly the same trigger attributes.

5. Create `appsettings.json` for local development:
   ```json
   {
     "AzureWebJobsStorage": "UseDevelopmentStorage=true"
   }
   ```
   In Azure, the app setting `AzureWebJobsStorage` overrides this value, because environment variables win over `appsettings.json`.

6. Create a file `run.sh` with this single line. Linux App Service starts a WebJob through this script:
   ```sh
   dotnet QueueWebJob.dll
   ```

7. Make sure both files end up in the build output. Add this to `QueueWebJob.csproj`, before `</Project>`:
   ```xml
   <ItemGroup>
     <None Update="appsettings.json" CopyToOutputDirectory="PreserveNewest" />
     <None Update="run.sh" CopyToOutputDirectory="PreserveNewest" />
   </ItemGroup>
   ```

8. Run the WebJob locally, from the `QueueWebJob` folder:
   ```sh
   dotnet run
   ```
   It picks up the messages you sent in Step 2 right away. Send more messages from the web app and watch them arrive.

9. Send a message containing the word **fail**. The WebJob logs attempts 1, 2 and 3, then:
   `Message has reached MaxDequeueCount of 3. Moving message to queue 'myqueue-poison'`.
   Find the message in the queue `myqueue-poison` in Storage Explorer.

Stop both apps (`Ctrl+C`).

---

## Step 4: Create the Azure Resources

1. Create a resource group and a storage account:
   ```sh
   az group create --name rg-webjobslab-<suffix> --location westeurope
   az storage account create --name stwjlab<suffix> --resource-group rg-webjobslab-<suffix> --location westeurope --sku Standard_LRS
   ```
2. Create a Linux App Service plan and a web app:
   ```sh
   az appservice plan create --name plan-webjobslab --resource-group rg-webjobslab-<suffix> --sku B1 --is-linux
   az webapp create --name app-webjobslab-<suffix> --resource-group rg-webjobslab-<suffix> --plan plan-webjobslab --runtime "DOTNETCORE:10.0"
   ```
3. Turn on **Always On**. Without it, the app is unloaded after 20 minutes without web traffic, and the WebJob stops
   with it. Always On needs the Basic (B1) tier or higher; that's why this lab doesn't use the Free tier.
   ```sh
   az webapp config set --name app-webjobslab-<suffix> --resource-group rg-webjobslab-<suffix> --always-on true
   ```
4. Get the connection string of the storage account:
   ```sh
   az storage account show-connection-string --name stwjlab<suffix> --resource-group rg-webjobslab-<suffix> --query connectionString -o tsv
   ```
5. Add the app settings (paste the connection string, and keep the quotes):
   ```sh
   az webapp config appsettings set --name app-webjobslab-<suffix> --resource-group rg-webjobslab-<suffix> --settings "AzureWebJobsStorage=<connection-string>" WEBSITE_SKIP_RUNNING_KUDUAGENT=false
   ```
   - `AzureWebJobsStorage` is used by both the web app and the WebJob: app settings are environment variables for
     every process of the app.
   - `WEBSITE_SKIP_RUNNING_KUDUAGENT=false` enables WebJobs on Linux App Service. Without it, the portal reports that
     the web app is not configured to run WebJobs.

---

## Step 5: Deploy the Web App

From the `QueueWebApp` folder, publish the app, zip the output, and deploy the zip:

```sh
dotnet publish -c Release -o publish
```
- **macOS/Linux:**
  ```sh
  cd publish && zip -r ../QueueWebApp.zip . && cd ..
  ```
- **Windows (PowerShell):**
  ```powershell
  Compress-Archive -Path publish\* -DestinationPath QueueWebApp.zip -Force
  ```

```sh
az webapp deploy --name app-webjobslab-<suffix> --resource-group rg-webjobslab-<suffix> --src-path QueueWebApp.zip --type zip
```

Open `https://app-webjobslab-<suffix>.azurewebsites.net` and send a message. It waits in the queue of the storage
account in Azure (check it in Storage Explorer, under your subscription).

---

## Step 6: Deploy the WebJob

1. From the `QueueWebJob` folder, publish and zip the WebJob. The zip must contain `run.sh` and `QueueWebJob.dll` at the root:
   ```sh
   dotnet publish -c Release -o publish
   ```
   - **macOS/Linux:**
     ```sh
     cd publish && zip -r ../QueueWebJob.zip . && cd ..
     ```
   - **Windows (PowerShell):**
     ```powershell
     Compress-Archive -Path publish\* -DestinationPath QueueWebJob.zip -Force
     ```
2. In the Azure Portal, go to your App Service. In the left menu, select **Settings** > **WebJobs** > **Add**.
3. Fill in:
   - **Name**: `QueueWebJob`
   - **File Upload**: `QueueWebJob.zip`
   - **Type**: Continuous
   - **Scale**: Multi Instance
4. Select **Create WebJob**. After a few seconds, the status changes to **Running** (select **Refresh** if needed).

---

## Step 7: Test the Integration and View Logs

1. The WebJob immediately processes the message you sent in Step 5.
2. Send a few more messages from the web app, including one with the word **fail**.
3. In the Azure Portal, go to your App Service > **WebJobs**, and select **Logs** for `QueueWebJob`. You should see log entries like:
   ```
   WebJob received message: <your-message> (attempt 1)
   ```
   and for the failing message, three attempts followed by the move to `myqueue-poison`.
4. **Decoupling:** stop the WebJob in the portal (**Stop**), send three messages, and check the queue in Storage
   Explorer: the messages wait. Start the WebJob again (**Run**): it processes the backlog. The web app was never
   affected. That's the point of putting a queue between the web app and background processing.

---

## Step 8: Clean Up
Delete the resource group with everything in it. The B1 plan costs money while it exists, even when idle:
```sh
az group delete --name rg-webjobslab-<suffix> --yes --no-wait
```

---

## Best Practices & Tips
- Use queues for decoupling web and background processing
- Send queue messages base64-encoded when a WebJob or Azure Function processes them
- Use one app setting for the connection, shared by the web app and its WebJobs
- Turn on **Always On** for continuous and scheduled WebJobs
- Use `MaxDequeueCount` and the poison queue for messages that keep failing, and monitor the poison queue
- A continuous WebJob runs on every instance of the app: when you scale out, you get more queue workers
- Consider Azure Functions for background work that should scale independently of your web app

---

## Congratulations!
You have successfully built a web application that sends messages to an Azure Storage Queue and a WebJob that processes those messages. Try extending this pattern for more complex workflows!
