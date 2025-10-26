# Lab: Azure Function Blob Trigger with C#

In this lab, you'll create an Azure Function using C# that is triggered when a file is created in Azure Blob Storage. The function will read the file contents, log the number of characters if it's text, and log an error if it's not.

---

## Prerequisites
- .NET SDK installed
- Azure Functions Core Tools installed
- Azure CLI installed
- An active Azure subscription
- Visual Studio or Visual Studio Code

---

## Step 1: Create a Storage Account and Blob Container

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
4. Create a blob container:
   ```sh
   az storage container create --name mycontainer --account-name mystorageaccount123
   ```

---

## Step 2: Create the Azure Function Project

1. Create a new Functions project:
   ```sh
   func init BlobTriggerCSharpLab --worker-runtime dotnet
   cd BlobTriggerCSharpLab
   ```
2. Create a new Blob Trigger function:
   ```sh
   func new --template "Blob Trigger" --name BlobFileTrigger
   ```
3. When prompted, enter:
   - Path: `mycontainer/{name}`
   - Storage account connection: `AzureWebJobsStorage`

---

## Step 3: Implement the Function Logic

1. Open `BlobFileTrigger.cs` and replace the code with:
   ```csharp
   using System;
   using System.IO;
   using Microsoft.Azure.WebJobs;
   using Microsoft.Extensions.Logging;

   public static class BlobFileTrigger
   {
       [FunctionName("BlobFileTrigger")]
       public static void Run(
           [BlobTrigger("mycontainer/{name}", Connection = "AzureWebJobsStorage")] Stream myBlob,
           string name,
           ILogger log)
       {
           log.LogInformation($"Blob trigger function processed file: {name}, Size: {myBlob.Length} bytes");
           try
           {
               using var reader = new StreamReader(myBlob);
               var text = reader.ReadToEnd();
               // Simple check for text content (ASCII)
               if (System.Text.Encoding.UTF8.GetByteCount(text) == text.Length)
               {
                   log.LogInformation($"File contains {text.Length} characters.");
               }
               else
               {
                   throw new Exception("File does not appear to be plain text.");
               }
           }
           catch (Exception ex)
           {
               log.LogError($"Error reading blob as text: {ex.Message}");
           }
       }
   }
   ```

---

## Step 4: Configure Local Settings

1. In `local.settings.json`, add your storage account connection string:
   ```json
   {
     "IsEncrypted": false,
     "Values": {
       "AzureWebJobsStorage": "<your-connection-string>",
       "FUNCTIONS_WORKER_RUNTIME": "dotnet"
     }
   }
   ```

---

## Step 5: Test Locally with Azurite or Azure Storage

1. Start Azurite (optional for local testing):
   ```sh
   azurite
   ```
2. Run the function locally:
   ```sh
   func start
   ```
3. Upload a text file to the blob container using Azure Storage Explorer or CLI:
   ```sh
   az storage blob upload --account-name mystorageaccount123 --container-name mycontainer --name test.txt --file ./test.txt
   ```
4. Check the function logs to see the character count or error message.

---

## Step 6: Deploy to Azure

1. Create a Function App:
   ```sh
   az functionapp create --resource-group MyResourceGroup --consumption-plan-location <region> --runtime dotnet --functions-version 4 --name <unique-func-app-name> --storage-account mystorageaccount123
   ```
2. Deploy your function:
   ```sh
   func azure functionapp publish <unique-func-app-name>
   ```

---

## Step 7: Test in Azure

1. Upload a file to the blob container in Azure.
2. Go to the Azure Portal > Function App > Monitor to view logs and verify the function processed the file.

---

## Step 8: Clean Up (Optional)
- Delete the Function App and Storage Account if no longer needed.

---

## Best Practices & Tips
- Use bindings for easy integration with Azure services
- Validate file types and handle errors gracefully
- Monitor function logs for troubleshooting
- Use consumption plan for lowest cost

---

## Congratulations!
You have created an Azure Function that responds to blob creation, reads file contents, and logs the result using C#!
