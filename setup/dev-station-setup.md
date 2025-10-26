# Azure Development Station Setup Guide

Set up your development environment for Azure on Windows or macOS with this step-by-step guide. This will prepare you for building, deploying, and testing cloud applications using the latest tools and emulators.

---

## 1. Install Visual Studio Code
- Download and install [Visual Studio Code](https://code.visualstudio.com/).
- Recommended extensions:
  - Azure Tools
  - C# (if using .NET)
  - Python (if using Python)
  - Docker
  - Azure Functions

---

## 2. Install Node.js
- Download and install [Node.js](https://nodejs.org/) for your operating system.
- Node.js is required for running Azurite, Azure Functions and for JavaScript/TypeScript development.
- Visual Studio Code has excellent support for Node.js development, including debugging, linting, and integrated terminal.
- After installation, verify:
  ```sh
  node --version
  npm --version
  ```

---

## 3. (Optional) Install Visual Studio (Windows only)
- For advanced .NET development, download [Visual Studio](https://visualstudio.microsoft.com/downloads/).
- Choose the Community edition for free.
- Select workloads for Azure, ASP.NET, and web development during installation.

---

## 4. Install Azure CLI
- Download and install the [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli):
  - **Windows:** Use the MSI installer or run in PowerShell:
    ```powershell
    winget install Microsoft.AzureCLI
    ```
  - **macOS:** Use Homebrew:
    ```sh
    brew update && brew install azure-cli
    ```
- Verify installation:
  ```sh
  az --version
  ```

---

## 5. Install Azure Storage Emulator

- **Windows:**
  - Download [Azurite](https://docs.microsoft.com/en-us/azure/storage/common/storage-use-azurite) from the Visual Studio Marketplace or install via npm:
    ```sh
    npm install -g azurite
    ```
- **macOS:**
  - Install via npm:
    ```sh
    npm install -g azurite
    ```
- Azurite can also be installed and managed directly from Visual Studio Code using the Azurite extension.

- Start Azurite:
  ```sh
  azurite
  ```

---

## 5. Install Azure Storage Explorer
- Download and install [Azure Storage Explorer](https://azure.microsoft.com/products/storage/storage-explorer/) for Windows or macOS.
- Use Storage Explorer to manage your Azure Storage accounts, blobs, queues, and tables visually.

---

## 6a. Install Cosmos DB Emulator (Windows only)
- Download and install the [Azure Cosmos DB Emulator](https://learn.microsoft.com/en-us/azure/cosmos-db/local-emulator) for Windows.
- The emulator allows you to develop and test Cosmos DB applications locally.
- After installation, launch the emulator from the Start menu.

## 6b. MacOS
There is no supported version of the emulator. But you could try and run the Linux emulator version in Docker.
[Read more here](https://learn.microsoft.com/en-us/azure/cosmos-db/emulator-linux)

---

## 7. Install Azure Functions Core Tools
- **Windows:**
  ```powershell
  npm install -g azure-functions-core-tools@4 --unsafe-perm true
  ```
- **macOS:**
  ```sh
  npm install -g azure-functions-core-tools@4 --unsafe-perm true
  ```
- Visual Studio Code also has extensions for Azure Functions

- Verify installation:
  ```sh
  func --version
  ```

---

## 8. Install Docker Desktop
- Download and install [Docker Desktop](https://www.docker.com/products/docker-desktop/) for your OS.
- Follow the installation instructions for [Windows](https://docs.docker.com/desktop/install/windows-install/) or [macOS](https://docs.docker.com/desktop/install/mac-install/).
- Verify installation:
  ```sh
  docker --version
  ```

---

## 9. Create a Free Azure Starter Subscription
- Go to [Azure Free Account](https://azure.microsoft.com/free/).
- Sign up with your Microsoft account.
- You get:
  - $200 credit for 30 days
  - Free tier services for 12 months
  - Always-free services

---

## 10. Additional Recommended Tools
- **Git**: Version control ([Download](https://git-scm.com/downloads))
- **.NET SDK**: For C# development ([Download](https://dotnet.microsoft.com/download))
- **Python**: For Python development ([Download](https://www.python.org/downloads/))

---

## 11. Sign In and Verify Setup
- Open a terminal and sign in to Azure:
  ```sh
  az login
  ```
- Test Docker:
  ```sh
  docker run hello-world
  ```
- Test Azurite:
  ```sh
  azurite --location /tmp/azurite
  ```
- Test Azure Functions:
  ```sh
  func --version
  ```

---

## 12. Next Steps
- Install additional Azure extensions in VS Code as needed

---

You're now ready to start developing for Azure on Windows or macOS!
