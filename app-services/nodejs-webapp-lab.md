# Lab: Deploy a Simple Node.js Web Application to Azure App Service

Welcome to this hands-on lab! In this guide, you'll create a basic Node.js web application and deploy it to Azure App Service. This lab will walk you through each step with clear instructions.

---

## Prerequisites
- [Node.js](https://nodejs.org/) installed
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- An active [Azure account](https://portal.azure.com/)

---

## Step 1: Create a New Node.js Web Application

1. Open your terminal and navigate to your working directory.
2. Create a new folder for your app and initialize it:
   ```sh
   mkdir MyNodeApp
   cd MyNodeApp
   npm init -y
   ```
3. Install Express.js:
   ```sh
   npm install express
   ```
4. Create a file named `app.js` with the following content:
   ```js
   const express = require('express');
   const app = express();
   const port = process.env.PORT || 3000;

   app.get('/', (req, res) => {
     res.send('Hello from Node.js on Azure App Service!');
   });

   app.listen(port, () => {
     console.log(`App listening at http://localhost:${port}`);
   });
   ```
5. Test the app locally:
   ```sh
   node app.js
   ```
   Visit `http://localhost:3000` in your browser to see your app running.

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
4. Create a web app (Node.js runtime):
   ```sh
   az webapp create --name <unique-app-name> --resource-group MyResourceGroup --plan MyAppServicePlan --runtime "NODE|18-lts"
   ```
   > **Note:** `<unique-app-name>` must be globally unique.

---

## Step 3: Deploy Your App to Azure

1. Zip your application files:
   ```sh
   zip -r MyNodeApp.zip .
   ```
2. Deploy using Azure CLI:
   ```sh
   az webapp deploy --resource-group MyResourceGroup --name <unique-app-name> --src-path MyNodeApp.zip
   ```

---

## Step 4: Verify Your Deployment

1. Open your browser and navigate to `https://<unique-app-name>.azurewebsites.net`
2. You should see your Node.js web application live!
3. Have a look in the Azure Portal and see your app and all the options there

---

## Congratulations!
You have successfully created and deployed a Node.js web application to Azure App Service. Explore further by customizing your app or integrating other Azure services!
