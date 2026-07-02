# API Mock Server 🚀

A high-fidelity, developer-focused API mock server and request logger. Create sandboxed mock environments, define custom REST endpoints, simulate realistic network latencies, configure custom response headers, and view detailed request payloads with a live request logger—all in a beautiful, high-contrast dark interface.

---

## 🌟 Key Features

*   **Multi-Environment Support**: Group mock endpoints into isolated environments (e.g., Development, Staging, v1 API) with customizable base prefixes.
*   **Flexible Mock Routes**: Define paths supporting dynamic parameters (e.g., `/users/:id`), choose HTTP methods (GET, POST, PUT, DELETE, etc.), status codes, and manage response bodies.
*   **Simulated Network Latency**: Add simulated response delays (milliseconds) to test how your frontends handle loading states or timeouts.
*   **Live Request Logger**: Capture real-time incoming traffic. Drill down into client IP addresses, matched mock configurations, complete request headers, query parameters, and raw JSON request bodies.
*   **Full-Stack Power**: Features an Express-based Node.js backend acting as the mock-proxy/request interceptor and a sleek React 18 single-page application frontend built with Vite and Tailwind CSS.
*   **Persistent Configuration**: Integrated with robust storage backing to preserve environments and logs reliably.

---

## 🛠️ Tech Stack

*   **Frontend**: React 18, Vite, Tailwind CSS, Lucide Icons, Framer Motion
*   **Backend**: Node.js, Express, tsx (for TS development), esbuild (for production optimization)

---

## 🚀 Local Setup Guide

Follow these steps to run the API Mock Server on your local machine:

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) (v18 or higher) and `npm` installed.

### 2. Install Dependencies
Clone the repository, navigate to the root directory, and run:
```bash
npm install
```

### 3. Run Development Server
Start the client and server concurrently:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Build for Production
To bundle the frontend application and compile the server:
```bash
npm run build
npm start
```

---

## ☁️ How to Deploy (FREE Platforms)

Since this app uses a full-stack **Express backend** (to handle routing, wildcard matching, and request logging), traditional static hosts like Vercel or Netlify won't support it out of the box. Instead, you can deploy it for **100% free** on these container-hosting platforms:

### Option A: Render (Recommended & Free)
[Render](https://render.com/) offers a generous free tier for Web Services.
1. Connect your GitHub repository to Render.
2. Create a new **Web Service**.
3. Configure the following build settings:
   *   **Runtime**: `Node`
   *   **Build Command**: `npm install && npm run build`
   *   **Start Command**: `npm start`
4. Set the environment variable `PORT=3000` (Render will bind correctly, or automatically handle ingress).
5. Deploy! Your app will go live with an `onrender.com` URL.

### Option B: Railway (Fastest Setup)
[Railway](https://railway.app/) offers quick, zero-config deployments.
1. Create an account and start a new project.
2. Connect your GitHub repo.
3. Railway will automatically detect the `package.json` file. It will build and run the project using `npm run build` and `npm start`.
4. Your service will be online in seconds with a free custom subdomain.

### Option C: Fly.io (High Performance)
[Fly.io](https://fly.io/) lets you run apps globally on small micro-VMs.
1. Install the `flyctl` CLI.
2. Run `fly launch` in your project folder.
3. Fly.io will automatically scan the project, create a `Dockerfile` if needed, and host your full-stack app on their free allowance tier.
