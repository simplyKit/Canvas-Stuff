const config = require('./config.json');
const {addData} = require('./Database');

let fetch;
try {
  const nf = require('node-fetch');
  fetch = nf.default || nf;
} catch (e) {
  if (typeof global.fetch === 'function') fetch = global.fetch;
  else throw e;
}

function getLetterGrade(score) {
    if (score === null || score === undefined) return 'N/A';
    const s = Number(score);
    if (Number.isNaN(s)) return 'N/A';

    const scale = Array.isArray(config.scale) ? config.scale.slice().sort((a, b) => b.minpercent - a.minpercent) : [];
    for (const tier of scale) {
        if (s >= Number(tier.minpercent)) return tier.lettergrade;
    }
    return 'N/A';
}

function parseDateSafe(d) {
  if (!d) return null;
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

async function getGrades(canvasToken) {
  const canvasDomain = process.env.CANVAS_DOMAIN;

  try {
    const headers = {
      Authorization: `Bearer ${canvasToken}`,
    };

    const profileResponse = await fetch(
      `https://${canvasDomain}/api/v1/users/self`,
      { headers }
    );
    const profile = await profileResponse.json();

    if (profile.errors && profile.errors[0] && profile.errors[0].message === 'Invalid access token.') {
      throw new Error("The Canvas API token is invalid.");
    }

    if (!profileResponse.ok || !profile.id) {
      console.error("Error fetching user profile from Canvas.", profile);
      throw new Error("Could not fetch user profile from Canvas.");
    }

    const userId = profile.id;

    const coursesResponse = await fetch(
      `https://${canvasDomain}/api/v1/courses?enrollment_state=active`,
      { headers }
    );
    const courses = await coursesResponse.json();

    if (!Array.isArray(courses)) {
      console.error("Invalid response when fetching courses:", courses);
      throw new Error("Did not receive a valid list of courses.");
    }

    const gradesData = [];

    console.log("Getting Data..");

    const configuredGradingTerm = config.grading_term || 'Term 2';
    let overrideTermTitle = null; // If we detect an active term by date, this will be set and will override config

    for (const course of courses) {
        const gradingPeriodsResponse = await fetch( // Get grading periods for each course
            `https://${canvasDomain}/api/v1/courses/${course.id}/grading_periods`,
            { headers }
        );
        const gradingPeriodsJSON = await gradingPeriodsResponse.json();
        const allGradingPeriods = gradingPeriodsJSON.grading_periods;
        if (config.debugging_mode) console.log(allGradingPeriods)

        // If we don't yet have an override term title, try to detect any active term by date among all grading periods.
        if (!overrideTermTitle && Array.isArray(allGradingPeriods) && allGradingPeriods.length > 0) {
            const now = new Date();
            const activeAny = allGradingPeriods.filter(tp => {
                const start = parseDateSafe(tp.start_date);
                const end = parseDateSafe(tp.end_date);
                const started = !start || start <= now;
                const notEnded = !end || end >= now;
                return started && notEnded;
            });

            if (activeAny.length > 0) {
                // Pick the newest active grading period by most recent start_date, then end_date.
                activeAny.sort((a, b) => {
                    const aStart = parseDateSafe(a.start_date);
                    const bStart = parseDateSafe(b.start_date);
                    const aStartTs = aStart ? aStart.getTime() : 0;
                    const bStartTs = bStart ? bStart.getTime() : 0;
                    if (bStartTs !== aStartTs) return bStartTs - aStartTs;
                    const aEnd = parseDateSafe(a.end_date);
                    const bEnd = parseDateSafe(b.end_date);
                    const aEndTs = aEnd ? aEnd.getTime() : 0;
                    const bEndTs = bEnd ? bEnd.getTime() : 0;
                    return bEndTs - aEndTs;
                });

                overrideTermTitle = activeAny[0].title;
                console.log(`Date-based override detected. Using grading term: "${overrideTermTitle}" instead of configured "${configuredGradingTerm}".`);
                if (config.debugging_mode) console.log("Detected active grading period (used to set override):", activeAny[0]);
            }
        }

        // Use the override term title if present; otherwise use the configured grading term.
        const gradingTermToUse = overrideTermTitle || configuredGradingTerm;

        // Determine the most appropriate grading period for this course based on gradingTermToUse.
        let mostRecentTerm = null;
        if (Array.isArray(allGradingPeriods)) {
            const termGradingPeriods = allGradingPeriods.filter(gp => gp.title === gradingTermToUse);
            if (termGradingPeriods.length > 0) {
                const now = new Date();

                // Find grading periods that are "active" right now (relative to this specific term title)
                const activeTerms = termGradingPeriods.filter(tp => {
                    const start = parseDateSafe(tp.start_date);
                    const end = parseDateSafe(tp.end_date);
                    const started = !start || start <= now;
                    const notEnded = !end || end >= now;
                    return started && notEnded;
                });

                if (activeTerms.length > 0) {
                    // If multiple overlapping grading periods exist, pick the newest one by start_date then end_date.
                    activeTerms.sort((a, b) => {
                        const aStart = parseDateSafe(a.start_date);
                        const bStart = parseDateSafe(b.start_date);
                        const aStartTs = aStart ? aStart.getTime() : 0;
                        const bStartTs = bStart ? bStart.getTime() : 0;
                        if (bStartTs !== aStartTs) return bStartTs - aStartTs;
                        const aEnd = parseDateSafe(a.end_date);
                        const bEnd = parseDateSafe(b.end_date);
                        const aEndTs = aEnd ? aEnd.getTime() : 0;
                        const bEndTs = bEnd ? bEnd.getTime() : 0;
                        return bEndTs - aEndTs;
                    });
                    mostRecentTerm = activeTerms[0];
                    if (config.debugging_mode) console.log("Selected active term by date for course:", mostRecentTerm);
                    console.log(`Fetching & Processing Year Data for ${mostRecentTerm.title} (date-prioritized)`);
                } else {
                    // No active term found by date for this title. Fall back:
                    if (config.grading_period_name_sort) {
                        termGradingPeriods.sort((a, b) => {
                            return (a.title || '').localeCompare(b.title || '');
                        });
                        mostRecentTerm = termGradingPeriods[0];
                        if (config.debugging_mode) console.log("Fell back to name-sorting for course, selected:", mostRecentTerm);
                        console.log(`Fetching & Processing Year Data for ${mostRecentTerm.title} (name-fallback)`);
                    } else {
                        // Previous behavior: sort by end_date descending (most recent end_date first)
                        termGradingPeriods.sort((a, b) => {
                            const aEnd = parseDateSafe(a.end_date);
                            const bEnd = parseDateSafe(b.end_date);
                            const aEndTs = aEnd ? aEnd.getTime() : 0;
                            const bEndTs = bEnd ? bEnd.getTime() : 0;
                            return bEndTs - aEndTs;
                        });
                        mostRecentTerm = termGradingPeriods[0];
                        if (config.debugging_mode) console.log("Fell back to end-date sorting for course, selected:", mostRecentTerm);
                        console.log(`Fetching & Processing Year Data for ${mostRecentTerm.title} (end-date-fallback)`);
                    }
                }
            } else {
                if (config.debugging_mode) {
                    console.log(`No grading periods found for course ${course.id} with title "${gradingTermToUse}".`);
                }
            }
        }

        // Ensure that we're not trying to get data that doesn't exist.
        if (mostRecentTerm) {
            const gradingPeriodParam = `&grading_period_id=${mostRecentTerm.id}`;

            const enrollmentResponse = await fetch(
                `https://${canvasDomain}/api/v1/courses/${course.id}/enrollments?user_id=${userId}${gradingPeriodParam}`,
                { headers }
            );
            const enrollments = await enrollmentResponse.json();

            if (Array.isArray(enrollments) && enrollments.length > 0) {
                const enrollment = enrollments[0];
                const grade = enrollment.grades || {};
                const letterGrade = getLetterGrade(grade.current_score);

                gradesData.push({
                    studentName: profile.name,
                    studentId: userId,
                    courseName: course.name,
                    courseId: course.id,
                    currentScore: grade.current_score+"%", // Too lazy to add the percentage elsewhere.
                    currentGrade: letterGrade, 
                    lastActivity: enrollment.last_activity_at,
                });
            }
        }
    }

    const studentName = profile.name;

    await addData(studentName, {
        timestamp: new Date().toISOString(),
        grades: gradesData,
      });

    return gradesData;
  } catch (error) {
    console.error("Failed to fetch grades:", error && error.message ? error.message : error);
    throw error;
  }
}

module.exports = { getGrades };