# Lab: Using WebJobs with Azure App Service (C#)

In this advanced lab, you'll learn how to create and deploy a WebJob to Azure App Service. WebJobs allow you to run background tasks or scheduled jobs alongside your web application.

---

## Prerequisites
- Complete the C# web app lab in the `app-services` folder
- Azure CLI installed
- An active Azure subscription
- Visual Studio or Visual Studio Code

---

## Step 1: Understand WebJobs
WebJobs are background processes that run in the context of an Azure App Service. They can be triggered (on demand, scheduled, or event-based) or run continuously.

---

## Step 2: Create a Simple WebJob Project

1. Open your terminal and create a new .NET Console App:
   ```sh
   dotnet new console -n MyWebJob
   cd MyWebJob
   ```
2. Add code to `Program.cs` to simulate a background task:
   ```csharp
   using System;
   using System.Threading;

   class Program
   {
       static void Main(string[] args)
       {
           Console.WriteLine("WebJob started!");
           for (int i = 0; i < 10; i++)
           {
               Console.WriteLine($"Processing {i+1}/10");
               Thread.Sleep(1000);
           }
           Console.WriteLine("WebJob finished!");
       }
   }
   ```
3. Build the project:
   ```sh
   dotnet build
   ```

---

## Step 3: Prepare the WebJob for Deployment

1. Publish the WebJob to a folder:
   ```sh
   dotnet publish -c Release -o ./publish
   ```
2. Zip the published output:
   ```sh
   cd publish
   zip -r ../MyWebJob.zip .
   cd ..
   ```

---

## Step 4: Deploy the WebJob to Azure App Service

1. Go to the Azure Portal and navigate to your App Service.
2. In the left menu, select **WebJobs** > **Add**.
3. Upload `MyWebJob.zip` as a continuous or triggered WebJob.
4. Name the WebJob and choose the type (Continuous or Triggered).
5. Click **OK** to deploy.

---

## Step 5: Monitor and Test the WebJob

1. In the Azure Portal, view the WebJobs list under your App Service.
2. Start the WebJob (if triggered) and monitor its output/logs.
3. For continuous jobs, check the logs to see the background process running.

---

## Step 6: Clean Up (Optional)

Delete the WebJob from the Azure Portal if no longer needed.

---

## Best Practices & Tips
- Use WebJobs for background processing, scheduled tasks, or integration scenarios
- For advanced scenarios, use the [WebJobs SDK](https://learn.microsoft.com/en-us/azure/app-service/webjobs-sdk-get-started)
- Monitor WebJob health and logs in the Azure Portal
- Consider Azure Functions for serverless background tasks

---

## Congratulations!
You have successfully created and deployed a WebJob to Azure App Service. 