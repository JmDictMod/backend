const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json()); // Allow JSON requests

// Database setup
const dbPath = path.join(process.cwd(), "data", "jmdictmod.db");
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
        console.error("Error connecting to database:", err.message);
    } else {
        console.log("Connected to jmdictmod database");
    }
});

// Store tag data
let tagData = {};
let tagIdMap = {};

// Cache setup
const cache = new Map(); // Cache persists for the entire session

// Load tag data from database
async function loadTagData() {
    console.log("Loading tag data...");
    return new Promise((resolve, reject) => {
        db.all("SELECT tag, id, description FROM tag", [], (err, rows) => {
            if (err) {
                console.warn(`Error loading tags: ${err.message}`);
                reject(err);
                return;
            }
            rows.forEach(tag => {
                tagIdMap[tag.tag] = tag.id;
                tagData[tag.tag] = tag.description || tag.tag;
            });
            console.log("Tag data loaded successfully!");
            resolve();
        });
    });
}

// Initialize data on startup
async function initialize() {
    try {
        await loadTagData();
        console.log("All data loaded successfully!");
    } catch (error) {
        console.error("Error during initialization:", error.message);
    }
}

initialize();

// Function to generate cache key
function getCacheKey(query, mode) {
    return `${query}_${mode || 'default'}`;
}

// API endpoint: Search dictionary with integrated furigana support and caching
app.get("/api/search", async (req, res) => {
    const { query, mode } = req.query;
    if (!query) return res.status(400).json({ error: "Query parameter is required" });

    // Check cache first
    const cacheKey = getCacheKey(query, mode);
    const cachedResult = cache.get(cacheKey);
    if (cachedResult) {
        console.log(`Cache hit for: ${cacheKey}`);
        return res.json(cachedResult);
    }

    // Process search
    let searchTerm = query;
    let tagFilter = null;
    let tagOnlySearch = false;
    let frequencyFilter = null;

    // Handle frequency filter
    if (query.startsWith("#frq")) {
        frequencyFilter = parseInt(query.substring(4).trim());
        if (isNaN(frequencyFilter)) {
            return res.status(400).json({ error: "Invalid frequency value" });
        }
        tagOnlySearch = true;
    } else if (query.startsWith("#")) {
        tagFilter = query.substring(1).trim();
        tagOnlySearch = true;
    } else if (query.includes(" #")) {
        const parts = query.split(" #");
        searchTerm = parts[0].trim();
        if (parts[1].startsWith("frq")) {
            frequencyFilter = parseInt(parts[1].substring(3).trim());
            if (isNaN(frequencyFilter)) {
                return res.status(400).json({ error: "Invalid frequency value" });
            }
        } else {
            tagFilter = parts[1].trim();
        }
    }

    // Build SQL query
    let sql = `SELECT t, r, m, f, o, g, l FROM vocab_dictionary WHERE `;
    let params = [];
    
    if (frequencyFilter !== null) {
        sql += `o = ?`;
        params.push(frequencyFilter);
    } else if (tagOnlySearch) {
        if (!tagIdMap[tagFilter]) {
            return res.json({ totalResults: 0, results: [] });
        }
        sql += `l LIKE ?`;
        params.push(`%${tagIdMap[tagFilter]}%`);
    } else {
        if (mode === "exact") {
            sql += `(t = ? OR r = ?)`;
            params.push(searchTerm, searchTerm);
        } else if (mode === "any") {
            sql += `(t LIKE ? OR r LIKE ?)`;
            params.push(`%${searchTerm}%`, `%${searchTerm}%`);
        } else if (mode === "both") {
            const [kanji, reading] = searchTerm.split(",");
            sql += `t = ? AND r = ?`;
            params.push(kanji, reading);
        } else if (mode === "en_exact") {
            sql += `json_extract(m, '$') LIKE ?`;
            params.push(`%${searchTerm}%`);
        } else if (mode === "en_any") {
            sql += `json_extract(m, '$') LIKE ?`;
            params.push(`%${searchTerm}%`);
        }

        if (tagFilter && !tagOnlySearch) {
            if (!tagIdMap[tagFilter]) {
                return res.json({ totalResults: 0, results: [] });
            }
            sql += ` AND l LIKE ?`;
            params.push(`%${tagIdMap[tagFilter]}%`);
        }
    }

    sql += ` ORDER BY o DESC`;

    // Execute query
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error("Query error:", err.message);
            return res.status(500).json({ error: "Database query error" });
        }

        const formattedResults = rows.map(row => ({
            t: row.t,
            r: row.r,
            m: JSON.parse(row.m),
            f: JSON.parse(row.f),
            l: row.l,
            o: row.o,
            g: row.g
        }));

        const response = {
            totalResults: formattedResults.length,
            results: formattedResults
        };

        // Store in cache indefinitely
        cache.set(cacheKey, response);
        console.log(`Cache miss - stored result for: ${cacheKey}`);

        res.json(response);
    });
});

// Define an example API endpoint
app.get("/api/test", (req, res) => {
    res.json({ message: "Server is working on Vercel!" });
});

// Close database connection on process termination
process.on("SIGINT", () => {
    db.close((err) => {
        if (err) {
            console.error("Error closing database:", err.message);
        }
        console.log("Database connection closed");
        process.exit(0);
    });
});

// Export the app (Important for Vercel)
module.exports = app;