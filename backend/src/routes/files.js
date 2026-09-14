const express = require('express');
const multer = require('multer');
const { ZipArchive } = require('archiver');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

const STORAGE_ROOT = process.env.STORAGE_ROOT 
    ? path.resolve(process.env.STORAGE_ROOT) 
    : path.resolve(__dirname, '../../storage');

const upload = multer({ dest: path.join(STORAGE_ROOT, '.tmp') });

const getSafePath = (userPath) => {
    const targetPath = path.resolve(STORAGE_ROOT, userPath || '');
    if (!targetPath.startsWith(STORAGE_ROOT)) {
        throw new Error('Access denied: Path out of bounds');
    }
    return targetPath;
};

const getDiskStats = async (targetPath) => {
    const driveRoot = path.parse(path.resolve(targetPath)).root;
    let totalBytes = 0;
    let freeBytes = 0;

    if (typeof fsSync.statfsSync === 'function') {
        try {
            const stats = fsSync.statfsSync(targetPath);
            totalBytes = Number(stats.blocks || 0) * Number(stats.bsize || 0);
            freeBytes = Number(stats.bavail || 0) * Number(stats.bsize || 0);
        } catch (error) {
            // Fall through to the OS-specific fallback below.
        }
    }

    if ((!totalBytes || !freeBytes) && process.platform === 'win32') {
        try {
            const driveLetter = driveRoot.replace(/[\\/]+/g, '').slice(0, 1);
            const output = execSync(
                `wmic logicaldisk where "DeviceID='${driveLetter}:\\'" get FreeSpace,Size /value`,
                { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
            );
            const match = output.match(/FreeSpace=(\d+)/i);
            const sizeMatch = output.match(/Size=(\d+)/i);

            if (match && sizeMatch) {
                freeBytes = Number(match[1]);
                totalBytes = Number(sizeMatch[1]);
            }
        } catch (error) {
            totalBytes = 0;
            freeBytes = 0;
        }
    }

    if (!totalBytes && !freeBytes) {
        totalBytes = 1;
        freeBytes = 0;
    }

    const usedBytes = Math.max(0, totalBytes - freeBytes);

    return {
        total: totalBytes,
        used: usedBytes,
        free: Math.max(0, freeBytes),
        percentUsed: totalBytes ? Math.min(100, Math.max(0, (usedBytes / totalBytes) * 100)) : 0
    };
};

// GET /api/files?path=...
router.get('/', authenticateToken, async (req, res) => {
    try {
        await fs.mkdir(STORAGE_ROOT, { recursive: true });
        
        const relativePath = req.query.path || '';
        const targetPath = getSafePath(relativePath);

        const items = await fs.readdir(targetPath, { withFileTypes: true });
        
        const fileList = items.map(item => ({
            name: item.name,
            isDirectory: item.isDirectory(),
            path: path.join(relativePath, item.name).replace(/\\/g, '/')
        }));

        fileList.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
        });

        res.json({ currentPath: relativePath, files: fileList });
    } catch (error) {
        console.error('Read error:', error);
        res.status(error.message.includes('Access denied') ? 403 : 500).json({ error: 'Failed to read directory' });
    }
});

