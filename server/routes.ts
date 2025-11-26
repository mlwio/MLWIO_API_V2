/// <reference types="node" />
import { createServer, type Server } from "node:http";
import { storage } from "./storage";
import session from "express-session";
import MongoStore from "connect-mongo";
import { insertContentItemSchema } from "@shared/schema";
import { fromZodError } from "zod-validation-error";

// Note: avoid TS module augmentation for express-session in this file to
// reduce type resolution errors in environments lacking type packages.

// Alist Configuration
const ALIST_API_URL = process.env.ALIST_API_URL || "https://drive.movieway.site";
const ALIST_TOKEN = process.env.ALIST_TOKEN;

// Helper function to get signed link from Alist
async function getAlistSignedLink(path: string): Promise<string> {
  // Extract path from Alist URLs (https://drive.movieway.site/GD01/... -> /GD01/...)
  let alistPath = path;
  if (path.includes('drive.movieway.site') || path.includes('alist')) {
    try {
      const url = new URL(path);
      alistPath = decodeURIComponent(url.pathname);
      console.log(`📝 Extracted Alist path: ${alistPath} from URL: ${path}`);
    } catch (error) {
      console.error("❌ Error parsing Alist URL:", error);
      return path;
    }
  } else if (path.startsWith("http://") || path.startsWith("https://")) {
    // Non-Alist full URLs (like Google Drive), return as is
    return path;
  } else {
    // Decode URL-encoded paths like /GD01/MOVIE/Spider%20Man%201.mp4
    alistPath = decodeURIComponent(alistPath);
  }

  // If it's an Alist path (like /GD01/...), fetch signed link
  if (!ALIST_TOKEN) {
    console.warn("⚠️ ALIST_TOKEN not configured, returning original path");
    return alistPath;
  }

  try {
    const response = await fetch(`${ALIST_API_URL}/api/fs/get`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": ALIST_TOKEN,
      },
      body: JSON.stringify({
        path: alistPath,
        password: "",
      }),
    });

    if (!response.ok) {
      console.error(`❌ Alist API error: ${response.status} ${response.statusText}`);
      return alistPath;
    }

    const data = await response.json();

    // 👇 DEBUG LOG START: Alist এরর দেখার জন্য এই অংশ যোগ করা হয়েছে 👇
    if (!data?.data?.raw_url) {
       console.log("❌ Alist API Error Detail:", JSON.stringify(data, null, 2));
    }
    // 👆 DEBUG LOG END 👆

    if (data?.data?.raw_url) {
      console.log(`✅ Alist signed link generated for: ${alistPath}`);
      return data.data.raw_url;
    }

    console.warn(`⚠️ No raw_url in Alist response for: ${alistPath}`);
    return alistPath;
  } catch (error) {
    console.error("❌ Error fetching Alist signed link:", error);
    return alistPath;
  }
}

// Process content item to replace Alist paths with signed links
async function enrichItemWithAlist(item: any): Promise<any> {
  if (!item) return item;

  const enriched = { ...item };

  // Replace driveLink
  if (enriched.driveLink) {
    enriched.driveLink = await getAlistSignedLink(enriched.driveLink);
  }

  // Replace thumbnail
  if (enriched.thumbnail) {
    enriched.thumbnail = await getAlistSignedLink(enriched.thumbnail);
  }

  // Replace episodes links in seasons
  if (Array.isArray(enriched.seasons)) {
    enriched.seasons = await Promise.all(
      enriched.seasons.map(async (season: any) => ({
        ...season,
        episodes: await Promise.all(
          (season.episodes || []).map(async (episode: any) => ({
            ...episode,
            link: episode.link ? await getAlistSignedLink(episode.link) : episode.link,
          }))
        ),
      }))
    );
  }

  return enriched;
}

// Converts Google Drive view/open links to direct download links
function normalizeGoogleDriveUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname !== "drive.google.com") return url;

    // Already a direct download style; normalize param order
    if (u.pathname === "/uc") {
      const id = u.searchParams.get("id");
      const exportParam = u.searchParams.get("export");
      if (id && exportParam === "download") {
        return `https://drive.google.com/uc?export=download&id=${id}`;
      }
    }

    // file/d/<id>/view or preview
    const fileMatch = u.pathname.match(/^\/file\/d\/([^/]+)(?:\/|$)/);
    if (fileMatch) {
      const id = fileMatch[1];
      return `https://drive.google.com/uc?export=download&id=${id}`;
    }

    // open?id=<id> or any URL with id param
    const idParam = u.searchParams.get("id");
    if (idParam) {
      return `https://drive.google.com/uc?export=download&id=${idParam}`;
    }

    return url;
  } catch {
    return url;
  }
}

