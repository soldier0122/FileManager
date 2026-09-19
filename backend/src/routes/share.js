const express = require('express');
const fs = require('fs/promises');
const path = require('path');
const { ZipArchive } = require('archiver');
const authenticateToken = require('../middleware/auth');
const { getSafePath, toRelative } = require('../storage');
const shares = require('../shares');

const router = express.Router();

// Base URL used to build share links. Override with PUBLIC_URL in .env.
const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://dominikkrawczyk.duckdns.org').replace(/\/+$/, '');

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const NOT_FOUND = { error: 'This link is invalid or has been removed' };

// Turns a share token into the item it points at. Resolves null when the
// token is unknown, or the file/folder no longer exists on disk.
async function resolveShare(token) {
    if (!TOKEN_PATTERN.test(token)) return null;

    const share = await shares.findByToken(token);
    if (!share) return null;

    try {
        const target = getSafePath(share.file_path);
        const stat = await fs.stat(target);
        return { target, stat };
    } catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || /Access denied/.test(error.message)) return null;
        throw error;
    }
}

// ---------------------------------------------------------------------------
// Authenticated: manage links
// ---------------------------------------------------------------------------

// POST /api/share   { filePath }  ->  { token, url }
// Creates a share link for a file or folder (or returns the existing one).
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'File path required' });
        }

        const target = getSafePath(filePath);
        const relativePath = toRelative(target);
        if (!relativePath) {
            return res.status(400).json({ error: 'The storage root cannot be shared' });
        }

        await fs.stat(target); // 404 below if it doesn't exist

        const token = await shares.getOrCreate(relativePath, req.user.userId);
        res.json({ token, url: `${PUBLIC_URL}/s/${token}` });
    } catch (error) {
        if (error.code === 'ENOENT') return res.status(404).json({ error: 'File not found' });
        if (/Access denied/.test(error.message)) return res.status(403).json({ error: 'Access denied' });
        console.error('Create share error:', error);
        res.status(500).json({ error: 'Failed to create share link' });
    }
});

// DELETE /api/share   { filePath }
// Revokes the link. Anyone holding it gets a "not found" from then on.
router.delete('/', authenticateToken, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath || typeof filePath !== 'string') {
            return res.status(400).json({ error: 'File path required' });
        }

        const removed = await shares.removeExact(toRelative(getSafePath(filePath)));
        if (!removed) return res.status(404).json({ error: 'This item is not shared' });
        res.json({ message: 'Sharing stopped' });
    } catch (error) {
        if (/Access denied/.test(error.message)) return res.status(403).json({ error: 'Access denied' });
        console.error('Remove share error:', error);
        res.status(500).json({ error: 'Failed to stop sharing' });
    }
});

// ---------------------------------------------------------------------------
// Public: no login. The token in the URL is the only credential.
// ---------------------------------------------------------------------------

// GET /api/share/:token  ->  { name, isDirectory, size }
// Deliberately returns only the display name, never the stored path.
router.get('/:token', async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        res.set('Cache-Control', 'no-store'); // a link can be revoked at any time
        if (!resolved) return res.status(404).json(NOT_FOUND);

        const { target, stat } = resolved;
        res.json({
            name: path.basename(target),
            isDirectory: stat.isDirectory(),
            size: stat.isFile() ? stat.size : null
        });
    } catch (error) {
        console.error('Share lookup error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
});

// GET /api/share/:token/download
// Files are sent as an attachment; folders are zipped on the fly.
router.get('/:token/download', async (req, res) => {
    try {
        const resolved = await resolveShare(req.params.token);
        if (!resolved) return res.status(404).json(NOT_FOUND);

        const { target, stat } = resolved;
        const name = path.basename(target);

        if (stat.isDirectory()) {
            res.attachment(`${name}.zip`);

            const archive = new ZipArchive({ zlib: { level: 6 } });
            archive.on('error', (err) => {
                console.error('Share archive error:', err);
                if (!res.headersSent) res.status(500).json({ error: 'Failed to prepare download' });
                else res.destroy(err);
            });

            archive.pipe(res);
            archive.directory(target, false);
            await archive.finalize();
        } else {
            // dotfiles: 'allow' - the path was already sandboxed above, and the
            // default would 404 files like ".env" or anything under a ".dir".
            res.download(target, name, { dotfiles: 'allow' }, (err) => {
                if (err && !res.headersSent) res.status(500).json({ error: 'Failed to download file' });
            });
        }
    } catch (error) {
        console.error('Share download error:', error);
        if (!res.headersSent) res.status(500).json({ error: 'Failed to download file' });
    }
});

module.exports = router;
