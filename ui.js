function displayGrades(grades) {
  if (!grades || grades.length === 0) {
    console.log("No grades to display for Term 2.");
    return;
  }

  let config;
  try {
    config = require('./config.json');
  } catch (e) {
    config = null;
  }

  const useColor = !!(process.stdout && process.stdout.isTTY);

  const defaultCodes = {
    gray: '\x1b[90m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    white: '\x1b[37m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    magenta: '\x1b[35m',
    blue: '\x1b[34m',
    bright: '\x1b[1m',
    reset: '\x1b[0m'
  };

  const codes = (config && config.colors) ? config.colors : defaultCodes;

  function normalizeAnsi(str) {
    if (typeof str !== 'string') return str;
    return str
      .replace(/\\\\u001b/g, '\u001b')
      .replace(/\\\\x1b/g, '\x1b')
      .replace(/\\u001b/g, '\u001b')
      .replace(/\\x1b/g, '\x1b')
      .replace(/\\033/g, '\x1b');
  }

  const normalizedCodes = {};
  for (const k of Object.keys(codes)) {
    normalizedCodes[k] = normalizeAnsi(codes[k]);
  }

  function colorText(text, colorName) {
    if (!useColor || !colorName) return String(text);
    const seq = normalizedCodes[colorName] || normalizedCodes.white || '';
    const reset = normalizedCodes.reset || '';
    return `${seq}${text}${reset}`;
  }

  function colorForLetter(letter) {
    if (!letter) return 'white';
    const normalized = String(letter).toUpperCase();
    if (config && Array.isArray(config.scale)) {
      for (const tier of config.scale) {
        if (!tier.lettergrade) continue;
        const tierLabel = String(tier.lettergrade).toUpperCase();
        if (tierLabel.startsWith(normalized) && tier.colour) return tier.colour;
      }
    }
    if (normalized.startsWith('A')) return 'green';
    if (normalized.startsWith('B')) return 'cyan';
    if (normalized.startsWith('C')) return 'yellow';
    if (normalized.startsWith('D')) return 'magenta';
    if (normalized.startsWith('F')) return 'red';
    return 'white';
  }

  function colorForPercent(p) {
    const n = Number(p);
    if (Number.isNaN(n)) return 'white';
    if (config && Array.isArray(config.scale)) {
      const sorted = config.scale.slice().sort((a, b) => b.minpercent - a.minpercent);
      for (const tier of sorted) {
        if (n >= Number(tier.minpercent)) {
          if (tier.colour) return tier.colour;
          if (tier.lettergrade) return colorForLetter(tier.lettergrade);
        }
      }
      return 'white';
    }
    if (n >= 97) return 'bright';
    if (n >= 90) return 'green';
    if (n >= 80) return 'cyan';
    if (n >= 70) return 'yellow';
    if (n >= 60) return 'magenta';
    return 'red';
  }

  const showNames = !(config && config.name_all_results === false);

  const columnWidths = {
    ...(showNames ? { studentName: Math.max(...grades.map(g => String(g.studentName || '').length), "Student".length) } : {}),
    courseName: Math.max(...grades.map(g => String(g.courseName || '').length), "Course (Uses Nicknames)".length),
    currentGrade: Math.max(...grades.map(g => String(g.currentGrade || 'N/A').length), "Grade".length),
    currentScore: Math.max(...grades.map(g => String(g.currentScore || 'N/A').length), "Score".length),
  };

  if (!showNames) {
    const studentName = grades[0] && grades[0].studentName ? String(grades[0].studentName) : 'Unknown Student';
    const banner = colorText(`Student: ${studentName}`, 'cyan');
    console.log(banner);
    console.log('');
  }

  const headerParts = [];
  const separatorParts = [];
  if (showNames) {
    headerParts.push(` ${'Student'.padEnd(columnWidths.studentName)} `);
    separatorParts.push(`-${'-'.repeat(columnWidths.studentName)}-`);
  }
  headerParts.push(` ${'Course (Uses Nicknames)'.padEnd(columnWidths.courseName)} `);
  separatorParts.push(`-${'-'.repeat(columnWidths.courseName)}-`);
  headerParts.push(` ${'Grade'.padEnd(columnWidths.currentGrade)} `);
  separatorParts.push(`-${'-'.repeat(columnWidths.currentGrade)}-`);
  headerParts.push(` ${'Score'.padEnd(columnWidths.currentScore)} `);
  separatorParts.push(`-${'-'.repeat(columnWidths.currentScore)}-`);

  const header = `|${headerParts.join('|')}|`;
  const separator = `|${separatorParts.join('|')}|`;

  console.log(header);
  console.log(separator);

  for (const grade of grades) {
    const parts = [];
    if (showNames) {
      const studentRaw = String(grade.studentName || '').padEnd(columnWidths.studentName);
      parts.push(` ${studentRaw} `);
    }

    const courseRaw = String(grade.courseName || '').padEnd(columnWidths.courseName);
    const letterRaw = String(grade.currentGrade || 'N/A').padEnd(columnWidths.currentGrade);
    const scoreRaw = (grade.currentScore === null || grade.currentScore === undefined) ? 'N/A'.padEnd(columnWidths.currentScore) : String(grade.currentScore).padEnd(columnWidths.currentScore);
    
    const letterColor = colorForLetter(grade.currentGrade);
    const percentColor = colorForPercent(grade.currentScore);
    const letterColored = colorText(letterRaw, letterColor);
    const scoreColored = colorText(scoreRaw, percentColor);

    parts.push(` ${courseRaw} `);
    parts.push(` ${letterColored} `);
    parts.push(` ${scoreColored} `);

    const row = `|${parts.join('|')}|`;
    console.log(row);
  }
}

module.exports = { displayGrades };
