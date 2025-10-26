# Lab: C# Todo App with Azure Cosmos DB

In this lab, you'll build a simple C# Todo web application that stores its data in Azure Cosmos DB. You'll start by using the Cosmos DB Emulator for local development, then deploy to Azure App Service using the most cost-effective Cosmos DB configuration and manage connection settings via App Service configuration.

---

## Prerequisites
- .NET SDK installed
- Cosmos DB Emulator (Windows only)
- Azure CLI installed
- An active Azure subscription
- Visual Studio or Visual Studio Code

---

## Step 1: Set Up Cosmos DB Emulator (Local Development)

1. Download and install the [Cosmos DB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/local-emulator) (Windows only).
2. Start the emulator from the Start menu. It will run locally and provide a connection string.
3. Copy the connection string from the emulator's portal (usually `https://localhost:8081` with a key).

---

## Step 2: Create the C# Todo Web App

1. Create a new ASP.NET Core web app:
	```sh
	dotnet new webapp -n TodoApp
	cd TodoApp
	```
2. Add the Azure Cosmos DB SDK:
	```sh
	dotnet add package Microsoft.Azure.Cosmos
	```
3. In `appsettings.json`, add your local Cosmos DB connection string:
	```json
	{
	  "CosmosDb": {
		 "Account": "https://localhost:8081",
		 "Key": "<your-emulator-key>",
		 "DatabaseName": "TodoDb",
		 "ContainerName": "Todos"
	  }
	  // ...existing settings...
	}
	```
4. Create a simple Todo model:
	```csharp
	public class TodoItem
	{
		 public string id { get; set; }
		 public string Title { get; set; }
		 public bool IsDone { get; set; }
	}
	```
5. Add Cosmos DB client code to interact with the database (e.g., in a service class):
	```csharp
	using Microsoft.Azure.Cosmos;
	// ...existing code...
	public class TodoService
	{
		 private readonly Container _container;
		 public TodoService(IConfiguration config)
		 {
			  var account = config["CosmosDb:Account"];
			  var key = config["CosmosDb:Key"];
			  var dbName = config["CosmosDb:DatabaseName"];
			  var containerName = config["CosmosDb:ContainerName"];
			  var client = new CosmosClient(account, key);
			  _container = client.GetContainer(dbName, containerName);
		 }
		 public async Task AddTodoAsync(TodoItem item)
		 {
			  item.id = Guid.NewGuid().ToString();
			  await _container.CreateItemAsync(item, new PartitionKey(item.id));
		 }
		 public async Task<List<TodoItem>> GetTodosAsync()
		 {
			  var query = _container.GetItemQueryIterator<TodoItem>("SELECT * FROM c");
			  var results = new List<TodoItem>();
			  while (query.HasMoreResults)
			  {
					var response = await query.ReadNextAsync();
					results.AddRange(response);
			  }
			  return results;
		 }
	}
	```
6. Create a simple form in your web app to add and list todos.
7. Run and test the app locally. Verify that todos are stored in the emulator.

---

## Step 3: Prepare for Azure Deployment

1. Remove emulator connection string from `appsettings.json`.
2. In Azure, create a Cosmos DB account with the **serverless** or **free tier** option for lowest cost:
	```sh
	az cosmosdb create --name <your-cosmosdb-name> --resource-group MyResourceGroup --kind MongoDB --enable-free-tier true
	```
	> For SQL API, use `--kind GlobalDocumentDB` and add `--enable-serverless true` for serverless.
3. Get the connection string for your Cosmos DB account:
	```sh
	az cosmosdb keys list --name <your-cosmosdb-name> --resource-group MyResourceGroup --type connection-strings
	```
4. In the Azure Portal, go to your App Service > **Configuration** > **Application settings** and add:
	- `CosmosDb:Account`
	- `CosmosDb:Key`
	- `CosmosDb:DatabaseName`
	- `CosmosDb:ContainerName`

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
2. Add and view todos. Data should be stored in your Cosmos DB account.

---

## Step 6: Clean Up (Optional)
- Delete the App Service and Cosmos DB resources if no longer needed.

---

## Best Practices & Tips
- Use serverless or free tier for lowest cost in Cosmos DB
- Store connection strings in App Service configuration, not in code
- Use partition keys for scalability
- Monitor usage to avoid unexpected costs

---

## Congratulations!
You have built and deployed a C# Todo app using Azure Cosmos DB, tested locally with the emulator, and deployed to Azure using cost-effective settings!
# CosmosDB

