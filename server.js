const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const app = express();
const PORT = 5000;
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
    // Load Part-of-Speech (POS) and extra tags
    const tagJson = loadJSON(path.join(__dirname, "data", "tag_bank_1.json"));
    if (tagJson) {
        tagJson.forEach(tag => {
            tagData[tag[0]] = tag[3]; // Store tag descriptions
        });
    }
    // Load furigana dictionary (supports multiple readings)
    const furiganaJson = loadJSON(path.join(__dirname, "data", "furigana.json"));
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
        const filePath = path.join(__dirname, "data", `term_bank_${i}.json`);
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
        if (furiganaEntry) {
            return furiganaEntry.furigana; // Return only the furigana array
        }
    }
    return null;
}
// Function to extract and map tags from posRaw and extraRaw
function getTagDescriptions(posRaw, extraRaw) {
    const tags = [];
    // Split posRaw and extraRaw into individual tags
    const posTags = posRaw ? posRaw.split(" ") : [];
    const extraTags = extraRaw ? extraRaw.split(" ") : [];
    // Map each tag to its description (if found in tagData)
    posTags.forEach(tag => {
        if (tagData[tag]) {
            tags.push({ tag, description: tagData[tag] });
        }
    });
    extraTags.forEach(tag => {
        if (tagData[tag]) {
            tags.push({ tag, description: tagData[tag] });
        }
    });
    return tags;
}
// API endpoint: Search dictionary with furigana support
app.get("/api/search", (req, res) => {
    const { query, mode } = req.query;
    if (!query) {
        return res.status(400).json({ error: "Query parameter is required" });
    }
    let searchTerm = query;
    let tagFilter = null;
    let tagOnlySearch = false;
    // Check if the query is for a tag-only search
    if (query.startsWith("#")) {
        tagFilter = query.substring(1).trim();
        tagOnlySearch = true;
    } 
    // Check if the query contains a tag filter
    else if (query.includes(" #")) {
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
                termMatches = meanings.some(meaning => meaning === searchTerm);
            } else if (mode === "en_any") {
                termMatches = meanings.some(meaning => meaning.includes(searchTerm));
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
        let termKey = `${entry[0]}_${entry[1]}`; // Unique key based on term + reading
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
    const finalResults = Object.values(groupedResults);
    // Prepare the response
    const response = {
        totalResults: finalResults.length,
        results: finalResults
    };
    res.json(response);
});
// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});