export async function registerRoutes(app: any): Promise<Server> {
  // ✅ Allow cookies over HTTPS (Render fix)
  app.set("trust proxy", 1);

  // Session store configuration
  const sessionStore = process.env.MONGODB_URI
    ? MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        dbName: "mlwio",
        collectionName: "sessions",
        ttl: 60 * 60 * 24 * 7, // 7 days
        autoRemove: "native",
      })
    : undefined;

  console.log(`✅ Session store: ${sessionStore ? 'MongoDB' : 'Memory (MemoryStore)'}`);
  console.log(`✅ Environment: ${process.env.NODE_ENV || 'development'}`);

  // Session middleware
  app.use(
    session({
      secret:
        process.env.SESSION_SECRET || "mlwio-secret-key-change-in-production",
      resave: false,
      saveUninitialized: false,
      store: sessionStore,
      cookie: {
        // ⚠️ HTTP তে চালানোর জন্য secure false করা হলো
        secure: false, 
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
        // ⚠️ secure false হলে sameSite অবশ্যই lax হতে হবে
        sameSite: "lax", 
      },
    })
  );

  // Authentication middleware
  const requireAuth = (req: any, res: any, next: any) => {
    if (!(req as any).session?.userId) {
      console.log(`❌ Unauthorized access attempt`);
      return res.status(401).json({ error: "Unauthorized" });
    }
    next();
  };

  const normalizeItemForResponse = (item: any) => ({
    ...item,
    driveLink: item?.driveLink ? normalizeGoogleDriveUrl(item.driveLink) : undefined,
    seasons: Array.isArray(item?.seasons)
      ? item.seasons.map((s: any) => ({
          ...s,
          episodes: Array.isArray(s?.episodes)
            ? s.episodes.map((e: any) => ({
                ...e,
                link: e?.link ? normalizeGoogleDriveUrl(e.link) : e?.link,
              }))
            : s?.episodes,
        }))
      : item?.seasons,
  });

  // Login endpoint
  app.post("/api/auth/login", async (req: any, res: any) => {
    try {
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password required" });
      }

      const user = await storage.verifyPassword(username, password);

      if (!user) {
        return res.status(401).json({ error: "Wrong password" });
      }

      req.session.userId = user.id;

      console.log(`✅ Login successful - User: ${user.username}`);

      // ✅ Explicitly save session
      req.session.save((err: any) => {
        if (err) {
          console.error("❌ Session save error:", err);
          return res.status(500).json({ error: "Failed to save session" });
        }
        console.log(`✅ Session saved for user: ${user.username}`);
        return res.json({ user: { id: user.id, username: user.username } });
      });
    } catch (error) {
      console.error("Login error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Logout endpoint
  app.post("/api/auth/logout", (req: any, res: any) => {
    req.session.destroy(() => {
      res.json({ success: true });
    });
  });

  // Check auth status
  app.get("/api/auth/me", async (req: any, res: any) => {
    if (!req.session.userId) {
      return res.status(401).json({ error: "Not authenticated" });
    }

    const user = await storage.getUser(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    return res.json({ user: { id: user.id, username: user.username } });
  });

  // Get all content (public endpoint)
  app.get("/api/content", async (req: any, res: any) => {
    try {
      const content = await storage.getAllContent();
      const enriched = await Promise.all(
        content.map(async (item) => await enrichItemWithAlist(normalizeItemForResponse(item)))
      );
      return res.json(enriched);
    } catch (error) {
      console.error("Get content error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Search content (public endpoint) - MUST be before :id route
  app.get("/api/content/search", async (req: any, res: any) => {
    try {
      const { q, category } = req.query;

      if (!q || typeof q !== "string") {
        return res.status(400).json({ error: "Search query required" });
      }

      const content = await storage.searchContent(
        q,
        category && typeof category === "string" ? category : undefined
      );

      const enriched = await Promise.all(
        content.map(async (item) => await enrichItemWithAlist(normalizeItemForResponse(item)))
      );
      return res.json(enriched);
    } catch (error) {
      console.error("Search content error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get content by ID (public endpoint)
  app.get("/api/content/:id", async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const content = await storage.getContentById(id);

      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }

      const enriched = await enrichItemWithAlist(normalizeItemForResponse(content));
      return res.json(enriched);
    } catch (error: any) {
      // Handle invalid MongoDB ObjectId format
      if (error.name === 'CastError' || error.kind === 'ObjectId') {
        return res.status(404).json({ error: "Content not found" });
      }
      console.error("Get content by ID error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create content
  app.post("/api/content", requireAuth, async (req: any, res: any) => {
    try {
      const result = insertContentItemSchema.safeParse(req.body);

      if (!result.success) {
        const validationError = fromZodError(result.error);
        return res.status(400).json({ error: validationError.message });
      }

      // Normalize Google Drive links before saving
      const data = result.data;
      const normalizedData = {
        ...data,
        driveLink: data.driveLink ? normalizeGoogleDriveUrl(data.driveLink) : undefined,
        seasons: data.seasons
          ? data.seasons.map((s) => ({
              ...s,
              episodes: s.episodes.map((e) => ({
                ...e,
                link: normalizeGoogleDriveUrl(e.link),
              })),
            }))
          : undefined,
      };

      const content = await storage.createContent(normalizedData);
      
      await storage.createUploadLog({ contentTitle: content.title });
      
      return res.json(content);
    } catch (error) {
      console.error("Create content error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Update content
  app.put("/api/content/:id", requireAuth, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const result = insertContentItemSchema.safeParse(req.body);

      if (!result.success) {
        const validationError = fromZodError(result.error);
        return res.status(400).json({ error: validationError.message });
      }

      // Normalize Google Drive links before updating
      const data = result.data;
      const normalizedData = {
        ...data,
        driveLink: data.driveLink ? normalizeGoogleDriveUrl(data.driveLink) : undefined,
        seasons: data.seasons
          ? data.seasons.map((s) => ({
              ...s,
              episodes: s.episodes.map((e) => ({
                ...e,
                link: normalizeGoogleDriveUrl(e.link),
              })),
            }))
          : undefined,
      };

      const content = await storage.updateContent(id, normalizedData);

      if (!content) {
        return res.status(404).json({ error: "Content not found" });
      }

      return res.json(content);
    } catch (error) {
      console.error("Update content error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Fix Alist paths migration (admin only)
  app.post("/api/admin/fix-alist-paths", requireAuth, async (req: any, res: any) => {
    try {
      console.log("🔧 Starting Alist path migration...");
      const result = await storage.fixAlistPaths();
      console.log(`✅ Migration complete: ${result.updated} paths updated`);
      
      if (result.errors.length > 0) {
        console.error("⚠️ Errors during migration:", result.errors);
      }

      return res.json({
        success: true,
        updated: result.updated,
        errors: result.errors,
      });
    } catch (error: any) {
      console.error("❌ Migration error:", error);
      return res.status(500).json({ error: error.message });
    }
  });

  // Delete content
  app.delete("/api/content/:id", requireAuth, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const { username, password } = req.body;

      if (!username || !password) {
        return res
          .status(400)
          .json({ error: "Username and password required" });
      }

      const user = await storage.verifyPassword(username, password);

      if (!user) {
        return res.status(401).json({ error: "Wrong password" });
      }

      const deleted = await storage.deleteContent(id);

      if (!deleted) {
        return res.status(404).json({ error: "Content not found" });
      }

      return res.json({ success: true, message: "Content deleted successfully" });
    } catch (error) {
      console.error("Delete content error:", error);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // Download endpoint - redirects to signed link to save bandwidth
  app.get("/api/download", async (req: any, res: any) => {
    try {
      const { url } = req.query;

      if (!url || typeof url !== "string") {
        return res.status(400).json({ error: "Download URL required" });
      }

      console.log(`✅ Download requested for URL: ${url}`);

      // If it's an Alist path (starts with /), get signed link and redirect
      if (url.startsWith("/")) {
        const signedUrl = await getAlistSignedLink(url);
        console.log(`✅ Redirecting to Alist signed link: ${signedUrl}`);
        return res.redirect(signedUrl);
      }

      // For all other URLs (including Google Drive), redirect directly
      // The URL should already be properly formatted from enrichItemWithAlist
      console.log(`✅ Redirecting to direct download URL: ${url}`);
      return res.redirect(url);
    } catch (error) {
      console.error("Download error:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Download failed" });
      }
    }
  });

  // Health check endpoint - verifies app responds to requests
  app.get("/api/health", (req: any, res: any) => {
    return res.json({ 
      status: "ok", 
      timestamp: new Date().toISOString(),
      service: "MLWIO API",
      endpoints: {
        auth: "/api/auth/login",
        content: "/api/content",
        download: "/api/download"
      }
    });
  });

  const httpServer = createServer(app);

  return httpServer;
}