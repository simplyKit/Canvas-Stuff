require('dotenv').config(); // Use an older version for this otherwise it'll basically advertise in the terminal.
const { getGrades } = require('./canvas.js');
const { displayGrades } = require('./ui.js');

async function main() {
  const token = process.env.CANVAS_API_KEY;

  if (!token || token=="") {
    throw new Error("Error: The CANVAS_API_KEY is not set in your .env file.");
  }

  try {
    const grades = await getGrades(token);
    displayGrades(grades);
  } catch (error) {
    console.error("An error occurred:", error && error.message ? error.message : error);
    process.exit(1);
  }
}

main();