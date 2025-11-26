const config = require('./config.json');

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

    const gradingTerm = config.grading_term || 'Term 2';

    for (const course of courses) {
        const gradingPeriodsResponse = await fetch( // Get grading periods for each course
            `https://${canvasDomain}/api/v1/courses/${course.id}/grading_periods`,
            { headers }
        );
        const gradingPeriodsJSON = await gradingPeriodsResponse.json();
        const allGradingPeriods = gradingPeriodsJSON.grading_periods;

        // Sort grading periods based off time and name even though it only shows grading periods from this year.
        let mostRecentTerm = null;
        if (Array.isArray(allGradingPeriods)) {
            const termGradingPeriods = allGradingPeriods.filter(gp => gp.title === gradingTerm);
            if (termGradingPeriods.length > 0) {
                // Sort by end_date in descending order to get the most recent one first
                termGradingPeriods.sort((a, b) => new Date(b.end_date) - new Date(a.end_date));
                mostRecentTerm = termGradingPeriods[0];
                console.log(`Fetching & Processing Year Data for ${mostRecentTerm.title}`)
            }
        }

        // Ensure that we're not trying to get data that doesn't exist. Thaat would suck lol.
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


    return gradesData;
  } catch (error) {
    console.error("Failed to fetch grades:", error && error.message ? error.message : error);
    throw error;
  }
}

module.exports = { getGrades };
