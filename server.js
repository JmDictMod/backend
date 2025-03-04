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
    // Get correct path for Vercel (use process.cwd())
    const dataPath = path.join(process.cwd(), "data");
    // Load Part-of-Speech (POS) and extra tags
    const tagJson = loadJSON(path.join(dataPath, "tag_bank_1.json"));
    if (tagJson) {
        tagJson.forEach(tag => {
            tagData[tag[0]] = tag[3]; // Store tag descriptions
        });
    }
    // Load furigana dictionary
    const furiganaJson = loadJSON(path.join(dataPath, "furigana.json"));
    if (furiganaJson) {
        furiganaJson.forEach(entry => {
            if (!furiganaData[entry.text]) {
                furiganaData[entry.text] = [];
            }
            furiganaData[entry.text].push(entry);
        });
    }
    // Load dictionary data (term_bank_1.json to term_bank_29.json)
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
// Function to extract and map tags
function getTagDescriptions(posRaw, extraRaw) {
    const tags = [];
    const posTags = posRaw ? posRaw.split(" ") : [];
    const extraTags = extraRaw ? extraRaw.split(" ") : [];
    posTags.forEach(tag => {
        if (tagData[tag]) tags.push({ tag, description: tagData[tag] });
    });
    extraTags.forEach(tag => {
        if (tagData[tag]) tags.push({ tag, description: tagData[tag] });
    });
    return tags;
}
// API endpoint: Search dictionary with furigana support
app.get("/api/search", (req, res) => {
    const { query, mode } = req.query;
    if (!query) return res.status(400).json({ error: "Query parameter is required" });
    let searchTerm = query;
    let tagFilter = null;
    let tagOnlySearch = false;
    if (query.startsWith("#")) {
        tagFilter = query.substring(1).trim();
        tagOnlySearch = true;
    } else if (query.includes(" #")) {
        const parts = query.split(" #");
        searchTerm = parts[0].trim();
        tagFilter = parts[1].trim();
    }
    let results = dictionaryData.filter(entry => {
        let termMatches = false;
        let meanings = entry[5] || [];
        if (tagOnlySearch) {
            const tags = getTagDescriptions(entry[2], entry[7]);
            termMatches = tags.some(tag => tag.tag === tagFilter);
        } else {
            if (mode === "exact") {
                termMatches = entry[0] === searchTerm || entry[1] === searchTerm;
            } else if (mode === "any") {
                termMatches = entry[0].includes(searchTerm) || entry[1].includes(searchTerm);
            } else if (mode === "both") {
                const [kanji, reading] = searchTerm.split(",");
                termMatches = entry[0] === kanji && entry[1] === reading;
            } else if (mode === "en_exact") {
                // Convert both search term and meanings to lowercase
                termMatches = meanings.some(meaning => meaning.toLowerCase() === searchTerm.toLowerCase());
            } else if (mode === "en_any") {
                // Convert both search term and meanings to lowercase
                termMatches = meanings.some(meaning => meaning.toLowerCase().includes(searchTerm.toLowerCase()));
            }
        }
        if (!tagOnlySearch && tagFilter) {
            const tags = getTagDescriptions(entry[2], entry[7]);
            return termMatches && tags.some(tag => tag.tag === tagFilter);
        }
        return termMatches;
    });
    let groupedResults = {};
    results.forEach(entry => {
        let termKey = `${entry[0]}_${entry[1]}`;
        if (!groupedResults[termKey]) {
            const tags = getTagDescriptions(entry[2], entry[7]);
            groupedResults[termKey] = {
                term: entry[0],
                reading: entry[1],
                meanings: [],
                furigana: findFurigana(entry[0], entry[1]),
                tags: tags
            };
        }
        groupedResults[termKey].meanings.push(...entry[5]);
    });
    res.json({
        totalResults: Object.values(groupedResults).length,
        results: Object.values(groupedResults)
    });
});
// Define an example API endpoint
app.get("/api/test", (req, res) => {
    res.json({ message: "Server is working on Vercel!" });
});
// Export the app (Important for Vercel)
module.exports = app;