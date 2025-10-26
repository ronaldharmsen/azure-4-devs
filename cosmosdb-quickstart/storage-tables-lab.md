# Lab: C# Todo App with Azure Storage Tables

In this lab, you'll build a simple C# Todo web application that stores its data in Azure Storage Tables. You'll test locally using Azurite and then deploy to Azure App Service, using configuration settings for connection management.

---

## Prerequisites
- .NET SDK installed
- Azurite (Storage Emulator) installed
- Azure CLI installed
- An active Azure subscription
- Visual Studio or Visual Studio Code

---

## Step 1: Set Up Azurite (Local Development)

1. Install Azurite:
   ```sh
   npm install -g azurite
   ```
2. Start Azurite:
   ```sh
   azurite --table
   ```
3. Use the default connection string for local development:
   ```
   UseDevelopmentStorage=true
   ```

---

## Step 2: Create the C# Todo Web App

1. Create a new ASP.NET Core web app:
   ```sh
   dotnet new webapp -n TodoAppStorage
   cd TodoAppStorage
   ```
2. Add the Azure.Data.Tables NuGet package:
   ```sh
   dotnet add package Azure.Data.Tables
   ```
3. In `appsettings.json`, add your local storage connection string:
   ```json
   {
     "Storage": {
       "ConnectionString": "UseDevelopmentStorage=true",
       "TableName": "Todos"
     }
     // ...existing settings...
   }
   ```
4. Create a simple Todo model:
   ```csharp
   using Azure;
   using Azure.Data.Tables;
   public class TodoEntity : ITableEntity
   {
       public string PartitionKey { get; set; } = "Todo";
       public string RowKey { get; set; }
       public string Title { get; set; }
       public bool IsDone { get; set; }
       public DateTimeOffset? Timestamp { get; set; }
       public ETag ETag { get; set; }
   }
   ```
5. Add code to interact with the table (e.g., in a service class):
   ```csharp
   using Azure.Data.Tables;
   // ...existing code...
   public class TodoService
   {
       private readonly TableClient _tableClient;
       public TodoService(IConfiguration config)
       {
           var connStr = config["Storage:ConnectionString"];
           var tableName = config["Storage:TableName"];
           _tableClient = new TableClient(connStr, tableName);
           _tableClient.CreateIfNotExists();
       }
       public void AddTodo(TodoEntity item)
       {
           item.RowKey = Guid.NewGuid().ToString();
           _tableClient.AddEntity(item);
       }
       public List<TodoEntity> GetTodos()
       {
           return _tableClient.Query<TodoEntity>().ToList();
       }
   }
   ```
6. Create a simple form in your web app to add and list todos.
7. Run and test the app locally. Verify that todos are stored in Azurite.

---

## Step 3: Prepare for Azure Deployment

1. Remove the local connection string from `appsettings.json`.
2. In Azure, create a Storage Account:
   ```sh
   az storage account create --name <yourstorageaccount> --resource-group MyResourceGroup --location <region> --sku Standard_LRS
   ```
3. Get the connection string:
   ```sh
   az storage account show-connection-string --name <yourstorageaccount> --resource-group MyResourceGroup
   ```
4. In the Azure Portal, go to your App Service > **Configuration** > **Application settings** and add:
   - `Storage:ConnectionString`
   - `Storage:TableName`

---

## Step 4: Deploy the App to Azure App Service

1. Publish your app:
   ```sh
   dotnet publish -c Release -o ./publish
   ```
2. Deploy to Azure:
   ```sh
   az webapp deploy --resource-group MyResourceGroup --name <unique-app-name> --src-path ./publish
   ```

---

## Step 5: Test the App in Azure

1. Open your browser and navigate to your App Service URL.
2. Add and view todos. Data should be stored in your Azure Storage Table.

---

## Step 6: Clean Up (Optional)
- Delete the App Service and Storage Account resources if no longer needed.

---

## Best Practices & Tips
- Store connection strings in App Service configuration, not in code
- Use partition keys for scalability
- Monitor usage to avoid unexpected costs

---

## Congratulations!
You have built and deployed a C# Todo app using Azure Storage Tables, tested locally with Azurite, and deployed to Azure using configuration settings!
