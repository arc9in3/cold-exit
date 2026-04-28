// Task queue — thin DAO over the `tasks` and `events` tables.
// Workers poll `claimNext(owner)` to atomically pull the next pending
// task for them; `markStarted` / `markDone` / `markFailed` close it
// out. Discord origin (user, channel, message) is stored so the bot
// can post the result back to the right thread.

import { db } from './db.mjs';

const ROOT = process.cwd();   // unused for now but reserved for future relative-path helpers

// Insert a new pending task. Returns the row id.
export function enqueue({
  slug,
  title,
  prompt,
  files = [],
  project = 'cold-exit',
  owner,
  routeReason = '',
  reviewer = null,
  originUserId = null,
  originChannelId = null,
  originMessageId = null,
}) {
  const stmt = db().prepare(`
    INSERT INTO tasks
      (slug, title, prompt, files_json, project, owner, route_reason, reviewer,
       origin_user_id, origin_channel_id, origin_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    slug, title, prompt, JSON.stringify(files), project, owner, routeReason,
    reviewer, originUserId, originChannelId, originMessageId,
  );
  logEvent({ bot: owner, kind: 'task_queued', taskId: info.lastInsertRowid, body: slug });
  return info.lastInsertRowid;
}

// Atomic "give me the next pending task for owner X". Uses a tx so two
// worker pollers can't grab the same row. Returns the task or null.
export function claimNext(owner) {
  const tx = db().transaction(() => {
    const row = db().prepare(`
      SELECT * FROM tasks
      WHERE owner = ? AND status = 'pending'
      ORDER BY created_at ASC
      LIMIT 1
    `).get(owner);
    if (!row) return null;
    db().prepare(`
      UPDATE tasks
      SET status = 'in_progress', started_at = datetime('now')
      WHERE id = ?
    `).run(row.id);
    return { ...row, status: 'in_progress', files: JSON.parse(row.files_json || '[]') };
  });
  return tx();
}

export function markDone({ id, outputPath, summary, durationMs }) {
  db().prepare(`
    UPDATE tasks
    SET status = 'done',
        output_path = ?,
        output_summary = ?,
        finished_at = datetime('now'),
        duration_ms = ?
    WHERE id = ?
  `).run(outputPath || null, summary || null, durationMs || null, id);
  logEvent({ bot: _ownerOfTask(id), kind: 'task_done', taskId: id, body: summary?.slice(0, 200) || '' });
}

export function markFailed({ id, errorText }) {
  db().prepare(`
    UPDATE tasks
    SET status = 'failed',
        error_text = ?,
        finished_at = datetime('now')
    WHERE id = ?
  `).run(errorText || 'unknown error', id);
  logEvent({ bot: _ownerOfTask(id), kind: 'task_failed', taskId: id, body: errorText?.slice(0, 200) || '' });
}

export function getTask(id) {
  return db().prepare(`SELECT * FROM tasks WHERE id = ?`).get(id);
}

export function pendingTasks(owner = null) {
  if (owner) {
    return db().prepare(`SELECT * FROM tasks WHERE owner = ? AND status IN ('pending','in_progress') ORDER BY created_at ASC`).all(owner);
  }
  return db().prepare(`SELECT * FROM tasks WHERE status IN ('pending','in_progress') ORDER BY created_at ASC`).all();
}

export function recentDone(limit = 10) {
  return db().prepare(`
    SELECT * FROM tasks
    WHERE status IN ('done','failed')
    ORDER BY finished_at DESC
    LIMIT ?
  `).all(limit);
}

export function logEvent({ bot, kind, taskId = null, body = '', meta = null }) {
  db().prepare(`
    INSERT INTO events (bot, kind, task_id, body, meta_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(bot, kind, taskId, body, meta ? JSON.stringify(meta) : null);
}

function _ownerOfTask(id) {
  const row = db().prepare(`SELECT owner FROM tasks WHERE id = ?`).get(id);
  return row?.owner || 'unknown';
}
