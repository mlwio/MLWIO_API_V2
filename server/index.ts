import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, serveStatic, log } from "./vite";
import "dotenv/config";

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: true, // Allow all origins in development, configure for production
  credentials: true, // Allow cookies to be sent with requests
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Extend Express Request to carry rawBody captured in JSON verify
declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

// ✅ Parse JSON body safely
app.use(
  express.json({
    verify: (req: Request, _res: Response, buf: Buffer) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.urlencoded({ extended: false }));

// ✅ Upload-only logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: any;

  const originalResJson = res.json.bind(res) as (body?: any) => Response;
  res.json = function (bodyJson: any): Response {
    capturedJsonResponse = bodyJson;
    return originalResJson(bodyJson);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.method === "POST" && path === "/api/content" && res.statusCode === 200) {
      if (capturedJsonResponse && capturedJsonResponse.title) {
        log(`✅ New upload: ${capturedJsonResponse.title}`);
      }
    }
  });

  next();
});

// ✅ Wrap async function cleanly (no IIFE confusion)
async function startServer() {
  try {
    const server = await registerRoutes(app);

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      const status = err.status || err.statusCode || 500;
      const message = err.message || "Internal Server Error";
      res.status(status).json({ message });
      console.error("Server Error:", err);
    });

    // ✅ Setup vite or static serve
    if (app.get("env") === "development") {
      await setupVite(app, server);
    } else {
      serveStatic(app);
    }

    // ✅ Use correct host & port
    const port = parseInt(process.env.PORT || "5000", 10);
    const host = process.env.HOST || "0.0.0.0";

server.listen(port, host, () => {
  log(`✅ Server running on http://${host}:${port}`);
});

  } catch (err) {
    console.error("❌ Failed to start server:", err);
    process.exit(1);
  }
}

startServer();
