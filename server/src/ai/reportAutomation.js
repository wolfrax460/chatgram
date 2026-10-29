/**
 * Error-report automation (Options B+C).
 *
 * After a NEW Help error report lands in the AdminInbox:
 *  1. optionally create a GitHub issue carrying the ready-to-use prompt;
 *  2. notify Telegram with the short alert (now including the issue link) and,
 *     for error reports, the generated prompt in a follow-up message.
 *
 * Both steps are optional and fail closed: a missing key/bad network is logged
 * content-free and stored on the row (`githubError`) — the user request still
 * returns, and the owner can retry from the admin API or Telegram `/issue`.
 */
async function automateErrorReport(record, { prompt, kind, context, summary } = {}) {
  if (!record || !record._id) return { issue: null, notified: false };
  let issue = null;
  try {
    issue = await require('../utils/githubIssues').createIssueForRecord(record, {
      prompt,
      kind,
      context,
      summary,
    });
  } catch (error) {
    console.warn('[report-automation] github step failed:', String(error?.message || error).slice(0, 140));
  }
  let notified = false;
  try {
    const result = await require('../support/reportTelegram').sendReport(record, { prompt });
    notified = Boolean(result?.ok);
  } catch (error) {
    console.warn('[report-automation] telegram step failed:', String(error?.message || error).slice(0, 140));
  }
  return { issue, notified };
}

module.exports = { automateErrorReport };
