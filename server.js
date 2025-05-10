const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const app = express();
app.use(cors());
app.use(express.json()); // Allow JSON requests

// Store loaded data
let dictionaryData = [];
let tagData = {};
let tagIdMap = {}; // Mapping of tag names to tagbank.json IDs

// Cache setup
const cache = new Map(); // Cache persists for the entire session

// Function to load JSON files safely
function loadJSON(filePath) {
    try {
        const data = fs.readFileSync(filePath, "utf8");
        return JSON.parse(data.replace(/^\uFEFF/, "")); // Remove BOM if present
    } catch (error) {
        console.warn(`Skipping file: ${filePath} - ${error.message}`);
        return null;
    }
}

// Load all JSON data
function loadData() {
    console.log("Loading JMdict data...");
    const dataPath = path.join(process.cwd(), "data");

    // Load tagbank.json for tag ID mapping and descriptions
    const tagBankJson = loadJSON(path.join(dataPath, "tagbank.json"));
    if (tagBankJson) {
        tagBankJson.forEach(tag => {
            tagIdMap[tag.tag] = tag.id;
            tagData[tag.tag] = tag.description || tag.tag; // Use description if available
        });
    }

    // Load jmdictmod.json
    const jmdictModJson = loadJSON(path.join(dataPath, "jmdictmod.json"));
    if (jmdictModJson) {
        dictionaryData = jmdictModJson;
    }

    console.log("All data loaded successfully!");
}

// Initialize data on startup
loadData();

// Function to generate cache key
function getCacheKey(query, mode) {
    return `${query}_${mode || 'default'}`;
}

// API endpoint: Search dictionary with integrated furigana support and caching
app.get("/api/search", (req, res) => {
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

    let results = dictionaryData.filter(entry => {
        let termMatches = false;
        let meanings = entry.m || []; // Updated to use 'm' for meanings

        // Handle frequency search
        if (frequencyFilter !== null) {
            termMatches = parseInt(entry.o) === frequencyFilter; // Updated to use 'o' for frequency
        } else if (tagOnlySearch) {
            const tags = entry.l.split(","); // Updated to use 'l' for tags
            termMatches = tags.some(tagId => tagIdMap[tagFilter] && tagId === String(tagIdMap[tagFilter]));
        } else {
            if (mode === "exact") {
                termMatches = entry.t === searchTerm || entry.r === searchTerm; // Updated to use 't' and 'r'
            } else if (mode === "any") {
                termMatches = entry.t.includes(searchTerm) || entry.r.includes(searchTerm); // Updated to use 't' and 'r'
            } else if (mode === "both") {
                const [kanji, reading] = searchTerm.split(",");
                termMatches = entry.t === kanji && entry.r === reading; // Updated to use 't' and 'r'
            } else if (mode === "en_exact") {
                termMatches = meanings.some(meaning => meaning.toLowerCase() === searchTerm.toLowerCase());
            } else if (mode === "en_any") {
                termMatches = meanings.some(meaning => meaning.toLowerCase().includes(searchTerm.toLowerCase()));
            }
        }

        if (!tagOnlySearch && !frequencyFilter && tagFilter) {
            const tags = entry.l.split(","); // Updated to use 'l' for tags
            return termMatches && tags.some(tagId => tagIdMap[tagFilter] && tagId === String(tagIdMap[tagFilter]));
        }
        return termMatches;
    });

    results.sort((a, b) => (parseInt(b.o) || 0) - (parseInt(a.o) || 0)); // Updated to use 'o' for frequency

    const formattedResults = results.map(entry => ({
        t: entry.t, // Updated field names
        r: entry.r,
        m: entry.m,
        f: entry.f,
        l: entry.l,
        o: entry.o,
        g: entry.g
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

// Define an example API endpoint
app.get("/api/test", (req, res) => {
    res.json({ message: "Server is working on Vercel!" });
});

// Export the app (Important for Vercel)
module.exports = app;