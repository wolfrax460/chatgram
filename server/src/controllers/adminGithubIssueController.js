/**
 * Admin retry for the GitHub issue of one AdminInbox report (Option C).
 *
 * POST /api/admin/inbox/:id/github-issue
 * Idempotent: returns the existing issue when one is already linked. Failure
 * codes are content-free (no token/prompt): GITHUB_NOT_CONFIGURED, NO_PROMPT,
 * NOT_FOUND or GITHUB_ISSUE_FAILED with the stored HTTP status.
 */
const admin = require('../admin/auth');
const github = require('../utils/githubIssues');

const retry = async (req, res) => {
  try {
    const result = await github.retryForInbox(req.params.id);
    if (result.ok) {
      await admin.audit(
        'admin_inbox_github_issue',
        req,
        `${req.params.id} issue=${result.issueNumber} created=${result.created ? 'yes' : 'no'}`,
      );
      return res.json({
        ok: true,
        created: Boolean(result.created),
        issueNumber: result.issueNumber,
        url: result.url,
      });
    }
    if (result.error === 'not_found') {
      return res.status(404).json({ message: 'Inbox item not found.', code: 'NOT_FOUND' });
    }
    if (result.error === 'not_configured') {
      return res.status(409).json({
        message: 'GitHub issue creation is not configured on this server.',
        code: 'GITHUB_NOT_CONFIGURED',
      });
    }
    if (result.error === 'no_prompt') {
      return res.status(409).json({
        message: 'No AI prompt is stored for this report yet.',
        code: 'NO_PROMPT',
      });
    }
    await admin.audit('admin_inbox_github_issue', req, `${req.params.id} failed=${result.error || 'unknown'}`);
    return res.status(502).json({
      message: `Could not create the GitHub issue (${result.error || 'failed'}).`,
      code: 'GITHUB_ISSUE_FAILED',
      status: result.error || null,
    });
  } catch (error) {
    console.error('Admin GitHub issue retry failed:', String(error?.message || error).slice(0, 160));
    return res.status(500).json({ message: 'Could not create the GitHub issue.' });
  }
};

module.exports = { retry };
