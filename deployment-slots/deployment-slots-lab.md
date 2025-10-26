# Lab: Using Deployment Slots with Azure App Service

In this lab, you'll extend your web application from the `app-services` lab and learn how to use deployment slots in Azure App Service. Deployment slots allow you to safely test new versions of your app before swapping them into production.

---

## Prerequisites
- Complete the C# or Node.js web app lab in the `app-services` folder
- Azure CLI installed
- An active Azure subscription

---

## Step 1: Understand Deployment Slots
Deployment slots are live environments within your App Service. Common slots:
- **Production** (default)
- **Staging** (for testing)
- **Custom** (e.g., dev, QA)

You can deploy your app to a slot, test it, and swap it with production when ready.

---

## Step 2: Create a Staging Deployment Slot

1. Open your terminal and log in to Azure:
   ```sh
   az login
   ```
2. Set variables for your resource group and app name:
   ```sh
   RESOURCE_GROUP=MyResourceGroup
   APP_NAME=<your-app-name>
   SLOT_NAME=staging
   ```
3. Create a staging slot:
   ```sh
   az webapp deployment slot create --resource-group $RESOURCE_GROUP --name $APP_NAME --slot $SLOT_NAME
   ```

---

## Step 3: Deploy to the Staging Slot

1. Publish your app (C#):
   ```sh
   dotnet publish -c Release -o ./publish
   ```
   Or for Node.js, zip your app:
   ```sh
   zip -r MyNodeApp.zip .
   ```
2. Deploy to the staging slot:
   - For C#:
     ```sh
     az webapp deploy --resource-group $RESOURCE_GROUP --name $APP_NAME --slot $SLOT_NAME --src-path ./publish
     ```
   - For Node.js:
     ```sh
     az webapp deploy --resource-group $RESOURCE_GROUP --name $APP_NAME --slot $SLOT_NAME --src-path MyNodeApp.zip
     ```

---

## Step 4: Test Your Staging Slot

1. Make a change in the app

2. Access your staging slot in the browser:
   ```
   https://<your-app-name>-staging.azurewebsites.net
   ```
3. Verify your changes and test new features safely.

---

## Step 5: Swap Slots (Promote to Production)

1. When ready, swap staging with production:
   ```sh
   az webapp deployment slot swap --resource-group $RESOURCE_GROUP --name $APP_NAME --slot $SLOT_NAME
   ```
2. Your staging app is now live in production, and the previous production version is moved to the staging slot.

---

## Step 6: Clean Up (Optional)

Delete the staging slot if no longer needed:
```sh
az webapp deployment slot delete --resource-group $RESOURCE_GROUP --name $APP_NAME --slot $SLOT_NAME
```

---

## Best Practices & Tips
- Use slots for zero-downtime deployments
- Test environment variables and settings per slot
- Automate slot swaps in CI/CD pipelines

---

## Congratulations!
You have successfully used deployment slots in Azure App Service to safely test and promote your web application. Try adding more slots for different environments or integrating with your deployment workflow!
