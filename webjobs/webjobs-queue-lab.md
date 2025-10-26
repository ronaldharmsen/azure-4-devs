# Lab: Integrating Azure Storage Queue with WebJobs (C#)

In this lab, you'll build a simple web application with a form that sends messages to an Azure Storage Queue. You'll then create a WebJob that listens to the queue and logs the message content. This demonstrates event-driven background processing using Azure WebJobs and Storage Queues.

---

## Prerequisites
- Azure CLI installed
- .NET SDK installed
- An active Azure subscription
- Visual Studio or Visual Studio Code

---

## Step 1: Set Up Azure Storage Account and Queue

1. Log in to Azure:
   ```sh
   az login
   ```
2. Create a resource group (if needed):
   ```sh
   az group create --name MyResourceGroup --location <region>
   ```
3. Create a storage account:
   ```sh
   az storage account create --name mystorageaccount123 --resource-group MyResourceGroup --location <region> --sku Standard_LRS
   ```
4. Get the connection string:
   ```sh
   az storage account show-connection-string --name mystorageaccount123 --resource-group MyResourceGroup
   ```
5. Create a queue:
   ```sh
   az storage queue create --name myqueue --account-name mystorageaccount123
   ```

---

## Step 2: Build the Web Application

1. Create a new ASP.NET Core web app:
   ```sh
   dotnet new webapp -n QueueWebApp
   cd QueueWebApp
   ```
2. Add the Azure.Storage.Queues NuGet package:
   ```sh
   dotnet add package Azure.Storage.Queues
   ```
3. In `appsettings.json`, add your storage connection string:
   ```json
   {
     "AzureStorageConnectionString": "<your-connection-string>"
     // ...existing settings...
   }
   ```
4. Add a form to your main page (e.g., `Pages/Index.cshtml`):
   ```html
   <form method="post">
     <input type="text" name="Message" placeholder="Enter your message" required />
     <button type="submit">Send</button>
   </form>
   @if (ViewData["Result"] != null) {
     <p>@ViewData["Result"]</p>
   }
   ```
5. In `Pages/Index.cshtml.cs`, add code to send the message to the queue:
   ```csharp
   using Azure.Storage.Queues;
   using Microsoft.Extensions.Configuration;
   // ...existing code...
   public class IndexModel : PageModel
   {
       private readonly IConfiguration _config;
       public IndexModel(IConfiguration config) { _config = config; }
       public void OnGet() { }
       public async Task OnPostAsync()
       {
           var message = Request.Form["Message"];
           var connStr = _config["AzureStorageConnectionString"];
           var queueClient = new QueueClient(connStr, "myqueue");
           await queueClient.CreateIfNotExistsAsync();
           await queueClient.SendMessageAsync(message);
           ViewData["Result"] = "Message sent!";
       }
   }
   ```
6. Run and test the app locally. Submitting the form should send a message to the Azure queue.

---

## Step 3: Create the WebJob to Process Queue Messages

1. Create a new .NET Console App for the WebJob:
   ```sh
   dotnet new console -n QueueWebJob
   cd QueueWebJob
   ```
2. Add the WebJobs SDK and Storage packages:
   ```sh
   dotnet add package Microsoft.Azure.WebJobs.Extensions.Storage
   dotnet add package Microsoft.Azure.WebJobs
   dotnet add package Microsoft.Extensions.Logging.Console
   ```
3. In `Program.cs`, add code to process queue messages:
   ```csharp
   using Microsoft.Azure.WebJobs;
   using Microsoft.Extensions.Logging;

   public static void Main()
   {
       var host = new JobHost();
       host.RunAndBlock();
   }

   public static void ProcessQueueMessage([QueueTrigger("myqueue")] string message, ILogger logger)
   {
       logger.LogInformation($"WebJob received message: {message}");
   }
   ```
4. In `appsettings.json`, add your storage connection string:
   ```json
   {
     "AzureWebJobsStorage": "<your-connection-string>"
   }
   ```
5. Publish and zip the WebJob for deployment:
   ```sh
   dotnet publish -c Release -o ./publish
   cd publish
   zip -r ../QueueWebJob.zip .
   cd ..
   ```

---

## Step 4: Deploy the WebJob to Azure App Service

1. Go to the Azure Portal and navigate to your App Service.
2. In the left menu, select **WebJobs** > **Add**.
3. Upload `QueueWebJob.zip` as a continuous WebJob.
4. Name the WebJob and click **OK** to deploy.

---

## Step 5: Test the Integration and View Logs

1. Use your web application to submit a message.
2. In the Azure Portal, go to your App Service > **WebJobs**.
3. Select your WebJob and view the logs.
4. You should see log entries like:
   ```
   WebJob received message: <your-message>
   ```

---

## Step 6: Clean Up (Optional)
- Delete the WebJob and storage resources if no longer needed.

---

## Best Practices & Tips
- Use queues for decoupling web and background processing
- Monitor WebJob logs for troubleshooting
- Use retry policies for robust message processing
- Consider scaling out for high-throughput scenarios

---

## Congratulations!
You have successfully built a web application that sends messages to an Azure Storage Queue and a WebJob that processes those messages. Try extending this pattern for more complex workflows!
