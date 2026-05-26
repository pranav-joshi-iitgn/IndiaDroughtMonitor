// Wait for the DOM to fully load
document.addEventListener("DOMContentLoaded", test);

async function loadCSVFromServer(filename) {
    try {
        // 1. Fetch the CSV file hosted "locally" on the GitHub Pages server
        const response = await fetch(filename);
        
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        const csvText = await response.text();

        // 2. Parse the text using PapaParse
        Papa.parse(csvText, {
            header: true,         // Turns rows into objects using the header row
            skipEmptyLines: true, // Prevents errors from blank lines at the end
            complete: function(results) {
                console.log("Successfully loaded data from GitHub Pages:");
                console.log(results.data); 
                
                // You can now pass this data to a function to render it on your page
                displayData(results.data);
            }
        });

    } catch (error) {
        console.error("Failed to fetch the CSV file:", error);
    }
}

function displayData(data) {
    // Example: Print the first item to the webpage
    const output = document.getElementById('db-out');
    if (output && data.length > 0) {
        output.textContent = JSON.stringify(data);
    }
}


async function runQuery(query) {
    try {
        res = await alasql.promise(query);
        console.log("SQL Query Results:", res);
        displayData(res)
        
    } catch (error) {
        console.error("SQL Error:", error);
    }
}

// runDroughtQueries();


function test() {
    query = "SELECT AVG([0]) FROM csv('./data/Current_CDI.txt', {headers:false, separator: ' '}) where [0]!='NaN'";
    // loadCSVFromServer('./data/Current_CDI.txt')
    runQuery(query);
}