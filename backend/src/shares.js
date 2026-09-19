const crypto = require('crypto');
const db = require('./database');

// Promise wrappers around the callback-style sqlite3 API.
const run = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve(this);
    });
});

const get = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
});

// 128 bits of randomness, URL-safe, 22 characters. Not guessable.
const generateToken = () => crypto.randomBytes(16).toString('base64url');

// SQLite's substr() counts characters (code points), so measure the same way
// here. String.length counts UTF-16 units and would be off for filenames
// containing emoji.
const charLength = (str) => [...str].length;

// Returns the existing token for this path, or creates one. There is at most
// one share per path (UNIQUE constraint), so "Share" on an already-shared
// item just shows the same link again.
async function getOrCreate(filePath, userId) {
    const existing = await get('SELECT token FROM shares WHERE file_path = ?', [filePath]);
    if (existing) return existing.token;

    // INSERT OR IGNORE + re-select keeps this safe if two requests race.
    await run(
        'INSERT OR IGNORE INTO shares (token, file_path, created_by) VALUES (?, ?, ?)',
        [generateToken(), filePath, userId ?? null]
    );
    const row = await get('SELECT token FROM shares WHERE file_path = ?', [filePath]);
    return row.token;
}

const findByToken = (token) => get('SELECT token, file_path FROM shares WHERE token = ?', [token]);

// Revoke the share for exactly this path. Resolves true if one existed.
async function removeExact(filePath) {
    const result = await run('DELETE FROM shares WHERE file_path = ?', [filePath]);
    return result.changes > 0;
}

// Revoke shares for this path and everything beneath it (used when an item,
// possibly a folder, is deleted).
async function removeUnder(filePath) {
    if (!filePath) return;
    const prefix = `${filePath}/`;
    await run(
        'DELETE FROM shares WHERE file_path = ? OR substr(file_path, 1, ?) = ?',
        [filePath, charLength(prefix), prefix]
    );
}

// Keep links working when an item (or folder) is renamed or moved: rewrite
// the stored path for it and everything beneath it.
async function moveUnder(oldPath, newPath) {
    if (!oldPath || !newPath || oldPath === newPath) return;

    // Whatever used to live at the destination has just been overwritten, so
    // its links must die (this also frees the UNIQUE path for the update).
    await removeUnder(newPath);

    const prefix = `${oldPath}/`;
    await run(
        `UPDATE shares
            SET file_path = ? || substr(file_path, ?)
          WHERE file_path = ? OR substr(file_path, 1, ?) = ?`,
        [newPath, charLength(oldPath) + 1, oldPath, charLength(prefix), prefix]
    );
}

module.exports = { getOrCreate, findByToken, removeExact, removeUnder, moveUnder };
