# Lab: Using Configuration Settings in Azure App Service (C#)

In this lab, you'll learn how to use configuration settings (`appsettings.json`) in an ASP.NET Core web application and override them using Azure App Service Application Settings. This is a common scenario for managing secrets, connection strings, and environment-specific values.

---

## Prerequisites
- Complete the C# web app lab in the [`app-services`](../app-services/csharp-webapp-lab.md) folder
- Azure CLI installed
- An active Azure subscription

---

## Step 1: Add a Custom Setting to appsettings.json

1. Open your C# web app project.
2. In `appsettings.json`, add a custom setting:
   ```json
   {
     "MyCustomSetting": "Hello from appsettings.json!"
     // ...existing settings...
   }
   ```
3. In your `Startup.cs` or `Program.cs`, read the setting:
   ```csharp
   var mySetting = builder.Configuration["MyCustomSetting"];
   app.MapGet("/show-setting", () => $"Setting value: {mySetting}");
   ```
   > This will expose the setting at `/show-setting` in your web app.

---

## Step 2: Deploy Your App to Azure App Service

1. Publish your app:
   ```sh
   dotnet publish -c Release -o ./publish
   ```
2. Deploy to Azure (replace `<unique-app-name>` and resource group as needed):
   ```sh
   az webapp deploy --resource-group MyResourceGroup --name <unique-app-name> --src-path ./publish
   ```

---

## Step 3: Test the Default Setting

1. Open your browser and navigate to:
   ```
   https://<unique-app-name>.azurewebsites.net/show-setting
   ```
2. You should see:
   ```
   Setting value: Hello from appsettings.json!
   ```

---

## Step 4: Override the Setting in Azure Portal

1. Go to the [Azure Portal](https://portal.azure.com/).
2. Navigate to your App Service > **Configuration** > **Application settings**.
3. Add a new setting:
   - Name: `MyCustomSetting`
   - Value: `Hello from Azure App Service!`
4. Click **Save** and restart your web app.

---

## Step 5: Verify the Overridden Setting

1. Refresh your browser at:
   ```
   https://<unique-app-name>.azurewebsites.net/show-setting
   ```
2. You should now see:
   ```
   Setting value: Hello from Azure App Service!
   ```

---

## Best Practices & Tips
- Use Azure App Service Application Settings for secrets and environment-specific values
- Never store secrets in source code
- Use Key Vault for sensitive data in production

---

## Congratulations!
You have successfully overridden configuration settings in Azure App Service. Try adding more settings. 

--- 

## Additional steps
You can combine this lab with the steps you took in the [deployment-slots](../deployment-slots/deployment-slots-lab.md) lab. 
Check the options there to store different values for your configuration setting for each deployment slot.