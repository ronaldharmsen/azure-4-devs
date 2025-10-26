# Lab: Deploy a Simple C# Web Application to Azure App Service

Welcome to this hands-on lab! In this guide, you'll create a basic C# web application and deploy it to Azure App Service. This lab will walk you through each step with clear instructions.

---

## Prerequisites
- [.NET SDK](https://dotnet.microsoft.com/download) installed
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- An active [Azure account](https://portal.azure.com/)

---

## Step 1: Create a New C# Web Application

1. Open your terminal and navigate to your working directory.
2. Run the following command to create a new ASP.NET Core web app:
   ```sh
   dotnet new webapp -n MyWebApp
   ```
3. Change into the project directory:
   ```sh
   cd MyWebApp
   ```
4. Test the app locally:
   ```sh
   dotnet run
   ```
   Visit `https://localhost:5001` in your browser to see your app running.

---

## Step 2: Initialize Azure Resources

1. Log in to Azure:
   ```sh
   az login
   ```
2. Create a resource group (replace `<region>` with your preferred Azure region):
   ```sh
   az group create --name MyResourceGroup --location <region>
   ```
3. Create an App Service plan:
   ```sh
   az appservice plan create --name MyAppServicePlan --resource-group MyResourceGroup --sku FREE
   ```
4. Create a web app:
   ```sh
   az webapp create --name <unique-app-name> --resource-group MyResourceGroup --plan MyAppServicePlan
   ```
   > **Note:** `<unique-app-name>` must be globally unique.

---

## Step 3: Deploy Your App to Azure

1. Publish your app to a folder:
   ```sh
   dotnet publish -c Release -o ./publish
   ```
2. Deploy using Azure CLI:
   ```sh
   az webapp deploy --resource-group MyResourceGroup --name <unique-app-name> --src-path ./publish
   ```

---

## Step 4: Verify Your Deployment

1. Open your browser and navigate to `https://<unique-app-name>.azurewebsites.net`
2. You should see your C# web application live!
3. Have a look in the Azure Portal and see your app and all the options there

---

## Congratulations!
You have successfully created and deployed a C# web application to Azure App Service. Explore further by customizing your app or integrating other Azure services!
