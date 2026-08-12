# UNO No Mercy - Deployment & DevOps Configuration

This repository contains the DevOps and deployment configuration for the **UNO No Mercy** Web-based multiplayer application.

## 🚀 Quick Start (Local Development)

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or v20
- npm v9+

### Commands
```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build production distribution
npm run build

# Run automated tests
npm test
```

---

## 🐳 Docker Deployment

### Run with Docker
```bash
# Build Docker image
docker build -t uno-no-mercy .

# Run container on port 8080
docker run -d -p 8080:80 --name uno-container uno-no-mercy
```

### Run with Docker Compose
```bash
# Launch application container
docker compose up -d

# View logs
docker compose logs -f

# Stop container
docker compose down
```

The application will be accessible at `http://localhost:8080`.

---

## ☁️ Vercel Deployment

1. Connect your GitHub repository to [Vercel](https://vercel.com/).
2. Vercel will automatically detect `vercel.json` and `package.json`.
3. Configuration parameters:
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
4. Deploy with one click or pushed commits to `main`/`master`.

---

## 🔄 GitHub Actions CI/CD

An automated GitHub Actions workflow is located at `.github/workflows/ci-cd.yml`.

### Triggers:
- Pushes to `main` or `master` branch.
- Pull Requests targeting `main` or `master` branch.

### Pipeline Stages:
1. **Build & Test:**
   - Installs dependencies (`npm ci`).
   - Executes tests (`npm test`).
   - Compiles production bundle (`npm run build`).
   - Verifies build artifacts in `dist/`.
   - Uploads build artifact (`dist-build`).
2. **Docker Build Validation:**
   - Validates that the multi-stage Dockerfile builds cleanly without issues.
