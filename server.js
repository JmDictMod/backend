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
let furiganaData = {};
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

    // Load tag_bank_1.json for tag descriptions
    const tagJson = loadJSON(path.join(dataPath, "tag_bank_1.json"));
    if (tagJson) {
        tagJson.forEach(tag => {
            tagData[tag[0]] = tag[3];
        });
    }

    // Load tagbank.json for tag ID mapping
    const tagBankJson = loadJSON(path.join(dataPath, "tagbank.json"));
    if (tagBankJson) {
        tagBankJson.forEach(tag => {
            tagIdMap[tag.tag] = tag.id;
        });
    }

    // Load furigana data
    const furiganaJson = loadJSON(path.join(dataPath, "furigana.json"));
    if (furiganaJson) {
        furiganaJson.forEach(entry => {
            if (!furiganaData[entry.text]) {
                furiganaData[entry.text] = [];
            }
            furiganaData[entry.text].push(entry);
        });
    }

    // Load term data
    for (let i = 1; i <= 29; i++) {
        const filePath = path.join(dataPath, `term_bank_${i}.json`);
        const termData = loadJSON(filePath);
        if (termData) {
            dictionaryData = dictionaryData.concat(termData);
        }
    }
    console.log("All data loaded successfully!");
}

// Initialize data on startup
loadData();

// Function to find furigana entry for a term + reading
function findFurigana(term, reading) {
    if (furiganaData[term]) {
        const furiganaEntry = furiganaData[term].find(f => f.reading === reading);
        return furiganaEntry ? furiganaEntry.furigana : null;
    }
    return null;
}

// Function to extract and map tags to IDs
function getTagDescriptions(posRaw, extraRaw) {
    const tagIds = [];
    const posTags = posRaw ? posRaw.split(" ") : [];
    const extraTags = extraRaw ? extraRaw.split(" ") : [];

    // Collect tag IDs from posTags and extraTags
    [...posTags, ...extraTags].forEach(tag => {
        if (tagData[tag] && tagIdMap[tag]) {
            tagIds.push(tagIdMap[tag]);
        }
    });

    // Return comma-separated string of tag IDs
    return tagIds.join(",");
}

// Function to generate cache key
function getCacheKey(query, mode) {
    return `${query}_${mode || 'default'}`;
}

// API endpoint: Search dictionary with furigana support and caching
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
        let meanings = entry[5] || [];

        // Handle frequency search
        if (frequencyFilter !== null) {
            termMatches = entry[4] === frequencyFilter;
        } else if (tagOnlySearch) {
            const tags = getTagDescriptions(entry[2], entry[7]).split(",");
            termMatches = tags.some(tagId => tagIdMap[tagFilter] && tagId === String(tagIdMap[tagFilter]));
        } else {
            if (mode === "exact") {
                termMatches = entry[0] === searchTerm || entry[1] === searchTerm;
            } else if (mode === "any") {
                termMatches = entry[0].includes(searchTerm) || entry[1].includes(searchTerm);
            } else if (mode === "both") {
                const [kanji, reading] = searchTerm.split(",");
                termMatches = entry[0] === kanji && entry[1] === reading;
            } else if (mode === "en_exact") {
                termMatches = meanings.some(meaning => meaning.toLowerCase() === searchTerm.toLowerCase());
            } else if (mode === "en_any") {
                termMatches = meanings.some(meaning => meaning.toLowerCase().includes(searchTerm.toLowerCase()));
            }
        }

        if (!tagOnlySearch && !frequencyFilter && tagFilter) {
            const tags = getTagDescriptions(entry[2], entry[7]).split(",");
            return termMatches && tags.some(tagId => tagIdMap[tagFilter] && tagId === String(tagIdMap[tagFilter]));
        }
        return termMatches;
    });

    results.sort((a, b) => (b[4] || 0) - (a[4] || 0));

    const formattedResults = results.map(entry => ({
        term: entry[0],
        reading: entry[1],
        meanings: entry[5],
        furigana: findFurigana(entry[0], entry[1]),
        tags: getTagDescriptions(entry[2], entry[7]),
        frequency: entry[4] !== undefined ? String(entry[4]) : "",
        group: String(entry[6]) // Add group field with ID
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