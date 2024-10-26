// ==UserScript==
// @name         Replace Rezensionsstatus with ETV
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Replace "Rezensionsstatus" column with ETV values from localStorage using Dexie.js
// @author       You
// @match        *://www.amazon.de/*
// @require      https://unpkg.com/dexie@latest/dist/dexie.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';
    
    // Initialize Dexie database
    const db = new Dexie('myDatabase');
    db.version(1).stores({
        keyValuePairs: 'key'
    });
    
    async function setValue(key, value) {
        await db.keyValuePairs.put({ key, value });
        console.log(`Stored ${key}: ${value}`);
    }
    
    async function getValue(key, defaultValue = null) {
        const result = await db.keyValuePairs.get(key);
        return result ? result.value : defaultValue;
    }
    
    async function listValues() {
        try {
            return (await db.keyValuePairs.toCollection().primaryKeys());
        } catch (error) {
            console.error("Error listing values:", error);
            return [];
        }
    }
    
    async function load_all_asin_etv_values_from_storage() {
        // Fetch all keys stored by Dexie
        let keys = await listValues();
        
        // Filter keys that start with "ASIN_"
        let asinKeys = keys.filter(key => key.startsWith("ASIN_"));
        
        let asinData = [];
        for (let asinKey of asinKeys) {
            let asin = asinKey.replace("ASIN_", ""); // Extract ASIN from key
            let jsonData = await getValue(asinKey);     // Retrieve stored JSON data
            
            // Parse JSON data if it exists
            let parsedData = jsonData ? JSON.parse(jsonData) : {};
            asinData.push({
                ...parsedData,  // Include any existing keys from stored JSON
                ASIN: asin      // Add ASIN key
            });
        };
        
        return asinData;
    }
    
    // Function to extract ASIN from the link
    function extractASINFromLink(link) {
        const url = new URL(link);
        return url.pathname.split('/')[2];
    }
    
    function replaceRezensionsstatusHeader() {
        const rezensionsstatusHeader = document.querySelector('th#vvp-reviews-table--review-content-heading');
        if (rezensionsstatusHeader) {
            rezensionsstatusHeader.textContent = 'ETV'; // Replace the text with "ETV"
        }
    }
    // Main function to replace "Noch nicht rezensiert" with ETV in each row
    async function replaceRezensionsstatusWithETV() {
        // Replace the header first
        replaceRezensionsstatusHeader();
        
        // Load stored ETV values
        const etvData = await load_all_asin_etv_values_from_storage();
        
        // Find all rows in the reviews table
        const rows = document.querySelectorAll('.vvp-reviews-table--row');
        
        // Iterate through each row and modify the column
        rows.forEach(async row => {
            const productLink = row.querySelector('a.a-link-normal');
            const rezensionsstatusCell = row.querySelector('td:nth-child(4)'); // Assuming this is the "Rezensionsstatus" column
            
            if (productLink && rezensionsstatusCell) {
                // Check if the column text is exactly "Noch nicht rezensiert"
                if (rezensionsstatusCell.textContent.trim() === 'Noch nicht rezensiert') {
                    const asin = extractASINFromLink(productLink.href);
                    
                    // Find the corresponding ETV value for this ASIN
                    const etvEntry = etvData.find(entry => entry.ASIN === asin);
                    if (etvEntry && etvEntry.etv !== undefined && etvEntry.etv !== null) {
                        rezensionsstatusCell.textContent = `${etvEntry.etv}€`;
                    } else {
                        rezensionsstatusCell.textContent = 'ETV: N/A'; // If no ETV data is found
                    }
                }
            }
        });
    }
    
    // Run the script when the page loads
    window.addEventListener('load', replaceRezensionsstatusWithETV);
    
})();