// POST /api/files/folder
router.post('/folder', authenticateToken, async (req, res) => {
    try {
        const { currentPath, folderName } = req.body;
        if (!folderName) return res.status(400).json({ error: 'Folder name required' });

        const newFolderPath = getSafePath(path.join(currentPath || '', folderName));
        await fs.mkdir(newFolderPath);
        res.status(201).json({ message: 'Folder created' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create folder' });
    }
});

// POST /api/files/text
router.post('/text', authenticateToken, async (req, res) => {
    try {
        const { currentPath, fileName } = req.body;
        if (!fileName) return res.status(400).json({ error: 'File name required' });

        const safeFileName = fileName.endsWith('.txt') ? fileName : `${fileName}.txt`;
        const newFilePath = getSafePath(path.join(currentPath || '', safeFileName));
        
        await fs.writeFile(newFilePath, '', 'utf8');
        res.status(201).json({ message: 'File created' });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create file' });
    }
});

// GET /api/files/read?path=...
router.get('/read', authenticateToken, async (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        
        const content = await fs.readFile(targetPath, 'utf8');
        res.json({ content });
    } catch (error) {
        console.error('Read file error:', error);
        res.status(500).json({ error: 'Failed to read file contents' });
    }
});

// PUT /api/files/update
router.put('/update', authenticateToken, async (req, res) => {
    try {
        const { filePath, content } = req.body;
        if (!filePath) return res.status(400).json({ error: 'File path required' });

        const targetPath = getSafePath(filePath);
        
        await fs.writeFile(targetPath, content || '', 'utf8');
        res.json({ message: 'File saved successfully' });
    } catch (error) {
        console.error('Save file error:', error);
        res.status(500).json({ error: 'Failed to save file' });
    }
});

// DELETE /api/files/delete
router.delete('/delete', authenticateToken, async (req, res) => {
    try {
        const { filePath } = req.body;
        if (!filePath) return res.status(400).json({ error: 'File path required' });

        const targetPath = getSafePath(filePath);
        
        // fs.rm with recursive handles both files and non-empty folders
        await fs.rm(targetPath, { recursive: true, force: true });
        res.json({ message: 'Deleted successfully' });
    } catch (error) {
        console.error('Delete error:', error);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// PUT /api/files/rename
router.put('/rename', authenticateToken, async (req, res) => {
    try {
        const { oldPath, newName } = req.body;
        if (!oldPath || !newName) return res.status(400).json({ error: 'Missing parameters' });

        const targetPath = getSafePath(oldPath);
        const dir = path.dirname(targetPath);
        const newTargetPath = path.join(dir, newName);
        
        // Ensure the new path doesn't escape the storage root
        if (!newTargetPath.startsWith(STORAGE_ROOT)) throw new Error('Out of bounds');

        await fs.rename(targetPath, newTargetPath);
        res.json({ message: 'Renamed successfully' });
    } catch (error) {
        console.error('Rename error:', error);
        res.status(500).json({ error: 'Failed to rename item' });
    }
});

// POST /api/files/copy
router.post('/copy', authenticateToken, async (req, res) => {
    try {
        const { sourcePath, destinationDir } = req.body;
        if (!sourcePath) return res.status(400).json({ error: 'Source path required' });

        const src = getSafePath(sourcePath);
        // Create the new path by placing the source file's name inside the destination directory
        const dest = getSafePath(path.join(destinationDir || '', path.basename(src)));

        // fs.cp handles copying both files and directories
        await fs.cp(src, dest, { recursive: true });
        res.json({ message: 'Copied successfully' });
    } catch (error) {
        console.error('Copy error:', error);
        res.status(500).json({ error: 'Failed to copy item' });
    }
});

// GET /api/files/download?path=...
// This serves the raw file directly (great for images, videos, and downloading)
router.get('/download', authenticateToken, (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        
        // res.sendFile automatically handles mime-types and binary streaming
        res.sendFile(targetPath);
    } catch (error) {
        console.error('Download error:', error);
        res.status(500).json({ error: 'Failed to download file' });
    }
});

router.get('/storage', authenticateToken, async (req, res) => {
    try {
        const diskStats = await getDiskStats(STORAGE_ROOT);
        const usedBytes = Math.max(0, diskStats.total - diskStats.free);

        res.json({
            total: diskStats.total,
            used: usedBytes,
            free: Math.max(0, diskStats.free),
            percentUsed: diskStats.total ? Math.min(100, Math.max(0, (usedBytes / diskStats.total) * 100)) : 0
        });
    } catch (error) {
        console.error('Storage stats error:', error);
        res.status(500).json({ error: 'Failed to get storage usage' });
    }
});

// GET /api/files/export?path=...
router.get('/export', authenticateToken, async (req, res) => {
    try {
        const relativePath = req.query.path;
        if (!relativePath) return res.status(400).json({ error: 'Path required' });

        const targetPath = getSafePath(relativePath);
        const stat = await fs.stat(targetPath);

        if (stat.isDirectory()) {
            const zipName = `${path.basename(targetPath) || 'export'}.zip`;
            res.attachment(zipName);

            const archive = new ZipArchive({ zlib: { level: 9 } });

            archive.on('error', (err) => {
                console.error('Archive error:', err);
                if (!res.headersSent) {
                    res.status(500).json({ error: 'Failed to export folder' });
                    return;
                }
                res.destroy(err);
            });

            archive.pipe(res);
            archive.directory(targetPath, false);
            await archive.finalize();
        } else {
            res.download(targetPath);
        }
    } catch (error) {
        console.error('Export error:', error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Failed to export item' });
        }
    }
});

// PUT /api/files/move
router.put('/move', authenticateToken, async (req, res) => {
    try {
        const { sourcePath, destinationDir } = req.body;
        // destinationDir can be empty string for root, so we check strictly for undefined
        if (!sourcePath || destinationDir === undefined) {
            return res.status(400).json({ error: 'Missing parameters' });
        }

        const src = getSafePath(sourcePath);
        // Create the new path by placing the source file's name inside the destination directory
        const dest = getSafePath(path.join(destinationDir, path.basename(src)));

        // Ensure the new path doesn't escape the storage root
        if (!dest.startsWith(STORAGE_ROOT)) throw new Error('Out of bounds');

        await fs.rename(src, dest);
        res.json({ message: 'Moved successfully' });
    } catch (error) {
        console.error('Move error:', error);
        res.status(500).json({ error: 'Failed to move item' });
    }
});

// POST /api/files/upload
router.post('/upload', authenticateToken, upload.array('files'), async (req, res) => {
    try {
        // currentPath is sent as a text field alongside the files
        const currentPath = req.body.currentPath || '';
        const targetDir = getSafePath(currentPath);
        
        await fs.mkdir(targetDir, { recursive: true });

        // relativePaths (JSON array, same order/length as req.files) lets the
        // frontend preserve folder structure for whole-folder uploads, e.g.
        // "MyFolder/notes/week1.pdf". Falls back to the flat filename for
        // plain single/multi-file uploads or if the field is missing/malformed.
        let relativePaths = [];
        if (req.body.relativePaths) {
            try {
                const parsed = JSON.parse(req.body.relativePaths);
                if (Array.isArray(parsed)) relativePaths = parsed;
            } catch {
                relativePaths = [];
            }
        }

        // Loop through all uploaded files and move them from the temp folder to storage
        for (let i = 0; i < req.files.length; i++) {
            const file = req.files[i];
            const rawRelPath = (typeof relativePaths[i] === 'string' && relativePaths[i])
                ? relativePaths[i]
                : file.originalname;

            // Normalize slashes and strip any leading "../" segments so a
            // maliciously-crafted relative path can't escape the current
            // directory. getSafePath() below is the authoritative sandbox
            // check; this is just belt-and-braces.
            const safeRelPath = path.normalize(rawRelPath).replace(/^(\.\.[/\\])+/, '');
            const destPath = getSafePath(path.join(currentPath, safeRelPath));

            // Recreate any subfolders the relative path implies before copying.
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await fs.copyFile(file.path, destPath);
            await fs.unlink(file.path); // Clean up the temp file
        }
        
        res.status(200).json({ message: 'Files uploaded successfully' });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ error: 'Failed to upload files' });
    }
});

module.exports = router;